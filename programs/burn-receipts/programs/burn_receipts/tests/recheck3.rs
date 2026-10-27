//! The re-check after round 3 (blind review 3, 2026-10-10): R3-1 (isolation of pool-health observations — the reviewer's vault-donation
//! and CPI-wrapper PoCs, ported and now asserting refusal), R3-2 (the registration-policy fallback: 90 % LP or a LaunchLab-known
//! AmmConfig, 14-day proposal expiry, the attester veto) and R3-4 (the cranker allowlist's 90-day bound and who may clear it).
// LiteSVM's FailedTransactionMetadata is large by design; test helpers take many accounts.
#![allow(clippy::result_large_err, clippy::too_many_arguments)]
mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::{AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas};
use burn_receipts::state::PlatformConfig;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::spl_token;
use burn_receipts::constants::*;
use burn_receipts::events::*;
use common::cpmm::{self, Pool};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

const V1: u64 = 4_027_300_000_000_000;
const D1: u32 = 20261001;
const D2: u32 = 20261002;
/// The test-only multicall (mocks/multicall, built by scripts/test.sh) is loaded here.
const MULTICALL: Pubkey = Pubkey::new_from_array([7u8; 32]);

fn find_event<T: AnchorDeserialize + Discriminator>(meta: &litesvm::types::TransactionMetadata) -> Option<T> {
    events(meta).into_iter().find(|(d, _)| d[..] == T::DISCRIMINATOR[..]).map(|(_, p)| T::try_from_slice(&p).unwrap())
}

fn load_multicall(env: &mut Env) {
    let p = format!("{}/../../fixtures/multicall.so", env!("CARGO_MANIFEST_DIR"));
    let so = std::fs::read(&p).expect("scripts/test.sh builds fixtures/multicall.so (mocks/multicall)");
    env.svm.add_program(MULTICALL, &so).unwrap();
}

/// One top-level instruction of the multicall that CPIs each of `ixs` in order (the reviewer's wrapper).
fn multicall(ixs: &[Instruction]) -> Instruction {
    let mut metas: Vec<AccountMeta> = Vec::new();
    let push = |k: Pubkey, s: bool, w: bool, metas: &mut Vec<AccountMeta>| -> u8 {
        if let Some(i) = metas.iter().position(|m| m.pubkey == k) {
            metas[i].is_signer |= s;
            metas[i].is_writable |= w;
            return i as u8;
        }
        metas.push(AccountMeta { pubkey: k, is_signer: s, is_writable: w });
        (metas.len() - 1) as u8
    };
    let mut data = vec![ixs.len() as u8];
    for ix in ixs {
        let p = push(ix.program_id, false, false, &mut metas);
        let idx: Vec<u8> = ix.accounts.iter().map(|m| push(m.pubkey, m.is_signer, m.is_writable, &mut metas)).collect();
        data.push(p);
        data.push(idx.len() as u8);
        data.extend_from_slice(&idx);
        data.extend_from_slice(&(ix.data.len() as u16).to_le_bytes());
        data.extend_from_slice(&ix.data);
    }
    Instruction { program_id: MULTICALL, accounts: metas, data }
}

