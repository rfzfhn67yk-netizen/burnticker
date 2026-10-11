//! Blind review 2026-10-11 of the LP-lock release (LAUNCHPAD-PATH §35) — exploit tests for burn_receipts `register_fee_key`,
//! `claim_lock_fees` and the policy-0 platform pins (docs/burnticker/reviews/2026-10-11-lp-lock-blind.md).
//!
//! Every `rl*` test asserts the SAFE behaviour, so it FAILS against the reviewed code (07adf0fe; program sources = 3d82b6b5) and passes
//! once the finding is fixed. They are `#[ignore]`d so scripts/test.sh stays green; run them with
//!   cargo test -p burn_receipts --test review_lock -- --include-ignored --test-threads=1 --nocapture
//! `mf*` tests are MOCK-FIDELITY checks (they fail against the stand-in and pass against the real program); `ctl_*` are controls.
//!
//! The lock program: by default the TEST-ONLY stand-in (fixtures/cpmm_lock_mock.so). Set REVIEW_LOCK_SO=<path> to load another
//! binary at Raydium's lock program id instead — e.g. the REAL mainnet program dumped read-only with
//!   solana program dump -u https://api.mainnet-beta.solana.com LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE lock_mainnet.so
//! (its authority PDA and its compiled CPMM id are mainnet's — the ids this harness's localnet build uses).

#![allow(clippy::result_large_err, clippy::too_many_arguments)]
mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::{AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas};
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::spl_token;
use burn_receipts::constants::*;
use burn_receipts::events::LockFeesClaimed;
use common::cpmm::{self, Pool};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

const TREASURY: Pubkey = Pubkey::new_from_array([0x7e; 32]);
const TOKEN_2022: Pubkey = anchor_lang::prelude::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const METADATA_PROGRAM_ID: Pubkey = anchor_lang::prelude::pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const LOCK_CP_LIQUIDITY: [u8; 8] = [216, 157, 29, 78, 38, 51, 31, 26];
const CPMM_DEPOSIT: [u8; 8] = [242, 35, 198, 137, 82, 225, 242, 182];

fn read(rel: &str) -> Vec<u8> {
    let p = format!("{}/../../{rel}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).unwrap_or_else(|e| panic!("cannot read {p}: {e} (run scripts/test.sh first)"))
}

fn lock_program_so() -> Vec<u8> {
    match std::env::var("REVIEW_LOCK_SO") {
        Ok(p) if !p.is_empty() => std::fs::read(&p).unwrap_or_else(|e| panic!("REVIEW_LOCK_SO={p}: {e}")),
        _ => read("fixtures/cpmm_lock_mock.so"),
    }
}

fn lock_env() -> Env {
    let mut env = Env::new();
    env.svm.add_program(burn_receipts::ID, &read("target/deploy-localnet/burn_receipts.so")).unwrap();
    env.svm.add_program(LOCK_CPMM_PROGRAM_ID, &lock_program_so()).unwrap();
    // The real lock program's account list declares Metaplex's program (Program<'info, ...>): any executable stands in for it at its
    // id (with_metadata = false, so it is never invoked). The stand-in mock ignores the account.
    env.svm.add_program(METADATA_PROGRAM_ID, &read("fixtures/cpmm_lock_mock.so")).unwrap();
    env.fund(&TREASURY, SOL);
    env
}

fn fee_keys() -> Pubkey {
    Pubkey::find_program_address(&[FEE_KEYS_SEED], &burn_receipts::ID).0
}
fn fee_key_record(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[FEE_KEY_SEED, mint.as_ref()], &burn_receipts::ID).0
}
fn locked_liquidity(nft: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[LOCKED_LIQUIDITY_SEED, nft.as_ref()], &LOCK_CPMM_PROGRAM_ID).0
}

