// 2026-10-15 prelaunch audit H1 (confirmed live: /v1/sports/teams 503 at 20 s; /v1/search?q=broncos 503 three of three while TheSportsDB
// answered 522): the sports reads had no timeout and one process-wide queue, and failures were not kept, so every request retried the
// stalled host. These tests stall a real HTTP server and a fake fetch and check that reads end, providers do not block each other,
// failures are kept with backoff, and the team table and search answer without waiting on a schedule.
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { EspnClient } from "@/lib/burnticker/sources/espn";
import { setNativeClients } from "@/lib/burnticker/sources/native";
import { sportsTeams } from "@/lib/burnticker/api/handlers";
import { universalSearch } from "@/lib/burnticker/search";
import type { FetchLike } from "@/lib/burnticker/oracle/types";

/** Resolves with "timeout" when `p` takes longer than `ms` (the test's own guard: a hang fails the test instead of stalling the run). */
const guard = <T>(p: Promise<T>, ms: number): Promise<T | "timeout"> => { let t: ReturnType<typeof setTimeout>; return Promise.race([p.finally(() => clearTimeout(t)), new Promise<"timeout">((r) => { t = setTimeout(() => r("timeout"), ms); })]); };
/** A fetch that answers `stall`ed hosts never (until aborted) and every other host at once. */
function stallingFetch(stall: RegExp, calls: string[]): FetchLike {
  return (url, init) => {
    calls.push(url);
    if (!stall.test(url)) return Promise.resolve({ ok: true, status: 200, json: async () => ({ dates: [], gameWeek: [], events: [] }) });
    return new Promise((_res, rej) => { init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "TimeoutError" }))); });
  };
}

describe("the sports reads (H1)", () => {
  const servers: http.Server[] = [];
  after(() => { for (const s of servers) s.close(); setNativeClients({ espn: null }); });

  test("a stalled server: the read ends at the timeout with a plain reason (a real socket that never answers)", async () => {
    const srv = http.createServer(() => { /* accept, never answer */ });
    servers.push(srv);
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/v1/json/x/eventsnextleague.php?id=1`;
    const c = new EspnClient({ fetchImpl: ((u: string, i?: RequestInit) => fetch(u, i)) as unknown as FetchLike, minIntervalMs: 0, timeoutMs: 300, tsdbKey: null } as never);
    const t0 = Date.now();
    const r = await guard(c.get(url).then(() => "answered", (e: Error) => e.message), 5_000);
    assert.notEqual(r, "timeout", "the read must end on its own");
    assert.match(String(r), /timed out/);
    assert.ok(Date.now() - t0 < 2_000);
    srv.closeAllConnections();
  });

  test("a failed read is kept with backoff: the next callers get the same reason without a new request", async () => {
    const calls: string[] = [];
    let t = 1_000_000;
    const c = new EspnClient({ fetchImpl: async (u) => { calls.push(u); return { ok: false, status: 522, json: async () => ({}) }; }, now: () => t, minIntervalMs: 0, tsdbKey: null });
    const url = "https://www.thesportsdb.com/api/v2/json/schedule/next/league/4391";
    for (let i = 0; i < 5; i++) await assert.rejects(c.get(url), /HTTP 522/);
    assert.equal(calls.length, 1, "one request for five callers inside the backoff");
    t += 31_000;
    await assert.rejects(c.get(url), /HTTP 522/);
    assert.equal(calls.length, 2, "retried after the backoff");
    t += 31_000;
    await assert.rejects(c.get(url), /HTTP 522/);
    assert.equal(calls.length, 2, "the backoff doubles after a second failure");
  });

  test("one provider stalled never holds up another: an MLB read answers while TheSportsDB hangs", async () => {
    const calls: string[] = [];
    const c = new EspnClient({ fetchImpl: stallingFetch(/thesportsdb/, calls), minIntervalMs: 0, timeoutMs: 1_500, tsdbKey: null } as never);
    const stalled = c.get("https://www.thesportsdb.com/api/v2/json/schedule/next/league/4391").catch(() => null);
    const mlb = await guard(c.get("https://statsapi.mlb.com/api/v1/schedule?sportId=1"), 500);
    assert.notEqual(mlb, "timeout", "the MLB read waited behind the stalled TheSportsDB read");
    await stalled;
  });

  test("two callers of one URL share one read", async () => {
    const calls: string[] = [];
    const c = new EspnClient({ fetchImpl: async (u) => { calls.push(u); await new Promise((r) => setTimeout(r, 20)); return { ok: true, status: 200, json: async () => ({ x: 1 }) }; }, minIntervalMs: 0, tsdbKey: null });
    const u = "https://statsapi.mlb.com/api/v1/schedule?sportId=1&x=2";
    await Promise.all([c.get(u), c.get(u), c.get(u)]);
    assert.equal(calls.length, 1);
  });

  test("the team picker answers with the team table while the league's schedule is stalled", async () => {
    setNativeClients({ espn: new EspnClient({ fetchImpl: stallingFetch(/./, []), minIntervalMs: 0, timeoutMs: 60_000, tsdbKey: "k" } as never) });
    const r = await guard(sportsTeams(null as never, { league: "nfl" }), 6_000);
    assert.notEqual(r, "timeout", "the picker waited on the schedule");
    if (r === "timeout") return;
    assert.equal(r.status, 200);
    const b = r.body as { teams: unknown[]; scheduleNote: string | null };
    assert.ok(b.teams.length >= 32, "the whole table is served");
    assert.match(String(b.scheduleNote), /still being read/, "and it says the next games are still being read");
    assert.equal(r.headers?.["cache-control"], "public, max-age=5", "kept by caches for seconds, not the endpoint's five minutes");
  });

  test("search for a team answers while the team's schedule is stalled", async () => {
    const espn = new EspnClient({ fetchImpl: stallingFetch(/./, []), minIntervalMs: 0, timeoutMs: 60_000, tsdbKey: "k" } as never);
    const r = await guard(universalSearch("broncos", { venues: { kalshi: false, polymarket: false }, feeds: [], espn, polyGet: null, refuse: () => [], kalshiSearch: null, nowMs: Date.parse("2026-10-15T18:00:00Z"), scheduleWaitMs: 300 } as never), 6_000);
    assert.notEqual(r, "timeout", "search waited on the schedule");
    if (r === "timeout") return;
    assert.ok(r.cards.length > 0, "the team's cards are still offered");
  });
});
