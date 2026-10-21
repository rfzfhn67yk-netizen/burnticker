// A LONG GAME AT THE LAUNCH (2026-10-21, Codex BT-LAUNCH-CUT-LONG-01). The launch-day cut took a game as over 4 h (NBA, NHL, soccer) or
// 5 h (MLB, NFL) after its start whenever a launch came that late, even when the game was still being played at the launch and its final
// was first read after it (extra innings, double overtime). The contract is "a game in progress at the launch counts", but a later first
// read of the final alone cannot show that (a coin launched after an unwatched game ended would count it). The evidence is now a keeper
// read that saw the game NOT final at or after the launch (lastSeenLiveAt, the listing's own fetch time). No network.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { countsAfterLaunch, gameCountsAfterLaunch, gameTimesOf, gameTimesProof, type GameTime } from "@/lib/burnticker/launchCut";
import { dedupeListings, EspnClient, mlbTeamScheduleUrl, type EspnClient as Client, type EspnSeries, type Game, type GameSide } from "@/lib/burnticker/sources/espn";
import { LIVE_SEEN_STATUS_KEY, memoryFinalCheckStore, memoryLiveSeenStore, noteLiveSightings, sportsSettled, statusLiveSeenStore } from "@/lib/burnticker/sources/gameSettle";
import { ESPN_TABLE, exactFetch } from "./burntickerFirstPartyHelpers.ts";

const H = 3_600_000, MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString();
const reading = (g: GameTime) => ({ at: "2026-10-20", proof: gameTimesProof([g]) });
const START = "2026-10-20T17:00:00Z";

describe("a game still being played at a launch past the usual length", () => {
  test("Codex case MLB: start 17:00, seen live after a 22:30 launch, first final 23:00 → counts", () => {
    const g: GameTime = { id: "isolated-game", league: "mlb", start: START, final: "2026-10-20T23:00:00Z", lastSeenLiveAt: "2026-10-20T22:59:00Z" };
    assert.equal(countsAfterLaunch(reading(g), "2026-10-20T22:30:00Z", true), true);
  });
  test("Codex case NBA: start 17:00, seen live after a 21:30 launch, first final 22:00 → counts", () => {
    const g: GameTime = { id: "isolated-game", league: "nba", start: START, final: "2026-10-20T22:00:00Z", lastSeenLiveAt: "2026-10-20T21:31:00Z" };
    assert.equal(countsAfterLaunch(reading(g), "2026-10-20T21:30:00Z", true), true);
  });
  test("seen live exactly at the launch counts; seen live only before the launch does not", () => {
    const g = (seen: string): GameTime => ({ id: "1", league: "mlb", start: START, final: "2026-10-20T23:00:00Z", lastSeenLiveAt: seen });
    assert.equal(countsAfterLaunch(reading(g("2026-10-20T22:30:00Z")), "2026-10-20T22:30:00Z", true), true);
    assert.equal(countsAfterLaunch(reading(g("2026-10-20T22:29:00Z")), "2026-10-20T22:30:00Z", true), false);
  });
});

describe("a game over before the launch never counts", () => {
  test("the pre-launch-final sibling: final first read before the launch → rejected, whatever the sighting", () => {
    const launch = "2026-10-20T22:30:00Z";
    for (const seen of [undefined, "2026-10-20T21:50:00Z", "2026-10-20T22:45:00Z"]) {
      const g: GameTime = { id: "1", league: "mlb", start: START, final: "2026-10-20T22:00:00Z", ...(seen ? { lastSeenLiveAt: seen } : {}) };
      assert.equal(countsAfterLaunch(reading(g), launch, true), false, String(seen));
    }
    // inside the bound too
    assert.equal(countsAfterLaunch(reading({ id: "1", league: "mlb", start: START, final: "2026-10-20T18:00:00Z" }), "2026-10-20T19:00:00Z", true), false);
  });
  test("launch past the bound, final first read after the launch, no read saw the game live at or after it → rejected", () => {
    // a coin launched after an unwatched game ended, before any keeper read of its final
    assert.equal(countsAfterLaunch(reading({ id: "1", league: "mlb", start: START, final: "2026-10-20T23:00:00Z" }), "2026-10-20T22:30:00Z", true), false);
    assert.equal(countsAfterLaunch(reading({ id: "1", league: "nba", start: START, final: "2026-10-20T22:00:00Z", lastSeenLiveAt: "2026-10-20T20:30:00Z" }), "2026-10-20T21:30:00Z", true), false);
    assert.equal(countsAfterLaunch(reading({ id: "1", league: "nba", start: START, final: null }), "2026-10-20T21:30:00Z", true), false);
  });
  test("a reading stored before the sighting was recorded keeps the rule it had (the Codex inputs as written)", () => {
    for (const [league, launch, final] of [["mlb", "2026-10-20T22:30:00Z", "2026-10-20T23:00:00Z"], ["nba", "2026-10-20T21:30:00Z", "2026-10-20T22:00:00Z"]]) {
      assert.equal(countsAfterLaunch(reading({ id: "isolated-game", league, start: START, final }), launch, true), false, league);
    }
  });
});

