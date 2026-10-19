// SECOND 2026-10-18 AUDIT A-7: every alert is sent by the box itself, so a dead box or network was seen by nobody. With
// BURNTICKER_STATUS_HEARTBEAT_URL set, the keeper GETs an off-box monitor once per cycle (ops/heartbeat.ts), bounded and without a body,
// and ops.json says whether a heartbeat is configured. Every test uses a fake fetch; nothing leaves the machine.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Heartbeat, HEARTBEAT_TIMEOUT_MS, heartbeatFailUrl, heartbeatLine, heartbeatUrlFromEnv, heartbeatVerdict } from "@/lib/burnticker/ops/heartbeat";
import { buildOpsJson } from "@/lib/burnticker/checkin";

const URL_ = "https://monitor.example/ping/secret-token-123";
const NOW = Date.parse("2026-10-18T15:00:00Z");
interface Call { url: string; method?: string; body?: unknown; signal?: AbortSignal }
function fake(answer: () => number | Error) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: Call) => { calls.push({ url, method: init.method, body: init.body, signal: init.signal }); const a = answer(); if (a instanceof Error) throw a; return { ok: a < 400, status: a, body: null } as unknown as Response; }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("A-7: the keeper's off-box heartbeat", () => {
  test("only an https URL turns it on", () => {
    assert.equal(heartbeatUrlFromEnv({}), null);
    assert.equal(heartbeatUrlFromEnv({ BURNTICKER_STATUS_HEARTBEAT_URL: "http://plain.example/x" }), null);
    assert.equal(heartbeatUrlFromEnv({ BURNTICKER_STATUS_HEARTBEAT_URL: `  ${URL_} ` }), URL_);
  });

  test("one bounded GET without a body; a failure is logged once per change and never names the URL", async () => {
    let status: number | Error = 200;
    const f = fake(() => status); const logs: string[] = [];
    const hb = new Heartbeat(URL_, f.fetchImpl, (s) => logs.push(s));
    assert.equal(await hb.beat(NOW), true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].method, "GET"); assert.equal(f.calls[0].body, undefined); assert.ok(f.calls[0].signal, "bounded by a timeout");
    assert.equal(HEARTBEAT_TIMEOUT_MS, 10_000);
    assert.equal(hb.state.lastOkAt, NOW);
    status = 503;
    assert.equal(await hb.beat(NOW + 60_000), false);
    status = new Error(`fetch failed for ${URL_}`);
    assert.equal(await hb.beat(NOW + 120_000), false);
    assert.equal(logs.length, 1, "logged once while it keeps failing");
    assert.doesNotMatch(logs.join("\n") + JSON.stringify(hb.state), /secret-token-123/);
    status = 200;
    assert.equal(await hb.beat(NOW + 180_000), true);
    assert.match(logs[1], /answers again/);
  });

  test("not configured: no request at all", async () => {
    const f = fake(() => 200);
    const hb = new Heartbeat(null, f.fetchImpl);
    assert.equal(await hb.beat(NOW), false);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(hb.state, { configured: false, lastOkAt: null, lastError: null, lastCycleFailedAt: null });
  });

  // review (2026-10-18): a keeper that runs but fails every cycle must not look healthy to the monitor
  test("review: a failed cycle sends the Healthchecks /fail signal, and nothing to any other monitor; a good cycle pings as before", async () => {
    const hc = fake(() => 200);
    const hb = new Heartbeat("https://hc-ping.com/0f3a-uuid/", hc.fetchImpl);
    assert.equal(await hb.beat(NOW, false), false);
    assert.deepEqual(hc.calls.map((c) => c.url), ["https://hc-ping.com/0f3a-uuid/fail"]);
    assert.equal(hb.state.lastOkAt, null, "a failed cycle is never a good ping");
    assert.equal(hb.state.lastCycleFailedAt, NOW);
    assert.equal(await hb.beat(NOW + 60_000, true), true);
    assert.equal(hc.calls[1].url, "https://hc-ping.com/0f3a-uuid/");
    const other = fake(() => 200);
    const hb2 = new Heartbeat(URL_, other.fetchImpl);
    assert.equal(await hb2.beat(NOW, false), false);
    assert.equal(other.calls.length, 0, "no failure signal known: skip the beat, the monitor's timeout raises the alarm");
  });

  test("review: the keeper judges each cycle with heartbeatVerdict over the live coins", (t) => {
    const k = path.join(import.meta.dirname, "..", "scripts", "burnticker-keeper.mts");
    if (!fs.existsSync(k)) { t.skip("not in this tree"); return; }
    assert.match(fs.readFileSync(k, "utf8"), /await heartbeat\.beat\(Date\.now\(\), heartbeatVerdict\(cycleReport, registry\.tokens\("live"\)\)\);/);
  });

  // re-review (2026-10-18): one held coin repeats its error every cycle and has its own alert; it must not turn the monitor red for days
  test("re-review: per-coin errors and fence holds are ok; no report or every coin errored is fail; any other error skips", () => {
    const live = [{ ticker: "BRONCO", mint: "Mint1111111111111111111111111111111111111111" }, { ticker: "DEFICIT", mint: "Mint2222222222222222222222222222222222222222" }];
    assert.equal(heartbeatVerdict({ errors: [] }, live), "ok");
    assert.equal(heartbeatVerdict({ errors: ["fence: $BRONCO: another registry recorded a different reading"] }, live), "ok", "a fence hold on one coin");
    assert.equal(heartbeatVerdict({ errors: ["$BRONCO: execute: blockhash not found", "Mint1111 2026-10-18: quorum short"] }, live), "ok", "one coin's errors");
    assert.equal(heartbeatVerdict(null, live), "fail", "the cycle itself failed");
    assert.equal(heartbeatVerdict({ errors: ["$BRONCO: execute: x", "fence: $DEFICIT: y"] }, live), "fail", "every live coin errored");
    assert.equal(heartbeatVerdict({ errors: ["pair gates: the RPC answered 500"] }, live), "skip");
    assert.equal(heartbeatVerdict({ errors: [] }, []), "ok", "no live coin: a completed cycle is fine");
  });

  test("re-review: skip sends nothing; a URL already ending in /fail is refused and never doubled", async () => {
    const f = fake(() => 200);
    const hb = new Heartbeat("https://hc-ping.com/0f3a-uuid", f.fetchImpl);
    assert.equal(await hb.beat(NOW, "skip"), false);
    assert.equal(f.calls.length, 0);
    assert.equal(await hb.beat(NOW, "ok"), true);
    assert.equal(f.calls[0].url, "https://hc-ping.com/0f3a-uuid");
    assert.equal(heartbeatUrlFromEnv({ BURNTICKER_STATUS_HEARTBEAT_URL: "https://hc-ping.com/0f3a-uuid/fail" }), null);
    assert.equal(heartbeatUrlFromEnv({ BURNTICKER_STATUS_HEARTBEAT_URL: "https://hc-ping.com/0f3a-uuid/fail/" }), null);
    assert.equal(heartbeatFailUrl("https://hc-ping.com/0f3a-uuid/fail"), "https://hc-ping.com/0f3a-uuid/fail");
  });

  test("re-review: the check-in line says when the last cycle failed", () => {
    const line = heartbeatLine({ configured: true, lastOkAt: NOW - 2 * 60_000, lastError: null, lastCycleFailedAt: NOW - 30 * 60_000 }, NOW);
    assert.equal(line, "- heartbeat: configured, last ping 2 min ago; the last failed cycle was 30 min ago");
    assert.equal(heartbeatLine({ configured: true, lastOkAt: NOW - 60_000, lastError: null, lastCycleFailedAt: null }, NOW), "- heartbeat: configured, last ping 1 min ago");
  });

  test("ops.json says whether a heartbeat is configured and how the last ping went", () => {
    const base = { now: NOW, snapshot: null, delta: null, alerts: [], firstLaunchAt: null };
    const off = buildOpsJson({ ...base, heartbeat: { configured: false, lastOkAt: null, lastError: null } });
    assert.deepEqual(off.heartbeat, { configured: false, lastOkAt: null, lastError: null });
    const on = buildOpsJson({ ...base, heartbeat: { configured: true, lastOkAt: NOW - 120_000, lastError: null } });
    assert.equal(on.heartbeat?.configured, true);
  });

  test("the keeper pings once per cycle and publishes the state (where the keeper script is in this tree)", (t) => {
    const k = path.join(import.meta.dirname, "..", "scripts", "burnticker-keeper.mts");
    if (!fs.existsSync(k)) { t.skip("not in this tree"); return; }
    const s = fs.readFileSync(k, "utf8");
    assert.match(s, /const heartbeat = new Heartbeat\(heartbeatUrlFromEnv\(process[.]env\), fetch, log\);/);
    assert.equal(s.match(/await heartbeat\.beat\(/g)?.length, 1, "one ping per cycle");
    const loop = s.indexOf("while (!stopping) {");
    assert.ok(s.indexOf("await heartbeat.beat(") > loop, "inside the cycle loop");
    assert.match(s, /heartbeat: heartbeat\.state \}\)\);/);
  });
});
