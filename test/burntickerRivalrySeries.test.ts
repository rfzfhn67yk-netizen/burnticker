// THE RIVALRY SERIES (owner, 2026-10-12: "sixers vs celtics as a pair ... burn schedule based on their head-to-head games ... resolves at the
// end of the season with leftover fees burning the season series winner ... should extrapolate to other sports"). Items 1 and 2 of
// RIVALRY-SERIES-BRIEF: the `meetings` window (series ids, the mirror, the signed readings, the window over both schedules) and the pair
// through the keeper on the fake program: one PairResult per meeting, the loser's share forwarded, and the season-end result that the
// program's pair-winner end sink reads (a level series ends void). Schedules are the league's own feed (NBA cdn, synthetic); nothing reads
// ESPN and nothing touches the network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { asMeetings, isMeetingsSeriesId, meetingOutcome, meetingsMirror, meetingsSeries, parseEspnSeries, seriesEndDay, tallyMeetings, windowPhrase, espnSeriesTitle, isLeague, LEAGUES, teamsOf, type LeagueId } from "@/lib/burnticker/sources/espn";
import { meetingsSettled } from "@/lib/burnticker/sources/gameSettle";
import { runCycle } from "@/lib/burnticker/multiKeeper";
import { formatDate } from "@/lib/burnReceipts/math";
import { MEETINGS_SERIES_RE } from "@/lib/burnticker/rules";
import { AFTER, END_DAY, FILLER, SERIES, fakeDeps, game, rivalWorld, scheduleClient, type G, type RivalWorld } from "./burntickerRivalrySeriesHelpers.ts";

const d8 = (iso: string) => Number(iso.replace(/-/g, ""));
/** 3–1 to PHI: two regular-season wins, a loss, and a postseason win. */
const THREE_ONE: G[] = [
  game("2025-11-01T23:00:00Z", "PHI", "BOS", 110, 100), game("2025-12-01T23:00:00Z", "BOS", "PHI", 105, 99),
  game("2026-01-10T23:00:00Z", "PHI", "BOS", 101, 98), game("2026-04-25T23:00:00Z", "BOS", "PHI", 90, 96, { post: true }),
];
/** 2–2: a level series. */
const TWO_TWO: G[] = [
  game("2025-11-02T23:00:00Z", "PHI", "BOS", 110, 100), game("2025-12-02T23:00:00Z", "BOS", "PHI", 105, 99),
  game("2026-01-11T23:00:00Z", "PHI", "BOS", 101, 98), game("2026-02-11T23:00:00Z", "BOS", "PHI", 120, 100),
];

describe("item 1: the meetings window", () => {
  test("a series id per side, pinned by both team ids; the mirror; outcome `win` only; never one team against itself", () => {
    assert.equal(SERIES.a, "espn.team:nba-PHI.20-win-m2026.BOS.2");
    assert.equal(SERIES.b, "espn.team:nba-BOS.2-win-m2026.PHI.20");
    assert.equal(meetingsMirror(SERIES.a), SERIES.b); assert.equal(meetingsMirror(SERIES.b), SERIES.a);
    const e = asMeetings(parseEspnSeries(SERIES.a))!;
    assert.deepEqual(e.window, { kind: "meetings", year: 2026, opp: "BOS", oppId: "2" });
    assert.ok(isMeetingsSeriesId(SERIES.a) && MEETINGS_SERIES_RE.test(SERIES.a) && MEETINGS_SERIES_RE.test(SERIES.b));
    assert.equal(parseEspnSeries("espn.team:nba-PHI.20-loss-m2026.BOS.2"), null, "loss is not a meetings outcome (the reading is signed)");
    assert.equal(parseEspnSeries("espn.team:nba-PHI.20-win-m2026.PHI.20"), null);
    assert.throws(() => meetingsSeries("nba", "PHI", "PHI", 2026));
    assert.equal(meetingsMirror("espn.team:nba-PHI.20-win-s2026"), null);
    assert.ok(!MEETINGS_SERIES_RE.test("espn.team:nba-PHI.20-win-s2026"));
    assert.match(windowPhrase("nba", e.window), /^every game against Boston Celtics in the 2025–26 season, playoffs included$/);
    assert.match(espnSeriesTitle(e), /Philadelphia 76ers against Boston Celtics, head to head/);
  });
  test("generic: every league with two teams gets a pair of ids that parse back to each other (no league-specific code)", () => {
    for (const lg of Object.keys(LEAGUES).filter(isLeague) as LeagueId[]) {
      const ts = teamsOf(lg).filter((t) => t.id || true);
      let made = 0;
      for (let i = 0; i + 1 < ts.length && made < 1; i++) {
        let a: string; try { a = meetingsSeries(lg, ts[i].abbr, ts[i + 1].abbr, 2026); } catch { continue; }
        assert.equal(meetingsMirror(meetingsMirror(a)!), a, lg);
        assert.ok(MEETINGS_SERIES_RE.test(a), `${lg}: ${a}`);
        made++;
      }
      assert.equal(made, 1, `${lg} makes a meetings pair`);
    }
  });
  test("one meeting from each side: win / loss / draw / void / pending; the tally and who leads; the end day is after both seasons", () => {
    const g = (o: Partial<{ hs: number; as: number; completed: boolean; state: string; detail: string }>) => ({ eventId: "1", league: "nba" as const, startsAt: "2026-01-01T00:00:00Z", date: "2026-01-01", name: "x", completed: o.completed ?? true, state: o.state ?? "post", detail: o.detail ?? "Final", home: { abbr: "PHI", name: "", nickname: "", score: o.hs ?? 0, homeAway: "home" as const, record: null }, away: { abbr: "BOS", name: "", nickname: "", score: o.as ?? 0, homeAway: "away" as const, record: null } });
    assert.equal(meetingOutcome(g({ hs: 2, as: 1 }), "PHI"), "win"); assert.equal(meetingOutcome(g({ hs: 2, as: 1 }), "BOS"), "loss");
    assert.equal(meetingOutcome(g({ hs: 1, as: 1 }), "PHI"), "draw");
    assert.equal(meetingOutcome(g({ completed: false, state: "pre", detail: "Cancelled" }), "PHI"), "void");
    assert.equal(meetingOutcome(g({ completed: false, state: "pre", detail: "7:00 pm" }), "PHI"), "pending");
    assert.deepEqual(tallyMeetings(["win", "loss", "win", "draw", "void"]), { wins: 2, losses: 1, draws: 1, voids: 1, leader: "team" });
    assert.equal(tallyMeetings(["win", "loss"]).leader, "level");
    assert.equal(seriesEndDay("2026-05-20T23:00:00Z"), "2026-05-21");
  });
});

