//! Fixes for the 2026-10-09 blind review (docs/burn-receipts/CHANGELOG.md): M-1, M-2, M-3, M-4, L-1, L-3, I-2 in LiteSVM.
//! (H-1 is in integration.rs's buyback tests, H-2 in launchlab.rs, L-2 / L-4 / L-7 / I-1 / I-4 in integration.rs and platform.rs.)

// LiteSVM's FailedTransactionMetadata is large by design; test helpers take many accounts.
#![allow(clippy::result_large_err, clippy::too_many_arguments)]

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::{AnchorDeserialize, Discriminator};
use anchor_spl::token::spl_token;
use burn_receipts::constants::*;
use burn_receipts::events::{BurnPoolCapBound, PoolReplaced, PoolUntradeableFlagged, ReadingReset};
use common::cpmm::{self, Pool};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

const V1: u64 = 4_027_300_000_000_000;
const D1: u32 = 20261001;
const D2: u32 = 20261002;
const D3: u32 = 20261005;

struct Mkt {
    mint: Pubkey,
    att: Keypair,
    pool: Pool,
    launcher: Keypair,
}

/// A buyback token on a real CPMM pool with ≈ 900 s of trades — and NO PlatformConfig.
fn market_without_platform(env: &mut Env) -> Mkt {
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
    Mkt { mint, att, pool, launcher }
}

/// Review M-1 (cap removed 2026-10-25): with no PlatformConfig a crank never wedges, and since the owner removed the burn-pool cap
/// there is no default cap either: the rule applies to the whole pool and no BurnPoolCapBound is emitted.
#[test]
fn m1_missing_platform_config_never_wedges_and_applies_no_cap() {
    let mut env = Env::new();
    let m = market_without_platform(&mut env);
    assert!(env.svm.get_account(&platform_pda()).map(|a| a.data.is_empty()).unwrap_or(true), "no PlatformConfig exists");
    env.transfer_sol(&fee_pda(&m.mint), 30 * SOL);
    submit(&mut env, &m.mint, D1, V1, &[&m.att]).unwrap();
    submit(&mut env, &m.mint, D2, V1 + UNIT, &[&m.att]).unwrap();
    let payer = env.payer.pubkey();
    let meta = env.ok(&[cpmm::ix_crank_buyback(&payer, &m.mint, &m.pool, D2)], &[]);
    let r = env.reading(&reading_pda(&config_pda(&m.mint), D2)).unwrap();
    assert_eq!(r.outcome, OUTCOME_BURNED);
    assert!(r.pool_actual_lamports > LEGACY_CAP_ARG);
    assert_eq!(r.pool_lamports, r.pool_actual_lamports, "no default 25 SOL cap without a PlatformConfig");
    assert!(!events(&meta).into_iter().any(|(d, _)| d[..] == BurnPoolCapBound::DISCRIMINATOR[..]));
}

#[test]
fn m2_out_of_bound_reading_resets_loudly() {
    let mut env = Env::new();
    let (mint, creator, a) = (Keypair::new(), Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint.pubkey(), init_args(vault_rule(), vec![a.pubkey()], 1))], &[&creator, &mint]);
    let m = mint.pubkey();
    submit(&mut env, &m, D1, V1, &[&a]).unwrap();
    let jump = V1 + 2_500_000_000_000 * 100; // +$2.5T, over the $2T bound
    let meta = submit(&mut env, &m, D2, jump, &[&a]).unwrap();
    assert!(event_names(&meta).contains(&"ReadingReset"));
    let ev = events(&meta).into_iter().find(|(d, _)| d[..] == ReadingReset::DISCRIMINATOR[..]).unwrap();
    let e = ReadingReset::try_from_slice(&ev.1).unwrap();
    assert_eq!((e.prev_value, e.value, e.max_abs_delta), (V1, jump, vault_rule().max_abs_delta));
    let r = env.reading(&reading_pda(&config_pda(&m), D2)).unwrap();
    assert_eq!((r.kind, r.units, r.processed), (KIND_RESET, 0, true), "a reset is a zero-unit reading, processed on the spot");
    submit(&mut env, &m, D3, jump + 3 * UNIT, &[&a]).unwrap();
    assert_eq!(env.reading(&reading_pda(&config_pda(&m), D3)).unwrap().units, 3);
}

