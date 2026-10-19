/**
 * THE OPERATOR'S POST-GRADUATION SHARE, STATED FROM THE WHOLE (the owner, 2026-10-12, on the trust page: "dev fees are wrong, it's showing
 * I'm getting 20%"). The 20% is the operator's share of the locked pool's LIQUIDITY fees only, which on mainnet tier 14 (new coins since
 * the 2026-10-19 decision) is 12.6 bps of a swap that pays 125 bps in all (4.2 of 100 on tier 9). Every public sentence about that share leads with the per-swap whole and names the 20% only as the liquidity-fee
 * split. Client-safe (cpmmTier.ts and type imports only): the client pages build the line from the FeeSplit their JSON carries or from the
 * tier record, fees.ts from the designed split, so no number in the sentence is typed.
 */
import { CPMM_TIER, postGraduationBps, type CpmmCluster } from "@/lib/burnticker/cpmmTier";
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

/**
 * Coins created before the 2026-10-19 tier change keep the tier they pinned, so a sentence that states the new-coin shares without naming
 * a coin adds this line (no date in public prose). A coin's own page states its own split instead.
 */
export const EARLIER_COINS_LINE = "Coins created before the latest pool fee change keep the fees they started with, and each coin's page shows its own split.";

/** The mainnet line for new coins, client-safe (what the shared copy modules print). */
export const OPERATOR_SHARE_LINE = postGraduationShareLine(sharesForCluster("mainnet"));
/** The mainnet line for a pair coin (creator fee off). */
export const PAIR_OPERATOR_SHARE_LINE = postGraduationShareLine(sharesForCluster("mainnet", { pair: true }));
