// KALSHI EVENT SEARCH + THE TEAM PICKER (2026-10-10). The owner searched "eagles" to pair Eagles vs Jaguars and got nothing: series
// titles say "Professional Football Game"; the game is an EVENT (KXNFLGAME-26OCT11PHIJAC "PHI Eagles vs JAC Jaguars") with one market
// per team (…-PHI, …-JAC — Kalshi's JAC, not JAX). On the frozen fixture of KXNFLGAME's open events (fetched 10-10) and its settled
// markets this season: parsing, the team-alias table, matching, a game's two sides, the league chooser, the client's 10-minute cache,
// the teams + records, the generated team-coin rule (its back-test burns exactly on the team's losses), the matchup rules, and the API.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { aliasLookup, buildTeams, gameSides, legFilterCollisions, matchEvents, matchupLeagues, parseEventsBody, seasonStart, TEAM_ALIASES } from "@/lib/burnticker/oracle/events";
import { KalshiClient, eventsUrl, fixtureFetch, parseMarketsBody, parseSeriesListBody, seriesListUrl, settledMarketsUrl, seriesApiUrl, resolveSelector } from "@/lib/burnticker/oracle/kalshi";
import { headToHead, matchupRules, teamCoinRule, teamCoinSentence } from "@/lib/burnticker/wizard";
import { lockRule, validateRule, invertMapping } from "@/lib/burnticker/rules";
import { unitStep } from "@/lib/burnticker/units";
import { fx } from "./burntickerHelpers.ts";
import { API, callRoute, makeWorld } from "./burntickerApiHelpers.ts";

const OPEN = fx("kalshi/KXNFLGAME.events.open.json");
const SEASON = fx("kalshi/KXNFLGAME.settled.season.json");
const SPORTS = fx("kalshi/series.Sports.games.json");
const T = Date.parse("2026-10-10T16:00:00Z");
const events = parseEventsBody(OPEN).events;
const PHIJAC = "KXNFLGAME-26OCT11PHIJAC";

describe("parsing and the alias table", () => {
  test("the open events: 28 games, nested markets, PHI vs JAC with Kalshi's JAC", () => {
    assert.equal(events.length, 28);
    const e = events.find((x) => x.eventTicker === PHIJAC)!;
    assert.equal(e.title, "PHI Eagles vs JAC Jaguars"); assert.equal(e.seriesTicker, "KXNFLGAME");
    assert.deepEqual(e.markets.map((m) => `${m.suffix}=${m.label}`).sort(), ["JAC=Jacksonville", "PHI=Philadelphia"]);
    assert.ok(e.expectedAt && e.closeTime);
  });
  test("aliases: nickname, city, Kalshi abbreviation, common alternatives; whole words only", () => {
    const one = (q: string) => aliasLookup(q).filter((a) => a.league === "NFL").map((a) => a.abbr);
    assert.deepEqual(one("eagles"), ["PHI"]); assert.deepEqual(one("Philly"), ["PHI"]); assert.deepEqual(one("PHI"), ["PHI"]);
    assert.deepEqual(one("jaguars"), ["JAC"]); assert.deepEqual(one("JAX"), ["JAC"]); assert.deepEqual(one("jacksonville"), ["JAC"]);
    assert.deepEqual(one("Eagles vs Jaguars").sort(), ["JAC", "PHI"]);
    assert.deepEqual(one("eaglesx"), []);
    assert.equal(new Set(TEAM_ALIASES.filter((a) => a.league === "NFL").map((a) => a.abbr)).size, 32);
    // Every abbreviation in the fixture is in the table, spelled as Kalshi spells it.
    for (const e of events) for (const m of e.markets) assert.ok(TEAM_ALIASES.some((a) => a.series === "KXNFLGAME" && a.abbr === m.suffix), m.ticker);
    assert.deepEqual(legFilterCollisions("LA", "KXNHLGAME"), []); assert.deepEqual(legFilterCollisions("NY", "KXNFLGAME"), ["NYG", "NYJ"]);
  });
});

