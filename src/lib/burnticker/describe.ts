import type { BurnRule } from "@/lib/burnticker/rules";
import { eventIdentity } from "@/lib/burnticker/eventIdentity";
import { teamTicker, type TeamWindow } from "@/lib/burnticker/tickers";
import { NBA_OFFICIAL_ANSWERS, championSeries, displayAbbr, findTeams, isPairOutcome, LEAGUES, leagueCannotTie, noPlayoffs, outcomeResults, outcomeWords, parseEspnSeries, seriesCannotTie, seasonLabel, seasonStartYear, teamByAbbr, teamById, type EspnSeries, type LeagueId, type Window } from "@/lib/burnticker/sources/espn";
import { parseNwsSeries, stationByCode } from "@/lib/burnticker/sources/nws";
import { fedregEoText, isFedregEo } from "@/lib/burnticker/sources/fedreg";
import { ll2Text, parseLl2Series } from "@/lib/burnticker/sources/launchLibrary";
import { parseUsgsNextSeries, parseUsgsSeries, usgsNextText, usgsText } from "@/lib/burnticker/sources/usgs";
import { nhcText, parseNhcSeries } from "@/lib/burnticker/sources/nhc";
import { parseSpcSeries, spcText } from "@/lib/burnticker/sources/spc";
import { nifcText, parseNifcSeries } from "@/lib/burnticker/sources/nifc";
import { parseVolcanoSeries, volcanoText } from "@/lib/burnticker/sources/volcano";
import { isSingleSourceSeries, singleSourceSentence } from "@/lib/burnticker/singleSource";
import { GAME_BURN_LINE } from "@/lib/burnticker/sources/provenance";
import { githubText, parseGithubSeries } from "@/lib/burnticker/sources/github";
import { parseYoutubeSeries, youtubeText } from "@/lib/burnticker/sources/youtube";
import { statedSentences } from "@/lib/burnticker/sources/polyStated";
import { isOneShotSeries } from "@/lib/burnticker/inverse";
import { hasNoBurnOutcome, oneShotFull } from "@/lib/burnticker/nextResult";
import { highLastDay, highText } from "@/lib/burnticker/derby/high";
import { FLIP_REST_LINE, derbyReadOnlySentence, raceEnd, raceEndOf } from "@/lib/burnticker/derby/spec";
import { coinvsTickers, fightName } from "@/lib/burnticker/derby/tile";
import { paramName } from "@/lib/burnticker/paramNames";
import { fitName } from "@/lib/burnticker/launchFields";

/**
 * THE AUTO-GENERATED COIN TEXT (2026-10-10, the owner thinks in sentences): from the LOCKED RULE, by deterministic templates — no model —
 * a name, a ticker, a one-liner ("burns when the Rays win") and a 3–4 sentence paragraph: what it tracks, exactly when and how much it
 * burns, the settlement source and its cross-read, what happens on the other outcome, the end, and "The creator earns nothing. Liquidity
 * locks forever at graduation, and its fees fund the burn." (LP policy: owner decision 2026-10-10; plain-English pass 2026-10-11) Every template is built from words the copy lint (config/launch/copy-lint.json) allows; test/burntickerDescribe.test.ts
 * generates the text for every fixture rule and lints it.
 *
 *   flavour   "$RAYS26 burns when the Rays win."           editable on the create screen
 *   ruleBlock the remaining sentences                       locked: re-rendered from the rule and the ticker, never typed; it always
 *             carries exactly ONE WINDOW SENTENCE (the owner: "the coin's window must be unmissable") — a season coin's "This coin
 *             covers the 2026 Eagles season only, including the playoffs. After the Eagles' last game, it burns down whatever is left
 *             over four weeks and then retires. It does not continue into 2027.", a perpetual coin's "This coin has no end date and does
 *             not retire.", a one-shot's "This coin resolves once, on <date>. Then it burns down over four weeks and retires."
 *   badge     "2026 SEASON" / "POSTSEASON 2026" / "NEXT 5 GAMES" / "PERPETUAL" / "ONE-SHOT · Oct 31, 2026" — the coin card, the coin
 *             page header, the pair page, the token metadata's first description line and the footer of every post
 *   paragraph flavour + " " + ruleBlock (the trigger said   the registry draft's description, the token metadata `description`,
 *             once: triggerOnce, HB-113)
 *                                                           the coin page header, the first daily post
 *
 * Client-safe (the wizard re-renders it as the ticker changes): no node imports.
 */

export interface DescribeCtx {
  ticker: string;
  /** What a market rule is about, in words ("the Rays win the 2026 World Series", "Abdul El-Sayed (D) wins the Michigan Senate race"). */
  eventPhrase?: string | null;
  /** The cross-read named in the text ("MLB's official results", "the Michigan certified result"). */
  crossRead?: string | null;
  /** ISO date the rule ends by (a market's end date; a game's start; a window's last game once known). */
  endsAt?: string | null;
  /** True once the window has ended (windowStatus): the badge then carries the end date. */
  ended?: boolean | null;
  /** A first-party feed rule: the feed's title, source and unit label. */
  feed?: { title: string; sourceName: string; unitLabel: string; crossRead?: string | null } | null;
  /** A name and ticker to suggest instead of the template's (the intent cards know "Rays WS"). */
  suggest?: { name: string; ticker: string } | null;
  /** For a one-game rule: the opponent and the date. */
  game?: { opponent: string; home: boolean; startsAt: string } | null;
  /**
   * A Polymarket-settled coin (sources-2): Polymarket's stated source as coin text, the cross-read when an adapter reads that publisher's
   * fact, and the dispute window (oracle/polymarket.ts polyStated → sources/polyStated.ts). Absent: the text keeps its older wording.
   */
  stated?: { phrase: string | null; crossRead: { text: string } | null; finalAfter: { text: string }; /** QA pass 9 #17: the market's end date from the server's own read (the review's due date when the page sent none) */ endsAt?: string | null } | null;
  /** A named launch's name (ll2.launch) or a channel's name (youtube.milestone), when the picker knows it. */
  subjectName?: string | null;
}
/** The window kinds a coin can have; every description carries exactly one sentence of its kind (WINDOW_SENTENCE). */
export type WindowKind = "season" | "post" | "next" | "perpetual" | "one-shot";
/** `lead`: the rule block's first sentence, whole (leadSentence), for the cards and the review that show one sentence. */
export interface CoinText { name: string; ticker: string; oneLiner: string; flavour: string; ruleBlock: string; lead: string; windowSentence: string; windowKind: WindowKind; badge: string; paragraph: string; shape: "recurring" | "one-shot" }

// HB-179 (seventh pass B-20d, HS-65): the lock only exists once the coin graduates, so the closer says when. Descriptions already
// pinned on Arweave or in token metadata keep the old sentence; they cannot be changed.
const CLOSER = "The creator earns nothing. Liquidity locks forever at graduation, and its fees fund the burn.";
/**
 * WINNER TAKES THE BURN (owner decision 2026-10-11, LAUNCHPAD-PATH §40): the locked description of a rivalry-pair coin carries this
 * sentence (its rule's pair.winnerTakesBurn). The words match rules.ts WINNER_TAKES_BURN_LINE; the copy lint's no-prizes check keeps
 * prize / reward / payout / "win fees" out of every pair sentence.
 */
export const PAIR_DESCRIPTION_SENTENCE = "This coin is paired with a rival coin, and fees from both coins burn the winner's supply. The winner is the coin whose rule a result fires.";
/**
 * THE ONE FACTUAL PAIR SENTENCE (review 2 F6, 2026-10-11): every surface that explains a registered rivalry pair — the templates gallery,
 * the landing page (site/burnticker/index.html, pinned by test/burntickerTemplates.test.ts), the review card, the Burn Derby page and the
 * pair pages — carries exactly this sentence, so no page can say the losing coin burns or that one pool cannot pay the other. It is the
 * rule semantics the keeper runs (multiKeeper.planToken: the coin whose rule maps the result to a burn is "won", the other "lost" and
 * forward_to_winner moves its share to the winner's fee PDA); `pairWinnerOf` computes the winner from the two rules and a result so a
 * named fixture can check the sentence against the engine.
 */
// UX report 3 item 6: "winner" is the coin whose RULE fires, not the team that won (a team coin often burns when its team loses)
// owner, 2026-10-12 ("doesn't the burn of the winning coin burn that coin? add that to the description"): say which coin gets bought and burned
export const PAIR_BURN_SENTENCE = "Winner takes the burn (the coin whose rule fires, not the team that won): when a result fires one coin's rule, that coin's own burn pool and the other coin's share for that result are both spent burning the winning coin, so the winner's supply shrinks and the loser's does not. Nothing is paid to holders.";
/** The review card's line for a registered rivalry pair (Coin vs Coin, a shared-selector matchup, an election pair). */
export const PAIR_REVIEW_LINE = `${PAIR_BURN_SENTENCE} A draw or a void moves nothing.`;
/**
 * PAIR ECONOMICS IN ONE VOICE (ChatGPT chat audit 6, A3, 2026-10-12). Two kinds of two-coin launch, each explained by the same four facts,
 * with the real tickers in a worked example: (a) which outcome fires, (b) which token is bought and burned, (c) whose pool pays, (d)
 * whether SOL moves between the pools. A REGISTERED pair is winner-takes-the-burn (pairForward.ts header, LAUNCHPAD-PATH §40): the
 * loser's fuel for that result moves to the winner's burn pool and burns the winner's coin; the loser's supply is untouched; a draw or a
 * void moves nothing. A MATCHUP made of two separate launches is two independent coins: each burns itself from its own pool, and no SOL
 * moves. The review card, the Coin vs Coin tile, the templates and About read these; nothing else describes pair money.
 */
export interface PairFacts { kind: "winner-takes-the-burn" | "independent"; trigger: string; burned: string; pays: string; moves: string; example: string }
export function winnerTakesBurnFacts(a: string, b: string): PairFacts {
  return {
    kind: "winner-takes-the-burn",
    // walkthrough snag 14: no sports words inside a crypto pair's facts
    trigger: `A result decides a winner by firing one coin's rule. The winner is the coin whose rule fires, whichever side that is.`,
    burned: "Only the winner's tokens are bought and burned. The loser's supply is untouched.",
    pays: "The winner's burn pool pays its own share. The loser's burn pool pays the share it would have spent if it had won.",
    moves: "SOL does move between the two pools. The loser's share for that result moves to the winner's burn pool. Nothing is paid to holders, and a draw or a void moves nothing.",
    example: `For example, if a result fires $${a}'s rule, $${a} is bought and burned with its own share, and $${b}'s share for that result moves to $${a}'s burn pool and burns $${a} too. $${b}'s supply does not change.`,
  };
}
export function independentPairFacts(a: string, b: string, teams: { a: string; b: string } | null = null): PairFacts {
  const A = teams ? teamRefByName(teams.a) : `$${a}'s side`, B = teams ? teamRefByName(teams.b) : `$${b}'s side`;
  return {
    kind: "independent",
    trigger: `These are two separate coins with their own rules. $${a}'s rule fires when ${A} lose, and $${b}'s rule fires when ${B} lose.`,
    burned: "The coin whose rule fires is bought and burned. The other coin is not touched.",
    pays: "Each coin pays from its own burn pool.",
    moves: "No SOL moves between the two coins, because they are separate launches. A tie burns neither.",
    example: `For example, if ${A} lose, $${a} spends its share of its own burn budget, the $${a} tokens bought are burned, and $${b} does nothing.`,
  };
}
/** The four facts and the example as plain sentences, in order. */
export const pairFactLines = (f: PairFacts): string[] => [f.trigger, f.burned, f.pays, f.moves, f.example];
/** Does this binary rule map the result to a burn? (A scalar or a rule without a mapping for it: no.) */
const firesOn = (r: Pick<BurnRule, "kind" | "binary">, result: "yes" | "no"): boolean => r.kind === "binary" && !!r.binary && ((result === "yes" ? r.binary.onYes : r.binary.onNo)?.fractionOfPool ?? 0) > 0;
/**
 * The winner of one result in a registered pair, from the two LOCKED RULES: the coin whose rule the result fires. null when neither or
 * both fire (a draw: nothing moves). Binary rules only (every registered pair today: one shared selector, inverted mappings).
 */
