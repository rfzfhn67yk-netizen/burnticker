import type { BurnRule } from "@/lib/burnticker/rules";
import { NHC_BASINS, NHC_SEASON_END, parseNhcSeries } from "@/lib/burnticker/sources/nhc";
import { pctLabel } from "@/lib/burnticker/launchPresets";

/**
 * HB-93 (hourly run 7): a "When it does not happen" hurricane coin burns on every day no storm is counted, and outside the basin's
 * season no storm can be counted, so it burns every off-season day. The review's "Unusual cases" says so, and the back-test says how many
 * of its burns fell outside the season. The season dates come from the source (sources/nhc.ts NHC_BASINS seasonStart and NHC_SEASON_END).
 * Only the per-event NHC series have a season this way; the other hazards (earthquakes, tornado reports, fires, volcano alerts) are read
 * all year, so they have no off-season line.
 */
export interface HazardSeason { label: string; start: string; end: string; startWords: string; endWords: string }
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const mdWords = (md: string): string => { const [m, d] = md.split("-").map(Number); return `${MONTHS[m - 1]} ${d}`; };

/** The season of a per-event hurricane or named-storm series (null: any other series, including the one-shot, which ends with its season). */
export function hazardSeasonOf(series: string | null | undefined): HazardSeason | null {
  const s = series ? parseNhcSeries(series) : null;
  if (!s || s.kind === "next") return null;
  const b = NHC_BASINS[s.basin];
  if (!b) return null;
  return { label: b.label, start: b.seasonStart, end: NHC_SEASON_END, startWords: mdWords(b.seasonStart), endWords: mdWords(NHC_SEASON_END) };
}

/** Whether a UTC day (YYYY-MM-DD, or any ISO time) falls outside the season. */
export const outsideSeason = (season: HazardSeason, day: string): boolean => { const md = day.slice(5, 10); return md < season.start || md > season.end; };

/** The "Unusual cases" sentence for an inverse rule on a series with a season; null otherwise. */
export function offSeasonLine(rule: Pick<BurnRule, "oracle" | "series" | "inverse" | "kind" | "scalar">): string | null {
  if (!rule.inverse || rule.oracle !== "catalogue") return null;
  const season = hazardSeasonOf(rule.series);
  if (!season) return null;
  const f = (rule.kind === "scalar" ? (rule.scalar?.perUnit as { fractionOfPool?: number } | undefined)?.fractionOfPool : undefined) ?? null;
  const share = typeof f === "number" ? `${pctLabel(f)} of its pool` : "its share";
  return `Outside the season in ${season.label} (${season.startWords} to ${season.endWords}), no storm is counted, so every day counts as a day without one and this coin burns ${share} every day until the season starts again.`;
}

/** The back-test's added line: how many of the burns fell outside the season (null when the rule has no season). */
export function offSeasonBacktestLine(rule: Pick<BurnRule, "oracle" | "series" | "inverse">, burnDays: readonly string[]): string | null {
  if (!rule.inverse || rule.oracle !== "catalogue") return null;
  const season = hazardSeasonOf(rule.series);
  if (!season) return null;
  const n = burnDays.filter((d) => outsideSeason(season, d)).length;
  return n === 0
    ? `None of those burns fell outside the season (${season.startWords} to ${season.endWords}). Off-season days would each burn.`
    : `${n} of those burns fell outside the season (${season.startWords} to ${season.endWords}), on days when no storm can be counted.`;
}
