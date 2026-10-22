// LAUNCH AUDIT 241–249 (launch-media-recovery, 2026-10-12): the Coin vs Coin picker and tile. The rules live in coinPicker.ts; the
// tile's wiring is checked in its source. Nothing here reaches the search route or the launch route.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createLatest } from "@/lib/burnticker/latestOnly";
import { assetIds, deepLinkPick, deepLinkQuery, editedFrom, generatedNames, pickerNote, searchToken, visibleHits, NONE_EDITED, QUERY_HINT, type PickerHit } from "@/lib/burnticker/coinPicker";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const tile = fs.readFileSync(path.join(ROOT, "src/app/burnticker/launch/CoinVsCoinTile.tsx"), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const cfg = loadCopyLintConfig();
const WIF_MINT = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", FAKE_WIF = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", WIF_FEED = "4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc";
const hit = (o: Partial<PickerHit> & { symbol: string }): PickerHit => ({ source: "jupiter", feed: null, mint: null, underlying: null, ...o });
const pythWif = hit({ symbol: "WIF", source: "pyth", feed: WIF_FEED, mint: WIF_MINT, underlying: { pyth: WIF_FEED, mint: WIF_MINT } });
const jupWif = hit({ symbol: "WIF", mint: WIF_MINT, underlying: { pyth: null, mint: WIF_MINT, pool: "P1" } });
const otherWif = hit({ symbol: "WIF", mint: FAKE_WIF, underlying: { pyth: null, mint: FAKE_WIF, pool: "P2" } });
const bonk = hit({ symbol: "BONK", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", underlying: { pyth: null, mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", pool: "P3" } });

describe("241 [FIX] the other side is excluded by asset, not by symbol", () => {
  test("a different coin with the same ticker stays; the same coin from another source goes", () => {
    // the defect: hits.filter((h) => h.symbol !== exclude) hid the other WIF too, and kept a lower-case symbol of the same coin
    assert.deepEqual([pythWif, jupWif, otherWif, bonk].filter((h) => h.symbol !== pythWif.symbol), [bonk], "the old filter (for the record)");
    assert.deepEqual(visibleHits([pythWif, jupWif, otherWif, bonk], pythWif), [otherWif, bonk]);
    assert.deepEqual(visibleHits([hit({ ...jupWif, symbol: "wif" })], pythWif), [], "same mint, other spelling: still the same coin");
    assert.ok(assetIds(pythWif).includes(`pyth:${WIF_FEED}`) && assetIds(pythWif).includes(`mint:${WIF_MINT}`));
    assert.match(code(tile), /visibleHits\(hits, exclude\)/);
    assert.doesNotMatch(tile, /h\.symbol !== exclude/);
    assert.match(code(tile), /exclude=\{b\}/); assert.match(code(tile), /exclude=\{a\}/);
  });
});

describe("242 [VERIFY] a deep link's value is bounded", () => {
  test("a ticker keeps its 12 characters; a full mint is kept whole (the old slice cut it to a prefix that matches nothing)", () => {
    assert.equal(deepLinkQuery("WIF"), "WIF");
    assert.equal(deepLinkQuery("ABCDEFGHIJKLMNOP"), "ABCDEFGHIJKL");
    assert.equal(WIF_MINT.slice(0, 12), "EKpQGSJtjMFq", "what the old slice sent to the search");
    assert.equal(deepLinkQuery(WIF_MINT), WIF_MINT);
    assert.equal(deepLinkQuery(null), "");
    assert.equal(deepLinkQuery(` ${"x".repeat(500)} `), "x".repeat(12));
    assert.match(code(tile), /a: deepLinkQuery\(u\.get\("a"\)\), b: deepLinkQuery\(u\.get\("b"\)\)/);
  });
});

describe("243 [VERIFY] a deep link never auto-selects an ambiguous ticker", () => {
  test("two different WIF coins: nothing is picked and the picker says to choose; one asset from two sources: picked", () => {
    // the defect: hits.find((x) => symbol matches && underlying) picked whichever WIF the search listed first
    const amb = deepLinkPick([otherWif, pythWif], "WIF", null);
    assert.equal(amb.pick, null);
    assert.equal(amb.ambiguous.length, 2);
    assert.match(pickerNote({ query: "WIF", searched: true, busy: false, error: null, hits: [otherWif, pythWif], exclude: null, ambiguous: amb.ambiguous })!, /More than one coin uses the ticker WIF\. Pick the one you mean below\./);
    assert.equal(deepLinkPick([pythWif, jupWif, bonk], "wif", null).pick, pythWif, "the same asset twice is not ambiguous");
    assert.equal(deepLinkPick([otherWif, pythWif], WIF_MINT, null).pick, pythWif, "a mint is exact");
    assert.equal(deepLinkPick([otherWif, pythWif], "WIF", otherWif).pick, pythWif, "the other side's coin is not a candidate");
    assert.equal(deepLinkPick([hit({ symbol: "WIF", mint: WIF_MINT })], "WIF", null).pick, null, "a hit that cannot launch is never picked");
    assert.match(code(tile), /deepLinkPick\(hits, initial, exclude\)/);
  });
});

