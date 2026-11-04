//! Blind review 3 (2026-10-10, docs/burn-receipts/CHANGELOG.md): the reviewer's proofs of concept (`poc_*`, ported from the review's
//! scratch suite and now asserting the FIXED behaviour) plus one closing test per finding.

// LiteSVM's FailedTransactionMetadata is large by design; test helpers take many accounts.
#![allow(clippy::result_large_err, clippy::too_many_arguments)]
mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::{AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas};
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::spl_token;
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
const THIEF: Pubkey = anchor_lang::prelude::pubkey!("Thief11111111111111111111111111111111111111");
const TOKEN_2022: Pubkey = anchor_lang::prelude::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

struct Mkt {
    mint: Pubkey,
    att: Keypair,
    pool: Pool,
}

/// init (policy 0, pins the test LaunchLab platform: cpConfigId = AmmConfig 0) → fixed-supply mint → a LaunchLab-shaped migration
/// pool (fee-PDA creator, LP locked) — NOT registered yet.
fn unregistered(env: &mut Env, rule: RuleParams) -> Mkt {
    let (mint_kp, creator, att) = (Keypair::new(), Keypair::new(), Keypair::new());
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
    Mkt { mint, att, pool }
}

fn ready(env: &mut Env, m: &Mkt) {
    let payer = env.payer.pubkey();
    env.ok(&[ix_register_pool(&payer, &m.mint, &m.pool.pool)], &[]);
    env.create_ata(&fee_pda(&m.mint), &NATIVE_MINT);
    env.create_ata(&fee_pda(&m.mint), &m.mint);
    cpmm::seed_history(env, &m.pool, &m.mint);
}

fn find_event<T: AnchorDeserialize + Discriminator>(meta: &litesvm::types::TransactionMetadata) -> Option<T> {
    events(meta).into_iter().find(|(d, _)| d[..] == T::DISCRIMINATOR[..]).map(|(_, p)| T::try_from_slice(&p).unwrap())
}

fn set_pool_status(env: &mut Env, pool: &Pubkey, status: u8) {
    let mut acc = env.svm.get_account(pool).unwrap();
    acc.data[329] = status;
    env.svm.set_account(*pool, acc).unwrap();
}

fn disc(name: &str) -> [u8; 8] {
    use sha2::Digest;
    let h = sha2::Sha256::digest(format!("global:{name}").as_bytes());
    h[..8].try_into().unwrap()
}

/// CPMM deposit (permissionless) by `who`, minting `lp` LP tokens to who's LP ATA (the reviewer's PoC A helper).
fn ix_deposit(who: &Pubkey, p: &Pool, mint: &Pubkey, lp: u64) -> Instruction {
    let wsol = get_associated_token_address(who, &NATIVE_MINT);
    let tok = get_associated_token_address(who, mint);
    let (a0, a1) = if p.wsol_is_0 { (wsol, tok) } else { (tok, wsol) };
    let mut data = disc("deposit").to_vec();
    data.extend_from_slice(&lp.to_le_bytes());
    data.extend_from_slice(&u64::MAX.to_le_bytes());
    data.extend_from_slice(&u64::MAX.to_le_bytes());
    Instruction {
        program_id: CPMM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*who, true),
            AccountMeta::new_readonly(p.authority, false),
            AccountMeta::new(p.pool, false),
            AccountMeta::new(get_associated_token_address(who, &p.lp_mint), false),
            AccountMeta::new(a0, false),
            AccountMeta::new(a1, false),
            AccountMeta::new(p.token_0_vault, false),
            AccountMeta::new(p.token_1_vault, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(TOKEN_2022, false),
            AccountMeta::new_readonly(p.token_0_mint, false),
            AccountMeta::new_readonly(p.token_1_mint, false),
            AccountMeta::new(p.lp_mint, false),
        ],
        data,
    }
}

fn lp_supply(env: &Env, p: &Pool) -> u64 {
    let d = env.svm.get_account(&p.pool).unwrap().data;
    u64::from_le_bytes(d[333..341].try_into().unwrap())
}