#[test]
fn m3_signatures_are_bound_to_program_and_mint() {
    let mut env = Env::new();
    let a = Keypair::new();
    let payer = env.payer.pubkey();
    let mut mints = vec![];
    for _ in 0..2 {
        let (mint, creator) = (Keypair::new(), Keypair::new());
        env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint.pubkey(), init_args(vault_rule(), vec![a.pubkey()], 1))], &[&creator, &mint]);
        mints.push(mint.pubkey());
    }
    // Token A's (public) signed baseline replayed to token B — same attester, same feed — is refused.
    let msg_a = message(&mints[0], 0, D1, V1);
    let sig = sign(&a, &msg_a);
    env.ok(&[ed25519_ix(&[(a.pubkey(), sig, msg_a.clone())]), ix_submit(&payer, &mints[0], D1, V1)], &[]);
    expect_anchor_err(env.send(&[ed25519_ix(&[(a.pubkey(), sig, msg_a)]), ix_submit(&payer, &mints[1], D1, V1)], &[]), "QuorumNotMet");
    // The message names the program and the mint explicitly.
    let text = String::from_utf8(message(&mints[1], 0, D1, V1)).unwrap();
    assert!(text.starts_with(&format!("BURNRECEIPTS-v3|{}|{}|{}|", CLUSTER_GENESIS_HASH, burn_receipts::ID, mints[1])), "{text}");
}

#[test]
fn l1_presigned_readings_cannot_be_reordered() {
    let mut env = Env::new();
    let (mint, creator, a) = (Keypair::new(), Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint.pubkey(), init_args(vault_rule(), vec![a.pubkey()], 1))], &[&creator, &mint]);
    let m = mint.pubkey();
    submit(&mut env, &m, D1, V1, &[&a]).unwrap();
    // The keeper pre-signs D2 (after D1) and D3 (after D2). A front-runner submits D3 first: its signature names prev=D2, the chain
    // says the last reading is D1 → refused, and D2 is not lost.
    let m2 = message(&m, D1, D2, V1 + UNIT);
    let m3 = message(&m, D2, D3, V1 + 3 * UNIT);
    let (s2, s3) = (sign(&a, &m2), sign(&a, &m3));
    expect_anchor_err(env.send(&[ed25519_ix(&[(a.pubkey(), s3, m3.clone())]), ix_submit(&payer, &m, D3, V1 + 3 * UNIT)], &[]), "QuorumNotMet");
    env.ok(&[ed25519_ix(&[(a.pubkey(), s2, m2)]), ix_submit(&payer, &m, D2, V1 + UNIT)], &[]);
    env.ok(&[ed25519_ix(&[(a.pubkey(), s3, m3)]), ix_submit(&payer, &m, D3, V1 + 3 * UNIT)], &[]);
    assert_eq!(env.config(&config_pda(&m)).last_record_date, D3);
}

