// Owner decision (2026-10-13 night): a soccer team coin picks WHICH results burn, any one of win, draw or loss, or any TWO of them
// ("win or draw" = does not lose, "draw or loss" = does not win, "win or loss" = no draw). New outcome codes in the series id (espn.ts
// PairOutcome: windraw, drawloss, winloss); win, loss and draw ids are byte-identical; refused outside leagues with draws, in the
// rivalry series and on the fade side. Each layer is pinned here: ids, the keeper's count, the rule text and ticker, the dials (the
// launch page's choice), validateRule / lockRule and the catalogue.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { LEAGUES, PAIR_OUTCOMES, dedupeListings, gameSeries, outcomeHits, parseEspnSeries, teamIdOf, teamSeries, type EspnClient, type EspnSeries, type Game, type LeagueId, type Outcome } from "@/lib/burnticker/sources/espn";
import { sportsSettled, type GameDeps, type GameMarket } from "@/lib/burnticker/sources/gameSettle";
import { nativeSourceById } from "@/lib/burnticker/sources/native";
import { describeRule } from "@/lib/burnticker/describe";
import { teamTicker } from "@/lib/burnticker/tickers";
import { applyDial, dialsFor, PAIR_OUTCOME_LABEL, TEAM_RESULTS_LABEL } from "@/lib/burnticker/dials";
import { inverseRefusal } from "@/lib/burnticker/inverse";
import { lockRule, validateRule, type BurnRule } from "@/lib/burnticker/rules";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { countLastSeason } from "@/lib/burnticker/lastSeason";
import { firingOf } from "@/lib/burnticker/simulator";
import { teamDrainUnit } from "@/lib/burnticker/drain";
import { patternOptions, patternWords } from "@/lib/burnticker/guidedLaunch";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { FIELD_HELP } from "@/lib/burnticker/fieldHelp";

const ARS = teamIdOf("eng.1", "ARS")!;
const id = (o: Outcome, w = "s2026") => `espn.team:eng.1-ARS.${ARS}-${o}-${w}`;
const SEASON = { kind: "season", year: 2026 } as const;

describe("series ids", () => {
  test("win, loss and draw ids are byte-identical; two of three results is one new code in the same place", () => {
    assert.equal(teamSeries("eng.1", "ARS", "win", SEASON), `espn.team:eng.1-ARS.${ARS}-win-s2026`);
    assert.equal(teamSeries("eng.1", "ARS", "loss", SEASON), `espn.team:eng.1-ARS.${ARS}-loss-s2026`);
    assert.equal(teamSeries("eng.1", "ARS", "draw", SEASON), `espn.team:eng.1-ARS.${ARS}-draw-s2026`);
    assert.equal(teamSeries("eng.1", "ARS", "windraw", SEASON), `espn.team:eng.1-ARS.${ARS}-windraw-s2026`);
    assert.equal(teamSeries("nba", "LAL", "win", SEASON), `espn.team:nba-LAL.${teamIdOf("nba", "LAL")}-win-s2026`);
    for (const o of PAIR_OUTCOMES) assert.equal(parseEspnSeries(id(o))?.outcome, o, o);
    assert.equal(parseEspnSeries(gameSeries("eng.1", "740001", "ARS", "drawloss"))?.outcome, "drawloss", "one game takes two results too");
    assert.equal(parseEspnSeries(id("windraw", "perpetual"))?.kind, "team");
  });
  test("refused: a league without draws, the rivalry series, the 10-10 first form", () => {
    for (const o of PAIR_OUTCOMES) assert.equal(parseEspnSeries(`espn.team:nba-LAL.${teamIdOf("nba", "LAL")}-${o}-s2026`), null, `nba ${o}`);
    assert.equal(parseEspnSeries(gameSeries("nfl", "401", "KC", "winloss")), null);
    assert.equal(parseEspnSeries(`espn.team:eng.1-ARS.${ARS}-windraw-m2026.CHE.${teamIdOf("eng.1", "CHE")}`), null);
    assert.equal(parseEspnSeries("espn.team:nba-LAL-windraw"), null);
    assert.equal(parseEspnSeries(id("lossdraw" as Outcome)), null, "one spelling per set: win, draw, loss order");
  });
  test("a result is in the set: the keeper's one test", () => {
    const table: Record<Outcome, string> = { win: "win", draw: "tie", loss: "loss", windraw: "win tie", drawloss: "tie loss", winloss: "win loss" };
    for (const [o, hits] of Object.entries(table) as [Outcome, string][]) for (const r of ["win", "loss", "tie"] as const) assert.equal(outcomeHits(o, r), hits.split(" ").includes(r), `${o} on ${r}`);
  });
});

