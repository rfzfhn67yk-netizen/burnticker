import type { SettledEvent } from "@/lib/burnticker/units";
import type { ResolvedSelector } from "@/lib/burnticker/oracle/types";
import { LEAGUES, SETTLE_AFTER_START_MS, gamesFor, tsdbNamePairs, windowStatus, type EspnClient, type EspnSeries, type Game, type GameSide, type LeagueId, type Outcome } from "@/lib/burnticker/sources/espn";

/**
 * HOW A TEAM COIN'S GAME SETTLES (owner, 2026-10-10: "good to go on the sports sources"). ESPN's scoreboard is DISCOVERY ONLY now — it
 * lists the games (which, when, who) and shows the next game and the record; its scores are never a settlement input. Each completed
 * game settles on
 *
 *   PRIMARY A  the game's ON-CHAIN PAYOUT: when Polymarket lists a moneyline market for the game (Gamma search by the two teams and the
 *              date → its condition id), the Conditional Tokens payout vector on Polygon names the winner — exactly as an election does;
 *   PRIMARY B  otherwise THESPORTSDB (commercial licence, BURNTICKER_THESPORTSDB_KEY, the v2 API): the game's final score;
 *   neither    → held and refused ("no primary"), never read from ESPN;
 *
 * and is CONFIRMED by an independent cross-read: the league's own official feed where one exists (MLB StatsAPI, the NHL score feed,
 * the NBA's cdn schedule), else a second licensed provider (API-Sports, BURNTICKER_APISPORTS_KEY) — without one the league's
 * cross-read is missing and its coins are refused at creation. Both reads must agree on the final (a score-based primary: the exact
 * score; the payout: the winner). Every reading says which source settled it: "settled on: on-chain payout · confirmed by MLB StatsAPI".
 */

export interface Final { home: number; away: number; done: boolean; detail: string; url: string }
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
/** The public ESPN game page — a plain human link on each game row and receipt, never fetched. */
export const espnGameUrl = (league: LeagueId, eventId: string): string => `https://www.espn.com/${LEAGUES[league].path.split("/")[1]}/game/_/gameId/${eventId}`;
/** The league's cross-read: its own official feed where one exists, else the second licensed provider. */
export const crossIdOf = (league: LeagueId): CrossId => (league === "mlb" ? "mlb.statsapi" : league === "nhl" ? "nhl.score" : league === "nba" ? "nba.cdn" : "apisports.games");
/** Whether the cross-read can be read on this host (API-Sports needs its key). */
export const crossAvailable = (league: LeagueId, d: Pick<GameDeps, "apiSportsKey">): boolean => crossIdOf(league) !== "apisports.games" || !!d.apiSportsKey;

// ---- finals from each reader --------------------------------------------------------------------------------------------------

const n = (v: unknown): number | null => { const x = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(x) ? null : x; };
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** A provider's team name matches a side when it contains the side's nickname, short name, location or full name (or the reverse). */
export const sideMatches = (name: string, s: GameSide): boolean => { const a = norm(name); return [s.name, s.nickname, s.short ?? "", s.location ?? "", s.abbr].filter((k) => k && k.length >= 3).some((k) => { const b = norm(k); return a === b || a.includes(b) || b.includes(a); }); };

