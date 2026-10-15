// HOLD FALLBACK, STARTUP UNDER A HOLD, THE METHOD SPLIT (2026-10-15). On 10-15 the keeper spent its Helius slice by 20:33Z; a restart at
// 22:23Z then threw BudgetHoldError from the startup genesis read and systemd restarted it every 30 s until midnight UTC. These tests pin:
// a held keyed plan sends reads to the public RPC (its own budget), a send never moves, a startup read waits through a hold instead of
// exiting (also proved on the real keeper script in a child process), and the budget records today's spend by phase and method.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  ApiBudget, BudgetHoldError, budgetTopMethodLines, budgetedRpcConfig, configureApiBudget, fallbackEligible, isHeliusHold, memoryStore, publicRpcFor, resetApiBudget, retryThroughBudgetHold,
  rpcCallsOf, setDescribeFallback, statusTableStore, verifyRpcFallback, withEssential, type BudgetAlert,
} from "@/lib/burnticker/apiBudget";
import { openRegistry } from "@/lib/burnticker/registry";

const HELIUS = "https://mainnet.helius-rpc.com/?api-key=x";
const PUBLIC = publicRpcFor("mainnet")!;

/** Spends the keeper's helius day so the next non-essential take holds. */
async function spendHelius(b: ReturnType<typeof configureApiBudget>): Promise<void> {
  const left = b.dayBudget("helius") - b.used("helius");
  await b.take("helius", { units: left, requests: 1 });
}

function fakeRpc(seen: string[]) {
  return (async (u: unknown, init?: { body?: string }) => {
    const m = JSON.parse(String(init?.body)) as { id: unknown; method: string };
    seen.push(`${String(u).startsWith(PUBLIC) ? "public" : "helius"}:${m.method}`);
    const result = m.method === "getGenesisHash" ? "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" : m.method === "sendTransaction" ? "sig" : { context: { slot: 1 }, value: 42 };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("the hold fallback", () => {
  test("a held Helius slice sends reads to the public RPC, counted against solana-public; without a fallback the read fails as before", async () => {
    const { Connection, PublicKey } = await import("@solana/web3.js");
    const lines: string[] = [];
    const b = configureApiBudget({ role: "keeper", store: memoryStore(), log: (s) => lines.push(s), sleep: async () => undefined });
    const real = globalThis.fetch, seen: string[] = [];
    globalThis.fetch = fakeRpc(seen);
    try {
      await spendHelius(b);
      const withFallback = new Connection(HELIUS, budgetedRpcConfig({ commitment: "confirmed" as const }, { fallbackUrl: PUBLIC }));
      assert.equal(await withFallback.getBalance(new PublicKey("11111111111111111111111111111111")), 42);
      // re-review N5: the genesis is essential only inside withEssential (the keeper's startup read); otherwise it is held, never moved
      await assert.rejects(withFallback.getGenesisHash(), (e: unknown) => isHeliusHold(e) || /budget is spent/.test(String((e as Error).message)));
      assert.equal(await withEssential(["getGenesisHash"], () => withFallback.getGenesisHash()), "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
      assert.equal(rpcCallsOf({ method: "getGenesisHash" }).essential, false, "not essential outside the startup read");
      // review item 1: the genesis is essential and never moves: it is read on the KEYED RPC (one credit past the hold)
      assert.deepEqual(seen, ["public:getBalance", "helius:getGenesisHash"]);
      assert.equal(b.used("solana-public"), 1);
      assert.equal(b.used("helius"), b.dayBudget("helius") + 1, "only the essential genesis read is charged past the hold");
      assert.equal(lines.filter((l) => /helius on hold: reads go to the public RPC/.test(l)).length, 1, "logged once a day");
      const without = new Connection(HELIUS, budgetedRpcConfig({ commitment: "confirmed" as const, disableRetryOnRateLimit: true }));
      await assert.rejects(without.getBalance(new PublicKey("11111111111111111111111111111111")), (e: unknown) => isHeliusHold(e) || /budget is spent/.test(String((e as Error).message)));
    } finally { globalThis.fetch = real; resetApiBudget(); }
  });
  test("a send is essential: it stays on the keyed plan under a hold (never moved to the public RPC)", async () => {
    const b = configureApiBudget({ role: "keeper", store: memoryStore(), sleep: async () => undefined });
    const real = globalThis.fetch, seen: string[] = [];
    globalThis.fetch = fakeRpc(seen);
    try {
      await spendHelius(b);
      const cfg = budgetedRpcConfig({}, { fallbackUrl: PUBLIC });
      await cfg.fetch(HELIUS, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [] }) });
      await cfg.fetch(HELIUS, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "getSignatureStatuses", params: [] }) });
      assert.deepEqual(seen, ["helius:sendTransaction", "helius:getSignatureStatuses"]);
    } finally { globalThis.fetch = real; resetApiBudget(); }
  });
});

