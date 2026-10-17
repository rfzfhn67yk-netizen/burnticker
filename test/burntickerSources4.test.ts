// sources-4 (2026-10-12; the owner, ~18:50 Denver: "scheduled burns every time an existing coin hits a new all-time high, or stuff like
// that"). Record daily closes on the Burn Derby window sample: a reference coin's close at 00:00 UTC against its record (its history or
// the previous 30/90 days), recurring or once; the baseline locked at review; a reference already at its record refused; a withheld day
// out of the record. Boundary values are seeded snapshots (keyless Hermes answers 401; see burntickerDerby.test.ts). The record TVL
// reader runs on a real DefiLlama response captured read-only on 2026-10-13 00:48 UTC (config/burnticker/fixtures/http/
// llama.protocol.raydium-amm.json, an excerpt); market value, rank and 24-hour volume are refused or not built, with the terms read.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lockRule, isOneShot, ruleStatement, validateRule, type BurnRule } from "@/lib/burnticker/rules";
import { rulesSha256 } from "@/lib/burnKeeper/rules";
import { runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { openRegistry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { DerbyAdapter, type HermesLike } from "@/lib/burnticker/derby/adapter";
import { derbyAdmission } from "@/lib/burnticker/derby/admission";
import { derbySeriesId, derbySpecProblems } from "@/lib/burnticker/derby/spec";
import { atHighOnLaunch, buildHighBaseline, decideHigh, highReview, highText, recordBefore, HIGH_ALREADY_SENTENCE, type HighSpec } from "@/lib/burnticker/derby/high";
import { describeRule, windowKindOf, WINDOW_SENTENCE } from "@/lib/burnticker/describe";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import { dialsFor } from "@/lib/burnticker/dials";
import { shareShapeOf } from "@/lib/burnticker/launchPresets";
import { preflightSelector } from "@/lib/burnticker/coverage/preflight";
import { feedById, fixtureReadings, loadSourceEntries } from "@/lib/burnticker/catalogue";
import { parseBody, recordReadings } from "@/lib/burnticker/sources/attestedHttp";
import { oneShotEligibility, RECORD_ALREADY_SENTENCE } from "@/lib/burnticker/oneShotEligibility";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import type { OracleAdapter } from "@/lib/burnticker/oracle/types";
import { B, WIF, WIF_FEED, launchSingle, seedCross, fixtureFetch } from "./burntickerDerbyHelpers.ts";

const cfgLint = loadCopyLintConfig();
const lint = (t: string) => { const r = lintCopy(t, cfgLint); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };
const ROOT = path.join(import.meta.dirname, "..");
const ALL: HighSpec = { selector: "high", u: WIF, span: "all", once: false, season: { start: "2026-10-04", days: null }, baseline: { kind: "all", since: "2024-01-01", through: "2026-10-03", high: "4.5", highOn: "2024-03-30", last: "1", feedBegan: true } };
const ONCE: HighSpec = { ...ALL, once: true, season: { start: "2026-10-04", days: 30 } };
const closes30 = (last: string) => [...Array.from({ length: 29 }, (_, i) => (i === 10 ? "2.5" : "2")), last];
const W30: HighSpec = { ...ALL, span: 30, baseline: { kind: "window", through: "2026-10-03", closes: closes30("1.9") } };
const ruleOf = (spec: HighSpec, fraction = 0.02): BurnRule => lockRule({ schema: "burnticker.rules/v1", oracle: "derby", series: derbySeriesId(spec, rulesSha256), market: null, filter: {}, kind: "scalar", binary: null, scalar: { unit: 1, perUnit: { fractionOfPool: fraction }, baseline: 0, direction: "up" }, pair: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, derby: spec, onEnd: { windDownDays: 28, sweepThresholdLamports: 50_000_000 } }).rule;

const stub: OracleAdapter = { id: "stub", searchSeries: async () => [], seriesInfo: async () => null, settledSince: async () => ({ events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }), impliedChance: async () => ({ chance: null, marketTicker: null, closeTime: null, basis: "stub" }) };
/** One record-close coin, launched 2026-10-04 12:00 UTC, with the keeper wired to the derby adapter (no Hermes, no RPC: seeded snapshots). */
async function world(spec: HighSpec, fraction = 0.02) {
  const registry = openRegistry(":memory:"), program = new FakeBurnProgram("devnet"), clock = { now: B(4) + 13 * 3600_000 };
  program.now = () => clock.now; program.autoRegisterPool = true;
  const logs: string[] = [];
  const t = await launchSingle(registry, program, ruleOf(spec, fraction), "WIFREC");
  const adapter = new DerbyAdapter({ registry, hermes: null, pools: null, fetchImpl: fixtureFetch(), now: () => clock.now, log: (l) => logs.push(l) });
  const deps: KeeperDeps = { registry, program, oracles: { kalshi: stub, catalogue: stub, derby: adapter }, derby: { sample: (x) => adapter.sample(x), plan: () => adapter.plan(), ended: (x) => adapter.ended(x) }, attester: "KeeperDataKey1111111111111111111111111111111", log: (l) => logs.push(l), now: () => clock.now, dryRun: false };
  /** Pyth's Solana snapshot for the boundary at 00:00 UTC on 2026-10-<d> (published 5 s after it) and, unless `cross` is null, the cross-read. */
  const close = (d: number, value: string, cross: string | null = value) => {
    adapter.store.putSample({ key: `pyth:${WIF_FEED}`, kind: "pyth", ts: B(d) + 60_000, slot: 1, value, detail: { source: "pyth-solana", publishTime: B(d) / 1000 + 5 } });
    if (cross !== null) seedCross({ adapter }, WIF, B(d), cross);
  };
  return { registry, program, adapter, deps, clock, t, close, logs };
}
const events = (w: Awaited<ReturnType<typeof world>>) => w.registry.receipts(w.t.mint).filter((r) => !["winddown", "drain", "sweep"].includes(r.kind));

describe("the rule shape: a record daily close, locked with its baseline", () => {
  test("the block validates; the series names span and once and hashes the whole block; the shapes the rule refuses", () => {
    for (const s of [ALL, ONCE, W30]) assert.deepEqual(derbySpecProblems(s), []);
    const r = ruleOf(ALL);
    assert.match(r.series!, /^high:WIF:all:[0-9a-f]{10}$/);
    assert.match(ruleOf(ONCE).series!, /^high:WIF:all-once:[0-9a-f]{10}$/);
    assert.match(ruleOf(W30).series!, /^high:WIF:30d:[0-9a-f]{10}$/);
    assert.notEqual(ruleOf({ ...ALL, baseline: { ...ALL.baseline, high: "4.6" } as HighSpec["baseline"] }).series, r.series, "the baseline is part of the hash");
    assert.equal(isOneShot(ruleOf(ONCE)), true); assert.equal(isOneShot(r), false);
    assert.equal(shareShapeOf(ruleOf(ONCE, 1)), "oneShot"); assert.equal(dialsFor(r).bounds.max < 1, true);
    assert.match(derbySpecProblems({ ...ONCE, season: { start: "2026-10-04", days: null } }).join(";"), /needs a run length/);
    assert.match(derbySpecProblems({ ...ALL, season: { start: "2026-10-04", days: 30 } }).join(";"), /no end date/);
    assert.match(derbySpecProblems({ ...ALL, season: { start: "2026-10-05", days: null } }).join(";"), /day after the baseline's last close/);
    assert.match(derbySpecProblems({ ...W30, baseline: { kind: "window", through: "2026-10-03", closes: ["1", "2"] } }).join(";"), /the 30 closes before launch/);
    assert.match(derbySpecProblems({ ...ALL, u: { ...WIF, pyth: null, pool: "So11111111111111111111111111111111111111112" } }).join(";"), /reads a Pyth feed/);
    assert.throws(() => validateRule({ ...r, scalar: { ...r.scalar!, unit: 2 } }), /record-close rule's scalar/);
    assert.throws(() => validateRule({ ...r, pair: { pairId: "wif-rec-pair", side: "A", counterpartMint: null } }), /single coin/);
    assert.throws(() => validateRule({ ...r, inverse: true }), /Burn Derby rules cannot be inverted/);
  });

  test("the baseline from a history read: the date the feed began, the high and its day, gaps and an already-at-its-record reference", () => {
    const h = [{ day: "2026-09-30", close: "3" }, { day: "2026-10-01", close: "4" }, { day: "2026-10-02", close: "2" }, { day: "2026-10-03", close: "2.5" }];
    const b = buildHighBaseline("all", h, "2026-10-03", { feedBegan: true });
    assert.deepEqual(b, { baseline: { kind: "all", since: "2026-09-30", through: "2026-10-03", high: "4", highOn: "2026-10-01", last: "2.5", feedBegan: true } });
    // the last close before launch is the record → already decided (never a day-one burn); a tie with the old high counts as at it
    for (const last of ["4.1", "4"]) {
      const at = buildHighBaseline("all", [...h.slice(0, 3), { day: "2026-10-03", close: last }], "2026-10-03", { feedBegan: true });
      assert.ok("refusal" in at && at.refusal.code === "already-decided" && at.refusal.reason.startsWith(HIGH_ALREADY_SENTENCE), JSON.stringify(at));
    }
    const noLast = buildHighBaseline("all", h.slice(0, 3), "2026-10-03", { feedBegan: true });
    assert.ok("refusal" in noLast && /no daily close for 2026-10-03/.test(noLast.refusal.reason));
    const gap = buildHighBaseline(30, h, "2026-10-03", { feedBegan: false });
    assert.ok("refusal" in gap && /30 daily closes before launch are not all readable \(26 missing/.test(gap.refusal.reason));
    assert.match(atHighOnLaunch({ kind: "window", through: "2026-10-03", closes: closes30("2.6") })!, /above each of the 29 closes before it/);
    assert.equal(atHighOnLaunch(W30.baseline), null);
  });

  test("the record before a day, the cross-check, and the review's current high and distance", () => {
    assert.deepEqual(recordBefore(ALL, "2026-10-04", []), { record: "4.5", on: "2024-03-30" });
    assert.deepEqual(recordBefore(ALL, "2026-10-06", [{ day: "2026-10-04", close: "4.7" }]), { record: "4.7", on: "2026-10-04" });
    // 30 days: the window slides; the 2.5 close on 2026-09-14 drops out after 30 days
    assert.deepEqual(recordBefore(W30, "2026-10-04", []), { record: "2.5", on: "2026-09-14" });
    assert.deepEqual(recordBefore(W30, "2026-10-15", []), { record: "2", on: "2026-09-15" });
    const ok = decideHigh("WIF", "4.6", "4.59", { record: "4.5", on: "2024-03-30" });
    assert.equal(ok.status, "decided"); assert.equal(ok.status === "decided" && ok.record, true);
    assert.equal(decideHigh("WIF", "4.5", "4.5", { record: "4.5", on: "2024-03-30" }).status === "decided" && (decideHigh("WIF", "4.5", "4.5", { record: "4.5", on: "2024-03-30" }) as { record: boolean }).record, false, "equal to the record is not a record");
    assert.match((decideHigh("WIF", "4.6", "4.4", { record: "4.5", on: "2024-03-30" }) as { reason: string }).reason, /disagrees by 4\.44444\d* points/);
    assert.match((decideHigh("WIF", "4.6", null, { record: "4.5", on: "2024-03-30" }) as { reason: string }).reason, /cross-read for WIF was not available/);
    const rv = highReview(ALL);
    assert.deepEqual([rv.high, rv.highOn, rv.last, rv.lastOn, rv.distancePct], ["4.5", "2024-03-30", "1", "2026-10-03", "77.78"]);
    lint(rv.line);
  });
});

describe("settlement: the keeper on the 00:00 UTC window sample", () => {
  test("RECURRING: one unit per record day; a withheld day burns nothing and its close stays out of the record", async () => {
    const w = await world(ALL);
    w.close(5, "1.1");            // 2026-10-04 closes at 1.1: not a record
    w.close(6, "4.6", null);      // 2026-10-05: a record on Pyth, but no cross-read → withheld (and 4.6 never joins the record)
    w.close(7, "4.55");           // 2026-10-06: above 4.5 (the withheld 4.6 does not count) → a record
    w.close(8, "4.56");           // 2026-10-07: above 4.55 → a record
    w.close(9, "4.5");            // 2026-10-08: under the record → nothing
    w.clock.now = B(9) + 3 * 3600_000;
    await runCycle(w.deps); await runCycle(w.deps);
    const rows = w.adapter.store.windows(`derby:${ruleOf(ALL).series}`).map((r) => [r.windowId, r.status, r.value]);
    assert.deepEqual(rows, [["2026-10-04", "decided", "0"], ["2026-10-05", "withheld", null], ["2026-10-06", "decided", "1"], ["2026-10-07", "decided", "1"], ["2026-10-08", "decided", "0"]]);
    assert.deepEqual(events(w).filter((r) => r.units > 0).map((r) => r.eventId.slice(0, 15)), ["high-2026-10-06", "high-2026-10-07"]);
    assert.equal(w.registry.ruleEnd(w.t.mint), null, "a recurring record coin has no end");
    const withheld = w.adapter.store.window(`derby:${ruleOf(ALL).series}`, "2026-10-05")!;
    assert.match(withheld.reason!, /cross-read for WIF was not available/);
  });

  test("ONE-SHOT: the whole share once on the first record day, then the rule ends; days that are not records give no reading", async () => {
    const w = await world(ONCE, 1);
    w.close(5, "1.1"); w.close(6, "4.51"); w.close(7, "4.9");
    w.clock.now = B(7) + 3 * 3600_000;
    await runCycle(w.deps); await runCycle(w.deps);
    const ev = events(w);
    assert.equal(ev.length, 1); assert.match(ev[0].eventId, /^high-2026-10-05:/); assert.equal(ev[0].units, 1);
    assert.match(w.registry.ruleEnd(w.t.mint)!.reason, /one-shot settled/); assert.equal(w.registry.ruleEnd(w.t.mint)!.mode, "drain");
    assert.equal(w.adapter.store.window(`derby:${ruleOf(ONCE).series}`, "2026-10-06"), null, "nothing is read after the record");
  });

  test("ONE-SHOT with no record in its run: one closing reading of 0, and the coin ends with nothing burned", async () => {
    const spec: HighSpec = { ...ONCE, season: { start: "2026-10-04", days: 3 } };
    const w = await world(spec, 1);
    w.close(5, "1.1"); w.close(6, "1.2"); w.close(7, "1.3");
    w.clock.now = B(7) + 3 * 3600_000;
    await runCycle(w.deps); await runCycle(w.deps);
    const ev = events(w);
    assert.equal(ev.length, 1); assert.match(ev[0].eventId, /^ended-2026-10-06:/); assert.equal(ev[0].units, 0);
    assert.match(w.registry.ruleEnd(w.t.mint)!.reason, /one-shot settled/); assert.equal(w.registry.ruleEnd(w.t.mint)!.mode, "winddown");
  });

  test("30-DAY: a record over the previous 30 closes, the locked closes first", async () => {
    const w = await world(W30);
    w.close(5, "2.4");   // 2026-10-04: under 2.5 (2026-09-14, still inside the 30 days) → nothing
    w.close(6, "2.6");   // 2026-10-05: above every close of the 30 days before → a record
    w.clock.now = B(6) + 3 * 3600_000;
    await runCycle(w.deps); await runCycle(w.deps);
    assert.deepEqual(events(w).map((r) => [r.eventId.slice(0, 15), r.units]), [["high-2026-10-04", 0], ["high-2026-10-05", 1]]);
  });

  test("the review's history read walks Pyth's boundaries back until the feed began", async () => {
    const w = await world(ALL);
    const have = new Map([[B(1), "2"], [B(2), "3"], [B(3), "2.5"], [B(4), "2.6"]]);
    const hermes: HermesLike = { atBoundary: async (_f, ts) => { const v = have.get(ts * 1000); return v ? { ok: true, point: { feed: WIF_FEED, price: "0", conf: "0", expo: 0, value: v, publishTime: ts, slot: null, updateSha256: "0".repeat(64), updateBase64: "", url: "x" } } : { ok: false, reason: "no update" }; } };
    const a = new DerbyAdapter({ registry: w.registry, hermes, pools: null, fetchImpl: fixtureFetch(), now: () => B(4) + 3600_000 });
    const h = await a.historyCloses(WIF, "2026-10-03", 40);
    assert.deepEqual(h.closes.map((c) => `${c.day}=${c.close}`), ["2026-09-30=2", "2026-10-01=3", "2026-10-02=2.5", "2026-10-03=2.6"]);
    assert.equal(h.feedBegan, true);
    const b = await a.highBaseline(WIF, "all", B(4) + 3600_000);
    assert.deepEqual(b, { baseline: { kind: "all", since: "2026-09-30", through: "2026-10-03", high: "3", highOn: "2026-10-01", last: "2.6", feedBegan: true } });
  });
});

describe("launch gates and the words", () => {
  test("admission: a baseline read for another day is refused; the preflight refuses a reference at its record (already decided)", async () => {
    const at = { registry: openRegistry(":memory:"), fetchImpl: fixtureFetch() };
    assert.deepEqual(await derbyAdmission(ruleOf(ALL), { ...at, now: Date.parse("2026-10-04T15:00:00Z") }), []);
    assert.match((await derbyAdmission(ruleOf(ALL), { ...at, now: Date.parse("2026-10-05T01:00:00Z") })).map((r) => r.reason).join(";"), /read for a launch on 2026-10-04, but today is 2026-10-05/);
    const top: HighSpec = { ...ALL, baseline: { ...ALL.baseline, high: "5", highOn: "2026-10-03", last: "5" } as HighSpec["baseline"] };
    const pf = await preflightSelector(ruleOf(top), { now: Date.parse("2026-10-04T15:00:00Z") });
    assert.equal(pf.refusal?.code, "already-decided"); assert.ok(pf.refusal!.reason.startsWith(HIGH_ALREADY_SENTENCE));
  });

  test("both sentences say daily close, state the baseline and its date, never intraday; lint-clean; one window sentence", () => {
    for (const spec of [ALL, ONCE, W30, { ...ALL, baseline: { ...ALL.baseline, feedBegan: false } as HighSpec["baseline"] }]) {
      const r = ruleOf(spec, spec.once ? 1 : 0.02);
      const t = describeRule(r, { ticker: "WIFREC" });
      for (const s of [t.paragraph, t.oneLiner, ruleStatement(r), ruleOneLiner(r)]) { lint(s); assert.doesNotMatch(s, /\bprices?\b|all[- ]time|\bATH\b/i); }
      assert.match(t.paragraph, /daily close/); assert.match(t.paragraph, /A higher value during the day counts for nothing/);
      const kind = windowKindOf(r);
      assert.equal(kind, spec.once ? "one-shot" : "perpetual");
      assert.equal([...t.paragraph.matchAll(WINDOW_SENTENCE[kind])].length, 1, t.paragraph);
      if (spec.span === "all") assert.match(t.paragraph, (spec.baseline as { feedBegan: boolean }).feedBegan ? /the highest daily close since the feed began on 2024-01-01 \(4\.5, on 2024-03-30\)/ : /since 2024-01-01, the first day read/);
      else assert.match(t.paragraph, /the highest of the 30 daily closes from 2026-09-04 to 2026-10-03/);
    }
    assert.equal(describeRule(ruleOf(ALL), { ticker: "X" }).ticker, "WIFREC");
    assert.equal(highText(ONCE, "S").name, "WIF Next Record Close");
    assert.equal(ruleOneLiner(ruleOf(W30)), "burns on every day WIF closes above each of the previous 30 daily closes");
  });
});

describe("the other milestone shapes: terms first", () => {
  const entry = (id: string) => loadSourceEntries().find((e) => e.id === id) as unknown as { operator: string; launchable: boolean; terms?: { url: string; readAt: string; read: string; verdict: string }; note?: string; flags: string[] };
  test("every new entry carries operator, terms page, read date, a one-paragraph read and a verdict", () => {
    for (const [id, verdict] of [["pyth.recordClose", "allowed-with-limits"], ["defillama.tvlrecord", "not-allowed"], ["defillama.tvlnext", "not-allowed"], ["coingecko.mcap", "not-allowed"], ["coingecko.rank", "not-allowed"]] as const) {
      const e = entry(id);
      assert.ok(e?.operator, id); assert.equal(e.terms?.verdict, verdict, id); assert.equal(e.terms!.readAt, "2026-10-12");
      assert.match(e.terms!.url, /^https:\/\//); assert.ok(e.terms!.read.length > 200 && !/\n/.test(e.terms!.read), `${id}: one paragraph`);
      lint(e.terms!.read);
    }
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, "config/burnticker/sources.json"), "utf8")) as { notSources: { id: string; reason: string }[] };
    assert.match(j.notSources.find((n) => n.id === "crypto.volume24h")!.reason, /^Not built in sources-4/);
  });

  test("record TVL (DefiLlama): the reader works on the captured history and stays off until DefiLlama consents", async () => {
    const f = feedById("defillama.tvlrecord:raydium-amm")!;
    assert.equal(f.launchable.ok, false); assert.match(f.launchable.why!, /written consent/);
    const now = Date.parse("2026-10-13T00:48:16Z");
    const { readings, refusals } = fixtureReadings(f, now);
    assert.deepEqual(refusals, []);
    assert.equal(readings[0].id, "2021-03-18", "the first day has nothing before it, so it gives no reading");
    assert.equal(readings[readings.length - 1].id, "2026-10-12", "only complete days");
    const rec = readings.filter((r) => r.value === "1").map((r) => r.id);
    assert.equal(rec[rec.length - 1], "2025-01-23", "the last record day in the captured history");
    assert.match(readings.find((r) => r.id === "2025-01-23")!.title!, /a record \(the record before it was \d+ on 2025-01-2\d\)/);
    const once = fixtureReadings(feedById("defillama.tvlnext:raydium-amm")!, now).readings;
    assert.ok(once.every((r) => r.value === "1") && once.length === rec.length);
    // at its record on the last complete day → already decided; below it → open
    const body = { tvl: [{ date: Date.parse("2026-10-10T00:00:00Z") / 1000, totalLiquidityUSD: 5 }, { date: Date.parse("2026-10-11T00:00:00Z") / 1000, totalLiquidityUSD: 7 }, { date: Date.parse("2026-10-12T00:00:00Z") / 1000, totalLiquidityUSD: 9 }] };
    const el = oneShotEligibility("defillama.tvlnext:raydium-amm", feedById("defillama.tvlnext:raydium-amm")!.config, body, now);
    assert.equal(el.decided, true); assert.ok(el.reason!.startsWith(RECORD_ALREADY_SENTENCE)); lint(el.reason!);
    assert.equal(oneShotEligibility("defillama.tvlrecord:raydium-amm", f.config, { tvl: [...body.tvl.slice(0, 2), { date: body.tvl[2].date, totalLiquidityUSD: 6 }] }, now).decided, false);
    // the preflight stops at the gate: an aggregator and terms that need consent
    const pf = await preflightSelector({ ...ruleOf(ALL), oracle: "catalogue", series: "defillama.tvlrecord:raydium-amm", derby: undefined, kind: "scalar" } as BurnRule, { now });
    assert.equal(pf.refusal?.code, "not-primary");
    for (const inv of [false, true]) { const t = describeRule(validateRule({ ...ruleOf(ALL), oracle: "catalogue", series: "defillama.tvlrecord:raydium-amm", derby: undefined, ...(inv ? { inverse: true } : {}) }), { ticker: "RAYREC" }); lint(t.paragraph); assert.match(t.paragraph, /DefiLlama/); }
  });

  test("recordReadings: all-time and windowed records, the first days without a full window give no reading", () => {
    const xs = ["1", "3", "2", "4", "4", "5"].map((v, i) => ({ id: `2026-10-0${i + 1}`, at: `2026-10-0${i + 1}`, result: null, value: v, title: "t", sourceUrl: "https://x" }));
    assert.deepEqual(recordReadings(xs, { span: "all" }, "T").map((r) => `${r.id.slice(8)}:${r.value}`), ["02:1", "03:0", "04:1", "05:0", "06:1"]);
    assert.deepEqual(recordReadings(xs, { span: 2 }, "T").map((r) => `${r.id.slice(8)}:${r.value}`), ["03:0", "04:1", "05:0", "06:1"]);
    assert.deepEqual(recordReadings(xs, { span: "all", once: true }, "T").map((r) => r.id.slice(8)), ["02", "04", "06"]);
  });

  test("market value and rank (CoinGecko) are refused at the gate with the terms read, before anything is fetched", async () => {
    for (const id of ["coingecko.mcap:solana", "coingecko.rank:solana"]) {
      const f = feedById(id)!;
      assert.equal(f.launchable.ok, false); assert.match(f.launchable.why!, /Refused at preflight/);
      let fetched = false;
      const pf = await preflightSelector({ ...ruleOf(ALL), oracle: "catalogue", series: id, derby: undefined } as BurnRule, { fetchImpl: async () => { fetched = true; throw new Error("no"); } });
      assert.equal(pf.refusal?.code, "not-primary"); assert.match(pf.refusal!.reason, /CoinPaprika's free plan is personal only/); assert.equal(fetched, false);
    }
    void parseBody;
  });
});
