// THE NBA SCHEDULE WITHOUT THE NBA'S FEED (2026-10-12, ~21:40 Denver): cdn.nba.com answers HTTP 403 to the Burnticker host and to the
// operator's Mac (espn.ts probe note), so every NBA team, rivalry and rivalry-series path showed "the schedule could not be read". The
// NBA's schedule now comes from TheSportsDB under licence (the feed every other league uses), the cdn is a fallback when it answers,
// and an NBA game settles on the on-chain payout and TheSportsDB confirming each other. A fetch stub: the cdn answers 403, TheSportsDB
// answers the frozen synthetic fixture (config/burnticker/fixtures/sports/tsdb/nba.json). No network.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EspnClient, NBA_LEAGUE_SCHEDULE, NBA_OFFICIAL_ANSWERS, ScheduleUnavailable, gamesFor, meetingsPairSeries, parseEspnSeries, teamSeries, tsdbScheduleUrl, type Game } from "@/lib/burnticker/sources/espn";
import { SINGLE_SOURCE_HOLD_MS, countedOfficialOf, memoryHoldStore, operatorsFor, settleGame, sportsSettled, type GameDeps } from "@/lib/burnticker/sources/gameSettle";
import { nativeRule, nativeSourceById, setNativeClients } from "@/lib/burnticker/sources/native";
import { sportsRivalry, sportsTeams } from "@/lib/burnticker/api/handlers";
import { leagueProvenance, scheduleProblem } from "@/lib/burnticker/sources/provenance";

const FIX = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "config", "burnticker", "fixtures", "sports", "tsdb", "nba.json"), "utf8")) as { body: { schedule: Record<string, string | null>[] } };
const EVENTS = FIX.body.schedule;
const KEY = "test-licensed-key";
const NOW = Date.parse("2026-01-15T12:00:00Z");
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const SEASON_URL = tsdbScheduleUrl("nba", 2026);

/** The live situation: the NBA's cdn answers 403; TheSportsDB v2 answers the schedule and its event search (the fixture's events). */
function stub(seen: string[], o: { tsdbDown?: boolean; cdnBody?: unknown } = {}) {
  return async (url: string) => {
    seen.push(url);
    if (url.includes("cdn.nba.com")) return o.cdnBody && url === NBA_LEAGUE_SCHEDULE ? res(200, o.cdnBody) : res(403, "<html>Access Denied</html>");
    if (o.tsdbDown && url.includes("thesportsdb.com")) return res(503, {});
    if (url === SEASON_URL) return res(200, FIX.body);
    if (url.includes("thesportsdb.com/api/v2/json/search/event/")) return res(200, { event: EVENTS });
    return res(404, {});
  };
}
const client = (seen: string[], o: Parameters<typeof stub>[1] = {}, tsdbKey: string | null = KEY) => new EspnClient({ fetchImpl: stub(seen, o) as never, now: () => NOW, minIntervalMs: 0, ttlMs: 0, tsdbKey });
/** A moneyline market for every game; its payout pays the side with more points (from the fixture). */
const deps = (o: { market?: boolean; tsdbKey?: string | null } = {}): GameDeps => ({
  tsdbKey: o.tsdbKey === undefined ? KEY : o.tsdbKey, apiSportsKey: null,
  market: o.market === false ? async () => null : async (g: Game) => ({ conditionId: g.eventId, question: `${g.away.name} vs. ${g.home.name}`, outcomes: [g.home.name, g.away.name], url: `https://polymarket.com/event/nba-${g.eventId}` }),
  payout: async (id: string) => { const e = EVENTS.find((x) => x.idEvent === id); if (!e || e.intHomeScore === null) return { resolved: false, outcome: null }; return { resolved: true, outcome: Number(e.intHomeScore) > Number(e.intAwayScore) ? 0 : 1 }; },
});

afterEach(() => setNativeClients({ espn: null, games: null }));

