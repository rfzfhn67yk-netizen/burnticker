/**
 * THE OPERATOR'S POST-GRADUATION SHARE, STATED FROM THE WHOLE (the owner, 2026-10-12, on the trust page: "dev fees are wrong, it's showing
 * I'm getting 20%"). The 20% is the operator's share of the locked pool's LIQUIDITY fees only, which on mainnet tier 14 (new coins since
 * the 2026-10-19 decision) is 12.6 bps of a swap that pays 125 bps in all (4.2 of 100 on tier 9). Every public sentence about that share leads with the per-swap whole and names the 20% only as the liquidity-fee
 * split. Client-safe (cpmmTier.ts and type imports only): the client pages build the line from the FeeSplit their JSON carries or from the
 * tier record, fees.ts from the designed split, so no number in the sentence is typed.
 */
import { CPMM_DEVNET_TIER_0, CPMM_MAINNET_TIER_14, CPMM_MAINNET_TIER_9, CPMM_TIER, CPMM_TIER_14_SINCE, postGraduationBps, type CpmmCluster, type CpmmTier } from "@/lib/burnticker/cpmmTier";
import { utcDateTime } from "@/lib/burnticker/utcWords";
import type { FeeSplit } from "@/lib/burnticker/fees";

/**
 * The program's compiled LP-fee split, burn pool share of 10,000 (burn_receipts LOCK_FEE_BURN_BPS). Mirrored here so client pages need not
 * import the program constants (which pull @solana/web3.js); test/burntickerFeeShareLine.test.ts pins it to src/lib/burnReceipts/constants.ts.
 */
export const LOCK_FEE_BURN_BPS_MIRROR = 8_000;

export interface PostGraduationShares { burnPool: number; operator: number; raydium: number; operatorPctOfLp: number }

/** "about 0.88%" for 88.05 bps; "0.04%" when two decimals of a percent are exact. */
export function aboutPct(bps: number): string {
  const rounded = Math.round(bps) / 100;
  return `${Math.abs(rounded * 100 - bps) > 1e-9 ? "about " : ""}${rounded}%`;
}

const pctOf = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
/** Any post-graduation split: the designed FeeSplit or the looser copy the page JSON types carry. */
type SplitLike = { legs: readonly { label: string; bps: number }[] };
const legBps = (s: SplitLike, label: FeeSplit["legs"][number]["label"]): number => s.legs.find((l) => l.label === label)?.bps ?? 0;

/** The per-swap shares after graduation, in bps of volume, read from a post-graduation FeeSplit (what the token and trust JSON carry). */
export function sharesFromSplit(s: SplitLike): PostGraduationShares {
  const operator = legBps(s, "Burnticker (operator, LP fees)"), lpToBurnPool = legBps(s, "burn pool (LP fees)");
  return { burnPool: lpToBurnPool + legBps(s, "burn pool"), operator, raydium: legBps(s, "Raydium protocol"), operatorPctOfLp: pctOf(operator, operator + lpToBurnPool) };
}

/**
 * The same shares from a cluster's tier record (cpmmTier.ts) and the compiled split. `pair: true` is a pair coin's pool: opened by the
 * public initialize, so Raydium's creator fee is off and the burn pool gets only its share of the liquidity fees.
 */
export function sharesForCluster(cluster: CpmmCluster = "mainnet", opts: { pair?: boolean } = {}): PostGraduationShares {
  const tier = opts.pair ? { ...CPMM_TIER[cluster], creatorFeeRate: 0 } : CPMM_TIER[cluster];
  const b = postGraduationBps(tier, LOCK_FEE_BURN_BPS_MIRROR);
  return { burnPool: b.burnPoolTotal, operator: b.lpToOperator, raydium: b.raydiumTotal, operatorPctOfLp: pctOf(b.lpToOperator, b.lpFees) };
}

/**
 * The one sentence: "After graduation, about 0.88% of every swap goes to the coin's burn pool and about 0.04% to the operator — 20% of the
 * locked pool's liquidity fees. Raydium keeps about 0.08%." (mainnet tier 9; tier 14 reads 0.98% / 0.13% / 0.15%). Takes a post-graduation FeeSplit or the shares.
 */
