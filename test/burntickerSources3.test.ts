// sources-3 (2026-10-12; the owner, ~18:05 Denver: "weather events might be lame but natural disasters would be cool — add them all,
// de-emphasize weather and promote natural disasters as an option; burn per event or burn 100% on the next event"). Five hazard
// publishers, each with a recurring form (one unit per qualifying event) and a one-shot (the whole share once, on the next qualifying
// event after launch). The line not crossed: a coin counts an instrument's reading (magnitude, category, count, acres, alert level),
// never harm. Every reading here comes from a real response captured read-only on 2026-10-13 00:12 UTC (2026-10-12 18:12 Denver;
// config/burnticker/fixtures/http/{usgs.m65,nhc.btk.al,nhc.btk.ep,spc.torn,nifc.acres,nifc.size50k,usgs.van,usgs.van.2026-03}.json).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CatalogueAdapter, feedById, fixtureReadings, loadSourceEntries } from "@/lib/burnticker/catalogue";
import { fetchBody, parseBody, type HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import { lockRule, isOneShot, validateRule, type BurnRule } from "@/lib/burnticker/rules";
import { unitSteps } from "@/lib/burnticker/units";
import { describeRule, windowKindOf, WINDOW_SENTENCE, DESCRIPTION_MAX } from "@/lib/burnticker/describe";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { inverseRefusal, NEXT_EVENT_ONE_SHOT_RE, KEEPER_ONE_SHOT_RE } from "@/lib/burnticker/inverse";
import { dialsFor } from "@/lib/burnticker/dials";
import { shareShapeOf } from "@/lib/burnticker/launchPresets";
import { oneShotEligibility, SEASON_OVER_SENTENCE } from "@/lib/burnticker/oneShotEligibility";
import { parseUsgsNextSeries } from "@/lib/burnticker/sources/usgs";
import { parseNhcSeries, nhcSeasonOpen } from "@/lib/burnticker/sources/nhc";
import { parseSpcSeries } from "@/lib/burnticker/sources/spc";
import { parseNifcSeries } from "@/lib/burnticker/sources/nifc";
import { hansVanRows, parseVolcanoSeries } from "@/lib/burnticker/sources/volcano";
import { feedCard, loadCategories } from "@/lib/burnticker/browse";
import { isSingleOfficialSource, SINGLE_SOURCE_IDS, singleSourceSentence } from "@/lib/burnticker/singleSource";
import { corroborate } from "@/lib/burnticker/catalogue/corroborate";
import { preflightSelector } from "@/lib/burnticker/coverage/preflight";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { HAZARD_FOLLOW, HAZARD_KINDS, HAZARD_PATTERNS, HAZARD_SEASON_OVER, hazardPatternOptions, hazardSwap, isHazardSeries } from "@/lib/burnticker/hazards";

const ROOT = path.join(import.meta.dirname, "..");
const NOW = Date.parse("2026-10-13T00:12:00Z");
const cfgLint = loadCopyLintConfig();
const lint = (t: string) => { const r = lintCopy(t, cfgLint); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };
const fx = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, "config/burnticker/fixtures/http", f), "utf8")) as { fetchedAt: string; body: unknown };
const feed = (id: string) => { const f = feedById(id); assert.ok(f, `${id} resolves`); return f!; };
const vals = (id: string) => Object.fromEntries(fixtureReadings(feed(id), NOW).readings.map((r) => [r.id, r.value]));
const nonZero = (id: string) => fixtureReadings(feed(id), NOW).readings.filter((r) => r.value !== "0").map((r) => r.id);
const parseWith = (id: string, file: string, nowMs = NOW) => parseBody(feed(id).config, fx(file).body, nowMs);
/** Harm is never a reading and never a sentence (the owner's line, 2026-10-12). */
const HARM = /\b(deaths?|dead|died|dying|kill(s|ed|ing)?|fatal\w*|injur\w*|casualt\w*|damage\w*|destroy\w*|destruction|evacuat\w*|victims?|homeless|displaced|toll)\b/i;
const ACRES_RULE = { ...firstPartyRule("nifc.acres"), scalar: { unit: 100000, perUnit: { fractionOfPool: 0.02 }, baseline: "previousSettlement", direction: "up" } } as BurnRule;
const ev = (day: string, value: string) => ({ id: day, at: day, result: null, value, title: day, sourceUrl: "https://data-nifc.opendata.arcgis.com/" });
const fail: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });

const RECURRING = ["usgs.quakes:6", "nhc.storms:al", "nhc.hurricanes:ep.3", "spc.tornadoes:US", "spc.tornadoes:OK", "usgs.volcanoraise"];
const ONE_SHOTS = ["usgs.quakenext:7", "usgs.quakenext:6.5/japan", "nhc.next:al.3.2026", "spc.tornadoday:10/US", "spc.tornadoday:1/KS", "nifc.firesize:100000", "usgs.volcanowarning:332010"];
const NEW_IDS = ["usgs.quakenext", "nhc.storms", "nhc.hurricanes", "nhc.next", "spc.tornadoes", "spc.tornadoday", "nifc.acres", "nifc.firesize", "usgs.volcanoraise", "usgs.volcanowarning"];

