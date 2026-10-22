import type { HttpSourceConfig, RowCond } from "@/lib/burnticker/sources/attestedHttp";

/**
 * NHC TROPICAL CYCLONES (sources-3, 2026-10-12; the owner: natural disasters as an option, "burn per event or burn 100% on the next
 * event"). The National Hurricane Center's working best track, read from its ATCF directory (ftp.nhc.noaa.gov/atcf/btk/, keyless; NWS
 * and NHC pages are public domain, weather.gov/disclaimer). One best-track file per numbered storm (b<basin><nn><yyyy>.dat), a line per
 * six-hour fix with the storm's wind in knots and its type (TD, TS, HU, SS, EX …). The engine lists the directory, reads every file of
 * the basin and year (storms 01 to 49; invests and genesis areas are numbered 70 and up and are never read), and counts each STORM once.
 *
 *   nhc.storms:<basin>              each storm counts 1 on the UTC day of its first fix as a named system (type TS, HU or SS with a wind of
 *                                   34 knots or more), in the current year's files.
 *   nhc.hurricanes:<basin>.<cat>    each storm counts 1 on the UTC day of its first fix as a hurricane (type HU) at or above category N
 *                                   (the Saffir-Simpson wind in knots: 64, 83, 96, 113, 137).
 *   nhc.next:<basin>.<cat>.<year>   ONE-SHOT: the whole share once, on the first UTC day after launch on which a storm of that basin and
 *                                   year first reaches category N. The season ends on November 30 (NHC's season dates), which is the
 *                                   rule's end: once that day is read with no such storm, the source gives one reading of 0 and the coin
 *                                   ends with nothing burned. A season that is over is refused at review (oneShotEligibility.ts).
 *   basin  al (the Atlantic), ep (the eastern Pacific), cp (the central Pacific).
 *
 * Each day is read once it is over in UTC plus one day, from the working best track as it stands then (NHC revises tracks after a season;
 * a reading already given is never revised). Not built: a US landfall one-shot (the best track does not say where a storm crossed a
 * coast; NHC states landfalls in advisory text and post-season reports only).
 *
 * CLINICAL: a reading is a wind category and a count of storms. Storm names are read only to count a storm once and are never shown in
 * the coin's text; nothing about people or places is read.
 *
 * How it fails: the directory or any listed file not answering, or more than 49 matching files, fails the whole read (unavailable, never a
 * smaller count); the keeper writes nothing.
 */

export const NHC_BASINS: Readonly<Record<string, { label: string; code: string; seasonStart: string }>> = {
  al: { label: "the Atlantic", code: "ATL", seasonStart: "06-01" },
  ep: { label: "the eastern Pacific", code: "EPAC", seasonStart: "05-15" },
  cp: { label: "the central Pacific", code: "CPAC", seasonStart: "06-01" },
};
/** Saffir-Simpson categories: the lowest one-minute wind (knots) of each, as NHC defines them. */
export const NHC_CATEGORY_KT: Readonly<Record<number, number>> = { 1: 64, 2: 83, 3: 96, 4: 113, 5: 137 };
export const NHC_SEASON_END = "11-30";
/** The b-deck columns 1 to 28 (ATCF best-track format), basin to storm name. */
export const BTK_COLUMNS = ["BASIN", "CY", "DATE", "TECHNUM", "TECH", "TAU", "LAT", "LON", "VMAX", "MSLP", "TY", "RAD", "WINDCODE", "RAD1", "RAD2", "RAD3", "RAD4", "POUTER", "ROUTER", "RMW", "GUSTS", "EYE", "SUBREGION", "MAXSEAS", "INITIALS", "DIR", "SPEED", "STORMNAME"];

export type NhcSeries =
  | { kind: "storms"; basin: string }
  | { kind: "hurricanes"; basin: string; cat: number }
  | { kind: "next"; basin: string; cat: number; year: number };

export function parseNhcSeries(id: string): NhcSeries | null {
  let m = /^nhc\.storms:(al|ep|cp)$/.exec(id);
  if (m) return { kind: "storms", basin: m[1] };
  m = /^nhc\.hurricanes:(al|ep|cp)\.([1-5])$/.exec(id);
  if (m) return { kind: "hurricanes", basin: m[1], cat: Number(m[2]) };
  m = /^nhc\.next:(al|ep|cp)\.([1-5])\.(20\d\d)$/.exec(id);
  if (m) return { kind: "next", basin: m[1], cat: Number(m[2]), year: Number(m[3]) };
  return null;
}
export const nhcSeasonEnd = (year: number): string => `${year}-${NHC_SEASON_END}`;
/** Whether a one-shot's season can still produce its event: the season's last day has not passed (UTC). */
export const nhcSeasonOpen = (year: number, nowMs: number): boolean => new Date(nowMs).toISOString().slice(0, 10) <= nhcSeasonEnd(year);

