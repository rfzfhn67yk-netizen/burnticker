import { isFallbackGame, meetingOutcome, noPlayoffs, parseEspnSeries, seasonLabel, seasonYearAt, type Game, type LeagueId } from "@/lib/burnticker/sources/espn";
import { seasonStatus, type SeasonSchedule } from "@/lib/burnticker/seasonOver";
import type { TeamSeasonReader } from "@/lib/burnticker/lastSeason";
import { MEETINGS_NONE_LEFT_LINE, MEETINGS_NONE_LINE, meetingsNoneLeftWarning } from "@/lib/burnticker/guidedLaunch";

/**
 * HB-72 consistency (hourly run 7): ONE RULE for "Every game between them this season" on the page, the review and the prepare.
 *
 *   - a meeting is still to be played: offered, nothing said;
 *   - no meeting is left, but the two can still meet in the playoffs this season: offered, with meetingsNoneLeftWarning on the page and in
 *     the review ("This pair burns only if they meet in the playoffs");
 *   - no meeting is left and none is possible (the league has no playoffs, or either team's season is over), or the schedule lists no game
 *     between them at all: greyed on the page with the line, refused by the review (a problem) and by the prepare (409, the same line);
 *   - the schedule cannot be read: nothing is said and nothing is refused (as seasonOver.ts does).
 *
 * "Can still meet in the playoffs" is read from the league's schedule for the next days (seasonOver.ts seasonStatus: a team is over once
 * every open game is a playoff game and it has none). The schedule source cannot show a bracket, so two live teams are taken as able to
 * meet. When that league read is not available, the fallback is the regular season: while team A still has a regular-season game to
 * play the pair is offered with the warning, and after that it is refused.
 */
export type MeetingsVerdict =
  | { state: "open" }
  | { state: "playoffs"; warning: string }
  | { state: "none"; line: string }
  | { state: "unknown" };

export interface MeetingsInput {
  league: LeagueId; abbr: string; opp: string; year: number;
  /** team A's games for the season (null: not read) */ season: readonly Game[] | null;
  /** the league's games for the next days (null: not read) */ upcoming: readonly Game[] | null;
  now?: number;
}

export function meetingsVerdict(i: MeetingsInput): MeetingsVerdict {
  const now = i.now ?? Date.now(), cur = seasonYearAt(i.league, now);
  // a later season has not started (its games are not listed yet); an earlier one is refused by seasonOver.ts
  if (i.year > cur) return { state: "unknown" };
  if (!i.season) return { state: "unknown" };
  const meetings = i.season.filter((g) => (g.home.abbr === i.opp && g.away.abbr === i.abbr) || (g.away.abbr === i.opp && g.home.abbr === i.abbr));
  if (!meetings.length) return { state: "none", line: MEETINGS_NONE_LINE };
  if (meetings.some((g) => meetingOutcome(g, i.abbr) === "pending")) return { state: "open" };
  const refused = { state: "none" as const, line: MEETINGS_NONE_LEFT_LINE };
  if (noPlayoffs(i.league) || i.year < cur) return refused;
  const warned = { state: "playoffs" as const, warning: meetingsNoneLeftWarning(seasonLabel(i.league, i.year), true) };
  if (i.upcoming && !i.upcoming.some(isFallbackGame)) {
    const over = seasonStatus(i.abbr, i.upcoming, true).status === "over" || seasonStatus(i.opp, i.upcoming, true).status === "over";
    return over ? refused : warned;
  }
  // fallback: the league read is missing, so whether a playoff meeting is possible cannot be read; offered while the regular season runs
  const regularLeft = i.season.some((g) => (g.home.abbr === i.abbr || g.away.abbr === i.abbr) && g.seasonType !== 3 && !g.completed && meetingOutcome(g, i.abbr) === "pending");
  return regularLeft ? warned : refused;
}

const bounded = async <T,>(p: Promise<T>, ms: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const r = await Promise.race([p.catch(() => null), new Promise<null>((res) => { timer = setTimeout(() => res(null), ms); })]);
  clearTimeout(timer);
  return r;
};

/** The verdict for a rule (null: not a rivalry series rule), from the two schedule ports, each read at most `timeoutMs` (default 3 s), in parallel. */
export async function meetingsVerdictFor(rule: unknown, ports: { season?: TeamSeasonReader | null; schedule?: SeasonSchedule | null }, o: { timeoutMs?: number; now?: number } = {}): Promise<MeetingsVerdict | null> {
  const r = rule && typeof rule === "object" ? (rule as { oracle?: unknown; series?: unknown }) : null;
  const e = r && r.oracle === "catalogue" && typeof r.series === "string" ? parseEspnSeries(r.series) : null;
  if (!e || e.kind !== "team" || e.window.kind !== "meetings") return null;
  const w = e.window, ms = o.timeoutMs ?? 3_000;
  const [season, upcoming] = await Promise.all([
    ports.season ? bounded(ports.season(e.league, e.abbr, w.year), ms) : Promise.resolve(null),
    ports.schedule ? bounded(ports.schedule(e.league, 8), ms) : Promise.resolve(null),
  ]);
  return meetingsVerdict({ league: e.league, abbr: e.abbr, opp: w.opp, year: w.year, season, upcoming, now: o.now });
}

/** The prepare's refusal (409) for a verdict that refuses; null otherwise. */
export function meetingsRefusal(v: MeetingsVerdict | null): { status: 409; code: "meetings-none-left"; message: string } | null {
  return v && v.state === "none" ? { status: 409, code: "meetings-none-left", message: v.line } : null;
}
