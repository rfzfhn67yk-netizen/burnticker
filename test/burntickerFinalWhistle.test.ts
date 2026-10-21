// THE FINAL WHISTLE (owner, 2026-10-20 18:25 Denver: "coins should burn right after the final whistle and wait for a second verification
// 5 min later"). Until then no game was read before its start plus six hours (SETTLE_AFTER_START_MS). Now:
//   - a game the schedule marks final is read at once; while it is played the schedule is looked at every GAME_LIVE_POLL_MS from
//     GAME_FIRST_LOOK_MS after the start (gameDueAt);
//   - a game coin burns only once one source has shown the same final on two reads at least GAME_CONFIRM_GAP_MS (5 minutes) apart, even
//     when two sources agree on the first read (gameSchedule);
//   - a team, season or rivalry coin's game settles only on a second agreeing read at least 5 minutes after the first (finalCheck), its
//     first read kept in the status table so a keeper restart never settles on one read;
//   - a changed final, a disagreement, or a source that had a final and then says "not final" starts the count again; a game the schedule
//     still shows live, or a source that still shows overtime, never settles; a postponed game is unchanged.
// The SEA at DEN fixture of 2026-10-15 (the game-clock suite's). No network.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { EspnClient as SportsClient, LIVE_MARK_MS, LIVE_READS_PER_DAY, gameSeries, parseEspnSeries, teamSeries, type EspnClient, type EspnSeries, type Game } from "@/lib/burnticker/sources/espn";
import {
  FINAL_CHECK_STATUS_KEY, LIVE_FREE_POLL_MS, GAME_CONFIRM_GAP_MS, GAME_FIRST_LOOK_MS, GAME_LIVE_POLL_MS, GAME_TWICE_WORDS, GAME_TWO_SOURCE_WORDS, STALE_GAME_MS, finalCheck, gameDueAt,
  memoryFinalCheckStore, memoryFirstReadStore, settleGame, settledWords, sportsSettled, statusFinalCheckStore, statusFirstReadStore,
  type FinalCheckStore, type FirstReadStore, type GameDeps, type GameMarket, type GameVerdict,
} from "@/lib/burnticker/sources/gameSettle";
import { GAME_CONFIRM_GAP_MINUTES } from "@/lib/burnticker/singleSource";

const FIX = JSON.parse(fs.readFileSync(new URL("./fixtures/burnticker-gameclock/sea-den-2026-10-15.json", import.meta.url), "utf8")) as { game: Game; tsdbRow: Record<string, string>; market: GameMarket; payout: { outcome: number } };
const G = FIX.game;
const MIN = 60_000, H = 3_600_000;
const START = Date.parse(G.startsAt);
/** The final whistle: about three hours after kickoff, well inside the old six-hour wait. */
const T = START + 3 * H + 10 * MIN;
const GAP = GAME_CONFIRM_GAP_MS;
const DEN_GAME = parseEspnSeries(gameSeries("nfl", G.eventId, "DEN", "win")) as EspnSeries;
const DEN_TEAM = parseEspnSeries(teamSeries("nfl", "DEN", "win")) as EspnSeries;

