// BURNTICKER OPERATIONS LAYER (2026-10-09): the ops alerts on a fake (in-memory) registry, the morning-check block, the generated
// refuse list the arms merge with config/own-tokens.json. (The private side — the alert intake and the source-level wiring of the
// keeper loop, check-in and units — is tested in test/btOpsPrivate.test.ts, which is not published.)
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openRegistry, type Registry } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import { feedById } from "@/lib/burnticker/catalogue";
import { pollMsFor } from "@/lib/burnticker/multiKeeper";
import { collectSnapshot, evaluateAlerts, runBurntickerAlertCheck, registryAlertSink, registryAlertRows, CrankFailureTracker, recordBalanceSample, devFeeDelta, readBalanceSample, BALANCES_LATEST_KEY, balancesDayKey, denverDate, denverHour, KEEPER_MIN_LAMPORTS, rpcBalanceLamports, postAlertWebhook, sinkFromEnv, type BurntickerAlert, type BurntickerSnapshot } from "@/lib/burnticker/alerts";
import { burntickerCheckinLines, burntickerCheckin, buildOpsJson, publishOps, fetchOpsLines, OPS_SCHEMA, type OpsJson } from "@/lib/burnticker/checkin";
import { generatedOwnTokens, writeOwnTokensGenerated, OWN_TOKENS_GENERATED_SCHEMA } from "@/lib/burnticker/ownTokensSync";
import { loadOwnTokens, ownTokenRefusalFrom, OWN_TOKEN_REASON, mergeOwnTokenLists, parseOwnTokens } from "@/lib/ownTokens";
import { BRONCOS, DEBT_RULE } from "./burntickerHelpers.ts";

const MINT_A = "Mint1111111111111111111111111111111111111111";
const MINT_B = "Mint2222222222222222222222222222222222222222";
const CREATOR = "CreatorWa11et111111111111111111111111111111";
const ATTESTER = "KeeperDataKey1111111111111111111111111111111";
/** 09:00 Denver (MDT, UTC−6) on 2026-10-09 — after the daily-summary hour. */
const MORNING = Date.parse("2026-10-09T15:00:00Z");
/** 04:00 Denver the same day — before it. */
const NIGHT = Date.parse("2026-10-09T10:00:00Z");
const HOUR = 3_600_000, DAY = 86_400_000;
const EV = { id: "KXNFLGAME-26OCT04DENSF-DEN", at: "2026-10-05T03:30:00Z", result: "yes" as const, value: null, title: "Denver wins", sourceUrl: "https://api.elections.kalshi.com/x" };

