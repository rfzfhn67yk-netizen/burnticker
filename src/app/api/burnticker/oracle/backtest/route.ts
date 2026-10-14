import { NextResponse } from "next/server";
import { edgeJson } from "@/lib/burnticker/api/http";
import { isSameOrigin } from "@/lib/sameOrigin";
import { platform } from "@/lib/burnticker/server";
import { runBacktest } from "@/lib/burnticker/api/handlers";

export const dynamic = "force-dynamic";

/**
 * POST { rule } → the back-test from the venue's own settled history ("this selector settled N times in the last 12 months and would
 * have burned X under this rule"), the matched markets (so a creator sees what a filter really binds to), the rule's canonical text and
 * hash, and the refuse-list verdict. Catalogue rules preview from the feed's frozen fixture. Shared with /v1/kalshi/backtest.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross-site request refused", code: "cross-origin" }, { status: 403 });
  let body: { rule?: unknown; months?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  // website-15 item 4: anything the handler did not catch is logged here and answered as JSON, never a bare 502 page
  try {
    const r = await runBacktest(platform(), body);
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error("[burnticker/backtest] the back-test route failed:", e);
    return edgeJson({ error: "The back-test could not run just now.", code: "backtest-unavailable" }, 502);
  }
}
