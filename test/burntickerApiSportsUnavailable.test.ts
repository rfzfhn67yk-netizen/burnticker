// 2026-10-16 audit F-4 review (fix 3): API-Sports is the second operator for leagues without a counted league feed. On its free plan
// (100 a day per sport) the keeper needs the larger share (0.85), a settlement cross-read answer is kept 30 minutes, and when its budget
// is spent for the day or it refuses the read (an `errors` body), settlement treats API-Sports as unavailable, so the TheSportsDB-only
// path (12-hour hold) applies instead of waiting all day for a read that cannot come.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { EspnClient, TSDB_LEAGUE, type Game } from "@/lib/burnticker/sources/espn";
import { memoryHoldStore, settleGame, type GameDeps } from "@/lib/burnticker/sources/gameSettle";
import { BudgetHoldError, specOf } from "@/lib/burnticker/apiBudget";
import type { FetchLike } from "@/lib/burnticker/oracle/types";

const side = (abbr: string, name: string, homeAway: "home" | "away") => ({ abbr, name, nickname: name.split(" ").pop(), score: null, homeAway, record: null });
const NFL = { eventId: "e1", league: "nfl", startsAt: "2026-10-04T20:25:00Z", date: "2026-10-04", name: "Kansas City Chiefs at Las Vegas Raiders", completed: true, state: "post", detail: "Final", home: side("LV", "Las Vegas Raiders", "home"), away: side("KC", "Kansas City Chiefs", "away") } as unknown as Game;
const tsdbRow = { idEvent: "tsdb-e1", idLeague: TSDB_LEAGUE.nfl, dateEvent: NFL.date, strTimestamp: "2026-10-04T20:25:00", strHomeTeam: "Las Vegas Raiders", strAwayTeam: "Kansas City Chiefs", intHomeScore: "27", intAwayScore: "30", strStatus: "FT", strEvent: "Las Vegas Raiders vs Kansas City Chiefs" };
const deps = (): GameDeps => ({ tsdbKey: "k", apiSportsKey: "as-key", market: async () => null, payout: null, holds: memoryHoldStore(), now: () => Date.parse("2026-10-05T12:00:00Z") });

function client(apiSports: (url: string) => unknown, seen: string[] = []): EspnClient {
  const fetchImpl = (async (url: string) => {
    seen.push(url);
    if (url.includes("thesportsdb")) return { ok: true, status: 200, json: async () => ({ events: url.includes(NFL.date) ? [tsdbRow] : [] }) };
    return { ok: true, status: 200, json: async () => apiSports(url) };
  }) as unknown as FetchLike;
  return new EspnClient({ fetchImpl, now: () => Date.parse("2026-10-05T12:00:00Z"), minIntervalMs: 0, tsdbKey: "k", apiSportsKey: "as-key" } as never);
}

describe("API-Sports out for the day: TheSportsDB alone applies (F-4 review 3)", () => {
  test("the keeper holds the larger share of each API-Sports source", () => {
    for (const id of ["apisports-american-football", "apisports-football", "apisports-basketball"]) {
      assert.equal(specOf(id).shares?.keeper, 0.85); assert.equal(specOf(id).shares?.web, 0.15);
    }
  });

  test("an API-Sports refusal (an errors body): the game takes the one-source path, not 'waiting for a second read'", async () => {
    const v = await settleGame(client(() => ({ errors: { requests: "You have reached the request limit for the day" }, response: [] })), NFL, deps());
    assert.equal(v.kind, "awaiting");
    assert.match(v.kind === "awaiting" ? v.why : "", /first seen now/);
  });

  test("a spent API-Sports budget: the same", async () => {
    const c = client(() => ({ errors: [], response: [] }));
    const real = c.get.bind(c);
    (c as unknown as { get: typeof c.get }).get = async (url, h, o) => { if (url.includes("api-sports.io")) throw new BudgetHoldError("apisports-american-football", { state: "hold", used: 85, budget: 85 }); return real(url, h, o); };
    const v = await settleGame(c, NFL, deps());
    assert.match(v.kind === "awaiting" ? v.why : "", /first seen now/);
  });

  test("API-Sports answering with no final yet still waits for it (it can read the game later)", async () => {
    const v = await settleGame(client(() => ({ errors: [], response: [] })), NFL, deps());
    assert.equal(v.kind, "awaiting");
    assert.doesNotMatch(v.kind === "awaiting" ? v.why : "", /first seen now/);
  });

  test("the settlement cross-read answer is kept 30 minutes while the game is not final", async () => {
    let t = Date.parse("2026-10-05T12:00:00Z");
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => { seen.push(url); return { ok: true, status: 200, json: async () => (url.includes("thesportsdb") ? { events: [] } : { errors: [], response: [] }) }; }) as unknown as FetchLike;
    const c = new EspnClient({ fetchImpl, now: () => t, minIntervalMs: 0, tsdbKey: "k", apiSportsKey: "as-key" } as never);
    const d = { ...deps(), now: () => t };
    await settleGame(c, NFL, d);
    const n = seen.filter((u) => u.includes("api-sports")).length;
    assert.ok(n > 0);
    t += 20 * 60_000;
    await settleGame(c, NFL, d);
    assert.equal(seen.filter((u) => u.includes("api-sports")).length, n, "read again inside 30 minutes");
    t += 11 * 60_000;
    await settleGame(c, NFL, d);
    assert.ok(seen.filter((u) => u.includes("api-sports")).length > n, "read again after 30 minutes");
  });
});

