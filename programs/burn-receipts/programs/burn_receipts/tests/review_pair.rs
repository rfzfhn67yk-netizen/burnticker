//! Blind review 2026-10-11 of the winner-takes-the-burn release (LAUNCHPAD-PATH §40) — exploit tests for burn_receipts
//! `submit_pair_result`, the crank gate and `forward_to_winner` (docs/burnticker/reviews/2026-10-11-pair-forward-blind.md).
//!
//! Every `h*` test asserts the SAFE behaviour; it FAILED against the reviewed code (ea65a7f0) and passes since the r2 fixes (branch
//! burnticker/pair-forward-r2) — kept as regressions, no longer ignored. The reviewer's control is inverted: a win for a period the
//! winner never read is now refused at submit_pair_result (H-1(a)). The other r2 paths (0-lamport forward for a dead side, the 72 h
//! LOST time-out, unlink_pair) are in tests/pairs.rs.
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

// r2 (L-2): results are refused for dates before the pairing (the harness pairs on 2026-10-09): later periods, clock moved first.
const D1: u32 = 20261010;
const D2: u32 = 20261011;
const D3: u32 = 20261012;
const T0: i64 = NOW + 6 * DAY;
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
    if env.now() < T0 {
        env.set_time(T0);
    }
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

/// Inverted control (r2 H-1(a)): a WIN for a period in which the winner has no reading is refused — the keeper posts a draw instead.
#[test]
fn ctl_a_result_for_a_period_the_winner_never_read_is_refused() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (a, b) = paired(&mut env, &att, true);
    submit(&mut env, &b.mint, D2, V1 + 5 * UNIT, &[&att]).unwrap();
    expect_anchor_err(submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]), "PairResultNotServable");
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, Pubkey::default(), &[&att]).unwrap();
}

// =================================================================================================================================
// H-1 — a PairResult the winner cannot serve must not wedge the loser (r2: refused at submit; 0-lamport forward; 72 h time-out)
// =================================================================================================================================

/// H-1(a) regression: the would-be result (winner without a reading for the period, already read past it) is refused; the draw that
/// replaces it lets the loser crank its own fuel, so its queue advances at once — and every later reading with it.
#[test]
fn h1a_a_result_whose_winner_read_past_the_period_must_not_wedge_the_loser_forever() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (a, b) = paired(&mut env, &att, true);
    env.transfer_sol(&fee_pda(&b.mint), 3 * SOL);
    submit(&mut env, &b.mint, D2, V1 + 5 * UNIT, &[&att]).unwrap();
    expect_anchor_err(submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]), "PairResultNotServable");
    submit(&mut env, &a.mint, D3, V1 + UNIT, &[&att]).unwrap();
    submit(&mut env, &b.mint, D3, V1 + 9 * UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, Pubkey::default(), &[&att]).unwrap();
    let k = cranker(&mut env);
    let (f, c) = try_unwedge(&mut env, &k, &b, &a, D2);
    println!("H-1(a) r2: forward_to_winner = {f} (a draw: NotWinner), crank_buyback = {c}");
    assert_eq!(c, "ok", "the loser's reading {D2} is processed by its own crank");
    // and B's next period is reachable (strict order is satisfied)
    let pool_b = b.pool.as_ref().unwrap();
    let later = env.send(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &b.mint, pool_b, D3, Some(a.mint))], &[&k]);
    assert!(code(&later) == "PairResultPending", "D3 waits for its own result, not for D2: {}", code(&later));
}

/// H-1(b) regression: a win naming a partner without a verified pool (a LaunchLab curve not migrated, a refunding pair_curve side, a
/// pool switched away) is recorded, and forward_to_winner processes the live loser's reading as a 0-lamport FORWARDED: the loser keeps
/// its fuel (it is not burned for a period it lost) and its queue moves on at once.
#[test]
fn h1b_a_result_naming_a_winner_without_a_verified_pool_must_not_wedge_the_loser() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (a, b) = paired(&mut env, &att, false);
    assert!(env.config(&config_pda(&a.mint)).pool_verified && !env.config(&config_pda(&b.mint)).pool_verified);
    env.transfer_sol(&fee_pda(&a.mint), 3 * SOL);
    submit(&mut env, &a.mint, D2, V1 + 4 * UNIT, &[&att]).unwrap();
    submit(&mut env, &b.mint, D2, V1 + 7 * UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, b.mint, &[&att]).unwrap();
    let k = cranker(&mut env);
    let fee_a = env.lamports(&fee_pda(&a.mint));
    let (f, c) = try_unwedge(&mut env, &k, &a, &b, D2);
    println!("H-1(b) r2: forward_to_winner = {f}, then crank_buyback = {c} (AlreadyProcessed: the forward processed it)");
    assert_eq!(f, "ok");
    assert_eq!(env.lamports(&fee_pda(&a.mint)), fee_a, "nothing moved to the dead side");
    assert_eq!(env.reading(&reading_pda(&config_pda(&a.mint), D2)).unwrap().outcome, OUTCOME_FORWARDED);
    // 30 days after pairing, the dead partner can be unlinked on that evidence (M-2)
    let paired_at = pair_link(&env, &a.mint).unwrap().paired_at;
    env.set_time(paired_at.max(env.now()) + PAIR_UNLINK_NOT_LIVE_SECS);
    env.ok(&[ix_unlink_pair(&k.pubkey(), &a.mint, &b.mint, None)], &[&k]);
    assert_eq!(env.config(&config_pda(&a.mint)).pair_state, PAIR_STATE_NONE);
}
