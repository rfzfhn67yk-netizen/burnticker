// SEMANTICS-VERIFY (website-20 Part 2 VERIFY items, 2026-10-12): each test pins what the code really does at one edge the site describes,
// keyed by item number. Fixes made on this pass: item 74 (one coin under two aliases is refused), items 79 and 80 (a postponed game's
// make-up listing is kept; a doubleheader's games are matched by start time and a day is read only once every game on it is final).
// Open product decisions (66, 70, 78 shoot-outs, 84 revisions) are pinned as current behaviour; WIRING-SEMANTICS.md states the options.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { CurveCalculator } from "@raydium-io/raydium-sdk-v2";
import { capSentence, effectiveCap } from "@/lib/burnticker/capInForce";
import { simulateCrank } from "@/lib/burnticker/burnMath";
import { assertSolUsd, belowFloor, solToLamports } from "@/lib/burnKeeper/rules";
import { decimalSolToLamports, lamportsText, launchLabCostLamports } from "@/lib/burnticker/launchCost";
import { lockRule, rulesFromText } from "@/lib/burnticker/rules";
import { interpretPayouts } from "@/lib/burnKeeper/attesters/polymarketOnchain";
import { polyRule } from "@/lib/burnticker/search";
import { composeRule, DRAFT_DEFAULTS, launchBody } from "@/lib/burnticker/launchDraft";
const ROOT = path.join(import.meta.dirname, "..");
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { RULE_EDGE_CASES, edgeCase, finalDelaySentence } from "@/lib/burnticker/ruleEdgeCases";
import { feedCard, sourceFilterMatch, sourceRoleLabel, unitExample } from "@/lib/burnticker/browse";
import { describeRule, fadeName, PENALTIES_SENTENCE } from "@/lib/burnticker/describe";
import { FIELD_HELP } from "@/lib/burnticker/fieldHelp";
import { feedById } from "@/lib/burnticker/catalogue";
import { parseBody } from "@/lib/burnticker/sources/attestedHttp";
import { derbySpecProblems, flipAlreadyAheadSentence, sameUnderlying, seasonWindows, nextUtcMidnight, type CoinVsSpec, type DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { decideFlip, decideWindow, pctChange, type SideReading } from "@/lib/burnticker/derby/measure";
import { tileRule, tileSpec } from "@/lib/burnticker/derby/tile";
import { derbyAdmission } from "@/lib/burnticker/derby/admission";
import { preflightSelector } from "@/lib/burnticker/coverage/preflight";
import { derbyExplainer } from "@/lib/burnticker/launchDerby";
import { fetchDue, recordWindowEnd, runCycle } from "@/lib/burnticker/multiKeeper";
import { FLIP_FINAL_RETRY_DAYS } from "@/lib/burnticker/derby/adapter";
import { openRegistry } from "@/lib/burnticker/registry";
import { TEMPLATES } from "@/lib/burnticker/templates";
import { gameEligibility } from "@/lib/burnticker/oneShotEligibility";
import { gatedStatus, unitStep, unitSteps, voidByEndMs } from "@/lib/burnticker/units";
import { chainResult } from "@/lib/burnticker/oracle/polymarket";
import { validateDebtResponse } from "@/lib/burnKeeper/feeds/treasury";
import { usdToCents } from "@/lib/burnKeeper/rules";
import { planWeather, parseWeatherIntent } from "@/lib/burnticker/weatherIntent";
import { parseCli, qualifies, parseNwsSeries } from "@/lib/burnticker/sources/nws";
import { dedupeListings, GAME_CANCELLED_REASON, outcomeOf, teamSeries, windowStatus, type EspnClient, type EspnSeries, type Game, type GameSide } from "@/lib/burnticker/sources/espn";
import { finalFromMlb, finalFromTsdb, settleGame, sportsSettled } from "@/lib/burnticker/sources/gameSettle";
import { pairTickers } from "@/lib/burnticker/guidedLaunch";
import { firstPartyRule } from "@/lib/burnticker/wizard";
const firstPartyRuleFor = (series: string) => firstPartyRule(series);
import type { BurnRule } from "@/lib/burnticker/rules";
import { coinvsRule, fixtureFetch, fixturePort, B, BONK, DAY as DAY_MS, BONK_FEED, BONK_MINT, GIGA_POOL, SHIB, WIF, WIF_FEED, WIF_MINT, derbyWorld, seedCross } from "./burntickerDerbyHelpers.ts";

const lint = (t: string) => lintCopy(t, loadCopyLintConfig()).hits.map((h) => `${h.phrase}:${h.rule}`);
const side = (symbol: string, changePct: string): SideReading => ({ symbol, key: symbol, source: "pyth", start: "1", end: "1", supplyStart: null, supplyEnd: null, changePct, proof: {} });
const cross = (changePct: string) => ({ source: "x", start: "1", end: "1", changePct, refs: {} });

describe("the edge-case sentences (ruleEdgeCases.ts)", () => {
  test("one lint-clean sentence for every VERIFY item of Part 2", () => {
    const items = [62, 64, 66, 69, 70, 72, 74, 76, 78, 79, 80, 82, 84, 85, 86, 87, 96];
    assert.deepEqual(RULE_EDGE_CASES.filter((e) => e.item <= 100).map((e) => e.item), items);
    for (const e of RULE_EDGE_CASES) assert.deepEqual(lint(e.sentence), [], `${e.item}: ${e.sentence}`);
  });
});

describe("Coin vs Coin windows and settlement", () => {
  test("62: weekly windows are a real, validated shape (Monday to Monday), but only the API reaches them", () => {
    const now = Date.UTC(2026, 9, 14, 15);   // a Wednesday
    const s = tileSpec({ a: WIF, b: SHIB, window: "weekly", seasonDays: 30, flip: false, fraction: 0.02, now });
    assert.equal(s.season.start, "2026-10-19"); assert.equal(new Date(`${s.season.start}T00:00:00Z`).getUTCDay(), 1);
    assert.equal(s.season.days, 28);
    assert.deepEqual(derbySpecProblems(s), []);
    assert.deepEqual(seasonWindows(s).map((w) => w.id), ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]);
    assert.match(edgeCase(62)!, /available through the API only/);
  });

  test("66 (decision open): a flippening whose first coin is already larger settles on the first day it is read", () => {
    const d = decideFlip("250", "200", { a: "250", b: "200" }, false);
    assert.equal(d.status, "decided"); assert.equal((d as { result: string }).result, "yes");
    // equal sizes are not a flippening: pending, and NO on the season's last day
    assert.equal(decideFlip("200", "200", { a: "200", b: "200" }, false).status, "pending");
    assert.equal((decideFlip("200", "200", { a: "200", b: "200" }, true) as { result: string }).result, "no");
  });

  test("66 (owner decision): a flippening whose first coin is already larger is refused at creation; the smaller-first case passes", async () => {
    const mint = (supplyRaw: bigint, decimals: number) => { const m = Buffer.alloc(82); m.writeBigUInt64LE(supplyRaw, 36); m[44] = decimals; return { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: m }; };
    const spec: CoinVsSpec = { selector: "coinvs", a: WIF, b: BONK, window: "daily", measure: "mcap", season: { start: "2026-10-11", days: 30 }, flip: true };
    const run = (wifSupply: bigint) => preflightSelector(coinvsRule(spec), { now: Date.UTC(2026, 9, 10, 22, 20), derby: { pools: fixturePort({ [WIF_MINT]: mint(wifSupply, 6), [BONK_MINT]: mint(BigInt("8800000000000000000"), 5) }), fetchImpl: fixtureFetch(), hermes: null } });
    const ahead = await run(BigInt("999000000000000000"));
    assert.equal(ahead.ok, false); assert.equal(ahead.refusal?.code, "already-decided", JSON.stringify(ahead.refusal));
    assert.equal(ahead.refusal?.reason, flipAlreadyAheadSentence("WIF", "BONK"));
    assert.deepEqual(lint(ahead.refusal!.reason), []);
    const behind = await run(BigInt("1000000"));
    assert.equal(behind.ok, true, JSON.stringify(behind.refusal));
    // the daily comparison is unaffected: the same coins, no flip, both sizes irrelevant
    const daily = await preflightSelector(coinvsRule({ ...spec, measure: "pct", flip: false }), { now: Date.UTC(2026, 9, 10, 22, 20), derby: { pools: fixturePort(), fetchImpl: fixtureFetch(), hermes: null } });
    assert.equal(daily.ok, true, JSON.stringify(daily.refusal));
    assert.match(derbyExplainer(spec, { a: "WIFVBONK", b: "BONKVWIF" }).window, /already the larger coin when you launch, the launch is refused/);
  });

  test("69: a tie is equality to six decimals of a percentage point; one millionth of a point picks a winner, inside the cross-read bound", () => {
    assert.equal(pctChange("3", "3.0000001"), "0.000003");
    assert.equal(pctChange("1", "1.000000009"), "0");   // truncated toward zero
    const tie = decideWindow(side("WIF", "1.000000"), side("SHIB", "1.000000"), { a: cross("1.5"), b: cross("1") });
    assert.equal((tie as { result: string }).result, "void");
    const win = decideWindow(side("WIF", "1.000001"), side("SHIB", "1.000000"), { a: cross("1"), b: cross("2.5") });
    assert.equal(win.status, "decided"); assert.equal((win as { result: string }).result, "yes");
  });

  const flipWorld = async () => {
    const spec: CoinVsSpec = { selector: "coinvs", a: WIF, b: BONK, window: "daily", measure: "mcap", season: { start: "2026-10-05", days: 2 }, flip: true };
    const w = await derbyWorld(spec, { tickers: ["TEAMWIF", "TEAMBONK"], hermes: null });
    const snap = (feed: string, b: number, value: string) => w.adapter.store.putSample({ key: `pyth:${feed}`, kind: "pyth", ts: b + 60_000, slot: 1, value, detail: { source: "pyth-solana", publishTime: b / 1000 + 5 } });
    const sup = (mint: string, b: number, v: string) => w.adapter.store.putSample({ key: `supply:${mint}`, kind: "supply", ts: b + 60_000, slot: 1, value: v, detail: {} });
    for (const b of [B(6), B(7)]) { snap(WIF_FEED, b, "0.2"); snap(BONK_FEED, b, "0.0000025"); seedCross(w, WIF, b, "0.2"); seedCross(w, BONK, b, "0.0000025"); }
    sup(WIF_MINT, B(6), "999000000"); sup(BONK_MINT, B(6), "88000000000000");   // no supply read at the last boundary (yet)
    return { w, sup };
  };
  const eventReceipts = (w: Awaited<ReturnType<typeof derbyWorld>>, mint: string) => w.registry.receipts(mint).filter((r) => !["winddown", "drain", "sweep"].includes(r.kind));

  test("70 (owner decision): a withheld last window is retried for 7 days, then the flippening ends VOID (never NO), both coins wind down", async () => {
    const { w } = await flipWorld();
    w.clock.now = B(7) + 2 * DAY_MS;   // inside the retry span: nothing recorded for the last window, nothing ends
    await runCycle(w.deps);
    assert.deepEqual(w.adapter.store.windows(w.a.selectorKey).map((r) => r.windowId), ["2026-10-05"]);
    assert.equal(w.registry.ruleEnd(w.a.mint), null);
    w.clock.now = B(7) + (FLIP_FINAL_RETRY_DAYS + 1) * DAY_MS;
    await runCycle(w.deps); await runCycle(w.deps);
    const rows = w.adapter.store.windows(w.a.selectorKey);
    assert.deepEqual(rows.map((r) => [r.windowId, r.status]), [["2026-10-05", "withheld"], ["2026-10-06", "withheld"]]);
    assert.match(rows[1].reason!, /circulating-supply/);
    assert.equal(eventReceipts(w, w.a.mint).length + eventReceipts(w, w.b.mint).length, 0, "neither coin burns for the flippening");
    for (const m of [w.a.mint, w.b.mint]) { const e = w.registry.ruleEnd(m)!; assert.equal(e.mode, "winddown"); assert.match(e.reason, /ends void/); }
    assert.match(edgeCase(70)!, /7 days/);
  });

  test("70: a last window that becomes readable during the retries is decided normally (here NO: the first coin stayed smaller)", async () => {
    const { w, sup } = await flipWorld();
    w.clock.now = B(7) + 2 * DAY_MS;
    await runCycle(w.deps);
    sup(WIF_MINT, B(7), "999000000"); sup(BONK_MINT, B(7), "88000000000000");
    w.clock.now = B(7) + 3 * DAY_MS;
    await runCycle(w.deps); await runCycle(w.deps);
    const rows = w.adapter.store.windows(w.a.selectorKey);
    assert.deepEqual(rows.map((r) => [r.windowId, r.status, r.result]), [["2026-10-05", "withheld", null], ["2026-10-06", "decided", "no"]]);
  });

  test("72: a draft prepared before 00:00 UTC is refused after it; prepared again it starts a day later", async () => {
    const before = Date.UTC(2026, 9, 14, 23, 50), after = Date.UTC(2026, 9, 15, 0, 10);
    const spec = tileSpec({ a: WIF, b: BONK, window: "daily", seasonDays: 30, flip: false, fraction: 0.02, now: before });
    assert.equal(spec.season.start, "2026-10-15");
    const r = tileRule({ a: WIF, b: BONK, window: "daily", seasonDays: 30, flip: false, fraction: 0.02, now: before }, "0".repeat(64), { a: "WIFVBONK", b: "BONKVWIF" });
    const refusals = await derbyAdmission(r.rule!, { registry: openRegistry(":memory:"), fetchImpl: (async () => { throw new Error("no network"); }) as never, now: after });
    assert.ok(refusals.some((x) => x.kind === "season" && /earliest is 2026-10-16/.test(x.reason)), JSON.stringify(refusals));
    assert.equal(nextUtcMidnight(after), "2026-10-16");
  });

  test("74 (fixed): one coin read through two aliases is refused, on the rule and at admission", () => {
    const wifPyth: DerbyUnderlying = { symbol: "WIF", pyth: WIF_FEED, mint: null, pool: null, cross: `jup:${WIF_MINT}` };
    const wifPool: DerbyUnderlying = { symbol: "DOGWIF", pyth: null, mint: WIF_MINT, pool: GIGA_POOL, cross: `dexscreener:solana:${WIF_MINT}` };
    assert.ok(sameUnderlying(wifPyth, wifPool));
    const shibA: DerbyUnderlying = { symbol: "SHIB", pyth: SHIB.pyth, mint: null, pool: null, cross: "dexscreener:ethereum:0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE" };
    const shibB: DerbyUnderlying = { symbol: "SHIBRS", pyth: null, mint: null, pool: null, redstone: "SHIB", cross: "dexscreener:ethereum:0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce" };
    assert.ok(sameUnderlying(shibA, shibB));
    const base: CoinVsSpec = { selector: "coinvs", a: wifPyth, b: wifPool, window: "daily", measure: "pct", season: { start: "2026-10-20", days: 30 }, flip: false };
    assert.ok(derbySpecProblems(base).includes("derby: the two coins must be distinct"));
    assert.ok(derbySpecProblems({ ...base, a: shibA, b: shibB }).includes("derby: the two coins must be distinct"));
    // different coins stay admitted
    assert.ok(!sameUnderlying(WIF, BONK)); assert.ok(!sameUnderlying(WIF, SHIB));
    assert.deepEqual(derbySpecProblems({ ...base, a: WIF, b: BONK }), []);
  });

  test("96: side A's coin burns when the first picked coin wins; swapping the picks swaps the series and the generated names", () => {
    const now = Date.UTC(2026, 9, 14, 15);
    const ab = tileRule({ a: WIF, b: BONK, window: "daily", seasonDays: 30, flip: false, fraction: 0.02, now }, "a".repeat(64), { a: "WIFVBONK", b: "BONKVWIF" });
    const ba = tileRule({ a: BONK, b: WIF, window: "daily", seasonDays: 30, flip: false, fraction: 0.02, now }, "b".repeat(64), { a: "BONKVWIF", b: "WIFVBONK" });
    assert.match(ab.rule!.series!, /^coinvs:WIF-BONK:/); assert.match(ba.rule!.series!, /^coinvs:BONK-WIF:/);
    assert.ok(ab.rule!.binary!.onYes && !ab.rule!.binary!.onNo, "side A burns on YES = coin A wins");
    assert.match(ab.sentence, /^\$WIFVBONK burns 2% every day WIF out-gains BONK/);
    assert.deepEqual(pairTickers("WIF", "BONK"), { a: "WIFVBONK", b: "BONKVWIF" });
    assert.deepEqual(pairTickers("BONK", "WIF"), { a: "BONKVWIF", b: "WIFVBONK" });
  });
});

