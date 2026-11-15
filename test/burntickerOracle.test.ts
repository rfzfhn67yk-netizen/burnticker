// BURNTICKER (2026-10-09) — the Kalshi oracle on the FROZEN REAL FIXTURES (config/burnticker/fixtures/kalshi, fetched 10-09/10):
// the four example selectors (Broncos games, Denver daily high, a one-shot market, the S&P 4pm close), finality (the settlement
// timer), ladder derivation, voids, the back-test, the market-implied chance (display only), the client's cache/rate limit, the
// refuse list, and the Polymarket Gamma parser (the full Polymarket oracle: test/burntickerPolymarket.test.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateRule } from "@/lib/burnticker/rules";
import { eventValue, fixtureFetch, impliedChanceFrom, isFinal, KalshiClient, parseMarketsBody, parseSeriesBody, resolveSelector, selectorMatches, settledMarketsUrl, seriesApiUrl, openMarketsUrl, closedMarketsUrl, seriesListUrl, type KalshiMarket } from "@/lib/burnticker/oracle/kalshi";
import { backtest, backtestSentence } from "@/lib/burnticker/oracle/backtest";
import { loadRefuseList, nameRefusals, parseRefuseList, refusalsFor } from "@/lib/burnticker/oracle/refuse";
import { gammaResult, parseGammaMarket, settledMarketUrl } from "@/lib/burnticker/oracle/polymarket";
import { unitSteps } from "@/lib/burnticker/units";
import { BRONCOS, DENVER_HIGH, NOW, ONE_SHOT, SPX, fx } from "./burntickerHelpers.ts";

const nfl = parseMarketsBody(fx("kalshi/KXNFLGAME.settled.json")).markets;
const gamma = (fx("polymarket/gamma.markets.json") as { markets: unknown[] }).markets;
const highden = parseMarketsBody(fx("kalshi/KXHIGHDEN.settled.json")).markets;
const highdenOpen = parseMarketsBody(fx("kalshi/KXHIGHDEN.open.json")).markets;
const inx = parseMarketsBody(fx("kalshi/KXINX.settled.json")).markets;
const cpi = parseMarketsBody(fx("kalshi/KXCPI.settled.json")).markets;

describe("kalshi: parsing and finality", () => {
  test("the fixtures parse; settled markets are finalized with yes/no results and a settlement time", () => {
    assert.ok(nfl.length >= 8 && highden.length >= 12 && inx.length >= 30 && cpi.length >= 10);
    for (const m of [...nfl, ...highden, ...inx]) { assert.ok(m.result === "yes" || m.result === "no", m.ticker); assert.ok(m.settlementTs, m.ticker); assert.ok(isFinal(m, NOW)); }
    assert.equal(parseSeriesBody(fx("kalshi/series.KXHIGHDEN.json"))!.settlementSource!.url.length > 0, true);
    assert.equal(parseSeriesBody(fx("kalshi/series.KXCPI.json"))!.settlementSource!.url, "https://www.bls.gov/cpi/");
  });
  test("finality respects the settlement timer: a 'settled' market inside its window is not read; 'finalized' always is", () => {
    const m: KalshiMarket = { ...nfl[0], status: "settled", settlementTs: "2026-10-10T01:59:00Z", settlementTimerSeconds: 300 };
    assert.equal(isFinal(m, NOW), false);
    assert.equal(isFinal(m, NOW + 300_000), true);
    assert.equal(isFinal({ ...m, status: "finalized" }, NOW), true);
    assert.equal(isFinal({ ...m, result: "" }, NOW + 1e9), false, "no result, never final");
    assert.equal(isFinal({ ...m, status: "cancelled", result: "" }, NOW), true, "a void is final (as a void)");
  });
  test("a bad body is a refusal, not a throw", () => {
    assert.deepEqual(parseMarketsBody({}).refusals, ["schema: no markets[] in the response"]);
    assert.equal(parseMarketsBody({ markets: [{ nope: 1 }] }).refusals.length, 1);
  });
});

