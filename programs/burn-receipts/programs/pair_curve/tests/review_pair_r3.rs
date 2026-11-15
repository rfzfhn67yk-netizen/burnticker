//! Pair-forward ROUND-3 RE-CHECK (paircheck-1, 2026-10-12) — docs/burnticker/reviews/2026-10-12-pair-forward-round3-recheck.md.
//! The harness below is a verbatim copy of tests/review_pair_r2.rs's (itself review_pc1.rs's).
//!
//!   P3-1 (Low)  a pair_curve pair that was never linked (link_pair refused PairAttestersDiffer, or simply never landed) has no route to
//!               register a graduated side once the other side is refunding: link_pair → PairTerminal, unlink_pair needs the PairLinks,
//!               register_pair_pool needs PAIRED or UNLINKED. The graduated side's burn escrow sits in its fee PDA with no exit.
//!                 p3_1_still_a_never_linked_pair_with_a_refunding_side_freezes_the_graduated_side   (passes today: the residual)
//!                 p3_1_a_never_linked_pair_with_a_refunding_side_still_registers_the_graduated_side (fixed on burnticker/endsink2)
//!   P3-2 (Low)  apply_paired_attester_change applies ONE coin's new set, so the "one attester set per pair" that M-1's fix rests on
//!               ends at the first rotation; a key added to one side only then vetoes every result (that side's losses included).
//!                 p3_2_still_a_co_signed_rotation_leaves_the_pair_on_two_sets_and_the_new_key_vetoes_results (passes today)
//!                 p3_2_a_co_signed_rotation_keeps_both_coins_on_one_set                                       (fixed on burnticker/endsink2)
//!   P3-I1 (Info) a LOST PairResult recorded before unlink_pair still forwards (0 lamports) afterwards, so the now-plain loser never burns
//!               that period:  p3_i1_a_result_from_before_an_unlink_no_longer_forwards (fixed on burnticker/endsink2)
//!
//! Run: scripts/test.sh builds the fixtures; then
//!   cargo test -p pair_curve --test review_pair_r3 -- --include-ignored --test-threads=1 --nocapture


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
// P3-1 — a never-linked pair_curve pair with a refunding side
// --------------------------------------------------------------------------------------------------------------------------------

/// A pair whose link_pair never landed (here: never sent; in practice a PairAttestersDiffer refusal the keeper only logs, or an outage
/// that outlasts the curve), side A graduated, side B refunding (Raydium blocks B's pool; void_pair after GRADUATION_STUCK_SECS).
/// Returns the pair, a cranker, side A's pool and A's fee-PDA balance (the graduation burn escrow).
fn never_linked_half_graduated(env: &mut Env) -> (P, Keypair, Pool, u64) {
    let p = prepare(env, MAINNET_POOL_FEE);
    let args = default_args(env.now());
    let ix = ix_init_pair(env, &p, args);
    env.ok(&[ix], &[&p.creator]);
    let c = trader(env, 2 * SOL);
    fill(env, &p, 50 * SOL, 40 * SOL);
    graduate_side(env, &p, &c, 0, &[]).unwrap();
    let s = pair_state(env, &p);
    let mut cfg = env.svm.get_account(&p.amm).unwrap();
    cfg.data[36..44].copy_from_slice(&(100 * SOL).to_le_bytes());
    env.svm.set_account(p.amm, cfg).unwrap();
    env.set_time(s.graduation_started_at + pair_curve::GRADUATION_STUCK_SECS);
    env.ok(&[ix_void(&p, &c.pubkey())], &[&c]);
    assert!(pair_state(env, &p).refunding[1], "side B is refunding");
    let payer = env.payer.pubkey();
    expect_anchor_err(env.send(&[ix_link_pair(&payer, &p.pair, &p.mint(0), &p.mint(1))], &[]), "PairTerminal");
    expect_anchor_err(env.send(&[ix_unlink_pair(&c.pubkey(), &p.mint(0), &p.mint(1), Some(p.pair))], &[&c]), "AccountNotInitialized");
    let escrow = env.lamports(&fee_pda(&p.mint(0)));
    let pa = pool_of(&p, 0);
    (p, c, pa, escrow)
}

