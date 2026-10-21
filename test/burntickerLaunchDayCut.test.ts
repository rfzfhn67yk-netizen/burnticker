// THE LAUNCH-DAY CUT (2026-10-20, devnet keeper on publish 108): the 76ers–Knicks final was read for both sides (readings keyed by the
// game's UTC day "2026-10-20"), but nothing burned: Registry.readings compares settled_at > baselineAt as TEXT, and "2026-10-20" sorts
// before a coin's "2026-10-20T23:58:15.000Z". Every game coin launched on its game's UTC day could never burn. launchCut.ts now judges
// a sports day reading by calendar day and by its games' times. These tests pin the cases the fix names. No network.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openRegistry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { planToken, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { countsAfterLaunch, gameOverBoundMs, gameTimesOf, gameTimesProof, readingsAfterLaunch } from "@/lib/burnticker/launchCut";
import { oneShotDecided } from "@/lib/burnticker/readPlan";
import { dedupeListings, gameSeries, teamSeries, type EspnClient, type EspnSeries, type Game, type GameSide } from "@/lib/burnticker/sources/espn";
import { memoryFinalCheckStore, sportsSettled } from "@/lib/burnticker/sources/gameSettle";
import { BURNTICKER_RULES_SCHEMA } from "@/lib/burnticker/rules";
import { CREATOR } from "./burntickerApiHelpers.ts";

