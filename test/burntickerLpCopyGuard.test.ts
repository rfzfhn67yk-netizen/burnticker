// THE COPY GUARD for two owner decisions of 2026-10-10:
//   1. LP LOCKED FOREVER (LAUNCHPAD-PATH §35): graduation LP is locked, not burned — so no public surface may still claim "All LP burned",
//      "LP burned", "LP 100 % burned" or "burns 100 % of the LP". The wording is "LP locked forever; its fees fund the burn (80% burned,
//      20% operator, fixed in code)" or a tighter equivalent. The program's own technical phrasing ("≥ 50 % of the LP burned or locked")
//      is not a claim and passes; so does a line that names the old policy as replaced ("replacing …", "it was …").
//   2. OPERATOR IDENTITY: the operator's name and state are not on any public surface ("one independent operator (United States)").
// Scope: src/, site/, docs/burnticker/ (the dated review reports in docs/burnticker/reviews/ are historical and excluded) and the public
// config. Each hit names the file and line.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TEXT = /\.(?:ts|tsx|mts|mjs|js|md|html|json|css|txt)$/;

function walk(dir: string, acc: string[] = []): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return acc;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.posix.join(dir, e.name);
    if (e.isSymbolicLink() || e.name === "node_modules" || e.name.startsWith(".")) continue;
    if (e.isDirectory()) walk(p, acc); else if (TEXT.test(e.name)) acc.push(p);
  }
  return acc;
}

const SCOPE = [...walk("src"), ...walk("site"), ...walk("docs/burnticker"), ...walk("config/burnticker"), ...walk("config/public-repo")]
  // the auditors' continuous folder is their own scratch (untracked reports, page sweeps, walk notes); it is not a public surface
  // the auditors' pass folders (prelaunch-*) are untracked evidence too; the public tree copies only git-tracked allowlisted files
  .filter((f) => !f.startsWith("docs/burnticker/reviews/") && !f.startsWith("docs/burnticker/audits/continuous/") && !f.startsWith("docs/burnticker/audits/prelaunch-"));

// ---- 1. LP burned → LP locked forever ----
const LP_BURNED_CLAIMS: RegExp[] = [
  /\ball (?:graduation )?LP (?:is |was )?burned\b/i,
  /\bLP (?:is |was )?burned\b(?!\s*(?:or|\/)\s*(?:locked|held))/i,
  /\bLP 100 ?% burned\b/i,
  /\b100 ?% (?:of (?:the )?)?(?:graduation )?LP (?:is )?burned\b/i,
  /\bburns? 100 ?% of (?:the )?(?:graduation )?LP\b/i,
];
/** A line that names the old policy as the thing replaced is history, not a claim. */
const NAMES_THE_OLD_POLICY = /\b(?:replacing|replaced|reverses|reversed|superseded|supersedes|earlier design|it was|was: burned|before this decision)\b/i;
/**
 * The program builder's files: their wording follows the program change on its own branch (burnticker/lp-lock: graduate no longer burns
 * the LP; lock_lp locks it) and arrives when that branch is merged. Listed here so this guard stays green in between; empty it after the merge.
 */
