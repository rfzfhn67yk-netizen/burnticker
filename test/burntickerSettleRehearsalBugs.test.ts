// THE SEASON REHEARSAL'S SETTLEMENT BUGS (2026-10-13, report SEASON-REHEARSAL-2026-10-13.md, bugs 1–4). Every row below is a real answer
// read from the box (TheSportsDB with the licensed key, MLB StatsAPI) on 2026-10-14, trimmed to the fields the code reads. The games are
// built the way the keeper builds them: tsdbGames over TheSportsDB's row for the leagues it schedules, mlbGames over StatsAPI's for MLB.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { crossFinal, finalFromMlb, finalFromTsdb, mlbDays, rowOrientation, settleGame, sideMatches, tsdbDayCandidates, tsdbFinalByDay, tsdbV2DayUrl, tsdbV2EventUrl, type GameDeps } from "@/lib/burnticker/sources/gameSettle";
import { mlbGames, tsdbGames, tsdbScoreOrder, ourTeam, type EspnClient, type Game, type LeagueId } from "@/lib/burnticker/sources/espn";

type Row = Record<string, unknown>;
const EMPTY = (idEvent: string, strEvent: string, dateEvent: string): Row => ({ idEvent, strEvent, strHomeTeam: null, strAwayTeam: null, intHomeScore: null, intAwayScore: null, dateEvent });
const DAY = (r: Row): Row => { const { idLeague: _l, strLeague: _s, strSport: _p, strTimestamp: _t, strStatus: _u, ...day } = r; return day; };   // the v2 day listing carries none of these
const L = {
  hamburg: { idEvent: "2245775", strEvent: "Hamburg Cyclassics", strHomeTeam: null, strAwayTeam: null, intHomeScore: null, intAwayScore: null, dateEvent: "2025-08-17", idLeague: "4465", strLeague: "UCI World Tour", strSport: "Cycling", strTimestamp: "2025-08-17T00:00:00", strStatus: "FT" },
  patronato: { idEvent: "2191231", strEvent: "Patronato vs Arsenal de Sarandí", strHomeTeam: "Patronato", strAwayTeam: "Arsenal de Sarandí", intHomeScore: "1", intAwayScore: "0", dateEvent: "2025-08-17", idLeague: "4616", strLeague: "Argentinian Primera B Nacional", strSport: "Soccer", strTimestamp: "2025-08-17T19:00:00", strStatus: "FT" },
  tula: { idEvent: "2243936", strEvent: "Arsenal-2 Tula vs Rotor-2 Volgograd", strHomeTeam: "Arsenal-2 Tula", strAwayTeam: "Rotor-2 Volgograd", intHomeScore: "3", intAwayScore: "0", dateEvent: "2025-08-17", idLeague: "5219", strLeague: "Russia FNL 2 Group 3", strSport: "Soccer", strTimestamp: "2025-08-17T11:00:00", strStatus: "FT" },
  munArs: { idEvent: "2267081", strEvent: "Manchester United vs Arsenal", strHomeTeam: "Manchester United", strAwayTeam: "Arsenal", intHomeScore: "0", intAwayScore: "1", dateEvent: "2025-08-17", idLeague: "4328", strLeague: "English Premier League", strSport: "Soccer", strTimestamp: "2025-08-17T15:30:00", strStatus: "FT" },
  hylo: { idEvent: "2468789", strEvent: "Hylo Open 2025", strHomeTeam: null, strAwayTeam: null, intHomeScore: null, intAwayScore: null, dateEvent: "2025-10-28", idLeague: "5646", strLeague: "BWF World Tour", strSport: "Badminton", strTimestamp: "2025-10-28T00:00:00", strStatus: null },
  vaxjo: { idEvent: "2259024", strEvent: "Växjö Lakers vs Djurgårdens IF", strHomeTeam: "Växjö Lakers", strAwayTeam: "Djurgårdens IF", intHomeScore: "2", intAwayScore: "3", dateEvent: "2025-10-28", idLeague: "4419", strLeague: "Swedish Hockey League", strSport: "Ice Hockey", strTimestamp: "2025-10-28T18:00:00", strStatus: "AOT" },
  lalPor: { idEvent: "2357417", strEvent: "Los Angeles Lakers vs Portland Trail Blazers", strHomeTeam: "Los Angeles Lakers", strAwayTeam: "Portland Trail Blazers", intHomeScore: "108", intAwayScore: "122", dateEvent: "2025-10-28", idLeague: "4387", strLeague: "NBA", strSport: "Basketball", strTimestamp: "2025-10-28T02:30:00", strStatus: "FT" },
  angels: { idEvent: "2458720", strEvent: "Los Angeles Angels vs Los Angeles Dodgers", strHomeTeam: "Los Angeles Angels", strAwayTeam: "Los Angeles Dodgers", intHomeScore: "2", intAwayScore: "15", dateEvent: "2026-02-21", idLeague: "5863", strLeague: "MLB Spring Training", strSport: "Baseball", strTimestamp: "2026-02-21T20:10:00", strStatus: "FT" },
  southBay: { idEvent: "2378001", strEvent: "Texas Legends vs Coachella Valley Lakers", strHomeTeam: "Texas Legends", strAwayTeam: "South Bay Lakers", intHomeScore: "105", intAwayScore: "127", dateEvent: "2026-02-21", idLeague: "4388", strLeague: "NBA G League", strSport: "Basketball", strTimestamp: "2026-02-21T01:30:00", strStatus: "FT" },
  sdClippers: { idEvent: "2378002", strEvent: "San Diego Clippers vs Austin Spurs", strHomeTeam: "San Diego Clippers", strAwayTeam: "Austin Spurs", intHomeScore: "135", intAwayScore: "132", dateEvent: "2026-02-21", idLeague: "4388", strLeague: "NBA G League", strSport: "Basketball", strTimestamp: "2026-02-21T03:00:00", strStatus: "FT" },
  lalLac: { idEvent: "2358172", strEvent: "Los Angeles Lakers vs Los Angeles Clippers", strHomeTeam: "Los Angeles Lakers", strAwayTeam: "Los Angeles Clippers", intHomeScore: "125", intAwayScore: "122", dateEvent: "2026-02-21", idLeague: "4387", strLeague: "NBA", strSport: "Basketball", strTimestamp: "2026-02-21T03:00:00", strStatus: "FT" },
  phillies: { idEvent: "2388779", strEvent: "Philadelphia Phillies vs Miami Marlins", strHomeTeam: "Philadelphia Phillies", strAwayTeam: "Miami Marlins", intHomeScore: "4", intAwayScore: "1", dateEvent: "2026-08-19", idLeague: "4424", strLeague: "MLB", strSport: "Baseball", strTimestamp: "2026-08-19T22:05:00", strStatus: "FT" },
  phiMia: { idEvent: "2406993", strEvent: "Philadelphia Union vs Inter Miami", strHomeTeam: "Philadelphia Union", strAwayTeam: "Inter Miami", intHomeScore: "2", intAwayScore: "2", dateEvent: "2026-08-19", idLeague: "4346", strLeague: "American Major League Soccer", strSport: "Soccer", strTimestamp: "2026-08-19T23:30:00", strStatus: "FT" },
  miamiII: { idEvent: "2423365", strEvent: "Inter Miami II vs New England Revolution II", strHomeTeam: "Inter Miami II", strAwayTeam: "New England Revolution II", intHomeScore: "4", intAwayScore: "2", dateEvent: "2026-08-19", idLeague: "5279", strLeague: "MLS Next Pro", strSport: "Soccer", strTimestamp: "2026-08-19T23:00:00", strStatus: "FT" },
  sfTb0117: { idEvent: "2176956", strEvent: "San Francisco Giants vs Tampa Bay Rays", strHomeTeam: "San Francisco Giants", strAwayTeam: "Tampa Bay Rays", intHomeScore: "1", intAwayScore: "2", dateEvent: "2025-08-17", idLeague: "4424", strLeague: "MLB", strSport: "Baseball", strTimestamp: "2025-08-17T01:05:00", strStatus: "FT" },
  sfTb2017: { idEvent: "2176973", strEvent: "San Francisco Giants vs Tampa Bay Rays", strHomeTeam: "San Francisco Giants", strAwayTeam: "Tampa Bay Rays", intHomeScore: "7", intAwayScore: "1", dateEvent: "2025-08-17", idLeague: "4424", strLeague: "MLB", strSport: "Baseball", strTimestamp: "2025-08-17T20:05:00", strStatus: "FT" },
  yomiuri: { idEvent: "2223660", strEvent: "Yomiuri Giants vs Hanshin Tigers", strHomeTeam: "Yomiuri Giants", strAwayTeam: "Hanshin Tigers", intHomeScore: "1", intAwayScore: "3", dateEvent: "2025-08-17", idLeague: "4591", strLeague: "Nippon Baseball League", strSport: "Baseball", strTimestamp: "2025-08-17T04:00:00", strStatus: "FT" },
  ohio: { idEvent: "2294577", strEvent: "Ohio vs Ohio State", strHomeTeam: "Ohio State", strAwayTeam: "Ohio", intHomeScore: "9", intAwayScore: "37", dateEvent: "2025-09-13", idLeague: "4479", strLeague: "NCAA Division 1", strSport: "American Football", strTimestamp: "2025-09-13T23:00:00", strStatus: "FT" },
  duke: { idEvent: "2374562", strEvent: "Duke vs Texas", strHomeTeam: "Texas", strAwayTeam: "Duke", intHomeScore: "75", intAwayScore: "60", dateEvent: "2025-11-05", idLeague: "4607", strLeague: "NCAA Division I Basketball Mens", strSport: "Basketball", strTimestamp: "2025-11-05T01:45:00", strStatus: "FT" },
} satisfies Record<string, Row>;
// MLB StatsAPI's day pages (date=D lists games by their LOCAL date)
const mlbGame = (gamePk: number, gameDate: string, home: string, hs: number, away: string, as: number) => ({ gamePk, gameDate, gameType: "R", status: { abstractGameState: "Final", detailedState: "Final" }, teams: { home: { team: { name: home }, score: hs }, away: { team: { name: away }, score: as } } });
const ALCS1 = mlbGame(849820, "2026-10-13T00:00:00Z", "Tampa Bay Rays", 3, "Cleveland Guardians", 7);    // date=2026-10-12
const ALCS2 = mlbGame(849813, "2026-10-14T00:00:00Z", "Tampa Bay Rays", 3, "Cleveland Guardians", 1);    // date=2026-10-13
const ARI_0422 = mlbGame(778212, "2025-04-23T01:40:00Z", "Arizona Diamondbacks", 5, "Tampa Bay Rays", 1); // date=2025-04-22
const ARI_0423 = mlbGame(778199, "2025-04-24T01:40:00Z", "Arizona Diamondbacks", 6, "Tampa Bay Rays", 7); // date=2025-04-23
const SF_0816 = mlbGame(776711, "2025-08-17T01:05:00Z", "San Francisco Giants", 1, "Tampa Bay Rays", 2);  // date=2025-08-16
const SF_0817 = mlbGame(776703, "2025-08-17T20:05:00Z", "San Francisco Giants", 7, "Tampa Bay Rays", 1);  // date=2025-08-17
const page = (...games: unknown[]) => ({ dates: [{ games }] });
const mlbUrl = (d: string) => `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${d}`;