const named: RowCond[] = [{ path: "TECH", regex: "^BEST$" }, { path: "TY", regex: "^(TS|HU|SS)$" }, { path: "VMAX", min: 34 }];
const hurricane = (cat: number): RowCond[] => [{ path: "TECH", regex: "^BEST$" }, { path: "TY", regex: "^HU$" }, { path: "VMAX", min: NHC_CATEGORY_KT[cat] }];

/** The catalogue's parameter hook for all three series (the base id picks the kind). */
export function applyNhc(cfg: HttpSourceConfig, param: string): HttpSourceConfig {
  const s = parseNhcSeries(`${cfg.id}:${param}`);
  if (!s) throw new Error(`${cfg.id}: ${param} is not a valid parameter (nhc.storms:<al|ep|cp>, nhc.hurricanes:<basin>.<1–5>, nhc.next:<basin>.<1–5>.<year>)`);
  const b = NHC_BASINS[s.basin];
  const year = s.kind === "next" ? String(s.year) : "{yyyy}";
  const fanOut = { kind: "index" as const, url: "https://ftp.nhc.noaa.gov/atcf/btk/", link: `b${s.basin}(?:0[1-9]|[1-4][0-9])${year}\\.dat`, max: 49 };
  const select = { ...cfg.select, rows: "$", columns: BTK_COLUMNS, filters: s.kind === "storms" ? named : hurricane(s.cat), count: { default: 1, distinct: "CY" }, ...(s.kind === "next" ? { oneShot: { atLeast: 1 } } : {}) };
  const period = { ...cfg.period, ...(s.kind === "next" ? { zeroFill: false, endsOn: nhcSeasonEnd(s.year) } : { zeroFill: true }) };
  const title = s.kind === "storms" ? `Named storms in ${b.label} (NHC)` : s.kind === "hurricanes" ? `Hurricanes of category ${s.cat} or higher in ${b.label} (NHC)` : `The next category ${s.cat} hurricane in ${b.label}, ${s.year} season (NHC)`;
  const unit = s.kind === "storms" ? { size: 1, label: "1 named storm", definition: `per UTC day: each storm in ${b.label} counts 1 on the day it is first a named storm (34 knots or more)` }
    : s.kind === "hurricanes" ? { size: 1, label: `1 category ${s.cat} hurricane`, definition: `per UTC day: each storm in ${b.label} counts 1 on the day it first reaches category ${s.cat} (${NHC_CATEGORY_KT[s.cat]} knots or more)` }
    : { size: 1, label: `the next category ${s.cat} hurricane`, definition: `one reading: the first UTC day after launch on which a storm in ${b.label} first reaches category ${s.cat}; 0 once ${nhcSeasonEnd(s.year)} has passed without one` };
  // the check link: the best-track directory, marked with the basin's file prefix (the directory itself lists every basin)
  return { ...cfg, sourceUrl: `https://ftp.nhc.noaa.gov/atcf/btk/#b${s.basin}`, request: { ...cfg.request, fanOut }, select, period, title, unit };
}

/** The coin text pieces (lint-clean; test/burntickerSources3.test.ts). No storm name, no place, no people: a category and a count. */
export function nhcText(s: NhcSeries, spends: string, inverse: boolean): { name: string; ticker: string; oneLiner: string; block: string; oneShot: boolean } {
  const b = NHC_BASINS[s.basin];
  // the publisher is named once, by the single official source sentence describe.ts adds (singleSource.ts)
  const src = "Each storm counts once, and each UTC day is read the day after it ends.";
  if (s.kind === "next") return { name: `Next Category ${s.cat} ${b.code}`, ticker: `NEXT${b.code}${s.cat}`.slice(0, 10), oneLiner: `burns once on the next category ${s.cat} hurricane in ${b.label} this season`, oneShot: true,
    block: `On the first day after launch that a storm in ${b.label} reaches category ${s.cat}, ${spends} once, with a receipt on chain. ${src} With no such storm by November 30, the season's end, nothing burns.` };
  const what = s.kind === "storms" ? `named storm in ${b.label}` : `hurricane of category ${s.cat} or stronger in ${b.label}`;
  const short = s.kind === "storms" ? "Named Storms" : `Category ${s.cat}`;
  const tk = s.kind === "storms" ? `${b.code}STORM` : `${b.code}CAT${s.cat}`;
  if (inverse) return { name: `Calm Days ${b.code}`, ticker: `CALM${b.code}`.slice(0, 10), oneLiner: `burns on every day no new ${what} is counted`, oneShot: false,
    block: `For every day on which no storm in ${b.label} is first counted as a ${s.kind === "storms" ? "named storm" : `category ${s.cat} hurricane`}, ${spends}, with a receipt on chain. ${src} A day that counts a storm burns nothing.` };
  return { name: `${b.code} ${short}`, ticker: tk.slice(0, 10), oneLiner: `burns for every ${what}`, oneShot: false,
    block: `For every ${what}, ${spends}, with a receipt on chain. ${src} The reading is a wind category and a count of storms and nothing else.` };
}
