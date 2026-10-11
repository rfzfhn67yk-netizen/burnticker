//! Blind review 2026-10-11 of the LP-lock release (LAUNCHPAD-PATH §35) — pair_curve `lock_lp` exploit tests
//! (docs/burnticker/reviews/2026-10-11-lp-lock-blind.md). The harness is a verbatim copy of tests/lifecycle.rs's (lines 13–410), with
//! new_env() able to load another lock-program binary (REVIEW_LOCK_SO=<path>, e.g. the real mainnet program dumped read-only with
//! `solana program dump -u https://api.mainnet-beta.solana.com LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE lock_mainnet.so`).
//!
//! Every `rl*` test asserts the SAFE behaviour; it failed against the reviewed code and passes since the r2 fixes (branch
//! burnticker/lp-lock-r2) — kept as regressions, no longer ignored. `mf*` tests are MOCK-FIDELITY checks (they failed against the old
//! stand-in and pass against the fixed stand-in and the real program); `ctl_*` tests are controls; `l2_*` covers the burn_lp fallback.
//! scripts/test.sh runs it with the stand-in, and again against the real binary when REVIEW_LOCK_SO is set (never commit the binary).
//!
//! Run: scripts/test.sh builds the fixtures; then cargo test -p pair_curve --test review_lock -- --test-threads=1 --nocapture

#![allow(clippy::result_large_err, clippy::too_many_arguments, clippy::type_complexity, dead_code, unused_imports)]

#[path = "../../burn_receipts/tests/common/mod.rs"]
mod common;
mod lock_common;
use lock_common::*;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::{AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas};
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::spl_token;
use burn_receipts::constants::*;
use common::cpmm::{self as bcpmm, Pool};
use common::*;
use pair_curve::math::{fee_split, price_matched_tokens, quote_buy, quote_sell, side_costs, sol_at};
use pair_curve::state::Pair;
use pair_curve::InitPairArgs;
use solana_keypair::Keypair;
use solana_signer::Signer;

const MAINNET_POOL_FEE: u64 = 150_000_000; // AmmConfig.create_pool_fee on mainnet and devnet (0.15 SOL)
const D1: u32 = 20261005;
const D2: u32 = 20261006;
const V1: u64 = 4_027_300_000_000_000;

// --------------------------------------------------------------------------------------------------------------------------------
// harness
// --------------------------------------------------------------------------------------------------------------------------------

fn read_so(rel: &str) -> Vec<u8> {
    let p = format!("{}/../../{}", env!("CARGO_MANIFEST_DIR"), rel);
    std::fs::read(&p).unwrap_or_else(|e| panic!("cannot read {p}: {e} (run `anchor build` / scripts/test.sh first)"))
}

fn new_env() -> Env {
    let mut env = Env::new();
    env.svm.add_program(pair_curve::ID, &read_so("target/deploy-localnet/pair_curve.so")).unwrap();
    // REVIEW_LOCK_SO=<path>: another lock-program binary at Raydium's id (e.g. the real mainnet program, dumped read-only); default the
    // stand-in. Metaplex's id gets an inert executable (the real program declares it; with_metadata = false never invokes it).
    add_lock_program(&mut env); // honours REVIEW_LOCK_SO
    env
}

fn pc_event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &pair_curve::ID).0
}
fn pair_pda(a: &Pubkey, b: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"pair", a.as_ref(), b.as_ref()], &pair_curve::ID).0
}
fn vault_pda(pair: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"vault", pair.as_ref()], &pair_curve::ID).0
}
fn pool_pda(pair: &Pubkey, side: u8) -> Pubkey {
    Pubkey::find_program_address(&[b"pool", pair.as_ref(), &[side]], &pair_curve::ID).0
}

/// An AmmConfig at `index` with `create_pool_fee`, plus CPMM's create-pool-fee receiver account (Raydium's hard-coded WSOL account).
fn amm_config(env: &mut Env, index: u16, create_pool_fee: u64) -> Pubkey {
    let admin = bcpmm::admin();
    env.fund(&admin.pubkey(), 10 * SOL);
    let cfg = bcpmm::pda(&[b"amm_config", &index.to_be_bytes()]);
    let mut data = vec![137, 52, 237, 212, 215, 117, 108, 104];
    data.extend_from_slice(&index.to_le_bytes());
    for v in [bcpmm::TRADE_FEE_RATE, 120_000u64, 40_000u64, create_pool_fee, bcpmm::CREATOR_FEE_RATE] {
        data.extend_from_slice(&v.to_le_bytes());
    }
    let ix = Instruction {
        program_id: CPMM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(admin.pubkey(), true),
            AccountMeta::new(cfg, false),
            AccountMeta::new_readonly(anchor_lang::solana_program::system_program::ID, false),
        ],
        data,
    };
    env.ok(&[ix], &[&admin]);
    fee_receiver(env);
    cfg
}

