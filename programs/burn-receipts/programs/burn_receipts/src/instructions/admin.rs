//! The config authority's ONLY powers after init, all on the attester set, none on funds or rules:
//!   propose_attesters      a new attester set, applied by ANYONE after a public 48 h timelock. The quorum may never be lowered and
//!                          the set may never be smaller than the quorum (so attesters can be added, rotated or removed only down to
//!                          the quorum), each proposal must keep at least `quorum` of the current keys AND add fewer new keys
//!                          than the new quorum (review-2 F2: the new keys alone never reach a quorum). A compromised key can be
//!                          rotated out — publicly, with 48 h notice.
//!   cancel_attester_change withdraw a pending proposal.
//!   renounce_admin         give the power up forever (also kills any pending proposal).
//! Nothing here touches the rule, the readings, the fee PDA or the vault.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::BurnError;
use crate::events::{AdminRenounced, AttesterChangeApplied, AttesterChangeCancelled, AttesterChangeProposed, RegistrationPolicyApplied, RegistrationPolicyCancelled, RegistrationPolicyProposed};
use crate::cpmm::{launchlab_platform_cp_config, pool_pda};
use crate::instructions::crank_common::{active_cap, require_fixed_supply};
use crate::instructions::pool_health::{clear_untradeable, continuous_untradeable_secs};
use crate::instructions::register_pool::verify_pool_provenance;
use anchor_spl::token::Mint;
use crate::instructions::initialize_token::{governance_hash, validate_attesters};
use crate::state::{AttesterEntry, TokenConfig};

#[event_cpi]
#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
}

fn require_admin(c: &TokenConfig, signer: &Pubkey) -> Result<()> {
    require!(c.admin_active(), BurnError::AdminRenounced);
    require_keys_eq!(c.admin, *signer, BurnError::NotAdmin);
    Ok(())
}

pub fn handle_propose_attesters(ctx: Context<AdminOnly>, attesters: Vec<AttesterEntry>, quorum: u8) -> Result<()> {
    let admin = ctx.accounts.admin.key();
    let c = &mut ctx.accounts.config;
    require_admin(c, &admin)?;
    validate_attesters(&attesters, quorum)?;
    require!(quorum >= c.quorum, BurnError::QuorumLowered);
    let current = c.attester_slice().to_vec();
    // Review L-2: one proposal may rotate keys but must keep at least `quorum` of the current keys, so no single proposal hands
    // the readings to an entirely new set.
    let kept = attesters.iter().filter(|a| current.iter().any(|b| b.key == a.key)).count();
    require!(kept >= c.quorum as usize, BurnError::TooManyAttestersReplaced);
    // Review-2 F2: and fewer NEW keys than the NEW quorum, so every quorum-sized subset of the new set contains a current key —
    // no single proposal ever lets keys the current set never vouched for sign readings on their own.
    let new_keys = attesters.len() - kept;
    require!(new_keys < quorum as usize, BurnError::TooManyAttestersReplaced);
    // Review-3 L-2: when the proposal ADDS keys, the kept keys that count must have been in the set ≥ 7 days — so a key the admin
    // added cannot vouch for the next key the admin adds until it has aged, and two proposals in a row can no longer hand the readings
    // to admin-chosen keys in 96 h (the floor is 48 h + 7 days + 48 h, every step public).
    if new_keys > 0 {
        let now = Clock::get()?.unix_timestamp;
        let seniors = attesters
            .iter()
            .filter(|a| current.iter().position(|b| b.key == a.key).map(|j| now.saturating_sub(c.attester_added_at[j]) >= ATTESTER_SENIORITY_SECS).unwrap_or(false))
            .count();
        require!(seniors >= c.quorum as usize, BurnError::TooManyAttestersReplaced);
    }
    let overwrote = c.pending_eta != 0;
    let added: Vec<AttesterEntry> = attesters.iter().filter(|a| !current.contains(a)).copied().collect();
    let removed: Vec<AttesterEntry> = current.iter().filter(|a| !attesters.contains(a)).copied().collect();
    let eta = Clock::get()?.unix_timestamp.checked_add(ATTESTER_TIMELOCK_SECS).ok_or(BurnError::MathOverflow)?;
    c.pending_attesters = [AttesterEntry::default(); MAX_ATTESTERS];
    c.pending_attesters[..attesters.len()].copy_from_slice(&attesters);
    c.pending_count = attesters.len() as u8;
    c.pending_quorum = quorum;
    c.pending_eta = eta;
    let config = c.key();
    if overwrote {
        // Review I-2: an overwritten proposal is reported as cancelled, so indexers can pair every Proposed with an outcome.
        emit_cpi!(AttesterChangeCancelled { config, cancelled_by: admin });
    }
    emit_cpi!(AttesterChangeProposed { config, proposed_by: admin, attesters, added, removed, quorum, eta });
    Ok(())
}

