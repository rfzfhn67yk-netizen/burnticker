// THIRD PRELAUNCH AUDIT F06 (2026-10-16, P2): ops.json reported `conditions: []` while five sports selectors had 20–21 consecutive
// failures. The summary judged feeds only by the old stall check (no fetch ATTEMPT for 2× the cadence), which a source that fails on every
// attempt never trips, and it left out the per-source health (down / stale / disagree / withheld). One aggregator (ops/conditions.ts) now
// feeds ops.json and the human check-in alike; recovered conditions are shown for a day; notification dedupe stays in the alert sink.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openRegistry, type Registry } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import { collectSnapshot, registryAlertSink } from "@/lib/burnticker/alerts";
import { burntickerCheckin, burntickerCheckinLines, buildOpsJson } from "@/lib/burnticker/checkin";
import { computeFeedHealth, feedAlerts, observeCycle, raiseFeedAlerts } from "@/lib/burnticker/ops/feedHealth";
import { activeConditions, CONDITIONS_KEY, conditionsView, foldConditions, readConditionMemory, RECOVERED_SHOW_MS } from "@/lib/burnticker/ops/conditions";
import { BRONCOS, DEBT_RULE } from "./burntickerHelpers.ts";

const CREATOR = "CreatorWa11et111111111111111111111111111111";
const ATTESTER = "KeeperDataKey1111111111111111111111111111111";
const MINTS = ["Mint1111111111111111111111111111111111111111", "Mint2222222222222222222222222222222222222222"];
const NOW = Date.parse("2026-10-16T15:00:00Z");
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const SPORTS = "kalshi:KXNFLGAME:binary";
const DEBT = "catalogue:treasury.debt";