const tsdbGame = (league: LeagueId, r: Row, year = 2025): Game => { const g = tsdbGames(league, { events: [r] }, year)[0]; assert.ok(g, `no game from ${r.idEvent}`); return g; };
const mlbGameOf = (r: unknown): Game => mlbGames(page(r))[0];
/** A fake client: the day listings and event lookups by URL (each lookup is the real lookup row), MLB pages by URL; reads recorded. */
function client(tsdb: Record<string, unknown>, mlb: Record<string, unknown> = {}, calls: string[] = []): EspnClient {
  return {
    tsdbRead: async (_k: string, v2: string) => { calls.push(v2); if (!(v2 in tsdb)) throw new Error(`HTTP 404 ${v2}`); return tsdb[v2]; },
    get: async (url: string) => { calls.push(url); if (!(url in mlb)) throw new Error(`HTTP 404 for ${url}`); return mlb[url]; },
  } as unknown as EspnClient;
}
const lookups = (...rows: Row[]) => Object.fromEntries(rows.map((r) => [tsdbV2EventUrl(String(r.idEvent)), { lookup: [r] }]));
const dayOf = (date: string, ...rows: Row[]) => ({ [tsdbV2DayUrl(date)]: { filter: rows.map(DAY) } });

describe("bug 1: the day listing holds every sport", () => {
  test("an empty team name matches no side (\"\".includes is true for every key)", () => {
    const ars = tsdbGame("eng.1", L.munArs).away;
    assert.equal(sideMatches("", ars), false);
    assert.equal(sideMatches("Arsenal", ars), true);
  });
  test("Arsenal at Manchester United 2025-08-17: the cycling, Argentine and Russian rows are not candidates; the Premier League row settles 0–1", async () => {
    const g = tsdbGame("eng.1", L.munArs);
    assert.deepEqual([g.home.abbr !== "TBD", g.away.abbr !== "TBD"], [true, true], "both teams known to our table");
    const body = { filter: [L.hamburg, EMPTY("2372848", "BLAST Bounty Summer 2025 Grand Final", "2025-08-17"), L.patronato, L.tula, L.munArs].map(DAY) };
    assert.deepEqual(tsdbDayCandidates(g, body).map((r) => r.idEvent), ["2267081"]);
    const f = await tsdbFinalByDay(client({ ...dayOf("2025-08-17", L.hamburg, L.patronato, L.tula, L.munArs), ...lookups(L.munArs) }), "k", g);
    assert.deepEqual([f?.done, f?.home, f?.away], [true, 0, 1]);
  });
  test("Lakers 2025-10-28 (POR @ LAL): the badminton row and two hockey 'Lakers' are not it; the NBA row reads 108–122", async () => {
    const g = tsdbGame("nba", L.lalPor);
    const f = await tsdbFinalByDay(client({ ...dayOf("2025-10-28", L.hylo, L.vaxjo, L.lalPor), ...lookups(L.lalPor) }), "k", g);
    assert.deepEqual([f?.home, f?.away], [108, 122]);
  });
  test("Lakers 2026-02-21 (LAC @ LAL): the Angels–Dodgers spring game and two G League rows match no side by our team table", async () => {
    const g = tsdbGame("nba", L.lalLac, 2026);
    assert.equal(rowOrientation(g, "Los Angeles Angels", "Los Angeles Dodgers"), null, "by name alone 'Los Angeles' matched both");
    assert.deepEqual(tsdbDayCandidates(g, { filter: [L.angels, L.southBay, L.sdClippers, L.lalLac].map(DAY) }).map((r) => r.idEvent), ["2358172"]);
    const f = await tsdbFinalByDay(client({ ...dayOf("2026-02-21", L.angels, L.southBay, L.sdClippers, L.lalLac), ...lookups(L.lalLac) }), "k", g);
    assert.deepEqual([f?.home, f?.away], [125, 122]);
  });
  test("Inter Miami at Philadelphia Union 2026-08-19: Inter Miami II is not it; Phillies–Marlins passes the club-name table and is refused by its lookup's league (MLB 4424, not MLS 4346); the MLS row reads 2–2", async () => {
    const g = tsdbGame("usa.1", L.phiMia, 2026);
    // the soccer table reads "Philadelphia Phillies" as the Union and "Miami Marlins" as Inter Miami (one shared word each), so the
    // league check on the lookup is what refuses it
    assert.deepEqual(tsdbDayCandidates(g, { filter: [L.phillies, L.phiMia, L.miamiII].map(DAY) }).map((r) => r.idEvent), ["2388779", "2406993"]);
    const f = await tsdbFinalByDay(client({ ...dayOf("2026-08-19", L.phillies, L.miamiII, L.phiMia), ...lookups(L.phillies, L.phiMia) }), "k", g);
    assert.deepEqual([f?.home, f?.away, f?.done], [2, 2, true]);
    assert.match(String(f?.detail), /Philadelphia Union vs Inter Miami/);
  });
  test("a candidate whose event lookup names another league is never the game (the NBA's id is 4387, the G League's 4388)", async () => {
    const g = tsdbGame("nba", L.lalLac, 2026);
    const gLeague = { ...L.lalLac, idLeague: "4388", strLeague: "NBA G League" };
    assert.equal(await tsdbFinalByDay(client({ ...dayOf("2026-02-21", L.lalLac), ...dayOf("2026-02-20"), ...lookups(gLeague) }), "k", g), null);
  });
  test("a candidate whose lookup cannot be read is not counted (no league to check): null, the game waits", async () => {
    const g = tsdbGame("nba", L.lalLac, 2026);
    assert.equal(await tsdbFinalByDay(client({ ...dayOf("2026-02-21", L.lalLac), ...dayOf("2026-02-20") }), "k", g), null);
  });
});

