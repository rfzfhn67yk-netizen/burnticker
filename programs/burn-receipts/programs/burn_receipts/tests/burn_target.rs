//! Round 5 (owner, 2026-10-13) — A COIN THAT BURNS ANOTHER TOKEN. Against the real Raydium CPMM fixture and the real Raydium AMM v4
//! program (raydium-amm built from source at d26944bfb76fb5fa8f91e5d440c2050ed358ef81, fixtures/raydium_amm.so, with a harness-written
//! swap-only AmmInfo), and harness-written Pyth PriceUpdateV2 accounts: pin_burn_target (admission: plain SPL Token, no mint or freeze
//! authority, a {target, WSOL} pool on a ≤ 1 % tier over the SOL floor, a fresh Pyth price the pool agrees with, only before the coin's
//! mint exists), crank_target_burn end to end on both pool kinds (swap on the pinned pool, burn the target, memo v3, the coin's own fee
//! tokens burned too), the per-crank cap by the TARGET pool's SOL reserve (also after the platform cap's sunset), the Pyth guard against a
//! pushed pool (the Jito-style push / crank / push back), stale and wrong Pyth accounts, pool substitution refused, an unhealthy pool held
//! then unblocked after 30 days, crank_buyback refusing a target coin, and the pool re-pin (admin, 48 h, attester veto, the same
//! admission). The self-target path is proven unchanged by every other suite in this directory (same bytes, same results).

#![allow(clippy::result_large_err, clippy::too_many_arguments, dead_code)]
mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::{AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas};
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::spl_token;
use burn_receipts::constants::*;
use burn_receipts::events::TargetBurned;
use burn_receipts::math;
use burn_receipts::state::BurnTarget;
use common::cpmm::{self, Pool};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

const D1: u32 = 20261010;
const D2: u32 = 20261011;
const D3: u32 = 20261012;
const T0: i64 = NOW + 6 * 86_400;
const V1: u64 = 4_027_300_000_000_000;
const TOKEN_2022: Pubkey = anchor_lang::prelude::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");


// ---------------------------------------------------------------------------------------------------------------------------------
// Pyth: harness-written PriceUpdateV2 accounts (pyth-solana-receiver layout, Full verification)
// ---------------------------------------------------------------------------------------------------------------------------------

/// The test target's feed id (stands in for Crypto.BONK/USD).
const TARGET_FEED: [u8; 32] = [0x77; 32];
/// Second review (A): the program takes only the feeds' SPONSORED push-oracle accounts (PDA [0u16 LE, feed id]); the harness writes them.
fn sol_px() -> Pubkey {
    burn_receipts::pyth::sponsored_address(&PYTH_SOL_USD_FEED_ID)
}
fn tgt_px() -> Pubkey {
    burn_receipts::pyth::sponsored_address(&TARGET_FEED)
}
const SOL_USD: i64 = 10_000_000_000; // $100, exponent −8

fn write_pyth(env: &mut Env, key: Pubkey, feed: [u8; 32], price: i64, conf: u64, expo: i32, publish_time: i64, full: bool) {
    let mut d = Vec::with_capacity(134);
    d.extend_from_slice(&burn_receipts::pyth::PRICE_UPDATE_V2_DISCRIMINATOR);
    d.extend_from_slice(&[0x99; 32]); // write authority
    if full { d.push(1) } else { d.extend_from_slice(&[0, 5]) }
    d.extend_from_slice(&feed);
    d.extend_from_slice(&price.to_le_bytes());
    d.extend_from_slice(&conf.to_le_bytes());
    d.extend_from_slice(&expo.to_le_bytes());
    d.extend_from_slice(&publish_time.to_le_bytes());
    d.extend_from_slice(&publish_time.to_le_bytes()); // prev publish time
    d.extend_from_slice(&price.to_le_bytes()); // ema
    d.extend_from_slice(&conf.to_le_bytes());
    d.extend_from_slice(&0u64.to_le_bytes()); // posted slot
    d.resize(134, 0);
    let lamports = env.svm.minimum_balance_for_rent_exemption(d.len());
    env.svm.set_account(key, litesvm_account(lamports, d, PYTH_RECEIVER_PROGRAM_ID)).unwrap();
}

/// SOL at $100 and the target at `target_e12` × 10⁻¹² USD, both published now.
fn set_prices(env: &mut Env, target_e12: i64) {
    let now = env.now();
    write_pyth(env, sol_px(), PYTH_SOL_USD_FEED_ID, SOL_USD, (SOL_USD / 1_000) as u64, -8, now, true);
    write_pyth(env, tgt_px(), TARGET_FEED, target_e12, (target_e12 / 1_000).max(0) as u64, -12, now, true);
}

/// The target/USD price at which Pyth agrees with the pool's spot exactly (SOL $100, 6 decimals): 10¹¹ × r_wsol / r_tok (× 10⁻¹²).
fn fair_e12(env: &Env, p: &impl AsTp) -> i64 {
    let (w, t) = reserves_of(env, &p.tp());
    (100_000_000_000u128 * w as u128 / t as u128) as i64
}

/// Publishes Pyth prices that agree with `p`'s current reserves (what Pyth's publishers would show for a pool in line with the market).
fn refresh(env: &mut Env, p: &impl AsTp) {
    let e = fair_e12(env, p);
    set_prices(env, e);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// A target pool of either kind
// ---------------------------------------------------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug)]
struct TP {
    kind: u8,
    pool: Pubkey,
    /// CPMM AmmConfig / AMM v4 vault authority.
    config: Pubkey,
    /// CPMM vault-and-LP authority / AMM v4 vault authority.
    authority: Pubkey,
    wsol_vault: Pubkey,
    target_vault: Pubkey,
    /// CPMM observation / the AMM v4 pool itself.
    observation: Pubkey,
    program: Pubkey,
}

trait AsTp {
    fn tp(&self) -> TP;
}
impl AsTp for Pool {
    fn tp(&self) -> TP {
        TP { kind: TARGET_POOL_CPMM, pool: self.pool, config: self.amm_config, authority: self.authority, wsol_vault: self.wsol_vault(), target_vault: self.token_vault(), observation: self.observation, program: CPMM_PROGRAM_ID }
    }
}
impl AsTp for TP {
    fn tp(&self) -> TP {
        *self
    }
}

/// Tradeable reserves (WSOL, target): CPMM vaults less owed fees, AMM v4 vaults less owed PnL — what the program reads.
fn reserves_of(env: &Env, p: &TP) -> (u64, u64) {
    let d = env.svm.get_account(&p.pool).unwrap().data;
    let u = |at: usize| u64::from_le_bytes(d[at..at + 8].try_into().unwrap());
    let (wf, tf) = if p.kind == TARGET_POOL_AMM_V4 {
        let wsol_coin = d[336..368] == p.wsol_vault.to_bytes()[..];
        if wsol_coin { (u(192), u(200)) } else { (u(200), u(192)) }
    } else {
        let wsol0 = d[72..104] == p.wsol_vault.to_bytes()[..];
        let (f0, f1) = (u(341) + u(357) + u(397), u(349) + u(365) + u(405));
        if wsol0 { (f0, f1) } else { (f1, f0) }
    };
    (env.token_amount(&p.wsol_vault) - wf, env.token_amount(&p.target_vault) - tf)
}

/// Raydium AMM v4 (the real program, raydium-amm d26944bf) at its mainnet id.
fn load_amm_v4(env: &mut Env) {
    if env.svm.get_account(&AMM_V4_PROGRAM_ID).map(|a| a.executable).unwrap_or(false) {
        return;
    }
    let p = format!("{}/../../fixtures/raydium_amm.so", env!("CARGO_MANIFEST_DIR"));
    let so = std::fs::read(&p).unwrap_or_else(|e| panic!("cannot read {p}: {e}. Run scripts/build-amm-v4-fixture.sh first."));
    env.svm.add_program(AMM_V4_PROGRAM_ID, &so).unwrap();
}

/// A swap-only AMM v4 pool of `target` (coin) against WSOL (pc), the shape of WIF's mainnet pool: an AmmInfo written by the harness (the
/// program has no permissionless create without OpenBook), vaults owned by the AMM's authority PDA and funded for real, swap fee
/// `fee_num`/`fee_den`, owed PnL `pnl_pc` on the WSOL side, status `status`.
fn amm_pool_with(env: &mut Env, target: &Pubkey, sol: u64, tokens: u64, fee_num: u64, fee_den: u64, pnl_pc: u64, status: u64) -> TP {
    load_amm_v4(env);
    let (authority, nonce) = Pubkey::find_program_address(&[b"amm authority"], &AMM_V4_PROGRAM_ID);
    // Each pool has its own vaults (plain token accounts owned by the shared authority PDA, as Raydium creates them).
    let wv = token_account(env, &NATIVE_MINT, &authority);
    env.transfer_sol(&wv, sol);
    env.ok(&[spl_token::instruction::sync_native(&spl_token::ID, &wv).unwrap()], &[]);
    let tv = token_account(env, target, &authority);
    let me = env.payer.insecure_clone();
    let treasury = get_associated_token_address(&env.payer.pubkey(), target);
    env.ok(&[spl_token::instruction::transfer(&spl_token::ID, &treasury, &tv, &me.pubkey(), &[], tokens).unwrap()], &[]);
    let mut d = vec![0u8; 752];
    let w = |d: &mut Vec<u8>, at: usize, v: u64| d[at..at + 8].copy_from_slice(&v.to_le_bytes());
    let k = |d: &mut Vec<u8>, at: usize, v: &Pubkey| d[at..at + 32].copy_from_slice(v.as_ref());
    w(&mut d, 0, status);
    w(&mut d, 8, nonce as u64);
    w(&mut d, 32, DECIMALS as u64); // coin decimals
    w(&mut d, 40, 9); // pc decimals
    for (at, v) in [(144, fee_num), (152, fee_den), (176, fee_num), (184, fee_den)] {
        w(&mut d, at, v);
    }
    w(&mut d, 200, pnl_pc);
    k(&mut d, 336, &tv);
    k(&mut d, 368, &wv);
    k(&mut d, 400, target);
    k(&mut d, 432, &NATIVE_MINT);
    let pool = Pubkey::new_unique();
    let lamports = env.svm.minimum_balance_for_rent_exemption(752);
    env.svm.set_account(pool, litesvm_account(lamports, d, AMM_V4_PROGRAM_ID)).unwrap();
    TP { kind: TARGET_POOL_AMM_V4, pool, config: authority, authority, wsol_vault: wv, target_vault: tv, observation: pool, program: AMM_V4_PROGRAM_ID }
}

/// A fresh SPL token account (not an ATA) of `mint` owned by `owner`.
fn token_account(env: &mut Env, mint: &Pubkey, owner: &Pubkey) -> Pubkey {
    let k = Keypair::new();
    let rent = env.svm.minimum_balance_for_rent_exemption(spl_token::state::Account::LEN);
    let payer = env.payer.pubkey();
    env.ok(
        &[
            anchor_lang::solana_program::system_instruction::create_account(&payer, &k.pubkey(), rent, spl_token::state::Account::LEN as u64, &spl_token::ID),
            spl_token::instruction::initialize_account3(&spl_token::ID, &k.pubkey(), mint, owner).unwrap(),
        ],
        &[&k],
    );
    k.pubkey()
}

fn amm_pool(env: &mut Env, target: &Pubkey, sol: u64) -> TP {
    amm_pool_with(env, target, sol, 800_000_000 * TOKEN, 25, 10_000, 0, 6)
}

/// A trader's swap_base_in_v2 on an AMM v4 pool (`buy` = WSOL → target).
fn amm_swap_ix(trader: &Pubkey, p: &TP, target: &Pubkey, buy: bool, amount_in: u64) -> Instruction {
    let (src, dst) = if buy {
        (get_associated_token_address(trader, &NATIVE_MINT), get_associated_token_address(trader, target))
    } else {
        (get_associated_token_address(trader, target), get_associated_token_address(trader, &NATIVE_MINT))
    };
    let mut data = vec![16u8];
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&0u64.to_le_bytes());
    Instruction {
        program_id: AMM_V4_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new(p.pool, false),
            AccountMeta::new_readonly(p.authority, false),
            AccountMeta::new(p.target_vault, false),
            AccountMeta::new(p.wsol_vault, false),
            AccountMeta::new(src, false),
            AccountMeta::new(dst, false),
            AccountMeta::new_readonly(*trader, true),
        ],
        data,
    }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------------------------------------------------------------

