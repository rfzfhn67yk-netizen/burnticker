import { WIND_DOWN_DAYS as DEFAULT_WIND_DOWN_DAYS } from "@/lib/burnticker/coinPage";

/**
 * WHAT RETIREMENT MEANS IN PRACTICE (website-14, ChatGPT product idea 8). Beside every end date: can holders still sell, does trading
 * continue, do fees still come in, which burns stop, and what happens to what is left. Written from the SHIPPED behaviour only:
 *
 *   · the pool and its locked liquidity stay (the LP is locked forever; nothing removes it), so trading and selling continue;
 *   · trading fees keep arriving (the curve or pool fees, and 80% of the SOL side of the locked liquidity's fees) into the burn pool;
 *   · the rule's event burns stop when the rule ends (multiKeeper.ts detectRuleEnd);
 *   · what is left goes where the rule's end says (rules.ts endSinkOf, onEnd): a rule with an end sink sends it, and later fees, to that
 *     sink's burn ($DEFICIT, the pair winner, a coin the creator named, or Solana's incinerator) when it ends on a result, and only a void
 *     end, or a rule with no sink, winds down over 28 days of scheduled burns on the coin itself (multiKeeper.ts planRuleEnd).
 *
 * LAUNCH WIZARD AUDIT 2026-10-19 F9: the end-sink round merged long ago, and the leftover answer still said a 28-day burn-down on the
 * coin and "Nothing is sent to another coin" on every coin, the live NEXTM6 included. The answer is no longer one fixed sentence: a page
 * that knows the coin's rule shows the rule's own end right above these facts (coinPage.ts ruleEndLine, the review's end line, both from
 * describe.ts endText) and passes LEFTOVER_SEE_END; a page without a rule gets the general answer, which is true of every shape. Plain
 * sentences, lint-clean (test/burntickerWebsite14.test.ts).
 */
export interface RetirementFact { q: string; a: string }

export const RETIREMENT_FACTS: readonly RetirementFact[] = [
  { q: "Can holders still sell?", a: "Yes. The coin's Raydium pool stays, and its liquidity is locked forever, so anyone can still sell or trade it." },
  { q: "Does trading continue?", a: "Yes. Nothing stops trading when a rule ends. The end only changes what the burn pool is used for." },
  { q: "Do fees still come in?", a: "Yes. Trading fees keep flowing into the coin's burn pool as a small trickle, as long as people trade it." },
  { q: "Which burns stop?", a: "The rule's own burns stop. No new result is read for the coin, so no result can start a burn." },
  { q: "What happens to what is left?", a: `That depends on the coin's rule. When the rule ends on a result, what is left, and any fees that arrive later, goes where the rule's end says: most often to $DEFICIT's burn, or to the winning coin's burn in a pair. A voided result, or a rule that names nowhere else, burns down what is left on the coin itself over ${DEFAULT_WIND_DOWN_DAYS} days.` },
];

/** The leftover answer on a page that shows the coin's own end right above the facts (the coin page's end row, the review's end line). */
export const LEFTOVER_SEE_END = "It goes where the end of the rule above says. That end is read from the coin's own rule, so every page says the same.";

/** The facts with the leftover answer for this page (the general answer when none is given). */
export function retirementFacts(leftover: string | null = null): readonly RetirementFact[] {
  return leftover ? RETIREMENT_FACTS.map((f) => (f.q === "What happens to what is left?" ? { q: f.q, a: leftover } : f)) : RETIREMENT_FACTS;
}

/** One heading for the block. */
export const RETIREMENT_HEADING = "What the end of the rule means";
/** A coin with no end date. */
export const NO_END_LINE = "This coin has no end date, so none of this applies to it.";