export function postGraduationShareLine(s: SplitLike | PostGraduationShares): string {
  const v = "legs" in s ? sharesFromSplit(s) : s;
  return `After graduation, ${aboutPct(v.burnPool)} of every swap goes to the coin's burn pool and ${aboutPct(v.operator)} to the operator — ${v.operatorPctOfLp}% of the locked pool's liquidity fees. Raydium keeps ${aboutPct(v.raydium)}.`;
}

/** The operator's share alone, for a sentence that already names the burn pool: "about 0.04% of every swap (20% of the locked pool's liquidity fees)". */
export function operatorShareClause(v: PostGraduationShares = sharesForCluster("mainnet")): string {
  return `${aboutPct(v.operator)} of every swap (${v.operatorPctOfLp}% of the locked pool's liquidity fees)`;
}

/** The shares for one tier record (a coin's own pin, or a named tier in the site-wide copy). */
export function sharesForTier(tier: CpmmTier): PostGraduationShares {
  const b = postGraduationBps(tier, LOCK_FEE_BURN_BPS_MIRROR);
  return { burnPool: b.burnPoolTotal, operator: b.lpToOperator, raydium: b.raydiumTotal, operatorPctOfLp: pctOf(b.lpToOperator, b.lpFees) };
}
const tradersPayPct = (t: CpmmTier): string => `${(t.tradeFeeRate + t.creatorFeeRate) / 10_000}%`;
/** "19 October 2026, 20:17 UTC": the tier-14 cutover in words (utcWords.ts), the one way public prose names it. */
export const TIER_14_CUTOVER_WORDS = utcDateTime(CPMM_TIER_14_SINCE);
/** The trust page's line on who decides the tier (eighth pass B-23): the platform setting the LaunchLab admin wallet holds. */
export const FEE_TIER_DECIDER_LINE = "The tier a coin graduates into is decided at graduation by the LaunchLab platform setting, which the platform admin wallet controls.";
/**
 * Ninth pass B-27 / HB-209 / HS-96: what the burn program deployed today does with a graduated coin's pool. Its register_fee_key accepts
 * only the tier pinned when the coin was made (tier 9), so it cannot register the tier-14 pools LaunchLab now makes. The trust page says
 * so while the deployed mainnet program is a pre-B17 build (programHash.ts PRE_B17_PROGRAM_HASHES), and drops it once the record in
 * config/burnticker/verified-build.json names the upgraded hash.
 */
export const DEPLOYED_TIER_PIN_LINE = "The burn program running today accepts only the tier a coin recorded when it was made, so it would not yet register these coins' tier-14 pools. A program upgrade that accepts the tier LaunchLab actually uses is prepared and not yet deployed; until it is, a coin that graduates collects its fees but does not burn.";
/** "19 October 2026": the cutover's day, for the HS-71 sentence. */
export const TIER_14_DATE_WORDS = TIER_14_CUTOVER_WORDS.replace(/,.*$/, "");

/**
 * BOTH TIERS IN ONE LINE (continuous audit run 2, HB-13): a site-wide sentence that states the new-coin shares (tier 14) adds this line,
 * which names the cutover and gives the tier-9 split the coins created before it still pay. A coin's own page states its own split
 * (tokenPage.ts, from its pin), never this.
 */
export const EARLIER_COINS_LINE = (() => {
  // eighth pass B-23 / HB-184 (owner B-17 decision): every coin graduates into the platform's current tier, so the line no longer splits
  // coins by creation date; it says the one tier and that the earlier coins' recorded tier does not change what they pay
  const t = CPMM_TIER.mainnet;
  return `Every coin graduates into a pool on the platform's current fee tier, tier ${t.index} (${tradersPayPct(t)} per swap). Coins made before ${TIER_14_DATE_WORDS} recorded tier ${CPMM_MAINNET_TIER_9.index} when they were created and pay ${tradersPayPct(t)} all the same.`;
})();

