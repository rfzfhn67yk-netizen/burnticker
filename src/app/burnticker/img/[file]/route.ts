import { platform } from "@/lib/burnticker/server";
import { coinImage } from "@/lib/burnticker/coinArtServe";
import { heavyRefusal, imageLimiter } from "@/lib/burnticker/api/http";

export const dynamic = "force-dynamic";

/** GET /burnticker/img/<TICKER or MINT>.svg|.png — the coin's generated image (coinArt.ts); `preview.svg?t=&r=` for the wizard's live preview. */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  // audit 2026-10-18 A-42: the preview renders a rule and text the caller sends, so it is limited per client (a coin's own image is
  // rendered once from its locked rule and cached)
  if (file.startsWith("preview.")) { const refused = heavyRefusal(req, imageLimiter); if (refused) return refused; }
  const r = await coinImage({ registry: platform().registry, file, query: new URL(req.url).searchParams });
  return new Response(r.body as BodyInit, { status: r.status, headers: { "content-type": r.type, "cache-control": r.status === 200 ? (file.startsWith("preview.") ? "public, max-age=300" : "public, max-age=86400, immutable") : "no-store", "x-content-type-options": "nosniff" } });
}
