//! Review M-4 — a rescue path for a dead pool that still gives nobody a choice:
//!   check_pool_health   PERMISSIONLESS. Observes the registered pool now: if it is untradeable it records the observation
//!                       (`pool_untradeable_since` = start of the current spell, `pool_untradeable_last_seen` = now); if it is
//!                       tradeable it clears both. A successful buyback swap also clears them.
//!   replace_pool        PERMISSIONLESS, policy 0 only. After ≥ 7 days of CONTINUOUS recorded untradeability, and while the old
//!                       pool is still untradeable, registers a DIFFERENT pool that passes every register_pool provenance check
//!                       (LaunchLab's migration pool for the platform's current cpConfigId, fee-PDA creator, ≥ 50 % LP burned or
//!                       locked) and is tradeable now.
//!
//! Isolation (review-3 L-3, re-check R3-1): both instructions must be TOP-LEVEL instructions (stack height 1 — no wrapper program can
//! CPI a swap and the observation inside one instruction), and no other instruction of the transaction may be a Raydium CPMM
//! instruction or list the pool, either of its vaults or its observation account (a donation into the WSOL vault lists the vault).
//! Residual (documented, accepted — README "Pool health"): a Jito BUNDLE of separate transactions (move the reserve / observe / move
//! it back) is atomic for the bundler but invisible to the instructions sysvar. Clearing a spell that way costs a bundle tip and both
//! legs' fees; forging one still needs two observations ≥ 1 h apart; the only reach is replace_pool's 7-day clock (the 30-day queue
//! unblock depends on the crank's own blocked test).
//!
//! Review-2 F6: "continuous" means consecutive untradeable observations at most 24 h apart (UNTRADEABLE_MAX_GAP_SECS). An observation
//! after a longer gap starts a new spell at that moment, so "flag once, trade normally for a week, one bad block" no longer works:
//! someone has to show the pool untradeable at least once a day for the whole 7 days (the keeper does this on every deferred crank).
//!
//! "Untradeable" is deliberately conservative: the pool account is gone / not a CPMM PoolState, or its status disables swaps, or its
//! WSOL reserve net of owed fees is under 0.01 SOL. Thin-but-alive pools stay registered.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint};

use crate::constants::*;
use crate::cpmm::PoolView;
use crate::instructions::register_pool::{verify_pool_provenance, LaunchLabProof};
use crate::error::BurnError;
use crate::events::{PoolReplaced, PoolUntradeableCleared, PoolUntradeableFlagged};
use crate::instructions::crank_common::require_fixed_supply;
use crate::state::TokenConfig;

pub const UNTRADEABLE_NONE: u8 = 0;
pub const UNTRADEABLE_POOL_ACCOUNT: u8 = 1;
pub const UNTRADEABLE_SWAPS_DISABLED: u8 = 2;
pub const UNTRADEABLE_RESERVE: u8 = 3;

/// Why the pool is untradeable at `now` (0 = tradeable). The WSOL vault passed must be the pool's own WSOL vault when the pool is
/// readable — a wrong vault is an error, never a reason.
pub fn untradeable_reason(pool_acc: &AccountInfo, wsol_vault: &AccountInfo, mint: &Pubkey, now: i64) -> Result<u8> {
    let Some(pool) = PoolView::try_load(pool_acc) else { return Ok(UNTRADEABLE_POOL_ACCOUNT) };
    let Some(wsol0) = pool.wsol_is_token_0(&NATIVE_MINT, mint) else { return Ok(UNTRADEABLE_POOL_ACCOUNT) };
    if !pool.swaps_enabled(now) {
        return Ok(UNTRADEABLE_SWAPS_DISABLED);
    }
    let (vault_key, fees) = if wsol0 { (pool.token_0_vault, pool.fees_0) } else { (pool.token_1_vault, pool.fees_1) };
    require_keys_eq!(*wsol_vault.key, vault_key, BurnError::InvalidCpmmAccount);
    let amount = if wsol_vault.owner == &token::ID && wsol_vault.data_len() >= 72 {
        let d = wsol_vault.try_borrow_data()?;
        u64::from_le_bytes(d[64..72].try_into().map_err(|_| BurnError::InvalidCpmmAccount)?)
    } else {
        0
    };
    if amount.saturating_sub(fees) < UNTRADEABLE_WSOL_RESERVE_LAMPORTS {
        return Ok(UNTRADEABLE_RESERVE);
    }
    Ok(UNTRADEABLE_NONE)
}

