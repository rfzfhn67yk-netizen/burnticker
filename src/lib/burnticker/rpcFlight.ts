import crypto from "node:crypto";
import { RateLimiter } from "@/lib/burnticker/api/http";
import { RATE_LIMITS } from "@/lib/burnticker/api/spec";
import { FLIGHT_TOKEN_CALLS, FLIGHT_TOKEN_TTL_MS, isFlightBody, rpcMethodsOf } from "@/lib/burnticker/rpcProxy";

/**
 * THE FLIGHT TOKEN, SERVER SIDE (2026-10-15 prelaunch audit C2, tightened after its blind review; the client half is in rpcProxy.ts).
 *
 *   form       `v1.<expiresAtMs>.<client>.<nonce>.<hmac>`, signed with a key made when the process starts (a restart voids the tokens; the
 *              page fetches a new one, and until then its calls go on in the proxy lane). `<client>` is a hash of the clientKey that
 *              minted it, and `admit` checks it against the caller's: a token is good only for the visitor it was issued to.
 *   allowance  FLIGHT_TOKEN_CALLS calls over FLIGHT_TOKEN_TTL_MS, 12 tokens an hour per visitor (FLIGHT_ISSUE_LIMITS), and at most
 *              FLIGHT_DAILY_ISSUE_CAP tokens a UTC day for the whole site. Whatever is minted, the flight lane itself stops at its own
 *              ceiling (apiBudget.ts LANE_SPLIT), so tokens can never spend the pages' or the launch verifier's share.
 *   ledger     the calls counted per token, bounded (expired tokens dropped first; it holds more than a day's tokens, so a count is never
 *              forgotten while its token is valid).
 *
 * Same-origin (isSameOrigin) on the issuing route is a CSRF check only: Sec-Fetch-Site is set by browsers and any script can send it too.
 * It is not bot protection; the per-visitor and daily caps and the lane ceiling are. An old WebKit that sends no Sec-Fetch-Site still
 * reaches the proxy (its POSTs carry Origin) but gets no token (a same-origin GET carries no Origin), so its sends go in the proxy lane.
 */
export const FLIGHT_DAILY_ISSUE_CAP = 10_000;
const clientTag = (key: Buffer, client: string): string => crypto.createHmac("sha256", key).update(`client:${client}`).digest("base64url").slice(0, 16);
export class FlightTokens {
  private key: Buffer;
  private used = new Map<string, { n: number; exp: number }>();
  private readonly maxTokens: number;
  private readonly dailyCap: number;
  private issued = { day: "", n: 0 };
  constructor(o: { key?: Buffer; maxTokens?: number; dailyCap?: number } = {}) {
    this.key = o.key ?? crypto.randomBytes(32); this.dailyCap = o.dailyCap ?? FLIGHT_DAILY_ISSUE_CAP; this.maxTokens = Math.max(o.maxTokens ?? 2 * this.dailyCap, 1);
  }
  private sign(body: string): string { return crypto.createHmac("sha256", this.key).update(body).digest("base64url"); }
  /** A token for `client` (the minting visitor's clientKey), or null when today's site-wide cap is reached. */
  issue(client: string, now = Date.now()): { token: string; expiresAt: number; calls: number } | null {
    const day = new Date(now).toISOString().slice(0, 10);
    if (this.issued.day !== day) this.issued = { day, n: 0 };
    if (this.issued.n >= this.dailyCap) return null;
    this.issued.n++;
    const expiresAt = now + FLIGHT_TOKEN_TTL_MS, body = `v1.${expiresAt}.${clientTag(this.key, client)}.${crypto.randomBytes(12).toString("base64url")}`;
    return { token: `${body}.${this.sign(body)}`, expiresAt, calls: FLIGHT_TOKEN_CALLS };
  }
  /**
   * True when `token` is valid, unexpired, minted for `client`, the body is made only of flight methods and the token has calls left for
   * it; the calls are then counted against the token. False otherwise (nothing counted): the caller forwards the body in the proxy lane.
   */
  admit(token: string | null | undefined, body: unknown, client: string, now = Date.now()): boolean {
    if (!token || token.length > 200 || !isFlightBody(body)) return false;
    const i = token.lastIndexOf(".");
    if (i < 0) return false;
    const head = token.slice(0, i), mac = token.slice(i + 1);
    const want = this.sign(head);
    if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return false;
    const [v, exp, tag] = head.split(".");
    if (v !== "v1" || !(Number(exp) > now) || tag !== clientTag(this.key, client)) return false;
    const calls = Math.max(1, rpcMethodsOf(body).length), used = this.used.get(head)?.n ?? 0;
    if (used + calls > FLIGHT_TOKEN_CALLS) return false;
    this.used.delete(head);
    this.used.set(head, { n: used + calls, exp: Number(exp) });
    if (this.used.size > this.maxTokens) { for (const [k, e] of this.used) if (e.exp <= now) this.used.delete(k); }
    while (this.used.size > this.maxTokens) { const first = this.used.keys().next().value; if (first === undefined) break; this.used.delete(first); }
    return true;
  }
  get size(): number { return this.used.size; }
}
export const flightTokens = new FlightTokens();

/**
 * The proxy's own per-visitor limits (C2): calls, not requests (a batch of 20 is 20), 60 at once then one a second; and flight tokens,
 * 12 at once then 12 an hour. Their own RateLimiter instances, so the proxy no longer shares (or drains) the public API's heavy bucket.
 */
export const PROXY_CALL_LIMITS = { ...RATE_LIMITS, heavy: { burst: 60, refillPerSec: 1, human: "60 calls at once, then one a second" } };
export const FLIGHT_ISSUE_LIMITS = { ...RATE_LIMITS, write: { burst: 12, refillPerSec: 12 / 3600, human: "12 an hour" } };
export const proxyLimiter = new RateLimiter(PROXY_CALL_LIMITS, 20_000);
export const flightIssueLimiter = new RateLimiter(FLIGHT_ISSUE_LIMITS, 20_000);
