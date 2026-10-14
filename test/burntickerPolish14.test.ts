/**
 * Walkthrough 13's layout calls (owner 2026-10-14: "fix the layout calls too, all of them"), rows 60–71 of
 * mct-runner-study/launch-debt-egg-2026-10-09/WALKTHROUGH-13-2026-10-14.md. One describe per item; source pins where the fix is layout.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { CANDIDATES_END_RESULT, CANDIDATES_PAIR_SENTENCE, PARTIES_END_RESULT, endText } from "@/lib/burnticker/describe";
import type { BurnRule } from "@/lib/burnticker/rules";
import { PARTIES_PAIR_SENTENCE, isPartySubject } from "@/lib/burnticker/pairFundsFlow";
import { candidateFacts, endSentences } from "@/lib/burnticker/guidedLaunch";
import { ladderDate, ladderKeys, ladderNumber, ladderOrder } from "@/lib/burnticker/oracle/outcomeFilter";
import { searchHits, type GammaEvent, type GammaMarket } from "@/lib/burnticker/oracle/polymarket";
import { matchPolymarket, splitQuery } from "@/lib/burnticker/polySearch";
import { liveCoinsTotal } from "@/lib/burnticker/coinsGrid";
import type { CardView } from "@/lib/burnticker/cardView";
import { CURVE_STARTED_SOL, progressOf } from "@/lib/burnticker/progress";
import { readinessOf } from "@/lib/burnticker/readiness";
import { feeLine, shareOfFee } from "@/lib/burnticker/swap/copy";
import { REHEARSAL_SENTENCE } from "@/lib/burnticker/rehearsalCopy";
import { TEST_COINS_COPY } from "@/lib/burnticker/testCoinsCopy";
import { tsdbGames } from "@/lib/burnticker/sources/espn";
import { collapseRepublishes, parseChangelog, type Release } from "@/lib/burnticker/history";
import { RELEASE_LINES } from "@/lib/burnticker/historyCopy";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}: ${t}\n${formatHits(r)}`); };

describe("1. the coin page: one primary trade button, one row with the full set, no third card", () => {
  const page = read("src/app/burnticker/t/[ticker]/page.tsx"), panel = read("src/app/burnticker/t/[ticker]/TradePanel.tsx"), links = read("src/app/burnticker/_components/TradeLinks.tsx");
  test("the header keeps only the primary button", () => {
    assert.match(page, /<div data-header-trade><TradeButtons links=\{coinLinks\([^\n]*\)\} ticker=\{s\.ticker\} compact primaryOnly \/><\/div>/);
    assert.match(links, /const rest = primaryOnly \? \[\] : allLinks\(links\)\.filter/);
  });
  test("the Trade on Raydium card is gone; its fee sentence and the no-order line ride into the swap panel's row", () => {
    assert.doesNotMatch(page, /aria-label="Trade"/);
    assert.doesNotMatch(page, /data-trade-link|raydiumLink\(/);
    assert.equal((page.match(/<TradePanel /g) ?? []).length, 1);
    assert.match(page, /feesNote=\{`Each trade pays [^`]*Burnticker never takes an order or holds funds\.`\} linksNote=\{m\?\.trade\.note \?\? /);
    clean("Each trade pays 1.25% on the curve and 0.3% in the Raydium pool. Burnticker never takes an order or holds funds.", "fees note");
    clean("The trade links appear once the coin is launched.", "links note");
  });
  test("the row renders even when the swap does not (loading, another network, a draft), so the full set is always on the page once", () => {
    assert.match(panel, /if \(guard === null \|\| \(refusal && refusal !== REFUSAL\.testCoin\)\) return alternatives \? <section className=\{card\} aria-label=\{SWAP_COPY\.otherVenues\}>\{alternatives\}<\/section> : null;/);
    assert.equal((panel.match(/data-swap-alternatives/g) ?? []).length, 1, "one link row");
    assert.equal((panel.match(/p\.links\.map\(/g) ?? []).length, 1);
  });
});

describe("2. the party-control review: the race line once, and the end in party words", () => {
  const page = read("src/app/burnticker/launch/page.tsx"), card = read("src/app/burnticker/launch/ReviewCard.tsx");
  const base = { schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: "0x" + "1".repeat(64), filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 1 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, onEnd: { windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true }, pair: { pairId: "x", side: "A", counterpartMint: null, winnerTakesBurn: true, race: { slug: "nc-senate", markets: ["0xa", "0xb"] } } } as unknown as BurnRule;
  test("a party race ends in party words; a candidate race keeps its own", () => {
    assert.equal(endText(base).result, CANDIDATES_END_RESULT);
    assert.equal(endText(base, { party: true }).result, PARTIES_END_RESULT);
    assert.doesNotMatch(PARTIES_END_RESULT, /candidate/); assert.match(PARTIES_END_RESULT, /one party won/); assert.match(PARTIES_END_RESULT, /If neither party won/);
    assert.ok(endSentences(base, { party: true }).sentences.join(" ").includes("If neither party won"));
    clean(PARTIES_END_RESULT, "parties end");
    const f = candidateFacts({ a: "DEMVREP", b: "REPVDEM", candA: "the Democratic Party", candB: "the Republican Party", party: true });
    for (const t of Object.values(f)) { assert.doesNotMatch(t, /candidate/, t); clean(t, "party facts"); }
    assert.match(candidateFacts({ a: "A", b: "B", candA: "Smith", candB: "Jones" }).moves, /If neither candidate wins/);
    assert.ok(isPartySubject({ a: "the Democratic Party", b: "the Republican Party" }));
  });
  test("the page and the review API pass the party flag; the name step's sentence says the party line", () => {
    assert.match(page, /const partyRace = settledPick\?\.shape === "candidates" && isPartySubject\(settledPick\.names\);/);
    assert.match(page, /const settledLine = settledPick \? \(partyRace \? PARTIES_PAIR_SENTENCE : settledPairSentence\(settledPick\.shape\)\) : null;/);
    assert.match(page, /textB\.oneLiner\}\. \$\{settledLine\}`/);
    assert.match(page, /endSentences\([^\n]*\{ team: [^\n]*, party: partyRace \}\);/);
    assert.match(page, /candidateFacts\(\{ a: ticker, b: tickerB, candA: elPick\.a\.label, candB: elPick\.b\.label, party: partyRace \}\)/);
    assert.match(read("src/lib/burnticker/launchReview.ts"), /const partyRace = settled\?\.shape === "candidates" && isPartySubject\(settledNames\(pair\?\.names, sides\)\);\n\s*const end = endText\(asBuilt, \{ team: [^\n]*, party: partyRace \}\);/);
  });
  test("\"Two markets, one race\" is said once: the money path leaves out the line the pair line already said", () => {
    assert.match(page, /<FundsFlowView flow=\{reviewSettled\.flow\} open saidAbove=\{reviewSettled\.sentence \?\? settledLine\} \/>/);
    assert.match(card, /\{flow\.oneLiner !== saidAbove && <p className="mt-1 text-sm text-neutral-100">\{flow\.oneLiner\}<\/p>\}/);
    assert.ok(PARTIES_PAIR_SENTENCE.startsWith("Two markets, one race") && CANDIDATES_PAIR_SENTENCE.startsWith("Two markets, one race"));
  });
});

describe("3. the team review: the champion path once, under When it ends", () => {
  const page = read("src/app/burnticker/launch/page.tsx"), picker = read("src/app/burnticker/launch/EndChoicePicker.tsx");
  test("the review's picker leaves out the winning sentence; the name step's picker, which stands alone, keeps it", () => {
    assert.match(page, /const endChoiceBlock = endChoiceFor\(true\), endChoiceReview = endChoiceFor\(false\);/);
    assert.match(page, /model=\{choiceA\} hideWinning=\{!withWinning\}/);
    assert.match(page, /label: FACT_LABELS\.ends, [^\n]*extra: endChoiceReview \}/);
    assert.match(page, /choice=\{endChoiceReview\} \/>\}/);
    assert.match(page, /<ReviewCard mode="name" endChoice=\{endChoiceBlock\}/);
    assert.match(picker, /\{model\.winning && !hideWinning && <p className="text-xs text-neutral-200" data-end-winning>/);
  });
  test("with the picker below, When it ends drops the losing sentence, which the picker says", () => {
    assert.match(page, /const endLines = choiceA\?\.offered && choiceA\.winning \? endLines0\.filter\(\(x\) => !\/\^If they do not\\b\/\.test\(x\)\) : endLines0;/);
  });
});

describe("4. Polymarket ladders list by their rung", () => {
  test("numbers and dates parse; names do not", () => {
    assert.equal(ladderNumber("↑ 95,000"), 95_000); assert.equal(ladderNumber("↓ 60,000"), 60_000); assert.equal(ladderNumber("<60k"), 60_000);
    assert.equal(ladderNumber("$1.5M"), 1_500_000); assert.equal(ladderNumber("200k or more"), 200_000); assert.equal(ladderNumber("60-70k"), 60_000);
    for (const n of ["Biden", "Trump 2028", "Q1 2026"]) assert.equal(ladderNumber(n), null, n);
    assert.ok(ladderDate("December 31")! < ladderDate("Dec 31, 2026")!); assert.equal(ladderDate("2026-12-31"), Date.UTC(2026, 11, 31));
    assert.equal(ladderDate("Tom"), null);
    assert.equal(ladderKeys(["Trump", "↑ 95,000"]), null, "a mixed list keeps its order");
  });
  test("the Bitcoin ladder sorts; a list of names keeps its source order", () => {
    const raw = ["↑ 95,000", "↓ 60,000", "↓ 70,000", "↓ 65,000", "↑ 200,000", "↑ 150,000"];
    assert.deepEqual(ladderOrder(raw, (x) => x), ["↓ 60,000", "↓ 65,000", "↓ 70,000", "↑ 95,000", "↑ 150,000", "↑ 200,000"]);
    assert.deepEqual(ladderOrder(["Trump", "Harris", "Vance"], (x) => x), ["Trump", "Harris", "Vance"]);
  });
  const mkt = (title: string, i: number): GammaMarket => ({ conditionId: `0x${i}`, question: `Will Bitcoin reach ${title} in 2026?`, outcomes: ["Yes", "No"], endDate: "2026-12-31T00:00:00Z", closed: false, groupItemTitle: title, negRisk: true, sportsMarketType: null, inactive: false } as unknown as GammaMarket);
  const ev: GammaEvent = { id: "1", slug: "what-price-will-bitcoin-hit-in-2026", title: "What price will Bitcoin hit in 2026?", closed: false, endDate: "2026-12-31T00:00:00Z", closedTime: null, tags: [], description: null, markets: ["↑ 95,000", "↓ 60,000", "↓ 70,000", "↓ 65,000", "↑ 200,000"].map(mkt) };
  test("the event search lists the rungs in order", () => {
    const hit = searchHits([ev], { perEvent: 200 }).events[0];
    assert.deepEqual(hit.markets.map((m) => m.outcome), ["↓ 60,000", "↓ 65,000", "↓ 70,000", "↑ 95,000", "↑ 200,000"]);
  });
  test("the event picker (polySearch) lists them in order too", () => {
    const src = read("src/lib/burnticker/polySearch.ts");
    assert.match(src, /const outs = ladderOrder\(e\.markets\.filter\(live\), outcomeLabel\);/);
    // an event picker whose outcomes are numbers (a count ladder under a phrase the picker knows)
    const grammys: GammaEvent = { ...ev, slug: "grammys-count", title: "Grammys 2026: how many awards for the top artist?", markets: ["5", "2", "4", "3+", "1"].map(mkt) };
    const m = matchPolymarket(splitQuery("grammys"), [grammys]);
    assert.equal(m.events.length, 1);
    assert.deepEqual(m.events[0].outcomes.map((o) => o.label), ["1", "2", "3+", "4", "5"]);
  });
});

describe("5. Live coins counts every live coin shown", () => {
  const card = (id: string, ticker: string, extra: Partial<CardView> = {}) => ({ id, ticker, group: "public", tags: [], ...extra }) as unknown as CardView;
  test("the created $DEFICIT card adds one to the registry's count; a draft, a test card or a listed ticker does not", () => {
    assert.equal(liveCoinsTotal(1, [card("deficit", "DEFICIT")], ["PHINFLWIN"]), 2);
    assert.equal(liveCoinsTotal(1, [card("deficit", "DEFICIT", { tags: [{ label: "Not created yet", tone: "featured" }] as CardView["tags"] })], ["PHINFLWIN"]), 1);
    assert.equal(liveCoinsTotal(1, [card("deficit", "DEFICIT", { group: "test" })], ["PHINFLWIN"]), 1);
    assert.equal(liveCoinsTotal(2, [card("deficit", "DEFICIT")], ["PHINFLWIN", "DEFICIT"]), 2);
    assert.equal(liveCoinsTotal(1, [card("rehearsal", "REHEARSAL")], ["PHINFLWIN"]), 1);
  });
  test("the stats tile reads it", () => {
    assert.match(read("src/app/burnticker/CoinsIndex.tsx"), /\["Live coins", String\(liveCoinsTotal\(ix\.totals\.live, home\.data\?\.featured \?\? \[\], ix\.tokens\.map\(\(t\) => t\.ticker\)\)\)\]/);
  });
});

describe("6. the $DEFICIT site: no tick over zero receipts", () => {
  const html = read("site/deficit/index.html");
  test("zero receipts say no receipts yet; the tick waits for one", () => {
    assert.match(html, /var nReceipts = s\.burned && s\.burned\.count \? s\.burned\.count : 0;/);
    assert.match(html, /\(ok \? \(nReceipts > 0 \? "all receipts ✓" : "no receipts yet"\) :/);
    assert.match(html, /'<span class="pulse' \+ \(ok && nReceipts > 0 \? "" : " off"\)/);
  });
  test("the page's script still parses", () => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    for (const s of scripts) assert.doesNotThrow(() => new Function(s));
  });
});

describe("7. the progress sentence near a zero raise", () => {
  const curve = (raised: number) => progressOf(readinessOf({ launched: true, phase: "curve", raisedSol: raised, graduationSol: 85, poolVerified: false, latest: null }), { raiseSol: 85, raisedSol: raised }).next;
  test("under 0.01 SOL raised: not started; otherwise raised of the raise and what is left", () => {
    assert.equal(CURVE_STARTED_SOL, 0.01);
    assert.equal(curve(0.00000004), "The curve has not started filling. It graduates at 85 SOL raised.");
    assert.equal(curve(12.5), "12.5 of 85 SOL raised; 72.5 more to graduate.");
    assert.equal(curve(0.01), "0.01 of 85 SOL raised; 84.99 more to graduate.");
    for (const r of [0, 12.5]) clean(curve(r), "progress");
  });
});

describe("8. the swap fee line says the burn pool's share as half of the fee", () => {
  test("the curve: the whole fee, half of it to the burn pool, the rest to Raydium and Burnticker", () => {
    assert.equal(feeLine({ totalBps: 100, burnPoolBps: 50, feeText: "0.01", burnPoolText: "0.005", unit: "SOL", rest: { raydiumBps: 25, platformBps: 25 } }),
      "The swap pays a 1% fee (0.01 SOL). Half of it (0.5% of the swap, 0.005 SOL) goes to this coin's burn pool; the rest goes to Raydium (0.25%) and Burnticker (0.25%).");
    assert.equal(shareOfFee(50, 100), "Half of it"); assert.equal(shareOfFee(25, 100), "A quarter of it"); assert.equal(shareOfFee(7, 30), "Part of it"); assert.equal(shareOfFee(30, 30), "All of it");
    clean(feeLine({ totalBps: 100, burnPoolBps: 50, feeText: "0.01", burnPoolText: "0.005", unit: "SOL", rest: { raydiumBps: 25, platformBps: 25 } }), "fee line");
    clean(feeLine({ totalBps: 30, burnPoolBps: 7, feeText: "1,000", burnPoolText: "233", unit: "$TEST" }), "pool fee line");
    assert.match(read("src/app/burnticker/t/[ticker]/TradePanel.tsx"), /rest: market\?\.kind === "curve" \? \{ raydiumBps: fees\.raydiumBps, platformBps: fees\.platformBps \} : null \}\)/);
  });
});

describe("9. /test-coins says the rehearsal sentence once", () => {
  test("the intro no longer repeats it; the pinned sentence stays on the coin line", () => {
    assert.doesNotMatch(TEST_COINS_COPY.intro, /not so you trade/);
    assert.match(REHEARSAL_SENTENCE, /not so you trade it\.$/);
    clean(TEST_COINS_COPY.intro, "test coins intro");
  });
});

describe("10. the NBA tip time: TheSportsDB's strTimestamp is UTC, read as UTC", () => {
  // the real row (TheSportsDB event 2601665, read 2026-10-14); ESPN's scoreboard lists the same game at 2026-10-20T19:00Z (3:00 PM EDT,
  // timeValid, NBC), so "Tue, Oct 20, 1:00 PM MDT" is the real tip-off, not a time-zone mix-up
  const row = { idEvent: "2601665", strEvent: "Detroit Pistons vs Boston Celtics", strHomeTeam: "Detroit Pistons", strAwayTeam: "Boston Celtics", strTimestamp: "2026-10-20T19:00:00", dateEvent: "2026-10-20", strTime: "19:00:00", strTimeLocal: null, intRound: "0", strStatus: "NS", idLeague: "4387", strSeason: "2026-2027" };
  test("the row parses to 19:00Z, which is 1:00 PM in Denver", () => {
    const g = tsdbGames("nba", { events: [row] }, 2026)[0];
    assert.equal(new Date(g.startsAt).toISOString(), "2026-10-20T19:00:00.000Z");
    const shown = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(g.startsAt));
    assert.equal(shown, "Tue, Oct 20, 1:00 PM MDT");
  });
});

describe("11. /changelog: a run of republishes is one entry with a count", () => {
  const rel = (source: string, files: number): string => `## 2026-10-11 — publish from ${source}\n\n- files published: ${files}\n`;
  test("three publishes of one source after the first collapse into one entry that counts them", () => {
    const rs = parseChangelog(["# Changelog\n", rel("aaaaaaaaaaaa", 5), rel("bbbbbbbbbbbb", 6), rel("bbbbbbbbbbbb", 6), rel("bbbbbbbbbbbb", 6), rel("bbbbbbbbbbbb", 6), rel("cccccccccccc", 7)].join("\n"));
    assert.equal(rs.length, 6);
    const c = collapseRepublishes(rs);
    assert.deepEqual(c.map((r) => [r.source, r.times]), [["aaaaaaaaaaaa", 1], ["bbbbbbbbbbbb", 1], ["bbbbbbbbbbbb", 3], ["cccccccccccc", 1]]);
    assert.equal(c[2].lines[0], "The same source as the release before it was published again, 3 times in a row.");
    assert.equal(c.filter((r) => r.lines.some((l) => l.startsWith("The same source"))).length, 1, "said once");
    clean(RELEASE_LINES.sameSourceTimes(3), "republish count");
    assert.equal(RELEASE_LINES.sameSourceTimes(1), RELEASE_LINES.sameSource);
  });
  test("a single republish is left as it was; the page renders the collapsed list", () => {
    const one: Release[] = parseChangelog([rel("aaaaaaaaaaaa", 5), rel("aaaaaaaaaaaa", 5), rel("cccccccccccc", 7)].join("\n"));
    assert.deepEqual(collapseRepublishes(one).map((r) => r.lines[0]), [RELEASE_LINES.first, RELEASE_LINES.sameSource, "7 files were published, 2 more than the release before."].map((x, i) => (i === 2 ? one[2].lines[0] : x)));
    assert.match(read("src/app/burnticker/changelog/page.tsx"), /\{collapseRepublishes\(releases\)\.reverse\(\)\.map\(\(r, k\) => \(/);
  });
});
