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

const D1: u32 = 20261005;
const D2: u32 = 20261006;
const D3: u32 = 20261007;
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
    let (ka, kb) = (Keypair::new(), Keypair::new());
    init(env, &ka, &attester.pubkey(), rule_a, Some((kb.pubkey(), false))).unwrap();
    init(env, &kb, &attester.pubkey(), rule_b, Some((ka.pubkey(), true))).unwrap();
    let a = market(env, &ka);
    let b = market(env, &kb);
    submit(env, &a.mint, D1, V1, &[attester]).unwrap();
    submit(env, &b.mint, D1, V1, &[attester]).unwrap();
    (a, b)
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
    // A third coin naming A (already paired) as partner-first: refused.
    let kc = Keypair::new();
    expect_anchor_err(init(&mut env, &kc, &att.pubkey(), buyback_rule(), Some((ka.pubkey(), true))), "PairMismatch");
    // ... and naming A without partner accounts is only a provisional link that can never be answered (A is taken).
    init(&mut env, &kc, &att.pubkey(), buyback_rule(), Some((ka.pubkey(), false))).unwrap();
    assert_eq!(env.config(&config_pda(&kc.pubkey())).pair_state, PAIR_STATE_PROVISIONAL);
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

#[test]
fn a_pair_result_needs_both_quorums_paired_coins_one_winner_and_never_changes() {
    let mut env = Env::new();
    let (att_a, att_b) = (Keypair::new(), Keypair::new());
    let (ka, kb, kc) = (Keypair::new(), Keypair::new(), Keypair::new());
    init(&mut env, &ka, &att_a.pubkey(), buyback_rule(), Some((kb.pubkey(), false))).unwrap();
    init(&mut env, &kb, &att_b.pubkey(), buyback_rule(), Some((ka.pubkey(), true))).unwrap();
    init(&mut env, &kc, &att_a.pubkey(), buyback_rule(), None).unwrap();
    let (a, b) = (ka.pubkey(), kb.pubkey());
    // one coin's quorum alone is not enough
    expect_anchor_err(submit_pair_result(&mut env, &a, &b, D2, a, &[&att_a]), "QuorumNotMet");
    expect_anchor_err(submit_pair_result(&mut env, &a, &b, D2, a, &[&att_b]), "QuorumNotMet");
    // a winner outside the pair
    expect_anchor_err(submit_pair_result(&mut env, &a, &b, D2, Pubkey::new_unique(), &[&att_a, &att_b]), "InvalidWinner");
    // the configs out of byte order
    let (lo, hi) = burn_receipts::state::pair_order(&a, &b);
    let msg = pair_message(&a, &b, D2, &a, src_hash(), [0u8; 32]);
    let entries = vec![(att_a.pubkey(), sign(&att_a, &msg)), (att_b.pubkey(), sign(&att_b, &msg))];
    let mut ix = ix_submit_pair_result(&env.payer.pubkey(), &a, &b, D2, a, src_hash(), [0u8; 32]);
    // swap config_lo/config_hi and link_lo/link_hi (seeds stay consistent per account, the order check refuses)
    ix.accounts.swap(1, 2);
    ix.accounts.swap(3, 4);
    ix.accounts[5].pubkey = Pubkey::find_program_address(&[PAIR_RESULT_SEED, hi.as_ref(), lo.as_ref(), &D2.to_le_bytes()], &burn_receipts::ID).0;
    expect_anchor_err(env.send(&[ed25519_shared(&entries, &msg), ix], &[]), "PairOrder");
    // unpaired coins
    let c = kc.pubkey();
    expect_anchor_err(submit_pair_result(&mut env, &a, &c, D2, a, &[&att_a]), "AccountNotInitialized");
    // a future date
    expect_anchor_err(submit_pair_result(&mut env, &a, &b, 20991231, a, &[&att_a, &att_b]), "FutureDate");
    // the result, signed by both quorums
    submit_pair_result(&mut env, &a, &b, D2, b, &[&att_a, &att_b]).unwrap();
    let r = pair_result(&env, &a, &b, D2).unwrap();
    assert_eq!((r.mint_lo, r.mint_hi, r.record_date, r.winner, r.forwarded), (lo, hi, D2, b, false));
    assert_eq!((r.result_for(&a), r.result_for(&b), r.result_for(&c)), (PAIR_RESULT_LOST, PAIR_RESULT_WON, PAIR_RESULT_NONE));
    assert!(r.signers_mask_lo == 1 && r.signers_mask_hi == 1);
    // the same result again: a no-op; a different one: refused
    env.set_time(env.now() + 1);
    submit_pair_result(&mut env, &a, &b, D2, b, &[&att_a, &att_b]).unwrap();
    expect_anchor_err(submit_pair_result(&mut env, &a, &b, D2, a, &[&att_a, &att_b]), "ConflictingPairResult");
    expect_anchor_err(submit_pair_result(&mut env, &a, &b, D2, Pubkey::default(), &[&att_a, &att_b]), "ConflictingPairResult");
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
    let expect = format!("BURNRECEIPTS-PAIR-v1|{}|{}|{}|{}|2026-10-06|winner={}|src={}|proof={}", CLUSTER_GENESIS_HASH, burn_receipts::ID, lo, hi, hi, "ab".repeat(32), "00".repeat(32));
    assert_eq!(m, expect);
    let d = burn_receipts::attest::canonical_pair_message(&burn_receipts::ID, &lo, &hi, D2, &Pubkey::default(), &[0xab; 32], &[0; 32]);
    assert!(d.contains("|winner=draw|"));
    assert_eq!((OUTCOME_FORWARDED, PAIR_RESULT_NONE, PAIR_RESULT_WON, PAIR_RESULT_LOST, PAIR_RESULT_DRAW), (6, 0, 1, 2, 3));
    assert_eq!(burn_receipts::memo::format_forward("DEBT", &lo, &hi, D2, 42), format!("DEBT|forward|from={}|to={}|period=2026-10-06|lamports=42|v1", &lo.to_string()[..12], &hi.to_string()[..12]));
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
    submit_pair_result(&mut env, &a.mint, &b.mint, D1, a.mint, &[&att]).unwrap();
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
    // a late result can no longer forward that period
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]).unwrap();
    expect_anchor_err(env.send(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]), "AlreadyProcessed");
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

#[test]
fn the_forward_needs_the_winners_reading_for_the_same_period_and_both_sides_live() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (a, b) = paired(&mut env, &att, buyback_rule(), buyback_rule());
    env.transfer_sol(&fee_pda(&b.mint), SOL);
    submit(&mut env, &b.mint, D2, V1 + UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]).unwrap();
    let k = cranker(&mut env);
    // the winner has not read D2
    expect_anchor_err(env.send(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]), "AccountNotInitialized");
    submit(&mut env, &a.mint, D2, V1, &[&att]).unwrap(); // a flat reading (0 units) is enough
    // a coin without a verified pool forwards nothing
    let key = config_pda(&a.mint);
    let mut cfg = env.config(&key);
    cfg.pool_verified = false;
    let mut acc = env.svm.get_account(&key).unwrap();
    let mut data = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(&cfg, &mut data).unwrap();
    acc.data[..data.len()].copy_from_slice(&data);
    env.svm.set_account(key, acc.clone()).unwrap();
    expect_anchor_err(env.send(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]), "PairSideNotLive");
    cfg.pool_verified = true;
    let mut data = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(&cfg, &mut data).unwrap();
    acc.data[..data.len()].copy_from_slice(&data);
    env.svm.set_account(key, acc).unwrap();
    env.ok(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]);
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
