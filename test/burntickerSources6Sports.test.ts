// sources-6 (QA pass 9, 2026-10-13): the sports library items. #2 the one-game pair's home and away come from the fixture; #4 the one-game
// option offers every listed meeting this season and says what was searched; #5 team names match across "&" / "and", punctuation,
// accents and club words in every league TheSportsDB lists (no team with next=null while its fixture is listed); #15 generated names are
// never cut inside a team name; #27 the Scottish Premiership has 12 clubs; #28 college football lists the FBS by default, alphabetically;
// #29 team lists are alphabetical with conventional display codes and unchanged series pins; #35 a game being played is "Live now".
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EspnClient, LIVE_NOW, isLive, ourTeam, pickerTeams, teamByAbbr, teamsOf, teamSeries, tsdbGames, isLeague, teamNameKey, displayAbbr, type Game, type LeagueId } from "@/lib/burnticker/sources/espn";
import { sideMatches } from "@/lib/burnticker/sources/gameSettle";
import { FBS_TEAM_IDS } from "@/lib/burnticker/sources/fbs";
import { sportsGames, sportsRivalry, sportsTeams } from "@/lib/burnticker/api/handlers";
import { setNativeClients } from "@/lib/burnticker/sources/native";
import { meetingsListRows, meetingsPairNames, oneGameSearchLine, pairNames, seasonPairNames, shortTeamName, FBS_DEFAULT_LINE } from "@/lib/burnticker/guidedLaunch";
import { teamTicker } from "@/lib/burnticker/tickers";
import { fitName, utf8Bytes } from "@/lib/burnticker/launchFields";
import { capName, describeRule } from "@/lib/burnticker/describe";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { FILLER, fakeDeps, game, scheduleClient } from "./burntickerRivalrySeriesHelpers.ts";
import type { FetchLike } from "@/lib/burnticker/oracle/types";

