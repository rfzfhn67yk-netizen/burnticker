import type { CardView, IndexCoin } from "@/lib/burnticker/cardView";
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
  { id: "following", label: "Following", rule: "Coins you follow." },
];

/**
 * LD6-4 (sixth pass): the freshness window is tied to the read cadence. The page asks again every REREAD_MS (60 s); the server keeps its
 * answer at most INDEX_SERVE_MAX_AGE_MS before it waits for a fresh build; the CDN may add s-maxage plus stale-while-revalidate (45 s);
 * a build takes up to about 30 s. A read older than all of that together, rounded up to five minutes, means something is wrong.
 * Before this fix the server handed out its last answer however old it was, so the first visitor after a quiet spell saw the line.
 */
export const INDEX_SERVE_MAX_AGE_MS = 120_000;
export const INDEX_CADENCE_MS = 60_000 + INDEX_SERVE_MAX_AGE_MS + 45_000 + 30_000;
export const STALE_AFTER_MS = Math.max(5 * 60_000, INDEX_CADENCE_MS);
/** The server's choice: hand out the kept index at once, or wait (bounded) for a fresh build because the kept one is too old. */
export function indexMemoTooOld(ageMs: number): boolean { return ageMs > INDEX_SERVE_MAX_AGE_MS; }

export type GridState =
  | { kind: "loading" }
  | { kind: "error"; body: string; details: string | null }
  | { kind: "unavailable"; body: string }
  | { kind: "empty"; body: string; notLaunched: boolean }
  | { kind: "results"; note: string | null };

type Coin = Pick<IndexCoin, "ticker" | "phase" | "progressPct" | "nextCheckAt" | "nextCloseTime" | "launchedAt" | "status">;

/** The coins a tab lists, in its order. "graduating" uses only curves that were read; nothing is ranked on an invented zero. */
/** `isFollowed`: whether this browser follows the coin, by its network and mint (watchlist.ts; never by ticker, private review 8 F1). */
export function tabCoins<T extends Coin>(tab: GridTab, list: readonly T[], isFollowed: (t: T) => boolean = () => false): T[] {
  const next = (t: T) => t.nextCloseTime ?? t.nextCheckAt;
  const launched = (t: T) => (t.launchedAt ? Date.parse(t.launchedAt) : -1);
  if (tab === "new") return [...list].sort((a, b) => launched(b) - launched(a) || a.ticker.localeCompare(b.ticker));
  if (tab === "next") return list.filter((t) => next(t)).sort((a, b) => Date.parse(next(a)!) - Date.parse(next(b)!));
  if (tab === "graduating") return list.filter((t) => t.phase !== "graduated" && t.progressPct !== null && t.progressPct >= 50).sort((a, b) => b.progressPct! - a.progressPct!);
  if (tab === "graduated") return list.filter((t) => t.phase === "graduated");
  if (tab === "following") return list.filter(isFollowed);
  return [];
}

/**
 * THE OPERATOR'S OWN COINS IN THE LIST (owner 2026-10-14: "I don't see the $DEFICIT coin"). $DEFICIT is not in this site's registry (its
 * own keeper runs it), so the index never lists it; its featured card (home.ts featuredCoins) leads the coin list instead, once it is
 * created. It leads "New" and, when this browser follows it, "Following". The search matches the ticker (with or without "$"), the name,
 * the rule and the mint address (a prefix is enough).
 */
export const FIRST_PARTY_CARD_IDS: readonly string[] = ["deficit"];
export const searchKey = (q: string): string => q.trim().toLowerCase().replace(/^\$/, "");
export const cardMatches = (v: Pick<CardView, "ticker" | "name" | "rule" | "mint">, q: string): boolean => {
  const s = searchKey(q);
  return !s || `${v.ticker} ${v.name} ${v.rule} ${v.mint?.address ?? ""}`.toLowerCase().includes(s);
};
export function firstPartyCards(featured: readonly CardView[], tab: GridTab, query: string, isFollowed: (v: CardView) => boolean = () => false): CardView[] {
  if (tab !== "new" && tab !== "following") return [];
  return featured.filter((v) => FIRST_PARTY_CARD_IDS.includes(v.id) && !v.tags.some((t) => t.label === "Not created yet") && cardMatches(v, query) && (tab === "new" || isFollowed(v)));
}

/**
 * THE "LIVE COINS" TOTAL (walkthrough 13, 2026-10-14: "Live coins 1" while $DEFICIT and $PHINFLWIN were both live). The index counts the
 * registry only; the operator's created coins that lead the list ($DEFICIT, not a registry row) are live coins shown too, so each created
 * first-party card anyone can trade adds one, unless the index already lists its ticker.
 */
export function liveCoinsTotal(indexLive: number, featured: readonly CardView[], indexTickers: readonly string[]): number {
  const listed = new Set(indexTickers.map((t) => t.toUpperCase()));
  return indexLive + featured.filter((v) => FIRST_PARTY_CARD_IDS.includes(v.id) && v.group === "public" && !v.tags.some((t) => t.label === "Not created yet") && !listed.has(v.ticker.toUpperCase())).length;
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
/** A search with no tradeable match: says how many featured coins match instead, or that nothing does. */
export function searchMissSentence(query: string, featuredMatches: number, lookalike: { line: string } | null = null): string {
  // ChatGPT audit 7 item 2: a pasted mint on the Not Burnticker list (GET /v1/search?q=<mint> answers `lookalike`) says so
  if (lookalike) return lookalike.line;
  if (featuredMatches > 0) return `No tradeable coin matches. ${featuredMatches === 1 ? "1 featured coin does" : `${featuredMatches} featured coins do`}.`;
  return `No coin matches "${query.trim()}".`;
}

export function gridState(i: { tab: GridTab; loading: boolean; error: string | null; all: readonly Coin[]; shown: number; query: string; generatedAt: string | null; now: number; featuredMatches?: number }): GridState {
  if (i.error) return { kind: "error", body: dataStateSentence("error", "the coin list"), details: i.error };
  if (i.loading) return { kind: "loading" };
  const cov = curveCoverage(i.all);
  const stale = i.generatedAt && Number.isFinite(Date.parse(i.generatedAt)) && i.now - Date.parse(i.generatedAt) > STALE_AFTER_MS
    ? dataStateSentence("stale", "the coin list", { readAt: i.generatedAt }) : null;
  if (i.tab === "graduating" && i.all.length > 0 && cov.read === 0 && cov.unread > 0) {
    return { kind: "unavailable", body: curveProgressSentence("unavailable") };
  }
  if (i.shown === 0) {
    // website-15 item 5 (Claude site audit 3 item 3): one search over both lists, so the grid never says "no match" while the featured
    // group below shows one
    if (i.query.trim()) return { kind: "empty", body: searchMissSentence(i.query, i.featuredMatches ?? 0), notLaunched: false };
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
