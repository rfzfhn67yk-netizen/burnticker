import type { BurnRule } from "@/lib/burnticker/rules";
import type { SettledEvent } from "@/lib/burnticker/units";
import type { FetchLike, ResolvedSelector } from "@/lib/burnticker/oracle/types";
import { TEAM_ALIASES, aliasLookup, type TeamAlias } from "@/lib/burnticker/oracle/events";
import { TEAM_IDS } from "@/lib/burnticker/sources/teamColors";
import ESPN_TEAMS from "../../../../config/burnticker/espn-teams.json" with { type: "json" };

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
 *   espn.team:<league>-<ABBR>.<ID>-<win|loss>-<window>   a team coin, the team PINNED BY ITS ESPN TEAM ID (a rename or relocation keeps
 *                                                  the coin on the same team; the abbreviation is only for reading). The window is in
 *                                                  the series, so it is in the rules hash:
 *       s<YYYY>        this season: ESPN season YYYY, regular season (type 2) and postseason (type 3); ends with the team's last game
 *                      of that season (windowStatus), then the rules-core wind-down (onEnd) retires the coin
 *       p<YYYY>        that season's postseason only
 *       n<N>.<YYYYMMDD> the team's next N games (1–20) starting on that UTC date, across a season boundary if it comes to that
 *       perpetual      every game, every season, no end date: off-season days read nothing (the pool keeps filling) and readings
 *                      resume with the next season's first game — this coin does not retire
 *   espn.team:<league>-<ABBR>-<win|loss>[-reg|-post]  the 10-10 first form (still read): this season by abbreviation
 *   espn.game:<league>-<eventId>-<ABBR>-<win|loss> one game: value 1 if the team won (or lost) it (a tie burns neither side)
 * Readings are keyed by the game's UTC start date ("2026-10-04"); a doubleheader counts 2.
 */

/**
 * EVERY TEAM-SPORT LEAGUE ESPN'S SCOREBOARD SERVES (the owner, 2026-10-10: "all inclusive: MLB, NBA, NHL, soccer leagues, really all
 * leagues" — never NFL-first). Each league names its cross-read: the league's own feed where one is public and keyless (MLB StatsAPI,
 * the NHL score feed), else TheSportsDB's event search (a second, independent operator; free test key unless
 * BURNTICKER_THESPORTSDB_KEY is set), which covers the NBA, NFL, WNBA, college football and basketball and the soccer leagues below. A
 * league without a keyless cross-read would be listed with `cross: null` ("cross-read missing") and refused by the creation gate — none
 * today. Soccer has draws: a soccer coin's side is win / loss / draw (default a win). Teams beyond the four alias-table leagues come from
 * ESPN's /teams lists frozen in config/burnticker/espn-teams.json.
 */
export type Sport = "baseball" | "basketball" | "hockey" | "soccer" | "football";
export type LeagueId = "mlb" | "nba" | "wnba" | "nhl" | "nfl" | "cfb" | "mcbb" | "wcbb"
  | "eng.1" | "esp.1" | "ita.1" | "ger.1" | "fra.1" | "uefa.champions" | "uefa.europa" | "uefa.europa.conf" | "mex.1" | "usa.1" | "usa.nwsl" | "ned.1" | "por.1" | "eng.2" | "sco.1" | "bra.1" | "arg.1";
