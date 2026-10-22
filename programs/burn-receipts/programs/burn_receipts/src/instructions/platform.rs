//! THE PLATFORM CONFIG — one account for the whole program, holding the single temporary, pre-audit power the owner asked for
//! (2026-10-09): a BURN-POOL CAP. While it is in force, `crank_buyback` computes a token's spend on min(pool, cap) instead of the
//! whole fee pool; SOL above the cap simply stays in the fee PDA (it is never moved anywhere else) and a `BurnPoolCapBound` event is
//! emitted each time the cap binds.
//!
//! Limits on that power, all enforced here:
//!   · created once, only by the program's upgrade authority (so nobody can squat it between deploy and init);
//!   · the cap can only be RAISED (never lowered — lowering would be a way to stall burns), through a public 48 h timelock that anyone
//!     can execute once it has elapsed;
//!   · it SUNSETS automatically at `cap_sunset_ts` (fixed at init, at most 365 days out, never extendable): after that the cap is
//!     ignored by the program whatever the authority does;
//!   · the authority can renounce (then the cap can never be raised again and still sunsets on schedule);
//!   · review-3 I-2: the initial cap EQUALS the default (25 SOL) — creating the config can no longer lower the cap in force;
//!   · review-3 L-4: an optional CRANKER ALLOWLIST (≤ 3 keys, set only at creation) restricts crank_buyback to those keys while the cap
//!     is in force — against a multi-block TWAP hold timed by an outside cranker — and stops applying at the cap's sunset or 90 days
//!     after creation, whichever is first (re-check R3-4); it can only be CLEARED (clear_cranker_allowlist: back to permissionless),
//!     never extended — by the authority OR by any allowlisted key, so a renounced authority cannot leave lost keys in force.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;

use crate::constants::*;
use crate::error::BurnError;
use crate::events::{CapRaiseCancelled, CapRaiseProposed, CapRaised, CrankerAllowlistCleared, PlatformAuthorityRenounced, PlatformInitialized};
use crate::state::PlatformConfig;

#[event_cpi]
#[derive(Accounts)]
pub struct InitializePlatform<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Must be the program's current upgrade authority.
    pub upgrade_authority: Signer<'info>,
    #[account(
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = bpf_loader_upgradeable::ID,
        constraint = program_data.upgrade_authority_address == Some(upgrade_authority.key()) @ BurnError::NotUpgradeAuthority
    )]
    pub program_data: Account<'info, ProgramData>,
    #[account(init, payer = payer, space = 8 + PlatformConfig::INIT_SPACE, seeds = [PLATFORM_SEED], bump)]
    pub platform: Box<Account<'info, PlatformConfig>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_platform(ctx: Context<InitializePlatform>, authority: Pubkey, burn_pool_cap_lamports: u64, cap_sunset_ts: i64, crankers: Vec<Pubkey>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    // Review-3 I-2: the default cap is already in force without a PlatformConfig; creating one may not lower it.
    require!(burn_pool_cap_lamports == DEFAULT_BURN_POOL_CAP_LAMPORTS, BurnError::CapNotDefault);
    // Review-3 L-4: ≤ 3 distinct, non-default crankers (empty = permissionless).
    require!(crankers.len() <= MAX_CRANKERS, BurnError::InvalidAttesters);
    for (i, k) in crankers.iter().enumerate() {
        require!(*k != Pubkey::default() && !crankers[..i].contains(k), BurnError::InvalidAttesters);
    }
    // Review I-1: the initial cap is at most the owner's 25 SOL default; anything higher goes through the 48 h raise.
    // Review-2 F8: and at least 1 SOL (a mis-click guard: a dust cap would stall every burn until the sunset).
    require!((MIN_BURN_POOL_CAP_LAMPORTS..=DEFAULT_BURN_POOL_CAP_LAMPORTS).contains(&burn_pool_cap_lamports), BurnError::InvalidRule);
    // Review-2 F8: the sunset can never outlive the hard-coded default sunset, however late the PlatformConfig is created.
    require!(cap_sunset_ts > now && cap_sunset_ts <= now + MAX_CAP_SUNSET_SECS && cap_sunset_ts <= DEFAULT_CAP_SUNSET_TS, BurnError::InvalidSunset);
    let p = &mut ctx.accounts.platform;
    p.version = 1;
    p.bump = ctx.bumps.platform;
    p.authority = authority;
    p.burn_pool_cap_lamports = burn_pool_cap_lamports;
    p.cap_sunset_ts = cap_sunset_ts;
    p.pending_cap_lamports = 0;
    p.pending_cap_eta = 0;
    p.created_at = now;
    p.crankers = [Pubkey::default(); MAX_CRANKERS];
    p.crankers[..crankers.len()].copy_from_slice(&crankers);
    p.cranker_count = crankers.len() as u8;
    p.reserved = [0u8; 64];
    let platform = p.key();
    emit_cpi!(PlatformInitialized { platform, authority, burn_pool_cap_lamports, cap_sunset_ts, initialized_by: ctx.accounts.upgrade_authority.key(), crankers });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct PlatformAuthorityOnly<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [PLATFORM_SEED], bump = platform.bump)]
    pub platform: Box<Account<'info, PlatformConfig>>,
}

