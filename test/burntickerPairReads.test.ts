// HB-35 (continuous audit, 2026-10-20): the pair API took about 5 s on every cold call. The two sides now share the coin route's memo,
// and the sides still to read share one batch and one per-build read cache (src/lib/burnticker/coinAnswerMemo.ts). These tests count the
// program reads one pair build makes, before (two independent coin-page reads, as the route did) and after.
import { describe, test } from "node:test";
import { clearSitemapMemo } from "@/lib/burnticker/sitemapMemo";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeWorld } from "./burntickerApiHelpers.ts";
import { NOW } from "./burntickerHelpers.ts";
import { setPlatformForTests, tokenPageData, type Platform } from "@/lib/burnticker/server";
import { coinAnswerMemo, pairReadView, COIN_MEMO_MS } from "@/lib/burnticker/coinAnswerMemo";
import { KeyedSwr } from "@/lib/burnticker/keyedSwr";
import type { BatchFacts, BatchItem, BatchReader } from "@/lib/burnticker/keeperReadCache";

const PAIR = "bronco-vs-deficit2";
type Program = Platform["program"];

/** The world's program client with every account read counted per method and mint. */
function counted(program: Program): { program: Program; reads: Map<string, number>; total: () => number } {
  const reads = new Map<string, number>();
  const hit = (k: string) => reads.set(k, (reads.get(k) ?? 0) + 1);
  const prog = new Proxy(program, {
    get(t, prop, r) {
      const v = Reflect.get(t, prop, r);
      if (prop === "supplyRaw" || prop === "feePdaBalanceLamports" || prop === "vaultBalanceRaw") return (mint: string) => { hit(`${String(prop)}:${mint}`); return (v as (m: string) => Promise<unknown>).call(t, mint); };
      if (prop === "port") {
        return (mint: string) => {
          const port = (v as (m: string) => Record<string, unknown>).call(t, mint);
          return new Proxy(port, { get(pt, pp, pr) { const pv = Reflect.get(pt, pp, pr); if (pp === "config") return () => { hit(`config:${mint}`); return (pv as () => Promise<unknown>).call(pt); }; return typeof pv === "function" ? pv.bind(pt) : pv; } });
        };
      }
      return typeof v === "function" ? v.bind(t) : v;
    },
  }) as Program;
  return { program: prog, reads, total: () => [...reads.values()].reduce((a, b) => a + b, 0) };
}

/** A batch reader over the fake program: one call fills every item's supply, fee pool, TokenConfig and vault. */
function fakeBatch(program: Program): BatchReader & { calls: number } {
  const b = {
    calls: 0,
    async readMany(items: readonly BatchItem[]): Promise<Map<string, BatchFacts>> {
      b.calls++;
      const out = new Map<string, BatchFacts>();
      for (const it of items) out.set(it.mint, { supplyRaw: await program.supplyRaw(it.mint), feePdaLamports: await program.feePdaBalanceLamports(it.mint), config: await program.port(it.mint).config(), ...(it.vault ? { vaultRaw: await program.vaultBalanceRaw(it.mint) } : {}) });
      return out;
    },
  };
  return b;
}

async function pairWorld() {
  const w = await makeWorld();
  w.registry.db.prepare("INSERT INTO pairs (pair_id, mint_a, mint_b, selector_key, created_at) VALUES (?,?,?,?,?)").run(PAIR, w.bronco.mint, w.deficit.mint, w.bronco.selectorKey, NOW);
  return w;
}
const pairGet = async () => {
  const { GET } = await import("../src/app/api/burnticker/pairs/[pairId]/route.ts");
  return GET(new Request(`http://bt.test/api/burnticker/pairs/${PAIR}`), { params: Promise.resolve({ pairId: PAIR }) });
};
const coinGet = async (mint: string) => {
  const { GET } = await import("../src/app/api/burnticker/tokens/[ticker]/route.ts");
  return GET(new Request(`http://bt.test/api/burnticker/tokens/${mint}`), { params: Promise.resolve({ ticker: mint }) });
};

