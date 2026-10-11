//! LAUNCHPAD-PATH §40 (owner decision 2026-10-11) — every pair is WINNER TAKES THE BURN. Two policy-0 coins against the real CPMM
//! fixture: pairing at initialize_token (provisional → paired inside the 7-day window), the quorum-signed PairResult, the crank gate
//! (loser refuses, winner and draw crank, 72 h grace), and forward_to_winner (exact lamports, reserve kept, SOL then WSOL, the cap,
//! one-shot 100 %, idempotency, same period, wind-down sweep). The pair_curve side (link_pair, the Pair as witness, a forward on a
//! graduated pair) is in programs/pair_curve/tests/lifecycle.rs.

#![allow(clippy::result_large_err, clippy::too_many_arguments)]
mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::{AnchorDeserialize, Discriminator};
use anchor_spl::associated_token::get_associated_token_address;
use burn_receipts::constants::*;
use burn_receipts::events::{ForwardedToWinner, PairResultMissing};
use burn_receipts::math;
use burn_receipts::state::{PairResult, RuleParams};
use common::cpmm::{self, Pool};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

// r2 (L-2): results are refused for dates before the pairing (the harness pairs on 2026-10-09), so the periods are after it and the
// clock is moved to T0 before any reading.
const D1: u32 = 20261010;
const D2: u32 = 20261011;
const D3: u32 = 20261012;
const T0: i64 = NOW + 6 * 86_400; // 2026-10-15T12:00Z
const V1: u64 = 4_027_300_000_000_000;

thread_local! {
    static LAUNCHER: std::cell::RefCell<Option<Keypair>> = const { std::cell::RefCell::new(None) };
}

struct Coin {
    mint: Pubkey,
    pool: Pool,
}

fn platform(env: &mut Env) {
    if env.svm.get_account(&platform_pda()).map(|a| a.data.is_empty()).unwrap_or(true) {
        let auth = Pubkey::new_unique();
        env.init_platform(&auth, DEFAULT_BURN_POOL_CAP_LAMPORTS);
    }
}

/// initialize_token for a policy-0 coin, optionally naming a partner (`partner_first`: the partner already named this mint).
fn init(env: &mut Env, mint: &Keypair, attester: &Pubkey, rule: RuleParams, pair: Option<(Pubkey, bool)>) -> TxResult {
    let creator = Keypair::new();
    let mut args = init_args(rule, vec![*attester], 1);
    args.admin = creator.pubkey();
    let payer = env.payer.pubkey();
    let platform = (rule.mode == MODE_BUYBACK && rule.pool_policy == POOL_POLICY_CREATOR_IS_FEE_PDA).then_some(TEST_LAUNCHLAB_PLATFORM);
    let ix = ix_initialize_full(&payer, &creator.pubkey(), &mint.pubkey(), args, platform, pair.map(|p| p.0), pair.map(|p| p.1).unwrap_or(false));
    env.send(&[ix], &[&creator, mint])
}

/// The mint, its CPMM pool (fee-PDA creator, LP locked), register_pool, the fee PDA's ATAs and ≈ 900 s of oracle history.
fn market(env: &mut Env, mint_kp: &Keypair) -> Coin {
    if env.now() < T0 {
        env.set_time(T0);
    }
    platform(env);
    let payer = env.payer.pubkey();
    env.create_mint(mint_kp, &payer, DECIMALS);
    let mint = mint_kp.pubkey();
    let launcher = LAUNCHER.with(|l| l.borrow().as_ref().map(|k| k.insecure_clone()));
    let launcher = match launcher {
        Some(k) if env.svm.get_account(&cpmm::amm_config_0()).is_some() => k,
        _ => {
            let k = Keypair::new();
            env.fund(&k.pubkey(), 5_000 * SOL);
            cpmm::setup_amm(env, &k.pubkey());
            LAUNCHER.with(|l| *l.borrow_mut() = Some(k.insecure_clone()));
            k
        }
    };
    let lt = env.create_ata(&launcher.pubkey(), &mint);
    let me = env.payer.insecure_clone();
    env.mint_to(&mint, &me, &lt, 800_000_000 * TOKEN);
    let pool = cpmm::create_pool(env, &launcher, &cpmm::amm_config_0(), &mint, &fee_pda(&mint), 85 * SOL, 800_000_000 * TOKEN, &lt);
    cpmm::launchlab_migrated(env, &mint, &pool);
    env.ok(&[ix_register_pool(&payer, &mint, &pool.pool)], &[]);
    let fee = fee_pda(&mint);
    env.create_ata(&fee, &NATIVE_MINT);
    env.create_ata(&fee, &mint);
    cpmm::seed_history(env, &pool, &mint);
    Coin { mint, pool }
}

/// Two paired coins A and B (A initialized first naming B; B answers), both with markets; both read D1 (baseline).
fn paired(env: &mut Env, attester: &Keypair, rule_a: RuleParams, rule_b: RuleParams) -> (Coin, Coin) {
    paired_with(env, attester, attester, rule_a, rule_b)
}

/// As `paired`, each coin with its own attester (quorum 1).
fn paired_with(env: &mut Env, att_a: &Keypair, att_b: &Keypair, rule_a: RuleParams, rule_b: RuleParams) -> (Coin, Coin) {
    let (ka, kb) = (Keypair::new(), Keypair::new());
    init(env, &ka, &att_a.pubkey(), rule_a, Some((kb.pubkey(), false))).unwrap();
    init(env, &kb, &att_b.pubkey(), rule_b, Some((ka.pubkey(), true))).unwrap();
    let a = market(env, &ka);
    let b = market(env, &kb);
    submit(env, &a.mint, D1, V1, &[att_a]).unwrap();
    submit(env, &b.mint, D1, V1, &[att_b]).unwrap();
    (a, b)
}

