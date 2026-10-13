import { isSingleSourceSeries } from "@/lib/burnticker/singleSource";
import { NEXT_EVENT_ONE_SHOT_RE } from "@/lib/burnticker/inverse";
import fs from "node:fs";
import path from "node:path";
import type { BurnRule } from "@/lib/burnticker/rules";
import { BURNTICKER_RULES_SCHEMA } from "@/lib/burnticker/rules";
import { findTeams, gameSeries, noPlayoffs, teamSeries, LEAGUES, ScheduleUnavailable, windowChoices, windowFor, windowPhrase, type EspnClient, type EspnTeam, type Game, type LeagueId, type WindowKind } from "@/lib/burnticker/sources/espn";
import { findStations, type NwsMetric } from "@/lib/burnticker/sources/nws";
import { weatherFrequency } from "@/lib/burnticker/sources/nwsClimate";
import { gameLine } from "@/lib/burnticker/oneShotEligibility";
import { climateDaySentence, FIRST_SNOW_SEASON, leastReportable, parseWeatherIntent, planWeather, type WeatherIntent, type WeatherPlan } from "@/lib/burnticker/weatherIntent";
import { nativeRule, nativeSourceById } from "@/lib/burnticker/sources/native";
import { loadRaces, outcomeCardTitle, outcomeSettlesNote, searchRaces, tokens, type Race } from "@/lib/burnticker/elections";
import { eventPageUrl, parseEventsBody, searchUrl, type GammaEvent, type TitleRefuser } from "@/lib/burnticker/oracle/polymarket";
import { scrubMarketData, type VenueFlags } from "@/lib/burnticker/venues";
import { looksLikePerson, meaningful, nameMatch, queryTokens } from "@/lib/burnticker/textMatch";
import { matchPolymarket, plainQuestion, outcomeLabel, outcomeTicker, searchQueries, splitQuery, type PickerOutcome } from "@/lib/burnticker/polySearch";
import { teamTicker } from "@/lib/burnticker/tickers";
import { feedById } from "@/lib/burnticker/catalogue";
import { parseUsgsSeries, USGS_MAGNITUDES } from "@/lib/burnticker/sources/usgs";
import { championshipCode, describeRule, tickerFrom, type CoinText, type DescribeCtx } from "@/lib/burnticker/describe";
import type { SeriesSummary } from "@/lib/burnticker/oracle/types";
import { DEFAULT_SHARE, pctLabel, shareOf } from "@/lib/burnticker/launchPresets";
import { scheduleProblem, SPORTS_CHIP } from "@/lib/burnticker/sources/provenance";
import { asksWomen, compoundOf, compoundSentence, isWomenLeague, milestoneOf, milestoneSentence, regularSeasonOnly, REGULAR_SEASON_SENTENCE, womenSentence, type Compound } from "@/lib/burnticker/teamQuery";
import { fitName } from "@/lib/burnticker/launchFields";

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
  /** website-15 item 8: the league's schedule could not be read, so the card says "Next game: not available." (provenance.ts) */
  scheduleUnavailable?: boolean;
  /** The confirmation source's own page (a link on the card; never inside a sentence). */
  crossReadUrl?: string | null;
  /** L04: the event as read — what, operator, when / timezone, recurrence — shown on the card before it is chosen. */
  interpreted?: string | null;
  /** L04: true when the card is a related rule, not the query's exact event (the page labels it "Alternative"). */
  alternative?: boolean;
  /** Intent audit item 6: the query held two conditions and the card follows only one of them (the note names the part left out). */
  partial?: boolean;
  /** An event card (polySearch.ts): pick one of the event's named outcomes, then the normal dials. No numbers. */
  picker?: { slug: string; title: string; noun: string; outcomes: PickerOutcome[] } | null;
  href: string | null; suggestedName: string | null; suggestedTicker: string | null; refused: string[]; score: number;
}
export interface WindowOption { kind: WindowKind; label: string; title: string; rule: BurnRule; text: CoinText; endText: string }
export interface FeedLike { id: string; title: string; sourceName: string; cadence: string; unit: { size: number; label: string; definition: string } | null; direction: "up" | "down" | "abs" | null; baseline: "previousSettlement" | number | null; launchable: { ok: boolean; why: string | null } }

export interface SearchDeps {
  venues: VenueFlags; feeds: readonly FeedLike[]; espn: EspnClient | null; polyGet: ((url: string) => Promise<unknown>) | null; refuse: TitleRefuser;
  kalshiSearch: ((q: string) => Promise<SeriesSummary[]>) | null; derbyHref: string | null; nowMs: number;
  /** ChatGPT audit 7 item 11: show markets that close within CLOSING_SOON_HOURS (hidden by default; the page's "Show closing soon") */
  closingSoon?: boolean;
}
/** Markets closing within this many hours are hidden from search by default (a coin made now would not graduate before the result). */
export const CLOSING_SOON_HOURS = 48;

