// 2026-10-15 prelaunch audit M7: the index (/api/burnticker/tokens) and home (/api/burnticker/home) rebuilds re-read every registry row
// from the chain, drafts and expired drafts included, one account at a time. A counting chain stub measures one cold rebuild of each
// with the audit's mix (6 live coins, 12 drafts, 5 expired drafts): drafts and expired drafts cost nothing, the live coins' accounts come
// from one batch read, and a warm rebuild (inside the TTLs) reads only the uncached per-coin facts.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { NOW } from "./burntickerHelpers.ts";
import { ATTESTER, makeWorld, type World } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { clearMarketCache } from "@/lib/burnticker/market";
import { clearHoldersCache } from "@/lib/burnticker/holders";
import { clearLifecycleCache } from "@/lib/burnticker/lifecycleDates";

type Counts = Record<string, number>;
const total = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);

describe("the coin list's chain reads (prelaunch audit M7)", () => {
  let w: World;
  const counts: Counts = {};
  const hit = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
  const reset = () => { for (const k of Object.keys(counts)) delete counts[k]; clearMarketCache(); clearHoldersCache(); clearLifecycleCache(); };
  const realFetch = globalThis.fetch;
  const LIVE = 6, DRAFTS = 12, EXPIRED = 5;
  const mintsByStatus: Record<string, string[]> = { live: [], draft: [], expired: [] };

  before(async () => {
    w = await makeWorld();
    const proto = w.bronco;
    const reg = async (status: "live" | "draft", i: number, at: number) => {
      const ticker = `${status === "live" ? "L" : "D"}${i}${at === NOW ? "" : "X"}`;
      if (status === "live") {
        // a live coin is initialised in the fake program, as makeWorld's are
        const b = await buildLaunchBundle({ creator: proto.creator, ticker, name: `${ticker} coin`, description: "a test", imageUrl: null, links: [], rule: BRONCOS, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program: w.program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
        const t = w.registry.register({ mint: b.mint, ticker, name: b.name, creator: proto.creator, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt: "2026-09-01T00:00:00Z", status: "draft" }, at);
        w.registry.markLaunched(t.mint, `launch${ticker}`, b.addresses.poolId, "2026-09-01T00:00:00Z");
        w.program.supplies.set(t.mint, BigInt("1000000000000000"));
        return t.mint;
      }
      const mint = Keypair.generate().publicKey.toBase58();
      w.registry.register({ mint, ticker, name: `coin ${i}`, creator: proto.creator, description: "a test", imageUrl: null, links: [], rulesText: proto.rulesJson,
        feePda: Keypair.generate().publicKey.toBase58(), vault: null, tokenConfig: null, poolId: Keypair.generate().publicKey.toBase58(), launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2026-09-01T00:00:00Z", status: "draft" }, at);
      return mint;
    };
    // the expired drafts first (registered two days ago; the next register expires them), then the live coins and today's drafts
    for (let i = 0; i < EXPIRED; i++) mintsByStatus.expired.push(await reg("draft", i, NOW - 2 * 86_400_000));
    for (let i = 0; i < LIVE - 2; i++) mintsByStatus.live.push(await reg("live", i, NOW));
    for (let i = 0; i < DRAFTS; i++) mintsByStatus.draft.push(await reg("draft", i, NOW));
    mintsByStatus.live.push(w.bronco.mint, w.deficit.mint);
    const st = (s: string) => w.registry.tokens().filter((t) => t.status === s).length;
    assert.deepEqual({ live: st("live"), draft: st("draft"), expired: st("expired") }, { live: LIVE, draft: DRAFTS, expired: EXPIRED });

    // the counting chain: every program-client read, every market read, every JSON-RPC call over fetch, every batch call (per 100 accounts)
    const prog = w.program as unknown as Record<string, unknown>;
    const rawFeePda = w.program.feePdaBalanceLamports.bind(w.program);
    for (const m of ["supplyRaw", "feePdaBalanceLamports", "vaultBalanceRaw"]) {
      const f = (prog[m] as (...a: unknown[]) => unknown).bind(w.program);
      prog[m] = (...a: unknown[]) => { hit(m); return f(...a); };
    }
    const port = (prog.port as (m: string) => Record<string, unknown>).bind(w.program);
    prog.port = (mint: string) => { const p = port(mint); const cfg = (p.config as () => unknown).bind(p); return new Proxy(p, { get: (t, k) => (k === "config" ? () => { hit("config"); return cfg(); } : Reflect.get(t, k)) }); };
    const lf = w.program.lockFees as unknown as Record<string, unknown>;
    const lfPort = (lf.port as (m: string) => Record<string, unknown>).bind(w.program.lockFees);
    lf.port = (mint: string) => { const p = lfPort(mint); const s = (p.state as (o?: unknown) => unknown).bind(p); return new Proxy(p, { get: (t, k) => (k === "state" ? (o?: unknown) => { hit("lpState"); return s(o); } : Reflect.get(t, k)) }); };
    w.p.market = {
      async getAccountInfo() { hit("market.getAccountInfo"); return null; },
      async getTokenLargestAccounts() { hit("market.getTokenLargestAccounts"); return { value: [] }; },
      async getMultipleParsedAccounts() { hit("market.getMultipleParsedAccounts"); return { value: [] }; },
    } as never;
    // the batch (one getMultipleAccounts per 100 accounts), answered from the fake program's own state
    (w.p as unknown as Record<string, unknown>).batchReader = {
      async readMany(items: { mint: string; vault: boolean; poolId: string | null }[]) {
        const accounts = items.reduce((a, it) => a + 3 + (it.vault ? 1 : 0) + (it.poolId ? 1 : 0), 0);
        for (let i = 0; i < Math.ceil(accounts / 100); i++) hit("batch.getMultipleAccounts");
        const out = new Map<string, unknown>();
        for (const it of items) {
          let config: unknown = null; try { config = await (port(it.mint).config as () => Promise<unknown>)(); } catch { config = null; }
          out.set(it.mint, { config, feePdaLamports: await rawFeePda(it.mint).catch(() => BigInt(0)), supplyRaw: w.program.supplies.get(it.mint) ?? null, pool: null });
        }
        return out;
      },
    };
    globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
      let method = "http";
      try { method = `rpc.${(JSON.parse(init?.body ?? "{}") as { method?: string }).method ?? "?"}`; } catch { method = "http"; }
      hit(method);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  });
  after(() => { globalThis.fetch = realFetch; w.p.market = null; });

  test("one cold index rebuild: no chain read for a draft or an expired draft, the live coins' accounts in one batch", async () => {
    reset();
    const { GET } = await import("@/app/api/burnticker/tokens/route");
    const r = await GET(new Request("http://localhost/"));
    assert.equal(r.status, 200);
    const body = await r.json() as { tokens: { ticker: string; status: string }[] };
    assert.equal(body.tokens.filter((t) => t.status === "live").length, LIVE, "every live coin is listed");
    // block G re-review Low 3: drafts are not listed in the public index (the coin grid already left them out)
    assert.equal(body.tokens.filter((t) => t.status === "draft" || t.status === "expired").length, 0, "drafts are not listed");
    const n = total(counts);
    console.log(`  [M7] index cold rebuild, ${LIVE} live + ${DRAFTS} drafts + ${EXPIRED} expired: ${n} chain reads ${JSON.stringify(counts)}`);
    assert.ok((counts["batch.getMultipleAccounts"] ?? 0) >= 1, "the batch ran");
    for (const k of ["supplyRaw", "feePdaBalanceLamports", "config"]) assert.ok((counts[k] ?? 0) <= LIVE * 2, `${k}: ${counts[k]} reads for ${LIVE} live coins (pair sides included), none for drafts`);
    assert.ok(n <= LIVE * 6 + 2, `${n} chain reads for ${LIVE} live coins: drafts and expired drafts must cost nothing`);
  });

  test("one cold home rebuild: the same, and a draft costs no chain read", async () => {
    reset();
    const { GET } = await import("@/app/api/burnticker/home/route");
    const r = await GET(new Request("http://localhost/"));
    assert.equal(r.status, 200);
    const n = total(counts);
    console.log(`  [M7] home cold rebuild, ${LIVE} live + ${DRAFTS} drafts + ${EXPIRED} expired: ${n} chain reads ${JSON.stringify(counts)}`);
    assert.ok(n <= LIVE * 5 + 2, `${n} chain reads for ${LIVE} live coins`);
  });
});
