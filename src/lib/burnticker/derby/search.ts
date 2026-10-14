import fs from "node:fs";
import path from "node:path";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { DERBY_MIN_LIQUIDITY_USD, type DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { feedBase, loadPythCatalogue, PRICE_ASSET_TYPES, searchPyth, type PythFeedRow } from "@/lib/burnticker/derby/pyth";
import { derbySymbol, dexscreenerUrl, JUP_SEARCH_URL, REDSTONE_LATEST_URL, tokensFromJupiter, type JupToken } from "@/lib/burnticker/derby/cross";
import { sourceForUrl, takeOrThrow } from "@/lib/burnticker/apiBudget";

/**
 * THE WIZARD'S COIN SEARCH (2026-10-10, the "Coin vs Coin" tile; GET /v1/derby/search). One query over Pyth's catalogue (the fixture
 * of v2/price_feeds) and Jupiter's token list, each hit with a SUGGESTED underlying the tile can lock into a rule:
 *   · a Pyth crypto feed → `pyth` = its id; `mint` = the verified Jupiter token with the same symbol (deepest liquidity), when one
 *     exists; `cross` = jup:<mint>, else redstone:<SYM> when RedStone's gateway carries the symbol (EVM-native coins such as SHIB);
 *   · a non-crypto feed (single-asset rules) → cross = redstone:<feed id> when RedStone carries it (EUR_FX, AAPL, XAU …), else none;
 *   · a Jupiter token with no Pyth feed → the TWAP fallback when its liquidity is ≥ $250K: `pool` = its deepest SOL pool on Raydium or
 *     PumpSwap (DexScreener's pair list), cross = jup:<mint>.
 * A hit with no usable cross-read says so (`cross: null` + `why`, a plain sentence: qa-12 L3): the creation preflight would refuse it.
 */

export interface DerbyCoinHit { symbol: string; name: string; source: "pyth" | "jupiter"; assetType: string; feed: string | null; mint: string | null; liquidityUsd: number | null; verified: boolean; underlying: DerbyUnderlying | null; why: string | null; /** QA pass 9 #32: how the result tells two coins with one symbol apart */ shortMint?: string | null; mark?: string; label?: string; /** audit 10 #22: the second source as a sentence */ crossLine?: string | null }
/** "EKpQ…zcjm": the first and last four characters of a mint. */
export const shortMint = (mint: string | null | undefined): string | null => (mint && mint.length > 10 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint ?? null);
/** "$12.3M": a liquidity figure in short form. */
export const liquidityLabel = (usd: number | null | undefined): string | null => {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return null;
  const [d, s] = usd >= 1e9 ? [1e9, "B"] : usd >= 1e6 ? [1e6, "M"] : usd >= 1e3 ? [1e3, "K"] : [1, ""];
  return `$${(usd / d).toLocaleString("en-US", { maximumFractionDigits: 1 })}${s}`;
};
/**
 * QA pass 9 #32 (2026-10-13): two coins can share a symbol, so each result says which one it is: its short mint, its liquidity and whether
 * Jupiter marks it verified ("WIF · EKpQ…zcjm · $12.3M liquidity · verified"). A feed with no Solana mint says so.
 */
export function withHitLabel(h: DerbyCoinHit): DerbyCoinHit {
  const sm = shortMint(h.mint), liq = liquidityLabel(h.liquidityUsd);
  const mark = h.source === "pyth" && !h.mint ? "a Pyth feed with no Solana coin" : h.verified ? "verified" : "not verified";
  return { ...h, shortMint: sm, mark, label: [h.symbol, sm, liq ? `${liq} liquidity` : null, mark].filter(Boolean).join(" · "), crossLine: h.underlying ? crossReadSentence(h.underlying.cross, h.symbol) : null };
}
/**
 * The second source of a Coin vs Coin input as a sentence (audit 10 #22: the page showed "cross-read jup"): who is read and for what.
 */
export function crossReadSentence(cross: string | null | undefined, symbol: string): string | null {
  if (!cross) return null;
  const [kind, a, b] = cross.split(":");
  if (kind === "jup") return `Jupiter's quote for ${symbol} (mint ${shortMint(a)}) is read as the second source, from a different operator.`;
  if (kind === "redstone") return `RedStone's signed value for ${a} is read as the second source, from a different operator.`;
  if (kind === "dexscreener") return `DexScreener's value for ${symbol} on ${a ? a[0].toUpperCase() + a.slice(1) : "its home chain"}${b ? ` (contract ${shortMint(b)})` : ""} is read as the second source, from a different operator.`;
  return `A second source from a different operator is read for ${symbol}.`;
}

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
    await takeOrThrow(sourceForUrl(REDSTONE_LATEST_URL));   // the request budget (apiBudget.ts)
    const res = await d.fetchImpl(REDSTONE_LATEST_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    const ids = res.ok ? new Set(Object.keys((await res.json()) as Record<string, unknown>)) : new Set<string>();
    rsCache = { at: Date.now(), ids };
    return ids;
  } catch { return new Set(); }
}

