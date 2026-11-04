// 2026-10-18: THE API-SPORTS READ WINDOW (gameSettle.ts apiSportsWindow). On the box (10-17 and 10-18) the keeper spent the whole
// API-Sports American-football day (51 of 51) by 13:00 UTC, before any NFL game kicked off, because settleGame cross-read API-Sports
// for every NFL game coin on every 5-minute cycle (two date URLs, each answer kept 30 minutes: about 96 reads a game a day). API-Sports
// is now read only from the game's start until its final is remembered, or until 36 hours after the start. A skipped read is "not
// answered": it never touches the one-source hold, never counts API-Sports out, and is never a disagreement.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { EspnClient, TSDB_LEAGUE, type Game } from "@/lib/burnticker/sources/espn";
import {
  APISPORTS_BEFORE_START_WHY, APISPORTS_CROSS_TTL_MS, APISPORTS_READ_AFTER_START_MS, APISPORTS_WINDOW_CLOSED_WHY, apiSportsWindow, holdKeyOf, memoryFirstReadStore, memoryHoldStore, settleGame,
  type GameDeps,
} from "@/lib/burnticker/sources/gameSettle";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const H = 3_600_000, MIN = 60_000;
const side = (abbr: string, name: string, homeAway: "home" | "away") => ({ abbr, name, nickname: name.split(" ").pop(), score: null, homeAway, record: null });
const game = (eventId: string, startsAt: string): Game => ({ eventId, league: "nfl", startsAt, date: startsAt.slice(0, 10), name: "Kansas City Chiefs at Las Vegas Raiders", completed: true, state: "post", detail: "Final", home: side("LV", "Las Vegas Raiders", "home"), away: side("KC", "Kansas City Chiefs", "away") } as unknown as Game);
const NFL = game("e1", "2026-10-04T20:25:00Z");
const START = Date.parse(NFL.startsAt);
const tsdbRow = (g: Game) => ({ idEvent: `tsdb-${g.eventId}`, idLeague: TSDB_LEAGUE.nfl, dateEvent: g.date, strTimestamp: g.startsAt.slice(0, 19), strHomeTeam: "Las Vegas Raiders", strAwayTeam: "Kansas City Chiefs", intHomeScore: "27", intAwayScore: "30", strStatus: "FT", strEvent: "Las Vegas Raiders vs Kansas City Chiefs" });
const asRow = (g: Game, done: boolean) => ({ teams: { home: { name: "Las Vegas Raiders" }, away: { name: "Kansas City Chiefs" } }, scores: { home: { total: 27 }, away: { total: 30 } }, game: { date: { date: g.date } }, date: g.startsAt, status: { short: done ? "FT" : "Q3" } });

