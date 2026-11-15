// Continuous audit HB-117 + HS-52 (hourly run 10, 2026-10-19): the showcase one-shot earthquake coin can be copied. The generated ticker
// and name of a natural-disaster coin are swapped for the hazard-word alternative when another coin holds them, the review's
// suggestedTicker is free, and a name clash names the other coin once, under the Name field.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { reviewTickerChecks, type TickerRow } from "@/lib/burnticker/tickerCheck";
import { autoTickerSwaps, hazardSwapLine } from "@/lib/burnticker/tickerSwap";
import { lookalikeHits, type LookalikeExisting } from "@/lib/burnticker/lookalike";
import { HAZARD_KINDS, hazardAlternateName, hazardAlternates } from "@/lib/burnticker/hazards";
import { identityRefusals } from "@/lib/burnticker/launchPreflight";
import { serverFieldOf } from "../src/app/burnticker/launch/fieldChecks.ts";
import { describeRule } from "@/lib/burnticker/describe";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { applyDial } from "@/lib/burnticker/dials";
import type { BurnRule } from "@/lib/burnticker/rules";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };

const SERIES = "usgs.quakenext:6";
const quakeRule = (series = SERIES): BurnRule => applyDial(firstPartyRule(series, 0.02), "fraction", 1) as BurnRule;
const gen = (r: BurnRule) => describeRule(r, { ticker: "" });
const LIVE = { mint: "LiveNextM6Mint", name: "Next Magnitude 6", ticker: "NEXTM6", status: "live", creator: "OwnerWallet", rule: { oracle: "catalogue" as const, series: SERIES } };

/** A registry of one coin, as the review route reads it (tokensByTicker + lookalikeRows). */
function world(row: typeof LIVE) {
  const existing: LookalikeExisting[] = [{ ticker: row.ticker, name: row.name, status: row.status, rule: row.rule, creator: row.creator }];
  const inUse = (t: string): TickerRow[] => (t.toUpperCase() === row.ticker ? [{ mint: row.mint, name: row.name, ticker: row.ticker, rulesJson: JSON.stringify({ oracle: "catalogue", series: SERIES }), status: row.status, creator: row.creator }] : []);
  return { deps: { inUse, reserved: new Set<string>(), existing, creator: "VisitorWallet" }, existing };
}

/** The showcase walk: earthquake, once, defaults; the review runs on the generated draft and the page applies its swap. */
function walk(row: typeof LIVE) {
  const rule = quakeRule(), text = gen(rule), w = world(row);
  assert.equal(text.ticker, "NEXTM6");
  assert.equal(text.name, "Next Magnitude 6");
  const coins = [{ side: "A" as const, name: text.name, ticker: text.ticker, suggestedTicker: text.ticker }];
  const r = reviewTickerChecks(coins, rule, w.deps);
  const swap = autoTickerSwaps(r.tickers, { a: text.ticker, b: "" }, true);
  assert.ok(swap.a, "the generated ticker is swapped for a free one");
  const name = hazardAlternateName(rule.series, { ticker: text.ticker, name: text.name }, swap.a!) ?? text.name;
  return { rule, text, w, r, ticker: swap.a!, name };
}

