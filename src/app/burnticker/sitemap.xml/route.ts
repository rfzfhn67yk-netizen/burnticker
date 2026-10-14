import { platform } from "@/lib/burnticker/server";
import { publicOrigin } from "@/lib/burnticker/coinArt";
import { leagueData } from "@/lib/burnticker/leaguesServe";
import { sitemapEntries, sitemapXml } from "@/lib/burnticker/sitemap";
import { testCoinKeys, withoutTestCoins } from "@/lib/burnticker/testCoins";

export const dynamic = "force-dynamic";

/** GET /burnticker/sitemap.xml (served at /sitemap.xml through Caddy's rewrite): coins, pairs, leagues, docs (src/lib/burnticker/sitemap.ts). */
export async function GET() {
  const now = Date.now();
  let d: ReturnType<typeof leagueData> = { coins: [], readings: [], pairs: [], tickers: [] };
  let tests = testCoinKeys();
  try { const p = platform(); d = leagueData(p, now); tests = testCoinKeys(process.cwd(), p.registry); } catch { /* the static pages, docs and leagues still list */ }
  // owner 2026-10-14: a test coin is not listed (testCoins.ts); $DEFICIT's page is (sitemap.ts OWN_COIN_PAGES)
  const body = sitemapXml(sitemapEntries({ origin: publicOrigin(), nowMs: now, coins: withoutTestCoins(d.tickers, tests), pairs: d.pairs, seasonCoins: d.coins }));
  return new Response(body, { status: 200, headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=600", "x-content-type-options": "nosniff" } });
}
