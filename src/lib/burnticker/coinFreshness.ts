/**
 * HOW OLD THE COIN PAGE'S NUMBERS ARE (2026-10-18 prelaunch audit F02). The coin route served a 21-hour-old pool read as if it were
 * current: its memo had no maximum age, the route dropped the age, and the page loaded once and never asked again. Now the route says
 * how old its answer is (`ageMs`, the memo's age, and `marketAgeMs`, the pool read's own age) and whether it is past COIN_MAX_STALE_MS
 * (`stale`). The page shows an old answer as a dated snapshot, withholds the pool's reserves and the curve's progress past that line,
 * and asks again on an interval. Client-safe: no server imports.
 */
export const COIN_MAX_STALE_MS = 15 * 60_000;
/** How often the mounted coin page asks again, and how often once its answer is stale. */
export const COIN_POLL_MS = 60_000, COIN_STALE_POLL_MS = 20_000;

export interface CoinFreshness { ageMs: number; marketAgeMs: number | null; stale: boolean }

/** The route's freshness fields for one answer: the memo's state and age, and the age of the pool read inside it (status.market.readAt). */
export function coinFreshness(memo: { state: string; ageMs: number }, status: unknown, now: number = Date.now()): CoinFreshness {
  const readAt = (status as { market?: { readAt?: unknown } | null } | null)?.market?.readAt;
  const t = typeof readAt === "string" ? Date.parse(readAt) : NaN;
  const marketAgeMs = Number.isFinite(t) ? Math.max(0, now - t) : null;
  const ageMs = Math.max(0, memo.ageMs);
  const stale = memo.state === "stale" || ageMs >= COIN_MAX_STALE_MS || (marketAgeMs !== null && marketAgeMs >= COIN_MAX_STALE_MS);
  return { ageMs, marketAgeMs, stale };
}

/** The page's view: how old the numbers are now (the route's age plus the time since the page received them), and whether that is stale. */
export function snapshotView(f: Partial<CoinFreshness> | null | undefined, receivedAt: number, now: number): { ageMs: number; stale: boolean } {
  const base = Math.max(Number(f?.ageMs) || 0, Number(f?.marketAgeMs) || 0);
  const ageMs = base + Math.max(0, now - receivedAt);
  return { ageMs, stale: !!f?.stale || ageMs >= COIN_MAX_STALE_MS };
}

/** "21 hours", "1 minute", "2 days": a plain length of time. */
export function lengthWords(ms: number): string {
  const min = Math.max(1, Math.floor(ms / 60_000));
  const [n, unit] = min < 60 ? [min, "minute"] : min < 48 * 60 ? [Math.floor(min / 60), "hour"] : [Math.floor(min / (24 * 60)), "day"];
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** The dated-snapshot sentence the page shows once its numbers are past COIN_MAX_STALE_MS. */
export const staleSnapshotLine = (ageMs: number): string => `Read ${lengthWords(ageMs)} ago; a fresh read has not succeeded since.`;
export const STALE_WITHHELD = "The pool's reserves and the curve's progress are hidden until a fresh read succeeds.";

/** A stale market with the trade-sensitive fields (the curve's progress, the pool's reserves and value) withheld and the reason in their notes. */
export function withholdStaleMarket<M extends { curve: unknown; curveNote: string; pool?: unknown; poolNote?: string }>(m: M, ageMs: number): M {
  const note = `${staleSnapshotLine(ageMs)} ${STALE_WITHHELD}`;
  return { ...m, curve: null, curveNote: note, pool: null, poolNote: note } as M;
}
