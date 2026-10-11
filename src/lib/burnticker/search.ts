import fs from "node:fs";
import path from "node:path";
import type { BurnRule } from "@/lib/burnticker/rules";
import { BURNTICKER_RULES_SCHEMA } from "@/lib/burnticker/rules";
import { findTeams, gameSeries, teamSeries, LEAGUES, SCHEDULE_NEEDS_KEY, ScheduleUnavailable, windowChoices, windowFor, windowPhrase, type EspnClient, type EspnTeam, type Game, type LeagueId, type WindowKind } from "@/lib/burnticker/sources/espn";
import { findStations, nwsSeries, nwsSeriesTitle, parseNwsSeries, type NwsMetric } from "@/lib/burnticker/sources/nws";
import { nativeRule, nativeSourceById } from "@/lib/burnticker/sources/native";
import { loadRaces, outcomeCardTitle, outcomeSettlesNote, searchRaces, tokens, type Race } from "@/lib/burnticker/elections";
import { eventPageUrl, parseEventsBody, searchUrl, type GammaEvent, type TitleRefuser } from "@/lib/burnticker/oracle/polymarket";
import { scrubMarketData, type VenueFlags } from "@/lib/burnticker/venues";
import { looksLikePerson, meaningful, nameMatch, queryTokens } from "@/lib/burnticker/textMatch";
import { matchPolymarket, plainQuestion, outcomeLabel, outcomeTicker, searchQueries, splitQuery, type PickerOutcome } from "@/lib/burnticker/polySearch";
import { championshipCode, describeRule, tickerFrom, type CoinText, type DescribeCtx } from "@/lib/burnticker/describe";
import type { SeriesSummary } from "@/lib/burnticker/oracle/types";

/**
 * INTENT → RULE CARDS (2026-10-10, the owner thinks in sentences, not sources). One box on the launch page takes a plain phrase and
 * answers 2–3 READY RULES as plain-English cards: the full rule sentence, the venue / source and its cross-read, the next possible burn,
 * the end, a one-shot / recurring badge, the auto-generated coin text (describe.ts) and the exact rule — one click lands on the create
 * screen pre-filled. A simple matcher, no model at runtime:
 *
 *   a TEAM is named  ALWAYS both shapes, plus the matchup when a live game exists:
 *                    (a) recurring "Burns 2% every time the <Team> win a game — <the rest of the regular season | this postseason>"
 *                        (each game: its on-chain payout where a moneyline market exists, else TheSportsDB's licensed final; the league's
 *                        official feed or API-Sports as the cross-read; ESPN only lists the games)
 *                    (b) one-shot "Burns 10% once, if the <Team> win the <championship>" (Polymarket's winner market found through
 *                        Gamma → the team's outcome → its conditionId, settled on the on-chain payout; the league's official results as
 *                        the cross-check) — and when the market lists no outcome for the team, the card SAYS so instead of vanishing
 *                    (c) "Two coins on <game>": the next game, when both teams are known
 *   elections        candidate / state / office → Polymarket race outcomes (elections.ts; Gamma groupItemTitle)
 *   weather          city + high / rain / snow → NWS climate rules at that station (the number in the query = the threshold)
 *   feeds            keywords from sources.json titles plus a small table (debt, CPI, unemployment …)
 *   coin vs coin     "WIF vs SHIB" → the Coin vs Coin tile
 *   otherwise        Gamma's free-text search (binary, active, named outcomes); Kalshi only with BURNTICKER_KALSHI_ENABLED
 *
 * No price, odds, volume or liquidity in the payload (venues.ts).
 */