/// A registered, LaunchLab-migrated pool made THIN (WSOL vault 0.005 SOL — state setup only) with a reserve-based spell running.
fn thin_pool_with_a_spell() -> (Env, Pubkey, Pool, Instruction) {
    let mut env = Env::new();
    let (mint_kp, creator, att) = (Keypair::new(), Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint_kp.pubkey(), init_args(buyback_rule(), vec![att.pubkey()], 1))], &[&creator, &mint_kp]);
    let mint = mint_kp.pubkey();
    env.create_mint(&mint_kp, &payer, DECIMALS);
    let launcher = Keypair::new();
    env.fund(&launcher.pubkey(), 1_000 * SOL);
    let amm = cpmm::setup_amm(&mut env, &launcher.pubkey());
    let lt = env.create_ata(&launcher.pubkey(), &mint);
    let me = env.payer.insecure_clone();
    env.mint_to(&mint, &me, &lt, 800_000_000 * TOKEN);
    let pool = cpmm::create_pool(&mut env, &launcher, &amm, &mint, &fee_pda(&mint), 85 * SOL, 800_000_000 * TOKEN, &lt);
    cpmm::launchlab_migrated(&mut env, &mint, &pool);
    env.ok(&[ix_register_pool(&payer, &mint, &pool.pool)], &[]);
    let v = pool.wsol_vault();
    let mut acc = env.svm.get_account(&v).unwrap();
    let mut t = spl_token::state::Account::unpack(&acc.data).unwrap();
    t.amount = 5_000_000;
    t.pack_into_slice(&mut acc.data);
    acc.lamports = 2_039_280 + 5_000_000;
    env.svm.set_account(v, acc).unwrap();
    let check = ix_check_pool_health(&payer, &mint, &pool.pool, &v);
    let t0 = env.now();
    env.ok(std::slice::from_ref(&check), &[]);
    env.set_time(t0 + UNTRADEABLE_CONFIRM_SECS);
    env.ok(std::slice::from_ref(&check), &[]);
    assert_eq!(env.config(&config_pda(&mint)).pool_untradeable_since, t0, "spell running");
    env.set_time(t0 + 2 * UNTRADEABLE_CONFIRM_SECS);
    (env, mint, pool, check)
}

/// R3-1 — reviewer PoC 2: a WSOL donation into the pool's vault lists neither the pool nor CPMM, so in round 3 it shared a transaction
/// with check_pool_health and cleared a reserve-based spell. The vaults and the observation account are now in the "touched" set.
#[test]
fn r3_1_a_vault_donation_in_the_same_transaction_is_refused() {
    let (mut env, mint, pool, check) = thin_pool_with_a_spell();
    let since = env.config(&config_pda(&mint)).pool_untradeable_since;
    let g = Keypair::new();
    env.fund(&g.pubkey(), SOL);
    let gw = env.wrap_sol(&g, SOL / 10);
    let donate = spl_token::instruction::transfer(&spl_token::ID, &gw, &pool.wsol_vault(), &g.pubkey(), &[], 20_000_000).unwrap();
    expect_anchor_err(env.send(&[donate.clone(), check.clone()], &[&g]), "PoolTouchedInTransaction");
    expect_anchor_err(env.send(&[check.clone(), donate.clone()], &[&g]), "PoolTouchedInTransaction");
    // The token vault and the observation account count too (here an instruction that only LISTS the observation account).
    let gt = env.create_ata(&g.pubkey(), &mint);
    let me = env.payer.insecure_clone();
    env.mint_to(&mint, &me, &gt, 1_000 * TOKEN);
    let donate_tokens = spl_token::instruction::transfer(&spl_token::ID, &gt, &pool.token_vault(), &g.pubkey(), &[], TOKEN).unwrap();
    expect_anchor_err(env.send(&[donate_tokens, check.clone()], &[&g]), "PoolTouchedInTransaction");
    load_multicall(&mut env);
    let list_obs = Instruction { program_id: MULTICALL, accounts: vec![AccountMeta::new_readonly(pool.observation, false)], data: vec![0] };
    env.ok(std::slice::from_ref(&list_obs), &[]);
    expect_anchor_err(env.send(&[list_obs, check.clone()], &[]), "PoolTouchedInTransaction");
    assert_eq!(env.config(&config_pda(&mint)).pool_untradeable_since, since, "nothing above changed the spell");
    // A real reserve change in its OWN transaction is reality, and the next isolated observation sees it (the Jito-bundle residual
    // is exactly this pair made atomic by a bundler — README "Pool health").
    env.ok(&[donate], &[&g]);
    env.ok(std::slice::from_ref(&check), &[]);
    assert_eq!(env.config(&config_pda(&mint)).pool_untradeable_since, 0);
}

