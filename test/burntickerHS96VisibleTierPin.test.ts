// HS-96 (ninth pass B-27 / HB-209): the tier-pin sentence (feeShareLine.ts DEPLOYED_TIER_PIN_LINE) was only in the trust JSON and the
// collapsed evidence paragraph. The three visible fee paragraphs (the current-status fee line, the footer's fee row, the guardrails
// LP-lock item) now print it after "pay 1.25% all the same." while config/burnticker/verified-build.json records a pre-B17 burn program
// as deployed on mainnet, and drop it once the table names the B-17 build.
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
/** The table as it will read once the B-17 upgrade is deployed and read back: deployed.mainnet names the B-17 build. */
function upgradedTable() {
  const t = structuredClone(vb);
  const p = t.programs.find((x: { library: string }) => x.library === "burn_receipts");
  p.deployed.mainnet.hash = p.builds.mainnet.hash;
  return t;
}
const PIN_AFTER = `pay 1.25% all the same. ${DEPLOYED_TIER_PIN_LINE}`;
const LP_ROW = "LP locked forever, its fees fund the burn";

test("the pending flag is one data fact read from the verified-build table", () => {
  const deployed = vb.programs.find((x: { library: string }) => x.library === "burn_receipts").deployed.mainnet.hash;
  assert.ok(PRE_B17_PROGRAM_HASHES.has(deployed), "today's table records round 5 on mainnet");
  assert.equal(DEPLOYED_TIER_PIN_PENDING, true);
  assert.equal(tierPinPendingFor(vb), true);
  const up = upgradedTable();
  assert.ok(!PRE_B17_PROGRAM_HASHES.has(up.programs.find((x: { library: string }) => x.library === "burn_receipts").deployed.mainnet.hash));
  assert.equal(tierPinPendingFor(up), false);
  assert.equal(tierPinPendingFor(null), true, "an unreadable table keeps the sentence");
  assert.equal(bothTiersLineNow(true), `${BOTH_TIERS_LINE} ${DEPLOYED_TIER_PIN_LINE}`);
  assert.equal(bothTiersLineNow(false), BOTH_TIERS_LINE);
});

test("the footer's fee row carries the sentence while pending and not after", () => {
  const now = footerFeeLine(BURNTICKER_DEV_FEE_BPS, { tier14Live: null, tierPinPending: DEPLOYED_TIER_PIN_PENDING });
  assert.ok(now.includes(PIN_AFTER), now);
  assert.ok(now.indexOf(DEPLOYED_TIER_PIN_LINE) < now.indexOf("Coin-vs-coin pair pools"));
  assert.equal(FOOTER_FEE_LINE, now, "the static pages' footer is the same line");
  const after = footerFeeLine(BURNTICKER_DEV_FEE_BPS, { tier14Live: null, tierPinPending: tierPinPendingFor(upgradedTable()) });
  assert.ok(!after.includes(DEPLOYED_TIER_PIN_LINE));
  assert.ok(after.includes("pay 1.25% all the same. Coin-vs-coin pair pools"));
  assert.match(fs.readFileSync("src/app/burnticker/_components/SiteFooter.tsx", "utf8"), /footerFeeLine\(BURNTICKER_DEV_FEE_BPS, \{ tier14Live: tier14LiveNow\(\), tierPinPending: DEPLOYED_TIER_PIN_PENDING \}\)/);
  for (const f of ["site/burnticker/index.html", "site/deficit/index.html"]) assert.ok(fs.readFileSync(f, "utf8").includes(DEPLOYED_TIER_PIN_LINE), f);
});

test("the guardrails LP-lock item carries the sentence while pending and not after", () => {
  assert.ok(GUARDRAIL_DETAIL[LP_ROW].text.endsWith(PIN_AFTER));
  const after = guardrailDetail(tierPinPendingFor(upgradedTable()))[LP_ROW].text;
  assert.ok(after.endsWith(BOTH_TIERS_LINE) && !after.includes(DEPLOYED_TIER_PIN_LINE));
});

test("the current-status fee line carries the sentence while pending and not after (fixture table with the B-17 build deployed)", () => {
  const fee = (lines: string[]) => lines.find((l) => l.startsWith("The operator earns 0.25% of curve trading volume."))!;
  const now = fee(buildCurrentStatus({ env: {}, chain: {}, now: 0 }).lines);
  assert.ok(now.includes(`${PIN_AFTER} The coin side of the liquidity fees is burned.`), now);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hs96-"));
  try {
    fs.cpSync("config/burnticker", path.join(root, "config/burnticker"), { recursive: true });
    fs.writeFileSync(path.join(root, VB_FILE), JSON.stringify(upgradedTable(), null, 2));
    const after = fee(buildCurrentStatus({ root, env: {}, chain: {}, now: 0 }).lines);
    assert.ok(!after.includes(DEPLOYED_TIER_PIN_LINE), after);
    assert.ok(after.includes(`pay 1.25% all the same. The coin side of the liquidity fees is burned.`), after);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("every visible fee paragraph passes the copy lint", () => {
  for (const s of [FOOTER_FEE_LINE, GUARDRAIL_DETAIL[LP_ROW].text, bothTiersLineNow(true), DEPLOYED_TIER_PIN_LINE]) assert.deepEqual(lintCopy(s).hits, [], s);
});
