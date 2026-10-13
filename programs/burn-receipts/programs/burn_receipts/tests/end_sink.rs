//! LAUNCHPAD-PATH §45 (owner decision 2026-10-11) — END-OF-RULE FUEL GOES TO A SINK. Against the real CPMM fixture: the EndSink
//! pinned at initialize_token (kinds, bounds, refusals), submit_rule_end (quorum, dates, once), a RESOLVED end (no later readings, the
//! result reading still cranks, forward_on_end to the flagship / a named coin / the pair winner, the fall-through, the trickle, the
//! minimum, the cap), and a VOID end (the hashed wind-down keeps working).

#![allow(clippy::result_large_err, clippy::too_many_arguments, dead_code)]
mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::{AnchorDeserialize, Discriminator};
use anchor_spl::associated_token::get_associated_token_address;
use burn_receipts::constants::*;
use burn_receipts::events::{ForwardedOnEnd, SolBurnedOnEnd};
use burn_receipts::math;
use burn_receipts::state::RuleParams;
use common::cpmm::{self, Pool};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

const D1: u32 = 20261010;
const D2: u32 = 20261011;
const D3: u32 = 20261012;
const T0: i64 = NOW + 6 * 86_400; // 2026-10-15T12:00Z
const V1: u64 = 4_027_300_000_000_000;
const MIN: u64 = 10_000_000; // 0.01 SOL

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
    init_with(env, mint, vec![*attester], 1, rule, pair, 0)
}