/// A griefer deposits `lp` LP worth of liquidity into the pool.
fn grief_deposit(env: &mut Env, m: &Mkt, lp: u64) {
    let g = Keypair::new();
    env.fund(&g.pubkey(), 400 * SOL);
    env.wrap_sol(&g, 300 * SOL);
    let gt = env.create_ata(&g.pubkey(), &m.mint);
    let me = env.payer.insecure_clone();
    env.mint_to(&m.mint, &me, &gt, 3_000_000_000 * TOKEN);
    env.create_ata(&g.pubkey(), &m.pool.lp_mint);
    env.ok(&[ix_deposit(&g.pubkey(), &m.pool, &m.mint, lp)], &[&g]);
}

fn load_evil(env: &mut Env, at: &Pubkey) {
    let p = format!("{}/../../fixtures/evil_callee.so", env!("CARGO_MANIFEST_DIR"));
    let so = std::fs::read(&p).expect("scripts/test.sh builds fixtures/evil_callee.so (mocks/evil_callee)");
    env.svm.add_program(*at, &so).unwrap();
}

// ================================================================================================================================
// The reviewer's proofs of concept
// ================================================================================================================================

/// M-2 — PoC A: a third party with 12.5 % of the pool's liquidity used to block policy-0 registration (fixed 90 % of the LIVE supply).
/// The provenance proof is now primary and the LP floor is 50 % of the live supply: the same deposit no longer blocks; blocking now
/// needs a deposit larger than the whole migrated liquidity (README "LP-ratio griefing").
#[test]
fn poc_a_lp_deposit_griefs_registration() {
    let mut env = Env::new();
    let m = unregistered(&mut env, buyback_rule());
    let before = lp_supply(&env, &m.pool);
    grief_deposit(&mut env, &m, before / 8);
    println!("lp_supply {} -> {} (griefer holds {:.1} %)", before, lp_supply(&env, &m.pool), 100.0 * (before / 8) as f64 / lp_supply(&env, &m.pool) as f64);
    let payer = env.payer.pubkey();
    let meta = env.ok(&[ix_register_pool(&payer, &m.mint, &m.pool.pool)], &[]);
    assert_eq!(find_event::<PoolRegistered>(&meta).unwrap().pool, m.pool.pool);

    // The remaining griefing cost: more than the entire migrated liquidity, held for as long as the block should last.
    let mut env = Env::new();
    let m = unregistered(&mut env, buyback_rule());
    let before = lp_supply(&env, &m.pool);
    grief_deposit(&mut env, &m, before + before / 50);
    expect_anchor_err(env.send(&[ix_register_pool(&payer_of(&env), &m.mint, &m.pool.pool)], &[]), "LpNotLocked");
}

fn payer_of(env: &Env) -> Pubkey {
    env.payer.pubkey()
}

/// M-1 — PoC B: a malicious/compromised LaunchLab used the fee PDA's signer privilege inside the permissionless claim to re-assign the
/// fee PDA and re-own the fee WSOL account (balances unchanged, every old post-check passed). Every abuse now reverts the claim; a
/// well-behaved callee still claims.
#[test]
fn poc_b_claim_post_checks_miss_authority_changes() {
    for mode in 0u64..=5 {
        let mut env = Env::new();
        load_evil(&mut env, &LAUNCHLAB_PROGRAM_ID);
        let (mint, creator, a) = (Keypair::new(), Keypair::new(), Keypair::new());
        let payer = env.payer.pubkey();
        env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint.pubkey(), init_args(buyback_rule(), vec![a.pubkey()], 1))], &[&creator, &mint]);
        let m = mint.pubkey();
        let fee = fee_pda(&m);
        let fee_wsol = env.create_ata(&fee, &NATIVE_MINT);
        // LaunchLab's creator vault (1 SOL of curve fees); `delegated_amount` carries the hostile mode (mocks/evil_callee).
        let rent = 2_039_280u64;
        let mut data = vec![0u8; 165];
        spl_token::state::Account { mint: NATIVE_MINT, owner: launchlab_auth(), amount: SOL, delegate: None.into(), state: spl_token::state::AccountState::Initialized, is_native: Some(rent).into(), delegated_amount: mode, close_authority: None.into() }.pack_into_slice(&mut data);
        env.svm.set_account(launchlab_creator_vault(&fee), litesvm_account(rent + SOL, data, spl_token::ID)).unwrap();
        env.transfer_sol(&fee, 40 * SOL);
        let r = env.send(&[ix_claim_launchlab(&payer, &m)], &[]);
        if mode == 5 {
            r.unwrap();
            assert_eq!(env.token_amount(&fee_wsol), SOL, "a well-behaved callee still claims");
            continue;
        }
        expect_anchor_err(r, "FeeAccountTampered");
        let acc = env.svm.get_account(&fee).unwrap();
        assert_eq!(acc.owner, anchor_lang::system_program::ID, "mode {mode}: the fee PDA stays System-owned");
        let w = spl_token::state::Account::unpack(&env.svm.get_account(&fee_wsol).unwrap().data).unwrap();
        assert!(w.owner == fee && w.delegate.is_none() && w.close_authority.is_none(), "mode {mode}: the fee WSOL account is untouched");
        assert_ne!(w.owner, THIEF);
    }
}

