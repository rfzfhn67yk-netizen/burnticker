import type { SettledEvent } from "@/lib/burnticker/units";
import { gameTimesProof, type GameTime } from "@/lib/burnticker/launchCut";
import type { ResolvedSelector } from "@/lib/burnticker/oracle/types";
import { clientBefore153, HB153_FROM_MS, liveScheduleLeague, tsdbLiveLeague, tsdbV1EventUrl, tsdbV2EventUrl, outcomeOf, LEAGUES, NBA_OFFICIAL_ANSWERS, TSDB_LEAGUE, tsdbFieldScores, outcomeHits, asMeetings, teamNameKey, dedupeListings, gamesFor, meetingsEndReason, ourTeam, seriesEndDay, tallyMeetings, teamById, teamByAbbr, tsdbNamePairs, windowStatus, type EspnClient, type EspnSeries, type Game, type GameSide, type LeagueId, type MeetingOutcome, type MeetingsSeries, type Outcome, apiSportsRefusal } from "@/lib/burnticker/sources/espn";

/**
 * HOW A TEAM COIN'S GAME SETTLES (owner, 2026-10-10). NO ESPN READS: the game list comes from the league's free official schedule (MLB
 * StatsAPI, the NHL's api-web), the NBA's feed when it answers (else TheSportsDB), or TheSportsDB v2 (licensed key) — espn.ts
 * EspnClient/SportsClient. Each completed game:
 *
 *   PRIMARY A  the game's ON-CHAIN PAYOUT where Polymarket lists a moneyline market (Gamma search by the two teams and the date → the
 *              condition id → the Conditional Tokens payout vector on Polygon), exactly as an election does; a soccer game is three
 *              yes/no conditions (home win, draw, away win) and all three payouts are read (threeWayRead);
 *   PRIMARY B  otherwise THESPORTSDB (commercial licence, BURNTICKER_THESPORTSDB_KEY, the v2 API): the final score;
 *   CONFIRMED  by a SECOND, independent operator: the on-chain payout and TheSportsDB confirm each other when both exist; the league's
 *              official feed (MLB, NHL, and the NBA's when it answers) is a further read where it is free; API-Sports (BURNTICKER_APISPORTS_KEY) is optional.
 *              Every read must agree (scores where both carry scores, else the winner).
 *   ONE SOURCE (owner, 2026-10-14: "TheSportsDB should be enough to validate"): a final game with NO Polymarket market and no second
 *              operator that can read it (no counted league feed, no API-Sports key) settles on TheSportsDB alone, but only once the same
 *              final score has stood across re-reads for SINGLE_SOURCE_HOLD_MS (12 h). The first-seen score and time live in the keeper's
 *              hold store (GameDeps.holds, persisted in the registry's status table: statusHoldStore), so the hold survives a restart; a
 *              changed score starts the hold again. Where a counted league feed exists it must agree instead, and no hold applies.
 *
 *   GAME COINS (owner, 2026-10-16): a single-game coin (series kind `game`: NBA/NFL/MLB/NHL/soccer game coins and both coins of a game
 *              pair) has ONE burn schedule (owner, 2026-10-18 evening: "game results are final when the game ends"; the 12-hour wait
 *              is gone; owner, 2026-10-20: "coins should burn right after the final whistle and wait for a second verification 5 min
 *              later"). Its reading is released once one operator (TheSportsDB, the game's on-chain settlement, a league feed,
 *              API-Sports) has shown the same final on two keeper reads at least GAME_CONFIRM_GAP_MS (5 minutes) apart and every source
 *              that answered agrees. Two sources agreeing on the first read no longer burn at once (2026-10-20): they too wait for the
 *              second read. Each operator's latest read is persisted in the status table (FIRST_READ_STATUS_KEY,
 *              keyed by gameKeyOf(game)), so a keeper restart keeps it and both coins of a pair share it. Every source that answers must
 *              agree; a disagreement holds the game (the refusal carries "≠", so feedHealth raises the disagree alert) until they agree.
 *              A source that never answers does not delay the burn: one is enough. A corrected result starts the count again.
 *              Team, season, series and champion coins keep the rules above (gameSchedule is used only for series kind `game`).
 *
 *   WHEN A GAME IS READ (owner, 2026-10-20). Until then no game was read before its start plus six hours (SETTLE_AFTER_START_MS, from the
 *              first ESPN reader of 2026-10-10: a margin for the game to end, overtime included, and for the feeds to post and correct
 *              the final, at a time when one read settled a game). Now a game is read as soon as the schedule marks it final, and while
 *              it is being played the schedule is looked at every GAME_LIVE_POLL_MS from GAME_FIRST_LOOK_MS after its start, so the final
 *              is noticed within minutes. What the six hours protected against is kept by reads instead of waiting: every source must
 *              say final (a game still live, or sent to overtime, is never read as final), the result must be read again at least
 *              GAME_CONFIRM_GAP_MS later and agree (a feed that marks a game final early or wrongly, or corrects its score, is caught
 *              by the second read: a change starts the count again), a source that had a final and then answers "not final" starts
 *              the count again (UNFINAL in gameSchedule; the team-coin check below), disagreements still hold the game, postponed,
 *              suspended and cancelled games still count for neither side, and a team coin still needs two independent operators (or
 *              TheSportsDB alone after its 12-hour hold). A TEAM, SEASON or RIVALRY coin's game is confirmed the same way (FINAL CHECK,
 *              finalCheck below): its first agreeing settlement is stored in the status table (FINAL_CHECK_STATUS_KEY) and it settles
 *              only on a later read, fetched at least GAME_CONFIRM_GAP_MS after the first, that agrees; a keeper restart keeps the
 *              first read, so a restart never settles a game on one read.
 *
 * Every reading says how it settled: "settled on the game's on-chain payout · confirmed by MLB's official feed", plus a plain human
 * link to ESPN's scoreboard for that day ("see this game on ESPN →", never fetched).
 */

/**
 * `pens`: the feed marks the game decided on penalties (a cup tie level after extra time). `declared`: the side the feed names as the
 * winner (API-Sports' teams.home.winner / teams.away.winner). Owner decision 2026-10-12 (website-20 item 78): a level game decided on
 * penalties counts as a WIN for the declared winner and a LOSS for the other side, never a draw; espn.ts outcomeOf reads it the same way.
 */
export interface Final { home: number; away: number; done: boolean; detail: string; url: string; pens?: boolean; declared?: "home" | "away" | null; /** the feed marks the game decided in extra time (AET) */ aet?: boolean; /** the row cannot be read the right way round (which score is whose): settleGame holds the game */ unresolved?: string }
/**
 * A game's Polymarket market. A two-sided moneyline (every sport but soccer) is one condition whose two outcomes name the two teams.
 * A SOCCER game is THREE yes/no markets inside one event ("Will Arsenal FC win on 2026-10-10?", "Will Arsenal FC vs. Leeds United FC
 * end in a draw?", "Will Leeds United FC win on 2026-10-10?"): `threeWay` carries the three condition ids and the two team names as
 * Polymarket writes them; `conditionId` is then the home leg's (the one a receipt links to first).
 */
export interface GameMarket { conditionId: string; question: string; outcomes: [string, string]; url: string; threeWay?: { home: string; draw: string; away: string; homeName: string; awayName: string } }
export interface GamePayout { resolved: boolean; outcome: number | null; /** when this vector was read from the RPC (absent: now) */ fetchedAt?: number }
export interface GameDeps {
  tsdbKey: string | null;
  apiSportsKey: string | null;
  /** Gamma search for the game's moneyline market (null: Polymarket discovery off on this host). */
  market: ((g: Game) => Promise<GameMarket | null>) | null;
  /** The CTF payout vector on Polygon for a condition id. */
  payout: ((conditionId: string, o?: { /** read the RPC again, whatever is cached: a game coin's confirming read */ fresh?: boolean }) => Promise<GamePayout | null>) | null;
  /** The single-source hold store (null or absent: a game only TheSportsDB can read waits, it never settles). The keeper's is persistent. */
  holds?: SingleSourceHolds | null;
  /** The clock the hold reads (the keeper's wall clock; tests and the season rehearsal move it). */
  now?: () => number;
  /** Measure-only: called when a game settles on one source (the keeper logs it and raises bt-single-source the first time per coin). */
  onSingleSource?: ((e: { seriesId: string | null; game: Game; final: { home: number; away: number }; heldSince: number; settledBy: string }) => void) | null;
  /** A game coin's first-read store (GAME COINS above; null or absent: a game coin waits, it never settles). The keeper's is persistent. */
  firstReads?: FirstReadStore | null;
  /** A team, season or rivalry coin's FINAL CHECK store (owner 2026-10-20; finalCheck). Absent: no second read is asked for (the site's
   *  display, back-tests, the season rehearsal); the keeper's is persistent (statusFinalCheckStore), so a restart never settles on one read. */
  finalChecks?: FinalCheckStore | null;
  /** Called when a game's count starts again (a changed final, a source no longer saying final, a disagreement): the keeper logs why. */
  onFinalCheck?: ((e: { game: Game; why: string }) => void) | null;
  /** THE LIVE SCHEDULE READ (espn.ts LIVE_SCHEDULE_TTL_MS; the keeper sets it): a league with a tracked game in play, or final and not
   *  yet confirmed, is marked live on the client, so its free official schedule is read about every minute and the next read comes sooner. */
  liveSchedule?: boolean;
}

/** How long a TheSportsDB-only final must stand unchanged before it settles (owner, 2026-10-14). */
export const SINGLE_SOURCE_HOLD_MS = 12 * 3_600_000;
/** What a reading and a receipt say about a game settled on TheSportsDB alone. */
export const SINGLE_SOURCE_SETTLED_BY = "TheSportsDB only, confirmed after a 12 h hold";
/** The first time a TheSportsDB-only final was seen with this score. */
export interface HoldMark {
  home: number; away: number; firstSeenAt: number;
  /** F-4 re-review: a second source (API-Sports, a league feed) read this game and disagreed with TheSportsDB at least once: never
   *  settled on TheSportsDB alone. Kept with the mark (the persistent store too). */
  disagreed?: boolean;
  /** Each second source's latest final for this game (API-Sports, a league feed), kept so a final read while TheSportsDB had none yet is
   *  still compared when TheSportsDB's final arrives, even if that source is quiet or out by then. Since 2026-10-18 the final's own
   *  words are kept too (detail, url, and a soccer final's penalties, extra time and declared winner), because API-Sports is not read
   *  again once its final is remembered (apiSportsWindow) and settleGame counts the remembered final as its read. */
  finals?: Record<string, RememberedFinal>;
  /** 2026-10-18 review: when API-Sports was read once more for a team coin's game after its read window had closed, because TheSportsDB
   *  first showed a final then (settleGame). Kept on every rewrite of the mark, so that late read is made once. */
  lateApiSportsAt?: number;
}
/** A second source's remembered final (HoldMark.finals). Marks written before 2026-10-18 carry only the score and the time. */
export interface RememberedFinal { home: number; away: number; at: number; detail?: string; url?: string; pens?: boolean; declared?: "home" | "away" | null; aet?: boolean }
/** A mark with no score held: a second source answered, so a TheSportsDB-only hold has to start again from the next read. */
const NO_SCORE = -1;
export interface SingleSourceHolds { get(key: string): HoldMark | null; set(key: string, m: HoldMark): void }
/** The hold's key for one game (a doubleheader's two games differ by their start). */
export const holdKeyOf = (g: Pick<Game, "league" | "eventId" | "startsAt">): string => `${g.league}:${g.eventId}:${g.startsAt}`;
/** An in-memory store (tests, the season rehearsal). */
export function memoryHoldStore(): SingleSourceHolds & { marks: Map<string, HoldMark> } {
  const marks = new Map<string, HoldMark>();
  return { marks, get: (k) => marks.get(k) ?? null, set: (k, m) => { marks.set(k, m); } };
}
/** The registry status key the keeper's hold store writes. */
export const HOLD_STATUS_KEY = "games.singleSourceHolds";
/**
 * An operator's release (releaseDispute) drops a source's reads from a game's record; this drops the same sources' remembered finals
 * from that game's hold marks (keyed league:eventId:startsAt), so a released final is not compared again (review 2026-10-18). Pure.
 */
export function releaseHoldFinals(marks: Record<string, HoldMark>, gameKey: string, ops: readonly string[]): { marks: Record<string, HoldMark>; changed: boolean } {
  let changed = false;
  const out: Record<string, HoldMark> = {};
  for (const [k, m] of Object.entries(marks)) {
    if (!k.startsWith(`${gameKey}:`) || !m?.finals || !ops.some((op) => m.finals![op])) { out[k] = m; continue; }
    const finals = Object.fromEntries(Object.entries(m.finals).filter(([op]) => !ops.includes(op)));
    out[k] = { ...m, finals };
    changed = true;
  }
  return { marks: out, changed };
}
const HOLD_KEEP_MS = 60 * 86_400_000;
/**
 * The keeper's PERSISTENT hold store: one JSON map in the registry's status table (HOLD_STATUS_KEY), read on every get and written on
 * every set, so a restart keeps each game's first-seen score and time. Marks older than 60 days are dropped when a mark is written,
 * EXCEPT a mark with `disagreed` set: its `firstSeenAt` does not move, and dropping it would let the game settle on TheSportsDB alone.
 */
export function statusHoldStore(reg: { getStatus(key: string): string | null; setStatus(key: string, value: unknown, now?: number): void }, now: () => number = Date.now): SingleSourceHolds {
  const read = (): Record<string, HoldMark> => { try { const v = JSON.parse(reg.getStatus(HOLD_STATUS_KEY) ?? "{}") as unknown; return v && typeof v === "object" ? v as Record<string, HoldMark> : {}; } catch { return {}; } };
  return {
    get: (k) => { const m = read()[k]; return m && Number.isFinite(m.firstSeenAt) && Number.isFinite(m.home) && Number.isFinite(m.away) ? m : null; },
    set: (k, m) => { const all = read(), t = now(); for (const [x, v] of Object.entries(all)) if (!v?.disagreed && !(t - Number(v?.firstSeenAt) < HOLD_KEEP_MS)) delete all[x]; all[k] = m; reg.setStatus(HOLD_STATUS_KEY, all, t); },
  };
}
/**
 * The 12-hour hold on a TheSportsDB-only final. The first read of a final records its score and time; a later read with the same score
 * settles once SINGLE_SOURCE_HOLD_MS has passed since then; a different score records the new one and starts the hold again.
 */
export function singleSourceHold(holds: SingleSourceHolds | null | undefined, g: Pick<Game, "league" | "eventId" | "startsAt">, f: { home: number; away: number }, now: number): { ready: true; since: number } | { ready: false; why: string; /** when the hold ends, if nothing changes */ due?: number } {
  if (!holds) return { ready: false, why: "only TheSportsDB can read this game (no Polymarket market, no league feed), and this process keeps no record of when its final score was first seen, so it is not settled here" };
  const k = holdKeyOf(g), m = holds.get(k);
  if (m?.disagreed) return { ready: false, why: "a second source disagreed with TheSportsDB on this game, so it is never settled on TheSportsDB alone; it waits for two sources that agree" };
  const kept = { ...(m?.finals ? { finals: m.finals } : {}), ...(m?.lateApiSportsAt !== undefined ? { lateApiSportsAt: m.lateApiSportsAt } : {}) };
  if (m && m.home === NO_SCORE) {
    holds.set(k, { home: f.home, away: f.away, firstSeenAt: now, ...kept });
    return { ready: false, due: now + SINGLE_SOURCE_HOLD_MS, why: `a second source answered for this game since the last read, so the 12-hour hold on TheSportsDB's final ${f.away}–${f.home} (away–home) starts again now` };
  }
  if (!m || m.home !== f.home || m.away !== f.away) {
    holds.set(k, { home: f.home, away: f.away, firstSeenAt: now, ...kept });
    return { ready: false, due: now + SINGLE_SOURCE_HOLD_MS, why: m ? `TheSportsDB changed its final from ${m.away}–${m.home} to ${f.away}–${f.home} (away–home), so the 12-hour hold starts again` : `TheSportsDB's final ${f.away}–${f.home} (away–home) was first seen now; with no Polymarket market and no league feed, it settles on TheSportsDB alone once it has stood for 12 hours` };
  }
  if (now - m.firstSeenAt < SINGLE_SOURCE_HOLD_MS) return { ready: false, due: m.firstSeenAt + SINGLE_SOURCE_HOLD_MS, why: `TheSportsDB's final ${f.away}–${f.home} (away–home) has stood since ${new Date(m.firstSeenAt).toISOString()}; it settles on TheSportsDB alone at ${new Date(m.firstSeenAt + SINGLE_SOURCE_HOLD_MS).toISOString()}` };
  return { ready: true, since: m.firstSeenAt };
}
/**
 * F-4 re-review (the hold must be continuous): a second source that can read this game ANSWERED (a final or not yet), so the game is not
 * one-source now. A running TheSportsDB-only hold is ended; the next read with that source out starts a new one, so a game settles on
 * TheSportsDB alone only after the second source has been out for the whole 12 hours. A disagreement mark is kept. When the answer is a
 * final (`final`), it is remembered on the mark (HoldMark.finals), even with no mark yet, so settleGame compares it with TheSportsDB's
 * final when that arrives, whether or not the second source still answers then.
 */
