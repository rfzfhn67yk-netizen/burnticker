import fs from "node:fs";
import path from "node:path";
import type { BurnRule } from "@/lib/burnticker/rules";
import { BURNTICKER_RULES_SCHEMA } from "@/lib/burnticker/rules";
import { findTeams, gameSeries, teamSeries, LEAGUES, outcomeOf, type EspnClient, type EspnTeam } from "@/lib/burnticker/sources/espn";
import { findStations, nwsSeries, nwsSeriesTitle, parseNwsSeries, type NwsMetric } from "@/lib/burnticker/sources/nws";
import { nativeRule, nativeSourceById } from "@/lib/burnticker/sources/native";
import { loadRaces, outcomeCardTitle, outcomeSettlesNote, searchRaces, tokens, type Race } from "@/lib/burnticker/elections";
import { searchHits, parseEventsBody, searchUrl, type TitleRefuser } from "@/lib/burnticker/oracle/polymarket";
import { scrubMarketData, type VenueFlags } from "@/lib/burnticker/venues";
import type { SeriesSummary } from "@/lib/burnticker/oracle/types";

/**
 * THE UNIVERSAL SEARCH (2026-10-10, the owner: a 60-second path from "El-Sayed wins Michigan Senate" to a coin). One box on the launch
 * page; it reads every enabled venue and feed and answers READY-MADE RULES as cards — venue badge, settlement source, next/settle date,
 * "how this settles", and the exact rule — so one click lands on the create screen with the rule filled in:
 *
 *   coin vs coin  "WIF vs SHIB"                → the Coin vs Coin tile (its page when present, else "not built yet")
 *   elections     candidate / state / office   → Polymarket race outcomes (elections.ts), settled on the on-chain payout + the state's certified results
 *   teams         nickname / city / abbr       → ESPN team coins (every win / every loss) and the next game only (sources/espn.ts, cross-read)
 *   weather       city + high / rain / snow    → NWS daily climate rules at that station, the number in the query as the threshold
 *   feeds         debt, unemployment, CPI, …   → first-party feeds from sources.json (launchable only)
 *   Polymarket    anything else                → open binary markets from Gamma's public search (active, named outcomes)
 *   Kalshi        only with BURNTICKER_KALSHI_ENABLED
 *
 * Ranked by text match (tokens of the query found in the card's words). No price, odds, volume or liquidity in the payload (venues.ts).
 */

export type SuggestionVenue = "feed" | "espn" | "nws" | "polymarket" | "kalshi" | "tile";
export interface SuggestionPick { oracle: "catalogue" | "polymarket" | "kalshi"; series: string | null; market: string | null; title: string; yes?: string; no?: string }
export interface Suggestion {
  id: string; venue: SuggestionVenue; venueLabel: string; title: string; subtitle: string;
  /** Who settles it, in words ("ESPN scoreboard · cross-read NHL score feed"). */
  settlement: string; settleAt: string | null; howSettles: string | null;
  rule: BurnRule | null; pick: SuggestionPick | null;
  /** For first-party rules: the fixed unit the wizard shows (catalogue rules fix unit, baseline, direction). */
  source: { unit: { size: number; label: string; definition: string }; baseline: number; direction: "up" } | null;
  /** A tile instead of a rule (Coin vs Coin): its page, or null while it is not built ("coming soon"). */
  href: string | null; suggestedName: string | null; suggestedTicker: string | null; refused: string[]; score: number;
}
export interface FeedLike { id: string; title: string; sourceName: string; cadence: string; unit: { size: number; label: string; definition: string } | null; direction: "up" | "down" | "abs" | null; baseline: "previousSettlement" | number | null; launchable: { ok: boolean; why: string | null } }

export interface SearchDeps {
  venues: VenueFlags; feeds: readonly FeedLike[]; espn: EspnClient | null; polyGet: ((url: string) => Promise<unknown>) | null; refuse: TitleRefuser;
  kalshiSearch: ((q: string) => Promise<SeriesSummary[]>) | null; derbyHref: string | null; nowMs: number;
}

