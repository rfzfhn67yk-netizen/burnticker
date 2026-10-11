use anchor_lang::prelude::*;

use crate::constants::*;

/// The burn rule, fixed at init and never writable afterwards (no instruction takes a `&mut RuleParams`).
///
/// Field mapping to the keeper's rules.json ($DEFICIT, config/burnkeeper/deficit.rules.json):
///   unit_value            = rule.unitUsd × 10^value_decimals   ($1,000,000,000 → 100,000,000,000 cents)
///   max_abs_delta         = rule.maxAbsDeltaUsd × 10^value_decimals
///   fraction_per_unit_bps = buyback.fractionPerUnit × 10,000  (0.05 → 500)
///   reserve_lamports      = buyback.reserveSol in lamports    (0.02 → 20,000,000)
///   floor_lamports        = the floor in lamports (the keeper's floorUsd is priced off-chain; on chain the floor is SOL)
///   slippage_bps          = buyback.slippageBps
///   tokens_per_unit       = rule.burnPerUnitTokens × 10^decimals (vault mode)
///   vault_allocation      = vaultAllocation × 10^decimals (vault mode; 0 = uncapped)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct RuleParams {
    /// MODE_BUYBACK (0, primary) or MODE_VAULT (1).
    pub mode: u8,
    /// CARRY_CONSECUTIVE (0) or CARRY_NONE (1).
    pub carry_rule: u8,
    /// POOL_POLICY_CREATOR_IS_FEE_PDA (0), POOL_POLICY_FIXED (1) or POOL_POLICY_PAIR_CURVE (2). Buyback only.
    pub pool_policy: u8,
    /// Decimals of the attested value (2: the Treasury figure in cents).
    pub value_decimals: u8,
    /// Value units per burn unit (the brief's `unit_usd`, in the value's smallest unit).
    pub unit_value: u64,
    /// Plausibility bound on |now − prev|, value units.
    pub max_abs_delta: u64,
    /// Buyback: share of the pool spent per unit, compounding: spend = pool × (1 − (1 − f)^units).
    pub fraction_per_unit_bps: u16,
    /// Buyback: tolerance (≤ 300 bps) under the constant-product output quoted at BOTH the spot reserves and the TWAP price (after
    /// the pool's own fee); the swap must deliver at least the larger quote less this tolerance (review-2 F1).
    pub slippage_bps: u16,
    /// Buyback: maximum shortfall of the spot SOL price (in tokens) under the CPMM oracle's TWAP, 1–300 bps (mandatory).
    pub max_twap_deviation_bps: u16,
    /// Buyback: TWAP look-back window, seconds.
    pub twap_window_secs: u32,
    /// Buyback: a spend under this many lamports buys nothing (the pool keeps it). Must be > 0 (review-2 F7).
    pub floor_lamports: u64,
    /// Buyback: lamports the fee PDA always keeps (≥ its rent-exempt minimum).
    pub reserve_lamports: u64,
    /// Vault: raw tokens burned per unit.
    pub tokens_per_unit: u64,
    /// Vault: total raw tokens the rule may ever burn (0 = uncapped).
    pub vault_allocation: u64,
}

/// One attester: an ed25519 key plus an informational `kind` tag (ATTESTER_OPERATOR / ATTESTER_ZKTLS_RELAYER / ATTESTER_ORACLE). The
/// program verifies only signatures and the quorum; the tag says what stands behind the key (our keeper, a second operator, a relayer
/// that posts zkTLS-verified readings, an oracle network's signer).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace, Default)]
pub struct AttesterEntry {
    pub kind: u8,
    pub key: Pubkey,
}

impl AttesterEntry {
    pub fn operator(key: Pubkey) -> Self {
        AttesterEntry { kind: ATTESTER_OPERATOR, key }
    }
}