export type SuggestionVenue = "feed" | "espn" | "nws" | "polymarket" | "kalshi" | "tile";
export interface SuggestionPick { oracle: "catalogue" | "polymarket" | "kalshi"; series: string | null; market: string | null; title: string; yes?: string; no?: string }
export interface MatchupSide { abbr: string; name: string; nickname: string; ticker: string; series: string }
export interface Suggestion {
  id: string; venue: SuggestionVenue; venueLabel: string;
  /** The full rule sentence ("Burns 2% every time the Rays win a game — this postseason"). */
  title: string; subtitle: string;
  shape: "recurring" | "one-shot" | "pair" | "tile";
  /** Who settles it and who cross-reads it, in words. */
  settlement: string; crossRead: string | null;
  /** The next possible burn (a game's start, a market's end) and the end of the rule (null: open-ended / "with the team's season"). */
  nextAt: string | null; endAt: string | null; endText: string | null;
  /** Kept for older callers: the date the result is due (= nextAt for one-shots). */
  settleAt: string | null;
  howSettles: string | null; rule: BurnRule | null; pick: SuggestionPick | null;
  source: { unit: { size: number; label: string; definition: string }; baseline: number; direction: "up" } | null;
  /** The auto-generated coin text (describe.ts), for rule cards. */
  text: CoinText | null;
  /** What describeRule needs besides the ticker, so the create screen re-renders the same text as the dials and the ticker move. */
  descCtx: Omit<DescribeCtx, "ticker"> | null;
  /** The window badge ("2026 SEASON", "PERPETUAL", "ONE-SHOT · Oct 31, 2026"). */
  badge: string | null;
  /** A team coin's other windows, offered inline on the card (this season is the default): each a ready rule with its own text. */
  windows: WindowOption[] | null;
  /** An outcome-list market's set (league mode on the create screen): the championship card's event, the team's outcome. */
  leagueSet: { id: string; outcome: string } | null;
  /** The ESPN season year in progress, for a team card (the create screen's window dial needs it). */
  seasonYear: number | null;
  /** The card's category on the page (teams, elections, weather, feeds, markets, tiles). */
  group?: SuggestionGroup;
  /** The matchup card: both sides, each with its one-game loss selector. */
  matchup: { league: string; eventId: string; title: string; startsAt: string; a: MatchupSide; b: MatchupSide } | null;
  /** When a card cannot offer its rule, why ("market lists no Rays outcome"). */
  note: string | null;
  /** An event card (polySearch.ts): pick one of the event's named outcomes, then the normal dials. No numbers. */
  picker?: { slug: string; title: string; noun: string; outcomes: PickerOutcome[] } | null;
  href: string | null; suggestedName: string | null; suggestedTicker: string | null; refused: string[]; score: number;
}
export interface WindowOption { kind: WindowKind; label: string; title: string; rule: BurnRule; text: CoinText; endText: string }
export interface FeedLike { id: string; title: string; sourceName: string; cadence: string; unit: { size: number; label: string; definition: string } | null; direction: "up" | "down" | "abs" | null; baseline: "previousSettlement" | number | null; launchable: { ok: boolean; why: string | null } }

export interface SearchDeps {
  venues: VenueFlags; feeds: readonly FeedLike[]; espn: EspnClient | null; polyGet: ((url: string) => Promise<unknown>) | null; refuse: TitleRefuser;
  kalshiSearch: ((q: string) => Promise<SeriesSummary[]>) | null; derbyHref: string | null; nowMs: number;
}

