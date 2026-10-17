// 2026-10-16 prelaunch audit F-10: the wizard's back-test waited on the venue's history read with no bound of its own, so a slow
// TheSportsDB (or Kalshi) held the review step for 20 s until Caddy cut it. Now the route waits at most BACKTEST_WAIT.ms (5 s) and then
// answers 503 with a plain sentence and Retry-After; the read goes on in the background (the clients' caches keep its answer), and the
// page asks again on its own (transientRead: 503 is retried after 2, 4, 8 s).
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { setPlatformForTests, type Platform } from "@/lib/burnticker/server";
import { limiter } from "@/lib/burnticker/api/http";
import { BRONCOS } from "./burntickerHelpers.ts";

const req = () => new Request("http://bt.test/api/burnticker/oracle/backtest", { method: "POST", headers: { origin: "http://bt.test", host: "bt.test", "content-type": "application/json" }, body: JSON.stringify({ rule: BRONCOS }) });

describe("the back-test's bounded wait (F-10)", () => {
  after(() => { setPlatformForTests(null); limiter.reset(); });

  test("a history read that hangs: the route answers within the bound, 503, the plain sentence and Retry-After", async () => {
    const mod = await import("@/lib/burnticker/api/backtestWait").catch(() => null);
    assert.ok(mod, "backtestWait.ts holds the bound and the sentence");
    mod!.BACKTEST_WAIT.ms = 150;
    let reads = 0;
    setPlatformForTests({ kalshiEnabled: true, kalshi: { settledSince: () => { reads++; return new Promise(() => { /* never */ }); } } } as unknown as Platform);
    const { POST } = await import("../src/app/api/burnticker/oracle/backtest/route.ts");
    const t0 = Date.now();
    const r = await Promise.race([POST(req()), new Promise<"hung">((res) => setTimeout(() => res("hung"), 3_000))]);
    assert.notEqual(r, "hung", "the route waited on the read");
    if (r === "hung") return;
    assert.ok(Date.now() - t0 < 1_500);
    assert.equal(r.status, 503);
    assert.equal(r.headers.get("retry-after"), "5");
    const b = (await r.json()) as { error: string; code: string };
    assert.equal(b.error, mod!.BACKTEST_SLOW);
    assert.equal(b.code, "backtest-slow");
    assert.equal(reads, 1);
  });

  test("a read that answers inside the bound is served as before", async () => {
    const mod = await import("@/lib/burnticker/api/backtestWait");
    mod.BACKTEST_WAIT.ms = 2_000;
    setPlatformForTests({ kalshiEnabled: true, kalshi: { settledSince: async () => ({ events: [], markets: [], pages: 1, truncated: false }), seriesInfo: async () => null } } as unknown as Platform);
    const { POST } = await import("../src/app/api/burnticker/oracle/backtest/route.ts");
    const r = await POST(req());
    assert.notEqual(r.status, 503);
  });

  test("the sentence is plain, and the review step shows it in place of the generic line", async () => {
    const { BACKTEST_SLOW } = await import("@/lib/burnticker/api/backtestWait");
    assert.equal(BACKTEST_SLOW, "Could not estimate past burns right now.");
    const page = fs.readFileSync("src/app/burnticker/launch/page.tsx", "utf8");
    assert.match(page, /BACKTEST_SLOW/);
  });
});
