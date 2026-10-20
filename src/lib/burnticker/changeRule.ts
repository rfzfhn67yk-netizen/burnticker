import { isHazardSeries } from "@/lib/burnticker/hazards";

/**
 * HB-4 (2026-10-19): the review's "Unusual cases" for a scalar rule (ruleEdgeCases.ts). Items 85 (the first reading after launch is the
 * starting point) and 111 (what an up rule counts: 100 then 103 burns 3 units) describe a rule that measures CHANGE: published data read
 * against its previous reading (a moving baseline), such as the debt. A natural-disaster count (earthquakes, storms, tornado reports,
 * acres, alert raises) has a fixed baseline and counts events, so neither sentence applies there. Item 87 (a missing reading is not a
 * zero) applies to every scalar rule. Pure and client-safe.
 */
export const isMovingBaselineChangeRule = (rule: { kind: string; series: string | null; scalar: { baseline: unknown } | null }): boolean =>
  rule.kind === "scalar" && rule.scalar?.baseline === "previousSettlement" && !isHazardSeries(rule.series);

/**
 * Continuous audit run 4, HB-36: 87 is about a published figure that can go unreported for a day. A team's win count (espn.*) and a
 * count of events (earthquakes, storms, tornado reports) are counts of things that happened, where a day with nothing is simply nothing,
 * so neither gets it.
 */
export function changeRuleEdgeIds(rule: { kind: string; series: string | null; scalar: { baseline: unknown } | null }): number[] {
  if (rule.kind !== "scalar") return [];
  if (/^espn\./.test(rule.series ?? "") || isHazardSeries(rule.series)) return [];
  return isMovingBaselineChangeRule(rule) ? [85, 111, 87] : [87];
}
