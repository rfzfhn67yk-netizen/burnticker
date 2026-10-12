/**
 * The coin page's download and feed links (wiring-1, 2026-10-12). The addresses and link words that csvServe.ts and feeds.ts own, kept
 * here without their server imports so the client-side coin page can print them. csvServe.ts and feeds.ts re-export everything below.
 */
export type FeedFormat = "rss" | "json";
export const FEEDS_PATH = "/api/burnticker/feeds";

/** The feed addresses the layout and the coin page advertise with <link rel="alternate"> (WIRING.md). */
export const feedHref = (feed: "receipts" | "next-results" | { coin: string }, fmt: FeedFormat) => `${FEEDS_PATH}/${typeof feed === "string" ? feed : `coin/${encodeURIComponent(feed.coin.toUpperCase())}`}.${fmt}`;
export const COIN_FEED_LINK = "Follow this coin's feed";

/** the coin page's Burn log links (WIRING.md) */
export const CSV_LINK_COPY = {
  burnsLink: "Download the burns as a CSV file",
  readingsLink: "Download the readings as a CSV file",
};
export const csvHref = (ticker: string, kind: "burns" | "readings") => `/api/burnticker/coins/${encodeURIComponent(ticker.toUpperCase())}/${kind}.csv`;
