import { safeRegexTest } from "@/lib/burnticker/safeRegex";
import type { BurnRule } from "@/lib/burnticker/rules";
import { canonicalDecimal, numToDec, type SettledEvent } from "@/lib/burnticker/units";
import type { FetchLike, ImpliedChance, OpenMarketSummary, OracleAdapter, ResolvedSelector, SeriesSummary } from "@/lib/burnticker/oracle/types";
import { aliasLookup, buildTeams, matchEvents, matchupLeagues, parseEventsBody, seasonStart, type EventHit, type KalshiEvent, type MatchupLeague, type TeamRow } from "@/lib/burnticker/oracle/events";
import { categoryPage, parseBrowseSeriesList, parseTagsByCategories, seriesExample, summariseEvents, type BrowseSeries, type CategoryPage, type KalshiCategory } from "@/lib/burnticker/oracle/browse";
import { sourceForUrl, takeOrThrow } from "@/lib/burnticker/apiBudget";
import { LruMap } from "@/lib/burnticker/lru";

/**
 * THE KALSHI ORACLE (the PRIMARY event source; the owner, 2026-10-09). Public, keyless: https://api.elections.kalshi.com/trade-api/v2
 *   GET /series?category=…            the directory (ticker, title, category, frequency, settlement_sources)
 *   GET /series/{ticker}
 *   GET /markets?series_ticker=…&status=settled&limit=…&cursor=…    settled markets, newest first, cursor-paged
 *   GET /markets?series_ticker=…&status=open                         the next ones (prices: DISPLAY ONLY)
 *   GET /markets/{ticker}
 *   GET /events?series_ticker=…&status=open&with_nested_markets=true    the games / contests themselves (event search; events.ts)
 *   GET /search/tags_by_categories    the category → tag tree Kalshi navigates by (browse.ts; the wizard's Browse path)
 *
 * SETTLED RESULTS ONLY. A market counts when it is FINAL: status "finalized", or status "settled" once `settlement_ts +
 * settlement_timer_seconds` has passed (the finalisation window the API exposes: 300 s on the series probed 10-09). `result` is
 * yes/no; a cancelled / voided / annulled market is a VOID (a receipt with no burn). Prices (yes_bid/ask, last) are parsed only for
 * the page's "market-implied chance" and never reach the rule.
 *
 * SCALAR VALUES. Kalshi publishes the settled number on every market of an event as `expiration_value` ("84.00", "7765.36", "0.4").
 * When it is numeric it is the value. When it is not (a team name, "winner", blank), the value is DERIVED FROM THE STRIKE LADDER,
 * deterministically: the `between` market that settled YES → its floor_strike; else the highest-floor `greater` market that settled
 * YES → its floor_strike; else the lowest-cap `less` market that settled YES → its cap_strike; else VOID. The method is recorded on
 * the reading so a stranger knows which rule produced the number.
 *
 * POLITE. One client, an in-memory cache per URL (series 1 h, settled 5 min, open 60 s), ≥ 250 ms between requests, a page cap, a
 * User-Agent that names us. Every fetch takes an injectable `fetchImpl`, so the tests run on the frozen fixtures and never touch the API.
 */

export const KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2";
export const KALSHI_UA = "burnticker/0.1 (+https://github.com/; event-indexed burn receipts; settled results only)";

