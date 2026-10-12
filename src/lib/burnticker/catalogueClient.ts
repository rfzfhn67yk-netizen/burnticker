/**
 * ONE CATALOGUE READ PER PAGE LOAD (site audit 2026-10-11 #18: /burnticker/launch fetched /api/burnticker/catalogue five times — the
 * page, the header's launch availability, and React's development double mount of each). Every client reader shares this promise; a
 * failed read is shared too (the readers fail closed), and `reloadCatalogue` is the explicit retry. Client-safe.
 */
let pending: Promise<unknown> | null = null;
export function loadCatalogue(fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<unknown> {
  pending ??= fetchImpl("/api/burnticker/catalogue").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`the catalogue answered HTTP ${r.status}`))));
  return pending;
}
/** Drops the shared read (a retry button; tests). */
export function reloadCatalogue(): void { pending = null; }
