// LAUNCH WIZARD PRODUCT-LOGIC AUDIT (2026-10-19; docs/burnticker/audits/launch-wizard-audit-2026-10-19.md). Each test reproduces one
// finding. Where the code is wrong today, the test ASSERTS THE CURRENT WRONG BEHAVIOUR (marked "CURRENT (wrong)") so the suite stays
// green; flip the assertion when the fix lands. The wanted behaviour is a test.todo beside it. Two tests are guards that pass today.
// The describe titles carry the first draft's numbers; each test names the audit table's finding (F1 to F5, F8 to F11, F13 to F16 FIXED,
// "FIXED" tests). F1 to F3 and the one-shot end wording came from the owner-decision change (burn-real flag, burn-target and incinerator
// refusals); the end picker's losing-path note (F6) is still CURRENT with its todo.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { availabilityFromEnv, BURN_REAL_WAITING, siteLaunchState } from "@/lib/burnticker/launchAvailability";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { applyDial, ON_END_DEFAULT } from "@/lib/burnticker/dials";
import { endChoiceModel, endSentences, SELF_ON_LOSS_LINE } from "@/lib/burnticker/guidedLaunch";
import { endText, windowKindOf } from "@/lib/burnticker/describe";
import { isOneShot, ruleStatement, type BurnRule } from "@/lib/burnticker/rules";
import { ruleFacts } from "@/lib/burnticker/coinPage";
import { RETIREMENT_FACTS } from "@/lib/burnticker/retirementCopy";
import { nextTimeRow } from "@/lib/burnticker/coinSourceLine";
import { CATALOGUE } from "@/lib/burnticker/catalogue/index";
import { KEEPER_ONE_SHOT_RE } from "@/lib/burnticker/inverse";
import { ONE_SHOT_SHARE_REFUSAL, ONE_SHOT_TARGET_SHARE_REFUSAL } from "@/lib/burnticker/linkedShare";
import { resolvesOnce, nextTimes } from "@/lib/burnticker/nextResult";
import { ruleEndLine, oneShotLeftover } from "@/lib/burnticker/coinPage";
import { LEFTOVER_SEE_END, retirementFacts } from "@/lib/burnticker/retirementCopy";
import { DECIDED, DECIDED_VOID } from "@/lib/burnticker/creatorBenefits";
import { SINK_PICKER_OFF_LINE, SINK_PICKER_OFF_NO_END, sourceText } from "@/lib/burnticker/launchPreflight";
import { budgetLine } from "@/lib/burnticker/launchReview";
import { END_CHOICE_RESET_NOTICE, endChoiceOffered } from "@/lib/burnticker/launchDraft";
import { nativeSourceById } from "@/lib/burnticker/sources/native";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { readFileSync } from "node:fs";
import { DISPERSAL_FLAG } from "@/lib/burnticker/dispersal";
import { DEBT_RULE } from "./burntickerHelpers.ts";
import { REAL_BURN_FAMILY_REFUSAL } from "@/lib/burnticker/burnRealEligibility";

