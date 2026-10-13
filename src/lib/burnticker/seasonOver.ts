import type { BurnRule } from "@/lib/burnticker/rules";
import { parseEspnSeries, seasonLabel, seasonYearAt, teamByAbbr, teamSeries, type Game, type LeagueId } from "@/lib/burnticker/sources/espn";
import { teamRef } from "@/lib/burnticker/describe";

/**
 * A TEAM WHOSE SEASON IS OVER (sources-7, QA walkthrough 11 H6: the Rockies, out of the 2026 MLB season, reached Review with "After each
 * Rockies win" and the default name "Rockies 2026 Wins"; the deep link from the league page never warned). A season or postseason rule on
 * such a team would end at once and send its pool to $DEFICIT, so the review lists it as a problem and the bundle refuses it, both with
 * the same sentence and the same offer: the team's next season (the same rule a year on) or a coin on next season's title market.
 *
 * `seasonStatus` reads the league's schedule for the next days (ChatGPT audit 6 item 2): `over` = every open game is a postseason game
 * and the team has none of them. The schedule is read through a port (the platform's `seasonSchedule`), so tests and hosts without a
 * schedule never read the network; a schedule that cannot be read, or answers late, refuses nothing.
 */
export const SEASON_OVER_LINE = "Season over for this team: this coin would end right away and its pool would go to $DEFICIT.";
/** The league page's line beside a team whose season is over (its link opens the launch page with `season=over`). */
export const SEASON_OVER_LINK_LINE = "This team's season is over. A coin on it can follow next season, or next season's title market.";

export function seasonStatus(abbr: string, games: readonly Game[], readable: boolean): { status: "upcoming" | "none-listed" | "unknown" | "over"; warning: string | null } {
  if (!readable) return { status: "unknown", warning: "This league's schedule could not be read, so whether this team has games left is not known." };
  const open = games.filter((g) => !g.completed);
  if (open.some((g) => g.home.abbr === abbr || g.away.abbr === abbr)) return { status: "upcoming", warning: null };
  if (open.length && open.every((g) => g.seasonType === 3)) return { status: "over", warning: SEASON_OVER_LINE };
  return { status: "none-listed", warning: "No game is listed for this team in the next 8 days. A season coin only burns on games still to come." };
}

export interface SeasonOverRefusal { code: "season-over"; status: 409; message: string; next: { series: string; year: number; label: string; window: "season" | "post" } }

/** The team's season or postseason window from a rule (null: not a team season rule). */
function seasonOf(rule: Pick<BurnRule, "oracle" | "series">): { league: LeagueId; abbr: string; outcome: Parameters<typeof teamSeries>[2]; year: number; window: "season" | "post" } | null {
  const e = rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series) : null;
  if (!e || e.kind !== "team" || (e.window.kind !== "season" && e.window.kind !== "post")) return null;
  return { league: e.league, abbr: e.abbr, outcome: e.outcome, year: e.window.year, window: e.window.kind };
}

/**
 * The refusal for a season rule whose team's season is over (call it only once the schedule says so, or for an earlier season); null
 * for any other rule. The offer is the next season that has not started: the season after the rule's, and never one before the current.
 */
export function seasonOverRefusal(rule: Pick<BurnRule, "oracle" | "series">, now: number = Date.now()): SeasonOverRefusal | null {
  const s = seasonOf(rule);
  if (!s) return null;
  const nextYear = Math.max(s.year + 1, seasonYearAt(s.league, now));
  const team = teamByAbbr(s.league, s.abbr), ref = team ? teamRef(s.league, team.nickname) : s.abbr;
  const Ref = ref[0].toUpperCase() + ref.slice(1);
  const label = seasonLabel(s.league, s.year), nextLabel = seasonLabel(s.league, nextYear);
  let series: string;
  try { series = teamSeries(s.league, s.abbr, s.outcome, { kind: s.window, year: nextYear }); } catch { return null; }
  const what = s.window === "post" ? "postseason" : "season";
  return {
    code: "season-over", status: 409,
    message: `${Ref} have no games left in the ${label} ${what}, so a coin on it would end right away and its pool would go to $DEFICIT. Pick the ${nextLabel} ${what} instead, or a coin on next season's title market from the event list.`,
    next: { series, year: nextYear, label: nextLabel, window: s.window },
  };
}

/** The platform's schedule port: the league's games for the next `days` days. */
export type SeasonSchedule = (league: LeagueId, days: number) => Promise<Game[]>;

/**
 * One bounded schedule read (default 3 seconds), then the refusal when the team's season is over. Null on any other answer.
 * sources-7 round 2 (WIRING-WEBSITE25-REQUESTS H6: the offered 2027 season was refused as over too, because a season that has not
 * started lists no games either): only the CURRENT season (espn.ts seasonYearAt) is read against the schedule; a later season is never
 * over (the review says it is not listed yet, seasonNotStartedLine); an earlier season is over without a read.
 */
export async function seasonOverFor(rule: unknown, schedule: SeasonSchedule | null | undefined, o: { timeoutMs?: number; now?: number } = {}): Promise<SeasonOverRefusal | null> {
  const r = rule && typeof rule === "object" ? rule as Pick<BurnRule, "oracle" | "series"> : null;
  const s = r ? seasonOf(r) : null;
  const now = o.now ?? Date.now();
  if (!s) return null;
  const cur = seasonYearAt(s.league, now);
  if (s.year > cur) return null;
  if (s.year < cur) return seasonOverRefusal(r!, now);
  if (!schedule) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const games = await Promise.race([schedule(s.league, 8).catch(() => null), new Promise<null>((res) => { timer = setTimeout(() => res(null), o.timeoutMs ?? 3_000); })]);
  clearTimeout(timer);
  return games && seasonStatus(s.abbr, games, true).status === "over" ? seasonOverRefusal(r!, now) : null;
}

/** A season rule on a season that has not started yet: said as a warning (its games are not listed yet), never refused. Null otherwise. */
export function seasonNotStartedLine(rule: unknown, now: number = Date.now()): string | null {
  const r = rule && typeof rule === "object" ? rule as Pick<BurnRule, "oracle" | "series"> : null;
  const s = r ? seasonOf(r) : null;
  if (!s || s.year <= seasonYearAt(s.league, now)) return null;
  return `The ${seasonLabel(s.league, s.year)} ${s.window === "post" ? "postseason" : "season"} has not started, so its games are not listed yet. This coin counts them once they are on the schedule and played.`;
}
