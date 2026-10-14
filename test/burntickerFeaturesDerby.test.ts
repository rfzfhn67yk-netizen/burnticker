// CHEAP-FEATURES PASS, COIN VS COIN ADOPTION (owner 2026-10-13, CHEAP-FEATURES-BRIEF items 11-15), the library side: the live scoreboard
// (days won, current streak, SOL forwarded, run day N of M) for both coin pages and the share card, run-length presets 7 / 14 / 30, the
// fight-style tickers ($WIFWINS / $BONKWINS) with the end said as a result, the fight lead line, and three pre-made rivalries.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lintCopy } from "@/lib/launch/copyLint";
import { rulesSha256 } from "@/lib/burnKeeper/rules";
import { derbyScoreboard, coinDerbyScoreboard } from "@/lib/burnticker/derby/page";
import { DERBY_RUN_PRESETS, DERBY_SEASON_DAYS, derbySentence, raceEndSentence, runPresetLabel } from "@/lib/burnticker/derby/spec";
import { fightLead, fightTicker, fightTickers, tileHashInput, tileRule } from "@/lib/burnticker/derby/tile";
import { RIVALRY_TEMPLATES, rivalryById } from "@/lib/burnticker/templates";
import { renderReceiptCardSvg } from "@/lib/burnticker/receiptCard";
import { lockRule } from "@/lib/burnticker/rules";
import { generatedNames, NONE_EDITED } from "@/lib/burnticker/coinPicker";
import { openRegistry } from "@/lib/burnticker/registry";
import { BRONCOS } from "./burntickerHelpers.ts";

const plain = (text: string, where: string) => {
  const r = lintCopy(text);
  assert.ok(r.ok, `${where}: ${r.hits.map((h) => h.phrase).join(", ")} in "${text}"`);
  assert.doesNotMatch(text, /\b(buy|buys|buying|price|prices|will|coming soon|payouts?|targets?)\b/i, `${where}: "${text}"`);
};
const day = (n: number, winner: "A" | "B" | "tie" | null, status: "decided" | "withheld" = "decided") => ({ day: n, at: `2026-10-${String(10 + n).padStart(2, "0")}T23:59:59Z`, status, winner });

describe("12: the live scoreboard", () => {
  test("days won, ties, the current streak (a tie ends it), SOL moved, run day N of M, in one line", () => {
    const s = derbyScoreboard({ days: [day(1, "B"), day(2, "tie"), day(3, "A"), day(4, null, "withheld"), day(5, "A"), day(6, "A")], score: { a: 3, b: 1, ties: 1, withheld: 1 }, forwarded: { aToB: "0.01", bToA: "0.03" }, season: { days: 30, over: false } }, { a: "WIFWINS", b: "BONKWINS" });
    assert.deepEqual(s.daysWon, { a: 3, b: 1 });
    assert.deepEqual(s.streak, { side: "A", days: 3 }, "a held-back day does not end a run");
    assert.deepEqual(s.forwardedSol, { toA: "0.03", toB: "0.01" });
    assert.deepEqual(s.run, { day: 6, of: 30, over: false });
    assert.equal(s.line, "$WIFWINS 3 : 1 $BONKWINS, 1 tied. Day 6 of 30. $WIFWINS has won the last 3 days in a row. 0.04 SOL has moved to the winning side's burn pool so far.");
    plain(s.line.replace(/\$[A-Z]+/g, "coin"), "scoreboard");
    const tied = derbyScoreboard({ days: [day(1, "A"), day(2, "tie")], score: { a: 1, b: 0, ties: 1, withheld: 0 }, forwarded: { aToB: "0", bToA: "0" }, season: { days: 7, over: true } }, { a: "X", b: "Y" });
    assert.deepEqual(tied.streak, { side: null, days: 0 });
    assert.match(tied.line, /The run of 7 days is over\./);
  });
  test("the share card draws the scoreboard; a coin outside a derby pair has none", () => {
    const r = lockRule(BRONCOS);
    const svg = renderReceiptCardSvg({ ticker: "WIFWINS", sentence: "Burns on a day WIF out-gains BONK.", rule: r.rule, sha256: r.sha256, latest: null, burns: 0, scoreboard: "$WIFWINS 3 : 1 $BONKWINS. Day 6 of 30." });
    assert.match(svg, /\$WIFWINS 3 : 1 \$BONKWINS\. Day 6 of 30\./);
    assert.equal(coinDerbyScoreboard(openRegistry(":memory:"), "NoSuchMint"), null);
  });
});

