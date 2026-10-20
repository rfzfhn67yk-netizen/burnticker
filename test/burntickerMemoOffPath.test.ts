// HB-145 (2026-10-20): 21 minutes after a restart on a quiet host the app stopped answering for more than 20 s. The home and coins memos
// were rebuilt ON the request path (a copy past its maximum age made the visitor wait up to 15 s for the rebuild). Now a timer rebuilds them
// behind the requests (src/lib/burnticker/memoRefresher.ts), no request waits while a copy exists, and every slow request and every held
// event loop is written down (scripts/service/web-slowlog.cjs) and counted into ops.json (ops/unitHealth.ts readSlowRequests).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { makeWorld } from "./burntickerApiHelpers.ts";
import { setPlatformForTests, type Platform } from "@/lib/burnticker/server";
import { memoRefresher, ACTIVE_MS } from "@/lib/burnticker/memoRefresher";
import { readSlowRequests, slowRequestsLine } from "@/lib/burnticker/ops/unitHealth";
import { hostFactLines } from "@/lib/burnticker/checkin";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

describe("HB-145: the memo timer rebuilds behind the requests", () => {
  test("active: rebuilt once older than its window; idle: nothing (HB-163); no copy yet: at once; nothing before the first request", () => {
    let t = 1_000_000, age: number | null = null, refreshes = 0;
    const r = memoRefresher({ refresh: async () => { refreshes++; }, ageMs: () => age, freshMs: () => 15_000, now: () => t, enabled: true, tickMs: 60_000_000 });
    assert.equal(r.running, false, "no timer until a request loads the route");
    r.touch();
    assert.equal(r.running, true);
    r.tick(); assert.equal(refreshes, 1, "no copy yet: build");
    age = 5_000; r.tick(); assert.equal(refreshes, 1, "inside the window: nothing");
    t += 11_000; age = 16_000; r.tick(); assert.equal(refreshes, 2, "active, asked after the copy was built, past the 15 s window: rebuilt");
    t += ACTIVE_MS + 1;   // a quiet spell
    age = 30_000; r.tick(); assert.equal(refreshes, 2, "idle: a 30 s copy is kept");
    age = 60 * 60_000; r.tick(); assert.equal(refreshes, 2, "HB-163: idle, even an hour-old copy is not rebuilt for nobody");
    r.stop(); assert.equal(r.running, false);
    const off = memoRefresher({ refresh: async () => {}, ageMs: () => null, freshMs: () => 1, enabled: false });
    off.touch(); assert.equal(off.running, false, "off outside production (the test runner) unless asked");
  });

  test("a refresh that rejects is swallowed (the route logs its own failures) and the timer goes on", async () => {
    const r = memoRefresher({ refresh: async () => { throw new Error("rpc down"); }, ageMs: () => null, freshMs: () => 1, enabled: true, tickMs: 60_000_000 });
    r.touch();
    assert.doesNotThrow(() => r.tick());
    await new Promise((res) => setTimeout(res, 0));
    r.stop();
  });

  test("home: a copy past its maximum age is served at once (marked stale) while the rebuild hangs; it never waits", async () => {
    const w = await makeWorld();
    const { GET } = await import("../src/app/api/burnticker/home/route.ts");
    assert.equal((await GET(new Request("http://localhost/"))).status, 200, "the first build");
    // the next rebuild hangs forever (a batch read that never answers)
    setPlatformForTests({ ...w.p, batchReader: { readMany: () => new Promise(() => {}) } } as unknown as Platform);
    const real = Date.now;
    Date.now = () => real() + 10 * 60_000;
    try {
      const t0 = real();
      const r = await GET(new Request("http://localhost/"));
      assert.ok(real() - t0 < 2_000, `answered in ${real() - t0} ms (before: up to 15 s on the request path)`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("x-home-memo"), "stale");
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.ok(Number(r.headers.get("x-home-age-sec")) >= 590);
    } finally { Date.now = real; }
  });

  test("coins index: the same, with no-store and its age", async () => {
    const w = await makeWorld();
    const { GET } = await import("../src/app/api/burnticker/tokens/route.ts");
    assert.equal((await GET(new Request("http://localhost/"))).status, 200);
    setPlatformForTests({ ...w.p, batchReader: { readMany: () => new Promise(() => {}) } } as unknown as Platform);
    const real = Date.now;
    Date.now = () => real() + 10 * 60_000;
    try {
      const t0 = real();
      const r = await GET(new Request("http://localhost/"));
      assert.ok(real() - t0 < 2_000, `answered in ${real() - t0} ms`);
      assert.equal(r.headers.get("x-index-memo"), "stale");
      assert.equal(r.headers.get("cache-control"), "no-store");
    } finally { Date.now = real; }
  });

  test("both routes start their timer on a request; only the first build after a start is waited for", () => {
    for (const [f, name] of [["src/app/api/burnticker/home/route.ts", "homeRefresher"], ["src/app/api/burnticker/tokens/route.ts", "indexRefresher"]] as const) {
      const src = read(f);
      assert.match(src, new RegExp(`const ${name} = memoRefresher\\(`));
      assert.match(src, new RegExp(`${name}\\.touch\\(isVisitorRequest\\(req\\)\\);`));
      assert.equal((src.match(/await Promise\.race\(\[refresh/g) ?? []).length, 1, `${f}: one wait left, the cold one`);
    }
  });
});

describe("HB-145: the slow-request and event-loop log", () => {
  const req = createRequire(import.meta.url);
  type SL = { slowRecord: (o: { ms: number; method: string; url: string; status: number; headers?: Record<string, unknown>; at: number; slowMs?: number }) => { line: string; record: Record<string, unknown> } | null; track: (s: http.Server, o?: { slowMs?: number; file?: string; out?: (s: string) => void }) => void; watchLoop: (o: { tickMs?: number; stallMs?: number; now?: () => number; file?: string; out?: (s: string) => void }) => () => void };
  const sl = (): SL => { const prev = process.env.BT_WEB_SLOWLOG; process.env.BT_WEB_SLOWLOG = "0"; try { return req(path.join(ROOT, "scripts/service/web-slowlog.cjs")) as SL; } finally { if (prev === undefined) delete process.env.BT_WEB_SLOWLOG; else process.env.BT_WEB_SLOWLOG = prev; } };

  test("a request over 2 s: route without its query, method, duration, status and the memo it waited on; a fast one writes nothing", () => {
    const { slowRecord } = sl();
    assert.equal(slowRecord({ ms: 1_999, method: "GET", url: "/x", status: 200, at: 1 }), null);
    const s = slowRecord({ ms: 15_750, method: "GET", url: "/api/burnticker/home?wallet=abc", status: 200, headers: { "x-home-memo": "cold" }, at: 1 })!;
    assert.equal(s.line, "slow: GET /api/burnticker/home 15750 ms HTTP 200 (memo home=cold)");
    assert.deepEqual(s.record, { kind: "request", at: 1, method: "GET", route: "/api/burnticker/home", ms: 15_750, status: 200, memo: "home=cold" });
    assert.ok(!JSON.stringify(s.record).includes("wallet"), "never the query string");
    assert.match(slowRecord({ ms: 20_780, method: "GET", url: "/burnticker/leagues/cfb/2026", status: 200, at: 1 })!.line, /^slow: GET \/burnticker\/leagues\/cfb\/2026 20780 ms HTTP 200$/);
  });

  test("on a real server: the slow request is written, with the memo header the route set through writeHead", async () => {
    const { track } = sl();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-slow-"));
    const file = path.join(dir, "logs", "burnticker-web-slow.log"), out: string[] = [];
    const server = http.createServer((q, res) => { setTimeout(() => { res.writeHead(200, { "x-pair-memo": "cold", "content-type": "application/json" }); res.end("{}"); }, q.url?.startsWith("/slow") ? 120 : 0); });
    track(server, { slowMs: 100, file, out: (s) => out.push(s) });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    await fetch(`http://127.0.0.1:${port}/fast`).then((r) => r.text());
    await fetch(`http://127.0.0.1:${port}/slow?x=1`).then((r) => r.text());
    await new Promise((r) => setTimeout(r, 20));
    server.close();
    assert.equal(out.length, 1, out.join(""));
    assert.match(out[0], /slow: GET \/slow 1\d\d ms HTTP 200 \(memo pair=cold\)/);
    const rec = JSON.parse(fs.readFileSync(file, "utf8").trim());
    assert.equal(rec.kind, "request"); assert.equal(rec.route, "/slow"); assert.equal(rec.memo, "pair=cold");
  });

  test("a held event loop is written with how long it was held", async () => {
    const { watchLoop } = sl();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-loop-"));
    const file = path.join(dir, "slow.log"), out: string[] = [];
    const stop = watchLoop({ tickMs: 20, stallMs: 150, file, out: (s) => out.push(s) });
    await new Promise((r) => setTimeout(r, 30));
    const t0 = Date.now(); while (Date.now() - t0 < 300) { /* hold the loop like a long synchronous build */ }
    await new Promise((r) => setTimeout(r, 60));
    stop();
    assert.ok(out.some((l) => /loop: the event loop was held for 0\.[2-4] s \(\d+ requests? in flight\)/.test(l)), out.join(""));
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8").trim().split("\n")[0]).kind, "loop");
  });

  test("ops.json: the last hour's slow requests and loop holds, the worst named; an absent file says none recorded", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-slowops-"));
    const now = Date.parse("2026-10-20T07:20:00Z");
    assert.equal(readSlowRequests(dir, now), null);
    assert.equal(slowRequestsLine(null), "- slow requests (last hour): none recorded (no logs/burnticker-web-slow.log yet)");
    fs.mkdirSync(path.join(dir, "logs"));
    const lines = [
      "{cut line from a tail read",
      JSON.stringify({ kind: "request", at: now - 2 * 3_600_000, method: "GET", route: "/old", ms: 99_000, status: 200 }),
      JSON.stringify({ kind: "request", at: now - 7 * 60_000, method: "GET", route: "/burnticker/leagues/cfb/2026", ms: 20_780, status: 503 }),
      JSON.stringify({ kind: "request", at: now - 5 * 60_000, method: "GET", route: "/api/burnticker/home", ms: 15_750, status: 200, memo: "home=cold" }),
      JSON.stringify({ kind: "loop", at: now - 6 * 60_000, ms: 8_000, inFlight: 4 }),
    ];
    fs.writeFileSync(path.join(dir, "logs", "burnticker-web-slow.log"), lines.join("\n") + "\n");
    const f = readSlowRequests(dir, now)!;
    assert.deepEqual(f, { requests: 2, loopHolds: 1, worstMs: 20_780, worstRoute: "GET /burnticker/leagues/cfb/2026", longestHoldMs: 8_000, lastAt: new Date(now - 5 * 60_000).toISOString() });
    assert.equal(slowRequestsLine(f), "- slow requests (last hour): 2 over 2 s; the slowest GET /burnticker/leagues/cfb/2026 in 20.8 s; the event loop was held 1 time, the longest 8.0 s; the last at 2026-10-20T07:15:00.000Z (logs/burnticker-web-slow.log)");
    assert.equal(slowRequestsLine({ requests: 0, loopHolds: 0, worstMs: null, worstRoute: null, longestHoldMs: null, lastAt: null }), "- slow requests (last hour): 0");
    const h = { dispersal: { on: false, line: "d" }, webhookConfigured: false, pushConfigured: true, heartbeatConfigured: true, backupDestConfigured: true, programHashSource: "p", slowRequests: f } as Parameters<typeof hostFactLines>[0];
    assert.ok(hostFactLines(h, now).some((l) => l.startsWith("- slow requests (last hour): 2 over 2 s")));
    assert.ok(!hostFactLines({ ...h, slowRequests: undefined }, now).some((l) => l.includes("slow requests")), "older documents: no line");
  });

  test("the web preloads the log, the keeper reads it, and the public tree carries it", () => {
    const run = read("scripts/service/run-burnticker-web.sh");
    assert.match(run, /SLOWLOG="\$\(pwd -P\)\/scripts\/service\/web-slowlog\.cjs"/);
    assert.match(run, /--require \$SLOWLOG/);
    assert.match(read("scripts/burnticker-keeper.mts"), /slowRequests: readSlowRequests\(process\.cwd\(\), now\)/);
    assert.match(read("config/public-repo.allowlist"), /^scripts\/service\/web-slowlog\.cjs$/m);
    assert.match(read("deploy/logrotate/burnticker"), /@REPO@\/logs\/\*\.log \{/, "logs/burnticker-web-slow.log is rotated with the rest");
  });
});
