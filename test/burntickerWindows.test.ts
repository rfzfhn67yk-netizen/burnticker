// TEAM-COIN WINDOWS AND EVERY LEAGUE (2026-10-10). The window is in the series (so in the rules hash), the team is pinned by its ESPN
// id; season boundaries are read from frozen ESPN schedules; a perpetual window never ends; an ended window marks the rule end once
// (the wind-down starts the next day); soccer has draws and shoot-outs; every league ESPN serves is listed with its cross-read.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EspnClient, LEAGUES, findTeams, gamesFor, outcomeOf, parseEspnSeries, mlbGames, mlbTeamScheduleUrl, nhlClubScheduleUrl, tsdbScheduleUrl, seasonLabel, seasonYearAt, teamSeries, windowFor, windowStatus, tsdbNamePairs, type EspnSeries, type Game } from "@/lib/burnticker/sources/espn";
import { describeRule } from "@/lib/burnticker/describe";
import { namesTeam } from "@/lib/burnticker/search";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { recordWindowEnd } from "@/lib/burnticker/multiKeeper";
import { leagueCoverage } from "@/lib/burnticker/coverage/leagues";
import { loadSourceEntries } from "@/lib/burnticker/catalogue";
import { DEFAULT_ON_END, lockRule } from "@/lib/burnticker/rules";
import { ESPN_NOW, ESPN_TABLE, F, espnFixtureClient, exactFetch } from "./burntickerFirstPartyHelpers.ts";

const team = (code: string) => parseEspnSeries(code) as Extract<EspnSeries, { kind: "team" }>;
const client = () => espnFixtureClient();

describe("series: the window in the hash, the team pinned by its ESPN id", () => {
  test("new grammar round-trips; the first form is still read", () => {
    assert.equal(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 }), "espn.team:mlb-TB.30-win-s2026");
    assert.equal(teamSeries("nhl", "EDM", "loss", { kind: "post", year: 2027 }), "espn.team:nhl-EDM.6-loss-p2027");
    assert.equal(teamSeries("eng.1", "ARS", "draw", { kind: "next", n: 5, from: "20261010" }), "espn.team:eng.1-ARS.359-draw-n5.20261010");
    assert.equal(teamSeries("usa.1", "MIA", "win", { kind: "perpetual" }), "espn.team:usa.1-MIA.20232-win-perpetual");
    assert.deepEqual(team("espn.team:mlb-TB.30-win-s2026"), { kind: "team", league: "mlb", abbr: "TB", teamId: "30", outcome: "win", window: { kind: "season", year: 2026 } });
    assert.equal(team("espn.team:mlb-TBR.30-win-s2026")?.abbr, "TB", "the id wins over a stale abbreviation (a rename keeps the coin on its team)");
    assert.deepEqual(team("espn.team:nfl-PHI-loss")?.window, { kind: "legacy", scope: "all" });
    assert.equal(parseEspnSeries("espn.team:mlb-TB.30-draw-s2026"), null, "no draws in baseball");
    assert.equal(parseEspnSeries("espn.team:mlb-TB.30-win-n21.20261010"), null, "next N is 1–20");
    assert.equal(parseEspnSeries("espn.team:xfl-TB.30-win-s2026"), null);
    const a = lockRule(nativeRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 }))), b = lockRule(nativeRule(teamSeries("mlb", "TB", "win", { kind: "perpetual" })));
    assert.notEqual(a.sha256, b.sha256, "a different window is a different coin");
  });

  test("schedules come from the league's official feed (MLB, NHL, NBA) or TheSportsDB — never ESPN", () => {
    assert.equal(mlbTeamScheduleUrl("TB", 2025), "https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=2025&gameType=R,F,D,L,W&teamId=139");
    assert.equal(nhlClubScheduleUrl("TB", 2027), "https://api-web.nhle.com/v1/club-schedule-season/TBL/20262027");
    assert.equal(tsdbScheduleUrl("eng.1", 2026), "https://www.thesportsdb.com/api/v2/json/schedule/league/4328/2026-2027");
  });
});

