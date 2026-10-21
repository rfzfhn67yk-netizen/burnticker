// BT-108-COPY-01 (2026-10-20, confirmed live on publish 108): the event review's "How much" row said "each daily run spends at most 2% …
// so a large burn lands over several days" while the same page's spreading note said pieces over six-hour windows at least 20 minutes
// apart. The program's budget refills every 600 s and the keeper spreads the carried part (dispersal.ts), so every one-time family (an
// event, an earthquake and the other hazards, 50% and 100%) now says one schedule, from spreadCopy.ts. This test builds the guided
// amount line, the one-shot review sentences, the generated description and the server review for each family and fails on the old words.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { describeRule } from "@/lib/burnticker/describe";
import { budgetCopy, oneShotSentences, wholePoolSliceLine } from "@/lib/burnticker/guidedLaunch";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { SPREAD_ONE_SHOT_LINE, SPREAD_REST_SENTENCE, SPREAD_REVIEW_LINE } from "@/lib/burnticker/spreadCopy";
import { CREATOR_LAUNCHES_FLAG } from "@/lib/burnticker/creatorLaunches";
import { lintCopy } from "@/lib/launch/copyLint";

const OLD = /daily run|several days|one run a day|each run spends/i;
const poly = (f: number): BurnRule => ({ schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: "0x" + "ab".repeat(32), filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: f }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, onEnd: { ...DEFAULT_ON_END } } as unknown as BurnRule);
const hazard = (series: string, f: number): BurnRule => ({ ...firstPartyRule(series, f), onEnd: { ...DEFAULT_ON_END } } as BurnRule);
const FAMILIES: [string, (f: number) => BurnRule][] = [
  ["event outcome", poly],
  ["earthquake", (f) => hazard("usgs.quakenext:6", f)],
  ["hurricane", (f) => hazard("nhc.next:atlantic.1.2026", f)],
  ["tornado day", (f) => hazard("spc.tornadoday:10/US", f)],
  ["wildfire", (f) => hazard("nifc.firesize:100000", f)],
  ["volcano", (f) => hazard("usgs.volcanowarning:kilauea", f)],
];
const env = { BURNTICKER_CLUSTER: "mainnet", [CREATOR_LAUNCHES_FLAG]: "1", BURNTICKER_DISPERSAL: "1" };

describe("BT-108-COPY-01: one scheduling policy on every one-time family", () => {
  test("the sentence itself: two percent per burn, pieces over a six-hour window at least 20 minutes apart, lint-clean", () => {
    assert.match(SPREAD_ONE_SHOT_LINE, /^One burn spends at most 2% of the trading pool's SOL\. The rest is burned in smaller pieces at random times over a six-hour window, at least 20 minutes apart/);
    assert.ok(SPREAD_REVIEW_LINE.includes("at least 20 minutes apart") && SPREAD_REST_SENTENCE.includes("at least 20 minutes apart"), "the same facts as the review's spreading note");
    for (const s of [SPREAD_ONE_SHOT_LINE, wholePoolSliceLine("85")]) { assert.doesNotMatch(s, OLD); assert.deepEqual(lintCopy(s).hits, [], s); }
  });
  for (const [name, mk] of FAMILIES) for (const f of [1, 0.5]) {
    test(`${name} at ${f * 100}%: the amount step, the one-shot sentences, the description and the review say the one schedule`, () => {
      const r = mk(f);
      const b = budgetCopy(r, f, null, { raiseSol: "85" });
      assert.doesNotMatch(b.line, OLD, b.line);
      assert.ok(b.line.includes(SPREAD_REST_SENTENCE), `${name}: the amount step uses spreadCopy.ts: ${b.line}`);
      for (const s of oneShotSentences({ share: f, happened: "it happened", subject: "it" })) assert.doesNotMatch(s, OLD, s);
      const d = describeRule(r, { ticker: "TESTCOIN" });
      assert.doesNotMatch(`${d.lead} ${d.paragraph} ${d.ruleBlock}`, OLD);
      const v = buildLaunchReview({ rule: r, ticker: "TESTCOIN", name: "Test Coin" }, { env, reserved: new Set() });
      assert.doesNotMatch(JSON.stringify(v), OLD, `${name}: the server review`);
    });
  }
});
