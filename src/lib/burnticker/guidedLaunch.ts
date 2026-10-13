import type { BurnRule } from "@/lib/burnticker/rules";
import { dialsFor } from "@/lib/burnticker/dials";
import { championPathRule, describeEndSink, endText, windowKindOf } from "@/lib/burnticker/describe";
import { CATALOGUE_ONE_SHOT_RE, inverseRefusal } from "@/lib/burnticker/inverse";
import { parseEspnSeries, teamSeries, type LeagueId } from "@/lib/burnticker/sources/espn";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { pctLabel, SHARE_PRESETS, DEFAULT_SHARE } from "@/lib/burnticker/launchPresets";

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
export function whichHeading(follow: FollowId | null, pairKind: "teams" | "candidates" | null = null): string {
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
  winner: { label: "Winner takes the burn", sentence: "Two coins are linked. When a result fires one coin's rule, the other coin's share for it moves to that coin's burn pool." },
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
  const tail = o.no ? `If ${o.subject} ${o.subject === "they" ? "do" : "does"}, the rest goes to $DEFICIT's burn. A voided market is not a NO.` : `If ${o.subject} ${o.subject === "they" ? "do" : "does"} not, the rest goes to $DEFICIT's burn.`;
  return [`This coin burns ${what} once, when Polymarket's payout says ${o.happened}.`, "The burn lands in slices sized to the pool's liquidity.", tail];
}

/** What blocks the launch while an image is being prepared, or after its preparation failed (intent audit 5 item 15). */
export const IMAGE_PENDING = "The image is still being prepared. Wait a moment, or remove it.";
export const IMAGE_FAILED = "The image could not be prepared. Choose it again, or remove it.";
export const imageStateProblem = (s: "pending" | "failed" | null): string | null => (s === "pending" ? IMAGE_PENDING : s === "failed" ? IMAGE_FAILED : null);

/** A saved draft keeps the words and links but never an image (intent audit 5 item 11). */
export const IMAGE_NOT_KEPT = "A saved draft does not keep an image. Add it again if you want one.";