/// M-1 — the same class in the crank: a hostile CPMM upgrade performs the swap and then re-authorises a fee-PDA token account with
/// the fee PDA's (read-only) signature. Every abuse reverts the crank; an honest-looking swap burns.
#[test]
fn m1_a_hostile_cpmm_cannot_reauthorise_the_fee_pdas_token_accounts() {
    let mut env = Env::new();
    let m = unregistered(&mut env, buyback_rule());
    ready(&mut env, &m);
    env.transfer_sol(&fee_pda(&m.mint), 10 * SOL);
    submit(&mut env, &m.mint, D1, V1, &[&m.att]).unwrap();
    submit(&mut env, &m.mint, D2, V1 + UNIT, &[&m.att]).unwrap();
    load_evil(&mut env, &CPMM_PROGRAM_ID);
    let payer = env.payer.pubkey();
    let set_mode = |env: &mut Env, mode: u8| {
        let mut acc = env.svm.get_account(&m.pool.observation).unwrap();
        acc.data[4074] = mode;
        env.svm.set_account(m.pool.observation, acc).unwrap();
    };
    for mode in [1u8, 2, 3] {
        set_mode(&mut env, mode);
        expect_anchor_err(env.send(&[cpmm::ix_crank_buyback(&payer, &m.mint, &m.pool, D2)], &[]), "FeeAccountTampered");
    }
    set_mode(&mut env, 0);
    env.ok(&[cpmm::ix_crank_buyback(&payer, &m.mint, &m.pool, D2)], &[]);
    let r = env.reading(&reading_pda(&config_pda(&m.mint), D2)).unwrap();
    assert_eq!(r.outcome, OUTCOME_BURNED);
}

/// A market whose last trade was `quiet_secs` before the first crank (the reviewer's PoC C helper).
fn quiet_then_crank(quiet_secs: i64) -> (Env, Pubkey, Pool) {
    let mut env = Env::new();
    let m = unregistered(&mut env, buyback_rule());
    ready(&mut env, &m);
    env.set_time(env.now() + quiet_secs);
    env.transfer_sol(&fee_pda(&m.mint), 200 * SOL);
    submit(&mut env, &m.mint, D1, V1, &[&m.att]).unwrap();
    submit(&mut env, &m.mint, D2, V1 + 20 * UNIT, &[&m.att]).unwrap();
    let payer = env.payer.pubkey();
    env.ok(&[cpmm::ix_crank_buyback(&payer, &m.mint, &m.pool, D2)], &[]);
    let r = env.reading(&reading_pda(&config_pda(&m.mint), D2)).unwrap();
    assert_eq!(r.outcome, OUTCOME_BURNED);
    submit(&mut env, &m.mint, D3, V1 + 21 * UNIT, &[&m.att]).unwrap();
    (env, m.mint, m.pool)
}

