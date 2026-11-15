//! Round 5 (owner, 2026-10-13): a coin that burns ANOTHER token (docs/burnticker/EXTERNAL-BURN.md).
//!
//! A coin may name a burn target at creation: an existing plain SPL token (WIF, BONK, ...), its Pyth price feed, and ONE pool of it against
//! WSOL — a Raydium CPMM pool or a Raydium AMM v4 pool (swap-only). The coin's burn pool (its fee SOL) is then spent on the target instead
//! of on itself: each crank swaps SOL for the target on the PINNED pool and burns everything it received from the fee PDA's own token
//! account for the target, in the same instruction, with a memo naming the target mint. The rule, the share, the carried spend,
//! pair forwarding and end sinks are SOL-level and unchanged.
//!
//!   pin_burn_target     MINT-SIGNED, once, and only while the coin's mint account does not exist yet (before LaunchLab or pair_curve
//!                       creates it): nobody can ever hold the coin under one target and see it switched. Admission: the target is a
//!                       plain SPL Token mint (Token-2022 refused) with no mint authority and no freeze authority; the pool's mints are
//!                       exactly {target, WSOL} on SPL Token, its fee at most 1 %, its SOL reserve at least the floor, swaps on (CPMM)
//!                       or swap-only status (AMM v4); the pinned Pyth feed is fresh, tight, and the pool's spot price is within the
//!                       rule's deviation of the Pyth target/SOL ratio NOW (so a wrong feed cannot be pinned). The pool's LP need not be
//!                       locked (it is not ours). Sets TokenConfig.burn_target_kind = EXTERNAL (the byte that was `reserved`).
//!   crank_target_burn   PERMISSIONLESS, the target coin's crank (crank_buyback refuses a target coin). The same spend as
//!                       crank_buyback (rule, carried spend; no platform cap since 2026-10-25). The price guard is PYTH for both pool kinds: the pool's spot
//!                       must be within the rule's deviation of the Pyth ratio (two-sided), and the minimum output is the larger of the
//!                       spot and Pyth quotes less fee and slippage; a CPMM pool's own TWAP is checked as well. The whole spend in one crank
//!                       (the 2 % per-crank bound was removed on 2026-10-25); post-CPI integrity checks. A pool that is gone, disabled, changed, above
//!                       the fee bound or under the floor, a stale or wide Pyth price, or a pool price away from Pyth refuses the crank
//!                       (the SOL is held, not lost); once the reading is 30 days old it is processed below-floor with its whole spend
//!                       carried, so the queue never wedges.
//!   propose / cancel / veto / apply_target_pool     The target MINT and its FEED are immutable. The POOL may be re-pinned (either kind):
//!                       the admin proposes (48 h timelock), any current attester vetoes, anyone applies within 14 days of the
//!                       proposal, and the new pool must pass the same admission, Pyth check included.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::system_program;
use anchor_spl::token::{self, spl_token, Burn, Mint, SyncNative, Token, TokenAccount};

use crate::amm_v4::{self, AmmV4SwapAccounts, AmmV4View, AMM_STATUS_SWAP_ONLY};
use crate::constants::*;
use crate::cpmm::{self, AmmConfigView, PoolView, SwapAccounts};
use crate::error::BurnError;
use crate::events::{BurnTargetPinned, ReadingProcessed, SpendCarried, TargetBurned, TargetPoolProposalCancelled, TargetPoolProposed, TargetPoolRepinned};
use crate::guards::{require_fee_pda_intact, require_fee_token_account_intact};
use crate::instructions::crank_buyback::{CARRY_REASON_BELOW_FLOOR, CARRY_REASON_POOL_UNTRADEABLE};
use crate::instructions::crank_common::{memo_head, require_fixed_supply, require_next_in_line};
use crate::math;
use crate::memo;
use crate::pyth;
use crate::state::{BurnTarget, Reading, TokenConfig};

/// What admission pins for a target pool (all read from the pool account itself).
#[derive(Debug, Clone, Copy)]
pub struct TargetPins {
    pub kind: u8,
    pub pool: Pubkey,
    /// CPMM: the AmmConfig. AMM v4: the vault authority PDA.
    pub amm_config: Pubkey,
    pub wsol_vault: Pubkey,
    pub target_vault: Pubkey,
    /// CPMM: the observation account. AMM v4: the pool itself.
    pub observation: Pubkey,
    /// WSOL is the pool's first side (CPMM token_0 / AMM v4 coin).
    pub wsol_is_token_0: bool,
    /// The pool's SOL reserve net of owed fees / PnL at admission.
    pub wsol_reserve: u64,
}

/// SPL Token amount of a token account (owner SPL Token checked; the caller key-checks it against the pool).
fn spl_amount(acc: &AccountInfo) -> Result<u64> {
    require_keys_eq!(*acc.owner, token::ID, BurnError::InvalidCpmmAccount);
    let d = acc.try_borrow_data()?;
    Ok(spl_token::state::Account::unpack(&d).map_err(|_| BurnError::InvalidCpmmAccount)?.amount)
}

/// The target mint: a plain SPL Token mint (never Token-2022: no transfer fees, hooks or permanent delegates), initialised, with no
/// mint authority (a burn of a token anyone can re-mint means nothing) and no freeze authority (a freeze of the fee PDA's account would
/// wedge every later crank). Neither authority can be added back once it is None. Returns the decimals.
pub fn admit_target_mint(target: &AccountInfo, coin_mint: &Pubkey) -> Result<u8> {
    require!(*target.key != *coin_mint, BurnError::TargetIsSelf);
    require!(*target.key != NATIVE_MINT && *target.key != Pubkey::default(), BurnError::TargetNotAllowed);
    require_keys_eq!(*target.owner, token::ID, BurnError::TargetNotSplToken);
    let d = target.try_borrow_data()?;
    let m = spl_token::state::Mint::unpack(&d).map_err(|_| BurnError::TargetNotSplToken)?;
    require!(m.freeze_authority.is_none(), BurnError::TargetFreezeAuthority);
    require!(m.mint_authority.is_none(), BurnError::TargetMintAuthority);
    // Second review (B): receipts format any decimals, but a target past 18 is refused outright.
    require!(m.decimals <= TARGET_MAX_DECIMALS, BurnError::TargetDecimalsTooLarge);
    Ok(m.decimals)
}

/// The pool half of admission (pin and re-pin), by the pool account's owner:
///   CPMM: a PoolState whose mints are exactly {target, WSOL} on SPL Token, swaps enabled now, `config` = its AmmConfig with a fee (trade
///         + creator fee when charged) of at most TARGET_MAX_FEE_PPM;
///   AMM v4: an AmmInfo (752 bytes) in SWAP-ONLY status, mints {target, WSOL}, `config` = its vault authority PDA, swap fee ≤ 1 %;
/// and for both the WSOL vault passed is the pool's and holds at least TARGET_MIN_WSOL_RESERVE_LAMPORTS net of owed fees / PnL. No
/// LP-lock or creator check: the pool is not ours.
pub fn admit_target_pool(pool_acc: &AccountInfo, config: &AccountInfo, wsol_vault: &AccountInfo, target_mint: &Pubkey, now: i64) -> Result<TargetPins> {
    if *pool_acc.owner == AMM_V4_PROGRAM_ID {
        let p = AmmV4View::load(pool_acc)?;
        let wsol_coin = p.wsol_is_coin(&NATIVE_MINT, target_mint).ok_or(BurnError::TargetPoolMints)?;
        require!(p.status == AMM_STATUS_SWAP_ONLY, BurnError::TargetPoolUnhealthy);
        require_keys_eq!(*config.key, p.authority().ok_or(BurnError::TargetPoolInvalid)?, BurnError::TargetPoolInvalid);
        require!(p.fee_ppm().ok_or(BurnError::TargetFeeTier)? <= TARGET_MAX_FEE_PPM, BurnError::TargetFeeTier);
        let (wv, tv, wpnl, _) = p.sides(wsol_coin);
        require_keys_eq!(*wsol_vault.key, wv, BurnError::TargetPoolInvalid);
        let reserve = spl_amount(wsol_vault)?.saturating_sub(wpnl);
        require!(reserve >= TARGET_MIN_WSOL_RESERVE_LAMPORTS, BurnError::TargetPoolBelowFloor);
        return Ok(TargetPins { kind: TARGET_POOL_AMM_V4, pool: *pool_acc.key, amm_config: *config.key, wsol_vault: wv, target_vault: tv, observation: *pool_acc.key, wsol_is_token_0: wsol_coin, wsol_reserve: reserve });
    }
    let pool = PoolView::try_load(pool_acc).ok_or(BurnError::TargetPoolInvalid)?;
    let wsol0 = pool.wsol_is_token_0(&NATIVE_MINT, target_mint).ok_or(BurnError::TargetPoolMints)?;
    require!(pool.token_0_program == token::ID && pool.token_1_program == token::ID, BurnError::TargetPoolMints);
    require!(pool.swaps_enabled(now), BurnError::TargetPoolUnhealthy);
    require_keys_eq!(*config.key, pool.amm_config, BurnError::TargetPoolInvalid);
    let cfg = AmmConfigView::load(config)?;
    let fee_ppm = cfg.trade_fee_rate.saturating_add(if pool.enable_creator_fee { cfg.creator_fee_rate } else { 0 });
    require!(fee_ppm <= TARGET_MAX_FEE_PPM, BurnError::TargetFeeTier);
    let (wsol_vault_key, target_vault_key, wsol_fees) = if wsol0 { (pool.token_0_vault, pool.token_1_vault, pool.fees_0) } else { (pool.token_1_vault, pool.token_0_vault, pool.fees_1) };
    require_keys_eq!(*wsol_vault.key, wsol_vault_key, BurnError::TargetPoolInvalid);
    let reserve = spl_amount(wsol_vault)?.saturating_sub(wsol_fees);
    require!(reserve >= TARGET_MIN_WSOL_RESERVE_LAMPORTS, BurnError::TargetPoolBelowFloor);
    Ok(TargetPins {
        kind: TARGET_POOL_CPMM,
        pool: *pool_acc.key,
        amm_config: pool.amm_config,
        wsol_vault: wsol_vault_key,
        target_vault: target_vault_key,
        observation: pool.observation_key,
        wsol_is_token_0: wsol0,
        wsol_reserve: reserve,
    })
}

