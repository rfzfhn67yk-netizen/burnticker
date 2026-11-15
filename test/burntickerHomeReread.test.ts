// Prelaunch audit 2026-10-18 A-23: the coin list and the home data were read once per browser session (useHome.ts kept one promise
// for good, CoinsIndex read the index once), so after about twenty minutes of browsing the index showed the red line "The coin list
// was last read on … and may be out of date" although the client itself had refused to read it again. Both are now read again every
// REREAD_MS, which is shorter than the freshness window, while the tab is visible.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { REREAD_MS, RereadCache, rereadDue } from "@/lib/burnticker/rereadCache";
import { STALE_AFTER_MS, gridState } from "@/lib/burnticker/coinsGrid";

describe("A-23: shared client reads are repeated before the freshness window runs out", () => {
  test("the re-read interval is shorter than the coin list's freshness window", () => {
    assert.ok(REREAD_MS < STALE_AFTER_MS, `${REREAD_MS} < ${STALE_AFTER_MS}`);
  });
  test("RereadCache: one read shared inside the window, a new read after it, a failed read retried at once", async () => {
    let now = 0, calls = 0;
    const c = new RereadCache<number>(REREAD_MS, () => now);
    const read = () => { calls++; return Promise.resolve(calls); };
    assert.equal(await c.get(read), 1);
    now = REREAD_MS - 1; assert.equal(await c.get(read), 1, "shared inside the window");
    now = REREAD_MS; assert.equal(await c.get(read), 2, "read again once the window has passed (before: never)");
    const failing = () => { calls++; return Promise.reject(new Error("HTTP 500")); };
    now += REREAD_MS; await assert.rejects(c.get(failing));
    await Promise.resolve();
    assert.equal(await c.get(read), calls, "a failure is not kept");
  });
  test("rereadDue: only while visible and once the last attempt is REREAD_MS old", () => {
    assert.equal(rereadDue(0, REREAD_MS, true), true);
    assert.equal(rereadDue(0, REREAD_MS - 1, true), false);
    assert.equal(rereadDue(0, 10 * REREAD_MS, false), false, "a hidden tab does not poll");
  });
  test("a list re-read on schedule is never called out of date by the page itself; an old server index still is", () => {
    const base = { tab: "new" as const, loading: false, error: null, all: [], shown: 0, query: "", featuredMatches: 0 };
    // twenty minutes of browsing, the last repeat a minute ago: the index the server answered is fresh
    const t0 = Date.parse("2026-10-18T22:15:00Z"), now = t0 + 20 * 60_000;
    const fresh = gridState({ ...base, generatedAt: new Date(now - REREAD_MS).toISOString(), now }) as { body?: string; stale?: string | null };
    assert.doesNotMatch(JSON.stringify(fresh), /may be out of date/);
    const old = gridState({ ...base, all: [{ ticker: "A", phase: null, progressPct: null, nextCheckAt: null, nextCloseTime: null, launchedAt: null, status: "live" }] as never, shown: 1, generatedAt: new Date(t0).toISOString(), now });
    assert.match(JSON.stringify(old), /may be out of date/, "a server index twenty minutes old is still flagged");
  });
  test("useHome and the coin list use it: no session-long promise, a timer while visible, a visibility listener", () => {
    const hook = fs.readFileSync("src/app/burnticker/_components/useHome.ts", "utf8");
    assert.doesNotMatch(hook, /pending \?\?= once/, "before: one promise for the whole session");
    assert.match(hook, /cache\.get\(\(\) => once\(6\)\)/);
    assert.match(hook, /setInterval\(\(\) => \{ if \(document\.visibilityState === "visible"\) read\(\); \}, REREAD_MS\)/);
    const ix = fs.readFileSync("src/app/burnticker/CoinsIndex.tsx", "utf8");
    assert.match(ix, /rereadDue\(lastAttempt, Date\.now\(\), document\.visibilityState === "visible"\)/);
    assert.match(ix, /document\.addEventListener\("visibilitychange", tick\)/);
  });
});