/// L-1 — PoC C: after a crank in a pool that had been quiet for H hours, the next crank used to stay blocked for about H (the crank's
/// own swap, the newest observation, was never a TWAP start). Now the newest observation is an eligible start: the next crank works
/// one window (600 s) after the last trade, whatever the quiet gap before it.
#[test]
fn poc_c_quiet_pool_second_crank_waits_beyond_window() {
    for quiet in [600i64, 6 * 3600, 24 * 3600] {
        let (mut env, mint, pool) = quiet_then_crank(quiet);
        let t0 = env.now();
        let payer = env.payer.pubkey();
        let mut waited = None;
        for step in 1..=200 {
            env.set_time(t0 + step * 60);
            if env.send(&[cpmm::ix_crank_buyback(&payer, &mint, &pool, D3)], &[]).is_ok() {
                waited = Some(step * 60);
                break;
            }
        }
        println!("previous quiet gap {quiet:>6} s -> second crank first succeeds after {waited:?} s (window 600 s)");
        assert_eq!(waited, Some(600), "quiet gap {quiet}");
    }
}

// ================================================================================================================================
// Closing tests per finding
// ================================================================================================================================

/// L-2: the reviewer's two-proposal walk — q2 {A,B,C} → {A,B,C,X} → {A,X,Y} — no longer gives the admin's keys a quorum in 96 h: a
/// kept key counts towards adding keys only after 7 days of membership.
#[test]
fn l2_iterated_proposals_need_seven_days_of_seniority() {
    let mut env = Env::new();
    let (mint_kp, creator) = (Keypair::new(), Keypair::new());
    let abc: Vec<Keypair> = (0..3).map(|_| Keypair::new()).collect();
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint_kp.pubkey(), init_args(vault_rule(), abc.iter().map(|k| k.pubkey()).collect(), 2))], &[&creator, &mint_kp]);
    let mint = mint_kp.pubkey();
    let (x, y) = (Keypair::new(), Keypair::new());
    let op = |k: &Keypair| AttesterEntry::operator(k.pubkey());
    let propose = |env: &mut Env, set: Vec<AttesterEntry>| env.send(&[ix_admin("propose", &creator.pubkey(), &mint, set, 2)], &[&creator]);
    // Fresh keys cannot vouch for a new key …
    expect_anchor_err(propose(&mut env, vec![op(&abc[0]), op(&abc[1]), op(&abc[2]), op(&x)]), "TooManyAttestersReplaced");
    // … after 7 days they can.
    let t1 = env.now() + ATTESTER_SENIORITY_SECS;
    env.set_time(t1);
    propose(&mut env, vec![op(&abc[0]), op(&abc[1]), op(&abc[2]), op(&x)]).unwrap();
    env.set_time(t1 + ATTESTER_TIMELOCK_SECS);
    env.ok(&[ix_apply(&payer, &mint)], &[]);
    // X is new: {A, X, Y} keeps only one senior key — refused (the 96 h path of the review).
    expect_anchor_err(propose(&mut env, vec![op(&abc[0]), op(&x), op(&y)]), "TooManyAttestersReplaced");
    // Only once X has aged 7 days does the walk continue — every step public, ≥ 48 h + 7 days + 48 h in all.
    env.set_time(t1 + ATTESTER_TIMELOCK_SECS + ATTESTER_SENIORITY_SECS);
    propose(&mut env, vec![op(&abc[0]), op(&x), op(&y)]).unwrap();
    let c = env.config(&config_pda(&mint));
    assert_eq!(c.attester_added_at[3], t1 + ATTESTER_TIMELOCK_SECS, "X joined when the change applied");
    assert_eq!(c.attester_added_at[0], c.created_at, "A kept its membership date");
}

