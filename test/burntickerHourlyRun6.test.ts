// Claude hourly launch audit run 6 (docs/burnticker/audits/continuous/2026-10-19-1810-Denver.md): HB-82 (code side), HB-83, HB-84,
// HB-85, HB-87, HB-88, HB-89 and HS-32 to HS-38, plus the Codex entry BT-INC-20261020T0049Z-02 (a generated name cut mid-phrase).
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { BudgetHoldError, configureApiBudget, memoryStore, resetApiBudget } from "@/lib/burnticker/apiBudget";
import { BACKTEST_BUDGET_CODE, backtestBudgetRefusal, polymarketSearch, teamNextGame } from "@/lib/burnticker/api/handlers";
import { sportsSettled } from "@/lib/burnticker/sources/gameSettle";
import { parseEspnSeries, seasonLabel, teamByAbbr, teamSeries, type EspnClient, type EspnSeries, type Game, type GameSide } from "@/lib/burnticker/sources/espn";
import { oneMarketDate, nextGameWords, seasonPairNames, endChoiceModel, oneShotLoseLine, openNowCards, EVENT_SEARCH_HINT, OPEN_NOW_CATEGORIES, profileFieldProblems } from "@/lib/burnticker/guidedLaunch";
import { LEDGER_NOT_READ_NOTE, resetLedgerCache, v1FeeLedger } from "@/lib/burnticker/trustpack/api";
import type { Rpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { clearFreshReadings, readFresh, FRESH_READING_MS } from "@/lib/burnticker/coverage/freshReading";
import { preflightSelector } from "@/lib/burnticker/coverage/preflight";
import { feedById, loadFixture } from "@/lib/burnticker/catalogue";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { championOutcomeSuggest, describeRule, feedTickerBase } from "@/lib/burnticker/describe";
import { eventIdentity } from "@/lib/burnticker/eventIdentity";
import { markupProblem } from "@/lib/burnticker/launchFields";
import { identityRefusals } from "@/lib/burnticker/launchPreflight";
import { seasonOverOrder, seasonOverRowTag, seasonOverSummaryLine } from "@/lib/burnticker/seasonOver";
import { SPORTS_PROVENANCE, sportsProvenanceLine } from "@/lib/burnticker/sources/provenance";
import { checkUploadBalance, registrySnapshotView, snapshotMissingFact, snapshotIfDue, takeSnapshot, uploadBalanceVerdict, UPLOAD_BALANCE_KIND, UPLOAD_LOW_SNAPSHOTS, IRYS_FUND_SCRIPT, SNAPSHOT_RETRY_MS } from "@/lib/burnticker/ops/snapshot";
import { opsConditions } from "@/lib/burnticker/ops/conditions";
import { PUSH_KIND_OF_ALERT } from "@/lib/burnticker/push";
import { buildCurrentStatus } from "@/lib/burnticker/currentStatus";
import { openRegistry } from "@/lib/burnticker/registry";
import { FakePinUploader, type PinUploader } from "@/lib/burnticker/pin";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { Platform } from "@/lib/burnticker/server";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const cfg = loadCopyLintConfig();
const plain = (t: string) => {
  assert.deepEqual(lintCopy(t, cfg).hits.map((h) => `${h.phrase} (${h.rule})`), [], t);
  assert.doesNotMatch(t, /\bwill\b|\bbuy\b|\bprice\b|coming soon|\bpayouts?\b|\btarget\b|\bguarantee|→|\b20\d\d-\d\d-\d\d\b/i, t);
};

describe("HB-83: the back-test answers a full read budget at once, and a team season counts from the schedule", () => {
  test("a busy bucket is a 503 with the wait; a spent day says when it resets; anything else is not a budget answer", () => {
    const busy = backtestBudgetRefusal(new BudgetHoldError("mlb-stats", { state: "busy", waitMs: 12_400 }));
    assert.ok(busy);
    assert.equal(busy.error, "The source's read budget is in use. Try again in about 13 seconds.");
    assert.equal(busy.retryAfterSec, 13);
    const wrapped = new Error("schedule read failed", { cause: new BudgetHoldError("mlb-stats", { state: "busy", waitMs: 3_000 }) });
    assert.equal(backtestBudgetRefusal(wrapped)?.retryAfterSec, 3, "a wrapped hold is found through its cause");
    const now = Date.parse("2026-10-20T23:00:00Z");
    const day = backtestBudgetRefusal(new BudgetHoldError("mlb-stats", { state: "hold", used: 10, budget: 10 }), now);
    assert.match(day!.error, /used up/);
    assert.equal(day!.retryAfterSec, 3600);
    assert.equal(backtestBudgetRefusal(new Error("HTTP 500")), null);
    assert.equal(BACKTEST_BUDGET_CODE, "backtest-budget");
    for (const t of [busy.error, day!.error]) plain(t);
  });
  test("the route answers through edgeJson (no Cloudflare 502 page) with Retry-After on a budget answer", () => {
    const r = read("src/app/api/burnticker/oracle/backtest/route.ts");
    assert.match(r, /return edgeJson\(r\.body, r\.status, typeof retry === "number" \? \{ "retry-after": String\(retry\), "cache-control": "no-store" \} : \{\}\);/);
    assert.doesNotMatch(r, /NextResponse\.json\(r\.body, \{ status: r\.status \}\)/);
  });
  test("a team season's back-test (crossRead false) makes the one schedule read and settles no game on its own (no per-game reads)", async () => {
    const s = parseEspnSeries(teamSeries("mlb", "COL", "win", { kind: "season", year: 2026 })) as EspnSeries;
    const side = (abbr: string, homeAway: "home" | "away", score: number): GameSide => ({ abbr, id: "", name: abbr, nickname: abbr, score, homeAway, record: null });
    const games: Game[] = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 4, 1 + i)).toISOString();
      return { eventId: String(1000 + i), league: "mlb", seasonType: 2, seasonYear: 2026, startsAt: d, date: d.slice(0, 10), name: "x", completed: true, state: "post", detail: "Final", home: side("COL", "home", i % 3 === 0 ? 5 : 2), away: side("LAD", "away", 3) };
    });
    let seasonReads = 0, gets = 0;
    const client = { season: async () => { seasonReads++; return games; }, get: async () => { gets++; throw new Error("no per-game read expected"); }, tsdbRead: async () => { gets++; throw new Error("no"); }, refusedFeeds: new Set<string>() } as unknown as EspnClient;
    const r = await sportsSettled(client, s, "2026-01-01", { tsdbKey: null, apiSportsKey: null, market: null, payout: null } as unknown as Parameters<typeof sportsSettled>[3], { nowMs: Date.parse("2026-10-19T00:00:00Z"), display: true });
    assert.equal(seasonReads, 1, "one schedule read");
    assert.equal(gets, 0, "no settling reads for the display-only count");
    assert.equal(r.events.reduce((a, e) => a + Number(e.value), 0), 10, "a COL win every third day");
    assert.match(read("src/lib/burnticker/sources/native.ts"), /display: o\.crossRead === false/);
  });
});

