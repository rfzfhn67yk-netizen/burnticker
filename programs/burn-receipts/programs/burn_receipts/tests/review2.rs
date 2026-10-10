//! Blind review 2 (2026-10-10, docs/burn-receipts/CHANGELOG.md): the reviewer's six proofs of concept (`poc_*`, ported from the
//! review's scratch suite and now asserting the FIXED behaviour) plus one closing test per finding.

// LiteSVM's FailedTransactionMetadata is large by design; test helpers take many accounts.
#![allow(clippy::result_large_err, clippy::too_many_arguments)]

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::{AnchorDeserialize, Discriminator};
use anchor_spl::associated_token::get_associated_token_address;
use burn_receipts::constants::*;
use burn_receipts::events::*;
use burn_receipts::state::{AttesterEntry, RuleParams};
use common::cpmm::{self, Pool};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

const V1: u64 = 4_027_300_000_000_000;
const D1: u32 = 20261001;
const D2: u32 = 20261002;
const D3: u32 = 20261003;
const D4: u32 = 20261004;

struct Mkt {
    mint: Pubkey,
    att: Keypair,
    pool: Pool,
    launcher: Keypair,
    trader: Keypair,
}

/// init → fixed-supply mint → LaunchLab-shaped migration (fee-PDA creator, LP locked, LaunchLab pool + platform) → register → fee
/// PDA ATAs → ≈ 900 s of balanced trades.
fn mkt_with(env: &mut Env, rule: RuleParams, mint_kp: Keypair) -> Mkt {
    let (creator, att) = (Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint_kp.pubkey(), init_args(rule, vec![att.pubkey()], 1))], &[&creator, &mint_kp]);
    let mint = mint_kp.pubkey();
    env.create_mint(&mint_kp, &payer, DECIMALS);
    let launcher = Keypair::new();
    env.fund(&launcher.pubkey(), 1_000 * SOL);
    let amm = cpmm::setup_amm(env, &launcher.pubkey());
    let lt = env.create_ata(&launcher.pubkey(), &mint);
    let me = env.payer.insecure_clone();
    env.mint_to(&mint, &me, &lt, 800_000_000 * TOKEN);
    let pool = cpmm::create_pool(env, &launcher, &amm, &mint, &fee_pda(&mint), 85 * SOL, 800_000_000 * TOKEN, &lt);
    cpmm::launchlab_migrated(env, &mint, &pool);
    env.ok(&[ix_register_pool(&payer, &mint, &pool.pool)], &[]);
    env.create_ata(&fee_pda(&mint), &NATIVE_MINT);
    env.create_ata(&fee_pda(&mint), &mint);
    let trader = cpmm::seed_history(env, &pool, &mint);
    Mkt { mint, att, pool, launcher, trader }
}

fn mkt(env: &mut Env, rule: RuleParams) -> Mkt {
    mkt_with(env, rule, Keypair::new())
}

fn set_pool_status(env: &mut Env, pool: &Pubkey, status: u8) {
    let mut acc = env.svm.get_account(pool).unwrap();
    acc.data[329] = status;
    env.svm.set_account(*pool, acc).unwrap();
}

fn find_event<T: AnchorDeserialize + Discriminator>(meta: &litesvm::types::TransactionMetadata) -> Option<T> {
    events(meta).into_iter().find(|(d, _)| d[..] == T::DISCRIMINATOR[..]).map(|(_, p)| T::try_from_slice(&p).unwrap())
}

fn check(env: &mut Env, mint: &Pubkey, pool: &Pool) -> litesvm::types::TransactionMetadata {
    let ix = ix_check_pool_health(&env.payer.pubkey(), mint, &pool.pool, &pool.wsol_vault());
    env.ok(&[ix], &[])
}

// ================================================================================================================================
// The reviewer's proofs of concept
// ================================================================================================================================

/// F2 — PoC: quorum 2 of 3, a proposal keeping 2 old keys and adding 3 new ones would let the NEW keys alone sign. Now refused; a
/// proposal may add only fewer keys than the new quorum, so every quorum-sized subset holds a current key.
#[test]
fn poc_single_proposal_gives_new_keys_quorum() {
    let mut env = Env::new();
    let (mint_kp, creator) = (Keypair::new(), Keypair::new());
    let old: Vec<Keypair> = (0..3).map(|_| Keypair::new()).collect();
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint_kp.pubkey(), init_args(vault_rule(), old.iter().map(|k| k.pubkey()).collect(), 2))], &[&creator, &mint_kp]);
    let mint = mint_kp.pubkey();
    env.create_mint(&mint_kp, &payer, DECIMALS);
    submit(&mut env, &mint, D1, V1, &[&old[0], &old[1]]).unwrap();
    env.set_time(env.now() + ATTESTER_SENIORITY_SECS); // review-3 L-2: kept keys must be ≥ 7 days old to add keys
    let new: Vec<Keypair> = (0..3).map(|_| Keypair::new()).collect();
    let op = |k: &Keypair| AttesterEntry::operator(k.pubkey());
    // The reviewer's proposal: keep 2 (= quorum), add 3 → refused.
    let set = vec![op(&old[0]), op(&old[1]), op(&new[0]), op(&new[1]), op(&new[2])];
    expect_anchor_err(env.send(&[ix_admin("propose", &creator.pubkey(), &mint, set, 2)], &[&creator]), "TooManyAttestersReplaced");
    // Adding 2 at quorum 2 is refused too (2 new keys would be a quorum on their own) …
    let set = vec![op(&old[0]), op(&old[1]), op(&old[2]), op(&new[0]), op(&new[1])];
    expect_anchor_err(env.send(&[ix_admin("propose", &creator.pubkey(), &mint, set, 2)], &[&creator]), "TooManyAttestersReplaced");
    // … adding 1 is fine.
    let set = vec![op(&old[0]), op(&old[1]), op(&old[2]), op(&new[0])];
    env.ok(&[ix_admin("propose", &creator.pubkey(), &mint, set, 2)], &[&creator]);
    env.set_time(env.now() + ATTESTER_TIMELOCK_SECS);
    env.ok(&[ix_apply(&payer, &mint)], &[]);
    // The new key alone is never a quorum; with any current key it is.
    expect_anchor_err(submit(&mut env, &mint, D2, V1 + 5 * UNIT, &[&new[0]]), "QuorumNotMet");
    submit(&mut env, &mint, D2, V1 + 5 * UNIT, &[&new[0], &old[2]]).unwrap();
    // Raising the quorum lets more keys in at once, still fewer than the new quorum: 2 new of a 3-of-5 set.
    let set = vec![op(&old[0]), op(&old[1]), op(&new[0]), op(&new[1]), op(&new[2])];
    env.ok(&[ix_admin("propose", &creator.pubkey(), &mint, set, 3)], &[&creator]);
}

