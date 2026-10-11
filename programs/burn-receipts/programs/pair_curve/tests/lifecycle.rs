//! pair_curve integration suite (LiteSVM, in-process): the real pair_curve and burn_receipts programs, the REAL Raydium CPMM (built
//! from its pinned source, fixtures/raydium_cp_swap.so) and a hostile CPMM stand-in (mocks/evil_cpmm_init) for the post-CPI guards.
//!
//! Requires `anchor build` (target/deploy/{pair_curve,burn_receipts}.so) and scripts/test.sh's fixtures. Reuses burn_receipts' harness.

#![allow(clippy::result_large_err, clippy::too_many_arguments)]

#[path = "../../burn_receipts/tests/common/mod.rs"]
mod common;

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
    env.svm.add_program(pair_curve::ID, &read_so("target/deploy/pair_curve.so")).unwrap();
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
    let mut acc = bcpmm::platform_account(env, cp_config, &Pubkey::default(), [0, 0, 1_000_000]);
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
            fee_vault: fee_pda(&mint),
            dev_wallet: p.dev,
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
            fee_vault: fee_pda(&mint),
            dev_wallet: p.dev,
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
    let mut ixs = vec![ix_graduate(p, &cranker.pubkey(), side)];
    ixs.extend_from_slice(extra);
    env.send(&ixs, &[cranker])
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
        pair_curve::accounts::VoidPair { caller: *caller, pair: p.pair, event_authority: pc_event_authority(), program: pair_curve::ID }.to_account_metas(None),
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
            token_program: spl_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            event_authority: pc_event_authority(),
            program: pair_curve::ID,
        }
        .to_account_metas(None),
    )
}

fn ix_register_pair(registrar: &Pubkey, mint: &Pubkey, pool: &Pubkey, lp_mint: &Pubkey, pair: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::RegisterPairPool {}.data(),
        burn_receipts::accounts::RegisterPairPool {
            registrar: *registrar,
            config: config_pda(mint),
            mint: *mint,
            pool_state: *pool,
            lp_mint: *lp_mint,
            pair: *pair,
            event_authority: event_authority(),
            program: burn_receipts::ID,
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
// --------------------------------------------------------------------------------------------------------------------------------

#[test]
fn layout_offsets_burn_receipts_reads_match_the_real_account() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let d = env.svm.get_account(&p.pair).unwrap().data;
    use pair_curve::state::offsets as o;
    assert_eq!(&d[..8], burn_receipts::pair_curve::PAIR_DISCRIMINATOR);
    assert_eq!(&d[..8], Pair::DISCRIMINATOR);
    assert_eq!(d[o::VERSION], 1);
    assert_eq!(d[o::STATUS], pair_curve::STATUS_OPEN);
    assert_eq!(&d[o::MINTS..o::MINTS + 32], p.ma.pubkey().as_ref());
    assert_eq!(&d[o::MINTS + 32..o::MINTS + 64], p.mb.pubkey().as_ref());
    assert_eq!(&d[o::CP_CONFIG..o::CP_CONFIG + 32], p.amm.as_ref());
    assert_eq!(&d[o::VAULT..o::VAULT + 32], p.vault.as_ref());
    assert!(d.len() >= o::MIN_LEN);
    assert_eq!(pair_curve::ID, PAIR_CURVE_PROGRAM_ID, "burn_receipts' hard-coded pair_curve id");
    // init_pair minted both supplies into the vaults and revoked the mint authority.
    for side in 0..2u8 {
        let m = p.mint(side);
        assert_eq!(env.mint_supply(&m), pair_curve::TOTAL_SUPPLY);
        assert_eq!(env.token_amount(&get_associated_token_address(&p.vault, &m)), pair_curve::TOTAL_SUPPLY);
        let mint = env.svm.get_account(&m).unwrap();
        let mint = <spl_token::state::Mint as anchor_lang::solana_program::program_pack::Pack>::unpack(&mint.data).unwrap();
        assert!(mint.mint_authority.is_none() && mint.freeze_authority.is_none());
    }
    let s = pair_state(&env, &p);
    assert_eq!(s.dev_wallet, p.dev);
    assert_eq!(s.fee_vaults, [fee_pda(&p.mint(0)), fee_pda(&p.mint(1))]);
    assert_eq!(s.rules_sha256_a, rules_sha256());
    assert_eq!(env.lamports(&p.vault), vault_rent(&env));
    println!("Pair account: {} bytes (8 + INIT_SPACE {})", d.len(), <Pair as anchor_lang::Space>::INIT_SPACE);
}

#[test]
fn trades_follow_the_curve_and_split_fees_exactly() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let curve = pair_state(&env, &p).curve();
    let (fa, fb) = (fee_pda(&p.mint(0)), fee_pda(&p.mint(1)));
    let (fa0, fb0, dev0) = (env.lamports(&fa), env.lamports(&fb), env.lamports(&p.dev));
    let alice = trader(&mut env, 100 * SOL);
    let bob = trader(&mut env, 100 * SOL);

    let q1 = quote_buy(&curve, 0, 3 * SOL).unwrap();
    let a0 = env.lamports(&alice.pubkey());
    let meta = env.ok(&[ix_buy(&p, &alice.pubkey(), 0, 3 * SOL, q1.tokens_out)], &[&alice]);
    println!("buy CU (creates the buyer's ATA): {}", meta.compute_units_consumed);
    let ev: pair_curve::events::Trade = pc_event(&meta);
    assert_eq!((ev.tokens, ev.curve_lamports, ev.fee, ev.dev_fee, ev.burn_fee), (q1.tokens_out, q1.cost, q1.fees.fee, q1.fees.dev, q1.fees.burn));
    assert_eq!(env.token_amount(&get_associated_token_address(&alice.pubkey(), &p.mint(0))), q1.tokens_out);
    let ata_rent = env.svm.minimum_balance_for_rent_exemption(165);
    assert_eq!(a0 - env.lamports(&alice.pubkey()), q1.total + ata_rent, "buyer pays cost + fee + its ATA rent (the harness payer pays the tx fee)");
    assert_eq!(env.lamports(&p.dev) - dev0, q1.fees.dev);
    assert_eq!(env.lamports(&fa) - fa0, q1.fees.burn);

    let q2 = quote_buy(&curve, q1.sold_after, 2 * SOL).unwrap();
    let meta = env.ok(&[ix_buy(&p, &bob.pubkey(), 0, 2 * SOL, 1)], &[&bob]);
    let _ = meta;
    // the second buyer pays a higher price than the first
    assert!(q2.cost as u128 * q1.tokens_out as u128 > q1.cost as u128 * q2.tokens_out as u128);
    let qb = quote_buy(&curve, 0, 5 * SOL).unwrap();
    let meta = env.ok(&[ix_buy(&p, &bob.pubkey(), 1, 5 * SOL, 1)], &[&bob]);
    println!("buy CU (existing ATA): {}", meta.compute_units_consumed);

    // Alice sells half back.
    let half = q1.tokens_out / 2;
    let qs = quote_sell(&curve, q2.sold_after, half).unwrap();
    let a1 = env.lamports(&alice.pubkey());
    let meta = env.ok(&[ix_sell(&p, &alice.pubkey(), 0, half, qs.net)], &[&alice]);
    println!("sell CU: {}", meta.compute_units_consumed);
    assert_eq!(env.lamports(&alice.pubkey()) - a1, qs.net);
    // slippage guard
    expect_anchor_err(env.send(&[ix_sell(&p, &alice.pubkey(), 0, 1_000, u64::MAX)], &[&alice]), "SlippageExceeded");
    expect_anchor_err(env.send(&[ix_buy(&p, &alice.pubkey(), 1, SOL, u64::MAX)], &[&alice]), "SlippageExceeded");
    expect_anchor_err(env.send(&[ix_buy(&p, &alice.pubkey(), 2, SOL, 1)], &[&alice]), "InvalidSide");

    // Invariant: the vault holds exactly rent + F(sold_A) + F(sold_B); fee legs add up exactly.
    let s = pair_state(&env, &p);
    assert_eq!(s.sol, [sol_at(&curve, s.sold[0]).unwrap(), sol_at(&curve, s.sold[1]).unwrap()]);
    assert_eq!(env.lamports(&p.vault), vault_rent(&env) + s.sol[0] + s.sol[1]);
    let fees_a = fee_split(q1.cost).fee + fee_split(q2.cost).fee + qs.fees.fee;
    assert_eq!(s.burn_fees_lamports[0] + s.dev_fees_lamports[0], fees_a);
    assert_eq!(s.burn_fees_lamports[1] + s.dev_fees_lamports[1], qb.fees.fee);
    assert_eq!(env.lamports(&fa) - fa0, s.burn_fees_lamports[0]);
    assert_eq!(env.lamports(&fb) - fb0, s.burn_fees_lamports[1]);
    assert_eq!(env.lamports(&p.dev) - dev0, s.dev_fees_lamports[0] + s.dev_fees_lamports[1]);
    // per trade: dev = floor(fee / 4), burn = fee − dev
    assert_eq!(s.dev_fees_lamports[0], fee_split(q1.cost).dev + fee_split(q2.cost).dev + qs.fees.dev);
    assert_eq!(s.dev_fees_lamports[1], qb.fees.dev);
}