describe("bug 2: two games of the same teams on one UTC date", () => {
  // Rays at Giants: 776711 (local 08-16, 01:05Z on 08-17) and 776703 (08-17 20:05Z); TheSportsDB lists both under 2025-08-17, no times
  const day = { ...dayOf("2025-08-17", L.yomiuri, L.sfTb0117, L.sfTb2017), ...lookups(L.yomiuri, L.sfTb0117, L.sfTb2017) };
  test("each game reads its own row by the lookup's start: 01:05Z → 2176956 (TB 2 SF 1), 20:05Z → 2176973 (TB 1 SF 7)", async () => {
    const night = mlbGameOf(SF_0816), afternoon = mlbGameOf(SF_0817);
    assert.equal(night.date, "2025-08-17");
    const calls: string[] = [];
    const f1 = await tsdbFinalByDay(client(day, {}, calls), "k", night), f2 = await tsdbFinalByDay(client(day), "k", afternoon);
    assert.deepEqual([f1?.home, f1?.away], [1, 2]);
    assert.deepEqual([f2?.home, f2?.away], [7, 1]);
    assert.deepEqual(calls.filter((u) => /lookup\/event/.test(u)).sort(), [tsdbV2EventUrl("2176956"), tsdbV2EventUrl("2176973")], "both candidates looked up once each; the Yomiuri row never");
  });
  test("a candidate more than 12 hours from the schedule's start is not the game", async () => {
    const g = { ...mlbGameOf(SF_0817), startsAt: "2025-08-18T12:00:00Z" } as Game;
    assert.equal(await tsdbFinalByDay(client({ ...day, ...dayOf("2025-08-16") }), "k", g), null);
  });
});

