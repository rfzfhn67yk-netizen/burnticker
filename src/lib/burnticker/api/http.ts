import { isSameOrigin } from "@/lib/sameOrigin";
import { endpoint, RATE_LIMITS, API_VERSION, type Bucket } from "@/lib/burnticker/api/spec";
import { clientKeyFromHeaders } from "@/lib/burnticker/api/clientIp";
import { safeErrorText } from "@/lib/burnticker/api/errorText";

/**
 * THE PUBLIC API'S HTTP DISCIPLINE (2026-10-09). One wrapper every v1 route goes through:
 *
 *   rate limit   a per-client token bucket per class (read / heavy / write, sizes in spec.ts), keyed by the right-most X-Forwarded-For
 *                hop (the one Caddy itself appends; a client cannot forge it), else X-Real-IP, else one shared "direct" bucket; when that
 *                hop is a Cloudflare edge, by the visitor's CF-Connecting-IP (clientIp.ts; ops-2 2026-10-12). 429 with
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
  /**
   * Takes `cost` tokens (default 1; the RPC proxy charges one per JSON-RPC call in a batch, C2 2026-10-15) from the client's bucket.
   * A cost above the burst is refused outright.
   */
  take(client: string, bucket: Bucket, now = Date.now(), cost = 1): { ok: boolean; limit: number; remaining: number; retryAfterSec: number } {
    const lim = this.limits[bucket];
    const key = `${bucket}|${client}`;
    const c = Math.max(1, cost);
    const b = this.buckets.get(key) ?? { tokens: lim.burst, at: now };
    b.tokens = Math.min(lim.burst, b.tokens + ((now - b.at) / 1000) * lim.refillPerSec);
    b.at = now;
    if (this.buckets.size >= this.maxKeys && !this.buckets.has(key)) this.prune(now);
    this.buckets.delete(key);   // re-inserted last: the map's order is least recently used first (prune's fallback)
    this.buckets.set(key, b);
    if (b.tokens < c) return { ok: false, limit: lim.burst, remaining: 0, retryAfterSec: c > lim.burst ? 3600 : Math.max(1, Math.ceil((c - b.tokens) / lim.refillPerSec)) };
    b.tokens -= c;
    return { ok: true, limit: lim.burst, remaining: Math.floor(b.tokens), retryAfterSec: 0 };
  }
  /**
   * Drops buckets that have refilled completely (they hold no state worth keeping); when that frees too little (2026-10-15 audit M8: a
   * flood of distinct clients that all spent tokens kept the map growing past maxKeys), the least recently used tenth goes too.
   */
  private prune(now: number): void {
    for (const [k, b] of this.buckets) {
      const lim = this.limits[k.split("|")[0] as Bucket];
      if (b.tokens + ((now - b.at) / 1000) * lim.refillPerSec >= lim.burst) this.buckets.delete(k);
    }
    if (this.buckets.size < this.maxKeys) return;
    let drop = Math.max(1, Math.ceil(this.maxKeys / 10));
    for (const k of this.buckets.keys()) { if (drop-- <= 0) break; this.buckets.delete(k); }
  }
  get size(): number { return this.buckets.size; }
  reset(): void { this.buckets.clear(); }
}

/**
 * The write bucket's burst on a NON-mainnet host may be raised with BURNTICKER_DEVNET_WRITE_BURST (2026-10-15: the nightly synthetic
 * creator launches a dozen devnet coins from one loopback client, past the 10-an-hour write bucket). Ignored on mainnet: the live
 * host's limits are the spec's, whatever its env says.
 */
export function limitsFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): typeof RATE_LIMITS {
  const n = Number((env.BURNTICKER_DEVNET_WRITE_BURST ?? "").trim());
  if ((env.BURNTICKER_CLUSTER ?? "").trim() === "mainnet" || !Number.isInteger(n) || n <= RATE_LIMITS.write.burst || n > 1000) return RATE_LIMITS;
  return { ...RATE_LIMITS, write: { ...RATE_LIMITS.write, burst: n, refillPerSec: n / 3600 } };
}
export const limiter = new RateLimiter(limitsFromEnv());
/**
 * Audit 2026-10-18 A-38 / A-42: the site's own routes that read the chain, fetch a pin or render an image had no per-client limit. They
 * take from the heavy bucket's sizes (20, then 20 a minute) on limiters of their own, so a visitor reading coin pages or a wizard redrawing
 * its preview never spends the bucket the wizard's back-tests and searches use. `pageLimiter`: pairs and the league image (heavy sizes);
 * `pinCheckLimiter`: the pin check every coin page makes (the read sizes, 120 then 120 a minute, as before; a shared address reads many pages);
 * `imageLimiter`: the wizard's preview image (it redraws on each ticker edit, so a burst of 60, then 60 a minute).
 */