export function secondSourceAnswered(holds: SingleSourceHolds | null | undefined, g: Pick<Game, "league" | "eventId" | "startsAt">, now: number, final: ({ op: string } & Omit<RememberedFinal, "at">) | null = null): void {
  if (!holds) return;
  const k = holdKeyOf(g), m = holds.get(k);
  const finals = final ? { ...(m?.finals ?? {}), [final.op]: { home: final.home, away: final.away, at: now, ...(final.detail !== undefined ? { detail: final.detail } : {}), ...(final.url !== undefined ? { url: final.url } : {}), ...(final.pens ? { pens: true } : {}), ...(final.declared !== undefined ? { declared: final.declared } : {}), ...(final.aet ? { aet: true } : {}) } } : m?.finals;
  const same = !!final && !!m?.finals?.[final.op] && m.finals[final.op].home === final.home && m.finals[final.op].away === final.away;
  const late = m?.lateApiSportsAt !== undefined ? { lateApiSportsAt: m.lateApiSportsAt } : {};
  if (m && m.home !== NO_SCORE) holds.set(k, { home: NO_SCORE, away: NO_SCORE, firstSeenAt: now, ...(m.disagreed ? { disagreed: true } : {}), ...(finals ? { finals } : {}), ...late });
  else if (final && !same) holds.set(k, { home: NO_SCORE, away: NO_SCORE, firstSeenAt: m?.firstSeenAt ?? now, ...(m?.disagreed ? { disagreed: true } : {}), finals: finals!, ...late });
}
/** F-4 re-review: a second source disagreed with the primary on this game: marked for good (secondSourceAnswered keeps the mark). */
export function sourcesDisagreed(holds: SingleSourceHolds | null | undefined, g: Pick<Game, "league" | "eventId" | "startsAt">, now: number): void {
  if (!holds) return;
  const k = holdKeyOf(g), m = holds.get(k);
  if (!m?.disagreed) holds.set(k, { home: NO_SCORE, away: NO_SCORE, firstSeenAt: m?.firstSeenAt ?? now, disagreed: true, ...(m?.finals ? { finals: m.finals } : {}), ...(m?.lateApiSportsAt !== undefined ? { lateApiSportsAt: m.lateApiSportsAt } : {}) });
}

/**
 * ONE SOURCE, READ TWICE (owner, 2026-10-18 evening: "game results are final when the game ends"; it replaced the 12-hour wait of
 * 2026-10-16). A game coin burns once one source has shown the same final (the same winner and score) on two keeper reads at least this
 * far apart. Owner, 2026-10-20: "coins should burn right after the final whistle and wait for a second verification 5 min later": five
 * minutes (it was four), and it now applies to every game, including one two sources agree on at once, and to the games of team, season
 * and rivalry coins (finalCheck).
 */
export const GAME_CONFIRM_GAP_MS = 5 * 60_000;
/** One operator's latest positive read of a game coin's final (kept on the record, so a source that goes quiet is still remembered). */
export interface OpRead {
  winner: "home" | "away" | "tie"; home: number | null; away: number | null; at: number; detail: string; url: string; declared?: "home" | "away" | null; pens?: boolean; /** the score read marks extra time */ aet?: boolean; /** a soccer three-way payout: the 90-minute result only */ ninety?: boolean;
  /** when this operator first showed this same print (winner and score) in an unbroken run of reads since the record's anchor; a read
   *  written before 2026-10-18 has none, and its `at` stands in. `at - since` of GAME_CONFIRM_GAP_MS or more: the print is confirmed. */
  since?: number;
}
/**
 * A game coin's first-read record. `firstReadAt` is when the result the sources now agree on was first read (the anchor: a source's two
 * reads of the same final count only from it, see GAME_CONFIRM_GAP_MS), `by` the operator that read it, `winner`/`home`/`away` that result (scores null until a score read arrives), `ops` every
 * operator that has agreed (named on the reading), `reads` each operator's latest positive read, `disputed` the conflicting reads while
 * the sources disagree (set: nothing burns; cleared only when every disputing operator has read again and all agree, which moves the
 * anchor to then), `contradiction` a read that contradicts itself or the others before any result can be compared (two legs of a three-way
 * settlement paying out, a settlement naming neither team, a TheSportsDB row whose order cannot be told, a 90-minute winner on chain
 * against a score read that went to extra time; set: nothing burns; cleared only when that operator reads the game again cleanly, which
 * moves the anchor to then), `startsAt` the schedule's start when first read (not part of the key), `release` an operator's resolution note
 * (scripts/burnticker-game-hold.mts), `ignored` the operators an operator's release set aside for this game (a source that will never
 * agree, such as a settled market on chain): their reads are not counted for this game while the record lasts.
 */
export interface FirstRead {
  firstReadAt: number; by: string; winner: "home" | "away" | "tie"; home: number | null; away: number | null; ops: string[];
  reads?: Record<string, OpRead>; disputed?: { op: string; winner: "home" | "away" | "tie"; home: number | null; away: number | null; at: number }[] | null;
  startsAt?: string; release?: { at: number; note: string } | null;
  contradiction?: { op: string; why: string; at: number } | null;
  ignored?: string[] | null;
  /** the agreed shoot-out winner of a level final (item 78), when a source names one; compared like the score (F07). Absent on
   *  records written before 2026-10-18. */
  declared?: "home" | "away" | null;
  /** set once the game has been held by a dispute, a contradiction or a revised final: two sources agreeing no longer burn it at once; it
   *  burns when one source has shown the agreed final twice, GAME_CONFIRM_GAP_MS apart, after the anchor */
  heldOnce?: boolean;
}
export interface FirstReadStore { get(key: string): FirstRead | null; set(key: string, m: FirstRead): void }
/** An in-memory first-read store (tests, the season rehearsal). */
export function memoryFirstReadStore(): FirstReadStore & { marks: Map<string, FirstRead> } {
  const marks = new Map<string, FirstRead>();
  return { marks, get: (k) => marks.get(k) ?? null, set: (k, m) => { marks.set(k, m); } };
}
/**
 * The first-read record's key: `league:eventId` only. The start time is kept in the record, never in the key, so a schedule that moves the
 * start after the final, or two coins of a pair whose schedules list different starts, still share one clock.
 */
export const gameKeyOf = (g: Pick<Game, "league" | "eventId">): string => `${g.league}:${g.eventId}`;
/** The registry status key the keeper's first-read store writes (one JSON map, keyed by gameKeyOf(game)). */
export const FIRST_READ_STATUS_KEY = "games.firstReads";
/** Whether a stored value is a first-read record (the store's read check; the guarded release script uses it too). */
export const isFirstRead = (m: unknown): m is FirstRead => { const x = m as FirstRead | null; return !!x && typeof x === "object" && Number.isFinite(x.firstReadAt) && (x.winner === "home" || x.winner === "away" || x.winner === "tie") && Array.isArray(x.ops); };
/**
 * The keeper's PERSISTENT first-read store: read on every get, written on every set; marks older than 60 days are dropped on a write,
 * EXCEPT a record that is held (a dispute or a contradiction) or carries an operator's ignore list: its `firstReadAt` does not move while
 * it is held, so dropping it would forget the hold and let the game anchor again and burn.
 */
const keepsRecord = (v: Partial<FirstRead> | null | undefined): boolean => !!(v && (v.disputed?.length || v.contradiction || v.ignored?.length));
export function statusFirstReadStore(reg: { getStatus(key: string): string | null; setStatus(key: string, value: unknown, now?: number): void }, now: () => number = Date.now): FirstReadStore {
  const read = (): Record<string, FirstRead> => { try { const v = JSON.parse(reg.getStatus(FIRST_READ_STATUS_KEY) ?? "{}") as unknown; return v && typeof v === "object" ? v as Record<string, FirstRead> : {}; } catch { return {}; } };
  return {
    get: (k) => { const m = read()[k]; return isFirstRead(m) ? m : null; },
    set: (k, m) => { const all = read(), t = now(); for (const [x, v] of Object.entries(all)) if (!keepsRecord(v) && !(t - Number(v?.firstReadAt) < HOLD_KEEP_MS)) delete all[x]; all[k] = m; reg.setStatus(FIRST_READ_STATUS_KEY, all, t); },
  };
}
/**
 * FINAL CHECK (owner, 2026-10-20: "coins should burn right after the final whistle and wait for a second verification 5 min later"). The
 * first agreeing settlement of a team, season or rivalry coin's game (two independent operators agreeing, settleGame) is stored here, keyed
 * gameKeyOf(game), with when it was read. `at` is the keeper's clock on that read, so every body that read used was fetched at or before
 * it. A game coin keeps its own record (FirstRead, gameSchedule).
 */
export interface FinalCheck { winner: "home" | "away" | "tie"; home: number | null; away: number | null; at: number; startsAt?: string }
export interface FinalCheckStore { get(key: string): FinalCheck | null; set(key: string, m: FinalCheck | null): void }
/** An in-memory final-check store (tests). */
export function memoryFinalCheckStore(): FinalCheckStore & { marks: Map<string, FinalCheck> } {
  const marks = new Map<string, FinalCheck>();
  return { marks, get: (k) => marks.get(k) ?? null, set: (k, m) => { if (m) marks.set(k, m); else marks.delete(k); } };
}
/** The registry status key the keeper's final-check store writes (one JSON map, keyed by gameKeyOf(game)). */
export const FINAL_CHECK_STATUS_KEY = "games.finalChecks";
const isFinalCheck = (m: unknown): m is FinalCheck => { const x = m as FinalCheck | null; return !!x && typeof x === "object" && Number.isFinite(x.at) && (x.winner === "home" || x.winner === "away" || x.winner === "tie"); };
/** The keeper's PERSISTENT final-check store (the status table): a restart keeps each game's first read. Marks older than 60 days are dropped on a write. */
export function statusFinalCheckStore(reg: { getStatus(key: string): string | null; setStatus(key: string, value: unknown, now?: number): void }, now: () => number = Date.now): FinalCheckStore {
  const read = (): Record<string, FinalCheck> => { try { const v = JSON.parse(reg.getStatus(FINAL_CHECK_STATUS_KEY) ?? "{}") as unknown; return v && typeof v === "object" ? v as Record<string, FinalCheck> : {}; } catch { return {}; } };
  return {
    get: (k) => { const m = read()[k]; return isFinalCheck(m) ? m : null; },
    set: (k, m) => { const all = read(), t = now(); for (const [x, v] of Object.entries(all)) if (!(t - Number(v?.at) < HOLD_KEEP_MS)) delete all[x]; if (m) all[k] = m; else delete all[k]; reg.setStatus(FINAL_CHECK_STATUS_KEY, all, t); },
  };
}
/** The FINAL CHECK listener (GameDeps.onFinalCheck); a throwing listener never changes a reading. */
const noteCheck = (d: GameDeps, g: Game, why: string): void => { try { d.onFinalCheck?.({ game: g, why }); } catch { /* log only */ } };
/**
 * THE FINAL CHECK of a team, season or rivalry coin's game (owner, 2026-10-20). `v` is this read's verdict:
 *   settled   the first time (or with a result that differs from the stored one): stored, with the keeper's clock, and the game AWAITS a
 *             second read due GAME_CONFIRM_GAP_MS later. A later settled read with the same winner and score whose newest body was
 *             fetched at least GAME_CONFIRM_GAP_MS after the first read settles it (that cycle reads every source fresh). A different
 *             result replaces the stored one and the count starts again (logged).
 *   held      a disagreement: the stored first read is dropped (logged); the game settles only on two agreeing reads after the hold.
 *   awaiting  a source answered that the game is not final: the stored first read is dropped (logged). Any other wait (a source not
 *             answering yet, a read that failed) keeps it.
 * A game settled on TheSportsDB alone after its 12-hour hold (singleSince) is not checked again: its final has stood twelve hours.
 */
export function finalCheck(store: FinalCheckStore, g: Game, v: GameVerdict, io: { notFinal: readonly string[]; fetchedAt: readonly number[] }, now: number, d: GameDeps = { tsdbKey: null, apiSportsKey: null, market: null, payout: null }): GameVerdict {
  const k = gameKeyOf(g), m = store.get(k);
  if (v.kind === "settled" && v.singleSince !== undefined) return v;
  if (v.kind !== "settled") {
    const unfinal = v.kind === "awaiting" && io.notFinal.length > 0;
    if (m && (v.kind === "held" || unfinal)) {
      store.set(k, null);
      noteCheck(d, g, v.kind === "held" ? `the first read of the final${resultWords(m)} no longer stands: ${v.why}` : `${settledByOf(io.notFinal)} now says the game is not final, so the first read of the final${resultWords(m)} no longer stands and the count starts again`);
    }
    return v;
  }
  const res = { winner: v.winner, home: v.final?.home ?? null, away: v.final?.away ?? null };
  const same = !!m && m.winner === res.winner && m.home === res.home && m.away === res.away;
  if (!same) {
    store.set(k, { ...res, at: now, startsAt: g.startsAt });
    if (m) noteCheck(d, g, `the final changed from${resultWords(m)} to${resultWords(res)} between two reads, so the count starts again`);
    return { kind: "awaiting", dueAt: now + GAME_CONFIRM_GAP_MS, why: m ? `the final changed from${resultWords(m)} to${resultWords(res)}; it settles once a read at least five minutes from now shows the same final` : `the final${resultWords(res)} was first read now; it settles once a read at least five minutes from now shows the same final` };
  }
  const newest = Math.min(now, io.fetchedAt.length ? Math.max(...io.fetchedAt) : now);
  if (newest - m.at >= GAME_CONFIRM_GAP_MS) return { ...v, finalFirstReadAt: m.at };
  return { kind: "awaiting", dueAt: Math.max(m.at + GAME_CONFIRM_GAP_MS, now + 60_000), why: `the final${resultWords(res)} was first read at ${iso(m.at)}; it settles once a read at least five minutes after that shows the same final` };
}
const scoreWords = (f: { home: number | null; away: number | null }): string => (f.home === null || f.away === null ? "" : ` ${f.away}–${f.home} (away–home)`);
const resultWords = (f: { winner: string; home: number | null; away: number | null; declared?: "home" | "away" | null }): string => (scoreWords(f) || ` a ${f.winner} result`) + (f.winner === "tie" && f.declared ? `, the ${f.declared} side through on penalties` : "");
const iso = (t: number): string => new Date(t).toISOString();
/**
 * A read's EFFECTIVE winner (audit 2026-10-18 F07): a level score with a declared winner (a penalty shoot-out, item 78) is a win for the
 * declared side, so a provider that corrects only its shoot-out winner has changed its final.
 */
const effWinner = (x: Pick<OpRead, "winner" | "declared">): "home" | "away" | "tie" => (x.winner === "tie" && x.declared ? x.declared : x.winner);
/** Two reads agree: the same score where both carry one, else the same winner; and, where both name a winner, the same effective winner. */
const sameResult = (a: Pick<OpRead, "winner" | "home" | "away" | "declared">, b: Pick<OpRead, "winner" | "home" | "away" | "declared">): boolean =>
  (a.home !== null && a.away !== null && b.home !== null && b.away !== null ? a.home === b.home && a.away === b.away : a.winner === b.winner) &&
  !(a.declared && b.declared && effWinner(a) !== effWinner(b));
/** One source's print is unchanged: the same effective winner, the same score, and the same penalty and extra-time marks (F07). */
const samePrint = (a: Pick<OpRead, "winner" | "home" | "away" | "declared" | "pens" | "aet">, b: Pick<OpRead, "winner" | "home" | "away" | "declared" | "pens" | "aet">): boolean =>
  a.winner === b.winner && effWinner(a) === effWinner(b) && a.home === b.home && a.away === b.away && !!a.pens === !!b.pens && !!a.aet === !!b.aet;