const FEED_WORDS: Record<string, string[]> = {
  "treasury.debt": ["debt", "national debt", "deficit", "treasury", "debt to the penny"], "fred.GFDEBTN": ["federal debt"], "fred.UNRATE": ["unemployment", "jobless", "jobs report"],
  "fred.CPIAUCSL": ["cpi", "inflation", "consumer prices"], "bls.eggs": ["egg", "eggs"], "ll2.launches": ["launch", "launches", "rocket", "spacex", "starship", "orbital"],
  "noaa.flares": ["flare", "flares", "solar", "sun"], "jpl.neo": ["asteroid", "asteroids", "near miss", "near earth"], "wiki.views": ["wikipedia", "page views"],
  "ethereum.baseFeeBurn": ["eth burn", "ethereum burn", "base fee"], "bitcoin.blockHeight": ["bitcoin blocks", "btc blocks"], "solana.blockHeight": ["solana blocks"],
  "fedreg.finalRules": ["federal register", "final rules", "regulations"], "openfda.approvals": ["fda", "drug approval", "approvals"], "github.stars": ["github", "stars"], "steam.players": ["steam", "players"],
  // sources-3 (2026-10-12): natural disasters, the per-event forms (the one-shots are offered from Browse and the guided steps)
  "usgs.quakes": ["earthquake", "earthquakes", "quake", "quakes"], "nhc.storms": ["named storm", "named storms", "tropical storm"], "nhc.hurricanes": ["hurricane", "hurricanes"],
  "spc.tornadoes": ["tornado", "tornadoes"], "nifc.acres": ["wildfire", "wildfires", "acres burned"], "usgs.volcanoraise": ["volcano", "volcanoes", "volcanic"],
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
const FEED_SUGGEST: Record<string, { name: string; ticker: string }> = { "treasury.debt": { name: "Debt Clock", ticker: "DEBTUP" }, "fred.CPIAUCSL": { name: "CPI Mover", ticker: "CPI" }, "fred.UNRATE": { name: "Jobless Rate", ticker: "JOBLESS" }, "bls.eggs": { name: "Egg Index", ticker: "EGGS" }, "ll2.launches": { name: "Launch Day", ticker: "LAUNCH" }, "noaa.flares": { name: "Solar Flare", ticker: "FLARE" }, "jpl.neo": { name: "Near Miss", ticker: "NEARMISS" }, "fred.GFDEBTN": { name: "Federal Debt", ticker: "FEDDEBT" } };
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
  const head = `Burns ${pctLabel(DEFAULT_SHARE.recurring)} every time ${teamRef(t)} ${outcome === "win" ? "win" : outcome === "draw" ? "draw" : "lose"} a ${LEAGUES[t.league].sport === "soccer" ? "match" : "game"}`;
  if (kind === "perpetual") return `${head} — every season, no end date — this coin does not retire`;
  if (kind === "season") return `${head} — this season (${phrase.replace(/^the | season(, playoffs included)?$/g, "")}${/playoffs included/.test(phrase) ? ", playoffs included" : ""})`;
  if (kind === "next") return `${head} — their ${phrase.replace(/^the /, "").replace(/ from .*$/, "")} only`;
  return `${head} — ${phrase} only`;
}
function windowEndText(t: EspnTeam, kind: WindowKind, phrase: string): string {
  if (kind === "perpetual") return "no end date — this coin does not retire";
  // audit 6 item 3: the end the rule pins (describe.ts endText): the rest goes to $DEFICIT's burn; a void end burns down on the coin
  if (kind === "next") return `ends after the last of ${phrase.replace(/^the /, "the ")}, then the rest goes to $DEFICIT's burn and the coin retires`;
  return `ends with ${poss(teamRef(t))} last ${kind === "post" ? "playoff " : ""}game of ${phrase.replace(/, playoffs included$/, "")}, then the rest goes to $DEFICIT's burn and the coin retires`;
}

function recurringCard(t: EspnTeam, games: readonly Game[], outcome: "win" | "loss" | "draw", nowMs: number): Suggestion {
  const w = windowFor(t.league, games, nowMs);
  const choices = windowChoices(t.league, w.year, nowMs);
  const phrase0 = choices[0] ? windowPhrase(t.league, choices[0].window) : "every season";
  const windows: WindowOption[] = choices.map((c) => {
    const series = teamSeries(t.league, t.abbr, outcome, c.window), rule = nativeRule(series, { fractionOfPool: DEFAULT_SHARE.recurring });
    const phrase = windowPhrase(t.league, c.window);
    const text = describeRule(rule, { ticker: "", endsAt: c.kind === "season" ? w.endsAt : null });
    return { kind: c.kind, label: c.label, title: windowTitle(t, outcome, c.kind, phrase), rule, text, endText: windowEndText(t, c.kind, phrase) };
  });
  const def = windows[0];
  const series = def.rule.series!, src = nativeSourceById(series)!;
  const descCtx = { endsAt: w.endsAt };
  return {
    ...base, id: `espn:${series}`, venue: "espn", venueLabel: SPORTS_CHIP, shape: "recurring",
    title: def.title, subtitle: `${t.name} (${LEAGUES[t.league].label})`,
    settlement: SPORTS_SETTLEMENT, crossRead: CROSS_NAME[t.league], nextAt: w.next?.startsAt ?? null, settleAt: w.next?.startsAt ?? null, endAt: w.endsAt, endText: def.endText,
    howSettles: src.unit.definition, rule: def.rule, pick: { oracle: "catalogue", series, market: null, title: src.title }, source: { unit: src.unit, baseline: 0, direction: "up" },
    text: def.text, descCtx, badge: def.text.badge, windows, seasonYear: w.year, suggestedName: def.text.name, suggestedTicker: def.text.ticker, score: 3,
    interpreted: `This reads every ${LEAGUES[t.league].sport === "soccer" ? "match" : "game"} ${teamRef(t)} ${outcome === "win" ? "win" : outcome === "draw" ? "draw" : "lose"} in ${phrase0}. Game times are shown in Denver time. ${def.kind === "perpetual" ? "The coin has no end date and does not retire." : `The coin ${def.endText.replace(/, then the rest/, ". Then the rest").replace(/, then /, ". Then it ")}.`}`,
  };
}

/**
 * THE TEAM INTENT (intent audit 3, items 3 and 4: "Lakers win the 2028 NBA championship" offered the 2027 market unlabelled; "Lakers do
 * not win the 2027 NBA championship" became a YES coin). The year and the polarity the query names are part of the intent and are
 * compared with the market the card proposes: an exact year leads; another year is labelled a related rule with the year named; a
 * negated query takes the NO side of the binary rule (binary.onNo), which burns only on a NO payout.
 */
export interface TeamIntent { year: number | null; negated: boolean }
const NEGATED = /\b(?:do|does|did|will|would|could)\s+not\s+win\b|\b(?:don't|doesn't|didn't|won't|wouldn't|can't|cannot)\s+win\b|\bnot\s+win\b|\bnever\s+wins?\b|\bfails?\s+to\s+win\b|\bfall\s+short\b/i;
export function readTeamIntent(q: string): TeamIntent {
  const y = /\b(20\d{2})(?:[-–](?:20)?\d{2})?\b/.exec(q)?.[1];
  return { year: y ? Number(y) : null, negated: NEGATED.test(q) };
}
/** A one-shot NO rule on one market: burns only if the market pays NO (a void pays neither side, so it burns nothing). */
export const polyRuleNo = (conditionId: string, fraction: number = DEFAULT_SHARE.oneShot): BurnRule => ({ ...polyRule(conditionId, fraction), binary: { onYes: null, onNo: { fractionOfPool: fraction } } } as BurnRule);