fn ix_pin(payer: &Pubkey, mint: &Pubkey, target: &Pubkey, p: &impl AsTp) -> Instruction {
    let p = p.tp();
    ix_pin_with(payer, mint, target, p.pool, p.config, p.wsol_vault, p.target_vault)
}

fn ix_pin_with(payer: &Pubkey, mint: &Pubkey, target: &Pubkey, pool: Pubkey, amm_config: Pubkey, wsol_vault: Pubkey, target_vault: Pubkey) -> Instruction {
    ix_pin_feed(payer, mint, target, pool, amm_config, wsol_vault, target_vault, TARGET_FEED)
}

fn ix_pin_feed(payer: &Pubkey, mint: &Pubkey, target: &Pubkey, pool: Pubkey, amm_config: Pubkey, wsol_vault: Pubkey, target_vault: Pubkey, feed: [u8; 32]) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::PinBurnTarget { target_feed_id: feed }.data(),
        burn_receipts::accounts::PinBurnTarget {
            payer: *payer,
            mint: *mint,
            config: config_pda(mint),
            burn_target: burn_target_pda(mint),
            target_mint: *target,
            target_pool: pool,
            target_amm_config: amm_config,
            target_wsol_vault: wsol_vault,
            target_token_vault: target_vault,
            sol_price_update: sol_px(),
            target_price_update: tgt_px(),
            system_program: anchor_lang::solana_program::system_program::ID,
            end_sink: end_sink_pda(mint),
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

fn ix_crank_target(cranker: &Pubkey, mint: &Pubkey, target: &Pubkey, p: &impl AsTp, date: u32) -> Instruction {
    let p = p.tp();
    let config = config_pda(mint);
    let fee = fee_pda(mint);
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::CrankTargetBurn { record_date: date }.data(),
        burn_receipts::accounts::CrankTargetBurn {
            cranker: *cranker,
            config,
            reading: reading_pda(&config, date),
            platform: platform_pda(),
            burn_target: burn_target_pda(mint),
            mint: *mint,
            fee_vault: fee,
            fee_wsol: get_associated_token_address(&fee, &NATIVE_MINT),
            fee_tokens: get_associated_token_address(&fee, mint),
            target_mint: *target,
            target_tokens: get_associated_token_address(&fee, target),
            wsol_mint: NATIVE_MINT,
            pool_state: p.pool,
            amm_config: p.config,
            cpmm_authority: p.authority,
            wsol_vault: p.wsol_vault,
            target_vault: p.target_vault,
            observation_state: p.observation,
            swap_program: p.program,
            token_program: spl_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            memo_program: MEMO_PROGRAM_ID,
            sol_price_update: sol_px(),
            target_price_update: tgt_px(),
            pair_link: None,
            pair_result: None,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

fn ix_target_admin(which: &str, admin: &Pubkey, mint: &Pubkey, pool: Pubkey) -> Instruction {
    let accounts = burn_receipts::accounts::TargetPoolAdmin { admin: *admin, config: config_pda(mint), burn_target: burn_target_pda(mint), event_authority: event_authority(), program: burn_receipts::ID }
        .to_account_metas(None);
    let data = match which {
        "propose" => burn_receipts::instruction::ProposeTargetPool { pool }.data(),
        "cancel" => burn_receipts::instruction::CancelTargetPool {}.data(),
        _ => unreachable!(),
    };
    Instruction::new_with_bytes(burn_receipts::ID, &data, accounts)
}

fn ix_veto_target(attester: &Pubkey, mint: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::VetoTargetPool {}.data(),
        burn_receipts::accounts::VetoTargetPool { attester: *attester, config: config_pda(mint), burn_target: burn_target_pda(mint), event_authority: event_authority(), program: burn_receipts::ID }
            .to_account_metas(None),
    )
}

fn ix_apply_target(caller: &Pubkey, mint: &Pubkey, target: &Pubkey, p: &impl AsTp) -> Instruction {
    let p = p.tp();
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::ApplyTargetPool {}.data(),
        burn_receipts::accounts::ApplyTargetPool {
            caller: *caller,
            config: config_pda(mint),
            burn_target: burn_target_pda(mint),
            target_mint: *target,
            new_pool: p.pool,
            new_amm_config: p.config,
            new_wsol_vault: p.wsol_vault,
            new_target_vault: p.target_vault,
            sol_price_update: sol_px(),
            target_price_update: tgt_px(),
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

/// An AmmConfig at `index` with the given trade fee (ppm), created by the test CPMM admin.
fn amm_config_with_fee(env: &mut Env, index: u16, trade_fee: u64) -> Pubkey {
    let admin = cpmm::admin();
    env.fund(&admin.pubkey(), SOL);
    let amm_config = cpmm::pda(&[b"amm_config", &index.to_be_bytes()]);
    let mut data = vec![137, 52, 237, 212, 215, 117, 108, 104];
    data.extend_from_slice(&index.to_le_bytes());
    for v in [trade_fee, 120_000u64, 40_000u64, 0u64, cpmm::CREATOR_FEE_RATE] {
        data.extend_from_slice(&v.to_le_bytes());
    }
    let ix = Instruction {
        program_id: CPMM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(admin.pubkey(), true),
            AccountMeta::new(amm_config, false),
            AccountMeta::new_readonly(anchor_lang::solana_program::system_program::ID, false),
        ],
        data,
    };
    env.ok(&[ix], &[&admin]);
    amm_config
}

/// The world: a launcher with CPMM permission (AmmConfig 0), the target token ($BONK stand-in, fixed supply, no freeze authority) and
/// its WSOL pool (85 SOL / 800M, created by the launcher: NOT our fee PDA, LP NOT locked) with ≈ 900 s of oracle history.
struct World {
    launcher: Keypair,
    target: Pubkey,
    pool: Pool,
    trader: Keypair,
    attester: Keypair,
}

fn world(env: &mut Env) -> World {
    env.set_time(T0);
    let launcher = Keypair::new();
    env.fund(&launcher.pubkey(), 50_000 * SOL);
    cpmm::setup_amm(env, &launcher.pubkey());
    let tk = Keypair::new();
    let payer = env.payer.pubkey();
    env.create_mint(&tk, &payer, DECIMALS);
    let target = tk.pubkey();
    let pool = target_pool(env, &launcher, &cpmm::amm_config_0(), &target, 85 * SOL);
    let trader = cpmm::seed_history(env, &pool, &target);
    World { launcher, target, pool, trader, attester: Keypair::new() }
}

fn target_pool(env: &mut Env, launcher: &Keypair, amm_config: &Pubkey, target: &Pubkey, sol: u64) -> Pool {
    let lt = env.create_ata(&launcher.pubkey(), target);
    let me = env.payer.insecure_clone();
    env.mint_to(target, &me, &lt, 800_000_000 * TOKEN);
    cpmm::create_pool_unlocked(env, launcher, amm_config, target, &launcher.pubkey(), sol, 800_000_000 * TOKEN, &lt)
}

/// A policy-0 buyback coin: initialize_token (mint-signed), then pin_burn_target in the SAME transaction (the coin's mint does not exist
/// yet), then the mint is created (what LaunchLab's create does in the next transaction). Returns (mint, admin).
fn coin_with_target(env: &mut Env, w: &World) -> (Pubkey, Keypair) {
    let tp = w.pool.tp();
    coin_with_target_on(env, w, &tp)
}

/// The same, pinning `p` (either kind).
fn coin_with_target_on(env: &mut Env, w: &World, p: &TP) -> (Pubkey, Keypair) {
    coin_r5(env, w, p, buyback_rule(), END_SINK_FLAGSHIP)
}

/// A target coin with `rule` and an end sink of `sink_kind` (FLAGSHIP or INCINERATOR: no named coin).
fn coin_r5(env: &mut Env, w: &World, p: &TP, rule: burn_receipts::state::RuleParams, sink_kind: u8) -> (Pubkey, Keypair) {
    let kp = Keypair::new();
    let admin = Keypair::new();
    let mut args = init_args(rule, vec![w.attester.pubkey()], 1);
    args.admin = admin.pubkey();
    // Round-5 review R5-5: a target coin is created by initialize_token_r5 with an end sink (pin_burn_target requires one).
    args.end_sink_kind = sink_kind;
    args.end_sink_min_lamports = 10_000_000;
    let payer = env.payer.pubkey();
    let init = ix_initialize_r5(&payer, &admin.pubkey(), &kp.pubkey(), args, Some(TEST_LAUNCHLAB_PLATFORM), None, false);
    let pin = ix_pin(&payer, &kp.pubkey(), &w.target, p);
    refresh(env, p);
    env.ok(&[init, pin], &[&admin, &kp]);
    env.create_mint(&kp, &payer, DECIMALS);
    let mint = kp.pubkey();
    let fee = fee_pda(&mint);
    env.create_ata(&fee, &NATIVE_MINT);
    env.create_ata(&fee, &mint);
    env.create_ata(&fee, &w.target);
    (mint, admin)
}

fn units_value(units: u64) -> u64 {
    V1 + units * UNIT
}

/// Baseline D1 then D2 with `units` units; the fee PDA funded with `fuel` lamports above its reserve.
fn read_and_fund(env: &mut Env, w: &World, mint: &Pubkey, units: u64, fuel: u64) {
    submit(env, mint, D1, V1, &[&w.attester]).unwrap();
    submit(env, mint, D2, units_value(units), &[&w.attester]).unwrap();
    env.transfer_sol(&fee_pda(mint), fuel);
}

fn memo_v3(meta: &litesvm::types::TransactionMetadata) -> String {
    meta.logs
        .iter()
        .find(|l| l.contains("|v3"))
        .map(|l| l.split_once(": \"").map(|(_, m)| m.trim_end_matches('"').to_string()).unwrap_or_else(|| l.clone()))
        .unwrap_or_else(|| panic!("memo v3 in the logs:\n{}", meta.logs.join("\n")))
}

fn event<T: AnchorDeserialize + Discriminator>(meta: &litesvm::types::TransactionMetadata) -> Option<T> {
    events(meta).into_iter().find(|(d, _)| d[..] == T::DISCRIMINATOR[..]).map(|(_, p)| T::try_from_slice(&p).unwrap())
}

fn target_account(env: &Env, mint: &Pubkey) -> BurnTarget {
    let a = env.svm.get_account(&burn_target_pda(mint)).expect("burn target");
    BurnTarget::try_deserialize(&mut a.data.as_slice()).unwrap()
}

fn cranker(env: &mut Env) -> Keypair {
    let k = Keypair::new();
    env.fund(&k.pubkey(), SOL);
    k
}

// =================================================================================================================================
// the target burn end to end
// =================================================================================================================================

#[test]
fn a_target_coin_swaps_sol_for_the_target_on_the_pinned_pool_and_burns_it() {
    let mut env = Env::new();
    let w = world(&mut env);
    let (mint, _admin) = coin_with_target(&mut env, &w);
    let cfg = env.config(&config_pda(&mint));
    assert_eq!(cfg.burn_target_kind, BURN_TARGET_EXTERNAL);
    let bt = target_account(&env, &mint);
    assert_eq!((bt.target_mint, bt.pool, bt.amm_config, bt.wsol_vault, bt.target_vault, bt.observation), (w.target, w.pool.pool, w.pool.amm_config, w.pool.wsol_vault(), w.pool.token_vault(), w.pool.observation));

    read_and_fund(&mut env, &w, &mint, 3, 10 * SOL);
    // a few of the coin's own tokens reached the fee PDA (a creator fee in the coin): they burn too
    let me = env.payer.insecure_clone();
    env.mint_to(&mint, &me, &get_associated_token_address(&fee_pda(&mint), &mint), 1_234 * TOKEN);
    let (target_supply, coin_supply) = (env.mint_supply(&w.target), env.mint_supply(&mint));
    let (r_wsol, _) = cpmm::reserves(&env, &w.pool);
    let c = cranker(&mut env);
    refresh(&mut env, &w.pool);
    let meta = env.ok(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &w.pool, D2)], &[&c]);

    let rd = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap();
    let spend = math::buyback_spend(10 * SOL, 3, 500).unwrap();
    assert_eq!(rd.outcome, OUTCOME_BURNED);
    assert_eq!(rd.spent_lamports, spend);
    assert!(spend < math::reserve_spend_cap(r_wsol, MAX_SPEND_RESERVE_BPS));
    assert!(rd.got > 0 && rd.burned == rd.got);
    assert_eq!(rd.pool, w.pool.pool);
    assert_eq!(rd.owed, 1_234 * TOKEN, "a target reading records the coin's own burned tokens in `owed`");
    assert_eq!(env.mint_supply(&w.target), target_supply - rd.got, "the target's supply fell by what was bought");
    assert_eq!(env.mint_supply(&mint), coin_supply - 1_234 * TOKEN, "the coin's own fee tokens burned");
    assert_eq!(env.token_amount(&get_associated_token_address(&fee_pda(&mint), &w.target)), 0);

    let ev = event::<TargetBurned>(&meta).expect("TargetBurned");
    assert_eq!((ev.target_mint, ev.pool, ev.spent_lamports, ev.got, ev.target_burned, ev.own_burned), (w.target, w.pool.pool, spend, rd.got, rd.got, 1_234 * TOKEN));
    let memo = memo_v3(&meta);
    assert!(memo.ends_with("|v3"), "{memo}");
    assert!(memo.contains(&format!("|target={}|own=1234|", w.target)), "{memo}");
    assert!(memo.contains(&format!("|spent={spend}|got={}|burn={}|", math::raw_to_tokens(rd.got, DECIMALS), math::raw_to_tokens(rd.got, DECIMALS))), "{memo}");
    assert!(memo.len() <= MEMO_MAX_BYTES);

    let bt = target_account(&env, &mint);
    assert_eq!((bt.total_target_burned, bt.total_spent_lamports, bt.burns), (rd.got, spend, 1));
    let cfg = env.config(&config_pda(&mint));
    assert_eq!((cfg.total_burned, cfg.total_spent_lamports, cfg.crank_cursor), (1_234 * TOKEN, spend, D2));
}

#[test]
fn crank_buyback_refuses_a_coin_with_a_target() {
    let mut env = Env::new();
    let w = world(&mut env);
    let (mint, _) = coin_with_target(&mut env, &w);
    read_and_fund(&mut env, &w, &mint, 3, 10 * SOL);
    // give the coin a (stand-in) pool of its own so every account constraint passes: the refusal is the handler's first check
    let own_pool = Pubkey::new_unique();
    let key = config_pda(&mint);
    let mut cfg = env.config(&key);
    cfg.cpmm_pool = own_pool;
    cfg.pool_verified = true;
    let mut acc = env.svm.get_account(&key).unwrap();
    let mut data = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(&cfg, &mut data).unwrap();
    acc.data[..data.len()].copy_from_slice(&data);
    env.svm.set_account(key, acc).unwrap();
    let mut fake = w.pool;
    fake.pool = own_pool;
    let c = cranker(&mut env);
    expect_anchor_err(env.send(&[cpmm::ix_crank_buyback(&c.pubkey(), &mint, &fake, D2)], &[&c]), "BurnTargetSet");
}

#[test]
fn the_per_crank_spend_is_capped_at_two_percent_of_the_target_pools_sol_reserve() {
    let mut env = Env::new();
    let w = world(&mut env);
    let (mint, _) = coin_with_target(&mut env, &w);
    // 25 SOL basis (the default platform cap) at 10 units ≈ 10 SOL wanted; 2 % of ≈ 85 SOL ≈ 1.7 SOL allowed
    read_and_fund(&mut env, &w, &mint, 10, 40 * SOL);
    let (r_wsol, _) = cpmm::reserves(&env, &w.pool);
    let c = cranker(&mut env);
    refresh(&mut env, &w.pool);
    env.ok(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &w.pool, D2)], &[&c]);
    let rd = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap();
    let cap = math::reserve_spend_cap(r_wsol, MAX_SPEND_RESERVE_BPS);
    let want = math::buyback_spend(DEFAULT_BURN_POOL_CAP_LAMPORTS, 10, 500).unwrap();
    assert_eq!(rd.pool_lamports, DEFAULT_BURN_POOL_CAP_LAMPORTS);
    assert_eq!(rd.spent_lamports, cap);
    assert_eq!(rd.carried_out_lamports, want - cap);
    assert_eq!(env.config(&config_pda(&mint)).carried_spend_lamports, want - cap);
}