const FEED_WORDS: Record<string, string[]> = {
  "treasury.debt": ["debt", "national debt", "deficit", "treasury", "debt to the penny"], "fred.GFDEBTN": ["federal debt"], "fred.UNRATE": ["unemployment", "jobless", "jobs report"],
  "fred.CPIAUCSL": ["cpi", "inflation", "consumer prices"], "bls.eggs": ["egg", "eggs"], "ll2.launches": ["launch", "launches", "rocket", "spacex", "starship", "orbital"],
  "noaa.flares": ["flare", "flares", "solar", "sun"], "jpl.neo": ["asteroid", "asteroids", "near miss", "near earth"], "wiki.views": ["wikipedia", "page views"],
  "ethereum.baseFeeBurn": ["eth burn", "ethereum burn", "base fee"], "bitcoin.blockHeight": ["bitcoin blocks", "btc blocks"], "solana.blockHeight": ["solana blocks"],
  "fedreg.finalRules": ["federal register", "final rules", "regulations"], "openfda.approvals": ["fda", "drug approval", "approvals"], "github.stars": ["github", "stars"], "steam.players": ["steam", "players"],
};
const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9$.]+/g, " ").replace(/\s+/g, " ").trim()} `;
const overlap = (q: string, words: string): number => { const qt = tokens(q); if (!qt.length) return 0; const h = new Set(tokens(words)); return qt.filter((w) => h.has(w)).length / qt.length; };
const base = { venueLabel: "", subtitle: "", crossRead: null, nextAt: null, endAt: null, endText: null, settleAt: null, howSettles: null, rule: null, pick: null, source: null, text: null, descCtx: null, badge: null, windows: null, leagueSet: null, seasonYear: null, matchup: null, note: null, href: null, suggestedName: null, suggestedTicker: null, refused: [] as string[] };
const pctOf = (f: number) => `${Math.round(f * 1000) / 10}%`;

function derbyCard(q: string, href: string | null): Suggestion | null {
  const m = /^\s*\$?([A-Za-z0-9]{2,10})\s+(?:vs\.?|v\.?|versus)\s+\$?([A-Za-z0-9]{2,10})\s*$/i.exec(q);
  if (!m || findTeams(m[1]).length || findTeams(m[2]).length) return null;
  const a = m[1].toUpperCase(), b = m[2].toUpperCase();
  return { ...base, id: `tile:derby:${a}-${b}`, venue: "tile", venueLabel: "Coin vs Coin", shape: "tile", title: `$${a} vs $${b} — a coin-vs-coin derby`, subtitle: href ? "open the Coin vs Coin page" : "not built yet", settlement: "Coin vs Coin (its own rules page)", href, score: 2 };
}

/** The query names the team itself (nickname, abbreviation or an alternative), not only its city. */
export const namesTeam = (q: string, t: EspnTeam): boolean => { const n = norm(q); return (t.strictKeys ?? [t.nickname, t.abbr, ...t.alt]).some((k) => k.length >= 2 && n.includes(` ${k.toLowerCase().replace(/[^a-z0-9$.]+/g, " ").trim()} `)); };
const CHAMP_WORDS = /\b(world series|championship|champions?|title|super ?bowl|stanley cup|finals|pennant|ring)\b/i;
/** Who settles a team coin's game, in words (gameSettle.ts): never ESPN. */
export const SPORTS_SETTLEMENT = "the game's on-chain payout where a market exists, else a licensed final score";
const CROSS_NAME_: Partial<Record<LeagueId, string>> = { nhl: "NHL's official scores", mlb: "MLB's official feed", nba: "NBA's official feed" };
const OFFICIAL_: Partial<Record<LeagueId, string>> = { mlb: "MLB's official postseason results (statsapi.mlb.com)", nba: "the NBA's official results (nba.com)", nhl: "the NHL's official results (nhl.com)", nfl: "the league's official results" };
const OFFICIAL_SHORT_: Partial<Record<LeagueId, string>> = { mlb: "MLB's official results", nba: "the NBA's official results", nhl: "the NHL's official results", nfl: "the league's official results" };
const CROSS_NAME = new Proxy({} as Record<LeagueId, string>, { get: (_t, lg: string) => CROSS_NAME_[lg as LeagueId] ?? "a second independent source (the on-chain payout and the licensed final confirm each other)" });
const OFFICIAL = new Proxy({} as Record<LeagueId, string>, { get: (_t, lg: string) => OFFICIAL_[lg as LeagueId] ?? `the ${LEAGUES[lg as LeagueId]?.label ?? "league"}'s official results` });
const OFFICIAL_SHORT = new Proxy({} as Record<LeagueId, string>, { get: (_t, lg: string) => OFFICIAL_SHORT_[lg as LeagueId] ?? "the league's official results" });
/** Friendlier names and tickers for the common feeds (else the title's first word). */
const FEED_SUGGEST: Record<string, { name: string; ticker: string }> = { "treasury.debt": { name: "Debt Clock", ticker: "DEBT" }, "fred.CPIAUCSL": { name: "CPI Mover", ticker: "CPI" }, "fred.UNRATE": { name: "Jobless Rate", ticker: "JOBLESS" }, "bls.eggs": { name: "Egg Index", ticker: "EGGS" }, "ll2.launches": { name: "Launch Day", ticker: "LAUNCH" }, "noaa.flares": { name: "Solar Flare", ticker: "FLARE" }, "jpl.neo": { name: "Near Miss", ticker: "NEARMISS" }, "fred.GFDEBTN": { name: "Federal Debt", ticker: "FEDDEBT" } };
/** Each league's championship query on Gamma and the event title that is the winner market (not a conference, a division or an MVP). */
export const CHAMPIONSHIP: Partial<Record<LeagueId, { query: string; title: RegExp; name: (year: string) => string }>> = {
  mlb: { query: "World Series Champion", title: /^MLB World Series Champion (\d{4})$/, name: (y) => `the ${y} World Series` },
  nfl: { query: "Pro Football Champion", title: /^Pro Football: (\d{4}) Champion/, name: (y) => `the ${y} pro football championship` },
  nba: { query: "NBA Champion", title: /^NBA: (\d{4}) Champion$/, name: (y) => `the ${y} NBA championship` },
  nhl: { query: "NHL Champion", title: /^NHL: (\d{4}) Champion/, name: (y) => `the ${y} NHL championship` },
};

const poss = (n: string) => (n.endsWith("s") ? `${n}'` : `${n}'s`);
/** "the Rays" / "the Lakers", but "Arsenal", "Inter Miami", "Georgia" (clubs and colleges take no article). */
export const teamRef = (t: EspnTeam): string => (LEAGUES[t.league].sport === "soccer" || t.league === "cfb" || t.league === "mcbb" || t.league === "wcbb" ? t.nickname : `the ${t.nickname}`);
function windowTitle(t: EspnTeam, outcome: "win" | "loss" | "draw", kind: WindowKind, phrase: string): string {
  const head = `Burns 2% every time ${teamRef(t)} ${outcome === "win" ? "win" : outcome === "draw" ? "draw" : "lose"} a ${LEAGUES[t.league].sport === "soccer" ? "match" : "game"}`;
  if (kind === "perpetual") return `${head} — every season, no end date — this coin does not retire`;
  if (kind === "season") return `${head} — this season (${phrase.replace(/^the | season(, playoffs included)?$/g, "")}${/playoffs included/.test(phrase) ? ", playoffs included" : ""})`;
  if (kind === "next") return `${head} — their ${phrase.replace(/^the /, "").replace(/ from .*$/, "")} only`;
  return `${head} — ${phrase} only`;
}
function windowEndText(t: EspnTeam, kind: WindowKind, phrase: string): string {
  if (kind === "perpetual") return "no end date — this coin does not retire";
  if (kind === "next") return `ends after the last of ${phrase.replace(/^the /, "the ")}, then burns down over four weeks and retires`;
  return `ends with ${poss(teamRef(t))} last ${kind === "post" ? "playoff " : ""}game of ${phrase.replace(/, playoffs included$/, "")}, then burns down over four weeks and retires`;
}

