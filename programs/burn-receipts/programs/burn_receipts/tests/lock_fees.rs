//! LAUNCHPAD-PATH §35 (owner decision 2026-10-10): graduation LP is LOCKED forever in Raydium's CPMM lock program ("Burn & Earn"),
//! the Fee Key NFT is held by the FEE_KEYS PDA, and claim_lock_fees splits the LP fees 80 % burn pool / 20 % operator treasury
//! (compiled), burning the coin side. This suite runs the LaunchLab path (policy 0) end to end against the real CPMM fixture and the
//! TEST-ONLY lock-program stand-in (mocks/cpmm_lock_mock: Raydium's lock program source is not public; the stand-in implements its
//! lock_cp_liquidity / collect_cp_fees with the SDK's account orders and the on-chain LockedCpLiquidityState layout).
//!
//! It loads the `localnet` build of burn_receipts (target/deploy-localnet: compiled-in test treasury [0x7e; 32]); the default
//! (mainnet) build carries no treasury and refuses every claim (TreasuryNotPinned) — the last test.

#![allow(clippy::result_large_err, clippy::too_many_arguments)]
mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::{AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas};
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::spl_token;
use burn_receipts::constants::*;
use burn_receipts::events::LockFeesClaimed;
use burn_receipts::state::FeeKeyRecord;
use common::cpmm::{self, Pool};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

const TREASURY: Pubkey = Pubkey::new_from_array([0x7e; 32]);
const TOKEN_2022: Pubkey = anchor_lang::prelude::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const METADATA_PROGRAM_ID: Pubkey = anchor_lang::prelude::pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const LOCK_CP_LIQUIDITY: [u8; 8] = [216, 157, 29, 78, 38, 51, 31, 26];

