import type { BurnRule } from "@/lib/burnticker/rules";
import { LEAGUES, NEXT_MAX, PAIR_OUTCOMES, gameSeries, isPairOutcome, outcomeAllowed, parseEspnSeries, seasonYearAt, teamSeries, windowChoices, type EspnSeries, type Window, type WindowKind } from "@/lib/burnticker/sources/espn";
import { nwsSeries, parseNwsSeries } from "@/lib/burnticker/sources/nws";
import { WX_HIGH_MAX_F, WX_HIGH_MIN_F } from "@/lib/burnticker/wxBounds";
import { INVERSE_CHOICE, inverseRefusal, isOneShotSeries } from "@/lib/burnticker/inverse";

/**
 * THE RULE DIALS (2026-10-10, the owner: "after we select a rule can we edit it? like the percentage burned?"). Every entry path — a
 * search card, the Elections flow, a Browse source, Team coin, Matchup, Any market, Advanced — lands on the same create screen, where
 * the rule's dials stay editable until launch. Which dials a rule has is a pure function of the rule (`dialsFor`), and every change is a
 * pure rewrite of the rule (`applyDial`), so a team rule reached from the search box and the same rule reached through Team coin expose
 * the same dials (test/burntickerDescribe.test.ts). After launch nothing is editable: a different rule is a different coin.
 *
 *   fraction   the share of the burn pool each burn spends: 1–25 % (the schema's fractionOfPool bounds), step 0.5 %
 *   side       win / loss (ESPN), YES / NO (markets)
 *   window     this season (playoffs included; the default) / this postseason only / the next N games / perpetual (ESPN team coins)
 *   games      N for a next-N window, 1–20
 *   threshold  the °F or inches an NWS rule counts from
 *   unit, direction, baseline   Kalshi scalar rules (a first-party feed fixes its own unit, direction and baseline)
 *   inverse    (sources-2) "Burn when it happens" / "Burn when it does not happen" on a recurring first-party feed rule (inverse.ts);
 *              offered only where the rule allows it, and switched off by turning league mode on
 */

export type DialId = "fraction" | "side" | "window" | "games" | "threshold" | "unit" | "direction" | "baseline" | "league" | "forward" | "inverse";
/** What a window change needs besides the rule: the moment (a next-N window starts today) and the season in progress. */
export interface DialCtx { nowMs?: number; seasonYear?: number | null; /** an outcome-list market's set (the championship card knows it) */ set?: { id: string; outcome: string } | null; /** audit 12 item 1: the rule is one side of a LINKED pair (two candidates, one game, one market, the flippening); a one-shot one then burns 100 % only */ linked?: boolean }
/** rules.ts DEFAULT_ON_END, copied so this file stays client-safe (rules.ts reads node:crypto); a test pins the two equal. */
export const ON_END_DEFAULT = { windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true } as const;
/** One-shot rules may spend up to 100 % (rules.ts ONE_SHOT_MAX_FRACTION); recurring ones 1–25 % (owner, 2026-10-12). */
export const ONE_SHOT_FRACTION = { min: 0.01, max: 1, step: 0.01 } as const;
export const FRACTION = { min: 0.01, max: 0.25, step: 0.005 } as const;
/** audit 12 item 1: a linked one-shot pair moves the whole pool, so its dial has one value (launchBundle.ts refuses any other). */
export const LINKED_ONE_SHOT_FRACTION = { min: 1, max: 1, step: 1 } as const;
export interface DialSet {
  ids: DialId[];
  fraction: number;
  side: { value: string; options: { value: string; label: string }[] } | null;
  window: { value: WindowKind; options: { value: WindowKind; label: string }[]; games: number | null } | null;
  threshold: { value: number; label: string; step: number; min: number; max: number } | null;
  /** The unit the source fixes, shown read-only when it is not a dial. */
  fixedUnit: string | null;
  /** The fraction dial's bounds: 1–25 % recurring, 1–100 % one-shot, exactly 100 % on a linked one-shot pair. */
  bounds: { min: number; max: number; step: number };
  /** audit 12 item 1: true on one side of a linked pair whose rule resolves once (its share row is 100 % only). */
  linkedOneShot: boolean;
  /** League mode (rules.ts `set`, opt-in, off by default): a team coin of a league season, or an outcome of a market with a set. */
  league: { on: boolean; id: string; outcome: string; forwardBps: number } | null;
  /** The fade side (sources-2): offered on recurring first-party feed rules; null where the rule cannot take it (inverse.ts). */
  inverse: { on: boolean; options: { value: "off" | "on"; label: string }[] } | null;
}

