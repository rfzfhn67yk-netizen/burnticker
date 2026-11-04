// HOURLY AUDIT 2026-10-19 21:10 DENVER, RUN 9 (docs/burnticker/audits/continuous/2026-10-19-2110-Denver.md; bugs.md HB-111 to HB-116
// except HB-114, the widenings of HB-104, HB-107a, HB-41 and HB-42; suggestions HS-46 to HS-50). One pure test or source check per fix,
// plus the copy lint on every new public sentence.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import {
  BARE_COIN_ACTION, NO_MATCH_LEAD, NO_MATCH_SEPARATOR, OPEN_NOW_CATEGORIES, PERPETUAL_UPFRONT_LINE, PROFILE_NO_DESCRIPTION, asLinkedPairSide, bareCoinLine, bareTickerOf,
  coinvsEndsLine, endChoiceChangedLine, endSentences, openNowCards, openNowEndsLine, openNowGroupWords, pairUpfrontLines, profileDescriptionParts, pythCoinOf,
  sentenceWithoutEnd, upfrontLines,
} from "@/lib/burnticker/guidedLaunch";
import { COINVS_EDGE_IDS, coinvsEdgeNotes, edgeCase } from "@/lib/burnticker/ruleEdgeCases";
import { describeRule, feedResultSentence, triggerOnce, windowKindOf } from "@/lib/burnticker/describe";
import { feedById, feedCrossReadName } from "@/lib/burnticker/catalogue";
import { sourceText } from "@/lib/burnticker/launchPreflight";
import { gameStatusWords } from "@/lib/burnticker/gameStatus";
import { gameLine } from "@/lib/burnticker/oneShotEligibility";
import { buildMarketJson, NO_POOL_NOT_LAUNCHED, NO_POOL_YET } from "@/lib/burnticker/market";
import { receiptVerdictFinal, withVerdict } from "@/lib/burnticker/trustpack/api";
import { checkStatus } from "@/lib/burnticker/verificationStatus";
import { categoryList, feedCard, noMatchCategories, sampleReadingLabel, storedReadingLabel, withStoredReadings, type CategoryDef, type FeedCardInput } from "@/lib/burnticker/browse";
import { coinvsNoHistoryLine, reviewProjection } from "@/lib/burnticker/projection";
import { tileRule } from "@/lib/burnticker/derby/tile";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { generatedNames, NONE_EDITED } from "@/lib/burnticker/coinPicker";
import { RAISE_PRESETS_SOL } from "@/lib/burnticker/launchPresets";
import type { BurnRule } from "@/lib/burnticker/rules";
import { BONK, WIF } from "./burntickerDerbyHelpers.ts";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };
const plain = (s: string) => { clean(s); assert.doesNotMatch(s, /\bwill\b|\bbuy\b|\bprice\b|coming soon|\bpayouts?\b|\btarget\b|\bguarantee|→|\b20\d\d-\d\d-\d\d\b|\w\/\w+\//i, s); };
const read = (p: string) => fs.readFileSync(p, "utf8");
const page = read("src/app/burnticker/launch/page.tsx");
const tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx");
const card = read("src/app/burnticker/launch/ReviewCard.tsx");
const NOW = Date.UTC(2026, 9, 19, 18);
const env = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" };
const debtRule = { schema: "burnticker.rules/v1", oracle: "catalogue", series: "treasury.debt", market: null, filter: {}, kind: "scalar", scalar: { unit: 1_000_000_000, perUnit: { fractionOfPool: 0.02 }, baseline: "previousSettlement", direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } as unknown as BurnRule;
const pairOf = (flip: boolean) => {
  const names = generatedNames(WIF, BONK, { a: "", b: "", ta: "", tb: "" }, NONE_EDITED);
  const t = tileRule({ a: WIF, b: BONK, window: "daily", seasonDays: 14, flip, fraction: flip ? 1 : 0.02, now: NOW }, "09567dbee8" + "0".repeat(54), { a: names.ta, b: names.tb });
  return { names, t, rule: t.rule! };
};

describe("HB-111 and HS-46: the Event outcome Open-now cards", () => {
  test("each card says when its market closes, in the visitor's zone, or says nothing", () => {
    assert.equal(openNowEndsLine("2026-12-05T17:00:00Z", { now: NOW, timeZone: "America/Denver" }), "ends Dec 5");
    assert.equal(openNowEndsLine("2028-11-07T12:00:00Z", { now: NOW, timeZone: "America/Denver" }), "ends Nov 7, 2028");
    assert.equal(openNowEndsLine(null), null);
    assert.equal(openNowEndsLine("not a date"), null);
    plain(openNowEndsLine("2026-12-05T17:00:00Z", { now: NOW, timeZone: "UTC" })!);
  });
  test("sports and elections first, culture only fills, never a market with no close date, one card per event group", () => {
    const c = (title: string, at: string | null = "2026-12-05T17:00:00Z") => ({ id: title, venue: "polymarket", title, refused: [] as string[], launchable: { ok: true }, next: at ? { label: "ends", at } : null });
    const sports = [c("F1 Drivers' Champion"), c("Pro Football: 2027 Champion")];
    const politics = [c("Democratic Presidential Nominee 2028"), c("Presidential Election Winner 2028"), c("Colorado Senate Race 2026")];
    const culture = [c("Will Jesus Christ return before 2027?"), c("Will the US confirm that aliens exist by…?", null), c("Oscars Best Picture 2027")];
    const picked = openNowCards([sports, politics, culture]).map((x) => x.title);
    assert.deepEqual(picked, ["F1 Drivers' Champion", "Democratic Presidential Nominee 2028", "Pro Football: 2027 Champion", "Colorado Senate Race 2026", "Will Jesus Christ return before 2027?", "Oscars Best Picture 2027"]);
    assert.ok(!picked.includes("Presidential Election Winner 2028"), "one card per event group");
    assert.ok(!picked.some((t) => /aliens/.test(t)), "no market without a close date");
    assert.deepEqual([...OPEN_NOW_CATEGORIES], ["sports", "politics", "culture"]);
    assert.ok(openNowGroupWords("Presidential Election Winner 2028").includes("presidential"));
    assert.ok(!openNowGroupWords("Pro Football: 2027 Champion").includes("champion"));
  });
  test("the page prints the date and names each button; only the Event outcome search fetches the cards", () => {
    assert.match(page, /aria-label=\{c\.title\} data-open-now-card onClick=\{\(\) => setQ2\(c\.title\)\}/);
    assert.match(page, /\{openNowEndsLine\(c\.next\?\.at\) && <span className="block text-xs text-neutral-500" data-open-now-ends>\{openNowEndsLine\(c\.next\?\.at\)\}<\/span>\}/);
    assert.doesNotMatch(page, /\{c\.next\?\.label && <span className="block text-xs text-neutral-500">\{c\.next\.label\}<\/span>\}/);
    assert.match(page, /\|\| \(guide\.follow && guide\.follow !== "market"\)\) return;/);
  });
});

describe("HB-112: the coin comparison review, one end statement per mode", () => {
  test("the What to know end line is the review's own When it ends sentence, never the generic rival line", () => {
    for (const flip of [false, true]) {
      const { rule } = pairOf(flip);
      const ends = coinvsEndsLine(rule)!;
      const lines = pairUpfrontLines("linked", RAISE_PRESETS_SOL, null, ends);
      assert.ok(lines.includes(ends), ends);
      assert.ok(!lines.some((x) => /goes to the rival coin's burn\.$/.test(x)));
      assert.equal(pairUpfrontLines("pair-curve", RAISE_PRESETS_SOL, "x", ends)[3], ends);
    }
    assert.match(tile, /upfront=\{pairUpfrontLines\(reviewVenue, RAISE_PRESETS_SOL, shown\.review\?\.prerequisiteLine \?\? null, ends\)\}/);
    assert.match(page, /endLine: pairOn \? endFact\.replace\(\/\\n\/g, " "\) : null/);
  });
  test("the flippening's missing-last-day case shows on the flippening only", () => {
    const flip = edgeCase(70)!;
    assert.ok(coinvsEdgeNotes("flip").includes(flip));
    assert.ok(!coinvsEdgeNotes("race").includes(flip));
    assert.ok(!coinvsEdgeNotes("single").includes(flip));
    assert.ok(!(COINVS_EDGE_IDS.race as readonly number[]).includes(70));
    assert.match(tile, /edgeNotes=\{coinvsEdgeNotes\(\(model\.rule\.derby as \{ flip\?: boolean \} \| undefined\)\?\.flip \? "flip" : "race"\)\}/);
  });
  test("the At the end block is on the burn step in both modes, and the sentence above leaves that end out", () => {
    const { rule, t } = pairOf(false);
    const end = endSentences(asLinkedPairSide(rule)).sentences;
    assert.ok(t.sentence!.includes(end.join(" ")), "the race's sentence carries its end");
    const shown = sentenceWithoutEnd(t.sentence!, end);
    assert.ok(!shown.includes(end.join(" ")) && shown.length > 20);
    assert.equal(sentenceWithoutEnd("A sentence.", ["Not in it."]), "A sentence.");
    assert.match(tile, /\{end && <div className="space-y-0\.5 text-xs text-neutral-300" data-end-sentences>/);
    assert.doesNotMatch(tile, /endSaid/);
  });
});

describe("HB-113: a published-data coin's pinned description", () => {
  test("no second-publisher claim without a cross-read; the cross-read that runs is named", () => {
    assert.equal(feedResultSentence({ sourceName: "U.S. Treasury, Fiscal Data", crossRead: null }), "The result comes from U.S. Treasury, Fiscal Data.");
    assert.equal(feedResultSentence({ sourceName: "A", crossRead: "the B office" }), "The result comes from A, cross-checked against the B office.");
    const d = describeRule(debtRule, { ticker: "DEBTUP", feed: { title: "U.S. national debt (Debt to the Penny)", sourceName: "U.S. Treasury, Fiscal Data", unitLabel: "$1B added", crossRead: null } });
    assert.doesNotMatch(d.paragraph, /second publisher|cross-checked/);
    assert.match(d.paragraph, /The result comes from U\.S\. Treasury, Fiscal Data\./);
    // the server names the source the keeper really checks against (corroborate.ts), or nothing
    const cross = feedCrossReadName(feedById("treasury.debt")!);
    assert.equal(sourceText(debtRule, NOW)?.feed?.crossRead ?? null, cross);
    const pinned = describeRule(debtRule, { ticker: "DEBTUP", feed: sourceText(debtRule, NOW)!.feed! }).paragraph;
    assert.doesNotMatch(pinned, /a second publisher/);
    if (cross) { assert.match(cross, /FRED/); assert.match(pinned, /cross-checked against the Federal Reserve Bank of St\. Louis \(FRED\), at each quarter end\./); }
    clean(pinned);
  });
  test("the trigger clause is said once", () => {
    const d = describeRule(debtRule, { ticker: "DEBTUP", feed: { title: "U.S. national debt (Debt to the Penny)", sourceName: "U.S. Treasury, Fiscal Data", unitLabel: "$1B added", crossRead: null } });
    const clause = d.oneLiner.replace(/^burns for /, "");
    assert.equal(d.paragraph.split(clause).length - 1, 1, d.paragraph);
    assert.match(d.paragraph, /\. Each time, the burn pool spends 2% buying \$DEBTUP on Raydium and burns it/);
    assert.ok(d.ruleBlock.startsWith(`For ${clause}, `), "the rule block itself is unchanged");
    assert.equal(triggerOnce("burns for each X", "For each X, the pool spends."), "Each time, the pool spends.");
    assert.equal(triggerOnce("burns every day it rains", "For every rainy day, the pool spends."), "For every rainy day, the pool spends.");
    clean(d.paragraph);
  });
});

describe("HB-115: a game's status in words, one map", () => {
  test("feed codes become words; words already written stay; an unknown code is never shown", () => {
    assert.equal(gameStatusWords("NS"), "Scheduled");
    assert.equal(gameStatusWords("FT"), "Final");
    assert.equal(gameStatusWords("PST"), "Postponed");
    assert.equal(gameStatusWords("HT"), "Halftime");
    assert.equal(gameStatusWords("Q3"), "In progress");
    assert.equal(gameStatusWords("IN7"), "In progress");
    assert.equal(gameStatusWords("Scheduled"), "Scheduled");
    assert.equal(gameStatusWords("Final/OT"), "Final/OT");
    assert.equal(gameStatusWords("ZZ"), null);
    assert.equal(gameStatusWords(""), null);
    assert.match(gameLine({ eventId: "1", name: "Broncos at Cardinals", startsAt: "2026-10-25T20:05:00Z", completed: false, detail: "NS", state: "post" }), /Status: Scheduled\./);
    assert.match(gameLine({ eventId: "1", name: "Broncos at Cardinals", startsAt: "2026-10-25T20:05:00Z", completed: false, detail: "PST", state: "post" }), /Status: Postponed\./);
    assert.match(read("src/lib/burnticker/search.ts"), /subtitle: gameStatusWords\(g\.detail\) \?\? "Scheduled"/);
  });
});

describe("HB-116: the token JSON's pool note and the receipt check's verdict", () => {
  test("a coin with no pool says so, never 'could not read that pool'", () => {
    const m = (status: string, graduatedPool: string | null, error: string | null = null) => buildMarketJson({ cluster: "devnet", mint: "M", status, poolId: null, graduatedPool, read: null, cpmm: error ? { market: null, error } : null });
    assert.equal(m("live", null).poolNote, NO_POOL_YET);
    assert.equal(m("draft", null).poolNote, NO_POOL_NOT_LAUNCHED);
    assert.doesNotMatch(m("live", null).poolNote ?? "", /could not/);
    assert.match(m("live", "Pool1", "rpc timeout").poolNote ?? "", /could not read that pool/);
    plain(NO_POOL_YET); plain(NO_POOL_NOT_LAUNCHED);
  });
  test("a check with its source unread answers 'partly verified' and names it; a budget refusal is asked again", () => {
    const ok = (id: string) => ({ id, label: id, ok: true, detail: "ok" });
    const src = { id: "source", label: "Source", ok: null, detail: "Treasury Fiscal Data: the request rate budget is full" };
    const body = withVerdict({ verified: true, checks: [ok("tx"), ok("program"), ok("memo"), ok("reading"), ok("units"), src] });
    assert.equal(body.verified, true, "verified keeps its meaning: the on-chain core passed");
    assert.equal(body.verdict, "partly verified");
    assert.deepEqual(body.notChecked.map((x) => x.id), ["source"]);
    plain(body.verdictLine);
    assert.equal(withVerdict({ verified: true, checks: [ok("tx"), ok("program"), ok("memo"), ok("reading"), ok("units")] }).verdict, "verified");
    assert.equal(receiptVerdictFinal({ checks: [src] }), false);
    assert.equal(checkStatus(src), "unavailable");
    const api = read("src/lib/burnticker/trustpack/api.ts");
    assert.match(api, /return ok\(\{ \.\.\.withVerdict\(hit\.body\), checkedAt: hit\.at, served: "kept verdict" \}\);/);
    assert.match(api, /return ok\(\{ \.\.\.withVerdict\(body\), checkedAt: new Date\(now\(\)\)\.toISOString\(\), served: "checked now" \}\);/);
  });
});

describe("HB-104 widened: both coins of a coin comparison get their own description, and the page shows them", () => {
  test("the server review pins a paragraph for side B from its own rule and ticker", () => {
    const { rule, names } = pairOf(false);
    const v = buildLaunchReview({ rule, ticker: names.ta, name: names.a, pair: { ticker: names.tb, name: names.b } }, { env, now: NOW });
    assert.ok("review" in v, JSON.stringify(v));
    const [a, b] = v.review.coins;
    assert.ok(a.description && b.description, "both sides have a paragraph");
    assert.notEqual(a.description, b.description);
    assert.match(b.description!, new RegExp(`\\$${names.tb}\\b`));
    assert.ok(b.descriptionRoom >= 0);
  });
  test("the Description row says the pinned paragraph, then the creator's text", () => {
    assert.deepEqual(profileDescriptionParts({ description: "", generated: "Generated." }), { generated: "Generated.", own: null, none: null });
    assert.deepEqual(profileDescriptionParts({ description: " Mine. ", generated: "Generated." }), { generated: "Generated.", own: "Mine.", none: null });
    assert.equal(profileDescriptionParts({ description: "", generated: null }).none, PROFILE_NO_DESCRIPTION);
    assert.match(card, /const d = profileDescriptionParts\(c\); return row\("Description", d\.none \?\?/);
    assert.match(tile, /note: null, generated: reviewCurrent \? shown\.review\?\.coins\?\.\[1\]\?\.description \?\? null : null \}/);
    assert.match(page, /note: null, generated: reviewCurrent \? genB : null \}/);
    assert.match(page, /const genB = reviewMeetings\?\.descriptionB \?\? reviewSettled\?\.descriptionB \?\? rv\?\.coins\?\.\[1\]\?\.description \?\? null;/);
  });
});

describe("HB-107a widened: a rule with no end says so in What to know", () => {
  test("published data and the record close", () => {
    assert.equal(windowKindOf(debtRule), "perpetual");
    assert.equal(upfrontLines(RAISE_PRESETS_SOL, { team: false, end: { kind: "deficit" }, pair: false, perpetual: true })[3], PERPETUAL_UPFRONT_LINE);
    assert.match(page, /perpetual: !pairOn && windowKindOf\(rule\) === "perpetual"/);
    assert.match(tile, /upfront=\{upfrontLines\(RAISE_PRESETS_SOL, \{ team: false, end: null, pair: false, perpetual: windowKindOf\(rule\) === "perpetual" \}\)\}/);
  });
});

describe("HB-41: the Browse sample is the keeper's newest stored reading when there is one", () => {
  const f: FeedCardInput = { id: "treasury.debt", tier: 4, tierLabel: "t", title: "U.S. national debt", sourceName: "U.S. Treasury, Fiscal Data", sourceUrl: "https://x", cadence: "business days", unit: { label: "$1B added" }, launchable: { ok: true, why: null }, flags: [], lastReading: { id: "2026-10-08", value: "40310000000000" }, fixtureFetchedAt: "2026-10-10T12:00:00Z", valueLabel: "USD" };
  test("a newer stored reading replaces the saved sample and is labelled as the latest reading", () => {
    const [x] = withStoredReadings([f], (k) => (k === "catalogue:treasury.debt" ? { id: "2026-10-16", value: "40388000000000", at: "2026-10-16", fetchedAt: Date.parse("2026-10-17T20:00:00Z") } : null));
    assert.equal(x.sampleFrom, "stored");
    assert.equal(feedCard(x).next?.label, storedReadingLabel({ id: "2026-10-16", value: "40388000000000" }, "2026-10-17T20:00:00.000Z", "USD"));
    assert.match(feedCard(x).next!.label, /^Latest reading 2026-10-16: \$40\.39T, read 2026-10-17$/);
  });
  test("an older stored reading, none, or a read that throws keeps the sample, labelled as the catalogue's", () => {
    for (const last of [() => ({ id: "2026-10-01", value: "1", at: "2026-10-01", fetchedAt: Date.parse("2026-10-02T00:00:00Z") }), () => null, () => { throw new Error("db"); }]) {
      const [x] = withStoredReadings([f], last as never);
      assert.equal(feedCard(x).next?.label, sampleReadingLabel(f.lastReading!, f.fixtureFetchedAt, "USD"));
    }
    assert.match(read("src/lib/burnticker/api/handlers.ts"), /const feeds = withStoredReadings\(\(catalogueSources\(now\)\.sources/);
  });
});

describe("HB-42 and HS-47: the no-match hint and a bare ticker", () => {
  test("the hint lists the Published data tabs only, separated", () => {
    const cats = [
      { id: "economics", label: "Economics", blurb: "", feeds: ["treasury.debt"], polymarket: [], kalshi: [] },
      { id: "financials", label: "Financial markets", blurb: "", feeds: ["pyth.equity"], polymarket: [], kalshi: [] },
      { id: "politics", label: "Elections & Politics", blurb: "", feeds: ["fedreg.eo"], polymarket: [], kalshi: [], guided: "elections" },
      { id: "sports", label: "Sports", blurb: "", feeds: ["thesportsdb.v2"], polymarket: [], kalshi: [] },
    ] as unknown as CategoryDef[];
    const feeds = [{ id: "treasury.debt" }, { id: "fedreg.eo" }, { id: "thesportsdb.v2" }] as unknown as FeedCardInput[];
    const venues = { kalshi: false, polymarket: true, feeds: true };
    const hint = noMatchCategories(cats, feeds, venues).map((c) => c.id);
    assert.deepEqual(hint, ["economics"]);
    assert.deepEqual(hint, categoryList(cats, feeds, venues, { feedsOnly: true }).map((c) => c.id), "the hint is the tabs' own list");
    assert.equal(NO_MATCH_SEPARATOR, " · ");
    plain(NO_MATCH_LEAD);
    assert.match(page, /\{i > 0 && <span aria-hidden="true">\{NO_MATCH_SEPARATOR\}<\/span>\}/);
  });
  test("a Pyth coin typed alone gets one card that opens Coin comparison with it", () => {
    assert.equal(bareTickerOf("WIF"), "WIF");
    assert.equal(bareTickerOf(" $bonk "), "BONK");
    assert.equal(bareTickerOf("denver broncos"), null);
    assert.equal(bareTickerOf("9"), null);
    const hits = [{ symbol: "WIF", source: "pyth", feed: "4ca4" }, { symbol: "WIFE", source: "jupiter", feed: null }];
    assert.equal(pythCoinOf(hits, "wif"), "WIF");
    assert.equal(pythCoinOf(hits, "WIFE"), null, "a coin with no Pyth feed is not offered here");
    assert.equal(bareCoinLine("WIF"), "WIF is a coin. Compare it with another coin, read once a day from Pyth.");
    plain(bareCoinLine("WIF")); plain(BARE_COIN_ACTION);
    assert.match(page, /setGuide\(\{ follow: "coins", phase: "which", pairKind: null \}\); setEntry\(\{ template: null, a: bareCoin\.symbol, b: "" \}\);/);
    assert.match(page, /getJson<\{ hits\?: \{ symbol: string; source: string; feed: string \| null \}\[\] \}>\(`\$\{V1\}\/derby\/search\?q=\$\{encodeURIComponent\(sym\)\}`\)/);
  });
});

describe("HS-48: the coin comparison back-test says why there is none", () => {
  test("only when Burnticker has no stored daily reading of a coin", () => {
    const { rule } = pairOf(false);
    const none = reviewProjection(rule, NOW, undefined, { derbyHistory: () => false });
    assert.equal(none.reason, "Burnticker keeps no daily history of WIF and BONK yet, so there is no back-test for this pair. The first reading is at the first 00:00 UTC after launch.");
    assert.equal(reviewProjection(rule, NOW, undefined, { derbyHistory: (feed) => feed === WIF.pyth }).reason, coinvsNoHistoryLine(["BONK"]));
    assert.notEqual(reviewProjection(rule, NOW, undefined, { derbyHistory: () => true }).reason, none.reason);
    assert.notEqual(reviewProjection(rule, NOW).reason, none.reason, "unknown history says nothing either way");
    plain(none.reason!);
    assert.match(read("src/app/api/burnticker/v1/launch/review/route.ts"), /derbyHistory = \(feed\) => ds\.hasPoints\(feed\);/);
  });
});

describe("HS-49: the end choice on the Name step and the review", () => {
  test("a non-default end is named on the review with an Edit link", () => {
    assert.equal(endChoiceChangedLine({ kind: "deficit" }), null);
    assert.equal(endChoiceChangedLine({ kind: "burn-sol" }), "You chose the incinerator instead of $DEFICIT's burn.");
    assert.equal(endChoiceChangedLine({ kind: "coin", mint: "M", ticker: "BONKWINS" }), "You chose $BONKWINS's burn instead of $DEFICIT's burn.");
    plain(endChoiceChangedLine({ kind: "burn-sol" })!);
    assert.match(page, /const endChanged = pairOn \? null : endChoiceChangedLine\(endA\);/);
  });
  test("When it ends sits above the collapsed optional group", () => {
    const at = card.indexOf("data-name-end-choice"), more = card.indexOf("data-profile-more");
    assert.ok(at > 0 && more > 0 && at < more);
  });
});

describe("HS-50: the home tab strip under 480 px", () => {
  test("the Coins tabs wrap to a second row", () => {
    assert.match(read("src/app/burnticker/CoinsIndex.tsx"), /className=\{`bt-tabs bt-tabs-wrap \$\{tabsHint\.className\}`\}/);
    assert.match(read("config/public-repo/overlay/src/app/globals.css"), /@media \(max-width: 479px\) \{ \.bt-tabs\.bt-tabs-wrap \{ flex-wrap: wrap; overflow-x: visible;/);
  });
});

describe("HB-113: the named cross-read reads as plain English", () => {
  test("an institution takes 'the', a site does not, a single official source names none", () => {
    assert.equal(feedCrossReadName(feedById("treasury.debt")!), "the Federal Reserve Bank of St. Louis (FRED), at each quarter end");
    const fred = feedById("fred.UNRATE");
    if (fred) assert.equal(feedCrossReadName(fred), "the U.S. Bureau of Labor Statistics");
    const btc = feedById("bitcoin.blockHeight");
    if (btc) assert.doesNotMatch(feedCrossReadName(btc) ?? "", /^the /);
    for (const id of ["usgs.quakes", "nhc.storms"]) { const f = feedById(id); if (f) assert.equal(feedCrossReadName(f), null, `${id}: a single official source names no cross-read`); }
  });
});