describe("matching", () => {
  test('"eagles" finds both Eagles games with PHI as the matched side; "eagles jaguars" finds exactly the one game; "jax" lands on JAC', () => {
    const e = matchEvents(events, "eagles");
    assert.deepEqual(e.map((x) => x.eventTicker), [PHIJAC, "KXNFLGAME-26OCT18CARPHI"]);
    assert.deepEqual(e[0].matchedSides, ["PHI"]);
    assert.deepEqual(matchEvents(events, "eagles jaguars").map((x) => x.eventTicker), [PHIJAC]);
    assert.deepEqual(matchEvents(events, "Eagles vs Jaguars").map((x) => x.eventTicker), [PHIJAC], "the word 'vs' is in the title too");
    assert.deepEqual(matchEvents(events, "jax").map((x) => x.eventTicker).sort(), [PHIJAC, "KXNFLGAME-26OCT18HOUJAC"].sort());
    assert.deepEqual(matchEvents(events, "philadelphia").map((x) => x.eventTicker), [PHIJAC, "KXNFLGAME-26OCT18CARPHI"]);
    assert.deepEqual(matchEvents(events, PHIJAC).map((x) => x.eventTicker), [PHIJAC], "the event ticker itself");
    assert.deepEqual(matchEvents(events, "curling"), []);
  });
  test("a game's two sides in title order, with names and suggested tickers; no TIE in the NFL", () => {
    const g = gameSides(events.find((x) => x.eventTicker === PHIJAC)!)!;
    assert.deepEqual({ a: [g.a.abbr, g.a.name, g.a.ticker, g.a.marketTicker], b: [g.b.abbr, g.b.name, g.b.ticker, g.b.marketTicker] }, { a: ["PHI", "Philadelphia Eagles", "EAGLES", `${PHIJAC}-PHI`], b: ["JAC", "Jacksonville Jaguars", "JAGUARS", `${PHIJAC}-JAC`] });
    assert.equal(g.tie, null);
    const nyj = gameSides(events.find((x) => x.eventTicker === "KXNFLGAME-26OCT11CLENYJ")!)!;
    assert.equal(nyj.b.name, "New York Jets", "'NY Jets' in the title, NYJ on the market: the alias table names it");
    const sf = gameSides(events.find((x) => x.eventTicker === "KXNFLGAME-26OCT11SFSEA")!)!;
    assert.equal(sf.a.ticker, "49ERS");
  });
  test("the league chooser from the Sports series list: NFL, NBA, MLB, NHL, NCAA, Soccer", () => {
    const l = matchupLeagues(parseSeriesListBody(SPORTS));
    assert.deepEqual(l.map((x) => x.label), ["NFL", "NBA", "MLB", "NHL", "NCAA", "Soccer"]);
    assert.deepEqual(l[0].series, [{ ticker: "KXNFLGAME", title: l[0].series[0].title }]);
    assert.ok(l.find((x) => x.id === "soccer")!.series.some((x) => x.ticker === "KXEPLGAME"));
  });
});