/** How a league names a season that spans two calendar years: by its later year (NBA 2027 = 2026–27) or its earlier one (European soccer). */
export type SeasonSpan = "single" | "later" | "earlier";
export interface League { id: LeagueId; label: string; path: string; sport: Sport; alias: "NFL" | "NBA" | "MLB" | "NHL" | null; cross: "thesportsdb" | "nhl" | "mlb" | null; crossLabel: string; draws: boolean; span: SeasonSpan }
const tsdb = { cross: "thesportsdb" as const, crossLabel: "TheSportsDB" };
const soccer = (id: LeagueId, label: string, span: SeasonSpan = "earlier"): League => ({ id, label, path: `soccer/${id}`, sport: "soccer", alias: null, ...tsdb, draws: true, span });
export const LEAGUES: Record<LeagueId, League> = {
  mlb: { id: "mlb", label: "MLB", path: "baseball/mlb", sport: "baseball", alias: "MLB", cross: "mlb", crossLabel: "MLB StatsAPI", draws: false, span: "single" },
  nba: { id: "nba", label: "NBA", path: "basketball/nba", sport: "basketball", alias: "NBA", ...tsdb, draws: false, span: "later" },
  wnba: { id: "wnba", label: "WNBA", path: "basketball/wnba", sport: "basketball", alias: null, ...tsdb, draws: false, span: "single" },
  mcbb: { id: "mcbb", label: "NCAA men's basketball", path: "basketball/mens-college-basketball", sport: "basketball", alias: null, ...tsdb, draws: false, span: "later" },
  wcbb: { id: "wcbb", label: "NCAA women's basketball", path: "basketball/womens-college-basketball", sport: "basketball", alias: null, ...tsdb, draws: false, span: "later" },
  nhl: { id: "nhl", label: "NHL", path: "hockey/nhl", sport: "hockey", alias: "NHL", cross: "nhl", crossLabel: "NHL score feed", draws: false, span: "later" },
  "eng.1": soccer("eng.1", "Premier League"), "esp.1": soccer("esp.1", "La Liga"), "ita.1": soccer("ita.1", "Serie A"), "ger.1": soccer("ger.1", "Bundesliga"), "fra.1": soccer("fra.1", "Ligue 1"),
  "uefa.champions": soccer("uefa.champions", "UEFA Champions League"), "uefa.europa": soccer("uefa.europa", "UEFA Europa League"), "uefa.europa.conf": soccer("uefa.europa.conf", "UEFA Conference League"),
  "usa.1": soccer("usa.1", "MLS", "single"), "usa.nwsl": soccer("usa.nwsl", "NWSL", "single"), "mex.1": soccer("mex.1", "Liga MX"), "ned.1": soccer("ned.1", "Eredivisie"), "por.1": soccer("por.1", "Primeira Liga"),
  "eng.2": soccer("eng.2", "EFL Championship"), "sco.1": soccer("sco.1", "Scottish Premiership"), "bra.1": soccer("bra.1", "Brasileirão", "single"), "arg.1": soccer("arg.1", "Argentine Primera", "single"),
  nfl: { id: "nfl", label: "NFL", path: "football/nfl", sport: "football", alias: "NFL", ...tsdb, draws: false, span: "single" },
  cfb: { id: "cfb", label: "College football", path: "football/college-football", sport: "football", alias: null, ...tsdb, draws: false, span: "single" },
};
export const isLeague = (x: string): x is LeagueId => Object.prototype.hasOwnProperty.call(LEAGUES, x);
/** The sports in the order the pickers list them (no sport first by habit: alphabetical). */
export const SPORTS: { id: Sport; label: string }[] = [{ id: "baseball", label: "Baseball" }, { id: "basketball", label: "Basketball" }, { id: "football", label: "Football" }, { id: "hockey", label: "Hockey" }, { id: "soccer", label: "Soccer" }];
const LEAGUE_ALT = Object.keys(LEAGUES).sort((a, b) => b.length - a.length).map((k) => k.replace(/\./g, "\\.")).join("|");

/** ESPN's abbreviations where they differ from the alias table's (checked against ESPN's /teams lists on 2026-10-10). */
const ESPN_ABBR: Record<"NFL" | "NBA" | "MLB" | "NHL", Record<string, string>> = {
  NFL: { JAC: "JAX", WAS: "WSH" },
  NBA: { GSW: "GS", NOP: "NO", NYK: "NY", SAS: "SA", UTA: "UTAH", WAS: "WSH" },
  MLB: { CWS: "CHW" },
  NHL: { UTA: "UTAH" },
};
interface FrozenTeam { id: string; abbr: string; name: string; short: string; location: string; nickname: string; color: string; alt: string }
const FROZEN = (ESPN_TEAMS as unknown as { leagues: Record<string, FrozenTeam[]> }).leagues;