fn fee_receiver(env: &mut Env) {
    use anchor_lang::solana_program::program_pack::Pack;
    let mut acc = vec![0u8; spl_token::state::Account::LEN];
    spl_token::state::Account {
        mint: NATIVE_MINT,
        owner: Pubkey::new_unique(),
        amount: 0,
        delegate: None.into(),
        state: spl_token::state::AccountState::Initialized,
        is_native: Some(2_039_280).into(),
        delegated_amount: 0,
        close_authority: None.into(),
    }
    .pack_into_slice(&mut acc);
    env.svm.set_account(CREATE_POOL_FEE_RECEIVER, litesvm_account(2_039_280, acc, spl_token::ID)).unwrap();
}

/// The test LaunchLab platform with `cp_config` and the developer wallet (platformClaimFeeWallet @16).
fn platform_with_dev(env: &mut Env, cp_config: &Pubkey, dev: &Pubkey) {
    let mut acc = bcpmm::platform_account(env, cp_config, &Pubkey::default(), [1_000_000, 0, 0]);
    acc.data[16..48].copy_from_slice(dev.as_ref());
    env.svm.set_account(TEST_LAUNCHLAB_PLATFORM, acc).unwrap();
}

fn pair_rule() -> burn_receipts::state::RuleParams {
    let mut r = buyback_rule();
    r.pool_policy = POOL_POLICY_PAIR_CURVE;
    r
}

struct P {
    ma: Keypair,
    mb: Keypair,
    creator: Keypair,
    attester: Keypair,
    pair: Pubkey,
    vault: Pubkey,
    dev: Pubkey,
    amm: Pubkey,
}

impl P {
    fn mint(&self, side: u8) -> Pubkey {
        if side == 0 { self.ma.pubkey() } else { self.mb.pubkey() }
    }
}

fn default_args(now: i64) -> InitPairArgs {
    InitPairArgs {
        pair_id: [7u8; 32],
        virtual_sol_lamports: pair_curve::DEFAULT_VIRTUAL_SOL_LAMPORTS,
        virtual_token_amount: pair_curve::DEFAULT_VIRTUAL_TOKEN_AMOUNT,
        curve_supply: pair_curve::DEFAULT_CURVE_SUPPLY,
        target_raise_lamports: pair_curve::DEFAULT_TARGET_RAISE_LAMPORTS,
        min_side_share_bps: 2_500,
        deadline: now + 86_400,
    }
}

/// Everything before init_pair: AmmConfig + platform (dev wallet funded), the two mints (mint authority = the pair's vault PDA) and
/// both burn_receipts TokenConfigs under policy 2.
fn prepare(env: &mut Env, pool_fee: u64) -> P {
    let (ma, mb, creator, attester) = (Keypair::new(), Keypair::new(), Keypair::new(), Keypair::new());
    env.fund(&creator.pubkey(), 10 * SOL);
    let amm = amm_config(env, 0, pool_fee);
    let dev = Pubkey::new_unique();
    env.fund(&dev, SOL);
    platform_with_dev(env, &amm, &dev);
    let pair = pair_pda(&ma.pubkey(), &mb.pubkey());
    let vault = vault_pda(&pair);
    for m in [&ma, &mb] {
        env.create_mint_full(m, &vault, None, 6);
        let mut args = init_args(pair_rule(), vec![attester.pubkey()], 1);
        args.admin = creator.pubkey();
        let payer = env.payer.pubkey();
        env.ok(&[ix_initialize_with_platform(&payer, &creator.pubkey(), &m.pubkey(), args, Some(TEST_LAUNCHLAB_PLATFORM))], &[&creator, m]);
    }
    P { ma, mb, creator, attester, pair, vault, dev, amm }
}