describe("HB-117: the showcase one-shot earthquake coin can be copied", () => {
  test("a live $NEXTM6: the walk arrives at the Name step with a free ticker and a distinct name, and no refusal", () => {
    const { rule, w, r, ticker, name } = walk(LIVE);
    assert.equal(r.tickers[0].taken, true);
    assert.ok(r.tickers[0].suggestions.length >= 1, "a free suggestion is offered");
    assert.notEqual(ticker, "NEXTM6");
    assert.ok(!ticker.startsWith("NEXTM6"));
    assert.notEqual(name, "Next Magnitude 6");
    assert.match(name, /Quake|Tremor/);
    assert.deepEqual(lookalikeHits({ ticker, name, rule, creator: "VisitorWallet" }, w.existing), []);
    assert.deepEqual(identityRefusals({ ticker, name }, { existing: w.existing, rule, creator: "VisitorWallet", reserved: new Set(), majors: new Set(), refuseList: false }), []);
  });

  test("a drafted $NEXTM6 (not launched yet): the same walk swaps to a free ticker with no refusal", () => {
    const { rule, w, ticker, name } = walk({ ...LIVE, status: "draft" });
    assert.notEqual(ticker, "NEXTM6");
    assert.deepEqual(identityRefusals({ ticker, name }, { existing: w.existing, rule, creator: "VisitorWallet", reserved: new Set(), majors: new Set(), refuseList: false }), []);
  });

  test("the server's suggestedTicker is free, not the held ticker", () => {
    const { r, w, rule } = walk(LIVE);
    const s = r.coins[0].suggestedTicker;
    assert.ok(s && s !== "NEXTM6");
    assert.deepEqual(lookalikeHits({ ticker: s, name: "", rule, creator: "VisitorWallet" }, w.existing), []);
  });

  test("a free generated ticker is left alone and suggested as it is", () => {
    const rule = quakeRule("usgs.quakenext:7"), text = gen(rule), w = world({ ...LIVE, ticker: "OTHER1", name: "Something Else" });
    const r = reviewTickerChecks([{ side: "A", name: text.name, ticker: text.ticker, suggestedTicker: text.ticker }], rule, w.deps);
    assert.equal(r.coins[0].suggestedTicker, "NEXTM7");
    assert.deepEqual(autoTickerSwaps(r.tickers, { a: text.ticker, b: "" }, true), {});
  });

  test("the M7 one-shot beside a live $NEXTM6 (one letter apart once digits are read) is swapped too", () => {
    const rule = quakeRule("usgs.quakenext:7"), text = gen(rule), w = world(LIVE);
    const r = reviewTickerChecks([{ side: "A", name: text.name, ticker: text.ticker, suggestedTicker: text.ticker }], rule, w.deps);
    const s = r.coins[0].suggestedTicker!;
    assert.ok(s && s !== "NEXTM7");
    // "Next Magnitude 7" is one letter from "Next Magnitude 6" too (7 reads as T); the alternative's name is not
    const name = hazardAlternateName(rule.series, { ticker: text.ticker, name: text.name }, autoTickerSwaps(r.tickers, { a: text.ticker, b: "" }, true).a!);
    assert.ok(name && name !== text.name);
    assert.deepEqual(identityRefusals({ ticker: s, name }, { existing: w.existing, rule, creator: "VisitorWallet", reserved: new Set(), majors: new Set(), refuseList: false }), []);
  });

  test("the name step's swap line names the new ticker and name, in plain copy", () => {
    const { ticker, name } = walk(LIVE);
    const line = hazardSwapLine("NEXTM6", ticker, name);
    assert.match(line, new RegExp(`\\$${ticker}`));
    assert.ok(line.includes(name));
    clean(line);
  });

  test("every hazard's default draft, with its own ticker and name held live, gets a free ticker and a distinct name", () => {
    for (const k of HAZARD_KINDS) for (const series of [k.every, k.once(2026)]) {
      const rule = quakeRule(series), text = gen(rule);
      const row = { ...LIVE, ticker: text.ticker, name: text.name, rule: { oracle: "catalogue" as const, series } };
      const existing: LookalikeExisting[] = [{ ticker: row.ticker, name: row.name, status: "live", rule: row.rule, creator: row.creator }];
      const alt = hazardAlternates(series, { ticker: text.ticker, name: text.name }).find((a) => lookalikeHits({ ticker: a.ticker, name: a.name, rule, creator: "VisitorWallet" }, existing).length === 0);
      assert.ok(alt, `${series}: a free alternative for $${text.ticker} "${text.name}"`);
      assert.notEqual(alt!.name, text.name);
      assert.ok(new TextEncoder().encode(alt!.name).length <= 32, alt!.name);
    }
  });
});

describe("HB-117 b / HS-52: a name clash names the other coin once, under the Name field", () => {
  const rule = quakeRule(), existing: LookalikeExisting[] = [{ ticker: "NEXTM6", name: "Next Magnitude 6", status: "live", rule: { oracle: "catalogue", series: SERIES }, creator: "OwnerWallet" }];
  const ids = (ticker: string, name: string, r: BurnRule | null = rule) => identityRefusals({ ticker, name }, { existing, rule: r, creator: "VisitorWallet", reserved: new Set(), majors: new Set(), refuseList: false });

  test("the taken name typed by hand: the same-rule sentence, under the name, and never the name twice", () => {
    const out = ids("QUAKENXTM6", "Next Magnitude 6");
    assert.equal(out.length, 1);
    assert.equal(out[0].field, "name");
    assert.equal(out[0].message, "This is the name of the live $NEXTM6, which follows the same rule. Pick a name that cannot be mistaken for it.");
    assert.equal(out[0].message.split("Next Magnitude 6").length, 1);
    assert.deepEqual(serverFieldOf(out[0].message), { side: "a", field: "name" });
    clean(out[0].message);
  });

  test("a clash with a coin on another rule leaves out the same-rule clause", () => {
    const out = ids("QUAKENXTM6", "next magnitude 6", quakeRule("usgs.quakes:6"));
    assert.equal(out[0].message, "This is the name of the live $NEXTM6. Pick a name that cannot be mistaken for it.");
  });

  test("a near name quotes two different strings", () => {
    const out = ids("QUAKENXTM6", "Next Magnitude 6s");
    assert.equal(out[0].field, "name");
    assert.match(out[0].message, /^The name "Next Magnitude 6s" is one letter away from "Next Magnitude 6", the name of the live \$NEXTM6, which follows the same rule\./);
  });

  test("ticker and name both taken: two refusals, each under its own field", () => {
    const out = ids("NEXTM6", "Next Magnitude 6");
    assert.deepEqual(out.map((x) => x.field).sort(), ["name", "ticker"]);
    assert.equal(serverFieldOf(out.find((x) => x.field === "ticker")!.message)?.field, "ticker");
    assert.equal(serverFieldOf(out.find((x) => x.field === "name")!.message)?.field, "name");
  });
});
