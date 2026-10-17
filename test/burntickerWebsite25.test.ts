// WEBSITE-25 (2026-10-13): the launch pages' side of QA walkthrough 11 and WIRING-SOURCES7. H4 the coin-comparison cost said with its
// venue; H5 every field rule on the Name step (one plain sentence per field, the server's field problems beside them, Review held); H8 one
// generator for both coins of a two-team pair, the direction in the names; H6 the season-over offer on the Burns step and the league
// page's greyed teams; H7 the pair check at pick time; M1 the Follows chip asks first; M6 the race picker's width and state order; L2/L3/L4
// field polish; WIRING-SOURCES7 page items. Pure pieces are tested directly; page wiring is pinned by its source.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { creatorTextProblems } from "@/lib/burnticker/coinText";
import { RESERVED_TICKER_REFUSAL } from "@/lib/burnticker/reservedNames";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { tileRule, tileHashInput } from "@/lib/burnticker/derby/tile";
import { rulesSha256 } from "@/lib/burnKeeper/rules";
import { CREATOR_LAUNCHES_FLAG } from "@/lib/burnticker/creatorLaunches";
import { PAIR_CURVE_FLAG } from "@/lib/burnKeeper/pairCurveCrank";
import { NAME_STEP_BLOCKED, creatorHits, fieldRuleSentence, isLintLine, noteIssue, profileIssues, serverFieldOf, serverFieldProblems } from "@/app/burnticker/launch/fieldChecks";
import { JUMP_CONFIRM_LINE, JUMP_CONFIRM_NO, JUMP_CONFIRM_YES, NAMES_REMADE_LINE, humanDay, pairCostSentence, winPairNames } from "@/app/burnticker/launch/pageCopy";
import { NAME_MAX_LINE, RESERVED_TICKER_LINE, TICKER_PASTE_MAX } from "@/app/burnticker/launch/pageCopy";
const EMPTY_PROFILE = { image: null, rights: false, badge: true, description: "", x: "", telegram: "", website: "" };
import { SHIB, WIF } from "./burntickerDerbyHelpers.ts";

const cfg = loadCopyLintConfig();
const plain = (t: string, where = t) => {
  assert.deepEqual(lintCopy(t, cfg).hits.map((h) => `${h.phrase} (${h.rule})`), [], `${where}: ${t}`);
  assert.doesNotMatch(t, /\bwill\b|\bbuy|\bprice\b|coming soon|\bpayouts?\b|\btarget/i, `${where}: ${t}`);
};
const read = (f: string) => fs.readFileSync(f, "utf8");
const page = read("src/app/burnticker/launch/page.tsx"), tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx"), card = read("src/app/burnticker/launch/ReviewCard.tsx"), fields = read("src/app/burnticker/launch/ProfileFields.tsx");
const league = read("src/app/burnticker/leagues/[league]/[season]/page.tsx");
const sentenceCount = (s: string) => s.split(/(?<=[.!?])\s+(?=[A-Z])/).length;

const DERBY_CHOICE = { a: WIF, b: SHIB, window: "daily" as const, seasonDays: 30, flip: false, fraction: 0.02, now: Date.UTC(2026, 9, 13, 15) };
const DERBY = tileRule(DERBY_CHOICE, rulesSha256(tileHashInput(DERBY_CHOICE)), { a: "WIFVSHIB", b: "SHIBVWIF" });
// the walkthrough's own H5 entries
const DESC = "Officially endorsed by the NHL. Guaranteed 100x. Join t.me/avscup";
const NOTE = "Officially endorsed by the NHL and the Colorado Avalanche.";
const NAME = "🔥 Avs <b>Cup</b> & \"Co\"";

