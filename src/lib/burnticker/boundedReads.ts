/**
 * BOUNDED COIN READS FOR THE LIST BUILDS (HB-145 second half, 2026-10-20).
 *
 * The home, the coins index and the feeds rebuild by reading every coin (server.ts tokenPageData). A coin read is a chain of awaited RPC
 * calls (the holders, the lifecycle walk of up to 20 getTransaction calls, the curve), each queued behind the web's share of the Helius
 * rate (apiBudget.ts). When one coin's holders and dates fell due together the build waited for the slowest coin: 17 s on 2026-10-20.
 *
 * Now each build reads its coins through readCoinsBounded:
 *   - at most `concurrency` new reads at a time, as before;
 *   - one deadline for the whole stage (`deadlineMs` from the start): a coin whose read has not landed by then is served from its last
 *     good read, marked with that read's time (readAgo: "read 3 minutes ago"), and with no earlier read it counts as failed, which each
 *     route already handles (the home card says "Unavailable", the index and the feeds leave it out);
 *   - a read that misses the deadline is not dropped: it keeps running, and when it lands it becomes the coin's last good read, so the
 *     next build has it. Its caches (holders, lifecycle dates, the read cache) fill for the next build too;
 *   - one read per coin at a time: a coin whose earlier read is still running is joined, not read again (it costs no new slot), so a slow
 *     coin never piles up reads behind the rate budget;
 *   - a coin not started by the deadline is not started: it takes its last good read, and the next build tries it first.
 * The kept reads live on globalThis, so the route bundles (each route is its own module copy in Next's build) share one store, one per
 * `scope` (the routes pass the platform's registry: a platform swapped in tests never serves another registry's reads).
 */
export type BoundedRead<T> =
  | { state: "fresh"; value: T; at: number }
  | { state: "earlier"; value: T; at: number; why: "late" | "failed"; error?: unknown }
  | { state: "failed"; error: unknown };

interface Kept<T> { at: number; value: T }
interface Store { good: Map<string, Kept<unknown>>; inflight: Map<string, Promise<unknown>>; tried: Map<string, number> }

const KEY = Symbol.for("burnticker.boundedReads");
const MAX_KEYS = 2_000;
const DEFAULT_SCOPE = {};
const stores = (): WeakMap<object, Store> => {
  const g = globalThis as unknown as Record<symbol, WeakMap<object, Store> | undefined>;
  return (g[KEY] ??= new WeakMap());
};
const store = (scope: object = DEFAULT_SCOPE): Store => {
  const all = stores();
  let s = all.get(scope);
  if (!s) { s = { good: new Map(), inflight: new Map(), tried: new Map() }; all.set(scope, s); }
  return s;
};

/** For tests: forgets every kept read and every read in flight of `scope`. */
export function clearBoundedReads(scope?: object): void { const s = store(scope); s.good.clear(); s.inflight.clear(); s.tried.clear(); }
/** For tests and the route logs: the last good read of `key`, if any. */
export function keptRead<T>(key: string, scope?: object): Kept<T> | undefined { return store(scope).good.get(key) as Kept<T> | undefined; }

export class ReadLateError extends Error {
  constructor(ms: number) { super(`not read within the build's ${Math.round(ms / 100) / 10} s budget`); this.name = "ReadLateError"; }
}

export interface BoundedOpts {
  concurrency: number;
  /** the stage's deadline for a coin that has a last good read to fall back on */
  deadlineMs: number;
  /**
   * the deadline for a coin with no earlier read (the first build after a start, a new coin): it would otherwise show as unreadable, so it
   * may wait longer, up to this (default `deadlineMs`). Only a build that has such a coin waits past `deadlineMs`.
   */
  coldDeadlineMs?: number;
  /** whose reads these are (the routes: the platform's registry); one store per scope */
  scope?: object;
  now?: () => number;
}

/**
 * Reads every item under the stage's deadline (see above). `items[i].key` names the coin and the kind of read ("lite:<mint>",
 * "full:<mint>"), so a lite and a full read of one coin never stand in for each other. Results are in the items' order and never reject.
 */
