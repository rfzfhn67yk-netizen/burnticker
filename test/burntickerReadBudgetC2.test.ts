// 2026-10-15 prelaunch audit C2: anonymous traffic could exhaust the site's daily Helius budget, after which launch confirmations and
// wallet sends failed until 00:00 UTC. The proxy forwarded requests with no Origin, counted requests not calls, and shared the whole
// web slice; the trust page read up to 200 transactions per request with no cache or limit. These tests drive the attack and check
// that the confirm path still works.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ApiBudget, configureApiBudget, memoryStore, resetApiBudget } from "@/lib/burnticker/apiBudget";
import { readFeeLedger, type ChainReader } from "@/lib/burnticker/trust";
import { makeWorld } from "./burntickerApiHelpers.ts";

const T0 = Date.parse("2026-10-15T03:00:00Z");
const clock = () => { let t = T0; return { now: () => t, sleep: async (ms: number) => { t += ms; }, advance: (ms: number) => { t += ms; } }; };
const body = (method: string, n = 1) => JSON.stringify(n === 1 ? { jsonrpc: "2.0", id: 1, method, params: [] } : Array.from({ length: n }, (_, i) => ({ jsonrpc: "2.0", id: i, method, params: [] })));
const proxyReq = (b: string, headers: Record<string, string> = {}) => new Request("https://burnticker.com/api/burnticker/rpc", { method: "POST", headers: { "content-type": "application/json", host: "burnticker.com", "x-forwarded-for": "203.0.113.9", ...headers }, body: b });

