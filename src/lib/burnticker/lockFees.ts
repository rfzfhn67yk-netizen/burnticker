import crypto from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import type { ConfirmOutcome, SignedTx } from "@/lib/burnKeeper/programPort";
import { BURN_RECEIPTS_LOCALNET_PROGRAM_ID, BURNTICKER_PLATFORM as PROGRAM_BURNTICKER_PLATFORM, LAUNCHLAB_VAULT_AUTH, LOCK_CPMM_AUTHORITY, LOCK_CPMM_PROGRAM_ID, LOCK_FEE_BURN_BPS as PROGRAM_LOCK_FEE_BURN_BPS, LOCK_FEE_OPERATOR_BPS as PROGRAM_LOCK_FEE_OPERATOR_BPS, OPERATOR_TREASURY as PROGRAM_OPERATOR_TREASURY, SEED_FEE_KEY, SEED_FEE_KEYS } from "@/lib/burnReceipts/constants";

/**
 * LP LOCKED FOREVER, ITS FEES FUND THE BURN (owner decision 2026-10-10, LAUNCHPAD-PATH §35; supersedes the 10-09 "all graduation LP
 * burned"). At graduation LaunchLab migrates the curve into a Raydium CPMM pool and LOCKS 100 % of the LP with Raydium's LP lock
 * (Burn & Earn): the LP itself can never be withdrawn by anyone; what remains is the right to the LP's trading fees, represented by a
 * Fee Key NFT. The platform config sends that Fee Key to a burn_receipts PDA (the "fee keys" PDA), so no person ever holds it. A
 * permissionless `claim_lock_fees` instruction collects the LP fees and splits them by a COMPILED constant (no admin key, no config
 * field):
 *
 *   SOL side  80 % → the coin's burn pool (its fee PDA ["fee", mint])     LOCK_FEE_BURN_BPS     8,000
 *             20 % → the operator treasury (operatorTreasuryRecord below) LOCK_FEE_OPERATOR_BPS 2,000
 *   coin side burned outright
 *
 * Integer lamports: the operator's share is floor(sol × 2,000 / 10,000) and the burn pool gets the rest, so any odd lamport goes to the
 * burn pool (`splitLockFees`). Post-graduation economics per swap: Raydium CPMM 25 bps = 21 LP (→ 16.8 burned + 4.2 operator) + 3 RAY
 * buyback + 1 Raydium treasury; plus the existing 4.75 bps creator-fee line to the burn pool.
 *
 * THIS FILE IS THE ADAPTER the keeper, the pages and the API code against (the program change, its IDL and the verified build are the
 * program builder's). The names, seeds and accounts below are the program's final interface (LOCK_FEES_INTERFACE); the fake
 * (`FakeLockFees`) implements the port in memory so the crank, the receipts and the pages are tested before the program is deployed;
 * the real client is lockFeesChain.ts. No key is read here and nothing is sent.
 */

/** The program's compiled split (burn_receipts constants.rs, mirrored in src/lib/burnReceipts/constants.ts — one source). */
export const LOCK_FEE_BURN_BPS = PROGRAM_LOCK_FEE_BURN_BPS;
export const LOCK_FEE_OPERATOR_BPS = PROGRAM_LOCK_FEE_OPERATOR_BPS;
export const LOCK_FEE_BPS_DENOMINATOR = 10_000;
/** The graduation LP share that is locked (LaunchLab migrateCpLockNftScale: platformScale 1,000,000 / creatorScale 0 / burnScale 0). */
export const LP_LOCKED_PCT = 100;
export const LP_POLICY = "locked-forever" as const;
/** The platform's LP scales at graduation, in parts per million of the LP (what create_platform_config writes and the launch gate pins). */
export const LP_SCALES_PPM = { platform: BigInt(1_000_000), creator: BigInt(0), burn: BigInt(0) } as const;

/** The burn_receipts program id the IDL declares (one id for devnet and mainnet, D-7) — the fallback for fixed PDAs. */
const BURN_RECEIPTS_PROGRAM_ID = BURN_RECEIPTS_LOCALNET_PROGRAM_ID;

/** The one-line policy statement every surface uses (copy-lint clean: no price, no promise, no prize). */
export const LP_POLICY_LINE = "LP locked forever; its fees fund the burn (80% burned, 20% operator, fixed in code)";
/** The short badge on token and pair pages. */
export const LP_POLICY_BADGE = "LP locked forever · fees fund the burn";

/**
 * THE PROGRAM INTERFACE this adapter is bound to (the program builder's, 2026-10-10: names, seeds and accounts final). The constants
 * come from src/lib/burnReceipts/constants.ts (the program's mirror), the builders (`registerFeeKeyIx`, `claimLockFeesIx`) and decoders
 * (`fetchFeeKeyRecord`, `decodeLockedLiquidity`) from src/lib/burnReceipts — the real client is lockFeesChain.ts. test/burntickerLockFees
 * .test.ts pins every value, and checks this file against the program's mirror, so a silent drift fails.
 */
export const LOCK_FEES_INTERFACE = {
  /** Round 2 (2026-10-11, the blind review's RL-2/RL-3/L-1..L-3): register_fee_key gains lp_lock_vault and runs BEFORE register_pool for
   *  policy 0 (register_pool then takes the FeeKeyRecord as its optional last account); claim_lock_fees takes no arguments; memo v2. */
  interface: "r2-2026-10-11",
  builders: "bound" as "pending" | "bound",
  instructions: { register: "register_fee_key", claim: "claim_lock_fees", registerPool: "register_pool", pairBurnFallback: "burn_lp" },
  seeds: { feeKeys: "fee_keys", feeKey: "fee_key", lockedLiquidity: "locked_liquidity", lockAuthority: "lock_cp_authority_seed", pairFeeNft: "fee_nft" },
  event: "LockFeesClaimed",
  memoTag: "lockfees",
} as const;

/** Round 2: the memo versions the parsers accept (v1 = the devnet history before round 2). */
export const LOCK_FEES_MEMO_VERSIONS = ["v1", "v2"] as const;