/// A Pyth reference and the publish times it was built from.
#[derive(Debug, Clone, Copy)]
pub struct PythRef {
    /// Target raw units per lamport × 2^32.
    pub reference: u128,
    pub sol_publish_time: i64,
    pub target_publish_time: i64,
}

/// The Pyth reference (target raw per lamport × 2^32) from the two price-update accounts, or the hold reason. A wrong account is an Err.
/// Round-5 review R5-7: the two updates must be published within PYTH_MAX_FEED_SKEW_SECS of each other (else held: PythFeedSkew).
/// Second review (A): both accounts must be the feeds' SPONSORED push-oracle accounts (address-checked: a hard refusal). The caller then
/// chooses nothing: whatever those maintained accounts hold (stale, wide, missing, not fully verified) is the feed's own state and a
/// HOLD, so the 30-day unblock rests on the feed really being dead, never on a stale snapshot the caller picked.
pub fn pyth_reference(sol_acc: &AccountInfo, target_acc: &AccountInfo, target_feed: &[u8; 32], target_decimals: u8, now: i64) -> Result<core::result::Result<PythRef, BurnError>> {
    require_keys_eq!(*sol_acc.key, pyth::sponsored_address(&PYTH_SOL_USD_FEED_ID), BurnError::TargetPythInvalid);
    require_keys_eq!(*target_acc.key, pyth::sponsored_address(target_feed), BurnError::TargetPythInvalid);
    let sol = match pyth::read_price(sol_acc, &PYTH_SOL_USD_FEED_ID, now) {
        Ok(Ok(p)) => p,
        Ok(Err(why)) => return Ok(Err(why)),
        Err(_) => return Ok(Err(BurnError::TargetPythInvalid)),
    };
    let tgt = match pyth::read_price(target_acc, target_feed, now) {
        Ok(Ok(p)) => p,
        Ok(Err(why)) => return Ok(Err(why)),
        Err(_) => return Ok(Err(BurnError::TargetPythInvalid)),
    };
    if !pyth::feeds_aligned(&sol, &tgt) {
        return Ok(Err(BurnError::PythFeedSkew));
    }
    Ok(pyth::sol_price_x32(&sol, &tgt, target_decimals)
        .map(|reference| PythRef { reference, sol_publish_time: sol.publish_time, target_publish_time: tgt.publish_time })
        .ok_or(BurnError::PythUnusable))
}

/// Round-5 review R5-7: an update older than the last one this coin accepted is refused outright (a cranker-chosen account: a fresher
/// one exists, so this is never a hold).
fn require_pyth_not_backwards(t: &BurnTarget, r: &PythRef) -> Result<()> {
    require!(r.sol_publish_time >= t.last_sol_publish_time && r.target_publish_time >= t.last_target_publish_time, BurnError::PythWentBackwards);
    Ok(())
}

fn record_pyth(t: &mut BurnTarget, r: &PythRef) {
    t.last_sol_publish_time = t.last_sol_publish_time.max(r.sol_publish_time);
    t.last_target_publish_time = t.last_target_publish_time.max(r.target_publish_time);
}

/// The pool's tradeable reserves (WSOL, target) right now, for an admitted pool of either kind (keys checked by the caller).
fn reserves_of(kind: u8, pool_acc: &AccountInfo, wsol_vault: &AccountInfo, target_vault: &AccountInfo, wsol_first: bool) -> Result<(u64, u64)> {
    let (wf, tf) = if kind == TARGET_POOL_AMM_V4 {
        let p = AmmV4View::load(pool_acc)?;
        let (_, _, w, t) = p.sides(wsol_first);
        (w, t)
    } else {
        let p = PoolView::load(pool_acc)?;
        if wsol_first { (p.fees_0, p.fees_1) } else { (p.fees_1, p.fees_0) }
    };
    let r_wsol = spl_amount(wsol_vault)?.checked_sub(wf).ok_or(BurnError::EmptyReserves)?;
    let r_tok = spl_amount(target_vault)?.checked_sub(tf).ok_or(BurnError::EmptyReserves)?;
    require!(r_wsol > 0 && r_tok > 0, BurnError::EmptyReserves);
    Ok((r_wsol, r_tok))
}

#[allow(clippy::too_many_arguments)]
/// Pin / re-pin: the Pyth feed must be usable NOW and the pool's spot within the rule's deviation of it (two-sided), so a feed that is
/// not this token's market (or a pool pushed at pin time) is refused. Returns (reference, spot).
fn require_pool_matches_pyth(pins: &TargetPins, pool_acc: &AccountInfo, wsol_vault: &AccountInfo, target_vault: &AccountInfo, sol_acc: &AccountInfo, target_acc: &AccountInfo, feed: &[u8; 32], decimals: u8, max_dev_bps: u16, now: i64) -> Result<(PythRef, u128)> {
    require_keys_eq!(*target_vault.key, pins.target_vault, BurnError::TargetPoolInvalid);
    let reference = match pyth_reference(sol_acc, target_acc, feed, decimals, now)? {
        Ok(r) => r,
        Err(why) => return Err(why.into()),
    };
    let (r_wsol, r_tok) = reserves_of(pins.kind, pool_acc, wsol_vault, target_vault, pins.wsol_is_token_0)?;
    let spot = math::sol_price_x32(r_wsol, r_tok).map_err(|_| BurnError::EmptyReserves)?;
    require!(pyth::within(spot, reference.reference, max_dev_bps), BurnError::TargetPriceDeviation);
    Ok((reference, spot))
}

fn write_pins(t: &mut BurnTarget, p: &TargetPins) {
    t.pool_kind = p.kind;
    t.pool = p.pool;
    t.amm_config = p.amm_config;
    t.wsol_vault = p.wsol_vault;
    t.target_vault = p.target_vault;
    t.observation = p.observation;
    t.wsol_is_token_0 = p.wsol_is_token_0;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// pin_burn_target
// ---------------------------------------------------------------------------------------------------------------------------------

#[event_cpi]
#[derive(Accounts)]
pub struct PinBurnTarget<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the coin's mint ADDRESS, which must SIGN (only the launch flow holding the mint keypair) and must NOT exist yet
    /// (system-owned, no data): the target is fixed before anyone can hold the coin.
    pub mint: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, mint.key().as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(init, payer = payer, space = 8 + BurnTarget::INIT_SPACE, seeds = [BURN_TARGET_SEED, mint.key().as_ref()], bump)]
    pub burn_target: Box<Account<'info, BurnTarget>>,
    /// CHECK: the target mint (admit_target_mint).
    pub target_mint: UncheckedAccount<'info>,
    /// CHECK: the target's CPMM or AMM v4 pool (admit_target_pool, by owner).
    pub target_pool: UncheckedAccount<'info>,
    /// CHECK: CPMM: the pool's AmmConfig; AMM v4: the pool's vault authority PDA (key-checked against the pool).
    pub target_amm_config: UncheckedAccount<'info>,
    /// CHECK: the pool's WSOL vault (key-checked against the pool; read as an SPL Token account for the floor).
    pub target_wsol_vault: UncheckedAccount<'info>,
    /// CHECK: the pool's target vault (key-checked against the pool; read for the spot price).
    pub target_token_vault: UncheckedAccount<'info>,
    /// CHECK: a Pyth PriceUpdateV2 of SOL/USD (owner, discriminator, Full verification, feed id checked in pyth::read_price).
    pub sol_price_update: UncheckedAccount<'info>,
    /// CHECK: a Pyth PriceUpdateV2 of the target's feed (`target_feed_id`), checked the same way.
    pub target_price_update: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: round-5 review R5-5: the coin's EndSink ["end_sink", mint] (address-checked). It must exist (written by
    /// initialize_token_r5 earlier in the same create): a target coin's lost path goes to its sink, never to a self wind-down.
    #[account(address = crate::state::end_sink_address(&mint.key()).0 @ BurnError::LostPathBurnsSelf)]
    pub end_sink: UncheckedAccount<'info>,
}

