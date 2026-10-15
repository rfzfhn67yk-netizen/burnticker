import type { SettledEvent } from "@/lib/burnticker/units";
import type { ResolvedSelector } from "@/lib/burnticker/oracle/types";
import { LEAGUES, NBA_OFFICIAL_ANSWERS, TSDB_LEAGUE, tsdbFieldScores, outcomeHits, SETTLE_AFTER_START_MS, asMeetings, teamNameKey, dedupeListings, gamesFor, meetingsEndReason, ourTeam, seriesEndDay, tallyMeetings, teamById, teamByAbbr, tsdbNamePairs, windowStatus, type EspnClient, type EspnSeries, type Game, type GameSide, type LeagueId, type MeetingOutcome, type MeetingsSeries, type Outcome } from "@/lib/burnticker/sources/espn";

/**
 * HOW A TEAM COIN'S GAME SETTLES (owner, 2026-10-10). NO ESPN READS: the game list comes from the league's free official schedule (MLB
 * StatsAPI, the NHL's api-web), the NBA's feed when it answers (else TheSportsDB), or TheSportsDB v2 (licensed key) — espn.ts
 * EspnClient/SportsClient. Each completed game:
 *
 *   PRIMARY A  the game's ON-CHAIN PAYOUT where Polymarket lists a moneyline market (Gamma search by the two teams and the date → the
 *              condition id → the Conditional Tokens payout vector on Polygon), exactly as an election does; a soccer game is three
 *              yes/no conditions (home win, draw, away win) and all three payouts are read (threeWayRead);
 *   PRIMARY B  otherwise THESPORTSDB (commercial licence, BURNTICKER_THESPORTSDB_KEY, the v2 API): the final score;
 *   CONFIRMED  by a SECOND, independent operator: the on-chain payout and TheSportsDB confirm each other when both exist; the league's
 *              official feed (MLB, NHL, and the NBA's when it answers) is a further read where it is free; API-Sports (BURNTICKER_APISPORTS_KEY) is optional.
 *              Every read must agree (scores where both carry scores, else the winner). A game only ONE operator can read is held.
 *
 * Every reading says how it settled: "settled on the game's on-chain payout · confirmed by MLB's official feed", plus a plain human
 * link to ESPN's scoreboard for that day ("see this game on ESPN →", never fetched).
 */

/**
 * `pens`: the feed marks the game decided on penalties (a cup tie level after extra time). `declared`: the side the feed names as the
 * winner (API-Sports' teams.home.winner / teams.away.winner). Owner decision 2026-10-12 (website-20 item 78): a level game decided on
 * penalties counts as a WIN for the declared winner and a LOSS for the other side, never a draw; espn.ts outcomeOf reads it the same way.
 */
export interface Final { home: number; away: number; done: boolean; detail: string; url: string; pens?: boolean; declared?: "home" | "away" | null; /** the feed marks the game decided in extra time (AET) */ aet?: boolean; /** the row cannot be read the right way round (which score is whose): settleGame holds the game */ unresolved?: string }
/**
 * A game's Polymarket market. A two-sided moneyline (every sport but soccer) is one condition whose two outcomes name the two teams.
 * A SOCCER game is THREE yes/no markets inside one event ("Will Arsenal FC win on 2026-10-10?", "Will Arsenal FC vs. Leeds United FC
 * end in a draw?", "Will Leeds United FC win on 2026-10-10?"): `threeWay` carries the three condition ids and the two team names as
 * Polymarket writes them; `conditionId` is then the home leg's (the one a receipt links to first).
 */
export interface GameMarket { conditionId: string; question: string; outcomes: [string, string]; url: string; threeWay?: { home: string; draw: string; away: string; homeName: string; awayName: string } }
export interface GamePayout { resolved: boolean; outcome: number | null }
export interface GameDeps {
  tsdbKey: string | null;
  apiSportsKey: string | null;
  /** Gamma search for the game's moneyline market (null: Polymarket discovery off on this host). */
  market: ((g: Game) => Promise<GameMarket | null>) | null;
  /** The CTF payout vector on Polygon for a condition id. */
  payout: ((conditionId: string) => Promise<GamePayout | null>) | null;
}
export const envGameDeps = (env: Readonly<Record<string, string | undefined>> = process.env): GameDeps => ({ tsdbKey: (env.BURNTICKER_THESPORTSDB_KEY ?? "").trim() || null, apiSportsKey: (env.BURNTICKER_APISPORTS_KEY ?? "").trim() || null, market: null, payout: null });

export type CrossId = "mlb.statsapi" | "nhl.score" | "nba.cdn" | "apisports.games";
/** How the cross-read is named on cards, coin pages, receipts and posts (the owner: name recognition — the league's official feed). */
export const CROSS_LABEL: Record<CrossId, string> = { "mlb.statsapi": "MLB's official feed", "nhl.score": "NHL's official scores", "nba.cdn": "NBA's official feed", "apisports.games": "a second licensed provider" };
/** How the primary is named outside the sources table and the trust page (TheSportsDB is named there, with "data: TheSportsDB"). */
export const SETTLED_ON: Record<"on-chain payout" | "TheSportsDB", string> = { "on-chain payout": "the game's on-chain payout", TheSportsDB: "a licensed final score" };
/** The public ESPN scoreboard page for the game's day — a plain human link on each game row and receipt, never fetched (no ESPN reads). */
export const espnGameUrl = (league: LeagueId, date: string): string => { const [sport, lg] = LEAGUES[league].path.split("/"); const d = date.slice(0, 10).replace(/-/g, ""); return sport === "soccer" ? `https://www.espn.com/soccer/scoreboard/_/date/${d}/league/${lg}` : `https://www.espn.com/${lg}/scoreboard/_/date/${d}`; };
/** The league's cross-read: its own official feed where one exists, else the second licensed provider. */
export const crossIdOf = (league: LeagueId): CrossId => (league === "mlb" ? "mlb.statsapi" : league === "nhl" ? "nhl.score" : league === "nba" ? "nba.cdn" : "apisports.games");
/** Whether the cross-read can be read on this host (API-Sports needs its key). */
export const crossAvailable = (league: LeagueId, d: Pick<GameDeps, "apiSportsKey">): boolean => crossIdOf(league) !== "apisports.games" || !!d.apiSportsKey;

// ---- finals from each reader --------------------------------------------------------------------------------------------------

const n = (v: unknown): number | null => { const x = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(x) ? null : x; };
// QA pass 9 #5: the same normal form as the schedule's team match ("&" read as "and", periods and accents ignored)
const norm = teamNameKey;
/**
 * A provider's team name matches a side when it contains the side's nickname, short name, location or full name (or the reverse). An
 * EMPTY name matches nothing (season rehearsal 2026-10-13, bug 1: TheSportsDB's day listing holds every sport, a cycling or darts row has
 * no teams, and `"".includes` is true for every key, so "Hamburg Cyclassics" matched Arsenal at Manchester United).
 */
export const sideMatches = (name: string, s: GameSide): boolean => { const a = norm(name); if (!a) return false; return [s.name, s.nickname, s.short ?? "", s.location ?? "", s.abbr].filter((k) => k && k.length >= 3).some((k) => { const b = norm(k); return a === b || a.includes(b) || b.includes(a); }); };

