// ONE SOURCE IS ENOUGH (owner, 2026-10-14: "we need to fix the 2 verified sources issue. TheSportsDB should be enough to validate").
// A final game with no Polymarket market and no second operator that can read it settles on TheSportsDB alone once the same final score
// has stood for 12 hours across re-reads; the hold is persisted (statusHoldStore) and a changed score starts it again; where a counted
// league feed exists it must agree instead and no hold applies; the payout and TheSportsDB must still agree when both exist. A fake
// client serves TheSportsDB's day listing and MLB StatsAPI. No network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TSDB_LEAGUE, teamSeries, type EspnClient, type Game, type LeagueId } from "@/lib/burnticker/sources/espn";
import { HOLD_STATUS_KEY, SINGLE_SOURCE_HOLD_MS, SINGLE_SOURCE_SETTLED_BY, holdKeyOf, memoryHoldStore, settleGame, settledByOf, settledWords, singleSourceAlert, singleSourceHold, statusHoldStore, type GameDeps } from "@/lib/burnticker/sources/gameSettle";
import { PUSH_KIND_OF_ALERT, PUSH_LEAD, PUSH_TITLE } from "@/lib/burnticker/push";
import { SINGLE_SOURCE_LINE, sportsConfirmationLine } from "@/lib/burnticker/sources/provenance";
import { coinSourceNote } from "@/lib/burnticker/coinSourceLine";
import { settlementSections } from "@/lib/burnticker/settlementCopy";
import { NEXT_GAME_NOTES } from "@/lib/burnticker/sources/native";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const LAL = teamSeries("nba", "LAL", "win", { kind: "season", year: 2026 });
const T0 = Date.parse("2026-10-05T12:00:00Z");
const side = (abbr: string, name: string, nickname: string, homeAway: "home" | "away") => ({ abbr, name, nickname, score: null, homeAway, record: null });
const NFL = { eventId: "e1", league: "nfl", startsAt: "2026-10-04T20:25:00Z", date: "2026-10-04", name: "Kansas City Chiefs at Las Vegas Raiders", completed: true, state: "post", detail: "Final", home: side("LV", "Las Vegas Raiders", "Raiders", "home"), away: side("KC", "Kansas City Chiefs", "Chiefs", "away") } as unknown as Game;
const MLB = { eventId: "777", league: "mlb", startsAt: "2026-09-20T23:10:00Z", date: "2026-09-20", name: "Los Angeles Dodgers at San Francisco Giants", completed: true, state: "post", detail: "Final", home: side("SF", "San Francisco Giants", "Giants", "home"), away: side("LAD", "Los Angeles Dodgers", "Dodgers", "away") } as unknown as Game;

/** TheSportsDB's day listing (a complete row, so no event lookup) and MLB StatsAPI's day page, with scores the test can change. */
function fakeClient(score: { home: number; away: number }, o: { mlb?: { home: number; away: number } | null } = {}): EspnClient {
  const row = (g: Game) => ({ idEvent: `tsdb-${g.eventId}`, idLeague: TSDB_LEAGUE[g.league as LeagueId], dateEvent: g.date, strTimestamp: g.startsAt.replace("Z", ""), strHomeTeam: g.home.name, strAwayTeam: g.away.name, intHomeScore: String(score.home), intAwayScore: String(score.away), strStatus: "FT", strEvent: `${g.home.name} vs ${g.away.name}` });
  return {
    tsdbRead: async (_k: string, url: string) => (url.includes(`/day/${NFL.date}`) ? { events: [row(NFL)] } : url.includes(`/day/${MLB.date}`) ? { events: [row(MLB)] } : { events: [] }),
    get: async (url: string) => {
      if (!url.includes("statsapi.mlb.com")) throw new Error("HTTP 404");
      if (!o.mlb || !url.endsWith(MLB.date)) return { dates: [] };
      return { dates: [{ games: [{ gamePk: 777, gameDate: MLB.startsAt, status: { abstractGameState: "Final" }, teams: { home: { team: { name: MLB.home.name }, score: o.mlb.home }, away: { team: { name: MLB.away.name }, score: o.mlb.away } } }] }] };
    },
  } as unknown as EspnClient;
}
const deps = (o: Partial<GameDeps> = {}): GameDeps => ({ tsdbKey: "test-key", apiSportsKey: null, market: async () => null, payout: null, ...o });
/** A registry's status table, for the persistent store. */
const statusTable = () => { const m = new Map<string, string>(); return { m, getStatus: (k: string) => m.get(k) ?? null, setStatus: (k: string, v: unknown) => { m.set(k, typeof v === "string" ? v : JSON.stringify(v)); } }; };

