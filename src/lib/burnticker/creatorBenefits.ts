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
  labels: { receipts: "Receipts", lastBurn: "Last burn", next: "Next result", rank: "Rank" },
  noBurn: "No burn yet",
  noNext: "None scheduled",
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
