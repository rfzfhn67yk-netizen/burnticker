// THE KEEPER'S READ PLAN (owner 2026-10-19: "the keeper is only checking for results when it needs to"). Each selector is read when a
// new result CAN exist and not otherwise: a game from shortly after its start, minutes apart until its final is confirmed (owner
// 2026-10-20: no six-hour wait; a second read 5 minutes after the first final), then never; a team coin around its listed games; a market at its stated close (Kalshi close_time; Polymarket with no Polygon read before
// Gamma says it closed); a feed inside its publish window (Treasury after 15:00 Eastern on business days); a decided one-shot or an
// ended rule never, except one read after the result's UTC day so the program can read that day. The stall alert follows the plan.
// Stubs and frozen fixtures; no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fetchDue, attestReadAt, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { READ_PLAN_MAX_IDLE_MS, READ_PLAN_MIN_GAP_MS, dueNextAt, nextWindowOpen, openWindowAt, selectorIdle, tzOffsetMs, windowNextAt, type ReadWindow } from "@/lib/burnticker/readPlan";
import { GAME_CONFIRM_GAP_MS, GAME_FIRST_LOOK_MS, GAME_LIVE_POLL_MS, SCHEDULE_RECHECK_MS, gameDueAt, sportsSettled, type GameDeps } from "@/lib/burnticker/sources/gameSettle";
import { gameSeries, parseEspnSeries, teamSeries, type EspnClient, type EspnSeries, type Game } from "@/lib/burnticker/sources/espn";
import { feedById } from "@/lib/burnticker/catalogue";
import { KalshiClient, fixtureFetch, marketApiUrl, seriesApiUrl } from "@/lib/burnticker/oracle/kalshi";
import { POLY_PRECLOSE_CHECK_MS } from "@/lib/burnticker/oracle/polymarket";
import { evaluateAlerts, type BurntickerSnapshot, type TokenSnapshot } from "@/lib/burnticker/alerts";
import { validateRule, type BurnRule } from "@/lib/burnticker/rules";
import type { FeedState, ReceiptRow, TokenRow } from "@/lib/burnticker/registry";
import { BRONCOS, DEBT_RULE, fx } from "./burntickerHelpers.ts";
import { EAGLES_CID, PM_BUCS, PM_NOW, polyClient } from "./burntickerPolyHelpers.ts";

const H = 3_600_000, MIN = 60_000, DAY = 86_400_000;
const TREASURY = feedById("treasury.debt")!.readWindow!;

