// EIGHTH PRE-LAUNCH AUDIT B-25 / B-16g (owner decision 2026-10-21): the summary no longer counts the open release items in a sentence,
// the 48-hour time lock says plainly that it has no date, and the current-status stamp follows the live check, not a hand-written date.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { loadTransparency, mainnetTimeLockPlan } from "@/lib/burnticker/trust";
import { timeLockPlanSentence } from "@/lib/burnticker/currentStatusText";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };
const read = (p: string) => fs.readFileSync(p, "utf8");

describe("B-25: no open-things count, a plain no-date time lock, a live check stamp", () => {
  test("no 'things are still open' sentence in the summary or the sources", async () => {
    const { buildCurrentStatus } = await import("@/lib/burnticker/currentStatus");
    const s = buildCurrentStatus({ env: {}, chain: {}, now: 0 });
    assert.ok(s.lines.every((l) => !/still open before release/.test(l)), s.lines.join("\n"));
    for (const f of ["src/lib/burnticker/currentStatus.ts", "src/app/burnticker/_components/CurrentStatusSummary.tsx", "config/burnticker/current-status.json", "config/burnticker/transparency.json"]) assert.doesNotMatch(read(f), /[Ss]ix things|things are still open/, f);
  });
  test("the 48-hour time lock has no date set yet, everywhere it is said", () => {
    const plan = mainnetTimeLockPlan()!;
    assert.equal(plan.plannedFrom, null);
    const sentence = "The 48-hour time lock has no date set yet.";
    assert.equal(timeLockPlanSentence(plan.plannedSecs, plan.plannedFrom), sentence);
    assert.equal(timeLockPlanSentence(60, "the vault's creation"), "The plan is 1 min from the vault's creation.");
    const vault = loadTransparency().wallets.find((w) => w.role === "squads-vault")!;
    assert.ok(vault.description.includes(sentence));
    for (const f of ["config/burnticker/transparency.json", "config/burnticker/operator.json", "config/burnticker/current-status.json", "src/lib/burnticker/trustpack/checklist.ts", "public/.well-known/burnticker.json"]) assert.doesNotMatch(read(f), /week or more after the soft launch|48 h planned|48 h is planned/, f);
    clean(sentence); clean(vault.description);
  });
  test("the current-status stamp is the live check, not the file's hand-written date", () => {
    assert.match(read("src/app/burnticker/_components/CurrentStatusSummary.tsx"), /Checked on \{utcDateTime\(s\.readAt\)\}\./);
    assert.doesNotMatch(read("src/app/burnticker/_components/CurrentStatusSummary.tsx"), /utcDateTime\(s\.checkedAt\)/);
    assert.match(read("site/burnticker/status/index.html"), /"Checked on " \+ \(window\.btUtc \|\| String\)\(s\.readAt, true\) \+ "\."/);
  });
});
