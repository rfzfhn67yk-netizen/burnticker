// 2026-11-14 (owner's phone): a cross-read publication lag is held correctly and clears within hours (eia.gasoline 2026-W46: held 14:03Z,
// recorded 20:04Z the same day), so its bt-reading-implausible alert is noise until the hold has outlived a grace. Every other refusal
// still reaches the phone at once.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { alertableRefusals, anchorKeyOf } from "@/lib/burnticker/multiKeeper";
import { CROSS_READ_LAG_GRACE_MS, CROSS_READ_LAG_RE } from "@/lib/burnticker/catalogue/corroborate";

const LAG = "For eia.gasoline 2026-W46, the cross-read fred.GASREGW (Federal Reserve Bank of St. Louis (FRED)) has no value for this period yet. It is held along with 0 later readings.";
const DISAGREE = "eia.gasoline 2026-W46: the primary (3.995) and the cross-read fred.GASREGW (Federal Reserve Bank of St. Louis (FRED)) (4.100) disagree — held with every later reading";
const KEY = "catalogue:eia.gasoline";
const regAt = (since: number | null) => ({ statusUpdatedAt: (k: string) => (k === anchorKeyOf(KEY) ? since : null) });

describe("cross-read lag grace (2026-11-14)", () => {
  test("the live hold text matches the pattern; a disagreement does not", () => {
    assert.match(LAG, CROSS_READ_LAG_RE);
    assert.doesNotMatch(DISAGREE, CROSS_READ_LAG_RE);
    assert.equal(CROSS_READ_LAG_GRACE_MS, 48 * 3_600_000);
  });
  test("a fresh lag hold is kept off the phone; past the grace it is reported; other refusals pass at once", () => {
    const now = 1_794_700_000_000;
    const fetched = [{ key: KEY, refusals: [LAG, DISAGREE] }, { key: "catalogue:espn.team:nfl-PHI.21-win-s2026", refusals: ["x: the primary and the cross-read disagree"] }];
    // the hold began this cycle (the anchor row was just written)
    assert.deepEqual(alertableRefusals(regAt(now), fetched, now), [DISAGREE, "x: the primary and the cross-read disagree"]);
    // six hours in: still quiet
    assert.deepEqual(alertableRefusals(regAt(now - 6 * 3_600_000), fetched, now), [DISAGREE, "x: the primary and the cross-read disagree"]);
    // past the grace: the lag is a real problem now and is reported
    assert.deepEqual(alertableRefusals(regAt(now - CROSS_READ_LAG_GRACE_MS), fetched, now), [LAG, DISAGREE, "x: the primary and the cross-read disagree"]);
    // no anchor row at all (nothing records when the hold began): quiet, the next cycle writes the row
    assert.deepEqual(alertableRefusals(regAt(null), [{ key: KEY, refusals: [LAG] }], now), []);
  });
  test("the keeper and the drill hand the alert layer alertableRefusals, not the raw list", () => {
    const keeper = fs.readFileSync(new URL("../scripts/burnticker-keeper.mts", import.meta.url), "utf8");
    assert.match(keeper, /refusals: alertableRefusals\(registry, r\.fetched, Date\.now\(\)\)\.slice\(0, 10\)/);
    assert.doesNotMatch(keeper, /refusals: r\.fetched\.flatMap\(\(x\) => x\.refusals\)/);
    const drill = fs.readFileSync(new URL("../src/lib/burnticker/ops/drill.ts", import.meta.url), "utf8");
    assert.match(drill, /refusals: alertableRefusals\(reg, r\.fetched, clock\.t\)\.slice\(0, 10\)/);
    const mk = fs.readFileSync(new URL("../src/lib/burnticker/multiKeeper.ts", import.meta.url), "utf8");
    assert.match(mk, /const anchorKey = anchorKeyOf\(key\);/);
  });
});
