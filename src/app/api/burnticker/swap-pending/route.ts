import { NextResponse } from "next/server";
import { clientKey, limiter } from "@/lib/burnticker/api/http";
import { isSameOrigin } from "@/lib/sameOrigin";
import { clearOf, queryOf, swapPendingStore, verifyPendingClaim } from "@/lib/burnticker/swap/pendingServer";

export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };
const tooMany = (s: number) => NextResponse.json({ error: `Too many requests. Try again in ${s} seconds.` }, { status: 429, headers: { ...headers, "retry-after": String(s) } });
const readBody = async (req: Request): Promise<unknown> => { const t = await req.text(); if (t.length > 8_000) return null; try { return JSON.parse(t); } catch { return null; } };

/**
 * /api/burnticker/swap-pending — the server's copy of a wallet's held swap (continuous audit 2026-10-19 SEC-02; swap/pendingServer.ts).
 *   GET  ?network&mint&owner        the held swap for this wallet and coin, or { pending: null }
 *   POST { network, mint, owner, signature, lastValidBlockHeight, side, tx }   written from the signed transaction, before it is sent
 *   DELETE { network, mint, owner, signature }                                  removed once the swap settled (only that signature)
 * POST and DELETE are same-origin only (a CSRF check). Public keys and signatures only.
 */
export async function GET(req: Request) {
  const rl = limiter.take(clientKey(req), "read");
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const q = queryOf(new URL(req.url).searchParams);
  if (!q) return NextResponse.json({ error: "Name a network, a coin and a wallet." }, { status: 400, headers });
  try { return NextResponse.json({ pending: swapPendingStore().get(q.network, q.mint, q.owner) }, { headers }); }
  catch { return NextResponse.json({ error: "The held swap could not be read just now." }, { status: 503, headers }); }
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Requests from other sites are refused." }, { status: 403, headers });
  const rl = limiter.take(clientKey(req), "confirm");
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const v = verifyPendingClaim(await readBody(req));
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400, headers });
  // continuous audit 2026-10-19T1919Z SEC-02: the answer names the signature it kept; the panel sends the swap only on that acknowledgement
  try { swapPendingStore().put(v.rec); return NextResponse.json({ ok: true, signature: v.rec.signature }, { headers }); }
  catch { return NextResponse.json({ error: "The held swap could not be saved just now." }, { status: 503, headers }); }
}

export async function DELETE(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Requests from other sites are refused." }, { status: 403, headers });
  const rl = limiter.take(clientKey(req), "confirm");
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const c = clearOf(await readBody(req));
  if (!c) return NextResponse.json({ error: "Name the network, the coin, the wallet and the swap's signature." }, { status: 400, headers });
  try { return NextResponse.json({ ok: true, removed: swapPendingStore().clear(c.network, c.mint, c.owner, c.signature) }, { headers }); }
  catch { return NextResponse.json({ error: "The held swap could not be removed just now." }, { status: 503, headers }); }
}