async function championshipCard(t: EspnTeam, d: SearchDeps, ti: TeamIntent = { year: null, negated: false }): Promise<Suggestion> {
  const c = CHAMPIONSHIP[t.league];
  const verb = ti.negated ? "do not win" : "win";
  const card = (o: Partial<Suggestion>): Suggestion => ({ ...base, id: `champ:${t.league}:${t.abbr}${ti.negated ? ":no" : ""}`, venue: "polymarket", venueLabel: "Polymarket, settled by its on-chain payout", shape: "one-shot", title: `Burns ${pctLabel(DEFAULT_SHARE.oneShot)} once, if ${teamRef(t)} ${verb} the championship`, subtitle: t.name, settlement: "Polymarket's on-chain payout", crossRead: OFFICIAL[t.league], score: 2.9, ...o });
  if (!c) return card({ note: `No championship market is set up for the ${LEAGUES[t.league].label} yet.` });
  if (!d.venues.polymarket || !d.polyGet) return card({ note: "Polymarket search is turned off on this site, so there is no championship market to use." });
  let open: GammaEvent[] = [];
  try { open = parseEventsBody(await d.polyGet(searchUrl(c.query, "open", 8))).filter((e) => c.title.test(e.title) && !e.closed); } catch { open = []; }
  const yearOf = (e: GammaEvent) => Number(c.title.exec(e.title)?.[1] ?? NaN);
  const exact = ti.year !== null ? open.find((e) => yearOf(e) === ti.year) : open[0];
  const ev = exact ?? open[0];
  if (!ev) return card({ note: ti.year !== null ? `No open ${LEAGUES[t.league].label} championship market for ${ti.year} was found.` : `No open ${LEAGUES[t.league].label} championship market was found.` });
  const year = c.title.exec(ev.title)?.[1] ?? "";
  // a different year from the one typed: the card is a related rule, and it says which year it is
  const otherYear = ti.year !== null && !exact ? `There is no open ${LEAGUES[t.league].label} championship market for ${ti.year} on Polymarket. This card is the ${year} market, a different year from the one you typed.` : null;
  const champ = c.name(year);
  const title = `Burns ${pctLabel(DEFAULT_SHARE.oneShot)} once, if ${teamRef(t)} ${verb} ${champ}`;
  const m = ev.markets.find((x) => !x.inactive && (x.groupItemTitle?.toLowerCase() === t.name.toLowerCase() || x.groupItemTitle?.toLowerCase() === t.nickname.toLowerCase()));
  const rel = otherYear ? { alternative: true, score: 2.85 } : {};
  if (!m) return card({ title, href: `https://polymarket.com/event/${ev.slug}`, endAt: ev.endDate, note: [otherYear, `The market has no outcome for ${teamRef(t)}.`].filter(Boolean).join(" "), ...rel });
  if (m.closed) return card({ title, href: `https://polymarket.com/event/${ev.slug}`, endAt: ev.endDate, note: [otherYear, `The ${t.nickname} outcome is closed on Polymarket. The team is out, or the market has already settled.`].filter(Boolean).join(" "), ...rel });
  const rule = ti.negated ? polyRuleNo(m.conditionId, DEFAULT_SHARE.oneShot) : polyRule(m.conditionId, DEFAULT_SHARE.oneShot);
  const phrase = `${teamRef(t)} win ${champ}`;
  const code = championshipCode(t.league);
  const suggest = ti.negated ? { name: fitName(`${t.nickname} Fall Short`), ticker: `NO${teamTicker(t.abbr, { league: t.league, window: "title" })}`.slice(0, 10) } : { name: fitName(`${t.nickname} ${code === "WS" ? "World Series" : code === "CUP" ? "Cup" : "Champs"}`), ticker: teamTicker(t.abbr, { league: t.league, window: "title" }) };   // audit 6 item 6: the one generator
  const descCtx = { eventPhrase: phrase, crossRead: OFFICIAL_SHORT[t.league], endsAt: ev.endDate, suggest };
  const text = describeRule(rule, { ticker: "", ...descCtx });
  const side = ti.negated ? `the NO side: it burns only if the market settles NO, meaning ${teamRef(t)} did not win ${champ}. A voided or cancelled market never counts as a NO` : `the YES side: it burns if Polymarket's payout says ${teamRef(t)} won ${champ}`;
  return card({
    title, subtitle: `${t.name}, in ${ev.title}`, nextAt: ev.endDate, settleAt: ev.endDate, endAt: ev.endDate, endText: "ends when the market resolves",
    howSettles: `Settles on Polymarket's on-chain payout for "${m.groupItemTitle}" in ${ev.title}; ${OFFICIAL[t.league]} are the published cross-check.${ev.description ? `\n\nResolution rules (Polymarket): ${ev.description}` : ""}`,
    rule, pick: { oracle: "polymarket", series: null, market: m.conditionId, title: `${teamRef(t)} ${verb} ${champ} (resolves once)`, yes: m.outcomes[0] ?? "Yes", no: m.outcomes[1] ?? "No" },
    text, descCtx, leagueSet: ti.negated ? null : { id: `champ-${t.league}-${year || "season"}`, outcome: t.abbr }, href: `https://polymarket.com/event/${ev.slug}`, suggestedName: text.name, suggestedTicker: text.ticker,
    interpreted: `This reads whether ${teamRef(t)} win ${champ}, in the Polymarket market “${ev.title}”. The coin takes ${side}. It settles once, when the market resolves.`,
    note: otherYear, ...rel,
  });
}

