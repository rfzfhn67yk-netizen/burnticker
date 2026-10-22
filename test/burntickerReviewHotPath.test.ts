// HB-145 root cause (2026-10-20): every 4.3 to 4.8 s hold of the web's event loop landed on a POST /v1/launch/review. A sports review
// parses its league's schedule several times (season over, the meetings verdict, last season, the next game), and the parse asked ourTeam
// for both sides of every listed game; each answer normalised every team name of the league again (teamNameKey, a chain of regexes), so a
// listing whose names miss the exact form cost about a hundred regex chains per side. Measured locally on a synthetic 1,360-game NBA
// listing with provider-style names: 210 ms per rivalry review before, 5 ms after. The team-name normal forms and ourTeam's answers are
// now memoised (sources/espn.ts). These tests hold the answers equal with the memos on and off, the review's time after warm-up, and the
// review's slow line (buildStages.ts reviewSlowLine), which names the stages of any review slower than 1 s.
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_ON_END, lockRule } from "@/lib/burnticker/rules";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { applyDial } from "@/lib/burnticker/dials";
import { candidatesPairRule } from "@/lib/burnticker/guidedLaunch";
import { EspnClient, NBA_LEAGUE_SCHEDULE, findTeams, nbaGames, ourTeam, setTeamMemoForTests, teamNameKey, teamsOf, type LeagueId } from "@/lib/burnticker/sources/espn";
import { setNativeClients } from "@/lib/burnticker/sources/native";
import { REVIEW_SLOW_MS, reviewRuleLabel, reviewSlowLine, stageClock } from "@/lib/burnticker/buildStages";
import { API, CREATOR, POST_HEADERS, callRoute, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS, DEBT_RULE } from "./burntickerHelpers.ts";
import { meetingsRule } from "./burntickerRivalrySeriesHelpers.ts";
import { BUCS_CID, EAGLES_CID } from "./burntickerPolyHelpers.ts";

/** A whole NBA season in the league feed's shape: `rows` games among the 30 teams; `miss` writes the city as the team's code ("PHI 76ers"), so no name matches exactly. */
function nbaSchedule(rows: number, miss: boolean): unknown {
  const teams = teamsOf("nba"), games: unknown[] = [], start = Date.parse("2025-10-21T23:00:00Z"), now = Date.now();
  for (let i = 0; games.length < rows; i++) {
    const d = Math.floor(i / 8), k = i % 8;
    const h = teams[(d * 7 + k * 2) % teams.length], a = teams[(d * 3 + k * 2 + 1) % teams.length];
    if (h.abbr === a.abbr) continue;
    const at = start + d * 86_400_000, done = at < now;
    const side = (t: typeof h, score: number) => ({ teamTricode: t.abbr, teamCity: miss ? t.abbr : t.name.replace(` ${t.nickname}`, ""), teamName: t.nickname, score: done ? score : 0 });
    games.push({ gameId: `00225${String(i + 1).padStart(5, "0")}`, gameDateTimeUTC: new Date(at).toISOString(), gameStatus: done ? 3 : 1, gameStatusText: done ? "Final" : "7:00 pm ET", homeTeam: side(h, 100 + (k % 7)), awayTeam: side(a, 99 + (d % 5)) });
  }
  return { leagueSchedule: { seasonYear: "2025-26", gameDates: [{ games }] } };
}

const quiet = async <T>(f: () => Promise<T>): Promise<T> => { const info = console.info; console.info = () => {}; try { return await f(); } finally { console.info = info; } };
after(() => { setTeamMemoForTests(true); setNativeClients({ espn: null }); });

