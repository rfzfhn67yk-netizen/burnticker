//! Blind review 2026-10-11 of the winner-takes-the-burn release (LAUNCHPAD-PATH §40) — exploit tests for burn_receipts
//! `submit_pair_result`, the crank gate and `forward_to_winner` (docs/burnticker/reviews/2026-10-11-pair-forward-blind.md).
//!
//! Every `h*` test asserts the SAFE behaviour and FAILS against the reviewed code (ea65a7f0). They are `#[ignore]`d so
//! scripts/test.sh stays green; run them with
//!   cargo test -p burn_receipts --test review_pair -- --include-ignored --test-threads=1
//! `ctl_*` tests are controls (they pass): they pin the behaviour the exploit tests build on.
//!
//! H-1: once a PairResult names a loser, the loser's reading for that period can be processed ONLY by forward_to_winner
//! (crank_buyback refuses ForwardRequired, with no time-out). forward_to_winner needs the winner's reading for the same date AND both
//! pools verified. Nothing at submit_pair_result checks that either will ever hold, so a result the winner cannot serve wedges the
//! loser's crank queue — every later reading too (strict order) — and its burn pool, permanently (no withdraw path exists).

#![allow(clippy::result_large_err, clippy::too_many_arguments)]
mod common;

use anchor_lang::prelude::Pubkey;
use burn_receipts::constants::*;
use burn_receipts::state::RuleParams;
use common::cpmm::{self, Pool};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

const D1: u32 = 20261005;
const D2: u32 = 20261006;
const D3: u32 = 20261007;
const V1: u64 = 4_027_300_000_000_000;
const DAY: i64 = 86_400;

thread_local! {
    static LAUNCHER: std::cell::RefCell<Option<Keypair>> = const { std::cell::RefCell::new(None) };
}

struct Coin {
    mint: Pubkey,
    pool: Option<Pool>,
}

fn platform(env: &mut Env) {
    if env.svm.get_account(&platform_pda()).map(|a| a.data.is_empty()).unwrap_or(true) {
        let auth = Pubkey::new_unique();
        env.init_platform(&auth, DEFAULT_BURN_POOL_CAP_LAMPORTS);
    }
}

/// initialize_token for a policy-0 coin naming a partner (`partner_first`: the partner already named this mint).
fn init(env: &mut Env, mint: &Keypair, attester: &Pubkey, rule: RuleParams, pair: Option<(Pubkey, bool)>) -> TxResult {
    let creator = Keypair::new();
    let mut args = init_args(rule, vec![*attester], 1);
    args.admin = creator.pubkey();
    let payer = env.payer.pubkey();
    let ix = ix_initialize_full(&payer, &creator.pubkey(), &mint.pubkey(), args, Some(TEST_LAUNCHLAB_PLATFORM), pair.map(|p| p.0), pair.map(|p| p.1).unwrap_or(false));
    env.send(&[ix], &[&creator, mint])
}

/// The mint, its CPMM pool (fee-PDA creator, LP locked), register_pool, the fee PDA's ATAs and oracle history (as tests/pairs.rs).
fn market(env: &mut Env, mint_kp: &Keypair) -> Pool {
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
    pool
}

/// Two coins paired at initialize_token (A first naming B, B answering). `b_market`: false = B never reaches a verified pool (a
/// LaunchLab coin still on its curve, a pair_curve side that is refunding, a pool switched away by apply_registration_policy).
fn paired(env: &mut Env, att: &Keypair, b_market: bool) -> (Coin, Coin) {
    let (ka, kb) = (Keypair::new(), Keypair::new());
    init(env, &ka, &att.pubkey(), buyback_rule(), Some((kb.pubkey(), false))).unwrap();
    init(env, &kb, &att.pubkey(), buyback_rule(), Some((ka.pubkey(), true))).unwrap();
    assert_eq!(env.config(&config_pda(&ka.pubkey())).pair_state, PAIR_STATE_PAIRED);
    let pa = market(env, &ka);
    let pb = if b_market { Some(market(env, &kb)) } else { None };
    submit(env, &ka.pubkey(), D1, V1, &[att]).unwrap();
    submit(env, &kb.pubkey(), D1, V1, &[att]).unwrap();
    (Coin { mint: ka.pubkey(), pool: Some(pa) }, Coin { mint: kb.pubkey(), pool: pb })
}

fn cranker(env: &mut Env) -> Keypair {
    let k = Keypair::new();
    env.fund(&k.pubkey(), SOL);
    k
}

/// The Anchor error name in a failed transaction's logs ("ok" if it succeeded).
fn code(r: &TxResult) -> String {
    match r {
        Ok(_) => "ok".into(),
        Err(e) => e.meta.logs.iter().find_map(|l| l.split("Error Code: ").nth(1).map(|s| s.split('.').next().unwrap_or(s).to_string())).unwrap_or_else(|| format!("{:?}", e.err)),
    }
}

/// Try both ways out for the loser's reading `date`: forward_to_winner, then crank_buyback (paired accounts).
fn try_unwedge(env: &mut Env, k: &Keypair, loser: &Coin, winner: &Coin, date: u32) -> (String, String) {
    let f = env.send(&[ix_forward_to_winner(&k.pubkey(), &loser.mint, &winner.mint, date)], &[k]);
    let pool = loser.pool.as_ref().expect("the loser has a market");
    cpmm::seed_history(env, pool, &loser.mint);
    let c = env.send(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &loser.mint, pool, date, Some(winner.mint))], &[k]);
    (code(&f), code(&c))
}

