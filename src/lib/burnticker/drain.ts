import { buybackSpend } from "@/lib/burnReceipts/math";

/**
 * HOW FAST A SHARE DRAINS A POOL (ChatGPT audit 7 item 6, 2026-10-12: the 10% and 25% shares need their drain said beside them). The
 * program's own compounding (burnReceipts/math buybackSpend, the call burnMath.simulateCrank makes): each unit spends its share of what
 * the unit before left. Client-safe, so the launch page and the review say the same numbers; projection.ts uses it for the history.
 */
const NOTIONAL = BigInt(1_000_000_000_000);   // 1,000 SOL: any size gives the same percentage
/** The share of a pool spent by a sequence of readings with `units` each, compounding as the program does (no new fees, no per-run cap). */
export function spentFraction(unitsPerReading: readonly number[], share: number): number {
  const bps = Math.round(share * 10_000);
  let pool = NOTIONAL;
  for (const u of unitsPerReading) if (u > 0 && pool > BigInt(0)) pool -= buybackSpend(pool, BigInt(Math.floor(u)), bps);
  return 1 - Number(pool) / Number(NOTIONAL);
}
export const drainPct = (f: number): string => { const v = f * 100; return v >= 99.95 ? "99.9%" : v >= 10 ? `${Math.round(v)}%` : `${Math.round(v * 10) / 10}%`; };
const pctLabel = (f: number): string => `${Math.round(f * 1000) / 10}%`;
/** "At 25% per win, about 76% of the pool is gone after 5 wins, if no new fees come in." */
export function drainLine(share: number, unit = "result", n = 5): string {
  const gone = spentFraction(Array(n).fill(1), share);
  return `At ${pctLabel(share)} per ${unit}, about ${drainPct(gone)} of the pool is gone after ${n} ${unit === "result" ? "results" : `${unit}s`}, if no new fees come in.`;
}
