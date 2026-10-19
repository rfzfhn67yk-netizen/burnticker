// THE OPERATOR'S POST-GRADUATION SHARE, LED BY THE WHOLE (the owner, 2026-10-12, on the trust page: "dev fees are wrong, it's showing I'm
// getting 20%"). The 20% is of the locked pool's liquidity fees only. Every expected sentence below is built from the constants
// (cpmmTier.ts, the program's compiled split), never typed, and every public surface that states the share is checked to carry it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CPMM_MAINNET_TIER_9, CPMM_TIER, postGraduationBps } from "@/lib/burnticker/cpmmTier";
import { LOCK_FEE_BURN_BPS, LOCK_FEE_OPERATOR_BPS } from "@/lib/burnReceipts/constants";
import { EARLIER_COINS_LINE, EARLIER_OPERATOR_CLAUSE, LOCK_FEE_BURN_BPS_MIRROR, OPERATOR_SHARE_LINE, PAIR_OPERATOR_SHARE_LINE, aboutPct, operatorShareClause, postGraduationShareLine, sharesForCluster, sharesFromSplit } from "@/lib/burnticker/feeShareLine";
import { OPERATOR_SHARE_LINE as FEES_OPERATOR_SHARE_LINE, POST_GRADUATION_FEES, USE_OF_FEES, feeSplitSentence, postGraduationFeesFor, BURNTICKER_DEV_FEE_BPS } from "@/lib/burnticker/fees";
import { FEE_FLOW_LINE } from "@/lib/burnticker/tokenPage";
import { GUARDRAIL_DETAIL, WHO_GETS_WHAT } from "@/lib/burnticker/safeguards";
import { OPERATOR_COPY } from "@/lib/burnticker/trustpack/copy";
import { lpFeeLine } from "@/lib/burnticker/trustpack/ledger";
import { lintCopy } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const b = postGraduationBps(CPMM_TIER.mainnet, LOCK_FEE_BURN_BPS);
const two = (bps: number) => `${Math.round(bps) / 100}%`;
const EXPECTED = `After graduation, about ${two(b.burnPoolTotal)} of every swap goes to the coin's burn pool and about ${two(b.lpToOperator)} to the operator — ${LOCK_FEE_OPERATOR_BPS / 100}% of the locked pool's liquidity fees. Raydium keeps about ${two(b.raydiumTotal)}.`;

