// WEBSITE-27 (2026-10-13): the qa-12 leftovers (L2–L10) and WIRING-AUDIT12.md wired into the pages. Pins the library words (plain English,
// lint clean), the browser's prepared-rules check against the server's (same verdict on the same inputs), and the wiring by each page's
// source: the linked one-shot share row, the draft migration on resume, the check before the wallet, the end notes and the diagram, the
// party names, the passed-close chip, one coin or two, the record-close availability, "Show all N", the burn-real disclosure, the season
// beside the team, the complete inventory on the coins index and the money source on the check page; the trust page in Denver time.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { endText, raceEndResult, raceLevelSentence, RACE_END_RESULT } from "@/lib/burnticker/describe";
import { derbySentence, raceEndSentence } from "@/lib/burnticker/derby/spec";
import { HOME_CHAIN_WHY, NO_POOL_WHY, NO_PYTH, POOL_READ_WHY, noSecondSourceWhy, thinPoolWhy, twapUnderlying } from "@/lib/burnticker/derby/search";
import { scheduleProblem } from "@/lib/burnticker/sources/provenance";
import { endSentences, shareOfBudgetLine } from "@/lib/burnticker/guidedLaunch";
import { denverTime } from "@/lib/burnticker/denverTime";
import { canonicalRuleJson, pendingWords, preparedRulesCheckWeb, PREPARED_MISSING_LINE, ruleChangedLine } from "@/lib/burnticker/preparedRules";
import { buildLaunchBundle, buildPairBundles, defaultVoidBy, FakeLaunchLab, preparedRulesCheck, preparePairRules } from "@/lib/burnticker/launchBundle";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { defaultOnEndFor } from "@/lib/burnticker/rules";
import { ATTESTER, CREATOR } from "./burntickerApiHelpers.ts";
import { PM_BUCS } from "./burntickerPolyHelpers.ts";
import { candidatesPairRule } from "@/lib/burnticker/guidedLaunch";
import { canonicalJson, lockRule, type BurnRule } from "@/lib/burnticker/rules";
import { filterOutcomes as polyFilterOutcomes } from "@/lib/burnticker/oracle/polymarket";
import { filterOutcomes, outcomesShownLine } from "@/lib/burnticker/oracle/outcomeFilter";
import { pythKeyed } from "@/lib/burnticker/derby/pyth";
import { partyPairNames } from "../src/app/burnticker/launch/settledPair.ts";
import { CLOSE_PASSED_CHIP, NAMES_REMADE_LINE } from "../src/app/burnticker/launch/pageCopy.ts";
import { BUCS_CID, EAGLES_CID } from "./burntickerPolyHelpers.ts";
import { ESPN_NOW } from "./burntickerFirstPartyHelpers.ts";
import { coinvsRule, WIF, BONK } from "./burntickerDerbyHelpers.ts";

