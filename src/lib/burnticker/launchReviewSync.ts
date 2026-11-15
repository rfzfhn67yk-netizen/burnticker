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
 * the launch gate finished loading and on other unrelated changes).
 *
 * Audit 7 F02 (2026-10-19): the old check compared against the last revision ASKED, and the slot moved to a revision when its debounce
 * timer was set, not when the request went out. Typing B and going back to A inside the debounce cancelled B's timer, left the slot on
 * B, and A counted as "already asked", so the summary said it was being updated forever and Launch stayed off. Now the slot is the only
 * owner: it moves to a revision only when a request is actually sent (createReviewRequester), and a request is due whenever the slot
 * does not already hold a review, or a request in flight, for the CURRENT revision. A cancelled timer owns nothing; a review already
 * held for the same revision is used as it is. An answered error is due again (the next visit asks again); the retry ladder's pause is
 * guarded by the requester, so unrelated re-renders inside the pause send nothing.
 */
export function reviewRequestDue<T>(slot: ReviewSlot<T>, rev: string): boolean {
  return slot.rev !== rev || (!slot.busy && !slot.review);
}

/**
 * Audit 7 F03: who asks is part of the review. The body carries the creator wallet and, after "Confirm it with your wallet", a signed
 * proof, so both belong in the revision: a wallet connect, disconnect or switch, a new proof and an expired one each make a new revision
 * (a new request; an answer for the old one is dropped by reviewAnswered). A proof signed by another wallet or over other tickers is not
 * sent at all; the page drops a proof when it reaches its age limit (reviewProofExpiresAt).
 */
export interface ReviewProofLike { message: string; signature: string }
type ProofParse = (message: string) => { creator: string; tickers: readonly string[]; issuedAt: string } | null;
export function usableReviewProof<P extends ReviewProofLike>(proof: P | null, creator: string, tickers: readonly string[], parse: ProofParse): P | null {
  if (!proof || !creator) return null;
  const f = parse(proof.message);
  if (!f || f.creator !== creator) return null;
  const norm = (xs: readonly string[]) => xs.map((t) => t.toUpperCase()).filter(Boolean).sort().join(" ");
  return norm(tickers) === norm(f.tickers) ? proof : null;
}
/** When a proof reaches its age limit (ms since epoch), so the page can drop it then and ask again; null when it cannot be read. */
export function reviewProofExpiresAt(proof: ReviewProofLike | null, maxAgeMs: number, parse: ProofParse): number | null {
  const f = proof ? parse(proof.message) : null, at = f ? Date.parse(f.issuedAt) : NaN;
  return Number.isFinite(at) ? at + maxAgeMs : null;
}
/**
 * THE PROOF KEPT ACROSS A RELOAD (synthetic creator b-reload-relaunch). A press of Launch signs a request over the draft's tickers
 * (walletProof.ts), and the prepare writes the draft under that ticker. The page held the proof in memory only, so after a wallet refusal
 * and a reload the kept review asked without one; the review then cannot tell the creator from a stranger (block M) and refused the
 * creator's own unlaunched draft as "already the ticker of another Burnticker coin", with Launch off. The page keeps the latest proof in
 * this tab's sessionStorage and reads it back on load: the review accepts it for any mints and after it was spent, still only for its own
 * wallet and tickers (usableReviewProof) and only inside its age limit (read here, and dropped by the page when it runs out). A draft
 * whose create was recorded as sent is unaffected: the prepare still refuses a second mint with launch-pending.
 */
