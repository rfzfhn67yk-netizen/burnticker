import { createHash } from "node:crypto";
import { EVENT_LABEL, type ActivityEvent } from "@/lib/burnticker/activity";
import { SETTLEMENT_LABEL, UPCOMING_EMPTY, type UpcomingRow } from "@/lib/burnticker/upcoming";
import { FEEDS_PATH, type FeedFormat } from "@/lib/burnticker/exportLinks";
export { FEEDS_PATH, feedHref, COIN_FEED_LINK, type FeedFormat } from "@/lib/burnticker/exportLinks";

/**
 * THE FEEDS (polish-1, 2026-10-12; PLATFORM-NEXT-2-BRIEF.md item 5). Three feeds, each as RSS 2.0 and as JSON Feed 1.1, built from the
 * same rows the pages read (feedsData.ts collects them the way the home API does):
 *
 *   receipts       every confirmed burn this site shows (the home page's activity rows of kind "burn"), each linking its own receipt check
 *   coin/<TICKER or MINT>  one coin's rows of every kind: burns, signed readings, graduation and pool registration (activity.ts)
 *   next-results   the next result each coin waits for and where its latest result stands (upcoming.ts, the /burnticker/upcoming page)
 *
 * Pure: the routes pass the rows, the origin and the clock. An empty feed is a valid feed with no items whose description says why in a
 * sentence; nothing is padded with a placeholder item. No item carries a price, a market figure or a promise (the copy lint holds every
 * fixed sentence below, and the rows' own sentences come from modules the lint already covers).
 */

export type FeedId = "receipts" | "next-results" | `coin:${string}`;
export interface FeedItem { id: string; title: string; text: string; url: string; /** ISO; null when the row's time is not read */ date: string | null }
export interface FeedDoc { id: FeedId; title: string; description: string; homeUrl: string; rssUrl: string; jsonUrl: string; items: FeedItem[]; /** set when items is empty: the honest reason */ emptyText: string | null; updated: string }

export const FEED_CACHE_SEC = 300;
export const FEED_ITEM_LIMIT = 50;
export const RSS_TYPE = "application/rss+xml; charset=utf-8";
export const JSON_FEED_TYPE = "application/feed+json; charset=utf-8";

export const FEED_COPY = {
  receiptsTitle: "Burnticker burn receipts",
  receiptsDescription: "Every confirmed burn this site shows, newest first. Each item links to its receipt, which anyone can check in a browser.",
  receiptsEmpty: "No burn has been recorded on this site yet. Each burn appears here with a link to its receipt once it is confirmed on chain.",
  coinDescription: (t: string) => `Burns, signed readings, graduation and pool registration for $${t}, newest first. Each item links to its own evidence.`,
  coinEmpty: (t: string) => `Nothing has happened on chain for $${t} yet. Its burns and signed readings appear here once they are recorded.`,
  nextTitle: "Burnticker next results",
  nextDescription: "The next result each Burnticker coin waits for, who publishes it, and where the latest result stands. A new item appears when a coin's state changes.",
  nextEmpty: UPCOMING_EMPTY,
  devnet: "This happened on devnet, a practice network whose tokens have no money value.",
  undated: "This site does not read the date of this event.",
  unavailable: "This feed could not be read just now. Nothing is wrong with the coins themselves. Try again in a few minutes.",
  unknownCoin: (t: string) => `No coin with the ticker $${t} is on this site.`,
  unknownMint: "No launched coin with that mint address is on this site.",
  badPath: "Feed addresses end in .rss or .json, for example receipts.rss or coin/DEFICIT.json.",
};


/** "receipts.rss" → { name: "receipts", fmt: "rss" }; null for anything else. */
export function parseFeedFile(file: string, namePattern = /^[A-Za-z0-9-]{2,44}$/): { name: string; fmt: FeedFormat } | null {
  const m = /^(.+)\.(rss|json)$/.exec(decodeURIComponent(file));
  if (!m || !namePattern.test(m[1])) return null;
  return { name: m[1], fmt: m[2] as FeedFormat };
}

