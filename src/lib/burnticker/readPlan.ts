import { isOneShot, type BurnRule } from "@/lib/burnticker/rules";
import { readingsAfterLaunch } from "@/lib/burnticker/launchCut";

/**
 * THE KEEPER'S READ PLAN (owner 2026-10-19: "the keeper is only checking for results when it needs to"). Every selector used to be read
 * on a fixed cadence (a feed's pollEverySec, five minutes for a market) from launch until the coin was retired. Now each read is planned:
 *
 *   NEVER   a selector no live coin needs any more: every coin on it has had its rule end recorded, or is a one-shot (one market, one
 *           game, one launch, one milestone; rules.ts isOneShot) whose OWN result is recorded: a reading after that coin's baseline
 *           with a result receipt for that coin, never an older reading on the same selector (HB-29). selectorIdle says why.
 *   DUE     the adapter's `dueAt` (oracle/types.ts ResolvedSelector): the earliest moment a new result CAN exist. A game is read from
 *           shortly after its start every few minutes until the schedule marks it final, then once more at least five minutes
 *           later to confirm the final (owner 2026-10-20; sources/gameSettle.ts gameDueAt, finalCheck, gameSchedule); a team
 *           or rivalry coin at its next listed game; a market at its stated close (Kalshi close_time; Polymarket's Gamma end date, with
 *           Gamma's own closed flag checked hourly before it and no Polygon read until it closes). Honoured whether it is sooner or later
 *           than the selector's poll, never sooner than READ_PLAN_MIN_GAP_MS and never later than READ_PLAN_MAX_IDLE_MS (the schedule is
 *           looked at again at least weekly).
 *   WINDOW  a published feed whose record states when it publishes (sources.json `readWindow`): read at its poll inside the window
 *           until a read brings a new reading, then not again until the next window opens (Treasury's Debt to the Penny: business days
 *           after 15:00 Eastern; a "read once per complete UTC day" feed: shortly after 00:00 UTC).
 *   POLL    anything else: the selector's poll, as before.
 *
 * A failed read keeps the existing backoff (multiKeeper.ts fetchDue), except a windowed feed's (windowFailureNextAt, CH7-3). Pure and
 * client-safe.
 */

export const READ_PLAN_MIN_GAP_MS = 60_000;
export const READ_PLAN_MAX_IDLE_MS = 7 * 86_400_000;

/** When a published feed's new period can appear (sources.json `readWindow`). */
export interface ReadWindow {
  /** The publisher's clock: "UTC" or an IANA zone ("America/New_York"). */
  tz: string;
  /** Which local days the window opens: every day, or Monday to Friday (business days; a holiday costs one window of reads). */
  days: "all" | "weekdays";
  /** The local time the window opens, "HH:MM". */
  opensAt: string;
  /** How long the window stays open; inside it the feed is read at its poll until a read brings a new reading. */
  hours: number;
}

const H = 3_600_000, DAY = 86_400_000;

