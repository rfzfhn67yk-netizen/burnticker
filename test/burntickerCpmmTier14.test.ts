// CPMM TIER 14 FOR NEW COINS (owner decision 2026-10-19). New coins graduate into mainnet AmmConfig index 14 (trade 75 bps, creator
// 50 bps); coins created before keep the tier they pinned at initialize_token (tier 9 for most, tier 0 for $REHEARSAL). These tests pin:
// the id re-derived from its index, the per-swap table (12.6 / 97.90 / 14.50 / 125), every per-coin number read from the coin's own pin,
// the trust row comparing the LIVE platform against the accepted tiers (no false alarm while the platform update is pending), the trust
// page stating the tier the live platform gives new coins, and the copy lint on every new sentence.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { CREATE_CPMM_POOL_PROGRAM, getCpmmPdaAmmConfigId, PlatformConfig } from "@raydium-io/raydium-sdk-v2";
import { CPMM_MAINNET_TIER_0, CPMM_MAINNET_TIER_9, CPMM_MAINNET_TIER_14, CPMM_TIER, cpmmTierLabel, postGraduationBps } from "@/lib/burnticker/cpmmTier";
import { DEV_FEE_LINE, LOCK_FEE_BURN_BPS, POST_GRADUATION_FEES, USE_OF_FEES, compareLivePlatform, feeSplitSentence, platformTierRow, postGraduationBpsFor, postGraduationFeesFor } from "@/lib/burnticker/fees";
import { EARLIER_COINS_LINE, postGraduationShareLine } from "@/lib/burnticker/feeShareLine";
import { feeFlowLine } from "@/lib/burnticker/tokenPage";
import { buildTrustPage, type ChainReader } from "@/lib/burnticker/trust";
import { decodePlatform } from "@/lib/burnKeeper/launch";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const PLATFORM_ID = "94x5qDDJP4UCkeMWppnmvqTmMgo971h3d6MDRnjEfYy9";

/** A LaunchLab PlatformConfig account naming `cpConfigId` (the SDK layout; the other dials are the owner's). */
function platformAccount(cpConfigId: string): Buffer {
  const p = Buffer.alloc(PlatformConfig.span);
  const k = Keypair.generate().publicKey;
  PlatformConfig.encode({ epoch: new BN(1), platformClaimFeeWallet: k, platformLockNftWallet: k, platformScale: new BN(1_000_000), creatorScale: new BN(0), burnScale: new BN(0), feeRate: new BN(2500), name: [...Buffer.from("Burnticker".padEnd(64, "\0"))], web: new Array(256).fill(0), img: new Array(256).fill(0), cpConfigId: new PublicKey(cpConfigId), creatorFeeRate: new BN(5000), transferFeeExtensionAuth: PublicKey.default, platformVestingWallet: k, platformVestingScale: new BN(0), platformCpCreator: PublicKey.default, restrictGlobalConfig: 0, restrictCurveParam: 0, curveRuleManager: PublicKey.default } as never, p);
  return p;
}
const readerFor = (cpConfigId: string): ChainReader => ({ accountData: async (k) => (k === PLATFORM_ID ? platformAccount(cpConfigId) : null), signaturesFor: async () => [], lamportsDelta: async () => null });
const trustFor = (cpConfigId: string) => buildTrustPage({ reader: readerFor(cpConfigId), env: { BURNTICKER_CLUSTER: "mainnet", BURNTICKER_PLATFORM_ID: PLATFORM_ID }, root: ROOT, siteDir: path.join(ROOT, "no-such-site"), attesters: [], now: Date.parse("2026-10-19T18:00:00Z"), skipFeeLedger: true });