/// Fixed (endsink2, P3-1): the partner side's refund (terminal evidence read from the Pair) admits a never-linked coin, which is
/// recorded UNLINKED (a plain coin) when its pool registers.
#[test]
fn p3_1_a_never_linked_coin_registers_only_on_terminal_evidence_and_becomes_unlinked() {
    let mut env = new_env();
    let (p, c, pa, _) = never_linked_half_graduated(&mut env);
    env.ok(&[ix_register_pair(&c.pubkey(), &p.mint(0), &pa.pool, &pa.lp_mint, &p.pair)], &[&c]);
    assert_eq!(env.config(&config_pda(&p.mint(0))).pair_state, PAIR_STATE_UNLINKED);
}

/// The safe behaviour: a coin whose partner side is refunding (terminal evidence, the same unlink_pair accepts) registers its pool and
/// burns as a plain coin, whether or not link_pair ever ran.
#[test]
fn p3_1_a_never_linked_pair_with_a_refunding_side_still_registers_the_graduated_side() {
    let mut env = new_env();
    let (p, c, pa, _) = never_linked_half_graduated(&mut env);
    env.ok(&[ix_register_pair(&c.pubkey(), &p.mint(0), &pa.pool, &pa.lp_mint, &p.pair)], &[&c]);
    assert!(env.config(&config_pda(&p.mint(0))).pool_verified);
}

// --------------------------------------------------------------------------------------------------------------------------------
// P3-2 — a co-signed rotation splits the pair's one attester set
// --------------------------------------------------------------------------------------------------------------------------------

const R0: u32 = 20261009; // the harness's pairing day (NOW = 2026-10-09 12:00 UTC)

/// A linked pair (one set: p.attester, quorum 1); B's admin proposed [p.attester, rotated] at quorum 2 (48 h ago); A's quorum
/// (p.attester) co-signs; apply_paired_attester_change(B) lands. Returns the pair, a cranker and the rotated key.
fn rotated_pair(env: &mut Env) -> (P, Keypair, Keypair) {
    let p = setup(env, MAINNET_POOL_FEE, |_| {});
    let rotated = Keypair::new();
    let now = env.now();
    let att = p.attester.pubkey();
    patch_config(env, &p.mint(1), |c| {
        c.pending_attesters[0] = burn_receipts::state::AttesterEntry::operator(att);
        c.pending_attesters[1] = burn_receipts::state::AttesterEntry::operator(rotated.pubkey());
        c.pending_count = 2;
        c.pending_quorum = 2;
        c.pending_eta = now - 1;
    });
    let k = trader(env, 2 * SOL);
    let msg = pair_attester_change_message(env, &p.mint(1), &p.mint(0));
    let by_partner = ed25519_shared(&[(att, sign(&p.attester, &msg))], &msg);
    env.ok(&[by_partner, ix_apply_paired_attester_change(&k.pubkey(), &p.mint(1), &p.mint(0))], &[&k]);
    (p, k, rotated)
}

/// Fixed (endsink2, P3-2): the co-signed rotation lands on BOTH coins at once, so every result needs the new common quorum on both
/// sides ([att, rotated], quorum 2) and no key is one side's alone.
#[test]
fn p3_2_after_an_atomic_rotation_both_coins_need_the_new_common_quorum() {
    let mut env = new_env();
    let (p, _k, rotated) = rotated_pair(&mut env);
    let (ca, cb) = (env.config(&config_pda(&p.mint(0))), env.config(&config_pda(&p.mint(1))));
    assert_eq!((ca.quorum, ca.attester_count), (2, 2));
    assert_eq!((cb.quorum, cb.attester_count), (2, 2));
    expect_anchor_err(submit_pair_result(&mut env, &p.mint(0), &p.mint(1), R0, Pubkey::default(), &[&p.attester]), "QuorumNotMet");
    submit_pair_result_v0(&mut env, &p.mint(0), &p.mint(1), R0, Pubkey::default(), &[&p.attester, &rotated]).unwrap();
}