#[test]
fn a_drained_developer_wallet_cannot_block_trades_its_slice_goes_to_the_burn_pool() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    // The developer empties the wallet to 0: a sub-rent credit would now fail the System transfer.
    env.svm.set_account(p.dev, litesvm_account(0, vec![], anchor_lang::solana_program::system_program::ID)).unwrap();
    let alice = trader(&mut env, 10 * SOL);
    let fa0 = env.lamports(&fee_pda(&p.mint(0)));
    let meta = env.ok(&[ix_buy(&p, &alice.pubkey(), 0, SOL / 10, 1)], &[&alice]);
    let ev: pair_curve::events::Trade = pc_event(&meta);
    assert!(ev.dev_fee_redirected);
    assert_eq!((ev.dev_fee, ev.burn_fee), (0, ev.fee));
    assert_eq!(env.lamports(&fee_pda(&p.mint(0))) - fa0, ev.fee);
    assert_eq!(env.lamports(&p.dev), 0);
    // and the exit works too
    let held = env.token_amount(&get_associated_token_address(&alice.pubkey(), &p.mint(0)));
    env.ok(&[ix_sell(&p, &alice.pubkey(), 0, held, 1)], &[&alice]);
    assert_eq!(env.lamports(&p.vault), vault_rent(&env), "everything sold back: the vault holds exactly its rent minimum");
}

