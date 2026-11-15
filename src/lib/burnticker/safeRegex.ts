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
 *
 * 2026-10-15 prelaunch audit H6: the star-height rule still let through patterns that backtrack to the fourth power and more
 * ("a{1,100}a{1,100}a{1,100}a{1,100}b" on a title of a's), the back-test ran a filter before any check, and validateRule did not call
 * this one. `safeRegexTest` no longer runs JavaScript's engine at all: it runs linearRegex.ts, a Thompson-NFA matcher whose time is
 * linear in the title for any pattern. `regexProblem` keeps the simplicity rules above (a filter should be simple to read) and adds the
 * matcher's own: no lookahead (it was allowed before; a lookaround is not a regular expression in the strict sense), and at most
 * LINEAR_MAX_PROGRAM steps once bounded repeats are written out.
 */
import { compileLinear, LinearRegexUnsupported, type LinearRegex } from "@/lib/burnticker/linearRegex";
import { LruMap } from "@/lib/burnticker/lru";
export const REGEX_MAX = 120;
export const TITLE_MAX = 300;
const QUANT_AFTER = /^(?:[*+]|\{\d+,\d*\}|\{\d+\})/;

export function regexProblem(pattern: unknown): string | null {
  if (typeof pattern !== "string" || pattern.length > REGEX_MAX) return `The title filter must be a regular expression of at most ${REGEX_MAX} characters.`;
  try { new RegExp(pattern); } catch { return "The title filter is not a valid regular expression."; }
  if (/\\[1-9]|\\k</.test(pattern)) return "The title filter cannot use a backreference.";
  if (/\(\?<[=!]/.test(pattern)) return "The title filter cannot use a lookbehind.";
  if (/\(\?[=!]/.test(pattern)) return "The title filter cannot use a lookahead.";
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
  try { compiled(pattern, ""); } catch (e) { return e instanceof LinearRegexUnsupported ? `The title filter uses something this site cannot check quickly (${e.message}). Use a simpler pattern, such as ^Denver or (Win|Loss).` : "The title filter is not a valid regular expression."; }
  return null;
}

const programs = new LruMap<string, LinearRegex>(500);
function compiled(pattern: string, flags: string): LinearRegex {
  const k = `${flags}/${pattern}`;
  let r = programs.get(k);
  if (!r) { r = compileLinear(pattern, flags); programs.set(k, r); }
  return r;
}

/**
 * A user pattern run safely: refused patterns never run (no match), the text is capped, and the match runs on the linear-time matcher
 * (linearRegex.ts), never on JavaScript's backtracking engine (H6).
 */
export function safeRegexTest(pattern: string, text: string, flags = ""): boolean {
  if (regexProblem(pattern)) return false;
  try { return compiled(pattern, flags).test(text.slice(0, TITLE_MAX)); } catch { return false; }
}

/**
 * A STORED rule's title filter that this build refuses (prelaunch audit H6 re-review). safeRegexTest answers "no match" for it, which on
 * its own would leave the coin silently never burning; the keeper calls this before it plans a coin and, when it answers, raises a
 * `rule-filter-unsupported` alert and holds the coin (multiKeeper.ts planToken) instead. The native engine is not used as a fallback: a
 * backtracking match cannot be bounded inside the keeper's synchronous plan. null when the rule has no filter or its filter is fine.
 */
export function storedFilterProblem(rule: { filter?: { titleRegex?: unknown } | null }): string | null {
  const p = rule.filter?.titleRegex;
  if (p === undefined || p === null || p === "") return null;
  return regexProblem(p);
}
/** Thrown by the keeper's plan for a coin whose stored filter this build refuses (the cycle records it and moves to the next coin). */
export class FilterUnsupportedError extends Error { constructor(m: string) { super(m); this.name = "FilterUnsupportedError"; } }