pub fn handle_cancel_attester_change(ctx: Context<AdminOnly>) -> Result<()> {
    let admin = ctx.accounts.admin.key();
    let c = &mut ctx.accounts.config;
    require_admin(c, &admin)?;
    require!(c.pending_eta != 0, BurnError::NoPendingChange);
    clear_pending(c);
    let config = c.key();
    emit_cpi!(AttesterChangeCancelled { config, cancelled_by: admin });
    Ok(())
}

pub fn handle_renounce_admin(ctx: Context<AdminOnly>) -> Result<()> {
    let admin = ctx.accounts.admin.key();
    let c = &mut ctx.accounts.config;
    require_admin(c, &admin)?;
    c.admin = Pubkey::default();
    let had_pending = c.pending_eta != 0;
    let had_policy = c.pending_policy_eta != 0;
    clear_pending(c);
    clear_pending_policy(c);
    let config = c.key();
    if had_pending {
        emit_cpi!(AttesterChangeCancelled { config, cancelled_by: admin });
    }
    if had_policy {
        emit_cpi!(RegistrationPolicyCancelled { config, cancelled_by: admin, vetoed: false });
    }
    let governance_hash = governance_hash(&c.admin, c.quorum, c.attester_slice());
    emit_cpi!(AdminRenounced { config, former_admin: admin, governance_hash });
    Ok(())
}

fn clear_pending(c: &mut TokenConfig) {
    c.pending_attesters = [AttesterEntry::default(); MAX_ATTESTERS];
    c.pending_count = 0;
    c.pending_quorum = 0;
    c.pending_eta = 0;
}

/// PERMISSIONLESS once the timelock has elapsed (and only while a proposal is pending: renouncing clears it).
#[event_cpi]
#[derive(Accounts)]
pub struct ApplyAttesterChange<'info> {
    /// Anyone (recorded in the event).
    pub caller: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
}

