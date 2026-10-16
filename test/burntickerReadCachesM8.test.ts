// 2026-10-15 prelaunch audit M7 (the memo window, the warm rebuild, invalidation) and M8 (bounded caches and limiter maps).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { LruMap } from "@/lib/burnticker/lru";
import { RateLimiter } from "@/lib/burnticker/api/http";
import { RATE_LIMITS } from "@/lib/burnticker/api/spec";
import { chainRows, memoWindowMs, webReadPlatform } from "@/lib/burnticker/webReadCache";
import { tokenPageData } from "@/lib/burnticker/server";
import { makeWorld } from "./burntickerApiHelpers.ts";
import { NOW } from "./burntickerHelpers.ts";

describe("the coin list's memo and read cache (M7)", () => {
  test("the memo window is 15 s under 50 coins read from the chain, then grows with them, at most two minutes", () => {
    assert.equal(memoWindowMs(6), 15_000);
    assert.equal(memoWindowMs(49), 15_000);
    assert.equal(memoWindowMs(100), 30_000);
    assert.equal(memoWindowMs(10_000), 120_000);
    assert.deepEqual(chainRows([{ status: "live" }, { status: "draft" }, { status: "expired" }, { status: "paused" }]).map((t) => t.status), ["live", "paused"]);
  });

  test("a warm rebuild reads nothing the cache holds; a send the keeper records drops that coin", async () => {
    const w = await makeWorld();
    let reads = 0;
    const prog = w.program as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const m of ["supplyRaw", "feePdaBalanceLamports"]) { const f = prog[m].bind(w.program); prog[m] = (...a: unknown[]) => { reads++; return f(...a); }; }
    const tokens = w.registry.tokens();
    const build = async () => { const v = await webReadPlatform(w.p, tokens, { now: () => NOW }); for (const t of tokens) await tokenPageData(v, t, NOW); };
    await build();
    const cold = reads;
    assert.ok(cold > 0);
    reads = 0;
    await build();
    assert.equal(reads, 0, "inside the TTLs nothing is re-read");
    // the keeper writes a send for one coin to the shared registry: that coin is read fresh on the next rebuild
    w.registry.db.prepare("INSERT INTO signatures (signature, mint, event_id, memo, burn_raw, spend_lamports, blockhash, last_valid_block_height, sent_at, status) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("sigM7", w.bronco.mint, "e1", "m", "0", "0", "bh", 1, NOW, "sent");
    await build();
    assert.ok(reads > 0 && reads < cold, `only the changed coin is re-read (${reads} of ${cold})`);
  });
});

describe("the read cache's invalidation (M7 re-review)", () => {
  test("a coin's FIRST signatures row drops it (a browser-launched coin's first reading or crank)", async () => {
    const { KeeperReadCache } = await import("@/lib/burnticker/keeperReadCache");
    const c = new KeeperReadCache({ now: () => NOW });
    c.afterCycle(null, new Map());   // primed: no coin has a send yet
    c.set("NewMint", "supply", BigInt(5));
    assert.deepEqual(c.afterCycle(null, new Map([["NewMint", "1:0:1760000000000"]])), ["NewMint"]);
    assert.equal(c.peek("NewMint", "supply"), undefined);
  });
  test("a change of the LaunchLab pool's status in the batch (graduation, migration: no signatures row) drops the coin", async () => {
    const { KeeperReadCache } = await import("@/lib/burnticker/keeperReadCache");
    const { fx } = await import("./burntickerHelpers.ts");
    const FX = fx("launchlab/pools.mainnet.json") as { accounts: Record<string, { owner: string; dataBase64: string }> };
    const data = Buffer.from(Object.values(FX.accounts)[0].dataBase64, "base64");
    const { decodeLaunchLabPool } = await import("@/lib/burnticker/market");
    const s0 = decodeLaunchLabPool(data)!.status;
    let t = NOW, status = s0;
    assert.equal(data[17], s0);
    const c = new KeeperReadCache({ now: () => t });
    const owner = { equals: () => true } as never;
    const STATUS_BYTE = 17;   // market.ts OFF.status
    const batch = { readMany: async (items: readonly { mint: string }[]) => { const copy = Buffer.from(data); copy[STATUS_BYTE] = status; return new Map(items.map((i) => [i.mint, { feePdaLamports: BigInt(1), supplyRaw: BigInt(10), pool: { data: copy, owner } }])); } };
    const items = [{ mint: "M", vault: false, poolId: "P" }];
    await c.prefetch(batch, items);
    c.set("M", "lp", { s: {}, accrued: true });
    t += 61_000;   // the fee pool's TTL: the batch runs again
    await c.prefetch(batch, items);
    assert.ok(c.peek("M", "lp") !== undefined, "same status: kept");
    status = s0 === 0 ? 1 : 0;
    t += 61_000;
    await c.prefetch(batch, items);
    assert.equal(c.peek("M", "lp"), undefined, "the status moved: dropped");
    assert.equal(c.peek<bigint>("M", "supply"), BigInt(10), "and refilled from the batch itself");
  });
});

describe("bounded maps (M8)", () => {
  test("LruMap keeps at most its bound, dropping the least recently used", () => {
    const m = new LruMap<string, number>(3);
    m.set("a", 1); m.set("b", 2); m.set("c", 3);
    m.get("a");
    m.set("d", 4);
    assert.deepEqual([...m.keys()], ["c", "a", "d"]);
  });
  test("the rate limiter's map stays bounded under a flood of distinct clients that all spent tokens", () => {
    const rl = new RateLimiter(RATE_LIMITS, 1_000);
    for (let i = 0; i < 20_000; i++) rl.take(`10.0.${i >> 8}.${i & 255}-${i}`, "write", 1_000);
    assert.ok(rl.size <= 1_000, `size ${rl.size}`);
  });
  test("the sports, Polymarket and Kalshi response caches are bounded", async () => {
    const { EspnClient } = await import("@/lib/burnticker/sources/espn");
    const c = new EspnClient({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }), minIntervalMs: 0, tsdbKey: null, maxCached: 10 } as never);
    for (let i = 0; i < 50; i++) await c.get(`https://statsapi.mlb.com/api/v1/schedule?i=${i}`);
    assert.ok((c as unknown as { cache: Map<string, unknown> }).cache.size <= 10);
    const { PolymarketClient } = await import("@/lib/burnticker/oracle/polymarket");
    const { KalshiClient } = await import("@/lib/burnticker/oracle/kalshi");
    assert.ok((new PolymarketClient() as unknown as { cache: unknown }).cache instanceof LruMap);
    assert.ok((new KalshiClient() as unknown as { cache: unknown }).cache instanceof LruMap);
  });
});
