/**
 * A BOUNDED, REMEMBERED READ (continuous audit HB-31 / HB-35, 2026-10-19). A league page waited on the schedule read on every cold render
 * (up to 3 s each time, and longer while the one event loop was busy), and a sitemap URL hit Caddy's 20 s fallback. The answer is kept
 * per key for `freshMs`; an older answer is served at once while one refresh runs behind it; a key never read waits at most `coldWaitMs`,
 * then the page renders without it (null) and the read finishes in the background for the next visitor. A failed read is null.
 */
export function boundedMemo<T>(o: { freshMs: number; coldWaitMs: number; maxKeys?: number; now?: () => number }) {
  const now = o.now ?? Date.now, max = o.maxKeys ?? 64;
  const kept = new Map<string, { at: number; v: T | null }>();
  const running = new Map<string, Promise<T | null>>();
  const start = (key: string, read: () => Promise<T | null>): Promise<T | null> => {
    const have = running.get(key);
    if (have) return have;
    const p = read().catch(() => null).then((v) => {
      if (kept.size >= max && !kept.has(key)) kept.clear();
      kept.set(key, { at: now(), v });
      running.delete(key);
      return v;
    });
    running.set(key, p);
    return p;
  };
  return {
    async get(key: string, read: () => Promise<T | null>): Promise<T | null> {
      const k = kept.get(key);
      if (k) { if (now() - k.at >= o.freshMs) void start(key, read); return k.v; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const v = await Promise.race([start(key, read), new Promise<null>((res) => { timer = setTimeout(() => res(null), o.coldWaitMs); })]);
      clearTimeout(timer);
      return v;
    },
    clear(): void { kept.clear(); running.clear(); },
  };
}