#[test]
fn another_pool_cannot_be_substituted_and_the_target_is_never_guessed() {
    let mut env = Env::new();
    let w = world(&mut env);
    let (mint, _) = coin_with_target(&mut env, &w);
    read_and_fund(&mut env, &w, &mint, 3, 10 * SOL);
    // a second, perfectly good pool of the same target on another AmmConfig
    let cfg1 = cpmm::create_amm_config(&mut env, 1);
    let other = target_pool(&mut env, &w.launcher, &cfg1, &w.target, 85 * SOL);
    let c = cranker(&mut env);
    refresh(&mut env, &other);
    expect_anchor_err(env.send(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &other, D2)], &[&c]), "TargetMismatch");
    // nor another target mint with the pinned pool
    let k = Keypair::new();
    let payer = env.payer.pubkey();
    env.create_mint(&k, &payer, DECIMALS);
    env.create_ata(&fee_pda(&mint), &k.pubkey());
    refresh(&mut env, &w.pool);
    expect_anchor_err(env.send(&[ix_crank_target(&c.pubkey(), &mint, &k.pubkey(), &w.pool, D2)], &[&c]), "TargetMismatch");
}

#[test]
fn a_pool_under_the_floor_holds_the_sol_then_the_queue_unblocks_after_thirty_days() {
    let mut env = Env::new();
    let w = world(&mut env);
    let (mint, _) = coin_with_target(&mut env, &w);
    read_and_fund(&mut env, &w, &mint, 3, 10 * SOL);
    // someone sells the target into the pool until its SOL reserve is under 50 SOL
    let me = env.payer.insecure_clone();
    let tata = get_associated_token_address(&w.trader.pubkey(), &w.target);
    env.mint_to(&w.target, &me, &tata, 700_000_000 * TOKEN);
    cpmm::swap(&mut env, &w.trader, &w.pool, &w.target, false, 700_000_000 * TOKEN).unwrap();
    let (r_wsol, _) = cpmm::reserves(&env, &w.pool);
    assert!(r_wsol < TARGET_MIN_WSOL_RESERVE_LAMPORTS, "{r_wsol}");
    let fee_before = env.lamports(&fee_pda(&mint));
    let c = cranker(&mut env);
    refresh(&mut env, &w.pool);
    expect_anchor_err(env.send(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &w.pool, D2)], &[&c]), "TargetPoolBelowFloor");
    assert_eq!(env.lamports(&fee_pda(&mint)), fee_before, "held, not lost");
    // 30 days after the reading: processed below-floor, the whole spend carried, nothing spent
    let submitted = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap().submitted_at;
    env.set_time(submitted + QUEUE_UNBLOCK_SECS);
    refresh(&mut env, &w.pool);
    env.ok(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &w.pool, D2)], &[&c]);
    let rd = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap();
    assert_eq!((rd.outcome, rd.spent_lamports, rd.burned), (OUTCOME_BELOW_FLOOR, 0, 0));
    assert_eq!(rd.carried_out_lamports, math::buyback_spend(10 * SOL, 3, 500).unwrap());
    assert_eq!(env.lamports(&fee_pda(&mint)), fee_before);
}