describe("item 1: the signed readings and the window over both schedules (meetingsSettled)", () => {
  const read = async (games: G[], series = SERIES.a, now = AFTER) => { const all = [...games, ...FILLER]; return meetingsSettled(scheduleClient(all, () => now), asMeetings(parseEspnSeries(series))!, fakeDeps(all), now); };
  test("3–1: +1 / −1 per meeting day from each side, postseason included; the window ends after BOTH seasons; one season-end reading", async () => {
    const a = await read(THREE_ONE), b = await read(THREE_ONE, SERIES.b);
    assert.deepEqual(a.events.map((e) => [e.id, e.value]), [["2025-11-01", "1"], ["2025-12-01", "-1"], ["2026-01-10", "1"], ["2026-04-25", "1"], [END_DAY, "1"]]);
    assert.deepEqual(b.events.map((e) => [e.id, e.value]), [["2025-11-01", "-1"], ["2025-12-01", "1"], ["2026-01-10", "-1"], ["2026-04-25", "-1"], [END_DAY, "-1"]]);
    assert.equal(a.window!.ended, true);
    assert.match(a.window!.endsAt!, /^2026-05-20/, "the later season (BOS, through its playoffs)");
    assert.deepEqual((a.window as { series?: unknown }).series, { wins: 3, losses: 1, draws: 0, voids: 0, leader: "team", endDay: END_DAY });
    assert.match(a.window!.reason, /^the season series is over: Philadelphia 76ers 3, Boston Celtics 1$/);
    assert.match(a.events.at(-1)!.title!, /won 3, Boston Celtics won 1/);
  });
  test("before the later season is over the window stays open and no season-end reading is written", async () => {
    const a = await read(THREE_ONE, SERIES.a, Date.parse("2026-05-01T00:00:00Z"));
    assert.equal(a.window!.ended, false);
    assert.ok(!a.events.some((e) => e.id === END_DAY));
  });
  test("2–2: a level series writes no season-end reading and ends void", async () => {
    const a = await read(TWO_TWO);
    assert.equal(a.events.length, 4);
    assert.equal(a.window!.ended, true);
    assert.match(a.window!.reason, /^void: /);
  });
  test("a draw (a level final) counts for neither side; a cancelled meeting counts for neither and holds nothing", async () => {
    const games = [...THREE_ONE.slice(0, 3), game("2026-02-20T23:00:00Z", "PHI", "BOS", 100, 100), game("2026-03-01T23:00:00Z", "BOS", "PHI", null, null, { status: 1, text: "Cancelled" })];
    const a = await read(games);
    assert.deepEqual(a.events.map((e) => [e.id, e.value]), [["2025-11-01", "1"], ["2025-12-01", "-1"], ["2026-01-10", "1"], ["2026-02-20", "0"], [END_DAY, "1"]]);
    assert.deepEqual((a.window as { series?: unknown }).series, { wins: 2, losses: 1, draws: 1, voids: 1, leader: "team", endDay: END_DAY });
  });
  test("a meeting with no settled result holds the end (the window does not end until every meeting is settled)", async () => {
    const all = [...THREE_ONE, ...FILLER];
    const deps = { ...fakeDeps(all), payout: async () => ({ resolved: false, outcome: null }) };
    const r = await meetingsSettled(scheduleClient(all, () => AFTER), asMeetings(parseEspnSeries(SERIES.a))!, deps, AFTER);
    assert.equal(r.window!.ended, false);
    assert.match(r.window!.reason, /no settled result yet/);
    assert.equal(r.events.length, 0);
  });
});