#[test]
fn graduation_needs_target_and_minimum_share_then_creates_both_pools_and_burns_all_lp() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let cranker = trader(&mut env, SOL);
    let curve = pair_state(&env, &p).curve();

    // Side A alone past the target: not ready (B holds 0 % of the raise).
    let whale = trader(&mut env, 200 * SOL);
    env.ok(&[ix_buy(&p, &whale.pubkey(), 0, 70 * SOL, 1)], &[&whale]);
    expect_anchor_err(graduate_side(&mut env, &p, &cranker, 0, &[]), "NotReadyToGraduate");
    // B at ~20 % of the combined raise: still not ready.
    let b1 = trader(&mut env, 100 * SOL);
    env.ok(&[ix_buy(&p, &b1.pubkey(), 1, 17 * SOL, 1)], &[&b1]);
    let s = pair_state(&env, &p);
    assert!(s.sol[1] * 10_000 < 2_500 * (s.sol[0] + s.sol[1]));
    expect_anchor_err(graduate_side(&mut env, &p, &cranker, 0, &[]), "NotReadyToGraduate");
    // B to ≥ 25 %.
    env.ok(&[ix_buy(&p, &b1.pubkey(), 1, 8 * SOL, 1)], &[&b1]);
    let s = pair_state(&env, &p);
    assert!(s.sol[1] * 10_000 >= 2_500 * (s.sol[0] + s.sol[1]) && s.sol[0] + s.sol[1] >= s.target_raise_lamports);

    let rent = anchor_lang::prelude::Rent::default();
    assert_eq!(rent.minimum_balance(0), vault_rent(&env), "LiteSVM runs the default rent");
    let costs = side_costs(&rent, MAINNET_POOL_FEE);
    let expect_pool_sol = [s.sol[0] - costs, s.sol[1] - costs];
    let expect_tokens = [
        price_matched_tokens(&curve, s.sold[0], expect_pool_sol[0], u64::MAX).unwrap(),
        price_matched_tokens(&curve, s.sold[1], expect_pool_sol[1], u64::MAX).unwrap(),
    ];
    let fee_before = [env.lamports(&fee_pda(&p.mint(0))), env.lamports(&fee_pda(&p.mint(1)))];
    let supply_before = [env.mint_supply(&p.mint(0)), env.mint_supply(&p.mint(1))];
    let receiver_before = env.lamports(&CREATE_POOL_FEE_RECEIVER);

    let metas = graduate_both(&mut env, &p, &cranker);
    println!("graduate CU: side A (decision + pool + LP burn) {}, side B {}", metas[0].compute_units_consumed, metas[1].compute_units_consumed);
    let evs: Vec<pair_curve::events::SideGraduated> = metas.iter().map(pc_event).collect();
    assert!(!evs[0].pair_graduated && evs[1].pair_graduated);
    let g = pair_state(&env, &p);
    assert_eq!(g.raise_at_graduation, s.sol);
    assert_eq!(g.status, pair_curve::STATUS_GRADUATED);
    assert_eq!(g.sol, [0, 0]);
    assert_eq!(g.pools, [pool_pda(&p.pair, 0), pool_pda(&p.pair, 1)]);
    assert_eq!(g.pool_sol, expect_pool_sol);
    assert_eq!(g.pool_tokens, expect_tokens);
    assert_eq!(env.lamports(&CREATE_POOL_FEE_RECEIVER) - receiver_before, 2 * MAINNET_POOL_FEE);
    for side in 0..2u8 {
        let s_ = side as usize;
        let pool = pool_of(&p, side);
        let pd = env.svm.get_account(&pool.pool).unwrap();
        assert_eq!(pd.owner, CPMM_PROGRAM_ID);
        let view_creator = Pubkey::new_from_array(pd.data[40..72].try_into().unwrap());
        let view_config = Pubkey::new_from_array(pd.data[8..40].try_into().unwrap());
        assert_eq!(view_creator, p.vault, "the pair's SOL vault created the pool");
        assert_eq!(view_config, p.amm);
        let (r_sol, r_tok) = bcpmm::reserves(&env, &pool);
        assert_eq!((r_sol, r_tok), (expect_pool_sol[s_], expect_tokens[s_]));
        // the pool opens at (or a hair above) the curve's last price
        let s_res = curve.virtual_sol as u128 + s.sol[s_] as u128;
        let t_res = (curve.virtual_token - s.sold[s_]) as u128;
        assert!(r_sol as u128 * t_res >= s_res * r_tok as u128);
        // 100 % of the LP burned: LP mint supply 0, CPMM still counts it
        assert_eq!(env.mint_supply(&pool.lp_mint), 0);
        assert_eq!(g.lp_burned[s_] + 100, g.lp_supply_at_creation[s_]);
        assert!(env.svm.get_account(&get_associated_token_address(&p.vault, &pool.lp_mint)).map(|a| a.lamports == 0).unwrap_or(true), "LP account closed");
        // every token the pool did not need was burned; the token vault is empty
        assert_eq!(env.token_amount(&get_associated_token_address(&p.vault, &p.mint(side))), 0);
        assert_eq!(env.mint_supply(&p.mint(side)), supply_before[s_] - g.tokens_burned[s_]);
        assert_eq!(g.tokens_burned[s_], pair_curve::TOTAL_SUPPLY - s.sold[s_] - expect_tokens[s_]);
    }
    // the vault is back to its rent minimum; the residue went to the burn pools
    assert_eq!(env.lamports(&p.vault), vault_rent(&env));
    assert!(env.svm.get_account(&get_associated_token_address(&p.vault, &NATIVE_MINT)).map(|a| a.lamports == 0).unwrap_or(true), "WSOL account closed");
    let got = [env.lamports(&fee_pda(&p.mint(0))) - fee_before[0], env.lamports(&fee_pda(&p.mint(1))) - fee_before[1]];
    assert_eq!(got, [evs[0].residue_lamports, evs[1].residue_lamports], "each side's residue went to its own burn pool");
    assert!(got[0] < SOL / 100 && got[1] < SOL / 100, "residue is rent refunds and dust only: {got:?}");

    // Closed curves: no buys, no sells, no second graduation, no void.
    expect_anchor_err(env.send(&[ix_buy(&p, &whale.pubkey(), 0, SOL, 1)], &[&whale]), "NotOpen");
    expect_anchor_err(env.send(&[ix_sell(&p, &whale.pubkey(), 0, 1_000, 0)], &[&whale]), "SellsClosed");
    expect_anchor_err(graduate_side(&mut env, &p, &cranker, 0, &[]), "NotOpen");
    env.set_time(g.deadline + 1);
    expect_anchor_err(env.send(&[ix_void(&p, &cranker.pubkey())], &[&cranker]), "NotOpen");
}