#[test]
fn a_fee_tier_raised_above_one_percent_after_the_pin_holds_the_sol_and_never_wedges() {
    let mut env = Env::new();
    let w = world(&mut env);
    let (mint, _) = coin_with_target(&mut env, &w);
    read_and_fund(&mut env, &w, &mint, 3, 10 * SOL);
    // Raydium's admin raises the AmmConfig's trade fee to 2 % (update_amm_config; written straight into the account here)
    let mut cfg = env.svm.get_account(&w.pool.amm_config).unwrap();
    cfg.data[12..20].copy_from_slice(&20_000u64.to_le_bytes());
    env.svm.set_account(w.pool.amm_config, cfg).unwrap();
    let fee_before = env.lamports(&fee_pda(&mint));
    let c = cranker(&mut env);
    refresh(&mut env, &w.pool);
    expect_anchor_err(env.send(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &w.pool, D2)], &[&c]), "TargetFeeTier");
    let submitted = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap().submitted_at;
    env.set_time(submitted + QUEUE_UNBLOCK_SECS);
    refresh(&mut env, &w.pool);
    env.ok(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &w.pool, D2)], &[&c]);
    let rd = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap();
    assert_eq!((rd.outcome, rd.spent_lamports), (OUTCOME_BELOW_FLOOR, 0));
    assert_eq!(env.lamports(&fee_pda(&mint)), fee_before);
}

#[test]
fn a_pool_that_disappears_holds_the_sol() {
    let mut env = Env::new();
    let w = world(&mut env);
    let (mint, _) = coin_with_target(&mut env, &w);
    read_and_fund(&mut env, &w, &mint, 3, 10 * SOL);
    // the pool account is gone (closed / replaced by junk at the same address)
    env.svm.set_account(w.pool.pool, litesvm_account(1_000_000, vec![0u8; 16], Pubkey::new_unique())).unwrap();
    let c = cranker(&mut env);
    expect_anchor_err(env.send(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &w.pool, D2)], &[&c]), "TargetPoolUnhealthy");
}

// =================================================================================================================================
// admission refusals
// =================================================================================================================================

/// Round-5 review R5-5: the args of a target coin's create — an end sink (the flagship) is required by pin_burn_target.
fn sink_args(rule: burn_receipts::state::RuleParams, attester: &Pubkey) -> burn_receipts::InitializeTokenArgs {
    let mut args = init_args(rule, vec![*attester], 1);
    if rule.mode == MODE_BUYBACK {
        args.end_sink_kind = END_SINK_FLAGSHIP;
        args.end_sink_min_lamports = 10_000_000;
    }
    args
}

/// initialize_token_r5 (with a flagship end sink) for a fresh policy-0 coin (its mint NOT created); returns the coin keypair.
fn fresh_coin(env: &mut Env, w: &World, rule: burn_receipts::state::RuleParams) -> Keypair {
    let kp = Keypair::new();
    let creator = Keypair::new();
    let payer = env.payer.pubkey();
    let platform = (rule.mode == MODE_BUYBACK && rule.pool_policy == POOL_POLICY_CREATOR_IS_FEE_PDA).then_some(TEST_LAUNCHLAB_PLATFORM);
    let mut args = sink_args(rule, &w.attester.pubkey());
    args.admin = creator.pubkey();
    env.ok(&[ix_initialize_r5(&payer, &creator.pubkey(), &kp.pubkey(), args, platform, None, false)], &[&creator, &kp]);
    kp
}

fn pin(env: &mut Env, kp: &Keypair, target: &Pubkey, p: &impl AsTp) -> TxResult {
    refresh(env, p);
    let payer = env.payer.pubkey();
    env.send(&[ix_pin(&payer, &kp.pubkey(), target, p)], &[kp])
}

#[test]
fn admission_refuses_token_2022_freeze_and_mint_authorities() {
    let mut env = Env::new();
    let w = world(&mut env);
    let payer = env.payer.pubkey();
    // a Token-2022 mint (a plain mint layout under the Token-2022 program id)
    let t22 = Pubkey::new_unique();
    let mut data = vec![0u8; spl_token::state::Mint::LEN];
    spl_token::state::Mint { mint_authority: None.into(), supply: 1, decimals: 6, is_initialized: true, freeze_authority: None.into() }.pack_into_slice(&mut data);
    env.svm.set_account(t22, litesvm_account(10_000_000, data, TOKEN_2022)).unwrap();
    let kp = fresh_coin(&mut env, &w, buyback_rule());
    expect_anchor_err(pin(&mut env, &kp, &t22, &w.pool), "TargetNotSplToken");
    // a freeze authority
    let f = Keypair::new();
    env.create_mint_full(&f, &payer, Some(&payer), DECIMALS);
    expect_anchor_err(pin(&mut env, &kp, &f.pubkey(), &w.pool), "TargetFreezeAuthority");
    // a mint authority
    let m = Keypair::new();
    env.create_mint_with_authority(&m, &payer, DECIMALS);
    expect_anchor_err(pin(&mut env, &kp, &m.pubkey(), &w.pool), "TargetMintAuthority");
    // the coin itself, and WSOL
    let own = kp.pubkey();
    expect_anchor_err(pin(&mut env, &kp, &own, &w.pool), "TargetIsSelf");
    expect_anchor_err(pin(&mut env, &kp, &NATIVE_MINT, &w.pool), "TargetNotAllowed");
}

#[test]
fn admission_refuses_a_wrong_mint_pool_a_thin_pool_and_a_high_fee_tier() {
    let mut env = Env::new();
    let w = world(&mut env);
    let payer = env.payer.pubkey();
    let kp = fresh_coin(&mut env, &w, buyback_rule());
    // a pool of ANOTHER token against WSOL
    let x = Keypair::new();
    env.create_mint(&x, &payer, DECIMALS);
    let cfg1 = cpmm::create_amm_config(&mut env, 1);
    let xpool = target_pool(&mut env, &w.launcher, &cfg1, &x.pubkey(), 85 * SOL);
    expect_anchor_err(pin(&mut env, &kp, &w.target, &xpool), "TargetPoolMints");
    // the right pool with another pool's vault, or an AmmConfig that is not the pool's
    let payer_k = env.payer.pubkey();
    expect_anchor_err(env.send(&[ix_pin_with(&payer_k, &kp.pubkey(), &w.target, w.pool.pool, w.pool.amm_config, xpool.wsol_vault(), w.pool.token_vault())], &[&kp]), "TargetPoolInvalid");
    expect_anchor_err(env.send(&[ix_pin_with(&payer_k, &kp.pubkey(), &w.target, w.pool.pool, cfg1, w.pool.wsol_vault(), w.pool.token_vault())], &[&kp]), "TargetPoolInvalid");
    // not a CPMM pool at all
    expect_anchor_err(env.send(&[ix_pin_with(&payer_k, &kp.pubkey(), &w.target, w.target, w.pool.amm_config, w.pool.wsol_vault(), w.pool.token_vault())], &[&kp]), "TargetPoolInvalid");
    // a thin pool (10 SOL) of the right pair
    let cfg2 = cpmm::create_amm_config(&mut env, 2);
    let thin = target_pool(&mut env, &w.launcher, &cfg2, &w.target, 10 * SOL);
    env.set_time(env.now() + 10); // a new pool opens one second after its creation
    expect_anchor_err(pin(&mut env, &kp, &w.target, &thin), "TargetPoolBelowFloor");
    // a 2 % tier
    let cfg3 = amm_config_with_fee(&mut env, 3, 20_000);
    let dear = target_pool(&mut env, &w.launcher, &cfg3, &w.target, 85 * SOL);
    env.set_time(env.now() + 10);
    expect_anchor_err(pin(&mut env, &kp, &w.target, &dear), "TargetFeeTier");
    // and the good pool still pins
    pin(&mut env, &kp, &w.target, &w.pool).unwrap();
}

#[test]
fn a_target_is_pinned_only_once_and_only_before_the_coin_exists() {
    let mut env = Env::new();
    let w = world(&mut env);
    let payer = env.payer.pubkey();
    let kp = fresh_coin(&mut env, &w, buyback_rule());
    pin(&mut env, &kp, &w.target, &w.pool).unwrap();
    expect_fail(pin(&mut env, &kp, &w.target, &w.pool)); // the BurnTarget account exists
    // a coin whose mint already exists cannot take a target
    let kp2 = fresh_coin(&mut env, &w, buyback_rule());
    env.create_mint(&kp2, &payer, DECIMALS);
    expect_anchor_err(pin(&mut env, &kp2, &w.target, &w.pool), "MintAlreadyCreated");
    // vault-mode coins have no burn pool
    let kp3 = fresh_coin(&mut env, &w, vault_rule());
    expect_anchor_err(pin(&mut env, &kp3, &w.target, &w.pool), "WrongMode");
    // and a self-burn coin's config is exactly round 4's: the target byte is zero
    let kp4 = fresh_coin(&mut env, &w, buyback_rule());
    assert_eq!(env.config(&config_pda(&kp4.pubkey())).burn_target_kind, BURN_TARGET_SELF);
}

// =================================================================================================================================
// re-pinning the pool (the target mint never changes)
// =================================================================================================================================

#[test]
fn the_pool_is_re_pinned_only_after_the_timelock_and_an_attester_can_veto() {
    let mut env = Env::new();
    let w = world(&mut env);
    let (mint, admin) = coin_with_target(&mut env, &w);
    let cfg1 = cpmm::create_amm_config(&mut env, 1);
    let next = target_pool(&mut env, &w.launcher, &cfg1, &w.target, 85 * SOL);
    let c = cranker(&mut env);
    // only the admin proposes
    expect_anchor_err(env.send(&[ix_target_admin("propose", &c.pubkey(), &mint, next.pool)], &[&c]), "NotAdmin");
    env.ok(&[ix_target_admin("propose", &admin.pubkey(), &mint, next.pool)], &[&admin]);
    refresh(&mut env, &next);
    expect_anchor_err(env.send(&[ix_apply_target(&c.pubkey(), &mint, &w.target, &next)], &[&c]), "TimelockNotElapsed");
    // an attester vetoes
    let att = w.attester.insecure_clone();
    env.fund(&att.pubkey(), SOL);
    env.ok(&[ix_veto_target(&att.pubkey(), &mint)], &[&att]);
    assert_eq!(target_account(&env, &mint).pending_eta, 0);
    // proposed again, applied after 48 h: the new pool passes the same admission
    env.ok(&[ix_target_admin("propose", &admin.pubkey(), &mint, next.pool)], &[&admin]);
    env.set_time(env.now() + ATTESTER_TIMELOCK_SECS);
    refresh(&mut env, &next);
    env.ok(&[ix_apply_target(&c.pubkey(), &mint, &w.target, &next)], &[&c]);
    let bt = target_account(&env, &mint);
    assert_eq!((bt.target_mint, bt.pool, bt.amm_config, bt.repins, bt.pending_eta), (w.target, next.pool, cfg1, 1, 0));
    // the crank now runs on the new pool, never the old one
    cpmm::seed_history(&mut env, &next, &w.target);
    read_and_fund(&mut env, &w, &mint, 3, 10 * SOL);
    refresh(&mut env, &w.pool);
    expect_anchor_err(env.send(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &w.pool, D2)], &[&c]), "TargetMismatch");
    refresh(&mut env, &next);
    env.ok(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &next, D2)], &[&c]);
    assert_eq!(env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap().pool, next.pool);
}

