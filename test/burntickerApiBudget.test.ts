// THE REQUEST BUDGET (owner, 2026-10-13 night: "make sure we never exceed our API limits for any keeper"). src/lib/burnticker/apiBudget.ts:
// buckets wait (never fail), day counts survive a restart, a spent day holds the source (logged once, alerted once), the push and its
// copy, and a scan of the call sites proving every listed provider goes through the budget.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ApiBudget, BUDGET_FRACTION, BudgetHoldError, ROLE_SHARES, SOURCES, budgetFor, budgetStatusLines, budgetedFetch, budgetedRpcConfig, configureApiBudget, memoryStore, resetApiBudget,
  rpcCallsOf, rpcSourceFor, sourceForUrl, specOf, statusTableStore, takeOrThrow, type BudgetAlert,
} from "@/lib/burnticker/apiBudget";
import { openRegistry } from "@/lib/burnticker/registry";
import { PUSH_KIND_OF_ALERT, PUSH_LEAD, PUSH_TITLE, planPushes } from "@/lib/burnticker/push";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const T0 = Date.parse("2026-10-14T03:00:00Z");
/** A fake clock whose sleep advances it: waits are measured, never slept. */
function clock(start = T0) {
  let t = start; const slept: number[] = [];
  return { now: () => t, sleep: async (ms: number) => { slept.push(ms); t += ms; }, advance: (ms: number) => { t += ms; }, slept };
}

describe("the table", () => {
  test("every process's share sums to at most 1, so all three together stay at or under 60% of each documented limit", () => {
    assert.equal(BUDGET_FRACTION, 0.6);
    for (const s of SOURCES) {
      const shares = s.shares ?? ROLE_SHARES;
      const sum = Object.values(shares).reduce((a, b) => a + (b ?? 0), 0);
      assert.ok(sum <= 1 + 1e-9, `${s.id}: shares sum to ${sum}`);
      for (const role of ["keeper", "web", "deficit"] as const) {
        const b = budgetFor(s, role);
        for (const r of b.rates) {
          const stated = r.windowMs === 1_000 ? s.limit.perSec! : r.windowMs === 60_000 ? s.limit.perMin! : s.limit.perHour!;
          assert.ok(r.perMs * r.windowMs <= stated * 0.6 + 1e-9, `${s.id}/${role} rate`);
        }
      }
    }
  });
  test("Helius: 10M credits a month at 60% is 200,000 a day, the keeper's 60% share of it 120,000; 50 rps → 18 rps for the keeper", () => {
    const h = budgetFor(specOf("helius"), "keeper");
    assert.equal(h.perDay, 120_000);
    assert.ok(Math.abs(h.rates[0].perMs * 1_000 - 18) < 1e-9);
    assert.equal(budgetFor(specOf("helius"), "web").perDay, 60_000);
    assert.equal(budgetFor(specOf("helius"), "deficit").perDay, 20_000);
  });
  test("hosts map to sources; Solana RPCs are the public endpoints or the keyed plan", () => {
    assert.equal(sourceForUrl("https://www.thesportsdb.com/api/v2/json/schedule/league/4387/2025-2026"), "thesportsdb");
    assert.equal(sourceForUrl("https://statsapi.mlb.com/api/v1/schedule"), "mlb-stats");
    assert.equal(sourceForUrl("https://api-web.nhle.com/v1/schedule/now"), "nhl-api");
    assert.equal(sourceForUrl("https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json"), "nba-cdn");
    assert.equal(sourceForUrl("https://gamma-api.polymarket.com/events?slug=x"), "polymarket-gamma");
    assert.equal(sourceForUrl("https://polygon-bor.publicnode.com"), "polygon-rpc");
    assert.equal(sourceForUrl("https://hermes.pyth.network/v2/updates/price/latest"), "pyth-hermes");
    assert.equal(sourceForUrl("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny"), "fiscal-data");
    assert.equal(sourceForUrl("https://fred.stlouisfed.org/graph/fredgraph.csv?id=UNRATE"), "fred");
    assert.equal(sourceForUrl("https://api.weather.gov/products"), "nws");
    assert.equal(sourceForUrl("https://mesonet.agron.iastate.edu/json/cli.py"), "iem");
    assert.equal(sourceForUrl("https://api.open.fec.gov/v1/candidates"), "fec");
    assert.equal(sourceForUrl("https://api.elections.kalshi.com/trade-api/v2/series"), "kalshi");
    assert.equal(sourceForUrl("https://example.org/x"), "http:example.org");
    assert.equal(specOf("http:example.org").id, "other-http");
    assert.equal(rpcSourceFor("https://mainnet.helius-rpc.com/?api-key=x"), "helius");
    assert.equal(rpcSourceFor("https://api.devnet.solana.com"), "solana-public");
    assert.equal(rpcSourceFor("https://some-other-rpc.example/"), "helius");
  });
  test("Helius credits by method: 1 for a standard or archival call, 10 for getProgramAccounts and DAS; a batch adds up; sends are essential", () => {
    assert.deepEqual(rpcCallsOf({ method: "getBalance" }), { calls: 1, credits: 1, essential: false, sends: 0, methods: { getBalance: 1 }, callsByMethod: { getBalance: 1 } });
    assert.equal(rpcCallsOf(JSON.stringify({ method: "getTransaction" })).credits, 1);
    assert.equal(rpcCallsOf({ method: "getProgramAccounts" }).credits, 10);
    assert.equal(rpcCallsOf([{ method: "searchAssets" }, { method: "getSlot" }]).credits, 11);
    assert.equal(rpcCallsOf([{ method: "searchAssets" }, { method: "getSlot" }]).calls, 2);
    assert.deepEqual(rpcCallsOf({ method: "sendTransaction" }), { calls: 1, credits: 1, essential: true, sends: 1, methods: { sendTransaction: 1 }, callsByMethod: { sendTransaction: 1 } });
    assert.equal(rpcCallsOf("not json").credits, 1);
  });
});

