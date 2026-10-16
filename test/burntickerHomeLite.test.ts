// 2026-10-15: the home's lighter coin read (server.ts tokenPageInput `lite`), the coin route's per-mint memo (keyedSwr.ts) and the wallet
// connection's websocket (walletShell.ts walletWsEndpoint). The identity test reads one live coin both ways over the same fixture chain
// (a LaunchLab pool, three holders, a dated create transaction) and holds every field the home renders equal.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { tokenPageData, tokenPageInput } from "@/lib/burnticker/server";
import { buildPlatformIndex } from "@/lib/burnticker/tokenPage";
import { homeRowOf } from "@/lib/burnticker/homeRow";
import { clearMarketCache, decodeLaunchLabPool } from "@/lib/burnticker/market";
import { clearHoldersCache } from "@/lib/burnticker/holders";
import { clearLifecycleCache } from "@/lib/burnticker/lifecycleDates";
import { launchLabProgramFor } from "@/lib/burnKeeper/launchlab";
import { KeyedSwr } from "@/lib/burnticker/keyedSwr";
import { PUBLIC_WS, walletWsEndpoint } from "@/lib/burnticker/walletShell";
import { APP_CSP_DIRECTIVES } from "@/lib/burnticker/csp";
import { fx, NOW } from "./burntickerHelpers.ts";
import { makeWorld, type World } from "./burntickerApiHelpers.ts";

const FX = fx("launchlab/pools.mainnet.json") as { accounts: Record<string, { owner: string; dataBase64: string }> };
const CURVE_62 = "2RfJmqvLv69fZ1FrNm4jg2owJ7AEsYCDc6tthgtGEeuz";
const LAUNCHLAB_DEVNET = launchLabProgramFor("devnet")!;
const CREATED_AT = 1_759_900_000;
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** The fixture curve, re-pointed at `mint` (mintA at byte 205) and owned by devnet's LaunchLab program. */
function poolFor(mint: string): { owner: PublicKey; data: Buffer } {
  const data = Buffer.from(FX.accounts[CURVE_62].dataBase64, "base64");
  new PublicKey(mint).toBuffer().copy(data, 205);
  return { owner: LAUNCHLAB_DEVNET, data };
}

