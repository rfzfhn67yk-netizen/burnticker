/**
 * WHY CREATE A COIN, AND WHAT A CREATOR DOES (website-14, ChatGPT product idea 5 and platform item 8, copy only). The paragraph sits
 * beside the "creators receive no trading-fee revenue" line on About and the launch page; the three onboarding sentences open the
 * templates page and the launch page's first screen. No income is implied anywhere: a creator gets a coin with a rule, its receipts and
 * a scoreboard line, and the coin's fees go to its own burn pool. Lint-clean, plain sentences (test/burntickerWebsite14.test.ts).
 */
export const NO_FEE_REVENUE_LINE = "Creators receive no fee revenue of any kind. Every fee set aside for the creator, on the curve and in the Raydium pool, goes to the coin's own burn pool.";

export const WHY_CREATE = "People create a coin to give a community something to follow together: a team's season, a rivalry, or a public event such as an election or a weather record. The rule is public and locked, so everyone can read what the coin does when the result comes in, and anyone can check every burn.";

/** The three onboarding sentences; `costSol` is the launch review's own estimate for one coin (launchReview.ts launchLabCostSol). */
export function onboardingSentences(costSol: string): string[] {
  return [
    "A creator picks a public result, names the coin and makes two choices: how much of the burn pool each result spends, and how much SOL the curve raises before graduation. The review shows every detail before the wallet asks for a signature.",
    `Launching one coin costs about ${costSol} SOL, mostly rent for its new accounts and a small reserve that stays in its burn pool, plus network fees. The review shows the estimate again for your exact coin.`,
    "What the creator gets is a coin with a locked rule, a public receipt for every burn, and a line on the scoreboards.",
  ];
}

/**
 * THE REVIEW CARD'S IMAGE AND ADVANCED CHOICES (website-18, the owner's walkthrough of 2026-10-12: "I also don't see the ability to change
 * the thumbnail pic"; "it feels overcomplicated to set up"). The image control stays on the card for one coin and for each side of a pair;
 * when this site does not take custom images, the card says so in one sentence beside the generated art.
 */
export const CUSTOM_IMAGES_OFF_LINE = "Custom images are off on this site, so the coin uses its generated receipt art.";
/** The one disclosure that holds every other choice on the Team path, closed by default. */
export const ADVANCED_LABEL = "Advanced";
export const ADVANCED_NOTE = "Every choice below already has a default. You can launch without opening this.";
/** The defaults the Team path sets, one plain sentence each, shown inside Advanced. */
export function teamAdvancedDefaults(o: { sharePct: string; raiseSol: string; minForwardSol: string }): string[] {
  return [
    `Each win spends ${o.sharePct} of the burn pool.`,
    "The coin burns when the team wins. The other choice burns it when the team does not win.",
    `Fees that arrive after the end move on once they reach ${o.minForwardSol} SOL, at most once a week.`,
    `The curve raises ${o.raiseSol} SOL before graduation.`,
    "The image is the generated receipt art unless you add your own above. There is no extra description and there are no links.",
  ];
}
