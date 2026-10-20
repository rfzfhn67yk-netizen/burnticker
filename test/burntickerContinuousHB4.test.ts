// CONTINUOUS AUDIT 2026-10-19, RUN 4 (docs/burnticker/audits/continuous/bugs.md HB-36 to HB-43, HB-46, HB-47, HB-50, the HB-13/15/21/23/25
// leftovers, HB-53 and B-12 from the sixth pass, suggestions HS-11 to HS-15). One pure test or source check per fix, plus the copy lint on
// every new public sentence. Monorepo-private files are read only where they exist.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import type { BurnRule } from "@/lib/burnticker/rules";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { teamSeries } from "@/lib/burnticker/sources/espn";
import {
  BACKTEST_WAITING_LINE, INCINERATOR_PICKED_REASON, PASTED_LINK_REFUSAL, backtestSourceOf, beforeGraduationLine, byeLine, endSentences, everySentenceFor, EVERY_SENTENCES,
  followForPick, marketClosesLine, namesChangeOf, namesRemadeLine, nextGameWords, oneMarketDate, pastedLink, patternFollowFor, patternOptions, relatedCardLine,
  upfrontEndLine, upfrontLines, VISITOR_TIME_LINE, withEndChoice, MARKET_NO_LABEL,
} from "@/lib/burnticker/guidedLaunch";
import { drainWarning, MIN_PROJECTION_DAYS, type Projection } from "@/lib/burnticker/projection";
import { changeRuleEdgeIds } from "@/lib/burnticker/changeRule";
import { edgeCaseFor, edgeCase } from "@/lib/burnticker/ruleEdgeCases";
import { simulateResults, SIM_NO_READING_LABEL, SIM_NO_READING_LINE, simOneShotVoidLine } from "@/lib/burnticker/simulator";
import { losingPairLine, voidedLine, windDownOver, receiptGameDay, espnLinkOnDay, type DecidedWarningInput } from "@/lib/burnticker/decidedWarning";
import { coinStatusFactsOf, coinStatusSentence, DECIDED_TAILS } from "@/lib/burnticker/coinStatus";
import { feeSplitSentence, TIER_UNREAD_LINE } from "@/lib/burnticker/fees";
import { feeFlowLine } from "@/lib/burnticker/tokenPage";
import { earlierCoinsLineFor, EARLIER_COINS_LINE } from "@/lib/burnticker/feeShareLine";
import { categoryCards, categoryList, OTHER_FAMILY_CATEGORIES, publishedDataCategories, sampleReadingLabel, unitExample, type CategoryDef, type FeedCardInput } from "@/lib/burnticker/browse";
import { paramExampleNote } from "@/lib/burnticker/paramNames";
import { eventIdentity, titleEntity } from "@/lib/burnticker/eventIdentity";
import { outcomeTicker } from "@/lib/burnticker/polySearch";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import { dedupeArticle, lastBurnLine, lostDayOf } from "@/lib/burnticker/badge";
import { pairMatchupWords, pairSeed } from "@/lib/burnticker/pairPageMeta";
import { backtest } from "@/lib/burnticker/oracle/backtest";
import { withoutRepoPaths, markdownLinkParts, sentenceWithoutRepoPaths } from "@/lib/burnticker/publicPaths";
import { publicExpenses, NOT_RECORDED_NOTE, type Expenses } from "@/lib/burnticker/trustpack/ledger";
import { capSentence } from "@/lib/burnticker/capInForce";
import { LaunchProofRejected, PROOF_REJECTED_SENTENCE, requireLaunchProof, walletPromptCount } from "@/lib/burnticker/walletProof";
import { signsLine } from "@/lib/burnticker/mintAddressCopy";
import { NONE_LISTED_LINE } from "@/lib/burnticker/seasonOver";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };
const read = (p: string) => fs.readFileSync(p, "utf8");
const page = read("src/app/burnticker/launch/page.tsx");