describe("H5: the field rules in the browser match the server's lint", () => {
  test("creatorHits is lintCopy's creator scope, hit for hit", () => {
    for (const t of [DESC, NOTE, NAME, "Wen moon!!! LFG", "Buy now before it's too late, 10x gains", "Partnered with the NFL, see @avsfan", "Debt to the penny, $1B added", "pump.fun launch", "a calm and plain description"]) {
      assert.deepEqual(creatorHits(t).map((h) => [h.rule, h.phrase, h.index]), lintCopy(t, cfg, { scope: "creator" }).hits.map((h) => [h.rule, h.phrase, h.index]), t);
    }
  });
  test("one plain sentence per field: every word once, whole, no rule ids, a link said as a link", () => {
    const d = fieldRuleSentence("description", DESC)!;
    assert.equal(sentenceCount(d), 1, d);
    for (const w of ["Officially", "endorsed", "Guaranteed", "100x"]) assert.equal(d.split(`“${w}”`).length - 1, 1, `${w} once: ${d}`);
    assert.match(d, /have links/); assert.match(d, /X, Telegram and website fields/);
    assert.match(d, /claim a tie to anyone/); assert.match(d, /make promises/);
    assert.doesNotMatch(d, /no-affiliation|hype-punctuation|price-returns|Rule broken|costume|“t\.me/);
    assert.doesNotMatch(d, /“[^”]*\s[^”]*”/, "never a quote cut from the middle of the text");
    const n = fieldRuleSentence("name", NAME)!;
    assert.equal(n, "The name cannot use “🔥”, because a coin's own text cannot use hype symbols or rows of exclamation marks.");
    assert.equal(fieldRuleSentence("description", "Join t.me/avscup"), "The description cannot have links or @handles, which go in the X, Telegram and website fields.");
    assert.equal(fieldRuleSentence("note", NOTE), "The note cannot use “Officially” or “endorsed”, because a coin's own text cannot claim a tie to anyone.");
    assert.equal(noteIssue(NOTE), fieldRuleSentence("note", NOTE));
    assert.equal(fieldRuleSentence("description", "Wen moon!!! LFG")?.includes("three exclamation marks"), true);
    assert.equal(fieldRuleSentence("description", "a calm and plain description"), null);
    assert.equal(fieldRuleSentence("name", ""), null);
  });
  test("the description's sentence is a profile problem with its field; the room the rule's paragraph leaves is checked too", () => {
    const p = profileIssues({ ...EMPTY_PROFILE, description: DESC, telegram: "https://discord.gg/avs", x: "not a url", website: "javascript:alert(1)" });
    assert.deepEqual(p.map((x) => x.field).sort(), ["description", "telegram", "website", "x"]);
    const room = profileIssues({ ...EMPTY_PROFILE, description: "a".repeat(200) }, "b".repeat(1450));
    assert.equal(room.length, 1); assert.equal(room[0].field, "description"); assert.match(room[0].text, /rule's own paragraph/);
  });
  test("the server's per-hit lint lines are recognised and dropped; its field problems are mapped to their field", () => {
    // sources-7 round 2: the server says the name step's own sentence, one per field, so the page's dedupe by text drops it
    for (const x of creatorTextProblems({ name: NAME, ticker: "", note: NOTE, description: DESC })) assert.equal(x.reason, fieldRuleSentence(x.field as "name" | "note" | "description", x.field === "name" ? NAME : x.field === "note" ? NOTE : DESC), x.reason);
    assert.equal(isLintLine("The ticker needs 2 to 10 letters or digits."), false);
    assert.deepEqual(serverFieldOf(RESERVED_TICKER_REFUSAL), { side: "a", field: "ticker" });
    assert.deepEqual(serverFieldOf("Coin B. The ticker needs 2 to 10 letters or digits."), { side: "b", field: "ticker" });
    assert.deepEqual(serverFieldOf("The description, the rule's paragraph and your own text together, comes to 1,527 characters, and a coin's description can be at most 1,500. Shorten your text."), { side: "a", field: "description" });
    assert.deepEqual(serverFieldOf("The Telegram link has to be a t.me address."), { side: "a", field: "telegram" });
    assert.deepEqual(serverFieldOf("This launch is refused: a campaign phrase"), { side: "a", field: "name" });
    assert.equal(serverFieldOf("The Rockies have no games left in the 2026 season, so a coin on it would end right away."), null);
    const out = serverFieldProblems([RESERVED_TICKER_REFUSAL, `The note "${NOTE}" contains "endorsed", which is not allowed. Rule broken: no-affiliation (x).`, "The X link has to start with https:// and have no spaces."], new Set(["the x link has to start with https:// and have no spaces"]));
    assert.deepEqual(out.map((x) => x.text), [RESERVED_TICKER_REFUSAL]);
  });
  test("the walkthrough's draft: the review's lines become one per field, and the page holds Review", () => {
    const rv = (buildLaunchReview({ rule: DERBY.rule, ticker: "COLCUP", name: NAME, note: NOTE, creatorDescription: DESC } as never, { env: { BURNTICKER_CLUSTER: "mainnet", [CREATOR_LAUNCHES_FLAG]: "1" }, reserved: new Set() }) as { review: import("@/lib/burnticker/launchReview").LaunchReview }).review;
    // sources-7 round 2: the server now says one sentence per field too, the same as the page's, and places it in fieldProblems
    assert.equal(rv.problems.filter(isLintLine).length, 0);
    for (const f of ["name", "note", "description"] as const) assert.equal(rv.fieldProblems.filter((x) => x.field === f && /cannot use/.test(x.text)).length, 1, f);
    const page = [fieldRuleSentence("name", NAME), noteIssue(NOTE), fieldRuleSentence("description", DESC)];
    assert.equal(page.filter(Boolean).length, 3, "three fields, three sentences");
  });
  test("page wiring: Review is disabled while any field has a problem, errors show on return, Edit lands on the field", () => {
    assert.match(page, /const nameStepBlocked = rightsMissing \|\| !ready \|\| profileBlockers\.length > 0 \|\| coins\.some\(\(c\) => !!c\.nameIssue \|\| !!c\.tickerIssue\);/);
    assert.match(page, /disabled=\{nameStepBlocked\}/);
    assert.match(page, /\.\.\.serverFields\.map\(\(x\) => \(\{ text: x\.text, edit: \(\) => editField\(x\.side, x\.field\) \}\)\)/);
    assert.match(page, /!isLintLine\(x\) && !serverFields\.some/);
    assert.match(page, /nameIssue: fieldRuleSentence\("name", name\), tickerIssue: fieldRuleSentence\("ticker", ticker\)/);
    assert.match(page, /const noteProblem = noteIssue\(note\);/);
    assert.match(card, /nErr = nameProblem\(c\.name\) \|\| c\.nameIssue \|\| null/);
    assert.match(card, /p\.mode === "name" \? \(\) => \{ const el = document\.getElementById\(`bt-profile-\$\{side\}-\$\{f\}`\)/);
    assert.match(fields, /useState<Record<string, boolean>>\(\(\) => Object\.fromEntries\(LINK_FIELDS\.map\(\(\[k\]\) => \[k, !!value\[k\]\.trim\(\)\]\)\)\)/);
    assert.match(fields, /\|\| fieldRuleSentence\("description", value\.description\) \|\| ""/);
    assert.match(fields, /descriptionRoomProblem\(generated, value\.description\)/);
    for (const src of [tile]) { assert.match(src, /nameBlockedH = rightsH \|\| !ready \|\| blockersH\.length > 0/); assert.match(src, /nameBlockedP = rightsMissing \|\| !ready \|\| blockers\.length > 0/); }
    plain(NAME_STEP_BLOCKED);
  });
});

describe("H4: the coin comparison's cost is the server's two-coin estimate for its venue", () => {
  const choice = { a: WIF, b: SHIB, window: "daily" as const, seasonDays: 30, flip: false, fraction: 0.02, now: Date.UTC(2026, 9, 13, 15) };
  const m = tileRule(choice, rulesSha256(tileHashInput(choice)), { a: "WIFVSHIB", b: "SHIBVWIF" });
  const review = (pc: boolean) => (buildLaunchReview({ rule: m.rule, ticker: "WIFVSHIB", name: "WIF vs SHIB", pair: { ticker: "SHIBVWIF", name: "SHIB vs WIF" } } as never, { env: { BURNTICKER_CLUSTER: "mainnet", [CREATOR_LAUNCHES_FLAG]: "1", ...(pc ? { [PAIR_CURVE_FLAG]: "1" } : {}) }, reserved: new Set() }) as { review: import("@/lib/burnticker/launchReview").LaunchReview }).review;
  test("two coins on LaunchLab are twice one coin; the pair curve has no LaunchLab pool, and the sentence says so", () => {
    const one = (buildLaunchReview({ rule: m.rule, ticker: "WIFVSHIB", name: "WIF vs SHIB" } as never, { env: { BURNTICKER_CLUSTER: "mainnet", [CREATOR_LAUNCHES_FLAG]: "1" }, reserved: new Set() }) as { review: import("@/lib/burnticker/launchReview").LaunchReview }).review;
    const ll = review(false), pc = review(true);
    assert.equal(ll.venue, "launchlab"); assert.equal(pc.venue, "pair-curve");
    assert.equal(Number(ll.costs.totalSol), Math.round(Number(one.costs.totalSol) * 2 * 1e4) / 1e4);
    assert.ok(Number(pc.costs.totalSol) < Number(ll.costs.totalSol));
    assert.match(pairCostSentence(pc.costs.totalSol, pc.venue), /for both coins on the pair curve\. That is less than two separate coins, because the pair curve has no LaunchLab pool/);
    assert.equal(pairCostSentence(ll.costs.totalSol, ll.venue), `The estimated cost is about ${ll.costs.totalSol} SOL for both coins.`);
    plain(pairCostSentence("0.0567", "pair-curve")); plain(pairCostSentence("0.1138", "launchlab"));
  });
  test("the tile shows the venue's sentence and the server's own note for the pair curve", () => {
    assert.match(tile, /cost=\{shown\.review && reviewCurrent \? pairCostSentence\(shown\.review\.costs\.totalSol, shown\.review\.venue\) : null\} costNote=\{shown\.review\?\.venue === "pair-curve" \? shown\.review\.costs\.note : PAIR_COST_EXCLUSIONS\}/);
    assert.doesNotMatch(tile + page, /withPinSteps\(/, "base 61fd2f2e: the server counts the pin");
  });
});

describe("H8: both coins of a two-team pair regenerate together, and the names say which way they burn", () => {
  const ars = { abbr: "ARS", code: "ARS", nickname: "Arsenal", name: "Arsenal" }, tot = { abbr: "TOT", code: "TOT", nickname: "Tottenham Hotspur", name: "Tottenham Hotspur" };
  test("winPairNames: Wins in the name, WIN in the ticker, whole words within 32 bytes", () => {
    const n = winPairNames(ars, tot);
    for (const s of [n.a, n.b]) { assert.ok(new TextEncoder().encode(s.name).length <= 32, s.name); assert.match(s.name, / Wins vs /); assert.match(s.ticker, /^[A-Z0-9]{2,10}$/); assert.match(s.ticker, /WIN$/); }
    assert.equal(n.a.ticker, "ARSWIN"); assert.equal(n.b.ticker, "TOTWIN");
    const long = winPairNames({ abbr: "WOL", nickname: "Wolverhampton Wanderers", name: "Wolverhampton Wanderers" }, { abbr: "BHA", nickname: "Brighton & Hove Albion", name: "Brighton & Hove Albion" });
    for (const s of [long.a, long.b]) { assert.ok(new TextEncoder().encode(s.name).length <= 32, s.name); assert.doesNotMatch(s.name, /\b(vs|&)$/); }
  });
  test("page wiring: one generator for the four fields, reset together when the subject changes, and said once", () => {
    assert.match(page, /if \(nameAuto && \(name !== pairGen\.a\.name \|\| nameB !== pairGen\.b\.name\)\) \{ setName\(pairGen\.a\.name\); setNameB\(pairGen\.b\.name\); \}/);
    assert.match(page, /if \(tickerAuto && \(ticker !== pairGen\.a\.ticker \|\| tickerB !== pairGen\.b\.ticker\)\) \{ setTicker\(pairGen\.a\.ticker\); setTickerB\(pairGen\.b\.ticker\); \}/);
    assert.match(page, /if \(flow === "pair" && pairGen\) return pairGen\.a\.ticker;/);
    assert.match(page, /if \(pairMode === "season"\) return seasonPairNames\(/);
    assert.match(page, /setEditedFor\(null\); if \(editedFor !== null\) setNamesRemade\(true\);/);
    assert.match(page, /onTicker: \(v: string\) => \{ setTickerB\(v\); setTickerAuto\(false\); setEditedFor\(subjectKey\); noteEdit\(\); \}/);
    assert.match(page, /\{namesRemade && <p [^>]*data-names-remade>\{namesRemadeLine\(pairOn \? 2 : 1\)\}<\/p>\}/, "WIRING-AUDIT12 item 10: one coin or two");
    plain(NAMES_REMADE_LINE);
  });
});

describe("H6 (page part): a team whose season is over", () => {
  test("the Burns step says the review's sentence, offers the next season and holds Next; patterns greyed for a finished team", () => {
    assert.match(page, /setSeasonSwap\(\{ abbr: team\.abbr, series: so\.next\.series, label: so\.next\.label \}\)/);
    assert.match(page, />Use the \{so\.next\.label\} season<\/button>/);
    assert.match(page, /firstPartyRule\(seasonSwap && seasonSwap\.abbr === team\.abbr \? seasonSwap\.series :/);
    assert.match(page, /o\.id === "every" \|\| o\.id === "fade" \? \{ \.\.\.o, available: false, reason: SEASON_OVER_LINE \}/);
    assert.match(page, /next=\{seasonBlocked \? <StickyAction><button type="button" data-nav disabled/);
    assert.match(page, /setDeepSeasonOver\(q0\.get\("season"\) === "over" \? q0\.get\("team"\) : null\);/);
    assert.match(page, /deepSeasonOver === team\.abbr \? SEASON_OVER_LINK_LINE : SEASON_OVER_LINE/);
  });
  test("the league page reads the schedule once, greys the finished teams and says so beside the link", () => {
    assert.match(league, /seasonStatus\(a, games, true\)\.status === "over"/);
    assert.match(league, /if \(year !== seasonYearAt\(league, Date\.now\(\)\)\) return null;/);
    assert.match(league, /ogImage: og, seasonOver \}/);
    assert.match(league, /\{t\.warning && <span className="basis-full text-\[11px\] text-amber-300\/80" data-season-warning>\{t\.warning\}<\/span>\}/);
  });
});

describe("WIRING-SOURCES7 page items", () => {
  test("H7: the pair is checked when both coins are picked, with a swap; Next waits", () => {
    assert.match(tile, /fetch\("\/api\/burnticker\/v1\/derby\/pair", \{ method: "POST"/);
    assert.match(tile, />Swap the two coins<\/button>/);
    assert.match(tile, /next\("Next", "burn", !a\?\.underlying \|\| !b\?\.underlying \|\| pairRefused\)/);
    assert.match(tile, /next\("Next", "name", !model\?\.rule \|\| pairRefused\)/);
    assert.match(tile, /The first day A's market cap passes B's, coin A's rule fires once\./);
    plain("The first day A's market cap passes B's, coin A's rule fires once.");
  });
  test("H1: a record-close link opens one coin's record close with the coin searched; the card says so", () => {
    assert.match(tile, /if \(\(u\.get\("kind"\) \?\? entry\?\.kind\) === "record-close"\) \{ setOpen\(true\); setKind\("high"\);/);
    assert.match(tile, /<RecordClose initial=\{initial\.a\}/);
    assert.match(page, /c\.id\.startsWith\("tile:record-close"\) \? "Open a coin's record close" : "Open Coin vs Coin"/);
    assert.match(page, /setEntry\(\{ template: tpl, a: u\.get\("a"\) \?\? "", b: u\.get\("b"\) \?\? "", kind: u\.get\("kind"\) \}\)/);
  });
  test("H9: the reserved-ticker sentence is the library's, word for word; Free only when there is a suggestion", () => {
    assert.equal(RESERVED_TICKER_LINE, RESERVED_TICKER_REFUSAL);
    assert.match(card, /\{t\.suggestions\.length > 0 && coin && <p/);
  });
  test("M2/M4: the drain line names the unit of the pattern, and the review's drain warning shows on the Burns step", () => {
    // 2026-10-13: the outcome passes through whole (two of the three results included: drain.ts teamDrainUnit)
    assert.match(page, /teamDrainUnit\(teamOutcome \?\? "win", !!rule\.inverse\)/);
    assert.match(page, /\.find\(\(w\) => \/half the pool would be gone\/\.test\(w\)\)/);
    assert.match(page, /patternWords\(o\.id, \{ [^}]*gameLabel \}\)/);
  });
  test("helpers: the verifier waits for a well-formed signature; the verify page drops the catalogue line for an invalid address", () => {
    const rv = read("src/app/burnticker/check/ReceiptVerifier.tsx"), vp = read("src/app/burnticker/verify/page.tsx");
    assert.match(rv, /disabled=\{busy \|\| sigCheck\.state !== "valid"\}/);
    assert.match(vp, /\{v\.verdict === "invalid" \? "" : ` The catalogue was read on \$\{v\.cluster\}\.`\}/);
  });
});

describe("medium and low page items", () => {
  test("M1: the Follows chip asks first, like Start over, and step 1 shows the earlier choice", () => {
    assert.match(page, /if \(p === "follow"\) \{ if \(needsConfirm\) \{ setConfirmJump\(true\); return; \}/);
    assert.match(page, /const was = guide\.follow; setConfirmJump\(false\); startOver\(true\); setPrevFollow\(was\);/);
    assert.match(page, /<FollowStep search=\{searchBlock\} value=\{guide\.follow \?\? prevFollow\}/);
    for (const s of [JUMP_CONFIRM_LINE, JUMP_CONFIRM_YES, JUMP_CONFIRM_NO]) plain(s);
  });
  test("M6: the race picker is full width without the category column; states by name; human dates; no placeholder count", () => {
    assert.match(page, /guide\.pairKind === "candidates" \? "" : "md:grid-cols-\[200px_minmax\(0,1fr\)\]"/);
    assert.match(page, /\[\.\.\.estates\]\.sort\(\(x, y\) => x\.name\.localeCompare\(y\.name\)\)/);
    assert.match(page, /settles \{humanDay\(r\.settlesOn\)\}/);
    assert.doesNotMatch(page, /unnamed placeholder outcome/);
    assert.equal(humanDay("2026-11-04"), "Wed, Nov 4, 2026");
    assert.equal(humanDay("soon-ish"), "soon-ish");
  });
  test("M8: Unusual cases only for what the league can have", () => {
    assert.match(page, /const espnCases = espnParsed \? \[\.\.\.\(leagues\.find\(\(l\) => l\.id === espnParsed\.league\)\?\.draws \? \[78\] : \[\]\), 79, \.\.\.\(espnParsed\.league === "mlb" \? \[80\] : \[\]\)\] : \[\];/);
  });
  test("M13: the rehearsal card opens its coin page", () => {
    assert.match(read("src/lib/burnticker/home.ts"), /href: "\/burnticker\/t\/REHEARSAL"/);
  });
  test("L2 L3 L4: a rejected file is cleared, the ticker takes a whole paste, the name says when it stops, disaster selects are labelled", () => {
    assert.match(fields, /onChange=\{\(e\) => \{ pick\(e\.target\.files\?\.\[0\] \?\? null\); e\.target\.value = ""; \}\}/);
    assert.equal(TICKER_PASTE_MAX, 64); assert.match(card, /maxLength=\{TICKER_PASTE_MAX\}/); assert.doesNotMatch(card, /TICKER_INPUT_MAX \+ 20/);
    assert.match(card, /c\.name\.length >= NAME_INPUT_MAX && <span [^>]*data-name-max>\{NAME_MAX_LINE\}<\/span>/);
    plain(NAME_MAX_LINE);
    assert.match(page, /aria-label=\{c\.label\} data-hazard-control=\{c\.id\}/);
  });
});