describe("the client", () => {
  const table = { [eventsUrl("KXNFLGAME")]: OPEN, [settledMarketsUrl("KXNFLGAME")]: SEASON, [seriesListUrl("Sports")]: SPORTS, [seriesApiUrl("KXNFLGAME")]: fx("kalshi/series.KXNFLGAME.json") };
  test("searchEvents: a team routes to its league's series only; one request; cached for 10 minutes", async () => {
    let now = T;
    const k = new KalshiClient({ fetchImpl: fixtureFetch(table), now: () => now, minIntervalMs: 0 });
    const r = await k.searchEvents("eagles");
    assert.deepEqual(r.scanned, ["KXNFLGAME"]);
    assert.equal(r.events[0].eventTicker, PHIJAC);
    assert.deepEqual(r.teams.filter((t) => t.league === "NFL"), [{ league: "NFL", abbr: "PHI", city: "Philadelphia", nickname: "Eagles" }]);
    const n = k.requests.length;
    await k.searchEvents("jaguars"); assert.equal(k.requests.length, n, "same series within 10 min: from the cache");
    now += 601_000; await k.searchEvents("jaguars"); assert.equal(k.requests.length, n + 1, "after 10 min: fetched again");
    const one = await k.searchEvents("jacksonville", { series: "KXNFLGAME" }); assert.deepEqual(one.scanned, ["KXNFLGAME"]);
  });
  test("teams: 32 teams, next game, records since the season start (own leg YES = W, NO = L); wins = losses league-wide", async () => {
    const k = new KalshiClient({ fetchImpl: fixtureFetch(table), now: () => T, minIntervalMs: 0 });
    const t = await k.teams("KXNFLGAME");
    assert.equal(t.since, "2026-09-01T00:00:00.000Z"); assert.equal(seasonStart("KXNFLGAME", Date.parse("2026-03-01T00:00:00Z")), "2025-09-01T00:00:00.000Z");
    assert.equal(t.teams.length, 32);
    const phi = t.teams.find((x) => x.abbr === "PHI")!;
    assert.deepEqual([phi.name, phi.ticker, phi.filter, phi.next!.eventTicker, phi.next!.opponent], ["Philadelphia Eagles", "EAGLES", "-PHI", PHIJAC, "Jacksonville Jaguars"]);
    const sum = t.teams.reduce((a, x) => ({ w: a.w + x.record.w, l: a.l + x.record.l }), { w: 0, l: 0 });
    assert.equal(sum.w, sum.l, "every NFL game has one winner and one loser"); assert.ok(sum.w > 50, `${sum.w} games this season`);
    // Hand count from the raw fixture for PHI.
    const legs = parseMarketsBody(SEASON).markets.filter((m) => m.ticker.endsWith("-PHI") && (m.settlementTs ?? "") >= t.since);
    assert.deepEqual([phi.record.w, phi.record.l], [legs.filter((m) => m.result === "yes").length, legs.filter((m) => m.result === "no").length]);
  });
});

describe("the generated rules", () => {
  test("TEAM COIN: Eagles, burn when we lose — valid, locked, and its back-test burns exactly on the Eagles' losses this season", async () => {
    const rule = teamCoinRule("KXNFLGAME", "PHI", "lose");
    assert.deepEqual(validateRule(rule), lockRule(rule).rule);
    assert.deepEqual(rule.filter, { tickerIncludes: "-PHI" }); assert.deepEqual(rule.binary, { onYes: null, onNo: { fractionOfPool: 0.01 } });
    const markets = parseMarketsBody(SEASON).markets;
    const since = seasonStart("KXNFLGAME", T);
    const r = resolveSelector(rule, markets, { nowMs: T, sinceIso: since });
    const burns = r.events.filter((e) => unitStep(rule, e, null).units > 0).length;
    const t = buildTeams("KXNFLGAME", events, markets, T);
    const phi = t.teams.find((x) => x.abbr === "PHI")!;
    assert.equal(burns, phi.record.l, "the coin burns once per Eagles loss");
    assert.ok(r.events.every((e) => e.id.endsWith("-PHI")), "only the Eagles' own leg — never the opponent's leg of an Eagles game");
    const win = teamCoinRule("KXNFLGAME", "PHI", "win");
    assert.equal(resolveSelector(win, markets, { nowMs: T, sinceIso: since }).events.filter((e) => unitStep(win, e, null).units > 0).length, phi.record.w);
    assert.equal(teamCoinSentence("Eagles", "EAGLES", "lose"), "Every time the Eagles lose, $EAGLES spends 1% of its burn pool buying $EAGLES back with its own trading fees and burns it. Rule locked forever. You earn nothing from fees. All LP burned.");
  });
  test("MATCHUP: this game only = one market, side B by inversion (a partition); every game = two own-leg rules (independent records)", () => {
    const g = matchupRules("KXNFLGAME", PHIJAC, "PHI", "JAC", "game");
    assert.equal(g.registeredPair, true); assert.equal(g.b, null);
    assert.equal(g.a.market, `${PHIJAC}-PHI`); assert.deepEqual(g.a.binary, { onYes: null, onNo: { fractionOfPool: 0.01 } });
    const a = validateRule({ ...g.a, pair: { pairId: "eagles-vs-jaguars-kxnflgame", side: "A", counterpartMint: null } });
    const b = invertMapping(a, "So11111111111111111111111111111111111111112");
    const ev = (result: "yes" | "no") => ({ id: `${PHIJAC}-PHI`, at: "2026-10-11T17:00:00Z", result, value: null, title: null, sourceUrl: "" });
    for (const res of ["yes", "no"] as const) assert.equal(unitStep(a, ev(res), null).units + unitStep(b, ev(res), null).units, 1, `${res}: exactly one side burns`);
    const s = matchupRules("KXNFLGAME", PHIJAC, "PHI", "JAC", "season");
    assert.equal(s.registeredPair, false); assert.deepEqual(s.b!.filter, { tickerIncludes: "-JAC" });
    validateRule(s.a); validateRule(s.b!);
    const hh = headToHead([{ id: `${PHIJAC}-PHI`, units: 1 }, { id: "KXNFLGAME-26OCT18CARPHI-PHI", units: 0 }], [{ id: `${PHIJAC}-JAC`, units: 0 }, { id: "KXNFLGAME-26OCT18HOUJAC-JAC", units: 1 }]);
    assert.deepEqual(hh, { games: 1, burnsA: 1, burnsB: 0, both: 0, neither: 0 });
  });
});

