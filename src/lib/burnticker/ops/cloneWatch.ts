import type { DatabaseSync } from "node:sqlite";
import { compare, skeleton } from "@/lib/burnticker/lookalike";
import type { FetchLike } from "@/lib/burnticker/oracle/types";

/**
 * THE CLONE WATCH (growth batch, owner-approved 2026-10-10) and the public "Not Burnticker" list. A keeper-side job
 * (scripts/burnticker-clone-watch.mts, every 15 minutes from mct-burnticker-clonewatch.timer) asks DexScreener's keyless search for
 * Solana pools whose token is named or tickered like DEFICIT, Burnticker or any launched Burnticker ticker — lookalike spellings
 * included (lookalike.ts skeletons: DEF1CIT, DEFICІT, REALDEFICIT) — and records, for every token that is not a Burnticker coin:
 *
 *   · the mint, the pool, the DEX, the pool's creation time, when we first and last saw it;
 *   · whether the burn_receipts program knows the mint (a TokenConfig), when this host reads the program;
 *   · the HOLDER-STACK signal: five or more of the top-20 holders with the same share to 0.01 % (a bundled launch spreads one buy over
 *     fresh wallets in equal parts) — "7 wallets hold identical 0.97 %";
 *   · the LP state from the pool's liquidity over our observations: present, thin, or PULLED (it had ≥ $500 and fell under $50) with the
 *     first time we saw it gone.
 *
 * EVIDENCE ONLY. The list states what the chain and the pool index showed, in plain lines that pass the copy lint; it names no person
 * and makes no claim about intent. Observations are APPEND-ONLY rows in the registry's database (clone_observations, clone_scans), like
 * every other record there. Pure apart from the injected fetch / readers and the store.
 */

export const CLONES_SCHEMA = "burnticker.clones/v1";
export const PLATFORM_TERMS = ["DEFICIT", "BURNTICKER"];
export const LP_PRESENT_USD = 500;
export const LP_GONE_USD = 50;
export const BUNDLE_MIN_WALLETS = 5;
export const dexSearchUrl = (term: string): string => `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(term)}`;

/** The search terms: the platform's own names and every launched ticker, unique. */
export function cloneTerms(tickers: readonly string[]): string[] {
  return [...new Set([...PLATFORM_TERMS, ...tickers.map((t) => t.toUpperCase().replace(/[^A-Z0-9]/g, "")).filter((t) => t.length >= 3)])];
}

/** One Solana pool of a candidate token, as DexScreener's search lists it. */
export interface PoolHit { mint: string; symbol: string; name: string; pool: string | null; dex: string | null; url: string | null; poolCreatedAt: number | null; liquidityUsd: number | null }

