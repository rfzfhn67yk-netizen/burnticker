import { NextResponse } from "next/server";
import { platform } from "@/lib/burnticker/server";
import { heavyRefusal, pinCheckLimiter } from "@/lib/burnticker/api/http";
import { verifyPinnedMetadata } from "@/lib/burnticker/verify";
import { badgeFromText } from "@/lib/burnticker/describe";
import { LruMap } from "@/lib/burnticker/lru";

export const dynamic = "force-dynamic";

/** A-28: the largest pinned metadata file this route passes on, and how many files it keeps (a pin's bytes never change). */
const PIN_RAW_MAX_BYTES = 256 * 1024;
const PIN_RAW_KEEP = 128;
const rawKept = new LruMap<string, Uint8Array>(PIN_RAW_KEEP);
/** The body, or null past `max` bytes (read in chunks, so an oversized answer is never held whole). */
async function readCapped(r: Response, max: number): Promise<Uint8Array | null> {
  if (Number(r.headers.get("content-length") ?? 0) > max) return null;
  if (!r.body) return new Uint8Array(0);
  const parts: Uint8Array[] = [];
  let n = 0;
  const rd = r.body.getReader();
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await rd.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

/**
 * GET ?mint=<mint> → `{ ok, detail }`: the pinned-metadata check run on THIS HOST (verify.ts verifyPinnedMetadata: the bytes at the
 * coin's Arweave URI hash to the recorded sha256 and carry the locked description). 2026-10-14: the coin page ran this check in the
 * visitor's browser only; the gateway now redirects to a CDN host that the policy did not allow and that some networks cannot reach, so
 * the page showed ✗ for a sound pin. The page asks here first; its own fetch is a second opinion. Read-only, no-store, rate-limited.
 */
export async function GET(req: Request) {
  const refused = heavyRefusal(req, pinCheckLimiter, Date.now(), "read");   // A-38 review: its own limiter at the read sizes (every coin page asks)
  if (refused) return refused;
  const mint = new URL(req.url).searchParams.get("mint") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return NextResponse.json({ ok: null, detail: "not a mint address" }, { status: 400 });
  const p = platform();
  const t = p.registry.token(mint), meta = p.registry.tokenMeta(mint);
  if (!t || !meta) return NextResponse.json({ ok: null, detail: "no such coin on this site" }, { status: 404, headers: { "cache-control": "no-store" } });
  let rule: unknown = null;
  try { rule = p.registry.lockedRule(t).rule; } catch { rule = null; }
  const expectedDescription = `${badgeFromText(rule as Parameters<typeof badgeFromText>[0], t.description)}\n${t.description}`;
  // ?raw=1: the pinned file itself, served through this site (some networks cannot reach the gateway's CDN; the bytes are the pin's,
  // and the sha256 header lets anyone compare them with the recorded hash). Prelaunch audit 2026-10-18 A-28: the coin page's second
  // check reads the file here (the browser's own fetch to the gateway failed on every page) and hashes the bytes itself. Bounded (15 s,
  // at most PIN_RAW_MAX_BYTES), kept per address (a pin never changes) and rate-limited with the rest of this route.
  if (new URL(req.url).searchParams.get("raw") === "1" && meta.metadataUri && !meta.hosted) {
    const uri = meta.metadataUri;
    try {
      let bytes = rawKept.get(uri);
      if (!bytes) {
        const g = await fetch(uri, { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(15_000) });   // prelaunch audit H1
        if (!g.ok) return NextResponse.json({ ok: null, detail: `the gateway answered HTTP ${g.status}` }, { status: 502, headers: { "cache-control": "no-store" } });
        const got = await readCapped(g, PIN_RAW_MAX_BYTES);
        if (!got) return NextResponse.json({ ok: null, detail: `the pinned file is larger than ${PIN_RAW_MAX_BYTES} bytes` }, { status: 502, headers: { "cache-control": "no-store" } });
        bytes = got;
        rawKept.set(uri, bytes);
      }
      const { createHash } = await import("node:crypto");
      return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600, s-maxage=3600", "x-pinned-sha256": createHash("sha256").update(bytes).digest("hex"), "x-pinned-uri": uri, "x-content-type-options": "nosniff" } });
    } catch (e) { return NextResponse.json({ ok: null, detail: `could not read the pin: ${String((e as Error).message).slice(0, 120)}` }, { status: 502, headers: { "cache-control": "no-store" } }); }
  }
  const r = await verifyPinnedMetadata({ metadataUri: meta.metadataUri, metadataSha256: meta.metadataSha256, hosted: meta.hosted, expectedDescription }, (u) => fetch(u, { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(15_000) }));
  // review of A-22 item 6: only a passing verdict may be kept (ten minutes); a failure or an unread pin (a gateway hiccup) is asked
  // again next time, never served from a cache
  return NextResponse.json(r, { headers: { "cache-control": r.ok === true ? "public, max-age=600" : "no-store" } });
}
