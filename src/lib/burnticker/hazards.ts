import type { BurnRule } from "@/lib/burnticker/rules";
import { dialsFor } from "@/lib/burnticker/dials";
import { PATTERN_REASON, PATTERNS, type PatternId, type PatternOption } from "@/lib/burnticker/guidedLaunch";
import { NEXT_EVENT_ONE_SHOT_RE } from "@/lib/burnticker/inverse";
import { parseUsgsNextSeries, parseUsgsSeries, USGS_NEXT_MAGNITUDES } from "@/lib/burnticker/sources/usgs";
import { nhcSeasonOpen, parseNhcSeries } from "@/lib/burnticker/sources/nhc";
import { parseSpcSeries } from "@/lib/burnticker/sources/spc";
import { parseNifcSeries } from "@/lib/burnticker/sources/nifc";
import { parseVolcanoSeries } from "@/lib/burnticker/sources/volcano";

/**
 * NATURAL DISASTERS AS A LAUNCH OPTION (sources-3, 2026-10-12; the owner: "de-emphasize weather and promote natural disasters as an
 * option; burn per event or burn 100% on the next event"). The pieces the guided launch needs, kept out of the launch page (another
 * agent owns it; WIRING-SOURCES3.md says where each piece goes):
 *
 *   HAZARD_FOLLOW     the step-1 entry card: a label, one line, one example
 *   HAZARD_KINDS      the five publishers for step 2, each with the series a new coin starts from in both patterns
 *   HAZARD_PATTERNS   the step-3 choice between the two patterns, said plainly
 *   hazardSwap        the same subject in the other pattern (the per-event count and the next-event one-shot are sibling series), or
 *                     the reason it cannot switch (a hurricane season that is over)
 *
 * The line not crossed (the owner): a coin counts an instrument's reading, never harm. Every sentence here is plain copy
 * (test/burntickerPlainCopy.test.ts) and passes the copy lint (test/burntickerSources3.test.ts). Client-safe.
 */

export const HAZARD_FOLLOW = {
  id: "disaster" as const,
  label: "A natural disaster",
  line: "Earthquakes, hurricanes, tornadoes, wildfires or volcanoes, counted by their readings.",
  sentence: "A reading from a public science agency: a quake's magnitude, a storm's category, a count of tornado reports, acres of wildfire or a volcano's alert level. The coin counts the reading and nothing else.",
  example: "For example, burn once on the next earthquake of magnitude 7 or more.",
};

export type HazardKindId = "quake" | "hurricane" | "tornado" | "wildfire" | "volcano";
/** Step 2: the five publishers, in the order the owner listed them; `every` and `once` are the series a new coin starts from. */
export const HAZARD_KINDS: readonly { id: HazardKindId; label: string; publisher: string; every: string; once: (year: number) => string }[] = [
  { id: "quake", label: "Earthquakes", publisher: "U.S. Geological Survey", every: "usgs.quakes:6", once: () => "usgs.quakenext:7" },
  { id: "hurricane", label: "Hurricanes", publisher: "National Hurricane Center", every: "nhc.hurricanes:al.1", once: (y) => `nhc.next:al.3.${y}` },
  { id: "tornado", label: "Tornadoes", publisher: "Storm Prediction Center", every: "spc.tornadoes:US", once: () => "spc.tornadoday:10/US" },
  { id: "wildfire", label: "Wildfires", publisher: "National Interagency Fire Center", every: "nifc.acres", once: () => "nifc.firesize:100000" },
  { id: "volcano", label: "Volcanoes", publisher: "U.S. Geological Survey", every: "usgs.volcanoraise", once: () => "usgs.volcanowarning:332010" },
];

/** Step 3: the two patterns a natural-disaster coin offers (the fade side stays available on the per-event form, as on any feed). */
export const HAZARD_PATTERNS = {
  every: { label: "Every time it happens", sentence: "The coin burns a share of its pool for each qualifying event, such as each earthquake at the magnitude or each storm that reaches the category." },
  once: { label: "Once, on the next one", sentence: "The coin burns its whole pool, or half of it, once, on the first qualifying event after launch." },
} as const;

/** The season-over reason for a hurricane one-shot (the same words as the review's refusal). */
export const HAZARD_SEASON_OVER = "This hurricane season is over, so a coin on its next storm is not offered.";

