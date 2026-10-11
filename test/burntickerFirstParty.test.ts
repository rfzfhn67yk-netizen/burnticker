// FIRST-PARTY SOURCES WITH THEIR OWN CODE (2026-10-10): the ESPN scoreboard adapter (team coins and matchups without Kalshi; the
// second cross-read — NHL / MLB official feeds, TheSportsDB for NFL / NBA) and the NWS daily climate adapter (Weather), wired into the
// catalogue as native series. Frozen fixtures fetched 2026-10-10: config/burnticker/fixtures/espn/*, config/burnticker/fixtures/nws/*.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EspnClient, crossFromMlb, crossFromNhl, crossFromTsdb, espnSettled, findTeams, gameSeries, outcomeOf, parseEspnSeries, parseGames, scheduleUrl, scoreboardUrl, teamByAbbr, teamSeries, teamsOf, tsdbUrl, type Game } from "@/lib/burnticker/sources/espn";
import { NwsClient, cliListUrl, nwsSeries, nwsSettled, parseCli, parseNwsSeries, productUrl, qualifies } from "@/lib/burnticker/sources/nws";
import { nativeRule, nativeRuleProblems, nativeSourceById, setNativeClients } from "@/lib/burnticker/sources/native";
import { CatalogueAdapter } from "@/lib/burnticker/catalogue";
import { isCatalogueSeries, validateRule } from "@/lib/burnticker/rules";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { fx } from "./burntickerHelpers.ts";

import { CLI, ESPN_NOW, F, IEM, TSDB, espnFixtureClient, fakeGameDeps, nwsFixtureClient } from "./burntickerFirstPartyHelpers.ts";

