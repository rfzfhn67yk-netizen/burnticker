// BURNTICKER TRUST OPS (owner-approved 2026-10-10 night): the daily registry snapshot pinned to Arweave (fake Irys) and its verifier,
// GET /v1/snapshots, the daily post's snapshot line, feed health (down / disagree / stale), status/status.json and the static status page
// rendered from a fixture, the leader/standby role + signed takeover notes, the foreign-reading fence (two keepers on one chain), the
// source-outage drill, bring-your-own-attester tooling, the trust page's trust-ops section, and the static fallback page.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { openRegistry, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, buildPairBundles, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { DEFAULT_ON_END, lockRule } from "@/lib/burnticker/rules";
import { CatalogueAdapter, feedById, loadFixture } from "@/lib/burnticker/catalogue";
import { runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { KalshiClient, fixtureFetch, openMarketsUrl, seriesApiUrl, settledMarketsUrl } from "@/lib/burnticker/oracle/kalshi";
import { FakePinUploader } from "@/lib/burnticker/pin";
import { registryAlertSink } from "@/lib/burnticker/alerts";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { snapshotLine } from "@/lib/launch/dailyPost";
import { formatDate } from "@/lib/burnReceipts/math";
import { appendOnlyProblems, canonicalJson, exportLedger, gatewayUrl, latestSnapshot, listSnapshots, NO_PAYER_REFUSAL, recordSnapshot, snapshotDue, snapshotIfDue, SnapshotRefused, SNAPSHOT_TABLE_NAMES, takeSnapshot, verifySnapshotBytes } from "@/lib/burnticker/ops/snapshot";
import { computeFeedHealth, feedAlerts, isDisagreement, observeCycle, periodStartMs, publicText, staleLimitMs } from "@/lib/burnticker/ops/feedHealth";
import { hostIdHash, LeaderLock, readPeer, roleConfigFromEnv, signTakeover, TAKEOVER_SCHEMA, verifyTakeover, type FetchJson } from "@/lib/burnticker/ops/leaderLock";
import { readingFence } from "@/lib/burnticker/ops/readingFence";
import { buildOpsStatus, OPS_STATUS_SCHEMA, programStatuses, readOpsStatus, writeOpsStatus, type OpsStatusJson } from "@/lib/burnticker/ops/status";
import { runDrill } from "@/lib/burnticker/ops/drill";
import { KeeperOps } from "@/lib/burnticker/ops/keeperOps";
import { attesterLines, buildTrustOps } from "@/lib/burnticker/ops/trustOps";
import { v1Snapshots } from "@/lib/burnticker/ops/api";
import { checkProposal, counterAt, keygen, readingMessage, signReading, compareChain } from "@/lib/burnticker/attesters/byo";
import { loadVerifiedBuild } from "@/lib/burnticker/trustpack/verifiedBuild";
import { setPlatformForTests, type Platform } from "@/lib/burnticker/server";
import { buildOpenApi } from "@/lib/burnticker/api/spec";
import { limiter } from "@/lib/burnticker/api/http";
import { verifyAttestation } from "@/lib/burnReceipts/attestation";
import { PublicKey } from "@solana/web3.js";
import { API, callRoute, validateSchema } from "./burntickerApiHelpers.ts";
import { BRONCOS, DEBT_RULE, NOW, fx, treasuryAndCrossFetch } from "./burntickerHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const CREATOR = "CreatorWa11et111111111111111111111111111111";
const ATTESTER = "KeeperDataKey1111111111111111111111111111111";
const DAY = 86_400_000;
const treasuryBody = loadFixture(feedById("treasury.debt")!).body;
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

let clock = NOW;
async function launchInto(regs: Registry[], program: FakeBurnProgram, rule: unknown, ticker: string, baselineAt = "2026-09-01T00:00:00Z"): Promise<TokenRow> {
  const b = await buildLaunchBundle({ creator: CREATOR, ticker, name: `${ticker} coin`, description: "a test", imageUrl: null, links: [], rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  let row: TokenRow | null = null;
  for (const reg of regs) {
    const t = reg.register({ mint: b.mint, ticker, name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt, status: "draft" }, clock);
    reg.markLaunched(t.mint, `launch${ticker}`, b.addresses.poolId, baselineAt);
    reg.addAttester({ mint: t.mint, pubkey: ATTESTER, role: "data-key", addedAt: clock - 10 * DAY, timelockUntil: null });
    row = reg.token(t.mint)!;
  }
  if (program.tokens.has(row!.mint)) { program.supplies.set(row!.mint, BigInt("1000000000000000")); program.deposit(row!.mint, BigInt(10_000_000_000)); }
  return row!;
}
function depsFor(reg: Registry, program: FakeBurnProgram, lines: string[] = []): KeeperDeps {
  return { registry: reg, program, oracles: { kalshi: new KalshiClient({ fetchImpl: fixtureFetch({}), now: () => clock, minIntervalMs: 0 }), catalogue: new CatalogueAdapter({ fetchImpl: treasuryAndCrossFetch(treasuryBody), now: () => clock }) }, attester: ATTESTER, log: (s) => lines.push(s), now: () => clock, dryRun: false };
}

beforeEach(() => { clock = NOW; });

// ---------------------------------------------------------------------------------------------------------------------------------
describe("1 · the daily registry snapshot", () => {
  test("canonical JSONL: fixed table order, primary-key order, sorted keys, deterministic bytes and sha256", async () => {
    const program = new FakeBurnProgram("devnet"); program.now = () => clock;
    const a = openRegistry(":memory:"), b = openRegistry(":memory:");
    await launchInto([a, b], program, DEBT_RULE, "DEBT");
    await runCycle(depsFor(a, program));
    const ex = exportLedger(a, "2026-10-10");
    const lines = ex.text.trimEnd().split("\n");
    assert.equal(lines[0], canonicalJson({ date: "2026-10-10", schema: "burnticker.snapshot/v1", tables: SNAPSHOT_TABLE_NAMES }));
    assert.deepEqual(Object.keys(ex.rowCounts), SNAPSHOT_TABLE_NAMES);
    assert.equal(ex.rowCounts.rules, 1); assert.ok(ex.rowCounts.readings > 5); assert.ok(ex.rowCounts.receipts > 0);
    for (const l of lines) assert.equal(canonicalJson(JSON.parse(l)), l, "every line is canonical");
    assert.equal(exportLedger(a, "2026-10-10").sha256, ex.sha256, "same database, same bytes");
    assert.ok(!/"attempts"|"last_error"|"next_attempt_at"|"updated_at"|"wait_reason"/.test(ex.text), "operational retry columns are not facts and are left out");
    assert.ok(verifySnapshotBytes(ex.text, { sha256: ex.sha256, rowCounts: ex.rowCounts, date: "2026-10-10" }).ok);
  });

  test("takeSnapshot uploads through the (fake) Irys client, records once, and refuses without a payer — never a hosted fallback", async () => {
    const reg = openRegistry(":memory:"), program = new FakeBurnProgram("devnet");
    await launchInto([reg], program, DEBT_RULE, "DEBT");
    await assert.rejects(takeSnapshot({ registry: reg, uploader: null, now: NOW, cluster: "devnet" }), (e: Error) => e instanceof SnapshotRefused && e.message === NO_PAYER_REFUSAL);
    assert.equal(listSnapshots(reg).length, 0, "nothing recorded without the Arweave copy");
    const up = new FakePinUploader();
    const r = await takeSnapshot({ registry: reg, uploader: up, now: NOW, cluster: "devnet" });
    assert.equal(r.status, "pinned"); assert.equal(r.record.date, "2026-10-10");
    assert.equal(up.uploads.length, 1); assert.equal(up.uploads[0].contentType, "application/x-ndjson");
    const bytes = up.get(r.record.arweaveTxId)!;
    const v = verifySnapshotBytes(bytes, { sha256: r.record.sha256, rowCounts: r.record.rowCounts, date: r.record.date });
    assert.ok(v.ok, v.problems.join("; "));
    assert.deepEqual(latestSnapshot(reg), r.record);
    // write-once: a second take is "exists", a second INSERT and any UPDATE / DELETE are refused by the database
    assert.equal((await takeSnapshot({ registry: reg, uploader: up, now: NOW + 3_600_000, cluster: "devnet" })).status, "exists");
    assert.equal(up.uploads.length, 1);
    assert.throws(() => recordSnapshot(reg, { ...r.record }), /UNIQUE|constraint/i);
    assert.throws(() => reg.db.exec("UPDATE snapshots SET sha256='x'"), /written once/);
    assert.throws(() => reg.db.exec("DELETE FROM snapshots"), /append-only/);
    assert.throws(() => gatewayUrl("bad id!", "devnet"));
    assert.equal(gatewayUrl(r.record.arweaveTxId, "mainnet"), `https://arweave.net/${r.record.arweaveTxId}`);
  });

  test("the verifier catches a changed byte, reordered rows, a non-canonical line and a wrong count", async () => {
    const reg = openRegistry(":memory:"), program = new FakeBurnProgram("devnet");
    await launchInto([reg], program, DEBT_RULE, "DEBT"); await runCycle(depsFor(reg, program));
    const ex = exportLedger(reg, "2026-10-10");
    const lines = ex.text.trimEnd().split("\n");
    const tampered = ex.text.replace(/"value":"(\d)/, (_m, d) => `"value":"${(Number(d) + 1) % 10}`);
    assert.ok(!verifySnapshotBytes(tampered, { sha256: ex.sha256 }).ok);
    const ri = lines.findIndex((l) => l.includes('"table":"readings"'));
    const swapped = [...lines]; [swapped[ri], swapped[ri + 1]] = [swapped[ri + 1], swapped[ri]];
    assert.match(verifySnapshotBytes(`${swapped.join("\n")}\n`).problems.join(" "), /not in key order/);
    const spaced = [...lines]; spaced[1] = JSON.stringify(JSON.parse(spaced[1]), null, 1).replace(/\n/g, "");
    assert.match(verifySnapshotBytes(`${spaced.join("\n")}\n`).problems.join(" "), /not canonical/);
    assert.match(verifySnapshotBytes(ex.text, { rowCounts: { ...ex.rowCounts, readings: 1 } }).problems.join(" "), /The readings table has \d+ rows, but the record says 1\./);
  });

  test("append-only across time: a later registry holds every row of an earlier snapshot; a missing or changed row is named", async () => {
    const program = new FakeBurnProgram("devnet"); program.now = () => clock;
    const reg = openRegistry(":memory:");
    await launchInto([reg], program, DEBT_RULE, "DEBT");
    await runCycle(depsFor(reg, program));
    const early = exportLedger(reg, "2026-10-10").text;
    clock += DAY; await runCycle(depsFor(reg, program));
    assert.deepEqual(appendOnlyProblems(early, reg), [], "the same registry a day later still holds every row unchanged");
    const other = openRegistry(":memory:");
    const problems = appendOnlyProblems(early, other);
    assert.ok(problems.length > 3 && problems.some((p) => /missing from the later registry/.test(p)));
    // a changed fact (forged in the snapshot text) is named with its column
    const forged = early.replace(/("rules_sha":")[0-9a-f]{4}([^\n]*"table":"rules"\})/, "$1dead$2");
    assert.notEqual(forged, early);
    assert.ok(appendOnlyProblems(forged, reg).some((p) => /rules .*changed rules_sha/.test(p)));
  });

  test("the keeper's job: due once per UTC day after 00:15, retried 30 min after a failure, an alert on refusal", async () => {
    const reg = openRegistry(":memory:");
    const at = (iso: string) => Date.parse(iso);
    assert.equal(snapshotDue(reg, at("2026-10-11T00:10:00Z")), false, "before 00:15 UTC");
    assert.equal(snapshotDue(reg, at("2026-10-11T00:20:00Z")), true);
    const alerts: string[] = [];
    const r = await snapshotIfDue({ registry: reg, uploader: null, now: at("2026-10-11T00:20:00Z"), cluster: "devnet", log: () => {}, alert: (k, key) => { alerts.push(`${k}|${key}`); } });
    assert.equal(r, null); assert.deepEqual(alerts, ["bt-snapshot-failed|bt-snapshot-failed:2026-10-11"]);
    assert.equal(snapshotDue(reg, at("2026-10-11T00:40:00Z")), false, "inside the 30-minute retry wait");
    assert.equal(snapshotDue(reg, at("2026-10-11T00:51:00Z")), true);
    const ok = await snapshotIfDue({ registry: reg, uploader: new FakePinUploader(), now: at("2026-10-11T00:51:00Z"), cluster: "devnet", log: () => {} });
    assert.equal(ok?.status, "pinned");
    assert.equal(snapshotDue(reg, at("2026-10-11T23:00:00Z")), false, "today's is taken");
    assert.equal(snapshotDue(reg, at("2026-10-12T00:16:00Z")), true, "tomorrow's is due");
  });

  test("the daily post's footer line: date, sha256 prefix, the Arweave id — copy-lint clean; null without a snapshot", () => {
    assert.equal(snapshotLine(null), null);
    const l = snapshotLine({ date: "2026-10-12", sha256: "4c1f0b4a9e3d2c1b0a9f8e7d6c5b4a39281706f5e4d3c2b1a0918273645546a7", arweaveTxId: "Zk3vJb9wQm2XcT7uYp4LsN8dRf6hGa1eEo5iKl0VqW" })!;
    assert.equal(l, "Ledger snapshot 2026-10-12: sha256 4c1f0b4a9e3d2c1b… · arweave Zk3vJb9wQm2XcT7uYp4LsN8dRf6hGa1eEo5iKl0VqW");
    const lint = lintCopy(l, loadCopyLintConfig(ROOT));
    assert.equal(lint.hits.length, 0, JSON.stringify(lint.hits));
  });

  test("GET /v1/snapshots answers from the write-once table and validates against the OpenAPI schema (since 1.7.0)", async () => {
    const reg = openRegistry(":memory:");
    const empty = v1Snapshots({ registry: reg, cluster: "devnet" }, new URLSearchParams());
    assert.equal(empty.status, 200); assert.equal((empty.body as { count: number }).count, 0);
    assert.equal(v1Snapshots({ registry: reg, cluster: "devnet" }, new URLSearchParams("limit=0")).status, 400);
    await takeSnapshot({ registry: reg, uploader: new FakePinUploader(), now: NOW, cluster: "devnet" });
    setPlatformForTests({ registry: reg, cluster: "devnet", publishDir: tmp("bt-ops-") } as unknown as Platform);
    limiter.reset();
    const res = await callRoute(`${API}/snapshots`);
    assert.equal(res.status, 200); assert.match(res.headers.get("cache-control") ?? "", /max-age=60/);
    const body = await res.json() as { latest: { date: string; verify: string }; count: number };
    assert.equal(body.count, 1); assert.equal(body.latest.date, "2026-10-10"); assert.match(body.latest.verify, /burnticker-verify-snapshot\.mts \S+ --cluster devnet/);
    const doc = buildOpenApi() as { info: { version: string }; paths: Record<string, unknown>; components: { schemas: Record<string, Record<string, unknown>> } };
    assert.ok(Number(doc.info.version.split(".")[1]) >= 7, doc.info.version); assert.ok(doc.paths["/snapshots"]);
    assert.deepEqual(validateSchema(doc.components.schemas.RegistrySnapshots, body, doc), []);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("2 · feed health, status.json and the status page", () => {
  test("helpers: disagreement wording, period starts, stale limits by cadence, public text redaction", () => {
    assert.ok(isDisagreement("2026-10-11: NWS and the Iowa Environmental Mesonet disagree on 2026-10-11"));
    assert.ok(isDisagreement("game 1: 3-1 ≠ 2-1 — held"));
    assert.ok(isDisagreement("IEM ASOS max 93 °F vs NWS 90 °F (> 2 °F apart)"));
    assert.ok(!isDisagreement("2026-10-08: only one operator could read the final — held"));
    assert.equal(periodStartMs("2026-10-08"), Date.UTC(2026, 9, 8)); assert.equal(periodStartMs("2026-08"), Date.UTC(2026, 7, 1));
    assert.equal(periodStartMs("2026-Q3"), Date.UTC(2026, 6, 1)); assert.equal(periodStartMs("2026-W01"), Date.UTC(2025, 11, 29));
    assert.equal(staleLimitMs("catalogue:treasury.debt", ROOT), 5 * DAY); assert.equal(staleLimitMs("catalogue:bls.eggs", ROOT), 100 * DAY);
    assert.equal(staleLimitMs("catalogue:jpl.neo", ROOT), 12 * DAY, "completeAfterDays 7 added");
    assert.equal(staleLimitMs("catalogue:edgar.8k", ROOT), null, "an irregular day feed has no schedule");
    assert.equal(staleLimitMs("polymarket:market:0xabc"), null); assert.equal(staleLimitMs("kalshi:KXNFLGAME:binary"), null);
    assert.equal(publicText("failed https://api.x.com/v1/q?api_key=SECRET&x=1 token=abc"), "failed https://api.x.com/v1/q token=<redacted>");
  });

  test("computeFeedHealth: ok → down (failures) → disagree (cross-read) → withheld (cross-read unreadable) → stale (cadence), and the three alerts", async () => {
    const reg = openRegistry(":memory:"), program = new FakeBurnProgram("devnet");
    const t = await launchInto([reg], program, DEBT_RULE, "DEBT", "2026-10-01T00:00:00Z");
    const key = t.selectorKey;
    let h = computeFeedHealth(reg, NOW);
    assert.equal(h[0].state, "never-read");
    reg.putReadings("catalogue", key, [{ id: "2026-10-08", at: "2026-10-08", result: null, value: "1", title: null, sourceUrl: "https://x" }], { settlementSourceUrl: null, attestedBy: [] });
    reg.setFeedState({ selectorKey: key, lastFetchAt: NOW - 60_000, lastOkAt: NOW - 60_000, failures: 0, lastError: null, nextFetchAt: NOW + 3_600_000 });
    observeCycle(reg, { fetched: [{ key, written: 1, refusals: [], awaitingFinal: 0, error: null, skipped: false }] }, NOW - 60_000);
    h = computeFeedHealth(reg, NOW);
    assert.equal(h[0].state, "ok"); assert.equal(h[0].crossRead.agreement, true); assert.deepEqual(h[0].tickers, ["DEBT"]);
    assert.deepEqual(feedAlerts(h), []);
    reg.setFeedState({ selectorKey: key, lastFetchAt: NOW, lastOkAt: NOW - 60_000, failures: 3, lastError: "HTTP 503 from https://api.fiscaldata.treasury.gov/x?key=s3cret", nextFetchAt: NOW + 60_000 });
    h = computeFeedHealth(reg, NOW);
    assert.equal(h[0].state, "down"); assert.ok(!h[0].why.includes("s3cret"), "no query string on a public page");
    assert.deepEqual(feedAlerts(h).map((a) => a.kind), ["bt-feed-down"]);
    reg.setFeedState({ selectorKey: key, lastFetchAt: NOW, lastOkAt: NOW, failures: 0, lastError: null, nextFetchAt: NOW + 60_000 });
    observeCycle(reg, { fetched: [{ key, written: 0, refusals: ["2026-10-09: the cross-read disagrees (primary 5 ≠ cross-read 6) — held"], awaitingFinal: 0, error: null, skipped: false }] }, NOW);
    h = computeFeedHealth(reg, NOW);
    assert.equal(h[0].state, "disagree"); assert.equal(h[0].crossRead.agreement, false);
    assert.deepEqual(feedAlerts(h).map((a) => a.kind), ["bt-feed-disagree"]);
    observeCycle(reg, { fetched: [{ key, written: 0, refusals: ["treasury.debt: no cross-read could be read this cycle (fred.GFDEBTN: HTTP 503) — 30 reading(s) held"], awaitingFinal: 30, error: null, skipped: false }] }, NOW + 500);
    h = computeFeedHealth(reg, NOW + 600);
    assert.equal(h[0].state, "withheld"); assert.equal(h[0].crossRead.agreement, null, "never 'agrees' when the cross-read could not be read");
    assert.deepEqual(feedAlerts(h), [], "a hold is alerted by the refusal itself (bt-reading-implausible), not twice");
    observeCycle(reg, { fetched: [{ key, written: 0, refusals: [], awaitingFinal: 0, error: null, skipped: false }] }, NOW + 1000);
    h = computeFeedHealth(reg, NOW + 8 * DAY);
    assert.equal(h[0].state, "stale"); assert.match(h[0].why, /2026-10-08, is \d+ days? old\. The limit is 5 days\./);
    assert.deepEqual(feedAlerts(h).map((a) => a.kind), ["bt-feed-stale"]);
  });

  test("buildOpsStatus → status/status.json: the documented shape, alert kinds without text, no secrets; the leader heartbeat a standby reads", async () => {
    const reg = openRegistry(":memory:"), program = new FakeBurnProgram("devnet"), site = tmp("bt-status-");
    await launchInto([reg], program, DEBT_RULE, "DEBT", "2026-10-01T00:00:00Z");
    reg.recordAlert({ kind: "bt-feed-down", key: "k1", text: "Burnticker source DOWN: secret detail", meta: null }, NOW);
    reg.recordAlert({ kind: "bt-daily-summary", key: "k2", text: "daily", meta: null }, NOW);
    reg.setStatus("lastCycle", { at: NOW - 30_000, fetched: 1, planned: 0, executed: 0, errors: [] }, NOW);
    const role = await new LeaderLock({ role: "leader", peerStatusUrl: null, missedLimit: 5, heartbeatStaleMs: 180_000, takeoverFile: path.join(site, "t.json") }, { now: () => NOW, hostId: "abc" }).tick();
    const s = buildOpsStatus({ now: NOW, registry: reg, role, hostIdHash: "abc", cluster: "devnet", paused: false, startedAt: NOW - 3_600_000, feeds: computeFeedHealth(reg, NOW), snapshot: null, programs: programStatuses(loadVerifiedBuild(ROOT), "devnet") });
    writeOpsStatus(site, s);
    const back = readOpsStatus(site)!;
    assert.equal(back.schema, OPS_STATUS_SCHEMA);
    for (const k of ["generatedAt", "keeper", "feeds", "alerts", "retired", "windDowns", "snapshot", "programs", "fence"]) assert.ok(k in back, k);
    assert.deepEqual(back.alerts, { windowHours: 24, open: 1, kinds: { "bt-feed-down": 1 } }, "kinds and counts only; the daily summary is not an open alert");
    assert.ok(!JSON.stringify(back).includes("secret detail"));
    assert.equal(back.keeper.lastCycleAt, NOW - 30_000); assert.equal(back.keeper.active, true); assert.equal(back.keeper.role, "leader");
    assert.deepEqual(back.programs.map((p) => [p.name, p.verified]), [["burn_receipts", "matches"], ["pair_curve", "matches"]]);
    assert.deepEqual(programStatuses(loadVerifiedBuild(ROOT), "mainnet").map((p) => p.verified), ["matches", "matches"]);
    // the standby reads it back as a heartbeat
    const fetchImpl: FetchJson = async () => ({ ok: true, status: 200, json: async () => back });
    const peer = await readPeer("https://burnticker.com/status/status.json", fetchImpl, NOW);
    assert.equal(peer.role, "leader"); assert.equal(peer.lastCycleAt, NOW - 30_000); assert.equal(peer.reachable, true);
  });

  test("the static status page renders the fixture (B1 receipt, every section) with the landing's own tokens; copy lint clean; no prices", () => {
    const html = fs.readFileSync(path.join(ROOT, "site/burnticker/status/index.html"), "utf8");
    const landing = fs.readFileSync(path.join(ROOT, "site/burnticker/index.html"), "utf8");
    const shared = html.slice(html.indexOf("/* BEGIN shared tokens"), html.indexOf("/* END shared tokens */"));
    const landingCss = landing.slice(landing.indexOf("<style>") + 7, landing.indexOf("</style>"));
    assert.ok(landingCss.includes(shared.slice(shared.indexOf(":root{"))), "the status page's tokens are the landing's, verbatim");
    assert.ok(html.includes(".slip{") && html.includes("#f2eee4"), "the B1 receipt style");
    const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/burnticker-ops/status.json"), "utf8")) as OpsStatusJson;
    const text = renderStatusPage(html, fixture, Date.parse("2026-10-12T15:00:00Z"));
    for (const want of ["LEADER, ACTIVE, ON DEVNET", "heartbeat", "30 s ago", "3 of 4 not ok", "WITHHELD", "catalogue:nws.high:DEN-90", "DISAGREES", "disagree", "down", "stale", "$BRONCO has been winding down since 2026-10-08. 3 of 28 days are done.", "$ONESHOT was retired on 2026-10-05. Its last sweep was on 2026-10-11.", "sha256 4c1f0b4a", "rules 5, readings 182", "AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM", "The deployed code matches the interim-local build.", "bt-feed-down × 1", "The other keeper is the standby and is passive."]) assert.ok(text.includes(want), `rendered page shows: ${want}\n---\n${text.slice(0, 2000)}`);
    const visible = staticText(html);
    const lint = lintCopy(`${visible}\n${text}`, loadCopyLintConfig(ROOT));
    assert.equal(lint.hits.length, 0, JSON.stringify(lint.hits));
    assert.ok(!/\$\d|price|market cap|USD/i.test(text), "no prices on the status page");
  });
});

/** Runs the status page's script against a tiny DOM (no fetch) and returns the rendered text. */
function renderStatusPage(html: string, s: OpsStatusJson, now: number): string {
  class N {
    tag: string; children: N[] = []; attrs: Record<string, string> = {}; className = ""; parent: N | null = null; private text: string | null = null; id: string | null;
    constructor(tag: string, id: string | null = null) { this.tag = tag; this.id = id; }
    appendChild(c: N) { c.parent = this; this.children.push(c); return c; }
    setAttribute(k: string, v: string) { this.attrs[k] = v; }
    get textContent(): string { return this.text ?? this.children.map((c) => c.textContent).join(" "); }
    set textContent(v: string) { this.children = []; this.text = v === "" ? null : v; if (v !== "") { this.text = null; this.appendChild(new T(v)); } }
    get classList() { return { add: (c: string) => { this.className = `${this.className} ${c}`.trim(); } }; }
    querySelector(sel: string): N | null { for (const c of this.children) { if ((sel.startsWith(".") && c.className.split(" ").includes(sel.slice(1))) || c.tag === sel) return c; const r = c.querySelector(sel); if (r) return r; } return null; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
    get dataset() { return {}; }
    get childNodes() { return this.children; }
  }
  class T extends N { value: string; constructor(v: string) { super("#text"); this.value = v; } override get textContent() { return this.value; } }
  const ids = ["slip-rows", "slip-sub", "slip", "feeds", "feeds-note", "alerts", "ends", "snapshot", "programs", "keepers", "loadnote"];
  const byId: Record<string, N> = {};
  for (const id of ids) { byId[id] = new N("div", id); if (id === "feeds" || id === "programs") byId[id].appendChild(new N("tbody")); }
  byId.slip.appendChild(byId["slip-rows"]);
  const document = { getElementById: (id: string) => byId[id] ?? null, createElement: (t: string) => new N(t), createTextNode: (v: string) => new T(v), currentScript: { dataset: { noFetch: "1" } } };
  const window: Record<string, unknown> = {};
  const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
  new Function("window", "document", "fetch", script)(window, document, () => { throw new Error("no fetch in the test"); });
  (window.renderStatus as (s: OpsStatusJson, now: number) => void)(s, now);
  return ids.map((id) => byId[id].textContent).join("\n");
}
/** The page's visible static text (tags and scripts stripped). */
function staticText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------------------------------------------------------------
describe("5 · keeper redundancy: leader / standby, signed takeover notes", () => {
  const signer = Keypair.generate();
  const cfg = (role: "leader" | "standby", dir: string, url: string | null = "https://leader.example/status.json") => ({ role, peerStatusUrl: url, missedLimit: 3, heartbeatStaleMs: 180_000, takeoverFile: path.join(dir, "takeover.json") });
  const peerDoc = (k: Partial<OpsStatusJson["keeper"]>, at = NOW) => ({ schema: OPS_STATUS_SCHEMA, keeper: { role: "leader", active: true, lastCycleAt: at - 30_000, hostIdHash: "leaderhost", takeover: null, ...k } });
  const fetchDoc = (doc: unknown | null): FetchJson => async () => (doc === null ? Promise.reject(new Error("connect ECONNREFUSED")) : { ok: true, status: 200, json: async () => doc });

  test("roleConfigFromEnv: leader by default, a standby needs the leader's URL, https only (or loopback / tailnet)", () => {
    assert.equal(roleConfigFromEnv({}).role, "leader");
    assert.throws(() => roleConfigFromEnv({ BURNTICKER_KEEPER_ROLE: "standby" }), /BURNTICKER_LEADER_STATUS_URL/);
    assert.throws(() => roleConfigFromEnv({ BURNTICKER_KEEPER_ROLE: "standby", BURNTICKER_LEADER_STATUS_URL: "http://evil.example/status.json" }), /https/);
    assert.throws(() => roleConfigFromEnv({ BURNTICKER_KEEPER_ROLE: "boss" }), /leader or standby/);
    const c = roleConfigFromEnv({ BURNTICKER_KEEPER_ROLE: "standby", BURNTICKER_LEADER_STATUS_URL: "https://burnticker.com/status/status.json", BURNTICKER_TAKEOVER_MISSED: "7", BURNTICKER_HEARTBEAT_STALE_SEC: "240" });
    assert.deepEqual([c.role, c.missedLimit, c.heartbeatStaleMs], ["standby", 7, 240_000]);
    assert.equal(hostIdHash({ hostname: "a", machineId: "m" }), hostIdHash({ hostname: "a", machineId: "m" }));
    assert.notEqual(hostIdHash({ hostname: "a", machineId: "m" }), hostIdHash({ hostname: "b", machineId: "m" }));
  });

  test("a standby stays passive on a fresh heartbeat, takes over after N misses with a SIGNED note, then stays active", async () => {
    const dir = tmp("bt-role-");
    let doc: unknown | null = peerDoc({});
    let now = NOW;
    const lock = new LeaderLock(cfg("standby", dir), { now: () => now, fetchImpl: async (u, i) => fetchDoc(doc)(u, i), hostId: "standbyhost", signer: { publicKey: signer.publicKey.toBase58(), secretKey: signer.secretKey } });
    let d = await lock.tick();
    assert.equal(d.active, false); assert.match(d.reason, /heartbeat is 30 s old/);
    doc = peerDoc({ lastCycleAt: NOW - 600_000 });   // the leader stopped cycling
    for (const n of [1, 2]) { now += 60_000; d = await lock.tick(); assert.equal(d.active, false); assert.match(d.reason, new RegExp(`missed heartbeat ${n} of 3`)); }
    doc = peerDoc({}, now + 60_000);   // a fresh heartbeat in between resets the count
    now += 60_000; d = await lock.tick(); assert.equal(d.missed, 0);
    doc = null;          // unreachable
    for (let i = 0; i < 2; i++) { now += 60_000; d = await lock.tick(); assert.equal(d.active, false); }
    now += 60_000; d = await lock.tick();
    assert.equal(d.active, true); assert.match(d.reason, /TOOK OVER/);
    const note = JSON.parse(fs.readFileSync(path.join(dir, "takeover.json"), "utf8"));
    assert.equal(note.schema, TAKEOVER_SCHEMA); assert.equal(note.signer, signer.publicKey.toBase58()); assert.equal(note.missed, 3);
    assert.ok(verifyTakeover(note));
    assert.ok(!verifyTakeover({ ...note, reason: "edited afterwards" }), "an edited note does not verify");
    doc = peerDoc({});   // the leader comes back: no automatic fail-back
    now += 60_000; d = await lock.tick();
    assert.equal(d.active, true); assert.match(d.reason, /stays active until the operator removes/);
  });

  test("without a key on the host a standby never takes over (it cannot sign the note)", async () => {
    const dir = tmp("bt-role-");
    const lock = new LeaderLock(cfg("standby", dir), { now: () => NOW, fetchImpl: fetchDoc(null), hostId: "s" });
    for (let i = 0; i < 5; i++) { const d = await lock.tick(); assert.equal(d.active, false); if (i >= 2) assert.match(d.reason, /no keeper key on this host/); }
    assert.ok(!fs.existsSync(path.join(dir, "takeover.json")));
  });

  test("a leader yields only to a standby whose takeover note verifies; an unreachable peer never makes it yield", async () => {
    const dir = tmp("bt-role-");
    const note = signTakeover({ schema: TAKEOVER_SCHEMA, by: "standbyhost", signer: signer.publicKey.toBase58(), at: new Date(NOW).toISOString(), leaderUrl: "https://x", leaderLastCycleAt: null, missed: 5, reason: "leader status unreachable" }, signer.secretKey);
    const leader = (doc: unknown | null) => new LeaderLock(cfg("leader", dir, "https://standby.example/status.json"), { now: () => NOW, fetchImpl: fetchDoc(doc), hostId: "leaderhost" });
    assert.equal((await leader(null).tick()).active, true);
    assert.equal((await leader(peerDoc({ role: "standby", active: false })).tick()).active, true);
    const forged = { ...note, at: new Date(NOW + 1).toISOString() };
    assert.equal((await leader(peerDoc({ role: "standby", active: true, takeover: forged })).tick()).active, true, "a note whose signature does not verify is ignored");
    const d = await leader(peerDoc({ role: "standby", active: true, takeover: note })).tick();
    assert.equal(d.active, false); assert.match(d.reason, /yielded: the standby .* took over/);
    assert.equal((await new LeaderLock(cfg("leader", dir, null), { now: () => NOW }).tick()).active, true, "no peer configured");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("5b · the foreign-reading fence: two keepers on one chain never count a receipt twice", () => {
  test("WITHOUT the fence, a second keeper whose registry missed the first's landed readings would count the same units again (the gap)", async () => {
    const program = new FakeBurnProgram("devnet"); program.now = () => clock;
    const a = openRegistry(":memory:"), b = openRegistry(":memory:");
    const t = await launchInto([a, b], program, DEBT_RULE, "DEBT", "2026-10-01T00:00:00Z");
    await runCycle(depsFor(a, program));
    const after = (await program.port(t.mint).config())!;
    assert.ok(after.lastValue > BigInt(1), "keeper A attested and cranked");
    clock += DAY;
    await runCycle({ ...depsFor(b, program), fence: false });   // B: the fence switched off
    const doubled = (await program.port(t.mint).config())!;
    assert.ok(doubled.lastValue > after.lastValue, `the counter rose again (${after.lastValue} → ${doubled.lastValue}) for receipts A already counted: the double-count the fence exists for`);
  });

  test("WITH the fence, the second keeper adopts every reading the first landed (units match) and attests nothing twice", async () => {
    const program = new FakeBurnProgram("devnet"); program.now = () => clock;
    const a = openRegistry(":memory:"), b = openRegistry(":memory:");
    const t = await launchInto([a, b], program, DEBT_RULE, "DEBT", "2026-10-01T00:00:00Z");
    await runCycle(depsFor(a, program));
    const after = (await program.port(t.mint).config())!;
    // B plans the same receipts from the same source first (a warm standby), then fences before it may send
    const depsB = depsFor(b, program);
    await runCycle({ ...depsB, dryRun: true });
    const unassigned = b.pending(t.mint).filter((r) => r.readingDate === null);
    assert.ok(unassigned.length > 0, "B holds the receipts as unassigned");
    const fence = await readingFence(depsB);
    assert.deepEqual(fence.held, []);
    assert.ok(fence.adopted.length > 0);
    assert.equal(b.pending(t.mint).filter((r) => r.readingDate === null).length, 0, "every receipt is counted into the reading A landed");
    clock += DAY;
    await runCycle(depsB);
    const later = (await program.port(t.mint).config())!;
    assert.equal(later.lastValue, after.lastValue, "no unit counted twice");
    assert.ok(b.receipts(t.mint).filter((r) => r.units > 0).every((r) => r.status === "confirmed" || r.status === "skipped"), "B adopted the cranks too (landed-tx adoption)");
  });

  test("when the two registries disagree about the units, the fence HOLDS the keeper's sends and says why", async () => {
    const program = new FakeBurnProgram("devnet"); program.now = () => clock;
    const a = openRegistry(":memory:"), b = openRegistry(":memory:");
    const t = await launchInto([a, b], program, DEBT_RULE, "DEBT", "2026-10-01T00:00:00Z");
    await runCycle(depsFor(a, program));
    const depsB = depsFor(b, program);
    await runCycle({ ...depsB, dryRun: true });
    // B's registry holds one extra unit-carrying receipt that A never saw
    const first = b.pending(t.mint).filter((r) => r.readingDate === null)[0];
    b.addEndReceipt(t.mint, "winddown", { id: "winddown-forged", at: first.settledAt }, { units: 2, mapping: { fractionOfPool: 0.05 }, note: "forged" });
    const fence = await readingFence(depsB);
    assert.equal(fence.held.length, 1);
    assert.match(fence.held[0].why, /counted \d+ units?\. This registry's unassigned receipts through that day carry \d+\. Reconcile/);
    // the production cycle (KeeperOps.cycle → runCycle's fence) turns the hold into a dry-run cycle and an alert
    const ops = new KeeperOps({ registry: b, siteDir: tmp("bt-fence-"), cluster: "devnet", env: {}, log: () => {}, uploader: null, root: ROOT, hostId: "b" });
    const before = (await program.port(t.mint).config())!.lastValue;
    const { gate } = await ops.cycle(depsB, { dryRun: false });
    assert.equal(gate.active, true); assert.equal(gate.sendsAllowed, false);
    assert.equal((await program.port(t.mint).config())!.lastValue, before, "nothing attested while held");
    const raised = await ops.alerts(registryAlertSink(b), NOW);
    assert.ok(raised.some((r) => r.startsWith("bt-foreign-reading")));
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// REVIEW 2 F1 (ChatGPT/Codex, 2026-10-11): the fence ran in beforeCycle, BEFORE runCycle planned anything, so a cold standby (empty pending
// set) checked zero tokens, planned the receipts the leader had already counted and attested them again on the next date (counter 63 → 125).
// These run the PRODUCTION orchestration (KeeperOps.cycle, which scripts/burnticker-keeper.mts calls) and compare a failover with the same two
// days run by one keeper: the counters, the fee pools and the supplies must be identical — single coin, an active pair (attest-only pass) and
// a wind-down (receipts planned inside the execution pass).
describe("5c · review 2 F1: the fence runs after planning, before the first attestation (production order, cold standby)", () => {
  const KX = { [settledMarketsUrl("KXNFLGAME")]: fx("kalshi/KXNFLGAME.settled.json"), [seriesApiUrl("KXNFLGAME")]: fx("kalshi/series.KXNFLGAME.json"), [openMarketsUrl("KXNFLGAME")]: { cursor: "", markets: [] } };
  const BRONCOS_LOSE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
  const kdeps = (reg: Registry, program: FakeBurnProgram): KeeperDeps => ({ ...depsFor(reg, program), oracles: { kalshi: new KalshiClient({ fetchImpl: fixtureFetch(KX), now: () => clock, minIntervalMs: 0 }), catalogue: new CatalogueAdapter({ fetchImpl: treasuryAndCrossFetch(treasuryBody), now: () => clock }) } });
  async function launchPairInto(regs: Registry[], program: FakeBurnProgram): Promise<string[]> {
    const inputA = { creator: CREATOR, ticker: "BRONCOS", name: "BRONCOS", description: "", imageUrl: null, links: [], rule: BRONCOS_LOSE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" as const };
    const pr = await buildPairBundles({ a: inputA, b: { ticker: "CHIEFS", name: "CHIEFS", description: "", imageUrl: null, links: [] }, voidBy: "2026-11-30" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m: string) => `https://x/${m}.json` });
    for (const reg of regs) {
      for (const [b, ticker] of [[pr.a, "BRONCOS"], [pr.b, "CHIEFS"]] as const) {
        reg.register({ mint: b.mint, ticker, name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2026-09-01T00:00:00Z", status: "draft" }, clock);
        reg.markLaunched(b.mint, `launch${ticker}`, null, "2026-09-01T00:00:00Z");
      }
      reg.registerPair(pr.pairId, pr.a.mint, pr.b.mint);
    }
    for (const b of [pr.a, pr.b]) { program.deposit(b.mint, BigInt(5_000_000_000)); program.supplies.set(b.mint, BigInt("1000000000000000")); }
    return [pr.a.mint, pr.b.mint];
  }
  const ended = (regs: Registry[], mint: string) => { for (const r of regs) r.markRuleEnded(mint, "winddown", "test: the window ended", Date.parse("2026-10-05T12:00:00Z")); };
  type Setup = (regs: Registry[], program: FakeBurnProgram) => Promise<string[]>;
  const snap = async (program: FakeBurnProgram, mints: string[]) => Promise.all(mints.map(async (m) => ({ counter: (await program.port(m).config())!.lastValue, pool: await program.feePdaBalanceLamports(m), supply: program.supplies.get(m) })));
  /** World 1: one keeper runs day 1 and day 2. World 2: keeper A runs day 1; a COLD standby B (same coins, empty pending set) runs day 2 through KeeperOps.cycle. */
  async function failover(setup: Setup) {
    clock = NOW;
    const p1 = new FakeBurnProgram("devnet"); p1.now = () => clock;
    const r1 = openRegistry(":memory:");
    const m1 = await setup([r1], p1);
    await runCycle(kdeps(r1, p1));
    clock += DAY;
    await runCycle(kdeps(r1, p1));
    const single = await snap(p1, m1);
    clock = NOW;
    const p2 = new FakeBurnProgram("devnet"); p2.now = () => clock;
    const a = openRegistry(":memory:"), b = openRegistry(":memory:");
    const m2 = await setup([a, b], p2);
    await runCycle(kdeps(a, p2));
    const afterA = await snap(p2, m2);
    assert.ok(m2.every((m) => b.pending(m).length === 0), "the standby starts cold: nothing pending in its registry");
    clock += DAY;
    const lines: string[] = [];
    const depsB = { ...kdeps(b, p2), log: (s: string) => lines.push(s) };
    const ops = new KeeperOps({ registry: b, siteDir: tmp("bt-f1-"), cluster: "devnet", env: {}, log: () => {}, uploader: null, root: ROOT, hostId: "b" });
    const { gate, report, error } = await ops.cycle(depsB, { dryRun: false });
    assert.equal(error, null);
    assert.equal(gate.active, true);
    return { single, afterA, failover: await snap(p2, m2), report, lines, b, mints: m2 };
  }

  test("single coin: the standby adopts the leader's readings instead of counting the same source events again (the report's 63 → 125)", async () => {
    const r = await failover(async (regs, program) => [(await launchInto(regs, program, DEBT_RULE, "DEBT", "2026-10-01T00:00:00Z")).mint]);
    assert.ok(r.afterA[0].counter > BigInt(1), "keeper A attested");
    assert.equal(r.failover[0].counter, r.single[0].counter, `counter after failover ${r.failover[0].counter} vs one keeper ${r.single[0].counter}`);
    assert.equal(r.failover[0].pool, r.single[0].pool, "no second spend from the burn pool");
    assert.equal(r.failover[0].supply, r.single[0].supply);
    assert.ok(r.report!.fence!.adopted.length > 0, "the fence ran after planning and adopted");
    assert.deepEqual(r.report!.fence!.held, []);
  });

  test("an active pair (the attest-only pass): neither coin's counter or pool moves twice", async () => {
    const r = await failover(launchPairInto);
    for (let i = 0; i < 2; i++) {
      assert.equal(r.failover[i].counter, r.single[i].counter, `coin ${i}: counter`);
      assert.equal(r.failover[i].pool, r.single[i].pool, `coin ${i}: pool`);
      assert.equal(r.failover[i].supply, r.single[i].supply, `coin ${i}: supply`);
    }
  });

  test("a wind-down (end receipts planned inside the execution pass): fenced before they are attested", async () => {
    const r = await failover(async (regs, program) => { const t = await launchInto(regs, program, { ...DEBT_RULE, onEnd: DEFAULT_ON_END }, "WIND", "2026-10-01T00:00:00Z"); ended(regs, t.mint); return [t.mint]; });
    assert.ok(r.afterA[0].counter > BigInt(1), "keeper A attested wind-down days");
    assert.equal(r.failover[0].counter, r.single[0].counter, `counter after failover ${r.failover[0].counter} vs one keeper ${r.single[0].counter}`);
    assert.equal(r.failover[0].pool, r.single[0].pool);
    assert.equal(r.failover[0].supply, r.single[0].supply);
  });

  test("fail closed: a TokenConfig that cannot be read holds the cycle's sends (nothing attested) and says why", async () => {
    clock = NOW;
    const program = new FakeBurnProgram("devnet"); program.now = () => clock;
    const a = openRegistry(":memory:"), b = openRegistry(":memory:");
    const t = await launchInto([a, b], program, DEBT_RULE, "DEBT", "2026-10-01T00:00:00Z");
    await runCycle(depsFor(a, program));
    const before = (await program.port(t.mint).config())!.lastValue;
    clock += DAY;
    const fk = program.fake(t.mint), real = fk.config.bind(fk);
    let calls = 0;
    fk.config = async () => { if (++calls === 1) throw new Error("RPC 503"); return real(); };
    const ops = new KeeperOps({ registry: b, siteDir: tmp("bt-f1-"), cluster: "devnet", env: {}, log: () => {}, uploader: null, root: ROOT, hostId: "b" });
    const { report } = await ops.cycle(depsFor(b, program), { dryRun: false });
    assert.equal(report!.fence!.held.length, 1);
    assert.match(report!.fence!.held[0].why, /TokenConfig could not be read/);
    assert.equal((await program.port(t.mint).config())!.lastValue, before, "nothing attested while held");
    const raised = await ops.alerts(registryAlertSink(b), clock);
    assert.ok(raised.some((x) => x.startsWith("bt-foreign-reading")), "the hold reaches the alert sink");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("6 · the source-outage drill", () => {
  for (const mode of ["down", "disagree", "stale"] as const) {
    test(`treasury.debt · ${mode}: withheld, alerted, shown, no crank — after a control run that cranks`, async () => {
      const dir = tmp("bt-drill-");
      const r = await runDrill({ feed: "treasury.debt", mode, now: Date.parse("2026-10-12T16:00:00Z"), dir });
      assert.ok(r.ok, r.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`).join("\n"));
      assert.deepEqual(r.checks.map((c) => c.id), ["control", "withheld", "alert", "status", "no-crank"]);
      assert.equal(r.status?.state, mode);
      const st = readOpsStatus(r.scratch.site)!;
      assert.equal(st.feeds[0].state, mode);
    });
  }
  test("a month feed runs too; a week feed is refused with a hint", async () => {
    assert.ok((await runDrill({ feed: "bls.eggs", mode: "down", now: Date.parse("2026-10-12T16:00:00Z"), dir: tmp("bt-drill-") })).ok);
    await assert.rejects(runDrill({ feed: "eia.gasoline", mode: "down", now: NOW, dir: tmp("bt-drill-") }), /daily and monthly feeds/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("3 · bring your own attester", () => {
  const nowSec = Math.floor(NOW / 1000);
  const K = (n: number) => Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey.toBase58();
  const keeper = { key: K(1), kind: 0, addedAt: nowSec - 30 * 86_400 };

  test("checkProposal mirrors propose_attesters: at quorum 1 a new key needs quorum 2; seniority 7 days; never lower the quorum", () => {
    assert.match(checkProposal([keeper], 1, [{ key: K(1), kind: 0 }, { key: K(2), kind: 0 }], 1, nowSec).join(" "), /fewer new keys than the new quorum/);
    assert.deepEqual(checkProposal([keeper], 1, [{ key: K(1), kind: 0 }, { key: K(2), kind: 0 }], 2, nowSec), []);
    const junior = { ...keeper, addedAt: nowSec - 3 * 86_400 };
    assert.match(checkProposal([junior], 1, [{ key: K(1), kind: 0 }, { key: K(2), kind: 0 }], 2, nowSec).join(" "), /≥ 7 days \(has 0\); earliest: /);
    assert.match(checkProposal([keeper, { key: K(2), kind: 0, addedAt: nowSec - 30 * 86_400 }], 2, [{ key: K(1), kind: 0 }, { key: K(2), kind: 0 }], 1, nowSec).join(" "), /never be lowered/);
    assert.match(checkProposal([keeper], 1, [{ key: K(2), kind: 0 }], 1, nowSec).join(" "), /keep at least 1 current key/);
    assert.match(checkProposal([keeper], 1, [{ key: K(1), kind: 0 }, { key: K(1), kind: 0 }], 2, nowSec).join(" "), /listed twice/);
    assert.match(checkProposal([keeper], 1, [{ key: K(1), kind: 5 }], 1, nowSec).join(" "), /kind 5/);
  });

  test("counterAt reproduces the keeper's attested reading from the same source (value, previous date, the receipts counted); the signed message verifies", async () => {
    const program = new FakeBurnProgram("devnet"); program.now = () => clock;
    const reg = openRegistry(":memory:");
    const t = await launchInto([reg], program, DEBT_RULE, "DEBT", "2026-10-01T00:00:00Z");
    await runCycle(depsFor(reg, program));
    const cfg = (await program.port(t.mint).config())!;
    const D = cfg.lastRecordDate;
    const onChain = (await program.port(t.mint).reading(D))!;
    const sources = reg.readings(t.selectorKey).map((r) => ({ id: r.id, at: r.at, result: r.result, value: r.value, title: r.title, sourceUrl: r.sourceUrl }));
    const c = counterAt({ mint: t.mint, ticker: t.ticker, rulesText: t.rulesJson, baselineAt: t.baselineAt, readings: sources, recordDate: D });
    assert.equal(c.value, onChain.value, `counter for ${formatDate(D)}`);
    assert.equal(c.prevDate, onChain.prevDate);
    assert.equal(c.units, onChain.units);
    const sig = reg.signatures(t.mint, `reading:${formatDate(D)}`).find((s) => s.status === "confirmed")!;
    assert.deepEqual(c.eventIds, (JSON.parse(sig.memo) as { events: string[] }).events, "the same receipts the keeper named");
    assert.equal(compareChain(c, { value: onChain.value, prev_date: onChain.prevDate, units: BigInt(onChain.units), source_url_hash: (await import("@/lib/burnReceipts/attestation")).sourceUrlHash(c.sourceUrl) }).checks.every((x) => x.ok), true);
    const kp = Keypair.generate();
    const m = readingMessage({ genesis: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", programId: "AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM", mint: t.mint, c });
    assert.match(m.message, new RegExp(`^BURNRECEIPTS-v3\\|EtWTRABZ\\S+\\|AuQjoSgq\\S+\\|${t.mint}\\|bt\\.units:DEBT\\|prev=\\S+\\|${formatDate(D)}\\|${c.value}\\|src=[0-9a-f]{64}\\|proof=0{64}$`));
    const s = signReading(kp.secretKey, m.message);
    assert.ok(verifyAttestation(new PublicKey(s.publicKey), Buffer.from(m.message), Buffer.from(s.signature, "base64")));
    assert.throws(() => counterAt({ mint: t.mint, ticker: "X", rulesText: JSON.stringify(JSON.parse(t.rulesJson)), baselineAt: t.baselineAt, readings: [], recordDate: D }), /not canonical/);
  });

  test("keygen writes a 600 key outside any repository and refuses inside one", () => {
    const dir = tmp("bt-att-");
    const k = keygen({ out: path.join(dir, "k", "key.json"), repoRoot: ROOT });
    assert.equal(fs.statSync(k.file).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(`${k.file}.address`, "utf8").trim(), k.publicKey);
    assert.throws(() => keygen({ out: path.join(dir, "k", "key.json"), repoRoot: ROOT }), /refusing to overwrite/);
    assert.throws(() => keygen({ out: path.join(ROOT, "tmp-key.json"), repoRoot: ROOT }), /inside the repository/);
    const enc = keygen({ out: path.join(dir, "e.json"), passphrase: "a long test passphrase", repoRoot: ROOT });
    assert.equal(enc.encrypted, true); assert.match(fs.readFileSync(enc.file, "utf8"), /"encrypted":true/);
  });

  test("the trust page's attesters line per coin: count, key prefixes, joined and senior-from dates", async () => {
    const reg = openRegistry(":memory:"), program = new FakeBurnProgram("devnet");
    const t = await launchInto([reg], program, DEBT_RULE, "DEBT");
    reg.addAttester({ mint: t.mint, pubkey: "Comm111111111111111111111111111111111111111", role: "independent", addedAt: NOW - 2 * DAY, timelockUntil: null });
    const [l] = attesterLines(reg, NOW);
    assert.equal(l.count, 2);
    assert.match(l.line, /^2 signers are active\. Keeper… is the data key\. It was added on 2026-09-30 and is senior\. Comm11… is an independent signer\. It was added on 2026-10-08 and becomes senior on 2026-10-15\.$/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("4 · incident policy, the trust page section, the static fallback", () => {
  test("the incident policy, its template and the log are in place, linked from SECURITY.md; the old path is gone", () => {
    const pol = fs.readFileSync(path.join(ROOT, "docs/burnticker/INCIDENTS.md"), "utf8");
    for (const s of ["## What counts as an incident", "## The 48-hour rule", "## Where it is published", "## Who signs it"]) assert.ok(pol.includes(s), s);
    assert.ok(fs.existsSync(path.join(ROOT, "docs/burnticker/incidents/TEMPLATE.md")));
    assert.ok(fs.readFileSync(path.join(ROOT, "docs/burnticker/incidents/LOG.md"), "utf8").includes("(No incidents recorded.)"));
    assert.ok(!fs.readdirSync(path.join(ROOT, "docs/burnticker")).includes("incidents.md"), "migrated into the folder");
    assert.match(fs.readFileSync(path.join(ROOT, "config/public-repo/overlay/SECURITY.md"), "utf8"), /docs\/burnticker\/INCIDENTS\.md/);
    const lint = lintCopy(pol, loadCopyLintConfig(ROOT));
    assert.equal(lint.hits.length, 0, JSON.stringify(lint.hits));
  });

  test("buildTrustOps: which keeper is active (this host + the peer), the latest snapshot, the incident links", async () => {
    const reg = openRegistry(":memory:"), site = tmp("bt-trustops-");
    const role = await new LeaderLock({ role: "leader", peerStatusUrl: null, missedLimit: 5, heartbeatStaleMs: 180_000, takeoverFile: path.join(site, "t.json") }, { now: () => NOW, hostId: "aaaa" }).tick();
    writeOpsStatus(site, buildOpsStatus({ now: NOW, registry: reg, role, hostIdHash: "aaaa", cluster: "devnet", paused: false, startedAt: NOW, feeds: [], snapshot: null, programs: [] }));
    await takeSnapshot({ registry: reg, uploader: new FakePinUploader(), now: NOW, cluster: "devnet" });
    const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/burnticker-ops/status.json"), "utf8"));
    const peerDoc = { ...fixture, keeper: { ...fixture.keeper, role: "standby", active: false, hostIdHash: "bbbb" } };
    const t = await buildTrustOps({ registry: reg, publishDir: site, env: { BURNTICKER_PEER_STATUS_URL: "https://status-b.example/status.json" }, now: NOW, fetchImpl: async () => ({ ok: true, status: 200, json: async () => peerDoc }) });
    assert.equal(t.keepers.length, 2);
    assert.match(t.activeSummary, /^The keeper on this host is active\. It is the leader, on host aaaa\.$/);
    assert.equal(t.keepers[1].role, "standby"); assert.equal(t.keepers[1].active, false);
    assert.equal(t.snapshot?.date, "2026-10-10");
    assert.deepEqual(t.incidents, { policy: "docs/burnticker/INCIDENTS.md", template: "docs/burnticker/incidents/TEMPLATE.md", log: "docs/burnticker/incidents/LOG.md" });
  });

  test("the static fallback page: B1 slip, the landing's tokens, the 'catching up' line, program ids with Solscan links; copy lint clean", () => {
    const html = fs.readFileSync(path.join(ROOT, "site/burnticker/fallback/index.html"), "utf8");
    const landing = fs.readFileSync(path.join(ROOT, "site/burnticker/index.html"), "utf8");
    const shared = html.slice(html.indexOf(":root{"), html.indexOf("/* END shared tokens */"));
    assert.ok(landing.includes(shared), "the fallback's tokens are the landing's, verbatim");
    assert.match(html, /The app is catching up\. Burns are run by the program on chain/);
    assert.doesNotMatch(html, /unaffected/, "review 2 §3.10: an outage page does not assert what it has not checked");
    const wk = JSON.parse(fs.readFileSync(path.join(ROOT, "site/burnticker/.well-known/burnticker.json"), "utf8"));
    for (const p of Object.values(wk.clusters.devnet.programs) as { programId: string }[]) assert.ok(html.includes(`https://solscan.io/account/${p.programId}?cluster=devnet`), p.programId);
    const lint = lintCopy(staticText(html), loadCopyLintConfig(ROOT));
    assert.equal(lint.hits.length, 0, JSON.stringify(lint.hits));
  });

  test("Caddy: the status host, /status → /status/, upstream timeouts, the fallback on app 5xx / unreachable — API 5xx still pass through", () => {
    const caddy = fs.readFileSync(path.join(ROOT, "deploy/caddy/Caddyfile"), "utf8").replace(/^\s*#.*$/gm, "");
    assert.match(caddy, /\{\$BURNTICKER_STATUS_DOMAIN:status\.burnticker\.com\} \{\s*root \* \/var\/www\/burnticker\/status/);
    assert.match(caddy, /redir \/status \/status\/ 308/);
    assert.match(caddy, /@app path \/burnticker \/burnticker\/\* \/api\/burnticker\/\* \/_next\/\*/, "the one narrow proxy matcher stays");
    assert.match(caddy, /response_header_timeout 20s/);
    assert.match(caddy, /handle_errors \{[\s\S]*@api_down[\s\S]*import app_fallback_api[\s\S]*@app_down[\s\S]*import app_fallback_page/);
    assert.match(caddy, /\(app_fallback_page\) \{\s*root \* \/var\/www\/burnticker\/fallback\s*rewrite \* \/index\.html/);
    const apiBlock = caddy.slice(caddy.indexOf("handle @app_api"), caddy.indexOf("handle {", caddy.indexOf("handle @app_api")));
    assert.ok(!apiBlock.includes("handle_response"), "the API's own 5xx answers are not replaced");
    assert.ok(!/header_up Host/.test(caddy));
    const ds = fs.readFileSync(path.join(ROOT, "scripts/ops/deploy-sites.sh"), "utf8");
    assert.match(ds, /--pages-only\) PAGES_ONLY=1/); assert.match(ds, /for p in status fallback/);
  });
});
