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

/**
 * I-7 (audit 2026-10-19): the search took 3.5 to 18 s for any query, with no bound on the input, and varied queries bypassed the edge
 * cache. The work is now capped: a normalised query (normalizeDerbyQuery), one deadline for every upstream read of a request
 * (`deadlineAt`), at most DERBY_JUP_CANDIDATES Jupiter tokens looked at and at most three pool look-ups, run side by side. The API layer
 * (api/derby.ts) caches normalised queries briefly and rate-limits cache misses per client.
 */
export const DERBY_QUERY_MAX = 64;
export const DERBY_SEARCH_DEADLINE_MS = 6_000;
export const DERBY_JUP_CANDIDATES = 40;
const DERBY_QUERY_RE = /^[A-Za-z0-9 ._$-]+$/;
/** The query as searched (NFKC, trimmed, single spaces), or the plain reason it is refused. */
export function normalizeDerbyQuery(raw: string | null | undefined): { query: string } | { error: string } {
  const r = String(raw ?? "");
  if (r.length > DERBY_QUERY_MAX * 4) return { error: `A search can be at most ${DERBY_QUERY_MAX} characters long.` };
  const q = r.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (q.length < 2) return { error: "Type at least two characters. You can search for a ticker, a name or a mint." };
  if (q.length > DERBY_QUERY_MAX) return { error: `A search can be at most ${DERBY_QUERY_MAX} characters long.` };
  if (!DERBY_QUERY_RE.test(q)) return { error: "A search can use letters, digits, spaces and the characters . _ - $ only." };
  return { query: q };
}

interface SearchDeps { fetchImpl: FetchLike; redstoneIds?: Set<string> | null; catalogue?: readonly PythFeedRow[]; /** I-7: no upstream read of this search runs past this time (epoch ms) */ deadlineAt?: number }
/** An upstream read's timeout: its own cap, never past the search's deadline (at least 1 ms, so an expired deadline aborts at once). */
const timeoutFor = (d: Pick<SearchDeps, "deadlineAt">, capMs: number): AbortSignal => AbortSignal.timeout(Math.max(1, Math.min(capMs, d.deadlineAt !== undefined ? d.deadlineAt - Date.now() : capMs)));
const pastDeadline = (d: Pick<SearchDeps, "deadlineAt">, marginMs = 0): boolean => d.deadlineAt !== undefined && Date.now() + marginMs >= d.deadlineAt;
let rsCache: { at: number; ids: Set<string> } | null = null;
async function redstoneIds(d: SearchDeps): Promise<Set<string>> {
  if (d.redstoneIds) return d.redstoneIds;
  if (rsCache && Date.now() - rsCache.at < 10 * 60_000) return rsCache.ids;
  try {
    await takeOrThrow(sourceForUrl(REDSTONE_LATEST_URL));   // the request budget (apiBudget.ts)
    const res = await d.fetchImpl(REDSTONE_LATEST_URL, { headers: { accept: "application/json" }, signal: timeoutFor(d, 20_000) });
    const ids = res.ok ? new Set(Object.keys((await res.json()) as Record<string, unknown>)) : new Set<string>();
    rsCache = { at: Date.now(), ids };
    return ids;
  } catch { return new Set(); }
}

async function jupiterSearch(d: SearchDeps, q: string): Promise<JupToken[]> {
  try {
    await takeOrThrow(sourceForUrl(JUP_SEARCH_URL));
    const res = await d.fetchImpl(`${JUP_SEARCH_URL}?query=${encodeURIComponent(q)}`, { headers: { accept: "application/json" }, signal: timeoutFor(d, 10_000) });
    return res.ok ? tokensFromJupiter(await res.json()).slice(0, DERBY_JUP_CANDIDATES) : [];
  } catch { return []; }
}

