import { withoutDenials } from "@/lib/burnticker/denials";
import type { BurnRule } from "@/lib/burnticker/rules";
import { pairFormCopy } from "@/lib/burnticker/pairForms";
import { dialsFor } from "@/lib/burnticker/dials";
import { CANDIDATES_PAIR_SENTENCE, GAME_PAIR_SENTENCE, INCINERATOR_WORDS, namedSinkFallback, sinkTickerOf, championPathRule, describeEndSink, endText, meetingsTicker, teamRefByName, windowKindOf } from "@/lib/burnticker/describe";
import { CATALOGUE_ONE_SHOT_RE, inverseRefusal } from "@/lib/burnticker/inverse";
import { LIVE_NOW, gameSeries, isPairOutcome, meetingsPairSeries, noPlayoffs, outcomeWords, parseEspnSeries, teamSeries, type LeagueId, type Outcome } from "@/lib/burnticker/sources/espn";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { pctLabel, SHARE_PRESETS, DEFAULT_SHARE } from "@/lib/burnticker/launchPresets";
import { DESCRIPTION_MAX, descriptionRoomProblem, linkProblem } from "@/lib/burnticker/creatorProfile";
import { controlCharProblem } from "@/lib/burnticker/launchFields";
import { fitName } from "@/lib/burnticker/launchFields";

/**
 * THE GUIDED LAUNCH (website-19; the owner, 2026-10-12: "should we have the coin launch be a step by step process with a guide, giving
 * choices for how the creator wants to stage the burns?"). Four questions, one screen each, then the review card:
 *
 *   1 follow   what the coin follows: a team, a market, a published number, a coin against another coin, a rivalry pair
 *   2 which    which one, with its schedule beside it; the ticker and the name are generated here from the matchup, team or market
 *   3 burn     how it burns: four named patterns, one chosen already for the thing picked; a pattern the rule cannot take is shown greyed
 *              with the reason, never hidden
 *   4 end      what happens at the end: only the ends the program pins at creation (EndSink kinds 0, 1 and 3: $DEFICIT, a named coin, the
 *              rival), said as sentences read from the rule chosen in step 3
 *
 * A reorganization of the existing mechanics: every pattern maps to a rule the keeper and the program run today (the recurring rule, its
 * fade side, a one-shot on a market or a release, a rivalry pair). Every sentence here is plain copy (test/burntickerPlainCopy.test.ts)
 * and passes the copy lint (test/burntickerGuidedLaunch.test.ts). Client-safe.
 */

/**
 * website-20 (ChatGPT audit 6 item 12, the owner's mobile rule of 2026-10-12: one decision per screen): FIVE honest steps. The end has one
 * real choice per rule, so it is a stated section on the review ("What happens when this ends"), not a question; the name and the look get
 * their own step, so the review only reviews.
 */
export type GuidedStepId = "follow" | "which" | "burn" | "name" | "review";
export const GUIDED_STEPS: readonly { id: GuidedStepId; question: string; short: string }[] = [
  { id: "follow", question: "What does this coin follow?", short: "Follows" },
  { id: "which", question: "Which one?", short: "Which" },
  { id: "burn", question: "How does it burn?", short: "Burns" },
  { id: "name", question: "Name and look", short: "Name" },
  { id: "review", question: "Review and launch", short: "Review" },
];
/** Step 2's heading, named for what is being chosen (pass A item 6). */
export function whichHeading(follow: FollowId | null, pairKind: "teams" | "candidates" | null = null, /** audit 12 item 10: the coin comparison's mode; a record close follows one coin and makes one */ coinsMode: "race" | "record" | null = null): string {
  if (follow === "coins" && coinsMode === "record") return "Choose the coin whose record close is read";
  if (follow === "team") return "Choose a team";
  if (follow === "market") return "Choose a market outcome";
  if (follow === "number") return "Choose a published number";
  if (follow === "disaster") return "Choose a kind of natural disaster";
  if (follow === "coins") return "Choose two coins";
  if (follow === "rivalry") return pairKind === "teams" ? "Choose two teams" : pairKind === "candidates" ? "Choose a race and two candidates" : "Two teams or two candidates?";
  return "Which one?";
}
/** The end, said as a section on the review (pass B item 18), not as a menu. */
export const END_LABEL = "What happens when this ends";
/** The greyed patterns, one tap away (the owner's mobile rule: everything else behind a tap). */
export const OTHER_PATTERNS_LABEL = "Other patterns, not offered here";
/** "1 of 4". */
export const progressLabel = (i: number): string => `${i + 1} of ${GUIDED_STEPS.length}`;

/** "disaster" (WIRING-SOURCES3, the owner 2026-10-12): a natural disaster, its card and its step-3 patterns from hazards.ts. */
export type FollowId = "team" | "market" | "number" | "coins" | "rivalry" | "disaster";
/**
 * `line` is the one line a choice card shows (owner, 2026-10-12: "make the step workflow easier to follow": title and one line, so all
 * five fit on one phone screen); `sentence` and `example` sit in the Examples disclosure below the cards.
 */
export const FOLLOW_CHOICES: readonly { id: FollowId; label: string; line: string; sentence: string; example: string; coins: 1 | 2 }[] = [
  { id: "team", label: "Team", coins: 1, line: "One team in any league.", sentence: "One team in any league. It can burn on every win this season, or once if they win the title.", example: "For example, $LAD for the Dodgers' season." },
  { id: "market", label: "Event outcome", coins: 1, line: "One outcome of a Polymarket market.", sentence: "One outcome of a Polymarket market, such as a candidate, a film or a team. It burns once when the market pays out.", example: "For example, a candidate winning a Senate race." },
  { id: "number", label: "Published data", coins: 1, line: "A public figure or record, like the debt.", sentence: "A public figure or record, such as the national debt, a city's daily high or rocket launches.", example: "For example, every $1B the debt rises." },
  { id: "coins", label: "Coin comparison", coins: 2, line: "Two coins, compared once a day.", sentence: "Two coins people already hold, compared each day on their published feeds. You launch two new coins, one for each side.", example: "For example, WIF against BONK." },
  { id: "rivalry", label: "Rivalry", coins: 2, line: "Two teams or two candidates, one coin each.", sentence: "Two teams in one game or one season, or two candidates in one race. You launch one coin for each side.", example: "For example, the Dodgers against the Brewers." },
];

export type PatternId = "every" | "fade" | "once" | "winner";
export const PATTERNS: Record<PatternId, { label: string; sentence: string }> = {
  every: { label: "Every time it happens", sentence: "The coin spends a share of its pool each time the thing happens: each win, each $1B, each unit." },
  fade: { label: "When it does not happen", sentence: "The coin spends a share of its pool on each day or reading where the thing does not happen." },
  once: { label: "Once, when it settles", sentence: "The coin spends a large share of its pool one time, when a market or a single result settles." },
  winner: { label: "Winner takes the burn", sentence: "Two coins are linked. When a result fires one coin's rule, that coin's own pool and the other coin's share for the result are both spent burning that coin. The winning coin's supply shrinks; the other coin's does not." },
};
export const PATTERN_ORDER: readonly PatternId[] = ["every", "fade", "once", "winner"];

/** The reserved-name refusal (reservedNames.ts reads the list; this sentence is client-safe). */
export const RESERVED_REFUSAL = "That name is reserved for the platform.";

/** An event-level Polymarket rule (a set of outcomes, `event:<slug>` with no market): never one coin's rule (walkthrough snag 1). */
export const eventLevelRule = (r: Pick<BurnRule, "oracle" | "market" | "series">): boolean => r.oracle === "polymarket" && !r.market && /^event:/.test(r.series ?? "");
export const EVENT_LEVEL_REFUSAL = "This market is a set of outcomes. Pick one outcome, so the coin burns only if that one wins.";

/**
 * THE ONE-SHOT REVIEW SENTENCES (owner, 2026-10-12, the Dodgers World Series case): what the coin burns, when, how it lands and where the
 * rest goes, from the share and the market's own words. `subject` is "they" for a team and "it" for anything else.
 */
export function oneShotSentences(o: { share: number; happened: string; subject: "they" | "it"; no?: boolean }): string[] {
  const what = o.share >= 1 ? "its whole pool" : `${pctLabel(o.share)} of its pool`;
  // sources-7 (QA walkthrough 11 M2): the NO side's other case is the market resolving YES, said as that ("If it does" read as the NO)
  const tail = o.no ? "If the market resolves YES instead, the rest goes to $DEFICIT's burn. A voided market is not a NO." : `If ${o.subject} ${o.subject === "they" ? "do" : "does"} not, the rest goes to $DEFICIT's burn.`;
  return [`This coin burns ${what} once, when Polymarket's payout says ${o.happened}.`, "The burn lands in slices sized to the pool's liquidity.", tail];
}

/** What blocks the launch while an image is being prepared, or after its preparation failed (intent audit 5 item 15). */
export const IMAGE_PENDING = "The image is still being prepared. Wait a moment, or cancel it.";
/** audit 7 item 15: a rejected image is not on the coin, so the way out never says "remove": choose another, or keep the generated art. */
export const IMAGE_FAILED = "The image could not be used. Choose another image, or keep the generated art.";
/** audit 7 item 15: the one button beside an image still being prepared, and beside one that was rejected. */
export const IMAGE_CANCEL_LABEL = "Cancel the image";
export const IMAGE_KEEP_GENERATED_LABEL = "Keep the generated art";
export const imageStateProblem = (s: "pending" | "failed" | null): string | null => (s === "pending" ? IMAGE_PENDING : s === "failed" ? IMAGE_FAILED : null);

/** A saved draft keeps the words and links but never an image (intent audit 5 item 11). */
export const IMAGE_NOT_KEPT = "A saved draft does not keep an image. Add it again if you want one.";

/** A one-time market's fade side, said with its real cadence. */
/** QA pass 9 #22 (2026-10-13): the market's NO option is said as what it is, with its own helper (never "each day or reading"). */
export const MARKET_NO_LABEL = "If it resolves NO";
export const MARKET_NO_SENTENCE = "The coin spends its share once, if the market resolves NO. A voided market is not a NO, and nothing burns for it.";