describe("HB-84: an event's header close and its rows read one close field on one clock", () => {
  const NOW = Date.parse("2026-10-19T18:00:00Z");
  const mk = (endDate: string | null) => ({ conditionId: `0x${Math.random().toString(16).slice(2)}`, question: "q", yes: "Yes", no: "No", endDate, closed: false, sportsMarketType: null, outcome: "A" });
  const run = async (events: unknown[]) => {
    const p = { polymarketDiscovery: true, polymarket: { search: async () => ({ events, markets: [], tags: [] }) } } as unknown as Platform;
    const r = await polymarketSearch(p, { q: "brazil election" }, NOW);
    assert.equal(r.status, 200);
    return (r.body as { events: { closesAt: string | null; closePassed: boolean; markets: { closePassed: boolean }[] }[] }).events;
  };
  test("no event whose header close is in the future shows a 'past its scheduled close' row", async () => {
    const evs = await run([
      // the Brazil shape: the event closes Oct 25, both outcome markets carry the first round's Oct 4
      { slug: "a", title: "Brazil Presidential Election", url: "u", endDate: "2026-10-25T03:59:00Z", closed: false, markets: [mk("2026-10-04T23:00:00Z"), mk("2026-10-04T23:00:00Z")], marketCount: 2, refused: [] },
      // markets with no close of their own: the header prints the event's date and no row is past
      { slug: "b", title: "B", url: "u", endDate: "2026-10-25T03:59:00Z", closed: false, markets: [mk(null), mk(null)], marketCount: 2, refused: [] },
      // two different closes: the header prints none, each row says its own
      { slug: "c", title: "C", url: "u", endDate: "2026-10-25T03:59:00Z", closed: false, markets: [mk("2026-10-04T23:00:00Z"), mk("2026-11-04T23:00:00Z")], marketCount: 2, refused: [] },
    ]);
    for (const e of evs) {
      const headerFuture = !!e.closesAt && Date.parse(e.closesAt) >= NOW;
      if (headerFuture) assert.ok(e.markets.every((m) => !m.closePassed), JSON.stringify(e));
      assert.equal(e.closePassed, !!e.closesAt && Date.parse(e.closesAt) < NOW, "the header's mark reads the header's own date");
    }
    assert.equal(evs[0].closesAt, "2026-10-04T23:00:00Z", "the header and the rows show the same close");
    assert.equal(evs[0].closePassed, true);
    assert.equal(evs[1].closesAt, "2026-10-25T03:59:00Z");
    assert.equal(evs[2].closesAt, null);
    assert.equal(evs[2].markets[0].closePassed, true, "a row with its own past close, under a header that prints no date");
    assert.equal(oneMarketDate({ endDate: "x", markets: [{ endDate: "y" }] }), "y", "the page prints the same field");
  });
});