export interface EspnTeam { league: LeagueId; abbr: string; city: string; nickname: string; name: string; ticker: string; alt: string[]; id?: string | null; colors?: [string, string] | null; /** a college team is named only by its full name or its mascot ("Michigan" alone is a state, not a team) */ strictKeys?: string[] | null }
const toTeam = (league: LeagueId, a: TeamAlias): EspnTeam => ({ league, abbr: ESPN_ABBR[LEAGUES[league].alias!][a.abbr] ?? a.abbr, city: a.city, nickname: a.nickname, name: `${a.city} ${a.nickname}`, ticker: a.nickname.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10), alt: [a.abbr, ...a.alt] });
/** A frozen ESPN team: the short name ("Arsenal", "Inter Miami", "Georgia") is what people say; the nickname alone is ambiguous in college. */
/** "Inter Miami CF" → "Inter Miami", "AFC Bournemouth" → "Bournemouth": the club name people say. */
export const clubName = (n: string): string => n.replace(/^(AFC|FC|CF|SC|CD|CA|AC|AS|SS|SSC|US|RC|RCD)\s+|\s+(FC|CF|SC|AFC)$/g, "").trim() || n;
/** Leagues whose season is the competition alone (no playoffs: European leagues, the UEFA cups). */
export const noPlayoffs = (league: LeagueId): boolean => LEAGUES[league].sport === "soccer" && LEAGUES[league].span === "earlier";
const fromFrozen = (league: LeagueId, f: FrozenTeam): EspnTeam => {
  const soccerLike = LEAGUES[league].sport === "soccer";
  const nickname = soccerLike ? clubName(f.name || f.short) : LEAGUES[league].alias === null && (league === "cfb" || league === "mcbb" || league === "wcbb") ? (f.location || f.short) : (f.nickname || f.short);
  const college = league === "cfb" || league === "mcbb" || league === "wcbb";
  return { league, abbr: f.abbr, city: f.location, nickname, name: f.name, ticker: nickname.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10), alt: [...new Set([f.abbr, f.short, f.name, f.location, soccerLike ? clubName(f.name) : ""].filter(Boolean))], id: f.id, colors: [f.color, f.alt], strictKeys: college ? [f.name, `${f.location} ${league === "cfb" ? "football" : "basketball"}`].filter(Boolean) : null };
};
const teamCache = new Map<LeagueId, EspnTeam[]>();
/** The static team table per league: the alias table (with ESPN's abbreviations) for MLB, NBA, NHL, NFL; ESPN's frozen lists for the rest. */
export function teamsOf(league: LeagueId): EspnTeam[] {
  const hit = teamCache.get(league);
  if (hit) return hit;
  const L = LEAGUES[league];
  const out = L.alias ? TEAM_ALIASES.filter((a) => a.league === L.alias).map((a) => toTeam(league, a)) : (FROZEN[league] ?? []).map((f) => fromFrozen(league, f));
  teamCache.set(league, out);
  return out;
}
export function teamByAbbr(league: LeagueId, abbr: string): EspnTeam | null { const A = abbr.toUpperCase(); return teamsOf(league).find((t) => t.abbr === A) ?? teamsOf(league).find((t) => t.alt.includes(A)) ?? null; }
const normQ = (s: string) => ` ${s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
/** Teams a free-text query names (nickname, city, abbreviation, alternative), across every league. */
export function findTeams(q: string): EspnTeam[] {
  const fromAlias = aliasLookup(q).map((a) => { const lg = (Object.values(LEAGUES).find((l) => l.alias === a.league)?.id ?? null); return lg ? toTeam(lg, a) : null; }).filter((t): t is EspnTeam => t !== null);
  const n = normQ(q);
  const fromFrozen: EspnTeam[] = [];
  for (const lg of Object.keys(LEAGUES) as LeagueId[]) {
    if (LEAGUES[lg].alias) continue;
    for (const t of teamsOf(lg)) {
      const keys = t.strictKeys ?? [t.name, t.nickname, ...t.alt.filter((x) => x.length >= 4)];
      if (keys.some((k) => k && n.includes(normQ(k)))) fromFrozen.push(t);
    }
  }
  // a pro team first; the longest matched name first among the rest (so "Inter Miami" beats "Miami")
  const score = (t: EspnTeam) => Math.max(...[t.name, t.nickname, ...t.alt].map((k) => (k && n.includes(normQ(k)) ? k.length : 0)));
  return [...fromAlias, ...fromFrozen.sort((a, b) => score(b) - score(a))];
}

// ---- series ids --------------------------------------------------------------------------------------------------------------

export type Outcome = "win" | "loss" | "draw";
/** A team coin's window (see SERIES above). `legacy` is the 10-10 first form, still read: the current season by abbreviation. */
export type Window =
  | { kind: "season"; year: number }
  | { kind: "post"; year: number }
  | { kind: "next"; n: number; from: string }
  | { kind: "perpetual" }
  | { kind: "legacy"; scope: "all" | "reg" | "post" };
export type WindowKind = Window["kind"];
export const NEXT_MAX = 20;
export function windowCode(w: Window): string {
  return w.kind === "season" ? `s${w.year}` : w.kind === "post" ? `p${w.year}` : w.kind === "next" ? `n${w.n}.${w.from}` : w.kind === "perpetual" ? "perpetual" : w.scope === "all" ? "" : w.scope;
}
export function parseWindowCode(c: string): Window | null {
  let m = /^([sp])(\d{4})$/.exec(c);
  if (m) return { kind: m[1] === "s" ? "season" : "post", year: Number(m[2]) };
  m = /^n(\d{1,2})\.(\d{8})$/.exec(c);
  if (m) { const n = Number(m[1]); return n >= 1 && n <= NEXT_MAX && !Number.isNaN(Date.parse(`${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6)}T00:00:00Z`)) ? { kind: "next", n, from: m[2] } : null; }
  if (c === "perpetual") return { kind: "perpetual" };
  if (c === "" || c === "all" || c === "reg" || c === "post") return { kind: "legacy", scope: (c || "all") as "all" | "reg" | "post" };
  return null;
}
/** Seasons that span two calendar years: ESPN names NBA / NHL / college basketball by the later year (2027 = 2026–27), European soccer by the earlier. */
export const seasonStartYear = (league: LeagueId, year: number): number => (LEAGUES[league].span === "later" ? year - 1 : year);
export const seasonLabel = (league: LeagueId, year: number): string => { const sp = LEAGUES[league].span; return sp === "later" ? `${year - 1}–${String(year).slice(2)}` : sp === "earlier" ? `${year}–${String(year + 1).slice(2)}` : String(year); };
/** The ESPN season year in progress (or next up) at a moment, when no schedule says so: a fallback only. */
export function seasonYearAt(league: LeagueId, nowMs: number): number {
  const d = new Date(nowMs), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, sp = LEAGUES[league].span;
  if (sp === "later") return m >= 8 ? y + 1 : y;
  if (sp === "earlier") return m >= 7 ? y : y - 1;
  return (league === "nfl" || league === "cfb") && m <= 2 ? y - 1 : y;
}
/** The window's own phrase ("this 2026 season, playoffs included"). */
export function windowPhrase(league: LeagueId, w: Window): string {
  if (w.kind === "season") return `the ${seasonLabel(league, w.year)} season${noPlayoffs(league) ? "" : ", playoffs included"}`;
  if (w.kind === "post") return `the ${seasonLabel(league, w.year)} postseason`;
  if (w.kind === "next") return `the next ${w.n} game${w.n === 1 ? "" : "s"} from ${w.from.slice(0, 4)}-${w.from.slice(4, 6)}-${w.from.slice(6)}`;
  if (w.kind === "perpetual") return "every season, no end date";
  return w.scope === "post" ? "this postseason" : w.scope === "reg" ? "this regular season" : "this season";
}
export const teamIdOf = (league: LeagueId, abbr: string): string | null => TEAM_IDS[`${league}:${abbr.toUpperCase()}`] ?? teamByAbbr(league, abbr)?.id ?? null;
export function teamById(league: LeagueId, id: string): EspnTeam | null {
  if (!LEAGUES[league].alias) return teamsOf(league).find((t) => t.id === id) ?? null;
  const key = Object.keys(TEAM_IDS).find((k) => k.startsWith(`${league}:`) && TEAM_IDS[k] === id);
  return key ? teamByAbbr(league, key.slice(league.length + 1)) : null;
}
/** The path segment a schedule request uses: the ESPN team id when known (rename-proof), else the abbreviation. */
export const teamKey = (league: LeagueId, abbrOrId: string): string => (/^\d+$/.test(abbrOrId) ? abbrOrId : teamIdOf(league, abbrOrId) ?? abbrOrId.toLowerCase());

export type EspnSeries = { kind: "team"; league: LeagueId; abbr: string; teamId: string | null; outcome: Outcome; window: Window } | { kind: "game"; league: LeagueId; eventId: string; abbr: string; outcome: Outcome };
/** A team coin's series. A windowed series pins the team by its ESPN id; the legacy window writes the 10-10 first form. */
export function teamSeries(league: LeagueId, abbr: string, outcome: Outcome, window: Window = { kind: "legacy", scope: "all" }): string {
  if (window.kind === "legacy") return `espn.team:${league}-${abbr.toUpperCase()}-${outcome}${window.scope === "all" ? "" : `-${window.scope}`}`;
  const id = teamIdOf(league, abbr);
  if (!id) throw new Error(`no ESPN team id for ${league} ${abbr}`);
  return `espn.team:${league}-${abbr.toUpperCase()}.${id}-${outcome}-${windowCode(window)}`;
}
export const gameSeries = (league: LeagueId, eventId: string, abbr: string, outcome: Outcome): string => `espn.game:${league}-${eventId}-${abbr.toUpperCase()}-${outcome}`;
export function parseEspnSeries(id: string): EspnSeries | null {
  let m = new RegExp(`^espn\\.team:(${LEAGUE_ALT})-([A-Z0-9]{2,6})\\.(\\d{1,7})-(win|loss|draw)-(s\\d{4}|p\\d{4}|n\\d{1,2}\\.\\d{8}|perpetual)$`).exec(id);
  if (m) {
    const lg = m[1] as LeagueId, t = teamById(lg, m[3]) ?? teamByAbbr(lg, m[2]), w = parseWindowCode(m[5]);
    if (m[4] === "draw" && !LEAGUES[lg].draws) return null;
    return t && w ? { kind: "team", league: lg, abbr: t.abbr, teamId: m[3], outcome: m[4] as Outcome, window: w } : null;
  }
  m = /^espn\.team:(nfl|nba|mlb|nhl)-([A-Z]{2,5})-(win|loss)(?:-(reg|post))?$/.exec(id);
  if (m) return teamByAbbr(m[1] as LeagueId, m[2]) ? { kind: "team", league: m[1] as LeagueId, abbr: m[2], teamId: teamIdOf(m[1] as LeagueId, m[2]), outcome: m[3] as Outcome, window: { kind: "legacy", scope: (m[4] as "reg" | "post" | undefined) ?? "all" } } : null;
  m = new RegExp(`^espn\\.game:(${LEAGUE_ALT})-(\\d{4,12})-([A-Z0-9]{2,6})-(win|loss|draw)$`).exec(id);
  if (m) return teamByAbbr(m[1] as LeagueId, m[3]) && (m[4] !== "draw" || LEAGUES[m[1] as LeagueId].draws) ? { kind: "game", league: m[1] as LeagueId, eventId: m[2], abbr: m[3], outcome: m[4] as Outcome } : null;
  return null;
}
export function espnSeriesTitle(s: EspnSeries): string {
  const t = teamByAbbr(s.league, s.abbr)!;
  return s.kind === "team" ? `${t.name} ${s.outcome === "win" ? "wins" : "losses"}${s.window.kind === "legacy" && s.window.scope === "all" ? "" : ` — ${windowPhrase(s.league, s.window)}`} (${LEAGUES[s.league].label})` : `${t.name} ${s.outcome === "win" ? "win" : "loss"} in ESPN game ${s.eventId}`;
}

// ---- parsing ESPN ---------------------------------------------------------------------------------------------------------

export interface GameSide { abbr: string; /** ESPN team id ("" when the body has none) */ id?: string; /** ESPN's short name and location (TheSportsDB names clubs and colleges this way) */ short?: string; location?: string; /** ESPN's winner flag (a shoot-out decides a level knockout game) */ winner?: boolean | null; name: string; nickname: string; score: number | null; homeAway: "home" | "away"; record: string | null }
export interface Game { eventId: string; league: LeagueId; /** 2 regular season, 3 postseason (from the schedule it was read from); null from a scoreboard */ seasonType?: 2 | 3 | null; /** ESPN season year of the schedule it was read from */ seasonYear?: number | null; startsAt: string; date: string; name: string; completed: boolean; state: string; detail: string; home: GameSide; away: GameSide }

const num = (v: unknown): number | null => { const x = typeof v === "object" && v !== null ? (v as { value?: unknown }).value : v; const n = Number(x); return x === null || x === undefined || x === "" || !Number.isFinite(n) ? null : n; };
function parseEvent(league: LeagueId, raw: unknown): Game | null {
  const e = raw as { id?: string; date?: string; name?: string; competitions?: { status?: { type?: { completed?: boolean; state?: string; shortDetail?: string } }; competitors?: { homeAway?: string; score?: unknown; winner?: boolean; team?: { id?: string | number; location?: string; abbreviation?: string; displayName?: string; name?: string; shortDisplayName?: string }; records?: { type?: string; summary?: string }[]; record?: { type?: string; displayValue?: string }[] }[] }[]; status?: { type?: { completed?: boolean; state?: string; shortDetail?: string } } } | null;
  const c = e?.competitions?.[0];
  if (!e?.id || !e.date || !c?.competitors || c.competitors.length !== 2) return null;
  const st = c.status?.type ?? e.status?.type ?? {};
  const side = (x: NonNullable<typeof c.competitors>[number]): GameSide => ({ abbr: String(x.team?.abbreviation ?? "").toUpperCase(), id: x.team?.id === undefined ? "" : String(x.team.id), short: String(x.team?.shortDisplayName ?? ""), location: String(x.team?.location ?? ""), winner: typeof x.winner === "boolean" ? x.winner : null, name: String(x.team?.displayName ?? ""), nickname: String(x.team?.name ?? x.team?.shortDisplayName ?? ""), score: num(x.score), homeAway: x.homeAway === "home" ? "home" : "away", record: x.records?.find((r) => r.type === "total")?.summary ?? x.record?.find((r) => r.type === "total")?.displayValue ?? null });
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
export function outcomeOf(g: Game, abbr: string, teamId: string | null = null): Outcome | "tie" | null {
  const is = (x: GameSide) => (teamId && x.id ? x.id === teamId : x.abbr === abbr);
  const us = is(g.home) ? g.home : is(g.away) ? g.away : null;
  const them = us === g.home ? g.away : g.home;
  if (!us || !g.completed || us.score === null || them.score === null) return null;
  // level on goals but decided (a shoot-out): ESPN's winner flag says who went through — that is a win, not a draw
  if (LEAGUES[g.league]?.draws && us.score === them.score && (us.winner === true || them.winner === true)) return us.winner === true ? "win" : "loss";
  return us.score > them.score ? "win" : us.score < them.score ? "loss" : "tie";
}

// ---- cross-reads ----------------------------------------------------------------------------------------------------------

export type CrossVerdict = { verdict: "agree" | "disagree" | "unavailable"; detail: string; url: string };
const scoresMatch = (g: Game, home: number | null, away: number | null) => home !== null && away !== null && home === g.home.score && away === g.away.score;
const prevDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export const tsdbUrl = (key: string, g: Game, names: [string, string] = [g.home.name, g.away.name]): string => `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}/searchevents.php?e=${encodeURIComponent(`${names[0]} vs ${names[1]}`.replace(/ /g, "_"))}&d=${g.date}`;
/** The names TheSportsDB may file a game under: ESPN's display name, its short name, the location, the club name without FC / CF / AFC / SC. */
export function tsdbNamePairs(g: Game): [string, string][] {
  const vs = (x: GameSide) => [...new Set([x.name, (x.name || "").replace(/^(AFC|FC|CF|SC|CD|CA|AC|AS|SS|SSC|US|RC|RCD|VfB|VfL|TSG|1\. FC)\s+|\s+(FC|CF|SC|AFC)$/g, "").trim(), x.short ?? "", x.location ?? ""].filter((n) => n && n.length >= 3))];
  const h = vs(g.home), a = vs(g.away), out: [string, string][] = [];
  for (let k = 0; k < Math.max(h.length, a.length); k++) out.push([h[Math.min(k, h.length - 1)], a[Math.min(k, a.length - 1)]]);
  return out.filter((p, i) => out.findIndex((q) => q[0] === p[0] && q[1] === p[1]) === i).slice(0, 4);
}
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
/** ESPN's default schedule is the CURRENT season type (the postseason during the playoffs), so both are asked for explicitly. */
export const scheduleUrl = (league: LeagueId, abbrOrId: string, seasonType: 2 | 3 = 2, year: number | null = null): string => `${ESPN_API}/${LEAGUES[league].path}/teams/${teamKey(league, abbrOrId)}/schedule?${year ? `season=${year}&` : ""}seasontype=${seasonType}`;
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
  /** A team's season (regular season, plus the postseason when ESPN lists one): the current one, or ESPN season `year`. */
  async season(league: LeagueId, abbrOrId: string, year: number | null = null): Promise<Game[]> {
    const yr = (b: unknown) => { const y = Number((b as { requestedSeason?: { year?: unknown } } | null)?.requestedSeason?.year); return Number.isFinite(y) && y > 1900 ? y : year; };
    const regBody = await this.get(scheduleUrl(league, abbrOrId, 2, year));
    const reg = parseGames(league, regBody).map((g) => ({ ...g, seasonType: 2 as const, seasonYear: yr(regBody) }));
    const post = await this.get(scheduleUrl(league, abbrOrId, 3, year)).then((b) => parseGames(league, b).map((g) => ({ ...g, seasonType: 3 as const, seasonYear: yr(regBody) }))).catch(() => [] as Game[]);
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
      let last: CrossVerdict = { verdict: "unavailable", detail: "TheSportsDB has no such game", url: "" };
      for (const names of tsdbNamePairs(g)) {
        const url = tsdbUrl(this.tsdbKey, g, names);
        let body: unknown;
        try { body = await this.get(url); } catch (e) { last = { verdict: "unavailable", detail: `TheSportsDB: ${(e as Error).message.slice(0, 60)}`, url: url.replace(`/json/${encodeURIComponent(this.tsdbKey)}/`, "/json/<key>/") }; continue; }
        const v = crossFromTsdb(g, body, url.replace(`/json/${encodeURIComponent(this.tsdbKey)}/`, "/json/<key>/"));
        if (v.verdict !== "unavailable" || !/no such game/.test(v.detail)) return v;
        last = v;
      }
      return last;
    } catch (e) { return { verdict: "unavailable", detail: `cross-read failed: ${(e as Error).message.slice(0, 80)}`, url: "" }; }
  }
}

/**
 * The games a series reads (every listed game of its window, completed or not). A next-N or perpetual window that reaches back past
 * the current season's first game also reads the season before it, so a season boundary never drops a game.
 */
export async function gamesFor(client: EspnClient, s: EspnSeries, sinceIso: string | null = null): Promise<Game[]> {
  const key = s.kind === "team" && s.teamId ? s.teamId : s.abbr;
  if (s.kind === "game") return (await client.season(s.league, key)).filter((g) => g.eventId === s.eventId);
  const w = s.window;
  if (w.kind === "season" || w.kind === "post") return (await client.season(s.league, key, w.year)).filter((g) => w.kind === "season" || g.seasonType === 3);
  if (w.kind === "legacy") return (await client.season(s.league, key)).filter((g) => w.scope === "all" || (w.scope === "reg" ? g.seasonType === 2 : g.seasonType === 3));
  const from = w.kind === "next" ? `${w.from.slice(0, 4)}-${w.from.slice(4, 6)}-${w.from.slice(6)}` : sinceIso?.slice(0, 10) ?? null;
  const cur = await client.season(s.league, key);
  let all = cur;
  if (from && (!cur.length || cur[0].date > from)) {
    const y = cur[0]?.seasonYear ?? null;
    if (y) all = [...(await client.season(s.league, key, y - 1).catch(() => [] as Game[])), ...cur];
  }
  const seen = new Set<string>();
  all = all.filter((g) => (seen.has(g.eventId) ? false : (seen.add(g.eventId), true))).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (w.kind === "next") return all.filter((g) => g.date >= from!).slice(0, w.n);
  return all;
}

/** How long after a team's last listed game a season (or postseason) counts as over: the next round is listed well inside this. */
export const SEASON_END_GRACE_MS = 4 * 86_400_000;
/** A listed game still to be played: not final, not postponed or cancelled (ESPN state "post" without a result), not a stale listing. */
const isOpen = (g: Game, nowMs: number) => !g.completed && g.state !== "post" && Date.parse(g.startsAt) > nowMs - 3 * 86_400_000;
export interface WindowStatus { perpetual: boolean; ended: boolean; endsAt: string | null; lastGame: Game | null; reason: string }
/**
 * Where a series' window stands: open or ended, and its end (the last listed game, provisional while games remain). A season or
 * postseason ends once every listed game is final and SEASON_END_GRACE_MS has passed with nothing new listed (eliminated, champion,
 * or — for a postseason — never qualified). A perpetual window never ends. `games` = gamesFor(…) for team windows; for a postseason
 * window pass the whole season (both types) so a team that missed the playoffs reads as ended.
 */
export function windowStatus(s: EspnSeries, games: readonly Game[], nowMs: number): WindowStatus {
  const sorted = [...games].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const last = sorted[sorted.length - 1] ?? null;
  if (s.kind === "game") { const g = sorted.find((x) => x.eventId === s.eventId) ?? null; return { perpetual: false, ended: !!g?.completed, endsAt: g?.startsAt ?? null, lastGame: g, reason: g ? (g.completed ? "the game is final" : "ends after the game") : "ESPN does not list the game" }; }
  const w = s.window;
  if (w.kind === "perpetual") return { perpetual: true, ended: false, endsAt: null, lastGame: last, reason: "no end date — this coin does not retire" };
  if (w.kind === "next") {
    const done = sorted.filter((g) => g.completed || !isOpen(g, nowMs)).length;
    return { perpetual: false, ended: sorted.length >= w.n && done >= w.n, endsAt: sorted.length >= w.n ? sorted[w.n - 1].startsAt : null, lastGame: last, reason: `${Math.min(done, w.n)} of ${w.n} games final` };
  }
  const scope = w.kind === "post" || (w.kind === "legacy" && w.scope === "post") ? sorted.filter((g) => g.seasonType === 3) : w.kind === "legacy" && w.scope === "reg" ? sorted.filter((g) => g.seasonType === 2) : sorted;
  const open = scope.filter((g) => isOpen(g, nowMs));
  if (open.length) return { perpetual: false, ended: false, endsAt: open[open.length - 1].startsAt, lastGame: last, reason: `${open.length} listed game${open.length === 1 ? "" : "s"} still to play (the end moves if more are listed)` };
  if (!sorted.length || sorted.some((g) => isOpen(g, nowMs))) return { perpetual: false, ended: false, endsAt: null, lastGame: last, reason: "no listed games in the window yet" };
  const lastAt = Date.parse(last!.startsAt);
  if (nowMs - lastAt < SEASON_END_GRACE_MS) return { perpetual: false, ended: false, endsAt: null, lastGame: last, reason: "every listed game is final; waiting for the next round to be listed" };
  const endG = scope.filter((g) => g.completed).pop() ?? scope[scope.length - 1] ?? last!;
  return { perpetual: false, ended: true, endsAt: endG.startsAt, lastGame: last, reason: scope.length ? `the team's last game of the window was ${endG.date}` : `no postseason games: the season ended ${last!.date}` };
}