/// As `init`, with the attester set, quorum and (r3 RN-2) the pair's voidBy (0 = the harness default TEST_PAIR_VOID_BY).
fn init_with(env: &mut Env, mint: &Keypair, attesters: Vec<Pubkey>, quorum: u8, rule: RuleParams, pair: Option<(Pubkey, bool)>, void_by: u32) -> TxResult {
    let creator = Keypair::new();
    let mut args = init_args(rule, attesters, quorum);
    args.admin = creator.pubkey();
    args.pair_void_by = void_by;
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

/// Two paired coins A and B (A initialized first naming B; B answers), one common attester (r3 M-1), both with markets; both read D1
/// (baseline).
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

/// What forward_to_winner must move: the loser's buyback_spend on min(SOL above reserve + WSOL − its carried spend (r3 RI-4), cap);
/// 0 under the floor.
fn expected_forward(env: &Env, loser: &Pubkey, date: u32) -> u64 {
    let cfg = env.config(&config_pda(loser));
    let rule = cfg.rule;
    let units = env.reading(&reading_pda(&config_pda(loser), date)).unwrap().units;
    let fee = fee_pda(loser);
    let wsol = env.svm.get_account(&get_associated_token_address(&fee, &NATIVE_MINT)).map(|_| env.token_amount(&get_associated_token_address(&fee, &NATIVE_MINT))).unwrap_or(0);
    let basis = (env.lamports(&fee).saturating_sub(rule.reserve_lamports) + wsol).saturating_sub(cfg.carried_spend_lamports).min(DEFAULT_BURN_POOL_CAP_LAMPORTS);
    let spend = math::buyback_spend(basis, units, rule.fraction_per_unit_bps).unwrap();
    if spend < rule.floor_lamports { 0 } else { spend }
}


/// initialize_token with an end sink (kind, named mint, minimum) and optionally a partner.
fn init_end(env: &mut Env, mint: &Keypair, attester: &Pubkey, rule: RuleParams, kind: u8, sink: Pubkey, min: u64, pair: Option<(Pubkey, bool)>) -> TxResult {
    let creator = Keypair::new();
    let mut args = init_args(rule, vec![*attester], 1);
    args.admin = creator.pubkey();
    args.end_sink_kind = kind;
    args.end_sink_mint = if sink == Pubkey::default() { None } else { Some(sink) };
    args.end_sink_min_lamports = min;
    let payer = env.payer.pubkey();
    let platform = (rule.mode == MODE_BUYBACK && rule.pool_policy == POOL_POLICY_CREATOR_IS_FEE_PDA).then_some(TEST_LAUNCHLAB_PLATFORM);
    let ix = ix_initialize_full(&payer, &creator.pubkey(), &mint.pubkey(), args, platform, pair.map(|p| p.0), pair.map(|p| p.1).unwrap_or(false));
    env.send(&[ix], &[&creator, mint])
}

/// The harness flagship (no end sink, perpetual) with its market; it reads D1 (baseline).
fn flagship(env: &mut Env, att: &Keypair) -> Coin {
    let fk = flagship_keypair();
    assert_eq!(fk.pubkey().to_string(), "H4JcMPicKkHcxxDjkyyrLoQj7Kcibd9t815ak4UvTr9M", "the test-pins build compiles this flagship (constants.rs)");
    init(env, &fk, &att.pubkey(), buyback_rule(), None).unwrap();
    let f = market(env, &fk);
    submit(env, &f.mint, D1, V1, &[att]).unwrap();
    f
}

/// A coin with an end sink and a market; reads D1 (baseline) and D2 (`units` units); its fee PDA holds `fuel` extra lamports.
fn ending_coin(env: &mut Env, att: &Keypair, kind: u8, sink: Pubkey, fuel: u64, units: u64) -> Coin {
    let k = Keypair::new();
    init_end(env, &k, &att.pubkey(), buyback_rule(), kind, sink, MIN, None).unwrap();
    let c = market(env, &k);
    submit(env, &c.mint, D1, V1, &[att]).unwrap();
    submit(env, &c.mint, D2, V1 + units * UNIT, &[att]).unwrap();
    env.transfer_sol(&fee_pda(&c.mint), fuel);
    c
}

fn spendable(env: &Env, mint: &Pubkey) -> u64 {
    let rule = env.config(&config_pda(mint)).rule;
    let fee = fee_pda(mint);
    let w = get_associated_token_address(&fee, &NATIVE_MINT);
    let wsol = env.svm.get_account(&w).map(|_| env.token_amount(&w)).unwrap_or(0);
    env.lamports(&fee).saturating_sub(rule.reserve_lamports) + wsol
}

fn crank(env: &mut Env, k: &Keypair, c: &Coin, date: u32) -> TxResult {
    cpmm::seed_history(env, &c.pool, &c.mint);
    env.send(&[cpmm::ix_crank_buyback(&k.pubkey(), &c.mint, &c.pool, date)], &[k])
}

// =================================================================================================================================
// the end sink at initialize_token
// =================================================================================================================================

#[test]
fn an_end_sink_is_pinned_at_initialize_token_and_bad_ones_are_refused() {
    let mut env = Env::new();
    let att = Keypair::new();
    let k = Keypair::new();
    let other = Pubkey::new_unique();
    // vault mode, a league set, minimum out of bounds, a self / default named coin, a pair winner without a pair: refused
    expect_anchor_err(init_end(&mut env, &k, &att.pubkey(), vault_rule(), END_SINK_FLAGSHIP, Pubkey::default(), MIN, None), "InvalidEndSink");
    expect_anchor_err(init_end(&mut env, &k, &att.pubkey(), buyback_rule(), END_SINK_LEAGUE_SET, other, MIN, None), "InvalidEndSink");
    expect_anchor_err(init_end(&mut env, &k, &att.pubkey(), buyback_rule(), END_SINK_FLAGSHIP, Pubkey::default(), END_FORWARD_MIN_LAMPORTS_FLOOR - 1, None), "InvalidEndSink");
    expect_anchor_err(init_end(&mut env, &k, &att.pubkey(), buyback_rule(), END_SINK_FLAGSHIP, Pubkey::default(), END_FORWARD_MIN_LAMPORTS_CEIL + 1, None), "InvalidEndSink");
    expect_anchor_err(init_end(&mut env, &k, &att.pubkey(), buyback_rule(), END_SINK_FLAGSHIP, other, MIN, None), "InvalidEndSink");
    expect_anchor_err(init_end(&mut env, &k, &att.pubkey(), buyback_rule(), END_SINK_MINT, k.pubkey(), MIN, None), "InvalidEndSink");
    expect_anchor_err(init_end(&mut env, &k, &att.pubkey(), buyback_rule(), END_SINK_MINT, Pubkey::default(), MIN, None), "InvalidEndSink");
    expect_anchor_err(init_end(&mut env, &k, &att.pubkey(), buyback_rule(), END_SINK_PAIR_WINNER, other, MIN, None), "InvalidEndSink");
    expect_anchor_err(init_end(&mut env, &k, &att.pubkey(), buyback_rule(), 9, other, MIN, None), "InvalidEndSink");
    // a pair winner must be the partner named at init
    expect_anchor_err(init_end(&mut env, &k, &att.pubkey(), buyback_rule(), END_SINK_PAIR_WINNER, other, MIN, Some((Pubkey::new_unique(), false))), "InvalidEndSink");
    // the flagship itself has no end sink (perpetual)
    expect_anchor_err(init_end(&mut env, &flagship_keypair(), &att.pubkey(), buyback_rule(), END_SINK_FLAGSHIP, Pubkey::default(), MIN, None), "InvalidEndSink");
    // end-sink args without the account
    let creator = Keypair::new();
    let mut args = init_args(buyback_rule(), vec![att.pubkey()], 1);
    args.admin = creator.pubkey();
    args.end_sink_kind = END_SINK_MINT;
    args.end_sink_mint = Some(other);
    let payer = env.payer.pubkey();
    let ix = ix_initialize_full(&payer, &creator.pubkey(), &k.pubkey(), args, Some(TEST_LAUNCHLAB_PLATFORM), None, false);
    expect_anchor_err(env.send(&[ix], &[&creator, &k]), "InvalidEndSink");
    // a flagship sink (default named mint → the flagship), then a named coin
    init_end(&mut env, &k, &att.pubkey(), buyback_rule(), END_SINK_FLAGSHIP, Pubkey::default(), MIN, None).unwrap();
    let s = end_sink(&env, &k.pubkey()).unwrap();
    assert_eq!((s.mint, s.sink_kind, s.sink_mint, s.min_forward_lamports), (k.pubkey(), END_SINK_FLAGSHIP, flagship_keypair().pubkey(), MIN));
    let k2 = Keypair::new();
    init_end(&mut env, &k2, &att.pubkey(), buyback_rule(), END_SINK_MINT, other, END_FORWARD_MIN_LAMPORTS_CEIL, None).unwrap();
    assert_eq!(end_sink(&env, &k2.pubkey()).unwrap().sink_mint, other);
    let c = env.config(&config_pda(&k2.pubkey()));
    assert_eq!((c.end_state, c.end_date), (END_STATE_LIVE, 0));
    // a LaunchLab pair names its partner as the pair-winner sink
    let (ka, kb) = (Keypair::new(), Keypair::new());
    init_end(&mut env, &ka, &att.pubkey(), buyback_rule(), END_SINK_PAIR_WINNER, kb.pubkey(), MIN, Some((kb.pubkey(), false))).unwrap();
    init_end(&mut env, &kb, &att.pubkey(), buyback_rule(), END_SINK_PAIR_WINNER, ka.pubkey(), MIN, Some((ka.pubkey(), true))).unwrap();
    assert_eq!(end_sink(&env, &kb.pubkey()).unwrap().sink_mint, ka.pubkey());
    // …and may leave the named coin out (None = the pair_mint of the same instruction: 31 bytes fewer in the create)
    let (kc, kd) = (Keypair::new(), Keypair::new());
    init_end(&mut env, &kc, &att.pubkey(), buyback_rule(), END_SINK_PAIR_WINNER, Pubkey::default(), MIN, Some((kd.pubkey(), false))).unwrap();
    assert_eq!(end_sink(&env, &kc.pubkey()).unwrap().sink_mint, kd.pubkey());
    // a named mint without a pair, or a pair winner without a partner anywhere: refused
    expect_anchor_err(init_end(&mut env, &Keypair::new(), &att.pubkey(), buyback_rule(), END_SINK_PAIR_WINNER, Pubkey::default(), MIN, None), "InvalidEndSink");
    // a coin without an end sink has no EndSink account
    let k3 = Keypair::new();
    init(&mut env, &k3, &att.pubkey(), buyback_rule(), None).unwrap();
    assert!(end_sink(&env, &k3.pubkey()).is_none());
}

// =================================================================================================================================
// submit_rule_end
// =================================================================================================================================

#[test]
fn submit_rule_end_needs_an_end_sink_a_quorum_and_a_valid_date_and_runs_once() {
    let mut env = Env::new();
    let att = Keypair::new();
    // a coin without an end sink cannot end (it keeps its hashed wind-down)
    let kl = Keypair::new();
    init(&mut env, &kl, &att.pubkey(), buyback_rule(), None).unwrap();
    env.set_time(T0);
    expect_anchor_err(submit_rule_end(&mut env, &kl.pubkey(), D2, END_STATE_RESOLVED, &[&att]), "AccountNotInitialized");
    let c = ending_coin(&mut env, &att, END_SINK_FLAGSHIP, Pubkey::default(), SOL, 3);
    expect_anchor_err(submit_rule_end(&mut env, &c.mint, D1, END_STATE_RESOLVED, &[&att]), "InvalidRuleEnd"); // before the last reading
    expect_anchor_err(submit_rule_end(&mut env, &c.mint, 20991231, END_STATE_RESOLVED, &[&att]), "InvalidRuleEnd"); // future
    expect_anchor_err(submit_rule_end(&mut env, &c.mint, D2, 0, &[&att]), "InvalidRuleEnd");
    expect_anchor_err(submit_rule_end(&mut env, &c.mint, D2, 3, &[&att]), "InvalidRuleEnd");
    expect_anchor_err(submit_rule_end(&mut env, &c.mint, D2, END_STATE_RESOLVED, &[&Keypair::new()]), "QuorumNotMet");
    // a signature over the other outcome does not count
    let msg = end_message(&c.mint, D2, END_STATE_VOID, src_hash(), [0u8; 32]);
    let payer = env.payer.pubkey();
    let r = env.send(&[ed25519_shared(&[(att.pubkey(), sign(&att, &msg))], &msg), ix_submit_rule_end(&payer, &c.mint, D2, END_STATE_RESOLVED, src_hash(), [0u8; 32])], &[]);
    expect_anchor_err(r, "QuorumNotMet");
    // blind review M-1: the end is dated exactly the last reading (D2), never later (a later date would let the fuel go before a result)
    expect_anchor_err(submit_rule_end(&mut env, &c.mint, D3, END_STATE_RESOLVED, &[&att]), "InvalidRuleEnd");
    submit_rule_end(&mut env, &c.mint, D2, END_STATE_RESOLVED, &[&att]).unwrap();
    let re = rule_end(&env, &c.mint).unwrap();
    assert_eq!((re.mint, re.record_date, re.outcome, re.signers_mask, re.forwarded_lamports, re.forwards), (c.mint, D2, END_STATE_RESOLVED, 1, 0, 0));
    let cfg = env.config(&config_pda(&c.mint));
    assert_eq!((cfg.end_state, cfg.end_date), (END_STATE_RESOLVED, D2));
    // once only
    env.set_time(env.now() + 1);
    assert!(submit_rule_end(&mut env, &c.mint, D2, END_STATE_VOID, &[&att]).is_err());
    // the message text
    let m = burn_receipts::attest::canonical_end_message(&burn_receipts::ID, &c.mint, D3, END_STATE_RESOLVED, &[0xab; 32], &[0; 32]);
    assert_eq!(m, format!("BURNRECEIPTS-END-v1|{}|{}|{}|2026-10-12|outcome=resolved|src={}|proof={}", CLUSTER_GENESIS_HASH, burn_receipts::ID, c.mint, "ab".repeat(32), "00".repeat(32)));
    assert!(burn_receipts::attest::canonical_end_message(&burn_receipts::ID, &c.mint, D3, END_STATE_VOID, &[0xab; 32], &[0; 32]).contains("|outcome=void|"));
    assert_eq!(burn_receipts::memo::format_end_forward("DEBT", &c.mint, 42), format!("DEBT|endfwd|to={}|lamports=42|v1", &c.mint.to_string()[..12]));
}

// =================================================================================================================================
// a RESOLVED end
// =================================================================================================================================

/// The result reading that ended the rule still cranks; nothing dated later can be read; then forward_on_end moves the rest of the
/// fuel (SOL above the reserve + WSOL) to the flagship, refuses under the minimum, and moves the later trickle; the flagship burns it.
#[test]
fn a_resolved_coin_forwards_its_remaining_fuel_and_later_trickle_to_the_flagship() {
    let mut env = Env::new();
    let att = Keypair::new();
    let f = flagship(&mut env, &att);
    let c = ending_coin(&mut env, &att, END_SINK_FLAGSHIP, Pubkey::default(), 3 * SOL, 4);
    let k = cranker(&mut env);
    // forward_on_end before any end
    expect_anchor_err(env.send(&[ix_forward_on_end(&k.pubkey(), &c.mint, &f.mint, None, None)], &[&k]), "AccountNotInitialized");
    submit_rule_end(&mut env, &c.mint, D2, END_STATE_RESOLVED, &[&att]).unwrap();
    // no reading after the end
    env.set_time(T0 + 86_400);
    expect_anchor_err(submit(&mut env, &c.mint, D3, V1 + 9 * UNIT, &[&att]), "RuleEnded");
    // D2 (the result reading) is still pending: no forward yet
    expect_anchor_err(env.send(&[ix_forward_on_end(&k.pubkey(), &c.mint, &f.mint, None, None)], &[&k]), "EndReadingsPending");
    crank(&mut env, &k, &c, D2).unwrap();
    assert_eq!(env.reading(&reading_pda(&config_pda(&c.mint), D2)).unwrap().outcome, OUTCOME_BURNED);
    // WSOL in the fee PDA counts too (fee income after the end)
    let fw = get_associated_token_address(&fee_pda(&c.mint), &NATIVE_MINT);
    env.ok(&[anchor_lang::solana_program::system_instruction::transfer(&env.payer.pubkey(), &fw, 200_000_000), anchor_spl::token::spl_token::instruction::sync_native(&anchor_spl::token::ID, &fw).unwrap()], &[]);
    // the target is decided by the program
    let y = Keypair::new();
    init(&mut env, &y, &att.pubkey(), buyback_rule(), None).unwrap();
    let y = market(&mut env, &y);
    expect_anchor_err(env.send(&[ix_forward_on_end(&k.pubkey(), &c.mint, &y.mint, None, None)], &[&k]), "EndSinkMismatch");
    // the forward
    let want = spendable(&env, &c.mint);
    let ff0 = env.lamports(&fee_pda(&f.mint)) + env.token_amount(&get_associated_token_address(&fee_pda(&f.mint), &NATIVE_MINT));
    let meta = env.ok(&[ix_forward_on_end(&k.pubkey(), &c.mint, &f.mint, None, None)], &[&k]);
    let ev: ForwardedOnEnd = event(&meta).expect("ForwardedOnEnd");
    assert_eq!((ev.mint, ev.to_mint, ev.intended_mint, ev.sink_kind, ev.lamports), (c.mint, f.mint, f.mint, END_SINK_FLAGSHIP, want));
    assert!(ev.wsol_lamports > 0 && ev.sol_lamports + ev.wsol_lamports == want);
    assert!(meta.logs.iter().any(|l| l.contains(&format!("|endfwd|to={}|lamports={want}|v1", &f.mint.to_string()[..12]))));
    let ff1 = env.lamports(&fee_pda(&f.mint)) + env.token_amount(&get_associated_token_address(&fee_pda(&f.mint), &NATIVE_MINT));
    assert_eq!(ff1 - ff0, want);
    assert_eq!(spendable(&env, &c.mint), 0, "only the reserve is left");
    let re = rule_end(&env, &c.mint).unwrap();
    assert_eq!((re.forwarded_lamports, re.forwards), (want, 1));
    // nothing left: refused; a trickle above the minimum: forwarded again
    expect_anchor_err(env.send(&[ix_forward_on_end(&k.pubkey(), &c.mint, &f.mint, None, None)], &[&k]), "NothingToForward");
    env.transfer_sol(&fee_pda(&c.mint), MIN - 1);
    expect_anchor_err(env.send(&[ix_forward_on_end(&k.pubkey(), &c.mint, &f.mint, None, None)], &[&k]), "NothingToForward");
    env.transfer_sol(&fee_pda(&c.mint), 1);
    env.set_time(env.now() + 1);
    env.ok(&[ix_forward_on_end(&k.pubkey(), &c.mint, &f.mint, None, None)], &[&k]);
    assert_eq!(rule_end(&env, &c.mint).unwrap().forwards, 2);
    // the flagship's next burn spends it
    submit(&mut env, &f.mint, D2, V1 + 50 * UNIT, &[&att]).unwrap();
    let supply = env.mint_supply(&f.mint);
    crank(&mut env, &k, &f, D2).unwrap();
    assert!(env.mint_supply(&f.mint) < supply, "the flagship burned");
}

/// The burn-pool cap bounds one forward; the carried spend is cleared; a reading dated after the end never cranks.
#[test]
fn a_forward_on_end_is_capped_and_a_reading_after_a_resolved_end_never_cranks() {
    let mut env = Env::new();
    let att = Keypair::new();
    let f = flagship(&mut env, &att);
    let c = ending_coin(&mut env, &att, END_SINK_FLAGSHIP, Pubkey::default(), 30 * SOL, 2);
    patch_config(&mut env, &c.mint, |x| x.carried_spend_lamports = SOL);
    submit_rule_end(&mut env, &c.mint, D2, END_STATE_RESOLVED, &[&att]).unwrap();
    let k = cranker(&mut env);
    // (defence in depth) a reading dated after the end — impossible through submit_reading — is refused by the crank
    patch_config(&mut env, &c.mint, |x| x.end_date = D1);
    expect_anchor_err(crank(&mut env, &k, &c, D2), "ForwardOnEndRequired");
    patch_config(&mut env, &c.mint, |x| x.end_date = D2);
    crank(&mut env, &k, &c, D2).unwrap();
    let before = env.lamports(&fee_pda(&c.mint));
    let meta = env.ok(&[ix_forward_on_end(&k.pubkey(), &c.mint, &f.mint, None, None)], &[&k]);
    let ev: ForwardedOnEnd = event(&meta).unwrap();
    assert_eq!(ev.lamports, DEFAULT_BURN_POOL_CAP_LAMPORTS);
    assert_eq!(before - env.lamports(&fee_pda(&c.mint)), DEFAULT_BURN_POOL_CAP_LAMPORTS);
    assert_eq!(env.config(&config_pda(&c.mint)).carried_spend_lamports, 0);
    // the rest goes on the next call
    env.set_time(env.now() + 1);
    env.ok(&[ix_forward_on_end(&k.pubkey(), &c.mint, &f.mint, None, None)], &[&k]);
    assert_eq!(spendable(&env, &c.mint), 0);
}

/// MINT: the named coin while it is live; otherwise (no verified pool, or its own rule ended) the flagship.
#[test]
fn a_named_sink_receives_while_live_and_the_flagship_otherwise() {
    let mut env = Env::new();
    let att = Keypair::new();
    let f = flagship(&mut env, &att);
    let ks = Keypair::new();
    init(&mut env, &ks, &att.pubkey(), buyback_rule(), None).unwrap();
    let s = market(&mut env, &ks);
    let c = ending_coin(&mut env, &att, END_SINK_MINT, s.mint, 2 * SOL, 0);
    submit_rule_end(&mut env, &c.mint, D2, END_STATE_RESOLVED, &[&att]).unwrap();
    let k = cranker(&mut env);
    // the zero-unit D2 was processed on submission: the forward can run
    expect_anchor_err(env.send(&[ix_forward_on_end(&k.pubkey(), &c.mint, &s.mint, None, None)], &[&k]), "EndSinkMismatch"); // sink_config missing
    expect_anchor_err(env.send(&[ix_forward_on_end(&k.pubkey(), &c.mint, &f.mint, Some(s.mint), None)], &[&k]), "EndSinkMismatch"); // the sink is live
    let fs = env.lamports(&fee_pda(&s.mint));
    let meta = env.ok(&[ix_forward_on_end(&k.pubkey(), &c.mint, &s.mint, Some(s.mint), None)], &[&k]);
    let ev: ForwardedOnEnd = event(&meta).unwrap();
    assert_eq!((ev.to_mint, ev.intended_mint, ev.sink_kind), (s.mint, s.mint, END_SINK_MINT));
    assert!(env.lamports(&fee_pda(&s.mint)) > fs);
    // the sink's pool is switched away: the trickle goes to the flagship
    patch_config(&mut env, &s.mint, |x| x.pool_verified = false);
    env.transfer_sol(&fee_pda(&c.mint), 2 * MIN);
    env.set_time(env.now() + 1);
    expect_anchor_err(env.send(&[ix_forward_on_end(&k.pubkey(), &c.mint, &s.mint, Some(s.mint), None)], &[&k]), "EndSinkMismatch");
    let meta = env.ok(&[ix_forward_on_end(&k.pubkey(), &c.mint, &f.mint, Some(s.mint), None)], &[&k]);
    let ev: ForwardedOnEnd = event(&meta).unwrap();
    assert_eq!((ev.to_mint, ev.intended_mint), (f.mint, s.mint));
    // the sink live again but its own rule ended: the flagship
    patch_config(&mut env, &s.mint, |x| {
        x.pool_verified = true;
        x.end_state = END_STATE_RESOLVED;
    });
    env.transfer_sol(&fee_pda(&c.mint), 2 * MIN);
    env.set_time(env.now() + 1);
    env.ok(&[ix_forward_on_end(&k.pubkey(), &c.mint, &f.mint, Some(s.mint), None)], &[&k]);
    // the flagship without a verified pool: nothing moves
    patch_config(&mut env, &f.mint, |x| x.pool_verified = false);
    env.transfer_sol(&fee_pda(&c.mint), 2 * MIN);
    env.set_time(env.now() + 1);
    expect_anchor_err(env.send(&[ix_forward_on_end(&k.pubkey(), &c.mint, &f.mint, Some(s.mint), None)], &[&k]), "FlagshipNotLive");
}

/// PAIR_WINNER (item 5): after a resolved end, a pair side's remainder goes to its partner only when the end date's PairResult names
/// the partner as winner and the partner is live and still paired — the same "live" as forward_to_winner — else to the flagship.
#[test]
fn a_pair_sides_remainder_goes_to_the_partner_that_won_the_final_period_else_the_flagship() {
    let mut env = Env::new();
    let att = Keypair::new();
    let (ka, kb) = (Keypair::new(), Keypair::new());
    init_end(&mut env, &ka, &att.pubkey(), buyback_rule(), END_SINK_PAIR_WINNER, kb.pubkey(), MIN, Some((kb.pubkey(), false))).unwrap();
    init_end(&mut env, &kb, &att.pubkey(), buyback_rule(), END_SINK_PAIR_WINNER, ka.pubkey(), MIN, Some((ka.pubkey(), true))).unwrap();
    let f = flagship(&mut env, &att);
    let a = market(&mut env, &ka);
    let b = market(&mut env, &kb);
    for m in [a.mint, b.mint] {
        submit(&mut env, &m, D1, V1, &[&att]).unwrap();
        env.transfer_sol(&fee_pda(&m), 2 * SOL);
    }
    // the final period D2: A wins; B's fuel for it moves by forward_to_winner; both rules end resolved on D2
    submit(&mut env, &a.mint, D2, V1 + 2 * UNIT, &[&att]).unwrap();
    submit(&mut env, &b.mint, D2, V1 + 5 * UNIT, &[&att]).unwrap();
    submit_pair_result(&mut env, &a.mint, &b.mint, D2, a.mint, &[&att]).unwrap();
    let k = cranker(&mut env);
    env.ok(&[ix_forward_to_winner(&k.pubkey(), &b.mint, &a.mint, D2)], &[&k]);
    submit_rule_end(&mut env, &b.mint, D2, END_STATE_RESOLVED, &[&att]).unwrap();
    // B (the loser): its remainder goes to A, the live winner of the final period — never to the flagship meanwhile
    expect_anchor_err(env.send(&[ix_forward_on_end(&k.pubkey(), &b.mint, &f.mint, Some(a.mint), Some((a.mint, D2)))], &[&k]), "EndSinkMismatch");
    expect_anchor_err(env.send(&[ix_forward_on_end(&k.pubkey(), &b.mint, &a.mint, Some(a.mint), None)], &[&k]), "EndSinkMismatch"); // pair accounts missing
    let meta = env.ok(&[ix_forward_on_end(&k.pubkey(), &b.mint, &a.mint, Some(a.mint), Some((a.mint, D2)))], &[&k]);
    let ev: ForwardedOnEnd = event(&meta).unwrap();
    assert_eq!((ev.to_mint, ev.intended_mint, ev.sink_kind), (a.mint, a.mint, END_SINK_PAIR_WINNER));
    // A (the winner) ends too: its own sink is B, which did not win — A's remainder goes to the flagship
    cpmm::seed_history(&mut env, &a.pool, &a.mint);
    env.ok(&[cpmm::ix_crank_buyback_paired(&k.pubkey(), &a.mint, &a.pool, D2, Some(b.mint))], &[&k]);
    submit_rule_end(&mut env, &a.mint, D2, END_STATE_RESOLVED, &[&att]).unwrap();
    expect_anchor_err(env.send(&[ix_forward_on_end(&k.pubkey(), &a.mint, &b.mint, Some(b.mint), Some((b.mint, D2)))], &[&k]), "EndSinkMismatch");
    let meta = env.ok(&[ix_forward_on_end(&k.pubkey(), &a.mint, &f.mint, Some(b.mint), Some((b.mint, D2)))], &[&k]);
    let ev: ForwardedOnEnd = event(&meta).unwrap();
    assert_eq!((ev.to_mint, ev.intended_mint), (f.mint, f.mint));
    // B's later trickle: A has ended (not live) — the flagship
    env.transfer_sol(&fee_pda(&b.mint), 2 * MIN);
    env.set_time(env.now() + 1);
    let meta = env.ok(&[ix_forward_on_end(&k.pubkey(), &b.mint, &f.mint, Some(a.mint), Some((a.mint, D2)))], &[&k]);
    let ev: ForwardedOnEnd = event(&meta).unwrap();
    assert_eq!((ev.to_mint, ev.intended_mint), (f.mint, a.mint));
}

// =================================================================================================================================
// a VOID end
// =================================================================================================================================

/// A VOID end changes nothing about the burns: the hashed wind-down readings (dated after the end) are accepted and cranked; there is
/// no forward_on_end.
#[test]
fn a_void_end_keeps_the_hashed_wind_down() {
    let mut env = Env::new();
    let att = Keypair::new();
    let f = flagship(&mut env, &att);
    let c = ending_coin(&mut env, &att, END_SINK_FLAGSHIP, Pubkey::default(), 2 * SOL, 0);
    submit_rule_end(&mut env, &c.mint, D2, END_STATE_VOID, &[&att]).unwrap();
    assert_eq!(env.config(&config_pda(&c.mint)).end_state, END_STATE_VOID);
    let k = cranker(&mut env);
    expect_anchor_err(env.send(&[ix_forward_on_end(&k.pubkey(), &c.mint, &f.mint, None, None)], &[&k]), "NotEndedResolved");
    // a wind-down day after the end
    env.set_time(T0 + 86_400);
    submit(&mut env, &c.mint, D3, V1 + 7 * UNIT, &[&att]).unwrap();
    let supply = env.mint_supply(&c.mint);
    crank(&mut env, &k, &c, D3).unwrap();
    assert!(env.mint_supply(&c.mint) < supply, "the coin burned its own supply on its wind-down");
}

/// A resolved coin that never got a verified pool (a one-shot whose curve never graduated) cannot crank its result reading — its fuel
/// still goes to the sink.
#[test]
fn a_resolved_coin_without_a_pool_forwards_despite_its_uncrankable_reading() {
    let mut env = Env::new();
    let att = Keypair::new();
    let f = flagship(&mut env, &att);
    let k = Keypair::new();
    init_end(&mut env, &k, &att.pubkey(), buyback_rule(), END_SINK_FLAGSHIP, Pubkey::default(), MIN, None).unwrap();
    let m = k.pubkey();
    submit(&mut env, &m, D1, V1, &[&att]).unwrap();
    submit(&mut env, &m, D2, V1 + 5 * UNIT, &[&att]).unwrap();
    env.transfer_sol(&fee_pda(&m), SOL);
    submit_rule_end(&mut env, &m, D2, END_STATE_RESOLVED, &[&att]).unwrap();
    assert!(!env.config(&config_pda(&m)).pool_verified);
    let kc = cranker(&mut env);
    let ff = env.lamports(&fee_pda(&f.mint));
    env.ok(&[ix_forward_on_end(&kc.pubkey(), &m, &f.mint, None, None)], &[&kc]);
    assert_eq!(env.lamports(&fee_pda(&f.mint)) - ff, SOL);
}

/// Blind review H-1: a named coin that never launched (no TokenConfig) is not live; the fuel goes to the flagship, never stranded.
/// Blind review M-3: the first forward moves whatever is there even under the minimum; the minimum gates only the later trickle.
#[test]
fn a_named_sink_that_never_launched_falls_to_the_flagship_and_the_first_forward_ignores_the_minimum() {
    let mut env = Env::new();
    let att = Keypair::new();
    let f = flagship(&mut env, &att);
    let ghost = Pubkey::new_unique();
    let c = ending_coin(&mut env, &att, END_SINK_MINT, ghost, 0, 0);
    submit_rule_end(&mut env, &c.mint, D2, END_STATE_RESOLVED, &[&att]).unwrap();
    let k = cranker(&mut env);
    env.transfer_sol(&fee_pda(&c.mint), MIN / 2);                       // under the minimum
    expect_anchor_err(env.send(&[ix_forward_on_end(&k.pubkey(), &c.mint, &ghost, Some(ghost), None)], &[&k]), "AccountNotInitialized");
    let meta = env.ok(&[ix_forward_on_end(&k.pubkey(), &c.mint, &f.mint, Some(ghost), None)], &[&k]);
    let ev: ForwardedOnEnd = event(&meta).unwrap();
    assert_eq!((ev.to_mint, ev.intended_mint, ev.lamports), (f.mint, ghost, MIN / 2));
    // the later trickle waits for the minimum
    env.transfer_sol(&fee_pda(&c.mint), MIN / 2);
    env.set_time(env.now() + 1);
    expect_anchor_err(env.send(&[ix_forward_on_end(&k.pubkey(), &c.mint, &f.mint, Some(ghost), None)], &[&k]), "NothingToForward");
}

// =================================================================================================================================
// ROUND-3 ACCOUNTS UNDER ROUND 4 (the mainnet upgrade, 2026-10-16): layout compatibility
// =================================================================================================================================
//
// Round 4 changes no account's size or field order except TokenConfig, where `end_state: u8` and `end_date: u32` are carved from the
// old `reserved: [u8; 6]` (now `[u8; 1]`): same size, every earlier field at the same offset, and a round-3 account's zero reserved bytes
// read as END_STATE_LIVE / end_date 0. Pair (pair_curve), PairLink, PairResult, FeeKeyRecord, Reading and PlatformConfig are unchanged.
// So an old account needs no migration and no versioned decoder: Borsh reads it as it is. The fixture below is a TokenConfig written BY
// THE ROUND-3 PROGRAM (the deployed source, built --features test-pins) for a fixed mint, creator and clock; regenerate it with
//   cp <round-3 test-pins build> target/deploy-test/burn_receipts.so && R3_FIXTURE_OUT=fixtures/round3-token-config.hex \
//     cargo test -p burn_receipts --test end_sink write_round3_token_config_fixture -- --ignored   (then rebuild the round-4 test-pins .so)

const R3_FIXTURE: &str = "fixtures/round3-token-config.hex";
const R3_CLOCK: i64 = NOW + 86_400;

fn r3_keys() -> (Keypair, Keypair, Keypair) {
    (Keypair::new_from_array([0x31; 32]), Keypair::new_from_array([0x32; 32]), Keypair::new_from_array([0x33; 32]))
}

/// initialize_token for the fixed mint, creator and attester, in the given layout (round 3: no end_sink slot, no end-sink args).
fn r3_init_ix(env: &Env, mint: &Keypair, creator: &Keypair, attester: &Keypair, round3: bool) -> anchor_lang::solana_program::instruction::Instruction {
    let mut args = init_args(buyback_rule(), vec![attester.pubkey()], 1);
    args.admin = creator.pubkey();
    let mut ix = ix_initialize_full(&env.payer.pubkey(), &creator.pubkey(), &mint.pubkey(), args, Some(TEST_LAUNCHLAB_PLATFORM), None, false);
    if round3 {
        // the end_sink slot sits right before event_authority + program (the last two metas); the three end-sink args are the last 10 bytes
        let n = ix.accounts.len();
        ix.accounts.remove(n - 3);
        ix.data.truncate(ix.data.len() - 10);
    }
    ix
}

#[test]
#[ignore = "generator: run with the ROUND-3 test-pins build in target/deploy-test and R3_FIXTURE_OUT set"]
fn write_round3_token_config_fixture() {
    let out = std::env::var("R3_FIXTURE_OUT").expect("R3_FIXTURE_OUT");
    let mut env = Env::new();
    env.set_time(R3_CLOCK);
    let (mint, creator, att) = r3_keys();
    let ix = r3_init_ix(&env, &mint, &creator, &att, true);
    env.ok(&[ix], &[&creator, &mint]);
    let data = env.svm.get_account(&config_pda(&mint.pubkey())).unwrap().data;
    std::fs::write(out, data.iter().map(|b| format!("{b:02x}")).collect::<String>()).unwrap();
}

#[test]
fn a_round3_token_config_reads_and_cranks_unchanged_under_round4() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(R3_FIXTURE);
    let hex = std::fs::read_to_string(&path).expect("the round-3 fixture");
    let hex = hex.trim();
    let r3: Vec<u8> = (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap()).collect();
    // Borsh under round 4: the account deserialises, and the new fields read live / 0
    let cfg = <burn_receipts::state::TokenConfig as anchor_lang::AccountDeserialize>::try_deserialize(&mut &r3[..]).unwrap();
    let (mint, creator, att) = r3_keys();
    assert_eq!((cfg.mint, cfg.admin, cfg.end_state, cfg.end_date), (mint.pubkey(), creator.pubkey(), END_STATE_LIVE, 0));
    // the round-4 program writes the SAME bytes for the same inputs (no end sink): identical size and layout
    let mut env = Env::new();
    env.set_time(R3_CLOCK);
    let ix = r3_init_ix(&env, &mint, &creator, &att, false);
    env.ok(&[ix], &[&creator, &mint]);
    let key = config_pda(&mint.pubkey());
    let mut acc = env.svm.get_account(&key).unwrap();
    assert_eq!(acc.data.len(), r3.len(), "same account size");
    assert_eq!(acc.data, r3, "byte-identical: round 4 reads and writes the round-3 layout");
    // run the round-3 account itself through round 4: readings, the crank, the burn
    acc.data = r3.clone();
    env.svm.set_account(key, acc).unwrap();
    let c = market(&mut env, &mint);
    submit(&mut env, &c.mint, D1, V1, &[&att]).unwrap();
    submit(&mut env, &c.mint, D2, V1 + 3 * UNIT, &[&att]).unwrap();
    env.transfer_sol(&fee_pda(&c.mint), 2 * SOL);
    let k = cranker(&mut env);
    let supply = env.mint_supply(&c.mint);
    crank(&mut env, &k, &c, D2).unwrap();
    assert_eq!(env.reading(&reading_pda(&config_pda(&c.mint), D2)).unwrap().outcome, OUTCOME_BURNED);
    assert!(env.mint_supply(&c.mint) < supply, "the round-3 coin burned under round 4");
}


