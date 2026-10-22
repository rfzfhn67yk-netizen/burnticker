// HB-188 (eighth pre-launch audit LA8-2): an ESPN series id has one spelling; a new rule written another way is refused at the preflight,
// and the duplicate-rule notice finds the live coin whichever way the window is written.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { canonicalEspnSeries } from "@/lib/burnticker/sources/espn";
import { ruleRefusals } from "@/lib/burnticker/launchPreflight";
import { existingCoinsFor } from "@/lib/burnticker/duplicateRuleMatch";
import { lockRule } from "@/lib/burnticker/rules";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { selectorKeyOf } from "@/lib/burnticker/registry";

const CANON = "espn.team:nfl-PHI.21-win-s2026";
describe("HB-188: the one spelling of an ESPN id", () => {
  test("the letters follow the team's number; a game's event id is kept as the feed writes it (NBA ids start with zeros)", () => {
    assert.equal(canonicalEspnSeries(CANON), CANON);
    assert.equal(canonicalEspnSeries("espn.team:nfl-ZZZ.21-win-s2026"), CANON);
    assert.equal(canonicalEspnSeries("espn.game:nba-0022500001-PHI-win"), "espn.game:nba-0022500001-PHI-win");
    assert.equal(canonicalEspnSeries("not.espn"), null);
  });
  test("the preflight refuses a rule written another way and says the one form; the canonical rule is not refused for it", () => {
    const odd = ruleRefusals(lockRule(nativeRule("espn.team:nfl-ZZZ.21-win-s2026")));
    const r = odd.find((x) => x.code === "series-not-canonical");
    assert.ok(r, JSON.stringify(odd)); assert.match(r!.message, /Its one form is espn\.team:nfl-PHI\.21-win-s2026\./);
    assert.equal(ruleRefusals(lockRule(nativeRule(CANON))).some((x) => x.code === "series-not-canonical"), false);
  });
  test("the duplicate-rule notice finds the live coin under the other spelling", () => {
    const rule = nativeRule(CANON);
    const tokens = [{ ticker: "PHINFLWIN", name: "Eagles 2026 Wins", mint: "M", status: "live", selectorKey: selectorKeyOf(rule as never), rulesSha: "x" }];
    assert.equal(existingCoinsFor(nativeRule("espn.team:nfl-ZZZ.21-win-s2026"), tokens as never).length, 1);
  });
});
