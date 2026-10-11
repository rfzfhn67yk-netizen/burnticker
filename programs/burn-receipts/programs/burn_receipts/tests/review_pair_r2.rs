//! Pair-forward RE-CHECK (2026-10-11) of the round-2 fixes (program 6fc15f00, merged at 9d81ee5e) — burn_receipts tests for
//! docs/burnticker/reviews/2026-10-11-pair-forward-recheck.md. The High (RN-1, policy 2) is in programs/pair_curve/tests/review_pair_r2.rs
//! (it needs a pair_curve Pair). Every test here ASSERTS TODAY'S BEHAVIOUR and passes; a name with `still` documents a residual the
//! round did not close, so a fix makes it fail and it must then be inverted.
//!
//!   M-1 residual   m1_still_the_losing_sides_attesters_veto_its_losses_while_it_collects_its_wins
//!   RN-2 (Medium)  rn2_still_a_launchlab_pair_with_both_coins_on_their_curves_is_unpaired_for_good_after_30_days
//!   RI-1 (Info)    ri1_still_a_lost_period_can_be_forwarded_after_the_72_hour_time_out
//!
//! Run: scripts/test.sh builds target/deploy-test; then
//!   cargo test -p burn_receipts --test review_pair_r2 -- --test-threads=1 --nocapture

#![allow(clippy::result_large_err, clippy::too_many_arguments, dead_code)]
mod common;

use anchor_lang::prelude::Pubkey;
use burn_receipts::constants::*;
use burn_receipts::state::RuleParams;
use common::cpmm::{self, Pool};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

// The harness pairs on 2026-10-09 (NOW); results are refused before the pairing day (L-2).
const D1: u32 = 20261010;
const D2: u32 = 20261011;
const D3: u32 = 20261012;
const DAY: i64 = 86_400;
const T0: i64 = NOW + 6 * DAY;
const V1: u64 = 4_027_300_000_000_000;

