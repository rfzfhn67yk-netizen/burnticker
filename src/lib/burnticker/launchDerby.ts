import { DERBY_DISAGREEMENT_PP, type CoinVsSpec } from "@/lib/burnticker/derby/spec";

/**
 * WHAT A COIN VS COIN LAUNCH CREATES, SAID BEFORE THE REVIEW (ChatGPT launch audit 5, L13, 2026-10-11: picking WIF / SHIB and then
 * reviewing $TEAMWIF / $TEAMSHIB let a beginner think the reference coins were the ones burned; the review gave an end date with no
 * start boundary). From the tile's own spec (derby/tile.ts tileSpec), so the dates are the rule's:
 *
 *   reference feeds  the two picked coins are only READ (their published price feed); nothing of them is bought, sold or burned
 *   new coins        launching creates two NEW coins; their own trading fees fund their burns (winner takes the burn: PAIR_BURN_SENTENCE)
 *   start / end      the first window starts at the next 00:00 UTC after launch; the season is `days` windows; times in UTC and Denver
 *   tie / missing / disputed   an exact tie is a void (no burn, a receipt); a missing or disagreeing cross-read (more than
 *                    DERBY_DISAGREEMENT_PP points on the margin) withholds the window: no reading, no burn
 *
 * Pure and client-safe.
 */
const fmt = (ms: number, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(ms));

export function derbyExplainer(spec: CoinVsSpec, tickers: { a: string; b: string }): { references: string; created: string; window: string; start: string; end: string; tie: string; missing: string } {
  const startMs = Date.parse(`${spec.season.start}T00:00:00Z`), endMs = startMs + spec.season.days * 86_400_000;
  const unit = spec.window === "weekly" ? "week, from Monday 00:00 to the next Monday 00:00 UTC" : "UTC day, from midnight to midnight UTC";
  return {
    references: `${spec.a.symbol} and ${spec.b.symbol} are reference feeds. Burnticker only reads their published feeds and never trades or burns them.`,
    created: `Launching creates two new coins, $${tickers.a || "A"} and $${tickers.b || "B"}. Their own trading fees fund their burns. What burns is $${tickers.a || "A"} or $${tickers.b || "B"} supply, never the reference coins.`,
    window: spec.flip ? `Each window is one ${unit}. The check is whether ${spec.a.symbol} has grown larger than ${spec.b.symbol}. In the first window where it has, $${tickers.a || "A"}'s rule fires once. If the season ends first, $${tickers.b || "B"}'s rule fires instead. If ${spec.a.symbol} is already the larger coin when you launch, the launch is refused, because there is nothing to flip.` : `Each window is one ${unit}. The coin on the side that gained more in that window, in percentage terms, has its rule fire.`,
    start: `The first window starts at ${fmt(startMs, "UTC")}, which is ${fmt(startMs, "America/Denver")}. That is the first full window after launch.`,
    end: `The last window ends at ${fmt(endMs, "UTC")}, which is ${fmt(endMs, "America/Denver")}. That makes ${spec.season.days} days of windows. Then each coin's own burn pool burns down over 28 days and the coins retire.`,
    tie: "An exact tie is a void. Neither coin burns, and the receipt says so.",
    missing: `A missing reading, or an independent cross-read that disagrees by more than ${DERBY_DISAGREEMENT_PP} points on the margin, withholds that window. That window has no reading and no burn.`,
  };
}
