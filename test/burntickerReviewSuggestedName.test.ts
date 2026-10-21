// LA7-4 (seventh pre-launch audit, HB-117 / HB-130 residue): the review swapped the held generated ticker $NEXTM6 for the hazard word
// ($QUAKENXTM6) but kept the held name "Next Magnitude 6", so a creator who took the suggestion as given was refused by the launch's own
// name check ("This is the name of the live $NEXTM6"). The suggested ticker and the suggested name now move together, and the pair the
// review offers passes the same lookalike check the launch runs.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { describeRule } from "@/lib/burnticker/describe";
import { reviewTickerChecks, type TickerRow } from "@/lib/burnticker/tickerCheck";
import { hazardAlternates } from "@/lib/burnticker/hazards";
import { lookalikeHits, type LookalikeExisting } from "@/lib/burnticker/lookalike";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { applyDial } from "@/lib/burnticker/dials";
import type { BurnRule } from "@/lib/burnticker/rules";

const SERIES = "usgs.quakenext:6";
const rule = applyDial(firstPartyRule(SERIES, 0.02), "fraction", 1) as BurnRule;
const gen = describeRule(rule, { ticker: "" });
const live = (ticker: string, name: string, mint: string) => ({ ticker, name, mint, status: "live", creator: `Owner-${mint}`, rule: { oracle: "catalogue" as const, series: SERIES } });
function deps(rows: ReturnType<typeof live>[]) {
  const existing: LookalikeExisting[] = rows.map((r) => ({ ticker: r.ticker, name: r.name, status: r.status, rule: r.rule, creator: r.creator }));
  const inUse = (t: string): TickerRow[] => rows.filter((r) => r.ticker === t.toUpperCase()).map((r) => ({ mint: r.mint, name: r.name, ticker: r.ticker, rulesJson: JSON.stringify(r.rule), status: r.status, creator: r.creator }));
  return { existing, d: { inUse, reserved: new Set<string>(), existing, creator: "VisitorWallet" } };
}

describe("LA7-4: the review's suggested ticker and suggested name move together", () => {
  test("a copy of $NEXTM6's rule is offered the hazard ticker with its own name, and that pair is not refused", () => {
    const w = deps([live("NEXTM6", "Next Magnitude 6", "M0")]);
    const { coins } = reviewTickerChecks([{ side: "A" as const, ticker: "NEXTM6", suggestedTicker: gen.ticker, suggestedName: gen.name }], rule, w.d);
    const c = coins[0];
    assert.notEqual(c.suggestedTicker, "NEXTM6");
    assert.notEqual(c.suggestedName, "Next Magnitude 6", "the held name is not offered back");
    const alt = hazardAlternates(SERIES, { ticker: gen.ticker, name: gen.name }).find((a) => a.ticker === c.suggestedTicker);
    assert.ok(alt, `$${c.suggestedTicker} is one of the hazard's own alternatives`);
    assert.equal(c.suggestedName, alt.name);
    // the launch's own check: taking the suggestion as given is accepted
    assert.deepEqual(lookalikeHits({ ticker: c.suggestedTicker!, name: c.suggestedName!, rule, creator: "VisitorWallet" }, w.existing), []);
  });
  test("a free generated ticker keeps its generated name (nothing is swapped)", () => {
    const w = deps([]);
    const { coins } = reviewTickerChecks([{ side: "A" as const, ticker: gen.ticker, suggestedTicker: gen.ticker, suggestedName: gen.name }], rule, w.d);
    assert.equal(coins[0].suggestedTicker, gen.ticker); assert.equal(coins[0].suggestedName, gen.name);
  });
  test("reviewer D: the OpenAPI review schema and the API doc name the pair, and the page uses the server's name first", async () => {
    const fs = await import("node:fs"), path = await import("node:path");
    const root = path.join(import.meta.dirname, "..");
    const spec = fs.readFileSync(path.join(root, "src/lib/burnticker/api/spec.ts"), "utf8");
    assert.match(spec, /suggestedName: \{ \.\.\.nstr, description: "the name that goes with suggestedTicker/);
    assert.match(fs.readFileSync(path.join(root, "docs/burnticker/api.md"), "utf8"), /`suggestedTicker` and `suggestedName`/);
    assert.match(fs.readFileSync(path.join(root, "src/app/burnticker/launch/page.tsx"), "utf8"), /reviewNames\.current\[to\.toUpperCase\(\)\] \?\? hazardAlternateName/);
  });
});
