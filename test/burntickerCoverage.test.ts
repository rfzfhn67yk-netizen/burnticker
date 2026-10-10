// The settlement-coverage audit (2026-10-10; owner decision: Kalshi is not a settlement input). Covers: the matrix's verdict logic
// (settleable needs a primary AND an independent cross-read; Kalshi excluded from primaries and cross-reads even when sources.json names
// it; the independent-operator-and-domain rule), the script's exit code on an uncovered category, the creation preflight's refusal paths
// (Kalshi, no cross-read, disagreement, unreadable or stale primary; Polymarket chain vs Gamma) and its wiring into the launch pipeline, the
// API's shape, the committed document (fresh render + copy lint) — and THE CI GATE: no category of config/burnticker/categories.json
// is uncovered under the offline fixtures.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildCoverage, coverageExitCode, coverageMatrix, compareFact, crossReadEligibility, describeEntry, domainOf, historicalDryRun, isBusinessDay, nextExpected, preflightSelector, preflightStrict, primaryEligibility, renderCoverageMarkdown, usFederalHolidays, type CategoryDef, type SourceDescriptor } from "@/lib/burnticker/coverage";
import { allDescriptors } from "@/lib/burnticker/coverage/report";
import { catalogue, feedById, loadFixture, loadSourceEntries } from "@/lib/burnticker/catalogue";
import { loadCategories } from "@/lib/burnticker/browse";
import { validateRule, BURNTICKER_RULES_SCHEMA } from "@/lib/burnticker/rules";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { resetCoverageCache } from "@/lib/burnticker/api/v1";
import { buildOpenApi } from "@/lib/burnticker/api/spec";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import type { HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import { API, CREATOR, callRoute, makeWorld, validateSchema } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";
import { BUCS_CID, EAGLES_CID, PM_BUCS, polyClient } from "./burntickerPolyHelpers.ts";

const NOW = Date.parse("2026-10-10T22:00:00Z");

// ---- synthetic sources for the verdict logic ----
const src = (o: Partial<SourceDescriptor> & { id: string }): SourceDescriptor => ({ kind: "attested-http", tier: 4, title: o.id, operator: `op-${o.id}`, domain: `${o.id.replace(/\W/g, "")}.gov`, fact: null, launchable: true, launchableWhy: null, readable: true, snapshot: false, flags: [], venue: "feed", ...o });
const cat = (id: string, feeds: string[], polymarket: string[] = [], kalshi: string[] = []): CategoryDef => ({ id, label: id, blurb: "", feeds, polymarket, kalshi });

describe("the matrix: verdicts", () => {
  test("settleable needs a primary AND an independent cross-read of the same fact", () => {
    const p = src({ id: "a.primary", fact: { id: "f1" } }), c = src({ id: "b.mirror", fact: { id: "f1" }, flags: ["cross-read only: test"], launchable: false });
    const m = coverageMatrix([p, c], [cat("econ", ["a.primary"], ["economy"])]);
    assert.equal(m.categories[0].verdict, "settleable");
    assert.deepEqual(m.categories[0].crossReads.map((x) => [x.id, x.of]), [["b.mirror", "a.primary"]]);
    assert.equal(m.categories[0].kinds.find((k) => k.kind === "scalar")!.verdict, "settleable");
    // Without the mirror: a lone primary is not enough; Polymarket makes it adjudicated-only, its absence uncovered.
    assert.equal(coverageMatrix([p], [cat("econ", ["a.primary"], ["economy"])]).categories[0].verdict, "adjudicated-only");
    const bare = coverageMatrix([p], [cat("econ", ["a.primary"])]);
    assert.equal(bare.categories[0].verdict, "uncovered");
    assert.ok(bare.uncovered.some((u) => u.category === "econ" && u.kind === "scalar" && /without an independent cross-read/.test(u.why)));
  });

  test("the independent-operator rule: same operator or same domain is not a cross-read; another fact is not either", () => {
    const p = src({ id: "a.primary", operator: "Bureau X", domain: "x.gov", fact: { id: "f1" } });
    assert.match(crossReadEligibility(src({ id: "a.copy", operator: "bureau x", domain: "y.org", fact: { id: "f1" } }), p).why!, /same operator/);
    assert.match(crossReadEligibility(src({ id: "a.copy2", operator: "Someone Else", domain: "x.gov", fact: { id: "f1" } }), p).why!, /same or unknown domain/);
    assert.match(crossReadEligibility(src({ id: "a.other", operator: "Someone Else", domain: "z.org", fact: { id: "f2" } }), p).why!, /different fact/);
    assert.match(crossReadEligibility(src({ id: "a.keyed", operator: "Someone Else", domain: "z.org", fact: { id: "f1" }, readable: false }), p).why!, /not readable/);
    assert.equal(crossReadEligibility(src({ id: "a.ok", operator: "Someone Else", domain: "z.org", fact: { id: "f1" } }), p).ok, true);
    assert.equal(domainOf("https://api.fiscaldata.treasury.gov/services/api"), "treasury.gov");
    assert.equal(domainOf("https://fred.stlouisfed.org/graph/fredgraph.csv?id=UNRATE"), "stlouisfed.org");
    assert.equal(domainOf("https://wikimedia.org/api/rest_v1/{article}/x"), "wikimedia.org");
  });

  test("Kalshi is excluded from primaries and cross-reads even when sources.json carries it", () => {
    const entries = loadSourceEntries();
    const fake = { ...(entries.find((e) => e.id === "fred.UNRATE") as HttpSourceConfig), id: "kalshi.KXUNRATE", operator: "Kalshi", request: { url: "https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXU3", format: "json" as const }, launchable: true };
    const all = allDescriptors([...entries, fake]);
    const k = all.find((s) => s.id === "kalshi.KXUNRATE")!;
    assert.equal(k.venue, "kalshi");
    assert.match(primaryEligibility(k).why!, /Kalshi/);
    // Same fact as fred.UNRATE, another operator and domain — still never a cross-read.
    assert.match(crossReadEligibility(k, all.find((s) => s.id === "fred.UNRATE")!).why!, /Kalshi/);
    // Even an id-less disguise is caught by the domain.
    assert.match(primaryEligibility({ ...k, id: "x.y", operator: "Someone", venue: "feed" }).why!, /Kalshi/);
    const m = coverageMatrix(all, [cat("economics", ["fred.UNRATE", "kalshi.KXUNRATE"], ["economy"], ["Economics"])]);
    const c = m.categories[0];
    assert.ok(!c.primaries.some((p) => /kalshi/i.test(p.id)) && !c.crossReads.some((x) => /kalshi/i.test(x.id)));
    assert.ok(c.notPrimary.some((n) => n.id === "kalshi.KXUNRATE" && /Kalshi/.test(n.why)));
    assert.ok(m.excluded.some((x) => x.id === "kalshi.KXUNRATE"));
    assert.deepEqual(c.kalshiDiscoveryOnly, ["Economics"]);
    assert.equal(c.verdict, "settleable", "fred.UNRATE ↔ bls.LNS14000000 carries it, Kalshi adds nothing");
  });

  test("team coins and season matchups are uncovered (sports only); one game as a pair is Polymarket's", () => {
    const m = coverageMatrix([], [cat("sports", [], ["sports"]), cat("science", [], ["space"])]);
    const s = m.categories.find((c) => c.id === "sports")!, sci = m.categories.find((c) => c.id === "science")!;
    assert.equal(s.kinds.find((k) => k.kind === "team-coin")!.verdict, "uncovered");
    assert.equal(s.kinds.find((k) => k.kind === "matchup-season")!.verdict, "uncovered");
    assert.equal(s.kinds.find((k) => k.kind === "matchup-game")!.verdict, "adjudicated-only");
    assert.ok(!sci.kinds.some((k) => k.kind === "team-coin"));
    assert.equal(s.verdict, "adjudicated-only");
    assert.deepEqual(m.summary.withoutPrimary, ["sports", "science"]);
    assert.equal(coverageExitCode(m), 0);
    assert.equal(coverageExitCode(m, { requirePrimary: true }), 1);
    assert.equal(coverageExitCode(coverageMatrix([], [cat("nowhere", [])])), 1);
  });
});

describe("facts, schedules and the dry run", () => {
  test("quarter-end alignment: FRED GFDEBTN ($M) meets Treasury's last daily reading of the quarter, only when the daily series reaches it", () => {
    const q = [{ id: "2026-Q2", at: "2026-Q2", result: null, value: "39462398.000000000", title: null, sourceUrl: "https://x" }];
    const d = (id: string, value: string) => ({ id, at: id, result: null, value, title: null, sourceUrl: "https://x" });
    const days = [d("2026-06-29", "39400000000000.00"), d("2026-06-30", "39462398380774.37"), d("2026-07-01", "39470000000000.00")];
    const fq = { id: "us.debt", scale: 1e6, align: "quarter-end" as const, tolerance: { rel: 1e-5 } }, fd = { id: "us.debt" };
    const r = compareFact(fd, days, fq, q);
    assert.equal(r.comparisons.length, 1); assert.equal(r.comparisons[0].agree, true); assert.equal(r.comparisons[0].period, "2026-Q2");
    assert.equal(compareFact(fd, days.slice(0, 1), fq, q).comparisons.length, 0, "a daily series that stops before the quarter end is not compared");
    assert.equal(compareFact(fd, [d("2026-06-30", "39000000000000")], fq, q).comparisons[0].agree, false);
  });

  test("U.S. federal holidays (observed) and business days", () => {
    const h = usFederalHolidays(2026);
    for (const day of ["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25"]) assert.ok(h.has(day), day);
    assert.equal(isBusinessDay("2026-10-12"), false); assert.equal(isBusinessDay("2026-10-10"), false); assert.equal(isBusinessDay("2026-10-13"), true);
    const debt = feedById("treasury.debt")!.config;
    assert.equal(nextExpected(debt, "2026-10-08", NOW).at, "2026-10-13T21:00:00.000Z", "Friday's record posts on Tuesday (Monday is Columbus Day)");
    assert.equal(nextExpected(debt, "2026-10-09", NOW).at, "2026-10-14T21:00:00.000Z", "after Friday the next record date is Tuesday, posted Wednesday");
    assert.equal(nextExpected(feedById("fred.UNRATE")!.config, "2026-09", NOW).at, "2026-11-20T00:00:00.000Z");
    assert.equal(nextExpected(feedById("edgar.8k:0000320193")!.config, "2026-10-01", NOW).at, null, "event-driven: no schedule, no invented date");
  });

  test("the offline dry run: fred.UNRATE agrees with BLS on every shared month; treasury.debt has no shared quarter in its window; snapshots are n/a", async () => {
    const feeds = catalogue();
    const f = (id: string) => feeds.find((x) => x.config.id === id)!;
    const un = await historicalDryRun(f("fred.UNRATE"), 90, { crossReads: [f("bls.LNS14000000")] });
    assert.equal(un.schedule.kind, "monthly"); assert.equal(un.hitRate, 1); assert.ok(un.expected! >= 2);
    assert.equal(un.crossRead.id, "bls.LNS14000000"); assert.ok(un.crossRead.compared >= 2); assert.equal(un.crossRead.disagreements, 0); assert.equal(un.crossRead.disagreementRate, 0);
    assert.equal(un.latency.medianHours, null); assert.match(un.latency.basis, /first-sighting/);
    const withObs = await historicalDryRun(f("fred.UNRATE"), 90, { observations: [{ id: "2026-09", firstSeenAt: Date.parse("2026-10-02T13:00:00Z") }, { id: "2026-08", firstSeenAt: Date.parse("2026-09-05T13:00:00Z") }] });
    assert.equal(withObs.latency.samples, 2); assert.equal(withObs.latency.medianHours, (37 + (4 * 24 + 13)) / 2, "Sep ends Oct 1 00:00 → seen +37 h; Aug ends Sep 1 → seen +109 h");
    const debt = await historicalDryRun(f("treasury.debt"), 90, { crossReads: [f("fred.GFDEBTN")] });
    assert.equal(debt.schedule.kind, "business-days"); assert.equal(debt.hitRate, 1); assert.equal(debt.crossRead.compared, 0); assert.match(debt.crossRead.basis, /0 comparable/);
    assert.match(debt.schedule.basis, /not observable here/);
    const btc = await historicalDryRun(f("bitcoin.blockHeight"), 90, { crossReads: [f("bitcoin.blockHeight.blockstream")] });
    assert.equal(btc.schedule.kind, "none"); assert.equal(btc.hitRate, null); assert.equal(btc.crossRead.compared, 0); assert.match(btc.crossRead.basis, /apart/);
    const flares = await historicalDryRun(f("noaa.flares"), 90);
    assert.equal(flares.schedule.kind, "daily"); assert.match(flares.schedule.basis, /zero-filled/);
  });
});

// ---- the preflight ----
type Body = unknown;
function fetchOf(table: Record<string, Body>): FetchLike {
  return async (url: string) => {
    const key = Object.keys(table).filter((k) => url.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (key === undefined) return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    const b = table[key];
    return { ok: true, status: 200, json: async () => (typeof b === "string" ? JSON.parse(b) : b), text: async () => (typeof b === "string" ? b : JSON.stringify(b)) };
  };
}
const body = (id: string) => loadFixture(feedById(id)!).body;
const UNRATE_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=UNRATE", LNS_URL = "https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000";
const catalogueRule = (series: string) => { const f = feedById(series)!; return validateRule({ schema: BURNTICKER_RULES_SCHEMA, oracle: "catalogue", series, market: null, filter: {}, kind: "scalar", scalar: { unit: f.unit!.size, perUnit: { fractionOfPool: 0.02 }, baseline: f.baseline!, direction: f.direction! }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null }); };

describe("the creation preflight", () => {
  test("BURNTICKER_PREFLIGHT_STRICT: strict unless 0/false/off/no (the suite runs with it off)", () => {
    assert.equal(preflightStrict({}), true); assert.equal(preflightStrict({ BURNTICKER_PREFLIGHT_STRICT: "true" }), true);
    for (const v of ["0", "false", "OFF", "no"]) assert.equal(preflightStrict({ BURNTICKER_PREFLIGHT_STRICT: v }), false);
    assert.equal(preflightStrict(), false, "the test hook turns it off for the suite");
  });

  test("Kalshi is refused, whatever the venue switch says; stub oracles are refused", async () => {
    const r = await preflightSelector(validateRule(BRONCOS), { now: NOW });
    assert.equal(r.ok, false); assert.equal(r.refusal!.code, "kalshi-not-settlement"); assert.equal(r.refusal!.status, 400);
    const u = await preflightSelector(validateRule({ ...BRONCOS, oracle: "uma", series: "x.y" }), { now: NOW });
    assert.equal(u.refusal!.code, "stub-oracle");
  });

  test("a primary with an agreeing cross-read passes: last reading, next date, agreement on the latest shared month", async () => {
    const r = await preflightSelector(catalogueRule("fred.UNRATE"), { now: NOW, fetchImpl: fetchOf({ [UNRATE_URL]: body("fred.UNRATE"), [LNS_URL]: body("bls.LNS14000000") }) });
    assert.equal(r.ok, true, JSON.stringify(r.refusal));
    assert.equal(r.primary.lastReading!.id, "2026-09"); assert.equal(r.crossRead!.id, "bls.LNS14000000"); assert.equal(r.crossRead!.lastReading!.id, "2026-09");
    assert.equal(r.agreement, true); assert.match(r.agreementBasis, /^2026-09: fred\.UNRATE 4\.2 vs bls\.LNS14000000 4\.2/);
    assert.equal(r.nextExpectedAt, "2026-11-20T00:00:00.000Z");
  });

  test("refusals: no cross-read, disagreement, unreadable primary, stale primary, unreadable cross-read, not a primary", async () => {
    const ll2 = "https://ll.thespacedevs.com/2.3.0/launches/previous/";
    const none = await preflightSelector(catalogueRule("ll2.launches"), { now: NOW, fetchImpl: fetchOf({ [ll2]: body("ll2.launches") }) });
    assert.equal(none.refusal!.code, "no-cross-read"); assert.ok(none.primary.lastReading, "the primary was read first");
    const bls = JSON.parse(JSON.stringify(body("bls.LNS14000000"))) as { Results: { series: { data: { year: string; period: string; value: string }[] }[] } };
    bls.Results.series[0].data.find((x) => x.year === "2026" && x.period === "M09")!.value = "4.5";
    const dis = await preflightSelector(catalogueRule("fred.UNRATE"), { now: NOW, fetchImpl: fetchOf({ [UNRATE_URL]: body("fred.UNRATE"), [LNS_URL]: bls }) });
    assert.equal(dis.refusal!.code, "disagreement"); assert.equal(dis.agreement, false); assert.match(dis.refusal!.reason, /2026-09: fred\.UNRATE 4\.2 vs bls\.LNS14000000 4\.5/);
    const down = await preflightSelector(catalogueRule("fred.UNRATE"), { now: NOW, fetchImpl: fetchOf({}) });
    assert.equal(down.refusal!.code, "primary-unreadable"); assert.equal(down.refusal!.status, 502);
    const half = await preflightSelector(catalogueRule("fred.UNRATE"), { now: NOW, fetchImpl: fetchOf({ [UNRATE_URL]: body("fred.UNRATE") }) });
    assert.equal(half.refusal!.code, "cross-read-unreadable");
    // FRED's full-history CSV: the 2020-04 jump trips the plausibility delta and nothing after it is read → a stale last reading, refused.
    const full = "observation_date,UNRATE\n2020-02-01,3.5\n2020-03-01,4.4\n2020-04-01,14.8\n2026-08-01,4.1\n2026-09-01,4.2\n";
    const stale = await preflightSelector(catalogueRule("fred.UNRATE"), { now: NOW, fetchImpl: fetchOf({ [UNRATE_URL]: full, [LNS_URL]: body("bls.LNS14000000") }) });
    assert.equal(stale.refusal!.code, "stale-primary"); assert.equal(stale.primary.lastReading!.id, "2020-03"); assert.match(stale.refusal!.reason, /delta: 2020-03 → 2020-04/);
    const agg = await preflightSelector(catalogueRule("defillama.tvl:raydium"), { now: NOW, fetchImpl: fetchOf({}) });
    assert.equal(agg.refusal!.code, "not-primary"); assert.match(agg.refusal!.reason, /aggregator/);
  });

  test("Polymarket: the payout vector on Polygon against Gamma's report; an open market has no reading and its end date is next", async () => {
    const pm = polyClient();
    const done = await preflightSelector(validateRule(PM_BUCS), { polymarket: pm, now: NOW });
    assert.equal(done.ok, true, JSON.stringify(done.refusal)); assert.equal(done.primary.lastReading!.result, "yes"); assert.equal(done.agreement, true);
    const open = await preflightSelector(validateRule({ ...PM_BUCS, market: EAGLES_CID }), { polymarket: pm, now: NOW });
    assert.equal(open.ok, true); assert.equal(open.primary.lastReading, null); assert.ok(open.nextExpectedAt); assert.equal(open.agreement, null);
    const unknown = await preflightSelector(validateRule({ ...PM_BUCS, market: `0x${"ab".repeat(32)}` }), { polymarket: pm, now: NOW });
    assert.equal(unknown.ok, false);
    assert.notEqual(BUCS_CID, EAGLES_CID);
  });

  test("wired into the launch pipeline: strict refuses a Kalshi rule with the preflight attached; a cross-read catalogue rule passes", async () => {
    const w = await makeWorld();
    const base = { creator: CREATOR, name: "Coverage coin", description: "", firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } };
    const k = await prepareLaunch(w.p, { ...base, ticker: "COVK", rule: BRONCOS }, { register: false, preflight: { strict: true } });
    assert.ok("error" in k); assert.equal(k.error.status, 400);
    const kb = k.error.body as { code: string; preflight: { refusal: { code: string } } };
    assert.equal(kb.code, "preflight"); assert.equal(kb.preflight.refusal.code, "kalshi-not-settlement");
    const c = await prepareLaunch(w.p, { ...base, ticker: "COVU", rule: catalogueRule("fred.UNRATE") }, { register: false, preflight: { strict: true, deps: { now: NOW, fetchImpl: fetchOf({ [UNRATE_URL]: body("fred.UNRATE"), [LNS_URL]: body("bls.LNS14000000") }) } } });
    assert.ok("ok" in c, JSON.stringify((c as { error?: unknown }).error)); assert.equal(c.ok.preflight!.agreement, true);
    const lone = await prepareLaunch(w.p, { ...base, ticker: "COVL", rule: catalogueRule("ll2.launches") }, { register: false, preflight: { strict: true, deps: { now: NOW, fetchImpl: fetchOf({ "https://ll.thespacedevs.com/": body("ll2.launches") }) } } });
    assert.ok("error" in lone); assert.match((lone.error.body as { error: string }).error, /^preflight refused: .*no independent cross-read/);
    // Off (the suite's default): the pipeline is unchanged and carries no preflight.
    const off = await prepareLaunch(w.p, { ...base, ticker: "COVO", rule: BRONCOS }, { register: false });
    assert.ok("ok" in off); assert.equal(off.ok.preflight, null);
  });
});

describe("the API, the document and the CI gate", () => {
  test("GET /v1/coverage: 200, cached 10 minutes, matches the OpenAPI schema", async () => {
    await makeWorld(); resetCoverageCache();
    const res = await callRoute(`${API}/coverage`);
    assert.equal(res.status, 200); assert.match(res.headers.get("cache-control") ?? "", /max-age=600/);
    const b = await res.json() as { schema: string; categories: { id: string }[] };
    const doc = buildOpenApi() as { paths: Record<string, Record<string, { responses: Record<string, { content: { "application/json": { schema: Record<string, unknown> } } }> }>> };
    assert.deepEqual(validateSchema(doc.paths["/coverage"].get.responses["200"].content["application/json"].schema, b, doc as unknown as Record<string, unknown>), []);
    assert.equal(b.schema, "burnticker.coverage/v1"); assert.deepEqual(b.categories.map((c) => c.id), loadCategories().map((c) => c.id));
  });

  test("docs/burnticker/SETTLEMENT-COVERAGE.md equals a fresh offline render (regenerate with the script's --offline --write) and passes the copy lint", async () => {
    const { matrix } = await buildCoverage({ mode: "offline" });
    const committed = fs.readFileSync(path.join(process.cwd(), "docs/burnticker/SETTLEMENT-COVERAGE.md"), "utf8");
    assert.equal(committed, renderCoverageMarkdown(matrix));
    const r = lintCopy(committed, loadCopyLintConfig());
    assert.ok(r.ok, JSON.stringify(r).slice(0, 600));
  });

  test("every source declares its operator; every declared fact is shared by at least two sources", () => {
    const entries = loadSourceEntries();
    for (const e of entries) assert.ok((e as { operator?: string }).operator, `${e.id} has an operator`);
    const facts = new Map<string, string[]>();
    for (const e of entries.map(describeEntry)) if (e.fact) facts.set(e.fact.id, [...(facts.get(e.fact.id) ?? []), e.id]);
    for (const [f, ids] of facts) assert.ok(ids.length >= 2, `fact ${f} has a cross-read (${ids.join(", ")})`);
  });

  test("the script exits non-zero on an uncovered category and zero on the real taxonomy", () => {
    const tmp = path.join(os.tmpdir(), `bt-categories-${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ schema: "burnticker.categories/v1", categories: [{ id: "nowhere", label: "Nowhere", blurb: "", feeds: [], polymarket: [], kalshi: ["Sports"] }] }));
    const run = (extra: string[]) => spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./test/alias-hook.mjs", "scripts/burnticker-coverage-audit.mts", "--offline", ...extra], { cwd: process.cwd(), encoding: "utf8" });
    const bad = run(["--categories", tmp]);
    assert.equal(bad.status, 1, bad.stderr); assert.match(bad.stdout, /Nowhere \[nowhere\] — UNCOVERED/);
    const good = run([]);
    assert.equal(good.status, 0, good.stderr); assert.match(good.stdout, /0 uncovered/);
    fs.rmSync(tmp, { force: true });
  });

  test("THE CI GATE: under the offline fixtures no category of config/burnticker/categories.json is uncovered, and Kalshi is no input", async () => {
    const { matrix } = await buildCoverage({ mode: "offline" });
    const cats = loadCategories();
    assert.equal(matrix.categories.length, cats.length);
    const bad = matrix.categories.filter((c) => c.verdict === "uncovered").map((c) => `${c.id}: ${c.why}`);
    assert.deepEqual(bad, [], `uncovered categories:\n${bad.join("\n")}`);
    assert.equal(coverageExitCode(matrix), 0);
    for (const c of matrix.categories) assert.ok(![...c.primaries, ...c.crossReads].some((s) => /kalshi/i.test(`${s.id} ${s.operator} ${s.domain}`)), c.id);
    assert.equal(matrix.categories.find((c) => c.id === "economics")!.verdict, "settleable");
  });
});
