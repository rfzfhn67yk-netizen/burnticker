//! BLIND REVIEW PC-1 (2026-10-10) — exploit tests for docs/burnticker/reviews/2026-10-10-pair-curve-blind-1.md, reviewed commit 547558fa.
//!
//! Every `pc1_*` test below asserted that the attack succeeded at 547558fa. After the fixes on burnticker/pair-curve they are INVERTED
//! into regression tests (the attack must fail); the two controls stay as they were. The harness above the marker line is a verbatim copy of the
//! first 400 lines of tests/lifecycle.rs (run with scripts/test.sh's fixtures: `cargo test -p pair_curve --test review_pc1`).
//!
//!   H-1  pc1_h1_close_pair_after_second_graduate_strands_registration   graduate(B)+close_pair in one tx → register_pair_pool(B) impossible
//!   H-1  pc1_h1_close_pair_blocks_both_registrations                    nobody registered yet → neither side can ever register
//!   H-2  pc1_h2_executable_dev_wallet_freezes_buys_and_void_exits       dev wallet made executable after init → buy and void-exit sell fail
//!   H-2  pc1_h2_executable_flag_is_the_cause                            control: same account with executable=false trades normally
//!   M-1  pc1_m1_creator_routes_dev_fee_to_itself                        creator-pinned platform → creator receives the 25 bps
//!   L-2  pc1_l2_graduating_forever_after_stuck_side_sells_out           stuck side sold out → graduate(B) and close_pair fail forever
//!   L-3  pc1_l3_three_day_rule_fires_without_raydium                    no Raydium action, no crank for 3 days → B's sells reopen
//!   I-1  pc1_i1_zero_lamport_buy_after_mid_step_sell                    buy(max_in=0) delivers tokens for 0 lamports
//!   I-2  pc1_i2_net_budget_overflows_at_u64_max                         net_budget(u64::MAX) panics
//!
//!   (control, review §3 — not a finding) pc1_ctl_dev_wallet_may_trade_its_own_pair: duplicate writable dev wallet = buyer is accepted.

//! pair_curve integration suite (LiteSVM, in-process): the real pair_curve and burn_receipts programs, the REAL Raydium CPMM (built
//! from its pinned source, fixtures/raydium_cp_swap.so) and a hostile CPMM stand-in (mocks/evil_cpmm_init) for the post-CPI guards.
//!
//! Requires `anchor build` (target/deploy/{pair_curve,burn_receipts}.so) and scripts/test.sh's fixtures. Reuses burn_receipts' harness.

#![allow(clippy::result_large_err, clippy::too_many_arguments, dead_code, unused_imports)]

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
    // LAUNCHPAD-PATH §40: every pair is winner-takes-the-burn — link the two coins (the Pair is the witness).
    let payer_pk = env.payer.pubkey();
    env.ok(&[ix_link_pair(&payer_pk, &p.pair, &p.mint(0), &p.mint(1))], &[]);
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

// ================================================================================================================================
// blind review PC-1 attack tests (2026-10-10) — each asserts the attack SUCCEEDS at 547558fa; invert after the fix
// ================================================================================================================================

/// H-1 REGRESSION: close_pair refuses a non-Voided pair, so [graduate(B), close_pair] reverts and register_pair_pool(B) succeeds.
#[test]
fn pc1_h1_close_pair_after_second_graduate_strands_registration() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    let (pa, pb) = (pool_of(&p, 0), pool_of(&p, 1));
    graduate_side(&mut env, &p, &c, 0, &[ix_register_pair(&c.pubkey(), &p.mint(0), &pa.pool, &pa.lp_mint, &p.pair)]).unwrap();
    let atk = trader(&mut env, SOL);
    expect_anchor_err(env.send(&[ix_graduate(&p, &atk.pubkey(), 1), ix_close(&p, &atk.pubkey())], &[&atk]), "NotClosable");
    env.ok(&[ix_graduate(&p, &atk.pubkey(), 1)], &[&atk]);
    env.ok(&[ix_lock_lp(&p.pair, &p.vault, &p.mint(1), &pool_of(&p, 1), &atk.pubkey(), 1)], &[&atk]); // LAUNCHPAD-PATH §35
    env.ok(&[ix_register_pair(&c.pubkey(), &p.mint(1), &pb.pool, &pb.lp_mint, &p.pair)], &[&c]);
    assert_eq!(env.config(&config_pda(&p.mint(1))).cpmm_pool, pb.pool);
}

