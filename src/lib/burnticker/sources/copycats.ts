import type { BurnRule } from "@/lib/burnticker/rules";
import type { SettledEvent } from "@/lib/burnticker/units";
import type { FetchLike, ImpliedChance, ResolvedSelector, SeriesSummary } from "@/lib/burnticker/oracle/types";
import type { ResolutionSource, Tier } from "@/lib/burnticker/sources/types";
import { addDays, isoDay } from "@/lib/burnticker/sources/attestedHttp";
import { budgetedFetch, takeRpc } from "@/lib/burnticker/apiBudget";

/**
 * COPYCAT LAUNCHES AS AN EVENT (the owner's idea, 2026-10-09: a coin that burns as copycats of it are launched). The reading for a
 * UTC day is the number of NEW Solana mints created that day whose metadata symbol or name matches a pattern (`^\$?DEFICIT$` on the
 * symbol, or "DEFICIT" inside the name), after ADMISSION — the anti-gaming rules, mandatory because a mint costs ~0.002 SOL and any
 * holder could otherwise trigger burns at will:
 *
 *   1. a copycat counts only with ≥ $1,000 of pool liquidity OR ≥ 25 distinct traders at the reading (an empty mint is not a copycat);
 *   2. one unit per CREATOR WALLET per day (the mint's fee payer at creation, read from RPC), so ten mints from one wallet are one;
 *   3. at most 10 units in a day, whatever the count;
 *   4. our own mint(s) are excluded by address, and only Solana counts (the chain the coin lives on).
 *
 * DATA PATH. There is no on-chain "list new mints named X" query, so this source is INDEXER-DEPENDENT and tiered honestly:
 *   tier 4  Helius DAS `searchAssets` (key-gated: env HELIUS_API_KEY) — tokenType fungible, paged; name/symbol matched by us over the
 *           returned metadata; creation time and creator from `getSignaturesForAddress` (oldest signature) on each candidate mint.
 *           Not run here (no key on this host): designed, typed, fixture-less — flagged "unverified" until a keyed run logs 14 days.
 *   tier 5  keyless fallback: DexScreener token search (`/latest/dex/search?q=`) + GeckoTerminal pool search (`/search/pools?query=
 *           &network=solana&include=base_token`). Both only see copycats that already have a POOL — which is exactly the set that
 *           can pass admission rule 1, so the fallback misses nothing that counts, but it is an aggregator's view, not the chain's.
 * Fixtures: config/burnticker/fixtures/onchain.copycats.{dexscreener,geckoterminal}.json, real responses for "DEFICIT" on 2026-10-10.
 *
 * Pure apart from the injected fetch and the creator port. `countCopycats` is the whole rule; the adapters only normalise candidates.
 */

export interface CopycatMatch { symbol: string; name: string; caseInsensitive?: boolean; excludeMints?: string[] }
export interface CopycatAdmission { minLiquidityUsd: number; minDistinctTraders: number; dedupeByCreator: boolean; maxUnitsPerDay: number; chain: "solana"; note: string }
export interface CopycatSourceConfig {
  id: string; kind: "onchain"; tier: Tier; title: string; sourceName: string; sourceUrl: string; cadence: string; pollEverySec: number;
  match: CopycatMatch; admission: CopycatAdmission;
  indexer: { primary: { kind: "helius-das"; envKey: string; url: string; method: "searchAssets" }; fallback: { kind: "dexscreener-search" | "geckoterminal-search"; url: string }[] };
  unit: { size: number; label: string; definition: string }; direction: "up"; baseline: 0; carry: "none"; valueLabel: string;
  plausibility: { min: number; max: number }; memoSource: string; fixture: string | null; flags: string[]; launchable: boolean; note?: string;
  /** Who runs the indexer(s) read (the settlement-coverage audit). */
  operator?: string;
}

/** One candidate copycat, normalised from whichever indexer saw it. */
export interface CopycatCandidate {
  mint: string; symbol: string; name: string; chain: string;
  /** Creation time (ms) — the pool's creation when that is all the indexer knows; the mint's first signature when the RPC port fills it. */
  createdAt: number | null;
  creator: string | null; liquidityUsd: number | null; distinctTraders: number | null;
  via: "helius-das" | "dexscreener" | "geckoterminal";
}

