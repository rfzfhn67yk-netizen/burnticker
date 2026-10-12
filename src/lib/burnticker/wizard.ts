import type { BurnRule } from "@/lib/burnticker/rules";
import { ownLegFilter, suffixOf } from "@/lib/burnticker/oracle/events";

/**
 * THE WIZARD'S GENERATED RULES (2026-10-10; the owner: "I am still having a hard time setting up an nfl team coin"). The simple paths
 * never show a selector or a mapping: they are generated here from a team, a game and a toggle, with the recommended defaults
 * (1% of the burn pool per settled game, the $1 spend floor, the 0.02 SOL reserve). Pure and browser-safe; the page and the tests use
 * the same functions, so what the review screen says is what the rule does.
 */

export const RULES_SCHEMA = "burnticker.rules/v1";
export const DEFAULT_FRACTION = 0.01;
const base = { schema: RULES_SCHEMA, oracle: "kalshi" as const, onVoid: "skip" as const, floorUsd: "1", reserveSol: "0.02", vault: null, scalar: null, pair: null };

/** TEAM COIN: every game of `abbr` in a head-to-head series; burns on the team's own leg settling YES (a win) or NO (a loss — and, where the event has a TIE market, a draw). */
export function teamCoinRule(series: string, abbr: string, burnOn: "win" | "lose", fraction = DEFAULT_FRACTION): BurnRule {
  const m = { fractionOfPool: Number(fraction.toFixed(4)) };
  return { ...base, kind: "binary", series, market: null, filter: { tickerIncludes: ownLegFilter(abbr) }, binary: burnOn === "win" ? { onYes: m, onNo: null } : { onYes: null, onNo: m } } as BurnRule;
}

/** The review screen's plain sentence for a team coin. */
export function teamCoinSentence(team: string, ticker: string, burnOn: "win" | "lose", fraction = DEFAULT_FRACTION): string {
  return `Every time the ${team} ${burnOn === "win" ? "win" : "lose"}, $${ticker} spends ${Math.round(fraction * 1000) / 10}% of its burn pool buying $${ticker} back with its own trading fees and burns it. The rule is locked forever. You earn nothing from fees. LP locked forever; its fees fund the burn (80% burned, 20% operator, fixed in code).`;
}

/**
 * MATCHUP PAIR rules. "game" (this game only, the default): side A's rule is one market — A's own leg — burning on NO; the server
 * derives side B by inversion (YES on the same market), so every settlement burns exactly one side (a draw settles A's leg NO, so a
 * draw burns side A). "season" (every game this season): each side's selector is its OWN team's games (`-A` / `-B`), each burning on
 * its own loss — two independent records that partition only the games the two teams play each other; launched as two coins, not a
 * registered pair (the pairs table needs one shared selector).
 */
export function matchupRules(series: string, eventTicker: string, abbrA: string, abbrB: string, mode: "game" | "season", fraction = DEFAULT_FRACTION): { a: BurnRule; b: BurnRule | null; registeredPair: boolean } {
  const m = { fractionOfPool: Number(fraction.toFixed(4)) };
  if (mode === "game") return { a: { ...base, kind: "binary", series: null, market: `${eventTicker}-${abbrA}`, filter: {}, binary: { onYes: null, onNo: m } } as BurnRule, b: null, registeredPair: true };
  return { a: teamCoinRule(series, abbrA, "lose", fraction), b: teamCoinRule(series, abbrB, "lose", fraction), registeredPair: false };
}

/** Event ticker of a game-leg market ticker ("KXNFLGAME-26OCT11PHIJAC-PHI" → "KXNFLGAME-26OCT11PHIJAC"). */
export const eventOfLeg = (marketTicker: string): string => marketTicker.slice(0, marketTicker.length - suffixOf(marketTicker).length - 1);

/** Head-to-head games inside two independent back-tests (season pairs): the events both sides' rows share, and who burned on each. */
export function headToHead(rowsA: readonly { id: string; units: number; kind?: string }[], rowsB: readonly { id: string; units: number; kind?: string }[]): { games: number; burnsA: number; burnsB: number; both: number; neither: number } {
  const a = new Map(rowsA.map((r) => [eventOfLeg(r.id), r])), b = new Map(rowsB.map((r) => [eventOfLeg(r.id), r]));
  let games = 0, burnsA = 0, burnsB = 0, both = 0, neither = 0;
  for (const [ev, ra] of a) {
    const rb = b.get(ev); if (!rb) continue;
    games++;
    const xa = ra.units > 0, xb = rb.units > 0;
    if (xa) burnsA++; if (xb) burnsB++; if (xa && xb) both++; if (!xa && !xb) neither++;
  }
  return { games, burnsA, burnsB, both, neither };
}

/**
 * FIRST-PARTY RULES (2026-10-10: team coins and matchups run on the ESPN scoreboard; weather on the NWS climate report; Kalshi is not a
 * settlement input). A native first-party series is scalar with a fixed unit of 1 qualifying game or day, baseline 0, direction up
 * (sources/native.ts): one burn of `fraction` of the pool per qualifying game/day.
 */
export function firstPartyRule(series: string, fraction = DEFAULT_FRACTION): BurnRule {
  return { ...base, kind: "scalar", series, market: null, filter: {}, oracle: "catalogue", scalar: { unit: 1, perUnit: { fractionOfPool: Number(fraction.toFixed(4)) }, baseline: 0, direction: "up" }, binary: null } as BurnRule;
}
