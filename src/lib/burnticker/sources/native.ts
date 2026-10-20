import type { BurnRule } from "@/lib/burnticker/rules";
import type { ResolvedSelector } from "@/lib/burnticker/oracle/types";
import { EspnClient, LEAGUES, SETTLE_AFTER_START_MS, ScheduleUnavailable, espnSeriesTitle, gamesFor, outcomeWords, parseEspnSeries, teamByAbbr, type EspnSeries, type Game } from "@/lib/burnticker/sources/espn";
import { CROSS_LABEL, POLY_LEAGUE_TAG, countedOfficialOf, envGameDeps, operatorsFor, sportsSettled, type GameDeps } from "@/lib/burnticker/sources/gameSettle";
import { FecClient, fecSettled, parseFecSeries } from "@/lib/burnticker/sources/fec";
import { GAME_AGREE_LINE, GAME_BURN_LINE, GAME_SETTLEMENT } from "@/lib/burnticker/sources/provenance";
import { ALREADY_DECIDED_SENTENCE, gameEligibility } from "@/lib/burnticker/oneShotEligibility";
import { NwsClient, crossCheck, iemFor, nwsSeriesTitle, nwsSettled, parseNwsSeries, qualifies, stationByCode, type NwsSeries } from "@/lib/burnticker/sources/nws";

/**
 * NATIVE FIRST-PARTY SOURCES (2026-10-10): sources with their own code rather than a sources.json request template — the ESPN
 * scoreboard (team coins, matchups; cross-read) and the NWS daily climate report (Weather). Their ids are catalogue series
 * (`espn.team:nfl-PHI-win`, `nws.high:DEN-90`, …) so rules, the registry, the keeper and the pages treat them like any first-party feed:
 * scalar, unit 1 per qualifying game/day, baseline 0, direction up, no carry. The catalogue adapter dispatches here
 * (catalogue/index.ts CatalogueAdapter.settledSince / nativeSourceById).
 */

export interface NativeSource {
  id: string; family: "espn.team" | "espn.game" | "nws.high" | "nws.rain" | "nws.snow" | "fec.beats";
  title: string; sourceName: string; sourceUrl: string; tier: 4; cadence: string;
  unit: { size: 1; label: string; definition: string }; direction: "up"; baseline: 0; carry: "none"; pollEverySec: number;
  flags: string[]; launchable: { ok: boolean; why: string | null };
  /** The second read every reading needs (null: one source). */
  crossRead: string | null;
  /** The descriptor ids in sources.json (kind native): this source's family and its cross-read, for the coverage gate. */
  descriptorId: string; crossReadId: string | null;
  settledSince(rule: BurnRule, sinceIso: string | null, o?: { crossRead?: boolean }): Promise<ResolvedSelector>;
  /** The creation preflight's live check (coverage/preflight.ts): the latest reading, its cross-read verdict, when the next is expected. */
  preflight(nowMs: number): Promise<NativePreflight>;
  /** A one-time native series (one game): whether its result is already known, and its status line (oneShotEligibility.ts). */
  eligibility?(): Promise<{ decided: boolean; reason: string | null; line: string } | null>;
}

export interface NativePreflight {
  last: { id: string; value: string | null; at: string } | null; crossLast: { id: string; value: string | null; at: string } | null;
  agreement: boolean | null; basis: string; nextAt: string | null; nextBasis: string;
  /** An informational line for the launch review, never a refusal (owner 2026-10-14: Polymarket has not listed the next game yet). */
  note?: string | null;
  /** A refusal the source itself raises (the cross-read could not be read for the latest reading; a stale source). */
  problem: { code: "cross-read-unreadable" | "stale-primary" | "primary-unreadable" | "disagreement" | "already-decided"; reason: string } | null;
}