describe("settlement on TheSportsDB alone after a 12-hour hold", () => {
  test("no market, no league feed: the first read starts the hold, a read before 12 hours waits, a read after settles on TheSportsDB alone", async () => {
    const holds = memoryHoldStore(); let now = T0;
    const d = deps({ holds, now: () => now });
    const c = fakeClient({ home: 27, away: 30 });
    const a = await settleGame(c, NFL, d);
    assert.equal(a.kind, "awaiting"); assert.match(a.kind === "awaiting" ? a.why : "", /first seen now/);
    assert.deepEqual(holds.get(holdKeyOf(NFL)), { home: 27, away: 30, firstSeenAt: T0 });
    now = T0 + SINGLE_SOURCE_HOLD_MS - 1;
    const b = await settleGame(c, NFL, d);
    assert.equal(b.kind, "awaiting"); assert.match(b.kind === "awaiting" ? b.why : "", /has stood since/);
    now = T0 + SINGLE_SOURCE_HOLD_MS;
    const v = await settleGame(c, NFL, d);
    assert.equal(v.kind, "settled");
    if (v.kind !== "settled") return;
    assert.equal(v.winner, "away"); assert.deepEqual(v.final, { home: 27, away: 30 }); assert.deepEqual(v.ops, ["TheSportsDB"]);
    assert.equal(v.singleSince, T0); assert.equal(v.settledBy, SINGLE_SOURCE_SETTLED_BY);
  });

  test("a score change during the hold starts it again from the new score", async () => {
    const holds = memoryHoldStore(); let now = T0;
    const d = deps({ holds, now: () => now });
    await settleGame(fakeClient({ home: 27, away: 30 }), NFL, d);
    now = T0 + 6 * 3_600_000;
    const r = await settleGame(fakeClient({ home: 27, away: 33 }), NFL, d);
    assert.equal(r.kind, "awaiting"); assert.match(r.kind === "awaiting" ? r.why : "", /changed its final from 30–27 to 33–27 .* starts again/);
    now = T0 + SINGLE_SOURCE_HOLD_MS + 1;
    assert.equal((await settleGame(fakeClient({ home: 27, away: 33 }), NFL, d)).kind, "awaiting", "12 hours from the FIRST sighting is not enough after a change");
    now = T0 + 6 * 3_600_000 + SINGLE_SOURCE_HOLD_MS;
    const v = await settleGame(fakeClient({ home: 27, away: 33 }), NFL, d);
    assert.equal(v.kind, "settled"); assert.deepEqual(v.kind === "settled" ? v.final : null, { home: 27, away: 33 });
  });

  test("the hold survives a restart: the store is the registry's status table, read fresh by a new store", async () => {
    const reg = statusTable();
    await settleGame(fakeClient({ home: 27, away: 30 }), NFL, deps({ holds: statusHoldStore(reg, () => T0), now: () => T0 }));
    assert.ok(reg.m.get(HOLD_STATUS_KEY)?.includes(holdKeyOf(NFL)));
    const later = T0 + SINGLE_SOURCE_HOLD_MS;
    const v = await settleGame(fakeClient({ home: 27, away: 30 }), NFL, deps({ holds: statusHoldStore(reg, () => later), now: () => later }));
    assert.equal(v.kind, "settled", "a new process (a new store over the same table) keeps the first-seen time");
  });

  test("without a hold store (the web, a one-off read) a TheSportsDB-only game waits and never settles", async () => {
    const h = singleSourceHold(null, NFL, { home: 1, away: 0 }, T0);
    assert.equal(h.ready, false);
    assert.equal((await settleGame(fakeClient({ home: 27, away: 30 }), NFL, deps({ now: () => T0 + 99 * SINGLE_SOURCE_HOLD_MS }))).kind, "awaiting");
  });

  test("a failed Polymarket lookup is not 'no market': the game waits and no hold starts", async () => {
    const holds = memoryHoldStore();
    const v = await settleGame(fakeClient({ home: 27, away: 30 }), NFL, deps({ holds, now: () => T0, market: async () => { throw new Error("Gamma 503"); } }));
    assert.equal(v.kind, "awaiting"); assert.match(v.kind === "awaiting" ? v.why : "", /lookup failed/);
    assert.equal(holds.get(holdKeyOf(NFL)), null);
  });

  test("the league's own feed agreeing settles at once with no hold; a disagreeing feed holds the game", async () => {
    const holds = memoryHoldStore();
    const v = await settleGame(fakeClient({ home: 3, away: 5 }, { mlb: { home: 3, away: 5 } }), MLB, deps({ holds, now: () => T0 }));
    assert.equal(v.kind, "settled");
    if (v.kind !== "settled") return;
    assert.deepEqual(v.ops, ["TheSportsDB", "mlb.statsapi"]); assert.equal(v.singleSince, undefined);
    assert.equal(v.settledBy, "TheSportsDB and MLB's official feed");
    assert.equal(holds.get(holdKeyOf(MLB)), null, "no hold is recorded where the league feed reads the game");
    const x = await settleGame(fakeClient({ home: 3, away: 5 }, { mlb: { home: 4, away: 5 } }), MLB, deps({ holds, now: () => T0 }));
    assert.equal(x.kind, "held");
    const w = await settleGame(fakeClient({ home: 3, away: 5 }, { mlb: null }), MLB, deps({ holds, now: () => T0 + 99 * SINGLE_SOURCE_HOLD_MS }));
    assert.equal(w.kind, "awaiting", "MLB's feed is counted, so a game it has not finalised waits for it rather than taking the hold");
  });

  test("with a market, the payout and TheSportsDB must still agree (unchanged)", async () => {
    const market = async () => ({ conditionId: "0xc", question: "Chiefs vs. Raiders", outcomes: ["Raiders", "Chiefs"] as [string, string], url: "https://polymarket.com/event/x" });
    const ok = await settleGame(fakeClient({ home: 27, away: 30 }), NFL, deps({ market, payout: async () => ({ resolved: true, outcome: 1 }) }));
    assert.equal(ok.kind, "settled"); assert.equal(ok.kind === "settled" ? ok.settledBy : "", "on-chain payout and TheSportsDB");
    const bad = await settleGame(fakeClient({ home: 27, away: 30 }), NFL, deps({ market, payout: async () => ({ resolved: true, outcome: 0 }) }));
    assert.equal(bad.kind, "held");
    const pending = await settleGame(fakeClient({ home: 27, away: 30 }), NFL, deps({ market, payout: async () => ({ resolved: false, outcome: null }), holds: memoryHoldStore(), now: () => T0 + 99 * SINGLE_SOURCE_HOLD_MS }));
    assert.equal(pending.kind, "awaiting", "a listed market whose payout is not in yet is waited for, never skipped by the hold");
  });

  test("the reading's words name the operators that settled it", async () => {
    const holds = memoryHoldStore(); let now = T0;
    const d = deps({ holds, now: () => now });
    await settleGame(fakeClient({ home: 27, away: 30 }), NFL, d);
    now += SINGLE_SOURCE_HOLD_MS;
    const v = await settleGame(fakeClient({ home: 27, away: 30 }), NFL, d);
    assert.equal(v.kind, "settled");
    if (v.kind !== "settled") return;
    assert.equal(settledWords(v), "settled on a licensed final score · TheSportsDB only, confirmed after a 12 h hold");
    assert.equal(settledByOf(["on-chain payout", "TheSportsDB"]), "on-chain payout and TheSportsDB");
    assert.equal(settledByOf(["on-chain payout", "TheSportsDB", "nhl.score"]), "on-chain payout, TheSportsDB and NHL's official scores");
  });
});

