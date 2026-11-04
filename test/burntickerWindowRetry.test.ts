// CH7-3 (seventh pre-launch audit, HB-29 follow-up): the once-a-day USGS read for $NEXTM6 timed out five times from 00:30Z on 10-20,
// and a failure streak in a window had no bound and no fallback later in the day. A windowed feed's failed read now retries on a short back-off, then
// hourly while its window is open, then in a late window 12 hours after the opening, then at the next opening; a day on which every read
// fails costs about ten requests, fewer than before.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fetchDue, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { LATE_READ_AFTER_H, WINDOW_FAST_CAP_MS, WINDOW_FAST_RETRIES, windowFailureNextAt, type ReadWindow } from "@/lib/burnticker/readPlan";
import { backoffMs } from "@/lib/burnKeeper/schedule";
import { feedById } from "@/lib/burnticker/catalogue";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { applyDial } from "@/lib/burnticker/dials";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { FeedState, TokenRow } from "@/lib/burnticker/registry";

const H = 3_600_000, MIN = 60_000;
const W = feedById("usgs.quakenext:6")!.readWindow as ReadWindow;
const OPEN = Date.parse("2026-10-20T00:30:00Z");

describe("CH7-3: a windowed feed's failed read", () => {
  test("the shipped USGS window is 00:30 UTC for 4 hours", () => assert.deepEqual(W, { tz: "UTC", days: "all", opensAt: "00:30", hours: 4 }));
  test("short back-off first, then hourly inside the window, then the late window, then the next opening", () => {
    for (let f = 1; f <= WINDOW_FAST_RETRIES; f++) { const d = windowFailureNextAt(W, OPEN, f, backoffMs) - OPEN; assert.ok(d > 0 && d <= WINDOW_FAST_CAP_MS, `try ${f}: ${d}`); }
    assert.equal(windowFailureNextAt(W, OPEN + 10 * MIN, WINDOW_FAST_RETRIES + 1, backoffMs), OPEN + 10 * MIN + H, "hourly inside the window");
    assert.equal(windowFailureNextAt(W, OPEN + 3.5 * H, 9, backoffMs), OPEN + LATE_READ_AFTER_H * H, "the hour would pass the window: the late read");
    assert.equal(windowFailureNextAt(W, OPEN + LATE_READ_AFTER_H * H, 9, backoffMs), OPEN + (LATE_READ_AFTER_H + 1) * H, "hourly in the late window");
    assert.equal(windowFailureNextAt(W, OPEN + (LATE_READ_AFTER_H + 1) * H, 9, backoffMs), OPEN + 24 * H, "then the next day's opening");
  });
});

function loop(rule: BurnRule, key: string, adapter: () => Promise<unknown>) {
  const feeds = new Map<string, FeedState>(), status = new Map<string, string>();
  let reads = 0;
  const registry = {
    feedState: (k: string): FeedState => feeds.get(k) ?? { selectorKey: k, lastFetchAt: null, lastOkAt: null, failures: 0, lastError: null, nextFetchAt: null },
    setFeedState: (s: FeedState) => { feeds.set(s.selectorKey, s); },
    lockedRule: () => ({ rule }), lastReading: () => null, readings: () => [], receipt: () => null,
    getStatus: (k: string) => status.get(k) ?? null, setStatus: (k: string, v: unknown) => { status.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    putReadings: () => 0, recordAlert: () => null, ruleEnd: () => null, pending: () => [],
  };
  const a = { id: "stub", settledSince: async () => { reads++; return adapter(); } };
  const clock = { now: OPEN };
  const d = { registry, oracles: { kalshi: a, catalogue: a, polymarket: a }, attester: "k", log: () => {}, now: () => clock.now, dryRun: true } as unknown as KeeperDeps;
  const tokens = [{ selectorKey: key, ticker: "NEXTM6", mint: "m", status: "live", baselineAt: "2026-10-13T00:00:00Z" } as unknown as TokenRow];
  return { d, tokens, feeds, clock, get reads() { return reads; } };
}

describe("CH7-3 on the keeper loop", () => {
  const rule = applyDial(firstPartyRule("usgs.quakenext:6", 0.02), "fraction", 1) as BurnRule;
  const key = `catalogue:${rule.series}`;
  const ok = { events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null };
  test("the 10-20 morning: five timeouts at 00:30, then the source answers; the read lands within the hour", async () => {
    let failsLeft = 5;
    const w = loop(rule, key, async () => { if (failsLeft-- > 0) throw new Error("This operation was aborted"); return ok; });
    for (let t = OPEN; t < OPEN + 4 * H; t += MIN) { w.clock.now = t; await fetchDue(w.d, w.tokens); if (w.feeds.get(key)!.lastOkAt) break; }
    const st = w.feeds.get(key)!;
    assert.ok(st.lastOkAt !== null && st.lastOkAt - OPEN <= 75 * MIN, `read at +${((st.lastOkAt ?? 0) - OPEN) / MIN} min`);
    assert.equal(st.failures, 0);
  });
  test("a day on which every read fails: a bounded number of requests, including a late read, and the next day's opening", async () => {
    const w = loop(rule, key, async () => { throw new Error("This operation was aborted"); });
    const seen: number[] = [];
    for (let t = OPEN; t < OPEN + 24 * H + 30 * MIN; t += MIN) { w.clock.now = t; const before = w.reads; await fetchDue(w.d, w.tokens); if (w.reads > before) seen.push(t); }
    const day1 = seen.filter((t) => t < OPEN + 24 * H);
    assert.ok(day1.length >= 8 && day1.length <= 12, `${day1.length} requests on the failing day`);
    assert.ok(day1.some((t) => t >= OPEN + LATE_READ_AFTER_H * H && t < OPEN + (LATE_READ_AFTER_H + 2) * H), "a second read later in the day");
    assert.ok(seen.includes(OPEN + 24 * H), "the next opening is read");
  });
});
