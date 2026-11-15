import type { ApiResult } from "@/lib/burnticker/api/http";

/**
 * AN ALERT WHEN SOMEONE'S LAUNCH FAILS (owner, launch night 2026-10-13: the first public launch died with "failed (502)" and nobody
 * knew). Every launch-review and launch-bundle answer that is a server error, a pin failure or a launch-check refusal is recorded as a
 * `bt-launch-failed` alert in the registry (the operator page and the check-in show it), and push.ts sends it to the owner's phone
 * when BURNTICKER_PUSH_URL is set. Ordinary 4xx refusals (a bad body, a reserved ticker, a rule the site refuses by design) are not
 * alerts: they are the site working. One alert per operation, ticker and reason per hour; the registry's INSERT OR IGNORE dedupes.
 */
export const LAUNCH_FAIL_ALERT_KIND = "bt-launch-failed";
const ALERT_CODES = new Set(["internal", "preflight", "pin-failed", "primary-unreadable", "cross-read-unreadable"]);

export function launchFailureOf(operationId: string, body: Record<string, unknown> | null, r: ApiResult, now = Date.now()): { kind: string; key: string; text: string; meta: Record<string, unknown> } | null {
  const b = (r.body && typeof r.body === "object" ? r.body : {}) as { error?: unknown; code?: unknown };
  const code = typeof b.code === "string" ? b.code : "";
  if (!(r.status >= 500 || ALERT_CODES.has(code))) return null;
  const ticker = typeof body?.ticker === "string" ? body.ticker.replace(/[^A-Za-z0-9]/g, "").slice(0, 16) : "";
  const rule = body?.rule && typeof body.rule === "object" ? body.rule as { oracle?: unknown; series?: unknown; market?: unknown } : null;
  const selector = rule ? String(rule.series ?? rule.market ?? rule.oracle ?? "").slice(0, 120) : "";
  const hour = new Date(now).toISOString().slice(0, 13);
  const error = typeof b.error === "string" ? b.error : "";
  return {
    kind: LAUNCH_FAIL_ALERT_KIND,
    key: `${operationId}:${code || r.status}:${ticker || "-"}:${selector || "-"}:${hour}`,
    text: `A launch request failed on the site: ${operationId}${ticker ? ` for $${ticker}` : ""}${selector ? ` (${selector})` : ""} answered ${r.status}${code ? ` ${code}` : ""}: ${error.slice(0, 300)}`,
    meta: { operationId, status: r.status, code: code || null, ticker: ticker || null, selector: selector || null, creator: typeof body?.creator === "string" ? body.creator : null },
  };
}

/** Wraps a route handler: the request body is read from a clone only when the answer is an alert, so the handler's own read is untouched. */
export function withLaunchFailureAlert(reg: { recordAlert(a: { kind: string; key: string; text: string; meta: Record<string, unknown> | null }, now?: number): unknown } | null, operationId: string, req: Request, handler: () => Promise<ApiResult>): () => Promise<ApiResult> {
  const clone = req.clone();
  return async () => {
    const r = await handler();
    try {
      if (reg && (r.status >= 500 || ALERT_CODES.has(String((r.body as { code?: unknown } | null)?.code ?? "")))) {
        let body: Record<string, unknown> | null = null;
        try { const j = await clone.json(); body = j && typeof j === "object" && !Array.isArray(j) ? j as Record<string, unknown> : null; } catch { body = null; }
        const a = launchFailureOf(operationId, body, r);
        if (a) reg.recordAlert(a);
      }
    } catch { /* an alert never breaks a launch answer */ }
    return r;
  };
}