#[test]
fn both_pools_register_in_burn_receipts_and_the_buyback_crank_runs_on_one() {
    let mut env = new_env();
    let auth = Pubkey::new_unique();
    env.init_platform(&auth, DEFAULT_BURN_POOL_CAP_LAMPORTS);
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let cranker = trader(&mut env, SOL);
    let (ba, bb) = fill(&mut env, &p, 50 * SOL, 40 * SOL);

    // Registration refused before graduation.
    let pa = pool_of(&p, 0);
    expect_anchor_err(env.send(&[ix_register_pair(&cranker.pubkey(), &p.mint(0), &pa.pool, &pa.lp_mint, &p.pair)], &[&cranker]), "AccountNotInitialized");

    // Each side: graduate + its register_pair_pool in ONE legacy transaction (what the keeper sends).
    let pb = pool_of(&p, 1);
    let regs = [
        ix_register_pair(&cranker.pubkey(), &p.mint(0), &pa.pool, &pa.lp_mint, &p.pair),
        ix_register_pair(&cranker.pubkey(), &p.mint(1), &pb.pool, &pb.lp_mint, &p.pair),
    ];
    for side in 0..2u8 {
        let size = env.legacy_size(&[compute_budget(400_000), ix_graduate(&p, &cranker.pubkey(), side), regs[side as usize].clone()]);
        let meta = match graduate_side(&mut env, &p, &cranker, side, std::slice::from_ref(&regs[side as usize])) {
            Ok(m) => m,
            Err(e) => panic!("graduate+register failed: {:?}\n{}", e.err, e.meta.logs.join("\n")),
        };
        println!("graduate({side}) + register_pair_pool in one legacy transaction: {} CU, {size} bytes", meta.compute_units_consumed);
    }
    for side in 0..2u8 {
        let c = env.config(&config_pda(&p.mint(side)));
        assert_eq!(c.cpmm_pool, pool_pda(&p.pair, side));
        assert!(c.pool_verified);
    }
    expect_anchor_err(env.send(&[regs[0].clone()], &[&cranker]), "PoolAlreadyRegistered");

    // TWAP history on pool A (the buyer of side A trades on the pool), then a reading and the buyback crank.
    let mint = p.mint(0);
    let fee = fee_pda(&mint);
    env.create_ata(&fee, &NATIVE_MINT);
    env.create_ata(&fee, &mint);
    env.wrap_sol(&ba, 5 * SOL);
    let mut now = env.now();
    for i in 0..6 {
        now += 150;
        env.set_time(now);
        let r = if i % 2 == 0 { bcpmm::swap(&mut env, &ba, &pa, &mint, true, SOL / 10) } else { bcpmm::swap(&mut env, &ba, &pa, &mint, false, 1_000_000 * TOKEN) };
        r.unwrap();
    }
    let _ = bb;
    submit(&mut env, &mint, D1, V1, &[&p.attester]).unwrap();
    submit(&mut env, &mint, D2, V1 + 21 * UNIT, &[&p.attester]).unwrap();
    let supply = env.mint_supply(&mint);
    let meta = env.ok(&[bcpmm::ix_crank_buyback(&cranker.pubkey(), &mint, &pa, D2)], &[&cranker]);
    println!("crank_buyback on a pair pool CU: {}", meta.compute_units_consumed);
    let r = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap();
    assert_eq!(r.outcome, OUTCOME_BURNED);
    assert!(r.burned > 0 && env.mint_supply(&mint) == supply - r.burned);
    assert_eq!(r.pool, pa.pool);
}