function recurringCard(t: EspnTeam, games: readonly Game[], outcome: "win" | "loss" | "draw", nowMs: number): Suggestion {
  const w = windowFor(t.league, games, nowMs);
  const windows: WindowOption[] = windowChoices(t.league, w.year, nowMs).map((c) => {
    const series = teamSeries(t.league, t.abbr, outcome, c.window), rule = nativeRule(series, { fractionOfPool: 0.02 });
    const phrase = windowPhrase(t.league, c.window);
    const text = describeRule(rule, { ticker: "", endsAt: c.kind === "season" ? w.endsAt : null });
    return { kind: c.kind, label: c.label, title: windowTitle(t, outcome, c.kind, phrase), rule, text, endText: windowEndText(t, c.kind, phrase) };
  });
  const def = windows[0];
  const series = def.rule.series!, src = nativeSourceById(series)!;
  const descCtx = { endsAt: w.endsAt };
  return {
    ...base, id: `espn:${series}`, venue: "espn", venueLabel: "On-chain payout · league's official feed", shape: "recurring",
    title: def.title, subtitle: `${t.name} (${LEAGUES[t.league].label})`,
    settlement: SPORTS_SETTLEMENT, crossRead: CROSS_NAME[t.league], nextAt: w.next?.startsAt ?? null, settleAt: w.next?.startsAt ?? null, endAt: w.endsAt, endText: def.endText,
    howSettles: src.unit.definition, rule: def.rule, pick: { oracle: "catalogue", series, market: null, title: src.title }, source: { unit: src.unit, baseline: 0, direction: "up" },
    text: def.text, descCtx, badge: def.text.badge, windows, seasonYear: w.year, suggestedName: def.text.name, suggestedTicker: def.text.ticker, score: 3,
  };
}

async function championshipCard(t: EspnTeam, d: SearchDeps): Promise<Suggestion> {
  const c = CHAMPIONSHIP[t.league];
  const card = (o: Partial<Suggestion>): Suggestion => ({ ...base, id: `champ:${t.league}:${t.abbr}`, venue: "polymarket", venueLabel: "Polymarket · adjudicated, on-chain payout", shape: "one-shot", title: `Burns 10% once, if ${teamRef(t)} win the championship`, subtitle: t.name, settlement: "Polymarket's on-chain payout", crossRead: OFFICIAL[t.league], score: 2.9, ...o });
  if (!c) return card({ note: `no championship market is mapped for ${LEAGUES[t.league].label} yet` });
  if (!d.venues.polymarket || !d.polyGet) return card({ note: "Polymarket discovery is off on this host: no championship market to bind to" });
  let ev: GammaEvent | undefined;
  try { ev = parseEventsBody(await d.polyGet(searchUrl(c.query, "open", 8))).find((e) => c.title.test(e.title) && !e.closed); } catch { ev = undefined; }
  if (!ev) return card({ note: `no open ${LEAGUES[t.league].label} championship market was found` });
  const year = c.title.exec(ev.title)?.[1] ?? "";
  const champ = c.name(year);
  const title = `Burns 10% once, if ${teamRef(t)} win ${champ}`;
  const m = ev.markets.find((x) => !x.inactive && (x.groupItemTitle?.toLowerCase() === t.name.toLowerCase() || x.groupItemTitle?.toLowerCase() === t.nickname.toLowerCase()));
  if (!m) return card({ title, href: `https://polymarket.com/event/${ev.slug}`, endAt: ev.endDate, note: `market lists no ${t.nickname} outcome` });
  if (m.closed) return card({ title, href: `https://polymarket.com/event/${ev.slug}`, endAt: ev.endDate, note: `the ${t.nickname} outcome is closed on Polymarket (eliminated or already resolved)` });
  const rule = polyRule(m.conditionId, 0.10);
  const phrase = `${teamRef(t)} win ${champ}`;
  const code = championshipCode(t.league);
  const descCtx = { eventPhrase: phrase, crossRead: OFFICIAL_SHORT[t.league], endsAt: ev.endDate, suggest: { name: `${t.nickname} ${code === "WS" ? "World Series" : code === "CUP" ? "Cup" : "Champs"}`.slice(0, 32), ticker: tickerFrom(t.nickname, code) } };
  const text = describeRule(rule, { ticker: "", ...descCtx });
  return card({
    title, subtitle: `${t.name} · ${ev.title}`, nextAt: ev.endDate, settleAt: ev.endDate, endAt: ev.endDate, endText: "ends when the market resolves",
    howSettles: `Settles on Polymarket's on-chain payout for "${m.groupItemTitle}" in ${ev.title}; ${OFFICIAL[t.league]} are the published cross-check.${ev.description ? `\n\nResolution rules (Polymarket): ${ev.description}` : ""}`,
    rule, pick: { oracle: "polymarket", series: null, market: m.conditionId, title: `${teamRef(t)} win ${champ} (resolves once)`, yes: m.outcomes[0] ?? "Yes", no: m.outcomes[1] ?? "No" },
    text, descCtx, leagueSet: { id: `champ-${t.league}-${year || "season"}`, outcome: t.abbr }, href: `https://polymarket.com/event/${ev.slug}`, suggestedName: text.name, suggestedTicker: text.ticker,
  });
}

