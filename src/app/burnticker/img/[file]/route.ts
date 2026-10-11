import { platform } from "@/lib/burnticker/server";
import { coinImage } from "@/lib/burnticker/coinArtServe";

export const dynamic = "force-dynamic";

/** GET /burnticker/img/<TICKER>.svg|.png — the coin's generated image (coinArt.ts); `preview.svg?t=&r=` for the wizard's live preview. */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const r = await coinImage({ registry: platform().registry, file, query: new URL(req.url).searchParams });
  return new Response(r.body as BodyInit, { status: r.status, headers: { "content-type": r.type, "cache-control": r.status === 200 ? (file.startsWith("preview.") ? "public, max-age=300" : "public, max-age=86400, immutable") : "no-store", "x-content-type-options": "nosniff" } });
}
