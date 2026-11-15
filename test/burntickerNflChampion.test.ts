// THE SUPER BOWL END FOR NFL COINS (owner 2026-10-13). TheSportsDB numbers the NFL regular season 1–18 and the playoffs 125 / 150 / 160,
// the Super Bowl 200 (the 2025 season, read from the box that night: Patriots vs Seahawks 13–29 on 2026-02-08). A single-elimination
// bracket: the team that won its last postseason game, with nothing more listed, won the title.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CHAMPION_KNOWN, championOf, parseEspnSeries, teamSeries, tsdbGames, windowStatus, type Game } from "@/lib/burnticker/sources/espn";

const row = (id: string, date: string, round: number, home: string, away: string, hs: string, as: string) => ({ idEvent: id, strEvent: `${home} vs ${away}`, strHomeTeam: home, strAwayTeam: away, intHomeScore: hs, intAwayScore: as, dateEvent: date, strTime: "20:00:00", strTimestamp: `${date}T20:00:00`, strStatus: "FT", intRound: String(round), strSeason: "2025" });
const SEASON = { events: [
  row("1", "2025-09-07", 1, "Seattle Seahawks", "San Francisco 49ers", "13", "17"),
  row("2", "2026-01-04", 18, "Seattle Seahawks", "Los Angeles Rams", "20", "10"),
  row("3", "2026-01-18", 125, "Seattle Seahawks", "San Francisco 49ers", "41", "6"),
  row("4", "2026-01-25", 150, "Seattle Seahawks", "Los Angeles Rams", "31", "27"),
  row("5", "2026-02-08", 200, "New England Patriots", "Seattle Seahawks", "13", "29"),
  row("6", "2026-01-04", 18, "Kansas City Chiefs", "Las Vegas Raiders", "30", "27"),
] };

describe("the NFL champion path", () => {
  test("TheSportsDB rounds: 1–18 are the regular season, 100–499 the postseason", () => {
    const games = tsdbGames("nfl", SEASON, 2025);
    assert.deepEqual(games.map((g) => [g.eventId, g.seasonType]), [["1", 2], ["2", 2], ["3", 3], ["4", 3], ["5", 3], ["6", 2]]);
  });
  test("the NFL is a champion-known league; the Super Bowl winner reads true, the loser false, a team out in the regular season false", () => {
    assert.ok(CHAMPION_KNOWN.has("nfl"));
    const games = tsdbGames("nfl", SEASON, 2025);
    const series = (abbr: string) => parseEspnSeries(teamSeries("nfl", abbr, "win", { kind: "season", year: 2025 })) as Extract<ReturnType<typeof parseEspnSeries>, { kind: "team" }>;
    const sb = games.find((g) => g.eventId === "5")!, wk18kc = games.find((g) => g.eventId === "6")!;
    assert.equal(championOf(series("SEA"), sb), true);
    assert.equal(championOf(series("NE"), sb), false);
    assert.equal(championOf(series("KC"), wk18kc), false, "a regular-season last game: not the champion");
    const ws = windowStatus(series("SEA"), games.filter((g) => /Seahawks/.test(g.name)), Date.parse("2026-03-01T00:00:00Z"));
    assert.equal(ws.ended, true); assert.equal(ws.champion, true); assert.equal(ws.championDate, "2026-02-08");
  });
});