type ClusterKey = "mainnet" | "devnet" | "localnet";
const clusterKey = (cluster: string): ClusterKey => (cluster === "mainnet" ? "mainnet" : cluster === "localnet" ? "localnet" : "devnet");

/** Raydium's CPMM LP lock program ("Burn & Earn"; SDK common/programId.ts LOCK_CPMM_PROGRAM), per cluster. */
export const LP_LOCK_PROGRAM: Record<ClusterKey, string> = { mainnet: LOCK_CPMM_PROGRAM_ID.mainnet.toBase58(), devnet: LOCK_CPMM_PROGRAM_ID.devnet.toBase58(), localnet: LOCK_CPMM_PROGRAM_ID.localnet.toBase58() };
/** The lock program's authority PDA ["lock_cp_authority_seed"] (SDK LOCK_CPMM_AUTH): locked LP sits in ATA(lock authority, lp_mint). */
export const LP_LOCK_AUTHORITY: Record<ClusterKey, string> = { mainnet: LOCK_CPMM_AUTHORITY.mainnet.toBase58(), devnet: LOCK_CPMM_AUTHORITY.devnet.toBase58(), localnet: LOCK_CPMM_AUTHORITY.localnet.toBase58() };
export const lpLockProgramFor = (cluster: string): string => LP_LOCK_PROGRAM[clusterKey(cluster)];
export const lpLockAuthorityFor = (cluster: string): string => LP_LOCK_AUTHORITY[clusterKey(cluster)];

/**
 * OPERATOR_TREASURY, compiled into the program per cluster (where claim_lock_fees pays the 20 %). Devnet: the Squads vault. Mainnet:
 * the owner's hardware wallet 8cwwy895… (also the LaunchLab platform fee wallet; compiled in 2026-10-11). A build with all zeros would
 * refuse claims with `TreasuryNotPinned` (a launch-gate problem). null = not pinned (the program's all-zero value).
 * Localnet = the LiteSVM suites' test treasury.
 */
const pinnedOrNull = (k: PublicKey): string | null => (k.equals(PublicKey.default) ? null : k.toBase58());
export const OPERATOR_TREASURY: Record<ClusterKey, string | null> = {
  mainnet: pinnedOrNull(PROGRAM_OPERATOR_TREASURY.mainnet),
  devnet: pinnedOrNull(PROGRAM_OPERATOR_TREASURY.devnet),
  localnet: pinnedOrNull(PROGRAM_OPERATOR_TREASURY.localnet),
};
export const operatorTreasuryFor = (cluster: string): string | null => OPERATOR_TREASURY[clusterKey(cluster)];

/**
 * THE OPERATOR TREASURY, ONE RECORD (audit R03, 2026-10-11). The fee tables, the trust statements, the fee ledger and the operator page
 * once disagreed about who receives the operator's 20 % of the locked LP's SOL fees ("the Squads vault" in one, the developer fee
 * wallet in another). The answer is per cluster and compiled into the program (src/lib/burnReceipts/constants.ts OPERATOR_TREASURY);
 * every surface takes its address, holder, link and sentence from here.
 *   mainnet  8cwwy895… — the developer fee wallet (the owner's hardware wallet, also LaunchLab's platform fee wallet). NOT the Squads
 *            vault: the vault holds upgrade and config authority and no fee stream.
 *   devnet   the rehearsal Squads vault (the devnet build compiles it).
 */
export const OPERATOR_TREASURY_HOLDER: Record<ClusterKey, { holder: string; isSquadsVault: boolean }> = {
  mainnet: { holder: "the developer fee wallet (the owner's hardware wallet, also the LaunchLab platform fee wallet), not the Squads vault", isSquadsVault: false },
  devnet: { holder: "the devnet Squads vault (rehearsal network)", isSquadsVault: true },
  localnet: { holder: "the test suites' treasury", isSquadsVault: false },
};
/** `who` names the recipient (address + holder); `text` adds what it receives — the fee tables' recipient cell. */
export interface OperatorTreasuryRecord { cluster: ClusterKey; address: string | null; role: string; holder: string; isSquadsVault: boolean; url: string | null; who: string; text: string }
export const OPERATOR_TREASURY_ROLE = "operator treasury: 20% of the locked LP's SOL-side fees, paid by the permissionless claim_lock_fees (compiled into the program)";
export function operatorTreasuryRecord(cluster: string): OperatorTreasuryRecord {
  const c = clusterKey(cluster), address = OPERATOR_TREASURY[c], h = OPERATOR_TREASURY_HOLDER[c];
  const who = address ? `the operator treasury ${address} on ${c} — ${h.holder}` : `the operator treasury (not pinned in the ${c} program build)`;
  const text = address
    ? `${who}: 20% of the locked LP's SOL-side fees, paid by the permissionless claim_lock_fees`
    : `${who}: claims refuse (${TREASURY_NOT_PINNED}) and the fees stay in the lock`;
  return { cluster: c, address, role: OPERATOR_TREASURY_ROLE, holder: h.holder, isSquadsVault: h.isSquadsVault, url: address ? solscanUrl(c, address) : null, who, text };
}
/** The program error a claim gets while the cluster's treasury is all zeros. */
export const TREASURY_NOT_PINNED = "TreasuryNotPinned";

/**
 * BURNTICKER_PLATFORM compiled into each build (round 2): the one LaunchLab platform initialize_token accepts for policies 0 and 2.
 * null = not pinned (initialize_token would refuse PlatformNotPinned); mainnet = 94x5qDDJ… since 2026-10-11.
 */
export const BURNTICKER_PLATFORM: Record<ClusterKey, string | null> = {
  mainnet: pinnedOrNull(PROGRAM_BURNTICKER_PLATFORM.mainnet),
  devnet: pinnedOrNull(PROGRAM_BURNTICKER_PLATFORM.devnet),
  localnet: pinnedOrNull(PROGRAM_BURNTICKER_PLATFORM.localnet),
};
export const burntickerPlatformFor = (cluster: string): string | null => BURNTICKER_PLATFORM[clusterKey(cluster)];
export const PLATFORM_NOT_PINNED = "PlatformNotPinned";
/** The locker a policy-0 position must carry (LockedCpLiquidityState @128): LaunchLab's vault_auth PDA. */
export const launchLabLockerFor = (cluster: string): string => LAUNCHLAB_VAULT_AUTH[clusterKey(cluster)].toBase58();