/// F3 — PoC: one lamport sent straight to the fee PDA's WSOL account used to make every wrapping crank fail its post-swap check.
/// The crank now measures the synced balance and syncs before the swap: it burns, and the stray lamport joins the pool.
#[test]
fn poc_stray_lamport_on_fee_wsol_blocks_crank() {
    let mut env = Env::new();
    let m = mkt(&mut env, buyback_rule());
    let fee = fee_pda(&m.mint);
    let fee_wsol = get_associated_token_address(&fee, &NATIVE_MINT);
    env.transfer_sol(&fee, 10 * SOL);
    submit(&mut env, &m.mint, D1, V1, &[&m.att]).unwrap();
    submit(&mut env, &m.mint, D2, V1 + 3 * UNIT, &[&m.att]).unwrap();
    // griefer: 1 lamport, no SyncNative
    env.ok(&[anchor_lang::solana_program::system_instruction::transfer(&env.payer.pubkey(), &fee_wsol, 1)], &[]);
    let pool_expected = env.lamports(&fee) - buyback_rule().reserve_lamports + 1;
    let payer = env.payer.pubkey();
    env.ok(&[cpmm::ix_crank_buyback(&payer, &m.mint, &m.pool, D2)], &[]);
    let r = env.reading(&reading_pda(&config_pda(&m.mint), D2)).unwrap();
    assert_eq!(r.outcome, OUTCOME_BURNED);
    assert_eq!(r.pool_actual_lamports, pool_expected, "the stray lamport is part of the pool");
    // And with WSOL already covering the spend (no wrap needed) plus a stray lamport, the crank still syncs and burns.
    env.ok(
        &[
            anchor_lang::solana_program::system_instruction::transfer(&env.payer.pubkey(), &fee_wsol, 5 * SOL),
            anchor_spl::token::spl_token::instruction::sync_native(&anchor_spl::token::ID, &fee_wsol).unwrap(),
            anchor_lang::solana_program::system_instruction::transfer(&env.payer.pubkey(), &fee_wsol, 1),
        ],
        &[],
    );
    submit(&mut env, &m.mint, D3, V1 + 4 * UNIT, &[&m.att]).unwrap();
    env.set_time(env.now() + 1_200);
    env.ok(&[cpmm::ix_crank_buyback(&payer, &m.mint, &m.pool, D3)], &[]);
    assert_eq!(env.reading(&reading_pda(&config_pda(&m.mint), D3)).unwrap().outcome, OUTCOME_BURNED);
}

/// F6 — PoC: flagged once, healthy for a week with nobody checking, one bad moment → replaced. Now refused: the 7 days must be
/// continuous (an untradeable observation at least every 24 h). With daily observations the replacement goes through. F9: each
/// reading keeps the pool it was processed against.
#[test]
fn poc_replace_after_intermittent_untradeability() {
    let mut env = Env::new();
    let m = mkt(&mut env, buyback_rule());
    let payer = env.payer.pubkey();
    // A burn on the original pool first (F9: the reading records it).
    env.transfer_sol(&fee_pda(&m.mint), 10 * SOL);
    submit(&mut env, &m.mint, D1, V1, &[&m.att]).unwrap();
    submit(&mut env, &m.mint, D2, V1 + UNIT, &[&m.att]).unwrap();
    env.ok(&[cpmm::ix_crank_buyback(&payer, &m.mint, &m.pool, D2)], &[]);
    assert_eq!(env.reading(&reading_pda(&config_pda(&m.mint), D2)).unwrap().pool, m.pool.pool);

    set_pool_status(&mut env, &m.pool.pool, 4);
    let f = find_event::<PoolUntradeableFlagged>(&check(&mut env, &m.mint, &m.pool)).unwrap();
    // Review-3 L-3: one observation is a candidate, not a spell.
    assert!(!f.restarted && f.since == 0 && f.candidate_at == env.now());
    let since = f.candidate_at;
    set_pool_status(&mut env, &m.pool.pool, 0);
    // a week of normal trading, nobody calls check_pool_health
    cpmm::seed_history(&mut env, &m.pool, &m.mint);
    // a second migration-shaped pool exists, and the LaunchLab platform names its AmmConfig
    let amm1 = cpmm::create_amm_config(&mut env, 1);
    let lt = get_associated_token_address(&m.launcher.pubkey(), &m.mint);
    let me = env.payer.insecure_clone();
    env.mint_to(&m.mint, &me, &lt, 400_000_000 * TOKEN);
    let launcher = m.launcher.insecure_clone();
    let new_pool = cpmm::create_pool(&mut env, &launcher, &amm1, &m.mint, &fee_pda(&m.mint), 40 * SOL, 400_000_000 * TOKEN, &lt);
    cpmm::set_platform_cp_config(&mut env, &amm1);
    env.set_time(since + POOL_REPLACEMENT_DELAY_SECS + 1);
    set_pool_status(&mut env, &m.pool.pool, 4); // one moment of untradeability
    let replace = |env: &mut Env| {
        let ix = ix_replace_pool(&env.payer.pubkey(), &m.mint, &m.pool.pool, &m.pool.wsol_vault(), &new_pool.pool, &new_pool.wsol_vault());
        env.send(&[ix], &[])
    };
    expect_anchor_err(replace(&mut env), "PoolStillTradeable");
    // The next observation is a fresh candidate (the old one is a week old) …
    let f = find_event::<PoolUntradeableFlagged>(&check(&mut env, &m.mint, &m.pool)).unwrap();
    assert!(!f.restarted && f.since == 0);
    let start = f.candidate_at;
    // … a gap of more than 24 h makes another fresh candidate …
    env.set_time(start + UNTRADEABLE_MAX_GAP_SECS + 1);
    let f = find_event::<PoolUntradeableFlagged>(&check(&mut env, &m.mint, &m.pool)).unwrap();
    assert!(!f.restarted && f.since == 0 && f.candidate_at == start + UNTRADEABLE_MAX_GAP_SECS + 1);
    let start = f.candidate_at;
    // … and daily observations start the spell (dated from the candidate) and keep it continuous for 7 days.
    for day in 1..=7 {
        env.set_time(start + day * 86_400);
        let f = find_event::<PoolUntradeableFlagged>(&check(&mut env, &m.mint, &m.pool)).unwrap();
        assert!(f.restarted == (day == 1) && f.since == start && f.observed_at == env.now());
    }
    env.set_time(start + POOL_REPLACEMENT_DELAY_SECS + 60);
    replace(&mut env).unwrap();
    let c = env.config(&config_pda(&m.mint));
    assert_eq!((c.cpmm_pool, c.pool_untradeable_since, c.pool_untradeable_last_seen, c.pool_verified), (new_pool.pool, 0, 0, true));
    // F9: a burn on the new pool records the new pool; the old reading still names the old one.
    cpmm::seed_history(&mut env, &new_pool, &m.mint);
    submit(&mut env, &m.mint, D3, V1 + 2 * UNIT, &[&m.att]).unwrap();
    env.ok(&[cpmm::ix_crank_buyback(&payer, &m.mint, &new_pool, D3)], &[]);
    let cfg = config_pda(&m.mint);
    assert_eq!(env.reading(&reading_pda(&cfg, D3)).unwrap().pool, new_pool.pool);
    assert_eq!(env.reading(&reading_pda(&cfg, D2)).unwrap().pool, m.pool.pool);
}

