import { NextResponse } from "next/server";
import { launchFailureOf } from "@/lib/burnticker/api/launchFailAlert";
import { pairCurveRequiredFor } from "@/lib/burnticker/pairVenueRule";
import { isSameOrigin } from "@/lib/sameOrigin";
import { platform } from "@/lib/burnticker/server";
import { markLaunched, prepareLaunch } from "@/lib/burnticker/api/handlers";
import { clientKey, edgeJson, fail, limiter } from "@/lib/burnticker/api/http";
import { RATE_LIMITS } from "@/lib/burnticker/api/spec";
import { pairCurveEnabled } from "@/lib/burnticker/pairCurveLaunch";
import { recordLaunchTimings } from "@/lib/burnticker/api/product";
import { globalRefusal, typeRefusal } from "@/lib/burnticker/launchAvailability";
import { lookupTablePins } from "@/lib/burnticker/networks";
import { matchesSuffix } from "@/lib/burnticker/mintSuffix";
import { MINT_BANK_EMPTY_CODE, MINT_BANK_EMPTY_SENTENCE, webMintBank, type MintBankPort } from "@/lib/burnticker/mintBank";
import { Keypair } from "@solana/web3.js";

export const dynamic = "force-dynamic";

/**
 * GET → the lookup-table pins the signing card checks (launch-10, 2026-10-12): `{ lookupTables: { devnet, mainnet } }`, each
 * `{ address, authority }` from the host's BURNTICKER_LOOKUP_TABLE / _AUTHORITY on its own network, else networks.ts. Read at runtime so
 * pinning a table needs no code release; the browser still checks every entry of the table it finds there before anything is signed.
 */
