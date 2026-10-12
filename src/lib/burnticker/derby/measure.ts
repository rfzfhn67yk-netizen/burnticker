import { canonicalDecimal, fromScaled, toScaled } from "@/lib/burnticker/units";
import { canonical, DERBY_DISAGREEMENT_PP, type CoinVsSpec, type DerbyUnderlying, type DerbyWindowSpan } from "@/lib/burnticker/derby/spec";

/**
 * BURN DERBY'S ARITHMETIC AND DECISIONS (2026-10-10). Pure: every input is a decimal string the keeper read (a Pyth value, a pool TWAP,
 * a cross-read quote, a mint supply) and every output is an exact decimal string, so a stranger with the same inputs gets the same
 * winner to the last digit. Percentages carry 6 decimals, truncated toward zero.
 *
 *   window margin   = A's % change − B's % change (percentage points). > 0 → YES (A wins), < 0 → NO (B wins), = 0 → void (a tie:
 *                     no burn, the receipt still posts).
 *   cross-check     the same margin from the independent operator's boundary snapshots; |primary − cross| > DERBY_DISAGREEMENT_PP →
 *                     WITHHELD (no reading, no burn, an alert). A missing cross-read also withholds.
 *   flippening      size = value × circulating supply at the window's END boundary; YES when A's size > B's. The cross-check compares
 *                     the size ratio (A/B − 1, in %) and withholds above the same 2-point bound.
 */

const PCT_DP = 6;
const WORK = 24;

/** Decimal strings → their difference (exact). */
export function subDec(a: string, b: string): string {
  const sc = Math.max(dp(a), dp(b));
  return fromScaled(toScaled(a, sc) - toScaled(b, sc), sc);
}
export function cmpDec(a: string, b: string): number {
  const sc = Math.max(dp(a), dp(b));
  const x = toScaled(a, sc), y = toScaled(b, sc);
  return x === y ? 0 : x > y ? 1 : -1;
}
export const absDec = (a: string): string => (a.startsWith("-") ? a.slice(1) : a);
/** a × b (exact). */
export function mulDec(a: string, b: string): string { return fromScaled(toScaled(a, dp(a)) * toScaled(b, dp(b)), dp(a) + dp(b)); }
const dp = (s: string): number => { const m = /^-?\d+(?:\.(\d+))?$/.exec(s.trim()); if (!m) throw new Error(`not a decimal: ${s}`); return m[1]?.length ?? 0; };

/** (end / start − 1) × 100, 6 decimals truncated toward zero. */
export function pctChange(start: string, end: string): string {
  if (cmpDec(start, "0") <= 0) throw new Error(`start value ${start} is not positive`);
  const sc = Math.max(dp(start), dp(end));
  const s = toScaled(start, sc), e = toScaled(end, sc);
  const q = ((e - s) * BigInt(100) * BigInt(10) ** BigInt(PCT_DP)) / s;
  return fromScaled(q, PCT_DP);
}

/** (a / b − 1) × 100, 6 decimals truncated (the flippening's size comparison). */
export const ratioPct = (a: string, b: string): string => pctChange(b, a);

/** One coin's reading over a window (start and end boundary values, its % change, and the proof material behind each value). */
export interface SideReading {
  symbol: string;
  key: string;
  source: "pyth" | "twap" | "redstone";
  start: string;
  end: string;
  /** Circulating supply (UI units) at each boundary — the mcap measure and the flippening. */
  supplyStart: string | null;
  supplyEnd: string | null;
  changePct: string;
  /** What a stranger needs to re-read each value: Pyth update hashes and URLs, or the pool's samples (slots and vault balances). */
  proof: Record<string, unknown>;
}

export interface CrossSide { source: string; start: string; end: string; changePct: string; refs: Record<string, unknown> }

/** The side's measured change: pct = the value's change; mcap = (value × supply)'s change. */
export function sideChange(measure: CoinVsSpec["measure"], start: string, end: string, supplyStart: string | null, supplyEnd: string | null): string {
  if (measure === "pct") return pctChange(start, end);
  if (supplyStart === null || supplyEnd === null) throw new Error("mcap measure without a supply reading");
  return pctChange(mulDec(start, supplyStart), mulDec(end, supplyEnd));
}

export type Decision =
  | { status: "decided"; result: "yes" | "no" | "void" | null; value: string; margin: string; crossMargin: string; disagreement: string; note: string }
  | { status: "withheld"; reason: string; margin: string | null; crossMargin: string | null; disagreement: string | null }
  | { status: "pending"; reason: string };

