/**
 * Audit 12 item 13: a within-event filter over an event's outcomes, by the outcome's own name or its question (case and accents ignored),
 * keeping their order; `limit` and `offset` page it. Returns the page, the number that matched and the total, so the page can say
 * "12 of 30 shown" and offer the next page. Pure and client-safe (the launch page imports it; oracle/polymarket.ts re-exports it).
 */
export function filterOutcomes<T extends { question: string; outcome?: string | null; endDate: string | null }>(markets: readonly T[], q: string, o: { limit?: number; offset?: number } = {}): { shown: T[]; matched: number; total: number; nextOffset: number | null } {
  const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const words = norm(q).split(/\s+/).filter(Boolean);
  const hit = words.length ? markets.filter((m) => { const h = `${norm(m.outcome)} ${norm(m.question)} ${m.endDate ?? ""}`; return words.every((w) => h.includes(w)); }) : [...markets];
  const offset = Math.max(0, o.offset ?? 0), limit = Math.max(1, o.limit ?? 12);
  const shown = hit.slice(offset, offset + limit);
  return { shown, matched: hit.length, total: markets.length, nextOffset: offset + limit < hit.length ? offset + limit : null };
}
/** "12 of 30 shown", or with a filter typed "4 of 9 that match shown (30 in all)": the line under an event's outcomes. */
export const outcomesShownLine = (r: { shown: readonly unknown[]; matched: number; total: number }, filtered = false): string =>
  filtered ? `${r.shown.length} of ${r.matched} that match shown (${r.total} in all).` : `${r.shown.length} of ${r.total} shown.`;

/**
 * LADDER ORDER (walkthrough 13, 2026-10-14: "What price will Bitcoin hit in 2026?" listed 95k, 60k, 70k, 65k, 200k…). When EVERY outcome
 * label of an event reads as one number ("↑ 95,000", "$1.5M", "<60k", "60-70k") or one date ("December 31", "Dec 31, 2026", "2026-12-31"),
 * the key each sorts by; null when any label does not, so a list of names keeps its source order. Pure and client-safe.
 */
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SCALE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
const NUM_WORDS = /\b(above|below|over|under|at least|at most|more than|less than|or more|or less|or higher|or lower|or above|or below|reach|hit|dip to|up to|between|and|to|usd|million|billion|thousand)\b/g;
export function ladderNumber(label: string): number | null {
  const s = label.toLowerCase().replace(/[↑↓≥≤<>+$€£~]/g, " ").replace(NUM_WORDS, (w) => (w === "million" ? "m" : w === "billion" ? "b" : w === "thousand" ? "k" : " ")).replace(/\s+/g, " ").trim();
  if (!s) return null;
  const tok = /(-?\d[\d,]*(?:\.\d+)?)\s*([kmbt%])?(?![a-z])/g;
  const nums: { v: number; unit: string | undefined }[] = [];
  for (const m of s.matchAll(tok)) nums.push({ v: Number(m[1].replace(/,/g, "")), unit: m[2] });
  if (!nums.length || nums.length > 2 || nums.some((n) => !Number.isFinite(n.v))) return null;
  // nothing but the numbers, their units and a range dash may be left
  if (s.replace(tok, "").replace(/[\s\-–]/g, "") !== "") return null;
  const unit = nums[0].unit ?? nums[nums.length - 1].unit;
  return nums[0].v * (unit && unit !== "%" ? SCALE[unit] : 1);
}
const monthOf = (w: string): number => { const i = MONTH_NAMES.findIndex((n) => n === w || (w.length >= 3 && n.startsWith(w)) || (w === "sept" && n === "september")); return i; };
export function ladderDate(label: string): number | null {
  const s = label.toLowerCase().replace(/^(by|before|on|in|until|end of)\s+/, "").replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) { const mo = +iso[2] - 1, d = +iso[3]; return mo >= 0 && mo < 12 && d >= 1 && d <= 31 ? Date.UTC(+iso[1], mo, d) : null; }
  const md = /^([a-z]+) (\d{1,2})(?: (\d{4}))?$/.exec(s), my = /^([a-z]+) (\d{4})$/.exec(s);
  const word = md?.[1] ?? my?.[1];
  if (!word) return null;
  const mo = monthOf(word);
  if (mo < 0) return null;
  const d = md ? +md[2] : 1, y = md ? (md[3] ? +md[3] : 2000) : +my![2];
  return d >= 1 && d <= 31 ? Date.UTC(y, mo, d) : null;
}
/** The ladder key of each label, numbers first, then dates; null unless every label (two or more) parses the same way. */
export function ladderKeys(labels: readonly string[]): number[] | null {
  if (labels.length < 2) return null;
  for (const f of [ladderNumber, ladderDate]) { const k = labels.map(f); if (k.every((x): x is number => x !== null)) return k; }
  return null;
}
/** `items` in ladder order when every label is a number or a date (stable for equal keys), else in their own order. */
export function ladderOrder<T>(items: readonly T[], labelOf: (x: T) => string | null | undefined): T[] {
  const keys = ladderKeys(items.map((x) => labelOf(x) ?? ""));
  if (!keys) return [...items];
  return items.map((x, i) => ({ x, i, k: keys[i] })).sort((a, b) => a.k - b.k || a.i - b.i).map((r) => r.x);
}
