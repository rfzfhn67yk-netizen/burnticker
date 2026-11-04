//! pair_curve RE-CHECK of the blind-review fixes (2026-10-10, commit reviewed 4eda2e3d on burnticker/pair-curve; program sources as of
//! fa8627a4) — new exploit / behaviour tests for docs/burnticker/reviews/2026-10-10-pair-curve-recheck.md. The harness is a verbatim
//! copy of tests/review_pc2.rs's (itself lifecycle.rs's). Every test ASSERTS CURRENT BEHAVIOUR (they pass today); a test whose name
//! says `still` documents a residual the fix did not close, so a future fix will make it fail and it must then be inverted.
//!
//!   ROUND 2 (2026-10-10 night): RC-1, RC-2, RC-3 and RC-5 are FIXED; their tests below keep their names and now assert the fix.
//!
//!   RC-1  (R2 M-1, partly fixed)  pc3_m1_still_a_race_curve_sell_after_deadline_front_runs_the_void
//!         At/after the deadline the pair is certain to void, but until someone calls void_pair it is Open and curve sells pay the top
//!         of the curve: the reviewer's early-vs-late scenario still nets the early buyer far more than its pro-rata share.
//!   RC-2  (R1 L-2/L-3 fix, liveness residual)  pc3_l3_still_locked_when_cpmm_refuses_without_an_amm_config_signal
//!         The stuck-side refund needs an AmmConfig signal (disabled or fee too high). A CPMM-side refusal that leaves the AmmConfig
//!         alone (simulated by a changed CPMM program) keeps side B's holders locked: no graduate, no refund, no sell — 30 days later.
//!   RC-3  (R1 L-2 fix, Info)  pc3_void_stuck_side_needs_the_payable_side_graduated_first
//!         Both pools missing, Raydium's fee rises so only B cannot pay: void_pair inspects side A first and says NotStuck until
//!         someone graduates A (permissionless, so not a lock — but the refund path depends on A's graduation succeeding).
//!   RC-4  (R2 H-1 fix)  pc3_h1_prefunded_wsol_is_a_donation_the_donor_cannot_recover
//!         A holder pre-funds its side's WSOL pool vault to skew the opening price up, then sells into the pool: it recovers less than
//!         it donated (the "accept >= and pool the excess" rule is not profitable to abuse).
//!   RC-5  (R1 I-3 / R1 H-2 claim, Info)  pc3_executable_dev_wallet_still_blocks_close_pair
//!         With an accrual outstanding, an executable developer wallet makes claim_developer_fee NothingToClaim and close_pair
//!         NotClosable (rent only; trades and redemptions are unaffected).
//!   RC-6  (R2 M-1 / L-1 rounding)  pc3_redemption_chunking_and_last_unit_never_beat_pro_rata
//!         Exiting in many chunks pays at most the one-shot pro-rata amount; the side drains to exactly 0; the accounting identity
//!         vault = rent + Σsol + Σescrow + dev holds after every step.
//!
//! Run: scripts/test.sh builds the fixtures; then cargo test -p pair_curve --test review_pc3 -- --test-threads=1 --nocapture

#![allow(clippy::result_large_err, clippy::too_many_arguments, dead_code)]

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



// ================================================================================================================================
// Re-check (2026-10-10) — tests asserting CURRENT behaviour of the fixed program
// ================================================================================================================================

const DAY: i64 = 86_400;

fn wsol_pool_vault(p: &P, side: u8) -> Pubkey {
    let pool = pool_of(p, side);
    if pool.wsol_is_0 { pool.token_0_vault } else { pool.token_1_vault }
}

