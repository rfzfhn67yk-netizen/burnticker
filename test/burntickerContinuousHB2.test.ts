// CONTINUOUS AUDIT 2026-10-19, RUN 2 (docs/burnticker/audits/continuous/bugs.md HB-13 to HB-28, suggestions.md HS-1). One pure test or
// source check per fix, plus the copy lint on every new public sentence: each coin's fee legs from the tier it pinned and both tiers in
// the site-wide copy, one cap sentence, the losing side's decided warning, and the P3 batch (dates, waiting words, headings, pattern
// units, plural team names and the shared title ticker, feeds-only browse, decided lifecycle and embed lines, devnet example receipts
// without repository paths, the deferred probe timer, the rollback alert, the incident entry).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { CPMM_MAINNET_TIER_14, CPMM_MAINNET_TIER_9, CPMM_TIER_14_SINCE } from "@/lib/burnticker/cpmmTier";
import { EARLIER_COINS_LINE, EARLIER_OPERATOR_CLAUSE, TIER_14_CUTOVER_WORDS, postGraduationShareLine } from "@/lib/burnticker/feeShareLine";
import { DEV_FEE_LINE, postGraduationFeesFor } from "@/lib/burnticker/fees";
import { CAP_ENFORCED_SENTENCE } from "@/lib/burnticker/capInForce";
import { buildReceiptsJson, buildTokenStatus, DECIDED_LINE, LIVE_LINE, VOIDED_LINE, feeFlowLine, lifecycleLineFor } from "@/lib/burnticker/tokenPage";
import { tokenPageInput } from "@/lib/burnticker/server";
import { lpFeeLine } from "@/lib/burnticker/trustpack/ledger";
import { OPERATOR_COPY } from "@/lib/burnticker/trustpack/copy";
import { decidedSwapWarning, gameDayOf, losingPairLine, teamRef, type DecidedWarningInput } from "@/lib/burnticker/decidedWarning";
import { STATUS_SENTENCES, badgeDay, coinStatusFactsOf, coinStatusSentence, waitingSentenceOf } from "@/lib/burnticker/coinStatus";
import { espnGameUrl, espnScoreboardDay } from "@/lib/burnticker/sources/gameSettle";
import { FEATURED_HEADING, featuredHeading } from "@/lib/burnticker/cardView";
import { EVERY_SENTENCES, PATTERNS, everySentenceFor, patternOptions } from "@/lib/burnticker/guidedLaunch";
import { eventIdentity } from "@/lib/burnticker/eventIdentity";
import { describeRule, titleSuggest, titleTeamOfPhrase } from "@/lib/burnticker/describe";
import { teamTicker } from "@/lib/burnticker/tickers";
import { categoryCards, categoryList, type CategoryDef, type FeedCardInput } from "@/lib/burnticker/browse";
import { NO_NEXT_LINES, nextLine } from "@/lib/burnticker/embed";
import { DEVNET_EXAMPLE_NOTE, publicSampleReceipts, sampleReceipts } from "@/lib/burnticker/trustpack/samples";
import { REGISTRY_NEWER_EXPECTED } from "@/lib/burnticker/registry";
import { progressOf } from "@/lib/burnticker/progress";
import type { BurnRule } from "@/lib/burnticker/rules";
import { makeWorld } from "./burntickerApiHelpers.ts";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };
const read = (p: string) => fs.readFileSync(p, "utf8");
const NOW = Date.parse("2026-10-19T21:00:00Z");