/**
 * Settled readings for an ESPN series since `sinceIso` (a "YYYY-MM-DD" period key, or null). `crossRead: false` (back-tests only:
 * display-grade) skips the second read; the keeper always cross-reads.
 */
export async function espnSettled(client: EspnClient, s: EspnSeries, sinceIso: string | null, o: { crossRead?: boolean; nowMs?: number } = {}): Promise<ResolvedSelector> {
  const now = o.nowMs ?? Date.now();
  const all = await gamesFor(client, s, sinceIso);
  const games = all.filter((g) => !sinceIso || g.date > sinceIso.slice(0, 10));
  const tid = s.kind === "team" ? s.teamId : null;
  const byDay = new Map<string, { value: number; titles: string[]; url: string }>();
  let awaiting = 0; const refusals: string[] = [];
  for (const g of games) {
    const out = outcomeOf(g, s.abbr, tid);
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
    if (out === s.outcome || (s.outcome === "draw" && out === "tie")) cur.value++;
    cur.titles.push(`${g.away.abbr} ${g.away.score} @ ${g.home.abbr} ${g.home.score} final (${out === "tie" ? "tie" : `${s.abbr} ${out}`}; ${crossText})`);
    byDay.set(g.date, cur);
  }
  const events: SettledEvent[] = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ id: date, at: date, result: null, value: String(d.value), title: d.titles.join(" · "), sourceUrl: d.url, method: `espn-final+${LEAGUES[s.league].cross}` } as SettledEvent));
  const window = windowStatus(s, s.kind === "team" && s.window.kind === "post" ? await client.season(s.league, s.teamId ?? s.abbr, s.window.year).catch(() => all) : all, now);
  return { events, awaitingFinal: awaiting, refusals, settlementSourceUrl: `${ESPN_API}/${LEAGUES[s.league].path}`, window };
}