describe("HB-35: one pair build reads each account once", () => {
  test("before: two coin-page reads read each side's supply twice (the pair block reads the other side's); after: once", async () => {
    const w = await pairWorld();
    const before = counted(w.program);
    const pb: Platform = { ...w.p, program: before.program };
    await Promise.all([tokenPageData(pb, w.bronco), tokenPageData(pb, w.deficit)]);
    assert.equal(before.reads.get(`supplyRaw:${w.bronco.mint}`), 2, "the old way: BRONCO's supply read by its own page and by DEFICIT2's pair block");
    assert.equal(before.reads.get(`supplyRaw:${w.deficit.mint}`), 2);

    const after = counted(w.program);
    const view = await pairReadView({ ...w.p, program: after.program }, [w.bronco, w.deficit], () => {});
    await Promise.all([tokenPageData(view, w.bronco), tokenPageData(view, w.deficit)]);
    for (const [k, n] of after.reads) assert.equal(n, 1, `${k} read ${n} times in one build`);
    assert.ok(after.total() < before.total(), `${after.total()} reads, was ${before.total()}`);
  });

  test("with the host's batch reader, both coins' supply, fee pool and TokenConfig come from one batch call and no single read", async () => {
    const w = await pairWorld();
    const c = counted(w.program);
    const batch = fakeBatch(w.program);   // the batch reads the raw program: its reads are not the per-coin ones counted here
    const view = await pairReadView({ ...w.p, program: c.program, batchReader: batch } as Platform, [w.bronco, w.deficit], () => {});
    await Promise.all([tokenPageData(view, w.bronco), tokenPageData(view, w.deficit)]);
    assert.equal(batch.calls, 1);
    for (const m of [w.bronco.mint, w.deficit.mint]) for (const f of ["supplyRaw", "feePdaBalanceLamports", "config"]) assert.equal(c.reads.get(`${f}:${m}`) ?? 0, 0, `${f} for ${m}`);
  });

  test("the answers are the same: a side read through the view equals the plain coin-page read", async () => {
    const w = await pairWorld();
    const view = await pairReadView(w.p, [w.bronco, w.deficit], () => {});
    const strip = (d: Awaited<ReturnType<typeof tokenPageData>>) => JSON.parse(JSON.stringify({ ...d, status: { ...d.status, generatedAt: null } }, (_k, v) => (typeof v === "bigint" ? String(v) : v)));
    for (const t of [w.bronco, w.deficit]) assert.deepEqual(strip(await tokenPageData(view, t, NOW)), strip(await tokenPageData(w.p, t, NOW)), t.ticker);
  });
});

describe("HB-35: the pair route and the coin route share one memo", () => {
  test("a pair read keeps both sides for the coin page, which then answers with no read", async () => {
    const w = await pairWorld();
    const c = counted(w.program);
    setPlatformForTests({ ...w.p, program: c.program });
    coinAnswerMemo(w.registry).clear();
    const r = await pairGet();
    assert.equal(r.status, 200);
    const j = await r.json() as { a: { status: { mint: string } }; b: { status: { mint: string } } };
    assert.equal(j.a.status.mint, w.bronco.mint);
    const readsAfterPair = c.total();
    assert.ok(readsAfterPair > 0);
    for (const m of [w.bronco.mint, w.deficit.mint]) { const cr = await coinGet(m); assert.equal(cr.status, 200); assert.equal(cr.headers.get("x-coin-memo"), "hit", m); }
    assert.equal(c.total(), readsAfterPair, "the coin pages after the pair page read nothing");
  });

  test("a coin answer the coin route kept is used by the pair build: that side costs no read", async () => {
    const w = await pairWorld();
    const c = counted(w.program);
    setPlatformForTests({ ...w.p, program: c.program });
    coinAnswerMemo(w.registry).clear();
    assert.equal((await coinGet(w.bronco.mint)).status, 200);
    assert.equal((await coinGet(w.deficit.mint)).status, 200);
    const before = c.total();
    // a new world is a new registry, so its pair memo is cold while both coin answers are kept
    const r = await pairGet();
    assert.equal(r.status, 200);
    assert.equal(c.total(), before, "both sides came from the coin memo");
  });

  test("the coin memo is one copy (globalThis) and peek/put respect versions and age", async () => {
    const w = await pairWorld();
    assert.equal(coinAnswerMemo(w.registry), coinAnswerMemo(w.registry));
    let t = 0;
    const m = new KeyedSwr<string>({ freshMs: COIN_MEMO_MS, coldWaitMs: 50 }, () => t);
    m.put("A", "v1", "kept");
    assert.equal(m.peek("A", "v1"), "kept");
    assert.equal(m.peek("A", "v2"), undefined, "another page version is not this answer");
    t = COIN_MEMO_MS;
    assert.equal(m.peek("A", "v1"), undefined, "older than the fresh window");
    assert.equal((await m.get("A", "v1", async () => "built"))?.value, "kept", "get still serves it and refreshes behind it");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(m.peek("A", "v1", Infinity), "built");
  });

  test("the pair route keeps its own bound (HB-99) and logs its build time", () => {
    const src = fs.readFileSync("src/app/api/burnticker/pairs/[pairId]/route.ts", "utf8");
    assert.match(src, /maxStaleMs: PAIR_MAX_STALE_MS, buildTimeoutMs: SWR_BUILD_TIMEOUT_MS/);
    assert.match(src, /coins\.peek\(a\.mint, va\), kb = coins\.peek\(b\.mint, vb\)/);
    assert.match(src, /\[burnticker\/pairs\] \$\{pairId\} built in/);
  });
});