// =================================================================================================================================
// the incinerator end sink (owner, 2026-10-13): burn the SOL itself
// =================================================================================================================================

#[test]
fn the_incinerator_sink_is_pinned_with_its_address_and_names_nothing_else() {
    let mut env = Env::new();
    let att = Keypair::new();
    let _f = flagship(&mut env, &att);
    let k = Keypair::new();
    init_end(&mut env, &k, &att.pubkey(), buyback_rule(), END_SINK_INCINERATOR, Pubkey::default(), MIN, None).unwrap();
    let s = end_sink(&env, &k.pubkey()).unwrap();
    assert_eq!((s.sink_kind, s.sink_mint), (END_SINK_INCINERATOR, INCINERATOR_ID));
    assert_eq!(INCINERATOR_ID.to_string(), "1nc1nerator11111111111111111111111111111111");
    assert!(!INCINERATOR_ID.is_on_curve(), "no key can sign for the incinerator");
    // naming anything but the incinerator is refused
    let k2 = Keypair::new();
    expect_anchor_err(init_end(&mut env, &k2, &att.pubkey(), buyback_rule(), END_SINK_INCINERATOR, Pubkey::new_unique(), MIN, None), "InvalidEndSink");
    init_end(&mut env, &k2, &att.pubkey(), buyback_rule(), END_SINK_INCINERATOR, INCINERATOR_ID, MIN, None).unwrap();
}