describe("the NBA schedule when the NBA's feed answers 403", () => {
  test("the probe is recorded: no official NBA endpoint answers, so TheSportsDB is read first and the cdn is never counted on", () => {
    assert.equal(NBA_OFFICIAL_ANSWERS, false);
    assert.equal(countedOfficialOf("nba"), null);
    assert.equal(countedOfficialOf("mlb"), "mlb.statsapi"); assert.equal(countedOfficialOf("nhl"), "nhl.score");
  });

  test("the schedule lists the games from TheSportsDB: teams pinned to the same frozen table, preseason and the NBA Cup final dropped, playoffs marked", async () => {
    const seen: string[] = [];
    const c = client(seen);
    const phi = await c.season("nba", "PHI", 2026);
    assert.deepEqual(phi.map((g) => g.eventId), ["9000002", "9000003", "9000005", "9000007", "9000008", "9000009"], "no preseason game (round 500), no December Cup final");
    for (const g of phi) { assert.ok([g.home.abbr, g.away.abbr].includes("PHI")); assert.notEqual(g.home.abbr, "TBD"); assert.notEqual(g.away.abbr, "TBD"); assert.ok(g.home.id && g.away.id, "the team id pin resolves"); }
    assert.deepEqual(phi.map((g) => g.seasonType), [2, 2, 2, 2, 2, 3]);
    assert.ok(phi[2].completed && phi[2].detail === "AOT", "an overtime final is final");
    assert.ok(!seen.some((u) => u.includes("cdn.nba.com")), "TheSportsDB answered, so the cdn was not read");
    const up = await c.upcoming("nba", 7);
    assert.deepEqual(up.map((g) => [g.eventId, g.away.abbr, g.home.abbr]), [["9000007", "NY", "PHI"]], "the Knicks are NY in the frozen table");
    const lac = (await c.season("nba", "LAC", 2026))[0];
    assert.equal(lac.away.abbr, "LAC", "TheSportsDB's LA Clippers is our LAC");
    // the series ids do not change with the feed: a season coin on PHI reads the same id as before
    assert.equal(teamSeries("nba", "PHI", "win", { kind: "season", year: 2026 }), "espn.team:nba-PHI.20-win-s2026");
    assert.equal(meetingsPairSeries("nba", "PHI", "BOS", 2026).a, "espn.team:nba-PHI.20-win-m2026.BOS.2");
  });

  test("the feeds back each other up: TheSportsDB down and the cdn answering 200 still lists; neither readable without a key says the key is needed", async () => {
    const cdnBody = { leagueSchedule: { seasonYear: "2025-26", gameDates: [{ games: [{ gameId: "0022500001", gameDateTimeUTC: "2026-01-17T00:00:00Z", gameStatus: 1, gameStatusText: "7:00 pm ET", homeTeam: { teamTricode: "PHI", teamCity: "Philadelphia", teamName: "76ers" }, awayTeam: { teamTricode: "NYK", teamCity: "New York", teamName: "Knicks" } }] }] } };
    const back = await client([], { tsdbDown: true, cdnBody }).season("nba", "PHI", 2026);
    assert.deepEqual(back.map((g) => g.eventId), ["0022500001"]);
    const nokey = client([], {}, null);
    assert.equal(nokey.scheduleAvailable("nba"), false);
    await assert.rejects(nokey.season("nba", "PHI", 2026), (e) => e instanceof ScheduleUnavailable);
    await assert.rejects(client([], { tsdbDown: true }).season("nba", "PHI", 2026), /HTTP 503/, "the TheSportsDB error is the one reported, not the cdn's 403");
  });

  test("the team picker and the matchup picker list NBA games, and say where the schedule comes from", async () => {
    setNativeClients({ espn: client([]), games: deps() });
    const t = (await sportsTeams(null as never, { league: "nba" })).body as { scheduleNote: string | null; source: string; teams: { abbr: string; next: { eventId: string } | null }[] };
    assert.equal(t.scheduleNote, null);
    assert.equal(t.teams.find((x) => x.abbr === "PHI")!.next?.eventId, "9000007");
    assert.match(t.source, /NBA's feed when it answers, otherwise from TheSportsDB under licence/);
    assert.doesNotMatch(t.source, /ESPN|\bwill\b|\bbuy|\bprice\b/i);
    const leagues = (await sportsTeams(null as never, {})).body as { leagues: { id: string; schedule: string; crossRead: string }[] };
    const nba = leagues.leagues.find((l) => l.id === "nba")!;
    assert.match(nba.schedule, /NBA's feed when it answers, otherwise TheSportsDB under licence/);
    assert.doesNotMatch(nba.crossRead, /NBA's official feed/, "a feed that answers 403 is not named as the confirmation");
    assert.equal(leagueProvenance("nba").schedule, "the NBA's feed when it answers, otherwise TheSportsDB under licence");
    assert.match(scheduleProblem("nba", "unreadable", "HTTP 403").line, /^NBA's next games could not be read from the NBA's feed or TheSportsDB just now/);
  });

  test("the rivalry meetings list works for the NBA: every game between the two teams, the playoff game marked, the same series ids", async () => {
    setNativeClients({ espn: client([]), games: deps() });
    const r = await sportsRivalry(null as never, { league: "nba", a: "PHI", b: "BOS" });
    assert.equal(r.status, 200);
    const b = r.body as { offered: boolean; scheduleNote: string | null; series: { a: string; b: string }; meetings: { eventId: string; date: string; result: string; playoff: boolean }[]; tally: Record<string, number> };
    assert.equal(b.scheduleNote, null); assert.equal(b.offered, true);
    assert.deepEqual(b.series, meetingsPairSeries("nba", "PHI", "BOS", 2026));
    assert.deepEqual(b.meetings.map((m) => [m.eventId, m.result, m.playoff]), [["9000003", "win", false], ["9000005", "win", false], ["9000008", "pending", false], ["9000009", "pending", true]], "the preseason meeting is not a meeting");
    assert.equal(b.tally.PHI, 2);
    const ms = parseEspnSeries(b.series.a)!;
    assert.deepEqual((await gamesFor(client([]), ms)).map((g) => g.eventId), ["9000003", "9000005", "9000008", "9000009"]);
  });
});

describe("NBA settlement does not depend on the dead feed", () => {
  test("the on-chain payout and TheSportsDB settle an NBA game while the cdn answers 403", async () => {
    const seen: string[] = [];
    const c = client(seen);
    const g = (await c.season("nba", "PHI", 2026)).find((x) => x.eventId === "9000005")!;
    const v = await settleGame(c, g, deps());
    assert.equal(v.kind, "settled", JSON.stringify(v));
    if (v.kind !== "settled") return;
    assert.equal(v.winner, "away"); assert.deepEqual(v.final, { home: 99, away: 105 });
    assert.deepEqual(v.ops, ["on-chain payout", "TheSportsDB"]); assert.equal(v.confirmedBy, "a licensed final score");
    assert.equal(seen.filter((u) => u.includes("cdn.nba.com")).length, 1, "the cdn is tried once; its 403 changes nothing and it is not read again in this run (2026-10-14)");
    const g2 = (await c.season("nba", "PHI", 2026)).find((x) => x.eventId !== "9000005" && x.completed)!;
    await settleGame(c, g2, deps());
    assert.equal(seen.filter((u) => u.includes("cdn.nba.com")).length, 1, "a second NBA game does not read the refused feed again");
    assert.ok(seen.some((u) => /thesportsdb\.com\/api\/v2\/json\/filter\/events\/day\//.test(u)), "the game is read through TheSportsDB's day listing, as every other league");
    const r = await sportsSettled(c, parseEspnSeries(teamSeries("nba", "PHI", "win", { kind: "season", year: 2026 }))!, null, deps(), { nowMs: NOW });
    assert.deepEqual(r.events.map((e) => [e.id, e.value]), [["2025-10-22", "1"], ["2025-11-03", "1"], ["2026-01-10", "1"]]);
    assert.deepEqual(r.refusals, []);
  });

  test("the dead feed is not counted as a second operator: TheSportsDB alone takes the 12-hour hold (owner 2026-10-14), never waits for the cdn", async () => {
    const c = client([]);
    const g = (await c.season("nba", "PHI", 2026)).find((x) => x.eventId === "9000005")!;
    assert.deepEqual(operatorsFor("nba", deps({ market: false }), false), ["TheSportsDB"]);
    const holds = memoryHoldStore();
    let t = NOW;
    const d = { ...deps({ market: false }), holds, now: () => t };
    const v = await settleGame(c, g, d);
    assert.equal(v.kind, "awaiting"); assert.match(v.kind === "awaiting" ? v.why : "", /first seen now/);
    t += SINGLE_SOURCE_HOLD_MS;
    const w = await settleGame(c, g, d);
    assert.equal(w.kind, "settled"); assert.equal(w.kind === "settled" ? w.settledBy : "", "TheSportsDB only, confirmed after a 12 h hold");
  });

  test("the creation preflight does not refuse an NBA team coin: the payout is primary, TheSportsDB the second source", async () => {
    const { preflightSelector } = await import("@/lib/burnticker/coverage/preflight");
    setNativeClients({ espn: client([]), games: deps() });
    const id = teamSeries("nba", "PHI", "win", { kind: "season", year: 2026 });
    assert.equal(nativeSourceById(id)!.crossReadId, "thesportsdb.v2");
    assert.doesNotMatch(nativeSourceById(id)!.flags.join(" "), /\(free, official\)/);
    const r = await preflightSelector(nativeRule(id), { now: NOW });
    assert.equal(r.ok, true, JSON.stringify(r.refusal));
    assert.equal(r.crossRead?.id, "thesportsdb.v2"); assert.equal(r.agreement, null, "no past game is read at launch (owner 2026-10-13)");
    assert.equal(r.primary.lastReading, null); assert.match(r.agreementBasis, /readers for the next game/);
    const pair = meetingsPairSeries("nba", "PHI", "BOS", 2026);
    const p = await preflightSelector(nativeRule(pair.a), { now: NOW });
    assert.notEqual(p.refusal?.code, "primary-unreadable", JSON.stringify(p.refusal));
    assert.notEqual(p.refusal?.code, "no-cross-read", JSON.stringify(p.refusal));
  });

  test("owner 2026-10-14: with TheSportsDB alone the preflight passes and the review gets a plain note, never a refusal", async () => {
    const { preflightSelector } = await import("@/lib/burnticker/coverage/preflight");
    const { lintCopy, loadCopyLintConfig } = await import("@/lib/launch/copyLint");
    const { NEXT_GAME_NOTES } = await import("@/lib/burnticker/sources/native");
    setNativeClients({ espn: client([]), games: deps({ market: false }) });
    const id = teamSeries("nba", "PHI", "win", { kind: "season", year: 2026 });
    const r = await preflightSelector(nativeRule(id), { now: NOW });
    assert.equal(r.ok, true, JSON.stringify(r.refusal)); assert.equal(r.refusal, null);
    const p = await nativeSourceById(id)!.preflight(NOW);
    assert.equal(p.problem, null); assert.equal(p.note, NEXT_GAME_NOTES.hold);
    assert.equal(p.note, "Polymarket has not listed the next game yet; it usually appears a few days before tip-off. Until it does, that game would settle on TheSportsDB alone after a 12-hour confirmation hold.");
    const cfg = loadCopyLintConfig();
    for (const l of [NEXT_GAME_NOTES.hold, NEXT_GAME_NOTES.noTag, NEXT_GAME_NOTES.official("MLB's official feed")]) assert.ok(lintCopy(l, cfg).ok, `${lintCopy(l, cfg).hits.map((h) => h.phrase).join(", ")}: ${l}`);
  });

  test("owner 2026-10-14: a team whose next game no source can read is still refused, with the same sentence", async () => {
    const { preflightSelector } = await import("@/lib/burnticker/coverage/preflight");
    const { lintCopy, loadCopyLintConfig } = await import("@/lib/launch/copyLint");
    setNativeClients({ espn: client([]), games: deps({ market: false, tsdbKey: null }) });
    const r = await preflightSelector(nativeRule(teamSeries("nba", "PHI", "win", { kind: "season", year: 2026 })), { now: NOW });
    assert.equal(r.refusal?.code, "primary-unreadable");
    assert.match(r.refusal!.reason, /^no source can settle the next game for Philadelphia 76ers yet, because Polymarket has not listed a market for .+ and this site has no licensed final scores\./);
    const cfg = loadCopyLintConfig();
    const shown = `The check run before launch refused this coin: ${r.refusal!.reason}`;
    assert.ok(lintCopy(shown, cfg).ok, shown);
  });

});

describe("the launch check's sports sentences (GAME_LINES)", () => {
  test("every sentence passes the copy lint and names no setting, operator or symbol", async () => {
    const { GAME_LINES } = await import("@/lib/burnticker/sources/native");
    const { lintCopy, loadCopyLintConfig } = await import("@/lib/launch/copyLint");
    const cfg = loadCopyLintConfig();
    const g = { eventId: "1", league: "nfl", startsAt: "2026-10-04T20:25:00Z", date: "2026-10-04", name: "Kansas City Chiefs at Las Vegas Raiders", completed: true, state: "post", detail: "", home: { abbr: "LV", name: "Las Vegas Raiders", nickname: "Raiders", score: 27, homeAway: "home", record: null }, away: { abbr: "KC", name: "Kansas City Chiefs", nickname: "Chiefs", score: 30, homeAway: "away", record: null } } as Game;
    const lines = [
      GAME_LINES.scheduleOff("NFL"), GAME_LINES.scheduleUnread("Kansas City Chiefs"), GAME_LINES.gameNotListed("Kansas City Chiefs"),
      GAME_LINES.noSourceNext("Atlanta Hawks", { ...g, name: "Atlanta Hawks at Orlando Magic", date: "2026-10-21" }, "nba"), GAME_LINES.noSourceNext("Chelsea", null, "eng.1"),
    ];
    assert.match(lines[3], /usually lists/, "a league Polymarket lists says when its games usually appear");
    for (const l of lines) {
      const shown = `The check run before launch refused this coin: ${l}`;
      assert.ok(lintCopy(shown, cfg).ok, `${lintCopy(shown, cfg).hits.map((h) => h.phrase).join(", ")}: ${shown}`);
      assert.doesNotMatch(l, /operator|BURNTICKER_|≠|—|→|HTTP/, l);
    }
  });
});