describe("the ESPN scoreboard adapter", () => {
  test("the static team table per league, with ESPN's abbreviations; free-text team lookup", () => {
    assert.equal(teamsOf("nfl").length, 32); assert.equal(teamsOf("nba").length, 30); assert.equal(teamsOf("mlb").length, 30); assert.equal(teamsOf("nhl").length, 32);
    assert.equal(teamByAbbr("nfl", "JAC")?.abbr, "JAX", "Kalshi's JAC is ESPN's JAX"); assert.equal(teamByAbbr("nba", "GSW")?.abbr, "GS");
    assert.deepEqual(findTeams("Eagles win Sunday").map((t) => `${t.league}:${t.abbr}`), ["nfl:PHI"]);
    assert.equal(teamByAbbr("nfl", "PHI")?.ticker, "EAGLES");
  });

  test("series ids: catalogue-shaped, validated by the rule schema, round-trip", () => {
    for (const id of [teamSeries("nfl", "PHI", "win"), teamSeries("nhl", "BOS", "loss"), gameSeries("nfl", "401872981", "PHI", "loss")]) {
      assert.ok(isCatalogueSeries(id), id);
      assert.doesNotThrow(() => validateRule(nativeRule(id)), `${id} validates`);
      assert.ok(parseEspnSeries(id), id);
    }
    assert.equal(parseEspnSeries("espn.team:nfl-ZZZ-win"), null, "unknown team");
    assert.equal(parseEspnSeries("espn.team:xfl-PHI-win"), null, "unknown league");
  });

  test("a team schedule parses into games; outcomes from the final scores (ties are neither)", () => {
    const games = parseGames("nfl", F("espn/nfl.phi.schedule.json").body);
    const done = games.filter((g) => g.completed);
    assert.ok(done.length >= 4);
    const lar = games.find((g) => g.eventId === "401872970")!;
    assert.equal(lar.date, "2026-10-04"); assert.equal(lar.home.abbr, "PHI"); assert.equal(lar.away.score, 24);
    assert.equal(outcomeOf(lar, "PHI"), "loss"); assert.equal(outcomeOf(lar, "LAR"), "win");
    assert.equal(outcomeOf({ ...lar, home: { ...lar.home, score: 24 } }, "PHI"), "tie");
    assert.equal(outcomeOf(games.find((g) => !g.completed)!, "PHI"), null);
  });

  test("cross-reads: TheSportsDB / NHL / MLB agree on the same final, disagree on another, are unavailable when the game is missing", () => {
    const lar = parseGames("nfl", F("espn/nfl.phi.schedule.json").body).find((g) => g.eventId === "401872970")!;
    assert.equal(crossFromTsdb(lar, TSDB.body, "u").verdict, "agree");
    assert.equal(crossFromTsdb({ ...lar, away: { ...lar.away, score: 27 } }, TSDB.body, "u").verdict, "disagree");
    assert.equal(crossFromTsdb(lar, { event: null }, "u").verdict, "unavailable");
    const nhl = (F("espn/nhl.score.20261008.json").body as { games: { homeTeam: { name: { default: string }; score: number; abbrev: string }; awayTeam: { name: { default: string }; score: number; abbrev: string }; startTimeUTC: string }[] }).games[0];
    const g: Game = { eventId: "1", league: "nhl", startsAt: nhl.startTimeUTC, date: nhl.startTimeUTC.slice(0, 10), name: "", completed: true, state: "post", detail: "Final", home: { abbr: nhl.homeTeam.abbrev, name: "", nickname: nhl.homeTeam.name.default, score: nhl.homeTeam.score, homeAway: "home", record: null }, away: { abbr: nhl.awayTeam.abbrev, name: "", nickname: nhl.awayTeam.name.default, score: nhl.awayTeam.score, homeAway: "away", record: null } };
    assert.equal(crossFromNhl(g, F("espn/nhl.score.20261008.json").body, "u").verdict, "agree");
    assert.equal(crossFromNhl({ ...g, home: { ...g.home, score: 0 } }, F("espn/nhl.score.20261008.json").body, "u").verdict, "disagree");
    const mb = (F("espn/mlb.schedule.20261005.json").body as { dates: { games: { gameDate: string; teams: { home: { team: { name: string }; score: number }; away: { team: { name: string }; score: number } } }[] }[] }).dates[0].games[0];
    const m: Game = { ...g, league: "mlb", startsAt: mb.gameDate, date: mb.gameDate.slice(0, 10), home: { ...g.home, name: mb.teams.home.team.name, score: mb.teams.home.score }, away: { ...g.away, name: mb.teams.away.team.name, score: mb.teams.away.score } };
    assert.equal(crossFromMlb(m, F("espn/mlb.schedule.20261005.json").body, "u").verdict, "agree");
    assert.equal(crossFromMlb({ ...m, home: { ...m.home, score: 99 } }, F("espn/mlb.schedule.20261005.json").body, "u").verdict, "disagree");
  });

  test("settlement: only cross-read games are read; the others wait; a disagreement is held and reported", async () => {
    const lose = parseEspnSeries(teamSeries("nfl", "PHI", "loss"))!, win = parseEspnSeries(teamSeries("nfl", "PHI", "win"))!;
    const r = await espnSettled(espnFixtureClient(), lose, null, { nowMs: ESPN_NOW });
    assert.deepEqual(r.events.map((e) => [e.id, e.value]), [["2026-10-04", "1"]], "the LAR loss, the only game TheSportsDB's free key returns");
    assert.ok(r.awaitingFinal >= 3, "the earlier games wait for their cross-read");
    assert.match(r.events[0].title ?? "", /LAR 24 @ PHI 20 final .*TheSportsDB final 20–24/);
    const w = await espnSettled(espnFixtureClient(), win, null, { nowMs: ESPN_NOW });
    assert.deepEqual(w.events.map((e) => [e.id, e.value]), [["2026-10-04", "0"]], "a loss reads 0 for the win coin: no burn, a receipt of nothing");
    const lar = parseGames("nfl", F("espn/nfl.phi.schedule.json").body).find((g) => g.eventId === "401872970")!;
    const bad = await espnSettled(espnFixtureClient({ [tsdbUrl("123", lar)]: { event: [{ intHomeScore: "21", intAwayScore: "24", strStatus: "FT" }] } }), lose, null, { nowMs: ESPN_NOW });
    assert.equal(bad.events.length, 0); assert.match(bad.refusals[0], /401872970: TheSportsDB final 21–24 ≠ ESPN 20–24 — held/);
    const bt = await espnSettled(espnFixtureClient(), lose, null, { nowMs: ESPN_NOW, crossRead: false });
    assert.equal(bt.events.length, 4, "the back-test (display-grade) reads every final without the cross-read");
    const early = await espnSettled(espnFixtureClient(), lose, null, { nowMs: Date.parse("2026-10-04T19:00:00Z") });
    assert.ok(!early.events.some((e) => e.id === "2026-10-04"), "not read within 6 h of the start");
  });

  test("one game: only that event; the matchup's other side reads the opposite", async () => {
    const r = await espnSettled(espnFixtureClient(), parseEspnSeries(gameSeries("nfl", "401872970", "PHI", "loss"))!, null, { nowMs: ESPN_NOW, crossRead: false });
    assert.deepEqual(r.events.map((e) => e.value), ["1"]);
    const none = await espnSettled(espnFixtureClient(), parseEspnSeries(gameSeries("nfl", "401872981", "PHI", "loss"))!, null, { nowMs: ESPN_NOW });
    assert.equal(none.events.length, 0, "the JAX game has not been played");
  });
});