/** First-party feed keywords (beyond the feed's own title words). */
const FEED_WORDS: Record<string, string[]> = {
  "treasury.debt": ["debt", "national debt", "deficit", "treasury", "debt to the penny"], "fred.GFDEBTN": ["federal debt"], "fred.UNRATE": ["unemployment", "jobless", "jobs report"],
  "fred.CPIAUCSL": ["cpi", "inflation", "consumer prices"], "bls.eggs": ["egg", "eggs"], "ll2.launches": ["launch", "launches", "rocket", "spacex", "starship", "orbital"],
  "noaa.flares": ["flare", "flares", "solar", "sun"], "jpl.neo": ["asteroid", "asteroids", "near miss", "near earth"], "wiki.views": ["wikipedia", "page views"],
  "ethereum.baseFeeBurn": ["eth burn", "ethereum burn", "base fee"], "bitcoin.blockHeight": ["bitcoin blocks", "btc blocks"], "solana.blockHeight": ["solana blocks"],
  "fedreg.finalRules": ["federal register", "final rules", "regulations"], "openfda.approvals": ["fda", "drug approval", "approvals"], "github.stars": ["github", "stars"], "steam.players": ["steam", "players"],
};
const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9$.]+/g, " ").replace(/\s+/g, " ").trim()} `;
const overlap = (q: string, words: string): number => { const qt = tokens(q); if (!qt.length) return 0; const h = new Set(tokens(words)); return qt.filter((w) => h.has(w)).length / qt.length; };
const tickerOf = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);

function derbyCard(q: string, href: string | null): Suggestion | null {
  const m = /^\s*\$?([A-Za-z0-9]{2,10})\s+(?:vs\.?|v\.?|versus)\s+\$?([A-Za-z0-9]{2,10})\s*$/i.exec(q);
  if (!m || findTeams(m[1]).length || findTeams(m[2]).length) return null;
  const a = m[1].toUpperCase(), b = m[2].toUpperCase();
  return { id: `tile:derby:${a}-${b}`, venue: "tile", venueLabel: "Coin vs Coin", title: `$${a} vs $${b} — a coin-vs-coin derby`, subtitle: href ? "open the Coin vs Coin page" : "not built yet", settlement: "Coin vs Coin (its own rules page)", settleAt: null, howSettles: null, rule: null, pick: null, source: null, href, suggestedName: null, suggestedTicker: null, refused: [], score: 2 };
}

/** The query names the team itself (nickname, Kalshi/ESPN abbreviation or an alternative), not only its city. */
export const namesTeam = (q: string, t: EspnTeam): boolean => { const n = norm(q); return [t.nickname, t.abbr, ...t.alt].some((k) => k.length >= 2 && n.includes(` ${k.toLowerCase()} `)); };

function teamCards(q: string, teams: EspnTeam[]): Suggestion[] {
  const wantsLoss = /\b(lose|loses|losing|loss|losses)\b/i.test(q);
  const out: Suggestion[] = [];
  for (const t of teams.slice(0, 3)) for (const outcome of (wantsLoss ? ["loss", "win"] : ["win", "loss"]) as ("win" | "loss")[]) {
    // a city alone ("Detroit high above 90") names four teams and probably the weather: rank those below a nickname / abbreviation hit
    const named = namesTeam(q, t);
    const series = teamSeries(t.league, t.abbr, outcome), src = nativeSourceById(series)!;
    out.push({ id: `espn:${series}`, venue: "espn", venueLabel: "ESPN scoreboard · first-party", title: `burns every time the ${t.nickname} ${outcome === "win" ? "win" : "lose"}`, subtitle: `${t.name} (${LEAGUES[t.league].label}) · every game this season`, settlement: src.sourceName, settleAt: null, howSettles: src.unit.definition, rule: nativeRule(series), pick: { oracle: "catalogue", series, market: null, title: src.title }, source: { unit: src.unit, baseline: 0, direction: "up" }, href: null, suggestedName: `${t.nickname} ${outcome === "win" ? "Win" : "Lose"}`, suggestedTicker: tickerOf(t.nickname), refused: [], score: (named ? 1 : 0.5) * ((outcome === "loss") === wantsLoss ? 1.6 : 1.2) });
  }
  return out;
}

async function nextGameCard(espn: EspnClient, t: EspnTeam, q: string, nowMs: number): Promise<Suggestion | null> {
  const games = await espn.season(t.league, t.abbr).catch(() => []);
  const g = games.find((x) => !x.completed && Date.parse(x.startsAt) > nowMs - 3 * 3_600_000 && outcomeOf(x, t.abbr) === null);
  if (!g) return null;
  const outcome: "win" | "loss" = /\b(lose|loses|losing|loss)\b/i.test(q) ? "loss" : "win";
  const series = gameSeries(t.league, g.eventId, t.abbr, outcome), src = nativeSourceById(series)!;
  const opp = g.home.abbr === t.abbr ? g.away : g.home;
  return { id: `espn:${series}`, venue: "espn", venueLabel: "ESPN scoreboard · first-party", title: `burns if the ${t.nickname} ${outcome === "win" ? "win" : "lose"} ${g.home.abbr === t.abbr ? "vs" : "at"} ${opp.nickname || opp.abbr}`, subtitle: `this game only · ${g.detail || g.startsAt}`, settlement: src.sourceName, settleAt: g.startsAt, howSettles: src.unit.definition, rule: nativeRule(series, { fractionOfPool: 0.05 }), pick: { oracle: "catalogue", series, market: null, title: src.title }, source: { unit: src.unit, baseline: 0, direction: "up" }, href: null, suggestedName: `${t.nickname} ${outcome === "win" ? "Win" : "Lose"}`, suggestedTicker: tickerOf(t.nickname), refused: [], score: /\b(sunday|monday|tonight|today|tomorrow|this|next|game|saturday|thursday)\b/i.test(q) ? 1.8 : 1.3 };
}

function weatherCards(q: string): Suggestion[] {
  const st = findStations(q);
  if (!st.length) return [];
  const n = /(-?\d+(?:\.\d+)?)/.exec(q.replace(/\s*°\s*f?\b/i, ""))?.[1];
  const metrics: NwsMetric[] = /\bsnow/i.test(q) ? ["snow"] : /\b(rain|rainfall|precip|precipitation|wet)\b/i.test(q) ? ["rain"] : /\b(high|hot|heat|temp|temperature|degrees|above|over|°)\b/i.test(q) || n ? ["high"] : ["high", "rain", "snow"];
  const out: Suggestion[] = [];
  for (const s of st.slice(0, 2)) for (const m of metrics) {
    const thr = m === "snow" ? null : m === "rain" ? (n && Number(n) < 10 ? Number(n) : 0.5) : (n && Number(n) >= 0 ? Math.round(Number(n)) : 90);
    const series = nwsSeries(m, s.code, thr), src = nativeSourceById(series);
    if (!src) continue;
    out.push({ id: `nws:${series}`, venue: "nws", venueLabel: "NWS daily climate · first-party", title: `burns ${m === "high" ? `every day ${s.city}'s high reaches ${thr} °F` : m === "rain" ? `every day ${s.city} gets ${Number(thr).toFixed(2)} in of rain or more` : `on ${s.city}'s first snow of the season`}`, subtitle: `${nwsSeriesTitle(parseNwsSeries(series)!)} · station ${s.code}`, settlement: src.sourceName, settleAt: null, howSettles: src.unit.definition, rule: nativeRule(series), pick: { oracle: "catalogue", series, market: null, title: src.title }, source: { unit: src.unit, baseline: 0, direction: "up" }, href: null, suggestedName: `${s.city} ${m === "high" ? "Heat" : m === "rain" ? "Rain" : "Snow"}`, suggestedTicker: tickerOf(`${s.code}${m === "high" ? "HOT" : m === "rain" ? "RAIN" : "SNOW"}`), refused: [], score: 1.5 });
  }
  return out;
}

function feedCards(q: string, feeds: readonly FeedLike[]): Suggestion[] {
  const nq = norm(q);
  const out: Suggestion[] = [];
  for (const f of feeds) {
    if (!f.launchable.ok || !f.unit || f.baseline === null || !f.direction) continue;
    const base = f.id.split(":")[0];
    const kw = (FEED_WORDS[base] ?? []).filter((w) => nq.includes(` ${w} `)).length;
    const score = kw ? 1.4 + kw * 0.1 : overlap(q, `${f.title} ${f.sourceName}`) >= 0.5 ? 1 : 0;
    if (!score) continue;
    const rule = { schema: BURNTICKER_RULES_SCHEMA, oracle: "catalogue", series: f.id, market: null, filter: {}, kind: "scalar", scalar: { unit: f.unit.size, perUnit: { fractionOfPool: 0.02 }, baseline: f.baseline, direction: f.direction }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } as BurnRule;
    out.push({ id: `feed:${f.id}`, venue: "feed", venueLabel: `${f.sourceName} · first-party`, title: `burns per ${f.unit.label}`, subtitle: f.title, settlement: f.sourceName, settleAt: null, howSettles: f.unit.definition, rule, pick: { oracle: "catalogue", series: f.id, market: null, title: f.title }, source: { unit: f.unit, baseline: typeof f.baseline === "number" ? f.baseline : 0, direction: "up" }, href: null, suggestedName: null, suggestedTicker: null, refused: [], score });
  }
  return out;
}

export const polyRule = (conditionId: string, fraction = 0.05): BurnRule => ({ schema: BURNTICKER_RULES_SCHEMA, oracle: "polymarket", series: null, market: conditionId, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: fraction }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } as BurnRule);

export function raceCards(races: readonly Race[], q: string): Suggestion[] {
  return searchRaces(races, q).slice(0, 4).map(({ race: r, outcome: o, score }) => {
    const surname = o.label.replace(/\s*\([A-Z]\)$/, "").split(" ").pop() ?? o.label;
    return { id: `polymarket:${o.conditionId}`, venue: "polymarket", venueLabel: "Polymarket · adjudicated, on-chain payout", title: outcomeCardTitle(r, o), subtitle: `${r.title}${r.hiddenPlaceholders ? ` · ${r.hiddenPlaceholders} unnamed placeholder market(s) hidden` : ""}`, settlement: `${r.settlement} — ${r.sos.name}: ${r.sos.url}`, settleAt: r.settlesOn, howSettles: `${outcomeSettlesNote(r, o)}${r.description ? `\n\nResolution rules (Polymarket): ${r.description}` : ""}`, rule: polyRule(o.conditionId), pick: { oracle: "polymarket", series: null, market: o.conditionId, title: `${o.label} wins the ${r.title.replace(/ Election Winner$/, "")} race (resolves once)`, yes: o.yes, no: o.no }, source: null, href: r.url, suggestedName: `${surname} Wins`, suggestedTicker: tickerOf(surname), refused: r.refused, score: 1 + score };
  });
}

export async function universalSearch(q: string, d: SearchDeps): Promise<{ query: string; cards: Suggestion[]; empty: boolean; errors: string[] }> {
  const query = q.trim().slice(0, 160);
  if (query.length < 2) return { query, cards: [], empty: true, errors: [] };
  const errors: string[] = []; const cards: Suggestion[] = [];
  const derby = derbyCard(query, d.derbyHref);
  if (derby) return { query, cards: [derby], empty: false, errors };
  const teams = findTeams(query);
  cards.push(...teamCards(query, teams));
  if (d.espn && teams[0] && namesTeam(query, teams[0])) { const g = await nextGameCard(d.espn, teams[0], query, d.nowMs).catch(() => null); if (g) cards.push(g); }
  cards.push(...weatherCards(query), ...feedCards(query, d.feeds));
  if (d.venues.polymarket && d.polyGet) {
    try { cards.push(...raceCards(await loadRaces(d.polyGet, d.refuse), query)); } catch (e) { errors.push(`elections: ${(e as Error).message.slice(0, 80)}`); }
    // Gamma's free-text search only when nothing above matched well (a named race, team, station or feed answers the query on its own)
    if (!teams.length && !cards.some((c) => c.score >= 1.5)) {
      try {
        const hits = searchHits(parseEventsBody(await d.polyGet(searchUrl(query.replace(/\b(wins?|will|above|over)\b/gi, " ").replace(/\s+/g, " ").trim(), "open", 8))), { refuse: d.refuse, status: "open", perEvent: 4 });
        for (const e of hits.events.slice(0, 4)) for (const m of e.markets.slice(0, 2)) {
          if (cards.some((c) => c.pick?.market === m.conditionId)) continue;
          const label = m.outcome ?? m.question;
          cards.push({ id: `polymarket:${m.conditionId}`, venue: "polymarket", venueLabel: "Polymarket · adjudicated, on-chain payout", title: m.outcome ? `${label} — ${e.title}` : m.question, subtitle: `YES = ${m.yes}, NO = ${m.no}`, settlement: "Polymarket on-chain payout (Conditional Tokens on Polygon)", settleAt: m.endDate, howSettles: `Settles on "${m.question}" resolving ${m.yes}.`, rule: polyRule(m.conditionId), pick: { oracle: "polymarket", series: null, market: m.conditionId, title: `${m.question} (resolves once)`, yes: m.yes, no: m.no }, source: null, href: e.url, suggestedName: null, suggestedTicker: null, refused: e.refused, score: 0.6 + overlap(query, `${m.question} ${label} ${e.title}`) });
        }
      } catch (e) { errors.push(`polymarket: ${(e as Error).message.slice(0, 80)}`); }
    }
  }
  if (d.venues.kalshi && d.kalshiSearch) {
    try {
      for (const s of (await d.kalshiSearch(query)).slice(0, 3)) cards.push({ id: `kalshi:${s.ticker}`, venue: "kalshi", venueLabel: "Kalshi", title: s.title, subtitle: `every market in series ${s.ticker}`, settlement: s.settlementSource?.name ?? "Kalshi", settleAt: null, howSettles: null, rule: null, pick: { oracle: "kalshi", series: s.ticker, market: null, title: s.title }, source: null, href: null, suggestedName: null, suggestedTicker: null, refused: [], score: 0.5 + overlap(query, s.title) });
    } catch (e) { errors.push(`kalshi: ${(e as Error).message.slice(0, 80)}`); }
  }
  const seen = new Set<string>();
  const ranked = cards.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).sort((a, b) => b.score - a.score).slice(0, 12);
  return scrubMarketData({ query, cards: ranked, empty: ranked.length === 0, errors });
}

/** The Coin vs Coin page, when another branch has built it (src/app/burnticker/derby). */
export function derbyHrefFrom(root = process.cwd()): string | null {
  return fs.existsSync(path.join(root, "src", "app", "burnticker", "derby", "page.tsx")) ? "/burnticker/derby" : null;
}