pub fn handle_pin_burn_target(ctx: Context<PinBurnTarget>, target_feed_id: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let mint = ctx.accounts.mint.key();
    {
        let m = ctx.accounts.mint.to_account_info();
        require!(m.owner == &system_program::ID && m.data_is_empty(), BurnError::MintAlreadyCreated);
    }
    let c = &ctx.accounts.config;
    require!(c.rule.mode == MODE_BUYBACK, BurnError::WrongMode);
    require!(c.burn_target_kind == BURN_TARGET_SELF, BurnError::BurnTargetAlreadyPinned);
    require!(c.readings == 0 && c.burns == 0 && !c.pool_verified, BurnError::BurnTargetAlreadyPinned);
    // Round-5 review R5-5: a target coin's lost path goes to its end sink (initialize_token_r5 wrote it), never a self wind-down.
    {
        let s = ctx.accounts.end_sink.to_account_info();
        require!(s.owner == &crate::ID && !s.data_is_empty(), BurnError::LostPathBurnsSelf);
    }
    require!(target_feed_id != [0u8; 32] && target_feed_id != PYTH_SOL_USD_FEED_ID, BurnError::TargetPythInvalid);
    let max_dev = c.rule.max_twap_deviation_bps;
    let target_mint = ctx.accounts.target_mint.key();
    let decimals = admit_target_mint(&ctx.accounts.target_mint.to_account_info(), &mint)?;
    let a = &ctx.accounts;
    let pins = admit_target_pool(&a.target_pool.to_account_info(), &a.target_amm_config.to_account_info(), &a.target_wsol_vault.to_account_info(), &target_mint, now)?;
    let (reference, spot) = require_pool_matches_pyth(
        &pins,
        &a.target_pool.to_account_info(),
        &a.target_wsol_vault.to_account_info(),
        &a.target_token_vault.to_account_info(),
        &a.sol_price_update.to_account_info(),
        &a.target_price_update.to_account_info(),
        &target_feed_id,
        decimals,
        max_dev,
        now,
    )?;
    let t = &mut ctx.accounts.burn_target;
    t.version = 1;
    t.bump = ctx.bumps.burn_target;
    t.mint = mint;
    t.target_mint = target_mint;
    t.target_decimals = decimals;
    t.target_feed_id = target_feed_id;
    write_pins(t, &pins);
    t.pinned_at = now;
    t.total_target_burned = 0;
    t.total_spent_lamports = 0;
    t.burns = 0;
    t.repins = 0;
    t.pending_pool = Pubkey::default();
    t.pending_eta = 0;
    t.last_sol_publish_time = reference.sol_publish_time;
    t.last_target_publish_time = reference.target_publish_time;
    t.last_burn_at = 0;
    t.last_unblocked_at = 0;
    ctx.accounts.config.burn_target_kind = BURN_TARGET_EXTERNAL;
    let config = ctx.accounts.config.key();
    emit_cpi!(BurnTargetPinned { config, mint, target_mint, pool: pins.pool, pool_kind: pins.kind, amm_config: pins.amm_config, target_feed_id, wsol_reserve_lamports: pins.wsol_reserve, reference_x32: reference.reference, spot_x32: spot });
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------------------------
// crank_target_burn
// ---------------------------------------------------------------------------------------------------------------------------------

#[event_cpi]
#[derive(Accounts)]
#[instruction(record_date: u32)]
pub struct CrankTargetBurn<'info> {
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [READING_SEED, config.key().as_ref(), &record_date.to_le_bytes()], bump = reading.bump)]
    pub reading: Box<Account<'info, Reading>>,
    /// CHECK: the platform PDA (seeds-checked); unused since the cap and the cranker allowlist were removed (2026-10-25).
    #[account(seeds = [PLATFORM_SEED], bump)]
    pub platform: UncheckedAccount<'info>,
    #[account(mut, seeds = [BURN_TARGET_SEED, config.mint.as_ref()], bump = burn_target.bump)]
    pub burn_target: Box<Account<'info, BurnTarget>>,
    /// The coin's own mint: creator-fee tokens of the coin that reached the fee PDA are burned here too (as crank_buyback does).
    #[account(mut, address = config.mint, mint::token_program = token_program)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [FEE_SEED, config.mint.as_ref()], bump = config.fee_bump)]
    pub fee_vault: SystemAccount<'info>,
    #[account(mut, associated_token::mint = wsol_mint, associated_token::authority = fee_vault, associated_token::token_program = token_program)]
    pub fee_wsol: Box<Account<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = fee_vault, associated_token::token_program = token_program)]
    pub fee_tokens: Box<Account<'info, TokenAccount>>,
    /// The pinned target mint (SPL Token only: the constraint refuses a Token-2022 account).
    #[account(mut, address = burn_target.target_mint @ BurnError::TargetMismatch, mint::token_program = token_program)]
    pub target_mint: Box<Account<'info, Mint>>,
    /// The fee PDA's own account for the target: the swap delivers into it and everything in it is burned.
    #[account(mut, associated_token::mint = target_mint, associated_token::authority = fee_vault, associated_token::token_program = token_program)]
    pub target_tokens: Box<Account<'info, TokenAccount>>,
    #[account(address = NATIVE_MINT)]
    pub wsol_mint: Box<Account<'info, Mint>>,
    /// CHECK: the PINNED pool (address-checked; no other pool can be passed); parsed and re-admitted in the handler.
    #[account(mut, address = burn_target.pool @ BurnError::TargetMismatch)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: the pinned CPMM AmmConfig / AMM v4 vault authority (address-checked; re-derived from the pool in the handler).
    #[account(address = burn_target.amm_config @ BurnError::TargetMismatch)]
    pub amm_config: UncheckedAccount<'info>,
    /// CHECK: CPMM: Raydium's vault-and-LP authority PDA (the CPMM program verifies it). AMM v4: must equal `amm_config` (checked).
    pub cpmm_authority: UncheckedAccount<'info>,
    /// CHECK: the pinned WSOL vault (address-checked, and against the pool when it is readable).
    #[account(mut, address = burn_target.wsol_vault @ BurnError::TargetMismatch)]
    pub wsol_vault: UncheckedAccount<'info>,
    /// CHECK: the pinned target vault (address-checked, and against the pool when it is readable).
    #[account(mut, address = burn_target.target_vault @ BurnError::TargetMismatch)]
    pub target_vault: UncheckedAccount<'info>,
    /// CHECK: the pinned observation account (CPMM; owner + discriminator in cpmm::twap_sol_price_x32), or the AMM v4 pool itself.
    #[account(mut, address = burn_target.observation @ BurnError::TargetMismatch)]
    pub observation_state: UncheckedAccount<'info>,
    /// CHECK: the pool kind's program: Raydium CPMM or Raydium AMM v4 (checked in the handler against the pinned kind).
    pub swap_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    /// CHECK: address-checked: the SPL Memo program.
    #[account(address = MEMO_PROGRAM_ID)]
    pub memo_program: UncheckedAccount<'info>,
    /// CHECK: a Pyth PriceUpdateV2 of SOL/USD (checked in pyth::read_price).
    pub sol_price_update: UncheckedAccount<'info>,
    /// CHECK: a Pyth PriceUpdateV2 of the pinned target feed (checked in pyth::read_price).
    pub target_price_update: UncheckedAccount<'info>,
    /// CHECK: paired coins only: this coin's PairLink (address-checked in pair::crank_pair_gate).
    pub pair_link: Option<UncheckedAccount<'info>>,
    /// CHECK: paired coins only: the period's PairResult (address-checked; may be empty).
    pub pair_result: Option<UncheckedAccount<'info>>,
}

