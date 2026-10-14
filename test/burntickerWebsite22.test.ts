// WEBSITE-22 (2026-10-13): QA pass 9 (the owner's walk of six coin types on publishes 24 to 26) and audit 10 (publish 22), the launch
// pages' items. Pure pieces are tested directly (guidedLaunch.ts, projection.ts, hazards.ts); the page wiring is pinned by its source;
// every new sentence passes the copy lint, says no "will", "buy" or "price", carries no date and never names ESPN.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { BurnRule } from "@/lib/burnticker/rules";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { teamSeries } from "@/lib/burnticker/sources/espn";
import { hazardPatternOptions, hazardSwap } from "@/lib/burnticker/hazards";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { reviewProjection, projectionShares } from "@/lib/burnticker/projection";
import { OPERATOR_SHARE_LINE, PAIR_OPERATOR_SHARE_LINE } from "@/lib/burnticker/feeShareLine";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import {
  DESCRIPTION_ONE_PARAGRAPH, IMAGE_RIGHTS_REQUIRED, KEPT_PROFILE_FRESH, KEPT_PROFILE_REUSE, MARKET_NO_LABEL, MARKET_NO_SENTENCE, MARKET_YES_LABEL, MARKET_YES_SENTENCE,
  PAIR_COST_EXCLUSIONS, PAIR_DIAGRAM_LABEL, WARN_A, WARN_B, activeUnit, budgetCopy, eventForSide, followForRule, keptProfileLine, keptProfileParts, lpDisclosureFor,
  noteProblemOf, notSquareLine, oneGameShare, oneParagraph, partyMarketWarning, patternWords, pickDescribesRule, profileFieldProblems, profileMoreLabel, renderWarnings,
  reviewBlockers, shareOfBudgetLine, squareCrop, stablePatternOptions, teamLine, triggerText, unitPhrase, whichAnswer,
} from "@/lib/burnticker/guidedLaunch";
import { DEBT_RULE } from "./burntickerHelpers.ts";

const cfg = loadCopyLintConfig();
const plain = (t: string, where = t) => {
  assert.deepEqual(lintCopy(t, cfg).hits.map((h) => `${h.phrase} (${h.rule})`), [], `${where}: ${t}`);
  assert.doesNotMatch(t, /\bwill\b|\bbuy\b|\bprice\b|coming soon|\bESPN\b/i, `${where}: ${t}`);
  assert.doesNotMatch(t, /\b20\d\d-\d\d-\d\d\b/, `${where} carries a date: ${t}`);
};
const read = (f: string) => fs.readFileSync(f, "utf8");
const page = read("src/app/burnticker/launch/page.tsx"), steps = read("src/app/burnticker/launch/GuidedSteps.tsx"), card = read("src/app/burnticker/launch/ReviewCard.tsx");
const fields = read("src/app/burnticker/launch/ProfileFields.tsx"), tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx"), coinCard = read("src/app/burnticker/_components/CoinCard.tsx");
const NOW = Date.parse("2026-08-15T12:00:00Z");
const ENV = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" } as Record<string, string>;
const quake = (series: string): BurnRule => firstPartyRule(series, series.startsWith("usgs.quakenext") ? 1 : 0.02);

