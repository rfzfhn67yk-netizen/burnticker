import type { BurnRule } from "@/lib/burnticker/rules";
import { dialsFor } from "@/lib/burnticker/dials";
import { PATTERN_REASON, PATTERNS, type PatternId, type PatternOption } from "@/lib/burnticker/guidedLaunch";
import { NEXT_EVENT_ONE_SHOT_RE } from "@/lib/burnticker/inverse";
import { parseUsgsNextSeries, parseUsgsSeries, USGS_MAGNITUDES, USGS_NEXT_MAGNITUDES, USGS_REGIONS } from "@/lib/burnticker/sources/usgs";
import { NHC_BASINS, nhcSeasonOpen, parseNhcSeries } from "@/lib/burnticker/sources/nhc";
import { parseSpcSeries, SPC_DAY_COUNTS, SPC_STATES } from "@/lib/burnticker/sources/spc";
import { NIFC_SIZES, parseNifcSeries } from "@/lib/burnticker/sources/nifc";
import { parseVolcanoSeries, US_VOLCANOES } from "@/lib/burnticker/sources/volcano";

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
  every: { label: "Every time it happens", sentence: "The coin burns a share of its pool for each qualifying event the source reports." },
  once: { label: "Once, on the next one", sentence: "The coin burns its whole pool once, on the first qualifying event after launch." },
} as const;
/**
 * HB-5 (2026-10-19): the "Once" card says only the shares the share row offers. Half the pool is offered only where the host runs burn
 * dispersal (launchPresets.ts SHARE_PRESETS.oneShotDispersal, the catalogue's `burn-dispersal` source); everywhere else 100% is the one choice.
 */
export const HAZARD_ONCE_HALF_SENTENCE = "The coin burns its whole pool, or half of it, once, on the first qualifying event after launch.";
export const hazardOnceSentence = (dispersal: boolean): string => (dispersal ? HAZARD_ONCE_HALF_SENTENCE : HAZARD_PATTERNS.once.sentence);
/**
 * Continuous audit HB-32 (run 3): the "Every time it happens" card on a hurricane coin spoke of earthquakes and magnitudes. Each kind
 * now says its own event and its own threshold words, matching the controls above ("or stronger" for a storm's category).
 */
export const HAZARD_EVERY_SENTENCES: Readonly<Record<HazardKindId, string>> = {
  quake: "The coin burns a share of its pool for each earthquake at or above the magnitude you pick.",
  hurricane: "The coin burns a share of its pool for each storm that reaches the strength you pick, category 1 or stronger, or any named storm.",
  tornado: "The coin burns a share of its pool for each tornado report in the area you pick.",
  wildfire: "The coin burns a share of its pool for each 100,000 acres added to the year's national total of acres burned.",
  volcano: "The coin burns a share of its pool each time the USGS raises the alert level at a U.S. volcano it monitors.",
};
/** The hazard kind a series belongs to (either pattern), or null for any other series. */
export function hazardKindOf(series: string | null | undefined): HazardKindId | null {
  const s = series ?? "";
  if (!s) return null;
  if (parseUsgsSeries(s) || parseUsgsNextSeries(s)) return "quake";
  if (parseNhcSeries(s)) return "hurricane";
  if (parseSpcSeries(s)) return "tornado";
  if (parseNifcSeries(s)) return "wildfire";
  if (parseVolcanoSeries(s)) return "volcano";
  return null;
}
export const hazardEverySentence = (series: string | null | undefined): string => { const k = hazardKindOf(series); return k ? HAZARD_EVERY_SENTENCES[k] : HAZARD_PATTERNS.every.sentence; };

/** The season-over reason for a hurricane one-shot (the same words as the review's refusal). */
export const HAZARD_SEASON_OVER = "This hurricane season is over, so a coin on its next storm is not offered.";

/**
 * THE THRESHOLD CONTROLS (QA pass 9 #40, 2026-10-13): what each adapter can read, per pattern, as choices the page can offer (GET
 * /v1/catalogue `hazards`). Only values the adapter supports are listed: earthquakes by magnitude and region (4 to 8.5 for every event, 6
 * to 8 for the next one), hurricanes by category and basin (a named-storm count is category 0 in the every-event form), tornadoes by count
 * and state (the next-day form only; the every-event form counts every report), wildfires by fire size (the next-fire form; the every-
 * event form counts acres in the national total), and a specific volcano (the next-warning form; the every-event form counts any alert
 * raise at any U.S. volcano).
 */