describe("item 2: the pair through the keeper (winner takes the burn, per meeting and at season end)", () => {
  async function play(w: RivalWorld, cycles = 4): Promise<void> {
    for (let i = 0; i < cycles; i++) { await runCycle(w.deps); w.clock.now += 2 * 3600_000; }
  }
  const results = (w: RivalWorld) => w.program.pairForward.port(w.a.mint, w.b.mint).results;
  test("3–1: one PairResult per meeting naming the meeting's winner, the loser's share forwarded each time; at the season's end the series winner's result, the loser's leftover forwarded to it, the winner burns down on itself", async () => {
    const w = await rivalWorld(THREE_ONE);
    await play(w);
    const R = results(w);
    const winner = (iso: string) => R.get(d8(iso))?.winner ?? "none";
    assert.equal(winner("2025-11-01"), w.a.mint); assert.equal(winner("2025-12-01"), w.b.mint);
    assert.equal(winner("2026-01-10"), w.a.mint); assert.equal(winner("2026-04-25"), w.a.mint, "a postseason meeting counts");
    assert.equal(winner(END_DAY), w.a.mint, "the season-end result names the series winner");
    // the losers' readings were forwarded, never burned on the losing coin
    const fw = w.registry.pairForwards(w.pairId);
    assert.deepEqual(fw.map((f) => [formatDate(f.recordDate), f.loserMint === w.a.mint ? "A" : "B"]).sort(), [["2025-11-01", "B"], ["2025-12-01", "A"], ["2026-01-10", "B"], ["2026-04-25", "B"], [END_DAY, "B"]].sort());
    // the loser's end: RESOLVED, dated the season-end reading, its leftover forwarded to $PHIVBOS; it retires
    const re = await w.program.endSink.port(w.b.mint).ruleEnd();
    assert.deepEqual({ outcome: re?.outcome, recordDate: re?.recordDate }, { outcome: "resolved", recordDate: d8(END_DAY) });
    const rec = JSON.parse(w.registry.getStatus(`rule.endfwd.${w.b.mint}`)!);
    assert.equal(rec.to, w.a.mint);
    assert.equal(w.registry.token(w.b.mint)!.status, "retired");
    // the winner records no end (it stays live for the forward) and winds down on its own coin
    assert.equal(await w.program.endSink.port(w.a.mint).ruleEnd(), null);
    assert.ok(w.registry.receipts(w.a.mint).some((r) => r.kind === "winddown"));
  });
  test("2–2: per-meeting forwards happen, there is no season-end result, and each coin ends void and winds down on its own pool", async () => {
    const w = await rivalWorld(TWO_TWO);
    await play(w);
    const won = [...results(w).values()].filter((r) => r.winner !== null).map((r) => r.recordDate).sort();
    assert.deepEqual(won, [20251102, 20251202, 20260111, 20260211], "a winner only for the four meetings (wind-down days are draws: nothing moves)");
    assert.equal(results(w).get(d8(END_DAY))?.winner ?? null, null, "no season-end winner");
    for (const m of [w.a.mint, w.b.mint]) {
      const re = await w.program.endSink.port(m).ruleEnd();
      assert.equal(re?.outcome, "void", "a level series is a void end");
      assert.ok(w.registry.receipts(m).some((r) => r.kind === "winddown"), "each coin burns down on itself");
      assert.equal(w.registry.getStatus(`rule.endfwd.${m}`), null, "nothing goes to the other coin or to $DEFICIT");
    }
  });
  test("a draw inside the series moves nothing for that game; a cancelled meeting is not a result", async () => {
    const games = [...THREE_ONE.slice(0, 3), game("2026-02-20T23:00:00Z", "PHI", "BOS", 100, 100), game("2026-03-01T23:00:00Z", "BOS", "PHI", null, null, { status: 1, text: "Cancelled" })];
    const w = await rivalWorld(games);
    await play(w);
    const R = results(w);
    assert.ok(!R.has(20260301), "the cancelled meeting has no result");
    assert.ok(!w.registry.pairForwards(w.pairId).some((f) => f.recordDate === 20260220 || f.recordDate === 20260301), "no forward for the draw or the cancelled game");
    assert.equal(R.get(d8(END_DAY))?.winner, w.a.mint, "2–1 with a draw: PHI's coin takes the season-end result");
  });
});
