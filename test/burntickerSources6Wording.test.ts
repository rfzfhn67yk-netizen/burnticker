// sources-6 (QA pass 9 #18–#23 and audit 10 #9, #15, #21, #22, 2026-10-13): rule explanations per type, singular and articles, the market's
// NO option, link text in Polymarket's resolution sentence, content rules that read denials and ordinary words, unmatched constraints named,
// long outcome lists, usable references first, "Then it the rest".
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { budgetCopy, MARKET_NO_LABEL, MARKET_NO_SENTENCE, meetingsWhichCoinLine, patternOptions, patternWords, rivalrySeasonLine, RIVALRY_SEASON_LINE, unitPhrase } from "@/lib/burnticker/guidedLaunch";
import { describeRule, END_SINK_VOID_SENTENCE, END_SINK_VOID_SENTENCE_PLAIN, endText, independentPairFacts, teamRefByName } from "@/lib/burnticker/describe";
import { meetingsFundsFlow } from "@/lib/burnticker/pairFundsFlow";
import { statedPhrase } from "@/lib/burnticker/sources/polyStated";
import { creatorTextProblems } from "@/lib/burnticker/coinText";
import { quakeAsk, universalSearch, polyRule, type FeedLike } from "@/lib/burnticker/search";
import { catalogueSources } from "@/lib/burnticker/api/handlers";
import { pickerPage } from "@/lib/burnticker/polySearch";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { teamSeries } from "@/lib/burnticker/sources/espn";
import { DEFAULT_ON_END, type BurnRule } from "@/lib/burnticker/rules";

