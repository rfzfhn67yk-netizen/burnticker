/**
 * HOW A BURN RUNS, IN WORDS (owner, 2026-10-20; rewritten for the owner decision of 2026-10-25, which removed both burn caps). The facts
 * are the program and dispersal.ts: a reading's burn runs in the keeper cycle that sees it and spends the rule's full share of the burn
 * pool in one run. There is no burn-pool cap and no per-run bound any more (the 2% per-run bound, the six-hour windows of small pieces
 * and the 25 SOL pool cap are gone). The program carries spend only when the target is under the floor fixed at launch or the trading
 * pool has stopped trading; the keeper then spends the whole carried amount in one crank_carried piece once the pool can trade.
 *
 * The export names are the old ones (SPREAD_*) so the pages that import them keep working. Plain English, lint-clean; nothing here says
 * anything about a price. Client-safe.
 */

/** The one sentence for how a burn runs (the launch review, the trust page, the settlement page). */
export const BURN_RUNS_SENTENCE = "When a reading settles, the burn runs right away and spends the rule's full share of the burn pool in one run.";
/** The one sentence for the cap that no longer exists. */
export const NO_BURN_CAP_SENTENCE = "There is no platform cap on a burn. The burn pool spends what the rule says.";
/** The platform authority's former cap power (the trust page, the powers rows). */
export const PLATFORM_AUTHORITY_NO_CAP_SENTENCE = "The platform authority no longer holds a cap-raise power. The program refuses every cap raise.";
/** The transparency page's paragraph on the burn size (config/burnticker/transparency.json carries the same words). */
export const NO_CAP_TRANSPARENCY_SENTENCE = "There is no burn-pool cap and no limit on how much one burn spends. Each burn spends the rule's full share of the burn pool in one run.";
/** When a burn waits, and how what waits is spent. */
export const BURN_WAITS_SENTENCE = "A burn waits only when its share is under the spend floor fixed at launch, or when the trading pool has stopped trading. What waits is spent in one piece by the next run that can trade.";

/** The explanation, three short paragraphs (the settlement page, the whitepaper, the trust page). */
export const SPREAD_LINES: readonly string[] = [BURN_RUNS_SENTENCE, NO_BURN_CAP_SENTENCE, BURN_WAITS_SENTENCE];
/** The one scheduling sentence for a one-time burn (the guided amount step, the review's "How much" row, the one-shot review sentences). */
export const SPREAD_ONE_SHOT_LINE = `The burn spends its whole share in one run. ${NO_BURN_CAP_SENTENCE}`;
/** $DEFICIT's own wording. */
export const SPREAD_DEFICIT_LINE = "$DEFICIT's burns run the same way. Its keeper runs one burn for each reading, and each run spends its whole share at once, with no cap on the size of a burn.";
/** The $DEFICIT site's own line (site/deficit/index.html data-spread). */
export const SPREAD_DEFICIT_STANDALONE = "$DEFICIT's keeper runs one burn for each reading. Each run spends its whole share at once, with no cap on the size of a burn.";
/** The launch review's one note on how a burn runs. */
export const SPREAD_REVIEW_LINE = BURN_RUNS_SENTENCE;
