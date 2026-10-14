import type { SettledEvent } from "@/lib/burnticker/units";
import type { ResolvedSelector } from "@/lib/burnticker/oracle/types";
import { LEAGUES, NBA_OFFICIAL_ANSWERS, SETTLE_AFTER_START_MS, asMeetings, teamNameKey, dedupeListings, gamesFor, meetingsEndReason, seriesEndDay, tallyMeetings, teamById, teamByAbbr, tsdbNamePairs, windowStatus, type EspnClient, type EspnSeries, type Game, type GameSide, type LeagueId, type MeetingOutcome, type MeetingsSeries, type Outcome } from "@/lib/burnticker/sources/espn";

/**
 * HOW A TEAM COIN'S GAME SETTLES (owner, 2026-10-10). NO ESPN READS: the game list comes from the league's free official schedule (MLB
 * StatsAPI, the NHL's api-web), the NBA's feed when it answers (else TheSportsDB), or TheSportsDB v2 (licensed key) — espn.ts
 * EspnClient/SportsClient. Each completed game:
 *
 *   PRIMARY A  the game's ON-CHAIN PAYOUT where Polymarket lists a moneyline market (Gamma search by the two teams and the date → the
 *              condition id → the Conditional Tokens payout vector on Polygon), exactly as an election does;
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
export interface Final { home: number; away: number; done: boolean; detail: string; url: string; pens?: boolean; declared?: "home" | "away" | null }
export interface GameMarket { conditionId: string; question: string; outcomes: [string, string]; url: string }
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
/** A provider's team name matches a side when it contains the side's nickname, short name, location or full name (or the reverse). */
export const sideMatches = (name: string, s: GameSide): boolean => { const a = norm(name); return [s.name, s.nickname, s.short ?? "", s.location ?? "", s.abbr].filter((k) => k && k.length >= 3).some((k) => { const b = norm(k); return a === b || a.includes(b) || b.includes(a); }); };

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
/** The day listing's row for this game: both teams match by name and the date is the game's UTC date or the day before. */
export function tsdbDayMatch(g: Game, body: unknown): Record<string, unknown> | null {
  const prev = new Date(Date.parse(`${g.date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const rows = tsdbRows(body).filter((e) => (e.dateEvent === g.date || e.dateEvent === prev) && sideMatches(String(e.strHomeTeam ?? ""), g.home) && sideMatches(String(e.strAwayTeam ?? ""), g.away));
  const same = rows.filter((e) => e.dateEvent === g.date);
  return nearestStart(same.length ? same : rows, g.startsAt, tsdbStart) ?? null;
}
/** The game's TheSportsDB row through the day listing, then the event lookup for its status when the listing has none. Null: not listed. */
export async function tsdbFinalByDay(client: EspnClient, key: string, g: Game): Promise<Final | null> {
  for (const date of [g.date, new Date(Date.parse(`${g.date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)]) {
    const url = tsdbV2DayUrl(date);
    const row = tsdbDayMatch(g, await client.tsdbRead(key, url, (k) => [tsdbV1DayUrl(k, date)]));
    if (!row) continue;
    let full = row;
    if (!row.strStatus && row.idEvent) {
      const lookedUp = tsdbRows(await client.tsdbRead(key, tsdbV2EventUrl(String(row.idEvent)), (k) => [tsdbV1EventUrl(k, String(row.idEvent))]).catch(() => null))[0];
      if (lookedUp) full = { ...row, ...lookedUp };
    }
    return finalFromTsdb(g, { events: [full] }, url);
  }
  return null;
}
export const tsdbV2Url = (names: [string, string]): string => `https://www.thesportsdb.com/api/v2/json/search/event/${encodeURIComponent(`${names[0]} vs ${names[1]}`.replace(/ /g, "_").toLowerCase())}`;
/** TheSportsDB v2 search/event: the event list under whichever key the API uses; the game's date (or the day before, UTC) and a final status. */
export function finalFromTsdb(g: Game, body: unknown, url: string): Final | null {
  const lists = body && typeof body === "object" ? Object.values(body as Record<string, unknown>).filter(Array.isArray) as Record<string, unknown>[][] : [];
  const evs = lists.flat().filter((e) => typeof e === "object" && e && "dateEvent" in e);
  const prev = new Date(Date.parse(`${g.date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const sameDay = evs.filter((x) => x.dateEvent === g.date), dayBefore = evs.filter((x) => x.dateEvent === prev);
  const e = nearestStart(sameDay.length ? sameDay : dayBefore, g.startsAt, tsdbStart);
  if (!e) return null;
  const done = /^(FT|AOT|AET|AP|PEN|Match Finished|Final)/i.test(String(e.strStatus ?? ""));
  const h = n(e.intHomeScore), a = n(e.intAwayScore);
  return { home: h ?? 0, away: a ?? 0, done: done && h !== null && a !== null, detail: `TheSportsDB ${e.strEvent ?? ""} ${h ?? "?"}–${a ?? "?"} (${e.strStatus ?? "?"})`, url, pens: /^(AP|PEN)\b/i.test(String(e.strStatus ?? "")), declared: null };
}
export function finalFromMlb(g: Game, body: unknown, url: string): Final | null {
  const games = (((body as { dates?: { games?: unknown[] }[] } | null)?.dates ?? []).flatMap((d) => d.games ?? [])) as { gameDate?: string; status?: { abstractGameState?: string }; teams?: { home?: { team?: { name?: string }; score?: number }; away?: { team?: { name?: string }; score?: number } } }[];
  const hits = games.filter((x) => sideMatches(String(x.teams?.home?.team?.name ?? ""), g.home) && sideMatches(String(x.teams?.away?.team?.name ?? ""), g.away));
  const near = hits.filter((x) => Math.abs(Date.parse(String(x.gameDate)) - Date.parse(g.startsAt)) < 6 * 3_600_000);
  const hit = nearestStart(near.length ? near : hits, g.startsAt, (x) => x.gameDate);
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
  return { home: h ?? 0, away: a ?? 0, done: /^(FT|AET|PEN|AOT)$/.test(st) && h !== null && a !== null, detail: `API-Sports ${a ?? "?"}–${h ?? "?"} (${st || "?"})`, url, pens: st === "PEN", declared };
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
export async function crossFinal(client: EspnClient, g: Game, d: GameDeps, which: CrossId | null = null): Promise<{ id: CrossId; final: Final | null }> {
  const id = which ?? crossIdOf(g.league);
  const prevDay = new Date(Date.parse(`${g.date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (id === "mlb.statsapi") return { id, final: await firstFinal(client, [g.date, prevDay].map((day) => `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${day}`), (b, u) => finalFromMlb(g, b, u)) };
  if (id === "nhl.score") return { id, final: await firstFinal(client, [g.date, prevDay].map((day) => `https://api-web.nhle.com/v1/score/${day}`), (b, u) => finalFromNhl(g, b, u)) };
  if (id === "nba.cdn") return { id, final: await firstFinal(client, [NBA_SCHEDULE_URL], (b, u) => finalFromNba(g, b, u)) };
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
 * Settles one completed game. The PRIMARY is the on-chain payout where a market exists, else TheSportsDB's licensed final; the
 * on-chain payout and TheSportsDB are independent operators, so when both exist each confirms the other. The league's official feed
 * (MLB, NHL, NBA) is a further read where it is free, API-Sports where its key is set. At least TWO operators must read the game and
 * every read must agree (scores where both carry scores, else the winner); one operator alone is held.
 */
export async function settleGame(client: EspnClient, g: Game, d: GameDeps): Promise<GameVerdict> {
  type Read = { op: string; label: string; winner: "home" | "away" | "tie"; final: { home: number; away: number } | null; detail: string; url: string; pens?: boolean; declared?: "home" | "away" | null };
  const reads: Read[] = []; const pending: string[] = []; const errors: string[] = [];
  // the on-chain payout
  const market = d.market ? await d.market(g).catch(() => null) : null;
  if (market) {
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
      if (f && f.done) reads.push({ op: "TheSportsDB", label: "a licensed final score", winner: winnerOf(f), final: { home: f.home, away: f.away }, detail: f.detail, url: f.url, pens: f.pens, declared: f.declared });
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
      if (c.final && c.final.done) reads.push({ op: id, label: CROSS_LABEL[id], winner: winnerOf(c.final), final: { home: c.final.home, away: c.final.away }, detail: c.final.detail, url: c.final.url, pens: c.final.pens, declared: c.final.declared });
      else pending.push(`${CROSS_LABEL[id]} has no final for the game yet`);
    } catch (e) { errors.push(`${CROSS_LABEL[id]}: ${(e as Error).message.slice(0, 80)}`); }
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

const outcomeFor = (winner: "home" | "away" | "tie", g: Game, abbr: string, teamId: string | null): Outcome | "tie" | null => {
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
    if (out === s.outcome || (s.outcome === "draw" && out === "tie")) cur.value++;
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
/** Polymarket's tag slug per league (Gamma /events?tag_slug=): read 2026-10-13 against the live index; a league not here uses the text search only. */
export const POLY_LEAGUE_TAG: Partial<Record<LeagueId, string>> = { nfl: "nfl", mlb: "mlb", nba: "nba", nhl: "nhl", wnba: "wnba", cfb: "cfb", "eng.1": "epl", "esp.1": "la-liga", "ger.1": "bundesliga", "fra.1": "ligue-1", "ita.1": "serie-a", "usa.1": "mls" };

type GameHits = { events: { url: string; markets: { conditionId: string; question: string; yes: string; no: string; endDate: string | null; sportsMarketType: string | null }[] }[] };
export function polymarketGameReaders(poly: { search(q: string, o?: { status?: "open" | "closed" | "all"; limit?: number }): Promise<GameHits>; eventsInWindow?(slug: string, minIso: string, maxIso: string): Promise<GameHits>; readChain(conditionId: string): Promise<{ resolved: boolean; outcome: number | null }> }): Pick<GameDeps, "market" | "payout"> {
  type Hit = { url: string; markets: { conditionId: string; question: string; yes: string; no: string; endDate: string | null; sportsMarketType: string | null }[] };
  const pick = (events: readonly Hit[], g: Game): GameMarket | null => {
    for (const e of events) for (const m of e.markets) {
      if (m.sportsMarketType && m.sportsMarketType !== "moneyline") continue;
      const names = [m.yes, m.no];
      const both = names.some((x) => sideMatches(x, g.home)) && names.some((x) => sideMatches(x, g.away));
      const near = m.endDate ? Math.abs(Date.parse(m.endDate) - Date.parse(g.startsAt)) < 2 * 86_400_000 : false;
      if (both && near) return { conditionId: m.conditionId, question: m.question, outcomes: [m.yes, m.no], url: e.url };
    }
    return null;
  };
  return {
    market: async (g) => {
      // launch night 2026-10-13: the league's events in a window around the game's start first (the text search is capped at 10 hits and
      // older meetings of the same two teams crowd out the week's game: "Chiefs vs Raiders" missed nfl-kc-lv-2026-10-04)
      const tag = POLY_LEAGUE_TAG[g.league];
      if (tag && poly.eventsInWindow) {
        const start = Date.parse(g.startsAt);
        if (Number.isFinite(start)) {
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
