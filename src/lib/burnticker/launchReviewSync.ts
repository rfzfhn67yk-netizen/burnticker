/**
 * THE PRE-WALLET SUMMARY BELONGS TO ONE DRAFT (ChatGPT chat audit 6, A6, 2026-10-12: after Back and a new search, the review card showed
 * Detroit Heat while the "Before you connect" summary still described LAKERS26). The launch page and the Coin vs Coin tile key every
 * review request by the draft's revision — a fingerprint of everything the server reads to build the review (the rule, names, tickers,
 * note, description context, warnings, the second coin) — and:
 *
 *   · show a summary only when it was built for the CURRENT revision (an older one is hidden the moment the draft changes, never shown
 *     beside a different card);
 *   · drop a response that arrives after a newer request was sent (out of order) or whose revision is no longer current (late);
 *   · let the launch button prepare transactions only when the summary on screen was built for the current revision.
 *
 * Pure and client-safe; test/burntickerWebsite12.test.ts drives delayed and out-of-order responses, rate, ticker and source edits, and Back.
 */

/** A stable fingerprint of the draft (JSON with sorted keys). Equal drafts give equal revisions. */
export function draftRevision(parts: unknown): string {
  const norm = (v: unknown): unknown => (Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])])) : v);
  return JSON.stringify(norm(parts ?? null));
}

export interface ReviewSlot<T> { rev: string; review: T | null; error: string | null; busy: boolean; seq: number }
export const EMPTY_REVIEW_SLOT: ReviewSlot<never> = { rev: "", review: null, error: null, busy: false, seq: 0 };

/** A request was sent for `rev` with sequence number `seq` (always larger than the last one). */
export function reviewRequested<T>(slot: ReviewSlot<T>, rev: string, seq: number): ReviewSlot<T> {
  return { rev, review: slot.rev === rev ? slot.review : null, error: null, busy: true, seq };
}

/** A response arrived for the request (rev, seq). It is kept only if it answers the newest request for the current revision. */
export function reviewAnswered<T>(slot: ReviewSlot<T>, currentRev: string, ans: { rev: string; seq: number; review?: T | null; error?: string | null }): ReviewSlot<T> {
  if (ans.seq !== slot.seq || ans.rev !== slot.rev || ans.rev !== currentRev) return slot;   // out of order, or the draft moved on
  return { ...slot, review: ans.error ? null : ans.review ?? null, error: ans.error ?? null, busy: false };
}

/** What the summary may show for the draft on screen: the review, or "updating" (never a review built for another draft). */
export function reviewFor<T>(slot: ReviewSlot<T>, currentRev: string): { review: T | null; loading: boolean; error: string | null } {
  if (slot.rev !== currentRev) return { review: null, loading: true, error: null };
  return { review: slot.review, loading: slot.busy && !slot.review, error: slot.error };
}

/** The launch button may prepare transactions only when the summary on screen was built for this exact draft and is not being redone. */
export function reviewMatchesDraft<T>(slot: ReviewSlot<T>, currentRev: string): boolean {
  return slot.rev === currentRev && !!slot.review && !slot.busy;
}

/** The line beside a launch button whose summary is not yet the current draft's. */
export const REVIEW_UPDATING = "The summary is being updated for this draft. The launch button waits until it matches.";

/**
 * Prelaunch audit 2026-10-18 A-22: one review step called POST /v1/launch/review three times for one draft (the effect ran again when
 * the launch gate finished loading and on other unrelated changes). A request is due only for a revision (and retry round) not asked
 * yet; the same draft asked again is answered from the slot it already has. `asked` is the last request actually sent.
 */
export function reviewRequestDue(asked: { rev: string; retry: number } | null, rev: string, retry: number): boolean {
  return !asked || asked.rev !== rev || asked.retry !== retry;
}
