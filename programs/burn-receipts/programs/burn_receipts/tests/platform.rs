//! The platform's pre-audit burn-pool cap (owner, 2026-10-09) and "no team allocation, no mint authority": LiteSVM.

// LiteSVM's FailedTransactionMetadata is large by design; test helpers take many accounts.
#![allow(clippy::result_large_err, clippy::too_many_arguments)]

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::{AccountDeserialize, AnchorDeserialize, Discriminator};
use burn_receipts::constants::*;
use burn_receipts::events::BurnPoolCapBound;
use burn_receipts::state::PlatformConfig;
use common::cpmm;
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

const V1: u64 = 4_027_300_000_000_000;
const D1: u32 = 20261005;
const D2: u32 = 20261006;

fn platform(env: &Env) -> PlatformConfig {
    PlatformConfig::try_deserialize(&mut env.svm.get_account(&platform_pda()).unwrap().data.as_slice()).unwrap()
}

/// A buyback-ready token (with ≈ 900 s of trades for the mandatory TWAP guard) under a platform cap of `cap`.
fn capped_market(env: &mut Env, cap: u64, platform_authority: &Pubkey) -> (Keypair, Keypair, cpmm::Pool) {
    let ua = env.upgrade_authority.insecure_clone();
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize_platform(&payer, &ua.pubkey(), platform_authority, cap, NOW + 30 * 86_400)], &[&ua]);
    let (mint, creator, att) = (Keypair::new(), Keypair::new(), Keypair::new());
    let args = init_args(buyback_rule(), vec![att.pubkey()], 1);
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint.pubkey(), args)], &[&creator, &mint]);
    let m = mint.pubkey();
    env.create_mint(&mint, &payer, DECIMALS);
    let launcher = Keypair::new();
    env.fund(&launcher.pubkey(), 200 * SOL);
    let amm = cpmm::setup_amm(env, &launcher.pubkey());
    let lt = env.create_ata(&launcher.pubkey(), &m);
    let me = env.payer.insecure_clone();
    env.mint_to(&m, &me, &lt, 800_000_000 * TOKEN);
    let pool = cpmm::create_pool(env, &launcher, &amm, &m, &fee_pda(&m), 85 * SOL, 800_000_000 * TOKEN, &lt);
    cpmm::launchlab_migrated(env, &m, &pool);
    env.ok(&[ix_register_pool(&payer, &m, &pool.pool)], &[]);
    env.create_ata(&fee_pda(&m), &NATIVE_MINT);
    env.create_ata(&fee_pda(&m), &m);
    cpmm::seed_history(env, &pool, &m);
    (mint, att, pool)
}

#[test]
fn platform_config_only_by_the_upgrade_authority_once_with_a_bounded_sunset() {
    let mut env = Env::new();
    let payer = env.payer.pubkey();
    let stranger = Keypair::new();
    env.fund(&stranger.pubkey(), SOL);
    let a = Pubkey::new_unique();
    expect_anchor_err(env.send(&[ix_initialize_platform(&payer, &stranger.pubkey(), &a, DEFAULT_BURN_POOL_CAP_LAMPORTS, NOW + 86_400)], &[&stranger]), "NotUpgradeAuthority");
    let ua = env.upgrade_authority.insecure_clone();
    expect_anchor_err(env.send(&[ix_initialize_platform(&payer, &ua.pubkey(), &a, DEFAULT_BURN_POOL_CAP_LAMPORTS, NOW - 1)], &[&ua]), "InvalidSunset");
    expect_anchor_err(env.send(&[ix_initialize_platform(&payer, &ua.pubkey(), &a, DEFAULT_BURN_POOL_CAP_LAMPORTS, NOW + MAX_CAP_SUNSET_SECS + 1)], &[&ua]), "InvalidSunset");
    let meta = env.ok(&[ix_initialize_platform(&payer, &ua.pubkey(), &a, DEFAULT_BURN_POOL_CAP_LAMPORTS, NOW + 90 * 86_400)], &[&ua]);
    assert_eq!(event_names(&meta), vec!["PlatformInitialized"]);
    expect_fail(env.send(&[ix_initialize_platform(&payer, &ua.pubkey(), &a, DEFAULT_BURN_POOL_CAP_LAMPORTS, NOW + 86_400)], &[&ua]));
    let pc = platform(&env);
    assert_eq!((pc.authority, pc.burn_pool_cap_lamports, pc.cap_sunset_ts), (a, 25 * SOL, NOW + 90 * 86_400));
}