describe("kalshi: the four example selectors", () => {
  test("Broncos: every KXNFLGAME market whose ticker contains DEN; YES burns 2%, NO nothing", () => {
    const rule = validateRule(BRONCOS);
    const r = resolveSelector(rule, nfl, { nowMs: NOW, sinceIso: null });
    assert.deepEqual(r.events.map((e) => [e.id, e.result]), [["KXNFLGAME-26SEP27LARDEN-DEN", "yes"], ["KXNFLGAME-26OCT04DENSF-DEN", "no"]]);
    assert.ok(nfl.some((m) => m.ticker.endsWith("-SF") && !selectorMatches(rule, m)), "the opponent's leg of the same game is not -DEN");
    // The literal substring is deterministic and dumb on purpose: a bare "DEN" also matches the opponent's leg (both tickers carry
    // the event's "DENSF"), so one leg settles YES every game. The wizard's back-test lists matched markets so a creator sees this.
    const bare = validateRule({ ...BRONCOS, filter: { tickerIncludes: "DEN" } });
    assert.equal(resolveSelector(bare, nfl, { nowMs: NOW, sinceIso: null }).events.length, 4);
    const steps = unitSteps(rule, r.events);
    assert.deepEqual(steps.map((s) => [s.step.kind, s.step.units]), [["yes", 1], ["no", 0]]);
    assert.match(r.events[0].sourceUrl, /\/markets\/KXNFLGAME-26SEP27LARDEN-DEN$/);
    // since: only settlements after the token's baseline
    assert.equal(resolveSelector(rule, nfl, { nowMs: NOW, sinceIso: "2026-10-01T00:00:00Z" }).events.length, 1);
  });
  test("Denver daily high: one event per day, the value from expiration_value, 1 unit per °F above 80", () => {
    const rule = validateRule(DENVER_HIGH);
    const r = resolveSelector(rule, highden, { nowMs: NOW, sinceIso: null });
    assert.ok(r.events.length >= 3);
    const byId = Object.fromEntries(r.events.map((e) => [e.id, e.value]));
    assert.equal(byId["KXHIGHDEN-26OCT08"], "84");
    assert.equal(byId["KXHIGHDEN-26OCT07"], "81");
    const steps = unitSteps(rule, r.events);
    const u = Object.fromEntries(steps.map((s) => [s.event.id, s.step.units]));
    assert.equal(u["KXHIGHDEN-26OCT08"], 4); assert.equal(u["KXHIGHDEN-26OCT07"], 1);
    assert.match(r.events[0].method!, /^expiration_value/);
    assert.doesNotMatch(r.events[0].title!, /expiration_value/);
  });
  test("one-shot: a single market ticker; resolves once; 10% on YES (this one settled NO → nothing, a receipt all the same)", () => {
    const rule = validateRule(ONE_SHOT);
    const r = resolveSelector(rule, nfl, { nowMs: NOW, sinceIso: null });
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].id, "KXNFLGAME-26OCT04DENSF-DEN");
    assert.equal(r.events[0].result, "no");
    const close = nfl.find((m) => m.ticker === rule.market)!.closeTime!;
    const b = backtest(rule, r.events, NOW, 12, close);
    assert.deepEqual(b.oneShot, { resolvesOn: close });
    assert.match(close, /^2026-10-0[45]T/);
    assert.equal(b.totals.burnEvents, 0);
  });
  test("S&P 4pm close: one event per H1600 ladder, value from expiration_value, 1 unit per 10 points up vs the previous close", () => {
    const rule = validateRule(SPX);
    const r = resolveSelector(rule, inx, { nowMs: NOW, sinceIso: null });
    assert.ok(r.events.length >= 2, `events: ${r.events.map((e) => e.id).join(",")}`);
    for (const e of r.events) { assert.match(e.id, /H1600$/); assert.match(e.value!, /^\d+(\.\d+)?$/); }
    const steps = unitSteps(rule, r.events);
    assert.equal(steps[0].step.units, 0, "the first close is the baseline");
    for (let i = 1; i < steps.length; i++) {
      const prev = Number(steps[i - 1].event.value), cur = Number(steps[i].event.value);
      const expect = cur > prev ? Math.floor((cur - prev) / 10 + 1e-9) : 0;
      assert.equal(steps[i].step.units, expect, `${steps[i].event.id}: ${prev} → ${cur}`);
    }
  });
});

