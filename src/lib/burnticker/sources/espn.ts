import type { BurnRule } from "@/lib/burnticker/rules";
import type { SettledEvent } from "@/lib/burnticker/units";
import type { FetchLike, ResolvedSelector } from "@/lib/burnticker/oracle/types";
import { TEAM_ALIASES, aliasLookup, type TeamAlias } from "@/lib/burnticker/oracle/events";
import { TEAM_IDS } from "@/lib/burnticker/sources/teamColors";
import { PROVIDER_TEAM_IDS } from "@/lib/burnticker/sources/providerTeams";
import { FBS_TEAM_IDS } from "@/lib/burnticker/sources/fbs";
import ESPN_TEAMS from "../../../../config/burnticker/espn-teams.json" with { type: "json" };
import { sourceForUrl, takeOrThrow } from "@/lib/burnticker/apiBudget";
import { LruMap } from "@/lib/burnticker/lru";

/**
 * TEAMS, LEAGUES, SERIES AND SCHEDULES FOR TEAM COINS (the file keeps its old name; since 2026-10-10 NOTHING here reads ESPN). The team
 * tables are frozen (oracle/events alias table + config/burnticker/espn-teams.json: names, abbreviations, colours, the ESPN team id used
 * only as a stable PIN in series ids). Schedules come from the league's free official feed (MLB StatsAPI, NHL api-web), the NBA's feed
 * when it answers (else TheSportsDB, see the probe note below), or TheSportsDB v2 under its commercial licence (every other league;
 * without BURNTICKER_THESPORTSDB_KEY: "schedule needs the licensed key"). Settlement: sources/gameSettle.ts. A plain human link to
 * ESPN's scoreboard is the only trace of ESPN on a page.
 *
 * NBA FEED PROBE (2026-10-12 21:17 Denver, read-only curl from the operator's Mac; the Burnticker host saw the same 403 at ~21:40):
 *   cdn.nba.com/static/json/staticData/scheduleLeagueV2.json             HTTP 403 (plain, and with browser User-Agent/Referer/Origin)
 *   cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json           HTTP 403 (both)
 *   cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json HTTP 403 (both)
 *   stats.nba.com/stats/scheduleleaguev2 (x-nba-stats-origin/token, Referer nba.com)  no answer, timed out at 45 s
 * No official NBA endpoint answers, so NBA_OFFICIAL_ANSWERS is false: the NBA schedule is read from TheSportsDB (league 4387) first and
 * the cdn is tried only when TheSportsDB cannot be read or no key is set. Re-probe and flip the flag if the cdn answers 200 again; the
 * series ids and team pins do not depend on which feed listed the games (teams resolve by name to the same frozen table). TheSportsDB's
 * NBA rounds (checked the same night on its public test key): intRound 0 regular season, 500 preseason (dropped in every league read
 * through TheSportsDB, not only the NBA), 125 to 180 the
 * playoffs (2025 second round 125, the 2025 Finals 180); a December game with a round number is the NBA Cup final, which does not count
 * in the standings and is dropped as the NBA's own feed did (game ids 006).
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
 *       m<YYYY>.<OPP>.<OPPID>  EVERY GAME BETWEEN THE TEAM AND ONE OPPONENT in season YYYY, regular season and postseason (the rivalry
 *                      series, owner 2026-10-12: "sixers vs celtics as a pair ... resolves at the end of the season"). Outcome is always
 *                      `win`; the opponent is pinned by its ESPN team id too. The mirror id (the opponent's side) is meetingsMirror(id).
 *                      A meetings reading is SIGNED: per game day, the team's wins minus its losses against that opponent (+1 a win,
 *                      −1 a loss, 0 a draw or a split day); a postponed or cancelled meeting counts for neither side. When the window
 *                      ends (both teams' last listed game, postseason included, every game final, SEASON_END_GRACE_MS passed) ONE more
 *                      reading is written, dated the day after that last game: +1 if the team won more of the meetings, −1 if fewer,
 *                      nothing if level (the window then ends void). Read as a pair (rules.ts meetingsSeriesId; both coins direction
 *                      up, side B on the mirror id), the existing winner-takes-the-burn path does the rest: a +1 is the coin's win,
 *                      a −1 is its loss (pairMirrorRule), so the loser's share forwards; the end-day reading is the season-end
 *                      PairResult the program's pair-winner end sink reads (end.rs partner_won). See docs in WIRING-RIVALRY-SERIES.md.
 *   espn.team:<league>-<ABBR>-<win|loss>[-reg|-post]  the 10-10 first form (still read): this season by abbreviation
 *   espn.game:<league>-<eventId>-<ABBR>-<win|loss> one game: value 1 if the team won (or lost) it (a tie burns neither side)
 * THREE-WAY OUTCOMES (owner 2026-10-13: a soccer creator picks which results burn). In a league with draws the outcome may also be two of
 * the three results, one code each, in the order win, draw, loss: `windraw` (the team does not lose), `drawloss` (the team does not win),
 * `winloss` (the game does not end in a draw). A game whose result is in the set reads 1 unit, exactly as a single outcome does. These
 * codes are refused in a league without draws (win or loss there is every game), in the rivalry series (always `win`) and in the 10-10
 * first form; `win`, `loss` and `draw` ids are unchanged byte for byte.
 * Readings are keyed by the game's UTC start date ("2026-10-04"); a doubleheader counts 2.
 */

/**
 * EVERY TEAM-SPORT LEAGUE BURNTICKER COVERS, the list ESPN's scoreboard pages show, never read (the owner, 2026-10-10: "all inclusive: MLB, NBA, NHL, soccer leagues, really all
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

export interface EspnTeam { league: LeagueId; /** the PIN abbreviation series ids carry (never changed) */ abbr: string; /** QA pass 9 #29: the conventional display abbreviation (MCI, MUN); equal to abbr unless DISPLAY_ABBR names one */ code?: string; city: string; nickname: string; name: string; ticker: string; alt: string[]; id?: string | null; colors?: [string, string] | null; /** a college team is named only by its full name or its mascot ("Michigan" alone is a state, not a team) */ strictKeys?: string[] | null }
/**
 * The alias table disambiguates shared cities with a letter ("Chicago C", "New York Y") and names the Athletics by nickname alone; review 2
 * §2 (2026-10-11) saw "Chicago C Cubs" and "Athletics Athletics" on the league pages. The display city drops the letter; a city equal to
 * the nickname is not repeated. The alias table itself (matching) is unchanged.
 */
export const displayCity = (city: string): string => city.replace(/\s+[A-Z]{1,2}$/, "");
export const displayTeamName = (city: string, nickname: string): string => { const c = displayCity(city).trim(); return !c || c === nickname ? nickname : `${c} ${nickname}`; };
const toTeam = (league: LeagueId, a: TeamAlias): EspnTeam => ({ league, abbr: ESPN_ABBR[LEAGUES[league].alias!][a.abbr] ?? a.abbr, code: ESPN_ABBR[LEAGUES[league].alias!][a.abbr] ?? a.abbr, city: displayCity(a.city), nickname: a.nickname, name: displayTeamName(a.city, a.nickname), ticker: a.nickname.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10), alt: [a.abbr, ...a.alt] });
/** A frozen ESPN team: the short name ("Arsenal", "Inter Miami", "Georgia") is what people say; the nickname alone is ambiguous in college. */
/** "Inter Miami CF" → "Inter Miami", "AFC Bournemouth" → "Bournemouth": the club name people say. */
export const clubName = (n: string): string => n.replace(/^(AFC|FC|CF|SC|CD|CA|AC|AS|SS|SSC|US|RC|RCD)\s+|\s+(FC|CF|SC|AFC)$/g, "").trim() || n;
/** Leagues whose season is the competition alone (no playoffs: European leagues, the UEFA cups). */
export const noPlayoffs = (league: LeagueId): boolean => LEAGUES[league].sport === "soccer" && LEAGUES[league].span === "earlier";
const fromFrozen = (league: LeagueId, f: FrozenTeam): EspnTeam => {
  const soccerLike = LEAGUES[league].sport === "soccer";
  const nickname = soccerLike ? clubName(f.name || f.short) : LEAGUES[league].alias === null && (league === "cfb" || league === "mcbb" || league === "wcbb") ? (f.location || f.short) : (f.nickname || f.short);
  const college = league === "cfb" || league === "mcbb" || league === "wcbb";
  return { league, abbr: f.abbr, code: displayAbbr(league, f.abbr), city: f.location, nickname, name: f.name, ticker: nickname.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10), alt: [...new Set([f.abbr, f.short, f.name, f.location, soccerLike ? clubName(f.name) : ""].filter(Boolean))], id: f.id, colors: [f.color, f.alt], strictKeys: college ? [f.name, `${f.location} ${league === "cfb" ? "football" : "basketball"}`].filter(Boolean) : null };
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
/**
 * CONVENTIONAL DISPLAY ABBREVIATIONS (QA pass 9 #29, 2026-10-13: Manchester City showed as MNC and Manchester United as MAN). Only what a
 * page shows and what a default ticker starts with changes; the pin abbreviation inside every series id (`espn.team:eng.1-MNC.382-…`)
 * stays as it is, so no coin's rule or hash moves. Bayern shows as BAY where Manchester United now shows as MUN.
 */