#[test]
fn the_platform_account_must_be_the_platform_pda() {
    // Review-2 F17(c): replaces the stale `buyback_needs_the_platform_config` (a missing PlatformConfig is no longer an error —
    // review_fixes.rs::m1_* covers the default). What must hold: the crank's platform account is the ["platform"] PDA and nothing
    // else, so a cranker cannot point the cap lookup at an account of its choosing.
    let mut env = Env::new();
    let pa = Keypair::new();
    let (mint, att, pool) = capped_market(&mut env, DEFAULT_BURN_POOL_CAP_LAMPORTS, &pa.pubkey());
    let m = mint.pubkey();
    env.transfer_sol(&fee_pda(&m), 10 * SOL);
    submit(&mut env, &m, D1, V1, &[&att]).unwrap();
    submit(&mut env, &m, D2, V1 + UNIT, &[&att]).unwrap();
    let payer = env.payer.pubkey();
    let mut ix = cpmm::ix_crank_buyback(&payer, &m, &pool, D2);
    let at = ix.accounts.iter().position(|a| a.pubkey == platform_pda()).unwrap();
    ix.accounts[at].pubkey = Pubkey::new_unique();
    expect_anchor_err(env.send(&[ix], &[]), "ConstraintSeeds");
    env.ok(&[cpmm::ix_crank_buyback(&payer, &m, &pool, D2)], &[]);
}

#[test]
fn the_cap_binds_spend_on_min_pool_cap_keeps_the_excess_and_says_so() {
    let mut env = Env::new();
    let pa = Keypair::new();
    let (mint, att, pool) = capped_market(&mut env, DEFAULT_BURN_POOL_CAP_LAMPORTS, &pa.pubkey());
    let m = mint.pubkey();
    let fee = fee_pda(&m);
    // Review-3 I-2: the cap is always the 25 SOL default at creation, so the pool must exceed it to bind.
    env.transfer_sol(&fee, 40 * SOL);
    submit(&mut env, &m, D1, V1, &[&att]).unwrap();
    submit(&mut env, &m, D2, V1 + UNIT, &[&att]).unwrap();
    let before = env.lamports(&fee);
    let payer = env.payer.pubkey();
    let meta = env.ok(&[cpmm::ix_crank_buyback(&payer, &m, &pool, D2)], &[]);
    let r = env.reading(&reading_pda(&config_pda(&m), D2)).unwrap();
    let pool_actual = before - buyback_rule().reserve_lamports;
    let cap = DEFAULT_BURN_POOL_CAP_LAMPORTS;
    assert_eq!((r.pool_lamports, r.pool_actual_lamports), (cap, pool_actual));
    assert_eq!(r.spent_lamports, burn_receipts::math::buyback_spend(cap, 1, 500).unwrap());
    assert_eq!(before - env.lamports(&fee), r.spent_lamports, "only the capped spend left; the rest stays in the fee PDA");
    assert!(event_names(&meta).contains(&"BurnPoolCapBound"));
    let ev = events(&meta).into_iter().find(|(d, _)| d[..] == BurnPoolCapBound::DISCRIMINATOR[..]).unwrap();
    let b = BurnPoolCapBound::try_from_slice(&ev.1).unwrap();
    assert_eq!((b.pool_actual_lamports, b.cap_lamports, b.spent_lamports, b.record_date), (pool_actual, cap, r.spent_lamports, D2));
    // The memo's pool= is the basis the rule used, so spent = pool × (1 − 0.95^units) stays checkable from the memo alone.
    assert!(meta.logs.iter().any(|l| l.contains(&format!("|pool={}|spent={}|", cap, r.spent_lamports))));
}