describe("the NWS daily climate adapter", () => {
  test("final reports only; values parsed from the CLI text (T = trace = 0)", () => {
    const days = Object.values(CLI.products).map((p) => parseCli(p.productText)!).filter(Boolean);
    const finals = days.filter((d) => d.final);
    assert.deepEqual(finals.map((d) => d.date).sort(), ["2026-10-08", "2026-10-09"]);
    const oct9 = finals.find((d) => d.date === "2026-10-09")!;
    assert.deepEqual([oct9.high, oct9.precip, oct9.snow, oct9.snowSeason], [86, 0, 0, 0]);
    assert.ok(days.some((d) => !d.final), "the 'VALID AS OF' reports are preliminary");
    assert.equal(parseCli("nothing here"), null);
  });

  test("thresholds: high ≥ X, rain ≥ X, the season's first snow", () => {
    const d = { date: "2026-11-02", high: 90, precip: 0.5, snow: 1.2, snowSeason: 1.2, final: true };
    assert.equal(qualifies({ metric: "high", station: "DEN", threshold: 90 }, d), true); assert.equal(qualifies({ metric: "high", station: "DEN", threshold: 91 }, d), false);
    assert.equal(qualifies({ metric: "rain", station: "DEN", threshold: 0.5 }, d), true);
    assert.equal(qualifies({ metric: "snow", station: "DEN", threshold: null }, d), true, "season total equals the day: the first snow");
    assert.equal(qualifies({ metric: "snow", station: "DEN", threshold: null }, { ...d, snowSeason: 3.4 }), false, "snow had already fallen this season");
    assert.equal(qualifies({ metric: "high", station: "DEN", threshold: 90 }, { ...d, high: null }), null, "MM → no reading");
  });

  test("series ids round-trip and validate; the client reads two final days from the fixture", async () => {
    for (const id of [nwsSeries("high", "DEN", 85), nwsSeries("rain", "DTW", 0.5), nwsSeries("snow", "DEN")]) { assert.ok(isCatalogueSeries(id), id); assert.doesNotThrow(() => validateRule(nativeRule(id)), id); assert.ok(parseNwsSeries(id), id); }
    assert.equal(nwsSeries("rain", "DTW", 0.5), "nws.rain:DTW-0.50");
    assert.equal(parseNwsSeries("nws.high:ZZZ-90"), null);
    const r = await nwsSettled(nwsFixtureClient(), parseNwsSeries("nws.high:DEN-85")!, null);
    assert.deepEqual(r.events.map((e) => [e.id, e.value]), [["2026-10-08", "0"], ["2026-10-09", "1"]], "84 °F does not reach 85; 86 °F does");
    assert.match(r.events[1].title ?? "", /Denver \(DIA\): high 86 °F → qualifies \(IEM ASOS max 85 °F\)/, "the cross-read agrees within 2 °F");
    const off = await nwsSettled(nwsFixtureClient({ [IEM.daily.url]: { data: [{ date: "2026-10-09", max_tmpf: 79, precip: 0 }, { date: "2026-10-08", max_tmpf: 84, precip: 0 }] } }), parseNwsSeries("nws.high:DEN-85")!, null);
    assert.deepEqual(off.events.map((e) => e.id), ["2026-10-08"]); assert.match(off.refusals[0], /2026-10-09: IEM ASOS max 79 °F vs NWS 86 °F \(> 2 °F apart\) — held/);
    const snow = await nwsSettled(nwsFixtureClient(), parseNwsSeries("nws.snow:DEN")!, null);
    assert.deepEqual(snow.events.map((e) => e.value), ["0", "0"], "no snow yet; IEM's parse of the same reports agrees");
  });
});

