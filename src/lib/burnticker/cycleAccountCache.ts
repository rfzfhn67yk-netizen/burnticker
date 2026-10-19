import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import { configPda, feePda, pairLinkPda, pairResultPda, readingPda } from "@/lib/burnReceipts/pda";

/**
 * THE KEEPER'S PER-CYCLE ACCOUNT CACHE (2026-10-15; docs/burnticker/API-BUDGETS.md "Per-cycle account cache").
 *
 * Measured on 2026-10-15 (six live coins, the live registry replayed against the public RPC with the budget's phase:method split): a
 * steady keeper cycle made about 120 Helius calls, and about 100 of them were getAccountInfo of the SAME few dozen accounts, read one at a
 * time by different steps — the pair links read four accounts per pair coin in pair-ctx, again per pair in pair-alerts and in pair-unlink
 * (drafts included), the TokenConfigs again in pair-gates and the fence, the lock-fee locate() five accounts per coin. Every one of those is
 * one credit, every cycle, every minute.
 *
 * This cache sits UNDER every one of those reads (it wraps the keeper's program Connection, so no step changes):
 *
 *   learn      every address a cycle reads (getAccountInfo, getMultipleAccountsInfo, getBalance, getTokenSupply, getTokenAccountBalance)
 *              is remembered for `keepCycles` cycles
 *   prefetch   `beginCycle()` reads every remembered address in ONE getMultipleAccountsInfo per 100 (one credit each), so the steady
 *              cycle's reads are served from it: getAccountInfo / getMultipleAccountsInfo as returned, getBalance as the account's lamports
 *              (0 for no account, as getBalance answers), getTokenSupply / getTokenAccountBalance decoded from the SPL layout
 *   fresh after our own send
 *              any send (sendRawTransaction, sendTransaction, sendEncodedTransaction, and the private send route through
 *              privateSend.ts onPrivateSend) drops every cached value first, so a read after one of the keeper's own transactions is never
 *              served from before it; the next read of a remembered address re-prefetches them all in one call, at or after the newest
 *              slot a confirmation reported (minContextSlot), so a lagging load-balanced backend cannot serve the pre-send state
 *   fresh before a coin's sends
 *              before the fence and each executePending of a coin with something it could SEND this cycle (a reading date assigned, or a
 *              closed day to attest) and not on a dry or held cycle, the keeper re-reads THAT coin's TokenConfig, fee PDA, mint and reading
 *              PDAs in one call (refresh(); KeeperDeps.freshReads): about one credit per pass, up to five passes per such coin per cycle
 *   epochs     a read that was in flight when the values were dropped never writes its (older) answer back
 *   scope      values live for ONE cycle (the keeper calls beginCycle() at the top of every loop); nothing is carried across cycles but the
 *              address list. A read the cache cannot answer exactly (another commitment, a dataSlice, an encoding) goes to the RPC.
 *
 * WHAT A STEP SEES does not change: the same bytes the same call returned at the start of this cycle, or after the keeper's own last
 * send (test/burntickerCycleCache.test.ts compares served answers with direct ones). A third party's transaction between the prefetch and a
 * step is the same race the per-call reads had: every keeper send is simulated first, and a stale plan is refused and retried next cycle.
 */

const TOKEN_PROGRAMS = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
export const CYCLE_PREFETCH_MAX = 100;
/** Retries of a read the backend refused with -32016 ("minimum context slot has not been reached"), 400 ms apart. */
export const FLOOR_RETRIES = 3;
const isMinSlotError = (e: unknown): boolean => { const m = String((e as { message?: unknown })?.message ?? e); return /-32016|minimum context slot/i.test(m) || (e as { code?: unknown })?.code === -32016; };

type Acc = AccountInfo<Buffer> | null;
interface Held { acc: Acc; slot: number }
/** SPL Token-2022 accounts longer than the base layout carry their AccountType at byte 165: 1 mint, 2 token account. */
const isTokenAccount = (a: AccountInfo<Buffer>): boolean => TOKEN_PROGRAMS.has(a.owner.toBase58()) && (a.data.length === 165 || (a.data.length > 165 && a.data[165] === 2));
const isMint = (a: AccountInfo<Buffer>): boolean => TOKEN_PROGRAMS.has(a.owner.toBase58()) && (a.data.length === 82 || (a.data.length > 165 && a.data[165] === 1));
/** The slice of a web3.js Connection the cache reads through. */
export type CacheableConnection = Pick<Connection, "getMultipleAccountsInfo"> & Record<string, unknown>;

export interface CycleCacheStats { cycles: number; prefetchCalls: number; prefetched: number; served: number; passed: number; invalidations: number; refreshes: number }

