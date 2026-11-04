// 2026-10-22 EXTERNAL AUDIT BT-FADE-GENERATED-NAME-01 (publish 121): Published data → Economics → U.S. egg price → "When it does not
// happen" suggested the name "No Move U.S. egg price" ($NOEGGS). The name field's own check (the copy lint's creator scope) refuses
// "price", so Review was disabled before the creator typed anything. These pin that every suggestion the wizard can generate for a
// published-data source, plain and fade side, passes both the name step's field check (fieldChecks.ts) and the server's check the
// review and prepare routes run (coinText.ts creatorTextProblems), while what the creator types is still refused.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { catalogue } from "@/lib/burnticker/catalogue";
import { loadCategories, publishedDataCategories } from "@/lib/burnticker/browse";
import { validateRule, BURNTICKER_RULES_SCHEMA, type BurnRule } from "@/lib/burnticker/rules";
import { describeRule } from "@/lib/burnticker/describe";
import { creatorTextProblems, serverDescribeCtx } from "@/lib/burnticker/coinText";
import { sourceText } from "@/lib/burnticker/launchPreflight";
import { fieldRuleSentence } from "@/app/burnticker/launch/fieldChecks";
import { inverseRefusal } from "@/lib/burnticker/inverse";
import { creatorSafeName } from "@/lib/burnticker/generatedName";

const feeds = catalogue().filter((f) => f.unit && f.baseline !== undefined && f.direction);
const published = new Set(publishedDataCategories(loadCategories()).flatMap((c) => c.feeds));
const ruleFor = (f: (typeof feeds)[number], inverse: boolean): BurnRule => {
  const r = validateRule({ schema: BURNTICKER_RULES_SCHEMA, oracle: "catalogue", series: f.id, market: null, filter: {}, kind: "scalar", scalar: { unit: f.unit!.size, perUnit: { fractionOfPool: 0.02 }, baseline: f.baseline!, direction: f.direction! }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } as never) as BurnRule;
  return inverse ? ({ ...r, inverse: true } as BurnRule) : r;
};
/** the wizard's own describe context (launch/page.tsx textCtx) and the review route's (launchReview.ts: sourceText + serverDescribeCtx) */
const wizardText = (f: (typeof feeds)[number], r: BurnRule) => describeRule(r, { ticker: "", feed: { title: f.title, sourceName: f.sourceName, unitLabel: f.unit!.label } });
const serverText = (r: BurnRule) => { const src = sourceText(r); return describeRule(r, { ticker: "", ...serverDescribeCtx(r, {}, { seriesTitle: src?.title ?? null, feed: src?.feed ?? null }), ...(src?.subjectName ? { subjectName: src.subjectName } : {}) }); };
const problems = (name: string, ticker: string): string[] => [
  ...creatorTextProblems({ name, ticker, note: "" }).map((p) => `server ${p.field}: ${p.reason}`),
  ...[fieldRuleSentence("name", name), fieldRuleSentence("ticker", ticker)].filter((x): x is string => !!x).map((x) => `field: ${x}`),
];

describe("BT-FADE-GENERATED-NAME-01: every generated published-data name passes the name field's own check", () => {
  test("the catalogue covers the published-data categories (the scan is not empty)", () => {
    assert.ok(feeds.length >= 20, `${feeds.length} feeds`);
    for (const id of ["bls.eggs", "usda.eggs", "fred.UNRATE", "treasury.debt"]) assert.ok(published.has(id) && feeds.some((f) => f.id === id), id);
  });

  test("for every catalogue subject, the default and the fade side's name and ticker pass the field check and the server check", () => {
    const bad: string[] = [];
    let checked = 0;
    for (const f of feeds) for (const inverse of [false, true]) {
      const r = ruleFor(f, inverse);
      if (inverse && inverseRefusal(r) !== null) continue;
      for (const [who, t] of [["wizard", wizardText(f, r)], ["review", serverText(r)]] as const) {
        checked++;
        assert.ok(t.name.trim() && t.ticker.trim(), `${f.id} ${inverse ? "fade" : "plain"} ${who}: empty suggestion`);
        for (const p of problems(t.name, t.ticker)) bad.push(`${f.id} ${inverse ? "fade" : "plain"} ${who} "${t.name}" $${t.ticker}: ${p}`);
      }
    }
    assert.ok(checked >= 80, `${checked} suggestions checked`);
    assert.deepEqual(bad, []);
  });

  test("the audited case: U.S. egg price, When it does not happen, suggests a clean name and $NOEGGS", () => {
    const f = feeds.find((x) => x.id === "bls.eggs")!;
    for (const t of [wizardText(f, ruleFor(f, true)), serverText(ruleFor(f, true))]) {
      assert.equal(t.name, "No Move U.S. Eggs");
      assert.equal(t.ticker, "NOEGGS");
      assert.doesNotMatch(t.name, /price/i);
      assert.match(t.oneLiner, /U\.S\. egg price/, "the rule text keeps the catalogue's own title");
    }
    assert.equal(wizardText(f, ruleFor(f, false)).name, "U.S. Eggs");
  });

  test("the restriction on what the creator types is unchanged", () => {
    assert.ok(fieldRuleSentence("name", "No Move U.S. egg price"));
    assert.ok(creatorTextProblems({ name: "No Move U.S. egg price", ticker: "NOEGGS", note: "" }).some((p) => p.field === "name"));
  });

  test("creatorSafeName drops only the refused words, keeps clean names as they are, and never returns an empty name", () => {
    assert.equal(creatorSafeName("Broncos Win"), "Broncos Win");
    assert.equal(creatorSafeName("No Move U.S. egg price"), "No Move U.S. egg");
    assert.equal(creatorSafeName("price"), "Data Coin");
    for (const n of ["Gas price of the week", "Price Watch", "Egg prices"]) { const s = creatorSafeName(n); assert.ok(s.trim()); assert.equal(fieldRuleSentence("name", s), null, s); }
  });
});
