// 2026-10-16 prelaunch audit F-21: the launch confirmation (`action: "launched"`, the record of a launch already on chain) shared the
// heavy bucket with the wizard's own reads (team picker, search, back-test, image preview). After 20 of those the confirm answered 429
// and the sign card did not retry it. Now: confirmations have their own `confirm` bucket (30 a minute per client), and the sign card
// asks again after the 429's Retry-After (retry429.ts, a few tries, each wait capped).
import { describe, test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { limiter } from "@/lib/burnticker/api/http";
import { RATE_LIMITS } from "@/lib/burnticker/api/spec";
import { setPlatformForTests, type Platform } from "@/lib/burnticker/server";
import { confirmPlan, type SignPlan } from "@/lib/burnticker/signPlan";

const launched = () => new Request("http://bt.test/api/burnticker/launch", { method: "POST", headers: { origin: "http://bt.test", host: "bt.test", "content-type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify({ action: "launched", mint: "So11111111111111111111111111111111111111112", launchTx: "x".repeat(88) }) });

describe("the launch confirmation's own bucket (F-21)", () => {
  beforeEach(() => { limiter.reset(); setPlatformForTests({ registry: { token: () => null }, mintBank: null } as unknown as Platform); });
  after(() => { limiter.reset(); setPlatformForTests(null); });

  test("twenty wizard reads on the heavy bucket do not refuse the confirmation", async () => {
    for (let i = 0; i < RATE_LIMITS.heavy.burst; i++) assert.equal(limiter.take("203.0.113.9", "heavy").ok, true);
    assert.equal(limiter.take("203.0.113.9", "heavy").ok, false, "the heavy bucket is spent");
    const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
    const r = await POST(launched());
    assert.notEqual(r.status, 429, "the confirmation was refused by the wizard's reads");
    assert.equal(r.status, 404, "it reached the handler (no draft for this mint in the stub)");
  });

  test("the confirm bucket is 30 a minute and is spent by confirmations only", async () => {
    const c = (RATE_LIMITS as Record<string, { burst: number; refillPerSec: number }>).confirm;
    assert.ok(c, "a confirm bucket exists");
    assert.equal(c.burst, 30); assert.equal(Math.round(c.refillPerSec * 60), 30);
    const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
    for (let i = 0; i < 30; i++) assert.equal((await POST(launched())).status, 404);
    const r = await POST(launched());
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get("retry-after")) >= 1);
    assert.equal(limiter.take("203.0.113.9", "heavy").ok, true, "the heavy bucket is untouched");
  });
});

describe("the sign card asks again after a 429 (F-21)", () => {
  const plan = { steps: [{ label: "create" }], keys: {}, expect: {}, labels: {}, confirms: [{ mint: "Mint1111111111111111111111111111111111111111", ticker: "ABC", step: 0 }], venue: "launchlab", pending: [], missingKeys: "" } as unknown as SignPlan;
  const resp = (status: number, retryAfter: string | null = null) => ({ ok: status < 400, status, headers: { get: (n: string) => (n.toLowerCase() === "retry-after" ? retryAfter : null) }, json: async () => (status === 429 ? { error: "rate limited", code: "rate-limited", retryAfterSec: Number(retryAfter) } : { ok: true }) });

  test("a 429 then a 200: confirmed after the Retry-After wait", async () => {
    const { retry429 } = await import("@/lib/burnticker/retry429");
    const answers = [resp(429, "3"), resp(200)];
    const waits: number[] = [];
    const f = retry429(async () => answers.shift()!, { sleep: async (ms) => { waits.push(ms); } });
    const c = await confirmPlan(f, plan, ["sig"], () => "refused");
    assert.deepEqual(c, { confirmed: [plan.confirms[0].mint], error: null });
    assert.deepEqual(waits, [3000]);
  });

  test("the wait is capped and the tries are bounded: a 429 that never ends is said, not retried forever", async () => {
    const { retry429, RETRY429_MAX_WAIT_MS, RETRY429_TRIES } = await import("@/lib/burnticker/retry429");
    let n = 0; const waits: number[] = [];
    const f = retry429(async () => { n++; return resp(429, "3600"); }, { sleep: async (ms) => { waits.push(ms); } });
    const c = await confirmPlan(f, plan, ["sig"], (st) => `refused ${st}`);
    assert.equal(c.error, "refused 429");
    assert.equal(n, RETRY429_TRIES + 1);
    assert.ok(waits.every((w) => w <= RETRY429_MAX_WAIT_MS));
  });

  test("the sign card sends its confirmations through retry429", () => {
    const src = fs.readFileSync("src/app/burnticker/launch/SignCard.tsx", "utf8");
    assert.match(src, /import \{ retry429 \} from ["']@\/lib\/burnticker\/retry429["'];/);
    assert.ok(src.includes("const confirmFetch = retry429("));
    assert.equal((src.match(/confirmPlan\(confirmFetch,/g) ?? []).length, 2, "both confirmPlan calls use the retrying fetch");
  });
});
