import type { BurnRule } from "@/lib/burnticker/rules";
import { drainLine, drainPct as pct, spentFraction } from "@/lib/burnticker/drain";
import { feedById, previewFromFixture } from "@/lib/burnticker/catalogue";
import { nativeSourceById } from "@/lib/burnticker/sources/native";
import { pctLabel } from "@/lib/burnticker/launchPresets";

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
export interface ProjectionRow { share: number; triggers: number; units: number; spentPct: number }
export interface Projection { available: boolean; weeks: number | null; from: string | null; to: string | null; rows: ProjectionRow[]; lines: string[]; reason: string | null; drain: string | null }

export { spentFraction, drainLine } from "@/lib/burnticker/drain";

function withShare(rule: BurnRule, share: number): BurnRule {
  if (rule.kind === "scalar" && rule.scalar) return { ...rule, scalar: { ...rule.scalar, perUnit: { fractionOfPool: share } } };
  if (rule.binary) return { ...rule, binary: { onYes: rule.binary.onYes ? { fractionOfPool: share } : null, onNo: rule.binary.onNo ? { fractionOfPool: share } : null } };
  return rule;
}

export function reviewProjection(rule: BurnRule, now: number = Date.now(), root?: string): Projection {
  const share = (rule.kind === "scalar" ? rule.scalar?.perUnit : (rule.binary?.onYes ?? rule.binary?.onNo)) as { fractionOfPool?: number } | undefined;
  const f = typeof share?.fractionOfPool === "number" ? share.fractionOfPool : null;
  const unitWord = rule.oracle === "catalogue" && rule.series && nativeSourceById(rule.series) ? (nativeSourceById(rule.series)!.unit.label.replace(/^1 /, "") || "result") : "result";
  const drain = f !== null && f < 1 ? drainLine(f, unitWord) : null;
  const none = (reason: string): Projection => ({ available: false, weeks: null, from: null, to: null, rows: [], lines: [], reason, drain });
  if (f === null) return none("This rule moves a fixed amount of tokens, so there is no share to project.");
  if (rule.oracle !== "catalogue" || !rule.series) return none(rule.market ? "This rule settles once, so there is no history to project from." : "There is no saved sample of this source to project from.");
  const feed = feedById(rule.series);
  if (!feed) return none(nativeSourceById(rule.series) ? "Team, game and weather sources are read live, so there is no saved sample to project from." : "There is no saved sample of this source to project from.");
  const rows: ProjectionRow[] = [];
  let from: string | null = null, to: string | null = null;
  for (const s of PROJECTION_SHARES) {
    let pv;
    try { pv = previewFromFixture(feed, withShare(rule, s), now, root); } catch { return none("The saved sample of this source could not be read."); }
    const fired = pv.rows.filter((r) => r.mapping && r.units > 0);
    if (!pv.rows.length) return none("The saved sample of this source has no readings yet.");
    from = pv.window.from.slice(0, 10); to = pv.window.to.slice(0, 10);
    rows.push({ share: s, triggers: fired.length, units: fired.reduce((a, r) => a + r.units, 0), spentPct: Math.round(spentFraction(fired.map((r) => r.units), s) * 10_000) / 100 });
  }
  const weeks = from && to ? Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / (7 * 86_400_000))) : null;
  const span = weeks ? `Over the ${weeks === 1 ? "last week" : `last ${weeks} weeks`} of saved readings (${from} to ${to})` : "Over the saved readings";
  const t = rows[0]?.triggers ?? 0;
  const lines = [
    `${span}, this rule would have triggered ${t} ${t === 1 ? "time" : "times"}.`,
    ...rows.map((r) => `At ${pctLabel(r.share)}: ${pct(r.spentPct / 100)} of the pool spent.`),
    "This holds the pool fixed apart from the rule's own spending, with no new fees and no per-run cap, so it shows how fast the rule drains a pool, not what a coin will hold.",
  ];
  return { available: true, weeks, from, to, rows, lines, reason: null, drain };
}
