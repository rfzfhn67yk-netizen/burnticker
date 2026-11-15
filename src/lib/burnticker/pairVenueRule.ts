import { isMeetingsRule } from "@/lib/burnticker/rules";
import { settledPairInput } from "@/lib/burnticker/launchPreflight";

/**
 * 2026-10-14 (the Steelers vs Ravens pair looped on "press the button again"): with BURNTICKER_PAIR_CURVE_ENABLED the launch route
 * demanded the pair-curve venue for EVERY pair, while the handler (and the page, website-21 / website-23) launch a rivalry SERIES pair
 * and a settled-event pair as two LaunchLab coins linked at creation — the pair curve is for the other pairs. The route now asks the
 * same question the handler asks. True when this pair must come through the pair curve.
 */
export function pairCurveRequiredFor(body: { rule?: unknown; pair?: unknown }, enabled: boolean): boolean {
  if (!enabled || !body.pair) return false;
  const rule = (body.rule ?? {}) as { oracle?: unknown; series?: unknown };
  if (isMeetingsRule(rule)) return false;
  if (settledPairInput(body.pair)) return false;
  return true;
}
