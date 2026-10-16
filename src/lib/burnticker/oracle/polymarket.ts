import { safeRegexTest } from "@/lib/burnticker/safeRegex";
import { POLY_EVENT_SERIES_RE, POLY_MARKET_RE, POLY_TAG_SERIES_RE, type BurnRule } from "@/lib/burnticker/rules";
import type { EventResult, SettledEvent } from "@/lib/burnticker/units";
import type { FetchLike, ImpliedChance, OracleAdapter, ResolvedSelector, SeriesSummary } from "@/lib/burnticker/oracle/types";
import { finalAfter, statedSource, type FinalAfter, type StatedSource } from "@/lib/burnticker/sources/polyStated";
import { DEFAULT_POLYGON_RPCS, POLYGON_CHAIN_ID, POLYMARKET_CTF, readConditionResolution, type ConditionResolution, type FetchLike as RpcFetchLike } from "@/lib/burnKeeper/attesters/polymarketOnchain";
import { sourceForUrl, takeOrThrow } from "@/lib/burnticker/apiBudget";
import { LruMap } from "@/lib/burnticker/lru";

/**
 * THE POLYMARKET ORACLE (2026-10-10; the owner: "do both" — Polymarket as a full second adjudicated oracle, tier 1, beside Kalshi).
 *
 * DISCOVERY is Gamma, Polymarket's public keyless API (https://gamma-api.polymarket.com):
 *   GET /public-search?q=…                         text search (events with their markets; `events_status=active` = open only)
 *   GET /events?slug=…                             one event and its markets
 *   GET /tags/slug/{slug}                          a tag's id and label
 *   GET /markets?tag_id=…&closed=true&end_date_min=…&end_date_max=…[&sports_market_types=moneyline]     a tag's closed markets, by end-date window
 *   GET /markets?tag_id=…&closed=false&order=endDate&ascending=true                                      … and its open ones (display)
 *   GET /markets?condition_ids=0x…&closed=true|false                                                      one market (Gamma needs `closed`)
 * Every response is cached 10 minutes; requests are spaced and serial; every fetch is injectable, so the tests run on frozen fixtures.
 *
 * THE RESULT IS READ FROM THE CHAIN. A Polymarket market is a Gnosis Conditional Tokens condition on Polygon. When it resolves, its
 * oracle reports a payout vector that the CTF contract stores forever (reportPayouts cannot run twice). The keeper reads that vector
 * with three eth_calls (src/lib/burnKeeper/attesters/polymarketOnchain.ts) and a reading is FINAL ONLY WHEN THE CHAIN HAS IT
 * (payoutDenominator > 0). Gamma's own report (closed + umaResolutionStatus "resolved" + outcomePrices exactly 1/0) is a cross-check
 * and the back-test's source; when the two disagree the chain is the record and the disagreement is reported. Binary only (two outcome
 * slots): slot 0 → YES (the market's first outcome label, "Yes" or e.g. "Buccaneers"), slot 1 → NO, a split payout (50-50) → VOID.
 * Prices (bestBid/bestAsk/lastTradePrice/outcomePrices on an open market) are parsed only for the display-only implied chance.
 *
 * Each reading carries `sourceUrl` = the Gamma market URL (condition id, closed=true) and `proof` = the on-chain locator:
 *   polygon:137/ctf:0x4D97DCd97eC945f40cF65F87097ACe5EA0476045/condition:0x…/payouts:1,0/block:<n>
 * (the reportPayouts transaction hash is not looked up: no keyless Polygon RPC reachable on 2026-10-10 serves eth_getLogs).
 *
 * WHY NO TEAM COIN / MATCHUP ON POLYMARKET (v1). A Polymarket game is an EVENT of ~300 markets (moneyline, spreads, totals, props);
 * its moneyline is ONE binary market whose outcomes are the two nicknames in the order the title lists them ("Broncos vs. 49ers" →
 * [Broncos, 49ers]; "Seahawks vs. Broncos" → [Seahawks, Broncos]). There is no per-team leg and no team-abbreviation field — teams
 * appear only in the slug convention (nfl-den-sf-2026-10-04, with Polymarket's own abbreviations: JAX where Kalshi says JAC) and in
 * outcome labels — so "every Broncos loss" has no fixed YES/NO across games. Team coins and matchup pairs stay on Kalshi; a Polymarket
 * game can still be paired as one one-shot market (side A burns on YES, side B on NO).
 */

export const GAMMA_API = "https://gamma-api.polymarket.com";
export const POLYMARKET_SITE = "https://polymarket.com";
export const POLYGONSCAN_CTF = `https://polygonscan.com/address/${POLYMARKET_CTF}#readContract`;
export const POLY_UA = "burnticker/0.1 (+https://github.com/; event-indexed burn receipts; settled results only)";
export const POLY_TTL_MS = 600_000;

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const list = (v: unknown): string[] => { if (Array.isArray(v)) return v.map(String); if (typeof v === "string") { try { const x = JSON.parse(v); return Array.isArray(x) ? x.map(String) : []; } catch { return []; } } return []; };