/// R3-1 — reviewer PoC 3: a wrapper program CPIs [CPMM swap, check_pool_health] inside ONE top-level instruction; the sysvar check
/// skipped the current (wrapper) index, so in round 3 the spell was cleared. check_pool_health must now run at stack height 1.
#[test]
fn r3_1_b_cpi_wrapped_observation_is_refused() {
    let (mut env, mint, pool, check) = thin_pool_with_a_spell();
    let since = env.config(&config_pda(&mint)).pool_untradeable_since;
    load_multicall(&mut env);
    let g = Keypair::new();
    env.fund(&g.pubkey(), 10 * SOL);
    env.wrap_sol(&g, SOL);
    env.create_ata(&g.pubkey(), &mint);
    let buy = cpmm::ix_swap(&g.pubkey(), &pool, &mint, true, 20_000_000);
    // top level: refused (round 3 already)
    expect_anchor_err(env.send(&[buy.clone(), check.clone()], &[&g]), "PoolTouchedInTransaction");
    // wrapped: refused now
    expect_anchor_err(env.send(&[multicall(&[buy, check.clone()])], &[&g]), "PoolTouchedInTransaction");
    // … even a wrapper around the observation alone (nothing else in the transaction): CPI is never an observation.
    expect_anchor_err(env.send(&[multicall(std::slice::from_ref(&check))], &[]), "PoolTouchedInTransaction");
    assert_eq!(env.config(&config_pda(&mint)).pool_untradeable_since, since);
    // replace_pool shares the rule (stack height 1): refused under the wrapper before anything else is looked at.
    let payer = env.payer.pubkey();
    let replace = ix_replace_pool(&payer, &mint, &pool.pool, &pool.wsol_vault(), &pool.pool, &pool.wsol_vault());
    let out = expect_fail(env.send(&[multicall(&[replace])], &[]));
    assert!(out.contains("PoolTouchedInTransaction"), "{out}");
    // The plain top-level observation still works.
    env.ok(std::slice::from_ref(&check), &[]);
    assert_eq!(env.config(&config_pda(&mint)).pool_untradeable_since, since);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// R3-2 — the registration-policy fallback
// ---------------------------------------------------------------------------------------------------------------------------------

struct Stranded {
    mint: Pubkey,
    admin: Keypair,
    att: Keypair,
    pool: Pool,
}

/// A policy-0 token pinned to AmmConfig 0 whose LaunchLab migration went to AmmConfig 1 (so register_pool refuses it), with
/// `lock_pct` % of the launcher's LP locked; the platform's current cpConfigId stays AmmConfig 0. One per (fresh) Env.
fn stranded(env: &mut Env, lock_pct: u64) -> Stranded {
    let (mint_kp, admin, att) = (Keypair::new(), Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &admin.pubkey(), &mint_kp.pubkey(), init_args(buyback_rule(), vec![att.pubkey()], 1))], &[&admin, &mint_kp]);
    let mint = mint_kp.pubkey();
    env.create_mint(&mint_kp, &payer, DECIMALS);
    let launcher = Keypair::new();
    env.fund(&launcher.pubkey(), 1_000 * SOL);
    cpmm::setup_amm(env, &launcher.pubkey());
    let amm1 = cpmm::create_amm_config(env, 1);
    let lt = env.create_ata(&launcher.pubkey(), &mint);
    let me = env.payer.insecure_clone();
    env.mint_to(&mint, &me, &lt, 800_000_000 * TOKEN);
    let pool = cpmm::create_pool_unlocked(env, &launcher, &amm1, &mint, &fee_pda(&mint), 85 * SOL, 800_000_000 * TOKEN, &lt);
    let all = env.token_amount(&get_associated_token_address(&launcher.pubkey(), &pool.lp_mint));
    cpmm::lock_lp(env, &launcher, &pool, all * lock_pct / 100);
    cpmm::launchlab_state(env, &mint, &fee_pda(&mint), &cpmm::amm_config_0());
    expect_anchor_err(env.send(&[ix_register_pool(&payer, &mint, &pool.pool)], &[]), "NotMigrationPool");
    Stranded { mint, admin, att, pool }
}

fn ix_set_policy(admin: &Pubkey, mint: &Pubkey, policy: u8, pool: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::SetRegistrationPolicy { policy, pool }.data(),
        burn_receipts::accounts::RegistrationPolicyAdmin { admin: *admin, config: config_pda(mint), platform: platform_pda(), event_authority: event_authority(), program: burn_receipts::ID }.to_account_metas(None),
    )
}