function matchupCard(t: EspnTeam, games: readonly Game[], nowMs: number): Suggestion | null {
  const g = games.find((x) => !x.completed && Date.parse(x.startsAt) > nowMs && x.home.abbr !== "TBD" && x.away.abbr !== "TBD" && x.home.abbr && x.away.abbr);
  if (!g) return null;
  const side = (s: Game["home"]): MatchupSide => ({ abbr: s.abbr, name: s.name, nickname: s.nickname || s.abbr, ticker: teamTicker(s.abbr, { league: t.league, window: "game", outcome: "loss" }), series: gameSeries(t.league, g.eventId, s.abbr, "loss") });
  const a = side(g.away), b = side(g.home);
  return {
    ...base, id: `pair:${t.league}:${g.eventId}`, venue: "espn", venueLabel: SPORTS_CHIP, shape: "pair",
    title: `Two coins on ${g.name}: the losing team's coin burns`, subtitle: g.detail || g.startsAt, settlement: SPORTS_SETTLEMENT, crossRead: CROSS_NAME[t.league],
    nextAt: g.startsAt, settleAt: g.startsAt, endAt: g.startsAt, endText: "ends after that game", howSettles: "One coin per team; each burns once if its team loses. A tie burns neither.",
    matchup: { league: t.league, eventId: g.eventId, title: g.name, startsAt: g.startsAt, a, b }, score: 2.8,
  };
}

/** Denver calendar day of an instant (the page shows times in Denver). */
const denverDay = (ms: number): string => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const denverTime = (iso: string): string => new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
/** L04: a query that names one game day ("tonight", "today", "tomorrow"), or null. */
export function queryDay(q: string): "today" | "tomorrow" | null {
  return /\b(tonight|today|this evening|this afternoon)\b/i.test(q) ? "today" : /\b(tomorrow|tmrw)\b/i.test(q) ? "tomorrow" : null;
}

/** L04: "<Team> win tonight" — that one game as a one-shot coin (the one-shot default preset), when the schedule lists it. */
function oneGameCard(t: EspnTeam, g: Game, outcome: "win" | "loss" | "draw"): Suggestion {
  const own = g.home.abbr === t.abbr ? g.home : g.away, opp = own === g.home ? g.away : g.home;
  const series = gameSeries(t.league, g.eventId, t.abbr, outcome);
  // QA pass 9 #3 (owner decision 2026-10-12): a single game is a one-shot, so it takes the one-shot default (the keeper drains it after the result)
  const share = DEFAULT_SHARE.oneShot, rule = nativeRule(series, { fractionOfPool: share });
  const descCtx = { game: { opponent: opp.nickname || opp.name, home: own === g.home, startsAt: g.startsAt } };
  const text = describeRule(rule, { ticker: "", ...descCtx });
  const verb = outcome === "win" ? "win" : outcome === "draw" ? "draw" : "lose";
  const oppName = opp.nickname || opp.name, oppRef = LEAGUES[t.league].sport === "soccer" || t.league === "cfb" || t.league === "mcbb" || t.league === "wcbb" ? oppName : `the ${oppName}`;
  return {
    ...base, id: `game:${series}`, venue: "espn", venueLabel: SPORTS_CHIP, shape: "one-shot",
    title: `Burns ${pctLabel(share)} once if ${teamRef(t)} ${outcome === "win" ? "beat" : outcome === "draw" ? "draw with" : "lose to"} ${oppRef} on ${denverTime(g.startsAt)} Denver time`,
    subtitle: `${g.name}, this game only`, settlement: SPORTS_SETTLEMENT, crossRead: CROSS_NAME[t.league], nextAt: g.startsAt, settleAt: g.startsAt, endAt: g.startsAt, endText: "ends after that game",
    howSettles: outcome === "draw" ? `This coin covers one game, ${g.name}. It burns only on a draw.` : `This coin covers one game, ${g.name}. A ${LEAGUES[t.league].draws ? "draw" : "tie"} burns nothing.`, rule, pick: { oracle: "catalogue", series, market: null, title: `${t.name} ${verb} — ${g.name} (resolves once)` },
    source: { unit: { size: 1, label: "the game", definition: "one burn if the result is the one the rule names" }, baseline: 0, direction: "up" },
    text, descCtx, suggestedName: text.name, suggestedTicker: text.ticker, score: 3.2,
    interpreted: `This reads one game. ${gameLine(g)} The coin covers that game only, and then its burn pool burns down and it retires.`,
  };
}

/** The result a team query counts: a loss or a draw when it says so, else a win. */
export const outcomeOf = (q: string, league: LeagueId): "win" | "loss" | "draw" => /\b(lose|loses|losing|loss|losses)\b/i.test(q) ? "loss" : LEAGUES[league].draws && /\b(draw|draws|tie|ties)\b/i.test(q) ? "draw" : "win";

/**
 * Intent audit items 6 to 9 (teamQuery.ts): a second condition, a count of wins, the regular season only, or a women's team the site does
 * not cover. Every card becomes an alternative; the sentence that says why goes on every card for items 6 and 9 and on the per-result card
 * for items 7 and 8 (the championship card is labelled an alternative without it).
 */
function labelTeamIntent(cards: Suggestion[], q: string, t: EspnTeam, o: { compound: Compound | null; women: boolean }): void {
  const all: string[] = [], perResult: string[] = [];
  if (o.compound) all.push(compoundSentence(o.compound));
  if (o.women && !isWomenLeague(t.league)) all.push(womenSentence(t.name));
  const n = milestoneOf(q);
  if (n !== null) perResult.push(milestoneSentence(n, outcomeOf(q, t.league)));
  if (regularSeasonOnly(q) && !noPlayoffs(t.league)) perResult.push(REGULAR_SEASON_SENTENCE);
  if (!all.length && !perResult.length) return;
  for (const c of cards) {
    c.alternative = true;
    if (o.compound) c.partial = true;
    c.note = [...all, ...(c.shape === "recurring" ? perResult : []), c.note].filter(Boolean).join(" ");
  }
}

