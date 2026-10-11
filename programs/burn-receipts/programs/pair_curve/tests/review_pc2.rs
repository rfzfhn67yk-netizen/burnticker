//! pair_curve blind review 2 (2026-10-10, commit reviewed 547558fa) — EXPLOIT TESTS for
//! docs/burnticker/reviews/2026-10-10-pair-curve-blind-2.md. The harness below is a verbatim copy of tests/lifecycle.rs's harness
//! (lines 1–397); the review's tests follow it. Each test asserted that the attack worked at 547558fa; after the fixes on
//! burnticker/pair-curve (docs/burn-receipts/CHANGELOG.md, "pair_curve review round") each one is INVERTED into a regression test:
//! the attack must fail. The budget test stays a bound.
//!
//!   H-1  pc2_prefunded_wsol_pool_vault_blocks_graduation_forever   pre-funded WSOL pool vaults → every graduate PoolMismatch → void
//!   H-1  pc2_prefund_after_first_side_strands_the_second           same, second side only → pair stuck Graduating
//!   H-1  pc2_prefunded_vault_wsol_above_rent_does_not_block         control: the vault's own WSOL ATA pre-funded does NOT block
//!   H-2  pc2_close_pair_front_runs_registration                     [graduate(B), close_pair] in one tx → register_pair_pool impossible
//!   H-3  pc2_precreated_token_vault_blocks_init_pair                ATA(vault, mint A) created after tx 1 → init_pair fails forever
//!   M-1  pc2_void_is_a_race_not_a_refund                            early buyer exits first: +7.12 SOL, late buyer −7.96 SOL
//!   L-1  pc2_burned_dust_blocks_close_after_void                    1 raw token burned → sold never 0 → close_pair NotClosable
//!   L-2  pc2_share_flip_blocks_graduation                           one weak-side sell → NotReadyToGraduate
//!   (budget) pc2_keeper_tx_budget_under_prefunding                  graduate+register with everything pre-funded: CU and trace (no finding)
//!   (L-3, L-4, M-2 and the Info items are code-reading findings with no test here.)
//!
//! Requires `anchor build` (target/deploy/{pair_curve,burn_receipts}.so) and fixtures/raydium_cp_swap.so (scripts/test.sh builds it).
//! Reuses burn_receipts' harness. Run: cargo test -p pair_curve --test review_pc2 -- --test-threads=1 --nocapture

#![allow(clippy::result_large_err, clippy::too_many_arguments, dead_code)]

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


// ================================================================================================================================
// Blind review 2 (2026-10-10) — exploit tests. Local only; not committed.
// ================================================================================================================================

fn wsol_pool_vault(p: &P, side: u8) -> Pubkey {
    let pool = pool_of(p, side);
    if pool.wsol_is_0 { pool.token_0_vault } else { pool.token_1_vault }
}

fn logs_of(r: TxResult) -> String {
    match r {
        Ok(m) => format!("OK\n{}", m.logs.join("\n")),
        Err(e) => format!("ERR {:?}\n{}", e.err, e.meta.logs.join("\n")),
    }
}

/// H-1 REGRESSION: 2 × (token-account rent + 1) lamports sent to the two CPMM WSOL pool-vault PDAs used to make every graduate fail
/// forever (PoolMismatch). Now the excess WSOL is accepted as pool liquidity (graduate.rs `prefunded_wsol`); both sides graduate.
#[test]
fn pc2_prefunded_wsol_pool_vault_blocks_graduation_forever() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    let rent165 = env.svm.minimum_balance_for_rent_exemption(165);
    for side in 0..2u8 {
        env.transfer_sol(&wsol_pool_vault(&p, side), rent165 + 1);
    }
    for side in 0..2u8 {
        let m = match graduate_side(&mut env, &p, &c, side, &[]) { Ok(m) => m, Err(e) => panic!("FIX REGRESSED: {:?}\n{}", e.err, e.meta.logs.join("\n")) };
        let ev: pair_curve::events::SideGraduated = pc_event(&m);
        assert_eq!(ev.prefunded_wsol, 1, "the extra lamport became pool WSOL");
    }
    assert_eq!(pair_state(&env, &p).status, pair_curve::STATUS_GRADUATED);
    for side in 0..2u8 {
        let pl = pool_of(&p, side);
        env.ok(&[ix_register_pair(&c.pubkey(), &p.mint(side), &pl.pool, &pl.lp_mint, &p.pair)], &[&c]);
    }
}

/// H-1 REGRESSION (second side, pre-funded after the first graduated, and before init_pair too): B still graduates.
#[test]
fn pc2_prefund_after_first_side_strands_the_second() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    let rent165 = env.svm.minimum_balance_for_rent_exemption(165);
    env.transfer_sol(&wsol_pool_vault(&p, 0), rent165 + 777); // derivable from the mint keys before any trade
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    graduate_side(&mut env, &p, &c, 0, &[]).unwrap();
    env.transfer_sol(&wsol_pool_vault(&p, 1), rent165 + 1);
    graduate_side(&mut env, &p, &c, 1, &[]).unwrap();
    assert_eq!(pair_state(&env, &p).status, pair_curve::STATUS_GRADUATED);
}

