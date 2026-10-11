import type { BurnRule } from "@/lib/burnticker/rules";
import { previewTotals, unitSteps, type PreviewTotals, type SettledEvent, type UnitStep } from "@/lib/burnticker/units";

/**
 * THE BACK-TEST (2026-10-09): "this selector settled N times in the last 12 months and would have burned X under this rule" — from
 * the venue's own settled history, through the SAME unit engine the keeper runs. Pure; the oracle adapter supplies the events.
 * Display-grade totals (previewTotals): the keeper's receipts use the exact integer spend.
 */

export interface BacktestRow { id: string; at: string; title: string | null; result: string | null; value: string | null; units: number; kind: UnitStep["kind"]; note: string; mapping: UnitStep["mapping"] }
export interface Backtest {
  windowMonths: number;
  from: string;
  to: string;
  totals: PreviewTotals;
  perMonth: { month: string; events: number; units: number }[];
  rows: BacktestRow[];
  /** For one-shot rules: the market resolves once; when (close time) if the venue says. */
  oneShot: { resolvesOn: string | null } | null;
}

export function backtest(rule: BurnRule, events: readonly SettledEvent[], nowMs: number, windowMonths = 12, oneShotCloseTime: string | null = null): Backtest {
  const from = new Date(nowMs); from.setUTCMonth(from.getUTCMonth() - windowMonths);
  const fromIso = from.toISOString();
  const inWindow = events.filter((e) => e.at >= fromIso);
  // Scalar "previousSettlement" rules need the settlement just before the window as the first baseline.
  const before = rule.kind === "scalar" && rule.scalar?.baseline === "previousSettlement" ? [...events].filter((e) => e.at < fromIso && e.value !== null).sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? null : null;
  const steps = unitSteps(rule, inWindow, "none", before ? { value: before.value, carryOut: "0" } : null);
  const perMonthMap = new Map<string, { events: number; units: number }>();
  for (const { event, step } of steps) { const k = event.at.slice(0, 7); const m = perMonthMap.get(k) ?? { events: 0, units: 0 }; m.events++; m.units += step.mapping ? step.units : 0; perMonthMap.set(k, m); }
  return {
    windowMonths, from: fromIso.slice(0, 10), to: new Date(nowMs).toISOString().slice(0, 10),
    totals: previewTotals(steps),
    perMonth: [...perMonthMap].sort().map(([month, v]) => ({ month, ...v })),
    rows: steps.map(({ event, step }) => ({ id: event.id, at: event.at, title: event.title, result: event.result, value: event.value, units: step.units, kind: step.kind, note: step.note, mapping: step.mapping })),
    oneShot: rule.market ? { resolvesOn: oneShotCloseTime } : null,
  };
}

/** One line for the wizard. States what happened; says nothing about price. */
export function backtestSentence(b: Backtest): string {
  const t = b.totals;
  const burned = t.poolFractionSpent !== null ? `would have spent ${(t.poolFractionSpent * 100).toFixed(1)}% of the fee pool across ${t.burnEvents} burn(s)` : t.tokens !== null ? `would have burned ${t.tokens.toLocaleString("en-US")} tokens across ${t.burnEvents} burn(s)` : "would have burned nothing";
  return `This selector settled ${t.events} time(s) between ${b.from} and ${b.to}${t.voids ? ` (${t.voids} void)` : ""} and ${burned} under this rule.`;
}
