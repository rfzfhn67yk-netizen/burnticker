//! burn_receipts — event-indexed burns for the Receipts launchpad (first token $DEFICIT).
//!
//! The formula and the money live here; the data arrives as an attested reading; anyone can crank; nobody custodies the creator's
//! fees. See docs/burn-receipts/README.md for the architecture, the trust model and the audit checklist.
//!
//! Instruction set (there is deliberately NO withdraw / close / sweep instruction for the fee PDA or the vault):
//!   initialize_token       mint-signed, once per mint: rule, attesters, quorum; funds the fee PDA's reserve
//!   register_pool          permissionless, once: the CPMM pool whose creator is the fee PDA (buyback, policy 0)
//!   register_pair_pool     permissionless, once: policy 2 — the CPMM pool pair_curve's graduate created for this token (pair_curve
//!                          PDA, pair-vault creator, pinned cpConfigId, ≥ 90 % of the creation LP burned)
//!   check_pool_health / replace_pool   permissionless: record a dead pool; after 7 days of it, move to another fee-PDA pool
//!   claim_launchlab_creator_fee        permissionless: LaunchLab curve creator fee → the fee PDA's WSOL account (fee PDA signs)
//!   submit_reading         permissionless; valid only with a quorum of attester ed25519 signatures over the canonical message
//!                          (feed, period, value, source-URL hash, zkTLS proof locator)
//!   crank_buyback          permissionless: spend → swap on CPMM → burn all received → memo v2 (a paired coin that LOST the
//!                          period's pair result refuses: its fuel is forwarded instead)
//!   link_pair / submit_pair_result / forward_to_winner   LAUNCHPAD-PATH §40, winner takes the burn: pair two coins (pair_curve Pair
//!                          witness; or both initialize_token calls name each other), attest a period's winner (quorum of each
//!                          coin's attesters), move the loser's fuel for that period to the winner's fee PDA
//!   crank_vault            permissionless: burn from the vault (shortfall carried) → memo v1
//!   crank_no_units         permissionless: process a zero-unit reading that is next in line
//!   propose_attesters / cancel_attester_change / renounce_admin    admin only (48 h timelock on proposals)
//!   apply_attester_change  permissionless after the timelock (unpaired coins)
//!   apply_paired_attester_change  permissionless after the timelock, a paired coin: the partner's quorum co-signs the new set
//!   submit_rule_end        permissionless; a quorum of the coin's attesters ends its rule (resolved | void) — coins with an end sink
//!   forward_on_end         permissionless after a RESOLVED end: the remaining fuel (and later trickle) → the end sink's fee PDA
//!   initialize_platform    upgrade-authority-signed, once: the program-wide pre-audit burn-pool cap (sunsets automatically)
//!   propose_cap_raise / cancel_cap_raise / renounce_platform_authority    platform authority (48 h timelock; raise only)
//!   apply_cap_raise        permissionless after the timelock
//!   set_registration_policy / cancel_registration_policy   admin (48 h timelock): stranding recovery between policy 0 and a
//!                          fixed pool that passes the creator + LP checks; only while no pool works, and only until the cap sunset
//!   apply_registration_policy   permissionless after the timelock and within 14 days of the proposal; a fallback FIXED pool needs
//!                          ≥ 90 % of its LP burned/locked or must be the pool PDA of a LaunchLab-known AmmConfig
//!   veto_registration_policy    any current attester: kill a pending registration-policy proposal
//!   clear_cranker_allowlist     platform authority or any allowlisted key: return crank_buyback to permissionless (the allowlist
//!                          stops applying at the cap sunset or 90 days after initialize_platform)

pub mod attest;
pub mod constants;
pub mod cpmm;
pub mod error;
pub mod events;
pub mod guards;
pub mod instructions;
pub mod math;
pub mod memo;
pub mod pair_curve;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM");

#[program]
pub mod burn_receipts {
    use super::*;