async function jupiterSearch(d: SearchDeps, q: string): Promise<JupToken[]> {
  try {
    await takeOrThrow(sourceForUrl(JUP_SEARCH_URL));
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
    await takeOrThrow(sourceForUrl(dexscreenerUrl(mint)));
    const res = await fetchImpl(dexscreenerUrl(mint), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const pairs = ((await res.json()) as { pairs?: { chainId?: string; dexId?: string; pairAddress?: string; baseToken?: { address?: string }; quoteToken?: { address?: string }; liquidity?: { usd?: number }; labels?: string[] }[] }).pairs ?? [];
    const ok = pairs.filter((p) => p.chainId === "solana" && p.baseToken?.address === mint && p.quoteToken?.address === SOL && (p.dexId === "pumpswap" || (p.dexId === "raydium" && (p.labels ?? []).includes("CPMM"))));
    const best = ok.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    return best?.pairAddress ? { pool: best.pairAddress, dexId: best.dexId!, liquidityUsd: best.liquidity?.usd ?? 0 } : null;
  } catch { return null; }
}

/**
 * QA-12 L3: why a result can or cannot be used, in plain sentences (the tile shows them under each result). Each one says what is missing
 * and what the creator can do, never the internal names (preflight, cross-read, Hermes, TWAP).
 */
export const NO_PYTH = "Pyth has no feed for this coin.";
export const HOME_CHAIN_WHY = "Pyth does not carry this coin on Solana, so this site reads RedStone's signed value for it, and checks each reading against DexScreener on the coin's own chain.";
export const POOL_READ_WHY = "Pyth has no feed for this coin, so this site reads its largest SOL pool, averaged over time, and checks each reading against Jupiter's quote.";
export const NO_POOL_WHY = "This site reads only Raydium and PumpSwap pools paired with SOL, and it found none for this coin.";
export const noSecondSourceWhy = (sym: string): string => `${sym} cannot be used yet. Every reading has to be checked against a second source run by someone else, and none carries ${sym}: Jupiter has no verified token for it and RedStone does not list it.`;
export const thinPoolWhy = (usd: number | null | undefined): string => `Its pools hold $${Math.round(usd ?? 0).toLocaleString("en-US")}, and a coin without a Pyth feed needs at least $${DERBY_MIN_LIQUIDITY_USD.toLocaleString("en-US")}.`;

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
      why: cross ? (rsPrimary ? HOME_CHAIN_WHY : null) : noSecondSourceWhy(sym) });
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
      why: tw && "underlying" in tw ? POOL_READ_WHY : tw && "why" in tw ? `${NO_PYTH} ${tw.why}` : enough ? `${NO_PYTH} Search for it by its name to find its pool.` : `${NO_PYTH} ${thinPoolWhy(t.liquidity)}` });
    if (out.length >= (o.limit ?? 12) * 2) break;
  }
  // audit 10 #21: a usable reference (one with a second source) comes before the ones the preflight would refuse; order is kept within each
  return out.map(withHitLabel).sort((a, b) => Number(!!b.underlying) - Number(!!a.underlying));
}

/** A TWAP underlying for a Jupiter token (its deepest SOL pool), or why not. */
export async function twapUnderlying(fetchImpl: FetchLike, t: { symbol: string; mint: string; liquidityUsd: number | null }): Promise<{ underlying: DerbyUnderlying } | { why: string }> {
  if ((t.liquidityUsd ?? 0) < DERBY_MIN_LIQUIDITY_USD) return { why: thinPoolWhy(t.liquidityUsd) };
  const p = await deepestSolPool(fetchImpl, t.mint);
  if (!p) return { why: NO_POOL_WHY };
  return { underlying: { symbol: t.symbol, pyth: null, mint: t.mint, pool: p.pool, cross: `jup:${t.mint}` } };
}
