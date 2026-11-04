// Ninth pre-launch audit (2026-10-21) OPS OP9-1, HB-211 / HS-98: in the publish-111 deploy window a visitor's GET /api/burnticker/v1/trust
// waited 20 s on the first build and got the proxy's 503 page. The read now waits at most 12 s, then serves the last good copy marked
// stale (kept in the registry, so a copy from before a restart answers too); only with no copy at all is it a short 503. The start-up warm
// call builds it before any visitor.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { makeV1TrustSwr, serveV1Trust, trustLastGoodStore, V1_TRUST_DEADLINE_MS, V1_TRUST_LAST_GOOD_KEY } from "@/lib/burnticker/trustServe";

const fakeRegistry = () => { const m = new Map<string, string>(); return { m, getStatus: (k: string) => m.get(k) ?? null, setStatus: (k: string, v: unknown) => { m.set(k, typeof v === "string" ? v : JSON.stringify(v)); } }; };
const never = () => new Promise<unknown>(() => { /* a build still running */ });

describe("HB-211: /v1/trust answers inside the proxy's 20 s", () => {
  test("the deadline is 12 s, under the proxy's 20 s limit", () => {
    assert.equal(V1_TRUST_DEADLINE_MS, 12_000);
    assert.ok(V1_TRUST_DEADLINE_MS < 20_000);
  });

  test("a first build still running past the deadline with no copy anywhere: null (the route's short 503), never a wait past it", async () => {
    const t0 = Date.now();
    const r = await serveV1Trust(makeV1TrustSwr({ coldWaitMs: 50 }), never, trustLastGoodStore(fakeRegistry()));
    assert.equal(r, null);
    assert.ok(Date.now() - t0 < 1_000);
  });

  test("a good build is kept in the registry; after a restart, a build still running serves that copy marked stale", async () => {
    const reg = fakeRegistry();
    const first = await serveV1Trust(makeV1TrustSwr({ coldWaitMs: 1_000 }), async () => ({ generatedAt: "then", powers: [] }), trustLastGoodStore(reg));
    assert.ok(first);
    assert.deepEqual(first.value, { generatedAt: "then", powers: [] });
    assert.ok(reg.m.get(V1_TRUST_LAST_GOOD_KEY), "the last good copy is written to the registry");
    // a new process: a fresh memo and a fresh store over the same registry; the first build is slow
    const r = await serveV1Trust(makeV1TrustSwr({ coldWaitMs: 50 }), never, trustLastGoodStore(reg));
    assert.ok(r, "the last good copy is served instead of a 503");
    assert.deepEqual(r.value, { generatedAt: "then", powers: [] });
    assert.equal(r.state, "last-good");
    assert.equal(r.headers["x-trust-memo"], "stale");
    assert.equal(r.headers["cache-control"], "no-store");
    assert.ok(Number(r.headers["x-trust-age-sec"]) >= 0);
  });

  test("a first build that fails is treated like one still running: the last good copy, else null; never thrown", async () => {
    const reg = fakeRegistry();
    const boom = async () => { throw new Error("rpc down"); };
    assert.equal(await serveV1Trust(makeV1TrustSwr({ coldWaitMs: 200 }), boom, trustLastGoodStore(reg)), null);
    trustLastGoodStore(reg).save({ at: Date.now() - 90_000, value: { generatedAt: "earlier" } });
    const r = await serveV1Trust(makeV1TrustSwr({ coldWaitMs: 200 }), boom, trustLastGoodStore(reg));
    assert.deepEqual(r?.value, { generatedAt: "earlier" });
    assert.equal(r?.headers["x-trust-memo"], "stale");
    assert.ok(Number(r?.headers["x-trust-age-sec"]) >= 89);
  });

  test("an unreadable registry copy is no copy; a registry that cannot be written keeps the memory copy", async () => {
    const bad = { getStatus: () => "{not json", setStatus: () => { throw new Error("read-only"); } };
    const s = trustLastGoodStore(bad);
    assert.equal(s.load(), null);
    s.save({ at: 1, value: { a: 1 } });
    assert.deepEqual(s.load(), { at: 1, value: { a: 1 } });
  });

  test("the route answers a short 503 with retry-after when there is no copy, and the web warms /v1/trust at start", () => {
    const v1 = readFileSync(new URL("../src/lib/burnticker/api/v1.ts", import.meta.url), "utf8");
    assert.match(v1, /if \(!served\) return withHeaders\(fail\(503, "The trust details are being read\. Please try again in a few seconds\.", \{ code: "trust-loading", retryAfterSec: 5 \}\), \{ "retry-after": "5", "cache-control": "no-store" \}\);/);
    const warm = createRequire(import.meta.url)("../scripts/service/web-warm.cjs") as { WARM_PATHS: string[] };
    assert.ok(warm.WARM_PATHS.includes("/api/burnticker/v1/trust"));
  });
});
