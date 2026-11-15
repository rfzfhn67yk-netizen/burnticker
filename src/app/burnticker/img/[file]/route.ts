import { platform } from "@/lib/burnticker/server";
import { coinImage } from "@/lib/burnticker/coinArtServe";
import { serveImageCopy } from "@/lib/burnticker/imageStore";
import { heavyRefusal, imageLimiter } from "@/lib/burnticker/api/http";

export const dynamic = "force-dynamic";

/** GET /burnticker/img/<TICKER or MINT>.svg|.png — the coin's generated image (coinArt.ts); `preview.svg?t=&r=` for the wizard's live preview; a bare <MINT> — the site's copy of the coin's uploaded image (imageStore.ts). */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  // audit 2026-10-18 A-42: the preview renders a rule and text the caller sends, so it is limited per client (a coin's own image is
  // rendered once from its locked rule and cached)
  if (file.startsWith("preview.")) { const refused = heavyRefusal(req, imageLimiter); if (refused) return refused; }
  // 2026-10-27: a bare mint (no extension) is the site's own copy of the coin's uploaded image (imageStore.ts): the file named by the
  // registry's recorded sha256 for that mint, hashed again before it is served, immutable for a year (the hash never changes); 404 otherwise
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(file)) {
    const c = serveImageCopy({ registry: platform().registry, mint: file });
    if (c.status === 200) return new Response(c.body as BodyInit, { status: 200, headers: { "content-type": c.type, "cache-control": "public, max-age=31536000, immutable", "x-image-sha256": c.sha256, "x-content-type-options": "nosniff", "content-disposition": "inline" } });
    return new Response(c.body, { status: 404, headers: { "content-type": c.type, "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" } });
  }
  const r = await coinImage({ registry: platform().registry, file, query: new URL(req.url).searchParams });
  return new Response(r.body as BodyInit, { status: r.status, headers: { "content-type": r.type, "cache-control": r.status === 200 ? (file.startsWith("preview.") ? "public, max-age=300" : "public, max-age=86400, immutable") : "no-store", "x-content-type-options": "nosniff" } });
}
