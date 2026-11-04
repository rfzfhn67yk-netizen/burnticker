/**
 * A BOUNDED, REMEMBERED READ (continuous audit HB-31 / HB-35, 2026-10-19). A league page waited on the schedule read on every cold render
 * (up to 3 s each time, and longer while the one event loop was busy), and a sitemap URL hit Caddy's 20 s fallback. The answer is kept
 * per key for `freshMs`; an older answer is served at once while one refresh runs behind it; a key never read waits at most `coldWaitMs`,
 * then the page renders without it (null) and the read finishes in the background for the next visitor. A failed read is null.
 *
 * Sixth pass B-10 (2026-10-19, the creator page's coins): two optional bounds. `readMs`: a read still running after this counts as
 * failed (null), so a hung chain read never holds its key. `nullMs`: a failed read is retried after this (default `freshMs`), and that
 * retry is waited for like a cold read, so one failure does not blank a key for the whole fresh window.
 */
export function boundedMemo<T>(o: { freshMs: number; coldWaitMs: number; maxKeys?: number; now?: () => number; readMs?: number; nullMs?: number }) {
  const now = o.now ?? Date.now, max = o.maxKeys ?? 64, nullMs = o.nullMs ?? o.freshMs;
  const kept = new Map<string, { at: number; v: T | null }>();
  const running = new Map<string, Promise<T | null>>();
  const bounded = (read: () => Promise<T | null>): Promise<T | null> => {
    const p = Promise.resolve().then(read);
    if (o.readMs === undefined) return p;
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([p, new Promise<null>((res) => { timer = setTimeout(() => res(null), o.readMs); })]).finally(() => clearTimeout(timer));
  };
  const start = (key: string, read: () => Promise<T | null>): Promise<T | null> => {
    const have = running.get(key);
    if (have) return have;
    const p = bounded(read).catch(() => null).then((v) => {
      if (kept.size >= max && !kept.has(key)) kept.clear();
      kept.set(key, { at: now(), v });
      running.delete(key);
      return v;
    });
    running.set(key, p);
    return p;
  };
  const waitCold = async (key: string, read: () => Promise<T | null>, waitMs = o.coldWaitMs): Promise<T | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const v = await Promise.race([start(key, read), new Promise<null>((res) => { timer = setTimeout(() => res(null), waitMs); })]);
    clearTimeout(timer);
    return v;
  };
  return {
    /** `coldWaitMs` overrides the memo's own cold wait for this call (audit 7 B-10: the creator page streams each coin and waits longer). */
    async get(key: string, read: () => Promise<T | null>, g: { coldWaitMs?: number } = {}): Promise<T | null> {
      const k = kept.get(key);
      if (k && k.v === null && now() - k.at >= nullMs) return waitCold(key, read, g.coldWaitMs);
      if (k) { if (now() - k.at >= o.freshMs) void start(key, read); return k.v; }
      return waitCold(key, read, g.coldWaitMs);
    },
    clear(): void { kept.clear(); running.clear(); },
  };
}