fn sizes_for(env: &Env, mint: &Pubkey, att: &[Keypair], n: usize) -> (usize, usize) {
    let payer = env.payer.pubkey();
    let msg = message(mint, 20261008, 20261009, 4_030_531_621_082_972);
    let dup: Vec<_> = att[..n].iter().map(|k| (k.pubkey(), sign(k, &msg), msg.clone())).collect();
    let shared: Vec<_> = att[..n].iter().map(|k| (k.pubkey(), sign(k, &msg))).collect();
    let sub = ix_submit(&payer, mint, 20261009, 4_030_531_621_082_972);
    let cb = compute_budget(400_000);
    (env.legacy_size(&[cb.clone(), ed25519_ix(&dup), sub.clone()]), env.legacy_size(&[cb, ed25519_shared(&shared, &msg), sub]))
}

/// F4 — PoC: transaction size by quorum. The per-signature message copies made quorum 2 a 1,300+-byte transaction (limit 1,232).
/// The shared-message layout fits quorum 1–3 in a LEGACY transaction; quorum 4–5 is refused at init; a v0 transaction with an
/// address lookup table is smaller still. Every transaction the harness sends is size-asserted (Env::send / Env::send_v0).
#[test]
fn poc_submit_tx_size_by_quorum() {
    let mut env = Env::new();
    let (mint_kp, creator) = (Keypair::new(), Keypair::new());
    let att: Vec<Keypair> = (0..5).map(|_| Keypair::new()).collect();
    let payer = env.payer.pubkey();
    for q in [4u8, 5] {
        let r = env.send(&[ix_initialize(&payer, &creator.pubkey(), &mint_kp.pubkey(), init_args(vault_rule(), att.iter().map(|k| k.pubkey()).collect(), q))], &[&creator, &mint_kp]);
        expect_anchor_err(r, "InvalidAttesters");
    }
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint_kp.pubkey(), init_args(vault_rule(), att.iter().map(|k| k.pubkey()).collect(), MAX_QUORUM))], &[&creator, &mint_kp]);
    let mint = mint_kp.pubkey();
    let msg = message(&mint, 20261008, 20261009, 4_030_531_621_082_972);
    println!("canonical v3 message: {} bytes", msg.len());
    let mut shared_sizes = vec![];
    for n in 1..=5 {
        let (dup, shared) = sizes_for(&env, &mint, &att, n);
        println!("{n} signatures: message-per-signature {dup} B; shared message {shared} B (legacy limit {PACKET_DATA_SIZE})");
        shared_sizes.push(shared);
        if n == 2 {
            assert!(dup > PACKET_DATA_SIZE, "the old layout's quorum-2 transaction did not fit ({dup} B)");
        }
    }
    assert!(shared_sizes[..MAX_QUORUM as usize].iter().all(|s| *s <= PACKET_DATA_SIZE), "{shared_sizes:?}");
    // A quorum-3 reading lands in a legacy transaction (Env::send asserts the size) …
    submit(&mut env, &mint, D1, V1, &[&att[0], &att[1], &att[2]]).unwrap();
    // … and in a v0 transaction through a lookup table (config, instructions sysvar, system program, event authority).
    let config = config_pda(&mint);
    let alt = env.create_lookup_table(&[config, solana_instructions_sysvar::ID, anchor_lang::solana_program::system_program::ID, event_authority()]);
    let m2 = message(&mint, D1, D2, V1 + UNIT);
    let e: Vec<_> = att[..3].iter().map(|k| (k.pubkey(), sign(k, &m2))).collect();
    let ixs = [ed25519_shared(&e, &m2), ix_submit(&payer, &mint, D2, V1 + UNIT)];
    let legacy = env.legacy_size(&[vec![compute_budget(1_400_000)], ixs.to_vec()].concat());
    let meta = env.send_v0(&ixs, &[], &[alt]).unwrap();
    assert_eq!(env.reading(&reading_pda(&config, D2)).unwrap().units, 1);
    println!("quorum 3 via v0 + lookup table: accepted (legacy equivalent {legacy} B); CU {}", meta.compute_units_consumed);
}