fn ix_init_pair(env: &Env, p: &P, args: InitPairArgs) -> Instruction {
    let (a, b) = (p.ma.pubkey(), p.mb.pubkey());
    Instruction::new_with_bytes(
        pair_curve::ID,
        &pair_curve::instruction::InitPair { args }.data(),
        pair_curve::accounts::InitPair {
            payer: env.payer.pubkey(),
            creator: p.creator.pubkey(),
            mint_a: a,
            mint_b: b,
            pair: p.pair,
            vault: p.vault,
            token_vault_a: get_associated_token_address(&p.vault, &a),
            token_vault_b: get_associated_token_address(&p.vault, &b),
            config_a: config_pda(&a),
            config_b: config_pda(&b),
            launchlab_platform: TEST_LAUNCHLAB_PLATFORM,
            amm_config: p.amm,
            token_program: spl_token::ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            event_authority: pc_event_authority(),
            program: pair_curve::ID,
        }
        .to_account_metas(None),
    )
}

fn setup(env: &mut Env, pool_fee: u64, f: impl FnOnce(&mut InitPairArgs)) -> P {
    let p = prepare(env, pool_fee);
    let mut args = default_args(env.now());
    f(&mut args);
    let ix = ix_init_pair(env, &p, args);
    let meta = env.ok(&[ix], &[&p.creator]);
    println!("init_pair CU: {}", meta.compute_units_consumed);
    p
}

fn ix_buy(p: &P, buyer: &Pubkey, side: u8, max_in: u64, min_out: u64) -> Instruction {
    let mint = p.mint(side);
    Instruction::new_with_bytes(
        pair_curve::ID,
        &pair_curve::instruction::Buy { side, max_lamports_in: max_in, min_tokens_out: min_out }.data(),
        pair_curve::accounts::Buy {
            buyer: *buyer,
            pair: p.pair,
            vault: p.vault,
            mint,
            token_vault: get_associated_token_address(&p.vault, &mint),
            buyer_token: get_associated_token_address(buyer, &mint),
            amm_config: p.amm,
            token_program: spl_token::ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            event_authority: pc_event_authority(),
            program: pair_curve::ID,
        }
        .to_account_metas(None),
    )
}

fn ix_sell(p: &P, seller: &Pubkey, side: u8, amount: u64, min_out: u64) -> Instruction {
    let mint = p.mint(side);
    Instruction::new_with_bytes(
        pair_curve::ID,
        &pair_curve::instruction::Sell { side, amount, min_lamports_out: min_out }.data(),
        pair_curve::accounts::Sell {
            seller: *seller,
            pair: p.pair,
            vault: p.vault,
            mint,
            token_vault: get_associated_token_address(&p.vault, &mint),
            seller_token: get_associated_token_address(seller, &mint),
            amm_config: p.amm,
            token_program: spl_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            event_authority: pc_event_authority(),
            program: pair_curve::ID,
        }
        .to_account_metas(None),
    )
}

/// The graduated pool of `side` as the burn_receipts harness's Pool (for swaps and crank_buyback).
fn pool_of(p: &P, side: u8) -> Pool {
    let mint = p.mint(side);
    let pool = pool_pda(&p.pair, side);
    let (t0, t1) = if NATIVE_MINT < mint { (NATIVE_MINT, mint) } else { (mint, NATIVE_MINT) };
    Pool {
        amm_config: p.amm,
        pool,
        authority: bcpmm::pda(&[bcpmm::AUTH_SEED]),
        token_0_mint: t0,
        token_1_mint: t1,
        token_0_vault: bcpmm::pda(&[b"pool_vault", pool.as_ref(), t0.as_ref()]),
        token_1_vault: bcpmm::pda(&[b"pool_vault", pool.as_ref(), t1.as_ref()]),
        observation: bcpmm::pda(&[b"observation", pool.as_ref()]),
        lp_mint: bcpmm::lp_mint_of(&pool),
        wsol_is_0: NATIVE_MINT < mint,
    }
}

