import COPY_LINT from "../../../../config/launch/copy-lint.json" with { type: "json" };
import { profileFieldProblems, type ProfileField } from "@/lib/burnticker/guidedLaunch";
import { noteProblemOf } from "@/lib/burnticker/guidedLaunch";
import type { ProfileValue } from "./ProfileFields";

/**
 * THE NAME STEP'S FIELD CHECKS (website-25, QA walkthrough 11 item H5). Every rule the server runs on what the creator typed runs here on
 * the field itself, as the creator types or leaves it: the copy lint's creator scope (config/launch/copy-lint.json, the same file and the
 * same masking as src/lib/launch/copyLint.ts lintCopy, which reads it from disk and so cannot run in the browser), said as ONE plain
 * sentence per field: no rule ids, no word listed twice, no quote cut mid-word, and a link or @handle said as a link problem.
 *
 * The server's own answer (the review's `problems`) is still read: a problem that names a field (a reserved or lookalike ticker, a
 * description too long once the rule's paragraph is added) is said on the name step beside the others, with an Edit link to its field,
 * and keeps Review disabled. Its per-hit lint lines are dropped because the sentence here already says them.
 */

interface LintRule { id: string; category: string; pattern: string; scope?: string }
interface LintAllowed { id: string; pattern: string }
const CFG = COPY_LINT as unknown as { rules: LintRule[]; allowed: LintAllowed[] };
/** The allowed spans the creator scope keeps masking (copyLint.ts lintCopy drops these five from the mask for creator text). */
const CREATOR_UNMASKED = new Set(["dollar-figures", "debt-to-the-penny", "treasury-posts", "buyback", "pump-fun"]);
const re = (p: string) => new RegExp(p, "giu");

export interface CreatorHit { phrase: string; category: string; rule: string; index: number }
/** lintCopy(text, cfg, { scope: "creator" }).hits, in the browser (test/burntickerWebsite25.test.ts pins the two to each other). */
export function creatorHits(text: string): CreatorHit[] {
  let masked = text;
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  for (const a of CFG.allowed) if (!CREATOR_UNMASKED.has(a.id)) masked = masked.replace(re(a.pattern), (m) => blank(m));
  const hits: CreatorHit[] = [];
  for (const r of CFG.rules) for (const m of masked.matchAll(re(r.pattern))) if (m[0]) hits.push({ phrase: text.slice(m.index!, m.index! + m[0].length), category: r.category, rule: r.id, index: m.index! });
  return hits.sort((a, b) => a.index - b.index || a.rule.localeCompare(b.rule));
}

/** What each kind of word does wrong, in plain words (each clause passes the copy lint itself). */
const CATEGORY_WHY: Record<string, string> = {
  "price-returns": "talk about what the coin is worth",
  promises: "make promises",
  "calls-to-buy": "urge people to trade it",
  urgency: "rush anyone",
  "hype-punctuation": "use hype symbols or rows of exclamation marks",
  "no-prizes": "suggest that anyone is paid",
  "no-affiliation": "claim a tie to anyone",
};
export type CheckedField = "name" | "ticker" | "note" | "description";
const FIELD_WORD: Record<CheckedField, string> = { name: "name", ticker: "ticker", note: "note", description: "description" };

