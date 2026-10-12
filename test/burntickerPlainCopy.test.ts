// website-9 (2026-10-11): THE PLAIN-ENGLISH BAR, held for every page. The owner: "a lot of the text in the website reads like AI wrote it.
// a lot of shorthand. make it sound less AI and more like natural language." This test collects the copy a visitor reads — the JSX text
// and string literals of every /burnticker page and shared component, the shared copy modules, the current-status object and the
// operator view the API serves, the prose fields of the config files they read, the static pages (home, status, fallback, $DEFICIT,
// whitepaper) and docs/burnticker/CHECK-THIS-YOURSELF.md — and fails on the shorthand the copy pass removed:
//   " → " arrows · " / " stacks of three or more · " · " inside headings and disclosure labels · "(n)" counts in prose ·
//   TODO_ tokens in prose · "requirement(s)"-style plurals · bare identifiers (burn_receipts, pair_curve, PlatformConfig., OPERATOR_TREASURY)
//   outside code, table cells and a parenthesis that follows the plain name.
// Code, <pre>, table cells and generated blocks owned by other tests (the daily post mirrored from src/lib/launch/dailyPost.ts) are skipped.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ALL_TRUSTPACK_COPY, PLACEHOLDER_SENTENCES } from "@/lib/burnticker/trustpack/copy";
import { buildCurrentStatus, type ChainFacts } from "@/lib/burnticker/currentStatus";
import { upgradeAuthorityText, upgradeDelaySummary } from "@/lib/burnticker/currentStatusText";
import { loadOperator, signedMessageView } from "@/lib/burnticker/trustpack/operator";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const walk = (dir: string, ext: RegExp): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
  const rel = path.join(dir, e.name);
  return e.isDirectory() ? walk(rel, ext) : ext.test(e.name) ? [rel] : [];
});

// ---- the banned patterns ----

const IDENTIFIERS = ["burn_receipts", "pair_curve", "PlatformConfig\\.\\w+", "OPERATOR_TREASURY"];
/** an identifier is bare unless it sits in a parenthesis after its plain name, or in backticks */
const BARE_ID = new RegExp(`(?<![(\`\\w/.-])(?:${IDENTIFIERS.join("|")})(?![)\`\\w])`);
const PROSE_RULES: { id: string; re: RegExp }[] = [
  { id: "arrow", re: /[\w$%)]\s*→\s*[\w$(]/ },   // "A → B" (a trailing "→" on a link's own text is an affordance, not shorthand)
  { id: "slash-stack", re: /[^\s/]+ \/ [^\s/]+ \/ [^\s/]+/ },
  { id: "count-in-parens", re: /\((?:\d+|N)\)/ },
  { id: "todo-token", re: /\bTODO_[A-Z0-9_]+/ },
  { id: "plural-s", re: /[a-z]\(s\)/ },
  { id: "bare-identifier", re: BARE_ID },
];
const HEADING_RULES: { id: string; re: RegExp }[] = [{ id: "middot-in-heading", re: / · |\{" · "\}|\{' · '\}/ }];

interface Hit { where: string; rule: string; text: string }
const hits: Hit[] = [];
function checkProse(text: string, where: string): void {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return;
  for (const r of PROSE_RULES) if (r.re.test(t)) hits.push({ where, rule: r.id, text: t.slice(0, 160) });
}
function checkHeading(text: string, where: string): void {
  for (const r of HEADING_RULES) if (r.re.test(text)) hits.push({ where, rule: r.id, text: text.replace(/\s+/g, " ").trim().slice(0, 160) });
  checkProse(exprAs(text), where);
}

// ---- collectors ----

/** Removes what is not prose from JSX/HTML: code spans, <pre>, table cells, comments. */
const stripNonProse = (src: string): string => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<code\b[^>]*>[\s\S]*?<\/code>/g, " ")
  .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/g, " ")
  .replace(/<td\b[^>]*>[\s\S]*?<\/td>/g, " ")
  .replace(/<th\b[^>]*>[\s\S]*?<\/th>/g, " ")
  .replace(/(<div class="row">)<span>[^<]*<\/span>/g, "$1");   // a static page's label/value row is a table row