#[test]
fn the_cap_only_rises_through_the_48h_timelock_and_sunsets_by_itself() {
    let mut env = Env::new();
    let pa = Keypair::new();
    env.fund(&pa.pubkey(), SOL);
    let (mint, att, pool) = capped_market(&mut env, DEFAULT_BURN_POOL_CAP_LAMPORTS, &pa.pubkey());
    let payer = env.payer.pubkey();
    let stranger = Keypair::new();
    env.fund(&stranger.pubkey(), SOL);
    expect_anchor_err(env.send(&[ix_platform("propose", &stranger.pubkey(), 30 * SOL)], &[&stranger]), "NotAdmin");
    expect_anchor_err(env.send(&[ix_platform("propose", &pa.pubkey(), SOL)], &[&pa]), "CapNotRaised");
    expect_anchor_err(env.send(&[ix_platform("propose", &pa.pubkey(), 25 * SOL)], &[&pa]), "CapNotRaised");
    let meta = env.ok(&[ix_platform("propose", &pa.pubkey(), 30 * SOL)], &[&pa]);
    assert_eq!(event_names(&meta), vec!["CapRaiseProposed"]);
    let now = env.now();
    expect_anchor_err(env.send(&[ix_apply_cap(&payer)], &[]), "TimelockNotElapsed");
    env.set_time(now + CAP_TIMELOCK_SECS - 1);
    expect_anchor_err(env.send(&[ix_apply_cap(&payer)], &[]), "TimelockNotElapsed");
    env.set_time(now + CAP_TIMELOCK_SECS);
    assert_eq!(event_names(&env.ok(&[ix_apply_cap(&payer)], &[])), vec!["CapRaised"]);
    assert_eq!(platform(&env).burn_pool_cap_lamports, 30 * SOL);
    // Cancel works while pending; renounce ends the power …
    env.ok(&[ix_platform("propose", &pa.pubkey(), 40 * SOL)], &[&pa]);
    assert_eq!(event_names(&env.ok(&[ix_platform("cancel", &pa.pubkey(), 0)], &[&pa])), vec!["CapRaiseCancelled"]);
    assert_eq!(event_names(&env.ok(&[ix_platform("renounce", &pa.pubkey(), 0)], &[&pa])), vec!["PlatformAuthorityRenounced"]);
    expect_anchor_err(env.send(&[ix_platform("propose", &pa.pubkey(), 40 * SOL)], &[&pa]), "AdminRenounced");
    // … and after the sunset the cap no longer applies at all: the rule spends on the whole pool.
    let m = mint.pubkey();
    let fee = fee_pda(&m);
    env.transfer_sol(&fee, 10 * SOL);
    env.set_time(NOW + 30 * 86_400);
    submit(&mut env, &m, D1, V1, &[&att]).unwrap();
    submit(&mut env, &m, D2, V1 + 3 * UNIT, &[&att]).unwrap();
    let before = env.lamports(&fee);
    let meta = env.ok(&[cpmm::ix_crank_buyback(&payer, &m, &pool, D2)], &[]);
    assert!(!event_names(&meta).contains(&"BurnPoolCapBound"));
    let r = env.reading(&reading_pda(&config_pda(&m), D2)).unwrap();
    assert_eq!(r.pool_lamports, before - buyback_rule().reserve_lamports);
    assert_eq!(r.pool_lamports, r.pool_actual_lamports);
}

/// (program id, first data byte, stack height) of every inner instruction of the last transaction.
fn inner_calls(env: &Env, meta: &litesvm::types::TransactionMetadata) -> Vec<(Pubkey, u8, u8)> {
    meta.inner_instructions
        .iter()
        .flatten()
        .map(|ii| (env.last_keys[ii.instruction.program_id_index as usize], ii.instruction.data.first().copied().unwrap_or(0), ii.stack_height))
        .collect()
}

