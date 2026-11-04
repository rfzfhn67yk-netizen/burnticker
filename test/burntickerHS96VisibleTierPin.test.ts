// HS-96 (ninth pass B-27 / HB-209): the tier-pin sentence (feeShareLine.ts DEPLOYED_TIER_PIN_LINE) was only in the trust JSON and the
// collapsed evidence paragraph. The three visible fee paragraphs (the current-status fee line, the footer's fee row, the guardrails
// LP-lock item) now print it after "pay 1.25% all the same." while config/burnticker/verified-build.json records a pre-B17 burn program
// as deployed on mainnet, and drop it once the table names the B-17 build. Since 2026-10-21 (mainnet execute, vault transaction 4, slot
// 461421913) the table names the B-17 build, so the sentence is absent today; a fixture table with the round-5 hash brings it back.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BOTH_TIERS_LINE, DEPLOYED_TIER_PIN_LINE, bothTiersLineNow, footerFeeLine } from "@/lib/burnticker/feeShareLine";
import { DEPLOYED_TIER_PIN_PENDING, PRE_B17_PROGRAM_HASHES, tierPinPendingFor } from "@/lib/burnticker/deployedTierPin";
import { guardrailDetail, GUARDRAIL_DETAIL } from "@/lib/burnticker/safeguards";
import { buildCurrentStatus } from "@/lib/burnticker/currentStatus";
import { BURNTICKER_DEV_FEE_BPS } from "@/lib/burnticker/fees";
import { FOOTER_FEE_LINE } from "@/lib/burnticker/visibleFeeLines";
import { lintCopy } from "@/lib/launch/copyLint";

const VB_FILE = "config/burnticker/verified-build.json";
const vb = JSON.parse(fs.readFileSync(VB_FILE, "utf8"));
const ROUND5_MAINNET = "152929ce72292d2113655c09a193a15cb49443109e4db202efdbc68232520821";
/** The table as it read before the B-17 upgrade (2026-10-21 morning): deployed.mainnet names the round-5 build. */
function pendingTable() {
  const t = structuredClone(vb);
  const p = t.programs.find((x: { library: string }) => x.library === "burn_receipts");
  p.deployed.mainnet.hash = ROUND5_MAINNET;
  p.deployed.mainnet.matchesBuild = false;
  return t;
}
const PIN_AFTER = `pay 1.25% all the same. ${DEPLOYED_TIER_PIN_LINE}`;
const LP_ROW = "LP locked forever, its fees fund the burn";

test("the pending flag is one data fact read from the verified-build table", () => {
  const deployed = vb.programs.find((x: { library: string }) => x.library === "burn_receipts").deployed.mainnet.hash;
  assert.equal(deployed, "1aff5fbfe243ea8233c360bfae6809b0dd411e2298600831d10be5ea97c99e17", "today's table records the B-17 build on mainnet");
  assert.ok(!PRE_B17_PROGRAM_HASHES.has(deployed));
  assert.equal(DEPLOYED_TIER_PIN_PENDING, false);
  assert.equal(tierPinPendingFor(vb), false);
  assert.ok(PRE_B17_PROGRAM_HASHES.has(ROUND5_MAINNET));
  assert.equal(tierPinPendingFor(pendingTable()), true);
  assert.equal(tierPinPendingFor(null), true, "an unreadable table keeps the sentence");
  assert.equal(bothTiersLineNow(true), `${BOTH_TIERS_LINE} ${DEPLOYED_TIER_PIN_LINE}`);
  assert.equal(bothTiersLineNow(false), BOTH_TIERS_LINE);
});

test("the footer's fee row carries the sentence while pending and not after", () => {
  const before = footerFeeLine(BURNTICKER_DEV_FEE_BPS, { tier14Live: null, tierPinPending: tierPinPendingFor(pendingTable()) });
  assert.ok(before.includes(PIN_AFTER), before);
  assert.ok(before.indexOf(DEPLOYED_TIER_PIN_LINE) < before.indexOf("Coin-vs-coin pair pools"));
  const now = footerFeeLine(BURNTICKER_DEV_FEE_BPS, { tier14Live: null, tierPinPending: DEPLOYED_TIER_PIN_PENDING });
  assert.equal(FOOTER_FEE_LINE, now, "the static pages' footer is the same line");
  assert.ok(!now.includes(DEPLOYED_TIER_PIN_LINE), now);
  assert.ok(now.includes("pay 1.25% all the same. Coin-vs-coin pair pools"));
  assert.match(fs.readFileSync("src/app/burnticker/_components/SiteFooter.tsx", "utf8"), /footerFeeLine\(BURNTICKER_DEV_FEE_BPS, \{ tier14Live: tier14LiveNow\(\), tierPinPending: DEPLOYED_TIER_PIN_PENDING \}\)/);
  for (const f of ["site/burnticker/index.html", "site/deficit/index.html"]) assert.ok(!fs.readFileSync(f, "utf8").includes(DEPLOYED_TIER_PIN_LINE), f);
});

test("the guardrails LP-lock item carries the sentence while pending and not after", () => {
  assert.ok(guardrailDetail(tierPinPendingFor(pendingTable()))[LP_ROW].text.endsWith(PIN_AFTER));
  const now = GUARDRAIL_DETAIL[LP_ROW].text;
  assert.ok(now.endsWith(BOTH_TIERS_LINE) && !now.includes(DEPLOYED_TIER_PIN_LINE), now);
});

test("the current-status fee line carries the sentence while pending and not after (fixture table with the round-5 build deployed)", () => {
  const fee = (lines: string[]) => lines.find((l) => l.startsWith("The operator earns 0.25% of curve trading volume."))!;
  const now = fee(buildCurrentStatus({ env: {}, chain: {}, now: 0 }).lines);
  assert.ok(!now.includes(DEPLOYED_TIER_PIN_LINE), now);
  assert.ok(now.includes(`pay 1.25% all the same. The coin side of the liquidity fees is burned.`), now);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hs96-"));
  try {
    fs.cpSync("config/burnticker", path.join(root, "config/burnticker"), { recursive: true });
    fs.writeFileSync(path.join(root, VB_FILE), JSON.stringify(pendingTable(), null, 2));
    const before = fee(buildCurrentStatus({ root, env: {}, chain: {}, now: 0 }).lines);
    assert.ok(before.includes(`${PIN_AFTER} The coin side of the liquidity fees is burned.`), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("every visible fee paragraph passes the copy lint", () => {
  for (const s of [FOOTER_FEE_LINE, GUARDRAIL_DETAIL[LP_ROW].text, bothTiersLineNow(true), DEPLOYED_TIER_PIN_LINE]) assert.deepEqual(lintCopy(s).hits, [], s);
});
