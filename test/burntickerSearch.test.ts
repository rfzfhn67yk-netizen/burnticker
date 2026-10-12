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
import { CHAMPIONSHIPS, ESPN_NOW, espnFixtureClient, exactFetch, nwsFixtureClient } from "./burntickerFirstPartyHelpers.ts";

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
    assert.equal(outcomeCardTitle(race, race.outcomes[0]), "Abdul El-Sayed (D) wins the Michigan Senate race, which settles on 2026-11-04.");
    assert.equal(race.settlement, "Polymarket's on-chain payout, checked against the Michigan Secretary of State's certified results");
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
    assert.equal(top.title, "Abdul El-Sayed (D) wins the Michigan Senate race, which settles on 2026-11-04.");
    assert.ok(top.rule?.market?.startsWith(DEM)); assert.equal(top.rule?.oracle, "polymarket"); assert.deepEqual(top.rule?.binary, { onYes: { fractionOfPool: 0.1 }, onNo: null }, "a one-shot defaults to 10 % of the pool");
    assert.match(top.howSettles ?? "", /Democratic nominee/); assert.match(top.howSettles ?? "", /Resolution rules \(Polymarket\)/);
    assert.equal(top.suggestedTicker, "ELSAYED");
    assertNoMarketData(r, "search payload");
  });

  test("'Eagles win' → a team card (the NFL schedule needs the licensed key: said, not faked); 'US debt rises $1B' → Treasury; 'Detroit high above 90' → NWS; 'WIF vs SHIB' → the Coin vs Coin tile", async () => {
    const eagles = await universalSearch("Eagles win", deps());
    assert.equal(eagles.cards[0].venue, "espn"); assert.equal(eagles.cards[0].rule?.series, "espn.team:nfl-PHI.21-win-s2026", "this season by default, the team pinned by its ESPN id"); assert.equal(eagles.cards[0].venueLabel, "On-chain payout · league's official feed"); assert.doesNotMatch(eagles.cards[0].settlement, /ESPN/);
    // launch audit 5 L05: said in plain words (no env-var name in user copy), and never a fallback to ESPN
    // website-15 item 8: the card says "Next game: not available." and nothing else about the feed; the reason goes to the log
    assert.equal(eagles.cards[0].scheduleUnavailable, true, "no TheSportsDB key on this host: no NFL schedule, and never a fallback to ESPN"); assert.equal(eagles.cards[0].note, null);
    assert.doesNotMatch(eagles.cards[0].note ?? "", /BURNTICKER_|ESPN/);
    assert.ok(!eagles.cards.some((c) => c.matchup), "no next game without a schedule");
    assert.ok(!eagles.cards.some((c) => c.venue === "kalshi"));
    const debt = await universalSearch("US debt rises $1B", deps());
    assert.equal(debt.cards[0].rule?.series, "treasury.debt"); assert.match(debt.cards[0].title, /^Burns 2% per \$1B added — /);
    const wx = await universalSearch("Detroit high above 90", deps());
    // launch audit 5 L04: "above 90" is strictly above — the report gives whole °F, so 91 or hotter, and the card says what it read
    assert.equal(wx.cards[0].venue, "nws"); assert.equal(wx.cards[0].rule?.series, "nws.high:DTW-91");
    assert.match(wx.cards[0].note ?? "", /You wrote “above 90”/); assert.match(wx.cards[0].interpreted ?? "", /91 °F or hotter/);
    const wxAt = await universalSearch("Detroit high reaches 90", deps());
    assert.equal(wxAt.cards[0].rule?.series, "nws.high:DTW-90"); assert.equal(wxAt.cards[0].note, null);
    const derby = await universalSearch("WIF vs SHIB", deps());
    assert.equal(derby.cards.length, 1); assert.equal(derby.cards[0].venue, "tile"); assert.equal(derby.cards[0].href, null); assert.equal(derby.cards[0].subtitle, "not built yet", "the copy lint forbids \"coming soon\"");
    const derbyLive = await universalSearch("WIF vs SHIB", deps({ derbyHref: "/burnticker/derby" }));
    assert.equal(derbyLive.cards[0].href, "/burnticker/derby");
    const none = await universalSearch("zzqx nothing matches this", deps({ polyGet: null }));
    assert.equal(none.empty, true);
    const cfg = loadCopyLintConfig();
    for (const c of [...eagles.cards, ...debt.cards, ...wx.cards]) assert.ok(lintCopy(c.title, cfg).ok, c.title);
  });

  test("names are matched forgivingly but completely: 'el sayed' ≡ 'El-Sayed' ≡ 'elsayed'; a two-letter token never surfaces a card; each fixture's expected card first", async () => {
    const top = async (q: string) => (await universalSearch(q, { ...deps(), polyGet: async (u: string) => { const r = await exactFetch({ ...POLY, ...CHAMPIONSHIPS })(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); } }));
    for (const q of ["e", "el", "el s", "el sa"]) { const r = await top(q); assert.equal(r.cards.length, 0, `${q} surfaces nothing`); }
    for (const q of ["el sayed", "El-Sayed", "elsayed", "abdul el sayed", "EL SAYED", "Él-Sayed"]) {
      const r = await top(q);
      assert.ok(r.cards[0]?.title.startsWith("Abdul El-Sayed (D) wins the Michigan Senate race"), `${q} → ${r.cards[0]?.title}`);
      assert.ok(!r.cards.some((c) => c.venue === "espn" || c.group === "teams"), `${q}: no sports card for an election query`);
    }
    const rogers = await top("rogers michigan");
    assert.ok(rogers.cards[0].title.startsWith("Mike Rogers (R) wins the Michigan Senate race")); assert.ok(!rogers.cards.some((c) => c.venue === "espn"));
    assert.match((await top("rays world series")).cards[0].title, /Rays win the 2026 World Series/);
    assert.equal((await top("eagles")).cards[0].rule?.series, "espn.team:nfl-PHI.21-win-s2026");
    assert.equal((await top("detroit high 90")).cards[0].rule?.series, "nws.high:DTW-90");
    assert.equal((await top("us debt")).cards[0].rule?.series, "treasury.debt");
    const lakers = await top("lakers tonight");
    assert.equal(lakers.cards[0].group, "teams", "a team name is not a person's name");
    for (const q of ["el sayed", "rays world series", "us debt"]) { const r = await top(q); assert.ok(r.cards.length <= 6); assert.ok(r.cards.every((c) => c.score >= 1)); }
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

  test("sports pickers on the leagues' own schedules (never ESPN): teams with the next game; games with each side's one-game selector; a league without its key says so", async () => {
    await world();
    const lg = await get("/sports/teams", "listSportsTeams") as { leagues: { id: string }[] };
    for (const id of ["mlb", "nba", "wnba", "nhl", "nfl", "cfb", "mcbb", "wcbb", "eng.1", "usa.1", "uefa.champions"]) assert.ok(lg.leagues.some((l) => l.id === id), id);
    const t = await get("/sports/teams?league=mlb&q=rays", "listSportsTeams") as { teams: { abbr: string; series: { win: string }; next: { opponent: string } | null }[]; scheduleNote: string | null };
    assert.equal(t.teams[0].abbr, "TB"); assert.match(t.teams[0].series.win, /^espn\.team:mlb-TB\.30-win-s\d{4}$/); assert.equal(t.scheduleNote, null);
    assert.equal(t.teams[0].next?.opponent, "CLE/CWS", "MLB's official schedule lists the next game, opponent still to be decided");
    const g = await get("/sports/games?league=mlb&q=dodgers", "listSportsGames") as { games: { eventId: string; a: { abbr: string }; b: { abbr: string }; series: { aLoss: string; bLoss: string } }[] };
    assert.equal(g.games[0].eventId, "849809"); assert.equal(g.games[0].series.aLoss, "espn.game:mlb-849809-LAD-loss"); assert.equal(g.games[0].series.bLoss, "espn.game:mlb-849809-MIL-loss");
    const nfl = await get("/sports/teams?league=nfl&q=eagles", "listSportsTeams") as { teams: { abbr: string; next: unknown }[]; scheduleNote: string | null };
    assert.equal(nfl.teams[0].abbr, "PHI"); assert.equal(nfl.teams[0].next, null); assert.match(nfl.scheduleNote ?? "", /licensed feed, which is not linked on this host/); assert.match((nfl as { scheduleDetail?: string }).scheduleDetail ?? "", /schedule needs the licensed key/, "the technical reason rides apart from the sentence (L05)");
    const nflGames = await get("/sports/games?league=nfl", "listSportsGames") as { games: unknown[]; scheduleNote: string | null };
    assert.equal(nflGames.games.length, 0); assert.match(nflGames.scheduleNote ?? "", /licensed feed, which is not linked on this host/);
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
    assert.equal(t.voidClause.kind, "both-or-neither"); assert.match(t.voidClause.voidBy ?? "", /^\d{4}-\d{2}-\d{2}$/, "wired to the pairs core: the race's settlement date");
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
    // launch audit 5 L05: no raw URL in the settlement sentence; the SoS page is a link of its own
    assert.doesNotMatch(cards[0].settlement, /https?:\/\//); assert.match(cards[0].crossReadUrl ?? "", /michigan\.gov\/sos/);
  });
});