describe("a game of the usual length is judged as before", () => {
  test("launched during the game inside the bound → counts with or without a sighting; final before → rejected", () => {
    const launch = Date.parse("2026-10-20T19:00:00Z");
    assert.equal(gameCountsAfterLaunch({ id: "1", league: "mlb", start: START, final: "2026-10-20T20:00:00Z" }, launch), true);
    assert.equal(gameCountsAfterLaunch({ id: "1", league: "mlb", start: START, final: "2026-10-20T20:00:00Z", lastSeenLiveAt: "2026-10-20T19:55:00Z" }, launch), true);
    assert.equal(gameCountsAfterLaunch({ id: "1", league: "mlb", start: START, final: "2026-10-20T20:00:00Z", lastSeenLiveAt: "2026-10-20T18:00:00Z" }, launch), true);
    assert.equal(gameCountsAfterLaunch({ id: "1", league: "mlb", start: START, final: "2026-10-20T18:50:00Z" }, launch), false);
  });
  test("a doubleheader day: game 1 over before the launch drops the day even if game 2 was seen live", () => {
    const proof = gameTimesProof([{ id: "1", league: "mlb", start: START, final: "2026-10-20T19:30:00Z" }, { id: "2", league: "mlb", start: "2026-10-20T21:00:00Z", final: "2026-10-21T00:30:00Z", lastSeenLiveAt: "2026-10-21T00:20:00Z" }]);
    assert.equal(countsAfterLaunch({ at: "2026-10-20", proof }, "2026-10-20T22:00:00Z", true), false);
  });
});

