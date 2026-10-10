// THE UNIVERSAL SEARCH AND THE ELECTIONS FLOW (2026-10-10, the owner's usability test: "If I wanted to add a coin for Abdul El-Sayed to
// win the Michigan Senate seat, I'm still having a hard time getting there"). The owner's test cases as fixtures; the guided Elections
// flow (race type → state → race → outcome; unnamed placeholders hidden); the sports pickers on the ESPN scoreboard; the election-pair
// template; and the rule that no discovery payload carries a price, odds, volume or liquidity (venues.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { universalSearch, raceCards } from "@/lib/burnticker/search";
import { classifyRace, loadRaces, outcomeCardTitle, raceFromEvent, searchRaces, type Race } from "@/lib/burnticker/elections";
import { electionPairTemplate } from "@/lib/burnticker/electionPair";
import { parseEventsBody } from "@/lib/burnticker/oracle/polymarket";
import { catalogueSources } from "@/lib/burnticker/api/handlers";
import { MARKET_DATA_KEY, scrubMarketData } from "@/lib/burnticker/venues";
import { setNativeClients } from "@/lib/burnticker/sources/native";
import { buildOpenApi, endpoint } from "@/lib/burnticker/api/spec";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import type { FeedLike } from "@/lib/burnticker/search";
import { fx } from "./burntickerHelpers.ts";
import { API, callRoute, makeWorld, validateSchema } from "./burntickerApiHelpers.ts";
import { GAMMA_TABLE } from "./burntickerPolyHelpers.ts";
import { ESPN_NOW, espnFixtureClient, exactFetch, nwsFixtureClient } from "./burntickerFirstPartyHelpers.ts";

const MI = fx("polymarket/event.michigan-senate.json") as { url: string; body: unknown[] };
const IDX = fx("polymarket/midterms.index.json") as { pages: { url: string; body: unknown[] }[] };
const POLY: Record<string, unknown> = { [MI.url]: MI.body, ...Object.fromEntries(IDX.pages.map((p) => [p.url, p.body])) };
const polyGet = async (u: string) => { const r = await exactFetch(POLY)(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const DEM = "0xbfeb6d4cf3";
const feeds = () => catalogueSources(ESPN_NOW).sources as unknown as FeedLike[];
const deps = (over: Record<string, unknown> = {}) => ({ venues: { kalshi: false, polymarket: true, feeds: true }, feeds: feeds(), espn: espnFixtureClient(), polyGet, refuse: () => [], kalshiSearch: null, derbyHref: null, nowMs: ESPN_NOW, ...over });

/** Every key of a JSON value, recursively. */
const keysOf = (v: unknown, out: string[] = []): string[] => { if (Array.isArray(v)) v.forEach((x) => keysOf(x, out)); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); keysOf(x, out); } return out; };
const assertNoMarketData = (v: unknown, label: string) => { const bad = keysOf(v).filter((k) => MARKET_DATA_KEY.test(k)); assert.deepEqual([...new Set(bad)], [], `${label} carries market data keys`); };

describe("the elections index", () => {
  test("titles classify into Senate / House / Governor / party control; derivative events are skipped", () => {
    assert.deepEqual(classifyRace("Michigan Senate Election Winner"), { type: "senate", state: "MI", district: null });
    assert.deepEqual(classifyRace("North Carolina Governor Election Winner"), { type: "governor", state: "NC", district: null });
    assert.deepEqual(classifyRace("CA-22 House Election Winner"), { type: "house", state: "CA", district: "22" });
    assert.equal(classifyRace("Which party will win the Senate in 2026?")?.type, "control");
    assert.equal(classifyRace("Michigan Senate Election Margin of Victory"), null);
  });

  test("the Michigan Senate race: named outcomes from groupItemTitle, the unnamed placeholders hidden, the SoS cross-read, the resolution rules", () => {
    const race = raceFromEvent(parseEventsBody(MI.body)[0])!;
    assert.deepEqual(race.outcomes.map((o) => o.label), ["Abdul El-Sayed (D)", "Mike Rogers (R)"]);
    assert.ok(race.hiddenPlaceholders >= 10, "Person A…J (active: false) are hidden");
    assert.equal(race.settlesOn, "2026-11-04");
    assert.match(race.sos.url, /michigan\.gov\/sos/);
    assert.match(race.description ?? "", /nominee of the party/);
    assert.equal(outcomeCardTitle(race, race.outcomes[0]), "Abdul El-Sayed (D) wins the Michigan Senate race · settles 2026-11-04 · Polymarket on-chain payout + Michigan SoS certified results");
  });

  test("the paged index finds the race; search ranks the named candidate first", async () => {
    const races = await loadRaces(polyGet);
    assert.ok(races.length > 100, `${races.length} races`);
    assert.ok(races.some((r) => r.slug === "michigan-senate-election-winner"));
    const hits = searchRaces(races, "El-Sayed wins Michigan Senate");
    assert.equal(hits[0].outcome.label, "Abdul El-Sayed (D)");
    assert.ok(!hits.some((h) => h.race.state !== "MI"), "other states' Senate races do not match a Michigan query");
  });
});

