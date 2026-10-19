/**
 * THE RAYDIUM CPMM FEE TIER EACH COIN GRADUATES INTO — the one place the AmmConfig ids and their rates live (client-safe: no imports, so
 * the browser's lookup table, the launch builders, the fee pages and the scripts all read the same record).
 *
 * Owner decision 2026-10-12: on mainnet the LaunchLab platform's cpConfigId moves from AmmConfig index 0 (trade fee 25 bps, creator fee
 * 5 bps) to index 9 (trade fee 25 bps, creator fee 75 bps); both read from mainnet that day. The platform's cpConfigId is changed by the
 * vault (a separate on-chain step), and burn_receipts pins the platform's cpConfigId into each coin at initialize_token, so a coin
 * initialised earlier keeps the tier it pinned. Devnet's CPMM program has no creator-fee tier like index 9, so devnet keeps the
 * rehearsal's index 0 (`5MxL…`, trade 25 bps, creator 25 bps, no protocol share of the creator fee: docs/burnkeeper/devnet-run-log-2026-10-10.md)
 * and the devnet rehearsal cannot exercise mainnet's creator-fee tier. Localnet mirrors mainnet.
 *
 * Owner decision 2026-10-19: coins initialised after the platform's next cpConfigId change graduate into mainnet AmmConfig index 14
 * (trade fee 75 bps, creator fee 50 bps; read from mainnet that day). Per swap: burn pool 97.90 bps, operator 12.6 bps (its 20% of the
 * locked LP's share), Raydium 14.50 bps; traders pay 125 bps. Coins created before keep the tier they pinned (tier 9 for most, tier 0
 * for the earliest), so a COIN'S numbers come from its own pin (`tierForPin`, TokenConfig.ll_cp_config) and only "the tier new coins get"
 * comes from CPMM_TIER. The trust table accepts the platform on CPMM_PLATFORM_TIERS (the target first, then tier 9 while the owner's
 * UpdatePlatformConfig is pending) and says which tier the LIVE platform gives new coins.
 *
 * Units are Raydium's own: tradeFeeRate and creatorFeeRate in parts per million of volume; protocolFeeRate, fundFeeRate and
 * creatorFeeShareRate in parts per million OF that fee. The derivation below works in ppm of volume (integers), so 16.8 or 71.25 bps
 * never carries floating-point noise. The ids are the AmmConfig PDAs ["amm_config", u16 index] of each cluster's CPMM program
 * (test/burnKeeperLaunch.test.ts re-derives them).
 */

export type CpmmCluster = "mainnet" | "devnet" | "localnet";

export interface CpmmTier {
  cluster: "mainnet" | "devnet";
  index: number;
  id: string;
  tradeFeeRate: number;
  protocolFeeRate: number;
  fundFeeRate: number;
  creatorFeeRate: number;
  creatorFeeShareRate: number;
}

/** Mainnet AmmConfig index 0: the tier every coin pinned before the 2026-10-12 decision. */
export const CPMM_MAINNET_TIER_0: CpmmTier = { cluster: "mainnet", index: 0, id: "D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2", tradeFeeRate: 2_500, protocolFeeRate: 120_000, fundFeeRate: 40_000, creatorFeeRate: 500, creatorFeeShareRate: 50_000 };
/** Mainnet AmmConfig index 9: the tier the platform pointed at under the 2026-10-12 decision; most live coins pinned it. */
export const CPMM_MAINNET_TIER_9: CpmmTier = { cluster: "mainnet", index: 9, id: "LNmHRmMvk9kmtepfTSr98kqGLThd61kH1DPWf2cVRaC", tradeFeeRate: 2_500, protocolFeeRate: 120_000, fundFeeRate: 40_000, creatorFeeRate: 7_500, creatorFeeShareRate: 50_000 };
/** Mainnet AmmConfig index 14: the tier new coins graduate into under the 2026-10-19 decision (read from mainnet 2026-10-19). */
export const CPMM_MAINNET_TIER_14: CpmmTier = { cluster: "mainnet", index: 14, id: "52MZUkNsRYzP4gn2mCaLTVtJQy2tpoF79hp5K1HhAxxX", tradeFeeRate: 7_500, protocolFeeRate: 120_000, fundFeeRate: 40_000, creatorFeeRate: 5_000, creatorFeeShareRate: 50_000 };
/**
 * When the mainnet platform's cpConfigId moved to tier 14 (continuous audit run 2, HB-13: 2026-10-19 20:17 UTC). Coins initialised before it
 * pinned tier 9 (tier 0 for the earliest); coins initialised after it pin tier 14. Public prose prints it through utcWords.ts, never bare.
 */