export const REVIEW_PROOF_STORE = "burnticker.launch.proof.v1";
/** The stored text for a proof (null clears the slot). */
export const keptReviewProofText = (proof: ReviewProofLike | null): string | null => (proof ? JSON.stringify({ message: proof.message, signature: proof.signature }) : null);
/** The proof read back from the slot: a well-formed proof whose text parses and is inside its age limit at `now`, else null. */
export function keptReviewProof(raw: string | null | undefined, maxAgeMs: number, parse: ProofParse, now = Date.now()): ReviewProofLike | null {
  const proof = readKeptProof(raw);
  const at = reviewProofExpiresAt(proof, maxAgeMs, parse);
  return proof && at !== null && at > now ? proof : null;
}
/** LA-4: the kept proof read back when it is well formed but PAST its age limit at `now` (else null), so the page can say why it asks again. */
export function lapsedKeptProof(raw: string | null | undefined, maxAgeMs: number, parse: ProofParse, now = Date.now()): ReviewProofLike | null {
  const proof = readKeptProof(raw);
  const at = reviewProofExpiresAt(proof, maxAgeMs, parse);
  return proof && at !== null && at <= now ? proof : null;
}
function readKeptProof(raw: string | null | undefined): ReviewProofLike | null {
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  const p = v as Partial<ReviewProofLike> | null;
  if (!p || typeof p !== "object" || typeof p.message !== "string" || typeof p.signature !== "string" || p.message.length > 1_000 || p.signature.length > 120) return null;
  return { message: p.message, signature: p.signature };
}

/**
 * LA-4 (owner on devnet, 2026-10-19): a Launch press signed, the prepare wrote the draft under its ticker, a wallet prompt failed, and the
 * tab was reloaded over an hour later. The kept proof had passed its age limit, the review could not tell the creator from a stranger and
 * refused the creator's own draft with Launch off: a deadlock. The review now answers such a ticker as a NOTICE (review.notices, kind
 * "draft-held"; never in `problems`), so Launch stays on; pressing it signs again and the prepare lets only the draft's own wallet through.
 *
 * `draftHeldNotices` is what the page shows: the server's sentence, or, when this tab's own signature over that ticker and wallet ran
 * out (`lapsed`), a sentence that says so.
 */
export interface DraftHeldNotice { side: "A" | "B"; ticker: string; text: string; expired: boolean }
export const draftHeldExpiredSentence = (ticker: string, maxAgeMs: number): string => `Your wallet signature for $${ticker.toUpperCase()} is more than ${Math.round(maxAgeMs / 60_000)} minutes old, so it no longer counts. If the unfinished launch that holds $${ticker.toUpperCase()} is yours, press Launch and sign with the same wallet to continue; otherwise pick another ticker.`;
export function draftHeldNotices(notices: readonly { side: "A" | "B"; kind: string; ticker: string; text: string }[] | null | undefined, o: { lapsed: ReviewProofLike | null; creator: string; maxAgeMs: number; parse: ProofParse }): DraftHeldNotice[] {
  const f = o.lapsed && o.creator ? o.parse(o.lapsed.message) : null;
  return (notices ?? []).filter((n) => n.kind === "draft-held").map((n) => {
    // the lapsed signature was this wallet's, over this ticker: say it ran out; anyone else reads the server's own sentence
    const expired = !!f && f.creator === o.creator && f.tickers.some((t) => t.toUpperCase() === n.ticker.toUpperCase());
    return { side: n.side, ticker: n.ticker, text: expired ? draftHeldExpiredSentence(n.ticker, o.maxAgeMs) : n.text, expired };
  });
}

/**
 * LA-4: whether the review card's Launch button is off, in one pure place (ReviewCard.tsx). Notices (a draft-held ticker) are not
 * blockers and never count here; problems and field problems do.
 */
export function launchButtonOff(p: { ready: boolean; busy: boolean; blocked: boolean; problems: number; fieldProblems: number }): boolean {
  return !p.ready || p.busy || p.blocked || p.problems > 0 || p.fieldProblems > 0;
}

/** The part of the revision that says who asks: the wallet (or none) and the signature of the proof sent with it (or none). */
export function reviewIdentity(creator: string, proof: ReviewProofLike | null): [string, string] {
  return [creator || "", creator && proof ? proof.signature : ""];
}

/**
 * Second audit 2026-10-19 I-12: the two revisions of one draft on the launch page. `draft` is what the coin is (rule, tickers, names,
 * text, profile, raise) and nothing about who asks: it is the prepare's idempotency key and the stale-press check, so a proof reaching its
 * age limit or a wallet change while a Launch press is in flight never makes a completed, paid prepare look stale (the next press would
 * upload and reserve again). `review` is the draft plus the wallet and its proof (reviewIdentity): the review requester's key, so a new
 * wallet or proof asks the review again.
 */