describe("pairs, markets and dated templates", () => {
  test("64: date-bound templates open a search (never a ready rule); a finished game is refused as already decided", () => {
    for (const id of ["team-oneshot", "matchup", "election-oneshot", "election-pair", "polymarket-oneshot", "flippening"]) assert.equal(TEMPLATES.find((t) => t.id === id)!.lands, "choices", id);
    const g = gameEligibility({ eventId: "401", name: "Padres at Dodgers", startsAt: "2026-10-01T02:10:00Z", completed: true });
    assert.equal(g.decided, true); assert.match(g.reason!, /already has its result/);
  });

  test("76: a result before both pools register waits; it is cancelled only after the void date's end", () => {
    const step = { units: 1, mapping: { fractionOfPool: 0.02 }, kind: "yes" as const };
    assert.equal(gatedStatus(step, { state: "waiting", waitingOn: ["B"], voidBy: "2026-11-30" }), "pending-pair");
    assert.equal(gatedStatus(step, { state: "live" } as never), null);
    assert.equal(gatedStatus(step, { state: "voided", atMs: 0 } as never), "voided");
    assert.equal(gatedStatus({ ...step, kind: "void" }, { state: "waiting", waitingOn: ["B"], voidBy: "2026-11-30" }), null);
    assert.equal(new Date(voidByEndMs("2026-11-30")).toISOString(), "2026-12-01T00:00:00.000Z");
  });

  test("82: each candidate's coin burns only on its own YES; NO (lost or withdrew) burns nothing; a 50-50 settlement is void", () => {
    const rule = { kind: "binary", binary: { onYes: { fractionOfPool: 1 }, onNo: null } } as unknown as BurnRule;
    const ev = (result: "yes" | "no" | "void") => ({ id: "c", at: "2026-11-04", result, value: null, title: "t", sourceUrl: "u" });
    assert.equal(unitStep(rule, ev("yes"), null).units, 1);
    assert.equal(unitStep(rule, ev("no"), null).units, 0);
    assert.equal(unitStep(rule, ev("void"), null).kind, "void");
    const res = (outcome: number | null) => chainResult({ resolved: true, outcomeSlotCount: 2, outcome } as never);
    assert.equal(res(0), "yes"); assert.equal(res(1), "no"); assert.equal(res(null), "void");
  });
});

