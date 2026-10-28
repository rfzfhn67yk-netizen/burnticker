import { periodStartMs } from "@/lib/burnticker/periodStart";
/**
 * A DAY READING'S GAMES (2026-10-20, the launch-day cut): each game counted in a day reading, with its start and, when a store kept it,
 * when its final was first read. Stored in the reading's proof (JSON) so the keeper can tell, for a coin launched that day, whether a
 * game was over before the launch (countsAfterLaunch below). Not part of the reading's identity (putReadings compares the value).
 */
export interface GameTime {
  id: string; start: string; final: string | null; /** the game's league (the over bound below) */ league?: string;
  /** THE LIVE SIGHTING (2026-10-21, BT-LAUNCH-CUT-LONG-01): the last time a keeper read of the schedule saw the game NOT final (the fetch
   *  time of that listing, gameSettle.ts noteLiveSightings). Absent on readings stored before it was recorded, and when no read saw it. */
  lastSeenLiveAt?: string;
}
export const GAME_TIMES_PROOF_KIND = "game-times";
export const gameTimesProof = (games: readonly GameTime[]): string => JSON.stringify({ kind: GAME_TIMES_PROOF_KIND, games });
/** The games of a day reading's proof, or null (an older reading, or not a game reading). */
export function gameTimesOf(proof: string | null | undefined): GameTime[] | null {
  if (!proof || proof[0] !== "{") return null;
  try {
    const j = JSON.parse(proof) as { kind?: string; games?: unknown };
    if (j.kind !== GAME_TIMES_PROOF_KIND || !Array.isArray(j.games)) return null;
    const out = j.games.filter((x): x is GameTime => !!x && typeof (x as GameTime).start === "string" && Number.isFinite(Date.parse((x as GameTime).start)));
    return out.length ? out : null;
  } catch { return null; }
}


/**
 * THE LAUNCH-DAY CUT (2026-10-20, devnet 108: the 76ers–Knicks final read for both sides, nothing burned). A game reading is keyed by
 * the game's UTC day ("2026-10-20"), and Registry.readings compares settled_at > baselineAt as TEXT, so "2026-10-20" sorted before a
 * coin's "2026-10-20T23:58:15.000Z" and every game coin launched on its game's UTC day (the normal case) could never burn. For a sports
 * selector (catalogue:espn.*) a day reading is now judged by calendar day and by its games:
 *   - with the reading's game times (gameTimesOf below): it counts unless one of its games was over before the launch — its
 *     final first read before the launch (game coins and, through the FINAL CHECK, team, season and
 *     rivalry coins record when the final was first read), or its start more than gameOverBoundMs (4 h, or 5 h for MLB and American
 *     football) before the launch with no keeper read seeing it still not final at or after the launch (gameCountsAfterLaunch below).
 *     A game in progress at the launch counts
 *     (the wizard allows a launch during a game; a game coin on a game already final is refused at launch, oneShotEligibility.ts).
 *     A DOUBLEHEADER day whose first game was over before the launch is dropped WHOLE: the day is one reading with one value, which
 *     cannot be split, so its later game does not count either.
 *   - a reading stored before the game times were recorded: a later day counts; the launch day counts when the reading was written
 *     (fetched_at) at or after the launch, so it was not known before it; an earlier day never counts.
 * Every other reading (full timestamps: Kalshi, Polymarket; other day-keyed feeds) keeps the plain comparison. The cut runs at query
 * time, so readings already stored count once the keeper runs this build.
 */
/**
 * When no read recorded a game's final before the launch, a game is taken as over this long after its start (owner 2026-10-20: "no
 * passed events apply"): five hours for MLB and American football (NFL, college), four for the rest (NBA, WNBA, NHL, college
 * basketball, soccer). A league not recorded (none today) takes five.
 */
