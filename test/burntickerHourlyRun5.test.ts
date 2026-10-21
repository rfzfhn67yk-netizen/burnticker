// HOURLY AUDIT 2026-10-19 17:10 DENVER, RUN 5 (docs/burnticker/audits/continuous/2026-10-19-1710-Denver.md; bugs.md HB-71, HB-72,
// HB-74 to HB-81; suggestions HS-26, HS-27, HS-29). One pure test or source check per fix, plus the copy lint on every new public sentence.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { HAZARD_KINDS, hazardHelpId, hazardPatternOptions, hazardPatternSwitch, hazardPreselected, type HazardPatternState } from "@/lib/burnticker/hazards";
import { helpFor } from "@/lib/burnticker/fieldHelp";
import {
  MEETINGS_NONE_LEFT_LINE, NO_LISTED_MEETING_LINE, PAST_BURNS_UNAVAILABLE, PAST_BURNS_WORKING, SELF_ON_END_LINE, SELF_ON_LOSS_LINE, meetingsLeft, meetingsListRows,
  meetingsNoneLeftWarning, pastBurnsLines, selfEndLineFor, seriesOptionState,
} from "@/lib/burnticker/guidedLaunch";
import { decidedPairLine, decidedPairOf } from "@/lib/burnticker/decidedWarning";
import { creatorNextFields } from "@/lib/burnticker/creatorServe";
import { upcomingFromStatus } from "@/lib/burnticker/upcoming";
import { footerFeeLine, feeTiersLine, tier14CoinExists } from "@/lib/burnticker/feeShareLine";
import { DEV_FEE_LINE } from "@/lib/burnticker/fees";
import { CPMM_TIER_14_SINCE } from "@/lib/burnticker/cpmmTier";
import { oneShotBacktestLines } from "@/lib/burnticker/projection";
import { FLIP_REST_LINE } from "@/lib/burnticker/derby/spec";
import { edgeCaseFor, ITEM_218_ONE_SHOT_TAIL } from "@/lib/burnticker/ruleEdgeCases";
import { SIM_NO_TIE_COUNT } from "@/lib/burnticker/simulator";
import { receiptsCountLine, receiptsCountShort } from "@/lib/burnticker/coinStatus";
import { receiptsLine } from "@/lib/burnticker/badge";
import { presetRowLabel } from "@/lib/burnticker/launchPresets";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };
const plain = (s: string) => { clean(s); assert.doesNotMatch(s, /\d{4}-\d{2}-\d{2}|→|\w\/\w+\//, s); };
const read = (p: string) => fs.readFileSync(p, "utf8");
const page = read("src/app/burnticker/launch/page.tsx");
const IN_SEASON = Date.parse("2026-09-01T12:00:00Z");

describe("HB-71: the natural-disaster pattern switch is a radio group", () => {
  const ruleOf = (s: HazardPatternState) => ({ ...firstPartyRule(s.series, 0.02), inverse: s.inverse });
  for (const k of HAZARD_KINDS) {
    test(`${k.label}: Every → not-happen → Every → Once → Every ends on Every`, () => {
      let s: HazardPatternState = { series: k.every, inverse: false };
      const step = (pt: "every" | "fade" | "once") => { const r = hazardPatternSwitch(s, pt, IN_SEASON); assert.ok(r && "next" in r, `${k.id} ${pt}: ${JSON.stringify(r)}`); s = r.next; return hazardPreselected(s); };
      assert.equal(step("every"), "every");
      assert.equal(step("fade"), "fade");
      assert.equal(step("every"), "every", "Every after not-happen");
      assert.equal(step("once"), "once");
      assert.equal(step("every"), "every", "Every after Once");
      assert.equal(s.inverse, false);
      assert.equal(hazardPatternOptions(ruleOf(s) as never, IN_SEASON).preselected, "every");
      // from Once, not-happen moves back to the per-event form with the fade side on
      step("once"); assert.equal(step("fade"), "fade"); assert.ok(!/next|day:|firesize|warning/.test(s.series) || k.id === "hurricane", s.series);
    });
  }
  test("the page uses the reducer and no longer swaps the series inline", () => {
    assert.match(page, /hazardPatternSwitch\(\{ series: rule\.series, inverse: !!rule\.inverse \}, pt, Date\.now\(\)\)/);
    assert.match(page, /setWantInverse\(sw\.next\.inverse \? "on" : "off"\)/);
  });
});

describe("HB-74 and HB-75: the hazard step's status line and help", () => {
  test("changing the hazard clears the pattern notice", () => {
    const i = page.indexOf("const chooseHazard = ");
    assert.ok(i > 0); assert.match(page.slice(i, i + 600), /setPatternNotice\(null\)/);
  });
  test("an area picker gets area help, a threshold picker threshold help", () => {
    assert.equal(hazardHelpId("area"), "hazard-area"); assert.equal(hazardHelpId("region"), "hazard-area"); assert.equal(hazardHelpId("basin"), "hazard-area");
    assert.equal(hazardHelpId("count"), "hazard-threshold"); assert.equal(hazardHelpId("magnitude"), "hazard-threshold");
    const h = helpFor("hazard-area")!; assert.match(h.what, /area/); assert.doesNotMatch(h.what, /level a reading has to reach/);
    plain(h.what); plain(h.does);
    assert.match(page, /<FieldHelp id=\{hazardHelpId\(c\.id\)\} \/>/);
  });
});

describe("HB-72: a rivalry series with no meeting left", () => {
  const played = [{ eventId: "1", startsAt: "2026-10-15T20:15:00Z", playoff: false, home: "DEN", away: "SEA", status: "final", result: "win" }];
  test("the series option is greyed with a notice when every meeting is final", () => {
    assert.equal(meetingsLeft(played), 0);
    // hourly run 7 (HB-72 consistency, meetingsLeft.ts): the server decides; with no meeting left and a playoff meeting still possible
    // it stays offered with the warning, and with none possible the server sends offered false and the line
    assert.deepEqual(seriesOptionState({ offered: true, offeredLine: null, meetings: played, season: "2026" }), { offered: true, why: null, warning: meetingsNoneLeftWarning("2026", true) });
    assert.deepEqual(seriesOptionState({ offered: false, offeredLine: MEETINGS_NONE_LEFT_LINE, meetings: played }), { offered: false, why: MEETINGS_NONE_LEFT_LINE, warning: null });
    const open = [...played, { ...played[0], eventId: "2", startsAt: "2026-12-20T20:15:00Z", status: "scheduled", result: "pending" }];
    assert.deepEqual(seriesOptionState({ offered: true, offeredLine: null, meetings: open }), { offered: true, why: null, warning: null });
    assert.deepEqual(seriesOptionState({ offered: false, offeredLine: null, meetings: [] }), { offered: false, why: NO_LISTED_MEETING_LINE, warning: null });
    assert.match(page, /seriesOptionState\(rv!\)/);
    plain(MEETINGS_NONE_LEFT_LINE);
  });
  test("the server review warns, and the rivalry handler stops offering it", () => {
    const w = meetingsNoneLeftWarning("2026", true);
    assert.equal(w, "The schedule lists no game between these two teams still to be played in the 2026 season. This pair burns only if they meet in the playoffs.");
    plain(w); plain(meetingsNoneLeftWarning("2026–27", false));
    const route = read("src/app/api/burnticker/v1/launch/review/route.ts");
    // hourly run 7: the route reads the one verdict (meetingsLeft.ts) and passes the warning and the refusal
    assert.match(route, /async function meetingsVerdictOf/); assert.match(route, /meetingsNote, meetingsRefusal \}\);/);
    assert.match(read("src/lib/burnticker/launchReview.ts"), /else if \(o\.meetingsNote && !warnings\.includes\(o\.meetingsNote\)\) warnings\.unshift\(o\.meetingsNote\)/);
    assert.match(read("src/lib/burnticker/api/handlers.ts"), /const offered = verdict\.state === "open" \|\| verdict\.state === "playoffs"/);
  });
  test("the games list reads \"vs SEA (DEN won)\" with a space", () => {
    const r = meetingsListRows(played, "DEN", "SEA")[0];
    assert.equal(`${r.where} (${r.state})`, "vs SEA (DEN won)");
    assert.match(page, /\{m\.state && <>\{" "\}<span className="text-neutral-400">\(\{m\.state\}\)<\/span><\/>\}/);
  });
});