describe("the 12-hour hold is continuous and never outlives a disagreement (F-4 re-review blocker)", () => {
  const H = 3_600_000, T0 = Date.parse("2026-10-05T12:00:00Z");
  /** A client whose TheSportsDB day listing has KC 30, LV 27 (final), and whose API-Sports read follows `mode()`. */
  function cycleClient(mode: () => "out" | "pending" | "opposite" | "agree"): EspnClient {
    const asRow = (home: number, away: number) => ({ teams: { home: { name: "Las Vegas Raiders" }, away: { name: "Kansas City Chiefs" } }, scores: { home: { total: home }, away: { total: away } }, game: { date: { date: NFL.date } }, date: NFL.startsAt, status: { short: "FT" } });
    return {
      tsdbRead: async (_k: string, url: string) => (url.includes(`/day/${NFL.date}`) ? { events: [tsdbRow] } : { events: [] }),
      get: async (url: string) => {
        if (!url.includes("api-sports.io")) throw new Error("HTTP 404");
        const m = mode();
        if (m === "out") throw new BudgetHoldError("apisports-american-football", { state: "hold", used: 85, budget: 85 });
        if (m === "pending") return { errors: [], response: [] };
        return { errors: [], response: url.includes(NFL.date) ? [m === "opposite" ? asRow(31, 10) : asRow(27, 30)] : [] };
      },
    } as unknown as EspnClient;
  }
  const run = async (steps: { at: number; mode: "out" | "pending" | "opposite" | "agree" }[]) => {
    const holds = memoryHoldStore();
    let now = T0, mode: "out" | "pending" | "opposite" | "agree" = "out";
    const c = cycleClient(() => mode);
    const d: GameDeps = { tsdbKey: "k", apiSportsKey: "as-key", market: async () => null, payout: null, holds, now: () => now };
    const out = [];
    for (const s of steps) { now = T0 + s.at; mode = s.mode; out.push(await settleGame(c, NFL, d)); }
    return out;
  };

  test("budget spent, then API-Sports names the other winner, then spent again 13 h later: never settled on TheSportsDB alone", async () => {
    const [a, b, c] = await run([{ at: 0, mode: "out" }, { at: H, mode: "opposite" }, { at: 13 * H, mode: "out" }]);
    assert.equal(a.kind, "awaiting");
    assert.equal(b.kind, "held");
    assert.notEqual(c.kind, "settled", "settled on TheSportsDB alone over a known disagreement");
    assert.match(c.kind === "settled" ? "" : c.why, /disagreed/);
  });

  test("API-Sports out for the whole 12 hours: settles on TheSportsDB alone", async () => {
    const r = await run([{ at: 0, mode: "out" }, { at: 6 * H, mode: "out" }, { at: 12 * H, mode: "out" }]);
    assert.equal(r[2].kind, "settled");
  });

  test("API-Sports out at two instants 12 h apart but answering in between: the hold starts again", async () => {
    const r = await run([{ at: 0, mode: "out" }, { at: 6 * H, mode: "pending" }, { at: 12 * H, mode: "out" }, { at: 23 * H, mode: "out" }, { at: 24 * H, mode: "out" }]);
    assert.equal(r[1].kind, "awaiting");
    assert.notEqual(r[2].kind, "settled", "not out for the whole 12 hours");
    assert.notEqual(r[3].kind, "settled");
    assert.equal(r[4].kind, "settled", "12 continuous hours out from the 12 h mark");
  });

  test("the persistent store keeps the disagreement mark", async () => {
    const { statusHoldStore, holdKeyOf } = await import("@/lib/burnticker/sources/gameSettle");
    const m = new Map<string, string>();
    const reg = { getStatus: (k: string) => m.get(k) ?? null, setStatus: (k: string, v: unknown) => { m.set(k, typeof v === "string" ? v : JSON.stringify(v)); } };
    const s = statusHoldStore(reg, () => T0);
    s.set(holdKeyOf(NFL), { home: -1, away: -1, firstSeenAt: T0, disagreed: true } as never);
    assert.equal((statusHoldStore(reg, () => T0).get(holdKeyOf(NFL)) as { disagreed?: boolean } | null)?.disagreed, true);
  });
});

