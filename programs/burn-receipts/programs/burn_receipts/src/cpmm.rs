//! Raydium CPMM (raydium-cp-swap) — the read-only views and the one CPI this program needs.
//!
//! Layouts are read by byte offset from the source at github.com/raydium-io/raydium-cp-swap (commit b3187ae5, 2026-10-03,
//! programs/cp-swap/src/states/{pool,config,oracle}.rs). PoolState and ObservationState are `#[repr(C, packed)]` zero-copy
//! accounts; AmmConfig is a borsh `#[account]`. Every reader checks the owner (the hard-coded CPMM program id), the 8-byte Anchor
//! discriminator and the length before touching a field.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

use crate::constants::CPMM_PROGRAM_ID;
use crate::error::BurnError;

pub const POOL_STATE_DISCRIMINATOR: [u8; 8] = [247, 237, 227, 245, 215, 195, 222, 70];
pub const AMM_CONFIG_DISCRIMINATOR: [u8; 8] = [218, 244, 33, 104, 203, 203, 43, 111];
pub const OBSERVATION_STATE_DISCRIMINATOR: [u8; 8] = [122, 174, 197, 53, 129, 9, 165, 132];
pub const SWAP_BASE_INPUT_DISCRIMINATOR: [u8; 8] = [143, 190, 90, 218, 196, 30, 51, 222];

pub const POOL_STATE_LEN: usize = 637;
pub const AMM_CONFIG_LEN: usize = 236;
pub const OBSERVATION_STATE_LEN: usize = 4075;
pub const OBSERVATION_NUM: usize = 100;

/// PoolState field offsets (including the 8-byte discriminator).
mod pool_off {
    pub const AMM_CONFIG: usize = 8;
    pub const POOL_CREATOR: usize = 40;
    pub const TOKEN_0_VAULT: usize = 72;
    pub const TOKEN_1_VAULT: usize = 104;
    pub const LP_MINT: usize = 136;
    pub const TOKEN_0_MINT: usize = 168;
    pub const TOKEN_1_MINT: usize = 200;
    pub const TOKEN_0_PROGRAM: usize = 232;
    pub const TOKEN_1_PROGRAM: usize = 264;
    pub const OBSERVATION_KEY: usize = 296;
    pub const STATUS: usize = 329;
    pub const LP_SUPPLY: usize = 333;
    pub const PROTOCOL_FEES_0: usize = 341;
    pub const PROTOCOL_FEES_1: usize = 349;
    pub const FUND_FEES_0: usize = 357;
    pub const FUND_FEES_1: usize = 365;
    pub const OPEN_TIME: usize = 373;
    pub const ENABLE_CREATOR_FEE: usize = 390;
    pub const CREATOR_FEES_0: usize = 397;
    pub const CREATOR_FEES_1: usize = 405;
}

/// Bit 2 of `status` = swaps disabled.
const STATUS_SWAP_DISABLED: u8 = 1 << 2;

fn pk(d: &[u8], at: usize) -> Pubkey {
    let mut b = [0u8; 32];
    b.copy_from_slice(&d[at..at + 32]);
    Pubkey::new_from_array(b)
}
fn u64_at(d: &[u8], at: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[at..at + 8]);
    u64::from_le_bytes(b)
}
fn u128_at(d: &[u8], at: usize) -> u128 {
    let mut b = [0u8; 16];
    b.copy_from_slice(&d[at..at + 16]);
    u128::from_le_bytes(b)
}

fn checked_data<'a>(acc: &'a AccountInfo, disc: &[u8; 8], min_len: usize) -> Result<std::cell::Ref<'a, &'a mut [u8]>> {
    require_keys_eq!(*acc.owner, CPMM_PROGRAM_ID, BurnError::InvalidCpmmAccount);
    let d = acc.try_borrow_data()?;
    require!(d.len() >= min_len && d[..8] == disc[..], BurnError::InvalidCpmmAccount);
    Ok(d)
}

