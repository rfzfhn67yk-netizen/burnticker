//! pair_curve integration suite (LiteSVM, in-process): the real pair_curve and burn_receipts programs, the REAL Raydium CPMM (built
//! from its pinned source, fixtures/raydium_cp_swap.so) and a hostile CPMM stand-in (mocks/evil_cpmm_init) for the post-CPI guards.
//!
//! Requires `anchor build` (target/deploy/{pair_curve,burn_receipts}.so) and scripts/test.sh's fixtures. Reuses burn_receipts' harness.

#![allow(clippy::result_large_err, clippy::too_many_arguments)]

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
    add_lock_program(&mut env);
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
    // the fee stays in the SOL vault, accounted: nothing reaches the developer wallet or the burn pool during trading
    assert_eq!((env.lamports(&p.dev), env.lamports(&fa)), (dev0, fa0));
    let s1 = pair_state(&env, &p);
    assert_eq!((s1.burn_escrow[0], s1.dev_accrued), (q1.fees.burn, q1.fees.dev));

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

    // Invariant: the vault holds exactly rent + F(sold_A) + F(sold_B) + the escrowed burn shares + the developer accrual.
    let s = pair_state(&env, &p);
    assert_eq!(s.sol, [sol_at(&curve, s.sold[0]).unwrap(), sol_at(&curve, s.sold[1]).unwrap()]);
    assert_eq!(env.lamports(&p.vault), vault_rent(&env) + s.owed());
    let fees_a = fee_split(q1.cost).fee + fee_split(q2.cost).fee + qs.fees.fee;
    assert_eq!(s.burn_fees_lamports[0] + s.dev_fees_lamports[0], fees_a);
    assert_eq!(s.burn_fees_lamports[1] + s.dev_fees_lamports[1], qb.fees.fee);
    assert_eq!(s.burn_escrow, s.burn_fees_lamports);
    assert_eq!(s.dev_accrued, s.dev_fees_lamports[0] + s.dev_fees_lamports[1]);
    assert_eq!((env.lamports(&fa), env.lamports(&fb)), (fa0, fb0));
    // claim_developer_fee pays the accrual to the pinned wallet, permissionlessly
    let meta = env.ok(&[ix_claim_dev(&p, &bob.pubkey())], &[&bob]);
    println!("claim_developer_fee CU: {}", meta.compute_units_consumed);
    assert_eq!(env.lamports(&p.dev) - dev0, s.dev_accrued);
    assert_eq!(pair_state(&env, &p).dev_accrued, 0);
    expect_anchor_err(env.send(&[ix_claim_dev(&p, &bob.pubkey())], &[&bob]), "NothingToClaim");
    // per trade: dev = floor(fee / 4), burn = fee − dev
    assert_eq!(s.dev_fees_lamports[0], fee_split(q1.cost).dev + fee_split(q2.cost).dev + qs.fees.dev);
    assert_eq!(s.dev_fees_lamports[1], qb.fees.dev);
}