describe("the web's Helius day: anonymous traffic cannot spend what a confirmation needs", () => {
  test("every lane stops at its own ceiling; the pages are counted without the reserved lanes; the launch verifier keeps its share", async () => {
    const c = clock();
    const b = new ApiBudget({ role: "web", store: memoryStore(), now: c.now, sleep: c.sleep, maxWaitMs: 1e12 });
    const day = b.dayBudget("helius");
    assert.equal(day, 60_000, "the web's slice: 10M a month at 60%, 0.3 share");
    const spend = async (lane: "proxy" | "flight" | "confirm" | "general", units: number, methods: Record<string, number> = { getBalance: units }) => {
      let n = 0;
      for (;;) { const r = await b.take("helius", { units, requests: 1, lane, methods }); if (r.state !== "ok") break; n += units; if (n > 2 * day) break; }
      return n;
    };
    // an anonymous client hammers the proxy with getSignatureStatuses (essential for the keeper, not for an anonymous proxy caller)
    const proxied = await spend("proxy", 20, { getSignatureStatuses: 20 });
    assert.ok(proxied <= day * 0.35, `the proxy spent ${proxied} of ${day}: its cap is 35%`);
    // token holders (any number of them) stop at the flight lane's 15%
    const flown = await spend("flight", 24);
    assert.ok(flown <= day * 0.15 && flown >= day * 0.15 - 24, `flight lane ${flown}`);
    // the pages still read: the reserved lanes' spend does not count against them
    const pages = await spend("general", 100);
    assert.ok(pages >= day * 0.75 - proxied - 100, `the pages read ${pages} after the proxy's ${proxied} and the flight lane's ${flown}`);
    // the launch verifier's lane is untouched by all of that
    for (const m of ["getTransaction", "getAccountInfo"]) assert.equal((await b.take("helius", { lane: "confirm", methods: { [m]: 1 } })).state, "ok", m);
    const confirmed = await spend("confirm", 50);
    assert.ok(confirmed <= day * 0.10, `confirm lane ${confirmed}`);
    // past every ceiling only the calls that finish a send already in flight pass (and count): never more than the day plus those
    assert.equal((await b.take("helius", { lane: "flight", essential: true, methods: { sendTransaction: 1 } })).state, "ok");
    assert.equal((await b.take("helius", { lane: "confirm", essential: true, methods: { getSignatureStatuses: 1 } })).state, "ok");
    assert.equal((await b.take("helius", { lane: "proxy", essential: true })).state, "hold", "nothing is essential in the proxy lane");
    assert.ok(b.used("helius") <= day + 2, `used ${b.used("helius")} of ${day}`);
  });

  test("takeRpc: past a lane's ceiling the blockhash, the simulation and the transaction reads hold; sendTransaction and getSignatureStatuses pass", async () => {
    const { takeRpc, BudgetHoldError } = await import("@/lib/burnticker/apiBudget");
    const c = clock();
    const b = configureApiBudget({ role: "web", store: memoryStore(), now: c.now, sleep: c.sleep, maxWaitMs: 1e12 });
    try {
      const url = "https://mainnet.helius-rpc.com/?api-key=x";
      while ((await b.take("helius", { units: 1_000, lane: "flight" })).state === "ok") { /* spend the flight lane */ }
      for (const m of ["sendTransaction", "getSignatureStatuses", "getBlockHeight"]) await takeRpc(url, body(m), undefined, { lane: "flight" });
      for (const m of ["getLatestBlockhash", "simulateTransaction", "getTransaction"]) await assert.rejects(takeRpc(url, body(m), undefined, { lane: "flight" }), BudgetHoldError, m);
      await assert.rejects(takeRpc(url, body("getSignatureStatuses"), undefined, { lane: "proxy" }).then(async () => { while (true) await takeRpc(url, body("getSignatureStatuses", 20), undefined, { lane: "proxy" }); }), BudgetHoldError, "an anonymous proxy caller's status poll is held at the proxy's cap");
      // the pages still read: neither lane's spend counts against them
      await takeRpc(url, body("getAccountInfo"));
    } finally { resetApiBudget(); }
  });

  test("the flight lane has its own rate bucket (a quarter of the source's): token holders cannot starve the pages", async () => {
    const c = clock();
    const b = new ApiBudget({ role: "web", store: memoryStore(), now: c.now, sleep: async () => undefined, maxWaitMs: 1_000 });   // time stands still
    let flightOk = 0, generalOk = 0;
    for (let i = 0; i < 200; i++) if ((await b.take("helius", { lane: "flight" })).state === "ok") flightOk++; else break;
    for (let i = 0; i < 200; i++) if ((await b.take("helius", { lane: "general" })).state === "ok") generalOk++; else break;
    assert.ok(flightOk < generalOk, `flight ${flightOk} before busy, general ${generalOk} after it`);
  });

  test("the lane counts survive a restart (the status table)", async () => {
    const c = clock(), store = memoryStore();
    const a = new ApiBudget({ role: "web", store, now: c.now, sleep: c.sleep, maxWaitMs: 1e12 });
    await a.take("helius", { units: 700, lane: "proxy" });
    a.flush();
    const b2 = new ApiBudget({ role: "web", store, now: c.now, sleep: c.sleep, maxWaitMs: 1e12 });
    assert.equal(b2.laneUsed("helius", "proxy"), 700);
    // the keeper's role has no lanes: its whole slice stays ordinary
    const k = new ApiBudget({ role: "keeper", store, now: c.now, sleep: c.sleep });
    assert.equal(k.laneSplit("helius"), null);
  });
});

