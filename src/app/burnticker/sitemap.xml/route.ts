import { platform } from "@/lib/burnticker/server";
import { publicOrigin } from "@/lib/burnticker/coinArt";
import { leagueData } from "@/lib/burnticker/leaguesServe";
import { sitemapEntries, sitemapXml } from "@/lib/burnticker/sitemap";

export const dynamic = "force-dynamic";

/** GET /burnticker/sitemap.xml (served at /sitemap.xml through Caddy's rewrite): coins, pairs, leagues, docs (src/lib/burnticker/sitemap.ts). */
export async function GET() {
  const now = Date.now();
  let d: ReturnType<typeof leagueData> = { coins: [], readings: [], pairs: [], tickers: [] };
  try { d = leagueData(platform(), now); } catch { /* the static pages, docs and leagues still list */ }
  const body = sitemapXml(sitemapEntries({ origin: publicOrigin(), nowMs: now, coins: d.tickers, pairs: d.pairs, seasonCoins: d.coins }));
  return new Response(body, { status: 200, headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=600", "x-content-type-options": "nosniff" } });
}
