import fs from "node:fs";
import path from "node:path";
import type { BrowseSeries } from "@/lib/burnticker/oracle/browse";
import type { PolyEventHit } from "@/lib/burnticker/oracle/polymarket";
import type { VenueFlags } from "@/lib/burnticker/venues";
import { leagueProvenance, SPORTS_CHIP, SPORTS_SOURCE_NAME } from "@/lib/burnticker/sources/provenance";
import type { LeagueId } from "@/lib/burnticker/sources/espn";
import { isSingleSourceSeries, singleSourceSentence } from "@/lib/burnticker/singleSource";
import { fold } from "@/lib/burnticker/textMatch";
import { paramExampleNote } from "@/lib/burnticker/paramNames";

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

export interface CategoryDef { id: string; label: string; blurb: string; feeds: string[]; polymarket: string[]; kalshi: string[]; native?: string[]; guided?: "elections" | null; adjudicatedOnly?: boolean; /** L11: a Polymarket event joins this category only when its title matches (a broad Gamma tag carries unrelated markets) */ polymarketTitle?: string | null }
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
    return { id: x.id, label: String(x.label ?? x.id), blurb: String(x.blurb ?? ""), feeds: list(x.feeds), polymarket: list(x.polymarket), kalshi: list(x.kalshi), native: list(x.native), polymarketTitle: typeof x.polymarketTitle === "string" && x.polymarketTitle ? x.polymarketTitle : null, guided: x.guided === "elections" ? "elections" : null, adjudicatedOnly: x.adjudicatedOnly === true };
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
  /** website-15 item 8: a feed's own parse refusals ("schema: no rows at …"), shown only behind Details; never the refuse list */
  diagnostics?: string[];
  sourceName: string | null; sourceUrl: string | null; pick: SourcePick;
  /** sources-3: how the source settles when it is not the usual primary plus cross-read (the single official source sentence). */
  settlement?: string | null;
  /** A native family card that needs one more choice before it is a rule: a team (the Team coin picker) or a station + threshold. */
  configure: { kind: "team"; league: string } | { kind: "weather"; metric: "high" | "rain" | "snow" } | null;
  /** sources-4 (audit 213): an event whose title leaves a blank: its child markets, one of which must be chosen. */
  outcomes?: { question: string; market: string }[];
  /** sources-4 (audit 205): a parameterised source shows one checked example; this says so and that another choice is read at review. */
  paramNote?: string | null;
}

const LEAGUE_LABEL: Record<string, string> = { nfl: "NFL", nba: "NBA", mlb: "MLB", nhl: "NHL" };
/** The category's native first-party families as cards (espn:<league>, nws:<metric>). */
export function nativeCards(c: CategoryDef): SourceCard[] {
  return (c.native ?? []).map((n): SourceCard | null => {
    const [fam, arg] = n.split(":");
    if (fam === "espn" && LEAGUE_LABEL[arg]) return { id: `native:${n}`, venue: "feed", venueLabel: SPORTS_CHIP, tier: 4, tierLabel: "read by the operator's automation from the leagues' own feeds and a licensed sports data compiler", title: `${LEAGUE_LABEL[arg]} team results (pick a team)`, cadence: "every game day", kind: "scalar", next: null, example: "burns every time your team wins (or loses)", launchable: { ok: true, why: null }, refused: [], flags: [`confirmed by: ${leagueProvenance(arg as LeagueId).confirmation}`, `schedule: ${leagueProvenance(arg as LeagueId).schedule}`], sourceName: SPORTS_SOURCE_NAME, sourceUrl: null, pick: { oracle: "catalogue", series: null, market: null, title: `${LEAGUE_LABEL[arg]} team results` }, configure: { kind: "team", league: arg } };
    if (fam === "nws" && ["high", "rain", "snow"].includes(arg)) { const m = arg as "high" | "rain" | "snow"; return { id: `native:${n}`, venue: "feed", venueLabel: "National Weather Service", tier: 4, tierLabel: "read by the operator's automation from the original publisher", title: m === "high" ? "Daily high at a station" : m === "rain" ? "Rain day at a station" : "First snow of the season", cadence: m === "snow" ? "once a season" : "daily (the morning after)", kind: "scalar", next: null, example: m === "high" ? "burns every day the high reaches your threshold" : m === "rain" ? "burns every day the rain reaches your threshold" : "burns once, on the first measurable snow", launchable: { ok: true, why: null }, refused: [], flags: ["official daily climate report (CLI), final reports only"], sourceName: "NWS daily climate · first-party, public domain", sourceUrl: "https://api.weather.gov", pick: { oracle: "catalogue", series: null, market: null, title: "" }, configure: { kind: "weather", metric: m } }; }
    return null;
  }).filter((x): x is SourceCard => x !== null);
}