/// Writes a TokenConfig field change straight into the account (a state another instruction would leave: a pool switched away by
/// apply_registration_policy, an attester rotation).
fn patch_config(env: &mut Env, mint: &Pubkey, f: impl FnOnce(&mut burn_receipts::state::TokenConfig)) {
    let key = config_pda(mint);
    let mut cfg = env.config(&key);
    f(&mut cfg);
    let mut acc = env.svm.get_account(&key).unwrap();
    let mut data = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(&cfg, &mut data).unwrap();
    acc.data[..data.len()].copy_from_slice(&data);
    env.svm.set_account(key, acc).unwrap();
}

fn cranker(env: &mut Env) -> Keypair {
    let k = Keypair::new();
    env.fund(&k.pubkey(), SOL);
    k
}

fn event<T: AnchorDeserialize + Discriminator>(meta: &litesvm::types::TransactionMetadata) -> Option<T> {
    events(meta).into_iter().find(|(d, _)| d[..] == T::DISCRIMINATOR[..]).map(|(_, p)| T::try_from_slice(&p).unwrap())
}

/// What forward_to_winner must move: the loser's buyback_spend on min(SOL above reserve + WSOL, cap); 0 under the floor.
fn expected_forward(env: &Env, loser: &Pubkey, date: u32) -> u64 {
    let rule = env.config(&config_pda(loser)).rule;
    let units = env.reading(&reading_pda(&config_pda(loser), date)).unwrap().units;
    let fee = fee_pda(loser);
    let wsol = env.svm.get_account(&get_associated_token_address(&fee, &NATIVE_MINT)).map(|_| env.token_amount(&get_associated_token_address(&fee, &NATIVE_MINT))).unwrap_or(0);
    let basis = (env.lamports(&fee).saturating_sub(rule.reserve_lamports) + wsol).min(DEFAULT_BURN_POOL_CAP_LAMPORTS);
    let spend = math::buyback_spend(basis, units, rule.fraction_per_unit_bps).unwrap();
    if spend < rule.floor_lamports { 0 } else { spend }
}

// =================================================================================================================================
// pairing
// =================================================================================================================================

#[test]
fn pairing_at_initialize_is_provisional_until_the_partner_answers_inside_the_window() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (ka, kb) = (Keypair::new(), Keypair::new());
    init(&mut env, &ka, &att.pubkey(), buyback_rule(), Some((kb.pubkey(), false))).unwrap();
    let ca = env.config(&config_pda(&ka.pubkey()));
    assert_eq!(ca.pair_state, PAIR_STATE_PROVISIONAL);
    let la = pair_link(&env, &ka.pubkey()).unwrap();
    assert_eq!((la.mint, la.pair_mint, la.paired, la.witness), (ka.pubkey(), kb.pubkey(), false, PAIR_WITNESS_INITIALIZE));
    assert_eq!(la.pairing_deadline, la.created_at + PAIRING_WINDOW_SECS);
    // B answers, naming A, inside the window: both paired.
    init(&mut env, &kb, &att.pubkey(), buyback_rule(), Some((ka.pubkey(), true))).unwrap();
    assert_eq!(env.config(&config_pda(&ka.pubkey())).pair_state, PAIR_STATE_PAIRED);
    assert_eq!(env.config(&config_pda(&kb.pubkey())).pair_state, PAIR_STATE_PAIRED);
    let (la, lb) = (pair_link(&env, &ka.pubkey()).unwrap(), pair_link(&env, &kb.pubkey()).unwrap());
    assert!(la.paired && lb.paired && lb.pair_mint == ka.pubkey() && la.paired_at > 0);
    // A third coin naming A (already paired, its link names B): refused, with or without A's config — no dead provisional links.
    let kc = Keypair::new();
    expect_anchor_err(init(&mut env, &kc, &att.pubkey(), buyback_rule(), Some((ka.pubkey(), true))), "PairMismatch");
    expect_anchor_err(init(&mut env, &kc, &att.pubkey(), buyback_rule(), Some((ka.pubkey(), false))), "PairMismatch");
}

/// pair-forward blind review L-3: the second coin that names the first MUST pass the partner accounts (the partner's PairLink is
/// mandatory with pair_mint; with a link naming this mint, the partner's TokenConfig too) — two coins can never both stay provisional.
#[test]
fn l3_the_second_coin_must_complete_the_pairing() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (ka, kb) = (Keypair::new(), Keypair::new());
    init(&mut env, &ka, &att.pubkey(), buyback_rule(), Some((kb.pubkey(), false))).unwrap();
    // B names A but omits A's TokenConfig: refused (before the fix B became provisional too — forever).
    expect_anchor_err(init(&mut env, &kb, &att.pubkey(), buyback_rule(), Some((ka.pubkey(), false))), "PairMismatch");
    // ... and omitting A's PairLink as well: refused.
    let creator = Keypair::new();
    let mut args = init_args(buyback_rule(), vec![att.pubkey()], 1);
    args.admin = creator.pubkey();
    let payer = env.payer.pubkey();
    let mut ix = ix_initialize_full(&payer, &creator.pubkey(), &kb.pubkey(), args, Some(TEST_LAUNCHLAB_PLATFORM), Some(ka.pubkey()), false);
    let link_slot = ix.accounts.iter().position(|m| m.pubkey == pair_link_pda(&ka.pubkey())).unwrap();
    ix.accounts[link_slot] = anchor_lang::solana_program::instruction::AccountMeta::new_readonly(burn_receipts::ID, false);
    expect_anchor_err(env.send(&[ix], &[&creator, &kb]), "PairMismatch");
    init(&mut env, &kb, &att.pubkey(), buyback_rule(), Some((ka.pubkey(), true))).unwrap();
    assert_eq!(env.config(&config_pda(&ka.pubkey())).pair_state, PAIR_STATE_PAIRED);
}

