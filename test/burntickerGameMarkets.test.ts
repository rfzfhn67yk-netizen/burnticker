// Launch walkthrough (2026-10-13): the Polymarket game-market lookup the launch check and the keeper use (gameSettle.ts
// polymarketGameReaders). Launch night: the capped text search missed the week's NFL moneyline (fixed by the end-date window). The
// walkthrough: an MLB game event ends a week after the game (mlb-cle-tb-2026-10-12 ends 2026-10-20), so the end-date window and the
// 2-day end-date match missed every MLB game; the lookup now reads the events by their scheduled start and matches on the market's own
// game start. Two games of one playoff series on consecutive days resolve to the nearer one.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { polymarketGameReaders } from "@/lib/burnticker/sources/gameSettle";
import { eventsStartingUrl, marketHit, parseGammaMarket, parseEventsBody, searchHits } from "@/lib/burnticker/oracle/polymarket";
import type { Game, GameSide } from "@/lib/burnticker/sources/espn";

const side = (abbr: string, name: string, nickname: string, homeAway: "home" | "away"): GameSide => ({ abbr, name, nickname, score: null, homeAway, record: null, location: name.replace(` ${nickname}`, "") });
const mlbGame = (startsAt: string): Game => ({ eventId: "x", league: "mlb", startsAt, date: startsAt.slice(0, 10), name: "Cleveland Guardians at Tampa Bay Rays", completed: false, state: "pre", detail: "", home: side("TB", "Tampa Bay Rays", "Rays", "home"), away: side("CLE", "Cleveland Guardians", "Guardians", "away") });
/** A Gamma MLB game event as Gamma serves it: the event and its markets end a week after the game; gameStartTime is the game. */
const gammaMlb = (slug: string, start: string, end: string, conditionId: string) => ({
  slug, title: "Guardians vs. Rays", closed: false, endDate: end, startTime: start, tags: [{ slug: "mlb", label: "MLB" }],
  markets: [
    { conditionId, question: "Cleveland Guardians vs. Tampa Bay Rays", outcomes: '["Cleveland Guardians", "Tampa Bay Rays"]', sportsMarketType: "moneyline", endDate: end, gameStartTime: start.replace("T", " ").replace("Z", "+00"), active: true, closed: false },
    { conditionId: `${conditionId.slice(0, -1)}f`, question: "Spread: Tampa Bay Rays (-1.5)", outcomes: '["Tampa Bay Rays", "Cleveland Guardians"]', sportsMarketType: "spreads", endDate: end, gameStartTime: start.replace("T", " ").replace("Z", "+00"), active: true, closed: false },
  ],
});
const hits = (events: unknown[]) => searchHits(parseEventsBody(events), { status: "all", perEvent: 40 });
const G1 = gammaMlb("mlb-cle-tb-2026-10-12", "2026-10-13T00:00:00Z", "2026-10-20T00:00:00Z", "0x" + "a".repeat(64));
const G2 = gammaMlb("mlb-cle-tb-2026-10-13", "2026-10-13T22:00:00Z", "2026-10-21T00:00:00Z", "0x" + "b".repeat(64));