describe("published numbers: revisions, baselines, missing values, weather", () => {
  test("84 (decision open): a revised period is never counted twice: the registry holds the key, the $DEFICIT feed holds or ignores", () => {
    const reg = openRegistry(":memory:");
    const e = { id: "2026-10-01", at: "2026-10-01", result: null, value: "3", title: "t", sourceUrl: "u" };
    assert.equal(reg.putReadings("catalogue", "catalogue:fedreg.eo", [e], { settlementSourceUrl: null, attestedBy: [] }), 1);
    assert.equal(reg.putReadings("catalogue", "catalogue:fedreg.eo", [e], { settlementSourceUrl: null, attestedBy: [] }), 0);
    assert.throws(() => reg.putReadings("catalogue", "catalogue:fedreg.eo", [{ ...e, value: "4" }], { settlementSourceUrl: null, attestedBy: [] }), /holding/);
    const prev = { recordDate: "2026-10-02", cents: usdToCents("38000000000000") };
    const body = (rows: [string, string][]) => ({ data: rows.map(([d, a]) => ({ record_date: d, tot_pub_debt_out_amt: a })) });
    const rev = validateDebtResponse(body([["2026-10-02", "38000000000001.00"], ["2026-10-05", "38001000000000.00"]]), { prev });
    assert.equal(rev.readings.length, 0); assert.match(rev.refusals[0], /^revision/);
    const ok = validateDebtResponse(body([["2026-10-01", "37000000000000.00"], ["2026-10-02", "38000000000000.00"], ["2026-10-05", "38001000000000.00"]]), { prev });
    assert.deepEqual(ok.readings.map((r) => r.recordDate), ["2026-10-05"]);   // an older revised row is not judged again
  });

  test("85: readings start after the launch; the first one is the starting point and burns nothing", () => {
    const reg = openRegistry(":memory:");
    const mk = (id: string, value: string) => ({ id, at: id, result: null, value, title: "t", sourceUrl: "u" });
    reg.putReadings("catalogue", "k", [mk("2026-10-07", "100"), mk("2026-10-08", "110"), mk("2026-10-09", "130")], { settlementSourceUrl: null, attestedBy: [] });
    assert.deepEqual(reg.readings("k", "2026-10-08T15:00:00Z").map((r) => r.id), ["2026-10-09"]);
    const rule = { kind: "scalar", scalar: { unit: 10, perUnit: { fractionOfPool: 0.01 }, baseline: "previousSettlement", direction: "up" } } as unknown as BurnRule;
    const steps = unitSteps(rule, [mk("2026-10-09", "130"), mk("2026-10-10", "150")]);
    assert.equal(steps[0].step.units, 0); assert.match(steps[0].step.note, /starting point/);
    assert.equal(steps[1].step.units, 2);
    const inv = unitSteps({ ...rule, inverse: true } as BurnRule, [mk("2026-10-09", "130"), mk("2026-10-10", "120")]);
    assert.equal(inv[0].step.units, 0); assert.equal(inv[1].step.units, 1);
  });

  test("86: a decimal threshold becomes whole degrees: below 89.5 °F is 89 °F or colder (the fade side of at least 90 °F)", () => {
    const p = planWeather(parseWeatherIntent("Denver high below 89.5")[0]);
    assert.ok(p.ok); if (!p.ok) return;
    assert.equal(p.series, "nws.high:DEN-90"); assert.equal(p.inverse, true); assert.equal(p.boundary, "89 °F or colder");
    const s = parseNwsSeries(p.series)!;
    const day = (high: number | null) => ({ date: "2026-07-01", high, precip: null, snow: null, snowSeason: null, final: true });
    assert.equal(qualifies(s, day(89)), false);   // the fade side counts this day
    assert.equal(qualifies(s, day(90)), true);
    const above = planWeather(parseWeatherIntent("Denver high above 89.5")[0]);
    assert.ok(above.ok && above.series === "nws.high:DEN-90" && !above.inverse);
  });

  test("87: a missing value (MM) is no reading, never a zero; a missing cross-read withholds a Coin vs Coin window", () => {
    const text = "CLIMATE SUMMARY FOR JULY 1 2026\nTEMPERATURE (F)\n YESTERDAY\n  MAXIMUM         MM\nPRECIPITATION (IN)\n  YESTERDAY        0.00\nSNOWFALL (IN)\n  YESTERDAY        0.0\n  SINCE JUL 1      0.0\n";
    const d = parseCli(text)!;
    assert.equal(d.high, null); assert.equal(d.precip, 0);
    assert.equal(qualifies(parseNwsSeries("nws.high:DEN-90")!, d), null);
    const w = decideWindow(side("WIF", "1"), side("SHIB", "0"), { a: cross("1"), b: null });
    assert.equal(w.status, "withheld");
    assert.equal(unitStep(firstPartyRule("nws.high:DEN-90"), { id: "x", at: "2026-07-01", result: null, value: null, title: "t", sourceUrl: "u" }, null).kind, "void");
  });
});