let espn: EspnClient | null = null, nws: NwsClient | null = null, fec: FecClient | null = null;
/** For tests (and the keeper): the clients the native sources read through. */
let games: GameDeps | null = null;
export function setNativeClients(c: { espn?: EspnClient | null; nws?: NwsClient | null; fec?: FecClient | null; games?: GameDeps | null }): void { if (c.espn !== undefined) espn = c.espn; if (c.nws !== undefined) nws = c.nws; if (c.fec !== undefined) fec = c.fec; if (c.games !== undefined) games = c.games; }
/** How games settle on this host (gameSettle.ts): the licensed keys from the environment and the Polymarket game-market readers the server registers. */
export const gameDeps = (): GameDeps => games ?? envGameDeps();
/** The shared clients (one polite, cached reader per process). */
export const espnClient = (): EspnClient => (espn ??= new EspnClient());
export const nwsClient = (): NwsClient => (nws ??= new NwsClient());
export const fecClient = (): FecClient => (fec ??= new FecClient());

/**
 * THE LAUNCH CHECK'S SPORTS SENTENCES (launch walkthrough 2026-10-13). The page shows a refusal after "The check run before launch
 * refused this coin:", so each reason is plain English a creator can act on: no operator jargon, no setting names, no symbols. The
 * technical reason stays in `basis`.
 */
