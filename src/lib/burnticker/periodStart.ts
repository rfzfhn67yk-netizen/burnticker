/**
 * THE FIRST DAY OF A SETTLEMENT PERIOD (2026-10-28, $GASCAT's first weekly receipts). A receipt's `settledAt` is an ISO time (an
 * oracle's settlement to the second) or a feed period: a day "2026-10-08", a month "2026-08", an ISO week "2026-W10" or a quarter
 * "2026-Q3" (attestedHttp toPeriod). The keeper files every receipt under one UTC day (receiptDay): a month under its first day, and
 * so a week under its Monday and a quarter under its first day. Anything else is null, never a guess.
 */
const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" for a period or ISO time; null when it is neither. */
export function periodStartDay(at: string): string | null {
  const s = at.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  const w = /^(\d{4})-W(\d{2})$/.exec(s);
  if (w) {
    const year = Number(w[1]), week = Number(w[2]);
    if (week < 1 || week > 53) return null;
    const jan4 = Date.UTC(year, 0, 4), monday1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
    return new Date(monday1 + (week - 1) * 7 * DAY_MS).toISOString().slice(0, 10);
  }
  const q = /^(\d{4})-Q([1-4])$/.exec(s);
  if (q) return `${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, "0")}-01`;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

/** The period's first instant (UTC midnight of periodStartDay), or an ISO time's own instant; NaN when neither. */
export function periodStartMs(at: string): number {
  const s = at.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return Date.parse(s);
  const day = periodStartDay(s);
  return day === null ? NaN : Date.parse(`${day}T00:00:00Z`);
}

/** The ISO week ("2026-W10") a "YYYY-MM-DD" day falls in; the same arithmetic as attestedHttp toPeriod. */
export function isoWeekOf(day: string): string {
  const d = new Date(Date.parse(`${day}T00:00:00Z`)); const dayNum = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / DAY_MS - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The period string of the same kind as `like` ("2026-W10", "2026-Q3", "2026-08", "2026-10-08") that a "YYYY-MM-DD" day falls in. */
export function periodLike(day: string, like: string): string {
  if (/^\d{4}-W\d{2}$/.test(like)) return isoWeekOf(day);
  if (/^\d{4}-Q[1-4]$/.test(like)) return `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
  if (/^\d{4}-\d{2}$/.test(like)) return day.slice(0, 7);
  return day;
}
