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
/**
 * Prelaunch audit 2026-10-16 F-24: the bare reads next to the guards above. A decimal string with its thousands grouped ("1,234,567.5"),
 * else a dash; a count with its noun ("3 burns"), else a dash with the plural; an array, else []; the first `n` characters of a string
 * (an ISO date), else a dash.
 */
export function grouped(v: unknown): string {
  const s = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : null;
  if (s === null) return DASH;
  const [w, f] = s.split(".");
  return w.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : "");
}
export function counted(n: unknown, one: string, many = `${one}s`): string {
  return typeof n === "number" && Number.isFinite(n) ? `${n} ${n === 1 ? one : many}` : `${DASH} ${many}`;
}
export function listOf<T>(xs: T[] | null | undefined): T[] { return Array.isArray(xs) ? xs : []; }
export function headOf(v: unknown, n: number): string { return typeof v === "string" && v ? v.slice(0, n) : DASH; }
