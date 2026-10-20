import { NextResponse } from "next/server";
import { clientKey, limiter } from "@/lib/burnticker/api/http";
import { isSameOrigin } from "@/lib/sameOrigin";
import { clearOf, heldState, queryOf, sealedHold, swapPendingChain, swapPendingStore, trustedExpiry, verifyPendingClaim } from "@/lib/burnticker/swap/pendingServer";

export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };
const MAX_BODY = 8_000;
const tooMany = (s: number) => NextResponse.json({ error: `Too many requests. Try again in ${s} seconds.` }, { status: 429, headers: { ...headers, "retry-after": String(s) } });
const crossOrigin = () => NextResponse.json({ error: "Requests from other sites are refused.", code: "cross-origin" }, { status: 403, headers });
/** HB-65 (AP6-4): stops reading at MAX_BODY characters instead of reading the whole body first. */
const readBody = async (req: Request): Promise<unknown> => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return null;
  if (!req.body) return null;
  const reader = req.body.getReader(), dec = new TextDecoder();
  let t = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    t += dec.decode(value, { stream: true });
    if (t.length > MAX_BODY) { void reader.cancel().catch(() => {}); return null; }
  }
  try { return JSON.parse(t + dec.decode()); } catch { return null; }
};

/**
 * /api/burnticker/swap-pending — the server's copy of a wallet's held swap (continuous audit 2026-10-19 SEC-02; swap/pendingServer.ts).
 *   GET  ?network&mint&owner        this wallet's held swap for this coin: whole once the chain shows it can no longer land, SEALED (no
 *                                   signature) while it may still land, or { pending: null }
 *   POST { network, mint, owner, signature, lastValidBlockHeight, side, tx }   written from the signed transaction, before it is sent
 *   DELETE { network, mint, owner, signature }                                  removed only once the chain shows that signature settled
 * POST and DELETE are same-origin only (a CSRF check) and rate limited. HB-65: the signature is not a secret, so it never authorizes a
 * removal by itself; the server's own chain read does (pendingServer.ts heldState). Public keys and signatures only.
 */
export async function GET(req: Request) {
  const rl = limiter.take(clientKey(req), "read");
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const q = queryOf(new URL(req.url).searchParams);
  if (!q) return NextResponse.json({ error: "Name a network, a coin and a wallet." }, { status: 400, headers });
  let rec;
  try { rec = swapPendingStore().get(q.network, q.mint, q.owner); }
  catch { return NextResponse.json({ error: "The held swap could not be read just now." }, { status: 503, headers }); }
  if (!rec) return NextResponse.json({ pending: null }, { headers });
  // HB-65: a swap that may still land is shown sealed, so nobody learns its signature from this page
  const state = await heldState(await swapPendingChain(rec.network), rec);
  return NextResponse.json({ pending: state === "settled" ? rec : sealedHold(rec) }, { headers });
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return crossOrigin();
  const rl = limiter.take(clientKey(req), "confirm");
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const v = verifyPendingClaim(await readBody(req));
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400, headers });
  // HB-65 v2: a record already held for this wallet and coin is never replaced while it may still land (a replayed older transaction),
  // the same signature again changes nothing (no re-dating), and the expiry is the server's own (trustedExpiry)
  const held409 = () => NextResponse.json({ error: "An earlier swap from this wallet for this coin may still settle, so this one was not recorded and should not be sent.", code: "swap-held" }, { status: 409, headers });
  let existing;
  try { existing = swapPendingStore().get(v.rec.network, v.rec.mint, v.rec.owner); }
  catch { return NextResponse.json({ error: "The held swap could not be saved just now." }, { status: 503, headers }); }
  if (existing && existing.signature === v.rec.signature) return NextResponse.json({ ok: true, signature: v.rec.signature }, { headers });
  const chain = await swapPendingChain(v.rec.network);
  if (existing && (await heldState(chain, existing)) !== "settled") return held409();
  const rec = { ...v.rec, lastValidBlockHeight: await trustedExpiry(chain, v.rec.lastValidBlockHeight) };
  // continuous audit 2026-10-19T1919Z SEC-02: the answer names the signature it kept; the panel sends the swap only on that acknowledgement
  let r;
  try { r = swapPendingStore().putIfCurrent(rec, existing?.signature ?? null); }
  catch { return NextResponse.json({ error: "The held swap could not be saved just now." }, { status: 503, headers }); }
  if (r === "held") return held409();
  return NextResponse.json({ ok: true, signature: rec.signature }, { headers });
}

export async function DELETE(req: Request) {
  if (!isSameOrigin(req)) return crossOrigin();
  const rl = limiter.take(clientKey(req), "confirm");
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const c = clearOf(await readBody(req));
  if (!c) return NextResponse.json({ error: "Name the network, the coin, the wallet and the swap's signature." }, { status: 400, headers });
  let rec;
  try { rec = swapPendingStore().get(c.network, c.mint, c.owner); }
  catch { return NextResponse.json({ error: "The held swap could not be removed just now." }, { status: 503, headers }); }
  // another wallet, coin, network or signature: nothing of this wallet's is touched
  if (!rec || rec.signature !== c.signature) return NextResponse.json({ error: "There is no held swap with that signature for this wallet and coin.", code: "swap-not-held" }, { status: 403, headers });
  const state = await heldState(await swapPendingChain(rec.network), rec);
  if (state === "unknown") return NextResponse.json({ error: "The swap's state could not be read from the chain just now, so its record was kept. Try again in a moment." }, { status: 503, headers });
  if (state === "pending") return NextResponse.json({ error: "This swap may still settle, so its record is kept until the chain shows it settled.", code: "swap-unsettled" }, { status: 403, headers });
  try { return NextResponse.json({ ok: true, removed: swapPendingStore().clear(c.network, c.mint, c.owner, c.signature) }, { headers }); }
  catch { return NextResponse.json({ error: "The held swap could not be removed just now." }, { status: 503, headers }); }
}