/** A platform on the fakes with 30 coins and a full NBA schedule behind the review's sports reads. */
async function reviewWorld(rows = 1_360, miss = true) {
  process.env.BURNTICKER_CREATOR_LAUNCHES_ENABLED = "1";
  const w = await makeWorld();
  const series = ["usgs.quakes:6", "usgs.quakenext:6", "usgs.quakenext:7", "treasury.debt", "espn.team:nfl-PHI-loss", "espn.team:nba-LAL", "usgs.volcanoraise"];
  for (let i = 0; i < 28; i++) {
    const s = series[i % series.length];
    const t = w.registry.register({ mint: `Mint${String(i).padStart(3, "0")}${"1".repeat(37)}`, ticker: `COIN${String.fromCharCode(65 + i)}X`, name: `Coin number ${i}`, creator: CREATOR, description: "x", imageUrl: null, links: [], rulesText: lockRule(applyDial(firstPartyRule(s, 0.02), "fraction", 1)).text, feePda: "f", vault: "v", tokenConfig: "c", poolId: "p", launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2026-09-30", status: "draft" } as never, Date.now());
    if (i % 2) w.registry.markLaunched(t.mint, `tx${i}`, "p", "2026-09-30");
  }
  const body = nbaSchedule(rows, miss);
  const c = new EspnClient({ fetchImpl: async (url: string) => (url === NBA_LEAGUE_SCHEDULE ? { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) } : { ok: false, status: 404, json: async () => ({}) }), minIntervalMs: 0, tsdbKey: null, apiSportsKey: null });
  setNativeClients({ espn: c });
  Object.assign(w.p, { seasonSchedule: (league: LeagueId, days: number) => c.upcoming(league, days), teamSeason: (league: LeagueId, team: string, year: number) => c.season(league, team, year) });
  return w;
}

const BODIES: Record<string, unknown> = {
  rivalry: { rule: meetingsRule(), ticker: "PHIVBOS", name: "76ers vs Celtics, 76ers side", raiseSol: "85", pair: { ticker: "BOSVPHI", name: "Celtics vs 76ers, Celtics side" } },
  nbaSeason: { rule: { ...applyDial(firstPartyRule("espn.team:nba-LAL", 0.02), "fraction", 0.02), onEnd: { ...DEFAULT_ON_END } }, ticker: "LALWINS", name: "Lakers Wins" },
  quake: { rule: { ...applyDial(firstPartyRule("usgs.quakenext:7", 0.02), "fraction", 1), onEnd: { ...DEFAULT_ON_END } }, ticker: "QUAKE7", name: "Next Big Quake" },
  debt: { rule: DEBT_RULE, ticker: "DEBTUP", name: "Debt Climb" },
  kalshiTeam: { rule: BRONCOS, ticker: "BRONC2", name: "Bronco Wins", note: "for the fans", warnings: ["a warning"], raiseSol: "85", creatorDescription: "Every time the Broncos win a game a slice of the pool is burned. Not affiliated with the team.", links: [{ label: "X", url: "https://x.com/someone" }] },
  polymarketOnce: { rule: { schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: EAGLES_CID, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 1 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null }, ticker: "PHITITLE", name: "Eagles Title" },
  candidatePair: { rule: candidatesPairRule(EAGLES_CID, 1), ticker: "CANDA", name: "Candidate A", pair: { ticker: "CANDB", name: "Candidate B", market: BUCS_CID, race: "michigan-senate-election-winner" } },
  takenTicker: { rule: { ...applyDial(firstPartyRule("usgs.quakenext:6", 0.02), "fraction", 1), onEnd: { ...DEFAULT_ON_END } }, ticker: "COINBX", name: "Coin number 1" },
};
const review = async (b: unknown) => { const r = await callRoute(`${API}/launch/review`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() as unknown }; };

describe("HB-145: the memoised team names give the same answers", () => {
  test("ourTeam, teamNameKey and findTeams answer the same with the memos on and off, for every provider name in the fixtures", () => {
    const names = new Set<string>();
    const dir = path.join("config", "burnticker", "fixtures", "sports", "tsdb");
    for (const f of fs.readdirSync(dir)) {
      const walk = (v: unknown): void => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if ((k === "strHomeTeam" || k === "strAwayTeam") && typeof x === "string") names.add(x); else walk(x); } };
      walk(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
    }
    const leagues: LeagueId[] = ["nba", "nfl", "mlb", "nhl", "eng.1", "esp.1", "usa.1", "ita.1", "ger.1", "fra.1"];
    for (const lg of leagues) for (const t of teamsOf(lg)) for (const n of [t.name, t.nickname, ...t.alt, `${t.abbr} ${t.nickname}`, t.name.toUpperCase(), `${t.name} FC`]) names.add(n);
    assert.ok(names.size > 500, `${names.size} names`);
    const answers = () => [...names].map((n) => [n, teamNameKey(n), ...leagues.map((lg) => ourTeam(lg, n)?.abbr ?? null), ourTeam("nba", n, "PHI")?.abbr ?? null, findTeams(n).map((t) => `${t.league}:${t.abbr}`).join(",")]);
    setTeamMemoForTests(false);
    const off = answers();
    setTeamMemoForTests(true);
    const cold = answers(), warm = answers();
    assert.deepEqual(cold, off);
    assert.deepEqual(warm, off);
  });

  test("a whole NBA listing parses to the same games with the memos on and off (exact and provider-style names)", () => {
    for (const miss of [false, true]) {
      const body = nbaSchedule(1_360, miss);
      setTeamMemoForTests(false);
      const off = nbaGames(body);
      setTeamMemoForTests(true);
      assert.deepEqual(nbaGames(body), off);
      assert.deepEqual(nbaGames(body), off);
      assert.ok(off.every((g) => g.home.abbr !== "TBD" && g.away.abbr !== "TBD"));
    }
  });

  test("the review answers are identical with the memos on and off, for every representative body", async () => {
    await reviewWorld();
    for (const [k, b] of Object.entries(BODIES)) {
      setTeamMemoForTests(false);
      const off = await quiet(() => review(b));
      setTeamMemoForTests(true);
      const on1 = await quiet(() => review(b)), on2 = await quiet(() => review(b));
      assert.equal(off.status, 200, `${k}: ${JSON.stringify(off.body).slice(0, 300)}`);
      assert.deepEqual(on1, off, k);
      assert.deepEqual(on2, off, k);
    }
  });
});

