//! Every state change emits one of these through `emit_cpi!` (a self-CPI whose instruction data is the event — inner-instruction
//! data is kept by every RPC and is not subject to log truncation), so an indexer can rebuild the full history from the chain alone:
//! the config's creation and rule, the pool registration, every reading and its votes, every processed reading (burn, shortfall,
//! below-floor, no-units), every attester proposal / cancellation / application, and the admin's renouncement. The program has no
//! pause, so there is no pause event.

use anchor_lang::prelude::*;

use crate::state::{AttesterEntry, RuleParams};

#[event]
pub struct TokenInitialized {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub fee_vault: Pubkey,
    pub rule: RuleParams,
    pub rules_sha256: [u8; 32],
    pub params_hash: [u8; 32],
    pub feed_id: String,
    pub memo_prefix: String,
    pub memo_source: String,
    pub attesters: Vec<AttesterEntry>,
    pub quorum: u8,
    pub cpmm_pool: Pubkey,
    /// The config authority (review-2 F11).
    pub admin: Pubkey,
    /// sha256(GOVERNANCE_HASH_DOMAIN ‖ admin ‖ quorum ‖ (kind ‖ key) per attester) — also emitted after every governance change.
    pub governance_hash: [u8; 32],
    /// The cluster genesis hash bound into every signed message (review-2 F12).
    pub cluster_genesis: Pubkey,
    /// Review-3 M-3: the LaunchLab platform and its cpConfigId pinned for registration (default under policy 1 / vault mode).
    pub ll_platform: Pubkey,
    pub ll_cp_config: Pubkey,
}

#[event]
pub struct PoolRegistered {
    pub config: Pubkey,
    pub pool: Pubkey,
    pub registrar: Pubkey,
}

#[event]
pub struct ReadingSubmitted {
    pub config: Pubkey,
    pub record_date: u32,
    pub prev_date: u32,
    pub value: u64,
    pub prev_value: u64,
    pub delta: i64,
    pub carry_in: u64,
    pub carry_out: u64,
    pub units: u64,
    pub kind: u8,
    pub signers_mask: u8,
    pub source_url_hash: [u8; 32],
    pub proof_hash: [u8; 32],
    pub submitter: Pubkey,
}

#[event]
pub struct ReadingProcessed {
    pub config: Pubkey,
    pub record_date: u32,
    pub units: u64,
    pub outcome: u8,
    pub pool_lamports: u64,
    pub spent_lamports: u64,
    pub got: u64,
    pub burned: u64,
    pub owed: u64,
    pub shortfall: u64,
    pub cranker: Pubkey,
}

#[event]
pub struct AttesterChangeProposed {
    pub config: Pubkey,
    pub proposed_by: Pubkey,
    pub attesters: Vec<AttesterEntry>,
    pub added: Vec<AttesterEntry>,
    pub removed: Vec<AttesterEntry>,
    pub quorum: u8,
    pub eta: i64,
}

#[event]
pub struct AttesterChangeCancelled {
    pub config: Pubkey,
    pub cancelled_by: Pubkey,
}

#[event]
pub struct AttesterChangeApplied {
    pub config: Pubkey,
    pub applied_by: Pubkey,
    pub attesters: Vec<AttesterEntry>,
    pub quorum: u8,
    pub governance_hash: [u8; 32],
}

#[event]
pub struct AdminRenounced {
    pub config: Pubkey,
    pub former_admin: Pubkey,
    pub governance_hash: [u8; 32],
}

#[event]
pub struct PlatformInitialized {
    pub platform: Pubkey,
    pub authority: Pubkey,
    pub burn_pool_cap_lamports: u64,
    pub cap_sunset_ts: i64,
    pub initialized_by: Pubkey,
    /// Review-3 L-4: the cranker allowlist (empty = permissionless), in force only while the cap is.
    pub crankers: Vec<Pubkey>,
}

#[event]
pub struct CapRaiseProposed {
    pub platform: Pubkey,
    pub proposed_by: Pubkey,
    pub current_cap_lamports: u64,
    pub new_cap_lamports: u64,
    pub eta: i64,
}

#[event]
pub struct CapRaiseCancelled {
    pub platform: Pubkey,
    pub cancelled_by: Pubkey,
}

#[event]
pub struct CapRaised {
    pub platform: Pubkey,
    pub applied_by: Pubkey,
    pub old_cap_lamports: u64,
    pub new_cap_lamports: u64,
}