describe("the tier record", () => {
  test("tier 14 is the AmmConfig PDA of index 14 on mainnet's CPMM program, and new coins get it", () => {
    assert.equal(getCpmmPdaAmmConfigId(CREATE_CPMM_POOL_PROGRAM, 14).publicKey.toBase58(), CPMM_MAINNET_TIER_14.id);
    assert.equal(CPMM_MAINNET_TIER_14.id, "52MZUkNsRYzP4gn2mCaLTVtJQy2tpoF79hp5K1HhAxxX");
    assert.equal(CPMM_TIER.mainnet, CPMM_MAINNET_TIER_14);
  });
  test("the per-swap table for tier 14: operator 12.6, burn pool 97.90, Raydium 14.50, traders 125 (bps of volume)", () => {
    const b = postGraduationBps(CPMM_MAINNET_TIER_14, LOCK_FEE_BURN_BPS);
    assert.deepEqual({ op: b.lpToOperator, burn: b.burnPoolTotal, ray: b.raydiumTotal, pay: b.tradersPay }, { op: 12.6, burn: 97.9, ray: 14.5, pay: 125 });
    assert.equal(b.lpToOperator + b.burnPoolTotal + b.raydiumTotal, b.tradersPay, "every bp accounted for");
    assert.equal(POST_GRADUATION_FEES.totalBps, 125);
    // the decision entry states the same numbers
    const entry = read("docs/burnticker/decisions.md").split("## 2026-10-19 — Raydium CPMM fee tier 14")[1].split("\n## ")[0];
    assert.ok(entry, "the 2026-10-19 decision entry exists");
    for (const cell of ["| 63 |", "50.4 burn pool, 12.6 operator", "| 9 + 3 |", "| 47.5 |", "| 2.5 |", "**125**", "**97.90**", "12.6 / 14.50"]) assert.ok(entry.includes(cell), cell);
  });
});