export interface KalshiMarket {
  ticker: string; eventTicker: string; seriesTicker: string; title: string; subtitle: string | null;
  status: string; result: "yes" | "no" | "" | "void"; marketType: string | null; strikeType: string | null; floorStrike: number | null; capStrike: number | null;
  expirationValue: string; settlementValueDollars: string | null; settlementTs: string | null; settlementTimerSeconds: number | null; closeTime: string | null;
  /** Display only. */
  yesBid: number | null; yesAsk: number | null; lastPrice: number | null;
  rulesPrimary: string | null;
  /** The market's YES label (e.g. "Philadelphia" on a game leg). */
  label?: string | null;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Series ticker from a market ticker: everything before the first '-' ("KXNFLGAME-26OCT04DENSF-DEN" → "KXNFLGAME"). */
export const seriesTickerOf = (marketTicker: string): string => marketTicker.split("-")[0];

export function parseMarket(raw: unknown): KalshiMarket | null {
  const m = raw as Record<string, unknown> | null;
  if (!m || typeof m.ticker !== "string" || typeof m.event_ticker !== "string") return null;
  const result = m.result === "yes" || m.result === "no" || m.result === "void" ? m.result : "";
  return {
    ticker: m.ticker, eventTicker: m.event_ticker, seriesTicker: seriesTickerOf(m.ticker), title: String(m.title ?? ""), subtitle: str(m.subtitle),
    status: String(m.status ?? ""), result, marketType: str(m.market_type), strikeType: str(m.strike_type), floorStrike: num(m.floor_strike), capStrike: num(m.cap_strike),
    expirationValue: String(m.expiration_value ?? ""), settlementValueDollars: str(m.settlement_value_dollars), settlementTs: str(m.settlement_ts), settlementTimerSeconds: num(m.settlement_timer_seconds), closeTime: str(m.close_time),
    yesBid: num(m.yes_bid_dollars), yesAsk: num(m.yes_ask_dollars), lastPrice: num(m.last_price_dollars), rulesPrimary: str(m.rules_primary), label: str(m.yes_sub_title),
  };
}

export function parseMarketsBody(body: unknown): { markets: KalshiMarket[]; cursor: string | null; refusals: string[] } {
  const b = body as { markets?: unknown; cursor?: unknown } | null;
  if (!b || !Array.isArray(b.markets)) return { markets: [], cursor: null, refusals: ["schema: no markets[] in the response"] };
  const out: KalshiMarket[] = [], refusals: string[] = [];
  for (const raw of b.markets) { const m = parseMarket(raw); if (m) out.push(m); else refusals.push(`schema: a market row without ticker/event_ticker`); }
  return { markets: out, cursor: typeof b.cursor === "string" && b.cursor ? b.cursor : null, refusals };
}

export function parseSeriesBody(body: unknown): SeriesSummary | null {
  const s = (body as { series?: Record<string, unknown> } | null)?.series ?? (body as Record<string, unknown> | null);
  if (!s || typeof s.ticker !== "string") return null;
  const src = Array.isArray(s.settlement_sources) ? (s.settlement_sources as { name?: string; url?: string }[]).find((x) => typeof x?.url === "string") : null;
  return { oracle: "kalshi", ticker: s.ticker, title: String(s.title ?? s.ticker), category: str(s.category), frequency: str(s.frequency), settlementSource: src ? { name: String(src.name ?? ""), url: String(src.url) } : null, tags: Array.isArray(s.tags) ? (s.tags as unknown[]).map(String) : [] };
}

export function parseSeriesListBody(body: unknown): SeriesSummary[] {
  const list = (body as { series?: unknown[] } | null)?.series;
  return Array.isArray(list) ? list.map((x) => parseSeriesBody({ series: x })).filter((x): x is SeriesSummary => !!x) : [];
}

export const isVoid = (m: KalshiMarket): boolean => /^(cancel+ed|voided|annulled|void)$/i.test(m.status) || m.result === "void";

/** Final = the venue will not change it: finalized, or settled and past the finalisation timer. */
export function isFinal(m: KalshiMarket, nowMs: number): boolean {
  if (isVoid(m)) return true;
  if (m.result !== "yes" && m.result !== "no") return false;
  if (m.status === "finalized") return true;
  if (m.status === "settled" && m.settlementTs) return nowMs >= Date.parse(m.settlementTs) + (m.settlementTimerSeconds ?? 0) * 1000;
  return false;
}

/** Settled but still inside the timer: counted so the keeper knows to come back. */
export const isAwaitingFinal = (m: KalshiMarket, nowMs: number): boolean => (m.result === "yes" || m.result === "no") && !isFinal(m, nowMs) && (m.status === "settled" || m.status === "finalized");

export interface EventValue { value: string | null; method: "expiration_value" | "ladder-between" | "ladder-greater" | "ladder-less" | "void" | "none"; note: string }

/** The settled scalar of one event from its markets (see the header for the derivation order). */
export function eventValue(markets: readonly KalshiMarket[]): EventValue {
  if (!markets.length) return { value: null, method: "none", note: "no markets" };
  if (markets.every(isVoid)) return { value: null, method: "void", note: "every market of the event is void" };
  const ev = markets.map((m) => m.expirationValue.trim()).find((v) => /^-?\d+(\.\d+)?$/.test(v));
  if (ev) return { value: canonicalDecimal(ev), method: "expiration_value", note: `Kalshi's expiration_value ${ev}` };
  const yes = markets.filter((m) => m.result === "yes");
  const between = yes.filter((m) => m.strikeType === "between" && m.floorStrike !== null);
  if (between.length) return { value: numToDec(between[0].floorStrike!), method: "ladder-between", note: `The between band ${between[0].ticker} settled YES, so the value is its floor, ${between[0].floorStrike}.` };
  const greater = yes.filter((m) => m.strikeType === "greater" && m.floorStrike !== null).sort((a, b) => b.floorStrike! - a.floorStrike!);
  if (greater.length) return { value: numToDec(greater[0].floorStrike!), method: "ladder-greater", note: `The highest "greater" strike that settled YES is ${greater[0].ticker}, so the value is ${greater[0].floorStrike}.` };
  const less = yes.filter((m) => m.strikeType === "less" && m.capStrike !== null).sort((a, b) => a.capStrike! - b.capStrike!);
  if (less.length) return { value: numToDec(less[0].capStrike!), method: "ladder-less", note: `The lowest "less" strike that settled YES is ${less[0].ticker}, so the value is ${less[0].capStrike}.` };
  return { value: null, method: "none", note: "no numeric expiration_value and no YES on the ladder" };
}

/** Does this market fall under the rule's selector? */
export function selectorMatches(rule: BurnRule, m: KalshiMarket): boolean {
  if (rule.oracle !== "kalshi") return false;
  if (rule.market) return m.ticker === rule.market;
  if (m.seriesTicker !== rule.series) return false;
  if (rule.filter.tickerIncludes && !m.ticker.includes(rule.filter.tickerIncludes)) return false;
  if (rule.filter.titleRegex && !safeRegexTest(rule.filter.titleRegex, m.title)) return false;   // audit 6 item 8: a refused pattern never runs
  return true;
}

export const marketApiUrl = (ticker: string): string => `${KALSHI_API}/markets/${encodeURIComponent(ticker)}`;
export const seriesApiUrl = (ticker: string): string => `${KALSHI_API}/series/${encodeURIComponent(ticker)}`;
export const settledMarketsUrl = (series: string, limit = 200, cursor: string | null = null): string => `${KALSHI_API}/markets?series_ticker=${encodeURIComponent(series)}&status=settled&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
export const openMarketsUrl = (series: string, limit = 100): string => `${KALSHI_API}/markets?series_ticker=${encodeURIComponent(series)}&status=open&limit=${limit}`;
export const eventsUrl = (series: string, status = "open", cursor: string | null = null): string => `${KALSHI_API}/events?series_ticker=${encodeURIComponent(series)}&status=${encodeURIComponent(status)}&with_nested_markets=true&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
export const seriesListUrl = (category?: string): string => `${KALSHI_API}/series${category ? `?category=${encodeURIComponent(category)}` : ""}`;
export const tagsByCategoriesUrl = (): string => `${KALSHI_API}/search/tags_by_categories`;
/** One category's series with Kalshi's traded volume (ordering only — browse.ts). */
export const seriesByCategoryUrl = (category: string): string => `${KALSHI_API}/series?category=${encodeURIComponent(category)}&include_volume=true`;

/**
 * Pure: the rule's settled events from a bag of markets (any order, any series). Binary rules yield one event per final market;
 * scalar rules one per Kalshi event (the ladder), valued per `eventValue`. `sinceIso` keeps only settlements strictly after it.
 */
export function resolveSelector(rule: BurnRule, markets: readonly KalshiMarket[], opts: { nowMs: number; sinceIso: string | null; settlementSourceUrl?: string | null }): ResolvedSelector {
  const refusals: string[] = [];
  const matching = markets.filter((m) => selectorMatches(rule, m));
  const awaitingFinal = matching.filter((m) => isAwaitingFinal(m, opts.nowMs)).length;
  const final = matching.filter((m) => isFinal(m, opts.nowMs));
  const after = (at: string | null) => at !== null && (opts.sinceIso === null || at > opts.sinceIso);
  const events: SettledEvent[] = [];
  if (rule.kind === "binary") {
    for (const m of final) {
      if (!m.settlementTs && !isVoid(m)) { refusals.push(`${m.ticker}: final but no settlement_ts`); continue; }
      const at = m.settlementTs ?? m.closeTime ?? null;
      if (!after(at)) continue;
      events.push({ id: m.ticker, at: at!, result: isVoid(m) ? "void" : (m.result as "yes" | "no"), value: null, title: m.title || null, sourceUrl: marketApiUrl(m.ticker) });
    }
  } else {
    const byEvent = new Map<string, KalshiMarket[]>();
    for (const m of final) byEvent.set(m.eventTicker, [...(byEvent.get(m.eventTicker) ?? []), m]);
    for (const [eventTicker, ms] of byEvent) {
      // An event is read only when NONE of its matching markets is still pending — half a ladder has no settled value.
      if (matching.some((m) => m.eventTicker === eventTicker && !isFinal(m, opts.nowMs))) continue;
      const at = ms.map((m) => m.settlementTs ?? m.closeTime ?? "").filter(Boolean).sort().pop() ?? null;
      if (!after(at)) continue;
      const v = eventValue(ms);
      if (v.method === "none") { refusals.push(`${eventTicker}: ${v.note} — held, not read`); continue; }
      events.push({ id: eventTicker, at: at!, result: v.value === null ? "void" : null, value: v.value, title: ms[0].title.replace(/\s*(be|close|settle)?\s*(>|<|between|above|below|at or above|at or below)\s.*$/i, ""), sourceUrl: `${KALSHI_API}/markets?event_ticker=${encodeURIComponent(eventTicker)}`, method: `${v.method}: ${v.note}` });
    }
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  return { events, awaitingFinal, refusals, settlementSourceUrl: opts.settlementSourceUrl ?? null };
}

const mid = (m: KalshiMarket): number | null => (m.yesBid !== null && m.yesAsk !== null ? (m.yesBid + m.yesAsk) / 2 : m.lastPrice ?? m.yesBid ?? m.yesAsk);

/** Pure: the market-implied chance that the NEXT settlement burns. DISPLAY ONLY; approximate for ladders (sums the bands beyond the threshold). */
export function impliedChanceFrom(rule: BurnRule, open: readonly KalshiMarket[], prevValue: string | null): ImpliedChance {
  const matching = open.filter((m) => selectorMatches(rule, m) && m.closeTime).sort((a, b) => (a.closeTime! < b.closeTime! ? -1 : 1));
  if (!matching.length) return { chance: null, marketTicker: null, closeTime: null, basis: "There is no open market for this rule." };
  if (rule.kind === "binary") {
    const m = matching[0];
    const p = mid(m);
    const onYes = !!rule.binary?.onYes, onNo = !!rule.binary?.onNo;
    const chance = p === null ? null : onYes && onNo ? 1 : onYes ? p : 1 - p;
    return { chance, marketTicker: m.ticker, closeTime: m.closeTime, basis: onYes && onNo ? "both outcomes burn (onYes and onNo): a settlement burns unless voided" : onYes ? `YES mid-price of ${m.ticker}` : `1 − YES mid-price of ${m.ticker} (this side burns on NO)` };
  }
  const s = rule.scalar!;
  const next = matching.filter((m) => m.eventTicker === matching[0].eventTicker);
  const base = s.baseline === "previousSettlement" ? (prevValue === null ? null : Number(prevValue)) : s.baseline;
  if (base === null) return { chance: null, marketTicker: next[0].eventTicker, closeTime: next[0].closeTime, basis: "There is no earlier result yet to measure against." };
  const upT = base + s.unit, downT = base - s.unit;
  let p = 0, any = false;
  for (const m of next) {
    const q = mid(m); if (q === null) continue;
    const up = s.direction !== "down" && ((m.strikeType === "between" && m.floorStrike !== null && m.floorStrike >= upT) || (m.strikeType === "greater" && m.floorStrike !== null && m.floorStrike >= upT - 1e-9));
    const down = s.direction !== "up" && ((m.strikeType === "between" && m.capStrike !== null && m.capStrike <= downT) || (m.strikeType === "less" && m.capStrike !== null && m.capStrike <= downT + 1e-9));
    if (up || down) { p += q; any = true; }
  }
  return { chance: any ? Math.min(1, p) : 0, marketTicker: next[0].eventTicker, closeTime: next[0].closeTime, basis: `This is the sum of the YES mid-prices for the ${next[0].eventTicker} bands that sit at least one unit of ${s.unit} ${s.direction === "abs" ? "away from" : s.direction === "up" ? "above" : "below"} ${base}.` };
}

export function summariseOpen(open: readonly KalshiMarket[], rule: BurnRule, limit = 12): OpenMarketSummary[] {
  return open.filter((m) => selectorMatches(rule, m)).sort((a, b) => ((a.closeTime ?? "") < (b.closeTime ?? "") ? -1 : 1)).slice(0, limit)
    .map((m) => ({ ticker: m.ticker, title: m.title, closeTime: m.closeTime, yesPrice: mid(m), strikeType: m.strikeType, floorStrike: m.floorStrike, capStrike: m.capStrike }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The client: cache + rate limit + paging
// ---------------------------------------------------------------------------------------------------------------------------------

export const KALSHI_CATEGORIES = ["Economics", "Financials", "Politics", "Elections", "Climate and Weather", "Sports", "Science and Technology", "Entertainment", "Companies", "Crypto", "Health", "World", "Transportation", "Social", "Mentions"];
/** Series scanned for events when a query names no team and no series: the headline head-to-head leagues. */
export const HEADLINE_EVENT_SERIES = ["KXNFLGAME", "KXNBAGAME", "KXMLBGAME", "KXNHLGAME", "KXNCAAFGAME", "KXEPLGAME", "KXMLSGAME", "KXUCLGAME"];
/** Categories whose series titles are matched word by word to pick extra series to scan for events (people, entities, shows). */
export const EVENT_SEARCH_CATEGORIES = ["Elections", "Politics", "Mentions", "Entertainment", "Sports"];
export const EVENTS_TTL_MS = 600_000;

export interface KalshiClientOpts { fetchImpl?: FetchLike; now?: () => number; minIntervalMs?: number; timeoutMs?: number; pageCap?: number; ttl?: { series: number; settled: number; open: number } }

export class KalshiClient implements OracleAdapter {
  readonly id = "kalshi" as const;
  private fetchImpl: FetchLike;
  private now: () => number;
  private minInterval: number;
  private timeoutMs: number;
  private pageCap: number;
  private ttl: { series: number; settled: number; open: number };
  // prelaunch audit M8 (2026-10-15): bounded; a search or event URL is per query, so the cache grew with every distinct query
  private cache = new LruMap<string, { at: number; body: unknown }>(1_000);
  private lastAt = 0;
  private chain: Promise<void> = Promise.resolve();
  /** Requests actually sent (for the tests' politeness checks). */
  requests: string[] = [];

  constructor(o: KalshiClientOpts = {}) {
    this.fetchImpl = o.fetchImpl ?? (fetch as unknown as FetchLike);
    this.now = o.now ?? (() => Date.now());
    this.minInterval = o.minIntervalMs ?? 250;
    this.timeoutMs = o.timeoutMs ?? 20_000;
    this.pageCap = o.pageCap ?? 10;
    this.ttl = o.ttl ?? { series: 3_600_000, settled: 300_000, open: 60_000 };
  }

  /** GET with cache; one request in flight at a time, spaced by minInterval. */
  async get(url: string, ttlMs: number): Promise<unknown> {
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.at < ttlMs) return hit.body;
    const run = async (): Promise<unknown> => {
      const wait = this.lastAt + this.minInterval - this.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastAt = this.now();
      await takeOrThrow(sourceForUrl(url));   // the request budget (apiBudget.ts), before the timeout starts
      this.requests.push(url);
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, { signal: ac.signal, headers: { accept: "application/json", "user-agent": KALSHI_UA } });
        if (!res.ok) throw new Error(`Kalshi HTTP ${res.status} for ${url.slice(0, 120)}`);
        const body = await res.json();
        this.cache.set(url, { at: this.now(), body });
        return body;
      } finally { clearTimeout(t); }
    };
    const p = this.chain.then(run, run);
    this.chain = p.then(() => undefined, () => undefined);
    return p;
  }

  async seriesInfo(ticker: string): Promise<SeriesSummary | null> {
    return parseSeriesBody(await this.get(seriesApiUrl(ticker), this.ttl.series));
  }

  async searchSeries(query: string, opts: { category?: string; limit?: number } = {}): Promise<SeriesSummary[]> {
    const q = query.trim().toLowerCase();
    const cats = opts.category ? [opts.category] : KALSHI_CATEGORIES;
    const all: SeriesSummary[] = [];
    for (const c of cats) {
      try { all.push(...parseSeriesListBody(await this.get(seriesListUrl(c), this.ttl.series))); } catch { /* a category the API does not know: skip */ }
    }
    const seen = new Set<string>();
    const scored = all.filter((s) => { if (seen.has(s.ticker)) return false; seen.add(s.ticker); return true; })
      .map((s) => ({ s, score: s.ticker.toLowerCase() === q ? 3 : s.ticker.toLowerCase().includes(q) ? 2 : s.title.toLowerCase().includes(q) ? 1 : s.tags.some((t) => t.toLowerCase().includes(q)) ? 0.5 : 0 }))
      .filter((x) => q === "" || x.score > 0).sort((a, b) => b.score - a.score || a.s.title.localeCompare(b.s.title));
    return scored.slice(0, opts.limit ?? 25).map((x) => x.s);
  }

  /** All settled markets of a series, newest first, paged until `sinceIso` is passed or the page cap is hit. */
  async settledMarkets(series: string, sinceIso: string | null, limitPages = this.pageCap): Promise<KalshiMarket[]> {
    const out: KalshiMarket[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < limitPages; page++) {
      const { markets, cursor: next, refusals } = parseMarketsBody(await this.get(settledMarketsUrl(series, 200, cursor), this.ttl.settled));
      if (refusals.length && !markets.length) throw new Error(refusals[0]);
      out.push(...markets);
      const oldest = markets.map((m) => m.settlementTs ?? "").filter(Boolean).sort()[0];
      if (!next || !markets.length || (sinceIso && oldest && oldest <= sinceIso)) break;
      cursor = next;
    }
    return out;
  }

  async settledSince(rule: BurnRule, sinceIso: string | null, opts: { limitPages?: number } = {}): Promise<ResolvedSelector> {
    const series = rule.series ?? (rule.market ? seriesTickerOf(rule.market) : null);
    if (!series) throw new Error("kalshi: the rule names no series or market");
    const [markets, info] = await Promise.all([
      rule.market ? parseMarketsBody({ markets: [(await this.get(marketApiUrl(rule.market), this.ttl.settled) as { market?: unknown })?.market] }).markets : this.settledMarkets(series, sinceIso, opts.limitPages),
      this.seriesInfo(series).catch(() => null),
    ]);
    return resolveSelector(rule, markets, { nowMs: this.now(), sinceIso, settlementSourceUrl: info?.settlementSource?.url ?? null });
  }

  /** Open (or closed / settled) events of one series with their nested markets; cached 10 minutes per series; at most `pages` pages of 200. */
  async eventsForSeries(series: string, status = "open", pages = 3): Promise<KalshiEvent[]> {
    const out: KalshiEvent[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < pages; i++) {
      const { events, cursor: next } = parseEventsBody(await this.get(eventsUrl(series, status, cursor), EVENTS_TTL_MS));
      out.push(...events);
      if (!next || !events.length) break;
      cursor = next;
    }
    return out;
  }

  /**
   * EVENT + MARKET SEARCH. Which series are scanned: `series` when given; else the league series of every team the query names
   * (the alias table: "eagles" → KXNFLGAME); else the headline head-to-head leagues plus up to six series from Elections, Politics,
   * Mentions, Entertainment and Sports whose title, ticker or tags contain a word of the query. Each series' events are cached 10 min.
   * A person who appears only in the market labels of a series whose title does not name them is found by passing that series.
   */
  async searchEvents(q: string, opts: { series?: string | null; status?: string; limit?: number } = {}): Promise<{ events: EventHit[]; scanned: string[]; teams: { league: string; abbr: string; city: string; nickname: string }[] }> {
    const teams = aliasLookup(q);
    let scan: string[];
    if (opts.series) scan = [opts.series.toUpperCase()];
    else if (teams.length) scan = [...new Set(teams.map((t) => t.series))];
    else {
      const words = q.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
      const extra: { t: string; n: number }[] = [];
      if (words.length) {
        for (const c of EVENT_SEARCH_CATEGORIES) {
          let list: SeriesSummary[] = [];
          try { list = parseSeriesListBody(await this.get(seriesListUrl(c), this.ttl.series)); } catch { /* skip */ }
          for (const x of list) { const hay = `${x.ticker} ${x.title} ${x.tags.join(" ")}`.toLowerCase(); const n = words.filter((w) => hay.includes(w)).length; if (n) extra.push({ t: x.ticker, n }); }
        }
      }
      const picked = [...new Map(extra.sort((a, b) => b.n - a.n).map((x) => [x.t, x])).keys()].filter((t) => !HEADLINE_EVENT_SERIES.includes(t)).slice(0, 6);
      scan = [...HEADLINE_EVENT_SERIES, ...picked];
    }
    const all: KalshiEvent[] = [];
    for (const series of scan) { try { all.push(...await this.eventsForSeries(series, opts.status ?? "open")); } catch { /* a series without events, or the API said no: skip */ } }
    return { events: matchEvents(all, q).slice(0, opts.limit ?? 40), scanned: scan, teams: teams.map((t) => ({ league: t.league, abbr: t.abbr, city: t.city, nickname: t.nickname })) };
  }

  /** The team picker for a game series: every team with its next game and its record since the season started (events.ts buildTeams). */
  async teams(series: string): Promise<{ series: string; since: string; teams: TeamRow[] }> {
    const s = series.toUpperCase();
    const since = seasonStart(s, this.now());
    const [open, settled] = await Promise.all([this.eventsForSeries(s, "open"), this.settledMarkets(s, since, 4).catch(() => [] as KalshiMarket[])]);
    return buildTeams(s, open, settled, this.now());
  }

  /** The wizard's league chooser, derived from Kalshi's Sports series list (head-to-head "…GAME" series). */
  async leagues(): Promise<MatchupLeague[]> {
    return matchupLeagues(parseSeriesListBody(await this.get(seriesListUrl("Sports"), this.ttl.series)));
  }

  /**
   * BROWSE (2026-10-10): Kalshi's categories in the order its API reports them, each with its tags and (with `counts`) its number of
   * series. The category list and every category's series list are cached 1 h (the series TTL); counts cost one request per category
   * on a cold cache. A category whose list fails reads `seriesCount: null`, never a guess.
   */
  async categories(o: { counts?: boolean } = {}): Promise<KalshiCategory[]> {
    const cats = parseTagsByCategories(await this.get(tagsByCategoriesUrl(), this.ttl.series));
    const out: KalshiCategory[] = [];
    for (const c of cats) {
      let seriesCount: number | null = null;
      if (o.counts !== false) { try { seriesCount = parseBrowseSeriesList(await this.get(seriesByCategoryUrl(c.category), this.ttl.series)).length; } catch { seriesCount = null; } }
      out.push({ ...c, seriesCount });
    }
    return out;
  }

  /**
   * One category's series, most traded first, filtered by a Kalshi tag and/or text, windowed. `withEvents` = how many of the returned
   * series also get their upcoming-event summary (open count, the next event and its close, whether the markets are a strike ladder) —
   * one events request per series, cached 10 min.
   */
  async seriesByCategory(category: string, o: { tag?: string | null; q?: string | null; limit?: number; offset?: number; withEvents?: number } = {}): Promise<CategoryPage> {
    const [all, cats] = await Promise.all([
      this.get(seriesByCategoryUrl(category), this.ttl.series).then(parseBrowseSeriesList),
      this.get(tagsByCategoriesUrl(), this.ttl.series).then(parseTagsByCategories).catch(() => []),
    ]);
    const page = categoryPage(category, all, { ...o, tagOrder: cats.find((c) => c.category === category)?.tags ?? [] });
    const n = Math.min(page.series.length, Math.max(0, o.withEvents ?? 0));
    const series: BrowseSeries[] = [];
    for (let i = 0; i < page.series.length; i++) {
      const s = page.series[i];
      if (i >= n) { series.push(s); continue; }
      try {
        const ev = summariseEvents(await this.eventsForSeries(s.ticker, "open", 1), this.now());
        // the markets decide: a strike ladder reads a number, plain markets a yes/no (no open event: the title's guess stands)
        const kindHint = ev.ladder ? "scalar" : ev.open > 0 ? "binary" : s.kindHint;
        series.push({ ...s, events: ev, kindHint, example: seriesExample(kindHint) });
      } catch { series.push(s); }
    }
    return { ...page, series };
  }

  async openMarkets(series: string): Promise<KalshiMarket[]> {
    return parseMarketsBody(await this.get(openMarketsUrl(series), this.ttl.open)).markets;
  }

  async impliedChance(rule: BurnRule, prevValue: string | null): Promise<ImpliedChance> {
    const series = rule.series ?? (rule.market ? seriesTickerOf(rule.market) : null);
    if (!series) return { chance: null, marketTicker: null, closeTime: null, basis: "The rule names no series." };
    return impliedChanceFrom(rule, await this.openMarkets(series), prevValue);
  }
}

/** A fetch over frozen bodies keyed by URL prefix — the tests' Kalshi. */
export function fixtureFetch(table: Record<string, unknown>): FetchLike {
  return async (url: string) => {
    const key = Object.keys(table).find((k) => url.startsWith(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => table[key] };
  };
}