const PROGRAM_AGENT_OWNED = [/^src\/lib\/burnReceipts\//, /^src\/lib\/pairCurve\//];
const PROGRAM_AGENT_PENDING: [file: string, text: string][] = [];   // emptied 2026-10-10: the program builder rewrote its three lines

/** decisions.md is append-only: the entries before the reversal keep their words. */
function decisionHistoryLines(text: string): Set<number> {
  const out = new Set<number>();
  let old = false;
  text.split("\n").forEach((l, i) => { if (l.startsWith("## ")) old = /^## 2026-10-09\b/.test(l); if (old) out.add(i); });
  return out;
}

describe("LP locked forever: no public surface still claims the LP is burned", () => {
  test("src/, site/, docs/burnticker/ (not reviews/) and the public config carry no 'LP burned' claim", () => {
    const hits: string[] = [];
    for (const f of SCOPE) {
      if (PROGRAM_AGENT_OWNED.some((re) => re.test(f))) continue;
      const text = fs.readFileSync(path.join(ROOT, f), "utf8");
      const history = f === "docs/burnticker/decisions.md" ? decisionHistoryLines(text) : new Set<number>();
      text.split("\n").forEach((line, i) => {
        if (history.has(i) || NAMES_THE_OLD_POLICY.test(line)) return;
        if (PROGRAM_AGENT_PENDING.some(([pf, t]) => pf === f && line.includes(t))) return;
        for (const re of LP_BURNED_CLAIMS) {
          const m = re.exec(line);
          if (m) { hits.push(`${f}:${i + 1}: "${m[0]}" — ${line.trim().slice(0, 140)}`); break; }
        }
      });
    }
    assert.deepEqual(hits, [], `say "LP locked forever; its fees fund the burn (80% burned, 20% operator, fixed in code)" instead:\n${hits.join("\n")}`);
  });

  test("the guard catches the old claims and lets the program's technical phrasing through", () => {
    const claims = ["All LP burned", "all LP is burned at graduation", "LP burned at graduation: 100 %", "LP 100% burned", "100 % of graduation LP is burned", "our platform burns 100 % of graduation LP", "Creator earns nothing; all LP burned."];
    for (const c of claims) assert.ok(LP_BURNED_CLAIMS.some((re) => re.test(c)), c);
    const fine = ["burn_lp: the only path that destroys LP; used only if Raydium's lock refuses for 30 days", "≥ 50 % of the LP burned or locked", "90 % of LP burned or locked", "LP burned/locked", "LP locked forever; its fees fund the burn (80% burned, 20% operator, fixed in code)", "the burned LP's share"];
    for (const c of fine) assert.ok(!LP_BURNED_CLAIMS.some((re) => re.test(c)), c);
  });

  test("the policy line is the same words everywhere it is defined", () => {
    const LINE = "LP locked forever; its fees fund the burn (80% burned, 20% operator, fixed in code)";
    for (const f of ["src/lib/burnticker/lockFees.ts", "src/lib/burnticker/wizard.ts"]) assert.ok(fs.readFileSync(path.join(ROOT, f), "utf8").includes(LINE), f);
    // website-12 (ChatGPT A4): the review card says the exact scope of the 80 / 20 split (the SOL side of the locked LP's fees) and that it funds the burn pool
    const card = fs.readFileSync(path.join(ROOT, "src/app/burnticker/launch/ReviewCard.tsx"), "utf8");
    // fees copy (2026-10-12): the operator's share is said from the constants (feeShareLine.ts)
    assert.ok(card.includes("export const LP_LINE = `The pool's liquidity is locked forever. ${OPERATOR_SHARE_LINE}"), "the review card's LP line reads the operator share line");
    assert.ok(!card.includes(LINE), "the imprecise '80% burned' line is gone from the review card");
  });
});

// ---- 2. operator identity ----
/** Fixtures and data that name a Colorado team or race (not the operator), and the fifty-state tables (elections, SPC tornado reports). */
const COLORADO_OK = [/^config\/burnticker\/fixtures\//, /^config\/burnticker\/espn-teams\.json$/, /^src\/lib\/burnticker\/elections\.ts$/, /^src\/lib\/burnticker\/oracle\/events\.ts$/, /^src\/lib\/burnticker\/sources\/spc\.ts$/, /^src\/lib\/burnticker\/sources\/fbs\.ts$/];

describe("operator identity: neither the owner's name nor his state is on a public surface", () => {
  test("no 'Shane' / 'Cassidy' anywhere in scope, and no 'Colorado' outside the sports and election data", () => {
    const hits: string[] = [];
    for (const f of SCOPE) {
      const text = fs.readFileSync(path.join(ROOT, f), "utf8");
      if (/^config\/burnticker\/fixtures\//.test(f)) continue;   // third-party data (player names, races), not our copy
      const colorado = !COLORADO_OK.some((re) => re.test(f));
      text.split("\n").forEach((line, i) => {
        const m = /\b(?:Shane|Cassidy)\b/i.exec(line) ?? (colorado ? /\bColorado\b/i.exec(line) : null);
        if (m) hits.push(`${f}:${i + 1}: "${m[0]}" — ${line.trim().slice(0, 120)}`);
      });
    }
    assert.deepEqual(hits, [], hits.join("\n"));
  });
});
