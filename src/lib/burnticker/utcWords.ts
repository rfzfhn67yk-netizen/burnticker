/**
 * DATES IN USER PROSE (prelaunch audit 2026-10-18, optional polish): a sentence a person reads says "16 October 2026, 13:38 UTC", never
 * "2026-10-16T13:38Z" or "2026-10-16Z". Machine forms stay where machines read them (data attributes, <time dateTime>, JSON, receipt
 * titles that are parsed, the operator pages). Spelled out by hand rather than with Intl, so the server, the browser and the static
 * pages print the same words. Pure; client-safe. Input that is not a date comes back unchanged, so a bad value is visible, not hidden.
 */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(v: string | number | Date): Date | null {
  const d = v instanceof Date ? v : typeof v === "number" ? new Date(v) : new Date(DAY_ONLY.test(v) ? `${v}T12:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "16 October 2026": the UTC calendar day of an instant, or a "YYYY-MM-DD" day as written. */
export function utcDay(v: string | number | Date | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const d = toDate(v);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : String(v);
}

/** "16 October 2026, 13:38 UTC": an instant to the minute, naming UTC. A bare "YYYY-MM-DD" day has no time, so it reads as utcDay. */
export function utcDateTime(v: string | number | Date | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string" && DAY_ONLY.test(v)) return utcDay(v);
  const d = toDate(v);
  if (!d) return String(v);
  const hh = String(d.getUTCHours()).padStart(2, "0"), mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${utcDay(d)}, ${hh}:${mm} UTC`;
}
