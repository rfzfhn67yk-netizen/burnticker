import type { BurnRule } from "@/lib/burnticker/rules";
import { dayMs, seasonEndMs } from "@/lib/burnticker/derby/spec";

/**
 * Does a stored derby reading count for this token? Coin-vs-coin tokens on the same matchup share one reading stream (the selector key
 * leaves the season out unless the rule is a one-shot flippening), so each token counts only the windows inside its own season:
 * `at` (the window's last second) on or after the season's first midnight and before its end. Bracket readings are produced only
 * while the slot is alive, so they all count. Pure.
 */
export function derbyReadingInSeason(rule: BurnRule, r: { at?: string; id?: string }): boolean {
  const d = rule.derby;
  if (!d) return false;
  if (d.selector === "bracket") return true;
  if (!r.at) return false;
  const at = Date.parse(r.at);
  // sources-4: a record-close coin has its own stream; a recurring one may have no end (days null)
  if (d.selector === "high") return Number.isFinite(at) && at >= dayMs(d.season.start) && (d.season.days === null || at < dayMs(d.season.start) + d.season.days * 86_400_000);
  // audit 12: a daily race's season tally (derby/adapter.ts recordTally) is read the UTC day after the season and counts only for the
  // season it tallies (another season of the same matchup shares the stream and may cover that day)
  if (r.id && r.id.startsWith("tally-")) return d.selector === "coinvs" && !d.flip && r.id.startsWith(`tally-${new Date(seasonEndMs(d)).toISOString().slice(0, 10)}:`);
  return Number.isFinite(at) && at >= dayMs(d.season.start) && at < seasonEndMs(d);
}