export interface HazardControl { id: "magnitude" | "region" | "category" | "basin" | "count" | "area" | "acres" | "volcano"; label: string; options: { value: string; label: string }[]; default: string }
export function hazardControls(): Record<HazardKindId, { every: HazardControl[]; once: HazardControl[] }> {
  const regions = [{ value: "", label: "Worldwide" }, ...Object.entries(USGS_REGIONS).map(([value, r]) => ({ value, label: r.label[0].toUpperCase() + r.label.slice(1) }))];
  const basins = Object.entries(NHC_BASINS).map(([value, b]) => ({ value, label: b.label[0].toUpperCase() + b.label.slice(1) }));
  const areas = [{ value: "US", label: "The United States" }, ...Object.entries(SPC_STATES).map(([value, label]) => ({ value, label }))];
  return {
    quake: { every: [{ id: "magnitude", label: "Magnitude at least", options: USGS_MAGNITUDES.map((m) => ({ value: m, label: `M${m}` })), default: "6" }, { id: "region", label: "Where", options: regions, default: "" }],
      once: [{ id: "magnitude", label: "Magnitude at least", options: USGS_NEXT_MAGNITUDES.map((m) => ({ value: m, label: `M${m}` })), default: "7" }, { id: "region", label: "Where", options: regions, default: "" }] },
    hurricane: { every: [{ id: "category", label: "Strength", options: [{ value: "0", label: "Any named storm" }, ...[1, 2, 3, 4, 5].map((c) => ({ value: String(c), label: `Category ${c} or stronger` }))], default: "1" }, { id: "basin", label: "Basin", options: basins, default: "al" }],
      once: [{ id: "category", label: "Strength", options: [1, 2, 3, 4, 5].map((c) => ({ value: String(c), label: `Category ${c} or stronger` })), default: "3" }, { id: "basin", label: "Basin", options: basins, default: "al" }] },
    tornado: { every: [{ id: "area", label: "Where", options: areas, default: "US" }],
      once: [{ id: "count", label: "Reports in one day, at least", options: SPC_DAY_COUNTS.map((n) => ({ value: String(n), label: String(n) })), default: "10" }, { id: "area", label: "Where", options: areas, default: "US" }] },
    wildfire: { every: [], once: [{ id: "acres", label: "One fire of at least", options: NIFC_SIZES.map((a) => ({ value: String(a), label: `${a.toLocaleString("en-US")} acres` })), default: "100000" }] },
    volcano: { every: [], once: [{ id: "volcano", label: "Volcano", options: Object.entries(US_VOLCANOES).sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })), default: "332010" }] },
  };
}
/**
 * WHAT EACH PATTERN MEASURES (audit 10 #18, 2026-10-13: the two wildfire forms read the same and are not). One sentence per kind and
 * pattern, from the adapters (sources/nifc.ts, usgs.ts, nhc.ts, spc.ts, volcano.ts).
 */
export const HAZARD_MEASURES: Readonly<Record<HazardKindId, { every: string; once: string }>> = {
  quake: { every: "Each reviewed earthquake at or above the magnitude counts once, on its UTC day.", once: "The first UTC day after launch with a reviewed earthquake at or above the magnitude burns once, and the coin then ends." },
  hurricane: { every: "Each storm counts once, on the day it first reaches the strength, in the basin's season.", once: "The first day after launch on which a storm in the basin reaches the category burns once. The coin ends with the season if none does." },
  tornado: { every: "Each preliminary tornado report in the area counts, on its UTC day.", once: "The first UTC day after launch with at least the count of reports in the area burns once." },
  wildfire: { every: "Recurring: each 100,000 acres added to the year's national total of acres burned counts, across all fires together.", once: "One time: the first single wildfire discovered after launch that reaches the size burns once, dated on its discovery day. Acres from other fires do not add up toward it." },
  volcano: { every: "Each time the USGS raises the alert level at any U.S. volcano it monitors, that raise counts.", once: "The first time after launch that the USGS raises the chosen volcano to WARNING burns once." },
};
/** HB-75 (hourly run 5): the help beside a control: an area picker gets the area help, every other control the threshold help (fieldHelp.ts). */
export const hazardHelpId = (id: HazardControl["id"]): "hazard-area" | "hazard-threshold" => (id === "area" || id === "region" || id === "basin" ? "hazard-area" : "hazard-threshold");
/** GET /v1/catalogue `hazards`: the five kinds with their controls and what each pattern measures. */
export const hazardCatalogue = (): { id: HazardKindId; label: string; publisher: string; measures: { every: string; once: string }; controls: { every: HazardControl[]; once: HazardControl[] } }[] =>
  HAZARD_KINDS.map((k) => ({ id: k.id, label: k.label, publisher: k.publisher, measures: HAZARD_MEASURES[k.id], controls: hazardControls()[k.id] }));