const fractionOf = (r: BurnRule): number => {
  const m = (r.kind === "binary" ? (r.binary?.onYes ?? r.binary?.onNo) : r.scalar?.perUnit) as { fractionOfPool?: number } | null | undefined;
  return m?.fractionOfPool ?? 0.02;
};

const yearOf = (e: Extract<EspnSeries, { kind: "team" }>, c: DialCtx) => (e.window.kind === "season" || e.window.kind === "post" ? e.window.year : c.seasonYear ?? seasonYearAt(e.league, c.nowMs ?? Date.now()));

// website-19: the one-shot presets (100 or 50 %) wherever the keeper drains a 100 % one-shot (rules.ts isOneShot: a market, a named launch,
// a milestone, the flippening, and since QA pass 9 #3 a single game, which the keeper now drains after its result). HB-147 (hourly run 13):
// the first snow too (inverse.ts isOneShotSeries, the one list): the keeper drains it at 100% after its first snow (multiKeeper.ts
// detectRuleEnd), so it is offered the one-shot shares like every other one-shot.
export const isOneShotRule = (r: BurnRule): boolean => { const e = r.oracle === "catalogue" && r.series ? parseEspnSeries(r.series) : null; return e ? e.kind === "game" : (r.oracle === "catalogue" && isOneShotSeries(r.series)) || (r.oracle === "derby" && (r as { derby?: { flip?: boolean } }).derby?.flip === true) || (r.oracle === "derby" && (r as { derby?: { selector?: string; once?: boolean } }).derby?.selector === "high" && (r as { derby?: { once?: boolean } }).derby?.once === true) || (r.kind === "binary" && !!r.market); };
/** The set a rule can join: a team coin's league season (id <league>-<year>-<win|loss>, outcome <ABBR>.<ESPN id>), or the market's set. */
export function leagueSetFor(r: BurnRule, c: DialCtx = {}): { id: string; outcome: string } | null {
  const e = r.oracle === "catalogue" && r.series ? parseEspnSeries(r.series) : null;
  // league mode reads one result per team (the champion's set); two of three results is not offered there (rules.ts refuses it too)
  if (e?.kind === "team" && e.teamId && !isPairOutcome(e.outcome) && (e.window.kind === "season" || e.window.kind === "post")) return { id: `${e.league.replace(/\./g, "-")}-${e.window.year}-${e.window.kind === "post" ? "post-" : ""}${e.outcome}`, outcome: `${e.abbr}.${e.teamId}` };
  if (r.oracle === "polymarket" && r.market && c.set) return c.set;
  return null;
}

/** The launch page's label over a soccer team coin's results choice (the side dial). */
export const TEAM_RESULTS_LABEL = "Which results burn";
/** The side dial's words for two of a soccer game's three results (espn.ts PairOutcome), the everyday name in brackets. */
export const PAIR_OUTCOME_LABEL: Record<(typeof PAIR_OUTCOMES)[number], string> = { windraw: "a win or a draw (does not lose)", drawloss: "a draw or a loss (does not win)", winloss: "a win or a loss (no draw)" };