describe("244 [FIX] a query under 2 characters invalidates searches in flight", () => {
  test("WIF is searched, then the box drops to W before the answer: the answer is stale", () => {
    const latest = createLatest();
    const t = searchToken(latest, "WIF")!;
    assert.equal(latest.isCurrent(t), true);
    // the defect: the effect returned early on a short query without touching the sequence, so the WIF answer still applied
    assert.equal(searchToken(latest, "W"), null);
    assert.equal(latest.isCurrent(t), false);
    assert.equal(searchToken(latest, ""), null);
    const c = code(tile);
    assert.match(c, /const my = searchToken\(latest, q\);/);
    assert.match(c, /if \(my === null\) \{ setHits\(\[\]\); setBusy\(false\); setErr\(null\); setSearched\(false\); return; \}/);
  });
});

describe("245 + 246 the line under the search box", () => {
  test("type more; nothing matched; the only match is the other coin", () => {
    const base = { searched: true, busy: false, error: null, exclude: null };
    assert.equal(pickerNote({ ...base, query: "W", searched: false, hits: [] }), QUERY_HINT);
    assert.equal(QUERY_HINT, "Enter at least 2 characters to search.");
    assert.equal(pickerNote({ ...base, query: "", searched: false, hits: [] }), null);
    assert.match(pickerNote({ ...base, query: "ZZZ", hits: [] })!, /No coin matches that search/);
    assert.equal(pickerNote({ ...base, query: "WIF", hits: [pythWif], exclude: pythWif }), "The only match is WIF, which is already the other coin. Search for a different coin.");
    assert.equal(pickerNote({ ...base, query: "WIF", hits: [pythWif, bonk], exclude: pythWif }), null);
    assert.equal(pickerNote({ ...base, query: "WIF", hits: [], busy: true }), null, "nothing while the search runs");
    for (const s of [QUERY_HINT, pickerNote({ ...base, query: "ZZZ", hits: [] })!, pickerNote({ ...base, query: "WIF", hits: [pythWif], exclude: pythWif })!]) assert.ok(lintCopy(s, cfg).ok, s);
    assert.match(code(tile), /data-picker-note/);
  });
});

describe("247 [VERIFY] closing the Coin vs Coin panel", () => {
  test("the close control is not offered while a launch is being signed (closing unmounted the signing card mid-run)", () => {
    const c = code(tile);
    // website-22 (QA 9 item 38): the tile walks the page's guided steps, so it has no close control at all; Back is the page's
    assert.doesNotMatch(c, />close<\/button>/);
  });
});

describe("248 per-field edited flags", () => {
  test("editing coin A's name, then changing coin B: B's name and ticker follow the new pick, A's typed name stays", () => {
    const wif = { symbol: "WIF" }, shib = { symbol: "SHIB" }, bonkS = { symbol: "BONK" };
    let names = generatedNames(wif, shib, { a: "", b: "", ta: "", tb: "" }, NONE_EDITED);
    assert.deepEqual(names, { a: "WIF Wins", b: "SHIB Wins", ta: "WIFWINS", tb: "SHIBWINS" }, "cheap-features item 15: a daily race carries the fight");
    assert.deepEqual(generatedNames(wif, shib, { a: "", b: "", ta: "", tb: "" }, NONE_EDITED, { flip: true }), { a: "WIF vs SHIB, WIF side", b: "SHIB vs WIF, SHIB side", ta: "WIFVSHIB", tb: "SHIBVWIF" }, "the flippening keeps its pair tickers");
    names = { ...names, a: "My dog coin" };
    const edited = { ...NONE_EDITED, a: true };
    const after = generatedNames(wif, bonkS, names, edited);
    assert.equal(after.a, "My dog coin");
    assert.deepEqual([after.b, after.ta, after.tb], ["BONK Wins", "WIFWINS", "BONKWINS"], "the single flag froze these at SHIB");
    assert.deepEqual(editedFrom(true), { a: true, b: true, ta: true, tb: true }, "an older stored draft keeps every field it had");
    assert.deepEqual(editedFrom(undefined), NONE_EDITED);
    const c = code(tile);
    assert.match(c, /setNames\(\(n\) => generatedNames\(a, b, n, edited, \{ flip \}\)\)/, "website-26: the tile passes { flip }");
    assert.match(c, /setEdited\(\(e\) => \(\{ \.\.\.e, ta: true \}\)\)/);
  });
});

describe("249 [VERIFY] a venue 409 waits for a second press, with a fresh review", () => {
  test("the tile no longer retries on the other venue by itself; the venue is part of the reviewed draft", () => {
    const c = code(tile);
    // the defect: `if (nv && !retried) { setVenue(nv); return run(nv, true); }` built the other venue's terms without a new review or press
    assert.doesNotMatch(c, /return run\(nv, true\)/);
    assert.match(c, /const nv = venueFrom409\(e\); if \(nv\) setVenue\(nv\); setErr\(String\(\(e as Error\)\.message \?\? e\)\);/);
    assert.match(c, /const reviewKey = draftRevision\(\[ruleA, fieldB, names, profA\.description, profB\.description, raiseSol, venue\]\);/);
  });
});