describe("the buckets", () => {
  test("an empty bucket waits (never fails) and the waits space calls at the budgeted rate, with no burst after a quiet spell", async () => {
    const c = clock();
    const b = new ApiBudget({ role: "keeper", now: c.now, sleep: c.sleep });
    // Pyth Hermes: 1 a second stated → 0.36 a second for the keeper (60% × 0.6); a per-second bucket holds one second of its rate (at least one call)
    const out = [];
    for (let i = 0; i < 8; i++) out.push(await b.take("pyth-hermes"));
    assert.ok(out.every((o) => o.state === "ok"));
    const waited = c.slept.reduce((a, x) => a + x, 0);
    // 8 calls: the first is free, the other 7 wait 1/0.36 s each (2.78 s), 19.4 s in all
    assert.ok(waited > 18_000 && waited < 21_000, `waited ${waited}`);
    c.advance(3_600_000);   // an hour of quiet
    c.slept.length = 0;
    for (let i = 0; i < 8; i++) await b.take("pyth-hermes");
    assert.ok(c.slept.reduce((a, x) => a + x, 0) > 18_000, "a quiet hour does not buy a burst");
  });
  test("a wait past maxWaitMs answers busy, takes nothing, and the caller's read fails like a network error", async () => {
    const c = clock();
    const b = new ApiBudget({ role: "web", now: c.now, sleep: c.sleep, maxWaitMs: 1_000 });
    let busy = 0;
    for (let i = 0; i < 10; i++) { const r = await b.take("launch-library"); if (r.state === "busy") busy++; }
    assert.ok(busy > 0);
    assert.equal(b.used("launch-library"), 10 - busy);
  });
  test("passive (an unconfigured process): counts, never waits, never holds", async () => {
    const c = clock();
    const b = new ApiBudget({ role: "keeper", now: c.now, sleep: c.sleep, enforce: false });
    for (let i = 0; i < 5_000; i++) assert.equal((await b.take("launch-library")).state, "ok");
    assert.equal(c.slept.length, 0);
    assert.equal(b.used("launch-library"), 5_000);
  });
});

