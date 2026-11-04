import type { BurnRule } from "@/lib/burnticker/rules";

/**
 * PROD-03 (2026-10-19, the external audit: a Rivalry "every loss this season" pair offered coin B the incinerator and coin A only $DEFICIT,
 * and the review's "When it ends" spoke for coin A alone). Two coins launched side by side without a link (a Matchup's two independent
 * coins, each prepared as its own single coin) take the same end choices, and the review states each coin's end on its own line.
 * Linked pairs (a rivalry series, a settled-event pair, Coin vs Coin) keep their one pair-winner end and are not handled here. Pure.
 */

/**
 * The end choices one coin may be offered. The incinerator is a single coin's end (rules.ts refuses it on a rule with a pair clause or an
 * outcome set), so it follows the coin's own rule and the site's flag, never which side of the screen the coin sits on.
 */
export function endChoicesFor(rule: Pick<BurnRule, "pair"> & { set?: unknown } | null | undefined, site: { burnSol: boolean; sinkPicker: boolean }): { burnSol: boolean; sinkPicker: boolean } {
  return { burnSol: site.burnSol && !!rule && !rule.pair && !rule.set, sinkPicker: site.sinkPicker };
}

/**
 * The review's end lines: one coin keeps its sentences as they are; two independent coins get one line each, led by the coin's ticker,
 * so different ends (or the same end) are each said for the coin they belong to.
 */
export function perCoinEndLines(a: { ticker: string; sentences: string[] }, b: { ticker: string; sentences: string[] } | null): string[] {
  if (!b) return a.sentences;
  const line = (x: { ticker: string; sentences: string[] }, fallback: string) => `$${x.ticker || fallback}: ${x.sentences.join(" ")}`;
  return [line(a, "A"), line(b, "B")];
}