describe("sources-3: the five hazard publishers in sources.json", () => {
  test("each entry: operator, terms page read on 2026-10-12 in one paragraph with a verdict that allows the use, launchable, the clinical flag", () => {
    const entries = loadSourceEntries() as (HttpSourceConfig & { id: string })[];
    for (const id of [...NEW_IDS, "usgs.quakes"]) {
      const e = entries.find((x) => x.id === id)!;
      assert.ok(e, id); assert.ok(e.operator, `${id} operator`); assert.equal(e.launchable, true, id);
      assert.ok(e.terms && ["allowed", "allowed-with-limits"].includes(e.terms.verdict), `${id} verdict`); assert.equal(e.terms!.readAt, "2026-10-12");
      assert.match(e.terms!.url, /^https:\/\//); assert.ok(e.terms!.read.length > 200 && !/\n/.test(e.terms!.read), `${id}: one paragraph`);
      assert.match(e.flags.join(" "), /admitted by the owner 2026-10-12/, id);
      assert.match(e.flags.join(" "), /single official source: settles on the publisher.s own published data/, `${id}: says it settles on one publisher`); assert.equal(e.settlement, "single-official-source", id);
      assert.equal((e as { fact?: unknown }).fact, undefined, `${id}: no fact is declared (no second source)`);
      assert.doesNotMatch(`${e.title} ${e.unit.label} ${e.unit.definition} ${e.terms!.read}`, HARM, id);
    }
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, "config/burnticker/sources.json"), "utf8")) as { notSources: { id: string; reason: string }[] };
    for (const id of ["usgs.riverFloodStage", "nhc.usLandfall", "spc.efRating"]) assert.ok(j.notSources.find((x) => x.id === id)?.reason.startsWith("Not built in sources-3"), id);
    assert.equal(feedById("usgs.quakes6")!.launchable.ok, false, "the older single-magnitude entry stays unlaunchable and unmapped");
  });

  test("the catalogue: Natural disasters first with every hazard source; the weather tile is gone and its rules sit under Science, Space & Weather", () => {
    const cats = loadCategories();
    assert.equal(cats[0].id, "disasters"); assert.equal(cats[0].label, "Natural disasters");
    assert.deepEqual(cats[0].feeds, ["usgs.quakes", ...NEW_IDS]);
    assert.ok(!cats.some((c) => c.id === "weather"));
    const sci = cats.find((c) => c.id === "science")!;
    assert.ok(sci.feeds.includes("nws.cli")); assert.deepEqual(sci.native, ["nws:high", "nws:rain", "nws:snow"]);
    assert.doesNotMatch(`${cats[0].label} ${cats[0].blurb}`, HARM); lint(`${cats[0].label}: ${cats[0].blurb}`);
  });

  test("series ids parse only inside their bounds", () => {
    assert.deepEqual(parseUsgsNextSeries("usgs.quakenext:7.5/alaska"), { magnitude: "7.5", region: "alaska" });
    assert.equal(parseUsgsNextSeries("usgs.quakenext:5"), null, "the one-shot starts at magnitude 6");
    assert.deepEqual(parseNhcSeries("nhc.next:al.3.2026"), { kind: "next", basin: "al", cat: 3, year: 2026 });
    assert.equal(parseNhcSeries("nhc.hurricanes:al.6"), null); assert.equal(parseNhcSeries("nhc.storms:wp"), null);
    assert.deepEqual(parseSpcSeries("spc.tornadoday:25/OK"), { kind: "day", area: "OK", n: 25 }); assert.equal(parseSpcSeries("spc.tornadoday:7/OK"), null); assert.equal(parseSpcSeries("spc.tornadoes:ZZ"), null);
    assert.deepEqual(parseNifcSeries("nifc.firesize:100000"), { kind: "size", acres: 100000 }); assert.equal(parseNifcSeries("nifc.firesize:1234"), null);
    assert.equal(parseVolcanoSeries("usgs.volcanowarning:332010")?.kind, "warning"); assert.equal(parseVolcanoSeries("usgs.volcanowarning:999999"), null);
    for (const id of ONE_SHOTS) { assert.ok(feedById(id), id); assert.ok(NEXT_EVENT_ONE_SHOT_RE.test(id) && KEEPER_ONE_SHOT_RE.test(id), id); }
    for (const id of RECURRING) { assert.ok(feedById(id), id); assert.ok(!KEEPER_ONE_SHOT_RE.test(id), id); }
  });
});

