import { NextResponse } from "next/server";
import { clientKey } from "@/lib/burnticker/api/http";
import { isSameOrigin } from "@/lib/sameOrigin";
import { flightIssueLimiter, flightTokens } from "@/lib/burnticker/rpcFlight";

export const dynamic = "force-dynamic";

/**
 * GET /api/burnticker/rpc/flight — a flight token for the wallet connection (rpcProxy.ts, 2026-10-15 prelaunch audit C2): same-origin
 * only (a CSRF check, not bot protection: rpcFlight.ts), 12 an hour per visitor, FLIGHT_DAILY_ISSUE_CAP a day for the site; each is
 * bound to the visitor that minted it and good for FLIGHT_TOKEN_CALLS send-path calls over ten minutes.
 */
export async function GET(req: Request) {
  const headers = { "cache-control": "no-store" };
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Requests from other sites are refused." }, { status: 403, headers });
  const rl = flightIssueLimiter.take(clientKey(req), "write");
  if (!rl.ok) return NextResponse.json({ error: `Too many requests. Try again in ${rl.retryAfterSec} seconds.` }, { status: 429, headers: { ...headers, "retry-after": String(rl.retryAfterSec) } });
  const t = flightTokens.issue(clientKey(req));
  if (!t) return NextResponse.json({ error: "No more send tokens today; sends go on without one." }, { status: 503, headers: { ...headers, "retry-after": "3600" } });
  return NextResponse.json(t, { headers });
}
