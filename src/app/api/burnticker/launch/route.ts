import { NextResponse } from "next/server";
import { launchFailureOf } from "@/lib/burnticker/api/launchFailAlert";
import { pairCurveRequiredFor } from "@/lib/burnticker/pairVenueRule";
import { isSameOrigin } from "@/lib/sameOrigin";
import { platform } from "@/lib/burnticker/server";
import { launchesClosedAt, markLaunched, prepareLaunch } from "@/lib/burnticker/api/handlers";
import { clientKey, edgeJson, fail, limiter, readTextCapped } from "@/lib/burnticker/api/http";
import { RATE_LIMITS } from "@/lib/burnticker/api/spec";
import { pairCurveEnabled } from "@/lib/burnticker/pairCurveLaunch";
import { recordLaunchTimings } from "@/lib/burnticker/api/product";
import { globalRefusal, typeRefusal } from "@/lib/burnticker/launchAvailability";
import { lookupTablePins } from "@/lib/burnticker/networks";
import { matchesSuffix } from "@/lib/burnticker/mintSuffix";
import { MINT_BANK_EMPTY_CODE, MINT_BANK_EMPTY_SENTENCE, webMintBank, type MintBankPort } from "@/lib/burnticker/mintBank";
import { Keypair } from "@solana/web3.js";
import { safeErrorText } from "@/lib/burnticker/api/errorText";
import { bodyFingerprint, IDEMPOTENCY_KEY_RE, IdempotentRuns } from "@/lib/burnticker/api/idempotency";

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
  let body: Record<string, unknown>;
  // prelaunch audit M3 (2026-10-15): the body is capped before it is parsed (two 2 MB images as base64, a pair's, plus the rules fit),
  // here at the one parse, so the `launched` record is capped too
  const text = await readTextCapped(req);
  if (text === null) return NextResponse.json({ error: "The request is too large. An image can be at most 2 MB.", code: "too-large" }, { status: 413 });
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  // AUDIT A C1 (6, 7; findings M1 and H4): `launched` records a launch that is ALREADY SIGNED AND ON CHAIN. It is taken whether launches
  // are open, closed or in preview (closing launches must not strand a coin that exists), and it is metered on the heavy bucket, not the
  // 10-an-hour write bucket (a creator who built a few bundles must still be able to record the one that landed). The chain decides.
  if (body.action === "launched") {
    const rlc = limiter.take(clientKey(req), "heavy");
    if (!rlc.ok) return NextResponse.json({ error: `rate limited: ${RATE_LIMITS.heavy.human}; retry in ${rlc.retryAfterSec}s`, code: "rate-limited", retryAfterSec: rlc.retryAfterSec }, { status: 429, headers: { "retry-after": String(rlc.retryAfterSec), "ratelimit-limit": String(rlc.limit), "ratelimit-remaining": "0" } });
    const p = platform();
    const bank: MintBankPort | null = p.mintBank !== undefined ? p.mintBank : webMintBank();
    const mint = String(body.mint ?? "");
    const r = await markLaunched(p, mint, String(body.launchTx ?? ""), Date.now(), clientKey(req));
    // the mint is live: its prepared key (if it came from the bank) is spent, and its sealed secret is wiped
    if (r.status === 200) { try { bank?.markCreated(mint); } catch { /* the bank service also marks it from the registry */ } }
    return edgeJson(r.body, r.status);
  }
  // BURNTICKER_CREATOR_LAUNCHES_ENABLED off (the default): no creator launch — the operator's coins launch through the CLI. In preview
  // mode (BURNTICKER_CREATOR_LAUNCHES_PREVIEW) the refusal says so (code launches-closed, preview: true): nothing builds or sends.
  const closed = globalRefusal(process.env);
  try { launchesClosedAt(platform()); } catch { /* the closure record never breaks a request */ }   // re-review 2: every evaluation records or clears it
  if (closed) return NextResponse.json(closed.body, { status: closed.status });
  // ChatGPT/Codex review N4 (2026-10-10): the same per-client write bucket as /v1/launch/bundle (confirmations have their own, AUDIT A C1) (one shared
  // bucket: a client cannot double its allowance by alternating routes). An Origin header is not authentication; this is the meter.
  const rl = limiter.take(clientKey(req), "write");
  if (!rl.ok) return NextResponse.json({ error: `rate limited: ${RATE_LIMITS.write.human}; retry in ${rl.retryAfterSec}s`, code: "rate-limited", retryAfterSec: rl.retryAfterSec }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec), "ratelimit-limit": String(rl.limit), "ratelimit-remaining": "0" } });
  const p = platform();
  // launch audit 5 L02: a launch type this host cannot take (sports without its settlement source, pairs off on mainnet) is refused here
  // too, with the plain reason — the page explains it before any form, the server enforces it.
  { const off = typeRefusal(body, process.env, p.cluster); if (off) return NextResponse.json(off.body, { status: off.status }); }
  // ChatGPT/Codex review N6 (2026-10-10): with BURNTICKER_PAIR_CURVE_ENABLED a rivalry pair launches ONLY through pair_curve (both
  // graduate or neither). A client must ask for that venue (`venue: "pair-curve"`) and gets the pair-curve transaction set and never
  // the two independent LaunchLab bundles; one that does not ask is refused BEFORE anything is pinned or registered — no silent
  // fallback. Asking for the pair curve on a host without it is refused too.
  if (body.pair) {
    // 2026-10-14: a rivalry series pair and a settled-event pair are LaunchLab pairs linked at creation, never the pair curve (pairVenueRule.ts)
    const on = pairCurveRequiredFor(body, pairCurveEnabled(process.env)), wants = body.venue === "pair-curve";
    if (on && !wants) return NextResponse.json({ error: "rivalry pairs on this host launch through the pair curve (both coins graduate together or neither does); send venue: \"pair-curve\" and sign the pair-curve transaction set — two independent LaunchLab launches are not offered", code: "pair-curve-required" }, { status: 409 });
    if (!pairCurveEnabled(process.env) && wants) return NextResponse.json({ error: "the pair curve is not enabled on this host (BURNTICKER_PAIR_CURVE_ENABLED)", code: "pair-curve-unavailable" }, { status: 409 });
  }
  // THE DEPLOY SMOKE'S DRY RUN (2026-10-15; scripts/ops/burnticker-deploy-smoke.sh): `dryRun: true` runs every check a launch runs (the
  // rule refusals, the preflight, the pin budget and the uploader) through the public origin, and answers how long it took. It registers
  // nothing, uploads nothing and takes no key from the mint bank, so it can run after every deploy on the live host.
  if (body.dryRun === true) {
    const t0 = Date.now();
    let d: Awaited<ReturnType<typeof prepareLaunch>>;
    try { d = await prepareLaunch(p, body, { register: false, dryRun: true, client: clientKey(req) }); }
    catch (e) { d = { error: fail(500, `The launch could not be prepared. The error was: ${safeErrorText(e)}`, { code: "internal" }) }; }
    if ("error" in d) return edgeJson({ ...(d.error.body as Record<string, unknown>), dryRun: true }, d.error.status, { ...(d.error.headers ?? {}), "cache-control": "no-store" });
    const tickers = "pair" in d ? [d.pair.bundles.a.ticker, d.pair.bundles.b.ticker] : [d.ok.bundle.ticker];
    return NextResponse.json({ ok: true, dryRun: true, ms: Date.now() - t0, cluster: p.cluster, tickers, registered: false, keysTaken: 0 }, { headers: { "cache-control": "no-store" } });
  }
  const bank: MintBankPort | null = p.mintBank !== undefined ? p.mintBank : webMintBank();
  // 2026-10-14 night (owner: "the BURN vanity address is mandatory. Save them like pump.fun does so they launch instantly."): every coin's
  // address ends in burn or BURN. The page sends no `mint`; this route takes one prepared key per coin (two for a pair) from the host's
  // mint key bank (mintBank.ts, filled by scripts/burnticker-mint-bank.mts), marks it taken, builds the bundle with it and returns its
  // secret in the bundle (`mintSecretKey`; `mintSecretKeys` on the pair curve) once, over HTTPS only. A refused request deletes the keys it
  // took (never offered again). No key ready, no bank on this host, or a plain-HTTP request: `mint-bank-empty`, and the page finds the
  // address in the browser and sends its PUBLIC key in `mint` (and `pair.mint`), which must end in burn too.
  const own = typeof body.mint === "string" ? body.mint : undefined;
  const ownB = body.pair && typeof (body.pair as { mint?: unknown }).mint === "string" ? (body.pair as { mint: string }).mint : undefined;
  if ((own !== undefined && !matchesSuffix(own)) || (ownB !== undefined && !matchesSuffix(ownB))) return NextResponse.json({ error: "Every coin made here gets an address that ends in burn, and this one does not. Please press Launch again.", code: "mint-not-burn" }, { status: 400 });
  // audit 2026-10-15 M2: one prepare per draft (idempotency.ts): the page's key, scoped to the creator AND the mint source (review item 1:
  // the bank's keys and the browser's own mints are two different prepares, so the browser search after mint-bank-empty is never a
  // "reused key"). Review item 4: an answer carrying a bank key's secret is never replayed to a plain-HTTP request (no key at all then),
  // and an answer is replayed only while every draft in it is still a draft.
  const fromBank = own === undefined && ownB === undefined;
  const idem = typeof body.idempotencyKey === "string" && IDEMPOTENCY_KEY_RE.test(body.idempotencyKey) && (!fromBank || secureRequest(req)) ? `${String(body.creator ?? "")}|${body.idempotencyKey}|${own ?? "bank"}|${ownB ?? "-"}` : null;
  return PREPARES.run(idem, bodyFingerprint(body), () => prepareAnswer(req, body, p, bank, own, ownB), Date.now(), (cached) => stillDrafts(cached, p));
}

