import { PublicKey } from "@solana/web3.js";
import type { Rpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { launchLabProgramFor } from "@/lib/burnKeeper/launchlab";
import { PROGRAM_IDS, type Network } from "@/lib/burnticker/networks";
import { rpcErrorText } from "@/lib/burnticker/market";

/**
 * A COIN'S THREE DATES, READ FROM THE CHAIN (indexer-1, 2026-10-12; PLATFORM-NEXT-2 item 4). The activity rows and the progress steps
 * said "This site does not read the date" for graduations and pool registrations; these are the reads:
 *
 *   created     the block time of the coin's create transaction (the registry's launchTx), checked: it succeeded, it names the mint,
 *               and LaunchLab ran an Initialize instruction in it
 *   graduated   the block time of LaunchLab's MigrateToCpswap (or MigrateToAmm) on the coin's curve pool
 *   registered  the block time of the burn program's RegisterPool for this mint
 *
 * Migration and registration both touch the curve pool (register_pool passes it as `launchlab_pool`), and after graduation the pool
 * sees almost no traffic, so one getSignaturesForAddress on the curve pool, newest first, finds both near the top. Failed transactions
 * are skipped without fetching them. Each kept signature is fetched (getTransaction, json) and classified by its program logs, which
 * name the program that ran each instruction. The walk stops at the migration: register_pool can only come after it, so if no
 * RegisterPool was found among the newer transactions, the chain shows none ("none", a fact), not "unavailable".
 *
 * Three states per date, never collapsed: "read" (with the signature, slot and time), "none" (the chain or the caller's own phase says
 * it has not happened) and "unavailable" (a read failed, a limit was reached, or a record did not check out; the reason says which).
 * Cached: a fully read set for a day (block times are final), otherwise ten minutes, and one minute when a read failed. Server-only.
 */

export type DateRead =
  | { state: "read"; at: string; blockTime: number; slot: number; signature: string }
  | { state: "none"; reason: string }
  | { state: "unavailable"; reason: string };
export interface LifecycleDates { created: DateRead; graduated: DateRead; registered: DateRead; readAt: string }

export interface LifecycleInput {
  network: Network; mint: string;
  /** the registry's create signature (TokenRow.launchTx) */
  launchTx: string | null;
  /** the LaunchLab curve pool (TokenRow.poolId) */
  curvePool: string | null;
  /** the curve phase read this cycle, when known: "curve" means neither later date has happened */
  phase?: "curve" | "migrating" | "graduated" | null;
  /** the burn program's own answer, when known (status.json program.pool.registered): false means no registration yet */
  poolRegistered?: boolean | null;
  /** defaults to the canonical burn_receipts program of the network */
  burnProgram?: string;
}

export const LIFECYCLE_LIMITS = { signaturesPerPage: 100, maxSignatures: 300, maxTransactions: 20 } as const;
export const LIFECYCLE_CACHE_MS = { complete: 24 * 3_600_000, partial: 10 * 60_000, failed: 60_000 } as const;

// ---------------------------------------------------------------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------------------------------------------------------------

/** Which program ran which instruction, from a transaction's log lines ("Program X invoke [n]" … "Program log: Instruction: Y"). */
export function instructionsFromLogs(logs: readonly string[]): { program: string; name: string; depth: number }[] {
  const stack: string[] = [], out: { program: string; name: string; depth: number }[] = [];
  for (const l of logs) {
    let m = /^Program (\w{32,44}) invoke \[(\d+)\]$/.exec(l);
    if (m) { stack.length = Number(m[2]) - 1; stack.push(m[1]); continue; }
    m = /^Program (\w{32,44}) (success|failed.*)$/.exec(l);
    if (m) { if (stack[stack.length - 1] === m[1]) stack.pop(); continue; }
    m = /^Program log: Instruction: (\w+)$/.exec(l);
    if (m && stack.length) out.push({ program: stack[stack.length - 1], name: m[1], depth: stack.length });
  }
  return out;
}

/** The parts of a getTransaction (json) result this module reads; null when the answer is not a transaction. */
export interface TxView { slot: number; blockTime: number | null; err: unknown; logs: string[]; keys: Set<string> }
export function txView(r: unknown): TxView | null {
  if (!isObj(r) || typeof r.slot !== "number" || !isObj(r.meta) || !isObj(r.transaction) || !isObj(r.transaction.message)) return null;
  const logs = r.meta.logMessages;
  if (!Array.isArray(logs) || !logs.every((l) => typeof l === "string")) return null;
  const keys = new Set<string>();
  const ak = r.transaction.message.accountKeys;
  if (!Array.isArray(ak)) return null;
  for (const k of ak) { const s = typeof k === "string" ? k : isObj(k) && typeof k.pubkey === "string" ? k.pubkey : null; if (s) keys.add(s); }
  const la = r.meta.loadedAddresses;
  if (isObj(la)) for (const side of [la.writable, la.readonly]) if (Array.isArray(side)) for (const k of side) if (typeof k === "string") keys.add(k);
  return { slot: r.slot, blockTime: typeof r.blockTime === "number" ? r.blockTime : null, err: r.meta.err ?? null, logs: logs as string[], keys };
}

export type TxKind = "create" | "migrate" | "register" | "other";
/** What a transaction did to this coin, judged by its logs and its account keys. */
export function classifyTx(t: TxView, i: { mint: string; curvePool: string | null; launchLab: string; burnProgram: string }): TxKind {
  const ix = instructionsFromLogs(t.logs);
  if (ix.some((x) => x.program === i.launchLab && /^MigrateTo(Cpswap|Amm)$/.test(x.name)) && (!i.curvePool || t.keys.has(i.curvePool))) return "migrate";
  if (ix.some((x) => x.program === i.burnProgram && x.name === "RegisterPool") && t.keys.has(i.mint)) return "register";
  if (ix.some((x) => x.program === i.launchLab && /^Initialize/.test(x.name)) && t.keys.has(i.mint)) return "create";
  return "other";
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const readOf = (t: TxView, signature: string): DateRead => (t.blockTime === null ? { state: "unavailable", reason: "The RPC returned the transaction without a block time." } : { state: "read", at: new Date(t.blockTime * 1000).toISOString(), blockTime: t.blockTime, slot: t.slot, signature });

// ---------------------------------------------------------------------------------------------------------------------------------
// The reads
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * getTransaction that copes with newer transaction versions: it asks for version 0 and, when the RPC answers that the transaction is a
 * later version, asks again with the version the RPC names. Null when the RPC has no record of the signature.
 */
export async function fetchTx(rpc: Rpc, signature: string): Promise<TxView | null> {
  let version = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await rpc.call<unknown>("getTransaction", [signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: version }]);
      if (r === null) return null;
      const t = txView(r);
      if (!t) throw new Error("getTransaction: the answer was not a transaction");
      return t;
    } catch (e) {
      const m = /Transaction version \((\d+)\) is not supported/.exec(e instanceof Error ? e.message : "");
      if (m && attempt === 0) { version = Number(m[1]); continue; }
      throw e;
    }
  }
  throw new Error("getTransaction: the transaction version could not be agreed");
}

