import { LEAGUES, displayAbbr, teamCodeOf, teamsOf, type LeagueId } from "@/lib/burnticker/sources/espn";

/**
 * THE ONE TEAM-COIN TICKER (ChatGPT audit 6 item 6, 2026-10-12): three generators disagreed (the wizard's $LAD / $LADWS / $LADNOWIN, the
 * search's $DODGERS26 / $DODGERSWS, the teams API's $DIAMONDBAC) and the defaults collided across leagues ($ATL for the Braves, Hawks,
 * Falcons, Dream and Atlanta United; $ARI for the Diamondbacks and the Cardinals). The wizard, /v1/search and /v1/sports/teams all call
 * this one function now.
 *
 *   $LADWIN     the season's wins          $LADLOSS   its losses            $LADWINPO the postseason
 *   $LADWINN5   the next five games        $LADWINALL every season          $LADNOWIN the fade side
 *   $LADWS      the title, once            $LADLOSSGM one game's loss
 *
 * DIRECTION BY DEFAULT (cheap-features pass item 4, owner 2026-10-13): every generated team ticker says which result burns ($LADWIN,
 * $ARSLOSS, $LADDRAW). Before that a bare $LAD meant wins and $LADL losses. When the full words do not fit in ten characters the window
 * shortens first (NEXT5 to N5, ALL to A, GM to G), then the side (WIN to W, LOSS to L). Pair tickers ($PHIVBOS) are made elsewhere and
 * do not change; a registered ticker never changes either, because only new drafts call this.
 *
 * A team code that more than one league uses gets the league's tag after it ($ATLMLB, $ATLNBA, $ATLNFL, $ATLWNBA, $ATLMLS), so the
 * default ticker is unique per league and season; two teams of one league that share their first four letters get the fifth letter of
 * their own code (college lists). The registry's taken check still runs at review (tickerCheck.ts), with two free suggestions. Client-safe.
 */
export const LEAGUE_TAG: Record<string, string> = {
  mlb: "MLB", nba: "NBA", wnba: "WNBA", nhl: "NHL", nfl: "NFL", cfb: "CFB", mcbb: "MBB", wcbb: "WBB", "usa.1": "MLS", "usa.nwsl": "NWSL",
  "eng.1": "EPL", "eng.2": "EFL", "esp.1": "LIGA", "ita.1": "SERA", "ger.1": "BUND", "fra.1": "LIG1", "ned.1": "ERED", "por.1": "PORT", "sco.1": "SPFL",
  "bra.1": "BRA", "arg.1": "ARG", "mex.1": "LMX", "uefa.champions": "UCL", "uefa.europa": "UEL", "uefa.europa.conf": "UECL",
};
const CHAMP: Record<string, string> = { mlb: "WS", nfl: "SB", nba: "TITLE", nhl: "CUP" };
const code = (s: string, max = 4): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, max);

let leaguesByCode: Map<string, Set<string>> | null = null;
/** Which leagues use each four-character team code (built once from the team lists). */
function codeLeagues(): Map<string, Set<string>> {
  if (leaguesByCode) return leaguesByCode;
  const m = new Map<string, Set<string>>();
  for (const l of Object.keys(LEAGUES)) for (const t of teamsOf(l as LeagueId)) { const c = code(teamCodeOf(t)); const s = m.get(c) ?? new Set<string>(); s.add(l); m.set(c, s); }
  leaguesByCode = m;
  return m;
}
/** The team's own code in its league, unique within the league (a fifth letter when two codes share their first four). */
function teamCode(abbr: string, league: string | null | undefined): string {
  const A = code(abbr);
  if (!league || !(league in LEAGUES)) return A;
  const full = abbr.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (full.length > 4 && teamsOf(league as LeagueId).some((t) => code(teamCodeOf(t)) === A && teamCodeOf(t).toUpperCase().replace(/[^A-Z0-9]/g, "") !== full)) return full.slice(0, 5);
  return A;
}

export type TeamWindow = "season" | "post" | "next" | "perpetual" | "title" | "game";
export function teamTicker(abbr0: string, o: { league?: string | null; window?: TeamWindow | null; games?: number | null; outcome?: "win" | "loss" | "draw" | "windraw" | "drawloss" | "winloss" | null; inverse?: boolean }): string {
  // QA pass 9 #29: a default ticker starts with the team's conventional display code ($MCI, not $MNC); the pin abbreviation is unchanged
  const abbr = o.league && o.league in LEAGUES ? displayAbbr(o.league as LeagueId, abbr0) : abbr0;
  const A = teamCode(abbr, o.league);
  const shared = !!o.league && (codeLeagues().get(code(abbr))?.size ?? 0) > 1;
  const tag = shared ? LEAGUE_TAG[o.league!] ?? code(o.league!, 3) : "";
  if (o.window === "title") return `${A}${CHAMP[o.league ?? ""] ?? "CHAMP"}`.slice(0, 10);
  // two of the three results (soccer): both words, short form both initials ($ARSWINDRAW, $ARSWD), never the fade side's NOLOSS
  const pair = o.outcome === "windraw" ? ["WINDRAW", "WD"] : o.outcome === "drawloss" ? ["DRAWLOSS", "DL"] : o.outcome === "winloss" ? ["WINLOSS", "WL"] : null;
  const word = o.outcome === "loss" ? "LOSS" : o.outcome === "draw" ? "DRAW" : "WIN";
  const sides = pair ?? (o.inverse ? [`NO${word}`, `NO${word[0]}`] : [word, word[0]]);
  const wins = o.window === "post" ? ["PO", "PO"] : o.window === "next" ? [`NEXT${o.games ?? 5}`, `N${o.games ?? 5}`] : o.window === "perpetual" ? ["ALL", "A"] : o.window === "game" ? ["GM", "G"] : ["", ""];
  // the league tag comes first after the code and keeps at least its first letter; the full words first, then the short window, then
  // the short side as well
  const combos = [`${sides[0]}${wins[0]}`, `${sides[0]}${wins[1]}`, `${sides[1]}${wins[1]}`];
  const rest = combos.find((c) => A.length + Math.min(tag.length, 1) + c.length <= 10) ?? combos[2];
  const room = Math.max(0, 10 - A.length - rest.length);
  return `${A}${tag.slice(0, Math.max(room, Math.min(tag.length, 1)))}${rest}`.slice(0, 10);
}