#[test]
fn a_re_pin_to_a_pool_that_fails_admission_is_refused() {
    let mut env = Env::new();
    let w = world(&mut env);
    let (mint, admin) = coin_with_target(&mut env, &w);
    let cfg2 = cpmm::create_amm_config(&mut env, 2);
    let thin = target_pool(&mut env, &w.launcher, &cfg2, &w.target, 10 * SOL);
    env.ok(&[ix_target_admin("propose", &admin.pubkey(), &mint, thin.pool)], &[&admin]);
    env.set_time(env.now() + ATTESTER_TIMELOCK_SECS);
    let c = cranker(&mut env);
    refresh(&mut env, &thin);
    expect_anchor_err(env.send(&[ix_apply_target(&c.pubkey(), &mint, &w.target, &thin)], &[&c]), "TargetPoolBelowFloor");
    // a proposal is dead 14 days after it was made
    let cfg1 = cpmm::create_amm_config(&mut env, 1);
    let good = target_pool(&mut env, &w.launcher, &cfg1, &w.target, 85 * SOL);
    env.ok(&[ix_target_admin("propose", &admin.pubkey(), &mint, good.pool)], &[&admin]);
    env.set_time(env.now() + POLICY_PROPOSAL_TTL_SECS + 1);
    refresh(&mut env, &good);
    expect_anchor_err(env.send(&[ix_apply_target(&c.pubkey(), &mint, &w.target, &good)], &[&c]), "PolicyProposalExpired");
}

// =================================================================================================================================
// the keeper's transaction shapes fit a legacy packet
// =================================================================================================================================

#[test]
fn the_target_crank_in_the_keepers_shape_fits_a_legacy_transaction() {
    let mut env = Env::new();
    let w = world(&mut env);
    let (mint, _) = coin_with_target(&mut env, &w);
    let amm = amm_pool(&mut env, &w.target, 85 * SOL);
    let c = Pubkey::new_unique();
    let fee = fee_pda(&mint);
    let ata = |m: &Pubkey| anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account_idempotent(&c, &fee, m, &spl_token::ID);
    for (name, crank) in [("cpmm", ix_crank_target(&c, &mint, &w.target, &w.pool, D2)), ("amm v4", ix_crank_target(&c, &mint, &w.target, &amm, D2))] {
        // the keeper's shape (src/lib/burnReceipts/crank.ts planCrank, kind "target"): CU + the fee PDA's three idempotent ATA creates +
        // SyncNative + the crank, with the two Pyth accounts; the smaller shapes are printed for the record.
        let alone = env.legacy_size(&[compute_budget(400_000), crank.clone()]);
        let one_create = env.legacy_size(&[compute_budget(400_000), ata(&w.target), crank.clone()]);
        let creates = env.legacy_size(&[compute_budget(400_000), ata(&NATIVE_MINT), ata(&mint), ata(&w.target)]);
        let sync = spl_token::instruction::sync_native(&spl_token::ID, &get_associated_token_address(&fee, &NATIVE_MINT)).unwrap();
        let full = env.legacy_size(&[compute_budget(400_000), ata(&NATIVE_MINT), ata(&mint), ata(&w.target), sync, crank.clone()]);
        println!("target crank ({name}): the keeper's full shape (CU + three ATA creates + SyncNative + crank) {full} B");
        assert!(full <= PACKET_DATA_SIZE, "{full}");
        println!("target crank ({name}): alone {alone} B, with one ATA create {one_create} B; the three creates {creates} B (limit {PACKET_DATA_SIZE})");
        assert!(alone <= PACKET_DATA_SIZE && creates <= PACKET_DATA_SIZE, "{alone} / {creates}");
    }
    // The launch flow for a target coin (with a separate payer, creator and admin, the real shape): initialize_token, then
    // pin_burn_target in its own transaction, both before the mint exists. Together they can run over the packet limit, so they are not
    // combined (the harness's coin_with_target combines them because its payer is also the creator).
    let kp = Keypair::new();
    let creator = Keypair::new();
    let mut args = sink_args(buyback_rule(), &w.attester.pubkey());
    args.admin = creator.pubkey();
    let init = ix_initialize_r5(&c, &creator.pubkey(), &kp.pubkey(), args, Some(TEST_LAUNCHLAB_PLATFORM), None, false);
    let init_alone = env.legacy_size(&[compute_budget(400_000), init.clone()]);
    assert!(init_alone <= PACKET_DATA_SIZE, "{init_alone}");
    for p in [w.pool.tp(), amm] {
        let together = env.legacy_size(&[init.clone(), ix_pin(&c, &kp.pubkey(), &w.target, &p)]);
        let pin_alone = env.legacy_size(&[compute_budget(400_000), ix_pin(&c, &kp.pubkey(), &w.target, &p)]);
        println!("initialize_token alone {init_alone} B; pin_burn_target alone {pin_alone} B; both {together} B");
        assert!(pin_alone <= PACKET_DATA_SIZE, "{pin_alone}");
    }
}

// =================================================================================================================================
// AMM v4 as the target pool (the real raydium-amm program, swap_base_in_v2)
// =================================================================================================================================

#[test]
fn an_amm_v4_target_burns_through_swap_base_in_v2_with_the_pyth_floor_on_its_output() {
    let mut env = Env::new();
    let w = world(&mut env);
    let amm = amm_pool(&mut env, &w.target, 85 * SOL);
    let (mint, _) = coin_with_target_on(&mut env, &w, &amm);
    let bt = target_account(&env, &mint);
    assert_eq!((bt.pool_kind, bt.pool, bt.amm_config, bt.observation, bt.wsol_vault, bt.target_vault, bt.target_feed_id), (TARGET_POOL_AMM_V4, amm.pool, amm.authority, amm.pool, amm.wsol_vault, amm.target_vault, TARGET_FEED));
    read_and_fund(&mut env, &w, &mint, 3, 10 * SOL);
    let supply = env.mint_supply(&w.target);
    let (r_wsol, r_tok) = reserves_of(&env, &amm);
    refresh(&mut env, &amm);
    let c = cranker(&mut env);
    let meta = env.ok(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &amm, D2)], &[&c]);
    let rd = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap();
    let spend = math::buyback_spend(10 * SOL, 3, 500).unwrap();
    assert_eq!((rd.outcome, rd.spent_lamports, rd.pool), (OUTCOME_BURNED, spend, amm.pool));
    assert!(spend <= math::reserve_spend_cap(r_wsol, MAX_SPEND_RESERVE_BPS));
    let ev = event::<TargetBurned>(&meta).expect("TargetBurned");
    let floor = math::buyback_min_out(spend, r_wsol, r_tok, ev.reference_x32, 2_500, 300).unwrap();
    assert!(rd.got >= floor && floor > 0, "got {} vs the Pyth floor {floor}", rd.got);
    assert_eq!(env.mint_supply(&w.target), supply - rd.got);
    assert_eq!(reserves_of(&env, &amm).0, r_wsol + spend, "the SOL went into the AMM's vault");
    assert!(memo_v3(&meta).contains(&format!("|swap={}|", &amm.pool.to_string()[..12])));
}

#[test]
fn a_jito_style_push_crank_push_back_is_refused_by_the_pyth_guard() {
    let mut env = Env::new();
    let w = world(&mut env);
    let amm = amm_pool(&mut env, &w.target, 85 * SOL);
    let (mint, _) = coin_with_target_on(&mut env, &w, &amm);
    read_and_fund(&mut env, &w, &mint, 3, 10 * SOL);
    refresh(&mut env, &amm); // Pyth reflects the market before the attack
    let c = cranker(&mut env);
    let fee_before = env.lamports(&fee_pda(&mint));
    // (1) the push as its own transaction (a bundle's first leg), then the crank: Pyth did not move, so the pushed pool is refused
    let before = env.token_amount(&get_associated_token_address(&w.trader.pubkey(), &w.target));
    env.ok(&[amm_swap_ix(&w.trader.pubkey(), &amm, &w.target, true, 10 * SOL)], &[&w.trader]);
    expect_anchor_err(env.send(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &amm, D2)], &[&c]), "TargetPriceDeviation");
    // (2) the push and the crank in one transaction (v0 through a lookup table, as a searcher would build it): refused the same way
    let fee = fee_pda(&mint);
    let lut = env.create_lookup_table(&[
        config_pda(&mint), reading_pda(&config_pda(&mint), D2), platform_pda(), burn_target_pda(&mint), fee, get_associated_token_address(&fee, &NATIVE_MINT),
        get_associated_token_address(&fee, &mint), get_associated_token_address(&fee, &w.target), NATIVE_MINT, event_authority(), sol_px(), tgt_px(), amm.authority,
    ]);
    expect_anchor_err(env.send_v0(&[amm_swap_ix(&w.trader.pubkey(), &amm, &w.target, true, SOL), ix_crank_target(&c.pubkey(), &mint, &w.target, &amm, D2)], &[&w.trader, &c], &[lut]), "TargetPriceDeviation");
    // (3) there is nothing to "record": the reference is Pyth's, and no trade on the pool reaches it. The push back restores the pool.
    let got = env.token_amount(&get_associated_token_address(&w.trader.pubkey(), &w.target)) - before;
    env.ok(&[amm_swap_ix(&w.trader.pubkey(), &amm, &w.target, false, got)], &[&w.trader]);
    assert_eq!(env.lamports(&fee_pda(&mint)), fee_before, "nothing left the fee PDA during the attack");
    // the same Pyth price, the pool back in line: the crank burns at the market
    let (r_wsol, r_tok) = reserves_of(&env, &amm);
    let spot = math::sol_price_x32(r_wsol, r_tok).unwrap();
    let px = burn_receipts::pyth::sol_price_x32(
        &burn_receipts::pyth::PythPrice { price: SOL_USD, conf: 0, exponent: -8, publish_time: 0 },
        &burn_receipts::pyth::PythPrice { price: i64::from_le_bytes(env.svm.get_account(&tgt_px()).unwrap().data[73..81].try_into().unwrap()), conf: 0, exponent: -12, publish_time: 0 },
        DECIMALS,
    )
    .unwrap();
    assert!(burn_receipts::pyth::within(spot, px, 300), "the pool is back within the guard");
    env.ok(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &amm, D2)], &[&c]);
    assert_eq!(env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap().outcome, OUTCOME_BURNED);
}

