// WEBSITE-26 (2026-10-13): the cheap-features pass wired into the pages (WIRING-FEATURES.md items 1–16) and the end-sink choices on step 4
// and the review (WIRING-END-SINKS.md). Pins the library calls the pages make, the copy (plain English, lint clean), and the wiring by
// each page's source: the calendar, embed and scoreboard on the coin page; the leaderboard and digest pages (never on the home page); the
// operator's post queue behind the PIN; the checklist on Your coins; the review's last season and closed result simulator; Coin vs Coin's
// fight lead, run presets, rivalry links and `{ flip }`; the incinerator end setting onEnd.endSink "incinerator".
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DEFAULT_ON_END, lockRule, validateRule, type BurnRule } from "@/lib/burnticker/rules";
import { END_CHOICE_LINES, endChoiceModel, endChoiceOf, withEndChoice, GUIDED_STEPS } from "@/lib/burnticker/guidedLaunch";
import { siteLaunchState } from "@/lib/burnticker/launchAvailability";
import { simulateResults } from "@/lib/burnticker/simulator";
import { RIVALRY_TEMPLATES, TEMPLATES, rivalryById, settingsLine } from "@/lib/burnticker/templates";
import { DERBY_RUN_PRESETS, runPresetLabel, type DerbyScoreboard } from "@/lib/burnticker/derby/spec";
import { fightLead } from "@/lib/burnticker/derby/tile";
import { generatedNames, NONE_EDITED } from "@/lib/burnticker/coinPicker";
import * as copy from "../src/app/burnticker/_components/featureCopy.ts";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { ONE_SHOT as ONE } from "./burntickerHelpers.ts";

