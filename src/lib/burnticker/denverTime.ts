/**
 * QA-12 L10: a time on the trust page in Denver time with the zone named ("Oct 13, 2026, 9:43 PM MDT"), the operator's and the site's
 * clock, like the coin pages (coinPage.ts denverDay). A bare day ("2026-10-13") stays a day, since turning it into a Denver time would
 * move it to the evening before; an unreadable value stays as given; null is a dash. Pure and client-safe.
 */
export function denverTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
}