fn ix_claim(p: &P, caller: &Pubkey) -> Instruction {
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

/// vault = rent + Σ sol + Σ burn_escrow + dev_accrued (PAIR-CURVE.md §8 item 2).
fn assert_identity(env: &Env, p: &P, at: &str) {
    let s = pair_state(env, p);
    assert_eq!(env.lamports(&p.vault), vault_rent(env) + s.owed(), "accounting identity broken {at}: {s:?}", s = (s.sol, s.burn_escrow, s.dev_accrued));
}

fn held(env: &Env, k: &Pubkey, mint: &Pubkey) -> u64 {
    env.token_amount(&get_associated_token_address(k, mint))
}

fn set_pool_fee(env: &mut Env, p: &P, fee: u64) {
    let mut cfg = env.svm.get_account(&p.amm).unwrap();
    cfg.data[36..44].copy_from_slice(&fee.to_le_bytes());
    env.svm.set_account(p.amm, cfg).unwrap();
}

/// RC-1 REGRESSION (R2 M-1 residual, fixed). The reviewer's scenario: early buyer 2 SOL on A, late buyer 40 SOL on A, B at 5 SOL, so
/// the pair can only void. At/after the deadline a CURVE sell is now refused (DeadlinePassed): the early buyer cannot take the top of
/// the curve ahead of the void. Whoever calls void_pair first, both holders then redeem pro rata, and the outcome is the same either
/// way (the void-first numbers of the original run).
#[test]
fn pc3_m1_still_a_race_curve_sell_after_deadline_front_runs_the_void() {
    fn run(early_tries_curve_sell: bool) -> (i128, i128) {
        let mut env = new_env();
        let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
        let early = trader(&mut env, 10 * SOL);
        let late = trader(&mut env, 60 * SOL);
        let b = trader(&mut env, 10 * SOL);
        let (e0, l0) = (env.lamports(&early.pubkey()) as i128, env.lamports(&late.pubkey()) as i128);
        env.ok(&[ix_buy(&p, &early.pubkey(), 0, 2 * SOL, 1)], &[&early]);
        env.ok(&[ix_buy(&p, &late.pubkey(), 0, 40 * SOL, 1)], &[&late]);
        env.ok(&[ix_buy(&p, &b.pubkey(), 1, 5 * SOL, 1)], &[&b]);
        let s = pair_state(&env, &p);
        assert_eq!(s.status, pair_curve::STATUS_OPEN);
        env.set_time(s.deadline);
        expect_anchor_err(env.send(&[ix_buy(&p, &late.pubkey(), 1, SOL, 1)], &[&late]), "DeadlinePassed");
        let he = held(&env, &early.pubkey(), &p.mint(0));
        if early_tries_curve_sell {
            expect_anchor_err(env.send(&[ix_sell(&p, &early.pubkey(), 0, he, 0)], &[&early]), "DeadlinePassed");
            // the late holder voids; the early holder can only redeem now
            env.ok(&[ix_void(&p, &late.pubkey())], &[&late]);
            let m = env.ok(&[ix_sell(&p, &early.pubkey(), 0, he, 0)], &[&early]);
            let ev: pair_curve::events::Trade = pc_event(&m);
            assert!(ev.redemption && ev.fee == 0);
        } else {
            env.ok(&[ix_void(&p, &early.pubkey())], &[&early]);
            env.ok(&[ix_sell(&p, &early.pubkey(), 0, he, 0)], &[&early]);
        }
        assert_identity(&env, &p, "after the void");
        let hl = held(&env, &late.pubkey(), &p.mint(0));
        env.ok(&[ix_sell(&p, &late.pubkey(), 0, hl, 0)], &[&late]);
        assert_identity(&env, &p, "after the exits");
        (env.lamports(&early.pubkey()) as i128 - e0, env.lamports(&late.pubkey()) as i128 - l0)
    }
    let (e_fixed, l_fixed) = run(false);
    let (e_try, l_try) = run(true);
    println!("void first: early {e_fixed:+} late {l_fixed:+}; curve sell attempted first: early {e_try:+} late {l_try:+} lamports");
    // identical up to the transaction fee of the refused attempt (5,000 lamports) and who paid the void's fee
    assert!((e_try - e_fixed).abs() <= 20_000 && (l_try - l_fixed).abs() <= 20_000, "no race left: the order of calls changes nothing");
}

/// RC-2 REGRESSION (fixed). After graduate(A), CPMM stops accepting pair_curve's `initialize` for B without any AmmConfig change
/// (mocks/evil_cpmm_init at CPMM's id). Before 30 days the refund still needs an AmmConfig signal (NotStuck); at 30 days after the
/// commit the unconditional fallback refunds B, and B's holder redeems the whole side (curve SOL + escrow, no fee). A stays Graduating
/// with its pool; the Pair is kept (never closable — A's registration reads it).
#[test]
fn pc3_l3_still_locked_when_cpmm_refuses_without_an_amm_config_signal() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    let (_ba, bb) = fill(&mut env, &p, 50 * SOL, 40 * SOL);
    graduate_side(&mut env, &p, &c, 0, &[]).unwrap();
    env.svm.add_program(CPMM_PROGRAM_ID, &read_so("fixtures/evil_cpmm_init.so")).unwrap();
    assert!(graduate_side(&mut env, &p, &c, 1, &[]).is_err(), "CPMM refuses side B's pool");
    let s = pair_state(&env, &p);
    env.set_time(s.graduation_started_at + pair_curve::GRADUATION_FALLBACK_SECS - 1);
    expect_anchor_err(env.send(&[ix_void(&p, &c.pubkey())], &[&c]), "NotStuck");
    let hb = held(&env, &bb.pubkey(), &p.mint(1));
    expect_anchor_err(env.send(&[ix_sell(&p, &bb.pubkey(), 1, hb, 0)], &[&bb]), "SellsClosed");
    env.set_time(s.graduation_started_at + pair_curve::GRADUATION_FALLBACK_SECS);
    let m = env.ok(&[ix_void(&p, &c.pubkey())], &[&c]);
    let ev: pair_curve::events::PairVoided = pc_event(&m);
    assert_eq!(ev.side, 1);
    let r = pair_state(&env, &p);
    assert!(r.refunding[1] && !r.refunding[0] && r.status == pair_curve::STATUS_GRADUATING);
    let b0 = env.lamports(&bb.pubkey());
    env.ok(&[ix_sell(&p, &bb.pubkey(), 1, hb, 0)], &[&bb]);
    assert_eq!(env.lamports(&bb.pubkey()) - b0, r.redeem_pool[1]);
    assert_identity(&env, &p, "after B's fallback refund");
    expect_anchor_err(env.send(&[ix_close(&p, &c.pubkey())], &[&c]), "NotClosable");
}

