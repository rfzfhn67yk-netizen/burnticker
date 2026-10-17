// ONE BURN SCHEDULE FOR EVERY SINGLE-GAME COIN (owner, 2026-10-16). A game coin (series kind `game`, and both coins of two teams in one
// game) burns exactly 12 hours after its final is FIRST read by any operator (TheSportsDB, the game's on-chain settlement, a league feed,
// API-Sports). Inside the 12 hours every other source that answers must agree, or the game is held; a source that never answers does not
// delay it; the on-chain settlement confirms and never brings it forward. The first-read time is persisted in the status table
// (statusFirstReadStore, FIRST_READ_STATUS_KEY), so a keeper restart keeps the clock and a pair's two coins share it. The live case of
// 2026-10-16 (SEAWIN/DENWIN: TheSportsDB down all night, Polymarket resolved the Broncos) is replayed from a fixture. No network.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { openRegistry } from "@/lib/burnticker/registry";
import { PolymarketClient, type GammaMarket } from "@/lib/burnticker/oracle/polymarket";
import { isGameMoneyline, polyGameGate, polyGameOf } from "@/lib/burnticker/sources/polyGame";
import { settledLine, settledParts } from "@/lib/burnticker/settledTitle";
import { gamesFromTitle } from "@/lib/burnticker/leagues";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { SettledEvent } from "@/lib/burnticker/units";
import { gameSeries, parseEspnSeries, type EspnClient, type EspnSeries, type Game } from "@/lib/burnticker/sources/espn";
import { FIRST_READ_STATUS_KEY, GAME_BURN_DELAY_MS, GAME_SCHEDULE_WORDS, GAME_TWO_SOURCE_WORDS, gameKeyOf, gameSchedule, memoryFirstReadStore, releaseDispute, settleGame, settledWords, sportsSettled, statusFirstReadStore, tsdbV2DayUrl, tsdbV2EventUrl, type FirstReadStore, type GameDeps, type GameMarket, type GamePayout, type GameVerdict } from "@/lib/burnticker/sources/gameSettle";
import { isDisagreement } from "@/lib/burnticker/ops/feedHealth";
import { GAME_AGREE_LINE, GAME_BURN_LINE, sportsConfirmationLine } from "@/lib/burnticker/sources/provenance";
import { GAME_COIN_NOTE, nativeRule, nativeSourceById } from "@/lib/burnticker/sources/native";
import { coinSourceNote, sourcePublisher } from "@/lib/burnticker/coinSourceLine";
import { GAME_CROSS_WORDS, GAME_SETTLEMENT_WORDS } from "@/lib/burnticker/search";
import { TEMPLATES } from "@/lib/burnticker/templates";
import { finalAfter, statedSentences } from "@/lib/burnticker/sources/polyStated";
import { ruleFacts } from "@/lib/burnticker/coinPage";
import { describeRule } from "@/lib/burnticker/describe";
import { settlementSections } from "@/lib/burnticker/settlementCopy";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const FIX = JSON.parse(fs.readFileSync(new URL("./fixtures/burnticker-gameclock/sea-den-2026-10-15.json", import.meta.url), "utf8")) as {
  game: Game; tsdbRow: Record<string, string>; market: GameMarket; payout: { resolved: boolean; outcome: number; resolvedAt: string }; tsdbDown: { from: string; until: string }; keeperFirstCycle: string;
};
const G = FIX.game;
const H = 3_600_000;
const T0 = Date.parse("2026-10-16T08:00:00Z");
const DEN = parseEspnSeries(gameSeries("nfl", G.eventId, "DEN", "win")) as EspnSeries;
const SEA = parseEspnSeries(gameSeries("nfl", G.eventId, "SEA", "win")) as EspnSeries;

/** The world one test controls: whether TheSportsDB answers and with which score, whether the payout is in, whether the schedule answers. */
interface World { tsdb: "up" | "down"; score: { home: number; away: number }; paid: boolean; market: boolean; scheduleFollowsTsdb: boolean }
const world = (o: Partial<World> = {}): World => ({ tsdb: "up", score: { home: 17, away: 14 }, paid: false, market: true, scheduleFollowsTsdb: false, ...o });
function client(w: World): EspnClient {
  return {
    tsdbRead: async (_k: string, url: string) => {
      if (w.tsdb === "down") throw new Error("HTTP 503");
      return url.includes(`/day/${G.date}`) ? { events: [{ ...FIX.tsdbRow, intHomeScore: String(w.score.home), intAwayScore: String(w.score.away) }] } : { events: [] };
    },
    get: async () => { throw new Error("HTTP 404"); },
    // the NFL's schedule comes from TheSportsDB: when it is down the game list cannot be read either (scheduleFollowsTsdb)
    season: async () => { if (w.scheduleFollowsTsdb && w.tsdb === "down") throw new Error("HTTP 503"); return [G]; },
  } as unknown as EspnClient;
}
function deps(w: World, store: FirstReadStore, now: () => number): GameDeps {
  return {
    tsdbKey: "test-key", apiSportsKey: null, firstReads: store, now,
    market: async () => (w.market ? FIX.market : null),
    payout: async () => (w.paid ? { resolved: true, outcome: FIX.payout.outcome } : { resolved: false, outcome: null }),
  };
}
const read = (w: World, store: FirstReadStore, t: number): Promise<GameVerdict> => settleGame(client(w), G, deps(w, store, () => t), { schedule: "game" });
const statusTable = () => { const m = new Map<string, string>(); return { m, getStatus: (k: string) => m.get(k) ?? null, setStatus: (k: string, v: unknown) => { m.set(k, typeof v === "string" ? v : JSON.stringify(v)); } }; };