const SOL = "So11111111111111111111111111111111111111112";
/** Curated home-chain contracts for coins without a Solana mint (config/burnticker/derby-home-chains.json). */
export const HOME_CHAINS: Record<string, { chain: string; address: string }> = (() => { try { return (JSON.parse(fs.readFileSync(path.join("config", "burnticker", "derby-home-chains.json"), "utf8")) as { coins: Record<string, { chain: string; address: string }> }).coins; } catch { return {}; } })();
/** The deepest SOL pool of a mint on Raydium or PumpSwap (DexScreener's pairs), or null. */
export async function deepestSolPool(fetchImpl: FetchLike, mint: string, o: { deadlineAt?: number } = {}): Promise<{ pool: string; dexId: string; liquidityUsd: number } | null> {
  try {
    await takeOrThrow(sourceForUrl(dexscreenerUrl(mint)));
    const res = await fetchImpl(dexscreenerUrl(mint), { headers: { accept: "application/json" }, signal: timeoutFor(o, 10_000) });
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
  // which Jupiter tokens are listed (in order, up to twice the limit) and which of them get the TWAP fallback (the first three liquid ones)
  const picked: { t: JupToken; sym: string; enough: boolean; twap: boolean }[] = [];
  let resolved = 0, count = out.length;
  for (const t of jup) {
    const sym = derbySymbol(t.symbol);
    if (!sym || seen.has(t.id) || out.some((x) => x.symbol === sym && x.source === "pyth")) continue;
    const enough = (t.liquidity ?? 0) >= DERBY_MIN_LIQUIDITY_USD;
    const twap = enough && resolved < 3;
    if (twap) resolved++;
    picked.push({ t, sym, enough, twap });
    if (++count >= (o.limit ?? 12) * 2) break;
  }
  // The TWAP fallback: the deepest SOL pool of each (one DexScreener read each), side by side and inside the deadline; past it, skipped
  const skipPools = pastDeadline(d, 500);
  const pools = await Promise.all(picked.map((x) => (x.twap && !skipPools ? twapUnderlying(d.fetchImpl, { symbol: x.sym, mint: x.t.id, liquidityUsd: x.t.liquidity }, { deadlineAt: d.deadlineAt }) : Promise.resolve(null))));
  picked.forEach(({ t, sym, enough }, i) => {
    const tw = pools[i];
    out.push({ symbol: sym, name: t.name, source: "jupiter", assetType: "Crypto", feed: null, mint: t.id, liquidityUsd: t.liquidity, verified: t.isVerified, underlying: tw && "underlying" in tw ? tw.underlying : null,
      why: tw && "underlying" in tw ? POOL_READ_WHY : tw && "why" in tw ? `${NO_PYTH} ${tw.why}` : enough ? `${NO_PYTH} Search for it by its name to find its pool.` : `${NO_PYTH} ${thinPoolWhy(t.liquidity)}` });
  });
  return rankDerbyHits(out.map(withHitLabel), query);
}

/**
 * THE ORDER OF THE RESULTS (continuous audit HB-11, 2026-10-19: "WIF" listed SWORDCAT, SWORDDOG and BAGUETTE beside WIF, because
 * Jupiter answers on any token whose name has the word in it). Run 3 (reopened): the first fix still kept "cat wif sword" ($SWORDCAT)
 * because its name holds the word ($BIF "bonkwifhat" and $SAVIOUR "Bonk Level Saviour" for "BONK" too), so a name counts only beside
 * the symbol: the mint or feed itself comes first, then the exact symbol or exact name, then a symbol that starts with the query, then a
 * word match (the query is part of the symbol AND a word or the start of the name, as $KWIF "Kitten Wif Hat"). Everything else, a hit
 * whose symbol does not carry the query or that only contains the letters somewhere, is dropped. Within each,
 * a usable reference (one with a second source) comes before the ones the preflight would refuse (audit 10 #21), and the upstream
 * order is kept.
 */
export function rankDerbyHits<H extends Pick<DerbyCoinHit, "symbol" | "name" | "mint" | "feed" | "underlying">>(hits: readonly H[], query: string): H[] {
  const raw = query.trim().replace(/^\$/, ""), fold = (x: string | null | undefined) => (x ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const fq = fold(raw);
  const words = (x: string | null | undefined) => (x ?? "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const tier = (h: H): number => {
    if (raw && (h.mint === raw || (h.feed ?? "").toLowerCase().replace(/^0x/, "") === raw.toLowerCase().replace(/^0x/, ""))) return 4;
    if (!fq) return 0;
    const sym = fold(h.symbol), name = fold(h.name);
    if (sym === fq || name === fq) return 3;
    if (sym.startsWith(fq)) return 2;
    if (sym.includes(fq) && (words(h.name).includes(fq) || name.startsWith(fq))) return 1;
    return 0;
  };
  return hits.map((h, i) => ({ h, i, t: tier(h), u: Number(!!h.underlying) })).filter((x) => x.t > 0)
    .sort((a, b) => b.t - a.t || b.u - a.u || a.i - b.i).map((x) => x.h);
}

/** A TWAP underlying for a Jupiter token (its deepest SOL pool), or why not. */
export async function twapUnderlying(fetchImpl: FetchLike, t: { symbol: string; mint: string; liquidityUsd: number | null }, o: { deadlineAt?: number } = {}): Promise<{ underlying: DerbyUnderlying } | { why: string }> {
  if ((t.liquidityUsd ?? 0) < DERBY_MIN_LIQUIDITY_USD) return { why: thinPoolWhy(t.liquidityUsd) };
  const p = await deepestSolPool(fetchImpl, t.mint, o);
  if (!p) return { why: NO_POOL_WHY };
  return { underlying: { symbol: t.symbol, pyth: null, mint: t.mint, pool: p.pool, cross: `jup:${t.mint}` } };
}