describe("HB-85: one ticker pattern for both sides, and the badge's season label in the name", () => {
  test("Nuggets vs Lakers every loss: both carry the league tag, and the name says 2026–27", () => {
    const n = seasonPairNames(teamByAbbr("nba", "DEN")!, teamByAbbr("nba", "LAL")!, 2027, "nba");
    assert.equal(n.a.ticker, "DENNBALOSS");
    assert.equal(n.b.ticker, "LALNBALOSS");
    assert.equal(n.a.name, `Nuggets ${seasonLabel("nba", 2027)} Losses`);
    assert.equal(n.b.name, "Lakers 2026–27 Losses");
  });
  test("for pairs across leagues the two tickers differ only in the team part", () => {
    for (const [lg, a, b, y] of [["nba", "DEN", "LAL", 2027], ["mlb", "COL", "LAD", 2027], ["nhl", "COL", "VGK", 2027], ["nfl", "DEN", "KC", 2026]] as const) {
      const ta = teamByAbbr(lg, a), tb = teamByAbbr(lg, b);
      if (!ta || !tb) continue;
      const n = seasonPairNames(ta, tb, y, lg);
      const tail = (t: string, code: string) => t.slice(code.length);
      assert.equal(tail(n.a.ticker, a), tail(n.b.ticker, b), `${lg}: ${n.a.ticker} / ${n.b.ticker}`);
      assert.ok(n.a.name.includes(seasonLabel(lg, y)), n.a.name);
    }
  });
});