describe("a game coin burns 12 hours after its final is first read", () => {
  test("TheSportsDB reads it first, the on-chain settlement agrees inside the window: two sources agree, so it burns on that cycle, naming both", async () => {
    const w = world(), store = memoryFirstReadStore();
    const a = await read(w, store, T0);
    assert.equal(a.kind, "awaiting"); assert.equal(a.kind === "awaiting" ? a.dueAt : null, T0 + GAME_BURN_DELAY_MS);
    const m0 = store.get(gameKeyOf(G))!;
    assert.deepEqual({ firstReadAt: m0.firstReadAt, by: m0.by, winner: m0.winner, home: m0.home, away: m0.away, ops: m0.ops, startsAt: m0.startsAt }, { firstReadAt: T0, by: "TheSportsDB", winner: "home", home: 17, away: 14, ops: ["TheSportsDB"], startsAt: G.startsAt });
    w.paid = true;
    const v = await read(w, store, T0 + 3 * H);
    assert.equal(v.kind, "settled", "two independent sources agree: no 12-hour wait");
    if (v.kind !== "settled") return;
    assert.equal(v.winner, "home"); assert.deepEqual(v.final, { home: 17, away: 14 }); assert.equal(v.firstReadAt, T0); assert.equal(v.twoSources, true);
    assert.deepEqual(v.ops, ["TheSportsDB", "on-chain payout"]);
    assert.equal(settledWords(v), "settled on a licensed final score · confirmed by the game's on-chain settlement · burned when two sources had confirmed it");
    // through the coin's reader: one source waits; the cycle that reads the second burns
    const w1 = world(), s2 = memoryFirstReadStore();
    const first = await sportsSettled(client(w1), DEN, null, deps(w1, s2, () => T0), { nowMs: T0 });
    assert.equal(first.events.length, 0); assert.equal(first.dueAt, T0 + GAME_BURN_DELAY_MS);
    w1.paid = true;
    const due = await sportsSettled(client(w1), DEN, null, deps(w1, s2, () => T0 + H), { nowMs: T0 + H });
    assert.equal(due.events.length, 1); assert.equal(due.events[0].value, "1"); assert.match(due.events[0].method ?? "", /\+two-sources-agreed$/);
  });

  test("the on-chain settlement reads it first, TheSportsDB disagrees: held with the disagree wording, no burn, until they agree; agreement restarts the 12 hours", async () => {
    const w = world({ tsdb: "down", paid: true }), store = memoryFirstReadStore();
    assert.equal((await read(w, store, T0)).kind, "awaiting");
    assert.equal(store.get(gameKeyOf(G))?.by, "on-chain payout");
    w.tsdb = "up"; w.score = { home: 20, away: 27 };   // TheSportsDB says the Seahawks won
    const h = await read(w, store, T0 + 4 * H);
    assert.equal(h.kind, "held");
    assert.ok(h.kind === "held" && isDisagreement(h.why), "the refusal raises the feed-health disagree alert");
    assert.match(h.kind === "held" ? h.why : "", /nothing burns for this game until/);
    assert.ok(store.get(gameKeyOf(G))?.disputed?.length, "the dispute is saved on the record");
    const r = await sportsSettled(client(w), DEN, null, deps(w, store, () => T0 + 13 * H), { nowMs: T0 + 13 * H });
    assert.equal(r.events.length, 0, "past the 12 hours, a disagreement still holds the burn");
    assert.ok(r.refusals.some(isDisagreement), r.refusals.join(" | "));
    w.score = { home: 17, away: 14 };   // TheSportsDB corrects itself to the Broncos
    const again = await read(w, store, T0 + 14 * H);
    assert.equal(again.kind, "awaiting", "agreement after a dispute is a new first read");
    assert.equal(again.kind === "awaiting" ? again.dueAt : null, T0 + 14 * H + GAME_BURN_DELAY_MS);
    assert.equal(store.get(gameKeyOf(G))?.disputed, null);
    const v = await read(w, store, T0 + 26 * H);
    assert.equal(v.kind, "settled"); assert.equal(v.kind === "settled" ? v.firstReadAt : null, T0 + 14 * H);
  });

  test("a disagreement is remembered: the dissenter going quiet never releases the burn; it settles 12 hours after the dissenter agrees", async () => {
    // TheSportsDB anchors the Broncos; at +8 h the market resolves to the Seahawks; at +12 h the Polygon read fails (not resolved)
    const w = world(), store = memoryFirstReadStore();
    const SEAHAWKS = { ...FIX.market, outcomes: ["Seahawks", "Broncos"] as [string, string] };
    const dd = (t: number, m: GameMarket | null) => ({ ...deps(w, store, () => t), market: async () => m });
    assert.equal((await settleGame(client(w), G, dd(T0, FIX.market), { schedule: "game" })).kind, "awaiting");
    w.paid = true;
    const h8 = await settleGame(client(w), G, dd(T0 + 8 * H, SEAHAWKS), { schedule: "game" });
    assert.equal(h8.kind, "held");
    w.paid = false;   // the payout read fails: "not resolved yet"
    const h12 = await settleGame(client(w), G, dd(T0 + 12 * H, SEAHAWKS), { schedule: "game" });
    assert.equal(h12.kind, "held", "the quiet dissenter still holds the burn");
    const lost = await settleGame(client(w), G, dd(T0 + 13 * H, null), { schedule: "game" });
    assert.equal(lost.kind, "held", "a lost market lookup does not release it either");
    w.tsdb = "down";
    assert.equal((await settleGame(client(w), G, dd(T0 + 14 * H, null), { schedule: "game" })).kind, "held", "nor does a score source that starts throwing");
    // the payout reads again and agrees with the Broncos
    w.tsdb = "up"; w.paid = true;
    const ok = await settleGame(client(w), G, dd(T0 + 15 * H, FIX.market), { schedule: "game" });
    assert.equal(ok.kind, "awaiting"); assert.equal(ok.kind === "awaiting" ? ok.dueAt : null, T0 + 15 * H + GAME_BURN_DELAY_MS);
    assert.equal((await settleGame(client(w), G, dd(T0 + 27 * H - 1, FIX.market), { schedule: "game" })).kind, "awaiting");
    const v = await settleGame(client(w), G, dd(T0 + 27 * H, FIX.market), { schedule: "game" });
    assert.equal(v.kind, "settled"); assert.equal(v.kind === "settled" ? v.winner : null, "home");
  });

  test("a split or void payout, or the draw leg, never starts the clock alone: a tie needs a score read", async () => {
    const w = world({ tsdb: "down", paid: true }), store = memoryFirstReadStore();
    const split = (t: number) => ({ ...deps(w, store, () => t), payout: async () => ({ resolved: true, outcome: null }) });
    for (const t of [T0, T0 + 12 * H, T0 + 30 * H]) {
      const v = await settleGame(client(w), G, split(t), { schedule: "game" });
      assert.equal(v.kind, "awaiting"); assert.match(v.kind === "awaiting" ? v.why : "", /a tie needs a final score read/);
    }
    assert.equal(store.get(gameKeyOf(G)), null, "no record is created");
    // the soccer draw leg alone (a three-way market paying the draw) does not start it either
    const legs = { home: "0xh", draw: "0xd", away: "0xa" };
    const three = { ...deps(w, store, () => T0 + 30 * H), market: async () => ({ ...FIX.market, threeWay: { ...legs, homeName: "Broncos", awayName: "Seahawks" } }), payout: async (id: string) => ({ resolved: true, outcome: id === legs.draw ? 0 : 1 }) };
    const dv = await settleGame(client(w), G, three, { schedule: "game" });
    assert.equal(dv.kind, "awaiting"); assert.match(dv.kind === "awaiting" ? dv.why : "", /a tie needs a final score read/);
    assert.equal(store.get(gameKeyOf(G)), null);
    // a split payout against a score read is a disagreement in a league without draws
    w.tsdb = "up";
    assert.equal((await settleGame(client(w), G, split(T0 + 31 * H), { schedule: "game" })).kind, "held");
  });

  test("the record's key is league and event only: a start time moved after the final keeps the clock", async () => {
    const w = world(), store = memoryFirstReadStore();
    await read(w, store, T0);
    const moved = { ...G, startsAt: "2026-10-16T01:20:00Z" };
    const v = await settleGame(client(w), moved, deps(w, store, () => T0 + 12 * H), { schedule: "game" });
    assert.equal(gameKeyOf(moved), `nfl:${G.eventId}`);
    assert.equal(store.get(gameKeyOf(G))?.startsAt, G.startsAt);
    assert.equal(v.kind, "settled", "the same record, still due at T0 + 12 h");
  });

  test("only one source ever answers: the burn still falls at +12 h (TheSportsDB alone, or the on-chain settlement alone)", async () => {
    const w1 = world({ market: false }), s1 = memoryFirstReadStore();
    await read(w1, s1, T0);
    const v1 = await read(w1, s1, T0 + GAME_BURN_DELAY_MS);
    assert.equal(v1.kind, "settled");
    if (v1.kind === "settled") { assert.deepEqual(v1.ops, ["TheSportsDB"]); assert.equal(settledWords(v1), "settled on a licensed final score · no other source answered · burned 12 hours after the final was first read"); }
    const w2 = world({ tsdb: "down", paid: true }), s2 = memoryFirstReadStore();
    await read(w2, s2, T0);
    assert.equal((await read(w2, s2, T0 + GAME_BURN_DELAY_MS - 1)).kind, "awaiting");
    const v2 = await read(w2, s2, T0 + GAME_BURN_DELAY_MS);
    assert.equal(v2.kind, "settled");
    if (v2.kind === "settled") { assert.deepEqual(v2.ops, ["on-chain payout"]); assert.equal(v2.final, null); assert.match(settledWords(v2), /^settled on the game's on-chain settlement · no other source answered/); }
  });

  test("a keeper restart at +6 h keeps the first-read time (the status table is the anchor)", async () => {
    const reg = statusTable(), w = world();
    await read(w, statusFirstReadStore(reg, () => T0), T0);
    assert.ok(reg.m.get(FIRST_READ_STATUS_KEY)?.includes(gameKeyOf(G)));
    // a new process: a new store over the same table
    const after = await read(w, statusFirstReadStore(reg, () => T0 + 6 * H), T0 + 6 * H);
    assert.equal(after.kind, "awaiting"); assert.equal(after.kind === "awaiting" ? after.dueAt : null, T0 + GAME_BURN_DELAY_MS, "not 12 hours from the restart");
    assert.equal((await read(w, statusFirstReadStore(reg, () => T0 + 12 * H), T0 + 12 * H)).kind, "settled");
  });

  test("a corrected score inside the window restarts the 12 hours", async () => {
    const w = world({ market: false }), store = memoryFirstReadStore();
    await read(w, store, T0);
    w.score = { home: 20, away: 14 };
    const r = await read(w, store, T0 + 5 * H);
    assert.equal(r.kind, "awaiting"); assert.equal(r.kind === "awaiting" ? r.dueAt : null, T0 + 5 * H + GAME_BURN_DELAY_MS);
    assert.equal((await read(w, store, T0 + GAME_BURN_DELAY_MS)).kind, "awaiting");
    assert.equal((await read(w, store, T0 + 5 * H + GAME_BURN_DELAY_MS)).kind, "settled");
  });

  test("a pair's two coins share one anchor: the second coin read later still burns with the first", async () => {
    const reg = statusTable(), w = world({ market: false });   // one source, so the 12 hours run
    const at = (t: number) => deps(w, statusFirstReadStore(reg, () => t), () => t);
    await sportsSettled(client(w), DEN, null, at(T0), { nowMs: T0 });
    const sea = await sportsSettled(client(w), SEA, null, at(T0 + 5 * H), { nowMs: T0 + 5 * H });
    assert.equal(sea.events.length, 0); assert.equal(sea.dueAt, T0 + GAME_BURN_DELAY_MS, "SEAWIN's clock is DENWIN's");
    assert.equal(Object.keys(JSON.parse(reg.m.get(FIRST_READ_STATUS_KEY)!)).length, 1, "one first-read record for the game");
    const [d, s] = [await sportsSettled(client(w), DEN, null, at(T0 + 12 * H), { nowMs: T0 + 12 * H }), await sportsSettled(client(w), SEA, null, at(T0 + 12 * H), { nowMs: T0 + 12 * H })];
    assert.deepEqual([d.events.map((e) => e.value), s.events.map((e) => e.value)], [["1"], ["0"]]);
  });

  test("team coins keep their rules: the league feed agreeing still settles at once with no first-read record", async () => {
    // a season team coin reads settleGame without the game schedule: the on-chain settlement and TheSportsDB agreeing settle the game at once
    const w = world({ paid: true }), store = memoryFirstReadStore();
    const v = await settleGame(client(w), G, deps(w, store, () => T0));
    assert.equal(v.kind, "settled"); assert.equal(v.kind === "settled" ? v.firstReadAt : 0, undefined);
    assert.equal(store.get(gameKeyOf(G)), null);
  });
});

describe("two independent sources agreeing burn at once (owner, 2026-10-16, second decision)", () => {
  test("two sources agree on the first cycle: settled that cycle", async () => {
    const w = world({ paid: true }), store = memoryFirstReadStore();
    const v = await read(w, store, T0);
    assert.equal(v.kind, "settled", JSON.stringify(v));
    if (v.kind === "settled") { assert.equal(v.twoSources, true); assert.equal(v.firstReadAt, T0); assert.equal(v.winner, "home"); }
  });
  test("one source and a flaky second (its read fails or is not resolved): waits for the 12 hours", async () => {
    const w = world(), store = memoryFirstReadStore();
    const flaky = (t: number) => ({ ...deps(w, store, () => t), payout: async () => { throw new Error("Polygon RPC timeout"); } });
    assert.equal((await settleGame(client(w), G, flaky(T0), { schedule: "game" })).kind, "awaiting");
    for (const t of [T0 + H, T0 + 6 * H]) {
      const v = await settleGame(client(w), G, flaky(t), { schedule: "game" });
      assert.equal(v.kind, "awaiting", "a failed read is not a read of the final"); assert.equal(v.kind === "awaiting" ? v.dueAt : null, T0 + GAME_BURN_DELAY_MS);
    }
    assert.equal((await read(w, store, T0 + 7 * H)).kind, "awaiting", "the market not resolved yet is not a read either");
    assert.equal((await settleGame(client(w), G, flaky(T0 + GAME_BURN_DELAY_MS), { schedule: "game" })).kind, "settled");
  });
  test("two sources disagree: held, and the early path stays closed after they agree again", async () => {
    const w = world({ paid: true, score: { home: 14, away: 17 } }), store = memoryFirstReadStore();
    const h = await read(w, store, T0);
    assert.equal(h.kind, "held"); assert.ok(h.kind === "held" && isDisagreement(h.why));
    w.score = { home: 17, away: 14 };
    const again = await read(w, store, T0 + H);
    assert.equal(again.kind, "awaiting", "a game once held waits the 12 hours even with two sources agreeing");
    assert.equal((await read(w, store, T0 + 2 * H)).kind, "awaiting");
    assert.equal((await read(w, store, T0 + H + GAME_BURN_DELAY_MS)).kind, "settled");
  });
  test("the same source twice never counts as two: waits", async () => {
    const w = world({ market: false }), store = memoryFirstReadStore();
    await read(w, store, T0);
    for (const t of [T0 + H, T0 + 2 * H, T0 + 11 * H]) assert.equal((await read(w, store, t)).kind, "awaiting");
    const v = await read(w, store, T0 + GAME_BURN_DELAY_MS);
    assert.equal(v.kind === "settled" && v.twoSources, undefined);
    assert.equal(v.kind === "settled" && settledWords(v), "settled on a licensed final score · no other source answered · burned 12 hours after the final was first read");
  });
  test("a split on chain read as a tie does not count as a second source", async () => {
    const w = world({ score: { home: 17, away: 17 } }), store = memoryFirstReadStore();
    const split = (t: number) => ({ ...deps(w, store, () => t), payout: async () => ({ resolved: true, outcome: null }) });
    const v = await settleGame(client(w), G, split(T0), { schedule: "game" });
    assert.equal(v.kind, "awaiting", JSON.stringify(v));
  });
  test("an operator release or an ignored source closes the early path", async () => {
    const w = world({ tsdb: "down", paid: true }), store = memoryFirstReadStore();
    await read(w, store, T0);
    w.tsdb = "up"; w.score = { home: 14, away: 17 };
    await read(w, store, T0 + H);
    const r = releaseDispute(store.get(gameKeyOf(G))!, "away", "read by hand", T0 + 2 * H, ["on-chain payout"]);
    assert.ok(r.ok); if (!r.ok) return;
    store.set(gameKeyOf(G), r.next);
    assert.equal((await read(w, store, T0 + 3 * H)).kind, "awaiting");
  });
  test("a source revising its own final holds the early path: 23-20, then 24-20, then the league feed 24-20 is not ready; ready 12 hours after the revision", () => {
    const store = memoryFirstReadStore(), NHL = { league: "nhl" as const, eventId: "2025020001", startsAt: "2026-10-15T23:00:00Z" };
    const tsdb = (home: number, away: number) => ({ op: "TheSportsDB", winner: (home > away ? "home" : "away") as "home" | "away", final: { home, away } });
    assert.equal(gameSchedule(store, NHL, [tsdb(23, 20)], T0).kind, "awaiting");
    const rev = gameSchedule(store, NHL, [tsdb(24, 20)], T0 + H);
    assert.equal(rev.kind, "awaiting"); assert.equal(rev.kind === "awaiting" ? rev.dueAt : null, T0 + H + GAME_BURN_DELAY_MS);
    const two = gameSchedule(store, NHL, [{ op: "nhl.score", winner: "home", final: { home: 24, away: 20 } }], T0 + 2 * H);
    assert.equal(two.kind, "awaiting", "two sources agree, but a revised final waits the 12 hours");
    assert.equal(gameSchedule(store, NHL, [], T0 + H + GAME_BURN_DELAY_MS - 1).kind, "awaiting");
    const v = gameSchedule(store, NHL, [], T0 + H + GAME_BURN_DELAY_MS);
    assert.equal(v.kind, "ready"); assert.equal(v.kind === "ready" ? v.twoSources : null, undefined);
  });
  test("the three-way draw leg never counts toward the two sources: draw leg and TheSportsDB 1-1 wait; TheSportsDB and a league feed at 1-1 are ready", () => {
    const EPL = { league: "eng.1" as const, eventId: "740100", startsAt: "2026-10-10T11:30:00Z" };
    const s1 = memoryFirstReadStore();
    const a = gameSchedule(s1, EPL, [{ op: "on-chain payout", winner: "tie", final: null, ninety: true }, { op: "TheSportsDB", winner: "tie", final: { home: 1, away: 1 } }], T0);
    assert.equal(a.kind, "awaiting", JSON.stringify(a)); assert.equal(a.kind === "awaiting" ? a.dueAt : null, T0 + GAME_BURN_DELAY_MS);
    const s2 = memoryFirstReadStore();
    const b = gameSchedule(s2, EPL, [{ op: "TheSportsDB", winner: "tie", final: { home: 1, away: 1 } }, { op: "apisports.games", winner: "tie", final: { home: 1, away: 1 } }], T0);
    assert.equal(b.kind, "ready"); assert.equal(b.kind === "ready" ? b.twoSources : null, true);
    // a win leg (decided inside 90 minutes) is a final and still counts with a score read
    const s3 = memoryFirstReadStore();
    assert.equal(gameSchedule(s3, EPL, [{ op: "on-chain payout", winner: "home", final: null, ninety: true }, { op: "TheSportsDB", winner: "home", final: { home: 2, away: 1 } }], T0).kind, "ready");
    // the draw leg read again later, with no second score source: still the 12 hours
    assert.equal(gameSchedule(s1, EPL, [{ op: "on-chain payout", winner: "tie", final: null, ninety: true }], T0 + 2 * H).kind, "awaiting");
  });
  test("the two-source words and every new public sentence pass the copy lint (no promises, no arrows, no payout)", () => {
    const cfg = loadCopyLintConfig();
    const two = `SEA 14 @ DEN 17 final (DEN win) · settled on a licensed final score · confirmed by the game's on-chain settlement · ${GAME_TWO_SOURCE_WORDS} · see this game on ESPN → https://www.espn.com/nfl/scoreboard/_/date/20261016`;
    const f = { marketPollMin: 5, feedPollMin: 60, guardMinMin: 5, guardMaxMin: 20, spendCapPct: 2, umaHours: 2, deficitReads: ["16:30"], deficitZone: "America/New_York" };
    const said = [GAME_TWO_SOURCE_WORDS, GAME_SCHEDULE_WORDS, GAME_BURN_LINE, GAME_AGREE_LINE, GAME_COIN_NOTE, GAME_SETTLEMENT_WORDS, GAME_CROSS_WORDS,
      TEMPLATES.find((t) => t.id === "matchup")!.settles, settledLine(two), gamesFromTitle("nfl", "2026-10-16", two)[0].source,
      ...settlementSections(f).sections.flatMap((s) => s.paragraphs).filter((p) => /game coin/i.test(p)),
      nativeSourceById(gameSeries("nfl", G.eventId, "DEN", "win"))!.sourceName];
    for (const t of said) {
      assert.ok(lintCopy(t, cfg).ok, `${lintCopy(t, cfg).hits.map((h) => h.phrase).join(", ")}: ${t}`);
      assert.doesNotMatch(t, /\bsoon\b|\bwill\b|payout|\w\/\w/i, t);
    }
  });
  test("the title says which rule settled it, and the league page reads both forms", () => {
    const two = "SEA 14 @ DEN 17 final (DEN win) · settled on a licensed final score · confirmed by the game's on-chain settlement · burned when two sources had confirmed it · see this game on ESPN → https://www.espn.com/nfl/scoreboard/_/date/20261016";
    assert.deepEqual(settledParts(two), [{ on: "a licensed final score", confirmedBy: "the game's on-chain settlement", notes: ["burned when two sources had confirmed it"] }]);
    assert.equal(gamesFromTitle("nfl", "2026-10-16", two)[0].source, "Settled on a licensed final score and confirmed by the game's on-chain settlement; burned when two sources had confirmed it.");
    assert.equal(settledLine(two), "settled on a licensed final score · confirmed by the game's on-chain settlement · burned when two sources had confirmed it");
  });
});

describe("the live case of 2026-10-16, replayed: SEAWIN/DENWIN with TheSportsDB down all night and the Broncos' market resolved", () => {
  const downFrom = Date.parse(FIX.tsdbDown.from), downUntil = Date.parse(FIX.tsdbDown.until), paidAt = Date.parse(FIX.payout.resolvedAt);
  async function replay(scheduleFollowsTsdb: boolean) {
    const reg = statusTable(), w = world({ scheduleFollowsTsdb, score: { home: 17, away: 14 } });
    const first: Record<string, number | null> = { DEN: null, SEA: null };
    let firstRead: number | null = null;
    for (let t = Date.parse(FIX.keeperFirstCycle); t < Date.parse(FIX.keeperFirstCycle) + 48 * H; t += H) {
      w.tsdb = t >= downFrom && t < downUntil ? "down" : "up"; w.paid = t >= paidAt;
      for (const [name, s] of [["DEN", DEN], ["SEA", SEA]] as const) {
        const d = deps(w, statusFirstReadStore(reg, () => t), () => t);
        const r = await sportsSettled(client(w), s, null, d, { nowMs: t }).catch(() => null);   // the schedule unreadable: the keeper's read fails
        if (firstRead === null && reg.m.get(FIRST_READ_STATUS_KEY)) firstRead = (Object.values(JSON.parse(reg.m.get(FIRST_READ_STATUS_KEY)!))[0] as { firstReadAt: number }).firstReadAt;
        if (r?.events.length && first[name] === null) first[name] = t;
      }
    }
    return { first, firstRead, reg };
  }
  test("the schedule down with TheSportsDB: nothing is read all night; the first successful read finds both sources agreeing, so both coins burn then", async () => {
    const { first, firstRead } = await replay(true);
    const c0 = Date.parse(FIX.keeperFirstCycle), back = c0 + Math.ceil((downUntil - c0) / H) * H;   // the first hourly cycle after the outage
    assert.equal(firstRead, back, "the keeper's first successful read is its first cycle after TheSportsDB answers again");
    assert.equal(first.DEN, back, "TheSportsDB and the settled market agree on the first successful read: no 12-hour wait");
    assert.equal(first.SEA, first.DEN);
  });
  test("the schedule cached, TheSportsDB's finals down: the resolved market is the first read and waits alone; DENWIN burns when TheSportsDB answers and agrees", async () => {
    const { first, firstRead, reg } = await replay(false);
    assert.equal(firstRead, Date.parse(FIX.keeperFirstCycle), "the payout was in before the first cycle, so the first cycle reads it");
    const c0 = Date.parse(FIX.keeperFirstCycle), back = c0 + Math.ceil((downUntil - c0) / H) * H;
    assert.equal(first.DEN, back, "the first cycle after TheSportsDB is back, inside the 12 hours");
    assert.ok(first.DEN! < firstRead! + GAME_BURN_DELAY_MS);
    const mark = Object.values(JSON.parse(reg.m.get(FIRST_READ_STATUS_KEY)!))[0] as { by: string; ops: string[] };
    assert.equal(mark.by, "on-chain payout"); assert.deepEqual(mark.ops, ["on-chain payout", "TheSportsDB"], "TheSportsDB is named once it agreed");
  });
});

describe("the copy says it plainly", () => {
  test("every game-coin sentence passes the copy lint, says 'on-chain settlement' and never 'payout', and uses no arrows or slashes", () => {
    const cfg = loadCopyLintConfig();
    const rule = nativeRule(gameSeries("nfl", G.eventId, "DEN", "win"), { fractionOfPool: 1 });
    const text = describeRule(rule, { ticker: "DENWIN", game: { opponent: "Seahawks", home: true, startsAt: G.startsAt } } as never);
    const f = { marketPollMin: 5, feedPollMin: 60, guardMinMin: 5, guardMaxMin: 20, spendCapPct: 2, umaHours: 2, deficitReads: ["16:30"], deficitZone: "America/New_York" };
    const settle = settlementSections(f).sections.flatMap((s) => s.paragraphs).filter((p) => /game coin/i.test(p));
    assert.equal(settle.length, 2);
    const mine = [GAME_BURN_LINE, GAME_AGREE_LINE, GAME_COIN_NOTE, coinSourceNote("catalogue", `catalogue:${gameSeries("nfl", G.eventId, "DEN", "win")}`), ruleFacts(JSON.stringify(rule), true).window, ...settle];
    for (const t of mine) {
      assert.ok(lintCopy(t, cfg).ok, `${lintCopy(t, cfg).hits.map((h) => h.phrase).join(", ")}: ${t}`);
      assert.doesNotMatch(t, /→|\w\/\w|payout/i, t);
    }
    assert.equal(GAME_BURN_LINE, "A game coin burns once two sources agree on the final, or 12 hours after the first final if only one source answers.");
    assert.ok(text.ruleBlock.includes(GAME_BURN_LINE), text.ruleBlock);
    assert.ok(ruleFacts(JSON.stringify(rule), true).window.includes(GAME_BURN_LINE));
    assert.ok(!sportsConfirmationLine().includes(GAME_BURN_LINE), "the team-coin footer does not carry the game-coin sentence");
    // every game-coin surface says one source is enough and never promises a second confirming source
    const surfaces = [text.ruleBlock, coinSourceNote("catalogue", `catalogue:${gameSeries("nfl", G.eventId, "DEN", "win")}`), sourcePublisher("catalogue", `catalogue:${gameSeries("nfl", G.eventId, "DEN", "win")}`),
      nativeSourceById(gameSeries("nfl", G.eventId, "DEN", "win"))!.sourceName, TEMPLATES.find((t) => t.id === "matchup")!.settles, GAME_SETTLEMENT_WORDS, GAME_CROSS_WORDS];
    for (const t of surfaces) { assert.doesNotMatch(t, /second independent source|confirms it|confirmed by /i, t); assert.ok(lintCopy(t, cfg).ok, t); }
    // a one-market Polymarket coin on a game moneyline says the same schedule
    const fa = finalAfter({ sportsMarketType: "moneyline", gameStartTime: G.startsAt, outcomes: ["Seahawks", "Broncos"] });
    assert.equal(fa.game, true);
    const said = statedSentences({ phrase: null, crossRead: null }, fa);
    assert.ok(said.includes(GAME_BURN_LINE) && lintCopy(said, cfg).ok, said);
    assert.equal(finalAfter({ sportsMarketType: null, outcomes: ["Yes", "No"] }).game, undefined);
    assert.ok(lintCopy(text.ruleBlock, cfg).ok, text.ruleBlock);
  });
});

describe("a one-market Polymarket coin on a game moneyline runs on the same schedule", () => {
  const M = { ...FIX.market, sportsMarketType: "moneyline", gameStartTime: G.startsAt, eventSlug: "nfl-sea-den-2026-10-15", tags: ["nfl"], outcomes: ["Seahawks", "Broncos"] } as unknown as GammaMarket;
  const rule = { schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: FIX.market.conditionId, filter: {}, kind: "binary", binary: { onNo: { fractionOfPool: 1 } } } as unknown as BurnRule;
  const ev = (result: "yes" | "no" | "void") => ({ id: FIX.market.conditionId, at: "2026-10-16", result, value: null, title: M.question, sourceUrl: "https://polymarket.com/x", method: "ctf-payout" }) as SettledEvent;
  test("the game is found from the market (league from the slug, teams from the outcomes)", () => {
    const g = polyGameOf(M)!;
    assert.equal(g.league, "nfl"); assert.equal(g.away.abbr, "SEA"); assert.equal(g.home.abbr, "DEN");
    assert.equal(isGameMoneyline(M), true);
  });
  test("the resolved payout alone waits 12 hours from its first read; TheSportsDB agreeing releases it at once; a disagreeing score holds it", async () => {
    const w = world({ tsdb: "down" }), store = memoryFirstReadStore();
    let t = T0;
    const gate = polyGameGate({ client: () => client(w), deps: () => ({ ...deps(w, store, () => t) }) });
    const a = await gate(rule, M, ev("no"));   // NO = outcome 1 = the Broncos
    assert.equal(a.release, false); assert.equal(a.release ? null : a.dueAt, T0 + GAME_BURN_DELAY_MS);
    t = T0 + GAME_BURN_DELAY_MS - 1;
    assert.equal((await gate(rule, M, ev("no"))).release, false, "one source: the 12 hours run");
    const s1 = memoryFirstReadStore(), w1 = world({ tsdb: "down" });
    let t1 = T0;
    const gate1 = polyGameGate({ client: () => client(w1), deps: () => deps(w1, s1, () => t1) });
    assert.equal((await gate1(rule, M, ev("no"))).release, false);
    w1.tsdb = "up"; t1 = T0 + 2 * H;
    assert.equal((await gate1(rule, M, ev("no"))).release, true, "two sources agree: released on that cycle");
    const w2 = world({ score: { home: 14, away: 17 } }), s2 = memoryFirstReadStore();
    const gate2 = polyGameGate({ client: () => client(w2), deps: () => deps(w2, s2, () => T0) });
    const h = await gate2(rule, M, ev("no"));
    assert.ok(!h.release && h.held && isDisagreement(h.why), JSON.stringify(h));
  });
  test("through the adapter: the keeper's PolymarketClient withholds the event while only the market has read it, then writes it", async () => {
    const w = world({ tsdb: "down" }), store = memoryFirstReadStore();
    let t = T0;
    const pm = new PolymarketClient({ fetchImpl: (async () => ({ ok: false, status: 404, json: async () => ({}) })) as never });
    (pm as unknown as { candidates: unknown }).candidates = async () => ({ markets: [{ ...M, closed: true, closedTime: "2026-10-16T04:00:00Z", outcomeFigures: [] }], complete: true, pages: 1 });
    (pm as unknown as { readChain: unknown }).readChain = async () => ({ conditionId: FIX.market.conditionId, chainId: 137, contract: "0xctf", rpcUrl: "x", blockNumber: 1, outcomeSlotCount: 2, payoutDenominator: "1", payoutNumerators: ["0", "1"], resolved: true, payouts: ["0", "1"], outcome: 1 });
    pm.gameGate = polyGameGate({ client: () => client(w), deps: () => deps(w, store, () => t) });
    const first = await pm.settledSince(rule, null);
    assert.equal(first.events.length, 0); assert.equal(first.awaitingFinal, 1); assert.equal(first.dueAt, T0 + GAME_BURN_DELAY_MS);
    t = T0 + GAME_BURN_DELAY_MS;
    const due = await pm.settledSince(rule, null);
    assert.equal(due.events.length, 1, JSON.stringify(due.refusals)); assert.equal(due.events[0].result, "no");
  });
  test("a void payout burns nothing and is released 12 hours after it was first read; it never anchors a tie", async () => {
    const w = world({ tsdb: "down" }), store = memoryFirstReadStore();
    let t = T0;
    const gate = polyGameGate({ client: () => client(w), deps: () => deps(w, store, () => t) });
    assert.equal((await gate(rule, M, ev("void"))).release, false);
    assert.equal(store.get(gameKeyOf(polyGameOf(M)!)), null, "no game record");
    t = T0 + GAME_BURN_DELAY_MS;
    assert.equal((await gate(rule, M, ev("void"))).release, true);
  });
  test("a yes/no market (CLARITY, TWOCUTS) is not a game: unchanged", async () => {
    const gate = polyGameGate({ client: () => client(world()), deps: () => deps(world(), memoryFirstReadStore(), () => T0) });
    assert.equal((await gate(rule, { ...M, sportsMarketType: null, outcomes: ["Yes", "No"] } as unknown as GammaMarket, ev("yes"))).release, true);
  });
});

describe("the 60-day cleanup never forgets a hold", () => {
  test("a disputed, contradicted or ignoring record outlives 60 days; a plain old record is dropped", () => {
    const tbl = statusTable();
    let t = T0;
    const store = statusFirstReadStore(tbl, () => t);
    const base = { firstReadAt: T0, by: "TheSportsDB", winner: "home" as const, home: 17, away: 14, ops: ["TheSportsDB"] };
    store.set("nfl:1", base);
    store.set("nfl:2", { ...base, disputed: [{ op: "TheSportsDB", winner: "home", home: 17, away: 14, at: T0 }, { op: "on-chain payout", winner: "away", home: null, away: null, at: T0 }] });
    store.set("nfl:3", { ...base, contradiction: { op: "on-chain payout", why: "two legs", at: T0 } });
    store.set("nfl:4", { ...base, ignored: ["on-chain payout"] });
    t = T0 + 61 * 24 * H;
    store.set("nfl:5", { ...base, firstReadAt: t });
    assert.equal(store.get("nfl:1"), null, "a settled record past 60 days is dropped");
    for (const k of ["nfl:2", "nfl:3", "nfl:4", "nfl:5"]) assert.ok(store.get(k), k);
  });
  test("a game disputed for 61 days is still held, not anchored again", async () => {
    const w = world({ tsdb: "down", paid: true }), tbl = statusTable();
    const at = (t: number) => statusFirstReadStore(tbl, () => t);
    await read(w, at(T0), T0);
    w.tsdb = "up"; w.score = { home: 14, away: 17 };
    assert.equal((await read(w, at(T0 + H), T0 + H)).kind, "held");
    // another game's write 61 days later runs the cleanup
    at(T0 + 61 * 24 * H).set("nfl:other", { firstReadAt: T0 + 61 * 24 * H, by: "TheSportsDB", winner: "home", home: 1, away: 0, ops: ["TheSportsDB"] });
    w.paid = false;   // the dissenter goes quiet
    assert.equal((await read(w, at(T0 + 61 * 24 * H + H), T0 + 61 * 24 * H + H)).kind, "held");
  });
});

describe("which Polymarket markets are one game (one schedule for every game coin)", () => {
  const rule = { schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: "0xcov", filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 1 } } } as unknown as BurnRule;
  const ev = (result: "yes" | "no") => ({ id: "0xcov", at: "2026-10-12", result, value: null, title: "Will Coventry City FC win on 2026-10-12?", sourceUrl: "https://polymarket.com/x", method: "ctf-payout" }) as SettledEvent;
  // the live Gamma leg (2026-10-16)
  const COV = { conditionId: "0xcov", question: "Will Coventry City FC win on 2026-10-12?", outcomes: ["Yes", "No"], sportsMarketType: "moneyline", gameStartTime: "2026-10-12T14:00:00Z", eventSlug: "efl-cov-por-2026-10-12", tags: ["soccer"] } as unknown as GammaMarket;
  const CLARITY = { conditionId: "0xcla", question: "Clarity Act signed into law in 2026?", outcomes: ["Yes", "No"], sportsMarketType: null, eventSlug: "clarity-act", tags: ["crypto"] } as unknown as GammaMarket;
  const TWOCUTS = { conditionId: "0x2c", question: "Will 2 Fed rate cuts happen in 2026?", outcomes: ["Yes", "No"], sportsMarketType: null, eventSlug: "fed-rate-cuts-2026", tags: ["economy"] } as unknown as GammaMarket;
  test("the gate: a soccer yes/no leg, a draw leg and a moneyline with no type are games; CLARITY, TWOCUTS, spreads and totals are not", () => {
    assert.equal(isGameMoneyline(COV), true);
    assert.equal(isGameMoneyline({ ...COV, question: "Will Arsenal FC vs. Leeds United FC end in a draw?" }), true);
    assert.equal(isGameMoneyline({ sportsMarketType: null, gameStartTime: G.startsAt, outcomes: ["Seahawks", "Broncos"] }), true, "no type, a game start and two teams");
    assert.equal(isGameMoneyline(CLARITY), false);
    assert.equal(isGameMoneyline(TWOCUTS), false);
    assert.equal(isGameMoneyline({ ...TWOCUTS, sportsMarketType: "moneyline" }), false, "a yes/no question not shaped like a game leg");
    assert.equal(isGameMoneyline({ ...COV, sportsMarketType: null }), false, "a yes/no leg needs the moneyline type");
    assert.equal(isGameMoneyline({ sportsMarketType: null, gameStartTime: null, outcomes: ["Seahawks", "Broncos"] }), false, "no type and no game start");
    assert.equal(isGameMoneyline({ sportsMarketType: "spreads", gameStartTime: G.startsAt, outcomes: ["Seahawks", "Broncos"] }), false);
    assert.equal(isGameMoneyline({ sportsMarketType: "totals", gameStartTime: G.startsAt, outcomes: ["Over", "Under"] }), false);
    assert.equal(isGameMoneyline({ sportsMarketType: null, gameStartTime: G.startsAt, outcomes: ["Over", "Under"] }), false);
    assert.equal(finalAfter(COV).game, true);
    assert.equal(finalAfter(CLARITY).game, undefined);
  });
  test("a one-market coin on the Coventry leg waits 12 hours from its first read; CLARITY and TWOCUTS are released at once", async () => {
    const store = memoryFirstReadStore();
    let t = T0;
    const gate = polyGameGate({ client: () => client(world()), deps: () => deps(world(), store, () => t) });
    const a = await gate(rule, COV, ev("yes"));
    assert.equal(a.release, false, JSON.stringify(a)); assert.equal(a.release ? null : a.dueAt, T0 + GAME_BURN_DELAY_MS);
    t = T0 + GAME_BURN_DELAY_MS - 1;
    assert.equal((await gate(rule, COV, ev("yes"))).release, false);
    t = T0 + GAME_BURN_DELAY_MS;
    assert.equal((await gate(rule, COV, ev("yes"))).release, true);
    assert.equal((await gate(rule, CLARITY, ev("yes"))).release, true);
    assert.equal((await gate(rule, TWOCUTS, ev("no"))).release, true);
  });
});