/** Gamma's timestamps ("2026-10-09 03:36:14+00", "2026-10-09T03:36:14Z", "2026-10-09T03:36:14.123Z") → "2026-10-09T03:36:14Z"; null when unparseable. */
export function normaliseTime(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(s.trim());
  let iso = s;
  if (m) { const off = m[3] ?? "Z"; iso = `${m[1]}T${m[2]}${off === "Z" ? "Z" : /^[+-]\d{2}$/.test(off) ? `${off}:00` : off.length === 5 ? `${off.slice(0, 3)}:${off.slice(3)}` : off}`; }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

export interface GammaMarket {
  id: string; conditionId: string; question: string; slug: string | null;
  eventSlug: string | null; eventTitle: string | null; tags: string[];
  outcomes: string[]; closed: boolean; active: boolean;
  umaResolutionStatus: string | null; resolvedBy: string | null; resolutionSource: string | null;
  endDate: string | null; closedTime: string | null; umaEndDate: string | null;
  negRisk: boolean; sportsMarketType: string | null;
  /** The outcome's name inside a multi-outcome event ("Abdul El-Sayed (D)"; "Person A" on an unnamed placeholder). */
  groupItemTitle: string | null;
  /** Gamma marks the market `active: false` (an unnamed placeholder such as "Person A"): never offered. */
  inactive: boolean;
  /** Gamma's per-outcome figures after resolution ("1","0" / "0.5","0.5"); read ONLY on a closed, resolved market as Gamma's report. */
  outcomeFigures: string[];
  /** DISPLAY ONLY: the YES side's mid (bestBid/bestAsk), else last trade, else the first outcome figure, on an open market. */
  yesPrice: number | null;
  /** The market's resolution rules (Gamma "description"; the event's when the market has none): sources/polyStated.ts reads its source sentence. */
  description?: string | null;
  /** The UMA liveness, in seconds, the adapter set for this question (Gamma "customLiveness"; 0 or absent = the 2-hour default). */
  customLiveness?: number | null;
  /** Gamma's history of UMA states for this market ("proposed", "disputed", "resolved"), oldest first. */
  umaStatuses?: string[];
  /** A game market's scheduled start (Gamma "gameStartTime"); an MLB game market's end date is a week after the game (walkthrough 2026-10-13). */
  gameStartTime?: string | null;
}

/** A Gamma market row (from /markets, /public-search or nested in /events) → the fields the adapter reads; null when not a market. */
export function parseGammaMarket(raw: unknown, ctx: { eventSlug?: string | null; eventTitle?: string | null; tags?: string[]; eventDescription?: string | null } = {}): GammaMarket | null {
  const m = raw as Record<string, unknown> | null;
  if (!m || typeof m.conditionId !== "string" || typeof m.question !== "string") return null;
  const ev = Array.isArray(m.events) ? (m.events[0] as Record<string, unknown> | undefined) : undefined;
  const bid = num(m.bestBid), ask = num(m.bestAsk), last = num(m.lastTradePrice), figures = list(m.outcomePrices);
  const closed = m.closed === true;
  return {
    id: String(m.id ?? ""), conditionId: m.conditionId.toLowerCase(), question: m.question, slug: str(m.slug),
    eventSlug: ctx.eventSlug ?? str(ev?.slug), eventTitle: ctx.eventTitle ?? str(ev?.title), tags: ctx.tags ?? [],
    outcomes: list(m.outcomes), closed, active: m.active === true,
    umaResolutionStatus: str(m.umaResolutionStatus), resolvedBy: str(m.resolvedBy), resolutionSource: str(m.resolutionSource),
    endDate: normaliseTime(m.endDate), closedTime: normaliseTime(m.closedTime), umaEndDate: normaliseTime(m.umaEndDate),
    negRisk: m.negRisk === true, sportsMarketType: str(m.sportsMarketType), groupItemTitle: str(m.groupItemTitle), inactive: m.active === false, outcomeFigures: figures,
    yesPrice: closed ? null : bid !== null && ask !== null ? (bid + ask) / 2 : last ?? num(figures[0]),
    description: str(m.description) ?? ctx.eventDescription ?? null, customLiveness: num(m.customLiveness), umaStatuses: list(m.umaResolutionStatuses),
    ...(normaliseTime(m.gameStartTime) ? { gameStartTime: normaliseTime(m.gameStartTime) } : {}),
  };
}

export interface GammaEvent { id: string; slug: string; title: string; closed: boolean; endDate: string | null; closedTime: string | null; tags: { slug: string; label: string }[]; markets: GammaMarket[]; /** the event's resolution rules (Gamma "description") */ description: string | null }

export function parseGammaEvent(raw: unknown): GammaEvent | null {
  const e = raw as Record<string, unknown> | null;
  if (!e || typeof e.slug !== "string") return null;
  const tags = (Array.isArray(e.tags) ? e.tags : []).map((t: Record<string, unknown>) => ({ slug: String(t?.slug ?? ""), label: String(t?.label ?? t?.slug ?? "") })).filter((t) => t.slug);
  const title = String(e.title ?? e.slug);
  const markets = (Array.isArray(e.markets) ? e.markets : []).map((m) => parseGammaMarket(m, { eventSlug: e.slug as string, eventTitle: title, tags: tags.map((t) => t.slug), eventDescription: str(e.description) })).filter((m): m is GammaMarket => m !== null);
  return { id: String(e.id ?? ""), slug: e.slug, title, closed: e.closed === true, endDate: normaliseTime(e.endDate), closedTime: normaliseTime(e.closedTime), tags, markets, description: str(e.description) };
}

export const parseMarketsBody = (body: unknown, ctx: { tags?: string[] } = {}): GammaMarket[] => (Array.isArray(body) ? body.map((m) => parseGammaMarket(m, ctx)).filter((m): m is GammaMarket => m !== null) : []);
export const parseEventsBody = (body: unknown): GammaEvent[] => { const arr = Array.isArray(body) ? body : Array.isArray((body as { events?: unknown })?.events) ? (body as { events: unknown[] }).events : []; return arr.map(parseGammaEvent).filter((e): e is GammaEvent => e !== null); };

export const isBinary = (m: Pick<GammaMarket, "outcomes">): boolean => m.outcomes.length === 2;
/** The two labels: YES = slot 0, NO = slot 1. */
export const sideLabels = (m: Pick<GammaMarket, "outcomes">): { yes: string; no: string } => ({ yes: m.outcomes[0] ?? "Yes", no: m.outcomes[1] ?? "No" });

/** Gamma's REPORTED resolution of a binary market (a cross-check and the back-test's source — never final for a burn). */
export function gammaResult(m: GammaMarket): EventResult | null {
  if (!isBinary(m) || !m.closed || m.umaResolutionStatus !== "resolved") return null;
  const [a, b] = m.outcomeFigures.map((x) => x.trim());
  if (a === "1" && b === "0") return "yes";
  if (a === "0" && b === "1") return "no";
  if (Number(a) === 0.5 && Number(b) === 0.5) return "void";
  return null;
}

/** The AUTHORITATIVE result from the CTF payout vector: unresolved → null; slot 0 takes all → yes; slot 1 → no; split (50-50) → void. */
export function chainResult(r: ConditionResolution): EventResult | null {
  if (!r.resolved) return null;
  if (r.outcomeSlotCount !== 2) throw new Error(`condition ${r.conditionId} has ${r.outcomeSlotCount} outcome slots — binary only`);
  return r.outcome === 0 ? "yes" : r.outcome === 1 ? "no" : "void";
}

/** The on-chain locator recorded as a reading's proof. */
export const proofOf = (r: ConditionResolution): string => `polygon:${r.chainId}/ctf:${r.contract}/condition:${r.conditionId}/payouts:${r.payoutNumerators.join(",")}${r.payoutDenominator !== "1" ? `/denominator:${r.payoutDenominator}` : ""}/block:${r.blockNumber ?? "latest"}`;

// ---- selectors --------------------------------------------------------------------------------------------------------------

export type PolySeries = { kind: "tag"; tag: string; type: string | null; glob: string | null } | { kind: "event"; slug: string };

export function parsePolySeries(s: string): PolySeries | null {
  const t = POLY_TAG_SERIES_RE.exec(s);
  if (t) return { kind: "tag", tag: t[1], type: t[2] ?? null, glob: t[3] ?? null };
  const e = POLY_EVENT_SERIES_RE.exec(s);
  return e ? { kind: "event", slug: e[1] } : null;
}

/** `*` = any run of characters (possibly empty); everything else literal; anchored at both ends. */
export function globMatch(glob: string, text: string): boolean {
  const re = new RegExp(`^${glob.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(text);
}

/**
 * Does this market fall under the rule's selector, as far as the market itself shows? (Tag membership is the query's: the client only
 * asks Gamma for the tag's markets.) Binary markets only; titleRegex over the question.
 */
export function polySelectorMatches(rule: Pick<BurnRule, "oracle" | "series" | "market" | "filter">, m: GammaMarket): boolean {
  if (rule.oracle !== "polymarket" || !isBinary(m)) return false;
  if (rule.market) return m.conditionId === rule.market;
  const s = parsePolySeries(rule.series ?? "");
  if (!s) return false;
  if (s.kind === "event" && m.eventSlug !== s.slug) return false;
  if (s.kind === "tag") {
    if (s.type && m.sportsMarketType !== s.type) return false;
    if (s.glob && !(m.eventSlug && globMatch(s.glob, m.eventSlug))) return false;
  }
  if (rule.filter.titleRegex && !safeRegexTest(rule.filter.titleRegex, m.question)) return false;   // audit 6 item 8: a refused pattern never runs
  return true;
}

// ---- URLs ---------------------------------------------------------------------------------------------------------------------

export const marketByConditionUrl = (id: string, closed: boolean): string => `${GAMMA_API}/markets?condition_ids=${id}&closed=${closed}`;
/** The URL a reading cites: the settled market on Gamma (Gamma lists a closed market only with closed=true). */
export const settledMarketUrl = (id: string): string => marketByConditionUrl(id, true);
/** The closed scan's end-date window (scanTag). */
export const SCAN_WINDOW_MS = 14 * 86_400_000;
/** A tag's markets: open ones by end date (ordered), closed ones inside an end-date window (unordered; scanTag explains why). */
export const marketsByTagUrl = (tagId: string, o: { closed: boolean; type?: string | null; limit: number; offset: number; endMin?: string | null; endMax?: string | null }): string =>
  `${GAMMA_API}/markets?tag_id=${encodeURIComponent(tagId)}&closed=${o.closed}${o.closed ? "" : "&order=endDate&ascending=true"}${o.endMin ? `&end_date_min=${o.endMin}` : ""}${o.endMax ? `&end_date_max=${o.endMax}` : ""}&limit=${o.limit}&offset=${o.offset}${o.type ? `&sports_market_types=${encodeURIComponent(o.type)}` : ""}`;
export const eventBySlugUrl = (slug: string): string => `${GAMMA_API}/events?slug=${encodeURIComponent(slug)}`;
export const tagBySlugUrl = (slug: string): string => `${GAMMA_API}/tags/slug/${encodeURIComponent(slug)}`;
export const searchUrl = (q: string, status: "open" | "closed" | "all", limit: number): string => `${GAMMA_API}/public-search?q=${encodeURIComponent(q)}&limit_per_type=${limit}${status === "open" ? "&events_status=active&keep_closed_markets=0" : ""}`;
export const eventPageUrl = (slug: string): string => `${POLYMARKET_SITE}/event/${slug}`;
/** A top-level tag's open events, most traded first (the wizard's Browse path: the Polymarket group under a Kalshi category). */
export const eventsByTagUrl = (slug: string, limit: number): string => `${GAMMA_API}/events?tag_slug=${encodeURIComponent(slug)}&closed=false&active=true&order=volume&ascending=false&limit=${limit}`;
/**
 * A tag's events (open or closed) whose end date falls in a window: the game-market lookup (launch night 2026-10-13: the text search
 * "Chiefs vs Raiders" is capped at 10 hits, and older Chiefs–Raiders games crowded out the week's moneyline, so every Chiefs coin
 * failed its launch check). A game event's end date is the game's start, so a window around the start finds it.
 */
/**
 * A tag's events whose scheduled start falls in a window (Gamma start_time_min / start_time_max; walkthrough 2026-10-13). An MLB game
 * event ends a week after the game (mlb-cle-tb-2026-10-12 ends 2026-10-20), so the end-date window above never finds it; the start does.
 */
export const eventsStartingUrl = (slug: string, minIso: string, maxIso: string, limit = 100): string => `${GAMMA_API}/events?tag_slug=${encodeURIComponent(slug)}&start_time_min=${encodeURIComponent(minIso)}&start_time_max=${encodeURIComponent(maxIso)}&limit=${limit}`;
export const eventsInWindowUrl = (slug: string, minIso: string, maxIso: string, limit = 100): string => `${GAMMA_API}/events?tag_slug=${encodeURIComponent(slug)}&end_date_min=${encodeURIComponent(minIso)}&end_date_max=${encodeURIComponent(maxIso)}&limit=${limit}`;

// ---- resolution (pure) ----------------------------------------------------------------------------------------------------------

export interface PolyCandidate { market: GammaMarket; chain: ConditionResolution | null; chainError?: string | null }
export type TitleRefuser = (titles: string[]) => string[];

/** When a market settled, for ordering and the reading: Gamma's closedTime, else the UMA end date, else the scheduled end. */
export const settledAtOf = (m: GammaMarket): string | null => m.closedTime ?? m.umaEndDate ?? m.endDate;

/**
 * Pure: the rule's settled events from candidates (each a Gamma market and, where read, its CTF resolution). A candidate counts only
 * when its payout vector is on chain; a market Gamma calls closed whose vector is not (yet) reported is AWAITING FINAL. The refuse list
 * applies to every market's question (a refused market is never read). `sinceIso` keeps settlements strictly after it.
 */
export function resolvePolymarket(rule: BurnRule, candidates: readonly PolyCandidate[], opts: { sinceIso: string | null; refuse?: TitleRefuser | null }): ResolvedSelector {
  const refusals: string[] = [];
  const events: SettledEvent[] = [];
  let awaitingFinal = 0;
  const seen = new Set<string>();
  for (const { market: m, chain, chainError } of candidates) {
    if (seen.has(m.conditionId) || !polySelectorMatches(rule, m)) continue;
    seen.add(m.conditionId);
    const refused = opts.refuse?.([m.question, ...(m.eventTitle ? [m.eventTitle] : [])]) ?? [];
    if (refused.length) { refusals.push(`${m.conditionId}: refused (${refused.join("; ")}) — never read`); continue; }
    if (chainError) { if (m.closed) awaitingFinal++; refusals.push(`${m.conditionId}: chain read failed (${chainError.slice(0, 100)}) — read next cycle`); continue; }
    if (!chain) { if (m.closed) awaitingFinal++; continue; }
    let result: EventResult | null;
    try { result = chainResult(chain); } catch (e) { refusals.push(`${m.conditionId}: ${(e as Error).message}`); continue; }
    if (result === null) { if (m.closed || gammaResult(m) !== null) awaitingFinal++; continue; }
    const g = gammaResult(m);
    if (g !== null && g !== result) refusals.push(`${m.conditionId}: Gamma reports ${g}, the CTF payout vector says ${result} — the chain is the record`);
    const at = settledAtOf(m);
    if (!at) { refusals.push(`${m.conditionId}: resolved on chain but Gamma gives no time — held`); continue; }
    if (opts.sinceIso !== null && !(at > opts.sinceIso)) continue;
    const { yes, no } = sideLabels(m);
    events.push({ id: m.conditionId, at, result, value: null, title: m.question, sourceUrl: settledMarketUrl(m.conditionId), method: `ctf-payout: [${chain.payouts.join(", ")}] → ${result} (YES = "${yes}", NO = "${no}")`, proof: proofOf(chain) });
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  return { events, awaitingFinal, refusals, settlementSourceUrl: POLYGONSCAN_CTF };
}

/** Pure, for back-tests: the selector's markets as GAMMA reports them resolved (display-grade — the keeper reads the chain). */
export function gammaSettledEvents(rule: BurnRule, markets: readonly GammaMarket[], opts: { sinceIso: string | null; refuse?: TitleRefuser | null }): { events: SettledEvent[]; refusals: string[]; awaitingFinal: number } {
  const events: SettledEvent[] = [], refusals: string[] = [];
  let awaitingFinal = 0;
  const seen = new Set<string>();
  for (const m of markets) {
    if (seen.has(m.conditionId) || !polySelectorMatches(rule, m)) continue;
    seen.add(m.conditionId);
    const refused = opts.refuse?.([m.question, ...(m.eventTitle ? [m.eventTitle] : [])]) ?? [];
    if (refused.length) { refusals.push(`${m.conditionId}: refused (${refused.join("; ")})`); continue; }
    const r = gammaResult(m);
    if (r === null) { if (m.closed) awaitingFinal++; continue; }
    const at = settledAtOf(m);
    if (!at || (opts.sinceIso !== null && !(at > opts.sinceIso))) continue;
    const { yes, no } = sideLabels(m);
    events.push({ id: m.conditionId, at, result: r, value: null, title: m.question, sourceUrl: settledMarketUrl(m.conditionId), method: `gamma-report: outcomePrices [${m.outcomeFigures.join(", ")}] on a closed, resolved market give ${r} (YES = "${yes}", NO = "${no}"; display-grade)` });
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  return { events, refusals, awaitingFinal };
}

/** Pure: the market-implied chance that the NEXT settlement under the selector burns. DISPLAY ONLY. */
export function impliedChanceFromMarkets(rule: BurnRule, open: readonly GammaMarket[]): ImpliedChance {
  const next = open.filter((m) => !m.closed && polySelectorMatches(rule, m)).sort((a, b) => (a.endDate ?? "9").localeCompare(b.endDate ?? "9"))[0];
  if (!next) return { chance: null, marketTicker: null, closeTime: null, basis: "There is no open Polymarket market for this rule." };
  const onYes = !!rule.binary?.onYes, onNo = !!rule.binary?.onNo, p = next.yesPrice;
  const { yes } = sideLabels(next);
  return { chance: p === null ? null : onYes && onNo ? 1 : onYes ? p : 1 - p, marketTicker: next.conditionId, closeTime: next.endDate, basis: onYes && onNo ? "both outcomes burn: a settlement burns unless voided" : onYes ? `the "${yes}" (YES) mid of "${next.question}"` : `1 − the "${yes}" (YES) mid of "${next.question}" (this side burns on NO)` };
}

// ---- search shapes ------------------------------------------------------------------------------------------------------------

export interface PolyMarketHit {
  conditionId: string; question: string; yes: string; no: string; endDate: string | null; closed: boolean; sportsMarketType: string | null; selector: { oracle: "polymarket"; series: null; market: string }; /** the outcome name inside its event (Gamma groupItemTitle), when Gamma names one */ outcome: string | null;
  /** What Polymarket says it resolves the market from, and the catalogue's cross-read of it (sources/polyStated.ts). Display; never a settlement input. */
  resolutionSource?: StatedSource;
  /** The dispute window before the payout can be final (sources/polyStated.ts). */
  finalAfter?: FinalAfter;
  /** A game market's scheduled start (Gamma gameStartTime), when Gamma gives one: the game-market lookup matches on it (gameSettle.ts). */
  gameStartTime?: string;
}
export interface PolyEventHit { slug: string; title: string; url: string; endDate: string | null; closed: boolean; tags: { slug: string; label: string }[]; markets: PolyMarketHit[]; marketCount: number; selector: { oracle: "polymarket"; series: string; market: null }; refused: string[] }
export interface PolyTagHit { slug: string; label: string; events: number; series: string[] }

const HEAD_TO_HEAD = /^[^:]+ vs\.? [^:]+$/;
export function marketHit(m: GammaMarket): PolyMarketHit {
  const { yes, no } = sideLabels(m);
  return { conditionId: m.conditionId, question: m.question, yes, no, endDate: m.endDate, closed: m.closed, sportsMarketType: m.sportsMarketType, selector: { oracle: "polymarket", series: null, market: m.conditionId }, outcome: m.groupItemTitle, ...polyStated(m), ...(m.gameStartTime ? { gameStartTime: m.gameStartTime } : {}) };
}

/** A market's stated source and dispute window (sources-2): what the review card and the coin page show beside the on-chain payout. */
export function polyStated(m: GammaMarket): { resolutionSource: StatedSource; finalAfter: FinalAfter } {
  return { resolutionSource: statedSource(m), finalAfter: finalAfter(m) };
}
/**
 * Is the payout final? Only when the Conditional Tokens contract has reported it (payoutDenominator > 0). A UMA proposal inside its
 * dispute window, whatever Gamma's figures say, is not: resolvePolymarket counts it as awaiting and writes nothing.
 */
export const payoutIsFinal = (chain: Pick<ConditionResolution, "resolved"> | null): boolean => !!chain && chain.resolved === true;

/** Audit 12 item 13: the most outcomes one event's own search lists (the page pages or filters them; see filterOutcomes). */
export const EVENT_ALL_OUTCOMES = 200;
/** Audit 12 item 13: the within-event filter lives in outcomeFilter.ts (client-safe, the launch page imports it). */
export { filterOutcomes } from "@/lib/burnticker/oracle/outcomeFilter";
import { ladderKeys } from "@/lib/burnticker/oracle/outcomeFilter";

/**
 * Whether a market's own outcome name shares a word with the query (case and accents ignored; words of 4+ letters, so "win" or "the" in a
 * long question do not count). A query with no such word names nothing. Pure.
 */
export function outcomeNamer(q: string): (m: Pick<GammaMarket, "question"> & { groupItemTitle?: string | null }) => boolean {
  const norm = (x: string | null | undefined) => (x ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const words = norm(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  if (!words.length) return () => false;
  return (m) => { const name = norm(m.groupItemTitle ?? null); if (!name) return false; const have = new Set(name.split(/[^a-z0-9]+/)); return words.some((w) => have.has(w)); };
}
/** Events → search hits (binary markets only, head-to-head and moneyline first, at most `perEvent`), tags aggregated into recurring selectors. */
export function searchHits(events: readonly GammaEvent[], o: { refuse?: TitleRefuser | null; perEvent?: number; status?: "open" | "closed" | "all"; /** launch night 2026-10-13: the words searched; an outcome they name comes first */ query?: string } = {}): { events: PolyEventHit[]; tags: PolyTagHit[] } {
  const status = o.status ?? "open";
  const named = outcomeNamer(o.query ?? "");
  const out: PolyEventHit[] = [];
  const tagMap = new Map<string, PolyTagHit & { moneyline: boolean }>();
  for (const e of events) {
    if (status === "open" && e.closed) continue;
    if (status === "closed" && !e.closed) continue;
    const bin = e.markets.filter(isBinary).filter((m) => status !== "open" || (!m.closed && !m.inactive));
    // launch night 2026-10-13 (hunt): "Eagles Super Bowl" listed the first 12 of 32 champion outcomes alphabetically, Eagles not among
    // them, and then said "type the name you want": an outcome the searched words name is listed first
    const rank = (m: GammaMarket) => (named(m) ? -1 : m.sportsMarketType === "moneyline" ? 0 : HEAD_TO_HEAD.test(m.question) ? 1 : 2);
    // walkthrough 13: a ladder (every outcome a number or a date) lists by its rung, not in Gamma's order
    const lk = ladderKeys(bin.map((m) => m.groupItemTitle ?? "")), rung = new Map(bin.map((m, i) => [m, lk?.[i] ?? 0]));
    const markets = [...bin].sort((a, b) => rank(a) - rank(b) || (lk ? rung.get(a)! - rung.get(b)! : (a.endDate ?? "9").localeCompare(b.endDate ?? "9"))).slice(0, o.perEvent ?? 12).map(marketHit);
    const refused = o.refuse?.([e.title, ...bin.slice(0, 20).map((m) => m.question)]) ?? [];
    out.push({ slug: e.slug, title: e.title, url: eventPageUrl(e.slug), endDate: e.endDate, closed: e.closed, tags: e.tags, markets, marketCount: bin.length, selector: { oracle: "polymarket", series: `event:${e.slug}`, market: null }, refused });
    for (const t of e.tags) {
      const h = tagMap.get(t.slug) ?? { slug: t.slug, label: t.label, events: 0, series: [], moneyline: false };
      h.events++; if (bin.some((m) => m.sportsMarketType === "moneyline")) h.moneyline = true;
      tagMap.set(t.slug, h);
    }
  }
  const GENERIC = new Set(["sports", "games", "hide-from-new", "recurring", "featured", "all"]);
  const tags = [...tagMap.values()].filter((t) => !GENERIC.has(t.slug.toLowerCase()) && /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(t.slug)).sort((a, b) => b.events - a.events || a.slug.localeCompare(b.slug)).slice(0, 8)
    .map(({ moneyline, ...t }) => ({ ...t, series: [...(moneyline ? [`tag:${t.slug}/moneyline`] : []), `tag:${t.slug}`] }));
  return { events: out, tags };
}

// ---- the client ---------------------------------------------------------------------------------------------------------------

export interface PolymarketClientOpts {
  fetchImpl?: FetchLike; rpcFetch?: RpcFetchLike; rpcUrls?: string[]; now?: () => number; minIntervalMs?: number; timeoutMs?: number;
  /** Gamma pages of `pageSize` markets scanned per tag read (keeper and back-test). */
  pageCap?: number; pageSize?: number;
  /** At most this many on-chain reads per settledSince call (oldest first); the rest wait for the next cycle. */
  chainCap?: number;
  ttlMs?: number;
  /** The refuse list over market questions (server.ts passes config/burnticker/refuse.json; null in pure tests). */
  refuse?: TitleRefuser | null;
}

export interface TagScan { markets: GammaMarket[]; complete: boolean; pages: number }

export class PolymarketClient implements OracleAdapter {
  readonly id = "polymarket" as const;
  private fetchImpl: FetchLike;
  private rpcFetch: RpcFetchLike | undefined;
  private rpcUrls: string[];
  private now: () => number;
  private minInterval: number;
  private timeoutMs: number;
  readonly pageCap: number;
  readonly pageSize: number;
  private chainCap: number;
  private ttl: number;
  readonly refuse: TitleRefuser | null;
  // prelaunch audit M8 (2026-10-15): bounded; a search URL is per query, so the cache grew with every distinct visitor query
  private cache = new LruMap<string, { at: number; body: unknown }>(1_000);
  private chainCache = new LruMap<string, { at: number; r: ConditionResolution }>(5_000);
  private lastAt = 0;
  private chain: Promise<void> = Promise.resolve();
  /** Gamma requests actually sent (the tests' politeness checks). */
  requests: string[] = [];
  /** Condition ids read on chain (not from the cache). */
  chainReads: string[] = [];

  constructor(o: PolymarketClientOpts = {}) {
    this.fetchImpl = o.fetchImpl ?? (fetch as unknown as FetchLike);
    this.rpcFetch = o.rpcFetch;
    this.rpcUrls = o.rpcUrls?.length ? [...o.rpcUrls] : [...DEFAULT_POLYGON_RPCS];
    this.now = o.now ?? (() => Date.now());
    this.minInterval = o.minIntervalMs ?? 250;
    this.timeoutMs = o.timeoutMs ?? 20_000;
    // 50 per page: Gamma answered HTTP 500 to limit=100 on a tag + market-type query on 2026-10-10 (50 answered). 12 × 50 = 600 a scan.
    this.pageCap = o.pageCap ?? 12;
    this.pageSize = o.pageSize ?? 50;
    this.chainCap = o.chainCap ?? 40;
    this.ttl = o.ttlMs ?? POLY_TTL_MS;
    this.refuse = o.refuse ?? null;
  }

  /** GET with the 10-minute cache; one request in flight at a time, spaced by minInterval. */
  async get(url: string, ttlMs = this.ttl): Promise<unknown> {
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.at < ttlMs) return hit.body;
    const run = async (): Promise<unknown> => {
      const wait = this.lastAt + this.minInterval - this.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastAt = this.now();
      await takeOrThrow(sourceForUrl(url));   // the request budget (apiBudget.ts)
      this.requests.push(url);
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, { signal: ac.signal, headers: { accept: "application/json", "user-agent": POLY_UA } });
        if (!res.ok) throw new Error(`Polymarket HTTP ${res.status} for ${url.slice(0, 120)}`);
        const body = await res.json();
        this.cache.set(url, { at: this.now(), body });
        return body;
      } finally { clearTimeout(t); }
    };
    const p = this.chain.then(run, run);
    this.chain = p.then(() => undefined, () => undefined);
    return p;
  }

  /** The CTF payout vector of one condition. A resolved vector is cached for good (it cannot change); an unresolved one for 10 minutes. */
  async readChain(conditionId: string): Promise<ConditionResolution> {
    const hit = this.chainCache.get(conditionId);
    if (hit && (hit.r.resolved || this.now() - hit.at < this.ttl)) return hit.r;
    const r = await readConditionResolution(conditionId, { rpcUrls: this.rpcUrls, fetchImpl: this.rpcFetch, timeoutMs: this.timeoutMs });
    this.chainReads.push(conditionId);
    this.rpcUrls = [r.rpcUrl, ...this.rpcUrls.filter((u) => u !== r.rpcUrl)];   // the RPC that answered goes first next time
    this.chainCache.set(conditionId, { at: this.now(), r });
    return r;
  }

  /** One market by condition id, closed or open (Gamma lists a closed market only with closed=true). */
  async marketByCondition(id: string): Promise<GammaMarket | null> {
    const cid = id.toLowerCase();
    for (const closed of [true, false]) {
      const m = parseMarketsBody(await this.get(marketByConditionUrl(cid, closed))).find((x) => x.conditionId === cid);
      if (m) return m;
    }
    return null;
  }

  async eventBySlug(slug: string): Promise<GammaEvent | null> {
    return parseEventsBody(await this.get(eventBySlugUrl(slug))).find((e) => e.slug === slug) ?? null;
  }

  async tag(slug: string): Promise<{ id: string; slug: string; label: string } | null> {
    try {
      const t = await this.get(tagBySlugUrl(slug), 24 * 3_600_000) as { id?: unknown; slug?: unknown; label?: unknown } | null;
      return t && t.id !== undefined && t.id !== null ? { id: String(t.id), slug: String(t.slug ?? slug), label: String(t.label ?? slug) } : null;
    } catch (e) { if (/HTTP 404/.test((e as Error).message)) return null; throw e; }
  }

  /**
   * A tag's markets. OPEN: by end date, one page (the display-only implied chance). CLOSED: Gamma answered HTTP 500 to deep pages of an
   * ordered tag + type query on 2026-10-10 (offset + limit past ~75), so the closed scan walks END-DATE WINDOWS instead — first the
   * closed markets whose scheduled end is still ahead (resolved early), then 14-day windows aligned to the epoch, newest first, down to
   * 14 days before `sinceIso` (a market resolved more than 14 days after its scheduled end is outside the scan; the keeper's 7-day
   * overlap comes on top) or 400 days back. Each window is paged unordered. `pages` caps the requests; hitting it = incomplete.
   * `tolerant` (the back-test): a request that fails ends the scan as incomplete instead of failing it; the keeper's read stays strict.
   */
  async scanTag(tagSlug: string, o: { closed: boolean; type?: string | null; sinceIso?: string | null; pages?: number; tolerant?: boolean }): Promise<TagScan> {
    const tag = await this.tag(tagSlug);
    if (!tag) throw new Error(`polymarket: no tag "${tagSlug}" on Gamma`);
    if (!o.closed) return { markets: parseMarketsBody(await this.get(marketsByTagUrl(tag.id, { closed: false, type: o.type, limit: this.pageSize, offset: 0 })), { tags: [tagSlug] }), complete: true, pages: 1 };
    const cap = o.pages ?? this.pageCap;
    const byId = new Map<string, GammaMarket>();
    let used = 0;
    const iso = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`;
    /** One end-date window, paged; false when the request cap or (tolerant) a failure stops it. */
    const window = async (endMin: string | null, endMax: string | null): Promise<boolean> => {
      for (let offset = 0; ; offset += this.pageSize) {
        if (used >= cap) return false;
        used++;
        let body: unknown;
        try { body = await this.get(marketsByTagUrl(tag.id, { closed: true, type: o.type, limit: this.pageSize, offset, endMin, endMax })); }
        catch (e) { if (o.tolerant) return false; throw e; }
        const page = parseMarketsBody(body, { tags: [tagSlug] });
        for (const m of page) byId.set(m.conditionId, m);
        if (page.length < this.pageSize) return true;
      }
    };
    const done = (complete: boolean): TagScan => ({ markets: [...byId.values()], complete, pages: used });
    const top = Math.ceil(this.now() / SCAN_WINDOW_MS) * SCAN_WINDOW_MS;
    const floor = o.sinceIso ? Date.parse(o.sinceIso) - SCAN_WINDOW_MS : this.now() - 400 * 86_400_000;
    if (!(await window(iso(top), null))) return done(false);
    for (let hi = top; hi > floor; hi -= SCAN_WINDOW_MS) if (!(await window(iso(hi - SCAN_WINDOW_MS), iso(hi)))) return done(false);
    return done(true);
  }

  /** The client's clock (the keeper's and the launch check's "now", so a fixture-driven test is deterministic). */
  clock(): number { return this.now(); }

  /** The selector's markets (the rule's filter is applied later): one market, one event's, or a tag's (closed scan or open). */
  async candidates(rule: BurnRule, o: { closed: boolean; sinceIso?: string | null; pages?: number; tolerant?: boolean }): Promise<TagScan> {
    if (rule.oracle !== "polymarket") throw new Error("polymarket: not a polymarket rule");
    if (rule.market) { const m = await this.marketByCondition(rule.market); return { markets: m ? [m] : [], complete: true, pages: 1 }; }
    const s = parsePolySeries(rule.series ?? "");
    if (!s) throw new Error(`polymarket: unreadable series ${rule.series}`);
    if (s.kind === "event") { const e = await this.eventBySlug(s.slug); return { markets: e ? e.markets : [], complete: true, pages: 1 }; }
    return this.scanTag(s.tag, { closed: o.closed, type: s.type, sinceIso: o.sinceIso ?? null, pages: o.pages, tolerant: o.tolerant });
  }

  /**
   * THE KEEPER'S READ. Gamma lists the selector's closed markets (one market: whatever its state); each is read on chain (oldest first,
   * at most chainCap per call); resolvePolymarket keeps only payout vectors the chain has. Throws when every chain read failed, so the
   * keeper backs off instead of recording nothing.
   */
  async settledSince(rule: BurnRule, sinceIso: string | null, opts: { limitPages?: number } = {}): Promise<ResolvedSelector> {
    const scan = await this.candidates(rule, { closed: true, sinceIso, pages: opts.limitPages });
    const wanted = scan.markets.filter((m) => polySelectorMatches(rule, m) && (rule.market !== null || m.closed) && (sinceIso === null || (settledAtOf(m) ?? "9") > sinceIso))
      .sort((a, b) => (settledAtOf(a) ?? "9").localeCompare(settledAtOf(b) ?? "9"));
    const toRead = wanted.slice(0, this.chainCap);
    const cands: PolyCandidate[] = [];
    let failed = 0;
    for (const m of toRead) {
      if (this.refuse?.([m.question, ...(m.eventTitle ? [m.eventTitle] : [])]).length) { cands.push({ market: m, chain: null }); continue; }
      try { cands.push({ market: m, chain: await this.readChain(m.conditionId) }); } catch (e) { failed++; cands.push({ market: m, chain: null, chainError: (e as Error).message }); }
    }
    if (toRead.length > 0 && failed === toRead.length) throw new Error(`polymarket: every on-chain read failed (${cands[0].chainError?.slice(0, 160)})`);
    const r = resolvePolymarket(rule, cands, { sinceIso, refuse: this.refuse });
    if (wanted.length > toRead.length) { r.refusals.push(`${wanted.length - toRead.length} more closed ${wanted.length - toRead.length === 1 ? "market waits" : "markets wait"} for the next cycle, because each cycle reads at most ${this.chainCap} results on chain.`); r.awaitingFinal += wanted.length - toRead.length; }
    if (!scan.complete) r.refusals.push(`The scan stopped after ${scan.pages} ${scan.pages === 1 ? "page" : "pages"} of ${this.pageSize}, before reaching ${sinceIso ?? "the start"}. This rule settles more markets than one cycle reads.`);
    return r;
  }

  /** THE BACK-TEST'S READ: the selector's closed markets as Gamma reports them resolved (display-grade; no chain reads). */
  async gammaSettled(rule: BurnRule, sinceIso: string | null, pages?: number): Promise<{ events: SettledEvent[]; refusals: string[]; awaitingFinal: number; complete: boolean; scanned: number; oneShotCloseTime: string | null; title: string | null }> {
    const scan = await this.candidates(rule, { closed: true, sinceIso, pages, tolerant: true });
    const r = gammaSettledEvents(rule, scan.markets, { sinceIso, refuse: this.refuse });
    const one = rule.market ? scan.markets[0] ?? null : null;
    return { ...r, complete: scan.complete, scanned: scan.markets.length, oneShotCloseTime: one ? one.endDate : null, title: one ? one.question : null };
  }

  /** Text search (Gamma public-search), or a pasted condition id / event slug. Open events by default. */
  async search(q: string, o: { status?: "open" | "closed" | "all"; limit?: number } = {}): Promise<{ events: PolyEventHit[]; tags: PolyTagHit[]; markets: PolyMarketHit[] }> {
    const query = q.trim(), status = o.status ?? "open";
    if (POLY_MARKET_RE.test(query.toLowerCase())) {
      const m = await this.marketByCondition(query);
      return { events: [], tags: [], markets: m && isBinary(m) && !(this.refuse?.([m.question]).length) ? [marketHit(m)] : [] };
    }
    const events: GammaEvent[] = [];
    if (/^[a-z0-9]+(-[a-z0-9]+){2,}$/.test(query)) { const e = await this.eventBySlug(query).catch(() => null); if (e) events.push(e); }
    if (!events.length && query.length >= 2) events.push(...parseEventsBody(await this.get(searchUrl(query, status, Math.min(20, o.limit ?? 10)))));
    // audit 12 item 13: a search for one event's own slug lists ALL of its outcomes (up to EVENT_ALL_OUTCOMES), so a "Show all" on a long
    // event (30 thresholds, 31 dates) is that search, never "type the name you want"
    const one = events.length === 1 && events[0].slug === query;
    return { ...searchHits(events, { refuse: this.refuse, status: one ? "all" : status, query, ...(one ? { perEvent: EVENT_ALL_OUTCOMES } : {}) }), markets: [] };
  }

  /** Open events of one tag (Browse), as search hits: binary markets only, the refuse list applied, the tags as recurring selectors. */
  /** A tag's events, open and closed, ending inside [minIso, maxIso] (the game-market lookup; every market of each event kept). */
  async eventsInWindow(slug: string, minIso: string, maxIso: string): Promise<{ events: PolyEventHit[]; tags: PolyTagHit[] }> {
    return searchHits(parseEventsBody(await this.get(eventsInWindowUrl(slug, minIso, maxIso))), { refuse: this.refuse, status: "all", perEvent: 40 });
  }

  /** A tag's events, open and closed, whose scheduled start is inside [minIso, maxIso] (the game-market lookup's first read). */
  async eventsStarting(slug: string, minIso: string, maxIso: string): Promise<{ events: PolyEventHit[]; tags: PolyTagHit[] }> {
    return searchHits(parseEventsBody(await this.get(eventsStartingUrl(slug, minIso, maxIso))), { refuse: this.refuse, status: "all", perEvent: 40 });
  }

  async eventsByTag(slug: string, limit = 8): Promise<{ events: PolyEventHit[]; tags: PolyTagHit[] }> {
    return searchHits(parseEventsBody(await this.get(eventsByTagUrl(slug, Math.min(24, Math.max(1, limit))))), { refuse: this.refuse, status: "open", perEvent: 6 });
  }

  async searchSeries(query: string, opts: { limit?: number } = {}): Promise<SeriesSummary[]> {
    const r = await this.search(query, { limit: opts.limit });
    return r.tags.map((t) => ({ oracle: "polymarket", ticker: t.series[0], title: t.label, category: null, frequency: "per market", settlementSource: { name: "Conditional Tokens payout vector (Polygon)", url: POLYGONSCAN_CTF }, tags: [t.slug] }));
  }

  /** A selector's summary: one market (condition id), a tag series or an event series. Null when Gamma does not know it. */
  async seriesInfo(ticker: string): Promise<SeriesSummary | null> {
    const settlementSource = { name: "Conditional Tokens payout vector (Polygon)", url: POLYGONSCAN_CTF };
    if (POLY_MARKET_RE.test(ticker)) {
      const m = await this.marketByCondition(ticker);
      return m ? { oracle: "polymarket", ticker, title: m.question, category: m.sportsMarketType, frequency: "once", settlementSource, tags: m.tags, stated: polyStated(m), endsAt: m.endDate ?? null } : null;
    }
    const s = parsePolySeries(ticker);
    if (!s) return null;
    if (s.kind === "event") { const e = await this.eventBySlug(s.slug); return e ? { oracle: "polymarket", ticker, title: e.title, category: null, frequency: "per market", settlementSource, tags: e.tags.map((t) => t.slug) } : null; }
    const t = await this.tag(s.tag);
    return t ? { oracle: "polymarket", ticker, title: `${t.label}${s.type ? `, ${s.type}` : ""}${s.glob ? `, matching ${s.glob}` : ""}`, category: null, frequency: "per market", settlementSource, tags: [t.slug] } : null;
  }

  async impliedChance(rule: BurnRule): Promise<ImpliedChance> {
    if (rule.oracle !== "polymarket") return { chance: null, marketTicker: null, closeTime: null, basis: "This is not a Polymarket rule." };
    const scan = await this.candidates(rule, { closed: false, pages: 1 });
    return impliedChanceFromMarkets(rule, scan.markets);
  }
}

// ---- fixtures (tests) -------------------------------------------------------------------------------------------------------

/** A Gamma fetch over frozen bodies keyed by exact URL (falls back to the longest matching prefix). */
export function gammaFixtureFetch(table: Record<string, unknown>): FetchLike {
  return async (url: string) => {
    const key = url in table ? url : Object.keys(table).filter((k) => url.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (key === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => table[key] };
  };
}

/** A JSON-RPC fetch over recorded eth_call results keyed by call data (+ eth_blockNumber). Unknown calls answer an RPC error. */
export function rpcFixtureFetch(chain: { blockNumber: string; calls: Record<string, string>; contract?: string }): RpcFetchLike {
  return async (_url, init) => {
    const req = JSON.parse(init?.body ?? "{}") as { method?: string; params?: { to?: string; data?: string }[] };
    let body: unknown;
    if (req.method === "eth_blockNumber") body = { jsonrpc: "2.0", id: 1, result: chain.blockNumber };
    else if (req.method === "eth_call" && req.params?.[0]?.data && (!chain.contract || req.params[0].to?.toLowerCase() === chain.contract.toLowerCase()) && req.params[0].data in chain.calls) body = { jsonrpc: "2.0", id: 1, result: chain.calls[req.params[0].data] };
    else body = { jsonrpc: "2.0", id: 1, error: { message: `no recorded answer for ${req.method} ${req.params?.[0]?.data?.slice(0, 20) ?? ""}` } };
    return { ok: true, status: 200, json: async () => body };
  };
}

export { POLYGON_CHAIN_ID, POLYMARKET_CTF };
