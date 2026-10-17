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
/** Mainnet AmmConfig index 9: the tier the platform points at under the 2026-10-12 decision. */
export const CPMM_MAINNET_TIER_9: CpmmTier = { cluster: "mainnet", index: 9, id: "LNmHRmMvk9kmtepfTSr98kqGLThd61kH1DPWf2cVRaC", tradeFeeRate: 2_500, protocolFeeRate: 120_000, fundFeeRate: 40_000, creatorFeeRate: 7_500, creatorFeeShareRate: 50_000 };
/** Devnet AmmConfig index 0 (the rehearsal platform's pin; devnet has no creator-fee tier like mainnet's index 9). */
export const CPMM_DEVNET_TIER_0: CpmmTier = { cluster: "devnet", index: 0, id: "5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy", tradeFeeRate: 2_500, protocolFeeRate: 120_000, fundFeeRate: 40_000, creatorFeeRate: 2_500, creatorFeeShareRate: 0 };

/** The tier the platform points at, per cluster (the platform-config CLI, the pair-curve launch and the lookup table read this). */
export const CPMM_TIER: Record<CpmmCluster, CpmmTier> = { mainnet: CPMM_MAINNET_TIER_9, devnet: CPMM_DEVNET_TIER_0, localnet: CPMM_MAINNET_TIER_9 };
/** The AmmConfig id per cluster (strings, for the client-side lookup table and the launch builders). */
export const CPMM_CONFIG_ID: Record<CpmmCluster, string> = { mainnet: CPMM_TIER.mainnet.id, devnet: CPMM_TIER.devnet.id, localnet: CPMM_TIER.localnet.id };

const KNOWN_TIERS: readonly CpmmTier[] = [CPMM_MAINNET_TIER_0, CPMM_MAINNET_TIER_9, CPMM_DEVNET_TIER_0];
export const cpmmTierOf = (id: string): CpmmTier | null => KNOWN_TIERS.find((t) => t.id === id) ?? null;
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
