import { cachedMarketReader, cachedPublishProgram, KeeperReadCache, signatureFingerprints, type BatchItem } from "@/lib/burnticker/keeperReadCache";
import type { Platform } from "@/lib/burnticker/server";
import type { TokenRow } from "@/lib/burnticker/registry";

/**
 * THE SITE'S READ CACHE FOR THE COIN LIST (2026-10-15 prelaunch audit M7). The index (/api/burnticker/tokens) and the home
 * (/api/burnticker/home) rebuild every 15 s, and each rebuild re-read every registry row from the chain one account at a time: drafts
 * and expired drafts included (they have no page on chain; server.ts tokenPageInput now builds them from the registry alone), so the
 * reads grew with every draft anyone prepared. The rebuilds now read through the keeper's read cache (keeperReadCache.ts, the same TTLs
 * and the same decoding):
 *
 *   batch          one getMultipleAccounts per 20 coins fills the supply, the fee pool, the TokenConfig, the vault and the LaunchLab pool
 *                  of every coin with a page on chain (Platform.batchReader), instead of 4 to 6 reads per coin
 *   the rest       the LP lock, the top holders and their owners are kept for their TTLs, as the keeper keeps them
 *   invalidation   before each rebuild the registry's signatures table (the keeper writes every send there before it sends) is compared
 *                  with the last rebuild's: a coin the keeper changed is read fresh, so a burn shows on the next rebuild
 *
 * The coin page (/burnticker/t/…) does not use it: it reads fresh, as before.
 */

/** The rows whose chain state is read: not a draft, not an expired draft. */
export const chainRows = <T extends Pick<TokenRow, "status">>(tokens: readonly T[]): T[] => tokens.filter((t) => t.status !== "draft" && t.status !== "expired");

/** The rebuild's memo window: 15 s while fewer than 50 coins are read from the chain, then 0.3 s per coin, at most two minutes. */
export function memoWindowMs(chainCoins: number): number { return chainCoins < 50 ? 15_000 : Math.min(120_000, Math.ceil(chainCoins * 300)); }

/**
 * HB-99 residue (hourly run 8): the home memo served a body 547 s old under "max-age=10, s-maxage=15, stale-while-revalidate=30", because
 * a refresh that never landed left the old answer a hit. The pair route got the same bound in run 7. A home answer older than this is
 * no longer a hit: the refresh is waited for (the cold wait), a refresh in flight past SWR_BUILD_TIMEOUT_MS is dropped for a new one, and an
 * old answer that is still all there is goes out no-store with its real age. 45 s is the header's s-maxage plus its stale window; a memo
 * window longer than 15 s (50 coins or more) adds its own excess, so the memo is never "stale" inside its own window.
 */
export const HOME_MAX_STALE_MS = 45_000;
export const homeMaxStaleMs = (memoMs: number): number => Math.max(HOME_MAX_STALE_MS, memoMs + 30_000);
/** The home memo's answer for an age: a hit, a hit that starts a background refresh, or too old to hand out without waiting. */
export function homeMemoState(ageMs: number, memoMs: number): "hit" | "refresh" | "stale" {
  return ageMs >= homeMaxStaleMs(memoMs) ? "stale" : ageMs >= memoMs ? "refresh" : "hit";
}


interface View { cache: KeeperReadCache; pools: Map<string, string>; platform: Platform }
const views = new WeakMap<Platform, View>();

/**
 * The platform the rebuild reads through: `p` with its program client and market reader behind the cache. Invalidates what the keeper
 * changed since the last call, then runs the batch for `tokens`' chain rows. Never throws for a cache step (a failed batch leaves the
 * per-coin reads to fill the fields, as in the keeper).
 */
export async function webReadPlatform(p: Platform, tokens: readonly TokenRow[], o: { now?: () => number; log?: (s: string) => void } = {}): Promise<Platform> {
  let v = views.get(p);
  if (!v) {
    const cache = new KeeperReadCache({ now: o.now ?? (() => Date.now()) });
    const pools = new Map<string, string>();
    v = { cache, pools, platform: { ...p, program: cachedPublishProgram(p.program, cache), market: p.market ? cachedMarketReader(p.market, cache, (poolId) => pools.get(poolId) ?? null) : p.market } };
    views.set(p, v);
  }
  const rows = chainRows(tokens);
  v.pools.clear();
  for (const t of rows) if (t.poolId) v.pools.set(t.poolId, t.mint);
  try { v.cache.afterCycle(null, signatureFingerprints(p.registry.db)); } catch { v.cache.invalidateAll(); }
  const items: BatchItem[] = rows.map((t) => { let vault = false; try { vault = p.registry.lockedRule(t).mode === "vault"; } catch { vault = false; } return { mint: t.mint, vault, poolId: t.poolId }; });
  await v.cache.prefetch(p.batchReader ?? null, items, o.log ?? ((s) => console.warn(s)));
  return v.platform;
}
/**
 * HB-145 (2026-10-20): the cached platform for `p` without waiting for a batch: the builds give the batch a budget, and past it the coin
 * reads go on through the cache (each fills its own fields, as on a failed batch) while the batch lands in the background. `p` itself
 * when no view was made yet.
 */
export const webReadCachedView = (p: Platform): Platform => views.get(p)?.platform ?? p;
/** For tests: the cache's counters for `p`'s view. */
export const webReadStats = (p: Platform): KeeperReadCache["stats"] | null => views.get(p)?.cache.stats ?? null;