fn ix_graduate(p: &P, cranker: &Pubkey, side: u8) -> Instruction {
    let pool = pool_of(p, side);
    let mint = p.mint(side);
    Instruction::new_with_bytes(
        pair_curve::ID,
        &pair_curve::instruction::Graduate { side }.data(),
        pair_curve::accounts::Graduate {
            cranker: *cranker,
            pair: p.pair,
            vault: p.vault,
            vault_wsol: get_associated_token_address(&p.vault, &NATIVE_MINT),
            wsol_mint: NATIVE_MINT,
            amm_config: p.amm,
            cpmm_authority: pool.authority,
            create_pool_fee: CREATE_POOL_FEE_RECEIVER,
            mint,
            token_vault: get_associated_token_address(&p.vault, &mint),
            pool: pool.pool,
            lp_mint: pool.lp_mint,
            vault_lp: get_associated_token_address(&p.vault, &pool.lp_mint),
            pool_vault_0: pool.token_0_vault,
            pool_vault_1: pool.token_1_vault,
            observation: pool.observation,
            fee_vault: fee_pda(&mint),
            cpmm_program: CPMM_PROGRAM_ID,
            token_program: spl_token::ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            rent: SYSVAR_RENT_ID,
            event_authority: pc_event_authority(),
            program: pair_curve::ID,
        }
        .to_account_metas(None),
    )
}

/// One side's graduate (+ `extra` instructions, e.g. that side's register_pair_pool) in a LEGACY transaction (size-asserted).
fn graduate_side(env: &mut Env, p: &P, cranker: &Keypair, side: u8, extra: &[Instruction]) -> TxResult {
    // LAUNCHPAD-PATH §35: graduate keeps the LP; lock_lp (its own transaction) locks it forever; registration (`extra`) follows.
    let r = env.send(&[ix_graduate(p, &cranker.pubkey(), side)], &[cranker]);
    if r.is_ok() {
        let pool = pool_of(p, side);
        if let Err(e) = env.send(&[ix_lock_lp(&p.pair, &p.vault, &p.mint(side), &pool, &cranker.pubkey(), side)], &[cranker]) {
            panic!("lock_lp({side}) failed: {:?}\n{}", e.err, e.meta.logs.join("\n"));
        }
        if !extra.is_empty() {
            env.send(extra, &[cranker])?;
        }
    }
    r
}

fn graduate_both(env: &mut Env, p: &P, cranker: &Keypair) -> [litesvm::types::TransactionMetadata; 2] {
    let mut out = vec![];
    for side in 0..2u8 {
        match graduate_side(env, p, cranker, side, &[]) {
            Ok(m) => out.push(m),
            Err(e) => panic!("graduate({side}) failed: {:?}\n{}", e.err, e.meta.logs.join("\n")),
        }
    }
    [out.remove(0), out.remove(0)]
}

fn ix_void(p: &P, caller: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        pair_curve::ID,
        &pair_curve::instruction::VoidPair {}.data(),
        pair_curve::accounts::VoidPair { caller: *caller, pair: p.pair, amm_config: p.amm, event_authority: pc_event_authority(), program: pair_curve::ID }.to_account_metas(None),
    )
}

fn ix_close(p: &P, caller: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        pair_curve::ID,
        &pair_curve::instruction::ClosePair {}.data(),
        pair_curve::accounts::ClosePair {
            caller: *caller,
            pair: p.pair,
            creator: p.creator.pubkey(),
            vault: p.vault,
            mint_a: p.mint(0),
            mint_b: p.mint(1),
            token_vault_a: get_associated_token_address(&p.vault, &p.mint(0)),
            token_vault_b: get_associated_token_address(&p.vault, &p.mint(1)),
            fee_vault_a: fee_pda(&p.mint(0)),
            fee_vault_b: fee_pda(&p.mint(1)),
            dev_wallet: p.dev,
            token_program: spl_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            event_authority: pc_event_authority(),
            program: pair_curve::ID,
        }
        .to_account_metas(None),
    )
}

fn ix_claim_dev(p: &P, caller: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        pair_curve::ID,
        &pair_curve::instruction::ClaimDeveloperFee {}.data(),
        pair_curve::accounts::ClaimDeveloperFee {
            caller: *caller,
            pair: p.pair,
            vault: p.vault,
            dev_wallet: p.dev,
            system_program: anchor_lang::solana_program::system_program::ID,
            event_authority: pc_event_authority(),
            program: pair_curve::ID,
        }
        .to_account_metas(None),
    )
}


fn pair_state(env: &Env, p: &P) -> Pair {
    let a = env.svm.get_account(&p.pair).expect("pair");
    Pair::try_deserialize(&mut a.data.as_slice()).unwrap()
}

fn trader(env: &mut Env, sol: u64) -> Keypair {
    let k = Keypair::new();
    env.fund(&k.pubkey(), sol);
    k
}

