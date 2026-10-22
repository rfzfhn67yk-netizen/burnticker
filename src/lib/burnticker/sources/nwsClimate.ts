import CLIMATE from "../../../../config/burnticker/fixtures/nws/climatology.json" with { type: "json" };
import { parseNwsSeries, stationByCode } from "@/lib/burnticker/sources/nws";

/**
 * HOW OFTEN A WEATHER THRESHOLD FIRES AT ITS STATION (QA pass 9 #16, 2026-10-13: "Denver high at 40 °F or hotter" burns almost every day and
 * "Phoenix rain of 3 inches" almost never, and nothing said so). From the station's own history: the Iowa Environmental Mesonet's ASOS
 * daily summaries for 2016 to 2025 (config/burnticker/fixtures/nws/climatology.json), days a year at or above each whole °F and each
 * hundredth of an inch. A warning only: the rule is the creator's, and settlement never reads this table. A first-snow rule has none.
 */
type Clim = { stations: Record<string, { years: string; highAtLeast: Record<string, number>; rainAtLeast: Record<string, number> }> };
const C = CLIMATE as unknown as Clim;
export const OFTEN_DAYS = 300, RARELY_DAYS = 2;
export interface Frequency { daysPerYear: number; years: string; line: string; warning: string | null }

/** Days a year the rule fires at its station (the fade side: the days it does not reach the threshold), or null with no history. */
export function weatherFrequency(series: string, inverse = false): Frequency | null {
  const n = parseNwsSeries(series);
  if (!n || n.metric === "snow") return null;
  const st = stationByCode(n.station), row = C.stations[n.station];
  if (!st || !row) return null;
  let d: number | undefined;
  if (n.metric === "high") d = row.highAtLeast[String(Math.max(-20, Math.min(125, Math.round(n.threshold))))];
  else { const k = Math.round(n.threshold * 100); d = k > 300 ? 0 : row.rainAtLeast[(Math.max(1, k) / 100).toFixed(2)]; }
  if (d === undefined) return null;
  const days = Math.max(0, Math.round((inverse ? 365.25 - d : d) * 10) / 10);
  const rounded = days >= 10 ? Math.round(days) : Math.round(days * 10) / 10;
  const span = row.years.replace("-", " to ");
  const what = n.metric === "high" ? `a high of ${n.threshold} °F or more` : `${n.threshold.toFixed(2)} in of rain or more`;
  const line = `At ${st.label}, ${inverse ? `a day without ${what}` : what} came about ${rounded} ${rounded === 1 ? "day" : "days"} a year from ${span}.`;
  // HB-95 (hourly run 7): a threshold beyond the station's recorded range names the record (no day in those years would have burned)
  const rec = n.metric === "high" ? highRecordWarning(n.threshold, inverse, st.label, row) : null;
  const warning = rec ?? (days >= OFTEN_DAYS ? `${line} This rule fires on almost every day, so the pool is spent quickly.` : days <= RARELY_DAYS ? `${line} This rule may not fire at all for a year or more.` : null);
  return { daysPerYear: days, years: row.years, line, warning };
}

/** The station's recorded daily highs from its table: the highest (the top key with a day on record) and the lowest (null at the table's edge). */
export function highRecords(row: { highAtLeast: Record<string, number> }): { highest: number | null; lowest: number | null } {
  const ks = Object.keys(row.highAtLeast).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!ks.length) return { highest: null, lowest: null };
  const top = ks[ks.length - 1], bottom = ks[0];
  const withDays = ks.filter((k) => (row.highAtLeast[String(k)] ?? 0) > 0);
  const highest = withDays.length && withDays[withDays.length - 1] < top ? withDays[withDays.length - 1] : null;
  const all = row.highAtLeast[String(bottom)] ?? 0;
  // the lowest daily high: the last key every day reaches (within the table's rounding to a tenth of a day)
  const every = ks.filter((k) => (row.highAtLeast[String(k)] ?? 0) >= all - 0.05);
  const lowest = every.length && every[every.length - 1] > bottom ? every[every.length - 1] : null;
  return { highest, lowest };
}
function highRecordWarning(t: number, inverse: boolean, label: string, row: { years: string; highAtLeast: Record<string, number> }): string | null {
  const r = highRecords(row), span = row.years.replace("-", " to ");
  if (!inverse && r.highest !== null && t > r.highest) return `The highest daily high on record at ${label} from ${span} is ${r.highest} °F, so no day in those years would have burned at ${t} °F. Lower the threshold or keep the coin as it is.`;
  if (inverse && r.lowest !== null && t <= r.lowest) return `The lowest daily high on record at ${label} from ${span} is ${r.lowest} °F, so no day in those years had a high below ${t} °F and none would have burned. Raise the threshold or keep the coin as it is.`;
  return null;
}