describe("the universal search — the owner's test cases (Kalshi off)", () => {
  test("'El-Sayed wins Michigan Senate' → the Michigan Senate card, the rule pre-filled (one-shot, the Democratic outcome's market)", async () => {
    const r = await universalSearch("El-Sayed wins Michigan Senate", deps());
    const top = r.cards[0];
    assert.equal(top.venue, "polymarket");
    assert.equal(top.title, "Abdul El-Sayed (D) wins the Michigan Senate race · settles 2026-11-04 · Polymarket on-chain payout + Michigan SoS certified results");
    assert.ok(top.rule?.market?.startsWith(DEM)); assert.equal(top.rule?.oracle, "polymarket"); assert.deepEqual(top.rule?.binary, { onYes: { fractionOfPool: 0.05 }, onNo: null });
    assert.match(top.howSettles ?? "", /Democratic nominee/); assert.match(top.howSettles ?? "", /Resolution rules \(Polymarket\)/);
    assert.equal(top.suggestedTicker, "ELSAYED");
    assertNoMarketData(r, "search payload");
  });

  test("'Eagles win' → an ESPN team card; 'US debt rises $1B' → Treasury; 'Detroit high above 90' → NWS; 'WIF vs SHIB' → the Coin vs Coin tile", async () => {
    const eagles = await universalSearch("Eagles win", deps());
    assert.equal(eagles.cards[0].venue, "espn"); assert.equal(eagles.cards[0].rule?.series, "espn.team:nfl-PHI-win"); assert.equal(eagles.cards[0].venueLabel, "ESPN scoreboard · first-party");
    assert.ok(eagles.cards.some((c) => c.rule?.series === "espn.game:nfl-401872981-PHI-win"), "the next game (at JAX) as a one-game card");
    assert.ok(!eagles.cards.some((c) => c.venue === "kalshi"));
    const debt = await universalSearch("US debt rises $1B", deps());
    assert.equal(debt.cards[0].rule?.series, "treasury.debt"); assert.equal(debt.cards[0].title, "burns per $1B added");
    const wx = await universalSearch("Detroit high above 90", deps());
    assert.equal(wx.cards[0].venue, "nws"); assert.equal(wx.cards[0].rule?.series, "nws.high:DTW-90");
    const derby = await universalSearch("WIF vs SHIB", deps());
    assert.equal(derby.cards.length, 1); assert.equal(derby.cards[0].venue, "tile"); assert.equal(derby.cards[0].href, null); assert.equal(derby.cards[0].subtitle, "not built yet", "the copy lint forbids \"coming soon\"");
    const derbyLive = await universalSearch("WIF vs SHIB", deps({ derbyHref: "/burnticker/derby" }));
    assert.equal(derbyLive.cards[0].href, "/burnticker/derby");
    const none = await universalSearch("zzqx nothing matches this", deps({ polyGet: null }));
    assert.equal(none.empty, true);
    const cfg = loadCopyLintConfig();
    for (const c of [...eagles.cards, ...debt.cards, ...wx.cards]) assert.ok(lintCopy(c.title, cfg).ok, c.title);
  });

  test("Polymarket discovery off → no Polymarket cards; Kalshi off → no Kalshi cards", async () => {
    const r = await universalSearch("El-Sayed wins Michigan Senate", deps({ venues: { kalshi: false, polymarket: false, feeds: true } }));
    assert.ok(!r.cards.some((c) => c.venue === "polymarket"));
    let asked = false;
    await universalSearch("Fed meeting", deps({ venues: { kalshi: false, polymarket: false, feeds: true }, kalshiSearch: async () => { asked = true; return []; } }));
    assert.equal(asked, false);
  });

  test("the scrubber drops market data keys at any depth", () => {
    assert.deepEqual(scrubMarketData({ a: 1, yesPrice: 0.4, nested: [{ volume: 3, label: "x", impliedChance: 0.2, bestBid: 1 }] }), { a: 1, nested: [{ label: "x" }] });
  });
});