/// Control: the vault's own WSOL ATA pre-funded above rent does NOT block (wsol_before absorbs it).
#[test]
fn pc2_prefunded_vault_wsol_above_rent_does_not_block() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    env.transfer_sol(&get_associated_token_address(&p.vault, &NATIVE_MINT), 5 * SOL);
    graduate_both(&mut env, &p, &c);
    assert_eq!(pair_state(&env, &p).status, pair_curve::STATUS_GRADUATED);
}

/// H-2 REGRESSION: [graduate(B), close_pair] in one transaction used to delete the Pair before register_pair_pool(B). close_pair now
/// refuses any pair that is not Voided (NotClosable), so the attacker's transaction reverts and both sides register.
#[test]
fn pc2_close_pair_front_runs_registration() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let attacker = trader(&mut env, SOL);
    let keeper = trader(&mut env, SOL);
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    let pa = pool_of(&p, 0);
    graduate_side(&mut env, &p, &keeper, 0, &[ix_register_pair(&keeper.pubkey(), &p.mint(0), &pa.pool, &pa.lp_mint, &p.pair)]).unwrap();
    expect_anchor_err(graduate_side(&mut env, &p, &attacker, 1, &[ix_close(&p, &attacker.pubkey())]), "NotClosable");
    graduate_side(&mut env, &p, &attacker, 1, &[]).unwrap();
    expect_anchor_err(env.send(&[ix_close(&p, &attacker.pubkey())], &[&attacker]), "NotClosable");
    let pb = pool_of(&p, 1);
    env.ok(&[ix_register_pair(&keeper.pubkey(), &p.mint(1), &pb.pool, &pb.lp_mint, &p.pair)], &[&keeper]);
    assert_eq!(env.config(&config_pda(&p.mint(1))).cpmm_pool, pb.pool);
}

/// H-3 REGRESSION: ATA(vault, mint A) created by an observer of tx 1 used to make init_pair fail forever (IllegalOwner). The token
/// vaults are now `init_if_needed` + checked empty / no delegate / no close authority, so init_pair succeeds.
#[test]
fn pc2_precreated_token_vault_blocks_init_pair() {
    let mut env = new_env();
    let p = prepare(&mut env, MAINNET_POOL_FEE);
    let m = env.svm.get_account(&p.ma.pubkey()).unwrap();
    let mint = <spl_token::state::Mint as anchor_lang::solana_program::program_pack::Pack>::unpack(&m.data).unwrap();
    let vault: Pubkey = mint.mint_authority.unwrap();
    assert_eq!(vault, p.vault);
    env.create_ata(&vault, &p.ma.pubkey());
    env.create_ata(&vault, &p.mb.pubkey());
    let args = default_args(env.now());
    let ix = ix_init_pair(&env, &p, args);
    env.ok(&[ix], &[&p.creator]);
    assert_eq!(env.mint_supply(&p.ma.pubkey()), pair_curve::TOTAL_SUPPLY);
}

/// L-1 REGRESSION: a holder burns 1 raw token after the void. close_pair now counts circulating tokens from the mint supply (burned
/// tokens are gone), so it succeeds; the burned token's lamport goes to the burn pools as residue.
#[test]
fn pc2_burned_dust_blocks_close_after_void() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let t = trader(&mut env, 10 * SOL);
    env.ok(&[ix_buy(&p, &t.pubkey(), 0, SOL, 1)], &[&t]);
    let s = pair_state(&env, &p);
    env.set_time(s.deadline);
    env.ok(&[ix_void(&p, &t.pubkey())], &[&t]);
    let ata = get_associated_token_address(&t.pubkey(), &p.mint(0));
    let burn = spl_token::instruction::burn(&spl_token::ID, &ata, &p.mint(0), &t.pubkey(), &[], 1).unwrap();
    env.ok(&[burn], &[&t]);
    let held = env.token_amount(&ata);
    env.ok(&[ix_sell(&p, &t.pubkey(), 0, held, 0)], &[&t]);
    let st = pair_state(&env, &p);
    assert_eq!(st.sold, [1, 0], "one raw token is gone for good");
    env.ok(&[ix_close(&p, &t.pubkey())], &[&t]);
    assert!(env.svm.get_account(&p.pair).map(|a| a.lamports == 0).unwrap_or(true));
    assert_eq!(env.lamports(&p.vault), vault_rent(&env));
}

