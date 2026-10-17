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
  const A = tickers.a || "A", B = tickers.b || "B";
  return {
    references: `${spec.a.symbol} and ${spec.b.symbol} are reference feeds. Burnticker only reads their published feeds and never trades or burns them.`,
    created: `Launching creates two new coins, $${tickers.a || "A"} and $${tickers.b || "B"}. Their own trading fees fund their burns. What burns is $${tickers.a || "A"} or $${tickers.b || "B"} supply, never the reference coins.`,
    // the owner, 2026-10-13: name the NEW coin that burns and where the other one's share goes; never "the winner's coin"
    window: spec.flip ? `Each window is one ${unit}. The check is whether ${spec.a.symbol}'s size, its circulating supply times its feed value, has grown larger than ${spec.b.symbol}'s. In the first window where it has, $${A} burns once. If the season ends first, $${B} burns once instead. If ${spec.a.symbol} is already the larger coin when you launch, the launch is refused, because there is nothing to flip.` : `Each window is one ${unit}. ${spec.measure === "mcap" ? `The check is which of ${spec.a.symbol} and ${spec.b.symbol} grew more in size (circulating supply times the feed value), in percentage terms.` : `The check is which of ${spec.a.symbol} and ${spec.b.symbol} gained more on its feed, in percentage terms.`} $${A} burns on a window ${spec.a.symbol} wins, and $${B}'s share for that window goes to $${A}'s burn. On a window ${spec.b.symbol} wins, it is the other way round.`,
    start: `The first window starts at ${fmt(startMs, "UTC")}, which is ${fmt(startMs, "America/Denver")}. That is the first full window after launch.`,
    // audit 10 #4: the tie, missing-reading, cross-read and end paragraphs follow the comparison the rule makes (sizes once, or each window's change)
    end: spec.flip ? `The last window ends at ${fmt(endMs, "UTC")}, which is ${fmt(endMs, "America/Denver")}. That makes ${spec.season.days} days of windows. If no window has seen the flip by then, $${B} burns once at the end of the run. Then each coin's own burn pool burns down over 28 days and the coins retire.` : `The last window ends at ${fmt(endMs, "UTC")}, which is ${fmt(endMs, "America/Denver")}. That makes ${spec.season.days} days of windows. Then each coin's own burn pool burns down over 28 days and the coins retire.`,
    tie: spec.flip ? `If the two sizes are exactly equal at a window's end, ${spec.a.symbol} has not passed ${spec.b.symbol}. Nothing burns and the next window is read.` : `An exact tie is a void: both ${spec.measure === "mcap" ? "changes in size" : "changes"} were equal. Neither coin burns, and the receipt says so.`,
    missing: spec.flip ? `A missing reading, or an independent cross-read that disagrees by more than ${DERBY_DISAGREEMENT_PP}% on the comparison of the two sizes, withholds that window. Nothing burns for it, and the next window is read.` : `A missing reading, or an independent cross-read that disagrees by more than ${DERBY_DISAGREEMENT_PP} points on the margin between the two changes, withholds that window. That window has no reading and no burn.`,
  };
}