function matchupCard(t: EspnTeam, games: readonly Game[], nowMs: number): Suggestion | null {
  const g = games.find((x) => !x.completed && Date.parse(x.startsAt) > nowMs && x.home.abbr !== "TBD" && x.away.abbr !== "TBD" && x.home.abbr && x.away.abbr);
  if (!g) return null;
  const side = (s: Game["home"]): MatchupSide => ({ abbr: s.abbr, name: s.name, nickname: s.nickname || s.abbr, ticker: tickerFrom(s.nickname || s.abbr, "LOSE"), series: gameSeries(t.league, g.eventId, s.abbr, "loss") });
  const a = side(g.away), b = side(g.home);
  return {
    ...base, id: `pair:${t.league}:${g.eventId}`, venue: "espn", venueLabel: "On-chain payout · league's official feed", shape: "pair",
    title: `Two coins on ${g.name}: the loser's coin burns`, subtitle: g.detail || g.startsAt, settlement: SPORTS_SETTLEMENT, crossRead: CROSS_NAME[t.league],
    nextAt: g.startsAt, settleAt: g.startsAt, endAt: g.startsAt, endText: "ends after that game", howSettles: "One coin per team; each burns once if its team loses. A tie burns neither.",
    matchup: { league: t.league, eventId: g.eventId, title: g.name, startsAt: g.startsAt, a, b }, score: 2.8,
  };
}

async function teamIntentCards(q: string, t: EspnTeam, d: SearchDeps): Promise<Suggestion[]> {
  let scheduleNote: string | null = null;
  const games = d.espn ? await d.espn.season(t.league, t.abbr).catch((e) => { scheduleNote = e instanceof ScheduleUnavailable ? SCHEDULE_NEEDS_KEY : null; return [] as Game[]; }) : [];
  const outcome: "win" | "loss" | "draw" = /\b(lose|loses|losing|loss|losses)\b/i.test(q) ? "loss" : LEAGUES[t.league].draws && /\b(draw|draws|tie|ties)\b/i.test(q) ? "draw" : "win";
  const rec = recurringCard(t, games, outcome, d.nowMs);
  if (scheduleNote) rec.note = scheduleNote;
  const champ = await championshipCard(t, d);
  if (CHAMP_WORDS.test(q)) { champ.score = 3.1; }
  const pair = matchupCard(t, games, d.nowMs);
  return [rec, champ, ...(pair ? [pair] : [])];
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
    const rule = nativeRule(series, { fractionOfPool: 0.01 }), text = describeRule(rule, { ticker: "" });
    out.push({
      ...base, id: `nws:${series}`, venue: "nws", venueLabel: "NWS daily climate · first-party", shape: m === "snow" ? "one-shot" : "recurring",
      title: `Burns 1% ${m === "high" ? `every day ${s.city}'s high reaches ${thr} °F` : m === "rain" ? `every day ${s.city} gets ${Number(thr).toFixed(2)} in of rain or more` : `once, on ${s.city}'s first snow of the season`}`,
      subtitle: `${nwsSeriesTitle(parseNwsSeries(series)!)} · station ${s.code}`, settlement: "the National Weather Service's daily climate report", crossRead: "the Iowa Environmental Mesonet",
      endText: m === "snow" ? "ends after the first snow" : "no end date", howSettles: src.unit.definition, rule, pick: { oracle: "catalogue", series, market: null, title: src.title }, source: { unit: src.unit, baseline: 0, direction: "up" },
      text, descCtx: {}, suggestedName: text.name, suggestedTicker: text.ticker, score: 1.5,
    });
  }
  return out;
}