#[test]
fn a_drained_developer_wallet_cannot_block_trades_or_exits() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    // The developer empties the wallet to 0: trades never credit it, so nothing changes for traders; only the claim waits.
    env.svm.set_account(p.dev, litesvm_account(0, vec![], anchor_lang::solana_program::system_program::ID)).unwrap();
    let alice = trader(&mut env, 10 * SOL);
    env.ok(&[ix_buy(&p, &alice.pubkey(), 0, SOL / 10, 1)], &[&alice]);
    let held = env.token_amount(&get_associated_token_address(&alice.pubkey(), &p.mint(0)));
    env.ok(&[ix_sell(&p, &alice.pubkey(), 0, held, 1)], &[&alice]);
    let s = pair_state(&env, &p);
    assert_eq!(s.sol, [0, 0]);
    assert_eq!(env.lamports(&p.vault), vault_rent(&env) + s.burn_escrow[0] + s.dev_accrued, "curve SOL drained exactly; only the fee accounts remain");
    // a sub-rent accrual cannot be paid to a 0-lamport wallet: the claim is refused, nothing else is affected
    expect_anchor_err(env.send(&[ix_claim_dev(&p, &alice.pubkey())], &[&alice]), "NothingToClaim");
    assert_eq!(env.lamports(&p.dev), 0);
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
    // B to ≥ 25 %: that buy COMMITS the pair in the same instruction (blind review 2 L-2: no window for a flip).
    let meta = env.ok(&[ix_buy(&p, &b1.pubkey(), 1, 8 * SOL, 1)], &[&b1]);
    let c: pair_curve::events::PairCommitted = pc_event(&meta);
    let s = pair_state(&env, &p);
    assert_eq!((s.status, c.raise), (pair_curve::STATUS_GRADUATING, s.sol));
    assert!(s.sol[1] * 10_000 >= 2_500 * (s.sol[0] + s.sol[1]) && s.sol[0] + s.sol[1] >= s.target_raise_lamports);
    let held_b = env.token_amount(&get_associated_token_address(&b1.pubkey(), &p.mint(1)));
    expect_anchor_err(env.send(&[ix_sell(&p, &b1.pubkey(), 1, held_b / 20, 1)], &[&b1]), "SellsClosed");

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
    println!("graduate CU: side A (decision + pool) {}, side B {}", metas[0].compute_units_consumed, metas[1].compute_units_consumed);
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
        // LAUNCHPAD-PATH §35: 100 % of the LP locked forever in Raydium's CPMM lock (lock_lp ran after graduate), the Fee Key NFT at
        // burn_receipts' FEE_KEYS PDA; nothing burned, the vault's emptied LP account closed
        assert_eq!(evs[s_].lp_minted + 100, g.lp_supply_at_creation[s_]);
        assert_eq!(g.lp_locked[s_], evs[s_].lp_minted);
        assert_eq!(env.token_amount(&lock_lp_vault(&pool.lp_mint)), g.lp_locked[s_]);
        assert_eq!(env.mint_supply(&pool.lp_mint), g.lp_locked[s_], "locked, not burned");
        let nft = fee_nft_mint(&p.pair, side);
        assert_eq!(env.token_amount(&get_associated_token_address(&fee_keys(), &nft)), 1);
        let ll = env.svm.get_account(&locked_liquidity(&nft)).unwrap();
        assert_eq!((ll.owner, &ll.data[64..96], &ll.data[96..128]), (LOCK_CPMM_PROGRAM_ID, pool.pool.as_ref(), nft.as_ref()));
        assert!(env.svm.get_account(&get_associated_token_address(&p.vault, &pool.lp_mint)).map(|a| a.lamports == 0).unwrap_or(true), "LP account closed");
        // every token the pool did not need was burned; the token vault is empty
        assert_eq!(env.token_amount(&get_associated_token_address(&p.vault, &p.mint(side))), 0);
        assert_eq!(env.mint_supply(&p.mint(side)), supply_before[s_] - g.tokens_burned[s_]);
        assert_eq!(g.tokens_burned[s_], pair_curve::TOTAL_SUPPLY - s.sold[s_] - expect_tokens[s_]);
    }
    // the vault keeps only its rent minimum and the developer accrual; the escrowed burn shares and the residue went to the burn pools
    assert_eq!(env.lamports(&p.vault), vault_rent(&env) + g.dev_accrued);
    assert!(env.svm.get_account(&get_associated_token_address(&p.vault, &NATIVE_MINT)).map(|a| a.lamports == 0).unwrap_or(true), "WSOL account closed");
    let got = [env.lamports(&fee_pda(&p.mint(0))) - fee_before[0], env.lamports(&fee_pda(&p.mint(1))) - fee_before[1]];
    let lp_rent = env.svm.minimum_balance_for_rent_exemption(165);
    assert_eq!(got, [evs[0].burn_escrow_paid + evs[0].residue_lamports + lp_rent, evs[1].burn_escrow_paid + evs[1].residue_lamports + lp_rent], "each side's escrow + residue (+ the emptied LP account's rent, at lock_lp) went to its own burn pool");
    assert_eq!([evs[0].burn_escrow_paid, evs[1].burn_escrow_paid], s.burn_escrow, "the 75 bps escrow, paid at graduation");
    assert!(evs[0].residue_lamports < SOL / 100 && evs[1].residue_lamports < SOL / 100, "residue is rent refunds and dust only");
    env.ok(&[ix_claim_dev(&p, &cranker.pubkey())], &[&cranker]);
    assert_eq!(env.lamports(&p.vault), vault_rent(&env));

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

    // The void snapshot: each side redeems its curve SOL plus its escrowed burn share, pro rata, with no fee.
    let v = pair_state(&env, &p);
    assert_eq!(v.redeem_pool, [s.sol[0] + s.burn_escrow[0], s.sol[1] + s.burn_escrow[1]]);
    assert_eq!((v.redeem_supply, v.burn_escrow), (s.sold, [0, 0]));
    // Everyone sells everything back, in an arbitrary order: the same rate for everyone (blind review 2 M-1), the last holder of a side
    // gets exactly what is left.
    for side in [1u8, 0] {
        for h in holders.iter().rev() {
            let ata = get_associated_token_address(&h.pubkey(), &p.mint(side));
            let amt = env.svm.get_account(&ata).map(|_| env.token_amount(&ata)).unwrap_or(0);
            if amt == 0 {
                continue;
            }
            let st = pair_state(&env, &p);
            let s_ = side as usize;
            let expect = if amt == st.sold[s_] { st.sol[s_] } else { (amt as u128 * v.redeem_pool[s_] as u128 / v.redeem_supply[s_] as u128) as u64 };
            let before = env.lamports(&h.pubkey());
            let meta = env.ok(&[ix_sell(&p, &h.pubkey(), side, amt, expect)], &[h]);
            let ev: pair_curve::events::Trade = pc_event(&meta);
            assert!(ev.redemption && ev.fee == 0);
            assert_eq!(env.lamports(&h.pubkey()) - before, expect);
        }
    }
    let e = pair_state(&env, &p);
    assert_eq!((e.sold, e.sol), ([0, 0], [0, 0]));
    assert_eq!(env.lamports(&p.vault), vault_rent(&env) + e.dev_accrued, "the SOL vault drained to exactly its rent minimum + the developer accrual");

    // close_pair: burns the returned supplies, closes the accounts, rent to the creator.
    let creator_before = env.lamports(&p.creator.pubkey());
    let meta = env.ok(&[ix_close(&p, &cranker.pubkey())], &[&cranker]);
    println!("close_pair (voided, burns both supplies) CU: {}", meta.compute_units_consumed);
    assert!(env.svm.get_account(&p.pair).map(|a| a.lamports == 0).unwrap_or(true));
    assert_eq!(env.mint_supply(&p.mint(0)), 0);
    assert_eq!(env.mint_supply(&p.mint(1)), 0);
    assert!(env.lamports(&p.creator.pubkey()) > creator_before);
    assert_eq!(env.lamports(&p.vault), vault_rent(&env), "close paid the developer accrual too");
    // A pair can never be re-created on those mints (no mint authority left).
    let ix = ix_init_pair(&env, &p, default_args(env.now()));
    expect_anchor_err(env.send(&[ix], &[&p.creator]), "InvalidMint");
}

