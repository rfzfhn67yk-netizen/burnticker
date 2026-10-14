// Launch walkthrough (2026-10-13): every soccer league was refused at launch because Polymarket lists a soccer game as THREE yes/no
// markets inside one event (home win, draw, away win) and the game-market reader only understood a two-sided moneyline naming the two
// teams. The three-way reader (gameSettle.ts threeWayOf, polymarketGameReaders, settleGame's payout branch) is pinned here on fakes
// shaped like the live Gamma event epl-ars-lee-2026-10-10 (read 2026-10-13).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { apiSportsUrl, polymarketGameReaders, settleGame, threeWayOf, tsdbV2DayUrl, tsdbV2EventUrl, POLY_LEAGUE_TAG, type GameDeps, type GameMarket, type GamePayout } from "@/lib/burnticker/sources/gameSettle";
import { parseEventsBody, searchHits } from "@/lib/burnticker/oracle/polymarket";
import { LEAGUES, type EspnClient, type Game, type GameSide, type LeagueId } from "@/lib/burnticker/sources/espn";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";

const side = (abbr: string, name: string, homeAway: "home" | "away"): GameSide => ({ abbr, name, nickname: name, location: name, short: name, score: null, homeAway, record: null });
const game = (league: LeagueId, home: GameSide, away: GameSide, startsAt = "2026-10-10T11:30:00Z"): Game => ({ eventId: "740001", league, startsAt, date: startsAt.slice(0, 10), name: `${away.name} at ${home.name}`, completed: true, state: "post", detail: "FT", home, away });
const ARS_LEE = game("eng.1", side("ARS", "Arsenal", "home"), side("LEE", "Leeds United", "away"));
const MUN_MCI = game("eng.1", side("MAN", "Manchester United", "home"), side("MNC", "Manchester City", "away"));

const H = "0x" + "1".repeat(64), D = "0x" + "2".repeat(64), A = "0x" + "3".repeat(64), SPREAD = "0x" + "4".repeat(64);
const leg = (conditionId: string, question: string, title: string, start = "2026-10-10 11:30:00+00") => ({ conditionId, question, outcomes: '["Yes", "No"]', sportsMarketType: "moneyline", groupItemTitle: title, gameStartTime: start, endDate: "2026-10-10T11:30:00Z", active: true, closed: true });
/** The Gamma event as served (three moneyline legs, plus a spread market a fuller event carries). */
const gammaSoccer = (slug: string, homeName: string, awayName: string, ids = [H, D, A], start = "2026-10-10 11:30:00+00") => ({
  slug, title: `${homeName} vs. ${awayName}`, closed: true, endDate: "2026-10-10T11:30:00Z", startTime: "2026-10-10T11:30:00Z", tags: [{ slug: "epl", label: "EPL" }],
  markets: [
    leg(ids[0], `Will ${homeName} win on 2026-10-10?`, homeName, start),
    leg(ids[1], `Will ${homeName} vs. ${awayName} end in a draw?`, `Draw (${homeName} vs. ${awayName})`, start),
    leg(ids[2], `Will ${awayName} win on 2026-10-10?`, awayName, start),
    { conditionId: SPREAD, question: `Spread: ${homeName} (-1.5)`, outcomes: `["${homeName}", "${awayName}"]`, sportsMarketType: "spreads", endDate: "2026-10-10T11:30:00Z", active: true, closed: true },
  ],
});
const hits = (events: unknown[]) => searchHits(parseEventsBody(events), { status: "all", perEvent: 40 });
const EPL = gammaSoccer("epl-ars-lee-2026-10-10", "Arsenal FC", "Leeds United FC");
const noChain = async () => ({ resolved: false, outcome: null });

