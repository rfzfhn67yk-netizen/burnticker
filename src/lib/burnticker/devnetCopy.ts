import { groupDigits } from "@/lib/burnticker/cardView";

/**
 * THE WORDS OF THE DEVNET PAGE (owner decision, 2026-10-12): /burnticker/devnet lists the devnet practice coins and burns that a mainnet
 * host hides from its public pages (devnetHide.ts). Client-safe, so the Trust page can print its link. Plain English, US spelling, no
 * price talk, no promised dates; this module is in test/burntickerPlainCopy.test.ts COPY_MODULES and passes the copy lint.
 */
export const DEVNET_HREF = "/burnticker/devnet";
export const DEVNET_COPY = {
  title: "Devnet practice runs",
  heading: "Practice runs on devnet, a test network where tokens have no money value.",
  description: "Practice runs on devnet, a test network where tokens have no money value. Each test coin and its burns, with links to check them.",
  intro: "These coins were made to test the burn program before any coin went to mainnet. They are kept here so every practice burn can still be checked.",
  /** the one link on the Trust page and the History page */
  linkLabel: "Devnet practice runs",
  linkText: "The test coins and burns from the practice runs on devnet.",
  mint: "Mint on the explorer",
  page: "Coin page",
  burnsTitle: "Burns",
  noBurns: "No confirmed burn is recorded for this coin in the evidence files.",
  check: "Check the receipt",
  explorer: "See the transaction",
  none: "No devnet practice coin is recorded on this site.",
  unavailable: "The devnet records could not be read on this site just now.",
  burnLine: (amount: string | null): string => (amount === null ? "Burned its purchase." : `Burned ${groupDigits(amount)} tokens.`),
};
