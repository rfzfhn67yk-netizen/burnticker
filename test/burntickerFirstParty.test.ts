// FIRST-PARTY SOURCES WITH THEIR OWN CODE (2026-10-10): team coins and matchups (schedules from the leagues' official feeds or
// TheSportsDB, never ESPN; each game settled by two independent operators — sources/gameSettle.ts) and the NWS daily climate adapter,
// wired into the catalogue as native series. Frozen fixtures: config/burnticker/fixtures/sports/*, fixtures/espn/mlb.schedule.*, nws/*.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EspnClient, ScheduleUnavailable, findTeams, gameSeries, mlbGames, mlbTeamScheduleUrl, nbaGames, nhlGames, outcomeOf, parseEspnSeries, teamByAbbr, teamSeries, teamsOf, tsdbGames } from "@/lib/burnticker/sources/espn";
import { espnGameUrl } from "@/lib/burnticker/sources/gameSettle";
import { NwsClient, cliListUrl, nwsSeries, nwsSettled, parseCli, parseNwsSeries, productUrl, qualifies } from "@/lib/burnticker/sources/nws";
import { nativeRule, nativeRuleProblems, nativeSourceById, setNativeClients } from "@/lib/burnticker/sources/native";
import { CatalogueAdapter } from "@/lib/burnticker/catalogue";
import { isCatalogueSeries, validateRule } from "@/lib/burnticker/rules";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { fx } from "./burntickerHelpers.ts";

import { CLI, ESPN_NOW, F, IEM, espnFixtureClient, fakeGameDeps, nwsFixtureClient } from "./burntickerFirstPartyHelpers.ts";

