// TheSportsDB's round 500 is the preseason in every league it lists (espn.ts probe note, 2026-10-12). Every league read through
// TheSportsDB drops it: a preseason row never counts as a game, never appears in a rivalry meetings list and never moves a season
// window's end. One small synthetic season per league family (config/burnticker/fixtures/sports/tsdb/preseason.json): pro basketball,
// pro football, MLS and a European soccer league, college football and basketball. The NBA Cup final rule stays NBA-only. And the
// stated-source cross-check for an NBA market uses the one true wording (polyStated.ts). No network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EspnClient, NBA_FEED_WORDING, TSDB_PRESEASON_ROUND, gamesFor, meetingsPairSeries, ourTeam, parseEspnSeries, teamSeries, tsdbGames, tsdbScheduleUrl, windowStatus, type LeagueId } from "@/lib/burnticker/sources/espn";
import { STATED_PUBLISHERS } from "@/lib/burnticker/sources/polyStated";

type Row = Record<string, string>;
const FIX = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "config", "burnticker", "fixtures", "sports", "tsdb", "preseason.json"), "utf8")) as { leagues: Record<string, { family: string; body: { schedule: Row[] } }> };
const YEAR = 2026;
const NOW = Date.parse("2026-06-01T12:00:00Z");
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("TheSportsDB preseason rows never count, in every league family", () => {
  test("the fixture covers each family and each preseason row is round 500", () => {
    assert.deepEqual(Object.keys(FIX.leagues).sort(), ["cfb", "eng.1", "mcbb", "nfl", "usa.1", "wnba"]);
    for (const [l, f] of Object.entries(FIX.leagues)) assert.equal(f.body.schedule.filter((e) => Number(e.intRound) === TSDB_PRESEASON_ROUND).length, 2, l);
  });

  for (const [league, f] of Object.entries(FIX.leagues) as [LeagueId, (typeof FIX.leagues)[string]][]) test(`${f.family} (${league}): no preseason game in the season, the meetings list or the season window`, async () => {
    const rows = f.body.schedule;
    const pre = new Set(rows.filter((e) => Number(e.intRound) === TSDB_PRESEASON_ROUND).map((e) => e.idEvent));
    const a = ourTeam(league, rows[1].strHomeTeam)!, b = ourTeam(league, rows[1].strAwayTeam)!;
    assert.ok(a && b, `${league}: the fixture's teams resolve`);
    const url = tsdbScheduleUrl(league, YEAR);
    const c = new EspnClient({ fetchImpl: (async (u: string) => (u === url ? res(200, f.body) : res(404, {}))) as never, now: () => NOW, minIntervalMs: 0, ttlMs: 0, tsdbKey: "test-key" });
    assert.deepEqual(tsdbGames(league, f.body, YEAR).map((g) => g.eventId).filter((id) => pre.has(id)), [], "the parser drops round 500");
    const season = await c.season(league, a.abbr, YEAR);
    assert.equal(season.length, 2, `${league}: two regular games`);
    assert.ok(season.every((g) => !pre.has(g.eventId)));
    const pair = meetingsPairSeries(league, a.abbr, b.abbr, YEAR);
    const meetings = await gamesFor(c, parseEspnSeries(pair.a)!);
    assert.deepEqual(meetings.map((g) => g.eventId), [rows[1].idEvent], "the one regular meeting, never the two preseason ones");
    const sid = parseEspnSeries(teamSeries(league, a.abbr, "win", { kind: "season", year: YEAR }))!;
    const games = await gamesFor(c, sid);
    const w = windowStatus(sid, games, NOW);
    assert.equal(w.ended, true);
    assert.equal(w.lastGame?.eventId, rows[2].idEvent, "the window ends on the last regular game, not the later preseason row");
  });

  test("the NBA Cup final rule stays NBA-only: a December round-200 game counts in other leagues", () => {
    const row = (lg: string, h: string, a: string) => ({ schedule: [{ idEvent: "1", strHomeTeam: h, strAwayTeam: a, intRound: "200", strTimestamp: "2026-12-15T20:00:00", dateEvent: "2026-12-15", strStatus: "FT", intHomeScore: "2", intAwayScore: "1", idLeague: lg }] });
    assert.equal(tsdbGames("eng.1", row("4328", "Arsenal", "Aston Villa"), 2027).length, 1);
    assert.equal(tsdbGames("nba", row("4387", "New York Knicks", "San Antonio Spurs"), 2027).length, 0);
  });
});

describe("the stated-source cross-check for an NBA market", () => {
  test("names the NBA's feed truthfully, in the pinned wording", () => {
    assert.equal(NBA_FEED_WORDING, "the NBA's feed when it answers, otherwise TheSportsDB under licence");
    const nba = STATED_PUBLISHERS.find((p) => p.id === "nba")!;
    assert.equal(nba.crossRead, NBA_FEED_WORDING);
    assert.doesNotMatch(nba.crossRead, /official/);
  });
});
