import { latestBurnLine } from "@/lib/burnticker/receiptCard";
import type { DerbyScoreboard } from "@/lib/burnticker/derby/spec";

/**
 * WEBSITE-26 (WIRING-FEATURES, the cheap-features pass): the words and the small pure helpers the pages add for the calendar, the
 * receipt embed, the scoreboard, the leaderboard, the digest and the operator's post queue. Plain English, copy lint clean; tests import
 * this file without the components.
 */
export const SITE_ORIGIN = "https://burnticker.com";

// ---- item 2: the burn calendar ----
export const CALENDAR_HEADING = "Next readings";
export const CALENDAR_ADD = "Add to calendar";

/** A calendar entry's time in the reader's own zone (an all-day entry: its day only). */
export function calendarWhen(e: { at: string | null; day: string; allDay: boolean }, locale?: string): string {
  if (e.allDay || !e.at) return new Date(`${e.day}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return new Date(e.at).toLocaleString(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

// ---- item 7: the embeddable receipt ----
export const EMBED_RECEIPT_LABEL = "Embed this coin's receipt";
export const EMBED_RECEIPT_NOTE = "The image changes when a new burn is recorded. The link never changes.";

/** The image's alt text, as receiptCardServe.ts receiptCardData builds it, from the coin page's own fields. */
export function receiptAlt(o: { ticker: string; sentence: string; latest: { tokens: string; day: string } | null; scoreboard?: string | null }): string {
  return `$${o.ticker}. ${o.sentence} ${o.scoreboard ?? `${latestBurnLine(o.latest)}.`}`;
}
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** The copyable snippet: the receipt card by mint, linking to the coin page by mint. */
export function receiptEmbedSnippet(mint: string, alt: string, origin = SITE_ORIGIN): string {
  const m = encodeURIComponent(mint);
  return `<a href="${origin}/burnticker/t/${m}"><img src="${origin}/burnticker/img/receipt/${m}.png" alt="${attr(alt)}" width="600" height="315"></a>`;
}

// ---- item 12: the Coin vs Coin scoreboard ----
export const SCOREBOARD_HEADING = "Scoreboard";
/** The board's lines: "$A 12 : 9 $B", "Day 21 of 30", the streak when it is longer than a day, the SOL moved. */
export function scoreboardLines(s: DerbyScoreboard): { score: string; run: string; streak: string | null; moved: string } {
  const t = s.tickers;
  const score = `$${t.a} ${s.daysWon.a} : ${s.daysWon.b} $${t.b}`;
  const run = s.run.over ? `The run of ${s.run.of} days is over.` : `Day ${s.run.day} of ${s.run.of}`;
  const streak = s.streak.side && s.streak.days > 1 ? `$${s.streak.side === "A" ? t.a : t.b} has won ${s.streak.days} days in a row.` : null;
  const moved = `SOL moved to $${t.a}: ${s.forwardedSol.toA}. To $${t.b}: ${s.forwardedSol.toB}.`;
  return { score, run, streak, moved };
}

// ---- item 3: the leaderboard ----
export const LEADERBOARD_TITLE = "Leaderboard";
export const LEADERBOARD_INTRO = "Four lists, counted from the receipts this site records.";
export const LEADERBOARD_EMPTY = "No receipts yet.";

// ---- item 8: the daily digest ----
export const DIGEST_TITLE = "Daily digest";
export const DIGEST_INTRO = "One day on this site, in UTC: the results read, the burns, the new coins and the graduations.";
export const DIGEST_SECTIONS = { readings: "Results", burns: "Burns", newCoins: "New coins", graduations: "Graduations" } as const;
export const DIGEST_EMPTY = { readings: "No results were read this day.", burns: "No burns this day.", newCoins: "No new coins this day.", graduations: "No graduations this day." } as const;
/** The day before or after a YYYY-MM-DD day. */
export const shiftDay = (day: string, by: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

// ---- item 9: the operator's post queue ----
export const POST_QUEUE_TITLE = "Post queue";
export const POST_QUEUE_INTRO = "Posts the generators queued for the owner. Nothing here posts by itself: copy a post, post it yourself, then mark it used.";
export const POST_QUEUE_PIN = "Operator PIN";
export const POST_QUEUE_MARK = "Mark used";