#[test]
fn a_partner_answering_after_the_window_never_pairs_and_bad_partners_are_refused() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (ka, kb) = (Keypair::new(), Keypair::new());
    init(&mut env, &ka, &att.pubkey(), buyback_rule(), Some((kb.pubkey(), false))).unwrap();
    let now = env.now();
    env.set_time(now + PAIRING_WINDOW_SECS + 1);
    expect_anchor_err(init(&mut env, &kb, &att.pubkey(), buyback_rule(), Some((ka.pubkey(), true))), "PairingClosed");
    assert_eq!(env.config(&config_pda(&ka.pubkey())).pair_state, PAIR_STATE_PROVISIONAL, "A stays a plain (provisional) coin for good");
    // A partner that named someone else.
    let (kc, kd, ke) = (Keypair::new(), Keypair::new(), Keypair::new());
    init(&mut env, &kc, &att.pubkey(), buyback_rule(), Some((kd.pubkey(), false))).unwrap();
    expect_anchor_err(init(&mut env, &ke, &att.pubkey(), buyback_rule(), Some((kc.pubkey(), true))), "PairMismatch");
    // itself, vault mode, policy 2: refused.
    let kf = Keypair::new();
    expect_anchor_err(init(&mut env, &kf, &att.pubkey(), buyback_rule(), Some((kf.pubkey(), false))), "InvalidPairMint");
    expect_anchor_err(init(&mut env, &kf, &att.pubkey(), vault_rule(), Some((Pubkey::new_unique(), false))), "InvalidPairMint");
    let mut r2 = buyback_rule();
    r2.pool_policy = POOL_POLICY_PAIR_CURVE;
    let creator = Keypair::new();
    let mut args = init_args(r2, vec![att.pubkey()], 1);
    args.admin = creator.pubkey();
    let payer = env.payer.pubkey();
    let ix = ix_initialize_full(&payer, &creator.pubkey(), &kf.pubkey(), args, Some(TEST_LAUNCHLAB_PLATFORM), Some(Pubkey::new_unique()), false);
    expect_anchor_err(env.send(&[ix], &[&creator, &kf]), "InvalidPairMint");
}

// =================================================================================================================================
// results and the crank gate
// =================================================================================================================================

/// Who signs (pair-forward blind review M-1): a WIN needs the LOSER's quorum (the side giving up fuel consents); the winner's
/// signatures are optional — required only if the loser rotated its attesters since pairing. A DRAW needs both quorums. Plus the
/// basics: one winner from the pair, byte order, unpaired coins, future dates, append-only, and (I-2) a repeated submission is
/// checked for signatures too.
#[test]
fn a_win_needs_the_losers_quorum_a_draw_needs_both_and_results_never_change() {
    let mut env = Env::new();
    let (att_a, att_b) = (Keypair::new(), Keypair::new());
    let (ca, cb) = paired_with(&mut env, &att_a, &att_b, buyback_rule(), buyback_rule());
    let (a, b) = (ca.mint, cb.mint);
    submit(&mut env, &a, D2, V1 + UNIT, &[&att_a]).unwrap();
    submit(&mut env, &b, D2, V1 + 2 * UNIT, &[&att_b]).unwrap();
    // B loses: the WINNER's signature alone is not enough; the loser's alone is.
    expect_anchor_err(submit_pair_result(&mut env, &a, &b, D2, a, &[&att_a]), "QuorumNotMet");
    // a draw needs both
    expect_anchor_err(submit_pair_result(&mut env, &a, &b, D2, Pubkey::default(), &[&att_b]), "QuorumNotMet");
    // a winner outside the pair
    expect_anchor_err(submit_pair_result(&mut env, &a, &b, D2, Pubkey::new_unique(), &[&att_b]), "InvalidWinner");
    // the configs out of byte order
    let (lo, hi) = burn_receipts::state::pair_order(&a, &b);
    let msg = pair_message(&a, &b, D2, &a, src_hash(), [0u8; 32]);
    let entries = vec![(att_b.pubkey(), sign(&att_b, &msg))];
    let mut ix = ix_submit_pair_result(&env.payer.pubkey(), &a, &b, D2, a, src_hash(), [0u8; 32]);
    ix.accounts.swap(1, 2);
    ix.accounts.swap(3, 4);
    ix.accounts.swap(8, 9);
    ix.accounts[5].pubkey = Pubkey::find_program_address(&[PAIR_RESULT_SEED, hi.as_ref(), lo.as_ref(), &D2.to_le_bytes()], &burn_receipts::ID).0;
    expect_anchor_err(env.send(&[ed25519_shared(&entries, &msg), ix], &[]), "PairOrder");
    // unpaired coins
    let kc = Keypair::new();
    init(&mut env, &kc, &att_a.pubkey(), buyback_rule(), None).unwrap();
    expect_anchor_err(submit_pair_result(&mut env, &a, &kc.pubkey(), D2, a, &[&att_a]), "AccountNotInitialized");
    // a future date
    expect_anchor_err(submit_pair_result(&mut env, &a, &b, 20991231, a, &[&att_b]), "FutureDate");
    // the result, signed by the loser (B) only
    submit_pair_result(&mut env, &a, &b, D2, a, &[&att_b]).unwrap();
    let r = pair_result(&env, &a, &b, D2).unwrap();
    assert_eq!((r.mint_lo, r.mint_hi, r.record_date, r.winner, r.forwarded), (lo, hi, D2, a, false));
    assert_eq!((r.result_for(&a), r.result_for(&b), r.result_for(&kc.pubkey())), (PAIR_RESULT_WON, PAIR_RESULT_LOST, PAIR_RESULT_NONE));
    let (mask_a, mask_b) = if a == lo { (r.signers_mask_lo, r.signers_mask_hi) } else { (r.signers_mask_hi, r.signers_mask_lo) };
    assert_eq!((mask_a, mask_b), (0, 1));
    // the same result again: a no-op — but only with valid signatures (I-2); a different one: refused
    env.set_time(env.now() + 1);
    expect_anchor_err(submit_pair_result(&mut env, &a, &b, D2, a, &[&att_a]), "QuorumNotMet");
    submit_pair_result(&mut env, &a, &b, D2, a, &[&att_b]).unwrap();
    // (a win co-signed by both quorums does not fit a legacy transaction with the readings: v0 + lookup table)
    expect_anchor_err(submit_pair_result_v0(&mut env, &a, &b, D2, b, &[&att_a, &att_b]), "ConflictingPairResult");
    expect_anchor_err(submit_pair_result(&mut env, &a, &b, D2, Pubkey::default(), &[&att_a, &att_b]), "ConflictingPairResult");
}

