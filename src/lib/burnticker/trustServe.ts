import { KeyedSwr, SWR_BUILD_TIMEOUT_MS, type SwrState } from "@/lib/burnticker/keyedSwr";
import { COIN_MAX_STALE_MS, trustStaleLine } from "@/lib/burnticker/coinFreshness";
import { LruMap } from "@/lib/burnticker/lru";
import type { LamportsDelta } from "@/lib/burnticker/trust";

/**
 * THE TRUST PAGE'S MEMO (2026-10-15 prelaunch audit C2). /api/burnticker/trust and /v1/trust rebuilt the page on every request: the
 * live platform config, the effective cap and (for the page) the developer fee ledger, which read up to 200 transactions one by one, with
 * no cache and no rate limit. Now each answer is kept and served at once, refreshed in the background once older than TRUST_FRESH_MS
 * (one refresh in flight; stale while revalidate, like home/route.ts), and the ledger's per-transaction reads are kept in
 * TRUST_DELTA_CACHE (a landed transaction never changes), so a refresh reads only the signature list and the transactions it has not
 * seen. The routes are rate limited as well.
 */
export const TRUST_FRESH_MS = 120_000, TRUST_COLD_WAIT_MS = 15_000;
/**
 * Audit 7 F06 (2026-10-19): the memo had no maximum age and no rebuild timeout, so a hung rebuild kept serving the old trust payload as a
 * cache hit indefinitely. It now takes the coin route's bounds (10-18 audit F02): an answer older than TRUST_MAX_STALE_MS (the coin
 * page's COIN_MAX_STALE_MS, 15 minutes) is no longer a hit, and a rebuild in flight past SWR_BUILD_TIMEOUT_MS (2 minutes) counts as
 * failed so the next read starts another. A late landing of an abandoned rebuild never replaces a newer answer (keyedSwr.ts). Past the
 * bound the route serves the last verified copy marked degraded (`freshness.stale`, `lastVerifiedAt`), never as a hit, and the edge
 * does not keep it.
 */
export const TRUST_MAX_STALE_MS = COIN_MAX_STALE_MS;
export const TRUST_CACHE_CONTROL = "public, max-age=30, s-maxage=60, stale-while-revalidate=120";
export const makeTrustSwr = (o: { clock?: () => number; coldWaitMs?: number } = {}): KeyedSwr<unknown> =>
  new KeyedSwr<unknown>({ freshMs: TRUST_FRESH_MS, coldWaitMs: o.coldWaitMs ?? TRUST_COLD_WAIT_MS, maxStaleMs: TRUST_MAX_STALE_MS, buildTimeoutMs: SWR_BUILD_TIMEOUT_MS, maxKeys: 4, log: (k, e) => console.error(`[burnticker/trust] ${k} build failed:`, e) }, o.clock ?? Date.now);
export const trustSwr = makeTrustSwr();

/** How old the served trust copy is, and whether it is past the bound (degraded: the last verified copy, a fresh read has not landed). */
export interface TrustFreshness { state: SwrState | "stale"; ageMs: number; stale: boolean; lastVerifiedAt: string; note: string | null }
export function trustFreshness(r: { state: SwrState; ageMs: number }, now: number = Date.now()): TrustFreshness {
  const ageMs = Math.max(0, r.ageMs);
  const stale = r.state === "stale" || ageMs >= TRUST_MAX_STALE_MS;
  return { state: stale ? "stale" : r.state, ageMs, stale, lastVerifiedAt: new Date(now - ageMs).toISOString(), note: stale ? trustStaleLine(ageMs) : null };
}

export type TrustServed = { status: number; body: unknown; headers: Record<string, string> };
/**
 * The trust route's answer from the memo: 503 while nothing has been read yet; otherwise the payload with its `freshness`. A fresh copy
 * is kept at the edge (TRUST_CACHE_CONTROL); a degraded one is not (no-store), so the next visitor asks again. `x-trust-memo` is the
 * memo's state, "stale" past the bound.
 */
export async function serveTrust(swr: KeyedSwr<unknown>, key: string, build: () => Promise<unknown>, now: () => number = Date.now): Promise<TrustServed> {
  let r: Awaited<ReturnType<KeyedSwr<unknown>["get"]>>;
  // a first build that fails with nothing kept: a 503 the page retries, not a thrown 500
  try { r = await swr.get(key, "1", build); } catch { return { status: 503, body: { loading: false, error: "the trust page could not be read just now; try again in a few seconds", code: "trust-unavailable", retryAfterSec: 15 }, headers: { "cache-control": "no-store", "retry-after": "15" } }; }
  if (!r) return { status: 503, body: { loading: true, error: "the trust page is being read; try again in a few seconds", code: "trust-loading", retryAfterSec: 5 }, headers: { "cache-control": "no-store", "retry-after": "5" } };
  const freshness = trustFreshness(r, now());
  const body = r.value && typeof r.value === "object" && !Array.isArray(r.value) ? { ...(r.value as Record<string, unknown>), freshness } : r.value;
  return { status: 200, body, headers: { "cache-control": freshness.stale ? "no-store" : TRUST_CACHE_CONTROL, "x-trust-memo": freshness.state } };
}
export const TRUST_DELTA_CACHE = new LruMap<string, LamportsDelta>(2_000);