export const tsdbV2Url = (names: [string, string]): string => `https://www.thesportsdb.com/api/v2/json/search/event/${encodeURIComponent(`${names[0]} vs ${names[1]}`.replace(/ /g, "_").toLowerCase())}`;
/** TheSportsDB v2 search/event: the event list under whichever key the API uses; the game's date (or the day before, UTC) and a final status. */
export function finalFromTsdb(g: Game, body: unknown, url: string): Final | null {
  const lists = body && typeof body === "object" ? Object.values(body as Record<string, unknown>).filter(Array.isArray) as Record<string, unknown>[][] : [];
  const evs = lists.flat().filter((e) => typeof e === "object" && e && "dateEvent" in e);
  const prev = new Date(Date.parse(`${g.date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const e = evs.find((x) => x.dateEvent === g.date) ?? evs.find((x) => x.dateEvent === prev);
  if (!e) return null;
  const done = /^(FT|AOT|AET|AP|PEN|Match Finished|Final)/i.test(String(e.strStatus ?? ""));
  const h = n(e.intHomeScore), a = n(e.intAwayScore);
  return { home: h ?? 0, away: a ?? 0, done: done && h !== null && a !== null, detail: `TheSportsDB ${e.strEvent ?? ""} ${h ?? "?"}–${a ?? "?"} (${e.strStatus ?? "?"})`, url };
}
export function finalFromMlb(g: Game, body: unknown, url: string): Final | null {
  const games = (((body as { dates?: { games?: unknown[] }[] } | null)?.dates ?? []).flatMap((d) => d.games ?? [])) as { gameDate?: string; status?: { abstractGameState?: string }; teams?: { home?: { team?: { name?: string }; score?: number }; away?: { team?: { name?: string }; score?: number } } }[];
  const hits = games.filter((x) => sideMatches(String(x.teams?.home?.team?.name ?? ""), g.home) && sideMatches(String(x.teams?.away?.team?.name ?? ""), g.away));
  const hit = hits.find((x) => Math.abs(Date.parse(String(x.gameDate)) - Date.parse(g.startsAt)) < 6 * 3_600_000) ?? hits[0];
  if (!hit) return null;
  const h = n(hit.teams?.home?.score), a = n(hit.teams?.away?.score);
  return { home: h ?? 0, away: a ?? 0, done: hit.status?.abstractGameState === "Final" && h !== null && a !== null, detail: `MLB StatsAPI ${a ?? "?"}–${h ?? "?"} (${hit.status?.abstractGameState ?? "?"})`, url };
}
export function finalFromNhl(g: Game, body: unknown, url: string): Final | null {
  const games = ((body as { games?: unknown[] } | null)?.games ?? []) as { gameState?: string; homeTeam?: { name?: { default?: string }; score?: number }; awayTeam?: { name?: { default?: string }; score?: number } }[];
  const hit = games.find((x) => sideMatches(String(x.homeTeam?.name?.default ?? ""), g.home) && sideMatches(String(x.awayTeam?.name?.default ?? ""), g.away));
  if (!hit) return null;
  const h = n(hit.homeTeam?.score), a = n(hit.awayTeam?.score);
  return { home: h ?? 0, away: a ?? 0, done: /^(OFF|FINAL)$/.test(String(hit.gameState)) && h !== null && a !== null, detail: `NHL ${a ?? "?"}–${h ?? "?"} (${hit.gameState ?? "?"})`, url };
}
export const NBA_SCHEDULE_URL = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json";
export function finalFromNba(g: Game, body: unknown, url: string): Final | null {
  const dates = ((body as { leagueSchedule?: { gameDates?: { games?: unknown[] }[] } } | null)?.leagueSchedule?.gameDates ?? []);
  const games = dates.flatMap((d) => d.games ?? []) as { gameDateTimeUTC?: string; gameStatus?: number; homeTeam?: { teamName?: string; teamCity?: string; teamTricode?: string; score?: number }; awayTeam?: { teamName?: string; teamCity?: string; teamTricode?: string; score?: number } }[];
  const nm = (t: { teamName?: string; teamCity?: string } | undefined) => `${t?.teamCity ?? ""} ${t?.teamName ?? ""}`.trim();
  const hit = games.find((x) => sideMatches(nm(x.homeTeam), g.home) && sideMatches(nm(x.awayTeam), g.away) && Math.abs(Date.parse(String(x.gameDateTimeUTC)) - Date.parse(g.startsAt)) < 12 * 3_600_000);
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
  const rows = ((body as { response?: unknown[] } | null)?.response ?? []) as { teams?: { home?: { name?: string }; away?: { name?: string } }; goals?: { home?: number; away?: number }; scores?: { home?: { total?: number } | number; away?: { total?: number } | number }; fixture?: { status?: { short?: string } }; status?: { short?: string } }[];
  const hit = rows.find((r) => sideMatches(String(r.teams?.home?.name ?? ""), g.home) && sideMatches(String(r.teams?.away?.name ?? ""), g.away));
  if (!hit) return null;
  const tot = (v: { total?: number } | number | undefined) => (typeof v === "number" ? v : v?.total);
  const h = n(hit.goals?.home ?? tot(hit.scores?.home)), a = n(hit.goals?.away ?? tot(hit.scores?.away));
  const st = String(hit.fixture?.status?.short ?? hit.status?.short ?? "");
  return { home: h ?? 0, away: a ?? 0, done: /^(FT|AET|PEN|AOT)$/.test(st) && h !== null && a !== null, detail: `API-Sports ${a ?? "?"}–${h ?? "?"} (${st || "?"})`, url };
}

// ---- one game, settled ----------------------------------------------------------------------------------------------------------

export type GameVerdict =
  | { kind: "settled"; winner: "home" | "away" | "tie"; final: { home: number; away: number } | null; settledOn: "on-chain payout" | "TheSportsDB"; confirmedBy: string; detail: string; url: string }
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
export async function crossFinal(client: EspnClient, g: Game, d: GameDeps): Promise<{ id: CrossId; final: Final | null }> {
  const id = crossIdOf(g.league);
  const prevDay = new Date(Date.parse(`${g.date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (id === "mlb.statsapi") return { id, final: await firstFinal(client, [g.date, prevDay].map((day) => `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${day}`), (b, u) => finalFromMlb(g, b, u)) };
  if (id === "nhl.score") return { id, final: await firstFinal(client, [g.date, prevDay].map((day) => `https://api-web.nhle.com/v1/score/${day}`), (b, u) => finalFromNhl(g, b, u)) };
  if (id === "nba.cdn") return { id, final: await firstFinal(client, [NBA_SCHEDULE_URL], (b, u) => finalFromNba(g, b, u)) };
  if (!d.apiSportsKey) throw new Error("cross-read missing: BURNTICKER_APISPORTS_KEY (a second licensed provider) is not set");
  return { id, final: await firstFinal(client, [g.date, prevDay].map((day) => apiSportsUrl(g.league, day)), (b, u) => finalFromApiSports(g, b, u), { "x-apisports-key": d.apiSportsKey }) };
}

/** Settles one completed game: primary (payout → TheSportsDB → none) and the cross-read must agree. Pure apart from the readers. */
export async function settleGame(client: EspnClient, g: Game, d: GameDeps): Promise<GameVerdict> {
  // PRIMARY
  let primary: { settledOn: "on-chain payout" | "TheSportsDB"; winner: "home" | "away" | "tie"; final: { home: number; away: number } | null; detail: string; url: string } | null = null;
  const market = d.market ? await d.market(g).catch(() => null) : null;
  if (market) {
    const p = d.payout ? await d.payout(market.conditionId).catch(() => null) : null;
    if (!p || !p.resolved) return { kind: "awaiting", why: `the on-chain payout for ${market.question} is not resolved yet` };
    const name = p.outcome === null ? null : market.outcomes[p.outcome];
    const winner = name === null ? "tie" : sideMatches(name, g.home) ? "home" : sideMatches(name, g.away) ? "away" : null;
    if (winner === null) return { kind: "held", why: `the payout names "${name}", which matches neither team` };
    primary = { settledOn: "on-chain payout", winner, final: null, detail: `on-chain payout ${market.question}: ${name ?? "split"}`, url: market.url };
  } else if (d.tsdbKey) {
    let f: Final | null = null;
    try { f = await firstFinal(client, tsdbNamePairs(g).map(tsdbV2Url), (b, u) => finalFromTsdb(g, b, u), { "X-API-KEY": d.tsdbKey }); } catch (e) { return { kind: "awaiting", why: `TheSportsDB could not be read: ${(e as Error).message.slice(0, 80)}` }; }
    if (!f || !f.done) return { kind: "awaiting", why: f ? `TheSportsDB has the game but not final: ${f.detail}` : "TheSportsDB has no final for the game yet" };
    primary = { settledOn: "TheSportsDB", winner: winnerOf(f), final: { home: f.home, away: f.away }, detail: f.detail, url: f.url };
  } else return { kind: "held", why: "no primary: no moneyline market for the game and BURNTICKER_THESPORTSDB_KEY (the commercial licence) is not set" };
  // CROSS-READ
  let cross: { id: CrossId; final: Final | null };
  try { cross = await crossFinal(client, g, d); } catch (e) { return { kind: "held", why: (e as Error).message.slice(0, 160) }; }
  if (!cross.final || !cross.final.done) return { kind: "awaiting", why: `${CROSS_LABEL[cross.id]} has no final for the game yet` };
  const agrees = primary.final ? primary.final.home === cross.final.home && primary.final.away === cross.final.away : primary.winner === winnerOf(cross.final);
  if (!agrees) return { kind: "held", why: `${primary.detail} ≠ ${cross.final.detail} — held` };
  return { kind: "settled", winner: primary.winner, final: primary.final ?? { home: cross.final.home, away: cross.final.away }, settledOn: primary.settledOn, confirmedBy: CROSS_LABEL[cross.id], detail: `${primary.detail}; ${cross.final.detail}`, url: primary.url };
}

const outcomeFor = (winner: "home" | "away" | "tie", g: Game, abbr: string, teamId: string | null): Outcome | "tie" | null => {
  const isUs = (x: GameSide) => (teamId && x.id ? x.id === teamId : x.abbr === abbr);
  const us = isUs(g.home) ? "home" : isUs(g.away) ? "away" : null;
  if (!us) return null;
  return winner === "tie" ? "tie" : winner === us ? "win" : "loss";
};

/** Settled readings for an ESPN-listed team or game series since `sinceIso` (the keeper; back-tests pass `crossRead: false` → display-grade only). */
export async function sportsSettled(client: EspnClient, s: EspnSeries, sinceIso: string | null, d: GameDeps, o: { nowMs?: number } = {}): Promise<ResolvedSelector> {
  const now = o.nowMs ?? Date.now();
  const all = await gamesFor(client, s, sinceIso);
  const games = all.filter((g) => !sinceIso || g.date > sinceIso.slice(0, 10));
  const tid = s.kind === "team" ? s.teamId : null;
  const byDay = new Map<string, { value: number; titles: string[]; url: string; method: string }>();
  let awaiting = 0; const refusals: string[] = [];
  for (const g of games) {
    if (!g.completed && g.state !== "post") continue;
    if (Date.parse(g.startsAt) + SETTLE_AFTER_START_MS > now) { awaiting++; continue; }
    const v = await settleGame(client, g, d);
    if (v.kind === "awaiting") { awaiting++; continue; }
    if (v.kind === "held") { const r = /^no primary|^cross-read missing/.test(v.why) ? v.why : `${g.eventId} ${g.name}: ${v.why}`; if (!refusals.includes(r)) refusals.push(r); continue; }
    const out = outcomeFor(v.winner, g, s.abbr, tid);
    if (out === null) continue;
    const cur = byDay.get(g.date) ?? { value: 0, titles: [], url: v.url, method: "" };
    if (out === s.outcome || (s.outcome === "draw" && out === "tie")) cur.value++;
    const score = v.final ? `${g.away.abbr} ${v.final.away} @ ${g.home.abbr} ${v.final.home}` : `${g.away.abbr} @ ${g.home.abbr}`;
    cur.titles.push(`${score} final (${out === "tie" ? "draw" : `${s.abbr} ${out}`}) · settled on ${SETTLED_ON[v.settledOn]} · confirmed by ${v.confirmedBy} · see this game on ESPN → ${espnGameUrl(g.league, g.eventId)}`);
    cur.method = `${v.settledOn === "on-chain payout" ? "onchain-payout" : "thesportsdb"}+${crossIdOf(g.league)}`;
    byDay.set(g.date, cur);
  }
  const events: SettledEvent[] = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, x]) => ({ id: date, at: date, result: null, value: String(x.value), title: x.titles.join(" · "), sourceUrl: x.url, method: x.method } as SettledEvent));
  const window = windowStatus(s, s.kind === "team" && s.window.kind === "post" ? await client.season(s.league, s.teamId ?? s.abbr, s.window.year).catch(() => all) : all, now);
  return { events, awaitingFinal: awaiting, refusals, settlementSourceUrl: null, window };
}