/** One read handed to gameSchedule: an operator and what it read now. */
export interface ScheduleRead {
  op: string; winner: "home" | "away" | "tie"; final: { home: number; away: number } | null; detail?: string; url?: string; declared?: "home" | "away" | null; pens?: boolean; aet?: boolean; ninety?: boolean;
  /** when the body this read came from was FETCHED (2026-10-18 review: a cached repeat keeps its first fetch time, so it is never a
   *  second read); absent: `now` */
  fetchedAt?: number;
}
export type ScheduleVerdict = { kind: "ready"; mark: FirstRead; /** two independent sources agree as well (TWO SOURCES below) */ twoSources?: boolean; /** one source showed the same final twice (ONE SOURCE TWICE below) */ twice?: boolean } | { kind: "awaiting"; why: string; dueAt: number | null; /** set when this read started the count again on a game that had a record (a changed final, a source no longer final, a cleared dispute): the keeper logs it */ reset?: boolean } | { kind: "held"; why: string };
/**
 * THE GAME-COIN SCHEDULE (owner, 2026-10-16; review of b3249737). `reads` are the operators that read the final this cycle. Each one's
 * latest read is kept on the record, so an operator that read once and then goes quiet (a failing Polygon read, a lost market lookup, a
 * score source that starts throwing) is still counted; only a new positive read replaces it.
 *   disagree  any two remembered reads differ: the dispute is saved on the record and the game is HELD ("≠"; feedHealth's disagree
 *             alert: nothing burns until the sources agree). It stays held while any disputing operator is quiet.
 *   agree     every remembered read agrees. The first such read creates the record (the anchor). After a dispute, or when the agreed
 *             result differs from the anchor's (a corrected score), the anchor moves to now and heldOnce is set.
 *   tie       an on-chain split or void, or the soccer draw leg, never creates the record alone: a tie needs a score read.
 *   contra    settleGame found a read that contradicts itself or the others (`contra`, see FirstRead.contradiction): it is saved on the
 *             record and the game is HELD, and it stays held on later cycles while that operator is quiet (a failing Polygon leg) or
 *             contradicts again; only a clean read by that operator clears it, and that moves the anchor to now, as after a dispute.
 *   ignored   an operator in the record's `ignored` list (set by releaseDispute) is not read at all for this game: its reads and its
 *             contradictions are dropped, so the game goes on the remaining sources.
 *   UNFINAL   (owner, 2026-10-20) `notFinal` names the operators that answered this cycle that the game is NOT final. One that had
 *             shown a final before (a feed that marked the game final early or wrongly, a game sent to overtime) loses its remembered
 *             read, and the count starts again from now (the anchor moves, heldOnce is set): nothing burns until a source shows a final
 *             again and then shows the same final GAME_CONFIRM_GAP_MS later.
 *   TWO SOURCES (owner, 2026-10-16, second decision; 2026-10-20: no longer at once) the game WAS ready at once when two independent
 *             operators had each read it as final and agreed. Since the owner's decision of 2026-10-20 ("wait for a second
 *             verification 5 min later") it is ready only by ONE SOURCE TWICE below; `twoSources` is then set as well, for the
 *             reading's words, when two independent operators agree (the same score where both carry one, else the same winner), each
 *             counted once, and the game was never held, released or given an ignored source. A tie read on chain never counts.
 *   ONE SOURCE TWICE (owner, 2026-10-18 evening; the 12-hour wait of 2026-10-16 is gone) every remembered read agrees and one operator
 *             has shown that same final (the same winner and score) on two FETCHES GAME_CONFIRM_GAP_MS or more apart (fetch times: an answer served again from a cache is the same fetch; the confirming read is fetched fresh, confirmingRead), both at or after the
 *             anchor: READY. A first print settles nothing alone. A print that changes between the two reads starts the count again from
 *             the new print (and, as the agreed result changing, moves the anchor and sets heldOnce). A tie on chain never counts here
 *             either. The on-chain settlement alone follows this rule (it cannot change once resolved, so the second read is cheap).
 */
export function gameSchedule(store: FirstReadStore | null | undefined, g: Pick<Game, "league" | "eventId" | "startsAt">, reads: readonly ScheduleRead[], now: number, waiting: string | null = null, contra: { op: string; why: string } | null = null, notFinal: readonly string[] = []): ScheduleVerdict {
  if (!store) return contra ? { kind: "held", why: contra.why } : { kind: "awaiting", why: "this game coin's final may have been read, but this process keeps no record of when it was first read, so it is not settled here", dueAt: null };
  const k = gameKeyOf(g), m = store.get(k);
  const ignored = new Set(m?.ignored ?? []);
  if (ignored.size) { reads = reads.filter((r) => !ignored.has(r.op)); if (contra && ignored.has(contra.op)) contra = null; }
  const mem: Record<string, OpRead> = { ...(m?.reads ?? {}) };
  for (const op of ignored) delete mem[op];
  // ONE SOURCE TWICE: the same print as this operator's remembered read, made at or after the anchor, keeps that read's `since`
  const anchor0 = m?.firstReadAt ?? -Infinity;
  // `at` is the FETCH time of the body the read came from (2026-10-18 review), never the keeper's clock: an answer served again from a
  // cache keeps its fetch time, so it can never be the second of the two reads
  for (const r of reads) {
    const prev = mem[r.op], home = r.final?.home ?? null, away = r.final?.away ?? null, at = Math.min(r.fetchedAt ?? now, now);
    const same = !!prev && samePrint(prev, { winner: r.winner, home, away, declared: r.declared ?? null, pens: r.pens, aet: r.aet }) && prev.at >= anchor0;
    mem[r.op] = { winner: r.winner, home, away, at, detail: r.detail ?? r.op, url: r.url ?? "", ...(r.declared !== undefined ? { declared: r.declared } : {}), ...(r.pens ? { pens: true } : {}), ...(r.aet ? { aet: true } : {}), ...(r.ninety ? { ninety: true } : {}), since: same ? Math.max(prev.since ?? prev.at, anchor0) : at };
  }
  // UNFINAL (above): a source that had a final and now answers "not final" drops its remembered read and restarts the count
  const unfinal = m ? notFinal.filter((op) => !ignored.has(op) && !!mem[op] && !reads.some((r) => r.op === op)) : [];
  for (const op of unfinal) delete mem[op];
  if (unfinal.length && !Object.keys(mem).length) {
    store.set(k, { ...m!, reads: mem, firstReadAt: now, heldOnce: true });
    return { kind: "awaiting", reset: true, dueAt: null, why: `${settledByOf(unfinal)} had read a final for the game and now says it is not final, so the count starts again: the game coin burns once a source shows a final and then the same final again at least five minutes later` };
  }
  // a game past 90 minutes: the soccer three-way payout says only that it was level after 90 (settleGame compares that this cycle) and
  // nothing about the final, so it is not remembered as a read of the final
  if (Object.values(mem).some((x) => x.pens || x.aet)) for (const [op, x] of Object.entries(mem)) if (x.ninety) delete mem[op];
  // a contradiction found this cycle, or one remembered whose operator has not read the game again cleanly: held, and saved
  const kept = contra ? { ...contra, at: now } : m?.contradiction && !ignored.has(m.contradiction.op) && !reads.some((r) => r.op === m.contradiction!.op) ? m.contradiction : null;
  if (kept) {
    const first = Object.entries(mem)[0];
    const base: FirstRead = m ?? { firstReadAt: now, by: first?.[0] ?? kept.op, winner: first?.[1].winner ?? "tie", home: first?.[1].home ?? null, away: first?.[1].away ?? null, ops: [], startsAt: g.startsAt };
    store.set(k, { ...base, reads: mem, contradiction: kept, heldOnce: true });
    return { kind: "held", why: contra ? kept.why : `${kept.why} (first read at ${iso(kept.at)}; it stays held until that source reads the game again without the contradiction)` };
  }
  const all = Object.entries(mem);
  if (!all.length) return { kind: "awaiting", why: waiting ?? "no source has a final for the game yet", dueAt: null };
  const scored = all.find(([, x]) => x.home !== null && x.away !== null);
  const ref = scored ?? all[0];
  const odd = all.find(([, x]) => !sameResult(ref[1], x)) ?? all.find(([, x], i) => all.some(([, y], j) => j !== i && !sameResult(x, y)));
  if (odd) {
    // remember the dispute, even with no anchor yet; a quiet dissenter keeps it
    const disputed = all.map(([op, x]) => ({ op, winner: x.winner, home: x.home, away: x.away, at: x.at }));
    const base: FirstRead = m ?? { firstReadAt: now, by: ref[0], winner: ref[1].winner, home: ref[1].home, away: ref[1].away, ops: [], startsAt: g.startsAt };
    store.set(k, { ...base, reads: mem, disputed, contradiction: null, heldOnce: true });
    return { kind: "held", why: `${ref[1].detail} ≠ ${odd[1].detail} — held: the sources disagree on the final, and nothing burns for this game until every one of them reads it again and they agree` };
  }
  const agreed = { winner: ref[1].winner, home: scored ? scored[1].home : null, away: scored ? scored[1].away : null };
  // F07: the shoot-out winner the sources name (they agree, or `odd` above held the game)
  const agreedDeclared = agreed.winner === "tie" ? all.map(([, x]) => x.declared ?? null).find((x) => !!x) ?? null : null;
  if (agreed.winner === "tie" && !scored) return { kind: "awaiting", why: "the only read is a tie from the on-chain settlement (a split or void market, or the draw leg); a tie needs a final score read before the game coin can burn", dueAt: null };
  const ops = [...(m?.ops ?? []).filter((o) => mem[o]), ...all.map(([op]) => op).filter((o) => !(m?.ops ?? []).includes(o))];
  const changed = !!m && (m.winner !== agreed.winner || (agreed.home !== null && m.home !== null && (m.home !== agreed.home || m.away !== agreed.away)) ||
    // F07: a winner-only correction of a level final (the shoot-out winner) is a change too; a record from before 2026-10-18 has none
    (m.declared !== undefined && (m.declared ?? null) !== agreedDeclared));
  // TWO SOURCES (above): every remembered read agrees here; count the independent operators that read a final
  // a tie from the chain never counts: a two-way split may be a void, and the soccer draw leg says only "level after 90 minutes"
  const counted = all.filter(([op, x]) => !(op === "on-chain payout" && x.winner === "tie"));
  const twoSources = counted.length >= 2 && !changed && !m?.heldOnce && !m?.disputed && !m?.contradiction && !m?.release && !m?.ignored?.length;
  const restart = !m || !!m.disputed || !!m.contradiction || changed || unfinal.length > 0;
  // a FIRST record anchors at the earliest fetch among this cycle's reads, so the reads that made it count as the first of the two. A
  // restart after a hold (a cleared dispute or contradiction, a changed print; a release sets its own) anchors at NOW: a read fetched
  // during the hold, such as a payout served from a cache, never counts toward the two (re-review 2026-10-18)
  const restartAt = m ? now : Math.min(now, ...reads.map((r) => Math.min(r.fetchedAt ?? now, now)));
  // ONE SOURCE TWICE (above): an operator whose same print stood GAME_CONFIRM_GAP_MS or more (fetch times), counted from the anchor
  const anchor = restart ? restartAt : m.firstReadAt;
  const startOf = (x: OpRead): number => Math.max(x.since ?? x.at, anchor);
  const twice = counted.find(([, x]) => x.at - startOf(x) >= GAME_CONFIRM_GAP_MS);
  // the earliest a second read can confirm (the keeper's next read of this game); null when no source answered this cycle (review
  // 2026-10-18: a quiet source's old read would otherwise ask for a read every minute forever), so the normal poll applies
  const dueAt = !reads.length ? null : Math.max(Math.min(...counted.map(([, x]) => startOf(x)), now) + GAME_CONFIRM_GAP_MS, now + 60_000);
  if (restart) {
    const by = reads.find((r) => mem[r.op])?.op ?? ref[0];
    const rec: FirstRead = { firstReadAt: restartAt, by, winner: agreed.winner, home: agreed.home, away: agreed.away, declared: agreedDeclared, ops, reads: mem, disputed: null, contradiction: null, startsAt: m?.startsAt ?? g.startsAt, release: m?.release ?? null, ...(m?.ignored?.length ? { ignored: m.ignored } : {}), ...(m?.heldOnce || changed || unfinal.length ? { heldOnce: true } : {}) };
    store.set(k, rec);
    // 2026-10-20: never ready on the read that starts the count, even when two sources agree on it (the second read comes first)
    return { kind: "awaiting", dueAt, ...(m ? { reset: true } : {}), why: !m
      ? `the final${resultWords(agreed)} was first read now by ${settledByOf(all.map(([op]) => op))}; the game coin burns once a source shows the same final again at least five minutes later`
      : unfinal.length ? `${settledByOf(unfinal)} had read a final for the game and now says it is not final, so the count starts again on${resultWords(agreed)}; the game coin burns once a source shows that final again at least five minutes later`
      : m.disputed ? `the sources agree again on${resultWords(agreed)} after a disagreement; the game coin burns once one source shows that final again at least five minutes later`
      : m.contradiction ? `${m.contradiction.op} read the game again without the contradiction and the sources agree on${resultWords(agreed)}; the game coin burns once one source shows that final again at least five minutes later`
      : `the final changed from${resultWords(m)} to${resultWords({ ...agreed, declared: agreedDeclared })}; the game coin burns once one source shows the new final again at least five minutes later` };
  }
  const next: FirstRead = { ...m, ops, reads: mem, contradiction: null, home: m.home ?? agreed.home, away: m.away ?? agreed.away, declared: m.declared ?? agreedDeclared };
  store.set(k, next);
  if (twice) return { kind: "ready", mark: next, twice: true, ...(twoSources ? { twoSources: true } : {}) };
  return { kind: "awaiting", dueAt, why: `the final${resultWords(next)} was first read by ${settledByOf([m.by])}, confirmed so far by ${settledByOf(ops)}; the game coin burns once a source shows the same final again at least five minutes after the first read` };
}
/**
 * THE OPERATOR'S RELEASE OF A STUCK DISAGREEMENT (review of b3249737 item 6; scripts/burnticker-game-hold.mts, dry run unless --apply).
 * After reading every source by hand, the operator names the result that is right (`side`). Remembered reads that name another winner
 * are dropped, the dispute is cleared, and the anchor moves to NOW on that result, with the note kept on the record: the game then burns
 * once one source has shown that result on two reads after the release, GAME_CONFIRM_GAP_MS apart (no 12 hours since 2026-10-18). A source that
 * still reads the other result on the next cycle disputes it again: the release never overrides a live disagreement, UNLESS the
 * operator names that source in `ignore` (a source that will never agree: the immutable settlement of a market on chain, a feed that
 * keeps a wrong final). An ignored source is saved on the record (`ignored`) and gameSchedule does not count its reads for this game
 * while the record lasts. A contradiction (FirstRead.contradiction) is released the same way. Pure.
 */
export function releaseDispute(m: FirstRead, side: "home" | "away" | "tie", note: string, now: number, ignore: readonly string[] = []): { ok: true; next: FirstRead; dropped: string[] } | { ok: false; why: string } {
  if (!note.trim()) return { ok: false, why: "a release needs a note saying what was read by hand" };
  if (!m.disputed?.length && !m.contradiction) return { ok: false, why: "this game is not held by a disagreement" };
  const known = new Set([...Object.keys(m.reads ?? {}), ...(m.disputed ?? []).map((x) => x.op), ...(m.contradiction ? [m.contradiction.op] : []), ...m.ops]);
  const unknown = ignore.filter((op) => !known.has(op));
  if (unknown.length) return { ok: false, why: `no source named ${unknown.map((o) => `"${o}"`).join(", ")} has read this game (sources on the record: ${[...known].join(", ")})` };
  const ignored = [...new Set([...(m.ignored ?? []), ...ignore])];
  const reads = { ...(m.reads ?? {}) }, dropped: string[] = [];
  for (const [op, r] of Object.entries(reads)) if (r.winner !== side || ignored.includes(op)) { delete reads[op]; dropped.push(op); }
  const kept = Object.values(reads), scored = kept.find((r) => r.home !== null && r.away !== null);
  if (kept.length && scored && kept.some((r) => r.home !== null && r.away !== null && (r.home !== scored.home || r.away !== scored.away))) return { ok: false, why: "the remaining reads still carry different scores for that result" };
  return { ok: true, dropped, next: { ...m, firstReadAt: now, by: "operator release", winner: side, home: scored?.home ?? null, away: scored?.away ?? null, ops: m.ops.filter((o) => reads[o]), reads, disputed: null, contradiction: null, release: { at: now, note: note.trim() }, ...(ignored.length ? { ignored } : {}) } };
}
/** The registry status key listing the coins (series ids) already alerted for a one-source settlement. */
export const SINGLE_SOURCE_ALERTED_KEY = "games.singleSourceAlerted";
/**
 * The bt-single-source alert for the FIRST one-source settlement of a coin (series id), or null when that coin was alerted before. The
 * series is remembered in the status table, so a restart never alerts the same coin twice.
 */