fn ix_lock(launcher: &Pubkey, nft_owner: &Pubkey, nft: &Pubkey, p: &Pool, lp: u64) -> Instruction {
    let mut data = LOCK_CP_LIQUIDITY.to_vec();
    data.extend_from_slice(&lp.to_le_bytes());
    data.push(0);
    let metadata = Pubkey::find_program_address(&[b"metadata", METADATA_PROGRAM_ID.as_ref(), nft.as_ref()], &METADATA_PROGRAM_ID).0;
    Instruction {
        program_id: LOCK_CPMM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(LOCK_CPMM_AUTHORITY, false),
            AccountMeta::new(*launcher, true),
            AccountMeta::new_readonly(*launcher, true),
            AccountMeta::new_readonly(*nft_owner, false),
            AccountMeta::new(*nft, true),
            AccountMeta::new(get_associated_token_address(nft_owner, nft), false),
            AccountMeta::new_readonly(p.pool, false),
            AccountMeta::new(locked_liquidity(nft), false),
            AccountMeta::new_readonly(p.lp_mint, false),
            AccountMeta::new(get_associated_token_address(launcher, &p.lp_mint), false),
            AccountMeta::new(get_associated_token_address(&LOCK_CPMM_AUTHORITY, &p.lp_mint), false),
            AccountMeta::new(p.token_0_vault, false),
            AccountMeta::new(p.token_1_vault, false),
            AccountMeta::new(metadata, false),
            AccountMeta::new_readonly(SYSVAR_RENT_ID, false),
            AccountMeta::new_readonly(anchor_lang::solana_program::system_program::ID, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(anchor_spl::associated_token::ID, false),
            AccountMeta::new_readonly(METADATA_PROGRAM_ID, false),
        ],
        data,
    }
}