function feedCards(q: string, feeds: readonly FeedLike[]): Suggestion[] {
  const nq = norm(q);
  const out: Suggestion[] = [];
  for (const f of feeds) {
    if (!f.launchable.ok || !f.unit || f.baseline === null || !f.direction) continue;
    const kw = (FEED_WORDS[f.id.split(":")[0]] ?? []).filter((w) => nq.includes(` ${w} `)).length;
    const score = kw ? 1.4 + kw * 0.1 : overlap(q, `${f.title} ${f.sourceName}`) >= 0.5 ? 1 : 0;
    if (!score) continue;
    const rule = { schema: BURNTICKER_RULES_SCHEMA, oracle: "catalogue", series: f.id, market: null, filter: {}, kind: "scalar", scalar: { unit: f.unit.size, perUnit: { fractionOfPool: 0.02 }, baseline: f.baseline, direction: f.direction }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } as BurnRule;
    const descCtx = { feed: { title: f.title, sourceName: f.sourceName, unitLabel: f.unit.label }, suggest: FEED_SUGGEST[f.id.split(":")[0]] ?? null };
    const text = describeRule(rule, { ticker: "", ...descCtx });
    out.push({
      ...base, id: `feed:${f.id}`, venue: "feed", venueLabel: `${f.sourceName} · first-party`, shape: "recurring", title: `Burns 2% per ${f.unit.label} — ${f.title}`, subtitle: f.cadence,
      settlement: f.sourceName, crossRead: "an independent publisher of the same figure", endText: "no end date", howSettles: f.unit.definition, rule,
      pick: { oracle: "catalogue", series: f.id, market: null, title: f.title }, source: { unit: f.unit, baseline: typeof f.baseline === "number" ? f.baseline : 0, direction: "up" }, text, descCtx, suggestedName: text.name, suggestedTicker: text.ticker, score,
    });
  }
  return out;
}

/** A one-shot Polymarket rule: 10 % of the pool by default (the create screen's one-shot dial goes 1–100 %). */
export const polyRule = (conditionId: string, fraction = 0.1): BurnRule => ({ schema: BURNTICKER_RULES_SCHEMA, oracle: "polymarket", series: null, market: conditionId, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: fraction }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } as BurnRule);

export function raceCards(races: readonly Race[], q: string): Suggestion[] {
  return searchRaces(races, q).slice(0, 3).map(({ race: r, outcome: o, score }) => {
    const rule = polyRule(o.conditionId);
    const raceName = r.title.replace(/ Election Winner$/, "");
    const descCtx = { eventPhrase: `${o.label} wins the ${raceName} race`, crossRead: `the ${r.stateName ?? "state"} certified result`, endsAt: r.settlesOn };
    const text = describeRule(rule, { ticker: "", ...descCtx });
    return {
      ...base, id: `polymarket:${o.conditionId}`, venue: "polymarket", venueLabel: "Polymarket · adjudicated, on-chain payout", shape: "one-shot",
      title: outcomeCardTitle(r, o), subtitle: `${r.title}${r.hiddenPlaceholders ? ` · ${r.hiddenPlaceholders} unnamed placeholder market(s) hidden` : ""}`,
      settlement: `${r.settlement} — ${r.sos.name}: ${r.sos.url}`, crossRead: `${r.sos.name}`, nextAt: r.settlesOn, settleAt: r.settlesOn, endAt: r.settlesOn, endText: "ends when the race resolves",
      howSettles: `${outcomeSettlesNote(r, o)}${r.description ? `\n\nResolution rules (Polymarket): ${r.description}` : ""}`, rule,
      pick: { oracle: "polymarket", series: null, market: o.conditionId, title: `${o.label} wins the ${raceName} race (resolves once)`, yes: o.yes, no: o.no },
      text, descCtx, href: r.url, suggestedName: text.name, suggestedTicker: text.ticker, refused: r.refused, score: 1 + score,
    };
  });
}

