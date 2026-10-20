import type { BurnRule } from "@/lib/burnticker/rules";
import { NEXT_EVENT_ONE_SHOT_RE } from "@/lib/burnticker/inverse";
import { utcDay } from "@/lib/burnticker/utcWords";
import { drainLine, drainPct as pct, spentFraction, teamDrainUnit, unitsToHalf, type DrainUnit } from "@/lib/burnticker/drain";
import { parseEspnSeries } from "@/lib/burnticker/sources/espn";
import { parseUsgsSeries } from "@/lib/burnticker/sources/usgs";
import { feedById, previewFromFixture } from "@/lib/burnticker/catalogue";
import { nativeSourceById } from "@/lib/burnticker/sources/native";
import { pctLabel } from "@/lib/burnticker/launchPresets";
import { offSeasonBacktestLine } from "@/lib/burnticker/hazardSeason";

/**
 * THE PLAIN PROJECTION (ChatGPT audit 6 item 11 and audit 7 item 6, 2026-10-12: the review said "Backtest unavailable" although the
 * catalogue keeps a saved sample for the source, e.g. $DEBTUP at 2% spends 99.99% of its pool in about six weeks). From the source's
 * saved sample, through the keeper's own unit engine (catalogue previewFromFixture → oracle/backtest unitSteps) and the program's
 * compounding spend (burnReceipts/math buybackSpend, the same call burnMath.simulateCrank makes), at 1, 2 and 5% side by side:
 *
 *   "Over the last 6 weeks this rule would have triggered 41 times and spent 99.9% of the pool at 5%."
 *
 * The pool is held constant except for what the rule spends (no new fees, no per-run cap): it says how fast the rule drains a pool, not
 * how much SOL a coin will have. A source with no saved sample (ESPN, NWS, markets) returns the reason instead of a number, and
 * `drainLine` gives the share's arithmetic alone ("At 25% per win, about 76% of the pool is gone after 5 wins").
 */
export const PROJECTION_SHARES = [0.01, 0.02, 0.05] as const;
/** The shares a projection reads: 1, 2 and 5%, and the chosen share when it is another one (a one-time 100% has no history to project). */
export const projectionShares = (chosen: number | null): number[] => [...new Set([...PROJECTION_SHARES, ...(chosen !== null && chosen > 0 && chosen < 1 ? [chosen] : [])])].sort((a, b) => a - b);
export interface ProjectionRow { share: number; triggers: number; units: number; spentPct: number }
export interface Projection { available: boolean; weeks: number | null; from: string | null; to: string | null; rows: ProjectionRow[]; lines: string[]; reason: string | null; drain: string | null }

export { spentFraction, drainLine } from "@/lib/burnticker/drain";

function withShare(rule: BurnRule, share: number): BurnRule {
  if (rule.kind === "scalar" && rule.scalar) return { ...rule, scalar: { ...rule.scalar, perUnit: { fractionOfPool: share } } };
  if (rule.binary) return { ...rule, binary: { onYes: rule.binary.onYes ? { fractionOfPool: share } : null, onNo: rule.binary.onNo ? { fractionOfPool: share } : null } };
  return rule;
}

/**
 * sources-7 (QA walkthrough 11 M4): the unit a rule burns per, in words. A team coin says win, loss or draw (the fade side "game without a
 * win"); a native source its own unit; a feed its unit label ("$1B added", "earthquake"); anything else "result".
 */
export function drainUnitFor(rule: BurnRule): DrainUnit {
  const series = rule.oracle === "catalogue" ? rule.series ?? "" : "";
  const e = series ? parseEspnSeries(series) : null;
  if (e) return teamDrainUnit(e.outcome, !!rule.inverse && e.kind === "team");
  const native = series ? nativeSourceById(series) : null;
  if (native) return native.unit.label.replace(/^1 /, "") || "result";
  const feed = series ? feedById(series) : null;
  const label = feed?.unit?.label?.replace(/^1 /, "").trim();
  if (!label) return "result";
  // "$1B added" → "additions of $1B"; "earthquake of magnitude 4 or more" → "earthquakes of magnitude 4 or more"
  const added = /^(\$[\w.,]+) added$/.exec(label);
  if (added) return { one: label, many: `additions of ${added[1]}` };
  const [first, ...rest] = label.split(" ");
  return { one: label, many: [/s$/.test(first) ? first : /y$/.test(first) ? `${first.slice(0, -1)}ies` : `${first}s`, ...rest].join(" ") };
}