/// Records one untradeable observation at `now`. Returns (since, started, candidate_at):
///   * a running spell (last observation ≤ 24 h ago, review-2 F6) continues;
///   * otherwise (review-3 L-3) a spell STARTS only on the second of two observations at least 1 h and at most 24 h apart, dated from
///     the first; until then the observation is a pending candidate (`since` = 0). One forged observation in a thin pool therefore
///     cannot start a spell, and forging two needs two transactions an hour apart, each paying for its own round trip.
pub fn observe_untradeable(c: &mut TokenConfig, now: i64) -> (i64, bool, i64) {
    let running = c.pool_untradeable_since != 0 && c.pool_untradeable_last_seen != 0 && now.saturating_sub(c.pool_untradeable_last_seen) <= UNTRADEABLE_MAX_GAP_SECS;
    if running {
        c.pool_untradeable_last_seen = now;
        return (c.pool_untradeable_since, false, 0);
    }
    c.pool_untradeable_since = 0;
    c.pool_untradeable_last_seen = 0;
    let cand = c.pool_untradeable_candidate_at;
    let age = now.saturating_sub(cand);
    if cand != 0 && (UNTRADEABLE_CONFIRM_SECS..=UNTRADEABLE_MAX_GAP_SECS).contains(&age) {
        c.pool_untradeable_since = cand;
        c.pool_untradeable_last_seen = now;
        c.pool_untradeable_candidate_at = 0;
        return (cand, true, 0);
    }
    if cand == 0 || age > UNTRADEABLE_MAX_GAP_SECS {
        c.pool_untradeable_candidate_at = now;
    }
    (0, false, c.pool_untradeable_candidate_at)
}

/// The keys whose presence in another instruction makes an observation untrustworthy (re-check R3-1): the pool and, when it is a
/// readable CPMM pool, its two vaults and its observation account.
pub fn touched_keys(pool_acc: &AccountInfo, out: &mut Vec<Pubkey>) {
    out.push(*pool_acc.key);
    if let Some(p) = PoolView::try_load(pool_acc) {
        out.extend_from_slice(&[p.token_0_vault, p.token_1_vault, p.observation_key]);
    }
}

/// Review-3 L-3 + re-check R3-1: an observation must be a TOP-LEVEL instruction (`get_stack_height() == 1`, so a wrapper program cannot
/// CPI `[swap, check]` inside one instruction) and may not share its transaction with any other instruction that touches the pool (a
/// CPMM instruction, or any instruction listing one of `keys`: the pool, its vaults, its observation account) — `sell → check → buy
/// back` or `donate → check` could otherwise forge or clear an observation for fees. Bundles of separate transactions remain (module doc).
pub fn require_pool_untouched(ix_sysvar: &AccountInfo, keys: &[Pubkey]) -> Result<()> {
    use anchor_lang::solana_program::instruction::{get_stack_height, TRANSACTION_LEVEL_STACK_HEIGHT};
    use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};
    require!(get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT, BurnError::PoolTouchedInTransaction);
    let current = load_current_index_checked(ix_sysvar)? as usize;
    let count = {
        let data = ix_sysvar.try_borrow_data()?;
        require!(data.len() >= 2, BurnError::PoolTouchedInTransaction);
        u16::from_le_bytes([data[0], data[1]]) as usize
    };
    for i in 0..count {
        if i == current {
            continue;
        }
        let ix = load_instruction_at_checked(i, ix_sysvar)?;
        require!(ix.program_id != CPMM_PROGRAM_ID && !ix.accounts.iter().any(|m| keys.contains(&m.pubkey)), BurnError::PoolTouchedInTransaction);
    }
    Ok(())
}

/// How long the pool has been continuously untradeable at `now`, counting `now` as an observation (0 when it would restart).
pub fn continuous_untradeable_secs(c: &TokenConfig, now: i64) -> i64 {
    if c.pool_untradeable_since == 0 || c.pool_untradeable_last_seen == 0 || now.saturating_sub(c.pool_untradeable_last_seen) > UNTRADEABLE_MAX_GAP_SECS {
        0
    } else {
        now.saturating_sub(c.pool_untradeable_since)
    }
}

pub fn clear_untradeable(c: &mut TokenConfig) -> bool {
    let was = c.pool_untradeable_since != 0 || c.pool_untradeable_candidate_at != 0;
    c.pool_untradeable_since = 0;
    c.pool_untradeable_last_seen = 0;
    c.pool_untradeable_candidate_at = 0;
    was
}

#[event_cpi]
#[derive(Accounts)]
pub struct CheckPoolHealth<'info> {
    /// Anyone.
    pub caller: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    /// CHECK: the registered pool (address-checked); it may have been closed, which is itself a reason.
    #[account(address = config.cpmm_pool @ BurnError::PoolNotRegistered)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: must be the pool's WSOL vault (checked in untradeable_reason when the pool is readable; any account when it is not).
    pub wsol_vault: UncheckedAccount<'info>,
    /// CHECK: address-checked: the instructions sysvar (review-3 L-3).
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
}