describe("readings from the captured fixtures", () => {
  test("USGS one-shot: only days with a reviewed event at the magnitude, each 1, never a 0", () => {
    assert.deepEqual(nonZero("usgs.quakenext:6.5"), ["2026-09-17", "2026-09-25", "2026-10-09"]);
    assert.ok(Object.values(vals("usgs.quakenext:6.5")).every((v) => v === "1"), "a one-shot source never reads 0 before its event");
    assert.match(feed("usgs.quakenext:7/japan").config.request.url, /minmagnitude=7&.*&minlatitude=24&maxlatitude=46/);
    const body = JSON.stringify(fx("usgs.m65.json").body);
    assert.doesNotMatch(body, /"(place|felt|alert|tsunami|mmi|cdi)"/, "no place names, felt reports or alert levels are kept");
  });

  test("NHC: each storm counts once, on the day it first qualifies; a category bar; the season's end gives one 0 reading", () => {
    assert.deepEqual(nonZero("nhc.storms:al"), ["2026-06-17", "2026-07-21", "2026-08-12", "2026-08-27", "2026-09-01", "2026-09-20", "2026-09-25", "2026-09-28", "2026-10-07"], "nine named Atlantic storms, ARTHUR to ISAIAS");
    assert.equal(vals("nhc.storms:al")["2026-10-06"], "0", "a day with no new named storm reads 0");
    const ep3 = parseWith("nhc.hurricanes:ep.3", "nhc.btk.ep.json");
    assert.deepEqual(ep3.refusals, []);
    assert.equal(ep3.readings.reduce((a, r) => a + Number(r.value), 0), 8, "eight eastern Pacific storms reached 96 knots; Fausto (90) and Marie (85) did not");
    const al1 = parseWith("nhc.hurricanes:al.1", "nhc.btk.al.json");
    assert.deepEqual(al1.readings.filter((r) => r.value !== "0").map((r) => r.id), ["2026-10-08"], "one Atlantic hurricane so far: Isaias, first at 64 knots or more on 10-08");
    const next = parseWith("nhc.next:ep.3.2026", "nhc.btk.ep.json");
    assert.ok(next.readings.every((r) => r.value === "1") && !next.readings.some((r) => r.id.startsWith("ended-")), "inside the season: qualifying days only");
    const after = parseWith("nhc.next:ep.3.2026", "nhc.btk.ep.json", Date.parse("2026-12-02T12:00:00Z"));
    assert.deepEqual(after.readings[after.readings.length - 1], { ...after.readings[after.readings.length - 1], id: "ended-2026-11-30", at: "2026-11-30", value: "0" }, "once November 30 is read, one 0 reading ends the coin");
    // the keeper's view: a one-shot launched on 10-05 plans only later readings; its first receipt is Simon reaching category 3 on 10-10
    const rule = validateRule(firstPartyRule("nhc.next:ep.3.2026", 1));
    assert.equal(isOneShot(rule), true);
    const planned = unitSteps(rule, after.readings.filter((r) => r.at > "2026-10-05T18:00:00.000Z"), "none");
    assert.equal(planned[0].event.id, "2026-10-10"); assert.equal(planned[0].step.units, 1);
    const quiet = unitSteps(rule, after.readings.filter((r) => r.at > "2026-10-11T00:00:00.000Z"), "none");
    assert.equal(quiet[0].event.id, "ended-2026-11-30"); assert.equal(quiet[0].step.units, 0, "no storm after launch: the season end burns nothing and ends the coin");
    const names = JSON.stringify(fx("nhc.btk.al.json").body);
    assert.ok(names.includes("ISAIAS"), "names are in the raw files (to count a storm once)");
    for (const id of ["nhc.storms:al", "nhc.next:al.3.2026"]) assert.doesNotMatch(describeRule(lockRule(firstPartyRule(id, id.includes("next") ? 1 : 0.02)).rule, { ticker: "" }).paragraph, /ISAIAS|Isaias|ARTHUR|Arthur/, "and never in the coin's text");
  });

  test("SPC: reports per report day, nationally or by state; a one-shot on N reports; ratings are not read", () => {
    assert.deepEqual(vals("spc.tornadoes:US"), { "2026-10-05": "0", "2026-10-06": "0", "2026-10-07": "0", "2026-10-08": "0", "2026-10-09": "0", "2026-10-10": "14", "2026-10-11": "13" }, "seven report days, a file with no rows reads 0");
    assert.deepEqual(nonZero("spc.tornadoes:NC"), ["2026-10-10", "2026-10-11"]); assert.equal(vals("spc.tornadoes:NC")["2026-10-11"], "13");
    assert.deepEqual(nonZero("spc.tornadoday:10/US"), ["2026-10-10", "2026-10-11"]); assert.deepEqual(fixtureReadings(feed("spc.tornadoday:25/US"), NOW).readings, [], "no day reached 25");
    const body = fx("spc.torn.json").body as { __parts: { body: string }[] };
    for (const p of body.__parts) { assert.equal(p.body.split("\n")[0], "Time,F_Scale,State", "location, county, coordinates and comments are not kept"); assert.doesNotMatch(p.body, /EF\d/, "no rating in the daily feed"); }
  });

  test("NIFC: the year's wildfire acres (per 100,000 with carry) and a one-shot on the next fire to reach a size", () => {
    const v = fixtureReadings(feed("nifc.acres"), NOW);
    assert.deepEqual(v.refusals, []); assert.equal(v.readings.length, 1); assert.equal(Math.round(Number(v.readings[0].value)), 8975212);
    const f = feed("nifc.acres");
    assert.equal(f.unit!.size, 100000); assert.equal(f.baseline, "previousSettlement"); assert.equal(f.carry, "consecutive-increases");
    const rule = validateRule(ACRES_RULE);
    const steps = unitSteps(rule, [ev("2026-10-11", "8900000"), ev("2026-10-12", "8960000"), ev("2026-10-13", "9010000"), ev("2027-01-01", "120")], f.carry);
    assert.deepEqual(steps.map((s) => s.step.units), [0, 0, 1, 0], "60,000 then 50,000 acres carry into one unit; the January reset burns nothing");
    assert.equal(nonZero("nifc.firesize:50000").length, 20); assert.ok(fixtureReadings(feed("nifc.firesize:50000"), NOW).readings.every((r) => r.value === "1"));
    assert.match(feed("nifc.firesize:500000").config.request.url, /IncidentSize%3E%3D500000/);
    assert.doesNotMatch(feed("nifc.firesize:500000").config.request.url, /IncidentName|POO|Cause|Cost/i, "only discovery time and size are requested");
  });

  test("USGS volcano notices: raises only (a lowered or repeated level counts nothing); a one-shot on a named volcano's raise to WARNING", () => {
    const rows = hansVanRows(fx("usgs.van.json").body);
    assert.equal(rows.refusal, null); assert.equal(rows.rows.length, 6);
    assert.deepEqual(rows.rows.filter((r) => r.raise === "1").map((r) => [r.volcano, r.from, r.to]), [["Gareloi", "NORMAL", "ADVISORY"]]);
    assert.deepEqual(nonZero("usgs.volcanoraise"), ["2026-10-01"]); assert.equal(vals("usgs.volcanoraise")["2026-10-06"], "0", "Gareloi lowered on 10-06: nothing");
    assert.equal(Object.keys(vals("usgs.volcanoraise")).length, 29, "the 30-day window zero-fills, its partial first day dropped");
    assert.deepEqual(fixtureReadings(feed("usgs.volcanowarning:332010"), NOW).readings.map((r) => [r.id, r.value]), [["2026-03-10", "1"]], "Kilauea WATCH to WARNING on 03-10");
    assert.deepEqual(parseWith("usgs.volcanowarning:311160", "usgs.van.2026-03.json").readings, [], "Atka rose to WATCH, not WARNING");
    const full = { noticeTotal: 20, noticeData: Array.from({ length: 20 }, () => (fx("usgs.van.json").body as { noticeData: unknown[] }).noticeData[0]) };
    const p = parseBody(feed("usgs.volcanoraise").config, full, NOW);
    assert.deepEqual(p.readings, [], "a full page refuses: an older raise could be missing"); assert.match(p.refusals.join(" "), /page is full/);
    const broken = parseBody(feed("usgs.volcanoraise").config, { noticeData: [{ sentUnixtime: 1, noticeHtml: "Volcano: <b>X</b> (VNUM #1)" }] }, NOW);
    assert.deepEqual(broken.readings, []); assert.match(broken.refusals.join(" "), /without its volcano, alert level/);
    assert.doesNotMatch(JSON.stringify(fx("usgs.van.json").body), /synopsis|Summary|Activity:/, "the activity text is not kept");
  });
});

