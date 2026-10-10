import type { BurnRule } from "@/lib/burnticker/rules";
import type { SettledEvent } from "@/lib/burnticker/units";
import type { FetchLike, ImpliedChance, OracleAdapter, ResolvedSelector, SeriesSummary } from "@/lib/burnticker/oracle/types";

/**
 * POLYMARKET — A STUB (the owner asked for the interface, 2026-10-09; not full support). Public Gamma API:
 *   GET https://gamma-api.polymarket.com/markets?closed=true&limit=…   (question, outcomes, outcomePrices, closed, umaResolutionStatus,
 *   resolutionSource, endDate, conditionId). Resolution is UMA's optimistic oracle: a market is SETTLED for us only when
 *   umaResolutionStatus === "resolved" and `closed` — never from prices (outcomePrices "1"/"0" is the resolved payout, read only as a
 *   cross-check of the outcome, not as a price signal).
 *
 * What exists: the parser (one fixture, one test) and the adapter shape. What does not: series search (Polymarket has events and tags,
 * not series), selector resolution over a tag, the finalisation window (UMA's dispute period — must be read from the market's
 * `umaEndDate`/dispute fields before this adapter may feed a rule). `settledSince` throws until that is built.
 */

export const GAMMA_API = "https://gamma-api.polymarket.com";

export interface PolymarketResolved { conditionId: string; question: string; outcome: "yes" | "no" | "void" | null; resolvedBy: string | null; resolutionSource: string | null; endDate: string | null; closedTime: string | null }

/** A Gamma market row → the resolved outcome, or null when it is not (yet) resolved. */
export function parseGammaMarket(raw: unknown): PolymarketResolved | null {
  const m = raw as Record<string, unknown> | null;
  if (!m || typeof m.conditionId !== "string" || typeof m.question !== "string") return null;
  const resolved = m.closed === true && m.umaResolutionStatus === "resolved";
  let outcome: PolymarketResolved["outcome"] = null;
  if (resolved) {
    try {
      const outcomes = JSON.parse(String(m.outcomes ?? "[]")) as string[], prices = JSON.parse(String(m.outcomePrices ?? "[]")) as string[];
      const win = outcomes.find((_, i) => prices[i] === "1");
      outcome = win === undefined ? "void" : /^(yes|over)$/i.test(win) ? "yes" : /^(no|under)$/i.test(win) ? "no" : (win === outcomes[0] ? "yes" : "no");
    } catch { outcome = null; }
  }
  return { conditionId: m.conditionId, question: m.question, outcome, resolvedBy: typeof m.resolvedBy === "string" ? m.resolvedBy : null, resolutionSource: typeof m.resolutionSource === "string" ? m.resolutionSource : null, endDate: typeof m.endDate === "string" ? m.endDate : null, closedTime: typeof m.closedTime === "string" ? m.closedTime : null };
}

export function toSettledEvent(p: PolymarketResolved): SettledEvent | null {
  if (!p.outcome) return null;
  const at = p.closedTime ?? p.endDate;
  if (!at) return null;
  return { id: p.conditionId, at: new Date(at).toISOString(), result: p.outcome, value: null, title: p.question, sourceUrl: `${GAMMA_API}/markets?condition_ids=${p.conditionId}` };
}

export class PolymarketStub implements OracleAdapter {
  readonly id = "polymarket" as const;
  private fetchImpl: FetchLike;
  constructor(fetchImpl: FetchLike = fetch as unknown as FetchLike) { this.fetchImpl = fetchImpl; }
  async searchSeries(): Promise<SeriesSummary[]> { return []; }
  async seriesInfo(): Promise<SeriesSummary | null> { return null; }
  async settledSince(_rule: BurnRule, _sinceIso: string | null): Promise<ResolvedSelector> { void this.fetchImpl; throw new Error("polymarket: not supported in v1 (stub) — the UMA dispute window and tag-based selectors are not built"); }
  async impliedChance(): Promise<ImpliedChance> { return { chance: null, marketTicker: null, closeTime: null, basis: "polymarket: stub" }; }
}