export const pageLimiter = new RateLimiter();
export const pinCheckLimiter = new RateLimiter();
export const imageLimiter = new RateLimiter({ ...RATE_LIMITS, heavy: { burst: 60, refillPerSec: 1, human: "a burst of 60 images, then 60 a minute" } });
/** A 429 for one of the site's own routes when `client` has spent its heavy bucket on `lim`; null when the request may run. */
export function heavyRefusal(req: Request, lim: RateLimiter = limiter, now = Date.now(), bucket: Bucket = "heavy"): Response | null {
  const rl = lim.take(clientKey(req), bucket, now);
  if (rl.ok) return null;
  const error = `Too many requests from this address. Please try again in ${rl.retryAfterSec} seconds.`;
  return new Response(JSON.stringify({ ok: null, error, detail: error, code: "rate-limited", retryAfterSec: rl.retryAfterSec }), { status: 429, headers: { "content-type": "application/json; charset=utf-8", "retry-after": String(rl.retryAfterSec), "cache-control": "no-store" } });
}

/**
 * The client a request is charged to: the right-most X-Forwarded-For hop (appended by our own Caddy), else X-Real-IP; when that hop is
 * a Cloudflare edge (its published ranges), the visitor's CF-Connecting-IP instead; IPv6 per /64. Rules and reasons: ./clientIp.ts.
 */
export function clientKey(req: Request): string {
  return clientKeyFromHeaders(req.headers);
}

/**
 * Launch night 2026-10-13: Cloudflare replaces an origin 502 (and 504) with its own error page, so the page never saw the refusal
 * sentence ("The launch request failed (502)"). An upstream-unreadable answer is sent as 503 with Retry-After; the body is unchanged.
 * The launch walkthrough (2026-10-13) found the page's own launch route (/api/burnticker/launch, the one the owner's launch used) and the
 * launch page's back-test, image preview and burn-target reads still answering 502: every one of them goes through edgeJson now.
 */
export const edgeStatus = (status: number): number => (status === 502 || status === 504 ? 503 : status);
export const edgeRetryHeaders = (status: number): Record<string, string> => (status === 502 || status === 504 ? { "retry-after": "15" } : {});
/** A JSON answer from one of the site's own (non-v1) routes, with a 502 or 504 sent as 503 so Cloudflare passes the body through. */
export const edgeJson = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), { status: edgeStatus(status), headers: { ...edgeRetryHeaders(status), "content-type": "application/json; charset=utf-8", ...headers } });

const json = (r: ApiResult, extra: Record<string, string>): Response =>
  new Response(JSON.stringify(r.body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), { status: edgeStatus(r.status), headers: { ...edgeRetryHeaders(r.status), "content-type": "application/json; charset=utf-8", "x-burnticker-api": API_VERSION, ...extra, ...(r.headers ?? {}) } });

/**
 * THE PUBLIC-READ CORS POLICY (audit 2026-10-15 F5): a keyless public GET that the sibling static shells (deficit.burnticker.com,
 * status.burnticker.com) read from another origin carries this header on EVERY answer, the cold 503 included, so the shell sees the
 * real answer instead of a blocked read. Never on a write route: a POST stays same-origin (isSameOrigin) and gets no CORS header.
 */
export const PUBLIC_READ_CORS: Readonly<Record<string, string>> = Object.freeze({ "access-control-allow-origin": "*" });

