import type { PairRow } from "@/lib/burnticker/registry";
import { coinPageHref, sharedTickers } from "@/lib/burnticker/coinKey";

/**
 * WHICH RIVALRY PAIRS A PUBLIC PAGE LISTS (third prelaunch audit 2026-10-16 F09). The scoreboards page listed an abandoned draft pair
 * (both coins expired, no launch transaction) next to the live pair with the same tickers. One rule for every public pair list (the
 * scoreboards page, the Burn Derby index, the sitemap): a side counts as launched when its coin is live, paused or retired (the
 * sitemap's own rule for coins) with a launch transaction. A pair with no launched side is left out; a pair with one launched side is
 * listed with that said. Two launched pairs that share tickers are different pairs and are both listed.
 */
export interface PublicPair extends PairRow { tickerA: string; tickerB: string; lifecycle: "launched" | "one-side"; launchedTicker: string | null }
type Tok = { ticker: string; status: string; launchTx: string | null } | null;
interface PairSource { pairs(): PairRow[]; token(mint: string): Tok }

const PUBLIC = new Set(["live", "paused", "retired"]);
export const sideLaunched = (t: Tok): boolean => !!t && PUBLIC.has(t.status) && !!t.launchTx;

export function publicPairs(registry: PairSource): PublicPair[] {
  return registry.pairs().flatMap((pr) => {
    const a = registry.token(pr.mintA), b = registry.token(pr.mintB);
    const la = sideLaunched(a), lb = sideLaunched(b);
    if (!la && !lb) return [];
    return [{ ...pr, tickerA: a?.ticker ?? pr.mintA.slice(0, 6), tickerB: b?.ticker ?? pr.mintB.slice(0, 6), lifecycle: la && lb ? "launched" : "one-side", launchedTicker: la && lb ? null : la ? a!.ticker : b!.ticker }];
  });
}

/** The line a list shows next to a pair with one launched side; null for a pair whose two coins both launched. */
export const pairLifecycleLine = (p: PublicPair): string | null => (p.lifecycle === "launched" ? null : `Only $${p.launchedTicker} launched. The other coin of this pair has not launched on Burnticker.`);
/** Review follow-up 3: the pair page's line for a pair with no launched side (the page stays reachable by its address). */
export const PAIR_NOT_LAUNCHED_LINE = "Neither coin of this pair has launched on Burnticker.";
/**
 * Prelaunch audit 2026-10-18 A-25: is this pair's page public? True when at least one side launched (the rule every public pair list
 * uses). A pair with no launched side (an abandoned draft whose tickers a live pair now holds) answers 404 on its page and its API, and
 * the status document leaves it out. False for an id the registry does not have.
 */
export function pairIsPublic(registry: PairSource & { pair?(pairId: string): PairRow | null }, pairId: string): boolean {
  const pr = registry.pair ? registry.pair(pairId) : registry.pairs().find((x) => x.pairId === pairId);
  return !!pr && (sideLaunched(registry.token(pr.mintA)) || sideLaunched(registry.token(pr.mintB)));
}
/** The pair page's own answer (A-25): found when the pair is public; an unreadable registry keeps the page (the client says so). */
export function pairPageFound(open: () => PairSource, pairId: string): boolean {
  let r: PairSource;
  try { r = open(); } catch { return true; }
  try { return pairIsPublic(r, pairId); } catch { return true; }
}
/** The lifecycle line for one pair id: null when both coins launched. */
export function pairLifecycle(registry: PairSource, pairId: string): string | null {
  const pp = publicPairs(registry).find((x) => x.pairId === pairId);
  return pp ? pairLifecycleLine(pp) : registry.pairs().some((x) => x.pairId === pairId) ? PAIR_NOT_LAUNCHED_LINE : null;
}
/**
 * Review follow-up 3: each side's coin page, by mint once its ticker is shared (coinKey.ts), never by a ticker another coin also holds
 * (the abandoned PITWIN/BALWIN draft shares the live pair's tickers).
 */
export function pairSideHrefs(registry: PairSource & { tokens(): { ticker: string; mint: string; status: string }[] }, pr: Pick<PairRow, "mintA" | "mintB">): { a: string; b: string } {
  const shared = sharedTickers(registry.tokens());
  const href = (mint: string) => { const t = registry.token(mint); return coinPageHref({ ticker: t?.ticker ?? mint, mint }, t ? shared : true); };
  return { a: href(pr.mintA), b: href(pr.mintB) };
}