describe("publish windows (sources.json readWindow)", () => {
  test("Treasury's Debt to the Penny: business days from 15:00 Eastern; read at the poll inside the window until a new day appears, then the next business day", () => {
    assert.deepEqual(TREASURY, { tz: "America/New_York", days: "weekdays", opensAt: "15:00", hours: 9 });
    const mon14 = Date.parse("2026-10-19T18:00:00Z");   // Monday 14:00 EDT
    assert.equal(tzOffsetMs("America/New_York", mon14), -4 * H);
    assert.equal(openWindowAt(TREASURY, mon14), null);
    assert.equal(nextWindowOpen(TREASURY, mon14), Date.parse("2026-10-19T19:00:00Z"), "15:00 EDT");
    const mon1530 = Date.parse("2026-10-19T19:30:00Z");
    assert.equal(windowNextAt(TREASURY, mon1530, false, H), mon1530 + H, "nothing new yet: the poll, inside the window");
    assert.equal(windowNextAt(TREASURY, mon1530, true, H), Date.parse("2026-10-20T19:00:00Z"), "the new day is in: tomorrow 15:00");
    const fri16 = Date.parse("2026-10-23T20:00:00Z");
    assert.equal(windowNextAt(TREASURY, fri16, true, H), Date.parse("2026-10-26T19:00:00Z"), "Friday's read done: Monday 15:00");
    // after the 3 November DST change Eastern is UTC−5
    assert.equal(nextWindowOpen(TREASURY, Date.parse("2026-11-09T12:00:00Z")), Date.parse("2026-11-09T20:00:00Z"));
    // a window that closes with nothing new waits for the next one
    assert.equal(windowNextAt(TREASURY, Date.parse("2026-10-20T03:30:00Z"), false, H), Date.parse("2026-10-20T19:00:00Z"));
  });

  test("a once-per-complete-UTC-day feed: shortly after 00:00 UTC, a few hours", () => {
    const w = feedById("usgs.quakes6")!.readWindow as ReadWindow;
    assert.deepEqual(w, { tz: "UTC", days: "all", opensAt: "00:30", hours: 4 });
    const t = Date.parse("2026-10-19T01:00:00Z");
    assert.equal(windowNextAt(w, t, false, H), t + H);
    assert.equal(windowNextAt(w, t, true, H), Date.parse("2026-10-20T00:30:00Z"));
    assert.equal(windowNextAt(w, Date.parse("2026-10-19T04:00:00Z"), false, H), Date.parse("2026-10-20T00:30:00Z"), "the last poll would land after the window");
  });

  test("the adapter's dueAt is honoured sooner or later than the poll, within bounds", () => {
    const now = PM_NOW;
    assert.equal(dueNextAt(null, now), null);
    assert.equal(dueNextAt(now - H, now), now + READ_PLAN_MIN_GAP_MS);
    assert.equal(dueNextAt(now + 3 * DAY, now), now + 3 * DAY);
    assert.equal(dueNextAt(now + 30 * DAY, now), now + READ_PLAN_MAX_IDLE_MS);
  });
});

/** A game on a movable schedule (the schedule read is the fake client's season). */
const game = (o: Partial<Game> & { startsAt: string }): Game => ({ eventId: "2475453", league: "nfl", date: o.startsAt.slice(0, 10), name: "Seattle Seahawks at Denver Broncos", completed: false, state: "pre", detail: "Scheduled", home: { abbr: "DEN", name: "Denver Broncos", nickname: "Broncos", score: null, homeAway: "home", record: null }, away: { abbr: "SEA", name: "Seattle Seahawks", nickname: "Seahawks", score: null, homeAway: "away", record: null }, ...o } as Game);
const espn = (games: () => Game[]): EspnClient => ({ tsdbRead: async () => ({ events: [] }), get: async () => { throw new Error("HTTP 404"); }, season: async () => games() } as unknown as EspnClient);
const noDeps = (now: number): GameDeps => ({ tsdbKey: null, apiSportsKey: null, market: null, payout: null, now: () => now });

describe("games: from shortly after kickoff, minutes apart while the final is confirmed, then never", () => {
  test("a game coin: its due time is the first look after the start; in progress, one live poll ahead", async () => {
    const start = "2026-10-25T20:25:00Z";
    const s = parseEspnSeries(gameSeries("nfl", "2475453", "DEN", "win")) as EspnSeries;
    const before = Date.parse("2026-10-19T12:00:00Z");
    const r = await sportsSettled(espn(() => [game({ startsAt: start })]), s, null, noDeps(before), { nowMs: before });
    assert.equal(r.dueAt, Date.parse(start) + GAME_FIRST_LOOK_MS, "nothing is read before the game can have a final");
    const during = Date.parse(start) + GAME_FIRST_LOOK_MS + 10 * MIN;
    const r2 = await sportsSettled(espn(() => [game({ startsAt: start, state: "in" })]), s, null, noDeps(during), { nowMs: during });
    assert.equal(r2.dueAt, during + GAME_LIVE_POLL_MS, "the schedule does not say final yet: every few minutes");
    assert.equal(gameDueAt({ startsAt: start }, before), Date.parse(start) + GAME_FIRST_LOOK_MS);
  });

  test("a team coin reads around its listed games only: the next game's due time; none listed, a schedule look in six hours", async () => {
    const s = parseEspnSeries(teamSeries("nfl", "PHI", "win")) as EspnSeries;
    const now = Date.parse("2026-10-19T15:00:00Z");
    const past = game({ startsAt: "2026-10-18T17:00:00Z", completed: true, state: "post", detail: "Final", home: { abbr: "PHI", name: "Philadelphia Eagles", nickname: "Eagles", score: 20, homeAway: "home", record: null } as Game["home"] });
    const next = game({ startsAt: "2026-10-27T00:15:00Z", home: { abbr: "PHI", name: "Philadelphia Eagles", nickname: "Eagles", score: null, homeAway: "home", record: null } as Game["home"] });
    const r = await sportsSettled(espn(() => [past, next]), s, "2026-10-19", noDeps(now), { nowMs: now });
    assert.equal(r.dueAt, Date.parse("2026-10-27T00:15:00Z") + GAME_FIRST_LOOK_MS, "the Monday-night game, 7.6 days out: no read until then");
    const none = await sportsSettled(espn(() => [past]), s, "2026-10-19", noDeps(now), { nowMs: now });
    assert.equal(none.dueAt, now + SCHEDULE_RECHECK_MS);
  });
});

