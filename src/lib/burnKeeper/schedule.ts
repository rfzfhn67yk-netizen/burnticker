/**
 * WHEN THE KEEPER POLLS (SPEC §2: 16:30 ET and again 20:00 ET; and on start). Pure.
 *
 * Treasury posts each business day's figure the following afternoon ET; 16:30 catches the usual posting, 20:00 catches a late one.
 * The clock is America/New_York because that is Treasury's clock — the VPS runs in Denver time for the owner's logs (2026-09-05),
 * so the ET wall time is derived with Intl, never from the process's local zone, and DST is whatever the zone database says.
 */

export interface WallTime { y: number; m: number; d: number; hh: number; mm: number }

/** The wall clock in `timeZone` at `ms`. */
export function wallTime(ms: number, timeZone: string): WallTime {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour") % 24, mm: get("minute") };
}

/** The UTC instant of wall time (y-m-d hh:mm) in `timeZone` (two-pass offset fit; exact outside the DST gap hour). */
export function zonedToUtc(w: WallTime, timeZone: string): number {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const seen = wallTime(t, timeZone);
    const seenUtc = Date.UTC(seen.y, seen.m - 1, seen.d, seen.hh, seen.mm);
    t += guess - seenUtc;
  }
  return t;
}

/** The next poll strictly after `now` among `polls` ("HH:MM", in `timeZone`), any day of the week (a quiet poll costs nothing). */
export function nextPollAt(now: number, polls: readonly string[], timeZone = "America/New_York"): number {
  const today = wallTime(now, timeZone);
  let best = Infinity;
  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    const base = new Date(Date.UTC(today.y, today.m - 1, today.d + dayOffset));
    for (const p of polls) {
      const [hh, mm] = p.split(":").map(Number);
      const t = zonedToUtc({ y: base.getUTCFullYear(), m: base.getUTCMonth() + 1, d: base.getUTCDate(), hh, mm }, timeZone);
      if (t > now && t < best) best = t;
    }
  }
  return best;
}

/** The calendar date (YYYY-MM-DD) in `timeZone` — "burns today / this month" are counted on Treasury's clock. */
export function dateIn(ms: number, timeZone = "America/New_York"): string {
  const w = wallTime(ms, timeZone);
  return `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

/** Backoff for retries: 15 s, 30 s, 1 min, 2 min … capped at `capMs` (default 1 h — the spec's "retry hourly" for a feed outage). */
export function backoffMs(attempt: number, capMs = 3_600_000): number {
  return Math.min(capMs, 15_000 * 2 ** Math.max(0, attempt));
}