const abs = (origin: string, href: string) => (/^https?:\/\//.test(href) ? href : `${origin}${href.startsWith("/") ? "" : "/"}${href}`);
const urls = (origin: string, rel: string) => ({ rssUrl: `${origin}${FEEDS_PATH}/${rel}.rss`, jsonUrl: `${origin}${FEEDS_PATH}/${rel}.json` });
const isoOf = (at: string | null): string | null => { if (!at) return null; const t = Date.parse(at.length === 10 ? `${at}T00:00:00Z` : at); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const short = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

function eventItem(e: ActivityEvent, origin: string): FeedItem {
  const date = isoOf(e.at);
  const extra = [e.network === "devnet" ? FEED_COPY.devnet : null, date ? null : FEED_COPY.undated].filter(Boolean).join(" ");
  return {
    id: e.signature ? `${e.kind}:${e.signature}` : `${e.kind}:${e.network}:${e.ticker}`,
    title: `${EVENT_LABEL[e.kind]} for $${e.ticker}`, text: extra ? `${e.text} ${extra}` : e.text, url: abs(origin, e.href), date,
  };
}

/** Newest first; undated rows after the dated ones. */
const byDate = (a: FeedItem, b: FeedItem) => (a.date === b.date ? 0 : a.date === null ? 1 : b.date === null ? -1 : b.date.localeCompare(a.date));

export function receiptsFeed(events: readonly ActivityEvent[], origin: string, now: number): FeedDoc {
  const items = events.filter((e) => e.kind === "burn").map((e) => eventItem(e, origin)).sort(byDate).slice(0, FEED_ITEM_LIMIT);
  return { id: "receipts", title: FEED_COPY.receiptsTitle, description: FEED_COPY.receiptsDescription, homeUrl: `${origin}/burnticker`, ...urls(origin, "receipts"), items, emptyText: items.length ? null : FEED_COPY.receiptsEmpty, updated: new Date(now).toISOString() };
}

/** `mint`: the coin's mint when its ticker is shared (or it was asked for by mint); its rows are then read by mint and its addresses use the mint. */
export function coinFeed(ticker: string, events: readonly ActivityEvent[], origin: string, now: number, homeUrl?: string, mint?: string | null): FeedDoc {
  const t = ticker.toUpperCase(), key = mint ?? t;
  const items = events.filter((e) => (mint ? e.mint === mint : e.ticker.toUpperCase() === t)).map((e) => eventItem(e, origin)).sort(byDate).slice(0, FEED_ITEM_LIMIT);
  return { id: `coin:${key}`, title: `$${t} on Burnticker`, description: FEED_COPY.coinDescription(t), homeUrl: homeUrl ?? `${origin}/burnticker/t/${encodeURIComponent(key)}`, ...urls(origin, `coin/${encodeURIComponent(key)}`), items, emptyText: items.length ? null : FEED_COPY.coinEmpty(t), updated: new Date(now).toISOString() };
}

/** One item per coin; its id changes whenever the coin's state or sentence changes, so a reader sees each change as a new item. */
export function nextResultsFeed(rows: readonly UpcomingRow[], origin: string, now: number): FeedDoc {
  const items = rows.slice(0, FEED_ITEM_LIMIT).map((r): FeedItem => ({
    id: `next:${r.ticker}:${r.status}:${short(`${r.statusText}|${r.event}`)}`,
    title: `Next result for $${r.ticker}`,
    text: [`${SETTLEMENT_LABEL[r.status]}.`, `${r.event}.`, `${r.source}.`, r.schedule, r.statusText, r.network === "devnet" ? FEED_COPY.devnet : ""].filter(Boolean).join(" ").replace(/\.\./g, "."),
    url: abs(origin, r.receiptHref ?? r.href), date: null,
  }));
  return { id: "next-results", title: FEED_COPY.nextTitle, description: FEED_COPY.nextDescription, homeUrl: `${origin}/burnticker/upcoming`, ...urls(origin, "next-results"), items, emptyText: items.length ? null : FEED_COPY.nextEmpty, updated: new Date(now).toISOString() };
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
  // characters XML 1.0 forbids
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");

/** RSS 2.0 (with the Atom self link the validators ask for). */
export function renderRss(d: FeedDoc): string {
  const desc = d.emptyText ? `${d.description} ${d.emptyText}` : d.description;
  const items = d.items.map((i) => [
    "    <item>",
    `      <title>${xml(i.title)}</title>`,
    `      <link>${xml(i.url)}</link>`,
    `      <description>${xml(i.text)}</description>`,
    `      <guid isPermaLink="false">${xml(i.id)}</guid>`,
    ...(i.date ? [`      <pubDate>${new Date(i.date).toUTCString()}</pubDate>`] : []),
    "    </item>",
  ].join("\n"));
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    "  <channel>",
    `    <title>${xml(d.title)}</title>`,
    `    <link>${xml(d.homeUrl)}</link>`,
    `    <description>${xml(desc)}</description>`,
    "    <language>en-us</language>",
    `    <lastBuildDate>${new Date(d.updated).toUTCString()}</lastBuildDate>`,
    `    <ttl>${Math.round(FEED_CACHE_SEC / 60)}</ttl>`,
    `    <atom:link href="${xml(d.rssUrl)}" rel="self" type="application/rss+xml"/>`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

export interface JsonFeed {
  version: "https://jsonfeed.org/version/1.1"; title: string; home_page_url: string; feed_url: string; description: string; language: string;
  authors: { name: string; url: string }[];
  items: { id: string; url: string; title: string; content_text: string; date_published?: string }[];
  _burnticker: { feed: FeedId; rss: string; updated: string; empty: string | null };
}

/** JSON Feed 1.1. `_burnticker` is an extension object (the spec reserves leading-underscore keys for them). */
export function renderJsonFeed(d: FeedDoc): JsonFeed {
  return {
    version: "https://jsonfeed.org/version/1.1", title: d.title, home_page_url: d.homeUrl, feed_url: d.jsonUrl,
    description: d.emptyText ? `${d.description} ${d.emptyText}` : d.description, language: "en-US",
    authors: [{ name: "Burnticker", url: d.homeUrl.replace(/\/burnticker.*$/, "/burnticker") }],
    items: d.items.map((i) => ({ id: i.id, url: i.url, title: i.title, content_text: i.text, ...(i.date ? { date_published: i.date } : {}) })),
    _burnticker: { feed: d.id, rss: d.rssUrl, updated: d.updated, empty: d.emptyText },
  };
}

/** The body, its content type and the caching headers (an ETag of the body, so a reader's conditional GET answers 304). */
export function feedResponseParts(d: FeedDoc, fmt: FeedFormat): { body: string; type: string; etag: string; headers: Record<string, string> } {
  // the ETag ignores the build time, so an unchanged feed keeps its tag between requests
  const stable = { ...d, updated: "" };
  const etag = `"${createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 32)}"`;
  const body = fmt === "rss" ? renderRss(d) : `${JSON.stringify(renderJsonFeed(d), null, 2)}\n`;
  const type = fmt === "rss" ? RSS_TYPE : JSON_FEED_TYPE;
  return { body, type, etag, headers: { "content-type": type, "cache-control": `public, max-age=${FEED_CACHE_SEC}, stale-while-revalidate=${FEED_CACHE_SEC * 2}`, etag, "access-control-allow-origin": "*", "x-content-type-options": "nosniff" } };
}

/** A Response for a feed, honouring If-None-Match. */
export function feedResponse(req: Request, d: FeedDoc, fmt: FeedFormat): Response {
  const p = feedResponseParts(d, fmt);
  const inm = req.headers.get("if-none-match");
  if (inm && inm.split(",").map((s) => s.trim()).includes(p.etag)) return new Response(null, { status: 304, headers: { etag: p.etag, "cache-control": p.headers["cache-control"] } });
  return new Response(p.body, { status: 200, headers: p.headers });
}

/** A plain-text refusal (404 unknown, 503 unreadable), never cached. */
export function feedError(status: number, text: string): Response {
  return new Response(`${text}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "access-control-allow-origin": "*" } });
}
