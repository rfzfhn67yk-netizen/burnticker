import { boundedMemo } from "@/lib/burnticker/boundedMemo";
import { tokenPageData, type Platform } from "@/lib/burnticker/server";
import type { TokenRow } from "@/lib/burnticker/registry";

/**
 * ONE COIN'S PAGE DATA, REMEMBERED AND BOUNDED (sixth pass B-10 / HB-51 / HB-52, 2026-10-19). "Your coins" (GET /v1/creators/{wallet})
 * built each coin's page one after another, chain reads included, and took 15 to 20 s cold for a creator with seven coins (once Caddy's
 * 503); the creator page gave up on five of them ("could not be read just now"). Both now read every coin at once through this one
 * memo (boundedMemo.ts, the league schedule's pattern):
 * - keyed by the coin's mint and page version (registry.pageVersion: a launch, a new receipt or a new reading reads it again);
 * - a coin never read waits at most COIN_PAGE_COLD_WAIT_MS, then the caller gets null and shows "Still loading this coin" while the read
 *   finishes behind it for the next visitor; an answer older than COIN_PAGE_FRESH_MS is served at once while one refresh runs;
 * - a read still running after COIN_PAGE_READ_MS counts as failed, and a failed read is retried after COIN_PAGE_RETRY_MS;
 * - at most COIN_PAGE_READ_CONCURRENCY coin reads run at once across the whole server, so a creator with many coins never floods the RPC.
 */
export const COIN_PAGE_FRESH_MS = 60_000, COIN_PAGE_COLD_WAIT_MS = 2_400, COIN_PAGE_READ_MS = 20_000, COIN_PAGE_RETRY_MS = 15_000;
export const COIN_PAGE_READ_CONCURRENCY = 8;

export type CoinPageData = Awaited<ReturnType<typeof tokenPageData>>;
export type CoinPageReader = (p: Platform, t: TokenRow, now: number) => Promise<CoinPageData>;

/** A small FIFO gate: at most `limit` of the wrapped calls run at once. */
export function limiter(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((r) => waiting.push(r));
    active++;
    try { return await fn(); } finally { active--; waiting.shift()?.(); }
  };
}

const gate = limiter(COIN_PAGE_READ_CONCURRENCY);
// one memo per registry (a platform swapped in tests never serves another registry's coins)
const memos = new WeakMap<object, ReturnType<typeof boundedMemo<CoinPageData>>>();
const memoFor = (registry: object) => {
  let m = memos.get(registry);
  if (!m) { m = boundedMemo<CoinPageData>({ freshMs: COIN_PAGE_FRESH_MS, coldWaitMs: COIN_PAGE_COLD_WAIT_MS, readMs: COIN_PAGE_READ_MS, nullMs: COIN_PAGE_RETRY_MS, maxKeys: 512 }); memos.set(registry, m); }
  return m;
};

const versionOf = (p: Platform, t: TokenRow): string => { try { return p.registry.pageVersion(t.mint); } catch { return ""; } };

/**
 * The coin's page data from the shared memo, or null while its first read is still running (or after it failed; it is retried).
 * `waitMs` (audit 7 B-10): how long a coin never read is waited for (default COIN_PAGE_COLD_WAIT_MS); the streamed creator page waits
 * longer, because its other coins are already on screen.
 */
export function rememberedCoinPage(p: Platform, t: TokenRow, now: number, read: CoinPageReader = tokenPageData, o: { waitMs?: number } = {}): Promise<CoinPageData | null> {
  return memoFor(p.registry).get(`${t.mint}:${versionOf(p, t)}`, () => gate(() => read(p, t, now)), o.waitMs === undefined ? {} : { coldWaitMs: o.waitMs });
}

/**
 * Audit 7 B-10 / OP7-5 (2026-10-20): after a deploy the first creator page showed "Still loading this coin" for 7 of 7 coins, because
 * no coin page had been read yet. A production start reads every live and paused coin into this memo once, server.ts COIN_WARM_DELAY_MS after the
 * platform is built (behind the home and coins warm builds), through the same gate, so the first visitor finds them read. Never rejects.
 */
export async function warmCoinPages(p: Platform, read: CoinPageReader = tokenPageData, now: () => number = Date.now): Promise<number> {
  let rows: TokenRow[] = [];
  try { rows = p.registry.tokens().filter((t) => t.status !== "draft" && t.status !== "expired"); } catch { return 0; }
  const got = await Promise.all(rows.map((t) => rememberedCoinPage(p, t, now(), read, { waitMs: COIN_PAGE_READ_MS }).catch(() => null)));
  return got.filter((x) => x !== null).length;
}