#[event]
pub struct PlatformAuthorityRenounced {
    pub platform: Pubkey,
    pub former_authority: Pubkey,
}

/// Emitted by crank_buyback whenever the platform cap made the rule spend on less than the whole pool.
#[event]
pub struct BurnPoolCapBound {
    pub config: Pubkey,
    pub record_date: u32,
    pub pool_actual_lamports: u64,
    pub cap_lamports: u64,
    pub spent_lamports: u64,
}

/// A reading outside the plausibility bound (review M-2): accepted as a RESET — 0 units, carry reset, new baseline.
#[event]
pub struct ReadingReset {
    pub config: Pubkey,
    pub record_date: u32,
    pub prev_value: u64,
    pub value: u64,
    pub delta: i64,
    pub max_abs_delta: u64,
}

/// crank_buyback spent less than its target — the 2 % reserve cap and/or the platform basis bound bound; the rest is carried.
#[event]
pub struct SpendCapBound {
    pub config: Pubkey,
    pub record_date: u32,
    pub target_lamports: u64,
    pub spent_lamports: u64,
    pub reserve_cap_lamports: u64,
    pub carried_out_lamports: u64,
}

#[event]
pub struct LaunchLabCreatorFeeClaimed {
    pub config: Pubkey,
    pub claimed_lamports: u64,
    pub caller: Pubkey,
}

#[event]
pub struct PoolUntradeableFlagged {
    pub config: Pubkey,
    pub pool: Pubkey,
    /// Start of the current continuous spell.
    pub since: i64,
    /// This observation (review-2 F6: one is needed at least every 24 h or the spell restarts).
    pub observed_at: i64,
    /// True when this observation started a new spell (the second of two observations ≥ 1 h apart, or after a gap over 24 h).
    pub restarted: bool,
    pub reason: u8,
    /// Review-3 L-3: the pending first observation while no spell runs yet (`since` is then 0); 0 once the spell runs.
    pub candidate_at: i64,
}

#[event]
pub struct PoolUntradeableCleared {
    pub config: Pubkey,
    pub pool: Pubkey,
}

#[event]
pub struct PoolReplaced {
    pub config: Pubkey,
    pub old_pool: Pubkey,
    pub new_pool: Pubkey,
    pub untradeable_since: i64,
    pub caller: Pubkey,
}

/// Review-2 F15: a buyback crank that spent nothing but carries spend to the next crank (reason: 0 below floor, 1 reserve cap,
/// 2 pool untradeable for 30 days).
#[event]
pub struct SpendCarried {
    pub config: Pubkey,
    pub record_date: u32,
    pub target_lamports: u64,
    pub carried_in_lamports: u64,
    pub carried_out_lamports: u64,
    pub reason: u8,
}

/// Review-2 F7: the registered pool had been continuously untradeable for QUEUE_UNBLOCK_SECS, so this reading was processed
/// below-floor with its target carried instead of blocking the queue.
#[event]
pub struct BuybackQueueUnblocked {
    pub config: Pubkey,
    pub record_date: u32,
    pub untradeable_since: i64,
    pub carried_out_lamports: u64,
}

/// Review-3 L-4.
#[event]
pub struct CrankerAllowlistCleared {
    pub platform: Pubkey,
    pub cleared_by: Pubkey,
}

/// Review-3 M-3: the 48 h timelocked stranding-recovery switch of the registration policy.
#[event]
pub struct RegistrationPolicyProposed {
    pub config: Pubkey,
    pub proposed_by: Pubkey,
    pub policy: u8,
    pub pool: Pubkey,
    pub eta: i64,
    /// Re-check R3-2: the proposal can be applied in [eta, expires_at).
    pub expires_at: i64,
}

#[event]
pub struct RegistrationPolicyCancelled {
    pub config: Pubkey,
    pub cancelled_by: Pubkey,
    /// Re-check R3-2: true when a current attester vetoed it (veto_registration_policy), false for the admin (cancel/overwrite/renounce).
    pub vetoed: bool,
}

#[event]
pub struct RegistrationPolicyApplied {
    pub config: Pubkey,
    pub applied_by: Pubkey,
    pub policy: u8,
    pub pool: Pubkey,
}

/// register_fee_key: the coin's permanent LP lock and its Fee Key, now held by the FEE_KEYS PDA (LAUNCHPAD-PATH §35).
#[event]
pub struct FeeKeyRegistered {
    pub mint: Pubkey,
    pub pool: Pubkey,
    pub fee_nft_mint: Pubkey,
    pub fee_nft_account: Pubkey,
    pub locked_liquidity: Pubkey,
    pub locked_lp: u64,
    pub registrar: Pubkey,
}