describe("season boundaries from frozen ESPN schedules", () => {
  test("2025: every regular-season game final, no postseason → the season (and the postseason) ended on Sep 28", async () => {
    const c = client();
    const s25 = team("espn.team:mlb-TB.30-win-s2025");
    const g = await gamesFor(c, s25);
    assert.equal(g.length, 162); assert.ok(g.every((x) => x.seasonYear === 2025));
    const st = windowStatus(s25, g, ESPN_NOW);
    assert.equal(st.ended, true); assert.equal(st.endsAt, "2025-09-28T19:07:00Z"); assert.equal(st.perpetual, false);
    const p25 = team("espn.team:mlb-TB.30-win-p2025");
    const pst = windowStatus(p25, await c.season("mlb", "30", 2025), ESPN_NOW);
    assert.equal(pst.ended, true); assert.match(pst.reason, /no postseason games/);
    const { sportsSettled } = await import("@/lib/burnticker/sources/gameSettle");
    const r = await sportsSettled(c, s25, "2025-12-31", { tsdbKey: null, apiSportsKey: null, market: null, payout: null }, { nowMs: ESPN_NOW });
    assert.equal(r.window?.ended, true);
  });

  test("2026 on Oct 10: the Rays are in the postseason → open, the end provisional at the last listed game", async () => {
    const s26 = team("espn.team:mlb-TB.30-win-s2026");
    const g = await gamesFor(client(), s26);
    const st = windowStatus(s26, g, ESPN_NOW);
    assert.equal(st.ended, false); assert.equal(st.endsAt, "2026-10-21T00:00:00Z");
    const w = windowFor("mlb", await client().season("mlb", "TB"), ESPN_NOW);
    assert.deepEqual(w.window, { kind: "season", year: 2026 }); assert.equal(w.next?.startsAt, "2026-10-13T00:00:00Z");
    const later = windowStatus(s26, g.map((x) => ({ ...x, completed: true, state: "post" })), Date.parse("2026-10-30T00:00:00Z"));
    assert.equal(later.ended, true, "every listed game final and 4 days without a new one: the season is over");
  });

  test("perpetual: never ends, no end date anywhere", async () => {
    const p = team("espn.team:mlb-TB.30-win-perpetual");
    const st = windowStatus(p, await gamesFor(client(), p, "2026-09-01"), Date.parse("2027-02-01T00:00:00Z"));
    assert.deepEqual([st.perpetual, st.ended, st.endsAt], [true, false, null]);
    const t = describeRule(nativeRule(teamSeries("mlb", "TB", "win", { kind: "perpetual" })), { ticker: "" });
    assert.match(t.paragraph, /This coin has no end date and does not retire\./); assert.doesNotMatch(t.paragraph, /burns down whatever is left/);
  });

  test("next N: the first N games from the anchor day, ended when N are final", async () => {
    const n3 = team("espn.team:mlb-TB.30-win-n3.20260929");
    const g = await gamesFor(client(), n3);
    assert.equal(g.length, 3); assert.ok(g.every((x) => x.date >= "2026-09-29"));
    const st = windowStatus(n3, g, ESPN_NOW);
    assert.equal(st.ended, g.every((x) => x.completed));
  });

  test("an ended window marks the rule end once (wind-down from the next day); perpetual and pre-onEnd rules are left alone", () => {
    const marks: string[] = [];
    const tok = (mint: string, onEnd: boolean) => ({ mint, ticker: mint.toUpperCase(), status: "live", selectorKey: "k" }) as never;
    const locked: Record<string, { rule: { onEnd?: unknown } }> = { a: { rule: { onEnd: DEFAULT_ON_END } }, b: { rule: {} } };
    const reg = { ruleEnd: () => null, lockedRule: (t: { mint: string }) => locked[t.mint], markRuleEnded: (m: string) => { marks.push(m); return null; } } as never;
    const d = { registry: reg, dryRun: false, log: () => {} } as never;
    const ended = { window: { perpetual: false, ended: true, endsAt: "2025-09-28T19:07:00Z", reason: "the team's last game of the window was 2025-09-28" } };
    assert.deepEqual(recordWindowEnd(d, [tok("a", true), tok("b", false)], ended), ["a"]);
    assert.deepEqual(marks, ["a"]);
    assert.deepEqual(recordWindowEnd(d, [tok("a", true)], { window: { perpetual: true, ended: false, endsAt: null, reason: "no end date" } }), []);
    assert.deepEqual(recordWindowEnd(d, [tok("a", true)], { window: { ...ended.window, ended: false } }), []);
  });

  test("ticker suggestions carry the season: $RAYS26, $EAGLES26, $LAKERS26 (2026–27), $RAYS perpetual", () => {
    const tk = (code: string) => describeRule(nativeRule(code), { ticker: "" }).ticker;
    assert.equal(tk(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 })), "RAYS26");
    assert.equal(tk(teamSeries("nfl", "PHI", "win", { kind: "season", year: 2026 })), "EAGLES26");
    assert.equal(tk(teamSeries("nba", "LAL", "win", { kind: "season", year: 2027 })), "LAKERS26");
    assert.equal(tk(teamSeries("mlb", "TB", "win", { kind: "perpetual" })), "RAYS");
    assert.equal(tk(teamSeries("eng.1", "ARS", "win", { kind: "season", year: 2026 })), "ARSENAL26");
    assert.equal(seasonLabel("nba", 2027), "2026–27"); assert.equal(seasonLabel("eng.1", 2026), "2026–27"); assert.equal(seasonLabel("mlb", 2026), "2026");
    assert.equal(seasonYearAt("nba", ESPN_NOW), 2027); assert.equal(seasonYearAt("eng.1", ESPN_NOW), 2026); assert.equal(seasonYearAt("cfb", Date.parse("2027-01-05T00:00:00Z")), 2026);
  });
});

