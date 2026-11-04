import type { BurnRule } from "@/lib/burnticker/rules";

/**
 * THE FADE SIDE (sources-2, 2026-10-12; the owner: "add the fade side"). A recurring first-party rule may carry `inverse: true`: each
 * settled period in which the rule's condition does NOT happen is one unit, and a period in which it does happen burns nothing.
 *
 *   "burns for every $1B the debt adds"      inverse: "burns on every business day the debt stays flat or falls"
 *   "burns when the Eagles win"              inverse: "burns on every Eagles game day without a win"
 *   "burns for every executive order signed" inverse: "burns on every day no executive order is signed"
 *
 * THE CONDITION is the rule's own movement test on the SAME reading the plain rule reads: the value moved in the rule's direction from
 * its baseline (up: rose; down: fell; abs: moved at all). Under inverse a period whose value did not move that way is exactly one unit at
 * the rule's own fraction; a period that moved that way, by any amount (even less than one unit), is none. The first reading of a
 * "previousSettlement" rule is still only the starting point. No carry applies (the carried remainder is a property of counting how
 * much it moved, which an inverse rule does not count). The keeper, the receipt check and the token page all run units.ts unitStep, so
 * they agree. A sports series is read per game day: a day with two games counts once.
 *
 * WHERE IT IS ALLOWED: recurring scalar rules on a first-party feed (oracle "catalogue"). Refused on one-shots (a market, a single game,
 * the first snow, a named launch, a milestone), on binary rules (their YES / NO choice already covers "when it does not happen"), on
 * rivalry pairs and outcome sets, and on Burn Derby. `inverse` is absent on every other rule, so their canonical bytes and hashes are
 * unchanged; on a rule that carries it, it is part of the locked text and so of the hash.
 *
 * Client-safe (no node imports): the launch page's choice and the dials read it.
 */

/**
 * HB-147 (hourly run 13): THE ONE LIST of catalogue series that resolve once: a single game, the first snow, a named launch, a star or
 * channel milestone, and the next-event one-shots. Every "is this a one-shot series" question reads it (isOneShotSeries: the share row
 * in dials.ts, the window kind in describe.ts, the share bounds in rules.ts); the first snow was missing from the keeper's copy, so its
 * burn step offered the recurring 1 to 25% row and its review said "burns 2% of its pool once".
 */
export const ONE_SHOT_SERIES_PREFIXES = ["espn.game", "nws.snow", "ll2.launch", "github.milestone", "youtube.milestone", "usgs.quakenext", "nhc.next", "spc.tornadoday", "nifc.firesize", "usgs.volcanowarning", "defillama.tvlnext"] as const;
/** The first snow: a one-shot whose keeper end is its own branch (multiKeeper.ts detectRuleEnd: the first day that burned, not the first reading). */
export const FIRST_SNOW_PREFIX = "nws.snow";
const prefixRe = (xs: readonly string[]): RegExp => new RegExp(`^(${xs.map((x) => x.replace(/\./g, "\\.")).join("|")}):`);
/** Catalogue series that resolve once (ONE_SHOT_SERIES_PREFIXES). */
export const CATALOGUE_ONE_SHOT_RE = prefixRe(ONE_SHOT_SERIES_PREFIXES);
/** Whether a catalogue series resolves once: the one test every reader uses (HB-147). */
export const isOneShotSeries = (series: string | null | undefined): boolean => !!series && CATALOGUE_ONE_SHOT_RE.test(series);
/**
 * The catalogue one-shots the keeper's generic one-shot branch ends after their one reading (rules.ts isOneShot): the same list less the
 * first snow, whose daily readings of 0 are not its result (multiKeeper.ts ends it in its own branch, and drains it at 100%). QA pass 9 #3
 * (2026-10-13, owner decision 2026-10-12: one-shots default to 100 %): a single game is one of them.
 */
export const KEEPER_ONE_SHOT_RE = prefixRe(ONE_SHOT_SERIES_PREFIXES.filter((x) => x !== FIRST_SNOW_PREFIX));

/**
 * sources-3 (2026-10-12): the NEXT-EVENT one-shots (the next earthquake at a magnitude, the next hurricane at a category this season, the
 * next day with N tornado reports, the next wildfire to reach a size, the next raise of a volcano to WARNING). Each one burns on the first
 * qualifying period after its launch, so an earlier qualifying period never makes it "already decided"; only a closed window does (a
 * hurricane season that is over). In both regexes above.
 */
export const NEXT_EVENT_ONE_SHOT_RE = /^(usgs\.quakenext|nhc\.next|spc\.tornadoday|nifc\.firesize|usgs\.volcanowarning|defillama\.tvlnext):/;

/** A team or game series on two of the three results (espn.ts PairOutcome; repeated here as a pattern so this file stays import-free). */
export const PAIR_OUTCOME_SERIES_RE = /^espn\.(team|game):[a-z0-9.]+-.*-(windraw|drawloss|winloss)(-|$)/;

/** The plain choice the review card shows (WIRING-SOURCES.md). */
export const INVERSE_CHOICE = { off: "Burn when it happens", on: "Burn on the days it does not happen" } as const;

/** Why this rule cannot take `inverse` (null: it can). Pure; validateRule uses it, so the wizard and the server refuse the same rules. */
export function inverseRefusal(r: Pick<BurnRule, "oracle" | "kind" | "series" | "market" | "pair"> & { set?: unknown; derby?: unknown }): string | null {
  if (r.oracle !== "catalogue") return r.oracle === "derby" ? "Burn Derby rules cannot be inverted." : "Only a first-party feed rule can burn when its condition does not happen. A market rule already chooses YES or NO.";
  if (r.kind !== "scalar") return "Only a rule that counts a reading can be inverted.";
  if (r.market !== null || isOneShotSeries(r.series)) return "A rule that resolves once cannot be inverted. Its other outcome already burns nothing.";
  if (r.pair) return "A rivalry pair cannot be inverted. The other coin already takes the other side.";
  if (r.set !== undefined && r.set !== null) return "League mode cannot be combined with burning when the condition does not happen.";
  // two of a soccer game's three results (espn.ts PairOutcome): the other side is the one result left, which is its own coin
  if (PAIR_OUTCOME_SERIES_RE.test(r.series ?? "")) return "A coin that burns on two of the three results cannot be flipped. Pick the one result that is left instead.";
  return null;
}
export const canInvert = (r: Parameters<typeof inverseRefusal>[0]): boolean => inverseRefusal(r) === null;
