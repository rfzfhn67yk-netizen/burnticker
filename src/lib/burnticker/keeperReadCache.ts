import { PublicKey } from "@solana/web3.js";
import { decodeTokenConfig } from "@/lib/burnReceipts/accounts";
import { configPda, feePda } from "@/lib/burnReceipts/pda";
import { configView } from "@/lib/burnKeeper/programAdapter";
import type { ProgramConfigView, ProgramPort } from "@/lib/burnKeeper/programPort";
import type { BurnProgramClient } from "@/lib/burnticker/program";
import type { LockFeesClient, LockFeesPort, LockFeesState } from "@/lib/burnticker/lockFees";
import type { MarketReader } from "@/lib/burnticker/market";
import type { CycleReport } from "@/lib/burnticker/multiKeeper";
import { programPageBlock } from "@/lib/burnticker/program";
import { readMarket } from "@/lib/burnticker/market";
import { lpLockBlock } from "@/lib/burnticker/lpLockPage";
import { pairCounterpartFrom } from "@/lib/burnticker/tokenPage";
import { DISPERSAL_STATE_KEY, dispersalLines } from "@/lib/burnticker/dispersalKeeper";
import { DECIMALS, TOTAL_SUPPLY } from "@/lib/burnticker/rules";
import type { Registry, TokenRow } from "@/lib/burnticker/registry";

/**
 * THE PLATFORM KEEPER'S READ CACHE (2026-10-13, docs/burnticker/API-BUDGETS.md). The keeper publishes every coin's status.json once a
 * minute, and before this cache each publish re-read every coin's chain state one account at a time: about 10 to 14 Helius calls per
 * live coin per cycle, which spent the keeper's 120,000-credit day at about 7 live coins. Most of those facts change rarely (supply after
 * a burn, the TokenConfig after a reading or a crank, the LP lock after graduation), so this cache keeps each one for a TTL and drops a
 * coin's entries the moment the keeper itself changes that coin on chain:
 *
 *   field     TTL     what it is                                                    read by (before)
 *   supply    5 min   the mint's supply                                             program.supplyRaw (getTokenSupply)
 *   config    5 min   the TokenConfig (programPageBlock, the pair clause)           port.config() (getAccountInfo)
 *   lp        5 min   the LP lock's state (lpLockBlock, the claim_lock_fees step)   lockFees.port().state() (3 to 7 calls)
 *   vault     5 min   the program vault's balance (vault mode)                      program.vaultBalanceRaw (2 calls)
 *   feePda    60 s    the burn pool's lamports                                      program.feePdaBalanceLamports (getBalance)
 *   market    60 s    the coin card's curve and top holders                         readMarket (3 calls)
 *   pool      60 s    the LaunchLab pool account (inside the market read)           getAccountInfo
 *   owners    5 min   the top holders' owner addresses (inside the market read)     getMultipleParsedAccounts
 *
 * THE BATCH: `prefetch` reads the TokenConfig, the fee PDA, the mint, the vault (vault mode) and the LaunchLab pool of EVERY published coin
 * in one getMultipleAccounts call per 100 accounts (20 coins), through the keeper's budgeted Connection, and fills the fields above from
 * it. With the fee PDA's 60 s TTL the batch runs once per cycle: a flat cost, not a per-coin one. A failed batch leaves the fields alone
 * and the per-coin reads fill them as before.
 *
 * INVALIDATION: after each cycle the keeper drops every coin whose registry signatures changed (a reading, a crank, a claim, a
 * registration, a dispersal piece: each is written ahead to the signatures table before it is sent) and every coin the cycle report
 * names as confirmed or claimed; the lock-fee port drops its coin before any send. So a burn's effect shows on the very next publish.
 *
 * WHAT IS PUBLISHED does not change: the cached value is the value the same read returned, and the batch decodes the same accounts the
 * per-coin reads fetch (test/burntickerReadCache.test.ts compares the two byte for byte).
 */

export const READ_TTL_MS = { supply: 300_000, config: 300_000, lp: 300_000, vault: 300_000, feePda: 60_000, market: 60_000, pool: 60_000, owners: 300_000 } as const;
export type ReadField = keyof typeof READ_TTL_MS;

