import type { BurnRule } from "@/lib/burnticker/rules";
import { dialsFor } from "@/lib/burnticker/dials";

/**
 * THE WEB LAUNCHER'S BURN PRESETS, ONE DEFINITION (ChatGPT launch audit 5, L01 / L10, 2026-10-11: a weather card said "Burns 1%", the
 * review then showed 2% with no word about the change). Every surface that names a share before launch — a search card, a template
 * example, a Browse rule, the review card's preset row, the request payload and the rule initialize_token receives — reads these:
 *
 *   recurring   1, 2, 5, 10 or 25 % of the burn pool per qualifying unit (default 2 %; the owner raised the cap to 25 % on 2026-10-12)
 *   one-shot    100 % once (website-19, the owner: a title coin was offered 2 / 5 / 10 %). 50 % once is offered only on a host that runs
 *               burn dispersal (review 10 F1, 2026-10-14: on a program without crank_carried, a share under 100 % cannot finish on the coin
 *               before the end sink takes the rest; ShareCtx.dispersal, launchPreflight.ts "one-shot-share-needs-dispersal")
 *
 * A share outside the row is never swapped silently: `presetProblem` names it, and `snapToPreset` reports `changed` so the page can say
 * what it did ("the coin you copied burned 3%; the web launcher offers 2 / 5 / 10%"). Other shares stay available through the API.
 * Client-safe (dials.ts is).
 */
// owner, 2026-10-12 ~18:10 Denver: a recurring rule may burn up to 25 % per unit; the review shows 1, 2 and 5 % with 10 and 25 % under "More"
// audit 12 item 1 (2026-10-13): a LINKED pair on a rule that resolves once (two candidates, one game, one market, the flippening) moves the
// whole pool, so its only preset is 100 %; a pair that repeats keeps the recurring row
// review 10 F1 (2026-10-14): a single one-shot coin is 100 % only; 50 % comes back as `oneShotDispersal` on a host with burn dispersal
export const SHARE_PRESETS = { recurring: [0.01, 0.02, 0.05, 0.1, 0.25], oneShot: [1], linkedOneShot: [1], oneShotDispersal: [1, 0.5] } as const;
/** The recurring presets on the main row; the rest sit behind "More". */
export const MAIN_RECURRING = [0.01, 0.02, 0.05] as const;
/** Above this share a recurring burn shows the drain line on the launch page (how fast repeated burns empty the pool). */
export const SLICED_ABOVE = 0.05;
export const DEFAULT_SHARE = { recurring: 0.02, oneShot: 1, linkedOneShot: 1, oneShotDispersal: 1 } as const;
export type ShareShape = keyof typeof SHARE_PRESETS;

/** What decides a linked pair's row: `linked` is true for a pair whose two coins are linked (side B of a registered pair, never a Matchup's independent companion). */
export interface ShareCtx { linked?: boolean;
  /** review 10 F1: the host runs burn dispersal (programHash.ts hostDispersal: BURNTICKER_DISPERSAL, default on for a round-5 program), so a single one-shot may burn 50 % */
  dispersal?: boolean }
/** The rule's preset row: one-shot when the fraction dial runs to 100 % (dials.ts), else recurring; a linked one-shot pair is 100 % only. */
export function shareShapeOf(rule: BurnRule, c: ShareCtx = {}): ShareShape {
  return dialsFor(rule).bounds.max >= 1 ? (c.linked ? "linkedOneShot" : c.dispersal ? "oneShotDispersal" : "oneShot") : "recurring";
}
/** The preset row the page offers for this rule (audit 12 item 1: one place, so the dials, presets and server agree). */
export const sharePresetsForRule = (rule: BurnRule, c: ShareCtx = {}): readonly number[] => SHARE_PRESETS[shareShapeOf(rule, c)];
/** The refusal for a linked one-shot pair with a share other than 100 % (review and bundle route; never rewritten silently). */
export { LINKED_ONE_SHOT_REFUSAL, ONE_SHOT_SHARE_REFUSAL } from "@/lib/burnticker/linkedShare";
import { LINKED_ONE_SHOT_REFUSAL, ONE_SHOT_SHARE_REFUSAL } from "@/lib/burnticker/linkedShare";
/** The line beside the share row of a linked one-shot pair (why there is one choice). */
export const LINKED_ONE_SHOT_LINE = "A linked pair on one result burns the whole pool, so 100% is the only choice.";
/** The notice a saved draft gets when its linked pair carried another share (audit 12 item 1). */
export const linkedShareMigratedNotice = (from: number): string => `This saved draft had ${pctLabel(from)} on a linked pair. A linked pair on one result always burns the whole pool, so it is now set to 100%.`;
/** The share of the burn pool the rule spends per burn (the first mapped outcome; every web rule maps one). */
export function shareOf(rule: BurnRule): number | null {
  const m = (rule.kind === "binary" ? (rule.binary?.onYes ?? rule.binary?.onNo) : rule.scalar?.perUnit) as { fractionOfPool?: number } | null | undefined;
  return typeof m?.fractionOfPool === "number" ? m.fractionOfPool : null;
}
export const isPreset = (f: number, shape: ShareShape): boolean => (SHARE_PRESETS[shape] as readonly number[]).some((x) => Math.abs(x - f) < 1e-9);
/** "2%", "10%", "100%", "0.5%". */
export const pctLabel = (f: number): string => `${Math.round(f * 1000) / 10}%`;
/** The preset row as words: "2%, 5% or 10%" ("100%" for a row of one). WZ7-10 (seventh pass): each number carries its own sign, since "100 or 50%" read as clipped. */
export const presetRowLabel = (shape: ShareShape): string => { const xs = (SHARE_PRESETS[shape] as readonly number[]).map((x) => `${Math.round(x * 1000) / 10}%`); return xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`; };

/** Null when the rule's share is on its preset row; otherwise the sentence that says it is not (never silently replaced). */
export function presetProblem(rule: BurnRule, c: ShareCtx = {}): string | null {
  const f = shareOf(rule);
  if (f === null) return null;   // a vault (tokens) rule: API-only, the page never builds one
  const shape = shareShapeOf(rule, c);
  if (shape === "linkedOneShot") return isPreset(f, shape) ? null : LINKED_ONE_SHOT_REFUSAL;
  // review 10 F1: a single one-shot under 100 % needs burn dispersal (the preflight refuses it with the same words when the coin has an end sink)
  if (shape === "oneShot") return isPreset(f, shape) ? null : ONE_SHOT_SHARE_REFUSAL;
  return isPreset(f, shape) ? null : `This rule burns ${pctLabel(f)} each time. The web launcher offers ${presetRowLabel(shape)} for this kind of rule, so pick one of those or use the API for any other share.`;
}

/** The nearest preset and whether it differs from `f` (the caller says so on the page when it does). */
export function snapToPreset(f: number, shape: ShareShape): { value: number; changed: boolean } {
  const opts = SHARE_PRESETS[shape] as readonly number[];
  const value = opts.reduce((b, x) => (Math.abs(x - f) < Math.abs(b - f) ? x : b), opts[0] as number);
  return { value, changed: Math.abs(value - f) > 1e-9 };
}

/** The graduation preset (website-14, LAUNCHPAD-PATH §75) lives in raisePresets.ts, which imports nothing, so the SDK's launch builder can read it. */
export { DEFAULT_RAISE_SOL, RAISE_PRESETS_SOL, RAISE_PRESET_SHARED, RAISE_PRESET_TEXT, isRaisePreset, raiseLamports, type RaisePreset } from "@/lib/burnticker/raisePresets";
