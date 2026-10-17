/**
 * Private review 10 (2026-10-14), the coin page's fact rows: "What fires the rule" names the actual publisher and finality route the page
 * knows (a sports coin: the on-chain payout or licensed final score, and the league's confirming source), never the vague "the source's
 * own published data"; "Next result" printed the keeper's next check as if it were the publisher's result time, so that row is now
 * "Next source check" unless a market close is known.
 */
import { parseEspnSeries } from "@/lib/burnticker/sources/espn";
import { GAME_AGREE_LINE, GAME_BURN_LINE, GAME_SETTLEMENT, leagueProvenance, SINGLE_SOURCE_LINE, SPORTS_PROVENANCE } from "@/lib/burnticker/sources/provenance";
import { isSingleSourceSeries, SINGLE_SOURCE_PUBLISHER } from "@/lib/burnticker/singleSource";

export const SOURCE_DETAILS_UNAVAILABLE = "The source details are unavailable right now.";
export const PUBLISHER_DECIDES = "The publisher decides when the result is available.";

/**
 * Walkthrough 13 (2026-10-14): a coin's status carries its selector key with the oracle in front ("catalogue:espn.team:nfl-PHI…"), so the
 * $PHINFLWIN page said "The source details are unavailable right now". The series is the key without that prefix.
 */
export function seriesOfSelector(selectorKey: string | null | undefined): string | null {
  if (!selectorKey) return null;
  return selectorKey.replace(/^(catalogue|polymarket|kalshi|derby):(?=[a-z])/i, "");
}

/** Who publishes the result a coin waits for, for the next-results list (never "the source's own published data"). */
export function sourcePublisher(oracle: string, rawSelectorKey: string | null | undefined): string {
  if (oracle === "kalshi") return "A prediction market's settled result";
  if (oracle === "polymarket") return "Polymarket's settled result, read on Polygon";
  const key = seriesOfSelector(rawSelectorKey);
  if (key && parseEspnSeries(key)?.kind === "game") return "A licensed final score, the league's own feed, or the game's on-chain settlement, whichever reads the final first";
  if (key && parseEspnSeries(key)) return "Polymarket's on-chain payout for the game where a market exists, otherwise TheSportsDB's licensed final score";
  if (key && isSingleSourceSeries(key)) return `${SINGLE_SOURCE_PUBLISHER[key.split(":")[0]]}'s own published data`;
  if (key && /^treasury\./.test(key)) return "U.S. Treasury, Debt to the Penny";
  return "The publisher named in the rule";
}

/** The trigger row's note when no receipt links its source yet. */
export function coinSourceNote(oracle: string, rawSelectorKey: string | null | undefined): string {
  if (oracle === "kalshi") return "Read from the prediction market that settles it.";
  if (oracle === "polymarket") return "Read from Polymarket, with each result read on Polygon.";
  const selectorKey = seriesOfSelector(rawSelectorKey);
  const sports = selectorKey ? parseEspnSeries(selectorKey) : null;
  // owner 2026-10-14: a second source checks a game where one can read it; otherwise TheSportsDB alone after a 12-hour hold
  // owner 2026-10-16: a single-game coin burns once two sources agree on the final, or 12 hours after the first read with one source
  if (sports?.kind === "game") return `The game's result comes from ${GAME_SETTLEMENT}. ${GAME_BURN_LINE} ${GAME_AGREE_LINE}`;
  if (sports) return `Each game settles on ${SPORTS_PROVENANCE.settlement}. Where a second source can read the game, it must agree: ${leagueProvenance(sports.league).confirmation}. ${SINGLE_SOURCE_LINE}`;
  if (selectorKey && isSingleSourceSeries(selectorKey)) return `Read from ${SINGLE_SOURCE_PUBLISHER[selectorKey.split(":")[0]]}'s own published data.`;
  if (selectorKey && /^treasury\./.test(selectorKey)) return "Read from the U.S. Treasury's Debt to the Penny data on Fiscal Data.";
  return SOURCE_DETAILS_UNAVAILABLE;
}

/** The next-time row: a known market close, else the keeper's next source check (never called the result time). */
export function nextTimeRow(nextCloseTime: string | null | undefined, nextCheckAt: string | null | undefined): { label: string; value: string; note: string } {
  const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;
  if (nextCloseTime) return { label: "Next market close", value: utc(nextCloseTime), note: `Times are in UTC. ${PUBLISHER_DECIDES}` };
  if (nextCheckAt) return { label: "Next source check", value: utc(nextCheckAt), note: `Times are in UTC. ${PUBLISHER_DECIDES}` };
  return { label: "Next source check", value: "None scheduled", note: "This rule has no scheduled check this site knows of." };
}
