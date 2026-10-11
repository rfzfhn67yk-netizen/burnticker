import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/sameOrigin";
import { platform } from "@/lib/burnticker/server";
import { markLaunched, prepareLaunch } from "@/lib/burnticker/api/handlers";
import { recordLaunchTimings } from "@/lib/burnticker/api/product";

export const dynamic = "force-dynamic";

/**
 * POST { ...LaunchInput } → the unsigned launch bundle (initialize_token + LaunchLab create under the Burnticker platform config, the
 * canonical rules.json and its hash, the fee split, the allocation) and a DRAFT registration. The wallet signs client-side; the
 * registration goes live only when `action: "launched"` reports the landed launch transaction. Refusals: the refuse list (titles,
 * categories, names), rules that do not validate, tier-2 rules that disagree with their feed, mainnet (until the program and the
 * LaunchLab adapter are live). No parameter outside LaunchInput is read: no referral codes, no discounts. The pipeline is shared with
 * the public API's /v1/launch/bundle (src/lib/burnticker/api/handlers.ts). A body with `pair: { ticker, name, … }` launches a rivalry pair.
 */
export async function POST(req: Request) {
  // Cross-site requests are refused before the body is read (the repo's rule for every mutating route). No PIN and no trusted-host
  // check here: creators are third parties using the wizard on this origin.
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross-site request refused", code: "cross-origin" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const p = platform();
  if (body.action === "launched") { const r = markLaunched(p, String(body.mint ?? ""), String(body.launchTx ?? "")); return NextResponse.json(r.body, { status: r.status }); }
  const r = await prepareLaunch(p, body, { register: true });
  if ("error" in r) return NextResponse.json(r.error.body, { status: r.error.status });
  recordLaunchTimings(p, body, "pair" in r ? [r.pair.tokens.a?.mint, r.pair.tokens.b?.mint] : [r.ok.token?.mint]);   // time-to-launch (productStore.ts)
  // RIVALRY PAIR (`pair: { ticker, name, … }` for side B): both bundles, both drafts and the pair row.
  if ("pair" in r) return NextResponse.json({ ok: true, pair: { pairId: r.pair.pairId, selector: r.pair.selector, notes: r.pair.notes, row: r.pair.row }, bundles: r.pair.bundles, tokens: r.pair.tokens, seriesTitle: r.pair.seriesTitle, stubs: p.stubs });
  return NextResponse.json({ ok: true, bundle: r.ok.bundle, token: r.ok.token, seriesTitle: r.ok.seriesTitle, stubs: p.stubs });
}