#[account]
#[derive(InitSpace)]
pub struct TokenConfig {
    pub version: u8,
    pub bump: u8,
    pub fee_bump: u8,
    pub has_baseline: bool,
    pub mint: Pubkey,
    /// Recorded for the public record; holds no power by itself.
    pub creator: Pubkey,
    /// May propose attester changes (48 h timelock) and renounce. Pubkey::default() once renounced.
    pub admin: Pubkey,
    pub rule: RuleParams,
    /// sha256 of the published rules file's exact bytes (the memo's `rules=sha256:<12>`).
    pub rules_sha256: [u8; 32],
    /// sha256 over the on-chain parameters (PARAMS_HASH_DOMAIN ‖ mint ‖ borsh(rule) ‖ feed_id ‖ memo_prefix ‖ memo_source ‖
    /// rules_sha256), so anyone can check the published file against what the program enforces.
    pub params_hash: [u8; 32],
    pub feed_id: [u8; MAX_FEED_ID_LEN],
    pub feed_id_len: u8,
    pub memo_prefix: [u8; MAX_MEMO_PREFIX_LEN],
    pub memo_prefix_len: u8,
    pub memo_source: [u8; MAX_MEMO_SOURCE_LEN],
    pub memo_source_len: u8,
    pub attesters: [AttesterEntry; MAX_ATTESTERS],
    pub attester_count: u8,
    pub quorum: u8,
    pub pending_attesters: [AttesterEntry; MAX_ATTESTERS],
    pub pending_count: u8,
    pub pending_quorum: u8,
    /// Unix time after which the pending change may be applied; 0 = nothing pending.
    pub pending_eta: i64,
    /// The Raydium CPMM pool the buyback trades on (default = not registered yet).
    pub cpmm_pool: Pubkey,
    pub last_record_date: u32,
    pub last_value: u64,
    /// Remainder carried into the next reading (always < unit_value).
    pub carry: u64,
    /// record_date of the last PROCESSED reading; readings are processed strictly in order.
    pub crank_cursor: u32,
    pub readings: u32,
    pub burns: u32,
    /// Raw tokens destroyed by this program.
    pub total_burned: u64,
    /// Lamports spent on buybacks.
    pub total_spent_lamports: u64,
    /// Vault mode: raw tokens owed but not yet burned (vault was short), carried forward.
    pub shortfall: u64,
    pub created_at: i64,
    /// Buyback: lamports the rule owed but the per-crank reserve cap (2 % of the pool's WSOL reserve) did not let it spend yet;
    /// added to the next crank's target (review H-1).
    pub carried_spend_lamports: u64,
    /// Unix time the registered pool was first observed untradeable in the current continuous spell (0 = tradeable / not observed);
    /// see check_pool_health.
    pub pool_untradeable_since: i64,
    /// Unix time of the latest untradeable observation (review-2 F6: a gap over 24 h restarts the spell).
    pub pool_untradeable_last_seen: i64,
    /// The pool passed the provenance checks of register_pool / replace_pool (policy 0: LaunchLab's migration pool; both policies:
    /// fee-PDA creator and ≥ 90 % of the LP burned or locked). crank_buyback requires it (review-2 F5/F14).
    pub pool_verified: bool,
    /// Genesis hash of the cluster this program build is for (CLUSTER_GENESIS_HASH), bound into every signed message (review-2 F12).
    pub cluster_genesis: Pubkey,
    /// The registration policy in force (POOL_POLICY_*): starts as `rule.pool_policy`; only `apply_registration_policy` (48 h
    /// timelock, stranding recovery, sunsets with the cap) changes it (review-3 M-3).
    pub registration_policy: u8,
    /// Review-3 M-3: the LaunchLab platform pinned at initialize_token (policy 0), its cpConfigId and LP lock+burn scales (10⁻⁶).
    pub ll_platform: Pubkey,
    pub ll_cp_config: Pubkey,
    pub ll_lock_scale_ppm: u64,
    /// Review-3 L-3: the first of the two observations (≥ 1 h apart) that start an untradeable spell; 0 = none pending.
    pub pool_untradeable_candidate_at: i64,
    /// Review-3 L-2: when each attester slot's key joined the set (seniority for "kept" keys).
    pub attester_added_at: [i64; MAX_ATTESTERS],
    /// Review-3 M-3: a pending registration-policy switch (POOL_POLICY_*, the fixed pool for policy 1), applicable after the eta.
    pub pending_policy: u8,
    pub pending_policy_pool: Pubkey,
    /// 0 = nothing pending.
    pub pending_policy_eta: i64,
    /// LAUNCHPAD-PATH §40: PAIR_STATE_NONE / _PROVISIONAL / _PAIRED (the partner is in PairLink ["pair_link", mint]). Taken from the
    /// former reserved bytes, so configs created before §40 read as NONE.
    pub pair_state: u8,
    pub reserved: [u8; 22],
}