/// Why the pinned pool cannot be traded right now (None = tradeable). Anything other than a readable, enabled pool over the floor whose
/// mints, config, fee and vaults still match the pins is a reason.
fn target_pool_blocked(a: &CrankTargetBurn, now: i64) -> Option<BurnError> {
    let t = &a.burn_target;
    if t.pool_kind == TARGET_POOL_AMM_V4 {
        let Some(p) = AmmV4View::try_load(&a.pool_state.to_account_info()) else { return Some(BurnError::TargetPoolUnhealthy) };
        if p.wsol_is_coin(&NATIVE_MINT, &t.target_mint) != Some(t.wsol_is_token_0) || p.status != AMM_STATUS_SWAP_ONLY || p.authority() != Some(t.amm_config) {
            return Some(BurnError::TargetPoolUnhealthy);
        }
        let (wv, tv, wpnl, _) = p.sides(t.wsol_is_token_0);
        if wv != t.wsol_vault || tv != t.target_vault {
            return Some(BurnError::TargetPoolUnhealthy);
        }
        if spl_amount(&a.wsol_vault.to_account_info()).map(|x| x.saturating_sub(wpnl)).unwrap_or(0) < TARGET_MIN_WSOL_RESERVE_LAMPORTS {
            return Some(BurnError::TargetPoolBelowFloor);
        }
        if p.fee_ppm().map(|f| f > TARGET_MAX_FEE_PPM).unwrap_or(true) {
            return Some(BurnError::TargetFeeTier);
        }
        return None;
    }
    let Some(p) = PoolView::try_load(&a.pool_state.to_account_info()) else { return Some(BurnError::TargetPoolUnhealthy) };
    let Some(wsol0) = p.wsol_is_token_0(&NATIVE_MINT, &t.target_mint) else { return Some(BurnError::TargetPoolUnhealthy) };
    if wsol0 != t.wsol_is_token_0 || p.amm_config != t.amm_config || p.observation_key != t.observation {
        return Some(BurnError::TargetPoolUnhealthy);
    }
    let (wv, tv, wf) = if wsol0 { (p.token_0_vault, p.token_1_vault, p.fees_0) } else { (p.token_1_vault, p.token_0_vault, p.fees_1) };
    if wv != t.wsol_vault || tv != t.target_vault || !p.swaps_enabled(now) {
        return Some(BurnError::TargetPoolUnhealthy);
    }
    let reserve = spl_amount(&a.wsol_vault.to_account_info()).map(|x| x.saturating_sub(wf)).unwrap_or(0);
    if reserve < TARGET_MIN_WSOL_RESERVE_LAMPORTS {
        return Some(BurnError::TargetPoolBelowFloor);
    }
    // Raydium's admin can change an AmmConfig's fees: a pool whose fee rose above the bound is held like an unhealthy one (and the
    // 30-day unblock applies), never a permanent wedge.
    let fee_ok = AmmConfigView::load(&a.amm_config.to_account_info())
        .map(|cfg| cfg.trade_fee_rate.saturating_add(if p.enable_creator_fee { cfg.creator_fee_rate } else { 0 }) <= TARGET_MAX_FEE_PPM)
        .unwrap_or(false);
    if !fee_ok {
        return Some(BurnError::TargetFeeTier);
    }
    None
}

/// What a tradeable crank needs: reserves, the swap fee, the Pyth reference and (CPMM) the TWAP.
struct Quote {
    r_wsol: u64,
    r_tok: u64,
    fee_ppm: u64,
    reference: u128,
    twap: Option<u128>,
    pyth: PythRef,
}

/// The price guard for a pool that passed target_pool_blocked: Pyth fresh and tight, spot within the rule's deviation of the Pyth ratio
/// (two-sided). Ok(Err(why)) = held; Err = a wrong account (or a Pyth update older than the last one accepted, R5-7).
/// Round-5 review R5-2: the CPMM TWAP being unavailable or away from spot is a HOLD too (it was a hard revert, so the 30-day unblock
/// could never run and a persistent pool/oracle basis wedged the queue).
fn price_guard(a: &CrankTargetBurn, rule_dev: u16, twap_window: u32, now: i64) -> Result<core::result::Result<Quote, BurnError>> {
    let t = &a.burn_target;
    let pyth_ref = match pyth_reference(&a.sol_price_update.to_account_info(), &a.target_price_update.to_account_info(), &t.target_feed_id, t.target_decimals, now)? {
        Ok(r) => r,
        Err(why) => return Ok(Err(why)),
    };
    require_pyth_not_backwards(t, &pyth_ref)?;
    let reference = pyth_ref.reference;
    // Second review (C): everything read from the PINNED pool accounts (the caller cannot choose them) is pool state, so a failure to
    // load reserves, the fee or the TWAP is a HOLD (the 30-day unblock applies), never a hard revert that wedges the queue.
    let Ok((r_wsol, r_tok)) = reserves_of(t.pool_kind, &a.pool_state.to_account_info(), &a.wsol_vault.to_account_info(), &a.target_vault.to_account_info(), t.wsol_is_token_0) else {
        return Ok(Err(BurnError::EmptyReserves));
    };
    let Ok(spot) = math::sol_price_x32(r_wsol, r_tok) else { return Ok(Err(BurnError::EmptyReserves)) };
    if !pyth::within(spot, reference, rule_dev) {
        return Ok(Err(BurnError::TargetPriceDeviation));
    }
    let (fee_ppm, twap) = if t.pool_kind == TARGET_POOL_AMM_V4 {
        let Ok(p) = AmmV4View::load(&a.pool_state.to_account_info()) else { return Ok(Err(BurnError::TargetPoolUnhealthy)) };
        let Some(fee) = p.fee_ppm() else { return Ok(Err(BurnError::TargetFeeTier)) };
        (fee, None)
    } else {
        let (Ok(pool), Ok(cfg)) = (PoolView::load(&a.pool_state.to_account_info()), AmmConfigView::load(&a.amm_config.to_account_info())) else {
            return Ok(Err(BurnError::TargetPoolUnhealthy));
        };
        let Some(fee) = cfg.trade_fee_rate.checked_add(if pool.enable_creator_fee { cfg.creator_fee_rate } else { 0 }) else {
            return Ok(Err(BurnError::TargetFeeTier));
        };
        // The CPMM pool's own TWAP stays an additional check where it exists.
        let Ok(Some(twap)) = cpmm::twap_sol_price_x32(&a.observation_state.to_account_info(), t.wsol_is_token_0, twap_window, now, spot) else {
            return Ok(Err(BurnError::TwapUnavailable));
        };
        if !math::twap_ok(spot, twap, rule_dev).unwrap_or(false) {
            return Ok(Err(BurnError::TwapDeviation));
        }
        (fee, Some(twap))
    };
    if fee_ppm > TARGET_MAX_FEE_PPM {
        return Ok(Err(BurnError::TargetFeeTier));
    }
    Ok(Ok(Quote { r_wsol, r_tok, fee_ppm, reference, twap, pyth: pyth_ref }))
}

