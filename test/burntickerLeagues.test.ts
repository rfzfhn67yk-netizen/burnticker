// LEAGUE AND SEASON PAGES + THE SITEMAP (growth batch 2026-10-10; src/lib/burnticker/leagues.ts, sitemap.ts). Over a two-league
// fixture (NHL 2026–27 and MLB 2026, where the NHL coins have MORE receipts so any cross-league sort would show): one page per league and
// season reusing seasons.ts's boards, ranks restart per card, "champion" only after the season ended, the team list with launch links,
// the settled games deduplicated with their source line and the ESPN link only, JSON-LD SportsEvent with only what the reading recorded,
// lint-clean text, slugs both ways, the index grouped by sport without an ordering across leagues, and the sitemap listing coins,
// pairs, leagues and docs but never a draft.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { leagueIndex, leagueOgSvg, leaguePageStrings, leagueSeasonPage, gamesFromTitle, parseSeasonSlug, resolveLeagueSeason, seasonSlug, settledGames, type GameReading } from "@/lib/burnticker/leagues";
import { seasonBoards, type SeasonCoinInput } from "@/lib/burnticker/seasons";
import { sitemapEntries, sitemapXml } from "@/lib/burnticker/sitemap";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { teamSeries, type LeagueId, type Window } from "@/lib/burnticker/sources/espn";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { DEBT_RULE } from "./burntickerHelpers.ts";

const NOW = Date.parse("2026-10-10T18:00:00Z");
const ORIGIN = "https://burnticker.com";
const coin = (ticker: string, lg: LeagueId, abbr: string, w: Window, receipts: string[], burnedPct: number, ended = false, o: "win" | "loss" = "win"): SeasonCoinInput =>
  ({ ticker, mint: `${ticker}mint`, rule: nativeRule(teamSeries(lg, abbr, o, w)), burns: receipts.map((settledAt) => ({ settledAt })), burnedPct, ended });