/** The reasons a pattern is greyed, in plain words. */
export const PATTERN_REASON = {
  marketOnce: "A market settles once, so it cannot burn every time.",
  marketFade: "This market is a yes-or-no question. Pick the outcome you want in step 2 instead.",
  feedOnce: "This number is published again and again, so there is no single result to burn on once.",
  oneShotEvery: "This result happens only once, so it cannot burn every time.",
  oneShotFade: "A rule that resolves once cannot burn on the days it does not happen. Its other outcome already burns nothing.",
  noTitleMarket: "No market for this yet.",
  titleMarketLoading: "Looking for a market on this team's title.",
  needsTwo: "Winner takes the burn needs two linked coins. Pick a coin against another coin in step 1.",
  noMeeting: "These two teams have no listed game right now. Pick This season instead.",
  teamsSeparate: "Two team coins launch as two separate coins, and each one burns from its own pool. Winner takes the burn is offered for every game between them this season.",
  meetingsOnly: "Every game between them this season is a linked pair where the winner takes the burn, so this pattern does not apply to it.",
  // owner 2026-10-13: two candidates in one race and two teams in one game are linked pairs, winner takes the burn and nothing else
  candidatesLinked: "Two candidates in one race are a linked pair where the winner takes the burn, so this pattern does not apply to them.",
  gameLinked: "Two teams in one game are a linked pair where the winner takes the burn, so this pattern does not apply to them.",
  candidatesEvery: "A race is decided once, so it cannot burn every time.",
  derbyEvery: "In a coin against another coin, each day's result fires one side's rule, and that side takes the burn.",
  derbyFade: "On a valid, non-tied result, one of the two sides fires, so there is no separate side for when it does not happen. A tie or a withheld reading burns neither coin.",
} as const;

export interface PatternOption { id: PatternId; label: string; sentence: string; available: boolean; reason: string | null }
export interface PatternInput {
  follow: FollowId;
  /** The rule the creator's pick in step 2 built (null while nothing is picked). */
  rule: BurnRule | null;
  /** A team: the title market search ("found" has a market to switch to). */
  titleMarket?: "found" | "none" | "loading" | null;
  /** A rivalry pair: two teams or two candidates. */
  pairKind?: "teams" | "candidates" | null;
  /** Two teams: whether they have a listed game against each other (false greys "once"). */
  meeting?: boolean | null;
  /** Two teams: the rivalry option picked in step 2 (RIVALRY_*_LABEL): one game, every loss this season, or every game between them. */
  rivalryScope?: "game" | "season" | "meetings" | null;
}

const isOneShotRule = (r: BurnRule): boolean => windowKindOf(r) === "one-shot" || (r.oracle === "catalogue" && CATALOGUE_ONE_SHOT_RE.test(r.series ?? ""));
const plainInverseReason = (r: BurnRule): string => {
  const why = inverseRefusal({ ...r, set: undefined });
  if (!why) return "";
  if (/resolves once/.test(why)) return PATTERN_REASON.oneShotFade;
  if (/market rule/.test(why)) return PATTERN_REASON.marketFade;
  return why;
};

/** The four patterns for the thing picked, each available or greyed with its reason, and the one chosen already. */
export function patternOptions(i: PatternInput): { options: PatternOption[]; preselected: PatternId } {
  const r = i.rule;
  const mk = (id: PatternId, reason: string | null): PatternOption => ({ id, ...PATTERNS[id], available: reason === null, reason });
  // a coin against another coin: each day's winner takes the burn, or once, the flippening (the first day one passes the other)
  if (i.follow === "coins") return { options: [mk("every", PATTERN_REASON.derbyEvery), mk("fade", PATTERN_REASON.derbyFade), mk("once", null), mk("winner", null)], preselected: (r as { derby?: { flip?: boolean } } | null)?.derby?.flip ? "once" : "winner" };
  // two candidates in one race (owner 2026-10-13: the linked form is the only form): winner takes the burn and nothing else
  if (i.follow === "rivalry" && i.pairKind === "candidates") return { options: [mk("every", PATTERN_REASON.candidatesEvery), mk("fade", PATTERN_REASON.candidatesLinked), mk("once", PATTERN_REASON.candidatesLinked), mk("winner", null)], preselected: "winner" };
  // two teams in one game: the same linked pair (coordinator 2026-10-13)
  if (i.follow === "rivalry" && i.rivalryScope === "game") return { options: [mk("every", PATTERN_REASON.gameLinked), mk("fade", PATTERN_REASON.gameLinked), mk("once", PATTERN_REASON.gameLinked), mk("winner", i.meeting === false ? PATTERN_REASON.noMeeting : null)], preselected: "winner" };
  // two teams, every game between them this season: a linked pair, winner takes the burn and nothing else
  if (i.follow === "rivalry" && i.rivalryScope === "meetings") return { options: [mk("every", PATTERN_REASON.meetingsOnly), mk("fade", PATTERN_REASON.meetingsOnly), mk("once", PATTERN_REASON.meetingsOnly), mk("winner", null)], preselected: "winner" };
  if (i.follow === "rivalry") {
    // two teams: this season (each coin burns when its own team loses), its fade side, or this game only
    const fade = r && dialsFor(r).inverse ? null : r && !isOneShotRule(r) ? plainInverseReason(r) || null : null;
    return { options: [mk("every", null), mk("fade", fade), mk("once", i.meeting === false ? PATTERN_REASON.noMeeting : null), mk("winner", PATTERN_REASON.teamsSeparate)], preselected: r && isOneShotRule(r) ? "once" : "every" };
  }
  const one = !!r && isOneShotRule(r);
  const winner = mk("winner", PATTERN_REASON.needsTwo);
  if (i.follow === "team") {
    const e = r && r.oracle === "catalogue" && r.series ? parseEspnSeries(r.series) : null;
    const onceReason = i.titleMarket === "found" ? null : i.titleMarket === "loading" ? PATTERN_REASON.titleMarketLoading : PATTERN_REASON.noTitleMarket;
    const fadeReason = e && r ? (dialsFor(r).inverse ? null : plainInverseReason(r)) : r?.oracle === "polymarket" ? null : PATTERN_REASON.oneShotFade;
    return { options: [mk("every", null), mk("fade", e ? fadeReason : null), mk("once", r?.oracle === "polymarket" ? null : onceReason), winner], preselected: r?.oracle === "polymarket" ? "once" : r?.inverse ? "fade" : "every" };
  }
  // a one-time market's "does not happen" is its NO side: once, on a NO payout (never "each day or reading")
  if (i.follow === "market") return { options: [mk("every", PATTERN_REASON.marketOnce), { ...mk("fade", r && r.kind === "binary" ? null : PATTERN_REASON.marketFade), label: MARKET_NO_LABEL, sentence: MARKET_NO_SENTENCE }, mk("once", null), winner], preselected: r?.kind === "binary" && r.binary?.onNo && !r.binary.onYes ? "fade" : "once" };
  // a published number: the recurring rule and its fade side, or a one-time release
  if (one) return { options: [mk("every", PATTERN_REASON.oneShotEvery), mk("fade", PATTERN_REASON.oneShotFade), mk("once", null), winner], preselected: "once" };
  const fade = r ? (dialsFor(r).inverse ? null : plainInverseReason(r) || PATTERN_REASON.oneShotFade) : null;
  return { options: [mk("every", null), mk("fade", fade), mk("once", PATTERN_REASON.feedOnce), winner], preselected: r?.inverse ? "fade" : "every" };
}

/**
 * THE SHARE PRESETS PER PATTERN (launchPresets.ts holds the numbers): a recurring rule 1, 2 or 5 % per unit, default 2 %; a one-shot its
 * whole pool, or half of it (owner, 2026-10-12: a "Dodgers win the World Series" coin was offered 2 / 5 / 10 %).
 */
export const sharePresetsFor = (oneShot: boolean): readonly number[] => (oneShot ? SHARE_PRESETS.oneShot : SHARE_PRESETS.recurring);
export const defaultShareFor = (oneShot: boolean): number => (oneShot ? DEFAULT_SHARE.oneShot : DEFAULT_SHARE.recurring);

/** A unit label from the catalogue, as the budget row says it ("0.1 pt moved" in percent is a 0.1 percentage-point change). */
export function unitPhrase(unit: { label: string } | null | undefined, valueLabel?: string | null): string | null {
  if (!unit?.label) return null;
  const l = unit.label.trim();
  const pt = /^([\d.]+) pt(?: moved)?$/.exec(l);
  if (pt && /percent/.test(valueLabel ?? "percent")) return `${pt[1]} percentage-point change`;
  return l.replace(/ moved$/, " change");
}

/**
 * THE BUDGET ROW, FROM THE RULE (ChatGPT launch-intent audit item 6): its label and one sentence on what a reading spends, from the
 * program's own arithmetic (burnMath.ts simulateCrank, burnReceipts/math.ts buybackSpend): units compound, each one spending its share of
 * what the one before left, so 3 units at 2 % spend about 5.9 %; one burn run buys with at most 2 % of the trading pool's SOL, and the
 * rest waits for the next run. A fade-side reading counts one unit at most. A one-shot spends its share once.
 */
export function budgetCopy(rule: BurnRule, share: number, unit: string | null): { label: string; line: string; math: string | null } {
  const p = pctLabel(share);
  // Round 5 (WIRING-ROUND5 item 6): a coin with a pinned token (rules.ts burnTarget) swaps SOL for that token and burns it; the words
  // follow the token, and its cap is 2% of the SOL in that token's pinned pool (crank_target_burn), not the coin's own pool
  const sym = rule.burnTarget?.symbol ?? null;
  const act = sym ? `swapping SOL for ${sym} and burning it` : "buying and burning this coin";
  if (isOneShotRule(rule)) {
    if (sym) return { label: "Share of the burn pool, once", line: `${share >= 1 ? "This coin spends its whole pool once" : `This coin spends ${p} of its pool once`}, when the result is in, ${act}. The burn lands in slices sized to the SOL in ${sym}'s pinned Raydium pool.`, math: null };
    return { label: "Share of the burn pool, once", line: share >= 1 ? "This coin burns its whole pool once, when the result is in. The burn lands in slices sized to the pool's liquidity." : `This coin burns ${p} of its pool once, when the result is in. The burn lands in slices sized to the pool's liquidity.`, math: null };
  }
  // QA pass 9 #18 and #20 (2026-10-13): the fade side is said for what the rule reads (a game day, a day with none of the events, or a
  // number that did not move), and a unit of one is a noun ("each earthquake", never "each 1 earthquake")
  if (rule.kind === "scalar" && rule.inverse) {
    const e = rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series) : null;
    if (e) return { label: "Share of the burn pool per game day", line: `Each game day without the result the rule names spends ${p} of the burn pool ${act}. A day with two games counts once.`, math: null };
    if (rule.scalar?.baseline === 0) return { label: "Share of the burn pool per day", line: `Each day with none of the events the rule counts spends ${p} of the burn pool ${act}. A day counts once at most.`, math: null };
    return { label: "Share of the burn pool per reading", line: `Each reading where the number does not move the rule's way spends ${p} of the burn pool ${act}. A reading counts once at most, however flat it was.`, math: null };
  }
  const cap = sym ? `One burn run spends at most 2% of the SOL in ${sym}'s pinned Raydium pool, and the rest waits for the next run.` : "One burn run buys with at most 2% of the SOL in the coin's Raydium pool, and the rest waits for the next run.";
  if (rule.kind === "scalar" && unit) {
    const three = Math.round((1 - (1 - share) ** 3) * 10000) / 100;
    const u = unit.replace(/^1\s+(?=\D)/, "");
    return { label: `Share of the burn pool per ${u}`, line: `Each ${u} spends ${p} of what is left in the burn pool ${act}.`, math: `A reading with several units compounds, so 3 units spend about ${three}%, not ${Math.round(share * 300 * 10) / 10}%. ${cap}` };
  }
  return { label: "Share of the burn pool per result", line: `Each result that fires the rule spends ${p} of the burn pool ${act}. ${sym ? `The amount of ${sym} each swap gets varies.` : "The token amount bought varies."}`, math: null };
}
/** Pass B item 15: what a share means in SOL, with a round number and no price or return in it. */
export function shareExample(share: number): string {
  const sol = Math.round(share * 1000) / 1000;
  return `For example, with 1 SOL in the burn pool, this spends ${sol} SOL on that burn.`;
}
/** The label of the "how the amount is worked out" disclosure (pass B item 16). */
export const AMOUNT_MATH_LABEL = "How the amount is calculated";
/** Item 55: Coin vs Coin keeps a share for each mode, and says both. */
export const derbyShareLine = (daily: number, flip: number): string => `Each mode keeps its own share: the daily race at ${pctLabel(daily)}, the flippening at ${pctLabel(flip)}.`;

