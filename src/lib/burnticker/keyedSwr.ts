/**
 * A STALE-WHILE-REVALIDATE MEMO PER KEY (2026-10-15, owner: "any way to speed up the site? pages take a bit to load"). The coin route
 * keeps each coin's last answer: served at once while its version matches, refreshed in the background once older than `freshMs`, with
 * one refresh in flight per key. A first read, or a read whose version changed (a launch, a new receipt), waits for its build up to
 * `coldWaitMs`; past that the caller gets the previous version's answer when there is one (state "stale-version") or nothing (null, so
 * the route answers 503 with retry-after). A build that fails with nothing to serve throws its error to the waiting caller. At most
 * `maxKeys` answers are kept (the oldest goes first). No timers outlive a call: the cold wait's timer is cleared when the build lands.
 *
 * 2026-10-18 prelaunch audit F02: the answer had no maximum age. While a refresh kept failing, or never landed, a matching-version
 * answer was a "hit" at any age (the audit served a 21-hour-old pool read as a hit). Now:
 * - `maxStaleMs` (optional): an answer older than this is no longer a hit. The caller waits for the refresh up to `coldWaitMs`, like a
 *   new version; if no fresh answer lands, it gets the old one with state "stale" and its age, so the route can say so.
 * - `buildTimeoutMs` (optional, opt-in; the coin route uses SWR_BUILD_TIMEOUT_MS, 2 minutes): a refresh still in flight after this
 *   counts as failed. The next read starts a new one instead
 *   of waiting on it, and a newer version no longer queues behind it. A late landing of the abandoned build never overwrites an answer
 *   a later build already wrote.
 *
 * 2026-10-22 external audit BT-SWR-EVICTION-RACE-01: an abandoned build that landed after a newer answer AND an eviction of its key found
 * no bookkeeping left and wrote its old answer back as an age-zero hit. Now an abandoned build never writes (it is marked by its own
 * sequence number when dropped), and a key's write bookkeeping outlives eviction while any build for it is pending.
 */
export type SwrState = "hit" | "cold" | "version" | "stale-version" | "stale";
interface Entry<T> { at: number; version: string; value: T }
type Settled = { ok: true } | { ok: false; error: unknown };
export const SWR_BUILD_TIMEOUT_MS = 2 * 60_000;
export interface KeyedSwrOptions { freshMs: number; coldWaitMs: number; maxKeys?: number; maxStaleMs?: number; buildTimeoutMs?: number; log?: (key: string, e: unknown) => void }

export class KeyedSwr<T> {
  private memo = new Map<string, Entry<T>>();
  private inflight = new Map<string, { version: string; p: Promise<Settled>; startedAt: number; seq: number }>();
  /** BT-SWR-EVICTION-RACE-01: builds dropped past buildTimeoutMs, by sequence number; such a build never writes when it lands */
  private abandoned = new Set<number>();
  /**
   * the sequence number of the build (or put) that last wrote each key: an older build that lands late never overwrites a newer answer.
   * BT-SWR-EVICTION-RACE-01 (2026-10-22 external audit): this bookkeeping used to be dropped with the answer when `maxKeys` evicted the
   * key, so an abandoned older build that landed after a newer answer AND an eviction saw no entry, took that as "I am current" and wrote
   * its old answer back as an age-zero hit. An entry now outlives eviction while any build for its key is still pending (`pending`), and is
   * dropped only once the key has neither an answer nor a build that could land.
   */
  private written = new Map<string, number>();
  /** builds started and not yet settled, per key (a build abandoned past buildTimeoutMs still counts until it lands or fails) */
  private pending = new Map<string, number>();
  private seq = 0;
  private o: KeyedSwrOptions;
  private clock: () => number;
  constructor(o: KeyedSwrOptions, clock: () => number = Date.now) { this.o = o; this.clock = clock; }

  /** For tests and for a caller that knows a key changed. */
  clear(key?: string): void {
    // a build still in flight for a cleared key must not write its answer back afterwards: its key keeps a sequence number above it
    const forget = (k: string) => { this.memo.delete(k); if (this.pending.has(k)) this.written.set(k, ++this.seq); else this.written.delete(k); };
    if (key === undefined) for (const k of new Set([...this.memo.keys(), ...this.written.keys()])) forget(k); else forget(key);
  }
  size(): number { return this.memo.size; }
  /**
   * HB-35 (2026-10-20): another reader's look at a kept answer, without starting a build: the value when its version matches and it is
   * younger than `maxAgeMs` (default `freshMs`), else undefined. The pair route reads each side's coin answer this way.
   */
  peek(key: string, version: string, maxAgeMs: number = this.o.freshMs): T | undefined {
    const m = this.memo.get(key);
    return m && m.version === version && this.clock() - m.at < maxAgeMs ? m.value : undefined;
  }
  /**
   * HB-35: an answer another reader built just now (the pair route's side read, the same read the coin route makes) is kept as if this
   * memo had built it. It never replaces an answer a build in flight wrote later (the sequence numbers), and it respects `maxKeys`.
   */
  put(key: string, version: string, value: T): void {
    this.write(key, ++this.seq, version, value);
  }

