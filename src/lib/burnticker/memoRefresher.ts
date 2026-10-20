/**
 * MEMOS REBUILT BEHIND THE REQUESTS, NOT ON THEM (HB-145, 2026-10-20).
 *
 * At 01:13 Denver, 21 minutes after a restart on a quiet host, the app stopped answering for more than 20 s: the home took 15.75 s and two
 * launch reviews got Caddy's "catching up" 503. The home and coins memos were rebuilt ON the request path: a visitor who found the answer
 * past its maximum age waited (up to 15 s) for the rebuild, and on a quiet host every first visitor after a lull found it so; the builds
 * take 3.4 to 8 s, and the next visitors queued behind them.
 *
 * Now a timer rebuilds the memo while requests keep serving the last copy, ON DEMAND ONLY (HB-163, hourly run 15):
 *   - a VISITOR's request (any request but the web's start-up warm call, scripts/service/web-warm.cjs, which sends x-burnticker-warm: 1)
 *     marks the route active for ACTIVE_MS (5 minutes);
 *   - while active, the copy is rebuilt once it is older than its window (15 s with under 50 coins) AND a visitor asked after it was built:
 *     a steady stream of visitors keeps it fresh, one visitor costs at most one rebuild after the visit, and nothing runs on a fixed beat;
 *   - with no visitor for ACTIVE_MS the timer builds nothing (publish 103 rebuilt every minute for nobody, spending the web's RPC share and
 *     holding the event loop); the next visitor gets the kept copy at once and the route starts a rebuild behind that answer;
 *   - one build at a time (the route's own in-flight guard), and a build that fails leaves the last copy in place.
 * Only the very first build after a start is waited for (nothing to serve yet; the warm call starts it before any visitor). The builds still
 * run on the web's one event loop: what moved is the waiting, not the work. The league table (leaguesServe.ts leagueData) is built inside
 * the home build, so it follows the home memo's cadence and stops with it.
 *
 * Started by the route's first visitor request (the module is loaded then). Runs in production, or where BURNTICKER_MEMO_REFRESHER=1;
 * never in the test runner unless a test drives it with its own clock (`tick`).
 */
export const ACTIVE_MS = 5 * 60_000, TICK_MS = 2_000;
/** The header the start-up warm call sends (scripts/service/web-warm.cjs): its request is not a visitor. */
export const WARM_HEADER = "x-burnticker-warm";
/** Whether a request is a visitor's (anything but the warm call). A route called with no request (a test) counts as a visitor. */
export const isVisitorRequest = (req: { headers: { get(name: string): string | null } } | null | undefined): boolean => !req || req.headers.get(WARM_HEADER) !== "1";

export interface MemoRefresher {
  /** A request arrived: a visitor's starts the timer on the first call and marks the route active; the warm call's (visitor false) does neither. */
  touch(visitor?: boolean): void;
  /** One timer step (exported for the tests, which pass their own clock). */
  tick(): void;
  /** For tests and shutdown. */
  stop(): void;
  readonly running: boolean;
}

export function memoRefresher(o: {
  /** starts a rebuild (or joins the one in flight); never rejects */
  refresh: () => Promise<unknown>;
  /** the memo's age in ms, or null when there is none yet */
  ageMs: () => number | null;
  /** the memo's window: an active route rebuilds once the copy is older */
  freshMs: () => number;
  now?: () => number;
  enabled?: boolean;
  activeMs?: number; tickMs?: number;
}): MemoRefresher {
  const now = o.now ?? Date.now;
  const enabled = o.enabled ?? (process.env.NODE_ENV === "production" || process.env.BURNTICKER_MEMO_REFRESHER === "1");
  const activeMs = o.activeMs ?? ACTIVE_MS, tickMs = o.tickMs ?? TICK_MS;
  let lastAsk: number | null = null, timer: ReturnType<typeof setInterval> | null = null;
  const r: MemoRefresher = {
    get running() { return timer !== null; },
    touch(visitor = true) {
      if (!visitor) return;
      lastAsk = now();
      if (timer || !enabled) return;
      timer = setInterval(() => r.tick(), tickMs);
      timer.unref?.();
    },
    tick() {
      // HB-163: no visitor in the last ACTIVE_MS, no build (the next visitor is served the kept copy and the route rebuilds behind it)
      if (lastAsk === null || now() - lastAsk >= activeMs) return;
      const age = o.ageMs();
      // a copy past its window is rebuilt only when a visitor asked after it was built (demand, not a beat)
      if (age === null || (age >= o.freshMs() && lastAsk >= now() - age)) void o.refresh().catch(() => { /* the route logs its own build failures */ });
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
  return r;
}
