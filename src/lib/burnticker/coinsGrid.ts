import type { IndexCoin } from "@/lib/burnticker/cardView";
import { curveProgressSentence, dataStateSentence } from "@/lib/burnticker/readiness";

/**
 * THE COIN GRID'S STATES (website-13, 2026-10-12; ChatGPT audit 6 A5, Claude site audit 2 item 2f). A filter never treats missing data as
 * proof of no results: loading, loaded-and-empty, unavailable, stale and error each get their own sentence, and the selected tab's rule
 * is the rule its results follow. "About to graduate" lists coins whose curve was READ past half its raise; when no coin's curve could
 * be read it says curve progress is unavailable, and when some could not be read it says how many were left out. The loading, empty,
 * unavailable, stale and error sentences are website-12's (readiness.ts dataStateSentence and curveProgressSentence). Pure and client-safe.
 */

export type GridTab = "new" | "next" | "graduating" | "graduated" | "pairs" | "following";
export const GRID_TABS: { id: GridTab; label: string; rule: string }[] = [
  { id: "new", label: "New", rule: "Every coin anyone can trade, newest launch first." },
  { id: "next", label: "Next to settle", rule: "Coins with a scheduled result, soonest first." },
  { id: "graduating", label: "About to graduate", rule: "Coins whose curve this site read at half its raise or more, fullest first." },
  { id: "graduated", label: "Moved to trading pool", rule: "Coins that left their curve for their own Raydium pool." },
  { id: "pairs", label: "Pairs", rule: "Two coins that share one matchup." },
  // website-14 (product idea 7): the browser-local watchlist (watchlist.ts); nothing about it leaves the browser
  { id: "following", label: "Following", rule: "Coins you follow in this browser. The list is kept on this device only." },
];

/** How old an index read may be before the grid says so (the index is cached for at most a minute; five means something is wrong). */
export const STALE_AFTER_MS = 5 * 60_000;

export type GridState =
  | { kind: "loading" }
  | { kind: "error"; body: string; details: string | null }
  | { kind: "unavailable"; body: string }
  | { kind: "empty"; body: string; notLaunched: boolean }
  | { kind: "results"; note: string | null };

type Coin = Pick<IndexCoin, "ticker" | "phase" | "progressPct" | "nextCheckAt" | "nextCloseTime" | "launchedAt" | "status">;

/** The coins a tab lists, in its order. "graduating" uses only curves that were read; nothing is ranked on an invented zero. */
export function tabCoins<T extends Coin>(tab: GridTab, list: readonly T[], followed: readonly string[] = []): T[] {
  const next = (t: T) => t.nextCloseTime ?? t.nextCheckAt;
  const launched = (t: T) => (t.launchedAt ? Date.parse(t.launchedAt) : -1);
  if (tab === "new") return [...list].sort((a, b) => launched(b) - launched(a) || a.ticker.localeCompare(b.ticker));
  if (tab === "next") return list.filter((t) => next(t)).sort((a, b) => Date.parse(next(a)!) - Date.parse(next(b)!));
  if (tab === "graduating") return list.filter((t) => t.phase !== "graduated" && t.progressPct !== null && t.progressPct >= 50).sort((a, b) => b.progressPct! - a.progressPct!);
  if (tab === "graduated") return list.filter((t) => t.phase === "graduated");
  if (tab === "following") return list.filter((t) => followed.includes(t.ticker.toUpperCase()));
  return [];
}

/** How many coins in a list had their curve read (a phase or a percentage), and how many did not. */
export function curveCoverage(list: readonly Coin[]): { read: number; unread: number } {
  const onCurve = list.filter((t) => t.phase !== "graduated");
  const read = onCurve.filter((t) => t.progressPct !== null).length;
  return { read, unread: onCurve.length - read };
}

/**
 * The grid's state for one tab. `index` is null while loading; `error` is the read's failure. `all` is every listable coin (before the
 * search), `shown` what the tab and the search leave. `generatedAt` is the index's own read time.
 */
export function gridState(i: { tab: GridTab; loading: boolean; error: string | null; all: readonly Coin[]; shown: number; query: string; generatedAt: string | null; now: number }): GridState {
  if (i.error) return { kind: "error", body: dataStateSentence("error", "the coin list"), details: i.error };
  if (i.loading) return { kind: "loading" };
  const cov = curveCoverage(i.all);
  const stale = i.generatedAt && Number.isFinite(Date.parse(i.generatedAt)) && i.now - Date.parse(i.generatedAt) > STALE_AFTER_MS
    ? dataStateSentence("stale", "the coin list", { readAt: i.generatedAt }) : null;
  if (i.tab === "graduating" && i.all.length > 0 && cov.read === 0 && cov.unread > 0) {
    return { kind: "unavailable", body: curveProgressSentence("unavailable") };
  }
  if (i.shown === 0) {
    if (i.query.trim()) return { kind: "empty", body: `No coin matches "${i.query.trim()}".`, notLaunched: false };
    if (i.all.length === 0) return { kind: "empty", body: i.tab === "following" ? "No coin anyone can trade is launched on this site yet, so there is nothing to follow in this list. The featured coins below can be followed." : i.tab === "pairs" ? "No rivalry pair is launched on this site yet." : "No coin anyone can trade is launched on this site yet.", notLaunched: true };
    const body = i.tab === "graduating" ? `${curveProgressSentence("empty")}${cov.unread ? ` ${cov.unread} coin${cov.unread === 1 ? "'s curve was" : "s' curves were"} not read and ${cov.unread === 1 ? "is" : "are"} left out.` : ""}`
      : i.tab === "graduated" ? "No coin has moved to a trading pool yet."
      : i.tab === "next" ? "No coin has a scheduled result."
      : i.tab === "pairs" ? "No rivalry pair is launched on this site yet."
      : i.tab === "following" ? "You do not follow any of the listed coins yet. Press Follow on a coin card. The list is kept in this browser only."
      : "No coin is listed.";
    return { kind: "empty", body: stale ? `${body} ${stale}` : body, notLaunched: false };
  }
  const partial = i.tab === "graduating" && cov.unread ? `${cov.unread} coin${cov.unread === 1 ? "'s curve was" : "s' curves were"} not read and ${cov.unread === 1 ? "is" : "are"} left out.` : null;
  return { kind: "results", note: [stale, partial].filter(Boolean).join(" ") || null };
}