/** Whether a series is one of the natural-disaster series (either pattern). */
export const isHazardSeries = (series: string | null | undefined): boolean => !!series && (NEXT_EVENT_ONE_SHOT_RE.test(series) || !!parseUsgsSeries(series) || !!parseNhcSeries(series) || !!parseSpcSeries(series) || !!parseNifcSeries(series) || !!parseVolcanoSeries(series));

const yearOf = (nowMs: number) => new Date(nowMs).getUTCFullYear();
const clampMag = (m: string): string => { const n = Math.min(8, Math.max(6, Math.round(Number(m) * 2) / 2)); return (USGS_NEXT_MAGNITUDES as readonly string[]).includes(String(n)) ? String(n) : "7"; };

/**
 * The same subject in the other pattern: the per-event series ↔ its next-event one-shot. A magnitude below 6 becomes 6 for the one-shot;
 * a named-storm count becomes the next category 1 hurricane; a state's tornado count becomes the next day with a report there (10 reports
 * nationally); the year's acres become the next 100,000-acre fire; alert raises become Kilauea's next WARNING (step 2 picks the volcano).
 */
export function hazardSwap(series: string, to: "every" | "once", nowMs: number): { series: string } | { refused: string } | null {
  const u = parseUsgsSeries(series), un = parseUsgsNextSeries(series);
  if (u) return to === "every" ? { series } : { series: `usgs.quakenext:${clampMag(u.magnitude)}${u.region ? `/${u.region}` : ""}` };
  if (un) return to === "once" ? { series } : { series: `usgs.quakes:${un.magnitude}${un.region ? `/${un.region}` : ""}` };
  const h = parseNhcSeries(series);
  if (h) {
    if (to === "every") return { series: h.kind === "next" ? `nhc.hurricanes:${h.basin}.${h.cat}` : series };
    if (h.kind === "next") return nhcSeasonOpen(h.year, nowMs) ? { series } : { refused: HAZARD_SEASON_OVER };
    const y = yearOf(nowMs);
    return nhcSeasonOpen(y, nowMs) ? { series: `nhc.next:${h.basin}.${h.kind === "hurricanes" ? h.cat : 1}.${y}` } : { refused: HAZARD_SEASON_OVER };
  }
  const s = parseSpcSeries(series);
  if (s) return to === "every" ? { series: `spc.tornadoes:${s.area}` } : { series: s.kind === "day" ? series : `spc.tornadoday:${s.area === "US" ? 10 : 1}/${s.area}` };
  const f = parseNifcSeries(series);
  if (f) return to === "every" ? { series: "nifc.acres" } : { series: f.kind === "size" ? series : "nifc.firesize:100000" };
  const v = parseVolcanoSeries(series);
  if (v) return to === "every" ? { series: "usgs.volcanoraise" } : { series: v.kind === "warning" ? series : "usgs.volcanowarning:332010" };
  return null;
}

/**
 * Step 3 for a natural-disaster coin: the four pattern cards with the two hazard patterns live. "Every time it happens" and "Once, on the
 * next one" are both available whichever form step 2 built (the page swaps the series with hazardSwap); the fade side follows the rule's
 * own dials (the per-event form takes it, the one-shot does not); winner-takes-the-burn needs two linked coins.
 */
export function hazardPatternOptions(rule: BurnRule, nowMs: number): { options: PatternOption[]; preselected: PatternId } {
  const series = rule.series ?? "";
  const once = NEXT_EVENT_ONE_SHOT_RE.test(series);
  const swap = hazardSwap(series, "once", nowMs);
  const onceReason = swap && "refused" in swap ? swap.refused : null;
  const fadeReason = once ? PATTERN_REASON.oneShotFade : dialsFor(rule).inverse ? null : PATTERN_REASON.oneShotFade;
  const mk = (id: PatternId, reason: string | null, label?: string, sentence?: string): PatternOption => ({ id, label: label ?? PATTERNS[id].label, sentence: sentence ?? PATTERNS[id].sentence, available: reason === null, reason });
  return {
    options: [mk("every", null, HAZARD_PATTERNS.every.label, HAZARD_PATTERNS.every.sentence), mk("fade", fadeReason), mk("once", onceReason, HAZARD_PATTERNS.once.label, HAZARD_PATTERNS.once.sentence), mk("winner", PATTERN_REASON.needsTwo)],
    preselected: once ? "once" : rule.inverse ? "fade" : "every",
  };
}