describe("kalshi: ladder derivation and voids", () => {
  const oct8 = highden.filter((m) => m.eventTicker === "KXHIGHDEN-26OCT08");
  test("expiration_value wins when numeric; without it the YES between-band's floor; then the highest greater; then the lowest less; else void/none", () => {
    assert.equal(eventValue(oct8).method, "expiration_value");
    const stripped = oct8.map((m) => ({ ...m, expirationValue: "" }));
    const b = eventValue(stripped); assert.equal(b.method, "ladder-between"); assert.equal(b.value, "83");
    const noBetween = stripped.filter((m) => m.strikeType !== "between").map((m) => (m.strikeType === "greater" ? { ...m, result: "yes" as const } : m));
    const g = eventValue(noBetween); assert.equal(g.method, "ladder-greater"); assert.equal(g.value, "88");
    const lessOnly = stripped.filter((m) => m.strikeType === "less").map((m) => ({ ...m, result: "yes" as const }));
    const l = eventValue(lessOnly); assert.equal(l.method, "ladder-less"); assert.equal(l.value, "81");
    assert.equal(eventValue(stripped.map((m) => ({ ...m, result: "no" as const }))).method, "none");
    assert.equal(eventValue(oct8.map((m) => ({ ...m, status: "cancelled", result: "" as const }))).method, "void");
  });
  test("a voided binary market is a VOID event (no burn); an event with a pending ladder member is held", () => {
    const rule = validateRule(BRONCOS);
    const voided = nfl.map((m) => (m.ticker === "KXNFLGAME-26SEP27LARDEN-DEN" ? { ...m, status: "voided", result: "" as const } : m));
    const r = resolveSelector(rule, voided, { nowMs: NOW, sinceIso: null });
    assert.equal(r.events.find((e) => e.id === "KXNFLGAME-26SEP27LARDEN-DEN")!.result, "void");
    assert.equal(unitSteps(rule, r.events)[0].step.kind, "void");
    const pending = highden.map((m) => (m.ticker === "KXHIGHDEN-26OCT08-T88" ? { ...m, status: "settled", settlementTs: "2026-10-10T01:59:30Z", settlementTimerSeconds: 300 } : m));
    const h = resolveSelector(validateRule(DENVER_HIGH), pending, { nowMs: NOW, sinceIso: null });
    assert.ok(!h.events.some((e) => e.id === "KXHIGHDEN-26OCT08"), "half-final ladder: not read yet");
    assert.equal(h.awaitingFinal, 1);
  });
});

describe("kalshi: back-test and implied chance", () => {
  test("the back-test counts settlements in the window and totals the burn under the rule", () => {
    const rule = validateRule(BRONCOS);
    const b = backtest(rule, resolveSelector(rule, nfl, { nowMs: NOW, sinceIso: null }).events, NOW);
    assert.equal(b.totals.events, 2); assert.equal(b.totals.burnEvents, 1);
    assert.ok(Math.abs(b.totals.poolFractionSpent! - 0.02) < 1e-12);
    assert.deepEqual(b.perMonth.map((m) => m.month), ["2026-09", "2026-10"]);
    assert.match(backtestSentence(b), /settled 2 times between .*\. Under this rule, it would have spent 2\.0% of the fee pool across 1 burn\./);
    const s = validateRule(SPX);
    const bs = backtest(s, resolveSelector(s, inx, { nowMs: NOW, sinceIso: null }).events, NOW, 12);
    assert.equal(bs.rows[0].units, 0);
  });
  test("implied chance (display only): binary = the next market's YES mid; scalar = the ladder bands beyond one unit", () => {
    const r = impliedChanceFrom(validateRule(DENVER_HIGH), highdenOpen, null);
    assert.equal(r.marketTicker, "KXHIGHDEN-26OCT09");
    assert.ok(r.chance! > 0.9, `chance ${r.chance} (the 10-09 ladder is priced almost entirely above 81°F)`);
    assert.match(r.basis, /at least one unit of 1 above 80/);
    const b = impliedChanceFrom(validateRule(BRONCOS), [{ ...nfl[0], ticker: "KXNFLGAME-26OCT12DENNYJ-DEN", seriesTicker: "KXNFLGAME", status: "active", result: "", closeTime: "2026-10-13T03:00:00Z", yesBid: 0.4, yesAsk: 0.44 }], null);
    assert.ok(Math.abs(b.chance! - 0.42) < 1e-12);
    assert.equal(impliedChanceFrom(validateRule(BRONCOS), [], null).chance, null);
  });
});

