import { utcDay } from "@/lib/burnticker/utcWords";
import { latestResult, oneShotState, type ResultReceipt, type ResultState } from "@/lib/burnticker/nextResult";
/**
 * WHAT A CREATOR GETS, AND THE WORDS OF THE CREATOR PAGES (website-17, 2026-10-12; owner: "featured placement, scoreboard rank, a
 * creator page, the share cards"). None of these pays anyone anything or changes the coin's economics: creators receive no fee revenue,
 * which is a program fact. A rank is a line on a scoreboard. Every sentence here passes the copy lint and the plain-English test
 * (test/burntickerCreatorBenefits.test.ts, test/burntickerPlainCopy.test.ts). Client-safe.
 */

/** The short list shown after the no-fee-revenue line on the templates page and the launch page (item 6). No superlatives. */
export const CREATOR_BENEFITS_TITLE = "What a creator gets besides the coin";
export const CREATOR_BENEFITS: readonly string[] = [
  "A creator page that lists every coin your wallet created, with each rule and its receipts.",
  "A line on the scoreboard for each coin: its rank by receipts, read from the registry.",
  "A place among the first cards on the home page when the coin meets one of three written rules. Nobody can pay for a place.",
  "Share cards for each coin: a link, a badge and a live card for other sites.",
];

/** The creator page (/burnticker/creator/<wallet>). */
export const CREATOR_PAGE = {
  title: (short: string) => `Coins created by ${short}`,
  description: "Every coin this wallet created on Burnticker, with its rule, its receipts, its next result and its line on the scoreboard.",
  intro: "This page lists the coins this wallet created, read from the coin registry. The images, descriptions and links come from each coin's own metadata.",
  empty: "This wallet has not created a coin on this site.",
  unavailable: "The coin registry could not be read just now, so this list is unavailable.",
  badWallet: "That is not a Solana wallet address.",
  creatorText: "From the creator, not part of the rule",
  // HB-25 (hourly run 6): the count is confirmed burns, so its label says so; /v1/tokens labels its recorded-results count apart
  labels: { receipts: "Burn receipts", lastBurn: "Last burn", next: "Next result", check: "Next source check", rank: "Rank" },
  noBurn: "No burn yet",
  noNext: "None scheduled",
  /** audit 7 F08: the coin's line in a partial list, when its own page could not be read */
  coinUnavailable: "This coin's details could not be read just now.",
  /** audit 7 creator aggregation: some coins could not be read; the list shows the rest */
  partial: (n: number) => `${n === 1 ? "One coin" : `${n} coins`} could not be read just now, so ${n === 1 ? "its details are" : "their details are"} missing below.`,
  /** sixth pass HS-19 / B-10: a coin whose page read has not finished yet (it keeps running for the next visit) */
  coinLoading: "Still loading this coin. Refresh in a few seconds.",
  /** sixth pass B-10: some coins are still being read; the list shows each with its rule and receipts meanwhile */
  loading: (n: number) => `${n === 1 ? "One coin is" : `${n} coins are`} still loading. Refresh in a few seconds to see ${n === 1 ? "its" : "their"} latest details.`,
} as const;

/** The coin page's link to its creator's page (WIRING-17.md): "Created by Ab12…cd34". */
export const createdBy = (short: string): string => `Created by ${short}`;
export const creatorHref = (wallet: string): string => `/burnticker/creator/${encodeURIComponent(wallet)}`;

/** The share block on the creator page and the coin page (item 4). The parts are the existing routes; nothing new is made up. */
export const SHARE_COPY = {
  heading: "Share",
  link: "Link to this page",
  markdown: "Badge for a README or a forum post",
  iframe: "Live card for another website",
  preview: "What a link preview shows",
  previewNote: "Posting the link shows this card, built from the coin's receipts. It carries no market data.",
  copy: "Copy",
  copied: "Copied",
} as const;

/** Your coins, connected wallet only (item 5). Counts this site does not keep are said plainly. */
export const ANALYTICS_COPY = {
  heading: "Numbers for your coins",
  views: "Page views",
  viewsNone: "Not counted. This site keeps no page-view counts.",
  follows: "Follows",
  followsNone: "Not countable. Follows are kept in each visitor's own browser and are never sent to this site.",
  receipts: "Receipts",
  next: "Next result",
  rank: "Rank",
  rankUnavailable: "Unavailable. The registry could not be read just now.",
  weekHeading: "This week",
  copySummary: "Copy the summary",
  creatorPage: "Open your creator page",
} as const;

/**
 * The creator page's "Next result" cell (prelaunch audit 2026-10-18, A-26; the review of 2026-10-18; audit 7 F08). A one-shot is decided
 * only when its latest result receipt (the wind-down, drain and sweep receipts at the rule's end aside) settled a result: burned
 * ("Decided and burned"), or waiting to burn before graduation; a voided one-shot says so; a skipped or failed result decides nothing.
 * Otherwise the next RESULT time as a UTC day (utcWords.ts), and a time already past says it is overdue, in words. `nextAt` is the next
 * result (nextResult.ts nextTimes), never the keeper's next poll of the source: a decided game coin never shows a new result date.
 */
export const DECIDED_WAITING = "Decided, waiting for graduation";
export const DECIDED_BURNED = "Decided and burned";
export const DECIDED = "Decided";
export const DECIDED_VOID = "Voided, so the rule has ended";
export function creatorNextLine(c: { oneShot: boolean; receipts: readonly ResultReceipt[]; graduated: boolean; nextAt: string | null; /** the status producer's state when known (the first snow counts only a day that burned) */ result?: ResultState | null }, now: number): string {
  if (c.oneShot) {
    const state = c.result && c.result !== "recurring" ? c.result : oneShotState(c.receipts);
    if (state === "decided") {
      const latest = latestResult(c.receipts);
      return latest?.status === "confirmed" ? DECIDED_BURNED : !c.graduated ? DECIDED_WAITING : DECIDED;
    }
    if (state === "void") return DECIDED_VOID;
  }
  return dayLine(c.nextAt, now);
}

/** A time as a UTC day, "overdue" in words once past; "None scheduled" for none. */
export function dayLine(at: string | null, now: number): string {
  if (!at) return CREATOR_PAGE.noNext;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return CREATOR_PAGE.noNext;
  return t <= now ? `Was due on ${utcDay(t)} and is overdue` : utcDay(t);
}