export const DISPLAY_ABBR: Partial<Record<LeagueId, Record<string, string>>> = {
  "eng.1": { MNC: "MCI", MAN: "MUN" }, "uefa.champions": { MNC: "MCI", MAN: "MUN", MUN: "BAY" }, "uefa.europa": { MNC: "MCI", MAN: "MUN", MUN: "BAY" }, "uefa.europa.conf": { MNC: "MCI", MAN: "MUN", MUN: "BAY" },
  "ger.1": { MUN: "BAY" }, "sco.1": { HOM: "HEA", HIBS: "HIB" },
};
export const displayAbbr = (league: LeagueId, abbr: string): string => DISPLAY_ABBR[league]?.[abbr.toUpperCase()] ?? abbr.toUpperCase();
/** The display code of a pin abbreviation (the team's own `code`, else the abbreviation). */
export const teamCodeOf = (t: Pick<EspnTeam, "abbr" | "code">): string => t.code ?? t.abbr;
/**
 * THE TEAM PICKER'S LIST (QA pass 9 #28 and #29): every team of a league in alphabetical order of its name; college football lists the FBS
 * only unless `division` is "all" (sources/fbs.ts).
 */
export type PickerDivision = "fbs" | "all";
export function pickerTeams(league: LeagueId, o: { division?: PickerDivision | null } = {}): EspnTeam[] {
  const all = teamsOf(league).filter((t) => league !== "cfb" || o.division === "all" || (!!t.id && FBS_TEAM_IDS.has(t.id)));
  return [...all].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}
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

/** One result of a game, as a team sees it. */
export type SingleOutcome = "win" | "loss" | "draw";
/** Two of the three results of a game in a league with draws (THREE-WAY OUTCOMES above). */
export type PairOutcome = "windraw" | "drawloss" | "winloss";
export type Outcome = SingleOutcome | PairOutcome;
export const PAIR_OUTCOMES: readonly PairOutcome[] = ["windraw", "drawloss", "winloss"];
export const isPairOutcome = (o: string | null | undefined): o is PairOutcome => o === "windraw" || o === "drawloss" || o === "winloss";
/** The results an outcome burns on: one, or two of the three. */
export const outcomeResults = (o: Outcome): SingleOutcome[] => (o === "windraw" ? ["win", "draw"] : o === "drawloss" ? ["draw", "loss"] : o === "winloss" ? ["win", "loss"] : [o]);
/** Whether a game's result (a tie is a draw) is one this outcome burns on. */
export const outcomeHits = (o: Outcome, result: SingleOutcome | "tie"): boolean => outcomeResults(o).includes(result === "tie" ? "draw" : result);
/** An outcome a league can take: a draw, or two of the three results, only where the league has draws. */
export const outcomeAllowed = (league: LeagueId, o: string): o is Outcome => o === "win" || o === "loss" || ((o === "draw" || isPairOutcome(o)) && LEAGUES[league].draws);
/**
 * The plain words for an outcome: the verb after the team ("win or draw"), the noun ("win or draw"), its plural ("Wins or Draws"), the
 * short word a coin's name ends with ("Unbeaten", so "Wolverhampton Wanderers 2026–27 Unbeaten" still fits the 32-byte name), and the
 * everyday "do not lose" where there is one.
 */
export function outcomeWords(o: Outcome): { verb: string; noun: string; plural: string; name: string; notVerb: string | null } {
  if (o === "windraw") return { verb: "win or draw", noun: "win or draw", plural: "Wins or Draws", name: "Unbeaten", notVerb: "do not lose" };
  if (o === "drawloss") return { verb: "draw or lose", noun: "draw or loss", plural: "Draws or Losses", name: "Winless", notVerb: "do not win" };
  if (o === "winloss") return { verb: "win or lose", noun: "win or loss", plural: "Wins or Losses", name: "No Draws", notVerb: null };
  return o === "win" ? { verb: "win", noun: "win", plural: "Wins", name: "Wins", notVerb: null } : o === "draw" ? { verb: "draw", noun: "draw", plural: "Draws", name: "Draws", notVerb: null } : { verb: "lose", noun: "loss", plural: "Losses", name: "Losses", notVerb: null };
}
/** A team coin's window (see SERIES above). `legacy` is the 10-10 first form, still read: the current season by abbreviation. */
export type Window =
  | { kind: "season"; year: number }
  | { kind: "post"; year: number }
  | { kind: "next"; n: number; from: string }
  | { kind: "perpetual" }
  | { kind: "meetings"; year: number; opp: string; oppId: string }
  | { kind: "legacy"; scope: "all" | "reg" | "post" };
