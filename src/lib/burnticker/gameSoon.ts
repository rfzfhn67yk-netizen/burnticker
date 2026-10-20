import { utcDay } from "@/lib/burnticker/utcWords";

/**
 * HS-44 (hourly run 8, launch-critical): a one-game pair launched days before its game. The review said "This result is due within 1 day"
 * and kept, in two collapsed blocks, that the result burns only if both coins raise their SOL and register pools by the void date. When
 * the game is under 7 days away, one line says it plainly above Connect wallet and in the server review's warnings. The day word and the
 * void date are computed; nothing else in it is a date. Pure, client-safe.
 */
export const GAME_SOON_DAYS = 7;
const DENVER_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" });
const dayNumber = (ms: number): number => Math.round(Date.parse(`${DENVER_DAY.format(new Date(ms))}T00:00:00Z`) / 86_400_000);
/** "today", "tomorrow" or "in N days" by the Denver calendar, or null when the game has started or is 7 or more days away. */
export function gameDayWord(startsAt: string, now: number): string | null {
  const at = Date.parse(startsAt);
  if (!Number.isFinite(at) || at <= now) return null;
  const d = dayNumber(at) - dayNumber(now);
  if (d >= GAME_SOON_DAYS) return null;
  return d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
}
export function gameSoonLine(o: { startsAt: string | null | undefined; now: number; raiseSol: string; voidBy: string | null | undefined }): string | null {
  if (!o.startsAt || !o.voidBy) return null;
  const word = gameDayWord(o.startsAt, o.now);
  if (!word) return null;
  return `This game is ${word}. The result is recorded either way, but it burns only if both coins raise ${o.raiseSol} SOL and register pools by ${utcDay(o.voidBy)}. If they do not, the pair is void and each coin burns down its own pool.`;
}
