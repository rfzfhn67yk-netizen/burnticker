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
  // since 2026-10-12 (the owner's review item 3): "Launch a coin" goes to the launch page while launches are open and opens the
  // closed-launches dialog otherwise; the tab bar stamps Launch only while open
  const h = read("src/app/burnticker/_components/SiteHeader.tsx");
  assert.match(h, /\{launchOpen\s*\? <Link className="bt-launch-btn bt-launch-head" href="\/burnticker\/launch"[\s\S]*?: <button type="button" className="bt-launch-btn bt-launch-head" onClick=\{\(\) => setModal\(true\)\}/);
  assert.match(read("src/app/burnticker/_components/TabBar.tsx"), /t\.href === "\/burnticker\/launch" && launchOpen \? " is-launch" : ""/);
});

test("BT-16: each homepage card carries a readable state label; 1% and 2% sit beside each figure (featured cards since 2026-10-12)", async () => {
  // the home's modules are the featured cards now (src/lib/burnticker/home.ts): $DEFICIT featured with its locked 2% rule, $REHEARSAL
  // tagged as the mainnet rehearsal, the devnet rehearsal coin tagged devnet with its own 1% rule, each read from its rules file
  const { featuredCoins } = await import("@/lib/burnticker/home");
  const f = featuredCoins(ROOT);
  assert.deepEqual(f.map((c) => c.tags.map((t) => t.label).join(" ")), ["Featured", "Mainnet rehearsal", "Devnet"]);
  assert.match(f[0].rule, /^Spends 2% of its burn pool for each \$1B the U\.S\. national debt rises/);
  assert.match(f[2].rule, /^Spends 1% of its burn pool for each \$1B the U\.S\. national debt rises/);
  assert.doesNotMatch(home, /Illustrative example/, "no illustrative module left without its label");
  assert.match(home, /\.tag\{display:inline-block;font:700 10px\/1/, "labels on the static home's cards");
  assert.match(read("src/app/burnticker/about/page.tsx"), /The devnet rehearsal coin ran the same rule text at 1% for each unit\./);
  assert.match(read("src/app/burnticker/_components/BurnMath.tsx"), /That rehearsal coin spent 1% of the burn pool per unit, and the rule proposed for \$DEFICIT on mainnet is 2%/);
});

test("BT-17: the intro leads with three plain steps (the How it works strip under the one-line hero)", () => {
  const steps = /<ol class="how"[^>]*>([\s\S]*?)<\/ol>/.exec(home)![1];
  assert.equal((steps.match(/<li>/g) ?? []).length, 3);
  assert.ok(home.indexOf('<ol class="how"') < home.indexOf("data-featured"), "before the coin grid");
});

test("BT-21: previews do not invite launching while launches are closed; robots.txt declares the sitemap", () => {
  for (const m of home.matchAll(/<meta (?:name|property)="(?:description|og:description)" content="([^"]*)"/g)) { assert.doesNotMatch(m[1], /Launch one/); assert.match(m[1], /creator launches are closed/i); }
  assert.doesNotMatch(read("config/public-repo/overlay/src/app/layout.tsx"), /Launch one\./);
  assert.match(read("site/burnticker/robots.txt"), /^Sitemap: https:\/\/burnticker\.com\/sitemap\.xml$/m);
});