describe("the title parts read back on the league page and the coin page", () => {
  const base = "SEA 14 @ DEN 17 final (DEN win)";
  const espn = "see this game on ESPN → https://www.espn.com/nfl/scoreboard/_/date/20261016";
  test("with a confirmer, with none, the old form and the one-source form", () => {
    const withC = `${base} · settled on a licensed final score · confirmed by the game's on-chain settlement · burned 12 hours after the final was first read · ${espn}`;
    const none = `${base} · settled on the game's on-chain settlement · no other source answered · burned 12 hours after the final was first read · ${espn}`;
    const old = `${base} · settled on the game's on-chain payout · confirmed by a licensed final score · ${espn}`;
    const one = `${base} · settled on a licensed final score · TheSportsDB only, confirmed after a 12 h hold · ${espn}`;
    assert.deepEqual(settledParts(withC), [{ on: "a licensed final score", confirmedBy: "the game's on-chain settlement", notes: ["burned 12 hours after the final was first read"] }]);
    assert.deepEqual(settledParts(none), [{ on: "the game's on-chain settlement", confirmedBy: null, notes: ["no other source answered", "burned 12 hours after the final was first read"] }]);
    assert.equal(gamesFromTitle("nfl", "2026-10-16", withC)[0].source, "Settled on a licensed final score and confirmed by the game's on-chain settlement; burned 12 hours after the final was first read.");
    assert.equal(gamesFromTitle("nfl", "2026-10-16", none)[0].source, "Settled on the game's on-chain settlement; no other source answered; burned 12 hours after the final was first read.");
    assert.equal(gamesFromTitle("nfl", "2026-10-16", old)[0].source, "Settled on the game's on-chain payout and confirmed by a licensed final score.");
    assert.equal(gamesFromTitle("nfl", "2026-10-16", one).length, 1);
    assert.equal(gamesFromTitle("nfl", "2026-10-16", `${withC} · ${old}`).length, 2, "two games in one day's title");
    assert.equal(settledLine(withC), "settled on a licensed final score · confirmed by the game's on-chain settlement · burned 12 hours after the final was first read");
    assert.equal(settledLine(none), "settled on the game's on-chain settlement · no other source answered · burned 12 hours after the final was first read");
  });
});