describe("bug 3: MLB StatsAPI lists games by their local date", () => {
  test("ALCS Game 1 (gamePk 849820, 2026-10-13T00:00Z): page 10-13 holds Game 2 and is refused; page 10-12 gives CLE 7 TB 3", async () => {
    const g = mlbGameOf(ALCS1);
    assert.equal(g.date, "2026-10-13");
    assert.equal(finalFromMlb(g, page(ALCS2), "u"), null, "never the nearest other game");
    const calls: string[] = [];
    const c = await crossFinal(client({}, { [mlbUrl("2026-10-13")]: page(ALCS2), [mlbUrl("2026-10-12")]: page(ALCS1) }, calls), g, { tsdbKey: null, apiSportsKey: null, market: null, payout: null }, "mlb.statsapi");
    assert.deepEqual([c.final?.home, c.final?.away, c.final?.done], [3, 7, true]);
    assert.deepEqual(calls, [mlbUrl("2026-10-13"), mlbUrl("2026-10-12")]);
  });
  test("Rays at Arizona 2025-04-23 01:40Z (gamePk 778212, TB 1 ARI 5): page 04-23's next-night game (TB 7 ARI 6) is refused", async () => {
    const g = mlbGameOf(ARI_0422);
    const c = await crossFinal(client({}, { [mlbUrl("2025-04-23")]: page(ARI_0423), [mlbUrl("2025-04-22")]: page(ARI_0422) }), g, { tsdbKey: null, apiSportsKey: null, market: null, payout: null }, "mlb.statsapi");
    assert.deepEqual([c.final?.home, c.final?.away], [5, 1]);
  });
  test("Rays at Giants 2025-08-17 01:05Z (gamePk 776711): page 08-17 lists only 776703 and is refused; page 08-16 gives TB 2 SF 1", async () => {
    const g = mlbGameOf(SF_0816);
    const c = await crossFinal(client({}, { [mlbUrl("2025-08-17")]: page(SF_0817), [mlbUrl("2025-08-16")]: page(SF_0816) }), g, { tsdbKey: null, apiSportsKey: null, market: null, payout: null }, "mlb.statsapi");
    assert.deepEqual([c.final?.home, c.final?.away], [1, 2]);
  });
  test("the gamePk matches even where a team name would not; a start more than 6 hours away never does", () => {
    const g = mlbGameOf(ALCS1);
    assert.equal(finalFromMlb(g, page({ ...ALCS1, teams: { home: { team: { name: "Rays" }, score: 3 }, away: { team: { name: "CLE" }, score: 7 } } }), "u")?.away, 7);
    assert.equal(finalFromMlb(g, page({ ...ALCS1, gameDate: "2026-10-13T07:00:00Z" }), "u"), null);
  });
  test("the pages read: the UTC date, the day before, and the day after only for a start within 4 hours of midnight UTC", () => {
    assert.deepEqual(mlbDays({ date: "2026-10-13", startsAt: "2026-10-13T00:00:00Z" }), ["2026-10-13", "2026-10-12"]);
    assert.deepEqual(mlbDays({ date: "2025-08-17", startsAt: "2025-08-17T20:05:00Z" }), ["2025-08-17", "2025-08-16", "2025-08-18"]);
  });
});

