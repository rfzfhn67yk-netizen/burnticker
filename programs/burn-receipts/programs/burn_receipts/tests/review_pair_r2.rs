//! Pair-forward RE-CHECK (2026-10-11) of the round-2 fixes (program 6fc15f00, merged at 9d81ee5e) — burn_receipts tests for
//! docs/burnticker/reviews/2026-10-11-pair-forward-recheck.md. The High (RN-1, policy 2) is in programs/pair_curve/tests/review_pair_r2.rs
//! (it needs a pair_curve Pair). The re-check's `still` tests documented residuals; round 3 (2026-10-11) closed them and they are
//! INVERTED here (each now asserts the fixed behaviour):
//!
//!   M-1 residual   m1_a_side_cannot_veto_its_losses_while_collecting_its_wins            (one attester set per pair; both quorums)
//!   RN-2 (Medium)  rn2_a_launchlab_pair_with_both_coins_on_their_curves_stays_paired_until_its_void_by   (voidBy evidence)
//!   RI-1 (Info)    ri1_a_lost_period_cannot_be_forwarded_after_the_72_hour_time_out       (ForwardWindowClosed)
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

/// Two paired coins with markets and one common attester (quorum 1); both read D1 (baseline).
fn paired_common(env: &mut Env, att: &Keypair) -> ((Pubkey, Pool), (Pubkey, Pool)) {
    let (ka, kb) = (Keypair::new(), Keypair::new());
    init(env, &ka, &att.pubkey(), buyback_rule(), Some((kb.pubkey(), false))).unwrap();
    init(env, &kb, &att.pubkey(), buyback_rule(), Some((ka.pubkey(), true))).unwrap();
    let pa = market(env, &ka);
    let pb = market(env, &kb);
    submit(env, &ka.pubkey(), D1, V1, &[att]).unwrap();
    submit(env, &kb.pubkey(), D1, V1, &[att]).unwrap();
    ((ka.pubkey(), pa), (kb.pubkey(), pb))
}

// =================================================================================================================================
// M-1 residual — closed in round 3: one attester set per pair, every result signed by both quorums
// =================================================================================================================================

/// The blind review's M-1 scenario: B's attesters refuse to sign B's losses while A's sign B's wins. Round 3: two coins with
/// different attester sets cannot pair at all (PairAttestersDiffer), and with the one common set the signatures that record B's win
/// are the same that record A's win — no side has attesters of its own to withhold. (A paired coin's set changes only with the
/// partner's quorum: tests/pairs.rs m1_a_paired_coin_changes_attesters_only_with_the_partners_quorum.)
#[test]
fn m1_a_side_cannot_veto_its_losses_while_collecting_its_wins() {
    let mut env = Env::new();
    let (att_a, att_b) = (Keypair::new(), Keypair::new());
    let (ka, kb) = (Keypair::new(), Keypair::new());
    init(&mut env, &ka, &att_a.pubkey(), buyback_rule(), Some((kb.pubkey(), false))).unwrap();
    expect_anchor_err(init(&mut env, &kb, &att_b.pubkey(), buyback_rule(), Some((ka.pubkey(), true))), "PairAttestersDiffer");

    let att = Keypair::new();
    let ((a, pa), (b, _pb)) = paired_common(&mut env, &att);
    env.transfer_sol(&fee_pda(&a), 3 * SOL);
    env.transfer_sol(&fee_pda(&b), 3 * SOL);
    let k = cranker(&mut env);
    // D2: A won, B lost — recorded by the common quorum, and B's fuel moves to A.
    submit(&mut env, &a, D2, V1 + 4 * UNIT, &[&att]).unwrap();
    submit(&mut env, &b, D2, V1 + 4 * UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a, &b, D2, a, &[&att]).unwrap();
    let fa = env.lamports(&fee_pda(&a));
    env.ok(&[ix_forward_to_winner(&k.pubkey(), &b, &a, D2)], &[&k]);
    assert!(env.lamports(&fee_pda(&a)) > fa, "B's lost period moved B's fuel to A");
    // A's own D2 (won) burns A's coin with its fuel (now including B's)
    cpmm::seed_history(&mut env, &pa, &a);
    env.ok(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &a, &pa, D2, Some(b))], &[&k]);
    // D3: B won, A lost — the same signer, the other direction.
    env.set_time(env.now() + DAY);
    submit(&mut env, &a, D3, V1 + 6 * UNIT, &[&att]).unwrap();
    submit(&mut env, &b, D3, V1 + 6 * UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a, &b, D3, b, &[&att]).unwrap();
    let fb = env.lamports(&fee_pda(&b));
    env.ok(&[ix_forward_to_winner(&k.pubkey(), &a, &b, D3)], &[&k]);
    assert!(env.lamports(&fee_pda(&b)) > fb);
}

// =================================================================================================================================
// RN-2 — closed in round 3: a LaunchLab pair is unlinked only after its locked voidBy
// =================================================================================================================================