/// L-3: an observation may not share its transaction with anything touching the pool, and one observation is only a candidate — the
/// spell starts with a second observation ≥ 1 h later.
#[test]
fn l3_pool_health_cannot_be_forged_inside_a_swap_transaction() {
    let mut env = Env::new();
    let m = unregistered(&mut env, buyback_rule());
    ready(&mut env, &m);
    let trader = Keypair::new();
    env.fund(&trader.pubkey(), 10 * SOL);
    env.wrap_sol(&trader, 5 * SOL);
    env.create_ata(&trader.pubkey(), &m.mint);
    let payer = env.payer.pubkey();
    let check = ix_check_pool_health(&payer, &m.mint, &m.pool.pool, &m.pool.wsol_vault());
    // sell → check → buy back in one transaction: refused.
    let swap = cpmm::ix_swap(&trader.pubkey(), &m.pool, &m.mint, true, SOL / 10);
    expect_anchor_err(env.send(&[swap, check.clone()], &[&trader]), "PoolTouchedInTransaction");
    // any other instruction listing the pool account is refused too (here: a second observation).
    expect_anchor_err(env.send(&[check.clone(), check.clone()], &[]), "PoolTouchedInTransaction");
    // Untradeable: a first observation is a candidate; a second within the hour changes nothing; one ≥ 1 h later starts the spell.
    set_pool_status(&mut env, &m.pool.pool, 4);
    let t0 = env.now();
    let f = find_event::<PoolUntradeableFlagged>(&env.ok(std::slice::from_ref(&check), &[])).unwrap();
    assert_eq!((f.since, f.candidate_at, f.restarted), (0, t0, false));
    env.set_time(t0 + UNTRADEABLE_CONFIRM_SECS - 1);
    let f = find_event::<PoolUntradeableFlagged>(&env.ok(std::slice::from_ref(&check), &[])).unwrap();
    assert_eq!((f.since, f.candidate_at), (0, t0));
    env.set_time(t0 + UNTRADEABLE_CONFIRM_SECS);
    let f = find_event::<PoolUntradeableFlagged>(&env.ok(std::slice::from_ref(&check), &[])).unwrap();
    assert_eq!((f.since, f.restarted, f.candidate_at), (t0, true, 0));
    assert_eq!(env.config(&config_pda(&m.mint)).pool_untradeable_since, t0);
}

/// L-4 (allowlist removed 2026-10-25): initialize_platform accepts any cranker list (even more than three keys) and stores none;
/// the event says so; crank_buyback is permissionless from the start; clearing an empty list is refused (nothing to clear).
#[test]
fn l4_the_cranker_allowlist_is_gone_and_cranking_is_permissionless() {
    let mut env = Env::new();
    let (payer, ua) = (env.payer.pubkey(), env.upgrade_authority.insecure_clone());
    let (pa, outsider) = (Keypair::new(), Keypair::new());
    for k in [&pa, &outsider] {
        env.fund(&k.pubkey(), SOL);
    }
    let four: Vec<Pubkey> = (0..4).map(|_| Pubkey::new_unique()).collect();
    let meta = env.ok(&[ix_initialize_platform_with(&payer, &ua.pubkey(), &pa.pubkey(), LEGACY_CAP_ARG, NOW + 30 * 86_400, four)], &[&ua]);
    let ev = find_event::<PlatformInitialized>(&meta).unwrap();
    assert_eq!((ev.crankers, ev.burn_pool_cap_lamports), (vec![], 0));
    let m = unregistered(&mut env, buyback_rule());
    ready(&mut env, &m);
    env.transfer_sol(&fee_pda(&m.mint), 10 * SOL);
    submit(&mut env, &m.mint, D1, V1, &[&m.att]).unwrap();
    submit(&mut env, &m.mint, D2, V1 + UNIT, &[&m.att]).unwrap();
    env.ok(&[cpmm::ix_crank_buyback(&outsider.pubkey(), &m.mint, &m.pool, D2)], &[&outsider]);
    expect_anchor_err(env.send(&[ix_platform_clear(&pa.pubkey())], &[&pa]), "NoPendingChange");
}

fn ix_platform_clear(authority: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::ClearCrankerAllowlist {}.data(),
        burn_receipts::accounts::ClearCrankerAllowlist { caller: *authority, platform: platform_pda(), event_authority: event_authority(), program: burn_receipts::ID }.to_account_metas(None),
    )
}