describe("the read: fan-out, POST body, unavailable never a result", () => {
  const serve = (files: Record<string, unknown>, seen: string[] = []): FetchLike => async (u, init) => {
    seen.push(`${(init as { method?: string } | undefined)?.method ?? "GET"} ${u} ${(init as { body?: string } | undefined)?.body ?? ""}`.trim());
    const hit = Object.keys(files).find((k) => u.endsWith(k));
    if (hit === undefined) return { ok: false, status: 404, json: async () => ({}) };
    const b = files[hit];
    return { ok: true, status: 200, json: async () => b, text: async () => (typeof b === "string" ? b : JSON.stringify(b)) } as never;
  };

  test("NHC: the directory is listed, every matching storm file read, and the result equals the captured fixture's", async () => {
    const parts = (fx("nhc.btk.ep.json").body as { __parts: { key: string; body: string }[] }).__parts;
    const files: Record<string, unknown> = { "/atcf/btk/": `${parts.slice(1).map((p) => `<a href="${p.key}">${p.key}</a>`).join("\n")}\n<a href="bep932026.dat">bep932026.dat</a> <a href="bal092026.dat">x</a>` };
    for (const p of parts.slice(1)) files[`/atcf/btk/${p.key}`] = p.body;
    const seen: string[] = [];
    const cfg = feed("nhc.hurricanes:ep.3").config;
    const body = await fetchBody(cfg, NOW, serve(files, seen), 1000, {});
    assert.ok(!seen.some((s) => /bep93|bal09/.test(s)), "invests and other basins are never read");
    assert.deepEqual(parseBody(cfg, body, NOW).readings, parseWith("nhc.hurricanes:ep.3", "nhc.btk.ep.json").readings);
    delete files[`/atcf/btk/${parts[3].key}`];
    await assert.rejects(fetchBody(cfg, NOW, serve(files), 1000, {}), /HTTP 404/, "one storm file missing fails the read, never a smaller count");
  });

  test("SPC: seven report-day files, two to eight days back; a missing file fails the read", async () => {
    const parts = (fx("spc.torn.json").body as { __parts: { day: string; body: string }[] }).__parts;
    const files = Object.fromEntries(parts.map((p) => [`/${p.day.slice(2).replace(/-/g, "")}_rpts_filtered_torn.csv`, p.body]));
    const seen: string[] = [];
    const cfg = feed("spc.tornadoes:US").config;
    const body = await fetchBody(cfg, NOW, serve(files, seen), 1000, {});
    assert.equal(seen.length, 7); assert.match(seen[0], /\/261011_rpts_filtered_torn\.csv$/); assert.match(seen[6], /\/261005_rpts_filtered_torn\.csv$/);
    assert.deepEqual(parseBody(cfg, body, NOW).readings.map((r) => [r.id, r.value]), fixtureReadings(feed("spc.tornadoes:US"), NOW).readings.map((r) => [r.id, r.value]));
    delete files["/261008_rpts_filtered_torn.csv"];
    await assert.rejects(fetchBody(cfg, NOW, serve(files), 1000, {}), /HTTP 404/);
  });

  test("HANS: a POST whose window starts 30 days back; the keeper's read of any hazard source fails as unavailable on an HTTP error", async () => {
    const seen: string[] = [];
    await fetchBody(feed("usgs.volcanoraise").config, NOW, serve({ "/api/search/search": fx("usgs.van.json").body }, seen), 1000, {});
    assert.match(seen[0], /^POST https:\/\/volcanoes\.usgs\.gov\/hans-public\/api\/search\/search \{"obsAbbr":"","noticeTypeCd":"VAN".*"startUnixtime":1789257600,/, "2026-09-13 00:00 UTC");
    const a = new CatalogueAdapter({ fetchImpl: fail, now: () => NOW });
    for (const id of [...RECURRING, ...ONE_SHOTS]) await assert.rejects(a.settledSince(firstPartyRule(id, KEEPER_ONE_SHOT_RE.test(id) ? 1 : 0.02), null), /HTTP 503/, id);
    await assert.rejects(a.settledSince(ACRES_RULE, null), /HTTP 503/, "nifc.acres");
  });

});

describe("single official source settlement (owner decision 2026-10-12 ~19:05 Denver: the natural-disaster feeds only)", () => {
  test("the flag is on exactly the eleven hazard entries; the flag on any other id does nothing", () => {
    const flagged = (loadSourceEntries() as { id: string; settlement?: string }[]).filter((e) => e.settlement !== undefined).map((e) => e.id).sort();
    assert.deepEqual(flagged, [...SINGLE_SOURCE_IDS].sort());
    assert.deepEqual([...SINGLE_SOURCE_IDS].sort(), ["usgs.quakes", ...NEW_IDS].sort());
    assert.ok((loadSourceEntries() as { settlement?: string }[]).every((e) => e.settlement === undefined || e.settlement === "single-official-source"));
    assert.equal(isSingleOfficialSource({ id: "treasury.debt", settlement: "single-official-source" }), false, "a config edit alone cannot widen the exception");
    assert.equal(isSingleOfficialSource({ id: "usgs.quakes:6" }), false, "the list alone does nothing either");
    assert.equal(isSingleOfficialSource(feed("usgs.quakes:6").config), true);
  });

  test("the keeper reads and accepts the one feed's complete readings, each marked as a single official source; an unavailable read is held", async () => {
    const body = fx("usgs.van.json").body;
    const a = new CatalogueAdapter({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => body }) as never, now: () => NOW });
    const r = await a.settledSince(firstPartyRule("usgs.volcanoraise"), null);
    assert.equal(r.events.length, 29); assert.equal(r.awaitingFinal, 0); assert.equal(r.events.find((e) => e.id === "2026-10-01")!.value, "1");
    assert.ok(r.events.every((e) => /single official source: the U\.S\. Geological Survey's own published data, no cross-read/.test(e.method ?? "")));
    await assert.rejects(new CatalogueAdapter({ fetchImpl: fail, now: () => NOW }).settledSince(firstPartyRule("usgs.volcanoraise"), null), /HTTP 503/, "unavailable: nothing is written");
    const full = { noticeData: Array.from({ length: 20 }, () => (body as { noticeData: unknown[] }).noticeData[0]) };
    const t = await new CatalogueAdapter({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => full }) as never, now: () => NOW }).settledSince(firstPartyRule("usgs.volcanoraise"), null);
    assert.deepEqual(t.events, [], "a refused read gives nothing to settle, never a guess");
    // the exception is not a general one: a flagged copy of another feed still needs its cross-read
    const debt = feedById("treasury.debt")!;
    const base = { awaitingFinal: 0, refusals: [], settlementSourceUrl: debt.sourceUrl };
    const held = await corroborate({ ...debt, config: { ...debt.config, settlement: "single-official-source", fact: undefined } }, [], [{ id: "2026-10-09", at: "2026-10-09", result: null, value: "1", title: "x", sourceUrl: debt.sourceUrl }], NOW, { entries: [], crossFeed: () => null, fetchImpl: fail, now: () => NOW }, base);
    assert.deepEqual(held.events, []);
  });

  test("the creation preflight passes a hazard rule with no cross-read; another feed without one is still refused", async () => {
    const serveBody = (b: unknown): FetchLike => async () => ({ ok: true, status: 200, json: async () => b }) as never;
    const v = await preflightSelector(firstPartyRule("usgs.volcanoraise"), { fetchImpl: serveBody(fx("usgs.van.json").body), now: NOW });
    assert.equal(v.refusal, null, JSON.stringify(v.refusal)); assert.equal(v.ok, true); assert.match(v.agreementBasis, /single official source/);
    const fire = await preflightSelector(firstPartyRule("nifc.firesize:50000", 1), { fetchImpl: serveBody(fx("nifc.size50k.json").body), now: NOW });
    assert.equal(fire.refusal, null, `a one-shot whose last event is weeks old is not stale: ${JSON.stringify(fire.refusal)}`);
    const down = await preflightSelector(firstPartyRule("usgs.volcanoraise"), { fetchImpl: fail, now: NOW });
    assert.equal(down.ok, false); assert.equal(down.refusal!.code, "primary-unreadable");
    const late = await preflightSelector(firstPartyRule("nhc.next:ep.3.2026", 1), { fetchImpl: fail, now: Date.parse("2026-12-03T00:00:00Z") });
    assert.equal(late.ok, false);
  });

  test("the coin text and the source card say it plainly; the coverage matrix counts Natural disasters as settleable", () => {
    for (const [id, share, who] of [["usgs.quakes:6", 0.02, "the U.S. Geological Survey"], ["nhc.next:al.3.2026", 1, "the National Hurricane Center"], ["spc.tornadoes:US", 0.02, "the Storm Prediction Center"], ["nifc.firesize:100000", 1, "the National Interagency Fire Center"], ["usgs.volcanowarning:332010", 1, "the U.S. Geological Survey"]] as const) {
      const t = describeRule(lockRule(firstPartyRule(id, share)).rule, { ticker: "" });
      assert.ok(t.paragraph.includes(`This coin settles on ${who}'s own published data, a single official source. A day the feed is unavailable is held, not counted.`), t.paragraph);
      assert.ok(t.paragraph.length <= DESCRIPTION_MAX, `${id}: ${t.paragraph.length}`); lint(t.paragraph);
    }
    assert.doesNotMatch(describeRule(lockRule(firstPartyRule("fedreg.eo")).rule, { ticker: "" }).paragraph, /single official source/, "only the hazard feeds");
    const card = feedCard({ id: "nhc.storms:al", tier: 4, tierLabel: "x", title: "t", sourceName: "s", sourceUrl: "https://x", cadence: "c", unit: { label: "1 named storm" }, launchable: { ok: true, why: null }, flags: [], lastReading: null });
    assert.equal(card.settlement, singleSourceSentence("nhc.storms:al")); assert.equal(feedCard({ ...card, id: "treasury.debt", unit: { label: "$1B" }, lastReading: null, tierLabel: "x", cadence: "c", sourceName: "s", sourceUrl: "https://x" } as never).settlement, null);
    const doc = fs.readFileSync(path.join(ROOT, "docs/burnticker/SETTLEMENT-COVERAGE.md"), "utf8");
    assert.match(doc, /\| Natural disasters \| \*\*settleable\*\* \|/); assert.match(doc, /a single official source, with no second source/);
  });
});