describe("the three-way game market (soccer)", () => {
  test("the three legs of the event are matched: home, draw and away condition ids and the two team names; the spread is never picked", async () => {
    const asked: string[] = [];
    const poly = { eventsStarting: async (slug: string) => { asked.push(slug); return hits([EPL]); }, search: async () => hits([]), readChain: noChain };
    const m = await polymarketGameReaders(poly).market!(ARS_LEE);
    assert.deepEqual(m?.threeWay, { home: H, draw: D, away: A, homeName: "Arsenal FC", awayName: "Leeds United FC" });
    assert.equal(m?.conditionId, H);
    assert.equal(m?.url, "https://polymarket.com/event/epl-ars-lee-2026-10-10");
    assert.deepEqual(asked, ["epl"], "the date-window lookup under the league tag answers first");
  });

  test("legs listed in any order are assigned by team, not by position", () => {
    const shuffled = { ...EPL, markets: [EPL.markets[2], EPL.markets[1], EPL.markets[0]] };
    const t = threeWayOf(hits([shuffled]).events[0].markets, ARS_LEE);
    assert.deepEqual([t?.home.conditionId, t?.draw.conditionId, t?.away.conditionId], [H, D, A]);
  });

  test("a Manchester derby: both clubs say Manchester, each leg still goes to its own side", () => {
    const ev = gammaSoccer("epl-mun-mac-2026-10-10", "Manchester United FC", "Manchester City FC");
    const t = threeWayOf(hits([ev]).events[0].markets, MUN_MCI);
    assert.deepEqual([t?.home.conditionId, t?.away.conditionId, t?.homeName], [H, A, "Manchester United FC"]);
    const flipped = threeWayOf(hits([ev]).events[0].markets, game("eng.1", MUN_MCI.away, MUN_MCI.home));
    assert.deepEqual([flipped?.home.conditionId, flipped?.away.conditionId], [A, H]);
  });

  test("not this game: a leg naming a third club, a missing leg, or a league without draws", async () => {
    assert.equal(threeWayOf(hits([gammaSoccer("x", "Arsenal FC", "Chelsea FC")]).events[0].markets, ARS_LEE), null);
    const two = { ...EPL, markets: EPL.markets.filter((m) => m.conditionId !== D) };
    assert.equal(threeWayOf(hits([two]).events[0].markets, ARS_LEE), null);
    const nflGame = game("nfl", side("LV", "Las Vegas Raiders", "home"), side("KC", "Kansas City Chiefs", "away"));
    const nflThree = gammaSoccer("nfl-kc-lv", "Las Vegas Raiders", "Kansas City Chiefs");
    const poly = { eventsStarting: async () => hits([nflThree]), search: async () => hits([]), readChain: noChain };
    assert.equal(await polymarketGameReaders(poly).market!(nflGame), null, "three yes/no legs are read only for a league with draws");
  });

  test("a game more than 2 days from the listed start is not matched; the nearest of two games is", async () => {
    const later = gammaSoccer("epl-ars-lee-2026-10-11", "Arsenal FC", "Leeds United FC", ["0x" + "5".repeat(64), "0x" + "6".repeat(64), "0x" + "7".repeat(64)], "2026-10-11 11:30:00+00");
    const poly = { eventsStarting: async () => hits([later, EPL]), search: async () => hits([]), readChain: noChain };
    assert.equal((await polymarketGameReaders(poly).market!(ARS_LEE))?.conditionId, H);
    assert.equal(await polymarketGameReaders({ ...poly, eventsStarting: async () => hits([EPL]) }).market!({ ...ARS_LEE, startsAt: "2026-10-14T11:30:00Z", date: "2026-10-14" }), null);
  });

  test("the text search is the fallback when the league tag lists nothing", async () => {
    const asked: string[] = [];
    const poly = { eventsStarting: async () => hits([]), eventsInWindow: async () => hits([]), search: async (q: string) => { asked.push(q); return hits([EPL]); }, readChain: noChain };
    assert.equal((await polymarketGameReaders(poly).market!(ARS_LEE))?.threeWay?.draw, D);
    assert.deepEqual(asked, ["Leeds United vs Arsenal"]);
  });

  test("every soccer league has a verified Polymarket tag (probed 2026-10-13); Serie A is sea, not serie-a", () => {
    for (const lg of Object.keys(LEAGUES) as LeagueId[]) if (LEAGUES[lg].sport === "soccer") assert.ok(POLY_LEAGUE_TAG[lg], `${lg} has a tag`);
    assert.equal(POLY_LEAGUE_TAG["ita.1"], "sea");
    assert.equal(POLY_LEAGUE_TAG["uefa.europa.conf"], "europa-conference-league");
  });
});

// ---- settling on the three payouts ---------------------------------------------------------------------------------------------