/**
 * The program's LP-lock refusals in plain words (keeper alerts, the API's lp.lastError). Codes per the round-2 IDL; a name not listed
 * here is shown as-is.
 */
export const LOCK_FEE_ERRORS: Record<string, { code: number | null; sentence: string }> = {
  TreasuryNotPinned: { code: null, sentence: "the operator treasury is not compiled into this cluster's program build, so no claim can run yet; the LP fees stay in the lock" },
  FeeKeyMismatch: { code: 6073, sentence: "the Fee Key record names a different pool than the one being registered" },
  PlatformNotPinned: { code: 6074, sentence: "the Burnticker LaunchLab platform is not compiled into this cluster's program build, so no coin can be initialised yet" },
  LockerMismatch: { code: 6075, sentence: "the locked position was not created by the expected locker (LaunchLab's migration, or the pair's vault), so it is not this coin's lock" },
  FeeKeyNotRegistered: { code: 6076, sentence: "the coin's Fee Key is not registered yet: register_fee_key must run before register_pool and before any claim" },
  PlatformNotAllowed: { code: null, sentence: "the coin was created under a LaunchLab platform other than the pinned Burnticker platform" },
  FeeKeyAlreadyRegistered: { code: null, sentence: "the Fee Key is already registered (another crank got there first)" },
  LpLockFallbackNotDue: { code: 6032, sentence: "the LP burn fallback is not due yet: it opens only 30 days after graduation started, if Raydium's lock has still refused" },
};
export function lockFeeErrorSentence(name: string | null | undefined): string {
  if (!name) return "unknown refusal";
  const n = Object.keys(LOCK_FEE_ERRORS).find((k) => name === k || name.includes(k) || (LOCK_FEE_ERRORS[k].code !== null && name.includes(`0x${LOCK_FEE_ERRORS[k].code!.toString(16)}`)) || (LOCK_FEE_ERRORS[k].code !== null && name.includes(String(LOCK_FEE_ERRORS[k].code))));
  return n ? `${n}: ${LOCK_FEE_ERRORS[n].sentence}` : name;
}

const pk = (v: string | PublicKey) => (typeof v === "string" ? new PublicKey(v) : v);
/** burn_receipts ["fee_keys"]: the GLOBAL data-less account that owns every Fee Key NFT (at ATA(fee_keys, nft_mint)); LaunchLab's platformLockNftWallet. */
export function feeKeysPda(programId: string | PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SEED_FEE_KEYS], pk(programId))[0];
}
/** burn_receipts ["fee_key", mint]: the per-mint FeeKeyRecord written by register_fee_key (pool, lp mint, Fee Key, claim totals). */
export function feeKeyRecordPda(programId: string | PublicKey, mint: string | PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SEED_FEE_KEY, pk(mint).toBuffer()], pk(programId))[0];
}
/** Raydium lock ["locked_liquidity", nft_mint]: the LockedCpLiquidityState of one Fee Key. */
export function lockedLiquidityPda(lockProgram: string | PublicKey, feeNftMint: string | PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(LOCK_FEES_INTERFACE.seeds.lockedLiquidity, "utf8"), pk(feeNftMint).toBuffer()], pk(lockProgram))[0];
}
/** Raydium lock ["lock_cp_authority_seed"]: the lock authority (equals LP_LOCK_AUTHORITY for the cluster's lock program). */
export function lockAuthorityPda(lockProgram: string | PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(LOCK_FEES_INTERFACE.seeds.lockAuthority, "utf8")], pk(lockProgram))[0];
}
/** pair_curve ["fee_nft", pair, [side]]: a pair pool's Fee Key NFT mint (side 0 = A, 1 = B). */
export function pairFeeNftMint(pairCurveProgram: string | PublicKey, pair: string | PublicKey, side: 0 | 1): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(LOCK_FEES_INTERFACE.seeds.pairFeeNft, "utf8"), pk(pair).toBuffer(), Buffer.from([side])], pk(pairCurveProgram))[0];
}

/** Raydium's LockedCpLiquidityState (256 bytes), the fields the keeper and the pages read. Offsets per the lock program's layout. */
/** `locker` (@128) identifies the position (round 2): policy 0 = LaunchLab's vault_auth PDA, policy 2 = the pair vault. `owner` is the same field under its old name. */
export interface LockedCpLiquidityView { lockedLp: bigint; claimedLp: bigint; unclaimedLp: bigint; lastLp: bigint; lastK: bigint; epoch: bigint; pool: string; feeNftMint: string; locker: string; owner: string; lpMint: string }
export const LOCKED_CP_LIQUIDITY_LEN = 256;
export function decodeLockedCpLiquidity(data: Uint8Array): LockedCpLiquidityView {
  if (data.length < 192) throw new Error(`LockedCpLiquidityState: ${data.length} bytes (< 192)`);
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const key = (o: number) => new PublicKey(b.subarray(o, o + 32)).toBase58();
  return { lockedLp: b.readBigUInt64LE(8), claimedLp: b.readBigUInt64LE(16), unclaimedLp: b.readBigUInt64LE(24), lastLp: b.readBigUInt64LE(32), lastK: b.readBigUInt64LE(40) + (b.readBigUInt64LE(48) << BigInt(64)), epoch: b.readBigUInt64LE(56), pool: key(64), feeNftMint: key(96), locker: key(128), owner: key(128), lpMint: key(160) };
}

/** The SOL side of one claim, split by the compiled constants: the operator gets floor(20 %), the burn pool the rest (odd lamports included). */
export function splitLockFees(solLamports: bigint): { burnPool: bigint; operator: bigint } {
  if (solLamports < BigInt(0)) throw new Error("splitLockFees: negative lamports");
  const operator = (solLamports * BigInt(LOCK_FEE_OPERATOR_BPS)) / BigInt(LOCK_FEE_BPS_DENOMINATOR);
  return { burnPool: solLamports - operator, operator };
}

