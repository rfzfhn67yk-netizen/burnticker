import { NextResponse } from "next/server";
import { platform } from "@/lib/burnticker/server";
import { clientKey, limiter } from "@/lib/burnticker/api/http";
import { verifyPinnedMetadata } from "@/lib/burnticker/verify";
import { badgeFromText } from "@/lib/burnticker/describe";

export const dynamic = "force-dynamic";

/**
 * GET ?mint=<mint> → `{ ok, detail }`: the pinned-metadata check run on THIS HOST (verify.ts verifyPinnedMetadata: the bytes at the
 * coin's Arweave URI hash to the recorded sha256 and carry the locked description). 2026-10-14: the coin page ran this check in the
 * visitor's browser only; the gateway now redirects to a CDN host that the policy did not allow and that some networks cannot reach, so
 * the page showed ✗ for a sound pin. The page asks here first; its own fetch is a second opinion. Read-only, no-store, rate-limited.
 */
export async function GET(req: Request) {
  const rl = limiter.take(clientKey(req), "read");
  if (!rl.ok) return NextResponse.json({ ok: null, detail: "too many checks from this address; try again in a moment" }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  const mint = new URL(req.url).searchParams.get("mint") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return NextResponse.json({ ok: null, detail: "not a mint address" }, { status: 400 });
  const p = platform();
  const t = p.registry.token(mint), meta = p.registry.tokenMeta(mint);
  if (!t || !meta) return NextResponse.json({ ok: null, detail: "no such coin on this site" }, { status: 404, headers: { "cache-control": "no-store" } });
  let rule: unknown = null;
  try { rule = p.registry.lockedRule(t).rule; } catch { rule = null; }
  const expectedDescription = `${badgeFromText(rule as Parameters<typeof badgeFromText>[0], t.description)}\n${t.description}`;
  // ?raw=1: the pinned file itself, served through this site (some networks cannot reach the gateway's CDN; the bytes are the pin's,
  // and the sha256 header lets anyone compare them with the recorded hash)
  if (new URL(req.url).searchParams.get("raw") === "1" && meta.metadataUri && !meta.hosted) {
    try {
      const g = await fetch(meta.metadataUri, { redirect: "follow", cache: "no-store" });
      if (!g.ok) return NextResponse.json({ ok: null, detail: `the gateway answered HTTP ${g.status}` }, { status: 502, headers: { "cache-control": "no-store" } });
      const bytes = new Uint8Array(await g.arrayBuffer());
      const { createHash } = await import("node:crypto");
      return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=600", "x-pinned-sha256": createHash("sha256").update(bytes).digest("hex"), "x-pinned-uri": meta.metadataUri } });
    } catch (e) { return NextResponse.json({ ok: null, detail: `could not read the pin: ${String((e as Error).message).slice(0, 120)}` }, { status: 502, headers: { "cache-control": "no-store" } }); }
  }
  const r = await verifyPinnedMetadata({ metadataUri: meta.metadataUri, metadataSha256: meta.metadataSha256, hosted: meta.hosted, expectedDescription }, (u) => fetch(u, { redirect: "follow", cache: "no-store" }));
  return NextResponse.json(r, { headers: { "cache-control": "public, max-age=600" } });
}