describe("the API: /search, /elections, /elections/pair, /sports — schemas, no market data", () => {
  const DOC = buildOpenApi() as unknown as Record<string, unknown>;
  const schemaOf = (op: string, status: number) => { const ep = endpoint(op); return (DOC.paths as Record<string, Record<string, { responses: Record<string, { content: { "application/json": { schema: Record<string, unknown> } } }> }>>)[ep.path][ep.method.toLowerCase()].responses[String(status)].content["application/json"].schema; };
  const get = async (q: string, op: string, expect = 200) => {
    const r = await callRoute(`${API}${q}`); const body = await r.json() as Record<string, unknown>;
    assert.equal(r.status, expect, `${q}: ${JSON.stringify(body).slice(0, 240)}`);
    assert.deepEqual(validateSchema(schemaOf(op, expect), body, DOC), [], `${q} matches its schema`);
    return body;
  };
  const world = async () => { Object.assign(GAMMA_TABLE, POLY); setNativeClients({ espn: espnFixtureClient(), nws: nwsFixtureClient() }); return makeWorld(); };

  test("search and elections through the routes; no payload carries a price, odds, volume or liquidity", async () => {
    await world();
    const s = await get(`/search?q=${encodeURIComponent("El-Sayed wins Michigan Senate")}`, "search") as { cards: { title: string }[] };
    assert.match(s.cards[0].title, /^Abdul El-Sayed \(D\) wins the Michigan Senate race/);
    const types = await get("/elections", "elections") as { types: { id: string; races: number }[] };
    assert.ok(types.types.find((t) => t.id === "senate")!.races > 10);
    const states = await get("/elections?type=senate", "elections") as { states: { abbr: string }[] };
    assert.ok(states.states.some((x) => x.abbr === "MI"));
    const mi = await get("/elections?type=senate&state=MI", "elections") as { races: { slug: string; outcomes: { label: string; title: string; rule: { market: string } }[]; hiddenPlaceholders: number }[] };
    assert.equal(mi.races[0].slug, "michigan-senate-election-winner"); assert.deepEqual(mi.races[0].outcomes.map((o) => o.label), ["Abdul El-Sayed (D)", "Mike Rogers (R)"]);
    for (const [q, label] of [["/search?q=Eagles%20win", "search"], ["/elections?type=senate&state=MI", "elections"], ["/browse?category=politics", "browse"], ["/polymarket/search?q=eagles", "polymarket search"]] as const) {
      const r = await callRoute(`${API}${q}`); assertNoMarketData(await r.json(), label);
    }
    setNativeClients({ espn: null, nws: null });
  });

  test("sports pickers on the ESPN scoreboard: teams with next game and record; games with each side's one-game selector", async () => {
    await world();
    const lg = await get("/sports/teams", "listSportsTeams") as { leagues: { id: string }[] };
    assert.deepEqual(lg.leagues.map((l) => l.id), ["nfl", "nba", "mlb", "nhl"]);
    const t = await get("/sports/teams?league=nfl&q=eagles", "listSportsTeams") as { teams: { abbr: string; series: { win: string }; next: { opponent: string } | null; record: string | null }[] };
    assert.equal(t.teams[0].abbr, "PHI"); assert.equal(t.teams[0].series.win, "espn.team:nfl-PHI-win");
    const g = await get("/sports/games?league=nfl&q=eagles", "listSportsGames") as { games: { eventId: string; a: { abbr: string }; b: { abbr: string }; series: { aLoss: string; bLoss: string } }[] };
    assert.equal(g.games[0].eventId, "401872981"); assert.equal(g.games[0].series.aLoss, "espn.game:nfl-401872981-PHI-loss"); assert.equal(g.games[0].series.bLoss, "espn.game:nfl-401872981-JAX-loss");
    await get("/sports/games?league=xfl", "listSportsGames", 400);
    setNativeClients({ espn: null, nws: null });
  });
});