export function launchRevisions(parts: readonly unknown[], identity: readonly [string, string]): { draft: string; review: string } {
  return { draft: draftRevision([...parts]), review: draftRevision([...parts, [...identity]]) };
}

type Timer = unknown;
export interface ReviewRequesterOptions<T, B> {
  send: (body: B) => Promise<T>;
  onSlot: (slot: ReviewSlot<T>) => void;
  debounceMs?: number;
  retryMax?: number;
  /** the pause before retry round n + 1 (default 2, 4, 8 s) */
  backoffMs?: (n: number) => number;
  /** a busy or briefly unreachable server (asked again after a pause, for that revision only) */
  transient?: (e: unknown) => boolean;
  /** the error line for a failure that is not asked again */
  describe?: (e: unknown) => string;
  /** the line shown while a pause before the next round runs */
  retryingLine?: string;
  setTimer?: (f: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
}
export interface ReviewRequester<B> {
  /** Called on every run of the page's effect with the current revision and the body to send for it (null while no request may go
   *  out: another step, the launch gate still loading, no rule). True when this call scheduled a request. */
  want: (rev: string, body: B | null) => boolean;
  /** unmount: cancel the debounce and any retry pause (a request in flight still answers into the slot as usual) */
  cancel: () => void;
}

/**
 * The review effect's whole state machine, framework-free so it is driven with fake timers (test/burntickerReviewRequester.test.ts):
 * debounce; a timer that has not fired is cancelled and owns nothing; send; late and out-of-order answers dropped; the retry ladder for
 * a busy server (that revision only; a new revision starts the count again); a plain failure asked again on the next visit.
 */
export function createReviewRequester<T, B>(o: ReviewRequesterOptions<T, B>): ReviewRequester<B> {
  const debounce = o.debounceMs ?? 600, retryMax = o.retryMax ?? 3, backoff = o.backoffMs ?? ((n: number) => 2000 * 2 ** n);
  const setT = o.setTimer ?? ((f: () => void, ms: number): Timer => setTimeout(f, ms));
  const clearT = o.clearTimer ?? ((t: Timer) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let slot: ReviewSlot<T> = EMPTY_REVIEW_SLOT, seq = 0, cur = "", body: B | null = null, round = 0;
  let pending: { rev: string; t: Timer } | null = null, retry: { rev: string; t: Timer } | null = null;
  const put = (s: ReviewSlot<T>) => { if (s !== slot) { slot = s; o.onSlot(s); } };
  const fire = (rev: string, b: B) => {
    pending = null;
    const n = ++seq, r = round;
    put(reviewRequested(slot, rev, n));
    let p: Promise<T>;
    try { p = Promise.resolve(o.send(b)); } catch (e) { p = Promise.reject(e); }
    p.then((review) => put(reviewAnswered(slot, cur, { rev, seq: n, review })), (e: unknown) => {
      const again = !!o.transient?.(e) && r < retryMax && rev === cur && n === slot.seq;
      put(reviewAnswered(slot, cur, { rev, seq: n, error: again ? o.retryingLine ?? "Asking again in a few seconds." : o.describe?.(e) ?? String((e as Error)?.message ?? e) }));
      if (!again) return;
      if (retry) clearT(retry.t);
      retry = { rev, t: setT(() => { retry = null; if (cur !== rev) return; round = r + 1; sync(); }, backoff(r)) };
    });
  };
  const sync = (): boolean => {
    if (pending && (pending.rev !== cur || body === null)) { clearT(pending.t); pending = null; }   // a cancelled timer owns nothing
    if (body === null || pending) return false;   // nothing may go out, or the timer already set sends the latest body when it fires
    if (retry && retry.rev === cur) return false;  // a pause before the next round is running for this revision
    if (!reviewRequestDue(slot, cur)) return false;
    const rev = cur;
    pending = { rev, t: setT(() => { if (body !== null && cur === rev) fire(rev, body); else pending = null; }, debounce) };
    return true;
  };
  return {
    want(rev, b) {
      if (rev !== cur) { round = 0; if (retry) { clearT(retry.t); retry = null; } }   // a new revision starts the retry count again
      cur = rev; body = b;
      return sync();
    },
    cancel() { if (pending) clearT(pending.t); if (retry) clearT(retry.t); pending = null; retry = null; },
  };
}