describe("bug 4: college rows whose scores follow the event's name", () => {
  test("Ohio at Ohio State 2025-09-13 (2294577): the schedule reads OSU 37 Ohio 9, and so does the final", () => {
    assert.equal(tsdbScoreOrder("cfb", L.ohio), "event");
    const g = tsdbGame("cfb", L.ohio);
    assert.deepEqual([g.home.abbr, g.home.score, g.away.abbr, g.away.score], [ourTeam("cfb", "Ohio State")?.abbr, 37, ourTeam("cfb", "Ohio")?.abbr, 9]);
    const f = finalFromTsdb(g, { events: [L.ohio] }, "u");
    assert.deepEqual([f?.home, f?.away, f?.done], [37, 9, true]);
  });
  test("Duke vs Texas 2025-11-05 (2374562): Duke 75 Texas 60, Duke in the away field", () => {
    const g = tsdbGame("mcbb", L.duke, 2026);
    const f = finalFromTsdb(g, { events: [L.duke] }, "u");
    assert.deepEqual([f?.home, f?.away], [60, 75]);
  });
  test("settleGame: the payout naming Ohio State and TheSportsDB now agree (it was held: 'Ohio State ≠ TheSportsDB Ohio vs Ohio State 9–37')", async () => {
    const g = tsdbGame("cfb", L.ohio);
    const d: GameDeps = { tsdbKey: "k", apiSportsKey: null, market: async () => ({ conditionId: "0x1", question: "Ohio vs. Ohio State", outcomes: ["Ohio", "Ohio State"], url: "u" }), payout: async () => ({ resolved: true, outcome: 1 }) };
    const v = await settleGame(client({ ...dayOf("2025-09-13", L.ohio), ...lookups(L.ohio) }), g, d);
    assert.equal(v.kind, "settled", JSON.stringify(v));
    if (v.kind === "settled") assert.deepEqual([v.winner, v.final], ["home", { home: 37, away: 9 }]);
  });
  test("a row whose home team is our away side is read crossed (the schedule from another feed)", () => {
    const g = tsdbGame("usa.1", L.phiMia, 2026);
    const crossed = { ...L.phiMia, strEvent: "Inter Miami vs Philadelphia Union", strHomeTeam: "Inter Miami", strAwayTeam: "Philadelphia Union", intHomeScore: "1", intAwayScore: "3" };
    const f = finalFromTsdb(g, { events: [crossed] }, "u");
    assert.deepEqual([f?.home, f?.away], [3, 1]);
  });
  test("a college row naming its teams in neither order (2331764 'Brown vs Georgetown', Robert Morris in the home field) is held, never settled", async () => {
    // the identity fields are the real row's; the status, time and scores are added for the test (the season listing has them blank)
    const row = { idEvent: "2331764", strEvent: "Brown vs Georgetown", strHomeTeam: "Robert Morris", strAwayTeam: "Georgetown", intHomeScore: "21", intAwayScore: "14", dateEvent: "2025-09-20", idLeague: "4479", strTimestamp: "2025-09-20T17:00:00", strStatus: "FT" };
    assert.equal(tsdbScoreOrder("cfb", row), "unknown");
    const g = tsdbGame("cfb", row);
    const d: GameDeps = { tsdbKey: "k", apiSportsKey: null, market: async () => ({ conditionId: "0x1", question: "Georgetown vs. Robert Morris", outcomes: ["Robert Morris", "Georgetown"], url: "u" }), payout: async () => ({ resolved: true, outcome: 0 }) };
    const v = await settleGame(client({ ...dayOf("2025-09-20", row), ...lookups(row) }), g, d);
    assert.equal(v.kind, "held", JSON.stringify(v));
    assert.match((v as { why: string }).why, /neither order/);
  });
  test("every other league keeps the field order where the event's name differs only in spelling ('Paris Saint-Germain' / 'Paris SG')", () => {
    assert.equal(tsdbScoreOrder("fra.1", { strEvent: "Nantes vs Paris Saint-Germain", strHomeTeam: "Nantes", strAwayTeam: "Paris SG" }), "fields");
    assert.equal(ourTeam("fra.1", "Paris SG")?.abbr, "PSG", "bug 5: TheSportsDB's 'Paris SG' is PSG, never Paris FC");
  });
});
