import { platform } from "@/lib/burnticker/server";
import { publicOrigin } from "@/lib/burnticker/coinArt";
import { cachedFeedData } from "@/lib/burnticker/feedsData";
import { FEED_COPY, coinFeed, feedError, feedResponse, parseFeedFile } from "@/lib/burnticker/feeds";
import { isMintKey } from "@/lib/burnticker/coinKey";

export const dynamic = "force-dynamic";

/** GET /api/burnticker/feeds/coin/<TICKER or MINT>.rss|.json (polish-1): one coin's burns, signed readings, graduation and pool registration. */
export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const f = parseFeedFile(file, /^[A-Za-z0-9]{2,44}$/);
  if (!f) return feedError(404, FEED_COPY.badPath);
  const now = Date.now();
  let data;
  // audit 2026-10-16 F-11: the memoised copy (feedsData.ts cachedFeedData), no per-coin chain read per request
  try { data = await cachedFeedData(platform()); } catch { return feedError(503, FEED_COPY.unavailable); }
  if (!data.ok) return feedError(503, FEED_COPY.unavailable);
  // a mint works in place of the ticker; a ticker several coins share answers with their mints (tickers are not unique, coinKey.ts)
  if (isMintKey(f.name)) {
    const c = data.coins?.find((x) => x.mint === f.name);
    return c ? feedResponse(req, coinFeed(c.ticker, data.events, publicOrigin(), now, undefined, c.mint), f.fmt) : feedError(404, FEED_COPY.unknownMint);
  }
  const ticker = f.name.toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) return feedError(404, FEED_COPY.badPath);
  const same = (data.coins ?? []).filter((x) => x.ticker.toUpperCase() === ticker);
  if (same.length > 1) return feedError(300, [`Several coins use the ticker $${ticker}. Each one has its own feed at its mint address.`, ...same.map((x) => x.mint)].join("\n"));
  if (!data.tickers.has(ticker)) return feedError(404, FEED_COPY.unknownCoin(ticker));
  return feedResponse(req, coinFeed(ticker, data.events, publicOrigin(), now), f.fmt);
}
