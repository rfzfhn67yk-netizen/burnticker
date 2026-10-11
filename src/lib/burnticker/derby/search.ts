import fs from "node:fs";
import path from "node:path";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { DERBY_MIN_LIQUIDITY_USD, type DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { feedBase, loadPythCatalogue, PRICE_ASSET_TYPES, searchPyth, type PythFeedRow } from "@/lib/burnticker/derby/pyth";
import { derbySymbol, dexscreenerUrl, JUP_SEARCH_URL, REDSTONE_LATEST_URL, tokensFromJupiter, type JupToken } from "@/lib/burnticker/derby/cross";

/**
 * THE WIZARD'S COIN SEARCH (2026-10-10, the "Coin vs Coin" tile; GET /v1/derby/search). One query over Pyth's catalogue (the fixture
 * of v2/price_feeds) and Jupiter's token list, each hit with a SUGGESTED underlying the tile can lock into a rule:
 *   · a Pyth crypto feed → `pyth` = its id; `mint` = the verified Jupiter token with the same symbol (deepest liquidity), when one
 *     exists; `cross` = jup:<mint>, else redstone:<SYM> when RedStone's gateway carries the symbol (EVM-native coins such as SHIB);
 *   · a non-crypto feed (single-asset rules) → cross = redstone:<feed id> when RedStone carries it (EUR_FX, AAPL, XAU …), else none;
 *   · a Jupiter token with no Pyth feed → the TWAP fallback when its liquidity is ≥ $250K: `pool` = its deepest SOL pool on Raydium or
 *     PumpSwap (DexScreener's pair list), cross = jup:<mint>.
 * A hit with no usable cross-read says so (`cross: null` + `why`): the creation preflight would refuse it.
 */

export interface DerbyCoinHit { symbol: string; name: string; source: "pyth" | "jupiter"; assetType: string; feed: string | null; mint: string | null; liquidityUsd: number | null; verified: boolean; underlying: DerbyUnderlying | null; why: string | null }

/** RedStone's id for a Pyth symbol: coins by base ("SHIB"), FX as "EUR_FX", metals/equities by base ("XAU", "AAPL"). */
export function redstoneIdFor(row: Pick<PythFeedRow, "symbol" | "asset_type">): string | null {
  const base = feedBase(row.symbol);
  if (!base) return null;
  if (row.asset_type === "FX") { const m = /^FX\.([A-Z]{3})\/USD$/.exec(row.symbol); return m ? `${m[1]}_FX` : null; }
  return base;
}

interface SearchDeps { fetchImpl: FetchLike; redstoneIds?: Set<string> | null; catalogue?: readonly PythFeedRow[] }
let rsCache: { at: number; ids: Set<string> } | null = null;
async function redstoneIds(d: SearchDeps): Promise<Set<string>> {
  if (d.redstoneIds) return d.redstoneIds;
  if (rsCache && Date.now() - rsCache.at < 10 * 60_000) return rsCache.ids;
  try {
    const res = await d.fetchImpl(REDSTONE_LATEST_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    const ids = res.ok ? new Set(Object.keys((await res.json()) as Record<string, unknown>)) : new Set<string>();
    rsCache = { at: Date.now(), ids };
    return ids;
  } catch { return new Set(); }
}

async function jupiterSearch(d: SearchDeps, q: string): Promise<JupToken[]> {
  try {
    const res = await d.fetchImpl(`${JUP_SEARCH_URL}?query=${encodeURIComponent(q)}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? tokensFromJupiter(await res.json()) : [];
  } catch { return []; }
}

const SOL = "So11111111111111111111111111111111111111112";
/** Curated home-chain contracts for coins without a Solana mint (config/burnticker/derby-home-chains.json). */
export const HOME_CHAINS: Record<string, { chain: string; address: string }> = (() => { try { return (JSON.parse(fs.readFileSync(path.join("config", "burnticker", "derby-home-chains.json"), "utf8")) as { coins: Record<string, { chain: string; address: string }> }).coins; } catch { return {}; } })();
/** The deepest SOL pool of a mint on Raydium or PumpSwap (DexScreener's pairs), or null. */
export async function deepestSolPool(fetchImpl: FetchLike, mint: string): Promise<{ pool: string; dexId: string; liquidityUsd: number } | null> {
  try {
    const res = await fetchImpl(dexscreenerUrl(mint), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const pairs = ((await res.json()) as { pairs?: { chainId?: string; dexId?: string; pairAddress?: string; baseToken?: { address?: string }; quoteToken?: { address?: string }; liquidity?: { usd?: number }; labels?: string[] }[] }).pairs ?? [];
    const ok = pairs.filter((p) => p.chainId === "solana" && p.baseToken?.address === mint && p.quoteToken?.address === SOL && (p.dexId === "pumpswap" || (p.dexId === "raydium" && (p.labels ?? []).includes("CPMM"))));
    const best = ok.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    return best?.pairAddress ? { pool: best.pairAddress, dexId: best.dexId!, liquidityUsd: best.liquidity?.usd ?? 0 } : null;
  } catch { return null; }
}

export async function searchDerbyCoins(q: string, d: SearchDeps, o: { assets?: "crypto" | "all"; limit?: number; env?: Readonly<Record<string, string | undefined>> } = {}): Promise<DerbyCoinHit[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const rows = d.catalogue ?? loadPythCatalogue();
  const pyth = searchPyth(query, o.limit ?? 12, rows, { assetTypes: o.assets === "all" ? PRICE_ASSET_TYPES : ["Crypto"], env: o.env });
  const [jup, rs] = await Promise.all([jupiterSearch(d, query), redstoneIds(d)]);
  const bySym = (sym: string) => jup.filter((t) => derbySymbol(t.symbol) === sym && t.isVerified).sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))[0] ?? null;
  const out: DerbyCoinHit[] = [];
  for (const h of pyth) {
    const row = rows.find((r) => r.id === h.id)!;
    const sym = h.base.slice(0, 12);
    const tok = h.assetType === "Crypto" ? bySym(sym) : null;
    const rsId = redstoneIdFor(row);
    const home = h.assetType === "Crypto" ? HOME_CHAINS[sym] ?? null : null;
    // A coin with no Solana mint but a curated home-chain contract (SHIB, PEPE): RedStone is its keyless primary when Pyth cannot be
    // read, DexScreener on the home chain its cross-read. Otherwise Jupiter (Solana coins) or RedStone (equities, FX, metals) cross-reads.
    const rsPrimary = !tok && home && rsId && rs.has(rsId) ? rsId : null;
    const cross = tok ? `jup:${tok.id}` : rsPrimary && home ? `dexscreener:${home.chain}:${home.address}` : rsId && rs.has(rsId) ? `redstone:${rsId}` : null;
    out.push({ symbol: sym, name: row.symbol, source: "pyth", assetType: h.assetType, feed: h.id, mint: tok?.id ?? null, liquidityUsd: tok?.liquidity ?? null, verified: true,
      underlying: cross ? { symbol: sym, pyth: h.id, mint: tok?.id ?? null, pool: null, cross, ...(rsPrimary ? { redstone: rsPrimary } : {}) } : null,
      why: cross ? (rsPrimary ? "Pyth on Solana has no account for it: RedStone's signed packages are the primary when no Hermes key is set; DexScreener on its home chain is the cross-read" : null) : `no independent cross-read carries ${sym} (no verified Jupiter token, not on RedStone's gateway): the preflight would refuse it` });
  }
  const seen = new Set(out.map((x) => x.mint).filter(Boolean));
  let resolved = 0;
  for (const t of jup) {
    const sym = derbySymbol(t.symbol);
    if (!sym || seen.has(t.id) || out.some((x) => x.symbol === sym && x.source === "pyth")) continue;
    const enough = (t.liquidity ?? 0) >= DERBY_MIN_LIQUIDITY_USD;
    // The TWAP fallback: resolve the deepest SOL pool for the first few liquid coins (one DexScreener read each).
    const tw = enough && resolved < 3 ? (resolved++, await twapUnderlying(d.fetchImpl, { symbol: sym, mint: t.id, liquidityUsd: t.liquidity })) : null;
    out.push({ symbol: sym, name: t.name, source: "jupiter", assetType: "Crypto", feed: null, mint: t.id, liquidityUsd: t.liquidity, verified: t.isVerified, underlying: tw && "underlying" in tw ? tw.underlying : null,
      why: tw && "underlying" in tw ? "no Pyth feed: read from its deepest SOL pool (time-weighted vault balances), cross-read by Jupiter" : tw && "why" in tw ? `no Pyth feed: ${tw.why}` : enough ? "no Pyth feed: search for it by name to resolve its pool" : `no Pyth feed and $${Math.round(t.liquidity ?? 0).toLocaleString("en-US")} of liquidity (needs $${DERBY_MIN_LIQUIDITY_USD.toLocaleString("en-US")})` });
    if (out.length >= (o.limit ?? 12) * 2) break;
  }
  return out;
}

/** A TWAP underlying for a Jupiter token (its deepest SOL pool), or why not. */
export async function twapUnderlying(fetchImpl: FetchLike, t: { symbol: string; mint: string; liquidityUsd: number | null }): Promise<{ underlying: DerbyUnderlying } | { why: string }> {
  if ((t.liquidityUsd ?? 0) < DERBY_MIN_LIQUIDITY_USD) return { why: `$${Math.round(t.liquidityUsd ?? 0).toLocaleString("en-US")} of liquidity (needs $${DERBY_MIN_LIQUIDITY_USD.toLocaleString("en-US")})` };
  const p = await deepestSolPool(fetchImpl, t.mint);
  if (!p) return { why: "no Raydium CPMM or PumpSwap SOL pool found for it (Meteora pools are not read)" };
  return { underlying: { symbol: t.symbol, pyth: null, mint: t.mint, pool: p.pool, cross: `jup:${t.mint}` } };
}