/** One coin in the batch read: its mint, whether it runs in vault mode, and its LaunchLab pool (the market read's first account). */
export interface BatchItem { mint: string; vault: boolean; poolId: string | null }
/** What the batch read learned about one coin. A field left undefined was not decodable; the per-coin read fills it. */
export interface BatchFacts { config?: ProgramConfigView | null; feePdaLamports?: bigint; supplyRaw?: bigint | null; vaultRaw?: bigint; pool?: { data: Uint8Array | Buffer; owner: PublicKey } | null }
export interface BatchReader { readMany(items: readonly BatchItem[]): Promise<Map<string, BatchFacts>> }

const TOKEN_PROGRAMS = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
export const BATCH_MAX_ACCOUNTS = 100;

type AccountLike = { data: Uint8Array | Buffer; owner: PublicKey; lamports: number } | null;
/** The slice of @solana/web3.js Connection the batch uses. */
export interface MultipleAccountsReader { getMultipleAccountsInfo(pks: PublicKey[], commitment?: "confirmed"): Promise<AccountLike[]> }

/**
 * The real batch: one getMultipleAccountsInfo per 100 accounts, decoded exactly as the per-coin reads decode them (programClient.ts
 * feePdaBalanceLamports / supplyRaw / vaultBalanceRaw, programAdapter.ts config()). Commitment "confirmed", as those reads use.
 */
export function connectionBatchReader(conn: MultipleAccountsReader, programId: PublicKey, vaultFor: (mint: string) => string): BatchReader {
  return {
    async readMany(items) {
      const keys: { mint: string; field: "config" | "feePda" | "mint" | "vault" | "pool"; pk: PublicKey }[] = [];
      for (const it of items) {
        const mint = new PublicKey(it.mint);
        keys.push({ mint: it.mint, field: "config", pk: configPda(programId, mint) }, { mint: it.mint, field: "feePda", pk: feePda(programId, mint) }, { mint: it.mint, field: "mint", pk: mint });
        if (it.vault) keys.push({ mint: it.mint, field: "vault", pk: new PublicKey(vaultFor(it.mint)) });
        if (it.poolId) keys.push({ mint: it.mint, field: "pool", pk: new PublicKey(it.poolId) });
      }
      const out = new Map<string, BatchFacts>();
      for (let i = 0; i < keys.length; i += BATCH_MAX_ACCOUNTS) {
        const chunk = keys.slice(i, i + BATCH_MAX_ACCOUNTS);
        const accs = await conn.getMultipleAccountsInfo(chunk.map((k) => k.pk), "confirmed");
        chunk.forEach((k, j) => {
          const a = accs[j] ?? null, f = out.get(k.mint) ?? {};
          out.set(k.mint, f);
          const data = a ? Buffer.from(a.data) : null;
          if (k.field === "config") {
            // fetchTokenConfig: no account = null; an account the program does not own throws there, and every page read turns that into null
            if (!a || !a.owner.equals(programId)) f.config = null;
            else { try { f.config = configView(programId, new PublicKey(k.mint), decodeTokenConfig(data!)); } catch { /* undecodable: the per-coin read decides */ } }
          } else if (k.field === "feePda") f.feePdaLamports = BigInt(a?.lamports ?? 0);   // getBalance of a missing account is 0
          else if (k.field === "mint") {
            // getTokenSupply throws for a missing mint, and supplyRaw turns that into null
            if (!a) f.supplyRaw = null;
            else if (TOKEN_PROGRAMS.has(a.owner.toBase58()) && data!.length >= 44) f.supplyRaw = data!.readBigUInt64LE(36);
          } else if (k.field === "vault") {
            if (!a) f.vaultRaw = BigInt(0);   // vaultBalanceRaw: no vault account yet = 0
            else if (TOKEN_PROGRAMS.has(a.owner.toBase58()) && data!.length >= 72) f.vaultRaw = data!.readBigUInt64LE(64);
          } else f.pool = a ? { data: a.data, owner: a.owner } : null;
        });
      }
      return out;
    },
  };
}

