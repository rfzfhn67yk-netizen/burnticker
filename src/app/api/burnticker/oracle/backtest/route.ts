import { NextResponse } from "next/server";
import { clientKey, edgeJson, limiter, readTextCapped } from "@/lib/burnticker/api/http";
import { isSameOrigin } from "@/lib/sameOrigin";
import { platform } from "@/lib/burnticker/server";
import { runBacktest } from "@/lib/burnticker/api/handlers";

export const dynamic = "force-dynamic";
const BACKTEST_MAX_BODY = 64_000;

/**
 * POST { rule } → the back-test from the venue's own settled history ("this selector settled N times in the last 12 months and would
 * have burned X under this rule"), the matched markets (so a creator sees what a filter really binds to), the rule's canonical text and
 * hash, and the refuse-list verdict. Catalogue rules preview from the feed's frozen fixture. Shared with /v1/kalshi/backtest.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross-site request refused", code: "cross-origin" }, { status: 403 });
  // prelaunch audit H6 (2026-10-15): a back-test reads a venue's history and runs the rule's filter over it; it is a heavy read, limited
  // like the public API's /v1/kalshi/backtest, and its body is capped before it is parsed
  const rl = limiter.take(clientKey(req), "heavy");
  if (!rl.ok) return NextResponse.json({ error: `Too many requests. Please try again in ${rl.retryAfterSec} seconds.`, code: "rate-limited" }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  let body: { rule?: unknown; months?: number };
  const text = await readTextCapped(req, BACKTEST_MAX_BODY);
  if (text === null) return NextResponse.json({ error: "The request is too large.", code: "too-large" }, { status: 413 });
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  // website-15 item 4: anything the handler did not catch is logged here and answered as JSON, never a bare 502 page
  try {
    const r = await runBacktest(platform(), body);
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error("[burnticker/backtest] the back-test route failed:", e);
    return edgeJson({ error: "The back-test could not run just now.", code: "backtest-unavailable" }, 502);
  }
}
