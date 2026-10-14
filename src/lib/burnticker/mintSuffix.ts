/**
 * The burn-ending mint address rule (owner, 2026-10-14), dependency-free so the coin page and the trust page can say it without loading
 * the key generator (vanityMint.ts re-exports these).
 */
export const MINT_SUFFIXES = ["burn", "BURN"] as const;
export const MINT_SUFFIX_RE = /(burn|BURN)$/;

/** True when a base58 public key ends in `burn` or `BURN` (mixed case does not count). */
export function matchesSuffix(pubkey: string): boolean {
  return typeof pubkey === "string" && MINT_SUFFIX_RE.test(pubkey);
}

/** The skip button appears after this long (the owner's default is to wait; the skip is the escape hatch). */
export const SKIP_AFTER_MS = 60_000;
