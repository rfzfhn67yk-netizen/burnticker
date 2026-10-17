// Third prelaunch audit 2026-10-16 F07: a season-series (meetings) coin lost its year in discovery. The parser read meetings year 2026,
// but seasonBoards dropped it into the year-less "other" card (key nfl:other:-), coinSeason returned null, so the league page listed
// the coin while counting zero season coins, and on the 2027 season page the 2026 head-to-head coins were still shown.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { coinSeason, leagueIndex, leaguePageStrings, leagueSeasonPage, leaguePath } from "@/lib/burnticker/leagues";
import { seasonBoards, type SeasonCoinInput } from "@/lib/burnticker/seasons";
import { sitemapEntries } from "@/lib/burnticker/sitemap";
import { rankLines } from "@/lib/burnticker/coinRank";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { meetingsSeries, teamSeries, type Window } from "@/lib/burnticker/sources/espn";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";

const NOW26 = Date.parse("2026-10-16T18:00:00Z"), NOW27 = Date.parse("2027-10-16T18:00:00Z");
const coin = (ticker: string, series: string, receipts: string[] = [], ended = false): SeasonCoinInput => ({ ticker, mint: `${ticker}mint`, rule: nativeRule(series), burns: receipts.map((settledAt) => ({ settledAt })), burnedPct: receipts.length * 0.5, ended });
const team = (ticker: string, abbr: string, w: Window, receipts: string[] = [], ended = false) => coin(ticker, teamSeries("nfl", abbr, "win", w), receipts, ended);
const COINS: SeasonCoinInput[] = [
  coin("PITWIN", meetingsSeries("nfl", "PIT", "BAL", 2026), ["2026-10-12"]),
  coin("BALWIN", meetingsSeries("nfl", "BAL", "PIT", 2026)),
  coin("DALWIN25", meetingsSeries("nfl", "DAL", "PHI", 2025), ["2025-11-02"], true),
  team("STEELERS26", "PIT", { kind: "season", year: 2026 }, ["2026-10-05", "2026-10-12"]),
  team("STEELERSP26", "PIT", { kind: "post", year: 2026 }),
  team("STEELERS", "PIT", { kind: "perpetual" }, ["2026-10-12"]),
];
const page = (year: number, now: number) => leagueSeasonPage({ league: "nfl", year, coins: COINS, readings: [], nowMs: now, origin: "https://burnticker.com", ogImage: "https://burnticker.com/og" });

describe("F07: meetings coins keep their season year", () => {
  test("coinSeason reads the meetings year (before: null)", () => {
    assert.deepEqual(coinSeason(COINS[0]), { league: "nfl", year: 2026, window: "meetings" });
    assert.deepEqual(coinSeason(COINS[2]), { league: "nfl", year: 2025, window: "meetings" });
    assert.equal(coinSeason(COINS[5]), null, "a perpetual coin has no season");
  });
  test("seasonBoards: a season-series card per year, never the year-less card (before: nfl:other:-)", () => {
    const boards = seasonBoards(COINS);
    const keys = boards.map((b) => b.key).sort();
    assert.deepEqual(keys, ["nfl:meetings:2025", "nfl:meetings:2026", "nfl:other:-", "nfl:post:2026", "nfl:season:2026"]);
    const m26 = boards.find((b) => b.key === "nfl:meetings:2026")!;
    assert.equal(m26.window, "meetings");
    assert.deepEqual(m26.rows.map((r) => r.ticker), ["PITWIN", "BALWIN"]);
    assert.match(m26.label, /2026/);
    assert.match(m26.label, /head-to-head/i);
    assert.deepEqual(boards.find((b) => b.key === "nfl:other:-")!.rows.map((r) => r.ticker), ["STEELERS"], "only the perpetual coin is year-less");
    const m25 = boards.find((b) => b.key === "nfl:meetings:2025")!;
    assert.equal(m25.ended, true);
    assert.equal(m25.to, "2025-11-02", "the card's dates are its own receipts");
  });
  test("the 2026 league page lists and counts the head-to-head coins (before: listed, counted zero)", () => {
    const p = page(2026, NOW26);
    assert.ok(p.boards.some((b) => b.key === "nfl:meetings:2026"));
    assert.match(p.description, /has 4 team coins/, p.description);
    const pit = p.teams.find((t) => t.abbr === "PIT")!;
    assert.ok(pit.coins.some((c) => c.ticker === "PITWIN"));
    assert.ok(!p.boards.some((b) => b.key === "nfl:meetings:2025"), "an earlier season's series stays on its own page");
  });
  test("the 2027 page does not show the 2026 head-to-head coins (before: they sat on the current season's year-less card)", () => {
    const p = page(2027, NOW27);
    const tickers = p.boards.flatMap((b) => b.rows.map((r) => r.ticker));
    assert.ok(!tickers.includes("PITWIN") && !tickers.includes("BALWIN"), tickers.join(","));
    assert.ok(tickers.includes("STEELERS"), "the perpetual coin is still on the current season");
    assert.ok(!p.teams.some((t) => t.coins.some((c) => c.ticker === "PITWIN")));
    assert.match(p.description, /has 0 team coins/);
  });
  test("a next-N coin stays on the season it started in (before: on whichever season was current)", () => {
    const next = team("STEELERS5", "PIT", { kind: "next", n: 5, from: "20261001" });
    const at = (year: number, now: number) => leagueSeasonPage({ league: "nfl", year, coins: [...COINS, next], readings: [], nowMs: now, origin: "https://burnticker.com", ogImage: "x" }).boards.flatMap((b) => b.rows.map((r) => r.ticker));
    assert.ok(at(2026, NOW26).includes("STEELERS5"));
    assert.ok(!at(2027, NOW27).includes("STEELERS5"));
    assert.ok(at(2026, NOW27).includes("STEELERS5"), "still on its own season's page a year later");
    assert.ok(at(2027, NOW27).includes("STEELERS"), "a perpetual coin is on the current season");
  });
  test("the historical 2025 page carries its own series", () => {
    const p = page(2025, NOW26);
    assert.deepEqual(p.boards.map((b) => b.key), ["nfl:meetings:2025"]);
    assert.match(p.description, /has 1 team coin /);
  });
  test("the index counts them in their season, and the sitemap lists that season's page", () => {
    const idx = leagueIndex(COINS, NOW26).sports.flatMap((s) => s.leagues).find((l) => l.id === "nfl")!;
    assert.equal(idx.coinsThisSeason, 4);
    assert.equal(idx.seasons.find((s) => s.year === 2025)?.coins, 1);
    const locs = sitemapEntries({ origin: "https://burnticker.com", coins: [], pairs: [], seasonCoins: COINS, nowMs: NOW26 } as never).map((e) => e.loc);
    assert.ok(locs.includes(`https://burnticker.com${leaguePath("nfl", 2025)}`), "the 2025 page is in the sitemap");
  });
  test("review follow-up 7: head-to-head coins of different matchups are never ranked together and no card names a leader or champion; every new string lints", () => {
    const r = rankLines(COINS).get("PITWIN")!;
    assert.doesNotMatch(r.line, /Ranked \d+ of \d+ in NFL 2026 head-to-head series/, r.line);
    assert.equal(r.season, null);
    for (const b of seasonBoards(COINS).filter((x) => x.window === "meetings")) assert.equal(b.leader, null, b.key);
    const cfg = loadCopyLintConfig();
    for (const t of [...leaguePageStrings(page(2026, NOW26)), ...leaguePageStrings(page(2025, NOW26)), r.line]) { const l = lintCopy(t, cfg); assert.ok(l.ok, `"${t}"\n${formatHits(l)}`); }
  });
});
