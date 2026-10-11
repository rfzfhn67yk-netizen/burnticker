import { PublicKey } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";

/**
 * burn_receipts — the Receipts launchpad's on-chain burn program (programs/burn-receipts). Constants mirror
 * programs/burn-receipts/programs/burn_receipts/src/constants.rs.
 *
 * PROGRAM ID: the IDL's address is the id the committed build declares. Until 2026-10-10 that was the LOCALNET TEST key generated on
 * the dev Mac (GV9CMj…SuF8); since the devnet rehearsal's `anchor keys sync` it is the REAL id (AuQjoSgq…zhMM, one id for devnet and
 * mainnet, D-7). Every client entry point takes `programId` explicitly.
 */
export const BURN_RECEIPTS_LOCALNET_PROGRAM_ID = new PublicKey(BURN_RECEIPTS_IDL.address);
/**
 * The retired localnet test key. A fee PDA derived under it belongs to no deployed program, so the launch CLI refuses to --send with it.
 * (The "placeholder" check used to compare against the IDL's address, which after `anchor keys sync` is the real id — so the real id
 * was refused; fixed 2026-10-10 during the devnet rehearsal.)
 */
export const BURN_RECEIPTS_TEST_PROGRAM_ID = new PublicKey("GV9CMjXPGbmXnn3ci3RjvTBpfdgiZ4Ts7UWu1LCnSuF8");

export type Cluster = "mainnet" | "devnet" | "localnet";

export const SEED_CONFIG = Buffer.from("config", "utf8");
export const SEED_FEE = Buffer.from("fee", "utf8");
export const SEED_READING = Buffer.from("reading", "utf8");
export const SEED_PLATFORM = Buffer.from("platform", "utf8");
export const BPF_LOADER_UPGRADEABLE_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
/** The owner's pre-audit burn-pool cap default (25 SOL); raised only through a 48 h timelock; sunsets at PlatformConfig.cap_sunset_ts. */
export const DEFAULT_BURN_POOL_CAP_LAMPORTS = BigInt(25_000_000_000);
export const CAP_TIMELOCK_SECS = 48 * 60 * 60;
/** The default cap applies when no PlatformConfig exists, until this hard-coded sunset (2027-10-01T00:00:00Z) (review M-1). */
export const DEFAULT_CAP_SUNSET_TS = 1_822_348_800;
/** The initial PlatformConfig cap is at least 1 SOL and its sunset no later than DEFAULT_CAP_SUNSET_TS (review-2 F8). */
export const MIN_BURN_POOL_CAP_LAMPORTS = BigInt(1_000_000_000);
/**
 * Buyback swap safety (review H-1/L-7, review-2 F1): mandatory TWAP guard ≤ 300 bps over 600–1,200 s; min-out = the larger of the
 * spot and TWAP quotes less slippage (≤ 300 bps); deviation and slippage each ≥ 150,000 / window bps (the oracle's 15 s bucket
 * margin); one crank ≤ 2 % of the WSOL reserve.
 */