describe("HB-13: a coin's fee legs come from the tier it pinned; the site-wide copy names both tiers", () => {
  const statusFor = async (cpConfig: string) => {
    const w = await makeWorld();
    const t = w.registry.token(w.bronco.mint)!;
    const base = await tokenPageInput(w.p, t, NOW, { live: false });
    const input = { ...base, chain: { ...base.chain, cluster: "mainnet", program: { ...(base.chain.program ?? {}), config: { ...(base.chain.program?.config ?? {}), cpConfig } } }, lifecycle: { ended: null, windDown: null, lastSweep: null, line: LIVE_LINE, fees: "stale global line" } } as typeof base;
    return buildTokenStatus(input, buildReceiptsJson(input));
  };
  // eighth pass B-23 / HB-184 (owner B-17 decision): LaunchLab moves every graduating coin into the platform's current tier, so a coin's
  // split is that tier's whatever it recorded at creation (it was the pin's until the decision)
  for (const [label, tier] of [["tier 9", CPMM_MAINNET_TIER_9], ["tier 14", CPMM_MAINNET_TIER_14]] as const) {
    test(`a coin that recorded ${label}: fees.sentence and lifecycle.fees state the platform tier's split`, async () => {
      const s = await statusFor(tier.id);
      const current = postGraduationFeesFor("mainnet");
      assert.deepEqual(s.fees.postGraduation, current);
      const line = postGraduationShareLine(current);
      assert.ok(s.fees.sentence.includes(line), s.fees.sentence);
      assert.equal(s.lifecycle?.fees, feeFlowLine(current));
      assert.ok(line.includes("about 0.98% of every swap goes to the coin's burn pool and about 0.13% to the operator"), line);
    });
  }
  test("the earlier-coins line names the one tier and the date in words", () => {
    assert.equal(CPMM_TIER_14_SINCE, "2026-10-19T20:17:00Z");
    assert.equal(TIER_14_CUTOVER_WORDS, "19 October 2026, 20:17 UTC");
    assert.equal(EARLIER_COINS_LINE, "Every coin graduates into a pool on the platform's current fee tier, tier 14 (1.25% per swap). Coins made before 19 October 2026 recorded tier 9 when they were created and pay 1.25% all the same.");
    assert.doesNotMatch(EARLIER_COINS_LINE, /\d{4}-\d{2}-\d{2}/);
  });
  test("footer, current-status, trust, fee ledger and the operator note all carry the one split", () => {
    assert.ok(DEV_FEE_LINE.includes("every coin pays 1.25% per swap (Raydium fee tier 14)") && !DEV_FEE_LINE.includes("0.88%"), DEV_FEE_LINE);
    assert.match(read("src/lib/burnticker/currentStatus.ts"), /\$\{bothTiersLineNow\(tierPinPendingFor\(vb\)\)\}/);   // HS-96: BOTH_TIERS_LINE plus the tier-pin sentence while pending
    // HB-50 (run 4): another network names its own tier; mainnet adds who decides the tier (eighth pass B-23)
    assert.match(read("src/lib/burnticker/trust.ts"), /cluster === "mainnet" \? `\$\{BOTH_TIERS_LINE\} \$\{deployedTierPinLine\(root\) \? `\$\{DEPLOYED_TIER_PIN_LINE\} ` : ""\}\$\{FEE_TIER_DECIDER_LINE\}` : `\$\{postGraduationShareLine\(newCoinFees\)\} \$\{earlierCoinsLineFor\(cluster\)\}`/);
    const ledger = lpFeeLine("mainnet", null).title;
    assert.match(ledger, /about 0\.13% of every swap .* on every coin, after graduation$/);
    assert.ok(OPERATOR_COPY.devFeeNote.includes("on every coin, whenever it was made"));
    for (const s of [EARLIER_COINS_LINE, DEV_FEE_LINE, ledger, OPERATOR_COPY.devFeeNote]) clean(s);
  });
});

describe("HB-14: one cap sentence, the program enforces it", () => {
  test("the token pool note and the trust page use CAP_ENFORCED_SENTENCE; no source says the keeper enforces the cap today", () => {
    assert.equal(CAP_ENFORCED_SENTENCE, "The burn program enforces this cap on chain.");
    assert.match(read("src/lib/burnticker/tokenPage.ts"), /queuedNote: `\$\{capSentenceAway\(null\)\} \$\{CAP_ENFORCED_SENTENCE\}`/);
    assert.match(read("src/lib/burnticker/trust.ts"), /`\$\{capSentence\(effective\)\} \$\{CAP_ENFORCED_SENTENCE\}`/);
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(ts|tsx|mjs)$/.test(e.name) ? [`${d}/${e.name}`] : []));
    for (const f of walk("src")) assert.doesNotMatch(read(f), /keeper enforces this cap|enforces it once it is deployed/, f);
    clean(CAP_ENFORCED_SENTENCE);
  });
});

