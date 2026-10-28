// THE WORLD SERIES GAME 4 CYCLES (2026-10-27 from 01:29Z: $BREWERS26/$RAYS26 in play, keeper cycles of 6.5 minutes). A rivalry pair settles
// every meeting of the season on each read, and while a meeting is in play that read comes every minute for both sides. Each confirmed
// meeting's FINAL CHECK record stayed, so every later read of it skipped the cache on every source: MLB Stats API day pages, TheSportsDB day
// listings and lookups, and the on-chain payout, twice (once per side). Now a confirmed final is kept with its verdict (CONFIRMED FINALS,
// gameSettle.ts), a fresh read is shared inside one keeper cycle, and the live day listing is read at most once a cycle (THE KEEPER'S
// CYCLE, espn.ts). How a game settles is unchanged: two agreeing reads, the second fetched at least GAME_CONFIRM_GAP_MS after the first.
// The real sports client over a fake MLB Stats API and TheSportsDB (burntickerMlbCycleReadsHelpers.ts). No network.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { sportsEndpointOf } from "@/lib/burnticker/sources/espn";
import { GAME_CONFIRM_GAP_MS, confirmedFinal, meetingsSettled } from "@/lib/burnticker/sources/gameSettle";
import { MEETINGS, mlbWorld, type MG } from "./burntickerMlbCycleReadsHelpers.ts";

const MIN = 60_000, GAP = GAME_CONFIRM_GAP_MS;
type World = ReturnType<typeof mlbWorld>;
/** One keeper cycle: the cycle mark, then both sides of the pair, `spanMs` apart (a slow cycle reads its second side later). */
async function cycle(w: World, spanMs = 0) {
  (w.client as { beginCycle?: () => void }).beginCycle?.();   // optional: the same harness measured the code before the change
  const out = [];
  for (const s of w.sides) { out.push(await meetingsSettled(w.client, s, w.deps(), w.clock.now)); w.clock.now += spanMs; }
  const reads = w.take(), payouts = { ...w.payouts }; w.payouts.all = 0; w.payouts.fresh = 0;
  return { a: out[0], b: out[1], reads, payouts };
}
const mlbTotal = (r: Record<string, number>) => Object.entries(r).filter(([k]) => k.startsWith("mlb")).reduce((n, [, v]) => n + v, 0);
const tsdbTotal = (r: Record<string, number>) => Object.entries(r).filter(([k]) => k.startsWith("tsdb")).reduce((n, [, v]) => n + v, 0);

describe("one in-play MLB game: reads per keeper cycle", () => {
  test("six confirmed meetings and Game 4 in play: one MLB live listing a cycle, no TheSportsDB, no payout (it was 22 + 44 + 12)", async () => {
    const w = mlbWorld();
    // the first cycle after the change: the six records written before it carry no verdict, so each takes one fresh read, shared by both sides
    const first = await cycle(w);
    assert.equal(first.reads["mlb schedule day"], 7, "each day page once (both sides, every game on it), not 22");
    assert.equal(first.reads["tsdb day listing"], 7); assert.equal(first.reads["tsdb event lookup"], 7);
    assert.equal(first.payouts.fresh, 6, "one confirming payout read a game, not one a side");
    for (const k of ["mlb:801", "mlb:902", "mlb:903"]) assert.ok(w.finalChecks.get(k)?.confirmed, `${k} now keeps its verdict`);
    for (let c = 1; c <= 8; c++) {
      w.clock.now += MIN;
      const r = await cycle(w);
      assert.equal(r.reads["mlb day range (live)"], 1, `cycle ${c}: the live listing is still read`);
      assert.equal(r.reads["mlb schedule day"] ?? 0, 0, `cycle ${c}: no day page`);
      assert.equal(tsdbTotal(r.reads), 0, `cycle ${c}: no TheSportsDB read`);
      assert.equal(r.payouts.all, 0, `cycle ${c}: no payout read`);
      assert.ok(mlbTotal(r.reads) <= 3, `cycle ${c}: at most 3 MLB requests (the live listing, and the two season files every 10 minutes)`);
      // the remembered verdicts give the very readings the reads gave
      assert.deepEqual(r.a.events, first.a.events); assert.deepEqual(r.b.events, first.b.events);
    }
    assert.deepEqual(first.a.events.map((e) => [e.id, e.value]), [["2026-06-09", "1"], ["2026-06-10", "0"], ["2026-10-24", "1"], ["2026-10-25", "-1"], ["2026-10-26", "-1"]]);
    assert.deepEqual(first.b.events.map((e) => [e.id, e.value]), first.a.events.map((e) => [e.id, String(-Number(e.value))]));
  });

  test("a slow cycle (6.5 minutes) reads the live listing once, not once a minute", async () => {
    const w = mlbWorld();
    await cycle(w, 3 * MIN + 15_000);
    for (let c = 0; c < 4; c++) { const r = await cycle(w, 3 * MIN + 15_000); assert.equal(r.reads["mlb day range (live)"], 1); assert.equal(r.reads["mlb schedule day"] ?? 0, 0); }
  });
});