describe("startup under a hold", () => {
  test("retryThroughBudgetHold waits out a BudgetHoldError (logged once) and returns; any other error is thrown; stop() ends the wait", async () => {
    const lines: string[] = [], slept: number[] = [];
    let n = 0;
    const hold = new BudgetHoldError("helius", { state: "hold", used: 120_000, budget: 120_000 });
    const v = await retryThroughBudgetHold(async () => { if (n++ < 3) throw hold; return "genesis"; }, { log: (s) => lines.push(s), sleep: async (ms) => { slept.push(ms); }, everyMs: 5_000 });
    assert.equal(v, "genesis");
    assert.deepEqual(slept, [5_000, 5_000, 5_000]);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /startup waits: Helius RPC: today's request budget is spent/);
    await assert.rejects(retryThroughBudgetHold(async () => { throw new Error("the RPC is mainnet: refused"); }, { log: () => undefined, sleep: async () => undefined }), /refused/);
    await assert.rejects(retryThroughBudgetHold(async () => { throw hold; }, { log: () => undefined, sleep: async () => undefined, stop: () => true }), BudgetHoldError);
  });

  test("the keeper wires the fallback into its program and market connections and the retry into the genesis read", () => {
    const src = fs.readFileSync("scripts/burnticker-keeper.mts", "utf8");
    assert.match(src, /const raw = new Connection\(RPC, budgetedRpcConfig\(\{ commitment: "confirmed" \}, RPC_FALLBACK\)\)/);
    assert.match(src, /disableRetryOnRateLimit: true \}, RPC_FALLBACK\)\) as unknown as MarketReader/);
    assert.match(src, /retryThroughBudgetHold\(\(\) => withEssential\(\["getGenesisHash"\], \(\) => connection\.getGenesisHash\(\)\)/);
  });
});

describe("the method split", () => {
  test("rpcCallsOf prices each method (getProgramAccounts 10) and counts calls per method", () => {
    const c = rpcCallsOf(JSON.stringify([{ method: "getProgramAccounts" }, { method: "getAccountInfo" }, { method: "getAccountInfo" }]));
    assert.equal(c.credits, 12);
    assert.deepEqual(c.methods, { getProgramAccounts: 10, getAccountInfo: 2 });
    assert.deepEqual(c.callsByMethod, { getProgramAccounts: 1, getAccountInfo: 2 });
  });
  test("credits are recorded under the phase and the method, survive a restart through the store, and print as a top line", async () => {
    const store = memoryStore();
    const real = globalThis.fetch, seen: string[] = [];
    globalThis.fetch = fakeRpc(seen);
    try {
      let b = configureApiBudget({ role: "keeper", store, sleep: async () => undefined });
      const cfg = budgetedRpcConfig({});
      const call = (method: string) => cfg.fetch(HELIUS, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }) });
      b.setPhase("pair-curve"); await call("getProgramAccounts"); await call("getProgramAccounts"); await call("getAccountInfo");
      b.setPhase("publish"); await call("getTokenLargestAccounts");
      b.flush();
      b = configureApiBudget({ role: "keeper", store, sleep: async () => undefined });   // a restart
      b.setPhase("publish"); await call("getTokenLargestAccounts");
      assert.deepEqual(b.topMethods("helius"), [{ key: "pair-curve:getProgramAccounts", used: 20 }, { key: "publish:getTokenLargestAccounts", used: 2 }, { key: "pair-curve:getAccountInfo", used: 1 }]);
      assert.deepEqual(budgetTopMethodLines(b), ["api budget helius top today: pair-curve:getProgramAccounts 20 · publish:getTokenLargestAccounts 2 · pair-curve:getAccountInfo 1"]);
    } finally { globalThis.fetch = real; resetApiBudget(); }
  });
});