const MARKET: GameMarket = { conditionId: H, question: "Arsenal FC vs. Leeds United FC", outcomes: ["Yes", "No"], url: "https://polymarket.com/event/epl-ars-lee-2026-10-10", threeWay: { home: H, draw: D, away: A, homeName: "Arsenal FC", awayName: "Leeds United FC" } };
const YES: GamePayout = { resolved: true, outcome: 0 }, NO: GamePayout = { resolved: true, outcome: 1 }, SPLIT: GamePayout = { resolved: true, outcome: null }, OPEN: GamePayout = { resolved: false, outcome: null };
const tsdbRow = (h: number, a: number, status = "FT") => ({ idEvent: "2400001", strEvent: "Arsenal vs Leeds United", strHomeTeam: "Arsenal", strAwayTeam: "Leeds United", intHomeScore: String(h), intAwayScore: String(a), dateEvent: "2026-10-10", strTimestamp: "2026-10-10T11:30:00", strStatus: status });
function client(answers: Record<string, unknown>): EspnClient {
  const read = async (url: string) => { if (!(url in answers)) throw new Error(`HTTP 404 ${url}`); return answers[url]; };
  return { tsdbRead: async (_k: string, v2: string) => read(v2), get: async (url: string) => read(url) } as unknown as EspnClient;
}
const withTsdb = (h: number, a: number, status = "FT") => ({ [tsdbV2DayUrl("2026-10-10")]: { filter: [tsdbRow(h, a, status)] }, [tsdbV2EventUrl("2400001")]: { lookup: [tsdbRow(h, a, status)] } });
const deps = (payouts: Record<string, GamePayout>, o: Partial<GameDeps> = {}): GameDeps & { read: string[] } => {
  const read: string[] = [];
  return { tsdbKey: "k", apiSportsKey: null, market: async () => MARKET, payout: async (id) => { read.push(id); return payouts[id] ?? null; }, ...o, read };
};