/// M-1: after the loser rotates its attesters (its set no longer hashes to PairLink.attester_set_hash), its own quorum alone cannot
/// sign away its fuel — the partner's quorum must co-sign.
#[test]
fn m1_a_loser_that_rotated_its_attesters_needs_the_partner_to_co_sign() {
    let mut env = Env::new();
    let (att_a, att_b) = (Keypair::new(), Keypair::new());
    let (ca, cb) = paired_with(&mut env, &att_a, &att_b, buyback_rule(), buyback_rule());
    let (a, b) = (ca.mint, cb.mint);
    assert_eq!(pair_link(&env, &b).unwrap().attester_set_hash, burn_receipts::instructions::pair::attester_set_hash(&env.config(&config_pda(&b))));
    submit(&mut env, &a, D2, V1 + UNIT, &[&att_a]).unwrap();
    submit(&mut env, &b, D2, V1 + 2 * UNIT, &[&att_b]).unwrap();
    // B's set is rotated to a new key (what apply_attester_change leaves after 48 h).
    let rotated = Keypair::new();
    patch_config(&mut env, &b, |c| c.attesters[0] = burn_receipts::state::AttesterEntry::operator(rotated.pubkey()));
    expect_anchor_err(submit_pair_result(&mut env, &a, &b, D2, a, &[&rotated]), "QuorumNotMet");
    submit_pair_result_v0(&mut env, &a, &b, D2, a, &[&rotated, &att_a]).unwrap();
}

/// H-1(a) + L-2: a WIN is recorded only when forward_to_winner can serve it — both coins read the date and the loser's reading is
/// still unprocessed — and never for a date before the pairing. Pools are not required (a dead side forwards 0 lamports; see h1b).
/// (A draw has no reading conditions.)
#[test]
fn h1a_a_win_is_recorded_only_when_the_forward_can_run() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (a, b) = paired(&mut env, &att, buyback_rule(), buyback_rule());
    // before the pairing (the harness paired on 2026-10-09)
    expect_anchor_err(submit_pair_result(&mut env, &a.mint, &b.mint, 20261008, Pubkey::default(), &[&att]), "PairDateBeforePairing");
    // the winner has not read D2
    submit(&mut env, &b.mint, D2, V1 + 3 * UNIT, &[&att]).unwrap();
    expect_anchor_err(submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]), "PairResultNotServable");
    // the loser's reading is already processed (D1, the baseline)
    expect_anchor_err(submit_pair_result(&mut env, &a.mint, &b.mint, D1, a.mint, &[&att]), "PairResultNotServable");
    // the winner reads D2; its pool is not verified — the win is still servable (the forward will move 0 lamports)
    submit(&mut env, &a.mint, D2, V1 + UNIT, &[&att]).unwrap();
    patch_config(&mut env, &a.mint, |c| c.pool_verified = false);
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]).unwrap();
    let k = cranker(&mut env);
    let fb = env.lamports(&fee_pda(&b.mint));
    env.ok(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]);
    assert_eq!(env.lamports(&fee_pda(&b.mint)), fb, "a dead winner takes nothing: the loser keeps its fuel for later periods");
    assert_eq!(env.reading(&reading_pda(&config_pda(&b.mint), D2)).unwrap().outcome, OUTCOME_FORWARDED, "and the loser does not burn the period it lost");
    // a draw for D1 (no reading conditions) is accepted
    submit_pair_result(&mut env, &a.mint, &b.mint, D1, Pubkey::default(), &[&att]).unwrap();
}

/// Encoding round trip: the per-coin view, the signed message's exact text, the account layout through Anchor's (de)serializer.
#[test]
fn the_pair_result_encoding_round_trips() {
    use anchor_lang::{AccountDeserialize, AccountSerialize};
    let (a, b) = (Pubkey::new_unique(), Pubkey::new_unique());
    let (lo, hi) = burn_receipts::state::pair_order(&a, &b);
    assert!(lo.to_bytes() < hi.to_bytes());
    let mut r = PairResult {
        version: 1,
        bump: 254,
        mint_lo: lo,
        mint_hi: hi,
        record_date: D2,
        winner: hi,
        signers_mask_lo: 3,
        signers_mask_hi: 1,
        source_url_hash: [7; 32],
        proof_hash: [0; 32],
        submitted_at: 1_791_547_200,
        forwarded: true,
        forwarded_lamports: 123_456_789,
        forwarded_at: 1_791_550_000,
        reserved: [0; 32],
    };
    let mut buf = Vec::new();
    r.try_serialize(&mut buf).unwrap();
    assert_eq!(buf.len(), 8 + <PairResult as anchor_lang::Space>::INIT_SPACE);
    let back = PairResult::try_deserialize(&mut buf.as_slice()).unwrap();
    assert_eq!((back.winner, back.forwarded_lamports, back.record_date), (hi, 123_456_789, D2));
    assert_eq!((back.result_for(&hi), back.result_for(&lo), back.result_for(&Pubkey::new_unique())), (PAIR_RESULT_WON, PAIR_RESULT_LOST, PAIR_RESULT_NONE));
    r.winner = Pubkey::default();
    assert!(r.is_draw() && r.result_for(&lo) == PAIR_RESULT_DRAW && r.result_for(&hi) == PAIR_RESULT_DRAW);
    assert_eq!(r.other(&lo), hi);
    // the signed bytes
    let m = burn_receipts::attest::canonical_pair_message(&burn_receipts::ID, &lo, &hi, D2, &hi, &[0xab; 32], &[0; 32]);
    let expect = format!("BURNRECEIPTS-PAIR-v1|{}|{}|{}|{}|2026-10-11|winner={}|src={}|proof={}", CLUSTER_GENESIS_HASH, burn_receipts::ID, lo, hi, hi, "ab".repeat(32), "00".repeat(32));
    assert_eq!(m, expect);
    let d = burn_receipts::attest::canonical_pair_message(&burn_receipts::ID, &lo, &hi, D2, &Pubkey::default(), &[0xab; 32], &[0; 32]);
    assert!(d.contains("|winner=draw|"));
    assert_eq!((OUTCOME_FORWARDED, PAIR_RESULT_NONE, PAIR_RESULT_WON, PAIR_RESULT_LOST, PAIR_RESULT_DRAW), (6, 0, 1, 2, 3));
    assert_eq!(burn_receipts::memo::format_forward("DEBT", &lo, &hi, D2, 42), format!("DEBT|forward|from={}|to={}|period=2026-10-11|lamports=42|v1", &lo.to_string()[..12], &hi.to_string()[..12]));
}

