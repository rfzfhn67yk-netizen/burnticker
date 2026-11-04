import type { SeriesSummary } from "@/lib/burnticker/oracle/types";
import type { KalshiEvent, KalshiEventMarket } from "@/lib/burnticker/oracle/events";

/**
 * BROWSE LIKE KALSHI (2026-10-10, the owner: "now it's limited to sports. how do we expand to weather, elections, anything like that.
 * can you make it navigate like Kalshi navigates?"). Kalshi's own navigation is category → tag → series → event → market, and its
 * public API reports exactly that tree:
 *
 *   GET /search/tags_by_categories            { tags_by_categories: { "<Category>": ["<tag>", …] | null, … } }   (the left rail)
 *   GET /series?category=<Category>&include_volume=true    every series of the category with `tags` and `volume_fp`
 *   GET /events?series_ticker=…&status=open&with_nested_markets=true      a series' upcoming events and their markets
 *
 * This module is the pure half: parsing those bodies, the per-category page (tag filter, text filter, most-traded first), a guess at
 * how a series reads (yes/no vs a settled number — confirmed on drill-down by the markets' strike ladder), the one-line example
 * mapping a card shows, a series' upcoming-event summary, and the Polymarket tag a Kalshi category maps to (the second venue group).
 * The client methods live on KalshiClient (kalshi.ts); the refuse list is applied by the API handler. Volume only ORDERS the list
 * (Kalshi's own "most traded first"); it is never shown as a number and never reaches a rule.
 */

export interface KalshiCategoryTags { category: string; tags: string[] }
export interface KalshiCategory extends KalshiCategoryTags { seriesCount: number | null }

/** Categories in the order the API reports them (object key order), each with its tags (null → []). */
export function parseTagsByCategories(body: unknown): KalshiCategoryTags[] {
  const t = (body as { tags_by_categories?: Record<string, unknown> } | null)?.tags_by_categories;
  if (!t || typeof t !== "object") return [];
  return Object.entries(t).map(([category, tags]) => ({ category, tags: Array.isArray(tags) ? tags.map(String) : [] }));
}

export type KindHint = "binary" | "scalar";
export interface BrowseSeries extends SeriesSummary {
  /** Kalshi's traded volume for the series (ordering only — never displayed, never a rule input). */
  volume: number;
  kindHint: KindHint;
  /** The card's example mapping in a few words ("burns when one of its markets settles YES"). */
  example: string;
  /** Upcoming events (when the page asked for them): how many are open, the next one and when it closes, whether its markets are a strike ladder. */
  events: SeriesEventSummary | null;
}
export interface SeriesEventSummary { open: number; next: { eventTicker: string; title: string; closeTime: string | null; expectedAt: string | null } | null; ladder: boolean }

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** A number the series settles to (a temperature, an index close, a rate, a count) rather than a yes/no question. Title words only: a guess, the drill-down confirms. */
const SCALAR_WORDS = /\b(temp(erature)?s?|highest|lowest|high temp|low temp|cpi|inflation|gdp|payrolls?|unemployment|jobless|claims|rates?|yield|close|closing|index|level|gas price|price|rainfall|snowfall|inches|how many|number of|count|total|average|mph|degrees?)\b/i;
export function kindHintFor(title: string, tags: readonly string[] = []): KindHint {
  return SCALAR_WORDS.test(title) || tags.some((t) => /temperature|inflation|interest rates|indices|gdp/i.test(t)) ? "scalar" : "binary";
}

/** The card's example in OUR words: the venue's title is shown beside it, never quoted into it (titles are data — "Will …?" — not copy). */
export function seriesExample(kind: KindHint): string {
  return kind === "scalar" ? "burns per step above the last settled number" : "burns when one of its markets settles YES";
}