#[test]
fn register_pair_pool_refuses_forgeries_and_survives_lp_dilution() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let reg = trader(&mut env, 10 * SOL);
    let (ba, _bb) = fill(&mut env, &p, 50 * SOL, 40 * SOL);
    env.fund(&ba.pubkey(), 100 * SOL);
    graduate_both(&mut env, &p, &reg);
    let (pa, pb) = (pool_of(&p, 0), pool_of(&p, 1));

    // The other side's pool for this mint.
    expect_anchor_err(env.send(&[ix_register_pair(&reg.pubkey(), &p.mint(0), &pb.pool, &pb.lp_mint, &p.pair)], &[&reg]), "NotPairPool");
    // A forged Pair: the real bytes, owned by someone else / at another address.
    let real = env.svm.get_account(&p.pair).unwrap();
    let forged = Pubkey::new_unique();
    env.svm.set_account(forged, litesvm_account(real.lamports, real.data.clone(), Pubkey::new_unique())).unwrap();
    expect_anchor_err(env.send(&[ix_register_pair(&reg.pubkey(), &p.mint(0), &pa.pool, &pa.lp_mint, &forged)], &[&reg]), "InvalidPairAccount");
    env.svm.set_account(forged, litesvm_account(real.lamports, real.data.clone(), PAIR_CURVE_PROGRAM_ID)).unwrap();
    expect_anchor_err(env.send(&[ix_register_pair(&reg.pubkey(), &p.mint(0), &pa.pool, &pa.lp_mint, &forged)], &[&reg]), "InvalidPairAccount");
    // A policy-0 (LaunchLab) token cannot take a pair pool.
    let other = Keypair::new();
    let mut args = init_args(buyback_rule(), vec![p.attester.pubkey()], 1);
    args.admin = p.creator.pubkey();
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize_with_platform(&payer, &p.creator.pubkey(), &other.pubkey(), args, Some(TEST_LAUNCHLAB_PLATFORM))], &[&p.creator, &other]);
    env.create_mint(&other, &payer, 6);
    expect_anchor_err(env.send(&[ix_register_pair(&reg.pubkey(), &other.pubkey(), &pa.pool, &pa.lp_mint, &p.pair)], &[&reg]), "WrongPoolPolicy");
    // ... and register_pool (the LaunchLab path) refuses a policy-2 token.
    expect_anchor_err(env.send(&[ix_register_pool(&reg.pubkey(), &p.mint(0), &pa.pool)], &[&reg]), "WrongPoolPolicy");

    // LP dilution (blind review 3 M-2 class): someone deposits liquidity into pool A before registration — still registers.
    let mint = p.mint(0);
    let wsol = env.wrap_sol(&ba, 20 * SOL);
    let tok = get_associated_token_address(&ba.pubkey(), &mint);
    let lp_ata = env.create_ata(&ba.pubkey(), &pa.lp_mint);
    let (t0_acc, t1_acc) = if pa.wsol_is_0 { (wsol, tok) } else { (tok, wsol) };
    let lp_supply = {
        let d = env.svm.get_account(&pa.pool).unwrap().data;
        u64::from_le_bytes(d[333..341].try_into().unwrap())
    };
    let ix = Instruction {
        program_id: CPMM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(ba.pubkey(), true),
            AccountMeta::new_readonly(pa.authority, false),
            AccountMeta::new(pa.pool, false),
            AccountMeta::new(lp_ata, false),
            AccountMeta::new(t0_acc, false),
            AccountMeta::new(t1_acc, false),
            AccountMeta::new(pa.token_0_vault, false),
            AccountMeta::new(pa.token_1_vault, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(anchor_lang::prelude::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"), false),
            AccountMeta::new_readonly(pa.token_0_mint, false),
            AccountMeta::new_readonly(pa.token_1_mint, false),
            AccountMeta::new(pa.lp_mint, false),
        ],
        data: {
            let mut d = vec![242, 35, 198, 137, 82, 225, 242, 182];
            d.extend_from_slice(&(lp_supply / 5).to_le_bytes()); // +20 % of the liquidity: the live ratio drops to ≈ 83 %
            d.extend_from_slice(&u64::MAX.to_le_bytes());
            d.extend_from_slice(&u64::MAX.to_le_bytes());
            d
        },
    };
    env.ok(&[ix], &[&ba]);
    assert!(env.mint_supply(&pa.lp_mint) > 0, "the depositor now holds LP");
    env.ok(&[ix_register_pair(&reg.pubkey(), &mint, &pa.pool, &pa.lp_mint, &p.pair)], &[&reg]);
    let meta = env.ok(&[ix_register_pair(&reg.pubkey(), &p.mint(1), &pb.pool, &pb.lp_mint, &p.pair)], &[&reg]);
    println!("register_pair_pool CU: {}", meta.compute_units_consumed);
}

#[test]
fn void_after_the_deadline_lets_every_holder_exit_and_the_vault_drains_exactly() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |a| a.deadline = a.deadline - 86_400 + 600);
    let holders: Vec<Keypair> = (0..4).map(|_| trader(&mut env, 50 * SOL)).collect();
    for (i, h) in holders.iter().enumerate() {
        env.ok(&[ix_buy(&p, &h.pubkey(), (i % 2) as u8, (i as u64 + 1) * 3 * SOL + 12_345, 1)], &[h]);
    }
    // a holder trades in between (path independence)
    let h0 = &holders[0];
    let held = env.token_amount(&get_associated_token_address(&h0.pubkey(), &p.mint(0)));
    env.ok(&[ix_sell(&p, &h0.pubkey(), 0, held / 3, 1)], &[h0]);
    env.ok(&[ix_buy(&p, &h0.pubkey(), 0, SOL + 7, 1)], &[h0]);
    let s = pair_state(&env, &p);
    let cranker = trader(&mut env, SOL);
    expect_anchor_err(env.send(&[ix_void(&p, &cranker.pubkey())], &[&cranker]), "DeadlineNotReached");

    env.set_time(s.deadline);
    expect_anchor_err(env.send(&[ix_buy(&p, &holders[1].pubkey(), 1, SOL, 1)], &[&holders[1]]), "DeadlinePassed");
    expect_anchor_err(graduate_side(&mut env, &p, &cranker, 1, &[]), "GraduationClosed");
    let meta = env.ok(&[ix_void(&p, &cranker.pubkey())], &[&cranker]);
    println!("void_pair CU: {}", meta.compute_units_consumed);
    expect_anchor_err(env.send(&[ix_void(&p, &cranker.pubkey())], &[&cranker]), "NotOpen");
    expect_anchor_err(env.send(&[ix_buy(&p, &holders[1].pubkey(), 1, SOL, 1)], &[&holders[1]]), "NotOpen");
    expect_anchor_err(env.send(&[ix_close(&p, &cranker.pubkey())], &[&cranker]), "NotClosable");

    // Everyone sells everything back, in an arbitrary order.
    let curve = s.curve();
    for side in [1u8, 0] {
        for h in holders.iter().rev() {
            let ata = get_associated_token_address(&h.pubkey(), &p.mint(side));
            let amt = env.svm.get_account(&ata).map(|_| env.token_amount(&ata)).unwrap_or(0);
            if amt == 0 {
                continue;
            }
            let st = pair_state(&env, &p);
            let q = quote_sell(&curve, st.sold[side as usize], amt).unwrap();
            let before = env.lamports(&h.pubkey());
            env.ok(&[ix_sell(&p, &h.pubkey(), side, amt, q.net)], &[h]);
            assert_eq!(env.lamports(&h.pubkey()) - before, q.net);
        }
    }
    let e = pair_state(&env, &p);
    assert_eq!((e.sold, e.sol), ([0, 0], [0, 0]));
    assert_eq!(env.lamports(&p.vault), vault_rent(&env), "the SOL vault drained to exactly its rent minimum");

    // close_pair: burns the returned supplies, closes the accounts, rent to the creator.
    let creator_before = env.lamports(&p.creator.pubkey());
    let meta = env.ok(&[ix_close(&p, &cranker.pubkey())], &[&cranker]);
    println!("close_pair (voided, burns both supplies) CU: {}", meta.compute_units_consumed);
    assert!(env.svm.get_account(&p.pair).map(|a| a.lamports == 0).unwrap_or(true));
    assert_eq!(env.mint_supply(&p.mint(0)), 0);
    assert_eq!(env.mint_supply(&p.mint(1)), 0);
    assert!(env.lamports(&p.creator.pubkey()) > creator_before);
    assert_eq!(env.lamports(&p.vault), vault_rent(&env));
    // A pair can never be re-created on those mints (no mint authority left).
    let ix = ix_init_pair(&env, &p, default_args(env.now()));
    expect_anchor_err(env.send(&[ix], &[&p.creator]), "InvalidMint");
}

