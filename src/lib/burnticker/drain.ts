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
/** A unit word with its plural ("game without a win", "games without a win"); a plain string takes an "s". */
export type DrainUnit = string | { one: string; many: string };
const plural = (u: DrainUnit): string => (typeof u === "string" ? `${u}s` : u.many);
/**
 * "At 25% per win, about 76% of the pool is gone after 5 wins, if no new fees come in." sources-7 (QA walkthrough 11 M2): the unit is the
 * rule's own ("per game without a win … after 5 games without a win"), never "win" on the fade side.
 */
export function drainLine(share: number, unit: DrainUnit = "result", n = 5): string {
  const gone = spentFraction(Array(n).fill(1), share), one = typeof unit === "string" ? unit : unit.one;
  return `At ${pctLabel(share)} per ${one}, about ${drainPct(gone)} of the pool is gone after ${n} ${plural(unit)}, if no new fees come in.`;
}
/** How many units take half the pool at `share` (compounding as the program does): ln 0.5 / ln(1 − share), rounded up. */
export const unitsToHalf = (share: number): number => (share > 0 && share < 1 ? Math.ceil(Math.log(0.5) / Math.log(1 - share)) : share >= 1 ? 1 : Infinity);
/** The unit of a team coin's burn, from its outcome and side (the fade side counts games without the outcome). */
export function teamDrainUnit(outcome: "win" | "loss" | "draw", fade = false): DrainUnit {
  return fade ? { one: `game without a ${outcome}`, many: `games without a ${outcome}` } : { one: outcome, many: outcome === "loss" ? "losses" : `${outcome}s` };
}
