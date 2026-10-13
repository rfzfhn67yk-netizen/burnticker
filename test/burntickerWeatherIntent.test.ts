// THE INTENT AUDIT (2026-10-12), the search side: items 1 (a "below" weather query became "or hotter"), 2 (Celsius and "tomorrow" were
// dropped), 7 (the fade side of "U.S. unemployment rate" was cut at "U.S."), 9 (a Denver weather query showed only sports) and 11 (the
// first-snow season was not disclosed). One normalized weather intent (weatherIntent.ts) drives the card, the rule and the coin text.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseWeatherIntent, planWeather, nwsBoundary, FIRST_SNOW_SEASON, type WeatherIntent, type WeatherPlan } from "@/lib/burnticker/weatherIntent";
import { universalSearch, readWeatherThreshold, type Suggestion } from "@/lib/burnticker/search";
import { describeRule, leadSentence, DESCRIPTION_MAX, SNOW_SEASON_SENTENCE } from "@/lib/burnticker/describe";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { nwsSeries } from "@/lib/burnticker/sources/nws";
import { unitSteps } from "@/lib/burnticker/units";
import { validateRule, type BurnRule } from "@/lib/burnticker/rules";
import { feedById } from "@/lib/burnticker/catalogue";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { espnFixtureClient, ESPN_NOW } from "./burntickerFirstPartyHelpers.ts";

const cfg = loadCopyLintConfig();
const lint = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };
const intent = (q: string): WeatherIntent => { const i = parseWeatherIntent(q)[0]; assert.ok(i, `${q} reads as weather`); return i; };
const plan = (q: string): WeatherPlan => planWeather(intent(q));
const ok = (q: string) => { const p = plan(q); assert.ok(p.ok, `${q}: ${p.ok ? "" : p.refusal}`); return p; };
const refused = (q: string) => { const p = plan(q); assert.ok(!p.ok, `${q} is refused`); return p; };
const deps = { venues: { kalshi: false, polymarket: false, feeds: true }, feeds: [], espn: espnFixtureClient(), polyGet: null, refuse: () => [], kalshiSearch: null, derbyHref: null, nowMs: ESPN_NOW };
const ruleOf = (p: Extract<WeatherPlan, { ok: true }>): BurnRule => validateRule(p.inverse ? { ...nativeRule(p.series), inverse: true } : nativeRule(p.series));
/** Which whole-degree highs burn under the plan's rule (units.ts, the keeper's own step). */
const burnsAt = (r: BurnRule, highs: number[]): number[] => {
  const n = Number(r.series!.split("-").pop());
  const evs = highs.map((h, k) => ({ id: `2026-01-${String(k + 1).padStart(2, "0")}`, at: `2026-01-${String(k + 1).padStart(2, "0")}`, result: null, value: h >= n ? "1" : "0", title: "", sourceUrl: "", method: "test" }));
  return unitSteps(r, evs as never).map((s, k) => (s.step.units > 0 ? highs[k] : null)).filter((x): x is number => x !== null);
};