describe("sports schedules and readers (no ESPN reads)", () => {
  test("the static team table per league; free-text team lookup", () => {
    assert.equal(teamsOf("nfl").length, 32); assert.equal(teamsOf("nba").length, 30); assert.equal(teamsOf("mlb").length, 30); assert.equal(teamsOf("nhl").length, 32);
    assert.equal(teamByAbbr("nfl", "JAC")?.abbr, "JAX"); assert.equal(teamByAbbr("nba", "GSW")?.abbr, "GS");
    assert.deepEqual(findTeams("Eagles win Sunday").map((t) => `${t.league}:${t.abbr}`), ["nfl:PHI"]);
    assert.equal(teamByAbbr("nfl", "PHI")?.ticker, "EAGLES");
  });

  test("series ids: catalogue-shaped, validated by the rule schema, round-trip", () => {
    for (const id of [teamSeries("nfl", "PHI", "win"), teamSeries("nhl", "BOS", "loss"), gameSeries("mlb", "849809", "LAD", "loss")]) {
      assert.ok(isCatalogueSeries(id), id);
      assert.doesNotThrow(() => validateRule(nativeRule(id)), `${id} validates`);
      assert.ok(parseEspnSeries(id), id);
    }
    assert.equal(parseEspnSeries("espn.team:nfl-ZZZ-win"), null, "unknown team");
    assert.equal(parseEspnSeries("espn.team:xfl-PHI-win"), null, "unknown league");
  });

  test("MLB's official schedule (StatsAPI): the Rays' 2026 season, regular season and postseason, a TBD opponent kept as TBD", () => {
    const games = mlbGames(F("sports/mlb.tb.2026.json").body);
    assert.equal(games.length, 174);
    const post = games.filter((g) => g.seasonType === 3);
    assert.equal(post.length, 10); assert.ok(games.every((g) => g.seasonYear === 2026));
    const g6 = games.find((g) => g.eventId === "849839")!;
    assert.deepEqual([g6.date, g6.home.abbr, g6.home.score, g6.away.abbr, g6.away.score, g6.completed], ["2026-10-06", "TB", 5, "NYY", 2, true]);
    assert.equal(g6.home.id, "30", "the series pin (the frozen team id), not a provider id");
    assert.equal(outcomeOf(g6, "TB"), "win"); assert.equal(outcomeOf(g6, "NYY"), "loss");
    assert.equal(outcomeOf({ ...g6, away: { ...g6.away, score: 5 } }, "TB"), "tie");
    const tbd = games.find((g) => g.eventId === "849820")!;
    assert.equal(tbd.away.abbr, "TBD"); assert.equal(tbd.completed, false); assert.equal(outcomeOf(tbd, "TB"), null);
    assert.match(mlbTeamScheduleUrl("TB", 2026), /teamId=139$/);
  });

  test("NHL and NBA official schedules parse; the other leagues need TheSportsDB's licensed key (never a fallback)", async () => {
    const nhl = nhlGames({ games: [{ id: 2026020101, season: 20262027, gameType: 2, startTimeUTC: "2026-10-12T23:00:00Z", gameState: "OFF", homeTeam: { abbrev: "EDM", commonName: { default: "Oilers" }, placeName: { default: "Edmonton" }, score: 4 }, awayTeam: { abbrev: "TBL", commonName: { default: "Lightning" }, placeName: { default: "Tampa Bay" }, score: 2 } }] });
    assert.deepEqual([nhl[0].home.abbr, nhl[0].away.abbr, nhl[0].seasonYear, nhl[0].completed], ["EDM", "TB", 2027, true]);
    const nba = nbaGames({ leagueSchedule: { seasonYear: "2026-27", gameDates: [{ games: [{ gameId: "0022600001", gameDateTimeUTC: "2026-10-21T23:30:00Z", gameStatus: 1, homeTeam: { teamTricode: "BOS", teamName: "Celtics", teamCity: "Boston", score: 0 }, awayTeam: { teamTricode: "LAL", teamName: "Lakers", teamCity: "Los Angeles", score: 0 } }, { gameId: "0012600001", gameDateTimeUTC: "2026-10-05T23:30:00Z", gameStatus: 3, homeTeam: { teamName: "Celtics", teamCity: "Boston" }, awayTeam: { teamName: "Lakers", teamCity: "Los Angeles" } }] }] } });
    assert.equal(nba.length, 1, "preseason (001…) is not a game a coin counts"); assert.deepEqual([nba[0].home.abbr, nba[0].away.abbr, nba[0].seasonType, nba[0].seasonYear], ["BOS", "LAL", 2, 2027]);
    const c = new EspnClient({ fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }), tsdbKey: null, minIntervalMs: 0, now: () => ESPN_NOW });
    assert.equal(c.scheduleAvailable("mlb"), true); assert.equal(c.scheduleAvailable("eng.1"), false);
    await assert.rejects(c.season("eng.1", "ARS"), (e: Error) => e instanceof ScheduleUnavailable && /schedule needs the licensed key/.test(e.message));
    const t = tsdbGames("eng.1", { schedule: [{ idEvent: "2271234", strEvent: "Arsenal vs Chelsea", strHomeTeam: "Arsenal", strAwayTeam: "Chelsea", intHomeScore: "2", intAwayScore: "2", dateEvent: "2026-10-18", strTimestamp: "2026-10-18T14:00:00", strStatus: "Match Finished" }] }, 2026);
    assert.deepEqual([t[0].home.abbr, t[0].away.abbr, t[0].completed, t[0].startsAt], ["ARS", "CHE", true, "2026-10-18T14:00:00Z"]);
  });

  test("no ESPN reads anywhere in the source: no fetch of ESPN's API; only the human scoreboard link remains", () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx|mts)$/.test(e.name) ? [path.join(d, e.name)] : []));
    const root = path.join(import.meta.dirname, "..");
    const hits = [...walk(path.join(root, "src")), ...walk(path.join(root, "scripts"))].filter((f) => /site\.api\.espn\.com|espn\.com\/apis|sports\.core\.api\.espn/.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(hits.map((f) => path.relative(root, f)), []);
    assert.equal(espnGameUrl("mlb", "2026-10-06"), "https://www.espn.com/mlb/scoreboard/_/date/20261006");
    assert.equal(espnGameUrl("eng.1", "2026-10-18"), "https://www.espn.com/soccer/scoreboard/_/date/20261018/league/eng.1");
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
    assert.match(r.events[0].title ?? "", /settled on the game's on-chain payout · confirmed by MLB's official feed · see this game on ESPN → https:\/\/www\.espn\.com\/mlb\/scoreboard\/_\/date\/20261003/);
    const info = await cat.seriesInfo(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 }));
    assert.match(info!.settlementSource!.name, /on-chain payout .* confirmed by MLB's official feed/); assert.doesNotMatch(info!.settlementSource!.name, /ESPN/);
    setNativeClients({ games: null });
    const src = nativeSourceById(nwsSeries("high", "DEN", 85))!;
    assert.deepEqual(nativeRuleProblems(src, { ...nativeRule(src.id), scalar: { unit: 2, perUnit: { fractionOfPool: 0.01 }, baseline: 0, direction: "up" } } as never), [`the unit must be 1 (1 qualifying day) for "${src.title}"`]);
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
    assert.equal(team.primary.operator, "Polymarket / UMA (Conditional Tokens on Polygon)", "the on-chain payout is primary A");
    // owner 2026-10-13: no past game is read at launch; the readers are proven on the next game and compared at the first one after launch
    assert.equal(team.crossRead?.id, "mlb.statsapi"); assert.equal(team.agreement, null);
    assert.equal(team.primary.lastReading, null); assert.match(team.agreementBasis, /readers for the next game/);
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
    assert.equal(ok.ok, true, JSON.stringify(ok.refusal)); assert.equal(ok.primary.lastReading, null, "launch reads no past game (owner 2026-10-13)");
    assert.match(ok.agreementBasis, /TheSportsDB and MLB's official feed/);
    // a score that disagrees is the keeper's hold at the first game after launch (settleGame), never a launch-time refusal any more
    setNativeClients({ espn: espnFixtureClient({ [url]: ev("3", "5") }), games: fakeGameDeps({ marketFor: () => false, tsdbKey: "TEST" }) });
    assert.equal((await preflightSelector(nativeRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 })), { now: ESPN_NOW })).ok, true);
    setNativeClients({ espn: null, games: null });
  });

  test("refusals: no primary; a payout that disagrees with the official feed; a league whose cross-read is missing; a stale station", async () => {
    const { preflightSelector } = await import("@/lib/burnticker/coverage/preflight");
    const TB = nativeRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 }));
    setNativeClients({ espn: espnFixtureClient(), games: fakeGameDeps({ marketFor: () => false }) });
    assert.equal((await preflightSelector(TB, { now: ESPN_NOW })).refusal?.code, "primary-unreadable", "no market and no TheSportsDB key: never read from ESPN");
    setNativeClients({ games: fakeGameDeps({ winner: () => "New York Yankees" }) });
    assert.equal((await preflightSelector(TB, { now: ESPN_NOW })).ok, true, "a past game's disagreement is not read at launch (owner 2026-10-13); the keeper holds it at the first game after launch");
    setNativeClients({ games: fakeGameDeps() });
    const nfl = await preflightSelector(nativeRule(teamSeries("nfl", "PHI", "win", { kind: "season", year: 2026 })), { now: ESPN_NOW });
    assert.equal(nfl.refusal?.code, "primary-unreadable"); assert.match(nfl.refusal!.reason, /the NFL schedule cannot be read on this site right now/, "no TheSportsDB key: no NFL schedule, never ESPN"); assert.doesNotMatch(nfl.refusal!.reason, /BURNTICKER_/, "no setting name reaches the page");
    const { operatorsFor } = await import("@/lib/burnticker/sources/gameSettle");
    const none = { tsdbKey: null, apiSportsKey: null, market: null, payout: null };
    assert.deepEqual(operatorsFor("eng.1", { ...none, tsdbKey: "K" }, false), ["TheSportsDB"], "a soccer game without a market and without API-Sports: one operator → refused");
    assert.deepEqual(operatorsFor("eng.1", { ...none, tsdbKey: "K" }, true), ["on-chain payout", "TheSportsDB"], "with a market the payout and TheSportsDB confirm each other");
    assert.deepEqual(operatorsFor("mlb", none, true), ["on-chain payout", "MLB's official feed"]);
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