describe("a second source's final read before TheSportsDB's is remembered and compared (F residual gaps)", () => {
  const H = 3_600_000, T0 = Date.parse("2026-10-05T12:00:00Z");
  type Mode = "out" | "pending" | "opposite" | "agree";
  function cycleClient(tsdb: () => boolean, mode: () => Mode): EspnClient {
    const asRow = (home: number, away: number) => ({ teams: { home: { name: "Las Vegas Raiders" }, away: { name: "Kansas City Chiefs" } }, scores: { home: { total: home }, away: { total: away } }, game: { date: { date: NFL.date } }, date: NFL.startsAt, status: { short: "FT" } });
    return {
      tsdbRead: async (_k: string, url: string) => (tsdb() && url.includes(`/day/${NFL.date}`) ? { events: [tsdbRow] } : { events: [] }),
      get: async (url: string) => {
        if (!url.includes("api-sports.io")) throw new Error("HTTP 404");
        const m = mode();
        if (m === "out") throw new BudgetHoldError("apisports-american-football", { state: "hold", used: 85, budget: 85 });
        if (m === "pending") return { errors: [], response: [] };
        return { errors: [], response: url.includes(NFL.date) ? [m === "opposite" ? asRow(31, 10) : asRow(27, 30)] : [] };
      },
    } as unknown as EspnClient;
  }
  const run = async (steps: { at: number; tsdb: boolean; mode: Mode }[]) => {
    const holds = memoryHoldStore();
    let now = T0, mode: Mode = "out", tsdb = false;
    const c = cycleClient(() => tsdb, () => mode);
    const d: GameDeps = { tsdbKey: "k", apiSportsKey: "as-key", market: async () => null, payout: null, holds, now: () => now };
    const out = [];
    for (const s of steps) { now = T0 + s.at; mode = s.mode; tsdb = s.tsdb; out.push(await settleGame(c, NFL, d)); }
    return { out, holds };
  };

  test("API-Sports names the other winner while TheSportsDB has no final; TheSportsDB's final arrives with API-Sports out: held, never settled alone", async () => {
    const { out: [a, b, c], holds } = await run([{ at: 0, tsdb: false, mode: "opposite" }, { at: H, tsdb: true, mode: "out" }, { at: 14 * H, tsdb: true, mode: "out" }]);
    assert.equal(a.kind, "awaiting");
    assert.equal(b.kind, "held", JSON.stringify(b));
    assert.match(b.kind === "held" ? b.why : "", /≠/);
    assert.equal([...holds.marks.values()][0]?.disagreed, true);
    assert.notEqual(c.kind, "settled");
  });

  test("API-Sports agreeing before TheSportsDB's final: no hold from it; with API-Sports out the one-source hold runs and settles", async () => {
    const { out } = await run([{ at: 0, tsdb: false, mode: "agree" }, { at: H, tsdb: true, mode: "out" }, { at: 13 * H, tsdb: true, mode: "out" }]);
    assert.equal(out[1].kind, "awaiting"); assert.match(out[1].kind === "awaiting" ? out[1].why : "", /starts again now|first seen now/);
    assert.equal(out[2].kind, "settled", JSON.stringify(out[2]));
  });

  test("the 60-day cleanup never drops a disagreement mark", async () => {
    const { statusHoldStore } = await import("@/lib/burnticker/sources/gameSettle");
    const m = new Map<string, string>();
    const reg = { getStatus: (k: string) => m.get(k) ?? null, setStatus: (k: string, v: unknown) => { m.set(k, typeof v === "string" ? v : JSON.stringify(v)); } };
    let t = T0;
    const s = statusHoldStore(reg, () => t);
    s.set("nfl:old:x", { home: 27, away: 30, firstSeenAt: T0 });
    s.set("nfl:held:x", { home: -1, away: -1, firstSeenAt: T0, disagreed: true });
    t = T0 + 61 * 24 * H;
    s.set("nfl:new:x", { home: 1, away: 0, firstSeenAt: t });
    assert.equal(s.get("nfl:old:x"), null, "an old plain mark is dropped");
    assert.equal(s.get("nfl:held:x")?.disagreed, true, "a disagreement mark outlives 60 days");
  });
});
