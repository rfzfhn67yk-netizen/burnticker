use anchor_lang::prelude::*;

/// PDA seeds. Every PDA is keyed by the token's mint (one TokenConfig per mint, ever).
pub const CONFIG_SEED: &[u8] = b"config";
/// The fee PDA: a system-owned account (no data) that receives the token's creator fees in SOL. Its ATAs (WSOL and the token) are
/// the buyback's working accounts. Nobody can sign for it except this program, and this program only signs for it inside
/// `crank_buyback` (swap input + burn) — there is no withdraw path.
pub const FEE_SEED: &[u8] = b"fee";
pub const READING_SEED: &[u8] = b"reading";
/// The one PlatformConfig of the program.
pub const PLATFORM_SEED: &[u8] = b"platform";

/// The owner's pre-audit burn-pool cap default (25 SOL), raised only through CAP_TIMELOCK_SECS, sunset at most a year out.
pub const DEFAULT_BURN_POOL_CAP_LAMPORTS: u64 = 25_000_000_000;
/// Review-2 F8: the initial cap is at least 1 SOL (a mis-click guard: a 1-lamport cap would stall every burn until the sunset).
/// Review-3 I-2: initialize_platform now requires the cap to EQUAL the default (it can only be raised afterwards), so this floor is
/// implied; kept for the client's constants.
pub const MIN_BURN_POOL_CAP_LAMPORTS: u64 = 1_000_000_000;
/// Review-3 L-4: at most this many keys in the PlatformConfig's cranker allowlist (enforced only while the pre-audit cap is in force).
pub const MAX_CRANKERS: usize = 3;
/// Re-check R3-4: the cranker allowlist stops applying this long after initialize_platform even while the cap is still in force, so
/// lost allowlisted keys plus a renounced platform authority can stall cranking for at most 90 days (not until the sunset).
pub const CRANKER_ALLOWLIST_MAX_SECS: i64 = 90 * 24 * 60 * 60;
pub const CAP_TIMELOCK_SECS: i64 = 48 * 60 * 60;
pub const MAX_CAP_SUNSET_SECS: i64 = 365 * 24 * 60 * 60;
/// When no PlatformConfig exists (review M-1), crank_buyback applies the default cap until this hard-coded sunset
/// (2027-10-01T00:00:00Z) — so a lost or finalised upgrade authority can never wedge buybacks.
pub const DEFAULT_CAP_SUNSET_TS: i64 = 1_822_348_800;

/// Buyback swap safety (review H-1/L-7, review-2 F1): the TWAP guard is mandatory, at most 3 % deviation over a 600–1,200 s window;
/// the swap's minimum output is the larger of the spot-reserve quote and the TWAP-price quote, both less the pool fee and
/// `slippage_bps` (≤ 3 %); one crank may spend at most 2 % of the pool's WSOL reserve (price impact under ~4 %), the rest is carried.
pub const MAX_TWAP_DEVIATION_BPS: u16 = 300;
pub const MAX_SLIPPAGE_BPS: u16 = 300;
/// The oracle read is conservative by up to 14 s of its window (cpmm::effective_obs_time: the TWAP can read HIGH by ≤ 14/window,
/// never low), so in a quiet pool a flat price sits up to 14/window under the TWAP. Both tolerances must cover 15 s of the window —
/// max_twap_deviation_bps × window ≥ 150,000 and slippage_bps × window ≥ 150,000 (≥ 250 bps at 600 s, ≥ 125 bps at 1,200 s) — or a
/// quiet pool could never be cranked.
pub const TWAP_BUCKET_TOLERANCE_BPS_SECS: u32 = 15 * 10_000;
pub const MIN_TWAP_WINDOW_SECS: u32 = 600;
pub const MAX_TWAP_WINDOW_SECS: u32 = 1_200;
pub const MAX_SPEND_RESERVE_BPS: u64 = 200;

/// Pool replacement (review M-4): the registered pool must have been observed untradeable continuously for 7 days.
pub const POOL_REPLACEMENT_DELAY_SECS: i64 = 7 * 24 * 60 * 60;
/// Review-2 F6: "continuously" = consecutive untradeable observations (check_pool_health, replace_pool, a blocked crank) never more
/// than 24 h apart; a longer gap restarts the clock at the next observation.
pub const UNTRADEABLE_MAX_GAP_SECS: i64 = 24 * 60 * 60;
/// Review-3 L-3: a spell starts only after two untradeable observations at least 1 h (and at most 24 h) apart; the spell is dated
/// from the first of them.
pub const UNTRADEABLE_CONFIRM_SECS: i64 = 60 * 60;
/// Review-2 F7: once the registered pool has been continuously untradeable this long, crank_buyback stops waiting for it: the reading
/// is processed as below-floor and its whole target is carried (the queue advances; nothing is spent).
pub const QUEUE_UNBLOCK_SECS: i64 = 30 * 24 * 60 * 60;
/// "Untradeable" (conservative): swaps disabled by the pool's status, the pool account gone / not CPMM's, or its WSOL reserve
/// (net of owed fees) under 0.01 SOL.
pub const UNTRADEABLE_WSOL_RESERVE_LAMPORTS: u64 = 10_000_000;