/** Headings and disclosure labels, raw (so a {" · "} separator inside one is seen). */
const headings = (src: string): string[] => [...src.matchAll(/<(h[1-6]|summary)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => m[2].replace(/<[^>]+>/g, " "));

/** A {…} expression as the reader sees it: N when it is a count, X otherwise (so "({x.length})" is a count, "({detail})" is not). */
const COUNTISH = /\.length\b|\bcount\b|Count\b|\.size\b|\btotal\b|\bn\b/;
const exprAs = (src: string): string => src.replace(/\$?\{([^{}<>]*)\}/g, (_m, e: string) => (COUNTISH.test(e) ? "N" : "X"));
/** JSX text nodes: the text between tags, with code fragments dropped. */
const CODEISH = /[;=⇒≤]|&&|\|\||\?\.|\(\(|\)\)|^\s*[})\]]|\b(const|return|className|key)\b/;
const jsxTextNodes = (src: string): string[] => [...exprAs(stripNonProse(src).replace(/=>/g, "⇒").replace(/[<>]=/g, "≤")).matchAll(/>([^<>]*[A-Za-z][^<>]*)</g)]
  .map((m) => m[1]).filter((s) => !CODEISH.test(s) && /[A-Za-z]{2,}\s+[A-Za-z]/.test(s));

/** Sentence-like string literals: at least three words and a letter run, not a class list, path, regex or import. */
const isClassList = (s: string) => s.trim().split(/\s+/).every((w) => /^[a-z0-9:!\-[\]/.%#()_]+$/.test(w) && /-|^(flex|grid|block|hidden|underline|italic|uppercase|truncate|border|rounded|shadow|sr-only|relative|absolute|inline)$/.test(w));
const proseLiterals = (src: string): string[] => {
  const code = src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, " ").replace(/^import .*$/gm, " ");
  const out: string[] = [];
  for (const m of code.matchAll(/"((?:[^"\\\n]|\\.){12,})"|`((?:[^`\\]|\\.){12,}?)`/g)) {
    const s = exprAs((m[1] ?? m[2]).replace(/\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, (_x, e: string) => `{${e.replace(/[{}]/g, "")}}`));
    if (/=>|;|&&|\|\||\bconst\b|\bcatch\b/.test(m[0]) || !/[A-Za-z]{3,}(?:\s+\S+){2,}/.test(s) || isClassList(s) || /^(https?:|\/|\.\/|@\/)/.test(s) || /\\[dswb]|\(\?[:<=!]/.test(s)) continue;
    out.push(stripNonProse(s).replace(/<[^>]+>/g, " "));
  }
  return out;
};