#[derive(Debug, Clone, Copy)]
pub struct PoolView {
    pub amm_config: Pubkey,
    pub pool_creator: Pubkey,
    pub token_0_vault: Pubkey,
    pub token_1_vault: Pubkey,
    pub lp_mint: Pubkey,
    /// CPMM's own LP count (includes the 100 units never minted at creation; SPL burns of LP tokens do NOT reduce it).
    pub lp_supply: u64,
    pub token_0_mint: Pubkey,
    pub token_1_mint: Pubkey,
    pub token_0_program: Pubkey,
    pub token_1_program: Pubkey,
    pub observation_key: Pubkey,
    pub status: u8,
    pub open_time: u64,
    pub enable_creator_fee: bool,
    /// protocol + fund + creator fees owed out of each vault (not liquidity).
    pub fees_0: u64,
    pub fees_1: u64,
}

impl PoolView {
    pub fn load(acc: &AccountInfo) -> Result<Self> {
        let d = checked_data(acc, &POOL_STATE_DISCRIMINATOR, POOL_STATE_LEN)?;
        let fees_0 = u64_at(&d, pool_off::PROTOCOL_FEES_0)
            .checked_add(u64_at(&d, pool_off::FUND_FEES_0))
            .and_then(|x| x.checked_add(u64_at(&d, pool_off::CREATOR_FEES_0)))
            .ok_or(BurnError::MathOverflow)?;
        let fees_1 = u64_at(&d, pool_off::PROTOCOL_FEES_1)
            .checked_add(u64_at(&d, pool_off::FUND_FEES_1))
            .and_then(|x| x.checked_add(u64_at(&d, pool_off::CREATOR_FEES_1)))
            .ok_or(BurnError::MathOverflow)?;
        Ok(PoolView {
            amm_config: pk(&d, pool_off::AMM_CONFIG),
            pool_creator: pk(&d, pool_off::POOL_CREATOR),
            token_0_vault: pk(&d, pool_off::TOKEN_0_VAULT),
            token_1_vault: pk(&d, pool_off::TOKEN_1_VAULT),
            lp_mint: pk(&d, pool_off::LP_MINT),
            lp_supply: u64_at(&d, pool_off::LP_SUPPLY),
            token_0_mint: pk(&d, pool_off::TOKEN_0_MINT),
            token_1_mint: pk(&d, pool_off::TOKEN_1_MINT),
            token_0_program: pk(&d, pool_off::TOKEN_0_PROGRAM),
            token_1_program: pk(&d, pool_off::TOKEN_1_PROGRAM),
            observation_key: pk(&d, pool_off::OBSERVATION_KEY),
            status: d[pool_off::STATUS],
            open_time: u64_at(&d, pool_off::OPEN_TIME),
            enable_creator_fee: d[pool_off::ENABLE_CREATOR_FEE] != 0,
            fees_0,
            fees_1,
        })
    }

    /// Like `load`, but None (instead of an error) for an account that is not a readable CPMM PoolState.
    pub fn try_load(acc: &AccountInfo) -> Option<Self> {
        if *acc.owner != CPMM_PROGRAM_ID {
            return None;
        }
        Self::load(acc).ok()
    }

    pub fn swaps_enabled(&self, now: i64) -> bool {
        self.status & STATUS_SWAP_DISABLED == 0 && (now.max(0) as u64) >= self.open_time
    }