    pub fn initialize_token(ctx: Context<InitializeToken>, args: InitializeTokenArgs) -> Result<()> {
        instructions::initialize_token::handle_initialize_token(ctx, args)
    }

    pub fn register_pool(ctx: Context<RegisterPool>) -> Result<()> {
        instructions::register_pool::handle_register_pool(ctx)
    }

    /// LAUNCHPAD-PATH §35: record the coin's permanent LP lock position (Fee Key held by the FEE_KEYS PDA). Permissionless, once.
    pub fn register_fee_key(ctx: Context<RegisterFeeKey>) -> Result<()> {
        instructions::lock_fees::handle_register_fee_key(ctx)
    }

    /// LAUNCHPAD-PATH §35: collect the locked LP's fees; SOL 80 % burn pool / 20 % operator treasury (compiled), coin side burned.
    /// Always collects everything accrued (lp-lock blind review L-3: no caller-chosen amount).
    pub fn claim_lock_fees(ctx: Context<ClaimLockFees>) -> Result<()> {
        instructions::lock_fees::handle_claim_lock_fees(ctx)
    }

    /// Registration policy 2 (2026-10-10): the CPMM pool pair_curve's `graduate` created for this token (src/pair_curve.rs).
    pub fn register_pair_pool(ctx: Context<RegisterPairPool>) -> Result<()> {
        instructions::register_pair_pool::handle_register_pair_pool(ctx)
    }

    /// LAUNCHPAD-PATH §40: pair the two coins of a pair_curve Pair (the Pair is the witness). Permissionless, idempotent.
    pub fn link_pair(ctx: Context<LinkPair>) -> Result<()> {
        instructions::pair::handle_link_pair(ctx)
    }

    /// LAUNCHPAD-PATH §40: one period's pair result (winner mint, or Pubkey::default() for a draw), a quorum of each coin's attesters.
    pub fn submit_pair_result(ctx: Context<SubmitPairResult>, record_date: u32, winner: Pubkey, source_url_hash: [u8; 32], proof_hash: [u8; 32]) -> Result<()> {
        instructions::pair::handle_submit_pair_result(ctx, record_date, winner, source_url_hash, proof_hash)
    }

    /// LAUNCHPAD-PATH §40: the loser's fuel for the period → the winner's fee PDA. Permissionless, idempotent.
    pub fn forward_to_winner(ctx: Context<ForwardToWinner>, record_date: u32) -> Result<()> {
        instructions::pair::handle_forward_to_winner(ctx, record_date)
    }

    /// pair-forward blind review M-2: undo a pairing on on-chain evidence that one coin can never be live. Permissionless.
    pub fn unlink_pair(ctx: Context<UnlinkPair>) -> Result<()> {
        instructions::pair::handle_unlink_pair(ctx)
    }

    pub fn check_pool_health(ctx: Context<CheckPoolHealth>) -> Result<()> {
        instructions::pool_health::handle_check_pool_health(ctx)
    }

    pub fn replace_pool(ctx: Context<ReplacePool>) -> Result<()> {
        instructions::pool_health::handle_replace_pool(ctx)
    }

    pub fn claim_launchlab_creator_fee(ctx: Context<ClaimLaunchlabCreatorFee>) -> Result<()> {
        instructions::claim_launchlab::handle_claim_launchlab_creator_fee(ctx)
    }

    pub fn submit_reading(ctx: Context<SubmitReading>, record_date: u32, value: u64, source_url_hash: [u8; 32], proof_hash: [u8; 32]) -> Result<()> {
        instructions::submit_reading::handle_submit_reading(ctx, record_date, value, source_url_hash, proof_hash)
    }

    pub fn crank_buyback(ctx: Context<CrankBuyback>, record_date: u32) -> Result<()> {
        instructions::crank_buyback::handle_crank_buyback(ctx, record_date)
    }

    pub fn crank_vault(ctx: Context<CrankVault>, record_date: u32) -> Result<()> {
        instructions::crank_vault::handle_crank_vault(ctx, record_date)
    }

