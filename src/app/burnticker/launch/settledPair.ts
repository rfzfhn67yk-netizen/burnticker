import type { BurnRule } from "@/lib/burnticker/rules";
import { teamRefByName } from "@/lib/burnticker/describe";

/**
 * WEBSITE-23 (WIRING-SETTLED-PAIRS, owner 2026-10-13): two candidates in one race and two teams in one game launch as ONE linked LaunchLab
 * pair (pair_mint at creation, a 30-day both-or-neither date, both end sinks pair-winner naming each other). The page builds side A's rule
 * (guidedLaunch.ts candidatesPairRule / gamePairRule) and posts side B as `pair`, never as a `companion`: the bundle route builds side B
 * from the other market or the other team's win series. Pure and client-safe.
 */
export type SettledPick =
  | { shape: "candidates"; market: string; race: string; names: { a: string; b: string } }
  | { shape: "game"; opp: string; names: { a: string; b: string } };

/** The pair's deadline, said on the review (the pair's voidBy is 30 days after launch, never the market's or the game's date). */
export const SETTLED_DEADLINE_LINE = "Both coins need a trading pool within 30 days, or the pair is void and each coin burns down on itself.";
/** The one end a settled-event pair has (the step-3 card's own name). */
export const SETTLED_END_LABEL = "Winner takes the burn";

/** The review's "Which coin burns" fact: only the winner's coin burns, and it takes the other coin's pool at the end. */
export function settledWhichCoinLine(p: SettledPick, t: { a: string; b: string }): string {
  const won = (n: string) => (p.shape === "game" ? `${teamRefByName(n)} win` : `${n} wins`);
  return `$${t.a} if ${won(p.names.a)}, or $${t.b} if ${won(p.names.b)}. Only the winning coin burns, and it takes the other coin's pool at the end.`;
}

/** The settled fields of side B's `pair` object: `{ market, race, names }` for a race, `{ opp, names }` for a game. */
export function settledPairFields(p: SettledPick): { market: string; race: string; names: { a: string; b: string } } | { opp: string; names: { a: string; b: string } } {
  return p.shape === "candidates" ? { market: p.market.toLowerCase(), race: p.race, names: p.names } : { opp: p.opp.toUpperCase(), names: p.names };
}

/** Side B as the review and the bundle route receive it. */
export function settledPairBody(p: SettledPick, b: { ticker: string; name: string; creatorDescription: string; links: { label: string; url: string }[] }): Record<string, unknown> {
  return { ticker: b.ticker.toUpperCase(), name: b.name, creatorDescription: b.creatorDescription, links: b.links, ...settledPairFields(p) };
}

/**
 * A side's rule as the bundle builds it (the race's two markets or the game's two win series locked in `pair`), so the page describes and
 * ends it the way the review and the coin's page do (describe.ts settledPairShapeOf: the pair-winner end of the race or the game).
 */
export function settledAsShown(r: BurnRule, side: "A" | "B", p: SettledPick, both: { a: BurnRule; b: BurnRule }): BurnRule {
  const base = { pairId: "review-pair", side, counterpartMint: null, winnerTakesBurn: true };
  if (p.shape === "candidates") return { ...r, pair: { ...base, race: { slug: p.race, markets: [both.a.market ?? "", both.b.market ?? ""] } } } as BurnRule;
  return { ...r, pair: { ...base, game: { series: [both.a.series ?? "", both.b.series ?? ""] } } } as BurnRule;
}