    /// Which side is WSOL: Some(true) if token_0 is WSOL and token_1 is `mint`, Some(false) for the reverse, None otherwise.
    pub fn wsol_is_token_0(&self, wsol: &Pubkey, mint: &Pubkey) -> Option<bool> {
        if self.token_0_mint == *wsol && self.token_1_mint == *mint {
            Some(true)
        } else if self.token_1_mint == *wsol && self.token_0_mint == *mint {
            Some(false)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct AmmConfigView {
    pub trade_fee_rate: u64,
    pub creator_fee_rate: u64,
}

impl AmmConfigView {
    pub fn load(acc: &AccountInfo) -> Result<Self> {
        let d = checked_data(acc, &AMM_CONFIG_DISCRIMINATOR, AMM_CONFIG_LEN)?;
        Ok(AmmConfigView { trade_fee_rate: u64_at(&d, 12), creator_fee_rate: u64_at(&d, 108) })
    }
}

/// The effective time of an OLDER observation's cumulative (review-2 F1, the 15-second bucket bias).
///
/// CPMM oracle.rs (b3187ae5, update_check_point): a swap at time τ first accumulates `price × (τ − last_update)` and then either
///   (a) adds it INTO the newest observation when τ − t_newest < 15 s (its `block_timestamp` t stays, its cumulative moves on), or
///   (b) writes a NEW observation (t = τ) when τ − t_newest ≥ 15 s.
/// So an observation's stored cumulative is exact at u = the time of the last swap in its bucket, with t ≤ u ≤ t + 14, and u is
/// before the next observation's timestamp: u ≤ min(t + 14, t_next − 1). The true average over [u, t_end] is (c_end − c)/(t_end − u).
/// Dividing by t_end − t (what a naive reader does) overstates the elapsed time and biases the TWAP LOW by up to 14/window (2.3 % at
/// 600 s) — which loosens the guard. Dividing by t_end − t_eff with t_eff = min(t + 14, t_next − 1) ≥ u never overstates it: the
/// result is the true average × (t_end − u)/(t_end − t_eff) ∈ [1, 1 + 14/(window − 14)], i.e. biased HIGH by at most ≈ 2.4 % at
/// 600 s, so the guard and the TWAP min-out can only be stricter than exact, never looser.
pub fn effective_obs_time(t: u64, t_next: Option<u64>) -> u64 {
    let upper = t.saturating_add(14);
    match t_next {
        Some(n) if n > t => upper.min(n - 1),
        _ => upper,
    }
}

/// Time-weighted average of the SOL price in tokens (Q32) over the `window_secs` (at least) ending NOW.
///
/// End point: the newest observation's cumulative is exact at `last_update_timestamp`; from then to `now` no swap has touched the
/// pool (every swap updates the oracle first), so the price over (last_update, now] is the pool's current price — the very price
/// CPMM will accumulate for that interval at the next swap (states/pool.rs token_price_x32: net-of-fee vault ratio × 2^32, which
/// is `current_price_x32`). The cumulative is extended by `current_price_x32 × (now − last_update)`. A same-transaction front-run
/// is itself a swap: it moves last_update to now, so the extension adds nothing and the manipulated price never enters the TWAP.
/// Without the extension a quiet pool's TWAP would stay frozen at the pre-crank price after the crank's own (≤ 4 %) price impact and
/// block every later crank until someone else traded.
///
/// Start point: the newest OLDER observation whose effective time (`effective_obs_time`) is at least `window_secs` before now.
/// Returns None when no observation is old enough.
pub fn twap_sol_price_x32(acc: &AccountInfo, wsol_is_token_0: bool, window_secs: u32, now: i64, current_price_x32: u128) -> Result<Option<u128>> {
    let d = checked_data(acc, &OBSERVATION_STATE_DISCRIMINATOR, OBSERVATION_STATE_LEN)?;
    const INDEX: usize = 9;
    const OBS: usize = 43;
    const OBS_LEN: usize = 40;
    let newest_idx = u16::from_le_bytes([d[INDEX], d[INDEX + 1]]) as usize;
    require!(newest_idx < OBSERVATION_NUM, BurnError::InvalidCpmmAccount);
    // token_0_price = token_1 per token_0 (SOL price in tokens when WSOL is token_0); token_1_price is the reverse.
    let cum_off = if wsol_is_token_0 { 8 } else { 24 };
    let at = |i: usize| -> (u64, u128) {
        let base = OBS + i * OBS_LEN;
        (u64_at(&d, base), u128_at(&d, base + cum_off))
    };
    let (t_new, c_new) = at(newest_idx);
    if t_new == 0 {
        return Ok(None);
    }
    // The newest observation's cumulative is current as of `last_update_timestamp` (updates inside a 15 s bucket accumulate into
    // the bucket's entry without moving its timestamp): that end point is exact. Older entries use effective_obs_time (see above).
    let last_update = u64_at(&d, OBS + OBSERVATION_NUM * OBS_LEN).max(t_new);
    let now = now.max(0) as u64;
    let t_end = now.max(last_update);
    // cumulative_token_price_x32 wraps (CPMM uses wrapping_add); differences below are wrapping too.
    let c_last = c_new;
    let c_new = c_new.wrapping_add(current_price_x32.wrapping_mul((t_end - last_update) as u128));
    let cutoff = t_end.saturating_sub(window_secs as u64);
    // Review-3 L-1: the NEWEST observation is an eligible start too, dated at `last_update` where its cumulative is exact. When no
    // swap happened inside the window (last_update ≤ cutoff) it is the latest eligible start, and the TWAP over [last_update, now] is
    // the price that has held for the whole window — the current price — so a quiet pool is crankable again one window after the last
    // trade instead of after the whole preceding quiet gap. Never weaker than spot: a same-transaction push is itself a swap that moves
    // last_update to now, which makes the newest observation ineligible.
    let mut best: Option<(u64, u128)> = if last_update <= cutoff { Some((last_update, c_last)) } else { None };
    for i in 0..OBSERVATION_NUM {
        if i == newest_idx {
            continue;
        }
        let (t, c) = at(i);
        if t == 0 {
            continue;
        }
        // The ring successor of a non-newest entry is the observation written right after it (or the newest one).
        let (t_next, _) = at((i + 1) % OBSERVATION_NUM);
        let t_eff = effective_obs_time(t, if t_next > t { Some(t_next) } else { None });
        if t_eff > cutoff {
            continue;
        }
        if best.map(|(bt, _)| t_eff > bt).unwrap_or(true) {
            best = Some((t_eff, c));
        }
    }
    Ok(best.and_then(|(t_old, c_old)| {
        let dt = t_end.checked_sub(t_old).filter(|x| *x > 0)?;
        Some(c_new.wrapping_sub(c_old) / dt as u128)
    }))
}

/// The accounts of `swap_base_input`, in CPMM's order.
pub struct SwapAccounts<'a, 'info> {
    pub payer: &'a AccountInfo<'info>,
    pub authority: &'a AccountInfo<'info>,
    pub amm_config: &'a AccountInfo<'info>,
    pub pool_state: &'a AccountInfo<'info>,
    pub input_token_account: &'a AccountInfo<'info>,
    pub output_token_account: &'a AccountInfo<'info>,
    pub input_vault: &'a AccountInfo<'info>,
    pub output_vault: &'a AccountInfo<'info>,
    pub input_token_program: &'a AccountInfo<'info>,
    pub output_token_program: &'a AccountInfo<'info>,
    pub input_token_mint: &'a AccountInfo<'info>,
    pub output_token_mint: &'a AccountInfo<'info>,
    pub observation_state: &'a AccountInfo<'info>,
}

pub fn swap_base_input<'info>(a: SwapAccounts<'_, 'info>, amount_in: u64, minimum_amount_out: u64, signer_seeds: &[&[&[u8]]]) -> Result<()> {
    let mut data = Vec::with_capacity(24);
    data.extend_from_slice(&SWAP_BASE_INPUT_DISCRIMINATOR);
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&minimum_amount_out.to_le_bytes());
    let ix = Instruction {
        program_id: CPMM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*a.payer.key, true),
            AccountMeta::new_readonly(*a.authority.key, false),
            AccountMeta::new_readonly(*a.amm_config.key, false),
            AccountMeta::new(*a.pool_state.key, false),
            AccountMeta::new(*a.input_token_account.key, false),
            AccountMeta::new(*a.output_token_account.key, false),
            AccountMeta::new(*a.input_vault.key, false),
            AccountMeta::new(*a.output_vault.key, false),
            AccountMeta::new_readonly(*a.input_token_program.key, false),
            AccountMeta::new_readonly(*a.output_token_program.key, false),
            AccountMeta::new_readonly(*a.input_token_mint.key, false),
            AccountMeta::new_readonly(*a.output_token_mint.key, false),
            AccountMeta::new(*a.observation_state.key, false),
        ],
        data,
    };
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            a.payer.clone(),
            a.authority.clone(),
            a.amm_config.clone(),
            a.pool_state.clone(),
            a.input_token_account.clone(),
            a.output_token_account.clone(),
            a.input_vault.clone(),
            a.output_vault.clone(),
            a.input_token_program.clone(),
            a.output_token_program.clone(),
            a.input_token_mint.clone(),
            a.output_token_mint.clone(),
            a.observation_state.clone(),
        ],
        signer_seeds,
    )
    .map_err(Into::into)
}