/// Blind review 2 H-2 / review 1 H-1: a graduated (or graduating) pair is never closed — burn_receipts' register_pair_pool reads it.
#[test]
fn a_graduated_pair_can_never_be_closed() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    expect_anchor_err(env.send(&[ix_close(&p, &c.pubkey())], &[&c]), "NotClosable");
    graduate_side(&mut env, &p, &c, 0, &[]).unwrap();
    expect_anchor_err(env.send(&[ix_close(&p, &c.pubkey())], &[&c]), "NotClosable");
    graduate_side(&mut env, &p, &c, 1, &[]).unwrap();
    expect_anchor_err(env.send(&[ix_close(&p, &c.pubkey())], &[&c]), "NotClosable");
    for side in 0..2u8 {
        let pl = pool_of(&p, side);
        env.ok(&[ix_register_pair(&c.pubkey(), &p.mint(side), &pl.pool, &pl.lp_mint, &p.pair)], &[&c]);
    }
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
        env.svm.add_program(pair_curve::ID, &read_so("target/deploy-localnet/pair_curve.so")).unwrap();
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
        let st = pair_state(&env, &p);
        assert_eq!((st.status, st.pools), (pair_curve::STATUS_GRADUATING, [Pubkey::default(); 2]), "mode {mode}: committed by the last buy, no pool created");
    }
}