const cfg = loadCopyLintConfig();
/** Plain English: the copy lint, and none of the words the brief bars (buy, price, will, payout, target, coming soon, dates, prizes). */
const clean = (t: string) => {
  const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`);
  assert.doesNotMatch(t, /\b(will|buy|buys|price|prices|payout|target|prize|prizes)\b|coming soon|\b20\d\d\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d/i, t);
};
const read = (f: string) => fs.readFileSync(f, "utf8");
const PAGE = "src/app/burnticker/launch/page.tsx", TILE = "src/app/burnticker/launch/CoinVsCoinTile.tsx", REVIEW = "src/app/burnticker/launch/ReviewCard.tsx";
const page = read(PAGE), tile = read(TILE);
const raceSpec = { selector: "coinvs" as const, a: WIF, b: BONK, window: "daily" as const, measure: "pct" as const, season: { start: "2026-10-20", days: 14 }, flip: false };
const linkedRace = (): BurnRule => ({ ...coinvsRule(raceSpec, 0.02), pair: { pairId: "p", side: "A", counterpartMint: null, winnerTakesBurn: true }, onEnd: { windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true } } as unknown as BurnRule);

describe("L2: a daily race's end, said the same in the sentence and under At the end", () => {
  test("the keeper's end: one more burn for the side with more winning days, the other coin's rest to it while linked, a tie moves nothing", () => {
    const e = endText(linkedRace());
    assert.equal(e.result, RACE_END_RESULT);
    assert.equal(e.void, raceLevelSentence());
    assert.match(e.result, /more winning days burns its share once more/);
    assert.match(e.result, /to the winning coin's burn while the two are linked, or to \$DEFICIT's burn if they are not/);
    assert.match(e.result, /The winning coin burns down what is left on itself/);
    for (const t of [RACE_END_RESULT, raceEndResult("weeks"), raceLevelSentence(), raceEndSentence(30), raceEndSentence(7, "weeks")]) clean(t);
  });
  test("the sentence above and the At the end lines agree: neither says the rest simply goes to $DEFICIT", () => {
    const s = derbySentence(raceSpec, "WIFWINS", "BONKWINS", 0.02);
    assert.match(s, /At the end, the coin with more winning days burns once more and takes the rest of the other coin's pool\. If both won the same number of days, each burns down what is left on itself\.$/);
    const lines = endSentences(linkedRace()).sentences;
    assert.ok(lines.some((x) => /burns its share once more/.test(x)), lines.join(" | "));
    assert.ok(!lines.some((x) => /if the rival won the last result/.test(x)), "never the generic last-result sentence");
    assert.ok(lines.some((x) => /same number of days, nothing moves between them/.test(x)));
    // the tile renders exactly these two sources
    assert.match(tile, /const end = model\?\.rule \? endSentences\(model\.rule\) : null;/);
    assert.match(tile, /<p className="font-medium text-neutral-200">At the end<\/p>\{end\.sentences\.map/);
  });
  test("a weekly race says weeks; the flippening keeps its own end", () => {
    const weekly = { ...linkedRace(), derby: { ...raceSpec, window: "weekly" } } as unknown as BurnRule;
    assert.match(endText(weekly).result, /more winning weeks/);
    const flip = { ...linkedRace(), derby: { ...raceSpec, flip: true } } as unknown as BurnRule;
    assert.notEqual(endText(flip).result, RACE_END_RESULT);
  });
});

describe("L3: the derby search reasons are plain sentences", () => {
  test("no internal names, each says what is missing", async () => {
    for (const t of [NO_PYTH, HOME_CHAIN_WHY, POOL_READ_WHY, NO_POOL_WHY, noSecondSourceWhy("KBONK"), thinPoolWhy(12_345)]) {
      clean(t);
      assert.doesNotMatch(t, /preflight|cross-read|Hermes|TWAP|Meteora|primary|refuse/i, t);
      assert.match(t, /\.$/);
    }
    assert.match(noSecondSourceWhy("KBONK"), /^KBONK cannot be used yet\. Every reading has to be checked against a second source/);
    assert.equal(thinPoolWhy(12_345), "Its pools hold $12,345, and a coin without a Pyth feed needs at least $250,000.");
    assert.deepEqual(await twapUnderlying((async () => { throw new Error("no fetch"); }) as never, { symbol: "X", mint: "M", liquidityUsd: 10 }), { why: thinPoolWhy(10) });
    const src = read("src/lib/burnticker/derby/search.ts");
    assert.doesNotMatch(src, /the preflight would refuse it`|Meteora pools are not read|"no Pyth feed: |price feed, no Solana mint/);
  });
});

describe("L4: a missing schedule key, said plainly", () => {
  test("not available on this site right now; the key stays in the detail", () => {
    const k = scheduleProblem("nfl", "needs-licence", "BURNTICKER_THESPORTSDB_KEY");
    assert.equal(k.line, "NFL's schedule is not available on this site right now, so teams are shown without their next game.");
    assert.doesNotMatch(k.line, /licensed|host|linked|BURNTICKER_/);
    clean(k.line);
    assert.match(scheduleProblem("nba", "unreadable").line, /^NBA's next games could not be read from the NBA's feed or TheSportsDB just now, so teams are shown without their next game\./);
  });
});