/**
 * DOUBLEHEADERS (semantics-verify item 80, 2026-10-12): two games between the same teams on one day are two fixtures. Each reader picks
 * the listed game whose start is NEAREST the schedule's start time, never simply the first one in the body, so the cross-read of the
 * second game is never the first game's score. A body without start times keeps its first match (the score comparison then holds a mix-up).
 */
export function nearestStart<T>(hits: readonly T[], startsAt: string, at: (h: T) => unknown): T | undefined {
  const target = Date.parse(startsAt);
  let best: T | undefined, gap = Infinity;
  for (const h of hits) {
    const t = Date.parse(String(at(h) ?? ""));
    const d = Number.isFinite(t) && Number.isFinite(target) ? Math.abs(t - target) : Infinity;
    if (best === undefined || d < gap) { best = h; gap = d; }
  }
  return best;
}
const utcIso = (s: string): string => s.replace(/(\+00:00)?$/, "").replace(/Z?$/, "Z");
const tsdbStart = (e: Record<string, unknown>): string | null => (e.strTimestamp ? utcIso(String(e.strTimestamp)) : e.dateEvent && e.strTime ? utcIso(`${e.dateEvent}T${e.strTime}`) : null);

/** v1's event search (a key v2 refuses; espn.ts tsdbRead): "Arsenal_vs_Coventry_City". */
export const tsdbV1SearchUrl = (key: string, names: [string, string]): string => `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}/searchevents.php?e=${encodeURIComponent(`${names[0]} vs ${names[1]}`.replace(/ /g, "_"))}`;
/**
 * TheSportsDB's DAY LISTING (launch night 2026-10-13: v2 search/event answered "No data found" for every league and name form tried
 * — Chiefs/Raiders, Dodgers/Brewers — so every game would have been held). filter/events/day/{date} lists the day's events with teams
 * and scores but no status; lookup/event/{id} carries the status (FT) and the kickoff time. v1 (a key v2 refuses): eventsday.php and
 * lookupevent.php carry everything in one row.
 */
export const tsdbV2DayUrl = (date: string): string => `https://www.thesportsdb.com/api/v2/json/filter/events/day/${encodeURIComponent(date)}`;
export const tsdbV1DayUrl = (key: string, date: string): string => `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}/eventsday.php?d=${encodeURIComponent(date)}`;
export const tsdbV2EventUrl = (id: string): string => `https://www.thesportsdb.com/api/v2/json/lookup/event/${encodeURIComponent(id)}`;
export const tsdbV1EventUrl = (key: string, id: string): string => `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}/lookupevent.php?id=${encodeURIComponent(id)}`;
const tsdbRows = (body: unknown): Record<string, unknown>[] => (body && typeof body === "object" ? Object.values(body as Record<string, unknown>).filter(Array.isArray) as Record<string, unknown>[][] : []).flat().filter((e) => typeof e === "object" && !!e && "idEvent" in e);
/**
 * Which of the game's sides a provider's team name is, by OUR TEAM TABLE first (season rehearsal 2026-10-13, bug 1: name containment alone
 * read "Los Angeles Angels" as the Lakers' "Los Angeles" and "Philadelphia Phillies" as the Union). A side our table knows (abbr not
 * "TBD") matches only the name our table reads as that same team; a side our table does not know (an FCS opponent, a club outside a
 * competition's frozen list) matches a non-empty name our table does not know either, by the name match.
 */
export function sideIs(league: LeagueId, name: string, s: GameSide): boolean {
  if (!norm(name)) return false;
  const t = ourTeam(league, name);
  if (s.abbr && s.abbr !== "TBD") return !!t && t.abbr === s.abbr;
  return !t && sideMatches(name, s);
}
/** How a provider row's home/away fields sit against the game: the same way, crossed (the row's home team is our away side), or neither. */
export function rowOrientation(g: Game, homeName: string, awayName: string): "same" | "crossed" | null {
  const same = sideIs(g.league, homeName, g.home) && sideIs(g.league, awayName, g.away), crossed = sideIs(g.league, homeName, g.away) && sideIs(g.league, awayName, g.home);
  return same === crossed ? null : same ? "same" : "crossed";
}
const dayBefore = (date: string): string => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
/** A row of the game's own TheSportsDB league, or a row that does not say (a v2 day listing row carries no league; its event lookup does). */
const leagueOk = (g: Game, e: Record<string, unknown>): boolean => { const want = TSDB_LEAGUE[g.league]; return !want || e.idLeague === undefined || e.idLeague === null || e.idLeague === "" || String(e.idLeague) === want; };
/**
 * The day listing's CANDIDATE rows for this game: the game's UTC date or the day before, both team fields non-empty and both teams this
 * game's by our team table (sideIs), the same way round or crossed. Rows that name a league (v1 rows, lookups) must name the game's.
 * The game's date first.
 */
export function tsdbDayCandidates(g: Game, body: unknown): Record<string, unknown>[] {
  const prev = dayBefore(g.date);
  const rows = tsdbRows(body).filter((e) => (e.dateEvent === g.date || e.dateEvent === prev) && leagueOk(g, e) && rowOrientation(g, String(e.strHomeTeam ?? ""), String(e.strAwayTeam ?? "")) !== null);
  return [...rows.filter((e) => e.dateEvent === g.date), ...rows.filter((e) => e.dateEvent !== g.date)];
}
/** The day listing's row for this game without the event lookups (the candidates' nearest start where the rows carry one, else the first). */
export function tsdbDayMatch(g: Game, body: unknown): Record<string, unknown> | null {
  const rows = tsdbDayCandidates(g, body), same = rows.filter((e) => e.dateEvent === g.date);
  return nearestStart(same.length ? same : rows, g.startsAt, tsdbStart) ?? null;
}
/** A candidate is the game only when its start (from the event lookup) is within this of the schedule's start. */
export const TSDB_START_WINDOW_MS = 12 * 3_600_000;
/**
 * The game's TheSportsDB row through the day listing (season rehearsal 2026-10-13, bugs 1 and 2). The v2 listing carries neither the
 * league nor a start time, so EVERY candidate (tsdbDayCandidates) is looked up (lookup/event/{id}; the client caches each URL, so an id is
 * read once per process), and only a looked-up row of the game's own league (idLeague = TSDB_LEAGUE) that started within 12 hours of the
 * schedule's start can be the game; of those the nearest start wins (an MLB doubleheader, or a West Coast night game and the next
 * afternoon's game on one UTC date: Rays at Giants 2025-08-17, rows 2176956 at 01:05Z and 2176973 at 20:05Z). Null: not listed.
 */