interface DexPair { chainId?: string; dexId?: string; url?: string; pairAddress?: string; baseToken?: { address?: string; name?: string; symbol?: string }; liquidity?: { usd?: number }; pairCreatedAt?: number }
/** DexScreener `/latest/dex/search` → Solana pools only, one row per (mint, pool). Prices, volume and market caps in the body are ignored. */
export function poolsFromDexScreener(body: unknown): PoolHit[] {
  const out = new Map<string, PoolHit>();
  for (const p of (body as { pairs?: DexPair[] } | null)?.pairs ?? []) {
    if (!p || p.chainId !== "solana" || !p.baseToken?.address) continue;
    const h: PoolHit = { mint: p.baseToken.address, symbol: p.baseToken.symbol ?? "", name: p.baseToken.name ?? "", pool: p.pairAddress ?? null, dex: p.dexId ?? null, url: p.url && /^https:\/\/dexscreener\.com\//.test(p.url) ? p.url : null, poolCreatedAt: typeof p.pairCreatedAt === "number" ? p.pairCreatedAt : null, liquidityUsd: typeof p.liquidity?.usd === "number" ? p.liquidity.usd : null };
    out.set(`${h.mint}:${h.pool}`, h);
  }
  return [...out.values()];
}

/** Which term a token resembles, and how: its ticker by skeleton (same letters, one edit, a copycat suffix), or its name containing the term. */
export function matchTerm(h: Pick<PoolHit, "symbol" | "name">, terms: readonly string[]): { term: string; how: string } | null {
  const sym = skeleton(h.symbol), name = skeleton(h.name);
  for (const t of terms) {
    const st = skeleton(t);
    const how = sym ? compare(sym, st) : null;
    if (how) return { term: t, how: how === "same-letters" ? "ticker reads as the same letters" : how === "one-edit" ? "ticker one letter away" : "ticker is a copycat variant" };
    if (st.length >= 5 && name.includes(st)) return { term: t, how: "name contains it" };
  }
  return null;
}

/**
 * The holder-stack signal: among the top holders (the pool's own account excluded), the largest group with the same share of supply
 * rounded to 0.01 %; a signal at BUNDLE_MIN_WALLETS or more. `amounts` are raw integer strings; `supply` the raw supply.
 */
export function bundleSignal(holders: readonly { address: string; amount: string }[], supply: string, exclude: readonly string[] = []): { wallets: number; sharePct: number } | null {
  const total = BigInt(supply || "0");
  if (total <= BigInt(0)) return null;
  const groups = new Map<number, number>();
  for (const h of holders.slice(0, 20)) {
    if (exclude.includes(h.address)) continue;
    const bps = Number((BigInt(h.amount || "0") * BigInt(10_000)) / total);
    if (bps <= 0) continue;
    groups.set(bps, (groups.get(bps) ?? 0) + 1);
  }
  let best: [number, number] | null = null;
  for (const [bps, n] of groups) if (!best || n > best[1] || (n === best[1] && bps > best[0])) best = [bps, n];
  return best && best[1] >= BUNDLE_MIN_WALLETS ? { wallets: best[1], sharePct: best[0] / 100 } : null;
}

/** The LP state over our observations of the token's deepest pool (oldest first). */
export function lpState(obs: readonly { at: number; liquidityUsd: number | null }[]): { state: "present" | "thin" | "pulled" | "unknown"; pulledAt: string | null } {
  const seen = obs.filter((o) => o.liquidityUsd !== null) as { at: number; liquidityUsd: number }[];
  if (!seen.length) return { state: "unknown", pulledAt: null };
  const last = seen[seen.length - 1];
  const peakAt = seen.findIndex((o) => o.liquidityUsd >= LP_PRESENT_USD);
  if (peakAt >= 0 && last.liquidityUsd < LP_GONE_USD) {
    const gone = seen.slice(peakAt).find((o) => o.liquidityUsd < LP_GONE_USD)!;
    return { state: "pulled", pulledAt: new Date(gone.at).toISOString() };
  }
  return { state: last.liquidityUsd >= LP_PRESENT_USD ? "present" : "thin", pulledAt: null };
}

export interface CloneRow {
  mint: string; chain: "solana"; symbol: string; name: string; pool: string | null; dex: string | null; url: string | null;
  firstSeenAt: string; lastSeenAt: string; poolCreatedAt: string | null;
  matched: { term: string; how: string }; registered: boolean | null;
  bundle: { wallets: number; sharePct: number } | null;
  lp: { state: "present" | "thin" | "pulled" | "unknown"; pulledAt: string | null };
  evidence: string[];
}

const utc = (iso: string) => `${iso.slice(11, 16)} UTC ${iso.slice(0, 10)}`;
/** The plain evidence lines for one token (what the list prints). */
export function evidenceLines(r: Omit<CloneRow, "evidence">): string[] {
  const out: string[] = [];
  out.push(r.registered === false ? "not registered with the burn_receipts program" : r.registered === true ? "registered with the burn_receipts program, but not a Burnticker coin" : "not in this host's Burnticker coin list; the burn_receipts program check was unavailable here, so registration is unknown");
  out.push(`$${r.symbol || "?"}: ${r.matched.how} — ${r.matched.term === "BURNTICKER" ? "Burnticker" : `$${r.matched.term}`}`);
  if (r.bundle) out.push(`${r.bundle.wallets} wallets hold identical ${r.bundle.sharePct.toFixed(2)} %`);
  if (r.lp.state === "pulled" && r.lp.pulledAt) out.push(`LP pulled ${utc(r.lp.pulledAt)}`);
  else if (r.lp.state === "thin") out.push(`pool liquidity under $${LP_PRESENT_USD} when seen`);
  if (r.poolCreatedAt) out.push(`pool created ${utc(r.poolCreatedAt)}`);
  return out;
}

// ---- the store (append-only) ----------------------------------------------------------------------------------------------------

export const CLONE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS clone_observations (mint TEXT NOT NULL, observed_at INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (mint, observed_at));
CREATE TABLE IF NOT EXISTS clone_scans (at INTEGER PRIMARY KEY, hits INTEGER NOT NULL, errors TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS clone_observations_no_update BEFORE UPDATE ON clone_observations BEGIN SELECT RAISE(ABORT, 'clone_observations: append-only'); END;
CREATE TRIGGER IF NOT EXISTS clone_observations_no_delete BEFORE DELETE ON clone_observations BEGIN SELECT RAISE(ABORT, 'clone_observations: append-only'); END;
CREATE TRIGGER IF NOT EXISTS clone_scans_no_update BEFORE UPDATE ON clone_scans BEGIN SELECT RAISE(ABORT, 'clone_scans: append-only'); END;
CREATE TRIGGER IF NOT EXISTS clone_scans_no_delete BEFORE DELETE ON clone_scans BEGIN SELECT RAISE(ABORT, 'clone_scans: append-only'); END;
`;

/** One observation of one token in one scan. */
export interface CloneObservation { mint: string; at: number; symbol: string; name: string; pool: string | null; dex: string | null; url: string | null; poolCreatedAt: number | null; liquidityUsd: number | null; matched: { term: string; how: string }; registered: boolean | null; bundle: { wallets: number; sharePct: number } | null }

export class CloneStore {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; db.exec(CLONE_SCHEMA_SQL); }
  observe(o: CloneObservation): void { this.db.prepare("INSERT OR IGNORE INTO clone_observations (mint, observed_at, json) VALUES (?,?,?)").run(o.mint, o.at, JSON.stringify(o)); }
  scan(at: number, hits: number, errors: readonly string[]): void { this.db.prepare("INSERT OR IGNORE INTO clone_scans (at, hits, errors) VALUES (?,?,?)").run(at, hits, JSON.stringify(errors)); }
  observations(): CloneObservation[] { return (this.db.prepare("SELECT json FROM clone_observations ORDER BY observed_at, mint").all() as { json: string }[]).map((r) => JSON.parse(r.json) as CloneObservation); }
  lastScan(): { at: string; hits: number; errors: string[] } | null { const r = this.db.prepare("SELECT at, hits, errors FROM clone_scans ORDER BY at DESC LIMIT 1").get() as { at: number; hits: number; errors: string } | undefined; return r ? { at: new Date(r.at).toISOString(), hits: r.hits, errors: JSON.parse(r.errors) as string[] } : null; }
}
const stores = new WeakMap<DatabaseSync, CloneStore>();
export function cloneStore(db: DatabaseSync): CloneStore { let s = stores.get(db); if (!s) { s = new CloneStore(db); stores.set(db, s); } return s; }

/** The public list: the latest observation per token, with its first-seen time, the LP state over its history and the evidence. */
export function cloneRows(obs: readonly CloneObservation[], ownMints: ReadonlySet<string> = new Set()): CloneRow[] {
  const by = new Map<string, CloneObservation[]>();
  for (const o of obs) if (!ownMints.has(o.mint)) by.set(o.mint, [...(by.get(o.mint) ?? []), o]);
  const rows: CloneRow[] = [];
  for (const [mint, list] of by) {
    const hist = [...list].sort((a, b) => a.at - b.at), last = hist[hist.length - 1];
    const bundle = [...hist].reverse().find((o) => o.bundle)?.bundle ?? null;
    const base: Omit<CloneRow, "evidence"> = {
      mint, chain: "solana", symbol: last.symbol, name: last.name, pool: last.pool, dex: last.dex, url: last.url,
      firstSeenAt: new Date(hist[0].at).toISOString(), lastSeenAt: new Date(last.at).toISOString(), poolCreatedAt: last.poolCreatedAt ? new Date(last.poolCreatedAt).toISOString() : null,
      matched: last.matched, registered: last.registered, bundle, lp: lpState(hist.map((o) => ({ at: o.at, liquidityUsd: o.liquidityUsd }))),
    };
    rows.push({ ...base, evidence: evidenceLines(base) });
  }
  return rows.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt) || a.mint.localeCompare(b.mint));
}

export interface ClonesJson { schema: typeof CLONES_SCHEMA; generatedAt: string; terms: string[]; note: string; clones: CloneRow[]; lastScan: { at: string; hits: number; errors: string[] } | null }
export const CLONES_NOTE = "Tokens whose name or ticker resembles a Burnticker coin and that are not Burnticker coins, with what the chain and the pool index showed. Evidence only — no person is named and no intent is claimed. Check any mint yourself on /burnticker/verify.";
export function clonesJson(store: CloneStore, terms: readonly string[], ownMints: ReadonlySet<string>, nowMs: number): ClonesJson {
  return { schema: CLONES_SCHEMA, generatedAt: new Date(nowMs).toISOString(), terms: [...terms], note: CLONES_NOTE, clones: cloneRows(store.observations(), ownMints), lastScan: store.lastScan() };
}

// ---- one scan ---------------------------------------------------------------------------------------------------------------------

export interface CloneWatchDeps {
  terms: readonly string[]; ownMints: ReadonlySet<string>; fetchImpl: FetchLike; now: () => number;
  /** The burn_receipts program's view of a mint: true / false, or null when this host does not read the program. */
  registered?: (mint: string) => Promise<boolean | null>;
  /** Top holders (raw amounts) and the raw supply, from an RPC; null when not readable. */
  holders?: (mint: string) => Promise<{ holders: { address: string; amount: string }[]; supply: string; exclude: string[] } | null>;
  /** Pause between searches (DexScreener allows 300 a minute; we stay far under). */
  pauseMs?: number;
}

/** One scan: every term searched, every lookalike Solana token that is not ours observed once. Returns the observations and errors. */
export async function scanClones(d: CloneWatchDeps): Promise<{ observations: CloneObservation[]; errors: string[] }> {
  const at = d.now(), errors: string[] = [];
  const best = new Map<string, PoolHit & { matched: { term: string; how: string } }>();
  for (const term of d.terms) {
    try {
      const res = await d.fetchImpl(dexSearchUrl(term));
      if (!res.ok) { errors.push(`search ${term}: HTTP ${res.status}`); continue; }
      for (const h of poolsFromDexScreener(await res.json())) {
        if (d.ownMints.has(h.mint)) continue;
        const m = matchTerm(h, d.terms);
        if (!m) continue;
        const have = best.get(h.mint);
        if (!have || (h.liquidityUsd ?? -1) > (have.liquidityUsd ?? -1)) best.set(h.mint, { ...h, matched: m });
      }
    } catch (e) { errors.push(`search ${term}: ${(e as Error).message.slice(0, 120)}`); }
    if (d.pauseMs) await new Promise((r) => setTimeout(r, d.pauseMs));
  }
  const observations: CloneObservation[] = [];
  for (const h of best.values()) {
    const registered = d.registered ? await d.registered(h.mint).catch(() => null) : null;
    if (registered === true && d.ownMints.has(h.mint)) continue;
    let bundle: CloneObservation["bundle"] = null;
    if (d.holders) { try { const r = await d.holders(h.mint); if (r) bundle = bundleSignal(r.holders, r.supply, [...r.exclude, ...(h.pool ? [h.pool] : [])]); } catch (e) { errors.push(`holders ${h.mint.slice(0, 8)}: ${(e as Error).message.slice(0, 80)}`); } }
    observations.push({ mint: h.mint, at, symbol: h.symbol, name: h.name, pool: h.pool, dex: h.dex, url: h.url, poolCreatedAt: h.poolCreatedAt, liquidityUsd: h.liquidityUsd, matched: h.matched, registered, bundle });
  }
  return { observations, errors };
}

/** Scan and record (append-only). */
export async function runCloneWatch(store: CloneStore, d: CloneWatchDeps): Promise<{ hits: number; errors: string[] }> {
  const { observations, errors } = await scanClones(d);
  for (const o of observations) store.observe(o);
  store.scan(d.now(), observations.length, errors);
  return { hits: observations.length, errors };
}