export async function GET() {
  return NextResponse.json({ lookupTables: lookupTablePins(process.env) }, { headers: { "cache-control": "no-store" } });
}

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
  // BURNTICKER_CREATOR_LAUNCHES_ENABLED off (the default): no creator launch — the operator's coins launch through the CLI. In preview
  // mode (BURNTICKER_CREATOR_LAUNCHES_PREVIEW) the refusal says so (code launches-closed, preview: true): nothing builds or sends.
  const closed = globalRefusal(process.env);
  if (closed) return NextResponse.json(closed.body, { status: closed.status });
  // ChatGPT/Codex review N4 (2026-10-10): the same per-client write bucket as /v1/launch/bundle and /v1/launch/confirm (one shared
  // bucket: a client cannot double its allowance by alternating routes). An Origin header is not authentication; this is the meter.
  const rl = limiter.take(clientKey(req), "write");
  if (!rl.ok) return NextResponse.json({ error: `rate limited: ${RATE_LIMITS.write.human}; retry in ${rl.retryAfterSec}s`, code: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec), "ratelimit-limit": String(rl.limit), "ratelimit-remaining": "0" } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const p = platform();
  // launch audit 5 L02: a launch type this host cannot take (sports without its settlement source, pairs off on mainnet) is refused here
  // too, with the plain reason — the page explains it before any form, the server enforces it.
  if (body.action !== "launched") { const off = typeRefusal(body, process.env, p.cluster); if (off) return NextResponse.json(off.body, { status: off.status }); }
  // ChatGPT/Codex review N6 (2026-10-10): with BURNTICKER_PAIR_CURVE_ENABLED a rivalry pair launches ONLY through pair_curve (both
  // graduate or neither). A client must ask for that venue (`venue: "pair-curve"`) and gets the pair-curve transaction set and never
  // the two independent LaunchLab bundles; one that does not ask is refused BEFORE anything is pinned or registered — no silent
  // fallback. Asking for the pair curve on a host without it is refused too.
  if (body.pair && body.action !== "launched") {
    // 2026-10-14: a rivalry series pair and a settled-event pair are LaunchLab pairs linked at creation, never the pair curve (pairVenueRule.ts)
    const on = pairCurveRequiredFor(body, pairCurveEnabled(process.env)), wants = body.venue === "pair-curve";
    if (on && !wants) return NextResponse.json({ error: "rivalry pairs on this host launch through the pair curve (both coins graduate together or neither does); send venue: \"pair-curve\" and sign the pair-curve transaction set — two independent LaunchLab launches are not offered", code: "pair-curve-required" }, { status: 409 });
    if (!pairCurveEnabled(process.env) && wants) return NextResponse.json({ error: "the pair curve is not enabled on this host (BURNTICKER_PAIR_CURVE_ENABLED)", code: "pair-curve-unavailable" }, { status: 409 });
  }
  const bank: MintBankPort | null = p.mintBank !== undefined ? p.mintBank : webMintBank();
  if (body.action === "launched") {
    const mint = String(body.mint ?? "");
    const r = await markLaunched(p, mint, String(body.launchTx ?? ""));
    // the mint is live: its prepared key (if it came from the bank) is spent, and its sealed secret is wiped
    if (r.status === 200) { try { bank?.markCreated(mint); } catch { /* the bank service also marks it from the registry */ } }
    return edgeJson(r.body, r.status);
  }
  // 2026-10-14 night (owner: "the BURN vanity address is mandatory. Save them like pump.fun does so they launch instantly."): every coin's
  // address ends in burn or BURN. The page sends no `mint`; this route takes one prepared key per coin (two for a pair) from the host's
  // mint key bank (mintBank.ts, filled by scripts/burnticker-mint-bank.mts), marks it taken, builds the bundle with it and returns its
  // secret in the bundle (`mintSecretKey`; `mintSecretKeys` on the pair curve) once, over HTTPS only. A refused request deletes the keys it
  // took (never offered again). No key ready, no bank on this host, or a plain-HTTP request: `mint-bank-empty`, and the page finds the
  // address in the browser and sends its PUBLIC key in `mint` (and `pair.mint`), which must end in burn too.
  const own = typeof body.mint === "string" ? body.mint : undefined;
  const ownB = body.pair && typeof (body.pair as { mint?: unknown }).mint === "string" ? (body.pair as { mint: string }).mint : undefined;
  // 2026-10-14 night: this route (the page's own launch) raised no bt-launch-failed alert — only the v1 review and bundle routes were
  // wrapped — so a whole evening of refused launches reached nobody's phone. A thrown error is a 500 here, and every server error or
  // launch-check refusal is recorded like the v1 routes' (launchFailAlert.ts; push.ts sends it).
  if ((own !== undefined && !matchesSuffix(own)) || (ownB !== undefined && !matchesSuffix(ownB))) return NextResponse.json({ error: "Every coin made here gets an address that ends in burn, and this one does not. Please press Launch again.", code: "mint-not-burn" }, { status: 400 });
  let taken: Keypair[] | null = null;
  if (own === undefined && ownB === undefined) {
    const tickers = [String(body.ticker ?? ""), ...(body.pair ? [String((body.pair as { ticker?: unknown }).ticker ?? "")] : [])].map((t) => t.toUpperCase());
    let keys: { publicKey: string; secretKey: Uint8Array }[] | null = null;
    if (secureRequest(req)) { try { keys = bank?.take(tickers) ?? null; } catch { keys = null; } }
    if (!keys) return NextResponse.json({ error: MINT_BANK_EMPTY_SENTENCE, code: MINT_BANK_EMPTY_CODE }, { status: 503, headers: { "cache-control": "no-store" } });
    taken = keys.map((k) => Keypair.fromSecretKey(k.secretKey));
  }
  let r: Awaited<ReturnType<typeof prepareLaunch>>;
  try { r = await prepareLaunch(p, body, { register: true, ...(own !== undefined ? { mint: own } : {}), ...(ownB !== undefined ? { mintB: ownB } : {}), ...(taken ? { mintKeypair: taken[0], ...(taken[1] ? { mintKeypairB: taken[1] } : {}) } : {}) }); }
  catch (e) { r = { error: fail(500, `The launch could not be prepared. The error was: ${String((e as Error)?.message ?? e).slice(0, 160)}`, { code: "internal" }) }; }
  if ("error" in r && taken) { try { bank?.discard(taken.map((k) => k.publicKey.toBase58())); } catch { /* the 24-hour sweep deletes them */ } }
  // launch walkthrough 2026-10-13: a refusal answered 502 (the launch check could not read a source) reached the page as Cloudflare's
  // own error page, so the page said "The launch request failed (502)"; edgeJson sends it as 503 with the sentence intact
  if ("error" in r) {
    try { const a = launchFailureOf("launchPage", body, { status: r.error.status, body: r.error.body }); if (a) p.registry.recordAlert(a); } catch { /* an alert never breaks a launch answer */ }
    return edgeJson(r.error.body, r.error.status, r.error.headers ?? {});
  }
  recordLaunchTimings(p, body, "pair" in r ? [r.pair.tokens.a?.mint, r.pair.tokens.b?.mint] : [r.ok.token?.mint]);   // time-to-launch (productStore.ts)
  // RIVALRY PAIR (`pair: { ticker, name, … }` for side B): both bundles, both drafts and the pair row.
  if ("pair" in r) {
    // The two bank keypairs' secrets ride along (as LaunchLab bundles carry mintSecretKey): tx 1 needs creator + mint A, tx 2 creator +
    // mint B. The LaunchLab bundles themselves are never sent on this venue. With the page's own mints both are null.
    if (r.pair.pairCurve) return NextResponse.json({ ok: true, venue: "pair-curve", pair: { pairId: r.pair.pairId, selector: r.pair.selector, notes: r.pair.notes, row: r.pair.row }, pairCurve: r.pair.pairCurve, mintSecretKeys: { a: r.pair.bundles.a.mintSecretKey, b: r.pair.bundles.b.mintSecretKey }, tokens: r.pair.tokens, seriesTitle: r.pair.seriesTitle, stubs: p.stubs });
    return NextResponse.json({ ok: true, venue: "launchlab", pair: { pairId: r.pair.pairId, selector: r.pair.selector, notes: r.pair.notes, row: r.pair.row }, bundles: r.pair.bundles, tokens: r.pair.tokens, seriesTitle: r.pair.seriesTitle, stubs: p.stubs });
  }
  return NextResponse.json({ ok: true, bundle: r.ok.bundle, token: r.ok.token, seriesTitle: r.ok.seriesTitle, stubs: p.stubs });
}

/**
 * A bank key's secret leaves this host only over HTTPS: the request reached Caddy over https (X-Forwarded-Proto, which Caddy sets from
 * its own connection), or the URL itself is https, or it is a local development host. Anything else gets mint-bank-empty.
 */
function secureRequest(req: Request): boolean {
  if ((req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase() === "https") return true;
  try {
    const u = new URL(req.url);
    if (u.protocol === "https:") return true;
    const host = (req.headers.get("host") ?? u.host).toLowerCase().replace(/:\d+$/, "");
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch { return false; }
}