describe("the game-market lookup", () => {
  test("Gamma's gameStartTime is parsed onto the market and carried on the search hit", () => {
    const m = parseGammaMarket(G1.markets[0])!;
    assert.equal(m.gameStartTime, "2026-10-13T00:00:00Z");
    assert.equal(marketHit(m).gameStartTime, "2026-10-13T00:00:00Z");
    assert.equal("gameStartTime" in marketHit(parseGammaMarket({ conditionId: "0x1", question: "q", outcomes: '["Yes","No"]' })!), false, "no key when Gamma gives no start");
    assert.match(eventsStartingUrl("mlb", "2026-10-12T12:00:00.000Z", "2026-10-13T12:00:00.000Z"), /tag_slug=mlb&start_time_min=2026-10-12T12%3A00%3A00.000Z&start_time_max=2026-10-13T12%3A00%3A00.000Z/);
  });

  test("an MLB game whose event ends a week later is found by its scheduled start, not missed", async () => {
    const asked: string[] = [];
    const poly = {
      eventsStarting: async (slug: string, min: string, max: string) => { asked.push(`start ${slug} ${min} ${max}`); return hits([G1]); },
      // what the end-date window returns for the same game: nothing (the event ends 2026-10-20)
      eventsInWindow: async (slug: string) => { asked.push(`end ${slug}`); return hits([]); },
      search: async () => { asked.push("search"); return hits([]); },
      readChain: async () => ({ resolved: false, outcome: null }),
    };
    const m = await polymarketGameReaders(poly).market!(mlbGame("2026-10-13T00:00:00Z"));
    assert.equal(m?.conditionId, "0x" + "a".repeat(64));
    assert.deepEqual(m?.outcomes, ["Cleveland Guardians", "Tampa Bay Rays"]);
    assert.deepEqual(asked, ["start mlb 2026-10-12T12:00:00.000Z 2026-10-13T12:00:00.000Z"], "found on the first read; the spread market is never picked");
  });

  test("the old reads alone (end date) find nothing for the MLB game, so the start read is what fixes it", async () => {
    const poly = { eventsInWindow: async () => hits([]), search: async () => hits([G1]), readChain: async () => ({ resolved: false, outcome: null }) };
    // the text search does list the event; the match now uses the market's game start, so even this path finds it
    const m = await polymarketGameReaders(poly).market!(mlbGame("2026-10-13T00:00:00Z"));
    assert.equal(m?.conditionId, "0x" + "a".repeat(64));
  });

  test("two games of one series on consecutive days: each game gets its own market, never the other day's", async () => {
    const poly = { eventsStarting: async () => hits([G2, G1]), search: async () => hits([]), readChain: async () => ({ resolved: false, outcome: null }) };
    const r = polymarketGameReaders(poly);
    assert.equal((await r.market!(mlbGame("2026-10-13T00:00:00Z")))?.conditionId, "0x" + "a".repeat(64));
    assert.equal((await r.market!(mlbGame("2026-10-13T22:00:00Z")))?.conditionId, "0x" + "b".repeat(64));
  });

  test("an NFL event (ends at kickoff, no start read answering) is still found by the end-date window", async () => {
    const nfl = { slug: "nfl-kc-lv-2026-10-04", title: "Chiefs vs. Raiders", closed: true, endDate: "2026-10-04T20:25:00Z", tags: [{ slug: "nfl", label: "NFL" }], markets: [{ conditionId: "0x" + "c".repeat(64), question: "Chiefs vs. Raiders", outcomes: '["Chiefs", "Raiders"]', sportsMarketType: "moneyline", endDate: "2026-10-04T20:25:00Z", active: true, closed: true }] };
    const g: Game = { eventId: "y", league: "nfl", startsAt: "2026-10-04T20:25:00Z", date: "2026-10-04", name: "Kansas City Chiefs at Las Vegas Raiders", completed: true, state: "post", detail: "", home: side("LV", "Las Vegas Raiders", "Raiders", "home"), away: side("KC", "Kansas City Chiefs", "Chiefs", "away") };
    const poly = { eventsStarting: async () => { throw new Error("Gamma did not answer"); }, eventsInWindow: async () => hits([nfl]), search: async () => hits([]), readChain: async () => ({ resolved: true, outcome: 0 }) };
    assert.equal((await polymarketGameReaders(poly).market!(g))?.conditionId, "0x" + "c".repeat(64));
  });

  test("a market more than 2 days from the game is never matched", async () => {
    const poly = { eventsStarting: async () => hits([G1]), search: async () => hits([G1]), readChain: async () => ({ resolved: false, outcome: null }) };
    assert.equal(await polymarketGameReaders(poly).market!(mlbGame("2026-10-16T00:00:00Z")), null);
  });
});

