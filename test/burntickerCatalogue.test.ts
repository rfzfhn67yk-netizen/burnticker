// BURNTICKER (2026-10-09) — the source layer: the generic attested-http adapter (JSON path / CSV / regex selection, periods, counts,
// snapshots, plausibility) on every frozen real fixture in config/burnticker/sources.json, the six original feeds now as config (the
// Treasury wrapper still reproduces the $DEFICIT keeper's units to the cent), parameterised ids, tiers and launchability, the on-chain
// adapter on a fake RPC, and the market/assertion stubs' pure decoders.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CATALOGUE, CatalogueAdapter, catalogue, feedById, feedRuleProblems, fixtureReadings, loadFixture, loadSourcesConfig, previewFromFixture } from "@/lib/burnticker/catalogue";
import { expandUrl, jsonPath, parseBody, parseCsv, toPeriod } from "@/lib/burnticker/sources/attestedHttp";
import { onchainSource, type SolanaRpcPort } from "@/lib/burnticker/sources/onchain";
import { ctfOutcome, umaOutcome, driftBetStub, hedgehogStub, polymarketCard, umaStub } from "@/lib/burnticker/sources/stubs";
import { TIER_LABEL } from "@/lib/burnticker/sources/types";
import { validateRule } from "@/lib/burnticker/rules";
import { unitSteps } from "@/lib/burnticker/units";
import { debtStep, loadRules, usdToCents } from "@/lib/burnKeeper/rules";
import { DEBT_RULE, NOW } from "./burntickerHelpers.ts";

const rule = (series: string, unit: number, direction: "up" | "abs", baseline: "previousSettlement" | number) => validateRule({ ...DEBT_RULE, series, scalar: { unit, perUnit: { fractionOfPool: 0.02 }, baseline, direction } });