#[test]
fn l3_mints_with_retained_authorities_are_refused() {
    let mut env = Env::new();
    let payer = env.payer.pubkey();
    // A buyback token whose mint keeps its mint authority: register_pool refuses before looking at any pool.
    let (mint, creator, a) = (Keypair::new(), Keypair::new(), Keypair::new());
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint.pubkey(), init_args(buyback_rule(), vec![a.pubkey()], 1))], &[&creator, &mint]);
    env.create_mint_with_authority(&mint, &payer, DECIMALS);
    expect_anchor_err(env.send(&[ix_register_pool_full(&payer, &mint.pubkey(), &Pubkey::new_unique(), &NATIVE_MINT, None)], &[]), "MintAuthorityRetained");
    // A vault token whose mint keeps a freeze authority (mint authority revoked): the crank refuses.
    let (mint2, creator2) = (Keypair::new(), Keypair::new());
    env.ok(&[ix_initialize(&payer, &creator2.pubkey(), &mint2.pubkey(), init_args(vault_rule(), vec![a.pubkey()], 1))], &[&creator2, &mint2]);
    let m2 = mint2.pubkey();
    env.create_mint_full(&mint2, &payer, Some(&payer), DECIMALS);
    let vault = env.create_ata(&config_pda(&m2), &m2);
    let ixs = [
        spl_token::instruction::mint_to(&spl_token::ID, &m2, &vault, &payer, &[], 10_000_000 * TOKEN).unwrap(),
        spl_token::instruction::set_authority(&spl_token::ID, &m2, None, spl_token::instruction::AuthorityType::MintTokens, &payer, &[]).unwrap(),
    ];
    env.ok(&ixs, &[]);
    submit(&mut env, &m2, D1, V1, &[&a]).unwrap();
    submit(&mut env, &m2, D2, V1 + 2 * UNIT, &[&a]).unwrap();
    expect_anchor_err(env.send(&[ix_crank_vault(&payer, &m2, D2)], &[]), "FreezeAuthorityRetained");
}

#[test]
fn i2_an_overwritten_proposal_is_reported_cancelled() {
    let mut env = Env::new();
    let (mint, creator, a) = (Keypair::new(), Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint.pubkey(), init_args(vault_rule(), vec![a.pubkey()], 1))], &[&creator, &mint]);
    let c = creator.pubkey();
    let m = mint.pubkey();
    env.set_time(NOW + ATTESTER_SENIORITY_SECS);
    assert_eq!(event_names(&env.ok(&[ix_admin("propose", &c, &m, ed(&[a.pubkey(), Pubkey::new_unique()]), 2)], &[&creator])), vec!["AttesterChangeProposed"]);
    assert_eq!(
        event_names(&env.ok(&[ix_admin("propose", &c, &m, ed(&[a.pubkey(), Pubkey::new_unique()]), 2)], &[&creator])),
        vec!["AttesterChangeCancelled", "AttesterChangeProposed"]
    );
}

fn set_pool_status(env: &mut Env, pool: &Pubkey, status: u8) {
    let mut acc = env.svm.get_account(pool).unwrap();
    acc.data[329] = status;
    env.svm.set_account(*pool, acc).unwrap();
}