// ------------------------------------------------------------------------------------------------------------------------------
// Review-2 F5: pool provenance — LaunchLab's deterministic migration pool and a burned/locked LP
// ------------------------------------------------------------------------------------------------------------------------------

/// The CPMM pool PDA for (amm_config, mints) — raydium-cp-swap initialize.rs `create_pool`: [POOL_SEED, amm_config, token_0_mint,
/// token_1_mint] with token_0 < token_1. A pool at any other address was created from a random keypair, which LaunchLab's
/// migration does not use.
pub fn pool_pda(amm_config: &Pubkey, mint_a: &Pubkey, mint_b: &Pubkey) -> Pubkey {
    let (t0, t1) = if mint_a < mint_b { (mint_a, mint_b) } else { (mint_b, mint_a) };
    Pubkey::find_program_address(&[crate::constants::CPMM_POOL_SEED, amm_config.as_ref(), t0.as_ref(), t1.as_ref()], &CPMM_PROGRAM_ID).0
}

/// Burned + locked share of the pool's LP in basis points of `pool.lp_supply`:
///   burned = lp_supply − LP mint supply   (CPMM's 100 never-minted units plus every SPL burn; CPMM never reduces lp_supply on a burn)
///   locked = the LP held by Raydium's LP lock authority (LOCK_CPMM_AUTHORITY's associated token account for the LP mint)
/// An LP holder can withdraw only from the remainder.
pub fn locked_lp_bps(lp_supply: u64, lp_mint_supply: u64, locked: u64) -> u128 {
    if lp_supply == 0 {
        return 0;
    }
    let burned = lp_supply.saturating_sub(lp_mint_supply) as u128;
    let held = (locked as u128).min(lp_mint_supply as u128);
    ((burned + held) * crate::constants::BPS_DENOMINATOR) / lp_supply as u128
}