const withBadges = (cards: Suggestion[]): Suggestion[] => cards.map((c) => ({ ...c, badge: c.badge ?? c.text?.badge ?? (c.shape === "pair" ? `ONE-SHOT${c.matchup ? ` · ${new Date(c.matchup.startsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" })}` : ""}` : null) }));

/** The card's group on the page (cards are grouped by category, best group first). */
export type SuggestionGroup = "teams" | "elections" | "weather" | "feeds" | "markets" | "tiles";
const groupOf = (c: Suggestion): SuggestionGroup => (c.venue === "espn" ? "teams" : c.venue === "nws" ? "weather" : c.venue === "feed" ? "feeds" : c.venue === "tile" ? "tiles" : c.id.startsWith("polymarket:") && c.howSettles?.includes("Resolution rules") && /wins the .* race/.test(c.title) ? "elections" : c.id.startsWith("champ:") ? "teams" : "markets");
/** At most this many cards, each above MIN_SCORE; nothing above it → "no close match — try Browse". */
export const MAX_CARDS = 6, MIN_SCORE = 1;

export async function universalSearch(q: string, d: SearchDeps): Promise<{ query: string; cards: Suggestion[]; empty: boolean; errors: string[] }> {
  const query = q.trim().slice(0, 160);
  // no meaningful token (every token one or two letters: "e", "el", "el s") → nothing, never a partial match
  if (query.length < 3 || !meaningful(queryTokens(query)).length) return { query, cards: [], empty: true, errors: [] };
  const errors: string[] = []; const cards: Suggestion[] = [];
  const derby = derbyCard(query, d.derbyHref);
  if (derby) return { query, cards: [derby], empty: false, errors };
  // a query carrying an event phrase ("spider man oscar", "spider-man best picture") is never read as a person's name
  const split = splitQuery(query);
  const person = looksLikePerson(query) && !split.phrase;
  const team = findTeams(query).find((t) => namesTeam(query, t) && nameMatch(query, [t.name, t.nickname, ...t.alt]).nameHits > 0) ?? null;
  // a person-looking query ("lakers tonight" is not one; "el sayed" is) goes to the people only when a candidate's name matches it
  let personHit = false;
  if (team && person && d.venues.polymarket && d.polyGet) { try { personHit = searchRaces(await loadRaces(d.polyGet, d.refuse), query).some((h) => h.score >= 1.5); } catch { personHit = false; } }
  if (team && !personHit) {
    // a team is named: exactly the team's shapes (recurring, one-shot championship, the next game when both sides are known)
    const tc = await teamIntentCards(query, team, d);
    return scrubMarketData({ query, cards: withBadges(tc.sort((a, b) => b.score - a.score)).map((c) => ({ ...c, group: groupOf(c) })), empty: false, errors });
  }
  cards.push(...weatherCards(query), ...feedCards(query, d.feeds));
  if (d.venues.polymarket && d.polyGet) {
    // an award / event phrase ("oscars", "best picture", "emmys") is never a race query: no candidate cards for it
    if (!split.phrase) { try { cards.push(...raceCards(await loadRaces(d.polyGet, d.refuse), query)); } catch (e) { errors.push(`elections: ${(e as Error).message.slice(0, 80)}`); } }
    if (!cards.some((c) => c.score >= 1.5) && !person) {
      try {
        // polySearch.ts: the whole query, the event phrase and the entity; EVERY market of every hit event is read (not markets[0])
        const events: GammaEvent[] = [];
        for (const sq of searchQueries(split)) { try { events.push(...parseEventsBody(await d.polyGet(searchUrl(sq, "open", 8)))); } catch (e) { errors.push(`polymarket: ${(e as Error).message.slice(0, 80)}`); } }
        const found = matchPolymarket(split, events, d.refuse);
        for (const mm of found.markets) {
          const { event: e, market: m } = mm;
          if (cards.some((c) => c.pick?.market === m.conditionId)) continue;
          const label = outcomeLabel(m), sentence = plainQuestion(m.question), rule = polyRule(m.conditionId);
          const descCtx = { eventPhrase: sentence, endsAt: m.endDate };
          const text = describeRule(rule, { ticker: outcomeTicker(label), ...descCtx });
          cards.push({ ...base, id: `polymarket:${m.conditionId}`, venue: "polymarket", venueLabel: "Polymarket · adjudicated, on-chain payout", shape: "one-shot", title: `Burns 10% once, if ${sentence} resolves YES`, subtitle: `${e.title} · YES = ${m.outcomes[0] ?? "Yes"}, NO = ${m.outcomes[1] ?? "No"}`, settlement: "Polymarket's on-chain payout (Conditional Tokens on Polygon)", nextAt: m.endDate, settleAt: m.endDate, endAt: m.endDate, endText: "ends when the market resolves", howSettles: `Settles on "${m.question}" resolving ${m.outcomes[0] ?? "Yes"}.`, rule, pick: { oracle: "polymarket", series: null, market: m.conditionId, title: `${m.question} (resolves once)`, yes: m.outcomes[0] ?? "Yes", no: m.outcomes[1] ?? "No" }, text, descCtx, suggestedTicker: outcomeTicker(label), suggestedName: label.slice(0, 32), href: eventPageUrl(e.slug), score: mm.score });
        }
        for (const em of found.events) {
          const e = em.event;
          cards.push({ ...base, id: `polyevent:${e.slug}`, venue: "polymarket", venueLabel: "Polymarket · adjudicated, on-chain payout", shape: "one-shot", title: em.noun === "outcome" ? `Pick one: ${e.title.trim()} — your coin burns 10% once if your pick wins` : `Pick a ${em.noun}: ${e.title.trim()} — your coin burns 10% once if it wins`, subtitle: `${em.outcomes.length} named ${em.noun === "outcome" ? "outcomes" : `${em.noun}s`}; each is its own yes/no market`, settlement: "Polymarket's on-chain payout (Conditional Tokens on Polygon)", nextAt: e.endDate, settleAt: e.endDate, endAt: e.endDate, endText: "ends when the market resolves", howSettles: "Settles on the market for the outcome you pick resolving YES; every other outcome is ignored.", note: em.note, href: eventPageUrl(e.slug), picker: { slug: e.slug, title: e.title.trim(), noun: em.noun, outcomes: em.outcomes }, score: em.score });
        }
      } catch (e) { errors.push(`polymarket: ${(e as Error).message.slice(0, 80)}`); }
    }
  }
  if (d.venues.kalshi && d.kalshiSearch) {
    try { for (const s of (await d.kalshiSearch(query)).slice(0, 2)) cards.push({ ...base, id: `kalshi:${s.ticker}`, venue: "kalshi", venueLabel: "Kalshi", shape: "recurring", title: s.title, subtitle: `every market in series ${s.ticker}`, settlement: s.settlementSource?.name ?? "Kalshi", pick: { oracle: "kalshi", series: s.ticker, market: null, title: s.title }, score: 0.5 + overlap(query, s.title) }); } catch (e) { errors.push(`kalshi: ${(e as Error).message.slice(0, 80)}`); }
  }
  // a query that reads like a person's name ranks people (election outcomes) above everything else
  if (person) for (const c of cards) if (groupOf(c) === "elections") c.score += 1;
  const seen = new Set<string>();
  const ranked = cards.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)) && c.score >= MIN_SCORE).sort((a, b) => b.score - a.score).slice(0, MAX_CARDS);
  // grouped by category, the best group first (its best card's score), best first inside each group
  const order = [...new Set(ranked.map(groupOf))];
  const grouped = order.flatMap((g) => ranked.filter((c) => groupOf(c) === g)).map((c) => ({ ...c, group: groupOf(c) }));
  return scrubMarketData({ query, cards: withBadges(grouped), empty: grouped.length === 0, errors });
}

/**
 * THE TICKER COLLISION CHECK: a suggested ticker already in the registry, or one the refuse list's name patterns catch, gets the
 * smallest number suffix that is free (RAYSWIN → RAYSWIN2), still at most 10 characters. The coin text is rewritten to name it.
 */
export function uniqueTicker(ticker: string, taken: (t: string) => boolean, refused: (t: string) => boolean = () => false): string {
  const t = ticker.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "COIN";
  const free = (x: string) => !taken(x) && !refused(x);
  if (free(t)) return t;
  for (let n = 2; n < 1000; n++) { const c = t.slice(0, 10 - String(n).length) + n; if (free(c)) return c; }
  return t;
}
const renameText = (x: CoinText, from: string, to: string): CoinText => {
  const sw = (s: string) => s.split(`$${from}`).join(`$${to}`);
  return { ...x, ticker: to, flavour: sw(x.flavour), ruleBlock: sw(x.ruleBlock), paragraph: sw(x.paragraph) };
};
/** Every suggested ticker on the cards (and on both sides of a matchup), made unique against the registry and the refuse list. */
export function dedupeTickers(cards: Suggestion[], taken: (t: string) => boolean, refused: (t: string) => boolean = () => false): Suggestion[] {
  const used = new Set<string>();
  const pick = (t: string) => { const u = uniqueTicker(t, (x) => taken(x) || used.has(x), refused); used.add(u); return u; };
  return cards.map((c) => {
    let out = c;
    if (c.suggestedTicker) { const u = pick(c.suggestedTicker); if (u !== c.suggestedTicker) out = { ...out, suggestedTicker: u, text: out.text ? renameText(out.text, out.text.ticker, u) : null }; }
    if (c.windows) out = { ...out, windows: c.windows.map((w, i) => { if (i === 0 && out.text) return { ...w, text: out.text }; const u = pick(w.text.ticker); return u === w.text.ticker ? w : { ...w, text: renameText(w.text, w.text.ticker, u) }; }) };
    if (c.matchup) out = { ...out, matchup: { ...c.matchup, a: { ...c.matchup.a, ticker: pick(c.matchup.a.ticker) }, b: { ...c.matchup.b, ticker: pick(c.matchup.b.ticker) } } };
    // an event card's outcomes: each suggested ticker free against the registry, the refuse list and each other ($SPIDER, $DUNE, …)
    if (c.picker) out = { ...out, picker: { ...c.picker, outcomes: c.picker.outcomes.map((o) => ({ ...o, ticker: pick(o.ticker) })) } };
    return out;
  });
}

/** The Coin vs Coin page, when another branch has built it (src/app/burnticker/derby). */
export function derbyHrefFrom(root = process.cwd()): string | null {
  return fs.existsSync(path.join(root, "src", "app", "burnticker", "derby", "page.tsx")) ? "/burnticker/derby" : null;
}
export type { DescribeCtx };
export { pctOf };