/**
 * THE QUAKE SAMPLE (sources-7, QA walkthrough 11 M4: M4 worldwide at 5% showed the magnitude 5.5 sample's 38 quakes in six weeks). The
 * saved sample of usgs.quakes is the magnitude 5.5 and above worldwide catalogue (config/burnticker/fixtures/http/usgs.m55.json), so it
 * projects only that rule. For another worldwide magnitude the review uses the long-term rate instead: about 150 earthquakes a year of
 * magnitude 6 or more, and about ten times as many for each whole step down (the USGS's long-term counts, the Gutenberg-Richter rule
 * with b = 1). A regional rule has no estimate.
 */
export const USGS_SAMPLE = { magnitude: 5.5, region: null as string | null };
export const quakesPerDay = (magnitude: number): number => (150 * 10 ** (6 - magnitude)) / 365;

/**
 * The review's drain warning when the share the creator chose spends the pool fast (sources-7 M4: the national debt at 2% per $1B, and
 * earthquakes of magnitude 4 at 5% each, drained in days with no word before the collapsed backtest). From the saved sample when it is
 * this rule's own, else from a known long-term rate; null when the pool would last more than four weeks to half, or nothing is known.
 */
/** HB-37: the shortest saved sample a half-life is projected from. */
export const MIN_PROJECTION_DAYS = 14;
export function drainWarning(rule: BurnRule, p: Projection): string | null {
  const share = (rule.kind === "scalar" ? rule.scalar?.perUnit : (rule.binary?.onYes ?? rule.binary?.onNo)) as { fractionOfPool?: number } | undefined;
  const f = typeof share?.fractionOfPool === "number" ? share.fractionOfPool : null;
  if (f === null || f <= 0 || f >= 1) return null;
  const half = unitsToHalf(f);
  let perDay: number | null = null, basis = "";
  const row = p.rows.find((r) => Math.abs(r.share - f) < 1e-9);
  const sampleDays = p.from && p.to ? (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 : 0;
  if (p.available && row && p.from && p.to) {
    // continuous audit run 4, HB-37: a rate from fewer than MIN_PROJECTION_DAYS of readings (one day of Federal Register rules) is not a
    // rate, so no half-life is said from it
    if (!(sampleDays >= MIN_PROJECTION_DAYS)) return null;
    perDay = row.units / sampleDays; basis = `the saved readings from ${p.from} to ${p.to}`;
  } else {
    const q = rule.oracle === "catalogue" && rule.series ? parseUsgsSeries(rule.series) : null;
    if (q && !q.region && !rule.inverse) { perDay = quakesPerDay(Number(q.magnitude)); basis = "the U.S. Geological Survey's long-term count of earthquakes worldwide"; }
  }
  if (!perDay || perDay <= 0) return null;
  const daysToHalf = half / perDay;
  if (daysToHalf > 28) return null;
  const when = daysToHalf < 1 ? "within a day" : `in about ${Math.round(daysToHalf)} day${Math.round(daysToHalf) === 1 ? "" : "s"}`;
  return `At ${pctLabel(f)} each, about half the pool would be gone ${when}, going by ${basis}, if no new fees come in. A smaller share lasts longer.`;
}

/** HB-76: the one-time rule's back-test lines: the window by its real dates, the qualifying days in it, and at most one burn. */
export function oneShotBacktestLines(from: string, to: string, qualifyingDays: readonly string[]): string[] {
  const span = `In the saved readings from ${utcDay(from)} to ${utcDay(to)}`;
  const n = qualifyingDays.length;
  if (n === 0) return [`${span}, no day qualified, so this one-time rule would not have burned.`];
  return [`${span}, ${n === 1 ? "one day qualified" : `${n} days qualified`}. This rule burns once, so it would have burned one time, on ${utcDay(qualifyingDays[0])}, and then ended.`];
}

/**
 * HS-48 (hourly run 9): why a coin comparison has no back-test, when Burnticker has stored no daily reading of a coin (derby/store.ts
 * derby_points, by Pyth feed). Said only when that is so; with history the reason stays the general one.
 */
export function coinvsNoHistoryLine(missing: readonly string[]): string {
  const names = missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}` : missing[0];
  return `Burnticker keeps no daily history of ${names} yet, so there is no back-test for this pair. The first reading is at the first 00:00 UTC after launch.`;
}

export function reviewProjection(rule: BurnRule, now: number = Date.now(), root?: string, o: { /** HS-48: has Burnticker stored any daily reading of this Pyth feed? (unknown when left out) */ derbyHistory?: (feed: string) => boolean } = {}): Projection {
  const share = (rule.kind === "scalar" ? rule.scalar?.perUnit : (rule.binary?.onYes ?? rule.binary?.onNo)) as { fractionOfPool?: number } | undefined;
  const f = typeof share?.fractionOfPool === "number" ? share.fractionOfPool : null;
  const unitWord = drainUnitFor(rule);
  const drain = f !== null && f < 1 ? drainLine(f, unitWord) : null;
  const none = (reason: string): Projection => ({ available: false, weeks: null, from: null, to: null, rows: [], lines: [], reason, drain });
  if (f === null) return none("This rule moves a fixed amount of tokens, so there is no share to project.");
  if (rule.oracle === "derby" && rule.derby?.selector === "coinvs" && o.derbyHistory) {
    const d = rule.derby, has = o.derbyHistory;
    const missing = [d.a, d.b].filter((u) => { try { return !!u.pyth && !has(u.pyth); } catch { return false; } }).map((u) => u.symbol);
    if (missing.length) return none(coinvsNoHistoryLine(missing));
  }
  if (rule.oracle !== "catalogue" || !rule.series) return none(rule.market ? "This rule settles once, so there is no history to project from." : "There is no saved sample of this source to project from.");
  const feed = feedById(rule.series);
  if (!feed) return none(nativeSourceById(rule.series) ? "Team, game and weather sources are read live, so there is no saved sample to project from." : "There is no saved sample of this source to project from.");
  { const q = parseUsgsSeries(rule.series); if (q && (Number(q.magnitude) !== USGS_SAMPLE.magnitude || q.region !== USGS_SAMPLE.region)) return none(`The saved sample counts earthquakes of magnitude ${USGS_SAMPLE.magnitude} or more worldwide, not this rule's, so it is not projected here.`); }
  // HB-76 (hourly run 5): a one-time rule burns at most once, so its back-test counts the qualifying days in the window and says one burn
  // at most, never repeated burns at the per-event shares 1, 2 and 5%
  if (f >= 1 || NEXT_EVENT_ONE_SHOT_RE.test(rule.series)) {
    let pv;
    try { pv = previewFromFixture(feed, rule, now, root); } catch { return none("The saved sample of this source could not be read."); }
    if (!pv.rows.length) return none("The saved sample of this source has no readings yet.");
    const days = [...new Set(pv.rows.filter((r) => r.mapping && r.units > 0).map((r) => r.at.slice(0, 10)))].sort();
    const from1 = pv.window.from.slice(0, 10), to1 = pv.window.to.slice(0, 10);
    return { available: true, weeks: null, from: from1, to: to1, rows: [], lines: oneShotBacktestLines(from1, to1, days), reason: null, drain };
  }
  const rows: ProjectionRow[] = [];
  let from: string | null = null, to: string | null = null;
  let burnDays: string[] = [];
  // website-22 (QA 9 item 8): the share the creator chose is projected too, beside 1, 2 and 5%
  for (const s of projectionShares(f)) {
    let pv;
    try { pv = previewFromFixture(feed, withShare(rule, s), now, root); } catch { return none("The saved sample of this source could not be read."); }
    const fired = pv.rows.filter((r) => r.mapping && r.units > 0);
    if (!pv.rows.length) return none("The saved sample of this source has no readings yet.");
    from = pv.window.from.slice(0, 10); to = pv.window.to.slice(0, 10);
    if (!rows.length) burnDays = fired.map((r) => r.at.slice(0, 10));
    rows.push({ share: s, triggers: fired.length, units: fired.reduce((a, r) => a + r.units, 0), spentPct: Math.round(spentFraction(fired.map((r) => r.units), s) * 10_000) / 100 });
  }
  const weeks = from && to ? Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / (7 * 86_400_000))) : null;
  const span = weeks ? `Over the ${weeks === 1 ? "last week" : `last ${weeks} weeks`} of saved readings (${from} to ${to})` : "Over the saved readings";
  const t = rows[0]?.triggers ?? 0, u = rows[0]?.units ?? 0;
  // sources-7 M4: the count is of burns (units), with the readings they came on; "triggered 15 times" beside "99% spent at 1%" read wrong
  const lines = [
    u === t ? `${span}, this rule would have burned ${u} ${u === 1 ? "time" : "times"}.` : `${span}, this rule would have burned ${u} times, on ${t} ${t === 1 ? "reading" : "readings"} (one burn for each ${typeof unitWord === "string" ? unitWord : unitWord.one}).`,
    // HB-93 (hourly run 7): an inverse rule on a source with a season says how many of its burns fell outside it (hazardSeason.ts)
    ...(() => { const l = offSeasonBacktestLine(rule, burnDays); return l ? [l] : []; })(),
    ...rows.map((r) => `At ${pctLabel(r.share)}${f !== null && Math.abs(r.share - f) < 1e-9 ? ", the share you chose" : ""}: ${pct(r.spentPct / 100)} of the pool spent.`),
    "This holds the pool fixed apart from the rule's own spending, with no new fees and no per-run cap, so it shows how fast the rule drains a pool, not what a coin ends up holding.",
  ];
  return { available: true, weeks, from, to, rows, lines, reason: null, drain };
}
