// WEBSITE-23 (2026-10-13): the launch page's side of WIRING-SETTLED-PAIRS (owner: "since it's a settled event, the loser's burn pool should
// go to burning the winner's token"; the linked form is the default). Two candidates in one race and two teams in one game launch as ONE
// linked LaunchLab pair: step 3 offers Winner takes the burn only, side A is candidatesPairRule / gamePairRule, side B is posted as `pair`
// (never `companion`), the review renders review.settled and the 30-day both-or-neither deadline, and the pair page says the pair's own
// sentence. Pure pieces are tested directly (both shapes walked to the review the server answers); page wiring is pinned by its source.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { CANDIDATES_END_RESULT, CANDIDATES_PAIR_SENTENCE, GAME_PAIR_SENTENCE, describeRule, endText } from "@/lib/burnticker/describe";
import { candidateFacts, candidatesPairRule, gamePairFacts, gamePairRule, patternOptions, patternWords, PATTERN_REASON } from "@/lib/burnticker/guidedLaunch";
import { DEFAULT_SHARE } from "@/lib/burnticker/launchPresets";
import { gameSeries, parseEspnSeries } from "@/lib/burnticker/sources/espn";
import { SETTLED_DEADLINE_LINE, SETTLED_END_LABEL, settledAsShown, settledPairBody, settledPairFields, settledWhichCoinLine, type SettledPick } from "@/app/burnticker/launch/settledPair";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const cfg = loadCopyLintConfig();
const plain = (t: string, where = t) => {
  assert.deepEqual(lintCopy(t, cfg).hits.map((h) => `${h.phrase} (${h.rule})`), [], `${where}: ${t}`);
  assert.doesNotMatch(t, /\bwill\b|\bbuy|\bprice\b|coming soon|\bpayouts?\b|\bESPN\b/i, `${where}: ${t}`);
  assert.doesNotMatch(t, /\b20\d\d-\d\d-\d\d\b/, `${where} carries a date: ${t}`);
};
const read = (f: string) => fs.readFileSync(f, "utf8");
const page = read("src/app/burnticker/launch/page.tsx"), steps = read("src/app/burnticker/launch/GuidedSteps.tsx"), card = read("src/app/burnticker/launch/ReviewCard.tsx"), pairPage = read("src/app/burnticker/p/[pairId]/page.tsx");
const ENV = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1", BURNTICKER_PAIR_CURVE_ENABLED: "1" } as Record<string, string>;
const CID_A = `0x${"a1".repeat(32)}`, CID_B = `0x${"b2".repeat(32)}`, SLUG = "michigan-senate-election-winner";
const RACE: SettledPick = { shape: "candidates", market: CID_B, race: SLUG, names: { a: "Abdul El-Sayed", b: "Mike Rogers" } };
const GAME: SettledPick = { shape: "game", opp: "BOS", names: { a: "76ers", b: "Celtics" } };
const LINKS = [{ label: "X", url: "https://x.com/rogersmi" }];

/** What the page builds for each shape (pairRules), and side B's `pair` as it posts it to /v1/launch/review. */
function walk(p: SettledPick) {
  const rules = p.shape === "candidates"
    ? { a: candidatesPairRule(CID_A, DEFAULT_SHARE.oneShot), b: candidatesPairRule(CID_B, DEFAULT_SHARE.oneShot) }
    : { a: gamePairRule("nba", "0022500001", "PHI", DEFAULT_SHARE.oneShot), b: gamePairRule("nba", "0022500001", "BOS", DEFAULT_SHARE.oneShot) };
  const tickers = p.shape === "candidates" ? { a: "ELSAYED", b: "ROGERS" } : { a: "PHIVBOS", b: "BOSVPHI" };
  const pair = settledPairBody(p, { ticker: tickers.b.toLowerCase(), name: p.shape === "candidates" ? "Rogers MI" : "Celtics vs 76ers", creatorDescription: "", links: LINKS });
  const body = { rule: rules.a, ticker: tickers.a, name: p.shape === "candidates" ? "El-Sayed MI" : "76ers vs Celtics", raiseSol: "85", pair };
  const rv = buildLaunchReview(body as never, { env: ENV, reserved: new Set() });
  return { rules, tickers, pair, body, rv };
}