export const CPMM_TIER_14_SINCE = "2026-10-19T20:17:00Z";
/** Devnet AmmConfig index 0 (the rehearsal platform's pin; devnet has no creator-fee tier like mainnet's index 9). */
export const CPMM_DEVNET_TIER_0: CpmmTier = { cluster: "devnet", index: 0, id: "5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy", tradeFeeRate: 2_500, protocolFeeRate: 120_000, fundFeeRate: 40_000, creatorFeeRate: 2_500, creatorFeeShareRate: 0 };

/**
 * THE ONE SWITCH: the tier new coins get, per cluster (the platform-config CLI, the pair-curve launch, the lookup table and every
 * "new coins" sentence read this). A coin already initialised is described by its own pin (`tierForPin`), never by this.
 */
export const CPMM_TIER: Record<CpmmCluster, CpmmTier> = { mainnet: CPMM_MAINNET_TIER_14, devnet: CPMM_DEVNET_TIER_0, localnet: CPMM_MAINNET_TIER_14 };
/**
 * The platform cpConfigIds the trust table accepts, per cluster: CPMM_TIER first, then the tier the platform may still name while the
 * owner's UpdatePlatformConfig (scripts/launchlab-platform-cp-config.mts) is pending. Drop the second entry once the platform names the
 * target, so a later drift back is flagged.
 */
export const CPMM_PLATFORM_TIERS: Record<CpmmCluster, readonly CpmmTier[]> = { mainnet: [CPMM_MAINNET_TIER_14, CPMM_MAINNET_TIER_9], devnet: [CPMM_DEVNET_TIER_0], localnet: [CPMM_MAINNET_TIER_14] };
/** The AmmConfig id per cluster (strings, for the client-side lookup table and the launch builders). */
export const CPMM_CONFIG_ID: Record<CpmmCluster, string> = { mainnet: CPMM_TIER.mainnet.id, devnet: CPMM_TIER.devnet.id, localnet: CPMM_TIER.localnet.id };

export const KNOWN_TIERS: readonly CpmmTier[] = [CPMM_MAINNET_TIER_0, CPMM_MAINNET_TIER_9, CPMM_MAINNET_TIER_14, CPMM_DEVNET_TIER_0];
export const cpmmTierOf = (id: string): CpmmTier | null => KNOWN_TIERS.find((t) => t.id === id) ?? null;
/**
 * The tier a COIN graduates into: the AmmConfig it pinned at initialize_token (TokenConfig.ll_cp_config) when that is a listed tier,
 * else (pin not read, or an unlisted id) the tier new coins get on the cluster. Every per-coin page number reads this.
 */
export function tierForPin(cluster: CpmmCluster, pinnedId?: string | null): CpmmTier {
  const t = pinnedId ? cpmmTierOf(pinnedId) : null;
  return t && (cluster === "devnet" ? t.cluster === "devnet" : t.cluster === "mainnet") ? t : CPMM_TIER[cluster];
}
/** "tier 9 (LNmH…)" for a known AmmConfig id, "an unlisted tier (…)" otherwise — the mismatch messages and the trust table say which tier each side is. */
export function cpmmTierLabel(id: string): string {
  const t = cpmmTierOf(id);
  return t ? `tier ${t.index} (${id})` : `an unlisted tier (${id})`;
}

const MILLION = 1_000_000;
/** The per-swap breakdown after graduation, in bps of volume, for a tier and the program's compiled LP-fee split (burn share, of 10,000). */
export function postGraduationBps(tier: CpmmTier, lockFeeBurnBps: number) {
  const lp = (tier.tradeFeeRate * (MILLION - tier.protocolFeeRate - tier.fundFeeRate)) / MILLION;
  const lpToBurnPool = (lp * lockFeeBurnBps) / 10_000;
  const lpToOperator = lp - lpToBurnPool;
  const protocol = (tier.tradeFeeRate * tier.protocolFeeRate) / MILLION;
  const fund = (tier.tradeFeeRate * tier.fundFeeRate) / MILLION;
  const creatorToBurnPool = (tier.creatorFeeRate * (MILLION - tier.creatorFeeShareRate)) / MILLION;
  const creatorToRaydium = tier.creatorFeeRate - creatorToBurnPool;
  const bps = (ppm: number) => ppm / 100;
  return {
    tradeFee: bps(tier.tradeFeeRate), creatorFee: bps(tier.creatorFeeRate), lpFees: bps(lp), lpToBurnPool: bps(lpToBurnPool), lpToOperator: bps(lpToOperator),
    protocol: bps(protocol), fund: bps(fund), creatorToBurnPool: bps(creatorToBurnPool), creatorToRaydium: bps(creatorToRaydium),
    raydiumTotal: bps(protocol + fund + creatorToRaydium), burnPoolTotal: bps(lpToBurnPool + creatorToBurnPool), tradersPay: bps(tier.tradeFeeRate + tier.creatorFeeRate),
  };
}
