// 2026-10-16 prelaunch audit F-4 / F-19: the keeper could not read the NFL season schedule for about 16 hours while TheSportsDB answered
// 503 and then timed out at the 8 s read limit. The queue was per provider host, so an NBA read waited behind a stalled NFL read, and the
// 380 KB season schedule file had the same 8 s limit as a small read. Now: one queue per provider AND league (TheSportsDB's league id in
// the URL), the season schedule file gets SEASON_SCHEDULE_TIMEOUT_MS (20 s) while small reads keep 8 s, a failed read of a league with
// a game inside 24 hours is retried within a minute, games already over are not offered as "next", and the NFL's day listing falls
// back to API-Sports (fixtures by date, BURNTICKER_APISPORTS_KEY) while TheSportsDB cannot be read.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as espn from "@/lib/burnticker/sources/espn";
import { EspnClient, tsdbScheduleUrl } from "@/lib/burnticker/sources/espn";
import { sourceForUrl, specOf } from "@/lib/burnticker/apiBudget";
import type { FetchLike } from "@/lib/burnticker/oracle/types";

const guard = <T>(p: Promise<T>, ms: number): Promise<T | "timeout"> => { let t: ReturnType<typeof setTimeout>; return Promise.race([p.finally(() => clearTimeout(t)), new Promise<"timeout">((r) => { t = setTimeout(() => r("timeout"), ms); })]); };
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const stall = (init?: { signal?: AbortSignal }) => new Promise<never>((_res, rej) => { init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "TimeoutError" }))); });
const tsdbRow = (id: string, iso: string, home: string, away: string, status = "NS") => ({ idEvent: id, strTimestamp: iso.replace(/Z$/, ""), dateEvent: iso.slice(0, 10), strHomeTeam: home, strAwayTeam: away, strStatus: status, intRound: "7" });

describe("one stalled league never holds up another (F-4)", () => {
  test("an NBA schedule read answers while the NFL schedule read on the same provider hangs", async () => {
    const c = new EspnClient({ fetchImpl: ((url: string, init?: { signal?: AbortSignal }) => (url.includes("/league/4391/") ? stall(init) : Promise.resolve(okJson({ schedule: [] })))) as unknown as FetchLike, minIntervalMs: 0, timeoutMs: 2_000, tsdbKey: "k" } as never);
    const nfl = c.get(tsdbScheduleUrl("nfl", 2026)).catch(() => null);
    const nba = await guard(c.get(tsdbScheduleUrl("nba", 2026)), 500);
    assert.notEqual(nba, "timeout", "the NBA read waited behind the stalled NFL read");
    await nfl;
  });
});

describe("the season schedule file has its own read limit (F-4)", () => {
  test("20 s for the season schedule file; small reads keep 8 s", () => {
    assert.equal((espn as unknown as { SEASON_SCHEDULE_TIMEOUT_MS?: number }).SEASON_SCHEDULE_TIMEOUT_MS, 20_000);
    assert.equal(espn.SPORTS_FETCH_TIMEOUT_MS, 8_000);
  });
  test("a stalled season schedule read ends at the longer limit, a small read at the short one", async () => {
    const c = new EspnClient({ fetchImpl: ((_u: string, init?: { signal?: AbortSignal }) => stall(init)) as unknown as FetchLike, minIntervalMs: 0, timeoutMs: 100, scheduleTimeoutMs: 600, tsdbKey: "k" } as never);
    const t0 = Date.now();
    await assert.rejects(c.get("https://www.thesportsdb.com/api/v2/json/schedule/next/league/4391"), /timed out after/);
    const small = Date.now() - t0;
    const t1 = Date.now();
    await assert.rejects(c.get(tsdbScheduleUrl("nfl", 2026)), /timed out after/);
    const big = Date.now() - t1;
    assert.ok(small < 400, `the small read took ${small} ms`);
    assert.ok(big >= 500, `the season schedule read was cut at ${big} ms`);
  });
});

