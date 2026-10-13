import { PAIR_OPERATOR_SHARE_LINE } from "@/lib/burnticker/feeShareLine";
import { PAIR_BURN_SENTENCE, teamRefByName } from "@/lib/burnticker/describe";

/**
 * WHERE A PAIR'S MONEY GOES, IN PLAIN WORDS (website brief 2026-10-11 §2), by rule version:
 *
 *   winner-takes-the-burn   pairs made since 2026-10-11 (LAUNCHPAD-PATH §40; `pair.winnerTakesBurn: true` in both locked rules) —
 *                           the whitepaper §5.5 outcomes: a win forwards the loser's rule spend to the winner's burn pool; a draw or a
 *                           void moves nothing; no result 72 h after a reading → the coin burns as unpaired; a loss whose forward does
 *                           not land within 72 h → the losing coin burns that period as a plain one; a dead winner → the fuel stays put
 *   separate pools          pairs made before 2026-10-11 (none on mainnet): each coin burns only its own pool on its own result
 *
 * Shown on the review card before a pair launch and on both pair pages. Nothing is paid to holders on any outcome. The one-liner is the shared
 * PAIR_BURN_SENTENCE (describe.ts).
 */
export type PairRuleVersion = "winner-takes-the-burn" | "separate-pools";
export interface FundsFlow { version: PairRuleVersion; versionLabel: string; oneLiner: string; steps: { title: string; text: string }[]; outcomes: { when: string; then: string }[]; never: string }

export const pairRuleVersion = (winnerTakesBurn: boolean): PairRuleVersion => (winnerTakesBurn ? "winner-takes-the-burn" : "separate-pools");

const FEES = `Each coin's trades pay a creator fee into that coin's own burn pool. ${PAIR_OPERATOR_SHARE_LINE} Nothing can be withdrawn from a burn pool.`;

export function pairFundsFlow(version: PairRuleVersion, tickers: { a: string; b: string } = { a: "A", b: "B" }): FundsFlow {
  const A = `$${tickers.a}`, B = `$${tickers.b}`;
  if (version === "separate-pools") return {
    version, versionLabel: "Rule version: separate pools, for pairs made before 2026-10-11; none on mainnet",
    oneLiner: `Each coin burns only from its own burn pool, on its own result, and neither pool pays the other.`,
    steps: [{ title: "Where fees come from", text: FEES }, { title: "Which coin burns", text: `The coin whose rule a result fires spends a share of its own pool buying itself and burns what it bought. ${A} and ${B} never share fuel.` }],
    outcomes: [{ when: "A draw or a voided result", then: "Nothing burns on either side." }],
    never: "Nothing is paid to holders on any result, and holders' balances are never touched.",
  };
  return {
    version, versionLabel: "Rule version: winner takes the burn (pairs made since 2026-10-11)",
    oneLiner: PAIR_BURN_SENTENCE,
    steps: [
      { title: "Where fees come from", text: FEES },
      { title: "Where they go on a result", text: `The loser's burn pool sends exactly what its own rule would have spent for that result (for a one-result pair, all of it) to the winner's burn pool, in a public forward transaction with a memo.` },
      { title: "Which coin burns", text: `Only the coin whose rule the result fired burns. That coin is the rule's winner, which may not be the team that won. Its normal burns spend its pool, now including the forwarded SOL, buying that coin and burning every token bought. The other coin's supply is untouched.` },
    ],
    outcomes: [
      { when: "A draw (posted only when it truly was one) or a voided result", then: "Nothing moves between the two burn pools. Each coin's own rule decides its own burn for that result." },
      { when: "No result 72 hours after a reading", then: "That coin burns the period as an unpaired coin, from its own pool, and the period can no longer forward." },
      { when: "A loss is recorded but the forward does not land within 72 hours", then: "The losing coin burns that period as a plain one, and a public event (PairForwardMissing) records the missed forward." },
      { when: "The winner has no live trading pool", then: "Nothing moves. The fuel stays in the loser's pool, and its own later burns spend it." },
    ],
    never: "Nothing is paid to holders on any outcome. SOL only moves between two program accounts that nobody can withdraw from, and holders' balances are never touched.",
  };
}

/**
 * A RIVALRY SERIES PAIR (every game between two teams this season; sources/espn.ts window `meetings`). The same winner-takes-the-burn
 * money path, said per game and at the season's end, each claim from the program: after each game, pair.rs forward_to_winner moves the
 * losing coin's share for that game to the winning coin's burn pool (a draw moves nothing; a winner without a live pool gets 0); at the
 * end, end.rs forward_on_end moves what is left in the losing coin's pool to the pair winner of the season-end result while that coin is
 * live and still paired, else to $DEFICIT; the winning coin burns down its own rest (endSinkKeeper.ts); a level series records a void end
 * and each coin burns down on itself.
 */
export function meetingsFundsFlow(tickers: { a: string; b: string }, teams: { a: string; b: string }, o: { playoffs?: boolean } = {}): FundsFlow {
  const A = `$${tickers.a}`, B = `$${tickers.b}`;
  return {
    version: "winner-takes-the-burn", versionLabel: "Rule version: winner takes the burn, every game between two teams this season",
    oneLiner: `Each game between ${teamRefByName(teams.a)} and ${teamRefByName(teams.b)} burns the coin of the team that won it, and at the end of the season the rest goes to the coin of the team that won more of those games.`,
    steps: [
      { title: "Where fees come from", text: FEES },
      { title: "After each game between them", text: "The coin of the team that won spends its own share of its burn pool burning itself. The other coin sends exactly the share its own rule sets for that game to the winning coin's burn pool, in a public transaction with a memo, and that SOL is spent burning the winning coin too. Games against other teams do nothing." },
      { title: "At the end of the season", text: `When both teams' seasons are over${o.playoffs === false ? "" : ", playoffs included"}, the coin of the team that won fewer of the games between them sends what is left in its burn pool, and any fees that arrive later, to the other coin's burn pool. The coin of the team that won more burns down what is left on itself. For example, if ${teamRefByName(teams.a)} won more, ${B} sends its rest to the ${A} burn pool and all of it burns ${A}.` },
    ],
    outcomes: [
      { when: "A game ends in a draw", then: "Nothing moves for that game. It counts for neither team." },
      { when: "A game is postponed or cancelled", then: "It counts for neither team until it is played." },
      { when: "The winning coin of a game has no live trading pool", then: "Nothing moves for that game. The share stays in the other coin's pool." },
      { when: "The two teams won the same number of games against each other", then: "Nothing moves at the end. Each coin burns down what is left on itself over four weeks." },
      { when: "The coin of the team that won more has no live trading pool at the end", then: "The other coin's rest goes to $DEFICIT's burn instead." },
      { when: "No result 72 hours after a game's reading", then: "That coin burns the game as an unpaired coin, from its own pool, and that game can no longer forward." },
    ],
    never: "Nothing is paid to holders on any outcome. SOL only moves between two program accounts that nobody can withdraw from, and holders' balances are never touched.",
  };
}