export function singleSourceAlert(reg: { getStatus(key: string): string | null; setStatus(key: string, value: unknown): void }, e: { seriesId: string | null; game: Pick<Game, "name" | "date">; final: { home: number; away: number } }): { kind: "bt-single-source"; key: string; text: string; meta: Record<string, unknown> } | null {
  const id = e.seriesId ?? `game:${e.game.name}:${e.game.date}`;
  let seen: string[] = [];
  try { const v = JSON.parse(reg.getStatus(SINGLE_SOURCE_ALERTED_KEY) ?? "[]") as unknown; seen = Array.isArray(v) ? v.map(String) : []; } catch { seen = []; }
  if (seen.includes(id)) return null;
  reg.setStatus(SINGLE_SOURCE_ALERTED_KEY, [...seen, id]);
  return { kind: "bt-single-source", key: `bt-single-source:${id}`, text: `${id}: ${e.game.name} on ${e.game.date} settled on TheSportsDB alone, ${e.final.away} to ${e.final.home}, after its final score stood for 12 hours.`, meta: { seriesId: id } };
}
/** One operator as a reading's title names it: "the game's on-chain settlement", "a licensed final score", or the league feed's label. */
export const opLabel = (op: string): string => (op === "on-chain payout" ? "the game's on-chain settlement" : op === "TheSportsDB" ? SETTLED_ON.TheSportsDB : CROSS_LABEL[op as CrossId] ?? op);
/** The operators that settled a game, in words ("on-chain payout and TheSportsDB"). */
const OP_WORDS = (op: string): string => (op === "on-chain payout" || op === "TheSportsDB" ? op : CROSS_LABEL[op as CrossId] ?? op);
const andList = (w: readonly string[]): string => (w.length <= 1 ? w.join("") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`);
export const settledByOf = (ops: readonly string[]): string => andList(ops.map(OP_WORDS));
export const envGameDeps = (env: Readonly<Record<string, string | undefined>> = process.env): GameDeps => ({ tsdbKey: (env.BURNTICKER_THESPORTSDB_KEY ?? "").trim() || null, apiSportsKey: (env.BURNTICKER_APISPORTS_KEY ?? "").trim() || null, market: null, payout: null });

export type CrossId = "mlb.statsapi" | "nhl.score" | "nba.cdn" | "apisports.games";
/** How the cross-read is named on cards, coin pages, receipts and posts (the owner: name recognition — the league's official feed). */
export const CROSS_LABEL: Record<CrossId, string> = { "mlb.statsapi": "MLB's official feed", "nhl.score": "NHL's official scores", "nba.cdn": "NBA's official feed", "apisports.games": "a second licensed provider" };
/** How the primary is named outside the sources table and the trust page (TheSportsDB is named there, with "data: TheSportsDB"). */
export const SETTLED_ON: Record<"on-chain payout" | "TheSportsDB", string> = { "on-chain payout": "the game's on-chain payout", TheSportsDB: "a licensed final score" };
/** The public ESPN scoreboard page for the game's day — a plain human link on each game row and receipt, never fetched (no ESPN reads). */
/**
 * Continuous audit run 2, HB-15: ESPN files a game under its US Eastern calendar day (Seahawks at Broncos, kickoff 2026-10-16T00:15Z, is on
 * ESPN's 20261015 scoreboard), not the UTC day the reading is keyed by. With the game's start time the link uses the Eastern day.
 */
export const espnScoreboardDay = (date: string, startsAt?: string | null): string => {
  const t = startsAt ? Date.parse(startsAt) : NaN;
  if (!Number.isFinite(t)) return date.slice(0, 10);
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  return /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : date.slice(0, 10);
};
export const espnGameUrl = (league: LeagueId, date: string, startsAt?: string | null): string => { const [sport, lg] = LEAGUES[league].path.split("/"); const d = espnScoreboardDay(date, startsAt).replace(/-/g, ""); return sport === "soccer" ? `https://www.espn.com/soccer/scoreboard/_/date/${d}/league/${lg}` : `https://www.espn.com/${lg}/scoreboard/_/date/${d}`; };
/** The league's cross-read: its own official feed where one exists, else the second licensed provider. */
export const crossIdOf = (league: LeagueId): CrossId => (league === "mlb" ? "mlb.statsapi" : league === "nhl" ? "nhl.score" : league === "nba" ? "nba.cdn" : "apisports.games");
/** Whether the cross-read can be read on this host (API-Sports needs its key). */
export const crossAvailable = (league: LeagueId, d: Pick<GameDeps, "apiSportsKey">): boolean => crossIdOf(league) !== "apisports.games" || !!d.apiSportsKey;

// ---- finals from each reader --------------------------------------------------------------------------------------------------

const n = (v: unknown): number | null => { const x = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(x) ? null : x; };
// QA pass 9 #5: the same normal form as the schedule's team match ("&" read as "and", periods and accents ignored)
const norm = teamNameKey;
/**
 * A provider's team name matches a side when it contains the side's nickname, short name, location or full name (or the reverse). An
 * EMPTY name matches nothing (season rehearsal 2026-10-13, bug 1: TheSportsDB's day listing holds every sport, a cycling or darts row has
 * no teams, and `"".includes` is true for every key, so "Hamburg Cyclassics" matched Arsenal at Manchester United).
 */
export const sideMatches = (name: string, s: GameSide): boolean => { const a = norm(name); if (!a) return false; return [s.name, s.nickname, s.short ?? "", s.location ?? "", s.abbr].filter((k) => k && k.length >= 3).some((k) => { const b = norm(k); return a === b || a.includes(b) || b.includes(a); }); };

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
/** The event lookup URLs live in espn.ts (the live game read reads them too); re-exported here for the existing callers. */
export { tsdbV2EventUrl, tsdbV1EventUrl };
const tsdbRows = (body: unknown): Record<string, unknown>[] => (body && typeof body === "object" ? Object.values(body as Record<string, unknown>).filter(Array.isArray) as Record<string, unknown>[][] : []).flat().filter((e) => typeof e === "object" && !!e && "idEvent" in e);
/**
 * Which of the game's sides a provider's team name is, by OUR TEAM TABLE first (season rehearsal 2026-10-13, bug 1: name containment alone
 * read "Los Angeles Angels" as the Lakers' "Los Angeles" and "Philadelphia Phillies" as the Union). A side our table knows (abbr not
 * "TBD") matches only the name our table reads as that same team; a side our table does not know (an FCS opponent, a club outside a
 * competition's frozen list) matches a non-empty name our table does not know either, by the name match.
 */
export function sideIs(league: LeagueId, name: string, s: GameSide): boolean {
  if (!norm(name)) return false;
  const t = ourTeam(league, name);
  if (s.abbr && s.abbr !== "TBD") return !!t && t.abbr === s.abbr;
  return !t && sideMatches(name, s);
}
/** How a provider row's home/away fields sit against the game: the same way, crossed (the row's home team is our away side), or neither. */
export function rowOrientation(g: Game, homeName: string, awayName: string): "same" | "crossed" | null {
  const same = sideIs(g.league, homeName, g.home) && sideIs(g.league, awayName, g.away), crossed = sideIs(g.league, homeName, g.away) && sideIs(g.league, awayName, g.home);
  return same === crossed ? null : same ? "same" : "crossed";
}
const dayBefore = (date: string): string => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
/** A row of the game's own TheSportsDB league, or a row that does not say (a v2 day listing row carries no league; its event lookup does). */
const leagueOk = (g: Game, e: Record<string, unknown>): boolean => { const want = TSDB_LEAGUE[g.league]; return !want || e.idLeague === undefined || e.idLeague === null || e.idLeague === "" || String(e.idLeague) === want; };
/**
 * The day listing's CANDIDATE rows for this game: the game's UTC date or the day before, both team fields non-empty and both teams this
 * game's by our team table (sideIs), the same way round or crossed. Rows that name a league (v1 rows, lookups) must name the game's.
 * The game's date first.
 */
export function tsdbDayCandidates(g: Game, body: unknown): Record<string, unknown>[] {
  const prev = dayBefore(g.date);
  const rows = tsdbRows(body).filter((e) => (e.dateEvent === g.date || e.dateEvent === prev) && leagueOk(g, e) && rowOrientation(g, String(e.strHomeTeam ?? ""), String(e.strAwayTeam ?? "")) !== null);
  return [...rows.filter((e) => e.dateEvent === g.date), ...rows.filter((e) => e.dateEvent !== g.date)];
}
/** The day listing's row for this game without the event lookups (the candidates' nearest start where the rows carry one, else the first). */
export function tsdbDayMatch(g: Game, body: unknown): Record<string, unknown> | null {
  const rows = tsdbDayCandidates(g, body), same = rows.filter((e) => e.dateEvent === g.date);
  return nearestStart(same.length ? same : rows, g.startsAt, tsdbStart) ?? null;
}
/** A candidate is the game only when its start (from the event lookup) is within this of the schedule's start. */
export const TSDB_START_WINDOW_MS = 12 * 3_600_000;
/**
 * The game's TheSportsDB row through the day listing (season rehearsal 2026-10-13, bugs 1 and 2). The v2 listing carries neither the
 * league nor a start time, so EVERY candidate (tsdbDayCandidates) is looked up (lookup/event/{id}; the client caches each URL, so an id is
 * read once per process), and only a looked-up row of the game's own league (idLeague = TSDB_LEAGUE) that started within 12 hours of the
 * schedule's start can be the game; of those the nearest start wins (an MLB doubleheader, or a West Coast night game and the next
 * afternoon's game on one UTC date: Rays at Giants 2025-08-17, rows 2176956 at 01:05Z and 2176973 at 20:05Z). Null: not listed.
 */
export async function tsdbFinalByDay(client: EspnClient, key: string, g: Game): Promise<Final | null> {
  const want = TSDB_LEAGUE[g.league] ?? null;
  for (const date of [g.date, dayBefore(g.date)]) {
    const url = tsdbV2DayUrl(date);
    const cands = tsdbDayCandidates(g, await client.tsdbRead(key, url, (k) => [tsdbV1DayUrl(k, date)]));
    const full: Record<string, unknown>[] = [];
    for (const row of cands) {
      const id = String(row.idEvent ?? "");
      const complete = !!(row.strStatus && row.strTimestamp && row.idLeague);
      const lookedUp = complete || !id ? null : tsdbRows(await client.tsdbRead(key, tsdbV2EventUrl(id), (k) => [tsdbV1EventUrl(k, id)]).catch(() => null))[0];
      const r = lookedUp ? { ...row, ...lookedUp } : row;
      if (want && String(r.idLeague ?? "") !== want) continue;   // a row whose league is unknown or another league's is never the game
      if (rowOrientation(g, String(r.strHomeTeam ?? ""), String(r.strAwayTeam ?? "")) === null) continue;
      const t = Date.parse(tsdbStart(r) ?? "");
      if (!Number.isFinite(t) || Math.abs(t - Date.parse(g.startsAt)) > TSDB_START_WINDOW_MS) continue;
      full.push(r);
    }
    const best = nearestStart(full, g.startsAt, tsdbStart);
    if (best) return finalFromTsdb(g, { events: [best] }, url);
  }
  return null;
}
export const tsdbV2Url = (names: [string, string]): string => `https://www.thesportsdb.com/api/v2/json/search/event/${encodeURIComponent(`${names[0]} vs ${names[1]}`.replace(/ /g, "_").toLowerCase())}`;
/** TheSportsDB v2 search/event: the event list under whichever key the API uses; the game's date (or the day before, UTC) and a final status. */
/**
 * TheSportsDB's final for the game from a list of rows (the day listing's chosen row, or the v2 name search): the game's date (or the day
 * before, UTC), both teams the game's by our team table and of the game's league where the row names one. The row's scores are read by
 * its team fields in its own score order (espn.ts tsdbFieldScores, bug 4: college rows whose scores follow the event's name) and then put
 * on our sides, crossed when the row's home team is our away side. A college row whose score order cannot be told is `unresolved`.
 */
export function finalFromTsdb(g: Game, body: unknown, url: string): Final | null {
  const lists = body && typeof body === "object" ? Object.values(body as Record<string, unknown>).filter(Array.isArray) as Record<string, unknown>[][] : [];
  const evs = lists.flat().filter((e) => typeof e === "object" && e && "dateEvent" in e && leagueOk(g, e) && rowOrientation(g, String(e.strHomeTeam ?? ""), String(e.strAwayTeam ?? "")) !== null);
  const prev = dayBefore(g.date);
  const sameDay = evs.filter((x) => x.dateEvent === g.date), before = evs.filter((x) => x.dateEvent === prev);
  const e = nearestStart(sameDay.length ? sameDay : before, g.startsAt, tsdbStart);
  if (!e) return null;
  const done = /^(FT|AOT|AET|AP|PEN|Match Finished|Final)/i.test(String(e.strStatus ?? ""));
  const sc = tsdbFieldScores(g.league, e), crossed = rowOrientation(g, String(e.strHomeTeam ?? ""), String(e.strAwayTeam ?? "")) === "crossed";
  const h = crossed ? sc.away : sc.home, a = crossed ? sc.home : sc.away;
  const how = sc.order === "event" ? ", scores in the event name's order" : "", side = crossed ? ", home and away crossed" : "";
  const unresolved = sc.order === "unknown" ? `TheSportsDB's row ${e.idEvent ?? ""} (${e.strEvent ?? ""}: ${e.strHomeTeam ?? ""} home, ${e.strAwayTeam ?? ""} away) names its teams in neither order, so which score is whose cannot be told — held` : undefined;
  return { home: h ?? 0, away: a ?? 0, done: done && h !== null && a !== null, detail: `TheSportsDB ${e.strEvent ?? ""} ${n(e.intHomeScore) ?? "?"}–${n(e.intAwayScore) ?? "?"} (${e.strStatus ?? "?"}${how}${side})`, url, pens: /^(AP|PEN)\b/i.test(String(e.strStatus ?? "")), declared: null, aet: /^AET\b/i.test(String(e.strStatus ?? "")), unresolved };
}
/**
 * MLB StatsAPI's final for the game (season rehearsal 2026-10-13, bug 3). The day page lists games by their LOCAL date, so a night game
 * whose UTC date is D sits on page D-1 and page D may hold the same teams' NEXT game. Only a listing that is this game counts: the same
 * gamePk (the schedule's event id when the schedule came from StatsAPI), or both teams by name, and in either case a start within 6 hours
 * of the schedule's. Nothing within 6 hours: null, so crossFinal reads the next candidate page, never the nearest other game.
 */
export const MLB_START_WINDOW_MS = 6 * 3_600_000;
export function finalFromMlb(g: Game, body: unknown, url: string): Final | null {
  const games = (((body as { dates?: { games?: unknown[] }[] } | null)?.dates ?? []).flatMap((d) => d.games ?? [])) as { gamePk?: number; gameDate?: string; status?: { abstractGameState?: string }; teams?: { home?: { team?: { name?: string }; score?: number }; away?: { team?: { name?: string }; score?: number } } }[];
  const pk = /^\d+$/.test(g.eventId) ? g.eventId : null;
  const hits = games.filter((x) => (pk !== null && String(x.gamePk ?? "") === pk) || (sideMatches(String(x.teams?.home?.team?.name ?? ""), g.home) && sideMatches(String(x.teams?.away?.team?.name ?? ""), g.away)));
  const near = hits.filter((x) => Math.abs(Date.parse(String(x.gameDate)) - Date.parse(g.startsAt)) < MLB_START_WINDOW_MS);
  const hit = nearestStart(near, g.startsAt, (x) => x.gameDate);
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
  return { home: h ?? 0, away: a ?? 0, done: /^(FT|AET|PEN|AOT)$/.test(st) && h !== null && a !== null, detail: `API-Sports ${a ?? "?"}–${h ?? "?"} (${st || "?"})`, url, pens: st === "PEN", declared, aet: st === "AET" };
}

// ---- one game, settled ----------------------------------------------------------------------------------------------------------

export type GameVerdict =
  | { kind: "settled"; winner: "home" | "away" | "tie"; final: { home: number; away: number } | null; /** the operator it settled on: "on-chain payout", "TheSportsDB", or (a game coin) a CrossId */ settledOn: string; confirmedBy: string; ops: string[]; detail: string; url: string; /** which operators settled it, in words: "on-chain payout and TheSportsDB", or SINGLE_SOURCE_SETTLED_BY (settleGame always sets it) */ settledBy?: string; /** set when TheSportsDB alone settled it after the 12-hour hold: when that final was first seen */ singleSince?: number; /** a game coin (GAME COINS above): when its final was first read by any operator; the burn was due 12 hours later */ firstReadAt?: number; /** a team, season or rivalry coin (FINAL CHECK): when the agreeing final it settled on was first read (launchCut.ts) */ finalFirstReadAt?: number; /** a game coin settled because two independent sources agreed (gameSchedule TWO SOURCES) */ twoSources?: boolean; /** a game coin settled because one source showed the same final twice (gameSchedule ONE SOURCE TWICE) */ twice?: boolean }
  | { kind: "awaiting"; why: string; /** a game coin: the earliest its final can be confirmed by a second read, for the keeper's next read */ dueAt?: number | null }
  | { kind: "held"; why: string };

const winnerOf = (f: { home: number; away: number }): "home" | "away" | "tie" => (f.home > f.away ? "home" : f.home < f.away ? "away" : "tie");

/** The cross-read's final for a game (null: not in the feed; throws: unreadable). */
/** Reads one URL per candidate day; a day the feed does not serve (404) is skipped, and only when every day fails is the read unreadable. */
async function firstFinal(client: EspnClient, urls: string[], parse: (body: unknown, url: string) => Final | null, headers: Record<string, string> = {}, o: { ttlMs?: number; refuse?: (body: unknown) => string | null } = {}): Promise<Final | null> {
  let err: Error | null = null, any = false;
  for (const url of urls) {
    let body: unknown;
    try { body = await client.get(url, headers, o); any = true; } catch (e) { err = e as Error; continue; }
    const f = parse(body, url);
    if (f) return f;
  }
  if (!any && err) throw err;
  return null;
}
/**
 * The StatsAPI day pages that can list the game (bug 3): its UTC date, the day before (a US night game's local date), and the day after
 * when it starts within 4 hours of midnight UTC (a game played east of UTC, local date ahead of UTC).
 */
export function mlbDays(g: Pick<Game, "date" | "startsAt">): string[] {
  const t = Date.parse(g.startsAt), next = new Date(Date.parse(`${g.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return [g.date, dayBefore(g.date), ...(Number.isFinite(t) && new Date(t).getUTCHours() >= 20 ? [next] : [])];
}
export async function crossFinal(client: EspnClient, g: Game, d: GameDeps, which: CrossId | null = null): Promise<{ id: CrossId; final: Final | null }> {
  const id = which ?? crossIdOf(g.league);
  const prevDay = dayBefore(g.date);
  if (id === "mlb.statsapi") return { id, final: await firstFinal(client, mlbDays(g).map((day) => `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${day}`), (b, u) => finalFromMlb(g, b, u)) };
  if (id === "nhl.score") return { id, final: await firstFinal(client, [g.date, prevDay].map((day) => `https://api-web.nhle.com/v1/score/${day}`), (b, u) => finalFromNhl(g, b, u)) };
  if (id === "nba.cdn") {
    // 2026-10-14: the NBA's feed answers HTTP 403 since 2026-10-12, and an error is never cached, so each NBA game read it again (a season
    // rehearsal: one wasted request per game, through the request budget). A refusal now marks it refused for this client's process;
    // the NBA game then settles on TheSportsDB's day listing and event lookup plus the on-chain payout, as every TheSportsDB league does.
    const refused = (client as { refusedFeeds?: Set<string> }).refusedFeeds;   // a test double may not carry it
    if (refused?.has(NBA_SCHEDULE_URL)) throw new Error(`HTTP 403 earlier in this run for ${NBA_SCHEDULE_URL} (not read again)`);
    try { return { id, final: await firstFinal(client, [NBA_SCHEDULE_URL], (b, u) => finalFromNba(g, b, u)) }; }
    catch (e) { if (/HTTP (401|403)\b/.test((e as Error).message)) refused?.add(NBA_SCHEDULE_URL); throw e; }
  }
  if (!d.apiSportsKey) throw new Error("cross-read missing: BURNTICKER_APISPORTS_KEY (a second licensed provider) is not set");
  // audit 2026-10-16 F-4 review: 100 reads a day per sport on the free plan, so an answer is kept APISPORTS_CROSS_TTL_MS (the game is
  // not final yet, or it would have settled); an `errors` body is a failed read (apiSportsRefusal), never "no final yet"
  return { id, final: await firstFinal(client, [g.date, prevDay].map((day) => apiSportsUrl(g.league, day)), (b, u) => finalFromApiSports(g, b, u), { "x-apisports-key": d.apiSportsKey }, { ttlMs: APISPORTS_CROSS_TTL_MS, refuse: apiSportsRefusal }) };
}

/** How long a settlement cross-read answer from API-Sports is kept (the free plan's 100 a day per sport). */
export const APISPORTS_CROSS_TTL_MS = 30 * 60_000;
/** How long after a game's start API-Sports is still read for it when it has given no final (apiSportsWindow). */
export const APISPORTS_READ_AFTER_START_MS = 36 * 3_600_000;
/** The pending line before kickoff (shown on the coin page: plain English, no dates). */
export const APISPORTS_BEFORE_START_WHY = "API-Sports is read once the game has started";
/** The pending line once the window has closed with no final from API-Sports. */
export const APISPORTS_WINDOW_CLOSED_WHY = "API-Sports is no longer read for this game, because it had no final in the 36 hours after the start";
/**
 * THE API-SPORTS READ WINDOW (2026-10-18; the box spent the American-football day, 51 of 51, by 13:00 UTC on 10-17 and 10-18, before any
 * game kicked off, because every keeper cycle cross-read every NFL game coin, each answer kept 30 minutes: about 96 reads a game a day).
 * API-Sports is read for a game only while it can matter:
 *   before     the game's start (the schedule's, else the first-read record's, else 12:00 UTC on the game's date): not read ("skip")
 *   live       from the start until API-Sports' final is remembered, or 36 hours after the start: read, each answer kept 30 minutes
 *   final      once its final is remembered (HoldMark.finals, or the game-coin record's reads): not read again ("remembered"; settleGame
 *              counts the remembered final as API-Sports' read). While a game is held over a dispute or a contradiction that involves
 *              API-Sports (or a hold mark records a disagreement), it is still read inside the 36 hours, so a corrected final can clear it.
 *   after      36 hours after the start with no final from it: not read ("skip")
 * A skipped read is "not answered" (pending), never a disagreement, and never "API-Sports out" except for a team coin once the window has closed and TheSportsDB has a final (settleGame; one late read first). The league feeds (MLB, NHL, NBA) are free
 * and are not windowed. Pure apart from reading the two stores.
 */
export function apiSportsWindow(g: Pick<Game, "league" | "eventId" | "startsAt" | "date">, d: Pick<GameDeps, "holds" | "firstReads">, now: number, gameCoin = false): { kind: "read" } | { kind: "skip"; why: string; /** the 36 hours have passed (not before kickoff) */ closed?: boolean } | { kind: "remembered"; final: RememberedFinal; inRecord: boolean } {
  const op = "apisports.games";
  const rec = d.firstReads?.get(gameKeyOf(g)) ?? null, mark = d.holds?.get(holdKeyOf(g)) ?? null;
  const start = [g.startsAt, rec?.startsAt, `${g.date}T12:00:00Z`].map((x) => (x ? Date.parse(x) : NaN)).find((t) => Number.isFinite(t)) ?? NaN;
  if (Number.isFinite(start) && now < start) return { kind: "skip", why: APISPORTS_BEFORE_START_WHY };
  const open = !Number.isFinite(start) || now <= start + APISPORTS_READ_AFTER_START_MS;
  const r = rec?.reads?.[op];
  const fromRecord: RememberedFinal | null = r && r.home !== null && r.away !== null ? { home: r.home, away: r.away, at: r.at, detail: r.detail, url: r.url, ...(r.pens ? { pens: true } : {}), ...(r.declared !== undefined ? { declared: r.declared } : {}), ...(r.aet ? { aet: true } : {}) } : null;
  // a game coin with a record goes on the record alone: a final the record no longer holds was dropped by an operator's release
  // (releaseDispute), and the hold mark's copy of it must not bring it back (review 2026-10-18)
  const remembered = fromRecord ?? (gameCoin && rec ? null : mark?.finals?.[op] ?? null);
  const contested = !!(rec?.disputed?.some((x) => x.op === op) || rec?.contradiction?.op === op || mark?.disagreed);
  // 2026-10-18 review: a GAME COIN whose only answering source is API-Sports needs its final read twice (ONE SOURCE TWICE). Its
  // remembered final is read once more inside the window, fresh, GAME_CONFIRM_GAP_MS after its first fetch (confirmingRead), and then
  // not again. Until then it waits on the remembered final.
  if (gameCoin && open && fromRecord && rec && !contested) {
    const alone = Object.keys(rec.reads ?? {}).every((o) => o === op || rec.ignored?.includes(o));
    const confirmed = r!.at - Math.max(r!.since ?? r!.at, rec.firstReadAt) >= GAME_CONFIRM_GAP_MS;
    if (alone && !confirmed && confirmingRead(rec, op, now)) return { kind: "read" };
  }
  if (remembered && !(contested && open)) return { kind: "remembered", final: remembered, inRecord: !!fromRecord };
  if (!open) return { kind: "skip", why: APISPORTS_WINDOW_CLOSED_WHY, closed: true };
  return { kind: "read" };
}
/**
 * API-Sports cannot be read for now: its budget for the day is spent, or it refused the read (an `errors` body: the day's limit, a plan
 * that does not cover the date). Settlement then counts it out (operatorsFor), so a game it was the second operator for takes the
 * TheSportsDB-only path instead of waiting for a read that will not come today.
 */
export const apiSportsOut = (e: unknown): boolean => /today's request budget is spent|API-Sports refused the read/.test(String((e as Error)?.message ?? e));

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
 * A SOCCER GAME'S THREE-WAY PAYOUT (launch walkthrough 2026-10-13). Polymarket lists the game as three yes/no conditions (home win, draw,
 * away win). All three payout vectors are read on Polygon and all three must be resolved; exactly one may pay YES, and that leg is the
 * result (home, away, or a tie for the draw leg). An unresolved leg, or a split payout (a voided leg), waits; two legs paying YES, or none,
 * contradict each other and hold the game.
 *
 * PENALTIES AND EXTRA TIME: the three markets settle on the 90-minute result (regular time plus stoppage time), so a cup tie decided in
 * extra time or on penalties pays YES on the DRAW leg. The owner's rule (item 78, `Final` above) counts a level game decided on penalties
 * as a win for the side that went through, so the draw leg alone never decides such a game: settleGame compares the payout's "level after
 * 90 minutes" with the score reads and then leaves it out of the operator count (the comment there).
 */
async function threeWayRead(market: GameMarket, w: NonNullable<GameMarket["threeWay"]>, d: GameDeps, fresh = false): Promise<{ kind: "read"; winner: "home" | "away" | "tie"; detail: string; fetchedAt?: number } | { kind: "awaiting"; why: string } | { kind: "held"; why: string }> {
  const legs = [["home", w.home, `${w.homeName} win`], ["tie", w.draw, "a draw"], ["away", w.away, `${w.awayName} win`]] as const;
  const yes: (typeof legs)[number][] = [];
  const times: number[] = [];
  for (const leg of legs) {
    const p = d.payout ? await d.payout(leg[1], fresh ? { fresh: true } : undefined).catch(() => null) : null;
    if (p?.fetchedAt !== undefined) times.push(p.fetchedAt);
    if (!p || !p.resolved) return { kind: "awaiting", why: `the on-chain payout for ${leg[2]} in ${market.question} is not resolved yet` };
    if (p.outcome === null) return { kind: "awaiting", why: `the on-chain payout for ${leg[2]} in ${market.question} is split, not a result` };
    if (p.outcome === 0) yes.push(leg);
  }
  if (yes.length > 1) return { kind: "held", why: `the on-chain payouts for ${market.question} pay out on more than one result (${yes.map((l) => l[2]).join(" and ")}) — held` };
  if (yes.length === 0) return { kind: "held", why: `none of the three on-chain payouts for ${market.question} pays out — held` };
  return { kind: "read", winner: yes[0][0], detail: `on-chain payout ${market.question}: ${yes[0][2]} (90 minutes)`, ...(times.length ? { fetchedAt: Math.min(...times) } : {}) };
}

/**
 * ONE SOURCE'S READS IN ONE settleGame (2026-10-18 review). A view of the client that notes when each answer body was fetched
 * (EspnClient.fetchedAt; a test double that cannot say counts as fetched now) and, with `fresh`, makes every read skip the cache. `at()`
 * is the OLDEST fetch among the bodies read, so a final built partly from a cached body is never taken for a new read.
 */
export function sourceReader(client: EspnClient, fresh: boolean, now: number): { client: EspnClient; at: () => number } {
  const times: number[] = [];
  const t = client as EspnClient & { fetchedAt?: (b: unknown) => number | null };
  const view: EspnClient = new Proxy(t, {
    get(target, prop) {
      if (prop === "get") return async (url: string, headers: Record<string, string> = {}, o: Parameters<EspnClient["get"]>[2] = {}) => {
        const body = await target.get(url, headers, fresh ? { ...o, fresh: true } : o);
        times.push(target.fetchedAt?.(body) ?? now);
        return body;
      };
      // tsdbRead reads through this.get: called on the view, so its reads are noted (and fresh) too
      if (prop === "tsdbRead") return (...a: Parameters<EspnClient["tsdbRead"]>) => target.tsdbRead.apply(view, a);
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(target) : v;
    },
  });
  return { client: view, at: () => (times.length ? Math.min(...times) : now) };
}
/**
 * Whether this cycle's read by `op` could be a game coin's SECOND read (ONE SOURCE TWICE): the record is not held, `op` has a remembered
 * read not yet confirmed, and GAME_CONFIRM_GAP_MS has passed since that print was first fetched. Such a read is fetched fresh.
 */
export function confirmingRead(rec: FirstRead | null | undefined, op: string, now: number): boolean {
  if (!rec || rec.disputed?.length || rec.contradiction || rec.ignored?.includes(op)) return false;
  const x = rec.reads?.[op];
  if (!x) return false;
  const start = Math.max(x.since ?? x.at, rec.firstReadAt);
  return x.at - start < GAME_CONFIRM_GAP_MS && now - start >= GAME_CONFIRM_GAP_MS;
}

/**
 * Settles one completed game. The PRIMARY is the on-chain payout where a market exists, else TheSportsDB's licensed final; the
 * on-chain payout and TheSportsDB are independent operators, so when both exist each confirms the other. The league's official feed
 * (MLB, NHL, NBA) is a further read where it is free, API-Sports where its key is set. At least TWO operators must read the game and
 * every read must agree (scores where both carry scores, else the winner); one operator alone is held.
 */
export async function settleGame(client: EspnClient, g: Game, d: GameDeps, o: { schedule?: "game" } = {}): Promise<GameVerdict> {
  if (o.schedule === "game") return settleGameReads(client, g, d, true, null);
  // FINAL CHECK (owner, 2026-10-20): a team, season or rivalry coin's game settles on a second agreeing read GAME_CONFIRM_GAP_MS after
  // the first (finalCheck). The confirming cycle reads every source fresh, so a cached answer is never taken for the second read.
  const store = d.finalChecks ?? null, nowMs = (d.now ?? Date.now)();
  const first = store?.get(gameKeyOf(g)) ?? null;
  const io: TeamReadIo = { fresh: !!first && nowMs - first.at >= GAME_CONFIRM_GAP_MS, notFinal: [], fetchedAt: [] };
  const v = await settleGameReads(client, g, d, false, io);
  return store ? finalCheck(store, g, v, io, nowMs, d) : v;
}
/** What a team coin's game read tells its FINAL CHECK: whether to read fresh, the sources that answered "not final", and the fetch times. */
interface TeamReadIo { fresh: boolean; notFinal: string[]; fetchedAt: number[] }
async function settleGameReads(client: EspnClient, g: Game, d: GameDeps, gameCoin: boolean, team: TeamReadIo | null): Promise<GameVerdict> {
  type Read = { op: string; label: string; winner: "home" | "away" | "tie"; final: { home: number; away: number } | null; detail: string; url: string; pens?: boolean; declared?: "home" | "away" | null; aet?: boolean; ninety?: boolean; fetchedAt?: number };
  // a game coin's record: a source whose remembered print may be confirmed this cycle is read fresh (confirmingRead)
  const nowMs = (d.now ?? Date.now)(), rec = gameCoin ? d.firstReads?.get(gameKeyOf(g)) ?? null : null;
  const fresh = (op: string): boolean => (team ? team.fresh : confirmingRead(rec, op, nowMs));
  const reads: Read[] = []; const pending: string[] = []; const errors: string[] = [];
  // the sources that answered that the game is NOT final (UNFINAL in gameSchedule; the FINAL CHECK of a team coin's game)
  const notFinal: string[] = team?.notFinal ?? [];
  // A GAME COIN's contradictions are saved on its record (gameSchedule `contra`), so a later cycle on which that source is quiet (one
  // Polygon leg failing) cannot release them; any other game returns held at once, as before.
  let contra: { op: string; why: string } | null = null;
  // the on-chain payout
  const lookup = { failed: false };
  const market = d.market ? await d.market(g).catch(() => { lookup.failed = true; return null; }) : null;
  if (market?.threeWay) {
    const r = await threeWayRead(market, market.threeWay, d, fresh("on-chain payout"));
    if (r.kind === "held") { if (!gameCoin) return { kind: "held", why: r.why }; contra = { op: "on-chain payout", why: r.why }; }
    else if (r.kind === "awaiting") pending.push(r.why);
    else reads.push({ op: "on-chain payout", label: "the game's on-chain payout", winner: r.winner, final: null, detail: r.detail, url: market.url, ninety: true, ...(r.fetchedAt !== undefined ? { fetchedAt: r.fetchedAt } : {}) });
  } else if (market) {
    // 2026-10-18 review: the confirming read of a payout read alone goes to the RPC again (a resolved vector is otherwise cached for good)
    const p = d.payout ? await d.payout(market.conditionId, fresh("on-chain payout") ? { fresh: true } : undefined).catch(() => null) : null;
    if (!p || !p.resolved) pending.push(`the on-chain payout for ${market.question} is not resolved yet`);
    else {
      const name = p.outcome === null ? null : market.outcomes[p.outcome];
      const winner = name === null ? "tie" : sideMatches(name, g.home) ? "home" : sideMatches(name, g.away) ? "away" : null;
      if (winner === null) { const why = `the payout names "${name}", which matches neither team`; if (!gameCoin) return { kind: "held", why }; contra = { op: "on-chain payout", why }; }
      else reads.push({ op: "on-chain payout", label: "the game's on-chain payout", winner, final: null, detail: `on-chain payout ${market.question}: ${name ?? "split"}`, url: market.url, ...(p.fetchedAt !== undefined ? { fetchedAt: p.fetchedAt } : {}) });
    }
  }
  // TheSportsDB (licensed)
  if (d.tsdbKey) {
    try {
      // v2 with the key in the header; a key v2 refuses is read through v1 (espn.ts tsdbRead), the key never logged
      let f: Final | null = null, any = false, err: Error | null = null;
      const src = sourceReader(client, fresh("TheSportsDB"), nowMs);
      // the day listing first (2026-10-13: v2 search/event finds nothing for any league); the name search stays as the fallback
      try { f = await tsdbFinalByDay(src.client, d.tsdbKey, g); any = true; } catch (e) { err = e as Error; }
      for (const names of f ? [] : tsdbNamePairs(g)) {
        let body: unknown;
        try { body = await src.client.tsdbRead(d.tsdbKey, tsdbV2Url(names), (k) => [tsdbV1SearchUrl(k, names)]); any = true; } catch (e) { err = e as Error; continue; }
        f = finalFromTsdb(g, body, tsdbV2Url(names));
        if (f) break;
      }
      if (!any && err) throw err;
      if (f?.unresolved) { if (!gameCoin) return { kind: "held", why: f.unresolved }; contra ??= { op: "TheSportsDB", why: f.unresolved }; }
      else if (f && f.done) reads.push({ op: "TheSportsDB", label: "a licensed final score", winner: winnerOf(f), final: { home: f.home, away: f.away }, detail: f.detail, url: f.url, pens: f.pens, declared: f.declared, aet: f.aet, fetchedAt: src.at() });
      else { if (f) notFinal.push("TheSportsDB"); pending.push(f ? `TheSportsDB has the game but not final: ${f.detail}` : "TheSportsDB has no final for the game yet"); }
    } catch (e) { errors.push(`TheSportsDB: ${(e as Error).message.slice(0, 80)}`); }
  }
  if (!market && !d.tsdbKey) return { kind: "held", why: "no primary: no moneyline market for the game and BURNTICKER_THESPORTSDB_KEY (the commercial license) is not set" };
  // the league's official feed (free) and API-Sports (optional)
  const off = officialOf(g.league);
  // F-4 review: API-Sports out for now (budget spent, or a refusal) is counted out of the operators below (dOps)
  let dOps: GameDeps = d;
  for (const id of [off, d.apiSportsKey ? "apisports.games" as const : null]) {
    if (!id) continue;
    // 2026-10-18: API-Sports is read only inside its window (apiSportsWindow). A skipped read is "not answered": it never ends or starts
    // a one-source hold, is never "API-Sports out" (dOps), and is never a disagreement. A remembered final stands as its read.
    if (id === "apisports.games") {
      const w = apiSportsWindow(g, d, nowMs, gameCoin);
      if (w.kind === "skip") {
        // review 2026-10-18: once the window has CLOSED (never before kickoff), a team coin counts API-Sports out (dOps), so a game
        // only TheSportsDB can read takes its 12-hour hold instead of waiting for good. When TheSportsDB first shows a final after the
        // window, API-Sports is read once more (lateApiSportsAt on the hold mark), in case it has the final by then.
        const mark = w.closed && !gameCoin && d.holds ? d.holds.get(holdKeyOf(g)) : null;
        const tsdbFinal = reads.some((r) => r.op === "TheSportsDB" && !!r.final);
        const late = w.closed && !gameCoin && !!d.holds && tsdbFinal && mark?.lateApiSportsAt === undefined;
        // (counted out only while TheSportsDB has a final: with none, the game simply waits for a read, never "held")
        if (!late) { pending.push(w.why); if (w.closed && !gameCoin && tsdbFinal) dOps = { ...d, apiSportsKey: null }; continue; }
        d.holds!.set(holdKeyOf(g), { ...(mark ?? { home: NO_SCORE, away: NO_SCORE, firstSeenAt: nowMs }), lateApiSportsAt: nowMs });
      }
      if (w.kind === "remembered") {
        if (!(gameCoin && w.inRecord)) reads.push({ op: id, label: CROSS_LABEL[id], winner: winnerOf(w.final), final: { home: w.final.home, away: w.final.away }, detail: w.final.detail ?? `API-Sports ${w.final.away}–${w.final.home} (final, read at ${iso(w.final.at)})`, url: w.final.url ?? "", pens: w.final.pens, declared: w.final.declared ?? null, aet: w.final.aet });
        continue;
      }
    }
    try {
      const src = sourceReader(client, fresh(id), nowMs);
      const c = await crossFinal(src.client, g, d, id);
      // F-4 re-review: an answer ends a running one-source hold; a final is remembered for the comparison below
      secondSourceAnswered(d.holds, g, (d.now ?? Date.now)(), c.final && c.final.done ? { op: id, home: c.final.home, away: c.final.away, detail: c.final.detail, url: c.final.url, pens: c.final.pens, declared: c.final.declared, aet: c.final.aet } : null);
      if (c.final && c.final.done) reads.push({ op: id, label: CROSS_LABEL[id], winner: winnerOf(c.final), final: { home: c.final.home, away: c.final.away }, detail: c.final.detail, url: c.final.url, pens: c.final.pens, declared: c.final.declared, aet: c.final.aet, fetchedAt: src.at() });
      else { if (c.final) notFinal.push(id); pending.push(`${CROSS_LABEL[id]} has no final for the game yet`); }
    } catch (e) { errors.push(`${CROSS_LABEL[id]}: ${(e as Error).message.slice(0, 80)}`); if (id === "apisports.games" && apiSportsOut(e)) dOps = { ...d, apiSportsKey: null }; }
  }
  // THE THREE-WAY PAYOUT AND EXTRA TIME (see threeWayRead): Polymarket's soccer markets settle on the 90-minute result, so a cup tie
  // that went to extra time or penalties reads "draw" on chain whoever went through. When any score read marks the game AET or decided
  // on penalties, the payout is compared on what it does say (the game was level after 90 minutes; a payout naming a winner there
  // contradicts the score reads and holds the game) and is then NOT counted as one of the two operators, because it says nothing about
  // the final. The final, and the penalty winner under item 78 below, must come from two other reads.
  if (reads.some((r) => r.op !== "on-chain payout" && (r.pens || r.aet))) {
    const i = reads.findIndex((r) => r.ninety);
    if (i >= 0) {
      const why = `the on-chain payout says the game was decided in 90 minutes, but a score read says it went to extra time — held`;
      if (reads[i].winner !== "tie") { if (!gameCoin) return { kind: "held", why }; contra ??= { op: "on-chain payout", why }; }
      // a game coin keeps the level-after-90 read in its reads: gameSchedule leaves it out of the remembered final (it says nothing about
      // the final) but counts it as that source reading cleanly, which clears a remembered contradiction
      else if (!gameCoin) {
        reads.splice(i, 1);
        if (operatorsFor(g.league, dOps, false).length < 2) return { kind: "held", why: "the game went past 90 minutes, and the on-chain payout only settles the 90-minute result: a second read of the final score is needed" };
      }
    }
  }
  // A GAME COIN (owner, 2026-10-16; review of b3249737): one source is enough, any operator can be the first, every operator's latest
  // read is remembered on the record (gameSchedule), and the on-chain settlement only confirms. Settled on the first score read
  // (TheSportsDB, then a league feed or API-Sports), the on-chain settlement last.
  if (gameCoin) {
    const h = gameSchedule(d.firstReads, g, reads.map((r) => ({ op: r.op, winner: r.winner, final: r.final, detail: r.detail, url: r.url, declared: r.declared ?? null, pens: r.pens, aet: r.aet, ninety: r.ninety, ...(r.fetchedAt !== undefined ? { fetchedAt: r.fetchedAt } : {}) })), (d.now ?? Date.now)(), pending[0] ?? errors[0] ?? null, contra, notFinal);
    if (h.kind === "held") return { kind: "held", why: h.why };
    if (h.kind === "awaiting") { if (h.reset) noteCheck(d, g, h.why); return { kind: "awaiting", why: h.why, dueAt: h.dueAt }; }
    const mk = h.mark, mem = mk.reads ?? {};
    const rank = (op: string): number => (op === "TheSportsDB" && mem[op].home !== null ? 0 : op === "on-chain payout" ? 2 : 1);
    const order = Object.keys(mem).sort((a, b) => rank(a) - rank(b));
    let winner = mk.winner;
    const final = mk.home !== null && mk.away !== null ? { home: mk.home, away: mk.away } : null;
    // item 78: a level score decided on penalties follows the declared winner, as below
    if (winner === "tie" && final && final.home === final.away) {
      const flag = g.home.winner === true ? "home" : g.away.winner === true ? "away" : null;
      const named = new Set([...Object.values(mem).map((r) => r.declared ?? null), flag].filter((x): x is "home" | "away" => !!x));
      if (named.size > 1) return { kind: "held", why: "the sources name different winners of the penalty shoot-out — held" };
      if (named.size === 1) winner = [...named][0];
      else if (Object.values(mem).some((r) => r.pens)) return { kind: "held", why: "the game was decided on penalties, but no source names the winner — held" };
    }
    return { kind: "settled", winner, final, settledOn: order[0], confirmedBy: andList(order.slice(1).map(opLabel)), ops: order, detail: order.map((o) => mem[o].detail).join("; "), url: mem[order[0]].url, settledBy: settledByOf(order), firstReadAt: mk.firstReadAt, ...(h.twoSources ? { twoSources: true } : {}), ...(h.twice ? { twice: true } : {}) };
  }
  if (team) team.fetchedAt = reads.flatMap((r) => (r.fetchedAt !== undefined ? [r.fetchedAt] : []));
  const primary = reads.find((r) => r.op === "on-chain payout") ?? reads.find((r) => r.op === "TheSportsDB");
  const others = reads.filter((r) => r !== primary);
  // F residual gap: a second source's final remembered from an earlier cycle (read while TheSportsDB had no final yet; that source may be
  // quiet or out now) is compared with every read of this cycle. A mismatch is a disagreement: marked for good and held.
  for (const [op, f] of Object.entries(d.holds?.get(holdKeyOf(g))?.finals ?? {})) {
    if (reads.some((r) => r.op === op)) continue;   // read again this cycle: compared with the primary below
    const clash = reads.find((r) => (r.final ? r.final.home !== f.home || r.final.away !== f.away : r.winner !== winnerOf(f)));
    if (clash) { sourcesDisagreed(d.holds, g, (d.now ?? Date.now)()); return { kind: "held", why: `${clash.detail} ≠ ${(CROSS_LABEL as Record<string, string>)[op] ?? op} ${f.away}–${f.home} (away–home, read at ${iso(f.at)}) — held: a second source disagreed with this final, so it waits for two sources that agree` }; }
  }
  let singleSince: number | null = null;
  if (!primary || others.length === 0) {
    const possible = operatorsFor(g.league, dOps, !!market);
    // ONE SOURCE (owner, 2026-10-14): no Polymarket market and no second operator that can read the game, so TheSportsDB's final
    // settles it alone once the same score has stood for 12 hours. A failed market lookup is not "no market": the game waits.
    if (primary?.op === "TheSportsDB" && primary.final && !market && possible.length < 2) {
      if (lookup.failed) return { kind: "awaiting", why: "the Polymarket market lookup failed, so it cannot be told whether the game has a market; read again next cycle" };
      const h = singleSourceHold(d.holds, g, primary.final, (d.now ?? Date.now)());
      // re-read hourly while the hold runs (a changed score starts it again), and at its end
      if (!h.ready) return { kind: "awaiting", why: h.why, dueAt: h.due !== undefined ? Math.min(h.due, nowMs + 3_600_000) : null };
      singleSince = h.since;
    } else if (possible.length < 2) return { kind: "held", why: `only one operator can read this game (${possible.join(", ") || "none"}): a second independent read is needed` };
    else return { kind: "awaiting", why: pending[0] ?? errors[0] ?? "waiting for a second read" };
  }
  if (!primary) return { kind: "awaiting", why: pending[0] ?? errors[0] ?? "waiting for a read" };
  for (const r of others) {
    const agree = primary.final && r.final ? primary.final.home === r.final.home && primary.final.away === r.final.away : primary.winner === r.winner;
    if (!agree) { sourcesDisagreed(d.holds, g, (d.now ?? Date.now)()); return { kind: "held", why: `${primary.detail} ≠ ${r.detail} — held` }; }
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
  const ops = reads.map((r) => r.op);
  return { kind: "settled", winner, final: primary.final ?? others.find((r) => r.final)?.final ?? null, settledOn: primary.op === "on-chain payout" ? "on-chain payout" : "TheSportsDB", confirmedBy: confirmed.join(" and "), ops, detail: reads.map((r) => r.detail).join("; "), url: primary.url, settledBy: singleSince !== null ? SINGLE_SOURCE_SETTLED_BY : settledByOf(ops), ...(singleSince !== null ? { singleSince } : {}) };
}

/** A schedule status that means the game was not played on its listed date (MLB marks these "post" without a result). */
export const POSTPONED_RE = /postpon|cancel|suspend/i;

const outcomeFor = (winner: "home" | "away" | "tie", g: Game, abbr: string, teamId: string | null): "win" | "loss" | "tie" | null => {
  const isUs = (x: GameSide) => (teamId && x.id ? x.id === teamId : x.abbr === abbr);
  const us = isUs(g.home) ? "home" : isUs(g.away) ? "away" : null;
  if (!us) return null;
  return winner === "tie" ? "tie" : winner === us ? "win" : "loss";
};

/**
 * What a GAME COIN's reading says after its operators: two sources agreeing (owner, 2026-10-16), or one source showing the same final
 * twice (owner, 2026-10-18 evening). GAME_SCHEDULE_WORDS is the 12-hour form written until 2026-10-18 (SEAWIN and DENWIN carry it): it is
 * no longer written, and the readers (settledTitle.ts, leagues.ts) still read it.
 */
export const GAME_SCHEDULE_WORDS = "burned 12 hours after the final was first read";
export const GAME_TWO_SOURCE_WORDS = "burned when two sources had confirmed it";
export const GAME_TWICE_WORDS = "burned when one source had confirmed the final twice";
/**
 * How a reading's title says the game settled: "settled on X · confirmed by Y", or "settled on a licensed final score · TheSportsDB only,
 * confirmed after a 12 h hold". A game coin names every operator that confirmed by the time it burned: "settled on a licensed final
 * score · confirmed by the game's on-chain settlement · burned when two sources had confirmed it", or, settled on one source's final read
 * twice, "settled on a licensed final score · no other source answered · burned when one source had confirmed the final twice".
 */
export const settledWords = (v: Extract<GameVerdict, { kind: "settled" }>): string => (v.firstReadAt !== undefined
  ? `settled on ${opLabel(v.settledOn)} · ${v.confirmedBy ? `confirmed by ${v.confirmedBy}` : "no other source answered"} · ${v.twoSources ? GAME_TWO_SOURCE_WORDS : GAME_TWICE_WORDS}`
  : v.singleSince !== undefined ? `settled on ${SETTLED_ON.TheSportsDB} · ${SINGLE_SOURCE_SETTLED_BY}` : `settled on ${SETTLED_ON[v.settledOn as keyof typeof SETTLED_ON] ?? opLabel(v.settledOn)} · confirmed by ${v.confirmedBy}`);
/** A reading's method: the operators joined by "+" (a game coin's ends "+two-sources-agreed" or "+one-source-read-twice"; until 2026-10-18 "+12h-after-first-read"), or "thesportsdb-only-12h-hold". */
const methodOf = (v: Extract<GameVerdict, { kind: "settled" }>): string => (v.singleSince !== undefined ? "thesportsdb-only-12h-hold" : v.ops.map((o) => (o === "on-chain payout" ? "onchain-payout" : o === "TheSportsDB" ? "thesportsdb" : o)).join("+") + (v.firstReadAt !== undefined ? (v.twoSources ? "+two-sources-agreed" : "+one-source-read-twice") : ""));
/** The measure-only notice for a game settled on one source (GameDeps.onSingleSource); a throwing listener never changes a reading. */
const noteSingle = (d: GameDeps, seriesId: string | null, g: Game, v: Extract<GameVerdict, { kind: "settled" }>): void => {
  if (v.singleSince === undefined || !d.onSingleSource || !v.final) return;
  try { d.onSingleSource({ seriesId, game: g, final: v.final, heldSince: v.singleSince, settledBy: v.settledBy ?? SINGLE_SOURCE_SETTLED_BY }); } catch { /* measure only */ }
};

/** Settled readings for a team or game series since `sinceIso` (the keeper and the back-test). */
/** While a game's final is being read, the keeper reads again this often (THE NEXT READ). */
export const GAME_LIVE_POLL_MS = 5 * 60_000;
/** A team coin with no game listed ahead looks at the schedule again after this long. */
export const SCHEDULE_RECHECK_MS = 6 * 3_600_000;
/** A game the schedule still shows unfinished this long after its start is read hourly, not every few minutes (a stale listing). */
export const STALE_GAME_MS = 24 * 3_600_000;
/**
 * A listing still "in progress" this long after its start is reported (THE STUCK LISTING). No game of a league we list lasts 36 hours; a
 * suspended or postponed game is relabelled by the schedule (POSTPONED_RE) and then holds nothing. The day stays held: writing it without
 * the stuck game would be revised when that game settles (the registry refuses a changed value and holds the whole feed), which is worse
 * than one held day. So the bound raises an alert (the cycle's refusals → bt-reading-implausible) for an operator to look at the listing;
 * the hourly look (gameDueAt) goes on, so the day is read as soon as the listing turns final or postponed.
 */
export const STUCK_LISTING_MS = 36 * 3_600_000;
/** The alert for a game listed in progress past STUCK_LISTING_MS, or null. */
export function stuckListing(g: Pick<Game, "startsAt" | "eventId" | "name" | "date">, now: number): string | null {
  const start = Date.parse(g.startsAt);
  if (!Number.isFinite(start) || now - start <= STUCK_LISTING_MS) return null;
  return `${g.eventId} ${g.name}: the schedule still lists this game in progress ${Math.floor((now - start) / 3_600_000)} hours after its start, so ${g.date} is held until it is listed final or postponed; check the listing`;
}
/**
 * The first look at a game's schedule after its start (owner 2026-10-20: no six-hour wait; a game is read as soon as it is final). No
 * game of any league we list is over sooner (a soccer game is 90 minutes plus a 15-minute break), so the polls before that are skipped.
 */
export const GAME_FIRST_LOOK_MS = 90 * 60_000;
/**
 * The next look at a game the schedule does not show final yet: GAME_FIRST_LOOK_MS after its start, then every GAME_LIVE_POLL_MS while it
 * is played, so its final is noticed within minutes of the end; hourly once the listing is STALE_GAME_MS old.
 */
export function gameDueAt(g: Pick<Game, "startsAt"> & { league?: LeagueId }, now: number, live = false): number | null {
  const start = Date.parse(g.startsAt);
  if (!Number.isFinite(start)) return null;
  // THE LIVE SCHEDULE READ: a free official schedule is looked at every LIVE_FREE_POLL_MS while the game is played (the keeper only)
  // THE LIVE GAME READ ON THESPORTSDB (espn.ts): a tracked NBA or soccer game too, through its own short-cached event lookup
  const poll = live && g.league && (liveScheduleLeague(g.league) || tsdbLiveLeague(g.league)) ? LIVE_FREE_POLL_MS : GAME_LIVE_POLL_MS;
  return now - start > STALE_GAME_MS ? now + 3_600_000 : Math.max(start + GAME_FIRST_LOOK_MS, now + poll);
}
/** The keeper's look at a game being played whose schedule is a free official feed (liveSchedule): about every minute. */
export const LIVE_FREE_POLL_MS = 60_000;
/**
 * Marks the leagues with a tracked game past its first look whose schedule does not say final yet (in play; not postponed, not stale),
 * so the client keeps their free official schedule short (espn.ts THE LIVE SCHEDULE READ). Once the schedule says final the game's
 * confirming reads go to the settlement sources, so the short cache is not kept for it. Keeper only (GameDeps.liveSchedule).
 */
export function markLiveGames(client: EspnClient, d: Pick<GameDeps, "liveSchedule">, games: readonly Game[], now: number): void {
  if (!d.liveSchedule) return;
  const c = client as EspnClient & { markLive?: (l: LeagueId) => void; markLiveGame?: (l: LeagueId, id: string) => void };
  for (const g of games) {
    const start = Date.parse(g.startsAt);
    if (!Number.isFinite(start) || now < start + GAME_FIRST_LOOK_MS || now - start > STALE_GAME_MS || POSTPONED_RE.test(g.detail)) continue;
    if (g.completed || g.state === "post") continue;
    // MLB and NHL: the whole league's day listing; the NBA and soccer (TheSportsDB): the one game's event lookup
    if (tsdbLiveLeague(g.league)) c.markLiveGame?.(g.league, g.eventId); else c.markLive?.(g.league);
  }
}
/**
 * A game the schedule marks final before GAME_FIRST_LOOK_MS after its start (or before it starts): no game of a league we list is over by
 * then, so the listing is wrong (or the start is), and the game is not read until then. Part of what the six-hour wait used to cover.
 */
export function listedTooEarly(g: Pick<Game, "startsAt">, now: number): boolean {
  const start = Date.parse(g.startsAt);
  return Number.isFinite(start) && now < start + GAME_FIRST_LOOK_MS;
}
/** How long after a game's start a final waiting on a source (no due time of its own) is chased every GAME_LIVE_POLL_MS; after that the feed's own poll applies. */
export const FINAL_CHASE_MS = 8 * 3_600_000;
/** The next read of a game the schedule shows final while a source has not answered with its final yet (finalChaseDue), or null for the poll. */
export function finalChaseDue(g: Pick<Game, "startsAt">, now: number): number | null {
  const start = Date.parse(g.startsAt);
  return Number.isFinite(start) && now - start <= FINAL_CHASE_MS ? now + GAME_LIVE_POLL_MS : null;
}
/** The soonest due time among the listed games not over yet (postponed ones aside), or null. */
export function nextListedDue(games: readonly Game[], now: number): number | null {
  const ts = games.filter((g) => !g.completed && g.state !== "post" && !POSTPONED_RE.test(g.detail)).map((g) => gameDueAt(g, now)).filter((t): t is number => t !== null);
  return ts.length ? Math.min(...ts) : null;
}
/** The latest due time among the listed games not over yet (a series that ends with the later season), or null. */
export function lastListedDue(games: readonly Game[], now: number): number | null {
  const ts = games.filter((g) => !g.completed && g.state !== "post" && !POSTPONED_RE.test(g.detail)).map((g) => gameDueAt(g, now)).filter((t): t is number => t !== null);
  return ts.length ? Math.max(...ts) : null;
}

/**
 * THE RULE'S OWN SCHEDULE, from the schedule alone (no settlement source is read): when sportsSettled would ask to be read next, as far
 * as the listing tells. The keeper (multiKeeper.ts fetchDue) uses it only to bring forward a next read stored by an older rule (the six
 * hours after a game's start, before 2026-10-20), so a stored time is never later than what the current rule schedules. Mirrors the
 * branches of sportsSettled and meetingsSettled: a game not over → gameDueAt; a final listed too early → its first look; a final the
 * schedule shows and no reading of its day yet → now (read at once); otherwise the next listed game, else SCHEDULE_RECHECK_MS.
 */
export async function plannedGameRead(client: EspnClient, s: EspnSeries, sinceIso: string | null, now: number, live = false): Promise<number> {
  const ms = asMeetings(s);
  const all = await gamesFor(client, ms ?? s, ms ? null : sinceIso);
  const since = sinceIso ? sinceIso.slice(0, 10) : null;
  let t: number | null = null;
  const at = (x: number | null) => { if (x !== null && Number.isFinite(x) && (t === null || x < t)) t = x; };
  for (const g of all) {
    if (since && g.date <= since) continue;
    if (!g.completed && (g.state === "post" || POSTPONED_RE.test(g.detail))) continue;
    if (!g.completed) { at(gameDueAt(g, now, live)); continue; }
    if (listedTooEarly(g, now)) { at(gameDueAt(g, now)); continue; }
    at(now);
  }
  return t ?? (ms ? lastListedDue(all, now) : nextListedDue(all, now)) ?? now + SCHEDULE_RECHECK_MS;
}

/** A counted game's times for its day reading (launchCut.ts THE LAUNCH-DAY CUT). */
const gameTimeOf = (g: Game, v: Extract<GameVerdict, { kind: "settled" }>): GameTime => {
  const f = v.finalFirstReadAt ?? v.firstReadAt ?? v.singleSince;
  return { id: g.eventId, league: g.league, start: g.startsAt, final: f !== undefined && Number.isFinite(f) ? new Date(f).toISOString() : null };
};

export async function sportsSettled(client0: EspnClient, s: EspnSeries, sinceIso: string | null, d: GameDeps, o: { nowMs?: number; seriesId?: string | null; /** HB-83: the review's display-only back-test */ display?: boolean; /** reviewer G: the earliest launch of a coin on this selector */ launchedAtMs?: number | null } = {}): Promise<ResolvedSelector> {
  // reviewer G: a selector with a coin launched before HB-153 reads TheSportsDB's season types as that coin was launched under
  const client = typeof o.launchedAtMs === "number" && o.launchedAtMs < HB153_FROM_MS ? clientBefore153(client0) : client0;
  // the deps' clock when the host gives one (the keeper's wall clock; a test's or rehearsal's moved clock), so the next-read times and a
  // game's two reads are measured on the same clock
  const now = o.nowMs ?? d.now?.() ?? Date.now();
  const ms = asMeetings(s);
  if (ms) return meetingsSettled(client, ms, d, now, o.seriesId ?? null);
  const all = await gamesFor(client, s, sinceIso);
  const games = all.filter((g) => !sinceIso || g.date > sinceIso.slice(0, 10));
  const tid = s.kind === "team" ? s.teamId : null;
  const byDay = new Map<string, { value: number; titles: string[]; url: string; method: string; games?: GameTime[] }>();
  let awaiting = 0, dueAt: number | null = null, undated = 0; const refusals: string[] = [];
  const due = (t: number | null) => { if (t !== null && Number.isFinite(t) && (dueAt === null || t < dueAt)) dueAt = t; };
  // a single-game coin (owner, 2026-10-16) burns once two sources agree or one source shows the same final twice (gameSchedule, 2026-10-18); team coins keep their rules
  const sched = s.kind === "game" ? { schedule: "game" as const } : {};
  // semantics-verify items 79 and 80: a day's reading is one id (its UTC date) and the registry refuses a changed value for an id it
  // holds, so a day is read only once every game of it has a result. A game still awaiting holds its whole day (a doubleheader's first
  // game is never written alone and then contradicted by the second). A postponed, cancelled or suspended game that is not final counts
  // for neither side and does not hold its day; a made-up game is read on the date it is played.
  const waitingDays = new Set<string>(), stuck: string[] = [];
  for (const g of games) {
    // a game not over yet (scheduled or in progress): looked at again soon after its start and then every few minutes (gameDueAt).
    // Owner 2026-10-20: a game marked final is read at once (no six-hour wait); settleGame then asks for the second read 5 minutes later.
    // A game not over yet also holds its day (2026-10-20): with no six-hour wait, a doubleheader's first game is final while the second is
    // still being played, and the day must not be written with one result that the second game would change.
    if (!g.completed && g.state !== "post") { if (!POSTPONED_RE.test(g.detail)) { due(gameDueAt(g, now, !!d.liveSchedule)); waitingDays.add(g.date); const st = stuckListing(g, now); if (st && !stuck.includes(st)) stuck.push(st); } continue; }
    if (!g.completed && POSTPONED_RE.test(g.detail)) continue;
    // a final listed before the game can be over (before GAME_FIRST_LOOK_MS after its start) is a wrong listing: not read until then
    if (listedTooEarly(g, now)) { awaiting++; waitingDays.add(g.date); due(gameDueAt(g, now)); continue; }
    // HB-83 (hourly run 6): the review's back-test is display-only, so it counts each final from the schedule it already read. Settling
    // every game (a league feed's day pages, the on-chain market, TheSportsDB per game) spent the MLB Stats API's whole rate budget on
    // one wizard walk; the keeper never takes this branch.
    if (o.display && s.kind === "team") {
      const out = outcomeOf(g, s.abbr, tid);
      if (out === null) continue;
      const cur = byDay.get(g.date) ?? { value: 0, titles: [], url: "", method: "schedule (display only)" };
      if (outcomeHits(s.outcome, out)) cur.value++;
      cur.titles.push(`${g.away.abbr} ${g.away.score} @ ${g.home.abbr} ${g.home.score} final (${out === "tie" || out === "draw" ? "draw" : `${s.abbr} ${out}`}) · read from the league's schedule, for display only`);
      byDay.set(g.date, cur);
      continue;
    }
    const v = await settleGame(client, g, d, sched);
    if (v.kind === "awaiting") { awaiting++; waitingDays.add(g.date); const t = v.dueAt ?? finalChaseDue(g, now); if (t) due(t); else undated++; continue; }
    // a held game (a disagreement) holds its day too, exactly as meetingsSettled: a doubleheader's day is never written with game 1
    // alone and then revised when game 2 settles (the registry refuses a changed value: RevisedReadingError holds the feed)
    if (v.kind === "held") { const r = /^no primary|^cross-read missing/.test(v.why) ? v.why : `${g.eventId} ${g.name}: ${v.why}`; if (!refusals.includes(r)) refusals.push(r); waitingDays.add(g.date); continue; }
    const out = outcomeFor(v.winner, g, s.abbr, tid);
    if (out === null) continue;
    const cur = byDay.get(g.date) ?? { value: 0, titles: [], url: v.url, method: "" };
    // one unit when the result is in the coin's set: its one outcome, or two of the three (espn.ts outcomeHits; a tie is a draw)
    if (outcomeHits(s.outcome, out)) cur.value++;
    const score = v.final ? `${g.away.abbr} ${v.final.away} @ ${g.home.abbr} ${v.final.home}` : `${g.away.abbr} @ ${g.home.abbr}`;
    cur.titles.push(`${score} final (${out === "tie" ? "draw" : `${s.abbr} ${out}`}) · ${settledWords(v)} · see this game on ESPN → ${espnGameUrl(g.league, g.date, g.startsAt)}`);
    cur.method = methodOf(v);
    (cur.games ??= []).push(gameTimeOf(g, v));
    noteSingle(d, o.seriesId ?? null, g, v);
    byDay.set(g.date, cur);
  }
  markLiveGames(client, d, games, now);
  for (const day of waitingDays) byDay.delete(day);
  const events: SettledEvent[] = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, x]) => ({ id: date, at: date, result: null, value: String(x.value), title: x.titles.join(" · "), sourceUrl: x.url, method: x.method, ...(x.games?.length ? { proof: gameTimesProof(x.games) } : {}) } as SettledEvent));
  const window = windowStatus(s, s.kind === "team" && s.window.kind === "post" ? await client.season(s.league, s.teamId ?? s.abbr, s.window.year).catch(() => all) : all, now);
  // THE NEXT READ (owner 2026-10-19; 2026-10-20): the earliest moment a new result can exist. A final waiting on a source with no time of
  // its own is read every few minutes for FINAL_CHASE_MS after the start and then keeps the poll (null); otherwise the soonest of: a
  // waiting game's due time (its second read), the next listed game's next look (gameDueAt); with no game listed at all, the schedule is
  // looked at again in SCHEDULE_RECHECK_MS.
  const next: number | null = undated > 0 || refusals.length > 0 ? null : dueAt ?? nextListedDue(all, now) ?? now + SCHEDULE_RECHECK_MS;
  // a listing stuck "in progress" past STUCK_LISTING_MS is reported (an alert) but keeps its day held and keeps its hourly look: it does
  // not change THE NEXT READ above
  return { events, awaitingFinal: awaiting, refusals: [...refusals, ...stuck], settlementSourceUrl: null, window, ...(next !== null ? { dueAt: next } : {}) };
}