const PAIR = { counterpart: { name: "Broncos Wins vs Seahawks", ticker: "DENWIN", sideName: "Broncos" }, clause: { state: "waiting" as const, voidBy: "2026-11-14" } };
const SEA = (o: Partial<DecidedWarningInput> = {}): DecidedWarningInput => ({ status: "live", ticker: "SEAWIN", name: "Seahawks Wins vs Broncos", rules: { oneShot: true }, next: { result: "decided" }, selectorKey: "catalogue:espn.game:nfl-2475453-SEA-win", oracle: "catalogue", profile: { sideName: "Seahawks", badge: "ONE-SHOT · Oct 15, 2026" }, market: { phase: "curve", curve: { threshold: "85", quote: "SOL" } }, pair: PAIR, ...o } as DecidedWarningInput);
const lost = { status: "pending-pair", units: 1, settledAt: "2026-10-16", pairRole: "lost" as const, kind: "binary", result: "loss" };
const won = { ...lost, pairRole: "won" as const, result: "win" };
const HS1 = "$SEAWIN lost. The Broncos beat the Seahawks on 15 October 2026. Swapping into $SEAWIN now cannot make it burn. At the end, its burn pool goes to $DENWIN's burn if both coins graduate by 14 November 2026. If they do not, the pair is voided and $SEAWIN's pool burns down on $SEAWIN over four weeks.";

describe("HS-1 / HB-22: the losing side names the loser, the result and the end", () => {
  test("built from the pair record alone: the other side's name rides on the counterpart, so the page needs no argument", () => {
    assert.equal(decidedSwapWarning(SEA(), [lost]), HS1);
    assert.equal(decidedSwapWarning(SEA({ pair: { ...PAIR, counterpart: { ...PAIR.counterpart, sideName: null } } as never }), [lost], "Broncos"), HS1);
    clean(HS1);
  });
  test("with no other side's name it still says what happens to the pool; clubs and colleges go without the article", () => {
    const anon = decidedSwapWarning(SEA({ pair: { ...PAIR, counterpart: { ...PAIR.counterpart, sideName: null } } as never }), [lost])!;
    assert.match(anon, /^\$SEAWIN lost\. The other side won on 15 October 2026\. Swapping into \$SEAWIN now cannot make it burn\./);
    clean(anon);
    assert.equal(teamRef("Arsenal", "catalogue:espn.game:eng.1-123-ARS-win"), "Arsenal");
    assert.equal(teamRef("Buckeyes", "catalogue:espn.game:cfb-1-OSU-win"), "Buckeyes");
    assert.equal(teamRef("Broncos", "catalogue:espn.game:nfl-1-DEN-win"), "the Broncos");
    clean(losingPairLine({ ticker: "A", otherTicker: "B", sideName: null, otherSideName: null, gameDay: null, voidBy: null }));
  });
  test("server.ts carries the other side's name on the pair counterpart", () => {
    assert.match(read("src/lib/burnticker/server.ts"), /otherSideName = ruleSideName\(p\.registry\.lockedRule\(other\)\.rule\)/);
    assert.match(read("src/lib/burnticker/server.ts"), /lastBurnAt: last\?\.settledAt \?\? null, sideName: otherSideName \}/);
  });
});