export function gameOverBoundMs(league: string | null | undefined): number {
  return !league || league === "mlb" || league === "nfl" || league === "cfb" ? 5 * 3_600_000 : 4 * 3_600_000;
}
/**
 * One game of a day reading against a launch (THE LAUNCH-DAY CUT above; 2026-10-21 BT-LAUNCH-CUT-LONG-01, a long game). Over before the
 * launch, so not counted, when its final was first read before the launch. Otherwise it counts when the launch was inside the bound
 * (gameOverBoundMs after its start), or, past the bound, when a keeper read SAW IT NOT FINAL at or after the launch (lastSeenLiveAt): an
 * extra-inning game or a double overtime still being played at the launch counts. A later first read of the final alone is not enough
 * past the bound (a coin launched after an unwatched game ended would otherwise count it), so a game nobody saw live that late is taken
 * as over. A reading stored before the sighting was recorded has none, which is the rule before this change.
 */
export function gameCountsAfterLaunch(g: GameTime, launch: number): boolean {
  const f = g.final ? Date.parse(g.final) : NaN;
  if (Number.isFinite(f) && f < launch) return false;
  if (Date.parse(g.start) + gameOverBoundMs(g.league) > launch) return true;
  const seen = g.lastSeenLiveAt ? Date.parse(g.lastSeenLiveAt) : NaN;
  return Number.isFinite(seen) && seen >= launch;
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * A WEEK OR QUARTER READING (2026-10-28, $GASCAT's weekly feed): "2026-W10" sorts AFTER "2026-10-27T…" as text, so every week since
 * the feed's first row counted as after the launch (35 pre-launch weeks were planned as burns). A week or quarter counts when it
 * STARTS after the launch (its Monday, its first day), as a day or month feed's first counted period is the first that starts after it.
 */
const LONG_PERIOD_RE = /^\d{4}-(W\d{2}|Q[1-4])$/;
export const isSportsSelector = (key: string): boolean => key.startsWith("catalogue:espn.");
export function countsAfterLaunch(r: { at: string; proof?: string | null; fetchedAt?: number | null }, baselineAt: string | null, sports: boolean): boolean {
  if (!baselineAt) return true;
  if (LONG_PERIOD_RE.test(r.at)) { const start = periodStartMs(r.at), launch = Date.parse(baselineAt); return Number.isFinite(start) && Number.isFinite(launch) ? start > launch : r.at > baselineAt; }
  if (!sports || !DAY_RE.test(r.at)) return r.at > baselineAt;
  const launch = Date.parse(baselineAt);
  if (!Number.isFinite(launch)) return r.at > baselineAt;
  const launchDay = new Date(launch).toISOString().slice(0, 10);
  const prevDay = new Date(launch - 86_400_000).toISOString().slice(0, 10);
  const games = gameTimesOf(r.proof);
  if (games) {
    if (r.at < prevDay) return false;
    return games.every((g) => gameCountsAfterLaunch(g, launch));
  }
  if (r.at > launchDay) return true;
  return r.at === launchDay && typeof r.fetchedAt === "number" && Number.isFinite(r.fetchedAt) && r.fetchedAt >= launch;
}
/** A coin's readings after its launch (THE LAUNCH-DAY CUT above): Registry.readings widened by two days, then judged per reading. */
export function readingsAfterLaunch<R extends { at?: string; proof?: string | null; fetchedAt?: number | null }>(reg: { readings(key: string, sinceIso?: string | null): readonly R[] }, key: string, baselineAt: string | null | undefined): R[] {
  if (!baselineAt) return [...reg.readings(key, null)];
  if (!isSportsSelector(key)) return reg.readings(key, baselineAt).filter((r) => r.at === undefined || countsAfterLaunch({ ...r, at: r.at }, baselineAt, false));
  const launch = Date.parse(baselineAt);
  const since = Number.isFinite(launch) ? new Date(launch - 2 * 86_400_000).toISOString().slice(0, 10) : baselineAt;
  return reg.readings(key, since).filter((r) => r.at === undefined || countsAfterLaunch({ ...r, at: r.at }, baselineAt, true));
}