/** The coins a cycle report says changed on chain: a confirmed crank or adoption, a landed lock-fee claim, a landed dispersal piece. */
export function mintsChangedBy(report: CycleReport | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!report) return out;
  for (const r of report.executed) if (r.outcome === "confirmed") out.add(r.mint);
  for (const r of report.lpFees ?? []) if (r.outcome === "claimed") out.add(r.mint);
  for (const r of report.dispersal ?? []) if ((r as { action?: string }).action === "landed") out.add(r.mint);
  return out;
}

/** One fingerprint per mint of its rows in the registry's signatures table (count, confirmed count, last send): any send or confirmation changes it. */
export function signatureFingerprints(db: { prepare(sql: string): { all(): unknown[] } }): Map<string, string> {
  const rows = db.prepare("SELECT mint, COUNT(*) AS n, SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) AS c, MAX(sent_at) AS m FROM signatures GROUP BY mint").all() as { mint: string; n: number; c: number; m: number }[];
  return new Map(rows.map((r) => [r.mint, `${r.n}:${r.c}:${r.m}`]));
}

export class KeeperReadCache {
  private entries = new Map<string, Map<string, { at: number; v: unknown }>>();
  private owners = new Map<string, { at: number; v: { data: unknown } | null }>();
  private prints = new Map<string, string>();
  readonly ttl: Record<ReadField, number>;
  readonly stats = { hits: 0, misses: 0, batches: 0, invalidations: 0 };
  private o: { now: () => number; ttl?: Partial<Record<ReadField, number>> };
  constructor(o: { now: () => number; ttl?: Partial<Record<ReadField, number>> }) { this.o = o; this.ttl = { ...READ_TTL_MS, ...(o.ttl ?? {}) }; }

  private slot(mint: string) { let m = this.entries.get(mint); if (!m) { m = new Map(); this.entries.set(mint, m); } return m; }
  private fresh(mint: string, key: string, field: ReadField): { v: unknown } | null {
    const e = this.entries.get(mint)?.get(key);
    return e && this.o.now() - e.at < this.ttl[field] ? e : null;
  }
  set(mint: string, field: ReadField, v: unknown, key: string = field): void { this.slot(mint).set(key, { at: this.o.now(), v }); }
  peek<T>(mint: string, field: ReadField, key: string = field): T | undefined { const e = this.fresh(mint, key, field); return e ? (e.v as T) : undefined; }
  /** The cached value within its TTL, else `load()` (cached when `keep` accepts it; a throw is never cached). */
  async get<T>(mint: string, field: ReadField, load: () => Promise<T>, o: { key?: string; keep?: (v: T) => boolean } = {}): Promise<T> {
    const key = o.key ?? field;
    const e = this.fresh(mint, key, field);
    if (e) { this.stats.hits++; return e.v as T; }
    this.stats.misses++;
    const v = await load();
    if (!o.keep || o.keep(v)) this.set(mint, field, v, key);
    return v;
  }
  invalidate(mint: string): void { if (this.entries.delete(mint)) this.stats.invalidations++; }
  invalidateAll(): void { this.entries.clear(); this.owners.clear(); }
  /** After a cycle: drop every coin the report changed and every coin whose registry signatures changed since the last call. */
  afterCycle(report: CycleReport | null | undefined, fingerprints: Map<string, string>): string[] {
    const dropped = new Set(mintsChangedBy(report));
    for (const [mint, fp] of fingerprints) if (this.prints.has(mint) && this.prints.get(mint) !== fp) dropped.add(mint);
    this.prints = new Map(fingerprints);
    for (const m of dropped) this.invalidate(m);
    return [...dropped];
  }
  /**
   * The batch: the coins whose batched fields are stale, read in one getMultipleAccounts call per 100 accounts. Every published coin
   * rides it; a failure is logged and the per-coin reads fill the fields instead.
   */
  async prefetch(batch: BatchReader | null, items: readonly BatchItem[], log?: (s: string) => void): Promise<number> {
    if (!batch) return 0;
    const due = items.filter((it) => this.peek(it.mint, "feePda") === undefined || this.peek(it.mint, "config") === undefined || this.peek(it.mint, "supply") === undefined
      || (it.vault && this.peek(it.mint, "vault") === undefined) || (it.poolId !== null && this.peek(it.mint, "pool", `pool:${it.poolId}`) === undefined));
    if (!due.length) return 0;
    let got: Map<string, BatchFacts>;
    try { got = await batch.readMany(due); this.stats.batches++; } catch (e) { log?.(`  [read-cache] batch read failed, per-coin reads this cycle: ${(e as Error).message.slice(0, 160)}`); return 0; }
    for (const it of due) {
      const f = got.get(it.mint);
      if (!f) continue;
      if (f.config !== undefined) this.set(it.mint, "config", f.config);
      if (f.feePdaLamports !== undefined) this.set(it.mint, "feePda", f.feePdaLamports);
      if (f.supplyRaw !== undefined && f.supplyRaw !== null) this.set(it.mint, "supply", f.supplyRaw);
      if (it.vault && f.vaultRaw !== undefined) this.set(it.mint, "vault", f.vaultRaw);
      if (it.poolId !== null && f.pool !== undefined) this.set(it.mint, "pool", f.pool, `pool:${it.poolId}`);
    }
    return due.length;
  }