impl TokenConfig {
    pub fn feed_id_str(&self) -> &str {
        core::str::from_utf8(&self.feed_id[..self.feed_id_len as usize]).unwrap_or("")
    }
    pub fn memo_prefix_str(&self) -> &str {
        core::str::from_utf8(&self.memo_prefix[..self.memo_prefix_len as usize]).unwrap_or("")
    }
    pub fn memo_source_str(&self) -> &str {
        core::str::from_utf8(&self.memo_source[..self.memo_source_len as usize]).unwrap_or("")
    }
    pub fn attester_slice(&self) -> &[AttesterEntry] {
        &self.attesters[..self.attester_count as usize]
    }
    pub fn admin_active(&self) -> bool {
        self.admin != Pubkey::default()
    }
}

/// LAUNCHPAD-PATH §35: the coin's permanent LP lock (Raydium's CPMM lock program) and its Fee Key, held by the FEE_KEYS PDA.
/// Created once by register_fee_key; claim_lock_fees reads it and keeps the running totals. ["fee_key", mint].
#[account]
#[derive(InitSpace)]
pub struct FeeKeyRecord {
    pub version: u8,
    pub bump: u8,
    pub mint: Pubkey,
    /// The position's CPMM pool (policy 0: the token's LaunchLab migration pool, recorded before register_pool; policies 1/2: the
    /// verified TokenConfig.cpmm_pool). Immutable — claim_lock_fees runs against it even after a pool replacement (L-1).
    pub pool: Pubkey,
    pub lp_mint: Pubkey,
    /// The Fee Key NFT mint and the FEE_KEYS PDA's account holding it.
    pub fee_nft_mint: Pubkey,
    pub fee_nft_account: Pubkey,
    /// The lock program's LockedCpLiquidityState ["locked_liquidity", fee_nft_mint].
    pub locked_liquidity: Pubkey,
    pub locked_lp_at_registration: u64,
    pub registered_at: i64,
    pub claims: u32,
    pub total_wsol_claimed: u64,
    pub total_to_burn_pool: u64,
    pub total_to_operator: u64,
    pub total_tokens_burned: u64,
    pub last_claim_at: i64,
    /// Operator share collected but not yet delivered (the treasury could not receive it yet), held as lamports of this account.
    pub operator_pending: u64,
    pub reserved: [u8; 56],
}

impl FeeKeyRecord {
    pub fn operator_pending(&self) -> u64 {
        self.operator_pending
    }
    pub fn set_operator_pending(&mut self, v: u64) {
        self.operator_pending = v;
    }
}

/// The program-wide PlatformConfig (["platform"]): the temporary pre-audit burn-pool cap and its authority (instructions/platform.rs).
#[account]
#[derive(InitSpace)]
pub struct PlatformConfig {
    pub version: u8,
    pub bump: u8,
    /// May propose cap RAISES (48 h timelock) and renounce. Pubkey::default() once renounced. Intended: the Squads 2-of-3 vault.
    pub authority: Pubkey,
    /// While now < cap_sunset_ts, a token's buyback spend is computed on min(pool, cap).
    pub burn_pool_cap_lamports: u64,
    /// After this unix time the cap no longer applies. Fixed at init; never extendable.
    pub cap_sunset_ts: i64,
    pub pending_cap_lamports: u64,
    /// 0 = nothing pending.
    pub pending_cap_eta: i64,
    pub created_at: i64,
    /// Review-3 L-4: while the cap is in force, only these keys may crank_buyback (empty = permissionless). Set at initialize_platform,
    /// can only be CLEARED afterwards (clear_cranker_allowlist — by the platform authority or any allowlisted key, re-check R3-4), and
    /// stops applying at the cap's sunset or 90 days after initialize_platform, whichever is first.
    pub crankers: [Pubkey; MAX_CRANKERS],
    pub cranker_count: u8,
    pub reserved: [u8; 64],
}

