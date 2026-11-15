import { buybackSpend, minAmountOut, step } from "@/lib/burnReceipts/math";
import { CARRY_CONSECUTIVE, CARRY_NONE } from "@/lib/burnReceipts/constants";

/**
 * THE BURN ARITHMETIC, STEP BY STEP (website brief 2026-10-11 §6), on the program's own math (src/lib/burnReceipts/math.ts, the
 * line-for-line mirror of programs/burn-receipts/…/math.rs) and crank_buyback's order of operations:
 *
 *   1 qualifying units   floor((now − prev + carry) / unit) — the remainder carries only across consecutive increases
 *   2 available budget   the burn pool's spendable SOL (less its rent reserve). There is no platform cap (owner decision 2026-10-25)
 *   3 planned spend      budget × (1 − (1 − f)^units): COMPOUNDING — each unit spends f of what the previous one left, so 23 units at
 *                        1 % spend 20.6 % of the budget, not 23 %; plus spend carried from earlier cranks, at most the pool
 *   4 actual purchase    the whole planned spend in one run (no per-run bound since 2026-10-25); anything under the spend floor
 *                        fixed at launch buys nothing (the day's own spend stays in the pool, carried spend stays owed)
 *   5 actual burn        every token the purchase received. How many tokens that is depends on the trading pool's reserves at the
 *                        moment of the crank, so it is shown ONLY when the caller states hypothetical pool reserves — an estimate,
 *                        constant-product, after the pool fee, never a quote
 *
 * Holders' balances are never touched: the burn destroys only tokens the program bought with the burn pool. Lamports throughout.
 */
export const LAMPORTS = BigInt(1_000_000_000);

export interface CrankInput {
  /** value units (e.g. cents of debt) */ prev: bigint; now: bigint; carryIn: bigint; unit: bigint; carry: "consecutive" | "none";
  fractionBps: number;
  /** the burn pool's spendable SOL (lamports, after its rent reserve) */ poolLamports: bigint;
  carriedInLamports: bigint; floorLamports: bigint;
  /** the trading pool's SOL reserve (lamports), used only for the token estimate */ reserveSolLamports: bigint;
  /** HYPOTHETICAL token reserve of the trading pool (raw units) + fee: only then is a token amount estimated */ assumedReserveTokenRaw?: bigint | null; poolFeePpm?: bigint;
}
export interface CrankSteps {
  units: bigint; carryOut: bigint; budget: bigint; ruleSpend: bigint; naiveSpend: bigint; planned: bigint;
  spend: bigint; carriedOut: bigint; belowFloor: boolean; estimatedTokensRaw: bigint | null;
}

export function simulateCrank(i: CrankInput): CrankSteps {
  const s = step(i.prev, i.now, i.carryIn, i.unit, i.carry === "consecutive" ? CARRY_CONSECUTIVE : CARRY_NONE);
  const budget = i.poolLamports;
  const ruleSpend = buybackSpend(budget, s.units, i.fractionBps);
  const naiveRaw = (budget * s.units * BigInt(i.fractionBps)) / BigInt(10_000);
  const naiveSpend = naiveRaw > budget ? budget : naiveRaw;
  const sum = ruleSpend + i.carriedInLamports;
  const planned = sum < i.poolLamports ? sum : i.poolLamports;
  const zero = BigInt(0);
  if (planned === zero || planned < i.floorLamports) {
    const kept = i.carriedInLamports < i.poolLamports ? i.carriedInLamports : i.poolLamports;
    return { units: s.units, carryOut: s.carryOut, budget, ruleSpend, naiveSpend, planned, spend: zero, carriedOut: kept, belowFloor: true, estimatedTokensRaw: null };
  }
  // owner decision 2026-10-25: one crank spends the rule's full share in one run (no per-run bound, no platform cap)
  const spend = planned;
  const est = i.assumedReserveTokenRaw && i.assumedReserveTokenRaw > zero && i.reserveSolLamports > zero ? minAmountOut(spend, i.reserveSolLamports, i.assumedReserveTokenRaw, i.poolFeePpm ?? BigInt(2500), 0) : null;
  return { units: s.units, carryOut: s.carryOut, budget, ruleSpend, naiveSpend, planned, spend, carriedOut: zero, belowFloor: false, estimatedTokensRaw: est };
}

export const sol = (l: bigint, d = 4): string => (Number(l) / 1e9).toFixed(d);

// ---- the calculator's inputs (website audit 4, BT-06): validated, never clamped or substituted ----

export type CalcField = "riseB" | "pct" | "pool" | "reserve" | "tokRes";
export interface CalcRaw { riseB: string; pct: string; pool: string; reserve: string; tokRes: string }
export interface CalcValues { riseCents: bigint; bps: number; poolLamports: bigint; reserveLamports: bigint; tokenReserveRaw: bigint | null }
export type CalcParse = { ok: true; values: CalcValues; errors: Partial<Record<CalcField, string>> } | { ok: false; values: null; errors: Partial<Record<CalcField, string>> };

/** A non-negative decimal string → an exact integer at `decimals` places, or a reason. No exponent notation, no rounding. */
export function parseDecimal(raw: string, decimals: number, max: bigint): { value: bigint } | { error: string } {
  const s = raw.trim();
  if (s === "") return { error: "required" };
  if (s.startsWith("-")) return { error: "must be 0 or more" };
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return { error: "not a number (digits and one decimal point)" };
  const frac = m[2] ?? "";
  if (frac.length > decimals) return { error: `at most ${decimals} decimal place${decimals === 1 ? "" : "s"}` };
  const v = BigInt((m[1] || "0") + frac.padEnd(decimals, "0"));
  if (v > max) return { error: "too large for this calculator" };
  return { value: v };
}

const pow10 = (n: number): bigint => BigInt(10) ** BigInt(n);

export function parseCalcInputs(r: CalcRaw): CalcParse {
  const errors: Partial<Record<CalcField, string>> = {};
  // debt rise in $B with up to 11 decimals = cents; at most $1,000,000B
  const rise = parseDecimal(r.riseB, 11, BigInt(1_000_000) * pow10(11));
  // per unit: 0.01 % … 100 %, two decimals = basis points
  const pct = parseDecimal(r.pct, 2, BigInt(10_000));
  const pool = parseDecimal(r.pool, 9, BigInt(1_000_000) * LAMPORTS);
  const reserve = parseDecimal(r.reserve, 9, BigInt(1_000_000_000) * LAMPORTS);
  const tok = r.tokRes.trim() === "" ? null : parseDecimal(r.tokRes, 6, pow10(15) * pow10(6));
  if ("error" in rise) errors.riseB = rise.error;
  if ("error" in pct) errors.pct = pct.error === "too large for this calculator" ? "between 0.01 and 100" : pct.error;
  else if (pct.value < BigInt(1)) errors.pct = "between 0.01 and 100";
  if ("error" in pool) errors.pool = pool.error;
  if ("error" in reserve) errors.reserve = reserve.error;
  if (tok && "error" in tok) errors.tokRes = tok.error;
  else if (tok && tok.value === BigInt(0)) errors.tokRes = "leave empty, or enter more than 0";
  if (Object.keys(errors).length) return { ok: false, values: null, errors };
  return { ok: true, errors, values: { riseCents: (rise as { value: bigint }).value, bps: Number((pct as { value: bigint }).value), poolLamports: (pool as { value: bigint }).value, reserveLamports: (reserve as { value: bigint }).value, tokenReserveRaw: tok ? (tok as { value: bigint }).value : null } };
}