describe("HB-80 / HS-27: one decided line for a pair coin", () => {
  const status = (pairRole: "won" | "lost") => ({ ticker: pairRole === "won" ? "DENWIN" : "SEAWIN", rules: { oneShot: true }, next: { result: "decided" }, selectorKey: "espn.game:nfl-401", profile: { badge: "ONE-SHOT · Oct 15, 2026" }, pair: { clause: { state: "waiting", voidBy: "2026-11-14" } } });
  const rc = (pairRole: "won" | "lost") => [{ status: "pending-pair", settledAt: "2026-10-16T13:38:00Z", kind: "event", pairRole, units: 1 }];
  test("winner and loser lines", () => {
    const won = decidedPairLine("DENWIN", decidedPairOf(status("won"), rc("won"))!);
    const lost = decidedPairLine("SEAWIN", decidedPairOf(status("lost"), rc("lost"))!);
    assert.equal(won, "Won on 15 October 2026. Burn runs once both coins graduate (by 14 November 2026).");
    assert.equal(lost, "Lost on 15 October 2026. This result cannot make $SEAWIN burn.");
    plain(won); plain(lost);
    assert.equal(decidedPairLine("X", { role: "won", day: null, voidBy: null, bothGraduated: false }), "Won. Burn runs once both coins graduate.");
  });
  test("the creator card and the home row print it; neither says waiting on the loser", () => {
    const cf = creatorNextFields({ ...status("lost"), next: { result: "decided", nextResultAt: null, nextSourceCheckAt: null } } as never, rc("lost") as never, Date.parse("2026-10-19T23:00:00Z"));
    assert.equal(cf.nextLine, "Lost on 15 October 2026. This result cannot make $SEAWIN burn.");
    const row = upcomingFromStatus({ ...status("lost"), name: "Seahawks", cluster: "mainnet", status: "live", oracle: "espn", seriesTitle: null, next: { nextCheckAt: null, nextMarket: null, nextCloseTime: null, result: "decided" }, pair: null } as never, rc("lost") as never, "SEAWIN");
    assert.ok(row); const text = JSON.stringify(row);
    assert.match(text, /Lost on 15 October 2026\. This result cannot make \$SEAWIN burn\./);
    assert.doesNotMatch(text, /waits until both coins/);
    const rowW = upcomingFromStatus({ ...status("won"), name: "Broncos", cluster: "mainnet", status: "live", oracle: "espn", seriesTitle: null, next: { nextCheckAt: null, nextMarket: null, nextCloseTime: null, result: "decided" }, pair: null } as never, rc("won") as never, "DENWIN");
    assert.match(JSON.stringify(rowW), /Won on 15 October 2026\. Burn runs once both coins graduate\./);
  });
  test("a recurring coin, a burned result or a coin with no pair role gets no line", () => {
    assert.equal(decidedPairOf({ ...status("won"), rules: { oneShot: false } }, rc("won")), null);
    assert.equal(decidedPairOf(status("won"), [{ ...rc("won")[0], status: "confirmed" }]), null);
    assert.equal(decidedPairOf(status("won"), [{ status: "planned", settledAt: "2026-10-16T13:38:00Z", kind: "event", pairRole: null }]), null);
  });
  test("the embed and the badge carry it", () => {
    assert.match(read("src/lib/burnticker/badge.ts"), /decided: \(\(\) => \{ if \(coinLifecycleState\(s, i\.receipts\) !== \"decided\"\) return null; const d = decidedPairOf\(s, i\.receipts\)/);
    assert.match(read("src/lib/burnticker/embed.ts"), /const n = decided \? \{ before: decided/);
  });
});

describe("HS-26: the footer and trust fee line", () => {
  const cut = Date.parse(CPMM_TIER_14_SINCE);
  test("the exact shape, with the computed clause", () => {
    const live = footerFeeLine(25, { tier14Live: false });
    // eighth pass B-23 (owner B-17 decision): one split for every coin, the platform's tier; the "(every coin live today)" clause is gone
    assert.equal(live, "Burnticker takes 0.25% of curve volume. After graduation, every coin pays 1.25% per swap (Raydium fee tier 14): about 0.98% to the burn pool, 0.13% to the operator and 0.15% to Raydium. LaunchLab moves a graduating coin into a pool on the platform's current fee tier, which is 14; coins made before 19 October 2026 recorded tier 9 when they were created and pay 1.25% all the same. Coin-vs-coin pair pools use their own split, shown on the pair page.");
    clean(live);
    assert.doesNotMatch(footerFeeLine(25, { tier14Live: true }), /every coin live today/);
    assert.doesNotMatch(footerFeeLine(25, { tier14Live: null }), /every coin live today/);
    assert.equal(DEV_FEE_LINE, footerFeeLine(25, { tier14Live: null }));
    assert.ok(feeTiersLine({ tier14Live: false }).startsWith("After graduation, every coin pays"));
  });
  test("the clause vanishes once a live mainnet coin is created on tier 14", () => {
    const old = { cluster: "mainnet", status: "live", createdAt: cut - 60_000 };
    assert.equal(tier14CoinExists([old]), false);
    assert.equal(tier14CoinExists([old, { cluster: "mainnet", status: "live", createdAt: cut + 60_000 }]), true);
    assert.equal(tier14CoinExists([old, { cluster: "mainnet", status: "draft", createdAt: cut + 60_000 }]), false);
    assert.equal(tier14CoinExists([old, { cluster: "devnet", status: "live", createdAt: cut + 60_000 }]), false);
    assert.match(read("src/app/burnticker/_components/SiteFooter.tsx"), /footerFeeLine\(BURNTICKER_DEV_FEE_BPS, \{ tier14Live: tier14LiveNow\(\), tierPinPending: DEPLOYED_TIER_PIN_PENDING \}\)/);
    assert.match(read("src/app/burnticker/trust/page.tsx"), /t\.feeTiersLine \?\? BOTH_TIERS_LINE/);
    assert.match(read("src/app/api/burnticker/trust/route.ts"), /try \{ tier14Live = tier14CoinExists\(p\.registry\.tokens\(\)\); \}[\s\S]*deltaCache: TRUST_DELTA_CACHE, tier14Live \}\)/);
  });
});

describe("HB-76: a one-shot back-test", () => {
  test("counts qualifying days and at most one burn, never 1/2/5% rows", () => {
    const l = oneShotBacktestLines("2026-10-05", "2026-10-11", ["2026-10-10", "2026-10-11"]);
    assert.deepEqual(l, ["In the catalogue's saved sample, with readings from 5 October 2026 to 11 October 2026, 2 days qualified. This rule burns once, so it would have burned one time, on 10 October 2026, and then ended."]);
    const none = oneShotBacktestLines("2026-10-05", "2026-10-11", []);
    for (const s of [...l, ...none]) { plain(s); assert.doesNotMatch(s, /At 1%|At 2%|At 5%/); }
    assert.match(read("src/lib/burnticker/projection.ts"), /if \(f >= 1 \|\| NEXT_EVENT_ONE_SHOT_RE\.test\(rule\.series\)\)/);
  });
});

describe("HB-77: the presets sentence lists the radios shown", () => {
  test("100 or 50% with dispersal", () => {
    assert.equal(presetRowLabel("oneShotDispersal"), "100% or 50%");
    assert.match(read("src/lib/burnticker/launchReview.ts"), /presetRowLabel\(shareShapeOf\(locked\.rule, \{ dispersal: webDispersalOn\(env, o\.root\) \}\)\)/);
  });
});

describe("HB-78: the flippening states one end", () => {
  test("the burn step, the end block and the review share FLIP_REST_LINE", () => {
    plain(FLIP_REST_LINE);
    assert.match(read("src/lib/burnticker/derby/spec.ts"), /Runs for \$\{d\.season\.days\} days\. \$\{FLIP_REST_LINE\}/);
    assert.match(read("src/lib/burnticker/describe.ts"), /r\.derby\.flip\) return mk\("pair-winner", FLIP_REST_LINE, VOID\)/);
  });
});

describe("HB-79: the pair check is bounded and the past-burns block is never silent", () => {
  test("lines by state", () => {
    assert.deepEqual(pastBurnsLines({ loading: true, error: null, projection: null }), [PAST_BURNS_WORKING]);
    assert.deepEqual(pastBurnsLines({ loading: false, error: "the review could not be read (HTTP 503)", projection: null }), [PAST_BURNS_UNAVAILABLE]);
    assert.deepEqual(pastBurnsLines({ loading: false, error: null, projection: { available: false, lines: [], reason: "There is no saved sample of this source to project from." } }), ["There is no saved sample of this source to project from."]);
    assert.deepEqual(pastBurnsLines({ loading: true, error: null, projection: { available: true, lines: ["a"], reason: null } }), ["a"]);
    plain(PAST_BURNS_WORKING); plain(PAST_BURNS_UNAVAILABLE);
    const tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx");
    assert.match(tile, /setTimeout\(\(\) => ctl\.abort\(\), PAIR_CHECK_TIMEOUT_MS\)/); assert.match(tile, /data-past-burns/);
    assert.match(read("src/lib/burnticker/api/derby.ts"), /the read took longer than 8 seconds/);
  });
});

describe("HB-81: cross-rule copy batch", () => {
  test("D1: a count's tie row has no market or pair words", () => { plain(SIM_NO_TIE_COUNT); assert.doesNotMatch(SIM_NO_TIE_COUNT, /side|voided/); });
  test("D4: the self-burn line has losing words only for a rule that can lose", () => {
    assert.equal(selfEndLineFor(firstPartyRule("spc.tornadoes:US", 0.02)), SELF_ON_END_LINE);
    assert.equal(selfEndLineFor({ oracle: "polymarket", series: null } as never), SELF_ON_LOSS_LINE);
    plain(SELF_ON_END_LINE);
    assert.match(read("src/app/burnticker/launch/EndChoicePicker.tsx"), /model\.selfLine \?\? SELF_ON_LOSS_LINE/);
  });
  test("D5: item 218 on a one-time coin does not say nothing ends the rule", () => {
    const s = edgeCaseFor(218, { oneShot: true })!;
    assert.ok(s.endsWith(ITEM_218_ONE_SHOT_TAIL)); assert.doesNotMatch(s, /nothing ends the rule/); plain(s);
    assert.match(edgeCaseFor(218)!, /nothing ends the rule on its own today/);
  });
  test("R1: the separate season pair lists neither 76 nor 168", () => {
    assert.match(page, /const separatePair = pairOn && pairMode === "season" && !meetingsOn && !settledPick && !elPick;/);
    assert.match(page, /pairOn && !separatePair && \(!elPick \|\| settledPick\) \? \[76\]/);
    assert.match(page, /otherCoin: \(pairOn && !separatePair\)/);
  });
  test("D2 and D3 are already fixed in this tree", () => {
    for (const f of ["src/lib/burnticker/guidedLaunch.ts", "src/app/burnticker/launch/page.tsx"]) assert.doesNotMatch(read(f), /Only two linked coins can name each other/);
    assert.match(page, /upfrontLines\(RAISE_PRESETS_SOL, \{ team: guide\.follow === "team", end: pairOn \? null : endA, pair: pairOn, perpetual: !pairOn && windowKindOf\(rule\) === "perpetual", endLine: pairOn \? endFact\.replace\(\/\\n\/g, " "\) : null \}\)/);
  });
});

describe("HS-29: receipt counts say which is which", () => {
  test("recorded results and burns on chain", () => {
    assert.equal(receiptsCountLine(1, 0), "1 recorded result, 0 burns on chain");
    assert.equal(receiptsCountLine(2, 1), "2 recorded results, 1 burn on chain");
    assert.equal(receiptsCountShort(1, 0), "1 recorded, 0 on chain");
    assert.equal(receiptsLine({ receipts: { count: 0, label: "in 2026", recorded: 1 } }), "receipts in 2026: 1 recorded, 0 on chain");
    assert.equal(receiptsLine({ receipts: { count: 2, label: "in 2026", recorded: 2 } }), "receipts in 2026: 2");
    clean(receiptsCountLine(1, 0));
    assert.match(read("src/lib/burnticker/api/v1.ts"), /receiptsLine: receiptsCountLine\(rows\.length/);
  });
});