const ATTESTER = "KeeperDataKey1111111111111111111111111111111";
const H = 3_600_000;
const TIP = "2026-10-20T23:00:00.000Z";                 // 76ers at Knicks, 23:00Z on 2026-10-20
const LAUNCH = "2026-10-20T23:58:15.000Z";              // NYKLOSS-style launch 58 minutes after tip-off
const FINAL_READ = Date.parse("2026-10-21T02:46:48Z");  // when the keeper read the final
const gameRule = (series: string, fraction = 1) => ({ schema: BURNTICKER_RULES_SCHEMA, oracle: "catalogue", series, market: null, filter: {}, kind: "scalar", scalar: { unit: 1, perUnit: { fractionOfPool: fraction }, baseline: 0, direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null });
const NYK_LOSS = gameSeries("nba", "401810001", "NY", "loss");
const day = (value: string, proof?: string) => ({ id: "2026-10-20", at: "2026-10-20", result: null, value, title: "PHI @ NY final", sourceUrl: "https://x.test", ...(proof ? { proof } : {}) });
const games = (final: string | null, start = TIP) => gameTimesProof([{ id: "401810001", start, final }]);

async function live(reg: ReturnType<typeof openRegistry>, ticker: string, baselineAt: string, series: string, fraction = 1) {
  const program = new FakeBurnProgram("devnet");
  const created = Date.parse(baselineAt);
  const b = await buildLaunchBundle({ creator: CREATOR, ticker, name: `${ticker} coin`, description: "a test", imageUrl: null, links: [], rule: gameRule(series, fraction), firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const t = reg.register({ mint: b.mint, ticker, name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt, status: "draft" }, created);
  reg.markLaunched(t.mint, `launch${ticker}`, null, baselineAt);
  return reg.token(t.mint)!;
}
const deps = (reg: ReturnType<typeof openRegistry>, now: number): KeeperDeps => ({ registry: reg, program: new FakeBurnProgram("devnet"), oracles: {}, attester: ATTESTER, log: () => {}, now: () => now, dryRun: false } as unknown as KeeperDeps);
const plan = (reg: ReturnType<typeof openRegistry>, t: NonNullable<ReturnType<ReturnType<typeof openRegistry>["token"]>>, now = FINAL_READ + H) => planToken(deps(reg, now), t, reg.lockedRule(t)).map((r) => r.eventId);
const put = (reg: ReturnType<typeof openRegistry>, key: string, events: ReturnType<typeof day>[], fetchedAt: number) => reg.putReadings("catalogue", key, events, { settlementSourceUrl: null, attestedBy: [ATTESTER] }, fetchedAt);

describe("the launch-day cut (game readings keyed by UTC day)", () => {
  test("a coin launched at 23:58Z on game day, the game final and read that night: its day reading is planned (it burns)", async () => {
    const reg = openRegistry(":memory:");
    const t = await live(reg, "NYKLOSS", LAUNCH, NYK_LOSS);
    put(reg, t.selectorKey, [day("1", games(new Date(FINAL_READ).toISOString()))], FINAL_READ);
    assert.deepEqual(plan(reg, t), ["2026-10-20"]);
    assert.equal(oneShotDecided(reg, t.selectorKey, t, reg.lockedRule(t).rule), true, "the one-shot is decided, so the selector goes idle");
  });

  test("a keeper restart onto the fix: a reading stored by 108 (no game times) counts, because it was written after the launch", async () => {
    const reg = openRegistry(":memory:");
    const t = await live(reg, "NYKLOSS", LAUNCH, NYK_LOSS);
    put(reg, t.selectorKey, [day("1")], FINAL_READ);
    assert.deepEqual(readingsAfterLaunch(reg, t.selectorKey, t.baselineAt).map((r) => r.id), ["2026-10-20"]);
    assert.deepEqual(reg.readings(t.selectorKey, t.baselineAt).map((r) => r.id), [], "the text comparison that hid it");
    assert.deepEqual(plan(reg, t), ["2026-10-20"]);
  });

  test("a coin launched the day after the game: the game's reading never counts", async () => {
    const reg = openRegistry(":memory:");
    const t = await live(reg, "NYKLATE", "2026-10-21T15:00:00.000Z", NYK_LOSS);
    put(reg, t.selectorKey, [day("1", games(new Date(FINAL_READ).toISOString()))], FINAL_READ);
    assert.deepEqual(plan(reg, t, Date.parse("2026-10-21T16:00:00Z")), []);
    const old = openRegistry(":memory:");
    const t2 = await live(old, "NYKLATE", "2026-10-21T15:00:00.000Z", NYK_LOSS);
    put(old, t2.selectorKey, [day("1")], FINAL_READ);
    assert.deepEqual(plan(old, t2, Date.parse("2026-10-21T16:00:00Z")), [], "a stored reading of an earlier day, no game times: never");
  });

  test("a game over before a same-day launch never counts; a game in progress at the launch counts", () => {
    const launch = Date.parse(LAUNCH);
    // final first read before the launch → over before it
    assert.equal(countsAfterLaunch({ at: "2026-10-20", proof: games("2026-10-20T23:30:00.000Z", "2026-10-20T20:00:00.000Z") }, LAUNCH, true), false);
    // kicked off more than the bound before the launch, no final time kept → treated as over
    assert.equal(countsAfterLaunch({ at: "2026-10-20", proof: games(null, new Date(launch - gameOverBoundMs(undefined) - 1).toISOString()) }, LAUNCH, true), false);
    // in progress at the launch (tip-off 58 minutes before), final later
    assert.equal(countsAfterLaunch({ at: "2026-10-20", proof: games("2026-10-21T02:40:00.000Z") }, LAUNCH, true), true);
    // a game that began on the previous UTC day and was in progress at a just-after-midnight launch
    assert.equal(countsAfterLaunch({ at: "2026-10-20", proof: games("2026-10-21T02:40:00.000Z", "2026-10-20T23:00:00.000Z") }, "2026-10-21T00:30:00.000Z", true), true);
    // a stored launch-day reading without game times, written BEFORE the launch: the result was known, never
    assert.equal(countsAfterLaunch({ at: "2026-10-20", fetchedAt: launch - 60_000 }, LAUNCH, true), false);
    // a doubleheader day with one game over before the launch: the day is not counted (its value cannot be split)
    const dh = gameTimesProof([{ id: "1", start: "2026-10-20T17:00:00.000Z", final: "2026-10-20T20:00:00.000Z" }, { id: "2", start: "2026-10-21T00:00:00.000Z", final: null }]);
    assert.equal(countsAfterLaunch({ at: "2026-10-20", proof: dh }, LAUNCH, true), false);
  });

  test("a team coin launched mid-season counts games from its launch day on, never the ones before", async () => {
    const reg = openRegistry(":memory:");
    const t = await live(reg, "NYKWINS", "2026-10-20T15:00:00.000Z", teamSeries("nba", "NY", "win"), 0.02);
    const at = (d: string, start: string) => ({ ...day("1"), id: d, at: d, proof: gameTimesProof([{ id: d, start, final: null }]) });
    put(reg, t.selectorKey, [at("2026-10-17", "2026-10-17T23:30:00.000Z"), at("2026-10-19", "2026-10-19T23:30:00.000Z"), at("2026-10-20", "2026-10-20T23:30:00.000Z"), at("2026-10-22", "2026-10-22T23:30:00.000Z")], Date.parse("2026-10-23T05:00:00Z"));
    assert.deepEqual(readingsAfterLaunch(reg, t.selectorKey, t.baselineAt).map((r) => r.id), ["2026-10-20", "2026-10-22"]);
    assert.deepEqual(plan(reg, t, Date.parse("2026-10-23T06:00:00Z")).sort(), ["2026-10-20", "2026-10-22"]);
  });

  test("a reading with a full timestamp (Polymarket, Kalshi) and every non-sports selector keep the plain comparison", () => {
    for (const sports of [true, false]) {
      assert.equal(countsAfterLaunch({ at: "2026-10-20T23:00:00.000Z" }, LAUNCH, sports), false);
      assert.equal(countsAfterLaunch({ at: "2026-10-21T02:40:00.000Z" }, LAUNCH, sports), true);
    }
    assert.equal(countsAfterLaunch({ at: "2026-10-20", fetchedAt: FINAL_READ }, LAUNCH, false), false, "a day-keyed feed reading of the launch day stays out, as before");
    assert.equal(countsAfterLaunch({ at: "2026-10-21" }, LAUNCH, false), true);
    const reg = { readings: (_k: string, s?: string | null) => [{ id: "a", at: "2026-10-20T23:00:00.000Z" }, { id: "b", at: "2026-10-21T01:00:00.000Z" }].filter((r) => !s || r.at > s) };
    assert.deepEqual(readingsAfterLaunch(reg, "polymarket:market:0xabc", LAUNCH).map((r) => r.id), ["b"]);
  });
});

// The residual (coordinator 2026-10-20): a team coin launched after a game ended, within hours of its start, must not count that game.
// Team, season and rivalry readings now carry the FINAL CHECK's first-read time of each final, and with no recorded read a game is over
// 4 h (NBA, NHL, soccer) or 5 h (MLB, NFL) after its start.
describe("a team coin launched after a game ended does not count it", () => {
  const LAD: GameSide = { abbr: "LAD", name: "Los Angeles Dodgers", nickname: "Dodgers", short: "Dodgers", location: "Los Angeles", score: null, homeAway: "home", record: null };
  const SD: GameSide = { abbr: "SD", name: "San Diego Padres", nickname: "Padres", short: "Padres", location: "San Diego", score: null, homeAway: "away", record: null };
  const at = "2026-07-04T17:05:00Z";
  const g: Game = { eventId: "1", league: "mlb", seasonType: 2, seasonYear: 2026, startsAt: at, date: "2026-07-04", name: "Padres at Dodgers", completed: true, state: "post", detail: "Final", home: { ...LAD, score: 4 }, away: { ...SD, score: 2 } };
  const mlb = { "https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-07-04": { dates: [{ games: [{ gameDate: at, status: { abstractGameState: "Final" }, teams: { home: { team: { name: "Los Angeles Dodgers" }, score: 4 }, away: { team: { name: "San Diego Padres" }, score: 2 } } }] }] } };
  const tsdb = { events: [{ idEvent: "x", dateEvent: "2026-07-04", strTimestamp: at.slice(0, 19), strEvent: "Los Angeles Dodgers vs San Diego Padres", strHomeTeam: "Los Angeles Dodgers", strAwayTeam: "San Diego Padres", idLeague: "4424", strStatus: "FT", intHomeScore: "4", intAwayScore: "2" }] };
  const client = { season: async () => dedupeListings([g]), get: async (url: string) => { if (url in mlb) return (mlb as Record<string, unknown>)[url]; throw new Error(`HTTP 404 for ${url}`); }, tsdbRead: async () => tsdb } as unknown as EspnClient;
  const WINS: EspnSeries = { kind: "team", league: "mlb", abbr: "LAD", teamId: null, outcome: "win", window: { kind: "season", year: 2026 } };

  test("the final's first read is recorded in the team reading; a coin launched after it, 3 h after the start, does not count the game", async () => {
    const store = memoryFinalCheckStore();
    const firstRead = Date.parse(at) + 2 * H + 50 * 60_000;   // final whistle about 2 h 45 after the first pitch
    const deps = (now: number) => ({ tsdbKey: "k", apiSportsKey: null, market: null, payout: null, finalChecks: store, now: () => now });
    assert.deepEqual((await sportsSettled(client, WINS, null, deps(firstRead), { nowMs: firstRead })).events, []);
    const r = await sportsSettled(client, WINS, null, deps(firstRead + 6 * 60_000), { nowMs: firstRead + 6 * 60_000 });
    assert.deepEqual(r.events.map((e) => [e.id, e.value]), [["2026-07-04", "1"]]);
    const times = gameTimesOf(r.events[0].proof);
    assert.deepEqual(times, [{ id: "1", league: "mlb", start: at, final: new Date(firstRead).toISOString() }]);
    const launchedAfter = new Date(Date.parse(at) + 3 * H).toISOString();
    assert.equal(countsAfterLaunch(r.events[0], launchedAfter, true), false, "launched after the final was read: a passed event");
    const launchedDuring = new Date(Date.parse(at) + 2 * H).toISOString();
    assert.equal(countsAfterLaunch(r.events[0], launchedDuring, true), true, "launched while the game was played: counts");
  });

  test("no read recorded the final before the launch: over 4 h after the start for the NBA, NHL and soccer, 5 h for MLB and the NFL", () => {
    const start = "2026-10-20T17:00:00.000Z", launch = new Date(Date.parse(start) + 4 * H + 30 * 60_000).toISOString();
    const one = (league: string) => ({ at: "2026-10-20", proof: gameTimesProof([{ id: "1", league, start, final: null }]) });
    for (const l of ["nba", "nhl", "eng.1", "wnba"]) assert.equal(countsAfterLaunch(one(l), launch, true), false, l);
    for (const l of ["mlb", "nfl", "cfb"]) assert.equal(countsAfterLaunch(one(l), launch, true), true, l);
    assert.equal(gameOverBoundMs("nba"), 4 * H); assert.equal(gameOverBoundMs("mlb"), 5 * H);
  });
});