export interface CopycatDayCount { day: string; counted: CopycatCandidate[]; refused: { mint: string; why: string }[]; units: number }

const re = (p: string, ci: boolean | undefined) => new RegExp(p, ci === false ? "" : "i");
export const matchesPattern = (m: CopycatMatch, c: { symbol: string; name: string }): boolean => re(m.symbol, m.caseInsensitive).test(c.symbol.trim()) || re(m.name, m.caseInsensitive).test(c.name.trim());

/** THE RULE: candidates → one day's units, with every refusal named. Pure. */
export function countCopycats(cfg: Pick<CopycatSourceConfig, "match" | "admission">, candidates: readonly CopycatCandidate[], day: string): CopycatDayCount {
  const refused: { mint: string; why: string }[] = [];
  const byCreator = new Map<string, CopycatCandidate>();
  const seenMints = new Set<string>();
  const ex = new Set((cfg.match.excludeMints ?? []).map((m) => m.toLowerCase()));
  for (const c of candidates) {
    if (seenMints.has(c.mint)) continue; seenMints.add(c.mint);
    if (ex.has(c.mint.toLowerCase())) { refused.push({ mint: c.mint, why: "our own mint" }); continue; }
    if (c.chain !== cfg.admission.chain) { refused.push({ mint: c.mint, why: `wrong chain (${c.chain})` }); continue; }
    if (!matchesPattern(cfg.match, c)) { refused.push({ mint: c.mint, why: `name/symbol do not match (${c.symbol} / ${c.name})` }); continue; }
    if (c.createdAt === null) { refused.push({ mint: c.mint, why: "creation time unknown" }); continue; }
    if (isoDay(c.createdAt) !== day) { refused.push({ mint: c.mint, why: `created ${isoDay(c.createdAt)}, not ${day}` }); continue; }
    const liq = c.liquidityUsd ?? 0, traders = c.distinctTraders ?? 0;
    if (liq < cfg.admission.minLiquidityUsd && traders < cfg.admission.minDistinctTraders) { refused.push({ mint: c.mint, why: `below admission: $${liq.toFixed(0)} liquidity, ${traders} traders (needs ≥ $${cfg.admission.minLiquidityUsd} or ≥ ${cfg.admission.minDistinctTraders})` }); continue; }
    const key = cfg.admission.dedupeByCreator ? (c.creator ?? `mint:${c.mint}`) : `mint:${c.mint}`;
    if (cfg.admission.dedupeByCreator && c.creator === null) refused.push({ mint: c.mint, why: "creator unknown: counted on its own, not deduplicated (keyless path)" });
    const have = byCreator.get(key);
    if (have) { refused.push({ mint: c.mint, why: `same creator as ${have.mint} (one unit per creator per day)` }); continue; }
    byCreator.set(key, c);
  }
  const all = [...byCreator.values()].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const counted = all.slice(0, cfg.admission.maxUnitsPerDay);
  for (const c of all.slice(cfg.admission.maxUnitsPerDay)) refused.push({ mint: c.mint, why: `over the ${cfg.admission.maxUnitsPerDay}/day cap` });
  return { day, counted, refused, units: counted.length };
}

// ---- normalisers (each indexer's JSON → candidates) ----

interface DexPair { chainId?: string; baseToken?: { address?: string; name?: string; symbol?: string }; liquidity?: { usd?: number }; pairCreatedAt?: number; txns?: { h24?: { buys?: number; sells?: number } } }
/** DexScreener `/latest/dex/search?q=`: pairs across chains; the base token is the candidate. No creator, no distinct-trader count (txns are counts, not wallets). */
export function fromDexScreenerSearch(body: unknown): CopycatCandidate[] {
  const pairs = ((body as { pairs?: DexPair[] })?.pairs ?? []).filter((p) => p && p.baseToken?.address);
  const best = new Map<string, CopycatCandidate>();
  for (const p of pairs) {
    const mint = p.baseToken!.address!;
    const c: CopycatCandidate = { mint, symbol: p.baseToken?.symbol ?? "", name: p.baseToken?.name ?? "", chain: p.chainId ?? "?", createdAt: typeof p.pairCreatedAt === "number" ? p.pairCreatedAt : null, creator: null, liquidityUsd: typeof p.liquidity?.usd === "number" ? p.liquidity!.usd! : null, distinctTraders: null, via: "dexscreener" };
    const have = best.get(mint);
    // Several pools for one token: keep the deepest pool's liquidity and the EARLIEST creation.
    if (!have) best.set(mint, c);
    else best.set(mint, { ...have, liquidityUsd: Math.max(have.liquidityUsd ?? 0, c.liquidityUsd ?? 0), createdAt: have.createdAt === null ? c.createdAt : c.createdAt === null ? have.createdAt : Math.min(have.createdAt, c.createdAt) });
  }
  return [...best.values()];
}