fn ix_apply_policy(caller: &Pubkey, mint: &Pubkey, pool: &Pool, launchlab_platform: Option<Pubkey>) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::ApplyRegistrationPolicy {}.data(),
        burn_receipts::accounts::ApplyRegistrationPolicy {
            caller: *caller,
            config: config_pda(mint),
            fee_vault: fee_pda(mint),
            mint: *mint,
            platform: platform_pda(),
            pool_state: Some(pool.pool),
            lp_mint: Some(pool.lp_mint),
            lp_lock_vault: Some(get_associated_token_address(&LOCK_CPMM_AUTHORITY, &pool.lp_mint)),
            launchlab_platform,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

fn ix_veto(attester: &Pubkey, mint: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::VetoRegistrationPolicy {}.data(),
        burn_receipts::accounts::VetoRegistrationPolicy { attester: *attester, config: config_pda(mint), event_authority: event_authority(), program: burn_receipts::ID }.to_account_metas(None),
    )
}

/// Propose the fixed pool and wait out the 48 h timelock; returns the proposal time.
fn propose_fixed(env: &mut Env, s: &Stranded) -> i64 {
    let t = env.now();
    env.ok(&[ix_set_policy(&s.admin.pubkey(), &s.mint, POOL_POLICY_FIXED, s.pool.pool)], &[&s.admin]);
    env.set_time(t + ATTESTER_TIMELOCK_SECS);
    t
}

/// R3-2: a fallback pool on an AmmConfig LaunchLab does not name, with < 90 % of its LP locked, is refused (a colluding Raydium
/// permission holder could otherwise keep the other ≤ 50 %); the same pool is accepted once it is the PDA of a LaunchLab-known
/// AmmConfig (the pinned platform's current cpConfigId).
#[test]
fn r3_2_a_fallback_pool_needs_ninety_percent_or_a_launchlab_config() {
    let mut env = Env::new();
    let payer = env.payer.pubkey();
    let s = stranded(&mut env, 60);
    propose_fixed(&mut env, &s);
    expect_anchor_err(env.send(&[ix_apply_policy(&payer, &s.mint, &s.pool, None)], &[]), "LpNotLocked");
    // the platform's CURRENT cpConfigId is still AmmConfig 0: not this pool's
    expect_anchor_err(env.send(&[ix_apply_policy(&payer, &s.mint, &s.pool, Some(TEST_LAUNCHLAB_PLATFORM))], &[]), "LpNotLocked");
    // only the pinned platform counts
    expect_anchor_err(env.send(&[ix_apply_policy(&payer, &s.mint, &s.pool, Some(Pubkey::new_unique()))], &[]), "InvalidLaunchLabAccount");
    // LaunchLab's platform now names AmmConfig 1 (updateCpConfigId): the pool is THE pool of a LaunchLab-known config.
    cpmm::set_platform_cp_config(&mut env, &s.pool.amm_config);
    let meta = env.ok(&[ix_apply_policy(&payer, &s.mint, &s.pool, Some(TEST_LAUNCHLAB_PLATFORM))], &[]);
    assert_eq!(find_event::<RegistrationPolicyApplied>(&meta).unwrap().pool, s.pool.pool);
    let c = env.config(&config_pda(&s.mint));
    assert_eq!((c.registration_policy, c.cpmm_pool, c.pool_verified), (POOL_POLICY_FIXED, s.pool.pool, true));

    // ≥ 90 % locked on an unknown config: accepted without any LaunchLab account.
    let mut env = Env::new();
    let payer = env.payer.pubkey();
    let s = stranded(&mut env, 90);
    propose_fixed(&mut env, &s);
    env.ok(&[ix_apply_policy(&payer, &s.mint, &s.pool, None)], &[]);
    // 89 %: refused.
    let mut env = Env::new();
    let payer = env.payer.pubkey();
    let s = stranded(&mut env, 89);
    propose_fixed(&mut env, &s);
    expect_anchor_err(env.send(&[ix_apply_policy(&payer, &s.mint, &s.pool, None)], &[]), "LpNotLocked");
}