const list = (xs: string[], last: string): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${last} ${xs[xs.length - 1]}`);
/** The phrase as the creator sees it: whole, quoted once; a run of exclamation marks is named, not quoted. */
const shown = (h: CreatorHit): string => (h.rule === "exclamation" ? "three exclamation marks" : `“${h.phrase.trim()}”`);

/**
 * One plain sentence for one field, or null when the field is clean. Words are listed once each (any case), in the order typed; a link
 * or an @handle is said as a link problem (the X, Telegram and website fields take links), never as a claimed tie.
 */
export function fieldRuleSentence(field: CheckedField, text: string): string | null {
  if (!text.trim()) return null;
  const hits = creatorHits(text);
  if (!hits.length) return null;
  const links = hits.filter((h) => h.rule === "link");
  const words: CreatorHit[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (h.rule === "link") continue;
    const k = h.rule === "exclamation" ? "!" : h.phrase.trim().toLowerCase();
    if (seen.has(k)) continue;
    // a phrase inside a link already said (".com" inside a URL) is not said again
    if (links.some((l) => h.index >= l.index && h.index < l.index + l.phrase.length)) continue;
    seen.add(k); words.push(h);
  }
  const keyOf = (h: CreatorHit) => (h.rule === "exclamation" ? "!" : h.phrase.trim().toLowerCase());
  // every reason a listed word was caught ("Guaranteed" is both a promise and a claimed tie), each reason once
  const whys = [...new Set(hits.filter((h) => h.rule !== "link" && seen.has(keyOf(h))).map((h) => CATEGORY_WHY[h.category] ?? "break the site's wording rules"))];
  const f = FIELD_WORD[field];
  const short = field === "name" || field === "ticker";
  if (!words.length) return short ? `The ${f} cannot have a link or an @handle.` : `The ${f} cannot have links or @handles, which go in the X, Telegram and website fields.`;
  const linkPart = links.length ? (short ? " or have a link" : " or have links") : "";
  const linkWhy = links.length && !short ? ", and links go in the X, Telegram and website fields" : "";
  return `The ${f} cannot use ${list(words.map(shown), "or")}${linkPart}, because a coin's own text cannot ${list(whys, "or")}${linkWhy}.`;
}

/** The note's one sentence: the lint's sentence when it finds something, else the page's quick read (noteProblemOf). */
export const noteIssue = (note: string): string | null => fieldRuleSentence("note", note) ?? noteProblemOf(note);

/** Every problem in one coin's profile fields: the library's (image, length, control characters, links) and the description's words. */
export function profileIssues(v: ProfileValue, generated: string | null = null): { field: ProfileField; text: string }[] {
  // sources-7 H2 (WIRING-SOURCES7): the coin's generated paragraph, so the room it leaves is checked on the name step
  const out = profileFieldProblems({ ...v, generated });
  const d = fieldRuleSentence("description", v.description);
  if (d) out.push({ field: "description", text: d });
  return out;
}

/** Beside the disabled Review button on the name step. */
export const NAME_STEP_BLOCKED = "Fix the fields marked in red first. Each one says what to change.";

/** The server's per-hit lint line (coinText.ts creatorTextProblems): said here as one sentence per field, so never repeated. */
export const isLintLine = (problem: string): boolean => /^(Coin [AB]\. )?The (name|ticker|note|description|link label) [“"][\s\S]*[”"] contains [“"][\s\S]*[”"], which is not allowed\./.test(problem);

export type FieldKey = ProfileField | "name" | "ticker" | "note";
/**
 * The field a server problem belongs to, so the name step can say it beside the others and link to it; null for a problem with the rule
 * itself (those stay on the review). "Coin B. " names side B.
 */
export function serverFieldOf(problem: string): { side: "a" | "b"; field: FieldKey } | null {
  const side: "a" | "b" = /^Coin B\. /.test(problem) ? "b" : "a";
  const p = problem.replace(/^Coin [AB]\. /, "");
  if (/^The (X|Telegram|Website) link\b/.test(p)) return { side, field: p.startsWith("The X") ? "x" : p.startsWith("The Telegram") ? "telegram" : "website" };
  if (/^links:/.test(p)) return { side, field: "x" };
  if (/\bdescription\b/i.test(p)) return { side, field: "description" };
  if (/\bnote\b/i.test(p)) return { side, field: "note" };
  if (/\btickers?\b/i.test(p) || /^That name is reserved/.test(p)) return { side, field: "ticker" };
  if (/\bnames?\b/i.test(p) || /^This launch is refused:/.test(p)) return { side, field: "name" };
  return null;
}

/** The server problems the name step owns: field problems only, minus the per-hit lint lines and anything the page already said. */
export function serverFieldProblems(problems: readonly string[], clientSaid: ReadonlySet<string>): { side: "a" | "b"; field: FieldKey; text: string }[] {
  const norm = (x: string) => x.replace(/^Coin [AB]\. /, "").replace(/\.$/, "").toLowerCase();
  const out: { side: "a" | "b"; field: FieldKey; text: string }[] = [];
  for (const x of problems) {
    if (isLintLine(x) || clientSaid.has(norm(x))) continue;
    const f = serverFieldOf(x);
    if (f && !out.some((o) => o.text === x)) out.push({ ...f, text: x });
  }
  return out;
}