/** Review 2026-10-15 item 4: a kept prepare answer may be handed out again only while every coin in it is still an unlaunched draft. */
async function stillDrafts(cached: Response, p: ReturnType<typeof platform>): Promise<boolean> {
  type M = { mint?: string } | null | undefined;
  const j = await cached.json() as { bundle?: M; token?: M; bundles?: { a?: M; b?: M }; tokens?: { a?: M; b?: M } };
  const mints = [...new Set([j.bundle?.mint, j.token?.mint, j.bundles?.a?.mint, j.bundles?.b?.mint, j.tokens?.a?.mint, j.tokens?.b?.mint].filter((m): m is string => typeof m === "string"))];
  return mints.length > 0 && mints.every((m) => { const t = p.registry.token(m); return !!t && t.status === "draft" && !t.launchTx; });
}

/** One launch prepare, answered: the keys are taken only after every check passed (audit 2026-10-15 H4) and discarded on a refusal. */
async function prepareAnswer(req: Request, body: Record<string, unknown>, p: ReturnType<typeof platform>, bank: MintBankPort | null, own: string | undefined, ownB: string | undefined): Promise<Response> {
  let taken: Keypair[] | null = null;
  const takeMintKeys = own === undefined && ownB === undefined ? (tickers: string[]) => {
    let keys: { publicKey: string; secretKey: Uint8Array }[] | null = null;
    if (secureRequest(req)) { try { keys = bank?.take(tickers.map((t) => t.toUpperCase())) ?? null; } catch { keys = null; } }
    if (!keys || keys.length < tickers.length) return { error: fail(503, MINT_BANK_EMPTY_SENTENCE, { code: MINT_BANK_EMPTY_CODE }) };
    taken = keys.map((k) => Keypair.fromSecretKey(k.secretKey));
    return { keys: taken };
  } : undefined;
  // 2026-10-14 night: this route (the page's own launch) raised no bt-launch-failed alert — only the v1 review and bundle routes were
  // wrapped — so a whole evening of refused launches reached nobody's phone. A thrown error is a 500 here, and every server error or
  // launch-check refusal is recorded like the v1 routes' (launchFailAlert.ts; push.ts sends it).
  let r: Awaited<ReturnType<typeof prepareLaunch>>;
  try { r = await prepareLaunch(p, body, { register: true, ...(own !== undefined ? { mint: own } : {}), ...(ownB !== undefined ? { mintB: ownB } : {}), ...(takeMintKeys ? { takeMintKeys } : {}), client: clientKey(req) }); }
  catch (e) { r = { error: fail(500, `The launch could not be prepared. The error was: ${safeErrorText(e)}`, { code: "internal" }) }; }
  const took = taken as Keypair[] | null;
  if ("error" in r && took) { try { bank?.discard(took.map((k) => k.publicKey.toBase58())); } catch { /* the 24-hour sweep deletes them */ } }
  // launch walkthrough 2026-10-13: a refusal answered 502 (the launch check could not read a source) reached the page as Cloudflare's
  // own error page, so the page said "The launch request failed (502)"; edgeJson sends it as 503 with the sentence intact
  if ("error" in r) {
    // the bank being empty is the page's cue to find the address in the browser, not a failure to report
    if ((r.error.body as { code?: unknown })?.code !== MINT_BANK_EMPTY_CODE) { try { const a = launchFailureOf("launchPage", body, { status: r.error.status, body: r.error.body }); if (a) p.registry.recordAlert(a); } catch { /* an alert never breaks a launch answer */ } }
    return edgeJson(r.error.body, r.error.status, { "cache-control": "no-store", ...(r.error.headers ?? {}) });
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

/** Audit 2026-10-15 M2: the prepares in flight or answered in the last 15 minutes, by draft key (this process only). */
const PREPARES = new IdempotentRuns();

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