describe("intent audit items 1 and 2: the normalized weather intent", () => {
  test("below / at most / above / at least: operator, strictness, threshold and the fade side; 32 is excluded by < and >", () => {
    const below = ok("Detroit high below 32");
    assert.deepEqual({ op: below.intent.op, value: below.intent.value, unit: below.intent.unit, date: below.intent.dateScope, station: below.intent.station.code }, { op: "lt", value: 32, unit: null, date: null, station: "DTW" });
    assert.deepEqual([below.series, below.inverse, below.boundary], ["nws.high:DTW-32", true, "31 °F or colder"]);
    assert.deepEqual(burnsAt(ruleOf(below), [30, 31, 32, 33]), [30, 31], "below 32 never burns at 32");
    const atMost = ok("Detroit high at most 32");
    assert.deepEqual([atMost.intent.op, atMost.series, atMost.inverse, atMost.boundary], ["le", "nws.high:DTW-33", true, "32 °F or colder"]);
    assert.deepEqual(burnsAt(ruleOf(atMost), [31, 32, 33]), [31, 32]);
    const above = ok("Detroit high above 32");
    assert.deepEqual([above.intent.op, above.series, above.inverse, above.boundary], ["gt", "nws.high:DTW-33", false, "33 °F or hotter"]);
    assert.deepEqual(burnsAt(ruleOf(above), [31, 32, 33]), [33], "above 32 never burns at 32");
    const atLeast = ok("Detroit high at least 32");
    assert.deepEqual([atLeast.intent.op, atLeast.series, atLeast.inverse, atLeast.boundary], ["ge", "nws.high:DTW-32", false, "32 °F or hotter"]);
    assert.deepEqual(burnsAt(ruleOf(atLeast), [31, 32, 33]), [32, 33]);
    for (const q of ["Detroit high under 32", "Detroit high less than 32", "Detroit high < 32"]) assert.equal(ok(q).series, "nws.high:DTW-32", q);
    for (const q of ["Detroit high 32 or less", "Detroit high no more than 32", "Detroit high <= 32"]) assert.deepEqual([ok(q).series, ok(q).inverse], ["nws.high:DTW-33", true], q);
    assert.deepEqual([ok("Detroit high below freezing").series, ok("Detroit high below freezing").inverse], ["nws.high:DTW-32", true]);
    assert.deepEqual([ok("Detroit high below 32.5").series, ok("Detroit high below 32.5").boundary], ["nws.high:DTW-33", "32 °F or colder"], "below 32.5 includes 32");
    assert.deepEqual([ok("Denver rain below 0.5").series, ok("Denver rain below 0.5").inverse, ok("Denver rain below 0.5").boundary], ["nws.rain:DEN-0.50", true, "less than 0.50 in of rain"]);
  });

  test("exactly, a range, the daily low, kelvin and a snowfall amount are refused in words, never turned into a threshold", () => {
    const eq = refused("Detroit high exactly 32");
    assert.equal(eq.intent.op, "eq"); assert.equal(eq.alternative, null);
    assert.equal(eq.refusal, "A weather coin can count the days at or above a number, or the days below it. It cannot count the days at exactly one number.");
    assert.equal(refused("Detroit high is 32").intent.op, "eq");
    assert.match(refused("Detroit high between 30 and 40").refusal, /cannot count the days inside a range/);
    assert.match(refused("Detroit low below 20").refusal, /It does not read the daily low/);
    assert.match(refused("Detroit high above 300 K").refusal, /Kelvin is not offered/);
    const snowAmt = refused("Denver snow above 2 inches");
    assert.match(snowAmt.refusal, /cannot take another amount/); assert.equal(snowAmt.alternative?.ok && snowAmt.alternative.series, "nws.snow:DEN");
    assert.match(refused("Denver cold days").refusal, /Name a temperature, for example: Denver high below 32\./);
  });

  test("Celsius is converted before the boundary, and the conversion is shown: above 30 °C is above 86 °F, so 87 °F or hotter", () => {
    const c = ok("Detroit high above 30 C");
    assert.deepEqual([c.intent.unit, c.intent.value, c.intent.op, c.series, c.boundary], ["C", 30, "gt", "nws.high:DTW-87", "87 °F or hotter"]);
    assert.equal(c.note, "You wrote “above 30 C”. 30 °C is 86 °F. The climate report records whole degrees Fahrenheit, so above 86 °F means 87 °F or hotter.");
    assert.equal(ok("Detroit high below 0°C").series, "nws.high:DTW-32");
    assert.equal(ok("Detroit high at least 30 celsius").series, "nws.high:DTW-86");
    assert.equal(ok("Denver rain above 10 mm").series, "nws.rain:DEN-0.40", "10 mm is 0.3937 in; strictly above that is 0.40 in");
    assert.equal(ok("Detroit high above 90 in Detroit").intent.unit, null, "\"in\" before a place is not inches");
  });

  test("a date scope is refused (a weather rule has no one-day window); the recurring rule comes only as a separate, labelled alternative", () => {
    const one = refused("Detroit high above 90 tomorrow");
    assert.equal(one.intent.dateScope, "tomorrow");
    assert.equal(one.refusal, "You asked about one day (“tomorrow”). A weather coin counts every day, with no end date, so a coin on one day's weather is not offered.");
    assert.ok(one.alternative?.ok); assert.equal(one.alternative.series, "nws.high:DTW-91"); assert.equal(one.alternative.intent.dateScope, null);
    const both = refused("Detroit high above 30 C tomorrow");
    assert.ok(both.alternative?.ok); assert.equal(both.alternative.series, "nws.high:DTW-87", "the unit is still converted on the alternative");
    for (const q of ["Detroit high above 90 today", "Detroit high above 90 on Friday", "Detroit high above 90 on Oct 14", "Detroit high above 90 in July"]) assert.ok(refused(q).intent.dateScope, q);
    assert.equal(refused("Detroit high exactly 32 tomorrow").alternative, null, "no alternative for an unsupported comparison");
  });

  test("the older reader agrees with the plan", () => {
    assert.deepEqual(readWeatherThreshold("Detroit high above 90", "high"), { metric: "high", threshold: 91, strict: true, wrote: "above 90" });
    assert.equal(readWeatherThreshold("Detroit high below 32", "high").threshold, 32);
  });
});

