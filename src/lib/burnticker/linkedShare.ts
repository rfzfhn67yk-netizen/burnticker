/**
 * AUDIT 12 item 1 (2026-10-13): the refusal for a linked pair on a rule that resolves once (one market, the flippening, two candidates, one
 * game) with a share other than 100 %. No imports, so the launch builder (and the SDK closure) can read it without the dials.
 */
export const LINKED_ONE_SHOT_REFUSAL = "Two linked coins on one result use the whole pool: the winning coin burns all of its own pool and takes the other coin's pool. So a linked pair burns 100%, and no other share is offered. Pick 100%.";
/**
 * REVIEW 10 F1 (2026-10-14): the refusal for a single coin that burns once with a share under 100 % on a host without burn dispersal. One
 * burn run spends at most 2 % of the swap pool's SOL, and the burn program this site runs cannot spend the rest of that share without a
 * new result, so it could not finish on the coin before the end moves what is left on (launchPreflight.ts, multiKeeper.owedBeforeEnd).
 */
export const ONE_SHOT_SHARE_REFUSAL = "A coin that burns once uses 100% of its pool on this site. A smaller share could not finish burning on this coin before the rest of the pool moves on at the end, so pick 100%.";
/**
 * LAUNCH WIZARD AUDIT 2026-10-19 F5: on a host WITH burn dispersal a one-shot under 100 % passes, so the sentence above is untrue for a
 * one-shot that burns another token. The real reason there: the pinned token's burn has no carried remainder to spend later, so the share
 * must be spent in that one result, and only the whole pool is.
 */
export const ONE_SHOT_TARGET_SHARE_REFUSAL = "A coin that burns another token once spends its whole pool on that one result, because the burn of the pinned token cannot keep part of the pool for later. Pick 100%.";