#[test]
fn the_crank_gate_loser_refuses_winner_cranks_and_the_forward_moves_the_exact_formula_amount() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (a, b) = paired(&mut env, &att, buyback_rule(), buyback_rule());
    // odd balances: the loser's fee PDA gets an odd amount of lamports
    env.transfer_sol(&fee_pda(&b.mint), 3_141_592_653);
    submit(&mut env, &a.mint, D2, V1 + 21 * UNIT, &[&att]).unwrap();
    submit(&mut env, &b.mint, D2, V1 + 13 * UNIT + 7, &[&att]).unwrap();
    let k = cranker(&mut env);
    // a paired coin without its pair accounts, and with them but no result yet
    expect_anchor_err(env.send(&[cpmm::ix_crank_buyback(&k.pubkey(), &a.mint, &a.pool, D2)], &[&k]), "PairMismatch");
    expect_anchor_err(env.send(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &a.mint, &a.pool, D2, Some(b.mint))], &[&k]), "PairResultPending");
    expect_anchor_err(env.send(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]), "AccountNotInitialized");
    // a pair_result account of another period is refused
    submit_pair_result(&mut env, &a.mint, &b.mint, D1, Pubkey::default(), &[&att]).unwrap();
    let mut ix = cpmm::ix_crank_buyback_paired(&k.pubkey(), &a.mint, &a.pool, D2, Some(b.mint));
    let n = ix.accounts.len();
    ix.accounts[n - 3].pubkey = pair_result_pda(&a.mint, &b.mint, D1);
    expect_anchor_err(env.send(&[ix], &[&k]), "InvalidPairResult");

    submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]).unwrap();
    expect_anchor_err(env.send(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &b.mint, &b.pool, D2, Some(a.mint))], &[&k]), "ForwardRequired");
    // the winner is named: forwarding A → B (the winner as loser) is refused
    expect_anchor_err(env.send(&[ix_forward_to_winner(&k.pubkey(), &a.mint, &b.mint, D2)], &[&k]), "NotWinner");

    let (fa0, fb0) = (env.lamports(&fee_pda(&a.mint)), env.lamports(&fee_pda(&b.mint)));
    let expect = expected_forward(&env, &b.mint, D2);
    assert!(expect > 0);
    let meta = env.ok(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]);
    assert_eq!(env.lamports(&fee_pda(&a.mint)) - fa0, expect);
    assert_eq!(fb0 - env.lamports(&fee_pda(&b.mint)), expect);
    assert!(env.lamports(&fee_pda(&b.mint)) >= buyback_rule().reserve_lamports, "the reserve (rent) stays");
    let ev: ForwardedToWinner = event(&meta).unwrap();
    assert_eq!((ev.loser_mint, ev.winner_mint, ev.record_date, ev.units, ev.lamports, ev.sol_lamports, ev.wsol_lamports), (b.mint, a.mint, D2, 13, expect, expect, 0));
    let rb = env.reading(&reading_pda(&config_pda(&b.mint), D2)).unwrap();
    assert_eq!((rb.processed, rb.outcome, rb.rule_spend_lamports, rb.spent_lamports, rb.burned), (true, OUTCOME_FORWARDED, expect, 0, 0));
    assert_eq!(env.config(&config_pda(&b.mint)).crank_cursor, D2);
    let pr = pair_result(&env, &a.mint, &b.mint, D2).unwrap();
    assert!(pr.forwarded && pr.forwarded_lamports == expect && pr.forwarded_at > 0);
    let memo = burn_receipts::memo::format_forward("DEBT", &b.mint, &a.mint, D2, expect);
    assert!(meta.logs.iter().any(|l| l.contains(&memo)), "memo {memo}");
    println!("forward_to_winner: {} CU, {expect} lamports", meta.compute_units_consumed);
    // idempotent: a second call moves nothing; the loser's crank for that period stays refused (processed)
    env.ok(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]);
    assert_eq!(env.lamports(&fee_pda(&b.mint)), fb0 - expect);
    expect_anchor_err(env.send(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &b.mint, &b.pool, D2, Some(a.mint))], &[&k]), "AlreadyProcessed");
    // the winner cranks normally (not blocked by — and including — the forward)
    let supply = env.mint_supply(&a.mint);
    env.ok(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &a.mint, &a.pool, D2, Some(b.mint))], &[&k]);
    let ra = env.reading(&reading_pda(&config_pda(&a.mint), D2)).unwrap();
    assert_eq!(ra.outcome, OUTCOME_BURNED);
    assert!(ra.burned > 0 && env.mint_supply(&a.mint) == supply - ra.burned);
    assert_eq!(env.mint_supply(&b.mint), 1_000_000_000_000 * TOKEN, "the loser's supply is untouched");
}

