/**
 * THE PAGE'S OWN VERSION (launch night 2026-10-13): a launch page loaded before a deploy keeps its old client code, and the owner's review
 * showed the old end-of-rule sentence until a reload. The launch layout renders the build id it was served from (the host's
 * `<distDir>/BUILD_ID`, read at request time) into the page; GET /api/burnticker/build answers the build id the host serves now. The
 * page asks when the window regains focus and when the review opens, at most once every 15 seconds, and when the two differ it shows one line.
 * It never reloads by itself: the creator may be mid-form. Client-safe; the file read is in buildVersionServer.ts.
 */
export const BUILD_PATH = "/api/burnticker/build";
export const STALE_PAGE_LINE = "This page is from an earlier version of the site. Reload to continue.";
export const RELOAD_LABEL = "Reload";
/** The custom event the launch page sends when its review opens (the check runs then too). */
export const VERSION_CHECK_EVENT = "bt:version-check";
/** At most one request per this many milliseconds. */
export const CHECK_EVERY_MS = 15_000;

/** A build id this check can compare: a real id, never a development placeholder or nothing. */
export const usableBuildId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(id) && id !== "development";

/** The line to show: only when both ids are real and differ. */
export function staleNotice(served: unknown, current: unknown): string | null {
  return usableBuildId(served) && usableBuildId(current) && served !== current ? STALE_PAGE_LINE : null;
}

/** Whether a check may run now (the last one is older than CHECK_EVERY_MS). */
export const mayCheck = (lastMs: number | null, nowMs: number): boolean => lastMs === null || nowMs - lastMs >= CHECK_EVERY_MS;