describe("the day count", () => {
  test("survives a restart: a second budget over the same registry starts from the first one's count", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apibudget-"));
    const file = path.join(dir, "burnticker.db");
    const c = clock();
    let reg = openRegistry(file);
    const a = new ApiBudget({ role: "keeper", store: statusTableStore(reg.db), now: c.now, sleep: c.sleep });
    for (let i = 0; i < 37; i++) await a.take("helius", { units: 10 });
    a.flush(); reg.close();
    reg = openRegistry(file);   // the restart
    const b = new ApiBudget({ role: "keeper", store: statusTableStore(reg.db), now: c.now, sleep: c.sleep });
    assert.equal(b.used("helius"), 370);
    await b.take("helius", { units: 1 }); b.flush();
    assert.equal(JSON.parse(reg.getStatus("apiBudget.day.keeper.helius")!).used, 371);
    // a new UTC day starts from zero
    c.advance(24 * 3_600_000);
    assert.equal(b.used("helius"), 0);
    reg.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test("two processes adding to one key never lose a count (the add is one atomic upsert)", () => {
    const reg = openRegistry(":memory:");
    const s1 = statusTableStore(reg.db), s2 = statusTableStore(reg.db);
    s1.add("k", "2026-10-14", 5, T0); s2.add("k", "2026-10-14", 7, T0);
    assert.equal(s1.add("k", "2026-10-14", 0, T0), 12);
    assert.equal(s1.add("k", "2026-10-15", 1, T0), 1, "a new day resets");
    reg.close();
  });
  test("an unflushed count is written within flushUnits takes", async () => {
    const store = memoryStore(), c = clock();
    const b = new ApiBudget({ role: "keeper", store, now: c.now, sleep: c.sleep, flushUnits: 5, flushMs: 1e12 });
    for (let i = 0; i < 4; i++) await b.take("fred");
    assert.equal(JSON.parse(store.get("apiBudget.day.keeper.fred") ?? "{}").used ?? 0, 0);
    await b.take("fred");
    assert.equal(JSON.parse(store.get("apiBudget.day.keeper.fred")!).used, 5);
  });
});

describe("the hold", () => {
  test("a spent day holds the source at once (no request, no wait), logs once across a restart, alerts at 80% and at the hold", async () => {
    const store = memoryStore(), c = clock(), logs: string[] = [], alerts: BudgetAlert[] = [];
    const mk = () => new ApiBudget({ role: "keeper", store, now: c.now, sleep: c.sleep, log: (s) => logs.push(s), alert: (a) => alerts.push(a) });
    let b = mk();
    const budget = b.dayBudget("bls");   // 500 a day stated → 150 for the keeper
    assert.equal(budget, 150);
    for (let i = 0; i < budget; i++) assert.equal((await b.take("bls")).state, "ok");
    assert.deepEqual(alerts.map((a) => a.level), ["80"]);
    const before = c.slept.length;
    for (let i = 0; i < 50; i++) assert.equal((await b.take("bls")).state, "hold");
    assert.equal(c.slept.length, before, "a hold never waits");
    assert.equal(logs.filter((l) => l.includes("ON HOLD")).length, 1, "logged once");
    assert.deepEqual(alerts.map((a) => a.level), ["80", "hold"]);
    b.flush();
    b = mk();   // a restart the same day: still held, not logged again
    assert.equal((await b.take("bls")).state, "hold");
    assert.equal(logs.filter((l) => l.includes("ON HOLD")).length, 1);
    assert.equal(budgetStatusLines(b.lines()).find((l) => l.includes(" bls:"))?.includes("ON HOLD"), true);
    // essential calls (a send in flight) pass a hold
    assert.equal((await b.take("bls", { essential: true })).state, "ok");
    // the next UTC day: reads again
    c.advance(24 * 3_600_000);
    assert.equal((await b.take("bls")).state, "ok");
  });
  test("takeOrThrow and budgetedFetch: a held source throws BudgetHoldError and the wrapped fetch is never called", async () => {
    const c = clock();
    const b = configureApiBudget({ role: "keeper", store: memoryStore(), now: c.now, sleep: c.sleep });
    try {
      for (let i = 0; i < b.dayBudget("bls"); i++) await takeOrThrow("bls");
      await assert.rejects(takeOrThrow("bls"), BudgetHoldError);
      let called = 0;
      const f = budgetedFetch(async (_u: string, _i?: unknown) => { called++; return { ok: true, status: 200, json: async () => ({}) }; });
      await assert.rejects(f("https://api.bls.gov/publicAPI/v2/timeseries/data/"), BudgetHoldError);
      assert.equal(called, 0);
      await f("https://www.thesportsdb.com/api/v2/json/x");
      assert.equal(called, 1);
      // an RPC body through the wrapper counts credits by method
      await f("https://mainnet.helius-rpc.com/?api-key=x", { body: JSON.stringify({ method: "getProgramAccounts" }) } as never);
      b.flush();
      assert.equal(b.used("helius"), 10);
    } finally { resetApiBudget(); }
  });
});

describe("a web3 Connection", () => {
  test("built with budgetedRpcConfig, every request goes through the budget (credits by method)", async () => {
    const { Connection, PublicKey } = await import("@solana/web3.js");
    const b = configureApiBudget({ role: "keeper", store: memoryStore() });
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
      calls++; const m = JSON.parse(String(init?.body)) as { id: unknown };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { context: { slot: 1 }, value: 42 } }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const c = new Connection("https://mainnet.helius-rpc.com/?api-key=x", budgetedRpcConfig({ commitment: "confirmed" as const }));
      assert.equal(await c.getBalance(new PublicKey("11111111111111111111111111111111")), 42);
      assert.equal(calls, 1);
      b.flush();
      assert.equal(b.used("helius"), 1);
    } finally { globalThis.fetch = real; resetApiBudget(); }
  });
});