const scalar = (series: string, baseline: "previousSettlement" | number = "previousSettlement", share = 0.02): BurnRule => ({
  schema: "burnticker.rules/v1", oracle: "catalogue", series, market: null, filter: {}, kind: "scalar", binary: null,
  scalar: { unit: 1, perUnit: { fractionOfPool: share }, baseline, direction: "abs", carry: "none" }, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, pair: null,
  onEnd: { windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true },
} as unknown as BurnRule);
const poly = (windDownDays = 28): BurnRule => ({
  schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: "0x" + "1".repeat(64), filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 1 }, onNo: null },
  scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, pair: null, onEnd: { windDownDays, sweepThresholdLamports: 50_000_000, endSink: true },
} as unknown as BurnRule);
const billsSeason = firstPartyRule(teamSeries("nfl", "BUF", "win", { kind: "season", year: 2026 }), 0.02);

describe("HB-37 (P2): feeds are never offered as markets; the family follows the source; no half-life from a day of readings", () => {
  test("a feed chosen under the markets family lands in published data with the number family's cards", () => {
    assert.equal(followForPick("market", "catalogue"), "number");
    assert.equal(followForPick("market", "polymarket"), "market");
    const feed = scalar("fedreg.finalRules", 0);
    assert.equal(patternFollowFor("market", feed), "number");
    const opts = patternOptions({ follow: patternFollowFor("market", feed), rule: feed }).options;
    assert.ok(!opts.some((o) => o.label === MARKET_NO_LABEL || /resolves YES/.test(o.sentence)), "no market card on a counting rule");
    assert.ok(opts.find((o) => o.id === "every")!.available);
    assert.match(page, /adoptFeedFamily\(c\.pick\.oracle\);/);
    assert.match(page, /patternOptions\(\{ follow: patternFollowFor\(guide\.follow, rule\), rule,/);
  });
  test("a fixture feed with launchable.ok false shows no use-this-source button; the browse marks unsettleable feeds unlaunchable", () => {
    // the card's button branch renders only for launchable.ok; the unavailable line otherwise
    assert.match(page, /: c\.launchable\.ok \? <button data-decision="what" data-use-source/);
    assert.match(page, /data-source-unavailable>/);
    const h = read("src/lib/burnticker/api/handlers.ts");
    assert.match(h, /refusal = catalogueSettleRefusal\(card\.pick\.series\)/);
    assert.match(h, /return refusal \? \{ \.\.\.card, launchable: \{ ok: false, why: refusal\.message \} \} : card;/);
  });
  test("the projection helper returns null under 14 days of readings", () => {
    assert.equal(MIN_PROJECTION_DAYS, 14);
    const rule = scalar("fedreg.finalRules", 0);
    const p = (from: string, to: string): Projection => ({ available: true, weeks: 1, from, to, rows: [{ share: 0.02, triggers: 9, units: 9, spentPct: 16.6 }], lines: [], reason: null, drain: null });
    assert.equal(drainWarning(rule, p("2026-10-09", "2026-10-09")), null);
    assert.equal(drainWarning(rule, p("2026-10-01", "2026-10-10")), null);
    const many = (from: string, to: string): Projection => ({ ...p(from, to), rows: [{ share: 0.02, triggers: 60, units: 120, spentPct: 90 }] });
    assert.equal(drainWarning(rule, many("2026-10-09", "2026-10-09")), null);
    assert.ok(drainWarning(rule, many("2026-09-01", "2026-10-01")));
  });
});

describe("HB-36: edge cases only where they apply", () => {
  test("no missing-reading case on team or event counts; CPI keeps 85, 111 and 87; the one-game sentence only on one-game rules", () => {
    assert.deepEqual(changeRuleEdgeIds(billsSeason as never), []);
    assert.deepEqual(changeRuleEdgeIds(scalar("usgs.quakes:6", 0) as never), []);
    assert.deepEqual(changeRuleEdgeIds(scalar("fred.CPIAUCSL") as never), [85, 111, 87]);
    assert.doesNotMatch(edgeCaseFor(79, { oneGame: false })!, /one-game coin/);
    assert.match(edgeCaseFor(79, { oneGame: false })!, /^A postponed or suspended game counts for neither side/);
    assert.equal(edgeCaseFor(79, { oneGame: true }), edgeCase(79));
    clean(edgeCaseFor(79)!);
  });
});

describe("HB-39: What one result does agrees with the end line per family", () => {
  test("a published number has no tie row and a no-reading row; a one-shot's voided row winds down over windDownDays", () => {
    const cpi = simulateResults(scalar("fred.CPIAUCSL"));
    assert.ok(!cpi.rows.some((r) => r.case === "tie"));
    const v = cpi.rows.find((r) => r.case === "void")!;
    assert.equal(v.label, SIM_NO_READING_LABEL); assert.equal(v.line, SIM_NO_READING_LINE);
    const one = simulateResults(poly(14)).rows.find((r) => r.case === "void")!;
    assert.equal(one.line, simOneShotVoidLine(14));
    assert.match(one.line, /over 14 days\.$/);
    assert.match(simulateResults(poly()).rows.find((r) => r.case === "void")!.line, /over four weeks\.$/);
    for (const s of [SIM_NO_READING_LINE, simOneShotVoidLine(28), simOneShotVoidLine(14)]) clean(s);
  });
});

describe("HB-40: the remade-names note names what changed", () => {
  test("follows, which or burns; shown only when a name or ticker was typed", () => {
    assert.equal(namesChangeOf("team|team|catalogue|espn.team:x|BUF||", "single|team|polymarket|0xabc|BUF||"), "burns");
    assert.equal(namesChangeOf("team|team|catalogue|a|BUF||", "team|team|catalogue|b|KC||"), "which");
    assert.equal(namesChangeOf("team|team|catalogue|a|BUF||", "browse|number|catalogue|treasury.debt|||"), "follows");
    assert.match(namesRemadeLine(1, "burns"), /^You changed how the coin burns, so the suggested name and ticker changed with it\./);
    for (const w of ["follows", "which", "burns"] as const) for (const n of [1, 2] as const) clean(namesRemadeLine(n, w));
    assert.match(page, /if \(editedFor !== null && typed\) setNamesRemade\(namesChangeOf\(editedFor, subjectKey\)\)/);
  });
});

describe("HB-50: the source-review batch", () => {
  test("an incinerator coin's other ends never say 'no end sink today'; a single coin lists no rival row", () => {
    const inc = withEndChoice(poly(), { kind: "burn-sol" });
    const e = endSentences(inc);
    assert.ok(!e.options.some((o) => o.reason === "This kind of coin has no end sink today."));
    assert.ok(e.options.some((o) => o.reason === INCINERATOR_PICKED_REASON));
    assert.ok(!endSentences(poly()).options.some((o) => o.kind === "pair-winner"));
    clean(INCINERATOR_PICKED_REASON);
  });
  test("What to know: no $DEFICIT line when the incinerator is picked; the champion line only on team coins", () => {
    const inc = upfrontEndLine({ team: false, end: { kind: "burn-sol" } });
    assert.doesNotMatch(inc, /\$DEFICIT/); assert.doesNotMatch(inc, /championship/);
    assert.match(upfrontEndLine({ team: true, end: { kind: "deficit" } }), /championship/);
    assert.doesNotMatch(upfrontEndLine({ team: false, end: { kind: "deficit" } }), /championship/);
    assert.match(upfrontLines(["40", "60", "85"]).join(" "), /championship/, "step 1, before a pick, keeps the general form");
    for (const s of [inc, upfrontEndLine({ team: false, end: { kind: "coin", ticker: "ABC", mint: "m" } }), upfrontEndLine({ pair: true })]) clean(s);
  });
  test("the losing side's warning: no graduation clause once both graduated, wind-down from windDownDays", () => {
    const base = { ticker: "SEAWIN", otherTicker: "DENWIN", sideName: "Seahawks", otherSideName: "Broncos", selectorKey: "catalogue:espn.game:nfl-1-SEA-win", gameDay: "2026-10-15", voidBy: "2026-11-14" };
    const after = losingPairLine({ ...base, bothGraduated: true });
    assert.doesNotMatch(after, /graduate|voided/); assert.match(after, /its burn pool goes to \$DENWIN's burn\.$/);
    assert.match(losingPairLine({ ...base, windDownDays: 14 }), /over 14 days\.$/);
    assert.equal(windDownOver(28), "over four weeks");
    clean(after);
  });
  test("an unread pinned tier is said as unread, never as tier 14; the network's own tier line", () => {
    assert.match(feeSplitSentence("mainnet", null, { tierUnread: true }), new RegExp(TIER_UNREAD_LINE.replace(/[.]/g, "\\.")));
    assert.doesNotMatch(feeSplitSentence("mainnet", null, { tierUnread: true }), /1\.25%/);
    assert.match(feeFlowLine({ legs: [] }, null, true), /could not be read/);
    assert.equal(earlierCoinsLineFor("mainnet"), EARLIER_COINS_LINE);
    assert.doesNotMatch(earlierCoinsLineFor("devnet"), /tier 14|tier 9/);
    for (const s of [TIER_UNREAD_LINE, earlierCoinsLineFor("devnet")]) clean(s);
    assert.match(read("src/app/burnticker/trust/page.tsx"), /\{earlierCoinsLineFor\(t\.cluster\)\}/, "HB-13: the trust body names both tiers");
  });
  test("a voided single coin's line and the curve-time wind-down", () => {
    const single = { selectorKey: "polymarket:0xabc", pair: null, lifecycle: { ended: null } } as unknown as DecidedWarningInput;
    const line = voidedLine(single, [{ status: "void", units: 0, settledAt: "2026-10-20T01:00:00Z", kind: "binary" }]);
    assert.doesNotMatch(line, /Nothing burns on it/); assert.match(line, /winds down on this coin once the rule ends\.$/);
    const f = coinStatusFactsOf({ status: "live", ticker: "X", name: "X", rules: { oneShot: true }, market: { phase: "curve" }, lifecycle: { ended: { mode: "winddown" } } }, [{ status: "nothing", units: 0, settledAt: "2026-10-16", kind: "binary", result: "no" }]);
    assert.match(coinStatusSentence(f), new RegExp(DECIDED_TAILS.winddownOnCurve.replace(/[.]/g, "\\.")));
    clean(DECIDED_TAILS.winddownOnCurve);
  });
  test("the weather Every card names days, not steps (HB-18 leftover)", () => {
    assert.equal(everySentenceFor(scalar("nws.cli:DEN.high.90", 90) as never), EVERY_SENTENCES.reading);
  });
});

describe("HB-38: one market, one date, said as the market's close", () => {
  test("the event row states a date only when every market shares it; the review says 'The market closes by'", () => {
    assert.equal(oneMarketDate({ endDate: "2027-07-01T03:59:00Z", markets: [{ endDate: "2027-03-14T23:59:00Z" }, { endDate: "2027-07-01T03:59:00Z" }] }), null);
    assert.equal(oneMarketDate({ endDate: "2027-07-01T03:59:00Z", markets: [{ endDate: "2027-03-14T23:59:00Z" }] }), "2027-03-14T23:59:00Z");
    assert.match(beforeGraduationLine("Sun, Mar 14, 2027", poly()), /^The market closes by Sun, Mar 14, 2027\./);
    assert.doesNotMatch(beforeGraduationLine("Sun, Mar 14, 2027", poly()), /due around/);
    assert.match(read("src/app/burnticker/launch/ReviewCard.tsx"), /marketClosesLine\(p\.event\.resolves\)/);
    assert.match(page, /endsAt: eventInfo\?\.resolvesAt \?\? null/, "the Name header badge reads the same market date");
    clean(marketClosesLine("Sun, Mar 14, 2027"));
  });
});

describe("HB-41 and HB-42: browse card sentences, pasted links, the category hint", () => {
  test("next-event cards read as events, no basin code, the catalogue sample named as such", () => {
    assert.equal(unitExample({ label: "the next magnitude 6.5 or more" }), "burns once on the next earthquake of magnitude 6.5 or more");
    assert.match(paramExampleNote("nhc.storms:al", "al")!, /^Shown with one example, the Atlantic basin\./);
    assert.doesNotMatch(paramExampleNote("usgs.volcanowarning:332010", "332010")!, /332010/);
    assert.match(sampleReadingLabel({ id: "2026-10-08", value: "40310000000000" }, "2026-10-10", "USD"), /^Sample from the catalogue: reading 2026-10-08/);
  });
  test("a pasted Polymarket link opens its event; any other link is refused in one sentence without echoing it", () => {
    assert.deepEqual(pastedLink("https://polymarket.com/event/oscars-2027-best-picture-winner"), { kind: "polymarket", slug: "oscars-2027-best-picture-winner" });
    assert.deepEqual(pastedLink("https://example.com/x"), { kind: "other" });
    assert.equal(pastedLink("WIF"), null);
    assert.doesNotMatch(PASTED_LINK_REFUSAL, /https?:/); clean(PASTED_LINK_REFUSAL);
    assert.match(page, /if \(pastedLink\(qv\)\) \{ setUbusy\(false\); return; \}/);
  });
  test("the hint lists only the categories the Published data step has a tab for", () => {
    const cats = [{ id: "economics", feeds: ["treasury.debt"], guided: null }, { id: "politics", feeds: ["fedreg.eo"], guided: "elections" }, { id: "world", feeds: [], guided: null }, { id: "sports", feeds: ["thesportsdb.v2"], guided: null }, { id: "disasters", feeds: ["usgs.quakes"], guided: null }] as Pick<CategoryDef, "id" | "feeds" | "guided">[];
    assert.deepEqual(publishedDataCategories(cats).map((c) => c.id), ["economics"]);
    // HB-42 (hourly run 9): the hint now comes from the tabs' own list (browse.ts noMatchCategories, categoryList feedsOnly)
    assert.match(read("src/lib/burnticker/api/handlers.ts"), /categories = noMatchCategories\(loadCategories\(\), catalogueFeeds\(now\)/);
  });
  test("HB-21 leftover: the Published data list has no Sports or Natural disasters tab, and the list is cached per mode", () => {
    const sci: CategoryDef = { id: "science", label: "Science", blurb: "", feeds: ["treasury.debt"], polymarket: [], kalshi: [], guided: null };
    const dis: CategoryDef = { id: "disasters", label: "Natural disasters", blurb: "", feeds: ["usgs.quakes"], polymarket: [], kalshi: [], guided: null };
    const sp: CategoryDef = { id: "sports", label: "Sports", blurb: "", feeds: [], polymarket: [], kalshi: [], guided: null, native: ["espn:nfl"] } as CategoryDef;
    const f = (id: string) => ({ id, tier: 1, tierLabel: "", title: id, sourceName: "x", sourceUrl: "", cadence: "daily", unit: { label: "1" }, launchable: { ok: true, why: null }, flags: [], lastReading: null }) as FeedCardInput;
    assert.deepEqual(categoryList([sci, dis, sp], [f("treasury.debt"), f("usgs.quakes")], { feeds: true, polymarket: false, kalshi: false }, { feedsOnly: true }).map((c) => c.id), ["science"]);
    assert.deepEqual(categoryCards(sp, { feeds: [], polymarket: [], kalshi: [] }, { feedsOnly: true }), []);
    assert.deepEqual([...OTHER_FAMILY_CATEGORIES], ["sports", "disasters"]);
    assert.match(page, /catsMode\.current !== mode/);
  });
});

describe("HS-12: a title gives its first word plus the sequel number", () => {
  test("Dune: Part Three is $DUNE3, never $THREE", () => {
    assert.equal(eventIdentity("Will Dune: Part Three win Best Picture?").ticker, "DUNE3");
    assert.equal(outcomeTicker("Dune: Part Three"), "DUNE3");
    assert.equal(titleEntity("Kamala Harris"), null);
    assert.equal(eventIdentity("Will Kamala Harris win the 2028 election?").ticker, "HARRIS");
  });
});

describe("HB-47: embeds and the pair page", () => {
  test("no doubled article; a decided losing coin says it lost; the one-game pair heading", () => {
    assert.equal(ruleOneLiner(scalar("usgs.quakenext:6", 0), "The next reviewed magnitude 6 or more anywhere in the world (USGS)"), "burns once, on the next reviewed earthquake of magnitude 6 or more anywhere in the world (USGS)");
    assert.equal(dedupeArticle("burns on the The next reviewed quake feed"), "burns on the next reviewed quake feed");
    const lost = lostDayOf({ next: { result: "decided" }, profile: { badge: "ONE-SHOT · Oct 15, 2026" } } as never, [{ pairRole: "lost", settledAt: "2026-10-16T04:00:00Z", kind: "binary" }]);
    assert.equal(lost, "2026-10-15");
    const line = lastBurnLine({ lastBurn: null, status: "live", lost });
    assert.equal(line, "lost on Oct 15; cannot burn on this result"); clean(line);
    assert.equal(pairMatchupWords("Seahawks Wins vs Broncos", "Broncos Wins vs Seahawks", "If the Seahawks win against the Broncos on Oct 15, 2026, it burns."), "Seahawks vs Broncos, Oct 15");
    const reg = { pair: () => ({ pairId: "p", mintA: "a", mintB: "b", selectorKey: "x", createdAt: 1 }), pairs: () => [], token: (m: string) => (m === "a" ? { mint: "a", ticker: "SEAWIN", name: "Seahawks Wins vs Broncos", status: "live", description: "on Oct 15, 2026" } : { mint: "b", ticker: "DENWIN", name: "Broncos Wins vs Seahawks", status: "live" }), tokens: () => [] };
    assert.equal(pairSeed(reg as never, "p")!.title, "$SEAWIN vs $DENWIN: Seahawks vs Broncos, Oct 15");
  });
});

describe("HB-43 and HS-13: back-test labels, one source, a waiting line", () => {
  test("a fall on an either-way rule is labelled a fall; team coins use the league schedule only", () => {
    const b = backtest(scalar("fred.CPIAUCSL"), [{ id: "2026-05", at: "2026-05-01T00:00:00Z", value: "333.979", result: null, title: null }, { id: "2026-06", at: "2026-06-01T00:00:00Z", value: "332.568", result: null, title: null }] as never, Date.parse("2026-10-01T00:00:00Z"), 24);
    assert.equal(b.rows[1].kind, "down");
    assert.equal(backtestSourceOf(billsSeason), "schedule");
    assert.equal(backtestSourceOf(scalar("fred.CPIAUCSL")), "venue");
    clean(BACKTEST_WAITING_LINE);
    assert.match(page, /data-backtest-waiting>\{BACKTEST_WAITING_LINE\}/);
    assert.match(read("src/lib/burnticker/lastSeason.ts"), /Counted from the league's \$\{season\} schedule\./);
    assert.match(read("src/lib/burnticker/catalogue/index.ts"), /const counted = b\.rows\.length \? b\.rows : null;/, "the heading window is the counted window");
  });
});

describe("HB-46: no placeholders or repository paths in public answers", () => {
  test("repository paths are dropped or said as the published record; Markdown links render", () => {
    const out = withoutRepoPaths({ source: "config/burnticker/current-status.json", text: "the record is docs/burnkeeper/evidence/x.log.", url: "https://burnticker.com/x" });
    assert.deepEqual(out, { text: "the record is the published record.", url: "https://burnticker.com/x" });
    assert.doesNotMatch(JSON.stringify(out), /docs\/|config\//);
    assert.deepEqual(markdownLinkParts("Postmortem: due in [../INCIDENTS.md](../INCIDENTS.md)."), [{ text: "Postmortem: due in ", href: null }, { text: "the published record", href: null }, { text: ".", href: null }].filter((p) => p.text) as never, "a relative link keeps no path");
    assert.equal(markdownLinkParts("[status](https://burnticker.com/status/)")[0].href, "https://burnticker.com/status/");
    assert.equal(sentenceWithoutRepoPaths("see https://github.com/x/docs/y"), "see https://github.com/x/docs/y", "a URL's path is not a repository path");
    assert.doesNotMatch(read("src/app/burnticker/incidents/page.tsx"), /<RepoText text=\{INCIDENTS_FILE\} \/>/);
  });
  test("the fee ledger serves no TODO tokens and one not-recorded note; current-status names the cluster", () => {
    const e: Expenses = { schema: "burnticker.expenses/v1", updatedAt: "x", note: "n", whatTheFeePaysFor: "w", items: [{ id: "h", label: "Hosting", cadence: "monthly", usd: null, placeholder: true, todo: "TODO_EXPENSE_HOSTING", note: "" }] } as Expenses;
    assert.doesNotMatch(JSON.stringify(publicExpenses(e)), /TODO_/);
    clean(NOT_RECORDED_NOTE);
    const cs = read("config/burnticker/current-status.json");
    assert.doesNotMatch(cs, /"deployed": "devnet"/);
    assert.doesNotMatch(read("config/burnticker/expenses.json"), /TODO-OWNER\.md/);
    for (const r of ["src/app/api/burnticker/v1/current-status/route.ts", "src/app/api/burnticker/v1/operator/route.ts"]) assert.match(read(r), /withoutRepoPaths\(/);
  });
  test("the trust cap statement gives the end date once; the whitepaper says the keys are set", () => {
    const s = capSentence({ capLamports: "25000000000", sunsetTs: 1_822_435_200, source: "default", pending: null } as never);
    assert.equal((s.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}/g) ?? []).length, 1, s);
    assert.doesNotMatch(s, /expires by/);
    assert.match(read("docs/burnticker/WHITEPAPER.md"), /The mainnet keys are set/);
    assert.doesNotMatch(read("site/burnticker/whitepaper.html"), /every public key is a placeholder/);
  });
});

describe("HB-53 (sixth pass): the prompt count and a refused proof", () => {
  test("the count includes the proof: single 2 transactions = 3, LaunchLab pair 4 = 5, pair curve 1 = 2", () => {
    assert.equal(walletPromptCount({ transactions: 2, proof: true }), 3);
    assert.equal(walletPromptCount({ transactions: 4, proof: true }), 5);
    assert.equal(walletPromptCount({ transactions: 1, proof: true }), 2);
    assert.equal(walletPromptCount({ transactions: 2, proof: false }), 2);
    assert.match(signsLine(3, { proof: true }), /^Your wallet asks 3 times in all: first to sign the request/); clean(signsLine(3, { proof: true }));
    assert.match(page, /signsProof=\{proofAsked\}/);
    const tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx");
    assert.equal((tile.match(/signs=\{shown\.review\?\.transactions\.count \? walletPromptCount\(/g) ?? []).length, 2, "both Coin comparison reviews, the pair curve included");
    assert.equal((tile.match(/edgeNotes=\{/g) ?? []).length, 2);
  });
  test("a rejected proof: zero prepares, zero sends, the sentence", async () => {
    let prepares = 0, sends = 0;
    const press = async () => { await requireLaunchProof(async () => { throw new Error("User rejected the request."); }, { creator: "C", tickers: ["ABC"], mints: [] }, () => "x"); prepares++; sends++; };
    await assert.rejects(press, (e: unknown) => e instanceof LaunchProofRejected && (e as Error).message === PROOF_REJECTED_SENTENCE);
    assert.deepEqual([prepares, sends], [0, 0]);
    clean(PROOF_REJECTED_SENTENCE);
    // the page and the tile sign before the first post
    const i = page.indexOf("const walletProof = await requireLaunchProof("), j = page.indexOf("const a = await post(", i);
    assert.ok(i > 0 && j > i);
    assert.ok(!/await signLaunchRequest\(wallet\.signMessage, \{ origin: window\.location\.origin, creator, tickers: \[(sent|ticker|body)/.test(page + read("src/app/burnticker/launch/CoinVsCoinTile.tsx")));
  });
});

describe("B-12 wiring: the page passes the ticker guard at every generated pair site", () => {
  test("winPairNames, the matchup, meetings and the one-game switches use the guard; the swap line shows", () => {
    assert.match(page, /return winPairNames\(sideA, sideB, tickerGuard\);/);
    assert.match(page, /const tickerGuard = useMemo\(\(\): TickerGuard => \(\{ existing: liveTickers\.map\(\(t\) => \(\{ ticker: t, name: "", status: "live" \}\)\) \}\), \[liveTickers\]\);/);
    assert.ok((page.match(/freePairTickers\([^)]*\}?[^)]*tickerGuard\)/g) ?? []).length >= 5, "the genTicker, matchup, meetings and the two one-game sites");
    assert.doesNotMatch(page, /pairTickers\(/);
    assert.match(page, /data-pair-ticker-swap>/);
    assert.match(page, /if \(tickerAuto\) \{ setTicker\(ft\.a\); setTickerB\(ft\.b\); \}/, "a typed ticker is never changed");
  });
});

describe("HB-15, HB-23, HB-25 leftovers and HS-11, HS-14, HS-15", () => {
  test("a one-game receipt carries the game's day and its ESPN link opens that day", () => {
    const s = { selectorKey: "catalogue:espn.game:nfl-1-SEA-win", profile: { badge: "ONE-SHOT · Oct 15, 2026" } } as DecidedWarningInput;
    assert.equal(receiptGameDay(s), "2026-10-15");
    assert.equal(espnLinkOnDay("https://www.espn.com/nfl/scoreboard/_/date/20261016", "2026-10-15"), "https://www.espn.com/nfl/scoreboard/_/date/20261015");
  });
  test("related cards say 'you typed' only when the creator typed", () => {
    assert.equal(relatedCardLine({ template: false, typed: false }), "A related rule from the same source.");
    assert.equal(relatedCardLine({ template: true, typed: true }), "A related rule from the same source.");
    assert.match(relatedCardLine({ template: false, typed: true }), /you typed/);
  });
  test("the tokens list says which receipt count is which", () => {
    assert.match(read("src/lib/burnticker/api/v1.ts"), /receiptsRecorded: rows\.length, receiptsOnChain:/);
  });
  test("away games say at; times in the visitor's zone; the bye note carried to the burn step and the review", () => {
    assert.equal(nextGameWords({ opponent: "Broncos", home: false, title: "x" }), "at Broncos");
    assert.equal(nextGameWords({ opponent: "Cardinals", home: true, title: "x" }), "vs Cardinals");
    assert.match(page, /\{VISITOR_TIME_LINE\}<\/p>/); assert.doesNotMatch(page, /Times are in Denver time/);
    assert.match(byeLine("Bills"), /^The Bills have no game in the next 8 days\./);
    assert.match(page, /team\?\.seasonWarning === NONE_LISTED_LINE/); assert.ok(NONE_LISTED_LINE);
    assert.match(page, /data-bye-line>\{byeNow\}/); assert.match(page, /if \(byeNow\) notes\.push\(byeNow\);/);
    for (const x of [VISITOR_TIME_LINE, byeLine("Bills")]) clean(x);
  });
});