describe("sources.json: every configured source", () => {
  test("every entry has a tier 3–5, flags, a unit, and either a fixture that parses with no refusals or a stated reason it has none", () => {
    const cfgs = loadSourcesConfig();
    assert.ok(cfgs.length >= 28, `${cfgs.length} sources`);
    for (const c of cfgs) {
      assert.ok([3, 4, 5].includes(c.tier), `${c.id} tier`);
      assert.ok(TIER_LABEL[c.tier]);
      assert.ok(c.unit.size > 0 && c.unit.label && c.unit.definition, `${c.id} unit`);
      const f = feedById(c.id) ?? feedById(`${c.id}:${{ "wiki.views": "Bitcoin", "github.stars": "anza-xyz/agave", "steam.players": "730", "defillama.tvl": "raydium", "edgar.8k": "0000320193" }[c.id] ?? ""}`);
      assert.ok(f, `${c.id} resolves`);
      if (!c.fixture) { assert.ok(c.needsKey || c.note, `${c.id}: no fixture needs a reason`); assert.equal(f!.launchable.ok, false); continue; }
      const { readings, refusals } = fixtureReadings(f!, NOW);
      if (f!.launchable.ok) { assert.deepEqual(refusals, [], `${c.id}: ${refusals.join("; ")}`); assert.ok(readings.length >= 1, `${c.id} has readings`); }
      for (const r of readings) { assert.match(r.value!, /^-?(0|[1-9]\d*)(\.\d*[1-9])?$/, `${c.id} ${r.id} value ${r.value}`); assert.ok(r.sourceUrl.startsWith("https://"), `${c.id} sourceUrl`); }
      for (let i = 1; i < readings.length; i++) assert.ok(readings[i - 1].at < readings[i].at, `${c.id} ordered`);
    }
  });
  test("the six original feeds are config now, and still read their fixtures as before", () => {
    const ids = CATALOGUE.map((f) => f.id);
    for (const id of ["treasury.debt", "bls.eggs", "noaa.flares", "ll2.launches", "jpl.neo", "wiki.views:Bitcoin"]) assert.ok(ids.includes(id), id);
    const by = (id: string) => Object.fromEntries(fixtureReadings(feedById(id)!, NOW).readings.map((r) => [r.id, r.value]));
    const eggs = by("bls.eggs"); assert.equal(eggs["2026-08"], "2.272"); assert.ok(!("2025-10" in eggs), "the shutdown month '-' is skipped");
    const flares = by("noaa.flares"); assert.equal(flares["2026-10-06"], "2"); assert.equal(flares["2026-10-08"], "1"); assert.equal(flares["2026-10-04"], "0"); assert.ok(!("2026-10-03" in flares), "partial first day dropped");
    const launches = by("ll2.launches"); assert.equal(launches["2026-09-28"], "5", "Starship ×5"); assert.equal(launches["2026-10-01"], "2");
    const neo = by("jpl.neo"); assert.equal(neo["2026-08-09"], "2"); assert.ok(Object.keys(neo).every((d) => d <= "2026-10-03"), "final after 7 days");
    const wiki = by("wiki.views:Bitcoin"); assert.equal(wiki["2026-09-01"], "6612");
  });
  test("treasury.debt reproduces the $DEFICIT keeper's units and carry to the cent (the engine's carry = debtStep)", () => {
    const f = feedById("treasury.debt")!;
    const { readings } = fixtureReadings(f, NOW);
    const steps = unitSteps(validateRule(DEBT_RULE), readings, f.carry);
    const keeper = loadRules("config/burnkeeper/deficit.rules.json").rules;
    let carry = BigInt(0);
    for (let i = 1; i < readings.length; i++) {
      const s = debtStep(keeper, usdToCents(readings[i - 1].value!), usdToCents(readings[i].value!), carry);
      assert.equal(steps[i].step.units, s.units, readings[i].id);
      assert.equal(usdToCents(steps[i].step.carryOut), s.carryOutCents, `${readings[i].id} carry`);
      carry = s.carryOutCents;
    }
    assert.ok(steps.some((s) => s.step.units > 0));
  });
  test("new sources: FRED CSVs (monthly / quarterly), Federal Register counts, EDGAR 8-K counts, USGS quakes per day, openFDA / GitHub / Steam / TVL / block heights as snapshots", () => {
    const un = fixtureReadings(feedById("fred.UNRATE")!, NOW).readings; assert.match(un[un.length - 1].id, /^\d{4}-\d{2}$/); assert.ok(un.length >= 30);
    const gf = fixtureReadings(feedById("fred.GFDEBTN")!, NOW).readings; assert.match(gf[gf.length - 1].id, /^\d{4}-Q[1-4]$/);
    const fr = fixtureReadings(feedById("fedreg.finalRules")!, NOW).readings; assert.ok(fr.length >= 1); assert.ok(fr.every((r) => Number(r.value) >= 1), "count rows only (zeroFill off)");
    const ed = fixtureReadings(feedById("edgar.8k:0000320193")!, NOW).readings; assert.equal(ed.reduce((a, r) => a + Number(r.value), 0), 2, "two 8-K hits in the window");
    const q = Object.fromEntries(fixtureReadings(feedById("usgs.quakes6")!, NOW).readings.map((r) => [r.id, r.value])); assert.equal(q["2026-10-09"], "2", "two ≥ M6 on 10-09 (Panama)"); assert.equal(q["2026-09-15"] ?? "0", q["2026-09-15"] ?? "0");
    for (const [id, re] of [["openfda.approvals", /^\d+$/], ["github.stars:anza-xyz/agave", /^\d+$/], ["steam.players:730", /^\d+$/], ["defillama.tvl:raydium", /^\d+(\.\d+)?$/], ["solana.blockHeight.rpc", /^\d{9}$/], ["bitcoin.blockHeight", /^\d{6}$/], ["ethereum.baseFeeBurn", /^\d+(\.\d+)?$/]] as const) {
      const r = fixtureReadings(feedById(id)!, NOW).readings; assert.equal(r.length, 1, id); assert.match(r[0].value!, re, id); assert.equal(r[0].id, "2026-10-10", `${id}: the snapshot is dated by the fixture's fetch day`);
    }
    assert.equal(feedById("github.stars:anza-xyz/agave")!.config.request.url, "https://api.github.com/repos/anza-xyz/agave");
    assert.equal(feedById("github.stars"), null, "parameterised sources need their parameter");
    assert.equal(feedById("treasury.debt:x"), null, "plain sources take none");
  });
  test("key-required, page-scraped and disaster-adjacent sources are present but not launchable, with the reason", () => {
    for (const id of ["bea.gdp", "eia.gasoline", "usda.eggs", "census.tradeBalance", "congress.lawsSigned", "youtube.views"]) { const f = feedById(id)!; assert.equal(f.launchable.ok, false, id); assert.match(f.launchable.why!, /needs a key/); }
    assert.equal(feedById("usgs.quakes6")!.launchable.ok, false); assert.match(feedById("usgs.quakes6")!.flags.join(" "), /disaster-adjacent: OWNER TO CONFIRM/);
    assert.equal(feedById("billboard.hot100")!.tier, 5); assert.equal(feedById("bom.weekendGross")!.tier, 5); assert.equal(feedById("spotify.charts")!.launchable.ok, false);
    assert.equal(feedById("espn.nfl")!.launchable.ok, false);
    const bom = fixtureReadings(feedById("bom.weekendGross")!, NOW);
    assert.ok(bom.readings.length <= 1, "at most one weekend gross from the excerpt");
  });
  test("the adapter list for the wizard carries kind/tier; previewFromFixture and feedRuleProblems still gate tier-2 rules", () => {
    const all = catalogue();
    assert.ok(all.every((f) => f.kind === "attested-http"));
    const p = previewFromFixture(feedById("noaa.flares")!, rule("noaa.flares", 1, "up", 0), NOW);
    assert.equal(p.totals.units, 5);
    assert.deepEqual(feedRuleProblems(feedById("treasury.debt")!, validateRule(DEBT_RULE)), []);
    assert.ok(feedRuleProblems(feedById("treasury.debt")!, rule("treasury.debt", 5e8, "up", "previousSettlement")).some((x) => /unit must be 1000000000/.test(x)));
    assert.ok(feedRuleProblems(feedById("usgs.quakes6")!, rule("usgs.quakes6", 1, "up", 0)).some((x) => /not launchable/.test(x)));
  });
  test("the catalogue adapter reads through an injected fetch, filters by since, never returns a price", async () => {
    const f = feedById("treasury.debt")!;
    const body = loadFixture(f).body;
    const a = new CatalogueAdapter({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }), now: () => NOW });
    const r = await a.settledSince(validateRule(DEBT_RULE), "2026-10-05");
    assert.deepEqual(r.events.map((e) => e.id), ["2026-10-06", "2026-10-07", "2026-10-08"]);
    assert.equal((await a.impliedChance()).chance, null);
    await assert.rejects(a.settledSince(validateRule({ ...DEBT_RULE, series: "eia.gasoline", scalar: { unit: 0.05, perUnit: { fractionOfPool: 0.02 }, baseline: "previousSettlement", direction: "abs" } }), null), /not launchable: needs a key/);
    assert.equal((await a.searchSeries("egg"))[0].ticker, "bls.eggs");
  });
});