/**
 * THE PATTERN WORDS FOR THE THING PICKED (pass B item 12, audit 6 item 16): "After each Dodgers win", never "each day or reading" on a team
 * coin. Generic words stay for the paths with no subject to name.
 */
export function patternWords(id: PatternId, o: { follow: FollowId; subject?: string | null; outcome?: Outcome | null; pairKind?: "teams" | "candidates" | null; rivalryScope?: "game" | "season" | "meetings" | null; /** sources-7 M2: the picked game's date ("Sat, May 1, 2027") when it is not their next listed game */ gameLabel?: string | null }): { label: string; sentence: string } {
  const s = o.subject;
  if (o.follow === "rivalry" && o.pairKind === "teams" && o.rivalryScope === "meetings" && id === "winner") return { label: PATTERNS.winner.label, sentence: MEETINGS_WINNER_LINE };
  if (o.follow === "rivalry" && o.pairKind === "teams" && o.rivalryScope === "game" && id === "winner") return { label: PATTERNS.winner.label, sentence: GAME_PAIR_SENTENCE };
  if (o.follow === "rivalry" && o.pairKind === "candidates" && id === "winner") return { label: PATTERNS.winner.label, sentence: CANDIDATES_PAIR_SENTENCE };
  if (o.follow === "team" && s && isPairOutcome(o.outcome) && id === "every") {
    // two of a soccer game's three results (espn.ts PairOutcome): "After each Arsenal win or draw"; the fade side is not offered for it
    const w = outcomeWords(o.outcome);
    return { label: `After each ${s} ${w.noun}`, sentence: `The coin spends a share of its burn pool after each game the ${s} ${w.verb}.` };
  }
  if (o.follow === "team" && s && !isPairOutcome(o.outcome)) {
    const won = o.outcome === "loss" ? "loss" : o.outcome === "draw" ? "draw" : "win";
    if (id === "every") return { label: `After each ${s} ${won}`, sentence: `The coin spends a share of its burn pool after each game the ${s} ${won === "win" ? "win" : won === "loss" ? "lose" : "draw"}.` };
    // audit 12 item 6: the fade side counts GAME DAYS (describe.ts: "A day with two games counts once"), so the option says so, with the
    // doubleheader cases, before it is picked
    if (id === "fade") return { label: `After each ${s} game day without a ${won}`, sentence: fadeDaySentence(`the ${s}`, won) };
    if (id === "once") return { label: `If the ${s} win the title`, sentence: `The coin spends its burn pool once, if the market on the ${s} winning the title pays out YES.` };
  }
  if (o.follow === "rivalry" && o.pairKind === "teams") {
    if (id === "every") return { label: "Each time its own team loses", sentence: "Each coin spends a share of its own burn pool after each game its team loses, this season." };
    if (id === "fade") return { label: "Each game day its own team does not lose", sentence: `${fadeDaySentence("its own team", "loss", "Each coin")} This counts every game day this season.` };
    // audit 12 item 3: picking one game builds the LINKED pair (the page's game mode, gamePairRule), so the option says so (pairForms.ts)
    if (id === "once") { const c = pairFormCopy("game-linked", { gameLabel: o.gameLabel ?? null }); return { label: c.label, sentence: c.sentence }; }
  }
  if (o.follow === "market" && id === "fade") return { label: MARKET_NO_LABEL, sentence: MARKET_NO_SENTENCE };
  // website-22 (audit 10 item 22): a one-time market's two sides are its YES and its NO payout, each once
  if (o.follow === "market" && id === "once") return { label: MARKET_YES_LABEL, sentence: MARKET_YES_SENTENCE };
  return { label: PATTERNS[id].label, sentence: PATTERNS[id].sentence };
}

/**
 * Audit 12 item 6: what a fade-side team coin counts, said before it is picked. The keeper reads one result per game DAY: a day burns once
 * if none of that day's games was the outcome, so a doubleheader with one win and one loss burns nothing on a win-fade coin, two losses
 * burn once, a tie is not a win (or a loss), and a day with no game played (a cancellation, an off day) burns nothing.
 */
export function fadeDaySentence(team: string, outcome: "win" | "loss" | "draw", subject = "The coin"): string {
  const w = outcome === "win" ? "win" : outcome === "loss" ? "loss" : "draw", v = outcome === "win" ? "win" : outcome === "loss" ? "lose" : "draw";
  return `${subject} spends a share of its burn pool once for each day ${team} ${team.startsWith("its ") ? `plays and does not ${v}` : `play and do not ${v}`}. A day with two games counts once: it burns only if neither game is a ${w}.${outcome === "draw" ? "" : ` A tie is not a ${w}.`} A day with no game played, or only a cancelled one, burns nothing.`;
}

/** The five things the review always shows (the owner's mobile rule, 2026-10-12), in this order. */
export const FACT_LABELS = { trigger: "What triggers the burn", coin: "Which coin burns", amount: "How much", ends: "When it ends", cost: "What costs SOL" } as const;
/** "Which coin burns": the coin's own token, bought back from its pool and burned; a pair names both. */
export function whichCoinLine(a: string, b: string | null, linked = false): string {
  if (!b) return `$${a}. Its burn pool buys $${a} back and burns it.`;
  return linked ? `$${a} or $${b}, whichever coin's rule fires. That coin's burn is funded from both pools.` : `$${a} when its rule fires, and $${b} when its rule fires. Each coin burns from its own pool.`;
}
/** "What costs SOL": the creator pays to create; burns are paid from the coin's own fees. */
export function costLine(totalSol: string | null, coins: 1 | 2): string {
  const make = totalSol ? `About ${totalSol} SOL from your wallet to create ${coins === 2 ? "both coins" : "the coin"}.` : `Creating ${coins === 2 ? "the two coins" : "the coin"} costs a small amount of SOL from your wallet, shown once the estimate is read.`;
  return `${make} Burns are paid from the coin's own trading fees, never from you.`;
}
/** "Creates 1 coin" / "Creates 2 coins" (pass A item 3). */
export const createsLine = (n: 1 | 2): string => (n === 2 ? "Creates 2 coins" : "Creates 1 coin");
/**
 * Audit 12 item 10: the coins a follow choice makes, said by mode. Coin comparison makes two coins for a race or the flippening and ONE for
 * a record close, so its entry card says both before a mode is picked; every other choice is its FOLLOW_CHOICES count.
 */
export function createsLineFor(follow: FollowId, coinsMode: "race" | "record" | null = null): string {
  if (follow === "coins") return coinsMode === "record" ? createsLine(1) : coinsMode === "race" ? createsLine(2) : "Creates 1 or 2 coins";
  return createsLine(FOLLOW_CHOICES.find((c) => c.id === follow)?.coins ?? 1);
}
/** Audit 12 item 10: the note after a change of what the coin follows renamed the coin(s), with the right count. */
export const namesRemadeLine = (n: 1 | 2): string => n === 2
  ? "You changed what the coins follow, so both coins got new names and tickers for the new rule. The ones you typed described the old rule. Type your own again if you like."
  : "You changed what the coin follows, so it got a new name and ticker for the new rule. The ones you typed described the old rule. Type your own again if you like.";
/**
 * Audit 12 item 11: the record-close choice says whether it can start on this site BEFORE the creator sets it up. A record close needs past
 * daily closes: Pyth gives them only to a site with a Pyth access key, otherwise only closes this site saved itself count. Nothing is
 * guessed: without the key the choice says so and points at the comparisons that work today.
 */
export function recordCloseAvailability(o: { keyed: boolean }): { available: boolean; line: string; alternative: string | null } {
  return o.keyed
    ? { available: true, line: "Past daily closes can be read on this site, so a record close can start once its reference coin's closes are complete.", alternative: null }
    : { available: false, line: "A record close needs past daily closes. This site has no Pyth access key set up, so it can only use closes it saved itself, and a new record close usually cannot start yet.", alternative: "Two coins raced on their daily feeds, or the flippening, work today." };
}

/** The burn-pool cap in force by default (capInForce.ts; the test pins it to the program's constant and its 48-hour wait). */
export const PRE_AUDIT_CAP_SOL_TEXT = "25";
/**
 * WHAT TO KNOW BEFORE YOU START (audit 6 item 14, pass B item 20): said at step 1 and again on the review, in plain words.
 */
export function upfrontLines(raises: readonly string[]): string[] {
  const list = `${raises.slice(0, -1).join(", ")} or ${raises[raises.length - 1]} SOL`;
  return [
    "Creators earn no fee revenue. The creator's share of the fees goes to the coin's own burn pool.",
    `Nothing burns until the coin graduates: buyers on its curve have to put in the raise you pick, ${list}, and then its pool is registered. A result that comes first is recorded and waits.`,
    `For now a burn pool spends from at most ${PRE_AUDIT_CAP_SOL_TEXT} SOL. Only the platform's multisig can raise that cap, after a public 48-hour wait, and SOL above it stays in the coin's pool.`,
    "When the rule ends, whatever is left goes to $DEFICIT's burn, or to the rival coin for a linked pair.",
    "Creating a coin costs a small amount of SOL from your wallet. The review shows the estimate before you sign.",
  ];
}
export const UPFRONT_LABEL = "What to know before you start";

