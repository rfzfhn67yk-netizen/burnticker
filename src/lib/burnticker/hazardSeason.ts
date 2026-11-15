import type { BurnRule } from "@/lib/burnticker/rules";
import { SPC_STATES, parseSpcSeries } from "@/lib/burnticker/sources/spc";
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

/**
 * HB-137 (hourly run 12): a "When it does not happen" tornado coin on an area where tornado reports almost never come (Alaska, Hawaii,
 * Rhode Island, the District of Columbia) burns its share on nearly every day, for life: at 2% about 45% of its pool a month. The burn
 * step's fade card and the review say so; an area whose saved sample held no report at all (every sampled day burned) says that too.
 */
export const RARE_TORNADO_AREAS: readonly string[] = ["AK", "HI", "RI", "DC"];
/** HB-150: the shortest saved sample (in days) whose having no report at all makes an area outside the fixed list "rare". */
export const RARE_SAMPLE_MIN_DAYS = 30;
const perUnitShare = (rule: Pick<BurnRule, "kind" | "scalar">): number | null => {
  const f = rule.kind === "scalar" ? (rule.scalar?.perUnit as { fractionOfPool?: number } | undefined)?.fractionOfPool : undefined;
  return typeof f === "number" && f > 0 && f < 1 ? f : null;
};
export function rareFadeLine(rule: Pick<BurnRule, "oracle" | "series" | "inverse" | "kind" | "scalar">, sample: { from: string | null; to: string | null; triggers: number | null } | null = null): string | null {
  if (!rule.inverse || rule.oracle !== "catalogue") return null;
  const s = rule.series ? parseSpcSeries(rule.series) : null;
  if (!s || s.kind !== "count" || s.area === "US") return null;
  const days = sample?.from && sample.to ? Math.round((Date.parse(sample.to) - Date.parse(sample.from)) / 86_400_000) + 1 : 0;
  // HB-150 (hourly run 13): one quiet week proves nothing (a Texas October week can be empty); only a sample of RARE_SAMPLE_MIN_DAYS or
  // more with no report at all calls an area outside the fixed list rare
  const noneInSample = days >= RARE_SAMPLE_MIN_DAYS && sample!.triggers !== null && sample!.triggers >= days;
  if (!RARE_TORNADO_AREAS.includes(s.area) && !noneInSample) return null;
  const f = perUnitShare(rule), place = SPC_STATES[s.area] ?? s.area;
  const share = f !== null ? `${pctLabel(f)} of its pool` : "its share";
  const month = f !== null ? `: about ${Math.round((1 - (1 - f) ** 30) * 100)}% of its pool a month` : "";
  return `Tornado reports in ${place} are rare${noneInSample ? " (none in the saved sample)" : ""}, so this coin burns ${share} on almost every day${month}, for as long as it lives.`;
}
