// AN EVENT COIN'S CADENCE (owner, 2026-10-14: "do we need to constantly be rechecking?"). A one-market Polymarket coin is read hourly
// until 24 hours before its market's end date, then every 5 minutes until the payout is final; no end date (or one already past) keeps
// the 5-minute poll; the end date is read from Gamma once and cached in the status table; a read that finds the market resolved writes its
// reading in that same cycle. A stub registry and adapter; no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { POLY_END_STATUS_PREFIX, POLY_FAR_POLL_MS, cadenceMsFor, fetchDue, nextPollMs, polymarketPollMs, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { FeedState, TokenRow } from "@/lib/burnticker/registry";

const NOW = Date.parse("2026-10-14T18:00:00Z");
const H = 3_600_000, FIVE = 5 * 60_000;
const CID = "0x" + "ab".repeat(32);
const KEY = `polymarket:market:${CID}`;
const RULE = { schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: CID, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 0.1 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } as unknown as BurnRule;

function world(o: { endDate: string | null | "throw"; resolved?: boolean }) {
  const status = new Map<string, string>(), feeds = new Map<string, FeedState>();
  let gamma = 0, reads = 0, written = 0;
  const registry = {
    feedState: (k: string): FeedState => feeds.get(k) ?? { selectorKey: k, lastFetchAt: null, lastOkAt: null, failures: 0, lastError: null, nextFetchAt: null },
    setFeedState: (s: FeedState) => { feeds.set(s.selectorKey, s); },
    lockedRule: () => ({ rule: RULE }),
    lastReading: () => null,
    getStatus: (k: string) => status.get(k) ?? null,
    setStatus: (k: string, v: unknown) => { status.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    putReadings: (_o: string, _k: string, events: unknown[]) => { written += events.length; return events.length; },
    recordAlert: () => null,
  };
  const polymarket = {
    id: "polymarket",
    marketByCondition: async () => { gamma++; if (o.endDate === "throw") throw new Error("Gamma 503"); return { endDate: o.endDate, umaEndDate: null }; },
    settledSince: async () => { reads++; return { events: o.resolved ? [{ id: CID, at: "2026-10-14T17:00:00Z", result: "yes", value: null, title: "resolved", sourceUrl: "https://polymarket.com" }] : [], awaitingFinal: o.resolved ? 0 : 1, refusals: [], settlementSourceUrl: null }; },
  };
  const d = { registry, oracles: { kalshi: {}, catalogue: {}, polymarket }, attester: "k", log: () => {}, now: () => NOW, dryRun: true } as unknown as KeeperDeps;
  const tokens = [{ selectorKey: KEY, ticker: "EVT", mint: "m", status: "live" } as unknown as TokenRow];
  return { d, tokens, feeds, status, get gamma() { return gamma; }, get reads() { return reads; }, get written() { return written; } };
}

describe("an event coin's read cadence", () => {
  test("pure: hourly far from close, never past the start of the last day, 5 minutes inside it, 5 minutes with no end date or a past one", () => {
    const end = NOW + 30 * 86_400_000;
    assert.equal(polymarketPollMs(end, NOW), POLY_FAR_POLL_MS);
    assert.equal(polymarketPollMs(NOW + 24 * H + 20 * 60_000, NOW), 20 * 60_000, "the first read inside the last day lands on time");
    assert.equal(polymarketPollMs(NOW + 23 * H, NOW), FIVE);
    assert.equal(polymarketPollMs(null, NOW), FIVE);
    assert.equal(polymarketPollMs(NOW - H, NOW), FIVE);
  });

  test("far from close: the next read is in an hour, and Gamma is asked once (the end date is cached in the status table)", async () => {
    const w = world({ endDate: new Date(NOW + 60 * 86_400_000).toISOString() });
    await fetchDue(w.d, w.tokens);
    assert.equal(w.feeds.get(KEY)!.nextFetchAt, NOW + H);
    assert.equal(w.gamma, 1); assert.ok(w.status.get(POLY_END_STATUS_PREFIX + KEY));
    assert.equal(await nextPollMs(w.d, RULE, KEY, NOW + H), H); assert.equal(w.gamma, 1, "the cache answers");
    assert.equal(cadenceMsFor(w.d.registry, {}, RULE, KEY, NOW), H, "the stall alert expects the hourly cadence");
  });

  test("inside the last day: 5 minutes", async () => {
    const w = world({ endDate: new Date(NOW + 10 * H).toISOString() });
    await fetchDue(w.d, w.tokens);
    assert.equal(w.feeds.get(KEY)!.nextFetchAt, NOW + FIVE);
  });

  test("no end date, or a Gamma read that fails: 5 minutes (a failed read is not cached)", async () => {
    const none = world({ endDate: null });
    await fetchDue(none.d, none.tokens);
    assert.equal(none.feeds.get(KEY)!.nextFetchAt, NOW + FIVE);
    const down = world({ endDate: "throw" });
    await fetchDue(down.d, down.tokens);
    assert.equal(down.feeds.get(KEY)!.nextFetchAt, NOW + FIVE);
    assert.equal(down.status.get(POLY_END_STATUS_PREFIX + KEY), undefined);
    assert.equal(cadenceMsFor(down.d.registry, {}, RULE, KEY, NOW), FIVE);
  });

  test("a read that finds the market resolved writes its reading at once, even months before the end date", async () => {
    const w = world({ endDate: new Date(NOW + 60 * 86_400_000).toISOString(), resolved: true });
    const r = await fetchDue(w.d, w.tokens);
    assert.equal(w.reads, 1); assert.equal(w.written, 1);
    assert.deepEqual(r.map((x) => [x.written, x.skipped, x.error]), [[1, false, null]]);
  });
});
