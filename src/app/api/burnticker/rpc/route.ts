import { NextResponse } from "next/server";
import { clientKey, limiter } from "@/lib/burnticker/api/http";
import { rpcUrlFor, type Network } from "@/lib/burnticker/networks";
import { hostCluster } from "@/lib/burnticker/launchAvailability";
import { RPC_PROXY_MAX_BODY, rpcProxyRefusal } from "@/lib/burnticker/rpcProxy";
import { BudgetHoldError, takeRpc } from "@/lib/burnticker/apiBudget";
import { ensureWebApiBudget } from "@/lib/burnticker/server";

export const dynamic = "force-dynamic";

/** POST /api/burnticker/rpc — the browser's JSON-RPC proxy (src/lib/burnticker/rpcProxy.ts). Same-site only; rate limited as a heavy read. */
export async function POST(req: Request) {
  const origin = req.headers.get("origin") ?? "", host = req.headers.get("host") ?? "";
  if (origin && !origin.endsWith(`//${host}`)) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Requests from other sites are refused." } }, { status: 403 });
  const rl = limiter.take(clientKey(req), "heavy");
  if (!rl.ok) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32005, message: `Too many requests. Try again in ${rl.retryAfterSec} seconds.` } }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  const text = await req.text();
  if (text.length > RPC_PROXY_MAX_BODY) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "The request is too large." } }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "The request is not JSON." } }, { status: 400 }); }
  const refused = rpcProxyRefusal(body);
  if (refused) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32601, message: `This site does not forward ${refused}.` } }, { status: 400 });
  const cluster = hostCluster(process.env);
  const network: Network = cluster === "mainnet" ? "mainnet" : "devnet";
  // the request budget (apiBudget.ts): the site's share of the RPC plan; a spent day or a full bucket answers 503, nothing is forwarded
  ensureWebApiBudget();
  try { await takeRpc(rpcUrlFor(network), body); } catch (e) {
    if (e instanceof BudgetHoldError) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32005, message: "The site has used its network allowance for now. Please try again in a few minutes." } }, { status: 503, headers: { "retry-after": "60" } });
    throw e;
  }
  try {
    const up = await fetch(rpcUrlFor(network), { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(20_000) });
    const answer = await up.text();
    return new Response(answer, { status: up.ok ? 200 : 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: `The network could not be reached just now: ${(e as Error).message.slice(0, 120)}` } }, { status: 503 });
  }
}