/**
 * PRIMARY A's readers over the Polymarket client: Gamma search by the two teams (closed and open), a moneyline market whose two outcomes
 * name the two teams and whose end falls within a day of the game; the payout from the CTF on Polygon (readChain).
 */
/**
 * Polymarket's tag slug per league (Gamma /events?tag_slug=): read 2026-10-13 against the live index; a league not here uses the text
 * search only. The soccer tags were probed with start_time windows on 2026-10-13 (each listed that week's three-leg game events): Serie A
 * is "sea" ("serie-a" lists no game events), the Champions League "ucl" and the Europa League "uel" (both empty before their matchdays on
 * 10-13 and 10-15, then full), the Conference League "europa-conference-league" ("uecl", "conference-league" and
 * "uefa-conference-league" list none), NWSL "soccer-nwsl", Liga MX "mex", Eredivisie "ere", Primeira Liga "primeira-liga", the EFL
 * Championship "efl-championship", the Scottish Premiership "scottish-premiership", the Brasileirão "brazil-serie-a", Argentina "arg".
 */
export const POLY_LEAGUE_TAG: Partial<Record<LeagueId, string>> = {
  nfl: "nfl", mlb: "mlb", nba: "nba", nhl: "nhl", wnba: "wnba", cfb: "cfb",
  "eng.1": "epl", "esp.1": "la-liga", "ger.1": "bundesliga", "fra.1": "ligue-1", "ita.1": "sea", "usa.1": "mls", "usa.nwsl": "soccer-nwsl",
  "uefa.champions": "ucl", "uefa.europa": "uel", "uefa.europa.conf": "europa-conference-league", "mex.1": "mex", "ned.1": "ere", "por.1": "primeira-liga",
  "eng.2": "efl-championship", "sco.1": "scottish-premiership", "bra.1": "brazil-serie-a", "arg.1": "arg",
};

