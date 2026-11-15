// CONTINUOUS AUDIT 2026-10-19 ACC-01 (the cap read the same on every surface), REWORKED FOR THE OWNER DECISION OF 2026-10-25: both burn
// caps (the 25 SOL burn-pool cap with its raise-only 48-hour timelock, and the per-run 2% bound) were removed from the burn_receipts
// program. capInForce.ts is retired. This guard now pins that the copy and the program agree there is no cap: the program source has no
// active_cap, no cap constants and refuses every cap raise with CapRemoved; every surface that showed the cap says there is none, in the
// same words (spreadCopy.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PREREQUISITE_STATES } from "@/lib/burnticker/launchReview";
import { BURN_RUNS_SENTENCE, NO_BURN_CAP_SENTENCE, NO_CAP_TRANSPARENCY_SENTENCE, PLATFORM_AUTHORITY_NO_CAP_SENTENCE } from "@/lib/burnticker/spreadCopy";
import { lintCopy } from "@/lib/launch/copyLint";

const read = (f: string) => fs.readFileSync(f, "utf8");
const RS = "programs/burn-receipts/programs/burn_receipts/src";

describe("no burn cap: the program and the copy agree", () => {
  test("the program has no cap in force: no active_cap, no cap constants, every cap raise refused with CapRemoved", () => {
    const state = read(`${RS}/state.rs`), constants = read(`${RS}/constants.rs`), err = read(`${RS}/error.rs`);
    assert.doesNotMatch(state, /fn active_cap|fn default_active_cap|fn crankers_in_force/);
    assert.match(state, /pub fn recovery_open\(&self, now: i64\) -> bool/);
    assert.match(state, /pub fn default_recovery_open\(now: i64\) -> bool/);
    for (const c of ["DEFAULT_BURN_POOL_CAP_LAMPORTS", "MIN_BURN_POOL_CAP_LAMPORTS", "CAP_TIMELOCK_SECS", "MAX_SPEND_RESERVE_BPS", "CARRIED_BUDGET_WINDOW_SECS", "MAX_CRANKERS", "CRANKER_ALLOWLIST_MAX_SECS"]) assert.doesNotMatch(constants, new RegExp(`pub const ${c}\\b`), c);
    assert.match(err, /CapRemoved/);
  });
  test("the TS mirrors carry no cap: the deprecated shims are deleted and capInForce.ts is gone", async () => {
    assert.equal(fs.existsSync("src/lib/burnticker/capInForce.ts"), false);
    const constants = await import("@/lib/burnReceipts/constants"), math = await import("@/lib/burnReceipts/math"), dispersal = await import("@/lib/burnticker/dispersal"), fees = await import("@/lib/burnticker/fees"), burnMath = await import("@/lib/burnticker/burnMath");
    for (const n of ["DEFAULT_BURN_POOL_CAP_LAMPORTS", "CAP_TIMELOCK_SECS", "MAX_SPEND_RESERVE_BPS"]) assert.equal(n in constants, false, n);
    assert.equal("reserveSpendCap" in math, false);
    for (const n of ["DISPERSAL_WINDOW_MS", "DISPERSAL_MIN_GAP_MS", "PROGRAM_CAP_BPS", "DEPTH_PPM"]) assert.equal(n in dispersal, false, n);
    for (const n of ["PRE_AUDIT_POOL_CAP_SOL", "PRE_AUDIT_POOL_CAP_LAMPORTS", "capPool"]) assert.equal(n in fees, false, n);
    for (const n of ["MAX_SPEND_RESERVE_BPS", "DEFAULT_CAP_LAMPORTS"]) assert.equal(n in burnMath, false, n);
  });
  test("the canonical sentences are plain and lint-clean", () => {
    assert.equal(BURN_RUNS_SENTENCE, "When a reading settles, the burn runs right away and spends the rule's full share of the burn pool in one run.");
    assert.equal(NO_BURN_CAP_SENTENCE, "There is no platform cap on a burn. The burn pool spends what the rule says.");
    assert.equal(NO_CAP_TRANSPARENCY_SENTENCE, "There is no burn-pool cap and no limit on how much one burn spends. Each burn spends the rule's full share of the burn pool in one run.");
    assert.equal(PLATFORM_AUTHORITY_NO_CAP_SENTENCE, "The platform authority no longer holds a cap-raise power. The program refuses every cap raise.");
    for (const s of [BURN_RUNS_SENTENCE, NO_BURN_CAP_SENTENCE, NO_CAP_TRANSPARENCY_SENTENCE, PLATFORM_AUTHORITY_NO_CAP_SENTENCE]) assert.deepEqual(lintCopy(s).hits, [], s);
  });
  test("every surface that showed the cap says there is none", () => {
    const review = read("src/lib/burnticker/launchReview.ts");
    assert.match(review, /^\s+`\$\{BURN_RUNS_SENTENCE\} \$\{NO_BURN_CAP_SENTENCE\}`,/m, "the review's prerequisites (shown under Other conditions in the wallet summary)");
    assert.ok(!PREREQUISITE_STATES.some((s) => /^Capped/.test(s)), "no Capped burn state");
    const page = read("src/lib/burnticker/tokenPage.ts");
    assert.match(page, /noCapNote: NO_BURN_CAP_SENTENCE/);
    assert.doesNotMatch(page, /capHeldSentence|capSentenceAway|queuedNote|capPool/);
    const trust = read("src/app/burnticker/trust/page.tsx");
    assert.match(trust, /data-no-burn-cap/); assert.doesNotMatch(trust, /data-effective-cap|The burn-pool cap in force/);
    for (const f of ["src/lib/burnticker/launchReview.ts", "src/lib/burnticker/tokenPage.ts", "src/app/burnticker/launch/PreWalletSummary.tsx", "src/app/burnticker/_components/BurnMath.tsx", "src/app/burnticker/trust/page.tsx", "src/lib/burnticker/trust.ts", "src/lib/burnticker/guidedLaunch.ts"]) assert.doesNotMatch(read(f), /capInForce|Until the program is audited|until the audit|pre-audit cap of|default burn-pool cap/i, f);
    const t = JSON.parse(read("config/burnticker/transparency.json")) as { limitations: { id: string; text: string }[] };
    assert.equal(t.limitations.some((l) => l.id === "cap-25"), false);
    assert.ok(t.limitations.find((l) => l.id === "no-burn-cap")!.text.startsWith(NO_CAP_TRANSPARENCY_SENTENCE));
  });
});
