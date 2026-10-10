import type { BurnRule } from "@/lib/burnticker/rules";
import type { ResolvedSelector } from "@/lib/burnticker/oracle/types";
import { EspnClient, LEAGUES, SETTLE_AFTER_START_MS, espnSeriesTitle, espnSettled, outcomeOf, parseEspnSeries, teamByAbbr, type EspnSeries } from "@/lib/burnticker/sources/espn";
import { FecClient, fecSettled, parseFecSeries } from "@/lib/burnticker/sources/fec";
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
}

export interface NativePreflight {
  last: { id: string; value: string | null; at: string } | null; crossLast: { id: string; value: string | null; at: string } | null;
  agreement: boolean | null; basis: string; nextAt: string | null; nextBasis: string;
  /** A refusal the source itself raises (the cross-read could not be read for the latest reading; a stale source). */
  problem: { code: "cross-read-unreadable" | "stale-primary" | "primary-unreadable" | "disagreement"; reason: string } | null;
}

let espn: EspnClient | null = null, nws: NwsClient | null = null, fec: FecClient | null = null;
/** For tests (and the keeper): the clients the native sources read through. */
export function setNativeClients(c: { espn?: EspnClient | null; nws?: NwsClient | null; fec?: FecClient | null }): void { if (c.espn !== undefined) espn = c.espn; if (c.nws !== undefined) nws = c.nws; if (c.fec !== undefined) fec = c.fec; }
/** The shared clients (one polite, cached reader per process). */
export const espnClient = (): EspnClient => (espn ??= new EspnClient());
export const nwsClient = (): NwsClient => (nws ??= new NwsClient());
export const fecClient = (): FecClient => (fec ??= new FecClient());

function espnSource(id: string, s: EspnSeries): NativeSource {
  const L = LEAGUES[s.league], t = teamByAbbr(s.league, s.abbr)!;
  return {
    id, family: s.kind === "team" ? "espn.team" : "espn.game", title: espnSeriesTitle(s), sourceName: `ESPN scoreboard · first-party, cross-read with ${L.crossLabel}`,
    sourceUrl: `https://www.espn.com/${s.league}/team/_/name/${t.abbr.toLowerCase()}`, tier: 4, cadence: s.kind === "team" ? "every game day" : "resolves once, after the game",
    unit: { size: 1, label: s.kind === "team" ? `1 ${s.outcome}` : `the ${s.outcome}`, definition: `each ${t.name} ${s.outcome} in a completed game, read ≥ 6 h after the start and only once ${L.crossLabel} agrees on the final score; a tie counts as neither` },
    direction: "up", baseline: 0, carry: "none", pollEverySec: 3600,
    flags: ["unofficial public endpoint (ESPN does not document it); terms unchecked", L.cross === "thesportsdb" ? "cross-read: TheSportsDB (free test key unless BURNTICKER_THESPORTSDB_KEY is set)" : `cross-read: ${L.crossLabel} (league official)`],
    launchable: { ok: true, why: null }, crossRead: L.crossLabel, descriptorId: "espn.scoreboard", crossReadId: L.cross === "nhl" ? "nhl.score" : L.cross === "mlb" ? "mlb.statsapi" : "thesportsdb.events",
    settledSince: (_rule, sinceIso, o = {}) => espnSettled(espnClient(), s, sinceIso, o),
    preflight: async (nowMs) => {
      const c = espnClient();
      let games;
      try { games = (await c.season(s.league, s.abbr)).filter((g) => s.kind === "team" || g.eventId === s.eventId); } catch (e) { return { last: null, crossLast: null, agreement: null, basis: "", nextAt: null, nextBasis: "", problem: { code: "primary-unreadable", reason: `ESPN could not be read: ${(e as Error).message.slice(0, 120)}` } }; }
      if (s.kind === "game" && !games.length) return { last: null, crossLast: null, agreement: null, basis: "", nextAt: null, nextBasis: "", problem: { code: "primary-unreadable", reason: `ESPN does not list game ${s.eventId} for ${t.name}` } };
      const next = games.find((g) => !g.completed && Date.parse(g.startsAt) > nowMs - SETTLE_AFTER_START_MS) ?? null;
      const nextAt = next?.startsAt ?? null, nextBasis = next ? `the next game's start (ESPN): ${next.name}` : "no scheduled game listed";
      const done = games.filter((g) => outcomeOf(g, s.abbr) !== null && Date.parse(g.startsAt) + SETTLE_AFTER_START_MS <= nowMs);
      const lastGame = done[done.length - 1] ?? null;
      if (!lastGame) return { last: null, crossLast: null, agreement: null, basis: "no completed game yet: the cross-read compares at the first one", nextAt, nextBasis, problem: null };
      const v = await c.crossRead(lastGame);
      const out = outcomeOf(lastGame, s.abbr);
      const last = { id: lastGame.date, value: `${lastGame.away.abbr} ${lastGame.away.score} @ ${lastGame.home.abbr} ${lastGame.home.score} (${out})`, at: lastGame.startsAt };
      if (v.verdict === "unavailable") return { last, crossLast: null, agreement: null, basis: v.detail, nextAt, nextBasis, problem: { code: "cross-read-unreadable", reason: `${L.crossLabel} could not confirm ${t.name}'s latest final (${lastGame.name}): ${v.detail}` } };
      const crossLast = { id: lastGame.date, value: v.detail, at: lastGame.startsAt };
      if (v.verdict === "disagree") return { last, crossLast, agreement: false, basis: v.detail, nextAt, nextBasis, problem: { code: "disagreement", reason: `ESPN and ${L.crossLabel} disagree on ${lastGame.name}: ${v.detail}` } };
      return { last, crossLast, agreement: true, basis: `${lastGame.date}: ESPN ${lastGame.away.score}–${lastGame.home.score} = ${v.detail}`, nextAt, nextBasis, problem: null };
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
  if (rule.oracle !== "catalogue" || rule.series !== src.id) p.push(`rule is not for source ${src.id}`);
  if (rule.kind !== "scalar" || !rule.scalar) return [...p, "first-party rules are scalar"];
  if (rule.scalar.unit !== 1) p.push(`unit must be 1 (${src.unit.label}) for ${src.id}`);
  if (rule.scalar.direction !== "up") p.push(`direction must be "up" for ${src.id}`);
  if (rule.scalar.baseline !== 0) p.push(`baseline must be 0 for ${src.id}`);
  return p;
}

/** A complete rule for a native source (the wizard, the universal search and the SDK build the same object). */
export function nativeRule(series: string, perUnit: { fractionOfPool: number } | { tokens: number } = { fractionOfPool: 0.01 }): BurnRule {
  return { schema: "burnticker.rules/v1", oracle: "catalogue", series, market: null, filter: {}, kind: "scalar", scalar: { unit: 1, perUnit, baseline: 0, direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } as BurnRule;
}