/// M-3 (pinning): initialize_token reads the LaunchLab platform and refuses one whose platformCpCreator is someone else, whose LP
/// lock/burn scales cover < 50 %, or whose cpConfigId is unset; registration compares against the PINNED cpConfigId, so a later
/// platform change cannot strand or redirect it.
#[test]
fn m3_initialize_token_pins_the_launchlab_platform() {
    let mut env = Env::new();
    let payer = env.payer.pubkey();
    let try_init = |env: &mut Env, platform: Option<Pubkey>| {
        let (mint, creator, a) = (Keypair::new(), Keypair::new(), Keypair::new());
        let mut args = init_args(buyback_rule(), vec![a.pubkey()], 1);
        args.admin = creator.pubkey();
        env.send(&[ix_initialize_with_platform(&payer, &creator.pubkey(), &mint.pubkey(), args, platform)], &[&creator, &mint])
    };
    expect_anchor_err(try_init(&mut env, None), "LaunchLabPlatformRequired");
    let amm0 = cpmm::amm_config_0();
    cpmm::set_platform(&mut env, &amm0, &Pubkey::new_unique(), [500_000, 400_000, 100_000]);
    expect_anchor_err(try_init(&mut env, Some(TEST_LAUNCHLAB_PLATFORM)), "PlatformNotAllowed");
    cpmm::set_platform(&mut env, &amm0, &Pubkey::default(), [200_000, 200_000, 99_999]);
    expect_anchor_err(try_init(&mut env, Some(TEST_LAUNCHLAB_PLATFORM)), "PlatformNotAllowed");
    cpmm::set_platform(&mut env, &Pubkey::default(), &Pubkey::default(), [500_000, 400_000, 100_000]);
    expect_anchor_err(try_init(&mut env, Some(TEST_LAUNCHLAB_PLATFORM)), "PlatformNotAllowed");
    let mut not_launchlab = cpmm::platform_account(&env, &amm0, &Pubkey::default(), [500_000, 400_000, 100_000]);
    not_launchlab.owner = Pubkey::new_unique();
    env.svm.set_account(TEST_LAUNCHLAB_PLATFORM, not_launchlab).unwrap();
    expect_anchor_err(try_init(&mut env, Some(TEST_LAUNCHLAB_PLATFORM)), "InvalidLaunchLabAccount");
    // A valid platform is pinned …
    cpmm::set_platform_cp_config(&mut env, &amm0);
    let m = unregistered(&mut env, buyback_rule());
    let c = env.config(&config_pda(&m.mint));
    assert_eq!((c.ll_platform, c.ll_cp_config, c.ll_lock_scale_ppm, c.registration_policy), (TEST_LAUNCHLAB_PLATFORM, amm0, 1_000_000, POOL_POLICY_CREATOR_IS_FEE_PDA));
    // … and the platform admin changing cpConfigId afterwards (updateCpConfigId) does not move the registration target.
    cpmm::set_platform_cp_config(&mut env, &Pubkey::new_unique());
    env.ok(&[ix_register_pool(&payer, &m.mint, &m.pool.pool)], &[]);
    // A fee-PDA creator at platformCpCreator is fine.
    cpmm::set_platform(&mut env, &amm0, &Pubkey::default(), [1_000_000, 0, 0]);
    try_init(&mut env, Some(TEST_LAUNCHLAB_PLATFORM)).unwrap();
}

fn ix_set_policy(admin: &Pubkey, mint: &Pubkey, policy: u8, pool: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::SetRegistrationPolicy { policy, pool }.data(),
        burn_receipts::accounts::RegistrationPolicyAdmin { admin: *admin, config: config_pda(mint), platform: platform_pda(), event_authority: event_authority(), program: burn_receipts::ID }.to_account_metas(None),
    )
}

fn ix_cancel_policy(admin: &Pubkey, mint: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::CancelRegistrationPolicy {}.data(),
        burn_receipts::accounts::RegistrationPolicyAdmin { admin: *admin, config: config_pda(mint), platform: platform_pda(), event_authority: event_authority(), program: burn_receipts::ID }.to_account_metas(None),
    )
}