#[test]
fn the_winner_may_crank_before_the_forward_arrives() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (a, b) = paired(&mut env, &att, buyback_rule(), buyback_rule());
    env.transfer_sol(&fee_pda(&b.mint), 5 * SOL);
    submit(&mut env, &a.mint, D2, V1 + 2 * UNIT, &[&att]).unwrap();
    submit(&mut env, &b.mint, D2, V1 + 3 * UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]).unwrap();
    let k = cranker(&mut env);
    env.ok(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &a.mint, &a.pool, D2, Some(b.mint))], &[&k]);
    let expect = expected_forward(&env, &b.mint, D2);
    let fa = env.lamports(&fee_pda(&a.mint));
    env.ok(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]);
    assert_eq!(env.lamports(&fee_pda(&a.mint)) - fa, expect, "the forward lands after the winner's crank; later cranks spend it");
}

#[test]
fn a_draw_forwards_nothing_and_both_coins_burn_their_own_fuel() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (a, b) = paired(&mut env, &att, buyback_rule(), buyback_rule());
    env.transfer_sol(&fee_pda(&a.mint), 2 * SOL);
    env.transfer_sol(&fee_pda(&b.mint), 2 * SOL);
    submit(&mut env, &a.mint, D2, V1 + 2 * UNIT, &[&att]).unwrap();
    submit(&mut env, &b.mint, D2, V1 + 2 * UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, Pubkey::default(), &[&att]).unwrap();
    let k = cranker(&mut env);
    expect_anchor_err(env.send(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]), "NotWinner");
    expect_anchor_err(env.send(&[ix_forward_to_winner(&k.pubkey(), &a.mint, &b.mint, D2)], &[&k]), "NotWinner");
    for (c, o) in [(&a, &b), (&b, &a)] {
        env.ok(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &c.mint, &c.pool, D2, Some(o.mint))], &[&k]);
        assert_eq!(env.reading(&reading_pda(&config_pda(&c.mint), D2)).unwrap().outcome, OUTCOME_BURNED);
    }
}

#[test]
fn without_a_result_the_crank_waits_72_hours_then_burns_as_unpaired_and_the_period_is_no_longer_forwardable() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (a, b) = paired(&mut env, &att, buyback_rule(), buyback_rule());
    env.transfer_sol(&fee_pda(&b.mint), 2 * SOL);
    submit(&mut env, &a.mint, D2, V1 + 2 * UNIT, &[&att]).unwrap();
    submit(&mut env, &b.mint, D2, V1 + 2 * UNIT, &[&att]).unwrap();
    let k = cranker(&mut env);
    let submitted = env.reading(&reading_pda(&config_pda(&b.mint), D2)).unwrap().submitted_at;
    env.set_time(submitted + PAIR_RESULT_GRACE_SECS - 1);
    expect_anchor_err(env.send(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &b.mint, &b.pool, D2, Some(a.mint))], &[&k]), "PairResultPending");
    env.set_time(submitted + PAIR_RESULT_GRACE_SECS);
    // keep the oracle fresh enough for the TWAP window
    cpmm::seed_history(&mut env, &b.pool, &b.mint);
    let meta = env.ok(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &b.mint, &b.pool, D2, Some(a.mint))], &[&k]);
    let ev: PairResultMissing = event(&meta).expect("PairResultMissing");
    assert_eq!((ev.mint, ev.record_date), (b.mint, D2));
    assert_eq!(env.reading(&reading_pda(&config_pda(&b.mint), D2)).unwrap().outcome, OUTCOME_BURNED);
    // a late result naming a winner is refused (the loser's reading is processed: L-2 — no moot "LOST" record); a draw is still fine
    expect_anchor_err(submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]), "PairResultNotServable");
    expect_anchor_err(env.send(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]), "AccountNotInitialized");
}

// =================================================================================================================================
// forward_to_winner amounts
// =================================================================================================================================

#[test]
fn the_forward_takes_sol_above_the_reserve_first_then_wsol() {
    let mut env = Env::new();
    let att = Keypair::new();
    let mut one_shot = buyback_rule();
    one_shot.fraction_per_unit_bps = 10_000;
    let (a, b) = paired(&mut env, &att, buyback_rule(), one_shot);
    let fb = fee_pda(&b.mint);
    let fb_wsol = get_associated_token_address(&fb, &NATIVE_MINT);
    // 0.3 SOL above the reserve as lamports, 1.7 SOL as WSOL
    env.transfer_sol(&fb, 300_000_001);
    let ixs = [
        anchor_lang::solana_program::system_instruction::transfer(&env.payer.pubkey(), &fb_wsol, 1_700_000_000),
        anchor_spl::token::spl_token::instruction::sync_native(&anchor_spl::token::ID, &fb_wsol).unwrap(),
    ];
    env.ok(&ixs, &[]);
    submit(&mut env, &a.mint, D2, V1 + UNIT, &[&att]).unwrap();
    submit(&mut env, &b.mint, D2, V1 + UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]).unwrap();
    let k = cranker(&mut env);
    let sol_above = env.lamports(&fb) - one_shot.reserve_lamports;
    let wsol = env.token_amount(&fb_wsol);
    let expect = expected_forward(&env, &b.mint, D2);
    assert_eq!(expect, sol_above + wsol, "a one-shot (f = 100 %) forwards the whole basis");
    let wa = get_associated_token_address(&fee_pda(&a.mint), &NATIVE_MINT);
    let (fa0, wa0) = (env.lamports(&fee_pda(&a.mint)), env.token_amount(&wa));
    let meta = env.ok(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]);
    let ev: ForwardedToWinner = event(&meta).unwrap();
    assert_eq!((ev.sol_lamports, ev.wsol_lamports), (sol_above, wsol));
    assert_eq!((env.lamports(&fee_pda(&a.mint)) - fa0, env.token_amount(&wa) - wa0), (sol_above, wsol));
    assert_eq!((env.lamports(&fb), env.token_amount(&fb_wsol)), (one_shot.reserve_lamports, 0), "only the reserve is left");
}

