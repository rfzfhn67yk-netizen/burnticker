//! THE PLATFORM CONFIG — one account for the whole program. It was created (2026-10-09) to hold a temporary, pre-audit BURN-POOL CAP
//! (25 SOL per burn day, raise-only behind a 48 h timelock, with an optional cranker allowlist while the cap was in force).
//!
//! OWNER DECISION 2026-10-25: the cap and the cranker allowlist are REMOVED. A burn pool spends what the rule says with no per-day
//! platform cap, and every crank is permissionless. What is left here:
//!   · initialize_platform still creates the account (upgrade authority, once) and fixes the platform SUNSET (at most 365 days out and
//!     no later than DEFAULT_CAP_SUNSET_TS), which now only closes the stranding-recovery registration-policy switch (admin.rs). The
//!     cap and cranker arguments are accepted so the instruction's interface is unchanged, but they are not stored (the fields stay in
//!     the layout as reserved zeros, so the account deployed on mainnet still deserialises);
//!   · propose_cap_raise / cancel_cap_raise / apply_cap_raise keep their entry points (a stable IDL) and always refuse (CapRemoved):
//!     the platform authority holds no cap power any more;
//!   · renounce_platform_authority and clear_cranker_allowlist still work; the second only tidies the unused list (it has no effect on
//!     who may crank).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;

use crate::constants::*;
use crate::error::BurnError;
use crate::events::{CrankerAllowlistCleared, PlatformAuthorityRenounced, PlatformInitialized};
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

pub fn handle_initialize_platform(ctx: Context<InitializePlatform>, authority: Pubkey, _burn_pool_cap_lamports: u64, cap_sunset_ts: i64, _crankers: Vec<Pubkey>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    // Owner decision 2026-10-25: no cap and no cranker allowlist; the two arguments are accepted for a stable interface, never stored.
    // Review-2 F8: the sunset can never outlive the hard-coded default sunset, however late the PlatformConfig is created.
    require!(cap_sunset_ts > now && cap_sunset_ts <= now + MAX_CAP_SUNSET_SECS && cap_sunset_ts <= DEFAULT_CAP_SUNSET_TS, BurnError::InvalidSunset);
    let p = &mut ctx.accounts.platform;
    p.version = 1;
    p.bump = ctx.bumps.platform;
    p.authority = authority;
    p.burn_pool_cap_lamports = 0;
    p.cap_sunset_ts = cap_sunset_ts;
    p.pending_cap_lamports = 0;
    p.pending_cap_eta = 0;
    p.created_at = now;
    p.crankers = [Pubkey::default(); PLATFORM_CRANKER_SLOTS];
    p.cranker_count = 0;
    p.reserved = [0u8; 64];
    let platform = p.key();
    emit_cpi!(PlatformInitialized { platform, authority, burn_pool_cap_lamports: 0, cap_sunset_ts, initialized_by: ctx.accounts.upgrade_authority.key(), crankers: Vec::new() });
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

/// Owner decision 2026-10-25: there is no burn-pool cap to raise. The entry point stays (a stable IDL) and always refuses.
pub fn handle_propose_cap_raise(_ctx: Context<PlatformAuthorityOnly>, _new_cap_lamports: u64) -> Result<()> {
    err!(BurnError::CapRemoved)
}

/// Owner decision 2026-10-25: nothing to cancel; always refuses (CapRemoved).
pub fn handle_cancel_cap_raise(_ctx: Context<PlatformAuthorityOnly>) -> Result<()> {
    err!(BurnError::CapRemoved)
}

pub fn handle_renounce_platform_authority(ctx: Context<PlatformAuthorityOnly>) -> Result<()> {
    let authority = ctx.accounts.authority.key();
    let p = &mut ctx.accounts.platform;
    require_platform_authority(p, &authority)?;
    p.authority = Pubkey::default();
    let platform = p.key();
    emit_cpi!(PlatformAuthorityRenounced { platform, former_authority: authority });
    Ok(())
}

/// Owner decision 2026-10-25: there is no burn-pool cap; the entry point stays (a stable IDL) and always refuses (CapRemoved).
#[event_cpi]
#[derive(Accounts)]
pub struct ApplyCapRaise<'info> {
    /// Anyone.
    pub caller: Signer<'info>,
    #[account(mut, seeds = [PLATFORM_SEED], bump = platform.bump)]
    pub platform: Box<Account<'info, PlatformConfig>>,
}

pub fn handle_apply_cap_raise(_ctx: Context<ApplyCapRaise>) -> Result<()> {
    err!(BurnError::CapRemoved)
}

/// Review-3 L-4 + re-check R3-4: the platform authority OR any key on the (unused) list clears it. Since 2026-10-25 the list has no
/// effect on cranking (every crank is permissionless); this only tidies the stored bytes.
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
    p.crankers = [Pubkey::default(); PLATFORM_CRANKER_SLOTS];
    p.cranker_count = 0;
    let platform = p.key();
    emit_cpi!(CrankerAllowlistCleared { platform, cleared_by: authority });
    Ok(())
}