/// M-1 REGRESSION: the void used to be a first-come race on the curve with the 1 % fee. It is now a pro-rata redemption at the void
/// snapshot with no fee: a holder's payout does not depend on who exits first, and the side's escrowed 75 bps comes back too.
/// (Pro rata is by tokens: a cheap early buyer redeems at the same per-token rate as a late one — PAIR-CURVE.md §5.3 says so.)
#[test]
fn pc2_void_is_a_race_not_a_refund() {
    fn run(early_first: bool) -> (u64, u64, u64) {
        let mut env = new_env();
        let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
        let early = trader(&mut env, 10 * SOL);
        let late = trader(&mut env, 60 * SOL);
        let b = trader(&mut env, 10 * SOL);
        env.ok(&[ix_buy(&p, &early.pubkey(), 0, 2 * SOL, 1)], &[&early]);
        env.ok(&[ix_buy(&p, &late.pubkey(), 0, 40 * SOL, 1)], &[&late]);
        env.ok(&[ix_buy(&p, &b.pubkey(), 1, 5 * SOL, 1)], &[&b]);
        let s = pair_state(&env, &p);
        assert!(!pair_curve::math::graduation_ready(s.sol[0], s.sol[1], s.target_raise_lamports, s.min_side_share_bps));
        env.set_time(s.deadline);
        env.ok(&[ix_void(&p, &early.pubkey())], &[&early]);
        let v = pair_state(&env, &p);
        let order: [&Keypair; 2] = if early_first { [&early, &late] } else { [&late, &early] };
        let mut got = [0u64; 2];
        for k in order {
            let h = env.token_amount(&get_associated_token_address(&k.pubkey(), &p.mint(0)));
            let before = env.lamports(&k.pubkey());
            let meta = env.ok(&[ix_sell(&p, &k.pubkey(), 0, h, 0)], &[k]);
            let ev: pair_curve::events::Trade = pc_event(&meta);
            assert!(ev.redemption && ev.fee == 0);
            got[if k.pubkey() == early.pubkey() { 0 } else { 1 }] = env.lamports(&k.pubkey()) - before;
        }
        assert_eq!(got[0] + got[1], v.redeem_pool[0], "side A redeemed exactly its curve SOL + escrowed burn share");
        (got[0], got[1], v.redeem_pool[0])
    }
    let (e1, l1, pool1) = run(true);
    let (e2, l2, pool2) = run(false);
    assert_eq!(pool1, pool2);
    // order-independent up to the last holder's rounding remainder (< 1 lamport per raw token of rounding)
    assert!(e1.abs_diff(e2) <= 1 && l1.abs_diff(l2) <= 1, "early {e1} vs {e2}, late {l1} vs {l2}");
}

/// L-2 REGRESSION: the buy that makes the pair ready commits it in the same instruction, so a weak-side sell can no longer un-meet it.
#[test]
fn pc2_share_flip_blocks_graduation() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    let (_ba, bb) = fill(&mut env, &p, 64_500_000_000, 22_500_000_000);
    let s = pair_state(&env, &p);
    assert_eq!(s.status, pair_curve::STATUS_GRADUATING, "committed by the readying buy");
    let held = env.token_amount(&get_associated_token_address(&bb.pubkey(), &p.mint(1)));
    expect_anchor_err(env.send(&[ix_sell(&p, &bb.pubkey(), 1, held / 20, 1)], &[&bb]), "SellsClosed");
    graduate_both(&mut env, &p, &c);
    // and the 5,000 bps share (both raises equal to the lamport) can no longer be configured
    let mut env2 = new_env();
    let q = prepare(&mut env2, MAINNET_POOL_FEE);
    let mut args = default_args(env2.now());
    args.min_side_share_bps = 5_000;
    let ix = ix_init_pair(&env2, &q, args);
    expect_anchor_err(env2.send(&[ix], &[&q.creator]), "InvalidParams");
}

/// Budget bound (no finding): the keeper's graduate+register with every derived address pre-funded (WSOL vaults above rent too).
#[test]
fn pc2_keeper_tx_budget_under_prefunding() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    let mut targets = vec![get_associated_token_address(&p.vault, &NATIVE_MINT)];
    for side in 0..2u8 {
        let pool = pool_of(&p, side);
        targets.extend([pool.pool, pool.lp_mint, pool.token_0_vault, pool.token_1_vault, pool.observation, get_associated_token_address(&p.vault, &pool.lp_mint)]);
    }
    let above = env.svm.minimum_balance_for_rent_exemption(165) + 1_000;
    for t in &targets {
        env.transfer_sol(t, above);
    }
    for side in 0..2u8 {
        let pl = pool_of(&p, side);
        let reg = ix_register_pair(&c.pubkey(), &p.mint(side), &pl.pool, &pl.lp_mint, &p.pair);
        let m = match graduate_side(&mut env, &p, &c, side, &[reg]) { Ok(m) => m, Err(e) => panic!("{:?}\n{}", e.err, e.meta.logs.join("\n")) };
        let trace: usize = 2 + m.inner_instructions.iter().map(|v| v.len()).sum::<usize>() + 1;
        println!("keeper tx side {side}: {} CU (keeper limit 600,000), trace ≈ {trace} of 64", m.compute_units_consumed);
        assert!(m.compute_units_consumed < 400_000 && trace < 56, "budget: {} CU, trace {trace}", m.compute_units_consumed);
    }
}