const gameDay = (g: { date: string }): string => new Date(`${g.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** Leagues whose game markets the lookup can match under a league tag (a two-sided moneyline, or soccer's three yes-or-no markets: gameSettle.ts threeWayOf). */
const listsGamesAhead = (league: EspnSeries["league"]): boolean => !!POLY_LEAGUE_TAG[league];
export { listsGamesAhead };
const AHEAD = " Polymarket usually lists a game a few days before it starts, so please try again then.";
export const GAME_LINES = {
  scheduleOff: (league: string): string => `the ${league} schedule cannot be read on this site right now, so a coin on it cannot be checked. Please try again later.`,
  scheduleUnread: (team: string): string => `the schedule for ${team} could not be read just now. Please try again in a few minutes.`,
  gameNotListed: (team: string): string => `this game is not on the schedule for ${team}.`,
  noSourceNext: (team: string, next: Game | null, league: EspnSeries["league"]): string => `no source can settle the next game for ${team} yet, because Polymarket has not listed a market for ${next ? `${next.name} on ${gameDay(next)}` : "it"} and this site has no licensed final scores.${listsGamesAhead(league) ? AHEAD : ""}`,
};
/**
 * THE LAUNCH REVIEW'S NOTE (owner, 2026-10-14: "TheSportsDB should be enough to validate"). One operator that can read the next game is
 * enough to launch; a next game Polymarket has not listed yet is said here, never refused. With a counted league feed (MLB, the NHL, the
 * NBA's when it answers) that feed must agree instead of the hold.
 */
// HB-118 (hourly run 10): sport-neutral ("a few days before the game", never basketball's "tip-off"); a next game more than 14 days away
// (a season that has not started) gets the general form, never "has not listed the next game yet"
export const NEXT_GAME_NOTES = {
  hold: "Polymarket has not listed the next game yet; it usually appears a few days before the game. Until it does, that game would settle on TheSportsDB alone after a 12-hour confirmation hold.",
  official: (feed: string): string => `Polymarket has not listed the next game yet; it usually appears a few days before the game. Until it does, that game would settle on TheSportsDB and ${feed}, which must agree.`,
  noTag: "Polymarket does not list games in this league, so each game would settle on TheSportsDB alone after a 12-hour confirmation hold.",
  laterHold: "Polymarket lists each game a few days before it is played. Until then a game settles on TheSportsDB alone after a 12-hour confirmation hold.",
  laterOfficial: (feed: string): string => `Polymarket lists each game a few days before it is played. Until then a game settles on TheSportsDB and ${feed}, which must agree.`,
};
/** HB-118: the "not listed yet" note is said only for a next game this close (Polymarket lists games a few days ahead). */
export const NEXT_GAME_SOON_MS = 14 * 86_400_000;
/** The launch review's note on a single-game coin (owner, 2026-10-16: one burn schedule for every game coin, gameSettle.ts gameSchedule). */
export const GAME_COIN_NOTE = `${GAME_BURN_LINE} ${GAME_AGREE_LINE}`;
export function nextGameNote(league: EspnSeries["league"], d: GameDeps, o: { soon?: boolean } = {}): string {
  const soon = o.soon !== false;
  const off = countedOfficialOf(league);
  const feed = off ? CROSS_LABEL[off] : d.apiSportsKey ? "API-Sports" : null;
  if (feed) return soon ? NEXT_GAME_NOTES.official(feed) : NEXT_GAME_NOTES.laterOfficial(feed);
  return listsGamesAhead(league) ? (soon ? NEXT_GAME_NOTES.hold : NEXT_GAME_NOTES.laterHold) : NEXT_GAME_NOTES.noTag;
}

function espnSource(id: string, s: EspnSeries): NativeSource {
  const t = teamByAbbr(s.league, s.abbr)!, off = countedOfficialOf(s.league), crossLabel = off ? `${CROSS_LABEL[off]} and each other` : "each other (the on-chain payout and TheSportsDB)";
  const deps = () => gameDeps();
  // owner 2026-10-16 and 2026-10-18 evening: a game coin settles once two sources agree on the final, or once one source has shown the same final twice
  const settles = s.kind === "game" ? `settled on ${GAME_SETTLEMENT}` : "settled on the game's on-chain payout where a market exists, else on a licensed final score";
  return {
    id, family: s.kind === "team" ? "espn.team" : "espn.game", title: espnSeriesTitle(s), sourceName: s.kind === "game" ? `${settles}; burns once two sources agree on the final, or once one source has shown the same final twice a few minutes apart, and every source that answers must agree` : `${settles}; confirmed by ${crossLabel}`,
    sourceUrl: `https://www.thesportsdb.com/`, tier: 4, cadence: s.kind === "team" ? "every game day" : "resolves once, after the game",
    unit: s.kind === "team" && s.window.kind === "meetings"
      // the rivalry series (espn.ts window `meetings`): a signed reading per game day, and one season-end reading
      ? { size: 1, label: "1 win against the rival", definition: `each ${t.name} win against ${teamByAbbr(s.league, s.window.opp)?.name ?? s.window.opp} this season (a loss reads −1, a draw 0), ${settles}, read ≥ 6 h after the start and only once ${crossLabel} agrees on the final (a game no second source can read settles on TheSportsDB alone after its final has stood 12 hours); when both seasons are over, one more reading: +1 if ${t.name} won more of the games between them, −1 if fewer, none if level` }
      : s.kind === "game"
        // owner 2026-10-16: ONE schedule for every single-game coin (gameSettle.ts gameSchedule)
        ? { size: 1, label: `the ${outcomeWords(s.outcome).noun}`, definition: `the ${t.name} ${outcomeWords(s.outcome).noun} in this one game, ${settles}, read ≥ 6 h after the start; it burns once two sources agree on the final (TheSportsDB, the game's on-chain settlement, a league feed or API-Sports, each counted once), or once one source has shown the same final twice a few minutes apart, and every source that answers must agree${LEAGUES[s.league].draws ? "" : "; a tie counts as neither"}` }
        : { size: 1, label: `1 ${outcomeWords(s.outcome).noun}`, definition: `each ${t.name} ${outcomeWords(s.outcome).noun} in a completed game, ${settles}, read ≥ 6 h after the start and only once ${crossLabel} agrees on the final (a game no second source can read settles on TheSportsDB alone after its final has stood 12 hours)${LEAGUES[s.league].draws ? "" : "; a tie counts as neither"}` },
    direction: "up", baseline: 0, carry: "none", pollEverySec: 3600,
    flags: [...(s.kind === "game" ? ["a game coin burns once two sources agree on the final, or once one source has shown the same final twice a few minutes apart; a disagreement holds it (owner 2026-10-16)"] : []), off ? `the game list comes from ${CROSS_LABEL[off]} (free, official)` : s.league === "nba" ? "the game list comes from the NBA's feed when it answers, else from TheSportsDB under licence (needs BURNTICKER_THESPORTSDB_KEY)" : "the game list comes from TheSportsDB (needs BURNTICKER_THESPORTSDB_KEY)", "TheSportsDB (commercial license) needs BURNTICKER_THESPORTSDB_KEY; API-Sports (optional) BURNTICKER_APISPORTS_KEY", ...(s.kind === "game" ? [] : ["every source that reads a game must agree; a game with no Polymarket market and no league feed settles on TheSportsDB alone once its final score has stood for 12 hours (a source check; one operator attester signs the reading)"])],
    launchable: { ok: true, why: null }, crossRead: crossLabel, descriptorId: "polymarket.gamepayout", crossReadId: off ?? "thesportsdb.v2",
    // HB-83: crossRead false is the review's display-only back-test: it counts from the schedule, with no per-game settling reads
    settledSince: (_rule, sinceIso, o = {}) => sportsSettled(espnClient(), s, sinceIso, deps(), { seriesId: id, display: o.crossRead === false }),
    ...(s.kind === "game" ? { eligibility: async () => { const g = (await gamesFor(espnClient(), s))[0]; return g ? gameEligibility(g) : null; } } : {}),
    preflight: async (nowMs) => {
      const c = espnClient(), d = deps();
      const none = { last: null, crossLast: null, agreement: null, basis: "", nextAt: null, nextBasis: "" };
      let games;
      try { games = await gamesFor(c, s); } catch (e) { return { ...none, problem: { code: "primary-unreadable", reason: e instanceof ScheduleUnavailable ? GAME_LINES.scheduleOff(LEAGUES[s.league].label) : GAME_LINES.scheduleUnread(t.name) } }; }
      if (s.kind === "game" && !games.length) return { ...none, problem: { code: "primary-unreadable", reason: GAME_LINES.gameNotListed(t.name) } };
      // the intent audit (oneShotEligibility.ts): a single game that is already final has its result; a new coin on it is refused
      if (s.kind === "game" && games[0].completed) return { ...none, problem: { code: "already-decided", reason: gameEligibility(games[0]).reason! } };
      const next = games.find((g) => !g.completed && Date.parse(g.startsAt) > nowMs - SETTLE_AFTER_START_MS) ?? null;
      const nextAt = next?.startsAt ?? null, nextBasis = next ? `the next game's start (schedule): ${next.name}` : "no scheduled game listed";
      // owner 2026-10-13: NO PAST GAME IS READ AT LAUNCH ("no passed events should apply, only new events"). The readers are proven on
      // the next game. Owner 2026-10-14: ONE operator that can settle the next game is enough (its market, or TheSportsDB's licensed
      // final); a game Polymarket has not listed yet is a note, never a refusal (gameSettle.ts settles it on TheSportsDB alone after a
      // 12-hour hold, or on TheSportsDB and the league's own feed where one is counted). No source at all is still refused.
      {
        const m = next && d.market ? await d.market(next).catch(() => null) : null;
        if (!m && !d.tsdbKey) return { ...none, nextAt, nextBasis, problem: { code: "primary-unreadable", reason: GAME_LINES.noSourceNext(t.name, next, s.league) } };
        const ops = operatorsFor(s.league, d, !!m);
        const note = s.kind === "game" ? GAME_COIN_NOTE : next && !m ? nextGameNote(s.league, d, { soon: Date.parse(next.startsAt) - nowMs <= NEXT_GAME_SOON_MS }) : null;
        return { ...none, basis: next ? `readers for the next game (${next.name}): ${ops.join(" and ")}; games before launch never count${s.kind === "game" ? "; a game coin burns once two of them agree on the final, or once one of them has shown the same final twice a few minutes apart, and every read must agree" : ops.length < 2 ? "; one operator, so the game settles on TheSportsDB alone after a 12-hour hold unless Polymarket lists it" : ", and every read is compared at the first game after launch"}` : "no game listed yet; the reads are compared at the first game after launch", nextAt, nextBasis, note, problem: null };
      }
    },
  };
}