export function dialsFor(r: BurnRule, c: DialCtx = {}): DialSet {
  const oneShot = isOneShotRule(r);
  const ls = leagueSetFor(r, c);
  // the fade side is offered whenever the rule could take it with league mode off (turning league mode on switches it off)
  const invOk = inverseRefusal({ ...r, set: undefined }) === null;
  const out: DialSet = { ids: ["fraction"], fraction: fractionOf(r), side: null, window: null, threshold: null, fixedUnit: null, bounds: oneShot ? (c.linked ? LINKED_ONE_SHOT_FRACTION : ONE_SHOT_FRACTION) : FRACTION, linkedOneShot: oneShot && c.linked === true, league: ls ? { on: !!r.set, id: r.set?.id ?? ls.id, outcome: r.set?.outcome ?? ls.outcome, forwardBps: r.set?.forwardBps ?? 10_000 } : null,
    inverse: invOk ? { on: r.inverse === true, options: [{ value: "off", label: INVERSE_CHOICE.off }, { value: "on", label: INVERSE_CHOICE.on }] } : null };
  if (ls) out.ids.push("league");
  if (invOk) out.ids.push("inverse");
  const series = r.oracle === "catalogue" ? r.series ?? "" : "";
  const e = series ? parseEspnSeries(series) : null;
  if (e) {
    // soccer (a league with draws): a draw, and any two of the three results (owner 2026-10-13), after the single results
    out.ids.push("side"); out.side = { value: e.outcome, options: [{ value: "win", label: "a win" }, { value: "loss", label: "a loss" }, ...(LEAGUES[e.league].draws ? [{ value: "draw", label: "a draw" }, ...PAIR_OUTCOMES.map((o) => ({ value: o, label: PAIR_OUTCOME_LABEL[o] }))] : [])] };
    if (e.kind === "team") {
      const w = e.window, value: WindowKind = w.kind === "legacy" ? (w.scope === "post" ? "post" : "season") : w.kind;
      out.ids.push("window"); if (value === "next") out.ids.push("games");
      out.window = { value, options: windowChoices(e.league, yearOf(e, c), c.nowMs ?? Date.now()).map((x) => ({ value: x.kind, label: x.kind === "next" ? "Next N games" : x.label })), games: w.kind === "next" ? w.n : null };
    }
    return out;
  }
  const n = series ? parseNwsSeries(series) : null;
  if (n) {
    if (n.metric !== "snow") { out.ids.push("threshold"); out.threshold = n.metric === "high" ? { value: n.threshold, label: r.inverse ? "burns when the high is below (°F)" : "high at or above (°F)", step: 1, min: WX_HIGH_MIN_F, max: WX_HIGH_MAX_F } : { value: n.threshold, label: r.inverse ? "burns when the rain is below (inches)" : "rain at or above (inches)", step: 0.05, min: 0.01, max: 10 }; }
    return out;
  }
  if (r.oracle === "catalogue") { out.fixedUnit = r.scalar ? `fixed by the source: unit ${r.scalar.unit}, direction ${r.scalar.direction}, baseline ${String(r.scalar.baseline)}` : null; return out; }
  if (r.kind === "binary") { out.ids.push("side"); out.side = { value: r.binary?.onYes ? "yes" : "no", options: [{ value: "yes", label: "YES" }, { value: "no", label: "NO" }] }; return out; }
  out.ids.push("unit", "direction", "baseline");
  return out;
}

const clampFraction = (f: number, max: number = FRACTION.max) => Math.round(Math.min(max, Math.max(FRACTION.min, f)) * 10_000) / 10_000;
const withFraction = (r: BurnRule, f: number): BurnRule => {
  const m = { fractionOfPool: clampFraction(f, isOneShotRule(r) ? ONE_SHOT_FRACTION.max : FRACTION.max) };
  if (r.kind === "binary" && r.binary) return { ...r, binary: { onYes: r.binary.onYes ? m : null, onNo: r.binary.onNo ? m : null } } as BurnRule;
  if (r.scalar) return { ...r, scalar: { ...r.scalar, perUnit: m } } as BurnRule;
  return r;
};