impl PlatformConfig {
    /// The cap in force at `now`, or None once sunset.
    pub fn active_cap(&self, now: i64) -> Option<u64> {
        if now < self.cap_sunset_ts {
            Some(self.burn_pool_cap_lamports)
        } else {
            None
        }
    }

    /// Review-3 L-4 + re-check R3-4: the cranker allowlist applies while the cap is in force AND for at most 90 days after
    /// initialize_platform; empty (permissionless) otherwise.
    pub fn crankers_in_force(&self, now: i64) -> &[Pubkey] {
        let fresh = now < self.created_at.saturating_add(crate::constants::CRANKER_ALLOWLIST_MAX_SECS);
        if self.active_cap(now).is_some() && fresh {
            &self.crankers[..self.cranker_count as usize]
        } else {
            &[]
        }
    }
}

/// The cap in force when no PlatformConfig exists (review M-1): the default 25 SOL until DEFAULT_CAP_SUNSET_TS.
pub fn default_active_cap(now: i64) -> Option<u64> {
    if now < DEFAULT_CAP_SUNSET_TS {
        Some(DEFAULT_BURN_POOL_CAP_LAMPORTS)
    } else {
        None
    }
}

#[account]
#[derive(InitSpace)]
pub struct Reading {
    pub version: u8,
    pub bump: u8,
    /// KIND_BASELINE / KIND_INCREASE / KIND_DOWN / KIND_FLAT / KIND_RESET.
    pub kind: u8,
    pub processed: bool,
    pub config: Pubkey,
    pub record_date: u32,
    /// record_date of the previous reading (0 for the baseline).
    pub prev_date: u32,
    pub value: u64,
    pub prev_value: u64,
    pub delta: i64,
    pub carry_in: u64,
    pub carry_out: u64,
    pub units: u64,
    /// Bit i set = attester slot i signed this exact (feed, record_date, value, source_url_hash, proof_hash).
    pub signers_mask: u8,
    /// sha256 of the exact source URL the attesters read (e.g. the Treasury API query for this record_date). Signed.
    pub source_url_hash: [u8; 32],
    /// Optional locator of a zkTLS proof of that response (sha256 of the proof file / its content address); zero if none. Signed;
    /// NOT verified on chain — an off-chain verifier uses it to find and check the proof.
    pub proof_hash: [u8; 32],
    pub submitted_at: i64,
    // ----- crank result -----
    pub outcome: u8,
    pub processed_at: i64,
    /// Buyback: the pool the rule was applied to (lamports) — min(spendable pool, platform cap) while the cap is in force.
    pub pool_lamports: u64,
    /// Buyback: lamports swapped.
    pub spent_lamports: u64,
    /// Buyback: raw tokens the swap delivered.
    pub got: u64,
    /// Raw tokens burned (buyback: got + any creator-fee tokens already in the fee PDA's token account).
    pub burned: u64,
    /// Vault: raw tokens owed this day (planned + shortfall carried in, capped by the allocation).
    pub owed: u64,
    /// Vault: raw tokens owed and not burned, carried out.
    pub shortfall: u64,
    /// Buyback: the whole spendable pool before the crank (SOL above the reserve + WSOL held); > pool_lamports when the cap bound.
    pub pool_actual_lamports: u64,
    /// Buyback: the rule's spend for this reading alone (on pool_lamports).
    pub rule_spend_lamports: u64,
    /// Buyback: carried spend owed from earlier capped cranks, added to this one's target.
    pub carried_in_lamports: u64,
    /// Buyback: target − spent, carried to the next crank (the 2 % reserve cap or the platform basis bound).
    pub carried_out_lamports: u64,
    /// Buyback: the CPMM pool this reading was processed against (default when nothing was swapped against a pool), so the memo's
    /// `swap=` can be rebuilt after a pool replacement (review-2 F9).
    pub pool: Pubkey,
}

