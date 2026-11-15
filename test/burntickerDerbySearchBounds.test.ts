// I-7 (audit 2026-10-19): GET /v1/derby/search took 3.5 to 18 s per query, had no bound on its input and bypassed the edge cache with
// varied queries. Now: the query is normalised and bounded (length, characters), the upstream work has one deadline and capped candidates,
// normalised queries are cached briefly (one search in flight per query), and cache misses are rate-limited per client.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DERBY_QUERY_MAX, DERBY_JUP_CANDIDATES, normalizeDerbyQuery, searchDerbyCoins } from "@/lib/burnticker/derby/search";
import { v1DerbySearch, DERBY_SEARCH_CACHE_MAX } from "@/lib/burnticker/api/derby";
import { JUP_SEARCH_URL } from "@/lib/burnticker/derby/cross";
import type { Platform } from "@/lib/burnticker/server";
import { lintCopy } from "@/lib/launch/copyLint";

const CATALOGUE = [{ id: "ab".repeat(32), symbol: "Crypto.WIF/USD", asset_type: "Crypto" }] as never;
const jupTokens = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `Mint${String(i).padStart(40, "x")}`, symbol: `TK${i}`, name: `Token ${i}`, isVerified: true, liquidity: 1_000_000, decimals: 6 }));

/** A fetch that answers Jupiter with `n` tokens and DexScreener after `poolDelayMs` (or never: -1); every call is counted. */
function fakeFetch(o: { n?: number; poolDelayMs?: number } = {}) {
  const calls: string[] = [];
  const f = async (url: string, init?: { signal?: AbortSignal }) => {
    calls.push(url);
    if (url.startsWith(JUP_SEARCH_URL)) return new Response(JSON.stringify(jupTokens(o.n ?? 5)), { status: 200 });
    if (url.includes("dexscreener")) {
      return new Promise<Response>((resolve, reject) => {
        const t = (o.poolDelayMs ?? 0) >= 0 ? setTimeout(() => resolve(new Response(JSON.stringify({ pairs: [] }), { status: 200 })), o.poolDelayMs ?? 0) : null;
        init?.signal?.addEventListener("abort", () => { if (t) clearTimeout(t); reject(new Error("aborted")); });
      });
    }
    return new Response("{}", { status: 200 });
  };
  return { f, calls };
}

describe("I-7: the query is bounded", () => {
  test("normalised (NFKC, trimmed, single spaces); too short, too long or other characters are refused in plain words", () => {
    assert.deepEqual(normalizeDerbyQuery("  ＷＩＦ   coin "), { query: "WIF coin" });
    assert.deepEqual(normalizeDerbyQuery("$wif"), { query: "$wif" });
    assert.deepEqual(normalizeDerbyQuery("EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"), { query: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" });
    for (const bad of ["w", "", "a".repeat(DERBY_QUERY_MAX + 1), "x".repeat(10_000), "wif<script>", "wif\u0000", "😀😀", "a/b", "q=1&r"]) {
      const r = normalizeDerbyQuery(bad);
      assert.ok("error" in r, bad.slice(0, 20));
      assert.equal(lintCopy("error" in r ? r.error : "").hits.length, 0);
    }
  });
  test("the API answers 400 for a bad query and never reads upstream", async () => {
    const { f, calls } = fakeFetch();
    const p = { derbyFetch: f } as unknown as Platform;
    for (const q of ["w", "a".repeat(200), "<x>"]) assert.equal((await v1DerbySearch(p, new URLSearchParams({ q }))).status, 400);
    assert.equal(calls.length, 0);
  });
});

describe("I-7: the work is capped", () => {
  test("at most DERBY_JUP_CANDIDATES Jupiter tokens and three pool reads, side by side", async () => {
    const { f, calls } = fakeFetch({ n: 500, poolDelayMs: 200 });
    const t0 = Date.now();
    const hits = await searchDerbyCoins("tk", { fetchImpl: f as never, catalogue: CATALOGUE, redstoneIds: new Set(), deadlineAt: Date.now() + 5_000 });
    const ms = Date.now() - t0;
    assert.ok(hits.length <= DERBY_JUP_CANDIDATES && hits.length <= 24);
    assert.equal(calls.filter((u) => u.includes("dexscreener")).length, 3);
    assert.ok(ms < 550, `the three pool reads run together, not one after another (${ms} ms)`);
  });
  test("a hung upstream stops at the request's deadline, and the answer still comes back", async () => {
    const { f } = fakeFetch({ n: 5, poolDelayMs: -1 });
    const t0 = Date.now();
    const hits = await searchDerbyCoins("tk", { fetchImpl: f as never, catalogue: CATALOGUE, redstoneIds: new Set(), deadlineAt: Date.now() + 400 });
    const ms = Date.now() - t0;
    assert.ok(ms < 1_200, `bounded by the deadline (${ms} ms)`);
    assert.ok(hits.length > 0, "the hits without a pool are still listed, with why");
  });
});

describe("I-7: normalised queries are cached and misses are rate-limited per client", () => {
  test("the same query in another case or spacing is answered from the cache; concurrent identical searches share one run", async () => {
    const { f, calls } = fakeFetch({ n: 2 });
    const p = { derbyFetch: f } as unknown as Platform;
    const [a, b] = await Promise.all([v1DerbySearch(p, new URLSearchParams({ q: "Tk" })), v1DerbySearch(p, new URLSearchParams({ q: "Tk" }))]);
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    const jupCalls = () => calls.filter((u) => u.startsWith(JUP_SEARCH_URL)).length;
    assert.equal(jupCalls(), 1, "one run for two concurrent requests");
    const c = await v1DerbySearch(p, new URLSearchParams({ q: "  tk " }));
    assert.equal(c.headers?.["x-derby-search"], "cache");
    assert.equal(jupCalls(), 1);
    const later = await v1DerbySearch(p, new URLSearchParams({ q: "tk" }), { now: Date.now() + 10 * 60_000 });
    assert.equal(later.headers?.["x-derby-search"], "fresh", "the cache is brief");
    assert.ok(DERBY_SEARCH_CACHE_MAX > 0);
  });
  test("one client's varied queries are refused after the miss budget; cache hits and other clients are not", async () => {
    const { f } = fakeFetch({ n: 1 });
    const p = { derbyFetch: f } as unknown as Platform;
    const now = Date.now() + 3_600_000;   // a fresh window for the shared limiter
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await v1DerbySearch(p, new URLSearchParams({ q: `abc${i}` }), { client: "203.0.113.9", now })).status);
    assert.deepEqual(codes.slice(0, 10), Array(10).fill(200));
    assert.equal(codes[11], 429);
    assert.equal((await v1DerbySearch(p, new URLSearchParams({ q: "abc0" }), { client: "203.0.113.9", now })).status, 200, "a cached query costs nothing");
    assert.equal((await v1DerbySearch(p, new URLSearchParams({ q: "zzz9" }), { client: "198.51.100.7", now })).status, 200, "another client has its own budget");
  });
});