thread_local! {
    static LAUNCHER: std::cell::RefCell<Option<Keypair>> = const { std::cell::RefCell::new(None) };
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

/// The mint, its CPMM pool (fee-PDA creator, LP locked), register_pool, the fee PDA's ATAs and oracle history (as tests/pairs.rs) —
/// i.e. the coin "graduates" now.
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

fn cranker(env: &mut Env) -> Keypair {
    let k = Keypair::new();
    env.fund(&k.pubkey(), SOL);
    k
}

fn event<T: anchor_lang::AnchorDeserialize + anchor_lang::Discriminator>(meta: &litesvm::types::TransactionMetadata) -> Option<T> {
    events(meta).into_iter().find(|(d, _)| d[..] == T::DISCRIMINATOR[..]).map(|(_, p)| T::try_from_slice(&p).unwrap())
}

/// Two paired coins with markets, each with its OWN attester set (quorum 1) — a pair made directly on the program, or any future
/// per-creator attester set. Both read D1 (baseline).
fn paired_distinct(env: &mut Env, att_a: &Keypair, att_b: &Keypair) -> ((Pubkey, Pool), (Pubkey, Pool)) {
    let (ka, kb) = (Keypair::new(), Keypair::new());
    init(env, &ka, &att_a.pubkey(), buyback_rule(), Some((kb.pubkey(), false))).unwrap();
    init(env, &kb, &att_b.pubkey(), buyback_rule(), Some((ka.pubkey(), true))).unwrap();
    let pa = market(env, &ka);
    let pb = market(env, &kb);
    submit(env, &ka.pubkey(), D1, V1, &[att_a]).unwrap();
    submit(env, &kb.pubkey(), D1, V1, &[att_b]).unwrap();
    ((ka.pubkey(), pa), (kb.pubkey(), pb))
}

// =================================================================================================================================
// M-1 residual — the losing side's attesters still decide whether its losses forward
// =================================================================================================================================

/// The blind review's M-1 scenario, unchanged by round 2: B's attesters never sign a result in which B loses. A's attesters cannot
/// record A's win alone (QuorumNotMet — by design since r2, the loser must consent), so 72 h after B's reading B burns its own fuel
/// (PairResultMissing). When B WINS, A's honest attesters sign A's loss and A's fuel moves to B. Round 2 removed only the winner's
/// (pointless) veto and pinned the attester set against rotation; the asymmetric loser veto remains and is not disclosed.
#[test]
fn m1_still_the_losing_sides_attesters_veto_its_losses_while_it_collects_its_wins() {
    let mut env = Env::new();
    let (att_a, att_b) = (Keypair::new(), Keypair::new());
    let ((a, pa), (b, pb)) = paired_distinct(&mut env, &att_a, &att_b);
    env.transfer_sol(&fee_pda(&a), 3 * SOL);
    env.transfer_sol(&fee_pda(&b), 3 * SOL);
    let k = cranker(&mut env);

    // D2: A won, B lost. Only A's attesters are willing to sign.
    submit(&mut env, &a, D2, V1 + 4 * UNIT, &[&att_a]).unwrap();
    submit(&mut env, &b, D2, V1 + 4 * UNIT, &[&att_b]).unwrap();
    expect_anchor_err(submit_pair_result(&mut env, &a, &b, D2, a, &[&att_a]), "QuorumNotMet");
    let submitted = env.reading(&reading_pda(&config_pda(&b), D2)).unwrap().submitted_at;
    env.set_time(submitted + PAIR_RESULT_GRACE_SECS);
    cpmm::seed_history(&mut env, &pb, &b);
    let supply_b = env.mint_supply(&b);
    let meta = env.ok(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &b, &pb, D2, Some(a))], &[&k]);
    assert!(event::<burn_receipts::events::PairResultMissing>(&meta).is_some());
    assert!(env.mint_supply(&b) < supply_b, "B's lost period burned B's own supply");
    // and the period can no longer be decided against B
    expect_anchor_err(submit_pair_result(&mut env, &a, &b, D2, a, &[&att_b]), "PairResultNotServable");
    // (A's own D2 — the period it won — also waited out the 72 h without a result, then burns A's own fuel)
    cpmm::seed_history(&mut env, &pa, &a);
    env.ok(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &a, &pa, D2, Some(b))], &[&k]);

    // D3: B won, A lost. A's honest attesters sign A's loss: A's fuel moves to B.
    env.set_time(env.now() + DAY);
    submit(&mut env, &a, D3, V1 + 6 * UNIT, &[&att_a]).unwrap();
    submit(&mut env, &b, D3, V1 + 6 * UNIT, &[&att_b]).unwrap();
    submit_pair_result(&mut env, &a, &b, D3, b, &[&att_a]).unwrap();
    let fb = env.lamports(&fee_pda(&b));
    env.ok(&[ix_forward_to_winner(&k.pubkey(), &a, &b, D3)], &[&k]);
    let gained = env.lamports(&fee_pda(&b)) - fb;
    println!("M-1 residual: B kept (burned) its own D2 fuel; A's D3 loss moved {gained} lamports into B's burn pool");
    assert!(gained > 0);
}

// =================================================================================================================================
// RN-2 — UNLINK_NOT_LIVE fires on a healthy pair whose coins are simply still on their curves
// =================================================================================================================================

