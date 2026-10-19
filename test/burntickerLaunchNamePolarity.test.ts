// CONTINUOUS AUDIT 2026-10-19T1919Z PROD-02: AN AUTOMATICALLY NAMED NO COIN STILL SAID "DEMS SWEEP". Launch, Event outcome, "Ohio Senate
// and Governor Combo", "Dems sweep", "If it resolves NO": the rule said NO and the ticker became $NODEMOCRAT, but the untouched name stayed
// "Dems sweep", because the source's suggested name won over the rule's and was kept across the YES/NO flip. Now the suggestion keeps the
// side it was made for and is worded for the side the coin burns on (namePolarity.ts); a name the creator typed is never touched.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { noName, ruleSide, suggestionFor, suggestionFromDraft, type SourceSuggestion } from "@/lib/burnticker/namePolarity";
import { NAME_MAX_BYTES, utf8Bytes } from "@/lib/burnticker/launchFields";
import type { BurnRule } from "@/lib/burnticker/rules";

const yesRule = { kind: "binary", binary: { onYes: { fractionOfPool: 1 }, onNo: null } } as unknown as BurnRule;
const noRule = { kind: "binary", binary: { onYes: null, onNo: { fractionOfPool: 1 } } } as unknown as BurnRule;
const scalar = { kind: "scalar", binary: null } as unknown as BurnRule;
const dems: SourceSuggestion = { name: "Dems sweep", ticker: null, side: "yes" };

describe("PROD-02: the default name follows the side", () => {
  test("ruleSide reads a yes/no rule's side; other rules have none", () => {
    assert.equal(ruleSide(yesRule), "yes");
    assert.equal(ruleSide(noRule), "no");
    assert.equal(ruleSide(scalar), null);
    assert.equal(ruleSide(null), null);
  });
  test("the auditor's repro: a YES outcome suggestion on a NO coin says No; YES gives the original back", () => {
    assert.deepEqual(suggestionFor(dems, ruleSide(yesRule)), { name: "Dems sweep", ticker: null });
    assert.deepEqual(suggestionFor(dems, ruleSide(noRule)), { name: "Dems sweep No", ticker: null });
  });
  test("YES to NO to YES round-trips to the original default, name and ticker", () => {
    const s: SourceSuggestion = { name: "Spider", ticker: "SPIDER", side: "yes" };
    const seen = ["yes", "no", "yes", "no", "yes"].map((side) => suggestionFor(s, side as "yes" | "no"));
    assert.deepEqual(seen[0], { name: "Spider", ticker: "SPIDER" });
    assert.deepEqual(seen[1], { name: "Spider No", ticker: "NOSPIDER" });
    assert.deepEqual(seen[2], seen[0]); assert.deepEqual(seen[3], seen[1]); assert.deepEqual(seen[4], seen[0]);
  });
  test("the name and the ticker agree on the side (describe.ts's NO form: '<name> No' beside 'NO<ticker>')", () => {
    const out = suggestionFor({ name: "Democrats", ticker: "DEMOCRAT", side: "yes" }, "no");
    assert.match(out.name!, / No$/); assert.match(out.ticker!, /^NO/);
    assert.equal(out.ticker, "NODEMOCRAT");
    const describe = fs.readFileSync("src/lib/burnticker/describe.ts", "utf8");
    assert.match(describe, /fitName\(`\$\{id\.verb && id\.confident \? id\.name : "Event"\} No`\), `NO\$\{tickerFrom\(id\.ticker\)\}`\.slice\(0, 10\)/, "the same NO form the rule's own name uses");
  });
  test("a long name and ticker still fit the on-chain limits", () => {
    const out = suggestionFor({ name: "Ohio Senate and Governor Combo", ticker: "OHIOCOMBO", side: "yes" }, "no");
    assert.ok(utf8Bytes(out.name!) <= NAME_MAX_BYTES);
    assert.ok(out.ticker!.length <= 10 && out.ticker!.startsWith("NO"));
  });
  test("a NO suggestion on a YES coin falls back to the rule's own wording; no side known keeps the suggestion as made", () => {
    assert.deepEqual(suggestionFor({ name: "Lakers Fall Short", ticker: "NOLAL", side: "no" }, "yes"), { name: null, ticker: null });
    assert.deepEqual(suggestionFor({ name: "Lakers Fall Short", ticker: "NOLAL", side: "no" }, "no"), { name: "Lakers Fall Short", ticker: "NOLAL" });
    assert.deepEqual(suggestionFor({ name: "Denver Snow", ticker: "DENSNOW" }, "no"), { name: "Denver Snow", ticker: "DENSNOW" });
    assert.deepEqual(suggestionFor({ name: "Denver Snow", ticker: "DENSNOW", side: "yes" }, null), { name: "Denver Snow", ticker: "DENSNOW" });
  });
  test("a resumed draft keeps the suggestion and its side, so the reloaded NO coin is still named for NO; an older draft reads as none", () => {
    const saved = JSON.parse(JSON.stringify({ srcSuggest: dems })) as { srcSuggest: unknown };
    const back = suggestionFromDraft(saved.srcSuggest);
    assert.deepEqual(back, dems);
    assert.equal(suggestionFor(back, "no").name, "Dems sweep No");
    assert.deepEqual(suggestionFromDraft(undefined), { name: null, ticker: null, side: null });
    assert.deepEqual(suggestionFromDraft({ name: 3, ticker: "X", side: "maybe" }), { name: null, ticker: "X", side: null });
  });
});