export const MAX_TWAP_DEVIATION_BPS = 300;
export const MAX_SLIPPAGE_BPS = 300;
export const TWAP_BUCKET_TOLERANCE_BPS_SECS = 150_000;
export const MIN_TWAP_WINDOW_SECS = 600;
export const MAX_TWAP_WINDOW_SECS = 1_200;
export const MAX_SPEND_RESERVE_BPS = 200;
/** A dead pool can be replaced after 7 days of CONTINUOUS recorded untradeability (review M-4, review-2 F6: observations ≤ 24 h apart). */
export const POOL_REPLACEMENT_DELAY_SECS = 7 * 24 * 60 * 60;
export const UNTRADEABLE_MAX_GAP_SECS = 24 * 60 * 60;
/** Review-3 L-3: a spell starts on the second of two untradeable observations ≥ 1 h apart (dated from the first). */
export const UNTRADEABLE_CONFIRM_SECS = 60 * 60;
/** Review-3 L-2: a kept key counts towards ADDING keys only after 7 days of membership. */
export const ATTESTER_SENIORITY_SECS = 7 * 24 * 60 * 60;
/** Review-3 L-4: at most 3 keys on the PlatformConfig's cranker allowlist (applies only while the cap is in force). */
export const MAX_CRANKERS = 3;
/** After 30 days of continuous untradeability a buyback reading is processed below-floor with its target carried (review-2 F7). */
export const QUEUE_UNBLOCK_SECS = 30 * 24 * 60 * 60;
/** register_pool: ≥ 50 % of the pool's LIVE LP burned or held by Raydium's LP lock — a floor under the provenance proof (review-3 M-2). */
export const MIN_LOCKED_LP_BPS = 5_000;
/** initialize_token (policy 0): the LaunchLab platform's LP lock + burn scales must cover ≥ 50 % (10⁻⁶ units; review-3 M-3). */
export const MIN_LL_LOCK_SCALE_PPM = 500_000;
/** Re-check R3-2: a set_registration_policy fallback pool needs ≥ 90 % of its live LP burned/locked unless it is a LaunchLab-known config's pool PDA. */
export const FALLBACK_MIN_LOCKED_LP_BPS = 9_000;
/** Re-check R3-2: a registration-policy proposal can be applied until 14 days after it was proposed. */
export const POLICY_PROPOSAL_TTL_SECS = 14 * 24 * 60 * 60;
/** Re-check R3-4: the cranker allowlist stops applying 90 days after initialize_platform (or at the cap sunset, if earlier). */
export const CRANKER_ALLOWLIST_MAX_SECS = 90 * 24 * 60 * 60;

/** v3 (review-2 F12): `BURNRECEIPTS-v3|<cluster genesis>|<program>|<mint>|<feed>|prev=…|<date>|<value>|src=…|proof=…`. */
export const ATTESTATION_DOMAIN = "BURNRECEIPTS-v3";
/** Largest quorum (review-2 F4): a quorum-3 shared-message reading fits a legacy transaction (≈ 1,190 of 1,232 bytes). */
export const MAX_QUORUM = 3;
/** The packet limit every transaction must fit (legacy or v0). */
export const PACKET_DATA_SIZE = 1_232;
export const PARAMS_HASH_DOMAIN = Buffer.from("BURNRECEIPTS-PARAMS-v1", "utf8");
export const MAX_ATTESTERS = 5;
export const ATTESTER_TIMELOCK_SECS = 48 * 60 * 60;
export const MEMO_MAX_BYTES = 566;

export const MODE_BUYBACK = 0;
export const MODE_VAULT = 1;
export const CARRY_CONSECUTIVE = 0;
export const CARRY_NONE = 1;
export const POOL_POLICY_CREATOR_IS_FEE_PDA = 0;
export const POOL_POLICY_FIXED = 1;
/** 2026-10-10: the token launched through pair_curve; its pool is registered by register_pair_pool (docs/burnticker/PAIR-CURVE.md §5.2). */
export const POOL_POLICY_PAIR_CURVE = 2;
/** The pair_curve program (one id for devnet and mainnet; burn_receipts hard-codes it as PAIR_CURVE_PROGRAM_ID). */
export const PAIR_CURVE_PROGRAM_ID = new PublicKey("2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN");

export const KIND_BASELINE = 0;
export const KIND_INCREASE = 1;
export const KIND_DOWN = 2;
export const KIND_FLAT = 3;
/** An out-of-bound reading accepted as a reset: 0 units, new baseline (review M-2). */
export const KIND_RESET = 4;

export const OUTCOME_PENDING = 0;
export const OUTCOME_NO_UNITS = 1;
export const OUTCOME_BURNED = 2;
export const OUTCOME_BELOW_FLOOR = 3;
export const OUTCOME_SHORT = 4;
export const OUTCOME_EXHAUSTED = 5;
export const OUTCOME_NAMES: Record<number, string> = { 0: "pending", 1: "no-units", 2: "burned", 3: "below-floor", 4: "short", 5: "exhausted", 6: "forwarded" };

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const ED25519_PROGRAM_ID = new PublicKey("Ed25519SigVerify111111111111111111111111111");
export const SYSVAR_INSTRUCTIONS_ID = new PublicKey("Sysvar1nstructions1111111111111111111111111");
export const NATIVE_MINT = new PublicKey("So11111111111111111111111111111111111111112");

