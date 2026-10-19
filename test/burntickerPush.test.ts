// POLISH-1 (2026-10-12; PLATFORM-NEXT-2-BRIEF.md item 8): phone pushes for the states that matter. The keeper reads the registry's
// alerts table and pushes five kinds of trouble, rate-limited, with a daily "all quiet" line (src/lib/burnticker/push.ts); the
// publish timer's keeper-status-check.sh pushes a status file stale for more than two hours. Every test uses a fake sink: a recording
// fetch, or a local HTTP server for the shell script. Nothing leaves the machine.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import type { AddressInfo } from "node:net";
import { Keypair } from "@solana/web3.js";
import { openRegistry } from "@/lib/burnticker/registry";
import { PUSH_KIND_OF_ALERT, PUSH_MAX_PER_HOUR, PUSH_STATE_KEY, planPushes, pushConfigFromEnv, pushKeeperRefused, runPushCheck, type AlertRowLike, type PushState } from "@/lib/burnticker/push";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { FakePinUploader } from "@/lib/burnticker/pin";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { teamSeries } from "@/lib/burnticker/sources/espn";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const H = 3_600_000;
/** 2026-10-20 10:00 Denver (16:00 UTC): after the daily line's hour. */
const MORNING = Date.parse("2026-10-20T16:00:00Z");
/** 2026-10-20 05:00 Denver: before it. */
const DAWN = Date.parse("2026-10-20T11:00:00Z");
const ENV = { BURNTICKER_PUSH_URL: "https://push.example/burnticker", BURNTICKER_PUSH_TOKEN: "tok-secret" };
const alert = (ts: number, kind: string, key = `${kind}:${ts}`, text = `${kind} happened`): AlertRowLike => ({ ts, kind, key, text });
const settled = (now: number): PushState => ({ cursor: now - H, lastByKind: {}, sent: [], held: {}, heldToday: 0, lastDaily: new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Denver" }) });

interface Call { url: string; headers: Record<string, string>; body: string }
function fakeSink(status = 200) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => { calls.push({ url, headers: init.headers, body: init.body }); return { ok: status < 400, status } as Response; }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("the plan (pure)", () => {
  // SECOND 2026-10-18 AUDIT A-7: the most serious recorded kinds never reached the phone
  test("A-7: audit mismatch, low keeper balance, reading conflict, foreign reading, takeover and the other serious kinds are pushed", () => {
    const serious = ["bt-audit-mismatch", "bt-audit-stale", "bt-keeper-balance-low", "bt-reading-conflict", "bt-reading-implausible", "bt-foreign-reading", "bt-keeper-takeover", "bt-feed-stale", "bt-feed-disagree", "derby-withheld", "bt-cap-binding", "bt-pin-orphan"];
    for (const k of serious) assert.ok(PUSH_KIND_OF_ALERT[k], `${k} is not pushed`);
    const r = planPushes({ now: DAWN, state: settled(DAWN), alerts: serious.map((k, i) => alert(DAWN - 60_000 + i, k)) });
    // six per hour in all: the first six go now and the rest are held, except an urgent kind (the takeover), which the cap never holds
    assert.equal(r.messages.length, PUSH_MAX_PER_HOUR + 1);
    assert.deepEqual(r.messages.map((m) => m.title), ["Burnticker audit found a receipt that does not add up", "Burnticker audit not running", "Burnticker keeper key running low on SOL", "Burnticker source changed a recorded result", "Burnticker reading refused", "Burnticker keeper holding its sends", "Burnticker standby keeper took over"]);
    for (const m of r.messages) { assert.equal(m.priority, "high"); assert.doesNotMatch(`${m.title} ${m.body}`, /→|\bwill\b|\d{4}-\d{2}-\d{2}/); }
    const later = planPushes({ now: DAWN + 2 * H, state: { ...settled(DAWN), cursor: DAWN - 120_000 }, alerts: serious.slice(6).map((k, i) => alert(DAWN - 60_000 + i, k)) });
    assert.deepEqual(later.messages.filter((m) => m.kind !== "daily").map((m) => [m.kind, m.priority]), [["keeper-takeover", "high"], ["feed-stale", "high"], ["feed-disagree", "high"], ["derby-withheld", "high"], ["cap-binding", "low"], ["pin-orphan", "low"]]);
  });
  test("the five states map to pushes; everything else stays in the registry only", () => {
    assert.deepEqual(Object.values(PUSH_KIND_OF_ALERT).sort(), ["api-budget", "audit-mismatch", "audit-stale", "backup-failed", "backup-offbox", "burn-behind", "cap-binding", "config-mismatch", "crank-refused", "crank-refused", "derby-withheld", "dispersal-off", "dispersal-receipt", "feed-disagree", "feed-down", "feed-stale", "foreign-reading", "keeper-balance-low", "keeper-refused", "keeper-takeover", "late-reading", "launch-admitted-after-closure", "launch-after-closure", "launch-failed", "launch-late", "mint-bank-low", "never-buys-red", "pair-forward", "pair-forward", "pair-link", "pair-link", "pair-result", "pair-result", "pair-result", "pair-result", "pin-budget", "pin-failed", "pin-failed", "pin-orphan", "race-held", "reading-conflict", "reading-conflict", "reading-implausible", "reading-unresolved", "registry-newer", "revival-ticker-held", "signer-disagree", "single-source", "synthetic-failed", "ticker-live", "unit-failed"]);
    const { messages } = planPushes({ now: DAWN, state: settled(DAWN), alerts: [alert(DAWN - 60_000, "cosigner-disagree"), alert(DAWN - 50_000, "bt-feed-stall"), alert(DAWN - 40_000, "bt-daily-summary")] });
    assert.deepEqual(messages.map((m) => m.kind), ["signer-disagree"]);
    assert.equal(messages[0].priority, "high");
    assert.match(messages[0].body, /second signer did not agree/);
  });
  test("rate limit: one push per kind per hour, six per hour in all; what is held is named in the next push", () => {
    let st = settled(DAWN);
    let r = planPushes({ now: DAWN, state: st, alerts: [alert(DAWN - 3000, "bt-crank-failed", "a"), alert(DAWN - 2000, "bt-crank-failed", "b"), alert(DAWN - 1000, "bt-crank-failed", "c")] });
    assert.equal(r.messages.length, 1); assert.equal(r.state.held["crank-refused"], 2);
    st = r.state;
    r = planPushes({ now: DAWN + 30 * 60_000, state: st, alerts: [alert(DAWN + 29 * 60_000, "bt-crank-failed", "d")] });
    assert.equal(r.messages.length, 0, "inside the hour"); assert.equal(r.state.held["crank-refused"], 3);
    r = planPushes({ now: DAWN + H + 1, state: r.state, alerts: [alert(DAWN + H, "bt-crank-failed", "e")] });
    assert.equal(r.messages.length, 1); assert.match(r.messages[0].body, /3 more alerts were held back by the rate limit/); assert.deepEqual(r.state.held, {});
    // the global cap
    const full = { ...settled(DAWN), sent: Array.from({ length: PUSH_MAX_PER_HOUR }, (_, i) => DAWN - i * 1000) };
    assert.equal(planPushes({ now: DAWN, state: full, alerts: [alert(DAWN - 1, "bt-pin-failed")] }).messages.length, 0);
    // review (2026-10-18): an urgent kind such as the keeper refusal is never held by the six-per-hour cap
    assert.equal(planPushes({ now: DAWN, state: full, alerts: [alert(DAWN - 1, "bt-keeper-refused")] }).messages.length, 1);
  });
  test("the cursor: an alert is pushed once, and a first run looks back one hour only", () => {
    const r1 = planPushes({ now: DAWN, state: settled(DAWN), alerts: [alert(DAWN - 1000, "bt-pin-failed")] });
    const r2 = planPushes({ now: DAWN + 2 * H, state: r1.state, alerts: [alert(DAWN - 1000, "bt-pin-failed")] });
    assert.equal(r1.messages.length, 1); assert.equal(r2.messages.filter((m) => m.kind !== "daily").length, 0);
    const first = planPushes({ now: DAWN, state: null, alerts: [alert(DAWN - 3 * H, "bt-pin-failed"), alert(DAWN - 10 * 60_000, "bt-snapshot-failed")] });
    assert.equal(first.messages.filter((m) => m.kind === "pin-failed").length, 1);
  });
  test("the daily line: once per Denver day after 08:00 Denver, all quiet when nothing was sent or held", () => {
    const quiet = planPushes({ now: MORNING, state: { ...settled(MORNING), lastDaily: "2026-10-19" }, alerts: [] });
    assert.equal(quiet.messages.length, 1); assert.equal(quiet.messages[0].title, "Burnticker all quiet"); assert.equal(quiet.messages[0].priority, "low");
    assert.match(quiet.messages[0].body, /^Burnticker is quiet\. No alert needed you in the last 24 hours\./);
    assert.equal(planPushes({ now: MORNING + 10 * 60_000, state: quiet.state, alerts: [] }).messages.length, 0, "once a day");
    assert.equal(planPushes({ now: DAWN, state: { ...settled(DAWN), lastDaily: "2026-10-19" }, alerts: [] }).messages.length, 0, "not before 08:00 Denver");
    const busy = planPushes({ now: MORNING, state: { ...settled(MORNING), lastDaily: "2026-10-19", sent: [MORNING - 5 * H, MORNING - 6 * H], heldToday: 1 }, alerts: [] });
    assert.equal(busy.messages[0].body, "Burnticker sent 2 alerts to this phone in the last 24 hours, and held back one more under the rate limit. This line arrives once a day.");
    assert.equal(busy.state.heldToday, 0);
  });
  test("plain sentences: no arrows, no shorthand, no will", () => {
    const r = planPushes({ now: MORNING, state: null, alerts: Object.keys(PUSH_KIND_OF_ALERT).map((k, i) => alert(MORNING - (i + 1) * 1000, k)) });
    for (const m of r.messages) { assert.doesNotMatch(`${m.title} ${m.body}`, /→|\bwill\b|TODO/); }
  });
  test("config: an https URL turns it on; nothing else does", () => {
    assert.equal(pushConfigFromEnv({}), null);
    assert.equal(pushConfigFromEnv({ BURNTICKER_PUSH_URL: "http://plain" }), null);
    assert.deepEqual(pushConfigFromEnv(ENV), { url: ENV.BURNTICKER_PUSH_URL, token: "tok-secret" });
    assert.deepEqual(pushConfigFromEnv({ BURNTICKER_PUSH_URL: ENV.BURNTICKER_PUSH_URL }), { url: ENV.BURNTICKER_PUSH_URL, token: null });
  });
});

describe("runPushCheck on a real registry with a fake sink", () => {
  test("no URL: nothing is sent and no state is written", async () => {
    const reg = openRegistry(":memory:"); const s = fakeSink();
    reg.recordAlert({ kind: "bt-crank-failed", key: "k", text: "t", meta: null }, DAWN - 1000);
    const r = await runPushCheck({ registry: reg, env: {}, now: DAWN, fetchImpl: s.fetchImpl });
    assert.equal(r.configured, false); assert.equal(s.calls.length, 0); assert.equal(reg.getStatus(PUSH_STATE_KEY), null);
  });
  test("a recorded alert becomes one plain-text POST with the title, priority and bearer token; a second run sends nothing new", async () => {
    const reg = openRegistry(":memory:"); const s = fakeSink();
    reg.recordAlert({ kind: "cosigner-disagree", key: "cosigner-disagree:m:2026-10-20", text: "$DEFICIT 2026-10-20: the second signer did not agree with the keeper's reading, so no reading was sent.", meta: null }, DAWN - 1000);
    const r = await runPushCheck({ registry: reg, env: ENV, now: DAWN, fetchImpl: s.fetchImpl });
    assert.equal(r.sent.length, 1); assert.equal(s.calls.length, 1);
    const c = s.calls[0];
    assert.equal(c.url, ENV.BURNTICKER_PUSH_URL);
    assert.equal(c.headers.authorization, "Bearer tok-secret"); assert.equal(c.headers.title, "Burnticker reading held"); assert.equal(c.headers.priority, "high");
    assert.match(c.headers["content-type"], /^text\/plain/); assert.match(c.body, /\$DEFICIT 2026-10-20/);
    await runPushCheck({ registry: reg, env: ENV, now: DAWN + 60_000, fetchImpl: s.fetchImpl });
    assert.equal(s.calls.length, 1);
  });
  test("a channel that fails is logged, never thrown, and the cursor still advances", async () => {
    const reg = openRegistry(":memory:"); const s = fakeSink(500); const logs: string[] = [];
    reg.recordAlert({ kind: "bt-pin-failed", key: "bt-pin-failed:X", text: "no upload", meta: null }, DAWN - 1000);
    const r = await runPushCheck({ registry: reg, env: ENV, now: DAWN, fetchImpl: s.fetchImpl, log: (l) => logs.push(l) });
    assert.equal(r.failed.length, 1); assert.match(logs.join("\n"), /\[push\] pin-failed not delivered: HTTP 500/);
    assert.doesNotMatch(logs.join("\n"), /tok-secret/);
    assert.ok((JSON.parse(reg.getStatus(PUSH_STATE_KEY)!) as PushState).cursor >= DAWN - 1000);
    const thrown = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    reg.recordAlert({ kind: "bt-crank-failed", key: "c", text: "x", meta: null }, DAWN + 1000);
    await assert.doesNotReject(runPushCheck({ registry: reg, env: ENV, now: DAWN + 2000, fetchImpl: thrown }));
  });
  test("the keeper's startup refusal is recorded and pushed at once", async () => {
    const reg = openRegistry(":memory:"); const s = fakeSink();
    await pushKeeperRefused({ registry: reg, env: ENV, now: DAWN, reason: "the RPC is mainnet: refused unless BURNTICKER_MAINNET=1 (after the audit)", fetchImpl: s.fetchImpl });
    assert.equal(reg.alertsSince(0)[0].kind, "bt-keeper-refused");
    assert.equal(s.calls.length, 1); assert.equal(s.calls[0].headers.title, "Burnticker keeper refused to start");
    assert.match(s.calls[0].body, /The reason given was: the RPC is mainnet/);
  });
  test("the keeper script wires the refusal, the five-minute check and the banner", () => {
    const k = fs.readFileSync(path.join(ROOT, "scripts/burnticker-keeper.mts"), "utf8");
    // 2026-10-15: a stop during the startup wait exits quietly; any other refusal still pushes
    assert.match(k, /await buildProgram\(\)\.catch\(async \(e: unknown\) => \{\n  if \(stopping\) \{[^\n]*process\.exit\(0\); \}\n  if \(!HAND_RUN\) await pushKeeperRefused\(/);   // review 6 of A-1: a hand run prints, the service pushes
    assert.match(k, /await runPushCheck\(\{ registry, env: process[.]env, now, log \}\)/);
  });
});

describe("a refused Arweave pin lands in the alerts table", () => {
  test("bt-pin-failed with the ticker; the launch answer is unchanged", async () => {
    const w = await makeWorld();
    w.p.uploader = new FakePinUploader({ fail: true });
    const rule = nativeRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 }), { fractionOfPool: 0.02 });
    const r = await prepareLaunch(w.p, { creator: CREATOR, ticker: "PINFAIL", name: "Pin Fail", description: "x", rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } }, { register: true, mint: Keypair.generate().publicKey.toBase58() }) as { error: { status: number; body: { code?: string } } };
    assert.equal(r.error.status, 502); assert.equal(r.error.body.code, "pin-failed");
    const a = w.registry.alertsSince(0).find((x) => x.kind === "bt-pin-failed");
    assert.ok(a); assert.equal(a.key, "bt-pin-failed:PINFAIL"); assert.match(a.text, /^\$PINFAIL: the coin's details could not be saved on Arweave/);
  });
});

function run(args: string[], env: Record<string, string>): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("sh", args, { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: os.tmpdir(), NODE_ENV: "test" as const, ...env }, timeout: 60_000 }, (err: Error | null, stdout: string, stderr: string) => resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` }));
  });
}

describe("keeper-status-check.sh: the stale-status push (a local server stands in for the push service)", () => {
  test("stale for more than two hours: one push with the token in a header; no repeat inside two hours; one recovery push", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-push-"));
    const got: { title: string; priority: string; auth: string; body: string }[] = [];
    const srv = http.createServer((q, s) => { let b = ""; q.on("data", (d) => (b += d)); q.on("end", () => { got.push({ title: String(q.headers.title), priority: String(q.headers.priority), auth: String(q.headers.authorization), body: b }); s.end("ok"); }); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/topic`;
      fs.mkdirSync(path.join(dir, "pub/status"), { recursive: true });
      const f = path.join(dir, "pub/status/status.json"); fs.writeFileSync(f, "{}");
      const old = Date.now() / 1000 - 3 * 3600; fs.utimesSync(f, old, old);
      const state = path.join(dir, "state");
      const env = { BURNTICKER_PUSH_URL: url, BURNTICKER_PUSH_TOKEN: "tok-secret-2" };
      const script = path.join(ROOT, "scripts/ops/keeper-status-check.sh");
      let r = await run([script, path.join(dir, "pub"), state], env);
      assert.equal(r.code, 0); assert.doesNotMatch(r.out, /tok-secret-2/);
      assert.equal(got.length, 1);
      assert.equal(got[0].title, "Burnticker keeper is not publishing"); assert.equal(got[0].priority, "high"); assert.equal(got[0].auth, "Bearer tok-secret-2");
      assert.match(got[0].body, /was last written 1\d\d minutes ago\. The keeper has stopped cycling or stopped publishing for more than 2 hours\./);
      r = await run([script, path.join(dir, "pub"), state], env);
      assert.equal(got.length, 1, "no repeat inside two hours");
      fs.writeFileSync(f, "{}");
      r = await run([script, path.join(dir, "pub"), state], env);
      assert.equal(got.length, 2); assert.equal(got[1].title, "Burnticker keeper is back");
      r = await run([script, path.join(dir, "pub"), state], env);
      assert.equal(got.length, 2, "fresh stays quiet");
      // stale for less than two hours: no push
      const recent = Date.now() / 1000 - 1800; fs.utimesSync(f, recent, recent);
      await run([script, path.join(dir, "pub"), state], env);
      assert.equal(got.length, 2);
    } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test("without BURNTICKER_PUSH_URL the script pushes nothing (and still prints its one line)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-push-"));
    try {
      fs.mkdirSync(path.join(dir, "pub/status"), { recursive: true });
      const f = path.join(dir, "pub/status/status.json"); fs.writeFileSync(f, "{}");
      const old = Date.now() / 1000 - 3 * 3600; fs.utimesSync(f, old, old);
      const r = await run([path.join(ROOT, "scripts/ops/keeper-status-check.sh"), path.join(dir, "pub"), path.join(dir, "state")], {});
      assert.equal(r.code, 0); assert.match(r.out, /The keeper has stopped cycling or stopped publishing/);
      assert.equal(fs.existsSync(path.join(dir, "state.pushed")), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
