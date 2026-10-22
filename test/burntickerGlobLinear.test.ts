// AUDIT 2026-10-18 A-37: the Polymarket event slug glob was compiled into one backtracking RegExp and matched synchronously, so a rule
// with a handful of wildcards froze the web process (the public back-test route, the preflight, the review and the keeper all run it).
// The matcher is now a linear two-pointer walk, and the rule validator refuses more than eight wildcards.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { globMatch, polySelectorMatches, type GammaMarket } from "@/lib/burnticker/oracle/polymarket";
import { validateRule, POLY_GLOB_MAX_WILDCARDS, polyGlobWildcards } from "@/lib/burnticker/rules";
import { PM_NFL_MONEYLINE } from "./burntickerPolyHelpers.ts";

describe("A-37: the slug glob matcher is linear", () => {
  test("same answers as before on ordinary globs", () => {
    const cases: [string, string, boolean][] = [
      ["nfl-*den-*", "nfl-den-sf-2026-10-04", true], ["nfl-*den-*", "nfl-sea-den-2026-10-16", true], ["nfl-*den-*", "nfl-kc-lv-2026-10-04", false],
      ["*", "", true], ["*", "anything", true], ["", "", true], ["", "a", false], ["a", "a", true], ["a", "ab", false], ["ab", "a", false],
      ["a*", "a", true], ["*a", "ba", true], ["*a", "ab", false], ["a*b*c", "aXbYc", true], ["a*b*c", "aXbYcZ", false], ["a**b", "ab", true],
      ["nfl-sea-den-2026-10-16", "nfl-sea-den-2026-10-16", true], ["nfl-*-2026-10-*", "nfl-sea-den-2026-10-16", true], ["*-*-*", "a-b", false],
      ["a.b", "axb", false], ["a+", "aa", false],
    ];
    for (const [g, t, want] of cases) assert.equal(globMatch(g, t), want, `${g} vs ${t}`);
  });

  test("a 100-wildcard glob against a 200-character slug answers in under a millisecond", () => {
    const glob = "*".repeat(99) + "b";            // the longest glob the series format admits, every character but one a wildcard
    const mixed = "a" + "*a".repeat(49) + "b";    // 49 wildcards between letters: the shape that made the old RegExp backtrack
    const slug = "a".repeat(200);
    for (let i = 0; i < 50; i++) { globMatch(glob, slug); globMatch(mixed, slug); }   // warm up the JIT
    for (const g of [glob, mixed, "a*".repeat(50)]) {
      const t0 = process.hrtime.bigint();
      const got = globMatch(g, slug);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      assert.ok(ms < 1, `${g.length}-character glob took ${ms.toFixed(3)} ms`);
      assert.equal(got, g === "a*".repeat(50));
    }
  });

  test("polySelectorMatches on a seven-wildcard rule stays fast (the audit's 858 ms case)", () => {
    const rule = { ...PM_NFL_MONEYLINE, series: "tag:nfl/moneyline:" + "a*".repeat(7) + "b", filter: {} } as Parameters<typeof polySelectorMatches>[0];
    const m = { conditionId: "0x" + "1".repeat(64), question: "X vs. Y", eventSlug: "a".repeat(60), outcomes: ["Yes", "No"], sportsMarketType: "moneyline" } as unknown as GammaMarket;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) polySelectorMatches(rule, m);
    assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 50);
  });
});

describe("A-37: the rule validator caps wildcards", () => {
  test(`up to ${POLY_GLOB_MAX_WILDCARDS} wildcards pass, more are refused in plain words`, () => {
    assert.equal(POLY_GLOB_MAX_WILDCARDS, 8);
    const series = (n: number) => "tag:nfl/moneyline:nfl" + "-*".repeat(n);
    assert.equal(polyGlobWildcards(series(8)), 8);
    assert.doesNotThrow(() => validateRule({ ...PM_NFL_MONEYLINE, series: series(8) }));
    assert.throws(() => validateRule({ ...PM_NFL_MONEYLINE, series: series(9) }), /too many wildcards\. Use 8 or fewer\./);
    // a run of `*` matches like one, so it counts once (review of A-37)
    assert.equal(polyGlobWildcards("tag:nfl/moneyline:" + "*".repeat(100)), 1);
    assert.doesNotThrow(() => validateRule({ ...PM_NFL_MONEYLINE, series: "tag:nfl/moneyline:" + "*".repeat(100) }));
    assert.equal(polyGlobWildcards("tag:nfl/moneyline:nfl" + "-**".repeat(8)), 8);
    assert.throws(() => validateRule({ ...PM_NFL_MONEYLINE, series: "tag:nfl/moneyline:n" + "***a".repeat(9) }), /too many wildcards/);
    assert.equal(polyGlobWildcards("event:fed-decision"), 0);
    assert.equal(polyGlobWildcards("tag:nfl/moneyline"), 0);
  });
});