/** What the sources say right now. `status` is TheSportsDB's strStatus ("FT" final; "OT", "Q4" not final). */
interface World { status: string; score: { home: number; away: number }; paid: boolean; market: boolean; schedule: Partial<Game> }
const world = (o: Partial<World> = {}): World => ({ status: "FT", score: { home: 17, away: 14 }, paid: false, market: false, schedule: {}, ...o });
function client(w: World, tsdbReads: { n: number } = { n: 0 }): EspnClient {
  return {
    tsdbRead: async (_k: string, url: string) => { tsdbReads.n++; return url.includes(`/day/${G.date}`) ? { events: [{ ...FIX.tsdbRow, strStatus: w.status, intHomeScore: String(w.score.home), intAwayScore: String(w.score.away) }] } : { events: [] }; },
    get: async () => { throw new Error("HTTP 404"); },
    season: async () => [{ ...G, ...w.schedule }],
  } as unknown as EspnClient;
}
function deps(w: World, now: number, o: { firstReads?: FirstReadStore; finalChecks?: FinalCheckStore; fresh?: boolean[]; notes?: string[] } = {}): GameDeps {
  return {
    tsdbKey: "test-key", apiSportsKey: null, now: () => now, firstReads: o.firstReads ?? null, finalChecks: o.finalChecks ?? null,
    market: async () => (w.market ? FIX.market : null),
    payout: async (_id, q) => { o.fresh?.push(!!q?.fresh); return w.paid ? { resolved: true, outcome: FIX.payout.outcome } : { resolved: false, outcome: null }; },
    onFinalCheck: (e) => { o.notes?.push(e.why); },
  };
}
const gameCoin = (w: World, store: FirstReadStore, t: number): Promise<GameVerdict> => settleGame(client(w), G, deps(w, t, { firstReads: store }), { schedule: "game" });
const teamGame = (w: World, store: FinalCheckStore, t: number, o: { fresh?: boolean[]; notes?: string[] } = {}): Promise<GameVerdict> => settleGame(client(w), G, deps(w, t, { finalChecks: store, ...o }));
const statusTable = () => { const m = new Map<string, string>(); return { m, getStatus: (k: string) => m.get(k) ?? null, setStatus: (k: string, v: unknown) => { m.set(k, typeof v === "string" ? v : JSON.stringify(v)); } }; };

describe("when a game is read (no six-hour wait)", () => {
  test("five minutes, one constant: the copy's minutes match the keeper's gap", () => {
    assert.equal(GAP, 5 * MIN);
    assert.equal(GAME_CONFIRM_GAP_MINUTES * MIN, GAP);
  });

  test("not final yet: the first look 90 minutes after the start, then every few minutes, hourly once the listing is a day old", () => {
    assert.equal(gameDueAt(G, START - 2 * H), START + GAME_FIRST_LOOK_MS, "before the start: no read until the game can be over");
    assert.equal(gameDueAt(G, START + 2 * H), START + 2 * H + GAME_LIVE_POLL_MS, "being played: every live poll");
    assert.equal(gameDueAt(G, START + STALE_GAME_MS + H), START + STALE_GAME_MS + 2 * H, "a stale listing: hourly");
  });

  test("a final listed three hours after kickoff is read at once, and its second read is due five minutes later", async () => {
    const store = memoryFirstReadStore(), reads = { n: 0 };
    const r = await sportsSettled(client(world(), reads), DEN_GAME, null, deps(world(), T, { firstReads: store }), { nowMs: T });
    assert.ok(reads.n > 0, "TheSportsDB was read: the final is not held back six hours");
    assert.deepEqual([r.events.length, r.awaitingFinal, r.dueAt], [0, 1, T + GAP]);
    const r2 = await sportsSettled(client(world()), DEN_GAME, null, deps(world(), T + GAP, { firstReads: store }), { nowMs: T + GAP });
    assert.deepEqual(r2.events.map((e) => [e.id, e.value]), [[G.date, "1"]], "the agreeing second read five minutes later burns it");
  });

  test("the schedule still shows the game live: nothing is settled and no settlement source is read; the next look is one live poll ahead", async () => {
    const reads = { n: 0 }, t = START + 3 * H, w = world({ schedule: { completed: false, state: "in", detail: "4th quarter" } });
    const r = await sportsSettled(client(w, reads), DEN_GAME, null, deps(w, t, { firstReads: memoryFirstReadStore() }), { nowMs: t });
    assert.deepEqual([r.events.length, reads.n, r.dueAt], [0, 0, t + GAME_LIVE_POLL_MS]);
  });

  test("a final listed before the game can be over (inside 90 minutes of the start) is a wrong listing: not read, the day held, looked at again then", async () => {
    const reads = { n: 0 }, t = START + 30 * MIN;
    const r = await sportsSettled(client(world(), reads), DEN_GAME, null, deps(world(), t, { firstReads: memoryFirstReadStore() }), { nowMs: t });
    assert.deepEqual([r.events.length, r.awaitingFinal, reads.n, r.dueAt], [0, 1, 0, START + GAME_FIRST_LOOK_MS]);
  });

  test("a doubleheader: the first game final while the second is still played holds the day", async () => {
    const g2: Game = { ...G, eventId: "2475454", startsAt: new Date(START + 4 * H).toISOString(), completed: false, state: "in", detail: "2nd quarter" };
    const c = { ...client(world()), season: async () => [G, g2] } as unknown as EspnClient;
    const r = await sportsSettled(c, DEN_TEAM, null, deps(world({ market: true, paid: true }), START + 5 * H), { nowMs: START + 5 * H });
    assert.deepEqual(r.events, [], "no reading of the day until both games are final");
  });

  test("a postponed game is unchanged: never read, counts for neither side, asks for no read of its own", async () => {
    const reads = { n: 0 }, t = START + 3 * H, w = world({ schedule: { completed: false, state: "post", detail: "Postponed" } });
    const r = await sportsSettled(client(w, reads), DEN_GAME, null, deps(w, t, { firstReads: memoryFirstReadStore() }), { nowMs: t });
    assert.deepEqual([r.events.length, r.awaitingFinal, reads.n], [0, 0, 0]);
  });
});