#[test]
fn m4_a_dead_pool_can_be_replaced_only_after_7_days_and_only_by_another_fee_pda_pool() {
    let mut env = Env::new();
    let m = market_without_platform(&mut env);
    let payer = env.payer.pubkey();
    let check = |env: &mut Env, pool: &Pool| {
        let ix = ix_check_pool_health(&env.payer.pubkey(), &m.mint, &pool.pool, &pool.wsol_vault());
        env.ok(&[ix], &[])
    };
    // Healthy: nothing recorded.
    assert!(event_names(&check(&mut env, &m.pool)).is_empty());
    assert_eq!(env.config(&config_pda(&m.mint)).pool_untradeable_since, 0);
    // Raydium disables swaps (status bit 2): recorded once, with the reason.
    set_pool_status(&mut env, &m.pool.pool, 4);
    let t0 = env.now();
    let meta = check(&mut env, &m.pool);
    let ev = events(&meta).into_iter().find(|(d, _)| d[..] == PoolUntradeableFlagged::DISCRIMINATOR[..]).unwrap();
    let f = PoolUntradeableFlagged::try_from_slice(&ev.1).unwrap();
    // Review-3 L-3: one observation is only a candidate; the spell starts with a second one ≥ 1 h later.
    assert_eq!((f.since, f.candidate_at, f.reason), (0, t0, burn_receipts::instructions::pool_health::UNTRADEABLE_SWAPS_DISABLED));
    // Re-enabled: anyone clears it.
    set_pool_status(&mut env, &m.pool.pool, 0);
    assert_eq!(event_names(&check(&mut env, &m.pool)), vec!["PoolUntradeableCleared"]);
    set_pool_status(&mut env, &m.pool.pool, 4);
    env.set_time(t0 + 10);
    check(&mut env, &m.pool);
    env.set_time(t0 + 10 + UNTRADEABLE_CONFIRM_SECS);
    check(&mut env, &m.pool);
    let since = env.config(&config_pda(&m.mint)).pool_untradeable_since;
    assert_eq!(since, t0 + 10, "the clock restarted after the pool was shown tradeable");

    // A second permissioned pool for the same pair (AmmConfig 1) whose creator is again the fee PDA.
    let amm1 = cpmm::create_amm_config(&mut env, 1);
    let lt = get_associated_token_address_hack(&m.launcher.pubkey(), &m.mint);
    let me = env.payer.insecure_clone();
    env.mint_to(&m.mint, &me, &lt, 400_000_000 * TOKEN);
    let launcher = m.launcher.insecure_clone();
    let new_pool = cpmm::create_pool(&mut env, &launcher, &amm1, &m.mint, &fee_pda(&m.mint), 40 * SOL, 400_000_000 * TOKEN, &lt);
    env.set_time(env.now() + 5);
    let replace = |env: &mut Env, new: &Pool| {
        let ix = ix_replace_pool(&env.payer.pubkey(), &m.mint, &m.pool.pool, &m.pool.wsol_vault(), &new.pool, &new.wsol_vault());
        env.send(&[ix], &[])
    };
    expect_anchor_err(replace(&mut env, &new_pool), "PoolStillTradeable"); // not 7 days yet
    // Review-2 F6: the 7 days must be continuous — an observation at least every 24 h.
    for day in 1..=6 {
        env.set_time(since + day * 86_400);
        check(&mut env, &m.pool);
    }
    env.set_time(since + POOL_REPLACEMENT_DELAY_SECS);
    expect_anchor_err(replace(&mut env, &m.pool), "SamePool");
    // Review-2 F5: the replacement must be the LaunchLab platform's migration pool — AmmConfig 1 is not its cpConfigId yet.
    expect_anchor_err(replace(&mut env, &new_pool), "NotMigrationPool");
    cpmm::set_platform_cp_config(&mut env, &amm1);
    // If the old pool came back to life, no replacement.
    set_pool_status(&mut env, &m.pool.pool, 0);
    expect_anchor_err(replace(&mut env, &new_pool), "PoolStillTradeable");
    set_pool_status(&mut env, &m.pool.pool, 4);
    let meta = replace(&mut env, &new_pool).unwrap();
    let ev = events(&meta).into_iter().find(|(d, _)| d[..] == PoolReplaced::DISCRIMINATOR[..]).unwrap();
    let r = PoolReplaced::try_from_slice(&ev.1).unwrap();
    assert_eq!((r.old_pool, r.new_pool, r.untradeable_since), (m.pool.pool, new_pool.pool, since));
    let c = env.config(&config_pda(&m.mint));
    assert_eq!((c.cpmm_pool, c.pool_untradeable_since), (new_pool.pool, 0));
    // Burns resume on the new pool.
    cpmm::seed_history(&mut env, &new_pool, &m.mint);
    env.transfer_sol(&fee_pda(&m.mint), 2 * SOL);
    submit(&mut env, &m.mint, D1, V1, &[&m.att]).unwrap();
    submit(&mut env, &m.mint, D2, V1 + UNIT, &[&m.att]).unwrap();
    env.ok(&[cpmm::ix_crank_buyback(&payer, &m.mint, &new_pool, D2)], &[]);
    assert_eq!(env.reading(&reading_pda(&config_pda(&m.mint), D2)).unwrap().outcome, OUTCOME_BURNED);
}

fn get_associated_token_address_hack(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    anchor_spl::associated_token::get_associated_token_address(owner, mint)
}
