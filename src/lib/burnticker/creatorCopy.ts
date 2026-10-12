/**
 * WHY CREATE A COIN, AND WHAT A CREATOR DOES (website-14, ChatGPT product idea 5 and platform item 8, copy only). The paragraph sits
 * beside the "creators receive no trading-fee revenue" line on About and the launch page; the three onboarding sentences open the
 * templates page and the launch page's first screen. No income is implied anywhere: a creator gets a coin with a rule, its receipts and
 * a scoreboard line, and the coin's fees go to its own burn pool. Lint-clean, plain sentences (test/burntickerWebsite14.test.ts).
 */
export const NO_FEE_REVENUE_LINE = "Creators receive no trading-fee revenue. The creator's share of the fees goes to the coin's own burn pool.";

export const WHY_CREATE = "People create a coin to give a community something to follow together: a team's season, a rivalry, or a public event such as an election or a weather record. The rule is public and locked, so everyone can read what the coin does when the result comes in, and anyone can check every burn.";

/** The three onboarding sentences; `costSol` is the launch review's own estimate for one coin (launchReview.ts launchLabCostSol). */
export function onboardingSentences(costSol: string): string[] {
  return [
    "A creator picks a public result, names the coin and makes two choices: how much of the burn pool each result spends, and how much SOL the curve raises before graduation. The review shows every detail before the wallet asks for a signature.",
    `Launching one coin costs about ${costSol} SOL, mostly rent for its new accounts and a small reserve that stays in its burn pool, plus network fees. The review shows the estimate again for your exact coin.`,
    "What the creator gets is a coin with a locked rule, a public receipt for every burn, and a line on the scoreboards.",
  ];
}