/** Only "confirmed" (or the connection default) is served: the keeper's program Connection is built with commitment "confirmed". */
function servable(arg: unknown): boolean {
  if (arg === undefined || arg === "confirmed") return true;
  if (arg && typeof arg === "object") {
    const keys = Object.keys(arg as object);
    return keys.every((k) => k === "commitment") && ((arg as { commitment?: unknown }).commitment ?? "confirmed") === "confirmed";
  }
  return false;
}
const keyOf = (pk: PublicKey | string): string => (typeof pk === "string" ? pk : pk.toBase58());
const ui = (amount: bigint, decimals: number) => {
  const s = amount.toString().padStart(decimals + 1, "0");
  const str = decimals ? `${s.slice(0, -decimals)}.${s.slice(-decimals)}`.replace(/\.?0+$/, "") : s;
  return { amount: amount.toString(), decimals, uiAmount: Number(str), uiAmountString: str };
};

export class CycleAccountCache {
  readonly stats: CycleCacheStats = { cycles: 0, prefetchCalls: 0, prefetched: 0, served: 0, passed: 0, invalidations: 0, refreshes: 0 };
  private values = new Map<string, Held>();
  private learned = new Map<string, number>();
  private cycle = 0;
  private epoch = 0;
  private stale = false;
  private minSlot = 0;
  private genesis: string | null = null;
  private readonly keepCycles: number;
  private readonly conn: CacheableConnection;
  private readonly sleep: (ms: number) => Promise<void>;
  constructor(conn: CacheableConnection, o: { keepCycles?: number; sleep?: (ms: number) => Promise<void> } = {}) {
    this.conn = conn; this.keepCycles = Math.max(1, o.keepCycles ?? 10); this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** The remembered addresses (the next prefetch). */
  addresses(): string[] { return [...this.learned.keys()]; }
  /** The newest confirmed slot a getSignatureStatuses answer reported (the floor of the next re-prefetch). */
  confirmedSlot(): number { return this.minSlot; }
  private learn(k: string): void { this.learned.set(k, this.cycle); }

  /**
   * The top of a keeper cycle: forget every value, drop addresses unused for keepCycles cycles, and read the rest in one
   * getMultipleAccountsInfo per 100. A failed prefetch is logged and the cycle's reads go to the RPC as before. Returns the count read.
   */
  async beginCycle(log?: (s: string) => void): Promise<number> {
    // the slot floor is per cycle (re-review N2): a confirmed slot from one endpoint is never applied to another one's reads next cycle
    this.cycle++; this.stats.cycles++; this.epoch++; this.minSlot = 0;
    for (const [k, c] of this.learned) if (this.cycle - c > this.keepCycles) this.learned.delete(k);
    this.values.clear(); this.stale = false;
    return this.prefetch(log);
  }
  /**
   * One getMultipleAccountsInfo(AndContext) at or after the slot floor. RPC error -32016 (the backend has not reached minContextSlot yet,
   * typical right after a send on a load-balanced RPC) is retried `FLOOR_RETRIES` times 400 ms apart; then it throws.
   */
  private async readMany(pks: PublicKey[]): Promise<{ accs: Acc[]; slot: number }> {
    const conn = this.conn as unknown as Record<string, unknown>;
    const cfg: { commitment: "confirmed"; minContextSlot?: number } = this.minSlot > 0 ? { commitment: "confirmed", minContextSlot: this.minSlot } : { commitment: "confirmed" };
    for (let attempt = 0; ; attempt++) {
      try {
        if (typeof conn.getMultipleAccountsInfoAndContext === "function") {
          const r = await (conn.getMultipleAccountsInfoAndContext as (p: unknown, c: unknown) => Promise<{ context: { slot: number }; value: Acc[] }>).call(conn, pks, cfg);
          return { accs: r.value, slot: r.context?.slot ?? 0 };
        }
        return { accs: (await this.conn.getMultipleAccountsInfo(pks, cfg as never)) as Acc[], slot: 0 };
      } catch (e) {
        if (attempt >= FLOOR_RETRIES || !isMinSlotError(e)) throw e;
        await this.sleep(400);
      }
    }
  }
  private async prefetch(log?: (s: string) => void, only?: readonly string[]): Promise<number> {
    const keys = only ? [...only] : this.addresses();
    if (!keys.length) return 0;
    const { PublicKey } = await import("@solana/web3.js");
    const ep = this.epoch;
    let n = 0;
    for (let i = 0; i < keys.length; i += CYCLE_PREFETCH_MAX) {
      const chunk = keys.slice(i, i + CYCLE_PREFETCH_MAX);
      try {
        const { accs, slot } = await this.readMany(chunk.map((k) => new PublicKey(k)));
        this.stats.prefetchCalls++;
        if (ep !== this.epoch) return n;   // dropped while in flight: never write an older answer back
        chunk.forEach((k, j) => { this.values.set(k, { acc: (accs[j] ?? null) as Acc, slot }); });
        n += chunk.length;
      } catch (e) { log?.(`  [cycle-cache] prefetch failed, these reads go to the RPC one account at a time: ${(e as Error).message.slice(0, 160)}`); break; }
    }
    this.stats.prefetched += n;
    return n;
  }
  /**
   * Re-reads `keys` (one coin's TokenConfig, fee PDA, mint and reading PDAs) in one call at or after the slot floor, and only those
   * (re-review N1: a coin's fresh read before its fence and cranks costs one credit, not a re-read of every coin's accounts). The other
   * values stay. A failed read drops the keys, so they pass through to the RPC.
   */
  async refresh(keys: readonly string[], log?: (s: string) => void): Promise<number> {
    const uniq = [...new Set(keys)];
    if (!uniq.length) return 0;
    for (const k of uniq) { this.learn(k); this.values.delete(k); }
    this.epoch++;
    const n = await this.prefetch(log, uniq);
    this.stats.refreshes++;
    return n;
  }
  /** Drops every value (the keeper's own send; a pair-curve crank; before a coin's fence and crank). The next read re-prefetches. */
  invalidateAll(): void { this.epoch++; if (this.values.size) this.stats.invalidations++; this.values.clear(); this.stale = true; }
  /** A confirmed slot seen elsewhere (the next re-prefetch reads at or after it). */
  noteConfirmedSlot(slot: number): void { if (Number.isFinite(slot) && slot > this.minSlot) this.minSlot = slot; }

  /** The cached value of `k` (undefined: not cached). After an invalidation a remembered address re-prefetches the list once. */
  private async lookup(k: string): Promise<Held | undefined> {
    if (this.values.has(k)) return this.values.get(k)!;
    if (this.stale && this.learned.has(k)) { this.stale = false; await this.prefetch(); if (this.values.has(k)) return this.values.get(k)!; }
    return undefined;
  }
  /** Caches a pass-through answer: never one from before an invalidation (epoch), never one older than this cycle's slot floor (N2). */
  private put(ep: number, k: string, acc: Acc, slot: number): void { if (ep === this.epoch && slot >= this.minSlot) this.values.set(k, { acc, slot }); }

  /** The Connection the keeper hands to its program client, the lock-fee and pair clients and the pair-curve crank. */
  connection<C extends object>(): C {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the overriding methods below are object-literal methods, whose own `this` is the proxy object
    const self = this, conn = this.conn as unknown as Record<string, unknown>;
    const pass = (name: string) => (conn[name] as (...a: unknown[]) => unknown).bind(conn);
    const over: Record<string, unknown> = {
      async getAccountInfo(pk: PublicKey, arg?: unknown) {
        const k = keyOf(pk);
        if (!servable(arg)) { self.stats.passed++; return pass("getAccountInfo")(pk, arg); }
        self.learn(k);
        const v = await self.lookup(k);
        if (v !== undefined) { self.stats.served++; return v.acc; }
        self.stats.passed++;
        const ep = self.epoch;
        // with its context slot (item 7), so the floor can judge it; a connection without the AndContext call caches nothing after a floor
        if (typeof conn.getAccountInfoAndContext === "function") {
          // with the slot floor when one is set (a lagging backend answers -32016, retried; past the retries an unfloored read, not cached)
          const floored = self.minSlot > 0 ? { commitment: "confirmed", minContextSlot: self.minSlot } : (arg ?? "confirmed");
          let r: { context: { slot: number }; value: Acc };
          for (let attempt = 0; ; attempt++) {
            try { r = (await pass("getAccountInfoAndContext")(pk, floored)) as typeof r; break; }
            catch (e) {
              if (!isMinSlotError(e) || floored === arg || typeof floored === "string") throw e;
              if (attempt >= FLOOR_RETRIES) { r = (await pass("getAccountInfoAndContext")(pk, arg ?? "confirmed")) as typeof r; break; }
              await self.sleep(400);
            }
          }
          self.put(ep, k, r.value ?? null, r.context?.slot ?? 0);
          return r.value;
        }
        const a = (await pass("getAccountInfo")(pk, arg)) as Acc;
        self.put(ep, k, a ?? null, 0);
        return a;
      },
      async getMultipleAccountsInfo(pks: PublicKey[], arg?: unknown) {
        if (!servable(arg)) { self.stats.passed++; return pass("getMultipleAccountsInfo")(pks, arg); }
        const keys = pks.map(keyOf);
        keys.forEach((k) => self.learn(k));
        const have: (Held | undefined)[] = [];
        for (const k of keys) have.push(await self.lookup(k));
        if (have.every((h) => h !== undefined)) { self.stats.served++; return have.map((h) => h!.acc); }
        // a partial hit reads the WHOLE batch fresh (item 7): one answer never mixes slots
        self.stats.passed++;
        const ep = self.epoch;
        const { accs, slot } = await self.readMany(pks);
        keys.forEach((k, i) => self.put(ep, k, accs[i] ?? null, slot));
        return keys.map((_, i) => accs[i] ?? null);
      },
      async getBalance(pk: PublicKey, arg?: unknown) {
        const k = keyOf(pk);
        if (!servable(arg)) { self.stats.passed++; return pass("getBalance")(pk, arg); }
        self.learn(k);
        const v = await self.lookup(k);
        if (v !== undefined) { self.stats.served++; return v.acc ? v.acc.lamports : 0; }
        self.stats.passed++;
        return pass("getBalance")(pk, arg);
      },
      async getTokenSupply(mint: PublicKey, arg?: unknown) {
        const k = keyOf(mint);
        if (!servable(arg)) { self.stats.passed++; return pass("getTokenSupply")(mint, arg); }
        self.learn(k);
        const v = await self.lookup(k);
        if (v?.acc && isMint(v.acc) && v.acc.data.length >= 45) {
          self.stats.served++;
          return { context: { slot: v.slot }, value: ui(v.acc.data.readBigUInt64LE(36), v.acc.data[44]) };
        }
        self.stats.passed++;
        return pass("getTokenSupply")(mint, arg);   // no mint account: the RPC's own error, as before
      },
      async getTokenAccountBalance(acct: PublicKey, arg?: unknown) {
        const k = keyOf(acct);
        if (!servable(arg)) { self.stats.passed++; return pass("getTokenAccountBalance")(acct, arg); }
        self.learn(k);
        const v = await self.lookup(k);
        if (v?.acc && isTokenAccount(v.acc)) {
          const mintKey = new (await import("@solana/web3.js")).PublicKey(v.acc.data.subarray(0, 32)).toBase58();
          self.learn(mintKey);
          const m = await self.lookup(mintKey);
          if (m?.acc && isMint(m.acc) && m.acc.data.length >= 45) { self.stats.served++; return { context: { slot: v.slot }, value: ui(v.acc.data.readBigUInt64LE(64), m.acc.data[44]) }; }
        }
        self.stats.passed++;
        return pass("getTokenAccountBalance")(acct, arg);
      },
      // the keyed RPC's genesis (getGenesisHash never moves to the hold fallback, apiBudget.ts NO_FALLBACK), read once per process
      async getGenesisHash() {
        if (self.genesis) { self.stats.served++; return self.genesis; }
        self.stats.passed++;
        self.genesis = (await pass("getGenesisHash")()) as string;
        return self.genesis;
      },
      // confirmations are never cached; their slots become the floor of the next re-prefetch
      async getSignatureStatuses(...a: unknown[]) {
        const r = (await pass("getSignatureStatuses")(...a)) as { value?: ({ slot?: number; confirmationStatus?: string } | null)[] } | undefined;
        for (const x of r?.value ?? []) if (x && typeof x.slot === "number" && (x.confirmationStatus === "confirmed" || x.confirmationStatus === "finalized")) self.noteConfirmedSlot(x.slot);
        return r;
      },
    };
    for (const send of ["sendRawTransaction", "sendTransaction", "sendEncodedTransaction"]) {
      over[send] = (...a: unknown[]) => { self.invalidateAll(); return pass(send)(...a); };
    }
    return new Proxy(conn, {
      get(t, p, r) {
        if (typeof p === "string" && Object.prototype.hasOwnProperty.call(over, p)) return over[p];
        const v = Reflect.get(t, p, r);
        return typeof v === "function" ? v.bind(t) : v;
      },
    }) as unknown as C;
  }
}

/**
 * The accounts a coin's fence and crank steps read, for refresh() before them (KeeperDeps.freshReads): its TokenConfig, fee PDA, mint,
 * the reading PDA of each date, and for a pair coin both PairLinks and the PairResult of each date (crank.ts planCrank reads them).
 */
export function freshReadKeys(programId: PublicKey, mintS: string, dates: readonly number[], pair: { mintA: string; mintB: string } | null): string[] {
  const mint = new PublicKey(mintS), config = configPda(programId, mint);
  const keys: PublicKey[] = [config, feePda(programId, mint), mint, ...dates.map((D) => readingPda(programId, config, D))];
  if (pair) {
    const other = new PublicKey(pair.mintA === mintS ? pair.mintB : pair.mintA);
    keys.push(pairLinkPda(programId, mint), pairLinkPda(programId, other), ...dates.map((D) => pairResultPda(programId, mint, other, D)));
  }
  return keys.map((k) => k.toBase58());
}