export async function readCoinsBounded<T>(items: readonly { key: string; read: () => Promise<T> }[], o: BoundedOpts): Promise<BoundedRead<T>[]> {
  const s = store(o.scope), now = o.now ?? Date.now;
  const out: BoundedRead<T>[] = new Array(items.length);
  const timers: ReturnType<typeof setTimeout>[] = [];
  const clock = (ms: number) => {
    const d = { expired: false, p: null as unknown as Promise<"late"> };
    d.p = new Promise<"late">((ok) => { const t = setTimeout(() => { d.expired = true; ok("late"); }, ms); (t as { unref?: () => void }).unref?.(); timers.push(t); });
    return d;
  };
  const coldMs = Math.max(o.deadlineMs, o.coldDeadlineMs ?? o.deadlineMs);
  const warm = clock(o.deadlineMs), cold = coldMs === o.deadlineMs ? warm : clock(coldMs);
  // the deadline that applies to a coin: the short one when it has a last good read to fall back on
  const limitOf = (key: string) => (s.good.has(key) ? { d: warm, ms: o.deadlineMs } : { d: cold, ms: coldMs });
  const fallback = (key: string, why: "late" | "failed", error: unknown): BoundedRead<T> => {
    const k = s.good.get(key) as Kept<T> | undefined;
    return k ? { state: "earlier", value: k.value, at: k.at, why, ...(why === "failed" ? { error } : {}) } : { state: "failed", error };
  };
  const start = (key: string, read: () => Promise<T>): Promise<T> => {
    const p = Promise.resolve().then(read);
    s.inflight.set(key, p);
    s.tried.set(key, now());
    p.then((value) => { keep(s, key, { at: now(), value }); }, () => { /* a failed read keeps the last good one */ })
      .finally(() => { if (s.inflight.get(key) === p) s.inflight.delete(key); });
    return p;
  };
  const settle = async (i: number, p: Promise<T>) => {
    const key = items[i].key, lim = limitOf(key);
    try {
      const r = await Promise.race([p, lim.d.p]);
      out[i] = r === "late" ? fallback(key, "late", new ReadLateError(lim.ms)) : { state: "fresh", value: r as T, at: now() };
    } catch (e) { out[i] = fallback(key, "failed", e); }
  };
  // coins with a read still running from an earlier build are joined first, outside the slots (they cost no new request)
  const joined: Promise<void>[] = [], fresh: number[] = [];
  items.forEach((it, i) => { const p = s.inflight.get(it.key) as Promise<T> | undefined; if (p) joined.push(settle(i, p)); else fresh.push(i); });
  // the coins tried longest ago go first, so a coin left unstarted by one build's deadline is read early in the next
  fresh.sort((a, b) => (s.tried.get(items[a].key) ?? 0) - (s.tried.get(items[b].key) ?? 0) || a - b);
  let next = 0;
  const worker = async () => {
    while (next < fresh.length) {
      const i = fresh[next++], lim = limitOf(items[i].key);
      if (lim.d.expired) { out[i] = fallback(items[i].key, "late", new ReadLateError(lim.ms)); continue; }
      await settle(i, start(items[i].key, items[i].read));
    }
  };
  try { await Promise.all([...joined, ...Array.from({ length: Math.min(Math.max(1, o.concurrency), fresh.length) }, worker)]); }
  finally { for (const t of timers) clearTimeout(t); }
  return out;
}

function keep(s: Store, key: string, k: Kept<unknown>): void {
  s.good.delete(key);
  s.good.set(key, k);
  while (s.good.size > MAX_KEYS) { const oldest = s.good.keys().next().value; if (oldest === undefined) break; s.good.delete(oldest); s.tried.delete(oldest); }
}

/** "read 3 minutes ago" (under a minute: "read moments ago"); the mark a coin served from an earlier read carries. */
export function readAgoText(atMs: number, nowMs: number): string {
  const min = Math.floor(Math.max(0, nowMs - atMs) / 60_000);
  return min < 1 ? "read moments ago" : min === 1 ? "read 1 minute ago" : min < 120 ? `read ${min} minutes ago` : `read ${Math.floor(min / 60)} hours ago`;
}

/** The end-of-line note for a build: "2 coins from an earlier read (PITWIN 3 min, BALWIN late, no earlier read)". */
export function earlierReadsNote(rows: readonly { ticker: string; r: BoundedRead<unknown> }[], nowMs: number): string {
  const earlier = rows.filter((x) => x.r.state === "earlier");
  const failed = rows.filter((x) => x.r.state === "failed" && x.r.error instanceof ReadLateError);
  const parts: string[] = [];
  if (earlier.length) parts.push(`${earlier.length} coin${earlier.length === 1 ? "" : "s"} from an earlier read (${earlier.map((x) => `${x.ticker} ${Math.round((nowMs - (x.r as { at: number }).at) / 60_000)} min${(x.r as { why: string }).why === "failed" ? ", read failed" : ""}`).join(", ")})`);
  if (failed.length) parts.push(`${failed.length} coin${failed.length === 1 ? "" : "s"} late with no earlier read (${failed.map((x) => x.ticker).join(", ")})`);
  return parts.join("; ");
}

/**
 * The list builds' stage budgets (ms). The chain stage is the one that waited 17 s on 2026-10-20; its deadline holds the build to about
 * six seconds whenever every coin has a last good read. A coin with none (the first build after a start) may wait up to `chainColdMs`, inside
 * the routes' 15 s cold wait. The index reads every coin in full (the pairs tab needs the pair side), so its chain deadline is longer. The
 * status and the rehearsal curve are single reads with a five-minute cache; past their budget the last good value is used.
 */
const DEFAULT_BUDGETS = { registryMs: 1_000, batchMs: 3_000, chainMs: 6_000, indexChainMs: 8_000, chainColdMs: 12_000, statusMs: 2_500, rehearsalMs: 2_500, shapeMs: 1_000 } as const;
export type ListBuildBudgets = { -readonly [K in keyof typeof DEFAULT_BUDGETS]: number };
export const LIST_BUILD_BUDGETS: Readonly<ListBuildBudgets> = { ...DEFAULT_BUDGETS };
/** For tests: shorter budgets (the routes read LIST_BUILD_BUDGETS at each build); no argument restores the defaults. */
export function setListBuildBudgetsForTests(over: Partial<ListBuildBudgets> | null = null): void { Object.assign(LIST_BUILD_BUDGETS as ListBuildBudgets, DEFAULT_BUDGETS, over ?? {}); }
