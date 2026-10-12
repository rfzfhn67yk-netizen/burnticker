import { platform } from "@/lib/burnticker/server";
import { publicOrigin } from "@/lib/burnticker/coinArt";
import { collectFeedData } from "@/lib/burnticker/feedsData";
import { FEED_COPY, feedError, feedResponse, nextResultsFeed, parseFeedFile, receiptsFeed } from "@/lib/burnticker/feeds";

export const dynamic = "force-dynamic";

/**
 * GET /api/burnticker/feeds/receipts.rss|.json and /api/burnticker/feeds/next-results.rss|.json (polish-1; docs/burnticker/api.md
 * "Feeds"). RSS 2.0 or JSON Feed 1.1 from the rows the home page and the next-results page read; cached five minutes, with an ETag.
 */
export async function GET(req: Request, ctx: { params: Promise<{ feed: string }> }) {
  const { feed } = await ctx.params;
  const f = parseFeedFile(feed);
  if (!f || (f.name !== "receipts" && f.name !== "next-results")) return feedError(404, FEED_COPY.badPath);
  const now = Date.now();
  let data;
  try { data = await collectFeedData(platform(), now); } catch { return feedError(503, FEED_COPY.unavailable); }
  if (!data.ok) return feedError(503, FEED_COPY.unavailable);
  const doc = f.name === "receipts" ? receiptsFeed(data.events, publicOrigin(), now) : nextResultsFeed(data.upcoming, publicOrigin(), now);
  return feedResponse(req, doc, f.fmt);
}
