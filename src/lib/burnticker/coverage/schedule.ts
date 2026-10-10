import { addDays, isoDay, toPeriod, type HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import type { ScheduleKind } from "@/lib/burnticker/coverage/types";

/**
 * PUBLICATION SCHEDULES (2026-10-10, the settlement-coverage audit). What a source is EXPECTED to publish, estimated from its config's
 * period kind and cadence — never invented where the source has no schedule:
 *
 *   daily          count series zero-filled per UTC day (flares, launches, asteroid passes) and daily value series (page views): every
 *                  complete day; a day is complete `completeAfterDays` (default 1) after it ends
 *   business-days  value series whose cadence says "business days" (Debt to the Penny): weekdays that are not U.S. federal holidays
 *                  (observed dates); record date D is expected by 21:00 UTC of the next business day
 *   weekly         ISO weeks, expected 3 days after the week ends
 *   monthly        month M expected by the 20th of month M+1 (BLS / FRED monthly releases land between the 1st and the 15th)
 *   quarterly      expected 60 days after the quarter ends
 *   none           snapshots (one value at poll time), event-driven counts without zero-fill (a day without an event has no row),
 *                  page scrapes without a period: the dry run reports n/a, not a made-up rate
 */

export interface Schedule { kind: ScheduleKind; basis: string }

export function scheduleOf(cfg: HttpSourceConfig): Schedule {
  const S = cfg.select, P = cfg.period;
  if (S.snapshot) return { kind: "none", basis: "snapshot: one value at poll time, no publication schedule" };
  if (P.format === "none") return { kind: "none", basis: "no period in the data (a page read at poll time)" };
  if (P.kind === "day") {
    if (S.count && P.zeroFill === false) return { kind: "none", basis: "event-driven: a day without an event has no row, so an absent day is not a miss" };
    if (!S.count && /business day/i.test(cfg.cadence)) return { kind: "business-days", basis: "weekdays that are not U.S. federal holidays (observed); record date D due by 21:00 UTC the next business day" };
    return { kind: "daily", basis: `every UTC day, complete ${P.completeAfterDays ?? 1} day(s) after it ends${S.count && P.zeroFill !== false ? " (zero-filled: an absent day reads as 0, so the hit rate measures the read, not the publisher)" : ""}` };
  }
  if (P.kind === "week") return { kind: "weekly", basis: "ISO weeks, due 3 days after the week ends" };
  if (P.kind === "month") return { kind: "monthly", basis: "month M due by the 20th of month M+1" };
  return { kind: "quarterly", basis: "quarter Q due 60 days after it ends" };
}

// ---- U.S. federal holidays (observed) ----

const nthWeekday = (y: number, m: number, wd: number, n: number): string => { const d = new Date(Date.UTC(y, m, 1)); const off = (wd - d.getUTCDay() + 7) % 7; return new Date(Date.UTC(y, m, 1 + off + (n - 1) * 7)).toISOString().slice(0, 10); };
const lastWeekday = (y: number, m: number, wd: number): string => { const d = new Date(Date.UTC(y, m + 1, 0)); const off = (d.getUTCDay() - wd + 7) % 7; return new Date(Date.UTC(y, m + 1, -off)).toISOString().slice(0, 10); };
const observed = (day: string): string => { const wd = new Date(`${day}T00:00:00Z`).getUTCDay(); return wd === 6 ? addDays(day, -1) : wd === 0 ? addDays(day, 1) : day; };

export function usFederalHolidays(y: number): Set<string> {
  const fixed = [`${y}-01-01`, `${y}-06-19`, `${y}-07-04`, `${y}-11-11`, `${y}-12-25`].map(observed);
  return new Set([...fixed, nthWeekday(y, 0, 1, 3), nthWeekday(y, 1, 1, 3), lastWeekday(y, 4, 1), nthWeekday(y, 8, 1, 1), nthWeekday(y, 9, 1, 2), nthWeekday(y, 10, 4, 4), observed(`${y + 1}-01-01`)]);
}
export function isBusinessDay(day: string): boolean {
  const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
  return wd !== 0 && wd !== 6 && !usFederalHolidays(Number(day.slice(0, 4))).has(day);
}
export const nextBusinessDay = (day: string): string => { let d = addDays(day, 1); while (!isBusinessDay(d)) d = addDays(d, 1); return d; };

// ---- periods ----

const weekOf = (day: string): string => toPeriod(day, { path: "", format: "yyyy-mm-dd" }, "week")!;
const monthAdd = (m: string, n: number): string => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const quarterEndDay = (q: string): string => new Date(Date.UTC(Number(q.slice(0, 4)), Number(q.slice(6)) * 3, 0)).toISOString().slice(0, 10);

/** When a period's publication is due (ms), per schedule. */
export function dueAt(kind: ScheduleKind, period: string, completeAfterDays = 1): number | null {
  switch (kind) {
    // parseBody reads day D once today − completeAfterDays ≥ D: due at 00:00 UTC of D + completeAfterDays.
    case "daily": return Date.parse(`${addDays(period, completeAfterDays)}T00:00:00Z`);
    case "business-days": return Date.parse(`${nextBusinessDay(period)}T21:00:00Z`);
    case "weekly": { const m = /^(\d{4})-W(\d{2})$/.exec(period); if (!m) return null; const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4)); const monday = Date.UTC(Number(m[1]), 0, 4 - ((jan4.getUTCDay() + 6) % 7) + (Number(m[2]) - 1) * 7); return monday + 10 * 86_400_000; }
    case "monthly": return Date.parse(`${monthAdd(period, 1)}-20T00:00:00Z`);
    case "quarterly": return Date.parse(`${addDays(quarterEndDay(period), 60)}T00:00:00Z`);
    default: return null;
  }
}