/** True when the rule is an ESPN catalogue rule. */
export const isEspnRule = (r: Pick<BurnRule, "oracle" | "series">): boolean => r.oracle === "catalogue" && !!r.series && /^espn\.(team|game):/.test(r.series);

/**
 * The window a new team coin covers by default (the intent cards; the Team coin step): THIS SEASON — the current ESPN season, playoffs
 * included — with the other windows offered beside it. `games` = client.season(league, team) (the current season).
 */
export function windowFor(league: LeagueId, games: readonly Game[], nowMs: number): { window: Window; year: number; label: string; endsAt: string | null; next: Game | null; status: WindowStatus } {
  const year = games.find((g) => g.seasonYear)?.seasonYear ?? seasonYearAt(league, nowMs);
  const window: Window = { kind: "season", year };
  const status = windowStatus({ kind: "team", league, abbr: "", teamId: null, outcome: "win", window }, games, nowMs);
  const next = games.filter((g) => isOpen(g, nowMs) && Date.parse(g.startsAt) > nowMs - SETTLE_AFTER_START_MS).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;
  return { window, year, label: `this season (${seasonLabel(league, year)}${noPlayoffs(league) ? "" : ", playoffs included"})`, endsAt: status.endsAt, next, status };
}
/** The four window choices for a team at a moment (the dials and the card's inline options). */
export function windowChoices(league: LeagueId, year: number, nowMs: number, n = 5): { kind: WindowKind; window: Window; label: string }[] {
  const from = new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, "");
  return [
    { kind: "season", window: { kind: "season", year }, label: `This season (${seasonLabel(league, year)}${noPlayoffs(league) ? "" : ", playoffs included"})` },
    { kind: "post", window: { kind: "post", year }, label: `This postseason only (${seasonLabel(league, year)})` },
    { kind: "next", window: { kind: "next", n, from }, label: `Next ${n} games` },
    { kind: "perpetual", window: { kind: "perpetual" }, label: "Perpetual — every season, no end date" },
  ];
}