#[test]
fn init_never_mints_or_moves_tokens_and_no_flow_ever_mints() {
    use anchor_spl::token::spl_token;
    let mut env = Env::new();
    let (mint, creator, att) = (Keypair::new(), Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    let ix = ix_initialize(&payer, &creator.pubkey(), &mint.pubkey(), init_args(vault_rule(), vec![att.pubkey()], 1));
    // initialize_token takes no token program and no token account: it cannot mint, transfer or receive tokens.
    assert!(ix.accounts.iter().all(|a| a.pubkey != spl_token::ID && a.pubkey != anchor_spl::associated_token::ID));
    let meta = env.ok(&[ix], &[&creator, &mint]);
    for (prog, _, _) in inner_calls(&env, &meta) {
        assert!(prog == anchor_lang::solana_program::system_program::ID || prog == burn_receipts::ID, "init invoked {prog}");
    }

    // Through a full vault cycle the program's only token instruction is Burn (8) — never MintTo (7) / MintToChecked (14) — and
    // supply only goes down.
    env.create_mint(&mint, &payer, DECIMALS);
    let vault = env.create_ata(&config_pda(&mint.pubkey()), &mint.pubkey());
    let me = env.payer.insecure_clone();
    env.mint_to(&mint.pubkey(), &me, &vault, 10_000_000 * TOKEN);
    submit(&mut env, &mint.pubkey(), D1, V1, &[&att]).unwrap();
    submit(&mut env, &mint.pubkey(), D2, V1 + 5 * UNIT, &[&att]).unwrap();
    let supply = env.mint_supply(&mint.pubkey());
    let meta = env.ok(&[ix_crank_vault(&payer, &mint.pubkey(), D2)], &[]);
    let token_calls: Vec<u8> = inner_calls(&env, &meta).into_iter().filter(|(p, _, _)| *p == spl_token::ID).map(|(_, tag, _)| tag).collect();
    assert_eq!(token_calls, vec![8]);
    assert_eq!(env.mint_supply(&mint.pubkey()), supply - 5 * 100_000 * TOKEN);
}

#[test]
fn buyback_token_calls_are_only_sync_native_and_burn_from_the_program() {
    use anchor_spl::token::spl_token;
    let mut env = Env::new();
    let pa = Keypair::new();
    let (mint, att, pool) = capped_market(&mut env, DEFAULT_BURN_POOL_CAP_LAMPORTS, &pa.pubkey());
    let m = mint.pubkey();
    env.transfer_sol(&fee_pda(&m), 4 * SOL);
    submit(&mut env, &m, D1, V1, &[&att]).unwrap();
    submit(&mut env, &m, D2, V1 + 2 * UNIT, &[&att]).unwrap();
    let payer = env.payer.pubkey();
    let meta = env.ok(&[cpmm::ix_crank_buyback(&payer, &m, &pool, D2)], &[]);
    let calls = inner_calls(&env, &meta);
    // Direct calls from burn_receipts (stack height 2): system transfer into its own WSOL ATA, SyncNative (17), the CPMM swap, Burn (8),
    // the memo, and its own event self-CPIs. CPMM's internal token transfers run at height 3.
    let direct_token: Vec<u8> = calls.iter().filter(|(p, _, h)| *p == spl_token::ID && *h == 2).map(|(_, t, _)| *t).collect();
    assert_eq!(direct_token, vec![17, 8]);
    assert!(!calls.iter().any(|(p, t, _)| *p == spl_token::ID && (*t == 7 || *t == 14)), "nothing ever mints");
    let direct_programs: Vec<Pubkey> = calls.iter().filter(|(_, _, h)| *h == 2).map(|(p, _, _)| *p).collect();
    for p in &direct_programs {
        assert!(
            [anchor_lang::solana_program::system_program::ID, spl_token::ID, CPMM_PROGRAM_ID, MEMO_PROGRAM_ID, burn_receipts::ID].contains(p),
            "unexpected direct CPI to {p}"
        );
    }
}