  /** The owners of token accounts (the market read's second call), per address for READ_TTL_MS.owners. */
  async parsedAccounts(reader: MarketReader, pks: PublicKey[]): Promise<{ value: ({ data: unknown } | null)[] }> {
    const now = this.o.now(), ttl = this.ttl.owners;
    const keys = pks.map((p) => p.toBase58());
    if (keys.every((k) => { const e = this.owners.get(k); return e && now - e.at < ttl; })) { this.stats.hits++; return { value: keys.map((k) => this.owners.get(k)!.v) }; }
    this.stats.misses++;
    const r = await reader.getMultipleParsedAccounts(pks);
    keys.forEach((k, i) => this.owners.set(k, { at: now, v: r.value[i] ?? null }));
    return r;
  }
}

/** A method-preserving view of `target` with some members replaced (class instances keep their prototype methods, bound to the target). */
function overlay<T extends object>(target: T, over: Partial<Record<keyof T, unknown>>): T {
  return new Proxy(target, {
    get(t, p, r) {
      if (Object.prototype.hasOwnProperty.call(over, p)) return (over as Record<PropertyKey, unknown>)[p];
      const v = Reflect.get(t, p, r);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

/**
 * The lock-fee client through the cache: `state()` is kept for READ_TTL_MS.lp (a state read with the accrual serves a later read without
 * it; the reverse does not); any build or send for a coin drops that coin first, so a claim or a registration is never planned from a
 * cached state and its effect shows on the next publish.
 */
export function cachedLockFees(client: LockFeesClient, cache: KeeperReadCache): LockFeesClient {
  const ports = new Map<string, LockFeesPort>();
  return overlay(client, {
    port: (mint: string): LockFeesPort => {
      const have = ports.get(mint);
      if (have) return have;
      const base = client.port(mint);
      const drop = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => { cache.invalidate(mint); return f(...a); };
      const p = overlay(base, {
        state: async (so?: { accrued?: boolean }): Promise<LockFeesState> => {
          const wantAccrued = so?.accrued !== false;
          const hit = cache.peek<{ s: LockFeesState; accrued: boolean }>(mint, "lp");
          if (hit && (hit.accrued || !wantAccrued)) { cache.stats.hits++; return hit.s; }
          cache.stats.misses++;
          const s = await base.state(so);
          cache.set(mint, "lp", { s, accrued: wantAccrued });
          return s;
        },
        buildRegisterFeeKey: drop(() => base.buildRegisterFeeKey()), buildRegisterPool: drop(() => base.buildRegisterPool()), buildClaim: drop(() => base.buildClaim()),
        send: drop((raw: Uint8Array) => base.send(raw)),
      });
      ports.set(mint, p);
      return p;
    },
  });
}

/**
 * The program client the PUBLISH loop reads through: supply, the fee PDA, the vault, the TokenConfig and the LP lock come from the cache
 * (and the batch). Everything else (sends, the pair reads, the attester keys) passes straight through. Never handed to runCycle's crank
 * path, which reads the TokenConfig fresh before every step.
 */
export function cachedPublishProgram(program: BurnProgramClient, cache: KeeperReadCache): BurnProgramClient {
  const ports = new Map<string, ProgramPort>();
  return overlay(program, {
    supplyRaw: (mint: string) => cache.get(mint, "supply", () => program.supplyRaw(mint), { keep: (v) => v !== null }),
    feePdaBalanceLamports: (mint: string) => cache.get(mint, "feePda", () => program.feePdaBalanceLamports(mint)),
    vaultBalanceRaw: (mint: string) => cache.get(mint, "vault", () => program.vaultBalanceRaw(mint)),
    port: (mint: string): ProgramPort => {
      const have = ports.get(mint);
      if (have) return have;
      const base = program.port(mint);   // throws as before for a mint the client cannot serve
      const p = overlay(base, { config: () => cache.get(mint, "config", () => base.config()) });
      ports.set(mint, p);
      return p;
    },
    ...(program.lockFees ? { lockFees: cachedLockFees(program.lockFees, cache) } : {}),
  } as Partial<Record<keyof BurnProgramClient, unknown>>);
}

/** The program client runCycle uses: unchanged, except its lock-fee client (the claim_lock_fees step shares the publish's LP lock entry). */
export function withLockFees(program: BurnProgramClient, lockFees: LockFeesClient): BurnProgramClient {
  return overlay(program, { lockFees } as Partial<Record<keyof BurnProgramClient, unknown>>);
}

/**
 * The market reader through the cache: the LaunchLab pool account from the batch (60 s), the owners of the top token accounts per
 * address (5 min; a token account's owner does not change with trading). getTokenLargestAccounts is read each time: it is the one
 * per-coin call a quiet cycle makes.
 */
export function cachedMarketReader(reader: MarketReader, cache: KeeperReadCache, mintOfPool: (poolId: string) => string | null): MarketReader {
  return {
    getAccountInfo: async (pk) => {
      const id = pk.toBase58(), mint = mintOfPool(id);
      if (!mint) return reader.getAccountInfo(pk);
      return cache.get(mint, "pool", () => reader.getAccountInfo(pk), { key: `pool:${id}` });
    },
    getTokenLargestAccounts: (mint) => reader.getTokenLargestAccounts(mint),
    getMultipleParsedAccounts: (pks) => cache.parsedAccounts(reader, pks),
  };
}

/**
 * THE CHAIN PART OF ONE COIN'S PUBLISH INPUT (moved here from scripts/burnticker-keeper.mts publishAll, unchanged in order and meaning):
 * the `chain`, `pair`, `lp` and `market` fields of the token page input. The keeper passes the cached program and market reader; a test
 * passes the raw ones and compares.
 */
export async function coinChainReads(o: { registry: Registry; program: BurnProgramClient; cluster: string; t: TokenRow; mode: "buyback" | "vault"; marketReader: MarketReader | null; now: number }) {
  const { registry, program, cluster, t } = o;
  return {
    chain: { cluster, programId: program.programId, supplyRaw: await program.supplyRaw(t.mint), feePdaLamports: await program.feePdaBalanceLamports(t.mint), vaultRaw: o.mode === "vault" ? await program.vaultBalanceRaw(t.mint) : null, program: await programPageBlock(program, t.mint, registry.lastProgramTx(t.mint, "reading"), dispersalLines(registry.getStatus(DISPERSAL_STATE_KEY(t.mint)))) },
    pair: await pairCounterpartFrom(registry, (m) => program.supplyRaw(m), t, async (m) => { try { return (await program.port(m).config())?.poolRegistered ?? null; } catch { return null; } }, program.pairForward ? (a, b) => program.pairForward!.port(a, b).links() : undefined),
    // the coin card's curve progress + top holders (read-only, the same RPC); without an RPC status.json says "not read" and the card shows —
    lp: await lpLockBlock(registry, program, cluster, t.mint),
    market: o.marketReader && t.status !== "draft" && t.status !== "expired" ? await readMarket(o.marketReader, { cluster, mint: t.mint, poolId: t.poolId, feePda: t.feePda, creator: t.creator, totalSupplyRaw: (await program.supplyRaw(t.mint).catch(() => null)) ?? BigInt(TOTAL_SUPPLY) * BigInt(10) ** BigInt(DECIMALS), decimals: DECIMALS }, o.now).catch(() => null) : null,
  };
}