/// R3-2: a pending proposal applies only in [eta, proposed + 14 days); an expired one needs a fresh public proposal.
#[test]
fn r3_2_b_policy_proposals_expire_after_fourteen_days() {
    let mut env = Env::new();
    let payer = env.payer.pubkey();
    let s = stranded(&mut env, 100);
    let t = env.now();
    let meta = env.ok(&[ix_set_policy(&s.admin.pubkey(), &s.mint, POOL_POLICY_FIXED, s.pool.pool)], &[&s.admin]);
    let ev = find_event::<RegistrationPolicyProposed>(&meta).unwrap();
    assert_eq!((ev.eta, ev.expires_at), (t + ATTESTER_TIMELOCK_SECS, t + POLICY_PROPOSAL_TTL_SECS));
    env.set_time(t + POLICY_PROPOSAL_TTL_SECS);
    expect_anchor_err(env.send(&[ix_apply_policy(&payer, &s.mint, &s.pool, None)], &[]), "PolicyProposalExpired");
    // Proposing again restarts both clocks; the last second of the window still applies.
    let t2 = env.now();
    env.ok(&[ix_set_policy(&s.admin.pubkey(), &s.mint, POOL_POLICY_FIXED, s.pool.pool)], &[&s.admin]);
    env.set_time(t2 + POLICY_PROPOSAL_TTL_SECS - 1);
    env.ok(&[ix_apply_policy(&payer, &s.mint, &s.pool, None)], &[]);
    assert_eq!(env.config(&config_pda(&s.mint)).cpmm_pool, s.pool.pool);
}

/// R3-2: the cheap veto — any current attester (one signature) clears a pending registration-policy proposal; nobody else can.
#[test]
fn r3_2_c_any_current_attester_vetoes_a_pending_policy_proposal() {
    let mut env = Env::new();
    let payer = env.payer.pubkey();
    let s = stranded(&mut env, 100);
    expect_anchor_err(env.send(&[ix_veto(&s.att.pubkey(), &s.mint)], &[&s.att]), "NoPendingChange");
    propose_fixed(&mut env, &s);
    let stranger = Keypair::new();
    expect_anchor_err(env.send(&[ix_veto(&stranger.pubkey(), &s.mint)], &[&stranger]), "NotAttester");
    expect_anchor_err(env.send(&[ix_veto(&s.admin.pubkey(), &s.mint)], &[&s.admin]), "NotAttester");
    let meta = env.ok(&[ix_veto(&s.att.pubkey(), &s.mint)], &[&s.att]);
    assert_eq!(event_names(&meta), vec!["RegistrationPolicyCancelled"]);
    let ev = find_event::<RegistrationPolicyCancelled>(&meta).unwrap();
    assert_eq!((ev.cancelled_by, ev.vetoed), (s.att.pubkey(), true));
    assert_eq!(env.config(&config_pda(&s.mint)).pending_policy_eta, 0);
    expect_anchor_err(env.send(&[ix_apply_policy(&payer, &s.mint, &s.pool, None)], &[]), "NoPendingChange");
}

// ---------------------------------------------------------------------------------------------------------------------------------
// R3-4 — the cranker allowlist's 90-day bound and who may clear it
// ---------------------------------------------------------------------------------------------------------------------------------

fn ix_clear(caller: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::ClearCrankerAllowlist {}.data(),
        burn_receipts::accounts::ClearCrankerAllowlist { caller: *caller, platform: platform_pda(), event_authority: event_authority(), program: burn_receipts::ID }.to_account_metas(None),
    )
}

/// A registered, seeded buyback token with readings D1, D2 posted and a funded fee PDA.
fn cranking_token(env: &mut Env) -> (Pubkey, Pool) {
    let (mint_kp, creator, att) = (Keypair::new(), Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint_kp.pubkey(), init_args(buyback_rule(), vec![att.pubkey()], 1))], &[&creator, &mint_kp]);
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
    cpmm::seed_history(env, &pool, &mint);
    env.transfer_sol(&fee_pda(&mint), 10 * SOL);
    submit(env, &mint, D1, V1, &[&att]).unwrap();
    submit(env, &mint, D2, V1 + UNIT, &[&att]).unwrap();
    (mint, pool)
}

