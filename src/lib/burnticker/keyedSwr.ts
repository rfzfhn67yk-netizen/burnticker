/**
 * A STALE-WHILE-REVALIDATE MEMO PER KEY (2026-10-15, owner: "any way to speed up the site? pages take a bit to load"). The coin route
 * keeps each coin's last answer: served at once while its version matches, refreshed in the background once older than `freshMs`, with
 * one refresh in flight per key. A first read, or a read whose version changed (a launch, a new receipt), waits for its build up to
 * `coldWaitMs`; past that the caller gets the previous version's answer when there is one (state "stale-version") or nothing (null, so
 * the route answers 503 with retry-after). A build that fails with nothing to serve throws its error to the waiting caller. At most
 * `maxKeys` answers are kept (the oldest goes first). No timers outlive a call: the cold wait's timer is cleared when the build lands.
 */
export type SwrState = "hit" | "cold" | "version" | "stale-version";
interface Entry<T> { at: number; version: string; value: T }
type Settled = { ok: true } | { ok: false; error: unknown };

export class KeyedSwr<T> {
  private memo = new Map<string, Entry<T>>();
  private inflight = new Map<string, { version: string; p: Promise<Settled> }>();
  private o: { freshMs: number; coldWaitMs: number; maxKeys?: number; log?: (key: string, e: unknown) => void };
  private clock: () => number;
  constructor(o: { freshMs: number; coldWaitMs: number; maxKeys?: number; log?: (key: string, e: unknown) => void }, clock: () => number = Date.now) { this.o = o; this.clock = clock; }

  /** For tests and for a caller that knows a key changed. */
  clear(key?: string): void { if (key === undefined) this.memo.clear(); else this.memo.delete(key); }
  size(): number { return this.memo.size; }

  private refresh(key: string, version: string, build: () => Promise<T>): Promise<Settled> {
    const f = this.inflight.get(key);
    if (f && f.version === version) return f.p;
    // one refresh in flight per key: a newer version waits for the older build to land, then builds itself
    const run = async (): Promise<Settled> => {
      try {
        const value = await build();
        this.memo.delete(key);
        this.memo.set(key, { at: this.clock(), version, value });
        const max = this.o.maxKeys ?? 256;
        while (this.memo.size > max) this.memo.delete(this.memo.keys().next().value as string);
        return { ok: true };
      } catch (error) { this.o.log?.(key, error); return { ok: false, error }; }
    };
    const p: Promise<Settled> = (f ? f.p.then(run) : run()).finally(() => { if (this.inflight.get(key)?.p === p) this.inflight.delete(key); });
    this.inflight.set(key, { version, p });
    return p;
  }

  async get(key: string, version: string, build: () => Promise<T>): Promise<{ value: T; state: SwrState; ageMs: number } | null> {
    const m = this.memo.get(key);
    if (m && m.version === version) {
      if (this.clock() - m.at >= this.o.freshMs) void this.refresh(key, version, build);
      return { value: m.value, state: "hit", ageMs: this.clock() - m.at };
    }
    const p = this.refresh(key, version, build);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([p, new Promise<null>((r) => { timer = setTimeout(() => r(null), this.o.coldWaitMs); })]);
    clearTimeout(timer);
    const n = this.memo.get(key);
    if (n && n.version === version) return { value: n.value, state: m ? "version" : "cold", ageMs: this.clock() - n.at };
    if (m) return { value: m.value, state: "stale-version", ageMs: this.clock() - m.at };
    if (settled && !settled.ok) throw settled.error;
    return null;
  }
}
