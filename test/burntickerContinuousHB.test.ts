// CONTINUOUS AUDIT 2026-10-19, HB-2 / HB-3 / HB-6 / HB-7 / HB-9 / HB-10 / HB-11 (docs/burnticker/audits/continuous/bugs.md). One pure
// test per fix: the Coin vs Coin end said one way on every surface, the server review in words with the page's ticker, ticker suggestions
// from the coin's own rule, the reserved-ticker line said once, named radios with no operator detail, "for each earthquake" under
// "Natural disaster", and the reference-coin search ranked by what was typed.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tileRule } from "@/lib/burnticker/derby/tile";
import { raceEndOf } from "@/lib/burnticker/derby/spec";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { asLinkedPairSide, coinvsEndsLine, endSentences, recordCloseAvailability, RECORD_CLOSE_OFF_LINE } from "@/lib/burnticker/guidedLaunch";
import { derbyExplainer } from "@/lib/burnticker/launchDerby";
import { generatedNames, NONE_EDITED } from "@/lib/burnticker/coinPicker";
import { freeTickers, isTeamRule, tickerChecks } from "@/lib/burnticker/tickerCheck";
import { perUnitPhrase, SUGGESTION_GROUP_LABELS } from "@/lib/burnticker/search";
import { rankDerbyHits } from "@/lib/burnticker/derby/search";
import { reservedLineSaid, RESERVED_TICKER_LINE } from "../src/app/burnticker/launch/pageCopy.ts";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { BONK, WIF } from "./burntickerDerbyHelpers.ts";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const NOW = Date.UTC(2026, 9, 19, 18);
const env = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" };