describe("a game coin: a final seen at T settles on an agreeing read at T + 5 minutes or later", () => {
  test("one source: a read at T + 4 minutes does not settle; the read at T + 5 minutes does", async () => {
    const store = memoryFirstReadStore();
    const a = await gameCoin(world(), store, T);
    assert.equal(a.kind, "awaiting");
    assert.equal(a.kind === "awaiting" && a.dueAt, T + GAP, "the second read is due five minutes after the first");
    assert.match(a.kind === "awaiting" ? a.why : "", /at least five minutes later/);
    assert.equal((await gameCoin(world(), store, T + 4 * MIN)).kind, "awaiting", "four minutes is not enough");
    const c = await gameCoin(world(), store, T + GAP);
    assert.equal(c.kind, "settled");
    assert.deepEqual(c.kind === "settled" && [c.winner, c.final, c.twice ?? false], ["home", { home: 17, away: 14 }, true]);
  });

  test("two sources agreeing on the first read no longer burn at once: they wait for the second read too", async () => {
    const store = memoryFirstReadStore(), w = world({ market: true, paid: true });
    const a = await gameCoin(w, store, T);
    assert.equal(a.kind, "awaiting", "two sources agree at T, but nothing burns on one read");
    const b = await gameCoin(w, store, T + GAP);
    assert.equal(b.kind, "settled");
    if (b.kind === "settled") { assert.equal(b.twoSources, true); assert.match(settledWords(b), new RegExp(GAME_TWO_SOURCE_WORDS)); }
  });

  test("a disagreeing second read resets the count; two agreeing reads five minutes apart on the new final settle it", async () => {
    const store = memoryFirstReadStore();
    await gameCoin(world(), store, T);
    const changed = await gameCoin(world({ score: { home: 17, away: 21 } }), store, T + GAP);
    assert.equal(changed.kind, "awaiting");
    assert.match(changed.kind === "awaiting" ? changed.why : "", /the final changed from 14–17 \(away–home\) to 21–17/);
    assert.equal((await gameCoin(world({ score: { home: 17, away: 21 } }), store, T + GAP + 4 * MIN)).kind, "awaiting", "the count started again at the change");
    const v = await gameCoin(world({ score: { home: 17, away: 21 } }), store, T + 2 * GAP);
    assert.deepEqual(v.kind === "settled" && [v.winner, v.final], ["away", { home: 17, away: 21 }]);
    if (v.kind === "settled") assert.match(settledWords(v), new RegExp(GAME_TWICE_WORDS));
  });

  test("overtime: a source that keeps showing the game not final never settles it", async () => {
    const store = memoryFirstReadStore();
    for (let t = T; t <= T + 60 * MIN; t += GAP) assert.equal((await gameCoin(world({ status: "OT" }), store, t)).kind, "awaiting");
  });

  test("a final that turns back into a live game (an early final, then overtime) starts the count again", async () => {
    const store = memoryFirstReadStore();
    await gameCoin(world(), store, T);
    const ot = await gameCoin(world({ status: "OT" }), store, T + GAP);
    assert.equal(ot.kind, "awaiting", "the second read says not final: no burn");
    assert.match(ot.kind === "awaiting" ? ot.why : "", /now says it is not final/);
    // final again with the same score: a fresh first read, so another five minutes
    assert.equal((await gameCoin(world(), store, T + GAP + MIN)).kind, "awaiting");
    assert.equal((await gameCoin(world(), store, T + GAP + 5 * MIN)).kind, "awaiting", "five minutes from the final's return, not from the first final");
    assert.equal((await gameCoin(world(), store, T + GAP + MIN + GAP)).kind, "settled");
  });

  test("a keeper restart between the two reads never settles on one read: the first read is kept in the status table", async () => {
    const table = statusTable();
    await gameCoin(world(), statusFirstReadStore(table), T);
    // the keeper restarts: a new store over the same status table
    assert.equal((await gameCoin(world(), statusFirstReadStore(table), T + MIN)).kind, "awaiting", "after the restart, one more read a minute later is not the second read");
    assert.equal((await gameCoin(world(), statusFirstReadStore(table), T + GAP)).kind, "settled", "the read five minutes after the kept first read settles it");
    // without the kept record, the first read after a restart is a first read again
    assert.equal((await gameCoin(world(), memoryFirstReadStore(), T + GAP)).kind, "awaiting");
  });
});