/** Raydium CPMM (raydium-cp-swap). The program's `devnet` cargo feature switches its hard-coded id to Raydium's devnet deployment. */
export const CPMM_PROGRAM_ID: Record<Cluster, PublicKey> = {
  mainnet: new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"),
  devnet: new PublicKey("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb"),
  // Localnet runs the mainnet build (the LiteSVM suite and the local validator load the fixture at the mainnet id).
  localnet: new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"),
};
export const CPMM_AUTH_SEED = Buffer.from("vault_and_lp_mint_auth_seed", "utf8");

/** Raydium LaunchLab (@raydium-io/raydium-sdk-v2 src/common/programId.ts). The program's `devnet` feature selects the devnet id. */
export const LAUNCHLAB_PROGRAM_ID: Record<Cluster, PublicKey> = {
  mainnet: new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"),
  devnet: new PublicKey("DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6"),
  localnet: new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"),
};
export const LAUNCHLAB_CREATOR_FEE_VAULT_AUTH_SEED = Buffer.from("creator_fee_vault_auth_seed", "utf8");
/** LaunchLab pool PDA ["pool", mintA, mintB] (SDK pda.ts getPdaLaunchpadPoolId) and the layout offsets the program reads (layout.ts). */
export const LAUNCHLAB_POOL_SEED = Buffer.from("pool", "utf8");
export const LL_POOL_PLATFORM_ID = 173;
export const LL_PLATFORM_CP_CONFIG_ID = 688;
export const LL_PLATFORM_SCALES = 80;
export const LL_PLATFORM_CP_CREATOR = 800;

/** Raydium's CPMM LP lock authority (SDK programId.ts LOCK_CPMM_AUTH): locked LP sits in its ATA for the LP mint. */
export const LOCK_CPMM_AUTHORITY: Record<Cluster, PublicKey> = {
  mainnet: new PublicKey("3f7GcQFG397GAaEnv51zR6tsTVihYRydnydDD1cXekxH"),
  devnet: new PublicKey("7qWVV8UY2bRJfDLP4s37YzBPKUkVB46DStYJBpYbQzu3"),
  localnet: new PublicKey("3f7GcQFG397GAaEnv51zR6tsTVihYRydnydDD1cXekxH"),
};

/**
 * LAUNCHPAD-PATH §35 (2026-10-10): graduation LP is LOCKED forever in Raydium's CPMM lock program ("Burn & Earn"), the Fee Key NFT is
 * held by burn_receipts' FEE_KEYS PDA, and claim_lock_fees splits the LP fees 80 % burn pool / 20 % operator treasury (compiled).
 * Lock program ids: SDK src/common/programId.ts LOCK_CPMM_PROGRAM / DEVNET LOCK_CPMM_PROGRAM. Its authority (above) is its PDA
 * ["lock_cp_authority_seed"].
 */
export const LOCK_CPMM_PROGRAM_ID: Record<Cluster, PublicKey> = {
  mainnet: new PublicKey("LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE"),
  devnet: new PublicKey("DRay25Usp3YJAi7beckgpGUC7mGJ2cR1AVPxhYfwVCUX"),
  localnet: new PublicKey("LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE"),
};
export const LOCK_CP_AUTHORITY_SEED = Buffer.from("lock_cp_authority_seed", "utf8");
/** The lock program's per-position state ["locked_liquidity", fee_nft_mint] (LockedCpLiquidityState, 256 B; offsets from devnet). */
export const LOCKED_LIQUIDITY_SEED = Buffer.from("locked_liquidity", "utf8");
export const LOCKED_LIQUIDITY_OFFSETS = { lockedLp: 8, claimedLp: 16, unclaimedLp: 24, lastLp: 32, lastK: 40, epoch: 56, pool: 64, feeNftMint: 96, owner: 128, locker: 128, lpMint: 160 } as const;
export const SEED_FEE_KEYS = Buffer.from("fee_keys", "utf8");
export const SEED_FEE_KEY = Buffer.from("fee_key", "utf8");
/** The fixed split (program constants LOCK_FEE_BURN_BPS / LOCK_FEE_OPERATOR_BPS): operator = floor(x·2000/10000), burn pool = the rest. */
export const LOCK_FEE_BURN_BPS = 8_000;
export const LOCK_FEE_OPERATOR_BPS = 2_000;
/**
 * The operator treasury compiled into each build (program constant OPERATOR_TREASURY): mainnet = the owner's hardware wallet 8cwwy895…
 * (also the LaunchLab platform fee wallet; owner decision 2026-10-11); devnet = the devnet Squads vault; localnet = the LiteSVM suites'
 * test treasury.
 */