pub fn handle_apply_attester_change(ctx: Context<ApplyAttesterChange>) -> Result<()> {
    let caller = ctx.accounts.caller.key();
    let c = &mut ctx.accounts.config;
    require!(c.pending_eta != 0, BurnError::NoPendingChange);
    require!(Clock::get()?.unix_timestamp >= c.pending_eta, BurnError::TimelockNotElapsed);
    // Re-check at application time (defence in depth; the proposal was validated when made).
    require!(c.pending_quorum >= c.quorum, BurnError::QuorumLowered);
    // Review-3 L-2: kept keys keep their membership date; new keys start their seniority now.
    let now = Clock::get()?.unix_timestamp;
    let mut added_at = [0i64; MAX_ATTESTERS];
    for (i, a) in c.pending_attesters[..c.pending_count as usize].iter().enumerate() {
        added_at[i] = c.attester_slice().iter().position(|b| b.key == a.key).map(|j| c.attester_added_at[j]).unwrap_or(now);
    }
    c.attesters = c.pending_attesters;
    c.attester_count = c.pending_count;
    c.quorum = c.pending_quorum;
    c.attester_added_at = added_at;
    let attesters = c.attesters[..c.attester_count as usize].to_vec();
    let quorum = c.quorum;
    clear_pending(c);
    let config = c.key();
    let governance_hash = governance_hash(&c.admin, quorum, &attesters);
    emit_cpi!(AttesterChangeApplied { config, applied_by: caller, attesters, quorum, governance_hash });
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Review-3 M-3 — the stranding-recovery switch of the registration policy (48 h timelock, sunsets with the pre-audit cap)
// ---------------------------------------------------------------------------------------------------------------------------------

fn clear_pending_policy(c: &mut TokenConfig) {
    c.pending_policy = 0;
    c.pending_policy_pool = Pubkey::default();
    c.pending_policy_eta = 0;
}

/// Re-check R3-2: a proposal applies in [eta, expires_at): 14 days after it was proposed (eta − 48 h), it is dead.
pub fn policy_expires_at(eta: i64) -> i64 {
    eta.saturating_sub(ATTESTER_TIMELOCK_SECS).saturating_add(POLICY_PROPOSAL_TTL_SECS)
}

/// The switch is a STRANDING-RECOVERY power: allowed only while the pre-audit cap is in force (PlatformConfig sunset, or the default
/// 2027-10-01 without one) and only while no pool works — none verified yet, or the registered one continuously untradeable ≥ 7 days.
fn require_policy_switch_window(c: &TokenConfig, platform: &AccountInfo, now: i64) -> Result<()> {
    require!(active_cap(platform, now)?.is_some(), BurnError::PolicySwitchNotAllowed);
    require!(!c.pool_verified || continuous_untradeable_secs(c, now) >= POOL_REPLACEMENT_DELAY_SECS, BurnError::PolicySwitchNotAllowed);
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct RegistrationPolicyAdmin<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    /// CHECK: the platform PDA (seeds-checked); a missing PlatformConfig means the default cap and sunset.
    #[account(seeds = [PLATFORM_SEED], bump)]
    pub platform: UncheckedAccount<'info>,
}

/// ADMIN, 48 h timelock: propose switching the registration policy — to POOL_POLICY_FIXED with `pool` (which must pass the creator +
/// LP checks when applied), or back to POOL_POLICY_CREATOR_IS_FEE_PDA (`pool` = default; needs a pinned LaunchLab platform).
pub fn handle_set_registration_policy(ctx: Context<RegistrationPolicyAdmin>, policy: u8, pool: Pubkey) -> Result<()> {
    let admin = ctx.accounts.admin.key();
    let now = Clock::get()?.unix_timestamp;
    let c = &ctx.accounts.config;
    require_admin(c, &admin)?;
    require!(c.rule.mode == MODE_BUYBACK, BurnError::WrongMode);
    match policy {
        POOL_POLICY_FIXED => require!(pool != Pubkey::default(), BurnError::WrongPoolPolicy),
        POOL_POLICY_CREATOR_IS_FEE_PDA => require!(pool == Pubkey::default() && c.ll_platform != Pubkey::default(), BurnError::WrongPoolPolicy),
        _ => return err!(BurnError::WrongPoolPolicy),
    }
    require_policy_switch_window(c, &ctx.accounts.platform.to_account_info(), now)?;
    let eta = now.checked_add(ATTESTER_TIMELOCK_SECS).ok_or(BurnError::MathOverflow)?;
    let c = &mut ctx.accounts.config;
    let overwrote = c.pending_policy_eta != 0;
    c.pending_policy = policy;
    c.pending_policy_pool = pool;
    c.pending_policy_eta = eta;
    let config = c.key();
    if overwrote {
        emit_cpi!(RegistrationPolicyCancelled { config, cancelled_by: admin, vetoed: false });
    }
    let expires_at = policy_expires_at(eta);
    emit_cpi!(RegistrationPolicyProposed { config, proposed_by: admin, policy, pool, eta, expires_at });
    Ok(())
}

pub fn handle_cancel_registration_policy(ctx: Context<RegistrationPolicyAdmin>) -> Result<()> {
    let admin = ctx.accounts.admin.key();
    let c = &mut ctx.accounts.config;
    require_admin(c, &admin)?;
    require!(c.pending_policy_eta != 0, BurnError::NoPendingChange);
    clear_pending_policy(c);
    let config = c.key();
    emit_cpi!(RegistrationPolicyCancelled { config, cancelled_by: admin, vetoed: false });
    Ok(())
}

/// Re-check R3-2 — the cheap veto: ANY current attester (one signature, no quorum) clears a pending registration-policy proposal. The
/// attesters are the parties a pool switch would otherwise bypass; a veto never changes the policy, it only forces a fresh public
/// proposal (which the admin can make at once — the veto is an alarm, not a lock).
#[event_cpi]
#[derive(Accounts)]
pub struct VetoRegistrationPolicy<'info> {
    pub attester: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
}

pub fn handle_veto_registration_policy(ctx: Context<VetoRegistrationPolicy>) -> Result<()> {
    let attester = ctx.accounts.attester.key();
    let c = &mut ctx.accounts.config;
    require!(c.attester_slice().iter().any(|a| a.key == attester), BurnError::NotAttester);
    require!(c.pending_policy_eta != 0, BurnError::NoPendingChange);
    clear_pending_policy(c);
    let config = c.key();
    emit_cpi!(RegistrationPolicyCancelled { config, cancelled_by: attester, vetoed: true });
    Ok(())
}

