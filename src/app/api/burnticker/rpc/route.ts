import { NextResponse } from "next/server";
import { clientKey, readTextCapped } from "@/lib/burnticker/api/http";
import { isSameOrigin } from "@/lib/sameOrigin";
import { rpcUrlFor, type Network } from "@/lib/burnticker/networks";
import { hostCluster } from "@/lib/burnticker/launchAvailability";
import { RPC_BUDGET_REFUSAL, RPC_FLIGHT_HEADER, RPC_FLIGHT_REFUSED_HEADER, RPC_PROXY_MAX_BODY, isFlightBody, rpcMethodsOf, rpcProxyRefusal } from "@/lib/burnticker/rpcProxy";
import { flightTokens, proxyLimiter } from "@/lib/burnticker/rpcFlight";
import { BudgetHoldError, takeRpc } from "@/lib/burnticker/apiBudget";
import { ensureWebApiBudget } from "@/lib/burnticker/server";

export const dynamic = "force-dynamic";

const refuse = (status: number, code: number, message: string, headers: Record<string, string> = {}) =>
  NextResponse.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status, headers: { "cache-control": "no-store", ...headers } });

/**
 * POST /api/burnticker/rpc — the browser's JSON-RPC proxy (src/lib/burnticker/rpcProxy.ts).
 *
 * 2026-10-15 prelaunch audit C2: a request with no Origin header was forwarded, and one client at the allowed rate (20 requests of 20
 * calls a minute) could spend the site's whole Helius day in about 150 minutes, after which launch confirmations and wallet sends
 * failed until midnight UTC. Now: same-origin only (isSameOrigin: Sec-Fetch-Site, else a matching Origin; neither is refused; a CSRF
 * check, not bot protection: a script can send the header, so the caps below are what bound it); the per-visitor limit is taken before
 * the body is read and counts calls, not requests (rpcFlight.ts proxyLimiter); the body is read capped; the budget counts the proxy in
 * its own lane with its own cap and rate, and a body carrying this visitor's valid flight token (FLIGHT_METHODS only) goes in the flight
 * lane, which has its own ceiling (apiBudget.ts LANE_SPLIT). An old WebKit without Sec-Fetch-Site passes on its POST's Origin header.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return refuse(403, -32600, "Requests from other sites are refused.");
  const client = clientKey(req), now = Date.now();
  // the limiter before the body is read (one call's worth); the rest of a batch is charged once its size is known
  const rl0 = proxyLimiter.take(client, "heavy", now, 1);
  if (!rl0.ok) return refuse(429, -32005, `Too many requests. Try again in ${rl0.retryAfterSec} seconds.`, { "retry-after": String(rl0.retryAfterSec) });
  const text = await readTextCapped(req, RPC_PROXY_MAX_BODY);
  if (text === null) return refuse(413, -32600, "The request is too large.");
  let body: unknown;
  try { body = JSON.parse(text); } catch { return refuse(400, -32700, "The request is not JSON."); }
  const refused = rpcProxyRefusal(body);
  if (refused) return refuse(400, -32601, `This site does not forward ${refused}.`);
  const calls = Math.max(1, rpcMethodsOf(body).length);
  if (calls > 1) {
    const rl = proxyLimiter.take(client, "heavy", now, calls - 1);
    if (!rl.ok) return refuse(429, -32005, `Too many requests. Try again in ${rl.retryAfterSec} seconds.`, { "retry-after": String(rl.retryAfterSec) });
  }
  const cluster = hostCluster(process.env);
  const network: Network = cluster === "mainnet" ? "mainnet" : "devnet";
  const sentToken = req.headers.get(RPC_FLIGHT_HEADER);
  let lane: "flight" | "proxy" = flightTokens.admit(sentToken, body, client, now) ? "flight" : "proxy";
  // a token that was sent and not admitted is named in the answer, so the page drops it and asks for a fresh one
  const tokenHeaders: Record<string, string> = sentToken && lane === "proxy" && isFlightBody(body) ? { [RPC_FLIGHT_REFUSED_HEADER]: "1" } : {};
  // the request budget (apiBudget.ts): the site's share of the RPC plan, in the proxy's lane; a spent lane or a full bucket answers 503
  ensureWebApiBudget();
  // re-review 2: a spent flight lane never 503s a token holder while the proxy lane has room: the call is retried there once, and the
  // token is named refused so the page stops sending it
  const take = (l: "flight" | "proxy") => takeRpc(rpcUrlFor(network), body, undefined, { lane: l });
  try { await take(lane).catch((e) => { if (!(e instanceof BudgetHoldError) || lane !== "flight") throw e; lane = "proxy"; tokenHeaders[RPC_FLIGHT_REFUSED_HEADER] = "1"; return take(lane); }); }
  catch (e) { if (e instanceof BudgetHoldError) return refuse(503, -32005, RPC_BUDGET_REFUSAL, { "retry-after": "60", ...tokenHeaders }); throw e; }
  try {
    const up = await fetch(rpcUrlFor(network), { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(20_000) });
    const answer = await up.text();
    return new Response(answer, { status: up.ok ? 200 : 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...tokenHeaders } });
  } catch (e) {
    return refuse(503, -32000, `The network could not be reached just now: ${(e as Error).message.slice(0, 120)}`);
  }
}
