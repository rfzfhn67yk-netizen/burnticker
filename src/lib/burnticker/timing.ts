import type { BurnRule } from "@/lib/burnticker/rules";
import { parseEspnSeries } from "@/lib/burnticker/sources/espn";

/**
 * TIMING GUARDRAILS FOR ONE-TIME RESULTS (ChatGPT audit 7 items 7 and 11, 2026-10-12). Client-safe; the review route and the page read it.
 *
 *   the game     a one-game rule's due date is the game the rule names (its ESPN event id), never "the next meeting" of the two teams
 *                (picking Tue Oct 13 CLE-TB produced "due around Oct 20"); a playoff game the schedule marks "if necessary" says so
 *   unplayed     a game that is not played voids the rule: neither coin burns on it, and each pool burns down on its own coin
 *   due soon     a one-time result due within DUE_WARNING_DAYS (default 14, BURNTICKER_DUE_WARNING_DAYS) carries the graduation warning.
 *                The words follow the keeper (beforeGraduationLine, endSinkKeeper.ts): a result that comes before graduation is recorded
 *                and its burn waits for the coin's pool; it is not lost and nothing is sent anywhere early.
 */
export const DUE_WARNING_DAYS_DEFAULT = 14;
export const dueWarningDays = (env: Readonly<Record<string, string | undefined>> = {}): number => { const n = Number(env.BURNTICKER_DUE_WARNING_DAYS); return Number.isInteger(n) && n >= 1 && n <= 90 ? n : DUE_WARNING_DAYS_DEFAULT; };
export interface ScheduledGame { eventId: string; startsAt: string; name?: string; detail?: string | null; notes?: string | null }

/** The game a one-game rule names, from a schedule (null when the rule is not one game, or the schedule does not list it). */
export function gameOfRule<G extends ScheduledGame>(rule: Pick<BurnRule, "oracle" | "series">, games: readonly G[]): G | null {
  const e = rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series) : null;
  if (!e || e.kind !== "game") return null;
  return games.find((g) => g.eventId === e.eventId) ?? null;
}
/** A playoff game the schedule marks as played only if needed ("Game 5 *if necessary"). */
export const ifNecessary = (g: Pick<ScheduledGame, "detail" | "notes" | "name">): boolean => /if\s+necessary/i.test(`${g.detail ?? ""} ${g.notes ?? ""} ${g.name ?? ""}`);
/** "Tue, Oct 13, 2026", and " (if necessary)" for such a game. */
export function gameDueLabel(g: ScheduledGame): string {
  const d = new Date(g.startsAt);
  const day = Number.isNaN(d.getTime()) ? g.startsAt.slice(0, 10) : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" });
  return `${day}${ifNecessary(g) ? " (if necessary)" : ""}`;
}
export const UNPLAYED_GAME_LINE = "If the game is not played, the result is void: neither coin burns on it, and each coin's pool burns down on its own coin over four weeks.";
export const dueSoonLine = (days: number): string => `This result is due within ${days} ${days === 1 ? "day" : "days"}. A coin burns only after it graduates: if the result comes first, it is recorded and the burn waits until the coin graduates and its pool is registered.`;
/**
 * HB-141 (hourly run 12): on a one-time coin the review's note already says that a coin burns only after it graduates (beforeGraduationLine),
 * so the due-soon warning keeps only its first sentence there; "a coin burns only after it graduates" was said three times in six lines.
 */
export const dueSoonShort = (w: string): string => (/^This result is due within \d+ days?\. /.test(w) ? w.slice(0, w.indexOf(". ") + 1) : w);

/** Days until a due date (rounded up, never negative), and the warning when it is within the window. */
/**
 * Audit 12 item 8: a scheduled close that has already passed is not "due": the market may still be waiting for its result (the source has
 * not settled it), so it is said as that, never as a future date. Whether such a market can still take a coin is the source's own state
 * (an unresolved market stays listed); this line only stops the review calling a past time "due".
 */
export const CLOSE_PASSED_LINE = "The scheduled close has passed and the result is not published yet. The market is waiting for its result. A coin made now burns only after it graduates, so the result may well come first: it is recorded, and the burn waits until the coin graduates and its pool is registered.";
export function dueTiming(dueIso: string | null, now: number, warnDays = DUE_WARNING_DAYS_DEFAULT): { dueAt: string | null; dueWithinDays: number | null; warning: string | null; closePassed?: boolean } {
  const t = dueIso ? Date.parse(dueIso) : NaN;
  if (!Number.isFinite(t)) return { dueAt: null, dueWithinDays: null, warning: null };
  if (t < now) return { dueAt: new Date(t).toISOString(), dueWithinDays: 0, warning: CLOSE_PASSED_LINE, closePassed: true };
  const days = Math.max(0, Math.ceil((t - now) / 86_400_000));
  return { dueAt: new Date(t).toISOString(), dueWithinDays: days, warning: days <= warnDays ? dueSoonLine(days) : null };
}