describe("the API", () => {
  test("GET /kalshi/events?q=eagles, ?series=, no params (leagues); /kalshi/search merges events first for a team; /kalshi/teams", async () => {
    await makeWorld();
    const get = async (path: string, expect = 200) => { const r = await callRoute(`${API}${path}`); assert.equal(r.status, expect, path); return r.json() as Promise<Record<string, unknown>>; };
    const ev = await get("/kalshi/events?q=eagles") as { events: { eventTicker: string; matchedSides: string[]; pair: { a: { abbr: string; ticker: string }; b: { abbr: string; ticker: string }; thisGameOnly: { selector: { market: string } }; everyGame: { a: { filter: unknown }; partition: boolean } }; markets: Record<string, unknown>[] }[]; scanned: string[] };
    assert.deepEqual(ev.scanned, ["KXNFLGAME"]);
    assert.equal(ev.events[0].eventTicker, PHIJAC);
    const p = ev.events[0].pair;
    assert.deepEqual([p.a.abbr, p.a.ticker, p.b.abbr, p.b.ticker], ["PHI", "EAGLES", "JAC", "JAGUARS"]);
    assert.equal(p.thisGameOnly.selector.market, `${PHIJAC}-PHI`); assert.deepEqual(p.everyGame.a.filter, { tickerIncludes: "-PHI" }); assert.equal(p.everyGame.partition, false);
    assert.ok(ev.events[0].markets.every((m) => !("yesBid" in m) && !("yes_bid_dollars" in m)), "no prices");
    const list = await get("/kalshi/events?series=KXNFLGAME") as { events: unknown[]; count: number };
    assert.equal(list.count, 28);
    const lg = await get("/kalshi/events") as { leagues: { label: string }[] };
    assert.deepEqual(lg.leagues.map((x) => x.label), ["NFL"], "the test world's Sports list carries KXNFLGAME only");
    const s = await get("/kalshi/search?q=eagles") as { ranking: string; events: { eventTicker: string }[] };
    assert.equal(s.ranking, "events"); assert.equal(s.events[0].eventTicker, PHIJAC);
    const tm = await get("/kalshi/teams?series=KXNFLGAME") as { teams: { abbr: string }[] };
    assert.equal(tm.teams.length, 32);
    await get("/kalshi/teams", 400); await get("/kalshi/teams?series=KXCPI", 400);
  });
});
