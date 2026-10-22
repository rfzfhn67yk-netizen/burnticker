/**
 * ONE CATALOGUE READ PER PAGE LOAD (site audit 2026-10-11 #18: /burnticker/launch fetched /api/burnticker/catalogue five times — the
 * page, the header's launch availability, and React's development double mount of each). Every client reader shares this promise; a
 * failed read is shared too (the readers fail closed), and `reloadCatalogue` is the explicit retry. Client-safe.
 *
 * AND ONE PER SESSION (prelaunch audit 2026-10-18 A-22): the catalogue is about 190 KB and every full page load read it again. A good
 * answer is now kept in this tab's session storage for CATALOGUE_SESSION_MS, which with the edge's own minute (edgeCache.ts) stays well
 * inside the launch state's fifteen-minute freshness window (launchAvailability.ts STALE_AFTER_MS). Storage that is blocked or full
 * only means the catalogue is read again.
 */
export const CATALOGUE_SESSION_KEY = "bt-catalogue";
export const CATALOGUE_SESSION_MS = 5 * 60_000;
type SessionStore = Pick<Storage, "getItem" | "setItem">;
const sessionStore = (): SessionStore | null => { try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; } };

/** The kept answer when it is younger than CATALOGUE_SESSION_MS; null otherwise or when it cannot be read. */
export function keptCatalogue(store: SessionStore | null, now: number): unknown | null {
  try {
    const raw = store?.getItem(CATALOGUE_SESSION_KEY);
    if (!raw) return null;
    const k = JSON.parse(raw) as { at?: unknown; body?: unknown };
    return typeof k.at === "number" && now - k.at >= 0 && now - k.at < CATALOGUE_SESSION_MS && k.body && typeof k.body === "object" ? k.body : null;
  } catch { return null; }
}
export function keepCatalogue(store: SessionStore | null, body: unknown, now: number): void {
  try { store?.setItem(CATALOGUE_SESSION_KEY, JSON.stringify({ at: now, body })); } catch { /* full or blocked: read again next time */ }
}

let pending: Promise<unknown> | null = null;
export function loadCatalogue(fetchImpl: typeof fetch = (...a) => fetch(...a), store: SessionStore | null = sessionStore(), now: () => number = Date.now): Promise<unknown> {
  if (pending) return pending;
  const kept = keptCatalogue(store, now());
  pending = kept ? Promise.resolve(kept) : fetchImpl("/api/burnticker/catalogue")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`the catalogue answered HTTP ${r.status}`))))
    .then((body: unknown) => { keepCatalogue(store, body, now()); return body; });
  return pending;
}
/** Drops the shared read (a retry button; tests). */
export function reloadCatalogue(): void { pending = null; }