describe("QA 9 item 1: a natural disaster's burn-pattern cards are one stable set and the chosen card is the rule's", () => {
  test("per event and next event offer the same cards in the same order; fade moves to the other form, never off the screen", () => {
    const every = quake("usgs.quakes:6"), once = quake("usgs.quakenext:7");
    const a = hazardPatternOptions(every, NOW), b = hazardPatternOptions(once, NOW);
    assert.equal(a.preselected, "every"); assert.equal(b.preselected, "once", "a next-event series is the Once card");
    const sa = stablePatternOptions(a.options, b.options), sb = stablePatternOptions(b.options, a.options);
    assert.deepEqual(sa.map((o) => o.id), sb.map((o) => o.id), "the same cards in the same order");
    assert.deepEqual(sa.filter((o) => o.available).map((o) => o.id), sb.filter((o) => o.available).map((o) => o.id), "the same cards offered from either form");
    assert.ok(sb.find((o) => o.id === "fade")!.available, "the fade card stays on the next-event form (it switches to the per-event form)");
    assert.ok(!sb.find((o) => o.id === "winner")!.available);
    assert.ok(hazardSwap("usgs.quakenext:7", "every", NOW) && "series" in hazardSwap("usgs.quakenext:7", "every", NOW)!);
  });
  test("the page reads the chosen card from hazards.ts, keeps the hazard words, and moves fade to the per-event form first", () => {
    assert.match(page, /const curPattern: PatternId \| null = guide\.follow === "disaster" \? hazardPatternOptions\(rule, Date\.now\(\)\)\.preselected/);
    assert.match(page, /return stablePatternOptions\(cur\.options, sib && "series" in sib \? hazardPatternOptions\(hazardRule\(sib\.series\), now\)\.options : null\);/);
    assert.match(page, /const options0 = guide\.follow === "disaster" \? po\.options : po\.options\.map/, "the hazard labels are never overwritten by the generic words");
    assert.match(page, /const back = rule\.series \? hazardSwap\(rule\.series, "every", Date\.now\(\)\) : null;[\s\S]{0,260}setWantInverse\("on"\)/);
  });
});

