// Ninth pre-launch audit (2026-10-21) WIZARD WZ9-1/2/3, HB-207 / HS-102 (B-21 on both wizard paths): a team coin whose generated ticker
// another coin holds was swapped to $PHINFLFANS but kept the live $PHINFLWIN's name "Eagles 2026 Wins", on the server's review
// (tickerCheck.ts paired a swapped ticker with a new name only for hazards) and on the page (page.tsx took the review's stale name before
// the team word). Folded from docs/burnticker/audits/prelaunch-2026-10-21-ninth-pass/evidence/tests/WIZARD/audit9WizardNames.test.ts,
// with the server case run in-process on a registry holding the live coin, and the page's own precedence exercised through its helper.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pairedSwapName, teamWordName, isTeamRule } from "@/lib/burnticker/tickerSwap";
import { hazardAlternateName } from "@/lib/burnticker/hazards";
import { reviewTickerChecks, type TickerRow } from "@/lib/burnticker/tickerCheck";
import type { LookalikeExisting } from "@/lib/burnticker/lookalike";
import type { BurnRule } from "@/lib/burnticker/rules";

const page = readFileSync(new URL("../src/app/burnticker/launch/page.tsx", import.meta.url), "utf8");
const series = "espn.team:nfl-PHI.21-win-s2026";
const teamRule = { oracle: "catalogue", series } as Pick<BurnRule, "oracle" | "series">;
// the page's hazardNameFor (page.tsx), with the review's name map passed in
const hazardNameFor = (rule: Pick<BurnRule, "oracle" | "series"> | null, t: { ticker: string; name: string }, genFix: Record<string, string>, reviewNames: Record<string, string>) => {
  const to = genFix[t.ticker.toUpperCase()];
  if (!to) return t.name;
  const rn = reviewNames[to.toUpperCase()];
  return pairedSwapName(rule, t, to) ?? (rn && rn !== t.name ? rn : null) ?? t.name;
};
const liveReviewNames = { PHINFLFANS: "Eagles 2026 Wins" };   // the 111 review's stale pair, both shapes

test("guard: the page's hazardNameFor is the helper first, then a review name that is not the one being replaced", () => {
  assert.match(page, /return pairedSwapName\(ruleShown, \{ ticker: t\.ticker, name: t\.name \}, to\) \?\? \(rn && rn !== t\.name \? rn : null\) \?\? t\.name;/);
  assert.match(page, /const sugSwap = sug\.name && sug\.ticker \? genFix\[sug\.ticker\.toUpperCase\(\)\] : undefined;/);
  assert.doesNotMatch(page, /reviewNames\.current\[to\.toUpperCase\(\)\] \?\? hazardAlternateName/);
});

test("WZ9-1 (HB-189): the step-1 'eagles' card $PHINFLWIN2 swapped to $PHINFLFANS is named 'Eagles Fans 2026 Wins', even beside the stale review name", () => {
  assert.equal(hazardNameFor(teamRule, { ticker: "PHINFLWIN2", name: "Eagles 2026 Wins" }, { PHINFLWIN2: "PHINFLFANS" }, liveReviewNames), "Eagles Fans 2026 Wins");
});

test("WZ9-2 (HB-170): Team > NFL > Eagles, $PHINFLWIN swapped to $PHINFLFANS, is named 'Eagles Fans 2026 Wins'", () => {
  assert.equal(hazardNameFor(teamRule, { ticker: "PHINFLWIN", name: "Eagles 2026 Wins" }, { PHINFLWIN: "PHINFLFANS" }, liveReviewNames), "Eagles Fans 2026 Wins");
  assert.equal(hazardNameFor(teamRule, { ticker: "PHINFLWIN", name: "Eagles 2026 Wins" }, { PHINFLWIN: "PHINFLFANS" }, { PHINFLFANS: "Eagles Fans 2026 Wins" }), "Eagles Fans 2026 Wins");
});

