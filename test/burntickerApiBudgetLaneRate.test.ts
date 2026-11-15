// AUDIT 2026-10-18 A-38: the confirm and flight lanes reserved tokens from the web's shared per-second Helius bucket, and ordinary readers
// reserve even when that drives the bucket negative, so a read flood made every confirmation and wallet send wait about 19 s and then
// fail as "busy". The two lanes now own a slice of the rate and never wait on the shared bucket. Simulated clock throughout.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ApiBudget, BudgetHoldError, configureApiBudget, memoryStore, resetApiBudget, takeRpc, budgetFor, specOf, LANE_SPLIT, sharedRateOf } from "@/lib/burnticker/apiBudget";

function world() {
  let t = Date.parse("2026-10-18T15:00:00Z");
  const b = new ApiBudget({ role: "web", store: memoryStore(), now: () => t, sleep: async () => undefined });   // callers queue on reservations; the clock moves by hand
  return { b, advance: (ms: number) => { t += ms; } };
}

describe("A-38: the confirm and flight lanes keep their own rate under a read flood", () => {
  test("the lanes' rates add up to the web's slice, no more", () => {
    const sp = LANE_SPLIT.helius;
    assert.ok(Math.abs(sharedRateOf(sp) + sp.confirmRate + sp.flightRate - 1) < 1e-9);
    const perSec = budgetFor(specOf("helius"), "web").rates[0].perMs * 1000;
    assert.ok(perSec > 8 && perSec < 10, `the web's Helius slice is about 9 a second (${perSec})`);
  });

  for (const lane of ["confirm", "flight"] as const) {
    test(`ordinary reads that keep the shared bucket 20 s in debt for a minute: a ${lane} call still answers inside 2 s`, async () => {
      const { b, advance } = world();
      let ordinary = 0, busy = 0;
      for (let tick = 0; tick < 600; tick++) {          // 60 s in 100 ms steps
        for (;;) { const r = await b.take("helius", { lane: "general", methods: { getAccountInfo: 1 } }); if (r.state === "ok") ordinary++; else { busy++; break; } }
        advance(100);
      }
      assert.ok(ordinary > 300 && busy > 0, `the flood ran (${ordinary} reads, ${busy} turned away)`);
      // a confirm reads the transaction and its status: two calls in a row
      let waited = 0;
      for (const m of ["getTransaction", "getSignatureStatuses"]) {
        const r = await b.take("helius", { lane, methods: { [m]: 1 } });
        assert.equal(r.state, "ok", `${lane} ${m}`);
        if (r.state === "ok") waited += r.waitedMs;
      }
      assert.ok(waited < 2_000, `${lane} waited ${waited} ms`);
    });
  }

  test("junk sendTransaction through the proxy cannot make a wallet send with a flight token wait (Helius's send bucket is split too)", async () => {
    let t = Date.parse("2026-10-18T15:00:00Z");
    configureApiBudget({ role: "web", store: memoryStore(), now: () => t, sleep: async (ms) => { t += ms; } });
    try {
      const url = "https://mainnet.helius-rpc.com/?api-key=x";
      const send = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: ["junk"] });
      // two clients keep the proxy's share of the send bucket 20 s in debt for a minute (the clock only moves by the waits and by hand)
      let junk = 0;
      for (let tick = 0; tick < 600; tick++) {
        for (;;) { try { const t0 = t; await takeRpc(url, send, undefined, { lane: "proxy" }); t = t0; junk++; } catch (e) { if (e instanceof BudgetHoldError) break; throw e; } }
        t += 100;
      }
      assert.ok(junk > 10, `the junk sends ran (${junk})`);
      const t0 = t;
      await takeRpc(url, send, undefined, { lane: "flight" });
      assert.ok(t - t0 < 2_000, `the flight send waited ${t - t0} ms`);
    } finally { resetApiBudget(); }
  });

  test("under a proxy flood the pages keep at least half of the shared rate", async () => {
    const { b, advance } = world();
    const sharedPerSec = budgetFor(specOf("helius"), "web").rates[0].perMs * 1000 * sharedRateOf(LANE_SPLIT.helius);
    let pages = 0;
    for (let tick = 0; tick < 1200; tick++) {          // 120 s in 100 ms steps; both keep the shared bucket in debt
      for (;;) { if ((await b.take("helius", { lane: "proxy" })).state !== "ok") break; }
      for (;;) { const r = await b.take("helius", { lane: "general" }); if (r.state !== "ok") break; if (tick >= 600) pages++; }
      advance(100);
    }
    assert.ok(pages >= 0.45 * sharedPerSec * 60, `pages got ${pages} reads in the last minute (shared rate ${sharedPerSec.toFixed(2)}/s)`);
  });

  test("a busy flight lane does not take from the pages either", async () => {
    const { b } = world();
    let flight = 0;
    for (let i = 0; i < 500; i++) { if ((await b.take("helius", { lane: "flight" })).state !== "ok") break; flight++; }
    const r = await b.take("helius", { lane: "general" });
    assert.ok(r.state === "ok" && r.waitedMs === 0, `after ${flight} flight calls an ordinary read still runs at once`);
  });
});