describe("HB-145: the review's time", () => {
  test("after warm-up, every representative review answers in under 300 ms, the rivalry on a 3,000-game listing with provider-style names included", async () => {
    await reviewWorld(3_000, true);
    for (const [k, b] of Object.entries(BODIES)) {
      await quiet(() => review(b));   // warm-up: module loads, the schedule read, the memos
      const t0 = performance.now();
      const r = await quiet(() => review(b));
      const ms = performance.now() - t0;
      assert.equal(r.status, 200, k);
      assert.ok(ms < 300, `${k}: ${Math.round(ms)} ms`);
    }
  });
});

describe("HB-145: the review's slow line", () => {
  test("a review over 1 s writes one line naming its stages; a fast one writes nothing", async () => {
    let t = 0;
    const c = stageClock({ now: () => t, cpuMicros: () => 0, storeMs: () => 0, loopMonitor: false });
    c.run("proof", () => { t += 1; });
    await c.run("meetings", async () => { t += 4_400; });
    c.run("build", () => { t += 60; });
    const rule = meetingsRule();
    assert.equal(reviewSlowLine(c, 4_461, rule), "[burnticker/review] built in 4461 ms, rule catalogue espn.team: proof 1, meetings 4400, build 60; cpu 0 ms, budget store 0 ms");
    assert.equal(reviewSlowLine(stageClock({ loopMonitor: false }), REVIEW_SLOW_MS, rule), null, "at or under 1 s: no line");
  });

  test("the rule is named by its oracle and series family only, never the creator's words", () => {
    assert.equal(reviewRuleLabel(meetingsRule()), "rule catalogue espn.team");
    assert.equal(reviewRuleLabel({ oracle: "polymarket", market: EAGLES_CID }), "rule polymarket one market");
    assert.equal(reviewRuleLabel(BRONCOS), "rule kalshi KXNFLGAME");
    assert.equal(reviewRuleLabel({ oracle: "catalogue <script>", series: "a b:c" }), "rule cataloguescript ab");
    assert.equal(reviewRuleLabel(null), "rule unknown");
  });

  test("the route times every stage and logs the line only past REVIEW_SLOW_MS", async () => {
    const src = fs.readFileSync("src/app/api/burnticker/v1/launch/review/route.ts", "utf8");
    for (const s of ["body", "proof", "market", "registry", "season", "game", "note", "meetings", "voidBy", "lastSeason", "sinks", "build", "existing", "tickers"]) assert.match(src, new RegExp(`clock\\.run\\("${s}"`), s);
    assert.match(src, /finally \{ const line = reviewSlowLine\(clock, Date\.now\(\) - t0, seen\.rule\); if \(line\) console\.info\(line\); \}/);
    // a slow review through the real route writes the line
    await reviewWorld(200, false);
    const lines: string[] = [], info = console.info;
    const was = Date.now, start = was();
    let calls = 0;
    console.info = (s: string) => { lines.push(String(s)); };
    Date.now = () => start + (++calls) * 50;   // every clock read 50 ms later: the review "takes" well over 1 s
    try { assert.equal((await review(BODIES.quake)).status, 200); } finally { Date.now = was; console.info = info; }
    const line = lines.find((l) => l.startsWith("[burnticker/review]"));
    assert.ok(line, lines.join("\n"));
    assert.match(line!, /^\[burnticker\/review\] built in \d+ ms, rule catalogue usgs\.quakenext: body \d+, proof \d+, registry \d+, season \d+, game \d+, note \d+, meetings \d+, lastSeason \d+, sinks \d+, build \d+, existing \d+, tickers \d+; cpu \d+ ms, loop max \d+ ms, budget store \d+ ms$/);
    assert.doesNotMatch(line!, /QUAKE7|Next Big Quake/);
  });
});