/** The catalogue card fields Browse reads (handlers.ts catalogueSources builds them). */
export interface FeedCardInput { id: string; tier: number; tierLabel: string; title: string; sourceName: string; sourceUrl: string; cadence: string; unit: { label: string } | null; launchable: { ok: boolean; why: string | null }; flags: string[]; lastReading: { id: string; value: string | null } | null; refusals?: string[]; /** sources-4: when the saved sample was observed (audit 202) and how the rule measures (audit 201) */ fixtureFetchedAt?: string | null; baseline?: "previousSettlement" | number | null; direction?: "up" | "down" | "abs" | null; param?: string | null }

const baseId = (id: string) => id.split(":")[0];

/**
 * THE CARD'S EXAMPLE FROM A SOURCE'S UNIT (website-20 item 101, 2026-10-12: a one-time launch source read "burns for every the launch
 * succeeds"). Two sentence shapes: a COUNTED unit ("1 launch", "$1B added", "1,000 stars") reads "burns for every launch", with a
 * leading "1 " dropped so one unit reads as a noun; a ONE-TIME outcome (a unit written as a clause, "the launch succeeds", or "the
 * milestone") reads "burns once if the launch succeeds" or "burns once when the count reaches the milestone". The same for a card
 * whose source is unavailable on this host. No unit: "burns on each settled reading".
 */
export function unitExample(unit: { label: string } | null, measured?: { baseline?: "previousSettlement" | number | null; direction?: "up" | "down" | "abs" | null; snapshot?: boolean }): string {
  if (!unit) return "burns on each settled reading";
  const l = unit.label.trim();
  if (/^the milestone$/i.test(l)) return "burns once when the count reaches the milestone";
  if (/^the\s/i.test(l)) return `burns once if ${l}`;
  // audit 201: a rule measured against the previous reading burns for each full CHANGE of the unit, never for a total
  if (measured?.baseline === "previousSettlement") {
    const u = l.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+(added|moved|move)$/, "").replace(/-point\b/, " point"), prev = `the previous ${measured.snapshot ? "snapshot" : "reading"}`;
    return measured.direction === "abs" ? `burns for each full change of ${u}, up or down, since ${prev}` : `burns for each full ${measured.direction === "down" ? "decrease" : "increase"} of ${u} over ${prev}`;
  }
  return `burns for every ${l.replace(/^1\s+(?=\D)/, "")}`;
}

/**
 * A SAVED SAMPLE IS NOT A LIVE READ (audit item 202): a catalogue card's reading comes from the source's saved fixture, so it is labelled
 * "Sample reading" with the day the sample was observed. "Latest reading" is kept for a live read the keeper verified, and nothing about
 * a source's health is inferred from a sample.
 */
export function sampleReadingLabel(r: { id: string; value: string | null }, observedAt: string | null | undefined): string {
  return `Sample reading ${r.id}${r.value !== null ? `: ${r.value}` : ""}${observedAt ? `, observed ${observedAt.slice(0, 10)}` : ", from a saved sample"}`;
}

/**
 * EVENT TITLES WITH A BLANK (audit item 213: "Bitcoin above ___ on October 13?"). Polymarket fills the blank per child market. One
 * market: its own question is the title. Several: the blank stays a choice, the card says so, and the whole event is not offered as one
 * pick; the child markets are listed so the page can ask for one (WIRING-SOURCES4.md).
 */
export const TITLE_BLANK_RE = /_{3,}/;
export function resolveBlankTitle(e: Pick<PolyEventHit, "title" | "markets" | "marketCount">): { title: string; outcomeRequired: boolean } {
  if (!TITLE_BLANK_RE.test(e.title)) return { title: e.title, outcomeRequired: false };
  const one = e.markets.length === 1 && e.marketCount === 1 ? e.markets[0] : null;
  if (one) return { title: one.question, outcomeRequired: false };
  return { title: `${e.title.replace(/\s*_{3,}\s*/g, " … ").replace(/\s+([?.,])/g, "$1").trim()} (choose one of ${e.marketCount} markets)`, outcomeRequired: true };
}
export const OUTCOME_REQUIRED_WHY = "This event's title leaves a date or value blank, and each of its markets fills it differently. Choose one market.";

/**
 * WHO PUBLISHES WHAT A FEED CARD READS (website-20 item 108, 2026-10-12: every tier-4 card said "primary API", Launch Library included).
 * Three roles, kept apart: the ORIGINAL PUBLISHER of the figure, a REDISTRIBUTOR that compiles or republishes other publishers' records,
 * and Burnticker's keeper, which only reads. A feed not listed here is read from its original publisher. Pure.
 */