/**
 * WHO DECIDES AN ELECTION COIN (item 53): the race card names the state's certified result, and the review names the sources Polymarket's
 * rules use (for example the AP, Fox News and NBC). Each one's job, said once: Polymarket's rules decide its payout, the payout fires the
 * burn, the certified result is the published cross-check, and the dispute window is when the payout becomes final.
 */
export const ELECTION_AUTHORITY_LABEL = "Who decides the result";
export function electionAuthorityLines(certified: string): string[] {
  return [
    "Polymarket's own rules name who calls the race, and its on-chain payout follows those rules. The burn fires when that on-chain payout is final.",
    `${certified[0].toUpperCase()}${certified.slice(1)} is the official count, named so you can check the on-chain payout against it. The burn does not wait for it.`,
    "The on-chain payout becomes final after Polymarket's dispute window, about 2 hours unless the market sets its own. A dispute starts a new window, and a second dispute goes to UMA's vote, which takes about 48 to 72 hours.",
  ];
}

export type EndKind = "flagship" | "named-coin" | "pair-winner" | "incinerator" | "self";
/** Round 5: the incinerator end's choice label (step 4 and the review's end facts). */
export const INCINERATOR_CHOICE_LABEL = "The SOL left is sent to Solana's incinerator, which nothing can spend from";
export interface EndOption { kind: EndKind; label: string; available: boolean; reason: string | null }
/**
 * THE END, FROM THE RULE (step 4). The program pins one end sink at creation (EndSink kinds 0, 1 and 3); the sentences come from the sink
 * the rule carries (describe.ts describeEndSink, the same test the keeper uses). A coin with no end sink (a Coin vs Coin pair today) burns
 * the rest down on itself. `options` lists the pinnable ends with the ones the launch page does not build greyed.
 */
/** Item 58: what a coin with no end date really does (the end sink it carries is never reached). */
export const PERPETUAL_END_LINE = "This coin has no end. It keeps burning on every result that qualifies, for as long as its pool holds SOL, so nothing is ever left over to send anywhere.";
export function endSentences(rule: BurnRule, o: { team?: string | null } = {}): { kind: EndKind; sentences: string[]; options: EndOption[] } {
  const sink = describeEndSink(rule);
  const kind: EndKind = sink === "pair-winner" ? "pair-winner" : sink === "flagship" ? "flagship" : sink === "mint" ? "named-coin" : sink === "incinerator" ? "incinerator" : "self";
  // ChatGPT audit 6 item 3: the sentences are describe.ts endText's, the same the review API's endsLine and the coin description say
  const e = endText(rule, { team: o.team ?? null });
  const sentences = [...e.result.split(/(?<=\.)\s+(?=[A-Z$])/), ...(e.void ? [e.void] : [])];
  // website-20 item 58: a coin with no end never reaches its end sink, so no end is offered as "this coin's end"
  if (windowKindOf(rule) === "perpetual" && kind !== "pair-winner") return { kind: "self", sentences, options: [] };
  const options: EndOption[] = [
    { kind: "flagship", label: kind === "flagship" && championPathRule(rule) ? sentences.join(" ") : "The rest goes to $DEFICIT", available: kind === "flagship", reason: kind === "flagship" ? null : kind === "pair-winner" ? "A linked pair sends the rest to the rival first." : kind === "named-coin" ? "This coin names another coin instead." : "This kind of coin has no end sink today." },
    { kind: "pair-winner", label: "The rest goes to the rival", available: kind === "pair-winner", reason: kind === "pair-winner" ? null : "Only two linked coins can name each other." },
    { kind: "named-coin", label: kind === "named-coin" ? sentences[0] : "The rest goes to another coin you name", available: kind === "named-coin", reason: kind === "named-coin" ? null : kind === "pair-winner" ? "A linked pair sends the rest to the rival." : kind === "flagship" ? "Pick it under When it ends." : "This kind of coin has no end sink today." },
    // round 5 (owner 2026-10-13): burn the SOL itself; single coins only (a linked pair ends on the rival)
    { kind: "incinerator", label: INCINERATOR_CHOICE_LABEL, available: kind === "incinerator", reason: kind === "incinerator" ? null : kind === "pair-winner" ? "A linked pair sends the rest to the rival." : "Pick it under When it ends." },
  ];
  return { kind, sentences, options };
}

/**
 * THE END CHOICE (owner, 2026-10-13: "pick another coin to burn (except the losing coin) or give the option to burn the SOL"; END-SINK-
 * OPTIONS-BRIEF item 2, and the owner rule of ~09:05 the same morning: a coin never burns itself on its losing path). Where the rest goes
 * when the rule ends without this coin winning, one sentence each:
 *
 *   coin      the rest goes to another live coin's burn (the picker over GET /sinks); end.rs falls to $DEFICIT when that coin is not live
 *   deficit   the rest goes to $DEFICIT's burn (the default)
 *   burn-sol  the rest is sent to Solana's incinerator; shown only when the launch state says the round-5 program has that sink
 *             (launchAvailability.ts burnSol, absent today, so hidden)
 *
 * "The rest burns this coin" is never a choice for that path. It stays only on the winning path, and only where the rule has one: a
 * champion-path team coin whose team wins the title (`winning`). A settled or linked pair keeps the pair winner and shows no choice.
 */
export type EndChoiceKind = "deficit" | "coin" | "burn-sol";
export interface EndChoice { kind: EndChoiceKind; mint?: string; ticker?: string }
export const END_CHOICE_DEFAULT: EndChoice = { kind: "deficit" };
export const END_CHOICE_LABEL = "Where the rest goes if this coin does not win";
export const END_CHOICE_LINES = {
  self: "The rest burns this coin.",
  coin: "The rest goes to another coin's burn.",
  deficit: "The rest goes to $DEFICIT's burn.",
  burnSol: "The rest is sent to Solana's incinerator, which nothing can spend from.",
} as const;
/** Why "the rest burns this coin" is not offered for the losing path (said once beside the choices). */
export const SELF_ON_LOSS_LINE = "A coin does not burn itself when it loses or its rule ends without firing: the rest leaves this coin then.";
export const SINK_PICKER_LABEL = "Pick a coin";
export const SINK_SEARCH_PLACEHOLDER = "Search by ticker, name or rule";
export const SINK_NONE_LINE = "No other live coin on this network can take the rest yet, so it goes to $DEFICIT's burn.";
export const SINK_NO_MATCH_LINE = "No live coin matches that search.";
/** The picked coin, in a sentence, with end.rs's fall-through. */
export const pickedSinkLine = (ticker: string): string => `The rest goes to $${ticker}'s burn; if $${ticker} is not live then, to $DEFICIT's burn.`;
export interface EndChoiceModel { offered: boolean; winning: string | null; options: { kind: EndChoiceKind; line: string }[] }
/**
 * What the end choice shows for `rule` (with its onEnd, or the default end): offered for a coin whose sink is $DEFICIT or a named coin and
 * that can end; never for a winner-takes-the-burn pair (the pair winner), a league-mode coin, a fixed-token rule or a coin with no end.
 */
export function endChoiceModel(rule0: BurnRule, o: { burnSol?: boolean; sinkPicker?: boolean; team?: string | null } = {}): EndChoiceModel {
  // a rule sent without onEnd gets the default end (the $DEFICIT sink) from the server (handlers.ts defaultOnEndFor); a league-mode rule does not
  const rule = rule0.onEnd || rule0.set ? rule0 : ({ ...rule0, onEnd: { windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true } } as BurnRule);
  const sink = describeEndSink(rule);
  // website-26 (WIRING-END-SINKS): a rule already on the incinerator end keeps the choice on screen, so the creator can pick again
  const offered = (sink === "flagship" || sink === "mint" || sink === "incinerator") && !rule.set && windowKindOf(rule) !== "perpetual";
  if (!offered) return { offered: false, winning: null, options: [] };
  const winning = championPathRule(rule) ? `If ${o.team ?? "the team"} win the championship, the rest burns this coin.` : null;
  return {
    offered, winning,
    options: [
      // owner decision 2026-10-13 evening: the "another coin" choice is hidden unless the host exposes it (BURNTICKER_END_SINK_PICKER=1)
      ...(o.sinkPicker ? [{ kind: "coin" as const, line: END_CHOICE_LINES.coin }] : []),
      { kind: "deficit", line: END_CHOICE_LINES.deficit },
      ...(o.burnSol ? [{ kind: "burn-sol" as const, line: END_CHOICE_LINES.burnSol }] : []),
    ],
  };
}
/** The choice a rule already carries (a draft read back). */
export const endChoiceOf = (rule: BurnRule | null): EndChoice => (rule?.onEnd?.mint && rule.onEnd.ticker ? { kind: "coin", mint: rule.onEnd.mint, ticker: rule.onEnd.ticker } : rule?.onEnd?.endSink === "incinerator" ? { kind: "burn-sol" } : END_CHOICE_DEFAULT);
/**
 * The rule with the choice applied. Only where endChoiceModel offers it; any other rule comes back unchanged. "coin" without a picked coin
 * is $DEFICIT until one is picked. "burn-sol" sets `endSink: "incinerator"` on the end (round 5; rules.ts END SINKS), keeping windDownDays
 * and sweepThresholdLamports; the review refuses it with INCINERATOR_WAITING on a host whose program is older.
 */
export function withEndChoice(rule: BurnRule, c: EndChoice): BurnRule {
  if (!endChoiceModel(rule, { burnSol: true }).offered) return rule;
  const base = rule.onEnd ?? { windDownDays: 28, sweepThresholdLamports: 50_000_000 };
  const { mint: _m, ticker: _t, ...rest } = base as typeof base & { mint?: string; ticker?: string; burnSol?: true };
  delete (rest as { burnSol?: true }).burnSol;
  const onEnd = c.kind === "coin" && c.mint && c.ticker ? { ...rest, endSink: true as const, mint: c.mint, ticker: c.ticker } : c.kind === "burn-sol" ? { ...rest, endSink: "incinerator" as const } : { ...rest, endSink: true as const };
  return { ...rule, onEnd } as BurnRule;
}

/**
 * A ONE-SHOT BEFORE GRADUATION (walkthrough snag 11). What the keeper does: a result recorded before the coin graduates stays queued, the
 * burn runs once the coin's pool exists and is registered, and only then is the end recorded (endSinkKeeper.ts waits while results are
 * still queued), so the rest goes to $DEFICIT after that burn.
 */
