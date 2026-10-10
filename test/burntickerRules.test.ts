// BURNTICKER (2026-10-09) — the rule schema (selector + outcome → burn mapping), its canonical bytes and keeper-compatible hash, the
// pure unit engine (exact decimals, carry only where the catalogue says), the v3 receipt memo and its disjointness from the keeper's
// v1/v2, and the fee split constants.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { canonicalJson, descriptionFooter, DISCLAIMER_FOOTER, lockRule, ruleMode, ruleStatement, rulesFromText, validateRule, type BurnRule } from "@/lib/burnticker/rules";
import { previewTotals, unitStep, unitSteps, toScaled, fromScaled, canonicalDecimal, type SettledEvent } from "@/lib/burnticker/units";
import { formatReceiptMemo, parseReceiptMemo, receiptKey, settledForMemo, sourceForMemo } from "@/lib/burnticker/receipt";
import { parseBuybackMemo, parseDebtMemo } from "@/lib/burnKeeper/memo";
import { rulesSha256 } from "@/lib/burnKeeper/rules";
import { BRONCOS, DEBT_RULE, DENVER_HIGH, ONE_SHOT, SPX, VAULT_RULE } from "./burntickerHelpers.ts";
import { BURNTICKER_DEV_FEE_BPS, bpsPerSol, CREATOR_FEE_SLICE_BPS, CURVE_FEES, devFeeWallet, feeSplitSentence } from "@/lib/burnticker/fees";

const ev = (id: string, at: string, result: "yes" | "no" | "void" | null, value: string | null = null): SettledEvent => ({ id, at, result, value, title: null, sourceUrl: "https://api.elections.kalshi.com/trade-api/v2/markets/" + id });

describe("rules: validation", () => {
  test("the four example selectors and the vault variant validate; modes follow the mappings", () => {
    for (const r of [BRONCOS, DENVER_HIGH, ONE_SHOT, SPX]) assert.equal(ruleMode(validateRule(r)), "buyback");
    assert.equal(ruleMode(validateRule(VAULT_RULE)), "vault");
  });
  test("every problem is listed at once; hybrid, out-of-bounds and nonsense selectors are refused", () => {
    assert.throws(() => validateRule({ ...BRONCOS, binary: { onYes: { fractionOfPool: 0.5 }, onNo: { tokens: 5 } }, series: "lower case", floorUsd: "1.234" }), (e: Error) => /fractionOfPool must be a number in \[0\.01, 0\.1\]/.test(e.message) && /same mode/.test(e.message) && /series must be a ticker/.test(e.message) && /floorUsd/.test(e.message));
    assert.throws(() => validateRule({ ...BRONCOS, series: "KXNFLGAME", market: "KXNFLGAME-X-Y" }), /a series OR one market/);
    assert.throws(() => validateRule({ ...BRONCOS, series: null }), /name a series or a market/);
    assert.throws(() => validateRule({ ...BRONCOS, binary: { onYes: { fractionOfPool: 0.02, tokens: 1 }, onNo: null } }), /exactly one of/);
    assert.throws(() => validateRule({ ...VAULT_RULE, vault: { share: 0.5, vestDays: 365, cliffDays: 0 } }), /vault\.share/);
    assert.throws(() => validateRule({ ...BRONCOS, vault: { share: 0.2, vestDays: 365, cliffDays: 0 } }), /buyback mode: vault must be null/);
    assert.throws(() => validateRule({ ...BRONCOS, filter: { titleRegex: "(" } }), /not a valid regular expression/);
    assert.throws(() => validateRule({ ...BRONCOS, onVoid: "burn" }), /onVoid/);
    assert.throws(() => validateRule({ ...BRONCOS, extra: 1 }), /extra is not a known key/);
    assert.throws(() => validateRule({ ...DENVER_HIGH, scalar: { ...DENVER_HIGH.scalar, direction: "sideways" } }), /direction/);
  });
  test("catalogue (tier 2) rules name a known feed and are scalar", () => {
    const r = validateRule({ ...DENVER_HIGH, oracle: "catalogue", series: "treasury.debt", scalar: { unit: 1e9, perUnit: { fractionOfPool: 0.05 }, baseline: "previousSettlement", direction: "up" } });
    assert.equal(r.series, "treasury.debt");
    assert.throws(() => validateRule({ ...r, series: "NOPE" }), /catalogue: series must be a source id/);
    assert.equal(validateRule({ ...r, series: "github.stars:anza-xyz/agave" }).series, "github.stars:anza-xyz/agave", "the schema admits any well-formed source id; the catalogue decides if it is configured");
    assert.throws(() => validateRule({ ...BRONCOS, oracle: "catalogue", series: "treasury.debt" }), /kind must be "scalar"/);
  });
});