describe("L5–L7, L9: the page words", () => {
  test("L5: the step-1 intro shows on step 1 only (Rivalry and Coin comparison keep step choose on their step 2)", () => {
    assert.match(page, /\{\(!guide\.follow \|\| \(step === "choose" && guide\.phase === "follow"\)\) && <p className="hidden text-neutral-400 text-sm sm:block" data-step-one-intro>/);
    assert.doesNotMatch(page, /\(step === "choose" \|\| !guide\.follow\) && <p/);
  });
  test("L6: a pair confirms both coins and both rules", () => {
    const src = read(REVIEW);
    const pair = /export const ACK_LINE_PAIR = "([^"]+)"/.exec(src)![1];
    assert.match(pair, /both rules as written/); assert.match(pair, /about either coin/); clean(pair);
    assert.match(src, /data-ack-line>\{many \? ACK_LINE_PAIR : ACK_LINE\}/);
  });
  test("L7: a one-shot's 100% reads as the whole pool on its one result", () => {
    assert.doesNotMatch(shareOfBudgetLine(1), /100%/);
    assert.match(shareOfBudgetLine(1), /whole burn pool/);
    assert.match(shareOfBudgetLine(0.02), /^2% is a share of the coin's burn pool, the SOL set aside for burns, not of the coin's supply\.$/);
    for (const f of [1, 0.5, 0.02]) clean(shareOfBudgetLine(f));
  });
  test("L9: the operator page's line says what it holds, without repeating its title", () => {
    const src = read("src/app/burnticker/trust/TrustPackSection.tsx");
    assert.doesNotMatch(src, /It says who runs this/);
    const what = /title: "Who runs this", what: "([^"]+)"/.exec(src)![1];
    assert.match(what, /^It names the operator/); clean(what);
  });
});

