import { executableHash, loadVerifiedBuild, type VerifiedBuild } from "@/lib/burnticker/trustpack/verifiedBuild";
import fs from "node:fs";
import path from "node:path";
import { dispersalDecision, type DispersalDecision } from "@/lib/burnticker/dispersal";

/**
 * THE BURN PROGRAM'S HASH, FROM ONE RECORD (prelaunch audit 2026-10-18 A-4). The trust page printed the host's BURNTICKER_PROGRAM_HASH,
 * which on the mainnet box was still the round-3 build, and told the visitor to compare the chain against it. The hash a visitor reads
 * now comes from config/burnticker/verified-build.json for the cluster (the read-back of the deployed bytes). The environment value is
 * shown only when it equals that record; a different value is ignored and logged once (by name, never by value).
 *
 * The keeper's daily check (`readProgramDataHash`, `compareProgramToRecord`) reads the program's ProgramData account and compares its
 * executable hash and deploy slot with the same record; a difference raises bt-audit-mismatch, which is pushed to the owner's phone.
 */

export type Cluster = "mainnet" | "devnet";
export const PROGRAM_HASH_ENV = "BURNTICKER_PROGRAM_HASH";
export interface ProgramHashFact {
  cluster: Cluster; programId: string | null; hash: string | null; slot: number | null;
  /** the burn program round deployed on the cluster (the record's `round`), null when not recorded */
  round: number | null;
  /** where `hash` came from: the verified-build record, or nothing (no record for this cluster) */
  source: "verified-build" | "none";
  /** the host's BURNTICKER_PROGRAM_HASH: not set, equal to the record (shown), or different (ignored) */
  hostValue: "unset" | "equal" | "ignored";
}

const asCluster = (c: string | undefined | null): Cluster => ((c ?? "").trim() === "mainnet" ? "mainnet" : "devnet");
let warned = false;
/** Test hook: forget that the ignored-env line was logged. */
export function resetProgramHashWarning(): void { warned = false; }

/** The burn program's hash and slot for the cluster, from the record; the env value only when it equals it. */
export function programHashFact(env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd(), o: { vb?: VerifiedBuild | null; log?: (s: string) => void } = {}): ProgramHashFact {
  const cluster = asCluster(env.BURNTICKER_CLUSTER);
  let vb: VerifiedBuild | null = o.vb ?? null;
  if (o.vb === undefined) { try { vb = loadVerifiedBuild(root); } catch { vb = null; } }
  const p = vb?.programs.find((x) => x.library === "burn_receipts") ?? null;
  const dep = p?.deployed[cluster] ?? null;
  const hash = dep?.hash ?? null;
  const raw = (env[PROGRAM_HASH_ENV] ?? "").trim().toLowerCase();
  const envState: ProgramHashFact["hostValue"] = !raw ? "unset" : hash && raw === hash ? "equal" : "ignored";
  if (envState === "ignored" && !warned) {
    warned = true;
    (o.log ?? ((s: string) => console.warn(s)))(`[trust] ${PROGRAM_HASH_ENV} on this host does not equal the ${cluster} hash in config/burnticker/verified-build.json, so it is ignored. Remove it from the host's environment.`);
  }
  return { cluster, programId: p?.programId ?? null, hash, round: dep && typeof p?.round === "number" ? p.round : null, slot: typeof dep?.slot === "number" ? dep.slot : null, source: hash ? "verified-build" : "none", hostValue: envState };
}

/** One line for ops.json: where the program hash on the trust page comes from. */
export function programHashSourceLine(f: ProgramHashFact): string {
  const base = f.hash ? `program hash: from config/burnticker/verified-build.json (${f.cluster}, ${f.hash.slice(0, 8)}…${f.slot !== null ? `, slot ${f.slot}` : ""})` : `program hash: none recorded for ${f.cluster} in config/burnticker/verified-build.json`;
  return `${base}${f.hostValue === "ignored" ? `; ${PROGRAM_HASH_ENV} on this host differs and is ignored (remove it)` : f.hostValue === "equal" ? `; ${PROGRAM_HASH_ENV} on this host equals it` : ""}`;
}

/**
 * The burn program round this host runs against: the record's round for the cluster, when the host's BURNTICKER_PROGRAM_ID (if set)
 * is that program; null on localnet or for another program id.
 */
export function hostProgramRound(env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd(), o: { vb?: VerifiedBuild | null } = {}): number | null {
  if ((env.BURNTICKER_CLUSTER ?? "").trim() === "localnet") return null;
  const f = programHashFact(env, root, { vb: o.vb, log: () => {} });
  const id = (env.BURNTICKER_PROGRAM_ID ?? "").trim();
  return id && f.programId && id !== f.programId ? null : f.round;
}
/** Burn dispersal as this host decides it (prelaunch audit 2026-10-18 A-1): the keeper and the web read the same decision. */
export function hostDispersal(env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd(), o: { vb?: VerifiedBuild | null } = {}): DispersalDecision {
  return dispersalDecision(env, hostProgramRound(env, root, o));
}
/** The web routes' decision: the keeper's record when present, else hostDispersal (review 5 of A-1). */
export const webDispersalOn = (env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd()): boolean => webDispersal(env, root).on;

/**
 * Where the platform keeper records its dispersal decision at start (review 5 of A-1): beside the registry (BURNTICKER_DB, which the keeper
 * and the web units both set), so a test keeper with a temporary registry never writes into the checkout's ./data.
 */
