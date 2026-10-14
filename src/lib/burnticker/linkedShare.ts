/**
 * AUDIT 12 item 1 (2026-10-13): the refusal for a linked pair on a rule that resolves once (one market, the flippening, two candidates, one
 * game) with a share other than 100 %. No imports, so the launch builder (and the SDK closure) can read it without the dials.
 */
export const LINKED_ONE_SHOT_REFUSAL = "Two linked coins on one result use the whole pool: the winning coin burns all of its own pool and takes the other coin's pool. So a linked pair burns 100%, and no other share is offered. Pick 100%, or launch a single coin to burn 50%.";