describe("markets: not before the stated close", () => {
  test("Polymarket, one market still open: Gamma's closed flag only (hourly, or the end date if sooner), no Polygon read", async () => {
    const pm = polyClient();
    const r = await pm.settledSince(validateRule({ ...PM_BUCS, market: EAGLES_CID }) as BurnRule, null);
    assert.equal(pm.chainReads.length, 0, "no payout read before the market closes");
    assert.equal(r.dueAt, PM_NOW + POLY_PRECLOSE_CHECK_MS);
    const near = polyClient({ now: () => Date.parse("2026-10-11T13:00:00Z") });
    const r2 = await near.settledSince(validateRule({ ...PM_BUCS, market: EAGLES_CID }) as BurnRule, null);
    assert.equal(r2.dueAt, Date.parse("2026-10-11T13:30:00Z"), "the end date, when it comes before the hourly check");
    // closed (resolved): read on chain at once, as before
    const done = polyClient();
    const r3 = await done.settledSince(validateRule(PM_BUCS) as BurnRule, null);
    assert.deepEqual([done.chainReads.length, r3.events.length], [1, 1]);
  });

  test("Polymarket, past its end date but not closed on Gamma: the payout vector at most hourly (Gamma's flag at the poll)", async () => {
    let now = Date.parse("2026-10-12T00:00:00Z");
    const pm = polyClient({ now: () => now });
    const rule = validateRule({ ...PM_BUCS, market: EAGLES_CID }) as BurnRule;
    const r = await pm.settledSince(rule, null);
    assert.deepEqual([pm.chainReads.length, r.events.length], [1, 0]);
    for (let i = 0; i < 11; i++) { now += 5 * MIN; await pm.settledSince(rule, null); }
    assert.equal(pm.chainReads.length, 1, "twelve five-minute cycles, one Polygon read");
    now += 5 * MIN; await pm.settledSince(rule, null);
    assert.equal(pm.chainReads.length, 2, "an hour later, the chain again");
  });

  test("Kalshi, one market still open: the next read is its close_time", async () => {
    const nfl = fx("kalshi/KXNFLGAME.settled.json") as { markets: Record<string, unknown>[] };
    const T = "KXNFLGAME-26OCT04DENSF-DEN";
    const open = { ...nfl.markets.find((m) => m.ticker === T)!, status: "active", result: "", settlement_ts: null, close_time: "2026-10-26T20:00:00Z" };
    const now = Date.parse("2026-10-19T12:00:00Z");
    const c = new KalshiClient({ fetchImpl: fixtureFetch({ [marketApiUrl(T)]: { market: open }, [seriesApiUrl("KXNFLGAME")]: fx("kalshi/series.KXNFLGAME.json") }), now: () => now, minIntervalMs: 0 });
    const r = await c.settledSince(validateRule({ ...BRONCOS, series: null, filter: {}, market: T }) as BurnRule, null);
    assert.deepEqual([r.events.length, r.dueAt], [0, Date.parse("2026-10-26T20:00:00Z")]);
  });
});