export const KEEPER_DISPERSAL_NAME = "keeper-dispersal.json";
export const keeperDispersalFile = (env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd()): string => path.resolve(root, path.dirname((env.BURNTICKER_DB ?? "").trim() || path.join("data", "burnticker.db")), KEEPER_DISPERSAL_NAME);
export function writeKeeperDispersal(d: DispersalDecision, env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd(), now = Date.now()): void {
  const f = keeperDispersalFile(env, root);
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${JSON.stringify({ ...d, at: new Date(now).toISOString() })}\n`); } catch { /* the web then applies the rule itself */ }
}
/**
 * The web launcher's decision (review 5 of A-1): the platform keeper's recorded decision when this host has one, because the keeper is
 * what spends the carried amounts and its unit's BURNTICKER_DISPERSAL=1 beats the local env file the web reads; otherwise the same rule
 * applied to the web's own environment (unset is on for a round-5 program).
 */
export function webDispersal(env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd(), o: { vb?: VerifiedBuild | null } = {}): DispersalDecision & { follows: "keeper" | "own-env" } {
  try {
    const j = JSON.parse(fs.readFileSync(keeperDispersalFile(env, root), "utf8")) as Partial<DispersalDecision>;
    if (typeof j.on === "boolean" && typeof j.source === "string") return { on: j.on, source: j.source as DispersalDecision["source"], crankCarried: !!j.crankCarried, follows: "keeper" };
  } catch { /* no record on this host */ }
  return { ...dispersalDecision(env, hostProgramRound(env, root, o)), follows: "own-env" };
}

// ---- the daily chain check ----

/** A ProgramData account: u32 tag 3, u64 slot, Option<Pubkey> upgrade authority (1 + 32 bytes), then the program bytes. */
export const PROGRAM_DATA_HEADER = 45;
export interface ChainProgram { hash: string; slot: number; programData: string }
/** The minimum the check needs from a connection: raw account bytes by address. */
export interface AccountBytesReader { accountBytes(address: string): Promise<Uint8Array | null> }

const readU32 = (b: Uint8Array, at: number): number => new DataView(b.buffer, b.byteOffset + at, 4).getUint32(0, true);
/** Reads the program account, then its ProgramData: the executable hash of the program bytes and the deploy slot. Null when absent. */
export async function readProgramDataHash(r: AccountBytesReader, programId: string, toBase58: (b: Uint8Array) => string): Promise<ChainProgram | null> {
  const prog = await r.accountBytes(programId);
  if (!prog || prog.length < 36 || readU32(prog, 0) !== 2) return null;
  const programData = toBase58(prog.subarray(4, 36));
  const pd = await r.accountBytes(programData);
  if (!pd || pd.length < PROGRAM_DATA_HEADER || readU32(pd, 0) !== 3) return null;
  const slot = Number(new DataView(pd.buffer, pd.byteOffset + 4, 8).getBigUint64(0, true));
  return { hash: executableHash(pd.subarray(PROGRAM_DATA_HEADER)), slot, programData };
}

/**
 * Null when the chain equals the record; otherwise the sentence the alert carries. A read that gave nothing (null) is not a difference:
 * the caller retries it and raises nothing (review 2 of A-4, 2026-10-18).
 */
export function compareProgramToRecord(record: ProgramHashFact, chain: ChainProgram): string | null {
  if (!record.hash) return null;
  const out: string[] = [];
  if (chain.hash !== record.hash) out.push(`its hash on chain is ${chain.hash}, and the record says ${record.hash}`);
  if (record.slot !== null && chain.slot !== record.slot) out.push(`it was deployed at slot ${chain.slot}, and the record says slot ${record.slot}`);
  return out.length ? `The burn program on ${record.cluster} does not match config/burnticker/verified-build.json: ${out.join("; ")}. The trust pages name the recorded build until someone updates the record.` : null;
}

// ---- which register_fee_key account list the deployed program reads (B-17) ----

/** The pre-B17 hashes live in the client-safe deployedTierPin.ts (one list for the keeper and the public fee copy). */
export { PRE_B17_PROGRAM_HASHES } from "@/lib/burnticker/deployedTierPin";
import { PRE_B17_PROGRAM_HASHES } from "@/lib/burnticker/deployedTierPin";

/**
 * True when register_fee_key may carry the launchlab_pool account: the program's hash on chain equals the B-17 build's, which is the
 * build recorded for the cluster in config/burnticker/verified-build.json once that table is updated for the B-17 upgrade, and is not a
 * pre-B17 hash. Anything else (a pre-B17 program, a read that gave nothing, a hash nobody recorded) sends the round-5 list. Localnet
 * always runs the checkout's own build, so it always gets the account.
 */
export function registerFeeKeyLaunchlabSlot(chainHash: string | null, cluster: Cluster | "localnet", vb: VerifiedBuild | null): boolean {
  if (cluster === "localnet") return true;
  if (!chainHash || PRE_B17_PROGRAM_HASHES.has(chainHash)) return false;
  const built = vb?.programs.find((p) => p.library === "burn_receipts")?.builds[cluster]?.hash ?? null;
  return built === chainHash;
}

/** registerFeeKeyLaunchlabSlot with the hash read from chain (readProgramDataHash); a failed read sends the round-5 list. */
export async function registerFeeKeyLaunchlabSlotOnChain(r: AccountBytesReader, programId: string, cluster: Cluster | "localnet", toBase58: (b: Uint8Array) => string, o: { vb?: VerifiedBuild | null; root?: string } = {}): Promise<boolean> {
  if (cluster === "localnet") return true;
  let vb: VerifiedBuild | null = o.vb ?? null;
  if (o.vb === undefined) { try { vb = loadVerifiedBuild(o.root ?? process.cwd()); } catch { vb = null; } }
  let chain: ChainProgram | null = null;
  try { chain = await readProgramDataHash(r, programId, toBase58); } catch { chain = null; }
  return registerFeeKeyLaunchlabSlot(chain?.hash ?? null, cluster, vb);
}
