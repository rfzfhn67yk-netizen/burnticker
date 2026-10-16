/**
 * NUMBERS AND LISTS FROM AN API ANSWER, SHOWN WITHOUT CRASHING THE PAGE (audit 2026-10-15 H7). The coin and pair pages called
 * `.toFixed` and `.join` straight on fields of a fetched JSON answer; one missing or non-numeric field (an older keeper's status file, a
 * half-read pool) threw during render and blanked the page. These answer a dash or an empty string instead. Client-safe.
 */
export const DASH = "—";
/** `n.toFixed(digits)` for a finite number (or a numeric string), else a dash. */
export function fixed(n: unknown, digits = 2): string {
  const x = typeof n === "number" ? n : typeof n === "string" && n.trim() !== "" ? Number(n) : NaN;
  return Number.isFinite(x) ? x.toFixed(digits) : DASH;
}
/** The items of an array joined, skipping anything that is not a string or a number; anything else is an empty string. */
export function joinList(xs: unknown, sep: string): string {
  return Array.isArray(xs) ? xs.filter((x) => typeof x === "string" || (typeof x === "number" && Number.isFinite(x))).join(sep) : "";
}
/** The finite numeric values of a series (a chart drops a reading that is not a number instead of drawing NaN). */
export const finiteNumber = (v: unknown): number | null => { const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN; return Number.isFinite(x) ? x : null; };