const cfg = loadCopyLintConfig();
const plain = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}: ${t}`); };
const NOW = Date.parse("2026-10-13T12:00:00Z");
const fade = (series: string) => ({ ...nativeRule(series, { fractionOfPool: 0.02 }), inverse: true }) as BurnRule;

describe("QA pass 9 #18 and #20: the budget line is said for what the rule reads", () => {
  test("no 'however flat it was' on a team, disaster or event count; 'each earthquake', never 'each 1 earthquake'", () => {
    const team = budgetCopy(fade(teamSeries("nba", "PHI", "win", { kind: "season", year: 2026 })), 0.02, null);
    const quake = budgetCopy(fade("usgs.quakes:6"), 0.02, unitPhrase({ label: "1 earthquake" }));
    const debt = budgetCopy({ schema: "burnticker.rules/v1", oracle: "catalogue", series: "treasury.debt", market: null, filter: {}, kind: "scalar", scalar: { unit: 1e9, perUnit: { fractionOfPool: 0.02 }, baseline: "previousSettlement", direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, inverse: true } as unknown as BurnRule, 0.02, null);
    assert.doesNotMatch(team.line, /however flat/); assert.match(team.line, /^Each game day without the result the rule names/);
    assert.doesNotMatch(quake.line, /however flat/); assert.match(quake.line, /^Each day with none of the events the rule counts/);
    assert.match(debt.line, /however flat it was/, "a level read against its last value keeps it");
    const per = budgetCopy(nativeRule("usgs.quakes:6", { fractionOfPool: 0.02 }), 0.02, unitPhrase({ label: "1 earthquake" }));
    assert.equal(per.label, "Share of the burn pool per earthquake"); assert.match(per.line, /^Each earthquake spends 2% /);
    assert.match(budgetCopy(nativeRule("nifc.acres", { fractionOfPool: 0.02 }), 0.02, "100,000 acres").line, /^Each 100,000 acres spends/);
    for (const t of [team.line, quake.line, per.line]) plain(t);
  });
});

describe("QA pass 9 #19: 'the season is cancelled' and 'the postseason' only where they exist", () => {
  test("the void sentence names a season only on sports coins", () => {
    const end = { onEnd: { ...DEFAULT_ON_END } };
    const quake = describeRule({ ...nativeRule("usgs.quakenext:7", { fractionOfPool: 1 }), ...end } as BurnRule, { ticker: "NEXTM7" });
    const market = describeRule({ ...polyRule(`0x${"b".repeat(64)}`, 1), ...end } as BurnRule, { ticker: "EVENT", eventPhrase: "the film wins Best Picture" });
    const game = describeRule({ ...nativeRule("espn.game:mlb-401999999-TB-loss", { fractionOfPool: 0.1 }), ...end } as BurnRule, { ticker: "TBGM" });
    for (const t of [quake.paragraph, market.paragraph]) { assert.doesNotMatch(t, /season is cancelled/, t); assert.ok(t.includes(END_SINK_VOID_SENTENCE_PLAIN), t); }
    assert.ok(game.paragraph.includes(END_SINK_VOID_SENTENCE));
    assert.equal(endText({ ...polyRule(`0x${"b".repeat(64)}`, 1), ...end } as BurnRule).void, END_SINK_VOID_SENTENCE_PLAIN);
    plain(END_SINK_VOID_SENTENCE_PLAIN);
  });
  test("a league without playoffs is never said to have a postseason", () => {
    assert.doesNotMatch(rivalrySeasonLine("eng.1"), /postseason/); assert.equal(rivalrySeasonLine("nba"), RIVALRY_SEASON_LINE);
    const f = meetingsFundsFlow({ a: "LEEVMCI", b: "MCIVLEE" }, { a: "Leeds United", b: "Manchester City" }, { playoffs: false });
    assert.doesNotMatch(JSON.stringify(f), /playoffs included/);
    plain(rivalrySeasonLine("eng.1"));
  });
});

describe("QA pass 9 #21: articles and team names", () => {
  test("clubs and colleges take no article; US pro teams take 'the'", () => {
    assert.equal(teamRefByName("Leeds United"), "Leeds United"); assert.equal(teamRefByName("Celtics"), "the Celtics"); assert.equal(teamRefByName("Heat"), "the Heat");
    assert.equal(teamRefByName("the Rays"), "the Rays"); assert.equal(teamRefByName("Unknown FC"), "Unknown FC");
    assert.doesNotMatch(meetingsWhichCoinLine({ a: "LEEVMCI", b: "MCIVLEE", teamA: "Leeds United", teamB: "Man City" }), /the Leeds United/);
    assert.match(meetingsWhichCoinLine({ a: "PHIVBOS", b: "BOSVPHI", teamA: "76ers", teamB: "Celtics" }), /when the 76ers win a game between them, and \$BOSVPHI when the Celtics win one/);
    const f = independentPairFacts("LEEDS", "CITY", { a: "Leeds United", b: "Manchester City" });
    assert.doesNotMatch(f.trigger + f.example, /the Leeds United|the Manchester City/);
    assert.doesNotMatch(JSON.stringify(meetingsFundsFlow({ a: "A", b: "B" }, { a: "Leeds United", b: "Arsenal" })), /the Leeds United|the Arsenal/);
  });
});

describe("QA pass 9 #22: a market's NO option says resolves NO, with its own helper", () => {
  test("pattern card and pattern words", () => {
    const rule = { ...polyRule(`0x${"c".repeat(64)}`, 1), binary: { onYes: null, onNo: { fractionOfPool: 1 } } } as BurnRule;
    const o = patternOptions({ follow: "market", rule });
    const f = o.options.find((x) => x.id === "fade")!;
    assert.deepEqual([f.label, f.sentence, f.available], [MARKET_NO_LABEL, MARKET_NO_SENTENCE, true]);
    assert.equal(o.preselected, "fade");
    assert.deepEqual(patternWords("fade", { follow: "market" }), { label: "If it resolves NO", sentence: MARKET_NO_SENTENCE });
    assert.doesNotMatch(MARKET_NO_SENTENCE, /each day or reading/); plain(MARKET_NO_SENTENCE);
  });
});

describe("QA pass 9 #23: Polymarket's resolution sentence keeps its links' meaning", () => {
  test("a bare link becomes its site's name; link text is kept; a link in brackets after a name is dropped", () => {
    assert.equal(statedPhrase("Binance BTC/USDT price available at https://www.binance.com/en/trade/BTC_USDT with the chart settings on 1m"), "Binance BTC/USDT price available at the Binance website with the chart settings on 1m");
    assert.equal(statedPhrase("the [BTC/USDT chart](https://www.binance.com/en/trade/BTC_USDT) on Binance"), "the BTC/USDT chart on Binance");
    assert.equal(statedPhrase("official information from MLB (https://www.mlb.com/)"), "official information from MLB");
    assert.doesNotMatch(statedPhrase("data available at https://x.com/foo with the chart"), /at\s+with/);
  });
});

describe("audit 10 #9: content rules read ordinary words and denials", () => {
  const bad = (t: string) => creatorTextProblems({ name: "Coin", ticker: "COIN", note: t }).flatMap((p) => p.rules);   // sources-7 round 2: one problem per field, every rule listed
  test("'moon' in ordinary language and an explicit denial pass; price talk, promises and endorsements are refused", () => {
    for (const ok of ["moon-club", "Harvest moon watchers", "The first crewed moon landing", "Not affiliated with any team.", "Not officially endorsed by anyone.", "No affiliation with the league.", "Unaffiliated fan coin."]) assert.deepEqual(bad(ok), [], ok);
    for (const [t, rule] of [["Officially endorsed by the USGS!", "affiliation"], ["Going to the moon", "to-the"], ["Mooning soon", "moon"], ["Our official partner coin", "affiliation"], ["Guaranteed to burn", "guarantee"]] as const) assert.ok(bad(t).includes(rule), `${t}: ${bad(t).join(",")}`);
    assert.ok(bad("Not affiliated with the team, but officially endorsed by it").includes("affiliation"), "a denial does not hide a claim in the same note");
  });
});

describe("audit 10 #15: a plain-language constraint the source cannot meet is named", () => {
  const feeds = () => catalogueSources(NOW).sources as unknown as FeedLike[];
  const deps = () => ({ venues: { kalshi: false, polymarket: false, feeds: true }, feeds: feeds(), espn: null, polyGet: null, refuse: () => [], kalshiSearch: null, derbyHref: null, nowMs: NOW });
  test("'earthquake above 7 in Japan' is offered as asked; 'in Chile' says what is not offered", async () => {
    assert.deepEqual(quakeAsk("earthquake above 7 in Japan"), { magnitude: "7", region: "japan", unsupported: [] });
    const jp = (await universalSearch("earthquake above 7 in Japan", deps())).cards.find((c) => c.pick?.series?.startsWith("usgs.quakes:"))!;
    assert.equal(jp.pick!.series, "usgs.quakes:7/japan"); assert.ok(!jp.alternative); assert.match(jp.title, /magnitude 7 or more in Japan/);
    const cl = (await universalSearch("earthquake above 7 in Chile", deps())).cards.find((c) => c.pick?.series?.startsWith("usgs.quakes:"))!;
    assert.equal(cl.pick!.series, "usgs.quakes:7"); assert.equal(cl.alternative, true);
    assert.match(cl.note!, /^Not offered as asked: Chile \(the regions offered are the world, the contiguous United States, California, Alaska and Japan\)\. This card is the closest rule/);
    const odd = quakeAsk("magnitude 6.3 quake");
    assert.deepEqual([odd.magnitude, odd.unsupported.length], [null, 1]);
    plain(cl.note!);
  });
});

describe("audit 10 #21: long outcome lists and references", () => {
  test("filter, a page at a time, with what is left", () => {
    const outs = Array.from({ length: 30 }, (_, i) => ({ label: i % 2 ? `Candidate ${i}` : `Film ${i}`, question: `Will option ${i} win?`, conditionId: `0x${i}`, yes: "Yes", no: "No", ticker: `T${i}`, parent: "Oscars 2027: Best Picture", endsAt: "2027-03-01T00:00:00Z" }));
    const p = pickerPage(outs, null);
    assert.deepEqual([p.outcomes.length, p.total, p.more, p.moreLabel], [12, 30, 18, "Show 12 more of 18"]);
    const f = pickerPage(outs, "film");
    assert.equal(f.total, 15); assert.ok(f.outcomes.every((o) => o.label.startsWith("Film")));
    assert.equal(pickerPage(outs, "film", 24).more, 0);
    assert.equal(p.outcomes[0].parent, "Oscars 2027: Best Picture");
  });
});
