import type { ReceiptStatusJson } from "@/lib/burnticker/pageTypes";

/**
 * RECEIPT STATES AND THE PAIR'S LAST RESULT IN PLAIN WORDS (prelaunch audit 2026-10-18 A-5). The burn log printed the raw status
 * "pending-pair", and the pair's share line and embed said "settled 0 → neither side burned" whenever no side had burned yet, although
 * Denver had won and its burn was waiting for both coins to graduate. Client-safe: no imports beyond types.
 */

/** A short phrase for a receipt's state, for the burn log and the verify summary. */
export const RECEIPT_STATUS_WORDS: Record<ReceiptStatusJson, string> = {
  planned: "queued for the next burn run",
  sending: "being sent now",
  confirmed: "burned",
  skipped: "nothing was bought",
  void: "void, so nothing burns",
  exhausted: "the burn pool was empty",
  nothing: "no burn for this result",
  "pending-pair": "waiting for both coins to graduate",
  voided: "voided with the pair",
  forwarded: "forwarded to the winning coin",
};
export const receiptStatusWords = (s: string): string => (RECEIPT_STATUS_WORDS as Record<string, string>)[s] ?? "not yet decided";

/**
 * HB-135 (hourly run 11): the pair page's lead names the pair by its two tickers, never by its id ("This is the rivalry pair
 * seawin-vs-denwin-espn-game-nfl-2475453-s."); the id belongs in the URL and the share line only.
 */
export const pairLeadSentence = (a: string, b: string): string => `This is the rivalry pair of $${a.replace(/^\$/, "")} and $${b.replace(/^\$/, "")}.`;
/** HB-135: the "next scheduled market" cell of a one-result pair whose result is in (a bare "—" read as missing data). */
export const NEXT_MARKET_NONE_DECIDED = "None. The one result is in.";
/** HB-135: that cell's words when no market is scheduled: none for a decided one-result pair, else the dash the other cells use. */
export const nextMarketNone = (o: { oneShot: boolean; settlements: number }): string => (o.oneShot && o.settlements > 0 ? NEXT_MARKET_NONE_DECIDED : "—");

/** What the pair page needs to say about its latest result (tokenPage.ts pairTally fills it). */
export interface PairLastFacts {
  /** the side whose coin won the result (its receipt's pairRole), else the side that burned */
  wonSide: "A" | "B" | null;
  /** the side that burned tokens for it, when one has */
  burnedSide: "A" | "B" | null;
  burned: string | null;
  /** the winning side's receipt state, and the other side's */
  winnerStatus: string | null; loserStatus: string | null;
  void: boolean;
}

/** One sentence for the pair's latest result, by role and state; no arrows, no dates. */
export function pairLastSentence(f: PairLastFacts | null, A: string, B: string, fmt: (n: string) => string = (n) => n): string | null {
  if (!f) return null;
  if (f.void) return "The last result was void, so neither side burned.";
  const side = (x: "A" | "B") => (x === "A" ? A : B), other = (x: "A" | "B") => (x === "A" ? B : A);
  if (f.burnedSide && (!f.wonSide || f.wonSide === f.burnedSide)) {
    const n = f.burned ? ` ${fmt(f.burned)}` : "";
    // a pair whose receipts carry no role (an inverted pair burns the side whose team lost): name who burned, not who won
    if (!f.wonSide) return `${side(f.burnedSide)} burned${n} tokens for the last result.`;
    const fwd = f.loserStatus === "forwarded" ? ` ${other(f.burnedSide)} forwarded its share to ${side(f.burnedSide)}'s burn pool.` : "";
    return `${side(f.burnedSide)} won the last result and burned${n} tokens.${fwd}`;
  }
  if (!f.wonSide) return "Neither side won the last result, so nothing burned for it.";
  const w = side(f.wonSide), l = other(f.wonSide);
  const burn = f.winnerStatus === "pending-pair" ? "Its burn runs once both coins graduate and their pools are registered."
    : f.winnerStatus === "planned" || f.winnerStatus === "sending" ? "Its burn is queued for the next burn run."
    : f.winnerStatus === "voided" ? "The pair voided, so this result never burns."
    : f.winnerStatus === "forwarded" ? "Its share was forwarded."
    : "Its burn has not run yet.";
  const lost = f.loserStatus === "forwarded" ? ` ${l} has forwarded its share to ${w}'s burn pool.` : f.loserStatus === "pending-pair" ? ` ${l}'s share moves to ${w}'s burn pool at the same time.` : "";
  return `${w} won the last result. ${burn}${lost}`;
}
