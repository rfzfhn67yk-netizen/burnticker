import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/sameOrigin";
import { platform } from "@/lib/burnticker/server";
import { markLaunched, prepareLaunch } from "@/lib/burnticker/api/handlers";
import { clientKey, limiter } from "@/lib/burnticker/api/http";
import { RATE_LIMITS } from "@/lib/burnticker/api/spec";
import { pairCurveEnabled } from "@/lib/burnticker/pairCurveLaunch";
import { recordLaunchTimings } from "@/lib/burnticker/api/product";
import { creatorLaunchRefusal } from "@/lib/burnticker/creatorLaunches";

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
  // BURNTICKER_CREATOR_LAUNCHES_ENABLED off (the default): no creator launch — the operator's coins launch through the CLI.
  const closed = creatorLaunchRefusal(process.env);
  if (closed) return NextResponse.json(closed.body, { status: closed.status });
  // ChatGPT/Codex review N4 (2026-10-10): the same per-client write bucket as /v1/launch/bundle and /v1/launch/confirm (one shared
  // bucket: a client cannot double its allowance by alternating routes). An Origin header is not authentication; this is the meter.
  const rl = limiter.take(clientKey(req), "write");
  if (!rl.ok) return NextResponse.json({ error: `rate limited: ${RATE_LIMITS.write.human}; retry in ${rl.retryAfterSec}s`, code: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec), "ratelimit-limit": String(rl.limit), "ratelimit-remaining": "0" } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const p = platform();
  // ChatGPT/Codex review N6 (2026-10-10): with BURNTICKER_PAIR_CURVE_ENABLED a rivalry pair launches ONLY through pair_curve (both
  // graduate or neither). A client must ask for that venue (`venue: "pair-curve"`) and gets the pair-curve transaction set and never
  // the two independent LaunchLab bundles; one that does not ask is refused BEFORE anything is pinned or registered — no silent
  // fallback. Asking for the pair curve on a host without it is refused too.
  if (body.pair && body.action !== "launched") {
    const on = pairCurveEnabled(process.env), wants = body.venue === "pair-curve";
    if (on && !wants) return NextResponse.json({ error: "rivalry pairs on this host launch through the pair curve (both coins graduate together or neither does); send venue: \"pair-curve\" and sign the pair-curve transaction set — two independent LaunchLab launches are not offered", code: "pair-curve-required" }, { status: 409 });
    if (!on && wants) return NextResponse.json({ error: "the pair curve is not enabled on this host (BURNTICKER_PAIR_CURVE_ENABLED)", code: "pair-curve-unavailable" }, { status: 409 });
  }
  if (body.action === "launched") { const r = await markLaunched(p, String(body.mint ?? ""), String(body.launchTx ?? "")); return NextResponse.json(r.body, { status: r.status }); }
  const r = await prepareLaunch(p, body, { register: true });
  if ("error" in r) return NextResponse.json(r.error.body, { status: r.error.status });
  recordLaunchTimings(p, body, "pair" in r ? [r.pair.tokens.a?.mint, r.pair.tokens.b?.mint] : [r.ok.token?.mint]);   // time-to-launch (productStore.ts)
  // RIVALRY PAIR (`pair: { ticker, name, … }` for side B): both bundles, both drafts and the pair row.
  if ("pair" in r) {
    // The two fresh mint keypairs' secrets ride along (as LaunchLab bundles carry mintSecretKey): tx 1 needs creator + mint A, tx 2
    // creator + mint B. The LaunchLab bundles themselves are never sent on this venue.
    if (r.pair.pairCurve) return NextResponse.json({ ok: true, venue: "pair-curve", pair: { pairId: r.pair.pairId, selector: r.pair.selector, notes: r.pair.notes, row: r.pair.row }, pairCurve: r.pair.pairCurve, mintSecretKeys: { a: r.pair.bundles.a.mintSecretKey, b: r.pair.bundles.b.mintSecretKey }, tokens: r.pair.tokens, seriesTitle: r.pair.seriesTitle, stubs: p.stubs });
    return NextResponse.json({ ok: true, venue: "launchlab", pair: { pairId: r.pair.pairId, selector: r.pair.selector, notes: r.pair.notes, row: r.pair.row }, bundles: r.pair.bundles, tokens: r.pair.tokens, seriesTitle: r.pair.seriesTitle, stubs: p.stubs });
  }
  return NextResponse.json({ ok: true, bundle: r.ok.bundle, token: r.ok.token, seriesTitle: r.ok.seriesTitle, stubs: p.stubs });
}
