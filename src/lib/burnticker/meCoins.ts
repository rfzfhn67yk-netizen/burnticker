/**
 * "YOUR COINS" CARDS, CREATED VERSUS DRAFT (launch night 2026-10-13). The owner's first website launch ($PHINFLWIN) failed once before it
 * was sent, so the registry held a draft (prepared, never signed) beside the live coin. "Your coins" listed the draft as a second identical
 * coin, with "wind-down: This coin is live." on it and the checklist's next step. A draft is not a coin: its card says it is not created,
 * shows no wind-down, no settlement facts and no post to copy, and when a coin with the same ticker was created later it says the draft is
 * left over. Created coins come first. Pure and client-safe; the page (src/app/burnticker/me/page.tsx) renders what this decides.
 */
export interface MeCoinLike { ticker: string; mint: string; state: string }

/** A state the creators API reports for a coin that exists on chain (everything but a draft or an expired draft). */
export const isCreatedState = (state: string): boolean => state !== "draft" && state !== "expired";

export const DRAFT_CHIP = "draft, not created";
export const EXPIRED_CHIP = "expired draft";
export const DRAFT_LINE = "This coin is not created yet. Nothing is on chain, and nothing was charged.";
export const DRAFT_NEXT_LINE = "To create it, open the launch page and press Launch on the review again. A draft is kept for 24 hours after it was prepared.";
export const draftSupersededLine = (ticker: string): string => `A later launch created $${ticker}, so this draft is left over. You can ignore it. It expires by itself.`;
export const EXPIRED_LINE = "This draft expired before it was created. Nothing is on chain.";
export const DRAFTS_HEADING = "Drafts that were never created";

/** A created coin's chip in words (the API's "curve" is a state name, not a phrase). */
const STATE_CHIP: Record<string, string> = { curve: "trading on the curve", graduated: "graduated", retired: "retired", voided: "pair voided", paused: "paused", draft: DRAFT_CHIP, expired: EXPIRED_CHIP };
export const stateChip = (state: string): string => STATE_CHIP[state] ?? state;

export interface MeCoinView { created: boolean; chip: string | null; lines: string[]; launchLink: boolean }

/** What one card shows. `all` is every coin in the answer (a draft is left over when a created coin has its ticker). */
export function meCoinView(c: MeCoinLike, all: readonly MeCoinLike[]): MeCoinView {
  if (isCreatedState(c.state)) return { created: true, chip: null, lines: [], launchLink: false };
  if (c.state === "expired") return { created: false, chip: EXPIRED_CHIP, lines: [EXPIRED_LINE], launchLink: false };
  const later = all.some((x) => x.mint !== c.mint && isCreatedState(x.state) && x.ticker.toUpperCase() === c.ticker.toUpperCase());
  return { created: false, chip: DRAFT_CHIP, lines: [DRAFT_LINE, later ? draftSupersededLine(c.ticker) : DRAFT_NEXT_LINE], launchLink: !later };
}

/** Created coins first, in the API's order; then the drafts. */
export function splitMeCoins<T extends MeCoinLike>(coins: readonly T[]): { created: T[]; drafts: T[] } {
  return { created: coins.filter((c) => isCreatedState(c.state)), drafts: coins.filter((c) => !isCreatedState(c.state)) };
}