type GameHitMarket = { conditionId: string; question: string; yes: string; no: string; endDate: string | null; sportsMarketType: string | null; gameStartTime?: string | null; /** Gamma groupItemTitle ("Arsenal FC", "Draw (Arsenal FC vs. Leeds United FC)") */ outcome?: string | null };

/** How strongly a provider's team name names a side: 0 no match, else the longest matching key (an exact name scores highest). */
const sideScore = (name: string, s: GameSide): number => { const a = norm(name); let best = 0; for (const k of [s.name, s.nickname, s.short ?? "", s.location ?? "", s.abbr]) { if (!k || k.length < 3) continue; const b = norm(k); if (a === b) best = Math.max(best, 1000); else if (a.includes(b) || b.includes(a)) best = Math.max(best, Math.min(a.length, b.length)); } return best; };
const DRAW_Q = /\bend in a draw\b/i, TEAM_WIN_Q = /^Will (.+?) win\b/i;
/**
 * A soccer event's three moneyline legs (verified live 2026-10-13 on epl-ars-lee-2026-10-10): three binary Yes/No markets of type
 * moneyline, one asking whether the game ends in a draw and two asking whether a named team wins. The two team legs are assigned to home
 * and away by the stronger name match (a derby's "Manchester" names both sides; "Manchester United FC" names one better); an event whose
 * legs cannot be assigned one way only is skipped. Null: the event is not a three-way game market for this game.
 */