export type WindowKind = Window["kind"];
export const NEXT_MAX = 20;
export function windowCode(w: Window): string {
  return w.kind === "season" ? `s${w.year}` : w.kind === "post" ? `p${w.year}` : w.kind === "next" ? `n${w.n}.${w.from}` : w.kind === "perpetual" ? "perpetual" : w.kind === "meetings" ? `m${w.year}.${w.opp.toUpperCase()}.${w.oppId}` : w.scope === "all" ? "" : w.scope;
}
export function parseWindowCode(c: string): Window | null {
  let m = /^([sp])(\d{4})$/.exec(c);
  if (m) return { kind: m[1] === "s" ? "season" : "post", year: Number(m[2]) };
  m = /^n(\d{1,2})\.(\d{8})$/.exec(c);
  if (m) { const n = Number(m[1]); return n >= 1 && n <= NEXT_MAX && !Number.isNaN(Date.parse(`${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6)}T00:00:00Z`)) ? { kind: "next", n, from: m[2] } : null; }
  if (c === "perpetual") return { kind: "perpetual" };
  m = /^m(\d{4})\.([A-Z0-9]{2,6})\.(\d{1,7})$/.exec(c);
  if (m) return { kind: "meetings", year: Number(m[1]), opp: m[2], oppId: m[3] };
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
  if (w.kind === "meetings") { const o = teamById(league, w.oppId) ?? teamByAbbr(league, w.opp); return `every game against ${o?.name ?? w.opp} in the ${seasonLabel(league, w.year)} season${noPlayoffs(league) ? "" : ", playoffs included"}`; }
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
/** The rivalry series of one side: `abbr`'s head-to-head games against `opp` in season `year` (both pinned by their team ids). */
export function meetingsSeries(league: LeagueId, abbr: string, opp: string, year: number): string {
  const oppId = teamIdOf(league, opp);
  if (!oppId) throw new Error(`no ESPN team id for ${league} ${opp}`);
  if (abbr.toUpperCase() === opp.toUpperCase()) throw new Error("a rivalry series needs two different teams");
  return teamSeries(league, abbr, "win", { kind: "meetings", year, opp: opp.toUpperCase(), oppId });
}
/** The other side's series of a rivalry series id (PHI vs BOS → BOS vs PHI), or null when `id` is not one. */
export function meetingsMirror(id: string): string | null {
  const e = parseEspnSeries(id);
  if (e?.kind !== "team" || e.window.kind !== "meetings") return null;
  return meetingsSeries(e.league, e.window.opp, e.abbr, e.window.year);
}
/** The two series of a rivalry pair, one per team. */
export const meetingsPairSeries = (league: LeagueId, a: string, b: string, year: number): { a: string; b: string } => ({ a: meetingsSeries(league, a, b, year), b: meetingsSeries(league, b, a, year) });
export type MeetingsSeries = Extract<EspnSeries, { kind: "team" }> & { window: Extract<Window, { kind: "meetings" }> };
export const asMeetings = (s: EspnSeries | null | undefined): MeetingsSeries | null => (s?.kind === "team" && s.window.kind === "meetings" ? (s as MeetingsSeries) : null);
/** True when a catalogue series id is a rivalry series (the pair gate in rules.ts repeats this as a pattern, MEETINGS_SERIES_RE). */
export const isMeetingsSeriesId = (id: string | null | undefined): boolean => !!id && asMeetings(parseEspnSeries(id)) !== null;
export const gameSeries = (league: LeagueId, eventId: string, abbr: string, outcome: Outcome): string => `espn.game:${league}-${eventId}-${abbr.toUpperCase()}-${outcome}`;
export function parseEspnSeries(id: string): EspnSeries | null {
  let m = new RegExp(`^espn\\.team:(${LEAGUE_ALT})-([A-Z0-9]{2,6})\\.(\\d{1,7})-(win|loss|draw|windraw|drawloss|winloss)-(s\\d{4}|p\\d{4}|n\\d{1,2}\\.\\d{8}|perpetual|m\\d{4}\\.[A-Z0-9]{2,6}\\.\\d{1,7})$`).exec(id);
  if (m) {
    const lg = m[1] as LeagueId, t = teamById(lg, m[3]) ?? teamByAbbr(lg, m[2]); let w = parseWindowCode(m[5]);
    if (!outcomeAllowed(lg, m[4])) return null;
    if (w?.kind === "meetings") {
      // the rivalry series: outcome `win` only (a signed head-to-head reading), a real opponent that is not the team itself
      const o = teamById(lg, w.oppId) ?? teamByAbbr(lg, w.opp);
      if (m[4] !== "win" || !o || !t || o.abbr === t.abbr) return null;
      w = { ...w, opp: o.abbr };
    }
    return t && w ? { kind: "team", league: lg, abbr: t.abbr, teamId: m[3], outcome: m[4] as Outcome, window: w } : null;
  }
  m = /^espn\.team:(nfl|nba|mlb|nhl)-([A-Z]{2,5})-(win|loss)(?:-(reg|post))?$/.exec(id);
  if (m) return teamByAbbr(m[1] as LeagueId, m[2]) ? { kind: "team", league: m[1] as LeagueId, abbr: m[2], teamId: teamIdOf(m[1] as LeagueId, m[2]), outcome: m[3] as Outcome, window: { kind: "legacy", scope: (m[4] as "reg" | "post" | undefined) ?? "all" } } : null;
  m = new RegExp(`^espn\\.game:(${LEAGUE_ALT})-(\\d{4,12})-([A-Z0-9]{2,6})-(win|loss|draw|windraw|drawloss|winloss)$`).exec(id);
  if (m) return teamByAbbr(m[1] as LeagueId, m[3]) && outcomeAllowed(m[1] as LeagueId, m[4]) ? { kind: "game", league: m[1] as LeagueId, eventId: m[2], abbr: m[3], outcome: m[4] as Outcome } : null;
  return null;
}
export function espnSeriesTitle(s: EspnSeries): string {
  const t = teamByAbbr(s.league, s.abbr)!;
  if (s.kind === "team" && s.window.kind === "meetings") { const o = teamById(s.league, s.window.oppId) ?? teamByAbbr(s.league, s.window.opp); return `${t.name} against ${o?.name ?? s.window.opp}, head to head — ${windowPhrase(s.league, s.window)} (${LEAGUES[s.league].label})`; }
  // the single outcomes keep their 10-10 titles byte for byte ("losses" for a draw coin included); two of three results say both
  if (isPairOutcome(s.outcome)) { const w = outcomeWords(s.outcome); return s.kind === "team" ? `${t.name} ${w.plural.toLowerCase()}${s.window.kind === "legacy" && s.window.scope === "all" ? "" : ` — ${windowPhrase(s.league, s.window)}`} (${LEAGUES[s.league].label})` : `${t.name} ${w.noun} in ESPN game ${s.eventId}`; }
  return s.kind === "team" ? `${t.name} ${s.outcome === "win" ? "wins" : "losses"}${s.window.kind === "legacy" && s.window.scope === "all" ? "" : ` — ${windowPhrase(s.league, s.window)}`} (${LEAGUES[s.league].label})` : `${t.name} ${s.outcome === "win" ? "win" : "loss"} in ESPN game ${s.eventId}`;
}

// ---- parsing ESPN ---------------------------------------------------------------------------------------------------------

export interface GameSide { abbr: string; /** ESPN team id ("" when the body has none) */ id?: string; /** ESPN's short name and location (TheSportsDB names clubs and colleges this way) */ short?: string; location?: string; /** ESPN's winner flag (a shoot-out decides a level knockout game) */ winner?: boolean | null; name: string; nickname: string; score: number | null; homeAway: "home" | "away"; record: string | null }
export interface Game { eventId: string; league: LeagueId; /** 2 regular season, 3 postseason (from the schedule it was read from); null from a scoreboard */ seasonType?: 2 | 3 | null; /** ESPN season year of the schedule it was read from */ seasonYear?: number | null; startsAt: string; date: string; name: string; completed: boolean; state: string; detail: string; home: GameSide; away: GameSide }

const num = (v: unknown): number | null => { const x = typeof v === "object" && v !== null ? (v as { value?: unknown }).value : v; const n = Number(x); return x === null || x === undefined || x === "" || !Number.isFinite(n) ? null : n; };

// ---- schedules: NO ESPN READS (owner, 2026-10-10). The free official feeds for MLB and the NHL; the NBA's feed when it answers, else
// TheSportsDB (the probe note at the top); TheSportsDB v2 (licensed key) for every other league. A league without its feed answers "schedule needs the licensed key" — never a fallback to ESPN.

export class ScheduleUnavailable extends Error {}
/**
 * THE 3,000-ROW LISTING (season rehearsal 2026-10-13, men's college basketball): TheSportsDB's league schedule stops at 3,000 rows, and
 * a Division I basketball season is about 6,000 games, so the listing ends in mid-season. A team's season read from it would look over
 * after its last LISTED game, and windowStatus would end the coin's window months early. A listing that reaches the cap is therefore
 * never taken as a whole season (EspnClient.season): the read fails, the keeper keeps waiting, and the coin cannot be made. The
 * upcoming-games pickers still read the listing's first rows. No paged or per-team schedule is wired: neither could be checked without
 * the licensed key (2026-10-14).
 */
export const TSDB_LISTING_CAP = 3_000;
export class ScheduleCut extends Error {}
export const tsdbListingCut = (body: unknown): boolean => (body && typeof body === "object" ? (Object.values(body as Record<string, unknown>).filter(Array.isArray) as unknown[][]).reduce((n, l) => n + l.length, 0) : 0) >= TSDB_LISTING_CAP;
export const tsdbCutSentence = (league: LeagueId): string => `TheSportsDB lists only the first ${TSDB_LISTING_CAP.toLocaleString("en-US")} games of the ${LEAGUES[league].label} season, so a whole season cannot be read from it yet.`;
export const SCHEDULE_NEEDS_KEY = "schedule needs the licensed key (BURNTICKER_THESPORTSDB_KEY)";
/**
 * ONE NORMAL FORM FOR A TEAM NAME (QA pass 9 #5, 2026-10-13: TheSportsDB lists "Brighton and Hove Albion" where our table says "Brighton &
 * Hove Albion", so the team showed no next game while its fixtures were listed). Accents, case, apostrophes and periods do not matter,
 * "&" is read as "and", and "Saint" as "St" ("Union St.-Gilloise" = "Union Saint-Gilloise", "D.C. United" = "DC United").
 */
export const teamNameKey = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/&/g, " and ").replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\bsaint\b/g, "st");
const normName = teamNameKey;
/** Club words that are not part of a club's own name ("FC", "AC", "de", "and"), dropped when two names are compared word by word. */
const CLUB_WORDS = new Set(["fc", "cf", "afc", "sc", "ac", "as", "ssc", "cd", "ca", "rc", "rcd", "us", "club", "de", "del", "da", "do", "the", "and", "y", "calcio", "sv", "vfb", "vfl", "tsg", "fk", "sk", "if", "cp", "04", "05", "07"]);
const coreWords = (s: string): string[] => teamNameKey(s).split(" ").filter((w) => w.length > 1 && !CLUB_WORDS.has(w));
/**
 * Provider names no rule can read (checked against every TheSportsDB league fixture on 2026-10-13, test/burntickerSources6.test.ts): the
 * provider's name, in teamNameKey form, → our abbreviation (the pin's abbreviation, never the display code).
 */
export const PROVIDER_NAME_ALIASES: Partial<Record<LeagueId, Record<string, string>>> = {
  "ita.1": { "inter milan": "INT", inter: "INT" }, "fra.1": { "paris sg": "PSG" }, "ger.1": { koln: "KOE", "1 fc koln": "KOE" }, "bra.1": { "atletico mineiro": "CAM", "athletico paranaense": "CAP" },
  "esp.1": { "athletic bilbao": "ATH", "deportivo alaves": "ALA" }, "usa.1": { "new york red bulls": "RBNY", "los angeles fc": "LAFC" },
};
/** Words that make a different club when added to a name ("Dundee United", "Manchester City", "Real Madrid Castilla"). */
const DISTINCT_WORDS = new Set(["united", "city", "town", "county", "rovers", "athletic", "atletico", "wanderers", "albion", "hotspur", "real", "sporting", "inter", "dynamo", "dinamo", "castilla", "ii", "women", "femenino", "reserves", "u19", "u21", "u23"]);
const uniqueOf = <T,>(xs: T[]): T | null => (xs.length === 1 ? xs[0] : null);
/**
 * A provider's team → our team, most certain first: the provider's id or our abbreviation; the full name, or one of our other names
 * (short name, location), equal in teamNameKey form; a known provider alias; for US pro and college leagues the name ending in our
 * nickname ("Los Angeles Lakers"); for clubs, the ONE team whose own words all appear in the provider's name or the reverse ("Estoril
 * Praia" = "Estoril", "Sarmiento" = "Sarmiento (Junín)"). A club's last word alone never decides it: "Inter Milan" is not "AC Milan".
 */