function nwsSource(id: string, s: NwsSeries): NativeSource {
  const st = stationByCode(s.station)!;
  return {
    id, family: `nws.${s.metric}` as NativeSource["family"], title: nwsSeriesTitle(s), sourceName: "National Weather Service daily climate report (CLI) · first-party, public domain",
    sourceUrl: `https://api.weather.gov/products/types/CLI/locations/${st.code}`, tier: 4, cadence: s.metric === "snow" ? "once a season" : "daily (the morning after)",
    unit: { size: 1, label: s.metric === "snow" ? "the first snow" : "1 qualifying day", definition: s.metric === "high" ? `a day whose official high at ${st.label} reached ${s.threshold} °F` : s.metric === "rain" ? `a day whose official precipitation at ${st.label} reached ${s.threshold.toFixed(2)} in` : `the season's first day with ≥ 0.1 in of snow at ${st.label}` },
    direction: "up", baseline: 0, carry: "none", pollEverySec: 3 * 3600,
    flags: ["final reports only (preliminary 'valid as of' reports are never read)", "cross-read: Iowa Environmental Mesonet (Iowa State University)"], launchable: { ok: true, why: null }, crossRead: "Iowa Environmental Mesonet",
    descriptorId: "nws.cli", crossReadId: "iem.asos",
    settledSince: (_rule, sinceIso, o = {}) => nwsSettled(nwsClient(), s, sinceIso, o),
    preflight: async (nowMs) => {
      const c = nwsClient();
      let days;
      try { days = await c.days(s.station); } catch (e) { return { last: null, crossLast: null, agreement: null, basis: "", nextAt: null, nextBasis: "", problem: { code: "primary-unreadable", reason: `the NWS climate report for ${st.code} could not be read: ${(e as Error).message.slice(0, 120)}` } }; }
      const d = [...days].reverse().find((x) => qualifies(s, x) !== null) ?? null;
      const nextAt = d ? new Date(Date.parse(`${d.date}T00:00:00Z`) + 2 * 86_400_000 + 12 * 3_600_000).toISOString() : null;
      const nextBasis = "the next day's final report, issued the following morning (local)";
      if (!d) return { last: null, crossLast: null, agreement: null, basis: "", nextAt: null, nextBasis, problem: { code: "primary-unreadable", reason: `no final climate report with the value this rule needs at ${st.code}` } };
      // intent audit 2 item 2 (oneShotEligibility.ts): this season's first snow already fell, so a coin made now could not burn on it
      if (s.metric === "snow" && d.snowSeason !== null && d.snowSeason >= 0.1) return { last: { id: d.date, value: `${d.snow} in (season ${d.snowSeason})`, at: d.date }, crossLast: null, agreement: null, basis: "", nextAt: null, nextBasis, problem: { code: "already-decided", reason: `${ALREADY_DECIDED_SENTENCE} ${st.label} has ${d.snowSeason} in of snow since July 1 in the report for ${d.date}, so this season's first snow already fell.` } };
      if (Date.parse(`${d.date}T00:00:00Z`) + 9 * 86_400_000 < nowMs) return { last: { id: d.date, value: null, at: d.date }, crossLast: null, agreement: null, basis: "", nextAt, nextBasis, problem: { code: "stale-primary", reason: `the newest final climate report at ${st.code} is for ${d.date}` } };
      const iem = await iemFor(c, st, [d], s.metric);
      const v = crossCheck(s, d, iem.asos.get(d.date), iem.cli.get(d.date));
      const shown = s.metric === "high" ? `${d.high} °F` : s.metric === "rain" ? `${d.precip} in` : `${d.snow} in (season ${d.snowSeason})`;
      const last = { id: d.date, value: shown, at: d.date };
      if (v.verdict === "unavailable") return { last, crossLast: null, agreement: null, basis: v.detail, nextAt, nextBasis, problem: { code: "cross-read-unreadable", reason: `the Iowa Environmental Mesonet could not confirm ${d.date} at ${st.code}: ${v.detail}` } };
      const crossLast = { id: d.date, value: v.detail, at: d.date };
      if (v.verdict === "disagree") return { last, crossLast, agreement: false, basis: v.detail, nextAt, nextBasis, problem: { code: "disagreement", reason: `NWS and the Iowa Environmental Mesonet disagree on ${d.date} at ${st.code}: ${v.detail}` } };
      return { last, crossLast, agreement: true, basis: `${d.date}: NWS ${shown}, ${v.detail}`, nextAt, nextBasis, problem: null };
    },
  };
}

