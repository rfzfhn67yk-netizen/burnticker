import { fetchBody, type HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { BudgetHoldError } from "@/lib/burnticker/apiBudget";

/**
 * FRESH READINGS (owner's devnet check 2026-10-19). Pressing Launch on an earthquake coin answered "usgs.quakes:6 could not be read just
 * now … the request rate budget is full" twice in a row: the web's share of a house-default host allows one read about every half
 * minute, and the coin's source had been read seconds before. A launch-path read of a catalogue source goes through this memo: a body
 * read for the same selector within FRESH_READING_MS is served from memory (no HTTP request, no budget spent); an older or missing one
 * is read once, as before, and remembered. The keeper never reads through it (it settles on its own reads).
 *
 * A read the request budget refuses as busy waits for the bucket when the wait is short (at most HOLD_WAIT_MAX_MS) and is tried once more;
 * past that the refusal says how long to wait (busyRetryText). A day hold is never waited on.
 */

/** How long a reading stays fresh for the launch path. */
export const FRESH_READING_MS = 5 * 60_000;
/** The longest the launch path waits for a busy rate bucket before it refuses with the time to wait. */
export const HOLD_WAIT_MAX_MS = 15_000;
const MAX_ENTRIES = 500;

interface Entry { body: unknown; fetchedAt: number }
/** Per reader (the fetch the read went through: the server's global fetch in production, each test's own fake), per selector. */
let memos = new WeakMap<object, Map<string, Entry>>();
const memoOf = (reader: FetchLike): Map<string, Entry> => {
  let m = memos.get(reader);
  if (!m) { m = new Map(); memos.set(reader, m); }
  return m;
};

/** The reading remembered for `selector` through `reader` if it was fetched within FRESH_READING_MS of `now`. */
export function freshReading(reader: FetchLike, selector: string, now: number): Entry | null {
  const e = memoOf(reader).get(selector);
  return e && now - e.fetchedAt >= 0 && now - e.fetchedAt <= FRESH_READING_MS ? e : null;
}
/** Remembers a body read for `selector` through `reader` at `fetchedAt` (old entries are dropped as new ones arrive). */
export function rememberReading(reader: FetchLike, selector: string, body: unknown, fetchedAt: number): void {
  const memo = memoOf(reader);
  memo.delete(selector);
  memo.set(selector, { body, fetchedAt });
  for (const [k, v] of memo) { if (memo.size <= MAX_ENTRIES && fetchedAt - v.fetchedAt <= FRESH_READING_MS) break; memo.delete(k); }
}
/** For tests. */
export function clearFreshReadings(): void { memos = new WeakMap(); }

/** The busy wait a budget refusal carries (ms), or null when it is not a busy rate bucket. */
export function busyWaitOf(e: unknown): number | null {
  return e instanceof BudgetHoldError && e.outcome.state === "busy" ? e.outcome.waitMs : null;
}
/** The sentence added to a refusal the budget caused: how long until the bucket has room again. */
export const busyRetryText = (waitMs: number): string => ` Try again in about ${Math.max(1, Math.ceil(waitMs / 1000))} seconds.`;

/**
 * HB-89 (hourly run 6): `reuse: false` skips the memo (a one-shot rule: its event may be decided inside the five minutes, and a reused
 * reading would judge a just-decided event as still open). `reuseIfReadAfter` keeps the memo only when its reading was fetched after
 * that time (for example the event's scheduled close). The fresh read is still remembered for the next caller.
 */
export interface FreshReadDeps { sleep?: (ms: number) => Promise<void>; reuse?: boolean; reuseIfReadAfter?: number | null }
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The body of `cfg` for the launch path: a fresh memo entry, else one read (waiting out a short busy bucket once). Returns the body and
 * the time it was fetched. Throws what fetchBody throws; a busy refusal past HOLD_WAIT_MAX_MS is rethrown as is (its outcome carries the wait).
 */
export async function readFresh(cfg: HttpSourceConfig, now: number, fetchImpl: FetchLike, deps: FreshReadDeps = {}): Promise<Entry & { cached: boolean }> {
  const hit = deps.reuse === false ? null : freshReading(fetchImpl, cfg.id, now);
  if (hit && (deps.reuseIfReadAfter == null || hit.fetchedAt > deps.reuseIfReadAfter)) return { ...hit, cached: true };
  const sleep = deps.sleep ?? realSleep;
  let body: unknown;
  try { body = await fetchBody(cfg, now, fetchImpl); }
  catch (e) {
    const wait = busyWaitOf(e);
    if (wait === null || wait > HOLD_WAIT_MAX_MS) throw e;
    await sleep(wait);
    body = await fetchBody(cfg, now, fetchImpl);
  }
  rememberReading(fetchImpl, cfg.id, body, now);
  return { body, fetchedAt: now, cached: false };
}