export function ourTeam(league: LeagueId, name: string, abbr: string | null = null): EspnTeam | null {
  const ts = teamsOf(league), n = normName(name);
  if (abbr) { const A = abbr.toUpperCase(); const byProv = ts.find((t) => PROVIDER_TEAM_IDS[`${league}:${t.abbr}`] === A); if (byProv) return byProv; const byAbbr = ts.find((t) => t.abbr === A); if (byAbbr) return byAbbr; }
  if (!n) return null;
  const exact = ts.find((t) => n === normName(t.name)) ?? ts.find((t) => [t.nickname, ...t.alt].some((k) => k.length >= 3 && n === normName(k)));
  if (exact) return exact;
  const alias = PROVIDER_NAME_ALIASES[league]?.[n];
  if (alias) { const t = ts.find((x) => x.abbr === alias); if (t) return t; }
  if (LEAGUES[league].sport !== "soccer") return ts.find((t) => n.endsWith(` ${normName(t.nickname)}`) || n === normName(t.nickname)) ?? null;
  const mine = new Set(coreWords(name));
  if (!mine.size) return null;
  const words = (t: EspnTeam) => [...new Set([t.name, t.nickname, ...t.alt].filter((k) => k.length >= 3).map((k) => coreWords(k)).filter((w) => w.length && w.some((x) => x.length >= 4)).map((w) => w.join(" ")))].map((w) => w.split(" "));
  const within = (a: readonly string[], b: Set<string>) => a.every((w) => b.has(w));
  // the provider's extra words may not name a different club ("Dundee United" is not "Dundee"); the most specific match wins
  const extraOk = (w: readonly string[]) => [...mine].every((x) => w.includes(x) || !DISTINCT_WORDS.has(x));
  const score = (t: EspnTeam) => Math.max(0, ...words(t).map((w) => (within(w, mine) && extraOk(w) ? w.length : within([...mine], new Set(w)) ? mine.size : 0)));
  const scored = ts.map((t) => ({ t, s: score(t) })).filter((x) => x.s > 0), best = Math.max(0, ...scored.map((x) => x.s));
  return uniqueOf(scored.filter((x) => x.s === best).map((x) => x.t));
}
const sideOf = (league: LeagueId, homeAway: "home" | "away", name: string, abbr: string | null, score: number | null, winner: boolean | null = null): GameSide => {
  const t = ourTeam(league, name, abbr);
  return { abbr: t?.abbr ?? "TBD", id: t ? teamIdOf(league, t.abbr) ?? "" : "", short: t?.nickname ?? name, location: t?.city ?? "", winner, name: name || t?.name || "", nickname: t?.nickname ?? name, score, homeAway, record: null };
};
const mk = (league: LeagueId, eventId: string, startsAt: string, seasonType: 2 | 3, seasonYear: number | null, state: "pre" | "in" | "post", completed: boolean, detail: string, home: GameSide, away: GameSide): Game =>
  ({ eventId, league, seasonType, seasonYear, startsAt, date: startsAt.slice(0, 10), name: `${away.name} at ${home.name}`, completed, state, detail, home, away });

export const MLB_API = "https://statsapi.mlb.com/api/v1";
export const mlbTeamScheduleUrl = (abbr: string, year: number): string => `${MLB_API}/schedule?sportId=1&season=${year}&gameType=R,F,D,L,W&teamId=${PROVIDER_TEAM_IDS[`mlb:${abbr}`] ?? ""}`;
export const mlbRangeUrl = (from: string, to: string): string => `${MLB_API}/schedule?sportId=1&startDate=${from}&endDate=${to}&gameType=R,F,D,L,W`;
export function mlbGames(body: unknown): Game[] {
  const games = (((body as { dates?: { games?: unknown[] }[] } | null)?.dates ?? []).flatMap((d) => d.games ?? [])) as { gamePk?: number; gameDate?: string; gameType?: string; season?: string; status?: { abstractGameState?: string; detailedState?: string }; teams?: { home?: { team?: { name?: string }; score?: number; isWinner?: boolean }; away?: { team?: { name?: string }; score?: number; isWinner?: boolean } } }[];
  return games.filter((g) => g.gamePk && g.gameDate).map((g) => {
    const st = g.status?.abstractGameState ?? "", postponed = /postponed|cancel|suspend/i.test(g.status?.detailedState ?? "");
    const state = st === "Final" || postponed ? "post" : st === "Live" ? "in" : "pre";
    return mk("mlb", String(g.gamePk), g.gameDate!, g.gameType === "R" ? 2 : 3, num(g.season), state, st === "Final" && !postponed, g.status?.detailedState ?? "", sideOf("mlb", "home", g.teams?.home?.team?.name ?? "", null, num(g.teams?.home?.score), g.teams?.home?.isWinner ?? null), sideOf("mlb", "away", g.teams?.away?.team?.name ?? "", null, num(g.teams?.away?.score), g.teams?.away?.isWinner ?? null));
  });
}
export const NHL_API = "https://api-web.nhle.com/v1";
export const nhlClubScheduleUrl = (abbr: string, year: number): string => `${NHL_API}/club-schedule-season/${PROVIDER_TEAM_IDS[`nhl:${abbr}`] ?? abbr}/${year - 1}${year}`;
export const nhlWeekUrl = (date: string): string => `${NHL_API}/schedule/${date}`;
export function nhlGames(body: unknown): Game[] {
  const b = body as { games?: unknown[]; gameWeek?: { games?: unknown[] }[] } | null;
  const games = [...(b?.games ?? []), ...(b?.gameWeek ?? []).flatMap((d) => d.games ?? [])] as { id?: number; season?: number; gameType?: number; startTimeUTC?: string; gameState?: string; homeTeam?: { abbrev?: string; commonName?: { default?: string }; placeName?: { default?: string }; score?: number }; awayTeam?: { abbrev?: string; commonName?: { default?: string }; placeName?: { default?: string }; score?: number } }[];
  return games.filter((g) => g.id && g.startTimeUTC && (g.gameType === 2 || g.gameType === 3)).map((g) => {
    const done = /^(FINAL|OFF)$/.test(g.gameState ?? ""), live = /^(LIVE|CRIT)$/.test(g.gameState ?? "");
    const nm = (t: typeof g.homeTeam) => `${t?.placeName?.default ?? ""} ${t?.commonName?.default ?? ""}`.trim();
    return mk("nhl", String(g.id), g.startTimeUTC!, g.gameType === 3 ? 3 : 2, g.season ? Number(String(g.season).slice(4)) : null, done ? "post" : live ? "in" : "pre", done, g.gameState ?? "", sideOf("nhl", "home", nm(g.homeTeam), g.homeTeam?.abbrev ?? null, num(g.homeTeam?.score)), sideOf("nhl", "away", nm(g.awayTeam), g.awayTeam?.abbrev ?? null, num(g.awayTeam?.score)));
  });
}
export const NBA_LEAGUE_SCHEDULE = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json";
/** Whether an official NBA endpoint answered the last probe (header note, 2026-10-12: none did). False: TheSportsDB first for the NBA. */
export const NBA_OFFICIAL_ANSWERS = false;
export function nbaGames(body: unknown): Game[] {
  const ls = (body as { leagueSchedule?: { seasonYear?: string; gameDates?: { games?: unknown[] }[] } } | null)?.leagueSchedule;
  const year = ls?.seasonYear ? Number(String(ls.seasonYear).slice(0, 4)) + 1 : null;
  const games = (ls?.gameDates ?? []).flatMap((d) => d.games ?? []) as { gameId?: string; gameDateTimeUTC?: string; gameStatus?: number; gameStatusText?: string; homeTeam?: { teamTricode?: string; teamName?: string; teamCity?: string; score?: number }; awayTeam?: { teamTricode?: string; teamName?: string; teamCity?: string; score?: number } }[];
  return games.filter((g) => g.gameId && g.gameDateTimeUTC && /^00[245]/.test(g.gameId)).map((g) => {
    const nm = (t: typeof g.homeTeam) => `${t?.teamCity ?? ""} ${t?.teamName ?? ""}`.trim();
    return mk("nba", g.gameId!, g.gameDateTimeUTC!, /^002/.test(g.gameId!) ? 2 : 3, year, g.gameStatus === 3 ? "post" : g.gameStatus === 2 ? "in" : "pre", g.gameStatus === 3, g.gameStatusText ?? "", sideOf("nba", "home", nm(g.homeTeam), null, num(g.homeTeam?.score)), sideOf("nba", "away", nm(g.awayTeam), null, num(g.awayTeam?.score)));
  });
}
/** TheSportsDB's status of a game being played (halves, quarters, periods, innings, half time, extra time, a break). */
export const TSDB_LIVE_RE = /^(1H|2H|HT|ET|BT|P|LIVE|IN ?PLAY|IN ?PROGRESS|Q[1-4]|OT|[1-9](ST|ND|RD|TH)|P[1-3]|IN[1-9]|BREAK)\b/i;
/**
 * A GAME IN PROGRESS IS "LIVE NOW" (QA pass 9 #35, 2026-10-13: a game being played still read "starts 7:30 PM"). Live when its feed says so
 * (state "in"), or, for a feed that marks only scheduled and final, once it has started and is not yet final within a sport's usual length.
 */