/// Domain tag of the canonical attestation message (v3, attest.rs):
/// `BURNRECEIPTS-v3|<cluster genesis>|<program>|<mint>|<feed_id>|prev=<date|none>|<YYYY-MM-DD>|<value>|src=<hex>|proof=<hex>`.
pub const ATTESTATION_DOMAIN: &str = "BURNRECEIPTS-v3";
/// Review-2 F12: the genesis hash of the cluster this BUILD is for, bound into every signed message (and stored on each config), so
/// an attestation made for a devnet rehearsal can never be replayed on mainnet even if a program id and mint key were reused. The
/// default build is the mainnet build (its Raydium ids are mainnet's); the `devnet` feature selects devnet's genesis.
/// Review-3 I-1: the `localnet` feature (local-validator rehearsals) binds its own tag — sha256("BURNRECEIPTS-LOCALNET-GENESIS") —
/// so a localnet rehearsal that reused a real program id, mint key and data key cannot produce a mainnet-valid signature.
#[cfg(not(any(feature = "devnet", feature = "localnet")))]
pub const CLUSTER_GENESIS_HASH: Pubkey = pubkey!("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
#[cfg(feature = "devnet")]
pub const CLUSTER_GENESIS_HASH: Pubkey = pubkey!("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
#[cfg(all(feature = "localnet", not(feature = "devnet")))]
pub const CLUSTER_GENESIS_HASH: Pubkey = pubkey!("38EeoTLdVHgiexj97JrnuEYvG7zV7nSFVdUeMJxUDdLt");
/// Domain tag of the governance hash (admin ‖ quorum ‖ attesters), emitted with every governance event (review-2 F11).
pub const GOVERNANCE_HASH_DOMAIN: &[u8] = b"BURNRECEIPTS-GOVERNANCE-v1";
/// Domain tag of the on-chain parameter hash (emitted at init, stored on the config).
pub const PARAMS_HASH_DOMAIN: &[u8] = b"BURNRECEIPTS-PARAMS-v1";

pub const MAX_ATTESTERS: usize = 5;
/// Review-2 F4: the largest quorum whose shared-message ed25519 instruction still fits a LEGACY transaction (q3 ≈ 1,190 of 1,232
/// bytes with the v3 message); quorum 4–5 could never post a reading in a legacy transaction and the quorum can never be lowered.
pub const MAX_QUORUM: u8 = 3;
/// Review-3 L-2: a key counts as "kept" by a proposal that ADDS keys only once it has been in the set this long, so two proposals in
/// a row cannot hand the readings to the admin's keys in 96 h (the bound becomes 48 h + 7 days + 48 h, all public).
pub const ATTESTER_SENIORITY_SECS: i64 = 7 * 24 * 60 * 60;
pub const MAX_FEED_ID_LEN: usize = 32;
pub const MAX_MEMO_PREFIX_LEN: usize = 12;
pub const MAX_MEMO_SOURCE_LEN: usize = 64;
/// The spec's memo ceiling (a real memo is ~250 bytes).
pub const MEMO_MAX_BYTES: usize = 566;

/// Attester-set changes wait this long after being proposed (48 h), publicly, before anyone can apply them.
pub const ATTESTER_TIMELOCK_SECS: i64 = 48 * 60 * 60;
/// Re-check R3-2: a pending registration-policy proposal can be applied only until this long after it was PROPOSED (14 days); after
/// that it is dead and the admin has to propose again (a fresh, public 48 h).
pub const POLICY_PROPOSAL_TTL_SECS: i64 = 14 * 24 * 60 * 60;

/// Basis-point and CPMM fee denominators.
pub const BPS_DENOMINATOR: u128 = 10_000;
pub const CPMM_FEE_DENOMINATOR: u128 = 1_000_000;

pub const MODE_BUYBACK: u8 = 0;
pub const MODE_VAULT: u8 = 1;

/// Carry rule 0 (the $DEBT rule): the remainder under one unit carries only across CONSECUTIVE increases; a down or flat day burns
/// nothing and resets it to zero. Carry rule 1: no carry at all (each increase is floored on its own).
pub const CARRY_CONSECUTIVE: u8 = 0;
pub const CARRY_NONE: u8 = 1;

/// Pool policy 0: the CPMM pool is registered permissionlessly, and only LaunchLab's own migration pool is accepted (review-2 F5):
/// the token's LaunchLab pool must record this fee PDA as creator, the CPMM pool must be the deterministic PDA of the AmmConfig named
/// by that LaunchLab platform (`cpConfigId`) and the two mints, its `pool_creator` must be the fee PDA, and ≥ 90 % of its LP must be
/// burned or held by Raydium's LP lock (what LaunchLab's migration leaves).
/// Pool policy 1: the pool address is fixed at init (creator trust); it must still pass the creator and LP checks (register_pool)
/// before any buyback.
pub const POOL_POLICY_CREATOR_IS_FEE_PDA: u8 = 0;
pub const POOL_POLICY_FIXED: u8 = 1;

/// Attester kind tags. INFORMATIONAL ONLY: every attester is an ed25519 key and the program verifies nothing but signatures and the
/// quorum. The tag tells a reader what stands behind the key (the published attester list, the status page, the Powers Register).
pub const ATTESTER_OPERATOR: u8 = 0;
pub const ATTESTER_ZKTLS_RELAYER: u8 = 1;
pub const ATTESTER_ORACLE: u8 = 2;

pub const KIND_BASELINE: u8 = 0;
pub const KIND_INCREASE: u8 = 1;
pub const KIND_DOWN: u8 = 2;
pub const KIND_FLAT: u8 = 3;
/// A reading whose change exceeds the plausibility bound (review M-2): 0 units, carry reset, and it becomes the new baseline.
pub const KIND_RESET: u8 = 4;

pub const OUTCOME_PENDING: u8 = 0;
/// Processed with nothing to burn (baseline, down/flat day, or an increase under one unit).
pub const OUTCOME_NO_UNITS: u8 = 1;
/// Burned in full (vault: owed = burned; buyback: swap + burn).
pub const OUTCOME_BURNED: u8 = 2;
/// Buyback: the rule's spend was under the floor (or the pool was empty); nothing bought, the pool keeps the SOL.
pub const OUTCOME_BELOW_FLOOR: u8 = 3;
/// Vault: the vault held less than owed; what was there is burned and the rest is a public shortfall carried forward.
pub const OUTCOME_SHORT: u8 = 4;
/// Vault: the allocation is used up; nothing is owed, ever again.
pub const OUTCOME_EXHAUSTED: u8 = 5;

/// Programs this program talks to. Hard-coded so a cranker can never substitute a look-alike.
pub const MEMO_PROGRAM_ID: Pubkey = pubkey!("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
pub const ED25519_PROGRAM_ID: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");
pub const NATIVE_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");

/// Raydium LaunchLab (launchpad) — @raydium-io/raydium-sdk-v2 0.2.74-alpha, src/common/programId.ts (LAUNCHPAD_PROGRAM /
/// DEV_LAUNCHPAD_PROGRAM).
#[cfg(not(feature = "devnet"))]
pub const LAUNCHLAB_PROGRAM_ID: Pubkey = pubkey!("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
#[cfg(feature = "devnet")]
pub const LAUNCHLAB_PROGRAM_ID: Pubkey = pubkey!("DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6");
/// SDK src/raydium/launchpad/pda.ts CREATOR_FEE_VAULT_AUTH_SEED; the creator vault is PDA [creator, mintB].
pub const LAUNCHLAB_CREATOR_FEE_VAULT_AUTH_SEED: &[u8] = b"creator_fee_vault_auth_seed";
/// SDK src/raydium/launchpad/instrument.ts anchorDataBuf.claimCreatorFee.
pub const LAUNCHLAB_CLAIM_CREATOR_FEE_DISCRIMINATOR: [u8; 8] = [26, 97, 138, 203, 132, 171, 141, 252];

#[cfg(not(feature = "devnet"))]
pub const CPMM_PROGRAM_ID: Pubkey = pubkey!("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
#[cfg(feature = "devnet")]
pub const CPMM_PROGRAM_ID: Pubkey = pubkey!("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb");
/// CPMM's pool PDA seed (raydium-cp-swap states/pool.rs POOL_SEED; initialize.rs create_pool derives
/// [POOL_SEED, amm_config, token_0_mint, token_1_mint]).
pub const CPMM_POOL_SEED: &[u8] = b"pool";

/// Raydium's CPMM LP lock ("Burn & Earn") authority: locked LP sits in its associated token account for the LP mint
/// (@raydium-io/raydium-sdk-v2 0.2.74-alpha src/common/programId.ts LOCK_CPMM_AUTH / DEVNET LOCK_CPMM_AUTH; src/raydium/cpmm/
/// instruction.ts makeCpmmLockInstruction: lockLpVault = ATA(lockAuthProgram, lpMint)).
#[cfg(not(feature = "devnet"))]
pub const LOCK_CPMM_AUTHORITY: Pubkey = pubkey!("3f7GcQFG397GAaEnv51zR6tsTVihYRydnydDD1cXekxH");
#[cfg(feature = "devnet")]
pub const LOCK_CPMM_AUTHORITY: Pubkey = pubkey!("7qWVV8UY2bRJfDLP4s37YzBPKUkVB46DStYJBpYbQzu3");
/// Review-3 M-2: at registration at least this share of the pool's CURRENT LP (pool.lp_supply) must be burned (lp_supply − LP mint
/// supply, incl. CPMM's 100 never-minted units) or locked (the lock authority's LP account). Under policy 0 the provenance proof
/// (LaunchLab pool PDA + creator + migrate target, the pinned cpConfigId's pool PDA, fee-PDA pool_creator) is the primary check and
/// this is a floor: the LP minted at pool creation is not recorded on chain (CPMM PoolState keeps only the live lp_supply; the
/// LaunchLab pool keeps curve totals, not the migrated amounts), so "locked ≥ the initial LP" is not derivable and the condition is
/// "locked-or-burned ≥ 50 % of the live supply". A griefer must then deposit MORE than the whole migrated liquidity, and keep it
/// there, to block registration (README "LP-ratio griefing"); a squatter must lock or burn at least half of its own liquidity.
pub const MIN_LOCKED_LP_BPS: u128 = 5_000;
/// Re-check R3-2: a FIXED pool chosen through set_registration_policy (the stranding-recovery fallback) must have at least this share
/// of its live LP burned or locked — unless it is the CPMM pool PDA of a LaunchLab-known AmmConfig (the cpConfigId pinned at
/// initialize_token, or the pinned platform's current one), of which there is exactly one per config and mint.
pub const FALLBACK_MIN_LOCKED_LP_BPS: u128 = 9_000;
/// Review-3 M-3: the LaunchLab platform's LP lock/burn scales (platformScale + creatorScale + burnScale, in 10⁻⁶, SDK
/// launchpad.ts "max: 1_000_000 = 100%") must cover at least this share at initialize_token.
pub const MIN_LL_LOCK_SCALE_PPM: u64 = 500_000;
pub const LL_SCALE_DENOMINATOR: u64 = 1_000_000;

/// LaunchLab account layouts (SDK src/raydium/launchpad/layout.ts, borsh-packed, 8-byte discriminator first):
///   LaunchpadPool  ["pool", mintA, mintB] (pda.ts getPdaLaunchpadPoolId): migrateType @20, platformId @173, mintA @205, mintB @237,
///                  creator @333 (429 bytes)
///   PlatformConfig: cpConfigId @688 (944 bytes)
/// Pinned against bytes encoded by the SDK's own layouts (fixtures/launchlab-accounts-sdk.json, tests/launchlab.rs).
pub const LAUNCHLAB_POOL_SEED: &[u8] = b"pool";
pub const LL_POOL_MIGRATE_TYPE: usize = 20;
pub const LL_POOL_PLATFORM_ID: usize = 173;
pub const LL_POOL_MINT_A: usize = 205;
pub const LL_POOL_MINT_B: usize = 237;
pub const LL_POOL_CREATOR: usize = 333;
pub const LL_POOL_MIN_LEN: usize = 365;
pub const LL_PLATFORM_CP_CONFIG_ID: usize = 688;
/// PlatformConfig.platformScale / creatorScale / burnScale (u64 each) and platformCpCreator (review-3 M-3; SDK offsetOf).
pub const LL_PLATFORM_SCALES: usize = 80;
pub const LL_PLATFORM_CP_CREATOR: usize = 800;
pub const LL_PLATFORM_MIN_LEN: usize = 832;
/// LaunchpadPool.migrateType: 0 = AMM v4, 1 = CPMM (instrument.ts encodes `migrateType === "amm" ? 0 : 1`).
pub const LL_MIGRATE_TYPE_CPMM: u8 = 1;