describe("a team, season or rivalry coin's game: the final check", () => {
  const W = () => world({ market: true, paid: true });

  test("two operators agree at T: awaiting, a read at T + 4 minutes does not settle, the read at T + 5 minutes reads fresh and settles", async () => {
    const store = memoryFinalCheckStore(), fresh: boolean[] = [];
    const a = await teamGame(W(), store, T, { fresh });
    assert.deepEqual(a.kind === "awaiting" && [a.kind, a.dueAt], ["awaiting", T + GAP]);
    assert.equal((await teamGame(W(), store, T + 4 * MIN)).kind, "awaiting");
    fresh.length = 0;
    const c = await teamGame(W(), store, T + GAP, { fresh });
    assert.deepEqual(c.kind === "settled" && [c.winner, c.final], ["home", { home: 17, away: 14 }]);
    assert.deepEqual(fresh, [true], "the confirming read goes to the source again, never to a cache");
  });

  test("a changed final between the two reads starts the count again and is logged", async () => {
    const store = memoryFinalCheckStore(), notes: string[] = [];
    await teamGame(W(), store, T);
    // the payout says home, so the changed score must keep the home side winning for the two operators to agree
    const w2 = { ...W(), score: { home: 24, away: 14 } };
    const b = await teamGame(w2, store, T + GAP, { notes });
    assert.equal(b.kind, "awaiting");
    assert.match(notes.join(" "), /the final changed from 14–17 \(away–home\) to 14–24/);
    assert.equal((await teamGame(w2, store, T + GAP + 4 * MIN)).kind, "awaiting");
    assert.equal((await teamGame(w2, store, T + 2 * GAP)).kind, "settled");
  });

  test("a disagreement drops the first read (logged); after it clears, two fresh reads five minutes apart are needed", async () => {
    const store = memoryFinalCheckStore(), notes: string[] = [];
    await teamGame(W(), store, T);
    const held = await teamGame({ ...W(), score: { home: 14, away: 17 } }, store, T + GAP, { notes });
    assert.equal(held.kind, "held", "the payout says Denver, TheSportsDB now says Seattle");
    assert.match(notes.join(" "), /no longer stands/);
    assert.equal(store.marks.size, 0);
    assert.equal((await teamGame(W(), store, T + GAP + MIN)).kind, "awaiting", "agreeing again is a first read");
    assert.equal((await teamGame(W(), store, T + 2 * GAP + MIN)).kind, "settled");
  });

  test("a source that had a final and now says not final (overtime) drops the first read; overtime never settles", async () => {
    const store = memoryFinalCheckStore(), notes: string[] = [];
    await teamGame(W(), store, T);
    for (let t = T + GAP; t <= T + 30 * MIN; t += GAP) assert.equal((await teamGame({ ...W(), status: "OT" }, store, t, { notes })).kind, "awaiting");
    assert.match(notes[0] ?? "", /TheSportsDB now says the game is not final/);
    assert.equal((await teamGame(W(), store, T + 31 * MIN)).kind, "awaiting", "final again: a first read");
    assert.equal((await teamGame(W(), store, T + 36 * MIN)).kind, "settled");
  });

  test("a keeper restart keeps the first read (statusFinalCheckStore); a restart never settles on one read", async () => {
    const table = statusTable();
    await teamGame(W(), statusFinalCheckStore(table, () => T), T);
    assert.ok(table.m.get(FINAL_CHECK_STATUS_KEY)?.includes(`"at":${T}`), "the first read is in the status table");
    assert.equal((await teamGame(W(), statusFinalCheckStore(table, () => T + MIN), T + MIN)).kind, "awaiting");
    assert.equal((await teamGame(W(), statusFinalCheckStore(table, () => T + GAP), T + GAP)).kind, "settled");
    assert.equal((await teamGame(W(), memoryFinalCheckStore(), T + GAP)).kind, "awaiting", "a store that kept nothing: one read is never enough");
  });

  test("a season-wins coin's day reading waits for the second read; the read five minutes later writes it", async () => {
    const store = memoryFinalCheckStore(), w = W();
    const a = await sportsSettled(client(w), DEN_TEAM, null, deps(w, T, { finalChecks: store }), { nowMs: T });
    assert.deepEqual([a.events.length, a.awaitingFinal, a.dueAt], [0, 1, T + GAP]);
    const b = await sportsSettled(client(w), DEN_TEAM, null, deps(w, T + GAP, { finalChecks: store }), { nowMs: T + GAP });
    assert.deepEqual(b.events.map((e) => [e.id, e.value]), [[G.date, "1"]]);
  });

  test("a game settled on TheSportsDB alone after its 12-hour hold is not held a further five minutes", () => {
    const store = memoryFinalCheckStore();
    const v: GameVerdict = { kind: "settled", winner: "home", final: { home: 17, away: 14 }, settledOn: "TheSportsDB", confirmedBy: "", ops: ["TheSportsDB"], detail: "", url: "", singleSince: T - 12 * H };
    assert.equal(finalCheck(store, G, v, { notFinal: [], fetchedAt: [T] }, T).kind, "settled");
  });

  test("without a final-check store (the site's display, a back-test) nothing changes: two agreeing operators settle on the read", async () => {
    const v = await settleGame(client(W()), G, deps(W(), T));
    assert.equal(v.kind, "settled");
  });
});

