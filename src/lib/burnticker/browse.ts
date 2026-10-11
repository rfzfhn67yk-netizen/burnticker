import fs from "node:fs";
import path from "node:path";
import type { BrowseSeries } from "@/lib/burnticker/oracle/browse";
import type { PolyEventHit } from "@/lib/burnticker/oracle/polymarket";
import type { VenueFlags } from "@/lib/burnticker/venues";

/**
 * BROWSE, VENUE-AGNOSTIC (2026-10-10). The owner asked for Kalshi-style navigation ("weather, elections, anything like that"); the
 * coordinator then made it venue-agnostic: Burnticker's own category taxonomy (config/burnticker/categories.json), each category listing
 * SOURCES from every adapter kind that maps to it —
 *
 *   · first-party feeds (config/burnticker/sources.json + the on-chain facts): first-class, listed first, with tier, cadence, last reading;
 *   · Polymarket tags: the tag's open events (Gamma), refuse list applied;
 *   · Kalshi categories: the category's series, most traded first — only while BURNTICKER_KALSHI_ENABLED is on (venues.ts).
 *
 * Every source becomes the same SourceCard (venue + tier, cadence, next event, the "burns when …" example, launchable or why not, the
 * refuse-list verdict, and the `pick` the wizard sets), so the page reads the same with a venue on or off. Pure apart from the loader.
 */

export interface CategoryDef { id: string; label: string; blurb: string; feeds: string[]; polymarket: string[]; kalshi: string[]; native?: string[]; guided?: "elections" | null; adjudicatedOnly?: boolean }
export const CATEGORIES_FILE = path.join("config", "burnticker", "categories.json");

export function parseCategories(raw: unknown): CategoryDef[] {
  const r = raw as { schema?: string; categories?: unknown[] } | null;
  if (!r || r.schema !== "burnticker.categories/v1" || !Array.isArray(r.categories)) throw new Error("categories.json: not a burnticker.categories/v1 file");
  const seen = new Set<string>();
  return r.categories.map((c) => {
    const x = c as Partial<CategoryDef>;
    if (typeof x.id !== "string" || !/^[a-z][a-z0-9-]{1,23}$/.test(x.id) || seen.has(x.id)) throw new Error(`categories.json: bad or duplicate id ${String(x.id)}`);
    seen.add(x.id);
    const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    return { id: x.id, label: String(x.label ?? x.id), blurb: String(x.blurb ?? ""), feeds: list(x.feeds), polymarket: list(x.polymarket), kalshi: list(x.kalshi), native: list(x.native), guided: x.guided === "elections" ? "elections" : null, adjudicatedOnly: x.adjudicatedOnly === true };
  });
}

let cached: CategoryDef[] | null = null;
export function loadCategories(root = process.cwd()): CategoryDef[] {
  if (cached && root === process.cwd()) return cached;
  const c = parseCategories(JSON.parse(fs.readFileSync(path.join(root, CATEGORIES_FILE), "utf8")));
  if (root === process.cwd()) cached = c;
  return c;
}

export type Venue = "feed" | "polymarket" | "kalshi";
/** What the wizard sets when a card is picked (the existing pick → rule → name → review flow). */
export interface SourcePick { oracle: "catalogue" | "polymarket" | "kalshi"; series: string | null; market: string | null; title: string }
export interface SourceCard {
  id: string; venue: Venue; venueLabel: string; tier: number; tierLabel: string; title: string; cadence: string | null;
  kind: "binary" | "scalar";
  /** The next thing that settles (Kalshi: the next event's close; Polymarket: the event's end), or the last reading for a feed. */
  next: { label: string; at: string | null } | null;
  example: string; launchable: { ok: boolean; why: string | null }; refused: string[]; flags: string[];
  sourceName: string | null; sourceUrl: string | null; pick: SourcePick;
  /** A native family card that needs one more choice before it is a rule: a team (the Team coin picker) or a station + threshold. */
  configure: { kind: "team"; league: string } | { kind: "weather"; metric: "high" | "rain" | "snow" } | null;
}

