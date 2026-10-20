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
 */
export type SwrState = "hit" | "cold" | "version" | "stale-version" | "stale";
interface Entry<T> { at: number; version: string; value: T }
type Settled = { ok: true } | { ok: false; error: unknown };
export const SWR_BUILD_TIMEOUT_MS = 2 * 60_000;
export interface KeyedSwrOptions { freshMs: number; coldWaitMs: number; maxKeys?: number; maxStaleMs?: number; buildTimeoutMs?: number; log?: (key: string, e: unknown) => void }

export class KeyedSwr<T> {
  private memo = new Map<string, Entry<T>>();
  private inflight = new Map<string, { version: string; p: Promise<Settled>; startedAt: number }>();
  /** the sequence number of the build that last wrote each key: an older build that lands late never overwrites a newer answer */
  private written = new Map<string, number>();
  private seq = 0;
  private o: KeyedSwrOptions;
  private clock: () => number;
  constructor(o: KeyedSwrOptions, clock: () => number = Date.now) { this.o = o; this.clock = clock; }

  /** For tests and for a caller that knows a key changed. */
  clear(key?: string): void { if (key === undefined) { this.memo.clear(); this.written.clear(); } else { this.memo.delete(key); this.written.delete(key); } }
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
    const mine = ++this.seq;
    if ((this.written.get(key) ?? 0) > mine) return;
    this.written.set(key, mine);
    this.memo.delete(key);
    this.memo.set(key, { at: this.clock(), version, value });
    const max = this.o.maxKeys ?? 256;
    while (this.memo.size > max) { const old = this.memo.keys().next().value as string; this.memo.delete(old); this.written.delete(old); }
  }

  private refresh(key: string, version: string, build: () => Promise<T>): Promise<Settled> {
    let f = this.inflight.get(key);
    // F02: a build in flight past buildTimeoutMs counts as failed; it is dropped (left to land or not) and a new one starts
    const bound = this.o.buildTimeoutMs;
    if (f && bound !== undefined && this.clock() - f.startedAt >= bound) {
      this.o.log?.(key, new Error(`a refresh has been in flight for more than ${Math.round(bound / 1000)} s; starting another`));
      this.inflight.delete(key);
      f = undefined;
    }
    if (f && f.version === version) return f.p;
    // one refresh in flight per key: a newer version waits for the older build to land, then builds itself
    const mine = ++this.seq;
    const run = async (): Promise<Settled> => {
      try {
        const value = await build();
        if ((this.written.get(key) ?? 0) > mine) return { ok: true };
        this.written.set(key, mine);
        this.memo.delete(key);
        this.memo.set(key, { at: this.clock(), version, value });
        const max = this.o.maxKeys ?? 256;
        while (this.memo.size > max) { const old = this.memo.keys().next().value as string; this.memo.delete(old); this.written.delete(old); }
        return { ok: true };
      } catch (error) { this.o.log?.(key, error); return { ok: false, error }; }
    };
    const p: Promise<Settled> = (f ? f.p.then(run) : run()).finally(() => { if (this.inflight.get(key)?.p === p) this.inflight.delete(key); });
    this.inflight.set(key, { version, p, startedAt: this.clock() });
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
