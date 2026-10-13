import type { BurnRule } from "@/lib/burnticker/rules";
import { dialsFor } from "@/lib/burnticker/dials";
import { championPathRule, describeEndSink, windowKindOf } from "@/lib/burnticker/describe";
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

export type GuidedStepId = "follow" | "which" | "burn" | "end";
export const GUIDED_STEPS: readonly { id: GuidedStepId; question: string; short: string }[] = [
  { id: "follow", question: "What does this coin follow?", short: "Follows" },
  { id: "which", question: "Which one?", short: "Which" },
  { id: "burn", question: "How does it burn?", short: "Burns" },
  { id: "end", question: "What happens at the end?", short: "Ends" },
];
/** "1 of 4". */
export const progressLabel = (i: number): string => `${i + 1} of ${GUIDED_STEPS.length}`;

export type FollowId = "team" | "market" | "number" | "coins" | "rivalry";
/**
 * `line` is the one line a choice card shows (owner, 2026-10-12: "make the step workflow easier to follow": title and one line, so all
 * five fit on one phone screen); `sentence` and `example` sit in the Examples disclosure below the cards.
 */
export const FOLLOW_CHOICES: readonly { id: FollowId; label: string; line: string; sentence: string; example: string }[] = [
  { id: "team", label: "A team", line: "One team in any league.", sentence: "One team in any league. It can burn on every win this season, or once if they win the title.", example: "For example, $LAD for the Dodgers' season." },
  { id: "market", label: "A market", line: "One outcome of a Polymarket market.", sentence: "One outcome of a Polymarket market, such as a candidate, a film or a team. It burns once when the market pays out.", example: "For example, a candidate winning a Senate race." },
  { id: "number", label: "A number someone publishes", line: "A public figure or record, like the debt.", sentence: "A public figure or record, such as the national debt, a city's daily high or rocket launches.", example: "For example, every $1B the debt rises." },
  { id: "coins", label: "A coin against another coin", line: "Two coins, compared once a day.", sentence: "Two coins people already hold, compared each day on their published feeds. You launch two new coins, one for each side.", example: "For example, WIF against BONK." },
  { id: "rivalry", label: "A rivalry pair", line: "Two teams or two candidates, one coin each.", sentence: "Two teams in one game or one season, or two candidates in one race. You launch one coin for each side.", example: "For example, the Dodgers against the Brewers." },
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
  derbyFade: "Each day's result already fires one of the two sides, so there is no day where nothing happens.",
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
export function budgetCopy(rule: BurnRule, share: number, unit: string | null): { label: string; line: string } {
  const p = pctLabel(share);
  if (isOneShotRule(rule)) return { label: "Share of the pool, once", line: share >= 1 ? "This coin burns its whole pool once, when the result is in. The burn lands in slices sized to the pool's liquidity." : `This coin burns ${p} of its pool once, when the result is in. The burn lands in slices sized to the pool's liquidity.` };
  if (rule.kind === "scalar" && rule.inverse) return { label: "Burn budget per reading", line: `Each reading where the number does not move the rule's way spends ${p} of the burn pool. A reading counts once at most, however flat it was.` };
  if (rule.kind === "scalar" && unit) {
    const three = Math.round((1 - (1 - share) ** 3) * 10000) / 100;
    return { label: `Burn budget per ${unit}`, line: `Each ${unit} spends ${p} of what is left in the burn pool. A reading with several units compounds, so 3 units spend about ${three}%, not ${Math.round(share * 300 * 10) / 10}%. One burn run buys with at most 2% of the trading pool's SOL, and the rest waits for the next run.` };
  }
  return { label: "Burn budget per result", line: `Each result that fires the rule spends ${p} of the available burn budget. The tokens bought are burned, and the token amount varies.` };
}

export type EndKind = "flagship" | "named-coin" | "pair-winner" | "self";
export interface EndOption { kind: EndKind; label: string; available: boolean; reason: string | null }
/**
 * THE END, FROM THE RULE (step 4). The program pins one end sink at creation (EndSink kinds 0, 1 and 3); the sentences come from the sink
 * the rule carries (describe.ts describeEndSink, the same test the keeper uses). A coin with no end sink (a Coin vs Coin pair today) burns
 * the rest down on itself. `options` lists the pinnable ends with the ones the launch page does not build greyed.
 */
export function endSentences(rule: BurnRule, o: { team?: string | null } = {}): { kind: EndKind; sentences: string[]; options: EndOption[] } {
  const sink = describeEndSink(rule);
  const kind: EndKind = sink === "pair-winner" ? "pair-winner" : sink === "flagship" ? "flagship" : "self";
  const VOID = "If the result is voided or the season is cancelled, the rest burns down on this coin over four weeks instead.";
  let sentences: string[];
  if (kind === "self") sentences = ["When the rule ends, each coin's own pool burns down whatever is left over four weeks, and the coin retires."];
  else if (kind === "pair-winner") sentences = ["When the rule ends, the rest of the pool goes to the rival coin if it won the last result, or to $DEFICIT's burn if it did not.", VOID];
  else if (championPathRule(rule)) { const ref = o.team ?? "the team"; sentences = [`If ${ref} win the championship, the rest of the pool burns here.`, "If they do not, the rest goes to $DEFICIT's burn.", VOID]; }
  else if (windowKindOf(rule) === "perpetual") sentences = ["This coin has no end date, so it never reaches an end."];
  else if (isOneShotRule(rule)) sentences = ["When the result is in, the rest of the pool goes to $DEFICIT's burn.", VOID];
  else sentences = ["After the last game or reading the rule covers, the rest of the pool goes to $DEFICIT's burn.", VOID];
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
  const fit = (x: string) => (x.length <= 32 ? x : x.slice(0, 32).trimEnd());
  return { a: fit(`${a} vs ${b}, ${a} side`), b: fit(`${b} vs ${a}, ${b} side`) };
}
const CHAMP: Record<string, string> = { mlb: "WS", nfl: "SB", nba: "TITLE", nhl: "CUP" };
/**
 * A team coin's ticker: the team code plus the window when it is not the plain season. $LAD (the season's wins), $LADL (its losses),
 * $LADPO (the postseason), $LADNEXT5 (the next five games), $LADALL (every season), $LADNOWIN (the fade side), $LADWS (the title, once).
 */
export function teamTicker(abbr: string, o: { league?: string | null; window?: "season" | "post" | "next" | "perpetual" | "title" | null; games?: number | null; outcome?: "win" | "loss" | "draw" | null; inverse?: boolean }): string {
  const A = code(abbr, 4);
  if (o.window === "title") return `${A}${CHAMP[o.league ?? ""] ?? "CHAMP"}`.slice(0, 10);
  const side = o.inverse ? `NO${o.outcome === "loss" ? "LOSS" : o.outcome === "draw" ? "DRAW" : "WIN"}` : o.outcome === "loss" ? "L" : o.outcome === "draw" ? "D" : "";
  const win = o.window === "post" ? "PO" : o.window === "next" ? `NEXT${o.games ?? 5}` : o.window === "perpetual" ? "ALL" : "";
  return `${A}${side}${win}`.slice(0, 10);
}
/** The team ticker for a rule built from an ESPN team series (null for any other rule). */
export function teamTickerForRule(r: BurnRule, abbr?: string | null): string | null {
  const e = r.oracle === "catalogue" && r.series ? parseEspnSeries(r.series) : null;
  if (!e || e.kind !== "team") return null;
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