#[test]
fn after_the_platform_cap_sunsets_a_crank_spends_two_percent_of_the_pool_and_a_push_is_still_refused() {
    let mut env = Env::new();
    let w = world(&mut env);
    // a deep AMM v4 pool: 5,000 SOL (the 2 % cap is then 100 SOL a crank)
    let amm = amm_pool_with(&mut env, &w.target, 5_000 * SOL, 47_058_823_529 * TOKEN, 25, 10_000, 0, 6);
    let (mint, _) = coin_with_target_on(&mut env, &w, &amm);
    env.set_time(DEFAULT_CAP_SUNSET_TS + 60); // no PlatformConfig: the default 25 SOL cap is gone
    read_and_fund(&mut env, &w, &mint, 20, 200 * SOL);
    refresh(&mut env, &amm);
    let c = cranker(&mut env);
    // a push of ≈ 6 % in front of a 100 SOL crank is refused (the gain such a push could take grows with the crank; the guard does not)
    env.ok(&[amm_swap_ix(&w.trader.pubkey(), &amm, &w.target, true, 150 * SOL)], &[&w.trader]);
    expect_anchor_err(env.send(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &amm, D2)], &[&c]), "TargetPriceDeviation");
    refresh(&mut env, &amm); // the market moved for real (Pyth follows): the crank proceeds at the new price
    let (r_wsol, r_tok) = reserves_of(&env, &amm);
    let meta = env.ok(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &amm, D2)], &[&c]);
    let rd = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap();
    let cap = math::reserve_spend_cap(r_wsol, MAX_SPEND_RESERVE_BPS);
    assert_eq!(rd.pool_lamports, rd.pool_actual_lamports, "no platform cap after the sunset");
    assert_eq!(rd.spent_lamports, cap, "the 2 % reserve cap is the bound");
    assert!(cap > 25 * SOL);
    let ev = event::<TargetBurned>(&meta).unwrap();
    assert!(rd.got >= math::buyback_min_out(cap, r_wsol, r_tok, ev.reference_x32, 2_500, 300).unwrap());
}

// =================================================================================================================================
// the Pyth accounts
// =================================================================================================================================

#[test]
fn stale_wide_future_partial_or_foreign_pyth_accounts_never_price_a_crank() {
    let mut env = Env::new();
    let w = world(&mut env);
    let amm = amm_pool(&mut env, &w.target, 85 * SOL);
    let (mint, _) = coin_with_target_on(&mut env, &w, &amm);
    read_and_fund(&mut env, &w, &mint, 3, 10 * SOL);
    let c = cranker(&mut env);
    let fair = fair_e12(&env, &amm);
    let now = env.now();
    let crank = |env: &mut Env| env.send(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &amm, D2)], &[&c]);
    // stale (61 s) → held
    set_prices(&mut env, fair);
    write_pyth(&mut env, sol_px(), PYTH_SOL_USD_FEED_ID, SOL_USD, 0, -8, now - 61, true);
    expect_anchor_err(crank(&mut env), "PythStale");
    // a confidence of 2 % → held; a publish time in the future → held
    set_prices(&mut env, fair);
    write_pyth(&mut env, tgt_px(), TARGET_FEED, fair, (fair / 50) as u64, -12, now, true);
    expect_anchor_err(crank(&mut env), "PythUnusable");
    write_pyth(&mut env, tgt_px(), TARGET_FEED, fair, 0, -12, now + 3_600, true);
    expect_anchor_err(crank(&mut env), "PythUnusable");
    // partially verified, another feed, the SOL feed swapped in, or not the receiver's account → refused outright
    write_pyth(&mut env, tgt_px(), TARGET_FEED, fair, 0, -12, now, false);
    expect_anchor_err(crank(&mut env), "TargetPythInvalid");
    write_pyth(&mut env, tgt_px(), [0x78; 32], fair, 0, -12, now, true);
    expect_anchor_err(crank(&mut env), "TargetPythInvalid");
    set_prices(&mut env, fair);
    write_pyth(&mut env, sol_px(), TARGET_FEED, SOL_USD, 0, -8, now, true);
    expect_anchor_err(crank(&mut env), "TargetPythInvalid");
    set_prices(&mut env, fair);
    let mut a = env.svm.get_account(&tgt_px()).unwrap();
    a.owner = Pubkey::new_unique();
    env.svm.set_account(tgt_px(), a).unwrap();
    expect_anchor_err(crank(&mut env), "TargetPythInvalid");
    // a stale Pyth price for 30 days: the reading is processed below-floor with its spend carried, nothing spent
    let submitted = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap().submitted_at;
    env.set_time(submitted + QUEUE_UNBLOCK_SECS);
    let t = env.now();
    write_pyth(&mut env, sol_px(), PYTH_SOL_USD_FEED_ID, SOL_USD, 0, -8, t - 3_600, true);
    write_pyth(&mut env, tgt_px(), TARGET_FEED, fair, 0, -12, t - 3_600, true);
    env.ok(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &amm, D2)], &[&c]);
    let rd = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap();
    assert_eq!((rd.outcome, rd.spent_lamports), (OUTCOME_BELOW_FLOOR, 0));
    assert_eq!(rd.carried_out_lamports, math::buyback_spend(10 * SOL, 3, 500).unwrap());
}

#[test]
fn a_feed_that_is_not_the_pools_market_cannot_be_pinned() {
    let mut env = Env::new();
    let w = world(&mut env);
    let amm = amm_pool(&mut env, &w.target, 85 * SOL);
    let kp = fresh_coin(&mut env, &w, buyback_rule());
    let payer = env.payer.pubkey();
    let fair = fair_e12(&env, &amm);
    // a feed priced 10 % away from the pool (another token's feed, or the pool pushed at pin time) → refused
    for off in [fair * 110 / 100, fair * 90 / 100] {
        set_prices(&mut env, off);
        expect_anchor_err(env.send(&[ix_pin(&payer, &kp.pubkey(), &w.target, &amm)], &[&kp]), "TargetPriceDeviation");
    }
    // a stale feed → refused; the SOL feed as the target feed, or an empty feed id → refused
    set_prices(&mut env, fair);
    let now = env.now();
    write_pyth(&mut env, tgt_px(), TARGET_FEED, fair, 0, -12, now - 120, true);
    expect_anchor_err(env.send(&[ix_pin(&payer, &kp.pubkey(), &w.target, &amm)], &[&kp]), "PythStale");
    set_prices(&mut env, fair);
    let a = amm;
    for feed in [PYTH_SOL_USD_FEED_ID, [0u8; 32]] {
        expect_anchor_err(env.send(&[ix_pin_feed(&payer, &kp.pubkey(), &w.target, a.pool, a.config, a.wsol_vault, a.target_vault, feed)], &[&kp]), "TargetPythInvalid");
    }
    // in line with the market → pinned
    env.ok(&[ix_pin(&payer, &kp.pubkey(), &w.target, &amm)], &[&kp]);
}

#[test]
fn amm_v4_admission_refuses_a_pool_not_swap_only_a_high_fee_a_wrong_authority_and_a_reserve_under_the_floor_after_pnl() {
    let mut env = Env::new();
    let w = world(&mut env);
    let payer = env.payer.pubkey();
    let kp = fresh_coin(&mut env, &w, buyback_rule());
    // status Initialized (1, order book era) → refused; only swap-only pools
    let p1 = amm_pool_with(&mut env, &w.target, 85 * SOL, 800_000_000 * TOKEN, 25, 10_000, 0, 1);
    expect_anchor_err(pin(&mut env, &kp, &w.target, &p1), "TargetPoolUnhealthy");
    // a 2 % swap fee → refused
    let p2 = amm_pool_with(&mut env, &w.target, 85 * SOL, 800_000_000 * TOKEN, 200, 10_000, 0, 6);
    expect_anchor_err(pin(&mut env, &kp, &w.target, &p2), "TargetFeeTier");
    // 60 SOL in the vault but 20 SOL of it owed PnL → 40 SOL tradeable, under the 50 SOL floor → refused
    let p3 = amm_pool_with(&mut env, &w.target, 60 * SOL, 800_000_000 * TOKEN, 25, 10_000, 20 * SOL, 6);
    expect_anchor_err(pin(&mut env, &kp, &w.target, &p3), "TargetPoolBelowFloor");
    // the right pool with a wrong authority account → refused
    let good = amm_pool(&mut env, &w.target, 85 * SOL);
    refresh(&mut env, &good);
    expect_anchor_err(env.send(&[ix_pin_with(&payer, &kp.pubkey(), &w.target, good.pool, Pubkey::new_unique(), good.wsol_vault, good.target_vault)], &[&kp]), "TargetPoolInvalid");
    // a pool of another token → refused
    let x = Keypair::new();
    env.create_mint(&x, &payer, DECIMALS);
    let px = amm_pool(&mut env, &x.pubkey(), 85 * SOL);
    refresh(&mut env, &px);
    expect_anchor_err(env.send(&[ix_pin(&payer, &kp.pubkey(), &w.target, &px)], &[&kp]), "TargetPoolMints");
    // and the good pool pins
    pin(&mut env, &kp, &w.target, &good).unwrap();
}

#[test]
fn a_cpmm_target_is_re_pinned_to_an_amm_v4_pool_and_then_cranks_there() {
    let mut env = Env::new();
    let w = world(&mut env);
    let (mint, admin) = coin_with_target(&mut env, &w);
    let amm = amm_pool(&mut env, &w.target, 85 * SOL);
    env.ok(&[ix_target_admin("propose", &admin.pubkey(), &mint, amm.pool)], &[&admin]);
    env.set_time(env.now() + ATTESTER_TIMELOCK_SECS);
    let c = cranker(&mut env);
    refresh(&mut env, &amm);
    env.ok(&[ix_apply_target(&c.pubkey(), &mint, &w.target, &amm)], &[&c]);
    let bt = target_account(&env, &mint);
    assert_eq!((bt.pool_kind, bt.pool, bt.target_feed_id, bt.repins), (TARGET_POOL_AMM_V4, amm.pool, TARGET_FEED, 1));
    read_and_fund(&mut env, &w, &mint, 3, 10 * SOL);
    refresh(&mut env, &amm);
    // the CPMM pool and the CPMM program are refused now
    expect_anchor_err(env.send(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &w.pool, D2)], &[&c]), "TargetMismatch");
    let mut wrong_program = amm;
    wrong_program.program = CPMM_PROGRAM_ID;
    expect_anchor_err(env.send(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &wrong_program, D2)], &[&c]), "TargetMismatch");
    env.ok(&[ix_crank_target(&c.pubkey(), &mint, &w.target, &amm, D2)], &[&c]);
    assert_eq!(env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap().pool, amm.pool);
}