#[test]
fn close_after_graduation_returns_rent_and_keeps_the_vault_at_rent_minimum() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    let (ba, _) = fill(&mut env, &p, 50 * SOL, 40 * SOL);
    graduate_both(&mut env, &p, &c);
    // someone donates to the vault afterwards: close_pair sends it to the burn pools
    env.transfer_sol(&p.vault, 12_345);
    // ... and sends tokens back into a token vault: close_pair burns them (a donation cannot block the close)
    let tv = get_associated_token_address(&p.vault, &p.mint(0));
    let ix = spl_token::instruction::transfer(&spl_token::ID, &get_associated_token_address(&ba.pubkey(), &p.mint(0)), &tv, &ba.pubkey(), &[], 1_000).unwrap();
    env.ok(&[ix], &[&ba]);
    let supply = env.mint_supply(&p.mint(0));
    let fa = env.lamports(&fee_pda(&p.mint(0)));
    env.ok(&[ix_close(&p, &c.pubkey())], &[&c]);
    assert_eq!(env.lamports(&p.vault), vault_rent(&env));
    assert_eq!(env.lamports(&fee_pda(&p.mint(0))) - fa, 12_345 / 2);
    assert_eq!(env.mint_supply(&p.mint(0)), supply - 1_000);
    assert!(env.svm.get_account(&tv).map(|a| a.lamports == 0).unwrap_or(true));
}

#[test]
fn init_pair_refuses_strangers_wrong_mints_and_bad_parameters() {
    let mut env = new_env();
    let p = prepare(&mut env, MAINNET_POOL_FEE);
    let now = env.now();
    // not the recorded creator
    let stranger = trader(&mut env, SOL);
    let mut ix = ix_init_pair(&env, &p, default_args(now));
    ix.accounts[1].pubkey = stranger.pubkey();
    expect_anchor_err(env.send(&[ix], &[&stranger]), "CreatorMismatch");
    // parameters
    for (f, name) in [
        (Box::new(|a: &mut InitPairArgs| a.deadline = now + 30) as Box<dyn Fn(&mut InitPairArgs)>, "InvalidParams"),
        (Box::new(|a: &mut InitPairArgs| a.min_side_share_bps = 900), "InvalidParams"),
        (Box::new(|a: &mut InitPairArgs| a.curve_supply = 950_000_000 * 1_000_000), "InvalidParams"),
        (Box::new(|a: &mut InitPairArgs| a.virtual_token_amount = a.curve_supply), "InvalidParams"),
        (Box::new(|a: &mut InitPairArgs| a.target_raise_lamports = 500 * SOL), "InvalidParams"),
        (Box::new(|a: &mut InitPairArgs| a.target_raise_lamports = SOL / 2), "TargetTooSmall"),
    ] {
        let mut args = default_args(now);
        f(&mut args);
        let ix = ix_init_pair(&env, &p, args);
        expect_anchor_err(env.send(&[ix], &[&p.creator]), name);
    }
    // a policy-0 TokenConfig is not a pair token
    let mut env2 = new_env();
    let q = prepare(&mut env2, MAINNET_POOL_FEE);
    let m3 = Keypair::new();
    let pair3 = pair_pda(&q.ma.pubkey(), &m3.pubkey());
    env2.create_mint_full(&m3, &vault_pda(&pair3), None, 6);
    let mut args = init_args(buyback_rule(), vec![q.attester.pubkey()], 1);
    args.admin = q.creator.pubkey();
    let payer = env2.payer.pubkey();
    env2.ok(&[ix_initialize_with_platform(&payer, &q.creator.pubkey(), &m3.pubkey(), args, Some(TEST_LAUNCHLAB_PLATFORM))], &[&q.creator, &m3]);
    let q3 = P { mb: m3, pair: pair3, vault: vault_pda(&pair3), ..q };
    let ix = ix_init_pair(&env2, &q3, default_args(env2.now()));
    expect_anchor_err(env2.send(&[ix], &[&q3.creator]), "InvalidMint"); // mint A's authority is the OTHER pair's vault
    // the happy path still works on the original
    let ix = ix_init_pair(&env, &p, default_args(now));
    env.ok(&[ix], &[&p.creator]);
    let ix = ix_init_pair(&env, &p, default_args(now));
    expect_fail(env.send(&[ix], &[&p.creator]));
}

