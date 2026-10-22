import COPY_LINT from "../../../config/launch/copy-lint.json" with { type: "json" };

/**
 * A GENERATED NAME THE NAME FIELD ACCEPTS (2026-10-22 external audit BT-FADE-GENERATED-NAME-01: Published data, U.S. egg price, "When it
 * does not happen" suggested "No Move U.S. egg price", and the creator-scope copy lint refuses "price" in a name, so Review was disabled
 * before the creator typed anything). The suggestion is the platform's own words placed in the creator's field, so it must pass the same
 * check the creator's own text does: the copy lint's creator scope (config/launch/copy-lint.json, masked the way src/lib/launch/copyLint.ts
 * lintCopy masks creator text and src/app/burnticker/launch/fieldChecks.ts creatorHits mirrors in the browser). Any word a rule catches is
 * dropped from the suggestion; the restriction on what the creator types is unchanged. Pure and client-safe (the JSON is bundled).
 */
interface LintRule { id: string; category: string; pattern: string }
interface LintAllowed { id: string; pattern: string }
const CFG = COPY_LINT as unknown as { rules: LintRule[]; allowed: LintAllowed[] };
/** The allowed spans the creator scope does not mask (copyLint.ts lintCopy). */
const CREATOR_UNMASKED = new Set(["dollar-figures", "debt-to-the-penny", "treasury-posts", "buyback", "pump-fun"]);
const re = (p: string) => new RegExp(p, "giu");

/** The [start, end) spans of `text` that the creator-scope lint catches. */
export function creatorLintSpans(text: string): [number, number][] {
  let masked = text;
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  for (const a of CFG.allowed) if (!CREATOR_UNMASKED.has(a.id)) masked = masked.replace(re(a.pattern), (m) => blank(m));
  const out: [number, number][] = [];
  for (const r of CFG.rules) for (const m of masked.matchAll(re(r.pattern))) if (m[0]) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

const JOINERS = /^(vs\.?|v|of|the|a|an|and|or|for|on|in|by|to|at|—|-|&|,)$/i;

/** `name` with every word the creator-scope lint catches dropped; `fallback` when nothing clean is left. */
export function creatorSafeName(name: string, fallback = "Data Coin"): string {
  let cur = name.replace(/\s+/g, " ").trim();
  for (let pass = 0; pass < 4; pass++) {
    const spans = creatorLintSpans(cur);
    if (!spans.length) return cur || fallback;
    const words: { w: string; s: number; e: number }[] = [];
    for (const m of cur.matchAll(/\S+/g)) words.push({ w: m[0], s: m.index!, e: m.index! + m[0].length });
    const kept = words.filter((x) => !spans.some(([s, e]) => s < x.e && e > x.s)).map((x) => x.w);
    while (kept.length && JOINERS.test(kept[kept.length - 1])) kept.pop();
    while (kept.length && JOINERS.test(kept[0]) && !/^the$/i.test(kept[0])) kept.shift();
    const next = kept.join(" ").replace(/[,:;—&-]+$/, "").trim();
    if (!next || next === cur) break;
    cur = next;
  }
  return creatorLintSpans(cur).length || !cur ? fallback : cur;
}
