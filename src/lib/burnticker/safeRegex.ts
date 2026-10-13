/**
 * USER REGEXES, SAFELY (ChatGPT audit 6 item 8, 2026-10-12: filter.titleRegex "(a+)+$" was accepted, and the keeper evaluates it on
 * every market title in every cycle). JavaScript's engine backtracks, so a pattern with a quantified group that itself repeats or
 * alternates ("(a+)+", "(a|aa)*", "(.*a){12}") can take exponential time on a short title and stall the keeper for every coin.
 *
 * `regexProblem` refuses, before launch, any pattern that is too long, does not compile, uses a backreference or lookbehind, or puts a
 * quantifier on a group that contains a quantifier or an alternation (the star-height rule that rules out catastrophic backtracking for
 * the patterns a title filter needs: anchors, literals, classes, a single level of quantifiers). `safeRegexTest` is what every evaluator
 * calls (the keeper's selectors, the registry, the Kalshi and Polymarket readers): a pattern that fails the check is never run (the title
 * does not match, so nothing burns on it), and the title is cut to TITLE_MAX characters first. Pure; client-safe.
 */
export const REGEX_MAX = 120;
export const TITLE_MAX = 300;
const QUANT_AFTER = /^(?:[*+]|\{\d+,\d*\}|\{\d+\})/;

export function regexProblem(pattern: unknown): string | null {
  if (typeof pattern !== "string" || pattern.length > REGEX_MAX) return `The title filter must be a regular expression of at most ${REGEX_MAX} characters.`;
  try { new RegExp(pattern); } catch { return "The title filter is not a valid regular expression."; }
  if (/\\[1-9]|\\k</.test(pattern)) return "The title filter cannot use a backreference.";
  if (/\(\?<[=!]/.test(pattern)) return "The title filter cannot use a lookbehind.";
  // walk the pattern: for each group, whether it holds a quantifier or an alternation; a quantified group that does is refused
  const stack: { quant: boolean; alt: boolean }[] = [];
  let inClass = false, unbounded = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") { i++; continue; }
    if (inClass) { if (c === "]") inClass = false; continue; }
    if (c === "[") { inClass = true; continue; }
    // several unbounded repeats in a row (".*.*.*.*x") are polynomial, not exponential, but still too slow at four or more
    if ((c === "*" || c === "+" || (c === "{" && /^\{\d+,\}/.test(pattern.slice(i)))) && ++unbounded > 3) return "The title filter has more than three open-ended repeats (*, + or {n,}), which can take too long to check. Use a simpler pattern.";
    if (c === "(") { stack.push({ quant: false, alt: false }); continue; }
    if (c === "|") { if (stack.length) stack[stack.length - 1].alt = true; continue; }
    if (c === ")") {
      const g = stack.pop() ?? { quant: false, alt: false };
      const rest = pattern.slice(i + 1), q = QUANT_AFTER.exec(rest);
      const repeats = !!q && !/^\{(0|1)\}$|^\{(0|1),(0|1)\}$/.test(q[0]);
      if (repeats && (g.quant || g.alt)) return "The title filter repeats a group that already repeats or has alternatives, which can take too long to check. Use a simpler pattern, such as ^Denver or (Win|Loss) without a repeat after it.";
      if (stack.length && (g.quant || g.alt || repeats)) stack[stack.length - 1].quant = stack[stack.length - 1].quant || g.quant || repeats;
      continue;
    }
    if ((c === "*" || c === "+" || c === "{" || c === "?") && stack.length) {
      if (c === "{" && !/^\{\d+(,\d*)?\}/.test(pattern.slice(i))) continue;
      if (c !== "?") stack[stack.length - 1].quant = true;
    }
  }
  return null;
}

/** A user pattern run safely: refused patterns never run (no match), and the text is capped. */
export function safeRegexTest(pattern: string, text: string, flags = ""): boolean {
  if (regexProblem(pattern)) return false;
  try { return new RegExp(pattern, flags).test(text.slice(0, TITLE_MAX)); } catch { return false; }
}