function deps(rows: { ticker: string; name: string; mint: string; rule: Pick<BurnRule, "oracle" | "series"> }[]) {
  const existing: LookalikeExisting[] = rows.map((r) => ({ ticker: r.ticker, name: r.name, status: "live", rule: r.rule, creator: `Owner-${r.mint}` }));
  const inUse = (t: string): TickerRow[] => rows.filter((r) => r.ticker === t.toUpperCase()).map((r) => ({ mint: r.mint, name: r.name, ticker: r.ticker, rulesJson: JSON.stringify(r.rule), status: "live", creator: `Owner-${r.mint}` }));
  return { inUse, reserved: new Set<string>(), existing, creator: "VisitorWallet" };
}

test("WZ9-3 (server): the review pairs a swapped team ticker with the team word in the name, never the live coin's name", () => {
  const d = deps([{ ticker: "PHINFLWIN", name: "Eagles 2026 Wins", mint: "M1", rule: teamRule }]);
  for (const ticker of ["PHINFLWIN", "PHINFLWIN2"]) {
    const { coins } = reviewTickerChecks([{ side: "A" as const, ticker, suggestedTicker: "PHINFLWIN", suggestedName: "Eagles 2026 Wins" }], teamRule, d);
    assert.equal(coins[0].suggestedTicker, "PHINFLFANS");
    assert.equal(coins[0].suggestedName, "Eagles Fans 2026 Wins", `review suggests $${coins[0].suggestedTicker} named "${coins[0].suggestedName}"`);
  }
  // a split season takes the word before the season too (the Lakers shape)
  const nba = { oracle: "catalogue", series: "espn.team:nba-LAL.13-win-s2026" } as Pick<BurnRule, "oracle" | "series">;
  const n = reviewTickerChecks([{ side: "A" as const, ticker: "LALNBAWIN", suggestedTicker: "LALNBAWIN", suggestedName: "Lakers 2026–27 Wins" }], nba, deps([{ ticker: "LALNBAWIN", name: "Lakers 2026–27 Wins", mint: "M2", rule: nba }])).coins[0];
  assert.notEqual(n.suggestedName, "Lakers 2026–27 Wins");
  assert.equal(n.suggestedName, teamWordName("Lakers 2026–27 Wins", "LALNBAWIN", n.suggestedTicker!));
});

test("every family: hazards keep the hazard word's name, other coins keep their own event name (the helper answers null)", () => {
  const quake = { oracle: "catalogue", series: "usgs.quakenext:6" } as Pick<BurnRule, "oracle" | "series">;
  const from = { ticker: "NEXTM6", name: "Next Magnitude 6" };
  assert.equal(pairedSwapName(quake, from, "QUAKENXTM6"), hazardAlternateName(quake.series, from, "QUAKENXTM6"));
  assert.ok(pairedSwapName(quake, from, "QUAKENXTM6"));
  const poly = { oracle: "polymarket", series: null } as unknown as Pick<BurnRule, "oracle" | "series">;
  assert.equal(pairedSwapName(poly, { ticker: "DEMSENATE", name: "Democrats win the Senate" }, "DEMSENATE2"), null);
  assert.equal(hazardNameFor(poly, { ticker: "DEMSENATE", name: "Democrats win the Senate" }, { DEMSENATE: "DEMSENATE2" }, { DEMSENATE2: "Democrats win the Senate" }), "Democrats win the Senate");
  // a team word is never put into a non-team coin's name
  assert.equal(isTeamRule(quake), false);
  assert.equal(pairedSwapName(quake, { ticker: "QUAKEM6", name: "Magnitude 6 Count" }, "QUAKEFANS"), null);
});

test("control: teamWordName itself", () => {
  assert.equal(teamWordName("Eagles 2026 Wins", "PHINFLWIN2", "PHINFLFANS"), "Eagles Fans 2026 Wins");
  assert.equal(teamWordName("Avalanche 2026–27 Wins", "COLNHLWIN", "COLNHLFANS"), "Avalanche Fans 2026–27 Wins");
});