// ---- the keeper's count ----------------------------------------------------------------------------------------------------------

const ars = (date: string, home: number, away: number): Game => ({ eventId: date.replace(/-/g, ""), league: "eng.1", seasonType: 2, seasonYear: 2026, startsAt: `${date}T14:00:00Z`, date, name: "Leeds United at Arsenal", completed: true, state: "post", detail: "FT",
  home: { abbr: "ARS", id: ARS, name: "Arsenal", nickname: "Arsenal", short: "Arsenal", location: "Arsenal", score: home, homeAway: "home", record: null }, away: { abbr: "LEE", id: teamIdOf("eng.1", "LEE") ?? "", name: "Leeds United", nickname: "Leeds United", short: "Leeds", location: "Leeds United", score: away, homeAway: "away", record: null } });
const GAMES = [ars("2026-09-05", 2, 0), ars("2026-09-12", 1, 1), ars("2026-09-19", 0, 1)];
const tsdbBody = { events: GAMES.map((g) => ({ idEvent: g.eventId, strEvent: "Arsenal vs Leeds United", strHomeTeam: "Arsenal", strAwayTeam: "Leeds United", intHomeScore: String(g.home.score), intAwayScore: String(g.away.score), dateEvent: g.date, strTimestamp: `${g.date}T14:00:00`, strStatus: "FT" })) };
const client = { season: async () => dedupeListings(GAMES), get: async (u: string) => { throw new Error(`HTTP 404 ${u}`); }, tsdbRead: async () => tsdbBody } as unknown as EspnClient;
const legs = (d: string) => ({ home: `0x${"1".repeat(54)}${d.replace(/-/g, "")}`, draw: `0x${"2".repeat(54)}${d.replace(/-/g, "")}`, away: `0x${"3".repeat(54)}${d.replace(/-/g, "")}` });
const deps: GameDeps = {
  tsdbKey: "k", apiSportsKey: null,
  market: async (g) => { const l = legs(g.date); return { conditionId: l.home, question: "Arsenal FC vs. Leeds United FC", outcomes: ["Yes", "No"], url: `https://polymarket.com/event/epl-ars-lee-${g.date}`, threeWay: { ...l, homeName: "Arsenal FC", awayName: "Leeds United FC" } } satisfies GameMarket; },
  payout: async (cid) => { const g = GAMES.find((x) => cid.endsWith(x.date.replace(/-/g, "")))!; const w = g.home.score! > g.away.score! ? "1" : g.home.score === g.away.score ? "2" : "3"; return { resolved: true, outcome: cid.startsWith(`0x${w}`) ? 0 : 1 }; },
};

describe("the keeper counts a game whose result is in the creator's set as 1 unit", () => {
  for (const [o, want] of [["win", ["1", "0", "0"]], ["draw", ["0", "1", "0"]], ["loss", ["0", "0", "1"]], ["windraw", ["1", "1", "0"]], ["drawloss", ["0", "1", "1"]], ["winloss", ["1", "0", "1"]]] as [Outcome, string[]][]) {
    test(`${o}: a 2-0 win, a 1-1 draw and a 0-1 loss read ${want.join(", ")}`, async () => {
      const s: EspnSeries = { kind: "team", league: "eng.1", abbr: "ARS", teamId: ARS, outcome: o, window: { kind: "season", year: 2026 } };
      const r = await sportsSettled(client, s, null, deps, { nowMs: Date.parse("2026-09-25T00:00:00Z") });
      assert.deepEqual(r.refusals, []);
      assert.deepEqual(r.events.map((e) => e.value), want);
      assert.ok(r.events.every((e) => e.method === "onchain-payout+thesportsdb"), "settled on the three-way payout, confirmed by TheSportsDB");
    });
  }
  test("last season's count uses the same set", () => {
    const rule = firstPartyRule(id("windraw"), 0.02);
    assert.match(countLastSeason(rule, GAMES, 2026).lines?.[0] ?? (countLastSeason(rule, GAMES, 2026) as { sentence?: string }).sentence ?? "", /burned 2 times/);
  });
});

// ---- the words ---------------------------------------------------------------------------------------------------------------------

const cfg = loadCopyLintConfig();
const lint = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `"${t}"\n${formatHits(r)}`); };
const text = (o: Outcome, w = "s2026") => describeRule(firstPartyRule(id(o, w), 0.05), { ticker: "ARSX" });

