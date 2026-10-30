/**
 * LD6-4 (sixth pass): a market's outcome labels beside its question. "Will Tom Holland…? (YES = Yes, NO = No)" repeats what every
 * yes/no market says; the pair is worth printing only when a label is something else ("YES = Broncos, NO = Seahawks"). Empty string
 * when the labels are the plain Yes and No. Pure and client-safe; the launch page's market list is the caller.
 */
export function outcomeLabelsNote(yes: string | null | undefined, no: string | null | undefined): string {
  const y = (yes ?? "").trim(), n = (no ?? "").trim();
  if (!y && !n) return "";
  if (/^yes$/i.test(y) && /^no$/i.test(n)) return "";
  return `(YES = ${y || "Yes"}, NO = ${n || "No"})`;
}
