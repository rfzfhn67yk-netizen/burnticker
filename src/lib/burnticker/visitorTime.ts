/**
 * HS-25 (sixth pass): ONE DATE HELPER FOR TIMES A VISITOR READS. Pages used to print "Denver time" for every visitor. Where the text
 * is rendered in the visitor's browser, a time is printed in the visitor's own zone with that zone named ("Oct 19, 4:16 PM MDT" for a
 * Denver visitor, "Oct 19, 11:16 PM BST" for a London one). Where the text is rendered on the server (metadata, API sentences, the
 * first paint of a page), the visitor's zone is unknown, so it is printed in UTC with "UTC" named. A bare day ("2026-11-14") stays a day
 * in either place, since a calendar date has no zone and moving it would put it on the evening before. Pure and client-safe.
 *
 * Client-rendered callers must only call it after mount (a value fetched in an effect, or a time ticking in state), never during the
 * server render of a client component, or the server's zone would be printed and the browser's render would differ.
 */
export type RenderedWhere = "client" | "server";

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar day as words ("Nov 14, 2026"), read as a date with no zone. Null when the value is not a YYYY-MM-DD day. */
export function dayText(day: string): string | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }).format(d);
}

/**
 * A moment as a visitor reads it. `where` says who renders the text; `timeZone` overrides the browser's zone (tests). `withYear`
 * adds the year. An unreadable value stays as given and null is a dash, so a caller never prints "Invalid Date".
 */
export function visitorTime(iso: string | number | null | undefined, where: RenderedWhere, o: { withYear?: boolean; timeZone?: string } = {}): string {
  if (iso === null || iso === undefined || iso === "") return "—";
  if (typeof iso === "string" && DAY_RE.test(iso)) return dayText(iso) ?? iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const base: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(o.withYear ? { year: "numeric" } : {}) };
  if (where === "server") return `${new Intl.DateTimeFormat("en-US", { ...base, timeZone: "UTC" }).format(d)} UTC`;
  return new Intl.DateTimeFormat("en-US", { ...base, timeZoneName: "short", ...(o.timeZone ? { timeZone: o.timeZone } : {}) }).format(d);
}
