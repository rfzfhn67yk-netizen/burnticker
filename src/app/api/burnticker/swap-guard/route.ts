import { NextResponse } from "next/server";
import { clientKey, limiter } from "@/lib/burnticker/api/http";
import { swapGuard } from "@/lib/burnticker/swap/guard";

export const dynamic = "force-dynamic";

/** GET /api/burnticker/swap-guard — the coin page's swap panel reads this host's network, the operator's wallets and the test coins (swap/guard.ts). */
export async function GET(req: Request) {
  const rl = limiter.take(clientKey(req), "read");
  if (!rl.ok) return NextResponse.json({ error: `Too many requests. Try again in ${rl.retryAfterSec} seconds.` }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  try {
    return NextResponse.json(swapGuard(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: `The guard list could not be read: ${String((e as Error)?.message ?? e).slice(0, 120)}` }, { status: 503 });
  }
}
