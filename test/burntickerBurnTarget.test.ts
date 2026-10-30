// ROUND 5 — A COIN THAT BURNS ANOTHER TOKEN, the site's half (src/lib/burnticker/burnTarget.ts + the rule field in rules.ts): the hashed
// `burnTarget` field (shape, buyback only, side B of a rivalry never inherits side A's), every user-facing sentence passes the copy lint
// (no "buy", "price", "will", dates or "coming soon"), the review sentence the owner asked for, the receipt line and the held-pool alert.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { admissionLine, burnTargetShapeProblems, SUGGESTED_TARGETS, targetActionSentence, targetChoiceLabel, targetHeldLine, targetReceiptLine, targetReviewSentence, targetTrustCopy } from "@/lib/burnticker/burnTarget";
import { invertMapping, validateRule } from "@/lib/burnticker/rules";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { budgetCopy } from "@/lib/burnticker/guidedLaunch";
import type { BurnRule } from "@/lib/burnticker/rules";
import { BURNTICKER_RULES_SCHEMA } from "@/lib/burnticker/rules";

const BONK = { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", pool: "HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv", symbol: "BONK", feedId: "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419" };
const SIDE = { schema: BURNTICKER_RULES_SCHEMA, oracle: "kalshi", series: "KXNFLGAME", market: null, filter: { tickerIncludes: "DEN" }, kind: "binary", binary: { onYes: { fractionOfPool: 0.05 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, pair: { pairId: "teambonk-v-teamwif", side: "A", counterpartMint: null } };

describe("the rule field", () => {
  test("a buyback rule carries { mint, pool, symbol } into the hashed rule; absent stays absent", () => {
    const r = validateRule({ ...SIDE, burnTarget: BONK });
    assert.deepEqual(r.burnTarget, BONK);
    assert.equal("burnTarget" in validateRule(SIDE), false);
  });
  test("bad shapes and vault mode are refused", () => {
    assert.throws(() => validateRule({ ...SIDE, burnTarget: { ...BONK, mint: "nope" } }), /burnTarget\.mint must be a base58 address/);
    assert.throws(() => validateRule({ ...SIDE, burnTarget: { ...BONK, symbol: "bonk!" } }), /burnTarget\.symbol/);
    assert.throws(() => validateRule({ ...SIDE, burnTarget: { ...BONK, extra: 1 } }), /burnTarget\.extra is not a known key/);
    assert.throws(() => validateRule({ ...SIDE, burnTarget: { ...BONK, feedId: "WIF" } }), /burnTarget\.feedId must be the Pyth feed id/);
    assert.throws(() => validateRule({ ...SIDE, burnTarget: { ...BONK, mint: "So11111111111111111111111111111111111111112" } }), /cannot be SOL itself/);
    assert.throws(() => validateRule({ ...SIDE, binary: { onYes: { tokens: 1000 }, onNo: null }, vault: { share: 0.25, vestDays: 365, cliffDays: 0 }, burnTarget: BONK }), /vault-mode coin has no burn pool/);
    assert.deepEqual(burnTargetShapeProblems(BONK), []);
  });
  test("side B of a rivalry picks its own target: it never inherits side A's", () => {
    const a = validateRule({ ...SIDE, burnTarget: BONK });
    const b = invertMapping(a, "So11111111111111111111111111111111111111112");
    assert.equal(b.burnTarget, undefined);
    assert.deepEqual(b.binary, { onYes: null, onNo: { fractionOfPool: 0.05 } });
  });
  test("the suggestions are WIF and BONK by mint and Pyth feed; no pool is hard-coded", () => {
    assert.deepEqual(SUGGESTED_TARGETS.map((t) => t.symbol), ["WIF", "BONK"]);
    for (const t of SUGGESTED_TARGETS) assert.match(t.feedId, /^[0-9a-f]{64}$/);
    for (const t of SUGGESTED_TARGETS) assert.equal(Object.keys(t).includes("pool"), false);
  });
});

describe("the words", () => {
  const cfg = loadCopyLintConfig();
  const clean = (s: string) => assert.deepEqual(lintCopy(s, cfg).hits.map((h) => h.rule), [], s);
  test("the review sentence the owner asked for, word for word", () => {
    assert.equal(targetReviewSentence({ ticker: "TEAMBONK", symbol: "BONK", daysOf: "BONK's" }), "$TEAMBONK burns real BONK on BONK's days, from its own burn pool; BONK's pool on Raydium is not ours and is not locked.");
    assert.equal(targetReviewSentence({ ticker: "WIFFIRE", symbol: "WIF" }), "$WIFFIRE burns real WIF, from its own burn pool; WIF's pool on Raydium is not ours and is not locked.");
  });
  test("every sentence passes the copy lint and never says buy, price, will, a date or coming soon", () => {
    const trust = targetTrustCopy("BONK");
    const all = [
      targetChoiceLabel("BONK"), targetActionSentence("BONK"), targetReviewSentence({ ticker: "TEAMBONK", symbol: "BONK", daysOf: "BONK's" }),
      ...trust.can, ...trust.cannot, targetReceiptLine("1234", "BONK"),
      admissionLine({ ok: true, problems: [], symbol: "BONK" }), admissionLine({ ok: false, problems: ["The pool's fee is above 1%."], symbol: "BONK" }),
      targetHeldLine("BONK", "TargetPoolBelowFloor")!, targetHeldLine("BONK", "TargetPoolUnhealthy")!, targetHeldLine("BONK", "TargetFeeTier")!,
    ];
    for (const s of all) {
      clean(s);
      assert.doesNotMatch(s, /\bbuy|\bprice|\bwill\b|coming soon|\btarget|\b20\d\d-\d\d-\d\d\b/i, s);
    }
    assert.equal(targetActionSentence("BONK"), "Each burn swaps SOL from this coin's burn pool for BONK and burns it.");
    assert.equal(targetChoiceLabel("WIF"), "Burn the real WIF");
    assert.ok(trust.cannot.some((s) => /not ours|belongs to its own liquidity providers/.test(s)), "the trust copy says the pool is not ours");
  });
  test("the receipt line groups thousands and says real (the word target is banned by the lint)", () => {
    assert.equal(targetReceiptLine("1234", "BONK"), "burned 1,234 real BONK");
    assert.equal(targetReceiptLine("1234567.25", "WIF"), "burned 1,234,567.25 real WIF");
    assert.equal(targetHeldLine("BONK", "TwapDeviation"), null);
  });
});

describe("the budget row follows the pinned token (WIRING-ROUND5 item 6)", () => {
  const cfg = loadCopyLintConfig();
  const clean = (t: string) => { assert.deepEqual(lintCopy(t, cfg).hits.map((h) => h.rule), [], t); assert.doesNotMatch(t, /\bbuy|\bbought|\bprice\b|\bwill\b|\btarget/i, t); };
  const self = validateRule(SIDE), real = validateRule({ ...SIDE, burnTarget: BONK });
  const scalar = { ...real, kind: "scalar", binary: null, scalar: { baseline: null, unitSize: 1, fractionPerUnit: 0.02, direction: "up" } } as unknown as BurnRule;
  const once = validateRule({ ...SIDE, series: null, filter: {}, market: "KXNFLGAME-26OCT11DENNYJ-DEN", burnTarget: BONK });
  test("a coin that burns itself keeps its words; a pinned token is named, with no buy, bought, price or target in them", () => {
    assert.match(budgetCopy(self, 0.05, null).line, /buying and burning this coin\. The token amount bought varies\.$/);
    const r = budgetCopy(real, 0.05, null);
    assert.equal(r.line, "Each result that fires the rule spends 5% of the burn pool swapping SOL for BONK and burning it. The amount of BONK each swap gets varies.");
    const sc = budgetCopy(scalar, 0.02, "1 touchdown");
    assert.match(sc.line, /swapping SOL for BONK and burning it\.$/);
    // owner decision 2026-10-25: no per-run bound, so the math line says the share is spent in one go with no cap
    assert.match(sc.math ?? "", /One burn run spends the rule's full share in one go\. There is no platform cap on a burn\./);
    assert.doesNotMatch(sc.math ?? "", /at most 2%/);
    const o = budgetCopy(once, 1, null);
    assert.match(o.line, /swapping SOL for BONK and burning it\. The burn spends that share in one run, swapping in BONK's pinned Raydium pool\.$/);
    for (const x of [r, sc, o]) { clean(x.line); if (x.math) clean(x.math); clean(x.label); }
  });
});