describe("every league, draws and shoot-outs", () => {
  const g0 = (): Game => mlbGames(F("sports/mlb.tb.2026.json").body).find((g) => g.eventId === "849835")!;
  test("outcomeOf: a draw is a tie; a level knockout game decided on penalties is a win for ESPN's winner", () => {
    const g = g0();
    const lvl = { ...g, completed: true, home: { ...g.home, score: 1, winner: null }, away: { ...g.away, score: 1, winner: null } };
    assert.equal(outcomeOf(lvl, g.home.abbr), "tie");
    const pens = { ...lvl, league: "uefa.champions" as const, home: { ...lvl.home, winner: true }, away: { ...lvl.away, winner: false } };
    assert.equal(outcomeOf({ ...pens, league: "mlb" }, g.home.abbr), "tie", "only a league with draws reads the winner flag on a level score");
    assert.equal(outcomeOf(pens, g.home.abbr), "win"); assert.equal(outcomeOf(pens, g.away.abbr), "loss");
    assert.equal(outcomeOf(lvl, "ZZZ", g.home.id ?? null), "tie", "matched by the ESPN id when both sides carry one");
  });

  test("TheSportsDB names a club or a college its own way: ESPN's display name, short name, location and the club name are all tried", () => {
    const g = { ...g0(), home: { ...g0().home, name: "Inter Miami CF", short: "Miami", location: "Inter Miami CF" }, away: { ...g0().away, name: "AFC Bournemouth", short: "Bournemouth", location: "AFC Bournemouth" } };
    const pairs = tsdbNamePairs(g);
    assert.deepEqual(pairs[0], ["Inter Miami CF", "AFC Bournemouth"]); assert.ok(pairs.some((p) => p[0] === "Inter Miami" && p[1] === "Bournemouth"));
  });

  test("teams by name across every league (no league first by habit)", () => {
    const named = (q: string) => findTeams(q).find((t) => namesTeam(q, t));   // what the search box binds to
    assert.equal(named("Arsenal win")?.league, "eng.1");
    assert.equal(named("Inter Miami draw")?.abbr, "MIA"); assert.equal(named("Inter Miami draw")?.league, "usa.1");
    assert.equal(named("Oilers lose")?.league, "nhl");
    assert.equal(named("Lakers")?.abbr, "LAL");
    assert.ok(findTeams("Georgia Bulldogs").some((t) => t.league === "cfb" && t.abbr === "UGA"));
  });

  test("the per-league coverage: schedule source, the two reads with and without a market, the verdict — no league depends on ESPN", () => {
    const rows = leagueCoverage(loadSourceEntries());
    assert.deepEqual(rows.map((r) => r.id).sort(), Object.keys(LEAGUES).sort());
    for (const r of rows) { assert.equal(r.primaryA, "polymarket.gamepayout", r.label); assert.deepEqual(r.primaryB, { id: "thesportsdb.v2", needsKey: "BURNTICKER_THESPORTSDB_KEY" }); assert.ok(r.teams > 0, r.label); }
    assert.deepEqual(rows.filter((r) => r.verdict === "settleable").map((r) => [r.id, r.official!.id, r.schedule.needsKey]).sort(), [["mlb", "mlb.statsapi", null], ["nba", "nba.cdn", null], ["nhl", "nhl.score", null]]);
    for (const r of rows.filter((x) => !["mlb", "nba", "nhl"].includes(x.id))) {
      assert.equal(r.verdict, "settleable with the TheSportsDB key", r.label);
      assert.equal(r.schedule.needsKey, "BURNTICKER_THESPORTSDB_KEY");
      assert.match(r.withMarket, /^on-chain payout \+ TheSportsDB/, "the payout and TheSportsDB confirm each other");
      assert.match(r.withoutMarket, /API-Sports/, "a game without a market needs the optional second licensed read");
    }
    assert.ok(!JSON.stringify(rows).includes("espn"), "no ESPN source in the table");
    assert.ok(rows.filter((r) => r.draws).every((r) => r.sport === "soccer"));
  });

});

// keep the fixture table referenced (the season-year URLs it maps are what the boundary tests read)
void ESPN_TABLE; void exactFetch; void EspnClient;