export function beforeGraduationLine(when: string | null, rule?: BurnRule | null, linked?: "game" | "candidates" | "pair" | null): string {
  return `${when ? `This result is due around ${when}. ` : ""}A coin burns only after it graduates. If the result comes first, it is recorded, and the burn waits until the coin graduates and its pool is registered. ${afterGraduationEnd(rule ?? null, linked ?? null)}`;
}
/**
 * PRIVATE REVIEW 9 F2 / AUDIT 12 item 4 (2026-10-13): where the rest goes once that waiting burn has run, from the rule's own pinned end
 * sink (the same model as the review's "When it ends"), never "$DEFICIT" for every one-shot. A linked pair says each case: one side wins,
 * a draw or neither, a void. A coin with no rule passed keeps the plain $DEFICIT sentence.
 */
export function afterGraduationEnd(rule: BurnRule | null, linked: "game" | "candidates" | "pair" | null = null): string {
  // `linked` names the pair shape when the page holds side A before the bundle adds its pair field (the review's prepared rule has it)
  const sink = linked && rule?.onEnd?.endSink === true ? "pair-winner" : rule ? describeEndSink(rule) : "flagship";
  const shape = linked ?? (rule?.pair ? ((rule.pair as { game?: unknown }).game ? "game" : (rule.pair as { race?: unknown }).race ? "candidates" : "pair") : null);
  if (sink === "pair-winner") {
    if (shape === "game") return "Then the losing team's coin's pool goes to the winning team's coin's burn. After a draw, both pools go to $DEFICIT's burn. A cancelled game moves nothing between the two coins, and each burns down what is left on itself.";
    if (shape === "candidates") return "Then the losing candidate's coin's pool goes to the winning candidate's coin's burn. If neither candidate wins, both pools go to $DEFICIT's burn. A voided market moves nothing between the two coins, and each burns down what is left on itself.";
    return "Then the other coin's pool goes to the burn of the coin whose rule fired. A void moves nothing between the two coins, and each burns down what is left on itself.";
  }
  if (sink === "mint" && rule) return `Then the rest of the pool goes to ${sinkTickerOf(rule)}'s burn, or ${namedSinkFallback(sinkTickerOf(rule))}. A voided result moves nothing, and the coin burns down what is left on itself.`;
  if (sink === "incinerator") return `Then the SOL left in the pool is sent to ${INCINERATOR_WORDS}. A voided result moves nothing, and the coin burns down what is left on itself.`;
  if (sink === null && rule) return "Then the coin burns down what is left on itself and retires.";
  return `Then the rest of the pool goes to $DEFICIT's burn.${rule ? " A voided result moves nothing, and the coin burns down what is left on itself." : ""}`;
}

/**
 * GRADUATION, EXPLAINED ONCE (owner, 2026-10-12: "the launch page should also explain what graduation means"). The review screen and the
 * templates page show these sentences; the numbers come from the launch constants the caller passes (raisePresets.ts, fees.ts).
 */
export function graduationExplainer(o: { raises: readonly string[]; curveFeePct: string; curveBurnPoolPct: string; poolFeePct: string }): string[] {
  const r = o.raises.map((x) => `${x}`), list = `${r.slice(0, -1).join(", ")} or ${r[r.length - 1]} SOL`;
  return [
    "Graduation: a new coin starts on a bonding curve. When buyers have put in the raise you pick, the curve closes, the SOL and the coin move into a Raydium pool whose liquidity is locked forever, and the burn pool starts spending.",
    "Until then the coin trades on the curve and its burn pool collects fees but does not burn. A smaller raise graduates sooner with a thinner pool; a larger raise graduates later with a deeper one.",
    `The raise is ${list}. On the curve each trade pays ${o.curveFeePct} in fees, ${o.curveBurnPoolPct} of it to the coin's burn pool. In the Raydium pool each trade pays ${o.poolFeePct}.`,
  ];
}
export const GRADUATION_LABEL = "What graduation means";

/**
 * A TWO-COIN MATCHUP IN FOUR FACTS, FROM THE RULES (ChatGPT launch-intent audit item 3: the inverted season Matchup said "do not lose" on
 * the cards and "lose" in every fact). Each coin's own rule decides (its one-liner from describe.ts); the fade side is said with the keeper's
 * real semantics (gameSettle.ts sportsSettled, units.ts): a game day counts only when its game has a settled result; under the fade side a
 * win or a tie burns the coin and a loss does not; a postponed, cancelled or unsettled game counts for neither; two games on one day count
 * once. Two separate launches: no SOL moves between them.
 */
export function matchupFacts(o: { a: string; b: string; oneLinerA: string; oneLinerB: string; inverse: boolean; once: boolean; teamA: string; teamB: string; tie: "tie" | "draw" }): { kind: "independent"; trigger: string; burned: string; pays: string; moves: string; example: string } {
  const A = `$${o.a || "A"}`, B = `$${o.b || "B"}`;
  const trigger = `These are two separate coins with their own rules. ${A} ${o.oneLinerA.replace(/\.$/, "")}, and ${B} ${o.oneLinerB.replace(/\.$/, "")}.`;
  const rules = o.inverse
    ? `A game day counts only when its game has a settled result. A win or a ${o.tie} burns that team's coin, and a loss does not. A postponed, cancelled or unsettled game counts for neither coin, and two games on one day count once.`
    : o.once
      ? `When the game is final, the coin of the team that lost burns once. A ${o.tie} burns neither coin, and a postponed or cancelled game burns nothing.`
      : `A game counts only when it has a settled result. A loss burns that team's coin. A win or a ${o.tie} burns nothing, and a postponed or cancelled game counts for neither coin.`;
  const example = o.inverse
    ? `For example, on a day ${teamRefByName(o.teamA)} win, ${A} spends its share of its own burn pool and the tokens it buys are burned. ${B} burns that day too if ${teamRefByName(o.teamB)} also played and did not lose.`
    : `For example, if ${teamRefByName(o.teamA)} lose, ${A} spends its share of its own burn pool, the ${A} tokens it buys are burned, and ${B} does nothing for that game.`;
  return { kind: "independent", trigger, burned: `The coin whose rule fires is bought and burned. ${rules}`, pays: "Each coin pays from its own burn pool.", moves: "No SOL moves between the two coins, because they are separate launches.", example };
}

/**
 * Two candidates of one race (owner 2026-10-13: a linked pair, the only form): the four facts, said for the two coins. The race counts once,
 * when both markets are final; the winner's coin burns its own pool and takes the loser's pool at the end; no single winner sends both
 * pools to $DEFICIT's burn.
 */
export function candidateFacts(o: { a: string; b: string; candA: string; candB: string }): { kind: "winner-takes-the-burn"; trigger: string; burned: string; pays: string; moves: string; example: string } {
  const A = `$${o.a || "A"}`, B = `$${o.b || "B"}`;
  return {
    kind: "winner-takes-the-burn",
    trigger: `${A} follows the market for ${o.candA}, and ${B} the market for ${o.candB}. The race counts once, when both markets are final.`,
    burned: "Only the winning candidate's coin is burned. The other coin's supply is untouched.",
    pays: "The winning coin spends its whole burn pool on itself. The other coin's pool goes to the winning coin's burn at the end.",
    moves: `SOL moves from the losing coin's burn pool to the winning coin's. If neither candidate wins, or a market settles 50-50, nothing moves between them and both pools go to $DEFICIT's burn. Nothing is paid to holders.`,
    example: `For example, if ${o.candA} wins, ${A} burns its own pool on itself, and ${B}'s pool goes to ${A}'s burn too.`,
  };
}
/** Two teams in one game (2026-10-13: a linked pair by default): the four facts, said for the two coins. */
export function gamePairFacts(o: { a: string; b: string; teamA: string; teamB: string; tie: "tie" | "draw" }): { kind: "winner-takes-the-burn"; trigger: string; burned: string; pays: string; moves: string; example: string } {
  const A = `$${o.a || "A"}`, B = `$${o.b || "B"}`;
  return {
    kind: "winner-takes-the-burn",
    trigger: `${A} follows ${teamRefByName(o.teamA)} and ${B} follows ${teamRefByName(o.teamB)} in one game. The game counts once, when its result is final.`,
    burned: "Only the winning team's coin is burned. The other coin's supply is untouched.",
    pays: "The winning coin spends its whole burn pool on itself. The losing coin's pool goes to the winning coin's burn at the end.",
    moves: `SOL moves from the losing coin's burn pool to the winning coin's. After a ${o.tie}, nothing moves between them and both pools go to $DEFICIT's burn. A postponed game keeps both coins waiting, and a cancelled one moves nothing. Nothing is paid to holders.`,
    example: `For example, if ${teamRefByName(o.teamA)} win, ${A} burns its own pool on itself, and ${B}'s pool goes to ${A}'s burn too.`,
  };
}

/**
 * A RIVALRY PAIR OF TWO TEAMS (owner, 2026-10-12, live walkthrough of publish 18: "trying to set up a rivalry pair but the only options
 * were games, not 2 teams"). Step 2 picks a league, then any two of its teams (the second list leaves out the first), then one game or
 * the season. The season pair is two separate coins, each burning when its own team loses, for the season including the postseason
 * (the same window as a team coin); one game needs a listed meeting between them.
 */
export const otherTeams = <T extends { abbr: string }>(teams: readonly T[], first: string | null): T[] => teams.filter((t) => t.abbr !== first);
/** The next listed game between the two teams (either home or away), or null. */
export function meetingOf<G extends { expectedAt?: string | null; pair: { a: { abbr: string }; b: { abbr: string } } | null }>(games: readonly G[], a: string, b: string): G | null {
  const hits = games.filter((g) => g.pair && ((g.pair.a.abbr === a && g.pair.b.abbr === b) || (g.pair.a.abbr === b && g.pair.b.abbr === a)));
  return hits.sort((x, y) => Date.parse(x.expectedAt ?? "") - Date.parse(y.expectedAt ?? ""))[0] ?? null;
}
/** The two season rules of a rivalry pair: each coin burns when its own team loses, this season including the postseason. */
export function seasonPairRules(league: LeagueId, a: string, b: string, year: number, fraction = DEFAULT_SHARE.recurring): { a: BurnRule; b: BurnRule } {
  const w = { kind: "season" as const, year };
  return { a: firstPartyRule(teamSeries(league, a, "loss", w), fraction), b: firstPartyRule(teamSeries(league, b, "loss", w), fraction) };
}

/**
 * A ONE-GAME PAIR (2026-10-13: linked by default): side A's rule is its own team's win in the game (100 %, the one-shot default; the
 * end sink on), and the bundle body's pair names the other team (`pair.opp`), whose coin reads the same game's win series of that team
 * (rules.ts gameMirrorId). The bundle route builds both sides (launchBundle.ts buildPairBundles `game`).
 */