async function readCreated(rpc: Rpc, i: LifecycleInput, launchLab: string, burnProgram: string): Promise<DateRead> {
  if (!i.launchTx) return { state: "unavailable", reason: "The registry has no create transaction for this coin." };
  try {
    const t = await fetchTx(rpc, i.launchTx);
    if (!t) return { state: "unavailable", reason: "The RPC has no record of the create transaction." };
    if (t.err !== null) return { state: "unavailable", reason: "The create transaction failed on chain." };
    if (classifyTx(t, { mint: i.mint, curvePool: i.curvePool, launchLab, burnProgram }) !== "create") return { state: "unavailable", reason: "The registry's create transaction does not create this coin on LaunchLab." };
    return readOf(t, i.launchTx);
  } catch (e) { return { state: "unavailable", reason: `The create transaction could not be read (${rpcErrorText(e)}).` }; }
}

async function readGraduationAndRegistration(rpc: Rpc, i: LifecycleInput, launchLab: string, burnProgram: string): Promise<{ graduated: DateRead; registered: DateRead }> {
  const un = (reason: string) => ({ state: "unavailable", reason }) as const;
  if (i.phase === "curve") return { graduated: { state: "none", reason: "The coin is still on its bonding curve." }, registered: { state: "none", reason: "A pool is registered only after the coin graduates." } };
  if (!i.curvePool) return { graduated: un("This coin has no curve pool on record."), registered: un("This coin has no curve pool on record.") };
  try { new PublicKey(i.curvePool); } catch { return { graduated: un("The curve pool on record is not an address."), registered: un("The curve pool on record is not an address.") }; }
  const ctx = { mint: i.mint, curvePool: i.curvePool, launchLab, burnProgram };
  let registered: DateRead | null = null, before: string | undefined, scanned = 0, fetched = 0, gaps = 0;
  // "none" is a claim about every transaction in the walk; one the RPC could not return makes it "unavailable" instead
  const noneOr = (reason: string): DateRead => (gaps ? un(`${gaps === 1 ? "One transaction" : `${gaps} transactions`} on the curve pool could not be read, so this site cannot say.`) : { state: "none", reason });
  try {
    for (;;) {
      const page = await rpc.call<unknown>("getSignaturesForAddress", [i.curvePool, { limit: LIFECYCLE_LIMITS.signaturesPerPage, commitment: "confirmed", ...(before ? { before } : {}) }]);
      if (!Array.isArray(page)) return { graduated: un("The RPC's signature list for the curve pool was not a list."), registered: registered ?? un("The RPC's signature list for the curve pool was not a list.") };
      // HB-145 second half: the walk stays one transaction at a time on purpose. It stops at the migration (most walks fetch one or two
      // transactions), so reading ahead would spend reads past that point on every walk, and each read waits on the same rate budget
      // whether it runs alone or beside others. The builds no longer wait for a walk (boundedReads.ts); it fills the cache behind them.
      for (const s of page as unknown[]) {
        if (!isObj(s) || typeof s.signature !== "string") return { graduated: un("The RPC's signature list held an entry without a signature."), registered: registered ?? un("The RPC's signature list held an entry without a signature.") };
        scanned++; before = s.signature;
        if (s.err !== null && s.err !== undefined) continue; // a failed transaction changed nothing
        if (fetched >= LIFECYCLE_LIMITS.maxTransactions) return limitHit(registered);
        fetched++;
        const t = await fetchTx(rpc, s.signature);
        if (!t) { gaps++; continue; }
        if (t.err !== null) continue;
        const kind = classifyTx(t, ctx);
        if (kind === "register") registered = readOf(t, s.signature); // walking back in time: the earliest registration wins
        else if (kind === "migrate") {
          const graduated = readOf(t, s.signature);
          return { graduated, registered: registered ?? (i.poolRegistered === true ? un("The burn program reports the pool registered, but its RegisterPool transaction was not found on the curve pool.") : noneOr("The chain shows no pool registration for this coin since it graduated.")) };
        }
      }
      if (page.length < LIFECYCLE_LIMITS.signaturesPerPage) {
        // the whole history was read and there is no migration in it
        return { graduated: i.phase === "graduated" ? un("The curve pool's history holds no migration transaction.") : noneOr("The curve pool's history holds no migration, so the coin has not graduated."), registered: registered ?? noneOr("A pool is registered only after the coin graduates.") };
      }
      if (scanned >= LIFECYCLE_LIMITS.maxSignatures) return limitHit(registered);
    }
  } catch (e) {
    const reason = `The curve pool's transactions could not be read (${rpcErrorText(e)}).`;
    return { graduated: un(reason), registered: registered ?? un(reason) };
  }
}
function limitHit(registered: DateRead | null): { graduated: DateRead; registered: DateRead } {
  const reason = "The migration was not among the curve pool's most recent transactions, and this site stops searching there.";
  return { graduated: { state: "unavailable", reason }, registered: registered ?? { state: "unavailable", reason } };
}

