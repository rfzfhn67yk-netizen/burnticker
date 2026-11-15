// PRELAUNCH AUDIT 2026-10-18 A-5: the "Verify it yourself" block printed `units = floor((0 − 0) / 1) = 1` for $SEAWIN and a curl of a
// Polymarket HTML page piped to a Kalshi-shaped jq filter; the SEA–DEN pair said "settled 0 → neither side burned" although Denver won
// and its burn waits for both coins to graduate; the burn log printed the raw status "pending-pair". Every printed equation now equals
// its own right-hand side, a pair's losing side is told in words, the command matches the source, and the new sentences pass the copy lint.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { evaluateUnitsEquation, pairWords, unitsFormula, verifyCommand, type FormulaReceipt } from "@/lib/burnticker/receiptFormula";
import { pairLastSentence, receiptStatusWords, RECEIPT_STATUS_WORDS } from "@/lib/burnticker/receiptWords";
import type { BurnRule } from "@/lib/burnticker/rules";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const scalar = (direction: "up" | "down" | "abs", unit: number, baseline: "previousSettlement" | number = "previousSettlement", inverse = false): BurnRule =>
  ({ kind: "scalar", scalar: { unit, perUnit: { fractionOfPool: 0.02 }, baseline, direction }, binary: null, ...(inverse ? { inverse: true } : {}) }) as unknown as BurnRule;
const rec = (value: string | null, prevValue: string | null, o: Partial<FormulaReceipt> = {}): FormulaReceipt => ({ value, prevValue, carryIn: "0", units: 0, result: null, ...o });

/** Every "units = floor(...) = N" in a text evaluates to N. */
function assertTrueEquations(text: string): void {
  for (const m of text.matchAll(/units = floor\([^=]*\) = \d+/g)) {
    const n = Number(/= (\d+)$/.exec(m[0])![1]);
    assert.equal(evaluateUnitsEquation(m[0]), n, `false equation: ${m[0]}`);
  }
}

describe("unitsFormula prints only true equations", () => {
  const cases: [BurnRule, FormulaReceipt, ("consecutive-increases" | "none")?][] = [
    [scalar("up", 1), rec("23.92", "0")], [scalar("up", 1), rec("1", "0")], [scalar("up", 1), rec("0", "0")], [scalar("up", 1), rec("0", "1")],
    [scalar("down", 0.25), rec("4.0", "5.1")], [scalar("down", 0.25), rec("5.1", "4.0")], [scalar("abs", 2), rec("-3", "4")], [scalar("abs", 2), rec("7", "4")],
    [scalar("up", 1, 0), rec("17", null)], [scalar("up", 1), rec("5", null)], [scalar("up", 1), rec(null, "1")],
    [scalar("up", 1), rec("3.5", "1", { carryIn: "0.75" }), "consecutive-increases"], [scalar("up", 1), rec("3.5", "1", { carryIn: "0.75" })],
    [scalar("up", 1, "previousSettlement", true), rec("0", "0")], [scalar("up", 1, "previousSettlement", true), rec("2", "0")],
  ];
  for (const [rule, r, carry] of cases) test(`${rule.scalar!.direction} ${r.prevValue} to ${r.value}${carry ? " with carry" : ""}`, () => {
    const t = unitsFormula(rule, r, carry ?? "none")!;
    assert.ok(t, "a scalar rule always gets a line");
    assertTrueEquations(t);
    assert.ok(!t.includes("→"), "no arrows");
    if (!/units = floor/.test(t)) assert.ok(!/=/.test(t), `a line with no unit is words, not a sum: ${t}`);
  });
  test("the $SEAWIN reading (0 to 0) is words, not floor((0 − 0) / 1) = 1", () => {
    const t = unitsFormula(scalar("up", 1, 0), rec("0", "0"))!;
    assert.ok(!/floor/.test(t));
    assert.match(t, /no units count/);
  });
  test("a carried remainder appears only when the rule carries it, and the sum still holds", () => {
    const t = unitsFormula(scalar("up", 1), rec("3.5", "1", { carryIn: "0.75" }), "consecutive-increases")!;
    assert.match(t, /^units = floor\(\(3\.5 − 1 \+ 0\.75 carried\) \/ 1\) = 3 /);
    assert.ok(!/carried/.test(unitsFormula(scalar("up", 1), rec("3.5", "1", { carryIn: "0.75" }))!));
  });
  test("the evaluator refuses a false sum", () => {
    assert.equal(evaluateUnitsEquation("units = floor((0 − 0) / 1) = 1"), 0, "the old $SEAWIN line evaluates to 0, not 1");
  });
});