/** One dial's new value → the new rule (pure). Unknown or inapplicable dials return the rule unchanged. */
export function applyDial(r: BurnRule, dial: DialId, value: string | number, c: DialCtx = {}): BurnRule {
  if (dial === "fraction") return withFraction(r, Number(value));
  if (dial === "inverse") {
    const { inverse: _drop, ...rest } = r as BurnRule & { inverse?: unknown };
    if (value === "off" || value === 0 || value === "0") return rest as BurnRule;
    if (value !== "on" && value !== 1 && value !== "1") return r;
    if (inverseRefusal({ ...rest, set: undefined }) !== null) return r;
    const { set: _set, ...noSet } = rest as BurnRule & { set?: unknown };
    return { ...noSet, inverse: true } as BurnRule;
  }
  if (dial === "league" || dial === "forward") {
    const ls = leagueSetFor(r, c);
    if (!ls) return r;
    const { set: _drop, ...rest } = r as BurnRule & { set?: unknown };
    if (dial === "league" && (value === "off" || value === 0 || value === "0")) return (r.set ? { ...rest, onEnd: { ...(r.onEnd ?? ON_END_DEFAULT), endSink: true } } : rest) as BurnRule;
    const bps = dial === "forward" ? Math.round(Math.min(10_000, Math.max(0, Number(value)))) : (r.set?.forwardBps ?? 10_000);
    if (dial === "forward" && !r.set) return r;
    // §45: league-set end sinks are a later program round, so a league-mode coin keeps the wind-down (rules.ts refuses endSink with set);
    // sources-2: league mode on also drops the fade side (inverse.ts refuses inverse with set)
    const { endSink: _noSink, mint: _noMint, ticker: _noTicker, ...windDown } = (r.onEnd ?? ON_END_DEFAULT) as { windDownDays: number; sweepThresholdLamports: number; endSink?: true; mint?: string; ticker?: string };
    const { inverse: _inv, ...plain } = rest as BurnRule & { inverse?: unknown };
    return { ...plain, onEnd: windDown, set: { id: r.set?.id ?? ls.id, outcome: r.set?.outcome ?? ls.outcome, forwardBps: bps } } as BurnRule;
  }
  const series = r.oracle === "catalogue" ? r.series ?? "" : "";
  const e = series ? parseEspnSeries(series) : null;
  if (e && dial === "side" && typeof value === "string" && outcomeAllowed(e.league, value) && !(e.kind === "team" && e.window.kind === "meetings")) {
    // two of the three results cannot take the fade side (inverse.ts), and league mode reads one result: both drop with the switch
    const { inverse: _inv, set: _set, ...plain } = r as BurnRule & { inverse?: unknown; set?: unknown };
    const base = (isPairOutcome(value) ? (r.set ? { ...plain, onEnd: { ...(r.onEnd ?? ON_END_DEFAULT), endSink: true } } : plain) : r) as BurnRule;
    return { ...base, series: e.kind === "team" ? teamSeries(e.league, e.abbr, value, e.window) : gameSeries(e.league, e.eventId, e.abbr, value) } as BurnRule;
  }
  if (e && e.kind === "team" && dial === "window" && ["season", "post", "next", "perpetual"].includes(String(value))) {
    const year = yearOf(e, c), from = new Date(c.nowMs ?? Date.now()).toISOString().slice(0, 10).replace(/-/g, "");
    const w: Window = value === "season" ? { kind: "season", year } : value === "post" ? { kind: "post", year } : value === "next" ? { kind: "next", n: e.window.kind === "next" ? e.window.n : 5, from: e.window.kind === "next" ? e.window.from : from } : { kind: "perpetual" };
    return { ...r, series: teamSeries(e.league, e.abbr, e.outcome, w) } as BurnRule;
  }
  if (e && e.kind === "team" && dial === "games" && e.window.kind === "next" && Number.isFinite(Number(value))) {
    const n = Math.round(Math.min(NEXT_MAX, Math.max(1, Number(value))));
    return { ...r, series: teamSeries(e.league, e.abbr, e.outcome, { ...e.window, n }) } as BurnRule;
  }
  const n = series ? parseNwsSeries(series) : null;
  if (n && n.metric !== "snow" && dial === "threshold" && Number.isFinite(Number(value))) return { ...r, series: nwsSeries(n.metric, n.station, Number(value)) } as BurnRule;
  if (!e && !n && r.kind === "binary" && r.binary && dial === "side" && (value === "yes" || value === "no")) {
    const m = r.binary.onYes ?? r.binary.onNo;
    return { ...r, binary: value === "yes" ? { onYes: m, onNo: null } : { onYes: null, onNo: m } } as BurnRule;
  }
  if (r.oracle === "kalshi" && r.scalar) {
    if (dial === "unit" && Number(value) > 0) return { ...r, scalar: { ...r.scalar, unit: Number(value) } } as BurnRule;
    if (dial === "direction" && ["up", "down", "abs"].includes(String(value))) return { ...r, scalar: { ...r.scalar, direction: value as "up" | "down" | "abs" } } as BurnRule;
    if (dial === "baseline") return { ...r, scalar: { ...r.scalar, baseline: value === "previousSettlement" ? "previousSettlement" : Number(value) } } as BurnRule;
  }
  return r;
}