const cfg = loadCopyLintConfig();
/** Plain English: the copy lint, and none of the words the brief bars (buy, price, will, payout, target, coming soon, dates). */
const clean = (t: string) => {
  const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`);
  assert.doesNotMatch(t, /\b(will|buy|buys|price|payout|target)\b|coming soon|\b20\d\d\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d/i, t);
};
const read = (f: string) => fs.readFileSync(f, "utf8");
const PAGE = "src/app/burnticker/launch/page.tsx", TILE = "src/app/burnticker/launch/CoinVsCoinTile.tsx", COIN = "src/app/burnticker/t/[ticker]/page.tsx";

describe("WIRING-END-SINKS: the four end choices", () => {
  const rule = lockRule({ ...ONE, onEnd: DEFAULT_ON_END }).rule as BurnRule;
  test("one sentence each, in order; another coin only with sinkPicker, the incinerator only with burnSol; this coin only on the winning path", () => {
    assert.deepEqual(endChoiceModel(rule).options.map((o) => o.kind), ["deficit"], "today: $DEFICIT's burn alone (both host options off)");
    assert.deepEqual(endChoiceModel(rule, { sinkPicker: true, burnSol: true }).options.map((o) => o.line), [END_CHOICE_LINES.coin, END_CHOICE_LINES.deficit, END_CHOICE_LINES.burnSol]);
    assert.equal(endChoiceModel(rule).winning, null, "a plain coin has no winning path that burns itself");
    for (const t of Object.values(END_CHOICE_LINES)) clean(t);
    assert.equal(siteLaunchState({}).burnSol.available, false); assert.equal(siteLaunchState({}).sinkPicker.available, false);
  });
  test("the incinerator choice sets onEnd.endSink \"incinerator\", keeps the wind-down numbers, validates, reads back and keeps the choice on screen", () => {
    const r = withEndChoice(rule, { kind: "burn-sol" });
    assert.deepEqual(r.onEnd, { windDownDays: DEFAULT_ON_END.windDownDays, sweepThresholdLamports: DEFAULT_ON_END.sweepThresholdLamports, endSink: "incinerator" });
    assert.doesNotThrow(() => validateRule(r));
    assert.deepEqual(endChoiceOf(r), { kind: "burn-sol" });
    assert.equal(endChoiceModel(r, { burnSol: true }).offered, true);
    assert.deepEqual(withEndChoice(r, { kind: "deficit" }).onEnd, DEFAULT_ON_END, "picking $DEFICIT again restores endSink: true");
  });
  test("the page: single coins only, other ends filtered by the same flags, the five steps, latch, editedFor, prepareIfCurrent and the gates kept", () => {
    const page = read(PAGE);
    assert.equal(GUIDED_STEPS.length, 5);
    // PROD-03 (2026-10-19): the incinerator follows each coin's own rule (pairEnds.ts endChoicesFor), never the side it sits on
    assert.match(page, /\.\.\.endChoicesFor\(rule, endSite\), team: teamRef/);
    assert.match(page, /\.\.\.endChoicesFor\(ruleB, endSite\), team: teamRefB/);
    assert.match(page, /o\.kind === "named-coin" \? site\.sinkPicker\.available : o\.kind === "incinerator" \? endChoicesFor\(rule, endSite\)\.burnSol/);
    for (const k of ["prepareIfCurrent(sentRev", "setEditedFor(", "reviewMatchesDraft(reviewSlot, curRev.current)", "<ReviewCard mode=\"name\" endChoice={endChoiceBlock}"]) assert.ok(page.includes(k), k);
    assert.ok(!fs.existsSync("WIRING-END-SINKS.md") && !fs.existsSync("WIRING-FEATURES.md"), "both wiring notes are applied and deleted");
  });
});

describe("WIRING-FEATURES: the review", () => {
  test("item 5: the last season's lines where the projection is unavailable; its reason behind Details otherwise", () => {
    const page = read(PAGE);
    assert.match(page, /rv\.backtest\?\.available \? rv\.backtest\.lines\.map/);
    assert.match(page, /data-last-season-unavailable/);
  });
  test("item 6: a CLOSED disclosure \"What one result does\" under the rule summary; both coins of a pair in every row", () => {
    const sim = read("src/app/burnticker/launch/SimulatorDisclosure.tsx"), card = read("src/app/burnticker/launch/ReviewCard.tsx");
    assert.match(sim, /export const SIMULATOR_LABEL = "What one result does";/);
    assert.match(sim, /<details className="[^"]*" data-simulator>/, "closed: no open attribute");
    assert.match(sim, /simulateResults\(rule, \{ poolSol: pool\.trim\(\)/);
    assert.match(card, /\{mode === "review" && p\.simulator\}/);
    assert.match(read(PAGE), /simulator=\{reviewCurrent && rv\?\.simulation \? <SimulatorDisclosure simulation=\{rv\.simulation\} rule=\{rule\} \/> : null\}/);
    assert.match(read(TILE), /<SimulatorDisclosure simulation=\{shown\.review\.simulation\} rule=\{model\.rule\} \/>/);
    const pair = simulateResults(rule1(), { poolSol: "2", ticker: "A", pair: { tickerA: "A", tickerB: "B", winnerTakesBurn: true } });
    assert.ok(pair.rows.every((r) => r.coins.length === 2));
    assert.equal(simulateResults(rule1(), { poolSol: "lots" }).available, false);
    for (const t of [/SIMULATOR_LABEL = "([^"]+)"/, /SIMULATOR_POOL_LABEL = "([^"]+)"/, /SIMULATOR_INTRO = "([^"]+)"/]) clean(t.exec(sim)![1]);
  });
});
const rule1 = () => lockRule({ ...ONE, onEnd: DEFAULT_ON_END }).rule as BurnRule;

describe("WIRING-FEATURES: Coin vs Coin", () => {
  test("item 15: the tile passes { flip }; a daily race gets the fight tickers, the flippening keeps its pair tickers", () => {
    assert.match(read(TILE), /generatedNames\(a, b, n, edited, \{ flip \}\)/);
    assert.deepEqual(generatedNames({ symbol: "WIF" }, { symbol: "BONK" }, { a: "", b: "", ta: "", tb: "" }, NONE_EDITED, { flip: false }).ta, "WIFWINS");
    assert.deepEqual(generatedNames({ symbol: "SOL" }, { symbol: "ETH" }, { a: "", b: "", ta: "", tb: "" }, NONE_EDITED, { flip: true }).ta, "SOLVETH");
  });
  test("item 11: the fight leads the tile and the review card for a daily race, never the flippening", () => {
    const tile = read(TILE);
    assert.match(tile, /const lead = !flip && a && b \? fightLead\(TA, TB, seasonDays\) : null;/);
    assert.match(tile, /lead=\{lead\}/); assert.match(read("src/app/burnticker/launch/ReviewCard.tsx"), /data-fight-lead>\{p\.lead\}/);
    clean(fightLead("WIFWINS", "BONKWINS", 14));
  });
  test("item 14: run presets 7 / 14 / 30 beside the shares, passed as seasonDays; the derby settings line names them", () => {
    const tile = read(TILE);
    assert.deepEqual([...DERBY_RUN_PRESETS], [7, 14, 30]);
    assert.match(tile, /DERBY_RUN_PRESETS\.map\(\(d\) =>/); assert.match(tile, /\{ a: a\.underlying, b: b\.underlying, window: window_, seasonDays, flip, fraction, now \}/);
    assert.match(tile, /\[a, b, flip, fraction, seasonDays\]\);/, "the fingerprint is recomputed for a new run length");
    for (const id of ["coin-vs-coin", "flippening", "bracket"]) { const t = settingsLine(TEMPLATES.find((x) => x.id === id)!); assert.match(t, /7, 14 or 30 days/); clean(t); }
    for (const d of DERBY_RUN_PRESETS) clean(runPresetLabel(d));
  });
  test("item 13: three rivalry deep links on the templates page; the launch page carries rivalry= to the tile, which picks both coins and opens Name", () => {
    const tpl = read("src/app/burnticker/templates/page.tsx"), tile = read(TILE), page = read(PAGE);
    assert.equal(RIVALRY_TEMPLATES.length, 3);
    assert.match(tpl, /RIVALRY_TEMPLATES\.map/); assert.match(tpl, /href=\{r\.href\}/);
    assert.match(page, /if \(st\.derby && rivalryParam\) setEntry\(\(e\) => \(e \? \{ \.\.\.e, rivalry: rivalryParam \} : e\)\);/);
    assert.match(tile, /rivalryById\(u\.get\("rivalry"\) \?\? entry\?\.rivalry \?\? null\)/); assert.match(tile, /onPhase\?\.\("name"\)/);
    for (const r of RIVALRY_TEMPLATES) { assert.equal(rivalryById(r.id), r); assert.match(r.href, /^\/burnticker\/launch\?template=(coin-vs-coin|flippening)&rivalry=/); }
    clean("Both reference coins are already picked. The link opens the step where you name the two new coins.");
  });
});

describe("WIRING-FEATURES: the coin page", () => {
  test("items 2, 7 and 12: the calendar under the rule with Add to calendar, the receipt embed closed by default, the scoreboard", () => {
    const coin = read(COIN), f = read("src/app/burnticker/t/[ticker]/CoinFeatures.tsx");
    assert.match(coin, /<BurnCalendar mint=\{s\.mint\}/); assert.match(coin, /<ReceiptEmbed mint=\{s\.mint\}/); assert.match(coin, /<ScoreboardCard s=\{s\.derbyScoreboard\}/);
    assert.match(f, /\/api\/burnticker\/v1\/coins\/\$\{encodeURIComponent\(mint\)\}\/calendar/); assert.match(f, /href=\{c\.ics\}/);
    assert.match(f, /<details className="[^"]*" data-receipt-embed>/, "closed: no open attribute");
    assert.equal(copy.receiptEmbedSnippet("MiNt111", "$X. A rule. No burn recorded yet."), '<a href="https://burnticker.com/burnticker/t/MiNt111"><img src="https://burnticker.com/burnticker/img/receipt/MiNt111.png" alt="$X. A rule. No burn recorded yet." width="600" height="315"></a>');
    assert.equal(copy.receiptAlt({ ticker: "LADWIN", sentence: "Burns 2% on each Dodgers win.", latest: null }), "$LADWIN. Burns 2% on each Dodgers win. No burn recorded yet.");
    const sb: DerbyScoreboard = { tickers: { a: "WIFWINS", b: "BONKWINS" }, daysWon: { a: 12, b: 9 }, ties: 0, withheld: 0, streak: { side: "A", days: 3 }, forwardedSol: { toA: "0.4", toB: "0.2" }, run: { day: 21, of: 30, over: false }, line: "x" };
    const l = copy.scoreboardLines(sb);
    assert.equal(l.score, "$WIFWINS 12 : 9 $BONKWINS"); assert.equal(l.run, "Day 21 of 30"); assert.match(l.streak!, /3 days in a row/);
    assert.equal(copy.scoreboardLines({ ...sb, streak: { side: "B", days: 1 } }).streak, null);
    assert.equal(copy.calendarWhen({ at: null, day: "2026-10-14", allDay: true }, "en-US"), "Wed, Oct 14");
  });
  test("the copy the pages add is plain English", () => {
    for (const t of [copy.CALENDAR_HEADING, copy.CALENDAR_ADD, copy.EMBED_RECEIPT_LABEL, copy.EMBED_RECEIPT_NOTE, copy.SCOREBOARD_HEADING, copy.LEADERBOARD_TITLE, copy.LEADERBOARD_INTRO, copy.LEADERBOARD_EMPTY, copy.DIGEST_TITLE, copy.DIGEST_INTRO, ...Object.values(copy.DIGEST_SECTIONS), ...Object.values(copy.DIGEST_EMPTY), copy.POST_QUEUE_TITLE, copy.POST_QUEUE_INTRO, copy.POST_QUEUE_PIN, copy.POST_QUEUE_MARK]) clean(t);
  });
});

describe("WIRING-FEATURES: the new pages, never on the home page", () => {
  test("item 3: the leaderboard under Coins, four lists with the library's labels and the empty line", () => {
    const lb = read("src/app/burnticker/leaderboard/page.tsx");
    assert.match(lb, /leaderboard\(platform\(\)\.registry/); assert.match(lb, /b!\.labels\[k\]/); assert.match(lb, /LEADERBOARD_EMPTY/); assert.match(lb, /b\.note/);
    assert.equal(copy.LEADERBOARD_EMPTY, "No receipts yet.");
    assert.match(read("src/app/burnticker/_components/nav.ts"), /"\/burnticker\/leaderboard", "\/burnticker\/digest"\]/);
  });
  test("item 8: the digest page reads one UTC day, links the day before and after, and refuses a bad day", () => {
    const dg = read("src/app/burnticker/digest/page.tsx");
    assert.match(dg, /buildDigest\(platform\(\)\.registry, day/); assert.match(dg, /d\.lines\[0\]/); assert.match(dg, /\?day=\$\{shiftDay\(day, -1\)\}/); assert.match(dg, /data-digest-bad-day/);
    assert.equal(copy.shiftDay("2026-03-01", -1), "2026-02-28"); assert.equal(copy.shiftDay("2026-12-31", 1), "2027-01-01");
  });
  test("neither page nor any of the new blocks is on the home page", () => {
    for (const f of ["src/app/burnticker/page.tsx", "src/app/burnticker/CoinsIndex.tsx"]) assert.doesNotMatch(read(f), /leaderboard|digest|Leaderboard|Digest|LaunchChecklist|BurnCalendar/, f);
  });
  test("item 9: the post queue is operator-only behind the PIN, copy buttons, Mark used, and never posts", () => {
    const pq = read("src/app/burnticker/operator/post-queue/page.tsx");
    assert.match(pq, /"x-action-pin": p/); assert.match(pq, /\/api\/burnticker\/v1\/ops\/post-queue\/used/); assert.match(pq, /JSON\.stringify\(\{ id \}\)/);
    assert.match(pq, /navigator\.clipboard\?\.writeText/); assert.match(pq, /POST_QUEUE_MARK/); assert.match(pq, /setActionPin/);
    assert.doesNotMatch(pq, /localStorage|sessionStorage/, "the PIN is held in memory only");
  });
  test("item 10: the checklist on Your coins: six ticks, null is \"not read\", then the next step and who", async () => {
    assert.match(read("src/app/burnticker/me/page.tsx"), /<LaunchChecklist mint=\{c\.mint\} \/>/);
    const cl = read("src/app/burnticker/_components/LaunchChecklist.tsx");
    assert.match(cl, /\/checklist`/); assert.match(cl, /s\.done === null && <span[^>]*>, \{CHECKLIST_NOT_READ\}/);
    const { checklistOf } = await import("@/lib/burnticker/checklist");
    const a = checklistOf({ ticker: "X", mint: "M", status: "live", launched: true, phase: null, poolRegistered: null, readings: 0, burns: 0 });
    assert.equal(a.steps.length, 6);
    // launch night 2026-10-13: the helper lives in checklist.ts (the who is its own sentence, never "(the creator)" glued to the action)
    const { checklistNextLine } = await import("@/lib/burnticker/checklist");
    const next = checklistNextLine(a);
    assert.match(cl, /import \{ checklistNextLine \}/); assert.match(cl, /lib\/burnticker\/checklist";/);
    assert.doesNotMatch(next, /\(the creator\)|\(traders|\(the keeper\)/);
    clean(next);
  });
});