describe("HB-87: an undecided opponent is said in words, a doubleheader is two games, and only the home side reads vs", () => {
  const side = (abbr: string, nickname: string, homeAway: "home" | "away"): GameSide => ({ abbr, id: "", name: nickname, nickname, score: null, homeAway, record: null });
  const game = (id: string, home: GameSide, away: GameSide, startsAt: string): Game => ({ eventId: id, league: "mlb", seasonType: 3, seasonYear: 2026, startsAt, date: startsAt.slice(0, 10), name: "x", completed: false, state: "pre", detail: "Scheduled", home, away });
  test("both sides of one game: exactly one vs and one at", () => {
    const g = game("1", side("CLE", "Guardians", "home"), side("TB", "Rays", "away"), "2026-10-20T23:00:00Z");
    const cle = teamNextGame([g], g, "CLE"), tb = teamNextGame([g], g, "TB");
    assert.equal(nextGameWords(cle), "vs Rays");
    assert.equal(nextGameWords(tb), "at Guardians");
  });
  test("the feed's TB/CLE placeholder is never printed", () => {
    const g = game("2", side("MIL", "Brewers", "home"), side("TBD", "TB/CLE", "away"), "2026-10-24T00:00:00Z");
    const n = teamNextGame([g], g, "MIL");
    assert.equal(n.opponent, null); assert.equal(n.undecided, true);
    assert.equal(nextGameWords(n), "opponent to be decided");
    assert.doesNotMatch(nextGameWords(n), /\//);
  });
  test("a doubleheader says two games", () => {
    const g1 = game("3", side("CLE", "Guardians", "home"), side("TB", "Rays", "away"), "2026-08-01T17:00:00Z"), g2 = game("4", side("CLE", "Guardians", "home"), side("TB", "Rays", "away"), "2026-08-01T23:00:00Z");
    assert.equal(nextGameWords(teamNextGame([g1, g2], g1, "TB")), "at Guardians, two games that day");
    assert.equal(nextGameWords({ opponent: "Rays", home: null, title: "x" }), "against Rays", "never vs when the schedule does not say home");
  });
});

describe("HB-88: a failed chain read never serves the TODO_ placeholders", () => {
  afterEach(() => resetLedgerCache());
  test("each cluster: the chain read stubbed to fail answers with no TODO_ string and, with no published copy, an empty ledger and the not-read note", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hb88-"));
    const rpc: Rpc = { call: async () => { throw new Error("rpc down at https://rpc.example/?api-key=SECRET"); } } as unknown as Rpc;
    for (const cluster of ["devnet", "mainnet"] as const) {
      resetLedgerCache();
      const r = await v1FeeLedger({ cluster, publishDir: dir }, { rpc, root: ROOT });
      assert.equal(r.status, 200);
      const body = JSON.stringify(r.body);
      assert.doesNotMatch(body, /TODO_/, cluster);
      assert.doesNotMatch(body, /SECRET|rpc\.example/, "the raw RPC error stays out");
      const b = r.body as { wallet: string | null; served: string; note: string; entries: unknown[]; source: string };
      if (b.wallet && b.served === "none") { assert.equal(b.note, LEDGER_NOT_READ_NOTE); assert.deepEqual(b.entries, []); assert.equal(b.source, "unavailable"); }
    }
    assert.equal(LEDGER_NOT_READ_NOTE, "Not read for this answer.");
    assert.doesNotMatch(read("src/lib/burnticker/trustpack/api.ts"), /\.\.\.published, expenses, served/, "the published copy's expenses are cleaned too");
  });
});

describe("HB-89: a one-shot rule never judges on a reused reading", () => {
  const SERIES = "usgs.quakes:6", feed = feedById(SERIES)!, fixture = loadFixture(feed), NOW = Date.parse(fixture.fetchedAt!);
  const usgs = () => { const urls: string[] = []; const f = (async (url: string) => { urls.push(url); return { ok: true, status: 200, json: async () => fixture.body }; }) as unknown as FetchLike; return { f, urls }; };
  afterEach(() => { clearFreshReadings(); resetApiBudget(); });
  test("readFresh: reuse false reads again; reuseIfReadAfter keeps the memo only when it is newer than that time", async () => {
    configureApiBudget({ role: "web", enforce: false, store: memoryStore() });
    const u = usgs();
    await readFresh(feed.config, NOW - 60_000, u.f);
    assert.equal((await readFresh(feed.config, NOW, u.f)).cached, true, "a recurring rule reuses the one-minute-old reading");
    assert.equal((await readFresh(feed.config, NOW, u.f, { reuse: false })).cached, false, "a one-shot reads fresh");
    assert.equal(u.urls.length, 2);
    // the memo now holds the NOW reading: kept for a close before it, read again for a close after it
    assert.equal((await readFresh(feed.config, NOW + 1_000, u.f, { reuseIfReadAfter: NOW - 1 })).cached, true);
    assert.equal((await readFresh(feed.config, NOW + 2_000, u.f, { reuseIfReadAfter: NOW + 500 })).cached, false);
    assert.ok(FRESH_READING_MS >= 60_000);
  });
  test("the launch pre-flight of a one-shot (a result published a minute after the review's read) reads again at launch", async () => {
    configureApiBudget({ role: "web", enforce: false, store: memoryStore() });
    const once = feedById("usgs.quakenext:6") ? "usgs.quakenext:6" : null;
    const u = usgs();
    // a recurring rule: the review's reading serves the launch (the 23ccb7ad fix stays)
    await preflightSelector({ oracle: "catalogue", series: SERIES } as BurnRule, { fetchImpl: u.f, now: NOW - 60_000, sleep: async () => {} });
    await preflightSelector({ oracle: "catalogue", series: SERIES } as BurnRule, { fetchImpl: u.f, now: NOW, sleep: async () => {} });
    assert.equal(u.urls.length, 1);
    if (!once) return;
    const v = usgs();
    await preflightSelector({ oracle: "catalogue", series: once } as BurnRule, { fetchImpl: v.f, now: NOW - 60_000, sleep: async () => {} });
    await preflightSelector({ oracle: "catalogue", series: once } as BurnRule, { fetchImpl: v.f, now: NOW, sleep: async () => {} });
    assert.ok(v.urls.length >= 2, `the one-shot read again at launch (${v.urls.length} reads)`);
    assert.match(read("src/lib/burnticker/coverage/preflight.ts"), /const reuse = !resolvesOnce\(\{ \.\.\.rule, market: rule\.market \?\? null \}\) && !isOneTimeSeries\(feed\.id\);/);
  });
});