/// claim_lock_fees: what the lock paid out and where it went. to_burn_pool + to_operator = wsol_claimed; tokens_burned = the coin side.
#[event]
pub struct LockFeesClaimed {
    pub mint: Pubkey,
    pub pool: Pubkey,
    pub fee_nft_mint: Pubkey,
    pub cranker: Pubkey,
    pub wsol_claimed: u64,
    pub to_burn_pool: u64,
    pub to_operator: u64,
    pub tokens_burned: u64,
    /// Operator share delivered to the treasury by this claim (this claim's and any earlier pending share), and what still waits
    /// in the FeeKeyRecord because the treasury could not receive it yet (below its rent-exempt minimum).
    pub operator_paid: u64,
    pub operator_pending: u64,
}

/// LAUNCHPAD-PATH §40: a coin's PairLink was written (provisional: waiting for the partner; paired: both name each other).
#[event]
pub struct PairLinked {
    pub mint: Pubkey,
    pub pair_mint: Pubkey,
    pub paired: bool,
    pub witness: u8,
    pub pairing_deadline: i64,
}

/// LAUNCHPAD-PATH §40: one period's pair result (winner = Pubkey::default() for a draw).
#[event]
pub struct PairResultSubmitted {
    pub mint_lo: Pubkey,
    pub mint_hi: Pubkey,
    pub record_date: u32,
    pub winner: Pubkey,
    pub signers_mask_lo: u8,
    pub signers_mask_hi: u8,
    pub source_url_hash: [u8; 32],
    pub proof_hash: [u8; 32],
    pub submitter: Pubkey,
}

/// LAUNCHPAD-PATH §40: the loser's fuel for a period moved to the winner's fee PDA (lamports = sol_lamports + wsol_lamports).
#[event]
pub struct ForwardedToWinner {
    pub loser_mint: Pubkey,
    pub winner_mint: Pubkey,
    pub record_date: u32,
    pub units: u64,
    /// The loser's pool basis (min(spendable, cap)) the rule was applied to.
    pub pool_lamports: u64,
    pub lamports: u64,
    pub sol_lamports: u64,
    pub wsol_lamports: u64,
    pub cranker: Pubkey,
}

/// LAUNCHPAD-PATH §40: a paired coin's crank ran without a pair result for the period, PAIR_RESULT_GRACE_SECS after the reading.
#[event]
pub struct PairResultMissing {
    pub mint: Pubkey,
    pub record_date: u32,
}

/// pair-forward blind review H-1(c): a paired coin LOST the period, no forward landed within PAIR_RESULT_GRACE_SECS of its reading,
/// and its crank burned its own fuel as an unpaired coin would.
#[event]
pub struct PairForwardMissing {
    pub mint: Pubkey,
    pub record_date: u32,
}

/// pair-forward blind review M-2: the pairing was undone on on-chain evidence (UNLINK_* reason); both coins are plain coins again.
#[event]
pub struct PairUnlinked {
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub reason: u8,
    pub cranker: Pubkey,
}

/// LAUNCHPAD-PATH §45: initialize_token pinned the coin's end sink.
#[event]
pub struct EndSinkPinned {
    pub mint: Pubkey,
    pub sink_kind: u8,
    pub sink_mint: Pubkey,
    pub min_forward_lamports: u64,
}

/// LAUNCHPAD-PATH §45: the coin's rule ended (outcome END_STATE_RESOLVED or END_STATE_VOID), signed by its attester quorum.
#[event]
pub struct RuleEnded {
    pub mint: Pubkey,
    pub record_date: u32,
    pub outcome: u8,
    pub signers_mask: u8,
    pub source_url_hash: [u8; 32],
    pub proof_hash: [u8; 32],
    pub submitter: Pubkey,
}

/// LAUNCHPAD-PATH §45: a resolved coin's fuel moved to its end sink's fee PDA (or the flagship's when the sink was not live).
#[event]
pub struct ForwardedOnEnd {
    pub mint: Pubkey,
    /// Where it went.
    pub to_mint: Pubkey,
    /// The sink the coin's EndSink named for this end (the flagship for kind 0, or for a pair partner that did not win the final period).
    pub intended_mint: Pubkey,
    pub sink_kind: u8,
    pub lamports: u64,
    pub sol_lamports: u64,
    pub wsol_lamports: u64,
    pub cranker: Pubkey,
}
