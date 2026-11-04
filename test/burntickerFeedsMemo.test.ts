// 2026-10-16 prelaunch audit F-11: /api/burnticker/feeds/receipts.rss cost 7 to 12 s on the box, because every request read each coin's
// page from the chain in turn (feedsData.ts collectFeedData → tokenPageData per coin). Now the feeds are built from a memoised copy
// (feedsData.ts cachedFeedData: stale while revalidate, one rebuild in flight, as home/route.ts does), and a rebuild reads through the
// site's read cache, a few coins at a time. These tests count the chain reads a request makes.
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { makeWorld } from "./burntickerApiHelpers.ts";
import { setPlatformForTests, type Platform } from "@/lib/burnticker/server";

function counting(p: Platform): { p: Platform; reads: () => number } {
  let n = 0;
  const program = new Proxy(p.program as object, { get(t, k, r) { const v = Reflect.get(t, k, r); return typeof v === "function" ? (...a: unknown[]) => { n++; return (v as (...x: unknown[]) => unknown).apply(t, a); } : v; } }) as Platform["program"];
  return { p: { ...p, program }, reads: () => n };
}
const get = async (feed = "receipts.rss") => {
  const { GET } = await import("../src/app/api/burnticker/feeds/[feed]/route.ts");
  return GET(new Request(`http://bt.test/api/burnticker/feeds/${feed}`), { params: Promise.resolve({ feed }) });
};

describe("the feeds are built from a memoised copy (F-11)", () => {
  after(() => setPlatformForTests(null));

  test("a second request inside the memo window makes no per-coin chain read", async () => {
    const w = await makeWorld();
    const c = counting(w.p);
    setPlatformForTests(c.p);
    const first = await get();
    assert.equal(first.status, 200);
    const afterFirst = c.reads();
    assert.ok(afterFirst > 0, "the first build reads the coins");
    const second = await get();
    assert.equal(second.status, 200);
    assert.equal(c.reads() - afterFirst, 0, "the second request read the chain again");
    assert.equal(await second.text(), await first.text());
    const other = await get("next-results.json");
    assert.equal(other.status, 200);
    assert.equal(c.reads() - afterFirst, 0, "the other feed shares the same copy");
  });

  test("a stale copy is served at once and rebuilt in the background", async () => {
    const { cachedFeedData } = await import("@/lib/burnticker/feedsData");
    const w = await makeWorld();
    let builds = 0;
    const registry = new Proxy(w.p.registry as object, { get(t, k, r) { const v = Reflect.get(t, k, r); return k === "tokens" ? (...a: unknown[]) => { builds++; return (v as (...x: unknown[]) => unknown).apply(t, a); } : typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v; } }) as Platform["registry"];
    const p = { ...w.p, registry };
    let t = 1_000_000;
    const a = await cachedFeedData(p, { now: () => t });
    assert.equal(builds, 1);
    t += 30_000;
    assert.equal(await cachedFeedData(p, { now: () => t }), a, "fresh: served from the copy");
    assert.equal(builds, 1, "no rebuild inside the window");
    t += 10 * 60_000;
    const b = await cachedFeedData(p, { now: () => t });
    assert.equal(b, a, "the stale copy was served at once");
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(builds, 2, "and one rebuild ran in the background");
  });

  test("past 15 minutes stale with rebuilds failing, the feeds say unavailable instead of serving an old copy (F-11 review 10)", async () => {
    const { cachedFeedData, FEED_STALE_LIMIT_MS } = await import("@/lib/burnticker/feedsData");
    assert.equal(FEED_STALE_LIMIT_MS, 15 * 60_000);
    const w = await makeWorld();
    let broken = false;
    const registry = new Proxy(w.p.registry as object, { get(t, k, r) { const v = Reflect.get(t, k, r); return k === "tokens" ? (...a: unknown[]) => { if (broken) throw new Error("registry unreadable"); return (v as (...x: unknown[]) => unknown).apply(t, a); } : typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v; } }) as Platform["registry"];
    const p = { ...w.p, registry };
    let t = 5_000_000;
    assert.equal((await cachedFeedData(p, { now: () => t })).ok, true);
    broken = true;
    t += 5 * 60_000;
    assert.equal((await cachedFeedData(p, { now: () => t })).ok, true, "a few minutes stale: the copy is still served");
    await new Promise((r) => setTimeout(r, 50));
    t += 11 * 60_000;
    assert.equal((await cachedFeedData(p, { now: () => t })).ok, false, "16 minutes stale and the rebuilds fail: unavailable");
    broken = false;
    await cachedFeedData(p, { now: () => t });   // a request starts the next rebuild
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await cachedFeedData(p, { now: () => t })).ok, true, "a rebuild that works brings it back");
  });

  test("a rebuild that hangs: past 15 minutes the feeds say unavailable too (F-11 re-review)", async () => {
    const { cachedFeedData } = await import("@/lib/burnticker/feedsData");
    const w = await makeWorld();
    let hang = false;
    const program = new Proxy(w.p.program as object, { get(t, k, r) { const v = Reflect.get(t, k, r); return typeof v === "function" ? (...a: unknown[]) => (hang ? new Promise(() => { /* never */ }) : (v as (...x: unknown[]) => unknown).apply(t, a)) : v; } }) as Platform["program"];
    const batchReader = null;
    const p = { ...w.p, program, batchReader };
    let t = 9_000_000;
    assert.equal((await cachedFeedData(p, { now: () => t })).ok, true);
    hang = true;
    t += 2 * 60_000;
    assert.equal((await cachedFeedData(p, { now: () => t })).ok, true, "the copy is served while the rebuild runs");
    t += 14 * 60_000;
    assert.equal((await cachedFeedData(p, { now: () => t })).ok, false, "16 minutes old with the rebuild still hanging: unavailable");
  });
});
