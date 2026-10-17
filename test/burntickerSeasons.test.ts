// THE SEASONS PAGE (seasons.ts): one scoreboard per league and season, never an ordering across leagues; "champion" only once the
// season ended for every coin on the card; a count across leagues; date ranges, not weeks; lint-clean labels.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { coinsBurnedOn, dateRange, seasonBoards, type SeasonCoinInput } from "@/lib/burnticker/seasons";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { teamSeries, type LeagueId, type Window } from "@/lib/burnticker/sources/espn";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { DEBT_RULE } from "./burntickerHelpers.ts";

const coin = (ticker: string, lg: LeagueId, abbr: string, w: Window, receipts: string[], burnedPct: number, ended = false, o: "win" | "loss" = "win"): SeasonCoinInput =>
  ({ ticker, mint: `${ticker}mint`, rule: nativeRule(teamSeries(lg, abbr, o, w)), burns: receipts.map((settledAt) => ({ settledAt })), burnedPct, ended });
const NHL = { kind: "season", year: 2027 } as Window, MLB = { kind: "season", year: 2026 } as Window, MLBP = { kind: "post", year: 2026 } as Window;
// two leagues from the frozen fixtures' teams: the NHL coins have MORE receipts than the MLB coins, so any cross-league sort would show
const COINS: SeasonCoinInput[] = [
  coin("OILERS27", "nhl", "EDM", NHL, ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"], 3.1),
  coin("BRUINS27", "nhl", "BOS", NHL, ["2026-10-09"], 0.4, false, "loss"),
  coin("RAYS26", "mlb", "TB", MLB, ["2026-09-28", "2026-10-03"], 1.2, true),
  coin("YANKEES26", "mlb", "NYY", MLB, ["2026-09-20"], 2.5, true),
  coin("RAYSP26", "mlb", "TB", MLBP, ["2026-10-03"], 0.3),
  coin("RAYS", "mlb", "TB", { kind: "perpetual" }, ["2026-10-03"], 0.2),
  { ticker: "DEBT", mint: "DEBTmint", rule: DEBT_RULE as never, burns: [{ settledAt: "2026-10-09" }], burnedPct: 5, ended: false },
];

describe("seasons", () => {
  const boards = seasonBoards(COINS);
  test("one card per league and window; no card holds two leagues; feeds are not team coins", () => {
    assert.deepEqual(boards.map((b) => b.label), ["MLB 2026", "MLB 2026 postseason", "MLB coins with no end date, or for a set number of games", "NHL 2026–27"]);
    for (const b of boards) {
      const leagues = new Set(b.rows.map((r) => COINS.find((c) => c.mint === r.mint)!.rule.series!.split(":")[1].split("-")[0]));
      assert.equal(leagues.size, 1, `${b.label} mixes leagues`); assert.ok(leagues.has(b.league));
    }
    assert.ok(!boards.some((b) => b.rows.some((r) => r.ticker === "DEBT")));
  });

  test("each card ranks on its own (receipts, then supply burned); ranks restart at 1 per card — no cross-league ordering exists", () => {
    const mlb = boards.find((b) => b.label === "MLB 2026")!, nhl = boards.find((b) => b.label === "NHL 2026–27")!;
    assert.deepEqual(mlb.rows.map((r) => [r.rank, r.ticker]), [[1, "RAYS26"], [2, "YANKEES26"]]);
    assert.deepEqual(nhl.rows.map((r) => [r.rank, r.ticker]), [[1, "OILERS27"], [2, "BRUINS27"]]);
    assert.ok(boards.every((b) => b.rows.every((r, i) => r.rank === i + 1)));
    const json = JSON.stringify(boards);
    assert.doesNotMatch(json, /"overall|"global|"crossLeague/i);
  });

  test("champion only after the season ended for every coin on the card; otherwise most receipts so far; none for perpetual cards", () => {
    assert.deepEqual(boards.find((b) => b.label === "MLB 2026")!.leader, { ticker: "RAYS26", title: "champion" });
    assert.deepEqual(boards.find((b) => b.label === "NHL 2026–27")!.leader, { ticker: "OILERS27", title: "most receipts so far" });
    assert.equal(boards.find((b) => b.label === "MLB 2026 postseason")!.leader!.title, "most receipts so far");
    assert.equal(boards.find((b) => b.window === "other")!.leader, null);
    const mixed = seasonBoards([COINS[2], { ...COINS[3], ended: false }]);
    assert.equal(mixed[0].leader!.title, "most receipts so far", "one coin still reading: no champion yet");
  });

  test("the cross-league line is a count; ranges are dates, never weeks; labels lint clean", () => {
    assert.equal(coinsBurnedOn(COINS, "2026-10-09"), 3, "OILERS27, BRUINS27 and DEBT");
    assert.equal(dateRange("2026-10-08", "2026-10-11"), "Oct 8 – Oct 11, 2026");
    assert.equal(dateRange("2026-12-30", "2027-01-02"), "Dec 30, 2026 – Jan 2, 2027");
    assert.equal(dateRange(null, null), "no receipts yet");
    const cfg = loadCopyLintConfig();
    for (const b of boards) { assert.doesNotMatch(`${b.label} ${dateRange(b.from, b.to)}`, /\bweek/i); assert.ok(lintCopy(`${b.label} · ${b.leader?.title ?? ""}`, cfg).ok, b.label); }
    assert.equal(boards.find((b) => b.label === "NHL 2026–27")!.from, "2026-10-08");
  });
});