/** The zone's offset from UTC at an instant, in ms (local = utc + offset). */
export function tzOffsetMs(tz: string, utcMs: number): number {
  if (tz === "UTC") return 0;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute"), n("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant of a local wall time (the day's local midnight in `localDayMs`, a UTC-midnight timestamp, plus HH:MM). */
function localToUtc(tz: string, localDayMs: number, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const wall = localDayMs + (h || 0) * H + (m || 0) * 60_000;
  let utc = wall - tzOffsetMs(tz, wall);
  utc = wall - tzOffsetMs(tz, utc);   // a second pass settles a DST edge
  return utc;
}

const opensOn = (w: ReadWindow, localDayMs: number): boolean => { const d = new Date(localDayMs).getUTCDay(); return w.days === "all" || (d >= 1 && d <= 5); };

/** The window openings around `now` (UTC instants), from two local days back to eight ahead, in order. */
function openings(w: ReadWindow, now: number): number[] {
  const localNow = now + tzOffsetMs(w.tz, now);
  const today = Math.floor(localNow / DAY) * DAY;
  const out: number[] = [];
  for (let i = -2; i <= 8; i++) { const day = today + i * DAY; if (opensOn(w, day)) out.push(localToUtc(w.tz, day, w.opensAt)); }
  return out;
}

/** The window open at `now` (its opening instant), or null. */
export function openWindowAt(w: ReadWindow, now: number): number | null {
  for (const o of openings(w, now)) if (o <= now && now < o + w.hours * H) return o;
  return null;
}

/** The next window opening strictly after `now`. */
export function nextWindowOpen(w: ReadWindow, now: number): number {
  return openings(w, now).find((o) => o > now) ?? now + DAY;
}

/**
 * A windowed feed's next read after a good read: inside an open window that has not brought a new reading yet, one poll later (if that
 * is still inside it); otherwise the next opening.
 */
export function windowNextAt(w: ReadWindow, now: number, wroteNew: boolean, pollMs: number): number {
  const open = openWindowAt(w, now);
  if (open !== null && !wroteNew) { const t = now + pollMs; if (t < open + w.hours * H) return t; }
  return nextWindowOpen(w, now);
}

/**
 * CH7-3 (seventh pre-launch audit, HB-29 follow-up): A WINDOWED FEED'S FAILED READ. The once-a-day USGS read for $NEXTM6 timed out five
 * times from 00:30Z on 10-20; a failure streak in a window had no bound and no fallback later in the day (the doubling back-off went on
 * at its one-hour cap until the source answered). Now a failed read of a windowed feed is retried on a short
 * back-off (WINDOW_FAST_RETRIES tries, at most WINDOW_FAST_CAP_MS apart), then hourly while its window stays open, then once more in a
 * LATE window LATE_READ_AFTER_H after the opening (LATE_WINDOW_H long, hourly inside it), then at the next opening. That is about ten
 * requests on a day when every read fails, fewer than the plain doubling back-off made (it went on all day at its one-hour cap), so the
 * daily request budget holds. Pure; `fastMs(attempt)` is the keeper's back-off (burnKeeper/schedule.ts backoffMs).
 */
export const WINDOW_FAST_RETRIES = 4;
export const WINDOW_FAST_CAP_MS = 5 * 60_000;
export const WINDOW_RETRY_MS = H;
export const LATE_READ_AFTER_H = 12;
export const LATE_WINDOW_H = 2;
export function windowFailureNextAt(w: ReadWindow, now: number, failures: number, fastMs: (attempt: number) => number): number {
  if (failures <= WINDOW_FAST_RETRIES) return now + Math.min(WINDOW_FAST_CAP_MS, fastMs(Math.max(0, failures - 1)));
  const opens = openings(w, now);
  const spans = opens.flatMap((o) => [{ start: o, end: o + w.hours * H }, { start: o + LATE_READ_AFTER_H * H, end: o + (LATE_READ_AFTER_H + LATE_WINDOW_H) * H }]);
  for (const sp of spans) if (sp.start <= now && now < sp.end && now + WINDOW_RETRY_MS < sp.end) return now + WINDOW_RETRY_MS;
  const next = spans.map((sp) => sp.start).filter((t) => t > now).sort((a, b) => a - b)[0];
  return next ?? now + DAY;
}

/** The adapter's dueAt as the next read, bounded (null when the adapter gave none, or one already past). */
export function dueNextAt(dueAt: number | null | undefined, now: number): number | null {
  if (dueAt === null || dueAt === undefined || !Number.isFinite(dueAt)) return null;
  return Math.min(Math.max(dueAt, now + READ_PLAN_MIN_GAP_MS), now + READ_PLAN_MAX_IDLE_MS);
}

/** What selectorIdle reads from the registry (a stub without ruleEnd, readings or receipt is read as "nothing recorded", so it is read). */
export interface IdleRegistry<T> {
  ruleEnd?(mint: string): unknown;
  /** the selector's readings settled after `sinceIso` (registry.ts readings: settled_at > sinceIso) */
  readings?(key: string, sinceIso?: string | null): readonly { id: string; at?: string; proof?: string | null; fetchedAt?: number | null }[];
  /** this coin's receipt for one reading (receipts are keyed by mint and event id; readings by selector) */
  receipt?(mint: string, eventId: string): { kind?: string | null; status?: string | null } | null;
  lockedRule(t: T): { rule: BurnRule };
}

/** The rule's end receipts follow a result and never are one (multiKeeper.ts END_KINDS). */
const END_RECEIPT_KINDS = new Set(["winddown", "drain", "sweep"]);

/**
 * HB-29 (continuous audit 2026-10-19): HAS THIS COIN'S OWN ONE-SHOT RESULT BEEN RECORDED? Only a reading settled after the coin's own
 * baselineAt (registry.readings(key, baselineAt), the window planToken plans from) with a result receipt for THIS coin counts: that
 * reading settled the coin's rule (multiKeeper.ts detectRuleEnd reads the same receipt). HB-64 (sixth-pass audit 2026-10-19): a pair
 * receipt still waiting for its other pool ("pending-pair") counts too: the result is recorded, and what it waits for is the pair's pools
 * (multiKeeper.ts pairGates makes it planned or voided), never another read of the source; the program's own read of the result's UTC
 * day is still planned by attestReadAt once the receipt is pending execution. Readings on the same selector from before the coin launched (an earlier coin's result, a rehearsal, or the
 * history a first read brings back: the live $NEXTM6's first read stored ten magnitude-6 days from before its launch) never decide it.
 * A derby one-shot keeps its boundary samples in the readings table and a recurring rule never resolves once, so neither is decided by
 * its readings, only by its recorded rule end.
 */
export function oneShotDecided<T extends { mint: string; baselineAt?: string | null }>(reg: IdleRegistry<T>, key: string, t: T, rule: BurnRule): boolean {
  if (rule.oracle === "derby" || !isOneShot({ market: rule.market, oracle: rule.oracle, derby: rule.derby, series: rule.series })) return false;
  if (!reg.readings || !reg.receipt || !t.baselineAt) return false;
  try {
    // the launch-day cut (launchCut.ts): a game reading keyed by the launch's own UTC day is judged by its games, not as text
    return readingsAfterLaunch({ readings: reg.readings.bind(reg) }, key, t.baselineAt).some((r) => {
      const b = reg.receipt!(t.mint, r.id);
      return !!b && !END_RECEIPT_KINDS.has(b.kind ?? "");
    });
  } catch { return false; }
}

/**
 * HB-48: DOES THIS COIN HOLD A SETTLEMENT RECEIPT? Judged from the coin's own receipts alone, never the selector's readings, so it can
 * check the read plan's idle verdict instead of repeating it: a result receipt, not an end receipt (a pair receipt waiting for its other
 * pool is a recorded result, HB-64). A one-shot without one has a result that is still open, whatever the plan says.
 */
export function hasSettlementReceipt(rows: readonly { kind?: string | null; status?: string | null }[]): boolean {
  return rows.some((b) => !END_RECEIPT_KINDS.has(b.kind ?? ""));
}

/**
 * Why a selector needs no read at all, or null when it does: every coin on it has had its rule end recorded, or every coin on it that
 * has not is a one-shot whose OWN result is recorded (oneShotDecided). A selector shared by several coins is read while any one of them
 * is undecided (HB-29).
 */
export function selectorIdle<T extends { mint: string; baselineAt?: string | null }>(reg: IdleRegistry<T>, key: string, tokens: readonly T[]): string | null {
  if (!tokens.length) return "no live coin uses it";
  const ended = (m: string): boolean => { try { const e = reg.ruleEnd?.(m); return e !== null && e !== undefined; } catch { return false; } };
  if (tokens.every((t) => ended(t.mint))) return "every coin on it has ended its rule";
  for (const t of tokens) {
    if (ended(t.mint)) continue;
    let rule: BurnRule;
    try { rule = reg.lockedRule(t).rule; } catch { return null; }
    if (!oneShotDecided(reg, key, t, rule)) return null;
  }
  return tokens.length > 1 ? "every coin on it is a one-shot whose own result is recorded" : "a one-shot whose own result is recorded";
}

/**
 * HB-28 / HB-29: the next read the pages print. The keeper does not read an idle selector on a schedule (multiKeeper.ts fetchDue skips
 * it), so a nextFetchAt left behind in feed_state is not a next read: null then. Otherwise the stored next read, which the keeper keeps.
 */
export function plannedNextCheckAt<T extends { mint: string; baselineAt?: string | null }>(reg: IdleRegistry<T>, key: string, tokens: readonly T[], nextFetchAt: number | null): number | null {
  if (nextFetchAt === null) return null;
  try { return selectorIdle(reg, key, tokens) ? null : nextFetchAt; } catch { return nextFetchAt; }
}
