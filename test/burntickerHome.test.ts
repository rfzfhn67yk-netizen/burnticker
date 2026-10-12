// THE SHORT HOMEPAGE (site audit #7/#8/#15/#20, ChatGPT audit R07 and BT-17, 2026-10-11; list-first since website-10, 2026-10-12: hero,
// How it works, the coin grid, Follow the season, the short status). The page was 2,660 words and stated the
// same facts three or four times. Now: hero → verified devnet receipt → three product cards → a short current status (from the API,
// linking Trust) → one row of actions → footer, at most 1,000 words, every fact once, headings in order, one primary button per section.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { ADMISSION_RULES, GUARDRAIL_SUMMARY, SAFEGUARDS, WHO_GETS_WHAT } from "@/lib/burnticker/safeguards";

const home = fs.readFileSync("site/burnticker/index.html", "utf8");
const body = home.slice(home.indexOf("<body>"));
/** What a visitor reads with every disclosure closed: no scripts, styles, SVG, closed <details> bodies or the duplicate phone menu. */
const visible = body.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<details class="menu"[\s\S]*?<\/details>/, "")
  .replace(/<details>(\s*<summary>[^<]*<\/summary>)[\s\S]*?<\/details>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
const words = visible.split(/\s+/).filter((w) => /[A-Za-z0-9$]/.test(w));

test("site audit #7: at most 1,000 words before the status loads, leaving room for its four lines (~120 words)", () => {
  assert.ok(words.length <= 880, `${words.length} words`);
});

test("site audit #8: each fact once — the attester and time-lock lines are not printed by the page (they arrive once, from the status API)", () => {
  for (const dup of [/quorum 1/i, /time lock/i, /no independent second attester/i, /Squads/]) assert.doesNotMatch(visible, dup, String(dup));
  // the status box shows only the phase, signing, upgrades and what is open
  assert.match(home, /var SHORT = \/signs every reading\|holds the upgrade authority\|still open before release\/;/);
  // the status box fails in plain words with a Retry, never a raw parser message
  assert.match(home, /We could not read the current status just now\./); assert.match(home, /b\.addEventListener\("click", load\)/);
  const statusScript = home.slice(home.indexOf("THE ONE CURRENT-STATUS SOURCE"), home.indexOf("<!-- site-shell:script:begin -->"));
  assert.doesNotMatch(statusScript, /r\.json\(\)/);
});

test("site audit #15: headings in the page's main run H1 → H2 → H3 with no skipped level (the closed-launches dialog's H2 sits outside it)", () => {
  const main = body.slice(body.indexOf("<main"), body.indexOf("</main>"));
  const levels = [...main.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  assert.equal(levels[0], 1); assert.equal(levels.filter((l) => l === 1).length, 1);
  for (let k = 1; k < levels.length; k++) assert.ok(levels[k] <= levels[k - 1] + 1, `h${levels[k - 1]} → h${levels[k]}`);
});

test("site audit #20: one primary (amber) button per section", () => {
  for (const sec of body.split(/<section\b/).slice(1)) assert.ok((sec.slice(0, sec.indexOf("</section>")).match(/class="btn amber"/g) ?? []).length <= 1, sec.slice(0, 80));
});

test("the moved copy (trust page) and the home pass the copy lint", () => {
  const cfg = loadCopyLintConfig();
  for (const t of [visible, GUARDRAIL_SUMMARY, ADMISSION_RULES, ...SAFEGUARDS.map((x) => x.text), ...WHO_GETS_WHAT.map((x) => x.text)]) { const r = lintCopy(t, cfg); assert.ok(r.ok, formatHits(r)); }
  // owner copy rule (2026-10-11): no arrow shorthand in what this pass wrote
  for (const t of [visible, ...SAFEGUARDS.map((x) => x.text), ...WHO_GETS_WHAT.map((x) => x.text)]) assert.doesNotMatch(t, /→|\s\/\s/);
});