/** Runs one v1 operation with the spec's rate limit, cache and POST discipline. */
export async function runV1(operationId: string, req: Request, handler: () => Promise<ApiResult>, now = Date.now()): Promise<Response> {
  const ep = endpoint(operationId);
  const cors: Record<string, string> = ep.method === "GET" ? { "access-control-allow-origin": "*" } : {};
  // audit 2026-10-18 A-39: the cross-site, content-type and size refusals come BEFORE the limiter, so a page on another site that posts
  // here spends nothing from the visitor's buckets (the non-v1 launch route already worked this way)
  if (ep.method === "POST") {
    if (!isSameOrigin(req)) return json(fail(403, "Requests from other sites are refused. A bot must send an Origin header that matches this API's address. In a browser, use this site.", { code: "cross-origin" }), { "cache-control": "no-store" });
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return json(fail(415, "A POST body must be sent as JSON, with the content type application/json.", { code: "content-type" }), { "cache-control": "no-store" });
    if (declaredTooLarge(req)) return json(fail(413, "The request is too large.", { code: "too-large" }), { "cache-control": "no-store" });
  }
  const rl = limiter.take(clientKey(req), ep.bucket, now);
  const rlHeaders = { "ratelimit-limit": String(rl.limit), "ratelimit-remaining": String(rl.remaining) };
  if (!rl.ok) return json(fail(429, `Too many requests. The limit here is ${RATE_LIMITS[ep.bucket].human}. Please try again in ${rl.retryAfterSec} seconds.`, { code: "rate-limited", retryAfterSec: rl.retryAfterSec }), { ...cors, ...rlHeaders, "retry-after": String(rl.retryAfterSec), "cache-control": "no-store" });
  let r: ApiResult;
  try { r = await handler(); } catch (e) { r = fail(500, `Something went wrong on the server. The reason given was: ${safeErrorText(e, 200)}`, { code: "internal" }); }
  const cache = ep.method === "GET" && r.status === 200 && ep.cacheSec > 0 ? `public, max-age=${ep.cacheSec}, s-maxage=${ep.cacheSec}, stale-while-revalidate=${ep.cacheSec}` : "no-store";
  if (r.raw && r.status === 200) return new Response(r.raw.body as BodyInit, { status: 200, headers: { "content-type": r.raw.type, "x-burnticker-api": API_VERSION, "x-content-type-options": "nosniff", ...cors, ...rlHeaders, "cache-control": cache, ...(r.headers ?? {}) } });
  return json(r, { ...cors, ...rlHeaders, "cache-control": cache });
}

/**
 * The largest JSON body a route reads (2026-10-15 prelaunch audit M3): a rivalry pair's launch carries at most two 2 MB images as base64
 * (about 2.8 MB each) plus the two rules and their words. A larger body is refused before it is parsed (Content-Length) or while it
 * streams in (a chunked body).
 */
export const MAX_JSON_BODY = 6_500_000;
/** True when the request says its body is larger than `max` (its Content-Length). */
export const declaredTooLarge = (req: Request, max = MAX_JSON_BODY): boolean => { const n = Number(req.headers.get("content-length") ?? ""); return Number.isFinite(n) && n > max; };
/** The body as text, read up to `max` bytes; null when it is larger (the read stops there). */
export async function readTextCapped(req: Request, max = MAX_JSON_BODY): Promise<string | null> {
  if (declaredTooLarge(req, max)) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { try { await reader.cancel(); } catch { /* the stream is dropped either way */ } return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  return new TextDecoder().decode(all);
}

/**
 * readTextCapped with a gate (review of A-42): `gate` runs once, before the read when the declared Content-Length passes `gateAt`, else
 * as soon as the bytes streamed pass it (a chunked body declares nothing). A Response from the gate stops the read and is returned as
 * is; null lets it go on. Null when the body is larger than `max`.
 */
export async function readTextGated(req: Request, max: number, gateAt: number, gate: () => Response | null): Promise<string | null | Response> {
  if (declaredTooLarge(req, max)) return null;
  let gated = false;
  const runGate = (): Response | null => { gated = true; return gate(); };
  if (declaredTooLarge(req, gateAt)) { const r = runGate(); if (r) return r; }
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  const stop = async () => { try { await reader.cancel(); } catch { /* the stream is dropped either way */ } };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await stop(); return null; }
    if (!gated && n > gateAt) { const r = runGate(); if (r) { await stop(); return r; } }
    chunks.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  return new TextDecoder().decode(all);
}

/** Parses a JSON body; null when it is not JSON or larger than MAX_JSON_BODY (the caller answers 400). */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try { const t = await readTextCapped(req); if (t === null) return null; const b = JSON.parse(t); return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null; } catch { return null; }
}
