/**
 * IS THE TIER-PIN UPGRADE STILL PENDING (ninth pass B-27 / HB-209 / HS-96), AS ONE DATA FACT. The burn program deployed on mainnet today
 * (round 5) accepts only the tier a coin recorded when it was made, so it cannot register the tier-14 pools LaunchLab now makes. Every
 * public fee sentence that says "pay 1.25% all the same" adds DEPLOYED_TIER_PIN_LINE (feeShareLine.ts) while that is so. The answer is
 * read from config/burnticker/verified-build.json: the burn_receipts record's deployed.mainnet.hash is one of PRE_B17_PROGRAM_HASHES (or
 * missing, the cautious side) → pending. Once the B-17 upgrade lands and the table names the new hash, the sentence disappears from every
 * surface by itself. Client-safe (a JSON import and plain data, no node modules): the footer and the static safeguards copy use the
 * build-time constant; the server paths (trust.ts, currentStatus.ts) call tierPinPendingFor on the table they read at run time.
 */
import VERIFIED_BUILD from "../../../config/burnticker/verified-build.json" with { type: "json" };

/**
 * The deployed burn_receipts builds whose register_fee_key has NO launchlab_pool account: round 5, source 089024ff, the bytes on mainnet
 * (152929ce…) and on devnet (74659afd…) since 2026-10-15. Sending them the B-17 list fails at account validation (instructions.ts
 * registerFeeKeyIx), so these hashes never get the extra account, whatever the verified-build record says.
 */
export const PRE_B17_PROGRAM_HASHES: ReadonlySet<string> = new Set([
  "152929ce72292d2113655c09a193a15cb49443109e4db202efdbc68232520821",
  "74659afdbb5f63fd0fb79a3366302bd68f7a8e84eea5cf9a6d9cdab97f36785c",
]);

/** True while a verified-build table records a pre-B17 burn_receipts build as deployed on mainnet. An unreadable record says true. */
export function tierPinPendingFor(vb: unknown): boolean {
  const programs = (vb as { programs?: unknown } | null)?.programs;
  if (!Array.isArray(programs)) return true;
  const p = programs.find((x) => (x as { library?: unknown })?.library === "burn_receipts") as { deployed?: { mainnet?: { hash?: unknown } | null } } | undefined;
  const h = p?.deployed?.mainnet?.hash;
  return typeof h !== "string" || !h || PRE_B17_PROGRAM_HASHES.has(h);
}

/** The answer for the table this build was made from. */
export const DEPLOYED_TIER_PIN_PENDING: boolean = tierPinPendingFor(VERIFIED_BUILD);