describe("the rule text, the ticker and the review's words", () => {
  test("plain English for each set, lint-clean", () => {
    const wd = text("windraw"), dl = text("drawloss"), wl = text("winloss");
    assert.equal(wd.oneLiner, "burns when Arsenal win or draw");
    assert.equal(dl.oneLiner, "burns when Arsenal draw or lose");
    assert.equal(wl.oneLiner, "burns when Arsenal win or lose");
    assert.match(wd.ruleBlock, /For every Arsenal win or draw in the 2026–27 season,/);
    assert.match(wd.ruleBlock, /with a receipt on chain\. In other words, it burns on every match Arsenal do not lose\./);
    assert.match(wd.ruleBlock, /Nothing happens on a loss\./);
    assert.match(dl.ruleBlock, /every match Arsenal do not win\./); assert.match(dl.ruleBlock, /Nothing happens on a win\./);
    assert.match(wl.ruleBlock, /every match that does not end in a draw\./); assert.match(wl.ruleBlock, /Nothing happens on a draw\./);
    assert.deepEqual([wd.name, dl.name, wl.name], ["Arsenal 2026–27 Unbeaten", "Arsenal 2026–27 Winless", "Arsenal 2026–27 No Draws"]);
    const once = describeRule(firstPartyRule(gameSeries("eng.1", "740001", "ARS", "windraw"), 1), { ticker: "ARSX" });
    assert.match(once.name, /Arsenal Win or Draw/);
    assert.doesNotMatch(once.ruleBlock, /a draw burns nothing/, "a draw is in the set");
    for (const t of [wd, dl, wl, once, text("windraw", "perpetual"), text("drawloss", "n5.20261001")]) { lint(t.paragraph); lint(t.name); }
  });
  test("the single results read exactly as before", () => {
    assert.equal(text("win").oneLiner, "burns when Arsenal win");
    assert.equal(text("draw").oneLiner, "burns when Arsenal draw");
    assert.match(text("win").ruleBlock, /Nothing happens on a loss or a draw\./);
    assert.doesNotMatch(text("win").ruleBlock, /In other words/);
  });
  test("ticker: both results, never the fade side's NOLOSS", () => {
    assert.deepEqual((["windraw", "drawloss", "winloss"] as const).map((o) => teamTicker("TOT", { league: "eng.1", window: "season", outcome: o })), ["TOTWINDRAW", "TOTDL", "TOTWINLOSS"]);
    // a code shared with another league keeps its league tag first (tickers.ts): ARS is also in other leagues
    assert.equal(teamTicker("ARS", { league: "eng.1", window: "season", outcome: "windraw" }), "ARSEPLWD");
    assert.equal(teamTicker("TOT", { league: "eng.1", window: "season", outcome: "loss", inverse: true }), "TOTNOLOSS");
    assert.equal(teamTicker("TOT", { league: "eng.1", window: "season", outcome: "win" }), "TOTWIN");
    for (const o of PAIR_OUTCOMES) assert.match(teamTicker("ARS", { league: "eng.1", window: "next", games: 5, outcome: o }), /^[A-Z0-9]{3,10}$/);
  });
  test("the simulator, the drain line and the burn-step pattern say the set", () => {
    assert.equal(firingOf(firstPartyRule(id("windraw"))).firesOn, "a win or draw");
    assert.equal(firingOf(firstPartyRule(id("windraw"))).drawFires, true);
    assert.equal(firingOf(firstPartyRule(id("winloss"))).drawFires, false);
    assert.deepEqual(teamDrainUnit("drawloss"), { one: "draw or loss", many: "draws or losses" });
    const w = patternWords("every", { follow: "team", subject: "Arsenal", outcome: "windraw" });
    assert.equal(w.label, "After each Arsenal win or draw");
    lint(w.sentence); lint(PAIR_OUTCOME_LABEL.windraw); lint(TEAM_RESULTS_LABEL); lint(FIELD_HELP["team-results"].what); lint(FIELD_HELP["team-results"].does);
  });
});

// ---- the launch page's choice (the side dial), the fade side and the rule checks --------------------------------------------------