fn ix_apply_policy(caller: &Pubkey, mint: &Pubkey, pool: Option<&Pool>) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::ApplyRegistrationPolicy {}.data(),
        burn_receipts::accounts::ApplyRegistrationPolicy {
            caller: *caller,
            config: config_pda(mint),
            fee_vault: fee_pda(mint),
            mint: *mint,
            platform: platform_pda(),
            pool_state: pool.map(|p| p.pool),
            lp_mint: pool.map(|p| p.lp_mint),
            lp_lock_vault: pool.map(|p| get_associated_token_address(&LOCK_CPMM_AUTHORITY, &p.lp_mint)),
            launchlab_platform: None,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

/// M-3 (stranding recovery): LaunchLab migrated onto another AmmConfig than the one pinned (the platform admin changed cpConfigId
/// before migration) → register_pool can never accept it. The token's admin switches to a fixed pool that passes the creator + LP
/// checks — 48 h timelocked, only while no pool works, only until the cap sunset.
#[test]
fn m3_set_registration_policy_recovers_a_stranded_token() {
    let mut env = Env::new();
    let (mint_kp, creator, att) = (Keypair::new(), Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint_kp.pubkey(), init_args(buyback_rule(), vec![att.pubkey()], 1))], &[&creator, &mint_kp]);
    let mint = mint_kp.pubkey();
    env.create_mint(&mint_kp, &payer, DECIMALS);
    let launcher = Keypair::new();
    env.fund(&launcher.pubkey(), 1_000 * SOL);
    cpmm::setup_amm(&mut env, &launcher.pubkey());
    let amm1 = cpmm::create_amm_config(&mut env, 1);
    let lt = env.create_ata(&launcher.pubkey(), &mint);
    let me = env.payer.insecure_clone();
    env.mint_to(&mint, &me, &lt, 800_000_000 * TOKEN);
    let pool = cpmm::create_pool(&mut env, &launcher, &amm1, &mint, &fee_pda(&mint), 85 * SOL, 800_000_000 * TOKEN, &lt);
    cpmm::launchlab_state(&mut env, &mint, &fee_pda(&mint), &amm1);
    expect_anchor_err(env.send(&[ix_register_pool(&payer, &mint, &pool.pool)], &[]), "NotMigrationPool");
    // Only the admin proposes; policy 1 needs a pool.
    let stranger = Keypair::new();
    env.fund(&stranger.pubkey(), SOL);
    expect_anchor_err(env.send(&[ix_set_policy(&stranger.pubkey(), &mint, POOL_POLICY_FIXED, pool.pool)], &[&stranger]), "NotAdmin");
    expect_anchor_err(env.send(&[ix_set_policy(&creator.pubkey(), &mint, POOL_POLICY_FIXED, Pubkey::default())], &[&creator]), "WrongPoolPolicy");
    // Propose, overwrite (Cancelled + Proposed), cancel, propose again.
    assert_eq!(event_names(&env.ok(&[ix_set_policy(&creator.pubkey(), &mint, POOL_POLICY_FIXED, Pubkey::new_unique())], &[&creator])), vec!["RegistrationPolicyProposed"]);
    assert_eq!(event_names(&env.ok(&[ix_set_policy(&creator.pubkey(), &mint, POOL_POLICY_FIXED, pool.pool)], &[&creator])), vec!["RegistrationPolicyCancelled", "RegistrationPolicyProposed"]);
    assert_eq!(event_names(&env.ok(&[ix_cancel_policy(&creator.pubkey(), &mint)], &[&creator])), vec!["RegistrationPolicyCancelled"]);
    let t = env.now();
    env.ok(&[ix_set_policy(&creator.pubkey(), &mint, POOL_POLICY_FIXED, pool.pool)], &[&creator]);
    expect_anchor_err(env.send(&[ix_apply_policy(&payer, &mint, Some(&pool))], &[]), "TimelockNotElapsed");
    env.set_time(t + ATTESTER_TIMELOCK_SECS);
    let meta = env.ok(&[ix_apply_policy(&payer, &mint, Some(&pool))], &[]);
    let ev = find_event::<RegistrationPolicyApplied>(&meta).unwrap();
    assert_eq!((ev.policy, ev.pool), (POOL_POLICY_FIXED, pool.pool));
    let c = env.config(&config_pda(&mint));
    assert_eq!((c.registration_policy, c.cpmm_pool, c.pool_verified, c.pending_policy_eta), (POOL_POLICY_FIXED, pool.pool, true, 0));
    // Burns run on the recovered pool.
    env.create_ata(&fee_pda(&mint), &NATIVE_MINT);
    env.create_ata(&fee_pda(&mint), &mint);
    cpmm::seed_history(&mut env, &pool, &mint);
    env.transfer_sol(&fee_pda(&mint), 5 * SOL);
    submit(&mut env, &mint, D1, V1, &[&att]).unwrap();
    submit(&mut env, &mint, D2, V1 + UNIT, &[&att]).unwrap();
    env.ok(&[cpmm::ix_crank_buyback(&payer, &mint, &pool, D2)], &[]);
    assert_eq!(env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap().outcome, OUTCOME_BURNED);
    // With a working pool the switch is not available (it is a stranding-recovery power, not a redirect).
    expect_anchor_err(env.send(&[ix_set_policy(&creator.pubkey(), &mint, POOL_POLICY_CREATOR_IS_FEE_PDA, Pubkey::default())], &[&creator]), "PolicySwitchNotAllowed");
    // … and after the cap sunset it is gone for good.
    set_pool_status(&mut env, &pool.pool, 4);
    env.set_time(DEFAULT_CAP_SUNSET_TS + 1);
    expect_anchor_err(env.send(&[ix_set_policy(&creator.pubkey(), &mint, POOL_POLICY_CREATOR_IS_FEE_PDA, Pubkey::default())], &[&creator]), "PolicySwitchNotAllowed");
}