let reg: Registry, site: string;
function launch(rule: unknown, ticker: string, mint: string) {
  const locked = lockRule(rule);
  const t = reg.register({ mint, ticker, name: `${ticker} coin`, creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: locked.text, feePda: `Fee${ticker}`, vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2026-10-01T00:00:00Z", status: "draft" }, NOW - 10 * DAY);
  reg.markLaunched(t.mint, `launch-${ticker}`, null, "2026-10-01T00:00:00Z");
  reg.addAttester({ mint, pubkey: ATTESTER, role: "data-key", addedAt: NOW - 10 * DAY, timelockUntil: null });
  return reg.token(mint)!;
}
const snap = (now = NOW) => collectSnapshot({ registry: reg, siteDir: site, now });
/** The audit's case: attempted every 5 minutes, failing every time (lastFetchAt fresh, lastOkAt days old). */
const failing = (key: string, failures: number, now = NOW) => reg.setFeedState({ selectorKey: key, lastFetchAt: now - 2 * MIN, lastOkAt: now - 3 * DAY, failures, lastError: "HTTP 503 from the source", nextFetchAt: now + 5 * MIN });
const healthy = (key: string, now = NOW) => reg.setFeedState({ selectorKey: key, lastFetchAt: now - MIN, lastOkAt: now - MIN, failures: 0, lastError: null, nextFetchAt: now + 5 * MIN });
const health = (now = NOW, stale: number | null = null) => computeFeedHealth(reg, now, { staleLimit: (k) => (k === DEBT ? stale : null) });
const fetched = (key: string, refusals: string[]) => ({ fetched: [{ key, written: 0, refusals, awaitingFinal: 0, error: null, skipped: false }] });

beforeEach(() => {
  reg = openRegistry(":memory:"); site = fs.mkdtempSync(path.join(os.tmpdir(), "bt-cond-"));
  fs.writeFileSync(path.join(site, "audit.json"), JSON.stringify({ schema: "burnticker.audit/v1", ranAt: new Date(NOW - 10 * MIN).toISOString(), tokens: 1, receipts: 0, mismatches: [], chainChecked: false, ok: true }));
  reg.setStatus("lastCycle", { at: NOW - MIN, errors: [], refusals: [] }, NOW);
  launch(BRONCOS, "BRONCO", MINTS[0]);
});

describe("F06: one active-condition aggregator for ops.json and the check-in", () => {
  test("repeated failure: 21 failed reads in a row are a condition (the old stall check stays silent: the source is attempted on time)", () => {
    failing(SPORTS, 21);
    const s = snap();
    assert.ok(!activeConditions(s, null).some((c) => c.kind === "bt-feed-stall"), "attempts are on schedule, so the stall test cannot see it");
    const h = health();
    const ops = buildOpsJson({ now: NOW, snapshot: s, delta: null, alerts: [], firstLaunchAt: null, health: h });
    assert.deepEqual(ops.conditions, [`bt-feed-down(${SPORTS})`], "ops.json no longer says conditions: []");
    assert.match(ops.conditionDetail![0].text, /21 failed reads in a row\. The last 21 reads failed\. The error was: HTTP 503 from the source/);
    const lines = burntickerCheckinLines({ snapshot: s, delta: null, alerts: [], firstLaunchAt: null, health: h }).join("\n");
    assert.match(lines, new RegExp(`^- conditions now: bt-feed-down\\(${SPORTS}\\)$`, "m"), "the human check-in prints the same list");
    assert.ok(ops.lines.join("\n").includes(`- conditions now: bt-feed-down(${SPORTS})`));
  });

  test("below the alert's threshold (two failures) is not yet a condition; three is", () => {
    failing(SPORTS, 2);
    assert.deepEqual(activeConditions(snap(), health()), []);
    failing(SPORTS, 3);
    assert.deepEqual(activeConditions(snap(), health()).map((c) => c.id), [`bt-feed-down:${SPORTS}`]);
  });

  test("stale: a scheduled source with nothing new past its limit", () => {
    launch(DEBT_RULE, "DEBT", MINTS[1]);
    healthy(SPORTS); healthy(DEBT);
    const c = activeConditions(snap(), health(NOW, 4 * DAY));
    assert.deepEqual(c.map((x) => x.label), [`bt-feed-stale(${DEBT})`]);
    assert.match(c[0].text, /There has been no reading in \d+ days\. The limit is 4 days\./);
  });

  test("disagree and withheld: the adapter's refusals (observed per cycle) are conditions; a clean read clears them", () => {
    launch(DEBT_RULE, "DEBT", MINTS[1]);
    healthy(SPORTS); healthy(DEBT);
    observeCycle(reg, fetched(SPORTS, ["KXNFLGAME-X: the payout and the licensed final disagree (yes ≠ no)"]), NOW - 2 * MIN);
    observeCycle(reg, fetched(DEBT, ["2026-10-15 held: awaiting the final value"]), NOW - 2 * MIN);
    const labels = activeConditions(snap(), health()).map((c) => c.label).sort();
    assert.deepEqual(labels, [`bt-feed-disagree(${SPORTS})`, `bt-feed-withheld(${DEBT})`]);
    observeCycle(reg, fetched(SPORTS, []), NOW - MIN);
    observeCycle(reg, fetched(DEBT, []), NOW - MIN);
    assert.deepEqual(activeConditions(snap(), health()), []);
  });

  test("recovery: the keeper's fold remembers what was active; the next look shows it as recovered for a day, then forgets it", () => {
    failing(SPORTS, 21);
    const m1 = foldConditions({}, activeConditions(snap(), health()), NOW);
    reg.setStatus(CONDITIONS_KEY, m1, NOW);
    healthy(SPORTS, NOW + 5 * MIN);
    const later = NOW + 5 * MIN;
    const v = conditionsView(snap(later), health(later), readConditionMemory(reg), later);
    assert.deepEqual(v.active, []);
    assert.deepEqual(v.recovered.map((r) => r.label), [`bt-feed-down(${SPORTS})`]);
    const ops = buildOpsJson({ now: later, snapshot: snap(later), delta: null, alerts: [], firstLaunchAt: null, health: health(later), conditionMemory: readConditionMemory(reg) });
    assert.deepEqual(ops.conditions, []);
    assert.match(ops.lines.join("\n"), new RegExp(`^- recovered \\(last 24 h\\): bt-feed-down\\(${SPORTS}\\) cleared 0 min ago$`, "m"));
    const m2 = foldConditions(m1, v.active, later);
    assert.equal(m2[`bt-feed-down:${SPORTS}`].clearedAt, later);
    assert.equal(conditionsView(snap(later + RECOVERED_SHOW_MS + MIN), [], m2, later + RECOVERED_SHOW_MS + MIN).recovered.length, 0, "shown for a day only");
    // a relapse starts a new spell
    failing(SPORTS, 3, later + HOUR);
    const m3 = foldConditions(m2, activeConditions(snap(later + HOUR), health(later + HOUR)), later + HOUR);
    assert.equal(m3[`bt-feed-down:${SPORTS}`].since, later + HOUR);
    assert.equal(m3[`bt-feed-down:${SPORTS}`].clearedAt, null);
  });

  test("notification dedupe stays separate: the alert is messaged once a day, the condition is reported on every look", async () => {
    failing(SPORTS, 21);
    const sink = registryAlertSink(reg);
    assert.equal((await raiseFeedAlerts(health(), sink, NOW)).length, 1);
    assert.equal((await raiseFeedAlerts(health(), sink, NOW + 5 * MIN)).length, 0, "deduped by the sink");
    assert.equal(feedAlerts(health()).length, 1);
    for (const t of [NOW, NOW + 5 * MIN, NOW + 10 * MIN]) {
      failing(SPORTS, 21, t); reg.setStatus("lastCycle", { at: t - MIN, errors: [], refusals: [] }, t);
      assert.deepEqual(activeConditions(snap(t), health(t)).map((c) => c.kind), ["bt-feed-down"], "still active");
    }
  });

  test("the host check-in computes the same health from its registry (read-only) and prints the condition", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bt-cond-host-")), "burnticker.db");
    const r = openRegistry(file); const keep = reg; reg = r;
    launch(BRONCOS, "BRONCO", MINTS[0]); failing(SPORTS, 20);
    r.setStatus("lastCycle", { at: NOW - MIN, errors: [], refusals: [] }, NOW);
    r.close(); reg = keep;
    const lines = (await burntickerCheckin({ now: NOW, registryFile: file, siteDir: site, readAlerts: () => [] })).join("\n");
    assert.match(lines, new RegExp(`^- conditions now: .*bt-feed-down\\(${SPORTS}\\)`, "m"), lines);
    const again = openRegistry(file);
    assert.equal(again.getStatus(CONDITIONS_KEY), null, "the check-in never writes the memory");
    again.close();
  });

  test("the keeper wires it: ops.json gets the health and the fold is written after each publish", (t) => {
    const k = path.join(import.meta.dirname, "..", "scripts", "burnticker-keeper.mts");
    if (!fs.existsSync(k)) { t.skip("not in this tree"); return; }
    const s = fs.readFileSync(k, "utf8");
    assert.match(s, /buildOpsJson\(\{[^\n]*health, conditionMemory: memory, signals, heartbeat: heartbeat\.state, hostFacts(, tradeClicks: [^\n]*)? \}\)/);   // campaign readiness 2026-10-19 adds the trade-click counts after it
    assert.match(s, /registry\.setStatus\(CONDITIONS_KEY, foldConditions\(memory, activeConditions\(r\.snapshot, health, \{ \.\.\.signals, alerts, lastCycleAt: r\.snapshot\?\.lastCycle\?\.at \?\? null \}\), now\), now\)/);
    // second audit A-7: the unit check's computed alerts and the budget's lines reach the conditions
    // HB-82 (hourly run 6): and today's missing registry snapshot
    assert.match(s, /const signals = \{ units: unitCheck\.active, budget: budget\.lines\(\), snapshot: \(\(\) => \{ try \{ return snapshotMissingFact\(registry, now\); \} catch \{ return null; \} \}\)\(\) \};/);
  });
});

// SECOND 2026-10-18 AUDIT A-7: ops.json said "conditions now: none" with the synthetic creator's unit failed since the day before and
// API-Sports on hold since the morning. Failed units, backup trouble, budget holds and a keeper refusal are now conditions too.
describe("A-7: units, backups, budget holds and a keeper refusal are conditions", () => {
  test("a failed unit and a provider on hold appear in ops.json and the check-in; neither is 'none'", () => {
    healthy(SPORTS);
    const s = snap();
    const units = [{ kind: "bt-unit-failed", key: "bt-unit-failed:mct-burnticker-synth.service", text: "One unit is failed or not running: mct-burnticker-synth.service." }, { kind: "bt-backup-failed", key: "bt-backup-failed", text: "No backup status was found." }];
    const budget = [{ source: "api-sports", label: "API-Sports", state: "hold" as const, used: 100, budget: 100 }, { source: "helius", label: "Helius", state: "ok" as const, used: 5, budget: 100 }];
    const ops = buildOpsJson({ now: NOW, snapshot: s, delta: null, alerts: [], firstLaunchAt: null, health: health(), signals: { units, budget } });
    assert.deepEqual(ops.conditions, ["bt-unit-failed(mct-burnticker-synth.service)", "bt-backup-failed", "bt-api-budget-hold(api-sports)"]);
    const lines = ops.lines.join("\n");
    assert.match(lines, /^- conditions now: bt-unit-failed\(mct-burnticker-synth\.service\), bt-backup-failed, bt-api-budget-hold\(api-sports\)$/m);
    assert.doesNotMatch(lines, /conditions now: none/);
    assert.match(lines, /bt-api-budget-hold\(api-sports\): API-Sports is on hold: today's budget is spent \(100 of 100\)\./);
    // the same thing clears into "recovered" once it is fixed
    const m = foldConditions({}, activeConditions(s, health(), { units, budget }), NOW);
    const v = conditionsView(snap(NOW + HOUR), health(NOW + HOUR), m, NOW + HOUR, { units: [], budget: [] });
    assert.deepEqual(v.recovered.map((r) => r.label).sort(), ["bt-api-budget-hold(api-sports)", "bt-backup-failed", "bt-unit-failed(mct-burnticker-synth.service)"]);
  });

  test("a keeper refusal newer than the last cycle is a condition (read from the alert rows); an older one is not", () => {
    healthy(SPORTS);
    const s = snap();   // last cycle one minute ago
    const refusedLater = [{ ts: NOW - 30_000, kind: "bt-keeper-refused", text: "The keeper refused to start. The reason given was: no key", seenAt: null, sent: false }];
    assert.deepEqual(buildOpsJson({ now: NOW, snapshot: s, delta: null, alerts: refusedLater, firstLaunchAt: null }).conditions, ["bt-keeper-refused"]);
    const refusedBefore = [{ ...refusedLater[0], ts: NOW - 10 * MIN }];
    assert.deepEqual(buildOpsJson({ now: NOW, snapshot: s, delta: null, alerts: refusedBefore, firstLaunchAt: null }).conditions, [], "the keeper ran a cycle since");
  });
});
