import crypto from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import type { ConfirmOutcome, SignedTx } from "@/lib/burnKeeper/programPort";
import { LOCK_CPMM_AUTHORITY, LOCK_CPMM_PROGRAM_ID, LOCK_FEE_BURN_BPS as PROGRAM_LOCK_FEE_BURN_BPS, LOCK_FEE_OPERATOR_BPS as PROGRAM_LOCK_FEE_OPERATOR_BPS, OPERATOR_TREASURY as PROGRAM_OPERATOR_TREASURY, SEED_FEE_KEY, SEED_FEE_KEYS } from "@/lib/burnReceipts/constants";

/**
 * LP LOCKED FOREVER, ITS FEES FUND THE BURN (owner decision 2026-10-10, LAUNCHPAD-PATH §35; supersedes the 10-09 "all graduation LP
 * burned"). At graduation LaunchLab migrates the curve into a Raydium CPMM pool and LOCKS 100 % of the LP with Raydium's LP lock
 * (Burn & Earn): the LP itself can never be withdrawn by anyone; what remains is the right to the LP's trading fees, represented by a
 * Fee Key NFT. The platform config sends that Fee Key to a burn_receipts PDA (the "fee keys" PDA), so no person ever holds it. A
 * permissionless `claim_lock_fees` instruction collects the LP fees and splits them by a COMPILED constant (no admin key, no config
 * field):
 *
 *   SOL side  80 % → the coin's burn pool (its fee PDA ["fee", mint])     LOCK_FEE_BURN_BPS     8,000
 *             20 % → the operator treasury (the Squads vault)             LOCK_FEE_OPERATOR_BPS 2,000
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
  interface: "final-2026-10-10",
  builders: "bound" as "pending" | "bound",
  instructions: { register: "register_fee_key", claim: "claim_lock_fees" },
  seeds: { feeKeys: "fee_keys", feeKey: "fee_key", lockedLiquidity: "locked_liquidity", lockAuthority: "lock_cp_authority_seed", pairFeeNft: "fee_nft" },
  event: "LockFeesClaimed",
  memoTag: "lockfees",
} as const;

/** claim_lock_fees(lp_fee_amount): the keeper passes u64::MAX = "everything accrued". */
export const CLAIM_ALL_LP_FEES = BigInt("18446744073709551615");

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
 * NOT PINNED — the mainnet build carries all zeros and claim_lock_fees refuses `TreasuryNotPinned` until the owner compiles the mainnet
 * vault in; the fees stay in the lock meanwhile (a launch gate and a TODO-OWNER row). null = not pinned (the program's all-zero value).
 * Localnet = the LiteSVM suites' test treasury.
 */
const pinnedOrNull = (k: PublicKey): string | null => (k.equals(PublicKey.default) ? null : k.toBase58());
export const OPERATOR_TREASURY: Record<ClusterKey, string | null> = {
  mainnet: pinnedOrNull(PROGRAM_OPERATOR_TREASURY.mainnet),
  devnet: pinnedOrNull(PROGRAM_OPERATOR_TREASURY.devnet),
  localnet: pinnedOrNull(PROGRAM_OPERATOR_TREASURY.localnet),
};
export const operatorTreasuryFor = (cluster: string): string | null => OPERATOR_TREASURY[clusterKey(cluster)];
/** The program error a claim gets while the cluster's treasury is all zeros. */
export const TREASURY_NOT_PINNED = "TreasuryNotPinned";

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
export interface LockedCpLiquidityView { lockedLp: bigint; claimedLp: bigint; unclaimedLp: bigint; lastLp: bigint; lastK: bigint; epoch: bigint; pool: string; feeNftMint: string; owner: string; lpMint: string }
export const LOCKED_CP_LIQUIDITY_LEN = 256;
export function decodeLockedCpLiquidity(data: Uint8Array): LockedCpLiquidityView {
  if (data.length < 192) throw new Error(`LockedCpLiquidityState: ${data.length} bytes (< 192)`);
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const key = (o: number) => new PublicKey(b.subarray(o, o + 32)).toBase58();
  return { lockedLp: b.readBigUInt64LE(8), claimedLp: b.readBigUInt64LE(16), unclaimedLp: b.readBigUInt64LE(24), lastLp: b.readBigUInt64LE(32), lastK: b.readBigUInt64LE(40) + (b.readBigUInt64LE(48) << BigInt(64)), epoch: b.readBigUInt64LE(56), pool: key(64), feeNftMint: key(96), owner: key(128), lpMint: key(160) };
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
export function formatLockFeesMemo(prefix: string, f: LockFeeClaimFacts, feeNftMint: string): string {
  return `${prefix}|${LOCK_FEES_INTERFACE.memoTag}|wsol=${f.solLamports}|burnpool=${f.toBurnPoolLamports}|operator=${f.toOperatorLamports}|burned=${f.tokenBurnedRaw}|nft=${feeNftMint.slice(0, 12)}|v1`;
}
export function parseLockFeesMemo(memo: string): (LockFeeClaimFacts & { prefix: string; nft: string }) | null {
  const m = /^([A-Z0-9]{2,12})\|lockfees\|wsol=(\d+)\|burnpool=(\d+)\|operator=(\d+)\|burned=(\d+)\|nft=([1-9A-HJ-NP-Za-km-z]{1,12})\|v1$/.exec(memo.trim());
  return m ? { prefix: m[1], solLamports: BigInt(m[2]), toBurnPoolLamports: BigInt(m[3]), toOperatorLamports: BigInt(m[4]), tokenBurnedRaw: BigInt(m[5]), nft: m[6] } : null;
}
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
  /** Locked LP as a share of the LP supply, percent (100 at graduation; null when not read). */
  lockedPct: number | null;
  /** Fees the lock has accrued and not yet claimed (an estimate from the pool's LP growth): SOL side (lamports) and coin side (raw). */
  accruedSolLamports: bigint;
  accruedTokenRaw: bigint;
}

/** What one confirmed claim_lock_fees moved (from the program's memo / LockFeesClaimed event, never re-guessed). */
export interface LockFeeClaimFacts { solLamports: bigint; toBurnPoolLamports: bigint; toOperatorLamports: bigint; tokenBurnedRaw: bigint }

/** The per-coin port: read the lock, register the Fee Key once, build/simulate/send/confirm one claim, read what a confirmed claim did. */
export interface LockFeesPort {
  readonly mint: string;
  readonly feeKeysPda: string;
  /** `accrued: false` skips the accrual read (the pages need the addresses, not the amount; the real client simulates a claim for it). */
  state(o?: { accrued?: boolean }): Promise<LockFeesState>;
  /** Signs register_fee_key (permissionless; once per mint, after graduation). Signed, not sent. */
  buildRegisterFeeKey(): Promise<SignedTx>;
  /** Signs claim_lock_fees(u64::MAX) (the keeper pays the fee; permissionless — the cranker allowlist applies during the cap). Signed, not sent. */
  buildClaim(): Promise<SignedTx>;
  simulate(raw: Uint8Array): Promise<{ err: string | null; logs: string[] }>;
  send(raw: Uint8Array): Promise<void>;
  confirm(tx: Pick<SignedTx, "signature" | "blockhash" | "lastValidBlockHeight">): Promise<ConfirmOutcome>;
  /** The amounts a confirmed claim moved, from its memo / event; null when not readable (yet). */
  claimFacts(signature: string): Promise<LockFeeClaimFacts | null>;
}

/** The program-level client: one port per registered coin, plus where the operator share goes. */
export interface LockFeesClient {
  readonly programId: string;
  readonly cluster: string;
  feeKeysPda(): string;
  /** The operator treasury compiled into the program for this cluster (the Squads vault); null while not pinned (mainnet today). */
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
  return `LP fees claimed: ${lamportsToSol(f.solLamports)} SOL → 80% burn pool (${lamportsToSol(f.toBurnPoolLamports)}) / 20% operator (${lamportsToSol(f.toOperatorLamports)}); ${coin}`;
}

export interface LockFeeClaimRow extends LockFeeClaimFacts { signature: string; mint: string; at: number; slot: number | null }

/** status.json's `lp` block from the lock as read (may be null: no RPC, not graduated) and the registry's recorded claims. */
export function buildLpLockJson(i: { cluster: string; mint?: string; programId?: string | null; state: LockFeesState | null; feeKeysPda: string | null; operatorTreasury: string | null; claims: readonly LockFeeClaimRow[]; explorer?: (id: string, kind: "tx" | "address") => string }): LpLockJson {
  const ex = i.explorer ?? null;
  const url = (a: string | null, kind: "tx" | "address" = "address") => (a && ex ? ex(a, kind) : null);
  const sorted = [...i.claims].sort((a, b) => a.at - b.at);
  const last = sorted[sorted.length - 1] ?? null;
  const sum = (k: keyof LockFeeClaimFacts) => sorted.reduce((a, c) => a + c[k], BigInt(0));
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
  lockProgram: string; lockAuthority: string; feeKeysPda: string | null; operatorTreasury: string | null; treasuryPinned: boolean;
  split: { burnBps: number; operatorBps: number; coinSide: "burned"; fixedInCode: true };
  perSwapAfterGraduationBps: { lpFees: number; toBurnPool: number; toOperator: number; creatorFeeToBurnPool: number; burnedTotal: number };
  instructions: { register: string; claim: string };
  urls: { lockProgram: string; feeKeysPda: string | null; operatorTreasury: string | null };
}
export function lpLockPolicyJson(cluster: string, burnProgramId: string | null): LpLockPolicyJson {
  let keys: string | null = null;
  try { keys = burnProgramId ? feeKeysPda(burnProgramId).toBase58() : null; } catch { keys = null; }
  const treasury = operatorTreasuryFor(cluster), lockProgram = lpLockProgramFor(cluster);
  return {
    policy: LP_POLICY, line: LP_POLICY_LINE, lockedPct: LP_LOCKED_PCT,
    lockProgram, lockAuthority: lpLockAuthorityFor(cluster), feeKeysPda: keys, operatorTreasury: treasury, treasuryPinned: !!treasury,
    split: { burnBps: LOCK_FEE_BURN_BPS, operatorBps: LOCK_FEE_OPERATOR_BPS, coinSide: "burned", fixedInCode: true },
    perSwapAfterGraduationBps: { lpFees: 21, toBurnPool: 16.8, toOperator: 4.2, creatorFeeToBurnPool: 4.75, burnedTotal: 21.55 },
    instructions: { register: LOCK_FEES_INTERFACE.instructions.register, claim: LOCK_FEES_INTERFACE.instructions.claim },
    urls: { lockProgram: solscanUrl(cluster, lockProgram), feeKeysPda: keys ? solscanUrl(cluster, keys) : null, operatorTreasury: treasury ? solscanUrl(cluster, treasury) : null },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The fake (tests, and pages before the program change is deployed)
// ---------------------------------------------------------------------------------------------------------------------------------

const fakeAddr = (label: string): string => new PublicKey(crypto.createHash("sha256").update(label).digest()).toBase58();
const fakeSig = (n: number, mint: string): string => crypto.createHash("sha256").update(`lockfees|${mint}|${n}`).digest("hex");

/**
 * One coin's lock in memory, following the program's rules: graduation locks the LP and puts the Fee Key at the fee-keys PDA;
 * register_fee_key once (refused twice, refused before graduation); claim_lock_fees refuses `FeeKeyNotRegistered` before it and
 * `TreasuryNotPinned` while the cluster's treasury is unset; a claim writes the program's memo, from which `claimFacts` reads the
 * amounts. Knobs: `graduate()`, `accrue(sol, token)`, `simErr` (the next simulations refuse with this name), `failOnChain` (the next
 * send lands as a failure), `dropSends` (sends vanish: confirm says expired; `land(sig)` delivers later), `feeKeyOwner` (move the Fee
 * Key elsewhere — the keeper must alarm), `skewSplit` (the program pays a different split — the keeper must alarm). Claims credit
 * `onBurnPool` (FakeBurnProgram wires it into the coin's FakeProgram fee PDA) and the totals below.
 */
export class FakeLockFeesPort implements LockFeesPort {
  readonly mint: string;
  readonly feeKeysPda: string;
  graduated = false;
  pool: string | null = null;
  lpMint: string | null = null;
  feeKey: string | null = null;
  feeKeyOwner: string | null = null;
  lockedPct: number | null = null;
  feeKeyRegistered = false;
  memoPrefix = "COIN";
  accruedSol = BigInt(0);
  accruedToken = BigInt(0);
  simErr: string | null = null;
  failOnChain: string | null = null;
  dropSends = false;
  skewSplit = false;
  burnPoolLamports = BigInt(0);
  operatorLamports = BigInt(0);
  tokenBurnedRaw = BigInt(0);
  sends = 0;
  registers = 0;
  private n = 0;
  private built = new Map<string, { kind: "register" } | { kind: "claim"; facts: LockFeeClaimFacts }>();
  private landed = new Map<string, { memo: string | null } | { err: string }>();
  readonly lockProgram: string;
  private onBurnPool: (lamports: bigint) => void;
  private treasury: () => string | null;
  constructor(mint: string, feeKeysPdaAddr: string, onBurnPool: (lamports: bigint) => void = () => {}, treasury: () => string | null = () => null, lockProgram: string = LP_LOCK_PROGRAM.localnet) {
    this.mint = mint; this.feeKeysPda = feeKeysPdaAddr; this.onBurnPool = onBurnPool; this.treasury = treasury; this.lockProgram = lockProgram;
  }

  graduate(o: { pool?: string; feeKey?: string; lockedPct?: number } = {}): this {
    this.graduated = true;
    this.pool = o.pool ?? fakeAddr(`cpmm pool ${this.mint}`);
    this.lpMint = fakeAddr(`lp mint ${this.mint}`);
    this.feeKey = o.feeKey ?? fakeAddr(`fee key ${this.mint}`);
    this.feeKeyOwner = this.feeKeysPda;
    this.lockedPct = o.lockedPct ?? LP_LOCKED_PCT;
    return this;
  }
  accrue(solLamports: bigint, tokenRaw = BigInt(0)): this { this.accruedSol += solLamports; this.accruedToken += tokenRaw; return this; }

  async state(): Promise<LockFeesState> {
    return { graduated: this.graduated, pool: this.pool, lpMint: this.lpMint, feeKey: this.feeKey, feeKeyOwner: this.feeKeyOwner, lockedLiquidity: this.feeKey ? lockedLiquidityPda(this.lockProgram, this.feeKey).toBase58() : null, feeKeyRegistered: this.feeKeyRegistered, lockedPct: this.lockedPct, accruedSolLamports: this.accruedSol, accruedTokenRaw: this.accruedToken };
  }
  private sig(kind: string): SignedTx { const signature = fakeSig(++this.n, `${kind}|${this.mint}`); return { signature, raw: new TextEncoder().encode(signature), blockhash: `bh${this.n}`, lastValidBlockHeight: 1_000 + this.n }; }
  async buildRegisterFeeKey(): Promise<SignedTx> {
    const tx = this.sig("register");
    this.built.set(tx.signature, { kind: "register" });
    return tx;
  }
  async buildClaim(): Promise<SignedTx> {
    const tx = this.sig("claim");
    const s = splitLockFees(this.accruedSol);
    const facts: LockFeeClaimFacts = this.skewSplit ? { solLamports: this.accruedSol, toBurnPoolLamports: this.accruedSol / BigInt(2), toOperatorLamports: this.accruedSol - this.accruedSol / BigInt(2), tokenBurnedRaw: this.accruedToken } : { solLamports: this.accruedSol, toBurnPoolLamports: s.burnPool, toOperatorLamports: s.operator, tokenBurnedRaw: this.accruedToken };
    this.built.set(tx.signature, { kind: "claim", facts });
    return tx;
  }
  /** The program's refusal for this transaction now, or null. */
  private refusal(sig: string): string | null {
    const b = this.built.get(sig);
    if (!b) return "unknown transaction";
    if (!this.graduated) return "PoolNotGraduated";
    if (b.kind === "register") return this.feeKeyRegistered ? "FeeKeyAlreadyRegistered" : this.feeKeyOwner !== this.feeKeysPda ? "FeeKeyNotHeldByProgram" : null;
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
    const f = b.facts;
    this.landed.set(sig, { memo: formatLockFeesMemo(this.memoPrefix, f, this.feeKey!) });
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
  async claimFacts(signature: string): Promise<LockFeeClaimFacts | null> {
    const l = this.landed.get(signature);
    if (!l || "err" in l || !l.memo) return null;
    const m = parseLockFeesMemo(l.memo);
    return m ? { solLamports: m.solLamports, toBurnPoolLamports: m.toBurnPoolLamports, toOperatorLamports: m.toOperatorLamports, tokenBurnedRaw: m.tokenBurnedRaw } : null;
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
    if (!p) { p = new FakeLockFeesPort(mint, this.pda, (l) => this.burnPoolSink(mint, l), () => this.treasury, lpLockProgramFor(this.cluster)); this.ports.set(mint, p); }
    return p;
  }
}
/** A stable fake address for tests and placeholder pages. */
export const fakeLockAddress = fakeAddr;