/** A one-time market's fade side, said with its real cadence. */
export const MARKET_NO_SENTENCE = "The coin spends its share once, if the market settles NO. A voided market is not a NO.";

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
  teamsSeparate: "Two team coins launch as two separate coins, and each one burns from its own pool. Winner takes the burn is offered for a coin against another coin.",
  candidatesSeparate: "Two candidates settle on two separate markets, so each coin burns from its own pool.",
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
  if (i.follow === "rivalry" && i.pairKind === "candidates") return { options: [mk("every", PATTERN_REASON.candidatesEvery), mk("fade", PATTERN_REASON.oneShotFade), mk("once", null), mk("winner", PATTERN_REASON.candidatesSeparate)], preselected: "once" };
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
  if (i.follow === "market") return { options: [mk("every", PATTERN_REASON.marketOnce), { ...mk("fade", r && r.kind === "binary" ? null : PATTERN_REASON.marketFade), sentence: MARKET_NO_SENTENCE }, mk("once", null), winner], preselected: r?.kind === "binary" && r.binary?.onNo && !r.binary.onYes ? "fade" : "once" };
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
  if (isOneShotRule(rule)) return { label: "Share of the burn pool, once", line: share >= 1 ? "This coin burns its whole pool once, when the result is in. The burn lands in slices sized to the pool's liquidity." : `This coin burns ${p} of its pool once, when the result is in. The burn lands in slices sized to the pool's liquidity.`, math: null };
  if (rule.kind === "scalar" && rule.inverse) return { label: "Share of the burn pool per reading", line: `Each reading where the number does not move the rule's way spends ${p} of the burn pool buying and burning this coin. A reading counts once at most, however flat it was.`, math: null };
  if (rule.kind === "scalar" && unit) {
    const three = Math.round((1 - (1 - share) ** 3) * 10000) / 100;
    return { label: `Share of the burn pool per ${unit}`, line: `Each ${unit} spends ${p} of what is left in the burn pool buying and burning this coin.`, math: `A reading with several units compounds, so 3 units spend about ${three}%, not ${Math.round(share * 300 * 10) / 10}%. One burn run buys with at most 2% of the SOL in the coin's Raydium pool, and the rest waits for the next run.` };
  }
  return { label: "Share of the burn pool per result", line: `Each result that fires the rule spends ${p} of the burn pool buying and burning this coin. The token amount bought varies.`, math: null };
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
export function patternWords(id: PatternId, o: { follow: FollowId; subject?: string | null; outcome?: "win" | "loss" | "draw" | null; pairKind?: "teams" | "candidates" | null }): { label: string; sentence: string } {
  const s = o.subject;
  if (o.follow === "team" && s) {
    const won = o.outcome === "loss" ? "loss" : o.outcome === "draw" ? "draw" : "win";
    if (id === "every") return { label: `After each ${s} ${won}`, sentence: `The coin spends a share of its burn pool after each game the ${s} ${won === "win" ? "win" : won === "loss" ? "lose" : "draw"}.` };
    if (id === "fade") return { label: `After each ${s} game without a ${won}`, sentence: `The coin spends a share of its burn pool after each game the ${s} play and do not ${won === "win" ? "win" : won === "loss" ? "lose" : "draw"}.` };
    if (id === "once") return { label: `If the ${s} win the title`, sentence: `The coin spends its burn pool once, if the market on the ${s} winning the title pays out YES.` };
  }
  if (o.follow === "rivalry" && o.pairKind === "teams") {
    if (id === "every") return { label: "Each time its own team loses", sentence: "Each coin spends a share of its own burn pool after each game its team loses, this season." };
    if (id === "fade") return { label: "Each game its own team does not lose", sentence: "Each coin spends a share of its own burn pool after each game its team wins or ties, this season." };
    if (id === "once") return { label: "Their next game only", sentence: "When their next listed game is final, the coin of the team that lost burns once." };
  }
  if (o.follow === "rivalry" && o.pairKind === "candidates" && id === "once") return { label: "If this candidate wins", sentence: "Each coin burns once, if its own candidate's market pays out YES." };
  return { label: PATTERNS[id].label, sentence: PATTERNS[id].sentence };
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

export type EndKind = "flagship" | "named-coin" | "pair-winner" | "self";
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
  const kind: EndKind = sink === "pair-winner" ? "pair-winner" : sink === "flagship" ? "flagship" : "self";
  // ChatGPT audit 6 item 3: the sentences are describe.ts endText's, the same the review API's endsLine and the coin description say
  const e = endText(rule, { team: o.team ?? null });
  const sentences = [...e.result.split(/(?<=\.)\s+(?=[A-Z$])/), ...(e.void ? [e.void] : [])];
  // website-20 item 58: a coin with no end never reaches its end sink, so no end is offered as "this coin's end"
  if (windowKindOf(rule) === "perpetual" && kind !== "pair-winner") return { kind: "self", sentences, options: [] };
  const options: EndOption[] = [
    { kind: "flagship", label: kind === "flagship" && championPathRule(rule) ? sentences.join(" ") : "The rest goes to $DEFICIT", available: kind === "flagship", reason: kind === "flagship" ? null : kind === "pair-winner" ? "A linked pair sends the rest to the rival first." : "This kind of coin has no end sink today." },
    { kind: "pair-winner", label: "The rest goes to the rival", available: kind === "pair-winner", reason: kind === "pair-winner" ? null : "Only two linked coins can name each other." },
    { kind: "named-coin", label: "The rest goes to another coin you name", available: false, reason: "The launch page does not build this end." },
  ];
  return { kind, sentences, options };
}

/**
 * A ONE-SHOT BEFORE GRADUATION (walkthrough snag 11). What the keeper does: a result recorded before the coin graduates stays queued, the
 * burn runs once the coin's pool exists and is registered, and only then is the end recorded (endSinkKeeper.ts waits while results are
 * still queued), so the rest goes to $DEFICIT after that burn.
 */
export function beforeGraduationLine(when: string | null): string {
  return `${when ? `This result is due around ${when}. ` : ""}A coin burns only after it graduates. If the result comes first, it is recorded, and the burn waits until the coin graduates and its pool is registered. Then the rest of the pool goes to $DEFICIT's burn.`;
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
    ? `For example, on a day ${o.teamA} win, ${A} spends its share of its own burn pool and the tokens it buys are burned. ${B} burns that day too if ${o.teamB} also played and did not lose.`
    : `For example, if ${o.teamA} lose, ${A} spends its share of its own burn pool, the ${A} tokens it buys are burned, and ${B} does nothing for that game.`;
  return { kind: "independent", trigger, burned: `The coin whose rule fires is bought and burned. ${rules}`, pays: "Each coin pays from its own burn pool.", moves: "No SOL moves between the two coins, because they are separate launches.", example };
}