// =================================================================================================================================
// round-5 blind review fixes (2026-10-14)
// =================================================================================================================================

fn ix_release(cranker: &Pubkey, mint: &Pubkey) -> Instruction {
    let (fee, ffee) = (fee_pda(mint), fee_pda(&flagship_keypair().pubkey()));
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::ReleaseTarget {}.data(),
        burn_receipts::accounts::ReleaseTarget {
            cranker: *cranker,
            platform: platform_pda(),
            config: config_pda(mint),
            burn_target: burn_target_pda(mint),
            fee_vault: fee,
            fee_wsol: get_associated_token_address(&fee, &NATIVE_MINT),
            flagship_config: config_pda(&flagship_keypair().pubkey()),
            flagship_fee_vault: ffee,
            flagship_fee_wsol: get_associated_token_address(&ffee, &NATIVE_MINT),
            token_program: spl_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            memo_program: MEMO_PROGRAM_ID,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

/// The harness flagship's TokenConfig (legacy create in the test-pins build), marked as having a verified pool (written into the
/// account: release_target only needs it live and its fee PDA to receive SOL).
fn live_flagship(env: &mut Env, w: &World) {
    let fk = flagship_keypair();
    let creator = Keypair::new();
    let payer = env.payer.pubkey();
    let mut args = init_args(buyback_rule(), vec![w.attester.pubkey()], 1);
    args.admin = creator.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &fk.pubkey(), args)], &[&creator, &fk]);
    patch_cfg(env, &fk.pubkey(), |c| {
        c.cpmm_pool = Pubkey::new_unique();
        c.pool_verified = true;
    });
}

fn patch_cfg(env: &mut Env, mint: &Pubkey, f: impl FnOnce(&mut burn_receipts::state::TokenConfig)) {
    let key = config_pda(mint);
    let mut cfg = env.config(&key);
    f(&mut cfg);
    let mut acc = env.svm.get_account(&key).unwrap();
    let mut data = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(&cfg, &mut data).unwrap();
    acc.data[..data.len()].copy_from_slice(&data);
    env.svm.set_account(key, acc).unwrap();
}

/// Sells the target into the pinned CPMM pool until its SOL reserve is under the floor (the pool is "dead" for the target crank).
fn drain_pool(env: &mut Env, w: &World) {
    let me = env.payer.insecure_clone();
    let tata = get_associated_token_address(&w.trader.pubkey(), &w.target);
    env.mint_to(&w.target, &me, &tata, 700_000_000 * TOKEN);
    cpmm::swap(env, &w.trader, &w.pool, &w.target, false, 700_000_000 * TOKEN).unwrap();
    assert!(cpmm::reserves(env, &w.pool).0 < TARGET_MIN_WSOL_RESERVE_LAMPORTS);
}

/// R5-1: a target coin cranks without a registered pool of its own, so its end path waits for the result reading.
#[test]
fn r5_1_a_target_coins_end_burn_waits_for_its_result_reading() {
    let mut env = Env::new();
    let w = world(&mut env);
    let tp = w.pool.tp();
    let (mint, _) = coin_r5(&mut env, &w, &tp, buyback_rule(), END_SINK_INCINERATOR);
    assert_eq!(env.config(&config_pda(&mint)).cpmm_pool, Pubkey::default(), "no pool of its own");
    read_and_fund(&mut env, &w, &mint, 1, 10 * SOL);
    submit_rule_end(&mut env, &mint, D2, END_STATE_RESOLVED, &[&w.attester]).unwrap();
    let k = cranker(&mut env);
    expect_anchor_err(env.send(&[ix_burn_sol_on_end(&k.pubkey(), &mint, &INCINERATOR_ID)], &[&k]), "EndReadingsPending");
    // the result reading burns its target first, then the end burn runs
    refresh(&mut env, &w.pool);
    env.ok(&[ix_crank_target(&k.pubkey(), &mint, &w.target, &w.pool, D2)], &[&k]);
    let rd = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap();
    assert_eq!(rd.outcome, OUTCOME_BURNED);
    assert!(rd.spent_lamports > 0);
    env.ok(&[ix_burn_sol_on_end(&k.pubkey(), &mint, &INCINERATOR_ID)], &[&k]);
}

/// R5-2: a pool inside the deviation band but under the Pyth min-out (band 3 % wider than slippage 2.5 %) is HELD, so the 30-day
/// unblock runs instead of a permanent hard revert.
#[test]
fn r5_2_a_pool_inside_the_band_but_under_the_pyth_min_out_is_held_then_unblocked() {
    let mut env = Env::new();
    let w = world(&mut env);
    let mut rule = buyback_rule();
    rule.max_twap_deviation_bps = 300;
    rule.slippage_bps = 250;
    let tp = w.pool.tp();
    let (mint, _) = coin_r5(&mut env, &w, &tp, rule, END_SINK_FLAGSHIP);
    read_and_fund(&mut env, &w, &mint, 3, 10 * SOL);
    let k = cranker(&mut env);
    // Pyth says the target is 2.8 % cheaper than the pool: inside the 3 % band, under the 2.5 % min-out
    let basis = |env: &mut Env| {
        let e = fair_e12(env, &w.pool) * 972 / 1000;
        set_prices(env, e);
    };
    basis(&mut env);
    let fee_before = env.lamports(&fee_pda(&mint));
    expect_anchor_err(env.send(&[ix_crank_target(&k.pubkey(), &mint, &w.target, &w.pool, D2)], &[&k]), "TargetPriceDeviation");
    let submitted = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap().submitted_at;
    env.set_time(submitted + QUEUE_UNBLOCK_SECS);
    cpmm::seed_history(&mut env, &w.pool, &w.target);
    basis(&mut env);
    env.ok(&[ix_crank_target(&k.pubkey(), &mint, &w.target, &w.pool, D2)], &[&k]);
    let rd = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap();
    assert_eq!((rd.outcome, rd.spent_lamports), (OUTCOME_BELOW_FLOOR, 0));
    assert_eq!(rd.carried_out_lamports, math::buyback_spend(10 * SOL, 3, 500).unwrap());
    assert_eq!(env.lamports(&fee_pda(&mint)), fee_before, "held, not lost");
    let bt = target_account(&env, &mint);
    assert!(bt.last_unblocked_at > bt.last_burn_at);
}

/// R5-6: a dead target pool: after the 30-day unblock, release_target moves the carried spend to the flagship (permissionless; no
/// attester or admin involved). A target that burned since its last unblock is not stalled.
#[test]
fn r5_6_a_stalled_target_releases_its_carry_to_the_flagship() {
    let mut env = Env::new();
    let w = world(&mut env);
    live_flagship(&mut env, &w);
    let (mint, admin) = coin_with_target(&mut env, &w);
    // the admin is gone: no re-pin can ever happen
    env.ok(&[ix_admin("renounce", &admin.pubkey(), &mint, vec![], 0)], &[&admin]);
    read_and_fund(&mut env, &w, &mint, 3, 10 * SOL);
    drain_pool(&mut env, &w);
    let k = cranker(&mut env);
    expect_anchor_err(env.send(&[ix_release(&k.pubkey(), &mint)], &[&k]), "ReadingPending");
    let submitted = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap().submitted_at;
    env.set_time(submitted + QUEUE_UNBLOCK_SECS);
    refresh(&mut env, &w.pool);
    env.ok(&[ix_crank_target(&k.pubkey(), &mint, &w.target, &w.pool, D2)], &[&k]);
    let owed = env.config(&config_pda(&mint)).carried_spend_lamports;
    assert_eq!(owed, math::buyback_spend(10 * SOL, 3, 500).unwrap());
    let (fee_before, flag_before) = (env.lamports(&fee_pda(&mint)), env.lamports(&fee_pda(&flagship_keypair().pubkey())));
    let meta = env.ok(&[ix_release(&k.pubkey(), &mint)], &[&k]);
    assert_eq!(env.lamports(&fee_pda(&flagship_keypair().pubkey())), flag_before + owed);
    assert_eq!(env.lamports(&fee_pda(&mint)), fee_before - owed, "only the carried spend left the fee PDA");
    assert_eq!(env.config(&config_pda(&mint)).carried_spend_lamports, 0);
    assert!(meta.logs.iter().any(|l| l.contains("|release|to=") && l.contains(&format!("|lamports={owed}|left=0|v1"))));
    let ev = event::<burn_receipts::events::TargetReleased>(&meta).expect("TargetReleased");
    assert_eq!((ev.to_mint, ev.lamports, ev.carried_out_lamports), (flagship_keypair().pubkey(), owed, 0));
    expect_anchor_err(env.send(&[ix_release(&k.pubkey(), &mint)], &[&k]), "TargetNotStalled");
}

#[test]
fn r5_6_a_target_that_burns_is_never_released() {
    let mut env = Env::new();
    let w = world(&mut env);
    live_flagship(&mut env, &w);
    let (mint, _) = coin_with_target(&mut env, &w);
    // a cap-bound crank leaves a carry; the target is healthy
    read_and_fund(&mut env, &w, &mint, 10, 40 * SOL);
    refresh(&mut env, &w.pool);
    let k = cranker(&mut env);
    env.ok(&[ix_crank_target(&k.pubkey(), &mint, &w.target, &w.pool, D2)], &[&k]);
    assert!(env.config(&config_pda(&mint)).carried_spend_lamports > 0);
    env.set_time(env.now() + 2 * QUEUE_UNBLOCK_SECS);
    expect_anchor_err(env.send(&[ix_release(&k.pubkey(), &mint)], &[&k]), "TargetNotStalled");
}

