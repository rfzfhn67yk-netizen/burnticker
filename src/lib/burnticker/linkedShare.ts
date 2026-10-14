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