// =================================================================================================================================
// controls
// =================================================================================================================================

/// Control: the program accepts a PairResult for a period in which the WINNER has no reading, and the winner can then read past it.
#[test]
fn ctl_a_result_is_accepted_for_a_period_the_winner_never_read() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (a, b) = paired(&mut env, &att, true);
    submit(&mut env, &b.mint, D2, V1 + 5 * UNIT, &[&att]).unwrap();
    // A has no reading for D2; the result naming A is accepted anyway (no reading is consulted).
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]).unwrap();
    // A reads D3 next (its D2 never came); D2 can never be read for A again.
    submit(&mut env, &a.mint, D3, V1 + UNIT, &[&att]).unwrap();
    expect_anchor_err(submit(&mut env, &a.mint, D2, V1, &[&att]), "StaleReading");
}

// =================================================================================================================================
// H-1 — a PairResult the winner cannot serve wedges the loser forever
// =================================================================================================================================

/// H-1(a): the result names a winner that has no reading for the period and has already read past it. The loser's D2 is
/// ForwardRequired for crank_buyback and AccountNotInitialized (winner_reading) for forward_to_winner — forever, and every later
/// reading of the loser is OutOfOrder behind it. SAFE: within 60 days the loser's queue advances one way or the other.
#[test]
#[ignore = "H-1 exploit: fails against ea65a7f0 (the loser's queue is wedged permanently)"]
fn h1a_a_result_whose_winner_read_past_the_period_must_not_wedge_the_loser_forever() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (a, b) = paired(&mut env, &att, true);
    env.transfer_sol(&fee_pda(&b.mint), 3 * SOL);
    submit(&mut env, &b.mint, D2, V1 + 5 * UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]).unwrap();
    submit(&mut env, &a.mint, D3, V1 + UNIT, &[&att]).unwrap();
    submit(&mut env, &b.mint, D3, V1 + 9 * UNIT, &[&att]).unwrap();
    let k = cranker(&mut env);

    let (f0, c0) = try_unwedge(&mut env, &k, &b, &a, D2);
    println!("H-1(a) right after the result: forward_to_winner = {f0}, crank_buyback = {c0}");
    // B's next reading cannot be processed either: strict order.
    let pool_b = b.pool.as_ref().unwrap();
    let later = env.send(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &b.mint, pool_b, D3, Some(a.mint))], &[&k]);
    println!("H-1(a) B's D3 crank: {}", code(&later));

    // Sixty days later, nothing has changed: no time-out exists on the LOST branch of the crank gate.
    let now = env.now();
    env.set_time(now + 60 * DAY);
    let fee_b = env.lamports(&fee_pda(&b.mint));
    let (f, c) = try_unwedge(&mut env, &k, &b, &a, D2);
    println!("H-1(a) +60 days: forward_to_winner = {f}, crank_buyback = {c}; B's burn pool still holds {fee_b} lamports");
    assert!(
        f == "ok" || c == "ok",
        "H-1(a): the loser's reading {D2} is wedged for good — forward_to_winner = {f}, crank_buyback = {c}; B's burn pool ({fee_b} lamports) can never be spent"
    );
}

/// H-1(b): the result names a winner whose pool is not verified (here: never registered — a LaunchLab partner still on its curve;
/// equally a pair_curve side that is refunding, or a winner after apply_registration_policy). forward_to_winner refuses
/// PairSideNotLive, crank_buyback refuses ForwardRequired. The program's own doc (pair.rs:351-352) and the whitepaper §5.5 say "a
/// voided / unregistered side forwards nothing" / "a void forwards nothing". SAFE: the loser's reading is processed (forwarding nothing,
/// or cranked as the loser's own) instead of blocking the queue.
#[test]
#[ignore = "H-1 exploit: fails against ea65a7f0 (PairSideNotLive + ForwardRequired forever)"]
fn h1b_a_result_naming_a_winner_without_a_verified_pool_must_not_wedge_the_loser() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (a, b) = paired(&mut env, &att, false);
    assert!(env.config(&config_pda(&a.mint)).pool_verified && !env.config(&config_pda(&b.mint)).pool_verified);
    env.transfer_sol(&fee_pda(&a.mint), 3 * SOL);
    submit(&mut env, &a.mint, D2, V1 + 4 * UNIT, &[&att]).unwrap();
    submit(&mut env, &b.mint, D2, V1 + 7 * UNIT, &[&att]).unwrap();
    // B (no pool) wins D2.
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, b.mint, &[&att]).unwrap();
    let k = cranker(&mut env);
    let (f0, c0) = try_unwedge(&mut env, &k, &a, &b, D2);
    println!("H-1(b) right after the result: forward_to_winner = {f0}, crank_buyback = {c0}");
    let now = env.now();
    env.set_time(now + 60 * DAY);
    let fee_a = env.lamports(&fee_pda(&a.mint));
    let (f, c) = try_unwedge(&mut env, &k, &a, &b, D2);
    println!("H-1(b) +60 days: forward_to_winner = {f}, crank_buyback = {c}; A's burn pool still holds {fee_a} lamports");
    assert!(
        f == "ok" || c == "ok",
        "H-1(b): the live coin A is wedged behind a result naming its unregistered partner — forward_to_winner = {f}, crank_buyback = {c}"
    );
}