  /** Writes `value` as build/put `mine`, unless a later one already wrote the key; evicts past `maxKeys`. True when it wrote. */
  private write(key: string, mine: number, version: string, value: T): boolean {
    if ((this.written.get(key) ?? 0) > mine) return false;
    this.written.set(key, mine);
    this.memo.delete(key);
    this.memo.set(key, { at: this.clock(), version, value });
    const max = this.o.maxKeys ?? 256;
    while (this.memo.size > max) { const old = this.memo.keys().next().value as string; this.memo.delete(old); if (!this.pending.has(old)) this.written.delete(old); }
    return true;
  }
  private settle(key: string): void {
    const n = (this.pending.get(key) ?? 1) - 1;
    if (n > 0) { this.pending.set(key, n); return; }
    this.pending.delete(key);
    // nothing left that could land for this key: its bookkeeping goes when its answer is gone too (bounded by maxKeys + pending keys)
    if (!this.memo.has(key)) this.written.delete(key);
  }

  private refresh(key: string, version: string, build: () => Promise<T>): Promise<Settled> {
    let f = this.inflight.get(key);
    // F02: a build in flight past buildTimeoutMs counts as failed; it is dropped (left to land or not) and a new one starts
    const bound = this.o.buildTimeoutMs;
    if (f && bound !== undefined && this.clock() - f.startedAt >= bound) {
      this.o.log?.(key, new Error(`a refresh has been in flight for more than ${Math.round(bound / 1000)} s; starting another`));
      this.inflight.delete(key);
      this.abandoned.add(f.seq);
      f = undefined;
    }
    if (f && f.version === version) return f.p;
    // one refresh in flight per key: a newer version waits for the older build to land, then builds itself
    const mine = ++this.seq;
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
    const run = async (): Promise<Settled> => {
      try {
        if (this.abandoned.has(mine)) return { ok: true };   // dropped before its turn in the queue: never started
        const value = await build();
        // an abandoned build no longer owns the key: whatever it brings back is dropped, whether or not a newer answer has landed
        if (!this.abandoned.has(mine)) this.write(key, mine, version, value);
        return { ok: true };
      } catch (error) { this.o.log?.(key, error); return { ok: false, error }; }
    };
    const chained = f ? f.p.then(run) : run();
    void chained.finally(() => { this.abandoned.delete(mine); this.settle(key); });
    const p: Promise<Settled> = chained.finally(() => { if (this.inflight.get(key)?.p === p) this.inflight.delete(key); });
    this.inflight.set(key, { version, p, startedAt: this.clock(), seq: mine });
    return p;
  }

  /** Waits for a build up to coldWaitMs; null when it has not settled by then. */
  private async waitFor(p: Promise<Settled>): Promise<Settled | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([p, new Promise<null>((r) => { timer = setTimeout(() => r(null), this.o.coldWaitMs); })]);
    clearTimeout(timer);
    return settled;
  }

  async get(key: string, version: string, build: () => Promise<T>): Promise<{ value: T; state: SwrState; ageMs: number } | null> {
    const m = this.memo.get(key);
    if (m && m.version === version) {
      const age = this.clock() - m.at;
      if (age < this.o.freshMs) return { value: m.value, state: "hit", ageMs: age };
      const p = this.refresh(key, version, build);
      if (this.o.maxStaleMs === undefined || age < this.o.maxStaleMs) return { value: m.value, state: "hit", ageMs: age };
      // F02: past the maximum age the answer is not a hit; a refresh that lands within the cold wait is served instead
      await this.waitFor(p);
      const n = this.memo.get(key);
      if (n && n !== m && n.version === version) return { value: n.value, state: "hit", ageMs: this.clock() - n.at };
      return { value: m.value, state: "stale", ageMs: this.clock() - m.at };
    }
    const p = this.refresh(key, version, build);
    const settled = await this.waitFor(p);
    const n = this.memo.get(key);
    if (n && n.version === version) return { value: n.value, state: m ? "version" : "cold", ageMs: this.clock() - n.at };
    if (m) return { value: m.value, state: "stale-version", ageMs: this.clock() - m.at };
    if (settled && !settled.ok) throw settled.error;
    return null;
  }
}