pub fn handle_crank_target_burn(ctx: Context<CrankTargetBurn>, _record_date: u32) -> Result<()> {
    let (rule, mint_key, fee_bump, pool_key, target_mint, kind) = {
        let c = &ctx.accounts.config;
        require!(c.rule.mode == MODE_BUYBACK, BurnError::WrongMode);
        require!(c.burns_target(), BurnError::NoBurnTarget);
        require_next_in_line(c, &ctx.accounts.reading)?;
        require!(ctx.accounts.reading.units > 0, BurnError::NoUnits);
        let t = &ctx.accounts.burn_target;
        (c.rule, c.mint, c.fee_bump, t.pool, t.target_mint, t.pool_kind)
    };
    // The swap program is the pinned kind's; an AMM v4 crank signs with the pinned vault authority.
    let want_program = if kind == TARGET_POOL_AMM_V4 { AMM_V4_PROGRAM_ID } else { CPMM_PROGRAM_ID };
    require_keys_eq!(ctx.accounts.swap_program.key(), want_program, BurnError::TargetMismatch);
    if kind == TARGET_POOL_AMM_V4 {
        require_keys_eq!(ctx.accounts.cpmm_authority.key(), ctx.accounts.burn_target.amm_config, BurnError::TargetMismatch);
    }
    let units = ctx.accounts.reading.units;
    require!(crate::instructions::end::reading_allowed_after_end(&ctx.accounts.config, ctx.accounts.reading.record_date), BurnError::ForwardOnEndRequired);
    require_fixed_supply(&ctx.accounts.mint)?;
    require!(ctx.accounts.target_mint.freeze_authority.is_none(), BurnError::TargetFreezeAuthority);
    require!(ctx.accounts.target_mint.mint_authority.is_none(), BurnError::TargetMintAuthority);
    let now = Clock::get()?.unix_timestamp;
    let pair_gate = crate::instructions::pair::crank_pair_gate(
        &ctx.accounts.config,
        &ctx.accounts.reading,
        ctx.accounts.pair_link.as_ref().map(|a| a.as_ref()),
        ctx.accounts.pair_result.as_ref().map(|a| a.as_ref()),
        now,
    )?;
    let fee_seeds: &[&[u8]] = &[FEE_SEED, mint_key.as_ref(), &[fee_bump]];

    let wsol_reserve: Option<u64> = ctx.accounts.fee_wsol.is_native.into();
    let wsol_reserve = wsol_reserve.ok_or(BurnError::InvalidCpmmAccount)?;
    let wsol_balance = ctx.accounts.fee_wsol.to_account_info().lamports().checked_sub(wsol_reserve).ok_or(BurnError::MathOverflow)?;
    let wsol_unsynced = wsol_balance != ctx.accounts.fee_wsol.amount;

    // ----- the rule: identical to crank_buyback (owner decision 2026-10-25: no platform cap, no cranker allowlist) -----
    let pool_actual = math::spendable_pool(ctx.accounts.fee_vault.lamports(), rule.reserve_lamports, wsol_balance).map_err(|_| BurnError::MathOverflow)?;
    let pool_before = pool_actual;
    let rule_spend = math::buyback_spend(pool_before, units, rule.fraction_per_unit_bps).map_err(|_| BurnError::MathOverflow)?;
    let carried_in = ctx.accounts.config.carried_spend_lamports;
    let target = rule_spend.saturating_add(carried_in).min(pool_actual);
    let targets_before = ctx.accounts.target_tokens.amount;
    let mut carry_reason = CARRY_REASON_BELOW_FLOOR;
    let mut reference_x32 = 0u128;
    let reading_age = now.saturating_sub(ctx.accounts.reading.submitted_at);
    // R5-6: the 30-day unblock processed this reading without a swap (recorded on the BurnTarget for release_target).
    let mut unblocked = false;
    let mut accepted_pyth: Option<PythRef> = None;

    // ----- the pool and the price: tradeable, or held (30 days after the reading the queue stops waiting) -----
    let ready: Option<Quote> = if target == 0 || target < rule.floor_lamports {
        None
    } else {
        let held = match target_pool_blocked(&ctx.accounts, now) {
            Some(why) => Err(why),
            None => price_guard(&ctx.accounts, rule.max_twap_deviation_bps, rule.twap_window_secs, now)?,
        };
        match held {
            Ok(q) => Some(q),
            Err(why) => {
                if reading_age < QUEUE_UNBLOCK_SECS {
                    return Err(why.into());
                }
                carry_reason = CARRY_REASON_POOL_UNTRADEABLE;
                unblocked = true;
                None
            }
        }
    };

    let (spent, got, outcome, swap_ref, carried_out) = match ready {
        None if target == 0 || target < rule.floor_lamports => (0u64, 0u64, OUTCOME_BELOW_FLOOR, String::from("none"), carried_in.min(pool_actual)),
        None => (0u64, 0u64, OUTCOME_BELOW_FLOOR, String::from("none"), target),
        Some(q) => {
            reference_x32 = q.reference;
            // Owner decision 2026-10-25: the whole target is spent in this crank (the 2 %-of-reserve per-crank bound is removed).
            let spend = target;
            // min-out: the larger of the spot and the PYTH quotes (and, CPMM, the TWAP quote), each less the fee and slippage_bps.
            // Second review (C): a quote that cannot be computed (an overflow on extreme reserves or reference) is a hold as well.
            let quotes = if spend == 0 || spend < rule.floor_lamports {
                Some((0, 0))
            } else {
                let by_pyth = math::buyback_min_out(spend, q.r_wsol, q.r_tok, q.reference, q.fee_ppm, rule.slippage_bps).ok();
                let by_twap = match q.twap {
                    Some(tw) => math::buyback_min_out(spend, q.r_wsol, q.r_tok, tw, q.fee_ppm, rule.slippage_bps).ok(),
                    None => Some(0),
                };
                let spot_out = math::min_amount_out(spend, q.r_wsol, q.r_tok, q.fee_ppm, 0).ok();
                match (by_pyth, by_twap, spot_out) {
                    (Some(p), Some(tw), Some(so)) => Some((p.max(tw), so)),
                    _ => None,
                }
            };
            let (min_out, spot_out) = quotes.unwrap_or((u64::MAX, 0));
            if quotes.is_some() && (spend == 0 || spend < rule.floor_lamports || min_out == 0) {
                (0u64, 0u64, OUTCOME_BELOW_FLOOR, String::from("none"), target)
            } else {
                // Round-5 review R5-2: the pool can sit inside the deviation band yet under the Pyth min-out (band wider than the
                // slippage): a HOLD like every other price reason, so the 30-day unblock still runs (it was a hard revert: a wedge).
                if spot_out < min_out {
                    if reading_age < QUEUE_UNBLOCK_SECS {
                        return err!(BurnError::TargetPriceDeviation);
                    }
                    carry_reason = CARRY_REASON_POOL_UNTRADEABLE;
                    unblocked = true;
                    (0u64, 0u64, OUTCOME_BELOW_FLOOR, String::from("none"), target)
                } else {
                accepted_pyth = Some(q.pyth);
                let from_lamports = spend.saturating_sub(wsol_balance);
                if from_lamports > 0 {
                    system_program::transfer(
                        CpiContext::new_with_signer(
                            system_program::ID,
                            system_program::Transfer { from: ctx.accounts.fee_vault.to_account_info(), to: ctx.accounts.fee_wsol.to_account_info() },
                            &[fee_seeds],
                        ),
                        from_lamports,
                    )?;
                }
                if from_lamports > 0 || wsol_unsynced {
                    token::sync_native(CpiContext::new(token::ID, SyncNative { account: ctx.accounts.fee_wsol.to_account_info() }))?;
                }
                require!(ctx.accounts.fee_vault.lamports() >= rule.reserve_lamports, BurnError::ReserveBreached);
                let lamports_before_swap = ctx.accounts.fee_vault.lamports();
                let target_vault_before = spl_amount(&ctx.accounts.target_vault)?;

                let a = &ctx.accounts;
                if kind == TARGET_POOL_AMM_V4 {
                    let (coin_vault, pc_vault) = if a.burn_target.wsol_is_token_0 { (&a.wsol_vault, &a.target_vault) } else { (&a.target_vault, &a.wsol_vault) };
                    amm_v4::swap_base_in_v2(
                        AmmV4SwapAccounts {
                            token_program: &a.token_program.to_account_info(),
                            amm: &a.pool_state.to_account_info(),
                            authority: &a.amm_config.to_account_info(),
                            coin_vault: &coin_vault.to_account_info(),
                            pc_vault: &pc_vault.to_account_info(),
                            user_source: &a.fee_wsol.to_account_info(),
                            user_destination: &a.target_tokens.to_account_info(),
                            user_owner: &a.fee_vault.to_account_info(),
                        },
                        spend,
                        min_out,
                        &[fee_seeds],
                    )?;
                } else {
                    cpmm::swap_base_input(
                        SwapAccounts {
                            payer: &a.fee_vault.to_account_info(),
                            authority: &a.cpmm_authority.to_account_info(),
                            amm_config: &a.amm_config.to_account_info(),
                            pool_state: &a.pool_state.to_account_info(),
                            input_token_account: &a.fee_wsol.to_account_info(),
                            output_token_account: &a.target_tokens.to_account_info(),
                            input_vault: &a.wsol_vault.to_account_info(),
                            output_vault: &a.target_vault.to_account_info(),
                            input_token_program: &a.token_program.to_account_info(),
                            output_token_program: &a.token_program.to_account_info(),
                            input_token_mint: &a.wsol_mint.to_account_info(),
                            output_token_mint: &a.target_mint.to_account_info(),
                            observation_state: &a.observation_state.to_account_info(),
                        },
                        spend,
                        min_out,
                        &[fee_seeds],
                    )?;
                }
                {
                    let a = &ctx.accounts;
                    let fee = a.fee_vault.key();
                    require_fee_pda_intact(&a.fee_vault.to_account_info(), lamports_before_swap)?;
                    require_fee_token_account_intact(&a.fee_wsol.to_account_info(), &fee, &NATIVE_MINT, false)?;
                    require_fee_token_account_intact(&a.fee_tokens.to_account_info(), &fee, &mint_key, false)?;
                    require_fee_token_account_intact(&a.target_tokens.to_account_info(), &fee, &target_mint, false)?;
                }
                ctx.accounts.target_tokens.reload()?;
                ctx.accounts.fee_wsol.reload()?;
                let wsol_after = ctx.accounts.fee_wsol.amount;
                require!(
                    wsol_after.checked_add(spend) == Some(wsol_balance.checked_add(from_lamports).ok_or(BurnError::MathOverflow)?),
                    BurnError::WsolBalanceMismatch
                );
                let got = ctx.accounts.target_tokens.amount.checked_sub(targets_before).ok_or(BurnError::MathOverflow)?;
                require!(got >= min_out, BurnError::ZeroOutput);
                require!(target_vault_before.checked_sub(spl_amount(&ctx.accounts.target_vault)?) == Some(got), BurnError::SwapOutputMismatch);
                (spend, got, OUTCOME_BURNED, memo::swap_ref(&pool_key), 0)
                }
            }
        }
    };

    // ----- burn everything the fee PDA holds in the target, then any of the coin's own tokens it holds -----
    ctx.accounts.fee_tokens.reload()?;
    let target_burn = ctx.accounts.target_tokens.amount;
    if target_burn > 0 {
        token::burn(
            CpiContext::new_with_signer(
                token::ID,
                Burn { mint: ctx.accounts.target_mint.to_account_info(), from: ctx.accounts.target_tokens.to_account_info(), authority: ctx.accounts.fee_vault.to_account_info() },
                &[fee_seeds],
            ),
            target_burn,
        )?;
    }
    let own_burn = ctx.accounts.fee_tokens.amount;
    if own_burn > 0 {
        token::burn(
            CpiContext::new_with_signer(
                token::ID,
                Burn { mint: ctx.accounts.mint.to_account_info(), from: ctx.accounts.fee_tokens.to_account_info(), authority: ctx.accounts.fee_vault.to_account_info() },
                &[fee_seeds],
            ),
            own_burn,
        )?;
    }

    let m = memo::format_target(
        &memo_head(&ctx.accounts.config, &ctx.accounts.reading),
        pool_before,
        spent,
        got,
        target_burn,
        &target_mint,
        ctx.accounts.target_mint.decimals,
        own_burn,
        ctx.accounts.mint.decimals,
        &swap_ref,
    );
    memo::emit_memo(&ctx.accounts.memo_program.to_account_info(), &m)?;

    let config_key = ctx.accounts.config.key();
    let r = &mut ctx.accounts.reading;
    r.processed = true;
    r.outcome = outcome;
    r.processed_at = now;
    r.pool_lamports = pool_before;
    r.pool_actual_lamports = pool_actual;
    r.rule_spend_lamports = rule_spend;
    r.carried_in_lamports = carried_in;
    r.carried_out_lamports = carried_out;
    r.spent_lamports = spent;
    r.got = got;
    // A target reading's `burned` is in the TARGET's raw units (BurnTarget names the mint); own-coin tokens are in the event and memo.
    r.burned = target_burn;
    // `owed` is a vault-mode field (always 0 in buyback mode); a target reading records the coin's OWN raw tokens burned here, so the
    // v3 memo can be rebuilt from the accounts alone (src/lib/burnReceipts/memo.ts memoFromChain).
    r.owed = own_burn;
    r.pool = pool_key;
    let record_date = r.record_date;
    let c = &mut ctx.accounts.config;
    c.crank_cursor = record_date;
    c.total_burned = c.total_burned.checked_add(own_burn).ok_or(BurnError::MathOverflow)?;
    c.total_spent_lamports = c.total_spent_lamports.checked_add(spent).ok_or(BurnError::MathOverflow)?;
    if target_burn > 0 || own_burn > 0 {
        c.burns = c.burns.checked_add(1).ok_or(BurnError::MathOverflow)?;
    }
    c.carried_spend_lamports = carried_out;
    let t = &mut ctx.accounts.burn_target;
    t.total_target_burned = t.total_target_burned.checked_add(target_burn).ok_or(BurnError::MathOverflow)?;
    t.total_spent_lamports = t.total_spent_lamports.checked_add(spent).ok_or(BurnError::MathOverflow)?;
    if target_burn > 0 {
        t.burns = t.burns.checked_add(1).ok_or(BurnError::MathOverflow)?;
    }
    if let Some(r) = accepted_pyth.as_ref() {
        record_pyth(t, r);
    }
    if spent > 0 {
        t.last_burn_at = now;
    }
    if unblocked {
        t.last_unblocked_at = now;
    }

    if spent == 0 && carried_out > 0 {
        emit_cpi!(SpendCarried { config: config_key, record_date, target_lamports: target, carried_in_lamports: carried_in, carried_out_lamports: carried_out, reason: carry_reason });
    }
    match pair_gate {
        crate::instructions::pair::PairGate::ResultMissing => emit_cpi!(crate::events::PairResultMissing { mint: mint_key, record_date }),
        crate::instructions::pair::PairGate::ForwardMissing => emit_cpi!(crate::events::PairForwardMissing { mint: mint_key, record_date }),
        crate::instructions::pair::PairGate::Proceed => {}
    }
    emit_cpi!(TargetBurned { config: config_key, record_date, target_mint, pool: pool_key, spent_lamports: spent, got, target_burned: target_burn, own_burned: own_burn, reference_x32 });
    emit_cpi!(ReadingProcessed {
        config: config_key,
        record_date,
        units,
        outcome,
        pool_lamports: pool_before,
        spent_lamports: spent,
        got,
        burned: target_burn,
        owed: own_burn,
        shortfall: 0,
        cranker: ctx.accounts.cranker.key(),
    });
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Re-pinning the target POOL (the target mint and feed never change)
// ---------------------------------------------------------------------------------------------------------------------------------

#[event_cpi]
#[derive(Accounts)]
pub struct TargetPoolAdmin<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump, has_one = admin @ BurnError::NotAdmin)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [BURN_TARGET_SEED, config.mint.as_ref()], bump = burn_target.bump)]
    pub burn_target: Box<Account<'info, BurnTarget>>,
}

