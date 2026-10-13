import { fitName } from "@/lib/burnticker/launchFields";
import { shortTeamName } from "@/lib/burnticker/guidedLaunch";

/**
 * website-25: short sentences the launch pages say that are not field checks. Plain English, lint-clean (test/burntickerWebsite25.test.ts).
 */

/**
 * QA walkthrough 11 H4: a coin comparison pair launches on the pair curve, whose two coins get their own mints and no LaunchLab pool, so
 * its estimate is lower than two separate LaunchLab coins. The review's `venue` says which; the sentence says why the figure differs and
 * the server's own note (costs.note) says what it leaves out.
 */
export function pairCostSentence(totalSol: string, venue: "launchlab" | "pair-curve" | null | undefined): string {
  return venue === "pair-curve"
    ? `The estimated cost is about ${totalSol} SOL for both coins on the pair curve. That is less than two separate coins, because the pair curve has no LaunchLab pool to pay rent for.`
    : `The estimated cost is about ${totalSol} SOL for both coins.`;
}

/**
 * QA walkthrough 11 H8 and M3: the generated names and tickers of a two-team linked pair say which way it burns. One game and every game
 * between them both burn the coin of the team that won ("Arsenal Wins vs Spurs", $ARSWIN); the season pair keeps its own generator
 * ("Arsenal 2026 Losses"). Whole words only, at most 32 bytes (fitName), tickers 10 characters at most.
 */
export function winPairNames(a: { abbr: string; code?: string | null; nickname: string | null; name: string }, b: { abbr: string; code?: string | null; nickname: string | null; name: string }): { a: { name: string; ticker: string }; b: { name: string; ticker: string } } {
  const code = (t: typeof a) => (t.code ?? t.abbr).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  const one = (x: typeof a, y: typeof a) => {
    const nx = x.nickname ?? x.name, ny = y.nickname ?? y.name;
    return { name: fitName([`${nx} Wins vs ${ny}`, `${shortTeamName(nx)} Wins vs ${shortTeamName(ny)}`, `${nx} Wins vs ${code(y)}`, `${shortTeamName(nx)} Wins vs ${code(y)}`, `${code(x)} Wins vs ${code(y)}`]), ticker: `${code(x)}WIN`.slice(0, 10) };
  };
  return { a: one(a, b), b: one(b, a) };
}
/** H8: said once on the name step when a new rule replaced names the creator had typed (both coins, names and tickers alike). */
export const NAMES_REMADE_LINE = "You changed what the coins follow, so both coins got new names and tickers for the new rule. The ones you typed described the old rule. Type your own again if you like.";

/** QA 11 M6: a calendar day said the way people read it ("Wed, Nov 4, 2026"), never ISO; the input as it is when it is not a date. */
export function humanDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** WIRING-SOURCES7 H9: reservedNames.ts RESERVED_TICKER_REFUSAL, word for word (that module reads files, so the client keeps a copy; test/burntickerWebsite25.test.ts pins them). */
export const RESERVED_TICKER_LINE = "That ticker is reserved for the platform. Pick a ticker of your own.";
/** QA 11 L3: the ticker field takes a whole paste, so the "was cut" note quotes exactly what was typed (the normaliser keeps 10). */
export const TICKER_PASTE_MAX = 64;
/** QA 11 L3: the name stops at 32 characters, and says so. */
export const NAME_INPUT_MAX = 32;
export const NAME_MAX_LINE = "A name has at most 32 characters, so the field stops there.";

/** QA 11 M1: the step chip that would discard later answers asks first, as Start over does. */
export const JUMP_CONFIRM_LINE = "Going back to the first step clears the answers after it, and the draft goes with them.";
export const JUMP_CONFIRM_YES = "Go back and clear them";
export const JUMP_CONFIRM_NO = "Stay here";