/// RC-3 REGRESSION (fixed). A trade commits the pair (both pools missing); Raydium raises the create-pool fee to 45 SOL so only side
/// B (≈39.6 SOL) cannot pay. void_pair now examines both sides: after 3 days it refunds B directly — nobody has to graduate A first —
/// and A can still graduate afterwards (its raise was never touched by B's refund).
#[test]
fn pc3_void_stuck_side_needs_the_payable_side_graduated_first() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    let (_ba, bb) = fill(&mut env, &p, 50 * SOL, 40 * SOL);
    let s = pair_state(&env, &p);
    assert_eq!((s.status, s.pools), (pair_curve::STATUS_GRADUATING, [Pubkey::default(); 2]), "committed by the buy, no pool yet");
    set_pool_fee(&mut env, &p, 45 * SOL);
    env.set_time(s.graduation_started_at + pair_curve::GRADUATION_STUCK_SECS + 10);
    let m = env.ok(&[ix_void(&p, &c.pubkey())], &[&c]);
    let ev: pair_curve::events::PairVoided = pc_event(&m);
    assert_eq!(ev.side, 1, "B refunded while A is still ungraduated");
    let r = pair_state(&env, &p);
    assert_eq!((r.refunding, r.status), ([false, true], pair_curve::STATUS_GRADUATING));
    let hb = held(&env, &bb.pubkey(), &p.mint(1));
    env.ok(&[ix_sell(&p, &bb.pubkey(), 1, hb, 0)], &[&bb]);
    assert_identity(&env, &p, "after B's refund");
    set_pool_fee(&mut env, &p, MAINNET_POOL_FEE);
    graduate_side(&mut env, &p, &c, 0, &[]).unwrap();
    assert_identity(&env, &p, "after A's graduation");
    expect_anchor_err(graduate_side(&mut env, &p, &c, 1, &[]), "SideAlreadyGraduated");
}

