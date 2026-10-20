import { platform } from "@/lib/burnticker/server";
import { publicOrigin } from "@/lib/burnticker/coinArt";
import { leagueDataForPages, LEAGUE_PAGE_TTL_MS } from "@/lib/burnticker/leaguesServe";
import { listedPairs, sitemapEntries, sitemapXml } from "@/lib/burnticker/sitemap";
import { testCoinKeys, withoutTestCoins } from "@/lib/burnticker/testCoins";
import { keepSitemap, keptSitemap } from "@/lib/burnticker/sitemapMemo";

export const dynamic = "force-dynamic";

// HB-35 (2026-10-20): 6.9 s cold. The body is kept for ten minutes (its own cache header says max-age=600) and built from the league
// pages' ten-minute table; a body built while the registry could not be read is not kept, so the next request tries again. The memo
// itself is in sitemapMemo.ts (a route file may export only its handlers).

/** GET /burnticker/sitemap.xml (served at /sitemap.xml through Caddy's rewrite): coins, pairs, leagues, docs (src/lib/burnticker/sitemap.ts). */
export async function GET() {
  const now = Date.now();
  const headers = { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=600", "x-content-type-options": "nosniff" };
  let reg: unknown = null;
  try { reg = platform().registry; } catch { reg = null; }
  const kept = keptSitemap();
  if (kept && reg !== null && kept.registry === reg && now - kept.at < LEAGUE_PAGE_TTL_MS) return new Response(kept.body, { status: 200, headers: { ...headers, "x-sitemap-memo": "hit" } });
  let readOk = false;
  let d: ReturnType<typeof leagueDataForPages> = { coins: [], readings: [], pairs: [], tickers: [] };
  let tests = testCoinKeys();
  let pairs: { pairId: string }[] = [];
  try {
    const p = platform(); d = leagueDataForPages(p, now); tests = testCoinKeys(process.cwd(), p.registry);
    // F-26: a pair is listed only when both its coins are launched (d.tickers holds the launched rows)
    pairs = listedPairs(p.registry.pairs(), d.tickers);
    readOk = true;
  } catch { /* the static pages, docs and leagues still list */ }
  // owner 2026-10-14: a test coin is not listed (testCoins.ts); $DEFICIT's page is (sitemap.ts OWN_COIN_PAGES)
  const body = sitemapXml(sitemapEntries({ origin: publicOrigin(), nowMs: now, coins: withoutTestCoins(d.tickers, tests), pairs, seasonCoins: d.coins }));
  if (readOk) keepSitemap({ at: now, registry: reg, body });
  return new Response(body, { status: 200, headers: { ...headers, "x-sitemap-memo": readOk ? "built" : "unread" } });
}