describe("rules: canonical bytes and hash", () => {
  test("keys sorted at every level, trailing newline; the hash is sha256 of those bytes (the keeper's rulesSha256)", () => {
    const a = lockRule(BRONCOS), b = lockRule(Object.fromEntries(Object.entries(BRONCOS).reverse()));
    assert.equal(a.text, b.text, "key order in the input does not matter");
    assert.ok(a.text.endsWith("}\n"));
    assert.ok(a.text.indexOf('"binary"') < a.text.indexOf('"filter"') && a.text.indexOf('"filter"') < a.text.indexOf('"kind"'));
    assert.equal(a.sha256, crypto.createHash("sha256").update(a.text).digest("hex"));
    assert.equal(a.sha256, rulesSha256(a.text));
    assert.equal(a.sha12, a.sha256.slice(0, 12));
    assert.equal(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] }), '{\n  "a": [\n    {\n      "c": 2,\n      "d": 1\n    }\n  ],\n  "b": 1\n}\n');
  });
  test("rulesFromText accepts only canonical bytes (an edited rules.json would not hash to the published value)", () => {
    const a = lockRule(SPX);
    assert.equal(rulesFromText(a.text).sha256, a.sha256);
    assert.throws(() => rulesFromText(a.text.replace("\n  \"filter\"", "\n   \"filter\"")), /not in canonical form/);
    assert.throws(() => rulesFromText("{"), /not valid JSON/);
  });
  test("statements and the footer say what the rule does and nothing about price", () => {
    const s1 = ruleStatement(validateRule(BRONCOS), { seriesTitle: "NFL game winner" });
    assert.match(s1, /every market in the Kalshi series KXNFLGAME \("NFL game winner"\) whose ticker contains "-DEN" settles YES, the keeper spends 2% of the fee pool/);
    assert.match(s1, /A NO settlement burns nothing/);
    const s2 = ruleStatement(validateRule(SPX));
    assert.match(s2, /every full 10 above the previous settlement is one unit/);
    const s3 = ruleStatement(validateRule(VAULT_RULE));
    assert.match(s3, /burns 1,000,000 tokens from the vault/);
    assert.match(s3, /When it settles NO, it burns 250,000 tokens/);
    const f = descriptionFooter(lockRule(BRONCOS));
    assert.match(f, /Kalshi series KXNFLGAME \(ticker ∋ -DEN\) · rule sha256:[0-9a-f]{12}/);
    assert.ok(f.endsWith(DISCLAIMER_FOOTER));
    for (const bad of [/\breturns?\b/i, /\bprofit/i, /\binvest/i, /moon/i, /price will/i]) { assert.doesNotMatch(s1 + s2 + s3, bad); assert.doesNotMatch(f, bad); }
  });
});