describe("audit 10 items 1 and 2: the source's words follow the active rule", () => {
  test("the event card says the NO outcome once the coin burns on NO", () => {
    const ev = { question: "Will X happen?", url: null, outcome: "“Yes”", resolves: null, criteria: null };
    const yes = { kind: "binary", binary: { onYes: { fractionOfPool: 1 }, onNo: null } } as unknown as BurnRule, no = { kind: "binary", binary: { onYes: null, onNo: { fractionOfPool: 1 } } } as unknown as BurnRule;
    assert.equal(eventForSide(ev, yes, { yes: "Yes", no: "No" })!.outcome, "“Yes”");
    assert.equal(eventForSide(ev, no, { yes: "Yes", no: "No" })!.outcome, "“No”");
    assert.equal(eventForSide(ev, no, { yes: "Mamdani", no: "Not Mamdani" })!.outcome, "“Not Mamdani”");
    assert.equal(eventForSide(null, no), null);
    assert.match(page, /const eventShown = eventForSide\(ownPick \? eventInfo : null, rule, \{ yes: pick\?\.yes \?\? null, no: pick\?\.no \?\? null \}\);/);
    assert.match(page, /event=\{flow === "single" && pick\?\.oracle === "polymarket" && !pairOn \? eventShown : null\}/);
  });
  test("a pick left from another path lends no unit, title or event to the active rule", () => {
    const debt = DEBT_RULE as unknown as BurnRule, team = firstPartyRule(teamSeries("nba", "PHI", "win", { kind: "season", year: 2026 }), 0.02);
    const debtPick = { oracle: "catalogue" as const, series: "treasury.debt", market: null, source: { unit: { label: "$1B moved" } } };
    assert.equal(pickDescribesRule(debt, debtPick), true); assert.deepEqual(activeUnit(debt, debtPick), { label: "$1B moved" });
    assert.equal(pickDescribesRule(team, debtPick), false); assert.equal(activeUnit(team, debtPick), null);
    const poly = { oracle: "polymarket" as const, series: null, market: "0xabc", source: null };
    assert.equal(pickDescribesRule({ oracle: "polymarket", series: null, market: "0xabc" }, poly), true);
    assert.equal(pickDescribesRule({ oracle: "polymarket", series: null, market: "0xdef" }, poly), false);
    // the budget row: the stale unit never reaches a team coin's label
    assert.equal(budgetCopy(team, 0.02, unitPhrase(activeUnit(team, debtPick))).label, "Share of the burn pool per result");
    assert.match(budgetCopy(debt, 0.02, unitPhrase(activeUnit(debt, debtPick))).label, /per \$1B change/);
    assert.match(page, /const budget0 = budgetCopy\(rule, shareValue, unitPhrase\(activeUnit\(rule, pick\)\)\);/);
    assert.match(page, /const own = pickDescribesRule\(rule, pick\);\n    if \(own && pick\?\.oracle === "polymarket"\)/);
    assert.doesNotMatch(page, /unitPhrase\(pick\?\.source\?\.unit/);
  });
});

describe("audit 10 item 3: the fee sentence by the venue the launch really uses", () => {
  const LP = `The pool's liquidity is locked forever. ${OPERATOR_SHARE_LINE} The operator's part of the liquidity fees is fixed in code.`;
  const PAIR = `The pool's liquidity is locked forever. ${PAIR_OPERATOR_SHARE_LINE} The operator's part of the liquidity fees is fixed in code.`;
  test("only the pair curve's pools say the pair line; two LaunchLab launches say the ordinary line for each coin", () => {
    assert.equal(lpDisclosureFor("single", LP, PAIR), LP);
    assert.equal(lpDisclosureFor("pair-curve", LP, PAIR), PAIR);
    for (const v of ["independent", "linked"] as const) { const s = lpDisclosureFor(v, LP, PAIR); assert.ok(s.endsWith(LP), v); assert.ok(!s.includes(PAIR_OPERATOR_SHARE_LINE), v); plain(s.replace(LP, ""), v); }
    assert.doesNotMatch(card, /many \? PAIR_LP_LINE : LP_LINE/, "never chosen by the number of coins");
    assert.match(card, /\{lpDisclosure\(p\.venue \?\? \(many \? "independent" : "single"\)\)\}/);
    assert.match(page, /const venue: LaunchVenue = !two && !\(pairOn && !ruleB\) \? "single" : meetingsOn \|\| settledPick \? "linked" : pairOn && !ruleB \? \(pairVenue === "pair-curve" \? "pair-curve" : "linked"\) : "independent";/);
    assert.match(tile, /const reviewVenue = venue === "pair-curve" \? "pair-curve" as const : "linked" as const;/);
    assert.doesNotMatch(lpDisclosureFor("independent", "", ""), /\d+%/, "no percentage typed by the page");
  });
});

describe("audit 10 items 6 and 7: warnings name the coins on screen; the trigger is never cut at a full stop", () => {
  test("a party-market warning is stored with a placeholder and rendered with the current ticker", () => {
    const w = partyMarketWarning("Democrats win the Michigan Senate race", "El-Sayed");
    assert.ok(w.includes(WARN_A));
    assert.deepEqual(renderWarnings([w], "ABDUL", "MIKE"), ['$ABDUL settles on the market "Democrats win the Michigan Senate race". That market is about the party\'s result, not El-Sayed by name.']);
    assert.ok(renderWarnings([partyMarketWarning("Q?", "Rogers", "B")], "A1", "B1")[0].startsWith("$B1 "));
    assert.equal(renderWarnings([`${WARN_B}`], "", "")[0], "B");
    plain(renderWarnings([w], "ABDUL", "")[0]);
    assert.match(page, /warnings=\{\[\.\.\.new Set\(\[\.\.\.renderWarnings\(srcWarnings, ticker, tickerB\)/);
    assert.match(page, /warnings: renderWarnings\(srcWarnings, ticker\.toUpperCase\(\), tickerB\.toUpperCase\(\)\)/, "the review request reads the rendered warnings");
    assert.doesNotMatch(page, /`\$\$\{t\} settles on the market|`\$\$\{tk\} settles on the market/, "no warning keeps the ticker of the moment it was made");
  });
  test("the trigger keeps a lead with abbreviations whole and builds a pair's from both one-liners", () => {
    const lead = "Every $1B the U.S. debt rises, the burn pool spends 2% buying $DEBTUP and burns it.";
    assert.equal(triggerText({ lead, fallback: "x" }), lead);
    assert.equal(triggerText({ pair: { a: "PHIVBOS", b: "BOSVPHI", oneA: "burns when the 76ers beat the Celtics.", oneB: "burns when the Celtics beat the 76ers" }, fallback: "x" }), "$PHIVBOS burns when the 76ers beat the Celtics, and $BOSVPHI burns when the Celtics beat the 76ers.");
    assert.equal(triggerText({ oneShot: "This coin burns its whole pool once.", lead: "ignored", fallback: "x" }), "This coin burns its whole pool once.");
    assert.doesNotMatch(page, /sentence0\.split\(/);
    assert.match(page, /\{ label: FACT_LABELS\.trigger, value: trigger, edit: editTo\("which"\) \}/);
  });
});

describe("QA 9 item 3 (owner): one game between two teams starts at the one-shot share wherever the dial allows it", () => {
  test("the share follows the rule's own bounds; the library change that opens 100 % is requested, not forced", () => {
    assert.equal(oneGameShare(1), 1); assert.equal(oneGameShare(0.25), 0.02);
    assert.match(page, /if \(pairMode === "game"\) \{ const f = oneGameShare\(dialsFor\(firstPartyRule\(sideA\.marketTicker, DEFAULT_SHARE\.recurring\)\)\.bounds\.max\);/);
  });
});

describe("QA 9 items 7, 13 and 14, audit 10 item 19: the image and the public profile", () => {
  test("a picked image shows in the name step's preview and on the review", () => {
    assert.match(coinCard, /const url = preview && src && \/\^data:image\\\/\(png\|jpeg\|gif\|webp\);base64,\/\.test\(src\) \? src :/);
    assert.match(coinCard, /<CoinThumb src=\{c\.imageUrl\} ticker=\{c\.ticker\} size=\{64\} generated=\{!!href\} preview \/>/);
    assert.match(card, /<img src=\{c\.image\} alt=\{`The image of \$\$\{c\.ticker \|\| "TICKER"\}`\}/);
  });
  test("the review lists the image, name, description, links and note with an Edit link each, and the full name wraps", () => {
    for (const f of ["name", "image", "description", "x", "note"]) assert.match(card, new RegExp(`"${f}", "[a-z ]+"\\)`), f);
    assert.match(card, /data-profile-name>\{c\.name \|\| "No name yet"\}/); assert.match(card, /className="break-words text-base font-semibold text-neutral-100" data-profile-name/);
    assert.match(page, /edit: \(side: "a" \| "b", f: ProfileFieldKey\) => editField\(side, f\),/);
    assert.match(page, /for \(let d = el\.closest\("details"\); d; d = d\.parentElement\?\.closest\("details"\) \?\? null\) d\.open = true;\n      el\.scrollIntoView\(\{ block: "center" \}\); el\.focus\(\{ preventScroll: true \}\);/);
  });
  test("the image line is confirmed on the name step; a picture that is not square shows the square the coin keeps", () => {
    plain(IMAGE_RIGHTS_REQUIRED); plain(notSquareLine(1200, 600));
    assert.deepEqual(squareCrop(1200, 600), { left: 25, top: 0, width: 50, height: 100 });
    assert.deepEqual(squareCrop(600, 1200), { left: 0, top: 25, width: 100, height: 50 });
    assert.deepEqual(squareCrop(512, 512), { left: 0, top: 0, width: 100, height: 100 });
    assert.match(page, /disabled=\{nameStepBlocked\} onClick=\{\(\) => setGuide\(\(g\) => \(\{ \.\.\.g, phase: "review" \}\)\)\}>Review<\/button>/);
    // website-25 (QA 11 H5): the same line, now also for every other field problem (NAME_STEP_BLOCKED)
    assert.match(page, /\{nameStepBlocked && <p className="mb-1 text-xs text-amber-300" role="status" data-next-blocked>\{rightsMissing \? IMAGE_RIGHTS_REQUIRED : NAME_STEP_BLOCKED\}<\/p>\}/);
    // website-25 (QA 11 H5): held for every field problem, the image line among them
    assert.match(tile, /next=\{next\("Review", "review", nameBlockedP, nameBlockedP \? \(rightsMissing \? IMAGE_RIGHTS_REQUIRED : NAME_STEP_BLOCKED\) : null\)\}/);
    assert.match(fields, /data-image-not-square role="status"/); assert.match(fields, /squareCrop\(shape\.w, shape\.h\)/);
  });
});

describe("QA 9 item 8: the projection includes the share the creator chose", () => {
  test("1, 2 and 5 % plus the chosen share, marked; a one-time 100 % adds nothing", () => {
    assert.deepEqual(projectionShares(0.1), [0.01, 0.02, 0.05, 0.1]); assert.deepEqual(projectionShares(0.02), [0.01, 0.02, 0.05]); assert.deepEqual(projectionShares(1), [0.01, 0.02, 0.05]);
    const p = reviewProjection({ ...(DEBT_RULE as unknown as BurnRule), scalar: { ...(DEBT_RULE as unknown as BurnRule).scalar!, perUnit: { fractionOfPool: 0.1 } } }, NOW);
    assert.ok(p.available, p.reason ?? "");
    if (p.available) { assert.equal(p.rows.length, 4); assert.ok(p.lines.some((l) => /^At 10%, the share you chose: /.test(l)), p.lines.join(" | ")); for (const l of p.lines) plain(l.replace(/\(\d{4}-\d\d-\d\d to \d{4}-\d\d-\d\d\)/, "")); }
    else assert.ok(p.reason);
  });
});

describe("QA 9 items 9, 39 and audit 10 item 14: one flow from every entry", () => {
  test("the free text is one line at the top of step 1, the six cards stay primary, and the older chooser is gone", () => {
    assert.match(steps, /search = null \}: \{/); assert.match(steps, /data-step-heading>\{GUIDED_STEPS\[0\]\.question\}<\/h2>\n      \{search\}/);
    assert.match(page, /<FollowStep search=\{searchBlock\} value=\{guide\.follow \?\? prevFollow\}/);
    assert.match(page, /<label htmlFor="bt-free-text" className="shrink-0 text-sm text-neutral-300">Or describe it<\/label>/);
    assert.doesNotMatch(page, /…or start from one of these|data-classic|begin\("browse"\); setCat\(c\.id\)/);
    assert.doesNotMatch(page, /<CoinVsCoinTile pairCurve=/, "no second Coin vs Coin entry beside the six cards");
  });
  test("a search template lands on step 1 with its words in the line, scrolled to and focused", () => {
    assert.match(page, /if \(st\.search\) \{ setUq\(st\.search\); setFocusSearch\(true\); \}/);
    assert.match(page, /const el = searchRef\.current; if \(!el\) return; setFocusSearch\(false\); el\.scrollIntoView\(\{ block: "center" \}\); el\.focus\(\{ preventScroll: true \}\);/);
    assert.match(page, /<input id="bt-free-text" ref=\{searchRef\}/);
  });
  test("a card from the search line, a template or a deep link answers step 1 by its rule and walks the guided steps", () => {
    assert.equal(followForRule({ oracle: "catalogue", series: teamSeries("nba", "PHI", "win", { kind: "season", year: 2026 }), market: null }), "team");
    assert.equal(followForRule({ oracle: "polymarket", series: null, market: "0xabc" }), "market");
    assert.equal(followForRule({ oracle: "catalogue", series: "treasury.debt", market: null }), "number");
    assert.equal(followForRule({ oracle: "catalogue", series: "usgs.quakes:6", market: null }, { hazard: true }), "disaster");
    assert.equal(followForRule(null, { matchup: true }), "rivalry");
    assert.equal(followForRule({ oracle: "derby", series: null, market: null }), "coins");
    assert.match(page, /adoptFollow\(followForRule\(r0, \{ matchup: !!c\.matchup, hazard: isHazardSeries\(r0\?\.series \?\? null\) \}\)\);/);
    assert.match(page, /const applyOutcome = [\s\S]{0,200}adoptFollow\("market"\);/);
    assert.match(page, /if \(e\?\.kind === "team"\) \{ setGuide\(\{ follow: "team", phase: "which", pairKind: null \}\);/, "launch one like this");
  });
});

describe("QA 9 items 11 and 12, audit 10 items 8, 10 and 12: fields checked where they are typed, every blocker on the review", () => {
  const P = { image: null, rights: false, description: "", x: "", telegram: "", website: "" };
  test("links use the server's rule per field, said beside the field when it is left", () => {
    const bad = profileFieldProblems({ ...P, x: "javascript:alert(1)", telegram: "https://example.com/x", website: "data:text/html,hi" });
    assert.deepEqual(bad.map((x) => x.field), ["x", "telegram", "website"]);
    assert.match(bad[0].text, /https:\/\//); assert.match(bad[1].text, /t\.me/);
    assert.deepEqual(profileFieldProblems({ ...P, x: "https://facebook.com/a" }).map((x) => x.text), ["The X link has to be an x.com or twitter.com address."]);
    assert.deepEqual(profileFieldProblems({ ...P, x: "https://x.com/a", telegram: "https://t.me/a", website: "https://example.org" }), []);
    assert.deepEqual(profileFieldProblems({ ...P, website: "http://example.org" }).map((x) => x.field), ["website"]);
    assert.match(fields, /onBlur=\{\(\) => setTouched\(\(t\) => \(\{ \.\.\.t, \[k\]: true \}\)\)\}/);
    assert.match(fields, /\{err && <span id=\{`\$\{id\}-err`\} className="mt-0\.5 block break-words text-red-400" data-field-error=\{k\}>\{err\}<\/span>\}/);
  });
  test("a description is one paragraph: a line break becomes a space and the field says so; invisible characters are named", () => {
    assert.deepEqual(oneParagraph("one\ntwo\r\nthree\tfour"), { value: "one two three four", changed: true });
    assert.deepEqual(oneParagraph("plain"), { value: "plain", changed: false });
    plain(DESCRIPTION_ONE_PARAGRAPH);
    assert.deepEqual(profileFieldProblems({ ...P, description: "a‮b" }).map((x) => x.field), ["description"]);
    assert.match(fields, /onChange=\{\(e\) => \{ const p = oneParagraph\(e\.target\.value\); setParaNote\(p\.changed\); set\(\{ description: p\.value \}\); \}\}/);
  });
  test("the note's problem is a sentence, and it reaches the review's list with the server's own problems, each once", () => {
    assert.equal(noteProblemOf("see https://a.com"), "The note cannot have links."); assert.equal(noteProblemOf("official coin"), "The note cannot claim an affiliation or an endorsement."); assert.equal(noteProblemOf("gm"), null);
    plain(noteProblemOf("x.com")!); plain(noteProblemOf("official")!);
    assert.deepEqual(reviewBlockers({ fields: ["Enter a name for the coin."], note: "The note cannot have links.", serverProblems: ["Enter a name for the coin", "The X link has to be an x.com or twitter.com address."], blocked: null }), ["Enter a name for the coin.", "The note cannot have links.", "The X link has to be an x.com or twitter.com address."]);
    assert.match(page, /\.\.\.\(noteProblem && !pairOn \? \[\{ text: noteProblem, edit: \(\) => editField\("a", "note"\) \}\] : \[\]\),/);
    assert.match(page, /const serverBlockers = reviewCurrent \? \(shownReview\.review\?\.problems \?\? \[\]\)\.filter/);
    assert.doesNotMatch(page, /\.filter\(\(x\) => \/\^\(Coin B\\\. \)\?The description \/\.test\(x\)/, "no longer only the description's problems");
  });
  test("with launches open (a mocked config), every refusal the review reports reaches the page's list", () => {
    const body = { rule: DEBT_RULE, ticker: "DEBTUP", name: "Debt Up", note: "see https://x.com", raiseSol: "85", creatorDescription: "a‮b", links: [{ label: "X", url: "https://facebook.com/a" }, { label: "Telegram", url: "https://example.com" }] };
    const out = buildLaunchReview(body as never, { env: ENV, now: NOW });
    const problems = "review" in out ? out.review.problems : out.problems;
    assert.ok(problems.length >= 2, problems.join(" | "));
    const listed = reviewBlockers({ serverProblems: problems, note: noteProblemOf(body.note) });
    for (const p of problems) assert.ok(listed.some((x) => x.replace(/\.$/, "").toLowerCase() === p.replace(/\.$/, "").toLowerCase()), p);
    assert.ok(listed.includes("The note cannot have links."));
  });
  test("a pair's name step names only the fields it carries", () => {
    assert.equal(profileMoreLabel(false), "Description and links. Each one is optional."); assert.match(profileMoreLabel(true), /note/);
    assert.match(card, /<summary className="cursor-pointer text-sm text-neutral-200">\{profileMoreLabel\(!!p\.note\)\}<\/summary>/);
  });
});

describe("audit 10 item 11: words kept from another kind of coin are said, with Reuse and Start fresh", () => {
  test("the parts kept are named; the page offers both ways on step 4", () => {
    assert.deepEqual(keptProfileParts({ description: "hi", x: "https://x.com/a", telegram: "", website: "" }, "gm"), ["description", "X link", "note"]);
    assert.deepEqual(keptProfileParts({ description: " ", x: "", telegram: "", website: "" }, ""), []);
    const l = keptProfileLine(["description", "X link", "note"]); plain(l); assert.equal(l, "Your description, X link and note from the coin you were setting up are still filled in.");
    assert.equal(keptProfileLine(["note"]), "Your note from the coin you were setting up is still filled in.");
    plain(KEPT_PROFILE_REUSE); plain(KEPT_PROFILE_FRESH);
    assert.match(page, /if \(lastFollow\.current && lastFollow\.current !== f\) \{ const kept = keptProfileParts\(profile, note\); setKeptProfile\(kept\.length \? kept : null\); \}/);
    assert.match(page, /data-kept-profile>\{keptProfileLine\(keptProfile\)\}/);
  });
});

describe("QA 9 item 38, audit 10 items 13 and 17: Coin comparison walks the real steps", () => {
  test("the tile renders Which, Burns, Name and Review as the page's phases, and Back steps one at a time", () => {
    assert.match(page, /step === "choose" && guide\.follow === "coins" && guide\.phase !== "follow" && \(/);
    assert.match(page, /<CoinVsCoinTile recordKeyed=\{recordKeyed\} burnReal=\{site\.burnReal\} network=\{site\.cluster \?\? cluster\} startOpen phase=\{guide\.phase\} onPhase=\{setCoinsPhase\} onAnswers=\{setCoinAnswers\}/);
    assert.match(page, /if \(guide\.follow === "coins" && \(guide\.phase === "burn" \|\| guide\.phase === "name" \|\| guide\.phase === "review"\)\)/);
    for (const ph of ["which", "burn", "name"]) assert.match(tile, new RegExp(`if \\(phase === "${ph}"\\)`), ph);
    assert.match(tile, /<ReviewCard mode="review"/); assert.equal((tile.match(/<ReviewCard mode="name"/g) ?? []).length, 2, "the pair and the record close");
    assert.match(tile, /<PatternStep preview=/);
  });
  test("the cost sits beside Launch both, with what it leaves out", () => {
    plain(PAIR_COST_EXCLUSIONS); assert.match(PAIR_COST_EXCLUSIONS, /rent is not measured yet/);
    assert.match(tile, /costNote=\{shown\.review\?\.venue === "pair-curve" \? shown\.review\.costs\.note : PAIR_COST_EXCLUSIONS\}/); assert.match(page, /costNote=\{venue === "linked" \|\| venue === "pair-curve" \? PAIR_COST_EXCLUSIONS : null\}/);
    assert.match(card, /\{p\.costNote && <span className="block text-xs text-neutral-400" data-cost-note>\{p\.costNote\}<\/span>\}/);
  });
});

describe("QA 9 items 24, 36, 37, 41 and 43, audit 10 items 16, 20, 22 and 24", () => {
  test("24: a long answer chip ends in an ellipsis and carries the whole answer as its title", () => {
    assert.match(steps, /<button type="button" data-nav title=\{text\} className=\{`\$\{cls\} block max-w-\[11rem\] truncate/);
    assert.match(steps, /<span title=\{text\} className=\{`\$\{cls\} inline-block max-w-\[11rem\] truncate/);
  });
  test("36: the bottom padding is the sticky bar's measured height", () => {
    assert.match(steps, /root\.style\.setProperty\(STICKY_VAR, `\$\{Math\.ceil\(el\.getBoundingClientRect\(\)\.height\)\}px`\)/);
    assert.match(page, /pb-\[calc\(var\(--bt-sticky-h,0px\)\+1\.5rem\)\]/); assert.doesNotMatch(page, /pt-6 pb-28/);
  });
  test("37: More and Less sit at the end of the share row", () => {
    for (const src of [card, steps]) { const less = src.indexOf('{more ? "Less" : "More"}') >= 0 ? src.indexOf('{more ? "Less" : "More"}') : src.indexOf('{showMore ? "Less" : "More"}'); const extras = src.indexOf("!mainShares.includes(f)") >= 0 ? src.indexOf("!mainShares.includes(f)") : src.indexOf("!mainRow.includes(f)"); assert.ok(less > extras && extras > 0, "the toggle comes after the extra chips"); }
  });
  test("41: a 429 or 502 is asked again after a pause, a few times, for that draft only", () => {
    assert.match(page, /const transientRead = \(e: unknown\): boolean => \/\^HTTP \(429\|502\|503\|504\)\\b\//);
    assert.match(page, /const n = reviewRetry\.rev === rev \? reviewRetry\.n : 0, again = transientRead\(e\) && n < RETRY_MAX;/);
    assert.match(page, /\}, \[step, reviewKey, gate\.kind, reviewRetry\.rev, reviewRetry\.n\]\);/);
    assert.match(page, /if \(transientRead\(e\) && n < RETRY_MAX\) setTimeout\(\(\) => \{ setBtRetry\(\{ key, n: n \+ 1 \}\); setBtFor\(\(f\) => \(f === key \? "" : f\)\); setBtErr\(null\); \}, 2000 \* 2 \*\* n\);/);
    assert.match(page, /\}, 600\);\n    return \(\) => clearTimeout\(t\);\n  \}, \[step, reviewKey/, "the review is debounced");
  });
  test("43 and audit 10 item 20: accessible names on the comparison, the candidate picks and the state selector", () => {
    assert.match(tile, /aria-label=\{`Search for the \$\{lower1\(label\)\}`\}/); assert.match(tile, /aria-label=\{`Change the \$\{lower1\(label\)\}`\}/);
    assert.match(page, /aria-label=\{`Pick \$\{o\.label\.replace\(/); assert.match(page, /data-help="race-state" aria-label="State"/);
    assert.match(steps, /role="radio" aria-checked=\{value === o\.id\} aria-label=\{o\.label\}/);
  });
  test("audit 10 item 16: the race filters belong to the picker that set them", () => {
    assert.match(page, /const electionPicker = `\$\{guide\.follow \?\? ""\}\|\$\{guide\.pairKind \?\? ""\}`/);
    assert.match(page, /lastPicker\.current = electionPicker; setEtype\(null\); setEstate\(null\); setEsel\(\[\]\); setEraces\(null\); setEpair\(null\);/);
  });
  test("audit 10 item 22: helper copy", () => {
    assert.deepEqual(patternWords("fade", { follow: "market" }), { label: MARKET_NO_LABEL, sentence: MARKET_NO_SENTENCE });
    assert.deepEqual(patternWords("once", { follow: "market" }), { label: MARKET_YES_LABEL, sentence: MARKET_YES_SENTENCE });
    assert.doesNotMatch(patternWords("fade", { follow: "market" }).sentence, /each day or reading/);
    for (const s of [MARKET_NO_LABEL, MARKET_YES_LABEL, MARKET_YES_SENTENCE]) plain(s);
    assert.equal(whichAnswer("Detroit daily high ≥ 90 °F (NWS)"), "Detroit daily high ≥ 90 °F");
    assert.equal(whichAnswer("Will X win? (resolves once)"), "Will X win?");
    assert.doesNotMatch(page, /\.slice\(0, 28\)/, "never cut mid-word or mid-bracket");
    assert.match(tile, /\{refSourceLine\(value\.source === "pyth", value\.crossLine \?\? null, crossName\(value\.underlying\?\.cross\)\)\}/); assert.doesNotMatch(tile, /cross-read \{value\.underlying/);
    assert.match(read("src/lib/burnticker/search.ts"), /replace\(\/, then the rest\/, "\. Then the rest"\)/, "sources-6 fixed it in search.ts");
    assert.equal(teamLine([null, "Next game: not available."]), "Next game: not available.", "QA 9 item 6: no dangling dot");
    assert.equal(teamLine(["40–42 this season", "next: vs BOS"]), "40–42 this season · next: vs BOS");
  });
  test("audit 10 item 24: one summary, the share said as the budget's, a small diagram of the two ways two coins burn", () => {
    plain(shareOfBudgetLine(0.02)); assert.match(shareOfBudgetLine(0.02), /not|never/); assert.match(shareOfBudgetLine(0.02), /supply/);
    plain(PAIR_DIAGRAM_LABEL.independent); plain(PAIR_DIAGRAM_LABEL.linked);
    assert.match(card, /<svg viewBox="0 0 120 56" width="120" height="56" role="img" aria-label=\{label\}/);
    assert.match(card, /<details className="min-w-0 text-neutral-300" data-upfront>/, "the reading matter on the review sits one tap away");
    assert.match(page, /pairDiagram=\{two \|\| \(pairOn && !ruleB\) \? \(venue === "independent" \? "independent" : "linked"\) : null\}/);
  });
});