describe("the RPC proxy route", () => {
  const realFetch = globalThis.fetch;
  let upstream = 0;
  before(async () => {
    await makeWorld();
    globalThis.fetch = (async () => { upstream++; return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }), { status: 200 }); }) as typeof fetch;
  });
  after(() => { globalThis.fetch = realFetch; resetApiBudget(); });

  test("a request with no Origin and no Sec-Fetch-Site is refused before anything is forwarded", async () => {
    const { POST } = await import("@/app/api/burnticker/rpc/route");
    const before = upstream;
    const r = await POST(proxyReq(body("getSlot")));
    assert.equal(r.status, 403);
    assert.equal(upstream, before);
    const cross = await POST(proxyReq(body("getSlot"), { "sec-fetch-site": "cross-site", origin: "https://evil.example" }));
    assert.equal(cross.status, 403);
  });

  test("the per-visitor limit counts calls, not requests: three batches of 20 fill it, the fourth is refused", async () => {
    const { POST } = await import("@/app/api/burnticker/rpc/route");
    const h = { "sec-fetch-site": "same-origin", "x-forwarded-for": "198.51.100.77" };
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await POST(proxyReq(body("getSlot", 20), h))).status);
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  });

  test("a flight token is issued same-origin only, bound to the visitor that minted it, and carries send-path and build calls in the flight lane", async () => {
    const { GET } = await import("@/app/api/burnticker/rpc/flight/route");
    const { POST } = await import("@/app/api/burnticker/rpc/route");
    const { flightTokens } = await import("@/lib/burnticker/rpcFlight");
    const { RPC_FLIGHT_HEADER, RPC_FLIGHT_REFUSED_HEADER } = await import("@/lib/burnticker/rpcProxy");
    const refused = await GET(new Request("https://burnticker.com/api/burnticker/rpc/flight", { headers: { host: "burnticker.com" } }));
    assert.equal(refused.status, 403);
    const mine = { host: "burnticker.com", "sec-fetch-site": "same-origin", "x-forwarded-for": "198.51.100.8" };
    const ok = await GET(new Request("https://burnticker.com/api/burnticker/rpc/flight", { headers: mine }));
    assert.equal(ok.status, 200);
    const { token } = await ok.json() as { token: string };
    const { clientKey } = await import("@/lib/burnticker/api/http");
    const me = clientKey(new Request("https://x/", { headers: mine })), other = clientKey(new Request("https://x/", { headers: { "x-forwarded-for": "198.51.100.9" } }));
    assert.equal(flightTokens.admit(token, JSON.parse(body("getLatestBlockhash")), me), true);
    assert.equal(flightTokens.admit(token, JSON.parse(body("getAccountInfo")), me), true, "the build reads (the lookup table) ride the token too");
    assert.equal(flightTokens.admit(token, JSON.parse(body("getLatestBlockhash")), other), false, "another visitor cannot use it");
    assert.equal(flightTokens.admit(token, JSON.parse(body("getSlot")), me), false, "a read off the send path never rides the token");
    assert.equal(flightTokens.admit(token.slice(0, -2) + "xx", JSON.parse(body("sendTransaction")), me), false, "a forged token");
    // the route names a refused token so the page drops it
    const r = await POST(proxyReq(body("getLatestBlockhash"), { "sec-fetch-site": "same-origin", "x-forwarded-for": "198.51.100.9", [RPC_FLIGHT_HEADER]: token }));
    assert.equal(r.headers.get(RPC_FLIGHT_REFUSED_HEADER), "1");
  });
});

describe("the flight token", () => {
  test("expires, is good for 24 calls, the site mints a bounded number a day, and its ledger is bounded", async () => {
    const { FlightTokens } = await import("@/lib/burnticker/rpcFlight");
    const { FLIGHT_TOKEN_CALLS, FLIGHT_TOKEN_TTL_MS } = await import("@/lib/burnticker/rpcProxy");
    assert.equal(FLIGHT_TOKEN_CALLS, 24);
    const ft = new FlightTokens({ maxTokens: 3, dailyCap: 5 });
    const token = ft.issue("a", T0)!.token;
    let n = 0;
    while (ft.admit(token, { method: "getSignatureStatuses" }, "a", T0) && n < 1_000) n++;
    assert.equal(n, FLIGHT_TOKEN_CALLS);
    const t2 = ft.issue("a", T0)!.token;
    assert.equal(ft.admit(t2, { method: "getBlockHeight" }, "a", T0 + FLIGHT_TOKEN_TTL_MS + 1), false, "expired");
    let minted = 2;
    while (ft.issue("b", T0)) minted++;
    assert.equal(minted, 5, "the site-wide day cap");
    assert.ok(ft.issue("c", T0 + 86_400_000), "a new UTC day mints again");
    for (let i = 0; i < 10; i++) { const t = new FlightTokens({ maxTokens: 3 }); t.admit(t.issue("x", T0)!.token, { method: "getBlockHeight" }, "x", T0); }
    assert.ok(ft.size <= 3);
  });

  test("the browser wrapper adds the token to send-path calls to the proxy only, and never fails a call it cannot get a token for", async () => {
    const { flightFetch, RPC_FLIGHT_HEADER } = await import("@/lib/burnticker/rpcProxy");
    const seen: { url: string; flight: string | null }[] = [];
    let tokenOk = true;
    const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/burnticker/rpc/flight")) return tokenOk ? new Response(JSON.stringify({ token: "tok", expiresAt: T0 + 600_000 }), { status: 200 }) : new Response("{}", { status: 429 });
      seen.push({ url, flight: new Headers(init?.headers).get(RPC_FLIGHT_HEADER) });
      return new Response("{}", { status: 200 });
    }) as (i: RequestInfo | URL, n?: RequestInit) => Promise<Response>;
    const f = flightFetch(base, { now: () => T0, always: true });
    await f("https://burnticker.com/api/burnticker/rpc", { method: "POST", body: body("getLatestBlockhash") });
    await f("https://burnticker.com/api/burnticker/rpc", { method: "POST", body: body("getSlot") });
    await f("https://api.mainnet-beta.solana.com/", { method: "POST", body: body("sendTransaction") });
    assert.deepEqual(seen.map((s) => s.flight), ["tok", null, null]);
    tokenOk = false;
    const g = flightFetch(base, { now: () => T0, always: true });
    const r = await g("https://burnticker.com/api/burnticker/rpc", { method: "POST", body: body("sendTransaction") });
    assert.equal(r.status, 200);
    assert.equal(seen.at(-1)?.flight, null);
    // a token the proxy names as refused is dropped and a fresh one is asked for on the next send-path call
    let mints = 0, refuse = true;
    const base2 = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/burnticker/rpc/flight")) { mints++; return new Response(JSON.stringify({ token: `tok${mints}`, expiresAt: T0 + 600_000 }), { status: 200 }); }
      seen.push({ url: String(input), flight: new Headers(init?.headers).get(RPC_FLIGHT_HEADER) });
      return new Response("{}", { status: 200, headers: refuse ? { "x-burnticker-flight-refused": "1" } : {} });
    }) as (i: RequestInfo | URL, n?: RequestInit) => Promise<Response>;
    let t2 = T0;
    const h = flightFetch(base2, { now: () => t2, always: true });
    await h("https://burnticker.com/api/burnticker/rpc", { method: "POST", body: body("sendTransaction") });
    refuse = false;
    t2 += 2 * 60_000 + 1;   // a refused token is not replaced for two minutes
    await h("https://burnticker.com/api/burnticker/rpc", { method: "POST", body: body("sendTransaction") });
    assert.equal(mints, 2);
    assert.equal(seen.at(-1)?.flight, "tok2");
  });
});