function fecSource(id: string, s: { a: string; b: string }): NativeSource {
  return {
    id, family: "fec.beats", title: `FEC receipts per report: ${s.a} beats ${s.b}`, sourceName: "Federal Election Commission (OpenFEC) · first-party, public domain",
    sourceUrl: `https://www.fec.gov/data/candidate/${s.a}/`, tier: 4, cadence: "each FEC reporting period (quarterly, pre- and post-election)",
    unit: { size: 1, label: "1 report won", definition: `each reporting period in which ${s.a}'s campaign reports more receipts than ${s.b}'s (the latest version of both reports)` },
    direction: "up", baseline: 0, carry: "none", pollEverySec: 6 * 3600,
    flags: ["cross-read: the FEC's filings endpoint (same operator) — the coverage gate refuses a same-operator cross-read, so FEC rules do not pass preflight yet"], launchable: { ok: false, why: "the only cross-read is the same operator (FEC filings); see docs/burnticker/ui-conventions.md § FEC" }, crossRead: "FEC filings (same operator)",
    descriptorId: "fec.reports", crossReadId: "fec.filings",
    settledSince: (_rule, sinceIso, o = {}) => fecSettled(fecClient(), s, sinceIso, o),
    preflight: async () => ({ last: null, crossLast: null, agreement: null, basis: "", nextAt: null, nextBasis: "", problem: null }),
  };
}