describe("a game inside 24 hours is retried sooner (F-4)", () => {
  test("with the next game 6 h away, a failing read is tried again within a minute however often it failed", async () => {
    let t = Date.parse("2026-10-17T12:00:00Z");
    let fail = false, calls = 0;
    const game = new Date(t + 6 * 3_600_000).toISOString().replace(/\.\d+Z$/, "Z");
    const c = new EspnClient({ fetchImpl: async () => { calls++; return fail ? { ok: false, status: 503, json: async () => ({}) } : okJson({ schedule: [tsdbRow("2475999", game, "Denver Broncos", "Kansas City Chiefs")] }); }, now: () => t, minIntervalMs: 0, ttlMs: 60_000, tsdbKey: "k" } as never);
    assert.equal((await c.season("nfl", "DEN", 2026)).length, 1);
    fail = true;
    for (let i = 0; i < 6; i++) { t += 61_000; await assert.rejects(c.season("nfl", "DEN", 2026)); }
    assert.equal(calls, 1 + 6, "every read after a minute went out (no doubling past a minute while a game is near)");
  });
  test("with no game near, the backoff still doubles", async () => {
    let t = Date.parse("2026-10-17T12:00:00Z");
    let fail = false, calls = 0;
    const game = new Date(t + 5 * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
    const c = new EspnClient({ fetchImpl: async () => { calls++; return fail ? { ok: false, status: 503, json: async () => ({}) } : okJson({ schedule: [tsdbRow("2475999", game, "Denver Broncos", "Kansas City Chiefs")] }); }, now: () => t, minIntervalMs: 0, ttlMs: 60_000, tsdbKey: "k" } as never);
    await c.season("nfl", "DEN", 2026);
    fail = true;
    for (let i = 0; i < 6; i++) { t += 61_000; await c.season("nfl", "DEN", 2026).catch(() => null); }
    assert.ok(calls < 1 + 6, `${calls - 1} reads in six minutes`);
  });
});

describe("games already over are not offered as next (F-4)", () => {
  test("upcoming drops a final game and a listing that started long ago, keeps one in progress", async () => {
    const now = Date.parse("2026-10-18T22:00:00Z");
    const rows = [
      tsdbRow("1001", "2026-10-18T13:00:00Z", "Denver Broncos", "Kansas City Chiefs", "FT"),
      tsdbRow("1002", "2026-10-18T09:00:00Z", "Buffalo Bills", "Miami Dolphins", "NS"),
      tsdbRow("1003", "2026-10-18T20:25:00Z", "Dallas Cowboys", "New York Giants", "Q3"),
      tsdbRow("1004", "2026-10-19T00:20:00Z", "Philadelphia Eagles", "Los Angeles Rams", "NS"),
    ];
    const c = new EspnClient({ fetchImpl: async () => okJson({ schedule: rows }), now: () => now, minIntervalMs: 0, tsdbKey: "k" } as never);
    const ids = (await c.upcoming("nfl", 3)).map((g) => g.eventId);
    assert.deepEqual(ids, ["1003", "1004"]);
  });
});

describe("the NFL day listing falls back to API-Sports (F-4)", () => {
  const asRow = (id: number, iso: string, home: string, away: string, league = { id: 1, name: "NFL" }, stage = "Regular Season", st = "NS") => ({ game: { id, stage, date: { timezone: "UTC", date: iso.slice(0, 10), time: iso.slice(11, 16), timestamp: Date.parse(iso) / 1000 }, status: { short: st } }, league, teams: { home: { id: 1, name: home }, away: { id: 2, name: away } }, scores: { home: { total: null }, away: { total: null } } });
  test("TheSportsDB answers 503: the next days are read from API-Sports fixtures by date, NFL rows only, with the key in its header", async () => {
    const now = Date.parse("2026-10-17T15:00:00Z");
    const seen: { url: string; key: string | null }[] = [];
    const fetchImpl = (async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push({ url, key: init?.headers?.["x-apisports-key"] ?? null });
      if (url.includes("thesportsdb")) return { ok: false, status: 503, json: async () => ({}) };
      if (url.includes("date=2026-10-18")) return okJson({ errors: [], response: [asRow(7001, "2026-10-18T17:00:00Z", "Denver Broncos", "New York Giants"), asRow(9001, "2026-10-18T16:00:00Z", "Alabama Crimson Tide", "LSU Tigers", { id: 2, name: "NCAA" })] });
      return okJson({ errors: [], response: [] });
    }) as unknown as FetchLike;
    const c = new EspnClient({ fetchImpl, now: () => now, minIntervalMs: 0, tsdbKey: "k", apiSportsKey: "as-key" } as never);
    const games = await c.upcoming("nfl", 3);
    assert.equal(games.length, 1);
    assert.equal(games[0].eventId, "apisports-7001", "a fallback game never takes a TheSportsDB id (a game coin cannot be made from it)");
    assert.equal(games[0].home.abbr, "DEN"); assert.equal(games[0].away.abbr, "NYG");
    assert.equal(games[0].seasonType, 2);
    const as = seen.filter((s) => s.url.includes("api-sports.io"));
    assert.ok(as.length >= 1 && as.length <= 4, `${as.length} API-Sports reads for a 3-day listing`);
    assert.ok(as.every((s) => s.key === "as-key" && /american-football\.api-sports\.io\/games\?date=\d{4}-\d{2}-\d{2}&timezone=UTC$/.test(s.url)));
    // the free plan's 100 a day: counted under its own source, not the house default
    const src = sourceForUrl(as[0].url);
    assert.equal(specOf(src).limit.perDay, 100);
  });
  test("without the key, TheSportsDB's error stands", async () => {
    const c = new EspnClient({ fetchImpl: (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as FetchLike, now: () => Date.parse("2026-10-17T15:00:00Z"), minIntervalMs: 0, tsdbKey: "k", apiSportsKey: null } as never);
    await assert.rejects(c.upcoming("nfl", 3), /HTTP 503/);
  });
});

describe("a fallback listing is partial: it never says a season is over (F-4 review)", () => {
  const g = (id: string, home: string, away: string, seasonType: 2 | 3) => ({ eventId: id, league: "nfl", seasonType, seasonYear: 2026, startsAt: "2026-10-18T17:00:00Z", date: "2026-10-18", name: "x", completed: false, state: "pre", detail: "NS", home: { abbr: home } as never, away: { abbr: away } as never }) as never;
  test("seasonOverFor answers null on a listing with any apisports- row; the same listing from TheSportsDB refuses", async () => {
    const { seasonOverFor, seasonStatus } = await import("@/lib/burnticker/seasonOver");
    const rule = { oracle: "catalogue", series: espn.teamSeries("nfl", "DEN", "win", { kind: "season", year: 2026 }) };
    const now = Date.parse("2026-10-17T15:00:00Z");
    const tsdbOnly = [g("2475001", "KC", "BUF", 3)];
    assert.ok(await seasonOverFor(rule, async () => tsdbOnly, { now }), "control: a postseason-only listing without DEN is over");
    const fallback = [g("apisports-7001", "KC", "BUF", 3)];
    assert.equal(await seasonOverFor(rule, async () => fallback, { now }), null);
    assert.equal(seasonStatus("DEN", fallback, true).status, "unknown");
    assert.equal(seasonStatus("KC", fallback, true).status, "upcoming");
  });
});

describe("the matchup picker never offers a fallback game (F-4 review)", () => {
  test("TheSportsDB down, API-Sports answers: the games list is empty rather than offering a game that cannot launch", async () => {
    const { setNativeClients } = await import("@/lib/burnticker/sources/native");
    const { sportsGames } = await import("@/lib/burnticker/api/handlers");
    const now = Date.parse("2026-10-17T15:00:00Z");
    const row = { game: { id: 7001, stage: "Regular Season", date: { date: "2026-10-18", time: "17:00", timestamp: Date.parse("2026-10-18T17:00:00Z") / 1000 }, status: { short: "NS" } }, league: { id: 1 }, teams: { home: { name: "Denver Broncos" }, away: { name: "New York Giants" } }, scores: { home: { total: null }, away: { total: null } } };
    const fetchImpl = (async (url: string) => (url.includes("thesportsdb") ? { ok: false, status: 503, json: async () => ({}) } : okJson({ errors: [], response: url.includes("2026-10-18") ? [row] : [] }))) as unknown as FetchLike;
    const client = new EspnClient({ fetchImpl, now: () => now, minIntervalMs: 0, tsdbKey: "k", apiSportsKey: "as-key" } as never);
    assert.equal((await client.upcoming("nfl", 3)).length, 1, "control: the fallback has the game");
    setNativeClients({ espn: client });
    try {
      const r = await sportsGames(null as never, { league: "nfl" }, now);
      assert.equal((r.body as { count: number }).count, 0);
      // F-4 re-review: and it says why, in one plain sentence that passes the copy lint
      const note = (r.body as { scheduleNote: string | null }).scheduleNote;
      assert.equal(note, espn.FALLBACK_ONLY_LINE);
      const { lintCopy, loadCopyLintConfig } = await import("@/lib/launch/copyLint");
      const lint = lintCopy(note!, loadCopyLintConfig());
      assert.ok(lint.ok, lint.hits.map((h) => h.phrase).join(", "));
    } finally { setNativeClients({ espn: null }); }
  });
});

describe("a refusal body is not retried within a minute (F-4 review 4)", () => {
  test("API-Sports answering `errors` near a game: the doubling backoff applies, not the 60 s retry", async () => {
    let t = Date.parse("2026-10-17T12:00:00Z"), calls = 0;
    const c = new EspnClient({ fetchImpl: (async () => { calls++; return okJson({ errors: { requests: "limit reached" }, response: [] }); }) as unknown as FetchLike, now: () => t, minIntervalMs: 0, tsdbKey: "k", apiSportsKey: "as-key" } as never);
    // the league's next game is 6 h away (noted from a schedule read)
    (c as unknown as { nextGameAt: Map<string, number> }).nextGameAt.set("nfl", t + 6 * 3_600_000);
    assert.equal(c.gameSoon("nfl"), true);
    const url = espn.apiSportsDayUrl("nfl", "2026-10-18");
    const read = () => c.get(url, {}, { league: "nfl", refuse: espn.apiSportsRefusal });
    for (let i = 0; i < 5; i++) { await assert.rejects(read(), /API-Sports refused the read/); t += 61_000; }
    assert.ok(calls < 5, `${calls} reads in five minutes for a refused source`);
  });
});