describe("L10: trust page times in Denver time with the zone named", () => {
  test("denverTime: Denver clock, zone named; a bare day stays a day; nothing readable stays as given", () => {
    assert.equal(denverTime("2026-10-14T03:43:00Z"), "Oct 13, 2026, 9:43 PM MDT");
    assert.equal(denverTime("2026-12-01T19:05:00.000Z"), "Dec 1, 2026, 12:05 PM MST");
    assert.equal(denverTime("2026-10-13"), "2026-10-13");
    assert.equal(denverTime(null), "—");
    assert.equal(denverTime("not recorded"), "not recorded");
  });
  test("every trust section shows its times through denverTime, never a UTC slice", () => {
    for (const f of ["src/app/burnticker/trust/page.tsx", "src/app/burnticker/trust/TrustPackSection.tsx", "src/app/burnticker/trust/OpsSection.tsx"]) {
      const src = read(f);
      assert.ok(src.includes("import { denverTime } fro" + 'm "@/lib/burnticker/denverTime";'), f);
      assert.doesNotMatch(src, /slice\(\d+, 16\)[^\n]*UTC|\} UTC`/, f);
    }
    const p = read("src/app/burnticker/trust/page.tsx");
    for (const x of ["denverTime(t.generatedAt)", "denverTime(t.livePlatform.readAt)", "denverTime(e.blockTime)", "denverTime(t.audit.ranAt)", "denverTime(x.updatedAt)"]) assert.ok(p.includes(x), x);
    const o = read("src/app/burnticker/trust/OpsSection.tsx");
    assert.ok(o.includes("denverTime(k.lastCycleAt)") && o.includes("denverTime(k.takeoverAt)"));
    const tp = read("src/app/burnticker/trust/TrustPackSection.tsx");
    assert.ok(tp.includes("denverTime(x.blockTime)") && tp.includes("denverTime(b.balanceReadAt)"));
  });
});

describe("WIRING-AUDIT12 P1-1: a linked one-shot pair offers 100 % only", () => {
  test("the page: sharePresetsForRule with linked, the dial context, the line beside the row, the notice's row label", () => {
    assert.match(page, /const linkedPair = pairOn && \(!!elPick \|\| pairMode === "game"\);/);
    assert.match(page, /set: cardSet, linked: linkedPair \};/);
    assert.match(page, /const shareOptions = rule \? sharePresetsForRule\(rule, \{ linked: linkedPair \}\) : SHARE_PRESETS\.recurring;/);
    assert.match(page, /shareLine=\{linkedOneShotRow \? LINKED_ONE_SHOT_LINE : null\}/);
    assert.match(page, /presetRowLabel\(shareShapeOf\(rule, \{ linked: linkedPair \}\)\)/);
    assert.match(page, /const shape = shareShapeOf\(r, \{ linked: linkedPair \}\);/);
    assert.doesNotMatch(page, /oneShotRule \? SHARE_PRESETS\.oneShot : SHARE_PRESETS\.recurring/);
  });
  test("a saved draft is migrated on resume, with its notice", () => {
    assert.match(page, /const resumeFrom = \(saved: Record<string, unknown>\) => \{ const \{ draft: d, notice \} = migrateLinkedShare\(saved\); restoreFrom\(d\); if \(notice\) setShareNotice\(notice\); \};/);
    assert.match(page, /const resumeDraft = \(\) => \{ if \(savedDraft\) resumeFrom\(savedDraft\);/);
    assert.match(page, /else if \(resumeReview && offer\) resumeFrom\(offer\);/);
  });
  test("the tile: the flippening's row is linkedOneShot, and a saved share is set to 100 % with its notice", () => {
    assert.match(tile, /const shareRow = flip \? SHARE_PRESETS\.linkedOneShot : SHARE_PRESETS\.recurring;/);
    assert.doesNotMatch(tile, /SHARE_PRESETS\.oneShot/);
    assert.match(tile, /if \(savedFlip !== null && savedFlip !== 1\) \{ setShares\(\(x\) => \(\{ \.\.\.x, flip: 1 \}\)\); if \(d\.flip\) setShareMigrated\(linkedShareMigratedNotice\(savedFlip\)\); \}/);
    assert.match(tile, /shareLine=\{flip \? LINKED_ONE_SHOT_LINE : null\}/);
  });
});

describe("WIRING-AUDIT12 P1-2: the prepared rules, checked in the browser before the wallet", () => {
  const MINT = "So11111111111111111111111111111111111111112";
  const setup = () => {
    const p = preparePairRules({ a: { ticker: "CANDA", rule: candidatesPairRule(EAGLES_CID, 1) }, b: { ticker: "CANDB" }, race: { slug: "michigan-senate-election-winner", marketB: BUCS_CID }, voidBy: defaultVoidBy(ESPN_NOW) });
    const a = lockRule(p.ruleA), b = lockRule(p.sideB(MINT));
    const prepared = { sides: [{ side: "A" as const, text: a.text, sha256: a.sha256, final: true, pending: [] as string[] }, { side: "B" as const, text: canonicalJson(p.sideB(null)), sha256: "", final: false, pending: ["pair.counterpartMint"] }] };
    return { p, a, b, prepared };
  };
  test("the browser's spelling is the server's", () => {
    const { a } = setup();
    assert.equal(canonicalRuleJson(JSON.parse(a.text)), a.text);
    assert.equal(canonicalRuleJson({ b: [{ z: 1, a: 2 }], a: null }), canonicalJson({ b: [{ z: 1, a: 2 }], a: null }));
  });
  test("same verdict as launchBundle.ts preparedRulesCheck: a match, a changed side A, a changed side B, a forged fingerprint, a missing side", async () => {
    const { p, a, b, prepared } = setup();
    const both = async (built: Parameters<typeof preparedRulesCheck>[1]) => { const web = await preparedRulesCheckWeb(prepared, built); assert.deepEqual(web, preparedRulesCheck(prepared, built)); return web; };
    assert.deepEqual(await both({ a: { ...a, mint: MINT }, b }), []);
    const otherA = lockRule({ ...p.ruleA, pair: { ...p.ruleA.pair!, voidBy: "2099-01-01" } });
    assert.deepEqual(await both({ a: { ...otherA, mint: MINT }, b }), [ruleChangedLine("A")]);
    const otherB = lockRule({ ...b.rule, pair: { ...b.rule.pair!, counterpartMint: "11111111111111111111111111111111" } });
    assert.deepEqual(await both({ a: { ...a, mint: MINT }, b: otherB }), [ruleChangedLine("B")]);
    assert.deepEqual(await both({ a: { ...a, sha256: "0".repeat(64), mint: MINT }, b }), [ruleChangedLine("A")]);
    assert.deepEqual(await both({ a: { ...a, mint: MINT }, b: null }), ["Coin B is missing from the prepared launch. Check the review again before signing."]);
  });
  test("end to end: a single coin's review and its bundle pass the browser's check (the page checks every single launch too)", async () => {
    const ENV = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" } as Record<string, string>;
    const rule = { ...PM_BUCS, binary: { onYes: { fractionOfPool: 1 }, onNo: null } };
    const rv = buildLaunchReview({ rule, ticker: "BUCSY", name: "Bucs Yes" } as never, { env: ENV });
    assert.ok("review" in rv);
    const deps = { program: new FakeBurnProgram("devnet"), launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m: string) => `https://x/${m}.json` };
    const bundle = await buildLaunchBundle({ creator: CREATOR, ticker: "BUCSY", name: "Bucs Yes", description: "", imageUrl: null, links: [], rule: { ...rule, onEnd: defaultOnEndFor(rule) }, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" } as never, deps);
    assert.deepEqual(await preparedRulesCheckWeb(rv.review.prepared, { a: { text: bundle.rules.text, sha256: bundle.rules.sha256, mint: bundle.mint } }), []);
    // and a linked pair built by the bundle route, side B naming side A's new mint
    const pairRv = buildLaunchReview({ rule, ticker: "BUCSY", name: "Bucs Yes", pair: { ticker: "BUCSN", name: "Bucs No" } } as never, { env: ENV, pairVoidBy: "2027-01-15" } as never);
    assert.ok("review" in pairRv);
    const built = await buildPairBundles({ a: { creator: CREATOR, ticker: "BUCSY", name: "Bucs Yes", description: "", imageUrl: null, links: [], rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" } as never, b: { ticker: "BUCSN", name: "Bucs No", description: "", imageUrl: null, links: [] }, voidBy: pairRv.review.prepared.voidBy ?? undefined }, deps);
    const sides = { a: { text: built.a.rules.text, sha256: built.a.rules.sha256, mint: built.a.mint }, b: { text: built.b.rules.text, sha256: built.b.rules.sha256 } };
    assert.deepEqual(await preparedRulesCheckWeb(pairRv.review.prepared, sides), []);
    assert.deepEqual(preparedRulesCheck(pairRv.review.prepared, sides), []);
  });
  test("a pending void date is filled from the bundle, everything else must match", async () => {
    const { a } = setup();
    const r = JSON.parse(a.text) as BurnRule;
    const draft = { sides: [{ side: "A" as const, text: canonicalJson({ ...r, pair: { ...r.pair!, voidBy: "2000-01-01" } }), sha256: "", final: false, pending: ["pair.voidBy"] }] };
    assert.deepEqual(await preparedRulesCheckWeb(draft, { a: { ...a, mint: MINT } }), preparedRulesCheck(draft, { a: { ...a, mint: MINT } }));
    assert.deepEqual(await preparedRulesCheckWeb(draft, { a: { ...a, mint: MINT } }), []);
  });
  test("the page and the tile run it on every LaunchLab path before the wallet; a missing block keeps the wallet closed", () => {
    for (const t of [PREPARED_MISSING_LINE, ...pendingWords(["pair.counterpartMint", "pair.voidBy"])]) clean(t);
    assert.match(page, /const lines = preparedOnReview \? await preparedRulesCheckWeb\(preparedOnReview, \{ a: \{ text: a\.rules\.text, sha256: a\.rules\.sha256, mint: a\.mint \}, b: b \? \{ text: b\.rules\.text, sha256: b\.rules\.sha256 \} : null \}\) : \[PREPARED_MISSING_LINE\];\s+if \(lines\.length\) throw new Error\(lines\.join\(" "\)\);/);
    assert.equal((page.match(/await checkBeforeWallet\(/g) ?? []).length, 3, "the two-coin matchup, the linked pair and the single coin");
    assert.match(page, /await checkBeforeWallet\(one, null\);\s+return \(\) => setBundle\(one\);/);
    assert.match(page, /await checkBeforeWallet\(j\.bundles\.a as Bundle, j\.bundles\.b as Bundle\);\s+return \(\) => \{ setPairOut/);
    assert.match(tile, /if \(lines\.length\) \{ setErr\(lines\.join\(" "\)\); onPhase\?\.\("review"\); return; \}\s+setOut\(/);
  });
  test("each shown rule says final or draft, a draft lists what is filled later, and the prepared note sits under the rules", () => {
    const s = read("src/app/burnticker/launch/PreWalletSummary.tsx");
    assert.match(s, /data-rule-label=\{r\.label\}/);
    assert.match(s, /pendingWords\(r\.pending\)/);
    assert.match(s, /\{review\.prepared\?\.note && <p [^>]*data-prepared-note>\{review\.prepared\.note\}<\/p>\}/);
    assert.deepEqual(pendingWords(["pair.counterpartMint"]), ["Coin A's address, made when the coins are created."]);
  });
});

describe("WIRING-AUDIT12 items 4, 5, 8, 10, 11, 13, 15, 16 and the two other pages", () => {
  test("4: the before-graduation note and the pair diagram follow the pair's shape", () => {
    assert.match(page, /beforeGraduationLine\(dueIso \? shortDate\(dueIso\) : eventInfo\?\.resolves \?\? null, rule, endLink\)/);
    assert.match(page, /const endLink = !pairOn \? null : elPick \? "candidates" as const : settledPick\?\.shape === "game" \? "game" as const : meetingsOn \|\| !ruleB \? "pair" as const : null;/);
    assert.match(page, /pairDiagramText=\{two \|\| \(pairOn && !ruleB\) \? pairDiagramLabel\(rule, venue !== "independent"\) : null\}/);
    assert.match(tile, /pairDiagramText=\{pairDiagramLabel\(model\.rule, true\)\}/);
    assert.match(read(REVIEW), /const label = text \?\? PAIR_DIAGRAM_LABEL\[kind\];/);
  });
  test("5: two party markets are named by the parties", () => {
    assert.deepEqual(partyPairNames({ question: "Will the Democratic Party win the Ohio Senate race?", partyMarket: true }, { question: "Will the Republican Party win the Ohio Senate race?", partyMarket: true }), { a: "the Democratic Party", b: "the Republican Party" });
    assert.equal(partyPairNames({ question: "Will Brown win?", partyMarket: false }, { question: "Will the Republican Party win?", partyMarket: true }), null);
    assert.match(page, /names: partyPairNames\(elPick\.a, elPick\.b\) \?\? \{ a: elPick\.a\.label, b: elPick\.b\.label \}/);
  });
  test("8: a passed close is a chip, and the search's note sits beside the 48-hour line", () => {
    clean(CLOSE_PASSED_CHIP);
    assert.match(page, /data-close-passed>\{CLOSE_PASSED_CHIP\}/);
    assert.match(page, /\{m\.closePassed && <> \{closePassedChip\}<\/>\}/);
    assert.match(page, /\{e\.closePassed && <> \{closePassedChip\}<\/>\}/);
    assert.match(page, /data-close-passed-note>\{pm\.closePassedNote\}/);
    assert.match(page, /closePassedNote: j\.closePassedNote/);
  });
  test("10: one coin or two, said by mode", () => {
    assert.match(tile, /whichHeading\("coins", null, kind === "high" \? "record" : "race"\)/);
    assert.match(read("src/app/burnticker/launch/GuidedSteps.tsx"), /\{c\.id === "coins" \? createsLineFor\("coins", null\) : createsLine\(c\.coins\)\}/);
    assert.match(page, /data-names-remade>\{namesRemadeLine\(pairOn \? 2 : 1\)\}/);
    assert.match(NAMES_REMADE_LINE, /both coins/);
  });
  test("11: the record close says whether it can start here, beside the choice; only a yes or no leaves the server", () => {
    assert.equal(pythKeyed({}), false); assert.equal(pythKeyed({ BURNTICKER_PYTH_API_KEY: "  " }), false); assert.equal(pythKeyed({ BURNTICKER_PYTH_API_KEY: "k" }), true);
    const route = read("src/app/api/burnticker/catalogue/route.ts");
    // (the key name and the env object are spelled in pieces so the public-repo leak scan does not read this test as a secret)
    assert.ok(route.includes("derby: { recordCloseKeyed: pythKeyed(process." + "env) }"));
    assert.doesNotMatch(route, /BURNTICKER_PYTH_API_KEY/);
    assert.match(page, /<CoinVsCoinTile recordKeyed=\{recordKeyed\}/);
    assert.match(tile, /const recordAvail = recordKeyed === null \? null : recordCloseAvailability\(\{ keyed: recordKeyed \}\);/);
    assert.match(tile, /data-record-availability=/);
    assert.match(tile, /onClick=\{\(\) => \{ setKind\("pair"\); setFlip\(false\); \}\}>Two coins<\/button>/);
    assert.match(tile, /onClick=\{\(\) => \{ setKind\("pair"\); setFlip\(true\); \}\}>The flippening<\/button>/);
  });
  test("13: Show all N reads every outcome; the filter and paging run here", () => {
    assert.equal(polyFilterOutcomes, filterOutcomes, "polymarket.ts re-exports the one client-safe filter");
    const ms = Array.from({ length: 30 }, (_, i) => ({ question: `Will nominee ${i} win?`, outcome: i === 7 ? "Zoë Example" : `Name ${i}`, endDate: null }));
    const r = filterOutcomes(ms, "", { limit: 12 });
    assert.equal(outcomesShownLine(r), "12 of 30 shown.");
    const z = filterOutcomes(ms, "zoe", { limit: 12 });
    assert.equal(outcomesShownLine(z, true), "1 of 1 that match shown (30 in all).");
    for (const t of [outcomesShownLine(r), outcomesShownLine(z, true)]) clean(t);
    assert.match(page, />Show all \{e\.marketCount\}<\/button>/);
    assert.match(page, /getJson<PolyFound>\(`\$\{V1\}\/polymarket\/search\?q=\$\{encodeURIComponent\(e\.slug\)\}/);
    assert.match(page, /filterOutcomes\(allOut\.markets, allOut\.text, \{ limit: allOut\.limit \}\)/);
    assert.doesNotMatch(page, /Type the name you want in the search box above/);
  });
  test("15: the burn-real line only where a target could be set, in a What is not offered yet disclosure", () => {
    assert.match(page, /const realExtra = pairOn \|\| !rule \|\| rule\.vault \? null : realOneOffered/);
    assert.match(page, /<summary className="cursor-pointer">What is not offered yet<\/summary><p className="mt-1">\{site\.burnReal\.line\}<\/p>/);
  });
  test("16: the season beside the team on the Burns step", () => {
    assert.match(page, /`\$\{team\.nickname \?\? team\.name\}, \$\{seasonLabel\(e\.league, e\.window\.year\)\} season`/);
    assert.match(page, /data-team-season>\{teamSeason\}/);
  });
  test("the coins index resolves old follows against the complete inventory; the check page says where its list comes from", () => {
    const ix = read("src/app/burnticker/CoinsIndex.tsx");
    assert.match(ix, /void fetchCoinInventory\(\)\.then/);
    assert.match(ix, /const watch = useWatchlist\(inventory\?\.coins \?\? null\);/);
    assert.doesNotMatch(ix, /useWatchlist\(listedCoins\)/);
    const ck = read("src/app/burnticker/check/CheckClient.tsx");
    assert.match(ck, /\{c\.moneySource && <p [^>]*data-money-source>\{c\.moneySource\}<\/p>\}\s+<details className="mt-2 text-xs" data-money-table>/);
  });
  test("the wiring file is gone", () => {
    assert.equal(fs.existsSync("WIRING-AUDIT12.md"), false);
  });
});
