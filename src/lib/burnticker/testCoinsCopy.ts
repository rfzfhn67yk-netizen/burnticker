/**
 * THE WORDS OF THE TEST-COINS PAGE (owner, 2026-10-14: "hide the test coins"). /burnticker/test-coins lists the coins the operator marked
 * test (testCoins.ts), which every browse surface leaves out. Linked only from the Trust page. Client-safe, plain English; each string
 * passes the copy lint (test/burntickerTradeLinks.test.ts).
 */
export const TEST_COINS_HREF = "/burnticker/test-coins";
export const TEST_COINS_COPY = {
  title: "Test coins",
  heading: "Test coins",
  description: "Coins the operator made to test the platform. They are listed here so you can see they exist, not so you trade them.",
  intro: "The operator made these coins to test the platform on mainnet. They are left off the coin list, the home page, search, the leaderboard and the sitemap. They are listed here so you can see they exist, not so you trade them. Each one keeps its own page.",
  linkLabel: "Test coins",
  linkText: "The coins the operator made to test the platform, which the coin list leaves out.",
  mint: "Mint address",
  page: "Coin page",
  explorer: "Mint on Solscan",
  none: "No test coin is listed on this site.",
  unavailable: "The test coin list could not be read on this site just now.",
  operatorSource: "Made by the operator.",
  registrySource: "Launched through this site and marked as a test by the operator.",
};