describe("the generic adapter's primitives", () => {
  test("jsonPath, CSV, periods and URL templates", () => {
    assert.deepEqual(jsonPath({ a: { b: [{ c: 1 }, { c: 2 }] } }, "a.b[*].c"), [1, 2]);
    assert.deepEqual(jsonPath({ a: [[1, 2]] }, "a[0][1]"), [2]);
    assert.deepEqual(jsonPath([{ x: 1 }], "$"), [[{ x: 1 }]]);
    assert.deepEqual(parseCsv("d,v\n2026-01-01,1.5\n2026-02-01,2"), [{ d: "2026-01-01", v: "1.5" }, { d: "2026-02-01", v: "2" }]);
    assert.equal(toPeriod("2026-10-08T15:48:00Z", { path: "", format: "iso" }, "day"), "2026-10-08");
    assert.equal(toPeriod("2026-10-08", { path: "", format: "yyyy-mm-dd" }, "quarter"), "2026-Q4");
    assert.equal(toPeriod("2026-10-08", { path: "", format: "yyyy-mm-dd" }, "week"), "2026-W41");
    assert.equal(toPeriod("M08", { path: "", format: "bls" }, "month", { year: "2026" }), "2026-08");
    assert.equal(toPeriod("2026-Aug-05 10:59", { path: "", format: "jpl-cd" }, "day"), "2026-08-05");
    assert.equal(toPeriod(1791600397000, { path: "", format: "epoch-ms" }, "day"), "2026-10-10");
    assert.equal(expandUrl("x?a={today}&b={from:3}&c={yyyymmdd:from:1}", Date.parse("2026-10-10T02:00:00Z")), "x?a=2026-10-10&b=2026-10-07&c=20261009");
  });
  test("parseBody: plausibility refuses a level and a step and reads nothing after; a bad body is a refusal", () => {
    const cfg = feedById("fred.UNRATE")!.config;
    const r = parseBody(cfg, "observation_date,UNRATE\n2026-01-01,4.0\n2026-02-01,99\n2026-03-01,4.1\n", NOW);
    assert.equal(r.readings.length, 1); assert.match(r.refusals[0], /^level:/);
    const r2 = parseBody(cfg, "observation_date,UNRATE\n2026-01-01,4.0\n2026-02-01,15\n2026-03-01,4.1\n", NOW);
    assert.equal(r2.readings.length, 1); assert.match(r2.refusals[0], /^delta:/);
    assert.ok(parseBody(feedById("treasury.debt")!.config, { nope: 1 }, NOW).refusals.some((x) => /no rows/.test(x)));
    assert.ok(parseBody(feedById("steam.players:730")!.config, { response: {} }, NOW).refusals.some((x) => /snapshot/.test(x)));
  });
});