/// H-1 REGRESSION (both sides): nobody registered yet, the attacker graduates both and tries to close — refused; both register.
#[test]
fn pc1_h1_close_pair_blocks_both_registrations() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let atk = trader(&mut env, SOL);
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    graduate_side(&mut env, &p, &atk, 0, &[]).unwrap();
    expect_anchor_err(env.send(&[ix_graduate(&p, &atk.pubkey(), 1), ix_close(&p, &atk.pubkey())], &[&atk]), "NotClosable");
    env.ok(&[ix_graduate(&p, &atk.pubkey(), 1)], &[&atk]);
    env.ok(&[ix_lock_lp(&p.pair, &p.vault, &p.mint(1), &pool_of(&p, 1), &atk.pubkey(), 1)], &[&atk]); // LAUNCHPAD-PATH §35
    expect_anchor_err(env.send(&[ix_close(&p, &atk.pubkey())], &[&atk]), "NotClosable");
    for side in 0..2u8 {
        let pl = pool_of(&p, side);
        env.ok(&[ix_register_pair(&atk.pubkey(), &p.mint(side), &pl.pool, &pl.lp_mint, &p.pair)], &[&atk]);
        assert_eq!(env.config(&config_pda(&p.mint(side))).cpmm_pool, pl.pool);
    }
}

fn make_dev_executable(env: &mut Env, p: &P, executable: bool) {
    // a copy of a real deployed loader-v3 program account (burn_receipts) placed at the developer-wallet address
    let mut acc = env.svm.get_account(&burn_receipts::ID).unwrap();
    acc.executable = executable;
    env.svm.set_account(p.dev, acc).unwrap();
}

fn expect_lamport_spend(r: TxResult, what: &str) {
    match r {
        Ok(_) => panic!("{what}: expected the trade to fail"),
        Err(e) => assert!(format!("{:?}", e.err).contains("ExternalAccountLamportSpend"), "{what}: {:?}", e.err),
    }
}

/// H-2 REGRESSION: trades never credit the developer wallet (the 25 bps accrue in the SOL vault), so an executable wallet cannot freeze
/// buys or void exits; only claim_developer_fee waits (NothingToClaim) while the wallet cannot receive.
#[test]
fn pc1_h2_executable_dev_wallet_freezes_buys_and_void_exits() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let alice = trader(&mut env, 10 * SOL);
    env.ok(&[ix_buy(&p, &alice.pubkey(), 0, SOL, 1)], &[&alice]);
    make_dev_executable(&mut env, &p, true);
    env.ok(&[ix_buy(&p, &alice.pubkey(), 0, SOL, 1)], &[&alice]);
    let s = pair_state(&env, &p);
    env.set_time(s.deadline + 1);
    env.ok(&[ix_void(&p, &alice.pubkey())], &[&alice]);
    let held = env.token_amount(&get_associated_token_address(&alice.pubkey(), &p.mint(0)));
    env.ok(&[ix_sell(&p, &alice.pubkey(), 0, held, 1)], &[&alice]);
    let e = pair_state(&env, &p);
    assert_eq!(e.sol, [0, 0]);
    assert_eq!(env.lamports(&p.vault), vault_rent(&env) + e.dev_accrued, "the holder got everything but the developer accrual");
    let claim = Instruction::new_with_bytes(
        pair_curve::ID,
        &pair_curve::instruction::ClaimDeveloperFee {}.data(),
        pair_curve::accounts::ClaimDeveloperFee { caller: alice.pubkey(), pair: p.pair, vault: p.vault, dev_wallet: p.dev, system_program: anchor_lang::solana_program::system_program::ID, event_authority: pc_event_authority(), program: pair_curve::ID }.to_account_metas(None),
    );
    expect_anchor_err(env.send(&[claim], &[&alice]), "NothingToClaim");
}