#[test]
fn a_one_shot_forwards_at_most_the_burn_pool_cap() {
    let mut env = Env::new();
    let att = Keypair::new();
    let mut one_shot = buyback_rule();
    one_shot.fraction_per_unit_bps = 10_000;
    let (a, b) = paired(&mut env, &att, buyback_rule(), one_shot);
    env.transfer_sol(&fee_pda(&b.mint), 30 * SOL + 12_345);
    submit(&mut env, &a.mint, D2, V1 + UNIT, &[&att]).unwrap();
    submit(&mut env, &b.mint, D2, V1 + UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]).unwrap();
    let k = cranker(&mut env);
    let fb0 = env.lamports(&fee_pda(&b.mint));
    env.ok(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]);
    assert_eq!(fb0 - env.lamports(&fee_pda(&b.mint)), DEFAULT_BURN_POOL_CAP_LAMPORTS, "the 25 SOL cap bounds the basis");
    let rb = env.reading(&reading_pda(&config_pda(&b.mint), D2)).unwrap();
    assert_eq!((rb.pool_lamports, rb.rule_spend_lamports), (DEFAULT_BURN_POOL_CAP_LAMPORTS, DEFAULT_BURN_POOL_CAP_LAMPORTS));
    assert!(rb.pool_actual_lamports > DEFAULT_BURN_POOL_CAP_LAMPORTS);
}

/// H-1(b): a side whose pool is not verified (switched away after the result, voided, never registered) forwards NOTHING — and the
/// loser's reading is still processed (OUTCOME_FORWARDED, lamports=0, memo written), so its queue moves on. The winner's reading is no
/// longer an account of forward_to_winner.
#[test]
fn h1b_a_dead_side_forwards_nothing_and_never_blocks_the_losers_queue() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (a, b) = paired(&mut env, &att, buyback_rule(), buyback_rule());
    env.transfer_sol(&fee_pda(&b.mint), SOL);
    submit(&mut env, &a.mint, D2, V1, &[&att]).unwrap();
    submit(&mut env, &b.mint, D2, V1 + 4 * UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]).unwrap();
    // after the result the winner's pool is switched away (apply_registration_policy clears pool_verified)
    patch_config(&mut env, &a.mint, |c| c.pool_verified = false);
    let k = cranker(&mut env);
    let (fa0, fb0) = (env.lamports(&fee_pda(&a.mint)), env.lamports(&fee_pda(&b.mint)));
    let meta = env.ok(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]);
    assert_eq!((env.lamports(&fee_pda(&a.mint)), env.lamports(&fee_pda(&b.mint))), (fa0, fb0), "nothing moves");
    let rb = env.reading(&reading_pda(&config_pda(&b.mint), D2)).unwrap();
    assert_eq!((rb.processed, rb.outcome, rb.rule_spend_lamports), (true, OUTCOME_FORWARDED, 0));
    assert!(meta.logs.iter().any(|l| l.contains("|forward|") && l.contains("|lamports=0|v1")));
    // B's queue moves on: its next period cranks as usual (a draw)
    submit(&mut env, &a.mint, D3, V1, &[&att]).unwrap();
    submit(&mut env, &b.mint, D3, V1 + 6 * UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a.mint, &b.mint, D3, Pubkey::default(), &[&att]).unwrap();
    cpmm::seed_history(&mut env, &b.pool, &b.mint);
    env.ok(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &b.mint, &b.pool, D3, Some(a.mint))], &[&k]);
    assert_eq!(env.reading(&reading_pda(&config_pda(&b.mint), D3)).unwrap().outcome, OUTCOME_BURNED);
}

/// H-1(c): a LOST period whose forward never lands (any precondition that might ever fail) times out: PAIR_RESULT_GRACE_SECS after
/// the reading, the loser cranks as unpaired and PairForwardMissing is emitted — no result can wedge a queue.
#[test]
fn h1c_a_lost_period_without_a_forward_times_out_after_72_hours() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (a, b) = paired(&mut env, &att, buyback_rule(), buyback_rule());
    env.transfer_sol(&fee_pda(&b.mint), 2 * SOL);
    submit(&mut env, &a.mint, D2, V1, &[&att]).unwrap();
    submit(&mut env, &b.mint, D2, V1 + 3 * UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]).unwrap();
    let k = cranker(&mut env);
    let submitted = env.reading(&reading_pda(&config_pda(&b.mint), D2)).unwrap().submitted_at;
    env.set_time(submitted + PAIR_RESULT_GRACE_SECS - 1);
    expect_anchor_err(env.send(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &b.mint, &b.pool, D2, Some(a.mint))], &[&k]), "ForwardRequired");
    env.set_time(submitted + PAIR_RESULT_GRACE_SECS);
    cpmm::seed_history(&mut env, &b.pool, &b.mint);
    let meta = env.ok(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &b.mint, &b.pool, D2, Some(a.mint))], &[&k]);
    let ev: burn_receipts::events::PairForwardMissing = event(&meta).expect("PairForwardMissing");
    assert_eq!((ev.mint, ev.record_date), (b.mint, D2));
    assert_eq!(env.reading(&reading_pda(&config_pda(&b.mint), D2)).unwrap().outcome, OUTCOME_BURNED);
    // the period can no longer be forwarded
    expect_anchor_err(env.send(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]), "AlreadyProcessed");
}