    pub fn crank_no_units(ctx: Context<CrankNoUnits>, record_date: u32) -> Result<()> {
        instructions::crank_no_units::handle_crank_no_units(ctx, record_date)
    }

    pub fn propose_attesters(ctx: Context<AdminOnly>, attesters: Vec<AttesterEntry>, quorum: u8) -> Result<()> {
        instructions::admin::handle_propose_attesters(ctx, attesters, quorum)
    }

    pub fn cancel_attester_change(ctx: Context<AdminOnly>) -> Result<()> {
        instructions::admin::handle_cancel_attester_change(ctx)
    }

    pub fn renounce_admin(ctx: Context<AdminOnly>) -> Result<()> {
        instructions::admin::handle_renounce_admin(ctx)
    }

    pub fn apply_attester_change(ctx: Context<ApplyAttesterChange>) -> Result<()> {
        instructions::admin::handle_apply_attester_change(ctx)
    }

    pub fn apply_paired_attester_change(ctx: Context<ApplyPairedAttesterChange>) -> Result<()> {
        instructions::admin::handle_apply_paired_attester_change(ctx)
    }

    pub fn submit_rule_end(ctx: Context<SubmitRuleEnd>, record_date: u32, outcome: u8, source_url_hash: [u8; 32], proof_hash: [u8; 32]) -> Result<()> {
        instructions::end::handle_submit_rule_end(ctx, record_date, outcome, source_url_hash, proof_hash)
    }

    pub fn forward_on_end(ctx: Context<ForwardOnEnd>) -> Result<()> {
        instructions::end::handle_forward_on_end(ctx)
    }

    pub fn set_registration_policy(ctx: Context<RegistrationPolicyAdmin>, policy: u8, pool: Pubkey) -> Result<()> {
        instructions::admin::handle_set_registration_policy(ctx, policy, pool)
    }

    pub fn cancel_registration_policy(ctx: Context<RegistrationPolicyAdmin>) -> Result<()> {
        instructions::admin::handle_cancel_registration_policy(ctx)
    }

    pub fn apply_registration_policy(ctx: Context<ApplyRegistrationPolicy>) -> Result<()> {
        instructions::admin::handle_apply_registration_policy(ctx)
    }

    /// Re-check R3-2: any current attester vetoes (clears) a pending registration-policy proposal.
    pub fn veto_registration_policy(ctx: Context<VetoRegistrationPolicy>) -> Result<()> {
        instructions::admin::handle_veto_registration_policy(ctx)
    }

    pub fn clear_cranker_allowlist(ctx: Context<ClearCrankerAllowlist>) -> Result<()> {
        instructions::platform::handle_clear_cranker_allowlist(ctx)
    }

    pub fn initialize_platform(ctx: Context<InitializePlatform>, authority: Pubkey, burn_pool_cap_lamports: u64, cap_sunset_ts: i64, crankers: Vec<Pubkey>) -> Result<()> {
        instructions::platform::handle_initialize_platform(ctx, authority, burn_pool_cap_lamports, cap_sunset_ts, crankers)
    }

    pub fn propose_cap_raise(ctx: Context<PlatformAuthorityOnly>, new_cap_lamports: u64) -> Result<()> {
        instructions::platform::handle_propose_cap_raise(ctx, new_cap_lamports)
    }

    pub fn cancel_cap_raise(ctx: Context<PlatformAuthorityOnly>) -> Result<()> {
        instructions::platform::handle_cancel_cap_raise(ctx)
    }

    pub fn apply_cap_raise(ctx: Context<ApplyCapRaise>) -> Result<()> {
        instructions::platform::handle_apply_cap_raise(ctx)
    }

    pub fn renounce_platform_authority(ctx: Context<PlatformAuthorityOnly>) -> Result<()> {
        instructions::platform::handle_renounce_platform_authority(ctx)
    }
}