/// LAUNCHPAD-PATH §40 — the coin's partner in a winner-takes-the-burn pair. ["pair_link", mint]. Written by initialize_token (the
/// creator names the partner mint; `paired` turns true when the partner's initialize_token names this mint back within
/// PAIRING_WINDOW_SECS) or by link_pair (a pair_curve Pair holds both mints). `pair_mint` never changes; once `paired`, it stays.
#[account]
#[derive(InitSpace)]
pub struct PairLink {
    pub version: u8,
    pub bump: u8,
    pub mint: Pubkey,
    pub pair_mint: Pubkey,
    pub paired: bool,
    /// PAIR_WITNESS_INITIALIZE / PAIR_WITNESS_PAIR_CURVE.
    pub witness: u8,
    pub created_at: i64,
    /// Provisional links only: the partner must answer by this time (0 for links written already paired).
    pub pairing_deadline: i64,
    pub paired_at: i64,
    /// pair-forward blind review M-1: the coin's attester set when the link was written (pair::attester_set_hash). A result in which
    /// this coin LOSES is valid with its own quorum alone only while its set still hashes to this; after a rotation the partner's quorum
    /// must co-sign. Zero for links written before the r2 build (then the partner always co-signs).
    pub attester_set_hash: [u8; 32],
}

/// LAUNCHPAD-PATH §40 — one period's result of a pair, attested by a quorum of EACH coin's attesters over
/// `BURNRECEIPTS-PAIR-v1|<genesis>|<program>|<mint_lo>|<mint_hi>|<YYYY-MM-DD>|winner=<mint|draw>|src=<hex>|proof=<hex>`.
/// ["pair_result", mint_lo, mint_hi, record_date LE]. Append-only like readings; forward_to_winner adds the forward record.
#[account]
#[derive(InitSpace)]
pub struct PairResult {
    pub version: u8,
    pub bump: u8,
    pub mint_lo: Pubkey,
    pub mint_hi: Pubkey,
    /// The period: the record_date of both coins' readings it decides.
    pub record_date: u32,
    /// The winning mint; Pubkey::default() = a draw (forwards nothing; each coin burns its own fuel).
    pub winner: Pubkey,
    pub signers_mask_lo: u8,
    pub signers_mask_hi: u8,
    pub source_url_hash: [u8; 32],
    pub proof_hash: [u8; 32],
    pub submitted_at: i64,
    // ----- forward_to_winner -----
    pub forwarded: bool,
    pub forwarded_lamports: u64,
    pub forwarded_at: i64,
    pub reserved: [u8; 32],
}

impl PairResult {
    pub fn is_draw(&self) -> bool {
        self.winner == Pubkey::default()
    }
    /// The coin's view: PAIR_RESULT_WON / _LOST / _DRAW, or PAIR_RESULT_NONE if `mint` is not in the pair.
    pub fn result_for(&self, mint: &Pubkey) -> u8 {
        if *mint != self.mint_lo && *mint != self.mint_hi {
            PAIR_RESULT_NONE
        } else if self.is_draw() {
            PAIR_RESULT_DRAW
        } else if self.winner == *mint {
            PAIR_RESULT_WON
        } else {
            PAIR_RESULT_LOST
        }
    }
    pub fn other(&self, mint: &Pubkey) -> Pubkey {
        if *mint == self.mint_lo { self.mint_hi } else { self.mint_lo }
    }
}

/// (lo, hi) in byte order — the order of the PairResult seeds.
pub fn pair_order(a: &Pubkey, b: &Pubkey) -> (Pubkey, Pubkey) {
    if a.to_bytes() < b.to_bytes() { (*a, *b) } else { (*b, *a) }
}

pub fn pair_result_address(a: &Pubkey, b: &Pubkey, record_date: u32) -> (Pubkey, u8) {
    let (lo, hi) = pair_order(a, b);
    Pubkey::find_program_address(&[PAIR_RESULT_SEED, lo.as_ref(), hi.as_ref(), &record_date.to_le_bytes()], &crate::ID)
}

pub fn pair_link_address(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PAIR_LINK_SEED, mint.as_ref()], &crate::ID)
}
