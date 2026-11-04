// HB-145 second half (2026-10-20): the home and coins builds took 17 s on a quiet host with 26 coins, and the log said only "built in
// 17208 ms". Each build now names its stages on the same line (buildStages.ts), reads its coins under one deadline with the last good read
// for a late coin (boundedReads.ts), gives the batch, the status and the rehearsal curve their own budgets, and the web's read-only RPC
// connections a per-request timeout. These tests hold the line's shape, the deadline, the last-good fallback and the one-read-per-coin rule.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { stageClock } from "@/lib/burnticker/buildStages";
import { clearBoundedReads, earlierReadsNote, keptRead, LIST_BUILD_BUDGETS, readAgoText, readCoinsBounded, ReadLateError, setListBuildBudgetsForTests } from "@/lib/burnticker/boundedReads";
import { budgetedRpcConfig, budgetStoreSyncMs, statusTableStore } from "@/lib/burnticker/apiBudget";
import { clearHoldersCache, readHolders } from "@/lib/burnticker/holders";
import { openRegistry } from "@/lib/burnticker/registry";
import { setPlatformForTests, tokenPageData, type Platform } from "@/lib/burnticker/server";
import { makeWorld } from "./burntickerApiHelpers.ts";

const never = <T>() => new Promise<T>(() => {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("the build line names its stages", () => {
  test("shape: 'built in N ms, N coins: stage ms, …; cpu …, loop max …, budget store …; notes'", async () => {
    let t = 1_000, cpu = 0, store = 5;
    const c = stageClock({ now: () => t, cpuMicros: () => cpu, storeMs: () => store, loopMonitor: false });
    c.budget("registry", 1_000);
    c.run("registry", () => { t += 120; });
    await c.run("chain", async () => { t += 15_900; });
    c.run("shape", () => { t += 300; cpu += 410_000; store += 3; });
    c.run("shape", () => { t += 8; });
    c.note("1 coin from an earlier read (PITWIN 3 min)");
    assert.equal(c.line("[burnticker/home]", "26 coins"), "[burnticker/home] built in 16328 ms, 26 coins: registry 120, chain 15900, shape 308; cpu 410 ms, budget store 3 ms; 1 coin from an earlier read (PITWIN 3 min)");
  });

  test("the line still starts the way the old one did, so every reader of 'built in N ms, N coins' keeps working", () => {
    const line = stageClock({ loopMonitor: false }).line("[burnticker/tokens]", "8 coins");
    assert.match(line, /^\[burnticker\/tokens\] built in \d+ ms, 8 coins; cpu \d+ ms, budget store \d+ ms$/);
    assert.match(stageClock().line("[x]", "1 coins"), /loop max \d+ ms/, "the event-loop monitor runs by default");
  });

  test("a synchronous stage past its budget is named on the line", () => {
    let t = 0;
    const c = stageClock({ now: () => t, cpuMicros: () => 0, storeMs: () => 0, loopMonitor: false });
    c.budget("registry", 1_000);
    c.run("registry", () => { t += 1_500; });
    assert.ok(c.over.has("registry"));
    assert.match(c.line("[x]", "1 coins"), /registry 1500 \(over its 1000 ms budget\)/);
  });

  test("an awaited stage that hangs answers with its fallback at its budget, and the line says so", async () => {
    const c = stageClock({ loopMonitor: false });
    const t0 = Date.now();
    const v = await c.bounded("status", 60, () => never<string>(), () => "last good status");
    assert.equal(v, "last good status");
    assert.ok(Date.now() - t0 < 1_000);
    assert.match(c.line("[x]", "0 coins"), /status \d+ \(over its 60 ms budget\)/);
    assert.equal(await c.bounded("rehearsal", 1_000, async () => "fresh", () => "old"), "fresh", "a stage inside its budget answers itself");
    assert.equal(await c.bounded("x", 1_000, async () => { throw new Error("rpc down"); }, () => "old", { onError: () => "failed" }), "failed");
    await assert.rejects(c.bounded("y", 1_000, async () => { throw new Error("rpc down"); }, () => "old"), /rpc down/, "with no onError the failure is the caller's");
  });

  test("budget store: the time spent in the request budget's synchronous writes is counted", () => {
    const r = openRegistry(":memory:");
    const before = budgetStoreSyncMs();
    statusTableStore(r.db).add("apiBudget.day.web.test", "2026-10-20", 3, Date.now());
    assert.ok(budgetStoreSyncMs() > before);
  });
});

describe("coin reads under one deadline (boundedReads.ts)", () => {
  test("a read that hangs is served from its last good read inside the deadline, marked with that read's time", async () => {
    const scope = {};
    const first = await readCoinsBounded([{ key: "lite:A", read: async () => ({ burned: "10" }) }], { concurrency: 6, deadlineMs: 1_000, scope });
    assert.equal(first[0].state, "fresh");
    const t0 = Date.now();
    const r = await readCoinsBounded([{ key: "lite:A", read: () => never<{ burned: string }>() }, { key: "lite:B", read: async () => ({ burned: "2" }) }], { concurrency: 6, deadlineMs: 80, scope });
    assert.ok(Date.now() - t0 < 1_000, `finished in ${Date.now() - t0} ms`);
    assert.equal(r[0].state, "earlier");
    assert.deepEqual(r[0].state === "earlier" && r[0].value, { burned: "10" }, "the last good values, never invented ones");
    assert.equal(r[0].state === "earlier" && r[0].why, "late");
    assert.equal(r[1].state, "fresh", "the other coins are not held by the late one");
    assert.match(earlierReadsNote([{ ticker: "AAA", r: r[0] }, { ticker: "BBB", r: r[1] }], Date.now()), /^1 coin from an earlier read \(AAA 0 min\)$/);
  });

  test("with no earlier read a late coin is a failure (each route already says so), and it may wait the longer cold deadline first", async () => {
    const scope = {};
    const t0 = Date.now();
    const r = await readCoinsBounded([{ key: "lite:C", read: () => never<number>() }], { concurrency: 6, deadlineMs: 30, coldDeadlineMs: 150, scope });
    const took = Date.now() - t0;
    assert.equal(r[0].state, "failed");
    assert.ok(r[0].state === "failed" && r[0].error instanceof ReadLateError);
    assert.ok(took >= 140 && took < 1_000, `waited the cold deadline (${took} ms)`);
    const slow = await readCoinsBounded([{ key: "lite:D", read: async () => { await sleep(60); return 7; } }], { concurrency: 6, deadlineMs: 20, coldDeadlineMs: 500, scope });
    assert.deepEqual(slow[0], { state: "fresh", value: 7, at: (slow[0] as { at: number }).at }, "a first read slower than the warm deadline still lands");
  });

  test("a late read keeps running and becomes the coin's last good read; the next build joins it instead of reading again", async () => {
    const scope = {};
    await readCoinsBounded([{ key: "full:E", read: async () => 1 }], { concurrency: 6, deadlineMs: 500, scope });
    let release!: (v: number) => void, reads = 0;
    const slow = () => { reads++; return new Promise<number>((ok) => { release = ok; }); };
    const a = await readCoinsBounded([{ key: "full:E", read: slow }], { concurrency: 6, deadlineMs: 30, scope });
    assert.equal(a[0].state, "earlier");
    const b = readCoinsBounded([{ key: "full:E", read: slow }], { concurrency: 6, deadlineMs: 500, scope });
    await sleep(10);
    release(2);
    const r = await b;
    assert.equal(reads, 1, "one read per coin at a time");
    // audit 7 review: the joined read was started by the earlier build, so it is served as earlier (why "joined"), never as fresh
    assert.deepEqual(r[0].state === "earlier" && [r[0].why, r[0].value], ["joined", 2]);
    assert.equal(keptRead<number>("full:E", scope)?.value, 2);
  });

  test("a read that fails uses the last good read; at most `concurrency` new reads run at once", async () => {
    const scope = {};
    await readCoinsBounded([{ key: "k:1", read: async () => "good" }], { concurrency: 1, deadlineMs: 500, scope });
    const failed = await readCoinsBounded([{ key: "k:1", read: async () => { throw new Error("429"); } }], { concurrency: 1, deadlineMs: 500, scope });
    assert.equal(failed[0].state === "earlier" && failed[0].why, "failed");
    let running = 0, peak = 0;
    const read = async () => { running++; peak = Math.max(peak, running); await sleep(10); running--; return 1; };
    await readCoinsBounded(Array.from({ length: 10 }, (_, i) => ({ key: `n:${i}`, read })), { concurrency: 3, deadlineMs: 1_000, scope });
    assert.equal(peak, 3);
    clearBoundedReads(scope);
    assert.equal(keptRead("k:1", scope), undefined);
  });

  test("'read N minutes ago'", () => {
    const now = Date.parse("2026-10-20T10:00:00Z");
    assert.equal(readAgoText(now - 20_000, now), "read moments ago");
    assert.equal(readAgoText(now - 60_000, now), "read 1 minute ago");
    assert.equal(readAgoText(now - 3 * 60_000, now), "read 3 minutes ago");
    assert.equal(readAgoText(now - 3 * 3_600_000, now), "read 3 hours ago");
  });
});

describe("a coin whose chain read hangs (the real coin read, server.ts tokenPageData)", () => {
  test("is served from its last good read inside the budget, with the same values", async () => {
    const w = await makeWorld();
    const scope = {};
    const lite = (p: Platform) => readCoinsBounded([w.bronco, w.deficit].map((t) => ({ key: `lite:${t.mint}`, read: () => tokenPageData(p, t, Date.now(), { lite: true }) })), { concurrency: 6, deadlineMs: 150, scope });
    const fresh = await lite(w.p);
    assert.ok(fresh.every((r) => r.state === "fresh"));
    // the bronco coin's supply read now never answers (a hung RPC request)
    const program = new Proxy(w.p.program, { get(t, k, r) { if (k === "supplyRaw") return (mint: string) => (mint === w.bronco.mint ? never<bigint>() : t.supplyRaw(mint)); const v = Reflect.get(t, k, r); return typeof v === "function" ? v.bind(t) : v; } });
    const t0 = Date.now();
    const again = await lite({ ...w.p, program });
    assert.ok(Date.now() - t0 < 1_000, `finished in ${Date.now() - t0} ms`);
    assert.equal(again[0].state, "earlier");
    assert.equal(again[1].state, "fresh");
    const was = fresh[0].state === "fresh" ? fresh[0].value : null, now = again[0].state === "earlier" ? again[0].value : null;
    assert.deepEqual(now?.status.burned, was?.status.burned);
    assert.deepEqual(now?.receipts, was?.receipts);
  });

  test("the home build finishes inside its budget with the last good values and names the late coin on its line", async () => {
    setListBuildBudgetsForTests({ batchMs: 200, chainMs: 200, chainColdMs: 3_000, statusMs: 200, rehearsalMs: 200 });
    const lines: string[] = [];
    const info = console.info;
    console.info = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
    const real = Date.now;
    try {
      const w = await makeWorld();
      const { GET } = await import("../src/app/api/burnticker/home/route.ts");
      assert.equal((await GET(new Request("http://localhost/"))).status, 200, "the first build (every coin read fresh)");
      assert.match(lines.at(-1) ?? "", /^\[burnticker\/home\] built in \d+ ms, \d+ coins: registry \d+, batch \d+.*, chain \d+.*; cpu \d+ ms, loop max \d+ ms, budget store \d+ ms/);
      const program = new Proxy(w.p.program, { get(t, k, r) { if (k === "supplyRaw") return (mint: string) => (mint === w.bronco.mint ? never<bigint>() : t.supplyRaw(mint)); const v = Reflect.get(t, k, r); return typeof v === "function" ? v.bind(t) : v; } });
      setPlatformForTests({ ...w.p, program } as Platform);
      const n = lines.length;
      Date.now = () => real() + 20_000;   // past the 15 s memo window: the answer is served and a rebuild starts behind it
      assert.equal((await GET(new Request("http://localhost/"))).status, 200);
      for (let i = 0; i < 100 && lines.length === n; i++) await sleep(20);
      const line = lines.at(-1) ?? "";
      assert.ok(lines.length > n, "the rebuild finished");
      const took = Number(/built in (\d+) ms/.exec(line)?.[1]);
      assert.ok(took < 1_500, `the rebuild took ${took} ms with one coin's read hung (chain budget 200 ms): ${line}`);
      assert.match(line, /chain \d+ \(over its 200 ms budget\)/);
      assert.match(line, /1 coin from an earlier read \(BRONCO 0 min\)/);
      const body = await (await GET(new Request("http://localhost/"))).json() as { upcoming?: { omitted?: { ticker: string }[] } };
      assert.ok(!(body.upcoming?.omitted ?? []).some((o) => o.ticker === "BRONCO"), "the late coin is not dropped: its last good read stands");
    } finally { Date.now = real; console.info = info; setListBuildBudgetsForTests(); }
    assert.equal(LIST_BUILD_BUDGETS.chainMs, 6_000, "the defaults are back");
  });
});

describe("inner reads: one at a time per coin, and no request without an end", () => {
  test("two callers asking for one mint's holders at once share one read", async () => {
    clearHoldersCache();
    let calls = 0;
    const rpc = { call: async <T>(method: string): Promise<T> => { calls++; await sleep(20); throw new Error(`${method}: rate-limited by the RPC`); } };
    const mint = "So11111111111111111111111111111111111111112";
    const [a, b] = await Promise.all([readHolders(rpc, { cluster: "mainnet", mint }), readHolders(rpc, { cluster: "mainnet", mint })]);
    assert.equal(a.state, "unavailable"); assert.deepEqual(a, b);
    assert.equal(calls, 1, "the second caller joined the first read");
    clearHoldersCache();
  });

  test("the web's read-only RPC connections end a request the RPC never answers (budgetedRpcConfig timeoutMs)", async () => {
    const realFetch = globalThis.fetch;
    let sawSignal = false;
    globalThis.fetch = ((_: unknown, init?: { signal?: AbortSignal }) => new Promise((_ok, no) => { sawSignal = !!init?.signal; if (init?.signal?.aborted) { no(init.signal.reason); return; } init?.signal?.addEventListener("abort", () => no(init.signal!.reason)); })) as typeof fetch;
    try {
      const cfg = budgetedRpcConfig({ commitment: "confirmed" as const }, { timeoutMs: 50 });
      const t0 = Date.now();
      await assert.rejects(cfg.fetch("https://rpc.example.invalid/", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [] }) }), /abort|timeout/i);
      assert.ok(sawSignal && Date.now() - t0 < 1_000);
      const own = new AbortController();
      const p = budgetedRpcConfig({}, { timeoutMs: 10_000 }).fetch("https://rpc.example.invalid/", { method: "POST", body: "{}", signal: own.signal });
      own.abort(new Error("caller's own abort"));
      await assert.rejects(p, /caller's own abort/, "a caller's own signal is kept");
    } finally { globalThis.fetch = realFetch; }
  });
});