describe("units: the engine", () => {
  test("binary: YES → onYes, NO → onNo or nothing, void → nothing", () => {
    const r = validateRule(BRONCOS);
    assert.deepEqual(unitStep(r, ev("A", "2026-10-04T23:41:27Z", "yes"), null).mapping, { fractionOfPool: 0.02 });
    assert.equal(unitStep(r, ev("B", "2026-10-04T23:41:27Z", "no"), null).units, 0);
    assert.equal(unitStep(r, ev("C", "2026-10-04T23:41:27Z", "void"), null).kind, "void");
    const v = validateRule(VAULT_RULE);
    assert.deepEqual(unitStep(v, ev("B", "2026-10-04T23:41:27Z", "no"), null).mapping, { tokens: 250000 });
  });
  test("scalar, fixed baseline, direction up: floor((value − baseline) / unit), exact decimals, no carry", () => {
    const r = validateRule(DENVER_HIGH);
    assert.equal(unitStep(r, ev("E1", "2026-10-09T13:08:18Z", null, "84"), null).units, 4);
    assert.equal(unitStep(r, ev("E2", "2026-10-08T13:12:58Z", null, "80.9"), null).units, 0);
    assert.equal(unitStep(r, ev("E3", "2026-10-08T13:12:58Z", null, "79"), null).kind, "down");
    const s = unitStep(r, ev("E4", "2026-10-08T13:12:58Z", null, "81.999999"), null);
    assert.equal(s.units, 1); assert.equal(s.carryOut, "0");
  });
  test("scalar vs previous settlement: the first event is the baseline; S&P +10 points per unit; a down day burns nothing", () => {
    const r = validateRule(SPX);
    const steps = unitSteps(r, [ev("D1", "2026-10-06T23:01:00Z", null, "7700.10"), ev("D2", "2026-10-07T23:01:00Z", null, "7731.09"), ev("D3", "2026-10-08T23:01:00Z", null, "7765.36"), ev("D4", "2026-10-09T23:01:00Z", null, "7700")]);
    assert.deepEqual(steps.map((x) => x.step.units), [0, 3, 3, 0]);
    assert.equal(steps[0].step.note, "baseline: the first settlement is recorded; nothing is burned for it");
    assert.equal(steps[1].step.baseline, "7700.10");
    assert.equal(steps[3].step.kind, "down");
    const t = previewTotals(steps);
    assert.equal(t.units, 6); assert.equal(t.burnEvents, 2);
    assert.ok(Math.abs(t.poolFractionSpent! - (1 - 0.99 ** 6)) < 1e-12);
  });
  test("abs direction counts both ways; 'down' rules count falls; carry only when asked (the Treasury feed)", () => {
    const abs = validateRule({ ...SPX, scalar: { ...SPX.scalar, direction: "abs", baseline: 100, unit: 0.01 } });
    assert.equal(unitStep(abs, ev("x", "2026-01-01", null, "99.95"), null).units, 5);
    assert.equal(unitStep(abs, ev("x", "2026-01-01", null, "100.05"), null).units, 5);
    const down = validateRule({ ...SPX, scalar: { ...SPX.scalar, direction: "down", baseline: 100, unit: 1 } });
    assert.equal(unitStep(down, ev("x", "2026-01-01", null, "97.5"), null).units, 2);
    assert.equal(unitStep(down, ev("x", "2026-01-01", null, "101"), null).kind, "up");
    const debt = validateRule(DEBT_RULE);
    const a = unitStep(debt, ev("2026-10-07", "2026-10-07", null, "40284036147367.19"), { value: "40273024579219.17", carryOut: "0" }, "consecutive-increases");
    assert.equal(a.units, 11); assert.equal(a.carryOut, "11568148.02");
    const b = unitStep(debt, ev("2026-10-08", "2026-10-08", null, "40305316210829.72"), { value: "40284036147367.19", carryOut: a.carryOut }, "consecutive-increases");
    assert.equal(b.units, 21, "+$21.28B with $0.0116B carried = 21 units, as the $DEFICIT keeper computes");
    assert.equal(b.carryOut, "291631610.55");
    const c = unitStep(debt, ev("2026-10-09", "2026-10-09", null, "40300000000000.00"), { value: "40305316210829.72", carryOut: b.carryOut }, "consecutive-increases");
    assert.equal(c.kind, "down"); assert.equal(c.carryOut, "0", "a down day resets the carry");
    assert.throws(() => unitStep(debt, ev("x", "2026-10-09", null, "1"), { value: "0", carryOut: "2000000000" }, "consecutive-increases"), /outside \[0, unit\)/);
  });
  test("decimal helpers", () => {
    assert.equal(toScaled("7765.36", 4), BigInt(77653600));
    assert.equal(fromScaled(BigInt(-5), 2), "-0.05");
    assert.equal(canonicalDecimal("84.00"), "84");
    assert.equal(canonicalDecimal("0.40"), "0.4");
    assert.throws(() => toScaled("1e3", 2), /not a decimal/);
  });
});