describe("the alert", () => {
  test("bt-api-budget maps to its own push kind; the title, the lead and both alert texts pass the copy lint", async () => {
    assert.equal(PUSH_KIND_OF_ALERT["bt-api-budget"], "api-budget");
    const cfg = loadCopyLintConfig();
    const store = memoryStore(), c = clock(), alerts: BudgetAlert[] = [];
    const b = new ApiBudget({ role: "keeper", store, now: c.now, sleep: c.sleep, alert: (a) => alerts.push(a) });
    for (let i = 0; i <= b.dayBudget("bls"); i++) await b.take("bls");
    assert.equal(alerts.length, 2);
    for (const t of [PUSH_TITLE["api-budget"], PUSH_LEAD["api-budget"], ...alerts.map((a) => a.text)]) assert.ok(lintCopy(t, cfg).ok, t);
    // the push plan sends it
    const { messages } = planPushes({ now: c.now(), alerts: alerts.map((a, i) => ({ ts: c.now() - 1_000 + i, kind: a.kind, key: a.key, text: a.text })), state: null });
    assert.equal(messages.filter((m) => m.kind === "api-budget").length, 1);
  });
  test("the alert lands in the registry once per key per day", () => {
    const reg = openRegistry(":memory:");
    const a = { kind: "bt-api-budget", key: "bt-api-budget:keeper:bls:2026-10-14:hold", text: "x", meta: null };
    assert.ok(reg.recordAlert(a, T0));
    assert.equal(reg.recordAlert(a, T0 + 60_000), null);
    reg.close();
  });
});