const ROOT = path.join(import.meta.dirname, "..");
const cfg = loadCopyLintConfig();
const plain = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => h.phrase).join(", ")}: ${t}`); };
const TSDB_DIR = path.join(ROOT, "config/burnticker/fixtures/sports/tsdb");
const providerNames = (body: unknown): Set<string> => {
  const names = new Set<string>();
  const walk = (o: unknown): void => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { const r = o as Record<string, unknown>; if (typeof r.strHomeTeam === "string") { names.add(r.strHomeTeam); names.add(String(r.strAwayTeam)); } Object.values(r).forEach(walk); } };
  walk(body); return names;
};
/** A TheSportsDB client whose v2 schedule for `league` lists `events` (no network; a test key). */
function tsdbClient(league: LeagueId, events: Record<string, unknown>[], now: number): EspnClient {
  const fetchImpl: FetchLike = async (url) => (/api\/v2\/json\/schedule\/league\//.test(url) ? { ok: true, status: 200, json: async () => ({ schedule: events }) } : { ok: false, status: 404, json: async () => ({}) });
  return new EspnClient({ fetchImpl, now: () => now, minIntervalMs: 0, ttlMs: 0, tsdbKey: "test-key" });
}
const ev = (id: string, home: string, away: string, at: string, status = "NS") => ({ idEvent: id, strHomeTeam: home, strAwayTeam: away, strTimestamp: at, dateEvent: at.slice(0, 10), strStatus: status, intRound: "8" });

describe("QA pass 9 #5: team names match in every league TheSportsDB lists", () => {
  test("every team in every league fixture resolves to one of our teams (the UEFA qualifying rounds aside), and to the right one", () => {
    const misses: string[] = [];
    for (const f of fs.readdirSync(TSDB_DIR)) {
      const lg = f.replace(/\.json$/, "");
      if (!isLeague(lg) || lg.startsWith("uefa.")) continue;   // the UEFA fixtures carry qualifying-round clubs that are not in the competition proper
      for (const n of providerNames(JSON.parse(fs.readFileSync(path.join(TSDB_DIR, f), "utf8")))) if (!ourTeam(lg, n)) misses.push(`${lg}: ${n}`);
    }
    assert.deepEqual(misses, []);
    const is = (lg: LeagueId, n: string, abbr: string) => assert.equal(ourTeam(lg, n)?.abbr, abbr, `${lg} ${n}`);
    is("eng.1", "Brighton and Hove Albion", "BHA"); is("eng.1", "Brighton & Hove Albion", "BHA"); is("eng.1", "brighton  &  hove albion", "BHA");
    is("ita.1", "Inter Milan", "INT"); is("ita.1", "Milan", "MIL"); is("ita.1", "AC Milan", "MIL");
    is("sco.1", "Dundee United", "DDU"); is("sco.1", "Dundee", "DUN");
    is("usa.1", "DC United", "DC"); is("usa.1", "New York Red Bulls", "RBNY"); is("uefa.europa", "Union Saint-Gilloise", "USG");
    is("ger.1", "Köln", "KOE"); is("arg.1", "Gimnasia y Esgrima de La Plata", "GLP"); is("arg.1", "Gimnasia y Esgrima de Mendoza", "GMZ"); is("arg.1", "River Plate", "CARP");
    is("nba", "LA Clippers", "LAC");
    assert.equal(teamNameKey("Brighton & Hove Albion"), teamNameKey("Brighton and Hove Albion"));
    assert.equal(teamNameKey("Atlético de San Luis"), "atletico de san luis");
    // the settlement reader's match reads the same normal form
    assert.ok(sideMatches("Brighton and Hove Albion", { abbr: "BHA", name: "Brighton & Hove Albion", nickname: "Brighton & Hove Albion", short: "Brighton", location: "", score: null, homeAway: "home", record: null }));
  });
  test("the team picker shows Brighton's next game when TheSportsDB names the club with 'and'", async () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    setNativeClients({ espn: tsdbClient("eng.1", [ev("901", "Brighton and Hove Albion", "Leeds United", "2026-10-17T14:00:00"), ev("902", "Manchester City", "Arsenal", "2026-10-18T16:30:00")], now) });
    const r = await sportsTeams(null as never, { league: "eng.1" }, now);
    const teams = (r.body as { teams: { abbr: string; next: { opponent: string; home: boolean } | null }[] }).teams;
    const bha = teams.find((t) => t.abbr === "BHA")!;
    assert.ok(bha.next, "Brighton's next game is found");
    assert.deepEqual([bha.next!.opponent, bha.next!.home], ["Leeds United", true]);
    assert.ok(teams.find((t) => t.abbr === "LEE")!.next);
    const g = await sportsGames(null as never, { league: "eng.1" }, now);
    const rows = (g.body as { games: { a: { abbr: string; home: boolean }; b: { abbr: string; home: boolean } }[] }).games;
    assert.deepEqual(rows.map((x) => [x.a.abbr, x.a.home, x.b.abbr, x.b.home]), [["LEE", false, "BHA", true], ["ARS", false, "MNC", true]]);
    setNativeClients({ espn: null });
  });
});

describe("QA pass 9 #27, #28, #29: team lists", () => {
  test("#27 the Scottish Premiership lists 12 clubs, Dundee United among them", () => {
    assert.equal(teamsOf("sco.1").length, 12);
    assert.ok(teamByAbbr("sco.1", "DDU"));
  });
  test("#28 college football lists the 138 FBS programs by default, alphabetically; every division on request", () => {
    const fbs = pickerTeams("cfb");
    assert.equal(fbs.length, 138);
    assert.equal(FBS_TEAM_IDS.size, 138);
    assert.ok(fbs.every((t) => FBS_TEAM_IDS.has(t.id!)));
    assert.deepEqual(fbs.map((t) => t.name), [...fbs.map((t) => t.name)].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    for (const n of ["Alabama Crimson Tide", "Ohio State Buckeyes", "Notre Dame Fighting Irish", "UConn Huskies", "App State Mountaineers", "Charlotte 49ers", "Troy Trojans"]) assert.ok(fbs.some((t) => t.name === n), n);
    for (const n of ["Abilene Christian Wildcats", "Adams State Grizzlies", "Charlotte Saints", "Troy Vikings"]) assert.ok(!fbs.some((t) => t.name === n), n);
    assert.equal(pickerTeams("cfb", { division: "all" }).length, teamsOf("cfb").length);
    plain(FBS_DEFAULT_LINE(138, 620));
  });
  test("#28 GET /v1/sports/teams?league=cfb lists the FBS and says how to see the rest", async () => {
    setNativeClients({ espn: new EspnClient({ fetchImpl: (async () => ({ ok: false, status: 500, json: async () => ({}) })) as FetchLike, tsdbKey: null }) });
    const r = await sportsTeams(null as never, { league: "cfb" });
    const b = r.body as { teams: { name: string }[]; division: { shown: string; line: string }; order: string };
    assert.equal(b.teams.length, 138);
    assert.equal(b.division.shown, "fbs");
    assert.match(b.division.line, /^Showing the 138 FBS programs/);
    assert.equal(b.order, "alphabetical");
    const all = await sportsTeams(null as never, { league: "cfb", division: "all" });
    assert.ok((all.body as { teams: unknown[] }).teams.length > 300);
    setNativeClients({ espn: null });
  });
  test("#29 alphabetical lists; MCI and MUN shown, the MNC and MAN pins unchanged", async () => {
    setNativeClients({ espn: new EspnClient({ fetchImpl: (async () => ({ ok: false, status: 500, json: async () => ({}) })) as FetchLike, tsdbKey: null }) });
    for (const lg of ["eng.1", "mlb", "nba", "sco.1"] as LeagueId[]) {
      const r = await sportsTeams(null as never, { league: lg });
      const names = (r.body as { teams: { name: string }[] }).teams.map((t) => t.name);
      assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })), lg);
    }
    const r = await sportsTeams(null as never, { league: "eng.1" });
    const teams = (r.body as { teams: { abbr: string; code: string; ticker: string; series: { win: string } }[] }).teams;
    const city = teams.find((t) => t.abbr === "MNC")!, united = teams.find((t) => t.abbr === "MAN")!;
    assert.deepEqual([city.code, united.code], ["MCI", "MUN"]);
    assert.match(city.series.win, /^espn\.team:eng\.1-MNC\.382-win-s\d{4}$/, "the pin abbreviation in the series id does not move");
    assert.equal(teamSeries("eng.1", "MNC", "win", { kind: "season", year: 2026 }), "espn.team:eng.1-MNC.382-win-s2026");
    assert.match(city.ticker, /^MCI/); assert.match(united.ticker, /^MUN/);
    assert.equal(teamTicker("MNC", { league: "eng.1", window: "season", outcome: "win" }).slice(0, 3), "MCI");
    assert.equal(displayAbbr("ger.1", "MUN"), "BAY", "Bayern shows as BAY");
    assert.equal(displayAbbr("uefa.champions", "MAN"), "MUN");
    assert.notEqual(displayAbbr("uefa.champions", "MUN"), displayAbbr("uefa.champions", "MAN"), "two clubs never share a display code in one competition");
    for (const lg of Object.keys({ "eng.1": 1, "uefa.champions": 1, "ger.1": 1, "sco.1": 1 }) as LeagueId[]) {
      const codes = teamsOf(lg).map((t) => t.code ?? t.abbr);
      assert.equal(new Set(codes).size, codes.length, `${lg}: display codes are unique`);
    }
    setNativeClients({ espn: null });
  });
});

describe("QA pass 9 #35: a game being played is Live now", () => {
  test("TheSportsDB's in-play statuses read as in progress; a started game a feed has not marked final is live for the sport's usual length", () => {
    const now = Date.parse("2026-10-17T15:00:00Z");
    const games = tsdbGames("eng.1", { events: [ev("1", "Arsenal", "Chelsea", "2026-10-17T14:00:00", "2H"), ev("2", "Everton", "Fulham", "2026-10-17T14:00:00", "NS"), ev("3", "Leeds United", "Sunderland", "2026-10-17T11:00:00", "FT"), ev("4", "Liverpool", "Brentford", "2026-10-18T14:00:00", "NS")] }, 2026);
    const by = (id: string) => games.find((g) => g.eventId === id)!;
    assert.equal(by("1").state, "in");
    assert.deepEqual(["1", "2", "3", "4"].map((id) => isLive(by(id), now)), [true, true, false, false]);
    assert.equal(isLive({ ...by("2"), detail: "Postponed" }, now), false);
    assert.equal(isLive(by("2"), now + 3 * 3_600_000), false, "past a soccer match's length with no final: not said to be live");
    assert.equal(LIVE_NOW, "Live now");
  });
  test("the pickers say Live now; the meetings list says Live now for a game in progress", async () => {
    const now = Date.parse("2026-10-17T15:00:00Z");
    setNativeClients({ espn: tsdbClient("eng.1", [ev("1", "Arsenal", "Chelsea", "2026-10-17T14:00:00", "2H"), ev("4", "Liverpool", "Brentford", "2026-10-18T14:00:00", "NS")], now) });
    const g = await sportsGames(null as never, { league: "eng.1" }, now);
    assert.deepEqual((g.body as { games: { eventId: string; when: string | null }[] }).games.map((x) => [x.eventId, x.when]), [["1", "Live now"], ["4", null]]);
    const t = await sportsTeams(null as never, { league: "eng.1" }, now);
    const ars = (t.body as { teams: { abbr: string; next: { live: boolean; when: string | null } | null }[] }).teams.find((x) => x.abbr === "ARS")!;
    assert.deepEqual([ars.next!.live, ars.next!.when], [true, "Live now"]);
    setNativeClients({ espn: null });
    const rows = meetingsListRows([{ eventId: "1", startsAt: "2026-10-17T14:00:00Z", playoff: false, home: "ARS", away: "CHE", status: "in progress", result: "pending", live: true }], "ARS", "CHE");
    assert.equal(rows[0].state, "Live now");
  });
});

describe("QA pass 9 #2 and #4: the one-game pair, from every listed meeting, home and away from the fixture", () => {
  const NOW = Date.parse("2025-11-01T12:00:00Z");
  test("GET /v1/sports/rivalry offers every meeting still to be played as a one-game pair, with each side's selector and the real home side", async () => {
    // three PHI–BOS games: one at Boston in 10 days, one at Philadelphia in four months (well past the eight-day games list), one already final
    const games = [game("2025-10-25T23:00:00Z", "PHI", "BOS", 110, 100), game("2025-11-11T00:00:00Z", "BOS", "PHI", null, null, { status: 1 }), game("2026-03-03T00:00:00Z", "PHI", "BOS", null, null, { status: 1 }), ...FILLER];
    setNativeClients({ espn: scheduleClient(games, () => NOW), games: fakeDeps(games) });
    const r = await sportsRivalry(null as never, { league: "nba", a: "PHI", b: "BOS" }, NOW);
    const b = r.body as { meetings: { eventId: string; home: string; oneGame: { aHome: boolean; series: { aLoss: string; bLoss: string } } | null }[]; oneGame: { label: string; searched: string; count: number } };
    const open = b.meetings.filter((m) => m.oneGame);
    assert.equal(open.length, 2, "both games still to be played are offered, not only the ones in the next eight days");
    assert.deepEqual(open.map((m) => [m.home, m.oneGame!.aHome]), [["BOS", false], ["PHI", true]], "PHI is away at Boston and at home in Philadelphia, as the fixture lists them");
    for (const m of open) { assert.equal(m.oneGame!.series.aLoss, `espn.game:nba-${m.eventId}-PHI-loss`); assert.equal(m.oneGame!.series.bLoss, `espn.game:nba-${m.eventId}-BOS-loss`); }
    assert.equal(b.oneGame.count, 2);
    assert.equal(b.oneGame.searched, "Searched the league's schedule for the 2025–26 season, playoffs included. It lists 2 games between them still to be played. Pick the one the coins follow.");
    plain(b.oneGame.searched); plain(oneGameSearchLine("2026–27", 1, false)); plain(oneGameSearchLine("2026", 0, true));
    setNativeClients({ espn: null, games: null });
  });
  test("the rule text of a one-game coin says 'against' at home and 'away against' away, from the side the API marks", () => {
    const r = nativeRule("espn.game:nba-0022500002-PHI-loss", { fractionOfPool: 0.02 });
    const home = describeRule(r, { ticker: "PHIVBOS", game: { opponent: "Celtics", home: true, startsAt: "2026-03-03T00:00:00Z" } });
    const away = describeRule(r, { ticker: "PHIVBOS", game: { opponent: "Celtics", home: false, startsAt: "2026-03-03T00:00:00Z" } });
    assert.match(home.oneLiner, /lose against the Celtics$/); assert.match(away.oneLiner, /lose away against the Celtics$/);   // HB-162 (c) (hourly run 15)
  });
});

describe("QA pass 9 #15: generated names never stop inside a word or a team name", () => {
  test("a long matchup takes a complete shorter name", () => {
    const n = pairNames("Leeds United", "Manchester United");
    assert.deepEqual(n, { a: "Leeds United vs Man United", b: "Man United vs Leeds United" });
    const c = pairNames("Wolverhampton Wanderers", "Brighton & Hove Albion", { a: "WOL", b: "BHA" });
    for (const x of [c.a, c.b]) { assert.ok(utf8Bytes(x) <= 32, x); assert.doesNotMatch(x, /\b(vs|Man|Brighton &|Hove)$/); }
    assert.equal(c.a, "Wolves vs Brighton");
    assert.equal(c.b, "Brighton vs Wolves");
    const m = meetingsPairNames(teamByAbbr("eng.1", "LEE")!, teamByAbbr("eng.1", "MNC")!);
    assert.equal(m.a.name, "Leeds United vs Manchester City", "fits whole, so it is kept whole");
    assert.equal(m.a.ticker, "LEEVMCI", "the display code makes the ticker");
    assert.equal(shortTeamName("Manchester City"), "Man City");
    const s = seasonPairNames({ abbr: "WOL", nickname: "Wolverhampton Wanderers", name: "Wolverhampton Wanderers" }, { abbr: "BHA", nickname: "Brighton & Hove Albion", name: "Brighton & Hove Albion" }, 2026, "eng.1");
    // HB-85 (hourly run 6): the season in the name is the badge's own label (the Premier League season spans two years)
    assert.deepEqual([s.a.name, s.b.name], ["Wolves 2026–27 Losses", "Brighton 2026–27 Losses"]);
  });
  test("fitName and capName count bytes and cut only between words", () => {
    assert.equal(fitName(["A name far too long to fit in thirty-two bytes", "Short"]), "Short");
    assert.equal(fitName("Wikipedia daily views of an article about something"), "Wikipedia daily views");
    assert.equal(pairNames("Wolverhampton Wanderers", "Borussia Dortmund Reserves Team", { a: "WOL", b: "BVB" }).a, "Wolverhampton Wanderers vs BVB");
    assert.equal(capName("Wikipedia daily views of an article about something"), "Wikipedia daily views");
    assert.equal(capName("Árvíztűrő tükörfúrógép Árvíztűrő tükör"), "Árvíztűrő tükörfúrógép");
    assert.ok(utf8Bytes(capName("é".repeat(40))) <= 32);
  });
});