/// Worst-case compute (review 2 measured 124,680 CU): a full 100-entry oracle ring scanned, ≈ 9.2e18 units, a 1,200 s window and
/// a PlatformConfig present.
#[test]
fn poc_crank_buyback_worst_case_cu() {
    let mut env = Env::new();
    let rule = RuleParams { unit_value: 1, max_abs_delta: i64::MAX as u64, twap_window_secs: 1_200, ..buyback_rule() };
    let auth = Pubkey::new_unique();
    env.init_platform(&auth, DEFAULT_BURN_POOL_CAP_LAMPORTS);
    let m = mkt(&mut env, rule);
    // fill the ring: 110 balanced swaps 16 s apart
    let mut now = env.now();
    for i in 0..110 {
        now += 16;
        env.set_time(now);
        cpmm::swap(&mut env, &m.trader, &m.pool, &m.mint, i % 2 == 0, if i % 2 == 0 { SOL / 10 } else { 940_000 * TOKEN }).unwrap();
    }
    env.set_time(now + 30);
    env.transfer_sol(&fee_pda(&m.mint), 5 * SOL);
    submit(&mut env, &m.mint, D1, 1, &[&m.att]).unwrap();
    let meta = submit(&mut env, &m.mint, D2, i64::MAX as u64, &[&m.att]).unwrap();
    println!("submit_reading (quorum 1) CU: {}", meta.compute_units_consumed);
    let payer = env.payer.pubkey();
    let meta = env.ok(&[cpmm::ix_crank_buyback(&payer, &m.mint, &m.pool, D2)], &[]);
    let r = env.reading(&reading_pda(&config_pda(&m.mint), D2)).unwrap();
    println!("crank_buyback worst-case CU: {} (units {}, outcome {}, spent {}, carried {})", meta.compute_units_consumed, r.units, r.outcome, r.spent_lamports, r.carried_out_lamports);
    assert_eq!(r.outcome, OUTCOME_BURNED);
    assert!(r.units > 9_000_000_000_000_000_000);
    assert!(meta.compute_units_consumed < 200_000, "the client's 400k limit and the 200k default both cover it");
}

/// The buyback crank in the client's shape — CU limit + 2 ATA creates + SyncNative(fee WSOL) + crank — fits a legacy transaction.
#[test]
fn poc_crank_tx_size_client_shape() {
    let mut env = Env::new();
    let auth = Pubkey::new_unique();
    env.init_platform(&auth, DEFAULT_BURN_POOL_CAP_LAMPORTS);
    let m = mkt(&mut env, buyback_rule());
    let fee = fee_pda(&m.mint);
    let payer = env.payer.pubkey();
    env.transfer_sol(&fee, 5 * SOL);
    submit(&mut env, &m.mint, D1, V1, &[&m.att]).unwrap();
    submit(&mut env, &m.mint, D2, V1 + UNIT, &[&m.att]).unwrap();
    use anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account_idempotent as cai;
    let body = vec![
        cai(&payer, &fee, &NATIVE_MINT, &anchor_spl::token::ID),
        cai(&payer, &fee, &m.mint, &anchor_spl::token::ID),
        anchor_spl::token::spl_token::instruction::sync_native(&anchor_spl::token::ID, &get_associated_token_address(&fee, &NATIVE_MINT)).unwrap(),
        cpmm::ix_crank_buyback(&payer, &m.mint, &m.pool, D2),
    ];
    let size = env.legacy_size(&[vec![compute_budget(400_000)], body.clone()].concat());
    println!("crank tx (client shape: CU limit + 2 ATA creates + SyncNative + crank) = {size} bytes");
    assert!(size <= PACKET_DATA_SIZE);
    env.ok(&body, &[]);
    assert_eq!(env.reading(&reading_pda(&config_pda(&m.mint), D2)).unwrap().outcome, OUTCOME_BURNED);
}

// ================================================================================================================================
// Closing tests per finding
// ================================================================================================================================

/// A market with a 1,200 s TWAP window, slippage 150 bps and ≈ 1,950 s of small balanced trades (price flat to ~0.1 %).
fn quiet_market(env: &mut Env) -> Mkt {
    let rule = RuleParams { twap_window_secs: 1_200, slippage_bps: 150, max_twap_deviation_bps: 300, ..buyback_rule() };
    let m = mkt(env, rule);
    let mut now = env.now();
    for i in 0..14 {
        now += 150;
        env.set_time(now);
        cpmm::swap(env, &m.trader, &m.pool, &m.mint, i % 2 == 0, if i % 2 == 0 { SOL / 20 } else { 470_000 * TOKEN }).unwrap();
    }
    env.set_time(now + 60);
    m
}