describe("the election-pair template (El-Sayed vs Rogers, Michigan Senate 2026)", () => {
  const race = (): Race => raceFromEvent(parseEventsBody(MI.body)[0])!;
  test("two coins, symmetric components, pending gates listed — never hidden", () => {
    const r = race(), [a, b] = r.outcomes;
    const t = electionPairTemplate(r, a, b, { a: "S6MI00418", b: "S4MI00595" });
    assert.equal(t.a.components.fecBeats?.series, "fec.beats:S6MI00418-S4MI00595"); assert.equal(t.b.components.fecBeats?.series, "fec.beats:S4MI00595-S6MI00418");
    assert.equal(t.a.components.winner.market, a.conditionId); assert.deepEqual(t.a.components.winner.binary, { onYes: { fractionOfPool: 0.1 }, onNo: null });
    assert.equal(t.a.ticker, "ELSAYED"); assert.equal(t.b.ticker, "ROGERS");
    assert.equal(t.launchable.component, "winner");
    assert.ok(t.pending.some((p) => /composite rules/.test(p))); assert.ok(t.pending.some((p) => /same operator/.test(p)));
    assert.equal(t.voidClause.kind, "both-or-neither"); assert.equal(t.voidClause.voidBy, null);
    const cfg = loadCopyLintConfig();
    for (const s of [t.a.sentences.fecBeats!, t.a.sentences.winner, t.b.sentences.fecBeats!, t.b.sentences.winner]) assert.ok(lintCopy(s, cfg).ok, s);
  });

  test("TODO (fails when the pairs core lands without the template wiring it): the both-or-neither void clause", () => {
    // The Coin vs Coin branch adds pending-pair / voidBy / a weekly fallback clock to the pairs core. Until then the template carries a
    // stub. When rules.ts (or the registry) gains `voidBy`, this test demands the template stop stubbing it.
    const core = ["src/lib/burnticker/rules.ts", "src/lib/burnticker/registry.ts"].map((f) => fs.readFileSync(path.join(import.meta.dirname, "..", f), "utf8")).join("\n");
    const landed = /\bvoidBy\b/.test(core);
    const t = electionPairTemplate(race(), race().outcomes[0], race().outcomes[1], { a: null, b: null });
    if (landed) assert.notEqual(t.voidClause.voidBy, null, "the pairs core has voidBy: wire it into the election-pair template");
    else assert.equal(t.voidClause.pendingPair, true);
  });

  test("the FEC-beats component does not pass the coverage gate (same-operator cross-read) — refused, not weakened", async () => {
    const { preflightSelector } = await import("@/lib/burnticker/coverage/preflight");
    const t = electionPairTemplate(race(), race().outcomes[0], race().outcomes[1], { a: "S6MI00418", b: "S4MI00595" });
    const p = await preflightSelector(t.a.components.fecBeats!, { now: ESPN_NOW });
    assert.equal(p.refusal?.code, "no-cross-read"); assert.match(p.refusal!.reason, /fec\.filings/);
  });

  test("raceCards: the outcome card links the race and the SoS page", () => {
    const cards = raceCards([race()], "Rogers Michigan Senate");
    assert.equal(cards[0].title.startsWith("Mike Rogers (R) wins the Michigan Senate race"), true);
    assert.match(cards[0].settlement, /michigan\.gov\/sos/);
  });
});