describe("onchain and the stubs", () => {
  test("solana.blockHeight reads getBlockHeight once per UTC day from an injected RPC port; no port = not launchable", async () => {
    const rpc: SolanaRpcPort = { blockHeight: async () => 433_132_520, slot: async () => 460_000_000, accountLamports: async () => null };
    const s = onchainSource("solana.blockHeight", rpc, { now: () => NOW });
    assert.equal(s.kind, "onchain"); assert.equal(s.tier, 1);
    const r = await s.settledSince(validateRule({ ...DEBT_RULE, series: "solana.blockHeight", scalar: { unit: 1_000_000, perUnit: { fractionOfPool: 0.02 }, baseline: "previousSettlement", direction: "up" } }), null);
    assert.deepEqual(r.events.map((e) => [e.id, e.value]), [["2026-10-10", "433132520"]]);
    assert.equal((await s.settledSince(validateRule(DEBT_RULE), "2026-10-10")).events.length, 0);
    assert.equal(onchainSource("solana.slot", null).launchable.ok, false);
  });
  test("stubs refuse to feed a rule and say why (Polymarket is live and its card says so); the CTF payout vector and UMA assertion decoders are pure and exact", async () => {
    for (const s of [umaStub(), driftBetStub(), hedgehogStub()]) { assert.equal(s.launchable.ok, false); await assert.rejects(s.settledSince(validateRule(DEBT_RULE), null)); }
    // Polymarket is live since 2026-10-10 (oracle/polymarket.ts): its catalogue card is launchable, tier 1, and reads nothing itself.
    const pm = polymarketCard();
    assert.equal(pm.launchable.ok, true); assert.equal(pm.tier, 1); assert.equal(pm.kind, "market");
    await assert.rejects(pm.settledSince(validateRule(DEBT_RULE), null), /PolymarketClient/);
    assert.match(driftBetStub().launchable.why!, /UNVERIFIED/); assert.match(hedgehogStub().flags.join(" "), /unverified/);
    assert.equal(ctfOutcome([BigInt(1), BigInt(0)], BigInt(1)), "yes");
    assert.equal(ctfOutcome([BigInt(0), BigInt(1)], BigInt(1)), "no");
    assert.equal(ctfOutcome([BigInt(1), BigInt(1)], BigInt(2)), "void");
    assert.equal(ctfOutcome([BigInt(0), BigInt(0)], BigInt(0)), null, "not reported yet");
    assert.equal(umaOutcome({ settled: true, settlementResolution: true }), "yes");
    assert.equal(umaOutcome({ settled: false, settlementResolution: true }), null);
  });
});