/** Two candidates of one race as two coins (walkthrough snag 7): each settles on its own outcome's market, and nothing moves between them. */
export function candidateFacts(o: { a: string; b: string; candA: string; candB: string }): { kind: "independent"; trigger: string; burned: string; pays: string; moves: string; example: string } {
  const A = `$${o.a || "A"}`, B = `$${o.b || "B"}`;
  return {
    kind: "independent",
    trigger: `These are two separate coins. ${A} settles on the market for ${o.candA}, and ${B} on the market for ${o.candB}.`,
    burned: "The coin whose candidate's market pays out YES is bought and burned once. If neither candidate wins, neither coin burns.",
    pays: "Each coin pays from its own burn pool.",
    moves: "No SOL moves between the two coins, because they are separate launches.",
    example: `For example, if ${o.candA} wins, ${A} spends its share of its own burn pool and the tokens it buys are burned, and ${B} does nothing.`,
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

// ---- generated tickers and names (owner, 2026-10-12: "two teamwifs") ----

const code = (s: string, max = 4): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, max);
/** Tickers are upper case on every surface (the registry and the program's memo prefix), so the matchup's "v" is a V. */
export function pairTickers(a: string, b: string): { a: string; b: string } {
  const A = code(a), B = code(b);
  return { a: `${A}V${B}`.slice(0, 10), b: `${B}V${A}`.slice(0, 10) };
}
/** The on-chain name carries the matchup: "WIF vs BONK, WIF side" (at most 32 characters). */
export function pairNames(a: string, b: string): { a: string; b: string } {
  // audit 7 item 8: never cut mid-word ("Guardians vs Rays, Guardians sid"): the full form, then the shorter "Guardians vs Rays", then
  // whole words up to 32 bytes (the program counts a name in bytes)
  const bytes = (x: string) => new TextEncoder().encode(x).length;
  const words = (x: string) => { let out = ""; for (const w of x.split(" ")) { const next = out ? `${out} ${w}` : w; if (bytes(next) > 32) break; out = next; } return out.replace(/[,\s]+$/, ""); };
  const full = { a: `${a} vs ${b}, ${a} side`, b: `${b} vs ${a}, ${b} side` };
  if (bytes(full.a) <= 32 && bytes(full.b) <= 32) return full;   // both sides take the same form
  return { a: words(`${a} vs ${b}`), b: words(`${b} vs ${a}`) };
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
export const RIVALRY_GAME_LINE = "Pick the game. When it is final, the coin of the team that lost burns once.";
export const RIVALRY_SEASON_LABEL = "Every loss this season";
export const RIVALRY_SEASON_LINE = "Each coin burns every time its own team loses any game this season, through the postseason, not only the games between these two.";
export const RIVALRY_SCOPE_LINE = "Two separate coins, one for each team. Each burns from its own pool, and no SOL moves between them.";
/** Item 154: a failed schedule read is never "no listed game". */
export const SCHEDULE_UNAVAILABLE_LINE = "The schedule could not be read just now, so their games are not shown.";
export const NO_LISTED_MEETING_LINE = "The schedule lists no game between them right now.";
/** Item 157: what the list covers. */
export const scheduleCoverageLine = (n: number): string => (n > 1 ? `The league's schedule lists ${n} games between them from today on. Pick the one the coins follow.` : n === 1 ? "The league's schedule lists one game between them from today on." : "Only games the league's schedule lists from today on can be picked.");
/** Item 155: a cleared second team is said once. */
export const RIVAL_SAME_TEAM = "The second team was cleared, because it is now the first team. Pick another second team.";
/** Audit 7 item 9: season coins are named for what they count ("Guardians 2026 Losses", $CLEL). */
export function seasonPairNames(a: { abbr: string; nickname: string | null; name: string }, b: { abbr: string; nickname: string | null; name: string }, year: number, league: string | null): { a: { name: string; ticker: string }; b: { name: string; ticker: string } } {
  const one = (t: typeof a) => { const n = `${t.nickname ?? t.name} ${year} Losses`; return { name: new TextEncoder().encode(n).length <= 32 ? n : `${t.abbr} ${year} Losses`, ticker: teamTicker(t.abbr, { league, window: "season", outcome: "loss" }) }; };
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