const cache = new Map<string, { at: number; v: LifecycleDates }>();
/** For tests. */
export function clearLifecycleCache(): void { cache.clear(); inflight.clear(); }
const ttlOf = (v: LifecycleDates) => {
  const s = [v.created, v.graduated, v.registered].map((d) => d.state);
  return s.every((x) => x === "read") ? LIFECYCLE_CACHE_MS.complete : s.includes("unavailable") ? LIFECYCLE_CACHE_MS.failed : LIFECYCLE_CACHE_MS.partial;
};

/** A registered coin's create, graduation and pool-registration times from the chain. Never throws. */
export async function readLifecycleDates(rpc: Rpc, i: LifecycleInput, now = Date.now()): Promise<LifecycleDates> {
  const ck = [i.network, i.mint, i.launchTx ?? "", i.curvePool ?? "", i.phase ?? "", String(i.poolRegistered ?? "")].join(":");
  const hit = cache.get(ck);
  if (hit && now - hit.at < ttlOf(hit.v)) return hit.v;
  // HB-145 second half: one walk per coin at a time; a second caller (the next build, the coin page) joins the walk in flight
  const running = inflight.get(ck);
  if (running) return running;
  const launchLab = launchLabProgramFor(i.network)?.toBase58() ?? "";
  const burnProgram = i.burnProgram ?? PROGRAM_IDS[i.network].burn_receipts;
  // the create read and the walk do not depend on each other: they run together
  const p = Promise.all([readCreated(rpc, i, launchLab, burnProgram), readGraduationAndRegistration(rpc, i, launchLab, burnProgram)]).then(([created, later]) => {
    const v: LifecycleDates = { created, ...later, readAt: new Date(now).toISOString() };
    cache.set(ck, { at: now, v });
    return v;
  }).finally(() => { if (inflight.get(ck) === p) inflight.delete(ck); });
  inflight.set(ck, p);
  return p;
}
const inflight = new Map<string, Promise<LifecycleDates>>();