describe("HS-32: the Event outcome step shows a hint and Open now cards before any query", () => {
  test("the hint passes the copy lint; the cards take Polymarket events from each category in turn, never refused, at most six", () => {
    assert.equal(EVENT_SEARCH_HINT, "Type a team, a candidate, a film or a city. Markets come from Polymarket, and only open ones are listed.");
    plain(EVENT_SEARCH_HINT);
    // HS-46 (hourly run 9): every card carries a close date; sports and elections first in turn, culture only fills what they leave
    const c = (title: string, venue = "polymarket", refused: string[] = []) => ({ id: title, venue, title, refused, launchable: { ok: true }, next: { at: "2026-12-05T17:00:00Z" } });
    const picked = openNowCards([[c("Alpha"), c("Bravo"), c("Feedy", "feed"), c("Charlie")], [c("Sierra"), c("Tango", "polymarket", ["refused"]), c("Uniform")], [c("Culture"), c("Alpha")]]);
    assert.deepEqual(picked.map((x) => x.title), ["Alpha", "Sierra", "Bravo", "Uniform", "Charlie", "Culture"]);
    assert.deepEqual([...OPEN_NOW_CATEGORIES], ["sports", "politics", "culture"]);
  });
  test("the page renders the hint and the cards under the empty box, from the Browse answers", () => {
    const p = read("src/app/burnticker/launch/page.tsx");
    assert.match(p, /\{q2\.trim\(\)\.length < 2 && <p className="text-xs text-neutral-400" data-event-hint>\{EVENT_SEARCH_HINT\}<\/p>\}/);
    assert.match(p, /data-open-now/);
    assert.match(p, /OPEN_NOW_CATEGORIES\.map\(\(c\) => getJson<\{ cards: SourceCardT\[\] \}>\(`\$\{V1\}\/browse\?category=\$\{c\}`\)/);
  });
});

describe("HS-33 and BT-INC-20261020T0049Z-02: generated names carry the rule and end on whole words", () => {
  test("a winner-market outcome is named for its rule with the one title ticker", () => {
    // "Win It All" (the audit's wording) trips the copy lint's win-money rule, so the name is the one title name plus the season
    assert.deepEqual(championOutcomeSuggest("Pro Football: 2027 Champion", "Denver Broncos"), { name: "Broncos Champs 2027", ticker: "DENSB" });
    assert.equal(championOutcomeSuggest("Pro Football: 2027 Champion", "Broncos")?.name, "Broncos Champs 2027");
    assert.equal(championOutcomeSuggest("MLB World Series Champion 2026", "Los Angeles Dodgers")?.name, "Dodgers World Series 2026");
    assert.equal(championOutcomeSuggest("Brazil Presidential Election", "Lula"), null, "any other event keeps the outcome's own name");
    assert.deepEqual(lintCopy("Broncos Champs", cfg).hits, []);
    assert.notDeepEqual(lintCopy("Broncos Win It All", cfg).hits, [], "why the audit's wording is not used");
  });
  test("Netanyahu out by end of 2026: never 'out by Ends'; the name and the rule line keep the question's whole words", () => {
    const id = eventIdentity("Will Netanyahu out by end of 2026?");
    assert.doesNotMatch(id.name, /Ends\b/); assert.doesNotMatch(id.phrase, /\bends of\b/);
    assert.equal(id.phrase, "Netanyahu out by end of 2026");
    assert.ok("Will Netanyahu out by end of 2026".includes(id.name), id.name);
    // a real outcome verb still reads as one
    assert.equal(eventIdentity("Will LeBron James retire before next NBA season?").name, "LeBron James Retires");
  });
});

describe("HS-34: the one-shot end radios say the lose case where it is true", () => {
  const market = { schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: "0xabc", filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 1 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, onEnd: { windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true } } as unknown as BurnRule;
  test("a market coin whose NO burns nothing: both radios start with the NO case", () => {
    const m = endChoiceModel(market, { burnSol: true });
    assert.deepEqual(m.options.map((o) => o.line), ["If the market resolves No, or after its one burn, the rest goes to $DEFICIT's burn.", "If the market resolves No, or after its one burn, the rest is sent to Solana's incinerator and burned."]);
    for (const o of m.options) plain(o.line);
    const noSide = { ...market, binary: { onYes: null, onNo: { fractionOfPool: 1 } } } as unknown as BurnRule;
    assert.equal(endChoiceModel(noSide, { burnSol: true }).options[0].line, oneShotLoseLine("Yes", "deficit"));
  });
  test("a one-shot with no lose case keeps the after-the-burn words (the sentence is only used where it is true)", () => {
    const quake = { ...market, oracle: "catalogue", series: "usgs.quakenext:6", market: null, kind: "scalar", binary: null, scalar: { perUnit: { fractionOfPool: 1 }, direction: "up", baseline: 0 } } as unknown as BurnRule;
    const m = endChoiceModel(quake, { burnSol: true });
    for (const o of m.options) assert.doesNotMatch(o.line, /resolves No/);
  });
});

describe("HS-35: published-data tickers are a short name, never a cut word", () => {
  test("the catalogue short name, the series code, else whole words", () => {
    assert.equal(feedTickerBase("fred.UNRATE", "U.S. unemployment rate (FRED UNRATE)"), "UNRATE");
    assert.equal(feedTickerBase("fred.CPIAUCSL", "Consumer prices"), "CPI");
    assert.equal(feedTickerBase("acme.SALES", "Monthly sales"), "SALES");
    assert.equal(feedTickerBase("acme.thing", "Home sales count"), "HOMESALES");
    assert.equal(feedTickerBase("acme.thing", "Unemployment insurance claims"), "UIC", "a first word longer than ten letters gives the initials");
    const feed = feedById("fred.UNRATE");
    if (feed) {
      const r = { schema: "burnticker.rules/v1", oracle: "catalogue", series: "fred.UNRATE", market: null, filter: {}, kind: "scalar", binary: null, scalar: { perUnit: { fractionOfPool: 0.05 }, direction: "up", baseline: "previousSettlement" }, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } as unknown as BurnRule;
      const t = describeRule(r, { ticker: "", feed: { title: feed.title, sourceName: feed.config.sourceName ?? "FRED", crossRead: null, unitLabel: "0.1 point" } } as never);
      assert.doesNotMatch(t.ticker, /UNEMPLOYME/);
      assert.equal(t.ticker, "UNRATE");
    }
  });
});

describe("HS-36: HTML tags and entities are refused like links", () => {
  test("the sentence, the server refusal and the name step's field problem", () => {
    const line = "The description cannot have HTML tags or entities. Write it as plain text.";
    assert.equal(markupProblem("Go <b>Rockies</b>"), line);
    assert.equal(markupProblem("Rockies &amp; more"), line);
    assert.equal(markupProblem("<script>alert(1)</script>"), line);
    assert.equal(markupProblem("Rockies win 3 < 5 and 5 > 3, R&D team"), "", "a lone angle bracket or ampersand is plain text");
    plain(line);
    const r = identityRefusals({ ticker: "ROCKS", name: "Rocks", description: "Go <b>Rockies</b>", note: "" }, { reserved: new Set(), majors: new Set() } as never);
    assert.ok(r.some((x) => x.code === "markup" && x.field === "description" && x.message === line), JSON.stringify(r));
    const p = profileFieldProblems({ description: "Go <i>team</i>", x: "", telegram: "", website: "", image: null, rights: false, imageState: null, generated: null } as never);
    assert.ok(p.some((x) => x.field === "description" && x.text === line));
  });
});

describe("HS-37: season-over teams are said once, greyed and listed last", () => {
  test("the summary, the row tag and the order", () => {
    const s = seasonOverSummaryLine(27, "2026", "2027");
    assert.equal(s, "27 teams have finished the 2026 season. Pick one of them to follow the 2027 season instead.");
    plain(s); plain(seasonOverRowTag("2027"));
    assert.deepEqual(seasonOverOrder([{ n: "A", seasonOver: true }, { n: "B" }, { n: "C", seasonOver: true }, { n: "D", seasonOver: false }]).map((t) => t.n), ["B", "D", "A", "C"]);
    const p = read("src/app/burnticker/launch/page.tsx");
    assert.match(p, /data-season-over-summary>\{seasonOverSummaryLine\(over, seasonLabel\(lg, yr\), nextLabel\)\}/);
    assert.match(p, /seasonOverOrder\(teams\.filter\(teamFilter\)\)/);
  });
});

describe("HS-38: the espn label note lives on the docs page, not in the wizard", () => {
  test("the wizard line has no espn; the docs page says it beside the source list", () => {
    assert.doesNotMatch(sportsProvenanceLine(), /espn/i);
    assert.match(read("src/app/burnticker/docs/page.tsx"), /data-rule-names-note>The catalogue lists each source by its rule name\. \{SPORTS_PROVENANCE\.noEspn\}/);
    plain(SPORTS_PROVENANCE.noEspn);
  });
});

describe("HB-82: the upload balance alert and the missing-snapshot line", () => {
  const T = Date.parse("2026-10-20T06:00:00Z");
  const balanced = (lamports: bigint, address = "Payer1111111111111111111111111111111111111"): PinUploader & { reads: number } => {
    const u = new FakePinUploader() as unknown as PinUploader & { reads: number };
    u.reads = 0;
    u.balance = async () => { u.reads++; return { address, balanceLamports: lamports, priceLamports: BigInt(2_700) }; };
    return u;
  };
  test("the threshold: fewer than seven daily snapshots is low, and the text names the payer and the ops script", () => {
    const low = uploadBalanceVerdict({ address: "PayerX", balanceLamports: BigInt(2_700 * 6), priceLamports: BigInt(2_700) });
    assert.equal(low.covers, 6); assert.equal(low.low, true);
    assert.match(low.text, /PayerX/); assert.ok(low.text.includes(IRYS_FUND_SCRIPT));
    assert.equal(uploadBalanceVerdict({ address: "P", balanceLamports: BigInt(2_700 * UPLOAD_LOW_SNAPSHOTS), priceLamports: BigInt(2_700) }).low, false);
    assert.equal(uploadBalanceVerdict({ address: "P", balanceLamports: BigInt(0), priceLamports: BigInt(2_700) }).covers, 0);
    assert.equal(PUSH_KIND_OF_ALERT[UPLOAD_BALANCE_KIND], "pin-budget", "an existing push kind");
  });
  test("once a UTC day, one alert when low; a failed read is tried again after the retry wait", async () => {
    const reg = openRegistry(":memory:");
    const alerts: string[] = [];
    const u = balanced(BigInt(0));
    const alert = (kind: string, key: string) => { alerts.push(`${kind}|${key}`); };
    assert.equal((await checkUploadBalance({ registry: reg, uploader: u, now: T, log: () => {}, alert }))?.low, true);
    assert.equal(await checkUploadBalance({ registry: reg, uploader: u, now: T + 3_600_000, log: () => {}, alert }), null, "the same day: no second read");
    assert.equal(u.reads, 1);
    assert.deepEqual(alerts, [`${UPLOAD_BALANCE_KIND}|${UPLOAD_BALANCE_KIND}:2026-10-20`]);
    await checkUploadBalance({ registry: reg, uploader: u, now: T + 86_400_000, log: () => {}, alert });
    assert.equal(u.reads, 2, "the next UTC day reads again");
    const failing = balanced(BigInt(0)); failing.balance = async () => { failing.reads++; throw new Error("irys down"); };
    const reg2 = openRegistry(":memory:");
    await checkUploadBalance({ registry: reg2, uploader: failing, now: T, log: () => {} });
    await checkUploadBalance({ registry: reg2, uploader: failing, now: T + 60_000, log: () => {} });
    await checkUploadBalance({ registry: reg2, uploader: failing, now: T + SNAPSHOT_RETRY_MS + 1, log: () => {} });
    assert.equal(failing.reads, 2, "retried after the wait, not every cycle");
    assert.equal(await checkUploadBalance({ registry: openRegistry(":memory:"), uploader: new FakePinUploader(), now: T, log: () => {} }), null, "an uploader with no balance read is skipped");
    assert.match(read("src/lib/burnticker/pin.ts"), /await takeOrThrow\("irys", \{ units: 2, requests: 2 \}\);/);
  });
  test("a missing day's snapshot is a condition on ops.json and a line on current-status until it is pinned", async () => {
    const reg = openRegistry(":memory:");
    assert.equal(snapshotMissingFact(reg, Date.parse("2026-10-20T00:10:00Z")), null, "not due before 00:15 UTC");
    const fail: PinUploader = { name: "irys", upload: async () => { throw new Error("402 Not enough balance for transaction"); } };
    await snapshotIfDue({ registry: reg, uploader: fail, now: T, cluster: "devnet", log: () => {} });
    const m = snapshotMissingFact(reg, T + 60_000)!;
    assert.equal(m.date, "2026-10-20");
    assert.match(m.lastError!, /402/);
    const c = opsConditions({ snapshot: m });
    assert.equal(c[0].id, "bt-snapshot-missing:2026-10-20");
    assert.match(c[0].text, /Today's registry snapshot is not pinned yet\. The last upload failed, and the keeper tries again every 30 minutes\. The upload said: 402/);
    plain(m.line);
    const view = registrySnapshotView(reg, T + 60_000)!;
    assert.deepEqual([view.pinned, view.line], [false, m.line]);
    const cs = buildCurrentStatus({ root: ROOT, env: {}, chain: {}, now: T, registrySnapshot: view });
    assert.ok(cs.lines.includes(m.line)); assert.deepEqual(cs.registrySnapshot, view);
    // pinned after the retry: the condition and the line go away
    await snapshotIfDue({ registry: reg, uploader: new FakePinUploader(), now: T + SNAPSHOT_RETRY_MS + 1, cluster: "devnet", log: () => {} });
    assert.equal(snapshotMissingFact(reg, T + SNAPSHOT_RETRY_MS + 2), null);
    assert.deepEqual(registrySnapshotView(reg, T + SNAPSHOT_RETRY_MS + 2), { date: "2026-10-20", pinned: true, line: null });
    assert.ok(!buildCurrentStatus({ root: ROOT, env: {}, chain: {}, now: T, registrySnapshot: registrySnapshotView(reg, T + SNAPSHOT_RETRY_MS + 2) }).lines.includes(m.line));
  });
  test("a day missed entirely: the snapshot path takes a past date, but the bytes are the registry as read now (no back-fill is forced)", async () => {
    const reg = openRegistry(":memory:");
    const r = await takeSnapshot({ registry: reg, uploader: new FakePinUploader(), now: Date.parse("2026-10-21T06:00:00Z"), date: "2026-10-20", cluster: "devnet" });
    assert.equal(r.record.date, "2026-10-20");
    assert.match(read("src/lib/burnticker/ops/snapshot.ts"), /if \(snapshotFor\(registry, utcDay\(now\)\)\) return false;/, "the keeper's due check looks at today only");
  });
  test("the keeper wires the balance check after its snapshot step", () => {
    const k = read("src/lib/burnticker/ops/keeperOps.ts");
    assert.match(k, /await checkUploadBalance\(\{ registry: reg, uploader: this\.o\.uploader, now, log: this\.o\.log, alert \}\);/);
  });
});
