/**
 * THE BACK-TEST'S BOUNDED WAIT (2026-10-16 prelaunch audit F-10). The wizard's review step asks for a back-test, which reads the venue's
 * settled history (TheSportsDB's season schedule, Kalshi's settled markets). A slow source held that request until Caddy cut it at 20 s.
 * The route now waits at most BACKTEST_WAIT.ms; past that it answers 503 with BACKTEST_SLOW and Retry-After, and the read goes on in the
 * background: the source clients keep its answer (EspnClient, the Kalshi client), so the page's own retry (2, 4, 8 s) is served from it.
 * `BACKTEST_WAIT` is an object so a test can shorten the wait. Client-safe.
 */
export const BACKTEST_WAIT = { ms: 5_000 };
export const BACKTEST_SLOW_RETRY_SEC = 5;
/** What the review step says while the estimate cannot be read (copy lint: plain words, no shorthand). */
export const BACKTEST_SLOW = "Could not estimate past burns right now.";
export const BACKTEST_SLOW_CODE = "backtest-slow";
