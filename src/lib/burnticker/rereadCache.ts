/**
 * A SHARED CLIENT READ THAT IS REPEATED (prelaunch audit 2026-10-18 A-23). The coin list and the home data were read once per browser
 * session (one promise kept for good), and after about twenty minutes of browsing the index said "The coin list was last read on … and
 * may be out of date" although the client itself had refused to read it again. Every reader still shares one request at a time, but a
 * read older than `maxAgeMs` is made again; a failed read is dropped at once so the next caller retries. Client-safe; no timers.
 *
 * REREAD_MS is shorter than the coin list's freshness window (coinsGrid.ts STALE_AFTER_MS, five minutes), so the stale line only
 * shows when the site's own index is old or the repeated reads keep failing, never because this page stopped asking.
 */
export const REREAD_MS = 60_000;

export class RereadCache<T> {
  private at = 0;
  private p: Promise<T> | null = null;
  private readonly maxAgeMs: number;
  private readonly clock: () => number;
  constructor(maxAgeMs: number = REREAD_MS, clock: () => number = Date.now) { this.maxAgeMs = maxAgeMs; this.clock = clock; }
  /** The shared read: the one in flight or a recent one, else a new read. */
  get(read: () => Promise<T>): Promise<T> {
    const now = this.clock();
    if (this.p && now - this.at < this.maxAgeMs) return this.p;
    const p = read();
    this.p = p; this.at = now;
    p.catch(() => { if (this.p === p) this.p = null; });
    return p;
  }
  /** Forget the kept read (tests; an explicit retry). */
  clear(): void { this.p = null; this.at = 0; }
}

/** True when a page should read again now: visible, and its last attempt is at least REREAD_MS old. */
export const rereadDue = (lastAttemptAt: number, now: number, visible: boolean, everyMs = REREAD_MS): boolean => visible && now - lastAttemptAt >= everyMs;