/// I-1: the program has a `localnet` feature binding its own genesis tag; the default build binds mainnet's.
#[test]
fn i1_the_default_build_binds_mainnet_and_localnet_has_its_own_tag() {
    assert_eq!(CLUSTER_GENESIS_HASH.to_string(), "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
    use sha2::Digest;
    let tag = Pubkey::new_from_array(sha2::Sha256::digest(b"BURNRECEIPTS-LOCALNET-GENESIS").into());
    assert_eq!(tag.to_string(), "38EeoTLdVHgiexj97JrnuEYvG7zV7nSFVdUeMJxUDdLt", "constants.rs's localnet tag is sha256(\"BURNRECEIPTS-LOCALNET-GENESIS\")");
}

/// L-5 (program side of the client fix): when the pool account is gone, check_pool_health accepts any vault account and records "pool
/// account"; the crank can be built from the config alone (the fee PDA's own token accounts stand in for the vaults, any address for
/// the AmmConfig / observation) and reports PoolNotTradable — then, after 30 continuous days, processes the reading below-floor.
#[test]
fn l5_a_missing_pool_can_be_observed_and_cranked_from_the_config_alone() {
    let mut env = Env::new();
    let m = unregistered(&mut env, buyback_rule());
    ready(&mut env, &m);
    env.transfer_sol(&fee_pda(&m.mint), 10 * SOL);
    submit(&mut env, &m.mint, D1, V1, &[&m.att]).unwrap();
    submit(&mut env, &m.mint, D2, V1 + UNIT, &[&m.att]).unwrap();
    // The pool account disappears.
    env.svm.set_account(m.pool.pool, litesvm_account(0, vec![], anchor_lang::system_program::ID)).unwrap();
    let payer = env.payer.pubkey();
    let stand_in = Pubkey::find_program_address(&[b"none"], &burn_receipts::ID).0;
    let check = ix_check_pool_health(&payer, &m.mint, &m.pool.pool, &stand_in);
    let crank = || {
        let p = Pool {
            amm_config: stand_in,
            observation: stand_in,
            token_0_vault: stand_in,
            token_1_vault: Pubkey::find_program_address(&[b"none2"], &burn_receipts::ID).0,
            wsol_is_0: true,
            ..m.pool
        };
        cpmm::ix_crank_buyback(&payer, &m.mint, &p, D2)
    };
    expect_anchor_err(env.send(&[crank()], &[]), "PoolNotTradable");
    let t0 = env.now();
    let f = find_event::<PoolUntradeableFlagged>(&env.ok(std::slice::from_ref(&check), &[])).unwrap();
    assert_eq!((f.candidate_at, f.reason), (t0, burn_receipts::instructions::pool_health::UNTRADEABLE_POOL_ACCOUNT));
    for day in 1..=30 {
        env.set_time(t0 + day * 86_400);
        env.ok(std::slice::from_ref(&check), &[]);
    }
    env.ok(&[crank()], &[]);
    assert_eq!(env.reading(&reading_pda(&config_pda(&m.mint), D2)).unwrap().outcome, OUTCOME_BELOW_FLOOR);
}
