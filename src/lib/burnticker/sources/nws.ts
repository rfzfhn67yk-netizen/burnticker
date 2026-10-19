import type { SettledEvent } from "@/lib/burnticker/units";
import type { FetchLike, ResolvedSelector } from "@/lib/burnticker/oracle/types";
import { sourceForUrl, takeOrThrow } from "@/lib/burnticker/apiBudget";
import { LruMap, NWS_CACHE_BYTES, bodyBytes, logRequest } from "@/lib/burnticker/lru";

/**
 * THE NWS DAILY CLIMATE ADAPTER (tier 4, first-party, public domain; 2026-10-10 — Weather & Climate gets a first-party source). It reads
 * the National Weather Service's daily climate report (product type CLI) for a named station through api.weather.gov:
 *
 *   GET /products/types/CLI/locations/<STATION>    the station's recent CLI products (about two weeks)
 *   GET /products/<id>                              one report's text
 *
 * Only FINAL reports are read: the early-morning "CLIMATE SUMMARY FOR <date>" with a YESTERDAY block. The "VALID (TODAY) AS OF …" reports
 * issued during the day are preliminary and are never read. Values: MAXIMUM (°F), PRECIPITATION YESTERDAY (in; "T" = trace = 0) and
 * SNOWFALL YESTERDAY / SINCE JUL 1 (in). A missing value ("MM") reads no reading for that day.
 *
 * CROSS-READ (2026-10-10, the settlement-coverage gate: another operator on another domain): the Iowa Environmental Mesonet (Iowa
 * State University) — the station's ASOS daily summary computed from its own hourly observations for the high (agree within 2 °F) and
 * the precipitation (within 0.05 in or 10 %), and IEM's independent parse of the same climate report for snowfall. A day is read only
 * when the cross-read agrees; a disagreement holds the day and is reported; an IEM gap leaves it awaiting.
 *
 * SERIES (catalogue ids; scalar, unit 1, baseline 0, direction up — one unit per qualifying day):
 *   nws.high:<STATION>-<°F>     the day's high reached the threshold (≥)
 *   nws.rain:<STATION>-<in>     the day's precipitation reached the threshold (≥, inches, e.g. 0.50)
 *   nws.snow:<STATION>          the season's FIRST measurable snow (≥ 0.1 in on a day whose season-to-date total equals that day's): once a season
 */

