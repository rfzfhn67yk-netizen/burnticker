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