export const LIVE_NOW = "Live now";
const GAME_HOURS: Record<Sport, number> = { baseball: 4.5, basketball: 3, hockey: 3.5, soccer: 2.5, football: 4.5 };
export function isLive(g: Pick<Game, "completed" | "state" | "startsAt" | "detail" | "league">, nowMs: number): boolean {
  if (g.completed || g.state === "post" || CANCELLED_RE.test(g.detail) || /postpon|suspend/i.test(g.detail)) return false;
  if (g.state === "in") return true;
  const t = Date.parse(g.startsAt);
  return Number.isFinite(t) && t <= nowMs && nowMs - t < GAME_HOURS[LEAGUES[g.league]?.sport ?? "football"] * 3_600_000;
}
/** TheSportsDB's round number for a preseason game, in every league (dropped by tsdbGames). */
export const TSDB_PRESEASON_ROUND = 500;
/** The NBA's schedule and confirmation while its own feed does not answer, in the one wording every page uses (NBA_OFFICIAL_ANSWERS). */
export { NBA_FEED_WORDING } from "@/lib/burnticker/sources/polyStated";
/**
 * TheSportsDB league ids (v2 schedule/league/<id>/<season>). Checked against TheSportsDB's public league pages; verify on the licensed account.
 * 2026-10-14 (the women's college basketball gap, 0 rows): wcbb was 4608, which is "Battlarts Fighting" (lookupleague.php?id=4608 on the
 * public test key); "NCAA Division I Basketball Women" is 5789 (lookupleague.php?id=5789, current season 2024-2025, United States).
 */
export const TSDB_LEAGUE: Partial<Record<LeagueId, string>> = { wnba: "4516", mcbb: "4607", wcbb: "5789", nfl: "4391", cfb: "4479", "eng.1": "4328", "esp.1": "4335", "ita.1": "4332", "ger.1": "4331", "fra.1": "4334", "uefa.champions": "4480", "uefa.europa": "4481", "uefa.europa.conf": "5071", "usa.1": "4346", "usa.nwsl": "4521", "mex.1": "4350", "ned.1": "4337", "por.1": "4344", "eng.2": "4329", "sco.1": "4330", "bra.1": "4351", "arg.1": "4406", nba: "4387", mlb: "4424", nhl: "4380" };
export const tsdbSeasonCode = (league: LeagueId, year: number): string => (LEAGUES[league].span === "single" ? String(year) : LEAGUES[league].span === "later" ? `${year - 1}-${year}` : `${year}-${year + 1}`);
export const tsdbScheduleUrl = (league: LeagueId, year: number): string => `https://www.thesportsdb.com/api/v2/json/schedule/league/${TSDB_LEAGUE[league] ?? ""}/${tsdbSeasonCode(league, year)}`;
/**
 * TheSportsDB v1, the fallback for a key that v2 refuses (the live miss of 2026-10-10: v2 answers HTTP 400 "Invalid Premium API key"
 * to a non-premium key, so every soccer schedule read failed). v1 takes the key in the path: the season's results, the league's last
 * results and its next fixtures, merged. With a free key v1 lists few events (the next fixture per league); the commercial key unlocks
 * the full v2 schedule.
 */