fn pc_event<E: Discriminator + AnchorDeserialize>(meta: &litesvm::types::TransactionMetadata) -> E {
    let (_, data) = events(meta).into_iter().find(|(d, _)| d[..] == E::DISCRIMINATOR[..]).expect("event");
    E::try_from_slice(&data).unwrap()
}

fn vault_rent(env: &Env) -> u64 {
    env.svm.minimum_balance_for_rent_exemption(0)
}

/// Buys until the pair is ready: `sol_a` and `sol_b` lamports of net budget on each side (one buyer per side), returning the buyers.
fn fill(env: &mut Env, p: &P, budget_a: u64, budget_b: u64) -> (Keypair, Keypair) {
    let (ba, bb) = (trader(env, budget_a + 10 * SOL), trader(env, budget_b + 10 * SOL));
    env.ok(&[ix_buy(p, &ba.pubkey(), 0, budget_a, 1)], &[&ba]);
    env.ok(&[ix_buy(p, &bb.pubkey(), 1, budget_b, 1)], &[&bb]);
    (ba, bb)
}

// --------------------------------------------------------------------------------------------------------------------------------
// tests

const TREASURY: Pubkey = Pubkey::new_from_array([0x7e; 32]);
const CPMM_DEPOSIT: [u8; 8] = [242, 35, 198, 137, 82, 225, 242, 182];

fn lock_env() -> Env {
    let mut env = new_env();
    use_localnet_burn_receipts(&mut env);
    env.fund(&TREASURY, SOL);
    env
}

fn graduate_only(env: &mut Env, p: &P, cranker: &Keypair, side: u8) -> TxResult {
    env.send(&[ix_graduate(p, &cranker.pubkey(), side)], &[cranker])
}

fn lock_side(env: &mut Env, p: &P, cranker: &Keypair, side: u8) -> TxResult {
    env.send(&[ix_lock_lp(&p.pair, &p.vault, &p.mint(side), &pool_of(p, side), &cranker.pubkey(), side)], &[cranker])
}

fn lp_supply(env: &Env, pool: &Pubkey) -> u64 {
    let d = env.svm.get_account(pool).unwrap().data;
    u64::from_le_bytes(d[333..341].try_into().unwrap())
}

/// CPMM `deposit` (SDK makeDepositCpmmInInstruction account order).
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

fn round_trips(env: &mut Env, p: &P, side: u8, rounds: u32, lamports: u64) {
    let pool = pool_of(p, side);
    let mint = p.mint(side);
    let now = env.now();
    env.set_time(now + 60);
    let t = trader(env, 10 * SOL + rounds as u64 * lamports);
    env.create_ata(&t.pubkey(), &mint);
    for _ in 0..rounds {
        env.wrap_sol(&t, lamports);
        bcpmm::swap(env, &t, &pool, &mint, true, lamports).unwrap();
        let got = env.token_amount(&get_associated_token_address(&t.pubkey(), &mint));
        bcpmm::swap(env, &t, &pool, &mint, false, got).unwrap();
    }
}

fn describe(r: &TxResult) -> String {
    match r {
        Ok(_) => "ok".into(),
        Err(e) => format!("{:?} — {}", e.err, e.meta.logs.iter().rev().find(|l| l.contains("failed") || l.contains("Error")).cloned().unwrap_or_default()),
    }
}

/// Control: graduate(A) → lock_lp(A) → register_pair_pool(A) → register_fee_key(A) → swaps → claim_lock_fees delivers WSOL.
#[test]
fn ctl_graduate_lock_register_and_claim() {
    let mut env = lock_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    graduate_only(&mut env, &p, &c, 0).unwrap();
    let r = lock_side(&mut env, &p, &c, 0);
    assert!(r.is_ok(), "lock_lp: {}", describe(&r));
    let pool = pool_of(&p, 0);
    let mint = p.mint(0);
    env.ok(&[ix_register_pair(&c.pubkey(), &mint, &pool.pool, &pool.lp_mint, &p.pair)], &[&c]);
    let nft = fee_nft_mint(&p.pair, 0);
    env.ok(&[ix_register_fee_key(&c.pubkey(), &mint, &pool.pool, &nft)], &[&c]);
    round_trips(&mut env, &p, 0, 4, SOL);
    let m = env.ok(&[ix_claim_lock_fees(&c.pubkey(), &mint, &pool, &nft, &TREASURY)], &[&c]);
    let ev: burn_receipts::events::LockFeesClaimed = pc_event(&m);
    println!("ctl: lock_lp + claim on a pair pool: wsol {} → burn pool {} / operator {}; tokens burned {}", ev.wsol_claimed, ev.to_burn_pool, ev.to_operator, ev.tokens_burned);
    assert!(ev.wsol_claimed > 0 && ev.tokens_burned > 0);
}