/// F1: a sandwich's front leg in the SAME transaction as the crank (a WSOL→token buy pushing the price up by 0.5–3 %). Whatever
/// the push, the crank either refuses (TwapDeviation) or buys at least the pre-push quote less slippage — the old spot-only
/// min-out let a push inside the 5 % guard take the whole push.
#[test]
fn f1_a_same_transaction_push_cannot_buy_below_the_twap_quote() {
    let fee_ppm = cpmm::TRADE_FEE_RATE + cpmm::CREATOR_FEE_RATE;
    let mut refused = 0;
    for push_bps in [0u64, 50, 100, 150, 200, 250, 300] {
        let mut env = Env::new();
        let m = quiet_market(&mut env);
        env.transfer_sol(&fee_pda(&m.mint), 20 * SOL);
        submit(&mut env, &m.mint, D1, V1, &[&m.att]).unwrap();
        submit(&mut env, &m.mint, D2, V1 + 5 * UNIT, &[&m.att]).unwrap();
        let (r_sol, r_tok) = cpmm::reserves(&env, &m.pool);
        // Buying Δ SOL moves the SOL price in tokens by ≈ 2Δ/r.
        let delta = r_sol / 20_000 * push_bps;
        let payer = env.payer.pubkey();
        let crank = cpmm::ix_crank_buyback(&payer, &m.mint, &m.pool, D2);
        let r = if delta == 0 { env.send(&[crank], &[]) } else { env.send(&[cpmm::ix_swap(&m.trader.pubkey(), &m.pool, &m.mint, true, delta), crank], &[&m.trader]) };
        match r {
            Ok(_) => {
                let rd = env.reading(&reading_pda(&config_pda(&m.mint), D2)).unwrap();
                assert_eq!(rd.outcome, OUTCOME_BURNED);
                let fair = burn_receipts::math::min_amount_out(rd.spent_lamports, r_sol, r_tok, fee_ppm, 150).unwrap();
                println!("push {push_bps} bps: burned, got {} vs pre-push quote less slippage {fair}", rd.got);
                // 0.2 % allowance for the residual oscillation of the seeding trades.
                assert!(rd.got as u128 * 10_000 >= fair as u128 * 9_980, "push {push_bps} bps bought below the pre-push quote less slippage");
            }
            Err(e) => {
                println!("push {push_bps} bps: refused");
                assert!(e.meta.logs.iter().any(|l| l.contains("TwapDeviation")), "{:?}", e.meta.logs);
                refused += 1;
            }
        }
        if push_bps == 0 {
            assert_eq!(env.reading(&reading_pda(&config_pda(&m.mint), D2)).unwrap().outcome, OUTCOME_BURNED, "an unmanipulated crank burns");
        }
    }
    assert!(refused >= 2, "the larger pushes are refused");
}

/// F1 math: the TWAP read is never biased LOW (the old reader divided by t_end − t, overstating the elapsed time by up to 14 s).
#[test]
fn f1_effective_observation_time_never_understates() {
    use burn_receipts::cpmm::effective_obs_time;
    assert_eq!(effective_obs_time(1_000, None), 1_014);
    assert_eq!(effective_obs_time(1_000, Some(1_150)), 1_014, "sparse trades: the bucket's last update is at most t + 14");
    assert_eq!(effective_obs_time(1_000, Some(1_008)), 1_007, "and before the next observation");
    assert_eq!(effective_obs_time(1_000, Some(900)), 1_014, "a ring successor older than t (wrapped) is ignored");
}

/// F5: register_pool accepts only LaunchLab's migration pool — deterministic PDA on the platform's cpConfigId, LaunchLab pool
/// recording the fee PDA as creator with CPMM migration, fee-PDA pool creator, ≥ 90 % of the LP burned or locked.
#[test]
fn f5_register_pool_accepts_only_the_launchlab_migration_pool() {
    let mut env = Env::new();
    let (mint_kp, creator, att) = (Keypair::new(), Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint_kp.pubkey(), init_args(buyback_rule(), vec![att.pubkey()], 1))], &[&creator, &mint_kp]);
    let mint = mint_kp.pubkey();
    let fee = fee_pda(&mint);
    env.create_mint(&mint_kp, &payer, DECIMALS);
    let launcher = Keypair::new();
    env.fund(&launcher.pubkey(), 1_000 * SOL);
    let amm0 = cpmm::setup_amm(&mut env, &launcher.pubkey());
    let amm1 = cpmm::create_amm_config(&mut env, 1);
    let lt = env.create_ata(&launcher.pubkey(), &mint);
    let me = env.payer.insecure_clone();
    env.mint_to(&mint, &me, &lt, 900_000_000 * TOKEN);
    let reg = |env: &mut Env, pool: &Pubkey| env.send(&[ix_register_pool(&env.payer.pubkey(), &mint, pool)], &[]);

    // A squatter: a permissioned pool on another AmmConfig, fee PDA as creator, LP locked — not the platform's cpConfigId.
    let squat = cpmm::create_pool(&mut env, &launcher, &amm1, &mint, &fee, 5 * SOL, 50_000_000 * TOKEN, &lt);
    // The real migration pool, LP not locked yet.
    let real = cpmm::create_pool_unlocked(&mut env, &launcher, &amm0, &mint, &fee, 85 * SOL, 800_000_000 * TOKEN, &lt);
    // Without LaunchLab's accounts: refused.
    expect_anchor_err(env.send(&[ix_register_pool_with(&payer, &mint, &real.pool, None)], &[]), "LaunchLabAccountsRequired");
    // The LP is checked before LaunchLab's accounts: launcher-held LP is refused.
    expect_anchor_err(reg(&mut env, &real.pool), "LpNotLocked");
    let all = env.token_amount(&get_associated_token_address(&launcher.pubkey(), &real.lp_mint));
    cpmm::lock_lp(&mut env, &launcher, &real, all);
    // No LaunchLab pool account at the PDA: refused.
    expect_anchor_err(reg(&mut env, &real.pool), "InvalidLaunchLabAccount");
    // LaunchLab recorded someone else as creator: refused.
    cpmm::launchlab_state(&mut env, &mint, &launcher.pubkey(), &amm0);
    expect_anchor_err(reg(&mut env, &real.pool), "PoolCreatorMismatch");
    cpmm::launchlab_migrated(&mut env, &mint, &real);
    // The squatter is not the platform's migration pool.
    expect_anchor_err(reg(&mut env, &squat.pool), "NotMigrationPool");
    // A LaunchLab pool migrating to AMM v4, a LaunchLab pool owned by another program, a platform that is not the pool's: refused.
    let ll = launchlab_pool_pda(&mint);
    let good = env.svm.get_account(&ll).unwrap();
    let mut amm_v4 = good.clone();
    amm_v4.data[LL_POOL_MIGRATE_TYPE] = 0;
    env.svm.set_account(ll, amm_v4).unwrap();
    expect_anchor_err(reg(&mut env, &real.pool), "NotMigrationPool");
    let mut foreign = good.clone();
    foreign.owner = Pubkey::new_unique();
    env.svm.set_account(ll, foreign).unwrap();
    expect_anchor_err(reg(&mut env, &real.pool), "InvalidLaunchLabAccount");
    env.svm.set_account(ll, good.clone()).unwrap();
    // A LaunchLab pool on another platform than the one pinned at initialize_token (review-3 M-3).
    let mut other_platform = good.clone();
    other_platform.data[LL_POOL_PLATFORM_ID..LL_POOL_PLATFORM_ID + 32].copy_from_slice(Pubkey::new_unique().as_ref());
    env.svm.set_account(ll, other_platform).unwrap();
    expect_anchor_err(reg(&mut env, &real.pool), "InvalidLaunchLabAccount");
    env.svm.set_account(ll, good.clone()).unwrap();
    // The real pool registers; once.
    let meta = reg(&mut env, &real.pool).unwrap();
    assert_eq!(find_event::<PoolRegistered>(&meta).unwrap().pool, real.pool);
    let c = env.config(&config_pda(&mint));
    assert_eq!((c.cpmm_pool, c.pool_verified), (real.pool, true));
    expect_anchor_err(reg(&mut env, &real.pool), "PoolAlreadyRegistered");
    let _ = att;
}

