/**
 * A BOUNDED MAP (2026-10-15 prelaunch audit M8): the response caches keyed by URL (Polymarket, Kalshi, the sports feeds) and the fee
 * ledger's per-transaction reads grew with every distinct key a visitor could make the server read. This Map keeps at most `max` entries:
 * a get or set moves the key to the newest end, and a set past the bound drops the oldest. Client-safe.
 *
 * HB-1 (2026-10-19, two out-of-memory crashes of the live web process): a bound on entries alone is not a bound on memory. The
 * Polymarket cache held whole Gamma answers, a search answer near 0.8 MB of heap and an events page up to 7 MB, so its 1,000 entries
 * could hold more than the process's whole 2 GB heap; a local run of wizard searches put 410 MB of a 533 MB heap in that one cache.
 * With `maxWeight` and `weigh` the map also keeps the summed weight of its entries (for a response cache: the answer's JSON length,
 * jsonBytes) at or under `maxWeight`, dropping the least recently used first. The newest entry is never dropped by the weight rule, so
 * one answer heavier than the whole budget is still served from memory until the next set.
 */
export class LruMap<K, V> extends Map<K, V> {
  readonly max: number;
  readonly maxWeight: number;
  private readonly weigh: ((v: V) => number) | null;
  private readonly weights = new Map<K, number>();
  private total = 0;
  constructor(max: number, o: { maxWeight?: number; weigh?: (v: V) => number } = {}) {
    super();
    this.max = Math.max(1, Math.floor(max));
    this.maxWeight = o.maxWeight !== undefined && o.weigh ? Math.max(0, o.maxWeight) : Infinity;
    this.weigh = o.weigh ?? null;
  }
  /** The summed weight of the entries held (0 without `weigh`). */
  get weight(): number { return this.total; }
  override get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const v = super.get(key) as V;
    super.delete(key); super.set(key, v);
    return v;
  }
  override set(key: K, value: V): this {
    if (super.has(key)) this.delete(key);
    super.set(key, value);
    if (this.weigh) {
      let w = 0;
      try { w = Math.max(0, Number(this.weigh(value)) || 0); } catch { w = 0; }
      this.weights.set(key, w); this.total += w;
    }
    while (super.size > this.max || (this.total > this.maxWeight && super.size > 1)) {
      const first = super.keys().next();
      if (first.done || (first.value === key && super.size === 1)) break;
      this.delete(first.value);
    }
    return this;
  }
  override delete(key: K): boolean {
    const w = this.weights.get(key);
    if (w !== undefined) { this.total -= w; this.weights.delete(key); }
    return super.delete(key);
  }
  override clear(): void { this.weights.clear(); this.total = 0; super.clear(); }
}

/**
 * The size of a parsed JSON answer as its JSON text length (a stand-in for its heap cost, which runs a few times higher). Measured once,
 * when the answer is cached; a value that cannot be serialised weighs 1 KiB.
 */
export function jsonBytes(v: unknown): number {
  try { const s = JSON.stringify(v); return typeof s === "string" ? s.length : 0; } catch { return 1024; }
}

/** The weight of a `{ body }` cache entry (the response caches of the oracle and source clients). */
export const bodyBytes = <T extends { body: unknown }>(e: T): number => jsonBytes(e.body);

/**
 * HB-1: the upstream clients' `requests` lists (the tests' politeness checks) gained one URL per upstream read for the life of the
 * process. They keep the newest REQUEST_LOG_MAX.
 */
export const REQUEST_LOG_MAX = 1_000;
export function logRequest(list: string[], url: string): void {
  list.push(url);
  if (list.length > REQUEST_LOG_MAX) list.splice(0, list.length - REQUEST_LOG_MAX);
}

/**
 * HB-1: the response caches' size budgets, in characters of JSON (the heap cost runs two to four times higher). Together at most about
 * 170 MB of JSON, well under the web's deliberate 1,536 MB heap (deploy/systemd/mct-burnticker-web.service). Polymarket's is the largest
 * because its searches and events pages are the heaviest answers and the wizard repeats them most.
 */
export const POLY_CACHE_BYTES = 64 * 1024 * 1024;
export const KALSHI_CACHE_BYTES = 48 * 1024 * 1024;
export const SPORTS_CACHE_BYTES = 32 * 1024 * 1024;
export const NWS_CACHE_BYTES = 16 * 1024 * 1024;
export const FEC_CACHE_BYTES = 8 * 1024 * 1024;