describe("settleGame on a three-way payout", () => {
  test("one YES leg (home) with TheSportsDB's 2–0 → settled for the home side by two operators; all three legs read", async () => {
    const d = deps({ [H]: YES, [D]: NO, [A]: NO });
    const v = await settleGame(client(withTsdb(2, 0)), ARS_LEE, d);
    assert.equal(v.kind, "settled", JSON.stringify(v));
    if (v.kind === "settled") { assert.equal(v.winner, "home"); assert.equal(v.settledOn, "on-chain payout"); assert.deepEqual([...v.ops].sort(), ["TheSportsDB", "on-chain payout"]); assert.match(v.detail, /Arsenal FC win \(90 minutes\)/); }
    assert.deepEqual(d.read, [H, D, A]);
  });

  test("the away leg → away; the draw leg with a 1–1 final → a tie", async () => {
    const away = await settleGame(client(withTsdb(0, 1)), ARS_LEE, deps({ [H]: NO, [D]: NO, [A]: YES }));
    assert.equal(away.kind === "settled" && away.winner, "away");
    const draw = await settleGame(client(withTsdb(1, 1)), ARS_LEE, deps({ [H]: NO, [D]: YES, [A]: NO }));
    assert.equal(draw.kind === "settled" && draw.winner, "tie", JSON.stringify(draw));
  });

  test("an unresolved leg or a split leg waits; nothing is read past it", async () => {
    const open = await settleGame(client(withTsdb(2, 0)), ARS_LEE, deps({ [H]: YES, [D]: OPEN, [A]: NO }));
    assert.equal(open.kind, "awaiting");
    if (open.kind === "awaiting") assert.match(open.why, /a draw in Arsenal FC vs\. Leeds United FC is not resolved yet/);
    const split = await settleGame(client(withTsdb(2, 0)), ARS_LEE, deps({ [H]: SPLIT, [D]: NO, [A]: NO }));
    assert.equal(split.kind, "awaiting");
    if (split.kind === "awaiting") assert.match(split.why, /split/);
    const missing = await settleGame(client(withTsdb(2, 0)), ARS_LEE, deps({ [H]: YES, [D]: NO }));
    assert.equal(missing.kind, "awaiting", "a leg that cannot be read is not resolved");
  });

  test("two YES legs, or none, hold the game with a plain reason", async () => {
    const two = await settleGame(client(withTsdb(2, 0)), ARS_LEE, deps({ [H]: YES, [D]: YES, [A]: NO }));
    assert.equal(two.kind, "held");
    if (two.kind === "held") assert.match(two.why, /more than one result \(Arsenal FC win and a draw\)/);
    const none = await settleGame(client(withTsdb(2, 0)), ARS_LEE, deps({ [H]: NO, [D]: NO, [A]: NO }));
    assert.equal(none.kind, "held");
  });

  test("the payout and the final score must agree: a home YES against a 1–1 final is held", async () => {
    const v = await settleGame(client(withTsdb(1, 1)), ARS_LEE, deps({ [H]: YES, [D]: NO, [A]: NO }));
    assert.equal(v.kind, "held");
  });

  test("a cup tie on penalties: the draw leg is not counted; TheSportsDB alone holds; with API-Sports the declared winner settles it (item 78)", async () => {
    const pens = { ...withTsdb(1, 1, "PEN") };
    const payouts = { [H]: NO, [D]: YES, [A]: NO };
    const alone = await settleGame(client(pens), ARS_LEE, deps(payouts));
    assert.equal(alone.kind, "held");
    if (alone.kind === "held") assert.match(alone.why, /past 90 minutes/);
    const api = { response: [{ teams: { home: { name: "Arsenal", winner: true }, away: { name: "Leeds United", winner: false } }, goals: { home: 1, away: 1 }, fixture: { date: "2026-10-10T11:30:00+00:00", status: { short: "PEN" } } }] };
    const both = await settleGame(client({ ...pens, [apiSportsUrl("eng.1", "2026-10-10")]: api }), ARS_LEE, deps(payouts, { apiSportsKey: "x" }));
    assert.equal(both.kind, "settled", JSON.stringify(both));
    if (both.kind === "settled") { assert.equal(both.winner, "home"); assert.deepEqual([...both.ops].sort(), ["TheSportsDB", "apisports.games"], "the 90-minute payout is not one of the two operators"); }
  });

  test("a payout naming a 90-minute winner while a score read says extra time: held", async () => {
    const v = await settleGame(client(withTsdb(2, 1, "AET")), ARS_LEE, deps({ [H]: YES, [D]: NO, [A]: NO }, { apiSportsKey: null }));
    assert.equal(v.kind, "held");
    if (v.kind === "held") assert.match(v.why, /extra time/);
  });

  test("the two-sided path is unchanged: an NFL moneyline reads one payout and names the team", async () => {
    const KC_AT_LV = { ...game("nfl", side("LV", "Las Vegas Raiders", "home"), side("KC", "Kansas City Chiefs", "away"), "2026-10-04T20:25:00Z") };
    const row = { idEvent: "2475433", strEvent: "Las Vegas Raiders vs Kansas City Chiefs", strHomeTeam: "Las Vegas Raiders", strAwayTeam: "Kansas City Chiefs", intHomeScore: "27", intAwayScore: "30", dateEvent: "2026-10-04", strTimestamp: "2026-10-04T20:25:00", strStatus: "FT" };
    const read: string[] = [];
    const d: GameDeps = { tsdbKey: "k", apiSportsKey: null, market: async () => ({ conditionId: "0xe605", question: "Chiefs vs. Raiders", outcomes: ["Chiefs", "Raiders"], url: "https://polymarket.com/event/nfl-kc-lv-2026-10-04" }), payout: async (id) => { read.push(id); return { resolved: true, outcome: 0 }; } };
    const v = await settleGame(client({ [tsdbV2DayUrl("2026-10-04")]: { filter: [row] }, [tsdbV2EventUrl("2475433")]: { lookup: [row] } }), KC_AT_LV, d);
    assert.equal(v.kind === "settled" && v.winner, "away");
    assert.deepEqual(read, ["0xe605"]);
  });

  test("copy lint: every new sentence a reader can see", async () => {
    const cfg = loadCopyLintConfig();
    const whys: string[] = [];
    for (const [p, c] of [
      [{ [H]: YES, [D]: YES, [A]: NO }, withTsdb(2, 0)], [{ [H]: NO, [D]: NO, [A]: NO }, withTsdb(2, 0)], [{ [H]: YES, [D]: OPEN, [A]: NO }, withTsdb(2, 0)],
      [{ [H]: SPLIT, [D]: NO, [A]: NO }, withTsdb(2, 0)], [{ [H]: NO, [D]: YES, [A]: NO }, withTsdb(1, 1, "PEN")], [{ [H]: YES, [D]: NO, [A]: NO }, withTsdb(2, 1, "AET")],
    ] as [Record<string, GamePayout>, Record<string, unknown>][]) {
      const v = await settleGame(client(c), ARS_LEE, deps(p));
      whys.push(v.kind === "settled" ? v.detail : v.why);
    }
    assert.equal(whys.length, 6);
    for (const t of whys) { const r = lintCopy(t, cfg); assert.ok(r.ok, `"${t}"\n${formatHits(r)}`); }
  });
});
