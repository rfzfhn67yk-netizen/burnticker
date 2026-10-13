// THE RIVALRY SERIES, items 3 to 6 of RIVALRY-SERIES-BRIEF: the preflight allows a pair on a `meetings` series and nothing else from the
// sports family; both coins pin the pair-winner end sink; the review, the coin text and the money path say what happens per game and at
// the season's end in plain words, each claim matching the program (pair.rs forward_to_winner, end.rs partner_won / forward_on_end); the
// /v1/sports/rivalry picker; the venue (two LaunchLab coins linked at creation, never the pair curve); the launch page's option copy.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { MEETINGS_END_REFUSAL, MEETINGS_FADE_REFUSAL, MEETINGS_SINGLE_REFUSAL, meetingsRefusals, ruleRefusals } from "@/lib/burnticker/launchPreflight";
import { DEFAULT_ON_END, lockRule, validateRule, WIND_DOWN_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { buildPairBundles, FakeLaunchLab, MEETINGS_END_SINK_REFUSAL } from "@/lib/burnticker/launchBundle";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { describeRule, endText, MEETINGS_END_RESULT, MEETINGS_LEVEL_SENTENCE, WINDOW_SENTENCE, windowKindOf } from "@/lib/burnticker/describe";
import { meetingsFundsFlow } from "@/lib/burnticker/pairFundsFlow";
import { MEETINGS_END_LABEL, MEETINGS_END_LINE, MEETINGS_NONE_LINE, MEETINGS_ON_END, MEETINGS_WINNER_LINE, RIVALRY_SERIES_LABEL, RIVALRY_SERIES_LINE, meetingsPairNames, meetingsPairRules, patternOptions, patternWords, teamTickerForRule } from "@/lib/burnticker/guidedLaunch";
import { sportsRivalry } from "@/lib/burnticker/api/handlers";
import { setNativeClients } from "@/lib/burnticker/sources/native";
import { teamByAbbr, teamSeries } from "@/lib/burnticker/sources/espn";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { ATTESTER, CREATOR, FILLER, SERIES, fakeDeps, game, meetingsRule, scheduleClient } from "./burntickerRivalrySeriesHelpers.ts";

const ENV = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" } as Record<string, string>;
const NOW = Date.parse("2026-01-15T12:00:00Z");
const cfg = loadCopyLintConfig();
const plain = (t: string, where: string) => {
  const hits = lintCopy(t, cfg).hits.map((h) => h.rule);
  assert.deepEqual(hits, [], `${where}: ${t}`);
  assert.doesNotMatch(t, /\bESPN\b/, `${where} names ESPN`);
  assert.doesNotMatch(t, /\bbuy|\bwill\b|\bprice\b|coming soon/i, `${where}: ${t}`);
};
const pairBody = (rule: BurnRule = meetingsRule()) => ({ rule, ticker: "PHIVBOS", name: "76ers vs Celtics, 76ers side", raiseSol: "85", pair: { ticker: "BOSVPHI", name: "Celtics vs 76ers, Celtics side" } });

describe("item 3: the preflight", () => {
  test("a pair on a meetings series is allowed; the same series alone, its fade side, or without the end sink is refused; any other sports pair stays refused", () => {
    const ok = buildLaunchReview(pairBody(), { env: ENV, now: NOW });
    assert.ok("review" in ok && ok.review.problems.length === 0, JSON.stringify("review" in ok ? ok.review.problems : ok.problems));
    const alone = buildLaunchReview({ ...pairBody(), pair: null }, { env: ENV, now: NOW });
    assert.ok("review" in alone && alone.review.problems.includes(MEETINGS_SINGLE_REFUSAL));
    assert.deepEqual(meetingsRefusals({ ...meetingsRule(), inverse: true } as BurnRule, { pair: true }).map((r) => r.message), [MEETINGS_FADE_REFUSAL]);
    assert.deepEqual(meetingsRefusals({ ...meetingsRule(), onEnd: { ...WIND_DOWN_ON_END } } as BurnRule, { pair: true }).map((r) => r.message), [MEETINGS_END_REFUSAL]);
    assert.deepEqual(ruleRefusals(lockRule(meetingsRule()), { pair: true }), []);
    // a season team series (every loss this season) cannot pair: the program's pair gate in rules.ts
    const season = { ...firstPartyRule(teamSeries("nba", "PHI", "loss", { kind: "season", year: 2026 }), 0.02), onEnd: { ...DEFAULT_ON_END } };
    const r = buildLaunchReview(pairBody(season as BurnRule), { env: ENV, now: NOW });
    assert.ok("review" in r && r.review.problems.some((p) => /tier-1 adjudicated market/.test(p)), "a season team pair is still refused");
    assert.throws(() => validateRule({ ...meetingsRule(), scalar: { ...meetingsRule().scalar!, direction: "down" }, pair: { pairId: "phivbos-vs-bosvphi", side: "A", counterpartMint: null } }), /mirror series|direction "up"/);
  });
  test("both sides' end sink is pinned to pair-winner, each naming the other; side B reads the mirror series; nothing goes through the pair curve", async () => {
    const program = new FakeBurnProgram("devnet"); program.pinEndSinks = true;
    const pr = await buildPairBundles({ a: { creator: CREATOR, ticker: "PHIVBOS", name: "76ers vs Celtics", description: "", imageUrl: null, links: [], rule: meetingsRule(), firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, b: { ticker: "BOSVPHI", name: "Celtics vs 76ers", description: "", imageUrl: null, links: [] } },
      { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
    const ra = lockRule(JSON.parse(pr.a.rules.text)).rule, rb = lockRule(JSON.parse(pr.b.rules.text)).rule;
    assert.equal(ra.series, SERIES.a); assert.equal(rb.series, SERIES.b);
    assert.deepEqual([ra.scalar!.direction, rb.scalar!.direction], ["up", "up"]);
    assert.equal(ra.pair!.winnerTakesBurn, true); assert.equal(rb.pair!.counterpartMint, pr.a.mint);
    assert.deepEqual(await program.endSink.port(pr.a.mint).endSink(), { kind: "pair-winner", sinkMint: pr.b.mint, minForwardLamports: BigInt(50_000_000) });
    assert.deepEqual(await program.endSink.port(pr.b.mint).endSink(), { kind: "pair-winner", sinkMint: pr.a.mint, minForwardLamports: BigInt(50_000_000) });
    await assert.rejects(buildPairBundles({ a: { creator: CREATOR, ticker: "PHIVBOS", name: "x", description: "", imageUrl: null, links: [], rule: { ...meetingsRule(), onEnd: { ...WIND_DOWN_ON_END } }, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, b: { ticker: "BOSVPHI", name: "y", description: "", imageUrl: null, links: [] } },
      { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` }), (e: Error) => e.message === MEETINGS_END_SINK_REFUSAL);
    const pc = buildLaunchReview(pairBody(), { env: { ...ENV, BURNTICKER_PAIR_CURVE_ENABLED: "1" }, now: NOW });
    assert.ok("review" in pc && pc.review.venue === "launchlab", "a head-to-head pair launches on LaunchLab even with the pair curve on");
    assert.equal(MEETINGS_ON_END.windDownDays, DEFAULT_ON_END.windDownDays); assert.equal(MEETINGS_ON_END.sweepThresholdLamports, DEFAULT_ON_END.sweepThresholdLamports); assert.equal(MEETINGS_ON_END.endSink, DEFAULT_ON_END.endSink);
  });
});

describe("item 3: what a creator reads (per game and at the season's end)", () => {
  test("the review: the coin text, the end in two parts, the money path and side B's text; plain English, no ESPN, every window sentence once", () => {
    const r = buildLaunchReview(pairBody(), { env: ENV, now: NOW });
    assert.ok("review" in r);
    const v = r.review;
    assert.equal(v.end.kind, "pair-winner");
    assert.equal(v.end.result, MEETINGS_END_RESULT);
    assert.ok(v.end.void!.startsWith(MEETINGS_LEVEL_SENTENCE));
    const desc = v.coins[0].description!;
    assert.match(desc, /^\$PHIVBOS burns when the 76ers beat the Celtics\./);
    assert.match(desc, /For every game the 76ers win against the Celtics in the 2025–26 season, playoffs included/);
    assert.match(desc, /When the Celtics win one of those games, this coin's share for that game goes to the burn pool of the Celtics coin instead\./);
    assert.equal((desc.match(WINDOW_SENTENCE.season) ?? []).length, 1, desc);
    assert.match(v.meetings!.descriptionB, /^\$BOSVPHI burns when the Celtics beat the 76ers\./);
    for (const t of [desc, v.meetings!.descriptionB, v.end.result, v.end.void!, v.rule.endsLine, v.meetings!.flow.oneLiner, ...v.meetings!.flow.steps.map((s) => s.text), ...v.meetings!.flow.outcomes.flatMap((o) => [o.when, o.then]), v.meetings!.flow.never]) plain(t, "review");
    assert.equal(windowKindOf(meetingsRule()), "season");
    assert.equal(teamTickerForRule(meetingsRule()), "PHIVBOS"); assert.equal(teamTickerForRule(meetingsRule(SERIES.b)), "BOSVPHI");
  });
  test("every money claim matches the program: per game the loser's share moves to the winner's pool (forward_to_winner); at the end the rest goes to the pair winner of the season-end result if live, else $DEFICIT (partner_won); a level series moves nothing (void end)", () => {
    const f = meetingsFundsFlow({ a: "PHIVBOS", b: "BOSVPHI" }, { a: "76ers", b: "Celtics" });
    const all = [f.oneLiner, ...f.steps.map((s) => s.text), ...f.outcomes.map((o) => `${o.when}: ${o.then}`)].join(" ");
    assert.match(all, /sends exactly the share its own rule sets for that game to the winning coin's burn pool/);
    assert.match(all, /coin of the team that won fewer of the games between them sends what is left in its burn pool, and any fees that arrive later, to the other coin's burn pool/);
    assert.match(all, /has no live trading pool at the end: The other coin's rest goes to \$DEFICIT's burn instead\./);
    assert.match(all, /won the same number of games against each other: Nothing moves at the end/);
    assert.match(all, /A game ends in a draw: Nothing moves for that game/);
    assert.doesNotMatch(all, /nobody is paid/i);
    const e = endText({ ...meetingsRule(), pair: { pairId: "x-vs-y-z", side: "A", counterpartMint: null, winnerTakesBurn: true } } as BurnRule);
    assert.equal(e.kind, "pair-winner");
    const d = describeRule({ ...meetingsRule(), pair: { pairId: "x-vs-y-z", side: "A", counterpartMint: null, winnerTakesBurn: true } } as BurnRule, { ticker: "PHIVBOS" });
    assert.match(d.windowSentence, /whatever is left burns the coin of the team that won more of the games between them, or \$DEFICIT if that coin is not live, and the coin retires/);
    assert.match(d.badge, /^2025–26 SEASON SERIES$/);
  });
  test("the launch page's option copy (item 6): label, one line, step 3 winner only, step 4 the series winner; plain", () => {
    for (const t of [RIVALRY_SERIES_LABEL, RIVALRY_SERIES_LINE, MEETINGS_WINNER_LINE, MEETINGS_END_LABEL, MEETINGS_END_LINE, MEETINGS_NONE_LINE]) plain(t, "guidedLaunch");
    assert.equal(RIVALRY_SERIES_LABEL, "Every game between them this season");
    const o = patternOptions({ follow: "rivalry", pairKind: "teams", rule: meetingsRule(), rivalryScope: "meetings" });
    assert.equal(o.preselected, "winner");
    assert.deepEqual(o.options.map((x) => [x.id, x.available]), [["every", false], ["fade", false], ["once", false], ["winner", true]]);
    const season = patternOptions({ follow: "rivalry", pairKind: "teams", rule: firstPartyRule(teamSeries("nba", "PHI", "loss", { kind: "season", year: 2026 }), 0.02), rivalryScope: "season" });
    assert.equal(season.options.find((x) => x.id === "winner")!.available, false, "winner takes the burn stays greyed for the other two options");
    assert.equal(patternWords("winner", { follow: "rivalry", pairKind: "teams", rivalryScope: "meetings" }).sentence, MEETINGS_WINNER_LINE);
    const n = meetingsPairNames(teamByAbbr("nba", "PHI")!, teamByAbbr("nba", "BOS")!);
    assert.deepEqual([n.a.ticker, n.b.ticker, n.a.name, n.b.name], ["PHIVBOS", "BOSVPHI", "76ers vs Celtics, 76ers side", "Celtics vs 76ers, Celtics side"]);
    const rules = meetingsPairRules("nba", "PHI", "BOS", 2026);
    assert.deepEqual([rules.a.series, rules.b.series], [SERIES.a, SERIES.b]);
    assert.equal(rules.a.onEnd!.endSink, true);
  });
});

describe("item 4: GET /v1/sports/rivalry", () => {
  test("every game between the two teams this season with date, playoff flag, status and result from a's side; the series ids; not offered without a meeting", async () => {
    const games = [game("2025-11-03T23:00:00Z", "PHI", "BOS", 110, 100), game("2026-03-03T23:00:00Z", "BOS", "PHI", null, null, { status: 1 }), game("2026-02-03T23:00:00Z", "BOS", "PHI", null, null, { status: 1, text: "Cancelled" }), ...FILLER];
    setNativeClients({ espn: scheduleClient(games, () => NOW), games: fakeDeps(games) });
    const r = await sportsRivalry(null as never, { league: "nba", a: "PHI", b: "BOS" });
    assert.equal(r.status, 200);
    const b = r.body as { offered: boolean; series: { a: string; b: string }; season: string; source: string; meetings: { date: string; status: string; result: string; playoff: boolean }[]; tally: Record<string, unknown>; a: { ticker: string } };
    assert.equal(b.offered, true);
    assert.deepEqual(b.series, SERIES);
    assert.equal(b.season, "2025–26");
    assert.deepEqual(b.meetings.map((m) => [m.date, m.status, m.result, m.playoff]), [["2025-11-03", "final", "win", false], ["2026-02-03", "postponed or cancelled", "void", false], ["2026-03-03", "scheduled", "pending", false]]);
    assert.equal(b.tally.PHI, 1); assert.equal(b.a.ticker, "PHIVBOS");
    assert.doesNotMatch(b.source, /ESPN/);
    const none = await sportsRivalry(null as never, { league: "nba", a: "PHI", b: "MIA" });
    assert.equal((none.body as { offered: boolean }).offered, true, "the filler lists a PHI–MIA game");
    const nobody = await sportsRivalry(null as never, { league: "nba", a: "NYK", b: "MIA" });
    assert.deepEqual([(nobody.body as { offered: boolean }).offered, (nobody.body as { offeredLine: string }).offeredLine], [false, MEETINGS_NONE_LINE]);
    assert.equal((await sportsRivalry(null as never, { league: "nba", a: "PHI", b: "PHI" })).status, 400);
    assert.equal((await sportsRivalry(null as never, { league: "xfl", a: "PHI", b: "BOS" })).status, 400);
  });
});