/// H-2 control: the executable flag alone is the cause (stays green after the fix).
#[test]
fn pc1_h2_executable_flag_is_the_cause() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let alice = trader(&mut env, 10 * SOL);
    env.ok(&[ix_buy(&p, &alice.pubkey(), 0, SOL, 1)], &[&alice]);
    make_dev_executable(&mut env, &p, false);
    env.ok(&[ix_buy(&p, &alice.pubkey(), 0, SOL, 1)], &[&alice]);
    let held = env.token_amount(&get_associated_token_address(&alice.pubkey(), &p.mint(0)));
    env.ok(&[ix_sell(&p, &alice.pubkey(), 0, held / 2, 1)], &[&alice]);
}

/// M-1 REGRESSION: a creator tries to pin its own LaunchLab platform (claim wallet = itself). Since lp-lock blind review r2 (RL-3)
/// burn_receipts' initialize_token already refuses any platform but its compiled BURNTICKER_PLATFORM (PlatformNotAllowed); and
/// init_pair independently refuses a rogue platform account (PlatformMismatch) for tokens that pinned the real one.
#[test]
fn pc1_m1_creator_routes_dev_fee_to_itself() {
    let mut env = new_env();
    let (ma, mb, creator, attester) = (Keypair::new(), Keypair::new(), Keypair::new(), Keypair::new());
    env.fund(&creator.pubkey(), 10 * SOL);
    let amm = amm_config(&mut env, 0, MAINNET_POOL_FEE);
    platform_with_dev(&mut env, &amm, &Pubkey::new_unique());
    let rogue = Pubkey::new_unique();
    let mut acc = bcpmm::platform_account(&env, &amm, &Pubkey::default(), [1_000_000, 0, 0]);
    acc.data[16..48].copy_from_slice(creator.pubkey().as_ref());
    env.svm.set_account(rogue, acc).unwrap();
    let pair = pair_pda(&ma.pubkey(), &mb.pubkey());
    let vault = vault_pda(&pair);
    for m in [&ma, &mb] {
        env.create_mint_full(m, &vault, None, 6);
        let mut args = init_args(pair_rule(), vec![attester.pubkey()], 1);
        args.admin = creator.pubkey();
        let payer = env.payer.pubkey();
        let rogue_init = ix_initialize_with_platform(&payer, &creator.pubkey(), &m.pubkey(), args.clone(), Some(rogue));
        expect_anchor_err(env.send(&[rogue_init], &[&creator, m]), "PlatformNotAllowed");
        env.ok(&[ix_initialize_with_platform(&payer, &creator.pubkey(), &m.pubkey(), args, Some(TEST_LAUNCHLAB_PLATFORM))], &[&creator, m]);
    }
    let p = P { ma, mb, creator, attester, pair, vault, dev: Pubkey::default(), amm };
    let mut ix = ix_init_pair(&env, &p, default_args(env.now()));
    for k in ix.accounts.iter_mut() {
        if k.pubkey == TEST_LAUNCHLAB_PLATFORM {
            k.pubkey = rogue;
        }
    }
    expect_anchor_err(env.send(&[ix], &[&p.creator]), "PlatformMismatch");
}