describe("HB-15: one game date, the game's local day as the badge and rule state it", () => {
  test("the warning on both sides dates the game Oct 15 (the badge), never the UTC reading day", () => {
    assert.equal(badgeDay("ONE-SHOT · Oct 15, 2026"), "2026-10-15");
    assert.equal(gameDayOf(SEA(), "2026-10-16"), "2026-10-15");
    const den = decidedSwapWarning(SEA({ ticker: "DENWIN", profile: { sideName: "Broncos", badge: "ONE-SHOT · Oct 15, 2026" }, selectorKey: "catalogue:espn.game:nfl-2475453-DEN-win", pair: { counterpart: { name: "Seahawks", ticker: "SEAWIN", sideName: "Seahawks" }, clause: PAIR.clause } as never }), [won])!;
    assert.match(den, /^This coin's one result is in: Broncos won on 15 October 2026\./);
    clean(den);
  });
  test("the coins list dates a one-game coin's result by its badge day", () => {
    const src = read("src/lib/burnticker/coinsListServe.ts");
    assert.match(src, /const latest = latestRow && gameDay \? \{ \.\.\.latestRow, settledAt: gameDay \} : latestRow;/);
  });
  test("the receipt's ESPN link uses ESPN's own (US Eastern) scoreboard day", () => {
    assert.equal(espnScoreboardDay("2026-10-16", "2026-10-16T00:15:00Z"), "2026-10-15");
    assert.equal(espnScoreboardDay("2026-10-16", null), "2026-10-16");
    assert.equal(espnGameUrl("nfl", "2026-10-16", "2026-10-16T00:15:00Z"), "https://www.espn.com/nfl/scoreboard/_/date/20261015");
    assert.equal((read("src/lib/burnticker/sources/gameSettle.ts").match(/espnGameUrl\(g\.league, g\.date, g\.startsAt\)/g) ?? []).length, 2);
  });
});

describe("HB-16: an undecided one-shot waits for its own source", () => {
  const facts = (oracle: string, selectorKey: string) => coinStatusFactsOf({ status: "live", ticker: "NEXTM6", name: "Next M6", rules: { oneShot: true }, oracle, selectorKey, profile: { badge: "ONE-SHOT" } }, []);
  test("the earthquake coin waits for the next magnitude 6 earthquake; a game waits for its final; a market still settles", () => {
    assert.equal(coinStatusSentence(facts("catalogue", "catalogue:usgs.quakenext:6")), "Waiting for the next magnitude 6 earthquake.");
    assert.equal(coinStatusSentence(facts("catalogue", "catalogue:usgs.quakenext:6.5/alaska")), "Waiting for the next magnitude 6.5 earthquake.");
    assert.equal(coinStatusSentence(facts("catalogue", "catalogue:espn.game:nfl-1-DEN-win")), STATUS_SENTENCES.waitingGame);
    assert.equal(coinStatusSentence(facts("catalogue", "catalogue:ll2.launch:abc")), STATUS_SENTENCES.waitingSource);
    assert.equal(coinStatusSentence(facts("polymarket", "polymarket:0xabc")), STATUS_SENTENCES.waitingMarket);
    for (const s of [waitingSentenceOf("catalogue", "catalogue:usgs.quakenext:6"), STATUS_SENTENCES.waitingGame, STATUS_SENTENCES.waitingSource]) { assert.doesNotMatch(s, /market/); clean(s); }
  });
});

describe("HB-17: the featured heading says nothing about tests until a test coin is in the data", () => {
  test("loading, empty and mainnet read 'Featured coin'; a test coin in the group adds the receipts", () => {
    assert.equal(featuredHeading(null), FEATURED_HEADING);
    assert.equal(featuredHeading([]), FEATURED_HEADING);
    assert.doesNotMatch(featuredHeading(null), /test/i);
    assert.equal(featuredHeading([{}]), "Featured coin and test receipts");
    assert.match(read("src/app/burnticker/CoinsIndex.tsx"), /\{featuredHeading\(home\.data \? home\.data\.featured\.filter\(\(v\) => !firstParty\(v\)\) : null\)\}/);
  });
});

describe("HB-18: the 'Every time it happens' card names the rule's own unit", () => {
  const debt = { oracle: "catalogue", series: "treasury.debt", kind: "scalar" } as BurnRule;
  const weather = { oracle: "catalogue", series: "nws.high:DTW-90", kind: "binary" } as BurnRule;
  test("a debt coin says steps (never a win), a weather coin says days (never $1B); the fixed fallback names no unit", () => {
    assert.equal(everySentenceFor(debt, "number"), EVERY_SENTENCES.scalar);
    assert.equal(everySentenceFor(weather, "number"), EVERY_SENTENCES.reading);
    assert.doesNotMatch(everySentenceFor(debt, "number"), /\bwin\b/);
    assert.doesNotMatch(everySentenceFor(weather, "number"), /\$1B/);
    assert.doesNotMatch(PATTERNS.every.sentence, /each win|\$1B|each unit/);
    const every = patternOptions({ follow: "number", rule: weather as never }).options.find((o) => o.id === "every")!;
    assert.equal(every.sentence, EVERY_SENTENCES.reading);
    for (const s of [...Object.values(EVERY_SENTENCES), PATTERNS.every.sentence]) clean(s);
  });
});

describe("HB-20: plural team names and one title ticker", () => {
  test("'the Avalanche win', and the server's description names $COLCUP, as the page does", () => {
    assert.equal(eventIdentity("the Avalanche win the 2027 NHL championship").phrase, "the Avalanche win the 2027 NHL championship");
    assert.equal(eventIdentity("the Red Sox win the 2026 World Series").phrase, "the Red Sox win the 2026 World Series");
    assert.equal(eventIdentity("the Fed cut rates in December").phrase, "the Fed cuts rates in December");
    const team = titleTeamOfPhrase("the Avalanche win the 2027 NHL championship")!;
    assert.equal(team.abbr, "COL");
    assert.equal(titleSuggest(team).ticker, teamTicker("COL", { league: "nhl", window: "title" }));
    const rule = { oracle: "polymarket", market: "0x" + "1".repeat(64), series: null, kind: "binary", binary: { onYes: { fractionOfPool: 1 }, onNo: null }, scalar: null } as unknown as BurnRule;
    const text = describeRule(rule, { ticker: "", eventPhrase: "the Avalanche win the 2027 NHL championship" });
    assert.equal(text.ticker, "COLCUP");
    assert.match(text.paragraph, /^\$COLCUP burns if the Avalanche win the 2027 NHL championship\./);
  });
});

describe("HB-21: Published data lists feeds only", () => {
  const cat: CategoryDef = { id: "sports", label: "Sports", blurb: "", feeds: [], polymarket: ["sports"], kalshi: [], guided: null };
  const sci: CategoryDef = { id: "science", label: "Science", blurb: "", feeds: ["treasury.debt"], polymarket: ["weather"], kalshi: [], guided: null };
  const feed = { id: "treasury.debt", tier: 1, tierLabel: "", title: "Debt", sourceName: "Treasury", sourceUrl: "", cadence: "daily", unit: { label: "$1B" }, launchable: { ok: true, why: null }, flags: [], lastReading: null } as FeedCardInput;
  test("a feeds-only list drops categories without a feed and names no market tag; its cards carry no Polymarket event", () => {
    const list = categoryList([cat, sci], [feed], { feeds: true, polymarket: true, kalshi: false }, { feedsOnly: true });
    assert.deepEqual(list.map((c) => c.id), ["science"]);
    assert.deepEqual(list[0].polymarket, []);
    const cards = categoryCards(sci, { feeds: [feed], polymarket: [{ slug: "x", title: "Hurricane season", markets: [], marketCount: 1 } as never], kalshi: [] }, { feedsOnly: true });
    assert.ok(cards.every((c) => c.venue === "feed"));
    assert.match(read("src/lib/burnticker/api/v1.ts"), /venue: q\.get\("venue"\)/);
  });
});

describe("HB-25 and HB-28: a decided coin is not 'live' and has no overdue read", () => {
  test("the lifecycle line of a decided or voided one-shot", () => {
    assert.equal(lifecycleLineFor(LIVE_LINE, "decided"), DECIDED_LINE);
    assert.equal(lifecycleLineFor(LIVE_LINE, "void"), VOIDED_LINE);
    assert.equal(lifecycleLineFor(LIVE_LINE, "pending"), LIVE_LINE);
    assert.equal(lifecycleLineFor("This coin is retired.", "decided"), "This coin is retired.");
    for (const s of [DECIDED_LINE, VOIDED_LINE]) clean(s);
  });
  test("the embed of a decided coin says its result is in, with no time and no 'overdue'", () => {
    const n = nextLine({ nextSettlementAt: null, nextSettlementNote: "result decided" }, NOW);
    assert.equal(n.before, NO_NEXT_LINES["result decided"]);
    assert.doesNotMatch(n.before, /overdue/);
    assert.match(read("src/lib/burnticker/badge.ts"), /const nextOf = \(s: TokenStatusJson\): string \| null => \(settledOnce\(s\) \? null :/);
    for (const s of Object.values(NO_NEXT_LINES)) clean(s);
  });
  test("a curve with nothing raised has not traded yet", () => {
    const p = progressOf({ state: "on-curve", detail: "" } as never, { raisedSol: 0, raiseSol: 85 });
    assert.equal(p.steps[1].state, "current");
    assert.equal(p.now, "Next: trading on the curve");
  });
});

describe("HB-26: the receipts-check API serves labelled devnet examples with no repository paths", () => {
  test("example flag and note; rules keyed by ticker; no docs/ or config/ path in any field the server adds", () => {
    const pub = publicSampleReceipts(sampleReceipts());
    assert.equal(pub.example, true);
    assert.equal(pub.note, DEVNET_EXAMPLE_NOTE);
    assert.ok(pub.receipts.length > 0);
    // the rules texts are served byte for byte (the verifier hashes them), so the check is on everything the server adds around them
    const text = JSON.stringify({ ...pub, rules: Object.keys(pub.rules) });
    assert.doesNotMatch(text, /docs\/|config\//);
    for (const r of pub.receipts) assert.equal(typeof pub.rules[r.rulesPath], "string", r.rulesPath);
    clean(DEVNET_EXAMPLE_NOTE);
  });
});

describe("HB-24: alert noise from a rollout", () => {
  test("the deploy defers starting new timers until after the release link switch, then installs again from the link", () => {
    // the host deploy script is private to the monorepo (not in the public tree): checked only where it exists
    if (fs.existsSync("scripts/ops/deploy-burnticker-host.sh")) {
      const d = read("scripts/ops/deploy-burnticker-host.sh");
      const first = d.indexOf("install-burnticker-units.sh --defer-timers"), swap = d.indexOf("sh $SWAP_REMOTE"), second = d.indexOf("install-burnticker-units.sh >/dev/null", swap);
      assert.ok(first > 0 && swap > first && second > swap, "defer, swap, then start");
    }
    assert.match(read("scripts/ops/install-burnticker-units.sh"), /elif \[ "\$DEFER_TIMERS" = 1 \]; then act systemctl --user enable "\$t"/);
  });
  test("the schema alert says it is expected while a deploy switches back", () => {
    assert.match(REGISTRY_NEWER_EXPECTED, /expected while a deploy is switching back/);
    assert.ok(read("src/lib/burnticker/push.ts").includes(REGISTRY_NEWER_EXPECTED));
    clean(REGISTRY_NEWER_EXPECTED);
  });
});

describe("HB-27: the incident log and the changelog record today", () => {
  test("a 2026-10-19 incident entry in plain words; the changelog says what publish 92 changed", () => {
    const log = read("docs/burnticker/incidents/LOG.md");
    const entry = log.slice(log.indexOf("## 2026-10-19"));
    assert.match(entry, /11:47 and 12:19 Denver/);
    assert.match(entry, /13:41 to 14:02 Denver/);
    assert.doesNotMatch(entry, /Shane|Cassidy/i);
    clean(entry.replace(/\[\.\.\/INCIDENTS\.md\]\(\.\.\/INCIDENTS\.md\)/, "the incident policy"));
    const ch = read("docs/burnticker/CHANGELOG.md");
    // the hand-written entry alone: the machine entries that follow name build paths ("target") the lint refuses
    const pub = ch.slice(ch.indexOf("## 2026-10-19 — what publish 92 changed")).split("\n## ")[0];
    assert.ok(pub.length > 100);
    clean(pub);
  });
});

// PROD-05 (external audit 2026-10-19T2119Z, terminal-warning.test.mjs ported): a voided pair is not "nothing burns". The keeper voids a
// pending pair and ends both coins in winddown, so the warning tells the end-of-rule burn apart from the game result, dated by the void.
describe("PROD-05: a voided pair's warning tells the winddown from the game result, dated by the void", () => {
  const VBASE = { status: "live", ticker: "AUDITA", name: "Audit A", rules: { oneShot: true }, next: { result: "void" }, selectorKey: "catalogue:espn.game:nfl-123-SEA-win", oracle: "catalogue", profile: { sideName: "Seahawks", badge: "ONE-SHOT · Oct 15, 2026" }, market: { phase: "curve" }, pair: { counterpart: { name: "Broncos", ticker: "AUDITB", sideName: "Broncos" }, clause: { state: "voided", voidBy: "2026-10-17" } }, lifecycle: { ended: { mode: "winddown" } } } as unknown as DecidedWarningInput;
  const voided = { status: "voided", units: 1, settledAt: "2026-10-17", pairRole: "lost" as const, kind: "binary", result: "loss" };
  const wdRow = { status: "confirmed", units: 1, settledAt: "2026-10-18", kind: "winddown", burned: "100" };
  const WINDING = "The pair was voided. No burn happens for the game result. Its burn pool now winds down on this coin.";
  for (const ends of [[], [wdRow]]) test(`the auditor's fixture: voided pair with ${ends.length} confirmed end receipts explains the winddown`, () => {
    const line = decidedSwapWarning(VBASE, [voided, ...ends])!;
    assert.match(line, /wind|pool.*down/i);
    assert.doesNotMatch(line, /Nothing burns on it\./);
    assert.equal(line, WINDING, "no date: the clause records no void time, and the game's day is never the void's");
    clean(line);
  });
  test("the auditor's control: a pending event has no decided warning", () => assert.equal(decidedSwapWarning({ ...VBASE, next: { result: "pending" } } as DecidedWarningInput, []), null));
  test("dated by the clause's own void time when recorded, never by the badge's game day", () => {
    const line = decidedSwapWarning({ ...VBASE, pair: { ...VBASE.pair!, clause: { state: "voided", voidBy: "2026-11-14", decidedAt: "2026-11-15T00:05:00.000Z" } } } as DecidedWarningInput, [voided])!;
    assert.equal(line, "The pair was voided on 15 November 2026. No burn happens for the game result. Its burn pool now winds down on this coin.");
    assert.doesNotMatch(line, /15 October/);
  });
  test("before, during and after the winddown; waiting and live pairs keep their own lines", () => {
    const before = decidedSwapWarning({ ...VBASE, lifecycle: { ended: null } } as DecidedWarningInput, [voided])!;
    assert.equal(before, "The pair was voided. No burn happens for the game result. Its burn pool winds down on this coin once the rule ends.");
    assert.equal(decidedSwapWarning({ ...VBASE, lifecycle: null } as DecidedWarningInput, [voided, wdRow]), WINDING, "an end receipt alone shows the winddown");
    const after = decidedSwapWarning({ ...VBASE, lifecycle: { ended: { mode: "winddown" }, windDown: { days: 28, done: 28 } } } as DecidedWarningInput, [voided, wdRow])!;
    assert.equal(after, "The pair was voided. No burn happens for the game result. Its burn pool has wound down on this coin.");
    for (const l of [before, after]) { assert.doesNotMatch(l, /Nothing burns/); clean(l); }
    // a waiting or live pair that is decided, not voided, is unchanged (HS-1 / B-7)
    assert.match(decidedSwapWarning(SEA(), [lost])!, /^\$SEAWIN lost\./);
    assert.match(decidedSwapWarning(SEA({ pair: { ...PAIR, clause: { state: "live", voidBy: "2026-11-14" } } as never }), [lost])!, /^\$SEAWIN lost\./);
  });
  test("a single voided market: nothing burns only while nothing does; its void receipt dates it", () => {
    const single = { ...VBASE, selectorKey: "polymarket:0xabc", oracle: "polymarket", pair: null, lifecycle: { ended: null } } as unknown as DecidedWarningInput;
    const v = { status: "void", units: 0, settledAt: "2026-10-20T01:00:00Z", kind: "binary" };
    assert.equal(decidedSwapWarning(single, [v]), "This coin's one result was voided on 20 October 2026. No further result is read for it. No burn happens for the result. Its burn pool winds down on this coin once the rule ends.");
    assert.equal(decidedSwapWarning({ ...single, lifecycle: { ended: { mode: "winddown" } } } as DecidedWarningInput, [v, wdRow]), "This coin's one result was voided on 20 October 2026. No burn happens for the result. Its burn pool now winds down on this coin.");
  });
  test("the card sentence of a voided coin whose rule ended says its pool burns down", () => {
    const f = coinStatusFactsOf({ status: "live", ticker: "AUDITA", name: "Audit A", rules: { oneShot: true }, profile: { badge: "ONE-SHOT" } }, [voided, wdRow]);
    assert.equal(f.ended, "winddown");
    assert.doesNotMatch(coinStatusSentence(f), /Nothing burns/);
  });
});
