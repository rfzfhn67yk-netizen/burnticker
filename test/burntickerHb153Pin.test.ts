// Reviewer G (publishes 102-105): HB-153 (dd7f0efb) changed TheSportsDB's postseason reading (strRound and intRound both, the 100-499
// band, the WNBA by game count) for every non-soccer league other than the NBA and the NFL, with no launch-date pin. A coin launched
// before that commit now keeps the reading it was launched under; the keeper passes the selector's earliest launch to the source.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { HB153_FROM_MS, clientBefore153, tsdbGames, withSeasonTypesBefore153, type EspnClient, type Game } from "@/lib/burnticker/sources/espn";
import { fetchDue, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { FeedState, TokenRow } from "@/lib/burnticker/registry";

const WNBA = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", "burnticker", "hourly-run14-wnba-teams.json"), "utf8")) as { teams: { name: string }[] };
const [A, B] = WNBA.teams.map((t) => t.name);
const row = (id: string, o: Record<string, unknown>) => ({ idEvent: id, strEvent: `${A} vs ${B}`, strHomeTeam: A, strAwayTeam: B, strTimestamp: "2026-09-21T23:00:00", dateEvent: "2026-09-21", strTime: "23:00:00", strStatus: "FT", intHomeScore: "80", intAwayScore: "70", idLeague: "4516", strSeason: "2026", ...o });

describe("reviewer G: the pre-HB-153 season types are kept and read for coins launched before it", () => {
  const games = tsdbGames("wnba", { schedule: [row("1", { strRound: "Play-in", intRound: "0" }), row("2", { strRound: "Finals", intRound: "0" }), row("3", { intRound: "0" })] }, 2026);
  test("a round HB-153 newly reads as postseason carries the old reading; one both read alike carries nothing", () => {
    const by = new Map(games.map((g) => [g.eventId, g]));
    assert.equal(by.get("1")!.seasonType, 3); assert.equal(by.get("1")!.seasonTypeBefore153, 2, "a play-in was regular season before HB-153");
    assert.equal(by.get("2")!.seasonType, 3); assert.equal(by.get("2")!.seasonTypeBefore153, undefined, "Finals read as postseason before and after");
    assert.equal(by.get("3")!.seasonType, 2); assert.equal(by.get("3")!.seasonTypeBefore153, undefined);
    assert.deepEqual(withSeasonTypesBefore153(games).map((g) => g.seasonType), [2, 3, 2]);
  });
  test("the client for a coin launched before it answers season() with the old types; the rest of the client is the same", async () => {
    const base = { season: async () => games, other: () => "same" } as unknown as EspnClient & { other(): string };
    const old = clientBefore153(base) as EspnClient & { other(): string };
    assert.deepEqual((await old.season("wnba", "x")).map((g: Game) => g.seasonType), [2, 3, 2]);
    assert.deepEqual((await base.season("wnba", "x")).map((g: Game) => g.seasonType), [3, 3, 2]);
    assert.equal(old.other(), "same");
    assert.equal(HB153_FROM_MS, Date.parse("2026-10-20T09:10:33Z"));
    assert.match(fs.readFileSync(path.join(import.meta.dirname, "..", "src/lib/burnticker/sources/gameSettle.ts"), "utf8"), /o\.launchedAtMs < HB153_FROM_MS \? clientBefore153\(client0\) : client0/);
  });
  test("the keeper passes the selector's earliest launch to the source", async () => {
    const seen: unknown[] = [];
    const feeds = new Map<string, FeedState>();
    const rule = { oracle: "catalogue", series: "espn.team:wnba-ATL-win-s2026" } as unknown as BurnRule;
    const registry = {
      feedState: (k: string): FeedState => feeds.get(k) ?? { selectorKey: k, lastFetchAt: null, lastOkAt: null, failures: 0, lastError: null, nextFetchAt: null },
      setFeedState: (s: FeedState) => { feeds.set(s.selectorKey, s); }, lockedRule: () => ({ rule }), lastReading: () => null, readings: () => [], receipt: () => null,
      getStatus: () => null, setStatus: () => {}, putReadings: () => 0, recordAlert: () => null, ruleEnd: () => null, pending: () => [],
    };
    const a = { id: "stub", settledSince: async (_r: unknown, _s: unknown, o: unknown) => { seen.push(o); return { events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }; } };
    const d = { registry, oracles: { kalshi: a, catalogue: a, polymarket: a }, attester: "k", log: () => {}, now: () => Date.parse("2026-10-21T00:00:00Z"), dryRun: true } as unknown as KeeperDeps;
    const tok = (mint: string, createdAt: number) => ({ selectorKey: "catalogue:espn.team:wnba-ATL-win-s2026", ticker: "T", mint, status: "live", baselineAt: "2026-05-01T00:00:00Z", createdAt } as unknown as TokenRow);
    await fetchDue(d, [tok("m1", HB153_FROM_MS + 5_000), tok("m2", HB153_FROM_MS - 5_000)]);
    assert.deepEqual(seen, [{ launchedAtMs: HB153_FROM_MS - 5_000 }]);
  });
});
