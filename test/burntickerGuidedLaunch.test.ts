// WEBSITE-19 (2026-10-12): the guided launch (four questions, then the review), generated and reserved names, the ticker check at review,
// one-shots at 100 / 50 %, graduation explained, and the walkthrough and intent-audit fixes that live in pure code. The page wiring is
// pinned by its source, the copy by the lint.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { BURNTICKER_RULES_SCHEMA, DEFAULT_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { teamSeries, gameSeries } from "@/lib/burnticker/sources/espn";
import { nwsSeries } from "@/lib/burnticker/sources/nws";
import { applyDial, dialsFor } from "@/lib/burnticker/dials";
import { describeRule } from "@/lib/burnticker/describe";
import { DEFAULT_SHARE, SHARE_PRESETS } from "@/lib/burnticker/launchPresets";
import { FOLLOW_CHOICES, GUIDED_STEPS, PATTERNS, PATTERN_ORDER, PATTERN_REASON, EVENT_LEVEL_REFUSAL, beforeGraduationLine, budgetCopy, candidateFacts, endSentences, eventLevelRule, graduationExplainer, matchupFacts, oneShotSentences, pairIdentityProblems, pairNames, pairTickers, patternOptions, progressLabel, teamTicker, teamTickerForRule, unitPhrase } from "@/lib/burnticker/guidedLaunch";
import { RESERVED_REFUSAL, RESERVED_TICKER_REFUSAL, isReserved, loadReserved, normaliseName, parseReserved, reservedProblem, tickerSuggestions } from "@/lib/burnticker/reservedNames";
import { inUseWarning, tickerChecks } from "@/lib/burnticker/tickerCheck";
import { buildLaunchReview, graduationLines, DISPUTE_DEFAULT } from "@/lib/burnticker/launchReview";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { imageFileProblem, imageFromTransfer, pastedImageName, IMAGE_WAYS } from "@/lib/burnticker/creatorProfile";
import { tileRule } from "@/lib/burnticker/derby/tile";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { CREATOR_LAUNCHES_FLAG } from "@/lib/burnticker/creatorLaunches";
import { universalSearch } from "@/lib/burnticker/search";
import { fieldsFromRule, composeRule } from "@/lib/burnticker/launchDraft";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";
import { espnFixtureClient, ESPN_NOW } from "./burntickerFirstPartyHelpers.ts";

const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); assert.doesNotMatch(t, /\bwill\b/i, t); };
const read = (f: string) => fs.readFileSync(f, "utf8");
const page = read("src/app/burnticker/launch/page.tsx"), steps = read("src/app/burnticker/launch/GuidedSteps.tsx"), card = read("src/app/burnticker/launch/ReviewCard.tsx"), tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx"), fields = read("src/app/burnticker/launch/ProfileFields.tsx");
const season = (abbr: string, outcome: "win" | "loss" = "win") => ({ ...firstPartyRule(teamSeries("mlb", abbr, outcome, { kind: "season", year: 2026 }), 0.02), onEnd: { ...DEFAULT_ON_END } }) as BurnRule;
const poly = (fraction = 1): BurnRule => ({ schema: BURNTICKER_RULES_SCHEMA, oracle: "polymarket", series: null, market: "0x" + "ab".repeat(32), filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: fraction }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, onEnd: { ...DEFAULT_ON_END } } as BurnRule);
const debt = (): BurnRule => ({ ...firstPartyRule("treasury.debt", 0.02), onEnd: { ...DEFAULT_ON_END } }) as BurnRule;
const env = { BURNTICKER_CLUSTER: "mainnet", [CREATOR_LAUNCHES_FLAG]: "1" };