export async function tsdbFinalByDay(client: EspnClient, key: string, g: Game): Promise<Final | null> {
  const want = TSDB_LEAGUE[g.league] ?? null;
  for (const date of [g.date, dayBefore(g.date)]) {
    const url = tsdbV2DayUrl(date);
    const cands = tsdbDayCandidates(g, await client.tsdbRead(key, url, (k) => [tsdbV1DayUrl(k, date)]));
    const full: Record<string, unknown>[] = [];
    for (const row of cands) {
      const id = String(row.idEvent ?? "");
      const complete = !!(row.strStatus && row.strTimestamp && row.idLeague);
      const lookedUp = complete || !id ? null : tsdbRows(await client.tsdbRead(key, tsdbV2EventUrl(id), (k) => [tsdbV1EventUrl(k, id)]).catch(() => null))[0];
      const r = lookedUp ? { ...row, ...lookedUp } : row;
      if (want && String(r.idLeague ?? "") !== want) continue;   // a row whose league is unknown or another league's is never the game
      if (rowOrientation(g, String(r.strHomeTeam ?? ""), String(r.strAwayTeam ?? "")) === null) continue;
      const t = Date.parse(tsdbStart(r) ?? "");
      if (!Number.isFinite(t) || Math.abs(t - Date.parse(g.startsAt)) > TSDB_START_WINDOW_MS) continue;
      full.push(r);
    }
    const best = nearestStart(full, g.startsAt, tsdbStart);
    if (best) return finalFromTsdb(g, { events: [best] }, url);
  }
  return null;
}
export const tsdbV2Url = (names: [string, string]): string => `https://www.thesportsdb.com/api/v2/json/search/event/${encodeURIComponent(`${names[0]} vs ${names[1]}`.replace(/ /g, "_").toLowerCase())}`;
/** TheSportsDB v2 search/event: the event list under whichever key the API uses; the game's date (or the day before, UTC) and a final status. */
/**
 * TheSportsDB's final for the game from a list of rows (the day listing's chosen row, or the v2 name search): the game's date (or the day
 * before, UTC), both teams the game's by our team table and of the game's league where the row names one. The row's scores are read by
 * its team fields in its own score order (espn.ts tsdbFieldScores, bug 4: college rows whose scores follow the event's name) and then put
 * on our sides, crossed when the row's home team is our away side. A college row whose score order cannot be told is `unresolved`.
 */
export function finalFromTsdb(g: Game, body: unknown, url: string): Final | null {
  const lists = body && typeof body === "object" ? Object.values(body as Record<string, unknown>).filter(Array.isArray) as Record<string, unknown>[][] : [];
  const evs = lists.flat().filter((e) => typeof e === "object" && e && "dateEvent" in e && leagueOk(g, e) && rowOrientation(g, String(e.strHomeTeam ?? ""), String(e.strAwayTeam ?? "")) !== null);
  const prev = dayBefore(g.date);
  const sameDay = evs.filter((x) => x.dateEvent === g.date), before = evs.filter((x) => x.dateEvent === prev);
  const e = nearestStart(sameDay.length ? sameDay : before, g.startsAt, tsdbStart);
  if (!e) return null;
  const done = /^(FT|AOT|AET|AP|PEN|Match Finished|Final)/i.test(String(e.strStatus ?? ""));
  const sc = tsdbFieldScores(g.league, e), crossed = rowOrientation(g, String(e.strHomeTeam ?? ""), String(e.strAwayTeam ?? "")) === "crossed";
  const h = crossed ? sc.away : sc.home, a = crossed ? sc.home : sc.away;
  const how = sc.order === "event" ? ", scores in the event name's order" : "", side = crossed ? ", home and away crossed" : "";
  const unresolved = sc.order === "unknown" ? `TheSportsDB's row ${e.idEvent ?? ""} (${e.strEvent ?? ""}: ${e.strHomeTeam ?? ""} home, ${e.strAwayTeam ?? ""} away) names its teams in neither order, so which score is whose cannot be told — held` : undefined;
  return { home: h ?? 0, away: a ?? 0, done: done && h !== null && a !== null, detail: `TheSportsDB ${e.strEvent ?? ""} ${n(e.intHomeScore) ?? "?"}–${n(e.intAwayScore) ?? "?"} (${e.strStatus ?? "?"}${how}${side})`, url, pens: /^(AP|PEN)\b/i.test(String(e.strStatus ?? "")), declared: null, aet: /^AET\b/i.test(String(e.strStatus ?? "")), unresolved };
}
/**
 * MLB StatsAPI's final for the game (season rehearsal 2026-10-13, bug 3). The day page lists games by their LOCAL date, so a night game
 * whose UTC date is D sits on page D-1 and page D may hold the same teams' NEXT game. Only a listing that is this game counts: the same
 * gamePk (the schedule's event id when the schedule came from StatsAPI), or both teams by name, and in either case a start within 6 hours
 * of the schedule's. Nothing within 6 hours: null, so crossFinal reads the next candidate page, never the nearest other game.
 */
export const MLB_START_WINDOW_MS = 6 * 3_600_000;
export function finalFromMlb(g: Game, body: unknown, url: string): Final | null {
  const games = (((body as { dates?: { games?: unknown[] }[] } | null)?.dates ?? []).flatMap((d) => d.games ?? [])) as { gamePk?: number; gameDate?: string; status?: { abstractGameState?: string }; teams?: { home?: { team?: { name?: string }; score?: number }; away?: { team?: { name?: string }; score?: number } } }[];
  const pk = /^\d+$/.test(g.eventId) ? g.eventId : null;
  const hits = games.filter((x) => (pk !== null && String(x.gamePk ?? "") === pk) || (sideMatches(String(x.teams?.home?.team?.name ?? ""), g.home) && sideMatches(String(x.teams?.away?.team?.name ?? ""), g.away)));
  const near = hits.filter((x) => Math.abs(Date.parse(String(x.gameDate)) - Date.parse(g.startsAt)) < MLB_START_WINDOW_MS);
  const hit = nearestStart(near, g.startsAt, (x) => x.gameDate);
  if (!hit) return null;
  const h = n(hit.teams?.home?.score), a = n(hit.teams?.away?.score);
  return { home: h ?? 0, away: a ?? 0, done: hit.status?.abstractGameState === "Final" && h !== null && a !== null, detail: `MLB StatsAPI ${a ?? "?"}–${h ?? "?"} (${hit.status?.abstractGameState ?? "?"})`, url };
}
export function finalFromNhl(g: Game, body: unknown, url: string): Final | null {
  const games = ((body as { games?: unknown[] } | null)?.games ?? []) as { startTimeUTC?: string; gameState?: string; homeTeam?: { name?: { default?: string }; score?: number }; awayTeam?: { name?: { default?: string }; score?: number } }[];
  const hit = nearestStart(games.filter((x) => sideMatches(String(x.homeTeam?.name?.default ?? ""), g.home) && sideMatches(String(x.awayTeam?.name?.default ?? ""), g.away)), g.startsAt, (x) => x.startTimeUTC);
  if (!hit) return null;
  const h = n(hit.homeTeam?.score), a = n(hit.awayTeam?.score);
  return { home: h ?? 0, away: a ?? 0, done: /^(OFF|FINAL)$/.test(String(hit.gameState)) && h !== null && a !== null, detail: `NHL ${a ?? "?"}–${h ?? "?"} (${hit.gameState ?? "?"})`, url };
}
/**
 * The NBA's own feed. It answers HTTP 403 since 2026-10-12 (espn.ts probe note), so while NBA_OFFICIAL_ANSWERS is false it is still tried
 * as a further read (a final it does serve is compared like any other) but never counted as one of the two operators a game needs: an
 * NBA game settles on the on-chain payout and TheSportsDB confirming each other, or TheSportsDB and API-Sports where its key is set.
 */