describe("14 and 15: run lengths, fight tickers and the end said as a result", () => {
  test("7, 14 and 30 days, inside the API's bounds", () => {
    assert.deepEqual([...DERBY_RUN_PRESETS], [7, 14, 30]);
    for (const d of DERBY_RUN_PRESETS) { assert.ok(d >= DERBY_SEASON_DAYS.min && d <= DERBY_SEASON_DAYS.max); plain(runPresetLabel(d), "preset"); }
  });
  test("$WIFWINS / $BONKWINS, ten characters at most; the flippening keeps its pair tickers", () => {
    assert.deepEqual(fightTickers("WIF", "BONK"), { a: "WIFWINS", b: "BONKWINS" });
    assert.equal(fightTicker("PENGU"), "PENGUWINS");
    assert.equal(fightTicker("FARTCOIN"), "FARTCOWINS");
    assert.equal(fightTicker("POPCAT"), "POPCATWINS");
    for (const s of ["A", "WIF", "FARTCOIN", "ABCDEFGHIJKL"]) assert.match(fightTicker(s), /^[A-Z0-9]{2,10}$/);
    assert.deepEqual(generatedNames({ symbol: "WIF" }, { symbol: "BONK" }, { a: "", b: "", ta: "", tb: "" }, NONE_EDITED), { a: "WIF Wins", b: "BONK Wins", ta: "WIFWINS", tb: "BONKWINS" });
    assert.equal(generatedNames({ symbol: "SOL" }, { symbol: "ETH" }, { a: "", b: "", ta: "", tb: "" }, NONE_EDITED, { flip: true }).ta, "SOLVETH");
    assert.equal(fightLead("WIFWINS", "BONKWINS", 30), "$WIFWINS vs $BONKWINS: 30 days, every day a winner.");
    plain(fightLead("A", "B", 14).replace(/\$[A-Z]+/g, "coin"), "lead");
    plain(raceEndSentence(14), "end");
  });
  test("a two-coin daily race's review sentence ends on the tally; a single coin and the flippening keep their ends", () => {
    const wif = RIVALRY_TEMPLATES[0].a, bonk = RIVALRY_TEMPLATES[0].b;
    const spec = { selector: "coinvs" as const, a: wif, b: bonk, window: "daily" as const, measure: "pct" as const, season: { start: "2026-10-14", days: 14 }, flip: false };
    assert.match(derbySentence(spec, "WIFWINS", "BONKWINS", 0.02), /Runs for 14 days\. At the end, the side with more winning days takes the rest\.$/);
    assert.match(derbySentence(spec, "WIFWINS", null, 0.02), /Runs for 14 days, then winds down\.$/);
    assert.match(derbySentence({ ...spec, measure: "mcap", flip: true }, "A", "B", 1), /then winds down\.$/);
  });
});

describe("13: three pre-made rivalries", () => {
  test("both reference coins picked and valid; the tile builds each rule with no problem; plain copy; one tap to the Name step", () => {
    assert.deepEqual(RIVALRY_TEMPLATES.map((r) => r.id), ["wif-bonk", "pengu-fartcoin", "sol-eth-flip"]);
    for (const r of RIVALRY_TEMPLATES) {
      const choice = { a: r.a, b: r.b, window: r.window, seasonDays: r.seasonDays, flip: r.flip, fraction: r.flip ? 1 : 0.02, now: Date.parse("2026-10-13T18:00:00Z") };
      const m = tileRule(choice, rulesSha256(tileHashInput(choice)), r.tickers);
      assert.deepEqual(m.problems, [], r.id);
      for (const t of [r.tickers.a, r.tickers.b]) assert.match(t, /^[A-Z0-9]{2,10}$/);
      assert.equal(r.lands, "name");
      assert.match(r.href, new RegExp(`rivalry=${r.id}$`));
      plain(r.example.replace(/\$[A-Z]+/g, "coin"), r.id);
      plain(r.title, r.id);
      assert.equal(rivalryById(r.id), r);
    }
    assert.equal(rivalryById("nope"), null);
  });
});