export const OPERATOR_TREASURY: Record<Cluster, PublicKey> = {
  mainnet: new PublicKey("8cwwy895BENMJTueXfQovWD4mvuoJ4kgyR52UMrqSbo5"),
  devnet: new PublicKey("A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD"),
  localnet: new PublicKey(Buffer.alloc(32, 0x7e)),
};
/** PlatformConfig.platformLockNftWallet (LaunchLab layout.ts) and the policy-0 requirement: platformScale 1,000,000, the others 0. */
export const LL_PLATFORM_LOCK_NFT_WALLET = 48;
export const REQUIRED_LL_PLATFORM_SCALES_PPM: readonly [bigint, bigint, bigint] = [BigInt(1_000_000), BigInt(0), BigInt(0)];
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
/**
 * LP-lock round 2 (2026-10-11): the LOCKER (LockedCpLiquidityState @128) identifies a position. Policy 0 = LaunchLab's vault_auth PDA
 * ["vault_auth_seed"] (the migration locks the LP under it); policy 2 = the pair's vault (pool.pool_creator).
 */
export const LAUNCHLAB_VAULT_AUTH_SEED = Buffer.from("vault_auth_seed", "utf8");
export const LAUNCHLAB_VAULT_AUTH: Record<Cluster, PublicKey> = {
  mainnet: new PublicKey("WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh"),
  devnet: new PublicKey("5xqNaZXX5eUi4p5HU4oz9i5QnwRNT2y6oN7yyn4qENeq"),
  localnet: new PublicKey("WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh"),
};
/**
 * BURNTICKER_PLATFORM compiled into each build (round 2): initialize_token for policies 0 and 2 requires launchlab_platform == it
 * (PlatformNotAllowed). Mainnet = 94x5qDDJ… = getPdaPlatformId(LaunchLab LanMV9sA…, admin EMht6aGc…) (compiled 2026-10-11); devnet =
 * Burnticker's devnet LaunchLab platform; localnet uses the `test-pins` cargo feature's value (not mirrored).
 */
export const BURNTICKER_PLATFORM: Record<Cluster, PublicKey> = {
  mainnet: new PublicKey("94x5qDDJP4UCkeMWppnmvqTmMgo971h3d6MDRnjEfYy9"),
  devnet: new PublicKey("GvSKpe5pwLuRzCQ56EGAA1urjtcxx554NivsGHexv3tf"),
  localnet: PublicKey.default,
};

/**
 * Genesis hashes, for the cluster-consistency check (review L-6) and the signed message's cluster binding (review-2 F12: the
 * program's default build binds mainnet's, its `devnet` build devnet's; each TokenConfig stores the one it enforces).
 */
export const GENESIS_HASH: Record<"mainnet" | "devnet", string> = {
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
};
/** Review-3 I-1: the tag a `--features localnet` build binds instead of a genesis hash: sha256("BURNRECEIPTS-LOCALNET-GENESIS"). */
export const LOCALNET_GENESIS_TAG = "38EeoTLdVHgiexj97JrnuEYvG7zV7nSFVdUeMJxUDdLt";

/**
 * Review-3 I-1: the client never signs a message bound to MAINNET's genesis unless the context is mainnet (a localnet rehearsal of the
 * default build would otherwise produce mainnet-valid signatures); on devnet/mainnet the config's genesis must equal the RPC's.
 */
export function assertSignableGenesis(configGenesis: string, cluster: Cluster, rpcGenesis: string): void {
  if (configGenesis === GENESIS_HASH.mainnet && cluster !== "mainnet") throw new Error(`burnReceipts: refusing to sign a mainnet-bound message on ${cluster} (use a --features ${cluster} build)`);
  if (cluster !== "localnet" && configGenesis !== rpcGenesis) throw new Error(`burnReceipts: the program build binds genesis ${configGenesis} but the RPC's is ${rpcGenesis}; refusing to sign`);
}