/// ADMIN: propose a new pool for the same target (applicable after ATTESTER_TIMELOCK_SECS, for POLICY_PROPOSAL_TTL_SECS after the
/// proposal; a new proposal replaces a pending one and restarts the clock). Nothing about the pool is checked here; apply re-runs the
/// whole admission.
pub fn handle_propose_target_pool(ctx: Context<TargetPoolAdmin>, pool: Pubkey) -> Result<()> {
    require!(ctx.accounts.config.admin_active(), BurnError::NotAdmin);
    let t = &mut ctx.accounts.burn_target;
    require!(pool != Pubkey::default() && pool != t.pool, BurnError::SamePool);
    let eta = Clock::get()?.unix_timestamp.checked_add(ATTESTER_TIMELOCK_SECS).ok_or(BurnError::MathOverflow)?;
    t.pending_pool = pool;
    t.pending_eta = eta;
    let config = ctx.accounts.config.key();
    emit_cpi!(TargetPoolProposed { config, target_mint: t.target_mint, old_pool: t.pool, new_pool: pool, eta });
    Ok(())
}

pub fn handle_cancel_target_pool(ctx: Context<TargetPoolAdmin>) -> Result<()> {
    let t = &mut ctx.accounts.burn_target;
    require!(t.pending_eta != 0, BurnError::NoPendingChange);
    let pool = t.pending_pool;
    t.pending_pool = Pubkey::default();
    t.pending_eta = 0;
    let (config, by) = (ctx.accounts.config.key(), ctx.accounts.admin.key());
    emit_cpi!(TargetPoolProposalCancelled { config, pool, cancelled_by: by, vetoed: false });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct VetoTargetPool<'info> {
    pub attester: Signer<'info>,
    #[account(seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [BURN_TARGET_SEED, config.mint.as_ref()], bump = burn_target.bump)]
    pub burn_target: Box<Account<'info, BurnTarget>>,
}