/// RC-2/RC-3: both pools missing for 30 days (no Raydium signal at all): both sides are refunded in one call and, with no pool to
/// register, the pair becomes Voided — closable once everyone has redeemed.
#[test]
fn pc3_fallback_with_both_pools_missing_voids_the_pair() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, SOL);
    let (ba, bb) = fill(&mut env, &p, 50 * SOL, 40 * SOL);
    let s = pair_state(&env, &p);
    assert_eq!(s.status, pair_curve::STATUS_GRADUATING);
    env.set_time(s.graduation_started_at + pair_curve::GRADUATION_STUCK_SECS + 10);
    expect_anchor_err(env.send(&[ix_void(&p, &c.pubkey())], &[&c]), "NotStuck");
    env.set_time(s.graduation_started_at + pair_curve::GRADUATION_FALLBACK_SECS);
    let m = env.ok(&[ix_void(&p, &c.pubkey())], &[&c]);
    let ev: pair_curve::events::PairVoided = pc_event(&m);
    assert_eq!(ev.side, 2);
    let r = pair_state(&env, &p);
    assert_eq!((r.status, r.refunding), (pair_curve::STATUS_VOIDED, [true, true]));
    expect_anchor_err(graduate_side(&mut env, &p, &c, 0, &[]), "NotOpen");
    for (h, side) in [(&ba, 0u8), (&bb, 1u8)] {
        let amt = held(&env, &h.pubkey(), &p.mint(side));
        env.ok(&[ix_sell(&p, &h.pubkey(), side, amt, 0)], &[h]);
    }
    assert_identity(&env, &p, "after both refunds");
    env.ok(&[ix_close(&p, &c.pubkey())], &[&c]);
}

/// RC-4 (R2 H-1 fix). A side-A holder pre-funds A's WSOL pool vault with X = 2 SOL (above rent) so the pool opens above the curve
/// price, then sells its whole bag into the new pool. Compared with the same run without the donation it receives more WSOL, but
/// less than X: the excess-joins-the-pool rule cannot be used to extract value, and registration still succeeds.
#[test]
fn pc3_h1_prefunded_wsol_is_a_donation_the_donor_cannot_recover() {
    const X: u64 = 2 * SOL;
    fn run(donate: bool) -> (u64, u64) {
        let mut env = new_env();
        let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
        let c = trader(&mut env, SOL);
        let attacker = trader(&mut env, 20 * SOL);
        env.ok(&[ix_buy(&p, &attacker.pubkey(), 0, 10 * SOL, 1)], &[&attacker]);
        if donate {
            let rent165 = env.svm.minimum_balance_for_rent_exemption(165);
            env.transfer_sol(&wsol_pool_vault(&p, 0), rent165 + X);
        }
        fill(&mut env, &p, 40 * SOL, 40 * SOL);
        assert_eq!(pair_state(&env, &p).status, pair_curve::STATUS_GRADUATING);
        let ms = graduate_both(&mut env, &p, &c);
        let ev: pair_curve::events::SideGraduated = pc_event(&ms[0]);
        assert_eq!(ev.prefunded_wsol, if donate { X } else { 0 });
        let pl = pool_of(&p, 0);
        env.ok(&[ix_register_pair(&c.pubkey(), &p.mint(0), &pl.pool, &pl.lp_mint, &p.pair)], &[&c]);
        let now = env.now();
        env.set_time(now + 10);
        let wsol = env.create_ata(&attacker.pubkey(), &NATIVE_MINT);
        let bag = held(&env, &attacker.pubkey(), &p.mint(0));
        bcpmm::swap(&mut env, &attacker, &pl, &p.mint(0), false, bag).unwrap();
        (env.token_amount(&wsol), ev.pool_sol)
    }
    let (got_plain, pool_plain) = run(false);
    let (got_donated, pool_donated) = run(true);
    println!("sell-out into the pool: {got_plain} without donation, {got_donated} after donating {X} (pool_sol {pool_plain} / {pool_donated})");
    assert_eq!(pool_plain, pool_donated, "the price-matched deposit is unchanged; the donation sits on top");
    assert!(got_donated > got_plain, "the donation raises the opening price");
    assert!(got_donated - got_plain < X, "but the donor recovers less than it gave: {} of {X}", got_donated - got_plain);
}