fn read(rel: &str) -> Vec<u8> {
    let p = format!("{}/../../{rel}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).unwrap_or_else(|e| panic!("cannot read {p}: {e} (run scripts/test.sh first)"))
}

/// The suite's environment: the localnet build of burn_receipts (test treasury compiled in) + the lock-program stand-in.
fn lock_env() -> Env {
    let mut env = Env::new();
    env.svm.add_program(burn_receipts::ID, &read("target/deploy-localnet/burn_receipts.so")).unwrap();
    env.svm.add_program(LOCK_CPMM_PROGRAM_ID, &read("fixtures/cpmm_lock_mock.so")).unwrap();
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

/// Raydium's lock_cp_liquidity (SDK account order) for `lp` of the launcher's LP, Fee Key minted to `nft_owner`.
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
            AccountMeta::new_readonly(anchor_lang::prelude::pubkey!("SysvarRent111111111111111111111111111111111"), false),
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

fn ix_claim(cranker: &Pubkey, mint: &Pubkey, p: &Pool, nft: &Pubkey, treasury: &Pubkey, lp_fee_amount: u64) -> Instruction {
    let fk = fee_keys();
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::ClaimLockFees { lp_fee_amount }.data(),
        burn_receipts::accounts::ClaimLockFees {
            cranker: *cranker,
            platform: Pubkey::find_program_address(&[PLATFORM_SEED], &burn_receipts::ID).0,
            config: config_pda(mint),
            fee_key: fee_key_record(mint),
            fee_keys: fk,
            fee_vault: fee_pda(mint),
            operator_treasury: *treasury,
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

thread_local! {
    static LAUNCHER: std::cell::RefCell<Option<Keypair>> = const { std::cell::RefCell::new(None) };
}

struct Coin {
    mint: Pubkey,
    pool: Pool,
    launcher: Keypair,
    nfts: Vec<Pubkey>,
}

/// A policy-0 LaunchLab coin migrated into its CPMM pool (fee-PDA creator) with its LP locked in Raydium's lock program in `shares`
/// (percent of the launcher's LP per position), each Fee Key minted to `owner` (default FEE_KEYS) — then registered (register_pool).
fn coin(env: &mut Env, shares: &[u64], owner: Option<Pubkey>) -> Coin {
    let (mint_kp, creator, att) = (Keypair::new(), Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint_kp.pubkey(), init_args(buyback_rule(), vec![att.pubkey()], 1))], &[&creator, &mint_kp]);
    let mint = mint_kp.pubkey();
    env.create_mint(&mint_kp, &payer, DECIMALS);
    // one launcher and AmmConfig 0 per environment (create_amm_config refuses a second index-0 config)
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
    env.ok(&[ix_register_pool(&payer, &mint, &pool.pool)], &[]);
    Coin { mint, pool, launcher, nfts }
}

/// Trading on the pool so the locked LP earns fees.
fn trade(env: &mut Env, c: &Coin, rounds: u32) {
    trade_sized(env, c, rounds, 5 * SOL);
}

fn trade_sized(env: &mut Env, c: &Coin, rounds: u32, lamports: u64) {
    let now = env.now();
    env.set_time(now + 60); // past the pool's open_time
    let t = Keypair::new();
    env.fund(&t.pubkey(), 100 * SOL);
    env.create_ata(&t.pubkey(), &c.mint);
    for _ in 0..rounds {
        env.wrap_sol(&t, lamports);
        cpmm::swap(env, &t, &c.pool, &c.mint, true, lamports).unwrap();
        let got = env.token_amount(&get_associated_token_address(&t.pubkey(), &c.mint));
        cpmm::swap(env, &t, &c.pool, &c.mint, false, got).unwrap();
    }
}

fn record(env: &Env, mint: &Pubkey) -> FeeKeyRecord {
    let a = env.svm.get_account(&fee_key_record(mint)).expect("fee key record");
    FeeKeyRecord::try_deserialize(&mut a.data.as_slice()).unwrap()
}

fn event<T: AnchorDeserialize + Discriminator>(meta: &litesvm::types::TransactionMetadata) -> T {
    events(meta).into_iter().find(|(d, _)| d[..] == T::DISCRIMINATOR[..]).map(|(_, p)| T::try_from_slice(&p).unwrap()).expect("event")
}

#[test]
fn the_split_constants_are_80_20_and_compiled() {
    assert_eq!((LOCK_FEE_BURN_BPS, LOCK_FEE_OPERATOR_BPS), (8_000, 2_000));
    assert_eq!(LOCK_FEE_BURN_BPS + LOCK_FEE_OPERATOR_BPS, 10_000);
    assert_eq!(OPERATOR_TREASURY, Pubkey::default(), "the default (mainnet) build carries no treasury until the owner compiles it in");
    assert_eq!(LOCK_CPMM_PROGRAM_ID.to_string(), "LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE");
    assert_eq!(Pubkey::find_program_address(&[b"lock_cp_authority_seed"], &LOCK_CPMM_PROGRAM_ID).0, LOCK_CPMM_AUTHORITY);
}

/// The whole path: migration LP locked 100 % (Fee Key at FEE_KEYS) → register_pool counts it as locked → swaps accrue fees →
/// register_fee_key → claim_lock_fees: the SOL side lands 80 % in the fee PDA and 20 % at the treasury, the coin side is burned, the
/// memo and the event say so, the record keeps the totals; an immediate replay is a no-op.
#[test]
fn a_claim_splits_the_sol_side_80_20_and_burns_the_coin_side() {
    let mut env = lock_env();
    let c = coin(&mut env, &[100], None);
    let cfg = env.config(&config_pda(&c.mint));
    assert!(cfg.pool_verified && cfg.cpmm_pool == c.pool.pool, "a 100 %-locked pool registers (policy 0)");
    trade(&mut env, &c, 6);
    let payer = env.payer.insecure_clone();
    env.ok(&[ix_register_fee_key(&payer.pubkey(), &c.mint, &c.pool.pool, &c.nfts[0])], &[]);
    let r = record(&env, &c.mint);
    assert_eq!((r.mint, r.pool, r.fee_nft_mint, r.locked_liquidity), (c.mint, c.pool.pool, c.nfts[0], locked_liquidity(&c.nfts[0])));
    assert_eq!(r.fee_nft_account, get_associated_token_address(&fee_keys(), &c.nfts[0]));
    assert!(env.send(&[ix_register_fee_key(&payer.pubkey(), &c.mint, &c.pool.pool, &c.nfts[0])], &[]).is_err(), "once per mint");

    let cranker = Keypair::new();
    env.fund(&cranker.pubkey(), SOL);
    let (fee0, tre0, cr0) = (env.lamports(&fee_pda(&c.mint)), env.lamports(&TREASURY), env.lamports(&cranker.pubkey()));
    let supply0 = env.mint_supply(&c.mint);
    let meta = env.ok(&[ix_claim(&cranker.pubkey(), &c.mint, &c.pool, &c.nfts[0], &TREASURY, u64::MAX)], &[&cranker]);
    let ev: LockFeesClaimed = event(&meta);
    println!("claim_lock_fees: {} CU; wsol {} → burn pool {} / operator {}; tokens burned {}", meta.compute_units_consumed, ev.wsol_claimed, ev.to_burn_pool, ev.to_operator, ev.tokens_burned);
    assert!(ev.wsol_claimed > 0 && ev.tokens_burned > 0, "fees accrued on both sides");
    assert_eq!(ev.to_operator, ev.wsol_claimed * 2_000 / 10_000);
    assert_eq!(ev.to_burn_pool, ev.wsol_claimed - ev.to_operator);
    assert_eq!(env.lamports(&fee_pda(&c.mint)) - fee0, ev.to_burn_pool);
    assert_eq!(env.lamports(&TREASURY) - tre0, ev.to_operator);
    assert_eq!(supply0 - env.mint_supply(&c.mint), ev.tokens_burned, "the coin side is burned");
    // the cranker paid the two ATA rents and got both back (the harness's payer pays the transaction fee)
    assert_eq!(env.lamports(&cranker.pubkey()), cr0);
    assert!(meta.logs.iter().any(|l| l.contains("|lockfees|wsol=")), "the receipt memo");
    let fk = fee_keys();
    assert!(env.svm.get_account(&fk).map(|a| a.lamports == 0).unwrap_or(true), "FEE_KEYS keeps nothing");
    assert!(env.svm.get_account(&get_associated_token_address(&fk, &NATIVE_MINT)).map(|a| a.lamports == 0).unwrap_or(true));
    assert!(env.svm.get_account(&get_associated_token_address(&fk, &c.mint)).map(|a| a.lamports == 0).unwrap_or(true));
    assert_eq!(env.token_amount(&get_associated_token_address(&fk, &c.nfts[0])), 1, "the Fee Key stays with FEE_KEYS");
    let r = record(&env, &c.mint);
    assert_eq!((r.claims, r.total_wsol_claimed, r.total_to_burn_pool, r.total_to_operator, r.total_tokens_burned), (1, ev.wsol_claimed, ev.to_burn_pool, ev.to_operator, ev.tokens_burned));

    // replay at once: nothing accrued — no transfer, no memo, counters unchanged
    let (fee1, tre1) = (env.lamports(&fee_pda(&c.mint)), env.lamports(&TREASURY));
    let m2 = env.ok(&[ix_claim(&cranker.pubkey(), &c.mint, &c.pool, &c.nfts[0], &TREASURY, u64::MAX)], &[&cranker]);
    assert_eq!((env.lamports(&fee_pda(&c.mint)), env.lamports(&TREASURY)), (fee1, tre1));
    assert!(!m2.logs.iter().any(|l| l.contains("|lockfees|")));
    assert_eq!(record(&env, &c.mint).claims, 1);
    // more trading → a second claim adds to the totals
    trade(&mut env, &c, 2);
    let m3 = env.ok(&[ix_claim(&cranker.pubkey(), &c.mint, &c.pool, &c.nfts[0], &TREASURY, u64::MAX)], &[&cranker]);
    let ev3: LockFeesClaimed = event(&m3);
    assert_eq!(record(&env, &c.mint).total_wsol_claimed, ev.wsol_claimed + ev3.wsol_claimed);
}

/// The 20 % can go only to the compiled treasury; the accounts must be the coin's own (mint, pool, Fee Key, lock position).
#[test]
fn a_claim_refuses_another_treasury_mint_pool_or_fee_key() {
    let mut env = lock_env();
    let c = coin(&mut env, &[100], None);
    let d = coin(&mut env, &[100], None);
    trade(&mut env, &c, 3);
    let payer = env.payer.insecure_clone();
    env.ok(&[ix_register_fee_key(&payer.pubkey(), &c.mint, &c.pool.pool, &c.nfts[0])], &[]);
    env.ok(&[ix_register_fee_key(&payer.pubkey(), &d.mint, &d.pool.pool, &d.nfts[0])], &[]);
    let k = Keypair::new();
    env.fund(&k.pubkey(), SOL);
    expect_anchor_err(env.send(&[ix_claim(&k.pubkey(), &c.mint, &c.pool, &c.nfts[0], &k.pubkey(), u64::MAX)], &[&k]), "TreasuryNotPinned");
    // another coin's pool / Fee Key with this coin's mint
    expect_anchor_err(env.send(&[ix_claim(&k.pubkey(), &c.mint, &d.pool, &c.nfts[0], &TREASURY, u64::MAX)], &[&k]), "PoolNotRegistered");
    expect_anchor_err(env.send(&[ix_claim(&k.pubkey(), &c.mint, &c.pool, &d.nfts[0], &TREASURY, u64::MAX)], &[&k]), "FeeKeyMismatch");
    // a coin without a registered Fee Key
    let e = coin(&mut env, &[100], None);
    expect_anchor_err(env.send(&[ix_claim(&k.pubkey(), &e.mint, &e.pool, &e.nfts[0], &TREASURY, u64::MAX)], &[&k]), "AccountNotInitialized");
    // the right accounts work
    env.ok(&[ix_claim(&k.pubkey(), &c.mint, &c.pool, &c.nfts[0], &TREASURY, u64::MAX)], &[&k]);
}

/// register_fee_key takes only the coin's majority position whose Fee Key FEE_KEYS holds: a minority (dust) position with its Fee
/// Key sent to FEE_KEYS is refused, a position whose Fee Key is elsewhere is refused, another pool's position is refused.
#[test]
fn register_fee_key_takes_only_the_majority_position_held_by_fee_keys() {
    let mut env = lock_env();
    let payer = env.payer.insecure_clone();
    let c = coin(&mut env, &[30, 70], None);
    expect_anchor_err(env.send(&[ix_register_fee_key(&payer.pubkey(), &c.mint, &c.pool.pool, &c.nfts[0])], &[]), "LockNotMajority");
    let d = coin(&mut env, &[100], None);
    expect_anchor_err(env.send(&[ix_register_fee_key(&payer.pubkey(), &c.mint, &c.pool.pool, &d.nfts[0])], &[]), "InvalidLockAccount");
    env.ok(&[ix_register_fee_key(&payer.pubkey(), &c.mint, &c.pool.pool, &c.nfts[1])], &[]);
    // a position whose Fee Key went to someone else (the creator's share on a non-Burnticker platform)
    let elsewhere = Pubkey::new_unique();
    let e = coin(&mut env, &[100], Some(elsewhere));
    expect_anchor_err(env.send(&[ix_register_fee_key(&payer.pubkey(), &e.mint, &e.pool.pool, &e.nfts[0])], &[]), "FeeKeyNotHeld");
    // claiming the registered majority position still works with the minority one locked beside it
    trade(&mut env, &c, 2);
    let k = Keypair::new();
    env.fund(&k.pubkey(), SOL);
    env.ok(&[ix_claim(&k.pubkey(), &c.mint, &c.pool, &c.nfts[1], &TREASURY, u64::MAX)], &[&k]);
    let _ = c.launcher;
}

/// LaunchLab platform pins (policy 0): the platform must lock 100 % of the migrated LP with the Fee Key to FEE_KEYS.
#[test]
fn initialize_token_requires_the_platform_to_lock_everything_to_fee_keys() {
    let mut env = lock_env();
    let payer = env.payer.pubkey();
    let try_init = |env: &mut Env| {
        let (mint, creator, a) = (Keypair::new(), Keypair::new(), Keypair::new());
        env.send(&[ix_initialize(&payer, &creator.pubkey(), &mint.pubkey(), init_args(buyback_rule(), vec![a.pubkey()], 1))], &[&creator, &mint])
    };
    let amm0 = cpmm::amm_config_0();
    for scales in [[500_000, 400_000, 100_000], [999_999, 1, 0], [999_999, 0, 1], [0, 0, 1_000_000]] {
        cpmm::set_platform(&mut env, &amm0, &Pubkey::default(), scales);
        expect_anchor_err(try_init(&mut env), "PlatformNotAllowed");
    }
    let mut acc = cpmm::platform_account(&env, &amm0, &Pubkey::default(), [1_000_000, 0, 0]);
    acc.data[LL_PLATFORM_LOCK_NFT_WALLET..LL_PLATFORM_LOCK_NFT_WALLET + 32].copy_from_slice(Pubkey::new_unique().as_ref());
    env.svm.set_account(TEST_LAUNCHLAB_PLATFORM, acc).unwrap();
    expect_anchor_err(try_init(&mut env), "PlatformNotAllowed");
    cpmm::set_platform(&mut env, &amm0, &Pubkey::default(), [1_000_000, 0, 0]);
    try_init(&mut env).unwrap();
}

/// The default (mainnet) build has no treasury compiled in: claim_lock_fees refuses and the fees stay in the lock.
#[test]
fn the_mainnet_build_refuses_claims_until_the_treasury_is_compiled_in() {
    let mut env = Env::new();
    env.svm.add_program(LOCK_CPMM_PROGRAM_ID, &read("fixtures/cpmm_lock_mock.so")).unwrap();
    let c = coin(&mut env, &[100], None);
    trade(&mut env, &c, 2);
    let payer = env.payer.insecure_clone();
    env.ok(&[ix_register_fee_key(&payer.pubkey(), &c.mint, &c.pool.pool, &c.nfts[0])], &[]);
    let k = Keypair::new();
    env.fund(&k.pubkey(), SOL);
    // whatever treasury is passed, it is not the (all-zero placeholder) compiled one
    expect_anchor_err(env.send(&[ix_claim(&k.pubkey(), &c.mint, &c.pool, &c.nfts[0], &TREASURY, u64::MAX)], &[&k]), "TreasuryNotPinned");
}

/// An unfunded treasury (below its rent-exempt minimum — a fresh Squads vault) cannot be credited a small amount: the claim still
/// pays the burn pool its 80 % and burns the coin side, parks the operator's 20 % in the FeeKeyRecord account (operator_pending), and
/// the first claim after the treasury can receive delivers everything pending (found on devnet 2026-10-10: the devnet vault held 0).
#[test]
fn an_unfunded_treasury_parks_the_operator_share_until_it_can_receive() {
    let mut env = lock_env();
    env.svm.set_account(TREASURY, solana_account::Account::default()).unwrap();
    let c = coin(&mut env, &[100], None);
    trade_sized(&mut env, &c, 1, SOL / 5);
    let payer = env.payer.insecure_clone();
    env.ok(&[ix_register_fee_key(&payer.pubkey(), &c.mint, &c.pool.pool, &c.nfts[0])], &[]);
    let k = Keypair::new();
    env.fund(&k.pubkey(), SOL);
    let (fee0, rec0) = (env.lamports(&fee_pda(&c.mint)), env.lamports(&fee_key_record(&c.mint)));
    let m = env.ok(&[ix_claim(&k.pubkey(), &c.mint, &c.pool, &c.nfts[0], &TREASURY, u64::MAX)], &[&k]);
    let ev: LockFeesClaimed = event(&m);
    assert!(ev.to_operator > 0 && ev.to_operator < env.svm.minimum_balance_for_rent_exemption(0), "a share smaller than the rent minimum");
    assert_eq!((ev.operator_paid, ev.operator_pending), (0, ev.to_operator));
    assert_eq!(env.lamports(&fee_pda(&c.mint)) - fee0, ev.to_burn_pool, "the burn pool's 80 % is not held up");
    assert_eq!(env.lamports(&TREASURY), 0);
    assert_eq!(env.lamports(&fee_key_record(&c.mint)) - rec0, ev.to_operator);
    assert_eq!(record(&env, &c.mint).operator_pending, ev.to_operator);
    // the treasury is funded; the next claim pays this claim's share and the pending one
    env.fund(&TREASURY, SOL);
    trade(&mut env, &c, 2);
    let m2 = env.ok(&[ix_claim(&k.pubkey(), &c.mint, &c.pool, &c.nfts[0], &TREASURY, u64::MAX)], &[&k]);
    let ev2: LockFeesClaimed = event(&m2);
    assert_eq!((ev2.operator_paid, ev2.operator_pending), (ev.to_operator + ev2.to_operator, 0));
    assert_eq!(env.lamports(&TREASURY), SOL + ev.to_operator + ev2.to_operator);
    assert_eq!(env.lamports(&fee_key_record(&c.mint)), rec0, "the record is back to its rent");
    assert_eq!(record(&env, &c.mint).operator_pending, 0);
}