describe("the keeper records the sighting at the listing's fetch time", () => {
  const LAD: GameSide = { abbr: "LAD", name: "Los Angeles Dodgers", nickname: "Dodgers", short: "Dodgers", location: "Los Angeles", score: null, homeAway: "home", record: null };
  const SD: GameSide = { abbr: "SD", name: "San Diego Padres", nickname: "Padres", short: "Padres", location: "San Diego", score: null, homeAway: "away", record: null };
  const at = "2026-07-04T17:05:00Z", start = Date.parse(at);
  const live: Game = { eventId: "1", league: "mlb", seasonType: 2, seasonYear: 2026, startsAt: at, date: "2026-07-04", name: "Padres at Dodgers", completed: false, state: "in", detail: "Bottom 12th", home: { ...LAD, score: 4 }, away: { ...SD, score: 4 } };
  const final: Game = { ...live, completed: true, state: "post", detail: "Final/13", home: { ...LAD, score: 5 }, away: { ...SD, score: 4 } };
  const mlb = { "https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-07-04": { dates: [{ games: [{ gameDate: at, status: { abstractGameState: "Final" }, teams: { home: { team: { name: "Los Angeles Dodgers" }, score: 5 }, away: { team: { name: "San Diego Padres" }, score: 4 } } }] }] } };
  const tsdb = { events: [{ idEvent: "x", dateEvent: "2026-07-04", strTimestamp: at.slice(0, 19), strEvent: "Los Angeles Dodgers vs San Diego Padres", strHomeTeam: "Los Angeles Dodgers", strAwayTeam: "San Diego Padres", idLeague: "4424", strStatus: "FT", intHomeScore: "5", intAwayScore: "4" }] };
  const WINS: EspnSeries = { kind: "team", league: "mlb", abbr: "LAD", teamId: null, outcome: "win", window: { kind: "season", year: 2026 } };
  // a fake client whose listing is `row`, fetched at `listedAt` (a cached listing is older than the keeper's clock)
  const fake = (state: { row: Game; listedAt: number | null }) => {
    const stamps = new WeakMap<Game, number>();
    return { season: async () => { const rows = dedupeListings([{ ...state.row }]); if (state.listedAt !== null) for (const r of rows) stamps.set(r, state.listedAt); return rows; }, listedAt: (g: Game) => stamps.get(g) ?? null, get: async (url: string) => { if (url in mlb) return (mlb as Record<string, unknown>)[url]; throw new Error(`HTTP 404 for ${url}`); }, tsdbRead: async () => tsdb } as unknown as Client;
  };

  test("seen live after a launch 5 h 30 in, settled later: the reading carries the sighting and counts for that launch", async () => {
    const launch = start + 5 * H + 30 * MIN;
    const liveSeen = memoryLiveSeenStore(), finalChecks = memoryFinalCheckStore();
    const state = { row: live, listedAt: launch + 10 * MIN as number | null };
    const client = fake(state);
    const deps = (now: number) => ({ tsdbKey: "k", apiSportsKey: null, market: null, payout: null, finalChecks, liveSeen, now: () => now });
    // a read while the 12th inning is played: its listing was fetched 2 minutes before the keeper's clock (cached)
    assert.deepEqual((await sportsSettled(client, WINS, null, deps(launch + 12 * MIN), { nowMs: launch + 12 * MIN })).events, []);
    assert.equal(liveSeen.marks.get("mlb:1"), launch + 10 * MIN, "the listing's fetch time, not the keeper's clock");
    // an older cached listing never moves the sighting back
    state.listedAt = launch - 30 * MIN;
    await sportsSettled(client, WINS, null, deps(launch + 13 * MIN), { nowMs: launch + 13 * MIN });
    assert.equal(liveSeen.marks.get("mlb:1"), launch + 10 * MIN);
    // the final, read twice five minutes apart
    state.row = final; state.listedAt = launch + 30 * MIN;
    const firstRead = launch + 30 * MIN;
    assert.deepEqual((await sportsSettled(client, WINS, null, deps(firstRead), { nowMs: firstRead })).events, []);
    const r = await sportsSettled(client, WINS, null, deps(firstRead + 6 * MIN), { nowMs: firstRead + 6 * MIN });
    assert.deepEqual(r.events.map((e) => [e.id, e.value]), [["2026-07-04", "1"]]);
    assert.deepEqual(gameTimesOf(r.events[0].proof), [{ id: "1", league: "mlb", start: at, final: iso(firstRead), lastSeenLiveAt: iso(launch + 10 * MIN) }]);
    assert.equal(countsAfterLaunch(r.events[0], iso(launch), true), true, "in progress at the launch");
    assert.equal(countsAfterLaunch(r.events[0], iso(launch + 15 * MIN), true), false, "launched after the last live sighting, past the bound: over");
  });

  test("a listing with no fetch time, or a game not started, records nothing", () => {
    const liveSeen = memoryLiveSeenStore();
    const pre: Game = { ...live, state: "pre", detail: "Scheduled" };
    const stamps = new WeakMap<Game, number>([[pre, start - H]]);
    noteLiveSightings({ listedAt: (g: Game) => stamps.get(g) ?? null } as unknown as Client, { liveSeen }, [pre, { ...live }]);
    noteLiveSightings({} as Client, { liveSeen }, [live]);
    assert.equal(liveSeen.marks.size, 0);
    noteLiveSightings({ listedAt: () => start + H } as unknown as Client, { liveSeen }, [final, { ...live, detail: "Suspended" }]);
    assert.equal(liveSeen.marks.size, 0, "a final or a suspended game is not a live sighting");
  });

  test("the persistent store keeps sightings in the status table and drops ones older than 60 days", () => {
    const status = new Map<string, string>();
    const reg = { getStatus: (k: string) => status.get(k) ?? null, setStatus: (k: string, v: unknown) => { status.set(k, JSON.stringify(v)); } };
    let now = Date.parse("2026-10-20T00:00:00Z");
    const store = statusLiveSeenStore(reg, () => now);
    store.set("mlb:old", now - 61 * 86_400_000);
    store.set("mlb:1", now);
    assert.equal(store.get("mlb:1"), now);
    assert.equal(store.get("mlb:old"), null);
    assert.deepEqual(Object.keys(JSON.parse(status.get(LIVE_SEEN_STATUS_KEY)!)), ["mlb:1"]);
  });
});

describe("EspnClient stamps each season row with its listing's fetch time", () => {
  test("a fresh read stamps the fetch time; a cached repeat keeps it; a read past the cache stamps the new time", async () => {
    let now = Date.parse("2026-10-10T20:00:00Z");
    const c = new EspnClient({ fetchImpl: exactFetch({ [mlbTeamScheduleUrl("TB", 2026)]: ESPN_TABLE[mlbTeamScheduleUrl("TB", 2026)] }), now: () => now, minIntervalMs: 0, tsdbKey: null, ttlMs: 10 * MIN });
    const t0 = now;
    const a = await c.season("mlb", "TB", 2026);
    assert.ok(a.length > 0);
    assert.ok(a.every((g) => c.listedAt(g) === t0));
    now += 5 * MIN;
    const b = await c.season("mlb", "TB", 2026);
    assert.ok(b.every((g) => c.listedAt(g) === t0), "a cached listing is as old as its fetch");
    now += 10 * MIN;
    const d = await c.season("mlb", "TB", 2026);
    assert.ok(d.every((g) => c.listedAt(g) === now));
  });
});
