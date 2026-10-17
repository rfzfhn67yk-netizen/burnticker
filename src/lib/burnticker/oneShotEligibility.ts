import { KEEPER_ONE_SHOT_RE, NEXT_EVENT_ONE_SHOT_RE } from "@/lib/burnticker/inverse";
import { nhcSeasonOpen, parseNhcSeries } from "@/lib/burnticker/sources/nhc";
import { jsonOne, parseBody, type HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import { milestoneProblem, parseGithubSeries } from "@/lib/burnticker/sources/github";
import { parseLl2Series } from "@/lib/burnticker/sources/launchLibrary";

/**
 * ALREADY DECIDED (intent audit 2, item 2, 2026-10-12: the catalogue offered "Launch 7d1afb26… succeeds", a Starship flight that had
 * already succeeded on 2026-09-28, as if its result were still to come). ONE eligibility check for every one-time catalogue series
 * (inverse.ts KEEPER_ONE_SHOT_RE: a named launch, a GitHub star milestone, a YouTube milestone) and ONE refusal sentence, used by the
 * catalogue listing (api/handlers.ts catalogueSources), the review (runBacktest's refusals) and the creation preflight
 * (coverage/preflight.ts, code "already-decided"). The first snow (a native source) uses the same sentence from its own preflight.
 *
 * WHY REFUSED, from the keeper (multiKeeper.ts planToken / detectRuleEnd): a coin plans only readings after its own launch time, and a
 * one-time coin ends on its first receipt. A coin created after the result therefore never burns on it, and with no receipt it never
 * reaches its end either: its fees build up under a rule that has nothing left to read. Retrospective coins are refused by default
 * (an owner decision to revisit, not a mechanic).
 *
 * Client-safe apart from the parser (pure).
 */

export const ALREADY_DECIDED_SENTENCE = "This one-time event already has its result, so a new coin on it is not offered. A coin only counts results that come after its launch, so it could never burn on this one.";
/** sources-3: a hurricane-season one-shot after its season (November 30, UTC): the window is closed, so no storm can count. */
/** sources-4: a record series whose last complete day is already its record (the coin-record twin is derby/high.ts HIGH_ALREADY_SENTENCE). */
export const RECORD_ALREADY_SENTENCE = "This series' last complete day is already its record, so a new coin on it is not offered. A coin on a record must start below the record, so that its first burn is a new one.";
export const SEASON_OVER_SENTENCE = "This hurricane season is over, so a coin on its next storm is not offered. The rule only counts storms after its launch and inside the season it names.";

/** Whether a series is a one-time catalogue series (the keeper ends it after its one reading). */
export const isOneTimeSeries = (series: string | null | undefined): boolean => !!series && KEEPER_ONE_SHOT_RE.test(series);

const utcText = (iso: string): string => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const denverText = (iso: string): string => new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** A Launch Library 2 launch as the publisher lists it: mission name, provider, launch time, status, the page and the immutable id. */
export interface Ll2LaunchInfo { id: string; name: string; provider: string | null; net: string | null; status: string | null; statusAbbrev: string | null; url: string; final: boolean }
export function ll2LaunchInfo(body: unknown): Ll2LaunchInfo | null {
  const b = body as { id?: unknown; name?: unknown; net?: unknown; status?: { name?: unknown; abbrev?: unknown }; launch_service_provider?: { name?: unknown } } | null;
  if (!b || typeof b.id !== "string" || typeof b.name !== "string") return null;
  const abbrev = typeof b.status?.abbrev === "string" ? b.status.abbrev : null;
  return { id: b.id, name: b.name, provider: typeof b.launch_service_provider?.name === "string" ? b.launch_service_provider.name : null, net: typeof b.net === "string" ? b.net : null,
    status: typeof b.status?.name === "string" ? b.status.name : null, statusAbbrev: abbrev, url: `https://ll.thespacedevs.com/2.3.0/launches/${b.id}/`, final: abbrev !== null && /^(Success|Failure|Partial Failure)$/.test(abbrev) };
}
/** The launch in words for the listing and the review: never a bare id. */
export function ll2LaunchLine(i: Ll2LaunchInfo): string {
  const when = i.net ? ` Launch time ${utcText(i.net)} UTC (${denverText(i.net)} Denver time).` : "";
  return `${i.name}${i.provider ? `, by ${i.provider}` : ""}. Status: ${i.status ?? "not given"}.${when} Launch Library 2 id ${i.id}.`;
}

export interface Eligibility { decided: boolean; reason: string | null; subject: Ll2LaunchInfo | null }
const OPEN: Eligibility = { decided: false, reason: null, subject: null };

/**
 * One body read from the source (the live read in the preflight; the saved sample in the listing and the review, only when the sample
 * is of this very series) → whether the one-time event is already decided, and why in words.
 */
export function oneShotEligibility(series: string, cfg: HttpSourceConfig, body: unknown, nowMs: number): Eligibility {
  // sources-4: a record source (recurring or once) whose last complete day is already a record is refused (never a day-one burn)
  if (cfg.select.record) {
    const r = parseBody({ ...cfg, select: { ...cfg.select, record: { ...cfg.select.record, once: false } } }, body, nowMs).readings;
    const last = r[r.length - 1];
    if (last?.value === "1") return { decided: true, reason: `${RECORD_ALREADY_SENTENCE} ${last.title}.`, subject: null };
  }
  if (!isOneTimeSeries(series)) return OPEN;
  // sources-3: a next-event one-shot is decided only by a closed window (a hurricane season that is over), never by an earlier event
  if (NEXT_EVENT_ONE_SHOT_RE.test(series)) {
    const n = parseNhcSeries(series);
    return n?.kind === "next" && !nhcSeasonOpen(n.year, nowMs) ? { decided: true, reason: SEASON_OVER_SENTENCE, subject: null } : OPEN;
  }
  const l = parseLl2Series(series);
  if (l?.kind === "launch") {
    const info = ll2LaunchInfo(body);
    if (!info || info.id.toLowerCase() !== l.launch) return OPEN;   // a sample of another launch says nothing about this one
    return info.final ? { decided: true, reason: `${ALREADY_DECIDED_SENTENCE} ${ll2LaunchLine(info)}`, subject: info } : { decided: false, reason: null, subject: info };
  }
  const g = parseGithubSeries(series);
  if (g?.kind === "milestone") {
    const path = cfg.select.milestone?.path;
    const n = path ? Number(jsonOne(body, path)) : NaN;
    const full = (jsonOne(body, "$.full_name") as string | undefined)?.toLowerCase();
    if (full !== undefined && full !== g.repo.toLowerCase()) return OPEN;
    const why = Number.isFinite(n) ? milestoneProblem(n, g.n) : null;
    return why && Number.isFinite(n) && n >= g.n ? { decided: true, reason: `${ALREADY_DECIDED_SENTENCE} ${why}`, subject: null } : OPEN;
  }
  // any other one-time series (a YouTube milestone): a reading is the result
  const r = parseBody(cfg, body, nowMs).readings;
  return r.length ? { decided: true, reason: `${ALREADY_DECIDED_SENTENCE} The source already reads ${r[r.length - 1].title ?? "its result"}.`, subject: null } : OPEN;
}

/**
 * ONE GAME (espn.game: a one-game coin and each side of a one-game Matchup): already decided once the schedule marks the game final.
 * Before that, the line says its status and its start time in UTC and Denver time. Same sentence as every other one-time event.
 */
export interface GameLike { eventId: string; name: string; startsAt: string; completed: boolean; detail?: string | null; state?: string | null }
export function gameLine(g: GameLike): string {
  // "pre" is scheduled; "in" is under way; anything else not final carries its own word from the schedule ("Postponed", "Suspended")
  const status = g.completed ? "Final" : g.state === "in" ? "In progress" : g.state === "pre" || !g.detail?.trim() ? "Scheduled" : g.detail.trim();
  return `${g.name}. Status: ${status}. Start time ${utcText(g.startsAt)} UTC (${denverText(g.startsAt)} Denver time). Game id ${g.eventId}.`;
}
export function gameEligibility(g: GameLike): { decided: boolean; reason: string | null; line: string } {
  const line = gameLine(g);
  return g.completed ? { decided: true, reason: `${ALREADY_DECIDED_SENTENCE} ${line}`, line } : { decided: false, reason: null, line };
}