const NHL = { kind: "season", year: 2027 } as Window, MLB = { kind: "season", year: 2026 } as Window, MLBP = { kind: "post", year: 2026 } as Window;
const COINS: SeasonCoinInput[] = [
  coin("OILERS27", "nhl", "EDM", NHL, ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"], 3.1),
  coin("BRUINS27", "nhl", "BOS", NHL, ["2026-10-09"], 0.4, false, "loss"),
  coin("RAYS26", "mlb", "TB", MLB, ["2026-09-28", "2026-10-03"], 1.2, true),
  coin("YANKEES26", "mlb", "NYY", MLB, ["2026-09-20"], 2.5, true),
  coin("RAYSP26", "mlb", "TB", MLBP, ["2026-10-03"], 0.3),
  coin("RAYS", "mlb", "TB", { kind: "perpetual" }, ["2026-10-03"], 0.2),
  { ticker: "DEBT", mint: "DEBTmint", rule: DEBT_RULE as never, burns: [{ settledAt: "2026-10-09" }], burnedPct: 5, ended: false },
];
// the readings exactly as gameSettle.ts writes their titles (one line per game, joined by " · " when a day has two)
const line = (aw: string, as: number, hm: string, hs: number, us: string, out: string, on: string, by: string, url: string) => `${aw} ${as} @ ${hm} ${hs} final (${us} ${out}) · settled on ${on} · confirmed by ${by} · see this game on ESPN → ${url}`;
const OIL_KEY = `catalogue:${COINS[0].rule.series}`, BOS_KEY = `catalogue:${COINS[1].rule.series}`, RAYS_KEY = `catalogue:${COINS[2].rule.series}`;
const READINGS: GameReading[] = [
  { selectorKey: OIL_KEY, at: "2026-10-09", title: line("EDM", 4, "BOS", 2, "EDM", "win", "the game's on-chain payout", "NHL's official scores", "https://www.espn.com/nhl/scoreboard/_/date/20261009") },
  // the same game from the Bruins' loss coin: listed once
  { selectorKey: BOS_KEY, at: "2026-10-09", title: line("EDM", 4, "BOS", 2, "BOS", "loss", "the game's on-chain payout", "NHL's official scores", "https://www.espn.com/nhl/scoreboard/_/date/20261009") },
  { selectorKey: OIL_KEY, at: "2026-10-10", title: line("EDM", 3, "CGY", 1, "EDM", "win", "a licensed final score", "NHL's official scores", "https://www.espn.com/nhl/scoreboard/_/date/20261010") },
  // outside the seven days: not listed
  { selectorKey: OIL_KEY, at: "2026-10-01", title: line("EDM", 1, "VAN", 0, "EDM", "win", "the game's on-chain payout", "NHL's official scores", "https://www.espn.com/nhl/scoreboard/_/date/20261001") },
  { selectorKey: RAYS_KEY, at: "2026-10-03", title: line("TB", 5, "NYY", 2, "TB", "win", "the game's on-chain payout", "MLB's official feed", "https://www.espn.com/mlb/scoreboard/_/date/20261003") },
];
const cfg = loadCopyLintConfig();
const lintAll = (texts: string[], what: string) => { for (const t of texts) { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}: "${t}"\n${formatHits(r)}`); } };
const page = (league: LeagueId, year: number) => leagueSeasonPage({ league, year, coins: COINS, readings: READINGS, nowMs: NOW, origin: ORIGIN, ogImage: `${ORIGIN}/og` });

describe("season slugs", () => {
  test("two-year seasons by their hyphen form, single seasons by the year; both ways; wrong forms refused", () => {
    assert.equal(seasonSlug("nhl", 2027), "2026-27"); assert.equal(parseSeasonSlug("nhl", "2026-27"), 2027);
    assert.equal(seasonSlug("eng.1", 2026), "2026-27"); assert.equal(parseSeasonSlug("eng.1", "2026-27"), 2026);
    assert.equal(seasonSlug("mlb", 2026), "2026"); assert.equal(parseSeasonSlug("mlb", "2026"), 2026);
    assert.equal(parseSeasonSlug("mlb", "2026-27"), null); assert.equal(parseSeasonSlug("nhl", "2026"), null); assert.equal(parseSeasonSlug("nhl", "2026-28"), null);
    assert.deepEqual(resolveLeagueSeason("NHL", "2026-27"), { league: "nhl", year: 2027 });
    assert.equal(resolveLeagueSeason("xfl", "2026"), null); assert.equal(resolveLeagueSeason("nhl", "abc"), null);
  });
});

describe("one league season", () => {
  const nhl = page("nhl", 2027), mlb = page("mlb", 2026);

  test("the boards are seasons.ts's own, filtered to this league and season — no card holds another league", () => {
    assert.deepEqual(nhl.boards.map((b) => b.label), ["NHL 2026–27"]);
    assert.deepEqual(nhl.boards, seasonBoards([COINS[0], COINS[1]]), "imported, not re-implemented: the same boards the Seasons page builds");
    assert.deepEqual(mlb.boards.map((b) => b.label), ["MLB 2026", "MLB 2026 postseason", "MLB coins with no end date, or for a set number of games"]);
    for (const p of [nhl, mlb]) for (const b of p.boards) assert.equal(b.league, p.league);
    assert.ok(!JSON.stringify([nhl, mlb]).includes("DEBT"), "a feed coin is not a team coin");
  });

  test("ranks restart per card; champion only after the season ended for every coin; during the season, most receipts so far", () => {
    assert.deepEqual(nhl.boards[0].rows.map((r) => [r.rank, r.ticker]), [[1, "OILERS27"], [2, "BRUINS27"]]);
    assert.deepEqual(mlb.boards[0].rows.map((r) => [r.rank, r.ticker]), [[1, "RAYS26"], [2, "YANKEES26"]]);
    assert.deepEqual(nhl.champions, []); assert.equal(nhl.boards[0].leader!.title, "most receipts so far");
    assert.deepEqual(mlb.champions, [{ board: "MLB 2026", ticker: "RAYS26" }]);
    assert.doesNotMatch(JSON.stringify([nhl, mlb]), /"overall|"global|"crossLeague/i);
  });

  test("teams: every team of the league, the ones with coins first, each with a launch link", () => {
    assert.equal(nhl.teams.length, 32);
    assert.deepEqual(nhl.teams.slice(0, 2).map((t) => t.abbr).sort(), ["BOS", "EDM"]);
    assert.deepEqual(nhl.teams.find((t) => t.abbr === "EDM")!.coins, [{ ticker: "OILERS27", outcome: "win" }]);
    assert.equal(nhl.teams.find((t) => t.abbr === "EDM")!.launchHref, "/burnticker/launch?league=nhl&team=EDM");
  });

  test("settled games: the last seven days, one row per game, the reading's source line and the ESPN link only", () => {
    assert.equal(nhl.games.from, "2026-10-04"); assert.equal(nhl.games.to, "2026-10-10");
    assert.deepEqual(nhl.games.rows.map((g) => `${g.date} ${g.away.abbr} ${g.away.score} @ ${g.home.abbr} ${g.home.score}`), ["2026-10-10 EDM 3 @ CGY 1", "2026-10-09 EDM 4 @ BOS 2"]);
    assert.equal(nhl.games.rows[1].source, "Settled on the game's on-chain payout and confirmed by NHL's official scores.");
    assert.equal(nhl.games.rows[0].source, "Settled on a licensed final score and confirmed by NHL's official scores.");
    assert.equal(nhl.games.rows[1].home.name, "Boston Bruins");
    for (const g of nhl.games.rows) assert.match(g.espnUrl, /^https:\/\/www\.espn\.com\/nhl\/scoreboard\/_\/date\/\d{8}$/);
    assert.deepEqual(mlb.games.rows, [], "the MLB game is outside the seven days");
    assert.equal(settledGames("mlb", READINGS, "2026-10-01", "2026-10-10").length, 1);
    assert.equal(settledGames("nhl", READINGS, "2026-10-01", "2026-10-10").length, 3, "the NHL page never lists the MLB game");
  });

  test("JSON-LD: a breadcrumb and one SportsEvent per settled game with only the recorded facts", () => {
    const events = nhl.jsonLd.filter((j) => j["@type"] === "SportsEvent");
    assert.equal(events.length, 2);
    const e = events[1] as Record<string, unknown>;
    assert.equal(e.name, "Edmonton Oilers at Boston Bruins"); assert.equal(e.startDate, "2026-10-09"); assert.equal(e.sport, "Hockey");
    assert.deepEqual(e.homeTeam, { "@type": "SportsTeam", name: "Boston Bruins" });
    for (const k of ["location", "offers", "performer", "organizer", "endDate", "eventStatus", "url"]) assert.ok(!(k in e), `no ${k}: we do not know it`);
    assert.equal(nhl.jsonLd[0]["@type"], "BreadcrumbList");
    assert.equal(((nhl.jsonLd[0].itemListElement as { item: string }[])[2]).item, "https://burnticker.com/burnticker/leagues/nhl/2026-27");
  });

  test("title, description and every visible string pass the copy lint; the page path is the slug form", () => {
    assert.equal(nhl.path, "/burnticker/leagues/nhl/2026-27"); assert.equal(mlb.path, "/burnticker/leagues/mlb/2026");
    assert.equal(nhl.title, "NHL 2026–27 — team coins and receipts");
    for (const p of [nhl, mlb, page("eng.1", 2026), page("cfb", 2026)]) lintAll(leaguePageStrings(p), p.path);
    lintAll(["launch a coin for this team", "See it on ESPN", "No games settled for NHL coins in these dates.", "champion", "This is a stat, and nobody receives anything for it."], "fixed copy");
  });

  test("a past season shows its own boards only; the perpetual card appears on the current season", () => {
    const last = page("mlb", 2025);
    assert.deepEqual(last.boards, []); assert.equal(last.current, false);
    assert.ok(mlb.current);
  });

  test("the OpenGraph card renders and lints", () => {
    const svg = leagueOgSvg({ league: "NHL", season: "2026-27", coins: 2, receipts: 5 });
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1200" height="630"/);
    assert.match(svg, /NHL 2026–27/);
    lintAll([...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]), "og");
  });

  test("gamesFromTitle ignores text that is not a settled-game line", () => {
    assert.deepEqual(gamesFromTitle("nhl", "2026-10-10", "something else"), []);
  });
});

describe("the leagues index", () => {
  const ix = leagueIndex(COINS, NOW);
  test("grouped by sport, sports and leagues alphabetical — never by receipts; counts per league only", () => {
    assert.deepEqual(ix.sports.map((s) => s.id), ["baseball", "basketball", "football", "hockey", "soccer"]);
    for (const s of ix.sports) assert.deepEqual(s.leagues.map((l) => l.label), [...s.leagues.map((l) => l.label)].sort((a, b) => a.localeCompare(b)));
    const nhl = ix.sports.find((s) => s.id === "hockey")!.leagues.find((l) => l.id === "nhl")!;
    assert.equal(nhl.current.href, "/burnticker/leagues/nhl/2026-27"); assert.equal(nhl.coinsThisSeason, 2);
    const mlb = ix.sports.find((s) => s.id === "baseball")!.leagues.find((l) => l.id === "mlb")!;
    assert.equal(mlb.coinsThisSeason, 3, "MLB 2026 season + postseason coins");
    assert.equal(ix.totals.leagues, 25); assert.equal(ix.totals.teamCoins, 5);
  });
});

describe("the sitemap", () => {
  const entries = sitemapEntries({ origin: ORIGIN, nowMs: NOW, coins: [{ ticker: "OILERS27", status: "live", at: 1 }, { ticker: "RAYS26", status: "retired", at: 1 }, { ticker: "DRAFTY", status: "draft", at: 1 }, { ticker: "GONE", status: "expired", at: 1 }], pairs: [{ pairId: "oilers-vs-flames-x" }], seasonCoins: COINS });
  const locs = entries.map((e) => e.loc);
  test("coins (never drafts), pairs, leagues (current seasons + seasons with coins), docs and the app pages", () => {
    for (const p of ["/burnticker/t/OILERS27", "/burnticker/t/RAYS26", "/burnticker/p/oilers-vs-flames-x", "/burnticker/leagues", "/burnticker/leagues/nhl/2026-27", "/burnticker/leagues/mlb/2026", "/burnticker/leagues/eng.1/2026-27", "/burnticker/docs", "/whitepaper.html", "/burnticker/templates", "/burnticker/trust", "/burnticker/launch"]) assert.ok(locs.includes(`${ORIGIN}${p}`), p);
    assert.ok(!locs.some((l) => /DRAFTY|GONE|\/embed\/|\/badge\//.test(l)));
    assert.equal(new Set(locs).size, locs.length, "no duplicates");
  });
  test("valid XML with escaped locations", () => {
    const x = sitemapXml([...entries, { loc: `${ORIGIN}/a?b=1&c=2` }]);
    assert.match(x, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    assert.match(x, /<loc>https:\/\/burnticker\.com\/a\?b=1&amp;c=2<\/loc>/);
    assert.equal((x.match(/<url>/g) ?? []).length, entries.length + 1);
  });
  test("the route answers XML from the registry", async () => {
    const { makeWorld } = await import("./burntickerApiHelpers.ts");
    const { clearLeagueMemo } = await import("@/lib/burnticker/leaguesServe");
    await makeWorld(); clearLeagueMemo();
    const mod = await import("../src/app/burnticker/sitemap.xml/route.ts");
    const res = await mod.GET();
    assert.equal(res.status, 200); assert.match(res.headers.get("content-type")!, /application\/xml/);
    const body = await res.text();
    // OP6-11 (sixth pass): coins are listed at their canonical (mint) address, not the ticker
    assert.match(body, /\/burnticker\/t\/[1-9A-HJ-NP-Za-km-z]{32,44}<\/loc>/); assert.doesNotMatch(body, /\/burnticker\/t\/(BRONCO|DEFICIT2)<\/loc>/); assert.match(body, /\/burnticker\/leagues\/nhl\/\d{4}-\d{2}<\/loc>/);
  });
  test("the league OpenGraph route renders a PNG; an unknown league is a 404", async () => {
    const mod = await import("../src/app/burnticker/leagues/[league]/[season]/og/route.ts");
    const ok = await mod.GET(new Request("http://bt.test/x"), { params: Promise.resolve({ league: "nhl", season: "2026-27" }) });
    assert.equal(ok.status, 200); assert.equal(ok.headers.get("content-type"), "image/png");
    const bad = await mod.GET(new Request("http://bt.test/x"), { params: Promise.resolve({ league: "xfl", season: "2026" }) });
    assert.equal(bad.status, 404);
  });
});