/** True when a claim's recorded amounts are exactly the compiled split of its SOL side. */
export const splitMatches = (f: Pick<LockFeeClaimFacts, "solLamports" | "toBurnPoolLamports" | "toOperatorLamports">): boolean => {
  const s = splitLockFees(f.solLamports);
  return s.burnPool === f.toBurnPoolLamports && s.operator === f.toOperatorLamports;
};

/**
 * The program's claim memo: `<PREFIX>|lockfees|wsol=<lamports>|burnpool=<lamports>|operator=<lamports>|burned=<raw>|nft=<first 12 of the
 * Fee Key mint>|v1`. The receipt line, status.json and the SDK read a claim's amounts from it (or from the LockFeesClaimed event).
 */
export function formatLockFeesMemo(prefix: string, f: LockFeeClaimFacts, feeNftMint: string, version: "v1" | "v2" = "v2"): string {
  const nft = feeNftMint.slice(0, 12);
  if (version === "v1") return `${prefix}|${LOCK_FEES_INTERFACE.memoTag}|wsol=${f.solLamports}|burnpool=${f.toBurnPoolLamports}|operator=${f.toOperatorLamports}|burned=${f.tokenBurnedRaw}|nft=${nft}|v1`;
  return `${prefix}|${LOCK_FEES_INTERFACE.memoTag}|wsol=${f.solLamports}|burnpool=${f.toBurnPoolLamports}|operator=${f.toOperatorLamports}|paid=${f.paidLamports ?? f.toOperatorLamports}|pending=${f.pendingLamports ?? BigInt(0)}|burned=${f.tokenBurnedRaw}|nft=${nft}|v2`;
}
/**
 * Both memo versions (round 2): v1 `<PREFIX>|lockfees|wsol=N|burnpool=N|operator=N|burned=N|nft=<12>|v1` (devnet history) and v2
 * `<PREFIX>|lockfees|wsol=N|burnpool=N|operator=N|paid=N|pending=N|burned=N|nft=<12>|v2` — `paid` / `pending` are the program's own
 * figures for the operator leg (paid to the treasury in this transaction / still owed after it), recorded as written.
 */
export function parseLockFeesMemo(memo: string): (LockFeeClaimFacts & { prefix: string; nft: string; version: "v1" | "v2" }) | null {
  const t = memo.trim();
  const v1 = /^([A-Z0-9]{2,12})\|lockfees\|wsol=(\d+)\|burnpool=(\d+)\|operator=(\d+)\|burned=(\d+)\|nft=([1-9A-HJ-NP-Za-km-z]{1,12})\|v1$/.exec(t);
  if (v1) return { prefix: v1[1], solLamports: BigInt(v1[2]), toBurnPoolLamports: BigInt(v1[3]), toOperatorLamports: BigInt(v1[4]), tokenBurnedRaw: BigInt(v1[5]), nft: v1[6], version: "v1" };
  const v2 = /^([A-Z0-9]{2,12})\|lockfees\|wsol=(\d+)\|burnpool=(\d+)\|operator=(\d+)\|paid=(\d+)\|pending=(\d+)\|burned=(\d+)\|nft=([1-9A-HJ-NP-Za-km-z]{1,12})\|v2$/.exec(t);
  if (v2) return { prefix: v2[1], solLamports: BigInt(v2[2]), toBurnPoolLamports: BigInt(v2[3]), toOperatorLamports: BigInt(v2[4]), paidLamports: BigInt(v2[5]), pendingLamports: BigInt(v2[6]), tokenBurnedRaw: BigInt(v2[7]), nft: v2[8], version: "v2" };
  return null;
}
/** The facts part of a parsed memo (drops prefix / nft / version). */
export const factsOfMemo = (m: NonNullable<ReturnType<typeof parseLockFeesMemo>>): LockFeeClaimFacts => ({ solLamports: m.solLamports, toBurnPoolLamports: m.toBurnPoolLamports, toOperatorLamports: m.toOperatorLamports, tokenBurnedRaw: m.tokenBurnedRaw, ...(m.paidLamports !== undefined ? { paidLamports: m.paidLamports, pendingLamports: m.pendingLamports } : {}) });
/** The program's event for a claim (event_cpi). */
export interface LockFeesClaimedEvent { mint: string; pool: string; feeNftMint: string; cranker: string; wsolClaimed: bigint; toBurnPool: bigint; toOperator: bigint; tokensBurned: bigint }
export const factsOfEvent = (e: LockFeesClaimedEvent): LockFeeClaimFacts => ({ solLamports: e.wsolClaimed, toBurnPoolLamports: e.toBurnPool, toOperatorLamports: e.toOperator, tokenBurnedRaw: e.tokensBurned });

/** What the chain says about one coin's locked LP right now. */
export interface LockFeesState {
  /** False before graduation: no CPMM pool, no lock, no Fee Key yet. */
  graduated: boolean;
  pool: string | null;
  lpMint: string | null;
  /** The Fee Key NFT's mint (Raydium's locked-liquidity position), once graduated. */
  feeKey: string | null;
  /** Who holds the Fee Key NFT now — must be the fee-keys PDA. */
  feeKeyOwner: string | null;
  /** The Raydium LockedCpLiquidityState ["locked_liquidity", feeKey]. */
  lockedLiquidity: string | null;
  /** register_fee_key has run for this mint (its FeeKeyRecord ["fee_key", mint] exists). */
  feeKeyRegistered: boolean;
  /** register_pool has run (round 2, policy 0: only AFTER register_fee_key — register_pool takes the FeeKeyRecord). Optional for older ports. */
  poolRegistered?: boolean;
  /** The coin's registration policy: 0 LaunchLab migration pool, 1 fixed pool (no platform lock), 2 pair_curve. null = unknown. */
  policy?: 0 | 1 | 2 | null;
  /** The position's locker (LockedCpLiquidityState @128) and the one the program requires for this policy. */
  locker?: string | null;
  expectedLocker?: string | null;
  /** Locked LP as a share of the LP supply, percent (100 at graduation; null when not read). */
  lockedPct: number | null;
  /** Fees the lock has accrued and not yet claimed (an estimate from the pool's LP growth): SOL side (lamports) and coin side (raw). */
  accruedSolLamports: bigint;
  accruedTokenRaw: bigint;
}