fn ix_register_fee_key(payer: &Pubkey, mint: &Pubkey, pool: &Pubkey, nft: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::RegisterFeeKey {}.data(),
        burn_receipts::accounts::RegisterFeeKey {
            payer: *payer,
            config: config_pda(mint),
            fee_key: fee_key_record(mint),
            fee_keys: fee_keys(),
            pool_state: *pool,
            fee_nft_mint: *nft,
            fee_nft_account: get_associated_token_address(&fee_keys(), nft),
            locked_liquidity: locked_liquidity(nft),
            system_program: anchor_lang::solana_program::system_program::ID,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

fn ix_claim(cranker: &Pubkey, mint: &Pubkey, p: &Pool, nft: &Pubkey, lp_fee_amount: u64) -> Instruction {
    let fk = fee_keys();
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::ClaimLockFees { lp_fee_amount }.data(),
        burn_receipts::accounts::ClaimLockFees {
            cranker: *cranker,
            platform: platform_pda(),
            config: config_pda(mint),
            fee_key: fee_key_record(mint),
            fee_keys: fk,
            fee_vault: fee_pda(mint),
            operator_treasury: TREASURY,
            mint: *mint,
            wsol_mint: NATIVE_MINT,
            fee_keys_wsol: get_associated_token_address(&fk, &NATIVE_MINT),
            fee_keys_token: get_associated_token_address(&fk, mint),
            fee_nft_account: get_associated_token_address(&fk, nft),
            locked_liquidity: locked_liquidity(nft),
            lock_program: LOCK_CPMM_PROGRAM_ID,
            lock_authority: LOCK_CPMM_AUTHORITY,
            cpmm_program: CPMM_PROGRAM_ID,
            cpmm_authority: p.authority,
            pool_state: p.pool,
            lp_mint: p.lp_mint,
            token_0_vault: p.token_0_vault,
            token_1_vault: p.token_1_vault,
            lock_lp_vault: get_associated_token_address(&LOCK_CPMM_AUTHORITY, &p.lp_mint),
            token_program: spl_token::ID,
            token_2022_program: TOKEN_2022,
            memo_program: MEMO_PROGRAM_ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

/// CPMM `deposit` (SDK makeDepositCpmmInInstruction account order): `lp` LP for at most `max0` / `max1` of token 0 / token 1.
fn ix_deposit(owner: &Pubkey, p: &Pool, lp: u64, max0: u64, max1: u64) -> Instruction {
    let mut data = CPMM_DEPOSIT.to_vec();
    for v in [lp, max0, max1] {
        data.extend_from_slice(&v.to_le_bytes());
    }
    Instruction {
        program_id: CPMM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*owner, true),
            AccountMeta::new_readonly(p.authority, false),
            AccountMeta::new(p.pool, false),
            AccountMeta::new(get_associated_token_address(owner, &p.lp_mint), false),
            AccountMeta::new(get_associated_token_address(owner, &p.token_0_mint), false),
            AccountMeta::new(get_associated_token_address(owner, &p.token_1_mint), false),
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

/// PoolState.lp_supply (raydium-cp-swap b3187ae5 offset 333).
fn lp_supply(env: &Env, pool: &Pubkey) -> u64 {
    let d = env.svm.get_account(pool).unwrap().data;
    u64::from_le_bytes(d[333..341].try_into().unwrap())
}

/// A third party adds `lp` LP of liquidity to the pool (funded with both sides; tokens from the harness treasury).
fn add_liquidity(env: &mut Env, mint: &Pubkey, p: &Pool, lp: u64) -> Keypair {
    let who = Keypair::new();
    env.fund(&who.pubkey(), 2_000 * SOL);
    env.wrap_sol(&who, 1_000 * SOL);
    let t = env.create_ata(&who.pubkey(), mint);
    let me = env.payer.insecure_clone();
    env.mint_to(mint, &me, &t, 5_000_000_000 * TOKEN);
    env.create_ata(&who.pubkey(), &p.lp_mint);
    env.ok(&[ix_deposit(&who.pubkey(), p, lp, u64::MAX, u64::MAX)], &[&who]);
    who
}

thread_local! {
    static LAUNCHER: std::cell::RefCell<Option<Keypair>> = const { std::cell::RefCell::new(None) };
}

struct Coin {
    mint: Pubkey,
    pool: Pool,
    nfts: Vec<Pubkey>,
}

/// A policy-0 LaunchLab coin: initialize_token (platform pins pass), migration into the CPMM pool (fee-PDA creator), LP locked in
/// Raydium's lock in `shares` with each Fee Key to `owner` (default FEE_KEYS), then `before_register` runs and register_pool.
fn coin_with(env: &mut Env, shares: &[u64], owner: Option<Pubkey>, before_register: impl FnOnce(&mut Env, &Pubkey, &Pool)) -> Coin {
    let (mint_kp, creator, att) = (Keypair::new(), Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint_kp.pubkey(), init_args(buyback_rule(), vec![att.pubkey()], 1))], &[&creator, &mint_kp]);
    let mint = mint_kp.pubkey();
    env.create_mint(&mint_kp, &payer, DECIMALS);
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
    let amm = cpmm::amm_config_0();
    let lt = env.create_ata(&launcher.pubkey(), &mint);
    let me = env.payer.insecure_clone();
    env.mint_to(&mint, &me, &lt, 800_000_000 * TOKEN);
    let pool = cpmm::create_pool_unlocked(env, &launcher, &amm, &mint, &fee_pda(&mint), 85 * SOL, 800_000_000 * TOKEN, &lt);
    let all = env.token_amount(&get_associated_token_address(&launcher.pubkey(), &pool.lp_mint));
    let owner = owner.unwrap_or_else(fee_keys);
    let mut nfts = vec![];
    let mut left = all;
    for (i, pct) in shares.iter().enumerate() {
        let lp = if i + 1 == shares.len() { left } else { all * pct / 100 };
        left -= lp;
        let nft = Keypair::new();
        env.ok(&[ix_lock(&launcher.pubkey(), &owner, &nft.pubkey(), &pool, lp)], &[&launcher, &nft]);
        nfts.push(nft.pubkey());
    }
    cpmm::launchlab_migrated(env, &mint, &pool);
    before_register(env, &mint, &pool);
    env.ok(&[ix_register_pool(&payer, &mint, &pool.pool)], &[]);
    Coin { mint, pool, nfts }
}

fn coin(env: &mut Env) -> Coin {
    coin_with(env, &[100], None, |_, _, _| {})
}

fn trade(env: &mut Env, c: &Coin, rounds: u32, lamports: u64) {
    let now = env.now();
    env.set_time(now + 60);
    let t = Keypair::new();
    env.fund(&t.pubkey(), 100 * SOL + rounds as u64 * lamports);
    env.create_ata(&t.pubkey(), &c.mint);
    for _ in 0..rounds {
        env.wrap_sol(&t, lamports);
        cpmm::swap(env, &t, &c.pool, &c.mint, true, lamports).unwrap();
        let got = env.token_amount(&get_associated_token_address(&t.pubkey(), &c.mint));
        cpmm::swap(env, &t, &c.pool, &c.mint, false, got).unwrap();
    }
}

fn event<T: AnchorDeserialize + Discriminator>(meta: &litesvm::types::TransactionMetadata) -> Option<T> {
    events(meta).into_iter().find(|(d, _)| d[..] == T::DISCRIMINATOR[..]).map(|(_, p)| T::try_from_slice(&p).unwrap())
}

fn claim(env: &mut Env, c: &Coin, cranker: &Keypair, lp_fee_amount: u64) -> TxResult {
    env.send(&[ix_claim(&cranker.pubkey(), &c.mint, &c.pool, &c.nfts[0], lp_fee_amount)], &[cranker])
}

/// WSOL the coin's fee stream delivered in one honest (u64::MAX) claim.
fn claimed_wsol(env: &mut Env, c: &Coin, cranker: &Keypair) -> u64 {
    match claim(env, c, cranker, u64::MAX) {
        Ok(m) => event::<LockFeesClaimed>(&m).map(|e| e.wsol_claimed).unwrap_or(0),
        Err(e) => panic!("honest claim failed: {:?}\n{}", e.err, e.meta.logs.join("\n")),
    }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// controls
// ---------------------------------------------------------------------------------------------------------------------------------

/// The harness and the chosen lock binary work end to end: lock → register → trade → one honest claim delivers WSOL.
#[test]
fn ctl_lock_register_trade_claim() {
    let mut env = lock_env();
    let c = coin(&mut env);
    let payer = env.payer.insecure_clone();
    env.ok(&[ix_register_fee_key(&payer.pubkey(), &c.mint, &c.pool.pool, &c.nfts[0])], &[]);
    trade(&mut env, &c, 6, 5 * SOL);
    let k = Keypair::new();
    env.fund(&k.pubkey(), SOL);
    let got = claimed_wsol(&mut env, &c, &k);
    println!("ctl: one honest claim after 6 round trips of 5 SOL delivered {got} lamports of WSOL");
    assert!(got > 0);
    // LockedCpLiquidityState @128: the real program records the LIQUIDITY OWNER (who locked: LaunchLab's vault_auth_seed PDA on
    // devnet, here the launcher); the stand-in records the Fee Key owner. Printed, not asserted (it differs by binary).
    let d = env.svm.get_account(&locked_liquidity(&c.nfts[0])).unwrap().data;
    let at128 = Pubkey::new_from_array(d[128..160].try_into().unwrap());
    let launcher = LAUNCHER.with(|l| l.borrow().as_ref().unwrap().pubkey());
    {
        use anchor_lang::solana_program::program_pack::Pack;
        let m = spl_token::state::Mint::unpack(&env.svm.get_account(&c.nfts[0]).unwrap().data).unwrap();
        println!("ctl: Fee Key mint: supply {} decimals {} mint_authority {:?} freeze_authority {:?}", m.supply, m.decimals, m.mint_authority, m.freeze_authority);
    }
    println!("ctl: state@128 = {} (liquidity owner/launcher: {}, Fee Key owner/FEE_KEYS: {})", if at128 == launcher { "LIQUIDITY OWNER" } else if at128 == fee_keys() { "FEE KEY OWNER" } else { "other" }, at128 == launcher, at128 == fee_keys());
}

// ---------------------------------------------------------------------------------------------------------------------------------
// findings
// ---------------------------------------------------------------------------------------------------------------------------------

/// MF-1 — MOCK FIDELITY (Info; fails against the stand-in, PASSES against the real mainnet lock program). claim_lock_fees takes a
/// caller-chosen `lp_fee_amount`. A cranker claims a dust amount (DUST_LP = 10,000 LP units, ~0.0001 % of
/// the position; 1 unit is refused by CPMM as a zero-token withdrawal). If the lock program
/// re-bases the position's fee baseline on every collect (the stand-in does), everything accrued and not collected is folded into the
/// locked principal for good — the burn pool never receives it. SAFE behaviour: after the dust claim, an honest claim still
/// delivers (almost) what an honest claim delivers in a twin run without the dust claim.
const DUST_LP: u64 = 10_000;

#[test]
#[ignore = "MF-1 (Info, mock fidelity): fails against fixtures/cpmm_lock_mock.so, passes with REVIEW_LOCK_SO=<real lock program>"]
fn mf1_a_dust_lp_fee_amount_must_not_erase_accrued_fees() {
    let run = |dust: bool| -> u64 {
        let mut env = lock_env();
        let c = coin(&mut env);
        let payer = env.payer.insecure_clone();
        env.ok(&[ix_register_fee_key(&payer.pubkey(), &c.mint, &c.pool.pool, &c.nfts[0])], &[]);
        trade(&mut env, &c, 6, 5 * SOL);
        let k = Keypair::new();
        env.fund(&k.pubkey(), SOL);
        if dust {
            let r = claim(&mut env, &c, &k, DUST_LP);
            println!("MF-1 dust claim (lp_fee_amount = {DUST_LP}): {}", match &r { Ok(_) => "accepted".to_string(), Err(e) => format!("refused {:?}", e.err) });
        }
        claimed_wsol(&mut env, &c, &k)
    };
    let (control, after_dust) = (run(false), run(true));
    println!("MF-1: honest claim {control} lamports; honest claim after a dust claim {after_dust} lamports");
    assert!(control > 0);
    assert!(after_dust as u128 * 100 >= control as u128 * 95, "a dust claim erased {} of {} lamports of accrued fees", control - after_dust.min(control), control);
}

/// RL-2 (register_fee_key majority is measured against the LIVE lp_supply). After migration (100 % locked, Fee Key at FEE_KEYS) and
/// register_pool, a third party deposits liquidity worth a bit more than the migrated pool. The coin's own position — the one the
/// program exists to collect from — is now a minority and register_fee_key refuses it (LockNotMajority) for as long as the deposit
/// stays (the depositor earns LP fees meanwhile). This is the dilution class blind review 3 M-2 closed for register_pair_pool by
/// measuring against the creation supply. SAFE behaviour: the coin's migration position registers.
#[test]
#[ignore = "open finding RL-2 (Medium): fails until fixed — run with --ignored"]
fn rl2_a_depositor_must_not_block_register_fee_key() {
    let mut env = lock_env();
    let c = coin(&mut env);
    let supply = lp_supply(&env, &c.pool.pool);
    add_liquidity(&mut env, &c.mint, &c.pool, supply + supply / 20);
    println!("RL-2: lp_supply {} → {} after the deposit; the coin's locked position holds {}", supply, lp_supply(&env, &c.pool.pool), supply - 100);
    let payer = env.payer.insecure_clone();
    let r = env.send(&[ix_register_fee_key(&payer.pubkey(), &c.mint, &c.pool.pool, &c.nfts[0])], &[]);
    if let Err(e) = &r {
        println!("RL-2: register_fee_key refused: {:?}", e.err);
    }
    assert!(r.is_ok(), "the coin's own (migration) lock position must register despite a later deposit");
}

/// RL-3 (the policy-0 platform pins are a point-in-time read). initialize_token checks platformLockNftWallet == FEE_KEYS and scales
/// 1,000,000/0/0, but the LaunchLab platform admin can change both at any time before migration (SDK updatePlatformConfig
/// `updateLockNftWallet` / `migrateCpLockNftScale`), and for a creator who made their own platform that admin is the creator. The
/// migration then mints the Fee Key to the admin's wallet; register_pool still verifies the pool (100 % locked counts as locked) and
/// buybacks run, but register_fee_key can never succeed — the LP fees "that fund the burn" go to the platform admin, silently.
/// SAFE behaviour: a pool whose locked LP is not (majority) held under a Fee Key at FEE_KEYS is not verified for policy 0.
#[test]
#[ignore = "open finding RL-3 (Medium): fails until fixed — run with --ignored"]
fn rl3_a_platform_nft_wallet_changed_after_init_must_not_verify_the_pool() {
    let mut env = lock_env();
    let admin_wallet = Pubkey::new_unique();
    // initialize_token passes the pins (FEE_KEYS, 100/0/0) inside coin_with; the migration below mints the Fee Key to `admin_wallet`
    // — what LaunchLab does after the platform admin's updateLockNftWallet.
    let mut verified = false;
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let c = coin_with(&mut env, &[100], Some(admin_wallet), |_, _, _| {});
        verified = env.config(&config_pda(&c.mint)).pool_verified;
        let payer = env.payer.insecure_clone();
        let fk = env.send(&[ix_register_fee_key(&payer.pubkey(), &c.mint, &c.pool.pool, &c.nfts[0])], &[]);
        println!("RL-3: pool_verified = {verified}; register_fee_key: {}", if fk.is_ok() { "ok".into() } else { format!("{:?}", fk.unwrap_err().err) });
    }));
    // coin_with panics if register_pool refuses — that is the SAFE outcome
    if r.is_err() {
        return;
    }
    assert!(!verified, "the pool was verified although its LP-lock Fee Key went to the platform admin, not FEE_KEYS");
}

/// Control (hypothesis refuted): an EXECUTABLE account at the treasury address (its key holder could deploy a program there) does not
/// wedge claims — the operator share is credited by direct lamport arithmetic in burn_receipts itself (not a System transfer CPI, which
/// is what broke pair_curve's executable developer wallet, blind review PC-1 H-2), and the runtime accepts crediting an executable
/// account. Keep it that way: switching the treasury payment to a System transfer CPI would reopen the PC-1 H-2 class here.
#[test]
fn ctl_an_executable_treasury_is_still_credited() {
    let mut env = lock_env();
    let c = coin(&mut env);
    let payer = env.payer.insecure_clone();
    env.ok(&[ix_register_fee_key(&payer.pubkey(), &c.mint, &c.pool.pool, &c.nfts[0])], &[]);
    trade(&mut env, &c, 6, 5 * SOL);
    // an executable account at the treasury address (any program image will do)
    env.svm.add_program(TREASURY, &read("fixtures/cpmm_lock_mock.so")).unwrap();
    assert!(env.svm.get_account(&TREASURY).unwrap().executable);
    let k = Keypair::new();
    env.fund(&k.pubkey(), SOL);
    let (fee0, t0) = (env.lamports(&fee_pda(&c.mint)), env.lamports(&TREASURY));
    let r = claim(&mut env, &c, &k, u64::MAX);
    match &r {
        Ok(m) => println!("ctl: claim ok; burn pool +{}, executable treasury +{}, event {:?}", env.lamports(&fee_pda(&c.mint)) - fee0, env.lamports(&TREASURY) - t0, event::<LockFeesClaimed>(m).map(|e| (e.to_operator, e.operator_paid, e.operator_pending))),
        Err(e) => println!("ctl: claim reverted: {:?} — {}", e.err, e.meta.logs.iter().rev().find(|l| l.contains("failed")).cloned().unwrap_or_default()),
    }
    assert!(r.is_ok(), "an executable treasury blocks every claim (the 80 % and the burn with it)");
}