/**
 * PRIMARY A's readers over the Polymarket client: Gamma search by the two teams (closed and open), a moneyline market whose two outcomes
 * name the two teams and whose end falls within a day of the game; the payout from the CTF on Polygon (readChain).
 */
export function polymarketGameReaders(poly: { search(q: string, o?: { status?: "open" | "closed" | "all"; limit?: number }): Promise<{ events: { url: string; markets: { conditionId: string; question: string; yes: string; no: string; endDate: string | null; sportsMarketType: string | null }[] }[] }>; readChain(conditionId: string): Promise<{ resolved: boolean; outcome: number | null }> }): Pick<GameDeps, "market" | "payout"> {
  return {
    market: async (g) => {
      const r = await poly.search(`${g.away.nickname || g.away.name} vs ${g.home.nickname || g.home.name}`, { status: "all", limit: 10 });
      for (const e of r.events) for (const m of e.markets) {
        if (m.sportsMarketType && m.sportsMarketType !== "moneyline") continue;
        const names = [m.yes, m.no];
        const both = names.some((x) => sideMatches(x, g.home)) && names.some((x) => sideMatches(x, g.away));
        const near = m.endDate ? Math.abs(Date.parse(m.endDate) - Date.parse(g.startsAt)) < 2 * 86_400_000 : false;
        if (both && near) return { conditionId: m.conditionId, question: m.question, outcomes: [m.yes, m.no], url: e.url };
      }
      return null;
    },
    payout: async (id) => { const c = await poly.readChain(id); return { resolved: c.resolved, outcome: c.outcome }; },
  };
}
