import { pollMsFor } from "@/lib/burnticker/multiKeeper";
import { MAX_SPEND_RESERVE_BPS, MAX_TWAP_WINDOW_SECS, MIN_TWAP_WINDOW_SECS } from "@/lib/burnReceipts/constants";
import { UMA_DEFAULT_LIVENESS_S } from "@/lib/burnticker/sources/polyStated";
import { deficitRuleSchedule } from "@/lib/burnticker/deficitQueue";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { SettlementFacts } from "@/lib/burnticker/settlementCopy";

/**
 * The numbers /burnticker/how-burns-settle states, derived from the code that does the work (server only): the keeper's poll for a
 * market-settled rule and for a feed with no schedule of its own (multiKeeper.ts pollMsFor with no override), the burn program's swap
 * guard window and spend cap, UMA's default dispute window, and the $DEFICIT rules file's read times. Throws when the rules file is unread.
 */
export function settlementFacts(root = process.cwd()): SettlementFacts {
  const market = pollMsFor({}, { oracle: "polymarket" } as BurnRule);
  const feed = pollMsFor({}, { oracle: "catalogue", series: "no-such-feed" } as BurnRule);
  const sched = deficitRuleSchedule(root);
  if (!sched) throw new Error("the $DEFICIT rules file's schedule could not be read");
  return {
    marketPollMin: market / 60_000, feedPollMin: feed / 60_000,
    guardMinMin: MIN_TWAP_WINDOW_SECS / 60, guardMaxMin: MAX_TWAP_WINDOW_SECS / 60,
    spendCapPct: MAX_SPEND_RESERVE_BPS / 100, umaHours: UMA_DEFAULT_LIVENESS_S / 3600,
    deficitReads: sched.polls, deficitZone: sched.timeZone,
  };
}