/// MF-2 — MOCK FIDELITY (Info; fails against the stand-in, PASSES against the real mainnet lock program, whose Anchor `init`
/// accepts pre-funded addresses). lock_lp's addresses are deterministic and created by the lock program inside the CPI). Between graduate and lock_lp anyone
/// can send lamports to the addresses the lock program will create: the Fee Key NFT mint (pair_curve PDA ["fee_nft", pair, [side]]),
/// the lock state PDA ["locked_liquidity", nft_mint] and FEE_KEYS's NFT account (ATA). If the lock program creates any of them with a
/// bare System create_account, lock_lp fails for good — no other NFT mint can be used, register_pair_pool requires the lock, the LP
/// stays in the vault and the side's burn pool is never registered. SAFE behaviour: lock_lp succeeds with each address pre-funded.
#[test]
fn mf2_prefunded_lock_addresses_must_not_block_lock_lp() {
    let targets: [(&str, fn(&P) -> Pubkey); 3] = [
        ("fee_nft_mint (pair_curve PDA)", |p| fee_nft_mint(&p.pair, 0)),
        ("locked_liquidity (lock PDA)", |p| locked_liquidity(&fee_nft_mint(&p.pair, 0))),
        ("fee_nft_account (ATA of FEE_KEYS)", |p| get_associated_token_address(&fee_keys(), &fee_nft_mint(&p.pair, 0))),
    ];
    let mut blocked = vec![];
    for (name, addr) in targets {
        let mut env = lock_env();
        let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
        let c = trader(&mut env, SOL);
        fill(&mut env, &p, 50 * SOL, 40 * SOL);
        graduate_only(&mut env, &p, &c, 0).unwrap();
        let rent0 = env.svm.minimum_balance_for_rent_exemption(0);
        env.transfer_sol(&addr(&p), rent0);
        let r = lock_side(&mut env, &p, &c, 0);
        println!("MF-2: {name} pre-funded with {rent0} lamports → lock_lp {}", describe(&r));
        if r.is_err() {
            blocked.push(name);
        }
    }
    assert!(blocked.is_empty(), "a rent-minimum lamport transfer blocks lock_lp forever via: {blocked:?}");
}

/// RL-2 on a pair pool: register_pair_pool measures against the CREATION supply (dilution-proof), register_fee_key against the LIVE
/// supply. A depositor adding ~1.05× the pool's liquidity after lock_lp keeps the side's own lock position from ever registering
/// while the deposit stays. SAFE behaviour: the side's lock position (its NFT mint is the pair_curve PDA, unforgeable) registers.
/// FIXED (r2): register_fee_key identifies a pair position by its locker (@128 = the pair's vault = the pool's creator) and measures
/// the majority against the LP in Raydium's lock account, which a deposit cannot change.
#[test]
fn rl2b_a_depositor_must_not_block_register_fee_key_on_a_pair_pool() {
    let mut env = lock_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    let (ba, _bb) = fill(&mut env, &p, 50 * SOL, 40 * SOL);
    graduate_only(&mut env, &p, &c, 0).unwrap();
    lock_side(&mut env, &p, &c, 0).unwrap();
    let pool = pool_of(&p, 0);
    let mint = p.mint(0);
    env.ok(&[ix_register_pair(&c.pubkey(), &mint, &pool.pool, &pool.lp_mint, &p.pair)], &[&c]);
    let supply = lp_supply(&env, &pool.pool);
    // the side-A curve buyer deposits: its curve tokens + WSOL
    env.fund(&ba.pubkey(), 200 * SOL);
    env.wrap_sol(&ba, 150 * SOL);
    env.create_ata(&ba.pubkey(), &pool.lp_mint);
    let held = env.token_amount(&get_associated_token_address(&ba.pubkey(), &mint));
    let r = env.send(&[ix_deposit(&ba.pubkey(), &pool, supply + supply / 20, u64::MAX, u64::MAX)], &[&ba]);
    assert!(r.is_ok(), "deposit (holder has {held} tokens): {}", describe(&r));
    println!("RL-2b: lp_supply {supply} → {} after the deposit", lp_supply(&env, &pool.pool));
    let nft = fee_nft_mint(&p.pair, 0);
    let r = env.send(&[ix_register_fee_key(&c.pubkey(), &mint, &pool.pool, &nft)], &[&c]);
    println!("RL-2b: register_fee_key → {}", describe(&r));
    assert!(r.is_ok(), "the side's own lock position must register despite a later deposit");
}

