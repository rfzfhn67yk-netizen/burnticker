import { DISPERSAL_MIN_GAP_MS, DISPERSAL_WINDOW_MS, PROGRAM_CAP_BPS } from "@/lib/burnticker/dispersal";

/**
 * HOW A BURN IS SPREAD OUT, IN WORDS (owner, 2026-10-20). The facts are dispersal.ts and dispersalKeeper.ts: a reading's burn runs in the
 * keeper cycle that sees it; one burn spends at most the program's per-crank cap (PROGRAM_CAP_BPS, 2% of the trading pool's SOL); the rest
 * is carried on the coin and, where burn dispersal runs, spent in crank_carried pieces at seeded random times inside a window of
 * DISPERSAL_WINDOW_MS (six hours), at least DISPERSAL_MIN_GAP_MS (20 minutes) apart, each at most DEPTH_PPM of the reserve (a move of the
 * pool's rate under about 2.5%); what is left when a window ends rolls into the next window until nothing is carried.
 *
 * WHICH COINS: the platform keeper runs dispersal for creator coins (its unit sets BURNTICKER_DISPERSAL=1). The $DEFICIT keeper runs it
 * only on its own explicit BURNTICKER_DISPERSAL=1, which its host does not set: its carried amount is spent by the next reading's burn
 * (SPREAD_DEFICIT_LINE). Plain English, lint-clean; nothing here says anything about a price. Client-safe.
 */
const NUMBER_WORDS: Record<number, string> = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 8: "eight", 12: "twelve" };
const capPct = PROGRAM_CAP_BPS / 100;
const windowHours = NUMBER_WORDS[DISPERSAL_WINDOW_MS / 3_600_000] ?? String(DISPERSAL_WINDOW_MS / 3_600_000);
const gapMin = DISPERSAL_MIN_GAP_MS / 60_000;

/** The creator-coin explanation, three short paragraphs (the settlement page, the whitepaper, the trust page). */
export const SPREAD_LINES: readonly string[] = [
  `When a reading settles, the keeper runs the burn right away. One burn may spend at most ${capPct}% of the trading pool's SOL, and anything above that is carried.`,
  `On creator coins, the carried amount is burned in smaller pieces at random times over a ${windowHours}-hour window, at least ${gapMin} minutes apart. Each piece is small enough to move the pool's rate by less than about 2.5%.`,
  `If some is still left when the window ends, a new ${windowHours}-hour window starts, and this repeats until all of it is burned. The random times come from a fixed seed, so restarting the keeper does not change them.`,
];
/** The carried part in one sentence, for a line that has already said the per-burn cap (guidedLaunch.ts wholePoolSliceLine). */
export const SPREAD_REST_SENTENCE = `The rest is burned in smaller pieces at random times over a ${windowHours}-hour window, at least ${gapMin} minutes apart, and a new window starts if any is left, so a large burn lands over hours, not in one go.`;
/**
 * BT-108-COPY-01 (2026-10-20): the one scheduling sentence for a one-time burn, on the guided amount step, the review's "How much" row and
 * the one-shot review sentences of every family (event, earthquake and the other hazards, 50% and 100%), so no surface says "daily run"
 * or "several days" beside SPREAD_REVIEW_LINE.
 */
export const SPREAD_ONE_SHOT_LINE = `One burn spends at most ${capPct}% of the trading pool's SOL. ${SPREAD_REST_SENTENCE}`;
/** $DEFICIT's own wording: its keeper does not spread its burns. */
export const SPREAD_DEFICIT_LINE = `$DEFICIT's burns are not spread out this way. Its keeper runs one burn for each reading, up to the same ${capPct}% of the trading pool's SOL, and anything above that carries to its next run.`;
/** The $DEFICIT site's own line, which has no creator-coin paragraphs before it, so it says both halves itself (coordinator 2026-10-20). */
export const SPREAD_DEFICIT_STANDALONE = `Creator coins on Burnticker spread a large burn into smaller pieces at least ${gapMin} minutes apart over ${windowHours}-hour windows. $DEFICIT burns each reading in one go: its keeper runs one burn for each reading, up to ${capPct}% of the trading pool's SOL, and anything above that carries to its next run.`;
/** The launch review's one note, said when the host runs burn dispersal. */
export const SPREAD_REVIEW_LINE = `When a reading settles, the burn runs right away. One burn spends at most ${capPct}% of the trading pool's SOL. Anything above that is burned in smaller pieces at random times over the next ${windowHours} hours, at least ${gapMin} minutes apart, and a new ${windowHours}-hour window starts if any is left.`;