async function teamIntentCards(q: string, t: EspnTeam, d: SearchDeps): Promise<Suggestion[]> {
  let scheduleNote: string | null = null;
  // L05: a schedule that cannot be read is said in plain words (provenance.ts); the card's rule still settles on its own sources
  const games = d.espn ? await d.espn.season(t.league, t.abbr).catch((e) => { scheduleNote = e instanceof ScheduleUnavailable ? scheduleProblem(t.league, "needs-licence").line : scheduleProblem(t.league, "unreadable").line; return [] as Game[]; }) : [];
  const outcome = outcomeOf(q, t.league);
  const rec = recurringCard(t, games, outcome, d.nowMs);
  if (scheduleNote) { rec.scheduleUnavailable = true; console.warn(`[burnticker/search] ${t.league} schedule: ${scheduleNote}`); }
  const ti = readTeamIntent(q);
  const champ = await championshipCard(t, d, ti);
  if (CHAMP_WORDS.test(q)) { champ.score = champ.alternative ? 3.05 : 3.1; }   // the championship asked about leads; another year stays labelled
  // a negated query ("do not win") is never a win card: the recurring and matchup cards are related rules that say so
  if (ti.negated) { rec.alternative = true; rec.note = [rec.note, `You asked about ${teamRef(t)} not winning. This card counts their wins, so it is a related rule.`].filter(Boolean).join(" "); }
  const pair = matchupCard(t, games, d.nowMs);
  const out = [rec, champ, ...(pair ? [pair] : [])];
  // L04: "tonight" / "today" / "tomorrow" names one game. Its own one-game card leads when the schedule lists a game that day; every
  // other card is labelled an alternative, and when no game is listed that day every card is an alternative and the first says so.
  const day = queryDay(q);
  if (day) {
    const want = denverDay(d.nowMs + (day === "tomorrow" ? 86_400_000 : 0));
    const g = games.find((x) => !x.completed && Date.parse(x.startsAt) > d.nowMs - 3 * 3_600_000 && denverDay(Date.parse(x.startsAt)) === want);
    for (const c of out) c.alternative = true;
    if (g) return [oneGameCard(t, g, outcome), ...out];
    // an unread schedule is not "no game listed": the card says the next game is not available, and the note says only what is known
    out[0].note = scheduleNote ? "These cards are related rules." : `No ${t.nickname} game is listed for ${day} in Denver time, so these cards are related rules.`;
    return out;
  }
  if (CHAMP_WORDS.test(q)) { rec.alternative = true; if (pair) pair.alternative = true; }
  return out;
}

/**
 * L04 (launch audit 5) and the intent audit (2026-10-12, items 1, 2, 9, 11): a weather query is read ONCE into a normalized intent
 * (weatherIntent.ts: station, metric, comparison strict or inclusive, number, unit, date scope) and planned into the rule it can be,
 * or refused in words. The card's title, its note, the rule it carries (series + `inverse`) and the coin text (describe.ts, from the
 * rule) all come from that one plan, never from a word match. `readWeatherThreshold` is kept for older callers and tests.
 */
export interface WeatherReading { metric: NwsMetric; threshold: number | null; strict: boolean; wrote: string | null }
export function readWeatherThreshold(q: string, metric: NwsMetric): WeatherReading {
  const i = parseWeatherIntent(`${q} DTW`)[0];
  if (metric === "snow" || !i) return { metric, threshold: null, strict: false, wrote: null };
  const p = planWeather({ ...i, metric, dateScope: null });
  const plan = p.ok ? p : p.alternative;
  return { metric, threshold: plan?.ok ? plan.threshold : null, strict: i.op === "gt" || i.op === "lt", wrote: i.wrote };
}
export { leastReportable };

const NWS_LABEL = "NWS daily climate report, a first-party source";
const METRIC_WORD: Record<WeatherIntent["metric"], string> = { high: "high", low: "low", rain: "rain", snow: "snow" };
/** What the query asked, in words ("Denver's high below 32 tomorrow"). */
const askedPhrase = (i: WeatherIntent): string => `${i.station.city}'s ${METRIC_WORD[i.metric]}${i.wrote ? ` ${i.wrote}` : ""}${i.dateScope ? ` ${i.dateScope.trim()}` : ""}`;
/** The refusal's plain category for the page's refused line ("Burnticker does not offer coins on one day's weather."). */
function refusedNouns(i: WeatherIntent): string[] {
  const out: string[] = [];
  if (i.dateScope) out.push("one day's weather");
  if (i.metric === "low") out.push("the daily low temperature");
  if (i.op === "eq") out.push("days at exactly one temperature or amount");
  if (i.op === "range") out.push("a range of temperatures or amounts");
  if (i.unit === "K") out.push("temperatures in kelvin");
  if (i.metric === "snow" && (i.value !== null || i.op !== null)) out.push("a snowfall amount");
  return out;
}