/// R5-7: an update older than the last accepted one is refused, and the two feeds must be published within 60 s of each other.
#[test]
fn r5_7_pyth_never_goes_backwards_and_the_two_feeds_must_agree_in_time() {
    let mut env = Env::new();
    let w = world(&mut env);
    let (mint, _) = coin_with_target(&mut env, &w);
    read_and_fund(&mut env, &w, &mint, 3, 10 * SOL);
    let k = cranker(&mut env);
    env.set_time(env.now() + 30);
    refresh(&mut env, &w.pool);
    env.ok(&[ix_crank_target(&k.pubkey(), &mint, &w.target, &w.pool, D2)], &[&k]);
    let bt = target_account(&env, &mint);
    assert_eq!((bt.last_sol_publish_time, bt.last_target_publish_time), (env.now(), env.now()));
    let accepted = env.now();
    env.set_time(env.now() + 20);
    submit(&mut env, &mint, D3, units_value(5), &[&w.attester]).unwrap();
    let e = fair_e12(&env, &w.pool);
    // an update published BEFORE the last accepted one (still under 60 s old): refused
    write_pyth(&mut env, sol_px(), PYTH_SOL_USD_FEED_ID, SOL_USD, (SOL_USD / 1_000) as u64, -8, accepted - 1, true);
    write_pyth(&mut env, tgt_px(), TARGET_FEED, e, (e / 1_000) as u64, -12, accepted, true);
    expect_anchor_err(env.send(&[ix_crank_target(&k.pubkey(), &mint, &w.target, &w.pool, D3)], &[&k]), "PythWentBackwards");
    // both usable on their own (one 5 s ahead, one 56 s old) but 61 s apart: held
    let now = env.now();
    write_pyth(&mut env, sol_px(), PYTH_SOL_USD_FEED_ID, SOL_USD, (SOL_USD / 1_000) as u64, -8, now + 5, true);
    write_pyth(&mut env, tgt_px(), TARGET_FEED, e, (e / 1_000) as u64, -12, now - 56, true);
    expect_anchor_err(env.send(&[ix_crank_target(&k.pubkey(), &mint, &w.target, &w.pool, D3)], &[&k]), "PythFeedSkew");
    // a publish time more than 5 s ahead of the clock is unusable
    write_pyth(&mut env, sol_px(), PYTH_SOL_USD_FEED_ID, SOL_USD, (SOL_USD / 1_000) as u64, -8, now + 6, true);
    write_pyth(&mut env, tgt_px(), TARGET_FEED, e, (e / 1_000) as u64, -12, now, true);
    expect_anchor_err(env.send(&[ix_crank_target(&k.pubkey(), &mint, &w.target, &w.pool, D3)], &[&k]), "PythUnusable");
    // fresh, aligned updates (one TWAP window after the last swap): the crank runs
    env.set_time(env.now() + 601);
    refresh(&mut env, &w.pool);
    env.ok(&[ix_crank_target(&k.pubkey(), &mint, &w.target, &w.pool, D3)], &[&k]);
}

/// R5-5: pin_burn_target needs the coin's end sink (a round-4-shaped coin without one is refused).
#[test]
fn r5_5_pin_burn_target_requires_an_end_sink() {
    let mut env = Env::new();
    let w = world(&mut env);
    let kp = Keypair::new();
    let creator = Keypair::new();
    let payer = env.payer.pubkey();
    // the legacy create (kept only in the test-pins build) without an end sink
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &kp.pubkey(), init_args(buyback_rule(), vec![w.attester.pubkey()], 1))], &[&creator, &kp]);
    expect_anchor_err(pin(&mut env, &kp, &w.target, &w.pool), "LostPathBurnsSelf");
}

/// R5-12: the rollback fence. A target coin that registers its own pool keeps `pool_verified` false (a round-4 program refuses
/// crank_buyback on it: PoolNotVerified) and records the verification in burn_target_kind; round 5 still cranks its target.
#[test]
fn r5_12_a_target_coins_own_pool_registration_leaves_pool_verified_false() {
    let mut env = Env::new();
    let w = world(&mut env);
    let (mint, _) = coin_with_target(&mut env, &w);
    let payer = env.payer.pubkey();
    let me = env.payer.insecure_clone();
    let lt = env.create_ata(&w.launcher.pubkey(), &mint);
    env.mint_to(&mint, &me, &lt, 800_000_000 * TOKEN);
    let own = cpmm::create_pool(&mut env, &w.launcher, &cpmm::amm_config_0(), &mint, &fee_pda(&mint), 85 * SOL, 800_000_000 * TOKEN, &lt);
    cpmm::launchlab_migrated(&mut env, &mint, &own);
    env.ok(&[ix_register_pool(&payer, &mint, &own.pool)], &[]);
    let cfg = env.config(&config_pda(&mint));
    assert_eq!(cfg.cpmm_pool, own.pool);
    assert!(!cfg.pool_verified, "round 4 reads pool_verified: it must stay false for a target coin");
    assert_eq!(cfg.burn_target_kind, BURN_TARGET_EXTERNAL_POOL_VERIFIED);
    assert!(cfg.own_pool_verified() && cfg.burns_target());
    // registration cannot be repeated, crank_buyback still refuses it, and the target crank still runs
    expect_fail(env.send(&[ix_register_pool(&payer, &mint, &own.pool)], &[]));
    let k = cranker(&mut env);
    read_and_fund(&mut env, &w, &mint, 3, 10 * SOL);
    expect_anchor_err(env.send(&[cpmm::ix_crank_buyback(&k.pubkey(), &mint, &own, D2)], &[&k]), "BurnTargetSet");
    refresh(&mut env, &w.pool);
    env.ok(&[ix_crank_target(&k.pubkey(), &mint, &w.target, &w.pool, D2)], &[&k]);
    assert_eq!(env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap().outcome, OUTCOME_BURNED);
}

/// Second review (A): the price accounts are bound to the feeds' sponsored accounts. On a healthy target with an aged reading, an
/// authentic but STALE snapshot of the same feed at another address is refused outright and changes nothing (it can no longer force the
/// 30-day below-floor settlement); the sponsored, fresh account then swaps.
#[test]
fn a_stale_snapshot_cannot_force_the_thirty_day_carry_on_a_healthy_target() {
    let mut env = Env::new();
    let w = world(&mut env);
    let (mint, _) = coin_with_target(&mut env, &w);
    read_and_fund(&mut env, &w, &mint, 3, 10 * SOL);
    let submitted = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap().submitted_at;
    env.set_time(submitted + QUEUE_UNBLOCK_SECS + 86_400);
    cpmm::seed_history(&mut env, &w.pool, &w.target);
    refresh(&mut env, &w.pool);
    // an authentic snapshot of the target feed, an hour old, posted into another receiver account
    let stale = Pubkey::new_unique();
    let e = fair_e12(&env, &w.pool);
    let t = env.now();
    write_pyth(&mut env, stale, TARGET_FEED, e, (e / 1_000) as u64, -12, t - 3_600, true);
    let k = cranker(&mut env);
    let mut ix = ix_crank_target(&k.pubkey(), &mint, &w.target, &w.pool, D2);
    let at = ix.accounts.iter().position(|m| m.pubkey == tgt_px()).unwrap();
    ix.accounts[at].pubkey = stale;
    let (cfg_before, fee_before) = (env.config(&config_pda(&mint)), env.lamports(&fee_pda(&mint)));
    expect_anchor_err(env.send(&[ix], &[&k]), "TargetPythInvalid");
    let rd = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap();
    assert!(!rd.processed, "nothing settled");
    assert_eq!((env.config(&config_pda(&mint)).crank_cursor, env.lamports(&fee_pda(&mint))), (cfg_before.crank_cursor, fee_before));
    // the sponsored, fresh account: the swap runs
    env.ok(&[ix_crank_target(&k.pubkey(), &mint, &w.target, &w.pool, D2)], &[&k]);
    let rd = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap();
    assert_eq!(rd.outcome, OUTCOME_BURNED);
    assert!(rd.spent_lamports > 0);
}

/// Second review (B): a target mint with more than 18 decimals is refused at admission.
#[test]
fn a_target_with_more_than_eighteen_decimals_is_refused() {
    let mut env = Env::new();
    let w = world(&mut env);
    let payer = env.payer.pubkey();
    let m = Keypair::new();
    env.create_mint_full(&m, &payer, None, 19);
    env.ok(&[spl_token::instruction::set_authority(&spl_token::ID, &m.pubkey(), None, spl_token::instruction::AuthorityType::MintTokens, &payer, &[]).unwrap()], &[]);
    let kp = fresh_coin(&mut env, &w, buyback_rule());
    expect_anchor_err(pin(&mut env, &kp, &m.pubkey(), &w.pool), "TargetDecimalsTooLarge");
}

/// Round-5 review R5-9, end to end with a REAL pin: a coin whose end sink names a target coin that pinned its BurnTarget through
/// pin_burn_target and has no pool of its own (pre-graduation) forwards its fuel to that coin after a RESOLVED end (before R5-9 the
/// target coin was "not live" and the fuel fell to the flagship).
#[test]
fn r5_9_an_end_sink_naming_a_pinned_target_coin_receives_the_fuel() {
    let mut env = Env::new();
    let w = world(&mut env);
    let (t, _) = coin_with_target(&mut env, &w);
    let tc = env.config(&config_pda(&t));
    assert!(tc.burn_target_kind == BURN_TARGET_EXTERNAL && !tc.own_pool_verified() && tc.cpmm_pool == Pubkey::default());
    // the ending coin: an end sink naming the target coin, no pool of its own
    let kc = Keypair::new();
    let creator = Keypair::new();
    let mut args = init_args(buyback_rule(), vec![w.attester.pubkey()], 1);
    args.admin = creator.pubkey();
    args.end_sink_kind = END_SINK_MINT;
    args.end_sink_mint = Some(t);
    args.end_sink_min_lamports = 10_000_000;
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize_r5(&payer, &creator.pubkey(), &kc.pubkey(), args, Some(TEST_LAUNCHLAB_PLATFORM), None, false)], &[&creator, &kc]);
    let c = kc.pubkey();
    submit(&mut env, &c, D1, V1, &[&w.attester]).unwrap();
    env.transfer_sol(&fee_pda(&c), SOL);
    submit_rule_end(&mut env, &c, D1, END_STATE_RESOLVED, &[&w.attester]).unwrap();
    let k = cranker(&mut env);
    let ft = env.lamports(&fee_pda(&t));
    let meta = env.ok(&[ix_forward_on_end(&k.pubkey(), &c, &t, Some(t), None)], &[&k]);
    let ev: burn_receipts::events::ForwardedOnEnd = event(&meta).unwrap();
    assert_eq!((ev.to_mint, ev.intended_mint, ev.sink_kind, ev.lamports), (t, t, END_SINK_MINT, SOL));
    assert_eq!(env.lamports(&fee_pda(&t)) - ft, SOL, "the target coin's fee PDA holds the fuel; its crank_target_burn spends it");
}
