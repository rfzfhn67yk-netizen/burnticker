/**
 * The proxy's light half of the HB-100 coin-page gate (HB-152, hourly run 13). This module is pure: no database, no file read, no
 * heavy import, so it always loads in the proxy bundle. The gate itself (coinPageGate.ts, which reads the registry) is imported
 * dynamically by `coinPageServedSafely`, inside a try/catch and under a time budget, so a gate that fails to load, throws, or runs slow
 * lets the request through to the page, where the coin layout's own check still answers 404 for an unknown coin.
 */
export const NO_SUCH_COIN_PATH = "/burnticker/_no-such-coin";
/** The longest the proxy waits on the gate before it serves the page anyway. */
export const GATE_BUDGET_MS = 300;

/** The coin segment of a /burnticker/t/<segment> path (one segment, an optional trailing slash), decoded once; null for any other path. */
export function coinSegmentOf(pathname: string): string | null {
  const m = /^\/burnticker\/t\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

export type CoinPageGateModule = { coinSegmentServedAsync: (segment: string) => Promise<boolean> };
let gate: Promise<CoinPageGateModule> | null = null;
/** The gate module, imported once; a failed import is forgotten so the next request tries again (and is served meanwhile). */
const loadGate = (): Promise<CoinPageGateModule> => {
  if (!gate) { const p: Promise<CoinPageGateModule> = import("@/lib/burnticker/coinPageGate"); gate = p; p.catch(() => { if (gate === p) gate = null; }); }
  return gate;
};

/**
 * True when the page should be served: the gate said so, or the gate could not answer (module load failure, a throw, or no answer
 * within `budgetMs`). False only when the gate answered, in time, that no such coin exists.
 */
export async function coinPageServedSafely(segment: string, o: { load?: () => Promise<CoinPageGateModule>; budgetMs?: number } = {}): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), o.budgetMs ?? GATE_BUDGET_MS); });
  const ask = (async (): Promise<boolean> => {
    try { return await (await (o.load ?? loadGate)()).coinSegmentServedAsync(segment); } catch { return true; }
  })();
  try { return await Promise.race([ask, late]); } finally { clearTimeout(timer); }
}