describe("website-23: both shapes walk to Review as one linked LaunchLab pair", () => {
  for (const p of [RACE, GAME]) test(`${p.shape}: the review answers review.settled, a pair-winner end and LaunchLab (never the pair curve)`, () => {
    const { rv, tickers } = walk(p);
    assert.ok("review" in rv, JSON.stringify(rv));
    if (!("review" in rv)) return;
    assert.equal(rv.review.venue, "launchlab");
    assert.equal(rv.review.end.kind, "pair-winner");
    assert.equal(rv.review.settled?.shape, p.shape);
    assert.equal(rv.review.settled?.sentence, p.shape === "candidates" ? CANDIDATES_PAIR_SENTENCE : GAME_PAIR_SENTENCE);
    assert.equal(rv.review.settled?.flow.version, "winner-takes-the-burn");
    assert.ok((rv.review.settled?.descriptionB ?? "").length > 0, "coin B's description");
    assert.match(rv.review.settled?.descriptionB ?? "", new RegExp(`\\$${tickers.b}`));
    assert.equal(rv.review.coins.length, 2);
    if (p.shape === "candidates") assert.equal(rv.review.end.result, CANDIDATES_END_RESULT);
    assert.deepEqual(rv.review.problems.filter((x) => /candidates|race|game|pair/i.test(x)), [], rv.review.problems.join(" | "));
    for (const s of [rv.review.settled!.sentence, rv.review.settled!.flow.oneLiner, ...rv.review.settled!.flow.steps.map((x) => x.text), ...rv.review.settled!.flow.outcomes.map((x) => x.then)]) plain(s, `${p.shape} review`);
  });
  test("the page describes each side as the bundle builds it (the race's or the game's own end)", () => {
    for (const p of [RACE, GAME]) {
      const { rules, tickers } = walk(p);
      const a = settledAsShown(rules.a, "A", p, rules), b = settledAsShown(rules.b, "B", p, rules);
      if (p.shape === "candidates") { assert.deepEqual((a.pair as { race?: unknown }).race, { slug: SLUG, markets: [CID_A, CID_B] }); assert.equal(endText(a).result, CANDIDATES_END_RESULT); }
      else assert.deepEqual((b.pair as { game?: unknown }).game, { series: [gameSeries("nba", "0022500001", "PHI", "win"), gameSeries("nba", "0022500001", "BOS", "win")] });
      assert.equal(endText(a).kind, "pair-winner"); assert.equal(endText(b).kind, "pair-winner");
      const ta = describeRule(a, { ticker: tickers.a }), tb = describeRule(b, { ticker: tickers.b });
      plain(ta.oneLiner, `${p.shape} A`); plain(tb.oneLiner, `${p.shape} B`); assert.match(ta.paragraph, p.shape === "candidates" ? /Two markets, one race/ : /One game, two teams/); assert.doesNotMatch(ta.oneLiner, /one race|one game, two/i, "the review sentence adds the pair sentence once");
    }
  });
});

