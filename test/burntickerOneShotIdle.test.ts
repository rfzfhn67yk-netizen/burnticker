// HB-29 (continuous audit 2026-10-19 15:10 Denver, P1). The live one-shot $NEXTM6 (burns on the next magnitude-6 earthquake, selector
// catalogue:usgs.quakenext:6, baselineAt 2026-10-19T15:09:00Z) was read once at 15:10:22Z and never again: its first read stored ten
// magnitude-6 days from before its launch (2026-09-17 … 2026-10-16), and readPlan.ts selectorIdle called any reading on the selector
// "a one-shot whose result is recorded", so fetchDue skipped it every cycle and left next_fetch_at 18:10:22Z for the pages to print,
// with no alert. These tests rebuild that registry and check: a one-shot is idle only once a reading after ITS OWN baseline settled ITS
// rule; a shared selector is read while any coin on it is undecided; an overdue read of an undecided coin raises bt-feed-overdue, which
// is pushed and shown as an ops condition; the page's next read is the plan's.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { openRegistry, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { lockRule, validateRule, type BurnRule } from "@/lib/burnticker/rules";
import { fetchDue, planToken, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { oneShotDecided, plannedNextCheckAt, selectorIdle } from "@/lib/burnticker/readPlan";
import { collectSnapshot, evaluateAlerts, type BurntickerSnapshot } from "@/lib/burnticker/alerts";
import { activeConditions } from "@/lib/burnticker/ops/conditions";
import { PUSH_KIND_OF_ALERT, planPushes } from "@/lib/burnticker/push";

const KEY = "catalogue:usgs.quakenext:6";
const BASELINE = "2026-10-19T15:09:00.000Z";
const LAST_FETCH = Date.parse("2026-10-19T15:10:22.295Z"), NEXT_FETCH = LAST_FETCH + 3 * 3_600_000;   // the live feed_state row
const AUDIT_AT = Date.parse("2026-10-19T21:25:00Z");
/** the live readings on the selector, all from before $NEXTM6 launched (value 1 = a qualifying day) */
const PRE_LAUNCH_DAYS = ["2026-09-17", "2026-09-20", "2026-09-25", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-16"];

const RULE = validateRule({ schema: "burnticker.rules/v1", oracle: "catalogue", series: "usgs.quakenext:6", market: null, filter: {}, kind: "scalar", scalar: { unit: 1, perUnit: { fractionOfPool: 1 }, baseline: 0, direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null }) as BurnRule;
const day = (d: string) => ({ id: d, at: d, result: null, value: "1", title: `The next reviewed magnitude 6 or more anywhere in the world (USGS): ${d}`, sourceUrl: "https://earthquake.usgs.gov/earthquakes/search/" });

let n = 0;
function coin(reg: Registry, ticker: string, baselineAt: string): TokenRow {
  const mint = `Mint${ticker}${++n}`.padEnd(43, "1");
  return reg.register({ mint, ticker, name: ticker, creator: "Creator1111111111111111111111111111111111111", description: "", imageUrl: null, links: [], rulesText: lockRule(RULE).text, feePda: `Fee${mint}`.slice(0, 44), vault: null, tokenConfig: null, poolId: null, launchTx: `launch${ticker}`, cluster: "mainnet-beta", platformId: null, baselineAt, status: "live" }, Date.parse(baselineAt));
}

/** The host registry as the audit found it: $NEXTM6 live and undecided, ten pre-launch readings, the one read at 15:10:22Z. */
function hostRegistry() {
  const reg = openRegistry(":memory:");
  const t = coin(reg, "NEXTM6", BASELINE);
  reg.putReadings("catalogue", KEY, PRE_LAUNCH_DAYS.map(day), { settlementSourceUrl: null, attestedBy: ["k"] }, LAST_FETCH);
  reg.setFeedState({ selectorKey: KEY, lastFetchAt: LAST_FETCH, lastOkAt: LAST_FETCH, failures: 0, lastError: null, nextFetchAt: NEXT_FETCH });
  return { reg, t };
}

function keeper(reg: Registry, now: number, events: () => ReturnType<typeof day>[] = () => []) {
  let reads = 0;
  const adapter = { id: "usgs-stub", settledSince: async () => { reads++; return { events: events(), awaitingFinal: 0, refusals: [], settlementSourceUrl: null }; } };
  const clock = { now };
  const d = { registry: reg, oracles: { kalshi: adapter, catalogue: adapter, polymarket: adapter }, attester: "k", log: () => {}, now: () => clock.now, dryRun: true } as unknown as KeeperDeps;
  return { d, clock, get reads() { return reads; } };
}

const snapshot = (reg: Registry, now: number): BurntickerSnapshot => ({ ...collectSnapshot({ registry: reg, siteDir: "/nonexistent-burnticker-site", now }), lastCycle: { at: now - 60_000, errors: [], refusals: [] } });
const overdue = (s: BurntickerSnapshot) => evaluateAlerts(s).filter((a) => a.kind === "bt-feed-overdue");

describe("HB-29: a one-shot is idle only once its own coin's result is recorded", () => {
  test("readings from before the coin's baseline (none fired for it) leave the selector live: the plan reads it", async () => {
    const { reg, t } = hostRegistry();
    assert.equal(reg.readings(KEY).length, 10);
    assert.equal(reg.readings(KEY, t.baselineAt).length, 0, "nothing on the selector settled after $NEXTM6's baseline");
    assert.equal(oneShotDecided(reg, KEY, t, RULE), false);
    assert.equal(selectorIdle(reg, KEY, reg.tokens("live")), null, "the old plan said: a one-shot whose result is recorded");
    const k = keeper(reg, AUDIT_AT);
    const [r] = await fetchDue(k.d, reg.tokens("live"));
    assert.deepEqual([k.reads, r.skipped], [1, false], "the overdue read is made on the next cycle");
    const st = reg.feedState(KEY);
    assert.equal(st.lastFetchAt, AUDIT_AT);
    assert.ok(st.nextFetchAt! > AUDIT_AT, "a new next read, not the stale 18:10:22Z");
    assert.equal(plannedNextCheckAt(reg, KEY, reg.tokens("live"), st.nextFetchAt), st.nextFetchAt, "the page prints the plan's next read");
  });

  test("a reading after the baseline that settled this coin's rule decides it: idle, no read, no next read on the page", async () => {
    const { reg, t } = hostRegistry();
    reg.putReadings("catalogue", KEY, [day("2026-10-21")], { settlementSourceUrl: null, attestedBy: ["k"] }, Date.parse("2026-10-23T01:00:00Z"));
    assert.equal(selectorIdle(reg, KEY, [t]), null, "a reading with no receipt for the coin yet does not decide it");
    const k = keeper(reg, Date.parse("2026-10-23T01:05:00Z"));
    const planned = planToken(k.d, t, reg.lockedRule(t));
    assert.deepEqual(planned.map((p) => p.eventId), ["2026-10-21"], "only the post-launch day is planned; the ten older days never are");
    assert.equal(oneShotDecided(reg, KEY, t, RULE), true);
    assert.equal(selectorIdle(reg, KEY, [t]), "a one-shot whose own result is recorded");
    reg.setFeedState({ ...reg.feedState(KEY), nextFetchAt: Date.parse("2026-10-23T03:00:00Z") });
    k.clock.now = Date.parse("2026-10-30T00:00:00Z");
    await fetchDue(k.d, [t]);
    assert.equal(k.reads, 1, "the one read after the result's UTC day that the program needs (attestReadAt)");
    k.clock.now += 6 * 3_600_000;
    const [r] = await fetchDue(k.d, [t]);
    assert.equal(r.skipped, true);
    assert.equal(k.reads, 1, "then a decided one-shot is not read again");
    assert.equal(reg.feedState(KEY).nextFetchAt, null, "HB-28: no next read is left behind for a page to print");
    assert.equal(plannedNextCheckAt(reg, KEY, [t], Date.parse("2026-10-23T03:00:00Z")), null);
    assert.equal(overdue(snapshot(reg, k.clock.now)).length, 0, "a decided coin is never overdue");
  });

  test("two coins on one selector, one decided and one not: not idle; idle once both are decided", () => {
    const { reg, t: first } = hostRegistry();
    const second = coin(reg, "QUAKE6B", "2026-10-22T00:00:00.000Z");
    reg.putReadings("catalogue", KEY, [day("2026-10-21")], { settlementSourceUrl: null, attestedBy: ["k"] }, Date.parse("2026-10-23T01:00:00Z"));
    const k = keeper(reg, Date.parse("2026-10-23T01:05:00Z"));
    planToken(k.d, first, reg.lockedRule(first));
    assert.deepEqual(planToken(k.d, second, reg.lockedRule(second)), [], "10-21 is before the second coin's baseline");
    assert.equal(oneShotDecided(reg, KEY, first, RULE), true);
    assert.equal(oneShotDecided(reg, KEY, second, RULE), false, "the first coin's result is not the second coin's");
    assert.equal(selectorIdle(reg, KEY, reg.tokens("live")), null);
    reg.putReadings("catalogue", KEY, [day("2026-10-24")], { settlementSourceUrl: null, attestedBy: ["k"] }, Date.parse("2026-10-26T01:00:00Z"));
    planToken(k.d, second, reg.lockedRule(second));
    assert.equal(selectorIdle(reg, KEY, reg.tokens("live")), "every coin on it is a one-shot whose own result is recorded");
  });
});

describe("HB-29: an overdue read of an undecided coin alerts, is pushed and is an ops condition", () => {
  test("the audit's moment: due 18:10:22Z, unread at 21:25Z, $NEXTM6 undecided", () => {
    const { reg } = hostRegistry();
    const [a] = overdue(snapshot(reg, AUDIT_AT));
    assert.ok(a, "bt-feed-overdue raised");
    assert.equal(a.key, `bt-feed-overdue:${KEY}`);
    assert.match(a.text, /catalogue:usgs\.quakenext:6 for \$NEXTM6 was due a read at 12:10 Denver, 195 min ago/);
    assert.match(a.text, /Why: the keeper did not make the read\./);
    assert.deepEqual(a.meta, { selectorKey: KEY, mints: [reg.tokens("live")[0].mint], dueAt: NEXT_FETCH, lastFetchAt: LAST_FETCH, idle: null });
    // within one cadence (three hours) of the due time it is not overdue yet
    assert.equal(overdue(snapshot(reg, NEXT_FETCH + 2 * 3_600_000)).length, 0);
  });

  test("a due read the plan skipped as idle while the coin is undecided (the deployed bug) names the skip", () => {
    const { reg } = hostRegistry();
    const s = snapshot(reg, AUDIT_AT);
    const buggy: BurntickerSnapshot = { ...s, tokens: s.tokens.map((t) => ({ ...t, idle: "a one-shot whose result is recorded" })) };
    const [a] = overdue(buggy);
    assert.match(a.text, /Why: the read plan skipped it as idle \(a one-shot whose result is recorded\), but the coin's result is still open\./);
    const cond = activeConditions(buggy, null).find((c) => c.kind === "bt-feed-overdue");
    assert.equal(cond?.label, `bt-feed-overdue(${KEY})`, "ops.json names the selector");
    assert.match(cond!.text, /\$NEXTM6/);
  });

  test("it is pushed at high priority with plain copy", () => {
    assert.equal(PUSH_KIND_OF_ALERT["bt-feed-overdue"], "feed-overdue");
    const { reg } = hostRegistry();
    const [a] = overdue(snapshot(reg, AUDIT_AT));
    const { messages } = planPushes({ now: AUDIT_AT, state: { cursor: AUDIT_AT - 3_600_000, lastByKind: {}, sent: [], held: {}, heldToday: 0, lastDaily: new Date(AUDIT_AT).toLocaleDateString("en-CA", { timeZone: "America/Denver" }) }, alerts: [{ ts: AUDIT_AT - 1000, kind: a.kind, key: a.key, text: a.text }] });
    const m = messages.find((x) => x.kind === "feed-overdue");
    assert.ok(m);
    assert.equal(m.priority, "high");
    assert.match(m.body, /\$NEXTM6/);
    assert.doesNotMatch(`${m.title} ${m.body}`, /→|\bwill\b|\d{4}-\d{2}-\d{2}/);
  });
});

// HB-64 (sixth-pass audit 2026-10-19, P3): the decided one-game pair $DENWIN / $SEAWIN (result in, receipts "pending-pair" while the pair
// waits for both pools) was still planned for a source read at 04:09Z: oneShotDecided did not count a pending-pair receipt. The result is
// recorded, and what the receipt waits for is the pair's pools, never the source, so the coin is decided: not read, no next read on its
// page. A sibling on the same game selector whose own result is not recorded keeps the selector read.
describe("HB-64: a decided pair coin is not planned for further reads of its game selector", () => {
  const GAME = "catalogue:espn.game:nfl-2475453-DEN-win";
  // the live $DENWIN rule: side B of the one-game pair with $SEAWIN (both-or-neither, winner takes the burn)
  const GAME_RULE = validateRule({ schema: "burnticker.rules/v1", oracle: "catalogue", series: "espn.game:nfl-2475453-DEN-win", market: null, filter: {}, kind: "scalar", scalar: { unit: 1, perUnit: { fractionOfPool: 1 }, baseline: 0, direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null,
    onEnd: { endSink: true, sweepThresholdLamports: 50_000_000, windDownDays: 28 },
    pair: { clause: "both-or-neither", counterpartMint: "Bg545NmTcascUHGpH8HcJpTgrasUqFZEDNhYhuTbBURN", game: { series: ["espn.game:nfl-2475453-SEA-win", "espn.game:nfl-2475453-DEN-win"] }, pairId: "seawin-vs-denwin-espn-game-nfl-2475453-s", side: "B", voidBy: "2026-11-14", winnerTakesBurn: true } }) as BurnRule;
  const gameCoin = (reg: Registry, ticker: string, baselineAt: string): TokenRow => {
    const mint = `Mint${ticker}${++n}`.padEnd(43, "1");
    return reg.register({ mint, ticker, name: ticker, creator: "Creator1111111111111111111111111111111111111", description: "", imageUrl: null, links: [], rulesText: lockRule(GAME_RULE).text, feePda: `Fee${mint}`.slice(0, 44), vault: null, tokenConfig: null, poolId: null, launchTx: `launch${ticker}`, cluster: "mainnet-beta", platformId: null, baselineAt, status: "live" }, Date.parse(baselineAt));
  };
  const RESULT = { id: "2026-10-16", at: "2026-10-16", result: null, value: "1", title: "Broncos won", sourceUrl: "https://www.espn.com/nfl/scoreboard" };

  test("the decided coin (pending-pair receipt) is decided, idle on its own, and its page shows no next read; an undecided sibling keeps the selector planned", async () => {
    const reg = openRegistry(":memory:");
    const decided = gameCoin(reg, "DENWIN", "2026-10-15T02:44:10.000Z");
    const readAt = Date.parse("2026-10-17T05:00:00Z");
    reg.putReadings("catalogue", GAME, [RESULT], { settlementSourceUrl: null, attestedBy: ["k"] }, readAt);
    assert.ok(reg.applyStep(decided.mint, { ...RESULT, settledAt: RESULT.at } as never, { units: 1, mapping: { fractionOfPool: 1 }, kind: "yes", note: "the Broncos won", carryOut: "0", baseline: null }, { value: null, carryOut: "0" }, false, readAt, "pending-pair"));
    assert.equal(reg.receipt(decided.mint, RESULT.id)?.status, "pending-pair");
    assert.equal(oneShotDecided(reg, GAME, decided, GAME_RULE), true, "a pending-pair receipt is a recorded result");
    assert.ok(selectorIdle(reg, GAME, [decided]));
    const planned = readAt + 6 * 3_600_000;
    reg.setFeedState({ selectorKey: GAME, lastFetchAt: readAt, lastOkAt: Date.parse("2026-10-19T22:09:26Z"), failures: 0, lastError: null, nextFetchAt: planned });
    assert.equal(plannedNextCheckAt(reg, GAME, [decided], planned), null, "the page prints no next read");
    const k = keeper(reg, Date.parse("2026-10-20T04:10:00Z"));
    const [r] = await fetchDue(k.d, [decided]);
    assert.deepEqual([r.skipped, k.reads], [true, 0], "not planned for a read at 04:09Z");
    assert.equal(reg.feedState(GAME).nextFetchAt, null, "and no next read is left behind");
    assert.equal(overdue(snapshot(reg, Date.parse("2026-10-21T00:00:00Z"))).length, 0, "a decided pair coin is never overdue");

    // an undecided sibling on the same selector, launched after that result: the selector stays planned for it; the decided coin's page still shows none
    const sibling = gameCoin(reg, "DENWIN2", "2026-10-18T00:00:00.000Z");
    assert.equal(oneShotDecided(reg, GAME, sibling, GAME_RULE), false);
    assert.equal(selectorIdle(reg, GAME, reg.tokens("live")), null, "read while any coin on it is undecided");
    reg.setFeedState({ ...reg.feedState(GAME), nextFetchAt: planned });
    assert.equal(plannedNextCheckAt(reg, GAME, [sibling], planned), planned, "the sibling's page shows the next read");
    assert.equal(plannedNextCheckAt(reg, GAME, [decided], planned), null, "the decided coin's page does not");
    const [r2] = await fetchDue(k.d, reg.tokens("live"));
    assert.deepEqual([r2.skipped, k.reads], [false, 1], "the selector is still read for the sibling");
  });
});

// HB-48 (continuous audit 2026-10-19, hourly run 4): the idle skip nulled nextFetchAt and the overdue alert skipped a null due time, so a
// wrongly idle selector went silent again. The alert now judges an idle or unplanned selector from the coin's own cadence and its last
// good read, a coin is decided only when its own receipts agree, and an idle skip disputed by the receipts keeps the planned time.
describe("HB-48: the overdue alert is judged from the coin's own cadence and receipts, not the erased due time", () => {
  test("nextFetchAt null, idle 'one-shot recorded', no settlement receipt, last good read two cadences ago: bt-feed-overdue raised", () => {
    const { reg } = hostRegistry();
    const cadence = snapshot(reg, AUDIT_AT).tokens[0].cadenceMs;
    const lastOk = AUDIT_AT - 2 * cadence;
    reg.setFeedState({ selectorKey: KEY, lastFetchAt: lastOk, lastOkAt: lastOk, failures: 0, lastError: null, nextFetchAt: null });
    const s = snapshot(reg, AUDIT_AT);
    assert.equal(s.tokens[0].decided, false, "no settlement receipt: the coin's result is open");
    const wrong: BurntickerSnapshot = { ...s, tokens: s.tokens.map((t) => ({ ...t, idle: "one-shot recorded" })) };
    const [a] = overdue(wrong);
    assert.ok(a, "bt-feed-overdue raised");
    assert.match(a.text, /Why: the read plan skipped it as idle \(one-shot recorded\), but the coin's result is still open\./);
    assert.equal((a.meta as { dueAt: number }).dueAt, lastOk + cadence, "due one cadence after the last good read");
    // a snapshot without `decided` is open too, never judged from the idle verdict it is checking
    const bare: BurntickerSnapshot = { ...wrong, tokens: wrong.tokens.map((t) => { const c = { ...t }; delete c.decided; return c; }) };
    assert.equal(overdue(bare).length, 1);
    // short of two cadences after the last good read it is not overdue yet
    assert.equal(overdue({ ...wrong, now: lastOk + 2 * cadence - 60_000 }).length, 0);
  });

  test("a legitimately decided coin (its own receipt recorded, plan idle, nextFetchAt null, old read) raises none", () => {
    const { reg, t } = hostRegistry();
    const readAt = Date.parse("2026-10-23T01:00:00Z");
    reg.putReadings("catalogue", KEY, [day("2026-10-21")], { settlementSourceUrl: null, attestedBy: ["k"] }, readAt);
    const k = keeper(reg, readAt + 300_000);
    planToken(k.d, t, reg.lockedRule(t));
    reg.setFeedState({ selectorKey: KEY, lastFetchAt: readAt, lastOkAt: readAt, failures: 0, lastError: null, nextFetchAt: null });
    const s = snapshot(reg, Date.parse("2026-11-05T00:00:00Z"));
    assert.equal(s.tokens[0].decided, true);
    assert.ok(s.tokens[0].idle);
    assert.equal(overdue(s).length, 0);
  });

  test("an idle skip the coin's receipts dispute keeps the planned time in feed_state; an undisputed one clears it", async () => {
    const { reg, t } = hostRegistry();
    const readAt = Date.parse("2026-10-23T01:00:00Z");
    reg.putReadings("catalogue", KEY, [day("2026-10-21")], { settlementSourceUrl: null, attestedBy: ["k"] }, readAt);
    // the plan misjudges: it sees a result receipt on the reading, while the coin's own receipts hold none (HB-29's shape)
    const misjudged = new Proxy(reg, { get(target, p) { if (p === "receipt") return () => ({ kind: "result", status: "confirmed" }); const v = Reflect.get(target, p, target) as unknown; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v; } });
    assert.ok(selectorIdle(misjudged, KEY, [t]), "the plan calls it idle");
    const planned = readAt + 3 * 3_600_000;
    reg.setFeedState({ selectorKey: KEY, lastFetchAt: readAt, lastOkAt: readAt, failures: 0, lastError: null, nextFetchAt: planned });
    const k = keeper(misjudged, Date.parse("2026-10-30T00:00:00Z"));
    const [r] = await fetchDue(k.d, [t]);
    assert.equal(r.skipped, true, "the plan skips it");
    assert.equal(reg.feedState(KEY).nextFetchAt, planned, "the planned read is kept for the alert");
    const s = snapshot(reg, k.clock.now);
    const [a] = overdue({ ...s, tokens: s.tokens.map((x) => ({ ...x, idle: "a one-shot whose own result is recorded" })) });
    assert.ok(a, "and the alert sees it");
  });
});
