import { OPERATOR_SHARE_LINE, PAIR_OPERATOR_SHARE_LINE, postGraduationShareLine, type PostGraduationShares } from "@/lib/burnticker/feeShareLine";
import { CANDIDATES_PAIR_SENTENCE, GAME_PAIR_SENTENCE, PAIR_BURN_SENTENCE, teamRefByName } from "@/lib/burnticker/describe";

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

/**
 * sources-7 (QA walkthrough 11 H3: the series pair's review said 0.17% and 0.04% here and 0.88% and 0.08% in its fee table, and called
 * the burn pool's share a "creator fee"). The fee step is built from one post-graduation split: the pair curve's own coins use the pair
 * split (creator fee off); every LaunchLab pair (a rivalry series, two candidates, two teams in one game) uses the LaunchLab tier's split,
 * and the review passes fees.ts postGraduationFeesFor(cluster), the same source as its fee table.
 */
type SplitLike = { legs: readonly { label: string; bps: number }[] } | PostGraduationShares;
export const pairFeesText = (fees?: SplitLike | null, o: { pairCurve?: boolean } = {}): string =>
  `Part of every trade's fee goes into that coin's own burn pool, and the creator gets none of it. ${fees ? postGraduationShareLine(fees) : o.pairCurve ? PAIR_OPERATOR_SHARE_LINE : OPERATOR_SHARE_LINE} Nothing can be withdrawn from a burn pool.`;
const FEES = pairFeesText(null, { pairCurve: true });

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
export function meetingsFundsFlow(tickers: { a: string; b: string }, teams: { a: string; b: string }, o: { playoffs?: boolean; fees?: SplitLike | null } = {}): FundsFlow {
  const A = `$${tickers.a}`, B = `$${tickers.b}`;
  return {
    version: "winner-takes-the-burn", versionLabel: "Rule version: winner takes the burn, every game between two teams this season",
    oneLiner: `Each game between ${teamRefByName(teams.a)} and ${teamRefByName(teams.b)} burns the coin of the team that won it, and at the end of the season the rest goes to the coin of the team that won more of those games.`,
    steps: [
      { title: "Where fees come from", text: pairFeesText(o.fees) },
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

/**
 * A SETTLED-EVENT PAIR (owner 2026-10-13): two candidates in one race, or two teams in one game. Each claim is the program's and the
 * keeper's: the result counts once both sides are final (multiKeeper.planRace); the keeper writes one PairResult naming the winner;
 * pair.rs forward_to_winner moves the losing coin's pool (100 %, this one-shot's share) to the winning coin's burn pool; end.rs
 * forward_on_end sends whatever is left, and later fees, to the winner while it is live and still paired (partner_won), else to $DEFICIT;
 * with no single winner no PairResult exists and both ends go to $DEFICIT. `names` are the two candidates or the two teams.
 */
/**
 * Audit 12 item 5: a race whose two markets are PARTY outcomes ("Democratic Party", "Republican Party"; Polymarket's state Senate races)
 * settles on the party's result, whoever the nominee is, so every sentence names the parties, never the candidates. True when both
 * names are parties.
 */
/** The candidates sentence said for two party outcomes (the settlement subject is the party, whoever its nominee is). */
export const PARTIES_PAIR_SENTENCE = "Two markets, one race, one party each: the coin of the party that wins burns its own pool on the result and takes the other coin's pool at the end. The result is the party's, whoever its nominee is. If neither party wins, both pools go to $DEFICIT's burn.";
export const isPartySubject = (names: { a: string; b: string }): boolean => /\bpart(y|ies)\b/i.test(names.a) && /\bpart(y|ies)\b/i.test(names.b);
export function settledPairFundsFlow(shape: "candidates" | "game", tickers: { a: string; b: string }, names: { a: string; b: string }, o: { fees?: SplitLike | null } = {}): FundsFlow {
  const A = `$${tickers.a}`, B = `$${tickers.b}`;
  const game = shape === "game";
  const party = !game && isPartySubject(names);
  const nameA = game ? teamRefByName(names.a) : names.a, nameB = game ? teamRefByName(names.b) : names.b;
  return {
    version: "winner-takes-the-burn", versionLabel: game ? "Rule version: winner takes the burn, two teams in one game" : party ? "Rule version: winner takes the burn, two parties in one race" : "Rule version: winner takes the burn, two candidates in one race",
    oneLiner: game ? GAME_PAIR_SENTENCE : party ? PARTIES_PAIR_SENTENCE : CANDIDATES_PAIR_SENTENCE,
    steps: [
      { title: "Where fees come from", text: pairFeesText(o.fees) },
      { title: game ? "When the game is final" : "When both markets are final", text: game
        ? `The result counts once, when a second source agrees on it. If ${nameA} won, ${A} spends its whole burn pool burning itself, and ${B} sends its pool to the ${A} burn pool, in a public transaction with a memo, where it burns ${A} too. If ${nameB} won, the same happens the other way round.`
        : `The race counts once, when both ${party ? "parties'" : "candidates'"} markets are final. If ${nameA} won, ${A} spends its whole burn pool burning itself, and ${B} sends its pool to the ${A} burn pool, in a public transaction with a memo, where it burns ${A} too. If ${nameB} won, the same happens the other way round.` },
      { title: "At the end", text: `The losing coin sends whatever is left in its burn pool, and any fees that arrive later, to the winning coin's burn pool. The winning coin burns down what is left on itself. If there was no single winner, each coin sends what is left to $DEFICIT's burn.` },
    ],
    outcomes: game ? [
      { when: "The game ends in a draw", then: "Nothing moves between the two coins. At the end each pool goes to $DEFICIT's burn." },
      { when: "The game is postponed", then: "Both coins wait until it is played." },
      { when: "The game is cancelled", then: "Nothing moves between the two coins. Each coin burns down what is left on itself over four weeks." },
      { when: "The winning coin has no live trading pool", then: "The losing coin's pool goes to $DEFICIT's burn instead." },
      { when: "One coin never reaches its trading pool within 30 days", then: "The pair is void. Nothing moves between the two coins, and each coin burns down what is left on itself." },
    ] : [
      { when: party ? "Another party wins, so both markets settle NO" : "A third candidate wins, so both markets settle NO", then: "Nothing moves between the two coins. At the end each pool goes to $DEFICIT's burn." },
      { when: "A market settles 50-50", then: "There is no single winner. Nothing moves between the two coins, and at the end each pool goes to $DEFICIT's burn." },
      { when: "One market is final and the other is not", then: "Both coins wait. The race counts once, when both are final." },
      { when: "The winning coin has no live trading pool", then: "The losing coin's pool goes to $DEFICIT's burn instead." },
      { when: "One coin never reaches its trading pool within 30 days", then: "The pair is void. Nothing moves between the two coins, and each coin burns down what is left on itself." },
    ],
    never: "Nothing is paid to holders on any outcome. SOL only moves between two program accounts that nobody can withdraw from, and holders' balances are never touched.",
  };
}