describe("a coin's numbers come from the tier it pinned", () => {
  test("tier 9, tier 0 and tier 14 pins each give their own split; no pin gives the new-coin tier", () => {
    assert.deepEqual([9, 0, 14].map((i) => postGraduationFeesFor("mainnet", [CPMM_MAINNET_TIER_9, CPMM_MAINNET_TIER_0, CPMM_MAINNET_TIER_14].find((t) => t.index === i)!.id).totalBps), [100, 30, 125]);
    assert.equal(postGraduationFeesFor("mainnet").totalBps, 125);
    assert.equal(postGraduationBpsFor("mainnet", CPMM_MAINNET_TIER_9.id).burnPoolTotal, 88.05);
    assert.match(feeSplitSentence("mainnet", CPMM_MAINNET_TIER_9.id), /each trade in the Raydium pool pays 1% in fees/);
    assert.match(feeSplitSentence("mainnet"), /each trade in the Raydium pool pays 1\.25% in fees/);
    assert.match(feeFlowLine(postGraduationFeesFor("mainnet", CPMM_MAINNET_TIER_9.id)), /about 0\.88% of every swap goes to the coin's burn pool and about 0\.04% to the operator/);
    assert.match(feeFlowLine(POST_GRADUATION_FEES), /about 0\.98% of every swap goes to the coin's burn pool and about 0\.13% to the operator/);
  });
  test("the token page and the program port carry the pin (TokenConfig.ll_cp_config) into the fee table, the sentence and the HTML line", () => {
    const tp = read("src/lib/burnticker/tokenPage.ts");
    assert.match(tp, /postGraduation: postGraduationFeesFor\(i\.chain\.cluster, i\.chain\.program\?\.config\?\.cpConfig\), sentence: feeSplitSentence\(i\.chain\.cluster, i\.chain\.program\?\.config\?\.cpConfig\)/);
    assert.match(tp, /\$\{esc\(feeFlowLine\(s\.fees\.postGraduation\)\)\}/);
    assert.match(read("src/lib/burnKeeper/programAdapter.ts"), /cpConfig: c\.ll_cp_config\.toBase58\(\)/);
  });
});

describe("the trust row and page (live platform vs the code)", () => {
  test("the platform on tier 9 (update pending) or tier 14 matches; tier 0 or an unlisted id is flagged; each side names its tier", () => {
    const r9 = platformTierRow(CPMM_MAINNET_TIER_9.id), r14 = platformTierRow(CPMM_MAINNET_TIER_14.id), r0 = platformTierRow(CPMM_MAINNET_TIER_0.id), rx = platformTierRow(Keypair.generate().publicKey.toBase58());
    assert.deepEqual([r9.matches, r14.matches, r0.matches, rx.matches], [true, true, false, false]);
    assert.equal(r9.designed, `${cpmmTierLabel(CPMM_MAINNET_TIER_14.id)}; ${cpmmTierLabel(CPMM_MAINNET_TIER_9.id)} until the platform is updated`);
    assert.equal(r9.live, "tier 9 (LNmHRmMvk9kmtepfTSr98kqGLThd61kH1DPWf2cVRaC)");
    assert.match(rx.live, /^an unlisted tier \(/);
    assert.equal(platformTierRow("5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy", "devnet").matches, true);
    const row = compareLivePlatform(decodePlatform(platformAccount(CPMM_MAINNET_TIER_9.id)), null, null, "mainnet").find((x) => x.field.startsWith("Raydium pool fee tier"));
    assert.deepEqual(row, r9);
  });
  test("the trust page states the split the LIVE platform gives new coins: 100 bps while it names tier 9, 125 once it names tier 14", async () => {
    const on9 = await trustFor(CPMM_MAINNET_TIER_9.id), on14 = await trustFor(CPMM_MAINNET_TIER_14.id);
    assert.equal(on9.designedFees.postGraduation.totalBps, 100); assert.equal(on14.designedFees.postGraduation.totalBps, 125);
    assert.deepEqual([on9.designedFees.lpFeeSplit.operatorBps, on14.designedFees.lpFeeSplit.operatorBps], [4.2, 12.6]);
    assert.ok(on9.livePlatform.comparison.every((r) => !r.field.startsWith("Raydium pool fee tier") || r.matches));
    assert.ok(on14.statements.some((s) => s.startsWith(`${postGraduationShareLine(POST_GRADUATION_FEES)} ${EARLIER_COINS_LINE}`)));
    // an unlisted live id: the page falls back to the code's new-coin tier and the row says so
    const odd = await trustFor(Keypair.generate().publicKey.toBase58());
    assert.equal(odd.designedFees.postGraduation.totalBps, 125);
    assert.equal(odd.livePlatform.comparison.find((r) => r.field.startsWith("Raydium pool fee tier"))!.matches, false);
  });
});

describe("the copy", () => {
  test("every new sentence passes the copy lint and has no future tense or arrows", () => {
    const cfg = loadCopyLintConfig();
    const wp = read("docs/burnticker/WHITEPAPER.md");
    const tierBullet = wp.slice(wp.indexOf("- **The Raydium pool tier is 14 for new coins.**"), wp.indexOf("- **In rivalry pairs"));
    // the entry alone: a publish appends its own entry after this one (its program path says "target"), so stop at the next heading
    const section = (rel: string) => read(rel).split("## 2026-10-19 — Raydium CPMM fee tier 14")[1].split("\n## ")[0];
    const changelog = section("docs/burnticker/CHANGELOG.md");
    const decision = section("docs/burnticker/decisions.md");
    const texts = [EARLIER_COINS_LINE, DEV_FEE_LINE, USE_OF_FEES, feeSplitSentence(), feeSplitSentence("mainnet", CPMM_MAINNET_TIER_9.id), feeSplitSentence("mainnet", CPMM_MAINNET_TIER_0.id), platformTierRow(CPMM_MAINNET_TIER_9.id).designed, tierBullet, changelog, decision.split("\n|")[0]];
    for (const s of texts) {
      assert.ok(s && s.length > 20);
      const r = lintCopy(s, cfg);
      assert.ok(r.ok, `${s.slice(0, 120)}…\n${r.hits.map((h) => h.phrase).join(", ")}`);
      assert.doesNotMatch(s, /\bwill\b/);
      assert.doesNotMatch(s, /→|->/);
    }
    // public prose names no date for the change: the generic line says "the latest pool fee change"
    assert.doesNotMatch(EARLIER_COINS_LINE + DEV_FEE_LINE, /\d{4}-\d{2}-\d{2}/);
  });
});
