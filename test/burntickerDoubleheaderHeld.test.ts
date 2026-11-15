// A HELD GAME HOLDS ITS DAY (2026-10-20). sportsSettled skipped a held game (a source disagreement) without holding its date, while
// meetingsSettled held it; so when game 2 of a doubleheader was held, the day was written with game 1's value alone, and when game 2
// settled later the day's value changed and putReadings threw RevisedReadingError, holding the feed. Also pinned: a listing stuck
// "in progress" past STUCK_LISTING_MS keeps its day held but is reported (a refusal → alert), without changing the next read.
// Fake MLB Stats API / TheSportsDB bodies as in burntickerSemantics.test.ts item 80. No network.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { dedupeListings, type EspnClient, type EspnSeries, type Game, type GameSide } from "@/lib/burnticker/sources/espn";
import { STUCK_LISTING_MS, sportsSettled, stuckListing } from "@/lib/burnticker/sources/gameSettle";
import { openRegistry, RevisedReadingError } from "@/lib/burnticker/registry";

const LAD: GameSide = { abbr: "LAD", name: "Los Angeles Dodgers", nickname: "Dodgers", short: "Dodgers", location: "Los Angeles", score: null, homeAway: "home", record: null };
const SD: GameSide = { abbr: "SD", name: "San Diego Padres", nickname: "Padres", short: "Padres", location: "San Diego", score: null, homeAway: "away", record: null };
const game = (eventId: string, startsAt: string, o: { home?: number | null; away?: number | null; completed?: boolean; state?: string; detail?: string } = {}): Game => ({ eventId, league: "mlb", seasonType: 2, seasonYear: 2026, startsAt, date: startsAt.slice(0, 10), name: "Padres at Dodgers", completed: o.completed ?? true, state: o.state ?? "post", detail: o.detail ?? "Final", home: { ...LAD, score: o.home ?? null }, away: { ...SD, score: o.away ?? null } });
const mlbBody = (games: { at: string; home: number | null; away: number | null }[]) => ({ dates: [{ games: games.map((g) => ({ gameDate: g.at, status: { abstractGameState: "Final" }, teams: { home: { team: { name: "Los Angeles Dodgers" }, score: g.home ?? undefined }, away: { team: { name: "San Diego Padres" }, score: g.away ?? undefined } } })) }] });
const tsdbBody = (events: { date: string; ts: string; home: number | null; away: number | null }[]) => ({ events: events.map((e) => ({ idEvent: e.ts, dateEvent: e.date, strTimestamp: e.ts, strEvent: "Los Angeles Dodgers vs San Diego Padres", strHomeTeam: "Los Angeles Dodgers", strAwayTeam: "San Diego Padres", idLeague: "4424", strStatus: "FT", intHomeScore: e.home === null ? null : String(e.home), intAwayScore: e.away === null ? null : String(e.away) })) });
function fakeClient(games: Game[], mlb: Record<string, unknown>, tsdb: unknown): EspnClient {
  return { season: async () => dedupeListings(games), get: async (url: string) => { if (url in mlb) return mlb[url]; throw new Error(`HTTP 404 for ${url}`); }, tsdbRead: async () => tsdb } as unknown as EspnClient;
}
const deps = { tsdbKey: "k", apiSportsKey: null, market: null, payout: null };
const WINS: EspnSeries = { kind: "team", league: "mlb", abbr: "LAD", teamId: null, outcome: "win", window: { kind: "season", year: 2026 } };
const day = (d: string) => `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${d}`;
const H = 3_600_000;