interface GeckoPool { id?: string; attributes?: { name?: string; pool_created_at?: string; reserve_in_usd?: string; transactions?: { h24?: { buyers?: number; sellers?: number } } }; relationships?: { base_token?: { data?: { id?: string } } } }
interface GeckoToken { id?: string; type?: string; attributes?: { address?: string; name?: string; symbol?: string } }
/** GeckoTerminal `/search/pools?query=&network=solana&include=base_token`: pools + included tokens; distinct buyers+sellers over 24 h is the trader count. */
export function fromGeckoTerminalSearch(body: unknown): CopycatCandidate[] {
  const j = body as { data?: GeckoPool[]; included?: GeckoToken[] };
  const tokens = new Map((j?.included ?? []).filter((t) => t.type === "token" && t.id).map((t) => [t.id!, t]));
  const best = new Map<string, CopycatCandidate>();
  for (const p of j?.data ?? []) {
    const tid = p.relationships?.base_token?.data?.id ?? "";
    const [chain] = tid.split("_");
    const t = tokens.get(tid);
    const mint = t?.attributes?.address ?? tid.slice(chain.length + 1);
    if (!mint) continue;
    const h24 = p.attributes?.transactions?.h24;
    const traders = h24 ? (h24.buyers ?? 0) + (h24.sellers ?? 0) : null;
    const created = p.attributes?.pool_created_at ? Date.parse(p.attributes.pool_created_at) : NaN;
    const c: CopycatCandidate = { mint, symbol: t?.attributes?.symbol ?? (p.attributes?.name ?? "").split(" / ")[0], name: t?.attributes?.name ?? "", chain, createdAt: Number.isNaN(created) ? null : created, creator: null, liquidityUsd: p.attributes?.reserve_in_usd ? Number(p.attributes.reserve_in_usd) : null, distinctTraders: traders, via: "geckoterminal" };
    const have = best.get(mint);
    if (!have) best.set(mint, c);
    else best.set(mint, { ...have, liquidityUsd: Math.max(have.liquidityUsd ?? 0, c.liquidityUsd ?? 0), distinctTraders: Math.max(have.distinctTraders ?? 0, c.distinctTraders ?? 0), createdAt: have.createdAt === null ? c.createdAt : c.createdAt === null ? have.createdAt : Math.min(have.createdAt, c.createdAt) });
  }
  return [...best.values()];
}

interface DasItem { id?: string; interface?: string; content?: { metadata?: { name?: string; symbol?: string } }; authorities?: { address?: string; scopes?: string[] }[]; creators?: { address?: string }[] }
/** Helius DAS `searchAssets` result items (tokenType fungible). No liquidity, no traders, no creation time here: the RPC port fills creator + createdAt; liquidity/traders come from the pool indexers by mint. */
export function fromHeliusSearchAssets(body: unknown): CopycatCandidate[] {
  const items = ((body as { result?: { items?: DasItem[] } })?.result?.items ?? []).filter((i) => i.id);
  return items.map((i) => ({ mint: i.id!, symbol: i.content?.metadata?.symbol ?? "", name: i.content?.metadata?.name ?? "", chain: "solana", createdAt: null, creator: i.creators?.[0]?.address ?? i.authorities?.[0]?.address ?? null, liquidityUsd: null, distinctTraders: null, via: "helius-das" as const }));
}

// ---- the RPC creator port: the mint's first transaction's fee payer, and its block time ----
export interface CreatorPort { creationOf(mint: string): Promise<{ creator: string | null; createdAt: number | null }> }