describe("the operator's release of a stuck disagreement", () => {
  test("releaseDispute: needs a note and a dispute; drops the other side's reads; restarts the 12 hours; a live dissenter disputes again", async () => {
    const w = world({ tsdb: "down", paid: true }), store = memoryFirstReadStore();
    await read(w, store, T0);
    w.tsdb = "up"; w.score = { home: 14, away: 17 };
    assert.equal((await read(w, store, T0 + 2 * H)).kind, "held");
    const m = store.get(gameKeyOf(G))!;
    assert.equal(releaseDispute(m, "away", "", T0).ok, false);
    const r = releaseDispute(m, "away", "TheSportsDB and NFL.com both show SEA 17-14", T0 + 3 * H);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.dropped, ["on-chain payout"]); assert.equal(r.next.disputed, null); assert.equal(r.next.firstReadAt, T0 + 3 * H);
    store.set(gameKeyOf(G), r.next);
    assert.equal((await read(w, store, T0 + 4 * H)).kind, "held", "the payout still reads the Broncos: disputed again");
    w.paid = false; store.set(gameKeyOf(G), r.next);
    assert.equal((await read(w, store, T0 + 15 * H)).kind, "settled", "with the payout quiet, the released result burns at release + 12 h");
  });
  test("a release that ignores the on-chain settlement: it still contradicts, the game goes on TheSportsDB and burns 12 hours after the release", async () => {
    const w = world({ tsdb: "down", paid: true }), store = memoryFirstReadStore();
    await read(w, store, T0);                                   // the settlement on chain reads the Broncos first
    w.tsdb = "up"; w.score = { home: 14, away: 17 };            // TheSportsDB reads SEA 17-14
    assert.equal((await read(w, store, T0 + 2 * H)).kind, "held");
    const m = store.get(gameKeyOf(G))!;
    assert.equal(releaseDispute(m, "away", "read by hand", T0 + 3 * H, ["ESPN"]).ok, false, "a source that never read the game cannot be ignored");
    const r = releaseDispute(m, "away", "TheSportsDB and NFL.com both show SEA 17-14; the market settled on chain and cannot change", T0 + 3 * H, ["on-chain payout"]);
    assert.ok(r.ok); if (!r.ok) return;
    assert.deepEqual(r.next.ignored, ["on-chain payout"]);
    store.set(gameKeyOf(G), r.next);
    // the settlement on chain still reads the Broncos on every cycle (w.paid stays true)
    const a = await read(w, store, T0 + 4 * H);
    assert.equal(a.kind, "awaiting", JSON.stringify(a)); assert.equal(a.kind === "awaiting" ? a.dueAt : null, T0 + 3 * H + GAME_BURN_DELAY_MS, "12 hours from the release");
    assert.equal((await read(w, store, T0 + 3 * H + GAME_BURN_DELAY_MS - 1)).kind, "awaiting");
    const v = await read(w, store, T0 + 3 * H + GAME_BURN_DELAY_MS);
    assert.equal(v.kind, "settled", JSON.stringify(v));
    if (v.kind === "settled") { assert.equal(v.winner, "away"); assert.deepEqual(v.ops, ["TheSportsDB"], "the ignored source is not named"); }
    assert.deepEqual(store.get(gameKeyOf(G))?.ignored, ["on-chain payout"], "kept on the record");
  });
  test("the script: --show lists, --release is a dry run until --apply, and a missing note is refused", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-game-hold-")), db = path.join(dir, "r.db");
    const reg = openRegistry(db);
    const m = { firstReadAt: T0, by: "on-chain payout", winner: "home", home: null, away: null, ops: ["on-chain payout"], reads: { "on-chain payout": { winner: "home", home: null, away: null, at: T0, detail: "p", url: "" }, TheSportsDB: { winner: "away", home: 14, away: 17, at: T0, detail: "t", url: "" } }, disputed: [{ op: "on-chain payout", winner: "home", home: null, away: null, at: T0 }, { op: "TheSportsDB", winner: "away", home: 14, away: 17, at: T0 }] };
    reg.setStatus(FIRST_READ_STATUS_KEY, { "nfl:2475453": m }, T0);
    reg.close?.();
    const run = (...a: string[]) => spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./test/alias-hook.mjs", "scripts/burnticker-game-hold.mts", ...a, "--db", db], { encoding: "utf8" });
    const show = run("--show");
    assert.equal(show.status, 0, show.stderr); assert.match(show.stdout, /HELD \(disagreement\)/);
    assert.equal(run("--release", "nfl:2475453", "--side", "away").status, 2, "no note");
    const dry = run("--release", "nfl:2475453", "--side", "away", "--note", "read by hand");
    assert.equal(dry.status, 0, dry.stderr); assert.match(dry.stdout, /dry run/);
    assert.ok(JSON.parse(openRegistry(db).getStatus(FIRST_READ_STATUS_KEY)!)["nfl:2475453"].disputed, "nothing written on a dry run");
    const ap = run("--release", "nfl:2475453", "--side", "away", "--note", "read by hand", "--apply");
    assert.equal(ap.status, 0, ap.stderr);
    const after = JSON.parse(openRegistry(db).getStatus(FIRST_READ_STATUS_KEY)!)["nfl:2475453"];
    assert.equal(after.disputed, null); assert.equal(after.release.note, "read by hand"); assert.deepEqual(Object.keys(after.reads), ["TheSportsDB"]);
    // --ignore is saved on the record (a second record, held the same way)
    {
      const r2 = openRegistry(db); r2.setStatus(FIRST_READ_STATUS_KEY, { ...JSON.parse(r2.getStatus(FIRST_READ_STATUS_KEY)!), "nfl:2475454": m }, T0); r2.close?.();
      assert.equal(run("--release", "nfl:2475454", "--side", "away", "--note", "read by hand", "--ignore", "nobody", "--apply").status, 1, "an unknown source is refused");
      const ig = run("--release", "nfl:2475454", "--side", "away", "--note", "read by hand", "--ignore", "on-chain payout", "--apply");
      assert.equal(ig.status, 0, ig.stderr);
      assert.deepEqual(JSON.parse(openRegistry(db).getStatus(FIRST_READ_STATUS_KEY)!)["nfl:2475454"].ignored, ["on-chain payout"]);
    }
  });
});