function weatherPlanCard(p: Extract<WeatherPlan, { ok: true }>, alternative: boolean): Suggestion | null {
  const s = p.intent.station, series = p.series, src = nativeSourceById(series);
  if (!src) return null;
  const share = DEFAULT_SHARE.recurring;
  const rule = (p.inverse ? { ...nativeRule(series, { fractionOfPool: share }), inverse: true } : nativeRule(series, { fractionOfPool: share })) as BurnRule;
  const text = describeRule(rule, { ticker: "" });
  const freq = weatherFrequency(series, !!p.inverse);   // QA pass 9 #16
  const what = p.metric === "high" ? `every day ${s.city}'s official high is ${p.boundary}` : p.metric === "rain" ? `every day ${s.city} gets ${p.boundary}` : `once, on ${s.city}'s first snow of the season`;
  const seriesTitle = p.inverse ? `${s.city} daily ${p.metric === "high" ? `high below ${p.threshold} °F` : `rain below ${Number(p.threshold).toFixed(2)} in`} (NWS)` : src.title;
  const how = p.metric === "snow" ? `${src.unit.definition}. ${FIRST_SNOW_SEASON}` : p.inverse ? `a day whose official ${p.metric === "high" ? "high" : "precipitation"} at ${s.label} was ${p.boundary}. A day with no reading counts as nothing.` : src.unit.definition;
  const reads = p.metric === "snow" ? `The coin burns once, on the season's first measurable snow. ${FIRST_SNOW_SEASON}` : `The coin burns on each day ${p.metric === "high" ? `the official high is ${p.boundary}` : `with ${p.boundary}`}. ${climateDaySentence(s)} There is no end date.`;
  return {
    ...base, id: `nws:${series}${p.inverse ? ":inverse" : ""}`, venue: "nws", venueLabel: NWS_LABEL, shape: p.metric === "snow" ? "one-shot" : "recurring",
    title: `Burns ${pctLabel(share)} ${what}`, subtitle: `${seriesTitle}, at station ${s.code}`, settlement: "the National Weather Service's daily climate report", crossRead: "the Iowa Environmental Mesonet",
    endText: p.metric === "snow" ? "ends after the first snow" : "no end date", howSettles: how, rule, pick: { oracle: "catalogue", series, market: null, title: seriesTitle },
    source: { unit: src.unit, baseline: 0, direction: "up" }, text, descCtx: {}, suggestedName: text.name, suggestedTicker: text.ticker, score: alternative || p.example ? 2.9 : 3,
    interpreted: `This reads the ${s.label} weather station, code ${s.code}. ${reads}${freq ? ` ${freq.line}` : ""}`,
    note: [alternative ? `This is the recurring rule, not the one day you typed. ${p.note ?? ""}`.trim() : p.note, freq?.warning ?? null].filter(Boolean).join(" ") || null, alternative: alternative || p.example,
  };
}

function weatherRefusalCard(p: Extract<WeatherPlan, { ok: false }>): Suggestion {
  const i = p.intent, s = i.station;
  return {
    ...base, id: `nws-refused:${s.code}:${i.metric}:${i.op ?? "none"}:${i.value ?? ""}:${i.unit ?? ""}:${(i.dateScope ?? "").trim().toLowerCase()}`, venue: "nws", venueLabel: NWS_LABEL, shape: "recurring",
    title: `A coin on ${askedPhrase(i)} is not offered as written`, subtitle: `${s.label}, station ${s.code}`, settlement: "the National Weather Service's daily climate report", crossRead: "the Iowa Environmental Mesonet",
    note: p.refusal, refused: refusedNouns(i), score: 3,
    interpreted: `This reads the ${s.label} weather station, code ${s.code}. The climate report gives the daily high in whole degrees Fahrenheit, rain in hundredths of an inch and the season's first snow. ${climateDaySentence(s)}`,
  };
}


function weatherCards(q: string, intents: readonly WeatherIntent[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const i0 of intents) {
    // "Denver weather": no metric word, no number, no comparison → the three rules the station offers, each its own card
    const bare = i0.op === null && i0.value === null && i0.metric === "high" && !/\b(high|highs|hot|hotter|heat|temp|temps|temperature|degrees?|warm|warmer)\b|°/i.test(q);
    for (const i of bare ? (["high", "rain", "snow"] as const).map((metric) => ({ ...i0, metric })) : [i0]) {
      const p = planWeather(i);
      if (p.ok) { const c = weatherPlanCard(p, false); if (c) out.push(c); continue; }
      out.push(weatherRefusalCard(p));
      if (p.alternative?.ok) { const c = weatherPlanCard(p.alternative, true); if (c) out.push(c); }
    }
  }
  return out;
}

/**
 * WHAT AN EARTHQUAKE QUERY ASKS FOR (audit 10 #15, 2026-10-13: "earthquake above 7 in Japan" was offered magnitude 6 worldwide without a
 * word). The magnitude and the region the query names, read against what the USGS adapter offers (magnitudes 4 to 8.5 in half steps; the
 * world, the contiguous United States, California, Alaska or Japan); anything else it names is listed as not offered.
 */