/** A window of a coin-vs-coin derby (not a flippening): winner from the primary margin, withheld when the cross-read disagrees or is missing. */
export function decideWindow(a: SideReading, b: SideReading, cross: { a: CrossSide | null; b: CrossSide | null }, bound = DERBY_DISAGREEMENT_PP): Decision {
  const margin = subDec(a.changePct, b.changePct);
  if (!cross.a || !cross.b) return { status: "withheld", reason: `The cross-read for ${!cross.a ? a.symbol : b.symbol} was not available at a boundary. There is no reading and no burn.`, margin, crossMargin: null, disagreement: null };
  const crossMargin = subDec(cross.a.changePct, cross.b.changePct);
  const disagreement = absDec(subDec(margin, crossMargin));
  if (cmpDec(disagreement, String(bound)) > 0) return { status: "withheld", reason: `The cross-read disagrees by ${disagreement} points on the margin (primary ${margin}, cross ${crossMargin}, limit ${bound}). There is no reading and no burn.`, margin, crossMargin, disagreement };
  const c = cmpDec(margin, "0");
  return { status: "decided", result: c > 0 ? "yes" : c < 0 ? "no" : "void", value: canonicalDecimal(margin), margin, crossMargin, disagreement, note: c > 0 ? `${a.symbol} ${a.changePct}% vs ${b.symbol} ${b.changePct}%: ${a.symbol} wins` : c < 0 ? `${a.symbol} ${a.changePct}% vs ${b.symbol} ${b.changePct}%: ${b.symbol} wins` : `${a.symbol} and ${b.symbol} both ${a.changePct}%: a tie, no burn` };
}

/**
 * A flippening window: sizes at the END boundary. A's size above B's → YES (settles the one-shot); otherwise not yet — PENDING, or NO
 * when this is the season's last window. Withheld when the cross-read's size ratio disagrees by more than the bound.
 */
export function decideFlip(sizeA: string, sizeB: string, crossSizes: { a: string; b: string } | null, last: boolean, bound = DERBY_DISAGREEMENT_PP): Decision {
  const ratio = ratioPct(sizeA, sizeB);
  if (!crossSizes) return { status: "withheld", reason: "The cross-read was not available at the boundary. There is no reading and no burn.", margin: ratio, crossMargin: null, disagreement: null };
  const crossRatio = ratioPct(crossSizes.a, crossSizes.b);
  const disagreement = absDec(subDec(ratio, crossRatio));
  if (cmpDec(disagreement, String(bound)) > 0) return { status: "withheld", reason: `The cross-read disagrees by ${disagreement}% on the size comparison (primary ${ratio}%, cross ${crossRatio}%). There is no reading and no burn.`, margin: ratio, crossMargin: crossRatio, disagreement };
  if (cmpDec(ratio, "0") > 0) return { status: "decided", result: "yes", value: canonicalDecimal(ratio), margin: ratio, crossMargin: crossRatio, disagreement, note: `A's size is ${ratio}% above B's: the flippening` };
  if (last) return { status: "decided", result: "no", value: canonicalDecimal(ratio), margin: ratio, crossMargin: crossRatio, disagreement, note: "the season ended without a flippening" };
  return { status: "pending", reason: `no flippening yet (A's size ${ratio}% vs B's)` };
}

/** The proof JSON a decided/withheld window records; its sha256 is the reading's proof hash. Canonical (keys sorted). */
export function proofDocument(selectorKey: string, w: DerbyWindowSpan, sides: { a: SideReading | null; b: SideReading | null }, cross: { a: CrossSide | null; b: CrossSide | null }, d: Decision, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return JSON.parse(canonical({
    schema: "burnticker.derby-proof/v1", selectorKey, window: { id: w.id, start: new Date(w.startMs).toISOString(), end: new Date(w.endMs).toISOString() },
    a: sides.a ? { symbol: sides.a.symbol, source: sides.a.source, start: sides.a.start, end: sides.a.end, supplyStart: sides.a.supplyStart, supplyEnd: sides.a.supplyEnd, changePct: sides.a.changePct, proof: sides.a.proof } : null,
    b: sides.b ? { symbol: sides.b.symbol, source: sides.b.source, start: sides.b.start, end: sides.b.end, supplyStart: sides.b.supplyStart, supplyEnd: sides.b.supplyEnd, changePct: sides.b.changePct, proof: sides.b.proof } : null,
    cross, decision: d, bound: DERBY_DISAGREEMENT_PP, ...extra,
  })) as Record<string, unknown>;
}

/** Two sides' cross-read change from boundary quotes (usd at start / end, with supplies for the mcap measure). */
export function crossSide(measure: CoinVsSpec["measure"], q: { source: string; start: string; end: string; refs: Record<string, unknown> } | null, supplyStart: string | null, supplyEnd: string | null): CrossSide | null {
  if (!q) return null;
  return { source: q.source, start: q.start, end: q.end, changePct: sideChange(measure, q.start, q.end, supplyStart, supplyEnd), refs: q.refs };
}

/** The 16-hex proof digest an event id carries (so the counter attestation's src= commits to it too). */
export const proof16 = (sha: string): string => sha.slice(0, 16);

export type { DerbyUnderlying };

/** Display: "+3.12%" / "−1.05%" (2 decimals) from a 6-decimal % string. */
export function fmtPctChange(pct: string | null): string {
  if (pct === null) return "—";
  const n = Number(pct);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}%`;
}

/** Truncate a decimal to `places` (toward zero). */
export const truncDec = (s: string, places = WORK): string => { const sc = Math.min(dp(s), places); return fromScaled(toScaled(s.includes(".") ? s.slice(0, s.indexOf(".") + 1 + sc).replace(/\.$/, "") : s, sc), sc); };
