import type { BurnRule } from "@/lib/burnticker/rules";
import { drainPct, spentFraction } from "@/lib/burnticker/drain";
import { LEAGUES, isMeetingOf, outcomeOf, parseEspnSeries, seasonLabel, seasonYearAt, teamByAbbr, type Game, type LeagueId, type MeetingsSeries } from "@/lib/burnticker/sources/espn";
import { firingOf } from "@/lib/burnticker/simulator";

/**
 * LAST SEASON'S BACKTEST FOR TEAM COINS (cheap-features pass item 5, owner 2026-10-13). The review said "Backtest unavailable" for every
 * team coin, because team schedules are read live and have no saved sample (projection.ts). The schedule readers can read a past season
 * (EspnClient.season(league, team, year): MLB StatsAPI, the NHL feed, the NBA feed or TheSportsDB with its key; never ESPN), so the
 * review now says "This rule would have burned 98 times last season (2025), in 162 games." from the team's previous season, counted the
 * way the keeper counts: a completed game whose result is the rule's (a win, a loss or a draw; the fade side counts the games without it),
 * inside the rule's window (a postseason rule counts postseason games only; a rivalry series counts the games between the two teams).
 *
 * The reader is a port (`TeamSeasonReader`), so tests and hosts without a schedule never read the network; a reader that fails or
 * answers late leaves `available: false` with the reason, and the review keeps its projection's sentence. One game's rule (a single
 * game or a title) has no season to count and says so.
 */
export type TeamSeasonReader = (league: LeagueId, abbrOrId: string, year: number) => Promise<Game[]>;

export interface LastSeasonBacktest {
  available: boolean; reason: string | null;
  league: string | null; year: number | null; season: string | null;
  games: number; burns: number; spentPct: number | null; sentence: string | null; lines: string[];
}

const none = (reason: string, extra: Partial<LastSeasonBacktest> = {}): LastSeasonBacktest => ({ available: false, reason, league: null, year: null, season: null, games: 0, burns: 0, spentPct: null, sentence: null, lines: [], ...extra });

/** The season before the rule's own (a season or postseason rule names its year; a repeating rule counts from the season in progress). */
export function previousSeasonOf(rule: Pick<BurnRule, "oracle" | "series">, now: number): { league: LeagueId; year: number } | null {
  const e = rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series) : null;
  if (!e || e.kind !== "team") return null;
  const w = e.window;
  const own = w.kind === "season" || w.kind === "post" || w.kind === "meetings" ? w.year : seasonYearAt(e.league, now);
  return { league: e.league, year: own - 1 };
}

/** Counts last season's burns for a team rule from the games a reader returned (pure: the review route reads, this counts). */
export function countLastSeason(rule: BurnRule, games: readonly Game[], year: number): LastSeasonBacktest {
  const e = rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series) : null;
  if (!e || e.kind !== "team") return none("This is not a team rule, so there is no season to count.");
  const w = e.window;
  const league = e.league, season = seasonLabel(league, year);
  let pool = games.filter((g) => g.completed);
  if (w.kind === "post" || (w.kind === "legacy" && w.scope === "post")) pool = pool.filter((g) => g.seasonType === 3);
  if (w.kind === "legacy" && w.scope === "reg") pool = pool.filter((g) => g.seasonType !== 3);
  if (w.kind === "meetings") pool = pool.filter((g) => isMeetingOf(e as MeetingsSeries, g));
  const results = pool.map((g) => outcomeOf(g, e.abbr, e.teamId)).filter((x): x is NonNullable<typeof x> => x !== null);
  if (!results.length) return none(`No completed game was found for this team in the ${season} season${w.kind === "post" ? "'s postseason" : ""}, so there is nothing to count.`, { league, year, season });
  const want = e.outcome === "draw" ? "tie" : e.outcome;
  const hit = (r: string) => (r === want || (e.outcome === "draw" && r === "draw"));
  const burns = results.filter((r) => (rule.inverse ? !hit(r) : hit(r))).length;
  const f = firingOf(rule).share;
  const spent = f !== null && f > 0 && f < 1 ? Math.round(spentFraction(Array.from({ length: burns }, () => 1), f) * 10_000) / 100 : null;
  const team = teamByAbbr(league, e.abbr)?.nickname ?? e.abbr;
  const games_ = results.length;
  const noun = games_ === 1 ? "game" : "games";
  const what = w.kind === "post" ? `${team} postseason ${noun}` : w.kind === "meetings" ? `${team} ${noun} against the ${teamByAbbr(league, w.opp)?.nickname ?? w.opp}` : `${team} ${noun}`;
  const sentence = `This rule would have burned ${burns} ${burns === 1 ? "time" : "times"} last season (${season}), in ${games_} ${what}.`;
  const lines = [sentence];
  if (w.kind === "next") lines.push(`This coin follows ${w.n} ${w.n === 1 ? "game" : "games"}, not a whole season, so it burns at most ${w.n} ${w.n === 1 ? "time" : "times"}.`);
  if (spent !== null) lines.push(`At ${Math.round(f! * 1000) / 10}% each, that would have spent ${drainPct(spent / 100)} of a burn pool that got no new fees.`);
  lines.push("Counted from the league's own schedule for that season. Past results say nothing about the next season.");
  return { available: true, reason: null, league, year, season, games: games_, burns, spentPct: spent, sentence, lines };
}

/** Reads the previous season through the port (bounded by `timeoutMs`) and counts it; never throws. */
export async function lastSeasonBacktest(rule: unknown, reader: TeamSeasonReader | null | undefined, o: { now?: number; timeoutMs?: number } = {}): Promise<LastSeasonBacktest | null> {
  const r = rule && typeof rule === "object" ? (rule as BurnRule) : null;
  if (!r || r.oracle !== "catalogue" || typeof r.series !== "string") return null;
  const e = parseEspnSeries(r.series);
  if (!e) return null;
  if (e.kind === "game") return none("This rule follows one game, so there is no season to count.");
  const prev = previousSeasonOf(r, o.now ?? Date.now());
  if (!prev) return null;
  if (!reader) return none("This site does not read past schedules, so last season cannot be counted here.", { league: prev.league, year: prev.year, season: seasonLabel(prev.league, prev.year) });
  if (!(prev.league in LEAGUES)) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const key = e.teamId ?? e.abbr;
    const games = await Promise.race([reader(prev.league, key, prev.year), new Promise<null>((res) => { timer = setTimeout(() => res(null), o.timeoutMs ?? 3_000); })]);
    if (!games) return none("Last season's schedule did not answer in time, so it was not counted.", { league: prev.league, year: prev.year, season: seasonLabel(prev.league, prev.year) });
    return countLastSeason(r, games, prev.year);
  } catch {
    return none("Last season's schedule could not be read, so it was not counted.",{ league: prev.league, year: prev.year, season: seasonLabel(prev.league, prev.year) });
  } finally { clearTimeout(timer); }
}