export const NBA_SCHEDULE_URL = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json";
export function finalFromNba(g: Game, body: unknown, url: string): Final | null {
  const dates = ((body as { leagueSchedule?: { gameDates?: { games?: unknown[] }[] } } | null)?.leagueSchedule?.gameDates ?? []);
  const games = dates.flatMap((d) => d.games ?? []) as { gameDateTimeUTC?: string; gameStatus?: number; homeTeam?: { teamName?: string; teamCity?: string; teamTricode?: string; score?: number }; awayTeam?: { teamName?: string; teamCity?: string; teamTricode?: string; score?: number } }[];
  const nm = (t: { teamName?: string; teamCity?: string } | undefined) => `${t?.teamCity ?? ""} ${t?.teamName ?? ""}`.trim();
  const hit = nearestStart(games.filter((x) => sideMatches(nm(x.homeTeam), g.home) && sideMatches(nm(x.awayTeam), g.away) && Math.abs(Date.parse(String(x.gameDateTimeUTC)) - Date.parse(g.startsAt)) < 12 * 3_600_000), g.startsAt, (x) => x.gameDateTimeUTC);
  if (!hit) return null;
  const h = n(hit.homeTeam?.score), a = n(hit.awayTeam?.score);
  return { home: h ?? 0, away: a ?? 0, done: hit.gameStatus === 3 && h !== null && a !== null, detail: `NBA ${a ?? "?"}–${h ?? "?"} (status ${hit.gameStatus ?? "?"})`, url };
}
/** API-Sports (football = soccer, basketball, american-football): the fixtures of the game's date. */
export function apiSportsUrl(league: LeagueId, date: string): string {
  const sport = LEAGUES[league].sport;
  return sport === "soccer" ? `https://v3.football.api-sports.io/fixtures?date=${date}` : sport === "basketball" ? `https://v1.basketball.api-sports.io/games?date=${date}` : `https://v1.american-football.api-sports.io/games?date=${date}`;
}
export function finalFromApiSports(g: Game, body: unknown, url: string): Final | null {
  const rows = ((body as { response?: unknown[] } | null)?.response ?? []) as { teams?: { home?: { name?: string; winner?: boolean | null }; away?: { name?: string; winner?: boolean | null } }; goals?: { home?: number; away?: number }; scores?: { home?: { total?: number } | number; away?: { total?: number } | number }; fixture?: { date?: string; status?: { short?: string } }; date?: string; status?: { short?: string } }[];
  const hit = nearestStart(rows.filter((r) => sideMatches(String(r.teams?.home?.name ?? ""), g.home) && sideMatches(String(r.teams?.away?.name ?? ""), g.away)), g.startsAt, (r) => r.fixture?.date ?? r.date);
  if (!hit) return null;
  const tot = (v: { total?: number } | number | undefined) => (typeof v === "number" ? v : v?.total);
  const h = n(hit.goals?.home ?? tot(hit.scores?.home)), a = n(hit.goals?.away ?? tot(hit.scores?.away));
  const st = String(hit.fixture?.status?.short ?? hit.status?.short ?? "");
  const declared = hit.teams?.home?.winner === true ? "home" : hit.teams?.away?.winner === true ? "away" : null;
  return { home: h ?? 0, away: a ?? 0, done: /^(FT|AET|PEN|AOT)$/.test(st) && h !== null && a !== null, detail: `API-Sports ${a ?? "?"}–${h ?? "?"} (${st || "?"})`, url, pens: st === "PEN", declared, aet: st === "AET" };
}

// ---- one game, settled ----------------------------------------------------------------------------------------------------------

export type GameVerdict =
  | { kind: "settled"; winner: "home" | "away" | "tie"; final: { home: number; away: number } | null; settledOn: "on-chain payout" | "TheSportsDB"; confirmedBy: string; ops: string[]; detail: string; url: string }
  | { kind: "awaiting"; why: string }
  | { kind: "held"; why: string };

const winnerOf = (f: { home: number; away: number }): "home" | "away" | "tie" => (f.home > f.away ? "home" : f.home < f.away ? "away" : "tie");

/** The cross-read's final for a game (null: not in the feed; throws: unreadable). */
/** Reads one URL per candidate day; a day the feed does not serve (404) is skipped, and only when every day fails is the read unreadable. */
async function firstFinal(client: EspnClient, urls: string[], parse: (body: unknown, url: string) => Final | null, headers: Record<string, string> = {}): Promise<Final | null> {
  let err: Error | null = null, any = false;
  for (const url of urls) {
    let body: unknown;
    try { body = await client.get(url, headers); any = true; } catch (e) { err = e as Error; continue; }
    const f = parse(body, url);
    if (f) return f;
  }
  if (!any && err) throw err;
  return null;
}
/**
 * The StatsAPI day pages that can list the game (bug 3): its UTC date, the day before (a US night game's local date), and the day after
 * when it starts within 4 hours of midnight UTC (a game played east of UTC, local date ahead of UTC).
 */