describe("native sources in the catalogue", () => {
  test("the adapter dispatches native series to their own reader; the unit/baseline/direction are fixed", async () => {
    setNativeClients({ espn: espnFixtureClient(), nws: nwsFixtureClient() });
    const cat = new CatalogueAdapter();
    setNativeClients({ games: fakeGameDeps() });
    const r = await cat.settledSince(nativeRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 })), "2026-09-30");
    assert.deepEqual(r.events.map((e) => [e.id, e.value]), [["2026-10-03", "1"], ["2026-10-06", "1"], ["2026-10-08", "1"]], "the three Rays postseason wins");
    assert.match(r.events[0].title ?? "", /settled on the game's on-chain payout · confirmed by MLB's official feed · see this game on ESPN → https:\/\/www\.espn\.com\/mlb\/game\/_\/gameId\/401907985/);
    const info = await cat.seriesInfo(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 }));
    assert.match(info!.settlementSource!.name, /on-chain payout .* confirmed by MLB's official feed/); assert.doesNotMatch(info!.settlementSource!.name, /ESPN/);
    setNativeClients({ games: null });
    const src = nativeSourceById(nwsSeries("high", "DEN", 85))!;
    assert.deepEqual(nativeRuleProblems(src, { ...nativeRule(src.id), scalar: { unit: 2, perUnit: { fractionOfPool: 0.01 }, baseline: 0, direction: "up" } } as never), ["unit must be 1 (1 qualifying day) for nws.high:DEN-85"]);
    await assert.rejects(cat.settledSince({ ...nativeRule(src.id), scalar: { unit: 1, perUnit: { fractionOfPool: 0.01 }, baseline: 5, direction: "up" } } as never, null), /baseline must be 0/);
    const cfg = loadCopyLintConfig();
    for (const id of [teamSeries("nfl", "PHI", "win"), gameSeries("nhl", "123456", "BOS", "loss"), nwsSeries("rain", "SEA", 1), nwsSeries("snow", "DEN")]) { const s = nativeSourceById(id)!; assert.ok(lintCopy(`${s.title}. ${s.unit.definition}`, cfg).ok, id); }
    setNativeClients({ espn: null, nws: null });
  });
});

describe("the creation preflight passes team coins, matchups and weather rules (coverage gate)", () => {
  test("a team coin passes: the game list from the schedule, primary A (the game's on-chain payout) confirmed by MLB's official feed", async () => {
    const { preflightSelector } = await import("@/lib/burnticker/coverage/preflight");
    setNativeClients({ espn: espnFixtureClient(), nws: nwsFixtureClient(), games: fakeGameDeps() });
    const team = await preflightSelector(nativeRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 })), { now: ESPN_NOW });
    assert.equal(team.ok, true, JSON.stringify(team.refusal));
    assert.equal(team.primary.operator, "TheSportsDB (commercial licence)", "the descriptor of record is the licensed primary; the game at hand settled on its payout");
    assert.equal(team.crossRead?.id, "mlb.statsapi"); assert.equal(team.agreement, true);
    assert.match(team.primary.lastReading?.value ?? "", /settled on: on-chain payout/);
    const wx = await preflightSelector(nativeRule(nwsSeries("high", "DEN", 85)), { now: ESPN_NOW });
    assert.equal(wx.ok, true, JSON.stringify(wx.refusal)); assert.equal(wx.crossRead?.operator, "Iowa Environmental Mesonet (Iowa State University)"); assert.equal(wx.agreement, true);
    setNativeClients({ espn: null, nws: null, games: null });
  });

  test("primary B: no market → TheSportsDB's licensed final, compared score for score with MLB's official feed", async () => {
    const { preflightSelector } = await import("@/lib/burnticker/coverage/preflight");
    const { tsdbV2Url } = await import("@/lib/burnticker/sources/gameSettle");
    const ev = (h: string, a: string) => ({ events: [{ strEvent: "New York Yankees vs Tampa Bay Rays", dateEvent: "2026-10-08", intHomeScore: h, intAwayScore: a, strStatus: "FT" }] });
    const url = tsdbV2Url(["New York Yankees", "Tampa Bay Rays"]);
    setNativeClients({ espn: espnFixtureClient({ [url]: ev("3", "4") }), games: fakeGameDeps({ marketFor: () => false, tsdbKey: "TEST" }) });
    const ok = await preflightSelector(nativeRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 })), { now: ESPN_NOW });
    assert.equal(ok.ok, true, JSON.stringify(ok.refusal)); assert.match(ok.primary.lastReading?.value ?? "", /settled on: TheSportsDB/);
    setNativeClients({ espn: espnFixtureClient({ [url]: ev("3", "5") }), games: fakeGameDeps({ marketFor: () => false, tsdbKey: "TEST" }) });
    assert.equal((await preflightSelector(nativeRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 })), { now: ESPN_NOW })).refusal?.code, "disagreement");
    setNativeClients({ espn: null, games: null });
  });

  test("refusals: no primary; a payout that disagrees with the official feed; a league whose cross-read is missing; a stale station", async () => {
    const { preflightSelector } = await import("@/lib/burnticker/coverage/preflight");
    const TB = nativeRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 }));
    setNativeClients({ espn: espnFixtureClient(), games: fakeGameDeps({ marketFor: () => false }) });
    assert.equal((await preflightSelector(TB, { now: ESPN_NOW })).refusal?.code, "primary-unreadable", "no market and no TheSportsDB key: never read from ESPN");
    setNativeClients({ games: fakeGameDeps({ winner: () => "New York Yankees" }) });
    assert.equal((await preflightSelector(TB, { now: ESPN_NOW })).refusal?.code, "disagreement");
    setNativeClients({ games: fakeGameDeps() });
    const nfl = await preflightSelector(nativeRule(teamSeries("nfl", "PHI", "win", { kind: "season", year: 2026 })), { now: ESPN_NOW });
    assert.equal(nfl.refusal?.code, "cross-read-unreadable"); assert.match(nfl.refusal!.reason, /cross-read missing .*BURNTICKER_APISPORTS_KEY/);
    setNativeClients({ nws: nwsFixtureClient() });
    assert.equal((await preflightSelector(nativeRule(nwsSeries("high", "DEN", 85)), { now: ESPN_NOW + 30 * 86_400_000 })).refusal?.code, "stale-primary");
    setNativeClients({ espn: null, nws: null, games: null });
  });
});