describe("review 2026-10-15: what may move to the fallback, and when", () => {
  test("calls that build or confirm a send never move: under a hold they fail instead of reading the public RPC", async () => {
    configureApiBudget({ role: "keeper", store: memoryStore(), sleep: async () => undefined });
    const b = configureApiBudget({ role: "keeper", store: memoryStore(), sleep: async () => undefined });
    const real = globalThis.fetch, seen: string[] = [];
    globalThis.fetch = fakeRpc(seen);
    try {
      await spendHelius(b);
      const cfg = budgetedRpcConfig({}, { fallbackUrl: PUBLIC });
      for (const method of ["getLatestBlockhash", "simulateTransaction", "getTransaction", "getParsedTransaction"]) {
        await assert.rejects(cfg.fetch(HELIUS, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }) }), BudgetHoldError, method);
      }
      assert.deepEqual(seen, []);
      assert.equal(fallbackEligible(JSON.stringify([{ method: "getAccountInfo" }, { method: "getLatestBlockhash" }])), false, "a batch with one such call stays");
      assert.equal(fallbackEligible(JSON.stringify({ method: "getMultipleAccounts" })), true);
    } finally { globalThis.fetch = real; resetApiBudget(); }
  });
  test("the fallback is resolved per call (set after the keyed genesis is verified); a null fallback means no move", async () => {
    const b = configureApiBudget({ role: "keeper", store: memoryStore(), sleep: async () => undefined });
    const real = globalThis.fetch, seen: string[] = [];
    globalThis.fetch = fakeRpc(seen);
    let fb: string | null = null;
    try {
      await spendHelius(b);
      const cfg = budgetedRpcConfig({}, { fallbackUrl: () => fb });
      const read = () => cfg.fetch(HELIUS, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo" }) });
      await assert.rejects(read(), BudgetHoldError);
      fb = PUBLIC; await read();
      assert.deepEqual(seen, ["public:getAccountInfo"]);
    } finally { globalThis.fetch = real; resetApiBudget(); }
  });
  test("a non-public fallback URL is counted by role (solana-public), not as the keyed plan", async () => {
    const b = configureApiBudget({ role: "keeper", store: memoryStore(), sleep: async () => undefined });
    const real = globalThis.fetch, seen: string[] = [];
    globalThis.fetch = fakeRpc(seen);
    try {
      await spendHelius(b);
      const before = b.used("helius");
      const cfg = budgetedRpcConfig({}, { fallbackUrl: "https://my-own-node.example.com" });
      await cfg.fetch(HELIUS, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo" }) });
      assert.equal(b.used("helius"), before);
      assert.equal(b.used("solana-public"), 1);
    } finally { globalThis.fetch = real; resetApiBudget(); }
  });
  test("publicRpcFor names the actual cluster's endpoint and nothing for localnet (never a guessed mainnet)", () => {
    assert.equal(publicRpcFor("mainnet"), "https://api.mainnet-beta.solana.com");
    assert.equal(publicRpcFor("devnet"), "https://api.devnet.solana.com");
    assert.equal(publicRpcFor("localnet"), null);
  });
  test("genesis on the fallback: a fallback whose genesis differs from the keyed RPC's is refused; a matching one is used", async () => {
    configureApiBudget({ role: "keeper", store: memoryStore(), sleep: async () => undefined });
    const lines: string[] = [];
    const answer = (g: string) => (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: g }), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    try {
      assert.equal(await verifyRpcFallback("https://api.devnet.solana.com", "MAINNET-GENESIS", { log: (l) => lines.push(l), fetchImpl: answer("DEVNET-GENESIS") }), null);
      assert.match(lines.join("\n"), /refused: its genesis DEVNET-G… is not the keyed RPC's MAINNET-…/);
      assert.equal(await verifyRpcFallback(PUBLIC, "G1", { log: () => undefined, fetchImpl: answer("G1") }), PUBLIC);
      assert.equal(await verifyRpcFallback(PUBLIC, "G1", { log: () => undefined, fetchImpl: (async () => { throw new Error("down"); }) as unknown as typeof fetch }), null);
    } finally { resetApiBudget(); }
  });
  test("the hold alert says what happens: with a fallback named, reads move and nothing is sent; isHeld reports the spent day", async () => {
    const alerts: BudgetAlert[] = [], lines: string[] = [];
    const b = new ApiBudget({ role: "keeper", store: memoryStore(), alert: (a) => alerts.push(a), log: (l) => lines.push(l), sleep: async () => undefined });
    b.setFallback("helius", "the public Solana RPC (api.mainnet-beta.solana.com)");
    assert.equal(b.isHeld("helius"), false);
    await b.take("helius", { units: b.dayBudget("helius") });
    assert.equal((await b.take("helius")).state, "hold");
    assert.equal(b.isHeld("helius"), true);
    const hold = alerts.find((a) => a.level === "hold")!;
    assert.match(hold.text, /reads from the public Solana RPC \(api\.mainnet-beta\.solana\.com\) instead, more slowly, and sends nothing/);
    assert.match(lines.join("\n"), /its reads go to the public Solana RPC .* and the keeper sends nothing until then/);
  });
  test("the method split adds atomically: two budgets over one registry never lose a count (review item 10)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-methods-"));
    const reg = openRegistry(path.join(dir, "r.db"));
    try {
      const real = globalThis.fetch;
      const a = new ApiBudget({ role: "keeper", store: statusTableStore(reg.db), sleep: async () => undefined });
      const b2 = new ApiBudget({ role: "keeper", store: statusTableStore(reg.db), sleep: async () => undefined });
      try {
        a.setPhase("cycle"); b2.setPhase("cycle");
        await a.take("helius", { units: 3, methods: { getAccountInfo: 3 } });
        await b2.take("helius", { units: 5, methods: { getAccountInfo: 5 } });
        await a.take("helius", { units: 10, methods: { getProgramAccounts: 10 } });
        a.flush(); b2.flush();
        assert.deepEqual(a.topMethods("helius"), [{ key: "cycle:getAccountInfo", used: 8 }, { key: "cycle:getProgramAccounts", used: 10 }].sort((x, y) => y.used - x.used));
      } finally { globalThis.fetch = real; }
    } finally { reg.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("the real keeper script on a spent day (review items 1 and 2)", () => {
  test("starts (genesis on the keyed RPC only), verifies the fallback's genesis, runs its cycles with sends held, and exits 0 on SIGTERM", { timeout: 90_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-hold-start-"));
    const db = path.join(dir, "burnticker.db");
    const reg = openRegistry(db);
    const day = new Date().toISOString().slice(0, 10);
    reg.db.prepare("INSERT INTO status (key, value, updated_at) VALUES (?, ?, ?)").run("apiBudget.day.keeper.helius", JSON.stringify({ day, used: 120_000 }), Date.now());
    reg.close();
    const { Keypair } = await import("@solana/web3.js");
    const keyFile = path.join(dir, "key.json");
    fs.writeFileSync(keyFile, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
    const DEVNET = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    const keyed: string[] = [], fb: string[] = [];
    // N3: the fallback refuses its FIRST genesis read (a 429 at startup); the keeper verifies it again on its first held cycle
    let fbGenesisReads = 0;
    const server = (seen: string[]) => http.createServer(async (q, r) => {
      let body = ""; for await (const c of q) body += c;
      const m = JSON.parse(body) as { id: unknown; method: string };
      seen.push(m.method);
      if (seen === fb && m.method === "getGenesisHash" && fbGenesisReads++ === 0) { r.writeHead(429); r.end("{}"); return; }
      r.writeHead(200, { "content-type": "application/json" });
      r.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: m.method === "getGenesisHash" ? DEVNET : null }));
    });
    const s1 = server(keyed), s2 = server(fb);
    await new Promise<void>((r) => s1.listen(0, "127.0.0.1", () => r()));
    await new Promise<void>((r) => s2.listen(0, "127.0.0.1", () => r()));
    const port = (x: http.Server) => (x.address() as { port: number }).port;
    const env = { PATH: process.env.PATH ?? "", HOME: dir, BURNTICKER_DB: db, BURNTICKER_PUBLISH_DIR: path.join(dir, "site"), BURNTICKER_CLUSTER: "devnet",
      BURNTICKER_RPC_URL: `http://127.0.0.1:${port(s1)}`, BURNTICKER_PROGRAM_ID: "AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM", BURNTICKER_RPC_FALLBACK_URL: `http://127.0.0.1:${port(s2)}`,
      BURNTICKER_SIGNER_PATH: keyFile, OWN_TOKENS_GENERATED_PATH: path.join(dir, "own.json") };
    const child = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./test/alias-hook.mjs", "scripts/burnticker-keeper.mts"], { cwd: process.cwd(), env: env as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => { out += String(d); });
    child.stderr?.on("data", (d: Buffer) => { out += String(d); });
    const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));
    try {
      const deadline = Date.now() + 60_000;
      while (!/every cycle until 00:00 UTC runs with its sends held; reads go to 127\.0\.0\.1/.test(out) && child.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
      assert.match(out, /burnticker keeper starting/, out.slice(-2_000));
      assert.match(out, /hold fallback 127\.0\.0\.1 not verified|hold fallback 127\.0\.0\.1 refused/, "the startup verification failed");
      assert.match(out, /hold fallback 127\.0\.0\.1 verified \(on hold\)/, "re-verified on the first held cycle");
      assert.match(out, /every cycle until 00:00 UTC runs with its sends held; reads go to 127\.0\.0\.1/, out.slice(-2_000));
      assert.equal(child.exitCode, null, "running, not crash-looping");
      assert.deepEqual([...new Set(keyed)], ["getGenesisHash"], "the keyed RPC saw only the essential genesis read");
      assert.equal(keyed.length, 1, "read once per process");
      assert.equal(fb.filter((x) => x === "getGenesisHash").length, 2, "checked at startup, then again on the first held cycle");
      child.kill("SIGTERM");
      assert.equal(await exited, 0, out.slice(-2_000));
      assert.doesNotMatch(out, /BudgetHoldError|refused to start/);
    } finally { if (child.exitCode === null) child.kill("SIGKILL"); s1.close(); s2.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("re-review 2026-10-15 (N4, N5)", () => {
  test("N4: getTransaction / getParsedTransaction move to the fallback only while the keeper runs a held (dry) cycle; blockhash and simulate never", async () => {
    const b = configureApiBudget({ role: "keeper", store: memoryStore(), sleep: async () => undefined });
    const real = globalThis.fetch, seen: string[] = [];
    globalThis.fetch = fakeRpc(seen);
    try {
      await spendHelius(b);
      const cfg = budgetedRpcConfig({}, { fallbackUrl: PUBLIC });
      const call = (method: string) => cfg.fetch(HELIUS, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }) });
      await assert.rejects(call("getTransaction"), BudgetHoldError);
      setDescribeFallback(true);
      await call("getTransaction"); await call("getParsedTransaction");
      await assert.rejects(call("getLatestBlockhash"), BudgetHoldError);
      await assert.rejects(call("simulateTransaction"), BudgetHoldError);
      setDescribeFallback(false);
      await assert.rejects(call("getParsedTransaction"), BudgetHoldError);
      assert.deepEqual(seen, ["public:getTransaction", "public:getParsedTransaction"]);
    } finally { setDescribeFallback(false); globalThis.fetch = real; resetApiBudget(); }
  });
  test("N4: a lock-fee step that hits the hold is a wait: no alert, no backoff row", async () => {
    const { claimLockFeesFor } = await import("@/lib/burnticker/lockFeesKeeper");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-lf-hold-"));
    const reg = openRegistry(path.join(dir, "r.db"));
    try {
      const hold = new BudgetHoldError("helius", { state: "hold", used: 1, budget: 1 });
      const port = { mint: "M", feeKeysPda: "K", async state() { throw hold; } };
      const lockFees = { programId: "P", cluster: "mainnet", feeKeysPda: () => "K", operatorTreasury: () => "T", port: () => port };
      const before = reg.db.prepare("SELECT COUNT(*) AS n FROM alerts").get() as { n: number };
      const r = await claimLockFeesFor({ registry: reg, lockFees: lockFees as never, log: () => undefined, now: () => Date.now(), dryRun: false }, { mint: "M", ticker: "M" } as never);
      assert.equal(r.outcome, "waiting");
      assert.equal((reg.db.prepare("SELECT COUNT(*) AS n FROM alerts").get() as { n: number }).n, before.n);
      assert.equal(reg.getStatus("lock-fees.backoff.M"), null);
    } finally { reg.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test("N4: a crank build that hits the hold is held as a wait (no reading error, no backoff); hold lifted is logged once", () => {
    const src = fs.readFileSync("src/lib/burnticker/multiKeeper.ts", "utf8");
    assert.match(src, /if \(isBudgetHold\(e\)\) \{ const m = [^\n]*hold\(`waiting: \$\{m\}`, rows\); break; \}\n\s+fail\(`RPC\/program error/);
    const keeper = fs.readFileSync("scripts/burnticker-keeper.mts", "utf8");
    assert.match(keeper, /helius hold lifted: sends resume this cycle/);
    assert.match(keeper, /setDescribeFallback\(heliusHeld\)/);
  });
});