export function threeWayOf(markets: readonly GameHitMarket[], g: Game): { draw: GameHitMarket; home: GameHitMarket; away: GameHitMarket; homeName: string; awayName: string } | null {
  const legs = markets.filter((m) => (m.sportsMarketType === "moneyline" || m.sportsMarketType === null) && /^yes$/i.test(m.yes) && /^no$/i.test(m.no));
  const draws = legs.filter((m) => DRAW_Q.test(m.question) || /^draw\b/i.test(m.outcome ?? ""));
  const teams = legs.filter((m) => !draws.includes(m)).map((m) => ({ m, name: (m.outcome || TEAM_WIN_Q.exec(m.question)?.[1] || "").trim() })).filter((t) => t.name && TEAM_WIN_Q.test(t.m.question));
  if (draws.length !== 1 || teams.length !== 2) return null;
  const [a, b] = teams;
  // our team table first (ourTeam: "Club Atlético de Madrid" is Atlético Madrid, never Real Madrid); a leg naming a third club is not
  // this game; the name score only where the table does not know the name
  const who = (name: string): "home" | "away" | "other" | null => { const t = ourTeam(g.league, name); return !t ? null : t.abbr === g.home.abbr ? "home" : t.abbr === g.away.abbr ? "away" : "other"; };
  const wa = who(a.name), wb = who(b.name);
  if (wa === "other" || wb === "other") return null;
  if (wa && wb) { if (wa === wb) return null; const [home, away] = wa === "home" ? [a, b] : [b, a]; return { draw: draws[0], home: home.m, away: away.m, homeName: home.name, awayName: away.name }; }
  const sc = (leg: "a" | "b", s: "home" | "away") => { const w = leg === "a" ? wa : wb; return w ? (w === s ? 10_000 : 0) : sideScore((leg === "a" ? a : b).name, g[s]); };
  const ah = sc("a", "home"), aa = sc("a", "away"), bh = sc("b", "home"), ba = sc("b", "away");
  const straight = ah > 0 && ba > 0 ? ah + ba : 0, crossed = aa > 0 && bh > 0 ? aa + bh : 0;
  if (straight === crossed) return null;
  const [home, away] = straight > crossed ? [a, b] : [b, a];
  return { draw: draws[0], home: home.m, away: away.m, homeName: home.name, awayName: away.name };
}
type GameHits = { events: { url: string; markets: GameHitMarket[] }[] };
export function polymarketGameReaders(poly: { search(q: string, o?: { status?: "open" | "closed" | "all"; limit?: number }): Promise<GameHits>; eventsInWindow?(slug: string, minIso: string, maxIso: string): Promise<GameHits>; eventsStarting?(slug: string, minIso: string, maxIso: string): Promise<GameHits>; readChain(conditionId: string, o?: { fresh?: boolean }): Promise<{ resolved: boolean; outcome: number | null }>; chainFetchedAt?(conditionId: string): number | null; peekOrSchedule?(conditionId: string): { resolved: boolean; outcome: number | null } | null }, o: { /** THE SITE (owner 2026-10-19: no Polygon read on a page build): the payout is what is stored or held now, never awaited; when nothing is held one read is started in the background (PolymarketClient.peekOrSchedule) and the game shows as not read yet */ nonBlocking?: boolean } = {}): Pick<GameDeps, "market" | "payout"> {
  type Hit = { url: string; markets: GameHitMarket[] };
  const pick = (events: readonly Hit[], g: Game): GameMarket | null => {
    // walkthrough 2026-10-13: the CLOSEST moneyline of the two teams within 2 days (a playoff series lists the same two teams on
    // consecutive days, so the first match in the window could be the next day's game), timed by the market's own game start when
    // Gamma gives one (an MLB game market ends a week after the game)
    let best: { m: GameMarket; d: number } | null = null;
    for (const e of events) for (const m of e.markets) {
      if (m.sportsMarketType && m.sportsMarketType !== "moneyline") continue;
      const names = [m.yes, m.no];
      const both = names.some((x) => sideMatches(x, g.home)) && names.some((x) => sideMatches(x, g.away));
      const when = m.gameStartTime ?? m.endDate;
      const d = when ? Math.abs(Date.parse(when) - Date.parse(g.startsAt)) : NaN;
      if (both && d < 2 * 86_400_000 && (!best || d < best.d)) best = { m: { conditionId: m.conditionId, question: m.question, outcomes: [m.yes, m.no], url: e.url }, d };
    }
    // soccer (a league with draws): the event's three yes/no legs (threeWayOf), timed the same way; the nearest game wins
    if (LEAGUES[g.league].draws) for (const e of events) {
      const t = threeWayOf(e.markets, g);
      if (!t) continue;
      const when = t.home.gameStartTime ?? t.draw.gameStartTime ?? t.home.endDate;
      const d = when ? Math.abs(Date.parse(when) - Date.parse(g.startsAt)) : NaN;
      if (d < 2 * 86_400_000 && (!best || d < best.d)) best = { m: { conditionId: t.home.conditionId, question: `${t.homeName} vs. ${t.awayName}`, outcomes: ["Yes", "No"], url: e.url, threeWay: { home: t.home.conditionId, draw: t.draw.conditionId, away: t.away.conditionId, homeName: t.homeName, awayName: t.awayName } }, d };
    }
    return best?.m ?? null;
  };
  return {
    market: async (g) => {
      // launch night 2026-10-13: the league's events in a window around the game's start first (the text search is capped at 10 hits and
      // older meetings of the same two teams crowd out the week's game: "Chiefs vs Raiders" missed nfl-kc-lv-2026-10-04)
      // walkthrough 2026-10-13: by the events' scheduled start first (an MLB game event ends a week after the game, so the end-date window
      // missed every MLB game), then by end date
      const tag = POLY_LEAGUE_TAG[g.league];
      const start = Date.parse(g.startsAt);
      if (tag && Number.isFinite(start)) {
        if (poly.eventsStarting) {
          const r = await poly.eventsStarting(tag, new Date(start - 12 * 3600_000).toISOString(), new Date(start + 12 * 3600_000).toISOString()).catch(() => null);
          const hit = r ? pick(r.events, g) : null;
          if (hit) return hit;
        }
        if (poly.eventsInWindow) {
          const r = await poly.eventsInWindow(tag, new Date(start - 36 * 3600_000).toISOString(), new Date(start + 48 * 3600_000).toISOString()).catch(() => null);
          const hit = r ? pick(r.events, g) : null;
          if (hit) return hit;
        }
      }
      const r = await poly.search(`${g.away.nickname || g.away.name} vs ${g.home.nickname || g.home.name}`, { status: "all", limit: 10 });
      return pick(r.events, g);
    },
    payout: async (id, q) => {
      if (o.nonBlocking && poly.peekOrSchedule) { const held = poly.peekOrSchedule(id); if (!held) return null; const at = poly.chainFetchedAt?.(id) ?? null; return { resolved: held.resolved, outcome: held.outcome, ...(at !== null ? { fetchedAt: at } : {}) }; }
      const c = await poly.readChain(id, q?.fresh ? { fresh: true } : {}); const at = poly.chainFetchedAt?.(id) ?? null; return { resolved: c.resolved, outcome: c.outcome, ...(at !== null ? { fetchedAt: at } : {}) };
    },
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
export async function meetingsSettled(client: EspnClient, s: MeetingsSeries, d: GameDeps, now: number, seriesId: string | null = null): Promise<ResolvedSelector> {
  const w = s.window;
  const meetings = await gamesFor(client, s, null);
  const byDay = new Map<string, { value: number; titles: string[]; url: string; method: string; games?: GameTime[] }>();
  const waitingDays = new Set<string>(), refusals: string[] = [], outcomes: MeetingOutcome[] = [], stuck: string[] = [];
  let awaiting = 0, unsettled = 0, undated = 0, dueAt: number | null = null;
  const due = (t: number | null) => { if (t !== null && Number.isFinite(t) && (dueAt === null || t < dueAt)) dueAt = t; };
  for (const g of meetings) {
    if (!g.completed && (g.state === "post" || POSTPONED_RE.test(g.detail))) { if (g.state === "post" || /cancel/i.test(g.detail)) outcomes.push("void"); continue; }
    if (!g.completed) { unsettled++; due(gameDueAt(g, now, !!d.liveSchedule)); waitingDays.add(g.date); const st = stuckListing(g, now); if (st && !stuck.includes(st)) stuck.push(st); continue; }
    if (listedTooEarly(g, now)) { awaiting++; unsettled++; waitingDays.add(g.date); due(gameDueAt(g, now)); continue; }
    // owner 2026-10-20: read at once when final (no six-hour wait); settleGame asks for the second read 5 minutes later
    const v = await settleGame(client, g, d);
    if (v.kind === "awaiting") { awaiting++; unsettled++; waitingDays.add(g.date); const t = v.dueAt ?? finalChaseDue(g, now); if (t) due(t); else undated++; continue; }
    if (v.kind === "held") { unsettled++; const r = /^no primary|^cross-read missing/.test(v.why) ? v.why : `${g.eventId} ${g.name}: ${v.why}`; if (!refusals.includes(r)) refusals.push(r); waitingDays.add(g.date); continue; }
    const out = outcomeFor(v.winner, g, s.abbr, s.teamId);
    if (out === null) continue;
    outcomes.push(out === "tie" ? "draw" : out === "win" ? "win" : out === "loss" ? "loss" : "draw");
    const cur = byDay.get(g.date) ?? { value: 0, titles: [], url: v.url, method: "" };
    cur.value += out === "win" ? 1 : out === "loss" ? -1 : 0;
    const score = v.final ? `${g.away.abbr} ${v.final.away} @ ${g.home.abbr} ${v.final.home}` : `${g.away.abbr} @ ${g.home.abbr}`;
    cur.titles.push(`${score} final (${out === "tie" ? "draw" : `${s.abbr} ${out}`}, head to head) · ${settledWords(v)} · see this game on ESPN → ${espnGameUrl(g.league, g.date, g.startsAt)}`);
    cur.method = methodOf(v);
    (cur.games ??= []).push(gameTimeOf(g, v));
    noteSingle(d, seriesId, g, v);
    byDay.set(g.date, cur);
  }
  markLiveGames(client, d, meetings, now);
  for (const day of waitingDays) byDay.delete(day);
  const events: SettledEvent[] = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, x]) => ({ id: date, at: date, result: null, value: String(x.value), title: x.titles.join(" · "), sourceUrl: x.url, method: x.method, ...(x.games?.length ? { proof: gameTimesProof(x.games) } : {}) } as SettledEvent));
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
  // THE NEXT READ: the next meeting's due time; after the last meeting, the later of the two seasons' last listed games (the series ends
  // with both seasons, and its season-end reading is read then)
  const next: number | null = undated > 0 || refusals.length > 0 ? null : dueAt ?? lastListedDue([...mine, ...theirs], now) ?? now + SCHEDULE_RECHECK_MS;
  return { events, awaitingFinal: awaiting, refusals: [...refusals, ...stuck], settlementSourceUrl: null, window, ...(next !== null ? { dueAt: next } : {}) };
}
