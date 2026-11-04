/**
 * THE CONFIRM LANE'S "TRY AGAIN SHORTLY" ANSWER (review of audit 2026-10-18 A-38). While the confirm lane's own rate is spent, the launch
 * verifier reads nothing and answers 503 with this sentence; the two confirm routes mark that answer with its own code and Retry-After,
 * and the sign card retries it on its own (signPlan.ts confirmPlan), so a creator never presses again because of a stranger's burst.
 * Client-safe: no node imports.
 */
export const CONFIRM_LANE_BUSY_CODE = "confirm-lane-busy";
export const CONFIRM_LANE_BUSY_RETRY_SEC = 3;
export const CONFIRM_LANE_BUSY_REASON = "this site is checking many launch confirmations right now. Nothing was read; please confirm again in a few seconds";

/** The confirm answer with the lane-busy code and Retry-After when it is the lane-busy 503; any other answer unchanged. */
export function markLaneBusy<R extends { status: number; body: unknown; headers?: Record<string, string> }>(r: R): R {
  const b = r.body as { error?: unknown } | null;
  if (r.status !== 503 || !b || b.error !== CONFIRM_LANE_BUSY_REASON) return r;
  return { ...r, body: { ...b, code: CONFIRM_LANE_BUSY_CODE, retryAfterSec: CONFIRM_LANE_BUSY_RETRY_SEC }, headers: { ...(r.headers ?? {}), "retry-after": String(CONFIRM_LANE_BUSY_RETRY_SEC) } };
}