// PROD-02 v2 (continuous audit 2026-10-19T1949Z): " No" was appended and then cut away by the 32-byte fit on long names
describe("PROD-02 v2: the NO marker survives the name length fit", () => {
  const keepsNo = (src: string) => {
    const s: SourceSuggestion = { name: src, ticker: "DEMOCRAT", side: "yes" };
    const yes = suggestionFor(s, "yes"), no = suggestionFor(s, "no");
    assert.equal(yes.name, src);
    assert.notEqual(no.name, yes.name, "a NO coin never gets the unchanged affirmative name");
    assert.match(no.name!, / No$/, "the marker survives the fit");
    assert.ok(utf8Bytes(no.name!) <= NAME_MAX_BYTES, `${no.name} fits in ${NAME_MAX_BYTES} bytes`);
    assert.equal(no.ticker, "NODEMOCRAT");
    assert.deepEqual(suggestionFor(s, "yes"), yes, "YES again gives the original back");
    assert.equal(suggestionFor(suggestionFromDraft(JSON.parse(JSON.stringify(s))), "no").name, no.name, "a resumed draft keeps it");
    return no.name!;
  };
  test("the auditor's three cases", () => {
    assert.equal(keepsNo("Dems sweep"), "Dems sweep No");
    assert.equal(keepsNo("Ohio Senate and Governor Combo"), "Ohio Senate and Governor No");
    assert.equal(keepsNo("Democrats win the Ohio election"), "Democrats win the Ohio No");
  });
  test("29-, 30-, 31- and 32-byte source names each keep a clear NO within the limit", () => {
    for (const src of ["Lakers win the West Final 26", "Lakers win the Western Final!", "Lakers win the Western Finals!", "Lakers win the Western Finals!!"].map((x, i) => x.padEnd(29 + i, "x").slice(0, 29 + i))) {
      assert.equal(utf8Bytes(src), src.length);
      keepsNo(src);
    }
    for (const n of [29, 30, 31, 32]) { const src = "A".repeat(n); assert.equal(keepsNo(src), `${"A".repeat(NAME_MAX_BYTES - 3)} No`); }
  });
  test("multibyte names (emoji, accents) keep the marker too and never split a character", () => {
    for (const src of ["Équipe gagne la coupe 🏆🏆", "Señor Peña Gana Élection ñ", "🚀🚀🚀🚀🚀🚀🚀🚀", "Zoë"]) {
      const out = keepsNo(src);
      assert.ok(!out.includes("\uFFFD"));
      assert.ok(src.startsWith(out.slice(0, -3)), "the base is a whole-character prefix of the source");
    }
    assert.equal(noName("Zoë"), "Zoë No");
  });
});

describe("PROD-02: the launch page wiring", () => {
  const page = fs.readFileSync("src/app/burnticker/launch/page.tsx", "utf8");
  test("the review's effect words the suggestion for the side on screen, and only while the name is automatic (a typed name is kept)", () => {
    assert.match(page, /const sideNow = ruleSide\(ruleShown\);/);
    assert.match(page, /const sug = suggestionFor\(srcSuggest, sideNow\);/);
    assert.match(page, /const want = genTicker \?\? sug\.ticker \?\? text\.ticker, wantName = sug\.name \?\? text\.name;/);
    assert.match(page, /if \(nameAuto && wantName && wantName !== name && flow !== "pair"\) setName\(wantName\);/);
    assert.match(page, /if \(tickerAuto && want && want !== ticker\) setTicker\(want\);/);
    assert.match(page, /\}, \[text, step, tickerAuto, nameAuto, ticker, name, flow, genTicker, srcSuggest, sideNow\]\);/);
  });
  test("every suggestion records its side: the search card, the event outcome and a Polymarket pick", () => {
    assert.match(page, /setSrcSuggest\(\{ name: o\.name \?\? null, ticker: o\.ticker \?\? null, side: ruleSide\(r\) \}\);/);
    assert.match(page, /setSrcSuggest\(\{ name: m\.outcome \? m\.outcome\.slice\(0, 32\) : null, ticker: null, side: "yes" \}\);/);
    assert.doesNotMatch(page, /srcSuggest\.name \?\?/, "the raw suggestion never wins over the side");
  });
  test("the draft saves and restores the suggestion", () => {
    assert.match(page, /nameAuto, tickerAuto, editedFor, ownImage, note, srcSuggest \}\);/);
    assert.match(page, /set\("srcSuggest", \(v: unknown\) => setSrcSuggest\(suggestionFromDraft\(v\)\)\);/);
  });
});
