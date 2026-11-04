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
export function teamDrainUnit(outcome: "win" | "loss" | "draw" | "windraw" | "drawloss" | "winloss", fade = false): DrainUnit {
  // two of the three results (espn.ts PairOutcome): "per win or draw … after 5 wins or draws"
  if (outcome === "windraw" || outcome === "drawloss" || outcome === "winloss") { const one = outcome === "windraw" ? "win or draw" : outcome === "drawloss" ? "draw or loss" : "win or loss"; return { one, many: outcome === "windraw" ? "wins or draws" : outcome === "drawloss" ? "draws or losses" : "wins or losses" }; }
  return fade ? { one: `game without a ${outcome}`, many: `games without a ${outcome}` } : { one: outcome, many: outcome === "loss" ? "losses" : `${outcome}s` };
}

/**
 * HS-2 (widened, hourly run 13; launch-critical): when the back-test spends more than half the pool at the chosen share, the burn step
 * says so in one amber line above the share chips, and the review opens the back-test block. Null when the share spends half or less,
 * the projection is not a per-share one, or the chosen share was not projected. Numbers come from the projection's own rows
 * (projection.ts reviewProjection). Client-safe, here beside the drain arithmetic, so the burn step and the review say the same line.
 */
export const HEAVY_SPEND_ABOVE = 0.5;
const SMALL_NUMBER_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
export function heavySpendLine(p: { available: boolean; weeks: number | null; rows: readonly { share: number; units: number; spentPct: number }[] } | null | undefined, share: number | null): string | null {
  if (!p?.available || share === null || !(share > 0 && share < 1)) return null;
  const row = p.rows.find((r) => Math.abs(r.share - share) < 1e-9);
  if (!row || !(row.spentPct / 100 > HEAVY_SPEND_ABOVE)) return null;
  const w = p.weeks;
  const span = !w ? "over the saved readings" : w === 1 ? "over the last week" : `over the last ${SMALL_NUMBER_WORDS[w] ?? String(w)} weeks`;
  const smaller = p.rows.filter((r) => r.share < share - 1e-9).sort((a, b) => a.share - b.share)[0] ?? null;
  const also = smaller ? ` ${pctLabel(smaller.share)} spends ${drainPct(smaller.spentPct / 100)}.` : "";
  // HB-166 L5 (hourly run 15): the line fires on first-party feeds, whose unit is fixed by the source, so it names no unit; when the
  // smallest share also spends more than half, it says so instead of suggesting it
  const advice = !smaller ? "" : smaller.spentPct / 100 > HEAVY_SPEND_ABOVE ? " Even the smallest share spends more than half of the pool on these readings." : " A smaller share keeps more of the pool.";
  return `At ${pctLabel(share)} each, this rule would have spent ${drainPct(row.spentPct / 100)} of the pool ${span} (${row.units} ${row.units === 1 ? "burn" : "burns"}).${also}${advice}`;
}