/// After a RESOLVED end the SOL above the reserve (the WSOL unwrapped first) lands at the incinerator and nowhere else; the fee PDA keeps
/// its reserve and its WSOL account; the cranker pays only its fee; forward_on_end refuses this kind; a wrong destination is refused.
#[test]
fn a_resolved_incinerator_coin_sends_its_sol_to_the_incinerator_and_nothing_else_moves() {
    let mut env = Env::new();
    let att = Keypair::new();
    let f = flagship(&mut env, &att);
    let c = ending_coin(&mut env, &att, END_SINK_INCINERATOR, Pubkey::default(), 3 * SOL, 4);
    let k = cranker(&mut env);
    expect_anchor_err(env.send(&[ix_burn_sol_on_end(&k.pubkey(), &c.mint, &INCINERATOR_ID)], &[&k]), "AccountNotInitialized");
    submit_rule_end(&mut env, &c.mint, D2, END_STATE_RESOLVED, &[&att]).unwrap();
    expect_anchor_err(env.send(&[ix_burn_sol_on_end(&k.pubkey(), &c.mint, &INCINERATOR_ID)], &[&k]), "EndReadingsPending");
    env.set_time(T0 + 86_400);
    crank(&mut env, &k, &c, D2).unwrap();
    let fw = get_associated_token_address(&fee_pda(&c.mint), &NATIVE_MINT);
    env.ok(&[anchor_lang::solana_program::system_instruction::transfer(&env.payer.pubkey(), &fw, 200_000_000), anchor_spl::token::spl_token::instruction::sync_native(&anchor_spl::token::ID, &fw).unwrap()], &[]);
    // forward_on_end refuses this kind, to any coin
    expect_anchor_err(env.send(&[ix_forward_on_end(&k.pubkey(), &c.mint, &f.mint, None, None)], &[&k]), "InvalidEndSink");
    // any destination but the incinerator is refused
    let thief = Pubkey::new_unique();
    expect_anchor_err(env.send(&[ix_burn_sol_on_end(&k.pubkey(), &c.mint, &thief)], &[&k]), "NotIncineratorSink");
    expect_anchor_err(env.send(&[ix_burn_sol_on_end(&k.pubkey(), &c.mint, &k.pubkey())], &[&k]), "NotIncineratorSink");
    // the burn
    let want = spendable(&env, &c.mint);
    let reserve = env.config(&config_pda(&c.mint)).rule.reserve_lamports;
    let inc0 = env.lamports(&INCINERATOR_ID);
    let k0 = env.lamports(&k.pubkey());
    let ff0 = env.lamports(&fee_pda(&f.mint));
    let supply0 = env.mint_supply(&c.mint);
    let meta = env.ok(&[ix_burn_sol_on_end(&k.pubkey(), &c.mint, &INCINERATOR_ID)], &[&k]);
    assert_eq!(env.lamports(&INCINERATOR_ID) - inc0, want, "everything spendable, SOL and unwrapped WSOL, lands at the incinerator");
    assert_eq!(env.lamports(&fee_pda(&c.mint)), reserve, "the reserve stays");
    assert_eq!(env.token_amount(&fw), 0, "the WSOL account is kept, empty");
    assert_eq!(env.lamports(&k.pubkey()), k0, "the WSOL account's new rent is refunded to the cranker: it gains or loses nothing");
    assert_eq!(env.lamports(&fee_pda(&f.mint)), ff0, "no coin receives anything");
    assert_eq!(env.mint_supply(&c.mint), supply0, "no swap, no burn of the coin");
    let ev: SolBurnedOnEnd = event(&meta).expect("SolBurnedOnEnd");
    assert_eq!((ev.mint, ev.to, ev.lamports, ev.unwrapped_lamports, ev.cranker), (c.mint, INCINERATOR_ID, want, 200_000_000, k.pubkey()));
    assert!(meta.logs.iter().any(|l| l.contains(&format!("|endburn|to=1nc1nerator1|lamports={want}|v1"))));
    let re = rule_end(&env, &c.mint).unwrap();
    assert_eq!((re.forwarded_lamports, re.forwards), (want, 1));
    // nothing left: refused; the trickle above the minimum goes the same way
    expect_anchor_err(env.send(&[ix_burn_sol_on_end(&k.pubkey(), &c.mint, &INCINERATOR_ID)], &[&k]), "NothingToForward");
    env.transfer_sol(&fee_pda(&c.mint), MIN);
    env.set_time(env.now() + 1);
    let inc1 = env.lamports(&INCINERATOR_ID);
    env.ok(&[ix_burn_sol_on_end(&k.pubkey(), &c.mint, &INCINERATOR_ID)], &[&k]);
    assert_eq!(env.lamports(&INCINERATOR_ID) - inc1, MIN);
    assert_eq!(rule_end(&env, &c.mint).unwrap().forwards, 2);
}