/** Keyless public RPC: page `getSignaturesForAddress` to the oldest signature (≤ `maxPages` × 1000), then read the fee payer and blockTime. */
export function rpcCreatorPort(rpcUrl: string, fetchImpl: FetchLike, maxPages = 5): CreatorPort {
  const call = async (method: string, params: unknown[]): Promise<unknown> => {
    await takeRpc(rpcUrl, { method });   // the request budget (apiBudget.ts)
    const res = await fetchImpl(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) } as never);
    if (!res.ok) throw new Error(`RPC ${method}: HTTP ${res.status}`);
    const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (j.error) throw new Error(`RPC ${method}: ${j.error.message ?? "error"}`);
    return j.result;
  };
  return {
    async creationOf(mint) {
      let before: string | undefined, oldest: { signature: string; blockTime?: number | null } | null = null;
      for (let page = 0; page < maxPages; page++) {
        const sigs = (await call("getSignaturesForAddress", [mint, { limit: 1000, ...(before ? { before } : {}) }])) as { signature: string; blockTime?: number | null }[];
        if (!sigs?.length) break;
        oldest = sigs[sigs.length - 1]; before = oldest.signature;
        if (sigs.length < 1000) break;
      }
      if (!oldest) return { creator: null, createdAt: null };
      const tx = (await call("getTransaction", [oldest.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }])) as { blockTime?: number | null; transaction?: { message?: { accountKeys?: ({ pubkey?: string } | string)[] } } } | null;
      const k0 = tx?.transaction?.message?.accountKeys?.[0];
      const creator = typeof k0 === "string" ? k0 : k0?.pubkey ?? null;
      const bt = tx?.blockTime ?? oldest.blockTime ?? null;
      return { creator, createdAt: bt === null || bt === undefined ? null : bt * 1000 };
    },
  };
}

/** Fills creator + creation time from RPC for candidates that lack them (the indexers' pool-creation time is replaced by the mint's). */
export async function enrichWithCreator(cands: readonly CopycatCandidate[], port: CreatorPort | null): Promise<CopycatCandidate[]> {
  if (!port) return [...cands];
  const out: CopycatCandidate[] = [];
  for (const c of cands) {
    if (c.creator !== null && c.createdAt !== null) { out.push(c); continue; }
    try { const r = await port.creationOf(c.mint); out.push({ ...c, creator: c.creator ?? r.creator, createdAt: r.createdAt ?? c.createdAt }); } catch { out.push(c); }
  }
  return out;
}

// ---- the source ----
export interface CopycatSourceOptions { fetchImpl?: FetchLike; now?: () => number; env?: Record<string, string | undefined>; creatorPort?: CreatorPort | null; lookbackDays?: number }

const query = (m: CopycatMatch): string => m.name.replace(/[^A-Za-z0-9 $]/g, "").trim() || m.symbol.replace(/[^A-Za-z0-9]/g, "");

/** Readings for the complete UTC days in the window: candidates from every reachable indexer, the rule per day, zero-filled. */
export function readingsFromCandidates(cfg: CopycatSourceConfig, cands: readonly CopycatCandidate[], nowMs: number, lookbackDays = 7): { readings: SettledEvent[]; days: CopycatDayCount[]; refusals: string[] } {
  const last = addDays(isoDay(nowMs), -1);
  const days: CopycatDayCount[] = [];
  const readings: SettledEvent[] = [];
  for (let d = addDays(last, -(lookbackDays - 1)); d <= last; d = addDays(d, 1)) {
    const c = countCopycats(cfg, cands, d);
    days.push(c);
    const units = Math.min(c.units, cfg.plausibility.max);
    readings.push({ id: d, at: d, result: null, value: String(units), title: `${cfg.title}: ${d} — ${units} counted${c.counted.length ? ` (${c.counted.map((x) => `${x.symbol} ${x.mint.slice(0, 6)}…`).join(", ")})` : ""}`, sourceUrl: cfg.sourceUrl });
  }
  return { readings, days, refusals: [] };
}

