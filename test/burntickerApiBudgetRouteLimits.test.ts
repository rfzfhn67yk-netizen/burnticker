// AUDIT 2026-10-18 A-38 / A-42: burn-target, pairs/[pairId], pin-check and the image routes had no per-client limiter, and the league
// OpenGraph image ran sharp on every request. Each now answers 429 past the heavy sizes (on limiters of their own, so the wizard's
// back-tests keep their bucket), and the league image is rendered once per league and season.
import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { imageLimiter, limiter, pageLimiter, pinCheckLimiter } from "@/lib/burnticker/api/http";
import { RATE_LIMITS } from "@/lib/burnticker/api/spec";

const from = (ip: string, url = "http://bt.test/x") => new Request(url, { headers: { "x-forwarded-for": ip } });
const statuses = async (n: number, f: () => Promise<Response>) => { const out: number[] = []; for (let i = 0; i < n; i++) out.push((await f()).status); return out; };

describe("A-38: the heavy per-client limiter on the site's own chain, pin and image routes", () => {
  before(async () => { const { makeWorld } = await import("./burntickerApiHelpers.ts"); await makeWorld(); });
  beforeEach(() => { limiter.reset(); pageLimiter.reset(); imageLimiter.reset(); pinCheckLimiter.reset(); });

  test("pin-check: its own limiter at the read sizes (120), then 429; pairs and the league image do not share it with Retry-After and a sentence", async () => {
    const mod = await import("../src/app/api/burnticker/pin-check/route.ts");
    for (let i = 0; i < 30; i++) pageLimiter.take("203.0.113.40", "heavy");   // a pair page and the league image spent the heavy sizes
    const s = await statuses(RATE_LIMITS.read.burst + 1, () => mod.GET(from("203.0.113.40", "http://bt.test/api/burnticker/pin-check?mint=nope")));
    assert.deepEqual(s.slice(0, -1), Array(RATE_LIMITS.read.burst).fill(400));
    assert.equal(s.at(-1), 429);
    const r = await mod.GET(from("203.0.113.40", "http://bt.test/api/burnticker/pin-check?mint=nope"));
    assert.ok(Number(r.headers.get("retry-after")) > 0);
    const j = await r.json() as { ok: null; detail: string };
    assert.equal(j.ok, null); assert.match(j.detail, /^Too many requests from this address\. Please try again in \d+ seconds\.$/);
    assert.equal(limiter.take("203.0.113.40", "heavy").remaining, RATE_LIMITS.heavy.burst - 1, "the wizard's heavy bucket is untouched");
  });

  test("burn-target: limited on the heavy bucket before any RPC read", async () => {
    const mod = await import("../src/app/api/burnticker/burn-target/route.ts");
    for (let i = 0; i < RATE_LIMITS.heavy.burst; i++) limiter.take("203.0.113.41", "heavy");
    const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", pool = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2";
    const r = await mod.GET(from("203.0.113.41", `http://bt.test/api/burnticker/burn-target?mint=${mint}&pool=${pool}&symbol=WSOL&feed=${"ab".repeat(32)}`));
    assert.equal(r.status, 429);
  });

  test("pairs/[pairId]: the heavy burst, then 429", async () => {
    const mod = await import("../src/app/api/burnticker/pairs/[pairId]/route.ts");
    const s = await statuses(RATE_LIMITS.heavy.burst + 1, () => mod.GET(from("203.0.113.42"), { params: Promise.resolve({ pairId: "no-such-pair" }) }));
    assert.equal(s.filter((x) => x === 404).length, RATE_LIMITS.heavy.burst);
    assert.equal(s.at(-1), 429);
  });

  test("img/preview: limited per client; a coin's own image is not", async () => {
    const mod = await import("../src/app/burnticker/img/[file]/route.ts");
    const s = await statuses(61, () => mod.GET(from("203.0.113.43", "http://bt.test/burnticker/img/preview.svg?r=bm90LWpzb24&t=X&l=hello"), { params: Promise.resolve({ file: "preview.svg" }) }));
    assert.equal(s.filter((x) => x === 400).length, 60);
    assert.equal(s.at(-1), 429);
    const own = await statuses(70, () => mod.GET(from("203.0.113.43"), { params: Promise.resolve({ file: "NOSUCHCOIN.svg" }) }));
    assert.ok(own.every((x) => x === 404));
  });

  test("the league OpenGraph image is rendered once and served from memory; a miss past the burst is 429", async () => {
    const mod = await import("../src/app/burnticker/leagues/[league]/[season]/og/route.ts");
    const params = { params: Promise.resolve({ league: "nhl", season: "2026-27" }) };
    const first = await mod.GET(from("203.0.113.44"), params);
    assert.equal(first.status, 200);
    for (let i = 0; i < 30; i++) pageLimiter.take("203.0.113.44", "heavy");
    const again = await mod.GET(from("203.0.113.44"), { params: Promise.resolve({ league: "nhl", season: "2026-27" }) });
    assert.equal(again.status, 200, "a cached image costs nothing");
    assert.deepEqual(new Uint8Array(await again.arrayBuffer()), new Uint8Array(await first.arrayBuffer()));
    const miss = await mod.GET(from("203.0.113.44"), { params: Promise.resolve({ league: "nba", season: "2026-27" }) });
    assert.equal(miss.status, 429);
  });
});