/// PERMISSIONLESS after the timelock and before the proposal expires (14 days after it was proposed), re-checking the window. A fixed
/// pool must pass the register_pool policy-1 checks (fee-PDA pool_creator, WSOL/<mint> on SPL Token, ≥ 50 % of the LP burned or
/// locked) AND (re-check R3-2) either have ≥ 90 % of its live LP burned or locked, or be the CPMM pool PDA of a LaunchLab-known
/// AmmConfig — the cpConfigId pinned at initialize_token, or the pinned platform's CURRENT cpConfigId (pass `launchlab_platform`).
#[event_cpi]
#[derive(Accounts)]
pub struct ApplyRegistrationPolicy<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(seeds = [FEE_SEED, config.mint.as_ref()], bump = config.fee_bump)]
    pub fee_vault: SystemAccount<'info>,
    #[account(address = config.mint)]
    pub mint: Box<Account<'info, Mint>>,
    /// CHECK: the platform PDA (seeds-checked).
    #[account(seeds = [PLATFORM_SEED], bump)]
    pub platform: UncheckedAccount<'info>,
    /// CHECK: policy 1: the proposed pool (address-checked against the proposal; parsed by verify_pool_provenance).
    pub pool_state: Option<UncheckedAccount<'info>>,
    /// policy 1: the pool's LP mint.
    pub lp_mint: Option<Box<Account<'info, Mint>>>,
    /// CHECK: policy 1: ATA(LOCK_CPMM_AUTHORITY, lp_mint), address-checked in verify_pool_provenance.
    pub lp_lock_vault: Option<UncheckedAccount<'info>>,
    /// CHECK: optional, policy 1: the LaunchLab platform pinned at initialize_token (key + owner checked); its current cpConfigId
    /// counts as LaunchLab-known for the R3-2 fallback test.
    pub launchlab_platform: Option<UncheckedAccount<'info>>,
}

pub fn handle_apply_registration_policy(ctx: Context<ApplyRegistrationPolicy>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    let c = &a.config;
    require!(c.pending_policy_eta != 0, BurnError::NoPendingChange);
    require!(now >= c.pending_policy_eta, BurnError::TimelockNotElapsed);
    require!(now < policy_expires_at(c.pending_policy_eta), BurnError::PolicyProposalExpired);
    require_policy_switch_window(c, &a.platform.to_account_info(), now)?;
    let (policy, pool) = (c.pending_policy, c.pending_policy_pool);
    if policy == POOL_POLICY_FIXED {
        let (Some(ps), Some(lp), Some(lock)) = (a.pool_state.as_ref(), a.lp_mint.as_ref(), a.lp_lock_vault.as_ref()) else {
            return err!(BurnError::WrongPoolPolicy);
        };
        require_keys_eq!(ps.key(), pool, BurnError::WrongPoolPolicy);
        require_fixed_supply(&a.mint)?;
        let (view, locked_bps) = verify_pool_provenance(&ps.to_account_info(), &c.mint, &a.fee_vault.key(), lp, &lock.to_account_info(), None)?;
        // Re-check R3-2: the fallback pool is either (almost) fully locked, or THE pool of a LaunchLab-known AmmConfig.
        if locked_bps < FALLBACK_MIN_LOCKED_LP_BPS {
            let mut known = Vec::with_capacity(2);
            if c.ll_cp_config != Pubkey::default() {
                known.push(c.ll_cp_config);
            }
            if let Some(llp) = a.launchlab_platform.as_ref() {
                require!(c.ll_platform != Pubkey::default(), BurnError::InvalidLaunchLabAccount);
                known.push(launchlab_platform_cp_config(&llp.to_account_info(), &c.ll_platform)?);
            }
            let on_known = known.iter().any(|cfg| view.amm_config == *cfg && pool == pool_pda(cfg, &NATIVE_MINT, &c.mint));
            require!(on_known, BurnError::LpNotLocked);
        }
    }
    let c = &mut ctx.accounts.config;
    c.registration_policy = policy;
    c.cpmm_pool = pool;
    c.pool_verified = policy == POOL_POLICY_FIXED;
    clear_untradeable(c);
    clear_pending_policy(c);
    let config = c.key();
    emit_cpi!(RegistrationPolicyApplied { config, applied_by: ctx.accounts.caller.key(), policy, pool });
    Ok(())
}
