import type { BurnRule } from "@/lib/burnticker/rules";
import type { SettledEvent } from "@/lib/burnticker/units";
import type { FetchLike, ResolvedSelector } from "@/lib/burnticker/oracle/types";
import { TEAM_ALIASES, aliasLookup, type TeamAlias } from "@/lib/burnticker/oracle/events";

/**
 * THE ESPN SCOREBOARD ADAPTER (tier 4, first-party; 2026-10-10 — team coins and matchups no longer depend on Kalshi). It reads a team's
 * season from ESPN's public scoreboard API and counts, per game day, whether the team won or lost. A result is read into a reading only
 * after a SECOND, independent cross-read agrees on the final score:
 *
 *   NHL  the league's own score feed   api-web.nhle.com/v1/score/<date>
 *   MLB  the league's own StatsAPI     statsapi.mlb.com/api/v1/schedule?sportId=1&date=<date>
 *   NFL  TheSportsDB event search      thesportsdb.com/api/v1/json/<key>/searchevents.php (a second public scoreboard; key from
 *   NBA                                 BURNTICKER_THESPORTSDB_KEY, else the free test key "123", which returns a limited set)
 *
 * Disagreement holds the game and is reported as a refusal; a cross-read that cannot find the game holds it as "awaiting cross-read"
 * (counted in awaitingFinal). A game is read no sooner than 6 h after its start. Terms: ESPN's endpoint is public but undocumented
 * (sources.json espn.nfl carries the flag); TheSportsDB's free key is for testing — both are named on every card.
 *
 * SERIES (catalogue ids; scalar, unit 1, baseline 0, direction up — one unit per qualifying game):
 *   espn.team:<league>-<ABBR>-<win|loss>          every game of the team this season: value = games won (or lost) that UTC day
 *   espn.game:<league>-<eventId>-<ABBR>-<win|loss> one game: value 1 if the team won (or lost) it (a tie burns neither side)
 * Readings are keyed by the game's UTC start date ("2026-10-04"); a doubleheader counts 2.
 */

export type LeagueId = "nfl" | "nba" | "mlb" | "nhl";
export interface League { id: LeagueId; label: string; path: string; alias: "NFL" | "NBA" | "MLB" | "NHL"; cross: "thesportsdb" | "nhl" | "mlb"; crossLabel: string }
export const LEAGUES: Record<LeagueId, League> = {
  nfl: { id: "nfl", label: "NFL", path: "football/nfl", alias: "NFL", cross: "thesportsdb", crossLabel: "TheSportsDB" },
  nba: { id: "nba", label: "NBA", path: "basketball/nba", alias: "NBA", cross: "thesportsdb", crossLabel: "TheSportsDB" },
  mlb: { id: "mlb", label: "MLB", path: "baseball/mlb", alias: "MLB", cross: "mlb", crossLabel: "MLB StatsAPI" },
  nhl: { id: "nhl", label: "NHL", path: "hockey/nhl", alias: "NHL", cross: "nhl", crossLabel: "NHL score feed" },
};
export const isLeague = (x: string): x is LeagueId => x in LEAGUES;

/** ESPN's abbreviations where they differ from the alias table's (checked against ESPN's /teams lists on 2026-10-10). */
const ESPN_ABBR: Record<League["alias"], Record<string, string>> = {
  NFL: { JAC: "JAX", WAS: "WSH" },
  NBA: { GSW: "GS", NOP: "NO", NYK: "NY", SAS: "SA", UTA: "UTAH", WAS: "WSH" },
  MLB: { CWS: "CHW" },
  NHL: { UTA: "UTAH" },
};

export interface EspnTeam { league: LeagueId; abbr: string; city: string; nickname: string; name: string; ticker: string; alt: string[] }
const toTeam = (league: LeagueId, a: TeamAlias): EspnTeam => ({ league, abbr: ESPN_ABBR[LEAGUES[league].alias][a.abbr] ?? a.abbr, city: a.city, nickname: a.nickname, name: `${a.city} ${a.nickname}`, ticker: a.nickname.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10), alt: [a.abbr, ...a.alt] });
/** The static team table per league (the alias table built for event search, with ESPN's abbreviations). */
export function teamsOf(league: LeagueId): EspnTeam[] { return TEAM_ALIASES.filter((a) => a.league === LEAGUES[league].alias).map((a) => toTeam(league, a)); }
export function teamByAbbr(league: LeagueId, abbr: string): EspnTeam | null { return teamsOf(league).find((t) => t.abbr === abbr.toUpperCase() || t.alt.includes(abbr.toUpperCase())) ?? null; }
/** Teams a free-text query names (nickname, city, abbreviation, alternative), across the four leagues. */
export function findTeams(q: string): EspnTeam[] {
  return aliasLookup(q).map((a) => { const lg = (Object.values(LEAGUES).find((l) => l.alias === a.league)?.id ?? null); return lg ? toTeam(lg, a) : null; }).filter((t): t is EspnTeam => t !== null);
}