export function pairWinnerOf<T extends { ticker: string; rule: Pick<BurnRule, "kind" | "binary"> }>(a: T, b: T, result: "yes" | "no"): { winner: T; loser: T } | null {
  const fa = firesOn(a.rule, result), fb = firesOn(b.rule, result);
  if (fa === fb) return null;
  return fa ? { winner: a, loser: b } : { winner: b, loser: a };
}
/** PAIR_BURN_SENTENCE with the two coins named, for one result ("… burn $CHIEFS …; $BRONCOS's share goes to $CHIEFS's burn pool …"). */
export function pairResultSentence(a: { ticker: string; rule: Pick<BurnRule, "kind" | "binary"> }, b: { ticker: string; rule: Pick<BurnRule, "kind" | "binary"> }, result: "yes" | "no"): string {
  const w = pairWinnerOf(a, b, result);
  if (!w) return `A ${result.toUpperCase()} result fires both rules or neither. That is a draw, and nothing moves between $${a.ticker} and $${b.ticker}.`;
  return `This result fires $${w.winner.ticker}'s rule: eligible fees from both coins fund $${w.winner.ticker}'s burn, and $${w.loser.ticker}'s share for it moves to $${w.winner.ticker}'s burn pool. Nothing is paid to holders.`;
}
/**
 * SETTLED-EVENT PAIRS (owner 2026-10-13: "since it's a settled event, the loser's burn pool should go to burning the winner's token"; the
 * linked form is the default and the only form): two candidates in one race (rules.ts pair.race) and two teams in one game (pair.game).
 * The one sentence each, said wherever the pair is explained (the coin's description, the review, the templates, the guide, the API).
 * Plain words: no "buy", no prices, no "will", no dates.
 */
export const CANDIDATES_PAIR_SENTENCE = "Two markets, one race: the winner's coin burns its own pool on the result and takes the loser's pool at the end. If neither candidate wins, both pools go to $DEFICIT's burn.";
export const GAME_PAIR_SENTENCE = "One game, two teams: the winning team's coin burns its own pool on the result and takes the losing team's coin's pool at the end. After a draw, both pools go to $DEFICIT's burn.";
export const CANDIDATES_PAIR_DETAIL = "The race counts once, when both candidates' markets are final. If exactly one of them settles YES, that candidate's coin burns its whole pool on itself, and the other coin's pool goes to the winning coin's burn. If both settle NO, because a third candidate won, or a market settles 50-50, nothing moves between the two coins.";
export const GAME_PAIR_DETAIL = "The game counts once its final has been read and a second read five minutes later agrees. The winning team's coin burns its whole pool on itself, and the other coin's pool goes to the winning coin's burn. A postponed game keeps both coins waiting. A cancelled game moves nothing between them, and each coin burns down what is left on itself.";
export const settledPairShapeOf = (r: Pick<BurnRule, "pair">): "candidates" | "game" | null => (r.pair?.race ? "candidates" : r.pair?.game ? "game" : null);
/** The candidates sentence said for two party outcomes (the settlement subject is the party, whoever its nominee is). */
export const PARTIES_PAIR_SENTENCE = "Two markets, one race, one party each: the coin of the party that wins burns its own pool on the result and takes the other coin's pool at the end. The result is the party's, whoever its nominee is. If neither party wins, both pools go to $DEFICIT's burn.";
/**
 * HB-128 (hourly run 11): a market phrase whose subject is a party ("the Democratic Party controls the Senate…"), the party market's own
 * words (Polymarket's party outcomes are asked of the party), so a coin of a party race says "party", never "candidate".
 */
