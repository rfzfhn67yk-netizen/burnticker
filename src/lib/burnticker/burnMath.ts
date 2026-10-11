import { buybackSpend, minAmountOut, reserveSpendCap, step } from "@/lib/burnReceipts/math";
import { CARRY_CONSECUTIVE, CARRY_NONE } from "@/lib/burnReceipts/constants";

/**
 * THE BURN ARITHMETIC, STEP BY STEP (website brief 2026-10-11 §6), on the program's own math (src/lib/burnReceipts/math.ts, the
 * line-for-line mirror of programs/burn-receipts/…/math.rs) and crank_buyback's order of operations:
 *
 *   1 qualifying units   floor((now − prev + carry) / unit) — the remainder carries only across consecutive increases
 *   2 available budget   the burn pool's spendable SOL (less its rent reserve), capped at the pre-audit cap (25 SOL) while it stands
 *   3 planned spend      budget × (1 − (1 − f)^units): COMPOUNDING — each unit spends f of what the previous one left, so 23 units at
 *                        1 % spend 20.6 % of the budget, not 23 %; plus spend carried from earlier capped cranks, at most the pool
 *   4 actual purchase    at most 2 % of the trading pool's SOL reserve per crank; the rest carries to the next crank; anything under
 *                        the spend floor fixed at launch buys nothing (the day's own spend stays in the pool, carried spend stays owed)
 *   5 actual burn        every token the purchase received. How many tokens that is depends on the trading pool's reserves at the
 *                        moment of the crank, so it is shown ONLY when the caller states hypothetical pool reserves — an estimate,
 *                        constant-product, after the pool fee, never a quote
 *
 * Holders' balances are never touched: the burn destroys only tokens the program bought with the burn pool. Lamports throughout.
 */
export const LAMPORTS = BigInt(1_000_000_000);
export const MAX_SPEND_RESERVE_BPS = 200;
export const DEFAULT_CAP_LAMPORTS = BigInt(25) * LAMPORTS;

export interface CrankInput {
  /** value units (e.g. cents of debt) */ prev: bigint; now: bigint; carryIn: bigint; unit: bigint; carry: "consecutive" | "none";
  fractionBps: number;
  /** the burn pool's spendable SOL (lamports, after its rent reserve) */ poolLamports: bigint;
  capLamports: bigint | null; carriedInLamports: bigint; floorLamports: bigint;
  /** the trading pool's SOL reserve (lamports) — sets the 2 % per-crank cap */ reserveSolLamports: bigint;
  /** HYPOTHETICAL token reserve of the trading pool (raw units) + fee: only then is a token amount estimated */ assumedReserveTokenRaw?: bigint | null; poolFeePpm?: bigint;
}
export interface CrankSteps {
  units: bigint; carryOut: bigint; budget: bigint; capBound: boolean; ruleSpend: bigint; naiveSpend: bigint; planned: bigint;
  reserveCap: bigint; spend: bigint; carriedOut: bigint; belowFloor: boolean; estimatedTokensRaw: bigint | null;
}

export function simulateCrank(i: CrankInput): CrankSteps {
  const s = step(i.prev, i.now, i.carryIn, i.unit, i.carry === "consecutive" ? CARRY_CONSECUTIVE : CARRY_NONE);
  const budget = i.capLamports !== null && i.poolLamports > i.capLamports ? i.capLamports : i.poolLamports;
  const ruleSpend = buybackSpend(budget, s.units, i.fractionBps);
  const naiveRaw = (budget * s.units * BigInt(i.fractionBps)) / BigInt(10_000);
  const naiveSpend = naiveRaw > budget ? budget : naiveRaw;
  const sum = ruleSpend + i.carriedInLamports;
  const planned = sum < i.poolLamports ? sum : i.poolLamports;
  const reserveCap = reserveSpendCap(i.reserveSolLamports, MAX_SPEND_RESERVE_BPS);
  const zero = BigInt(0);
  if (planned === zero || planned < i.floorLamports) {
    const kept = i.carriedInLamports < i.poolLamports ? i.carriedInLamports : i.poolLamports;
    return { units: s.units, carryOut: s.carryOut, budget, capBound: budget < i.poolLamports, ruleSpend, naiveSpend, planned, reserveCap, spend: zero, carriedOut: kept, belowFloor: true, estimatedTokensRaw: null };
  }
  let spend = planned < reserveCap ? planned : reserveCap;
  if (spend > budget) spend = budget;
  const belowFloor = spend === zero || spend < i.floorLamports;
  const est = !belowFloor && i.assumedReserveTokenRaw && i.assumedReserveTokenRaw > zero && i.reserveSolLamports > zero ? minAmountOut(spend, i.reserveSolLamports, i.assumedReserveTokenRaw, i.poolFeePpm ?? BigInt(2500), 0) : null;
  return { units: s.units, carryOut: s.carryOut, budget, capBound: budget < i.poolLamports, ruleSpend, naiveSpend, planned, reserveCap, spend: belowFloor ? zero : spend, carriedOut: belowFloor ? planned : planned - spend, belowFloor, estimatedTokensRaw: est };
}

export const sol = (l: bigint, d = 4): string => (Number(l) / 1e9).toFixed(d);