/// burn_sol_on_end refuses a coin whose sink is not the incinerator, and a VOID end (the won path keeps its wind-down).
#[test]
fn burn_sol_on_end_refuses_other_sinks_and_void_ends() {
    let mut env = Env::new();
    let att = Keypair::new();
    let _f = flagship(&mut env, &att);
    let k = cranker(&mut env);
    let c = ending_coin(&mut env, &att, END_SINK_FLAGSHIP, Pubkey::default(), SOL, 0);
    submit_rule_end(&mut env, &c.mint, D2, END_STATE_RESOLVED, &[&att]).unwrap();
    expect_anchor_err(env.send(&[ix_burn_sol_on_end(&k.pubkey(), &c.mint, &INCINERATOR_ID)], &[&k]), "NotIncineratorSink");
    let v = ending_coin(&mut env, &att, END_SINK_INCINERATOR, Pubkey::default(), SOL, 0);
    submit_rule_end(&mut env, &v.mint, D2, END_STATE_VOID, &[&att]).unwrap();
    expect_anchor_err(env.send(&[ix_burn_sol_on_end(&k.pubkey(), &v.mint, &INCINERATOR_ID)], &[&k]), "NotEndedResolved");
}

// =================================================================================================================================
// initialize_token_r5: a coin never burns itself on its losing path (owner, 2026-10-13)
// =================================================================================================================================