/**
 * Continuous audit run 4, HB-50: the tier line for the network the page is on. Mainnet names both mainnet tiers (EARLIER_COINS_LINE); a
 * devnet host names its own one tier, never the mainnet ones.
 */
export function earlierCoinsLineFor(cluster: string | null | undefined): string {
  if (cluster !== "devnet") return EARLIER_COINS_LINE;
  return `Coins on this test network use fee tier ${CPMM_DEVNET_TIER_0.index} (${tradersPayPct(CPMM_DEVNET_TIER_0)} per swap).`;
}

/** The operator's share on the earlier tier, for a sentence that already gives the new-coin share (the fee ledger, the operator note). */
export const EARLIER_OPERATOR_CLAUSE = `the same on coins made before ${TIER_14_DATE_WORDS}, which graduate into the same tier ${CPMM_TIER.mainnet.index} pools`;

/** The mainnet line for new coins, client-safe (what the shared copy modules print). */
export const OPERATOR_SHARE_LINE = postGraduationShareLine(sharesForCluster("mainnet"));
/** The mainnet line for a pair coin (creator fee off). */
export const PAIR_OPERATOR_SHARE_LINE = postGraduationShareLine(sharesForCluster("mainnet", { pair: true }));

/**
 * BOTH TIERS, THE LIVE ONE FIRST (sixth pass B-16c, HB-57, 2026-10-19): the trust page's body opened with the tier-14 split (0.98 / 0.13 /
 * 0.15) as current fact while every live coin pays tier 9 (0.88 / 0.04 / 0.08). A site-wide sentence about the post-graduation split
 * names the cutover and both tiers, coins created before it first. No number is typed; the tier records give them.
 */
export const BOTH_TIERS_LINE = (() => {
  // eighth pass B-23 / HB-184 (HS-71 words): one split for every coin, the platform's current tier, from the tier record
  const t = CPMM_TIER.mainnet, v = sharesForTier(t), bare = (bps: number) => aboutPct(bps).replace(/^about /, "");
  return `After graduation, every coin pays ${tradersPayPct(t)} per swap (Raydium fee tier ${t.index}): ${aboutPct(v.burnPool)} to the burn pool, ${bare(v.operator)} to the operator and ${bare(v.raydium)} to Raydium. LaunchLab moves a graduating coin into a pool on the platform's current fee tier, which is ${t.index}; coins made before ${TIER_14_DATE_WORDS} recorded tier ${CPMM_MAINNET_TIER_9.index} when they were created and pay ${tradersPayPct(t)} all the same.`;
})();

/**
 * THE FOOTER AND TRUST FEE LINE (hourly run 5, HS-26, launch-critical): the split every live coin pays first, Raydium's share included,
 * then the new-coin tier, then where pair pools are explained. "(every coin live today)" is computed: it is said only when the caller read
 * the registry and found no live mainnet coin created on or after the tier-14 cutover (tier14CoinExists), and it is left out once one
 * exists or when the registry was not read (`tier14Live` null, as on the static pages). No number is typed; the tier records give them.
 */
export function tier14CoinExists(tokens: readonly { cluster: string; status: string; createdAt: number }[], since: string = CPMM_TIER_14_SINCE): boolean {
  const t0 = Date.parse(since);
  return tokens.some((t) => t.cluster === "mainnet" && t.status !== "draft" && t.status !== "expired" && t.createdAt >= t0);
}
export function feeTiersLine(_o: { tier14Live: boolean | null }): string {
  // eighth pass B-23: "(every coin live today) pay 1% (fee tier 9)" was false under the B-17 decision; every coin pays the current tier
  return `${BOTH_TIERS_LINE} Coin-vs-coin pair pools use their own split, shown on the pair page.`;
}
/** The footer's fee row: the curve fee, then feeTiersLine. `curveBps` is fees.ts BURNTICKER_DEV_FEE_BPS (passed in: this module stays client-safe). */
export const footerFeeLine = (curveBps: number, o: { tier14Live: boolean | null }): string => `Burnticker takes ${curveBps / 100}% of curve volume. ${feeTiersLine(o)}`;