export function mlbDays(g: Pick<Game, "date" | "startsAt">): string[] {
  const t = Date.parse(g.startsAt), next = new Date(Date.parse(`${g.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return [g.date, dayBefore(g.date), ...(Number.isFinite(t) && new Date(t).getUTCHours() >= 20 ? [next] : [])];
}
export async function crossFinal(client: EspnClient, g: Game, d: GameDeps, which: CrossId | null = null): Promise<{ id: CrossId; final: Final | null }> {
  const id = which ?? crossIdOf(g.league);
  const prevDay = dayBefore(g.date);
  if (id === "mlb.statsapi") return { id, final: await firstFinal(client, mlbDays(g).map((day) => `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${day}`), (b, u) => finalFromMlb(g, b, u)) };
  if (id === "nhl.score") return { id, final: await firstFinal(client, [g.date, prevDay].map((day) => `https://api-web.nhle.com/v1/score/${day}`), (b, u) => finalFromNhl(g, b, u)) };
  if (id === "nba.cdn") {
    // 2026-10-14: the NBA's feed answers HTTP 403 since 2026-10-12, and an error is never cached, so each NBA game read it again (a season
    // rehearsal: one wasted request per game, through the request budget). A refusal now marks it refused for this client's process;
    // the NBA game then settles on TheSportsDB's day listing and event lookup plus the on-chain payout, as every TheSportsDB league does.
    const refused = (client as { refusedFeeds?: Set<string> }).refusedFeeds;   // a test double may not carry it
    if (refused?.has(NBA_SCHEDULE_URL)) throw new Error(`HTTP 403 earlier in this run for ${NBA_SCHEDULE_URL} (not read again)`);
    try { return { id, final: await firstFinal(client, [NBA_SCHEDULE_URL], (b, u) => finalFromNba(g, b, u)) }; }
    catch (e) { if (/HTTP (401|403)\b/.test((e as Error).message)) refused?.add(NBA_SCHEDULE_URL); throw e; }
  }
  if (!d.apiSportsKey) throw new Error("cross-read missing: BURNTICKER_APISPORTS_KEY (a second licensed provider) is not set");
  return { id, final: await firstFinal(client, [g.date, prevDay].map((day) => apiSportsUrl(g.league, day)), (b, u) => finalFromApiSports(g, b, u), { "x-apisports-key": d.apiSportsKey }) };
}

/** The league's free official feed (MLB, NHL, NBA), if any — a third read where it exists (the NBA's is tried, not counted: countedOfficialOf). */
export const officialOf = (league: LeagueId): CrossId | null => (league === "mlb" ? "mlb.statsapi" : league === "nhl" ? "nhl.score" : league === "nba" ? "nba.cdn" : null);
/**
 * The league's official feed when it can be COUNTED as one of the two operators: MLB and the NHL always; the NBA only while its feed
 * answers (NBA_OFFICIAL_ANSWERS, false since the 2026-10-12 probe). A feed that answers 403 is never counted on, so a dead feed cannot
 * make a game wait for a read that will not come; the pair payout plus TheSportsDB settles it.
 */
export const countedOfficialOf = (league: LeagueId): CrossId | null => { const off = officialOf(league); return off === "nba.cdn" && !NBA_OFFICIAL_ANSWERS ? null : off; };
/** How many independent operators can read this league's games on this host, at best (for the creation check before any game). */
export function operatorsFor(league: LeagueId, d: GameDeps, hasMarket: boolean): string[] {
  const off = countedOfficialOf(league);
  return [hasMarket ? "on-chain payout" : null, d.tsdbKey ? "TheSportsDB" : null, off ? CROSS_LABEL[off] : null, d.apiSportsKey ? "API-Sports" : null].filter((x): x is string => !!x);
}

/**
 * A SOCCER GAME'S THREE-WAY PAYOUT (launch walkthrough 2026-10-13). Polymarket lists the game as three yes/no conditions (home win, draw,
 * away win). All three payout vectors are read on Polygon and all three must be resolved; exactly one may pay YES, and that leg is the
 * result (home, away, or a tie for the draw leg). An unresolved leg, or a split payout (a voided leg), waits; two legs paying YES, or none,
 * contradict each other and hold the game.
 *
 * PENALTIES AND EXTRA TIME: the three markets settle on the 90-minute result (regular time plus stoppage time), so a cup tie decided in
 * extra time or on penalties pays YES on the DRAW leg. The owner's rule (item 78, `Final` above) counts a level game decided on penalties
 * as a win for the side that went through, so the draw leg alone never decides such a game: settleGame compares the payout's "level after
 * 90 minutes" with the score reads and then leaves it out of the operator count (the comment there).
 */
async function threeWayRead(market: GameMarket, w: NonNullable<GameMarket["threeWay"]>, d: GameDeps): Promise<{ kind: "read"; winner: "home" | "away" | "tie"; detail: string } | { kind: "awaiting"; why: string } | { kind: "held"; why: string }> {
  const legs = [["home", w.home, `${w.homeName} win`], ["tie", w.draw, "a draw"], ["away", w.away, `${w.awayName} win`]] as const;
  const yes: (typeof legs)[number][] = [];
  for (const leg of legs) {
    const p = d.payout ? await d.payout(leg[1]).catch(() => null) : null;
    if (!p || !p.resolved) return { kind: "awaiting", why: `the on-chain payout for ${leg[2]} in ${market.question} is not resolved yet` };
    if (p.outcome === null) return { kind: "awaiting", why: `the on-chain payout for ${leg[2]} in ${market.question} is split, not a result` };
    if (p.outcome === 0) yes.push(leg);
  }
  if (yes.length > 1) return { kind: "held", why: `the on-chain payouts for ${market.question} pay out on more than one result (${yes.map((l) => l[2]).join(" and ")}) — held` };
  if (yes.length === 0) return { kind: "held", why: `none of the three on-chain payouts for ${market.question} pays out — held` };
  return { kind: "read", winner: yes[0][0], detail: `on-chain payout ${market.question}: ${yes[0][2]} (90 minutes)` };
}

/**
 * Settles one completed game. The PRIMARY is the on-chain payout where a market exists, else TheSportsDB's licensed final; the
 * on-chain payout and TheSportsDB are independent operators, so when both exist each confirms the other. The league's official feed
 * (MLB, NHL, NBA) is a further read where it is free, API-Sports where its key is set. At least TWO operators must read the game and
 * every read must agree (scores where both carry scores, else the winner); one operator alone is held.
 */
export async function settleGame(client: EspnClient, g: Game, d: GameDeps): Promise<GameVerdict> {
  type Read = { op: string; label: string; winner: "home" | "away" | "tie"; final: { home: number; away: number } | null; detail: string; url: string; pens?: boolean; declared?: "home" | "away" | null; aet?: boolean; ninety?: boolean };
  const reads: Read[] = []; const pending: string[] = []; const errors: string[] = [];
  // the on-chain payout
  const market = d.market ? await d.market(g).catch(() => null) : null;
  if (market?.threeWay) {
    const r = await threeWayRead(market, market.threeWay, d);
    if (r.kind === "held") return { kind: "held", why: r.why };
    if (r.kind === "awaiting") pending.push(r.why);
    else reads.push({ op: "on-chain payout", label: "the game's on-chain payout", winner: r.winner, final: null, detail: r.detail, url: market.url, ninety: true });
  } else if (market) {
    const p = d.payout ? await d.payout(market.conditionId).catch(() => null) : null;
    if (!p || !p.resolved) pending.push(`the on-chain payout for ${market.question} is not resolved yet`);
    else {
      const name = p.outcome === null ? null : market.outcomes[p.outcome];
      const winner = name === null ? "tie" : sideMatches(name, g.home) ? "home" : sideMatches(name, g.away) ? "away" : null;
      if (winner === null) return { kind: "held", why: `the payout names "${name}", which matches neither team` };
      reads.push({ op: "on-chain payout", label: "the game's on-chain payout", winner, final: null, detail: `on-chain payout ${market.question}: ${name ?? "split"}`, url: market.url });
    }
  }
  // TheSportsDB (licensed)
  if (d.tsdbKey) {
    try {
      // v2 with the key in the header; a key v2 refuses is read through v1 (espn.ts tsdbRead), the key never logged
      let f: Final | null = null, any = false, err: Error | null = null;
      // the day listing first (2026-10-13: v2 search/event finds nothing for any league); the name search stays as the fallback
      try { f = await tsdbFinalByDay(client, d.tsdbKey, g); any = true; } catch (e) { err = e as Error; }
      for (const names of f ? [] : tsdbNamePairs(g)) {
        let body: unknown;
        try { body = await client.tsdbRead(d.tsdbKey, tsdbV2Url(names), (k) => [tsdbV1SearchUrl(k, names)]); any = true; } catch (e) { err = e as Error; continue; }
        f = finalFromTsdb(g, body, tsdbV2Url(names));
        if (f) break;
      }
      if (!any && err) throw err;
      if (f?.unresolved) return { kind: "held", why: f.unresolved };
      if (f && f.done) reads.push({ op: "TheSportsDB", label: "a licensed final score", winner: winnerOf(f), final: { home: f.home, away: f.away }, detail: f.detail, url: f.url, pens: f.pens, declared: f.declared, aet: f.aet });
      else pending.push(f ? `TheSportsDB has the game but not final: ${f.detail}` : "TheSportsDB has no final for the game yet");
    } catch (e) { errors.push(`TheSportsDB: ${(e as Error).message.slice(0, 80)}`); }
  }
  if (!market && !d.tsdbKey) return { kind: "held", why: "no primary: no moneyline market for the game and BURNTICKER_THESPORTSDB_KEY (the commercial license) is not set" };
  // the league's official feed (free) and API-Sports (optional)
  const off = officialOf(g.league);
  for (const id of [off, d.apiSportsKey ? "apisports.games" as const : null]) {
    if (!id) continue;
    try {
      const c = await crossFinal(client, g, d, id);
      if (c.final && c.final.done) reads.push({ op: id, label: CROSS_LABEL[id], winner: winnerOf(c.final), final: { home: c.final.home, away: c.final.away }, detail: c.final.detail, url: c.final.url, pens: c.final.pens, declared: c.final.declared, aet: c.final.aet });
      else pending.push(`${CROSS_LABEL[id]} has no final for the game yet`);
    } catch (e) { errors.push(`${CROSS_LABEL[id]}: ${(e as Error).message.slice(0, 80)}`); }
  }
  // THE THREE-WAY PAYOUT AND EXTRA TIME (see threeWayRead): Polymarket's soccer markets settle on the 90-minute result, so a cup tie
  // that went to extra time or penalties reads "draw" on chain whoever went through. When any score read marks the game AET or decided
  // on penalties, the payout is compared on what it does say (the game was level after 90 minutes; a payout naming a winner there
  // contradicts the score reads and holds the game) and is then NOT counted as one of the two operators, because it says nothing about
  // the final. The final, and the penalty winner under item 78 below, must come from two other reads.
  if (reads.some((r) => r.op !== "on-chain payout" && (r.pens || r.aet))) {
    const i = reads.findIndex((r) => r.ninety);
    if (i >= 0) {
      if (reads[i].winner !== "tie") return { kind: "held", why: `the on-chain payout says the game was decided in 90 minutes, but a score read says it went to extra time — held` };
      reads.splice(i, 1);
      if (operatorsFor(g.league, d, false).length < 2) return { kind: "held", why: "the game went past 90 minutes, and the on-chain payout only settles the 90-minute result: a second read of the final score is needed" };
    }
  }
  const primary = reads.find((r) => r.op === "on-chain payout") ?? reads.find((r) => r.op === "TheSportsDB");
  const others = reads.filter((r) => r !== primary);
  if (!primary || others.length === 0) {
    const possible = operatorsFor(g.league, d, !!market);
    if (possible.length < 2) return { kind: "held", why: `only one operator can read this game (${possible.join(", ") || "none"}): a second independent read is needed` };
    return { kind: "awaiting", why: pending[0] ?? errors[0] ?? "waiting for a second read" };
  }
  for (const r of others) {
    const agree = primary.final && r.final ? primary.final.home === r.final.home && primary.final.away === r.final.away : primary.winner === r.winner;
    if (!agree) return { kind: "held", why: `${primary.detail} ≠ ${r.detail} — held` };
  }
  // item 78: a level score decided on penalties follows the declared winner (any read, or the schedule's own winner flag), never a draw
  let winner = primary.winner;
  const finalScore = primary.final ?? others.find((r) => r.final)?.final ?? null;
  if (winner === "tie" && finalScore && finalScore.home === finalScore.away) {
    const flag = g.home.winner === true ? "home" : g.away.winner === true ? "away" : null;
    const named = new Set([...reads.map((r) => r.declared ?? null), flag].filter((x): x is "home" | "away" => !!x));
    if (named.size > 1) return { kind: "held", why: "the sources name different winners of the penalty shoot-out — held" };
    if (named.size === 1) winner = [...named][0];
    else if (reads.some((r) => r.pens)) return { kind: "held", why: "the game was decided on penalties, but no source names the winner — held" };
  }
  const confirmed = others.map((r) => r.label);
  return { kind: "settled", winner, final: primary.final ?? others.find((r) => r.final)?.final ?? null, settledOn: primary.op === "on-chain payout" ? "on-chain payout" : "TheSportsDB", confirmedBy: confirmed.join(" and "), ops: reads.map((r) => r.op), detail: reads.map((r) => r.detail).join("; "), url: primary.url };
}

/** A schedule status that means the game was not played on its listed date (MLB marks these "post" without a result). */
export const POSTPONED_RE = /postpon|cancel|suspend/i;

const outcomeFor = (winner: "home" | "away" | "tie", g: Game, abbr: string, teamId: string | null): "win" | "loss" | "tie" | null => {
  const isUs = (x: GameSide) => (teamId && x.id ? x.id === teamId : x.abbr === abbr);
  const us = isUs(g.home) ? "home" : isUs(g.away) ? "away" : null;
  if (!us) return null;
  return winner === "tie" ? "tie" : winner === us ? "win" : "loss";
};

/** Settled readings for a team or game series since `sinceIso` (the keeper and the back-test). */
export async function sportsSettled(client: EspnClient, s: EspnSeries, sinceIso: string | null, d: GameDeps, o: { nowMs?: number } = {}): Promise<ResolvedSelector> {
  const now = o.nowMs ?? Date.now();
  const ms = asMeetings(s);
  if (ms) return meetingsSettled(client, ms, d, now);
  const all = await gamesFor(client, s, sinceIso);
  const games = all.filter((g) => !sinceIso || g.date > sinceIso.slice(0, 10));
  const tid = s.kind === "team" ? s.teamId : null;
  const byDay = new Map<string, { value: number; titles: string[]; url: string; method: string }>();
  let awaiting = 0; const refusals: string[] = [];
  // semantics-verify items 79 and 80: a day's reading is one id (its UTC date) and the registry refuses a changed value for an id it
  // holds, so a day is read only once every game of it has a result. A game still awaiting holds its whole day (a doubleheader's first
  // game is never written alone and then contradicted by the second). A postponed, cancelled or suspended game that is not final counts
  // for neither side and does not hold its day; a made-up game is read on the date it is played.
  const waitingDays = new Set<string>();
  for (const g of games) {
    if (!g.completed && g.state !== "post") continue;
    if (!g.completed && POSTPONED_RE.test(g.detail)) continue;
    if (Date.parse(g.startsAt) + SETTLE_AFTER_START_MS > now) { awaiting++; waitingDays.add(g.date); continue; }
    const v = await settleGame(client, g, d);
    if (v.kind === "awaiting") { awaiting++; waitingDays.add(g.date); continue; }
    if (v.kind === "held") { const r = /^no primary|^cross-read missing/.test(v.why) ? v.why : `${g.eventId} ${g.name}: ${v.why}`; if (!refusals.includes(r)) refusals.push(r); continue; }
    const out = outcomeFor(v.winner, g, s.abbr, tid);
    if (out === null) continue;
    const cur = byDay.get(g.date) ?? { value: 0, titles: [], url: v.url, method: "" };
    // one unit when the result is in the coin's set: its one outcome, or two of the three (espn.ts outcomeHits; a tie is a draw)
    if (outcomeHits(s.outcome, out)) cur.value++;
    const score = v.final ? `${g.away.abbr} ${v.final.away} @ ${g.home.abbr} ${v.final.home}` : `${g.away.abbr} @ ${g.home.abbr}`;
    cur.titles.push(`${score} final (${out === "tie" ? "draw" : `${s.abbr} ${out}`}) · settled on ${SETTLED_ON[v.settledOn]} · confirmed by ${v.confirmedBy} · see this game on ESPN → ${espnGameUrl(g.league, g.date)}`);
    cur.method = v.ops.map((o) => (o === "on-chain payout" ? "onchain-payout" : o === "TheSportsDB" ? "thesportsdb" : o)).join("+");
    byDay.set(g.date, cur);
  }
  for (const day of waitingDays) byDay.delete(day);
  const events: SettledEvent[] = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, x]) => ({ id: date, at: date, result: null, value: String(x.value), title: x.titles.join(" · "), sourceUrl: x.url, method: x.method } as SettledEvent));
  const window = windowStatus(s, s.kind === "team" && s.window.kind === "post" ? await client.season(s.league, s.teamId ?? s.abbr, s.window.year).catch(() => all) : all, now);
  return { events, awaitingFinal: awaiting, refusals, settlementSourceUrl: null, window };
}