describe("the trust page", () => {
  test("the fee ledger reads each landed transaction once (a kept read), not on every request", async () => {
    let txReads = 0;
    const sigs = Array.from({ length: 200 }, (_, i) => ({ signature: `sig${i}`, slot: i, blockTime: 1_760_000_000 + i }));
    const reader: ChainReader = { accountData: async () => null, signaturesFor: async () => sigs, lamportsDelta: async () => { txReads++; return { delta: BigInt(5), counterparty: null, memo: null }; } };
    const cache = new Map();
    const a = await readFeeLedger(reader, "Wa11et1111111111111111111111111111111111111", 200, { deltaCache: cache });
    const b = await readFeeLedger(reader, "Wa11et1111111111111111111111111111111111111", 200, { deltaCache: cache });
    assert.equal(txReads, 200, "200 on the first read, none on the second");
    assert.deepEqual(a, b);
  });

  test("the route is kept (stale while revalidate) and rate limited", async () => {
    await makeWorld();
    const { GET } = await import("@/app/api/burnticker/trust/route");
    const req = () => new Request("https://burnticker.com/api/burnticker/trust", { headers: { "x-forwarded-for": "192.0.2.44" } });
    const first = await GET(req());
    assert.equal(first.status, 200);
    const second = await GET(req());
    assert.equal(second.headers.get("x-trust-memo"), "hit");
    let limited = 0;
    for (let i = 0; i < 200; i++) if ((await GET(req())).status === 429) limited++;
    assert.ok(limited > 0, "a client past the read bucket is refused");
  });
});