describe("HB-2 and HB-3: WIF vs BONK, 30 days", () => {
  const names = generatedNames(WIF, BONK, { a: "", b: "", ta: "", tb: "" }, NONE_EDITED);
  const t = tileRule({ a: WIF, b: BONK, window: "daily", seasonDays: 30, flip: false, fraction: 0.02, now: NOW }, "09567dbee8" + "0".repeat(54), { a: names.ta, b: names.tb });
  const rule = t.rule!;
  const end = raceEndOf(t.spec);
  const v = buildLaunchReview({ rule, ticker: names.ta, name: names.a, pair: { ticker: names.tb, name: names.b } }, { env, now: NOW });
  assert.ok("review" in v, JSON.stringify(v));
  const review = v.review;

  test("one end sentence: the burn step, its At the end block, the review's When it ends and the server's endsLine", () => {
    assert.equal(end.line, `Runs for 30 days. ${end.result} ${end.tie}`);
    const burnStep = t.sentence;
    const block = endSentences(asLinkedPairSide(rule)).sentences.join(" ");
    const whenItEnds = coinvsEndsLine(rule)!;
    const surfaces = { burnStep, block, whenItEnds, endsLine: review.rule.endsLine, explainer: derbyExplainer(t.spec, { a: names.ta, b: names.tb }).end };
    for (const [k, s] of Object.entries(surfaces)) {
      assert.equal(count(s, end.result), 1, `${k} names the winner-takes-the-rest end once: ${s}`);
      assert.equal(count(s, end.tie), 1, `${k} names the tie case once: ${s}`);
      assert.doesNotMatch(s, /no end date|does not retire/, k);
      assert.doesNotMatch(s, /each coin's own burn pool burns down over 28 days and the coins retire/, k);
    }
    assert.equal(whenItEnds, end.line);
    assert.equal(review.rule.endsLine, end.line, "the server says the same line, season included");
    assert.equal(block, `${end.result} ${end.tie}`);
    // the burn step carries the end in its sentence, so the tile leaves the block out (said once on the step)
    assert.ok(burnStep.includes(block));
    for (const s of [end.result, end.tie, end.season, end.line]) clean(s);
  });

  test("the server review says it in words, states the run, and suggests the page's tickers", () => {
    const desc = review.coins[0].description ?? "";
    for (const s of [review.rule.sentence, desc]) {
      assert.doesNotMatch(s, /coinvs:/, s);
      assert.doesNotMatch(s, /no end date/, s);
    }
    assert.equal(review.rule.sentence, "$WIFWINS burns every day WIF out-gains BONK.");
    assert.match(desc, /^\$WIFWINS burns every day WIF out-gains BONK\. /);
    assert.match(desc, /Runs for 30 days\./, "the season length");
    assert.equal(review.coins[0].suggestedTicker, "WIFWINS");
    assert.equal(review.coins[0].suggestedTicker, names.ta, "the page's own suggestion");
    assert.equal(review.coins[1].suggestedTicker, names.tb);
    clean(desc);
  });
});

describe("HB-6: ticker suggestions come from the coin's own rule", () => {
  const held = (tk: string) => (t: string) => (t === tk ? [{ mint: "M1", name: `${tk} coin`, ticker: tk, rulesJson: "{}" }] : []);
  test("a held DENWIN is never offered back with something added", () => {
    const team = isTeamRule({ oracle: "catalogue", series: "espn.nfl.team:den:win:season:2026" });
    assert.equal(team, true);
    for (const generated of [null, "DENWIN", "BRONCOWINS"]) {
      const [c] = tickerChecks([{ side: "A", ticker: "DENWIN", generated, team }], { inUse: held("DENWIN"), reserved: new Set() });
      assert.equal(c.taken, true);
      for (const s of c.suggestions) assert.doesNotMatch(s, /^DENWIN/, `${generated}: ${s}`);
    }
    const [own] = tickerChecks([{ side: "A", ticker: "DENWIN", generated: "BRONCOWINS", team }], { inUse: held("DENWIN"), reserved: new Set() });
    assert.equal(own.suggestions[0], "BRONCOWINS", "the rule's own ticker first");
  });
  test("an earthquake coin typing DEFICIT is never offered a team word", () => {
    const quake = { oracle: "catalogue", series: "usgs.quakes:6" };
    assert.equal(isTeamRule(quake), false);
    const [c] = tickerChecks([{ side: "A", ticker: "DEFICIT", generated: "QUIETM", team: isTeamRule(quake) }], { inUse: held("QUIETM"), reserved: new Set(["DEFICIT"]) });
    assert.equal(c.reserved, true);
    for (const s of c.suggestions) { assert.doesNotMatch(s, /(FANS|CLUB|CREW|HQ|SQUAD|GANG)$/, s); assert.doesNotMatch(s, /^(DEFICIT|QUIETM)/, s); }
    const [free] = tickerChecks([{ side: "A", ticker: "DEFICIT", generated: "QUAKE6", team: false }], { inUse: () => [], reserved: new Set(["DEFICIT"]) });
    assert.deepEqual(free.suggestions, ["QUAKE6", "QUAKE62"]);
    assert.deepEqual(freeTickers("QUAKE6", { inUse: () => [], existing: [], reserved: new Set() }, 2).filter((s) => /FANS|CLUB/.test(s)), []);
  });
});

describe("HB-7: the reserved-ticker refusal is said once", () => {
  test("the ticker box leaves the line out when the field already says it", () => {
    assert.equal(reservedLineSaid([RESERVED_TICKER_LINE]), true);
    assert.equal(reservedLineSaid([`Coin A: ${RESERVED_TICKER_LINE}`]), true);
    assert.equal(reservedLineSaid([null, "The ticker can be at most 10 characters."]), false);
    const card = fs.readFileSync("src/app/burnticker/launch/ReviewCard.tsx", "utf8");
    assert.match(card, /\{t\.reserved && !reservedSaid\(t\.side\) && <p>/);
  });
});

describe("HB-9: the Coin comparison step", () => {
  test("named radios; a record close that cannot start is marked unavailable, said without the operator's setup", () => {
    const off = recordCloseAvailability({ keyed: false });
    assert.equal(off.available, false);
    assert.equal(off.line, RECORD_CLOSE_OFF_LINE);
    assert.doesNotMatch(off.line, /Pyth|access key|usually/);
    clean(off.line);
    const tile = fs.readFileSync("src/app/burnticker/launch/CoinVsCoinTile.tsx", "utf8");
    assert.match(tile, /role="radio" aria-checked=\{kind === k\} aria-label=\{k === "pair" \? PAIR_CHOICE_LABEL : HIGH_CHOICE_LABEL\}/);
    assert.match(tile, /disabled=\{busy \|\| !!prepared \|\| off\}/);
  });
});

describe("HB-10: a count of one is a noun, and disasters have their own heading", () => {
  test("for each earthquake, under Natural disaster", () => {
    assert.equal(perUnitPhrase("1 earthquake of magnitude 6 or more"), "for each earthquake of magnitude 6 or more");
    assert.equal(perUnitPhrase("100k players"), "per 100k players");
    assert.equal(SUGGESTION_GROUP_LABELS.disasters, "Natural disaster");
    clean(`Burns 2% ${perUnitPhrase("1 earthquake of magnitude 6 or more")}`);
  });
});

describe("HB-11: the reference-coin search ranks what was typed", () => {
  const hit = (symbol: string, name: string, usable = true) => ({ symbol, name, mint: `${symbol}mint`, feed: null, underlying: usable ? { symbol, pyth: null, mint: null, pool: "p", cross: "jup:x" } : null });
  test("WIF first; names that only mention it after; unrelated coins dropped", () => {
    const hits = [hit("SWORDCAT", "cat wif sword"), hit("BAGUETTE", "Baguette"), hit("SWORDDOG", "Sword Dog", false), hit("KWIF", "Kitten Wif Hat"), hit("WIF", "dogwifhat", false), hit("KWH", "Kilowatt")];
    const out = rankDerbyHits(hits, "wif").map((h) => h.symbol);
    assert.deepEqual(out, ["WIF", "KWIF", "SWORDCAT"]);
    assert.deepEqual(rankDerbyHits(hits, "KWHmint").map((h) => h.symbol), ["KWH"], "a mint finds its coin");
  });
});
