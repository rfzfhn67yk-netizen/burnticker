/**
 * The CSP report counter (prelaunch audit F-28), kept OUT of csp.ts: next.config.ts imports csp.ts and Next's config transpiler cannot
 * follow a project import from there (publish 81 failed with MODULE_NOT_FOUND on "@/lib/burnticker/lru"). This module may import freely.
 */
import { LruMap } from "@/lib/burnticker/lru";
import { CSP_REPORT_DIRECTIVES, reportDirective } from "@/lib/burnticker/csp";

/** The counter never holds more than this many keys (the allow-list, "other" and "unknown" fit with room to spare). */
export const CSP_REPORT_MAX_KEYS = 64;
/** The route's counts since the process started, by directive (bounded: LruMap; keys only from CSP_REPORT_DIRECTIVES, "other", "unknown"). */
export const cspReportCounts: LruMap<string, number> = new LruMap(CSP_REPORT_MAX_KEYS);
/** Counts one report and answers the key it was counted under. */
export function countCspReport(body: unknown): string {
  const d = reportDirective(body);
  const key = d === "unknown" || CSP_REPORT_DIRECTIVES.has(d) ? d : "other";
  cspReportCounts.set(key, (cspReportCounts.get(key) ?? 0) + 1);
  return key;
}