// ---- series ids --------------------------------------------------------------------------------------------------------------

export type Outcome = "win" | "loss";
export type EspnSeries = { kind: "team"; league: LeagueId; abbr: string; outcome: Outcome } | { kind: "game"; league: LeagueId; eventId: string; abbr: string; outcome: Outcome };
export const teamSeries = (league: LeagueId, abbr: string, outcome: Outcome): string => `espn.team:${league}-${abbr.toUpperCase()}-${outcome}`;
export const gameSeries = (league: LeagueId, eventId: string, abbr: string, outcome: Outcome): string => `espn.game:${league}-${eventId}-${abbr.toUpperCase()}-${outcome}`;
export function parseEspnSeries(id: string): EspnSeries | null {
  let m = /^espn\.team:(nfl|nba|mlb|nhl)-([A-Z]{2,5})-(win|loss)$/.exec(id);
  if (m) return teamByAbbr(m[1] as LeagueId, m[2]) ? { kind: "team", league: m[1] as LeagueId, abbr: m[2], outcome: m[3] as Outcome } : null;
  m = /^espn\.game:(nfl|nba|mlb|nhl)-(\d{4,12})-([A-Z]{2,5})-(win|loss)$/.exec(id);
  if (m) return teamByAbbr(m[1] as LeagueId, m[3]) ? { kind: "game", league: m[1] as LeagueId, eventId: m[2], abbr: m[3], outcome: m[4] as Outcome } : null;
  return null;
}
export function espnSeriesTitle(s: EspnSeries): string {
  const t = teamByAbbr(s.league, s.abbr)!;
  return s.kind === "team" ? `${t.name} ${s.outcome === "win" ? "wins" : "losses"} (${LEAGUES[s.league].label})` : `${t.name} ${s.outcome === "win" ? "win" : "loss"} in ESPN game ${s.eventId}`;
}

// ---- parsing ESPN ---------------------------------------------------------------------------------------------------------

export interface GameSide { abbr: string; name: string; nickname: string; score: number | null; homeAway: "home" | "away"; record: string | null }
export interface Game { eventId: string; league: LeagueId; startsAt: string; date: string; name: string; completed: boolean; state: string; detail: string; home: GameSide; away: GameSide }

const num = (v: unknown): number | null => { const x = typeof v === "object" && v !== null ? (v as { value?: unknown }).value : v; const n = Number(x); return x === null || x === undefined || x === "" || !Number.isFinite(n) ? null : n; };
function parseEvent(league: LeagueId, raw: unknown): Game | null {
  const e = raw as { id?: string; date?: string; name?: string; competitions?: { status?: { type?: { completed?: boolean; state?: string; shortDetail?: string } }; competitors?: { homeAway?: string; score?: unknown; team?: { abbreviation?: string; displayName?: string; name?: string; shortDisplayName?: string }; records?: { type?: string; summary?: string }[]; record?: { type?: string; displayValue?: string }[] }[] }[]; status?: { type?: { completed?: boolean; state?: string; shortDetail?: string } } } | null;
  const c = e?.competitions?.[0];
  if (!e?.id || !e.date || !c?.competitors || c.competitors.length !== 2) return null;
  const st = c.status?.type ?? e.status?.type ?? {};
  const side = (x: NonNullable<typeof c.competitors>[number]): GameSide => ({ abbr: String(x.team?.abbreviation ?? "").toUpperCase(), name: String(x.team?.displayName ?? ""), nickname: String(x.team?.name ?? x.team?.shortDisplayName ?? ""), score: num(x.score), homeAway: x.homeAway === "home" ? "home" : "away", record: x.records?.find((r) => r.type === "total")?.summary ?? x.record?.find((r) => r.type === "total")?.displayValue ?? null });
  const home = c.competitors.find((x) => x.homeAway === "home"), away = c.competitors.find((x) => x.homeAway !== "home");
  if (!home || !away) return null;
  const startsAt = /Z$/.test(e.date) && e.date.length === 17 ? e.date.replace("Z", ":00Z") : e.date;
  return { eventId: e.id, league, startsAt, date: startsAt.slice(0, 10), name: String(e.name ?? ""), completed: !!st.completed && st.state === "post", state: String(st.state ?? ""), detail: String(st.shortDetail ?? ""), home: side(home), away: side(away) };
}
/** A team schedule or a scoreboard body → games. */
export function parseGames(league: LeagueId, body: unknown): Game[] {
  const evs = (body as { events?: unknown[] } | null)?.events;
  return Array.isArray(evs) ? evs.map((x) => parseEvent(league, x)).filter((g): g is Game => g !== null) : [];
}
/** A team's outcome in a completed game, or null (not completed, not its game, or no scores). Ties are neither win nor loss. */
export function outcomeOf(g: Game, abbr: string): Outcome | "tie" | null {
  const us = g.home.abbr === abbr ? g.home : g.away.abbr === abbr ? g.away : null;
  const them = us === g.home ? g.away : g.home;
  if (!us || !g.completed || us.score === null || them.score === null) return null;
  return us.score > them.score ? "win" : us.score < them.score ? "loss" : "tie";
}