describe("intent audit items 1, 2 and 9: the search cards", () => {
  const nws = (cards: Suggestion[]) => cards.filter((c) => c.venue === "nws");
  test("'Detroit high below 32': the card, its rule and the coin text all say 31 °F or colder; nothing says hotter", async () => {
    const r = await universalSearch("Detroit high below 32", deps);
    const c = r.cards[0];
    assert.equal(c.venue, "nws"); assert.equal(c.rule?.series, "nws.high:DTW-32"); assert.equal(c.rule?.inverse, true);
    assert.equal(c.title, "Burns 2% every day Detroit's official high is 31 °F or colder");
    assert.equal(c.subtitle, "Detroit daily high below 32 °F (NWS), at station DTW");
    assert.equal(c.pick?.title, "Detroit daily high below 32 °F (NWS)");
    assert.match(c.interpreted ?? "", /31 °F or colder\. Each day runs from midnight to midnight, Eastern Standard Time, all year/);
    assert.equal(c.text?.ticker, "DTWCOLD");
    assert.match(c.text?.paragraph ?? "", /official high is 31 °F or colder/);
    for (const s of [c.title, c.subtitle, c.interpreted ?? "", c.note ?? ""]) { assert.doesNotMatch(s, /hotter/); lint(s); }
    lint(c.text!.paragraph);
    assert.deepEqual(c.text!.paragraph.match(/[^.]*hotter[^.]*\./g), [" Nothing happens on a day at 32 °F or hotter, or on a day with no reading."], "the only hot side is the day that burns nothing");
    assert.equal(nwsBoundary(c.rule!.series!, true), "31 °F or colder");
  });

  test("'Detroit high above 30 C tomorrow': a refusal first, then the recurring 87 °F rule labelled a related rule; never 31 °F", async () => {
    const r = await universalSearch("Detroit high above 30 C tomorrow", deps);
    const [first, second] = nws(r.cards);
    assert.equal(first.rule, null); assert.deepEqual(first.refused, ["one day's weather"]);
    assert.equal(first.title, "A coin on Detroit's high above 30 C tomorrow is not offered as written");
    assert.equal(second.alternative, true); assert.equal(second.rule?.series, "nws.high:DTW-87");
    assert.match(second.note ?? "", /^This is the recurring rule, not the one day you typed\. You wrote “above 30 C”\. 30 °C is 86 °F\./);
    assert.ok(!r.cards.some((c) => c.rule?.series === "nws.high:DTW-31"));
    for (const c of [first, second]) for (const s of [c.title, c.note ?? "", c.interpreted ?? ""]) lint(s);
  });

  test("'Denver high below 32 tomorrow' (the reproduction): a weather card leads; no sports card at all", async () => {
    const r = await universalSearch("Denver high below 32 tomorrow", deps);
    assert.equal(r.cards[0].group, "weather");
    assert.equal(r.cards[0].venue, "nws"); assert.match(r.cards[0].note ?? "", /one day's weather is not offered/);
    assert.equal(r.cards[1].rule?.series, "nws.high:DEN-32"); assert.equal(r.cards[1].rule?.inverse, true); assert.equal(r.cards[1].alternative, true);
    assert.ok(!r.cards.some((c) => c.venue === "espn" || c.group === "teams"), r.cards.map((c) => c.title).join(" | "));
    const snow = await universalSearch("Denver first snow", deps);
    assert.equal(snow.cards[0].rule?.series, "nws.snow:DEN"); assert.ok(!snow.cards.some((c) => c.group === "teams"));
  });

  test("a team named by its nickname with a weak word stays a team query; a strong weather word does not", async () => {
    assert.deepEqual(parseWeatherIntent("Denver Nuggets high", { teamNamed: true }), []);
    assert.equal(parseWeatherIntent("Denver Nuggets temperature", { teamNamed: true }).length, 1);
    assert.deepEqual(parseWeatherIntent("Rays win"), []);
  });
});

describe("intent audit item 7: the lead sentence renders whole", () => {
  test("'U.S. unemployment rate' on both sides, D.C., St. Louis, decimals and abbreviations", () => {
    const f = feedById("fred.UNRATE")!;
    const rule = validateRule({ schema: "burnticker.rules/v1", oracle: "catalogue", series: "fred.UNRATE", market: null, filter: {}, kind: "scalar", scalar: { unit: 0.1, perUnit: { fractionOfPool: 0.02 }, baseline: "previousSettlement", direction: "abs" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } as BurnRule);
    const ctx = { ticker: "JOBLESS", feed: { title: "U.S. unemployment rate", sourceName: f.sourceName, unitLabel: "0.1 percentage-point move" } };
    const plain = describeRule(rule, ctx), inv = describeRule({ ...rule, inverse: true } as BurnRule, ctx);
    // sources-4 (audit 201): a rule measured against the previous reading names a change, never a total
    assert.equal(plain.lead, "For each full change of 0.1 percentage point in the U.S. unemployment rate, up or down, since the previous reading, the burn pool spends 2% buying $JOBLESS on Raydium and burns it, with a receipt on chain.");
    assert.equal(inv.lead, "For every reading of U.S. unemployment rate that does not move, the burn pool spends 2% buying $JOBLESS on Raydium and burns it, with a receipt on chain.");
    assert.ok(inv.ruleBlock.startsWith(inv.lead));
    assert.equal(leadSentence("The U.S. Treasury publishes it. Then it is read."), "The U.S. Treasury publishes it.");
    assert.equal(leadSentence("Washington, D.C. Reagan National reads 0.25 in. Then nothing."), "Washington, D.C. Reagan National reads 0.25 in.");
    assert.equal(leadSentence("St. Louis gets 0.1 in. More text."), "St. Louis gets 0.1 in.");
    assert.equal(leadSentence("It moved 4.1 to 4.2 points. $JOBLESS burns."), "It moved 4.1 to 4.2 points.");
    assert.equal(leadSentence("One sentence only"), "One sentence only");
  });
});

describe("intent audit item 11: the first-snow season is disclosed", () => {
  test("the card and the coin text say the season, the launch-day rule, a first snow that came earlier and no snow", async () => {
    const r = await universalSearch("Denver first snow", deps);
    const c = r.cards[0];
    assert.match(c.interpreted ?? "", /The snow season runs from July 1 to June 30/);
    assert.ok((c.interpreted ?? "").includes(FIRST_SNOW_SEASON)); assert.ok((c.howSettles ?? "").includes(FIRST_SNOW_SEASON));
    const t = describeRule(nativeRule(nwsSeries("snow", "DEN"), { fractionOfPool: 0.02 }), { ticker: "DENSNOW" });
    assert.ok(t.ruleBlock.includes(SNOW_SEASON_SENTENCE));
    assert.ok(t.paragraph.length <= DESCRIPTION_MAX, `${t.paragraph.length}`);
    for (const s of [FIRST_SNOW_SEASON, SNOW_SEASON_SENTENCE, t.paragraph, c.interpreted ?? ""]) lint(s);
  });
});