// ---- a contradiction is remembered (review finding A) -----------------------------------------------------------------------------
// A cup tie: the three-way settlement on chain pays a home win at 90 minutes while TheSportsDB says 1-1 after extra time, decided on
// penalties. That is held. On a later cycle one Polygon leg fails to read, so the three-way read is "awaiting", not "held": the game must
// stay held and must not settle on TheSportsDB's penalty winner 12 hours later.
const sideOf = (abbr: string, name: string, homeAway: "home" | "away", winner?: boolean) => ({ abbr, name, nickname: name, location: name, short: name, score: null, homeAway, record: null, ...(winner ? { winner } : {}) });
const CUP: Game = { eventId: "740099", league: "eng.1", startsAt: "2026-10-10T11:30:00Z", date: "2026-10-10", name: "Leeds United at Arsenal", completed: true, state: "post", detail: "FT", home: sideOf("ARS", "Arsenal", "home", true), away: sideOf("LEE", "Leeds United", "away") } as unknown as Game;
const LH = "0x" + "a".repeat(64), LD = "0x" + "b".repeat(64), LA = "0x" + "c".repeat(64);
const CUP_MARKET: GameMarket = { conditionId: LH, question: "Arsenal FC vs. Leeds United FC", outcomes: ["Yes", "No"], url: "https://polymarket.com/event/epl-ars-lee-2026-10-10", threeWay: { home: LH, draw: LD, away: LA, homeName: "Arsenal FC", awayName: "Leeds United FC" } };
const cupRow = { idEvent: "2400099", strEvent: "Arsenal vs Leeds United", strHomeTeam: "Arsenal", strAwayTeam: "Leeds United", idLeague: "4328", intHomeScore: "1", intAwayScore: "1", dateEvent: "2026-10-10", strTimestamp: "2026-10-10T11:30:00", strStatus: "PEN" };
const cupClient = (): EspnClient => {
  const answers: Record<string, unknown> = { [tsdbV2DayUrl("2026-10-10")]: { filter: [cupRow] }, [tsdbV2EventUrl("2400099")]: { lookup: [cupRow] } };
  const get = async (url: string) => { if (!(url in answers)) throw new Error(`HTTP 404 ${url}`); return answers[url]; };
  return { tsdbRead: async (_k: string, v2: string) => get(v2), get } as unknown as EspnClient;
};
const YES: GamePayout = { resolved: true, outcome: 0 }, NO: GamePayout = { resolved: true, outcome: 1 };
const cupDeps = (legs: Record<string, GamePayout | "fail">, store: FirstReadStore, t: number): GameDeps => ({
  tsdbKey: "k", apiSportsKey: null, firstReads: store, now: () => t, market: async () => CUP_MARKET,
  payout: async (id) => { const p = legs[id]; if (p === "fail") throw new Error("Polygon RPC timeout"); return p ?? null; },
});
describe("a contradiction found before the schedule sees the reads is remembered", () => {
  test("a home win at 90 minutes on chain against 1-1 after extra time: held, and still held when a Polygon leg fails later", async () => {
    const store = memoryFirstReadStore(), cup = (legs: Record<string, GamePayout | "fail">, t: number) => settleGame(cupClient(), CUP, cupDeps(legs, store, t), { schedule: "game" });
    const a = await cup({ [LH]: YES, [LD]: NO, [LA]: NO }, T0);
    assert.equal(a.kind, "held", JSON.stringify(a)); assert.match(a.kind === "held" ? a.why : "", /extra time/);
    assert.equal(store.get(gameKeyOf(CUP))?.contradiction?.op, "on-chain payout", "the contradiction is saved on the record");
    for (const t of [T0 + H, T0 + 13 * H, T0 + 30 * H]) {
      const v = await cup({ [LH]: "fail", [LD]: NO, [LA]: NO }, t);
      assert.equal(v.kind, "held", `a quiet leg never releases it (${JSON.stringify(v)})`);
    }
    // the same contradiction read again: still held, the anchor not moved
    assert.equal((await cup({ [LH]: YES, [LD]: NO, [LA]: NO }, T0 + 31 * H)).kind, "held");
    // that source reads the game cleanly (the draw leg: level after 90): cleared, and the 12 hours start from that read
    const c = await cup({ [LH]: NO, [LD]: YES, [LA]: NO }, T0 + 40 * H);
    assert.equal(c.kind, "awaiting", JSON.stringify(c)); assert.equal(c.kind === "awaiting" ? c.dueAt : null, T0 + 40 * H + GAME_BURN_DELAY_MS);
    assert.equal(store.get(gameKeyOf(CUP))?.contradiction, null);
    const d = await cup({ [LH]: NO, [LD]: YES, [LA]: NO }, T0 + 52 * H);
    assert.equal(d.kind === "settled" && d.winner, "home", JSON.stringify(d));
  });
  test("two legs paying out is remembered the same way", async () => {
    const store = memoryFirstReadStore(), cup = (legs: Record<string, GamePayout | "fail">, t: number) => settleGame(cupClient(), CUP, cupDeps(legs, store, t), { schedule: "game" });
    assert.equal((await cup({ [LH]: YES, [LD]: YES, [LA]: NO }, T0)).kind, "held");
    assert.equal((await cup({ [LH]: YES, [LD]: "fail", [LA]: NO }, T0 + 13 * H)).kind, "held", "a failing leg does not release two legs paying out");
    // the immediate answer for a game that is not a game coin is unchanged
    const plain = await settleGame(cupClient(), CUP, { ...cupDeps({ [LH]: YES, [LD]: YES, [LA]: NO }, memoryFirstReadStore(), T0) });
    assert.equal(plain.kind, "held");
  });
});
