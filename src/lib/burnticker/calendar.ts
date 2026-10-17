import type { BurnRule } from "@/lib/burnticker/rules";
import { isMeetingOf, parseEspnSeries, seasonYearAt, type Game, type MeetingsSeries } from "@/lib/burnticker/sources/espn";
import { firingOf } from "@/lib/burnticker/simulator";
import { isBusinessDay, nextBusinessDay } from "@/lib/launch/dailyPost";
import type { TeamSeasonReader } from "@/lib/burnticker/lastSeason";

/**
 * THE BURN CALENDAR (cheap-features pass item 2, owner 2026-10-13). The next scheduled readings of one coin, from the schedule readers
 * that exist, and the same list as an iCalendar file:
 *
 *   team coin       the next five games inside the rule's window, from the league's own schedule (the platform's teamSeason port:
 *                   MLB StatsAPI, the NHL feed, the NBA feed or TheSportsDB with its key; never ESPN)
 *   Treasury feed   the next five business days, each a day the Treasury can post a reading (dailyPost.ts business days)
 *   any other coin  the status record's next check and, for a one-market coin, the market's end (tokenPage.ts status.next)
 *
 * A reading on the calendar is a time a result can arrive, not a burn: a burn needs a qualifying result and a graduated, registered
 * pool. Pure apart from the reader port; the API route (GET /v1/coins/{mint}/calendar and /calendar.ics) supplies the token's status.
 */
export const CALENDAR_MAX = 5;
export type CalendarKind = "game" | "reading-day" | "next-check" | "market-end";
export interface CalendarEntry { id: string; kind: CalendarKind; at: string | null; day: string; allDay: boolean; title: string; detail: string }
export interface CoinCalendar {
  ticker: string; mint: string; page: string; source: "schedule" | "business-days" | "status" | "none";
  entries: CalendarEntry[]; note: string; ics: string;
}
export interface CalendarInput {
  ticker: string; mint: string; page: string; ics: string; rule: BurnRule;
  /** the status record's next check and market end (tokenPage.ts status.next), when there is one */ next?: { nextCheckAt: string | null; nextCloseTime: string | null } | null;
  /** the platform's team schedule port (absent: a team coin answers from its status record only) */ teamSeason?: TeamSeasonReader | null;
  now?: number; timeoutMs?: number;
}

const NOTE = "Each entry is a time a result can arrive. A burn happens only when the result is the one the rule burns on, and only after the coin has graduated and its pool is registered.";

/** The upcoming games of a team rule's window (first CALENDAR_MAX). */
export function upcomingGamesFor(rule: BurnRule, games: readonly Game[], now: number): Game[] {
  const e = rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series) : null;
  if (!e) return [];
  const open = (g: Game) => !g.completed && Date.parse(g.startsAt) > now - 3 * 3_600_000 && !/postpon|cancel/i.test(g.detail ?? "");
  const sorted = [...games].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  let inWindow: Game[];
  if (e.kind === "game") inWindow = sorted.filter((g) => g.eventId === e.eventId);
  else {
    const w = e.window;
    if (w.kind === "post" || (w.kind === "legacy" && w.scope === "post")) inWindow = sorted.filter((g) => g.seasonType === 3);
    else if (w.kind === "legacy" && w.scope === "reg") inWindow = sorted.filter((g) => g.seasonType !== 3);
    else if (w.kind === "meetings") inWindow = sorted.filter((g) => isMeetingOf(e as MeetingsSeries, g));
    else if (w.kind === "next") { const from = `${w.from.slice(0, 4)}-${w.from.slice(4, 6)}-${w.from.slice(6)}`; inWindow = sorted.filter((g) => g.date >= from).slice(0, w.n); }
    else inWindow = sorted;
  }
  return inWindow.filter(open).slice(0, CALENDAR_MAX);
}

/** The season year to read for a team rule (a season or postseason rule names its own). */
const yearOf = (rule: BurnRule, now: number): number | null => {
  const e = rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series) : null;
  if (!e) return null;
  if (e.kind === "team" && (e.window.kind === "season" || e.window.kind === "post" || e.window.kind === "meetings")) return e.window.year;
  return seasonYearAt(e.league, now);
};