let reg: Registry, site: string;
function tmpDir(prefix: string): string { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function launch(rule: unknown, ticker: string, mint: string, createdAt: number, baselineAt = "2026-10-01T00:00:00Z") {
  const locked = lockRule(rule);
  const t = reg.register({ mint, ticker, name: `${ticker} coin`, creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: locked.text, feePda: `Fee${ticker}`, vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt, status: "draft" }, createdAt);
  reg.markLaunched(t.mint, `launch-${ticker}`, null, baselineAt);
  reg.addAttester({ mint, pubkey: ATTESTER, role: "data-key", addedAt: createdAt, timelockUntil: null });
  return reg.token(mint)!;
}
/** A planned receipt for EV on `mint` (binary YES, 2% of the pool). */
function planReceipt(mint: string, now: number) {
  assert.ok(reg.applyStep(mint, EV, { units: 1, mapping: { fractionOfPool: 0.02 }, kind: "yes", note: "YES → 2% of the pool", carryOut: "0", baseline: null }, { value: null, carryOut: "0" }, false, now));
}
function writeStatus(ticker: string, pool: { feePdaSol: string | null; queuedSol: string | null }) {
  fs.mkdirSync(path.join(site, "t", ticker), { recursive: true });
  fs.writeFileSync(path.join(site, "t", ticker, "status.json"), JSON.stringify({ schema: "burnticker.token-status/v1", pool }));
}
function writeAudit(ok: boolean, ranAt: number, mismatches: { ticker: string; eventId: string; checks: string[] }[] = []) {
  fs.writeFileSync(path.join(site, "audit.json"), JSON.stringify({ schema: "burnticker.audit/v1", ranAt: new Date(ranAt).toISOString(), tokens: 1, receipts: 1, mismatches, chainChecked: false, ok }));
}
const kinds = (xs: BurntickerAlert[]) => xs.map((a) => a.kind).sort();
const snap = (now: number, extra: Partial<Parameters<typeof collectSnapshot>[0]> = {}): BurntickerSnapshot => collectSnapshot({ registry: reg, siteDir: site, now, ...extra });

beforeEach(() => { reg = openRegistry(":memory:"); site = tmpDir("bt-site-"); });

describe("clock helpers", () => {
  test("Denver date and hour", () => {
    assert.equal(denverDate(MORNING), "2026-10-09"); assert.equal(denverHour(MORNING), 9);
    assert.equal(denverDate(NIGHT), "2026-10-09"); assert.equal(denverHour(NIGHT), 4);
    assert.equal(denverDate(Date.parse("2026-10-10T05:30:00Z")), "2026-10-09", "23:30 Denver is still the 9th");
  });
  test("cadence: Kalshi 5 min, a catalogue feed its pollEverySec", () => {
    assert.equal(pollMsFor({}, lockRule(BRONCOS).rule), 5 * 60_000);
    assert.equal(pollMsFor({}, lockRule(DEBT_RULE).rule), feedById("treasury.debt")!.pollEverySec * 1000);
  });
});

describe("evaluateAlerts on a fake registry", () => {
  test("an empty registry raises nothing before 07:00 Denver, and only the daily line after it", () => {
    assert.deepEqual(evaluateAlerts(snap(NIGHT)), []);
    const a = evaluateAlerts(snap(MORNING));
    assert.deepEqual(kinds(a), ["bt-daily-summary"]);
    assert.equal(a[0].key, "bt-daily-summary:2026-10-09");
    assert.match(a[0].text, /^Burnticker 2026-10-09: 0 tokens, 0 burns \(24 h\), pools 0\.000 SOL, dev fees unknown SOL$/);
  });
  test("feed stall: a live token whose key was never fetched for > 2× cadence; quiet when fetched recently, paused, or young", () => {
    launch(BRONCOS, "BRONCO", MINT_A, NIGHT - DAY, "2026-10-08T00:00:00Z");
    reg.setStatus("lastCycle", { at: NIGHT - 60_000, errors: [], refusals: [] });
    let a = evaluateAlerts(snap(NIGHT));
    assert.deepEqual(kinds(a), ["bt-audit-stale", "bt-feed-stall"]);
    assert.equal(a.find((x) => x.kind === "bt-feed-stall")!.key, "bt-feed-stall:kalshi:KXNFLGAME:binary");
    assert.match(a.find((x) => x.kind === "bt-feed-stall")!.text, /not fetched for \d+ min \(cadence 5 min, limit 10 min\)/);
    writeAudit(true, NIGHT - HOUR);
    reg.setFeedState({ selectorKey: "kalshi:KXNFLGAME:binary", lastFetchAt: NIGHT - 4 * 60_000, lastOkAt: NIGHT - 4 * 60_000, failures: 0, lastError: null, nextFetchAt: NIGHT + 60_000 });
    assert.deepEqual(evaluateAlerts(snap(NIGHT)), [], "fetched 4 min ago on a 5 min cadence");
    reg.setFeedState({ selectorKey: "kalshi:KXNFLGAME:binary", lastFetchAt: NIGHT - 30 * 60_000, lastOkAt: NIGHT - 2 * HOUR, failures: 4, lastError: "HTTP 503", nextFetchAt: NIGHT + HOUR });
    a = evaluateAlerts(snap(NIGHT));
    assert.deepEqual(kinds(a), ["bt-feed-stall"]);
    assert.match(a[0].text, /30 min .* The last error was: HTTP 503\. It has failed 4 times in a row\./);
    assert.deepEqual(evaluateAlerts(snap(NIGHT, { paused: true })), [], "PAUSE present: no stall alarm");
    // A token live for less than the limit is not stalled yet (its liveSince anchors the clock).
    const reg2 = openRegistry(":memory:"); reg = reg2;
    launch(BRONCOS, "YOUNG", MINT_B, NIGHT - 60_000, new Date(NIGHT - 60_000).toISOString());
    writeAudit(true, NIGHT - HOUR);
    assert.deepEqual(evaluateAlerts(snap(NIGHT)), []);
  });
  test("a changed oracle result (the registry held the key) and the last cycle's refusals", () => {
    launch(BRONCOS, "BRONCO", MINT_A, NIGHT - DAY);
    writeAudit(true, NIGHT - HOUR);
    reg.setFeedState({ selectorKey: "kalshi:KXNFLGAME:binary", lastFetchAt: NIGHT - 60_000, lastOkAt: NIGHT - DAY, failures: 2, lastError: "registry: kalshi:KXNFLGAME:binary X already recorded as yes, the oracle now says no — holding", nextFetchAt: NIGHT + 60_000 });
    reg.setStatus("lastCycle", { at: NIGHT - 60_000, errors: [], refusals: ["treasury.debt 2026-10-08: 99 outside plausibility bounds [1e13, 1e14]", "treasury.debt 2026-10-08: 99 outside plausibility bounds [1e13, 1e14]"] });
    const a = evaluateAlerts(snap(NIGHT));
    assert.deepEqual(kinds(a), ["bt-reading-conflict", "bt-reading-implausible", "bt-reading-implausible"]);
    assert.equal(new Set(a.filter((x) => x.kind === "bt-reading-implausible").map((x) => x.key)).size, 1, "the same refusal text keys once (the sink dedupes per day)");
    assert.match(a.find((x) => x.kind === "bt-reading-conflict")!.text, /HELD until someone looks/);
  });
  test("crank failures: ≥ 3 recorded attempts with an error, or an in-process streak of 3; a confirmed outcome clears the streak", () => {
    launch(BRONCOS, "BRONCO", MINT_A, NIGHT - DAY);
    writeAudit(true, NIGHT - HOUR);
    reg.setFeedState({ selectorKey: "kalshi:KXNFLGAME:binary", lastFetchAt: NIGHT - 60_000, lastOkAt: NIGHT - 60_000, failures: 0, lastError: null, nextFetchAt: NIGHT + 60_000 });
    planReceipt(MINT_A, NIGHT - HOUR);
    reg.noteError(MINT_A, EV.id, "simulation refused: custom program error 0x1", NIGHT + 60_000, NIGHT);
    assert.deepEqual(evaluateAlerts(snap(NIGHT)), [], "one failure is not an alarm");
    const tracker = new CrankFailureTracker();
    const err = { fetched: [], planned: [], errors: [], executed: [{ mint: MINT_A, eventId: EV.id, outcome: "error" as const, why: "simulation refused" }] };
    tracker.note(err); tracker.note(err);
    assert.deepEqual(evaluateAlerts(snap(NIGHT, { crankStreaks: tracker.snapshot() })), [], "two in a row");
    tracker.note(err);
    let a = evaluateAlerts(snap(NIGHT, { crankStreaks: tracker.snapshot() }));
    assert.deepEqual(kinds(a), ["bt-crank-failed"]);
    assert.equal(a[0].key, `bt-crank-failed:${MINT_A}:${EV.id}`);
    assert.match(a[0].text, /failed 3× in a row \(planned\): simulation refused/);
    tracker.note({ ...err, executed: [{ mint: MINT_A, eventId: EV.id, outcome: "confirmed", signature: "s", burnRaw: BigInt(1), adopted: false }] });
    assert.deepEqual(tracker.snapshot(), {});
    // The persisted path: three write-ahead signatures (attempts = 3) and an error on the row.
    for (const s of ["sigA", "sigB", "sigC"]) { reg.recordSignature({ signature: s, mint: MINT_A, eventId: EV.id, memo: "m", burnRaw: BigInt(0), spendLamports: BigInt(1), blockhash: "b", lastValidBlockHeight: 1, sentAt: NIGHT }); reg.setSignatureStatus(s, "failed", "x", null); reg.setReceiptStatus(MINT_A, EV.id, "planned"); }
    reg.noteError(MINT_A, EV.id, "crank failed on chain: x", NIGHT + 60_000, NIGHT);
    a = evaluateAlerts(snap(NIGHT));
    assert.deepEqual(kinds(a), ["bt-crank-failed"]);
    assert.match(a[0].text, /failed 3× in a row/);
  });
  test("the audit: a mismatch, a stale run, never run; nothing when no token is live", () => {
    assert.deepEqual(evaluateAlerts(snap(NIGHT)), [], "no live token → no audit expectation");
    launch(BRONCOS, "BRONCO", MINT_A, NIGHT - DAY);
    reg.setFeedState({ selectorKey: "kalshi:KXNFLGAME:binary", lastFetchAt: NIGHT - 60_000, lastOkAt: NIGHT - 60_000, failures: 0, lastError: null, nextFetchAt: NIGHT + 60_000 });
    let a = evaluateAlerts(snap(NIGHT));
    assert.deepEqual(kinds(a), ["bt-audit-stale"]); assert.match(a[0].text, /has never run/);
    writeAudit(true, NIGHT - 4 * HOUR);
    a = evaluateAlerts(snap(NIGHT)); assert.match(a[0].text, /last ran 4 h ago/);
    writeAudit(false, NIGHT - HOUR, [{ ticker: "BRONCO", eventId: EV.id, checks: ["units: row 2 ≠ recomputed 1"] }]);
    a = evaluateAlerts(snap(NIGHT));
    assert.deepEqual(kinds(a), ["bt-audit-mismatch"]);
    assert.match(a[0].text, /AUDIT MISMATCH .*1 receipt does not recompute — \$BRONCO KXNFLGAME-26OCT04DENSF-DEN: units: row 2 ≠ recomputed 1/);
  });
  test("the keeper key under 0.05 SOL, the pre-audit cap binding (from the published status.json), a stale keeper", () => {
    launch(BRONCOS, "BRONCO", MINT_A, NIGHT - DAY);
    writeAudit(true, NIGHT - HOUR);
    reg.setFeedState({ selectorKey: "kalshi:KXNFLGAME:binary", lastFetchAt: NIGHT - 60_000, lastOkAt: NIGHT - 60_000, failures: 0, lastError: null, nextFetchAt: NIGHT + 60_000 });
    assert.deepEqual(evaluateAlerts(snap(NIGHT, { balances: { at: NIGHT, keeperLamports: null, devFeeLamports: null } })), [], "unknown balance is not an alarm");
    assert.deepEqual(evaluateAlerts(snap(NIGHT, { balances: { at: NIGHT, keeperLamports: KEEPER_MIN_LAMPORTS, devFeeLamports: null } })), [], "exactly 0.05 is fine");
    let a = evaluateAlerts(snap(NIGHT, { balances: { at: NIGHT, keeperLamports: KEEPER_MIN_LAMPORTS - BigInt(1), devFeeLamports: null } }));
    assert.deepEqual(kinds(a), ["bt-keeper-balance-low"]); assert.match(a[0].text, /holds 0\.050 SOL \(< 0\.05\)/);
    writeStatus("BRONCO", { feePdaSol: "27.5", queuedSol: "2.48" });
    a = evaluateAlerts(snap(NIGHT));
    assert.deepEqual(kinds(a), ["bt-cap-binding"]); assert.match(a[0].text, /2\.48 SOL above the 25 SOL pre-audit cap is queued \(pool 27\.5 SOL\)/);
    writeStatus("BRONCO", { feePdaSol: "3.1", queuedSol: "0" });
    assert.deepEqual(evaluateAlerts(snap(NIGHT)), []);
    reg.setStatus("lastCycle", { at: NIGHT - 11 * 60_000, errors: [], refusals: [] });
    a = evaluateAlerts(snap(NIGHT));
    assert.deepEqual(kinds(a), ["bt-keeper-stale"]); assert.match(a[0].text, /no cycle for 11 min/);
    assert.deepEqual(evaluateAlerts(snap(NIGHT, { paused: true })), [], "paused: the keeper may be stopped on purpose");
  });
  test("the daily line counts live tokens, 24 h burns, published pools and the dev-fee balance", () => {
    launch(BRONCOS, "BRONCO", MINT_A, MORNING - DAY);
    launch(DEBT_RULE, "DEBTY", MINT_B, MORNING - DAY);
    writeAudit(true, MORNING - HOUR);
    for (const k of ["kalshi:KXNFLGAME:binary", "catalogue:treasury.debt"]) reg.setFeedState({ selectorKey: k, lastFetchAt: MORNING - 60_000, lastOkAt: MORNING - 60_000, failures: 0, lastError: null, nextFetchAt: MORNING + HOUR });
    writeStatus("BRONCO", { feePdaSol: "4.25", queuedSol: "0" }); writeStatus("DEBTY", { feePdaSol: "1.5", queuedSol: "0" });
    planReceipt(MINT_A, MORNING - 2 * HOUR);
    reg.fixPlan(MINT_A, EV.id, { poolLamports: BigInt(4_250_000_000), spendLamports: BigInt(85_000_000), solUsd: 150, vaultRaw: null, shortInRaw: null, shortOutRaw: null, burnRaw: null, memo: "BT|BRONCO|x|v3" }, MORNING - 2 * HOUR);
    reg.markConfirmed(MINT_A, EV.id, { signature: "sig1", slot: 1, spentLamports: BigInt(85_000_000), gotRaw: BigInt(10), burnRaw: BigInt(10), memo: "BT|BRONCO|x|v3" }, MORNING - HOUR);
    const a = evaluateAlerts(snap(MORNING, { balances: { at: MORNING, keeperLamports: BigInt(1e9), devFeeLamports: BigInt(12_345_000_000) } }));
    assert.deepEqual(kinds(a), ["bt-daily-summary"]);
    assert.equal(a[0].text, "Burnticker 2026-10-09: 2 tokens, 1 burn (24 h), pools 5.750 SOL, dev fees 12.345 SOL");
  });
});

describe("runBurntickerAlertCheck through an injected sink", () => {
  test("raises each alert once through the sink; a null (deduped) answer or a throw is not counted and never breaks the check", async () => {
    launch(BRONCOS, "BRONCO", MINT_A, NIGHT - DAY);
    const sent: { kind: string; key: string; now: number }[] = [];
    let r = await runBurntickerAlertCheck({ registry: reg, siteDir: site, now: NIGHT, sink: async (kind, key, _t, _m, now) => { sent.push({ kind, key, now }); return { id: 1 }; } });
    assert.deepEqual(kinds(r.alerts), ["bt-audit-stale", "bt-feed-stall"]); assert.equal(r.raised.length, 2); assert.equal(sent.length, 2); assert.equal(sent[0].now, NIGHT);
    r = await runBurntickerAlertCheck({ registry: reg, siteDir: site, now: NIGHT, sink: async () => null });
    assert.equal(r.alerts.length, 2); assert.equal(r.raised.length, 0, "the sink said: already raised today");
    r = await runBurntickerAlertCheck({ registry: reg, siteDir: site, now: NIGHT, sink: async () => { throw new Error("telegram down"); } });
    assert.equal(r.raised.length, 0);
  });
  test("balance samples: latest + first-of-day; the dev-fee delta anchors on yesterday's first sample", () => {
    recordBalanceSample(reg, { at: NIGHT - DAY, keeperLamports: BigInt(2e8), devFeeLamports: BigInt(10e9) });
    recordBalanceSample(reg, { at: NIGHT - DAY + HOUR, keeperLamports: BigInt(2e8), devFeeLamports: BigInt(10.5e9) });
    recordBalanceSample(reg, { at: NIGHT, keeperLamports: BigInt(1.9e8), devFeeLamports: BigInt(11e9) });
    assert.equal(readBalanceSample(reg, balancesDayKey(NIGHT - DAY))!.devFeeLamports, BigInt(10e9), "the day key keeps the FIRST sample");
    assert.equal(readBalanceSample(reg, BALANCES_LATEST_KEY)!.keeperLamports, BigInt(1.9e8));
    const d = devFeeDelta(reg, NIGHT);
    assert.equal(d.deltaLamports, BigInt(1e9)); assert.equal(d.anchor!.at, NIGHT - DAY);
    const reg2 = openRegistry(":memory:");
    assert.equal(devFeeDelta(reg2, NIGHT).deltaLamports, null);
    recordBalanceSample(reg2, { at: NIGHT, keeperLamports: null, devFeeLamports: null });
    assert.equal(devFeeDelta(reg2, NIGHT).deltaLamports, null, "unknown balances give no delta");
  });
  test("rpcBalanceLamports: plain JSON-RPC getBalance; any failure is null, never a throw", async () => {
    const calls: string[] = [];
    const ok = (async (url: string, init?: RequestInit) => { calls.push(String(init?.body)); return new Response(JSON.stringify({ jsonrpc: "2.0", result: { context: { slot: 1 }, value: 123456789 }, id: 1 })); }) as unknown as typeof fetch;
    assert.equal(await rpcBalanceLamports("https://rpc.example", ATTESTER, ok), BigInt(123456789));
    assert.match(calls[0], /"method":"getBalance"/); assert.ok(calls[0].includes(ATTESTER));
    assert.equal(await rpcBalanceLamports("https://rpc.example", ATTESTER, (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch), null);
    assert.equal(await rpcBalanceLamports("https://rpc.example", ATTESTER, (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch), null);
  });
});

describe("the morning check's Burnticker block", () => {
  test("no registry on the host → one honest line that says how to read the keeper's block from another host", () => {
    assert.deepEqual(burntickerCheckinLines({ snapshot: null, delta: null, alerts: null, firstLaunchAt: null }), ["- burnticker: no registry on this host (data/burnticker.db absent) and BURNTICKER_OPS_URL unset — set it to https://<burnticker host>/ops.json to read the keeper's block from here"]);
  });
  test("ops.json: the block as the keeper publishes it; fetched from another host it renders with its age, and says when it is stale, missing or wrong", async () => {
    launch(BRONCOS, "BRONCO", MINT_A, MORNING - DAY);
    writeAudit(true, MORNING - HOUR);
    reg.setFeedState({ selectorKey: "kalshi:KXNFLGAME:binary", lastFetchAt: MORNING - 60_000, lastOkAt: MORNING - 60_000, failures: 0, lastError: null, nextFetchAt: MORNING + HOUR });
    const ops = buildOpsJson({ now: MORNING, snapshot: snap(MORNING), delta: devFeeDelta(reg, MORNING), alerts: [], firstLaunchAt: MORNING - DAY, webhook: { configured: true, lastAttemptAt: MORNING - HOUR, lastOkAt: null, lastError: "HTTP 503" } });
    assert.equal(ops.schema, OPS_SCHEMA); assert.deepEqual(ops.conditions, []); assert.match(ops.lines.join("\n"), /^- alert webhook: FAILING \(HTTP 503\)$/m);
    publishOps(site, ops);
    const published = JSON.parse(fs.readFileSync(path.join(site, "ops.json"), "utf8")) as OpsJson;
    assert.equal(published.lines.length, ops.lines.length);
    const served = (async () => new Response(JSON.stringify(published), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const lines = (await fetchOpsLines("https://burnticker.com/ops.json", MORNING + 3 * 60_000, served))!;
    assert.equal(lines[0], "- source: https://burnticker.com/ops.json · generated 3 min ago"); assert.deepEqual(lines.slice(1), ops.lines);
    assert.match((await fetchOpsLines("https://x/ops.json", MORNING + HOUR, served))![0], /STALE/);
    assert.match((await fetchOpsLines("https://x/ops.json", MORNING, (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch))![0], /HTTP 404/);
    assert.match((await fetchOpsLines("https://x/ops.json", MORNING, (async () => new Response("{}")) as unknown as typeof fetch))![0], /not a burnticker\.ops\/v1/);
    assert.match((await fetchOpsLines("https://x/ops.json", MORNING, (async () => { throw new Error("ENOTFOUND"); }) as unknown as typeof fetch))![0], /unreachable \(ENOTFOUND\)/);
    // The host without a registry reads the remote block when BURNTICKER_OPS_URL is given.
    const dir = tmpDir("bt-remote-");
    const viaUrl = await burntickerCheckin({ now: MORNING + 60_000, registryFile: path.join(dir, "none.db"), siteDir: site, opsUrl: "https://burnticker.com/ops.json", fetchImpl: served });
    assert.match(viaUrl[0], /^- source: https:\/\/burnticker\.com\/ops\.json · generated 1 min ago$/);
  });
  test("the lines: tokens, burns, cranks, pools/queued, attesters, audit, dev fee delta, keeper, feeds, conditions, bt- alerts", () => {
    launch(BRONCOS, "BRONCO", MINT_A, MORNING - 2 * DAY, "2026-10-07T00:00:00Z");
    writeAudit(true, MORNING - 30 * 60_000);
    reg.setFeedState({ selectorKey: "kalshi:KXNFLGAME:binary", lastFetchAt: MORNING - 60_000, lastOkAt: MORNING - 2 * 60_000, failures: 0, lastError: null, nextFetchAt: MORNING + HOUR });
    writeStatus("BRONCO", { feePdaSol: "26.0", queuedSol: "1.0" });
    planReceipt(MINT_A, MORNING - 2 * HOUR);
    reg.noteError(MINT_A, EV.id, "RPC/program error: timeout", MORNING + 60_000, MORNING);
    reg.setStatus("lastCycle", { at: MORNING - 60_000, errors: ["$BRONCO: execute: timeout"], refusals: [] });
    recordBalanceSample(reg, { at: MORNING - DAY, keeperLamports: BigInt(3e8), devFeeLamports: BigInt(2e9) });
    recordBalanceSample(reg, { at: MORNING, keeperLamports: BigInt(2.5e8), devFeeLamports: BigInt(2.75e9) });
    const lines = burntickerCheckinLines({ snapshot: snap(MORNING, { crankStreaks: { [`${MINT_A}:${EV.id}`]: 2 } }), delta: devFeeDelta(reg, MORNING), firstLaunchAt: Date.parse("2026-10-07T00:00:00Z"),
      alerts: [{ ts: MORNING - HOUR, kind: "bt-cap-binding", text: "Burnticker $BRONCO: 1.0 SOL above the cap", seenAt: null, sent: false }, { ts: MORNING - HOUR, kind: "evm-unknown-tx", text: "not ours", seenAt: null, sent: true }, { ts: MORNING - 2 * DAY, kind: "bt-feed-stall", text: "old", seenAt: 1, sent: true }] });
    const text = lines.join("\n");
    assert.match(text, /^- tokens: 1 live \(\$BRONCO\) · 0 draft · 0 paused\/retired$/m);
    assert.match(text, /^- burns last 24 h: 0 \(0\.0000 SOL spent\) · all time 0 · per token: \$BRONCO 0\/0$/m);
    assert.match(text, /^- cranks: 1 pending · 1 failing — \$BRONCO KXNFLGAME-26OCT04DENSF-DEN ×2 \(RPC\/program error: timeout\)$/m);
    assert.match(text, /^- pools: 26\.000 SOL across 1 fee PDA\(s\) · queued above the pre-audit cap: \$BRONCO 1\.0 SOL$/m);
    assert.match(text, /^- attesters: \$BRONCO 1 active \(0 independent\) quorum 1 · One operator attester is configured; no independent second attester is live\. Quorum 1\. \(owner check: a second attester was due by 2026-10-21\)$/m);
    assert.match(text, /^- audit badge: OK — every recorded receipt recomputes · 1 receipt\(s\)(, \d+ executed on chain)? · source only · ran 30 min ago$/m);
    assert.match(text, /^- dev fee wallet: 2\.750 SOL \(sampled 0 min ago\) · Δ \+0\.7500 SOL since 2026-10-08T15:00Z$/m);
    assert.match(text, /^- keeper: last cycle 1 min ago · errors: \$BRONCO: execute: timeout · key balance 0\.250 SOL$/m);
    assert.match(text, /^- feeds: kalshi:KXNFLGAME:binary ok 2 min ago$/m);
    assert.match(text, /^- conditions now: bt-cap-binding$/m);
    assert.match(text, /^- bt- alerts last 24 h: 2$/m, "the non-bt alert is left to the Money section; the old bt- row is outside the window the caller passed");
    assert.match(text, /\[bt-cap-binding\] Burnticker \$BRONCO: 1\.0 SOL above the cap · UNSEEN$/m);
  });
  test("burntickerCheckin on a host: no db file → the one line (and the file is NOT created); a db → the block, registry closed after", async () => {
    const dir = tmpDir("bt-host-");
    const file = path.join(dir, "burnticker.db");
    const lines = await burntickerCheckin({ now: MORNING, registryFile: file, siteDir: site, readAlerts: null });
    assert.equal(lines.length, 1); assert.match(lines[0], /no registry on this host/);
    assert.equal(fs.existsSync(file), false, "the check-in never creates the registry");
    const r = openRegistry(file); reg = r; launch(BRONCOS, "BRONCO", MINT_A, MORNING - DAY); r.close();
    fs.writeFileSync(path.join(dir, "PAUSE-burnticker"), "");
    const l2 = await burntickerCheckin({ now: MORNING, registryFile: file, siteDir: site, readAlerts: () => [] });
    assert.match(l2[0], /^- tokens: 1 live \(\$BRONCO\) · 0 draft · 0 paused\/retired · PAUSE-burnticker PRESENT: cranks held$/);
    assert.match(l2.join("\n"), /bt- alerts last 24 h: 0/);
    const l3 = await burntickerCheckin({ now: MORNING, registryFile: file, siteDir: site, readAlerts: () => { throw new Error("no table"); } });
    assert.match(l3.join("\n"), /bt- alerts last 24 h: unavailable/);
  });
});

describe("the generated refuse list (platform coins → the arms, without the arms opening the registry)", () => {
  test("generatedOwnTokens: every registered token, drafts as planned, in registration order", () => {
    const locked = lockRule(BRONCOS);
    reg.register({ mint: MINT_B, ticker: "LATER", name: "n", creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: locked.text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2026-10-01T00:00:00Z", status: "draft" }, NIGHT + 1);
    launch(BRONCOS, "BRONCO", MINT_A, NIGHT);
    const g = generatedOwnTokens(reg.tokens());
    assert.deepEqual(g.map((e) => [e.symbol, e.chain, e.address, e.status]), [["BRONCO", "solana", MINT_A, "launched"], ["LATER", "solana", MINT_B, "planned"]]);
    assert.doesNotThrow(() => parseOwnTokens({ policy: "p", tokens: g }), "the generated entries parse under the static file's rules");
  });
  test("writeOwnTokensGenerated writes once per change (mtime stable otherwise) and loadOwnTokens merges it with the static file", () => {
    const dir = tmpDir("bt-own-");
    const gen = path.join(dir, "own-tokens.generated.json"), stat = path.join(dir, "own-tokens.json");
    fs.writeFileSync(stat, JSON.stringify({ policy: "p", tokens: [{ symbol: "DEFICIT", chain: "solana", address: null, status: "planned" }] }));
    let w = writeOwnTokensGenerated(reg, gen, NIGHT);
    assert.deepEqual([w.changed, w.count], [true, 0]);
    const j = JSON.parse(fs.readFileSync(gen, "utf8")) as { schema: string; tokens: unknown[]; policy: string };
    assert.equal(j.schema, OWN_TOKENS_GENERATED_SCHEMA); assert.deepEqual(j.tokens, []); assert.match(j.policy, /GENERATED by the burnticker keeper/);
    assert.equal(writeOwnTokensGenerated(reg, gen, NIGHT + 1).changed, false, "no registry change → no write");
    const m1 = fs.statSync(gen).mtimeMs;
    launch(BRONCOS, "BRONCO", MINT_A, NIGHT);
    w = writeOwnTokensGenerated(reg, gen, NIGHT + 2);
    assert.deepEqual([w.changed, w.count], [true, 1]);
    assert.ok(fs.statSync(gen).mtimeMs >= m1);
    assert.ok(!fs.readdirSync(dir).some((f) => f.includes(".tmp-")), "atomic: no temp file left behind");
    // The arms' view.
    const list = loadOwnTokens(stat, gen);
    assert.equal(list.error, null);
    assert.equal(ownTokenRefusalFrom(list, { address: MINT_A, symbol: "WHATEVER" }), OWN_TOKEN_REASON, "refused by the platform mint");
    assert.equal(ownTokenRefusalFrom(list, { address: "Other", symbol: "$bronco" }), OWN_TOKEN_REASON, "refused by the platform ticker");
    assert.equal(ownTokenRefusalFrom(list, { address: "Other", symbol: "DEFICIT" }), OWN_TOKEN_REASON, "the static file still rules");
    assert.equal(ownTokenRefusalFrom(list, { address: "Other", symbol: "BONK" }), null);
    // The generated file is picked up when it changes (a later registration), without a restart.
    launch(BRONCOS, "SECOND", MINT_B, NIGHT + 5);
    writeOwnTokensGenerated(reg, gen, NIGHT + 6);
    const t = new Date(Date.now() + 5_000); fs.utimesSync(gen, t, t);
    assert.equal(ownTokenRefusalFrom(loadOwnTokens(stat, gen), { address: MINT_B, symbol: "x" }), OWN_TOKEN_REASON);
    // A missing generated file is simply "no platform coin yet"; a broken one fails closed and names itself.
    assert.equal(loadOwnTokens(stat, path.join(dir, "absent.json")).error, null);
    fs.writeFileSync(gen, "{ broken"); const t2 = new Date(Date.now() + 10_000); fs.utimesSync(gen, t2, t2);
    const broken = loadOwnTokens(stat, gen);
    assert.match(broken.error!, /^own-tokens\.generated\.json: /);
    assert.match(ownTokenRefusalFrom(broken, { symbol: "BONK" })!, /every entry held until it is fixed: own-tokens\.generated\.json/);
    fs.writeFileSync(gen, JSON.stringify({ tokens: [{ symbol: "A", chain: "eth", address: null, status: "planned" }] })); const t3 = new Date(Date.now() + 15_000); fs.utimesSync(gen, t3, t3);
    assert.match(loadOwnTokens(stat, gen).error!, /^own-tokens\.generated\.json: tokens\[0\]\.chain/);
    // The static file's own errors keep their original wording (the existing test's contract).
    fs.writeFileSync(stat, "{ broken"); const t4 = new Date(Date.now() + 20_000); fs.utimesSync(stat, t4, t4);
    assert.match(loadOwnTokens(stat, path.join(dir, "absent.json")).error!, /^own-tokens\.json: /);
  });
  test("mergeOwnTokenLists unions and keeps the static error first", () => {
    const a = { addresses: new Set(["A"]), symbols: new Set(["X"]), error: "static broke" }, b = { addresses: new Set(["B"]), symbols: new Set(["Y"]), error: "gen broke" };
    const m = mergeOwnTokenLists(a, b);
    assert.deepEqual([...m.addresses], ["A", "B"]); assert.deepEqual([...m.symbols], ["X", "Y"]); assert.equal(m.error, "static broke");
    assert.equal(mergeOwnTokenLists({ ...a, error: null }, b).error, "gen broke");
  });
});

describe("cross-host delivery: the webhook sink (the intake end is the operator's private app, tested there)", () => {
  test("postAlertWebhook: JSON + bearer; non-2xx and network failures come back as outcomes, never throws", async () => {
    const seen: { url: string; auth: string | null; origin: string | null; body: Record<string, unknown> }[] = [];
    const ok = (async (url: string, init?: RequestInit) => { const h = init?.headers as Record<string, string>; seen.push({ url, auth: h.authorization ?? null, origin: h.origin ?? null, body: JSON.parse(String(init?.body)) }); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const r = await postAlertWebhook("https://ops.example:3001/alerts/intake", "test-token", { kind: "bt-test", key: "k", text: "t", meta: { a: 1 }, ts: NIGHT }, ok);
    assert.deepEqual(r, { ok: true, status: 200, error: null });
    assert.equal(seen[0].auth, "Bearer test-token"); assert.deepEqual(seen[0].body, { source: "burnticker", kind: "bt-test", key: "k", text: "t", meta: { a: 1 }, ts: NIGHT });
    assert.equal(seen[0].origin, "https://ops.example:3001", "an Origin equal to the address called, as the runners send (requireOwnerAction's same-origin check)");
    assert.deepEqual(await postAlertWebhook("https://x", null, { kind: "bt-test", key: "k", text: "t", meta: null, ts: NIGHT }, (async () => new Response("", { status: 503 })) as unknown as typeof fetch), { ok: false, status: 503, error: "HTTP 503" });
    const down = await postAlertWebhook("https://x", null, { kind: "bt-test", key: "k", text: "t", meta: null, ts: NIGHT }, (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch);
    assert.equal(down.ok, false); assert.match(down.error!, /ECONNREFUSED/);
  });
  test("sinkFromEnv: local first (dedupe), then the webhook only for NEW alerts; state records the last failure; unset = local only", async () => {
    const posted: string[] = []; const logs: string[] = [];
    let localAnswer: unknown = { id: 1 };
    const local = async () => localAnswer;
    const env = { BURNTICKER_ALERT_WEBHOOK: "https://hook", BURNTICKER_ALERT_WEBHOOK_TOKEN: "tok" };
    let fail = false;
    const f = (async (_u: string, init?: RequestInit) => { posted.push(JSON.parse(String(init?.body)).key); return new Response("", { status: fail ? 502 : 200 }); }) as unknown as typeof fetch;
    const { sink, state } = sinkFromEnv(env, { local, fetchImpl: f, log: (s) => logs.push(s) });
    assert.equal(state.configured, true);
    assert.ok(await sink("bt-x", "k1", "t", null, NIGHT)); assert.deepEqual(posted, ["k1"]); assert.equal(state.lastOkAt, NIGHT); assert.equal(state.lastError, null);
    localAnswer = null;   // already raised today → nothing forwarded
    assert.equal(await sink("bt-x", "k1", "t", null, NIGHT + 1), null); assert.deepEqual(posted, ["k1"]);
    localAnswer = { id: 2 }; fail = true;
    assert.ok(await sink("bt-x", "k2", "t", null, NIGHT + 2)); assert.deepEqual(posted, ["k1", "k2"]); assert.equal(state.lastError, "HTTP 502"); assert.match(logs[0], /webhook HTTP 502: bt-x k2 stays local only/);
    const off = sinkFromEnv({}, { local, fetchImpl: f });
    assert.equal(off.state.configured, false); assert.ok(await off.sink("bt-x", "k3", "t", null, NIGHT)); assert.deepEqual(posted, ["k1", "k2"], "no webhook configured: local only");
  });
});

describe("the keeper's local alert record (the registry's alerts table)", () => {
  test("registryAlertSink: one row per key per Denver day (null when deduped), append-only; rows feed the check-in block", async () => {
    const r = openRegistry(":memory:");
    const sink = registryAlertSink(r);
    assert.ok(await sink("bt-feed-stall", "bt-feed-stall:k", "stalled", { a: 1 }, MORNING));
    assert.equal(await sink("bt-feed-stall", "bt-feed-stall:k", "stalled again", null, MORNING + HOUR), null, "same key, same Denver day");
    assert.ok(await sink("bt-feed-stall", "bt-feed-stall:k", "next day", null, MORNING + DAY));
    assert.deepEqual(registryAlertRows(r, MORNING + DAY + 1).map((a) => a.text), ["next day"], "the last 24 h only");
    assert.deepEqual(registryAlertRows(r, MORNING + DAY - 1).map((a) => a.text), ["next day", "stalled"]);
    assert.throws(() => r.db.prepare("DELETE FROM alerts").run(), /append-only/);
    assert.throws(() => r.db.prepare("UPDATE alerts SET text='x'").run(), /append-only/);
    const { sink: s2 } = sinkFromEnv({}, { local: sink });
    assert.ok(await s2("bt-x", "k9", "t", null, MORNING));
  });
});
