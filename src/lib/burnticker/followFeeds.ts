import { feedHref } from "@/lib/burnticker/exportLinks";

/**
 * "GET THE NEXT RESULT" BESIDE FOLLOW (campaign readiness 2026-10-19, item 6). Follow is kept in this browser only and sends nothing, so
 * the coin page and the $DEFICIT page put the two ways to hear about the next result beside it: the coin's RSS feed
 * (/api/burnticker/feeds/coin/<key>.rss) and its burn calendar (/api/burnticker/v1/coins/<key>/calendar.ics). Client-safe.
 */
export const NEXT_RESULT_LEAD = "Get the next result:";
export const NEXT_RESULT_LABELS = { rss: "RSS", calendar: "Calendar" } as const;
/** The coin's calendar file (the public API's calendar.ics; a mint, or $DEFICIT's ticker before it is registered here). */
export const calendarIcsHref = (key: string): string => `/api/burnticker/v1/coins/${encodeURIComponent(key)}/calendar.ics`;
/** Both links for one coin: `feedKey` is the coin's ticker or mint (coinKey.ts), `calendarKey` its mint. */
export const nextResultLinks = (feedKey: string, calendarKey: string): { rss: string; ics: string } => ({ rss: feedHref({ coin: feedKey }, "rss"), ics: calendarIcsHref(calendarKey) });