/// F5: the LP threshold — locked (Raydium's LP lock account) plus burned (SPL burns and CPMM's 100 never-minted units) must reach
/// 90 % of CPMM's lp_supply; dust deposits by third parties cannot block a migrated pool.
#[test]
fn f5_lp_must_be_half_burned_or_locked() {
    let mut env = Env::new();
    let (mint_kp, creator, att) = (Keypair::new(), Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint_kp.pubkey(), init_args(buyback_rule(), vec![att.pubkey()], 1))], &[&creator, &mint_kp]);
    let mint = mint_kp.pubkey();
    env.create_mint(&mint_kp, &payer, DECIMALS);
    let launcher = Keypair::new();
    env.fund(&launcher.pubkey(), 1_000 * SOL);
    let amm0 = cpmm::setup_amm(&mut env, &launcher.pubkey());
    let lt = env.create_ata(&launcher.pubkey(), &mint);
    let me = env.payer.insecure_clone();
    env.mint_to(&mint, &me, &lt, 800_000_000 * TOKEN);
    let pool = cpmm::create_pool_unlocked(&mut env, &launcher, &amm0, &mint, &fee_pda(&mint), 85 * SOL, 800_000_000 * TOKEN, &lt);
    cpmm::launchlab_migrated(&mut env, &mint, &pool);
    let d = env.svm.get_account(&pool.pool).unwrap().data;
    let lp_supply = u64::from_le_bytes(d[333..341].try_into().unwrap());
    let reg = |env: &mut Env| env.send(&[ix_register_pool(&env.payer.pubkey(), &mint, &pool.pool)], &[]);
    expect_anchor_err(reg(&mut env), "LpNotLocked");
    // 49 % locked: refused (review-3 M-2: the floor is 50 % of the live supply).
    cpmm::lock_lp(&mut env, &launcher, &pool, lp_supply / 100 * 49);
    expect_anchor_err(reg(&mut env), "LpNotLocked");
    // + 1 % burned: 50 % — accepted, with the launcher still holding ~50 %.
    cpmm::burn_lp(&mut env, &launcher, &pool, lp_supply / 100);
    reg(&mut env).unwrap();
    let _ = att;
}

/// F14: a FIXED pool (creator trust) must still pass the creator and LP checks before any buyback; the crank refuses an
/// unverified pool.
#[test]
fn f14_fixed_pool_needs_the_creator_and_lp_checks() {
    let mut env = Env::new();
    let (mint_kp, creator, att) = (Keypair::new(), Keypair::new(), Keypair::new());
    let mint = mint_kp.pubkey();
    let payer = env.payer.pubkey();
    let amm0 = cpmm::pda(&[b"amm_config", &0u16.to_be_bytes()]);
    let (t0, t1) = if NATIVE_MINT < mint { (NATIVE_MINT, mint) } else { (mint, NATIVE_MINT) };
    let fixed = cpmm::pda(&[b"pool", amm0.as_ref(), t0.as_ref(), t1.as_ref()]);
    let rule = RuleParams { pool_policy: POOL_POLICY_FIXED, ..buyback_rule() };
    let mut args = init_args(rule, vec![att.pubkey()], 1);
    args.fixed_pool = fixed;
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint, args)], &[&creator, &mint_kp]);
    env.create_mint(&mint_kp, &payer, DECIMALS);
    let launcher = Keypair::new();
    env.fund(&launcher.pubkey(), 1_000 * SOL);
    let amm = cpmm::setup_amm(&mut env, &launcher.pubkey());
    assert_eq!(amm, amm0);
    let lt = env.create_ata(&launcher.pubkey(), &mint);
    let me = env.payer.insecure_clone();
    env.mint_to(&mint, &me, &lt, 800_000_000 * TOKEN);
    let pool = cpmm::create_pool_unlocked(&mut env, &launcher, &amm, &mint, &fee_pda(&mint), 85 * SOL, 800_000_000 * TOKEN, &lt);
    assert_eq!(pool.pool, fixed);
    env.create_ata(&fee_pda(&mint), &NATIVE_MINT);
    env.create_ata(&fee_pda(&mint), &mint);
    cpmm::seed_history(&mut env, &pool, &mint);
    env.transfer_sol(&fee_pda(&mint), 5 * SOL);
    submit(&mut env, &mint, D1, V1, &[&att]).unwrap();
    submit(&mut env, &mint, D2, V1 + UNIT, &[&att]).unwrap();
    expect_anchor_err(env.send(&[cpmm::ix_crank_buyback(&payer, &mint, &pool, D2)], &[]), "PoolNotVerified");
    let reg = |env: &mut Env, p: &Pubkey| env.send(&[ix_register_pool_with(&env.payer.pubkey(), &mint, p, None)], &[]);
    // Only the fixed address, and only with its LP burned/locked.
    let other = Pubkey::new_unique();
    expect_fail(reg(&mut env, &other));
    expect_anchor_err(reg(&mut env, &pool.pool), "LpNotLocked");
    let all = env.token_amount(&get_associated_token_address(&launcher.pubkey(), &pool.lp_mint));
    cpmm::lock_lp(&mut env, &launcher, &pool, all);
    reg(&mut env, &pool.pool).unwrap();
    assert!(env.config(&config_pda(&mint)).pool_verified);
    expect_anchor_err(reg(&mut env, &pool.pool), "PoolAlreadyRegistered");
    env.ok(&[cpmm::ix_crank_buyback(&payer, &mint, &pool, D2)], &[]);
    assert_eq!(env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap().outcome, OUTCOME_BURNED);
}

