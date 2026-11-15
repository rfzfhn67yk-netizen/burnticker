// sources-6 (QA pass 9, 2026-10-13): #16 weather thresholds that fire almost always or almost never, #17 results due before a coin could
// graduate on the event-outcome path, #40 the disaster threshold controls (never switched silently between patterns), audit 10 #18 the two
// wildfire forms explained.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { weatherFrequency, OFTEN_DAYS, RARELY_DAYS } from "@/lib/burnticker/sources/nwsClimate";
import { hazardCatalogue, hazardControls, hazardSeriesFor, hazardSwap, HAZARD_MEASURES, HAZARD_SEASON_OVER } from "@/lib/burnticker/hazards";
import { feedById } from "@/lib/burnticker/catalogue";
import { statedCtx } from "@/lib/burnticker/coinText";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { polyRule } from "@/lib/burnticker/search";
import { dueSoonLine } from "@/lib/burnticker/timing";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { polymarketSearch } from "@/lib/burnticker/api/handlers";
import { v1Catalogue } from "@/lib/burnticker/api/v1";

const cfg = loadCopyLintConfig();
const plain = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}: ${t}`); };
const NOW = Date.parse("2026-10-13T12:00:00Z");

describe("QA pass 9 #16: a weather threshold says how often it fires at its station", () => {
  test("from the station's 2016–2025 history: almost every day and almost never are warned, ordinary thresholds are not", () => {
    const hot = weatherFrequency("nws.high:DEN-40")!;
    assert.ok(hot.daysPerYear >= OFTEN_DAYS, String(hot.daysPerYear));
    assert.match(hot.warning!, /^At Denver \(DIA\), a high of 40 °F or more came about \d+ days a year from 2016 to 2025\. This rule fires on almost every day/);
    const rare = weatherFrequency("nws.rain:PHX-2.00")!;
    assert.ok(rare.daysPerYear <= RARELY_DAYS);
    assert.match(rare.warning!, /may not fire at all for a year or more/);
    const mid = weatherFrequency("nws.high:DEN-90")!;
    assert.equal(mid.warning, null); assert.ok(mid.daysPerYear > 10 && mid.daysPerYear < 120, String(mid.daysPerYear));
    const fade = weatherFrequency("nws.high:DEN-40", true)!;
    assert.ok(Math.abs(fade.daysPerYear + hot.daysPerYear - 365.25) < 0.2, "the fade side is the other days");
    assert.equal(weatherFrequency("nws.snow:DEN"), null, "a first-snow rule has no frequency");
    for (const t of [hot.warning!, rare.warning!, mid.line]) plain(t);
  });
  test("the review carries the warning", () => {
    const r = buildLaunchReview({ rule: nativeRule("nws.high:DEN-40", { fractionOfPool: 0.02 }), ticker: "DENHOT", name: "Denver Heat" }, { env: { BURNTICKER_CLUSTER: "devnet" }, now: NOW });
    assert.ok("review" in r, JSON.stringify(r));
    assert.ok(r.review.warnings.some((w) => /fires on almost every day/.test(w)), r.review.warnings.join(" | "));
  });
});

describe("QA pass 9 #17: a result due before a coin could graduate, on the event-outcome path", () => {
  test("the review reads the market's own end date from the server's read when the page sends none, and warns within 14 days", () => {
    const cid = `0x${"a".repeat(64)}`;
    const stated = statedCtx({ stated: { resolutionSource: { phrase: "the NFL", crossRead: null }, finalAfter: { text: "about 2 hours" } }, endsAt: "2026-10-20T00:00:00Z" });
    const r = buildLaunchReview({ rule: polyRule(cid, 1), ticker: "EAGLES", name: "Eagles Win", descCtx: { eventPhrase: "the Eagles win on Sunday" } }, { env: { BURNTICKER_CLUSTER: "devnet" }, now: NOW, stated });
    assert.ok("review" in r, JSON.stringify(r));
    assert.ok(r.review.warnings.includes(dueSoonLine(7)), r.review.warnings.join(" | "));
    const far = buildLaunchReview({ rule: polyRule(cid, 1), ticker: "EAGLES", name: "Eagles Win" }, { env: { BURNTICKER_CLUSTER: "devnet" }, now: NOW, stated: statedCtx({ stated: { resolutionSource: { phrase: null, crossRead: null }, finalAfter: { text: "about 2 hours" } }, endsAt: "2027-02-01T00:00:00Z" }) });
    assert.ok("review" in far && !far.review.warnings.some((w) => /due within/.test(w)));
  });
  test("GET /v1/polymarket/search hides a market closing within 48 hours unless asked, and marks it", async () => {
    const m = (id: string, end: string) => ({ conditionId: id, question: `Q ${id}?`, yes: "Yes", no: "No", endDate: end, closed: false, sportsMarketType: null, selector: { oracle: "polymarket", series: null, market: id } });
    const p = { polymarketDiscovery: true, polymarket: { search: async () => ({ events: [], tags: [], markets: [m("0x1", "2026-10-14T00:00:00Z"), m("0x2", "2026-11-14T00:00:00Z"), m("0x3", "2026-10-01T00:00:00Z")] }) } } as never;
    const r = await polymarketSearch(p, { q: "eagles" }, NOW);
    const b = r.body as { markets: { conditionId: string; closingSoon: boolean }[]; hiddenClosingSoon: number };
    assert.deepEqual(b.markets.map((x) => x.conditionId), ["0x2", "0x3"]);
    assert.equal(b.hiddenClosingSoon, 1);
    const all = await polymarketSearch(p, { q: "eagles", closingSoon: "1" }, NOW);
    assert.deepEqual((all.body as typeof b).markets.map((x) => [x.conditionId, x.closingSoon]), [["0x1", true], ["0x2", false], ["0x3", false]]);
  });
});

describe("QA pass 9 #40: disaster thresholds as controls, never switched silently between patterns", () => {
  test("every control value builds a series the catalogue reads; a value a pattern does not offer is refused in words", () => {
    const c = hazardControls();
    for (const [kind, pats] of Object.entries(c) as [keyof typeof c, (typeof c)[keyof typeof c]][]) {
      for (const pattern of ["every", "once"] as const) {
        const ctls = pats[pattern];
        const combos: Record<string, string>[] = [{}];
        for (const ctl of ctls) for (const o of ctl.options.slice(0, 3)) combos.push({ [ctl.id]: o.value });
        for (const v of combos) {
          const s = hazardSeriesFor(kind, pattern, v, NOW);
          assert.ok("series" in s, `${kind} ${pattern} ${JSON.stringify(v)} ${JSON.stringify(s)}`);
          assert.ok(feedById(s.series), s.series);
        }
      }
    }
    assert.deepEqual(hazardSeriesFor("quake", "once", { magnitude: "7.5", region: "japan" }, NOW), { series: "usgs.quakenext:7.5/japan" });
    assert.deepEqual(hazardSeriesFor("hurricane", "every", { category: "0", basin: "ep" }, NOW), { series: "nhc.storms:ep" });
    assert.deepEqual(hazardSeriesFor("volcano", "once", { volcano: "321050" }, NOW), { series: "usgs.volcanowarning:321050" });
    const no = hazardSeriesFor("quake", "once", { magnitude: "5" }, NOW);
    assert.ok("refused" in no && /Magnitude at least 5 is not offered for this pattern/.test(no.refused));
    assert.deepEqual(hazardSeriesFor("hurricane", "once", {}, Date.parse("2026-12-05T00:00:00Z")), { refused: HAZARD_SEASON_OVER });
  });
  test("a pattern switch that changes a threshold says so", () => {
    const n = (s: string, to: "every" | "once") => { const r = hazardSwap(s, to, NOW); return r && "notice" in r ? r.notice ?? null : null; };
    assert.match(n("usgs.quakes:4.5/california", "once")!, /magnitude 4\.5 is now magnitude 6/);
    assert.equal(n("usgs.quakes:7", "once"), null, "a magnitude both patterns offer is kept without a notice");
    assert.match(n("nhc.storms:al", "once")!, /category 1 hurricane/);
    assert.match(n("spc.tornadoday:25/TX", "every")!, /bar of 25 reports/);
    assert.match(n("nifc.firesize:50000", "every")!, /national total/);
    assert.match(n("usgs.volcanowarning:321050", "every")!, /not only Mount St\. Helens/);
    for (const s of ["usgs.quakes:4.5/california", "nhc.storms:al", "spc.tornadoes:US", "nifc.acres", "usgs.volcanoraise"]) plain(n(s, "once") ?? "");
  });
  test("GET /v1/catalogue lists the five kinds with their controls and what each pattern measures (audit 10 #18: the wildfire forms)", () => {
    const b = v1Catalogue(NOW, {}).body as { hazards: ReturnType<typeof hazardCatalogue> };
    assert.deepEqual(b.hazards.map((h) => h.id), ["quake", "hurricane", "tornado", "wildfire", "volcano"]);
    const fire = b.hazards.find((h) => h.id === "wildfire")!;
    assert.match(fire.measures.every, /^Recurring: each 100,000 acres added to the year's national total/);
    assert.match(fire.measures.once, /^One time: the first single wildfire discovered after launch that reaches the size/);
    assert.equal(b.hazards.find((h) => h.id === "volcano")!.controls.once[0].id, "volcano");
    for (const k of Object.values(HAZARD_MEASURES)) { plain(k.every); plain(k.once); }
  });
});