// THE LIVE SCHEDULE READ (coordinator for the owner, 2026-10-20: a final seen within about two minutes of the whistle). While the keeper
// tracks a game being played in a league whose schedule is a FREE OFFICIAL feed (MLB, NHL), that league's DAY LISTING (one URL per
// league) is read with a one-minute cache and laid over the team's season file, and the game is looked at every minute. Season files,
// TheSportsDB and API-Sports keep their caches, spacing and budgets; the extra reads stop when no tracked game is in play and are capped
// per league per day.
describe("the live schedule read", () => {
  const PK = 778899, MLB_START = Date.parse("2026-07-04T23:10:00Z");
  const mlbBody = (state: "Live" | "Final" | "Preview", detailed = state === "Live" ? "In Progress" : state === "Final" ? "Final" : "Scheduled") => ({ dates: [{ games: [{
    gamePk: PK, gameDate: new Date(MLB_START).toISOString(), gameType: "R", season: "2026", status: { abstractGameState: state, detailedState: detailed },
    teams: { home: { team: { name: "Los Angeles Dodgers" }, score: state === "Final" ? 5 : 3, isWinner: state === "Final" }, away: { team: { name: "San Diego Padres" }, score: 2, isWinner: false } } }] }] });
  /** The season file (teamId=…) is the slow, cached view; the day listing (startDate=…) is the current one. */
  function mlbWorld() {
    const clock = { now: MLB_START }, state = { day: mlbBody("Live") as unknown, season: mlbBody("Live") as unknown }, calls = { season: 0, day: 0, tsdb: 0 };
    const fetchImpl = (async (url: string) => {
      if (url.includes("statsapi.mlb.com") && url.includes("startDate=")) { calls.day++; return { ok: true, status: 200, json: async () => state.day }; }
      if (url.includes("statsapi.mlb.com")) { calls.season++; return { ok: true, status: 200, json: async () => state.season }; }
      if (url.includes("thesportsdb.com")) { calls.tsdb++; return { ok: true, status: 200, json: async () => ({ events: [] }) }; }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as never;
    const c = new SportsClient({ fetchImpl, now: () => clock.now, minIntervalMs: 0, tsdbKey: null, apiSportsKey: null });
    return { clock, state, calls, c };
  }
  const LAD = parseEspnSeries(gameSeries("mlb", String(PK), "LAD", "win")) as EspnSeries;
  const SD = parseEspnSeries(gameSeries("mlb", String(PK), "SD", "win")) as EspnSeries;
  const mlbDeps = (now: number, liveSchedule: boolean): GameDeps => ({ tsdbKey: null, apiSportsKey: null, market: null, payout: null, now: () => now, firstReads: memoryFirstReadStore(), liveSchedule });

  test("only MLB and NHL can be marked live; TheSportsDB keeps its cache; the mark lapses on its own", async () => {
    const { clock, calls, c } = mlbWorld();
    c.markLive("mlb"); c.markLive("nfl"); c.markLive("nba");
    assert.deepEqual([c.isLive("mlb"), c.isLive("nfl"), c.isLive("nba")], [true, false, false], "leagues on TheSportsDB are never marked");
    const tsdb = "https://www.thesportsdb.com/api/v2/json/schedule/league/4424/2026";
    await c.get(tsdb, {}, { league: "mlb" }); clock.now += 2 * MIN; await c.get(tsdb, {}, { league: "mlb" });
    assert.equal(calls.tsdb, 1, "TheSportsDB keeps its own cache even while the league is live");
    clock.now += LIVE_MARK_MS;
    assert.equal(c.isLive("mlb"), false, "no game marked it again: the short reads end");
  });

  test("the keeper's next look at a game being played: every minute on MLB and NHL, five minutes otherwise", () => {
    const t = MLB_START + 2 * H, startsAt = new Date(MLB_START).toISOString();
    assert.equal(gameDueAt({ startsAt, league: "mlb" }, t, true), t + LIVE_FREE_POLL_MS);
    assert.equal(gameDueAt({ startsAt, league: "nhl" }, t, true), t + LIVE_FREE_POLL_MS);
    assert.equal(gameDueAt({ startsAt, league: "nfl" }, t, true), t + GAME_LIVE_POLL_MS, "TheSportsDB's schedule keeps its spacing");
    assert.equal(gameDueAt({ startsAt, league: "mlb" }, t), t + GAME_LIVE_POLL_MS, "not the keeper: unchanged");
  });

  test("a tracked game marks its league live only while it is played past its first look; postponed, before the first look or the site: never", async () => {
    const a = mlbWorld(); a.clock.now = MLB_START + 30 * MIN;
    await sportsSettled(a.c, LAD, null, mlbDeps(a.clock.now, true), { nowMs: a.clock.now });
    assert.equal(a.c.isLive("mlb"), false, "before the first look");
    a.clock.now = MLB_START + 2 * H;
    const r = await sportsSettled(a.c, LAD, null, mlbDeps(a.clock.now, true), { nowMs: a.clock.now });
    assert.equal(a.c.isLive("mlb"), true); assert.equal(r.dueAt, a.clock.now + LIVE_FREE_POLL_MS);
    const b = mlbWorld(); b.clock.now = MLB_START + 2 * H;
    await sportsSettled(b.c, LAD, null, mlbDeps(b.clock.now, false), { nowMs: b.clock.now });
    assert.equal(b.c.isLive("mlb"), false, "the site and back-tests never set liveSchedule");
    const p = mlbWorld(); p.state.season = mlbBody("Preview", "Postponed"); p.clock.now = MLB_START + 2 * H;
    await sportsSettled(p.c, LAD, null, mlbDeps(p.clock.now, true), { nowMs: p.clock.now });
    assert.equal(p.c.isLive("mlb"), false, "a postponed game");
  });

  test("an hour of a live game, both teams' coins looked at every minute: about 60 day-listing reads for the league, season files unchanged, the final seen within two minutes", async () => {
    const hour = async (liveSchedule: boolean, whistle: number | null = null) => {
      const w = mlbWorld(); let seen: number | null = null;
      for (let t = MLB_START + GAME_FIRST_LOOK_MS; t < MLB_START + GAME_FIRST_LOOK_MS + H; t += MIN) {
        w.clock.now = t;
        if (whistle !== null && t >= whistle) w.state.day = w.state.season = mlbBody("Final");
        for (const s of [LAD, SD]) {
          const r = await sportsSettled(w.c, s, null, mlbDeps(t, liveSchedule), { nowMs: t });
          if (seen === null && r.refusals.length) seen = t;   // listed final: settlement starts (no settlement source here, so refused)
        }
      }
      return { ...w.calls, seen, live: w.c.takeLiveReads() };
    };
    const off = await hour(false, null), on = await hour(true, null);
    assert.equal(off.day, 0, "without the keeper's flag no day listing is read");
    assert.ok(on.day >= 55 && on.day <= 60, `${on.day} day-listing reads in the hour, shared by both coins`);
    assert.equal(on.season, off.season, "the season files keep their ten-minute cache");
    assert.deepEqual(on.live, { mlb: on.day }, "every live read is counted for the keeper's log");
    const whistle = MLB_START + GAME_FIRST_LOOK_MS + 30 * MIN + 20_000;
    // the season file is stale for up to ten minutes; the day listing shows the final
    const w2 = mlbWorld(); let seen: number | null = null;
    for (let t = MLB_START + GAME_FIRST_LOOK_MS; t < MLB_START + GAME_FIRST_LOOK_MS + H && seen === null; t += MIN) {
      w2.clock.now = t;
      if (t >= whistle) w2.state.day = mlbBody("Final");   // the season file lags: it still says Live
      const r = await sportsSettled(w2.c, LAD, null, mlbDeps(t, true), { nowMs: t });
      if (r.refusals.length) seen = t;
    }
    assert.ok(seen !== null && seen - whistle <= 2 * MIN, `seen ${seen === null ? "never" : (seen - whistle) / 1000 + " s"} after the whistle`);
  });

  test("the day cap: after LIVE_READS_PER_DAY live reads for a league in a UTC day, the season file's ordinary cache applies again", async () => {
    const w = mlbWorld(); w.clock.now = MLB_START + 2 * H;
    for (let i = 0; i < LIVE_READS_PER_DAY + 20; i++) { w.c.markLive("mlb"); await w.c.season("mlb", "LAD"); w.clock.now += MIN; if (new Date(w.clock.now).toISOString().slice(0, 10) !== new Date(MLB_START + 2 * H).toISOString().slice(0, 10)) break; }
    assert.ok(w.calls.day <= LIVE_READS_PER_DAY, String(w.calls.day));
    assert.ok(w.c.liveReadsToday("mlb") <= LIVE_READS_PER_DAY);
  });
});