/// F7 + F15: after 30 days of CONTINUOUS untradeability the crank stops waiting: the reading is processed below-floor, its whole
/// target carried (SpendCarried, BuybackQueueUnblocked), and the queue moves on; when the pool trades again the carry is spent.
#[test]
fn f7_the_queue_unblocks_after_30_days_of_continuous_untradeability() {
    let mut env = Env::new();
    let m = mkt(&mut env, buyback_rule());
    let cfg = config_pda(&m.mint);
    env.transfer_sol(&fee_pda(&m.mint), 10 * SOL);
    submit(&mut env, &m.mint, D1, V1, &[&m.att]).unwrap();
    submit(&mut env, &m.mint, D2, V1 + UNIT, &[&m.att]).unwrap();
    set_pool_status(&mut env, &m.pool.pool, 4);
    let crank = |env: &mut Env, d: u32| env.send(&[cpmm::ix_crank_buyback(&env.payer.pubkey(), &m.mint, &m.pool, d)], &[]);
    expect_anchor_err(crank(&mut env, D2), "PoolNotTradable");
    let since = find_event::<PoolUntradeableFlagged>(&check(&mut env, &m.mint, &m.pool)).unwrap().candidate_at; // L-3: day 0 is a candidate
    for day in 1..30 {
        env.set_time(since + day * 86_400);
        check(&mut env, &m.mint, &m.pool);
    }
    expect_anchor_err(crank(&mut env, D2), "PoolNotTradable"); // day 29
    env.set_time(since + QUEUE_UNBLOCK_SECS);
    let meta = crank(&mut env, D2).unwrap();
    let r = env.reading(&reading_pda(&cfg, D2)).unwrap();
    assert_eq!((r.outcome, r.spent_lamports), (OUTCOME_BELOW_FLOOR, 0));
    assert!(r.carried_out_lamports > 0 && r.carried_out_lamports == r.rule_spend_lamports + r.carried_in_lamports);
    assert_eq!(env.config(&cfg).carried_spend_lamports, r.carried_out_lamports);
    let u = find_event::<BuybackQueueUnblocked>(&meta).unwrap();
    assert_eq!((u.record_date, u.untradeable_since, u.carried_out_lamports), (D2, since, r.carried_out_lamports));
    let sc = find_event::<SpendCarried>(&meta).unwrap();
    assert_eq!((sc.reason, sc.carried_out_lamports), (burn_receipts::instructions::crank_buyback::CARRY_REASON_POOL_UNTRADEABLE, r.carried_out_lamports));
    // The next reading is processed the same way (the crank's own observation keeps the spell continuous).
    submit(&mut env, &m.mint, D3, V1 + 2 * UNIT, &[&m.att]).unwrap();
    env.set_time(env.now() + 3_600);
    crank(&mut env, D3).unwrap();
    let r3 = env.reading(&reading_pda(&cfg, D3)).unwrap();
    assert_eq!(r3.outcome, OUTCOME_BELOW_FLOOR);
    assert_eq!(r3.carried_in_lamports, r.carried_out_lamports);
    // Trading resumes: the carried target is spent (within the 2 % cap) and the spell is cleared.
    set_pool_status(&mut env, &m.pool.pool, 0);
    cpmm::seed_history(&mut env, &m.pool, &m.mint);
    submit(&mut env, &m.mint, D4, V1 + 3 * UNIT, &[&m.att]).unwrap();
    crank(&mut env, D4).unwrap();
    let r4 = env.reading(&reading_pda(&cfg, D4)).unwrap();
    assert_eq!(r4.outcome, OUTCOME_BURNED);
    assert_eq!(r4.carried_in_lamports, r3.carried_out_lamports);
    assert_eq!(env.config(&cfg).pool_untradeable_since, 0);
}

/// F15: the reserve cap pushing the spend under the floor carries the whole target with its own event (nothing spent).
#[test]
fn f15_a_carry_with_nothing_spent_emits_spend_carried() {
    let mut env = Env::new();
    // floor 2 SOL > 2 % of the 85 SOL reserve (1.7 SOL): the capped spend is always under the floor.
    let m = mkt(&mut env, RuleParams { floor_lamports: 2 * SOL, ..buyback_rule() });
    env.transfer_sol(&fee_pda(&m.mint), 20 * SOL);
    submit(&mut env, &m.mint, D1, V1, &[&m.att]).unwrap();
    submit(&mut env, &m.mint, D2, V1 + 3 * UNIT, &[&m.att]).unwrap();
    let payer = env.payer.pubkey();
    let meta = env.ok(&[cpmm::ix_crank_buyback(&payer, &m.mint, &m.pool, D2)], &[]);
    let r = env.reading(&reading_pda(&config_pda(&m.mint), D2)).unwrap();
    assert_eq!((r.outcome, r.spent_lamports), (OUTCOME_BELOW_FLOOR, 0));
    let sc = find_event::<SpendCarried>(&meta).unwrap();
    assert_eq!((sc.record_date, sc.carried_out_lamports, sc.reason), (D2, r.carried_out_lamports, burn_receipts::instructions::crank_buyback::CARRY_REASON_BELOW_FLOOR));
    assert!(sc.carried_out_lamports >= 2 * SOL);
    assert!(find_event::<SpendCapBound>(&meta).is_none());
}