/**
 * PRIMARY A's readers over the Polymarket client: Gamma search by the two teams (closed and open), a moneyline market whose two outcomes
 * name the two teams and whose end falls within a day of the game; the payout from the CTF on Polygon (readChain).
 */
/**
 * Polymarket's tag slug per league (Gamma /events?tag_slug=): read 2026-10-13 against the live index; a league not here uses the text
 * search only. The soccer tags were probed with start_time windows on 2026-10-13 (each listed that week's three-leg game events): Serie A
 * is "sea" ("serie-a" lists no game events), the Champions League "ucl" and the Europa League "uel" (both empty before their matchdays on
 * 10-13 and 10-15, then full), the Conference League "europa-conference-league" ("uecl", "conference-league" and
 * "uefa-conference-league" list none), NWSL "soccer-nwsl", Liga MX "mex", Eredivisie "ere", Primeira Liga "primeira-liga", the EFL
 * Championship "efl-championship", the Scottish Premiership "scottish-premiership", the Brasileirão "brazil-serie-a", Argentina "arg".
 */
export const POLY_LEAGUE_TAG: Partial<Record<LeagueId, string>> = {
  nfl: "nfl", mlb: "mlb", nba: "nba", nhl: "nhl", wnba: "wnba", cfb: "cfb",
  "eng.1": "epl", "esp.1": "la-liga", "ger.1": "bundesliga", "fra.1": "ligue-1", "ita.1": "sea", "usa.1": "mls", "usa.nwsl": "soccer-nwsl",
  "uefa.champions": "ucl", "uefa.europa": "uel", "uefa.europa.conf": "europa-conference-league", "mex.1": "mex", "ned.1": "ere", "por.1": "primeira-liga",
  "eng.2": "efl-championship", "sco.1": "scottish-premiership", "bra.1": "brazil-serie-a", "arg.1": "arg",
};