/** The visible text of a static page: markup text outside scripts and styles, plus the sentence-like literals its scripts render. */
function staticPageCopy(rel: string): { prose: string[]; heads: string[] } {
  const html = read(rel).replace(/\/\* @daily-post-begin[\s\S]*?@daily-post-end \*\//g, " ");
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, " ");
  const body = stripNonProse(markup);
  const prose = [...body.matchAll(/>([^<>]*[A-Za-z][^<>]*)</g)].map((m) => m[1].replace(/&[a-z]+;|&#\d+;/g, " "))
    .concat([...markup.matchAll(/\b(?:content|title|alt|aria-label)="([^"]{12,})"/g)].map((m) => m[1]))
    .concat(scripts.flatMap((js) => [...js.replace(/^\s*\/\/.*$/gm, " ").matchAll(/"((?:[^"\\\n]|\\.){12,})"|'((?:[^'\\\n]|\\.){12,})'/g)].map((m) => m[1] ?? m[2]))
      .filter((s) => /[A-Za-z]{3,}(?:\s+\S+){2,}/.test(s) && !isClassList(s) && !/^(https?:|\/)/.test(s) && !/\\[dswb]/.test(s) && !/[<>]/.test(s)));
  return { prose, heads: headings(markup) };
}

/** Markdown prose: no tables, no code fences, no inline code. */
/** (List items that quote a Powers Register, "- (burn_receipts) …" / "- pair_curve: …", are the programs' own documentation, rendered as data.) */
const markdownProse = (md: string): string[] => md.replace(/```[\s\S]*?```/g, " ").split("\n")
  .filter((l) => !/^\s*\|/.test(l) && !/^- \(?(?:burn_receipts|pair_curve)\)?:? /.test(l)).map((l) => l.replace(/`[^`]*`/g, " "));

/** String values under prose keys, anywhere in an object. */
const PROSE_KEYS = /^(line|lines|note|text|summary|detail|reason|headline|why|intro|body|rule|rehearsalNote|how|label|title|keyControl|entityPending|status|primary|check|fix|recheck|deployed|design|timeLock|name)$/;
function proseFields(j: unknown, key = "", out: string[] = []): string[] {
  if (typeof j === "string") { if (PROSE_KEYS.test(key) && /\s/.test(j)) out.push(j); }
  else if (Array.isArray(j)) j.forEach((v) => proseFields(v, key, out));
  else if (j && typeof j === "object") for (const [k, v] of Object.entries(j)) proseFields(v, k, out);
  return out;
}

// ---- the surfaces ----

const PAGE_FILES = [...walk("src/app/burnticker", /\.tsx$/)];
/**
 * The library modules whose strings are page sentences (coin text, status, empty states, readiness, fees, trust, verify verdicts). The
 * rest of src/lib/burnticker is excluded on purpose: developer-facing API descriptions, technical refusal reasons shown behind a
 * "details" disclosure, stored event titles and transaction labels are data with their own tests.
 */
const COPY_MODULES = ["trustpack/copy.ts", "currentStatusText.ts", "currentStatus.ts", "describe.ts", "coinText.ts", "coinCard.ts", "emptyState.ts", "readiness.ts",
  "templates.ts", "fieldHelp.ts", "glossary.ts", "safeguards.ts", "verificationStatus.ts", "landingDoors.ts", "fees.ts", "pairFundsFlow.ts", "deficitPrelaunch.ts",
  "creatorLaunches.ts", "launchAvailability.ts", "launchGateState.ts", "trust.ts", "tokenPage.ts", "verifyMint.ts", "leagues.ts", "seasons.ts", "lockFees.ts", "wizard.ts"]
  .map((f) => `src/lib/burnticker/${f}`);

describe("plain-English copy: no shorthand on any page (website-9)", () => {
  test("every /burnticker page and shared component: JSX text, headings and sentence-like literals", () => {
    hits.length = 0;
    for (const f of PAGE_FILES) {
      const src = read(f);
      for (const h of headings(src)) checkHeading(h, f);
      for (const t of jsxTextNodes(src)) checkProse(t, f);
      for (const t of proseLiterals(src)) checkProse(t, f);
    }
    assert.deepEqual(hits, [], `\n${hits.map((h) => `${h.where} [${h.rule}] ${h.text}`).join("\n")}`);
  });

  test("the shared modules that write page sentences: their sentence-like literals", () => {
    hits.length = 0;
    for (const f of COPY_MODULES) for (const t of proseLiterals(read(f))) checkProse(t, f);
    assert.deepEqual(hits, [], `\n${hits.map((h) => `${h.where} [${h.rule}] ${h.text}`).join("\n")}`);
  });

  test("the shared copy modules and what the API serves for the operator and current-status pages", () => {
    hits.length = 0;
    for (const s of ALL_TRUSTPACK_COPY) checkProse(s, "trustpack/copy.ts");
    for (const s of Object.values(PLACEHOLDER_SENTENCES)) { checkProse(s, "PLACEHOLDER_SENTENCES"); assert.doesNotMatch(s, /TODO_/); }
    const facts = (tl: number | null): ChainFacts => ({ cluster: "mainnet", readAt: "2026-10-11T20:00:00.000Z", error: tl === null ? "down" : null, squads: tl === null ? null : { threshold: 2, timeLockSecs: tl, members: 3 }, programs: {} });
    for (const [env, chain] of [[{}, {}], [{ BURNTICKER_CLUSTER: "mainnet", BURNTICKER_PROGRAM_ID: "AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM" }, { mainnet: facts(0) }], [{}, { mainnet: facts(null) }], [{}, { mainnet: facts(172800) }]] as const) {
      const s = buildCurrentStatus({ root: ROOT, env, chain, now: 0 });
      for (const l of s.lines) checkProse(l, "current-status lines");
      checkProse(s.host.line, "current-status host line");
      for (const u of s.upgradeAuthority) { checkProse(u.line, "time-lock line"); checkProse(u.why, "time-lock why"); }
      for (const p of s.programs) { checkProse(upgradeAuthorityText(p.devnet), "upgrade authority"); checkProse(p.mainnet.line, "mainnet line"); }
      for (const t of proseFields({ settlement: s.settlement, reviews: s.reviews, releaseRequirements: s.releaseRequirements, design: s.design, attesters: s.attesters, phase: s.phase })) checkProse(t, "current-status.json");
    }
    for (const tl of [null, 0, 172800]) checkProse(upgradeDelaySummary(tl), "upgrade delay");
    const op = loadOperator(ROOT);
    checkProse(signedMessageView(op).detail, "signed statement");
    const { clusters, operator, signedMessage, neverBuys } = op;
    for (const t of proseFields({ operator: { name: operator.name, entityPending: operator.entityPending }, clusters, how: signedMessage.how, neverBuys })) checkProse(t, "operator.json");
    assert.deepEqual(hits, [], `\n${hits.map((h) => `${h.where} [${h.rule}] ${h.text}`).join("\n")}`);
  });

  test("the static pages (home, status, fallback, $DEFICIT, whitepaper) and docs/burnticker/CHECK-THIS-YOURSELF.md", () => {
    hits.length = 0;
    for (const f of ["site/burnticker/index.html", "site/burnticker/status/index.html", "site/burnticker/fallback/index.html", "site/deficit/index.html", "site/burnticker/whitepaper.html"]) {
      const { prose, heads } = staticPageCopy(f);
      for (const h of heads) checkHeading(h, f);
      for (const t of prose) checkProse(t, f);
    }
    for (const l of markdownProse(read("docs/burnticker/CHECK-THIS-YOURSELF.md"))) checkProse(l, "CHECK-THIS-YOURSELF.md");
    assert.deepEqual(hits, [], `\n${hits.map((h) => `${h.where} [${h.rule}] ${h.text}`).join("\n")}`);
  });

  test("the rules catch what they are for (each banned pattern trips, plain sentences pass)", () => {
    hits.length = 0;
    for (const [bad, rule] of [
      ["Signing → quorum 1", "arrow"], ["fix / re-check / deployed", "slash-stack"], ["Open before release (8)", "count-in-parens"],
      ["the key is TODO_MAINNET_KEEPER", "todo-token"], ["Open before release: 8 requirement(s).", "plural-s"],
      ["via OPERATOR_TREASURY", "bare-identifier"], ["PlatformConfig.platformClaimFeeWallet holds it", "bare-identifier"], ["three reviews of burn_receipts", "bare-identifier"],
    ] as const) { hits.length = 0; checkProse(bad, "probe"); assert.ok(hits.some((h) => h.rule === rule), `${bad} should trip ${rule}`); }
    hits.length = 0; checkHeading('Review findings: fix{" · "}re-check', "probe"); assert.ok(hits.some((h) => h.rule === "middot-in-heading"));
    hits.length = 0;
    for (const ok of ["One signer, run by the operator, signs every reading. There is no independent second signer yet.", "Eight things are still open before release.",
      "The program that records burns (burn_receipts) is deployed on devnet.", "Review findings: what was fixed, what was re-checked, what is deployed", "The wallet is set. The statement is not signed yet."]) checkProse(ok, "probe");
    assert.deepEqual(hits, []);
  });
});