describe("the re-review (round 3)", () => {
  test("a token holder whose flight lane is spent is served in the proxy lane, not refused, and told to drop the token", async () => {
    const w = await makeWorld();
    void w;
    const c = clock();
    const b = configureApiBudget({ role: "web", store: memoryStore(), now: c.now, sleep: c.sleep, maxWaitMs: 1e12, enforce: true });
    const realFetch = globalThis.fetch, realRpc = process.env.BURNTICKER_RPC_URL;
    process.env.BURNTICKER_RPC_URL = "https://devnet.helius-rpc.com/?api-key=test";   // the keyed plan (the lanes are the keyed plan's)
    globalThis.fetch = (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }), { status: 200 })) as typeof fetch;
    try {
      while ((await b.take("helius", { units: 1_000, lane: "flight" })).state === "ok") { /* spend the flight lane */ }
      const { flightTokens } = await import("@/lib/burnticker/rpcFlight");
      const { clientKey } = await import("@/lib/burnticker/api/http");
      const { RPC_FLIGHT_HEADER, RPC_FLIGHT_REFUSED_HEADER } = await import("@/lib/burnticker/rpcProxy");
      const h = { "sec-fetch-site": "same-origin", "x-forwarded-for": "198.51.100.150" };
      const token = flightTokens.issue(clientKey(new Request("https://x/", { headers: h })))!.token;
      const { POST } = await import("@/app/api/burnticker/rpc/route");
      const r = await POST(proxyReq(body("getLatestBlockhash"), { ...h, [RPC_FLIGHT_HEADER]: token }));
      assert.equal(r.status, 200, "served in the proxy lane");
      assert.equal(r.headers.get(RPC_FLIGHT_REFUSED_HEADER), "1");
    } finally { globalThis.fetch = realFetch; if (realRpc === undefined) delete process.env.BURNTICKER_RPC_URL; else process.env.BURNTICKER_RPC_URL = realRpc; resetApiBudget(); }
  });

  test("the browser attaches the token only while a send is under way, and waits two minutes after a failed mint", async () => {
    const { flightFetch, withFlight, RPC_FLIGHT_HEADER, FLIGHT_RETRY_AFTER_MS } = await import("@/lib/burnticker/rpcProxy");
    let t = T0, mints = 0, mintOk = false;
    const seen: (string | null)[] = [];
    const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/burnticker/rpc/flight")) { mints++; return mintOk ? new Response(JSON.stringify({ token: "tok", expiresAt: t + 600_000 }), { status: 200 }) : new Response("{}", { status: 503 }); }
      seen.push(new Headers(init?.headers).get(RPC_FLIGHT_HEADER));
      return new Response("{}", { status: 200 });
    }) as (i: RequestInfo | URL, n?: RequestInit) => Promise<Response>;
    const f = flightFetch(base, { now: () => t });
    const call = () => f("https://burnticker.com/api/burnticker/rpc", { method: "POST", body: body("getAccountInfo") });
    await call();   // a passive read (the swap panel's refresh): no token, no mint
    assert.deepEqual([seen.at(-1), mints], [null, 0]);
    await withFlight(async () => { await call(); await call(); });   // the mint fails: one try, then no re-mint for two minutes
    assert.equal(mints, 1);
    mintOk = true;
    await withFlight(call);
    assert.equal(mints, 1, "still inside the two minutes");
    t += FLIGHT_RETRY_AFTER_MS + 1;
    await withFlight(call);
    assert.deepEqual([mints, seen.at(-1)], [2, "tok"]);
    await call();
    assert.equal(seen.at(-1), null, "the send is over: passive reads carry no token");
  });

  test("a launch confirmation with a signature the chain does not hold costs one read a minute, not one per press", async () => {
    const w = await makeWorld();
    const { markLaunched, MISSING_MEMORY_MS } = await import("@/lib/burnticker/api/handlers");
    const { Keypair } = await import("@solana/web3.js");
    const proto = w.bronco, mint = Keypair.generate().publicKey.toBase58();
    w.registry.register({ mint, ticker: "MISS", name: "miss", creator: proto.creator, description: "a test", imageUrl: null, links: [], rulesText: proto.rulesJson, feePda: Keypair.generate().publicKey.toBase58(), vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2026-09-01T00:00:00Z", status: "draft" }, Date.now());
    let reads = 0;
    w.p.launchVerifier = { verify: async () => { reads++; return { ok: false as const, status: 404 as const, reason: "no confirmed transaction with this signature on this cluster (yet)" }; } };
    const sig = "5".repeat(88), now = Date.now();
    for (let i = 0; i < 5; i++) assert.equal((await markLaunched(w.p, mint, sig, now + i * 1_000, "c1")).status, 404);
    assert.equal(reads, 1);
    await markLaunched(w.p, mint, sig, now + MISSING_MEMORY_MS + 1, "c1");
    assert.equal(reads, 2, "read again after the minute");
  });
});