export function gamePairRule(league: LeagueId, eventId: string, a: string, fraction: number = DEFAULT_SHARE.oneShot): BurnRule {
  return { ...firstPartyRule(gameSeries(league, eventId, a, "win"), fraction), onEnd: { ...MEETINGS_ON_END } };
}
/** A candidates pair's side A rule: candidate A's market, YES only, 100 % by default, the end sink on (the body's pair names B's market and the race). */
export function candidatesPairRule(conditionId: string, fraction: number = DEFAULT_SHARE.oneShot): BurnRule {
  return { schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: conditionId.toLowerCase(), filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: fraction }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, onEnd: { ...MEETINGS_ON_END } } as BurnRule;
}

// ---- generated tickers and names (owner, 2026-10-12: "two teamwifs") ----

const code = (s: string, max = 4): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, max);
/** Tickers are upper case on every surface (the registry and the program's memo prefix), so the matchup's "v" is a V. */
export function pairTickers(a: string, b: string): { a: string; b: string } {
  const A = code(a), B = code(b);
  return { a: `${A}V${B}`.slice(0, 10), b: `${B}V${A}`.slice(0, 10) };
}
/** The on-chain name carries the matchup: "WIF vs BONK, WIF side" (at most 32 characters). */
export function pairNames(a: string, b: string, codes: { a?: string | null; b?: string | null } = {}): { a: string; b: string } {
  // audit 7 item 8: never cut mid-word ("Guardians vs Rays, Guardians sid"): the full form, then the shorter "Guardians vs Rays".
  // QA pass 9 #15: never a cut team name either ("Leeds United vs Manchester"): a complete shorter name instead, from the team's common
  // short form ("Man United"), then the other team's code ("Leeds United vs MUN"), then both codes; only then whole words up to 32 bytes
  const bytes = (x: string) => new TextEncoder().encode(x).length;
  const full = { a: `${a} vs ${b}, ${a} side`, b: `${b} vs ${a}, ${b} side` };
  if (bytes(full.a) <= 32 && bytes(full.b) <= 32) return full;   // both sides take the same form
  const sa = shortTeamName(a), sb = shortTeamName(b), ca = codes.a ?? null, cb = codes.b ?? null;
  const side = (x: string, sx: string, cx: string | null, y: string, sy: string, cy: string | null) => fitName([`${x} vs ${y}`, `${sx} vs ${sy}`, `${x} vs ${sy}`, ...(cy ? [`${x} vs ${cy}`, `${sx} vs ${cy}`] : []), ...(cx && cy ? [`${cx} vs ${cy}`] : []), sx]);
  return { a: side(a, sa, ca, b, sb, cb), b: side(b, sb, cb, a, sa, ca) };
}
/** The short form people use for a long club name ("Manchester United" → "Man United", "Wolverhampton Wanderers" → "Wolves"); else the name. */
export function shortTeamName(n: string): string {
  const known: Record<string, string> = { "Wolverhampton Wanderers": "Wolves", "Brighton & Hove Albion": "Brighton", "Brighton and Hove Albion": "Brighton", "Tottenham Hotspur": "Spurs", "Nottingham Forest": "Forest", "Heart of Midlothian": "Hearts", "Borussia Mönchengladbach": "Gladbach", "Paris Saint-Germain": "PSG" };
  return known[n] ?? n.replace(/^Manchester /, "Man ");
}
/**
 * A team coin's ticker: ONE generator for the wizard, /v1/search and /v1/sports/teams (tickers.ts; ChatGPT audit 6 item 6). $LAD (the
 * season's wins), $LADL (its losses), $LADPO (the postseason), $LADNEXT5 (the next five games), $LADALL (every season), $LADNOWIN (the
 * fade side), $LADWS (the title, once); a code several leagues use carries the league's tag ($ATLMLB, $ATLNBA).
 */
export { teamTicker } from "@/lib/burnticker/tickers";
import { teamTicker } from "@/lib/burnticker/tickers";
/** The team ticker for a rule built from an ESPN team or game series (null for any other rule). */
export function teamTickerForRule(r: BurnRule, abbr?: string | null): string | null {
  const e = r.oracle === "catalogue" && r.series ? parseEspnSeries(r.series) : null;
  if (!e) return null;
  if (e.kind !== "team") return teamTicker(abbr ?? e.abbr, { league: e.league, window: "game", outcome: e.outcome, inverse: !!r.inverse });
  if (e.window.kind === "meetings") return meetingsTicker(abbr ?? e.abbr, e.window.opp, abbr ? null : e.league);
  const w = e.window, window = w.kind === "legacy" ? (w.scope === "post" ? "post" : "season") : w.kind;
  return teamTicker(abbr ?? e.abbr, { league: e.league, window, games: w.kind === "next" ? w.n : null, outcome: e.outcome, inverse: !!r.inverse });
}

/** Two sides of a new pair that a reader could not tell apart (ChatGPT launch-intent audit item 5): same ticker or same name, any case or spacing. */
export function pairIdentityProblems(a: { ticker: string; name: string }, b: { ticker: string; name: string }): string[] {
  const n = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const out: string[] = [];
  if (n(a.ticker) && n(a.ticker) === n(b.ticker)) out.push("The two coins need different tickers.");
  if (n(a.name) && n(a.name) === n(b.name)) out.push("The two coins need different names.");
  return out;
}

/** Audit 3 item 102: the note's label and its help text, tied to the field (ReviewCard.tsx). */
export const NOTE_LABEL = "A note from you";
export const NOTE_HELP = "Optional. It shows in its own box on the coin's page, up to 140 characters, with no links and no claims of endorsement.";
/** Audit 3 item 105: the description and the note, told apart where both are chosen. */
export const NOTE_VS_DESCRIPTION = "The description follows the rule sentence on the coin's page and is pinned with the coin, up to 280 characters. The note is one short line in its own box, up to 140 characters, with no links.";

// ---- the rivalry panel (website-20 items 151 to 160, audit 7 items 7 to 9) ----

/** Every listed game between the two teams, soonest first (item 156: the creator picks the exact meeting). */
export function meetingsOf<G extends { expectedAt?: string | null; pair: { a: { abbr: string }; b: { abbr: string } } | null }>(games: readonly G[], a: string, b: string): G[] {
  return games.filter((g) => g.pair && ((g.pair.a.abbr === a && g.pair.b.abbr === b) || (g.pair.a.abbr === b && g.pair.b.abbr === a))).sort((x, y) => Date.parse(x.expectedAt ?? "") - Date.parse(y.expectedAt ?? ""));
}
/** Item 158 and audit 7 item 9: the two choices say before the tap what each coin follows. */
export const RIVALRY_GAME_LABEL = "One game between them";
export const RIVALRY_GAME_LINE = "A linked pair. Pick the game. When it is final, the winning team's coin burns its own pool and takes the losing team's coin's pool at the end.";
export const RIVALRY_SEASON_LABEL = "Every loss this season";
export const RIVALRY_SEASON_LINE = "Each coin burns every time its own team loses any game this season, through the postseason, not only the games between these two.";
/** QA pass 9 #19: "through the postseason" only for a league that has one (European soccer leagues and the UEFA cups do not). */
export const rivalrySeasonLine = (league: LeagueId | null): string => (league && noPlayoffs(league) ? "Each coin burns every time its own team loses any match this season, not only the matches between these two." : RIVALRY_SEASON_LINE);
export const RIVALRY_SCOPE_LINE = "One game and every game between them are linked pairs, so SOL moves to the winning coin's burn. Every loss this season makes two separate coins, one for each team, and no SOL moves between them.";
/** Item 154: a failed schedule read is never "no listed game". */
export const SCHEDULE_UNAVAILABLE_LINE = "The schedule could not be read just now, so their games are not shown.";
export const NO_LISTED_MEETING_LINE = "The schedule lists no game between them right now.";
/**
 * QA pass 9 #4 (2026-10-13): the one-game option lists EVERY game between the two teams that the league's schedule lists for the season and
 * that is still to be played (GET /v1/sports/rivalry `meetings[].oneGame`), not only the next eight days, and says what was searched.
 */
export function oneGameSearchLine(season: string, n: number, playoffs: boolean): string {
  const where = `the league's schedule for the ${season} season${playoffs ? ", playoffs included" : ""}`;
  return n > 1 ? `Searched ${where}. It lists ${n} games between them still to be played. Pick the one the coins follow.`
    : n === 1 ? `Searched ${where}. It lists one game between them still to be played.`
    : `Searched ${where}. It lists no game between them still to be played.`;
}
/** QA pass 9 #28: college football lists the FBS by default; the rest of the list is one choice away. */
export const FBS_DEFAULT_LINE = (fbs: number, others: number): string => `Showing the ${fbs} FBS programs, in alphabetical order. ${others} more teams from the FCS and other divisions are listed under Show all divisions.`;
/** Item 157: what the list covers. */
export const scheduleCoverageLine = (n: number): string => (n > 1 ? `The league's schedule lists ${n} games between them from today on. Pick the one the coins follow.` : n === 1 ? "The league's schedule lists one game between them from today on." : "Only games the league's schedule lists from today on can be picked.");
/**
 * THE THIRD RIVALRY OPTION (owner 2026-10-12: "sixers vs celtics as a pair ... burn schedule based on their head-to-head games ... leftover
 * fees burning the season series winner"): every game between the two teams this season, regular season and postseason, as a linked pair
 * (sources/espn.ts window `meetings`). Step 3 offers only "Winner takes the burn"; step 4 says the rest goes to the series winner. What
 * moves is the program's (pair.rs forward_to_winner per game; end.rs forward_on_end to the pair winner of the season-end result).
 */