/**
 * The series for a kind, a pattern and the chosen values, or why not: a value the pattern does not offer is refused in words, never
 * replaced by another one.
 */
export function hazardSeriesFor(kind: HazardKindId, pattern: "every" | "once", v: Record<string, string | undefined>, nowMs: number): { series: string } | { refused: string } {
  const c = hazardControls()[kind][pattern];
  for (const ctl of c) { const x = v[ctl.id]; if (x !== undefined && !ctl.options.some((o) => o.value === x)) return { refused: `${ctl.label} ${x === "" ? "(blank)" : x} is not offered for this pattern. The choices are ${ctl.options.slice(0, 8).map((o) => o.label).join(", ")}${ctl.options.length > 8 ? " and more" : ""}.` }; }
  const val = (id: HazardControl["id"]) => v[id] ?? c.find((x) => x.id === id)?.default ?? "";
  const y = yearOf(nowMs);
  if (kind === "quake") { const r = val("region"); return { series: `${pattern === "every" ? "usgs.quakes" : "usgs.quakenext"}:${val("magnitude")}${r ? `/${r}` : ""}` }; }
  if (kind === "hurricane") {
    if (pattern === "every") return { series: val("category") === "0" ? `nhc.storms:${val("basin")}` : `nhc.hurricanes:${val("basin")}.${val("category")}` };
    return nhcSeasonOpen(y, nowMs) ? { series: `nhc.next:${val("basin")}.${val("category")}.${y}` } : { refused: HAZARD_SEASON_OVER };
  }
  if (kind === "tornado") return { series: pattern === "every" ? `spc.tornadoes:${val("area")}` : `spc.tornadoday:${val("count")}/${val("area")}` };
  if (kind === "wildfire") return { series: pattern === "every" ? "nifc.acres" : `nifc.firesize:${val("acres")}` };
  return { series: pattern === "every" ? "usgs.volcanoraise" : `usgs.volcanowarning:${val("volcano")}` };
}
/** Whether a series is one of the natural-disaster series (either pattern). */
export const isHazardSeries = (series: string | null | undefined): boolean => !!series && (NEXT_EVENT_ONE_SHOT_RE.test(series) || !!parseUsgsSeries(series) || !!parseNhcSeries(series) || !!parseSpcSeries(series) || !!parseNifcSeries(series) || !!parseVolcanoSeries(series));

const yearOf = (nowMs: number) => new Date(nowMs).getUTCFullYear();
const clampMag = (m: string): string => { const n = Math.min(8, Math.max(6, Math.round(Number(m) * 2) / 2)); return (USGS_NEXT_MAGNITUDES as readonly string[]).includes(String(n)) ? String(n) : "7"; };

/**
 * The same subject in the other pattern: the per-event series ↔ its next-event one-shot. A magnitude below 6 becomes 6 for the one-shot;
 * a named-storm count becomes the next category 1 hurricane; a state's tornado count becomes the next day with a report there (10 reports
 * nationally); the year's acres become the next 100,000-acre fire; alert raises become Kilauea's next WARNING (step 2 picks the volcano).
 */
