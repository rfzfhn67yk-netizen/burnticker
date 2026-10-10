import type { BurnRule } from "@/lib/burnticker/rules";
import { dayMs, seasonEndMs } from "@/lib/burnticker/derby/spec";

/**
 * Does a stored derby reading count for this token? Coin-vs-coin tokens on the same matchup share one reading stream (the selector key
 * leaves the season out unless the rule is a one-shot flippening), so each token counts only the windows inside its own season:
 * `at` (the window's last second) on or after the season's first midnight and before its end. Bracket readings are produced only
 * while the slot is alive, so they all count. Pure.
 */
export function derbyReadingInSeason(rule: BurnRule, r: { at?: string }): boolean {
  const d = rule.derby;
  if (!d) return false;
  if (d.selector === "bracket") return true;
  if (!r.at) return false;
  const at = Date.parse(r.at);
  return Number.isFinite(at) && at >= dayMs(d.season.start) && at < seasonEndMs(d);
}