/// lp-lock blind review L-2: burn_lp — the permissionless fallback when lock_lp cannot run. Refused before 30 days after the
/// graduation decision; afterwards it burns ALL of the vault's LP, records it in lp_locked (lock_lp then refuses), closes the LP account
/// into the side's burn pool, and register_pair_pool accepts the burned LP. Refused once the LP is locked.
#[test]
fn l2_burn_lp_is_a_30_day_fallback_and_the_side_still_registers() {
    let mut env = lock_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    graduate_only(&mut env, &p, &c, 0).unwrap();
    let pool = pool_of(&p, 0);
    let mint = p.mint(0);
    let burn = |env: &mut Env| env.send(&[ix_burn_lp(&p.pair, &p.vault, &mint, &pool, &c.pubkey(), 0)], &[&c]);
    expect_anchor_err(burn(&mut env), "LpLockFallbackNotDue");
    let started = pair_state(&env, &p).graduation_started_at;
    env.set_time(started + pair_curve::constants::LP_LOCK_FALLBACK_SECS - 1);
    expect_anchor_err(burn(&mut env), "LpLockFallbackNotDue");
    env.set_time(started + pair_curve::constants::LP_LOCK_FALLBACK_SECS);
    let vault_lp = get_associated_token_address(&p.vault, &pool.lp_mint);
    let lp = env.token_amount(&vault_lp);
    let (supply0, fee0, vault0) = (env.mint_supply(&pool.lp_mint), env.lamports(&fee_pda(&mint)), env.lamports(&p.vault));
    let rent = env.lamports(&vault_lp);
    let m = burn(&mut env).unwrap();
    let ev: pair_curve::events::LpBurnedFallback = pc_event(&m);
    assert_eq!((ev.side, ev.lp_amount, ev.pool), (0, lp, pool.pool));
    assert_eq!(supply0 - env.mint_supply(&pool.lp_mint), lp, "all of the vault's LP is burned");
    assert_eq!(pair_state(&env, &p).lp_locked[0], lp, "recorded in lp_locked");
    assert!(env.svm.get_account(&vault_lp).map(|a| a.lamports == 0).unwrap_or(true), "the LP account is closed");
    assert_eq!(env.lamports(&fee_pda(&mint)) - fee0, rent, "its rent goes to the side's burn pool");
    assert_eq!(env.lamports(&p.vault), vault0, "the vault keeps every lamport");
    expect_anchor_err(lock_side(&mut env, &p, &c, 0), "NothingToLock");
    expect_anchor_err(burn(&mut env), "NothingToLock");
    env.ok(&[ix_register_pair(&c.pubkey(), &mint, &pool.pool, &pool.lp_mint, &p.pair)], &[&c]);
    assert!(env.config(&config_pda(&mint)).pool_verified, "the side registers on its burned LP");
    // side B: locked normally → burn_lp refuses even after 30 days
    graduate_only(&mut env, &p, &c, 1).unwrap();
    lock_side(&mut env, &p, &c, 1).unwrap();
    let pool_b = pool_of(&p, 1);
    let r = env.send(&[ix_burn_lp(&p.pair, &p.vault, &p.mint(1), &pool_b, &c.pubkey(), 1)], &[&c]);
    expect_anchor_err(r, "NothingToLock");
}

/// The pair's lock position records the pair's vault as its locker (@128) — lock_lp checks it after the CPI, and register_fee_key
/// identifies the position by it (RL-2 a).
#[test]
fn rl2c_the_pair_lock_records_the_vault_as_locker() {
    let mut env = lock_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    graduate_only(&mut env, &p, &c, 0).unwrap();
    lock_side(&mut env, &p, &c, 0).unwrap();
    let nft = fee_nft_mint(&p.pair, 0);
    let d = env.svm.get_account(&locked_liquidity(&nft)).unwrap().data;
    assert_eq!(&d[LL_LOCKED_LOCKER..LL_LOCKED_LOCKER + 32], p.vault.as_ref());
}