pub fn handle_check_pool_health(ctx: Context<CheckPoolHealth>) -> Result<()> {
    require!(ctx.accounts.config.cpmm_pool != Pubkey::default(), BurnError::PoolNotRegistered);
    let mut keys = Vec::with_capacity(4);
    touched_keys(&ctx.accounts.pool_state.to_account_info(), &mut keys);
    require_pool_untouched(&ctx.accounts.instructions.to_account_info(), &keys)?;
    let now = Clock::get()?.unix_timestamp;
    let mint = ctx.accounts.config.mint;
    let reason = untradeable_reason(&ctx.accounts.pool_state.to_account_info(), &ctx.accounts.wsol_vault.to_account_info(), &mint, now)?;
    let c = &mut ctx.accounts.config;
    let (config, pool) = (c.key(), c.cpmm_pool);
    if reason != UNTRADEABLE_NONE {
        let (since, restarted, candidate_at) = observe_untradeable(c, now);
        emit_cpi!(PoolUntradeableFlagged { config, pool, since, observed_at: now, restarted, reason, candidate_at });
    } else if clear_untradeable(c) {
        emit_cpi!(PoolUntradeableCleared { config, pool });
    }
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct ReplacePool<'info> {
    /// Anyone (recorded in the event).
    pub caller: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(seeds = [FEE_SEED, config.mint.as_ref()], bump = config.fee_bump)]
    pub fee_vault: SystemAccount<'info>,
    #[account(address = config.mint)]
    pub mint: Box<Account<'info, Mint>>,
    /// CHECK: the registered (dead) pool, address-checked.
    #[account(address = config.cpmm_pool @ BurnError::PoolNotRegistered)]
    pub old_pool: UncheckedAccount<'info>,
    /// CHECK: the old pool's WSOL vault (checked against it when readable).
    pub old_wsol_vault: UncheckedAccount<'info>,
    /// CHECK: the candidate; every register_pool provenance check plus tradeability, in the handler.
    pub new_pool: UncheckedAccount<'info>,
    /// CHECK: the candidate's WSOL vault (checked against it).
    pub new_wsol_vault: UncheckedAccount<'info>,
    /// The candidate's LP mint.
    pub new_lp_mint: Box<Account<'info, Mint>>,
    /// CHECK: ATA(LOCK_CPMM_AUTHORITY, new LP mint), address-checked; may not exist.
    pub new_lp_lock_vault: UncheckedAccount<'info>,
    /// CHECK: the token's LaunchLab pool ["pool", mint, WSOL] (owner + address checked).
    pub launchlab_pool: UncheckedAccount<'info>,
    /// CHECK: the LaunchLab platform pinned at initialize_token (key checked against TokenConfig.ll_platform, owner LaunchLab); its
    /// CURRENT cpConfigId names the replacement's AmmConfig (review-3 I-4: replacement is reachable only after that admin changes it).
    pub launchlab_platform: UncheckedAccount<'info>,
    /// CHECK: address-checked: the instructions sysvar (review-3 L-3).
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
}

pub fn handle_replace_pool(ctx: Context<ReplacePool>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let c = &ctx.accounts.config;
    require!(c.rule.mode == MODE_BUYBACK, BurnError::WrongMode);
    require!(c.registration_policy == POOL_POLICY_CREATOR_IS_FEE_PDA, BurnError::WrongPoolPolicy);
    let mut keys = Vec::with_capacity(8);
    touched_keys(&ctx.accounts.old_pool.to_account_info(), &mut keys);
    touched_keys(&ctx.accounts.new_pool.to_account_info(), &mut keys);
    require_pool_untouched(&ctx.accounts.instructions.to_account_info(), &keys)?;
    require!(c.cpmm_pool != Pubkey::default(), BurnError::PoolNotRegistered);
    let since = c.pool_untradeable_since;
    // Review-2 F6: 7 days of CONTINUOUS untradeability (observations ≤ 24 h apart, this call being the last one).
    require!(continuous_untradeable_secs(c, now) >= POOL_REPLACEMENT_DELAY_SECS, BurnError::PoolStillTradeable);
    let mint = c.mint;
    let old_reason = untradeable_reason(&ctx.accounts.old_pool.to_account_info(), &ctx.accounts.old_wsol_vault.to_account_info(), &mint, now)?;
    require!(old_reason != UNTRADEABLE_NONE, BurnError::PoolStillTradeable);
    require_keys_neq!(ctx.accounts.new_pool.key(), c.cpmm_pool, BurnError::SamePool);
    require_fixed_supply(&ctx.accounts.mint)?;

    let a = &ctx.accounts;
    let llp = a.launchlab_pool.to_account_info();
    let cp_config = crate::cpmm::launchlab_platform_cp_config(&a.launchlab_platform.to_account_info(), &a.config.ll_platform)?;
    verify_pool_provenance(
        &a.new_pool.to_account_info(),
        &mint,
        &a.fee_vault.key(),
        &a.new_lp_mint,
        &a.new_lp_lock_vault.to_account_info(),
        Some(LaunchLabProof { pool: &llp, platform: a.config.ll_platform, cp_config }),
    )?;
    let new_reason = untradeable_reason(&ctx.accounts.new_pool.to_account_info(), &ctx.accounts.new_wsol_vault.to_account_info(), &mint, now)?;
    require!(new_reason == UNTRADEABLE_NONE, BurnError::PoolNotTradable);

    let c = &mut ctx.accounts.config;
    let old_pool = c.cpmm_pool;
    c.cpmm_pool = ctx.accounts.new_pool.key();
    c.pool_verified = true;
    clear_untradeable(c);
    let (config, new_pool) = (c.key(), c.cpmm_pool);
    emit_cpi!(PoolReplaced { config, old_pool, new_pool, untradeable_since: since, caller: ctx.accounts.caller.key() });
    Ok(())
}