export function copycatSource(cfg: CopycatSourceConfig, o: CopycatSourceOptions = {}): ResolutionSource & { config: CopycatSourceConfig; candidates(): Promise<{ candidates: CopycatCandidate[]; via: string[]; errors: string[] }> } {
  const now = o.now ?? (() => Date.now());
  const env = o.env ?? process.env;
  const key = env[cfg.indexer.primary.envKey]?.trim() || null;
  const tier: Tier = key ? cfg.tier : 5;
  const summary: SeriesSummary = { oracle: "catalogue", ticker: cfg.id, title: cfg.title, category: `tier ${tier}`, frequency: cfg.cadence, settlementSource: { name: cfg.sourceName, url: cfg.sourceUrl }, tags: cfg.flags };
  const f = budgetedFetch(o.fetchImpl ?? (fetch as unknown as FetchLike));   // every indexer read takes from the request budget (by host)
  const getJson = async (url: string): Promise<unknown> => { const r = await f(url, { headers: { accept: "application/json", "user-agent": "burnticker/0.1 (copycat count; polite polling)" } } as never); if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`); return r.json(); };
  async function candidates(): Promise<{ candidates: CopycatCandidate[]; via: string[]; errors: string[] }> {
    const out: CopycatCandidate[] = [], via: string[] = [], errors: string[] = [];
    if (key) {
      try {
        const res = await f(cfg.indexer.primary.url.replace(`{${cfg.indexer.primary.envKey}}`, key), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "copycats", method: "searchAssets", params: { tokenType: "fungible", page: 1, limit: 1000 } }) } as never);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        out.push(...fromHeliusSearchAssets(j).filter((c) => matchesPattern(cfg.match, c))); via.push("helius-das");
      } catch (e) { errors.push(`helius-das: ${(e as Error).message}`); }
    }
    for (const fb of cfg.indexer.fallback) {
      try {
        const j = await getJson(fb.url.replace("{query}", encodeURIComponent(query(cfg.match))));
        out.push(...(fb.kind === "dexscreener-search" ? fromDexScreenerSearch(j) : fromGeckoTerminalSearch(j))); via.push(fb.kind);
      } catch (e) { errors.push(`${fb.kind}: ${(e as Error).message}`); }
    }
    // Merge by mint: a pool indexer's liquidity/traders complete a DAS item; the earliest creation wins until RPC replaces it.
    const byMint = new Map<string, CopycatCandidate>();
    for (const c of out) {
      const h = byMint.get(c.mint);
      byMint.set(c.mint, h ? { ...h, symbol: h.symbol || c.symbol, name: h.name || c.name, creator: h.creator ?? c.creator, liquidityUsd: Math.max(h.liquidityUsd ?? 0, c.liquidityUsd ?? 0) || (h.liquidityUsd ?? c.liquidityUsd), distinctTraders: Math.max(h.distinctTraders ?? 0, c.distinctTraders ?? 0) || (h.distinctTraders ?? c.distinctTraders), createdAt: h.createdAt === null ? c.createdAt : c.createdAt === null ? h.createdAt : Math.min(h.createdAt, c.createdAt) } : c);
    }
    const enriched = await enrichWithCreator([...byMint.values()], o.creatorPort ?? null);
    return { candidates: enriched, via, errors };
  }
  return {
    id: cfg.id, kind: "onchain", tier, title: cfg.title, sourceName: cfg.sourceName, sourceUrl: cfg.sourceUrl, cadence: cfg.cadence,
    unit: cfg.unit, direction: "up", baseline: 0, carry: "none", valueLabel: cfg.valueLabel,
    flags: [...cfg.flags, key ? "indexer: Helius DAS (key present)" : "indexer: keyless fallback (DexScreener + GeckoTerminal; pool-visible copycats only)"],
    launchable: { ok: cfg.launchable && !!key, why: cfg.launchable ? (key ? null : `needs a key: ${cfg.indexer.primary.envKey} (the keyless fallback is measurement-only)`) : cfg.note ?? "not launchable" },
    config: cfg, candidates,
    async searchSeries() { return [summary]; },
    async seriesInfo() { return summary; },
    async settledSince(_rule: BurnRule, sinceIso: string | null): Promise<ResolvedSelector> {
      const n = now();
      const { candidates: cands, errors } = await candidates();
      const { readings } = readingsFromCandidates(cfg, cands, n, o.lookbackDays ?? 7);
      return { events: readings.filter((r) => sinceIso === null || r.at > sinceIso), awaitingFinal: 0, refusals: errors, settlementSourceUrl: cfg.sourceUrl };
    },
    async impliedChance(): Promise<ImpliedChance> { return { chance: null, marketTicker: null, closeTime: null, basis: "indexer count: there is no market to read" }; },
  };
}