export const partyPhrase = (phrase: string | null | undefined): boolean => !!phrase && /^\s*(the\s+)?([A-Z][\w'.-]*\s+)+Part(y|ies)\b/.test(phrase);
export const settledPairSentence = (shape: "candidates" | "game", o: { party?: boolean } = {}): string => (shape === "game" ? GAME_PAIR_SENTENCE : o.party ? PARTIES_PAIR_SENTENCE : CANDIDATES_PAIR_SENTENCE);
// sources-7 (QA walkthrough 11 H2): a rivalry series coin says where a lost game's share goes in its own sentence (meetingsText), so the
// generic pair sentence is left out of its description, which must leave the creator's 280 characters inside the 1,500
const pairSentence = (r: BurnRule, phrase: string | null = null): string => { const sh = settledPairShapeOf(r); return sh ? ` ${settledPairSentence(sh, { party: sh === "candidates" && partyPhrase(phrase) })}` : r.pair && (r.pair as { winnerTakesBurn?: boolean }).winnerTakesBurn && !isMeetingsSeries(r) ? ` ${PAIR_DESCRIPTION_SENTENCE}` : ""; };
const BURN_DOWN = "it burns down whatever is left over four weeks and then retires";
/**
 * END SINKS (LAUNCHPAD-PATH §45; rules.ts endSinkOf, copied here because rules.ts is not client-safe): a rule with `onEnd.endSink` sends
 * whatever is left at a resolved end to its sink's burn pool, so its window sentence says where the leftover burns, and one more sentence
 * says what a void end does instead. A test pins this copy equal to rules.ts endSinkOf.
 */
export const describeEndSink = (r: Pick<BurnRule, "onEnd" | "pair" | "kind" | "binary" | "scalar">): "flagship" | "pair-winner" | "mint" | "incinerator" | null => {
  const e = r.onEnd?.endSink;
  if (e !== true && e !== "incinerator") return null;
  const m = (r.kind === "binary" ? (r.binary?.onYes ?? r.binary?.onNo) : r.scalar?.perUnit) as { tokens?: number } | null | undefined;
  if (m?.tokens !== undefined) return null;
  if (e === "incinerator") return "incinerator";
  return (r.pair as { winnerTakesBurn?: boolean } | null | undefined)?.winnerTakesBurn ? "pair-winner" : r.onEnd?.mint ? "mint" : "flagship";
};
/** The named sink's ticker ("$X"), for a rule whose end sink names a coin (end-sink picker); "$DEFICIT" otherwise. */
export const sinkTickerOf = (r: Pick<BurnRule, "onEnd">): string => (r.onEnd?.mint && r.onEnd.ticker ? `$${r.onEnd.ticker}` : "$DEFICIT");
/** end.rs: a named coin that is not live when the rule ends falls to $DEFICIT. The one clause every surface says it with. */
export const namedSinkFallback = (x: string): string => `if ${x} is not live then, to $DEFICIT's burn`;
/** Round 5: the incinerator end sink, in the words every surface uses (the owner's: "sent to Solana's incinerator, which nothing can spend from"). */
export const INCINERATOR_WORDS = "Solana's incinerator, which nothing can spend from";
/** The end result sentence of a coin whose end sink is the incinerator (endText's result line). */
export const INCINERATOR_END_RESULT = `When the rule ends on a result, the SOL left in the pool, and any fees that arrive later, is sent to ${INCINERATOR_WORDS}. No coin is swapped for it. Then the coin retires.`;
/**
 * ONE BURN OF THE WHOLE POOL (owner decision 2026-10-19; nextResult.ts oneShotFull): a coin that resolves once and spends 100 % has no
 * "rest of a losing coin" after its burn. What its end sends on is what reaches the pool later: trading fees and the reserve the rule
 * keeps back. A one-shot with an outcome that burns nothing (a market's other answer) says that the whole pool takes the same way then.
 */
export const ONE_SHOT_REST_DEFICIT = "After its one burn, anything that reaches this coin's pool later, trading fees and the kept reserve, goes to $DEFICIT's burn.";
export const ONE_SHOT_REST_INCINERATOR = "After its one burn, anything that reaches this coin's pool later, trading fees and the kept reserve, is sent to Solana's incinerator and burned.";
export const oneShotRestCoin = (x: string): string => `After its one burn, anything that reaches this coin's pool later, trading fees and the kept reserve, goes to ${x}'s burn; ${namedSinkFallback(x)}.`;
export const ONE_SHOT_NO_BURN_LINE = "If the rule ends without its burn, the whole pool goes the same way.";
const sinkPhrase = (k: "flagship" | "pair-winner" | "mint" | "incinerator", r?: Pick<BurnRule, "onEnd">): string => (k === "pair-winner" ? "whatever is left burns the winning coin, or $DEFICIT if there isn't one," : k === "incinerator" ? `whatever SOL is left is sent to ${INCINERATOR_WORDS},` : k === "mint" && r ? `whatever is left burns ${sinkTickerOf(r)}, or $DEFICIT if ${sinkTickerOf(r)} is not live then,` : "whatever is left burns $DEFICIT,");
/** The window sentence's ending: the four-week burn-down, or (end sinks) where the leftover burns. */
const burnDown = (r: BurnRule): string => { const k = describeEndSink(r); return k ? `${sinkPhrase(k, r)} and the coin retires` : BURN_DOWN; };
/** The void sentence that follows the window sentence of a rule with an end sink ("" otherwise). */
export const END_SINK_VOID_SENTENCE = "If the result is voided or the season is cancelled, whatever is left burns down on this coin over four weeks instead.";
/** QA pass 9 #19 (2026-10-13): "the season is cancelled" only where a season exists (a team or rivalry coin); every other rule says the result. */
export const END_SINK_VOID_SENTENCE_PLAIN = "If the result is voided, whatever is left burns down on this coin over four weeks instead.";
/** HB-103: the void of a candidates pair is the pair's own (a coin missed its trading pool by the void date); a split market is not a void. */
export const RACE_PAIR_VOID_SENTENCE = "If the pair is voided, because a coin did not reach its trading pool in time, whatever is left burns down on this coin over four weeks instead.";

export const isSportsRule = (r: Pick<BurnRule, "oracle" | "series">): boolean => r.oracle === "catalogue" && !!r.series && parseEspnSeries(r.series) !== null;
export const voidSentenceFor = (r: Pick<BurnRule, "oracle" | "series">): string => (isSportsRule(r) ? END_SINK_VOID_SENTENCE : END_SINK_VOID_SENTENCE_PLAIN);
const voidSentence = (r: BurnRule): string => (describeEndSink(r) && windowKindOf(r) !== "perpetual" && !isMeetingsSeries(r) ? ` ${voidSentenceFor(r)}` : "");
/**
 * THE CHAMPION PATH (website-18, the owner on 2026-10-12: "say I want to pick the Dodgers to win the World Series: it should burn every
 * game they win until the last game of the World Series, then burn the remaining balance after they win. If they lose, it should ... burn
 * $DEFICIT"). A team coin on a team's wins for the whole season, in a league whose schedule can tell a champion (espn.ts CHAMPION_KNOWN),
 * whose end sink is $DEFICIT and that is not the fade side. The keeper (multiKeeper.recordWindowEnd, endSinkKeeper) reads this same test:
 * a champion's coin ends on the ordinary wind-down on itself, any other end forwards the rest to $DEFICIT. The program can pin only
 * $DEFICIT, a named existing coin or a pair partner when a coin is created, so "the champion's coin" is not offered.
 */
// end-sink picker (2026-10-13): the champion path keeps the self-burn on the winning path whichever sink takes the losing path ($DEFICIT or a named coin)
export const championPathRule = (r: BurnRule): boolean => r.oracle === "catalogue" && !r.inverse && !r.set && (describeEndSink(r) === "flagship" || describeEndSink(r) === "mint") && championSeries(r.series) !== null;
/** The champion path's two end sentences, one per outcome (the review card and the locked description say both). */
export const championEndSentences = (ref: string, sink: string = "$DEFICIT"): [string, string] => [`If ${ref} win the championship, the rest of the pool burns here.`, sink === "$DEFICIT" ? "If they do not, the rest goes to $DEFICIT's burn." : `If they do not, the rest goes to ${sink}'s burn; ${namedSinkFallback(sink)}.`];
/** Walkthrough 13: the champion path in the general end explainer (/about, /templates) and the launch page's "before you start" list. */
export const CHAMPION_EXPLAINER_LINE = "A team's season coin in MLB, the NBA, the NHL or the NFL is the exception: if the team wins the championship, the rest burns down on that coin instead.";
export const PERPETUAL_SENTENCE = "This coin has no end date and does not retire.";
/** Private review 10: the end explainer's general line (never "has no end date and never retires"). */
export const PERPETUAL_RULE_LINE = "A rule without an end date keeps running.";

/**
 * THE ONE END-OF-RULE TEXT (ChatGPT audit 6 item 3, 2026-10-12: in 280 of 725 accepted setups the review's end line said "burns $DEFICIT"
 * and "burns down on this coin over 28 days … sends nothing to another coin" in one paragraph). Two ends, stated apart, from the rule's
 * own onEnd clause, with the same test the keeper uses (describeEndSink = rules.ts endSinkOf; championPathRule = endSinkKeeper):
 *
 *   result   the rule ended on a result: the rest goes to the sink pinned at creation ($DEFICIT, or the rival for a winner-takes-the-burn
 *            pair, or for a champion-path coin it burns here when the team wins the title); a rule with no sink winds down on itself
 *   void     the rule was voided or the season cancelled: the rest burns down on THIS coin over the onEnd wind-down (null when the void
 *            end is the same as the result end, i.e. no sink)
 *
 * The review API's endsLine, the coin description's window sentence, step 4 on the launch page (guidedLaunch.ts endSentences), the
 * templates page and /about all read this, so no surface can say both.
 */
/**
 * The end of a rule in general, for /about and the templates page: endText's own sentences for a one-shot with the $DEFICIT sink, a
 * winner-takes-the-burn pair and a rule with no end date (the same function the review and the coin text call).
 */
export function endExplainer(): string[] {
  const base = { schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: "0x" + "0".repeat(64), filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 1 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, pair: null, onEnd: { windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true } } as unknown as BurnRule;
  const one = endText(base), pair = endText({ ...base, pair: { pairId: "x", side: "A", counterpartMint: null, winnerTakesBurn: true } } as unknown as BurnRule);
  // walkthrough 13: the general line also says the champion path (a team's season coin keeps the rest if the team wins the title)
  return [`${one.result} ${CHAMPION_EXPLAINER_LINE}`, `In a winner-takes-the-burn pair: ${pair.result.replace(/^When/, "when")}`, one.void!, PERPETUAL_RULE_LINE];
}
/** The end sentences of the settled-event pairs (endText's result lines). */
export const CANDIDATES_END_RESULT = "When both markets are final and one candidate won, the other candidate's coin sends the rest of its pool, and any fees that arrive later, to the winning coin's burn, and the winning coin burns down what is left on itself. If neither candidate won, or a market settled 50-50, the rest goes to $DEFICIT's burn. Then the coin retires.";
/** Walkthrough 13 (2026-10-14): the same end for a race between two PARTIES (pairFundsFlow.ts isPartySubject), said with "party". */
export const PARTIES_END_RESULT = "When both markets are final and one party won, the other party's coin sends the rest of its pool, and any fees that arrive later, to the winning coin's burn, and the winning coin burns down what is left on itself. If neither party won, or a market settled 50-50, the rest goes to $DEFICIT's burn. Then the coin retires.";
export const GAME_END_RESULT = "When the game is final, the losing team's coin sends the rest of its pool, and any fees that arrive later, to the winning team's coin's burn, and the winning coin burns down what is left on itself. After a draw, the rest goes to $DEFICIT's burn. Then the coin retires.";
export const GAME_CANCELLED_SENTENCE = "If the game is cancelled, nothing moves between the two coins.";
/** HS-42 (hourly run 8): the same end and pair sentence for a league whose games cannot end tied (espn.ts leagueCannotTie): no draw clause. */
export const GAME_END_RESULT_NO_TIE = GAME_END_RESULT.replace(" After a draw, the rest goes to $DEFICIT's burn.", "");
export const GAME_PAIR_SENTENCE_NO_TIE = GAME_PAIR_SENTENCE.replace(" After a draw, both pools go to $DEFICIT's burn.", "");
/** A one-game pair rule whose league cannot tie (its own game series). */
export const gamePairCannotTie = (r: Pick<BurnRule, "pair">): boolean => seriesCannotTie(r.pair?.game?.series?.[0] ?? null);
/**
 * THE END OF A TWO-COIN DAILY RACE (qa-12 L2, what the keeper does): one more reading once every day of the run is recorded, the season
 * tally (derby/adapter.ts recordTally). The coin with more winning days wins it and burns its share for it once more; the other coin's
 * rest moves to the winner's burn while the two are linked, else to $DEFICIT's burn; the winner burns down what is left on itself
 * (endSinkKeeper PAIR WINNER). Level on winning days is a void reading: nothing moves and each coin burns down what is left on itself.
 */
// continuous audit HB-2: the sentences are derby/spec.ts raceEnd's, the one end every surface says for a race
export const raceEndResult = (unit: "days" | "weeks" = "days"): string => raceEnd(0, unit).result;
export const RACE_END_RESULT = raceEndResult("days");
export const raceLevelSentence = (over = "over four weeks", unit: "days" | "weeks" = "days"): string => raceEnd(0, unit).tie.replace("over four weeks", over);
const isDailyRace = (r: BurnRule): boolean => r.oracle === "derby" && r.derby?.selector === "coinvs" && !r.derby.flip;
/** The season-end sentence of a rivalry series coin (endText's result line). */
export const MEETINGS_END_RESULT = "When both teams' seasons are over, the coin of the team that won fewer of the games between them sends the rest of its pool, and any fees that arrive later, to the other coin's burn pool, or to $DEFICIT's burn if that coin is not live. The coin of the team that won more burns down what is left on itself. Then the coin retires.";
/**
 * HS-10 (continuous audit 2026-10-19): a rivalry series follows the two teams' games in ONE league season, so its end names that season
 * ("When the 2026–27 season is over, playoffs included, ..."), the label from the league table (espn.ts seasonLabel); a rule whose
 * series cannot be read keeps MEETINGS_END_RESULT's two-seasons wording.
 */
export function meetingsEndResult(r: BurnRule): string {
  const e = r.oracle === "catalogue" && r.series ? parseEspnSeries(r.series) : null;
  if (e?.kind !== "team" || e.window.kind !== "meetings") return MEETINGS_END_RESULT;
  return MEETINGS_END_RESULT.replace("When both teams' seasons are over,", `When the ${seasonLabel(e.league, e.window.year)} season is over${noPlayoffs(e.league) ? "" : ", playoffs included"},`);
}
const isMeetingsSeries = (r: BurnRule): boolean => { const e = r.oracle === "catalogue" && r.series ? parseEspnSeries(r.series) : null; return e?.kind === "team" && e.window.kind === "meetings"; };
export interface EndText { kind: "perpetual" | "self" | "flagship" | "pair-winner" | "champion" | "mint" | "incinerator"; result: string; void: string | null; line: string }
export function endText(r: BurnRule, o: { team?: string | null; party?: boolean } = {}): EndText {
  const days = r.onEnd?.windDownDays ?? 28;
  const over = days === 28 ? "over four weeks" : `over ${days} days`;
  const mk = (kind: EndText["kind"], result: string, voidEnd: string | null): EndText => ({ kind, result, void: voidEnd, line: [result, voidEnd].filter(Boolean).join(" ") });
  if (windowKindOf(r) === "perpetual" && !r.market && r.oracle !== "derby") return mk("perpetual", PERPETUAL_SENTENCE, null);
  const sink = describeEndSink(r);
  // the coin description says the same void sentence (END_SINK_VOID_SENTENCE is this text at the default 28 days)
  const VOID = days === 28 ? voidSentenceFor(r) : voidSentenceFor(r).replace("over four weeks", over);
  if (!sink) return mk("self", `When the rule ends, the coin's own burn pool burns down what is left ${over}, then the coin retires. A retired coin's pool keeps burning any fees it still receives. This end only burns this coin and sends nothing to another coin.`, null);
  // owner decision 2026-10-19: one burn of the whole pool ends on what reaches the pool later (never the losing-path words)
  const full = oneShotFull(r) && !r.pair && !championPathRule(r);
  const noBurn = full && hasNoBurnOutcome(r) ? ` ${ONE_SHOT_NO_BURN_LINE}` : "";
  if (sink === "incinerator") return mk("incinerator", full ? `${ONE_SHOT_REST_INCINERATOR}${noBurn} No coin is swapped for it. Then the coin retires.` : INCINERATOR_END_RESULT, VOID);
  if (sink === "pair-winner" && isMeetingsSeries(r)) return mk("pair-winner", meetingsEndResult(r), `${MEETINGS_LEVEL_SENTENCE} ${VOID}`);
  // HB-103 (hourly run 8): a 50-50 market or a voided market is "no single winner" here ($DEFICIT's burn, the sentence above); only a
  // voided pair burns down on the coin
  if (sink === "pair-winner" && settledPairShapeOf(r) === "candidates") return mk("pair-winner", o.party ? PARTIES_END_RESULT : CANDIDATES_END_RESULT, days === 28 ? RACE_PAIR_VOID_SENTENCE : RACE_PAIR_VOID_SENTENCE.replace("over four weeks", over));
  if (sink === "pair-winner" && settledPairShapeOf(r) === "game") return mk("pair-winner", gamePairCannotTie(r) ? GAME_END_RESULT_NO_TIE : GAME_END_RESULT, `${GAME_CANCELLED_SENTENCE} ${VOID}`);

  // qa-12 L2: a two-coin daily race ends on its season tally (derby/adapter.ts recordTally; endSinkKeeper's pair winner burns itself down)
  if (sink === "pair-winner" && isDailyRace(r) && r.derby?.selector === "coinvs") { const e = raceEndOf(r.derby, days); return mk("pair-winner", e.result, e.tie); }
  if (sink === "pair-winner" && r.oracle === "derby" && r.derby?.selector === "coinvs" && r.derby.flip) return mk("pair-winner", FLIP_REST_LINE, VOID);
  if (sink === "pair-winner") return mk("pair-winner", "When the rule ends on a result, the rest of the pool, and any fees that arrive later, goes to the rival coin's burn if the rival won the last result, or to $DEFICIT's burn if it did not. Then the coin retires.", VOID);
  if (championPathRule(r)) { const [won, lost] = championEndSentences(o.team ?? "the team", sinkTickerOf(r)); return mk("champion", `${won} ${lost}`, VOID); }
  // end-sink picker: the coin the creator named, and end.rs's fall-through when that coin is not live at the end
  if (sink === "mint" && full) { const x = sinkTickerOf(r); return mk("mint", `${oneShotRestCoin(x)}${noBurn} Then the coin retires.`, VOID); }
  if (sink === "flagship" && full) return mk("flagship", `${ONE_SHOT_REST_DEFICIT}${noBurn} Then the coin retires.`, VOID);
  if (sink === "mint") { const x = sinkTickerOf(r); return mk("mint", `When the rule ends on a result, the rest of the pool, and any fees that arrive later, goes to ${x}'s burn; ${namedSinkFallback(x)}. Then the coin retires.`, VOID); }
  return mk("flagship", "When the rule ends on a result, the rest of the pool, and any fees that arrive later, goes to $DEFICIT's burn. Then the coin retires.", VOID);
}
/**
 * The first-snow season in the coin's own text (intent audit item 11; weatherIntent.ts FIRST_SNOW_SEASON has the long form): the report's
 * season-to-date total starts each July 1, and only readings after the launch are planned (multiKeeper.ts planToken).
 */
export const SNOW_SEASON_SENTENCE = "The season runs July 1 to June 30, and only a first snow after launch day counts. With no snow by June 30, the coin ends without a burn.";

/**
 * THE LEAD SENTENCE (intent audit item 7: the fade side of "U.S. unemployment rate" showed only "For every reading of U.S."). The first
 * sentence of a text, where a period ends a sentence only when it is followed by a space and a capital letter, a "$" or a digit, and it
 * does not close an abbreviation: a run of single letters with periods ("U.S.", "D.C.", "e.g."), or a short title or place word ("St.",
 * "Mt.", "No.", "vs.", "Inc."). A decimal ("0.1") never has a space after its period. CoinText.lead carries it, so no page splits text.
 */
/**
 * A generated coin name, at most `max` characters, cut at a word boundary and never mid-word (intent audit 4 item 19: "Wikipedia daily
 * views of an arti"). A trailing small word ("of", "the", "a", "an", "and") is dropped with the cut.
 */
// QA pass 9 #15: measured in bytes, as the program measures a name (launchFields.ts fitName), and never cut inside a word
export function capName(name: string, max = 32): string { return fitName(name, max); }

/**
 * The selected subject of a parameterized series, its short name and what each reading measures, read from the series id itself (the same
 * on the page and on the server). The window words follow each adapter (config/burnticker/sources.json): a per-day total, or a once-a-day
 * snapshot measured against the previous reading.
 */
export function paramSubject(series: string): { name: string; ticker: string; what: string; window: string; noun: string } | null {
  const i = series.indexOf(":");
  if (i < 0) return null;
  const fam = series.slice(0, i), p = series.slice(i + 1), named = paramName(series);
  // audit 204/209: a snapshot is the figure at the moment it is read, never a daily peak, measured against the previous reading
  const snap = "a snapshot of the figure at the moment the keeper reads it, measured against the previous reading";
  if (fam === "wiki.views") { const a = decodeURIComponent(p).replace(/_/g, " "); return { name: `${a} Wiki Views`, ticker: a, what: `on the English Wikipedia article “${a}”`, noun: `daily views of the English Wikipedia article “${a}”`, window: "the total views of one UTC day, read once the day is over, counting every platform and every kind of visitor, automated ones included, as Wikimedia's all-access, all-agents figure does" }; }
  // audit 206: a name only when it was read from the publisher (paramNames.ts), never guessed
  if (fam === "steam.players") { const app = named ? `${named} (Steam app ${p})` : `Steam app ${p}`; return { name: named ? `${named} Players` : `Steam App ${p} Players`, ticker: named ?? `STEAM${p}`, what: `in the concurrent player count of ${app}`, noun: `the concurrent player count of ${app}`, window: "a snapshot of the concurrent player count at the moment the keeper reads it, not the day's peak, measured against the previous reading" }; }
  if (fam === "github.stars") { const repo = p.split("/")[1] ?? p; return { name: `${repo} Stars`, ticker: `${repo}STAR`, what: `on the ${p} GitHub repository`, noun: `the star count of the ${p} GitHub repository`, window: snap }; }
  if (fam === "defillama.tvl") return { name: `${p} TVL`, ticker: `${p}TVL`, what: `of total value locked in ${p}, as DefiLlama reports it`, noun: `the total value locked in ${p} as DefiLlama reports it`, window: `${snap}. DefiLlama states it as a dollar value of the deposits, so it also moves when the deposits' value moves, not only when deposits come in or go out` };
  if (fam === "edgar.8k") { const who = named ? `${named} (SEC filer CIK ${p})` : `SEC filer CIK ${p}`; return { name: named ? `${named} 8-K Filings` : `CIK ${p} 8-K Filings`, ticker: `EDGAR${p.replace(/^0+/, "")}`, what: `on Form 8-K by ${who}`, noun: `Form 8-K filings by ${who}`, window: "the number of filings on one UTC day" }; }
  return null;
}

/**
 * A RISE OVER THE PREVIOUS READING, NEVER A TOTAL (audit item 201, 2026-10-12: "burns for every 100k players" read as if the coin burned
 * for every 100,000 players there are). A rule measured against the previous reading names its unit as a change: "each full increase of
 * 100k players in <subject> over the previous snapshot", "each full change of $0.01 in <subject>, up or down, since the previous
 * reading". Null for a rule with a fixed baseline (a per-period count or total), whose old wording is right.
 */
export function changePhrase(r: Pick<BurnRule, "scalar">, unitLabel: string, subject: string, snapshot: boolean): string | null {
  const s = r.scalar;
  if (!s || s.baseline !== "previousSettlement") return null;
  const unit = unitLabel.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+(added|moved|move)$/, "").replace(/-point\b/, " point");
  if (!/^(the|daily|form)\s/i.test(subject) && !/^[a-z]/.test(subject)) subject = `the ${subject}`;
  const prev = `the previous ${snapshot ? "snapshot" : "reading"}`;
  if (s.direction === "abs") return `each full change of ${unit} in ${subject}, up or down, since ${prev}`;
  return `each full ${s.direction === "down" ? "decrease" : "increase"} of ${unit} in ${subject} over ${prev}`;
}

/** Facts a counted source needs beside its unit (audit items 210, 211, 217): what a block count is and how final it is when read. */
export const SERIES_NOTES: Readonly<Record<string, string>> = {
  "bitcoin.blockHeight": "The block count is exact; 144 blocks take about a day, not exactly a day. The count is the chain's tip when it is read, so a block replaced in a reorganisation can move one reading by a block, and the next reading is measured from the recorded one.",
  "solana.blockHeight.rpc": "Solana's block height counts blocks, not slots: a slot in which no block was produced adds nothing. It is read at the finalized level, so a block that could still be rolled back is never counted. This is the same figure as the on-chain Solana block height source, read over the public HTTP endpoint.",
};

/** "the Lakers win the 2027 NBA championship" → "the Lakers did NOT win the 2027 NBA championship"; anything else → "NO on “…”". */
export function negatePhrase(phrase: string): string {
  const m = /^(.+?) (?:win|wins|will win) (.+)$/.exec(phrase.trim());
  return m ? `${m[1]} did NOT win ${m[2]}` : `NO on “${phrase.trim()}”`;
}

const ABBREV =/(?:\b(?:[A-Za-z]\.){2,}|\b(?:St|Mt|Ft|Dr|Mr|Mrs|Ms|Jr|Sr|No|vs|Inc|Co|Corp|Ltd|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|approx|est)\.)$/;
export function leadSentence(text: string): string {
  const t = text.trim();
  for (const m of t.matchAll(/[.!?](?=\s+[A-Z$0-9“"(])/g)) {
    const head = t.slice(0, m.index + 1);
    if (m[0] === "." && ABBREV.test(head)) continue;
    // audit 6 (test A): a German club number ("1. FC Union Berlin", "1. FSV Mainz 05") is an ordinal, not a sentence end
    if (m[0] === "." && /(?:^|\s)\d{1,2}\.$/.test(head)) continue;
    return head;
  }
  return t;
}
/** One pattern per window kind; a description matches exactly one of them, exactly once (test/burntickerDescribe.test.ts). */
export const WINDOW_SENTENCE: Record<WindowKind, RegExp> = {
  season: /This coin covers the [^.]*? season only(?:, including (?:the playoffs|every match of the competition)\. After [^.]*? last game, (?:it burns down whatever is left over four weeks and then retires|whatever is left burns [^.]*?, and the coin retires)\.(?: It does not continue into [^.]+\.)?|\. If [^.]*? win the championship, the rest of the pool burns here\. If they do not, the rest goes to \$[A-Z0-9]+'s burn(?:; if \$[A-Z0-9]+ is not live then, to \$DEFICIT's burn)?\.)/g,
  post: /This coin covers [^.]*? postseason only\. After [^.]*? last playoff game, (?:it burns down whatever is left over four weeks and then retires|whatever is left burns [^.]*?, and the coin retires)\.(?: It does not continue into [^.]+\.)?/g,
  next: /This coin covers [^.]*? next \d+ games? only, from [^.]*?\d{4}\. After game \d+, (?:it burns down whatever is left over four weeks and then retires|whatever is left burns [^.]*?, and the coin retires)\./g,
  perpetual: /This coin has no end date and does not retire\./g,
  "one-shot": /This coin resolves once(?:, on [A-Z][a-z]{2} \d{1,2}, \d{4}|, when the market settles(?: \(it closes by [A-Z][a-z]{2} \d{1,2}, \d{4}\))?|, on [^.]+?)?\. Then (?:it burns down over four weeks and retires|whatever is left burns [^.]*?, and the coin retires)\./g,
};
const fractionText = (r: BurnRule): string => {
  const m = (r.kind === "binary" ? (r.binary?.onYes ?? r.binary?.onNo) : r.scalar?.perUnit) as { fractionOfPool?: number; tokens?: number } | null | undefined;
  return m?.tokens !== undefined ? `${m.tokens.toLocaleString("en-US")} tokens from its vault` : `${Math.round((m?.fractionOfPool ?? 0) * 1000) / 10}%`;
};
// owner, 2026-10-12: above 5 % a burn is said to land in slices (one burn run buys with at most 2 % of the pool's SOL)
const sliced = (r: BurnRule): boolean => { const m = (r.kind === "binary" ? (r.binary?.onYes ?? r.binary?.onNo) : r.scalar?.perUnit) as { fractionOfPool?: number } | null | undefined; return (m?.fractionOfPool ?? 0) > 0.05; };
const spends = (r: BurnRule, t: string) => { const p = fractionText(r); return p.endsWith("vault") ? `the coin burns ${p}` : `the burn pool spends ${p} buying $${t} on Raydium${sliced(r) ? " in slices sized to the pool's liquidity" : ""} and burns it`; };
/** "The result comes from X, cross-checked against Y." / "MLB's official feed confirms it." — the settlement sentences. */
const cap = (x: string) => x[0].toUpperCase() + x.slice(1);
/**
 * HB-113 (hourly run 9): a published-data coin's settlement sentence. The cross-check is named only when the source has one; a
 * single-source series (search.ts isSingleSourceSeries, crossRead null) never claims a second publisher in its pinned description.
 */
export const feedResultSentence = (f: { sourceName: string; crossRead?: string | null }): string => `The result comes from ${f.sourceName}${f.crossRead ? `, cross-checked against ${f.crossRead}` : ""}.`;
/**
 * HB-113: the paragraph says the trigger once. When the rule block opens with the one-liner's own clause ("$DEBTUP burns for each full
 * increase of $1B …. For each full increase of $1B …, the burn pool spends 2% …"), the block's opening clause becomes "Each time, …".
 * The rule block itself (the lead, the token page) is unchanged.
 */
export function triggerOnce(oneLiner: string, ruleBlock: string): string {
  const m = /^burns (for|on) (.+)$/.exec(oneLiner);
  if (!m) return ruleBlock;
  const head = `${cap(m[1])} ${m[2]}, `;
  return ruleBlock.startsWith(head) ? `Each time, ${ruleBlock.slice(head.length)}` : ruleBlock;
}
const SPORTS_RESULT = "its market's on-chain payout if it has one, or else from a licensed final score";
/** A single game's result (owner 2026-10-16: the first score read, the on-chain settlement last; one source is enough). */
const GAME_RESULT = "a licensed final score, the league's own feed, or the game's on-chain settlement, whichever reads it";
const possessive = (n: string) => (n.endsWith("s") ? `${n}'` : `${n}'s`);
/** "Oct 31, 2026" (America/Denver). */
export const shortDate = (iso: string | null | undefined): string | null => (iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" }) : null);
const day = shortDate;
export const tickerFrom = (s: string, suffix = ""): string => { const base = s.toUpperCase().replace(/[^A-Z0-9]/g, ""); return (base.slice(0, Math.max(2, 10 - suffix.length)) + suffix).slice(0, 10); };
/** HS-35 (hourly run 6): the catalogue's short names for published-data series whose code is not a readable ticker. WZ7-6 (seventh pass): the
 * debt feed is $DEBTUP here too, the ticker the launch page gives it, so the server's free-ticker row offers $DEBTUP variants. */
export const FEED_SHORT_TICKERS: Readonly<Record<string, string>> = {
  "fred.UNRATE": "UNRATE", "bls.LNS14000000": "UNRATE", "fred.CPIAUCSL": "CPI", "bls.CUSR0000SA0": "CPI", "fred.GFDEBTN": "USDEBT", "treasury.debt": "DEBTUP",
  "us.debt.total-public-outstanding": "USDEBT", "bls.eggs": "EGGS", "usda.eggs": "EGGS", "bls.APU0000708111": "EGGS", "fred.APU0000708111": "EGGS", "eia.gasoline": "GAS", "bea.gdp": "GDP",
};
/**
 * HS-35: a published-data coin's ticker base, never a word cut in half ($UNEMPLOYME): the catalogue short name, else the series code when
 * it is a short upper-case code (fred.UNRATE → UNRATE), else whole words of the title that fit in `room`, else the title's initials.
 */
export function feedTickerBase(series: string, title: string, room = 10): string {
  const short = FEED_SHORT_TICKERS[series] ?? FEED_SHORT_TICKERS[series.split(":")[0]];
  if (short && short.length <= room) return short;
  const code = series.split(":")[0].split(".").slice(1).join("");
  if (/^[A-Z][A-Z0-9]{1,9}$/.test(code) && code.length <= room) return code;
  const words = title.replace(/^U\.?S\.?\s+/i, "").split(/[(—,]/)[0].split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toUpperCase());
  let out = "";
  for (const w of words) { if ((out + w).length > room) break; out += w; }
  if (out.length >= 2) return out;
  const initials = words.map((w) => w[0]).join("");
  return initials.length >= 2 ? initials.slice(0, room) : tickerFrom(title).slice(0, room);
}
// the NBA's feed is named only while it answers (espn.ts NBA_OFFICIAL_ANSWERS; gameSettle.ts countedOfficialOf)
const CROSS: Record<string, string> = { nhl: "NHL's official scores", mlb: "MLB's official feed", ...(NBA_OFFICIAL_ANSWERS ? { nba: "NBA's official feed" } : {}) };
const CHAMP_CODE: Record<string, string> = { mlb: "WS", nfl: "SB", nba: "TITLE", nhl: "CUP" };
const yy = (league: LeagueId, year: number) => String(seasonStartYear(league, year) % 100).padStart(2, "0");
const nextSeason = (league: LeagueId, year: number) => seasonLabel(league, year + 1);
/** League mode (rules.ts `set`): the conditional forward, in the description whenever the rule carries it. */
export const leagueSentence = (r: BurnRule): string => (r.set && r.set.forwardBps > 0 ? ` In league mode, ${Math.round(r.set.forwardBps) / 100}% of the rest goes to the winning coin of set ${r.set.id} if the forwarding instruction is live by season end. Otherwise it burns down on this coin.` : "");
/** HB-142: a coin on one prediction-market market (Polymarket, or one Kalshi market): its end date is the market's close deadline. */
export const isMarketCoin = (r: Pick<BurnRule, "oracle" | "market">): boolean => r.oracle === "polymarket" || (r.oracle === "kalshi" && !!r.market);
const oneShotSentence = (r: BurnRule, iso: string | null | undefined, onWhat: string | null = null) => {
  const k = describeEndSink(r), then = k ? `${sinkPhrase(k, r)} and the coin retires` : "it burns down over four weeks and retires";
  if (onWhat) return `This coin resolves once, on ${onWhat}. Then ${then}.`;
  // HB-142 (hourly run 12): a market's end date is its close deadline, not the day it settles (a World Series market settles when the
  // series ends), so a market coin resolves "when the market settles", with the close date as the latest day; the description is pinned
  if (isMarketCoin(r)) return `This coin resolves once, when the market settles${iso ? ` (it closes by ${day(iso)})` : ""}. Then ${then}.`;
  return `This coin resolves once${iso ? `, on ${day(iso)}` : ""}. Then ${then}.`;
};

/** The coin's window kind from its rule alone. */
export function windowKindOf(r: BurnRule): WindowKind {
  const series = r.oracle === "catalogue" ? r.series ?? "" : "";
  const e = series ? parseEspnSeries(series) : null;
  if (e) return e.kind === "game" ? "one-shot" : e.window.kind === "legacy" ? (e.window.scope === "post" ? "post" : "season") : e.window.kind === "meetings" ? "season" : e.window.kind;
  if (isOneShotSeries(series)) return "one-shot";   // HB-147: the one list (inverse.ts)
  if (r.oracle === "derby" && r.derby?.selector === "high") return r.derby.once ? "one-shot" : "perpetual";
  if (r.oracle === "polymarket" || r.market) return "one-shot";
  return "perpetual";
}

/** The window badge: "2026 SEASON", "POSTSEASON 2026", "NEXT 5 GAMES", "PERPETUAL", "ONE-SHOT · Oct 31, 2026" (+ the end once known). */
export function windowBadge(r: BurnRule, ctx: Pick<DescribeCtx, "endsAt" | "ended"> = {}): string {
  const series = r.oracle === "catalogue" ? r.series ?? "" : "";
  const e = series ? parseEspnSeries(series) : null;
  const end = ctx.endsAt ? day(ctx.endsAt) : null;
  const ended = ctx.ended && end ? ` · ENDED ${end}` : "";
  if (e?.kind === "team") {
    const w = e.window;
    if (w.kind === "season") return `${seasonLabel(e.league, w.year)} SEASON${ended}`;
    if (w.kind === "post") return `POSTSEASON ${seasonLabel(e.league, w.year)}${ended}`;
    if (w.kind === "next") return `NEXT ${w.n} GAME${w.n === 1 ? "" : "S"}${end ? ` · ENDS ${end}` : ""}`;
    if (w.kind === "perpetual") return "PERPETUAL";
    if (w.kind === "meetings") return `${seasonLabel(e.league, w.year)} SEASON SERIES${ended}`;
    return `${w.scope === "post" ? "POSTSEASON" : "THIS SEASON"}${ended}`;
  }
  // HB-142 widened (hourly run 14): a market coin's date is the market's close deadline, not the day it settles (an F1 title market
  // settles on the season's last race), so its badge says "by" that day, as its pinned sentence does ("when the market settles")
  if (windowKindOf(r) === "one-shot") return `ONE-SHOT${end ? ` · ${isMarketCoin(r) && !ctx.ended ? "BY " : ""}${end}` : ""}`;
  return "PERPETUAL";
}

function espnText(r: BurnRule, s: EspnSeries, c: DescribeCtx): CoinText {
  const team = teamByAbbr(s.league, s.abbr)!, nick = team.nickname, t = c.ticker, o = s.outcome, L0 = LEAGUES[s.league];
  // "the Rays", "the Lakers" — but "Arsenal", "Inter Miami", "Georgia": clubs and colleges go without the article
  const ref = L0.sport === "soccer" || s.league === "cfb" || s.league === "mcbb" || s.league === "wcbb" ? nick : `the ${nick}`;
  const Ref = ref[0].toUpperCase() + ref.slice(1), poss = possessive(ref);
  const tie = L0.draws ? "draw" : "tie";
  // two of a soccer game's three results (espn.ts PairOutcome, owner 2026-10-13): "win or draw", and the one result that burns nothing
  const two = isPairOutcome(o) ? outcomeWords(o) : null;
  const verb = two ? two.verb : o === "win" ? "win" : o === "draw" ? "draw" : "lose", noun = two ? two.noun : o === "win" ? "win" : o === "draw" ? "draw" : "loss";
  const other = o === "windraw" ? "a loss" : o === "drawloss" ? "a win" : o === "winloss" ? "a draw" : o === "win" ? `a loss or a ${tie}` : o === "draw" ? "a win or a loss" : `a win or a ${tie}`;
  const plainly = !two ? "" : ` In other words, it burns on every match ${two.notVerb ? `${ref} ${two.notVerb}` : "that does not end in a draw"}.`;
  // THE FADE SIDE (rules.ts inverse): a team coin that burns on every game day WITHOUT its outcome
  const inv = !!r.inverse && s.kind === "team";
  const sfx = (inv ? "N" : "") + (o === "win" ? (inv ? "W" : "") : o === "draw" ? "D" : "L"), Noun = two ? two.name : (inv ? "No " : "") + (o === "win" ? "Wins" : o === "draw" ? "Draws" : "Losses");
  // owner 2026-10-14: a game no second source can read settles on TheSportsDB alone after a 12-hour hold, so a second source is named
  // only where the league's own counted feed reads every game; otherwise the description promises none
  const cross = CROSS[s.league] ?? null;
  // HB-107b (hourly run 8): "NHL's official scores confirm it" (a plural source takes "confirm")
  const confirms = cross ? ` ${cap(cross)} ${/s$/.test(cross) ? "confirm" : "confirms"} it.` : "";
  const badge = windowBadge(r, c);
  const mk = (name: string, ticker: string, oneLiner: string, rules: string, windowSentence: string, windowKind: WindowKind, shape: CoinText["shape"]): CoinText => {
    const ruleBlock = `${rules} ${windowSentence}${voidSentence(r)}${leagueSentence(r)}${pairSentence(r)} ${CLOSER}`;
    return { name: capName(name), ticker, oneLiner, flavour: `$${t} ${oneLiner}.`, ruleBlock, lead: leadSentence(ruleBlock), windowSentence, windowKind, badge, paragraph: `$${t} ${oneLiner}. ${ruleBlock}`, shape };
  };
  // ChatGPT audit 6 item 6: the one team ticker (tickers.ts), the same the wizard and the teams API give
  const tk = (window: TeamWindow, games: number | null = null): string => teamTicker(s.abbr, { league: s.league, window, games, outcome: o, inverse: inv });
  // owner decision 2026-10-12 (website-20 item 78): a level cup tie decided on penalties follows the declared winner (gameSettle.ts settleGame)
  const pens = L0.draws ? ` ${PENALTIES_SENTENCE}` : "";
  if (s.kind === "team" && s.window.kind === "meetings") return meetingsText(r, s.league, s.abbr, s.window, c, mk, { ref, nick, pens, cross });
  if (s.kind === "team") {
    const w = s.window as Exclude<Window, { kind: "meetings" }>;
    const settle = inv ? `Each game's result comes from ${SPORTS_RESULT}.${confirms}${pens} A day with two games counts once, and a game day with a ${noun} burns nothing.` : `Each game's result comes from ${SPORTS_RESULT}.${confirms}${pens} Nothing happens on ${other}.`;
    const oneLiner = inv ? `burns on every game day ${ref} do not ${verb}` : `burns when ${ref} ${verb}`;
    const every = (scope: string) => inv ? `For every ${nick} game day without a ${noun} ${scope}, ${spends(r, t)}, with a receipt on chain. ${settle}` : `For every ${nick} ${noun} ${scope}, ${spends(r, t)}, with a receipt on chain.${plainly} ${settle}`;
    if (w.kind === "season" && championPathRule(r)) {
      // the champion path: every win through the postseason, then the rest burns here (champion) or goes to $DEFICIT's burn
      const L = seasonLabel(s.league, w.year);
      return mk(`${nick} ${L} ${Noun}`, tk("season"), oneLiner,
        `This coin burns ${fractionText(r)} of its pool every game ${ref} win, through the last game of the ${L} postseason. ${sliced(r) ? `Each burn buys $${t} on Raydium in slices sized to the pool's liquidity.` : `Each burn buys $${t} on Raydium, with a receipt on chain.`} ${settle}`,
        `This coin covers the ${L} season only. ${championEndSentences(ref, sinkTickerOf(r)).join(" ")}`, "season", "recurring");
    }
    if (w.kind === "season") {
      const L = seasonLabel(s.league, w.year);
      return mk(`${nick} ${L} ${Noun}`, tk("season"), oneLiner, every(`in the ${L} season`),
        `This coin covers the ${L} ${nick} season only, including ${noPlayoffs(s.league) ? "every match of the competition" : "the playoffs"}. After ${poss} last game, ${burnDown(r)}. It does not continue into ${nextSeason(s.league, w.year)}.`, "season", "recurring");
    }
    if (w.kind === "post") {
      const L = seasonLabel(s.league, w.year);
      return mk(`${nick} ${L} Playoffs`, tk("post"), `${oneLiner} in the postseason`, every(`in the ${L} postseason`),
        `This coin covers ${poss} ${L} postseason only. After ${poss} last playoff game, ${burnDown(r)}. It does not continue into ${nextSeason(s.league, w.year)}.`, "post", "recurring");
    }
    if (w.kind === "next") {
      const from = `${w.from.slice(0, 4)}-${w.from.slice(4, 6)}-${w.from.slice(6)}`;
      return mk(`${nick} Next ${w.n}`, tk("next", w.n), `${oneLiner} in their next ${w.n === 1 ? "game" : `${w.n} games`}`, every(`in their next ${w.n === 1 ? "game" : `${w.n} games`}`),
        `This coin covers ${poss} next ${w.n} game${w.n === 1 ? "" : "s"} only, from ${day(from)}. After game ${w.n}, ${burnDown(r)}.`, "next", "recurring");
    }
    if (w.kind === "perpetual") {
      return mk(`${nick} ${Noun}`, tk("perpetual"), oneLiner, `${every("in any game, every season")} Nothing is read in the off-season. The pool keeps filling, and readings start again with the next season's first game.`,
        PERPETUAL_SENTENCE, "perpetual", "recurring");
    }
    const scope = w.scope === "post" ? "this postseason" : w.scope === "reg" ? "for the rest of the regular season" : "this season";
    return mk(`${nick} ${Noun}`, tk(w.scope === "post" ? "post" : "season"), oneLiner, every(scope),
      w.scope === "post" ? `This coin covers ${poss} current postseason only. After ${poss} last playoff game, ${burnDown(r)}.` : `This coin covers the current ${nick} season only, including the playoffs. After ${poss} last game, ${burnDown(r)}.`, w.scope === "post" ? "post" : "season", "recurring");
  }
  const opp = c.game ? (L0.sport === "soccer" || s.league === "cfb" || s.league === "mcbb" || s.league === "wcbb" ? c.game.opponent : `the ${c.game.opponent}`) : null;
  const vs = c.game ? ` ${c.game.home ? "against" : "away against"} ${opp}${c.game.startsAt ? ` on ${day(c.game.startsAt)}` : ""}` : " in the one game this coin follows";
  const oneLiner = `burns if ${ref} ${verb}${c.game ? ` ${c.game.home ? "against" : "away against"} ${opp}` : " the one game this coin follows"}`;
  return mk(`${nick} ${two ? (o === "windraw" ? "Win or Draw" : o === "drawloss" ? "Draw or Loss" : "Win or Loss") : o === "win" ? "Win" : o === "draw" ? "Draw" : "Lose"}`, tk("game"), oneLiner, `If ${ref} ${verb}${vs}, ${spends(r, t)} once, with a receipt on chain. The game's result comes from ${GAME_RESULT}.${pens} ${GAME_BURN_LINE} Any other result burns nothing on this coin${outcomeResults(o).includes("draw") ? "" : `, and a ${tie} burns nothing`}.`,
    oneShotSentence(r, c.game?.startsAt ?? c.endsAt), "one-shot", "one-shot");
}

/**
 * THE RIVALRY SERIES (sources/espn.ts window `meetings`; owner 2026-10-12): every game between two teams this season, one coin per team,
 * winner takes the burn. What moves is the program's (pair.rs forward_to_winner per meeting; end.rs forward_on_end to the pair winner of
 * the season-end result, else $DEFICIT): each meeting's loser sends its share for that game to the winner's burn pool; at the season's end
 * the coin of the team that won fewer of the games sends what is left to the other coin's burn pool; a level series moves nothing and each
 * coin burns down on its own pool.
 */
export const MEETINGS_LEVEL_SENTENCE = "If the two teams won the same number of games against each other, nothing moves at the end and whatever is left burns down on this coin over four weeks.";
/** The series description's one end-without-a-winner sentence: a level series, a voided result or a cancelled season (sources-7 H2). */
export const MEETINGS_LEVEL_VOID_SENTENCE = "If neither team won more of these games, or the result is voided or the season is cancelled, nothing moves at the end and whatever is left burns down on this coin over four weeks.";
/** PENALTIES_SENTENCE's short form in a series description (the same rule: a game settled on penalties follows the declared winner). */
export const MEETINGS_PENALTIES_SENTENCE = "A tie decided on penalties counts for the side that won the shoot-out, not as a draw.";
export const teamRef = (league: LeagueId, nickname: string): string => (LEAGUES[league].sport === "soccer" || league === "cfb" || league === "mcbb" || league === "wcbb" ? nickname : `the ${nickname}`);
/**
 * QA pass 9 #21 (2026-10-13: "the Leeds United lose"): a team named without its league takes the article its league uses, found by name in
 * the team tables ("the Celtics", "Leeds United", "Georgia"); a name already starting with "the" is kept; an unknown name takes none.
 */
export function teamRefByName(name: string): string {
  const n = name.trim();
  if (/^the\s/i.test(n)) return n;
  const t = findTeams(n).find((x) => [x.nickname, x.name].some((k) => k.toLowerCase() === n.toLowerCase()));
  return t ? teamRef(t.league, n) : n;
}
export const meetingsTicker = (abbr0: string, opp0: string, league: LeagueId | null = null): string => { const abbr = league ? displayAbbr(league, abbr0) : abbr0, opp = league ? displayAbbr(league, opp0) : opp0; return `${abbr.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4)}V${opp.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4)}`.slice(0, 10); };
function meetingsText(r: BurnRule, league: LeagueId, abbr: string, w: Extract<Window, { kind: "meetings" }>, c: DescribeCtx, mk: (name: string, ticker: string, oneLiner: string, rules: string, windowSentence: string, windowKind: WindowKind, shape: CoinText["shape"]) => CoinText, o: { ref: string; nick: string; pens: string; cross: string | null }): CoinText {
  const oppTeam = teamById(league, w.oppId) ?? teamByAbbr(league, w.opp);
  const oppNick = oppTeam?.nickname ?? w.opp, oref = teamRef(league, oppNick), L = seasonLabel(league, w.year), t = c.ticker;
  const scope = `in the ${L} season${noPlayoffs(league) ? "" : ", playoffs included"}`;
  // no "buy" in this copy (the brief's plain-English rule): the share is spent on the coin in its own pool and every token is burned
  const spend = `${fractionText(r)} of the burn pool is spent on this coin in its Raydium pool${sliced(r) ? ", in slices sized to the pool's liquidity," : ""} and every token it gets is burned`;
  const check = CROSS[league] ? " The league's own feed confirms it." : "";
  // sources-7 (QA walkthrough 11 H2: Arsenal vs Tottenham Hotspur came to 1,527 characters with no creator text): the series paragraph
  // says each fact once. The other coin is "the other coin" after its first naming, the level series and a void end share one sentence
  // (MEETINGS_LEVEL_VOID_SENTENCE), the penalties sentence is the short form, and the next season is not named (the window says "only").
  // The money path in full is on the review (pairFundsFlow.ts meetingsFundsFlow) and the pair page.
  const pens = o.pens ? ` ${MEETINGS_PENALTIES_SENTENCE}` : "";
  const rules = `For each of those wins ${scope}, ${spend}, with a receipt on chain. Each game's result comes from ${SPORTS_RESULT}.${check}${pens} When ${oref} win instead, this coin's share for that game goes to the other coin's burn pool. ${leagueCannotTie(league) ? "A postponed or cancelled game counts for neither side." : "A draw, or a postponed or cancelled game, counts for neither side."}`;
  const windowSentence = `This coin covers the ${L} season only, including ${noPlayoffs(league) ? "every match of the competition" : "the playoffs"}. After both teams' last game, whatever is left burns the coin of the team that won more of these games, or $DEFICIT if that coin is not live, and the coin retires. ${MEETINGS_LEVEL_VOID_SENTENCE}`;
  return mk(`${o.nick} vs ${oppNick} ${L}`, meetingsTicker(abbr, w.opp, league), `burns when ${o.ref} beat ${oref}`, rules, windowSentence, "season", "recurring");
}

/** A level cup tie decided on penalties (website-20 item 78, owner decision 2026-10-12). */
export const PENALTIES_SENTENCE = "A cup tie decided on penalties counts as a win for the winner and a loss for the other side, not as a draw.";

/**
 * THE FADE SIDE'S SUGGESTED NAME (website-20 item 104, 2026-10-12: "No Move Solar flares" for a coin that burns on the days with no
 * flare). A count read against zero (baseline 0) names the quiet day: "Quiet Sun" for solar flares, otherwise "Days Without <subject>";
 * a level read against its last value keeps "No Move <subject>". Only the suggestion: a name the creator typed is never replaced.
 */
const QUIET_NAMES: Record<string, string> = { "noaa.flares": "Quiet Sun" };
export function fadeName(series: string | null, subject: string, zeroCount: boolean): string {
  if (!zeroCount) return fitName(`No Move ${subject}`);
  const known = series ? QUIET_NAMES[series.split(":")[0]] : undefined;
  return fitName(known ?? `Days Without ${subject}`);
}

/** The coin's name, ticker, one-liner and paragraph from its rule. `ctx.ticker` is the ticker the text names (the suggestion when empty). */
export function describeRule(r: BurnRule, ctx: DescribeCtx): CoinText {
  const series = r.oracle === "catalogue" ? r.series ?? "" : "";
  const e = series ? parseEspnSeries(series) : null;
  if (e) { const t0 = espnText(r, e, { ...ctx, ticker: ctx.ticker || "TICKER" }); return ctx.ticker ? t0 : espnText(r, e, { ...ctx, ticker: t0.ticker }); }
  const n = series ? parseNwsSeries(series) : null;
  const badge = windowBadge(r, ctx);
  const build = (name0: string, tk0: string, oneLiner: string, block: (t: string) => string, windowSentence: string, shape: CoinText["shape"]): CoinText => {
    const name = ctx.suggest?.name ?? name0, tk = ctx.suggest?.ticker ?? tk0;
    const t = ctx.ticker || tk, ruleBlock = `${block(t)} ${windowSentence}${voidSentence(r)}${leagueSentence(r)}${pairSentence(r, ctx.eventPhrase ?? null)} ${CLOSER}`;
    return { name: capName(name), ticker: tk, oneLiner, flavour: `$${t} ${oneLiner}.`, ruleBlock, lead: leadSentence(ruleBlock), windowSentence, windowKind: windowKindOf(r), badge, paragraph: `$${t} ${oneLiner}. ${triggerOnce(oneLiner, ruleBlock)}`, shape };
  };
  if (n && r.inverse && n.metric !== "snow") {
    // THE FADE SIDE: the days the threshold is NOT reached
    // intent audit item 1: the report gives whole °F, so "below T" is said as the inclusive "T − 1 °F or colder" (the same form as the
    // plain side's "T °F or hotter"), and a day with no reading counts as nothing, never as a cold day
    const st = stationByCode(n.station)!, hot = n.metric === "high";
    const what = hot ? `every day ${possessive(st.city)} official high is ${n.threshold - 1} °F or colder` : `every day ${st.city} gets less than ${n.threshold.toFixed(2)} in of rain`;
    return build(`${st.city} ${hot ? "Cold" : "Dry"}`, tickerFrom(st.code, hot ? "COLD" : "DRY"), hot ? `burns on every ${st.city} day at ${n.threshold - 1} °F or colder` : `burns on every ${st.city} day with less than ${n.threshold.toFixed(2)} in of rain`,
      (t) => `For ${what}, ${spends(r, t)}, with a receipt on chain. The result comes from the National Weather Service's daily climate report, cross-checked against the Iowa Environmental Mesonet. Nothing happens on ${hot ? `a day at ${n.threshold} °F or hotter` : `a day with ${n.threshold.toFixed(2)} in of rain or more`}, or on a day with no reading.`,
      PERPETUAL_SENTENCE, "recurring");
  }
  if (n) {
    const st = stationByCode(n.station)!;
    const what = n.metric === "high" ? `every day ${possessive(st.city)} official high reaches ${n.threshold} °F` : n.metric === "rain" ? `every day ${st.city} gets ${n.threshold.toFixed(2)} in of rain or more` : `on ${possessive(st.city)} first measurable snow of the season`;
    const other = n.metric === "high" ? "a cooler day" : n.metric === "rain" ? "a drier day" : "a day without snow";
    const oneLiner = n.metric === "high" ? `burns on every ${st.city} day at ${n.threshold} °F or hotter` : n.metric === "rain" ? `burns on every ${st.city} day with ${n.threshold.toFixed(2)} in of rain` : `burns on ${possessive(st.city)} first snow`;
    return build(`${st.city} ${n.metric === "high" ? "Heat" : n.metric === "rain" ? "Rain" : "Snow"}`, tickerFrom(st.code, n.metric === "high" ? "HOT" : n.metric === "rain" ? "RAIN" : "SNOW"), oneLiner,
      (t) => `${what[0].toUpperCase()}${what.slice(1)}, ${spends(r, t)}${n.metric === "snow" ? " once" : ""}, with a receipt on chain. The result comes from the National Weather Service's daily climate report, cross-checked against the Iowa Environmental Mesonet. Nothing happens on ${other}.${n.metric === "snow" ? ` ${SNOW_SEASON_SENTENCE}` : ""}`,
      n.metric === "snow" ? oneShotSentence(r, null, `the first snow`) : PERPETUAL_SENTENCE, n.metric === "snow" ? "one-shot" : "recurring");
  }
  // continuous audit HB-3 (2026-10-19): a Coin vs Coin side is said in words (the page's own sentence), never its series id, with the
  // run length as its window sentence (never "no end date"), and suggests the page's ticker (derby/tile.ts coinvsTickers)
  if (r.oracle === "derby" && r.derby?.selector === "coinvs") {
    const d = r.derby, sideB = !!(r.binary?.onNo && !r.binary.onYes);
    const [win, lose] = sideB ? [d.b.symbol, d.a.symbol] : [d.a.symbol, d.b.symbol];
    const tks = coinvsTickers(d.a.symbol, d.b.symbol, d.flip), unit = d.window === "weekly" ? "week" : "day";
    const src = d.a.pyth && d.b.pyth ? "Pyth" : "each coin's published feed", at = d.window === "weekly" ? "Monday 00:00 UTC" : "00:00 UTC";
    const passes = `${d.a.symbol}'s market cap passes ${d.b.symbol}'s`;
    const oneLiner = d.flip ? (sideB ? `burns once if ${d.a.symbol}'s market cap never passes ${d.b.symbol}'s` : `burns once if ${passes}`) : `burns every ${unit} ${win} out-gains ${lose}`;
    const name0 = d.flip ? `${win} vs ${lose}, ${win} side` : fightName(win);
    const block = (t: string): string => d.flip
      ? `${sideB ? `If the run ends without ${d.a.symbol}'s market cap passing ${d.b.symbol}'s` : `On the first ${unit} ${passes}`}, ${spends(r, t)} once, with a receipt on chain. Each ${unit} is read from ${src} at ${at}. ${derbyReadOnlySentence(d)}`
      : `For each ${unit} ${win} out-gains ${lose}${d.measure === "mcap" ? " in size" : ""}, ${spends(r, t)}, with a receipt on chain. On a ${unit} ${lose} out-gains ${win}, this coin's share for that ${unit} goes to the other coin's burn. Each ${unit} is read from ${src} at ${at}, and an exact tie burns nothing. ${derbyReadOnlySentence(d)}`;
    const text = build(name0, sideB ? tks.b : tks.a, oneLiner, block, raceEndOf(d).season, d.flip ? "one-shot" : "recurring");
    // the lead is the paragraph's own first sentence ("$WIFWINS burns every day WIF out-gains BONK."), the one the page says
    return { ...text, lead: leadSentence(text.paragraph) };
  }
  // sources-4 (2026-10-12): a reference coin's record daily close (derby/high.ts), recurring or once
  if (r.oracle === "derby" && r.derby?.selector === "high") {
    const hs = r.derby, probe = highText(hs, "SPENDS"), by = highLastDay(hs);
    return build(probe.name, probe.ticker, probe.oneLiner, (t) => highText(hs, spends(r, t)).block, hs.once ? oneShotSentence(r, null, by ? `the first record day, by ${day(by)} at the latest` : null) : PERPETUAL_SENTENCE, hs.once ? "one-shot" : "recurring");
  }
  // sources-2 (2026-10-12): the publishers with their own text — executive orders, launches, earthquake counts, GitHub, YouTube
  const own = r.oracle === "catalogue" ? sourceText(r, series, ctx) : null;
  if (own) return build(own.name, own.ticker, own.oneLiner, own.block, own.oneShot ? oneShotSentence(r, null) : PERPETUAL_SENTENCE, own.oneShot ? "one-shot" : "recurring");
  if (r.oracle === "catalogue" && ctx.feed && r.inverse) {
    // THE FADE SIDE for any other first-party feed: the readings that do not move the rule's way
    const f = ctx.feed, title = f.title.split(/[(—,]/)[0].trim(), dir = r.scalar?.direction ?? "up";
    if (series === "treasury.debt") return build("Flat Debt Days", "FLATDEBT", "burns on every business day the national debt stays flat or falls",
      (t) => `This coin burns on the days the debt stays flat or falls. For every business day the national debt stays flat or falls, ${spends(r, t)}, with a receipt on chain. ${feedResultSentence(f)} A day the debt rises, by any amount, burns nothing.`, PERPETUAL_SENTENCE, "recurring");
    // HB-159 (hourly run 15): an up-or-down rule's fade burns only on a reading equal to the previous one (units.ts: one unit when the
    // move is 0); a move smaller than the rule's unit burns neither this coin nor the coin that counts each full unit, and the text says so
    const both = r.scalar?.baseline !== 0 && dir !== "up" && dir !== "down";
    const not = r.scalar?.baseline === 0 ? "reads zero" : dir === "up" ? "does not rise" : dir === "down" ? "does not fall" : "is the same as the previous reading";
    const did = r.scalar?.baseline === 0 ? "is above zero" : dir === "up" ? "rises" : dir === "down" ? "falls" : "moves";
    const unitWords = f.unitLabel.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+(added|moved|move)$/, "").replace(/-point\b/, " point");
    const gap = both ? ` A move smaller than ${unitWords} burns neither this coin nor the coin that burns for each full ${unitWords.replace(/^1\s+(?=\D)/, "")}.` : "";
    const sub = paramSubject(series), what = sub ? sub.name : title;
    return build(fadeName(series, sub ? sub.name : title, r.scalar?.baseline === 0), (sub ? tickerFrom(`NO${sub.ticker}`) : `NO${feedTickerBase(series, f.title, 8)}`), `burns on every reading of ${what} that ${not}`,
      (t) => `For every reading of ${what} that ${not}, ${spends(r, t)}, with a receipt on chain. The result comes from ${f.sourceName}.${sub ? ` Each reading is ${sub.window}.` : ""} A reading that ${did}, by any amount, burns nothing.${gap}`, PERPETUAL_SENTENCE, "recurring");
  }
  if (r.oracle === "catalogue" && ctx.feed) {
    const f = ctx.feed, sub = paramSubject(series);
    // intent audit 4 item 19: a parameterized source names its subject, its source and what each reading measures, never "an article"
    const note = SERIES_NOTES[series] ? ` ${SERIES_NOTES[series]}` : "";
    if (sub) {
      const ch = changePhrase(r, f.unitLabel, sub.noun, /snapshot/.test(sub.window));
      return build(sub.name, tickerFrom(sub.ticker), ch ? `burns for ${ch}` : `burns for every ${f.unitLabel} ${sub.what}`,
        (t) => `${ch ? `For ${ch}` : `For every ${f.unitLabel} ${sub.what}`}, ${spends(r, t)}, with a receipt on chain. ${feedResultSentence(f)} Each reading is ${sub.window}. Nothing happens on a move smaller than one unit.${note}`, PERPETUAL_SENTENCE, "recurring");
    }
    const title0 = f.title.split(/[(—,]/)[0].trim(), ch = changePhrase(r, f.unitLabel, title0, false);
    return build(title0, feedTickerBase(series, f.title), ch ? `burns for ${ch}` : `burns for every ${f.unitLabel} (${title0})`,
      (t) => `${ch ? `For ${ch}` : `For every ${f.unitLabel}`}, ${spends(r, t)}, with a receipt on chain. ${feedResultSentence(f)} Nothing happens on a move smaller than one unit.${note}`, PERPETUAL_SENTENCE, "recurring");
  }
  if (r.oracle === "polymarket" && r.market && r.binary && !r.binary.onYes && r.binary.onNo) {
    // intent audit 3 item 4: the NO side ("the Lakers do not win the 2027 NBA championship") burns on a NO payout only. The keeper reads
    // a voided or unsettled market as no burn (units.ts unitStep, onVoid "skip"), and the one-shot then ends void: never a NO.
    const phrase0 = (ctx.eventPhrase ?? "the market's event happens").replace(/\s*\(resolves once\)$/, "");
    const id = eventIdentity(phrase0), phrase = id.verb ? id.phrase : phrase0, not = negatePhrase(phrase);
    const titleTeamNo = ctx.suggest ? null : titleTeamOfPhrase(phrase0);
    if (titleTeamNo) ctx = { ...ctx, suggest: titleSuggest(titleTeamNo, true) };
    const settle = ctx.stated ? statedSentences(ctx.stated, ctx.stated.finalAfter) : `The result comes from Polymarket's on-chain payout, cross-checked against ${ctx.crossRead ?? "the official result"}.`;
    return build(fitName(`${id.verb && id.confident ? id.name : "Event"} No`), `NO${tickerFrom(id.ticker)}`.slice(0, 10), `burns if the Polymarket market settles NO, meaning ${not}`,
      (t) => `If the Polymarket market settles NO, meaning ${not}, ${spends(r, t)} once, with a receipt on chain. ${settle} If it settles YES, nothing burns. A voided or cancelled market never counts as a NO, and nothing burns for it.`, oneShotSentence(r, ctx.endsAt), "one-shot");
  }
  if (r.oracle === "polymarket" && r.market) {
    const phrase0 = (ctx.eventPhrase ?? "the market resolves YES").replace(/\s*\(resolves once\)$/, "");
    // L12 (launch audit 5): the name and ticker come from the event's subject and outcome (eventIdentity.ts), never its last word
    const id = eventIdentity(phrase0), phrase = id.verb ? id.phrase : phrase0;
    const titleTeam = ctx.suggest ? null : titleTeamOfPhrase(phrase0);
    if (titleTeam) ctx = { ...ctx, suggest: titleSuggest(titleTeam) };
    return build(id.verb && id.confident ? id.name : "Event Coin", id.verb && id.confident ? id.ticker : tickerFrom(id.ticker), `burns if ${phrase}`,
      (t) => ctx.stated ? `If it happens, ${spends(r, t)} once, with a receipt on chain. ${statedSentences(ctx.stated, ctx.stated.finalAfter)} If it does not happen, nothing burns on this coin.` : `If it happens, ${spends(r, t)} once, with a receipt on chain. The result comes from Polymarket's on-chain payout, cross-checked against ${ctx.crossRead ?? "the official result"}. If it does not happen, nothing burns on this coin.`, oneShotSentence(r, ctx.endsAt), "one-shot");
  }
  // audit 6 item 26: a catalogue source with no template is "this coin's source", never its raw id (the canonical rule carries the id)
  const what = ctx.eventPhrase ?? (r.oracle === "catalogue" ? "this coin's source" : r.series ?? r.market ?? "the source");
  const yes = r.kind !== "binary" || !!r.binary?.onYes;
  const once = windowKindOf(r) === "one-shot";
  return build("Event Coin", tickerFrom(r.oracle === "catalogue" && !ctx.eventPhrase ? r.series ?? "EVENT" : what), r.kind === "binary" ? `burns when ${what} settles ${yes ? "YES" : "NO"}` : `burns on each settled reading of ${what}`,
    (t) => `${r.kind === "binary" ? `Each time ${what} settles ${yes ? "YES" : "NO"}` : `Each time ${what} settles`}, ${spends(r, t)}, with a receipt on chain. The result comes from ${r.oracle === "polymarket" ? "Polymarket's on-chain payout" : "its published source"}${ctx.crossRead ? `, cross-checked against ${ctx.crossRead}` : ""}. Any other result burns nothing on this coin.`,
    once ? oneShotSentence(r, ctx.endsAt) : PERPETUAL_SENTENCE, once ? "one-shot" : "recurring");
}

/** A protocol's record TVL day as coin text (lint-clean: "value" and "record", never the words the lint refuses). */
export function llamaRecordText(p: string, once: boolean, spends: string, inverse: boolean): { name: string; ticker: string; oneLiner: string; block: string; oneShot: boolean } {
  const src = `The reading is the total value locked in ${p} as DefiLlama reports it, one value per UTC day, read once the day is over.`;
  const base = `The record starts as the highest day since DefiLlama's history of ${p} began, and each new record raises it.`;
  const tk = tickerFrom(p, once ? "NREC" : inverse ? "NOREC" : "REC");
  if (once) return { name: capName(`${p} Next Record TVL`), ticker: tk, oneLiner: `burns once on the first day ${p}'s TVL sets a record`, oneShot: true,
    block: `On the first UTC day after launch whose value is above every earlier day, ${spends} once, with a receipt on chain. ${src} ${base}` };
  if (inverse) return { name: capName(`${p} No Record Days`), ticker: tk, oneLiner: `burns on every day ${p}'s TVL does not set a record`, oneShot: false,
    block: `For every UTC day whose value is at or under the record, ${spends}, with a receipt on chain. ${src} ${base} A record day burns nothing.` };
  return { name: capName(`${p} Record TVL`), ticker: tk, oneLiner: `burns on every day ${p}'s TVL sets a record`, oneShot: false,
    block: `For every UTC day whose value is above every earlier day, ${spends}, with a receipt on chain. ${src} ${base} A day at or under the record burns nothing.` };
}

/** The text pieces of a sources-2 publisher's series (null: not one of theirs). */
function sourceText(r: BurnRule, series: string, ctx: DescribeCtx): { name: string; ticker: string; oneLiner: string; block: (t: string) => string; oneShot: boolean } | null {
  const inv = !!r.inverse;
  const wrap = (f: (sp: string) => { name: string; ticker: string; oneLiner: string; block: string; oneShot?: boolean }) => {
    const probe = f("SPENDS");
    return { name: probe.name, ticker: probe.ticker, oneLiner: probe.oneLiner, oneShot: !!probe.oneShot, block: (t: string) => { const b = f(spends(r, t)).block; return isSingleSourceSeries(series) ? `${b} ${singleSourceSentence(series)}` : b; } };
  };
  if (isFedregEo(series)) return wrap((sp) => fedregEoText(sp, inv));
  // sources-4 (2026-10-12): a protocol's record TVL day (DefiLlama; built and switched off until DefiLlama consents)
  const lr = /^defillama\.(tvlrecord|tvlnext):([a-z0-9-]{1,48})$/.exec(series);
  if (lr) return wrap((sp) => llamaRecordText(lr[2], lr[1] === "tvlnext", sp, inv));
  const l = parseLl2Series(series); if (l) return wrap((sp) => ll2Text(l, sp, inv, ctx.subjectName ?? null));
  const u = parseUsgsSeries(series); if (u) return wrap((sp) => usgsText(u, sp, inv));
  // sources-3 (2026-10-12): natural disasters, clinical (a magnitude, a category, a count, acres, an alert level; never harm)
  const un = parseUsgsNextSeries(series); if (un) return wrap((sp) => usgsNextText(un, sp));
  const h = parseNhcSeries(series); if (h) return wrap((sp) => nhcText(h, sp, inv));
  const sp3 = parseSpcSeries(series); if (sp3) return wrap((sp) => spcText(sp3, sp, inv));
  const f = parseNifcSeries(series); if (f) return wrap((sp) => nifcText(f, sp, inv));
  const v = parseVolcanoSeries(series); if (v) return wrap((sp) => volcanoText(v, sp, inv));
  const g = parseGithubSeries(series); if (g) return wrap((sp) => githubText(g, sp, inv));
  const y = parseYoutubeSeries(series); if (y) return wrap((sp) => youtubeText(y, sp, ctx.subjectName ?? null));
  return null;
}

/**
 * The badge for a registered coin: from its locked rule, with a one-shot's date read back from its own description's window sentence
 * ("Resolves once on Oct 31, 2026") and the end marked once the coin is retired.
 */
export function badgeFromText(r: BurnRule, description: string, retired = false): string {
  // both wordings: "Resolves once on Oct 31, 2026" (coins registered before 2026-10-11) and "This coin resolves once, on Oct 31, 2026"
  // HB-142: and a market coin's "when the market settles (it closes by Oct 31, 2026)"
  const m = /[Rr]esolves once,? on ([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(description) ?? /[Rr]esolves once, when the market settles \(it closes by ([A-Z][a-z]{2} \d{1,2}, \d{4})\)/.exec(description);
  const endsAt = m && !Number.isNaN(Date.parse(`${m[1]} 12:00 UTC`)) ? new Date(Date.parse(`${m[1]} 12:00 UTC`)).toISOString() : null;
  const b = windowBadge(r, { endsAt });
  return retired && !/ENDED/.test(b) ? `${b} · ENDED` : b;
}

/** The championship short code for a league ("WS" for MLB) — the one-shot coin's ticker suffix. */
export const championshipCode = (league: string): string => CHAMP_CODE[league] ?? "CHAMP";

/**
 * THE TEAM-TITLE NAME AND TICKER (continuous audit run 2, HB-20): the one generator the search card, the launch page (teamTicker with the
 * "title" window) and the server's review all use, so a title coin is suggested as $COLCUP everywhere, never $AVALANCHE on the server.
 */
export function titleSuggest(t: { abbr: string; league: LeagueId; nickname: string }, negated = false): { name: string; ticker: string } {
  const code = championshipCode(t.league);
  const ticker = teamTicker(t.abbr, { league: t.league, window: "title" });
  return negated ? { name: fitName(`${t.nickname} Fall Short`), ticker: `NO${ticker}`.slice(0, 10) } : { name: fitName(`${t.nickname} ${code === "WS" ? "World Series" : code === "CUP" ? "Cup" : "Champs"}`), ticker };
}
/** HS-33 (hourly run 6): the winner-market event titles (search.ts CHAMPIONSHIP's `title` patterns), each with its league. */
const CHAMP_EVENT_TITLES: readonly [RegExp, LeagueId][] = [[/^MLB World Series Champion (\d{4})$/, "mlb"], [/^Pro Football: (\d{4}) Champion/, "nfl"], [/^NBA: (\d{4}) Champion$/, "nba"], [/^NHL: (\d{4}) Champion/, "nhl"]];
/**
 * HS-33: an outcome of a league's winner market ("Denver Broncos" under "Pro Football: 2027 Champion") is named for its rule, "Broncos
 * Champs 2027", never the bare team name, which reads as an official team coin. The ticker is the one team-title ticker (titleSuggest,
 * HB-20), so the search card, the wizard and the review agree. null for any other event or outcome.
 */
export function championOutcomeSuggest(eventTitle: string | null | undefined, outcome: string | null | undefined): { name: string; ticker: string } | null {
  const o = (outcome ?? "").trim().toLowerCase();
  if (!eventTitle || !o) return null;
  for (const [re, league] of CHAMP_EVENT_TITLES) {
    const m = re.exec(eventTitle.trim());
    if (!m) continue;
    const hits = findTeams(outcome!).filter((t) => t.league === league && (t.name.toLowerCase() === o || t.nickname.toLowerCase() === o));
    if (hits.length !== 1) return null;
    const t = hits[0], base = titleSuggest({ abbr: t.abbr, league, nickname: t.nickname });
    // "Win It All" trips the copy lint's win-money rule, so the name is the one title name plus the season ("Broncos Champs 2027")
    return { name: fitName([`${base.name} ${m[1]}`, base.name]), ticker: base.ticker };
  }
  return null;
}
/** The championship words search.ts CHAMPIONSHIP names each title with, back to the league ("the 2027 NHL championship" → nhl). */
const TITLE_WORDS: readonly [RegExp, LeagueId][] = [[/^the \d{4} World Series$/, "mlb"], [/^the \d{4} pro football championship$/, "nfl"], [/^the \d{4} NBA championship$/, "nba"], [/^the \d{4} NHL championship$/, "nhl"]];
/** A team-title phrase ("the Avalanche win the 2027 NHL championship") to its team, or null for any other event. */
export function titleTeamOfPhrase(phrase: string): { abbr: string; league: LeagueId; nickname: string } | null {
  const m = /^(?:the )?(.+?) (?:win|wins|will win) (the .+)$/i.exec(phrase.trim());
  if (!m) return null;
  const league = TITLE_WORDS.find(([re]) => re.test(m[2]))?.[1];
  if (!league) return null;
  const hits = findTeams(m[1]).filter((t) => t.league === league && t.nickname.toLowerCase() === m[1].toLowerCase());
  return hits.length === 1 ? { abbr: hits[0].abbr, league, nickname: hits[0].nickname } : null;
}
export { LEAGUES };

/** The launch route's description limit (launchBundle.launchProblems; raised from 400 on 10-10 for the window sentence). Every template
 *  stays inside it; the wizard keeps the editable flavour inside what is left. */
export const DESCRIPTION_MAX = 800;