type GameHitMarket = { conditionId: string; question: string; yes: string; no: string; endDate: string | null; sportsMarketType: string | null; gameStartTime?: string | null; /** Gamma groupItemTitle ("Arsenal FC", "Draw (Arsenal FC vs. Leeds United FC)") */ outcome?: string | null };

/** How strongly a provider's team name names a side: 0 no match, else the longest matching key (an exact name scores highest). */
const sideScore = (name: string, s: GameSide): number => { const a = norm(name); let best = 0; for (const k of [s.name, s.nickname, s.short ?? "", s.location ?? "", s.abbr]) { if (!k || k.length < 3) continue; const b = norm(k); if (a === b) best = Math.max(best, 1000); else if (a.includes(b) || b.includes(a)) best = Math.max(best, Math.min(a.length, b.length)); } return best; };
const DRAW_Q = /\bend in a draw\b/i, TEAM_WIN_Q = /^Will (.+?) win\b/i;
/**
 * A soccer event's three moneyline legs (verified live 2026-10-13 on epl-ars-lee-2026-10-10): three binary Yes/No markets of type
 * moneyline, one asking whether the game ends in a draw and two asking whether a named team wins. The two team legs are assigned to home
 * and away by the stronger name match (a derby's "Manchester" names both sides; "Manchester United FC" names one better); an event whose
 * legs cannot be assigned one way only is skipped. Null: the event is not a three-way game market for this game.
 */
export function threeWayOf(markets: readonly GameHitMarket[], g: Game): { draw: GameHitMarket; home: GameHitMarket; away: GameHitMarket; homeName: string; awayName: string } | null {
  const legs = markets.filter((m) => (m.sportsMarketType === "moneyline" || m.sportsMarketType === null) && /^yes$/i.test(m.yes) && /^no$/i.test(m.no));
  const draws = legs.filter((m) => DRAW_Q.test(m.question) || /^draw\b/i.test(m.outcome ?? ""));
  const teams = legs.filter((m) => !draws.includes(m)).map((m) => ({ m, name: (m.outcome || TEAM_WIN_Q.exec(m.question)?.[1] || "").trim() })).filter((t) => t.name && TEAM_WIN_Q.test(t.m.question));
  if (draws.length !== 1 || teams.length !== 2) return null;
  const [a, b] = teams;
  // our team table first (ourTeam: "Club Atlético de Madrid" is Atlético Madrid, never Real Madrid); a leg naming a third club is not
  // this game; the name score only where the table does not know the name
  const who = (name: string): "home" | "away" | "other" | null => { const t = ourTeam(g.league, name); return !t ? null : t.abbr === g.home.abbr ? "home" : t.abbr === g.away.abbr ? "away" : "other"; };
  const wa = who(a.name), wb = who(b.name);
  if (wa === "other" || wb === "other") return null;
  if (wa && wb) { if (wa === wb) return null; const [home, away] = wa === "home" ? [a, b] : [b, a]; return { draw: draws[0], home: home.m, away: away.m, homeName: home.name, awayName: away.name }; }
  const sc = (leg: "a" | "b", s: "home" | "away") => { const w = leg === "a" ? wa : wb; return w ? (w === s ? 10_000 : 0) : sideScore((leg === "a" ? a : b).name, g[s]); };
  const ah = sc("a", "home"), aa = sc("a", "away"), bh = sc("b", "home"), ba = sc("b", "away");
  const straight = ah > 0 && ba > 0 ? ah + ba : 0, crossed = aa > 0 && bh > 0 ? aa + bh : 0;
  if (straight === crossed) return null;
  const [home, away] = straight > crossed ? [a, b] : [b, a];
  return { draw: draws[0], home: home.m, away: away.m, homeName: home.name, awayName: away.name };
}
type GameHits = { events: { url: string; markets: GameHitMarket[] }[] };
export function polymarketGameReaders(poly: { search(q: string, o?: { status?: "open" | "closed" | "all"; limit?: number }): Promise<GameHits>; eventsInWindow?(slug: string, minIso: string, maxIso: string): Promise<GameHits>; eventsStarting?(slug: string, minIso: string, maxIso: string): Promise<GameHits>; readChain(conditionId: string): Promise<{ resolved: boolean; outcome: number | null }> }): Pick<GameDeps, "market" | "payout"> {
  type Hit = { url: string; markets: GameHitMarket[] };
  const pick = (events: readonly Hit[], g: Game): GameMarket | null => {
    // walkthrough 2026-10-13: the CLOSEST moneyline of the two teams within 2 days (a playoff series lists the same two teams on
    // consecutive days, so the first match in the window could be the next day's game), timed by the market's own game start when
    // Gamma gives one (an MLB game market ends a week after the game)
    let best: { m: GameMarket; d: number } | null = null;
    for (const e of events) for (const m of e.markets) {
      if (m.sportsMarketType && m.sportsMarketType !== "moneyline") continue;
      const names = [m.yes, m.no];
      const both = names.some((x) => sideMatches(x, g.home)) && names.some((x) => sideMatches(x, g.away));
      const when = m.gameStartTime ?? m.endDate;
      const d = when ? Math.abs(Date.parse(when) - Date.parse(g.startsAt)) : NaN;
      if (both && d < 2 * 86_400_000 && (!best || d < best.d)) best = { m: { conditionId: m.conditionId, question: m.question, outcomes: [m.yes, m.no], url: e.url }, d };
    }
    // soccer (a league with draws): the event's three yes/no legs (threeWayOf), timed the same way; the nearest game wins
    if (LEAGUES[g.league].draws) for (const e of events) {
      const t = threeWayOf(e.markets, g);
      if (!t) continue;
      const when = t.home.gameStartTime ?? t.draw.gameStartTime ?? t.home.endDate;
      const d = when ? Math.abs(Date.parse(when) - Date.parse(g.startsAt)) : NaN;
      if (d < 2 * 86_400_000 && (!best || d < best.d)) best = { m: { conditionId: t.home.conditionId, question: `${t.homeName} vs. ${t.awayName}`, outcomes: ["Yes", "No"], url: e.url, threeWay: { home: t.home.conditionId, draw: t.draw.conditionId, away: t.away.conditionId, homeName: t.homeName, awayName: t.awayName } }, d };
    }
    return best?.m ?? null;
  };
  return {
    market: async (g) => {
      // launch night 2026-10-13: the league's events in a window around the game's start first (the text search is capped at 10 hits and
      // older meetings of the same two teams crowd out the week's game: "Chiefs vs Raiders" missed nfl-kc-lv-2026-10-04)
      // walkthrough 2026-10-13: by the events' scheduled start first (an MLB game event ends a week after the game, so the end-date window
      // missed every MLB game), then by end date
      const tag = POLY_LEAGUE_TAG[g.league];
      const start = Date.parse(g.startsAt);
      if (tag && Number.isFinite(start)) {
        if (poly.eventsStarting) {
          const r = await poly.eventsStarting(tag, new Date(start - 12 * 3600_000).toISOString(), new Date(start + 12 * 3600_000).toISOString()).catch(() => null);
          const hit = r ? pick(r.events, g) : null;
          if (hit) return hit;
        }
        if (poly.eventsInWindow) {
          const r = await poly.eventsInWindow(tag, new Date(start - 36 * 3600_000).toISOString(), new Date(start + 48 * 3600_000).toISOString()).catch(() => null);
          const hit = r ? pick(r.events, g) : null;
          if (hit) return hit;
        }
      }
      const r = await poly.search(`${g.away.nickname || g.away.name} vs ${g.home.nickname || g.home.name}`, { status: "all", limit: 10 });
      return pick(r.events, g);
    },
    payout: async (id) => { const c = await poly.readChain(id); return { resolved: c.resolved, outcome: c.outcome }; },
  };
}

