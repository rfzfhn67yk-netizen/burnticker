// HOURLY AUDIT 2026-10-19 23:10 DENVER, RUN 11 (docs/burnticker/audits/continuous/2026-10-19-2310-Denver.md; bugs.md HB-127, HB-128,
// HB-130 to HB-135). HB-129 was fixed apart (2428860d). One pure test or source check per fix, plus the copy lint on every new public
// sentence.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { meetingsFundsFlow, pairFundsFlow } from "@/lib/burnticker/pairFundsFlow";
import { statementOf } from "@/lib/burnticker/eventIdentity";
import { plainQuestion } from "@/lib/burnticker/polySearch";
import { CANDIDATES_PAIR_SENTENCE, PARTIES_PAIR_SENTENCE, describeRule, partyPhrase } from "@/lib/burnticker/describe";
import { afterGraduationEnd, beforeGraduationLine, candidatesPairRule, patternWords } from "@/lib/burnticker/guidedLaunch";
import { serverDescribeCtx } from "@/lib/burnticker/coinText";
import { reviewTickerChecks, type TickerRow } from "@/lib/burnticker/tickerCheck";
import { hazardAlternateName, hazardAlternates } from "@/lib/burnticker/hazards";
import { lookalikeHits, type LookalikeExisting } from "@/lib/burnticker/lookalike";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { applyDial } from "@/lib/burnticker/dials";
import { leagueSeasonPage, ONE_GAME_OUTCOME, ONE_GAME_SOLO_OUTCOME, oneGameSeason } from "@/lib/burnticker/leagues";
import { gameSeries } from "@/lib/burnticker/sources/espn";
import { checkLine } from "@/lib/burnticker/creatorBenefits";
import { creatorNextFields } from "@/lib/burnticker/creatorServe";
import { GRID_TABS, NO_DATE_YET, settleDateOf, tabCoins } from "@/lib/burnticker/coinsGrid";
import { feedOfferRefusal } from "@/lib/burnticker/coverage/settleable";
import { TEMPLATES, TEMPLATE_START } from "@/lib/burnticker/templates";
import { NOT_OFFERED } from "@/lib/burnticker/exampleTickets";
import { NEXT_MARKET_NONE_DECIDED, nextMarketNone, pairLeadSentence } from "@/lib/burnticker/receiptWords";
import { burnLogWords } from "@/lib/burnticker/queuedReading";
import { KEEP_DRAFT, REPLACE_DRAFT, draftToReplace, replaceDraftLine } from "@/lib/burnticker/launchDraftStore";
import { ONE_SHOT_NO_PAST, PAST_BURNS_UNAVAILABLE, noProjectionLine } from "@/lib/burnticker/guidedLaunch";
import { NO_SUCH_COIN_PATH, clearCoinPageGate, coinSegmentOf, coinSegmentServedAsync, type KnownCoins } from "@/lib/burnticker/coinPageGate";
import { featuredCoins } from "@/lib/burnticker/home";
import type { BurnRule } from "@/lib/burnticker/rules";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };
const plain = (s: string) => { clean(s); assert.doesNotMatch(s, /\bwill\b|\bbuy\b|\bprice\b|coming soon|\bpayouts?\b|\btarget\b|\bguarantee|→|\b20\d\d-\d\d-\d\d\b|\w\/\w+\//i, s); };
const read = (p: string) => fs.readFileSync(p, "utf8");
const MIN = 60_000;

describe("HB-127: the 72-hour no-result case names what cannot move", () => {
  test("no pair sentence ends on a bare 'can no longer forward.'", () => {
    const flows = [pairFundsFlow("winner-takes-the-burn", { a: "A", b: "B" }), meetingsFundsFlow({ a: "DENWIN", b: "LALWIN" }, { a: "Denver Nuggets", b: "Los Angeles Lakers" })];
    for (const f of flows) for (const o of f.outcomes) { assert.doesNotMatch(o.then, /can no longer forward\.?$/, o.then); plain(o.then); }
    const m = flows[1].outcomes.find((o) => /72 hours/.test(o.when))!;
    assert.equal(m.then, "That coin burns the game as an unpaired coin, from its own pool, and nothing from that game moves to the other coin.");
  });
});

describe("HB-128: a party-control question said as a statement, in party words", () => {
  const Q = "Will the Democratic Party control the Senate after the 2026 Midterm elections?";
  test("a verb eventIdentity does not know still conjugates; a plural subject keeps the bare verb", () => {
    assert.equal(statementOf(Q), "the Democratic Party controls the Senate after the 2026 Midterm elections");
    assert.equal(statementOf("Will the Republican Party control the House?"), "the Republican Party controls the House");
    assert.equal(statementOf("Will the Democrats control the House after the 2026 Midterm elections?"), "the Democrats control the House after the 2026 Midterm elections");
    assert.equal(plainQuestion(Q), "the Democratic Party controls the Senate after the 2026 Midterm elections");
    // known verbs keep eventIdentity's path; a title with no question and no verb is never bent into one
    assert.equal(statementOf("Will LeBron James retire before next NBA season?"), "LeBron James retires before next NBA season");
    assert.equal(statementOf("US recession in 2026?"), "US recession in 2026");
    assert.equal(statementOf("Will Netanyahu out by end of 2026?"), "Netanyahu out by end of 2026");
    // the server's own read of the market title (coinText.ts) takes the same statement
    const rule = candidatesPairRule("0xabc", 1);
    assert.equal(serverDescribeCtx(rule, {}, { seriesTitle: `${Q} (resolves once)` }).eventPhrase, "the Democratic Party controls the Senate after the 2026 Midterm elections");
  });

  test("the burn sentence and the pinned description say 'controls' and 'party', never 'candidate'", () => {
    const side = (m: string, sideId: "A" | "B") => ({ ...candidatesPairRule(m, 1), pair: { pairId: "x", side: sideId, counterpartMint: null, winnerTakesBurn: true, race: { slug: "senate-2026", markets: ["0xd", "0xr"] } } }) as unknown as BurnRule;
    const a = describeRule(side("0xd", "A"), { ticker: "DEMVREP", eventPhrase: statementOf(Q) });
    const b = describeRule(side("0xr", "B"), { ticker: "REPVDEM", eventPhrase: statementOf("Will the Republican Party control the Senate after the 2026 Midterm elections?") });
    assert.equal(a.oneLiner, "burns if the Democratic Party controls the Senate after the 2026 Midterm elections");
    for (const t of [a, b]) { assert.ok(t.paragraph.includes(PARTIES_PAIR_SENTENCE), t.paragraph); assert.doesNotMatch(t.paragraph, /candidate/i); }
    // a race between two candidates keeps the candidate sentence
    const c = describeRule(side("0xe", "A"), { ticker: "ELSAYED", eventPhrase: "Abdul El-Sayed (D) wins the Michigan Senate race" });
    assert.ok(c.paragraph.includes(CANDIDATES_PAIR_SENTENCE));
    assert.equal(partyPhrase("the Democratic Party controls the Senate"), true);
    assert.equal(partyPhrase("Abdul El-Sayed (D) wins the Michigan Senate race"), false);
  });

  test("the burn-step card and the before-graduation line use 'party' for a party race", () => {
    const w = patternWords("winner", { follow: "rivalry", pairKind: "candidates", party: true });
    assert.equal(w.sentence, PARTIES_PAIR_SENTENCE);
    assert.equal(patternWords("winner", { follow: "rivalry", pairKind: "candidates" }).sentence, CANDIDATES_PAIR_SENTENCE);
    const rule = { ...candidatesPairRule("0xd", 1), onEnd: { windDownDays: 28, sweepThresholdLamports: 0, endSink: true } } as unknown as BurnRule;
    const line = afterGraduationEnd(rule, "candidates", true);
    assert.equal(line, "Then the losing party's coin's pool goes to the winning party's coin's burn. If neither party wins, both pools go to $DEFICIT's burn. A voided market moves nothing between the two coins, and each burns down what is left on itself.");
    assert.match(afterGraduationEnd(rule, "candidates"), /losing candidate's coin/);
    assert.ok(beforeGraduationLine(null, rule, "candidates", true).endsWith(line));
    plain(line); plain(PARTIES_PAIR_SENTENCE);
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.match(page, /eventPhrase: statementOf\(elPick\.a\.question\)/);
    assert.match(page, /eventPhrase: statementOf\(elPick\.b\.question\)/);
    assert.match(page, /pairKind: pairKindNow, party: partyRace,/);
    assert.match(page, /rule, endLink, partyRace\)\]/);
    assert.match(read("src/lib/burnticker/launchReview.ts"), /afterGraduationEnd\(asBuilt, null, partyRace\)/);
  });
});

describe("HB-130: the second copier of the showcase coin gets a ticker AND a name that are both free", () => {
  const SERIES = "usgs.quakenext:6";
  const rule = applyDial(firstPartyRule(SERIES, 0.02), "fraction", 1) as BurnRule;
  const gen = describeRule(rule, { ticker: "" });
  const live = (ticker: string, name: string, mint: string) => ({ ticker, name, mint, status: "live", creator: `Owner-${mint}`, rule: { oracle: "catalogue" as const, series: SERIES } });
  const world = (rows: ReturnType<typeof live>[]) => {
    const existing: LookalikeExisting[] = rows.map((r) => ({ ticker: r.ticker, name: r.name, status: r.status, rule: r.rule, creator: r.creator }));
    const inUse = (t: string): TickerRow[] => rows.filter((r) => r.ticker === t.toUpperCase()).map((r) => ({ mint: r.mint, name: r.name, ticker: r.ticker, rulesJson: JSON.stringify(r.rule), status: r.status, creator: r.creator }));
    return { existing, deps: { inUse, reserved: new Set<string>(), existing, creator: "VisitorWallet" } };
  };
  const offer = (rows: ReturnType<typeof live>[]) => {
    const w = world(rows);
    const { tickers, coins } = reviewTickerChecks([{ side: "A" as const, ticker: gen.ticker, suggestedTicker: gen.ticker, suggestedName: gen.name }], rule, w.deps);
    const t = coins[0].suggestedTicker!;
    assert.equal(tickers[0].suggestions[0], t);
    const name = hazardAlternateName(SERIES, { ticker: gen.ticker, name: gen.name }, t)!;
    assert.ok(name, `a name pairs with $${t}`);
    assert.deepEqual(lookalikeHits({ ticker: t, name, rule, creator: "VisitorWallet" }, w.existing), [], `$${t} "${name}" passes both checks`);
    return { t, name };
  };
  const [first, second] = hazardAlternates(SERIES, { ticker: gen.ticker, name: gen.name });

  test("the generated draft is $NEXTM6 'Next Magnitude 6', and the first copy takes the Quake form", () => {
    assert.equal(gen.ticker, "NEXTM6"); assert.equal(gen.name, "Next Magnitude 6");
    assert.deepEqual(offer([live("NEXTM6", "Next Magnitude 6", "M0")]), { t: first.ticker, name: "Next Magnitude 6 Quake" });
  });
  test("with the first two Quake alternates held live, the next visitor moves on to Tremor", () => {
    assert.equal(first.name, second.name, "every ticker of one word shares its name");
    const o = offer([live("NEXTM6", "Next Magnitude 6", "M0"), live(first.ticker, first.name, "M1"), live(second.ticker, second.name, "M2")]);
    assert.equal(o.name, "Next Magnitude 6 Tremor");
  });
  test("with Quake and Tremor both held, a numbered form spelled in words", () => {
    const tremor = hazardAlternates(SERIES, { ticker: gen.ticker, name: gen.name }).find((a) => a.name === "Next Magnitude 6 Tremor")!;
    const o = offer([live("NEXTM6", "Next Magnitude 6", "M0"), live(first.ticker, first.name, "M1"), live(tremor.ticker, tremor.name, "M2")]);
    assert.equal(o.name, "Next Magnitude 6 Quake Two");
    assert.match(o.t, /TWO/);
    clean(o.name);
  });
  test("a review without the generated name keeps the ticker-only offer (older callers)", () => {
    const w = world([live("NEXTM6", "Next Magnitude 6", "M0")]);
    const { coins } = reviewTickerChecks([{ side: "A" as const, ticker: "NEXTM6", suggestedTicker: "NEXTM6" }], rule, w.deps);
    assert.equal(coins[0].suggestedTicker, first.ticker);
    assert.match(read("src/lib/burnticker/launchReview.ts"), /suggestedName: i === 0 \? text\.name \|\| null : null/);
  });
});

describe("HB-131: the league page counts a one-game coin on its own season, and a solo one-game coin is not a pair", () => {
  const rule = (series: string, pair: boolean) => ({ schema: "burnticker.rules/v1", oracle: "catalogue", series, market: null, filter: {}, kind: "scalar", ...(pair ? { pair: { pairId: "p", side: "A", winnerTakesBurn: true } } : {}) }) as unknown as BurnRule;
  const coin = (ticker: string, abbr: string, launchedAt: string | null, pair = true) => ({ ticker, mint: ticker, rule: rule(gameSeries("nfl", "401772", abbr, "win"), pair), burns: [], burnedPct: 0, ended: false, launchedAt });
  const now = Date.parse("2026-10-20T03:00:00Z");
  const pageOf = (year: number, coins: ReturnType<typeof coin>[]) => leagueSeasonPage({ league: "nfl", year, coins, readings: [], nowMs: now, origin: "https://x", ogImage: "https://x/og" });
  test("a 2025 one-game coin is not a coin of the 2026 page, and counts on the 2025 page", () => {
    const old = coin("DENOLD", "DEN", "2025-11-02T18:00:00Z"), cur = coin("SEAWIN", "SEA", "2026-10-14T18:00:00Z");
    assert.equal(oneGameSeason("nfl", old.launchedAt), 2025);
    assert.equal(oneGameSeason("nfl", "2027-01-20T18:00:00Z"), 2026, "a January playoff game belongs to the season that started in the fall");
    const p26 = pageOf(2026, [old, cur]);
    assert.deepEqual(p26.teams.find((t) => t.abbr === "DEN")!.coins, []);
    assert.deepEqual(p26.teams.find((t) => t.abbr === "SEA")!.coins, [{ ticker: "SEAWIN", outcome: ONE_GAME_OUTCOME }]);
    assert.deepEqual(pageOf(2025, [old, cur]).teams.find((t) => t.abbr === "DEN")!.coins, [{ ticker: "DENOLD", outcome: ONE_GAME_OUTCOME }]);
  });
  test("a one-game coin that is not a pair side is labelled a one-game coin; an unknown launch time keeps the current season", () => {
    const p = pageOf(2026, [coin("DENWIN", "DEN", null, false)]);
    assert.deepEqual(p.teams.find((t) => t.abbr === "DEN")!.coins, [{ ticker: "DENWIN", outcome: ONE_GAME_SOLO_OUTCOME }]);
    plain(ONE_GAME_SOLO_OUTCOME);
    assert.match(read("src/lib/burnticker/leaguesServe.ts"), /launchedAt: t\.baselineAt/);
  });
});

describe("HB-132: 'checked' is the last good read, and a failed try is said on its own", () => {
  const now = Date.parse("2026-10-20T05:00:00Z");   // 23:00 Denver
  const s = { rules: { oneShot: false }, next: { result: "recurring", nextResultAt: null, nextSourceCheckAt: null } } as never;
  test("a try that failed 5 minutes ago after a good read 3 hours ago", () => {
    const f = creatorNextFields(s, [], now, { lastFetchAt: now - 5 * MIN, lastOkAt: now - 180 * MIN, failures: 2, nextFetchAt: now + 10 * MIN });
    assert.equal(f.nextCheckLine, "Last good read 3 hours ago; the last try failed at Oct 19, 2026, 10:55 PM MDT, next due at Oct 19, 2026, 11:10 PM MDT");
    assert.doesNotMatch(f.nextCheckLine ?? "", /Checked 5 minutes ago/);
    clean(f.nextCheckLine!);
  });
  test("a good last read says 'Checked'; no good read yet says so; the attempt-only caller keeps HB-98's words", () => {
    const ok = creatorNextFields(s, [], now, { lastFetchAt: now - 5 * MIN, lastOkAt: now - 5 * MIN, failures: 0, nextFetchAt: now + 10 * MIN });
    assert.match(ok.nextCheckLine ?? "", /^Checked 5 minutes ago, next due at/);
    const never = creatorNextFields(s, [], now, { lastFetchAt: now - 5 * MIN, lastOkAt: null, failures: 1, nextFetchAt: now + 10 * MIN });
    assert.match(never.nextCheckLine ?? "", /^No good read yet; the last try failed at .*, next due at/);
    clean(never.nextCheckLine!);
    const old = creatorNextFields(s, [], now, { lastFetchAt: now - 5 * MIN, nextFetchAt: now + 10 * MIN });
    assert.match(old.nextCheckLine ?? "", /^Checked 5 minutes ago/);
    assert.equal(checkLine(null, now, null, now - 5 * MIN), "No good read yet; the last try failed at Oct 19, 2026, 10:55 PM MDT.");
    assert.match(read("src/lib/burnticker/creatorServe.ts"), /lastOkAt: f\.lastOkAt, failures: f\.failures/);
  });
});

describe("HB-133: Next to settle lists dated coins first, undated coins last", () => {
  type C = Parameters<typeof tabCoins>[1][number];
  const c = (ticker: string, nextCheckAt: string | null, listingAt: string | null | undefined, shape: "market" | "season" = "season"): C => ({ ticker, phase: null, progressPct: null, nextCheckAt, nextCloseTime: null, launchedAt: null, status: "live", ...(listingAt === undefined ? {} : { listing: { next: { shape, at: listingAt, cadence: null, windowEnd: null } } }) }) as unknown as C;
  test("a market polled every few minutes with no stated date sorts after every dated coin", () => {
    const list = [c("CLARITY", "2026-10-20T05:53:39Z", null, "market"), c("PITWIN", "2026-10-26T17:01:41Z", "2026-10-26T17:01:41Z"), c("TWOCUTS", "2026-10-20T06:14:26Z", null, "market"), c("NEXTM6", "2026-10-21T00:30:00Z", null), c("PHINFLWIN", "2026-10-25T17:01:41Z", "2026-10-25T17:01:41Z"), c("SEAWIN", null, undefined)];
    const order = tabCoins("next", list).map((x) => x.ticker);
    assert.deepEqual(order, ["PHINFLWIN", "PITWIN", "CLARITY", "NEXTM6", "TWOCUTS"]);
    const firstUndated = order.findIndex((t) => !settleDateOf(list.find((x) => x.ticker === t)!));
    assert.ok(order.slice(firstUndated).every((t) => !settleDateOf(list.find((x) => x.ticker === t)!)));
  });
  test("the tab says so, and an undated card carries 'No date yet.' there", () => {
    const rule = GRID_TABS.find((t) => t.id === "next")!.rule;
    assert.equal(rule, "Coins with a scheduled result, soonest first, then the coins with no date yet.");
    plain(rule); plain(NO_DATE_YET);
    const ix = read("src/app/burnticker/CoinsIndex.tsx");
    assert.match(ix, /tab === "next" && v0\.nextLine && !settleDateOf\(t\) \? \{ \.\.\.v0, nextLine: `\$\{NO_DATE_YET\} \$\{v0\.nextLine\}` \}/);
    assert.match(ix, /k: k < 0 \|\| tab === "next" \? slots\.length : k/);
  });
});

describe("HB-134: the template and the search read the same source availability as the Browse card", () => {
  test("Launch Library 2 cannot launch, so the Rocket launches template says 'Not offered yet.'", () => {
    const t = TEMPLATES.find((x) => x.id === "launch-count")!;
    assert.equal(t.source, "ll2.launches");
    assert.match(feedOfferRefusal("ll2.launches") ?? "", /^Coins cannot launch on "Orbital launches \(Launch Library 2\)" yet/);
    const page = read("src/app/burnticker/templates/page.tsx");
    assert.match(page, /templateCardState\(t, site, \(src\) => feedOfferRefusal\(src\)\)/);   // HB-151: the one card state (templateCard.ts)
    assert.equal(NOT_OFFERED, "Not offered yet.");
  });
  test("every template that names its source lands on one that launches, or the gallery says it is not offered", () => {
    for (const t of TEMPLATES) {
      if (!t.source) continue;
      const why = feedOfferRefusal(t.source);
      if (why) assert.ok(TEMPLATE_START[t.id].search || TEMPLATE_START[t.id].browse, `${t.id}: a landing the page can show "Not offered yet." on`);
    }
    // a source that can launch is not refused (the debt template's source)
    assert.equal(feedOfferRefusal("treasury.debt"), null);
    assert.equal(feedOfferRefusal(null), null);
  });
  test("the search card carries the refusal and the page shows 'Not offered yet.' with no 'Use this'", () => {
    const h = read("src/lib/burnticker/api/handlers.ts");
    assert.match(h, /c\.venue === "feed" && c\.pick\?\.oracle === "catalogue" \? feedOfferRefusal\(c\.pick\.series\) : null; return why \? \{ \.\.\.c, unavailable: why \} : c;/);
    assert.match(h, /const why = feedOfferRefusal\(card\.pick\.series\);/, "the Browse card reads the same check");
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.match(page, /: c\.unavailable \? <div [^>]*data-not-offered>\{NOT_OFFERED\}/);
    assert.match(page, /const cardBlocked = \(c: Suggestion\): string \| null => \(c\.unavailable \? NOT_OFFERED : null\)/);
  });
});

describe("HB-135: the pair page names the pair by its tickers and says each receipt's state in words", () => {
  test("the lead sentence, the status words and the decided pair's next market", () => {
    assert.equal(pairLeadSentence("SEAWIN", "DENWIN"), "This is the rivalry pair of $SEAWIN and $DENWIN.");
    assert.equal(burnLogWords("pending-pair"), "waiting for both coins to graduate");
    assert.equal(nextMarketNone({ oneShot: true, settlements: 1 }), NEXT_MARKET_NONE_DECIDED);
    assert.equal(nextMarketNone({ oneShot: true, settlements: 0 }), "—");
    assert.equal(nextMarketNone({ oneShot: false, settlements: 3 }), "—");
    for (const x of [pairLeadSentence("SEAWIN", "DENWIN"), NEXT_MARKET_NONE_DECIDED]) plain(x);
  });
  test("neither pair page prints the pair id, a selector or a raw status token in prose", () => {
    const react = read("src/app/burnticker/p/[pairId]/page.tsx"), html = read("src/lib/burnticker/tokenPage.ts");
    assert.doesNotMatch(react, /This is the rivalry pair <code>/);
    assert.doesNotMatch(html, /This is the rivalry pair <code>/);
    assert.match(react, /\{pairLeadSentence\(A, B\)\}/);
    assert.match(html, /\$\{esc\(pairLeadSentence\(a\.ticker, b\.ticker\)\)\}/);
    assert.match(react, /<td className="p-2">\{burnLogWords\(r\.status\)\}<\/td>/);
    assert.doesNotMatch(react, /<td className="p-2">\{r\.status\}<\/td>/);
    assert.doesNotMatch(react, /Both coins read the same market \(<code>/);
    assert.doesNotMatch(html, /Both coins read the same market \(<code>/);
    assert.match(react, /nextMarketNone\(\{ oneShot: !!d\.a\.status\.rules\.oneShot, settlements: t\.settlements \}\)/);
    assert.match(html, /nextMarketNone\(\{ oneShot: !!a\.rules\.oneShot, settlements: tally\.settlements \}\)/);
  });
});

// ---- the coordinator's additions to this batch (the auditor's 00:05 message and the two later items) --------------------------------

describe("HS-53: a template link asks before it replaces a draft in progress", () => {
  test("the question names the draft by its name and both tickers; nothing to ask without a draft", () => {
    const pair = { step: "review", guide: { follow: "rivalry", phase: "review" }, name: "Democrats vs Republicans", ticker: "demvrep", tickerB: "repvdem" };
    assert.equal(replaceDraftLine(pair), "Open this template? It replaces your draft Democrats vs Republicans ($DEMVREP and $REPVDEM).");
    assert.equal(replaceDraftLine({ step: "burn", guide: { follow: "team", phase: "which" } }), "Open this template? It replaces your draft a team coin, not named yet.");
    assert.equal(draftToReplace(null), null);
    assert.equal(draftToReplace("not json"), null);
    assert.equal(draftToReplace(JSON.stringify({ step: "choose", guide: { phase: "follow" } })), null, "an untouched first screen is no draft");
    assert.deepEqual(draftToReplace(JSON.stringify(pair)), pair);
    for (const s of [replaceDraftLine(pair), REPLACE_DRAFT, KEEP_DRAFT]) plain(s);
  });
  test("both kinds of template link on the gallery go through the asking link", () => {
    const page = read("src/app/burnticker/templates/page.tsx");
    assert.match(page, /<TemplateLink className="text-sm font-medium text-amber-300 underline" href=\{c\.href\}>/);
    assert.match(page, /<TemplateLink className="text-sm font-medium text-amber-300 underline" href=\{r\.href\} data-rivalry-link="">/);
    const link = read("src/app/burnticker/templates/TemplateLink.tsx");
    assert.match(link, /sessionStorage\.getItem\(DRAFT_STORE\)/);
    assert.match(link, /\{REPLACE_DRAFT\}/); assert.match(link, /\{KEEP_DRAFT\}/);
  });
});

describe("HS-52 widened: each refusal sits with its own field", () => {
  test("a coin's free tickers sit in that coin's card on the Name step; an HTML tag is refused under the description", () => {
    const card = read("src/app/burnticker/launch/ReviewCard.tsx");
    assert.match(card, /\{tickerCheckFor\(i === 0 \? "A" : "B"\)\}\n {12}<\/div>/);
    assert.doesNotMatch(card, /<\/div>\n {6}\{tickerCheckList\}\n {6}\{draftHeldList\}/, "no shared list below both coins on the Name step");
    const prof = read("src/app/burnticker/launch/ProfileFields.tsx");
    assert.match(prof, /const descErrAll = \[descErr, markupProblem\(value\.description, "description"\)\]/);
    assert.match(prof, /\{descErrAll && <p id=\{`\$\{uid\}-descerr`\} className="text-red-400" data-field-error="description">\{descErrAll\}<\/p>\}/);
  });
});

describe("HS-48 widened: a one-shot market's review never prints the past-burns heading over nothing", () => {
  test("a one-shot market says it has no past; any other rule keeps its reason or the plain line", () => {
    assert.equal(noProjectionLine(null, true), ONE_SHOT_NO_PAST);
    assert.equal(noProjectionLine("", false), PAST_BURNS_UNAVAILABLE);
    assert.equal(noProjectionLine("No readings yet.", false), "No readings yet.");
    plain(ONE_SHOT_NO_PAST);
    assert.match(read("src/app/burnticker/launch/page.tsx"), /data-no-projection>\{noProjectionLine\(rv\.projection\.reason, !!rule && rule\.oracle === "polymarket" && windowKindOf\(rule\) === "one-shot"\)\}/);
  });
});

describe("HB-100 reopened: an unknown coin's 404 is decided before rendering, so its words and links are server HTML", () => {
  // HB-152 (hourly run 13): the gate reads a known-coin set (read-only), not a writable registry handle
  const known: KnownCoins = { mints: new Set(["M1".padEnd(32, "1")]), launchedTickers: new Set(["PHINFLWIN"]) };
  test("the proxy's gate: unknown coins are rewritten, every served page goes through, and a read failure fails open", async () => {
    clearCoinPageGate();
    const read = async () => known;
    assert.equal(await coinSegmentServedAsync("NOPE", { read }), false);
    assert.equal(await coinSegmentServedAsync("phinflwin", { read }), true);
    assert.equal(await coinSegmentServedAsync("DEFICIT", { read }), true, "$DEFICIT's own page");
    clearCoinPageGate();
    assert.equal(await coinSegmentServedAsync("NOPE", { read: async () => { throw new Error("db"); } }), true, "an unreadable registry keeps the page");
    assert.equal(coinSegmentOf("/burnticker/t/NOPE"), "NOPE");
    assert.equal(coinSegmentOf("/burnticker/t/NOPE/"), "NOPE");
    assert.equal(coinSegmentOf("/burnticker/t/NOPE/og"), null, "a coin's sub-route is not the page");
    assert.equal(coinSegmentOf("/burnticker/trust"), null);
    assert.equal(coinSegmentOf("/burnticker/t/%E0%A4"), null, "a malformed escape is the malformed-path rule's");
    assert.ok(NO_SUCH_COIN_PATH.startsWith("/burnticker/_"), "a private folder name: no route can ever match it");
  });
  test("the proxy runs the gate on coin pages and rewrites to the unmatched address; the layout keeps its own check", () => {
    const proxy = read("src/proxy.ts");
    // publish 103: the rewrite answered 500 behind Caddy (forwarded https on the plain-http port), so it is switched off and the layout answers 404
    assert.match(proxy, /const UNKNOWN_COIN_REWRITE = false;/);
    assert.match(proxy, /if \(seg !== null && UNKNOWN_COIN_REWRITE && !\(await coinPageServedSafely\(seg\)\)\) return NextResponse\.rewrite\(new URL\(NO_SUCH_COIN_PATH, request\.url\)\);/);
    assert.match(proxy, /matcher: \["\/:path\(\.\*%\.\*\)", "\/burnticker\/t\/:ticker"\]/);
    assert.ok(proxy.indexOf("malformedPath(raw)") < proxy.indexOf("coinSegmentOf(raw)"), "the malformed path is answered first");
    assert.match(read("src/app/burnticker/t/[ticker]/layout.tsx"), /if \(!found\) notFound\(\);/);
    assert.ok(!fs.existsSync("src/app/burnticker/_no-such-coin"), "nothing may ever serve the rewrite target");
  });
});

describe("the home API's $DEFICIT card is the live flagship, not a test card", () => {
  test("created, it is in the public group (Live coins counts it); not created, it stays apart", () => {
    const src = read("src/lib/burnticker/home.ts");
    assert.match(src, /id: "deficit", [^\n]*\n[^\n]*\n {4}group: created \? "public" : "test",/);
    if (!fs.existsSync("config/own-tokens.json")) return;
    const own = JSON.parse(read("config/own-tokens.json")) as { tokens: { symbol: string; status: string }[] };
    const created = own.tokens.find((t) => t.symbol === "DEFICIT")?.status === "launched";
    const d = featuredCoins().find((v) => v.id === "deficit");
    if (d) assert.equal(d.group, created ? "public" : "test");
  });
});