/// Any current attester kills a pending re-pin.
pub fn handle_veto_target_pool(ctx: Context<VetoTargetPool>) -> Result<()> {
    let attester = ctx.accounts.attester.key();
    require!(ctx.accounts.config.attester_slice().iter().any(|a| a.key == attester), BurnError::NotAttester);
    let t = &mut ctx.accounts.burn_target;
    require!(t.pending_eta != 0, BurnError::NoPendingChange);
    let pool = t.pending_pool;
    t.pending_pool = Pubkey::default();
    t.pending_eta = 0;
    let config = ctx.accounts.config.key();
    emit_cpi!(TargetPoolProposalCancelled { config, pool, cancelled_by: attester, vetoed: true });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct ApplyTargetPool<'info> {
    /// Anyone.
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [BURN_TARGET_SEED, config.mint.as_ref()], bump = burn_target.bump)]
    pub burn_target: Box<Account<'info, BurnTarget>>,
    /// CHECK: the pinned target mint (address-checked; re-admitted).
    #[account(address = burn_target.target_mint @ BurnError::TargetMismatch)]
    pub target_mint: UncheckedAccount<'info>,
    /// CHECK: the proposed pool (address-checked against the pending proposal; admitted in the handler).
    #[account(address = burn_target.pending_pool @ BurnError::TargetMismatch)]
    pub new_pool: UncheckedAccount<'info>,
    /// CHECK: the new pool's AmmConfig (CPMM) or vault authority (AMM v4) (key-checked against it).
    pub new_amm_config: UncheckedAccount<'info>,
    /// CHECK: the new pool's WSOL vault (key-checked against it).
    pub new_wsol_vault: UncheckedAccount<'info>,
    /// CHECK: the new pool's target vault (key-checked against it).
    pub new_target_vault: UncheckedAccount<'info>,
    /// CHECK: Pyth SOL/USD (pyth::read_price).
    pub sol_price_update: UncheckedAccount<'info>,
    /// CHECK: Pyth for the pinned target feed (pyth::read_price).
    pub target_price_update: UncheckedAccount<'info>,
}

pub fn handle_apply_target_pool(ctx: Context<ApplyTargetPool>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let (eta, old_pool, target_mint, feed, decimals) = {
        let t = &ctx.accounts.burn_target;
        (t.pending_eta, t.pool, t.target_mint, t.target_feed_id, t.target_decimals)
    };
    require!(eta != 0, BurnError::NoPendingChange);
    require!(now >= eta, BurnError::TimelockNotElapsed);
    require!(now <= eta.saturating_sub(ATTESTER_TIMELOCK_SECS).saturating_add(POLICY_PROPOSAL_TTL_SECS), BurnError::PolicyProposalExpired);
    let mint = ctx.accounts.config.mint;
    let max_dev = ctx.accounts.config.rule.max_twap_deviation_bps;
    admit_target_mint(&ctx.accounts.target_mint.to_account_info(), &mint)?;
    let a = &ctx.accounts;
    let pins = admit_target_pool(&a.new_pool.to_account_info(), &a.new_amm_config.to_account_info(), &a.new_wsol_vault.to_account_info(), &target_mint, now)?;
    let (pyth_ref, _) = require_pool_matches_pyth(
        &pins,
        &a.new_pool.to_account_info(),
        &a.new_wsol_vault.to_account_info(),
        &a.new_target_vault.to_account_info(),
        &a.sol_price_update.to_account_info(),
        &a.target_price_update.to_account_info(),
        &feed,
        decimals,
        max_dev,
        now,
    )?;
    let t = &mut ctx.accounts.burn_target;
    write_pins(t, &pins);
    record_pyth(t, &pyth_ref);
    t.pending_pool = Pubkey::default();
    t.pending_eta = 0;
    t.repins = t.repins.saturating_add(1);
    let (config, caller) = (ctx.accounts.config.key(), ctx.accounts.caller.key());
    emit_cpi!(TargetPoolRepinned { config, target_mint, old_pool, new_pool: pins.pool, pool_kind: pins.kind, wsol_reserve_lamports: pins.wsol_reserve, caller });
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------------------------
// release_target (round-5 review R5-6: the liveness escape for a target whose pool or feed is dead)
// ---------------------------------------------------------------------------------------------------------------------------------

/// PERMISSIONLESS. A target coin whose pinned pool or Pyth feed
/// stopped working only carries its spend: each reading is held, processed after 30 days with its whole spend carried, and the carry is
/// re-offered to the next reading, which holds again. A re-pin needs an active admin and any one attester can veto it. This moves the
/// CARRIED spend (only that: never more than the rule already owed) to the flagship's fee PDA, where $DEFICIT's own cranks burn it:
///   · the coin burns a target, buyback mode, no submitted reading waits for its crank (crank_carried's queue rule);
///   · the last event of the target is a 30-day unblock (BurnTarget.last_unblocked_at > last_burn_at) and 30 days have passed since the
///     last target burn (or the pin): a target that burned since is not stalled (TargetNotStalled);
///   · the flagship is live (verified pool, rule not ended, buyback).
/// Amount = min(carried_spend_lamports, SOL above the reserve + synced WSOL); SOL first, then WSOL into the
/// flagship fee PDA's WSOL account. carried_spend_lamports drops by the amount. Memo `<PREFIX>|release|to=<12>|lamports=N|left=N|v1`,
/// event TargetReleased. No attester or admin takes part, so neither can block it. Callable again while the conditions hold.
#[event_cpi]
#[derive(Accounts)]
pub struct ReleaseTarget<'info> {
    pub cranker: Signer<'info>,
    /// CHECK: the platform PDA (seeds-checked); unused since the cap and the cranker allowlist were removed (2026-10-25).
    #[account(seeds = [PLATFORM_SEED], bump)]
    pub platform: UncheckedAccount<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(seeds = [BURN_TARGET_SEED, config.mint.as_ref()], bump = burn_target.bump)]
    pub burn_target: Box<Account<'info, BurnTarget>>,
    #[account(mut, seeds = [FEE_SEED, config.mint.as_ref()], bump = config.fee_bump)]
    pub fee_vault: SystemAccount<'info>,
    /// CHECK: ATA(fee PDA, WSOL) — address-checked; may not exist (then it holds nothing).
    #[account(mut, address = anchor_spl::associated_token::get_associated_token_address(&fee_vault.key(), &NATIVE_MINT) @ BurnError::FeeAccountTampered)]
    pub fee_wsol: UncheckedAccount<'info>,
    #[account(seeds = [CONFIG_SEED, BURNTICKER_FLAGSHIP.as_ref()], bump = flagship_config.bump)]
    pub flagship_config: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [FEE_SEED, BURNTICKER_FLAGSHIP.as_ref()], bump = flagship_config.fee_bump)]
    pub flagship_fee_vault: SystemAccount<'info>,
    /// CHECK: ATA(flagship fee PDA, WSOL) — address-checked; must exist only when WSOL is moved.
    #[account(mut, address = anchor_spl::associated_token::get_associated_token_address(&flagship_fee_vault.key(), &NATIVE_MINT) @ BurnError::FeeAccountTampered)]
    pub flagship_fee_wsol: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    /// CHECK: address-checked: the SPL Memo program.
    #[account(address = MEMO_PROGRAM_ID)]
    pub memo_program: UncheckedAccount<'info>,
}

/// Round-5 review R5-9: the coin's BurnTarget is pinned and working — read from the account itself (address-checked): it exists, belongs
/// to this coin, names a target mint and a pool, and is not STALLED (last_unblocked_at > last_burn_at: its last target event is a
/// 30-day unblock, the marker release_target uses; a later burn clears it). No account passed for a coin that needs one is refused
/// (BurnTargetAccountMissing), so a cranker cannot make a live target coin look dead by leaving it out; an empty account at the address
/// is "not pinned".
pub fn target_pinned(mint: &Pubkey, acc: Option<&AccountInfo>) -> Result<bool> {
    let acc = acc.ok_or(BurnError::BurnTargetAccountMissing)?;
    require!(*acc.key == crate::state::burn_target_address(mint).0, BurnError::BurnTargetAccountMissing);
    if acc.owner != &crate::ID {
        return Ok(false);
    }
    // BurnTarget at fixed offsets (8-byte discriminator, version, bump, then state.rs's field order): mint 10..42, target_mint 42..74,
    // pool 108..140, pinned_at 269..277, last_burn_at 357..365, last_unblocked_at 365..373. Read in place (no Borsh): a small binary.
    let d = acc.try_borrow_data()?;
    if d.len() < 373 || d[..8] != BurnTarget::DISCRIMINATOR[..] {
        return Ok(false);
    }
    let set = |r: core::ops::Range<usize>| d[r].iter().any(|b| *b != 0);
    let i = |at: usize| i64::from_le_bytes(d[at..at + 8].try_into().unwrap());
    Ok(d[10..42] == mint.to_bytes()[..] && set(42..74) && set(108..140) && i(269) > 0 && i(365) <= i(357))
}