export function hazardSwap(series: string, to: "every" | "once", nowMs: number): { series: string; /** QA pass 9 #40: what changed, said whenever a threshold or subject is not carried over as it was */ notice?: string } | { refused: string } | null {
  const u = parseUsgsSeries(series), un = parseUsgsNextSeries(series);
  if (u) {
    if (to === "every") return { series };
    const m = clampMag(u.magnitude);
    return { series: `usgs.quakenext:${m}${u.region ? `/${u.region}` : ""}`, ...(m !== u.magnitude ? { notice: `The next-earthquake form offers magnitude 6 to 8, so magnitude ${u.magnitude} is now magnitude ${m}. Pick another magnitude if you want.` } : {}) };
  }
  if (un) return to === "once" ? { series } : { series: `usgs.quakes:${un.magnitude}${un.region ? `/${un.region}` : ""}` };
  const h = parseNhcSeries(series);
  if (h) {
    if (to === "every") return { series: h.kind === "next" ? `nhc.hurricanes:${h.basin}.${h.cat}` : series };
    if (h.kind === "next") return nhcSeasonOpen(h.year, nowMs) ? { series } : { refused: HAZARD_SEASON_OVER };
    const y = yearOf(nowMs);
    return nhcSeasonOpen(y, nowMs) ? { series: `nhc.next:${h.basin}.${h.kind === "hurricanes" ? h.cat : 1}.${y}`, ...(h.kind === "storms" ? { notice: "The next-storm form needs a hurricane category, so any named storm is now a category 1 hurricane. Pick another category if you want." } : {}) } : { refused: HAZARD_SEASON_OVER };
  }
  const s = parseSpcSeries(series);
  if (s) {
    if (to === "every") return { series: `spc.tornadoes:${s.area}`, ...(s.kind === "day" ? { notice: `The every-event form counts each tornado report, so the bar of ${s.n} report${s.n === 1 ? "" : "s"} in one day no longer applies.` } : {}) };
    if (s.kind === "day") return { series };
    const n = s.area === "US" ? 10 : 1;
    return { series: `spc.tornadoday:${n}/${s.area}`, notice: `The next-day form needs a count of reports in one day, so it starts at ${n}. Pick another count if you want.` };
  }
  const f = parseNifcSeries(series);
  if (f) {
    if (to === "every") return { series: "nifc.acres", ...(f.kind === "size" ? { notice: "The every-event form counts acres in the year's national total, not the size of one fire, so the fire size no longer applies." } : {}) };
    return f.kind === "size" ? { series } : { series: "nifc.firesize:100000", notice: "The next-fire form needs the size of one fire, so it starts at 100,000 acres. Pick another size if you want." };
  }
  const v = parseVolcanoSeries(series);
  if (v) {
    if (to === "every") return { series: "usgs.volcanoraise", ...(v.kind === "warning" ? { notice: `The every-event form counts an alert raise at any U.S. volcano, not only ${v.name}.` } : {}) };
    return v.kind === "warning" ? { series } : { series: "usgs.volcanowarning:332010", notice: "The next-warning form follows one volcano, so it starts with Kilauea. Pick another volcano if you want." };
  }
  return null;
}

/**
 * Step 3 for a natural-disaster coin: the four pattern cards with the two hazard patterns live. "Every time it happens" and "Once, on the
 * next one" are both available whichever form step 2 built (the page swaps the series with hazardSwap); the fade side follows the rule's
 * own dials (the per-event form takes it, the one-shot does not); winner-takes-the-burn needs two linked coins.
 */
export function hazardPatternOptions(rule: BurnRule, nowMs: number, o: { dispersal?: boolean } = {}): { options: PatternOption[]; preselected: PatternId } {
  const series = rule.series ?? "";
  const once = NEXT_EVENT_ONE_SHOT_RE.test(series);
  const swap = hazardSwap(series, "once", nowMs);
  const onceReason = swap && "refused" in swap ? swap.refused : null;
  const fadeReason = once ? PATTERN_REASON.oneShotFade : dialsFor(rule).inverse ? null : PATTERN_REASON.oneShotFade;
  const mk = (id: PatternId, reason: string | null, label?: string, sentence?: string): PatternOption => ({ id, label: label ?? PATTERNS[id].label, sentence: sentence ?? PATTERNS[id].sentence, available: reason === null, reason });
  return {
    options: [mk("every", null, HAZARD_PATTERNS.every.label, hazardEverySentence(series)), mk("fade", fadeReason), mk("once", onceReason, HAZARD_PATTERNS.once.label, hazardOnceSentence(o.dispersal === true)), mk("winner", PATTERN_REASON.needsTwo)],
    preselected: hazardPreselected({ series, inverse: !!rule.inverse }),
  };
}

/** A natural-disaster coin's pattern state: its series and whether the fade side (burn when it does not happen) is on. */
export interface HazardPatternState { series: string; inverse: boolean }
/** The card a state shows as chosen: a next-event series is "once", the fade side "fade", else "every". */
export const hazardPreselected = (s: HazardPatternState): PatternId => (NEXT_EVENT_ONE_SHOT_RE.test(s.series) ? "once" : s.inverse ? "fade" : "every");
/**
 * HB-71 (hourly run 5): the step-3 card switch as a pure reducer. "Every time it happens" and "Once" always turn the fade side off (the
 * page left it on, so after "When it does not happen" the every card could never be chosen again); "When it does not happen" moves a
 * next-event coin back to its per-event form first. Returns the next state with the notice to show, the refusal, or null (winner).
 */