// ---- cross-reads ----------------------------------------------------------------------------------------------------------

export type CrossVerdict = { verdict: "agree" | "disagree" | "unavailable"; detail: string; url: string };
const scoresMatch = (g: Game, home: number | null, away: number | null) => home !== null && away !== null && home === g.home.score && away === g.away.score;
const prevDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export const tsdbUrl = (key: string, g: Game): string => `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}/searchevents.php?e=${encodeURIComponent(`${g.home.name} vs ${g.away.name}`.replace(/ /g, "_"))}&d=${g.date}`;
export const nhlScoreUrl = (date: string): string => `https://api-web.nhle.com/v1/score/${date}`;
export const mlbScheduleUrl = (date: string): string => `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`;

export function crossFromTsdb(g: Game, body: unknown, url: string): CrossVerdict {
  const ev = ((body as { event?: unknown[] } | null)?.event ?? []) as { intHomeScore?: string | null; intAwayScore?: string | null; strStatus?: string; dateEvent?: string }[];
  const done = ev.find((e) => /^(FT|AOT|AET|AP|Match Finished|Final)/i.test(String(e.strStatus ?? "")));
  if (!done) return { verdict: "unavailable", detail: ev.length ? `TheSportsDB has the game but not final (${ev[0].strStatus ?? "?"})` : "TheSportsDB has no such game", url };
  return scoresMatch(g, num(done.intHomeScore), num(done.intAwayScore)) ? { verdict: "agree", detail: `TheSportsDB final ${done.intHomeScore}–${done.intAwayScore}`, url } : { verdict: "disagree", detail: `TheSportsDB final ${done.intHomeScore}–${done.intAwayScore} ≠ ESPN ${g.home.score}–${g.away.score}`, url };
}
export function crossFromNhl(g: Game, body: unknown, url: string): CrossVerdict {
  const games = ((body as { games?: unknown[] } | null)?.games ?? []) as { gameState?: string; homeTeam?: { name?: { default?: string }; score?: number }; awayTeam?: { name?: { default?: string }; score?: number } }[];
  const hit = games.find((x) => x.homeTeam?.name?.default?.toLowerCase() === g.home.nickname.toLowerCase() && x.awayTeam?.name?.default?.toLowerCase() === g.away.nickname.toLowerCase());
  if (!hit) return { verdict: "unavailable", detail: "not in the NHL score feed for that date", url };
  if (!/^(OFF|FINAL)$/.test(String(hit.gameState))) return { verdict: "unavailable", detail: `NHL feed state ${hit.gameState}`, url };
  return scoresMatch(g, num(hit.homeTeam?.score), num(hit.awayTeam?.score)) ? { verdict: "agree", detail: `NHL final ${hit.homeTeam?.score}–${hit.awayTeam?.score}`, url } : { verdict: "disagree", detail: `NHL final ${hit.homeTeam?.score}–${hit.awayTeam?.score} ≠ ESPN ${g.home.score}–${g.away.score}`, url };
}
export function crossFromMlb(g: Game, body: unknown, url: string): CrossVerdict {
  const games = (((body as { dates?: { games?: unknown[] }[] } | null)?.dates ?? []).flatMap((d) => d.games ?? [])) as { gameDate?: string; status?: { abstractGameState?: string }; teams?: { home?: { team?: { name?: string }; score?: number }; away?: { team?: { name?: string }; score?: number } } }[];
  const hits = games.filter((x) => x.teams?.home?.team?.name === g.home.name && x.teams?.away?.team?.name === g.away.name);
  const hit = hits.find((x) => Math.abs(Date.parse(String(x.gameDate)) - Date.parse(g.startsAt)) < 6 * 3_600_000) ?? hits[0];
  if (!hit) return { verdict: "unavailable", detail: "not in MLB StatsAPI for that date", url };
  if (hit.status?.abstractGameState !== "Final") return { verdict: "unavailable", detail: `MLB state ${hit.status?.abstractGameState}`, url };
  return scoresMatch(g, num(hit.teams?.home?.score), num(hit.teams?.away?.score)) ? { verdict: "agree", detail: `MLB final ${hit.teams?.home?.score}–${hit.teams?.away?.score}`, url } : { verdict: "disagree", detail: `MLB final ${hit.teams?.home?.score}–${hit.teams?.away?.score} ≠ ESPN ${g.home.score}–${g.away.score}`, url };
}