/// A LaunchLab pair (policy 0) paired at initialize_token. Neither coin has graduated 30 days after the pairing (a LaunchLab curve has
/// no deadline; an election pair's rules carry voidBy = the race's settlement date, a one-shot's = its settlement date — later than
/// 30 days is allowed). Anyone — and the keeper's own pairUnlinkStep — may unlink it: nothing in the evidence says either coin is dead.
/// Both coins then graduate; the pair is gone for good (initialize_token cannot run twice; link_pair is policy-2 only), so the winner's
/// side never receives a forward its locked rules promise.
#[test]
fn rn2_still_a_launchlab_pair_with_both_coins_on_their_curves_is_unpaired_for_good_after_30_days() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (ka, kb) = (Keypair::new(), Keypair::new());
    init(&mut env, &ka, &att.pubkey(), buyback_rule(), Some((kb.pubkey(), false))).unwrap();
    init(&mut env, &kb, &att.pubkey(), buyback_rule(), Some((ka.pubkey(), true))).unwrap();
    let paired_at = pair_link(&env, &ka.pubkey()).unwrap().paired_at;
    // neither coin has a pool yet (both on their curves)
    assert!(!env.config(&config_pda(&ka.pubkey())).pool_verified && !env.config(&config_pda(&kb.pubkey())).pool_verified);
    let stranger = cranker(&mut env);
    env.set_time(paired_at + PAIR_UNLINK_NOT_LIVE_SECS);
    let meta = env.ok(&[ix_unlink_pair(&stranger.pubkey(), &ka.pubkey(), &kb.pubkey(), None)], &[&stranger]);
    assert_eq!(event::<burn_receipts::events::PairUnlinked>(&meta).unwrap().reason, UNLINK_NOT_LIVE);
    // day 31: both coins graduate and register normally ...
    let pa = market(&mut env, &ka);
    let _pb = market(&mut env, &kb);
    for m in [ka.pubkey(), kb.pubkey()] {
        let c = env.config(&config_pda(&m));
        assert!(c.pool_verified && c.pair_state == PAIR_STATE_NONE, "registered, but unpaired for good");
        assert!(pair_link(&env, &m).is_none());
    }
    // ... and the winner-takes-the-burn rule is gone: a result cannot be recorded, the loser burns its own supply.
    submit(&mut env, &ka.pubkey(), D1, V1, &[&att]).unwrap();
    submit(&mut env, &kb.pubkey(), D1, V1, &[&att]).unwrap();
    expect_anchor_err(submit_pair_result(&mut env, &ka.pubkey(), &kb.pubkey(), D1, Pubkey::default(), &[&att]), "AccountNotInitialized");
    submit(&mut env, &ka.pubkey(), D2, V1 + 3 * UNIT, &[&att]).unwrap();
    env.transfer_sol(&fee_pda(&ka.pubkey()), SOL);
    cpmm::seed_history(&mut env, &pa, &ka.pubkey());
    let k = cranker(&mut env);
    env.ok(&[cpmm::ix_crank_buyback(&k.pubkey(), &ka.pubkey(), &pa, D2)], &[&k]);
    assert_eq!(env.reading(&reading_pda(&config_pda(&ka.pubkey()), D2)).unwrap().outcome, OUTCOME_BURNED);
}

// =================================================================================================================================
// RI-1 — the 72 h time-out does not end the forward window
// =================================================================================================================================

/// The whitepaper / checklist say a LOST period whose forward never landed within 72 h "can no longer forward". On chain the forward
/// stays valid until a crank processes the reading: after the time-out forward_to_winner and the paired crank_buyback RACE (the keeper's
/// planner always picks the buyback; any other cranker may still forward). Harmless, but the docs and the keeper's
/// `pair-forward-missing` wording assume otherwise.
#[test]
fn ri1_still_a_lost_period_can_be_forwarded_after_the_72_hour_time_out() {
    let mut env = Env::new();
    let att = Keypair::new();
    let ((a, _pa), (b, _pb)) = paired_distinct(&mut env, &att, &att);
    env.transfer_sol(&fee_pda(&b), 2 * SOL);
    submit(&mut env, &a, D2, V1, &[&att]).unwrap();
    submit(&mut env, &b, D2, V1 + 3 * UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a, &b, D2, a, &[&att]).unwrap();
    let submitted = env.reading(&reading_pda(&config_pda(&b), D2)).unwrap().submitted_at;
    env.set_time(submitted + PAIR_RESULT_GRACE_SECS + 7 * DAY);
    let k = cranker(&mut env);
    let fa = env.lamports(&fee_pda(&a));
    env.ok(&[ix_forward_to_winner(&k.pubkey(), &b, &a, D2)], &[&k]);
    assert!(env.lamports(&fee_pda(&a)) > fa, "a week past the time-out the forward still moves the loser's fuel");
    assert_eq!(env.reading(&reading_pda(&config_pda(&b), D2)).unwrap().outcome, OUTCOME_FORWARDED);
}