/// Round-5 review R5-9: the coin can take part in pair forwarding and end sinks — its own pool verified (own_pool_verified, R5-12),
/// or a target coin (burn_target_kind EXTERNAL, own pool not yet verified) whose BurnTarget is pinned and not stalled: it cranks on the
/// target's pool without a pool of its own. An external coin whose BurnTarget is not pinned, or stalled, is dead, as before. `bt` is read only for that case.
pub fn side_live(c: &TokenConfig, bt: Option<&AccountInfo>) -> Result<bool> {
    if c.own_pool_verified() {
        return Ok(true);
    }
    if c.burn_target_kind != BURN_TARGET_EXTERNAL {
        return Ok(false);
    }
    target_pinned(&c.mint, bt)
}

/// The stall test of release_target (pure, unit-tested): the last target event is a 30-day unblock, 30 days after the last burn / pin.
pub fn target_stalled(t: &BurnTarget, now: i64) -> bool {
    t.last_unblocked_at > t.last_burn_at && now.saturating_sub(t.last_burn_at.max(t.pinned_at)) >= QUEUE_UNBLOCK_SECS
}

pub fn handle_release_target(ctx: Context<ReleaseTarget>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    let c = &a.config;
    require!(c.rule.mode == MODE_BUYBACK, BurnError::WrongMode);
    require!(c.burns_target(), BurnError::NoBurnTarget);
    require!(crate::instructions::crank_carried::queue_empty(c), BurnError::ReadingPending);
    require!(c.carried_spend_lamports > 0 && target_stalled(&a.burn_target, now), BurnError::TargetNotStalled);
    require!(BURNTICKER_FLAGSHIP != Pubkey::default(), BurnError::FlagshipNotPinned);
    require!(crate::instructions::end::live(&a.flagship_config), BurnError::FlagshipNotLive);

    let reserve = c.rule.reserve_lamports;
    let mint = c.mint;
    let fee_bump = c.fee_bump;
    let carried_in = c.carried_spend_lamports;
    let fee_seeds: &[&[u8]] = &[FEE_SEED, mint.as_ref(), &[fee_bump]];
    let wsol_acc = a.fee_wsol.to_account_info();
    let wsol_avail = crate::instructions::pair::wsol_synced_or_zero(&wsol_acc)?;
    if wsol_avail > 0 {
        require_fee_token_account_intact(&wsol_acc, &a.fee_vault.key(), &NATIVE_MINT, false)?;
    }
    let sol_avail = a.fee_vault.lamports().saturating_sub(reserve);
    let pool_actual = sol_avail.checked_add(wsol_avail).ok_or(BurnError::MathOverflow)?;
    let amount = carried_in.min(pool_actual);
    require!(amount > 0, BurnError::NothingToForward);
    let sol_part = amount.min(sol_avail);
    let wsol_part = amount - sol_part;
    if sol_part > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                system_program::ID,
                system_program::Transfer { from: a.fee_vault.to_account_info(), to: a.flagship_fee_vault.to_account_info() },
                &[fee_seeds],
            ),
            sol_part,
        )?;
        require!(a.fee_vault.lamports() >= reserve, BurnError::ReserveBreached);
    }
    if wsol_part > 0 {
        require_fee_token_account_intact(&a.flagship_fee_wsol.to_account_info(), &a.flagship_fee_vault.key(), &NATIVE_MINT, false)?;
        token::sync_native(CpiContext::new(token::ID, SyncNative { account: wsol_acc.clone() }))?;
        token::transfer(
            CpiContext::new_with_signer(
                token::ID,
                token::Transfer { from: wsol_acc.clone(), to: a.flagship_fee_wsol.to_account_info(), authority: a.fee_vault.to_account_info() },
                &[fee_seeds],
            ),
            wsol_part,
        )?;
    }
    let left = carried_in - amount;
    let m = memo::format_release(c.memo_prefix_str(), &BURNTICKER_FLAGSHIP, amount, left);
    memo::emit_memo(&a.memo_program.to_account_info(), &m)?;
    let config_key = ctx.accounts.config.key();
    ctx.accounts.config.carried_spend_lamports = left;
    emit_cpi!(crate::events::TargetReleased {
        config: config_key,
        mint,
        to_mint: BURNTICKER_FLAGSHIP,
        lamports: amount,
        sol_lamports: sol_part,
        wsol_lamports: wsol_part,
        carried_out_lamports: left,
        cranker: ctx.accounts.cranker.key(),
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bt(pinned_at: i64, last_burn_at: i64, last_unblocked_at: i64) -> BurnTarget {
        BurnTarget {
            version: 1,
            bump: 0,
            mint: Pubkey::default(),
            target_mint: Pubkey::default(),
            target_decimals: 6,
            pool_kind: TARGET_POOL_CPMM,
            target_feed_id: [0; 32],
            pool: Pubkey::default(),
            amm_config: Pubkey::default(),
            wsol_vault: Pubkey::default(),
            target_vault: Pubkey::default(),
            observation: Pubkey::default(),
            wsol_is_token_0: true,
            pinned_at,
            total_target_burned: 0,
            total_spent_lamports: 0,
            burns: 0,
            repins: 0,
            pending_pool: Pubkey::default(),
            pending_eta: 0,
            last_sol_publish_time: 0,
            last_target_publish_time: 0,
            last_burn_at,
            last_unblocked_at,
        }
    }

    /// R5-9: target_pinned reads BurnTarget at fixed offsets; they must match the Borsh layout (mint 10, target_mint 42, pool 108,
    /// pinned_at 269, last_burn_at 357, last_unblocked_at 365).
    #[test]
    fn target_pinned_offsets_match_the_burn_target_layout() {
        let mut t = bt(0x0102_0304_0506_0708, 0, 0);
        t.mint = Pubkey::new_from_array([0x11; 32]);
        t.target_mint = Pubkey::new_from_array([0x22; 32]);
        t.pool = Pubkey::new_from_array([0x33; 32]);
        let mut d = Vec::new();
        t.try_serialize(&mut d).unwrap();
        assert_eq!(&d[..8], BurnTarget::DISCRIMINATOR);
        assert_eq!(&d[10..42], &[0x11; 32]);
        assert_eq!(&d[42..74], &[0x22; 32]);
        assert_eq!(&d[108..140], &[0x33; 32]);
        assert_eq!(i64::from_le_bytes(d[269..277].try_into().unwrap()), 0x0102_0304_0506_0708);
        let t = bt(1, 0x0a0b, 0x0c0d);
        let mut d = Vec::new();
        t.try_serialize(&mut d).unwrap();
        assert_eq!(d.len(), 373);
        assert_eq!(i64::from_le_bytes(d[357..365].try_into().unwrap()), 0x0a0b, "last_burn_at");
        assert_eq!(i64::from_le_bytes(d[365..373].try_into().unwrap()), 0x0c0d, "last_unblocked_at");
    }

    /// R5-6: a release needs a 30-day unblock newer than the last burn, and 30 days since the last burn (or the pin).
    #[test]
    fn release_needs_an_unblock_after_the_last_burn_and_thirty_days() {
        let d = 86_400;
        let pin = 1_000_000;
        // never unblocked: not stalled
        assert!(!target_stalled(&bt(pin, 0, 0), pin + 90 * d));
        // unblocked, no burn ever, 31 days after the pin: stalled
        assert!(target_stalled(&bt(pin, 0, pin + 31 * d), pin + 31 * d));
        // burned after the unblock: not stalled
        assert!(!target_stalled(&bt(pin, pin + 32 * d, pin + 31 * d), pin + 90 * d));
        // unblocked after a burn, but the burn was under 30 days ago: not yet
        assert!(!target_stalled(&bt(pin, pin + 10 * d, pin + 20 * d), pin + 39 * d));
        assert!(target_stalled(&bt(pin, pin + 10 * d, pin + 20 * d), pin + 40 * d));
    }

    /// R5-12: a target coin's own-pool verification lives in burn_target_kind; pool_verified stays false (round 4 refuses it).
    #[test]
    fn a_target_coins_own_pool_verification_never_sets_pool_verified() {
        let mut c: TokenConfig = unsafe { core::mem::zeroed() };
        c.burn_target_kind = BURN_TARGET_EXTERNAL;
        c.set_own_pool_verified(true);
        assert!(!c.pool_verified && c.own_pool_verified() && c.burns_target());
        assert_eq!(c.burn_target_kind, BURN_TARGET_EXTERNAL_POOL_VERIFIED);
        c.set_own_pool_verified(false);
        assert!(!c.pool_verified && !c.own_pool_verified() && c.burn_target_kind == BURN_TARGET_EXTERNAL);
        let mut s: TokenConfig = unsafe { core::mem::zeroed() };
        s.set_own_pool_verified(true);
        assert!(s.pool_verified && s.own_pool_verified() && !s.burns_target());
    }
}