/** /series?category=…&include_volume=true → browse rows (with volume, the kind guess and the example). */
export function parseBrowseSeriesList(body: unknown): BrowseSeries[] {
  const list = (body as { series?: unknown[] } | null)?.series;
  if (!Array.isArray(list)) return [];
  const out: BrowseSeries[] = [];
  for (const raw of list) {
    const s = raw as Record<string, unknown> | null;
    if (!s || typeof s.ticker !== "string") continue;
    const src = Array.isArray(s.settlement_sources) ? (s.settlement_sources as { name?: string; url?: string }[]).find((x) => typeof x?.url === "string") : null;
    const tags = Array.isArray(s.tags) ? (s.tags as unknown[]).map(String) : [];
    const title = String(s.title ?? s.ticker);
    const kindHint = kindHintFor(title, tags);
    const vol = Number(s.volume_fp ?? s.volume ?? 0);
    out.push({ oracle: "kalshi", ticker: s.ticker, title, category: str(s.category), frequency: str(s.frequency), settlementSource: src ? { name: String(src.name ?? ""), url: String(src.url) } : null, tags, volume: Number.isFinite(vol) ? vol : 0, kindHint, example: seriesExample(kindHint), events: null });
  }
  return out;
}

export interface CategoryPage { category: string; total: number; tags: { tag: string; count: number }[]; series: BrowseSeries[]; offset: number; limit: number }

/** One category's page: optional tag and text filters, most-traded first (ties by title), then the window. Tags listed with their counts, Kalshi's order kept. */
export function categoryPage(category: string, all: readonly BrowseSeries[], o: { tag?: string | null; q?: string | null; limit?: number; offset?: number; tagOrder?: readonly string[] } = {}): CategoryPage {
  const counts = new Map<string, number>();
  for (const s of all) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const order = [...(o.tagOrder ?? []), ...[...counts.keys()].filter((t) => !(o.tagOrder ?? []).includes(t)).sort()];
  const tags = order.filter((t) => counts.has(t)).map((tag) => ({ tag, count: counts.get(tag)! }));
  const q = (o.q ?? "").trim().toLowerCase();
  const filtered = all.filter((s) => (!o.tag || s.tags.includes(o.tag)) && (!q || `${s.ticker} ${s.title} ${s.tags.join(" ")}`.toLowerCase().includes(q)))
    .sort((a, b) => b.volume - a.volume || a.title.localeCompare(b.title));
  const limit = Math.min(100, Math.max(1, o.limit ?? 24)), offset = Math.max(0, o.offset ?? 0);
  return { category, total: filtered.length, tags, series: filtered.slice(offset, offset + limit), offset, limit };
}

/** Strike types that make an event's markets a ladder (the settled number is readable: the scalar mapping applies). */
export const LADDER_STRIKES = new Set(["between", "greater", "less", "greater_or_equal", "less_or_equal"]);
export const isLadder = (markets: readonly Pick<KalshiEventMarket, "strikeType">[]): boolean => markets.filter((m) => m.strikeType && LADDER_STRIKES.has(m.strikeType)).length >= 2;

/** A series' upcoming events: how many are open, the soonest to close, whether its markets form a strike ladder. */
export function summariseEvents(events: readonly KalshiEvent[], nowMs: number): SeriesEventSummary {
  const upcoming = events.filter((e) => !e.closeTime || Date.parse(e.closeTime) >= nowMs).sort((a, b) => (a.closeTime ?? "9").localeCompare(b.closeTime ?? "9"));
  const n = upcoming[0] ?? null;
  return { open: events.length, next: n ? { eventTicker: n.eventTicker, title: n.title, closeTime: n.closeTime, expectedAt: n.expectedAt } : null, ladder: events.some((e) => isLadder(e.markets)) };
}

/**
 * The Polymarket tag a Kalshi category maps to (the second venue group under a category), or null where Polymarket has no matching
 * top-level tag. Polymarket's top-level tags: politics, sports, crypto, pop-culture, business, science.
 */
export const POLYMARKET_TAG_FOR: Record<string, { slug: string; label: string } | null> = {
  Politics: { slug: "politics", label: "Politics" }, Elections: { slug: "politics", label: "Politics" },
  Sports: { slug: "sports", label: "Sports" }, Crypto: { slug: "crypto", label: "Crypto" },
  Entertainment: { slug: "pop-culture", label: "Pop culture" }, Mentions: { slug: "pop-culture", label: "Pop culture" }, Social: { slug: "pop-culture", label: "Pop culture" },
  Companies: { slug: "business", label: "Business" }, Financials: { slug: "business", label: "Business" }, Economics: { slug: "business", label: "Business" }, Business: { slug: "business", label: "Business" }, Commodities: { slug: "business", label: "Business" },
  "Science and Technology": { slug: "science", label: "Science" }, "Climate and Weather": { slug: "science", label: "Science" },
};