export function hazardPatternSwitch(cur: HazardPatternState, pt: PatternId, nowMs: number): { next: HazardPatternState; notice: string | null } | { refused: string } | null {
  if (pt === "winner") return null;
  if (pt === "fade") {
    if (!NEXT_EVENT_ONE_SHOT_RE.test(cur.series)) return { next: { series: cur.series, inverse: true }, notice: null };
    const back = hazardSwap(cur.series, "every", nowMs);
    if (!back) return null;
    if ("refused" in back) return back;
    return { next: { series: back.series, inverse: true }, notice: null };
  }
  const sw = hazardSwap(cur.series, pt === "once" ? "once" : "every", nowMs);
  if (!sw) return null;
  if ("refused" in sw) return sw;
  return { next: { series: sw.series, inverse: false }, notice: sw.notice ?? null };
}

/**
 * Continuous audit HB-117 (run 10): the site's own showcase, the one-shot magnitude-6 earthquake coin, could not be copied. Its generated
 * ticker $NEXTM6 and name "Next Magnitude 6" both belong to the live coin, and the digit endings every other coin falls back on are no
 * way out here: the lookalike skeleton drops the digits that do not read as letters, and the rest are one letter away ($NEXTM62 and
 * $NEXTM63 both read as $NEXTM6). So a natural-disaster coin's free alternatives add the hazard's own word to the ticker and the name
 * ("Next Magnitude 6 Quake", $QUAKENXTM6). Best first; every ticker is 2 to 10 letters or digits; each name pairs with its ticker.
 */
const HAZARD_ALT_WORDS: Readonly<Record<HazardKindId, readonly { t: string; n: string }[]>> = {
  quake: [{ t: "QUAKE", n: "Quake" }, { t: "TREMOR", n: "Tremor" }],
  hurricane: [{ t: "STORM", n: "Storm" }, { t: "GALE", n: "Gale" }],
  tornado: [{ t: "TWISTER", n: "Twister" }, { t: "FUNNEL", n: "Funnel" }],
  wildfire: [{ t: "BLAZE", n: "Blaze" }, { t: "EMBER", n: "Ember" }],
  volcano: [{ t: "LAVA", n: "Lava" }, { t: "ASH", n: "Ash" }],
};
const NAME_MAX_BYTES = 32;   // the program's name limit (launchFields.ts fitName)
/** The name with the hazard word added; when it would not fit, words come off the end of the generated name, never off the hazard word. */
function withWord(name: string, word: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  while (words.length && new TextEncoder().encode(`${words.join(" ")} ${word}`).length > NAME_MAX_BYTES) words.pop();
  return words.length ? `${words.join(" ")} ${word}` : word;
}
export function hazardAlternates(series: string | null | undefined, gen: { ticker: string; name: string }): { ticker: string; name: string }[] {
  const kind = hazardKindOf(series);
  const t = (gen.ticker ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!kind || !t) return [];
  // the threshold at the end of the ticker ("M6" of $QUAKEM6, "100K" of $FIRE100K), so a long ticker can still take the word
  const short = t.replace(/^NEXT/, "NXT"), tail = t.match(/[A-Z]?[0-9][A-Z0-9]*$/)?.[0] ?? "", out: { ticker: string; name: string }[] = [];
  for (const w of HAZARD_ALT_WORDS[kind]) {
    const name = withWord(gen.name, w.n);
    for (const c of [`${w.t}${t}`, `${w.t}${short}`, `${t}${w.t}`, `${short}${w.t}`, `${w.t.slice(0, 4)}${short}`, ...(tail ? [`${w.t}${tail}`, `${w.t}${short.slice(0, 3)}${tail}`] : []), `${short.slice(0, 10 - w.t.length)}${w.t}`]) {
      if (/^[A-Z0-9]{2,10}$/.test(c) && c !== t && !out.some((o) => o.ticker === c)) out.push({ ticker: c, name });
    }
  }
  return out;
}
/** HB-117: the name that goes with a free alternative ticker the review offered, or null when that ticker is not one of the hazard's own. */
export const hazardAlternateName = (series: string | null | undefined, gen: { ticker: string; name: string }, ticker: string): string | null =>
  hazardAlternates(series, gen).find((a) => a.ticker === ticker.toUpperCase())?.name ?? null;