describe("kalshi: the client", () => {
  const table = {
    [settledMarketsUrl("KXNFLGAME")]: fx("kalshi/KXNFLGAME.settled.json"),
    [seriesApiUrl("KXNFLGAME")]: fx("kalshi/series.KXNFLGAME.json"),
    [openMarketsUrl("KXHIGHDEN")]: fx("kalshi/KXHIGHDEN.open.json"),
    // the keeper's next-read check (2026-10-19): a series' closed, not yet settled markets, then its open ones
    [closedMarketsUrl("KXNFLGAME")]: { cursor: "", markets: [] }, [openMarketsUrl("KXNFLGAME")]: { cursor: "", markets: [] },
    [seriesListUrl("Sports")]: { series: [(fx("kalshi/series.KXNFLGAME.json") as { series: unknown }).series] },
    [seriesListUrl("Climate and Weather")]: { series: [(fx("kalshi/series.KXHIGHDEN.json") as { series: unknown }).series] },
  };
  test("settledSince resolves the selector through the API shape, records the series' settlement source, caches, and spaces requests", async () => {
    let t = NOW;
    const c = new KalshiClient({ fetchImpl: fixtureFetch(table), now: () => t, minIntervalMs: 0 });
    const r = await c.settledSince(validateRule(BRONCOS), null);
    assert.equal(r.events.length, 2);
    assert.ok(r.settlementSourceUrl, "the series' settlement_sources[0].url is recorded");
    const n = c.requests.length;
    await c.settledSince(validateRule(BRONCOS), null);
    assert.equal(c.requests.length, n, "served from cache inside the TTL");
    t += 3_600_001;
    await c.settledSince(validateRule(BRONCOS), null);
    assert.ok(c.requests.length > n, "re-fetched after the TTL");
  });
  test("searchSeries ranks ticker matches above title matches and skips unknown categories; impliedChance reads the open page", async () => {
    const c = new KalshiClient({ fetchImpl: fixtureFetch(table), minIntervalMs: 0 });
    const hits = await c.searchSeries("nfl");
    assert.equal(hits[0].ticker, "KXNFLGAME");
    assert.equal((await c.searchSeries("temperature"))[0].ticker, "KXHIGHDEN");
    const ic = await c.impliedChance(validateRule(DENVER_HIGH), null);
    assert.equal(ic.marketTicker, "KXHIGHDEN-26OCT09");
  });
  test("an HTTP error surfaces as an error, never as a reading", async () => {
    const c = new KalshiClient({ fetchImpl: fixtureFetch({}), minIntervalMs: 0 });
    await assert.rejects(c.settledSince(validateRule(BRONCOS), null), /Kalshi HTTP 404/);
  });
});

describe("the refuse list", () => {
  test("deaths, violence, terror, casualty counts and disasters are refused; elections and sports are admitted; names claiming officialdom are refused", () => {
    const list = loadRefuseList();
    assert.ok(refusalsFor(list, { titles: ["How many people will die in the hurricane?"] }).length > 0);
    assert.ok(refusalsFor(list, { titles: ["Will there be a terrorist attack in Paris this year?"] }).length > 0);
    assert.ok(refusalsFor(list, { titles: ["Death toll of the earthquake above 1,000?"] }).length > 0);
    assert.deepEqual(refusalsFor(list, { titles: ["Portugal Presidential election winner?", "Denver wins", "Will the maximum temperature be >88° on Oct 8, 2026?", "CPI"] }), []);
    assert.equal(nameRefusals(list, "Official Treasury Coin", "OFFTSY").length, 1);
    assert.deepEqual(nameRefusals(list, "Bronco Burn", "BRONCO"), []);
    assert.throws(() => parseRefuseList({ schema: "x" }), /not a burnticker.refuse/);
  });
});

describe("polymarket: the Gamma parser on the 10-09 fixture", () => {
  test("a resolved market reads as Gamma's report (never final for a burn: the keeper reads the chain); a proposed resolution is not settled", () => {
    const g = gamma as Record<string, unknown>[];
    const p = parseGammaMarket(g[0])!;
    assert.equal(gammaResult(p), "yes");
    assert.equal(p.resolutionSource, "https://www.kleague.com/");
    assert.match(settledMarketUrl(p.conditionId), /condition_ids=0x[0-9a-f]{64}&closed=true$/);
    assert.equal(gammaResult(parseGammaMarket({ ...(g[0] as object), umaResolutionStatus: "proposed" })!), null, "a proposed (disputable) resolution is not settled");
  });
});