describe("the FEC adapter (receipts per report; synthetic rows in OpenFEC's shape until the frozen fixture lands)", () => {
  test("series ids, report pairing by coverage end, amendments superseded, the same-operator filing check", async () => {
    const { FecClient, fecSeries, fecSettled, filingAgrees, pairReports, parseFecSeries, parseReports } = await import("@/lib/burnticker/sources/fec");
    assert.equal(fecSeries("S6MI00418", "S4MI00595"), "fec.beats:S6MI00418-S4MI00595"); assert.ok(isCatalogueSeries(fecSeries("S6MI00418", "S4MI00595")));
    assert.deepEqual(parseFecSeries("fec.beats:S6MI00418-S4MI00595"), { a: "S6MI00418", b: "S4MI00595" }); assert.equal(parseFecSeries("fec.beats:S6MI00418-S6MI00418"), null);
    const rep = (c: string, end: string, receipts: number, file: number, mostRecent = true) => ({ committee_id: c, report_type: "Q2", coverage_start_date: "2026-04-01T00:00:00", coverage_end_date: `${end}T00:00:00`, receipt_date: "2026-07-15T00:00:00", total_receipts_period: receipts, file_number: file, most_recent: mostRecent });
    const A = { results: [rep("C00902668", "2026-06-30", 4_000_000, 11), rep("C00902668", "2026-03-31", 3_000_000, 10), rep("C00902668", "2026-03-31", 2_000_000, 9, false)] };
    const B = { results: [rep("C00849810", "2026-06-30", 5_000_000, 21), rep("C00849810", "2026-03-31", 2_500_000, 20)] };
    assert.equal(parseReports(A).length, 2, "the superseded version is dropped");
    assert.deepEqual(pairReports(parseReports(A), parseReports(B)).map((m) => [m.period, m.aBeats]), [["2026-03-31", true], ["2026-06-30", false]]);
    const fil = (file: number, receipts: number) => ({ file_number: file, total_receipts: receipts });
    assert.equal(filingAgrees(parseReports(A)[0], [fil(11, 4_000_000)].map((f) => ({ fileNumber: f.file_number, mostRecentFileNumber: null, receipts: f.total_receipts, coverageEnd: null, formType: "F3" }))), true);
    const table: Record<string, unknown> = {
      [FecClient.committeesPath("S6MI00418")]: { results: [{ committee_id: "C00902668" }] }, [FecClient.committeesPath("S4MI00595")]: { results: [{ committee_id: "C00849810" }] },
      [FecClient.reportsPath("C00902668", 2026)]: A, [FecClient.reportsPath("C00849810", 2026)]: B,
      [FecClient.filingsPath("C00902668", 2026)]: { results: [fil(10, 3_000_000), fil(11, 4_000_000)] }, [FecClient.filingsPath("C00849810", 2026)]: { results: [fil(20, 2_500_000), fil(21, 5_100_000)] },
    };
    const c = new FecClient({ apiKey: "TEST", minIntervalMs: 0, fetchImpl: async (url) => { const k = url.replace("https://api.open.fec.gov/v1", "").replace(/[?&]api_key=TEST$/, ""); return k in table ? { ok: true, status: 200, json: async () => table[k] } : { ok: false, status: 404, json: async () => ({}) }; } });
    const r = await fecSettled(c, { a: "S6MI00418", b: "S4MI00595" }, null, { cycle: 2026 });
    assert.deepEqual(r.events.map((e) => [e.id, e.value]), [["2026-03-31", "1"]]);
    assert.match(r.refusals[0], /2026-06-30: a report's receipts differ from its filing — held/, "B's Q2 filing says 5.1M, the report 5.0M");
    assert.ok(c.requests.every((u) => !u.includes("api_key")), "the key is never logged");
  });
});