describe("a held game holds its day (doubleheader)", () => {
  const at1 = "2026-07-04T17:05:00Z", at2 = "2026-07-04T21:10:00Z";
  const games = [game("1", at1, { home: 4, away: 2 }), game("2", at2, { home: 6, away: 3 })];
  const mlb = { [day("2026-07-04")]: mlbBody([{ at: at1, home: 4, away: 2 }, { at: at2, home: 6, away: 3 }]) };
  // TheSportsDB first disagrees with the MLB Stats API on game 2 (scores swapped: a disagreement holds it), then agrees
  const tsdbHeld = tsdbBody([{ date: "2026-07-04", ts: at1.slice(0, 19), home: 4, away: 2 }, { date: "2026-07-04", ts: at2.slice(0, 19), home: 3, away: 6 }]);
  const tsdbAgreed = tsdbBody([{ date: "2026-07-04", ts: at1.slice(0, 19), home: 4, away: 2 }, { date: "2026-07-04", ts: at2.slice(0, 19), home: 6, away: 3 }]);

  test("game 2 held: no reading for the day (not game 1's value alone); game 2 settles later: one reading with both games, no revision", async () => {
    const reg = openRegistry(":memory:");
    const put = (events: Parameters<typeof reg.putReadings>[2]) => reg.putReadings("espn", "espn:LAD-wins", events, { settlementSourceUrl: null, attestedBy: ["t"] });
    const held = await sportsSettled(fakeClient(games, mlb, tsdbHeld), WINS, null, deps, { nowMs: Date.parse(at2) + 3 * H });
    assert.deepEqual(held.events, [], "the held game holds its whole day");
    assert.equal(held.refusals.length, 1, "the disagreement is reported");
    assert.match(held.refusals[0], /^2 Padres at Dodgers: .*held/);
    assert.equal(put(held.events), 0);
    const later = await sportsSettled(fakeClient(games, mlb, tsdbAgreed), WINS, null, deps, { nowMs: Date.parse(at2) + 4 * H });
    assert.deepEqual(later.events.map((e) => [e.id, e.value]), [["2026-07-04", "2"]], "both wins on the one reading");
    assert.match(later.events[0].title ?? "", /SD 2 @ LAD 4.*SD 3 @ LAD 6/);
    assert.doesNotThrow(() => put(later.events));
    assert.deepEqual(reg.readings("espn:LAD-wins").map((r) => [r.id, r.value]), [["2026-07-04", "2"]]);
    // the same reading again (the next cycle) is no revision
    assert.equal(put(later.events), 0);
  });

  test("what the old code did: writing game 1 alone and then both games is a revision the registry refuses", () => {
    const reg = openRegistry(":memory:");
    const ev = (value: string) => ({ id: "2026-07-04", at: "2026-07-04", result: null, value, title: "t", sourceUrl: "u" });
    reg.putReadings("espn", "espn:LAD-wins", [ev("1")], { settlementSourceUrl: null, attestedBy: ["t"] });
    assert.throws(() => reg.putReadings("espn", "espn:LAD-wins", [ev("2")], { settlementSourceUrl: null, attestedBy: ["t"] }), RevisedReadingError);
  });
});

describe("a listing stuck in progress", () => {
  const at1 = "2026-07-04T17:05:00Z", at2 = "2026-07-04T21:10:00Z";
  const stuckG2 = game("2", at2, { completed: false, state: "in", detail: "Top 7th" });
  const games = [game("1", at1, { home: 4, away: 2 }), stuckG2];
  const mlb = { [day("2026-07-04")]: mlbBody([{ at: at1, home: 4, away: 2 }]) };
  const tsdb = tsdbBody([{ date: "2026-07-04", ts: at1.slice(0, 19), home: 4, away: 2 }]);

  test("within 36 hours of its start: the day is held quietly", async () => {
    const t = Date.parse(at2) + 30 * H;
    const r = await sportsSettled(fakeClient(games, mlb, tsdb), WINS, null, deps, { nowMs: t });
    assert.deepEqual([r.events, r.refusals], [[], []]);
    assert.equal(r.dueAt, t + H, "the stale listing's hourly look");
  });

  test("past 36 hours: the day stays held (no reading a later final would revise), an alert is raised, and the hourly look goes on", async () => {
    const t = Date.parse(at2) + STUCK_LISTING_MS + H;
    const r = await sportsSettled(fakeClient(games, mlb, tsdb), WINS, null, deps, { nowMs: t });
    assert.deepEqual(r.events, []);
    assert.equal(r.refusals.length, 1);
    assert.match(r.refusals[0], /still lists this game in progress 37 hours after its start, so 2026-07-04 is held/);
    assert.equal(r.dueAt, t + H, "the alert does not change the next read");
    assert.equal(stuckListing(stuckG2, Date.parse(at2) + STUCK_LISTING_MS), null, "exactly 36 hours is not yet stuck");
  });
});