describe("rules, dials and eligibility", () => {
  test("one-shots take the one-shot share (up to 100%), cannot be inverted, and end on their first receipt; recurring ones can take the fade side", () => {
    for (const id of ONE_SHOTS) {
      const r = validateRule(firstPartyRule(id, 1));
      assert.equal(isOneShot(r), true, id); assert.equal(dialsFor(r).bounds.max, 1, id); assert.equal(shareShapeOf(r), "oneShot", id);
      assert.ok(inverseRefusal(r), `${id}: no fade side`); assert.equal(windowKindOf(r), "one-shot");
    }
    for (const id of RECURRING) { const r = validateRule(firstPartyRule(id)); assert.equal(isOneShot(r), false, id); assert.equal(inverseRefusal(r), null, id); assert.equal(shareShapeOf(r), "recurring"); }
  });

  test("an earlier event never makes a next-event one-shot decided; a hurricane season that is over does", () => {
    const sample = (id: string, file: string) => oneShotEligibility(id, feed(id).config, fx(file).body, NOW);
    assert.equal(sample("usgs.quakenext:6.5", "usgs.m65.json").decided, false, "three M6.5 days in the sample, all before any new coin");
    assert.equal(sample("nhc.next:ep.3.2026", "nhc.btk.ep.json").decided, false);
    assert.equal(sample("usgs.volcanowarning:332010", "usgs.van.2026-03.json").decided, false);
    const over = oneShotEligibility("nhc.next:ep.3.2026", feed("nhc.next:ep.3.2026").config, fx("nhc.btk.ep.json").body, Date.parse("2026-12-01T00:00:00Z"));
    assert.deepEqual(over, { decided: true, reason: SEASON_OVER_SENTENCE, subject: null });
    assert.equal(nhcSeasonOpen(2026, Date.parse("2026-11-30T23:59:00Z")), true); assert.equal(nhcSeasonOpen(2025, NOW), false);
    lint(SEASON_OVER_SENTENCE); assert.doesNotMatch(SEASON_OVER_SENTENCE, HARM);
  });
});

