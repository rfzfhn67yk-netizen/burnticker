/**
 * HB-94 (hourly run 7): after the review's Edit sent a draft back to "Which one?", the browser's Back walked the address through
 * ?step=review and ?step=name while the page stayed on step 2. Two rules keep the address on the step that is shown:
 *   - a jump back to an earlier step (an Edit, a crumb) REPLACES the current history entry instead of adding one, so Back does not land
 *     on the later step the draft has left;
 *   - a Back or Forward the page cannot follow (the step is no longer reachable) rewrites the address to the step that is shown.
 */
export type StepName = "follow" | "which" | "burn" | "name" | "review";
export const STEP_RANK: Readonly<Record<StepName, number>> = { follow: 0, which: 1, burn: 2, name: 3, review: 4 };
const rank = (s: string): number => STEP_RANK[s as StepName] ?? 0;

/** How the address follows a new shown step: nothing (already there), a new entry (forward), or a replaced entry (a jump back). */
export function stepHistoryAction(addressStep: string, shown: string): "none" | "push" | "replace" {
  if (addressStep === shown) return "none";
  return rank(shown) < rank(addressStep) ? "replace" : "push";
}

/** The address of a step on the launch page. */
export const stepAddress = (pathname: string, step: string): string => (step === "follow" ? pathname : `${pathname}?step=${step}`);

/**
 * Whether the page follows a Back or Forward to `asked` (the same cases the popstate handler acts on): step 1 always (it may ask first),
 * the Coin comparison tile's own phases, "which" from the review, and any step from the review.
 */
export function popstateFollows(o: { asked: string; follow: string | null; step: string }): boolean {
  if (o.asked === "follow") return true;
  if (!o.follow) return false;
  if (o.follow === "coins" && o.step === "choose") return true;
  return o.step === "review";
}

/**
 * HS-39 (hourly run 7): where the review's Edit on "What triggers the burn" opens. A natural-disaster coin's trigger is built on the burn
 * step (pattern, strength, area), so it opens there with those choices kept; every other coin goes back to "Which one?".
 */
export const triggerEditPhase = (follow: string | null): "which" | "burn" => (follow === "disaster" ? "burn" : "which");
