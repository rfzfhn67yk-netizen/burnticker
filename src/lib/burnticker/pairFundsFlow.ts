import { PAIR_BURN_SENTENCE } from "@/lib/burnticker/describe";

/**
 * WHERE A PAIR'S MONEY GOES, IN PLAIN WORDS (website brief 2026-10-11 §2), by rule version:
 *
 *   winner-takes-the-burn   pairs made since 2026-10-11 (LAUNCHPAD-PATH §40; `pair.winnerTakesBurn: true` in both locked rules) —
 *                           the whitepaper §5.5 outcomes: a win forwards the loser's rule spend to the winner's burn pool; a draw or a
 *                           void moves nothing; no result 72 h after a reading → the coin burns as unpaired; a loss whose forward does
 *                           not land within 72 h → the losing coin burns that period as a plain one; a dead winner → the fuel stays put
 *   separate pools          pairs made before 2026-10-11 (none on mainnet): each coin burns only its own pool on its own result
 *
 * Shown on the review card before a pair launch and on both pair pages. Nobody is paid on any outcome. The one-liner is the shared
 * PAIR_BURN_SENTENCE (describe.ts).
 */
export type PairRuleVersion = "winner-takes-the-burn" | "separate-pools";
export interface FundsFlow { version: PairRuleVersion; versionLabel: string; oneLiner: string; steps: { title: string; text: string }[]; outcomes: { when: string; then: string }[]; never: string }

export const pairRuleVersion = (winnerTakesBurn: boolean): PairRuleVersion => (winnerTakesBurn ? "winner-takes-the-burn" : "separate-pools");

const FEES = "Each coin's trades pay a creator fee into that coin's own burn pool; after the coin moves to its trading pool, 80% of the locked liquidity's fees join it (20% to the operator, fixed in code). A burn pool has no withdraw instruction.";

export function pairFundsFlow(version: PairRuleVersion, tickers: { a: string; b: string } = { a: "A", b: "B" }): FundsFlow {
  const A = `$${tickers.a}`, B = `$${tickers.b}`;
  if (version === "separate-pools") return {
    version, versionLabel: "Rule version: separate pools (pairs made before 2026-10-11; none on mainnet)",
    oneLiner: `Each coin burns only from its own burn pool, on its own result; neither pool pays the other.`,
    steps: [{ title: "Where fees come from", text: FEES }, { title: "Which coin burns", text: `The coin whose rule a result fires spends a share of its own pool buying itself and burns what it bought. ${A} and ${B} never share fuel.` }],
    outcomes: [{ when: "A draw or a voided result", then: "Nothing burns on either side." }],
    never: "Nobody is paid on any result; holders' balances are never touched.",
  };
  return {
    version, versionLabel: "Rule version: winner takes the burn (pairs made since 2026-10-11)",
    oneLiner: PAIR_BURN_SENTENCE,
    steps: [
      { title: "Where fees come from", text: FEES },
      { title: "Where they go on a result", text: `The loser's burn pool sends exactly what its own rule would have spent for that result (for a one-result pair, all of it) to the winner's burn pool, in a public forward transaction with a memo.` },
      { title: "Which coin burns", text: `Only the winner: its normal burns spend its pool, now including the forwarded SOL, buying the winner's coin and burning every token bought. The loser's supply is untouched.` },
    ],
    outcomes: [
      { when: "A draw (posted only when it truly was one) or a voided result", then: "Nothing moves between the two burn pools; each coin's own rule decides its own burn for that result." },
      { when: "No result 72 hours after a reading", then: "That coin burns the period as an unpaired coin, from its own pool, and the period can no longer forward." },
      { when: "A loss is recorded but the forward does not land within 72 hours", then: "The losing coin burns that period as a plain one, and a PairForwardMissing event is published." },
      { when: "The winner has no live trading pool", then: "Nothing moves; the fuel stays in the loser's pool and its own later burns spend it." },
    ],
    never: "Nobody is paid on any outcome: SOL only moves between two program accounts that have no withdraw path, and holders' balances are never touched.",
  };
}
