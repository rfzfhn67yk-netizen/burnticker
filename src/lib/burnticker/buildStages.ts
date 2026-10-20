import { monitorEventLoopDelay } from "node:perf_hooks";
import { budgetStoreSyncMs } from "@/lib/burnticker/apiBudget";

/**
 * PER-STAGE TIMINGS FOR THE HOME, COINS AND FEEDS BUILDS (HB-145 second half, 2026-10-20).
 *
 * The web log said "[burnticker/home] built in 17208 ms, 26 coins" and nothing about where the 17 s went. Each build now times its stages
 * and writes them on the same line, so the next slow build names its stage:
 *
 *   [burnticker/home] built in 17208 ms, 26 coins: registry 12, batch 410, chain 6000 (over its 6000 ms budget), status 3, keeper 1,
 *     rehearsal 0, ranks 4, shape 31; cpu 140 ms, loop max 22 ms, budget store 3 ms; 2 coins from an earlier read (PITWIN 3 min, BALWIN 3 min)
 *
 * The line still starts "built in N ms, N coins", so every reader of the old line keeps working. After the stages:
 *   cpu           the process CPU time spent during the build (all threads, so any other work in the same moments counts too). A build of
 *                 17 s with 150 ms of cpu was waiting on reads; a build whose cpu is most of its time held the event loop.
 *   loop max      the longest the event loop was held while the build ran (perf_hooks event-loop delay, 20 ms resolution). Anything here
 *                 over a second is the stall every other request on the site waited behind.
 *   budget store  the time spent in the request budget's synchronous registry writes (apiBudget.ts statusTableStore) during the build. A
 *                 large number here means another process held the registry's write lock (busy_timeout) while the web counted its calls.
 *
 * An awaited stage can carry a budget: past it, the stage's own fallback answers (the last good value for that stage) and the line says
 * "over its N ms budget", so one hung read never holds the build. A synchronous stage cannot be stopped part way; it is timed, and a stage
 * past its budget is named on the line the same way.
 */

export interface StageClock {
  /** Runs `fn` as stage `name` and records its time (sync or async). */
  run<T>(name: string, fn: () => T): T;
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /**
   * An awaited stage with a budget: resolves with `fn`'s value, or with `fallback()` once `budgetMs` has passed (or `fn` rejected and
   * `onError` is given). `fn` is not cancelled: it may still finish in the background and fill its caches for the next build.
   */
  bounded<T>(name: string, budgetMs: number, fn: () => Promise<T>, fallback: () => T, o?: { onError?: (e: unknown) => T }): Promise<T>;
  /** Declares a budget for a stage that `run` times (a synchronous stage is named "over its budget" after the fact). */
  budget(name: string, ms: number): void;
  /** A short note for the end of the line ("2 coins from an earlier read (…)"). */
  note(s: string): void;
  /** The stages' times so far, in the order they ran (a stage run twice adds up). */
  readonly ms: ReadonlyMap<string, number>;
  /** The stages that went past their budget. */
  readonly over: ReadonlySet<string>;
  /** Stops the event-loop monitor and returns the finished line: `${head} built in N ms, ${tail}: stage ms, …; cpu …`. */
  line(head: string, tail: string): string;
}

export interface StageClockOptions {
  now?: () => number;
  /** process CPU microseconds (user + system); tests pass their own */
  cpuMicros?: () => number;
  /** false: no event-loop monitor (tests) */
  loopMonitor?: boolean;
  /** the budget store's running total (apiBudget.ts budgetStoreSyncMs); tests pass their own */
  storeMs?: () => number;
}

const cpuNow = (): number => { const u = process.cpuUsage(); return u.user + u.system; };