// ---- team games (items 78, 79, 80) on a fake schedule client ----

const LAD: GameSide = { abbr: "LAD", name: "Los Angeles Dodgers", nickname: "Dodgers", short: "Dodgers", location: "Los Angeles", score: null, homeAway: "home", record: null };
const SD: GameSide = { abbr: "SD", name: "San Diego Padres", nickname: "Padres", short: "Padres", location: "San Diego", score: null, homeAway: "away", record: null };
const game = (eventId: string, startsAt: string, o: { home?: number | null; away?: number | null; completed?: boolean; state?: string; detail?: string } = {}): Game => ({ eventId, league: "mlb", seasonType: 2, seasonYear: 2026, startsAt, date: startsAt.slice(0, 10), name: "Padres at Dodgers", completed: o.completed ?? true, state: o.state ?? "post", detail: o.detail ?? "Final", home: { ...LAD, score: o.home ?? null }, away: { ...SD, score: o.away ?? null } });
const mlbBody = (games: { at: string; home: number | null; away: number | null; state?: string }[]) => ({ dates: [{ games: games.map((g) => ({ gameDate: g.at, status: { abstractGameState: g.state ?? "Final" }, teams: { home: { team: { name: "Los Angeles Dodgers" }, score: g.home ?? undefined }, away: { team: { name: "San Diego Padres" }, score: g.away ?? undefined } } })) }] });
const tsdbBody = (events: { date: string; ts: string; home: number | null; away: number | null; status?: string }[]) => ({ events: events.map((e) => ({ idEvent: e.ts, dateEvent: e.date, strTimestamp: e.ts, strEvent: "Los Angeles Dodgers vs San Diego Padres", strHomeTeam: "Los Angeles Dodgers", strAwayTeam: "San Diego Padres", idLeague: "4424", strStatus: e.status ?? "FT", intHomeScore: e.home === null ? null : String(e.home), intAwayScore: e.away === null ? null : String(e.away) })) });
function fakeClient(games: Game[], mlb: Record<string, unknown>, tsdb: unknown): EspnClient {
  return { season: async () => dedupeListings(games), get: async (url: string) => { if (url in mlb) return mlb[url]; throw new Error(`HTTP 404 for ${url}`); }, tsdbRead: async () => tsdb } as unknown as EspnClient;
}
const deps = { tsdbKey: "k", apiSportsKey: null, market: null, payout: null };
const WINS: EspnSeries = { kind: "team", league: "mlb", abbr: "LAD", teamId: null, outcome: "win", window: { kind: "season", year: 2026 } };
const day = (d: string) => `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${d}`;

describe("team games", () => {
  test("80 (fixed): each reader picks the game nearest the schedule's start, so a doubleheader's second game reads its own score", () => {
    const g2 = game("2", "2026-07-04T23:10:00Z");
    const body = mlbBody([{ at: "2026-07-04T19:05:00Z", home: 2, away: 1 }, { at: "2026-07-04T23:10:00Z", home: 3, away: 5 }]);
    assert.deepEqual([finalFromMlb(g2, body, "u")!.home, finalFromMlb(g2, body, "u")!.away], [3, 5]);
    const t = tsdbBody([{ date: "2026-07-04", ts: "2026-07-04T19:05:00", home: 2, away: 1 }, { date: "2026-07-04", ts: "2026-07-04T23:10:00", home: 3, away: 5 }]);
    assert.deepEqual([finalFromTsdb(g2, t, "u")!.home, finalFromTsdb(g2, t, "u")!.away], [3, 5]);
  });

  test("80 (fixed): a doubleheader day is read once both games are final, and counts both wins", async () => {
    const at1 = "2026-07-04T17:05:00Z", at2 = "2026-07-04T21:10:00Z";
    const games = [game("1", at1, { home: 4, away: 2 }), game("2", at2, { home: 6, away: 3 })];
    const mlb = { [day("2026-07-04")]: mlbBody([{ at: at1, home: 4, away: 2 }, { at: at2, home: 6, away: 3 }]) };
    const tsdb = tsdbBody([{ date: "2026-07-04", ts: at1.slice(0, 19), home: 4, away: 2 }, { date: "2026-07-04", ts: at2.slice(0, 19), home: 6, away: 3 }]);
    // the second game is still being played: the whole day waits (no reading of 1 that a later 2 would contradict). Owner 2026-10-20:
    // a final game is read at once (no six-hour wait), so "not over yet" is the schedule's own state
    const playing = [games[0], game("2", at2, { home: null, away: null, completed: false, state: "in", detail: "Top 7th" })];
    const early = await sportsSettled(fakeClient(playing, mlb, tsdb), WINS, null, deps, { nowMs: Date.parse(at2) + 2 * 3_600_000 });
    assert.deepEqual(early.events, []);
    const late = await sportsSettled(fakeClient(games, mlb, tsdb), WINS, null, deps, { nowMs: Date.parse(at2) + 3 * 3_600_000 });
    assert.deepEqual(late.events.map((e) => [e.id, e.value]), [["2026-07-04", "2"]]);
  });

  test("79 (fixed): a postponed game neither counts nor holds its day; its make-up listing (same id) is kept and counts on its own date", async () => {
    const orig = game("7", "2026-07-05T20:10:00Z", { completed: false, state: "post", detail: "Postponed" });
    const makeup = game("7", "2026-07-06T20:10:00Z", { home: 5, away: 1 });
    const other = game("8", "2026-07-05T02:10:00Z", { home: 1, away: 0 });
    assert.deepEqual(dedupeListings([orig, makeup, other]).map((g) => [g.eventId, g.date]), [["7", "2026-07-06"], ["8", "2026-07-05"]]);
    const mlb = { [day("2026-07-05")]: mlbBody([{ at: other.startsAt, home: 1, away: 0 }]), [day("2026-07-06")]: mlbBody([{ at: makeup.startsAt, home: 5, away: 1 }]) };
    const tsdb = tsdbBody([{ date: "2026-07-05", ts: other.startsAt.slice(0, 19), home: 1, away: 0 }, { date: "2026-07-06", ts: makeup.startsAt.slice(0, 19), home: 5, away: 1 }]);
    const r = await sportsSettled(fakeClient([orig, makeup, other], mlb, tsdb), WINS, null, deps, { nowMs: Date.parse("2026-07-08T00:00:00Z") });
    assert.deepEqual(r.events.map((e) => [e.id, e.value]), [["2026-07-05", "1"], ["2026-07-06", "1"]]);
    // a postponed listing alone (no make-up yet) is skipped, not held
    const only = await sportsSettled(fakeClient([orig], {}, tsdbBody([])), WINS, null, deps, { nowMs: Date.parse("2026-07-08T00:00:00Z") });
    assert.deepEqual(only.events, []); assert.equal(only.awaitingFinal, 0);
  });

  test("78: a level final score is a draw; a win or loss coin burns nothing for it, a draw coin counts it (shoot-outs count by the recorded score)", async () => {
    const at = "2026-07-04T19:05:00Z";
    const g = game("9", at, { home: 2, away: 2 });
    const mlb = { [day("2026-07-04")]: mlbBody([{ at, home: 2, away: 2 }]) };
    const tsdb = tsdbBody([{ date: "2026-07-04", ts: at.slice(0, 19), home: 2, away: 2 }]);
    const v = await settleGame(fakeClient([g], mlb, tsdb), g, deps);
    assert.equal(v.kind, "settled"); assert.equal((v as { winner: string }).winner, "tie");
    for (const [outcome, want] of [["win", "0"], ["loss", "0"], ["draw", "1"]] as const) {
      const r = await sportsSettled(fakeClient([g], mlb, tsdb), { ...WINS, outcome }, null, deps, { nowMs: Date.parse(at) + 8 * 3_600_000 });
      assert.deepEqual(r.events.map((e) => e.value), [want], outcome);
    }
  });
});

