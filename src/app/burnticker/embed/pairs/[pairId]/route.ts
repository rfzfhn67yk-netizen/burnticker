import { platform } from "@/lib/burnticker/server";
import { badgeOrigin, pairBadgeData } from "@/lib/burnticker/badgeServe";
import { EMBED_HEADERS, renderEmbedHtml, renderEmbedMissing } from "@/lib/burnticker/embed";

export const dynamic = "force-dynamic";

/** GET /burnticker/embed/pairs/<pairId> — a rivalry pair's iframe-safe receipt card (src/lib/burnticker/embed.ts). */
export async function GET(req: Request, { params }: { params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;
  const id = decodeURIComponent(pairId);
  const now = Date.now();
  const b = /^[A-Za-z0-9_-]{2,64}$/.test(id) ? await pairBadgeData(platform(), id, badgeOrigin(req), now).catch(() => null) : null;
  if (!b) return new Response(renderEmbedMissing(`There is no launched pair called ${id.slice(0, 64)} on Burnticker.`), { status: 404, headers: { ...EMBED_HEADERS, "cache-control": "no-store" } });
  return new Response(renderEmbedHtml(b, now), { status: 200, headers: EMBED_HEADERS });
}