/** The end of a period (ms): the moment the event it records is over. */
export function periodEndMs(period: string): number | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) return Date.parse(`${addDays(period, 1)}T00:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(period)) return Date.parse(`${monthAdd(period, 1)}-01T00:00:00Z`);
  if (/^\d{4}-Q[1-4]$/.test(period)) return Date.parse(`${addDays(quarterEndDay(period), 1)}T00:00:00Z`);
  const w = dueAt("weekly", period); return w === null ? null : w - 3 * 86_400_000;
}

/**
 * The periods a source was expected to publish with their due time inside [fromMs, toMs]. For day schedules the period itself must lie in
 * the window; for longer ones the due date must. `firstObservable` (the earliest period the read returns) trims what one read cannot see.
 */
export function expectedPeriods(cfg: HttpSourceConfig, fromMs: number, toMs: number, firstObservable: string | null = null): string[] {
  const s = scheduleOf(cfg);
  const cad = cfg.period.completeAfterDays ?? 1;
  const out: string[] = [];
  const fromDay = isoDay(fromMs);
  if (s.kind === "daily" || s.kind === "business-days") {
    for (let d = fromDay; d <= isoDay(toMs); d = addDays(d, 1)) {
      if (s.kind === "business-days" && !isBusinessDay(d)) continue;
      const due = dueAt(s.kind, d, cad);
      if (due !== null && due <= toMs) out.push(d);
    }
  } else if (s.kind === "weekly") {
    const seen = new Set<string>();
    for (let d = addDays(fromDay, -14); d <= isoDay(toMs); d = addDays(d, 1)) { const w = weekOf(d); if (seen.has(w)) continue; seen.add(w); const due = dueAt("weekly", w); if (due !== null && due >= fromMs && due <= toMs) out.push(w); }
  } else if (s.kind === "monthly") {
    for (let m = monthAdd(fromDay.slice(0, 7), -2); m <= isoDay(toMs).slice(0, 7); m = monthAdd(m, 1)) { const due = dueAt("monthly", m)!; if (due >= fromMs && due <= toMs) out.push(m); }
  } else if (s.kind === "quarterly") {
    for (let m = monthAdd(fromDay.slice(0, 7), -6); m <= isoDay(toMs).slice(0, 7); m = monthAdd(m, 3)) { const q = toPeriod(`${m}-01`, { path: "", format: "yyyy-mm-dd" }, "quarter")!; const due = dueAt("quarterly", q)!; if (due >= fromMs && due <= toMs && !out.includes(q)) out.push(q); }
  }
  return firstObservable ? out.filter((p) => p >= firstObservable) : out;
}

/** When the reading after `lastPeriod` is expected, with the basis; null for sources without a schedule. */
export function nextExpected(cfg: HttpSourceConfig, lastPeriod: string | null, nowMs: number): { at: string | null; basis: string } {
  const s = scheduleOf(cfg);
  if (cfg.select.snapshot) { const next = Date.parse(`${addDays(isoDay(nowMs), 1)}T00:00:00Z`); return { at: new Date(next).toISOString(), basis: "snapshot: the day's value is recorded once the UTC day closes" }; }
  if (s.kind === "none") return { at: null, basis: s.basis };
  const cad = cfg.period.completeAfterDays ?? 1;
  let next: string | null = null;
  if (lastPeriod === null) return { at: null, basis: "no reading yet" };
  if (s.kind === "daily") next = addDays(lastPeriod, 1);
  else if (s.kind === "business-days") next = nextBusinessDay(lastPeriod);
  else if (s.kind === "weekly") { const due = dueAt("weekly", lastPeriod); next = due === null ? null : weekOf(isoDay(due)); }
  else if (s.kind === "monthly") next = monthAdd(lastPeriod, 1);
  else if (s.kind === "quarterly") { const qe = quarterEndDay(lastPeriod); next = toPeriod(addDays(qe, 1), { path: "", format: "yyyy-mm-dd" }, "quarter"); }
  const due = next ? dueAt(s.kind, next, cad) : null;
  return { at: due === null ? null : new Date(due).toISOString(), basis: `${next} (${s.basis})` };
}
