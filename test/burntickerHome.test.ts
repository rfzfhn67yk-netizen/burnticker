// THE SHORT HOMEPAGE (site audit #7/#8/#15/#20, ChatGPT audit R07 and BT-17, 2026-10-11; list-first since website-10, 2026-10-12: hero,
// How it works, the coin grid, Follow the season, the short status). The page was 2,660 words and stated the
// same facts three or four times. Now: hero → verified devnet receipt → three product cards → a short current status (from the API,
// linking Trust) → one row of actions → footer, at most 1,000 words, every fact once, headings in order, one primary button per section.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { DEPLOYED_TIER_PIN_PENDING } from "@/lib/burnticker/deployedTierPin";
import { DEPLOYED_TIER_PIN_LINE } from "@/lib/burnticker/feeShareLine";
import { ADMISSION_RULES, GUARDRAIL_SUMMARY, SAFEGUARDS, WHO_GETS_WHAT } from "@/lib/burnticker/safeguards";

const home = fs.readFileSync("site/burnticker/index.html", "utf8");
const body = home.slice(home.indexOf("<body>"));
/** What a visitor reads with every disclosure closed: no scripts, styles, SVG, closed <details> bodies or the duplicate phone menu. */
const visible = body.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<details class="menu"[\s\S]*?<\/details>/, "")
  .replace(/<details>(\s*<summary>[^<]*<\/summary>)[\s\S]*?<\/details>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
const words = visible.split(/\s+/).filter((w) => /[A-Za-z0-9$]/.test(w));

test("site audit #7: at most 1,000 words before the status loads, leaving room for its four lines (~120 words)", () => {
  // HS-96: while the deployed burn program is pre-B17 the footer's fee row carries the tier-pin sentence (a temporary disclosure that
  // leaves by itself when config/burnticker/verified-build.json names the upgraded build); the budget allows exactly its words then
  const pinWords = DEPLOYED_TIER_PIN_PENDING ? DEPLOYED_TIER_PIN_LINE.split(/\s+/).filter((w) => /[A-Za-z0-9$]/.test(w)).length : 0;
  assert.ok(words.length <= 880 + pinWords, `${words.length} words`);
});

test("site audit #8: each fact once — the attester and time-lock lines are not printed by the page (they arrive once, from the status API)", () => {
  for (const dup of [/quorum 1/i, /time lock/i, /no independent second attester/i, /Squads/]) assert.doesNotMatch(visible, dup, String(dup));
  // website-13 (Claude site audit 2 item 9): one status line, built from the one current-status source by the home API (home.ts
  // homeStatusLine, fed by currentStatusLive), never retyped here; a failed read says so in plain words and still links the Trust page
  assert.match(home, /line\.appendChild\(document\.createTextNode\(j && j\.statusLine \? j\.statusLine \+ " " : "The current status did not load just now\. "\)\)/);
  assert.match(home, /a\.href = "\/burnticker\/trust"; a\.textContent = "The Trust page has the full record\.";/);
  // HB-145 second half: the status read is a bounded stage (past its budget the last good status is used)
  assert.match(fs.readFileSync("src/app/api/burnticker/home/route.ts", "utf8"), /clock\.bounded\("status", B\.statusMs, async \(\) => \{ const s = await currentStatusLive\(\); lastStatus = s; return s; \}/);
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