/// L-2 REGRESSION: a blocked side now reaches a terminal state — after 3 days of a real Raydium block void_pair puts it into
/// pro-rata redemption; its holders exit at the snapshot (no fee) and the side ends at sold = 0, sol = 0. The Pair is kept on purpose
/// (side A's registration reads it), so close_pair stays refused.
#[test]
fn pc1_l2_graduating_forever_after_stuck_side_sells_out() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    let (_ba, bb) = fill(&mut env, &p, 50 * SOL, 40 * SOL);
    graduate_side(&mut env, &p, &c, 0, &[]).unwrap();
    let s = pair_state(&env, &p);
    let mut cfg = env.svm.get_account(&p.amm).unwrap();
    cfg.data[36..44].copy_from_slice(&(100 * SOL).to_le_bytes());
    env.svm.set_account(p.amm, cfg.clone()).unwrap();
    env.set_time(s.graduation_started_at + pair_curve::GRADUATION_STUCK_SECS);
    let held_b = env.token_amount(&get_associated_token_address(&bb.pubkey(), &p.mint(1)));
    expect_anchor_err(env.send(&[ix_sell(&p, &bb.pubkey(), 1, held_b, 1)], &[&bb]), "SellsClosed");
    env.ok(&[ix_void(&p, &c.pubkey())], &[&c]);
    env.ok(&[ix_sell(&p, &bb.pubkey(), 1, held_b, 1)], &[&bb]);
    cfg.data[36..44].copy_from_slice(&MAINNET_POOL_FEE.to_le_bytes());
    env.svm.set_account(p.amm, cfg).unwrap();
    expect_anchor_err(graduate_side(&mut env, &p, &c, 1, &[]), "SideAlreadyGraduated");
    let e = pair_state(&env, &p);
    assert!(e.refunding[1] && e.sold[1] == 0 && e.sol[1] == 0, "terminal: side B fully refunded");
    expect_anchor_err(env.send(&[ix_close(&p, &c.pubkey())], &[&c]), "NotClosable");
}

/// L-3 REGRESSION: inactivity alone (no Raydium block) never refunds side B: void_pair = NotStuck, sells stay closed.
#[test]
fn pc1_l3_three_day_rule_fires_without_raydium() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    let (_ba, bb) = fill(&mut env, &p, 50 * SOL, 40 * SOL);
    graduate_side(&mut env, &p, &c, 0, &[]).unwrap();
    let s = pair_state(&env, &p);
    let held_b = env.token_amount(&get_associated_token_address(&bb.pubkey(), &p.mint(1)));
    env.set_time(s.graduation_started_at + pair_curve::GRADUATION_STUCK_SECS + 1);
    expect_anchor_err(env.send(&[ix_void(&p, &c.pubkey())], &[&c]), "NotStuck");
    expect_anchor_err(env.send(&[ix_sell(&p, &bb.pubkey(), 1, held_b, 1)], &[&bb]), "SellsClosed");
    graduate_side(&mut env, &p, &c, 1, &[]).unwrap();
}

/// I-1 REGRESSION: a zero-cost buy (a sell left `sold` inside a ceil step) is refused (ZeroOutput).
#[test]
fn pc1_i1_zero_lamport_buy_after_mid_step_sell() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let alice = trader(&mut env, 10 * SOL);
    let bob = trader(&mut env, 10 * SOL);
    env.ok(&[ix_buy(&p, &alice.pubkey(), 0, SOL, 1)], &[&alice]);
    env.ok(&[ix_sell(&p, &alice.pubkey(), 0, 12_345, 0)], &[&alice]);
    expect_anchor_err(env.send(&[ix_buy(&p, &bob.pubkey(), 0, 0, 1)], &[&bob]), "ZeroOutput");
}

/// I-2 REGRESSION: net_budget(u64::MAX) returns (u128 arithmetic) instead of panicking.
#[test]
fn pc1_i2_net_budget_overflows_at_u64_max() {
    let n = pair_curve::math::net_budget(u64::MAX);
    assert!(n > 0 && n as u128 + pair_curve::math::fee_split(n).fee as u128 <= u64::MAX as u128);
}

/// Control (review §3, not a finding): the developer may trade its own pair (dev_wallet == buyer is an accepted duplicate).
#[test]
fn pc1_ctl_dev_wallet_may_trade_its_own_pair() {
    let mut env = new_env();
    let dev = Keypair::new();
    let mut p = prepare(&mut env, MAINNET_POOL_FEE);
    env.fund(&dev.pubkey(), 10 * SOL);
    platform_with_dev(&mut env, &p.amm, &dev.pubkey());
    p.dev = dev.pubkey();
    let args = default_args(env.now());
    env.ok(&[ix_init_pair(&env, &p, args)], &[&p.creator]);
    env.ok(&[ix_buy(&p, &dev.pubkey(), 0, SOL, 1)], &[&dev]);
}