/** The native source for a catalogue series id, or null when the id is not a native family or names an unknown team/station. */
export function nativeSourceById(id: string): NativeSource | null {
  const e = parseEspnSeries(id); if (e) return espnSource(id, e);
  const n = parseNwsSeries(id); if (n) return nwsSource(id, n);
  const f = parseFecSeries(id); if (f) return fecSource(id, f);
  return null;
}
export const isNativeId = (id: string): boolean => nativeSourceById(id) !== null;

/** A native rule must use the source's fixed unit (1), baseline (0) and direction (up). */
export function nativeRuleProblems(src: NativeSource, rule: BurnRule): string[] {
  const p: string[] = [];
  if (rule.oracle !== "catalogue" || rule.series !== src.id) p.push(`this rule is not for the source "${src.title}"`);
  if (rule.kind !== "scalar" || !rule.scalar) return [...p, "first-party rules are scalar"];
  if (rule.scalar.unit !== 1) p.push(`the unit must be 1 (${src.unit.label}) for "${src.title}"`);
  if (rule.scalar.direction !== "up") p.push(`the direction must be "up" for "${src.title}"`);
  if (rule.scalar.baseline !== 0) p.push(`the baseline must be 0 for "${src.title}"`);
  return p;
}

/** A complete rule for a native source (the wizard, the universal search and the SDK build the same object). */
export function nativeRule(series: string, perUnit: { fractionOfPool: number } | { tokens: number } = { fractionOfPool: 0.01 }): BurnRule {
  return { schema: "burnticker.rules/v1", oracle: "catalogue", series, market: null, filter: {}, kind: "scalar", scalar: { unit: 1, perUnit, baseline: 0, direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } as BurnRule;
}
