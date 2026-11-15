// AUDIT 7 · F06 (2026-10-19): the trust memo had no maximum age and no rebuild timeout, so a hung rebuild kept serving the old payload as
// a cache hit indefinitely. Now it has the coin page's bounds (10-18 F02): past TRUST_MAX_STALE_MS the last verified copy is served as
// degraded (freshness.stale, no-store), a rebuild in flight past SWR_BUILD_TIMEOUT_MS is replaced, and a late result never wins.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeTrustSwr, serveTrust, TRUST_CACHE_CONTROL, TRUST_FRESH_MS, TRUST_MAX_STALE_MS, trustFreshness } from "@/lib/burnticker/trustServe";
import { SWR_BUILD_TIMEOUT_MS } from "@/lib/burnticker/keyedSwr";
import { COIN_MAX_STALE_MS, trustStaleLine } from "@/lib/burnticker/coinFreshness";
import { lintCopy } from "@/lib/launch/copyLint";

type Body = { v: unknown; freshness?: { stale: boolean; ageMs: number; lastVerifiedAt: string; note: string | null } };
const deferred = <T,>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const p = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

function world() {
  let now = 1_000_000;
  const clock = () => now;
  const swr = makeTrustSwr({ clock, coldWaitMs: 20 });
  let builds = 0;
  let next: () => Promise<unknown> = async () => ({ v: 1 });
  const serve = () => serveTrust(swr, "page", () => { builds++; return next(); }, clock);
  return { swr, serve, advance: (ms: number) => { now += ms; }, at: () => now, set: (b: () => Promise<unknown>) => { next = b; }, builds: () => builds };
}

describe("F06 · the trust memo is bounded", () => {
  test("the bounds are the coin page's: 15 minutes of staleness, a 2-minute rebuild timeout", () => {
    assert.equal(TRUST_MAX_STALE_MS, COIN_MAX_STALE_MS);
    assert.equal(SWR_BUILD_TIMEOUT_MS, 120_000);
    assert.ok(TRUST_FRESH_MS < TRUST_MAX_STALE_MS);
  });

  test("hung provider: a hit until the bound, then the last verified copy marked degraded and kept off the edge; a timed-out rebuild is replaced, recovery serves fresh, a late result never wins", async () => {
    const w = world();
    const first = await w.serve();
    assert.equal(first.status, 200);
    assert.equal(first.headers["x-trust-memo"], "cold"); assert.equal(first.headers["cache-control"], TRUST_CACHE_CONTROL);
    assert.equal((first.body as Body).v, 1); assert.equal((first.body as Body).freshness!.stale, false);
    const verifiedAt = w.at();

    const hung = deferred<unknown>();
    w.set(() => hung.p);
    w.advance(TRUST_MAX_STALE_MS - 30_000);
    const soft = await w.serve();
    assert.equal(soft.headers["x-trust-memo"], "hit", "inside the bound the old copy is still a hit");
    assert.equal(w.builds(), 2, "a background rebuild started");

    w.advance(60_000);   // past the bound; the hung rebuild has been in flight 60 s, inside the 2-minute timeout
    const degraded = await w.serve();
    assert.equal(degraded.status, 200);
    assert.equal(degraded.headers["x-trust-memo"], "stale", "past the bound it is not a hit");
    assert.equal(degraded.headers["cache-control"], "no-store", "a degraded copy is not kept at the edge");
    const f = (degraded.body as Body).freshness!;
    assert.equal(f.stale, true); assert.equal(f.lastVerifiedAt, new Date(verifiedAt).toISOString());
    assert.equal(f.note, trustStaleLine(f.ageMs)); assert.match(f.note!, /^Read \d+ minutes ago; a fresh read has not succeeded since\./);
    assert.equal((degraded.body as Body).v, 1, "the last verified payload, not an empty one");
    assert.equal(w.builds(), 2, "the hung rebuild is still in flight (inside the rebuild timeout): no second one");

    // past the rebuild timeout the hung one counts as failed: the next read starts another, which recovers
    w.advance(SWR_BUILD_TIMEOUT_MS);
    w.set(async () => ({ v: 2 }));
    const recovered = await w.serve();
    assert.equal(w.builds(), 3, "a new rebuild replaced the hung one");
    assert.equal((recovered.body as Body).v, 2);
    assert.equal(recovered.headers["x-trust-memo"], "hit"); assert.equal(recovered.headers["cache-control"], TRUST_CACHE_CONTROL);
    assert.equal((recovered.body as Body).freshness!.stale, false);

    // the abandoned rebuild lands late: it never replaces the newer answer
    hung.resolve({ v: "late" });
    await tick(); await tick();
    const after = await w.serve();
    assert.equal((after.body as Body).v, 2, "a late result never replaces a newer one");
  });

  test("failed provider: the old copy is served as a hit inside the bound, degraded past it, and fresh again after recovery", async () => {
    const w = world();
    await w.serve();
    w.set(async () => { throw new Error("RPC 503"); });
    w.advance(TRUST_FRESH_MS + 1);
    assert.equal((await w.serve()).headers["x-trust-memo"], "hit");
    w.advance(TRUST_MAX_STALE_MS);
    const degraded = await w.serve();
    assert.equal(degraded.headers["x-trust-memo"], "stale"); assert.equal(degraded.headers["cache-control"], "no-store");
    assert.equal((degraded.body as Body).freshness!.stale, true);
    w.set(async () => ({ v: 3 }));
    const back = await w.serve();
    assert.equal((back.body as Body).v, 3); assert.equal((back.body as Body).freshness!.stale, false); assert.equal(back.headers["cache-control"], TRUST_CACHE_CONTROL);
  });

  test("a first read that fails, or does not land within the cold wait, is a 503 with retry-after (never a thrown 500, never cached)", async () => {
    const w = world();
    w.set(async () => { throw new Error("RPC down"); });
    const failed = await w.serve();
    assert.equal(failed.status, 503); assert.equal((failed.body as { code: string }).code, "trust-unavailable"); assert.equal(failed.headers["cache-control"], "no-store");
    const w2 = world();
    w2.set(() => new Promise(() => {}));
    const slow = await w2.serve();
    assert.equal(slow.status, 503); assert.equal((slow.body as { code: string }).code, "trust-loading"); assert.equal(slow.headers["retry-after"], "5");
  });

  test("trustFreshness: age at or past the bound is stale whatever the memo state", () => {
    assert.equal(trustFreshness({ state: "hit", ageMs: TRUST_MAX_STALE_MS }, 10 * TRUST_MAX_STALE_MS).stale, true);
    assert.equal(trustFreshness({ state: "hit", ageMs: TRUST_MAX_STALE_MS - 1 }, 10 * TRUST_MAX_STALE_MS).stale, false);
    assert.equal(trustFreshness({ state: "stale", ageMs: 5 }, 100).state, "stale");
  });

  test("the trust page shows the degraded line and its words pass the copy lint", () => {
    const page = fs.readFileSync("src/app/burnticker/trust/page.tsx", "utf8");
    assert.match(page, /data-trust-stale/); assert.match(page, /trustStaleLine\(t\.freshness\.ageMs\)/);
    const r = lintCopy(`${trustStaleLine(21 * 3_600_000)} Last verified at`);
    assert.equal(r.ok, true, JSON.stringify(r));
  });
});