fn init_r5(env: &mut Env, mint: &Keypair, attester: &Pubkey, rule: RuleParams, sink: Option<(u8, Pubkey)>, pair: Option<(Pubkey, bool)>) -> TxResult {
    let creator = Keypair::new();
    let mut args = init_args(rule, vec![*attester], 1);
    args.admin = creator.pubkey();
    if let Some((kind, s)) = sink {
        args.end_sink_kind = kind;
        args.end_sink_mint = if s == Pubkey::default() { None } else { Some(s) };
        args.end_sink_min_lamports = MIN;
    }
    let payer = env.payer.pubkey();
    let platform = (rule.mode == MODE_BUYBACK && rule.pool_policy == POOL_POLICY_CREATOR_IS_FEE_PDA).then_some(TEST_LAUNCHLAB_PLATFORM);
    let ix = ix_initialize_r5(&payer, &creator.pubkey(), &mint.pubkey(), args, platform, pair.map(|p| p.0), pair.map(|p| p.1).unwrap_or(false));
    env.send(&[ix], &[&creator, mint])
}

#[test]
fn the_r5_create_refuses_self_on_the_lost_path_and_takes_every_other_sink() {
    let mut env = Env::new();
    let att = Keypair::new();
    let f = flagship(&mut env, &att);
    // SELF on the lost path (no end sink: a resolved end would wind down on the coin itself): refused
    let s = Keypair::new();
    expect_anchor_err(init_r5(&mut env, &s, &att.pubkey(), buyback_rule(), None, None), "LostPathBurnsSelf");
    // the round-4 create is untouched: the same coin without a sink is still accepted there
    init(&mut env, &s, &att.pubkey(), buyback_rule(), None).unwrap();
    // flagship, a named coin, the incinerator, the pair winner: accepted
    for (kind, sink) in [(END_SINK_FLAGSHIP, Pubkey::default()), (END_SINK_MINT, f.mint), (END_SINK_INCINERATOR, Pubkey::default())] {
        let k = Keypair::new();
        init_r5(&mut env, &k, &att.pubkey(), buyback_rule(), Some((kind, sink)), None).unwrap();
        assert_eq!(end_sink(&env, &k.pubkey()).unwrap().sink_kind, kind);
    }
    let (ka, kb) = (Keypair::new(), Keypair::new());
    init_r5(&mut env, &ka, &att.pubkey(), buyback_rule(), Some((END_SINK_PAIR_WINNER, Pubkey::default())), Some((kb.pubkey(), false))).unwrap();
    init_r5(&mut env, &kb, &att.pubkey(), buyback_rule(), Some((END_SINK_PAIR_WINNER, Pubkey::default())), Some((ka.pubkey(), true))).unwrap();
    assert_eq!(end_sink(&env, &kb.pubkey()).unwrap().sink_mint, ka.pubkey());
    // a vault-mode coin has no burn pool, so no losing-path SOL: accepted without a sink
    let v = Keypair::new();
    init_r5(&mut env, &v, &att.pubkey(), vault_rule(), None, None).unwrap();
}

