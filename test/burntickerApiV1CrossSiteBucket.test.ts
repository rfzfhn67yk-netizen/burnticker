// AUDIT 2026-10-18 A-39: runV1 took the rate token before it checked same-origin, so any website a creator visited could spend that
// visitor's shared write bucket with cross-site POSTs, and the real launch then answered 429. The cross-site, content-type and size
// refusals now come first and spend nothing.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { limiter, runV1, ok } from "@/lib/burnticker/api/http";

const CLIENT = "198.51.100.23";
const post = (headers: Record<string, string>) => new Request("https://example.test/api/burnticker/v1/launch/bundle", { method: "POST", headers: { host: "example.test", "x-forwarded-for": CLIENT, ...headers }, body: "{}" });

describe("A-39: refusals before the limiter in runV1", () => {
  beforeEach(() => limiter.reset());
  after(() => limiter.reset());

  test("cross-site, wrong content type and oversize POSTs spend nothing from the write bucket", async () => {
    let ran = 0;
    const handler = async () => { ran++; return ok({}); };
    for (let i = 0; i < 25; i++) {
      const r = await runV1("buildLaunchBundle", post({ "sec-fetch-site": "cross-site", "content-type": "application/json" }), handler);
      assert.equal(r.status, 403);
      assert.equal(r.headers.get("ratelimit-remaining"), null, "a refused cross-site request carries no bucket reading");
    }
    for (let i = 0; i < 5; i++) assert.equal((await runV1("buildLaunchBundle", post({ origin: "https://evil.example", "content-type": "application/json" }), handler)).status, 403);
    for (let i = 0; i < 5; i++) assert.equal((await runV1("buildLaunchBundle", post({ "sec-fetch-site": "same-origin", "content-type": "text/plain" }), handler)).status, 415);
    for (let i = 0; i < 5; i++) assert.equal((await runV1("buildLaunchBundle", post({ "sec-fetch-site": "same-origin", "content-type": "application/json", "content-length": "99999999" }), handler)).status, 413);
    assert.equal(ran, 0);
    // the visitor's own launch still has its whole bucket
    const own = await runV1("buildLaunchBundle", post({ "sec-fetch-site": "same-origin", "content-type": "application/json" }), handler);
    assert.equal(own.status, 200);
    assert.equal(Number(own.headers.get("ratelimit-remaining")), Number(own.headers.get("ratelimit-limit")) - 1);
    assert.equal(ran, 1);
  });

  test("the confirm bucket is spared the same way", async () => {
    for (let i = 0; i < 40; i++) assert.equal((await runV1("confirmLaunch", post({ "sec-fetch-site": "cross-site", "content-type": "application/json" }), async () => ok({}))).status, 403);
    assert.equal((await runV1("confirmLaunch", post({ "sec-fetch-site": "same-origin", "content-type": "application/json" }), async () => ok({}))).status, 200);
  });
});