#[test]
fn a_freeze_authority_or_foreign_mint_authority_is_refused() {
    let mut env = new_env();
    let (ma, mb, creator, attester) = (Keypair::new(), Keypair::new(), Keypair::new(), Keypair::new());
    env.fund(&creator.pubkey(), 10 * SOL);
    let amm = amm_config(&mut env, 0, MAINNET_POOL_FEE);
    let dev = Pubkey::new_unique();
    env.fund(&dev, SOL);
    platform_with_dev(&mut env, &amm, &dev);
    let pair = pair_pda(&ma.pubkey(), &mb.pubkey());
    let vault = vault_pda(&pair);
    env.create_mint_full(&ma, &vault, Some(&creator.pubkey()), 6); // keeps a freeze authority
    env.create_mint_full(&mb, &vault, None, 6);
    for m in [&ma, &mb] {
        let mut args = init_args(pair_rule(), vec![attester.pubkey()], 1);
        args.admin = creator.pubkey();
        let payer = env.payer.pubkey();
        env.ok(&[ix_initialize_with_platform(&payer, &creator.pubkey(), &m.pubkey(), args, Some(TEST_LAUNCHLAB_PLATFORM))], &[&creator, m]);
    }
    let p = P { ma, mb, creator, attester, pair, vault, dev, amm };
    let ix = ix_init_pair(&env, &p, default_args(env.now()));
    expect_anchor_err(env.send(&[ix], &[&p.creator]), "InvalidMint");
}

/// A hostile CPMM (mocks/evil_cpmm_init loaded at CPMM's id) abuses the SOL vault's signature inside graduate; every abuse reverts.
#[test]
fn graduate_reverts_when_the_cpmm_callee_abuses_the_vault_signature() {
    // 1 assign the vault · 2 take 1 SOL more than the pool costs · 3 approve a delegate on a vault token account · 4 set a close
    // authority on one · 5 create no pool (the wrapped SOL never left the vault's WSOL account)
    for mode in 1u8..=5 {
        let mut env = Env::new();
        env.svm.add_program(pair_curve::ID, &read_so("target/deploy/pair_curve.so")).unwrap();
        env.svm.add_program(CPMM_PROGRAM_ID, &read_so("fixtures/evil_cpmm_init.so")).unwrap();
        // A CPMM-owned AmmConfig with the mode in its padding (byte 200).
        let amm = Pubkey::new_unique();
        let mut d = vec![0u8; burn_receipts::cpmm::AMM_CONFIG_LEN];
        d[..8].copy_from_slice(&burn_receipts::cpmm::AMM_CONFIG_DISCRIMINATOR);
        d[36..44].copy_from_slice(&MAINNET_POOL_FEE.to_le_bytes());
        d[200] = mode;
        let lamports = env.svm.minimum_balance_for_rent_exemption(d.len());
        env.svm.set_account(amm, litesvm_account(lamports, d, CPMM_PROGRAM_ID)).unwrap();
        fee_receiver(&mut env);
        let dev = Pubkey::new_unique();
        env.fund(&dev, SOL);
        platform_with_dev(&mut env, &amm, &dev);
        let (ma, mb, creator, attester) = (Keypair::new(), Keypair::new(), Keypair::new(), Keypair::new());
        env.fund(&creator.pubkey(), 10 * SOL);
        let pair = pair_pda(&ma.pubkey(), &mb.pubkey());
        let vault = vault_pda(&pair);
        for m in [&ma, &mb] {
            env.create_mint_full(m, &vault, None, 6);
            let mut args = init_args(pair_rule(), vec![attester.pubkey()], 1);
            args.admin = creator.pubkey();
            let payer = env.payer.pubkey();
            env.ok(&[ix_initialize_with_platform(&payer, &creator.pubkey(), &m.pubkey(), args, Some(TEST_LAUNCHLAB_PLATFORM))], &[&creator, m]);
        }
        let p = P { ma, mb, creator, attester, pair, vault, dev, amm };
        let ix = ix_init_pair(&env, &p, default_args(env.now()));
        env.ok(&[ix], &[&p.creator]);
        fill(&mut env, &p, 50 * SOL, 40 * SOL);
        let before = env.lamports(&p.vault);
        let c = trader(&mut env, SOL);
        let r = graduate_side(&mut env, &p, &c, 0, &[]);
        expect_anchor_err(r, "VaultTampered");
        assert_eq!(env.lamports(&p.vault), before, "mode {mode}: nothing left the vault");
        assert_eq!(pair_state(&env, &p).status, pair_curve::STATUS_OPEN, "mode {mode}: still open (and voidable at the deadline)");
    }
}

