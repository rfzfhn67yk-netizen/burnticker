import type { Latest } from "@/lib/burnticker/latestOnly";

/**
 * LAUNCH INTEGRITY 251 AND 252 (2026-10-12): the Coin vs Coin tile's two slow steps answer for one input only.
 *
 *   251  the rule's fingerprint (sha256 of the tile's hash input) is kept WITH that input; an answer for an older input is dropped, an older
 *        failure never clears a newer fingerprint, and the model pairs the current choice only with its own fingerprint
 *   252  the prepare request is sent for one draft revision; when it answers, a draft that changed meanwhile (names, tickers, references,
 *        percentage, raise, venue, profile, image) makes the answer obsolete: no plan is shown, the wallet never opens, and the creator
 *        reviews the new draft and presses Launch again
 *
 * Client-safe, plain functions.
 */

export interface Fingerprint { input: string; hash: string }
/** The fingerprint for `input`, or null when the one held is for another input (or none is held). */
export const fingerprintFor = (fp: Fingerprint | null, input: string): string | null => (fp && fp.input === input ? fp.hash : null);
/** Computes the fingerprint of `input`; `set` hears the result (or null on failure) only while this is the newest request. */
export async function startFingerprint(latest: Latest, input: string, compute: (input: string) => Promise<string>, set: (fp: Fingerprint | null) => void): Promise<void> {
  const t = latest.next();
  try { const hash = await compute(input); if (latest.isCurrent(t)) set({ input, hash }); } catch { if (latest.isCurrent(t)) set(null); }
}

export const STALE_PREPARE_SENTENCE = "The draft changed while the launch was being prepared, so that preparation was set aside and nothing reached your wallet. Check the review again, then press Launch.";
/** Runs `request` for the draft revision `sentRev`; its answer counts only if the draft is still that revision when it arrives. */
export async function prepareIfCurrent<T>(sentRev: string, currentRev: () => string, request: () => Promise<T>): Promise<{ ok: T } | { stale: true }> {
  const v = await request();
  return currentRev() === sentRev ? { ok: v } : { stale: true };
}

/** The part of a coin's profile that goes into the launch body, as a cheap revision (an image by its name, size and ends, never all its bytes). */
export function profileRevision(p: { description: string; x: string; telegram: string; website: string; badge: boolean; rights: boolean; image: { name: string; base64: string } | null }): unknown {
  const img = p.image ? [p.image.name, p.image.base64.length, p.image.base64.slice(0, 64), p.image.base64.slice(-64)] : null;
  return [p.description, p.x, p.telegram, p.website, p.badge, p.rights, img];
}