describe("website-23: the posted body shape", () => {
  test("side B rides in `pair` with { market, race, names } for a race and { opp, names } for a game; never a companion, never a rule B", () => {
    const race = walk(RACE).body, game = walk(GAME).body;
    assert.deepEqual(race.pair, { ticker: "ROGERS", name: "Rogers MI", creatorDescription: "", links: LINKS, market: CID_B, race: SLUG, names: { a: "Abdul El-Sayed", b: "Mike Rogers" } });
    assert.deepEqual(game.pair, { ticker: "BOSVPHI", name: "Celtics vs 76ers", creatorDescription: "", links: LINKS, opp: "BOS", names: { a: "76ers", b: "Celtics" } });
    for (const b of [race, game]) { assert.ok(!("companion" in b)); assert.ok(!("rule" in (b.pair as object))); }
    assert.deepEqual(settledPairFields({ ...RACE, market: CID_B.toUpperCase().replace("0X", "0x") }), { market: CID_B, race: SLUG, names: RACE.names });
    assert.deepEqual(settledPairFields({ ...GAME, opp: "bos" }), { opp: "BOS", names: GAME.names });
    // side A: candidate A's market, YES only, 100 %, the end sink on; one game: its own team's WIN series of that game
    const a = walk(RACE).rules.a, g = walk(GAME).rules.a;
    assert.equal(a.market, CID_A); assert.equal(a.binary?.onYes?.fractionOfPool, 1); assert.equal(a.binary?.onNo, null); assert.equal(a.onEnd?.endSink, true);
    assert.equal(parseEspnSeries(g.series ?? "")?.outcome, "win"); assert.equal(g.onEnd?.endSink, true);
  });
  test("the page posts that body to the review and to the launch, with LaunchLab as the venue", () => {
    assert.match(page, /\? \{ pair: \{ \.\.\.settledPairBody\(settledPick, \{ ticker: tickerB, name: nameB, creatorDescription: profileB\.description, links: creatorLinks\([^\n]*\), descCtx: ctxB \} \}/);
    assert.match(page, /\.\.\.\(pairOn && ruleB \? \(settledPick\n/);
    assert.match(page, /const settledFields = settledPick \? \{ \.\.\.settledPairFields\(settledPick\), descCtx: ctxB \} : \{\};/);
    assert.match(page, /\.\.\.profileBody\(profileB\), \.\.\.settledFields \} \}, \(b\) => postPairLaunch\(\(u, init\) => launchFetch\(u, init as never\), b, meetingsOn \|\| settledPick \? "launchlab" : pairVenue\)\);/);   // review of block M: through sendWithProofFallback
    assert.match(page, /if \(pairOn && ruleB && !meetingsOn && !settledPick\) \{/, "never two separate launches");
    assert.match(page, /if \(pairOn && elPick\) return \{ a: candidatesPairRule\(elPick\.a\.conditionId, DEFAULT_SHARE\.oneShot\)/);
    assert.match(page, /if \(pairMode === "game" && gameSides\) \{ const f = oneGameShare\(dialsFor\(gamePairRule\(/);
    assert.match(page, /return \{ a: gamePairRule\(gameSides\.league, gameSides\.eventId, gameSides\.a, f\), b: gamePairRule\(gameSides\.league, gameSides\.eventId, gameSides\.b, f\) \}/);
    // the gates stay: the editor latch, prepareIfCurrent, the reviewed-draft check
    assert.match(page, /if \(editedFor !== subjectKey\) \{ setNameAuto\(true\); setTickerAuto\(true\); setEditedFor\(null\);/);
    assert.match(page, /const out = await prepareIfCurrent\(sentRev, \(\) => curDraft\.current,/);
    assert.match(page, /if \(!rule \|\| !reviewMatchesDraft\(reviewSlot, curRev\.current\)\) return;/);
  });
});

describe("website-23: the sentences", () => {
  test("step 2: the candidates picker line is the race sentence", () => {
    assert.match(steps, /opt\("candidates", "Two candidates in one race", CANDIDATES_PAIR_SENTENCE, null\)/);
    assert.doesNotMatch(steps, /Each candidate gets its own coin/);
  });
  test("step 3: Winner takes the burn only, preselected, the other cards greyed with the reason, for both shapes", () => {
    const cases = [
      { po: patternOptions({ follow: "rivalry", rule: candidatesPairRule(CID_A), titleMarket: "loading", pairKind: "candidates" }), reason: PATTERN_REASON.candidatesLinked, words: patternWords("winner", { follow: "rivalry", pairKind: "candidates" }).sentence, sentence: CANDIDATES_PAIR_SENTENCE },
      { po: patternOptions({ follow: "rivalry", rule: gamePairRule("nba", "0022500001", "PHI"), titleMarket: "loading", pairKind: "teams", rivalryScope: "game", meeting: true }), reason: PATTERN_REASON.gameLinked, words: patternWords("winner", { follow: "rivalry", pairKind: "teams", rivalryScope: "game" }).sentence, sentence: GAME_PAIR_SENTENCE },
    ];
    for (const { po, reason, words, sentence } of cases) {
      assert.equal(po.preselected, "winner");
      assert.deepEqual(po.options.filter((x) => x.available).map((x) => x.id), ["winner"]);
      assert.ok(po.options.filter((x) => !x.available).some((x) => x.reason === reason));
      assert.equal(words, sentence);
    }
    assert.match(page, /guide\.follow === "rivalry" \? \(meetingsOn \|\| settledPick \? "winner" :/);
    assert.match(page, /if \(meetingsOn \|\| settledPick\) return;/);
  });
  test("the review: the pair line, the facts for one game, the money path, coin B's description and the 30-day deadline", () => {
    assert.match(page, /pairLine=\{settledPick \? reviewSettled\?\.sentence \?\? settledLine :/);
    assert.match(page, /settledPick\?\.shape === "game" \? gamePairFacts\(\{ a: ticker, b: tickerB, teamA: A, teamB: B, tie: tieWord \}\) : matchupFacts\(/);
    assert.match(page, /\{reviewSettled\?\.flow && <FundsFlowView flow=\{reviewSettled\.flow\} open saidAbove=\{reviewSettled\.sentence \?\? settledLine\} \/>\}/);
    // website-24: coin B's description is the review's own (review.settled.descriptionB, written from pair.descCtx = the page's ctxB)
    assert.match(page, /\{settledPick && reviewSettled\?\.descriptionB && <section [^\n]*\{reviewSettled\.descriptionB\}<\/p><\/section>\}/);
    assert.match(page, /const descB = meetingsOn \? \(reviewMeetings\?\.descriptionB \?\? finalDescriptionB\) : settledPick \? \(reviewSettled\?\.descriptionB \|\| finalDescriptionB\) : finalDescriptionB;/);
    assert.match(page, /value: settledPick \? settledWhichCoinLine\(settledPick, \{ a: ticker \|\| "A", b: tickerB \|\| "B" \}\) :/);
    const wc = settledWhichCoinLine(RACE, { a: "ELSAYED", b: "ROGERS" }), wg = settledWhichCoinLine(GAME, { a: "PHIVBOS", b: "BOSVPHI" });
    assert.equal(wc, "$ELSAYED if Abdul El-Sayed wins, or $ROGERS if Mike Rogers wins. Only the winning coin burns, and it takes the other coin's pool at the end.");
    assert.equal(wg, "$PHIVBOS if the 76ers win, or $BOSVPHI if the Celtics win. Only the winning coin burns, and it takes the other coin's pool at the end.");
    plain(wc); plain(wg);
    assert.match(page, /const settledEndFact = `\$\{SETTLED_END_LABEL\}\. \$\{end\.sentences\.join\(" "\)\} \$\{SETTLED_DEADLINE_LINE\}`;/);
    assert.match(page, /settledPick \? <EndSection title=\{SETTLED_END_LABEL\} sentences=\{\[\.\.\.end\.sentences, SETTLED_DEADLINE_LINE\]\} options=\{\[\]\} \/>/);
    assert.match(card, /\{p\.pairFacts && p\.pairLine && <p [^>]*data-settled-line>\{p\.pairLine\}<\/p>\}/, "the sentence shows above the four facts");
    assert.equal(SETTLED_DEADLINE_LINE, "Both coins need a trading pool within 30 days, or the pair is void and each coin burns down on itself.");
    const cf = candidateFacts({ a: "ELSAYED", b: "ROGERS", candA: "Abdul El-Sayed", candB: "Mike Rogers" }), gf = gamePairFacts({ a: "PHIVBOS", b: "BOSVPHI", teamA: "76ers", teamB: "Celtics", tie: "tie" });
    for (const s of [SETTLED_DEADLINE_LINE, SETTLED_END_LABEL, CANDIDATES_PAIR_SENTENCE, GAME_PAIR_SENTENCE, ...Object.values(cf).slice(1), ...Object.values(gf).slice(1)]) plain(s);
  });
  test("the pair page says the settled pair's sentence in place of 'Both coins read the same market'", () => {
    assert.match(pairPage, /const settledLineOf = \(statement: string\): string \| null => \(\/ Candidates pair \/\.test\(statement\) \? CANDIDATES_PAIR_SENTENCE : \/ One-game pair \/\.test\(statement\) \? GAME_PAIR_SENTENCE : null\);/);
    assert.match(pairPage, /: settledLineOf\(d\.a\.status\.rules\.statement\) \? <span data-settled-pair-line>/);
  });
  test("the single-game share row: a linked pair on one result, 100 % only (WIRING-AUDIT12 P1-1)", () => {
    const g = walk(GAME).rules.a;
    assert.equal(g.binary?.onYes?.fractionOfPool ?? (g.scalar?.perUnit as { fractionOfPool?: number } | undefined)?.fractionOfPool, 1);
    // WIRING-AUDIT12 P1-1: the row comes from sharePresetsForRule; one game is a linked pair, so its row is 100 % only
    assert.match(page, /const shareOptions = rule \? sharePresetsForRule\(rule, \{ linked: linkedPair \}\) : SHARE_PRESETS\.recurring;/);
  });
});
