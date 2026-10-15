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

/**
 * Owner, 2026-10-14 evening ("the wait for the vanity address is a killer"): plain addresses are the default and the burn ending is
 * opt-in, a switch on the review step remembered in this browser under this key ("1" on, anything else off).
 */
export const MINT_BURN_CHOICE_KEY = "burnticker:mint-ends-in-burn";