const BONK = { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", pool: "HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv", symbol: "BONK", feedId: "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419" };
const MAINNET = { BURNTICKER_CLUSTER: "mainnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" };
const R5 = { ...MAINNET, BURNTICKER_INITIALIZE_TOKEN_LAYOUT: "r5" };
const debt = (f = 0.02): BurnRule => ({ ...DEBT_RULE, scalar: { ...DEBT_RULE.scalar, perUnit: { fractionOfPool: f } } }) as unknown as BurnRule;
const quakeNext = (f: number, s = "usgs.quakenext:6"): BurnRule => ({ ...applyDial(firstPartyRule(s, 0.02), "fraction", f), onEnd: { ...ON_END_DEFAULT } }) as BurnRule;
const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}:\n${formatHits(r)}`); };
const read = (f: string) => readFileSync(f, "utf8");
const review = (rule: unknown, env: Record<string, string>, extra: Record<string, unknown> = {}) => {
  const r = buildLaunchReview({ rule, ticker: "TESTX", name: "Test X", ...extra } as never, { env, reserved: new Set() });
  assert.ok("review" in r, "problems" in r ? r.problems.join(" | ") : "");
  return r.review;
};

describe("F1/F2: the round-5 burn target is off unless the owner's flag is on (fixed 2026-10-19, owner decision 1)", () => {
  test("FIXED: a Public number rule that burns BONK is refused on a host whose layout is NOT r5, and on an r5 host without BURNTICKER_BURN_REAL_ENABLED", () => {
    for (const env of [MAINNET, R5]) {
      const rv = review({ ...debt(), burnTarget: BONK }, env);
      assert.equal(siteLaunchState(env).burnReal.available, false, "the page hides the choice on this host");
      // owner 2026-10-19: a published-data coin may not burn another token at all; LA6-3 (sixth pass): that refusal alone, said once
      assert.deepEqual(rv.problems, [REAL_BURN_FAMILY_REFUSAL]);
      assert.equal(rv.signable, false);
    }
  });
  test("FIXED: on an r5 host with BURNTICKER_BURN_REAL_ENABLED on, only a Coin comparison coin may burn another token: published data and natural disasters are refused (test/burntickerBurnRealEligibility.test.ts has the Coin comparison case)", () => {
    const on = { ...R5, BURNTICKER_BURN_REAL_ENABLED: "1" };
    assert.equal(siteLaunchState(on).burnReal.available, true);
    const pub = review({ ...debt(), burnTarget: BONK }, on);
    assert.equal(pub.signable, false); assert.deepEqual(pub.problems, [REAL_BURN_FAMILY_REFUSAL]);
    // HB-12 + PROD-01 (2026-10-19): a natural-disaster coin may not burn another token (burnRealEligibility.ts)
    const quake = review({ ...quakeNext(1), burnTarget: BONK }, on);
    assert.equal(quake.signable, false);
    assert.ok(quake.problems.includes(REAL_BURN_FAMILY_REFUSAL), quake.problems.join(" | "));
  });
});

describe("F3: the incinerator end is listed wherever round 5 runs, and page and server read one flag (fixed 2026-10-19, owner decision 2)", () => {
  const inc = { ...quakeNext(1), onEnd: { ...ON_END_DEFAULT, endSink: "incinerator" } };
  test("FIXED: an r5 host lists burn-sol and signs the incinerator end; BURNTICKER_BURN_SOL_ENABLED=0 hides and refuses it; a host without r5 refuses it", () => {
    assert.equal(availabilityFromEnv(R5, "mainnet").sources.find((s) => s.id === "burn-sol")?.available, true);
    assert.equal(siteLaunchState(R5).burnSol.available, true);
    assert.equal(review(inc, R5).signable, true);
    assert.equal(review(inc, R5).end.kind, "incinerator");
    const off = { ...R5, BURNTICKER_BURN_SOL_ENABLED: "0" };
    assert.equal(siteLaunchState(off).burnSol.available, false);
    assert.equal(review(inc, off).signable, false);
    assert.equal(siteLaunchState(MAINNET).burnSol.available, false);
    assert.equal(review(inc, MAINNET).signable, false);
  });
});

describe("F4: a one-shot below 100% with a burn target is refused with a sentence that is untrue on this host", () => {
  test("FIXED (audit F5): on a dispersal host 50% passes without a target, and with one the problem names the target as the reason", () => {
    const on = { ...R5, BURNTICKER_BURN_REAL_ENABLED: "1" };
    assert.deepEqual(review(quakeNext(0.5), on).problems, [], "50% passes (burn dispersal is on for the round-5 program)");
    const p = review({ ...quakeNext(0.5), burnTarget: BONK }, on).problems;
    assert.ok(p.includes(ONE_SHOT_TARGET_SHARE_REFUSAL), p.join(" | "));
    assert.ok(!p.includes(ONE_SHOT_SHARE_REFUSAL), "the 'only 100% on this site' sentence is untrue on a dispersal host");
    assert.match(ONE_SHOT_TARGET_SHARE_REFUSAL, /another token/);
  });
  test("FIXED (audit F5): on a host without dispersal the 100% sentence stays, with or without a target, and both sentences are clean", () => {
    const OFF = { ...R5, BURNTICKER_BURN_REAL_ENABLED: "1", [DISPERSAL_FLAG]: "0" };
    assert.ok(review(quakeNext(0.5), OFF).problems.includes(ONE_SHOT_SHARE_REFUSAL));
    assert.ok(review({ ...quakeNext(0.5), burnTarget: BONK }, OFF).problems.includes(ONE_SHOT_SHARE_REFUSAL));
    assert.ok(!review({ ...quakeNext(0.5), burnTarget: BONK }, OFF).problems.includes(ONE_SHOT_TARGET_SHARE_REFUSAL));
    clean(ONE_SHOT_SHARE_REFUSAL, "one-shot share"); clean(ONE_SHOT_TARGET_SHARE_REFUSAL, "one-shot target share");
  });
});

describe("F5/F6: the end step of a one-shot that burns 100%", () => {
  const r = quakeNext(1);
  test("CURRENT (wrong): the end picker's note says the coin never burns itself when its rule ends without firing, while the void line says it does", () => {
    const m = endChoiceModel(r, { sinkPicker: false, burnSol: false });
    assert.equal(m.offered, true);
    assert.equal(SELF_ON_LOSS_LINE, "A coin does not burn itself when it loses or its rule ends without firing: the rest leaves this coin then.");
    assert.match(endText(r).void!, /burns down on this coin over four weeks/);
  });
  test("FIXED (owner decision 3, 2026-10-19): a one-shot at 100% says what reaches the pool after its one burn: trading fees and the kept reserve", () => {
    const s = endSentences(r).sentences.join(" ");
    assert.match(s, /^After its one burn, anything that reaches this coin's pool later, trading fees and the kept reserve, goes to \$DEFICIT's burn\./);
    assert.equal(r.reserveSol, "0.02");
  });
  test.todo("WANTED: the one-shot end also names any amount under the spend floor, and the end picker drops the losing-path note (SELF_ON_LOSS_LINE) for a one-shot at 100%");
  test("FIXED (audit F8): the picker-off refusal follows the rule's shape and never speaks of a losing coin", () => {
    const named = (r: BurnRule) => ({ ...r, onEnd: { ...ON_END_DEFAULT, mint: "BroncoMint1111111111111111111111111111111111", ticker: "BRONCO" } });
    assert.equal(windowKindOf(debt()), "perpetual");
    assert.deepEqual(review(named(debt()), MAINNET).problems, [SINK_PICKER_OFF_NO_END], "a Public number with no end date");
    assert.ok(review(named(quakeNext(1)), MAINNET).problems.includes(SINK_PICKER_OFF_LINE), "a one-shot at 100%");
    const reason = availabilityFromEnv(MAINNET, "mainnet").sources.find((x) => x.id === "end-sink-picker")!.reason!;
    for (const t of [SINK_PICKER_OFF_LINE, SINK_PICKER_OFF_NO_END, reason]) { assert.doesNotMatch(t, /losing/); clean(t, t); }
  });
});

describe("F7: the coin page and the review card's retirement facts contradict the end the rule carries", () => {
  const r = quakeNext(1);
  const left = (fs: readonly { q: string; a: string }[]) => fs.find((f) => /left/.test(f.q))!.a;
  test("FIXED (audit F9): ruleFacts.end is the rule's own end (endText): the rest goes to $DEFICIT's burn, and only a void burns down here", () => {
    assert.equal(endText(r).kind, "flagship");
    const end = ruleFacts(JSON.stringify(r), true).end;
    assert.ok(end.startsWith(endText(r).line), end);
    assert.match(end, /goes to \$DEFICIT's burn/); assert.match(end, /voided/);
    assert.doesNotMatch(end, /^When the rule ends, whatever is left in the burn pool is burned down/);
    // the 100% one-shot nuance: what is left is the kept-back reserve, an amount too small to spend and later fees
    assert.match(end, /0\.02 SOL the rule keeps back for fees, any amount too small to spend, and fees that arrive later/);
    assert.ok(!ruleFacts(JSON.stringify(quakeNext(0.5)), true).end.includes(oneShotLeftover("0.02")), "not on a share under 100%");
  });
  test("FIXED (audit F9): every end sink reads its own end; a rule without one keeps the burn-down on itself", () => {
    const named = { ...r, onEnd: { ...ON_END_DEFAULT, mint: "BroncoMint1111111111111111111111111111111111", ticker: "BRONCO" } } as BurnRule;
    assert.match(ruleEndLine(named), /goes to \$BRONCO's burn/);
    const inc = { ...r, onEnd: { ...ON_END_DEFAULT, endSink: "incinerator" } } as unknown as BurnRule;
    assert.match(ruleEndLine(inc), /incinerator/);
    const self = { ...r, onEnd: { ...ON_END_DEFAULT, endSink: undefined } } as unknown as BurnRule;
    assert.match(ruleEndLine(self), /burned down over 28 days, and then the coin retires/);
    for (const x of [r, named, inc, self]) clean(ruleEndLine(x), "end line");
  });
  test("FIXED (audit F9): the retirement answer no longer says a burn-down on the coin and nothing sent elsewhere; under a coin's end it points to it", () => {
    for (const a of [left(RETIREMENT_FACTS), left(retirementFacts(LEFTOVER_SEE_END))]) { assert.doesNotMatch(a, /Nothing is sent to another coin/); clean(a, a); }
    assert.match(left(RETIREMENT_FACTS), /\$DEFICIT's burn/);
    assert.equal(left(retirementFacts(LEFTOVER_SEE_END)), LEFTOVER_SEE_END);
    assert.match(read("src/app/burnticker/t/[ticker]/page.tsx"), /<RetirementFacts className="mt-1" leftover=\{LEFTOVER_SEE_END\} \/>/);
    assert.match(read("src/app/burnticker/launch/ReviewCard.tsx"), /<RetirementFacts className="mt-1" open leftover=\{LEFTOVER_SEE_END\} \/>/);
  });
  test("FIXED (audit F10): the dial on a one-shot names its one result, and a burn-target coin spends on that token", () => {
    assert.equal(ruleFacts(JSON.stringify(r), true).dial, "The one result that fires the rule spends 100% of the burn pool on this coin and burns what it gets.");
    assert.equal(ruleFacts(JSON.stringify(r)).dial, "The one result that fires the rule spends 100% of the burn pool on this coin and burns what it gets.", "from the rule alone");
    assert.equal(ruleFacts(JSON.stringify({ ...r, burnTarget: BONK })).dial, "The one result that fires the rule spends 100% of the burn pool on BONK and burns what it gets.");
    assert.equal(ruleFacts(JSON.stringify(debt())).dial, "Each unit spends 2% of the burn pool on this coin and burns what it gets.", "a repeating rule keeps per unit");
  });
});

describe("F8: the coin page's next-time row does not read the one-shot result state", () => {
  test("FIXED (audit F13): a decided or voided one-shot reads Decided or Voided, in the creator page's words, never a next source check", () => {
    const decided = nextTimeRow(null, "2099-01-01T00:00:00Z", 0, "decided"), voided = nextTimeRow(null, "2099-01-01T00:00:00Z", 0, "void");
    assert.equal(decided.value, DECIDED); assert.equal(voided.value, DECIDED_VOID);
    for (const x of [decided, voided]) { assert.notEqual(x.label, "Next source check"); clean(`${x.label}. ${x.note}`, x.label); }
    assert.equal(nextTimeRow(null, "2099-01-01T00:00:00Z", 0, "pending").label, "Next source check", "a pending one-shot still shows the check");
    assert.equal(nextTimeRow(null, "2099-01-01T00:00:00Z", 0, "recurring").label, "Next source check");
  });
  test("FIXED (audit F13): the coin page passes the producer's result state into the row", () => {
    const page = read("src/app/burnticker/t/[ticker]/page.tsx");
    assert.match(page, /nextTimeRow\(s\.next\.nextCloseTime, s\.next\.nextSourceCheckAt \?\? s\.next\.nextCheckAt, tick, s\.next\.result \?\? null\)/);
    assert.match(page, /result\?: "recurring" \| "pending" \| "decided" \| "void"; nextResultAt\?: string \| null/);
  });
});

describe("F9: the locked statement of a catalogue one-shot (live NEXTM6, usgs.quakenext:6)", () => {
  test("isOneShot is true for usgs.quakenext at this commit (the live oneShot=false is an older status producer)", () => {
    for (const s of ["usgs.quakenext:6", "usgs.quakenext:6.5", "usgs.quakenext:7", "usgs.quakenext:7.5/japan", "usgs.quakenext:8"]) assert.equal(isOneShot(quakeNext(1, s)), true, s);
  });
  test("FIXED (audit F11): ruleStatement says one qualifying reading, spent once, with this source's void clause only", () => {
    const r = quakeNext(1), src = sourceText(r)!;
    const st = ruleStatement(r, { feedTitle: src.title, unitLabel: src.unitLabel });
    assert.match(st, /^This rule resolves once\. It fires on the first reading of the source "The next reviewed magnitude 6 or more anywhere in the world \(USGS\)" after launch that counts \(the next magnitude 6 or more\), and on that one result the keeper spends the whole fee pool \(100%\)/);
    assert.match(st, /No later reading burns again\./);
    assert.doesNotMatch(st, /Each time|baseline of 0|per unit|compounds|voided market|cancelled season/);
    assert.match(st, /When the rule ends void \(a voided reading\)/);
    // owner decision 2026-10-19 (oneShotFull): the end clause of a one-shot at 100% says what reaches the pool after its one burn
    assert.match(st, /The rule resolves once and spends the whole burn pool in that one burn\. After it, whatever reaches the burn pool later/);
    // every catalogue one-shot takes the branch; a repeating catalogue rule keeps the per-unit statement
    for (const s of ["nhc.next:ep.3.2026", "spc.tornadoday:10/US", "nifc.firesize:50000", "usgs.volcanowarning:332010", "defillama.tvlnext:raydium-amm", "github.milestone:anza-xyz/agave.2000"]) assert.match(ruleStatement(firstPartyRule(s, 1)), /^This rule resolves once\./, s);
    assert.match(ruleStatement(debt()), /^Each time this coin's source publishes a reading/);
  });
  test("FIXED (audit F11): the token status producer passes the feed title and the unit, as the review does", () => {
    assert.match(read("src/lib/burnticker/tokenPage.ts"), /statement: ruleStatement\(rule, \{ seriesTitle: i\.seriesTitle, feedTitle: src\?\.title \?\? null, unitLabel: src\?\.unitLabel \?\? null \}\)/);
  });
  test("FIXED (audit F14): the first snow resolves once for every reader (status, coin page, statement), and stays out of the keeper's one-shot set by design", () => {
    const snow = { ...firstPartyRule("nws.snow:DEN", 0.25), onEnd: { ...ON_END_DEFAULT } } as BurnRule;
    assert.equal(windowKindOf(snow), "one-shot");
    assert.equal(isOneShot(snow), false, "the keeper ends it in its own branch (multiKeeper.ts detectRuleEnd), so isOneShot stays false");
    assert.equal(resolvesOnce(snow), true);
    assert.match(ruleFacts(JSON.stringify(snow)).window, /resolves once/);
    assert.match(ruleFacts(JSON.stringify(snow)).dial!, /^The one result that fires the rule spends 25%/);
    assert.match(ruleStatement(snow), /^This rule resolves once\.[\s\S]*a season that ends with no first snow/);
    // a daily reading of 0 does not decide it; the first day that burned does
    const zero = [{ status: "confirmed", settledAt: "2026-10-20T00:00:00Z", units: 0 }], burned = [...zero, { status: "confirmed", settledAt: "2026-10-21T00:00:00Z", units: 1 }];
    assert.equal(nextTimes({ oneShot: true, receipts: zero, nextCloseTime: null, nextCheckAt: null, burnedOnly: true }).result, "pending");
    assert.equal(nextTimes({ oneShot: true, receipts: burned, nextCloseTime: null, nextCheckAt: null, burnedOnly: true }).result, "decided");
    assert.match(read("src/lib/burnticker/tokenPage.ts"), /const oneShot = resolvesOnce\(rule\);/);
  });
});

describe("guard (audit F14): a native source whose cadence resolves once (the first snow, a single game) resolves once for every reader", () => {
  test("cadence 'once a season' or 'resolves once' means resolvesOnce", () => {
    for (const id of ["nws.snow:DEN", "nws.snow:BOS"]) {
      const n = nativeSourceById(id)!;
      assert.match(n.cadence, /once/, id);
      assert.equal(resolvesOnce(firstPartyRule(id, 0.25)), true, id);
    }
    for (const id of ["nws.high:DEN-90", "nws.rain:DEN-0.50"]) { const n = nativeSourceById(id); if (!n) continue; assert.doesNotMatch(n.cadence, /once/, id); assert.equal(resolvesOnce(firstPartyRule(id, 0.02)), false, id); }
  });
});

describe("F15: the review's budget line on a one-shot", () => {
  test("FIXED (audit F15): a one-shot says its one result, a repeating rule says each result", () => {
    assert.match(budgetLine("100%", true), /^Its one result spends 100%/);
    assert.match(budgetLine("2%"), /^Each result spends 2%/);
    assert.match(review(quakeNext(1), R5).budget, /^Its one result spends 100%/);
    assert.match(review(debt(), R5).budget, /^Each result spends 2%/);
    clean(budgetLine("100%", true), "budget");
  });
});

describe("F4 (audit): a restored draft's end choice the host no longer offers", () => {
  test("FIXED (audit F4): a hidden choice is not offered, so the restore falls back to $DEFICIT and says so in one line", () => {
    const off = { sinkPicker: false, burnSol: false };
    assert.equal(endChoiceOffered({ kind: "deficit" }, off), true);
    assert.equal(endChoiceOffered({ kind: "coin" }, off), false);
    assert.equal(endChoiceOffered({ kind: "burn-sol" }, off), false);
    assert.equal(endChoiceOffered({ kind: "coin" }, { sinkPicker: true, burnSol: false }), true);
    assert.equal(endChoiceOffered({ kind: "burn-sol" }, { sinkPicker: false, burnSol: true }), true);
    clean(END_CHOICE_RESET_NOTICE, "end reset notice");
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.match(page, /if \(s\.endA !== undefined \|\| s\.endB !== undefined\) endRestored\.current = true;/);
    assert.match(page, /if \(!endRestored\.current \|\| site\.read === "loading"\) return;/);
    assert.match(page, /if \(badA \|\| badB\) setEndNotice\(END_CHOICE_RESET_NOTICE\);/);
    assert.match(page, /data-end-notice>\{endNotice\}</);
  });
});

describe("F16: the 'What is not offered yet' disclosure", () => {
  test("FIXED (audit F16): shown only for a rule that came with a burn target, not on every coin's step 3", () => {
    // HB-12: and only on a family that could have the choice (burnRealEligibility.ts)
    assert.match(read("src/app/burnticker/launch/page.tsx"), /: site\.burnReal\.line && rule0\?\.burnTarget && realBurnAllowed\(rule0\) \? <details [^>]*data-burn-real-waiting>/);
  });
});

describe("guard: every catalogue source that resolves once is one-shot for the keeper (no structured flag exists, only the cadence text)", () => {
  test("cadence 'resolves once' matches KEEPER_ONE_SHOT_RE", () => {
    const once = CATALOGUE.filter((f) => /^resolves once/i.test(f.cadence ?? ""));
    assert.ok(once.length >= 8, `found ${once.length}`);
    for (const f of once) assert.ok(KEEPER_ONE_SHOT_RE.test(`${f.id.split(":")[0]}:`), f.id);
  });
});