export interface Station { code: string; city: string; label: string; state: string }
/** Stations whose CLI product api.weather.gov served on 2026-10-10 (each listed 14–28 recent reports). */
export const STATIONS: Station[] = [
  ["ATL", "Atlanta", "Atlanta (Hartsfield)", "GA"], ["AUS", "Austin", "Austin (Camp Mabry)", "TX"], ["BOS", "Boston", "Boston (Logan)", "MA"], ["CLE", "Cleveland", "Cleveland (Hopkins)", "OH"],
  ["DCA", "Washington", "Washington, D.C. (Reagan National)", "VA"], ["DEN", "Denver", "Denver (DIA)", "CO"], ["DFW", "Dallas", "Dallas–Fort Worth", "TX"], ["DTW", "Detroit", "Detroit (Metro)", "MI"],
  ["IAH", "Houston", "Houston (Bush Intercontinental)", "TX"], ["LAS", "Las Vegas", "Las Vegas (Harry Reid)", "NV"], ["LAX", "Los Angeles", "Los Angeles (International)", "CA"], ["MIA", "Miami", "Miami", "FL"],
  ["MSP", "Minneapolis", "Minneapolis–St. Paul", "MN"], ["NYC", "New York", "New York (Central Park)", "NY"], ["ORD", "Chicago", "Chicago (O'Hare)", "IL"], ["PHL", "Philadelphia", "Philadelphia", "PA"],
  ["PHX", "Phoenix", "Phoenix (Sky Harbor)", "AZ"], ["PIT", "Pittsburgh", "Pittsburgh", "PA"], ["SEA", "Seattle", "Seattle (Sea-Tac)", "WA"], ["SFO", "San Francisco", "San Francisco (International)", "CA"],
  ["SLC", "Salt Lake City", "Salt Lake City", "UT"], ["STL", "St. Louis", "St. Louis (Lambert)", "MO"],
].map(([code, city, label, state]) => ({ code, city, label, state }));
/** QA pass 9 #34: a station as a picker option, its code said once ("Los Angeles (International), LAX"), never "Los Angeles (LAX) (LAX)". */
export const stationOptionLabel = (s: Pick<Station, "label" | "code">): string => (new RegExp(`\\b${s.code}\\b`).test(s.label) ? s.label : `${s.label}, ${s.code}`);
export const stationByCode = (c: string): Station | null => STATIONS.find((s) => s.code === c.toUpperCase()) ?? null;
/** Stations a query names by city or code ("detroit", "DTW", "new york"). */
export function findStations(q: string): Station[] {
  const n = ` ${q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  return STATIONS.filter((s) => n.includes(` ${s.city.toLowerCase()} `) || n.includes(` ${s.code.toLowerCase()} `));
}

export type NwsMetric = "high" | "rain" | "snow";
export type NwsSeries = { metric: "high"; station: string; threshold: number } | { metric: "rain"; station: string; threshold: number } | { metric: "snow"; station: string; threshold: null };
export const nwsSeries = (metric: NwsMetric, station: string, threshold: number | null = null): string =>
  metric === "snow" ? `nws.snow:${station.toUpperCase()}` : `nws.${metric}:${station.toUpperCase()}-${metric === "rain" ? Number(threshold).toFixed(2) : Math.round(Number(threshold))}`;
export function parseNwsSeries(id: string): NwsSeries | null {
  let m = /^nws\.high:([A-Z]{3})-(-?\d{1,3})$/.exec(id);
  if (m && stationByCode(m[1])) return { metric: "high", station: m[1], threshold: Number(m[2]) };
  m = /^nws\.rain:([A-Z]{3})-(\d{1,2}\.\d{2})$/.exec(id);
  if (m && stationByCode(m[1]) && Number(m[2]) > 0) return { metric: "rain", station: m[1], threshold: Number(m[2]) };
  m = /^nws\.snow:([A-Z]{3})$/.exec(id);
  if (m && stationByCode(m[1])) return { metric: "snow", station: m[1], threshold: null };
  return null;
}
/**
 * THE FIRST-SNOW COIN'S SEASON (owner intent, 2026-10-12: "first snow" resolves once and retires). The climate report's snow season runs
 * July 1 to June 30 (its "since July 1" total). A first-snow coin covers the season it was created in: the season holding its launch
 * day (UTC date of the launch time). The keeper (multiKeeper.ts) plans only readings up to that season's June 30, ends the coin after
 * its first qualifying snow, and ends it VOID once that June 30 has passed with none (checked from July 3 UTC, so the June 30 final
 * report, issued the next morning, and its cross-read have been read).
 */
export const isFirstSnowSeries = (series: string | null | undefined): boolean => !!series && /^nws\.snow:[A-Z]{3}$/.test(series);
export function snowSeasonEnd(launchIso: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/.test(launchIso) ? launchIso.slice(0, 10) : new Date(Date.parse(launchIso)).toISOString().slice(0, 10);
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  return `${m >= 7 ? y + 1 : y}-06-30`;
}
/** The keeper's void check for a season with no first snow: from this UTC instant on. */
export const snowSeasonVoidFromMs = (seasonEnd: string): number => Date.parse(`${seasonEnd}T00:00:00Z`) + 3 * 86_400_000;

export function nwsSeriesTitle(s: NwsSeries): string {
  const st = stationByCode(s.station)!;
  return s.metric === "high" ? `${st.city} daily high ≥ ${s.threshold} °F (NWS)` : s.metric === "rain" ? `${st.city} rain day ≥ ${s.threshold.toFixed(2)} in (NWS)` : `${st.city} first snow of the season (NWS)`;
}

// ---- the CLI report ------------------------------------------------------------------------------------------------------

export interface ClimateDay { date: string; high: number | null; precip: number | null; snow: number | null; snowSeason: number | null; final: boolean }
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const val = (s: string | undefined): number | null => (s === undefined || s === "MM" ? null : s === "T" ? 0 : Number.isFinite(Number(s)) ? Number(s) : null);

/** One CLI product's text → the day it summarises and its values; `final` false for a preliminary ("VALID … AS OF") report. */
export function parseCli(text: string): ClimateDay | null {
  const d = /CLIMATE SUMMARY FOR ([A-Z]+) (\d{1,2}) (\d{4})/.exec(text);
  if (!d || !MONTHS.includes(d[1])) return null;
  const date = `${d[3]}-${String(MONTHS.indexOf(d[1]) + 1).padStart(2, "0")}-${d[2].padStart(2, "0")}`;
  const final = !/VALID (TODAY )?AS OF/.test(text) && /TEMPERATURE \(F\)\s*\n\s*YESTERDAY/.test(text);
  const block = (name: string) => { const i = text.indexOf(name); return i < 0 ? "" : text.slice(i, i + 700); };
  const t = block("TEMPERATURE (F)"), p = block("PRECIPITATION (IN)"), s = block("SNOWFALL (IN)");
  return {
    date, final,
    high: val(/MAXIMUM\s+(-?\d+|MM)/.exec(t)?.[1]),
    precip: val(/(?:YESTERDAY|TODAY)\s+(\d+\.\d+|T|MM)/.exec(p)?.[1]),
    snow: val(/(?:YESTERDAY|TODAY)\s+(\d+\.\d+|T|MM)/.exec(s)?.[1]),
    snowSeason: val(/SINCE JUL 1\s+(\d+\.\d+|T|MM)/.exec(s)?.[1]),
  };
}

/** Whether a final day qualifies for the series (null when the value it needs is missing). */
export function qualifies(s: NwsSeries, d: ClimateDay): boolean | null {
  if (s.metric === "high") return d.high === null ? null : d.high >= s.threshold;
  if (s.metric === "rain") return d.precip === null ? null : d.precip >= s.threshold - 1e-9;
  if (d.snow === null || d.snowSeason === null) return null;
  return d.snow >= 0.1 && Math.abs(d.snowSeason - d.snow) < 1e-9;
}

// ---- the cross-read (Iowa Environmental Mesonet) ---------------------------------------------------------------------------

export const iemDailyUrl = (st: Station, ym: string): string => `https://mesonet.agron.iastate.edu/api/1/daily.json?station=${st.code}&network=${st.state}_ASOS&year=${ym.slice(0, 4)}&month=${Number(ym.slice(5, 7))}`;
export const iemCliUrl = (st: Station, year: string): string => `https://mesonet.agron.iastate.edu/json/cli.py?station=K${st.code}&year=${year}`;
export interface IemDay { date: string; high: number | null; precip: number | null; snow: number | null; snowSeason: number | null }
const iemNum = (v: unknown): number | null => (v === null || v === undefined || v === "M" || v === "" ? null : v === "T" ? 0 : Number.isFinite(Number(v)) ? Number(v) : null);
export function parseIemDaily(body: unknown): Map<string, IemDay> {
  const rows = ((body as { data?: unknown[] } | null)?.data ?? []) as { date?: string; max_tmpf?: unknown; precip?: unknown }[];
  return new Map(rows.filter((r) => r.date).map((r) => [r.date!, { date: r.date!, high: iemNum(r.max_tmpf), precip: iemNum(r.precip), snow: null, snowSeason: null }]));
}
export function parseIemCli(body: unknown): Map<string, IemDay> {
  const rows = ((body as { results?: unknown[] } | null)?.results ?? []) as { valid?: string; high?: unknown; precip?: unknown; snow?: unknown; snow_jul1?: unknown }[];
  return new Map(rows.filter((r) => r.valid).map((r) => [r.valid!, { date: r.valid!, high: iemNum(r.high), precip: iemNum(r.precip), snow: iemNum(r.snow), snowSeason: iemNum(r.snow_jul1) }]));
}
export type NwsCross = { verdict: "agree" | "disagree" | "unavailable"; detail: string };
/** The cross-read verdict for one final day: the value the series needs, from IEM, within tolerance. */
export function crossCheck(s: NwsSeries, d: ClimateDay, asos: IemDay | undefined, cli: IemDay | undefined): NwsCross {
  if (s.metric === "high") {
    if (!asos || asos.high === null || d.high === null) return { verdict: "unavailable", detail: "IEM ASOS has no daily max for that day" };
    return Math.abs(asos.high - d.high) <= 2 ? { verdict: "agree", detail: `IEM ASOS max ${asos.high} °F` } : { verdict: "disagree", detail: `IEM ASOS max ${asos.high} °F vs NWS ${d.high} °F (> 2 °F apart)` };
  }
  if (s.metric === "rain") {
    if (!asos || asos.precip === null || d.precip === null) return { verdict: "unavailable", detail: "IEM ASOS has no precipitation for that day" };
    const tol = Math.max(0.05, 0.1 * Math.max(asos.precip, d.precip));
    return Math.abs(asos.precip - d.precip) <= tol + 1e-9 ? { verdict: "agree", detail: `IEM ASOS precipitation ${asos.precip} in` } : { verdict: "disagree", detail: `IEM ASOS precipitation ${asos.precip} in vs NWS ${d.precip} in` };
  }
  if (!cli || cli.snow === null || cli.snowSeason === null || d.snow === null || d.snowSeason === null) return { verdict: "unavailable", detail: "IEM's climate parse has no snowfall for that day" };
  return Math.abs(cli.snow - d.snow) < 0.05 && Math.abs(cli.snowSeason - d.snowSeason) < 0.05 ? { verdict: "agree", detail: `IEM snowfall ${cli.snow} in (season ${cli.snowSeason})` } : { verdict: "disagree", detail: `IEM snowfall ${cli.snow} in (season ${cli.snowSeason}) vs NWS ${d.snow} (${d.snowSeason})` };
}

export const NWS_API = "https://api.weather.gov";
export const NWS_UA = "burnticker/0.1 (operator contact on burnticker.com)";
export const cliListUrl = (station: string): string => `${NWS_API}/products/types/CLI/locations/${station.toUpperCase()}`;
export const productUrl = (id: string): string => `${NWS_API}/products/${id}`;

export class NwsClient {
  private fetchImpl: FetchLike; private ttl: number; private now: () => number; private cache = new LruMap<string, { at: number; body: unknown }>(500, { maxWeight: NWS_CACHE_BYTES, weigh: bodyBytes }); private lastAt = 0; private minInterval: number; private chain: Promise<void> = Promise.resolve();
  requests: string[] = [];
  constructor(o: { fetchImpl?: FetchLike; now?: () => number; ttlMs?: number; minIntervalMs?: number } = {}) { this.fetchImpl = o.fetchImpl ?? (fetch as unknown as FetchLike); this.now = o.now ?? (() => Date.now()); this.ttl = o.ttlMs ?? 1_800_000; this.minInterval = o.minIntervalMs ?? 300; }
  async get(url: string, ttl = this.ttl): Promise<unknown> {
    const hit = this.cache.get(url); if (hit && this.now() - hit.at < ttl) return hit.body;
    const run = async () => {
      const wait = this.lastAt + this.minInterval - this.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      await takeOrThrow(sourceForUrl(url));   // the request budget (apiBudget.ts)
      this.lastAt = this.now(); logRequest(this.requests, url);
      const res = await this.fetchImpl(url, { headers: { accept: "application/geo+json", "user-agent": NWS_UA }, signal: AbortSignal.timeout(10_000) });   // prelaunch audit H1: every source read ends
      if (!res.ok) throw new Error(`NWS HTTP ${res.status} for ${url.slice(0, 100)}`);
      const body = await res.json(); this.cache.set(url, { at: this.now(), body }); return body;
    };
    const p = this.chain.then(run, run); this.chain = p.then(() => undefined, () => undefined); return p;
  }
  /** The station's final daily reports on file (newest first in the API; returned oldest first, one per date). Products are immutable: cached a day. */
  async days(station: string, max = 16): Promise<ClimateDay[]> {
    const list = ((await this.get(cliListUrl(station))) as { "@graph"?: { id: string }[] })["@graph"] ?? [];
    const out = new Map<string, ClimateDay>();
    for (const x of list.slice(0, max * 4)) {
      if (out.size >= max) break;
      const p = (await this.get(productUrl(x.id), 86_400_000)) as { productText?: string };
      const d = p.productText ? parseCli(p.productText) : null;
      if (d?.final && !out.has(d.date)) out.set(d.date, d);
    }
    return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
}

/** IEM's rows for the months / years the days cover (the cross-read). A failed read leaves the days awaiting, never read. */
export async function iemFor(client: NwsClient, st: Station, days: readonly ClimateDay[], metric: NwsMetric): Promise<{ asos: Map<string, IemDay>; cli: Map<string, IemDay> }> {
  const asos = new Map<string, IemDay>(), cli = new Map<string, IemDay>();
  if (metric === "snow") for (const y of [...new Set(days.map((d) => d.date.slice(0, 4)))]) { try { for (const [k, v] of parseIemCli(await client.get(iemCliUrl(st, y)))) cli.set(k, v); } catch { /* awaiting */ } }
  else for (const ym of [...new Set(days.map((d) => d.date.slice(0, 7)))]) { try { for (const [k, v] of parseIemDaily(await client.get(iemDailyUrl(st, ym)))) asos.set(k, v); } catch { /* awaiting */ } }
  return { asos, cli };
}

export async function nwsSettled(client: NwsClient, s: NwsSeries, sinceIso: string | null, o: { crossRead?: boolean } = {}): Promise<ResolvedSelector> {
  const days = (await client.days(s.station)).filter((d) => !sinceIso || d.date > sinceIso.slice(0, 10));
  const st = stationByCode(s.station)!;
  const events: SettledEvent[] = [];
  const refusals: string[] = [];
  let missing = 0, awaiting = 0;
  const iem = o.crossRead === false ? null : await iemFor(client, st, days, s.metric);
  for (const d of days) {
    const q = qualifies(s, d);
    if (q === null) { missing++; continue; }
    let crossText = "cross-read skipped (back-test)";
    if (iem) {
      const v = crossCheck(s, d, iem.asos.get(d.date), iem.cli.get(d.date));
      if (v.verdict === "disagree") { refusals.push(`${d.date}: ${v.detail} — held`); continue; }
      if (v.verdict === "unavailable") { awaiting++; continue; }
      crossText = v.detail;
    }
    const shown = s.metric === "high" ? `high ${d.high} °F` : s.metric === "rain" ? `precipitation ${d.precip} in` : `snowfall ${d.snow} in (season ${d.snowSeason} in)`;
    events.push({ id: d.date, at: d.date, result: null, value: q ? "1" : "0", title: `${st.label}: ${shown} → ${q ? "qualifies" : "does not qualify"} (${crossText})`, sourceUrl: cliListUrl(s.station), method: "nws-cli-final+iem" } as SettledEvent);
  }
  if (missing) refusals.push(`${missing} day(s) with a missing value (MM) — not read`);
  return { events, awaitingFinal: awaiting, refusals, settlementSourceUrl: cliListUrl(s.station) };
}
