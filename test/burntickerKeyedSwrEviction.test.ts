// 2026-10-22 EXTERNAL AUDIT BT-SWR-EVICTION-RACE-01 (publish 121): keyedSwr.ts could bring an abandoned older build's answer back as an
// age-zero hit. An older build in flight (dropped past buildTimeoutMs) landed AFTER a newer answer for its key AND after maxKeys evicted
// that key; eviction had removed the key's write bookkeeping, so the old landing saw no newer write and inserted. Reproduced at 128 and
// 256 keys. These pin both orders of the two landings, eviction and reinsertion between them, a failed old build, and the controls.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { KeyedSwr } from "@/lib/burnticker/keyedSwr";

const deferred = <T,>() => { let ok!: (v: T) => void, no!: (e: unknown) => void; const p = new Promise<T>((a, b) => { ok = a; no = b; }); return { p, ok, no }; };
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((ok) => setImmediate(ok)); };
const FRESH = 15_000, TIMEOUT = 120_000;

/** A memo with the old answer for K, an abandoned stuck build A, and a newer build B in flight (B's own read returned). */
async function scene(cap: number) {
  let t = 1_000_000;
  const m = new KeyedSwr<string>({ freshMs: FRESH, coldWaitMs: 5, maxKeys: cap, buildTimeoutMs: TIMEOUT }, () => t);
  await m.get("K", "1", async () => "first");
  t += FRESH + 1;
  const A = deferred<string>(), B = deferred<string>();
  await m.get("K", "1", () => A.p);                       // stale-while-revalidate: build A starts
  t += TIMEOUT;                                            // A is abandoned
  await m.get("K", "1", () => B.p);                       // build B starts
  const evict = async () => { for (let i = 0; i < cap; i++) await m.get(`other-${i}`, "1", async () => `o${i}`); assert.equal(m.peek("K", "1", Infinity), undefined, "K was evicted"); };
  const read = async (fallback = "rebuilt") => m.get("K", "1", async () => fallback);
  return { m, A, B, evict, read, tick: (ms: number) => { t += ms; } };
}

for (const cap of [128, 256]) {
  describe(`keyedSwr: an abandoned build never comes back as a fresh hit (maxKeys ${cap})`, () => {
    test("new lands, key evicted, old lands: the old answer is not inserted; the next read builds afresh", async () => {
      const s = await scene(cap);
      s.B.ok("new"); await settle();
      await s.evict();
      s.A.ok("ABANDONED"); await settle();
      assert.equal(s.m.peek("K", "1", Infinity), undefined, "the abandoned answer did not land in the evicted slot");
      const r = await s.read();
      assert.notEqual(r!.value, "ABANDONED");
      assert.equal(r!.state, "cold"); assert.equal(r!.value, "rebuilt");
    });

    test("old lands first, then new, with eviction between: the old answer is never served, the new one is", async () => {
      const s = await scene(cap);
      s.A.ok("ABANDONED"); await settle();
      assert.equal(s.m.peek("K", "1", Infinity), "first", "the abandoned build wrote nothing");
      await s.evict();
      s.B.ok("new"); await settle();
      const r = await s.read();
      assert.equal(r!.value, "new"); assert.equal(r!.state, "hit");
    });

    test("new lands, evicted, reinserted by a newer build, then old lands: the reinserted answer stays", async () => {
      const s = await scene(cap);
      s.B.ok("new"); await settle();
      await s.evict();
      const c = await s.read("reinserted");
      assert.equal(c!.value, "reinserted");
      s.A.ok("ABANDONED"); await settle();
      const r = await s.read("unused");
      assert.equal(r!.value, "reinserted"); assert.equal(r!.state, "hit");
    });

    test("new lands, evicted, reinserted by put, then old lands: the put answer stays", async () => {
      const s = await scene(cap);
      s.B.ok("new"); await settle();
      await s.evict();
      s.m.put("K", "1", "put");
      s.A.ok("ABANDONED"); await settle();
      assert.equal((await s.read("unused"))!.value, "put");
    });

    test("the old build fails (rejects) after its timeout: nothing changes and the new build's answer is served", async () => {
      const s = await scene(cap);
      s.A.no(new Error("rpc timeout")); await settle();
      await s.evict();
      s.B.ok("new"); await settle();
      const r = await s.read();
      assert.equal(r!.value, "new"); assert.equal(r!.state, "hit");
    });

    test("old lands after eviction with the new build still in flight: not inserted; the new build's answer is", async () => {
      const s = await scene(cap);
      await s.evict();
      s.A.ok("ABANDONED"); await settle();
      assert.equal(s.m.peek("K", "1", Infinity), undefined);
      s.B.ok("new"); await settle();
      assert.equal((await s.read("unused"))!.value, "new");
    });

    test("a build still owning its key, outrun by a put and an eviction, does not write its older answer back", async () => {
      let t = 0;
      const m = new KeyedSwr<string>({ freshMs: FRESH, coldWaitMs: 5, maxKeys: cap }, () => t);
      const A = deferred<string>();
      await m.get("K", "1", () => A.p);                   // cold: A in flight
      m.put("K", "1", "put");
      for (let i = 0; i < cap; i++) m.put(`other-${i}`, "1", `o${i}`);
      assert.equal(m.peek("K", "1", Infinity), undefined);
      A.ok("OLDER"); await settle();
      assert.equal(m.peek("K", "1", Infinity), undefined, "the older build did not write into the evicted slot");
    });
  });
}