/** What one confirmed claim_lock_fees moved (from the program's memo / LockFeesClaimed event, never re-guessed). */
export interface LockFeeClaimFacts {
  solLamports: bigint; toBurnPoolLamports: bigint; toOperatorLamports: bigint; tokenBurnedRaw: bigint;
  /** memo v2: the operator leg paid to the treasury in this transaction, and what stays owed after it (absent on v1 memos). */
  paidLamports?: bigint; pendingLamports?: bigint;
}

/** The per-coin port: read the lock, register the Fee Key once, build/simulate/send/confirm one claim, read what a confirmed claim did. */
export interface LockFeesPort {
  readonly mint: string;
  readonly feeKeysPda: string;
  /** `accrued: false` skips the accrual read (the pages need the addresses, not the amount; the real client simulates a claim for it). */
  state(o?: { accrued?: boolean }): Promise<LockFeesState>;
  /** Signs register_fee_key (permissionless; once per mint, after graduation). Signed, not sent. */
  buildRegisterFeeKey(): Promise<SignedTx>;
  /** Signs register_pool with the FeeKeyRecord as its last account (policy 0, round 2: after register_fee_key). Signed, not sent. */
  buildRegisterPool(): Promise<SignedTx>;
  /** Signs claim_lock_fees(u64::MAX) (the keeper pays the fee; permissionless — the cranker allowlist applies during the cap). Signed, not sent. */
  buildClaim(): Promise<SignedTx>;
  simulate(raw: Uint8Array): Promise<{ err: string | null; logs: string[] }>;
  send(raw: Uint8Array): Promise<void>;
  confirm(tx: Pick<SignedTx, "signature" | "blockhash" | "lastValidBlockHeight">): Promise<ConfirmOutcome>;
  /**
   * The amounts a confirmed claim moved, from its memo; null when not readable (yet); "none" when the transaction is readable and the
   * program wrote no claim memo (round 2: nothing claimed and nothing paid writes no memo and does not count a claim).
   */
  claimFacts(signature: string): Promise<LockFeeClaimFacts | "none" | null>;
}

