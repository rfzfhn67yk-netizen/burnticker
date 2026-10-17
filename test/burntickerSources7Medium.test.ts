// SOURCES-7 (QA walkthrough 11, the library side of the medium items): M4 drain warnings on the review (the debt at 2% per $1B, M4
// earthquakes worldwide at 5%) and the backtest counting burns rather than readings; M2 the wrong sentences ("after 5 wins" on the
// without-a-win pattern, the NO side's "If it does", "Their next game only" after a later game); M8 the review's operator powers from the
// same status record as Trust.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { teamSeries } from "@/lib/burnticker/sources/espn";
import { buildLaunchReview, authorityLine, reviewGovernance } from "@/lib/burnticker/launchReview";
import { drainUnitFor, drainWarning, quakesPerDay, reviewProjection } from "@/lib/burnticker/projection";
import { drainLine, teamDrainUnit, unitsToHalf } from "@/lib/burnticker/drain";
import { oneShotSentences, patternWords } from "@/lib/burnticker/guidedLaunch";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { DEBT_RULE } from "./burntickerHelpers.ts";

const cfgLint = loadCopyLintConfig();
const lint = (t: string) => { const r = lintCopy(t, cfgLint); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };
const env = { BURNTICKER_CLUSTER: "mainnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" };
const NOW = Date.parse("2026-10-13T12:00:00Z");
const debt = (f: number) => ({ ...DEBT_RULE, scalar: { ...DEBT_RULE.scalar, perUnit: { fractionOfPool: f } }, onEnd: { ...DEFAULT_ON_END } }) as BurnRule;
const quakes = (m: string, f: number) => ({ ...firstPartyRule(`usgs.quakes:${m}`, f), onEnd: { ...DEFAULT_ON_END } }) as BurnRule;
const review = (rule: BurnRule) => { const r = buildLaunchReview({ rule, ticker: "TEST", name: "Test Coin" }, { env, now: NOW }); assert.ok("review" in r, JSON.stringify(r)); return r.review; };

describe("M4: drain warnings where pools drain fastest", () => {
  test("the national debt at 2% per $1B: a warning on the review, from the saved readings, in days", () => {
    const v = review(debt(0.02));
    const w = v.warnings.find((x) => /half the pool/.test(x));
    assert.ok(w, v.warnings.join("\n"));
    assert.match(w!, /^At 2% each, about half the pool would be gone in about \d+ days?, going by the saved readings/);
    lint(w!);
  });
  test("the backtest counts burns, not readings: 'burned N times, on M readings' beside the share's percentage", () => {
    const p = reviewProjection(debt(0.02), NOW);
    assert.ok(p.available);
    assert.match(p.lines[0], /would have burned \d+ times, on \d+ readings \(one burn for each \$1B added\)\./);
    assert.ok(p.rows[0].units > p.rows[0].triggers);
    assert.doesNotMatch(p.lines.join(" "), /triggered/);
    assert.equal(p.drain, drainLine(0.02, drainUnitFor(debt(0.02))));
    assert.match(p.drain!, /after 5 additions of \$1B/);
  });
  test("earthquakes of magnitude 4 worldwide at 5%: warned from the long-term rate, and the magnitude 5.5 sample is not shown as this rule's", () => {
    assert.ok(quakesPerDay(4) > 30 && quakesPerDay(4) < 60, String(quakesPerDay(4)));
    const v = review(quakes("4", 0.05));
    const w = v.warnings.find((x) => /half the pool/.test(x));
    assert.ok(w, v.warnings.join("\n"));
    assert.match(w!, /within a day, going by the U\.S\. Geological Survey's long-term count of earthquakes worldwide/);
    lint(w!);
    assert.equal(v.projection.available, false);
    assert.match(v.projection.reason!, /magnitude 5\.5 or more worldwide, not this rule's/);
    assert.match(v.projection.drain!, /after 5 earthquakes of magnitude 4 or more/);
    // the sample's own rule is still projected, and a rare magnitude at a small share gets no warning
    assert.ok(reviewProjection(quakes("5.5", 0.01), NOW).available);
    assert.equal(drainWarning(quakes("7", 0.01), reviewProjection(quakes("7", 0.01), NOW)), null);
    assert.equal(unitsToHalf(0.05), 14);
  });
});

describe("M2: the wrong sentences", () => {
  test("the without-a-win pattern's drain line says games without a win, never wins", () => {
    const fade = { ...firstPartyRule(teamSeries("nhl", "COL", "win", { kind: "season", year: 2026 }), 0.25), inverse: true, onEnd: { ...DEFAULT_ON_END } } as BurnRule;
    assert.deepEqual(drainUnitFor(fade), teamDrainUnit("win", true));
    const line = drainLine(0.25, drainUnitFor(fade));
    assert.equal(line, "At 25% per game without a win, about 76% of the pool is gone after 5 games without a win, if no new fees come in.");
    assert.equal(drainLine(0.25, teamDrainUnit("loss")), "At 25% per loss, about 76% of the pool is gone after 5 losses, if no new fees come in.");
    lint(line);
  });
  test("the NO side says what happens if the market resolves YES, not 'If it does'", () => {
    const s = oneShotSentences({ share: 1, happened: "the market resolved NO", subject: "it", no: true });
    assert.equal(s[2], "If the market resolves YES instead, the rest goes to $DEFICIT's burn. A voided market is not a NO.");
    assert.doesNotMatch(s.join(" "), /If it does,/);
    lint(s[2]);
  });
  test("a one-game rivalry on a later game names that game, not 'their next game'", () => {
    const later = patternWords("once", { follow: "rivalry", pairKind: "teams", rivalryScope: "game", gameLabel: "Sat, May 1, 2027" });
    assert.equal(later.label, "Their game on Sat, May 1, 2027 only, winner takes the burn");   // audit 12 item 3: the linked pair it builds
    assert.match(later.sentence, /^When their game on Sat, May 1, 2027 is final/);
    assert.equal(patternWords("once", { follow: "rivalry", pairKind: "teams", rivalryScope: "game" }).label, "Their next game only, winner takes the burn");
  });
});

describe("M8: the review's operator powers match Trust", () => {
  test("the authority line names who holds the upgrade keys from the same status record as the governance lines", () => {
    const gov = reviewGovernance(process.cwd(), "mainnet", 0);
    const auth = authorityLine(process.cwd(), "mainnet");
    assert.ok(auth.includes(gov[1]), `${auth}\n${gov[1]}`);
    assert.match(auth, /operator controls two of the three upgrade keys, so it can approve a program upgrade alone/);
    assert.doesNotMatch(auth, /a shared wallet that needs several signatures/);
    lint(auth);
    const v = review(debt(0.01));
    assert.ok(v.authority.includes(v.governance[1]), `${v.authority}\n${v.governance.join(" ")}`);
  });
});
