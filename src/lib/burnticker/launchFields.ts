/**
 * THE LAUNCH FIELDS' CHECKS, IN WORDS (ChatGPT launch audit 5, L07, 2026-10-11: "abc" as a weather threshold made "Use this rule" do
 * nothing; a blank name let "done" hide the field without a word; "A B!?" became "AB" silently). Each check returns the sentence shown
 * next to its field (linked with aria-describedby) or "" / null when the value is fine; a normalised value says what changed.
 * Client-safe and pure; test/burntickerLaunchFields.test.ts.
 */
const okTicker = (t: string) => /^[A-Z0-9]{2,10}$/.test(t);
/**
 * Intent audit items 1 and 2 (2026-10-12): the on-chain token metadata (Metaplex, written by LaunchLab's create) holds a name of at most
 * 32 BYTES of UTF-8 and a symbol of at most 10 bytes; the Raydium SDK checks only the symbol's length in code units, and nothing upstream
 * truncates. So the name is measured in bytes here, on the page and on the server (launchReview.ts, launchBundle.ts launchProblems), and a
 * name must hold at least 2 characters a person can see: spaces, zero-width characters, joiners, direction marks, variation selectors,
 * fillers and lone combining marks do not count. Accents, CJK and emoji are visible and pass within the byte limit.
 */
export const NAME_MAX_BYTES = 32;
export const SYMBOL_MAX_BYTES = 10;
export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;
/** The characters of a name a person can see (whitespace, format and control characters, fillers and lone marks removed). */
export const visibleText = (s: string): string => s.replace(/[\s\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}\p{Mn}\p{Me}\u034F\u115F\u1160\u2800\u3164\uFE00-\uFE0F\uFFA0\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu, "");
/** The field problems of one coin, each a sentence a person can act on ("" = fine). */
export function nameProblem(name: string): string {
  const n = name.trim(), seen = Array.from(visibleText(n)).length, bytes = utf8Bytes(n);
  return !n ? "Enter a name for the coin."
    : seen === 0 ? "The name has no visible characters. Use letters, digits or symbols a person can see."
    : seen < 2 ? "The name needs at least 2 visible characters."
    : bytes > NAME_MAX_BYTES ? `The name takes ${bytes} bytes, and a coin's name can take at most ${NAME_MAX_BYTES}. Letters A to Z and digits take 1 byte each, while accented letters, other scripts and emoji take 2 to 4.`
    : "";
}
export function tickerProblem(t: string): string { return !t ? "Enter a ticker of 2 to 10 letters or digits." : !okTicker(t) ? "A ticker has 2 to 10 letters or digits." : ""; }
/** L07: the visible normalisation of a typed ticker ("A B!?" → "AB"), or null when nothing changed but the case. */
export function tickerNormalised(raw: string): { value: string; note: string | null } {
  const value = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  return { value, note: value !== raw.toUpperCase() ? `Tickers use only the letters A to Z and the digits 0 to 9, so “${raw}” became “${value}”.` : null };
}

/** L07: a weather threshold the NWS rule can count from, or the sentence that says what is wrong with it. */
export function wxThresholdProblem(metric: "high" | "rain", raw: string): string | null {
  const v = raw.trim();
  if (!v) return metric === "high" ? "Enter a temperature in whole degrees Fahrenheit, for example 90." : "Enter an amount of rain in inches, for example 0.50.";
  if (!/^-?\d+(\.\d+)?$/.test(v)) return metric === "high" ? `“${v}” is not a temperature. Enter whole degrees Fahrenheit, for example 90.` : `“${v}” is not an amount of rain. Enter inches, for example 0.50.`;
  const n = Number(v);
  if (metric === "high") return !Number.isInteger(n) ? "The climate report gives whole degrees, so enter a whole number." : n < -60 || n > 135 ? "Enter a temperature between -60 and 135 °F." : null;
  return n <= 0 || n >= 10 ? "Enter an amount above 0 and below 10 inches." : !/^\d+(\.\d{1,2})?$/.test(v) ? "The climate report gives hundredths of an inch, so use at most two decimals." : null;
}