describe("every listed source goes through the budget (a scan of the call sites)", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  /** [file, the provider(s) it calls]. Every fetch call in the file must have a take within the six lines above it (or be wrapped). */
  const SITES: [string, string][] = [
    ["src/lib/burnticker/sources/espn.ts", "TheSportsDB v1/v2, MLB, NHL, NBA, ESPN (EspnClient.get)"],
    ["src/lib/burnticker/oracle/polymarket.ts", "Polymarket Gamma (PolymarketClient.get)"],
    ["src/lib/burnKeeper/attesters/polymarketOnchain.ts", "Polygon RPC (payout vector)"],
    ["src/lib/burnticker/oracle/kalshi.ts", "Kalshi"],
    ["src/lib/burnticker/derby/pyth.ts", "Pyth Hermes"],
    ["src/lib/burnticker/pin.ts", "Irys uploads"],
    ["src/lib/burnKeeper/feeds/treasury.ts", "Treasury Fiscal Data ($DEFICIT)"],
    ["src/lib/burnticker/sources/attestedHttp.ts", "catalogue feeds: Fiscal Data, FRED, BLS, LL2, GitHub, … by host"],
    ["src/lib/burnticker/sources/nws.ts", "NWS + IEM"],
    ["src/lib/burnticker/sources/fec.ts", "FEC"],
    ["src/lib/burnKeeper/jupiterSwap.ts", "Jupiter"],
    ["src/lib/burnticker/derby/search.ts", "RedStone, Jupiter, DexScreener"],
    ["src/lib/burnticker/derby/post.ts", "Jupiter"],
    ["src/lib/burnticker/derby/cross.ts", "cross-reads"],
    ["src/lib/burnticker/derby/adapter.ts", "RedStone"],
    ["src/lib/burnticker/coverage/preflight.ts", "RedStone"],
    ["src/lib/burnticker/ops/cloneWatch.ts", "DexScreener"],
    ["src/lib/burnticker/sources/copycats.ts", "Helius DAS, DexScreener, GeckoTerminal"],
    ["src/lib/burnKeeper/attesters/zktls.ts", "Reclaim"],
    ["src/lib/burnticker/alerts.ts", "Helius (getBalance)"],
    ["src/lib/burnticker/trustpack/receiptCheck.ts", "Solana RPC (jsonRpc)"],
    ["src/lib/burnticker/verify.ts", "source re-reads"],
    ["src/app/api/burnticker/rpc/route.ts", "Helius (the browser proxy)"],
    ["src/app/api/burnticker/burn-target/route.ts", "Helius"],
    ["src/lib/burnticker/server.ts", "Helius (the site's Connections)"],
    ["src/lib/burnticker/sources/onchain.ts", "Solana RPC"],
    ["src/lib/burnticker/trust.ts", "Solana RPC"],
    ["scripts/burnticker-keeper.mts", "Helius + Solana public (the keeper's Connections)"],
    ["scripts/burn-keeper.mts", "Helius ($DEFICIT keeper's Connection)"],
  ];
  // own hosts and the owner's channels, not provider APIs: the alert webhook (alerts.ts postAlert), the push channel (rate-limited
  // in push.ts), the standby's heartbeat (leaderLock.ts), the remote ops.json (checkin.ts). Listed in API-BUDGETS.md.
  const OWN = [/postAlert|alertWebhook|webhook/i];
  for (const [file, what] of SITES) {
    test(`${file}: ${what}`, () => {
      const src = read(file), lines = src.split("\n");
      let sites = 0;
      lines.forEach((l, i) => {
        const call = /\bawait (this\.)?(d\.|o\.)?(fetchImpl|fetch)\(|\bnew Connection\(/.test(l) && !/^\s*(\/\/|\*)/.test(l);
        if (!call) return;
        if (/new Connection\(/.test(l)) { assert.match(l, /budgetedRpcConfig\(/, `${file}:${i + 1} a Connection without the budget`); sites++; return; }
        if (file.endsWith("alerts.ts") && OWN.some((r) => r.test(lines.slice(Math.max(0, i - 8), i + 1).join("\n"))) && !/rpcUrl/.test(l)) return;
        const above = lines.slice(Math.max(0, i - 6), i + 1).join("\n");
        assert.match(above, /takeOrThrow\(|takeRpc\(|budgetedFetch\(/, `${file}:${i + 1} calls out without taking from the budget`);
        sites++;
      });
      if (file === "src/lib/burnticker/pin.ts") { assert.match(src, /takeOrThrow\("irys"\)[^\n]*\n\s*const r = await client\.upload/); sites++; }
      if (file === "src/lib/burnticker/sources/copycats.ts") assert.match(src, /const f = budgetedFetch\(/);
      if (file === "src/lib/burnticker/trustpack/receiptCheck.ts") assert.match(src, /takeRpc\(url/);
      assert.ok(sites > 0, `${file}: no call site found (the scan is stale)`);
    });
  }
  test("the trust pack's source re-read is wrapped", () => assert.match(read("src/lib/burnticker/trustpack/api.ts"), /budgetedFetch\(\(u: string\) => fetch\(/));
  test("the keepers configure their budget with the persistent store; the site configures its own in platform()", () => {
    assert.match(read("scripts/burnticker-keeper.mts"), /configureApiBudget\(\{ role: "keeper", store: statusTableStore\(registry\.db\)/);
    assert.match(read("scripts/burn-keeper.mts"), /configureApiBudget\(\{ role: "deficit", store: statusTableStore\(ledger\.db\)/);
    assert.match(read("src/lib/burnticker/server.ts"), /configureApiBudget\(\{ role: "web", store: statusTableStore\(registry\.db\)/);
  });
  test("every source in the table is in docs/burnticker/API-BUDGETS.md", () => {
    const doc = read("docs/burnticker/API-BUDGETS.md");
    for (const s of SOURCES) assert.ok(doc.includes(`\`${s.id}\``), `${s.id} missing from API-BUDGETS.md`);
  });
});