describe("keyedSwr controls without eviction (unchanged behaviour)", () => {
  test("new lands then old lands: the new answer stays", async () => {
    const s = await scene(256);
    s.B.ok("new"); await settle();
    s.A.ok("ABANDONED"); await settle();
    assert.equal((await s.read("unused"))!.value, "new");
  });
  test("old lands then new lands: the new answer is served", async () => {
    const s = await scene(256);
    s.A.ok("ABANDONED"); await settle();
    s.B.ok("new"); await settle();
    assert.equal((await s.read("unused"))!.value, "new");
  });
  test("an ordinary refresh (no timeout, no eviction) still writes and is served as a hit", async () => {
    let t = 0;
    const m = new KeyedSwr<string>({ freshMs: FRESH, coldWaitMs: 5, maxKeys: 4, buildTimeoutMs: TIMEOUT }, () => t);
    assert.equal((await m.get("K", "1", async () => "a"))!.state, "cold");
    t += FRESH + 1;
    const r = await m.get("K", "1", async () => "b");
    assert.equal(r!.value, "a"); await settle();
    const n = await m.get("K", "1", async () => "c");
    assert.equal(n!.value, "b"); assert.equal(n!.state, "hit");
  });
  test("a newer version queued behind an older build still gets both answers in order (both cold waits)", async () => {
    let t = 0;
    const m = new KeyedSwr<string>({ freshMs: FRESH, coldWaitMs: 50, maxKeys: 4, buildTimeoutMs: TIMEOUT }, () => t);
    const v1 = deferred<string>(), v2 = deferred<string>();
    const p1 = m.get("K", "1", () => v1.p);
    const p2 = m.get("K", "2", () => v2.p);
    v1.ok("v1");
    assert.equal((await p1)!.value, "v1");
    v2.ok("v2");
    const r2 = await p2;
    assert.equal(r2!.value, "v2"); assert.equal(r2!.state, "cold", "nothing was kept when the second read began");
  });
  test("the bookkeeping stays bounded: written entries never exceed maxKeys once every build has settled", async () => {
    let t = 0;
    const m = new KeyedSwr<string>({ freshMs: FRESH, coldWaitMs: 5, maxKeys: 8, buildTimeoutMs: TIMEOUT }, () => t);
    for (let i = 0; i < 100; i++) await m.get(`k${i}`, "1", async () => `v${i}`);
    await settle();
    assert.equal(m.size(), 8);
    assert.ok((m as unknown as { written: Map<string, number> }).written.size <= 8);
    assert.equal((m as unknown as { pending: Map<string, number> }).pending.size, 0);
  });
});