/// R3-4 (allowlist removed 2026-10-25): a cranker list passed to initialize_platform is not stored and never applies — an outsider
/// cranks at once, well inside the old 90-day window.
#[test]
fn r3_4_a_a_cranker_list_at_platform_init_is_ignored() {
    let mut env = Env::new();
    let (payer, ua) = (env.payer.pubkey(), env.upgrade_authority.insecure_clone());
    let (pa, keeper, outsider) = (Keypair::new(), Keypair::new(), Keypair::new());
    env.fund(&outsider.pubkey(), SOL);
    env.ok(&[ix_initialize_platform_with(&payer, &ua.pubkey(), &pa.pubkey(), LEGACY_CAP_ARG, NOW + 200 * 86_400, vec![keeper.pubkey()])], &[&ua]);
    let p = PlatformConfig::try_deserialize(&mut env.svm.get_account(&platform_pda()).unwrap().data.as_slice()).unwrap();
    assert_eq!((p.cranker_count, p.crankers), (0, [Pubkey::default(); PLATFORM_CRANKER_SLOTS]));
    let (mint, pool) = cranking_token(&mut env);
    env.ok(&[cpmm::ix_crank_buyback(&outsider.pubkey(), &mint, &pool, D2)], &[&outsider]);
    assert_eq!(env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap().outcome, OUTCOME_BURNED);
}

/// R3-4 (allowlist removed 2026-10-25): a PlatformConfig written by the old program WITH a stored list (the mainnet layout) still
/// deserialises; the list never applies (an outsider cranks); a listed key or the authority can still clear the stored bytes.
#[test]
fn r3_4_b_a_legacy_stored_list_never_applies_and_can_still_be_cleared() {
    let mut env = Env::new();
    let (payer, ua) = (env.payer.pubkey(), env.upgrade_authority.insecure_clone());
    let (pa, keeper, lost, outsider) = (Keypair::new(), Keypair::new(), Keypair::new(), Keypair::new());
    env.fund(&pa.pubkey(), SOL);
    env.fund(&outsider.pubkey(), SOL);
    env.ok(&[ix_initialize_platform_with(&payer, &ua.pubkey(), &pa.pubkey(), LEGACY_CAP_ARG, NOW + 200 * 86_400, vec![])], &[&ua]);
    // Write the old program's state into the account: a 25 SOL cap, a pending raise and two listed crankers.
    let key = platform_pda();
    let mut acc = env.svm.get_account(&key).unwrap();
    let mut p = PlatformConfig::try_deserialize(&mut acc.data.as_slice()).unwrap();
    p.burn_pool_cap_lamports = LEGACY_CAP_ARG;
    p.pending_cap_lamports = 1_000 * SOL;
    p.pending_cap_eta = NOW + 2 * 86_400;
    p.crankers[0] = lost.pubkey();
    p.crankers[1] = keeper.pubkey();
    p.cranker_count = 2;
    let mut data = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(&p, &mut data).unwrap();
    assert_eq!(data.len(), acc.data.len(), "the layout is unchanged");
    acc.data.copy_from_slice(&data);
    env.svm.set_account(key, acc).unwrap();
    // The stored list never applies and the stored cap never binds: an outsider cranks the whole pool.
    let (mint, pool) = cranking_token(&mut env);
    env.ok(&[cpmm::ix_crank_buyback(&outsider.pubkey(), &mint, &pool, D2)], &[&outsider]);
    let r = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap();
    assert_eq!((r.outcome, r.pool_lamports), (OUTCOME_BURNED, r.pool_actual_lamports));
    // The pending raise can never be applied.
    env.set_time(NOW + 3 * 86_400);
    expect_anchor_err(env.send(&[ix_apply_cap(&payer)], &[]), "CapRemoved");
    // Clearing still works for a listed key (an outsider cannot); the authority renounced first.
    expect_anchor_err(env.send(&[ix_clear(&outsider.pubkey())], &[&outsider]), "NotAdmin");
    env.ok(&[ix_platform("renounce", &pa.pubkey(), 0)], &[&pa]);
    let meta = env.ok(&[ix_clear(&keeper.pubkey())], &[&keeper]);
    assert_eq!(find_event::<CrankerAllowlistCleared>(&meta).unwrap().cleared_by, keeper.pubkey());
    let p = PlatformConfig::try_deserialize(&mut env.svm.get_account(&platform_pda()).unwrap().data.as_slice()).unwrap();
    assert_eq!((p.cranker_count, p.crankers), (0, [Pubkey::default(); PLATFORM_CRANKER_SLOTS]));
}
