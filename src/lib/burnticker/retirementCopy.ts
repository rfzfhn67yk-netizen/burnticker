import { WIND_DOWN_DAYS as DEFAULT_WIND_DOWN_DAYS } from "@/lib/burnticker/coinPage";

/**
 * WHAT RETIREMENT MEANS IN PRACTICE (website-14, ChatGPT product idea 8). Beside every end date: can holders still sell, does trading
 * continue, do fees still come in, which burns stop, and what happens to what is left. Written from the SHIPPED behaviour only:
 *
 *   · the pool and its locked liquidity stay (the LP is locked forever; nothing removes it), so trading and selling continue;
 *   · trading fees keep arriving (the curve or pool fees, and 80% of the SOL side of the locked liquidity's fees) into the burn pool;
 *   · the rule's event burns stop when the rule ends (multiKeeper.ts detectRuleEnd);
 *   · what is left winds down over 28 days of scheduled burns, then the coin retires; a retired coin's pool is swept (spent and burned)
 *     whenever fee income lifts it past the sweep threshold, 0.05 SOL by default (multiKeeper.ts planRuleEnd, rules.ts onEnd).
 *
 * ONE MODULE ON PURPOSE: the end-of-rule sink round (branch burnticker/endsink2, LAUNCHPAD-PATH §74) is not merged, and nothing here says
 * it exists. When it lands, the merge reviewer changes the "leftover" answer below (and only this file) to the sink wording; every page
 * that shows these facts reads them from here. Plain sentences, lint-clean (test/burntickerWebsite14.test.ts).
 */
export interface RetirementFact { q: string; a: string }

export const RETIREMENT_FACTS: readonly RetirementFact[] = [
  { q: "Can holders still sell?", a: "Yes. The coin's Raydium pool stays, and its liquidity is locked forever, so anyone can still sell or trade it." },
  { q: "Does trading continue?", a: "Yes. Nothing stops trading when a rule ends. The end only changes what the burn pool is used for." },
  { q: "Do fees still come in?", a: "Yes. Trading fees keep flowing into the coin's burn pool as a small trickle, as long as people trade it." },
  { q: "Which burns stop?", a: "The rule's own burns stop. No new result is read for the coin, so no result can start a burn." },
  // END-SINK SWITCH: when burnticker/endsink2 merges, this answer becomes the sink wording (where the leftover goes and who can send it).
  { q: "What happens to what is left?", a: `The burn pool spends down what is left in scheduled burns over ${DEFAULT_WIND_DOWN_DAYS} days, and then the coin retires. After that, fee income that builds up past a small threshold is spent and burned from time to time. Nothing is sent to another coin.` },
];

/** One heading for the block. */
export const RETIREMENT_HEADING = "What the end of the rule means";
/** A coin with no end date. */
export const NO_END_LINE = "This coin has no end date, so none of this applies to it.";