describe("receipt memo v3", () => {
  const m = { ticker: "BRONCO", id: "KXNFLGAME-26SEP27LARDEN-DEN", oracle: "kalshi" as const, market: "KXNFLGAME-26SEP27LARDEN-DEN", result: "yes" as const, settled: "2026-09-28T03:22:11Z", src: sourceForMemo("https://www.nfl.com/scores/"), value: "-", units: 1, pool: "4980000000", spent: "99600000", got: "1234567.5", burn: "1234567.5", swap: "swap1ZZZZZZZ", rulesSha12: "0123456789ab", version: "v3" as const };
  test("formats, parses back identically, and the keeper's v1/v2 parsers do not claim it", () => {
    const s = formatReceiptMemo(m);
    assert.equal(s, "BT|BRONCO|KXNFLGAME-26SEP27LARDEN-DEN|oracle=kalshi|market=KXNFLGAME-26SEP27LARDEN-DEN|result=yes|settled=2026-09-28T03:22:11Z|src=www.nfl.com/scores|value=-|units=1|pool=4980000000|spent=99600000|got=1234567.5|burn=1234567.5|swap=swap1ZZZZZZZ|rules=sha256:0123456789ab|v3");
    assert.deepEqual(parseReceiptMemo(s), m);
    assert.equal(parseBuybackMemo(s), null); assert.equal(parseDebtMemo(s), null);
    assert.equal(parseReceiptMemo(s.replace("|v3", "|v2")), null);
    assert.equal(parseReceiptMemo(s.replace("units=1", "units=01")), null, "one spelling per number");
    assert.ok(s.startsWith(receiptKey("BRONCO", "KXNFLGAME-26SEP27LARDEN-DEN")));
  });
  test("refuses bad fields, spent > pool, and the 566-byte ceiling", () => {
    assert.throws(() => formatReceiptMemo({ ...m, spent: "9999999999" }), /spent > pool/);
    assert.throws(() => formatReceiptMemo({ ...m, src: "a|b" }), /src/);
    assert.throws(() => formatReceiptMemo({ ...m, result: "maybe" as "yes" }), /result/);
    assert.throws(() => formatReceiptMemo({ ...m, id: "x".repeat(97) }), /id/);
    assert.throws(() => formatReceiptMemo({ ...m, oracle: "Kalshi!" }), /oracle/);
  });
  test("settled time to the second; periods pass through; sources lose scheme and query and are capped", () => {
    assert.equal(settledForMemo("2026-10-04T23:41:27.463206Z"), "2026-10-04T23:41:27Z");
    assert.equal(settledForMemo("2026-08"), "2026-08");
    assert.equal(sourceForMemo("https://www.bls.gov/cpi/?x=1#frag"), "www.bls.gov/cpi");
    assert.ok(Buffer.byteLength(sourceForMemo(`https://x.com/${"a".repeat(300)}`)) <= 96);
  });
});

describe("fees", () => {
  test("the developer slice is 25 bps; creators keep nothing; the split sums and reads per 1 SOL", () => {
    assert.equal(BURNTICKER_DEV_FEE_BPS, 25);
    assert.equal(CREATOR_FEE_SLICE_BPS, 0);
    assert.equal(CURVE_FEES.legs.find((l) => l.label === "Burnticker (developer)")!.bps, 25);
    assert.equal(CURVE_FEES.legs.reduce((a, l) => a + l.bps, 0), CURVE_FEES.totalBps);
    assert.equal(bpsPerSol(25), "0.0025");
    assert.match(feeSplitSentence(), /0\.0025 SOL to Burnticker \(developer\)/);
    assert.match(feeSplitSentence(), /creator receives no cash from fees/);
    assert.equal(devFeeWallet({}), null);
    assert.equal(devFeeWallet({ BURNTICKER_FEE_WALLET: "So11111111111111111111111111111111111111112" }), "So11111111111111111111111111111111111111112");
    assert.equal(devFeeWallet({ BURNTICKER_FEE_WALLET: "not-a-key" }), null);
  });
});

void (null as unknown as BurnRule);