export function stageClock(o: StageClockOptions = {}): StageClock {
  const now = o.now ?? Date.now, cpu = o.cpuMicros ?? cpuNow, store = o.storeMs ?? budgetStoreSyncMs;
  const started = now(), cpu0 = cpu(), store0 = store();
  const ms = new Map<string, number>(), over = new Set<string>(), budgets = new Map<string, number>(), notes: string[] = [];
  let loop: ReturnType<typeof monitorEventLoopDelay> | null = null;
  if (o.loopMonitor !== false) { try { loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable(); } catch { loop = null; } }
  const add = (name: string, t: number) => { ms.set(name, (ms.get(name) ?? 0) + Math.max(0, t)); const b = budgets.get(name); if (b !== undefined && (ms.get(name) ?? 0) >= b) over.add(name); };
  const clock: StageClock = {
    ms, over,
    run<T>(name: string, fn: () => T | Promise<T>): T | Promise<T> {
      const t0 = now();
      let v: T | Promise<T>;
      try { v = fn(); } catch (e) { add(name, now() - t0); throw e; }
      if (v && typeof (v as Promise<T>).then === "function") return (v as Promise<T>).finally(() => add(name, now() - t0));
      add(name, now() - t0);
      return v;
    },
    async bounded<T>(name: string, budgetMs: number, fn: () => Promise<T>, fallback: () => T, b: { onError?: (e: unknown) => T } = {}): Promise<T> {
      budgets.set(name, budgetMs);
      const t0 = now();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const late = Symbol("late");
      try {
        const work = Promise.resolve().then(fn);
        work.catch(() => { /* reported below when it loses the race; a late failure is the stage's own business */ });
        const r = await Promise.race([work, new Promise<typeof late>((ok) => { timer = setTimeout(() => ok(late), budgetMs); (timer as { unref?: () => void }).unref?.(); })]);
        if (r === late) { over.add(name); return fallback(); }
        return r as T;
      } catch (e) {
        if (b.onError) return b.onError(e);
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
        add(name, now() - t0);
      }
    },
    budget(name: string, b: number) { budgets.set(name, b); },
    note(s: string) { if (s) notes.push(s); },
    line(head: string, tail: string): string {
      const total = now() - started;
      const stages = [...ms].map(([k, v]) => `${k} ${Math.round(v)}${over.has(k) ? ` (over its ${budgets.get(k) ?? "?"} ms budget)` : ""}`).join(", ");
      const cpuMs = Math.round((cpu() - cpu0) / 1000);
      let loopMax: number | null = null;
      if (loop) { try { loop.disable(); loopMax = Math.round(loop.max / 1e6); } catch { loopMax = null; } loop = null; }
      const storeMs = Math.round(store() - store0);
      const facts = [`cpu ${cpuMs} ms`, ...(loopMax !== null ? [`loop max ${loopMax} ms`] : []), `budget store ${storeMs} ms`].join(", ");
      return `${head} built in ${total} ms, ${tail}${stages ? `: ${stages}` : ""}; ${facts}${notes.length ? `; ${notes.join("; ")}` : ""}`;
    },
  } as StageClock;
  return clock;
}

/**
 * THE LAUNCH REVIEW'S SLOW LINE (HB-145, 2026-10-20: every 4.3 to 4.8 s hold of the web's event loop landed on a POST /v1/launch/review,
 * and the slow log could not say which part of the review it was). The review route times each of its stages on a stageClock; a review
 * slower than REVIEW_SLOW_MS writes one line in the build lines' shape:
 *
 *   [burnticker/review] built in 4716 ms, rule catalogue espn.team: body 0, proof 1, registry 3, season 2, game 0, note 0, meetings 4402,
 *     lastSeason 210, sinks 1, build 60, existing 1, tickers 30; cpu 4650 ms, loop max 4400 ms, budget store 0 ms
 *
 * The rule is named by its oracle and the family of its series (the part before the first ":"), never the creator's words or wallet.
 * The line is always finished (it stops the clock's event-loop monitor) and returned only when the review was slow; null otherwise.
 */
export const REVIEW_SLOW_MS = 1_000;
export function reviewRuleLabel(rule: unknown): string {
  const r = rule && typeof rule === "object" ? (rule as { oracle?: unknown; series?: unknown; market?: unknown }) : null;
  const word = (v: unknown) => (typeof v === "string" ? v.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 24) : "");
  const oracle = word(r?.oracle) || "unknown";
  const family = typeof r?.series === "string" && r.series ? word(r.series.split(":")[0]) : typeof r?.market === "string" && r.market ? "one market" : "";
  return `rule ${oracle}${family ? ` ${family}` : ""}`;
}
export function reviewSlowLine(clock: StageClock, totalMs: number, rule: unknown, slowMs: number = REVIEW_SLOW_MS): string | null {
  const line = clock.line("[burnticker/review]", reviewRuleLabel(rule));
  return totalMs > slowMs ? line : null;
}
