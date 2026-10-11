import { platform } from "@/lib/burnticker/server";
import { badgeOrigin, coinBadgeData } from "@/lib/burnticker/badgeServe";
import { EMBED_HEADERS, renderEmbedHtml, renderEmbedMissing } from "@/lib/burnticker/embed";

export const dynamic = "force-dynamic";

/**
 * GET /burnticker/embed/<TICKER> — the iframe-safe receipt card with a live next-settlement line (src/lib/burnticker/embed.ts). A route
 * handler on purpose: no app chrome, no cookies, CSP frame-ancestors *. Snippets: the coin page's "Embed this coin" box.
 */
export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const id = decodeURIComponent(ticker);
  const now = Date.now();
  const b = /^[A-Za-z0-9]{2,44}$/.test(id) ? await coinBadgeData(platform(), id, badgeOrigin(req), now).catch(() => null) : null;
  if (!b) return new Response(renderEmbedMissing(`No launched coin ${id.toUpperCase().slice(0, 44)} on Burnticker.`), { status: 404, headers: { ...EMBED_HEADERS, "cache-control": "no-store" } });
  return new Response(renderEmbedHtml(b, now), { status: 200, headers: EMBED_HEADERS });
}