/** A real EspnClient (its 30-minute API-Sports cache) on a moved clock. `tsdbFinal(t)`: TheSportsDB has the final; `asFinal(g, t)`: API-Sports has it. */
function world(games: Game[], o: { tsdbFinal?: (t: number) => boolean; asFinal?: (g: Game, t: number) => boolean } = {}) {
  let t = START;
  const seen: string[] = [];
  const fetchImpl = (async (url: string) => {
    seen.push(url);
    if (url.includes("thesportsdb")) return { ok: true, status: 200, json: async () => ({ events: o.tsdbFinal?.(t) ? games.filter((g) => url.includes(g.date)).map(tsdbRow) : [] }) };
    if (url.includes("api-sports.io")) return { ok: true, status: 200, json: async () => ({ errors: [], response: games.filter((g) => url.includes(`date=${g.date}`) && t >= Date.parse(g.startsAt)).map((g) => asRow(g, o.asFinal?.(g, t) ?? false)) }) };
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as FetchLike;
  const client = new EspnClient({ fetchImpl, now: () => t, minIntervalMs: 0, tsdbKey: "k", apiSportsKey: "as-key" } as never);
  const holds = memoryHoldStore(), firstReads = memoryFirstReadStore();
  const deps: GameDeps = { tsdbKey: "k", apiSportsKey: "as-key", market: async () => null, payout: null, holds, firstReads, now: () => t };
  return { client, deps, holds, firstReads, seen, apiSports: () => seen.filter((u) => u.includes("api-sports.io")).length, at: (x: number) => { t = x; } };
}

describe("before kickoff: API-Sports is not read", () => {
  for (const schedule of [undefined, "game"] as const) {
    test(`no API-Sports URL is requested before the start (${schedule ?? "team coin"}), and the pending line says why`, async () => {
      const w = world([NFL]);
      w.at(START - 2 * H);
      const v = await settleGame(w.client, NFL, w.deps, schedule ? { schedule } : {});
      assert.equal(w.apiSports(), 0, "API-Sports read before kickoff");
      assert.equal(v.kind, "awaiting");
    });
  }
  test("the window's own answer before the start, and its words", () => {
    const w = world([NFL]);
    assert.deepEqual(apiSportsWindow(NFL, w.deps, START - MIN), { kind: "skip", why: APISPORTS_BEFORE_START_WHY });
    assert.deepEqual(apiSportsWindow(NFL, w.deps, START), { kind: "read" });
  });
  test("an unknown start: the record's start, else 12:00 UTC on the game's date", () => {
    const w = world([NFL]);
    const noStart = { ...NFL, startsAt: "" } as Game;
    assert.equal(apiSportsWindow(noStart, w.deps, Date.parse("2026-10-04T11:59:00Z")).kind, "skip");
    assert.equal(apiSportsWindow(noStart, w.deps, Date.parse("2026-10-04T12:00:00Z")).kind, "read");
    w.firstReads.set("nfl:e1", { firstReadAt: 0, by: "TheSportsDB", winner: "away", home: null, away: null, ops: [], startsAt: "2026-10-04T20:25:00Z" });
    assert.equal(apiSportsWindow(noStart, w.deps, Date.parse("2026-10-04T13:00:00Z")).kind, "skip", "the record's start");
  });
  test("the pending lines are plain public English", () => {
    const cfg = loadCopyLintConfig();
    for (const s of [APISPORTS_BEFORE_START_WHY, APISPORTS_WINDOW_CLOSED_WHY]) {
      const r = lintCopy(s, cfg); assert.equal(r.ok, true, `${s}: ${JSON.stringify(r.hits)}`);
      assert.doesNotMatch(s, /\bwill\b|payout|soon|→|->|\d{4}-\d{2}-\d{2}/i, s);
    }
  });
});

describe("during the game: read, each answer kept 30 minutes", () => {
  test("read at the start, not again inside 30 minutes, again after", async () => {
    const w = world([NFL]);
    w.at(START + 5 * MIN);
    await settleGame(w.client, NFL, w.deps, { schedule: "game" });
    const n = w.apiSports();
    assert.ok(n >= 1 && n <= 2, "the game's date, and the day before when the first has no row");
    w.at(START + 30 * MIN);
    await settleGame(w.client, NFL, w.deps, { schedule: "game" });
    assert.equal(w.apiSports(), n, "read again inside 30 minutes");
    w.at(START + 5 * MIN + APISPORTS_CROSS_TTL_MS + MIN);
    await settleGame(w.client, NFL, w.deps, { schedule: "game" });
    assert.equal(w.apiSports(), 2 * n, "read again after 30 minutes");
  });
});

describe("after API-Sports' final is remembered: not read again", () => {
  for (const schedule of [undefined, "game"] as const) {
    test(`${schedule ?? "team coin"}: one read of the final, then none, however many cycles`, async () => {
      const w = world([NFL], { asFinal: () => true });
      w.at(START + 3 * H);
      await settleGame(w.client, NFL, w.deps, schedule ? { schedule } : {});
      const n = w.apiSports();
      assert.ok(n >= 1);
      for (let t = START + 4 * H; t < START + 30 * H; t += 5 * MIN) { w.at(t); await settleGame(w.client, NFL, w.deps, schedule ? { schedule } : {}); }
      // a game coin that only API-Sports answers reads it once more to confirm it (one fresh fetch); a team coin never does
      assert.equal(w.apiSports(), schedule ? n + 1 : n, "read again after its final was remembered");
    });
  }
  test("36 hours after the start with no final from it: not read, and the pending line says so", async () => {
    const w = world([NFL]);
    w.at(START + APISPORTS_READ_AFTER_START_MS + MIN);
    const v = await settleGame(w.client, NFL, w.deps, { schedule: "game" });
    assert.equal(w.apiSports(), 0);
    assert.equal(v.kind, "awaiting");
    assert.deepEqual(apiSportsWindow(NFL, w.deps, START + APISPORTS_READ_AFTER_START_MS + MIN), { kind: "skip", why: APISPORTS_WINDOW_CLOSED_WHY, closed: true });
    // a team coin with no final anywhere: still only waiting (API-Sports is counted out only once TheSportsDB has a final)
    const t = await settleGame(w.client, NFL, w.deps);
    assert.equal(t.kind, "awaiting"); assert.equal(w.apiSports(), 0);
  });
});

describe("a game coin that only API-Sports answers (review 2026-10-18)", () => {
  test("its remembered final is read once more, fresh, a cycle later, and the coin settles; then API-Sports is not read again", async () => {
    const w = world([NFL], { asFinal: () => true });
    const seen: number[] = [];
    let settledAt: number | null = null;
    for (let t = START + 3 * H; t < START + 6 * H; t += 5 * MIN) {
      w.at(t);
      const v = await settleGame(w.client, NFL, w.deps, { schedule: "game" });
      seen.push(w.apiSports());
      if (v.kind === "settled" && settledAt === null) { settledAt = t; assert.equal(v.twice, true); assert.deepEqual(v.ops, ["apisports.games"]); }
    }
    assert.equal(settledAt, START + 3 * H + 5 * MIN, "settled on the second fetch, one cycle after the first");
    assert.equal(seen[1] - seen[0], 1, "the confirming read is one fresh fetch of the game's date");
    assert.equal(seen[seen.length - 1], seen[1], "not read again once confirmed");
  });
  test("with another source remembered, API-Sports' final is not read again (the other source confirms)", async () => {
    const w = world([NFL], { asFinal: () => true, tsdbFinal: () => true });
    w.at(START + 3 * H);
    const a = await settleGame(w.client, NFL, w.deps, { schedule: "game" });
    assert.equal(a.kind, "awaiting", "owner 2026-10-20: two sources agreeing wait for the second read too");
    w.at(START + 3 * H + 5 * MIN);
    const b = await settleGame(w.client, NFL, w.deps, { schedule: "game" });
    assert.equal(b.kind, "settled", "the second read five minutes later");
  });
});

describe("an operator's release drops API-Sports' final for good (review 2026-10-18)", () => {
  test("the hold mark's copy of a released final does not bring the dispute back", async () => {
    const { releaseDispute, gameKeyOf } = await import("@/lib/burnticker/sources/gameSettle");
    let t = START + 3 * H, apiUp = true;
    const tsdb = tsdbRow(NFL);   // KC 30 at LV 27: the away side won
    const c = {
      tsdbRead: async (_k: string, url: string) => (url.includes(`/day/${NFL.date}`) ? { events: [tsdb] } : { events: [] }),
      get: async (url: string) => {
        if (!url.includes("api-sports.io")) throw new Error("HTTP 404");
        if (!apiUp) throw new Error("HTTP 500");
        // API-Sports names the home side the winner: LV 31, KC 10
        return { errors: [], response: url.includes(NFL.date) ? [{ ...asRow(NFL, true), scores: { home: { total: 31 }, away: { total: 10 } } }] : [] };
      },
    } as unknown as EspnClient;
    const holds = memoryHoldStore(), firstReads = memoryFirstReadStore();
    const d: GameDeps = { tsdbKey: "k", apiSportsKey: "as-key", market: async () => null, payout: null, holds, firstReads, now: () => t };
    assert.equal((await settleGame(c, NFL, d, { schedule: "game" })).kind, "held");
    assert.ok(holds.get(holdKeyOf(NFL))?.finals?.["apisports.games"], "the hold mark remembers API-Sports' final");
    const r = releaseDispute(firstReads.get(gameKeyOf(NFL))!, "away", "read by hand: KC won", t + MIN);
    assert.ok(r.ok); if (!r.ok) return;
    assert.deepEqual(r.dropped, ["apisports.games"]);
    firstReads.set(gameKeyOf(NFL), r.next);
    apiUp = false;   // API-Sports is quiet after the release
    t += 10 * MIN;
    assert.equal((await settleGame(c, NFL, d, { schedule: "game" })).kind, "awaiting", "not held again by the hold mark's old copy");
    t += 5 * MIN;
    const v = await settleGame(c, NFL, d, { schedule: "game" });
    assert.equal(v.kind, "settled", JSON.stringify(v)); assert.equal(v.kind === "settled" ? v.winner : null, "away");
  });
});

describe("a skipped read changes nothing in settlement", () => {
  test("before kickoff it does not touch the hold mark, and does not count API-Sports out", async () => {
    const mark = { home: 27, away: 30, firstSeenAt: START + 3 * H };
    const w2 = world([NFL], { tsdbFinal: () => true });
    w2.holds.set(holdKeyOf(NFL), mark);
    w2.at(START - H);
    await settleGame(w2.client, NFL, w2.deps);
    assert.deepEqual(w2.holds.get(holdKeyOf(NFL)), mark);
    assert.equal(w2.apiSports(), 0);
  });
  test("a team coin after the window has closed: TheSportsDB's first final brings one late API-Sports read, then API-Sports is counted out and the 12-hour hold runs", async () => {
    const w = world([NFL], { tsdbFinal: (t) => t >= START + 40 * H });
    w.at(START + APISPORTS_READ_AFTER_START_MS + H);
    assert.equal((await settleGame(w.client, NFL, w.deps)).kind, "awaiting");
    assert.equal(w.apiSports(), 0, "no late read before TheSportsDB has a final");
    w.at(START + 40 * H);
    const a = await settleGame(w.client, NFL, w.deps);
    assert.ok(w.apiSports() >= 1, "TheSportsDB's first final after the window: API-Sports is read once more");
    assert.equal(a.kind, "awaiting");
    const n = w.apiSports();
    w.at(START + 41 * H);
    const b = await settleGame(w.client, NFL, w.deps);
    assert.equal(w.apiSports(), n, "the late read is made once");
    assert.match(b.kind === "awaiting" ? b.why : "", /first seen now|starts again now/, "API-Sports counted out: the one-source hold starts");
    w.at(START + 53 * H);
    const c = await settleGame(w.client, NFL, w.deps);
    assert.equal(c.kind, "settled", JSON.stringify(c)); assert.equal(c.kind === "settled" ? c.singleSince : null, START + 41 * H);
    assert.equal(w.apiSports(), n);
  });
  test("a team coin whose late API-Sports read has the final: settled on the two sources at once", async () => {
    const w = world([NFL], { tsdbFinal: () => true, asFinal: () => true });
    w.at(START + APISPORTS_READ_AFTER_START_MS + H);
    const v = await settleGame(w.client, NFL, w.deps);
    assert.equal(v.kind, "settled", JSON.stringify(v)); assert.equal(v.kind === "settled" ? v.singleSince : 0, undefined);
  });
  test("a game coin: two sources inside the window settle on the second read five minutes later (owner 2026-10-20)", async () => {
    const w = world([NFL], { tsdbFinal: () => true, asFinal: () => true });
    w.at(START + 4 * H);
    assert.equal((await settleGame(w.client, NFL, w.deps, { schedule: "game" })).kind, "awaiting");
    w.at(START + 4 * H + 5 * MIN);
    const v = await settleGame(w.client, NFL, w.deps, { schedule: "game" });
    assert.equal(v.kind, "settled", JSON.stringify(v));
    assert.equal(v.kind === "settled" ? v.twoSources : false, true);
  });
  test("a game coin: API-Sports' remembered final still confirms TheSportsDB's when that arrives later", async () => {
    const w = world([NFL], { tsdbFinal: (t) => t >= START + 10 * H, asFinal: () => true });
    w.at(START + 4 * H);
    assert.equal((await settleGame(w.client, NFL, w.deps, { schedule: "game" })).kind, "awaiting");
    const n = w.apiSports();
    w.at(START + 10 * H);
    const v = await settleGame(w.client, NFL, w.deps, { schedule: "game" });
    assert.equal(w.apiSports(), n + 1, "the one confirming read of API-Sports, fresh, as the only source until now");
    assert.equal(v.kind, "settled", JSON.stringify(v));
    assert.equal(v.kind === "settled" ? v.twoSources : false, true);
  });
  test("a game coin: with API-Sports skipped (window closed), TheSportsDB alone takes the one-source path, not a wait for API-Sports", async () => {
    const w = world([NFL], { tsdbFinal: () => true });
    w.at(START + APISPORTS_READ_AFTER_START_MS + H);
    const a = await settleGame(w.client, NFL, w.deps, { schedule: "game" });
    assert.equal(w.apiSports(), 0);
    assert.equal(a.kind, "awaiting");
    assert.ok(a.kind === "awaiting" && a.dueAt !== null, "the game coin's own clock runs on TheSportsDB's read");
    w.at(a.kind === "awaiting" ? a.dueAt! : 0);
    const b = await settleGame(w.client, NFL, w.deps, { schedule: "game" });
    assert.equal(b.kind, "settled", JSON.stringify(b));
    assert.equal(w.apiSports(), 0);
  });
});

describe("the day's API-Sports reads for three NFL games a week stay far under the cap", () => {
  test("a week of 5-minute cycles, finals 3.5 hours after each start: at most 2 URLs × 8 reads × 3 games", async (t) => {
    const games = [game("g1", "2026-10-15T00:15:00Z"), game("g2", "2026-10-18T17:00:00Z"), game("g3", "2026-10-20T00:15:00Z")];
    const w = world(games, { asFinal: (g, t) => t >= Date.parse(g.startsAt) + 3.5 * H });
    const from = Date.parse("2026-10-14T00:00:00Z"), to = from + 7 * 24 * H;
    const perDay = new Map<string, number>();
    for (let at = from; at < to; at += 5 * MIN) {
      w.at(at);
      const before = w.apiSports();
      // the keeper's worst case: every game coin is settled every cycle (TheSportsDB never has a final, so nothing settles)
      for (const g of games) await settleGame(w.client, g, w.deps, { schedule: "game" });
      const day = new Date(at).toISOString().slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + w.apiSports() - before);
    }
    const week = w.apiSports(), cap = 2 * 8 * 3;
    t.diagnostic(`API-Sports reads: ${week} in the week; by day ${JSON.stringify(Object.fromEntries(perDay))}`);
    assert.ok(week <= cap, `${week} API-Sports reads in the week (cap ${cap})`);
    assert.ok(Math.max(...perDay.values()) <= 2 * 8 * 2, `the busiest day: ${Math.max(...perDay.values())}`);
    assert.ok(Math.max(...perDay.values()) < 85 / 2, "far under the keeper's 85 a day");
  });
});