export const RIVALRY_SERIES_LABEL = "Every game between them this season";
export const RIVALRY_SERIES_LINE = "A linked pair. Each game between them burns the coin of the team that won it, and at the end of the season the rest goes to the team that won more of them.";
export const MEETINGS_WINNER_LINE = "After each game between the two teams, the coin of the team that won spends its own share and the other coin's share for that game, both burning the winning coin. A draw moves nothing.";
export const MEETINGS_END_LABEL = "The rest goes to the series winner";
export const MEETINGS_END_LINE = "When both seasons are over, the coin of the team that won fewer of their games sends what is left to the other coin's burn. If they won the same number, nothing moves and each coin burns down what is left on itself.";
export const MEETINGS_NONE_LINE = "The league's schedule lists no game between these two teams this season, so this option is not offered for them.";
/** rules.ts DEFAULT_ON_END, copied (rules.ts is not client-safe); test/burntickerRivalrySeriesReview.test.ts pins the two equal. */
export const MEETINGS_ON_END = { windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true } as const;
/** The two rules of a rivalry series pair: side A on its team's series, side B on the mirror; both end on the pair-winner sink. */
export function meetingsPairRules(league: LeagueId, a: string, b: string, year: number, fraction: number = DEFAULT_SHARE.recurring): { a: BurnRule; b: BurnRule } {
  const s = meetingsPairSeries(league, a, b, year);
  return { a: { ...firstPartyRule(s.a, fraction), onEnd: { ...MEETINGS_ON_END } }, b: { ...firstPartyRule(s.b, fraction), onEnd: { ...MEETINGS_ON_END } } };
}
/** The pair's names and tickers: "76ers vs Celtics" and "Celtics vs 76ers", $PHIVBOS and $BOSVPHI (tickers are upper case everywhere). */
export function meetingsPairNames(a: { abbr: string; code?: string | null; nickname: string | null; name: string }, b: { abbr: string; code?: string | null; nickname: string | null; name: string }): { a: { name: string; ticker: string }; b: { name: string; ticker: string } } {
  const n = pairNames(a.nickname ?? a.name, b.nickname ?? b.name, { a: a.code ?? a.abbr, b: b.code ?? b.abbr }), t = pairTickers(a.code ?? a.abbr, b.code ?? b.abbr);
  return { a: { name: n.a, ticker: t.a }, b: { name: n.b, ticker: t.b } };
}
/**
 * website-21 (WIRING-RIVALRY-SERIES "gaps"): the pair's both-or-neither deadline (launchBundle.ts defaultVoidBy, 30 days after launch),
 * said once on the review beside the end.
 */
export const MEETINGS_DEADLINE_LINE = "Both coins have 30 days from launch to graduate and register their trading pools. If either one does not, the pair is void and each coin burns down what is left on its own pool.";
/** The pair page of a rivalry series pair (tokenPage.ts, /burnticker/p): two series, one per team, never one shared market. */
export const MEETINGS_PAIR_PAGE_LINE = "Each coin reads its own team's games against the other team. Each game burns the coin of the team that won it.";
/** Whether a pair's selector is a rivalry series (sources/espn.ts window `meetings`); client-safe, unlike rules.ts isMeetingsRule. */
export const isMeetingsSelector = (key: string | null | undefined): boolean => { if (!key) return false; const e = parseEspnSeries(key.split(":").slice(0, 2).join(":")); return e?.kind === "team" && e.window.kind === "meetings"; };
/**
 * Step 3's preview and the review's rule sentence for a rivalry series pair: both coins' one-liners (describe.ts, "burns when the 76ers
 * beat the Celtics"), then what each game between them moves (pairFundsFlow.ts meetingsFundsFlow, said with the chosen share).
 */
export const meetingsPairSentence = (o: { a: string; b: string; oneA: string; oneB: string; share: string }): string =>
  `$${o.a} ${o.oneA}, and $${o.b} ${o.oneB}. After each game between them, the coin of the team that won spends ${o.share} of its own burn pool, and the other coin sends ${o.share} of its pool to the winning coin's burn.`;
/** The review's "Which coin burns" fact for a rivalry series pair: the winning team's coin, which also takes the other coin's share. */
export const meetingsWhichCoinLine = (o: { a: string; b: string; teamA: string; teamB: string }): string =>
  `$${o.a} when ${teamRefByName(o.teamA)} win a game between them, and $${o.b} when ${teamRefByName(o.teamB)} win one. The winning coin also takes the other coin's share for that game.`;
/** Step 2: the heading of the meetings list under the third rivalry option. */
export const MEETINGS_LIST_LABEL = "Their games this season";
/** One game between the two teams as GET /v1/sports/rivalry lists it (`result` is from team a's side). */
export interface MeetingRow { eventId: string; startsAt: string; date?: string; playoff: boolean; home: string; away: string; status: string; result: string; /** QA pass 9 #35 */ live?: boolean; /** QA pass 9 #4: a game still to be played, as a one-game pair (aHome from the fixture, QA pass 9 #2) */ oneGame?: { aHome: boolean; series: { aLoss: string; bLoss: string } } | null }
/**
 * The meetings list (step 2): soonest first, each with where it is played from the first team's side ("vs BOS" at home, "at BOS" away),
 * whether it is a playoff game, and its state once it is not just scheduled ("PHI won", "BOS won", "draw", "in progress", "postponed or
 * cancelled").
 */
export function meetingsListRows(ms: readonly MeetingRow[], a: string, b: string): { key: string; startsAt: string; where: string; playoff: boolean; state: string | null }[] {
  return [...ms].sort((x, y) => x.startsAt.localeCompare(y.startsAt)).map((m) => ({
    key: m.eventId, startsAt: m.startsAt, where: m.home === a ? `vs ${b}` : `at ${b}`, playoff: !!m.playoff,
    state: m.result === "win" ? `${a} won` : m.result === "loss" ? `${b} won` : m.result === "draw" ? "draw" : m.result === "void" || m.status === "postponed or cancelled" ? "postponed or cancelled" : m.status === "in progress" || m.live ? LIVE_NOW : null,
  }));
}

/** Item 155: a cleared second team is said once. */
export const RIVAL_SAME_TEAM = "The second team was cleared, because it is now the first team. Pick another second team.";
/** Audit 7 item 9: season coins are named for what they count ("Guardians 2026 Losses", $CLEL). */
export function seasonPairNames(a: { abbr: string; nickname: string | null; name: string }, b: { abbr: string; nickname: string | null; name: string }, year: number, league: string | null): { a: { name: string; ticker: string }; b: { name: string; ticker: string } } {
  const one = (t: typeof a & { code?: string | null }) => ({ name: fitName([`${t.nickname ?? t.name} ${year} Losses`, `${shortTeamName(t.nickname ?? t.name)} ${year} Losses`, `${t.code ?? t.abbr} ${year} Losses`]), ticker: teamTicker(t.abbr, { league, window: "season", outcome: "loss" }) });
  return { a: one(a), b: one(b) };
}

// ---- Your coins (audit 3 items 103 and 137) ----
export const LOOKUP_LABEL = "A creator's Solana wallet address";
/** Why an entered address is not a creator wallet address, or null when it reads as one (base58, 32 to 44 characters). */
export function walletAddressProblem(v: string): string | null {
  if (!v) return "Enter a creator's wallet address to look it up.";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return null;
  return "That is not a wallet address. Enter a creator's Solana wallet address: 32 to 44 letters and digits, without 0, O, I or a lower-case l.";
}
export const DRAFT_ROUTE_LINE = "Continue a draft, or start a new coin on the launch page";

// ---- website-22 (QA pass 9 and audit 10, 2026-10-13) ----

/**
 * Audit 10 item 1: the event card's outcome follows the side the rule burns on. A market coin switched to "If it resolves NO" says the NO
 * outcome, never the YES label it was picked with.
 */
export function eventForSide<T extends { outcome: string | null }>(ev: T | null, rule: Pick<BurnRule, "kind" | "binary"> | null, labels: { yes?: string | null; no?: string | null } = {}): T | null {
  if (!ev || !rule || rule.kind !== "binary") return ev;
  const no = !rule.binary?.onYes && !!rule.binary?.onNo;
  return { ...ev, outcome: no ? `“${labels.no ?? "No"}”` : labels.yes ? `“${labels.yes}”` : ev.outcome };
}

/** What the page picked in step 2, as the review reads it (a Kalshi or Polymarket market, a catalogue series and its source's unit). */
export interface PickLike { oracle: "kalshi" | "catalogue" | "polymarket"; series: string | null; market: string | null; source?: { unit: { label: string } | null } | null }
/**
 * Audit 10 item 2: whether the step-2 pick still describes the rule on screen. A pick left over from another path (a market searched, then
 * a team chosen) never lends its unit, title or source to the active rule.
 */
export function pickDescribesRule(rule: Pick<BurnRule, "oracle" | "series" | "market"> | null, pick: PickLike | null): boolean {
  if (!rule || !pick || pick.oracle !== rule.oracle) return false;
  if (rule.market || pick.market) return (rule.market ?? null) === (pick.market ?? null);
  return !!pick.series && pick.series === rule.series;
}
/** The unit the ACTIVE rule counts, for the budget row: the picked source's unit only while that pick is the rule's own scalar source. */
export function activeUnit(rule: Pick<BurnRule, "oracle" | "series" | "market" | "kind"> | null, pick: PickLike | null): { label: string } | null {
  return rule && rule.kind === "scalar" && pickDescribesRule(rule, pick) ? pick!.source?.unit ?? null : null;
}

/**
 * Audit 10 item 6: a warning that names a coin is stored with placeholders and rendered with the tickers on screen, so a renamed coin is
 * never warned about under its old ticker.
 */
export const WARN_A = "{A}", WARN_B = "{B}";
export const renderWarnings = (ws: readonly string[], a: string, b: string): string[] => ws.map((w) => w.split(WARN_A).join(a || "A").split(WARN_B).join(b || "B"));
/**
 * sources-6 (audit 10 #5): the server's candidate-to-market sentence ("$ROGERS is named for Mike Rogers, but it settles on …"), with its
 * leading ticker as a placeholder so a renamed coin is named as it is now.
 */
export const mappingWarning = (mapping: string, side: "A" | "B" = "A"): string => mapping.replace(/^\$[A-Z0-9]+\b/, `$${side === "A" ? WARN_A : WARN_B}`);
/** The party-market warning (snag 8), with the coin's ticker as a placeholder (when the server sends no mapping). */
export const partyMarketWarning = (question: string, surname: string, side: "A" | "B" = "A"): string => `$${side === "A" ? WARN_A : WARN_B} settles on the market "${question}". That market is about the party's result, not ${surname} by name.`;

/**
 * Audit 10 item 7: the review's "What triggers the burn" fact, built from its parts, never cut at the first full stop (which broke on
 * "U.S."). `lead` is the sentence the rule is described with; the rest of the paragraph never enters the trigger.
 */
export function triggerText(o: { pair?: { a: string; b: string; oneA: string; oneB: string } | null; oneShot?: string | null; lead?: string | null; fallback: string }): string {
  if (o.pair) return `$${o.pair.a || "A"} ${o.pair.oneA.replace(/\.$/, "")}, and $${o.pair.b || "B"} ${o.pair.oneB.replace(/\.$/, "")}.`;
  if (o.oneShot) return o.oneShot;
  return (o.lead ?? "").trim() || o.fallback;
}

/**
 * Audit 10 item 22: the pattern words a one-time market reads with. Its "does not happen" side is its NO payout, once ("If it resolves
 * NO"), never "each day or reading".
 */
export const MARKET_YES_LABEL = "If it resolves YES";
export const MARKET_YES_SENTENCE = "The coin spends its share once, if the market settles YES.";

/** Audit 10 item 22: the progress strip's answer for a source: its own words, without a trailing note in brackets. */
export const whichAnswer = (title: string): string => title.replace(/\s*\([^()]{0,40}\)\s*$/, "").trim();