describe("the coin text: clinical, plain, one window sentence", () => {
  const cases: [string, number, boolean, RegExp][] = [
    ["usgs.quakes:6", 0.02, false, /burns for every earthquake of magnitude 6 or more anywhere in the world/],
    ["usgs.quakenext:7", 1, false, /burns once on the next earthquake of magnitude 7 or more anywhere in the world/],
    ["usgs.quakenext:6.5/japan", 0.5, false, /next earthquake of magnitude 6\.5 or more in Japan and its coast/],
    ["nhc.storms:al", 0.02, false, /burns for every named storm in the Atlantic/],
    ["nhc.storms:ep", 0.02, true, /burns on every day no new named storm in the eastern Pacific is counted/],
    ["nhc.hurricanes:ep.3", 0.05, false, /burns for every hurricane of category 3 or higher in the eastern Pacific/],
    ["nhc.next:al.3.2026", 1, false, /burns once on the next category 3 hurricane in the Atlantic this season/],
    ["spc.tornadoes:US", 0.01, false, /burns for every tornado report in the United States/],
    ["spc.tornadoes:OK", 0.02, true, /burns on every day with no tornado report in Oklahoma/],
    ["spc.tornadoday:10/US", 1, false, /burns once on the next day with 10 or more tornado reports in the United States/],
    ["spc.tornadoday:1/KS", 1, false, /burns once on the next day with a tornado report in Kansas/],
    ["nifc.firesize:100000", 1, false, /burns once on the next wildfire to reach 100,000 acres/],
    ["usgs.volcanoraise", 0.02, false, /burns every time the USGS raises a U\.S\. volcano's alert level/],
    ["usgs.volcanoraise", 0.02, true, /burns on every day no U\.S\. volcano alert level is raised/],
    ["usgs.volcanowarning:332010", 1, false, /burns once if the USGS raises Kilauea to its warning level/],
  ];
  for (const [id, share, inv, re] of cases) test(`${id}${inv ? " (fade side)" : ""}`, () => {
    const locked = lockRule({ ...firstPartyRule(id, share), ...(inv ? { inverse: true } : {}) } as BurnRule);
    const t = describeRule(locked.rule, { ticker: "" });
    lint(t.paragraph); assert.match(t.paragraph, re); assert.ok(t.paragraph.length <= DESCRIPTION_MAX, `${t.paragraph.length}`);
    assert.doesNotMatch(`${t.paragraph} ${t.name}`, HARM, "never harm"); assert.doesNotMatch(t.paragraph, /\bwill\b/i, "no 'will'");
    assert.doesNotMatch(t.paragraph, /\b(19|20)\d\d-\d\d-\d\d\b/, "no dates");
    assert.ok(t.name.length <= 32 && /^[A-Z0-9]{2,10}$/.test(t.ticker), `${t.name} / ${t.ticker}`);
    const kind = KEEPER_ONE_SHOT_RE.test(id) ? "one-shot" : "perpetual";
    for (const [k, w] of Object.entries(WINDOW_SENTENCE)) assert.equal((t.paragraph.match(new RegExp(w.source, "g")) ?? []).length, k === kind ? 1 : 0, `${k}\n${t.paragraph}`);
    assert.doesNotMatch(t.paragraph, /cross-checked against a second publisher/, "no cross-read is claimed where none exists");
  });

  test("the nifc.acres rule (per 100,000 acres, carry) reads plainly", () => {
    const r = lockRule(ACRES_RULE).rule;
    const t = describeRule(r, { ticker: "" });
    lint(t.paragraph); assert.match(t.paragraph, /burns for every 100,000 acres of wildfire in the United States/); assert.doesNotMatch(t.paragraph, HARM);
  });

  test("no sentence or literal in the five source modules mentions harm", () => {
    for (const f of ["usgs.ts", "nhc.ts", "spc.ts", "nifc.ts", "volcano.ts"]) {
      const src = fs.readFileSync(path.join(ROOT, "src/lib/burnticker/sources", f), "utf8");
      src.split("\n").forEach((l, i) => assert.doesNotMatch(l, HARM, `${f}:${i + 1}`));
    }
    fs.readFileSync(path.join(ROOT, "src/lib/burnticker/hazards.ts"), "utf8").split("\n").forEach((l, i) => assert.doesNotMatch(l, HARM, `hazards.ts:${i + 1}`));
  });
});

describe("the launch option (hazards.ts; the page wiring is in WIRING-SOURCES3.md)", () => {
  test("the entry card, the five kinds and the two patterns: plain, lint-clean, never harm; every starting series resolves", () => {
    for (const t of [HAZARD_FOLLOW.label, HAZARD_FOLLOW.line, HAZARD_FOLLOW.sentence, HAZARD_FOLLOW.example, HAZARD_SEASON_OVER, ...Object.values(HAZARD_PATTERNS).flatMap((p) => [p.label, p.sentence])]) { lint(t); assert.doesNotMatch(t, HARM, t); }
    assert.deepEqual(HAZARD_KINDS.map((k) => k.id), ["quake", "hurricane", "tornado", "wildfire", "volcano"]);
    for (const k of HAZARD_KINDS) {
      assert.ok(feedById(k.every) && !KEEPER_ONE_SHOT_RE.test(k.every), k.every);
      const once = k.once(2026); assert.ok(feedById(once) && NEXT_EVENT_ONE_SHOT_RE.test(once), once);
      assert.ok(isHazardSeries(k.every) && isHazardSeries(once));
    }
    assert.equal(isHazardSeries("treasury.debt"), false); assert.equal(isHazardSeries("nws.high:DEN-90"), false);
  });

  test("hazardSwap: the same subject in the other pattern, both ways; a closed season refuses", () => {
    const sw = (s: string, to: "every" | "once", at = NOW) => hazardSwap(s, to, at);
    assert.deepEqual(sw("usgs.quakes:4.5/california", "once"), { series: "usgs.quakenext:6/california" });
    assert.deepEqual(sw("usgs.quakenext:7.5", "every"), { series: "usgs.quakes:7.5" });
    assert.deepEqual(sw("nhc.hurricanes:ep.4", "once"), { series: "nhc.next:ep.4.2026" });
    assert.deepEqual(sw("nhc.storms:al", "once"), { series: "nhc.next:al.1.2026" });
    assert.deepEqual(sw("nhc.next:al.3.2026", "every"), { series: "nhc.hurricanes:al.3" });
    assert.deepEqual(sw("nhc.hurricanes:al.3", "once", Date.parse("2026-12-05T00:00:00Z")), { refused: HAZARD_SEASON_OVER });
    assert.deepEqual(sw("spc.tornadoes:OK", "once"), { series: "spc.tornadoday:1/OK" }); assert.deepEqual(sw("spc.tornadoes:US", "once"), { series: "spc.tornadoday:10/US" });
    assert.deepEqual(sw("spc.tornadoday:25/TX", "every"), { series: "spc.tornadoes:TX" });
    assert.deepEqual(sw("nifc.acres", "once"), { series: "nifc.firesize:100000" }); assert.deepEqual(sw("nifc.firesize:50000", "every"), { series: "nifc.acres" });
    assert.deepEqual(sw("usgs.volcanoraise", "once"), { series: "usgs.volcanowarning:332010" }); assert.deepEqual(sw("usgs.volcanowarning:321050", "every"), { series: "usgs.volcanoraise" });
    assert.equal(sw("treasury.debt", "once"), null);
    for (const k of HAZARD_KINDS) { const o = sw(k.every, "once") as { series: string }; assert.ok(feedById(o.series), o.series); }
  });

  test("step 3 for a natural disaster: both patterns live, the fade side only on the per-event form, winner greyed; a closed season greys once", () => {
    const at = (r: BurnRule, now = NOW) => hazardPatternOptions(r, now);
    const per = at(validateRule(firstPartyRule("usgs.quakes:6")));
    assert.deepEqual(per.options.map((o) => [o.id, o.available]), [["every", true], ["fade", true], ["once", true], ["winner", false]]); assert.equal(per.preselected, "every");
    assert.equal(per.options[2].label, "Once, on the next one");
    const one = at(validateRule(firstPartyRule("usgs.quakenext:7", 1)));
    assert.deepEqual(one.options.map((o) => [o.id, o.available]), [["every", true], ["fade", false], ["once", true], ["winner", false]]); assert.equal(one.preselected, "once");
    const late = at(validateRule(firstPartyRule("nhc.hurricanes:al.3")), Date.parse("2026-12-05T00:00:00Z"));
    assert.equal(late.options[2].available, false); assert.equal(late.options[2].reason, HAZARD_SEASON_OVER);
    for (const o of [...per.options, ...one.options]) { lint(o.sentence); if (o.reason) lint(o.reason); }
  });
});