export function quakeAsk(q: string): { magnitude: string | null; region: string | null; unsupported: string[] } {
  const unsupported: string[] = [];
  const m = /(?:magnitude|mag\.?|\bm|above|over|at least|greater than|bigger than|of|>=?)\s*(\d{1,2}(?:\.\d+)?)\b/i.exec(q) ?? /\b(\d(?:\.\d+)?)\s*(?:\+|or (?:more|higher|bigger|above))/i.exec(q);
  let magnitude: string | null = null;
  if (m) { const v = String(Number(m[1])); if ((USGS_MAGNITUDES as readonly string[]).includes(v)) magnitude = v; else unsupported.push(`magnitude ${m[1]} (the USGS reading offers 4 to 8.5 in half steps)`); }
  const REG: [RegExp, string][] = [[/\bjapan(ese)?\b/i, "japan"], [/\bcalifornia\b/i, "california"], [/\balaska\b/i, "alaska"], [/\b(united states|u\.?s\.?a?\.?|america|conus|lower 48|contiguous)\b/i, "conus"]];
  const region = REG.find(([re]) => re.test(q))?.[1] ?? null;
  if (!region) { const place = /\b(?:in|near|off|around)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)*)/.exec(q)?.[1]; if (place && !/^(the|a|an)$/i.test(place)) unsupported.push(`${place} (the regions offered are the world, the contiguous United States, California, Alaska and Japan)`); }
  return { magnitude, region, unsupported };
}
function feedCards(q: string, feeds: readonly FeedLike[]): Suggestion[] {
  const nq = norm(q);
  const out: Suggestion[] = [];
  for (const f0 of feeds) {
    let f = f0, ask: ReturnType<typeof quakeAsk> | null = null;
    if (f0.id.startsWith("usgs.quakes:") && f0.launchable.ok) {
      ask = quakeAsk(q);
      const base = parseUsgsSeries(f0.id), want = base ? `usgs.quakes:${ask.magnitude ?? base.magnitude}${ask.region ? `/${ask.region}` : base.region ? `/${base.region}` : ""}` : null;
      const exact = want && want !== f0.id ? feedById(want) : null;
      if (exact && exact.unit && exact.baseline !== null && exact.direction) f = { ...f0, id: exact.id, title: exact.title, unit: exact.unit, baseline: exact.baseline, direction: exact.direction };
    }
    if (!f.launchable.ok || !f.unit || f.baseline === null || !f.direction) continue;
    // a card here is always a recurring rule at the recurring default; a next-event one-shot (sources-3) is not one
    if (NEXT_EVENT_ONE_SHOT_RE.test(f.id)) continue;
    const kw = (FEED_WORDS[f.id.split(":")[0]] ?? []).filter((w) => nq.includes(` ${w} `)).length;
    const score = kw ? 1.4 + kw * 0.1 : overlap(q, `${f.title} ${f.sourceName}`) >= 0.5 ? 1 : 0;
    if (!score) continue;
    const rule = { schema: BURNTICKER_RULES_SCHEMA, oracle: "catalogue", series: f.id, market: null, filter: {}, kind: "scalar", scalar: { unit: f.unit.size, perUnit: { fractionOfPool: DEFAULT_SHARE.recurring }, baseline: f.baseline, direction: f.direction }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } as BurnRule;
    const descCtx = { feed: { title: f.title, sourceName: f.sourceName, unitLabel: f.unit.label }, suggest: FEED_SUGGEST[f.id.split(":")[0]] ?? null };
    const text = describeRule(rule, { ticker: "", ...descCtx });
    out.push({
      ...base, id: `feed:${f.id}`, venue: "feed", venueLabel: `${f.sourceName}, a first-party source`, shape: "recurring", title: `Burns ${pctLabel(shareOf(rule) ?? DEFAULT_SHARE.recurring)} per ${f.unit.label} — ${f.title}`, subtitle: f.cadence,
      settlement: f.sourceName, crossRead: isSingleSourceSeries(f.id) ? null : "an independent publisher of the same figure", endText: "no end date", howSettles: f.unit.definition, rule,
      pick: { oracle: "catalogue", series: f.id, market: null, title: f.title }, source: { unit: f.unit, baseline: typeof f.baseline === "number" ? f.baseline : 0, direction: "up" }, text, descCtx, suggestedName: text.name, suggestedTicker: text.ticker, score,
      // audit 10 #15: what the query asked for that this source does not offer is named, and the card is a related rule
      ...(ask && ask.unsupported.length ? { alternative: true, partial: true, note: `Not offered as asked: ${ask.unsupported.join("; ")}. This card is the closest rule the USGS reading supports: ${f.title.replace(/ \(USGS\)$/, "")}.` } : {}),
    });
  }
  return out;
}

/** A one-shot Polymarket rule: the one-shot default preset (launchPresets.ts; the web offers 10 / 50 / 100 %, the API 1–100 %). */
export const polyRule = (conditionId: string, fraction: number = DEFAULT_SHARE.oneShot): BurnRule => ({ schema: BURNTICKER_RULES_SCHEMA, oracle: "polymarket", series: null, market: conditionId, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: fraction }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } as BurnRule);

