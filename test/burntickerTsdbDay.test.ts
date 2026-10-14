// THESPORTSDB BY DAY (launch night 2026-10-13): v2 search/event answers "No data found" for every league, so the keeper reads the day
// listing (teams + scores, no status) and then the event lookup (status FT, kickoff). Rows below are the real Oct 4 Chiefs at Raiders
// answers, read from the box that night.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { settleGame, tsdbDayMatch, tsdbFinalByDay, tsdbV1DayUrl, tsdbV2DayUrl, tsdbV2EventUrl, type GameDeps } from "@/lib/burnticker/sources/gameSettle";
import type { EspnClient, Game } from "@/lib/burnticker/sources/espn";

const side = (abbr: string, name: string, nickname: string, location: string) => ({ abbr, name, nickname, location, short: nickname }) as unknown as Game["home"];
const KC_AT_LV = { eventId: "401", league: "nfl", seasonType: 2, startsAt: "2026-10-04T20:25:00Z", date: "2026-10-04", name: "Chiefs at Raiders", completed: true, state: "post", detail: "Final", home: side("LV", "Las Vegas Raiders", "Raiders", "Las Vegas"), away: side("KC", "Kansas City Chiefs", "Chiefs", "Kansas City") } as unknown as Game;
const DAY_ROW = { idEvent: "2475433", strEvent: "Las Vegas Raiders vs Kansas City Chiefs", strHomeTeam: "Las Vegas Raiders", strAwayTeam: "Kansas City Chiefs", intHomeScore: "27", intAwayScore: "30", dateEvent: "2026-10-04", idHomeTeam: "134932", idAwayTeam: "134931", strSeason: "2026" };
const OTHER_ROW = { idEvent: "2600737", strEvent: "Portland Winterhawks vs Spokane Chiefs", strHomeTeam: "Portland Winterhawks", strAwayTeam: "Spokane Chiefs", intHomeScore: "1", intAwayScore: "3", dateEvent: "2026-10-04" };
const LOOKUP_ROW = { ...DAY_ROW, strTime: "20:25:00", strTimestamp: "2026-10-04T20:25:00", strStatus: "FT", strPostponed: "no", strLeague: "NFL" };

function fakeClient(answers: Record<string, unknown>, calls: string[] = []): EspnClient {
  return { tsdbRead: async (_key: string, v2: string) => { calls.push(v2); if (!(v2 in answers)) throw new Error(`HTTP 404 ${v2}`); return answers[v2]; } } as unknown as EspnClient;
}

describe("TheSportsDB by day", () => {
  test("the day listing's row is matched by both team names and the date; a rugby 'Chiefs' row is not it", () => {
    assert.equal(tsdbDayMatch(KC_AT_LV, { filter: [OTHER_ROW, DAY_ROW] })?.idEvent, "2475433");
    assert.equal(tsdbDayMatch(KC_AT_LV, { filter: [OTHER_ROW] }), null);
    assert.equal(tsdbDayMatch({ ...KC_AT_LV, date: "2026-10-05", startsAt: "2026-10-05T01:15:00Z" } as Game, { filter: [DAY_ROW] })?.idEvent, "2475433", "a late game lands on the day before, UTC");
  });
  test("day listing then event lookup: the final is FT 27–30, read from the two v2 answers", async () => {
    const calls: string[] = [];
    const c = fakeClient({ [tsdbV2DayUrl("2026-10-04")]: { filter: [OTHER_ROW, DAY_ROW] }, [tsdbV2EventUrl("2475433")]: { lookup: [LOOKUP_ROW] } }, calls);
    const f = await tsdbFinalByDay(c, "k", KC_AT_LV);
    assert.deepEqual([f?.done, f?.home, f?.away], [true, 27, 30]);
    assert.deepEqual(calls, [tsdbV2DayUrl("2026-10-04"), tsdbV2EventUrl("2475433")]);
    assert.match(tsdbV1DayUrl("k", "2026-10-04"), /eventsday\.php\?d=2026-10-04$/);
  });
  test("a listing without the game: null, and the day before is tried once", async () => {
    const calls: string[] = [];
    const c = fakeClient({ [tsdbV2DayUrl("2026-10-04")]: { filter: [OTHER_ROW] }, [tsdbV2DayUrl("2026-10-03")]: { filter: [] } }, calls);
    assert.equal(await tsdbFinalByDay(c, "k", KC_AT_LV), null);
    assert.deepEqual(calls, [tsdbV2DayUrl("2026-10-04"), tsdbV2DayUrl("2026-10-03")]);
  });
  test("settleGame: the on-chain payout and the day listing agree → settled by two operators; the name search is never needed", async () => {
    const calls: string[] = [];
    const c = fakeClient({ [tsdbV2DayUrl("2026-10-04")]: { filter: [DAY_ROW] }, [tsdbV2EventUrl("2475433")]: { lookup: [LOOKUP_ROW] } }, calls);
    const d: GameDeps = { tsdbKey: "k", apiSportsKey: null, market: async () => ({ conditionId: "0xe605", question: "Chiefs vs. Raiders", outcomes: ["Chiefs", "Raiders"], url: "https://polymarket.com/event/nfl-kc-lv-2026-10-04" }), payout: async () => ({ resolved: true, outcome: 0 }) };
    const v = await settleGame(c, KC_AT_LV, d);
    assert.equal(v.kind, "settled", JSON.stringify(v));
    if (v.kind === "settled") { assert.equal(v.winner, "away"); assert.deepEqual(v.ops.sort(), ["TheSportsDB", "on-chain payout"]); }
    assert.ok(!calls.some((u) => /search\/event/.test(u)), "no name search");
  });
});
