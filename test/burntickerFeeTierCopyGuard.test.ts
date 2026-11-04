// HS-79 (eighth pass, B-23 / HB-184): every page said coins made before 19 October 2026 "(every coin live today) pay 1% per swap after
// graduation (fee tier 9)". Under the owner's B-17 decision LaunchLab moves every graduating coin into a pool on the platform's current
// fee tier, so every coin pays that tier. This guard fails when a public copy source names the old tier's split, or when the site-wide
// fee line names a tier other than the platform's (cpmmTier.ts CPMM_TIER.mainnet).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { BOTH_TIERS_LINE, EARLIER_COINS_LINE, FEE_TIER_DECIDER_LINE, feeTiersLine, footerFeeLine } from "@/lib/burnticker/feeShareLine";
import { CPMM_TIER } from "@/lib/burnticker/cpmmTier";
import { BURNTICKER_DEV_FEE_BPS, feeSplitSentence, postGraduationFeesFor } from "@/lib/burnticker/fees";
import { lintCopy } from "@/lib/launch/copyLint";

const OLD = /fee tier 9\b|tier 9\)|0\.88%|0\.04% to the operator|every coin live today|which stay on tier 9|AmmConfig index 9/;
const SOURCES = [
  "site/burnticker/index.html", "site/burnticker/whitepaper.html", "site/burnticker/fallback/index.html", "site/burnticker/notfound/index.html",
  "site/burnticker/status/index.html", "site/burnticker/error/index.html", "site/deficit/index.html", "docs/burnticker/WHITEPAPER.md",
  "config/burnticker/transparency.json",
];

test("the site-wide fee line is the platform's tier, in the HS-71 words, lint-clean", () => {
  const t = CPMM_TIER.mainnet;
  for (const s of [BOTH_TIERS_LINE, feeTiersLine({ tier14Live: false }), feeTiersLine({ tier14Live: null }), EARLIER_COINS_LINE, footerFeeLine(BURNTICKER_DEV_FEE_BPS, { tier14Live: false }), FEE_TIER_DECIDER_LINE]) {
    assert.doesNotMatch(s, OLD, s); assert.deepEqual(lintCopy(s).hits, [], s);
    for (const m of s.matchAll(/fee tier (\d+)/g)) assert.equal(Number(m[1]), t.index, `names tier ${m[1]}, the platform is on ${t.index}: ${s}`);
  }
  assert.match(BOTH_TIERS_LINE, new RegExp(`^After graduation, every coin pays [\\d.]+% per swap \\(Raydium fee tier ${t.index}\\)`));
  assert.match(BOTH_TIERS_LINE, /coins made before 19 October 2026 recorded tier 9 when they were created and pay [\d.]+% all the same\.$/);
});

test("a coin's own fee sentence and split use the platform's tier, not the tier it recorded (no 'AmmConfig index 9' dial)", () => {
  const s = JSON.stringify(postGraduationFeesFor("mainnet")) + feeSplitSentence("mainnet");
  assert.doesNotMatch(s, OLD);
  assert.match(fs.readFileSync("src/lib/burnticker/tokenPage.ts", "utf8"), /const postGraduation = postGraduationFeesFor\(i\.chain\.cluster\);/);
});

test("no public copy source keeps the old tier-9 split", () => {
  for (const f of SOURCES) assert.doesNotMatch(fs.readFileSync(f, "utf8"), OLD, f);
});
