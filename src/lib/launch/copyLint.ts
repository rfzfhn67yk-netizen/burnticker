import fs from "node:fs";
import path from "node:path";

/**
 * THE COPY LINT (the owner, 2026-10-09: "make sure posts don't violate that rule"). One rule for every post, page and card: report,
 * do not promote — no price talk, no promises, no calls to buy, no "coming soon", no hype punctuation. The forbidden list lives in
 * config/launch/copy-lint.json by CATEGORY with the rule each category enforces; an ALLOWED list masks the phrases that look like
 * violations but are mechanics or data (the disclaimer sentence itself says "price"; "Debt to the Penny" says "to the"; the $1 spend
 * floor says "floor"; debt figures are dollars).
 *
 * `lintCopy` returns every hit with the offending phrase, its category, the rule id and the reference the owner can read; the draft
 * script refuses to print on any hit and exits non-zero. Pure apart from `loadCopyLintConfig`, which reads the JSON once.
 */

export const COPY_LINT_FILE = path.join("config", "launch", "copy-lint.json");
export const COPY_LINT_SCHEMA = "burnticker.copy-lint/v1";

export interface CopyLintRule { id: string; category: string; pattern: string; note?: string; /** "creator": applies only to creator-supplied text (lintCopy's scope option) */ scope?: "creator" }
export interface CopyLintAllowed { id: string; pattern: string; note?: string }
export interface CopyLintConfig {
  schema: typeof COPY_LINT_SCHEMA; note?: string; maxChars: number; linkCountsAs: number;
  categories: Record<string, { ref: string; why: string; scope?: "creator" }>;
  rules: CopyLintRule[]; allowed: CopyLintAllowed[];
}
export interface CopyLintHit { phrase: string; category: string; rule: string; ref: string; why: string; index: number; line: number }
export interface CopyLintResult {
  ok: boolean; hits: CopyLintHit[];
  /** Soft notes that do not fail the lint: length over the X limit, an unfilled placeholder. */
  warnings: string[];
  /** The X-style length: every URL counts as `linkCountsAs` characters. */
  xLength: number;
}

let cached: { root: string; cfg: CopyLintConfig } | null = null;
export function loadCopyLintConfig(root = process.cwd()): CopyLintConfig {
  if (cached && cached.root === root) return cached.cfg;
  const j = JSON.parse(fs.readFileSync(path.join(root, COPY_LINT_FILE), "utf8")) as CopyLintConfig;
  if (j.schema !== COPY_LINT_SCHEMA || !Array.isArray(j.rules) || !Array.isArray(j.allowed) || !j.categories) throw new Error(`${COPY_LINT_FILE}: not a ${COPY_LINT_SCHEMA} file`);
  for (const r of j.rules) if (!j.categories[r.category]) throw new Error(`${COPY_LINT_FILE}: rule ${r.id} names an unknown category ${r.category}`);
  cached = { root, cfg: j };
  return j;
}

const re = (p: string) => new RegExp(p, "giu");
const URL_RE = /https?:\/\/[^\s)\]}>"']+/g;

/** The X character count: links count as 23 regardless of length (X's t.co wrapping). */
export function xLength(text: string, linkCountsAs = 23): number {
  let n = 0, last = 0;
  for (const m of text.matchAll(URL_RE)) { n += [...text.slice(last, m.index)].length + linkCountsAs; last = m.index! + m[0].length; }
  return n + [...text.slice(last)].length;
}

/** Replaces every allowed span and every URL with spaces of the same length, so the forbidden patterns cannot see them. */
export function maskAllowed(text: string, cfg: CopyLintConfig, keepUrls = false): string {
  let out = text;
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  if (!keepUrls) out = out.replace(URL_RE, (m) => blank(m));
  for (const a of cfg.allowed) out = out.replace(re(a.pattern), (m) => blank(m));
  return out;
}

/**
 * `opts.scope: "creator"` lints text a creator typed (a coin's name, ticker, creator's note): the creator-scoped rules (no-affiliation:
 * official, endorsed, partner…, links and handles) apply on top of every platform rule, and nothing is masked as "allowed" except the
 * disclaimer phrases. Platform copy (posts, pages, the generated description) skips the creator-scoped rules.
 */
export function lintCopy(text: string, cfg: CopyLintConfig = loadCopyLintConfig(), opts: { scope?: "creator" | "platform" } = {}): CopyLintResult {
  const creator = opts.scope === "creator";
  const masked = creator ? maskAllowed(text, { ...cfg, allowed: cfg.allowed.filter((a) => !["dollar-figures", "debt-to-the-penny", "treasury-posts", "buyback", "pump-fun"].includes(a.id)) }, true) : maskAllowed(text, cfg);
  const hits: CopyLintHit[] = [];
  for (const r of cfg.rules) {
    if (r.scope === "creator" && !creator) continue;
    const cat = cfg.categories[r.category];
    for (const m of masked.matchAll(re(r.pattern))) {
      if (!m[0]) continue;
      const index = m.index!;
      hits.push({ phrase: text.slice(index, index + m[0].length), category: r.category, rule: r.id, ref: cat.ref, why: cat.why, index, line: text.slice(0, index).split("\n").length });
    }
  }
  hits.sort((a, b) => a.index - b.index || a.rule.localeCompare(b.rule));
  const warnings: string[] = [];
  const len = xLength(text, cfg.linkCountsAs);
  if (len > cfg.maxChars) warnings.push(`length ${len} > ${cfg.maxChars} (links count as ${cfg.linkCountsAs}): a Premium long post or a thread`);
  for (const m of text.matchAll(/\{[A-Z_]{2,}[^}]*\}/g)) warnings.push(`unfilled placeholder ${m[0]}`);
  return { ok: hits.length === 0, hits, warnings, xLength: len };
}

/** One line per hit, the way the script prints them. */
export function formatHits(r: CopyLintResult): string {
  return r.hits.map((h) => `line ${h.line}: "${h.phrase}" — ${h.category} (rule ${h.rule}) · ${h.ref}`).join("\n");
}

/** Throws with every hit listed; the templates call this before any text leaves the process. */
export function assertClean(text: string, what: string, cfg: CopyLintConfig = loadCopyLintConfig()): string {
  const r = lintCopy(text, cfg);
  if (!r.ok) throw new Error(`copy lint: ${what} violates the copy rule:\n${formatHits(r)}`);
  return text;
}
