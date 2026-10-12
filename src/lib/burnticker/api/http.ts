import { isSameOrigin } from "@/lib/sameOrigin";
import { endpoint, RATE_LIMITS, API_VERSION, type Bucket } from "@/lib/burnticker/api/spec";

/**
 * THE PUBLIC API'S HTTP DISCIPLINE (2026-10-09). One wrapper every v1 route goes through:
 *
 *   rate limit   a per-client token bucket per class (read / heavy / write, sizes in spec.ts), keyed by the right-most X-Forwarded-For
 *                hop (the one Caddy itself appends; a client cannot forge it), else X-Real-IP, else one shared "direct" bucket. 429 with
 *                Retry-After and RateLimit-* headers. In memory: one Next process on one VPS (docs/burnticker/deploy.md).
 *   POST         the repo's cross-site refusal (isSameOrigin, checked before the body is read) + Content-Type application/json (a
 *                browser cannot send that cross-site without a preflight, and no route answers one). No auth, no accounts: POST
 *                routes return public data and UNSIGNED transactions only.
 *   GET          keyless, `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=N, stale-while-revalidate` with N from the spec.
 *   errors       JSON { error, code? , problems? }, never cached; an unexpected throw is a 500 with the message, never a stack.
 */

export interface ApiResult { status: number; body: unknown; headers?: Record<string, string>; /** a non-JSON 200 (the badge's SVG / PNG, growth batch 2026-10-10): sent as-is with its own type; errors stay JSON */ raw?: { body: Uint8Array | string; type: string } }
export const ok = (body: unknown): ApiResult => ({ status: 200, body });
export const okRaw = (body: Uint8Array | string, type: string, headers: Record<string, string> = {}): ApiResult => ({ status: 200, body: null, raw: { body, type }, headers });
export const fail = (status: number, error: string, extra: Record<string, unknown> = {}): ApiResult => ({ status, body: { error, ...extra } });

export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private readonly limits: typeof RATE_LIMITS;
  private readonly maxKeys: number;
  constructor(limits: typeof RATE_LIMITS = RATE_LIMITS, maxKeys = 50_000) { this.limits = limits; this.maxKeys = maxKeys; }
  take(client: string, bucket: Bucket, now = Date.now()): { ok: boolean; limit: number; remaining: number; retryAfterSec: number } {
    const lim = this.limits[bucket];
    const key = `${bucket}|${client}`;
    const b = this.buckets.get(key) ?? { tokens: lim.burst, at: now };
    b.tokens = Math.min(lim.burst, b.tokens + ((now - b.at) / 1000) * lim.refillPerSec);
    b.at = now;
    if (this.buckets.size >= this.maxKeys && !this.buckets.has(key)) this.prune(now);
    this.buckets.set(key, b);
    if (b.tokens < 1) return { ok: false, limit: lim.burst, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / lim.refillPerSec)) };
    b.tokens -= 1;
    return { ok: true, limit: lim.burst, remaining: Math.floor(b.tokens), retryAfterSec: 0 };
  }
  /** Drops buckets that have refilled completely (they hold no state worth keeping). */
  private prune(now: number): void {
    for (const [k, b] of this.buckets) {
      const lim = this.limits[k.split("|")[0] as Bucket];
      if (b.tokens + ((now - b.at) / 1000) * lim.refillPerSec >= lim.burst) this.buckets.delete(k);
    }
  }
  reset(): void { this.buckets.clear(); }
}

export const limiter = new RateLimiter();

/** The client a request is charged to: the right-most X-Forwarded-For hop (appended by our own Caddy), else X-Real-IP. */
export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) { const hops = fwd.split(",").map((s) => s.trim()).filter(Boolean); if (hops.length) return hops[hops.length - 1]; }
  const real = req.headers.get("x-real-ip");
  return real ? real.trim() : "direct";
}

const json = (r: ApiResult, extra: Record<string, string>): Response =>
  new Response(JSON.stringify(r.body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), { status: r.status, headers: { "content-type": "application/json; charset=utf-8", "x-burnticker-api": API_VERSION, ...extra, ...(r.headers ?? {}) } });

/** Runs one v1 operation with the spec's rate limit, cache and POST discipline. */
export async function runV1(operationId: string, req: Request, handler: () => Promise<ApiResult>, now = Date.now()): Promise<Response> {
  const ep = endpoint(operationId);
  const cors: Record<string, string> = ep.method === "GET" ? { "access-control-allow-origin": "*" } : {};
  const rl = limiter.take(clientKey(req), ep.bucket, now);
  const rlHeaders = { "ratelimit-limit": String(rl.limit), "ratelimit-remaining": String(rl.remaining) };
  if (!rl.ok) return json(fail(429, `Too many requests. The limit here is ${RATE_LIMITS[ep.bucket].human}. Please try again in ${rl.retryAfterSec} seconds.`, { code: "rate-limited", retryAfterSec: rl.retryAfterSec }), { ...cors, ...rlHeaders, "retry-after": String(rl.retryAfterSec), "cache-control": "no-store" });
  if (ep.method === "POST") {
    if (!isSameOrigin(req)) return json(fail(403, "Requests from other sites are refused. A bot must send an Origin header that matches this API's address. In a browser, use this site.", { code: "cross-origin" }), { ...rlHeaders, "cache-control": "no-store" });
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return json(fail(415, "A POST body must be sent as JSON, with the content type application/json.", { code: "content-type" }), { ...rlHeaders, "cache-control": "no-store" });
  }
  let r: ApiResult;
  try { r = await handler(); } catch (e) { r = fail(500, `Something went wrong on the server. The reason given was: ${(e as Error).message.slice(0, 200)}`, { code: "internal" }); }
  const cache = ep.method === "GET" && r.status === 200 && ep.cacheSec > 0 ? `public, max-age=${ep.cacheSec}, s-maxage=${ep.cacheSec}, stale-while-revalidate=${ep.cacheSec}` : "no-store";
  if (r.raw && r.status === 200) return new Response(r.raw.body as BodyInit, { status: 200, headers: { "content-type": r.raw.type, "x-burnticker-api": API_VERSION, "x-content-type-options": "nosniff", ...cors, ...rlHeaders, "cache-control": cache, ...(r.headers ?? {}) } });
  return json(r, { ...cors, ...rlHeaders, "cache-control": cache });
}

/** Parses a JSON body; null when it is not JSON (the caller answers 400). */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try { const b = await req.json(); return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null; } catch { return null; }
}