export function raceCards(races: readonly Race[], q: string): Suggestion[] {
  return searchRaces(races, q).slice(0, 3).map(({ race: r, outcome: o, score }) => {
    const rule = polyRule(o.conditionId);
    const raceName = r.title.replace(/ Election Winner$/, "");
    const descCtx = { eventPhrase: `${o.label} wins the ${raceName} race`, crossRead: `the ${r.stateName ?? "state"} certified result`, endsAt: r.settlesOn };
    const text = describeRule(rule, { ticker: "", ...descCtx });
    return {
      ...base, id: `polymarket:${o.conditionId}`, venue: "polymarket", venueLabel: "Polymarket, settled by its on-chain payout", shape: "one-shot",
      title: outcomeCardTitle(r, o), subtitle: `${r.title}${r.hiddenPlaceholders ? `. ${r.hiddenPlaceholders === 1 ? "One placeholder market with no name is" : `${r.hiddenPlaceholders} placeholder markets with no name are`} hidden.` : ""}`,
      settlement: `${r.settlement} — ${r.sos.name}`, crossRead: `${r.sos.name}`, crossReadUrl: r.sos.url, nextAt: r.settlesOn, settleAt: r.settlesOn, endAt: r.settlesOn, endText: "ends when the race resolves",
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

/**
 * ChatGPT audit 7 item 11: a one-time market card whose market closes within CLOSING_SOON_HOURS is hidden unless the caller asks for it
 * (closingSoon); `hiddenClosingSoon` counts what was hidden so the page can offer "Show closing soon".
 */
export const closingSoonCard = (c: Pick<Suggestion, "venue" | "shape" | "endAt" | "settleAt">, nowMs: number): boolean => {
  const at = c.endAt ?? c.settleAt;
  return c.venue === "polymarket" && c.shape === "one-shot" && !!at && Number.isFinite(Date.parse(at)) && Date.parse(at) - nowMs < CLOSING_SOON_HOURS * 3_600_000;
};
export async function universalSearch(q: string, d: SearchDeps): Promise<{ query: string; cards: Suggestion[]; empty: boolean; errors: string[]; hiddenClosingSoon: number }> {
  const r = await searchAll(q, d);
  if (d.closingSoon) return { ...r, hiddenClosingSoon: 0 };
  const cards = r.cards.filter((c) => !closingSoonCard(c, d.nowMs));
  return { ...r, cards, empty: r.empty || cards.length === 0, hiddenClosingSoon: r.cards.length - cards.length };
}
async function searchAll(q: string, d: SearchDeps): Promise<{ query: string; cards: Suggestion[]; empty: boolean; errors: string[] }> {
  const query = q.trim().slice(0, 160);
  // no meaningful token (every token one or two letters: "e", "el", "el s") → nothing, never a partial match
  if (query.length < 3 || !meaningful(queryTokens(query)).length) return { query, cards: [], empty: true, errors: [] };
  const errors: string[] = []; const cards: Suggestion[] = [];
  const derby = derbyCard(query, d.derbyHref);
  if (derby) return { query, cards: [derby], empty: false, errors };
  // a query carrying an event phrase ("spider man oscar", "spider-man best picture") is never read as a person's name
  const split = splitQuery(query);
  const person = looksLikePerson(query) && !split.phrase;
  // the intent audit (item 9): a city weather query ("Denver high below 32 tomorrow") is a WEATHER query, read before any team, race or
  // market: a city team, a state race or a market never rank above it. A weak word ("high", "hot") next to a team's nickname
  // ("Nuggets high") stays a team query (weatherIntent.ts).
  const nq = norm(query);
  const teamNamed = findTeams(query).some((t) => t.nickname.length >= 3 && nq.includes(` ${t.nickname.toLowerCase().replace(/[^a-z0-9$.]+/g, " ").trim()} `) && !findStations(t.nickname).length);
  const wx = parseWeatherIntent(query, { teamNamed });
  if (wx.length) {
    const wc = [...weatherCards(query, wx), ...feedCards(query, d.feeds)];
    const ranked = wc.filter((c) => c.score >= MIN_SCORE).sort((a, b) => b.score - a.score).slice(0, MAX_CARDS);
    const order = [...new Set(ranked.map(groupOf))];
    return scrubMarketData({ query, cards: withBadges(order.flatMap((g) => ranked.filter((c) => groupOf(c) === g)).map((c) => ({ ...c, group: groupOf(c) }))), empty: ranked.length === 0, errors });
  }
  // intent audit items 6 and 9: the cards follow the first clause that names a team, and a women's query prefers a women's league team
  const namedIn = (s: string) => findTeams(s).filter((t) => namesTeam(s, t) && nameMatch(s, [t.name, t.nickname, ...t.alt]).nameHits > 0);
  const compound = compoundOf(query, findTeams(query), (s) => namedIn(s).length > 0);
  const focus = compound ? compound.kept : query;
  const women = asksWomen(focus);
  const named = namedIn(focus);
  const team = (women ? named.find((t) => isWomenLeague(t.league)) : null) ?? named[0] ?? null;
  // a person-looking query ("lakers tonight" is not one; "el sayed" is) goes to the people only when a candidate's name matches it
  let personHit = false;
  if (team && person && d.venues.polymarket && d.polyGet) { try { personHit = searchRaces(await loadRaces(d.polyGet, d.refuse), query).some((h) => h.score >= 1.5); } catch { personHit = false; } }
  if (team && !personHit) {
    // a team is named: exactly the team's shapes (recurring, one-shot championship, the next game when both sides are known)
    const tc = await teamIntentCards(focus, team, d);
    labelTeamIntent(tc, focus, team, { compound, women });
    return scrubMarketData({ query, cards: withBadges(tc.sort((a, b) => b.score - a.score)).map((c) => ({ ...c, group: groupOf(c) })), empty: false, errors });
  }
  cards.push(...feedCards(query, d.feeds));   // a weather query returned above (weatherCards)
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
          cards.push({ ...base, id: `polymarket:${m.conditionId}`, venue: "polymarket", venueLabel: "Polymarket, settled by its on-chain payout", shape: "one-shot", title: `Burns ${pctLabel(shareOf(rule) ?? DEFAULT_SHARE.oneShot)} once, if ${sentence} resolves YES`, subtitle: `${e.title}. YES means ${m.outcomes[0] ?? "Yes"}, and NO means ${m.outcomes[1] ?? "No"}.`, settlement: "Polymarket's on-chain payout (Conditional Tokens on Polygon)", nextAt: m.endDate, settleAt: m.endDate, endAt: m.endDate, endText: "ends when the market resolves", howSettles: `Settles on "${m.question}" resolving ${m.outcomes[0] ?? "Yes"}.`, rule, pick: { oracle: "polymarket", series: null, market: m.conditionId, title: `${m.question} (resolves once)`, yes: m.outcomes[0] ?? "Yes", no: m.outcomes[1] ?? "No" }, text, descCtx, suggestedTicker: outcomeTicker(label), suggestedName: fitName(label), href: eventPageUrl(e.slug), score: mm.score });
        }
        for (const em of found.events) {
          const e = em.event;
          cards.push({ ...base, id: `polyevent:${e.slug}`, venue: "polymarket", venueLabel: "Polymarket, settled by its on-chain payout", shape: "one-shot", title: em.noun === "outcome" ? `Pick one: ${e.title.trim()} — your coin burns ${pctLabel(DEFAULT_SHARE.oneShot)} once if your pick wins` : `Pick a ${em.noun}: ${e.title.trim()} — your coin burns ${pctLabel(DEFAULT_SHARE.oneShot)} once if it wins`, subtitle: `There are ${em.outcomes.length} named ${em.noun === "outcome" ? "outcomes" : `${em.noun}s`}. Each one is its own yes-or-no market.`, settlement: "Polymarket's on-chain payout (Conditional Tokens on Polygon)", nextAt: e.endDate, settleAt: e.endDate, endAt: e.endDate, endText: "ends when the market resolves", howSettles: "It settles when the market for the outcome you pick resolves YES. Every other outcome is ignored.", note: em.note, href: eventPageUrl(e.slug), picker: { slug: e.slug, title: e.title.trim(), noun: em.noun, outcomes: em.outcomes }, score: em.score });
        }
      } catch (e) { errors.push(`polymarket: ${(e as Error).message.slice(0, 80)}`); }
    }
  }
  if (d.venues.kalshi && d.kalshiSearch) {
    try { for (const s of (await d.kalshiSearch(query)).slice(0, 2)) cards.push({ ...base, id: `kalshi:${s.ticker}`, venue: "kalshi", venueLabel: "Kalshi", shape: "recurring", title: s.title, subtitle: `Every market in the ${s.ticker} series`, settlement: s.settlementSource?.name ?? "Kalshi", pick: { oracle: "kalshi", series: s.ticker, market: null, title: s.title }, score: 0.5 + overlap(query, s.title) }); } catch (e) { errors.push(`kalshi: ${(e as Error).message.slice(0, 80)}`); }
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
  return { ...x, ticker: to, flavour: sw(x.flavour), ruleBlock: sw(x.ruleBlock), lead: sw(x.lead), paragraph: sw(x.paragraph) };
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