describe("the operator's share sentence (fees copy, 2026-10-12)", () => {
  test("the mirror equals the program's compiled split", () => {
    assert.equal(LOCK_FEE_BURN_BPS_MIRROR, LOCK_FEE_BURN_BPS);
  });

  test("built from the constants: the whole first, the 20% only as the liquidity-fee split", () => {
    assert.equal(OPERATOR_SHARE_LINE, EXPECTED);
    assert.equal(FEES_OPERATOR_SHARE_LINE, EXPECTED);
    assert.equal(postGraduationShareLine(POST_GRADUATION_FEES), EXPECTED);
    assert.deepEqual(sharesFromSplit(POST_GRADUATION_FEES), sharesForCluster("mainnet"));
    // new coins on tier 14 as read on 2026-10-19 (it was 0.88% / 0.04% / 0.08% on tier 9), so a silent tier change is seen here
    assert.equal(EXPECTED, "After graduation, about 0.98% of every swap goes to the coin's burn pool and about 0.13% to the operator — 20% of the locked pool's liquidity fees. Raydium keeps about 0.15%.");
    // a coin that pinned tier 9 keeps its own line
    assert.equal(postGraduationShareLine(postGraduationFeesFor("mainnet", CPMM_MAINNET_TIER_9.id)), "After graduation, about 0.88% of every swap goes to the coin's burn pool and about 0.04% to the operator — 20% of the locked pool's liquidity fees. Raydium keeps about 0.08%.");
  });

  test("a pair coin's pool (creator fee off) has its own line, and the pair funds flow prints it", async () => {
    const p = postGraduationBps({ ...CPMM_TIER.mainnet, creatorFeeRate: 0 }, LOCK_FEE_BURN_BPS);
    const want = `After graduation, about ${two(p.burnPoolTotal)} of every swap goes to the coin's burn pool and about ${two(p.lpToOperator)} to the operator — ${LOCK_FEE_OPERATOR_BPS / 100}% of the locked pool's liquidity fees. Raydium keeps ${two(p.raydiumTotal)}.`;
    assert.equal(PAIR_OPERATOR_SHARE_LINE, want);
    const { pairFundsFlow } = await import("@/lib/burnticker/pairFundsFlow");
    assert.ok(JSON.stringify(pairFundsFlow("winner-takes-the-burn", { a: "A", b: "B" })).includes(want));
  });

  test("devnet's tier gives its own numbers, and an exact share drops 'about'", () => {
    const d = postGraduationBps(CPMM_TIER.devnet, LOCK_FEE_BURN_BPS);
    assert.equal(postGraduationShareLine(postGraduationFeesFor("devnet")), postGraduationShareLine(sharesForCluster("devnet")));
    assert.match(postGraduationShareLine(postGraduationFeesFor("devnet")), new RegExp(`Raydium keeps ${two(d.raydiumTotal).replace(".", "\\.")}\\.$`));
    assert.equal(aboutPct(4), "0.04%");
    assert.equal(aboutPct(4.2), "about 0.04%");
  });

  test("every surface that states the share carries the sentence", () => {
    assert.ok(USE_OF_FEES.startsWith(`Burnticker takes ${BURNTICKER_DEV_FEE_BPS / 100}% of curve volume. ${EXPECTED} `));
    assert.ok(feeSplitSentence().includes(EXPECTED));
    assert.ok(FEE_FLOW_LINE.endsWith(EXPECTED));
    assert.ok(GUARDRAIL_DETAIL["LP locked forever, its fees fund the burn"].text.endsWith(EXPECTED));
    assert.ok(WHO_GETS_WHAT.find((w) => w.who === "Burnticker")!.text.includes(EXPECTED));
    // continuous audit run 2, HB-13: the new-coin share first, then the tier-9 share of coins created before the cutover
    assert.ok(OPERATOR_COPY.devFeeNote.endsWith(`its share of each graduated pool's swaps: ${operatorShareClause()} on new coins, and ${EARLIER_OPERATOR_CLAUSE}.`));
    assert.match(lpFeeLine("mainnet", null).title, /^Operator: about 0\.13% of every swap \(20% of the locked pool's liquidity fees\) on new coins, and about 0\.04% of every swap \(20% of the locked pool's liquidity fees\) on coins created before 19 October 2026, 20:17 UTC, which stay on tier 9, after graduation$/);
    for (const f of ["docs/burnticker/WHITEPAPER.md", "site/burnticker/whitepaper.html", "config/burnticker/transparency.json", "docs/burnticker/README.md", "docs/burnticker/api.md", "site/deficit/index.html"])
      assert.ok(read(f).includes(EXPECTED.split(" — ")[0].replace("After graduation, ", "")), `${f} states the operator's share from the whole`);
  });

  test("the misleading sentences are gone from every public surface", () => {
    const BAD = [/operator also takes 20%/, /operator earns 20 ?% of (the )?(post-graduation )?LP fees/i, /SOL fees from each locked/, /its fees go 80% to the burn pool and 20% to the operator/, /Operator treasury \(20%\)/, /Operator: 20% of post-graduation/];
    const files = ["src/lib/burnticker/fees.ts", "src/lib/burnticker/trust.ts", "src/lib/burnticker/tokenPage.ts", "src/lib/burnticker/currentStatus.ts", "src/lib/burnticker/safeguards.ts", "src/lib/burnticker/pairFundsFlow.ts",
      "src/lib/burnticker/trustpack/copy.ts", "src/lib/burnticker/trustpack/ledger.ts", "src/app/burnticker/trust/page.tsx", "src/app/burnticker/t/[ticker]/page.tsx", "config/burnticker/transparency.json",
      "docs/burnticker/WHITEPAPER.md", "site/burnticker/whitepaper.html", "docs/burnticker/README.md", "docs/burnticker/api.md", "site/deficit/index.html"];
    for (const f of files) for (const re of BAD) assert.doesNotMatch(read(f), re, `${f}: ${re}`);
  });

  test("the sentences are copy-lint clean and contain no future tense", () => {
    for (const s of [EXPECTED, USE_OF_FEES, FEE_FLOW_LINE, OPERATOR_COPY.devFeeNote, feeSplitSentence(), feeSplitSentence("devnet"), feeSplitSentence("mainnet", CPMM_MAINNET_TIER_9.id), EARLIER_COINS_LINE]) {
      const r = lintCopy(s, undefined);
      assert.ok(r.ok, `${s}\n${r.hits.map((h) => h.phrase).join(", ")}`);
      assert.doesNotMatch(s, /\bwill\b/);
    }
  });
});