const LEAGUE_LABEL: Record<string, string> = { nfl: "NFL", nba: "NBA", mlb: "MLB", nhl: "NHL" };
const CROSS: Record<string, string> = { nfl: "TheSportsDB", nba: "TheSportsDB", mlb: "MLB StatsAPI (league official)", nhl: "the NHL score feed (league official)" };
/** The category's native first-party families as cards (espn:<league>, nws:<metric>). */
export function nativeCards(c: CategoryDef): SourceCard[] {
  return (c.native ?? []).map((n): SourceCard | null => {
    const [fam, arg] = n.split(":");
    if (fam === "espn" && LEAGUE_LABEL[arg]) return { id: `native:${n}`, venue: "feed", venueLabel: "ESPN scoreboard", tier: 4, tierLabel: "keeper-read primary API", title: `${LEAGUE_LABEL[arg]} team results — pick a team`, cadence: "every game day", kind: "scalar", next: null, example: "burns every time your team wins (or loses)", launchable: { ok: true, why: null }, refused: [], flags: [`cross-read: ${CROSS[arg]}`], sourceName: "ESPN scoreboard · first-party", sourceUrl: `https://www.espn.com/${arg}/scoreboard`, pick: { oracle: "catalogue", series: null, market: null, title: `${LEAGUE_LABEL[arg]} team results` }, configure: { kind: "team", league: arg } };
    if (fam === "nws" && ["high", "rain", "snow"].includes(arg)) { const m = arg as "high" | "rain" | "snow"; return { id: `native:${n}`, venue: "feed", venueLabel: "National Weather Service", tier: 4, tierLabel: "keeper-read primary API", title: m === "high" ? "Daily high at a station" : m === "rain" ? "Rain day at a station" : "First snow of the season", cadence: m === "snow" ? "once a season" : "daily (the morning after)", kind: "scalar", next: null, example: m === "high" ? "burns every day the high reaches your threshold" : m === "rain" ? "burns every day the rain reaches your threshold" : "burns once, on the first measurable snow", launchable: { ok: true, why: null }, refused: [], flags: ["official daily climate report (CLI), final reports only"], sourceName: "NWS daily climate · first-party, public domain", sourceUrl: "https://api.weather.gov", pick: { oracle: "catalogue", series: null, market: null, title: "" }, configure: { kind: "weather", metric: m } }; }
    return null;
  }).filter((x): x is SourceCard => x !== null);
}

/** The catalogue card fields Browse reads (handlers.ts catalogueSources builds them). */
export interface FeedCardInput { id: string; tier: number; tierLabel: string; title: string; sourceName: string; sourceUrl: string; cadence: string; unit: { label: string } | null; launchable: { ok: boolean; why: string | null }; flags: string[]; lastReading: { id: string; value: string | null } | null; refusals?: string[] }

const baseId = (id: string) => id.split(":")[0];

export function feedCard(f: FeedCardInput): SourceCard {
  return {
    id: `feed:${f.id}`, venue: "feed", venueLabel: f.sourceName, tier: f.tier, tierLabel: f.tierLabel, title: f.title, cadence: f.cadence, kind: "scalar",
    next: f.lastReading ? { label: `last reading ${f.lastReading.id}${f.lastReading.value !== null ? `: ${f.lastReading.value}` : ""}`, at: null } : null,
    example: f.unit ? `burns per ${f.unit.label}` : "burns on each settled reading", launchable: f.launchable, refused: f.refusals ?? [], flags: f.flags,
    sourceName: f.sourceName, sourceUrl: f.sourceUrl, pick: { oracle: "catalogue", series: f.id, market: null, title: f.title }, configure: null,
  };
}