/** A JSON-RPC over fetch: three holders (DAS), the create transaction, nothing else. */
function rpcFetch(mint: string, calls: string[]): typeof fetch {
  return (async (_url: unknown, init?: { body?: string }) => {
    const { method, params } = JSON.parse(init?.body ?? "{}") as { method: string; params: unknown[] };
    calls.push(method);
    let result: unknown = null;
    if (method === "getAccountInfo") { const d = Buffer.alloc(82); d.writeBigUInt64LE(BigInt("1000000000000000"), 36); d[44] = 6; d[45] = 1; result = { context: { slot: 7 }, value: { owner: TOKEN_PROGRAM, data: [d.toString("base64"), "base64"] } }; }
    else if (method === "getTokenAccounts") result = { token_accounts: [1, 2, 3].map((k) => ({ owner: new PublicKey(Buffer.alloc(32, k)).toBase58(), address: new PublicKey(Buffer.alloc(32, 10 + k)).toBase58(), amount: String(1000 * k), mint })) };
    else if (method === "getTransaction") result = { slot: 7, blockTime: CREATED_AT, meta: { err: null, logMessages: [`Program ${LAUNCHLAB_DEVNET.toBase58()} invoke [1]`, "Program log: Instruction: InitializeV2", `Program ${LAUNCHLAB_DEVNET.toBase58()} success`] }, transaction: { message: { accountKeys: [mint] } } };
    else if (method === "getSignaturesForAddress") result = [];
    void params;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("the home's lite coin read (2026-10-15)", () => {
  let w: World;
  const realFetch = globalThis.fetch;
  const rpcCalls: string[] = [];
  const counts = { feePda: 0, vault: 0, lockFees: 0, pairOf: 0, poolReads: 0 };
  before(async () => {
    w = await makeWorld();
    globalThis.fetch = rpcFetch(w.deficit.mint, rpcCalls);
    w.p.market = {
      async getAccountInfo(pk: PublicKey) { counts.poolReads++; return pk.toBase58() === w.deficit.poolId ? poolFor(w.deficit.mint) : null; },
      async getTokenLargestAccounts() { return { value: [] }; },
      async getMultipleParsedAccounts() { return { value: [] }; },
    } as never;
    const prog = w.program as unknown as Record<string, (...a: unknown[]) => unknown>;
    const fee = prog.feePdaBalanceLamports.bind(w.program), vault = prog.vaultBalanceRaw.bind(w.program);
    prog.feePdaBalanceLamports = (...a) => { counts.feePda++; return fee(...a); };
    prog.vaultBalanceRaw = (...a) => { counts.vault++; return vault(...a); };
    const reg = w.registry as unknown as Record<string, (...a: unknown[]) => unknown>;
    const claims = reg.lockFeeClaims.bind(w.registry), pairOf = reg.pairOf.bind(w.registry);
    reg.lockFeeClaims = (...a) => { counts.lockFees++; return claims(...a); };
    reg.pairOf = (...a) => { counts.pairOf++; return pairOf(...a); };
  });
  after(() => { globalThis.fetch = realFetch; w.p.market = null; });
  const fresh = () => { clearMarketCache(); clearHoldersCache(); clearLifecycleCache(); rpcCalls.length = 0; for (const k of Object.keys(counts) as (keyof typeof counts)[]) counts[k] = 0; };

  test("the lite input leaves out the graduated pool, the balances, the LP lock and the pair side, and reads none of them", async () => {
    fresh();
    const i = await tokenPageInput(w.p, w.deficit, NOW, { lite: true });
    assert.equal(i.cpmm, null); assert.equal(i.pair, null); assert.equal(i.lp, undefined);
    assert.equal(i.chain.feePdaLamports, null); assert.equal(i.chain.vaultRaw, null);
    assert.deepEqual({ feePda: counts.feePda, vault: counts.vault, lockFees: counts.lockFees, pairOf: counts.pairOf }, { feePda: 0, vault: 0, lockFees: 0, pairOf: 0 });
    // what the home renders is still read: the curve, the holders and the create date
    assert.ok(i.market?.pool, "the curve is read"); assert.equal(i.holders?.state, "read"); assert.equal(i.dates?.created.state, "read");
    fresh();
    const full = await tokenPageInput(w.p, w.deficit, NOW);
    assert.ok(full.lp, "the coin page still reads the LP lock"); assert.ok(counts.feePda > 0 && counts.lockFees > 0 && counts.pairOf > 0, "the coin page reads everything");
  });

  test("every field the home renders is the same from the lite read as from the full one (card, activity, readiness, slot, next row, totals)", async () => {
    fresh();
    const full = await tokenPageData(w.p, w.deficit, NOW);
    fresh();
    const lite = await tokenPageData(w.p, w.deficit, NOW, { lite: true });
    const a = homeRowOf(full.status, full.receipts, "DEFICIT2", w.deficit.mint), b = homeRowOf(lite.status, lite.receipts, "DEFICIT2", w.deficit.mint);
    assert.deepEqual(b, a);
    // the fixture is not trivial: a curve, a holder count and a created date read on chain
    assert.equal(a.coin.holders, 3); assert.equal(a.coin.launchedAt, new Date(CREATED_AT * 1000).toISOString()); assert.equal(a.coin.phase, "curve");
    assert.ok(a.coin.progressPct !== null && a.coin.raised !== null, "curve read"); assert.ok(a.upcoming, "next-result row");
    const ix = (s: typeof full.status) => buildPlatformIndex([s], NOW, null);
    assert.deepEqual(ix(lite.status).totals, ix(full.status).totals);
    // the page-only blocks differ (the reason the coin page never reads lite)
    assert.ok(decodeLaunchLabPool(new Uint8Array(poolFor(w.deficit.mint).data)));
    assert.notDeepEqual(lite.status.pool.feePdaSol, full.status.pool.feePdaSol);
  });

  test("the home route reads every coin lite and logs its build time", () => {
    const src = fs.readFileSync("src/app/api/burnticker/home/route.ts", "utf8");
    assert.match(src, /tokenPageData\(p, t, now, \{ lite: true \}\)/);
    assert.match(src, /console\.info\(`\[burnticker\/home\] built in \$\{Date\.now\(\) - started\} ms, \$\{n\} coins`\)/);
    assert.match(src, /const HOME_MEMO_MS = 15_000/, "the stale-while-revalidate memo stays");
    assert.match(src, /homeRowOf\(d\.status, d\.receipts, key, t\.mint\)/, "the route and this test share one per-coin derivation");
    assert.doesNotMatch(fs.readFileSync("src/app/burnticker/t/[ticker]/page.tsx", "utf8"), /lite/, "the coin page reads in full");
  });

  test("the tokens index (the coins grid) reads six at a time, keeps its last answer, and the page retries a cold 503 (owner 2026-10-15: 'the coins tab is still slow')", () => {
    const src = fs.readFileSync("src/app/api/burnticker/tokens/route.ts", "utf8");
    assert.match(src, /allLimited\(tokens\.map\(\(t\) => \(\) => tokenPageData\(p, t, now\)\), INDEX_CONCURRENCY\)/, "parallel full reads (the pairs tab needs the pair side)");
    assert.match(src, /const INDEX_MEMO_MS = 15_000, INDEX_COLD_WAIT_MS = 15_000, INDEX_CONCURRENCY = 6/);
    assert.match(src, /code: "index-loading", retryAfterSec: 5/);
    assert.doesNotMatch(src, /for \(const t of withoutTestCoins[\s\S]*await tokenPageData/, "no serial per-coin loop");
    assert.match(fs.readFileSync("src/app/burnticker/CoinsIndex.tsx", "utf8"), /r\.status === 503 && left > 0/, "the grid waits for retry-after and asks again");
    // the deploy script is private (not in the public tree)
    if (fs.existsSync("scripts/ops/publish-and-deploy.sh")) assert.match(fs.readFileSync("scripts/ops/publish-and-deploy.sh", "utf8"), /\/api\/burnticker\/tokens /, "the deploy probe warms the index");
  });
});

describe("the coin route's memo (keyedSwr.ts, 2026-10-15)", () => {
  const deferred = () => { let ok!: (v: string) => void, no!: (e: unknown) => void; const p = new Promise<string>((a, b) => { ok = a; no = b; }); return { p, ok, no }; };

  test("a second read is served at once; past freshMs it is served and refreshed once in the background", async () => {
    let t = 0, builds = 0;
    const m = new KeyedSwr<string>({ freshMs: 15_000, coldWaitMs: 1_000 }, () => t);
    const build = async () => `v${++builds}`;
    assert.deepEqual(await m.get("A", "1", build), { value: "v1", state: "cold", ageMs: 0 });
    assert.equal((await m.get("A", "1", build))!.state, "hit"); assert.equal(builds, 1);
    t = 16_000;
    const r = await m.get("A", "1", build);
    assert.equal(r!.value, "v1"); assert.equal(r!.state, "hit");
    await m.get("A", "1", build); // in flight: no second refresh
    await new Promise((ok) => setImmediate(ok));
    assert.equal(builds, 2);
    assert.equal((await m.get("A", "1", build))!.value, "v2");
  });

  test("a new version (a launch, a receipt) waits for a fresh build; a slow one serves the old answer, a first one answers null", async () => {
    const m = new KeyedSwr<string>({ freshMs: 15_000, coldWaitMs: 20 });
    await m.get("A", "1", async () => "old");
    assert.deepEqual((await m.get("A", "2", async () => "new"))!.value, "new");
    const slow = deferred();
    const r = await m.get("A", "3", () => slow.p);
    assert.equal(r!.state, "stale-version"); assert.equal(r!.value, "new");
    slow.ok("newest"); await slow.p; await new Promise((ok) => setImmediate(ok));
    assert.equal((await m.get("A", "3", async () => "x"))!.value, "newest");
    const never = deferred();
    assert.equal(await m.get("B", "1", () => never.p), null, "nothing to serve within the cold wait: the route answers 503");
  });

  test("one refresh per key; a failed first build throws to the caller; at most maxKeys answers are kept", async () => {
    let builds = 0;
    const m = new KeyedSwr<string>({ freshMs: 15_000, coldWaitMs: 1_000, maxKeys: 2 });
    const d = deferred();
    const both = Promise.all([m.get("A", "1", () => { builds++; return d.p; }), m.get("A", "1", () => { builds++; return d.p; })]);
    d.ok("a"); await both; assert.equal(builds, 1);
    await assert.rejects(m.get("F", "1", async () => { throw new Error("rpc down"); }), /rpc down/);
    await m.get("B", "1", async () => "b"); await m.get("C", "1", async () => "c");
    assert.equal(m.size(), 2);
  });

  test("the coin route keeps its answer per mint, keyed by the registry's page version, and the rule file needs no chain read", () => {
    const src = fs.readFileSync("src/app/api/burnticker/tokens/[ticker]/route.ts", "utf8");
    assert.match(src, /const COIN_MEMO_MS = 15_000/);
    assert.match(src, /memoFor\(p\.registry\)\.get\(t\.mint, p\.registry\.pageVersion\(t\.mint\), build\)/);
    assert.match(src, /new Response\(t\.rulesJson,/);
    assert.match(src, /"cache-control": "no-store"/, "the browser never caches the coin's answer");
    assert.match(fs.readFileSync("src/app/burnticker/t/[ticker]/page.tsx", "utf8"), /j\?\.code === "coin-loading"/, "the coin page asks again after a 503");
  });

  test("the registry's page version changes with a new receipt and a launch, and not with a plain read", async () => {
    const w = await makeWorld();
    const v0 = w.registry.pageVersion(w.bronco.mint);
    assert.equal(w.registry.pageVersion(w.bronco.mint), v0);
    w.registry.db.prepare("INSERT INTO burns (mint, event_id, settled_at, units, kind, note, carry_in, carry_out, status, created_at, updated_at) VALUES (?, 'new-event', '2026-10-15T00:00:00Z', 1, 'binary', '', '0', '0', 'planned', ?, ?)").run(w.bronco.mint, NOW + 1, NOW + 1);
    const v1 = w.registry.pageVersion(w.bronco.mint);
    assert.notEqual(v1, v0);
    // a draft going live: the launch writes the row's status and launch transaction
    const b = w.bronco, mint = new PublicKey(Buffer.alloc(32, 99)).toBase58();
    w.registry.register({ mint, ticker: "NEWC", name: "NEWC coin", creator: b.creator, description: b.description, imageUrl: null, links: [], rulesText: b.rulesJson, feePda: b.feePda, vault: b.vault, tokenConfig: null, poolId: b.poolId, launchTx: null, cluster: "devnet", platformId: null, baselineAt: b.baselineAt, status: "draft" }, NOW);
    const d0 = w.registry.pageVersion(mint);
    w.registry.markLaunched(mint, "launchNEWC", b.poolId, b.baselineAt);
    assert.notEqual(w.registry.pageVersion(mint), d0);
  });
});

describe("the wallet connection's websocket (2026-10-15: \"ws error\" on every page)", () => {
  const connect = APP_CSP_DIRECTIVES.find(([d]) => d === "connect-src")![1];

  test("with the site's HTTP-only RPC proxy set, subscriptions go to the public cluster's wss, an origin the CSP allows", () => {
    const env = { NEXT_PUBLIC_BURNTICKER_RPC_URL: "https://burnticker.com/api/burnticker/rpc" };
    for (const c of ["mainnet", "devnet"]) {
      const ws = walletWsEndpoint(c, env)!;
      assert.equal(ws, PUBLIC_WS[c]); assert.match(ws, /^wss:\/\//);
      assert.ok(connect.includes(new URL(ws).origin.replace(/^https?:/, "wss:")) || connect.includes(ws), `${ws} is in connect-src`);
    }
    assert.equal(walletWsEndpoint("mainnet", {}), undefined, "without the proxy the endpoint is the public RPC and web3.js derives its wss");
  });

  test("the shell's ConnectionProvider passes the wsEndpoint and keeps the confirmed commitment", () => {
    const src = fs.readFileSync("src/app/burnticker/_components/ShellWalletProviders.tsx", "utf8");
    assert.match(src, /<ConnectionProvider endpoint=\{endpoint\} config=\{config\}>/);
    assert.match(src, /walletWsEndpoint\(cluster,/);
    assert.match(src, /\{ commitment: "confirmed" as const, wsEndpoint \}/);
  });

  test("nothing in the app subscribes except confirmTransaction (SignCard), which uses the websocket", () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) files.push(p); } };
    walk("src/app/burnticker"); walk("src/lib/burnticker");
    const subs = files.filter((f) => /\.(onAccountChange|onSignature|onLogs|onSlotChange|onProgramAccountChange|onRootChange)\(/.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(subs, []);
    assert.deepEqual(files.filter((f) => /confirmTransaction\(/.test(fs.readFileSync(f, "utf8"))), ["src/app/burnticker/launch/SignCard.tsx"]);
  });
});