// ---- the client -----------------------------------------------------------------------------------------------------------

export const ESPN_API = "https://site.api.espn.com/apis/site/v2/sports";
/** ESPN refuses a User-Agent carrying a URL (403 on 10-10); the plain product token passes. */
export const ESPN_UA = "burnticker/0.1";
export const scheduleUrl = (league: LeagueId, abbr: string, seasonType: 2 | 3 = 2): string => `${ESPN_API}/${LEAGUES[league].path}/teams/${abbr.toLowerCase()}/schedule${seasonType === 3 ? "?seasontype=3" : ""}`;
export const scoreboardUrl = (league: LeagueId, yyyymmdd: string): string => `${ESPN_API}/${LEAGUES[league].path}/scoreboard?dates=${yyyymmdd}`;
export const SETTLE_AFTER_START_MS = 6 * 3_600_000;

export interface EspnClientOpts { fetchImpl?: FetchLike; now?: () => number; minIntervalMs?: number; ttlMs?: number; tsdbKey?: string }

export class EspnClient {
  private fetchImpl: FetchLike; private now: () => number; private minInterval: number; private ttl: number; readonly tsdbKey: string;
  private cache = new Map<string, { at: number; body: unknown }>(); private lastAt = 0; private chain: Promise<void> = Promise.resolve();
  requests: string[] = [];
  constructor(o: EspnClientOpts = {}) {
    this.fetchImpl = o.fetchImpl ?? (fetch as unknown as FetchLike); this.now = o.now ?? (() => Date.now()); this.minInterval = o.minIntervalMs ?? 250; this.ttl = o.ttlMs ?? 600_000;
    this.tsdbKey = (o.tsdbKey ?? process.env.BURNTICKER_THESPORTSDB_KEY ?? "").trim() || "123";
  }
  async get(url: string): Promise<unknown> {
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.at < this.ttl) return hit.body;
    const run = async () => {
      const wait = this.lastAt + this.minInterval - this.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastAt = this.now(); this.requests.push(url);
      const res = await this.fetchImpl(url, { headers: { accept: "application/json", "user-agent": ESPN_UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.replace(/\/json\/[^/]+\//, "/json/<key>/").slice(0, 120)}`);
      const body = await res.json(); this.cache.set(url, { at: this.now(), body }); return body;
    };
    const p = this.chain.then(run, run); this.chain = p.then(() => undefined, () => undefined); return p;
  }
  /** A team's season (regular season, plus the postseason when ESPN lists one). */
  async season(league: LeagueId, abbr: string): Promise<Game[]> {
    const reg = parseGames(league, await this.get(scheduleUrl(league, abbr, 2)));
    const post = await this.get(scheduleUrl(league, abbr, 3)).then((b) => parseGames(league, b)).catch(() => [] as Game[]);
    const seen = new Set<string>();
    return [...reg, ...post].filter((g) => (seen.has(g.eventId) ? false : (seen.add(g.eventId), true))).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
  /** Games on the next `days` days (one scoreboard request per day, cached), for the matchup picker and the team picker's next game. */
  async upcoming(league: LeagueId, days = 7): Promise<Game[]> {
    const out: Game[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(this.now() + i * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
      try { out.push(...parseGames(league, await this.get(scoreboardUrl(league, d)))); } catch { /* a day ESPN will not serve: skip */ }
    }
    const seen = new Set<string>();
    return out.filter((g) => (seen.has(g.eventId) ? false : (seen.add(g.eventId), true)));
  }
  async crossRead(g: Game): Promise<CrossVerdict> {
    const L = LEAGUES[g.league];
    try {
      if (L.cross === "nhl") {
        for (const d of [g.date, prevDay(g.date)]) { const url = nhlScoreUrl(d); const v = crossFromNhl(g, await this.get(url), url); if (v.verdict !== "unavailable") return v; }
        return { verdict: "unavailable", detail: "not in the NHL score feed", url: nhlScoreUrl(g.date) };
      }
      if (L.cross === "mlb") {
        for (const d of [g.date, prevDay(g.date)]) { const url = mlbScheduleUrl(d); const v = crossFromMlb(g, await this.get(url), url); if (v.verdict !== "unavailable") return v; }
        return { verdict: "unavailable", detail: "not in MLB StatsAPI", url: mlbScheduleUrl(g.date) };
      }
      const url = tsdbUrl(this.tsdbKey, g);
      return crossFromTsdb(g, await this.get(url), url.replace(`/json/${encodeURIComponent(this.tsdbKey)}/`, "/json/<key>/"));
    } catch (e) { return { verdict: "unavailable", detail: `cross-read failed: ${(e as Error).message.slice(0, 80)}`, url: "" }; }
  }
}

/**
 * Settled readings for an ESPN series since `sinceIso` (a "YYYY-MM-DD" period key, or null). `crossRead: false` (back-tests only:
 * display-grade) skips the second read; the keeper always cross-reads.
 */
export async function espnSettled(client: EspnClient, s: EspnSeries, sinceIso: string | null, o: { crossRead?: boolean; nowMs?: number } = {}): Promise<ResolvedSelector> {
  const now = o.nowMs ?? Date.now();
  const games = (await client.season(s.league, s.abbr)).filter((g) => (s.kind === "game" ? g.eventId === s.eventId : true) && (!sinceIso || g.date > sinceIso.slice(0, 10)));
  const byDay = new Map<string, { value: number; titles: string[]; url: string }>();
  let awaiting = 0; const refusals: string[] = [];
  for (const g of games) {
    const out = outcomeOf(g, s.abbr);
    if (out === null) { if (g.completed) awaiting++; continue; }
    if (Date.parse(g.startsAt) + SETTLE_AFTER_START_MS > now) { awaiting++; continue; }
    let crossText = "cross-read skipped (back-test)";
    if (o.crossRead !== false) {
      const v = await client.crossRead(g);
      if (v.verdict === "disagree") { refusals.push(`${g.eventId}: ${v.detail} — held`); continue; }
      if (v.verdict === "unavailable") { awaiting++; continue; }
      crossText = v.detail;
    }
    const cur = byDay.get(g.date) ?? { value: 0, titles: [], url: `https://www.espn.com/${s.league}/game/_/gameId/${g.eventId}` };
    if (out === s.outcome) cur.value++;
    cur.titles.push(`${g.away.abbr} ${g.away.score} @ ${g.home.abbr} ${g.home.score} final (${out === "tie" ? "tie" : `${s.abbr} ${out}`}; ${crossText})`);
    byDay.set(g.date, cur);
  }
  const events: SettledEvent[] = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ id: date, at: date, result: null, value: String(d.value), title: d.titles.join(" · "), sourceUrl: d.url, method: `espn-final+${LEAGUES[s.league].cross}` } as SettledEvent));
  return { events, awaitingFinal: awaiting, refusals, settlementSourceUrl: `${ESPN_API}/${LEAGUES[s.league].path}` };
}

/** True when the rule is an ESPN catalogue rule. */
export const isEspnRule = (r: Pick<BurnRule, "oracle" | "series">): boolean => r.oracle === "catalogue" && !!r.series && /^espn\.(team|game):/.test(r.series);
