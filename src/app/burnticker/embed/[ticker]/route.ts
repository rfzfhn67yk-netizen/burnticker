import { platform } from "@/lib/burnticker/server";
import { badgeOrigin, coinBadgeData } from "@/lib/burnticker/badgeServe";
import { EMBED_HEADERS, renderEmbedHtml, renderEmbedMissing } from "@/lib/burnticker/embed";
import { lookupCoin, sharedTickerSentence } from "@/lib/burnticker/coinLookup";

export const dynamic = "force-dynamic";

/**
 * GET /burnticker/embed/<TICKER or MINT> — the iframe-safe receipt card with a live next-settlement line (src/lib/burnticker/embed.ts). A route
 * handler on purpose: no app chrome, no cookies, CSP frame-ancestors *. Snippets: the coin page's "Embed this coin" box.
 */
export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const id = decodeURIComponent(ticker);
  const now = Date.now();
  const valid = /^[A-Za-z0-9]{2,44}$/.test(id);
  // a ticker several coins share names their mints; each coin's card is at its mint (owner 2026-10-12: tickers are not unique)
  const l = valid ? (() => { try { return lookupCoin(platform().registry, id); } catch { return null; } })() : null;
  if (l?.kind === "many") return new Response(renderEmbedMissing(`${sharedTickerSentence(l.ticker)} ${l.tokens.map((t) => t.mint).join(", ")}.`), { status: 300, headers: { ...EMBED_HEADERS, "cache-control": "no-store" } });
  const b = valid ? await coinBadgeData(platform(), id, badgeOrigin(req), now).catch(() => null) : null;
  if (!b) return new Response(renderEmbedMissing(`There is no launched coin called ${(id.length >= 32 ? id : id.toUpperCase()).slice(0, 44)} on Burnticker.`), { status: 404, headers: { ...EMBED_HEADERS, "cache-control": "no-store" } });
  return new Response(renderEmbedHtml(b, now), { status: 200, headers: EMBED_HEADERS });
}