/// SELF stays on the won path: an r5 coin whose rule ends VOID (the champion path) keeps the hashed wind-down on itself.
#[test]
fn an_r5_coin_keeps_self_on_the_won_path() {
    let mut env = Env::new();
    let att = Keypair::new();
    let f = flagship(&mut env, &att);
    let k = Keypair::new();
    init_r5(&mut env, &k, &att.pubkey(), buyback_rule(), Some((END_SINK_FLAGSHIP, Pubkey::default())), None).unwrap();
    let c = market(&mut env, &k);
    submit(&mut env, &c.mint, D1, V1, &[&att]).unwrap();
    submit(&mut env, &c.mint, D2, V1, &[&att]).unwrap();
    env.transfer_sol(&fee_pda(&c.mint), 2 * SOL);
    submit_rule_end(&mut env, &c.mint, D2, END_STATE_VOID, &[&att]).unwrap();
    let kc = cranker(&mut env);
    expect_anchor_err(env.send(&[ix_forward_on_end(&kc.pubkey(), &c.mint, &f.mint, None, None)], &[&kc]), "NotEndedResolved");
    env.set_time(T0 + 86_400);
    submit(&mut env, &c.mint, D3, V1 + 7 * UNIT, &[&att]).unwrap();
    let supply = env.mint_supply(&c.mint);
    crank(&mut env, &kc, &c, D3).unwrap();
    assert!(env.mint_supply(&c.mint) < supply, "the won path burns this coin on its wind-down");
}