describe("Game 4 goes final: settlement is unchanged", () => {
  test("first read, then a second fetched at least five minutes later; both sides share each read; then no more reads of it", async () => {
    const games: MG[] = MEETINGS.map((g) => ({ ...g }));
    const w = mlbWorld(games);
    await cycle(w);
    const g4 = games.find((g) => g.live)!;
    w.clock.now += 20 * MIN;          // every cache has expired
    g4.live = false; g4.hs = 3; g4.as = 1;
    const t0 = w.clock.now;
    const r0 = await cycle(w);
    assert.deepEqual(w.finalChecks.get("mlb:904") && { at: w.finalChecks.get("mlb:904")!.at, confirmed: !!w.finalChecks.get("mlb:904")!.confirmed }, { at: t0, confirmed: false }, "the first agreeing read is stored");
    assert.equal(r0.a.events.some((e) => e.id === "2026-10-27"), false, "not settled on one read");
    // inside the gap: the game waits, whatever the cycles read
    for (let t = MIN; t < GAP; t += MIN) { w.clock.now = t0 + t; const r = await cycle(w); assert.equal(r.a.events.some((e) => e.id === "2026-10-27"), false, `still waiting ${t / MIN} min after`); }
    w.clock.now = t0 + GAP;
    const r1 = await cycle(w);
    assert.equal(r1.reads["mlb schedule day"], 2, "the confirming read: Game 4's two candidate day pages, once for both sides");
    assert.equal(r1.reads["tsdb event lookup"], 1);
    assert.equal(r1.payouts.fresh, 1, "one fresh payout read for the pair");
    assert.equal(r1.a.events.find((e) => e.id === "2026-10-27")?.value, "-1", "TB won at home: −1 to the MIL side");
    assert.equal(r1.b.events.find((e) => e.id === "2026-10-27")?.value, "1", "+1 to the TB side");
    assert.ok(w.finalChecks.get("mlb:904")?.confirmed, "confirmed: its verdict is kept");
    w.clock.now += MIN;
    const r2 = await cycle(w);
    assert.equal(r2.reads["mlb schedule day"] ?? 0, 0); assert.equal(tsdbTotal(r2.reads), 0); assert.equal(r2.payouts.all, 0);
    assert.deepEqual(r2.a.events, r1.a.events);
  });
});