/// F8 + review-3 I-2: the PlatformConfig's initial cap EQUALS the default (it cannot lower the cap in force) and its sunset is never
/// later than the hard-coded default sunset.
#[test]
fn f8_platform_cap_floor_and_sunset_bound() {
    let mut env = Env::new();
    let (payer, ua) = (env.payer.pubkey(), env.upgrade_authority.insecure_clone());
    let a = Pubkey::new_unique();
    expect_anchor_err(env.send(&[ix_initialize_platform(&payer, &ua.pubkey(), &a, MIN_BURN_POOL_CAP_LAMPORTS, NOW + 86_400)], &[&ua]), "CapNotDefault");
    expect_anchor_err(env.send(&[ix_initialize_platform(&payer, &ua.pubkey(), &a, DEFAULT_BURN_POOL_CAP_LAMPORTS - 1, NOW + 86_400)], &[&ua]), "CapNotDefault");
    expect_anchor_err(env.send(&[ix_initialize_platform(&payer, &ua.pubkey(), &a, DEFAULT_BURN_POOL_CAP_LAMPORTS + 1, NOW + 86_400)], &[&ua]), "CapNotDefault");
    // DEFAULT_CAP_SUNSET_TS + 1 is inside the 365-day bound from NOW, so only the default-sunset bound refuses it.
    expect_anchor_err(env.send(&[ix_initialize_platform(&payer, &ua.pubkey(), &a, DEFAULT_BURN_POOL_CAP_LAMPORTS, DEFAULT_CAP_SUNSET_TS + 1)], &[&ua]), "InvalidSunset");
    env.ok(&[ix_initialize_platform(&payer, &ua.pubkey(), &a, DEFAULT_BURN_POOL_CAP_LAMPORTS, DEFAULT_CAP_SUNSET_TS)], &[&ua]);
}

/// F11 + F12: the init event carries the admin, a governance hash and the cluster genesis; the config stores the genesis; a
/// signature made for another cluster's message (devnet genesis) does not count.
#[test]
fn f11_f12_init_event_governance_and_cluster_binding() {
    let mut env = Env::new();
    let (mint_kp, creator, admin, a) = (Keypair::new(), Keypair::new(), Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    let mut args = init_args(vault_rule(), vec![a.pubkey()], 1);
    args.admin = admin.pubkey();
    let meta = env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint_kp.pubkey(), args)], &[&creator, &mint_kp]);
    let ev = find_event::<TokenInitialized>(&meta).unwrap();
    let entries = vec![AttesterEntry::operator(a.pubkey())];
    assert_eq!(ev.admin, admin.pubkey());
    assert_eq!(ev.governance_hash, burn_receipts::instructions::initialize_token::governance_hash(&admin.pubkey(), 1, &entries));
    assert_eq!(ev.cluster_genesis, CLUSTER_GENESIS_HASH);
    let mint = mint_kp.pubkey();
    assert_eq!(env.config(&config_pda(&mint)).cluster_genesis, CLUSTER_GENESIS_HASH);
    // Another cluster's message: same everything but the genesis.
    let ours = String::from_utf8(message(&mint, 0, D1, V1)).unwrap();
    assert!(ours.starts_with(&format!("BURNRECEIPTS-v3|{CLUSTER_GENESIS_HASH}|")));
    let theirs = ours.replace(&CLUSTER_GENESIS_HASH.to_string(), "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG").into_bytes();
    expect_anchor_err(env.send(&[ed25519_shared(&[(a.pubkey(), sign(&a, &theirs))], &theirs), ix_submit(&payer, &mint, D1, V1)], &[]), "QuorumNotMet");
    submit(&mut env, &mint, D1, V1, &[&a]).unwrap();
}

fn mint_keypair(below_wsol: bool) -> Keypair {
    loop {
        let k = Keypair::new();
        if (k.pubkey() < NATIVE_MINT) == below_wsol {
            return k;
        }
    }
}

/// F17(b): both oracle orientations, deterministically — WSOL as token_1 (a mint that sorts below WSOL: cumulative token_1 price
/// at offset 24) and WSOL as token_0 (offset 8).
#[test]
fn f17b_twap_reads_both_pool_orientations() {
    for below in [true, false] {
        let mut env = Env::new();
        let m = mkt_with(&mut env, buyback_rule(), mint_keypair(below));
        assert_eq!(m.pool.wsol_is_0, !below);
        env.transfer_sol(&fee_pda(&m.mint), 10 * SOL);
        submit(&mut env, &m.mint, D1, V1, &[&m.att]).unwrap();
        submit(&mut env, &m.mint, D2, V1 + 2 * UNIT, &[&m.att]).unwrap();
        let payer = env.payer.pubkey();
        env.ok(&[cpmm::ix_crank_buyback(&payer, &m.mint, &m.pool, D2)], &[]);
        assert_eq!(env.reading(&reading_pda(&config_pda(&m.mint), D2)).unwrap().outcome, OUTCOME_BURNED, "wsol_is_0 = {}", !below);
        // A same-transaction 4 % push trips the guard in either orientation.
        submit(&mut env, &m.mint, D3, V1 + 3 * UNIT, &[&m.att]).unwrap();
        env.set_time(env.now() + 1_200);
        let (r_sol, _) = cpmm::reserves(&env, &m.pool);
        let crank = cpmm::ix_crank_buyback(&payer, &m.mint, &m.pool, D3);
        let r = env.send(&[cpmm::ix_swap(&m.trader.pubkey(), &m.pool, &m.mint, true, r_sol / 50), crank], &[&m.trader]);
        expect_anchor_err(r, "TwapDeviation");
    }
}