describe("the four questions", () => {
  test("the step order, the questions and the progress line are pinned; question 1 offers the five things a coin can follow", () => {
    // website-20 (audit 6 item 12): five honest steps; the end is a stated section on the review
    assert.deepEqual(GUIDED_STEPS.map((s) => s.id), ["follow", "which", "burn", "name", "review"]);
    assert.deepEqual(GUIDED_STEPS.map((s) => s.question), ["What does this coin follow?", "Which one?", "How does it burn?", "Name and look", "Review and launch"]);
    assert.equal(progressLabel(0), "1 of 5"); assert.equal(progressLabel(4), "5 of 5");
    // website-20 pass A item 2: shorter entry labels
    assert.deepEqual(FOLLOW_CHOICES.map((c) => c.label), ["Team", "Event outcome", "Published data", "Coin comparison", "Rivalry"]);
    assert.deepEqual(PATTERN_ORDER.map((p) => PATTERNS[p].label), ["Every time it happens", "When it does not happen", "Once, when it settles", "Winner takes the burn"]);
    for (const c of FOLLOW_CHOICES) { clean(c.sentence); clean(c.example); }
    for (const p of Object.values(PATTERNS)) clean(p.sentence);
    for (const r of Object.values(PATTERN_REASON)) clean(r);
  });

  test("a team: every win (chosen), its fade side, once on the title market (greyed until one is found), winner greyed with its reason", () => {
    const r = season("LAD");
    const none = patternOptions({ follow: "team", rule: r, titleMarket: "none" });
    assert.equal(none.preselected, "every");
    const by = Object.fromEntries(none.options.map((o) => [o.id, o]));
    assert.equal(by.every.available, true); assert.equal(by.fade.available, true);
    assert.equal(by.once.available, false); assert.equal(by.once.reason, "No market for this yet.");
    assert.equal(by.winner.available, false); assert.match(by.winner.reason!, /needs two linked coins/);
    assert.equal(patternOptions({ follow: "team", rule: r, titleMarket: "found" }).options.find((o) => o.id === "once")!.available, true);
    // each pattern builds the rule the keeper runs: every = the season rule; fade = inverse on; once = a one-shot market at 100 %
    const fade = applyDial(r, "inverse", "on");
    assert.equal(fade.inverse, true); assert.equal(patternOptions({ follow: "team", rule: fade, titleMarket: "none" }).preselected, "fade");
    assert.deepEqual(dialsFor(poly()).bounds.max, 1); assert.equal(patternOptions({ follow: "team", rule: poly(), titleMarket: "found" }).preselected, "once");
  });

  test("a market: once (chosen), the NO side as its 'does not happen', every greyed; a number: every, fade, once greyed; a release: once only", () => {
    const m = patternOptions({ follow: "market", rule: poly() });
    assert.equal(m.preselected, "once"); assert.equal(m.options.find((o) => o.id === "every")!.reason, PATTERN_REASON.marketOnce);
    assert.equal(applyDial(poly(), "side", "no").binary!.onNo!.fractionOfPool, 1);
    const n = patternOptions({ follow: "number", rule: debt() });
    assert.equal(n.preselected, "every"); assert.equal(n.options.find((o) => o.id === "once")!.reason, PATTERN_REASON.feedOnce);
    assert.equal(n.options.find((o) => o.id === "fade")!.available, true);
    const rel = patternOptions({ follow: "number", rule: { ...firstPartyRule("ll2.launch:abc", 1) } as BurnRule });
    assert.equal(rel.preselected, "once"); assert.equal(rel.options.find((o) => o.id === "every")!.available, false);
  });

  test("pairs: two coins take winner or the flippening; two teams take every, fade or one game; two candidates take winner only (owner 2026-10-13: the linked form)", () => {
    const c = patternOptions({ follow: "coins", rule: null });
    assert.deepEqual(c.options.filter((o) => o.available).map((o) => o.id), ["once", "winner"]); assert.equal(c.preselected, "winner");
    const t = patternOptions({ follow: "rivalry", rule: season("LAD", "loss"), pairKind: "teams" });
    assert.deepEqual(t.options.filter((o) => o.available).map((o) => o.id), ["every", "fade", "once"]); assert.match(t.options.find((o) => o.id === "winner")!.reason!, /two separate coins/);
    const e = patternOptions({ follow: "rivalry", rule: poly(), pairKind: "candidates" });
    assert.deepEqual(e.options.filter((o) => o.available).map((o) => o.id), ["winner"]); assert.equal(e.preselected, "winner");
  });

  test("the end sentence matches the end sink the rule pins (EndSink kinds 0 and 3, or none)", () => {
    const champ = endSentences(season("LAD"), { team: "the Dodgers" });
    assert.equal(champ.kind, "flagship"); assert.deepEqual(champ.sentences.slice(0, 2), ["If the Dodgers win the championship, the rest of the pool burns here.", "If they do not, the rest goes to $DEFICIT's burn."]);
    assert.equal(endSentences(poly()).kind, "flagship"); assert.match(endSentences(poly()).sentences[0], /goes to \$DEFICIT's burn/);
    const pairRule = { ...poly(), pair: { winnerTakesBurn: true } } as unknown as BurnRule;
    assert.equal(endSentences(pairRule).kind, "pair-winner"); assert.match(endSentences(pairRule).sentences[0], /rival coin/);
    // a rule with the wind-down alone (no end sink) says the wind-down; since the owner rule of 2026-10-13 a Coin vs Coin rule (derby/tile.ts
    // tileRule) carries the end sink too, so a losing coin never burns itself (a new launch with the wind-down alone is refused)
    assert.match(read("src/lib/burnticker/derby/tile.ts"), /onEnd: \{ windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true \}/);
    const derby = { ...season("LAD"), onEnd: { windDownDays: 28, sweepThresholdLamports: 50_000_000 } } as BurnRule;
    assert.equal(endSentences(derby).kind, "self");
    for (const r of [season("LAD"), poly(), pairRule, derby, debt()]) { const e = endSentences(r); for (const s of e.sentences) clean(s); assert.equal(e.options.filter((o) => o.available).length <= 1, true); for (const o of e.options) { clean(o.label); if (o.reason) clean(o.reason); } }
  });

  test("the page: question 1 on the first screen with the free text as one line above the cards (website-22, QA 9 item 39), Back and Start over at every step", () => {
    assert.match(page, /step === "choose" && guide\.phase === "follow" && <FollowStep search=\{searchBlock\}/);
    assert.doesNotMatch(page, /data-classic>/, "the older chooser in a disclosure is gone");
    assert.match(page, /<GuidedTop phase=\{guide\.follow \? guide\.phase : "follow"\} answers=\{guideAnswers\} onJump=\{jumpTo\} onBack=\{guide\.follow \? back : null\} onStartOver=\{\(\) => startOver\(\)\}/);
    assert.match(steps, /data-start-over>Start over<\/button>/); assert.match(steps, /data-nav className="underline" onClick=\{onBack\}>← Back<\/button>/);
    assert.match(page, /if \(guide\.follow && guide\.phase === "burn"\) \{/); assert.match(page, /if \(guide\.follow && guide\.phase === "name"\) \{/);
    assert.doesNotMatch(page, /data-help="search" autoFocus/, "nothing scrolls on the first paint");
  });

  test("owner: the page opens at the top with a saved draft offered in one line, never restored by itself; Start over clears the store", () => {
    const mount = page.slice(page.indexOf("  useEffect(() => {\n    // launch night 2026-10-13"), page.indexOf("    setReady(true);"));
    // launch night 2026-10-13: the mount applies a draft only for "Start a new launch from the review" (?resume=review); otherwise it offers
    // WIRING-AUDIT12 P1-1: the draft is applied through resumeFrom (migrateLinkedShare, then restoreFrom)
    assert.equal((mount.match(/resumeFrom\(/g) ?? []).length, 1, "the mount effect applies a draft only on ?resume=review");
    assert.match(mount, /else if \(resumeReview && offer\) resumeFrom\(offer\);\n\s+else if \(offer\) setSavedDraft\(offer\);/);
    // website-20 (audit 6 item 4): every step change, the guided phases included, starts at the top with the heading focused
    assert.match(page, /const y = restoreScroll\.current; restoreScroll\.current = null; window\.scrollTo\(\{ top: y \?\? 0 \}\);[\s\S]{0,260}\[data-step-heading\][\s\S]{0,120}\}, \[step, guide\.phase, guide\.pairKind\]\);/);
    assert.match(page, /data-saved-draft>\{savedDraftLine\(savedDraft\)\} <button type="button" data-nav className="underline" onClick=\{resumeDraft\}>Resume<\/button>/);
    assert.match(page, /const startOver = \(force = false\) => \{ if \(!force && needsConfirm\) \{ setConfirmOver\(true\); return; \} setPrevFollow\(null\); setConfirmOver\(false\); try \{ sessionStorage\.removeItem\(STORE\);/);
    assert.match(page, /const needsConfirm = !!guide\.follow \|\| step !== "choose" \|\| \(!nameAuto && !!name\.trim\(\)\) \|\| \(!tickerAuto && !!ticker\.trim\(\)\) \|\| !!profile\.image \|\| !!profileB\.image;/);
    assert.match(page, /const linked = wantPair \|\| q0\.get\("derby"\) === "1" \|\| !!q0\.get\("template"\) \|\| !!q0\.get\("like"\) \|\| !!q0\.get\("league"\);\n[\s\S]{0,300}if \(linked\) \{ try \{ sessionStorage\.removeItem\(STORE\); \}/, "snag 6: a link never reopens a saved draft");
  });
});

describe("names: generated by default, reserved list, the ticker check at review", () => {
  test("generated tickers: a pair, a sports pair, a season coin, a one-shot, a window and the fade side", () => {
    assert.deepEqual(pairTickers("WIF", "BONK"), { a: "WIFVBONK", b: "BONKVWIF" });
    assert.deepEqual(pairTickers("WIF", "GIGA"), { a: "WIFVGIGA", b: "GIGAVWIF" });
    assert.deepEqual(pairTickers("LAD", "NYY"), { a: "LADVNYY", b: "NYYVLAD" });
    assert.deepEqual(pairNames("WIF", "BONK"), { a: "WIF vs BONK, WIF side", b: "BONK vs WIF, BONK side" });
    assert.equal(teamTickerForRule(season("LAD"), "LAD"), "LADWIN", "cheap-features item 4: direction by default");
    assert.equal(teamTicker("LAD", { league: "mlb", window: "title" }), "LADWS");
    assert.equal(teamTicker("LAD", { window: "next", games: 5 }), "LADWINN5");
    assert.equal(teamTicker("LAD", { window: "season", outcome: "loss" }), "LADLOSS");
    assert.equal(teamTickerForRule(applyDial(season("LAD"), "inverse", "on"), "LAD"), "LADNOWIN");
    for (const t of ["WIFVBONK", "LADVNYY", "LADWIN", "LADWS", "LADWINN5", "LADNOWIN"]) assert.match(t, /^[A-Z0-9]{2,10}$/);
    assert.match(page, /const tk = freePairTickers\(\{ abbr: g\.pair\.a\.abbr, code: g\.pair\.a\.code \}, \{ abbr: g\.pair\.b\.abbr, code: g\.pair\.b\.code \}, tickerGuard\), nm = pairNames\(/, "snag 10: a Matchup's sides are named symmetrically");
    // launch audit 248: the tile's generated names come from coinPicker.ts generatedNames (pairTickers + pairNames, per edited field)
    assert.match(tile, /setNames\(\(n\) => generatedNames\(a, b, n, edited, \{ flip \}\)\)/, "website-26 (WIRING-FEATURES item 15): the tile passes the mode");
    assert.match(read("src/lib/burnticker/coinPicker.ts"), /const t = coinvsTickers\(a\.symbol, b\.symbol, true\), n = pairNames\(a\.symbol, b\.symbol\)/);
    assert.match(read("src/lib/burnticker/coinPicker.ts"), /const t = coinvsTickers\(a\.symbol, b\.symbol, false\)/, "cheap-features item 15: a daily race's sides carry the fight");
  });

  test("the reserved list: one config file, the platform and flagship names and their variants, tickers and names, any case or spacing", () => {
    const l = parseReserved(JSON.parse(read("config/burnticker/reserved-tickers.json")));
    for (const x of ["BURNTICKER", "BURNTICKR", "BURNTCKR", "BRNTICKER", "BURNTICK", "DEFICIT", "DEFICIT2", "DEFICITX", "USADEFICIT", "USDEFICIT", "DEBT", "REHEARSAL", "USA_DEFICIT"]) assert.ok(l.reserved.includes(x), x);
    const set = loadReserved();
    for (const x of ["burnticker", "Burn Ticker", "$DEFICIT", "usa_deficit", "Debt", "us deficit"]) assert.ok(isReserved(x, set), x);
    for (const x of ["LAD", "DEBTUP", "DEFICITS", "Dodgers"]) assert.equal(isReserved(x, set), false, x);
    assert.equal(normaliseName(" Burn-Ticker! "), "BURNTICKER");
    assert.equal(reservedProblem({ ticker: "LAD", name: "Burnticker" }, set), "That name is reserved for the platform.");
    assert.equal(RESERVED_REFUSAL, "That name is reserved for the platform.");
    const r = buildLaunchReview({ rule: season("LAD"), ticker: "DEFICIT", name: "Deficit Hawks" }, { env, reserved: set });
    assert.ok("review" in r); assert.ok(r.review.problems.includes(RESERVED_TICKER_REFUSAL)); assert.equal(r.review.signable, false);   // sources-7 H9: a reserved ticker is called a ticker
  });

  test("the launch route refuses a reserved ticker or name on either side of a pair (403 reserved)", async () => {
    const w = await makeWorld();
    const base = { creator: CREATOR, rule: season("LAD"), firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } };
    const a = await prepareLaunch(w.p, { ...base, ticker: "BURNTICK", name: "Dodgers" }, { register: false }) as { error?: { status: number; body: { code: string; error: string } } };
    assert.equal(a.error?.status, 403); assert.equal(a.error?.body.code, "reserved"); assert.equal(a.error?.body.error, RESERVED_TICKER_REFUSAL);
    const b = await prepareLaunch(w.p, { ...base, ticker: "LADX", name: "Rehearsal" }, { register: false }) as { error?: { body: { code: string } } };
    assert.equal(b.error?.body.code, "reserved");
  });

  // prelaunch audit 2026-10-18 A-2: a ticker another creator holds is refused (no longer a warning the creator may keep)
  test("a ticker in use by another creator is refused, with two free suggestions that pass the lookalike check; an expired draft frees it", () => {
    const rows = [{ mint: "M1", name: "Dodgers Season", ticker: "LAD", rulesJson: JSON.stringify(season("LAD")) }];
    const inUse = (t: string) => (t === "LAD" ? rows : t === "LADFANS" ? [{ ...rows[0], ticker: "LADFANS", mint: "M2" }] : []);
    // continuous audit HB-6: the suggestions come from the coin's own rule (its generated ticker), never the held ticker with a word added
    const [c] = tickerChecks([{ side: "A", ticker: "lad", generated: "DODGERS", team: true }], { inUse, reserved: new Set() });
    assert.equal(c.inUse[0].href, "/burnticker/t/M1"); assert.deepEqual(c.suggestions, ["DODGERS", "DODGERFANS"]); assert.equal(c.taken, true);
    assert.match(c.warning!, /^\$LAD is already the ticker of another Burnticker coin\. Please pick another one\.$/);
    clean(c.warning!);
    assert.equal(inUseWarning("LAD", []), null);
    assert.deepEqual(tickerChecks([{ side: "A", ticker: "LAD" }], { inUse: () => [], reserved: new Set() })[0].inUse, [], "a retired draft the registry no longer lists (tokensByTicker skips expired) frees the ticker");
    assert.deepEqual(tickerSuggestions("ABCDEFGHIJ", () => true), ["ABCDEFGHI2", "ABCDEFGHI3"]);
    assert.match(read("src/app/api/burnticker/v1/launch/review/route.ts"), /\(\{ tickers, coins \} = reviewTickerChecks\(r\.review\.coins, ruleA, /);
    assert.match(card, /data-ticker-check=\{t\.side\}/);
  });

  test("intent audit item 5: the two sides of a new pair must be told apart, ticker and name, any case or spacing", () => {
    assert.deepEqual(pairIdentityProblems({ ticker: "TEAMSOL", name: "Team SOL" }, { ticker: "teamsol ", name: "Team ETH" }), ["The two coins need different tickers."]);
    assert.deepEqual(pairIdentityProblems({ ticker: "A1", name: "Team SOL" }, { ticker: "B1", name: "team  sol" }), ["The two coins need different names."]);
    assert.match(tile, /identity\.length === 0/); assert.match(page, /&& identity\.length === 0;/);
    const r = buildLaunchReview({ rule: season("LAD", "loss"), ticker: "LADVMIL", name: "Same", companion: { ticker: "MILVLAD", name: "same" } }, { env, reserved: new Set() });
    assert.ok("review" in r); assert.ok(r.review.problems.includes("The two coins need different names."));
  });

  test("intent audit 2 item 3: a generated name follows the source; one the creator typed is kept and said so", () => {
    // continuous audit 2026-10-19T1919Z PROD-02: the source's suggestion is worded for the side the coin burns on (namePolarity.ts)
    assert.match(page, /const want0 = genTicker \?\? sug\.ticker \?\? text\.ticker, want = want0 \? fixGen\(want0\) : want0;/); assert.match(page, /const wantName = sugSwap \? hazardNameFor\(\{ \.\.\.text, ticker: sug\.ticker!, name: sug\.name! \}\) : sug\.name \?\? hazardNameFor\(text\);/);   // HB-189: a swapped card ticker takes its own name   // HB-30: a refused generated ticker maps to its free one; HB-117: a hazard name follows its swapped ticker
    assert.match(page, /setSrcSuggest\(\{ name: o\.name \?\? null, ticker: o\.ticker \?\? null, side: ruleSide\(r\) \}\);/);
    assert.doesNotMatch(page, /if \(o\.name\) setName\(o\.name\)/, "a source never writes over the name directly");
    assert.doesNotMatch(page, /setTickerAuto\(auto\); setNameAuto\(auto\)/);
    assert.match(page, /Keeping the name you typed, “\$\{name\}”\. It stays while you set up this coin; picking a different thing to follow generates a new one\. Press edit to change it\./);
  });
});

describe("one-shots, budgets and the end before graduation", () => {
  test("one-shot presets are 100 % (50 % only with burn dispersal, review 10 F1) everywhere a rule resolves once (a market, a release, the flippening); the Dodgers sentence pins", () => {
    assert.deepEqual(SHARE_PRESETS.oneShot, [1]); assert.deepEqual(SHARE_PRESETS.oneShotDispersal, [1, 0.5]); assert.equal(DEFAULT_SHARE.oneShot, 1);
    assert.equal(dialsFor(poly()).bounds.max, 1); assert.equal(dialsFor(firstPartyRule("ll2.launch:abc", 1) as BurnRule).bounds.max, 1);
    assert.equal(dialsFor(firstPartyRule(gameSeries("mlb", "401999999", "LAD", "loss"), 0.02) as BurnRule).bounds.max, 1, "QA pass 9 #3: a single game is a one-shot (the keeper drains it after its result)");
    // WIRING-AUDIT12 P1-1: the flippening is a linked pair, so its row is 100 % only (a single one-shot keeps 100 / 50)
    assert.match(tile, /const shareRow = flip \? SHARE_PRESETS\.linkedOneShot : SHARE_PRESETS\.recurring;/); assert.match(tile, /shares=\{\{ options: \[\.\.\.shareRow\]/);
    assert.deepEqual(oneShotSentences({ share: 1, happened: "the Dodgers won the World Series", subject: "they" }), ["This coin burns its whole pool once, when Polymarket's payout says the Dodgers won the World Series.", "One burn spends at most 2% of the trading pool's SOL. The rest is burned in smaller pieces at random times over a six-hour window, at least 20 minutes apart, and a new window starts if any is left, so a large burn is usually finished within a day.", "If they do not, the rest goes to $DEFICIT's burn."]);
    assert.equal(oneShotSentences({ share: 0.5, happened: "x", subject: "it" })[0], "This coin burns 50% of its pool once, when Polymarket's payout says x.");
    assert.equal(budgetCopy(poly(), 1, null).line, "This coin burns its whole pool once, when the result is in. The whole pool is spent, but not in one go: one burn spends at most 2% of the trading pool's SOL. The rest is burned in smaller pieces at random times over a six-hour window, at least 20 minutes apart, and a new window starts if any is left, so a large burn is usually finished within a day."); // HS-43 (hourly run 8)
  });

  test("intent audit item 6 and snag 13: the budget row names the unit and says how several units compound, as the program does", () => {
    assert.equal(unitPhrase({ label: "0.1 pt moved" }, "percent"), "0.1 percentage-point change");
    assert.equal(unitPhrase({ label: "$1B added" }), "$1B added");
    const d = budgetCopy({ ...debt(), scalar: { ...debt().scalar!, unit: 1e9 } } as BurnRule, 0.02, "$1B added");
    // website-20 (audit 6 item 17, pass B items 14 and 16): one term, the burn pool; the compounding arithmetic behind a tap
    assert.equal(d.label, "Share of the burn pool per $1B added");
    assert.equal(d.line, "Each $1B added spends 2% of what is left in the burn pool buying and burning this coin.");
    assert.equal(d.math, "A reading with several units compounds, so 3 units spend about 5.88%, not 6%. One burn run buys with at most 2% of the SOL in the coin's Raydium pool; the rest is burned in smaller pieces and is usually finished within a day.");
    assert.ok(Math.abs((1 - 0.98 ** 3) * 100 - 5.88) < 0.01, "compounding as burnReceipts/math.ts buybackSpend");
    assert.match(budgetCopy(applyDial(debt(), "inverse", "on"), 0.02, "$1B added").line, /counts once at most/);
    for (const x of [d.line, budgetCopy(poly(), 0.5, null).line]) clean(x);
    assert.match(page, /if \(rule\.oracle === "catalogue" && rule\.series === "treasury\.debt"\) return rule\.inverse \? "FLATDEBT" : "DEBTUP";/, "one debt ticker from every path ($DEBT is reserved)");
  });

  test("snag 11: a one-shot due before graduation says what the keeper does with an early result", () => {
    const l = beforeGraduationLine("Oct 14, 2026");
    assert.equal(l, "This result is due around Oct 14, 2026. A coin burns only after it graduates. If the result comes first, it is recorded, and the burn waits until the coin graduates and its pool is registered. Then the rest of the pool goes to $DEFICIT's burn.");
    clean(beforeGraduationLine(null));
    assert.match(read("src/lib/burnticker/endSinkKeeper.ts"), /if \(reg\.pending\(t\.mint\)\.length > 0\) return mine\(outcome, `\$\$\{t\.ticker\}: the rule ended \(\$\{label\}\); its last results are still being burned`\);/, "the end waits for queued burns");
  });

  test("graduation explained beside the raise, with the presets and fee rates from the launch constants; on the templates page too", () => {
    const g = graduationLines("mainnet");
    assert.equal(g[0], "Graduation: a new coin starts on a bonding curve. When buyers have put in the raise you pick, the curve closes, the SOL and the coin move into a Raydium pool whose liquidity is locked forever, and the burn pool starts spending.");
    assert.match(g[2], /^The raise is 24, 40, 60 or 85 SOL\. On the curve each trade pays [\d.]+% in fees, [\d.]+% of it to the coin's burn pool\. In the Raydium pool each trade pays [\d.]+%\.$/);
    for (const x of g) clean(x);
    assert.deepEqual(graduationExplainer({ raises: ["40", "60", "85"], curveFeePct: "1%", curveBurnPoolPct: "0.5%", poolFeePct: "1%" }).length, 3);
    assert.match(card, /<summary className="cursor-pointer text-neutral-300">\{GRADUATION_LABEL\}<\/summary>/); assert.match(card, /How burns are settled/);
    assert.match(read("src/app/burnticker/templates/page.tsx"), /graduationLines\(/);
  });

  test("snag 16: the dispute-window sentence on every one-market Polymarket review", () => {
    const r = buildLaunchReview({ rule: poly(), ticker: "LADWS", name: "Dodgers Title" }, { env, reserved: new Set() });
    assert.ok("review" in r); assert.equal(r.review.dispute, DISPUTE_DEFAULT); clean(DISPUTE_DEFAULT);
    const s = buildLaunchReview({ rule: season("LAD"), ticker: "LAD", name: "Dodgers" }, { env, reserved: new Set() });
    assert.ok("review" in s); assert.equal(s.review.dispute, null);
    assert.match(card, /data-dispute>\{p\.dispute\}/);
  });
});

describe("walkthrough snags and the launch-intent audits", () => {
  test("snag 1 and audit 2 item 1: an event-level market never reaches review or the builder; Browse asks which outcome", async () => {
    const ev = { ...poly(), market: null, series: "event:fed-rate-cuts-2026" } as unknown as BurnRule;
    assert.equal(eventLevelRule(ev), true); assert.equal(eventLevelRule(poly()), false);
    const r = buildLaunchReview({ rule: ev, ticker: "FEDCUTS", name: "Fed Cuts" }, { env, reserved: new Set() });
    assert.ok("problems" in r); assert.deepEqual(r.problems, [EVENT_LEVEL_REFUSAL]);
    const w = await makeWorld();
    const x = await prepareLaunch(w.p, { creator: CREATOR, ticker: "FEDCUTS", name: "Fed Cuts", rule: ev, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } }, { register: false }) as { error?: { status: number; body: { code: string } } };
    assert.equal(x.error?.status, 400); assert.equal(x.error?.body.code, "pick-one-outcome");
    assert.match(page, /c\.launchable\.ok && c\.pick\.oracle === "polymarket" && !c\.pick\.market \? <button[^>]*data-pick-outcome/);
    assert.match(page, /const pickPoly = \(m: PolyMarket\) => \{ if \(m\.closed\) return;/, "a closed outcome is refused");
  });

  test("snag 2: a Matchup has the shared raise picker and the review's own raise; Coin vs Coin too when its venue takes one", () => {
    // website-21: a rivalry series pair (two LaunchLab coins) shows the shared raise when the review answers one
    assert.match(page, /raise=\{pairOn && !ruleB \? null : \(meetingsOn \|\| settledPick\) && !shownReview\.review\?\.raise \? null : \{/);
    assert.match(tile, /raise=\{shown\.review\?\.raise \? \{ options: \[\.\.\.RAISE_PRESETS_SOL\], value: raiseSol/);
    assert.match(tile, /firstBuySol: "0", raiseSol,/);
  });

  test("snags 7 and 8, audit 2 items 4 and 5: two candidates become two coins on their own markets; the sentence comes from the market's question", () => {
    // website-23 (WIRING-SETTLED-PAIRS): two candidates in one race are one linked pair; side A on candidate A's market, side B in `pair`
    assert.match(page, /if \(pairOn && elPick\) return \{ a: candidatesPairRule\(elPick\.a\.conditionId, DEFAULT_SHARE\.oneShot\)/);
    assert.match(page, /if \(pairOn && elPick\) return \{ eventPhrase: statementOf\(elPick\.a\.question\) \}/);   // HB-128: the question said as a statement
    // website-22 (audit 10 item 6): the sentence lives in guidedLaunch.ts partyMarketWarning, with the ticker as a placeholder
    assert.match(page, /partyMarketWarning\(o\.question, sur\(o\), side\)/);
    assert.match(page, /This race has one market only, so it cannot make a pair\./);
    const f = candidateFacts({ a: "ELSAVROGE", b: "ROGEVELSA", candA: "Abdul El-Sayed (D)", candB: "Mike Rogers (R)" });
    for (const x of [f.trigger, f.burned, f.pays, f.moves, f.example]) clean(x);
    assert.doesNotMatch(f.burned, /loses/, "a party losing is never relabelled as a named opponent winning");
  });

  test("intent audit item 3: the inverted season Matchup says the fade side everywhere, with ties, voids and missing results from the keeper", () => {
    const a = applyDial({ ...firstPartyRule(teamSeries("nhl", "COL", "loss", { kind: "season", year: 2026 }), 0.02), onEnd: { ...DEFAULT_ON_END } } as BurnRule, "inverse", "on");
    const ta = describeRule(a, { ticker: "COLVDAL" });
    assert.match(ta.oneLiner, /do not lose/);
    const f = matchupFacts({ a: "COLVDAL", b: "DALVCOL", oneLinerA: ta.oneLiner, oneLinerB: "burns on every game day the Stars do not lose", inverse: true, once: false, teamA: "the Avalanche", teamB: "the Stars", tie: "tie" });
    assert.match(f.trigger, /do not lose/); assert.doesNotMatch(f.trigger + f.example, /fires when the Avalanche lose|if the Avalanche lose/);
    assert.match(f.burned, /A win or a tie burns that team's coin, and a loss does not\. A postponed, cancelled or unsettled game counts for neither coin, and two games on one day count once\./);
    const plain = matchupFacts({ a: "COLVDAL", b: "DALVCOL", oneLinerA: "burns when the Avalanche lose", oneLinerB: "burns when the Stars lose", inverse: false, once: false, teamA: "the Avalanche", teamB: "the Stars", tie: "tie" });
    assert.match(plain.example, /if the Avalanche lose, \$COLVDAL spends/);
    for (const x of [f.trigger, f.burned, f.pays, f.moves, f.example, plain.burned]) clean(x);
    assert.match(page, /\$\{ticker \|\| "A"\} \$\{text\.oneLiner\}, and \$\$\{tickerB \|\| "B"\} \$\{textB\.oneLiner\}\./, "the card's sentence is read from both rules");
  });

  test("intent audit item 8: both coins of a Matchup show their own exact rule and fingerprint, labelled with the transaction number", () => {
    const a = season("LAD", "loss"), b = season("MIL", "loss");
    const r = buildLaunchReview({ rule: a, ticker: "LADVMIL", name: "Dodgers vs Brewers, Dodgers side", companion: { ticker: "MILVLAD", name: "Brewers vs Dodgers, Brewers side", rule: b } } as never, { env, reserved: new Set() });
    assert.ok("review" in r);
    assert.deepEqual(r.review.rules.map((x) => [x.side, x.ticker, x.step]), [["A", "LADVMIL", 1], ["B", "MILVLAD", 3]]);
    assert.notEqual(r.review.rules[0].sha256, r.review.rules[1].sha256); assert.match(r.review.rules[1].text, /MIL/);
    assert.match(read("src/app/burnticker/launch/PreWalletSummary.tsx"), /Coin \{r\.side\}, \$\{r\.ticker \|\| "TICKER"\} \(\{r\.name \|\| "no name yet"\}\), signed in transaction \{r\.step\}\./);
  });

  test("intent audit item 4: the flippening template describes the two-coin product it builds; a one-time share up to the whole pool", () => {
    const t = read("src/lib/burnticker/templates.ts");
    assert.match(t, /id: "flippening"[^\n]*two new coins/);
    assert.match(t, /id: "flippening"[^\n]*00:00 UTC/); assert.match(t, /id: "flippening"[^\n]*30 days/);
    const u = { symbol: "SOL", pyth: "a".repeat(64), pool: null, cross: "redstone:SOL" } as never, v = { symbol: "ETH", pyth: "b".repeat(64), pool: null, cross: "redstone:ETH" } as never;
    const m = tileRule({ a: u, b: v, window: "daily", seasonDays: 30, flip: true, fraction: 1, now: Date.parse("2026-10-12T00:00:00Z") }, "c".repeat(64), { a: "SOLVETH", b: "ETHVSOL" });
    assert.deepEqual(m.problems.filter((x) => /burn/.test(x)), [], "the flippening takes 100 %");
  });

  test("intent audit items 1 and 2 (wiring): a 'Detroit high below 32' card keeps its fade side through the review's rebuild", async () => {
    const deps = { venues: { kalshi: false, polymarket: false, feeds: true }, feeds: [], espn: espnFixtureClient(), polyGet: null, refuse: () => [], kalshiSearch: null, derbyHref: null, nowMs: ESPN_NOW };
    const r = await universalSearch("Detroit high below 32", deps as never);
    const c = r.cards.find((x) => x.rule?.series === nwsSeries("high", "DTW", 32))!;
    assert.ok(c && c.rule!.inverse === true, "the card carries the fade side");
    // the page rebuilds the card's rule from its fields (which have no fade side), then the pending dial puts it back
    const f = fieldsFromRule(c.rule!, { kind: "scalar", mode: "buyback", onYes: 0.02, onNoEnabled: false, onNo: 0.01, burnOn: "yes", unit: 1, perUnit: 0.02, baseline: 0, direction: "up", tokensYes: 1, vaultShare: 0.25, filter: "", polyPreset: null });
    let rebuilt = composeRule({ oracle: "catalogue", series: c.rule!.series, market: null, title: c.title }, { ...f, mode: "buyback", tokensYes: 1, vaultShare: 0.25, filter: "", polyPreset: null })!;
    if (dialsFor(rebuilt).inverse) rebuilt = applyDial(rebuilt, "inverse", "on");
    assert.equal(rebuilt.inverse, true);
    assert.match(describeRule(rebuilt, { ticker: "DTWCOLD" }).paragraph, /31 °F or colder/);
    assert.match(page, /if \(pendingDials\.inverse && dialsFor\(r, dialCtx\)\.inverse\) r = applyDial\(r, "inverse", "on", dialCtx\);/);
    assert.match(page, /if \(r\.inverse\) setPendingDials\(\{ fraction: shareOf\(r\) \?\? DEFAULT_SHARE\.recurring/);
  });

  test("intent audit item 12: the coin search drops a late answer; the review enables Launch only for the latest draft", () => {
    // launch audit 244: the sequence is a Latest (coinPicker.ts searchToken), so a query under 2 characters also makes a late answer stale
    assert.match(tile, /if \(latest\.isCurrent\(my\)\) \{ setHits\(j\.hits \?\? \[\]\)/);
    assert.match(page, /if \(!rule \|\| !reviewMatchesDraft\(reviewSlot, curRev\.current\)\) return;/);
    assert.match(page, /if \(seq === useq\.current\) \{ reportNoClick\(\);/);
  });

  test("snag 19: dates carry the year when it is not this year and the zone; the market's close is named as the close", () => {
    assert.match(page, /const other = d\.getUTCFullYear\(\) !== new Date\(\)\.getUTCFullYear\(\);/);
    assert.match(page, /timeZoneName: "short"/);
    assert.match(page, /the market closes by \{denver\(one\)\}/);
  });

  test("snags 14, 15 and 22: the fade label, the ESPN sentence and the pair copy say one thing", () => {
    assert.match(read("src/lib/burnticker/inverse.ts"), /on: "Burn on the days it does not happen"/);
    assert.doesNotMatch(read("src/lib/burnticker/sources/provenance.ts"), /Burnticker reads no ESPN data\./);
    assert.doesNotMatch(read("src/lib/burnticker/describe.ts"), /That can be a coin whose team lost the game\./, "no sports words inside a crypto pair's facts");
  });
});

describe("the image control: choose, drop or paste", () => {
  test("a pasted PNG reaches the same check as a chosen file, with a generated name; an oversize paste gets the size problem", () => {
    const png = { name: "", size: 1024, type: "image/png" };
    const fromItems = imageFromTransfer({ files: [], items: [{ kind: "string", type: "text/plain", getAsFile: () => null }, { kind: "file", type: "image/png", getAsFile: () => png }] });
    assert.equal(fromItems, png); assert.equal(imageFileProblem(fromItems!), null);
    assert.equal(pastedImageName("image/png"), "pasted-image.png"); assert.equal(pastedImageName("image/webp"), "pasted-image.webp");
    const big = imageFromTransfer({ files: [{ name: "x.png", size: 3 * 1024 * 1024, type: "image/png" }] })!;
    assert.equal(imageFileProblem(big), "The image has to be 2 MB or smaller.");
    assert.equal(imageFromTransfer({ files: [], items: [{ kind: "string", type: "text/plain", getAsFile: () => null }] }), null, "a text paste is not an image");
    assert.equal(IMAGE_WAYS, "Choose a file, drop one here, or paste an image."); clean(IMAGE_WAYS);
    assert.match(fields, /document\.addEventListener\("paste", onPaste\)/); assert.match(fields, /onDrop=\{\(e\) => \{ e\.preventDefault\(\); setDragOver\(false\); pick\(imageFromTransfer\(e\.dataTransfer\) as File \| null\); \}\}/);
    assert.match(fields, /if \(t && \(t\.tagName === "INPUT" \|\| t\.tagName === "TEXTAREA" \|\| t\.isContentEditable\)\) return;/, "a paste into a text field stays text");
  });
});