export function polymarketCard(e: PolyEventHit): SourceCard {
  const one = e.markets.length === 1 && e.marketCount === 1 ? e.markets[0] : null;
  return {
    id: `polymarket:${e.slug}`, venue: "polymarket", venueLabel: "Polymarket", tier: 1, tierLabel: "adjudicated market", title: e.title, cadence: one ? "resolves once" : `${e.marketCount} markets`, kind: "binary",
    next: e.endDate ? { label: "ends", at: e.endDate } : null,
    example: one ? `burns when it resolves ${one.yes}` : `burns when a market of this event resolves YES`, launchable: { ok: e.refused.length === 0 && e.marketCount > 0, why: e.refused.length ? "refused" : e.marketCount === 0 ? "no binary market" : null },
    refused: e.refused, flags: [], sourceName: "Polymarket (result read on Polygon)", sourceUrl: e.url,
    pick: one ? { oracle: "polymarket", series: null, market: one.conditionId, title: `${one.question} (resolves once)` } : { oracle: "polymarket", series: `event:${e.slug}`, market: null, title: e.title }, configure: null,
  };
}

export function kalshiCard(s: BrowseSeries & { refused: string[] }): SourceCard {
  return {
    id: `kalshi:${s.ticker}`, venue: "kalshi", venueLabel: "Kalshi", tier: 1, tierLabel: "adjudicated market", title: s.title, cadence: s.frequency, kind: s.kindHint,
    next: s.events?.next ? { label: s.events.next.title, at: s.events.next.closeTime ?? s.events.next.expectedAt } : null,
    example: s.example, launchable: { ok: s.refused.length === 0, why: s.refused.length ? "refused" : null }, refused: s.refused, flags: [],
    sourceName: s.settlementSource?.name ?? "Kalshi", sourceUrl: s.settlementSource?.url ?? null, pick: { oracle: "kalshi", series: s.ticker, market: null, title: s.title }, configure: null,
  };
}

/** The category list: per category, how many sources each venue contributes on this host (feeds counted; Polymarket tags named; Kalshi categories named only when enabled). */
export function categoryList(cats: readonly CategoryDef[], feeds: readonly FeedCardInput[], venues: VenueFlags): { id: string; label: string; blurb: string; feeds: number; polymarket: string[]; kalshi: string[]; guided: string | null; adjudicatedOnly: boolean }[] {
  return cats.map((c) => ({ id: c.id, label: c.label, blurb: c.blurb, feeds: venues.feeds ? feeds.filter((f) => c.feeds.includes(baseId(f.id))).length + (c.native?.length ?? 0) : 0, polymarket: venues.polymarket ? c.polymarket : [], kalshi: venues.kalshi ? c.kalshi : [], guided: c.guided ?? null, adjudicatedOnly: c.adjudicatedOnly ?? false }));
}

/** One category's cards: feeds first (in the config's order), then Polymarket events, then Kalshi series; an optional text filter over title and source. */
export function categoryCards(c: CategoryDef, parts: { feeds: readonly FeedCardInput[]; polymarket: readonly PolyEventHit[]; kalshi: readonly (BrowseSeries & { refused: string[] })[] }, o: { q?: string | null } = {}): SourceCard[] {
  const order = (id: string) => { const i = c.feeds.indexOf(baseId(id)); return i < 0 ? 999 : i; };
  const feeds = parts.feeds.filter((f) => c.feeds.includes(baseId(f.id))).sort((a, b) => order(a.id) - order(b.id)).map(feedCard);
  const seen = new Set<string>();
  const poly = parts.polymarket.filter((e) => (seen.has(e.slug) ? false : (seen.add(e.slug), true))).map(polymarketCard);
  const kal = parts.kalshi.map(kalshiCard);
  const q = (o.q ?? "").trim().toLowerCase();
  return [...nativeCards(c), ...feeds, ...poly, ...kal].filter((s) => !q || `${s.title} ${s.venueLabel} ${s.sourceName ?? ""} ${s.id}`.toLowerCase().includes(q));
}