describe("the choice, the fade side and the checks", () => {
  test("a soccer team coin offers win, loss, draw and the three pairs; an NBA coin only win and loss", () => {
    const soccer = dialsFor(firstPartyRule(id("win")))?.side?.options.map((o) => o.value);
    assert.deepEqual(soccer, ["win", "loss", "draw", "windraw", "drawloss", "winloss"]);
    const nba = dialsFor(firstPartyRule(teamSeries("nba", "LAL", "win", SEASON)))?.side?.options.map((o) => o.value);
    assert.deepEqual(nba, ["win", "loss"]);
    assert.ok(Object.values(LEAGUES).every((l) => l.draws === (l.sport === "soccer")), "draws ⇔ soccer");
    assert.ok(Object.values(LEAGUES).every((l) => l.draws === l.id.includes(".")), "rules.ts's static check: every league with draws has a dot in its id, and only those");
  });
  test("picking two results drops the fade side and league mode; an NBA coin cannot take them", () => {
    const faded = applyDial(firstPartyRule(id("loss")), "inverse", "on");
    assert.equal(faded.inverse, true);
    const two = applyDial(faded, "side", "windraw");
    assert.equal(two.series, id("windraw"));
    assert.equal(two.inverse, undefined);
    assert.equal(dialsFor(two).inverse, null, "the fade side is not offered on two results");
    assert.equal(dialsFor(two).league, null, "nor league mode");
    const back = applyDial(two, "side", "draw");
    assert.equal(back.series, id("draw"));
    const nba = firstPartyRule(teamSeries("nba", "LAL", "win", SEASON));
    assert.equal(applyDial(nba, "side", "windraw").series, nba.series);
    assert.equal(applyDial(nba, "side", "draw").series, nba.series);
  });
  test("the fade side is refused on two results, in plain words; the burn step greys it with that reason", () => {
    const why = inverseRefusal({ oracle: "catalogue", kind: "scalar", series: id("windraw"), market: null, pair: null });
    assert.ok(why); lint(why!);
    assert.equal(inverseRefusal({ oracle: "catalogue", kind: "scalar", series: id("win"), market: null, pair: null }), null);
    const fade = patternOptions({ follow: "team", rule: firstPartyRule(id("windraw")), titleMarket: "none" } as Parameters<typeof patternOptions>[0]).options.find((o) => o.id === "fade");
    assert.equal(fade?.available, false);
    assert.equal(fade?.reason, why);
  });
  test("validateRule and lockRule accept two results in soccer and refuse them elsewhere", () => {
    const ok = lockRule(firstPartyRule(id("windraw")));
    assert.equal((ok.rule as BurnRule).series, id("windraw"));
    assert.equal(lockRule(firstPartyRule(id("win"))).sha256, lockRule(firstPartyRule(id("win"))).sha256);
    assert.throws(() => validateRule(firstPartyRule(`espn.team:nba-LAL.${teamIdOf("nba", "LAL")}-windraw-s2026`)), /two of the three results/);
    assert.throws(() => validateRule(firstPartyRule(gameSeries("nfl", "401", "KC", "winloss"))), /two of the three results/);
    assert.throws(() => validateRule(firstPartyRule(`espn.team:eng.1-ARS.${ARS}-windraw-m2026.CHE.${teamIdOf("eng.1", "CHE")}`)), /head-to-head/);
    assert.throws(() => validateRule({ ...firstPartyRule(id("windraw")), inverse: true }), /cannot be flipped/);
    assert.throws(() => validateRule({ ...firstPartyRule(id("windraw")), set: { id: "eng-1-2026-windraw", outcome: `ARS.${ARS}`, forwardBps: 10_000 }, onEnd: { windDownDays: 28, sweepThresholdLamports: 10_000_000 } }), /outcome set/);
  });
  test("the launch page shows the results choice for soccer team coins only, on the plain side, through the side dial", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/app/burnticker/launch/page.tsx", "utf8");
    const block = page.slice(page.indexOf("const resultsExtra"), page.indexOf("const resultsExtra") + 900);
    assert.match(block, /LEAGUES\[teamE\.league\]\.sport === "soccer"/);
    assert.match(block, /curPattern === "every" && !rule\.inverse/);
    assert.match(block, /teamE\.window\.kind !== "meetings"/);
    assert.match(block, /setDial\("side", e\.target\.value\)/);
    assert.match(page, /\{seasonExtra\}\{resultsExtra\}/);
  });
  test("the catalogue reads the series (the launch and registration check) and names the unit", () => {
    const src = nativeSourceById(id("windraw"));
    assert.ok(src);
    assert.equal(src!.unit.label, "1 win or draw");
    assert.equal(nativeSourceById(`espn.team:nba-LAL.${teamIdOf("nba", "LAL")}-windraw-s2026`), null);
    assert.equal(nativeSourceById(id("win"))!.unit.label, "1 win");
  });
});
