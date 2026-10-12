/**
 * THE LAUNCH FIELDS' CHECKS, IN WORDS (ChatGPT launch audit 5, L07, 2026-10-11: "abc" as a weather threshold made "Use this rule" do
 * nothing; a blank name let "done" hide the field without a word; "A B!?" became "AB" silently). Each check returns the sentence shown
 * next to its field (linked with aria-describedby) or "" / null when the value is fine; a normalised value says what changed.
 * Client-safe and pure; test/burntickerLaunchFields.test.ts.
 */
const okTicker = (t: string) => /^[A-Z0-9]{2,10}$/.test(t);
/** The field problems of one coin, each a sentence a person can act on ("" = fine). */
export function nameProblem(name: string): string { const n = name.trim(); return !n ? "Enter a name for the coin." : n.length < 2 ? "The name needs at least 2 characters." : name.length > 32 ? "The name is at most 32 characters." : ""; }
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
