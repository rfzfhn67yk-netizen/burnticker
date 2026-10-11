//! Pair-forward RE-CHECK (2026-10-11) of the round-2 fixes — the pair_curve (policy-2) half of the new tests for
//! docs/burnticker/reviews/2026-10-11-pair-forward-recheck.md. The harness below is a verbatim copy of tests/review_pc1.rs's.
//!
//!   RN-1 (High)  unlink_pair's UNLINK_NOT_LIVE starts its 30 days at the PAIRING (link_pair, right after init_pair), while a pair_curve
//!                curve may stay Open up to 90 days. 30 days into an Open curve anyone (and the keeper's own pairUnlinkStep) can unlink
//!                the pair. link_pair then refuses to re-pair once either coin has a reading (PairHasReadings), and register_pair_pool
//!                requires PAIR_STATE_PAIRED — so after graduation neither side can ever register its pool: both coins' burn engines
//!                never start and their fee PDAs (graduation burn escrow, every later deposit) are frozen with no withdraw path.
//!
//!   `rn1_*_must_*` asserts the SAFE behaviour and is #[ignore]d (it FAILS at 9d81ee5e); `rn1_still_*` asserts today's behaviour and
//!   passes (invert it with the fix).
//!
//! Run: scripts/test.sh builds the fixtures; then
//!   cargo test -p pair_curve --test review_pair_r2 -- --include-ignored --test-threads=1 --nocapture

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


// ================================================================================================================================
// RN-1 — an Open pair_curve pair unlinked 30 days after link_pair can never register its pools
// ================================================================================================================================

const DAY: i64 = 86_400;
/// A reading date on or before the harness clock (NOW = 2026-10-09 12:00 UTC).
const R0: u32 = 20261009;

/// A pair whose curve runs 60 days (pair_curve allows up to 90). link_pair ran right after init_pair (setup). Coin A has one reading
/// before graduation — the baseline the keeper attests when the coin's first receipt settles (any reading does: link_pair counts
/// `readings`). 30 days after the link, the curve still Open, someone sends unlink_pair with no evidence account.
fn open_pair_unlink_attempt(env: &mut Env) -> (P, Keypair, TxResult) {
    let p = setup(env, MAINNET_POOL_FEE, |a| a.deadline += 59 * DAY);
    let paired_at = pair_link(env, &p.mint(0)).expect("linked by setup").paired_at;
    submit(env, &p.mint(0), R0, V1, &[&p.attester]).unwrap();
    assert_eq!(env.config(&config_pda(&p.mint(0))).readings, 1);
    env.set_time(paired_at + PAIR_UNLINK_NOT_LIVE_SECS);
    let s = pair_state(env, &p);
    assert!(s.status == pair_curve::STATUS_OPEN && env.now() < s.deadline, "the curve is still open and healthy");
    let c = trader(env, 2 * SOL);
    let r = env.send(&[ix_unlink_pair(&c.pubkey(), &p.mint(0), &p.mint(1), None)], &[&c]);
    (p, c, r)
}

/// RN-1, the SAFE behaviour (#[ignore]: FAILS at 9d81ee5e). Whatever happens to the pairing while the curve is open, once the pair
/// commits and both sides graduate (LP locked), both coins must be able to register their pools — else their fee PDAs are frozen.
#[test]
#[ignore = "RN-1 (High): fails at 9d81ee5e — an Open pair unlinked 30 days after link_pair can never register its pools"]
fn rn1_an_open_pair_unlinked_after_30_days_must_still_register_both_pools() {
    let mut env = new_env();
    let (p, c, unlink) = open_pair_unlink_attempt(&mut env);
    println!("unlink_pair on an Open pair, 30 days after link: {}", if unlink.is_ok() { "ACCEPTED (UNLINK_NOT_LIVE)".to_string() } else { format!("{:?}", unlink.as_ref().err().map(|e| &e.err)) });
    // anyone may try to re-pair (the keeper's pairCurveCrank does, every cycle)
    let payer = env.payer.pubkey();
    let relink = env.send(&[ix_link_pair(&payer, &p.pair, &p.mint(0), &p.mint(1))], &[]);
    println!("link_pair after the unlink: {}", if relink.is_ok() { "ok".to_string() } else { format!("{:?}", relink.as_ref().err().map(|e| e.meta.logs.iter().find(|l| l.contains("Error Code")).cloned())) });
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    graduate_both(&mut env, &p, &c);
    for side in 0..2u8 {
        let pool = pool_of(&p, side);
        let r = env.send(&[ix_register_pair(&c.pubkey(), &p.mint(side), &pool.pool, &pool.lp_mint, &p.pair)], &[&c]);
        assert!(r.is_ok(), "side {side}: register_pair_pool must succeed after graduation, got {:?}", r.err().map(|e| e.meta.logs.into_iter().find(|l| l.contains("Error Code"))));
        assert!(env.config(&config_pda(&p.mint(side))).pool_verified);
    }
}

/// RN-1, TODAY's behaviour (passes; invert with the fix): the unlink is accepted on a healthy Open pair, the re-link is refused
/// (PairHasReadings), and after graduation register_pair_pool refuses both sides (PairNotLinked) — with the graduation burn escrow
/// already sitting in each coin's fee PDA, which has no withdraw path and can now never be cranked.
#[test]
fn rn1_still_an_open_pair_unlinked_after_30_days_freezes_both_fee_pdas() {
    let mut env = new_env();
    let (p, c, unlink) = open_pair_unlink_attempt(&mut env);
    let meta = unlink.expect("unlink_pair accepted on a healthy, Open pair");
    let (_, ev) = events(&meta).into_iter().find(|(d, _)| d[..] == <burn_receipts::events::PairUnlinked as Discriminator>::DISCRIMINATOR[..]).expect("PairUnlinked");
    let ev = <burn_receipts::events::PairUnlinked as AnchorDeserialize>::try_from_slice(&ev).unwrap();
    assert_eq!(ev.reason, UNLINK_NOT_LIVE);
    for side in 0..2u8 {
        assert_eq!(env.config(&config_pda(&p.mint(side))).pair_state, PAIR_STATE_NONE);
    }
    let payer = env.payer.pubkey();
    expect_anchor_err(env.send(&[ix_link_pair(&payer, &p.pair, &p.mint(0), &p.mint(1))], &[]), "PairHasReadings");
    let fee0 = [env.lamports(&fee_pda(&p.mint(0))), env.lamports(&fee_pda(&p.mint(1)))];
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    graduate_both(&mut env, &p, &c);
    for side in 0..2u8 {
        let pool = pool_of(&p, side);
        expect_anchor_err(env.send(&[ix_register_pair(&c.pubkey(), &p.mint(side), &pool.pool, &pool.lp_mint, &p.pair)], &[&c]), "PairNotLinked");
        let fee = env.lamports(&fee_pda(&p.mint(side)));
        println!("side {side}: fee PDA {} → {} lamports at graduation; pool never registrable", fee0[side as usize], fee);
        assert!(!env.config(&config_pda(&p.mint(side))).pool_verified);
    }
    // the Pair is Graduated; no unlink evidence changes anything now, and link_pair stays refused
    assert_eq!(pair_state(&env, &p).status, pair_curve::STATUS_GRADUATED);
    expect_anchor_err(env.send(&[ix_link_pair(&payer, &p.pair, &p.mint(0), &p.mint(1))], &[]), "PairHasReadings");
}
