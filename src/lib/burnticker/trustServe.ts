import { KeyedSwr } from "@/lib/burnticker/keyedSwr";
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
export const trustSwr = new KeyedSwr<unknown>({ freshMs: TRUST_FRESH_MS, coldWaitMs: TRUST_COLD_WAIT_MS, maxKeys: 4, log: (k, e) => console.error(`[burnticker/trust] ${k} build failed:`, e) });
export const TRUST_DELTA_CACHE = new LruMap<string, LamportsDelta>(2_000);
