import type { BurnRule } from "@/lib/burnticker/rules";
import { dialsFor } from "@/lib/burnticker/dials";

/**
 * THE WEB LAUNCHER'S BURN PRESETS, ONE DEFINITION (ChatGPT launch audit 5, L01 / L10, 2026-10-11: a weather card said "Burns 1%", the
 * review then showed 2% with no word about the change). Every surface that names a share before launch — a search card, a template
 * example, a Browse rule, the review card's preset row, the request payload and the rule initialize_token receives — reads these:
 *
 *   recurring   1, 2, 5, 10 or 25 % of the burn pool per qualifying unit (default 2 %; the owner raised the cap to 25 % on 2026-10-12)
 *   one-shot    100 % or 50 % once (default 100 %; website-19, the owner: a title coin was offered 2 / 5 / 10 %)
 *
 * A share outside the row is never swapped silently: `presetProblem` names it, and `snapToPreset` reports `changed` so the page can say
 * what it did ("the coin you copied burned 3%; the web launcher offers 2 / 5 / 10%"). Other shares stay available through the API.
 * Client-safe (dials.ts is).
 */
// owner, 2026-10-12 ~18:10 Denver: a recurring rule may burn up to 25 % per unit; the review shows 1, 2 and 5 % with 10 and 25 % under "More"
export const SHARE_PRESETS = { recurring: [0.01, 0.02, 0.05, 0.1, 0.25], oneShot: [1, 0.5] } as const;
/** The recurring presets on the main row; the rest sit behind "More". */
export const MAIN_RECURRING = [0.01, 0.02, 0.05] as const;
/** Above this share a recurring burn is said to land in slices (one burn run buys with at most 2 % of the pool's SOL). */
export const SLICED_ABOVE = 0.05;
export const DEFAULT_SHARE = { recurring: 0.02, oneShot: 1 } as const;
export type ShareShape = keyof typeof SHARE_PRESETS;

/** The rule's preset row: one-shot when the fraction dial runs to 100 % (dials.ts), else recurring. */
export function shareShapeOf(rule: BurnRule): ShareShape {
  return dialsFor(rule).bounds.max >= 1 ? "oneShot" : "recurring";
}
/** The share of the burn pool the rule spends per burn (the first mapped outcome; every web rule maps one). */
export function shareOf(rule: BurnRule): number | null {
  const m = (rule.kind === "binary" ? (rule.binary?.onYes ?? rule.binary?.onNo) : rule.scalar?.perUnit) as { fractionOfPool?: number } | null | undefined;
  return typeof m?.fractionOfPool === "number" ? m.fractionOfPool : null;
}
export const isPreset = (f: number, shape: ShareShape): boolean => SHARE_PRESETS[shape].some((x) => Math.abs(x - f) < 1e-9);
/** "2%", "10%", "100%", "0.5%". */
export const pctLabel = (f: number): string => `${Math.round(f * 1000) / 10}%`;
/** The preset row as words: "2, 5 or 10%". */
export const presetRowLabel = (shape: ShareShape): string => { const xs = SHARE_PRESETS[shape].map((x) => `${Math.round(x * 1000) / 10}`); return `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}%`; };

/** Null when the rule's share is on its preset row; otherwise the sentence that says it is not (never silently replaced). */
export function presetProblem(rule: BurnRule): string | null {
  const f = shareOf(rule);
  if (f === null) return null;   // a vault (tokens) rule: API-only, the page never builds one
  const shape = shareShapeOf(rule);
  return isPreset(f, shape) ? null : `This rule burns ${pctLabel(f)} each time. The web launcher offers ${presetRowLabel(shape)} for this kind of rule, so pick one of those or use the API for any other share.`;
}

/** The nearest preset and whether it differs from `f` (the caller says so on the page when it does). */
export function snapToPreset(f: number, shape: ShareShape): { value: number; changed: boolean } {
  const opts = SHARE_PRESETS[shape];
  const value = opts.reduce((b, x) => (Math.abs(x - f) < Math.abs(b - f) ? x : b), opts[0] as number);
  return { value, changed: Math.abs(value - f) > 1e-9 };
}

/** The graduation preset (website-14, LAUNCHPAD-PATH §75) lives in raisePresets.ts, which imports nothing, so the SDK's launch builder can read it. */
export { DEFAULT_RAISE_SOL, RAISE_PRESETS_SOL, RAISE_PRESET_SHARED, RAISE_PRESET_TEXT, isRaisePreset, raiseLamports, type RaisePreset } from "@/lib/burnticker/raisePresets";