/// A LaunchLab pair (policy 0) paired at initialize_token, neither coin graduated 30 (and 60) days after the pairing: unlink_pair is
/// refused (PairStillLive) — the only LaunchLab evidence is the pair's own voidBy having ended with a coin still unverified. Both
/// coins then graduate and stay paired; once both pools are verified even an ended voidBy is no evidence.
#[test]
fn rn2_a_launchlab_pair_with_both_coins_on_their_curves_stays_paired_until_its_void_by() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (ka, kb) = (Keypair::new(), Keypair::new());
    init(&mut env, &ka, &att.pubkey(), buyback_rule(), Some((kb.pubkey(), false))).unwrap();
    init(&mut env, &kb, &att.pubkey(), buyback_rule(), Some((ka.pubkey(), true))).unwrap();
    let paired_at = pair_link(&env, &ka.pubkey()).unwrap().paired_at;
    assert!(!env.config(&config_pda(&ka.pubkey())).pool_verified && !env.config(&config_pda(&kb.pubkey())).pool_verified);
    let stranger = cranker(&mut env);
    for days in [30, 60] {
        env.set_time(paired_at + days * DAY);
        expect_anchor_err(env.send(&[ix_unlink_pair(&stranger.pubkey(), &ka.pubkey(), &kb.pubkey(), None)], &[&stranger]), "PairStillLive");
    }
    // both coins graduate and register: still paired, and a result is recorded and forwarded
    let pa = market(&mut env, &ka);
    let _pb = market(&mut env, &kb);
    for m in [ka.pubkey(), kb.pubkey()] {
        let c = env.config(&config_pda(&m));
        assert!(c.pool_verified && c.pair_state == PAIR_STATE_PAIRED);
    }
    let (e1, e2) = (math_date(env.now() - DAY), math_date(env.now()));
    submit(&mut env, &ka.pubkey(), e1, V1, &[&att]).unwrap();
    submit(&mut env, &kb.pubkey(), e1, V1, &[&att]).unwrap();
    submit(&mut env, &ka.pubkey(), e2, V1 + 3 * UNIT, &[&att]).unwrap();
    submit(&mut env, &kb.pubkey(), e2, V1, &[&att]).unwrap();
    submit_pair_result(&mut env, &ka.pubkey(), &kb.pubkey(), e2, kb.pubkey(), &[&att]).unwrap();
    env.transfer_sol(&fee_pda(&ka.pubkey()), SOL);
    let k = cranker(&mut env);
    let fb = env.lamports(&fee_pda(&kb.pubkey()));
    env.ok(&[ix_forward_to_winner(&k.pubkey(), &ka.pubkey(), &kb.pubkey(), e2)], &[&k]);
    assert!(env.lamports(&fee_pda(&kb.pubkey())) > fb, "the winner's side receives the forward its locked rules promise");
    let _ = pa;
    // after the voidBy has ended, with both pools verified: still no evidence
    env.set_time(TEST_PAIR_VOID_BY_ENDED_TS + DAY);
    expect_anchor_err(env.send(&[ix_unlink_pair(&stranger.pubkey(), &ka.pubkey(), &kb.pubkey(), None)], &[&stranger]), "PairStillLive");
}

fn math_date(ts: i64) -> u32 {
    burn_receipts::math::utc_date(ts)
}

// =================================================================================================================================
// RI-1 — closed in round 3: the 72 h time-out ends the forward window
// =================================================================================================================================

/// A LOST period whose forward never landed within 72 h can no longer forward (ForwardWindowClosed): the period belongs to the loser's
/// own crank (PairForwardMissing) — no race between forward_to_winner and the paired crank_buyback.
#[test]
fn ri1_a_lost_period_cannot_be_forwarded_after_the_72_hour_time_out() {
    let mut env = Env::new();
    let att = Keypair::new();
    let ((a, _pa), (b, pb)) = paired_common(&mut env, &att);
    env.transfer_sol(&fee_pda(&b), 2 * SOL);
    submit(&mut env, &a, D2, V1, &[&att]).unwrap();
    submit(&mut env, &b, D2, V1 + 3 * UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a, &b, D2, a, &[&att]).unwrap();
    let submitted = env.reading(&reading_pda(&config_pda(&b), D2)).unwrap().submitted_at;
    env.set_time(submitted + PAIR_RESULT_GRACE_SECS + 7 * DAY);
    let k = cranker(&mut env);
    let fa = env.lamports(&fee_pda(&a));
    expect_anchor_err(env.send(&[ix_forward_to_winner(&k.pubkey(), &b, &a, D2)], &[&k]), "ForwardWindowClosed");
    assert_eq!(env.lamports(&fee_pda(&a)), fa);
    cpmm::seed_history(&mut env, &pb, &b);
    let meta = env.ok(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &b, &pb, D2, Some(a))], &[&k]);
    assert!(event::<burn_receipts::events::PairForwardMissing>(&meta).is_some());
    assert_eq!(env.reading(&reading_pda(&config_pda(&b), D2)).unwrap().outcome, OUTCOME_BURNED);
}