describe("HB-35: the league pages and the sitemap keep their table for ten minutes", () => {
  test("leagueDataForPages: the same table for ten minutes (the home's leagueData rebuilds after 60 s), then a fresh one", async () => {
    const { leagueData, leagueDataForPages, clearLeagueMemo, LEAGUE_PAGE_TTL_MS } = await import("@/lib/burnticker/leaguesServe");
    const w = await pairWorld();
    clearLeagueMemo();
    const t0 = Date.now();
    const first = leagueDataForPages(w.p, t0);
    assert.equal(leagueDataForPages(w.p, t0 + 5 * 60_000), first, "five minutes later: kept");
    assert.notEqual(leagueData(w.p, t0 + 5 * 60_000), first, "the home's 60 s table is rebuilt meanwhile");
    assert.notEqual(leagueDataForPages(w.p, t0 + LEAGUE_PAGE_TTL_MS + 1), first, "past ten minutes: rebuilt");
    const w2 = await pairWorld();
    assert.notEqual(leagueDataForPages(w2.p, t0 + LEAGUE_PAGE_TTL_MS + 2), first, "another registry never reads this one's table");
    assert.equal(LEAGUE_PAGE_TTL_MS, 600_000);
  });

  test("sitemap.xml: built once, then served from the memo; another registry builds its own", async () => {
    const { clearLeagueMemo } = await import("@/lib/burnticker/leaguesServe");
    const mod = await import("../src/app/burnticker/sitemap.xml/route.ts") as { GET: () => Promise<Response> };
    await pairWorld(); clearLeagueMemo(); clearSitemapMemo();
    const a = await mod.GET();
    assert.equal(a.headers.get("x-sitemap-memo"), "built");
    const body = await a.text();
    const b = await mod.GET();
    assert.equal(b.headers.get("x-sitemap-memo"), "hit");
    assert.equal(await b.text(), body, "the same answer");
    assert.equal(b.headers.get("cache-control"), "public, max-age=600");
    await pairWorld();
    assert.equal((await mod.GET()).headers.get("x-sitemap-memo"), "built");
  });

  test("an unreadable registry's sitemap is not kept", async () => {
    const mod = await import("../src/app/burnticker/sitemap.xml/route.ts") as { GET: () => Promise<Response> };
    clearSitemapMemo();
    setPlatformForTests({ get registry(): never { throw new Error("registry down"); }, cluster: "devnet" } as never);
    const r = await mod.GET();
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-sitemap-memo"), "unread");
    assert.equal((await mod.GET()).headers.get("x-sitemap-memo"), "unread", "tried again, not served from a memo");
  });
});