describe("pair receipts the other side decided are words", () => {
  test("the losing coin of a one-game pair explains its forwarded unit; the copy lint passes", () => {
    const t = pairWords("SEAWIN", rec("0", "0", { units: 1, pairRole: "lost" }), true)!;
    assert.match(t, /lost this result/);
    assert.match(t, /No \$SEAWIN is bought or burned\./);
    assert.ok(!/=|→|\bwill\b|payout/i.test(t));
    const cfg = loadCopyLintConfig();
    assert.ok(lintCopy(t, cfg).ok, JSON.stringify(lintCopy(t, cfg).hits));
    assert.equal(pairWords("DENWIN", rec("1", "0", { units: 1, pairRole: "won" }), true), null, "the winner's own sum is printed");
  });
});

describe("the verify command matches the source", () => {
  test("a game coin on the on-chain payout and TheSportsDB: the CTF payout vector and a JSON score API, never an HTML page into jq", () => {
    const c = verifyCommand({ oracle: "catalogue", eventId: "2026-10-16", settledAt: "2026-10-16", sourceUrl: "https://polymarket.com/event/nfl-sea-den-2026-10-16", method: "onchain-payout+thesportsdb+two-sources-agreed", feedLine: null, pairRole: "lost", ticker: "SEAWIN" });
    assert.match(c, /gamma-api\.polymarket\.com\/events\?slug=nfl-sea-den-2026-10-16/);
    assert.match(c, /cast call 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045 'payoutDenominator\(bytes32\)\(uint256\)'/);
    assert.match(c, /thesportsdb\.com\/api\/v1\/json\/123\/eventsday\.php\?d=2026-10-16/);
    assert.ok(!/curl -s 'https:\/\/polymarket\.com\/event/.test(c), "no HTML page piped to jq");
    assert.ok(!/\.market \/\/ \.markets/.test(c), "no Kalshi filter");
    assert.match(c, /\$SEAWIN's side lost this game/);
  });
  test("a recorded condition id is used as is; Kalshi keeps its own filter", () => {
    const cond = "0x" + "ab".repeat(32);
    const c = verifyCommand({ oracle: "polymarket", eventId: cond, settledAt: "2026-10-16T00:00:00Z", sourceUrl: "https://gamma-api.polymarket.com/markets?condition_ids=" + cond, method: "ctf-payout", proof: `polygon:137/ctf:0x4D97DCd97eC945f40cF65F87097ACe5EA0476045/condition:${cond}/payouts:1,0/block:1`, feedLine: null, ticker: "X" });
    assert.ok(c.includes(`'payoutNumerators(bytes32,uint256)(uint256)' ${cond} 0`));
    assert.match(verifyCommand({ oracle: "kalshi", eventId: "KX-1", settledAt: "x", sourceUrl: null, method: null, feedLine: null, ticker: "X" }), /trade-api\/v2\/markets\/KX-1' \| jq '\.market \/\/ \.markets/);
  });
});

describe("the pair's last result and receipt states in words", () => {
  const cfg = loadCopyLintConfig();
  test("Denver won and its burn waits for both coins to graduate; Seattle's share moves with it", () => {
    const t = pairLastSentence({ wonSide: "B", burnedSide: null, burned: null, winnerStatus: "pending-pair", loserStatus: "pending-pair", void: false }, "$SEAWIN", "$DENWIN")!;
    assert.equal(t, "$DENWIN won the last result. Its burn runs once both coins graduate and their pools are registered. $SEAWIN's share moves to $DENWIN's burn pool at the same time.");
    const fwd = pairLastSentence({ wonSide: "B", burnedSide: null, burned: null, winnerStatus: "pending-pair", loserStatus: "forwarded", void: false }, "$SEAWIN", "$DENWIN")!;
    assert.match(fwd, /\$SEAWIN has forwarded its share to \$DENWIN's burn pool\./);
    for (const s of [t, fwd]) { assert.ok(!/→|\bwill\b|neither side/.test(s)); assert.ok(lintCopy(s, cfg).ok, JSON.stringify(lintCopy(s, cfg).hits)); }
  });
  test("a burned side, a void and no winner each get their own true sentence", () => {
    assert.equal(pairLastSentence({ wonSide: "A", burnedSide: "A", burned: "1000", winnerStatus: "confirmed", loserStatus: "forwarded", void: false }, "$A", "$B"), "$A won the last result and burned 1000 tokens. $B forwarded its share to $A's burn pool.");
    assert.equal(pairLastSentence({ wonSide: null, burnedSide: null, burned: null, winnerStatus: null, loserStatus: null, void: true }, "$A", "$B"), "The last result was void, so neither side burned.");
    assert.match(pairLastSentence({ wonSide: null, burnedSide: null, burned: null, winnerStatus: null, loserStatus: null, void: false }, "$A", "$B")!, /^Neither side won/);
  });
  test("every receipt state has a phrase; pending-pair is never shown raw", () => {
    assert.equal(receiptStatusWords("pending-pair"), "waiting for both coins to graduate");
    for (const w of Object.values(RECEIPT_STATUS_WORDS)) { assert.ok(!/-/.test(w) || /\s/.test(w)); assert.ok(lintCopy(w, cfg).ok, w); }
  });
});
