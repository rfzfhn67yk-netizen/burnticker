import { platform } from "@/lib/burnticker/server";
import { publicOrigin } from "@/lib/burnticker/coinArt";
import { collectFeedData } from "@/lib/burnticker/feedsData";
import { FEED_COPY, coinFeed, feedError, feedResponse, parseFeedFile } from "@/lib/burnticker/feeds";

export const dynamic = "force-dynamic";

/** GET /api/burnticker/feeds/coin/<TICKER>.rss|.json (polish-1): one coin's burns, signed readings, graduation and pool registration. */
export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const f = parseFeedFile(file, /^[A-Za-z0-9]{2,12}$/);
  if (!f) return feedError(404, FEED_COPY.badPath);
  const ticker = f.name.toUpperCase();
  const now = Date.now();
  let data;
  try { data = await collectFeedData(platform(), now); } catch { return feedError(503, FEED_COPY.unavailable); }
  if (!data.ok) return feedError(503, FEED_COPY.unavailable);
  if (!data.tickers.has(ticker)) return feedError(404, FEED_COPY.unknownCoin(ticker));
  return feedResponse(req, coinFeed(ticker, data.events, publicOrigin(), now), f.fmt);
}
