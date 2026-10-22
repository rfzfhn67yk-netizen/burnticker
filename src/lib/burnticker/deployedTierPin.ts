/**
 * IS THE TIER-PIN UPGRADE STILL PENDING (ninth pass B-27 / HB-209 / HS-96), AS ONE DATA FACT. The burn program deployed on mainnet today
 * (round 5) accepts only the tier a coin recorded when it was made, so it cannot register the tier-14 pools LaunchLab now makes. Every
 * public fee sentence that says "pay 1.25% all the same" adds DEPLOYED_TIER_PIN_LINE (feeShareLine.ts) while that is so. The answer is
 * read from config/burnticker/verified-build.json: the burn_receipts record's deployed.mainnet.hash is one of PRE_B17_PROGRAM_HASHES (or
 * missing, the cautious side) → pending. Once the B-17 upgrade lands and the table names the new hash, the sentence disappears from every
 * surface by itself. Client-safe (a JSON import and plain data, no node modules): the footer and the static safeguards copy use the
 * build-time constant; the server paths (trust.ts, currentStatus.ts) call tierPinPendingLive at run time.
 *
 * HS-121 (ninth audit addendum, 2026-10-21): after the B-17 upgrade executed at 17:57 Denver the pages kept saying "not yet deployed"
 * until the record was flipped by hand. The server paths now follow the program's ProgramData hash read live from chain
 * (tierPinPendingLive, the same test the keeper's registerFeeKeyLaunchlabSlot makes) and use the stored record only when that read fails.
 * DEPLOYED_TIER_PIN_PENDING below cannot read the chain: it is fixed when the site is built, so the static footer (SiteFooter.tsx,
 * visibleFeeLines.ts FOOTER_FEE_LINE) and the static safeguards copy (safeguards.ts) follow the stored record and lag a live upgrade
 * until the record is updated and the site is published again.
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

/** The source commit both pre-B17 builds were made from (round 5), for the sentences that name the deployed commit. */
export const PRE_B17_SOURCE_COMMIT = "089024ff6ab0cc92ae37899dee1509d52cb5e203";

/** True while a verified-build table records a pre-B17 burn_receipts build as deployed on mainnet. An unreadable record says true. */
export function tierPinPendingFor(vb: unknown): boolean {
  const programs = (vb as { programs?: unknown } | null)?.programs;
  if (!Array.isArray(programs)) return true;
  const p = programs.find((x) => (x as { library?: unknown })?.library === "burn_receipts") as { deployed?: { mainnet?: { hash?: unknown } | null } } | undefined;
  const h = p?.deployed?.mainnet?.hash;
  return typeof h !== "string" || !h || PRE_B17_PROGRAM_HASHES.has(h);
}

/**
 * HS-121: the answer from the hash read live from mainnet's ProgramData (programHash.ts liveProgramHash). Pending unless the live bytes
 * are the B-17 build the table records for mainnet: a pre-B17 hash, or a hash nobody recorded, keeps the sentence, which is what the
 * keeper's register_fee_key gate does with the same read. No live hash (the read failed or was not made): the stored record decides.
 */
export function tierPinPendingLive(vb: unknown, liveMainnetHash: string | null | undefined): boolean {
  if (!liveMainnetHash) return tierPinPendingFor(vb);
  if (PRE_B17_PROGRAM_HASHES.has(liveMainnetHash)) return true;
  const programs = (vb as { programs?: unknown } | null)?.programs;
  const p = Array.isArray(programs) ? (programs.find((x) => (x as { library?: unknown })?.library === "burn_receipts") as { builds?: { mainnet?: { hash?: unknown } } } | undefined) : undefined;
  return p?.builds?.mainnet?.hash !== liveMainnetHash;
}

/** The answer for the table this build was made from (the stored record; lags a live upgrade until the next publish, see above). */
export const DEPLOYED_TIER_PIN_PENDING: boolean = tierPinPendingFor(VERIFIED_BUILD);
