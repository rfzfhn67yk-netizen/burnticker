/**
 * THE LAUNCH PAGE'S SAVED DRAFT, KEPT WHOLE (launch night 2026-10-13, the owner's $PHINFLWIN launch). The page keeps its choices in this
 * tab's sessionStorage (`burnticker.launch.v2`), written on every change once anything is chosen. After a failed launch step the owner
 * reloaded, touched step 1, and that one choice overwrote the whole draft: the page then offered "You have a draft: unnamed", and "Start a
 * new launch from the review" opened an empty step 1.
 *
 *   kept      a second slot (KEPT_STORE) that holds the last draft which reached the review with a name and a ticker. Only a draft that
 *             also reached the review replaces it, so starting something else never erases it. Discard (Start over) and a launch that
 *             went live clear it.
 *   offer     on load, the draft offered is the one in progress when it has a name, else the kept one, else the one in progress
 *   resume    `?resume=review` (the recovery notice's and the signing card's "Start a new launch from the review") opens the offered
 *             draft straight on its review, with its rule, name and ticker; nothing is signed or sent by opening it
 *
 * Pure and client-safe; the storage reads and writes stay in the page, each in try/catch.
 */
export const DRAFT_STORE = "burnticker.launch.v2";
export const KEPT_STORE = "burnticker.launch.kept.v1";
export const RESUME_PARAM = "resume";
export const RESUME_REVIEW = "review";
/** Where "Start a new launch from the review" goes: this page, which opens the kept draft on its review. */
export const resumeReviewHref = (pathname: string): string => `${pathname}?${RESUME_PARAM}=${RESUME_REVIEW}`;

type Draft = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Anything chosen at all (the page stores nothing before the first choice). */
export function isMeaningfulDraft(s: Draft | null | undefined): s is Draft {
  if (!s || typeof s !== "object") return false;
  return s.step !== "choose" || (s.guide as { phase?: string } | undefined)?.phase !== "follow";
}
/** A draft that reached the review (or the signing step) with a name or a ticker: the one worth keeping. */
export function isReviewedDraft(s: Draft | null | undefined): s is Draft {
  if (!isMeaningfulDraft(s)) return false;
  const at = s.step === "review" || s.step === "launch" || (s.guide as { phase?: string } | undefined)?.phase === "review";
  return at && (!!str(s.name) || !!str(s.ticker));
}

/** The draft the page offers on load: the one in progress when it is named, else the kept one, else the one in progress, else none. */
export function pickOffer(current: Draft | null, kept: Draft | null): Draft | null {
  if (isMeaningfulDraft(current) && (str(current.name) || str(current.ticker))) return current;
  if (isReviewedDraft(kept)) return kept;
  return isMeaningfulDraft(current) ? current : null;
}

const FOLLOW_WORDS: Record<string, string> = { team: "a team coin", rivalry: "a rivalry pair", market: "an event outcome coin", number: "a published data coin", coins: "a coin comparison pair", disaster: "a natural disaster coin" };
/** "Eagles 2026 Wins ($PHINFLWIN)"; a draft without a name says what it follows ("a team coin, not named yet"). */
export function draftLabel(s: Draft): string {
  const name = str(s.name), ticker = str(s.ticker).toUpperCase();
  if (name && ticker) return `${name} ($${ticker})`;
  if (name || ticker) return name || `$${ticker}`;
  const follow = (s.guide as { follow?: string | null } | undefined)?.follow ?? "";
  return `${FOLLOW_WORDS[follow] ?? "a coin"}, not named yet`;
}
/** The one line on step 1. */
export const savedDraftLine = (s: Draft): string => `You have a draft: ${draftLabel(s)}.`;

/** What the kept slot should hold after a write of `snapshot`: the snapshot when it reached the review, else what it held. */
export function nextKept(snapshot: Draft, kept: Draft | null): Draft | null {
  return isReviewedDraft(snapshot) ? snapshot : kept;
}