/**
 * QA 9 item 1: the pattern cards stay the same set while the creator moves between the forms of one subject (a natural disaster's
 * per-event count and its next-event one-shot). A pattern is offered when either form takes it; its words are the current form's, or the
 * other form's when only that one takes it. The order never changes, so a card never moves under a tap.
 */
export function stablePatternOptions(cur: readonly PatternOption[], other: readonly PatternOption[] | null): PatternOption[] {
  return cur.map((o) => { if (o.available || !other) return o; const x = other.find((y) => y.id === o.id); return x?.available ? { ...x } : o; });
}

/** QA 9 item 6: a team's line in the step-2 list, its parts joined with " · " only between parts (never a dangling dot). */
export const teamLine = (parts: readonly (string | null | undefined)[]): string => parts.filter((x): x is string => !!x && !!x.trim()).join(" · ");

/** QA 9 item 3 (owner): one game between two teams burns once, so its share follows the one-shot row whenever the rule's dial allows it. */
export const oneGameShare = (maxFraction: number): number => (maxFraction >= 1 ? DEFAULT_SHARE.oneShot : DEFAULT_SHARE.recurring);

/**
 * Audit 10 item 8: a coin's description is one paragraph on its page and in its metadata (launchFields.ts refuses line breaks there), so a
 * line break typed or pasted becomes a space, and the field says so where it happened.
 */
/** Carriage returns, line feeds, tabs and the Unicode line and paragraph separators (U+2028, U+2029). */
const LINE_BREAKS = new RegExp(`\\r\\n?|\\n|\\t|${String.fromCharCode(0x2028)}|${String.fromCharCode(0x2029)}`, "g");
export const DESCRIPTION_ONE_PARAGRAPH = "The description is one paragraph on the coin's page, so line breaks became spaces.";
export function oneParagraph(raw: string): { value: string; changed: boolean } {
  const value = raw.replace(LINE_BREAKS, " ");
  return { value, changed: value !== raw };
}

/** Audit 10 item 11: the words, links and note kept from the coin set up before a new choice in step 1, said once with two ways on. */
export const keptProfileLine = (parts: readonly string[]): string => `Your ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]} from the coin you were setting up ${parts.length > 1 ? "are" : "is"} still filled in.`;
export const KEPT_PROFILE_REUSE = "Reuse them";
export const KEPT_PROFILE_FRESH = "Start the profile fresh";
/** Which of a profile's words were kept ("description", "X link", "note"); empty when nothing was. */
export function keptProfileParts(p: { description: string; x: string; telegram: string; website: string }, note: string): string[] {
  const out: string[] = [];
  if (p.description.trim()) out.push("description");
  for (const [k, l] of [["x", "X link"], ["telegram", "Telegram link"], ["website", "website link"]] as const) if (p[k].trim()) out.push(l);
  if (note.trim()) out.push("note");
  return out;
}

/** Audit 10 item 12: the name step's disclosure names only the fields this coin can carry (a pair has no note). */
export const profileMoreLabel = (note: boolean): string => (note ? "Description, links and a note. Each one is optional." : "Description and links. Each one is optional.");

/** QA 9 item 14: the image line is confirmed on the name step, before the review. */
export const IMAGE_RIGHTS_REQUIRED = "Confirm that you have the right to use the image, or remove it, before you go on.";
/** QA 9 item 14: a picture that is not square is shown as its middle square; the outline shows that part. */
export const notSquareLine = (w: number, h: number): string => `This image is ${w} by ${h} pixels, so it is not square. The coin shows only the outlined middle square.`;
/** The crop a square frame takes of a w × h image, in percent of its width and height (the middle square). */
export function squareCrop(w: number, h: number): { left: number; top: number; width: number; height: number } {
  if (!(w > 0 && h > 0) || w === h) return { left: 0, top: 0, width: 100, height: 100 };
  if (w > h) { const width = (h / w) * 100; return { left: (100 - width) / 2, top: 0, width, height: 100 }; }
  const height = (w / h) * 100;
  return { left: 0, top: (100 - height) / 2, width: 100, height };
}

/**
 * Audit 10 item 3: how the coins launch, which decides the fee sentence on the review. "single" one LaunchLab coin; "independent" two
 * separate LaunchLab launches; "linked" two LaunchLab coins linked at creation; "pair-curve" a registered pair on the pair curve, whose
 * pools open with Raydium's creator fee off. `lp` and `pairLp` are the review card's LP_LINE and PAIR_LP_LINE (built from the fee
 * constants in feeShareLine.ts); no percentage is typed here.
 */
export type LaunchVenue = "single" | "independent" | "linked" | "pair-curve";
export function lpDisclosureFor(venue: LaunchVenue, lp: string, pairLp: string): string {
  if (venue === "pair-curve") return pairLp;
  if (venue === "independent") return `Each coin is its own LaunchLab launch with its own pool. For each one: ${lp}`;
  if (venue === "linked") return `The two coins are linked, and each one moves from LaunchLab to its own pool. For each one: ${lp}`;
  return lp;
}

/** The profile fields the checks read (ProfileFields.tsx ProfileValue has these and more). */
export interface ProfileChecked { image: unknown | null; rights: boolean; description: string; x: string; telegram: string; website: string; imageState?: "pending" | "failed" | null; /** sources-7 H2: the coin's generated rule paragraph (the review's coins[].description), so the Name step checks the room it leaves */ generated?: string | null }
/** The field a profile problem belongs to (the review's Edit link focuses it). */
export type ProfileField = "image" | "description" | "x" | "telegram" | "website";
/**
 * website-22 (QA 9 item 11, audit 10 item 8): every problem in these fields with the field it belongs to, using the server's own link
 * check (creatorProfile.ts linkProblem: https only, X on x.com or twitter.com, Telegram on t.me, no javascript: or data:) and the server's
 * check on invisible and text-direction characters (launchFields.ts controlCharProblem).
 */
export function profileFieldProblems(v: ProfileChecked): { field: ProfileField; text: string }[] {
  const out: { field: ProfileField; text: string }[] = [];
  const isp = imageStateProblem(v.imageState ?? null); if (isp) out.push({ field: "image", text: isp });
  if (v.image && !v.rights) out.push({ field: "image", text: "Confirm the image line, or remove the image." });
  if (v.description.length > DESCRIPTION_MAX) out.push({ field: "description", text: `The description can be at most ${DESCRIPTION_MAX} characters.` });
  { const rp = v.generated ? descriptionRoomProblem(v.generated, v.description) : null; if (rp) out.push({ field: "description", text: rp }); }
  const cc = controlCharProblem(v.description, "description"); if (cc) out.push({ field: "description", text: cc });
  for (const [k, label] of LINK_FIELDS) { const lp = linkFieldProblem(label, v[k]); if (lp) out.push({ field: k, text: lp }); }
  return out;
}
export const LINK_FIELDS = [["x", "X"], ["telegram", "Telegram"], ["website", "Website"]] as const;
/** One link field's problem, as the server says it (null when empty or fine). */
export const linkFieldProblem = (label: string, raw: string): string | null => (raw.trim() ? linkProblem(label, raw.trim()) : null);
/** The id of a profile field on the page (side "a" or "b"), so the review's Edit link can focus it. */

/** Audit 10 item 17: what the pair's estimate leaves out, beside "Launch both". */
export const PAIR_COST_EXCLUSIONS = "The estimate covers creating both coins. It leaves out the account that links the two coins, whose rent is not measured yet, and any fee your wallet adds.";

/** Audit 10 item 24: the share is a share of the coin's burn pool (its budget for burns), never of the coin's supply; said once on the review. */
export const shareOfBudgetLine = (share: number): string => `The burn pool is the coin's budget for burns, so ${pctLabel(share)} is never a share of the coin's supply.`;

/** Audit 10 item 24: the words beside the small pair diagram on the review. */
export const PAIR_DIAGRAM_LABEL = { independent: "Two separate coins. Each burns from its own pool, and no SOL moves between them.", linked: "A linked pair. The coin whose rule fires also takes the other coin's share for that result, and only that coin burns." } as const;
/**
 * Audit 12 item 4: the diagram's words from the pair's actual shape. A linked pair on one result moves the WHOLE pool (never "the share for
 * that result"); a linked pair that repeats moves the other coin's share for each result; two separate coins move nothing.
 */
export function pairDiagramLabel(rule: BurnRule | null, linked: boolean): string {
  if (!linked) return PAIR_DIAGRAM_LABEL.independent;
  return rule && dialsFor(rule).bounds.max >= 1 ? "A linked pair on one result. The coin whose rule fires burns its whole pool and takes the other coin's whole pool, and only that coin burns." : PAIR_DIAGRAM_LABEL.linked;
}

/**
 * Audit 10 item 10 and QA 9 item 12: every reason the launch button is off, in one list on the review. Each reason is said once.
 */
export function reviewBlockers(o: { fields?: string[]; profile?: string[]; note?: string | null; identity?: string[]; ruleProblems?: string[]; serverProblems?: string[]; blocked?: string | null }): string[] {
  const all = [...(o.fields ?? []), ...(o.profile ?? []), ...(o.note ? [o.note] : []), ...(o.identity ?? []), ...(o.ruleProblems ?? []), ...(o.serverProblems ?? []), ...(o.blocked ? [o.blocked] : [])];
  const seen = new Set<string>(), out: string[] = [];
  for (const x of all) { const k = x.trim().replace(/\.$/, "").toLowerCase(); if (k && !seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}
/** The note's quick local read (the server's lint is the one that counts), as a sentence beside the field and in the review's list. */
export function noteProblemOf(note: string): string | null {
  if (/https?:\/\/|www\.|\.(com|io|xyz|fun)\b/i.test(note)) return "The note cannot have links.";
  if (/\b(official|endorsed|partner(ed|ship)?|affiliated|backed|guaranteed|insured|audited|verified|licensed|sponsored)\b/i.test(withoutDenials(note))) return "The note cannot claim an affiliation or an endorsement.";
  return null;
}

/**
 * Audit 10 item 14 (one flow): the guided question a free-text card, a template or a deep link answers, read from the rule it builds, so
 * every entry walks the same five steps and the review never falls back to the older chooser.
 */
export function followForRule(r: Pick<BurnRule, "oracle" | "series" | "market"> | null, o: { matchup?: boolean; hazard?: boolean } = {}): FollowId {
  if (o.matchup) return "rivalry";
  if (!r) return "market";
  if (r.oracle === "derby") return "coins";
  if (r.oracle === "polymarket" || r.oracle === "kalshi") return r.market ? "market" : "number";
  if (r.oracle === "catalogue" && r.series && parseEspnSeries(r.series)) return "team";
  if (o.hazard) return "disaster";
  return "number";
}
