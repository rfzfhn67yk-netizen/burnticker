/**
 * HOW BURNS ARE SETTLED (owner, 2026-10-12: "add a 'How Burns Are Settled' section"): the words of /burnticker/how-burns-settle, the
 * coin page's one link under "Next result" and the whitepaper's short section. Pure and client-safe: every number comes in through
 * SettlementFacts, which settlement.ts derives from the code (multiKeeper.ts pollMsFor, the burn program's TWAP and spend constants in
 * src/lib/burnReceipts/constants.ts, UMA_DEFAULT_LIVENESS_S in sources/polyStated.ts, the $DEFICIT rules file's schedule). Plain
 * English, lint-clean, in test/burntickerPlainCopy.test.ts. "About" marks a typical range; nothing here promises a time.
 */

import { SPREAD_DEFICIT_LINE, SPREAD_LINES } from "@/lib/burnticker/spreadCopy";
import { GAME_FINAL_SOURCES_LINE } from "@/lib/burnticker/gameCoin";

export const SETTLEMENT_PATH = "/burnticker/how-burns-settle";
export const SETTLEMENT_TITLE = "How burns are settled";
/** The coin page's one line under "Next result". */
export const SETTLEMENT_LINK = { href: SETTLEMENT_PATH, label: "How burns are settled" };
export const SETTLEMENT_DESCRIPTION = "How often each coin's source is read, when a result counts as final, how the burn runs and how long it usually takes after the event.";

/** The numbers the page states, each derived from a code constant (settlement.ts settlementFacts). */
export interface SettlementFacts {
  /** the keeper's default poll for a market-settled coin, minutes (pollMsFor) */
  marketPollMin: number;
  /** the default poll for a published feed with no schedule of its own, minutes (pollMsFor's pollEverySec default) */
  feedPollMin: number;
  /** the program's swap guard window, minutes (MIN_TWAP_WINDOW_SECS to MAX_TWAP_WINDOW_SECS) */
  guardMinMin: number; guardMaxMin: number;
  /** UMA's default dispute window before a Polymarket payout, hours (UMA_DEFAULT_LIVENESS_S) */
  umaHours: number;
  /** $DEFICIT's reads of the Treasury figure, as clock times, and the time zone they are in (its rules file) */
  deficitReads: string[]; deficitZone: string;
}

/** "16:30" to "4:30 p.m.". */
export function clockWords(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const pm = h >= 12, h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${pm ? "p.m." : "a.m."}`;
}
const zoneWords = (z: string): string => (z === "America/New_York" ? "New York time" : z);
const list = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const hours = (n: number): string => `${n} ${n === 1 ? "hour" : "hours"}`;

export interface SettlementSection { id: string; heading: string; paragraphs: string[] }

export function settlementSections(f: SettlementFacts): { intro: string; sections: SettlementSection[] } {
  const reads = list(f.deficitReads.map(clockWords));
  return {
    intro: "A burn follows a result in four steps: the source is read, the result becomes final, the burn runs, and the receipt appears. These are the times the code uses for each step.",
    sections: [
      { id: "read", heading: "How often each source is read", paragraphs: [
        `A coin settled by a market is read every ${f.marketPollMin} minutes. A coin on one Polymarket market is read every hour until the day before the market's end date, and every ${f.marketPollMin} minutes from then on.`,
        `A coin settled by a published data feed is read on that feed's own schedule. A feed with no schedule of its own is read every ${f.feedPollMin} minutes.`,
        `$DEFICIT reads the Treasury's debt figure at ${reads} ${zoneWords(f.deficitZone)} on business days.`,
      ] },
      { id: "final", heading: "When a result counts", paragraphs: [
        "A result counts only when it is final.",
        // coordinator 2026-10-20: one game rule, said once (two reads five minutes apart), where each league's final is read
        // (gameCoin.ts GAME_FINAL_SOURCES_LINE), and the season coins' single-source hold (gameSettle.ts SINGLE_SOURCE_HOLD_MS)
        `A game coin burns once its final has been read and a second read five minutes later agrees. ${GAME_FINAL_SOURCES_LINE} Every source that reads the game must agree, and a disagreement holds the burn until they do. The game's on-chain settlement counts as one source.`,
        "For a season coin, a game that no second source can read, because it has no Polymarket market and no league feed, counts on TheSportsDB alone, once its final score has stood unchanged for 12 hours.",
        `A Polymarket market counts only after its on-chain payout is recorded. That follows UMA's dispute window of about ${hours(f.umaHours)}, and longer if a proposal is disputed.`,
        "A scheduled publisher's number counts when it is posted.",
      ] },
      { id: "burn", heading: "From a final result to the burn", paragraphs: [
        "The cycle that sees a final result submits the reading and runs the burn in the same pass.",
        `Before it swaps, the program checks the pool's current rate against its average over the last ${f.guardMinMin} to ${f.guardMaxMin} minutes. A pool that is already trading has that history.`,
        // owner 2026-10-20: how a burn above the cap is spread out (spreadCopy.ts; dispersal.ts), and $DEFICIT's own wording
        ...SPREAD_LINES,
        SPREAD_DEFICIT_LINE,
      ] },
      { id: "times", heading: "Typical times after the event", paragraphs: [
        // CH8-5 (Codex comprehensive run): the generic line no longer promises game results in minutes; games have their own lines below
        `Scheduled data read on a timer (not game results): about ${f.marketPollMin} to ${f.marketPollMin + f.guardMaxMin} minutes after a new figure is posted.`,
        // eighth pass HS-74 / HB-183 / HB-195: per league, and the market-payout wait said where it applies
        "A game coin, or two teams in one game: about five to twenty minutes after its score source marks the game final; about five minutes for MLB and NHL games, whose official schedules are read every minute while a tracked game is played.",
        `A team, season or rivalry coin whose game has a Polymarket market: about ${hours(f.umaHours)} after the game, because it waits for that market's on-chain payout, then a second read five minutes later.`,
        "A season coin's game that only TheSportsDB can read: about 12 hours after its final score is first read.",
        `Polymarket markets: about ${hours(f.umaHours)}, plus a few minutes.`,
        "$DEFICIT: within about an hour of the read that first sees each new Treasury figure, which is posted on the business day after the day it describes.",
      ] },
      { id: "receipt", heading: "The receipt", paragraphs: [
        "When the burn's transaction confirms, its receipt appears on the coin's page: the memo, the swap's signature and the amount burned.",
      ] },
    ],
  };
}