export const tsdbV1Urls = (key: string, league: LeagueId, year: number): string[] => {
  const id = TSDB_LEAGUE[league] ?? "", b = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}`;
  return [`${b}/eventsseason.php?id=${id}&s=${tsdbSeasonCode(league, year)}`, `${b}/eventspastleague.php?id=${id}`, `${b}/eventsnextleague.php?id=${id}`];
};
/** A URL as it may be logged or shown: a v1 key in the path is replaced. */
export const redactKey = (url: string): string => url.replace(/(thesportsdb\.com\/api\/v1\/json\/)[^/]+/, "$1<key>");
/**
 * THESPORTSDB'S SCORE ORDER (season rehearsal 2026-10-13, bug 4). Some rows put the scores in the order of the event's name while the
 * team fields name the other order: `{"strEvent":"Ohio vs Ohio State","strHomeTeam":"Ohio State","strAwayTeam":"Ohio","intHomeScore":"9",
 * "intAwayScore":"37"}` (Ohio State won 37–9 at home), `{"strEvent":"Duke vs Texas","strHomeTeam":"Texas","strAwayTeam":"Duke",
 * "intHomeScore":"75","intAwayScore":"60"}` (Duke won 75–60). Read from the box over the 2025 season schedules: 630 of 1,708 college
 * football rows and 29 of 3,000 men's college basketball rows are written this way (and one NFL preseason row, the Hall of Fame game
 * "Los Angeles Chargers vs Detroit Lions" 34–7 with Detroit in the home field); every other league writes the event name in the field
 * order. The team fields are right (they say who was at home) and the scores follow the event's name. So:
 *   "fields"   the event's name lists the home field then the away field (or names neither order in a league that never reverses:
 *              "Paris Saint-Germain" where the field says "Paris SG"): intHomeScore is the home field's;
 *   "event"    the event's name lists the AWAY field first: intHomeScore is the away field's score;
 *   "unknown"  a college row whose event name matches neither order ("Brown vs Georgetown" with "Robert Morris" in the home field):
 *              which score is whose cannot be told, and settlement holds the game (gameSettle.ts finalFromTsdb).
 */
export const TSDB_REVERSING: ReadonlySet<LeagueId> = new Set<LeagueId>(["cfb", "mcbb", "wcbb"]);
export function tsdbScoreOrder(league: LeagueId, e: Record<string, unknown>): "fields" | "event" | "unknown" {
  const h = String(e.strHomeTeam ?? ""), a = String(e.strAwayTeam ?? "");
  const parts = String(e.strEvent ?? "").split(/\s+vs\.?\s+/i);
  const same = (x: string, y: string) => { const kx = normName(x), ky = normName(y); if (kx && kx === ky) return true; const tx = ourTeam(league, x), ty = ourTeam(league, y); return !!tx && !!ty && tx.abbr === ty.abbr; };
  if (parts.length === 2 && h && a) {
    const straight = same(parts[0], h) && same(parts[1], a), crossed = same(parts[0], a) && same(parts[1], h);
    if (straight !== crossed) return straight ? "fields" : "event";
  }
  return TSDB_REVERSING.has(league) ? "unknown" : "fields";
}
/** A TheSportsDB row's scores by its team fields (home field, away field), read in the row's score order (tsdbScoreOrder). */
export function tsdbFieldScores(league: LeagueId, e: Record<string, unknown>): { home: number | null; away: number | null; order: "fields" | "event" | "unknown" } {
  const order = tsdbScoreOrder(league, e), h = num(e.intHomeScore), a = num(e.intAwayScore);
  return order === "event" ? { home: a, away: h, order } : { home: h, away: a, order };
}
export function tsdbGames(league: LeagueId, body: unknown, year: number): Game[] {
  const lists = body && typeof body === "object" ? (Object.values(body as Record<string, unknown>).filter(Array.isArray) as Record<string, unknown>[][]) : [];
  const nbaRound = (e: Record<string, unknown>) => { const r = Number(e.intRound ?? 0); return Number.isFinite(r) ? r : 0; };
  // TheSportsDB's round 500 is the PRESEASON in every league it lists (header note): never a game, a meeting or part of a season window.
  // NBA only: a December game with a round number is the NBA Cup final, which does not count in the standings; 100 to 499 is the playoffs
  const keep = (e: Record<string, unknown>) => nbaRound(e) !== TSDB_PRESEASON_ROUND && (league !== "nba" || !(nbaRound(e) >= 100 && String(e.dateEvent ?? e.strTimestamp ?? "").slice(5, 7) === "12"));
  // NFL (owner 2026-10-13, the Super Bowl end): TheSportsDB numbers the NFL's regular season 1–18 and the playoffs 100–499 (the 2025 season read
  // from the box: 125 / 150 / 160 for the three playoff rounds, 200 for the Super Bowl), the same scheme as the NBA's playoffs
  const post = (e: Record<string, unknown>) => (league === "nba" || league === "nfl" ? nbaRound(e) >= 100 && nbaRound(e) < 500 : /playoff|final|knockout|round of/i.test(String(e.strRound ?? e.intRound ?? "")) && LEAGUES[league].sport !== "soccer");
  return lists.flat().filter((e) => e && typeof e === "object" && e.idEvent && (e.strTimestamp || e.dateEvent) && keep(e)).map((e) => {
    const done = /^(FT|AOT|AET|AP|PEN|Match Finished|Final)/i.test(String(e.strStatus ?? "")), startsAt = String(e.strTimestamp ?? `${e.dateEvent}T${e.strTime ?? "00:00:00"}`).replace(/(\+00:00)?$/, "").replace(/Z?$/, "Z");
    const sc = tsdbFieldScores(league, e);   // bug 4: a college row's scores can follow the event's name, not the team fields
    return mk(league, String(e.idEvent), startsAt, post(e) ? 3 : 2, year, done ? "post" : TSDB_LIVE_RE.test(String(e.strStatus ?? "")) ? "in" : "pre", done, String(e.strStatus ?? ""), sideOf(league, "home", String(e.strHomeTeam ?? ""), null, sc.home), sideOf(league, "away", String(e.strAwayTeam ?? ""), null, sc.away));
  });
}
/**
 * ONE LISTING PER GAME (semantics-verify item 79, 2026-10-12). MLB's schedule lists a postponed game twice under one game id: on its
 * original date as "Postponed" and on its make-up date. Keeping the first listing in the body kept the postponed one and dropped the game
 * that was actually played. The listing kept is the final one, else one that is not postponed, else the first.
 */
export function dedupeListings(games: readonly Game[]): Game[] {
  const rank = (g: Game) => (g.completed ? 2 : /postpon|cancel|suspend/i.test(g.detail) ? 0 : 1);
  const byId = new Map<string, Game>();
  for (const g of games) { const have = byId.get(g.eventId); if (!have || rank(g) > rank(have)) byId.set(g.eventId, g); }
  return [...byId.values()];
}

/** A team's outcome in a completed game, or null (not completed, not its game, or no scores). Ties are neither win nor loss. */
export function outcomeOf(g: Game, abbr: string, teamId: string | null = null): SingleOutcome | "tie" | null {
  const is = (x: GameSide) => (teamId && x.id ? x.id === teamId : x.abbr === abbr);
  const us = is(g.home) ? g.home : is(g.away) ? g.away : null;
  const them = us === g.home ? g.away : g.home;
  if (!us || !g.completed || us.score === null || them.score === null) return null;
  // level on goals but decided (a shoot-out): ESPN's winner flag says who went through — that is a win, not a draw
  if (LEAGUES[g.league]?.draws && us.score === them.score && (us.winner === true || them.winner === true)) return us.winner === true ? "win" : "loss";
  return us.score > them.score ? "win" : us.score < them.score ? "loss" : "tie";
}

/** Does game `g` have team (abbr / id) on one side? */
export const playsIn = (g: Game, abbr: string, teamId: string | null = null): boolean => [g.home, g.away].some((x) => (teamId && x.id ? x.id === teamId : x.abbr === abbr));
/** Is `g` a meeting of the series' team and its opponent? */
export const isMeetingOf = (s: MeetingsSeries, g: Game): boolean => playsIn(g, s.abbr, s.teamId) && playsIn(g, s.window.opp, s.window.oppId);
/**
 * One meeting from the side's view, as the SCHEDULE lists it (the catalogue and the API listing; the keeper's readings settle each game
 * through gameSettle.ts instead): win / loss / draw once final, void when the schedule marks it cancelled or postponed without a result,
 * pending while it is still to be played.
 */
export type MeetingOutcome = "win" | "loss" | "draw" | "void" | "pending";
export function meetingOutcome(g: Game, abbr: string, teamId: string | null = null): MeetingOutcome {
  if (!g.completed) return g.state === "post" || CANCELLED_RE.test(g.detail) || /postpon|suspend/i.test(g.detail) ? "void" : "pending";
  const o = outcomeOf(g, abbr, teamId);
  return o === "win" ? "win" : o === "loss" ? "loss" : o === "tie" || o === "draw" ? "draw" : "pending";
}
/** The head-to-head count of a rivalry series, from the side's view, and who leads it. */
export interface MeetingsTally { wins: number; losses: number; draws: number; voids: number; leader: "team" | "opponent" | "level" }
export function tallyMeetings(outcomes: readonly MeetingOutcome[]): MeetingsTally {
  const n = (k: MeetingOutcome) => outcomes.filter((o) => o === k).length;
  const wins = n("win"), losses = n("loss");
  return { wins, losses, draws: n("draw"), voids: n("void"), leader: wins > losses ? "team" : losses > wins ? "opponent" : "level" };
}
/** The season-end reading's day: the UTC day after the later of the two teams' last listed games (never a meeting's own day). */
export const seriesEndDay = (lastGameStartsAt: string): string => new Date(Date.parse(`${lastGameStartsAt.slice(0, 10)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
/** The end reason of a level series. It starts with "void", so the end-sink keeper records a void end: each coin winds down on itself. */
export const MEETINGS_LEVEL_REASON = "void: the two teams won the same number of games against each other this season, so nothing moves between the two coins and each burns down on its own pool";
export const meetingsEndReason = (t: MeetingsTally, team: string, opp: string): string => (t.leader === "level" ? MEETINGS_LEVEL_REASON : `the season series is over: ${team} ${t.wins}, ${opp} ${t.losses}${t.draws ? `, ${t.draws} drawn` : ""}`);

// ---- name variants (TheSportsDB names clubs and colleges its own way) ----
export function tsdbNamePairs(g: Game): [string, string][] {
  const vs = (x: GameSide) => [...new Set([x.name, (x.name || "").replace(/^(AFC|FC|CF|SC|CD|CA|AC|AS|SS|SSC|US|RC|RCD|VfB|VfL|TSG|1\. FC)\s+|\s+(FC|CF|SC|AFC)$/g, "").trim(), x.short ?? "", x.location ?? ""].filter((n) => n && n.length >= 3))];
  const h = vs(g.home), a = vs(g.away), out: [string, string][] = [];
  for (let k = 0; k < Math.max(h.length, a.length); k++) out.push([h[Math.min(k, h.length - 1)], a[Math.min(k, a.length - 1)]]);
  return out.filter((p, i) => out.findIndex((q) => q[0] === p[0] && q[1] === p[1]) === i).slice(0, 4);
}
/** The User-Agent the readers send. */
export const ESPN_UA = "burnticker/0.1";
export const SETTLE_AFTER_START_MS = 6 * 3_600_000;

export interface EspnClientOpts {
  fetchImpl?: FetchLike; now?: () => number; minIntervalMs?: number; ttlMs?: number; /** TheSportsDB v2 (commercial licence): schedules for the leagues without a free official feed */ tsdbKey?: string | null;
  /** One read's limit, headers and body together (default SPORTS_FETCH_TIMEOUT_MS). */
  timeoutMs?: number;
  /** A failed read is answered from memory for this long, doubling per failure up to failMaxMs (defaults FAIL_BACKOFF_MS). */
  failBaseMs?: number; failMaxMs?: number;
  /** The most answers kept (oldest out first). */
  maxCached?: number;
}

/**
 * 2026-10-15 prelaunch audit H1 (confirmed live: /v1/sports/teams answered 503 at 20 s, /v1/search?q=broncos 503 three times of three
 * while TheSportsDB answered 522). Every read had no timeout and waited behind one process-wide queue, and a failure was not kept, so
 * every request retried the stalled host. Now: each read is aborted after SPORTS_FETCH_TIMEOUT_MS; each provider (by host: TheSportsDB,
 * MLB, NHL, the NBA's feed) has its own queue and its own spacing, so a stalled one never holds up another; a failed read is answered
 * from memory for FAIL_BACKOFF_MS.base, doubling per failure up to .max, then tried again; two callers of one URL share one read; the
 * answers kept are bounded (LruMap).
 */
export const SPORTS_FETCH_TIMEOUT_MS = 8_000;
export const FAIL_BACKOFF_MS = { base: 30_000, max: 600_000 } as const;
/**
 * Waits at most `ms` for `p`; past that answers { done: false } and lets the read finish in the background (its answer is kept by the
 * client's cache for the next caller). The team picker and search use it so a slow schedule never holds the page (H1).
 */
export async function within<T>(p: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: true; error: unknown } | { done: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = p.then((value) => ({ done: true as const, value }), (error: unknown) => ({ done: true as const, error }));
  const r = await Promise.race([settled, new Promise<{ done: false }>((res) => { timer = setTimeout(() => res({ done: false }), ms); })]);
  clearTimeout(timer);
  return r;
}
/** The error a read that took too long throws (a timeout, a stalled host): the pages say the schedule is not available just now. */
export class ScheduleSlow extends Error { constructor(what: string) { super(`${what}: the schedule is taking too long to read; it is shown when it arrives`); this.name = "ScheduleSlow"; } }

/**
 * THE SPORTS SCHEDULE READER (no ESPN reads). Kept under its old name for the callers; `SportsClient` is the same class.
 *   MLB  statsapi.mlb.com  (free, official)      NHL  api-web.nhle.com (free, official)
 *   NBA  the NBA's feed (cdn.nba.com) when it answers, else TheSportsDB under licence; while NBA_OFFICIAL_ANSWERS is false TheSportsDB
 *        is read first and the cdn only when TheSportsDB cannot be read (nbaSchedule)
 *   every other league     TheSportsDB v2 league schedule (BURNTICKER_THESPORTSDB_KEY) — without the key: ScheduleUnavailable
 */
export class EspnClient {
  private fetchImpl: FetchLike; private now: () => number; private minInterval: number; private ttl: number; readonly tsdbKey: string | null;
  private timeoutMs: number; private failBase: number; private failMax: number;
  private cache: LruMap<string, { at: number; body: unknown }>;
  /** H1: per provider (by source id), its own spacing and its own queue. */
  private lastAt = new Map<string, number>(); private chains = new Map<string, Promise<void>>();
  /** H1: failures kept per URL: until when the error is answered from memory, and how many in a row. */
  private failures: LruMap<string, { until: number; n: number; message: string }>;
  private inflight = new Map<string, Promise<unknown>>();
  requests: string[] = [];
  /** Feeds that refused this process (HTTP 401 or 403): not read again by the reader that marked them (gameSettle.ts crossFinal, the NBA's feed). */
  readonly refusedFeeds = new Set<string>();
  constructor(o: EspnClientOpts = {}) {
    this.fetchImpl = o.fetchImpl ?? (fetch as unknown as FetchLike); this.now = o.now ?? (() => Date.now()); this.minInterval = o.minIntervalMs ?? 250; this.ttl = o.ttlMs ?? 600_000;
    this.timeoutMs = o.timeoutMs ?? SPORTS_FETCH_TIMEOUT_MS; this.failBase = o.failBaseMs ?? FAIL_BACKOFF_MS.base; this.failMax = o.failMaxMs ?? FAIL_BACKOFF_MS.max;
    this.cache = new LruMap(o.maxCached ?? 500); this.failures = new LruMap(500);
    this.tsdbKey = o.tsdbKey === undefined ? ((process.env.BURNTICKER_THESPORTSDB_KEY ?? "").trim() || null) : o.tsdbKey;
  }
  /** GET with the shared politeness and cache; `headers` carry a licensed reader's key (never cached into the key, never logged). */
  async get(url: string, headers: Record<string, string> = {}): Promise<unknown> {
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.at < this.ttl) return hit.body;
    // H1: a recent failure is answered from memory (with its own words) until its backoff ends
    const failed = this.failures.get(url);
    if (failed && this.now() < failed.until) throw new Error(failed.message);
    const shared = this.inflight.get(url);
    if (shared) return shared;
    const source = sourceForUrl(url);
    const run = async () => {
      const wait = (this.lastAt.get(source) ?? 0) + this.minInterval - this.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      await takeOrThrow(source);   // the request budget (apiBudget.ts): waits for its bucket; a spent day budget skips the read
      this.lastAt.set(source, this.now()); this.requests.push(redactKey(url));
      try {
        const res = await this.fetchImpl(url, { headers: { accept: "application/json", "user-agent": ESPN_UA, ...headers }, signal: AbortSignal.timeout(this.timeoutMs) });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${redactKey(url).slice(0, 120)}`);
        const body = await res.json(); this.cache.set(url, { at: this.now(), body }); this.failures.delete(url); return body;
      } catch (e) {
        const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
        const message = timedOut ? `timed out after ${Math.round(this.timeoutMs / 1000)} s for ${redactKey(url).slice(0, 120)}` : (e as Error).message;
        const n = (this.failures.get(url)?.n ?? 0) + 1;
        this.failures.set(url, { until: this.now() + Math.min(this.failMax, this.failBase * 2 ** (n - 1)), n, message });
        throw timedOut ? new Error(message) : e;
      }
    };
    // the provider's own queue: one read at a time per provider, a stalled provider never holds up another
    const prev = this.chains.get(source) ?? Promise.resolve();
    const p = prev.then(run, run);
    const tail = p.then(() => undefined, () => undefined);
    this.chains.set(source, tail);
    void tail.then(() => { if (this.chains.get(source) === tail) this.chains.delete(source); });
    this.inflight.set(url, p);
    void p.then(() => this.inflight.delete(url), () => this.inflight.delete(url));
    return p;
  }
  /** Whether this host can read a league's schedule (the three free official feeds, or TheSportsDB with the key). */
  scheduleAvailable(league: LeagueId): boolean { return league === "mlb" || league === "nhl" || (league === "nba" && NBA_OFFICIAL_ANSWERS) || !!this.tsdbKey; }
  /** v2 refused this key (not a premium key): v1 from then on, for this process. */
  tsdbV1 = false;
  /**
   * One TheSportsDB read with `key`: v2 with the key in the X-API-KEY header; when v2 refuses the key (HTTP 400 / 401 / 403) the v1
   * URLs (key in the path, never logged) are read instead and their event lists merged by idEvent.
   */
  async tsdbRead(key: string, v2: string, v1: (key: string) => string[]): Promise<unknown> {
    if (!this.tsdbV1) {
      try { return await this.get(v2, { "X-API-KEY": key }); } catch (e) { if (!/HTTP (400|401|403)\b/.test((e as Error).message)) throw e; this.tsdbV1 = true; }
    }
    const seen = new Set<string>(), events: Record<string, unknown>[] = [];
    let got = 0, last: Error | null = null;
    for (const u of v1(key)) {
      let body: unknown;
      try { body = await this.get(u); got++; } catch (e) { last = e as Error; continue; }
      for (const list of body && typeof body === "object" ? Object.values(body as Record<string, unknown>).filter(Array.isArray) as Record<string, unknown>[][] : []) for (const ev of list) { const id = String(ev?.idEvent ?? ""); if (id && !seen.has(id)) { seen.add(id); events.push(ev); } }
    }
    if (!got && last) throw last;
    return { events };
  }
  /**
   * The NBA's games for season `year`: the NBA's feed when it answers, else TheSportsDB under licence (header note). While
   * NBA_OFFICIAL_ANSWERS is false TheSportsDB is read first; either way the other one is the fallback, so a feed that answers 403 never
   * leaves the schedule empty while the other can be read. Neither readable: the TheSportsDB error (ScheduleUnavailable without a key).
   */
  async nbaSchedule(year: number): Promise<Game[]> {
    const cdn = async () => {
      if (this.refusedFeeds.has(NBA_LEAGUE_SCHEDULE)) throw new Error(`HTTP 403 earlier in this run for ${NBA_LEAGUE_SCHEDULE} (not read again)`);
      try { return nbaGames(await this.get(NBA_LEAGUE_SCHEDULE)).filter((g) => g.seasonYear === year); }
      catch (e) { if (/HTTP (401|403)\b/.test((e as Error).message)) this.refusedFeeds.add(NBA_LEAGUE_SCHEDULE); throw e; }
    };
    const tsdb = () => this.tsdb("nba", year);
    const [first, second] = NBA_OFFICIAL_ANSWERS ? [cdn, tsdb] : [tsdb, cdn];
    let firstErr: unknown;
    try { return await first(); } catch (e) { firstErr = e; }
    try { return await second(); } catch (e) { throw NBA_OFFICIAL_ANSWERS ? e : firstErr; }
  }
  private async tsdb(league: LeagueId, year: number, whole = false): Promise<Game[]> {
    if (!this.tsdbKey || !TSDB_LEAGUE[league]) throw new ScheduleUnavailable(`${LEAGUES[league].label}: ${SCHEDULE_NEEDS_KEY}`);
    const body = await this.tsdbRead(this.tsdbKey, tsdbScheduleUrl(league, year), (k) => tsdbV1Urls(k, league, year));
    if (whole && tsdbListingCut(body)) throw new ScheduleCut(tsdbCutSentence(league));
    return tsdbGames(league, body, year);
  }
  /** A team's season (regular season and postseason): the current one, or season `year` (the league's own year naming, as ESPN's was). */
  async season(league: LeagueId, abbrOrId: string, year: number | null = null): Promise<Game[]> {
    const t = /^\d+$/.test(abbrOrId) ? teamById(league, abbrOrId) : teamByAbbr(league, abbrOrId);
    if (!t) return [];
    const y = year ?? seasonYearAt(league, this.now());
    const mine = (g: Game) => g.home.abbr === t.abbr || g.away.abbr === t.abbr;
    let games: Game[];
    if (league === "mlb") games = mlbGames(await this.get(mlbTeamScheduleUrl(t.abbr, y)));
    else if (league === "nhl") games = nhlGames(await this.get(nhlClubScheduleUrl(t.abbr, y)));
    else if (league === "nba") games = await this.nbaSchedule(y);
    else games = await this.tsdb(league, y, true);
    return dedupeListings(games.filter(mine)).map((g) => ({ ...g, seasonYear: g.seasonYear ?? y })).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
  /** A league's games in the next `days` days (the matchup picker and the team picker's next game). */
  async upcoming(league: LeagueId, days = 7): Promise<Game[]> {
    const from = new Date(this.now()).toISOString().slice(0, 10), to = new Date(this.now() + days * 86_400_000).toISOString().slice(0, 10);
    let games: Game[];
    if (league === "mlb") games = mlbGames(await this.get(mlbRangeUrl(from, to)));
    else if (league === "nhl") games = nhlGames(await this.get(nhlWeekUrl(from)));
    else if (league === "nba") games = await this.nbaSchedule(seasonYearAt(league, this.now()));
    else games = await this.tsdb(league, seasonYearAt(league, this.now()));
    return games.filter((g) => g.date >= from && g.date <= to).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
}
export { EspnClient as SportsClient };

/**
 * The games a series reads (every listed game of its window, completed or not). A next-N or perpetual window that reaches back past
 * the current season's first game also reads the season before it, so a season boundary never drops a game.
 */
export async function gamesFor(client: EspnClient, s: EspnSeries, sinceIso: string | null = null): Promise<Game[]> {
  const key = s.kind === "team" && s.teamId ? s.teamId : s.abbr;
  if (s.kind === "game") return (await client.season(s.league, key)).filter((g) => g.eventId === s.eventId);
  const w = s.window;
  if (w.kind === "meetings") { const ms = s as MeetingsSeries; return (await client.season(s.league, key, w.year)).filter((g) => isMeetingOf(ms, g)); }
  if (w.kind === "season" || w.kind === "post") return (await client.season(s.league, key, w.year)).filter((g) => w.kind === "season" || g.seasonType === 3);
  if (w.kind === "legacy") return (await client.season(s.league, key)).filter((g) => w.scope === "all" || (w.scope === "reg" ? g.seasonType === 2 : g.seasonType === 3));
  const from = w.kind === "next" ? `${w.from.slice(0, 4)}-${w.from.slice(4, 6)}-${w.from.slice(6)}` : sinceIso?.slice(0, 10) ?? null;
  const cur = await client.season(s.league, key);
  let all = cur;
  if (from && (!cur.length || cur[0].date > from)) {
    const y = cur[0]?.seasonYear ?? null;
    if (y) all = [...(await client.season(s.league, key, y - 1).catch(() => [] as Game[])), ...cur];
  }
  all = dedupeListings(all).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (w.kind === "next") return all.filter((g) => g.date >= from!).slice(0, w.n);
  return all;
}

/** How long after a team's last listed game a season (or postseason) counts as over: the next round is listed well inside this. */
export const SEASON_END_GRACE_MS = 4 * 86_400_000;
/** A listed game still to be played: not final, not postponed or cancelled (ESPN state "post" without a result), not a stale listing. */
const isOpen = (g: Game, nowMs: number) => !g.completed && g.state !== "post" && Date.parse(g.startsAt) > nowMs - 3 * 86_400_000;
export interface WindowStatus {
  perpetual: boolean; ended: boolean; endsAt: string | null; lastGame: Game | null; reason: string;
  /**
   * website-18 (the champion path): once a season window has ENDED, whether the team won the championship, from its last game of the
   * window (championOf). true or false only for a league in CHAMPION_KNOWN; null when the source cannot tell; absent before the end.
   */
  champion?: boolean | null;
  /** A rivalry series (window kind `meetings`) whose window ended: the head-to-head count from the settled readings, and the season-end reading's day (null when level). */
  series?: (MeetingsTally & { endDay: string | null }) | null;
  /** The UTC date of the team's last POSTSEASON game, which `champion` was read from (null when it did not reach the postseason); the
   *  coin's own receipt for that day must agree before the keeper acts. */
  championDate?: string | null;
}
/**
 * THE LEAGUES WHOSE SCHEDULE CAN TELL A CHAMPION FROM AN ELIMINATED TEAM (website-18). In a single-elimination postseason every team but
 * one loses its last game, so "the team won its last postseason game and nothing more was listed" means it won the title. That needs a
 * schedule that marks postseason games exactly: MLB StatsAPI (game types F, D, L, W), the NHL feed (game type 3) and the NBA feed (game
 * ids 004 and 005), or for the NBA and the NFL TheSportsDB's round number (100 to 499, the header note; the NFL added 2026-10-13 by the
 * owner's decision, its 2025 season read from the box: rounds 1–18, then 125 / 150 / 160 and 200 for the Super Bowl, a single-elimination
 * bracket). The NBA's 2024-25 playoffs on TheSportsDB's season page (re-checked 2026-10-14): play-in 400, first round 160, second round
 * 125, conference finals 150, Finals 180, and no round-0 game after the regular season. TheSportsDB's round label is not exact for the
 * WNBA (the same check on its 2025 season: the first round's first games say "Playoff", every later playoff game says round 0 like the
 * regular season, and one Finals game says round 4), so no round rule can tell its postseason; college football and
 * basketball have bowls, the NIT and conference tournaments, where many teams win their last game; soccer leagues crown the table
 * leader. Those leagues are left out: their season coins keep the plain end (the rest goes to $DEFICIT's burn).
 */
export const CHAMPION_KNOWN: ReadonlySet<LeagueId> = new Set<LeagueId>(["mlb", "nba", "nhl", "nfl"]);
/**
 * The champion path's series: a team coin on a team's WINS for a whole season (regular season and playoffs), in a league whose schedule
 * can tell a champion (CHAMPION_KNOWN). Null for anything else. The rule-level test (an end sink to the flagship, not the fade side) is
 * describe.ts championPathRule, which the keeper reads too.
 */
export function championSeries(series: string | null | undefined): Extract<EspnSeries, { kind: "team" }> | null {
  const e = series ? parseEspnSeries(series) : null;
  return e?.kind === "team" && e.outcome === "win" && e.window.kind === "season" && CHAMPION_KNOWN.has(e.league) ? e : null;
}
/**
 * Did the team win the championship? From its last completed game of an ended season window: a regular-season game (it did not reach the
 * postseason) is false; a postseason game it won is true, one it lost is false; anything else (no scores, a tie, an unmarked game, a
 * league outside CHAMPION_KNOWN) is null, and the keeper waits.
 */
export function championOf(s: Extract<EspnSeries, { kind: "team" }>, last: Game | null): boolean | null {
  if (!CHAMPION_KNOWN.has(s.league) || !last || !last.completed) return null;
  if (last.seasonType === 2) return false;
  if (last.seasonType !== 3) return null;
  const o = outcomeOf(last, s.abbr, s.teamId);
  return o === "win" ? true : o === "loss" ? false : null;
}
/**
 * Where a series' window stands: open or ended, and its end (the last listed game, provisional while games remain). A season or
 * postseason ends once every listed game is final and SEASON_END_GRACE_MS has passed with nothing new listed (eliminated, champion,
 * or — for a postseason — never qualified). A perpetual window never ends. `games` = gamesFor(…) for team windows; for a postseason
 * window pass the whole season (both types) so a team that missed the playoffs reads as ended.
 */
export const CANCELLED_RE = /cancel|^CNCL$/i;
export const GAME_CANCELLED_REASON = "void: the game was cancelled and not rescheduled, so the coin ends without a burn";
export function windowStatus(s: EspnSeries, games: readonly Game[], nowMs: number): WindowStatus {
  const sorted = [...games].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const last = sorted[sorted.length - 1] ?? null;
  // owner decision 2026-10-12 (website-20 item 79): a one-game coin whose game the schedule lists as CANCELLED (not postponed, and with no
  // make-up listing under its id, which dedupeListings would have kept instead) ends VOID: its window ends with no result, nothing burns
  // for the game, and its own pool winds down. A postponed game keeps the coin open until it is played.
  if (s.kind === "game") { const c = sorted.find((x) => x.eventId === s.eventId && !x.completed && CANCELLED_RE.test(x.detail)); if (c) return { perpetual: false, ended: true, endsAt: c.startsAt, lastGame: c, reason: GAME_CANCELLED_REASON }; }
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
  const lastDone = scope.filter((g) => g.completed).pop() ?? null;
  const endG = lastDone ?? scope[scope.length - 1] ?? last!;
  const champ = w.kind === "season" && CHAMPION_KNOWN.has(s.league) ? { champion: championOf(s, lastDone), championDate: lastDone?.seasonType === 3 ? lastDone.date : null } : {};
  if (w.kind === "meetings") return { perpetual: false, ended: true, endsAt: last!.startsAt, lastGame: last, reason: `both teams' seasons are over (the last game was ${last!.date})` };
  return { perpetual: false, ended: true, endsAt: endG.startsAt, lastGame: last, reason: scope.length ? `the team's last game of the window was ${endG.date}` : `no postseason games: the season ended ${last!.date}`, ...champ };
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