/** The program-level client: one port per registered coin, plus where the operator share goes. */
export interface LockFeesClient {
  readonly programId: string;
  readonly cluster: string;
  feeKeysPda(): string;
  /** The operator treasury compiled into the program for this cluster (operatorTreasuryRecord); null while not pinned. */
  operatorTreasury(): string | null;
  port(mint: string): LockFeesPort;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The public shape (status.json `lp`, /v1 coin, .well-known, the SDK) and the receipt line
// ---------------------------------------------------------------------------------------------------------------------------------

export interface LockFeeClaimJson { at: string; signature: string; sol: string; toBurnPool: string; toOperator: string; tokenBurnedRaw: string; txUrl: string | null; line: string }
export interface LpLockJson {
  policy: typeof LP_POLICY;
  /** Raydium's LP lock program for the cluster. */
  lockProgram: string;
  /** The Fee Key NFT mint; null before graduation. */
  feeKey: string | null;
  /** The account that holds the Fee Key: the burn_receipts fee-keys PDA. */
  feeKeyOwner: string | null;
  /** Raydium's LockedCpLiquidityState for the Fee Key (["locked_liquidity", feeKey] under lockProgram); null before graduation. */
  lockedLiquidity: string | null;
  /** burn_receipts' FeeKeyRecord ["fee_key", mint] (written by register_fee_key); null when the program id is unknown. */
  feeKeyRecord: string | null;
  feeKeyRegistered: boolean;
  lockedPct: number;
  split: { burnBps: number; operatorBps: number; coinSide: "burned"; fixedInCode: true };
  operatorTreasury: string | null;
  lastClaim: LockFeeClaimJson | null;
  totals: { claims: number; sol: string; toBurnPool: string; toOperator: string; tokenBurnedRaw: string };
  urls: { lockProgram: string | null; feeKey: string | null; feeKeyOwner: string | null; lockedLiquidity: string | null; operatorTreasury: string | null };
  line: string;
  /** Plain-words state notes: not graduated yet, operator treasury not pinned on this cluster (claims refuse TreasuryNotPinned). */
  note: string | null;
  /** Round 2: the keeper's last refusal for this coin's lock steps, with the program error in plain words (null when none). */
  lastError?: { at: string; error: string; sentence: string } | null;
}

const SOL = BigInt(1_000_000_000);
/** Lamports → SOL with up to 9 decimals, trailing zeros dropped ("0.0123"). */
export function lamportsToSol(l: bigint): string {
  const neg = l < BigInt(0), a = neg ? -l : l;
  const frac = (a % SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / SOL}${frac ? `.${frac}` : ""}`;
}

const rawTokens = (raw: bigint, decimals: number): string => {
  const d = BigInt(10) ** BigInt(decimals);
  const frac = (raw % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${raw / d}${frac ? `.${frac}` : ""}`;
};

/** The receipt line for one claim (registry, status.json, the daily post): "LP fees claimed: X SOL → 80% burn pool / 20% operator; coin side burned". */
export function lockFeeClaimLine(f: LockFeeClaimFacts, decimals = 6): string {
  const coin = f.tokenBurnedRaw > BigInt(0) ? `coin side burned (${rawTokens(f.tokenBurnedRaw, decimals)} tokens)` : "coin side burned";
  const owed = f.pendingLamports !== undefined && f.pendingLamports > BigInt(0) ? `, ${lamportsToSol(f.pendingLamports)} still owed to the operator` : "";
  return `LP fees claimed: ${lamportsToSol(f.solLamports)} SOL → 80% burn pool (${lamportsToSol(f.toBurnPoolLamports)}) / 20% operator (${lamportsToSol(f.toOperatorLamports)}${owed}); ${coin}`;
}

export interface LockFeeClaimRow extends LockFeeClaimFacts { signature: string; mint: string; at: number; slot: number | null }

/** status.json's `lp` block from the lock as read (may be null: no RPC, not graduated) and the registry's recorded claims. */
export function buildLpLockJson(i: { cluster: string; mint?: string; programId?: string | null; state: LockFeesState | null; feeKeysPda: string | null; operatorTreasury: string | null; claims: readonly LockFeeClaimRow[]; explorer?: (id: string, kind: "tx" | "address") => string; lastError?: { at: number; error: string } | null }): LpLockJson {
  const ex = i.explorer ?? null;
  const url = (a: string | null, kind: "tx" | "address" = "address") => (a && ex ? ex(a, kind) : null);
  const sorted = [...i.claims].sort((a, b) => a.at - b.at);
  const last = sorted[sorted.length - 1] ?? null;
  const sum = (k: "solLamports" | "toBurnPoolLamports" | "toOperatorLamports" | "tokenBurnedRaw") => sorted.reduce((a, c) => a + c[k], BigInt(0));
  const lockProgram = lpLockProgramFor(i.cluster);
  const feeKeyOwner = i.state?.feeKeyOwner ?? i.feeKeysPda;
  const feeKey = i.state?.feeKey ?? null;
  const lockedLiquidity = i.state?.lockedLiquidity ?? (feeKey ? lockedLiquidityPda(lockProgram, feeKey).toBase58() : null);
  let feeKeyRecord: string | null = null;
  try { feeKeyRecord = i.programId && i.mint ? feeKeyRecordPda(i.programId, i.mint).toBase58() : null; } catch { feeKeyRecord = null; }
  const notes = [
    !i.state?.graduated ? "not graduated yet: the LP is locked at graduation and the Fee Key address appears then" : null,
    !i.operatorTreasury ? `the operator treasury is not pinned in this cluster's program build: claim_lock_fees refuses (${TREASURY_NOT_PINNED}) and the fees stay in the lock until it is` : null,
  ].filter((x): x is string => !!x);
  return {
    policy: LP_POLICY, lockProgram, feeKey, feeKeyOwner, lockedLiquidity, feeKeyRecord, feeKeyRegistered: !!i.state?.feeKeyRegistered, lockedPct: i.state?.lockedPct ?? LP_LOCKED_PCT,
    split: { burnBps: LOCK_FEE_BURN_BPS, operatorBps: LOCK_FEE_OPERATOR_BPS, coinSide: "burned", fixedInCode: true },
    operatorTreasury: i.operatorTreasury,
    lastClaim: last ? { at: new Date(last.at).toISOString(), signature: last.signature, sol: lamportsToSol(last.solLamports), toBurnPool: lamportsToSol(last.toBurnPoolLamports), toOperator: lamportsToSol(last.toOperatorLamports), tokenBurnedRaw: last.tokenBurnedRaw.toString(), txUrl: url(last.signature, "tx"), line: lockFeeClaimLine(last) } : null,
    totals: { claims: sorted.length, sol: lamportsToSol(sum("solLamports")), toBurnPool: lamportsToSol(sum("toBurnPoolLamports")), toOperator: lamportsToSol(sum("toOperatorLamports")), tokenBurnedRaw: sum("tokenBurnedRaw").toString() },
    urls: { lockProgram: url(lockProgram), feeKey: url(feeKey), feeKeyOwner: url(feeKeyOwner), lockedLiquidity: url(lockedLiquidity), operatorTreasury: url(i.operatorTreasury) },
    line: LP_POLICY_LINE,
    note: notes.length ? notes.join("; ") : null,
    lastError: i.lastError ? { at: new Date(i.lastError.at).toISOString(), error: i.lastError.error, sentence: lockFeeErrorSentence(i.lastError.error) } : null,
  };
}

/** A Solscan link (the token and pair pages link the lock addresses there): account or tx, with ?cluster=devnet off mainnet. */
export function solscanUrl(cluster: string, id: string, kind: "tx" | "address" = "address"): string {
  const base = `https://solscan.io/${kind === "tx" ? "tx" : "account"}/${id}`;
  return cluster === "mainnet" ? base : `${base}?cluster=${cluster === "localnet" ? "custom" : "devnet"}`;
}

/** The platform-wide LP policy block (trust page, .well-known, /v1 trust): no coin needed. */
export interface LpLockPolicyJson {
  policy: typeof LP_POLICY; line: string; lockedPct: number;
  /** Never null (2026-10-11 live check): a fixed PDA of the program id, derived from the IDL's id when BURNTICKER_PROGRAM_ID is unset. */
  lockProgram: string; lockAuthority: string; feeKeysPda: string; operatorTreasury: string | null; treasuryPinned: boolean;
  /** audit R03: who the operator treasury is, from operatorTreasuryRecord (never a hand-written "the vault") */
  operatorTreasuryHolder: string;
  /** Round 2: the LaunchLab platform compiled into the program (initialize_token refuses any other); null = not pinned (PlatformNotPinned). */
  platform: string | null; platformPinned: boolean; launchLabLocker: string;
  split: { burnBps: number; operatorBps: number; coinSide: "burned"; fixedInCode: true };
  perSwapAfterGraduationBps: { lpFees: number; toBurnPool: number; toOperator: number; creatorFeeToBurnPool: number; burnedTotal: number };
  instructions: { register: string; claim: string };
  urls: { lockProgram: string; feeKeysPda: string; operatorTreasury: string | null };
}
export function lpLockPolicyJson(cluster: string, burnProgramId: string | null): LpLockPolicyJson {
  let keys: string;
  try { keys = feeKeysPda(burnProgramId || BURN_RECEIPTS_PROGRAM_ID).toBase58(); } catch { keys = feeKeysPda(BURN_RECEIPTS_PROGRAM_ID).toBase58(); }
  const platform = burntickerPlatformFor(cluster);
  const treasury = operatorTreasuryFor(cluster), lockProgram = lpLockProgramFor(cluster);
  return {
    policy: LP_POLICY, line: LP_POLICY_LINE, lockedPct: LP_LOCKED_PCT,
    lockProgram, lockAuthority: lpLockAuthorityFor(cluster), feeKeysPda: keys, operatorTreasury: treasury, treasuryPinned: !!treasury, operatorTreasuryHolder: operatorTreasuryRecord(cluster).holder,
    platform, platformPinned: !!platform, launchLabLocker: launchLabLockerFor(cluster),
    split: { burnBps: LOCK_FEE_BURN_BPS, operatorBps: LOCK_FEE_OPERATOR_BPS, coinSide: "burned", fixedInCode: true },
    perSwapAfterGraduationBps: { lpFees: 21, toBurnPool: 16.8, toOperator: 4.2, creatorFeeToBurnPool: 4.75, burnedTotal: 21.55 },
    instructions: { register: LOCK_FEES_INTERFACE.instructions.register, claim: LOCK_FEES_INTERFACE.instructions.claim },
    urls: { lockProgram: solscanUrl(cluster, lockProgram), feeKeysPda: solscanUrl(cluster, keys), operatorTreasury: treasury ? solscanUrl(cluster, treasury) : null },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The fake (tests, and pages before the program change is deployed)
// ---------------------------------------------------------------------------------------------------------------------------------

const fakeAddr = (label: string): string => new PublicKey(crypto.createHash("sha256").update(label).digest()).toBase58();
const fakeSig = (n: number, mint: string): string => crypto.createHash("sha256").update(`lockfees|${mint}|${n}`).digest("hex");

/**
 * One coin's lock in memory, following the program's round-2 rules: graduation creates the migration pool, locks the LP under the
 * policy's LOCKER and puts the Fee Key at the fee-keys PDA. register_fee_key once (refused twice, before graduation, when the Fee Key is
 * not the program's, when the locker is not the policy's — LockerMismatch); for policy 0 register_pool needs the FeeKeyRecord first
 * (FeeKeyNotRegistered); claim_lock_fees refuses FeeKeyNotRegistered before it and TreasuryNotPinned while the cluster's treasury is
 * unset. A claim writes memo v2 — or NO memo (and counts no claim) when nothing was claimed and nothing paid; a coin-token donation
 * alone is still burned and counted. Knobs: `graduate()`, `accrue(sol, token)`, `simErr`, `failOnChain`, `dropSends` (+ `land(sig)`),
 * `feeKeyOwner`, `locker`, `skewSplit`, `policy`, `pending` (operator lamports the program reports as still owed). Claims credit
 * `onBurnPool` (FakeBurnProgram wires it into the coin's FakeProgram fee PDA); register_pool calls `onRegisterPool`.
 */
export class FakeLockFeesPort implements LockFeesPort {
  readonly mint: string;
  readonly feeKeysPda: string;
  graduated = false;
  pool: string | null = null;
  lpMint: string | null = null;
  feeKey: string | null = null;
  feeKeyOwner: string | null = null;
  locker: string | null = null;
  expectedLocker: string;
  lockedPct: number | null = null;
  feeKeyRegistered = false;
  poolRegistered = false;
  policy: 0 | 1 | 2 = 0;
  memoPrefix = "COIN";
  accruedSol = BigInt(0);
  accruedToken = BigInt(0);
  pending = BigInt(0);
  simErr: string | null = null;
  failOnChain: string | null = null;
  dropSends = false;
  skewSplit = false;
  burnPoolLamports = BigInt(0);
  operatorLamports = BigInt(0);
  tokenBurnedRaw = BigInt(0);
  claims = 0;
  sends = 0;
  registers = 0;
  poolRegisters = 0;
  private n = 0;
  private built = new Map<string, { kind: "register" } | { kind: "register-pool" } | { kind: "claim"; facts: LockFeeClaimFacts }>();
  private landed = new Map<string, { memo: string | null } | { err: string }>();
  readonly lockProgram: string;
  onRegisterPool: () => void = () => {};
  private onBurnPool: (lamports: bigint) => void;
  private treasury: () => string | null;
  constructor(mint: string, feeKeysPdaAddr: string, onBurnPool: (lamports: bigint) => void = () => {}, treasury: () => string | null = () => null, lockProgram: string = LP_LOCK_PROGRAM.localnet, expectedLocker: string = LAUNCHLAB_VAULT_AUTH.localnet.toBase58()) {
    this.mint = mint; this.feeKeysPda = feeKeysPdaAddr; this.onBurnPool = onBurnPool; this.treasury = treasury; this.lockProgram = lockProgram; this.expectedLocker = expectedLocker;
  }

  graduate(o: { pool?: string; feeKey?: string; lockedPct?: number; locker?: string } = {}): this {
    this.graduated = true;
    this.pool = o.pool ?? fakeAddr(`cpmm pool ${this.mint}`);
    this.lpMint = fakeAddr(`lp mint ${this.mint}`);
    this.feeKey = o.feeKey ?? fakeAddr(`fee key ${this.mint}`);
    this.feeKeyOwner = this.feeKeysPda;
    this.locker = o.locker ?? this.expectedLocker;
    this.lockedPct = o.lockedPct ?? LP_LOCKED_PCT;
    return this;
  }
  accrue(solLamports: bigint, tokenRaw = BigInt(0)): this { this.accruedSol += solLamports; this.accruedToken += tokenRaw; return this; }

  async state(): Promise<LockFeesState> {
    return { graduated: this.graduated, pool: this.pool, lpMint: this.lpMint, feeKey: this.feeKey, feeKeyOwner: this.feeKeyOwner, lockedLiquidity: this.feeKey ? lockedLiquidityPda(this.lockProgram, this.feeKey).toBase58() : null, feeKeyRegistered: this.feeKeyRegistered, poolRegistered: this.poolRegistered, policy: this.policy, locker: this.locker, expectedLocker: this.expectedLocker, lockedPct: this.lockedPct, accruedSolLamports: this.accruedSol, accruedTokenRaw: this.accruedToken };
  }
  private sig(kind: string): SignedTx { const signature = fakeSig(++this.n, `${kind}|${this.mint}`); return { signature, raw: new TextEncoder().encode(signature), blockhash: `bh${this.n}`, lastValidBlockHeight: 1_000 + this.n }; }
  async buildRegisterFeeKey(): Promise<SignedTx> { const tx = this.sig("register"); this.built.set(tx.signature, { kind: "register" }); return tx; }
  async buildRegisterPool(): Promise<SignedTx> { const tx = this.sig("register-pool"); this.built.set(tx.signature, { kind: "register-pool" }); return tx; }
  async buildClaim(): Promise<SignedTx> {
    const tx = this.sig("claim");
    const s = splitLockFees(this.accruedSol);
    const op = this.skewSplit ? this.accruedSol - this.accruedSol / BigInt(2) : s.operator;
    const facts: LockFeeClaimFacts = { solLamports: this.accruedSol, toBurnPoolLamports: this.accruedSol - op, toOperatorLamports: op, tokenBurnedRaw: this.accruedToken, paidLamports: op, pendingLamports: this.pending };
    this.built.set(tx.signature, { kind: "claim", facts });
    return tx;
  }
  /** The program's refusal for this transaction now, or null. */
  private refusal(sig: string): string | null {
    const b = this.built.get(sig);
    if (!b) return "unknown transaction";
    if (!this.graduated) return "PoolNotGraduated";
    if (b.kind === "register") return this.feeKeyRegistered ? "FeeKeyAlreadyRegistered" : this.feeKeyOwner !== this.feeKeysPda ? "FeeKeyNotHeldByProgram" : this.locker !== this.expectedLocker ? "LockerMismatch" : null;
    if (b.kind === "register-pool") return this.poolRegistered ? "PoolAlreadyRegistered" : this.policy === 0 && !this.feeKeyRegistered ? "FeeKeyNotRegistered" : null;
    if (!this.feeKeyRegistered) return "FeeKeyNotRegistered";
    if (!this.treasury()) return TREASURY_NOT_PINNED;
    return null;
  }
  async simulate(raw: Uint8Array): Promise<{ err: string | null; logs: string[] }> {
    const err = this.simErr ?? this.refusal(new TextDecoder().decode(raw));
    if (err) return { err, logs: [`Program log: AnchorError ${err}`] };
    return { err: null, logs: ["Program log: Instruction: ClaimLockFees"] };
  }
  async send(raw: Uint8Array): Promise<void> {
    this.sends++;
    if (this.dropSends) return;
    const sig = new TextDecoder().decode(raw);
    const b = this.built.get(sig);
    if (!b) throw new Error("unknown transaction");
    const err = this.failOnChain ?? this.refusal(sig);
    if (err) { this.landed.set(sig, { err }); return; }
    if (b.kind === "register") { this.feeKeyRegistered = true; this.registers++; this.landed.set(sig, { memo: null }); return; }
    if (b.kind === "register-pool") { this.poolRegistered = true; this.poolRegisters++; this.landed.set(sig, { memo: null }); this.onRegisterPool(); return; }
    const f = b.facts;
    // round 2: nothing claimed and nothing paid → no memo, no claims++; a coin-token donation alone is still burned and counted
    if (f.solLamports === BigInt(0) && f.tokenBurnedRaw === BigInt(0) && (f.paidLamports ?? BigInt(0)) === BigInt(0)) { this.landed.set(sig, { memo: null }); return; }
    this.claims++;
    this.landed.set(sig, { memo: formatLockFeesMemo(this.memoPrefix, f, this.feeKey!, "v2") });
    this.burnPoolLamports += f.toBurnPoolLamports;
    this.operatorLamports += f.toOperatorLamports;
    this.tokenBurnedRaw += f.tokenBurnedRaw;
    this.accruedSol -= f.solLamports;
    this.accruedToken -= f.tokenBurnedRaw;
    this.onBurnPool(f.toBurnPoolLamports);
  }
  async confirm(tx: Pick<SignedTx, "signature">): Promise<ConfirmOutcome> {
    const l = this.landed.get(tx.signature);
    if (!l) return { status: "expired" };
    if ("err" in l) return { status: "failed", err: l.err };
    return { status: "confirmed", slot: 100 + this.n };
  }
  async claimFacts(signature: string): Promise<LockFeeClaimFacts | "none" | null> {
    const l = this.landed.get(signature);
    if (!l || "err" in l) return null;
    if (!l.memo) return "none";
    const m = parseLockFeesMemo(l.memo);
    return m ? factsOfMemo(m) : "none";
  }
  /** The memo a landed claim wrote (the program's own), or null. */
  memoOf(signature: string): string | null { const l = this.landed.get(signature); return l && !("err" in l) ? l.memo : null; }
  /** Lands a dropped send later (the RPC delivered it after all). */
  land(signature: string): void { this.dropSends = false; void this.send(new TextEncoder().encode(signature)); }
}

/** The fake client: one FakeLockFeesPort per mint, created on first use. `treasury` null = not pinned (claims refuse TreasuryNotPinned). */
export class FakeLockFees implements LockFeesClient {
  readonly ports = new Map<string, FakeLockFeesPort>();
  private pda: string;
  treasury: string | null;
  readonly programId: string;
  readonly cluster: string;
  private burnPoolSink: (mint: string, lamports: bigint) => void;
  constructor(programId: string, cluster = "devnet", treasury: string | null = operatorTreasuryFor(cluster), burnPoolSink: (mint: string, lamports: bigint) => void = () => {}) {
    this.programId = programId; this.cluster = cluster; this.burnPoolSink = burnPoolSink;
    this.pda = feeKeysPda(programId).toBase58();
    this.treasury = treasury;
  }
  feeKeysPda(): string { return this.pda; }
  operatorTreasury(): string | null { return this.treasury; }
  port(mint: string): FakeLockFeesPort {
    let p = this.ports.get(mint);
    if (!p) { p = new FakeLockFeesPort(mint, this.pda, (l) => this.burnPoolSink(mint, l), () => this.treasury, lpLockProgramFor(this.cluster), launchLabLockerFor(this.cluster)); this.ports.set(mint, p); }
    return p;
  }
}
/** A stable fake address for tests and placeholder pages. */
export const fakeLockAddress = fakeAddr;