/// M-2: unlink_pair on evidence — a coin still without a verified pool 30 days after the pairing — returns both coins to plain coins
/// (pair_state NONE, PairLinks closed to the fee PDAs); refused while both are live / before the 30 days.
#[test]
fn m2_unlink_pair_on_evidence_returns_both_coins_to_plain() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (ka, kb) = (Keypair::new(), Keypair::new());
    init(&mut env, &ka, &att.pubkey(), buyback_rule(), Some((kb.pubkey(), false))).unwrap();
    init(&mut env, &kb, &att.pubkey(), buyback_rule(), Some((ka.pubkey(), true))).unwrap();
    let a = market(&mut env, &ka); // B never gets a pool
    let k = cranker(&mut env);
    let paired_at = pair_link(&env, &a.mint).unwrap().paired_at;
    expect_anchor_err(env.send(&[ix_unlink_pair(&k.pubkey(), &a.mint, &kb.pubkey(), None)], &[&k]), "PairStillLive");
    env.set_time(paired_at + PAIR_UNLINK_NOT_LIVE_SECS);
    let (fa, fb) = (env.lamports(&fee_pda(&a.mint)), env.lamports(&fee_pda(&kb.pubkey())));
    let link_rent = env.lamports(&pair_link_pda(&a.mint));
    let meta = env.ok(&[ix_unlink_pair(&k.pubkey(), &a.mint, &kb.pubkey(), None)], &[&k]);
    let ev: burn_receipts::events::PairUnlinked = event(&meta).expect("PairUnlinked");
    assert_eq!(ev.reason, UNLINK_NOT_LIVE);
    for m in [a.mint, kb.pubkey()] {
        assert_eq!(env.config(&config_pda(&m)).pair_state, PAIR_STATE_NONE);
        assert!(pair_link(&env, &m).is_none(), "PairLink closed");
    }
    assert_eq!(env.lamports(&fee_pda(&a.mint)) - fa, link_rent, "the link's rent goes to the coin's own fee PDA");
    assert!(env.lamports(&fee_pda(&kb.pubkey())) > fb);
    // A cranks as a plain coin (no pair accounts)
    submit(&mut env, &a.mint, D1, V1, &[&att]).unwrap();
    submit(&mut env, &a.mint, D2, V1 + 2 * UNIT, &[&att]).unwrap();
    env.transfer_sol(&fee_pda(&a.mint), SOL);
    cpmm::seed_history(&mut env, &a.pool, &a.mint);
    env.ok(&[cpmm::ix_crank_buyback(&k.pubkey(), &a.mint, &a.pool, D2)], &[&k]);
}

/// L-4: WSOL lamports sent to the loser's WSOL account without a SyncNative count in the forward's basis exactly as in the crank's.
#[test]
fn l4_unsynced_wsol_counts_in_the_forward_basis() {
    let mut env = Env::new();
    let att = Keypair::new();
    let mut one_shot = buyback_rule();
    one_shot.fraction_per_unit_bps = 10_000;
    let (a, b) = paired(&mut env, &att, buyback_rule(), one_shot);
    let fb_wsol = get_associated_token_address(&fee_pda(&b.mint), &NATIVE_MINT);
    env.transfer_sol(&fb_wsol, 700_000_000); // no SyncNative
    submit(&mut env, &a.mint, D2, V1, &[&att]).unwrap();
    submit(&mut env, &b.mint, D2, V1 + UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]).unwrap();
    let k = cranker(&mut env);
    let sol_above = env.lamports(&fee_pda(&b.mint)) - one_shot.reserve_lamports;
    let meta = env.ok(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]);
    let ev: ForwardedToWinner = event(&meta).unwrap();
    assert_eq!((ev.sol_lamports, ev.wsol_lamports), (sol_above, 700_000_000), "the unsynced WSOL is part of the one-shot's basis and moves");
}

/// onEnd wind-down (§40 item 3): when the loser's rule ends, its sweep / wind-down readings are forwarded like any period while the
/// winner is live — a result naming the winner for that date, a (flat) winner reading for the same date, then forward_to_winner.
#[test]
fn the_losers_wind_down_sweep_is_forwarded_to_the_live_winner() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (a, b) = paired(&mut env, &att, buyback_rule(), buyback_rule());
    env.transfer_sol(&fee_pda(&b.mint), 4 * SOL + 777);
    // period D2: B lost
    submit(&mut env, &a.mint, D2, V1 + UNIT, &[&att]).unwrap();
    submit(&mut env, &b.mint, D2, V1 + 5 * UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]).unwrap();
    let k = cranker(&mut env);
    env.ok(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]);
    // B's rule ends: the keeper's sweep reading (units) on D3; A reads D3 flat; the result names A.
    env.set_time(env.now() + 86_400);
    submit(&mut env, &b.mint, D3, V1 + 25 * UNIT, &[&att]).unwrap();
    submit(&mut env, &a.mint, D3, V1 + UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a.mint, &b.mint, D3, a.mint, &[&att]).unwrap();
    let expect = expected_forward(&env, &b.mint, D3);
    let fa = env.lamports(&fee_pda(&a.mint));
    env.ok(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D3)], &[&k]);
    assert_eq!(env.lamports(&fee_pda(&a.mint)) - fa, expect);
    assert_eq!(env.config(&config_pda(&b.mint)).crank_cursor, D3);
}

#[test]
fn unpaired_and_provisional_coins_crank_without_pair_accounts() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (ka, kb) = (Keypair::new(), Keypair::new());
    init(&mut env, &ka, &att.pubkey(), buyback_rule(), Some((kb.pubkey(), false))).unwrap(); // provisional forever
    let a = market(&mut env, &ka);
    submit(&mut env, &a.mint, D1, V1, &[&att]).unwrap();
    submit(&mut env, &a.mint, D2, V1 + 3 * UNIT, &[&att]).unwrap();
    env.transfer_sol(&fee_pda(&a.mint), SOL);
    let k = cranker(&mut env);
    env.ok(&[cpmm::ix_crank_buyback(&k.pubkey(), &a.mint, &a.pool, D2)], &[&k]);
    assert_eq!(env.reading(&reading_pda(&config_pda(&a.mint), D2)).unwrap().outcome, OUTCOME_BURNED);
}
