// WEBSITE AUDIT 4 (2026-10-11), BT-10/BT-15/BT-16/BT-17/BT-21: pre-launch CTAs match the closed state, every homepage module carries its
// evidence state (verified devnet / illustrative / historical replay / proposed mainnet), 1% vs 2% sits beside both figures, the intro
// starts with three plain steps, and search/social previews and robots.txt describe the site as it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const home = read("site/burnticker/index.html");

test("BT-10: the Derby creation CTA and the app header's Launch follow the launch state", () => {
  const d = read("src/app/burnticker/derby/page.tsx");
  assert.match(d, /const launchOpen = launchAvailability\(\)\.open;/);
  assert.match(d, /\{launchOpen\s*\n?\s*\? <Link[^>]*href=\{`\/burnticker\/launch\?derby=1/);
  assert.match(d, /data-launch-closed/);
  const h = read("src/app/burnticker/_components/SiteHeader.tsx");
  assert.match(h, /\$\{launchOpen \? " is-launch" : ""\}/); assert.match(h, /!launchOpen \? LAUNCH_LABELS\.closed/);
});

test("BT-16: each homepage module carries a readable evidence-state label; 1% and 2% are explained where each appears", () => {
  // site audit #7 (2026-10-11) removed the illustrative modules (ticker tape, sample receipt, sample boards); the three that remain keep theirs
  for (const [label, n] of [["st ver\">Verified devnet", 1], ["st rep\">Historical replay", 1], ["st pro\">Proposed mainnet rule, not launched", 1]] as const)
    assert.ok((home.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length >= n, label);
  assert.doesNotMatch(home, /Illustrative example/, "no illustrative module left without its label");
  assert.match(home, /\.st\{display:inline-block;margin:0 0 8px;font:700 \.75rem/, "labels at a readable size (≥ 12 px)");
  assert.match(home, /This rehearsal coin spent 1% of its burn pool for each \$1 billion unit\. The rule proposed for mainnet spends 2%\./);
  assert.match(home, /The devnet rehearsal coin ran the same rule text at 1% per unit/);
  assert.match(read("src/app/burnticker/_components/BurnMath.tsx"), /That rehearsal coin spent 1% of the burn pool per unit, and the rule proposed for \$DEFICIT on mainnet is 2%/);
});

test("BT-17: the intro leads with three plain steps", () => {
  const steps = /<ol class="three"[^>]*>([\s\S]*?)<\/ol>/.exec(home)![1];
  assert.equal((steps.match(/<li>/g) ?? []).length, 3);
  assert.ok(home.indexOf('<ol class="three"') < home.indexOf('id="verified-burn"'), "before the proof card");
});

test("BT-21: previews do not invite launching while launches are closed; robots.txt declares the sitemap", () => {
  for (const m of home.matchAll(/<meta (?:name|property)="(?:description|og:description)" content="([^"]*)"/g)) { assert.doesNotMatch(m[1], /Launch one/); assert.match(m[1], /creator launches are closed/i); }
  assert.doesNotMatch(read("config/public-repo/overlay/src/app/layout.tsx"), /Launch one\./);
  assert.match(read("site/burnticker/robots.txt"), /^Sitemap: https:\/\/burnticker\.com\/sitemap\.xml$/m);
});