// ---- the loop (fetchDue) on a stub registry ----
function loop(o: { rule: BurnRule; key: string; adapter: (rule: BurnRule) => Promise<{ events: unknown[]; awaitingFinal: number; refusals: string[]; settlementSourceUrl: null; dueAt?: number | null }>; readings?: number; ruleEnded?: boolean; pending?: Partial<ReceiptRow>[] }) {
  const feeds = new Map<string, FeedState>(), status = new Map<string, string>();
  let reads = 0, written = o.readings ?? 0;
  const registry = {
    feedState: (k: string): FeedState => feeds.get(k) ?? { selectorKey: k, lastFetchAt: null, lastOkAt: null, failures: 0, lastError: null, nextFetchAt: null },
    setFeedState: (s: FeedState) => { feeds.set(s.selectorKey, s); },
    // HB-29: a one-shot is decided by a reading after the coin's baseline with a receipt for that coin; the stub's planning pass is
    // modelled as "every written reading has its receipt"
    lockedRule: () => ({ rule: o.rule }), lastReading: () => (written ? { id: "x", at: "2026-10-16" } : null),
    readings: () => (written ? [{ id: "x", at: "2026-10-16" }] : []), receipt: () => (written ? { kind: "scalar", status: "planned" } : null),
    getStatus: (k: string) => status.get(k) ?? null, setStatus: (k: string, v: unknown) => { status.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    putReadings: (_o: string, _k: string, events: unknown[]) => { written += events.length; return events.length; },
    recordAlert: () => null, ruleEnd: () => (o.ruleEnded ? { mode: "winddown" } : null), pending: () => (o.pending ?? []) as ReceiptRow[],
  };
  const adapter = { id: "stub", settledSince: async (rule: BurnRule) => { reads++; return o.adapter(rule); } };
  const clock = { now: Date.parse("2026-10-19T15:00:00Z") };
  const d = { registry, oracles: { kalshi: adapter, catalogue: adapter, polymarket: adapter }, attester: "k", log: () => {}, now: () => clock.now, dryRun: true } as unknown as KeeperDeps;
  const tokens = [{ selectorKey: o.key, ticker: "T", mint: "m", status: "live", baselineAt: "2026-10-01T00:00:00Z" } as unknown as TokenRow];
  return { d, tokens, feeds, clock, get reads() { return reads; } };
}

describe("the loop honours the plan", () => {
  test("a game coin from launch to its final: one read before kickoff, none until the first look after the start, minutes apart while it confirms, then never", async () => {
    const start = Date.parse("2026-10-25T20:25:00Z"), due = start + GAME_FIRST_LOOK_MS;
    let phase: "pre" | "first" | "final" = "pre";
    const rule = validateRule({ schema: "burnticker.rules/v1", oracle: "catalogue", series: gameSeries("nfl", "2475453", "DEN", "win"), market: null, filter: {}, kind: "scalar", scalar: { unit: 1, perUnit: { fractionOfPool: 1 }, baseline: 0, direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null }) as BurnRule;
    const w = loop({ rule, key: `catalogue:${rule.series}`, adapter: async () => phase === "pre" ? { events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null, dueAt: due }
      : phase === "first" ? { events: [], awaitingFinal: 1, refusals: [], settlementSourceUrl: null, dueAt: w.clock.now + GAME_CONFIRM_GAP_MS }
      : { events: [{ id: "2026-10-25", at: "2026-10-25", result: null, value: "1" }], awaitingFinal: 0, refusals: [], settlementSourceUrl: null } });
    await fetchDue(w.d, w.tokens);
    assert.equal(w.reads, 1); assert.equal(w.feeds.get(w.tokens[0].selectorKey)!.nextFetchAt, due, "next read: the first look after the start, six days out");
    for (let t = w.clock.now + H; t < due; t += 6 * H) { w.clock.now = t; await fetchDue(w.d, w.tokens); }
    assert.equal(w.reads, 1, "nothing read before the game can have a final");
    w.clock.now = due; phase = "first"; await fetchDue(w.d, w.tokens);
    assert.equal(w.feeds.get(w.tokens[0].selectorKey)!.nextFetchAt, due + GAME_CONFIRM_GAP_MS, "a first final: read again five minutes later");
    w.clock.now = due + GAME_CONFIRM_GAP_MS; phase = "final"; await fetchDue(w.d, w.tokens);
    assert.equal(w.reads, 3);
    for (let i = 0; i < 50; i++) { w.clock.now += H; await fetchDue(w.d, w.tokens); }
    assert.equal(w.reads, 3, "a one-shot whose result is recorded is never read again");
  });

  test("a decided one-shot still waiting for its program reading gets exactly one read after its UTC day (plus the grace), then none", async () => {
    const w = loop({ rule: validateRule(PM_BUCS) as BurnRule, key: "polymarket:market:x", readings: 1, pending: [{ readingDate: null, kind: "result", settledAt: "2026-10-19T10:00:00Z" } as unknown as ReceiptRow], adapter: async () => ({ events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }) });
    const need = Date.parse("2026-10-20T00:00:00Z") + 60 * MIN;
    assert.equal(attestReadAt(w.d, w.tokens, null), need);
    await fetchDue(w.d, w.tokens);
    assert.deepEqual([w.reads, w.feeds.get("polymarket:market:x")!.nextFetchAt], [0, need]);
    w.clock.now = need; await fetchDue(w.d, w.tokens);
    assert.equal(w.reads, 1, "the one read the program needs");
    assert.equal(attestReadAt(w.d, w.tokens, w.feeds.get("polymarket:market:x")!.lastOkAt), null);
    w.clock.now += 2 * H; await fetchDue(w.d, w.tokens);
    assert.equal(w.reads, 1);
  });

  test("a team coin planned a week out still gets the one read the program needs after a result's UTC day; a failing read keeps its backoff", async () => {
    const rule = validateRule(BRONCOS) as BurnRule;
    const pending: Partial<ReceiptRow>[] = [];
    let fail = false;
    const w = loop({ rule, key: "kalshi:KXNFLGAME:binary", pending, adapter: async () => { if (fail) throw new Error("HTTP 503"); return { events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null, dueAt: w.clock.now + 7 * DAY }; } });
    await fetchDue(w.d, w.tokens);
    const weekOut = w.feeds.get("kalshi:KXNFLGAME:binary")!.nextFetchAt!;
    assert.equal(weekOut, w.clock.now + 7 * DAY);
    // the planning pass then plans a receipt dated today: the next read moves to tomorrow 00:00 UTC plus the grace
    pending.push({ readingDate: null, kind: "result", settledAt: "2026-10-19T10:00:00Z" } as unknown as ReceiptRow);
    w.clock.now += H; await fetchDue(w.d, w.tokens);
    const need = Date.parse("2026-10-20T01:00:00Z");
    assert.deepEqual([w.reads, w.feeds.get("kalshi:KXNFLGAME:binary")!.nextFetchAt], [1, need]);
    w.clock.now = need; fail = true; await fetchDue(w.d, w.tokens);
    assert.equal(w.reads, 2);
    const backoff = w.feeds.get("kalshi:KXNFLGAME:binary")!.nextFetchAt!;
    assert.ok(backoff > need);
    await fetchDue(w.d, w.tokens);
    assert.equal(w.reads, 2, "the backoff holds even though the program's read is due");
    fail = false; w.clock.now = backoff; await fetchDue(w.d, w.tokens);
    assert.equal(w.reads, 3);
    assert.equal(w.feeds.get("kalshi:KXNFLGAME:binary")!.nextFetchAt, backoff + 7 * DAY, "read after the day ended: back to the plan");
  });

  test("a coin whose rule has ended is not read; a feed reads in its window", async () => {
    const ended = loop({ rule: validateRule(BRONCOS) as BurnRule, key: "kalshi:KXNFLGAME:binary", ruleEnded: true, adapter: async () => ({ events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }) });
    await fetchDue(ended.d, ended.tokens);
    assert.equal(ended.reads, 0);
    const feed = loop({ rule: validateRule(DEBT_RULE) as BurnRule, key: "catalogue:treasury.debt", adapter: async () => ({ events: [{ id: "2026-10-16", at: "2026-10-16", result: null, value: "1" }], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }) });
    await fetchDue(feed.d, feed.tokens);
    assert.equal(feed.feeds.get("catalogue:treasury.debt")!.nextFetchAt, Date.parse("2026-10-19T19:00:00Z"), "Monday 11:00 EDT, outside the window: its opening at 15:00 EDT");
  });

  test("selectorIdle: a one-shot with its result; every rule ended; a recurring rule is never idle by its readings", () => {
    const reg = (o: { reading: boolean; ended: boolean; rule: unknown }) => ({ ruleEnd: () => (o.ended ? {} : null), readings: () => (o.reading ? [{ id: "e" }] : []), receipt: () => (o.reading ? { kind: "binary", status: "planned" } : null), lockedRule: () => ({ rule: validateRule(o.rule) as BurnRule }) });
    const t = [{ mint: "m", baselineAt: "2026-10-01T00:00:00Z" }];
    assert.match(selectorIdle(reg({ reading: true, ended: false, rule: PM_BUCS }), "k", t)!, /one-shot/);
    assert.equal(selectorIdle(reg({ reading: false, ended: false, rule: PM_BUCS }), "k", t), null);
    assert.equal(selectorIdle(reg({ reading: true, ended: false, rule: BRONCOS }), "k", t), null);
    assert.match(selectorIdle(reg({ reading: true, ended: true, rule: BRONCOS }), "k", t)!, /ended/);
  });
});

describe("the stall alert follows the plan", () => {
  const now = Date.parse("2026-10-19T15:00:00Z");
  const snap = (feed: Partial<FeedState>, o: Partial<TokenSnapshot> = {}): BurntickerSnapshot => ({
    now, paused: false, registryFile: ":memory:", lastCycle: null, audit: null, balances: null, crankStreaks: {},
    tokens: [{ mint: "m", ticker: "PHINFLWIN", status: "live", mode: "buyback", selectorKey: "catalogue:espn.team:x", liveSince: now - 30 * DAY, cadenceMs: H, feed: { selectorKey: "catalogue:espn.team:x", lastFetchAt: now - 3 * DAY, lastOkAt: now - 3 * DAY, failures: 0, lastError: null, nextFetchAt: now + 4 * DAY, ...feed }, pending: [], burns: 0, burns24h: 0, spent24hLamports: BigInt(0), feePdaSol: null, queuedSol: null, attesters: { active: 1, independent: 0 }, ...o } as TokenSnapshot],
  } as unknown as BurntickerSnapshot);
  const stalls = (s: BurntickerSnapshot) => evaluateAlerts(s).filter((a) => a.kind === "bt-feed-stall").length;
  test("a team coin planned for its next game in four days is not stalled after three idle days; it is once the planned read is missed", () => {
    assert.equal(stalls(snap({})), 0);
    assert.equal(stalls(snap({ lastFetchAt: now - 8 * DAY, lastOkAt: now - 8 * DAY, nextFetchAt: now - 2 * H })), 1, "the planned read is an hour past the cadence late");
  });
  test("an idle selector (a decided one-shot) is never stalled; a failing read still is", () => {
    assert.equal(stalls(snap({ lastFetchAt: now - 30 * DAY, nextFetchAt: null }, { idle: "a one-shot whose result is recorded" })), 0);
    assert.equal(stalls(snap({ failures: 3, lastFetchAt: now - 5 * H, lastOkAt: now - 3 * DAY, nextFetchAt: now + H })), 1);
  });
});