#[test]
fn the_idl_has_no_admin_withdraw_or_parameter_update() {
    let idl: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(format!("{}/../../target/idl/pair_curve.json", env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap();
    let names: Vec<String> = idl["instructions"].as_array().unwrap().iter().map(|i| i["name"].as_str().unwrap().to_string()).collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(sorted, ["buy", "claim_developer_fee", "close_pair", "graduate", "init_pair", "lock_lp", "sell", "void_pair"]);
    for ix in idl["instructions"].as_array().unwrap() {
        let signers: Vec<&str> = ix["accounts"].as_array().unwrap().iter().filter(|a| a["signer"].as_bool().unwrap_or(false)).map(|a| a["name"].as_str().unwrap()).collect();
        let expected: &[&str] = match ix["name"].as_str().unwrap() {
            "init_pair" => &["payer", "creator"],
            "buy" => &["buyer"],
            "sell" => &["seller"],
            "graduate" | "lock_lp" => &["cranker"],
            "void_pair" | "close_pair" | "claim_developer_fee" => &["caller"],
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
    // above the token-account rent, so the WSOL pool vaults turn the excess into WSOL (blind review 2 H-1) — accepted as pool liquidity
    let above_rent = env.svm.minimum_balance_for_rent_exemption(165) + 1_000_000;
    for t in &targets {
        env.transfer_sol(t, above_rent);
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
    assert_eq!(env.lamports(&p.vault), vault_rent(&env) + pair_state(&env, &p).dev_accrued);
    assert!(evs.iter().all(|e| e.prefunded_wsol == 1_000_000), "the pre-funded WSOL became pool liquidity");
}

/// Between the two graduate calls the pair is committed: curves closed, no void, side A registrable, side B still to create (even after
/// the deadline). Inactivity alone never refunds B (blind review 1 L-3); only a Raydium block lasting 3 days lets `void_pair` put B into
/// pro-rata redemption (review 1 L-2: a terminal state for B), and then B can no longer graduate.
#[test]
fn graduating_commits_the_pair_and_only_a_real_raydium_block_refunds_the_second_side() {
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
    // 3 days of inactivity, no Raydium block: no refund
    env.set_time(s.graduation_started_at + pair_curve::GRADUATION_STUCK_SECS + 10);
    expect_anchor_err(env.send(&[ix_void(&p, &c.pubkey())], &[&c]), "NotStuck");
    // Raydium raises the create-pool fee above side B's raise: still 3 days are needed from the commit (already passed here) — refund
    let mut cfg = env.svm.get_account(&p.amm).unwrap();
    cfg.data[36..44].copy_from_slice(&(100 * SOL).to_le_bytes());
    env.svm.set_account(p.amm, cfg.clone()).unwrap();
    expect_anchor_err(graduate_side(&mut env, &p, &c, 1, &[]), "InsufficientPoolSol");
    let before = pair_state(&env, &p);
    let meta = env.ok(&[ix_void(&p, &c.pubkey())], &[&c]);
    let ev: pair_curve::events::PairVoided = pc_event(&meta);
    assert_eq!(ev.side, 1);
    let r = pair_state(&env, &p);
    assert!(r.refunding[1] && !r.refunding[0]);
    assert_eq!(r.redeem_pool[1], before.sol[1] + before.burn_escrow[1]);
    let b0 = env.lamports(&bb.pubkey());
    env.ok(&[ix_sell(&p, &bb.pubkey(), 1, held_b, 0)], &[&bb]);
    assert_eq!(env.lamports(&bb.pubkey()) - b0, r.redeem_pool[1], "B's only holder redeems the whole side: curve SOL + its burn escrow, no fee");
    let held_a = env.token_amount(&get_associated_token_address(&ba.pubkey(), &p.mint(0)));
    expect_anchor_err(env.send(&[ix_sell(&p, &ba.pubkey(), 0, held_a, 1)], &[&ba]), "SellsClosed");
    // Raydium relents: B is refunding, it can no longer graduate; the pair keeps its record (A stays registered)
    cfg.data[36..44].copy_from_slice(&MAINNET_POOL_FEE.to_le_bytes());
    env.svm.set_account(p.amm, cfg).unwrap();
    expect_anchor_err(graduate_side(&mut env, &p, &c, 1, &[]), "SideAlreadyGraduated");
    expect_anchor_err(env.send(&[ix_close(&p, &c.pubkey())], &[&c]), "NotClosable");
    let e = pair_state(&env, &p);
    assert_eq!((e.sold[1], e.sol[1]), (0, 0));
    assert_eq!(env.lamports(&p.vault), vault_rent(&env) + e.dev_accrued);
}

/// The review items without a reviewer-written test: R1 L-1 (the commit needs BOTH sides payable at the current AmmConfig), R2 H-3's
/// refusal half (a pre-created vault account that is not pristine), R1 H-2's claim side (refused while the wallet cannot receive,
/// nothing else affected) and R1 I-3 (an executable creator cannot block close_pair: the rent goes to burn pool A).
#[test]
fn review_followups_commit_needs_both_sides_payable_tampered_vault_claim_and_executable_creator() {
    // R2 H-3 refusal half: a pre-created vault ATA with a delegate (only reachable by forging the account) is refused
    let mut env = new_env();
    let p = prepare(&mut env, MAINNET_POOL_FEE);
    let ata = env.create_ata(&p.vault, &p.ma.pubkey());
    let clean = env.svm.get_account(&ata).unwrap();
    let mut forged = clean.clone();
    forged.data[72..76].copy_from_slice(&1u32.to_le_bytes());
    forged.data[76..108].copy_from_slice(Pubkey::new_unique().as_ref());
    env.svm.set_account(ata, forged).unwrap();
    expect_anchor_err(env.send(&[ix_init_pair(&env, &p, default_args(env.now()))], &[&p.creator]), "VaultAccountTampered");
    env.svm.set_account(ata, clean).unwrap();
    env.ok(&[ix_init_pair(&env, &p, default_args(env.now()))], &[&p.creator]);

    // R1 L-1: Raydium's fee rises so side B could not pay for its pool — no trade commits, and graduate(A) is refused
    let mut cfg = env.svm.get_account(&p.amm).unwrap();
    let raised = 45 * SOL;
    cfg.data[36..44].copy_from_slice(&raised.to_le_bytes());
    env.svm.set_account(p.amm, cfg.clone()).unwrap();
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    let s = pair_state(&env, &p);
    assert_eq!(s.status, pair_curve::STATUS_OPEN, "ready by raise and share, but B cannot pay at the current fee: not committed");
    let c = trader(&mut env, SOL);
    expect_anchor_err(graduate_side(&mut env, &p, &c, 0, &[]), "OtherSideCannotGraduate");
    cfg.data[36..44].copy_from_slice(&MAINNET_POOL_FEE.to_le_bytes());
    env.svm.set_account(p.amm, cfg).unwrap();
    graduate_side(&mut env, &p, &c, 0, &[]).unwrap();
    graduate_side(&mut env, &p, &c, 1, &[]).unwrap();
    assert_eq!(pair_state(&env, &p).status, pair_curve::STATUS_GRADUATED);

    // R1 H-2 claim side: an executable developer wallet only defers the claim; the accrual stays, then pays exactly once
    let accrued = pair_state(&env, &p).dev_accrued;
    assert!(accrued > 0);
    let wallet = env.svm.get_account(&p.dev).unwrap();
    // a copy of a deployed program account placed at the developer-wallet address (as in review_pc1)
    let program_acc = env.svm.get_account(&burn_receipts::ID).unwrap();
    env.svm.set_account(p.dev, program_acc.clone()).unwrap();
    expect_anchor_err(env.send(&[ix_claim_dev(&p, &c.pubkey())], &[&c]), "NothingToClaim");
    assert_eq!(pair_state(&env, &p).dev_accrued, accrued);
    env.svm.set_account(p.dev, wallet).unwrap();
    let d0 = env.lamports(&p.dev);
    env.ok(&[ix_claim_dev(&p, &c.pubkey())], &[&c]);
    assert_eq!(env.lamports(&p.dev) - d0, accrued);
    assert_eq!(env.lamports(&p.vault), vault_rent(&env), "after both pools and the claim the vault holds only its rent minimum");
    expect_anchor_err(env.send(&[ix_claim_dev(&p, &c.pubkey())], &[&c]), "NothingToClaim");

    // R1 I-3: a voided pair whose creator is executable still closes; the rent goes to burn pool A
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |a| a.deadline = a.deadline - 86_400 + 600);
    let c = trader(&mut env, SOL);
    env.set_time(pair_state(&env, &p).deadline);
    env.ok(&[ix_void(&p, &c.pubkey())], &[&c]);
    let program_acc = env.svm.get_account(&burn_receipts::ID).unwrap();
    env.svm.set_account(p.creator.pubkey(), program_acc).unwrap();
    let (creator0, burn_a0) = (env.lamports(&p.creator.pubkey()), env.lamports(&fee_pda(&p.mint(0))));
    let rent_back = env.lamports(&p.pair) + env.lamports(&get_associated_token_address(&p.vault, &p.mint(0))) + env.lamports(&get_associated_token_address(&p.vault, &p.mint(1)));
    env.ok(&[ix_close(&p, &c.pubkey())], &[&c]);
    assert_eq!(env.lamports(&p.creator.pubkey()), creator0);
    assert_eq!(env.lamports(&fee_pda(&p.mint(0))) - burn_a0, rent_back);
}

/// ChatGPT PR review (Low, retryable grief): somebody creates the pair vault's WSOL ATA and sends it plain lamports WITHOUT SyncNative.
/// graduate syncs before it samples the account, so the donation is just residue (swept to the side's burn pool) and graduation
/// succeeds on the first try, for both sides (the ATA is re-created and donated to again before side B).
#[test]
fn an_unsynced_lamport_donation_to_the_vault_wsol_account_does_not_block_graduation() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    let wsol = get_associated_token_address(&p.vault, &NATIVE_MINT);
    for side in 0..2u8 {
        if env.svm.get_account(&wsol).map(|a| a.lamports == 0).unwrap_or(true) {
            env.create_ata(&p.vault, &NATIVE_MINT);
        }
        env.transfer_sol(&wsol, 1_000_000);
        assert_eq!(env.token_amount(&wsol), 0, "the donation is not synced: the token amount still reads 0");
        let m = graduate_side(&mut env, &p, &c, side, &[]).unwrap();
        let ev: pair_curve::events::SideGraduated = pc_event(&m);
        assert!(ev.residue_lamports >= 1_000_000, "the donation came back as residue to the burn pool");
    }
    assert_eq!(pair_state(&env, &p).status, pair_curve::STATUS_GRADUATED);
    assert_eq!(env.lamports(&p.vault), vault_rent(&env) + pair_state(&env, &p).dev_accrued);
}

/// LAUNCHPAD-PATH §35 on pair_curve: graduate keeps the LP in the vault; lock_lp (permissionless, once, only after graduate) locks all
/// of it in Raydium's CPMM lock with the Fee Key at burn_receipts' FEE_KEYS PDA; register_pair_pool refuses the pool until then;
/// burn_receipts' register_fee_key + claim_lock_fees then serve the pair pool exactly as a LaunchLab pool: 80 % of the SOL side to the
/// side's burn pool, 20 % to the compiled treasury, the coin side burned.
#[test]
fn graduation_lp_is_locked_forever_and_its_fees_are_claimed_80_20_with_the_coin_side_burned() {
    let mut env = new_env();
    use_localnet_burn_receipts(&mut env);
    let treasury = Pubkey::new_from_array([0x7e; 32]);
    env.fund(&treasury, SOL);
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, 2 * SOL);
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    let pa = pool_of(&p, 0);
    expect_anchor_err(env.send(&[ix_lock_lp(&p.pair, &p.vault, &p.mint(0), &pa, &c.pubkey(), 0)], &[&c]), "NothingToLock");
    // graduate alone: the LP is in the vault's LP account, not burned, not yet locked
    let m = env.ok(&[ix_graduate(&p, &c.pubkey(), 0)], &[&c]);
    let ev: pair_curve::events::SideGraduated = pc_event(&m);
    let vault_lp = get_associated_token_address(&p.vault, &pa.lp_mint);
    assert_eq!(env.token_amount(&vault_lp), ev.lp_minted);
    assert_eq!(pair_state(&env, &p).lp_locked[0], 0);
    expect_anchor_err(env.send(&[ix_register_pair(&c.pubkey(), &p.mint(0), &pa.pool, &pa.lp_mint, &p.pair)], &[&c]), "LpNotLocked");
    // lock_lp: everything into the lock, the Fee Key to FEE_KEYS, the vault keeps every lamport
    let vault_before = env.lamports(&p.vault);
    let m = env.ok(&[ix_lock_lp(&p.pair, &p.vault, &p.mint(0), &pa, &c.pubkey(), 0)], &[&c]);
    println!("lock_lp CU: {}", m.compute_units_consumed);
    let lk: pair_curve::events::LpLocked = pc_event(&m);
    let nft = fee_nft_mint(&p.pair, 0);
    assert_eq!((lk.lp_amount, lk.fee_nft_mint, lk.locked_liquidity), (ev.lp_minted, nft, locked_liquidity(&nft)));
    assert_eq!(env.lamports(&p.vault), vault_before);
    assert_eq!(env.token_amount(&lock_lp_vault(&pa.lp_mint)), ev.lp_minted);
    assert_eq!(pair_state(&env, &p).lp_locked[0], ev.lp_minted);
    expect_anchor_err(env.send(&[ix_lock_lp(&p.pair, &p.vault, &p.mint(0), &pa, &c.pubkey(), 0)], &[&c]), "NothingToLock");
    env.ok(&[ix_register_pair(&c.pubkey(), &p.mint(0), &pa.pool, &pa.lp_mint, &p.pair)], &[&c]);
    graduate_side(&mut env, &p, &c, 1, &[]).unwrap();

    // trading on the pair pool accrues LP fees; the claim splits them
    let now = env.now();
    env.set_time(now + 60);
    let t = trader(&mut env, 50 * SOL);
    env.create_ata(&t.pubkey(), &p.mint(0));
    for _ in 0..4 {
        env.wrap_sol(&t, 2 * SOL);
        bcpmm::swap(&mut env, &t, &pa, &p.mint(0), true, 2 * SOL).unwrap();
        let got = env.token_amount(&get_associated_token_address(&t.pubkey(), &p.mint(0)));
        bcpmm::swap(&mut env, &t, &pa, &p.mint(0), false, got).unwrap();
    }
    env.ok(&[ix_register_fee_key(&c.pubkey(), &p.mint(0), &pa.pool, &nft)], &[&c]);
    let (fee0, tre0, supply0) = (env.lamports(&fee_pda(&p.mint(0))), env.lamports(&treasury), env.mint_supply(&p.mint(0)));
    let m = env.ok(&[ix_claim_lock_fees(&c.pubkey(), &p.mint(0), &pa, &nft, &treasury, u64::MAX)], &[&c]);
    let cl: burn_receipts::events::LockFeesClaimed = pc_event_br(&m);
    println!("claim_lock_fees on a pair pool: {} CU; wsol {} → {} / {}; burned {}", m.compute_units_consumed, cl.wsol_claimed, cl.to_burn_pool, cl.to_operator, cl.tokens_burned);
    assert!(cl.wsol_claimed > 0 && cl.tokens_burned > 0);
    assert_eq!(cl.to_operator, cl.wsol_claimed / 5);
    assert_eq!(env.lamports(&fee_pda(&p.mint(0))) - fee0, cl.to_burn_pool);
    assert_eq!(env.lamports(&treasury) - tre0, cl.to_operator);
    assert_eq!(supply0 - env.mint_supply(&p.mint(0)), cl.tokens_burned);
    // the LP stays locked (only the fee portion of LP left the lock); nobody can take the principal
    assert!(env.token_amount(&lock_lp_vault(&pa.lp_mint)) < ev.lp_minted && env.token_amount(&lock_lp_vault(&pa.lp_mint)) > ev.lp_minted * 99 / 100);
}

fn pc_event_br<E: Discriminator + AnchorDeserialize>(meta: &litesvm::types::TransactionMetadata) -> E {
    events(meta).into_iter().find(|(d, _)| d[..] == E::DISCRIMINATOR[..]).map(|(_, p)| E::try_from_slice(&p).unwrap()).expect("burn_receipts event")
}
