import type { HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import { fitName } from "@/lib/burnticker/launchFields";

/**
 * SPC TORNADO REPORTS (sources-3, 2026-10-12). The NWS Storm Prediction Center's daily storm reports, the FILTERED tornado file for one
 * report day (www.spc.noaa.gov/climo/reports/<yymmdd>_rpts_filtered_torn.csv, keyless CSV; NWS pages are public domain). A report day
 * runs from 12:00 UTC to 12:00 UTC the next day and is labelled by the day it starts. The filtered file drops reports SPC judges to be
 * duplicates of the same tornado; it is still a count of preliminary REPORTS, not of confirmed tornadoes.
 *
 *   spc.tornadoes:<US|ST>          each tornado report in the filtered file counts 1, nationally or in one state (the State column).
 *   spc.tornadoday:<N>/<US|ST>     ONE-SHOT: the whole share once, on the first report day after launch with N or more reports
 *                                  (N = 1, 5, 10, 25, 50 or 100), nationally or in one state. Days below N give no reading at all.
 *
 * RATINGS ARE NOT READ: the daily file's F_Scale column reads UNK on preliminary reports (every row of the 2026-10-12 capture), because
 * EF ratings come from NWS field surveys days later and are published in SPC's final database months later. A one-shot on "the next
 * EF-N" cannot be settled from this feed, so it is not offered; the one-shot counts reports instead and the coin text says so.
 *
 * Each read fetches the seven report days that are at least two days old (preliminary reports keep arriving for about a day), so a
 * keeper that was down for a few days still reads every day. CLINICAL: only the State column is read (location, county, coordinates
 * and comments are never read or stored).
 *
 * How it fails: any of the seven files not answering fails the whole read (unavailable, never a 0); the keeper writes nothing.
 */

/** The fifty states and DC (SPC's State column uses the USPS codes). */
export const SPC_STATES: Readonly<Record<string, string>> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "the District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
export const SPC_DAY_COUNTS = [1, 5, 10, 25, 50, 100] as const;

export type SpcSeries = { kind: "count"; area: string } | { kind: "day"; area: string; n: number };
export function parseSpcSeries(id: string): SpcSeries | null {
  let m = /^spc\.tornadoes:(US|[A-Z]{2})$/.exec(id);
  if (m) return m[1] === "US" || SPC_STATES[m[1]] ? { kind: "count", area: m[1] } : null;
  m = /^spc\.tornadoday:(\d{1,3})\/(US|[A-Z]{2})$/.exec(id);
  if (m && (SPC_DAY_COUNTS as readonly number[]).includes(Number(m[1])) && (m[2] === "US" || SPC_STATES[m[2]])) return { kind: "day", area: m[2], n: Number(m[1]) };
  return null;
}
const where = (area: string) => (area === "US" ? "in the United States" : `in ${SPC_STATES[area]}`);

export function applySpc(cfg: HttpSourceConfig, param: string): HttpSourceConfig {
  const s = parseSpcSeries(`${cfg.id}:${param}`);
  if (!s) throw new Error(`${cfg.id}: ${param} is not valid (spc.tornadoes:<US|state code>, spc.tornadoday:<${SPC_DAY_COUNTS.join("|")}>/<US|state code>)`);
  const filters = s.area === "US" ? [] : [{ path: "State", regex: `^${s.area}$` }];
  const select = { ...cfg.select, filters, count: { default: 1 }, ...(s.kind === "day" ? { oneShot: { atLeast: s.n } } : {}) };
  const period = { ...cfg.period, zeroFill: s.kind === "count" };
  const w = where(s.area);
  return { ...cfg, select, period, sourceUrl: `https://www.spc.noaa.gov/climo/reports/#${s.kind === "count" ? "tornadoes" : `${s.n}-or-more`}-${s.area}`, title: s.kind === "count" ? `Tornado reports ${w} (SPC)` : `The next report day with ${s.n} or more tornado reports ${w} (SPC)`,
    unit: s.kind === "count" ? { size: 1, label: "1 tornado report", definition: `per SPC report day: each tornado report ${w} in SPC's filtered file counts 1` }
      : { size: 1, label: `the next day with ${s.n} or more reports`, definition: `one reading: the first SPC report day after launch with ${s.n} or more tornado reports ${w}` } };
}

/** The coin text pieces (lint-clean; test/burntickerSources3.test.ts): a count of reports, nothing else. */
export function spcText(s: SpcSeries, spends: string, inverse: boolean): { name: string; ticker: string; oneLiner: string; block: string; oneShot: boolean } {
  const w = where(s.area), tag = s.area === "US" ? "US" : s.area;
  const src = "Duplicate reports are removed. A report day runs from 12:00 to 12:00 UTC and is read two days after it ends. These are preliminary reports, not rated tornadoes.";
  if (s.kind === "day") return { name: fitName(`Next ${s.n}-Report Day ${tag}`), ticker: `TORN${s.n}${tag}`.slice(0, 10), oneLiner: `burns once on the next day with ${s.n === 1 ? "a tornado report" : `${s.n} or more tornado reports`} ${w}`, oneShot: true,
    block: `On the first report day after launch with ${s.n === 1 ? "at least one tornado report" : `${s.n} or more tornado reports`} ${w}, ${spends} once, with a receipt on chain. ${src}` };
  if (inverse) return { name: `No Tornado Days ${tag}`, ticker: `NOTORN${tag}`.slice(0, 10), oneLiner: `burns on every day with no tornado report ${w}`, oneShot: false,
    block: `For every report day with no tornado report ${w}, ${spends}, with a receipt on chain. ${src} A day with a report burns nothing.` };
  return { name: `Tornado Reports ${tag}`, ticker: `TORN${tag}`.slice(0, 10), oneLiner: `burns for every tornado report ${w}`, oneShot: false,
    block: `For every tornado report ${w}, ${spends}, with a receipt on chain. ${src} The reading is a count of reports and nothing else.` };
}