describe("the keeper's notice: bt-single-source the first time a coin settles on one source", () => {
  test("one alert per coin, remembered across restarts; the push kind is mapped and its words pass the lint", () => {
    const reg = statusTable(), cfg = loadCopyLintConfig();
    const e = { seriesId: teamSeries("nfl", "KC", "win", { kind: "season", year: 2026 }), game: NFL, final: { home: 27, away: 30 } };
    const a = singleSourceAlert(reg, e);
    assert.equal(a?.kind, "bt-single-source"); assert.equal(a?.key, `bt-single-source:${e.seriesId}`);
    assert.equal(singleSourceAlert(reg, e), null, "the same coin is not alerted twice");
    assert.notEqual(singleSourceAlert(reg, { ...e, seriesId: teamSeries("nfl", "LV", "win", { kind: "season", year: 2026 }) }), null, "another coin is");
    assert.equal(PUSH_KIND_OF_ALERT["bt-single-source"], "single-source");
    for (const t of [PUSH_TITLE["single-source"], PUSH_LEAD["single-source"], a!.text]) assert.ok(lintCopy(t, cfg).ok, `${lintCopy(t, cfg).hits.map((h) => h.phrase).join(", ")}: ${t}`);
  });
});

describe("the public copy says one source can settle a game", () => {
  test("every new sentence passes the copy lint and none promises two sources", () => {
    const cfg = loadCopyLintConfig();
    const f = { marketPollMin: 5, feedPollMin: 60, guardMinMin: 5, guardMaxMin: 20, spendCapPct: 2, umaHours: 2, deficitReads: ["16:30"], deficitZone: "America/New_York" };
    const settle = settlementSections(f).sections.flatMap((s) => s.paragraphs).filter((p) => /TheSportsDB/.test(p));
    assert.equal(settle.length, 2);
    const lines = [SINGLE_SOURCE_LINE, sportsConfirmationLine(), coinSourceNote("catalogue", `catalogue:${LAL}`), coinSourceNote("catalogue", teamSeries("mlb", "LAD", "win", { kind: "season", year: 2026 })), NEXT_GAME_NOTES.hold, NEXT_GAME_NOTES.noTag, NEXT_GAME_NOTES.official("MLB's official feed"), ...settle];
    for (const l of lines) {
      assert.ok(lintCopy(l, cfg).ok, `${lintCopy(l, cfg).hits.map((h) => h.phrase).join(", ")}: ${l}`);
      assert.doesNotMatch(l, /two sources|second, independent source must|\bwill\b|\bprice\b|→|—/, l);
    }
    assert.match(coinSourceNote("catalogue", LAL), /TheSportsDB alone/);
  });
});