export const REDISTRIBUTORS: Record<string, string> = {
  "ll2.launches": "The Space Devs, which compiles launch providers' announcements", "ll2.provider": "The Space Devs, which compiles launch providers' announcements", "ll2.launch": "The Space Devs, which compiles launch providers' announcements",
  "fred.UNRATE": "FRED, which republishes the Bureau of Labor Statistics figure", "fred.CPIAUCSL": "FRED, which republishes the Bureau of Labor Statistics figure", "fred.APU0000708111": "FRED, which republishes the Bureau of Labor Statistics figure",
  "fred.GFDEBTN": "FRED, which republishes the Treasury's figure", "defillama.tvl": "DefiLlama, which compiles each protocol's on-chain balances",
  "bom.weekendGross": "Box Office Mojo, which compiles studios' reported grosses", "bitcoin.blockHeight.blockstream": "Blockstream's explorer, which reads the Bitcoin chain",
};
export function sourceRoleLabel(id: string): string {
  const r = REDISTRIBUTORS[baseId(id)];
  return r ? `read by the operator's automation from ${r}` : "read by the operator's automation from the original publisher";
}

export function feedCard(f: FeedCardInput): SourceCard {
  return {
    id: `feed:${f.id}`, venue: "feed", venueLabel: f.sourceName, tier: f.tier, tierLabel: f.tier === 4 ? sourceRoleLabel(f.id) : f.tierLabel, title: f.title, cadence: f.cadence, kind: "scalar",
    next: f.lastReading ? { label: sampleReadingLabel(f.lastReading, f.fixtureFetchedAt), at: null } : null,
    example: unitExample(f.unit, { baseline: f.baseline, direction: f.direction, snapshot: /snapshot/i.test(f.cadence) }), launchable: f.launchable, refused: [], diagnostics: f.refusals ?? [], flags: f.flags,
    sourceName: f.sourceName, sourceUrl: f.sourceUrl, pick: { oracle: "catalogue", series: f.id, market: null, title: f.title }, configure: null,
    settlement: isSingleSourceSeries(f.id) ? singleSourceSentence(f.id) : null,
    paramNote: paramExampleNote(f.id, f.param ?? null),
  };
}

export function polymarketCard(e: PolyEventHit): SourceCard {
  const one = e.markets.length === 1 && e.marketCount === 1 ? e.markets[0] : null;
  const bt = resolveBlankTitle(e);
  return {
    id: `polymarket:${e.slug}`, venue: "polymarket", venueLabel: "Polymarket", tier: 1, tierLabel: "adjudicated market", title: bt.title, cadence: one ? "resolves once" : `${e.marketCount} markets`, kind: "binary",
    next: e.endDate ? { label: "ends", at: e.endDate } : null,
    example: one ? `burns when it resolves ${one.yes}` : `burns when a market of this event resolves YES`,
    launchable: bt.outcomeRequired && e.refused.length === 0 ? { ok: false, why: OUTCOME_REQUIRED_WHY } : { ok: e.refused.length === 0 && e.marketCount > 0, why: e.refused.length ? "refused" : e.marketCount === 0 ? "no binary market" : null },
    refused: e.refused, flags: [], sourceName: "Polymarket (result read on Polygon)", sourceUrl: e.url,
    pick: one ? { oracle: "polymarket", series: null, market: one.conditionId, title: `${one.question} (resolves once)` } : { oracle: "polymarket", series: `event:${e.slug}`, market: null, title: bt.title }, configure: null,
    ...(bt.outcomeRequired ? { outcomes: e.markets.map((m) => ({ question: m.question, market: m.conditionId })) } : {}),
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
  // launch audit 5 L11: a category with a title pattern keeps only the events that are about it (the weather tags carried IPO, moon
  // landing and pandemic markets); the pattern is the category's own (categories.json), never a policy decision
  const fits = c.polymarketTitle ? new RegExp(c.polymarketTitle, "i") : null;
  const poly = parts.polymarket.filter((e) => (!fits || fits.test(e.title)) && (seen.has(e.slug) ? false : (seen.add(e.slug), true))).map(polymarketCard);
  const kal = parts.kalshi.map(kalshiCard);
  return [...nativeCards(c), ...feeds, ...poly, ...kal].filter((s) => sourceFilterMatch(o.q, `${s.title} ${s.venueLabel} ${s.sourceName ?? ""} ${s.id}`));
}

/**
 * THE SOURCE FILTER (website-20 item 115, 2026-10-12): case, spaces, apostrophes, periods, hyphens and accents do not matter ("solar-flares",
 * "SOLAR FLARES" and "solarflares" all find "Solar flares"; "o'neil" finds "ONeil"). It only narrows the list: a query that matches
 * nothing shows nothing, and no other source is substituted for it.
 */
export function sourceFilterMatch(q: string | null | undefined, haystack: string): boolean {
  const f = fold(q ?? "");
  if (!f) return true;
  const h = fold(haystack);
  return h.includes(f) || h.replace(/ /g, "").includes(f.replace(/ /g, ""));
}
