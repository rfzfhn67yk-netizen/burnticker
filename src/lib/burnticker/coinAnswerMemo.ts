import { KeyedSwr, SWR_BUILD_TIMEOUT_MS } from "@/lib/burnticker/keyedSwr";
import { COIN_MAX_STALE_MS } from "@/lib/burnticker/coinFreshness";
import { KeeperReadCache, cachedMarketReader, cachedPublishProgram, type BatchItem } from "@/lib/burnticker/keeperReadCache";
import type { Platform } from "@/lib/burnticker/server";
import type { TokenRow } from "@/lib/burnticker/registry";

/**
 * ONE MEMO FOR EVERY COIN ANSWER, AND ONE READ FOR BOTH SIDES OF A PAIR (continuous audit HB-35, 2026-10-20).
 *
 * The pair API took about 5 s on every cold call (17 s for the PIT/BAL pair on 2026-10-20: a 503 after its 12 s wait, then 5.7 s more),
 * while the same two coins' own pages were already kept by the coin route. Every RPC call the site makes waits on the web's share of the
 * provider's rate (apiBudget.ts), so the time follows the number of calls. One pair build made two full coin-page reads, each with its own
 * supply, fee pool, vault, TokenConfig and LaunchLab pool reads, and each side's pair block read the OTHER side's supply and TokenConfig
 * again: per pair build, every one of those accounts was read twice.
 *
 * Now:
 *   coinAnswerMemo(registry)   the coin route's memo, moved here so the pair route shares it. A pair side whose coin answer is fresh (same
 *                            page version, younger than COIN_MEMO_MS) is served from it; a side the pair route reads is kept in it, so the
 *                            coin page after a pair page (and the reverse) answers at once. The memo lives on globalThis, so the two route
 *                            bundles share one copy.
 *   pairReadView(p, tokens)  a platform whose program client and market reader read through a KeeperReadCache made for this ONE build:
 *                            the batch fills both coins' supply, fee pool, vault, TokenConfig and pool in one getMultipleAccounts call, and
 *                            a second read of the same account within the build is served from it (onceProgram: also when both sides
 *                            ask at the same moment). Nothing outlives the build, so no answer is older than the build itself (the coin
 *                            page's "reads fresh" rule holds).
 * Not to be confused with coinPageMemo.ts (sixth pass B-10): that bounded memo serves "Your coins" and the creator page with its own windows;
 * this one is the coin route's (15 s fresh; the coin page's freshness fields read its age).
 */
export const COIN_MEMO_MS = 15_000, COIN_COLD_WAIT_MS = 12_000;
export type CoinBody = { status: unknown; receipts: unknown; readings: unknown; rulesText: string; stubs: string[] };

const KEY = Symbol.for("burnticker.coinAnswerMemo");
type Store = WeakMap<object, KeyedSwr<CoinBody>>;
const store = (): Store => {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  return (g[KEY] ??= new WeakMap());
};

/** The coin answers memo for this registry (one per registry: a platform swapped in tests never serves another registry's answers). */
export function coinAnswerMemo(registry: object): KeyedSwr<CoinBody> {
  const s = store();
  let m = s.get(registry);
  if (!m) { m = new KeyedSwr<CoinBody>({ freshMs: COIN_MEMO_MS, coldWaitMs: COIN_COLD_WAIT_MS, maxStaleMs: COIN_MAX_STALE_MS, buildTimeoutMs: SWR_BUILD_TIMEOUT_MS, maxKeys: 256, log: (k, e) => console.error(`[burnticker/tokens] ${k}: the coin's page could not be read:`, e) }); s.set(registry, m); }
  return m;
}

/** The coin route's body from a tokenPageData answer (the readings without their internal fields). */
export function coinBodyOf(data: { status: unknown; receipts: unknown; readings: readonly { id: unknown; at: unknown; result: unknown; value: unknown; title: unknown; sourceUrl: unknown; settlementSourceUrl: unknown; method: unknown; attestedBy: unknown }[]; rulesText: string; stubs: string[] }): CoinBody {
  return { status: data.status, receipts: data.receipts, readings: data.readings.map((r) => ({ id: r.id, at: r.at, result: r.result, value: r.value, title: r.title, sourceUrl: r.sourceUrl, settlementSourceUrl: r.settlementSourceUrl, method: r.method, attestedBy: r.attestedBy })), rulesText: data.rulesText, stubs: data.stubs };
}

/**
 * The program client with each account read shared by every caller in one build: two sides asking for the same supply or TokenConfig at
 * the same moment (before either answer is cached) send one request. A read that fails is not kept, so a later caller tries again.
 */
export function onceProgram(program: Platform["program"]): Platform["program"] {
  const kept = new Map<string, Promise<unknown>>();
  const once = <R>(key: string, read: () => Promise<R>): Promise<R> => {
    const have = kept.get(key);
    if (have) return have as Promise<R>;
    const p = read();
    kept.set(key, p);
    p.catch(() => { if (kept.get(key) === p) kept.delete(key); });
    return p;
  };
  const ports = new Map<string, ReturnType<Platform["program"]["port"]>>();
  const over: Record<PropertyKey, unknown> = {
    supplyRaw: (mint: string) => once(`supply:${mint}`, () => program.supplyRaw(mint)),
    feePdaBalanceLamports: (mint: string) => once(`feePda:${mint}`, () => program.feePdaBalanceLamports(mint)),
    vaultBalanceRaw: (mint: string) => once(`vault:${mint}`, () => program.vaultBalanceRaw(mint)),
    port: (mint: string) => {
      const have = ports.get(mint);
      if (have) return have;
      const base = program.port(mint);
      const port = new Proxy(base, { get(t, k, r) { if (k === "config") return () => once(`config:${mint}`, () => base.config()); const v = Reflect.get(t, k, r); return typeof v === "function" ? v.bind(t) : v; } });
      ports.set(mint, port);
      return port;
    },
  };
  return new Proxy(program, { get(t, k, r) { if (Object.prototype.hasOwnProperty.call(over, k)) return over[k]; const v = Reflect.get(t, k, r); return typeof v === "function" ? v.bind(t) : v; } });
}

/** A platform for one pair build: both coins' accounts in one batch, every account read at most once in the build (see above). */
export async function pairReadView(p: Platform, tokens: readonly TokenRow[], log: (s: string) => void = (s) => console.warn(s)): Promise<Platform> {
  const cache = new KeeperReadCache({ now: () => Date.now() });
  const pools = new Map<string, string>();
  const rows = tokens.filter((t) => t.status !== "draft" && t.status !== "expired");
  for (const t of rows) if (t.poolId) pools.set(t.poolId, t.mint);
  const view: Platform = { ...p, program: cachedPublishProgram(onceProgram(p.program), cache), market: p.market ? cachedMarketReader(p.market, cache, (poolId) => pools.get(poolId) ?? null) : p.market };
  const items: BatchItem[] = rows.map((t) => { let vault = false; try { vault = p.registry.lockedRule(t).mode === "vault"; } catch { vault = false; } return { mint: t.mint, vault, poolId: t.poolId }; });
  try { await cache.prefetch(p.batchReader ?? null, items, log); } catch (e) { log(`  [pair-read] batch skipped: ${(e as Error).message.slice(0, 160)}`); }
  return view;
}
