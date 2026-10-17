// Private review 10 F2 (2026-10-14): an election pair's two sides get distinct words, names and tickers. Party control was "Party vs Party"
// with two PARTVPART tickers, and two candidates sharing a surname collided the same way, so the review was disabled.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { electionPairIdentity, electionSideWords, partyOf } from "@/lib/burnticker/electionPairLabels";
import { pairIdentityProblems } from "@/lib/burnticker/guidedLaunch";

const distinct = (x: ReturnType<typeof electionPairIdentity>) => {
  assert.notEqual(x.words.a, x.words.b);
  assert.notEqual(x.names.a, x.names.b);
  assert.notEqual(x.tickers.a, x.tickers.b);
  assert.deepEqual(pairIdentityProblems({ ticker: x.tickers.a, name: x.names.a }, { ticker: x.tickers.b, name: x.names.b }), []);
  // the progress strip says "<side A word> vs <side B word>" (page.tsx guideAnswers.which): both sides must read apart
  assert.notEqual(`${x.words.a} vs ${x.words.b}`, `${x.words.a} vs ${x.words.a}`);
  for (const t of [x.tickers.a, x.tickers.b]) assert.match(t, /^[A-Z0-9]{2,10}$/);
  for (const n of [x.names.a, x.names.b]) assert.ok(new TextEncoder().encode(n).length <= 32, n);
};

describe("F2: election pair identity", () => {
  test("party control is Democrats vs Republicans, $DEMVREP and $REPVDEM", () => {
    const x = electionPairIdentity("Democratic Party", "Republican Party");
    assert.deepEqual(x.words, { a: "Democrats", b: "Republicans" });
    assert.deepEqual(x.tickers, { a: "DEMVREP", b: "REPVDEM" });
    assert.equal(x.names.a, "Democrats vs Republicans");
    assert.equal(x.names.b, "Republicans vs Democrats");
    distinct(x);
    assert.ok(!/Party vs Party/.test(`${x.names.a} ${x.names.b}`));
  });
  test("other party labels", () => {
    assert.deepEqual(partyOf("The Green Party"), { word: "Greens", code: "GRN" });
    assert.equal(partyOf("Kamala Harris"), null);
    distinct(electionPairIdentity("Libertarian Party", "Green Party"));
    distinct(electionPairIdentity("Reform Party", "Labour Party"));
  });
  test("candidates with distinct surnames keep the surname", () => {
    const x = electionPairIdentity("Jon Ossoff (D)", "Mike Collins (R)");
    assert.deepEqual(x.words, { a: "Ossoff", b: "Collins" });
    distinct(x);
  });
  test("one surname twice takes a first initial", () => {
    const x = electionPairIdentity("John Smith", "Karen Smith");
    assert.deepEqual(x.words, { a: "J. Smith", b: "K. Smith" });
    distinct(x);
  });
  test("one surname and one initial take the full name", () => {
    const x = electionPairIdentity("John Smith", "Jane Smith");
    assert.deepEqual(x.words, { a: "John Smith", b: "Jane Smith" });
    distinct(x);
  });
  test("codes that read the same still give two tickers", () => {
    const s = electionSideWords("Ann Smithers", "Bob Smithson");
    assert.notEqual(s.a.code, s.b.code);
    distinct(electionPairIdentity("Ann Smithers", "Bob Smithson"));
  });
  test("the wizard uses it, not the last word of each label", () => {
    const src = fs.readFileSync("src/app/burnticker/launch/page.tsx", "utf8");
    const body = src.slice(src.indexOf("const startElPair"), src.indexOf("const startElPair") + 2000);
    assert.match(body, /electionPairIdentity\(a\.label, b\.label\)/);
    assert.doesNotMatch(body, /pairTickers\(sur\(a\), sur\(b\)\)/);
  });
});