#[test]
fn the_idl_has_no_admin_withdraw_or_parameter_update() {
    let idl: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(format!("{}/../../target/idl/pair_curve.json", env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap();
    let names: Vec<String> = idl["instructions"].as_array().unwrap().iter().map(|i| i["name"].as_str().unwrap().to_string()).collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(sorted, ["buy", "close_pair", "graduate", "init_pair", "sell", "void_pair"]);
    for ix in idl["instructions"].as_array().unwrap() {
        let signers: Vec<&str> = ix["accounts"].as_array().unwrap().iter().filter(|a| a["signer"].as_bool().unwrap_or(false)).map(|a| a["name"].as_str().unwrap()).collect();
        let expected: &[&str] = match ix["name"].as_str().unwrap() {
            "init_pair" => &["payer", "creator"],
            "buy" => &["buyer"],
            "sell" => &["seller"],
            "graduate" => &["cranker"],
            "void_pair" | "close_pair" => &["caller"],
            n => panic!("undescribed instruction {n}"),
        };
        assert_eq!(signers, expected, "{}", ix["name"]);
    }
}

/// Liveness: a griefer pre-funds every address graduate will create (the pool PDAs, CPMM's LP mints, vaults and observation
/// accounts, the vault's WSOL account) with lamports. Graduation still succeeds; the extra lamports end up as residue in the burn pools.
#[test]
fn prefunded_addresses_do_not_block_graduation() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    let mut targets = vec![get_associated_token_address(&p.vault, &NATIVE_MINT)];
    for side in 0..2u8 {
        let pool = pool_of(&p, side);
        targets.extend([pool.pool, pool.lp_mint, pool.token_0_vault, pool.token_1_vault, pool.observation, get_associated_token_address(&p.vault, &pool.lp_mint)]);
    }
    for t in &targets {
        env.transfer_sol(t, 1_000_000);
    }
    let metas = graduate_both(&mut env, &p, &c);
    for m in &metas {
        let trace: usize = 1 + m.inner_instructions.iter().map(|v| v.len()).sum::<usize>();
        println!("graduate with every address pre-funded: {} CU, instruction trace {trace} of 64", m.compute_units_consumed);
        assert!(trace < 56, "trace {trace}");
    }
    let evs: Vec<pair_curve::events::SideGraduated> = metas.iter().map(pc_event).collect();
    assert_eq!(pair_state(&env, &p).status, pair_curve::STATUS_GRADUATED);
    assert!(evs[0].residue_lamports >= 1_000_000 && evs[1].residue_lamports >= 1_000_000, "the donations came back as residue");
    assert_eq!(env.lamports(&p.vault), vault_rent(&env));
}

/// Between the two graduate calls: the pair is committed — both curves closed, no void, side A registrable, side B still to create
/// (even after the deadline). If Raydium blocks side B for 3 days (here: the create-pool fee raised above B's raise), B's holders
/// may sell back on B's curve; A's curve stays closed.
#[test]
fn graduating_commits_the_pair_and_a_blocked_second_side_reopens_its_sells_after_three_days() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    let (ba, bb) = fill(&mut env, &p, 50 * SOL, 40 * SOL);
    graduate_side(&mut env, &p, &c, 0, &[]).unwrap();
    let s = pair_state(&env, &p);
    assert_eq!(s.status, pair_curve::STATUS_GRADUATING);
    expect_anchor_err(env.send(&[ix_buy(&p, &bb.pubkey(), 1, SOL, 1)], &[&bb]), "NotOpen");
    let held_b = env.token_amount(&get_associated_token_address(&bb.pubkey(), &p.mint(1)));
    expect_anchor_err(env.send(&[ix_sell(&p, &bb.pubkey(), 1, held_b, 1)], &[&bb]), "SellsClosed");
    expect_anchor_err(graduate_side(&mut env, &p, &c, 0, &[]), "SideAlreadyGraduated");
    let (pa, pb) = (pool_of(&p, 0), pool_of(&p, 1));
    expect_anchor_err(env.send(&[ix_register_pair(&c.pubkey(), &p.mint(1), &pb.pool, &pb.lp_mint, &p.pair)], &[&c]), "AccountNotInitialized");
    env.ok(&[ix_register_pair(&c.pubkey(), &p.mint(0), &pa.pool, &pa.lp_mint, &p.pair)], &[&c]);
    env.set_time(s.deadline + 10);
    expect_anchor_err(env.send(&[ix_void(&p, &c.pubkey())], &[&c]), "NotOpen");

    // Raydium raises the create-pool fee above side B's raise.
    let mut cfg = env.svm.get_account(&p.amm).unwrap();
    cfg.data[36..44].copy_from_slice(&(100 * SOL).to_le_bytes());
    env.svm.set_account(p.amm, cfg.clone()).unwrap();
    expect_anchor_err(graduate_side(&mut env, &p, &c, 1, &[]), "InsufficientPoolSol");
    expect_anchor_err(env.send(&[ix_sell(&p, &bb.pubkey(), 1, held_b / 2, 1)], &[&bb]), "SellsClosed");
    env.set_time(s.graduation_started_at + pair_curve::GRADUATION_STUCK_SECS);
    env.ok(&[ix_sell(&p, &bb.pubkey(), 1, held_b / 2, 1)], &[&bb]);
    let held_a = env.token_amount(&get_associated_token_address(&ba.pubkey(), &p.mint(0)));
    expect_anchor_err(env.send(&[ix_sell(&p, &ba.pubkey(), 0, held_a, 1)], &[&ba]), "SellsClosed");
    // Raydium relents: side B graduates on what is left.
    cfg.data[36..44].copy_from_slice(&MAINNET_POOL_FEE.to_le_bytes());
    env.svm.set_account(p.amm, cfg).unwrap();
    graduate_side(&mut env, &p, &c, 1, &[ix_register_pair(&c.pubkey(), &p.mint(1), &pb.pool, &pb.lp_mint, &p.pair)]).unwrap();
    let e = pair_state(&env, &p);
    assert_eq!(e.status, pair_curve::STATUS_GRADUATED);
    assert_eq!(env.lamports(&p.vault), vault_rent(&env));
    assert_eq!(env.config(&config_pda(&p.mint(1))).cpmm_pool, pb.pool);
}