export async function coinCalendar(i: CalendarInput): Promise<CoinCalendar> {
  const now = i.now ?? Date.now();
  const base = { ticker: i.ticker, mint: i.mint, page: i.page, ics: i.ics, note: NOTE };
  const fires = firingOf(i.rule).firesOn;
  const e = i.rule.oracle === "catalogue" && i.rule.series ? parseEspnSeries(i.rule.series) : null;
  if (e && i.teamSeason) {
    const year = yearOf(i.rule, now)!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const key = e.kind === "team" && e.teamId ? e.teamId : e.abbr;
    try {
      const games = await Promise.race([i.teamSeason(e.league, key, year), new Promise<null>((res) => { timer = setTimeout(() => res(null), i.timeoutMs ?? 3_000); })]);
      if (games) {
        const up = upcomingGamesFor(i.rule, games, now);
        return { ...base, source: "schedule", entries: up.map((g) => ({ id: `game-${g.eventId}`, kind: "game" as const, at: g.startsAt, day: g.date, allDay: false, title: `$${i.ticker}: ${g.name}`, detail: `This coin burns on ${fires}. The result is read after the game is final.` })) };
      }
    } catch { /* the status record below */ } finally { clearTimeout(timer); }
  }
  if (i.rule.oracle === "catalogue" && /^treasury\./.test(i.rule.series ?? "")) {
    const days: string[] = [];
    let d = new Date(now).toISOString().slice(0, 10);
    if (!isBusinessDay(d)) d = nextBusinessDay(d);
    while (days.length < CALENDAR_MAX) { days.push(d); d = nextBusinessDay(d); }
    return { ...base, source: "business-days", entries: days.map((day) => ({ id: `reading-${day}`, kind: "reading-day" as const, at: null, day, allDay: true, title: `$${i.ticker}: Treasury reading day`, detail: `The Treasury posts a reading on each business day. This coin burns on ${fires}.` })) };
  }
  const entries: CalendarEntry[] = [];
  const n = i.next ?? null;
  if (n?.nextCheckAt && Date.parse(n.nextCheckAt) >= now - 3_600_000) entries.push({ id: `check-${n.nextCheckAt.slice(0, 16)}`, kind: "next-check", at: n.nextCheckAt, day: n.nextCheckAt.slice(0, 10), allDay: false, title: `$${i.ticker}: next reading`, detail: `The keeper reads the source again at this time. This coin burns on ${fires}.` });
  if (n?.nextCloseTime && Date.parse(n.nextCloseTime) >= now - 3_600_000) entries.push({ id: `end-${n.nextCloseTime.slice(0, 16)}`, kind: "market-end", at: n.nextCloseTime, day: n.nextCloseTime.slice(0, 10), allDay: false, title: `$${i.ticker}: the market's end`, detail: `The result is read once the market settles. This coin burns on ${fires}.` });
  return { ...base, source: entries.length ? "status" : "none", entries, ...(entries.length ? {} : { note: `No next reading is scheduled for this coin. ${NOTE}` }) };
}

// ---- iCalendar (RFC 5545) ----

const icsText = (s: string): string => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsTime = (iso: string): string => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsDay = (day: string): string => day.replace(/-/g, "");
const nextDay = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
/** Folds a content line at 75 octets (RFC 5545 3.1). */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** The calendar as an .ics file: one VEVENT per entry, games three hours long, a next check half an hour, reading days all day. */
export function calendarIcs(c: CoinCalendar, o: { origin: string; now?: number }): string {
  const stamp = icsTime(new Date(o.now ?? Date.now()).toISOString());
  const url = `${o.origin.replace(/\/$/, "")}${c.page}`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Burnticker//Burn calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsText(`$${c.ticker} readings`)}`];
  for (const e of c.entries) {
    lines.push("BEGIN:VEVENT", `UID:${e.id}.${c.mint}@burnticker`, `DTSTAMP:${stamp}`);
    if (e.allDay || !e.at) lines.push(`DTSTART;VALUE=DATE:${icsDay(e.day)}`, `DTEND;VALUE=DATE:${icsDay(nextDay(e.day))}`);
    else { const len = e.kind === "game" ? 3 * 3_600_000 : 30 * 60_000; lines.push(`DTSTART:${icsTime(e.at)}`, `DTEND:${icsTime(new Date(Date.parse(e.at) + len).toISOString())}`); }
    lines.push(`SUMMARY:${icsText(e.title)}`, `DESCRIPTION:${icsText(`${e.detail} ${c.note}`)}`, `URL:${url}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