/**
 * A RIVALRY SERIES' READINGS (espn.ts SERIES, window `meetings`; owner 2026-10-12). Every meeting of the season is settled each read (a
 * season has a handful, the client caches, and the registry refuses a changed value for a day it holds), so the head-to-head count is
 * always the settled one, never the schedule's own scores:
 *   a meeting day     value = the side's wins minus its losses that day (+1, −1, or 0 for a draw or a split day), the same rules as a team
 *                     coin's day (gameSettle settleGame: two independent reads must agree; a cup tie on penalties follows the declared
 *                     winner); a postponed or cancelled meeting counts for neither side and holds nothing
 *   the season's end  both teams' seasons over (windowStatus over BOTH schedules, postseason included) and every meeting settled: one more
 *                     reading the day after the last game, +1 to the side that won more meetings, −1 to the other; a level series
 *                     writes nothing and the window ends void (MEETINGS_LEVEL_REASON)
 * While any meeting still awaits its result or is held, the window does not end.
 */
export async function meetingsSettled(client: EspnClient, s: MeetingsSeries, d: GameDeps, now: number): Promise<ResolvedSelector> {
  const w = s.window;
  const meetings = await gamesFor(client, s, null);
  const byDay = new Map<string, { value: number; titles: string[]; url: string; method: string }>();
  const waitingDays = new Set<string>(), refusals: string[] = [], outcomes: MeetingOutcome[] = [];
  let awaiting = 0, unsettled = 0;
  for (const g of meetings) {
    if (!g.completed && (g.state === "post" || POSTPONED_RE.test(g.detail))) { if (g.state === "post" || /cancel/i.test(g.detail)) outcomes.push("void"); continue; }
    if (!g.completed) { unsettled++; continue; }
    if (Date.parse(g.startsAt) + SETTLE_AFTER_START_MS > now) { awaiting++; unsettled++; waitingDays.add(g.date); continue; }
    const v = await settleGame(client, g, d);
    if (v.kind === "awaiting") { awaiting++; unsettled++; waitingDays.add(g.date); continue; }
    if (v.kind === "held") { unsettled++; const r = /^no primary|^cross-read missing/.test(v.why) ? v.why : `${g.eventId} ${g.name}: ${v.why}`; if (!refusals.includes(r)) refusals.push(r); waitingDays.add(g.date); continue; }
    const out = outcomeFor(v.winner, g, s.abbr, s.teamId);
    if (out === null) continue;
    outcomes.push(out === "tie" ? "draw" : out === "win" ? "win" : out === "loss" ? "loss" : "draw");
    const cur = byDay.get(g.date) ?? { value: 0, titles: [], url: v.url, method: "" };
    cur.value += out === "win" ? 1 : out === "loss" ? -1 : 0;
    const score = v.final ? `${g.away.abbr} ${v.final.away} @ ${g.home.abbr} ${v.final.home}` : `${g.away.abbr} @ ${g.home.abbr}`;
    cur.titles.push(`${score} final (${out === "tie" ? "draw" : `${s.abbr} ${out}`}, head to head) · settled on ${SETTLED_ON[v.settledOn]} · confirmed by ${v.confirmedBy} · see this game on ESPN → ${espnGameUrl(g.league, g.date)}`);
    cur.method = v.ops.map((op) => (op === "on-chain payout" ? "onchain-payout" : op === "TheSportsDB" ? "thesportsdb" : op)).join("+");
    byDay.set(g.date, cur);
  }
  for (const day of waitingDays) byDay.delete(day);
  const events: SettledEvent[] = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, x]) => ({ id: date, at: date, result: null, value: String(x.value), title: x.titles.join(" · "), sourceUrl: x.url, method: x.method } as SettledEvent));
  // the window: both teams' whole seasons (the later season end is the series' end)
  const [mine, theirs] = await Promise.all([client.season(s.league, s.teamId ?? s.abbr, w.year), client.season(s.league, w.oppId || w.opp, w.year)]);
  let window = windowStatus(s, dedupeListings([...mine, ...theirs]), now);
  if (window.ended && unsettled > 0) window = { ...window, ended: false, reason: `both seasons are over, but ${unsettled} game${unsettled === 1 ? "" : "s"} between them ${unsettled === 1 ? "has" : "have"} no settled result yet` };
  else if (window.ended) {
    const t = tallyMeetings(outcomes);
    const team = teamById(s.league, s.teamId ?? "")?.name ?? teamByAbbr(s.league, s.abbr)?.name ?? s.abbr, opp = teamById(s.league, w.oppId)?.name ?? teamByAbbr(s.league, w.opp)?.name ?? w.opp;
    const endDay = t.leader === "level" || !window.endsAt ? null : seriesEndDay(window.endsAt);
    if (endDay) events.push({ id: endDay, at: endDay, result: null, value: t.leader === "team" ? "1" : "-1", title: `The season series is over: ${team} won ${t.wins}, ${opp} won ${t.losses}${t.draws ? `, ${t.draws} drawn` : ""}. This is the season-end result of the head-to-head series.`, sourceUrl: [...byDay.values()].pop()?.url ?? "", method: "head-to-head-tally" } as SettledEvent);
    window = { ...window, reason: meetingsEndReason(t, team, opp), series: { ...t, endDay } };
  }
  return { events, awaitingFinal: awaiting, refusals, settlementSourceUrl: null, window };
}