/// The token's LaunchLab pool (["pool", mint, WSOL] under LaunchLab): who LaunchLab recorded as creator, which platform it launched
/// on, and whether it migrates to CPMM. Owner- and address-checked (only LaunchLab can create an account at its own PDA).
#[derive(Debug, Clone, Copy)]
pub struct LaunchLabPoolView {
    pub migrate_type: u8,
    pub platform_id: Pubkey,
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub creator: Pubkey,
}

impl LaunchLabPoolView {
    pub fn load(acc: &AccountInfo, mint: &Pubkey) -> Result<Self> {
        use crate::constants::*;
        let expected = Pubkey::find_program_address(&[LAUNCHLAB_POOL_SEED, mint.as_ref(), NATIVE_MINT.as_ref()], &LAUNCHLAB_PROGRAM_ID).0;
        require_keys_eq!(*acc.key, expected, BurnError::InvalidLaunchLabAccount);
        require_keys_eq!(*acc.owner, LAUNCHLAB_PROGRAM_ID, BurnError::InvalidLaunchLabAccount);
        let d = acc.try_borrow_data()?;
        require!(d.len() >= LL_POOL_MIN_LEN, BurnError::InvalidLaunchLabAccount);
        Ok(LaunchLabPoolView {
            migrate_type: d[LL_POOL_MIGRATE_TYPE],
            platform_id: pk(&d, LL_POOL_PLATFORM_ID),
            mint_a: pk(&d, LL_POOL_MINT_A),
            mint_b: pk(&d, LL_POOL_MINT_B),
            creator: pk(&d, LL_POOL_CREATOR),
        })
    }
}

/// The LaunchLab platform's CPMM AmmConfig for migrations (`cpConfigId`). Owner-checked and key-checked against the pool's platformId.
pub fn launchlab_platform_cp_config(acc: &AccountInfo, platform_id: &Pubkey) -> Result<Pubkey> {
    use crate::constants::*;
    require_keys_eq!(*acc.key, *platform_id, BurnError::InvalidLaunchLabAccount);
    require_keys_eq!(*acc.owner, LAUNCHLAB_PROGRAM_ID, BurnError::InvalidLaunchLabAccount);
    let d = acc.try_borrow_data()?;
    require!(d.len() >= LL_PLATFORM_MIN_LEN, BurnError::InvalidLaunchLabAccount);
    Ok(pk(&d, LL_PLATFORM_CP_CONFIG_ID))
}