// ---- Part 3 (items 101–117, the library and source semantics) ----

describe("Part 3: source cards and published-number semantics", () => {
  test("every Part 3 sentence is lint-clean", () => {
    const p3 = RULE_EDGE_CASES.filter((e) => e.item > 100 && e.item < 150);
    assert.deepEqual(p3.map((e) => e.item), [106, 107, 109, 110, 111, 115, 117]);
    for (const e of p3) assert.deepEqual(lint(e.sentence), [], `${e.item}: ${e.sentence}`);
    assert.deepEqual(lint(finalDelaySentence(7)!), []);
  });

  test("101 (fixed): counted units and one-time outcomes get their own sentence, available or not", () => {
    assert.equal(unitExample({ label: "the launch succeeds" }), "burns once if the launch succeeds");
    assert.equal(unitExample({ label: "the milestone" }), "burns once when the count reaches the milestone");
    assert.equal(unitExample({ label: "1 launch" }), "burns for every launch");
    assert.equal(unitExample({ label: "1 executive order" }), "burns for every executive order");
    assert.equal(unitExample({ label: "1,000 stars" }), "burns for every 1,000 stars");
    assert.equal(unitExample({ label: "$1B added" }), "burns for every $1B added");
    assert.equal(unitExample({ label: "100 ETH burned/day" }), "burns for every 100 ETH burned/day");
    assert.equal(unitExample(null), "burns on each settled reading");
    const card = (launchable: boolean) => feedCard({ id: "ll2.launch", tier: 4, tierLabel: "x", title: "One named launch succeeds", sourceName: "The Space Devs, Launch Library 2", sourceUrl: "u", cadence: "once", unit: { label: "the launch succeeds" }, launchable: { ok: launchable, why: launchable ? null : "no key" }, flags: [], lastReading: null });
    assert.equal(card(true).example, "burns once if the launch succeeds"); assert.equal(card(false).example, "burns once if the launch succeeds");
    for (const e of [card(true).example, unitExample({ label: "1 launch" })]) assert.doesNotMatch(e, /every the|every 1 /);
  });

  test("104 (fixed): a zero-count fade side names the quiet day; a level keeps No Move; only the suggestion changes", () => {
    assert.equal(fadeName("noaa.flares", "Solar flares", true), "Quiet Sun");
    assert.equal(fadeName("congress.lawsSigned", "Laws signed", true), "Days Without Laws signed");
    assert.equal(fadeName("fred.UNRATE", "Unemployment rate", false), "No Move Unemployment rate");
    assert.ok(fadeName("x", "A very long subject name for a source", true).length <= 32);
  });

  test("106: a flare point is M = 1, X = 10, B and C = 0, on the peak's UTC day (the config's own count rules)", () => {
    const f = feedById("noaa.flares")!;
    const body = [["2026-07-01T03:00:00Z", "M1.2"], ["2026-07-01T09:00:00Z", "M5.0"], ["2026-07-01T15:00:00Z", "X1.1"], ["2026-07-01T18:00:00Z", "C9.9"], ["2026-07-02T01:00:00Z", "B2.0"], ["2026-06-30T23:00:00Z", "M1.0"]].map(([t, c]) => ({ max_time: t, max_class: c }));
    const r = parseBody(f.config, body, Date.parse("2026-07-03T12:00:00Z"));
    assert.deepEqual(r.readings.map((x) => [x.id, x.value]), [["2026-07-01", "12"], ["2026-07-02", "0"]]);   // the first, partial day is dropped
    assert.match(edgeCase(106)!, /12 points/);
  });

  test("107 (decision open): the FDA counter is a 60-day snapshot of application records; units are its rises", () => {
    const f = feedById("openfda.approvals")!;
    assert.match(f.config.request.url, /submission_type:ORIG\+AND\+submissions\.submission_status:AP/);
    assert.ok(f.config.select.snapshot, "one total per read: an application counts once, whatever products it lists");
    const rule = { kind: "scalar", scalar: { unit: 1, perUnit: { fractionOfPool: 0.01 }, baseline: "previousSettlement", direction: "up" } } as unknown as BurnRule;
    const mk = (id: string, value: string) => ({ id, at: id, result: null, value, title: "t", sourceUrl: "u" });
    const s = unitSteps(rule, [mk("2026-10-01", "40"), mk("2026-10-02", "42"), mk("2026-10-03", "42"), mk("2026-10-04", "41")]);
    assert.deepEqual(s.map((x) => x.step.units), [0, 2, 0, 0]);   // two new, then one in and one out (balanced), then one out
  });

  test("109 and 111: parts of a unit are dropped unless the rule carries; up, down and either direction on two readings", () => {
    const mk = (id: string, value: string) => ({ id, at: id, result: null, value, title: "t", sourceUrl: "u" });
    const rule = (direction: string, unit = 10) => ({ kind: "scalar", scalar: { unit, perUnit: { fractionOfPool: 0.01 }, baseline: "previousSettlement", direction } }) as unknown as BurnRule;
    const three = [mk("d1", "100"), mk("d2", "107"), mk("d3", "114")];
    assert.deepEqual(unitSteps(rule("up"), three).map((x) => x.step.units), [0, 0, 0]);
    const carried = unitSteps(rule("up"), three, "consecutive-increases");
    assert.deepEqual(carried.map((x) => [x.step.units, x.step.carryOut]), [[0, "0"], [0, "7"], [1, "4"]]);
    const two = (a: string, b: string, d: string) => unitSteps(rule(d, 1), [mk("d1", a), mk("d2", b)])[1].step.units;
    assert.deepEqual([two("100", "103", "up"), two("100", "97", "up")], [3, 0]);
    assert.deepEqual([two("100", "103", "down"), two("100", "97", "down")], [0, 3]);
    assert.deepEqual([two("100", "103", "abs"), two("100", "97", "abs")], [3, 3]);
  });

  test("110: a counter that resets burns nothing for the drop and counts again from the new value; the locked rule is untouched", () => {
    const mk = (id: string, value: string) => ({ id, at: id, result: null, value, title: "t", sourceUrl: "u" });
    const rule = { kind: "scalar", scalar: { unit: 100, perUnit: { fractionOfPool: 0.01 }, baseline: "previousSettlement", direction: "up" } } as unknown as BurnRule;
    const before = JSON.stringify(rule);
    const s = unitSteps(rule, [mk("2026-12-30", "9800"), mk("2026-12-31", "9900"), mk("2027-01-01", "0"), mk("2027-01-02", "300")]);
    assert.deepEqual(s.map((x) => x.step.units), [0, 1, 0, 3]);
    assert.equal(JSON.stringify(rule), before);
  });

  test("112: a source that waits before a day counts says so in its setup text", () => {
    assert.equal(feedById("jpl.neo")!.config.period.completeAfterDays, 7);
    assert.match(finalDelaySentence(7)!, /7 days old.*no sooner than 7 days after launch/);
    assert.equal(finalDelaySentence(1), null);
  });

  test("108 (fixed): a compiler is never called the original publisher", () => {
    assert.match(sourceRoleLabel("ll2.launches"), /The Space Devs, which compiles launch providers' announcements/);
    assert.match(sourceRoleLabel("ll2.provider:121"), /The Space Devs/);
    assert.match(sourceRoleLabel("fred.UNRATE"), /FRED, which republishes/);
    assert.equal(sourceRoleLabel("noaa.flares"), "read by the operator's automation from the original publisher");
    const card = feedCard({ id: "ll2.launches", tier: 4, tierLabel: "keeper-read primary API", title: "Orbital launches", sourceName: "The Space Devs, Launch Library 2", sourceUrl: "u", cadence: "c", unit: { label: "1 launch" }, launchable: { ok: true, why: null }, flags: [], lastReading: null });
    assert.doesNotMatch(card.tierLabel, /primary API/);
  });

  test("115 (fixed): the source filter ignores case, spaces, apostrophes, hyphens and accents, and never substitutes", () => {
    const hay = "Solar flares NOAA Space Weather Prediction Center feed:noaa.flares";
    for (const q of ["solar-flares", "SOLAR FLARES", "solarflares", "  Solar   flares ", "sólar flares", "noaa's"]) assert.ok(sourceFilterMatch(q, hay), q);
    assert.ok(sourceFilterMatch("o'neil", "Shaquille ONeil")); assert.ok(sourceFilterMatch("St. Louis", "st louis high"));
    assert.equal(sourceFilterMatch("lunar flares", hay), false);
    assert.equal(sourceFilterMatch("", hay), true);
  });

  test("117: a provider's changed schema reads nothing and says why; the source keeps its identity", () => {
    const f = feedById("fedreg.eo")!;
    const now = Date.parse("2026-10-12T12:00:00Z");
    const moved = parseBody(f.config, { documents: [{ signing_date: "2026-09-01" }] }, now);
    assert.deepEqual(moved.readings, []); assert.match(moved.refusals.join(" "), /schema: no rows at results\[\*\]/);
    const renamed = parseBody(f.config, { results: [{ signed_on: "2026-09-01" }] }, now);
    assert.deepEqual(renamed.readings, []); assert.match(renamed.refusals.join(" "), /without a readable period/);
    const fda = feedById("openfda.approvals")!;
    const snap = parseBody(fda.config, { meta: { results: {} } }, now);
    assert.deepEqual(snap.readings, []); assert.match(snap.refusals[0], /^schema: snapshot/);
    assert.equal(f.id, "fedreg.eo");
  });
});

// ---- the owner's decisions of 2026-10-12 (items 62, 66, 70, 78, 79, 84, 107; 66 and 70 are tested above) ----

describe("owner decisions 2026-10-12", () => {
  test("62: weekly comparisons are available through the API only, in the help text and the docs", () => {
    assert.match(edgeCase(62)!, /Weekly comparisons are available through the API only/);
    assert.match(FIELD_HELP["derby-window"].what, /Weekly comparisons are available through the API only/);
  });

  const SOC_HOME: GameSide = { abbr: "ARS", name: "Arsenal", nickname: "Arsenal", short: "Arsenal", location: "London", score: null, homeAway: "home", record: null };
  const SOC_AWAY: GameSide = { abbr: "CHE", name: "Chelsea", nickname: "Chelsea", short: "Chelsea", location: "London", score: null, homeAway: "away", record: null };
  const at = "2026-08-20T19:00:00Z";
  const cup: Game = { eventId: "77", league: "eng.1", seasonType: 2, seasonYear: 2026, startsAt: at, date: "2026-08-20", name: "Chelsea at Arsenal", completed: true, state: "post", detail: "AP", home: { ...SOC_HOME, score: 1 }, away: { ...SOC_AWAY, score: 1 } };
  const tsdbCup = { events: [{ idEvent: "77", dateEvent: "2026-08-20", strTimestamp: "2026-08-20T19:00:00", strEvent: "Arsenal vs Chelsea", strHomeTeam: "Arsenal", strAwayTeam: "Chelsea", idLeague: "4328", strStatus: "AP", intHomeScore: "1", intAwayScore: "1" }] };
  const apiCup = (winner: "home" | "away" | null) => ({ response: [{ fixture: { date: at, status: { short: "PEN" } }, teams: { home: { name: "Arsenal", winner: winner === null ? null : winner === "home" }, away: { name: "Chelsea", winner: winner === null ? null : winner === "away" } }, goals: { home: 1, away: 1 } }] });
  const socClient = (api: unknown) => ({ season: async () => [cup], get: async (url: string) => { if (/api-sports/.test(url)) return api; throw new Error(`HTTP 404 for ${url}`); }, tsdbRead: async () => tsdbCup }) as unknown as EspnClient;
  // the clock inside API-Sports' read window (36 hours from the start, gameSettle.ts apiSportsWindow)
  const socDeps = { tsdbKey: "k", apiSportsKey: "a", market: null, payout: null, now: () => Date.parse(at) + 10 * 3_600_000 };

  test("78: a cup tie decided on penalties is a win for the declared winner and a loss for the other side, in settlement and in espn.ts", async () => {
    const v = await settleGame(socClient(apiCup("home")), cup, socDeps);
    assert.equal(v.kind, "settled", JSON.stringify(v)); assert.equal((v as { winner: string }).winner, "home");
    const series = (abbr: string, outcome: "win" | "loss" | "draw"): EspnSeries => ({ kind: "team", league: "eng.1", abbr, teamId: null, outcome, window: { kind: "season", year: 2026 } });
    const count = async (abbr: string, outcome: "win" | "loss" | "draw") => (await sportsSettled(socClient(apiCup("home")), series(abbr, outcome), null, socDeps, { nowMs: Date.parse(at) + 10 * 3_600_000 })).events.map((e) => e.value);
    assert.deepEqual(await count("ARS", "win"), ["1"]); assert.deepEqual(await count("CHE", "loss"), ["1"]); assert.deepEqual(await count("ARS", "draw"), ["0"]);
    // espn.ts reads the same game the same way from the schedule's winner flag
    assert.equal(outcomeOf({ ...cup, home: { ...cup.home, winner: true }, away: { ...cup.away, winner: false } }, "ARS"), "win");
    assert.equal(outcomeOf({ ...cup, home: { ...cup.home, winner: true }, away: { ...cup.away, winner: false } }, "CHE"), "loss");
    // decided on penalties with no source naming the winner: held, never a draw; sources naming different winners: held
    assert.equal((await settleGame(socClient(apiCup(null)), cup, socDeps)).kind, "held");
    assert.equal((await settleGame(socClient(apiCup("away")), { ...cup, home: { ...cup.home, winner: true } }, socDeps)).kind, "held");
    assert.match(describeRule(firstPartyRuleFor(teamSeries("eng.1", "ARS", "win", { kind: "season", year: 2026 })), { ticker: "ARS26" }).paragraph, new RegExp(PENALTIES_SENTENCE.replace(/[.]/g, "\\.")));
    assert.match(edgeCase(78)!, /cup tie decided on penalties counts as a win for the winner/);
  });

  test("79: a one-game coin whose game is cancelled (no make-up listing) ends void; a postponed one stays open", () => {
    const G = (detail: string, completed = false): Game => ({ ...cup, eventId: "55", league: "mlb", detail, completed, state: "post", home: { ...LAD }, away: { ...SD } });
    const one: EspnSeries = { kind: "game", league: "mlb", eventId: "55", abbr: "LAD", outcome: "win" };
    const c = windowStatus(one, [G("Cancelled")], Date.parse("2026-09-01T00:00:00Z"));
    assert.equal(c.ended, true); assert.equal(c.reason, GAME_CANCELLED_REASON);
    assert.equal(windowStatus(one, [G("Postponed")], Date.parse("2026-09-01T00:00:00Z")).ended, false);
    // a cancelled listing with a make-up listing under the same id: the make-up is kept, so the coin is not voided
    assert.equal(windowStatus(one, dedupeListings([G("Cancelled"), G("Final", true)]), Date.parse("2026-09-01T00:00:00Z")).reason, "the game is final");
    // the keeper records the end as a wind-down whose reason says void
    const ended: { mode: string; reason: string }[] = [];
    const reg = { ruleEnd: () => null, lockedRule: () => ({ rule: { onEnd: { windDownDays: 28, sweepThresholdLamports: 1 }, oracle: "catalogue", series: "espn.game:mlb-55-LAD-win" } }), markRuleEnded: (_m: string, mode: string, reason: string) => { ended.push({ mode, reason }); return null; } };
    recordWindowEnd({ registry: reg as never, dryRun: false, log: () => {} }, [{ mint: "M", ticker: "LADWIN", status: "live" } as never], { window: c });
    assert.deepEqual(ended.map((e) => e.mode), ["winddown"]); assert.match(ended[0].reason, /void: the game was cancelled/);
    assert.match(edgeCase(79)!, /cancelled, and not rescheduled, ends void/);
  });

  test("84: a revised value holds the source, and the alert names the key, the period and both values", async () => {
    const spec: CoinVsSpec = { selector: "coinvs", a: WIF, b: BONK, window: "daily", measure: "pct", season: { start: "2026-10-05", days: 30 }, flip: false };
    const w = await derbyWorld(spec, { tickers: ["TEAMWIF", "TEAMBONK"], hermes: null });
    let value = "yes";
    const stub = { id: "stub", searchSeries: async () => [], seriesInfo: async () => null, impliedChance: async () => ({ chance: null, marketTicker: null, closeTime: null, basis: "" }), settledSince: async () => ({ events: [{ id: "2026-10-05", at: "2026-10-05T23:59:59Z", result: value as "yes", value: null, title: "t", sourceUrl: "u" }], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }) };
    const deps = { ...w.deps, oracles: { ...w.deps.oracles, derby: stub } } as never;
    await fetchDue(deps, [w.a]);
    value = "no"; w.clock.now += 3_600_000;
    const r = await fetchDue(deps, [w.a]);
    assert.match(r[0].error!, /holding/);
    const a = w.registry.alertsSince(0).find((x) => x.kind === "revised-reading")!;
    assert.ok(a, "an alert was recorded");
    assert.ok(a.text.includes(w.a.selectorKey) && a.text.includes("2026-10-05") && a.text.includes("from yes to no"), a.text);
    assert.match(edgeCase(84)!, /alerted with both values/);
  });

  test("107: the FDA count is original applications only: supplements excluded, one application once, an incomplete page refused", () => {
    const f = feedById("openfda.approvals")!;
    const now = Date.parse("2026-10-10T12:00:00Z");
    const app = (n: string, subs: [string, string, string][], products = 1) => ({ application_number: n, submissions: subs.map(([t, st, d]) => ({ submission_type: t, submission_status: st, submission_status_date: d })), products: Array.from({ length: products }, (_, i) => ({ product_number: String(i) })) });
    const results = [
      app("NDA1", [["ORIG", "AP", "20260903"]], 3),                        // a new original with three products: counts once
      app("NDA2", [["ORIG", "AP", "20190101"], ["SUPPL", "AP", "20260920"]]), // an old original with a recent supplement: not counted
      app("NDA3", [["ORIG", "TA", "20260915"]]),                             // tentative approval: not counted
      app("NDA4", [["ORIG", "AP", "20260701"]]),                             // approved more than 60 days ago: not counted
    ];
    const r = parseBody(f.config, { meta: { results: { total: results.length } }, results }, now);
    assert.deepEqual(r.readings.map((x) => x.value), ["1"]);
    const partial = parseBody(f.config, { meta: { results: { total: 1500 } }, results }, now);
    assert.deepEqual(partial.readings, []); assert.match(partial.refusals[0], /cannot be complete/);
    assert.match(f.config.unit.definition, /ORIGINAL submission \(ORIG\).*supplements are excluded/);
    assert.match(edgeCase(107)!, /Supplements to older applications are not counted/);
  });
});

// ---- Part 4 (items 162–183, settlement and program semantics) ----

describe("Part 4: settlement and program semantics", () => {
  test("every Part 4 sentence is lint-clean, and so are the cap sentences", () => {
    const p4 = RULE_EDGE_CASES.filter((e) => e.item >= 150 && e.item < 200);
    assert.deepEqual(p4.map((e) => e.item), [162, 164, 165, 166, 167, 168, 174, 178, 179, 180, 183]);
    for (const e of p4) assert.deepEqual(lint(e.sentence), [], `${e.item}: ${e.sentence}`);
    for (const s of [capSentence(null), capSentence(effectiveCap(null, 1_790_000_000)), capSentence(effectiveCap(null, 1_900_000_000))]) assert.deepEqual(lint(s), [], s);
  });

  test("162 (fixed copy): the cap in force mirrors the program: the platform's settings, else the 25 SOL default, none after the sunset", () => {
    const now = Date.UTC(2026, 9, 12) / 1000;
    const none = effectiveCap(null, now);
    assert.deepEqual([none.source, none.capLamports, none.sunsetTs], ["program-default", "25000000000", 1_822_348_800]);
    assert.equal(effectiveCap(null, 1_822_348_800).capLamports, null);
    const vault = new PublicKey(Buffer.alloc(32, 9));
    const cfg = { burn_pool_cap_lamports: BigInt("1000000000000"), cap_sunset_ts: BigInt(now + 86_400), pending_cap_lamports: BigInt(0), pending_cap_eta: BigInt(0), authority: vault };
    const raised = effectiveCap(cfg, now);
    assert.deepEqual([raised.source, raised.capLamports, raised.pending, raised.authorityRenounced], ["platform-config", "1000000000000", null, false]);
    assert.match(capSentence(raised), /at most 1,000 SOL today \(read from the platform's settings on chain\)/);
    assert.equal(effectiveCap(cfg, now + 86_400).capLamports, null);
    assert.match(capSentence(effectiveCap({ ...cfg, pending_cap_lamports: BigInt("2000000000000"), pending_cap_eta: BigInt(now + 3600) }, now)), /A raise to 2,000 SOL is waiting/);
    // the copy no longer says an audit releases anything
    for (const s of [capSentence(null), edgeCase(162)!]) { assert.doesNotMatch(s, /after the audit|until the program is audited/); assert.match(s, /48-hour wait/); }
    // the program's rule, read from its source: config cap while before its sunset; default 25 SOL before the hard-coded sunset
    const state = fs.readFileSync(path.join(ROOT, "programs/burn-receipts/programs/burn_receipts/src/state.rs"), "utf8");
    assert.match(state, /if now < self\.cap_sunset_ts \{\s*Some\(self\.burn_pool_cap_lamports\)/);
    assert.match(state, /if now < DEFAULT_CAP_SUNSET_TS \{\s*Some\(DEFAULT_BURN_POOL_CAP_LAMPORTS\)/);
  });

  test("164: consecutive results below the floor buy nothing and owe nothing; a reserve-capped spend under the floor carries all of it", () => {
    const base = { prev: BigInt(0), now: BigInt(1), carryIn: BigInt(0), unit: BigInt(1), carry: "none" as const, fractionBps: 100, capLamports: null, floorLamports: BigInt(10_000_000), reserveSolLamports: BigInt(1_000_000_000_000) };
    let pool = BigInt(500_000_000), carried = BigInt(0);   // 0.5 SOL pool, 1% per result = 0.005 SOL < the 0.01 SOL floor
    for (let i = 0; i < 3; i++) {
      const s = simulateCrank({ ...base, poolLamports: pool, carriedInLamports: carried });
      assert.equal(s.belowFloor, true); assert.equal(s.spend, BigInt(0)); assert.equal(s.carriedOut, BigInt(0), "not queued as a debt");
      carried = s.carriedOut;
    }
    assert.equal(pool, BigInt(500_000_000), "the SOL stays in the pool");
    // a bigger pool later spends 1% of everything that stayed
    pool = BigInt(2_000_000_000);
    assert.equal(simulateCrank({ ...base, poolLamports: pool, carriedInLamports: carried }).spend, BigInt(20_000_000));
    // the 2% reserve cap pushes a spend under the floor: the whole target is carried (owed)
    const r = simulateCrank({ ...base, poolLamports: BigInt(2_000_000_000), carriedInLamports: BigInt(0), reserveSolLamports: BigInt(400_000_000) });
    assert.equal(r.spend, BigInt(0)); assert.equal(r.carriedOut, BigInt(20_000_000));
    // the program: below-floor targets keep only carried spend; a reserve-capped spend under the floor carries the whole target
    const crank = fs.readFileSync(path.join(ROOT, "programs/burn-receipts/programs/burn_receipts/src/instructions/crank_buyback.rs"), "utf8");
    assert.match(crank, /if target == 0 \|\| target < rule\.floor_lamports \{[\s\S]{0,200}carried_in\.min\(pool_actual\)\)/);
    assert.match(crank, /if spend == 0 \|\| spend < rule\.floor_lamports \|\| min_out == 0 \{\s*\(0u64, 0u64, OUTCOME_BELOW_FLOOR, String::from\("none"\), target\)/);
  });

  test("165 (fixed): a missing, zero, non-finite or absurd SOL rate never sets or disables the floor", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.5, 1e6]) assert.throws(() => assertSolUsd(bad), /cannot be converted/, String(bad));
    assert.equal(assertSolUsd(150), 150);
    assert.throws(() => belowFloor(BigInt(1), Number.NaN, "1"), /cannot be converted/);   // NaN used to make every spend "not below the floor"
    assert.equal(belowFloor(BigInt(5_000_000), 150, "1"), true);   // 0.005 SOL ≈ $0.75 < $1
    assert.equal(belowFloor(BigInt(10_000_000), 150, "1"), false);
  });

  test("166: the Raydium pool takes the trading fee from the input and the creator fee from the SOL side, on buys and sells alike", () => {
    // Raydium's own CPMM calculator (swapBaseInput): creator fee on the input when the input is the SOL side, else on the SOL output
    const r = (amountIn: number, creatorOnInput: boolean) => CurveCalculator.swapBaseInput(new BN(amountIn), new BN(1_000_000_000_000), new BN(1_000_000_000_000), new BN(2500), new BN(500), new BN(120000), new BN(40000), creatorOnInput);
    const buy = r(1_000_000_000, true), sell = r(1_000_000_000, false);
    assert.equal(buy.tradeFee.toString(), "2500000"); assert.equal(buy.creatorFee.toString(), "500000");   // both from the SOL paid in
    assert.equal(sell.tradeFee.toString(), "2500000");                                                    // from the coins sold
    assert.ok(sell.creatorFee.gt(new BN(0)) && sell.creatorFee.lt(new BN(500000)));                       // from the SOL out, after the swap
    assert.match(edgeCase(166)!, /illustrations/);
  });

  test("167 (fixed): amounts are exact lamports; display rounds half up from the prepared amount", () => {
    assert.equal(lamportsText(1_234_550_000, 4), "1.2346");   // the float path showed 1.2345
    assert.equal(lamportsText(1_234_549_999, 4), "1.2345");
    assert.equal(lamportsText(50_000, 6), "0.00005"); assert.equal(lamportsText(0, 4), "0"); assert.equal(lamportsText(BigInt("25000000000"), 4), "25");
    for (const s of ["0.02", "0.123456789", "1.000000001", "7"]) assert.equal(BigInt(decimalSolToLamports(s)), solToLamports(s), s);
    assert.equal(launchLabCostLamports("0.123456789") - launchLabCostLamports("0"), 123_456_789);
  });

  test("168: a resolved end forwards to the named coin only while it is live, else to $DEFICIT; a $DEFICIT that is not live moves nothing", () => {
    const end = fs.readFileSync(path.join(ROOT, "programs/burn-receipts/programs/burn_receipts/src/instructions/end.rs"), "utf8");
    // round-5 review R5-12: own_pool_verified() is pool_verified, or a target coin's marker (its pool_verified stays false: the rollback fence)
    assert.match(end, /fn live\(c: &TokenConfig\) -> bool \{\s*c\.own_pool_verified\(\) && c\.end_state == END_STATE_LIVE && c\.rule\.mode == MODE_BUYBACK/);
    assert.match(end, /let ok = if sc\.owner != &crate::ID \|\| sc\.data_is_empty\(\) \{\s*false/);   // never created
    assert.match(end, /if ok \{\s*intended\s*\} else \{\s*BURNTICKER_FLAGSHIP\s*\}/);
    assert.match(end, /require!\(live\(&a\.target_config\), BurnError::FlagshipNotLive\)/);
    assert.match(edgeCase(168)!, /goes to \$DEFICIT instead/);
  });

  test("174: the fingerprint ignores key order and switched-off settings; decimal strings are hashed as written", () => {
    const r = firstPartyRule("treasury.debt", 0.02);
    const shuffled = Object.fromEntries(Object.entries(r).reverse());
    assert.equal(lockRule(shuffled).sha256, lockRule(r).sha256);
    assert.throws(() => lockRule({ ...r, inverse: false }), /inverse must be true or absent/);   // one form only: off is absent
    assert.equal(lockRule({ ...r, set: null }).sha256, lockRule(r).sha256);
    const text = lockRule(r).text;
    assert.equal(rulesFromText(text).sha256, lockRule(r).sha256);   // preview, preparation and verification read the same bytes
    assert.equal(lockRule({ ...r, scalar: { ...r.scalar!, perUnit: { fractionOfPool: 0.020 } } }).sha256, lockRule(r).sha256);
    assert.notEqual(lockRule({ ...r, floorUsd: "1.00" }).sha256, lockRule(r).sha256);
  });

  test("178 and 179: a split payout is void, not YES or NO; an unresolved market is no result, never a NO", () => {
    assert.equal(interpretPayouts([BigInt(3), BigInt(1)], BigInt(4)).outcome, null);
    assert.equal(chainResult({ resolved: true, outcomeSlotCount: 2, outcome: null } as never), "void");
    const unresolved = interpretPayouts([BigInt(0), BigInt(0)], BigInt(0));
    assert.deepEqual([unresolved.resolved, unresolved.outcome], [false, null]);
    assert.equal(chainResult({ resolved: false, outcomeSlotCount: 2, outcome: null } as never), null);
    const noRule = { kind: "binary", binary: { onYes: null, onNo: { fractionOfPool: 1 } } } as unknown as BurnRule;
    assert.equal(unitStep(noRule, { id: "c", at: "x", result: "void", value: null, title: "t", sourceUrl: "u" }, null).units, 0);
  });

  test("180: market identity is the condition id; YES is slot 0 on chain whatever order a list shows", () => {
    assert.equal(chainResult({ resolved: true, outcomeSlotCount: 2, outcome: 0 } as never), "yes");
    assert.equal(interpretPayouts([BigInt(1), BigInt(0)], BigInt(1)).outcome, 0);
    assert.equal(interpretPayouts([BigInt(0), BigInt(1)], BigInt(1)).outcome, 1);
    assert.equal(polyRule("0x" + "ab".repeat(32)).market, "0x" + "ab".repeat(32));
  });

  test("183: only the chosen type's settings reach the rule; a single-coin body never carries a second coin", () => {
    const pick = { oracle: "kalshi" as const, series: "KXHIGHDEN", market: null, title: "Denver high" };
    const scalarLeft = { ...DRAFT_DEFAULTS, kind: "scalar" as const, unit: 5, perUnit: 0.03, direction: "down" as const, onNoEnabled: false };
    const back = composeRule(pick, { ...scalarLeft, kind: "binary" })!;
    assert.equal(back.kind, "binary"); assert.equal(back.scalar, null); assert.deepEqual(back.binary, { onYes: { fractionOfPool: 0.02 }, onNo: null });
    const sc = composeRule(pick, { ...DRAFT_DEFAULTS, onNoEnabled: true, onNo: 0.05, kind: "scalar" })!;
    assert.equal(sc.binary, null);
    const body = launchBody({ creator: "C", ticker: "abc", name: "n", description: "d", descCtx: null, note: "", rule: back });
    assert.equal("pair" in body, false);
  });
});