describe("the shared fresh read never shortens the five-minute gap", () => {
  test("a body fetched earlier in the same cycle, less than five minutes after the first read, does not confirm; the next cycle's does", async () => {
    const games: MG[] = MEETINGS.map((g) => ({ ...g }));
    const w = mlbWorld(games);
    await cycle(w);
    const g4 = games.find((g) => g.live)!;
    w.clock.now += 20 * MIN; g4.live = false; g4.hs = 3; g4.as = 1;
    const t0 = w.clock.now;
    await cycle(w);
    // a cycle that begins 4 minutes after the first read and at once fetches, fresh, every page Game 4's reads use (another coin's reads)
    w.clock.now = t0 + 4 * MIN; w.client.beginCycle();
    for (const d of ["2026-10-27", "2026-10-26"]) {
      await w.client.get(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${d}`, {}, { fresh: true });
      await w.client.get(`https://www.thesportsdb.com/api/v2/json/filter/events/day/${d}`, { "X-API-KEY": "k" }, { fresh: true });
    }
    await w.client.get("https://www.thesportsdb.com/api/v2/json/lookup/event/904", { "X-API-KEY": "k" }, { fresh: true });
    w.take();
    // the same cycle, now past the gap: the confirming read is served by that fetch, whose time is 4 minutes after the first read
    w.clock.now = t0 + GAP + 30_000;
    const mid = await meetingsSettled(w.client, w.sides[0], w.deps(), w.clock.now);
    assert.equal(mid.events.some((e) => e.id === "2026-10-27"), false, "a fetch made 4 minutes after the first read is not the second read");
    assert.equal(mlbTotal(w.take()), 0, "served by this cycle's fetches (shared), so nothing was fetched again");
    assert.equal(w.finalChecks.get("mlb:904")?.confirmed, undefined);
    w.clock.now = t0 + GAP + MIN;
    const next = await cycle(w);
    assert.equal(next.a.events.find((e) => e.id === "2026-10-27")?.value, "-1", "the next cycle fetches again and confirms");
  });
});

describe("a confirmed final whose listing changes is read again", () => {
  test("another score in the schedule: every source is read, and a changed final starts the count again", async () => {
    const games: MG[] = MEETINGS.map((g) => ({ ...g }));
    const w = mlbWorld(games);
    await cycle(w);
    w.clock.now += 20 * MIN;
    const g3 = games.find((g) => g.pk === 903)!; g3.hs = 5;   // the feed corrects TB's score in Game 3 (the schedule and every source)
    const r = await cycle(w);
    assert.ok((r.reads["mlb schedule day"] ?? 0) >= 1 && tsdbTotal(r.reads) >= 1, "Game 3 is read again");
    assert.deepEqual({ ...w.finalChecks.get("mlb:903"), confirmed: undefined, confirmedAt: undefined, startsAt: undefined }, { winner: "home", home: 5, away: 2, at: w.clock.now, confirmed: undefined, confirmedAt: undefined, startsAt: undefined });
    assert.equal(r.a.events.some((e) => e.id === "2026-10-26"), false, "the changed final waits for its own second read");
  });
  test("confirmedFinal: only a confirmed record, the same start, a final listing and the same score", () => {
    const v = { kind: "settled" as const, winner: "home" as const, final: { home: 4, away: 2 }, settledOn: "x", confirmedBy: "y", ops: [], detail: "", url: "" };
    const m = { winner: "home" as const, home: 4, away: 2, at: 1, startsAt: "2026-10-26T00:08:00Z", confirmed: v, confirmedAt: 2 };
    const g = { startsAt: "2026-10-26T00:08:00Z", completed: true, home: { score: 4 }, away: { score: 2 } } as Parameters<typeof confirmedFinal>[1];
    assert.equal(confirmedFinal(m, g), v);
    assert.equal(confirmedFinal({ ...m, confirmed: undefined }, g), null, "not confirmed yet");
    assert.equal(confirmedFinal(m, { ...g, startsAt: "2026-10-26T18:08:00Z" }), null, "moved");
    assert.equal(confirmedFinal(m, { ...g, completed: false }), null, "not final");
    assert.equal(confirmedFinal(m, { ...g, home: { ...g.home, score: 5 } }), null, "another score");
    assert.equal(confirmedFinal({ ...m, home: null, away: null }, g), null, "no score to compare");
  });
});

describe("the per-cycle count on the keeper's [live-schedule] line", () => {
  test("endpoints by shape: dates, ids, name pairs and the v1 key replaced; constant filters left out", () => {
    assert.equal(sportsEndpointOf("https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-10-26"), "v1/schedule?date");
    assert.equal(sportsEndpointOf("https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=2026-10-26&endDate=2026-10-27&gameType=R,F,D,L,W"), "v1/schedule?endDate&startDate");
    assert.equal(sportsEndpointOf("https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=2026&gameType=R,F,D,L,W&teamId=158"), "v1/schedule?season&teamId");
    assert.equal(sportsEndpointOf("https://www.thesportsdb.com/api/v2/json/filter/events/day/2026-10-26"), "v2/filter/events/day/:date");
    assert.equal(sportsEndpointOf("https://www.thesportsdb.com/api/v2/json/lookup/event/2176956"), "v2/lookup/event/:id");
    assert.equal(sportsEndpointOf("https://www.thesportsdb.com/api/v2/json/search/event/milwaukee_brewers_vs_tampa_bay_rays"), "v2/search/event/:names");
    const v1 = sportsEndpointOf("https://www.thesportsdb.com/api/v1/json/SECRETKEY123/eventsday.php?d=2026-10-26");
    assert.equal(v1, "v1/eventsday.php?d"); assert.ok(!v1.includes("SECRET"));
    assert.equal(sportsEndpointOf("https://api-web.nhle.com/v1/score/2026-10-26"), "v1/score/:date");
  });
  test("takeCycleReads: every request of the cycle by source and endpoint, largest first, then cleared", async () => {
    const w = mlbWorld();
    w.client.takeCycleReads();
    await cycle(w);
    const first = new Map(w.client.takeCycleReads());
    assert.equal(first.get("mlb-stats v1/schedule?date"), 7);
    assert.equal(first.get("thesportsdb v2/filter/events/day/:date"), 7);
    assert.equal(first.get("thesportsdb v2/lookup/event/:id"), 7);
    assert.equal(first.get("mlb-stats v1/schedule?endDate&startDate"), 1);
    w.clock.now += MIN; await cycle(w);
    assert.deepEqual(w.client.takeCycleReads(), [["mlb-stats v1/schedule?endDate&startDate", 1]]);
    assert.deepEqual(w.client.takeCycleReads(), []);
  });
});
