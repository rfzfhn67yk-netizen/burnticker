/**
 * A BOUNDED MAP (2026-10-15 prelaunch audit M8): the response caches keyed by URL (Polymarket, Kalshi, the sports feeds) and the fee
 * ledger's per-transaction reads grew with every distinct key a visitor could make the server read. This Map keeps at most `max` entries:
 * a get or set moves the key to the newest end, and a set past the bound drops the oldest. Client-safe.
 */
export class LruMap<K, V> extends Map<K, V> {
  readonly max: number;
  constructor(max: number) { super(); this.max = Math.max(1, Math.floor(max)); }
  override get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const v = super.get(key) as V;
    super.delete(key); super.set(key, v);
    return v;
  }
  override set(key: K, value: V): this {
    if (super.has(key)) super.delete(key);
    super.set(key, value);
    while (super.size > this.max) { const first = super.keys().next(); if (first.done) break; super.delete(first.value); }
    return this;
  }
}