/// RC-5 REGRESSION (fixed). After a void and full redemption the developer accrual is outstanding and the developer wallet address
/// holds an executable account. claim_developer_fee still refuses (NothingToClaim) — but close_pair no longer waits: the accrual goes to
/// the two burn pools with the residue (`PairClosed.dev_accrual_to_burn_pools`) and the rent goes back to the creator.
#[test]
fn pc3_executable_dev_wallet_still_blocks_close_pair() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let t = trader(&mut env, 10 * SOL);
    env.ok(&[ix_buy(&p, &t.pubkey(), 0, SOL, 1)], &[&t]);
    let exe = env.svm.get_account(&pair_curve::ID).unwrap();
    env.svm.set_account(p.dev, exe.clone()).unwrap();
    let s = pair_state(&env, &p);
    env.set_time(s.deadline);
    env.ok(&[ix_void(&p, &t.pubkey())], &[&t]);
    let h = held(&env, &t.pubkey(), &p.mint(0));
    env.ok(&[ix_sell(&p, &t.pubkey(), 0, h, 0)], &[&t]);
    let accrued = pair_state(&env, &p).dev_accrued;
    assert!(accrued > 0);
    expect_anchor_err(env.send(&[ix_claim(&p, &t.pubkey())], &[&t]), "NothingToClaim");
    let burn0 = env.lamports(&fee_pda(&p.mint(0))) + env.lamports(&fee_pda(&p.mint(1)));
    let m = env.ok(&[ix_close(&p, &t.pubkey())], &[&t]);
    let ev: pair_curve::events::PairClosed = pc_event(&m);
    assert_eq!(ev.dev_accrual_to_burn_pools, accrued);
    let burn1 = env.lamports(&fee_pda(&p.mint(0))) + env.lamports(&fee_pda(&p.mint(1)));
    assert_eq!(burn1 - burn0, ev.residue_lamports);
    assert!(ev.residue_lamports >= accrued);
    assert_eq!(env.lamports(&p.dev), exe.lamports, "nothing was sent to the executable account");
    assert_eq!(env.lamports(&p.vault), vault_rent(&env));
}

/// RC-6 (R2 M-1 / L-1 rounding). Two side-A holders after a void. The smaller exits in 25 chunks (the last a single raw unit) and gets
/// no more than its one-shot floor(amount × pool / supply); the larger exits last and receives exactly the remainder; the side drains
/// to 0 and the identity holds after every exit. A claim mid-redemption pays the accrual and changes no holder's payout.
#[test]
fn pc3_redemption_chunking_and_last_unit_never_beat_pro_rata() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let (h1, h2, b) = (trader(&mut env, 10 * SOL), trader(&mut env, 10 * SOL), trader(&mut env, 10 * SOL));
    env.ok(&[ix_buy(&p, &h1.pubkey(), 0, 3 * SOL, 1)], &[&h1]);
    env.ok(&[ix_buy(&p, &h2.pubkey(), 0, 5 * SOL, 1)], &[&h2]);
    env.ok(&[ix_buy(&p, &b.pubkey(), 1, 2 * SOL, 1)], &[&b]);
    let s = pair_state(&env, &p);
    env.set_time(s.deadline);
    env.ok(&[ix_void(&p, &b.pubkey())], &[&b]);
    let v = pair_state(&env, &p);
    let (pool, supply) = (v.redeem_pool[0], v.redeem_supply[0]);
    let a1 = held(&env, &h1.pubkey(), &p.mint(0));
    let one_shot = (a1 as u128 * pool as u128 / supply as u128) as u64;
    let before1 = env.lamports(&h1.pubkey());
    let chunk = (a1 - 1) / 24;
    let mut left = a1;
    for i in 0..25 {
        let amt = if i == 24 { left } else { chunk };
        env.ok(&[ix_sell(&p, &h1.pubkey(), 0, amt, 0)], &[&h1]);
        left -= amt;
        assert_identity(&env, &p, "chunked exit");
        if i == 10 {
            env.ok(&[ix_claim(&p, &b.pubkey())], &[&b]);
            assert_identity(&env, &p, "claim mid-redemption");
        }
    }
    assert_eq!(left, 0);
    let got1 = env.lamports(&h1.pubkey()) - before1;
    assert!(got1 <= one_shot && one_shot - got1 <= 25, "chunked {got1} vs one-shot {one_shot}");
    let a2 = held(&env, &h2.pubkey(), &p.mint(0));
    let before2 = env.lamports(&h2.pubkey());
    env.ok(&[ix_sell(&p, &h2.pubkey(), 0, a2, 0)], &[&h2]);
    let got2 = env.lamports(&h2.pubkey()) - before2;
    assert_eq!(got1 + got2, pool, "the side drains exactly");
    let e = pair_state(&env, &p);
    assert_eq!((e.sold[0], e.sol[0]), (0, 0));
    assert_identity(&env, &p, "drained");
}