fn require_platform_authority(p: &PlatformConfig, signer: &Pubkey) -> Result<()> {
    require!(p.authority != Pubkey::default(), BurnError::AdminRenounced);
    require_keys_eq!(p.authority, *signer, BurnError::NotAdmin);
    Ok(())
}

pub fn handle_propose_cap_raise(ctx: Context<PlatformAuthorityOnly>, new_cap_lamports: u64) -> Result<()> {
    let authority = ctx.accounts.authority.key();
    let p = &mut ctx.accounts.platform;
    require_platform_authority(p, &authority)?;
    require!(new_cap_lamports > p.burn_pool_cap_lamports, BurnError::CapNotRaised);
    let overwrote = p.pending_cap_eta != 0;
    let eta = Clock::get()?.unix_timestamp.checked_add(CAP_TIMELOCK_SECS).ok_or(BurnError::MathOverflow)?;
    p.pending_cap_lamports = new_cap_lamports;
    p.pending_cap_eta = eta;
    let (platform, current) = (p.key(), p.burn_pool_cap_lamports);
    if overwrote {
        emit_cpi!(CapRaiseCancelled { platform, cancelled_by: authority });
    }
    emit_cpi!(CapRaiseProposed { platform, proposed_by: authority, current_cap_lamports: current, new_cap_lamports, eta });
    Ok(())
}

pub fn handle_cancel_cap_raise(ctx: Context<PlatformAuthorityOnly>) -> Result<()> {
    let authority = ctx.accounts.authority.key();
    let p = &mut ctx.accounts.platform;
    require_platform_authority(p, &authority)?;
    require!(p.pending_cap_eta != 0, BurnError::NoPendingChange);
    p.pending_cap_lamports = 0;
    p.pending_cap_eta = 0;
    let platform = p.key();
    emit_cpi!(CapRaiseCancelled { platform, cancelled_by: authority });
    Ok(())
}

pub fn handle_renounce_platform_authority(ctx: Context<PlatformAuthorityOnly>) -> Result<()> {
    let authority = ctx.accounts.authority.key();
    let p = &mut ctx.accounts.platform;
    require_platform_authority(p, &authority)?;
    let had_pending = p.pending_cap_eta != 0;
    p.authority = Pubkey::default();
    p.pending_cap_lamports = 0;
    p.pending_cap_eta = 0;
    let platform = p.key();
    if had_pending {
        emit_cpi!(CapRaiseCancelled { platform, cancelled_by: authority });
    }
    emit_cpi!(PlatformAuthorityRenounced { platform, former_authority: authority });
    Ok(())
}

/// PERMISSIONLESS once the 48 h timelock has elapsed.
#[event_cpi]
#[derive(Accounts)]
pub struct ApplyCapRaise<'info> {
    /// Anyone (recorded in the event).
    pub caller: Signer<'info>,
    #[account(mut, seeds = [PLATFORM_SEED], bump = platform.bump)]
    pub platform: Box<Account<'info, PlatformConfig>>,
}

pub fn handle_apply_cap_raise(ctx: Context<ApplyCapRaise>) -> Result<()> {
    let caller = ctx.accounts.caller.key();
    let p = &mut ctx.accounts.platform;
    require!(p.pending_cap_eta != 0, BurnError::NoPendingChange);
    require!(Clock::get()?.unix_timestamp >= p.pending_cap_eta, BurnError::TimelockNotElapsed);
    require!(p.pending_cap_lamports > p.burn_pool_cap_lamports, BurnError::CapNotRaised);
    let old = p.burn_pool_cap_lamports;
    p.burn_pool_cap_lamports = p.pending_cap_lamports;
    p.pending_cap_lamports = 0;
    p.pending_cap_eta = 0;
    let (platform, new_cap) = (p.key(), p.burn_pool_cap_lamports);
    emit_cpi!(CapRaised { platform, applied_by: caller, old_cap_lamports: old, new_cap_lamports: new_cap });
    Ok(())
}

/// Review-3 L-4 + re-check R3-4: the platform authority OR any allowlisted key returns cranking to permissionless (the only change the
/// allowlist ever allows).
#[event_cpi]
#[derive(Accounts)]
pub struct ClearCrankerAllowlist<'info> {
    /// The platform authority (while not renounced) or a key on the allowlist.
    pub caller: Signer<'info>,
    #[account(mut, seeds = [PLATFORM_SEED], bump = platform.bump)]
    pub platform: Box<Account<'info, PlatformConfig>>,
}

pub fn handle_clear_cranker_allowlist(ctx: Context<ClearCrankerAllowlist>) -> Result<()> {
    let authority = ctx.accounts.caller.key();
    let p = &mut ctx.accounts.platform;
    let listed = p.crankers[..p.cranker_count as usize].contains(&authority);
    if !listed {
        require_platform_authority(p, &authority)?;
    }
    require!(p.cranker_count > 0, BurnError::NoPendingChange);
    p.crankers = [Pubkey::default(); MAX_CRANKERS];
    p.cranker_count = 0;
    let platform = p.key();
    emit_cpi!(CrankerAllowlistCleared { platform, cleared_by: authority });
    Ok(())
}