/// The invariant WHITEPAPER §5.5 / ATTESTERS.md state ("the two coins share one attester set"): after any accepted rotation both coins
/// are on the same set (fix: apply both coins' identical pending proposals in one instruction, or refuse a one-sided apply).
#[test]
fn p3_2_a_co_signed_rotation_keeps_both_coins_on_one_set() {
    let mut env = new_env();
    let (p, _k, _rotated) = rotated_pair(&mut env);
    let ha = burn_receipts::instructions::pair::attester_set_hash(&env.config(&config_pda(&p.mint(0))));
    let hb = burn_receipts::instructions::pair::attester_set_hash(&env.config(&config_pda(&p.mint(1))));
    assert_eq!(ha, hb);
}

// --------------------------------------------------------------------------------------------------------------------------------
// P3-I1 (Info) — a LOST result recorded before an unlink still forwards (0 lamports) after it
// --------------------------------------------------------------------------------------------------------------------------------

/// Side A graduated, side B refunding (pc1's half-graduated pair). Both read P1/P2; a result names B the P2 winner (A lost); then
/// unlink_pair (B refunding). A is a plain coin now, yet forward_to_winner(A → B, P2) still lands: 0 lamports, A's P2 reading
/// FORWARDED, so the plain coin never burns that period. Safe behaviour: the forward refuses an unlinked pair (NotPaired) and the crank
/// gate (which already passes UNLINKED coins) burns the period as plain.
#[test]
fn p3_i1_a_result_from_before_an_unlink_no_longer_forwards() {
    let mut env = new_env();
    let p = setup(&mut env, MAINNET_POOL_FEE, |_| {});
    let c = trader(&mut env, 2 * SOL);
    fill(&mut env, &p, 50 * SOL, 40 * SOL);
    graduate_side(&mut env, &p, &c, 0, &[]).unwrap();
    let s = pair_state(&env, &p);
    let mut cfg = env.svm.get_account(&p.amm).unwrap();
    cfg.data[36..44].copy_from_slice(&(100 * SOL).to_le_bytes());
    env.svm.set_account(p.amm, cfg).unwrap();
    env.set_time(s.graduation_started_at + pair_curve::GRADUATION_STUCK_SECS);
    env.ok(&[ix_void(&p, &c.pubkey())], &[&c]);
    const P1: u32 = 20261010;
    const P2: u32 = 20261011;
    for side in 0..2u8 {
        submit(&mut env, &p.mint(side), P1, V1, &[&p.attester]).unwrap();
        submit(&mut env, &p.mint(side), P2, V1 + 3 * UNIT, &[&p.attester]).unwrap();
    }
    // P1 is each coin's baseline (0 units, processed at submit); A loses P2 to B
    submit_pair_result(&mut env, &p.mint(0), &p.mint(1), P2, p.mint(1), &[&p.attester]).unwrap();
    env.ok(&[ix_unlink_pair(&c.pubkey(), &p.mint(0), &p.mint(1), Some(p.pair))], &[&c]);
    assert_eq!(env.config(&config_pda(&p.mint(0))).pair_state, PAIR_STATE_UNLINKED);
    expect_anchor_err(env.send(&[ix_forward_to_winner(&c.pubkey(), &p.mint(0), &p.mint(1), P2)], &[&c]), "NotPaired");
}

/// Writes a TokenConfig change straight into the account (the state propose_attesters leaves after its 48 h timelock).
fn patch_config(env: &mut Env, mint: &Pubkey, f: impl FnOnce(&mut burn_receipts::state::TokenConfig)) {
    let key = config_pda(mint);
    let mut cfg = env.config(&key);
    f(&mut cfg);
    let mut acc = env.svm.get_account(&key).unwrap();
    let mut data = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(&cfg, &mut data).unwrap();
    acc.data[..data.len()].copy_from_slice(&data);
    env.svm.set_account(key, acc).unwrap();
}
