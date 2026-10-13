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
  const warning = days >= OFTEN_DAYS ? `${line} This rule fires on almost every day, so the pool is spent quickly.` : days <= RARELY_DAYS ? `${line} This rule may not fire at all for a year or more.` : null;
  return { daysPerYear: days, years: row.years, line, warning };
}
