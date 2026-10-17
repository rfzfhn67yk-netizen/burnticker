// Third prelaunch audit 2026-10-16 F09: /burnticker/rivalries listed an abandoned draft pair (both tokens expired, no launch transaction)
// next to the live pair with the same tickers. Every public pair list (the scoreboards page, the Burn Derby index and the sitemap) now
// applies one rule: a pair with no launched side is not listed; a pair with one launched side is listed with that said; two launched
// pairs that share tickers are both listed.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { publicPairs, pairLifecycleLine } from "@/lib/burnticker/publicPairs";
import { lintCopy } from "@/lib/launch/copyLint";

const tok = (mint: string, ticker: string, status: string, launchTx: string | null = status === "draft" || status === "expired" ? null : "sig") => ({ mint, ticker, status, launchTx });
const TOKENS = new Map([
  ["a1", tok("a1", "PITWIN", "live")], ["b1", tok("b1", "BALWIN", "live")],
  ["a2", tok("a2", "PITWIN", "expired")], ["b2", tok("b2", "BALWIN", "expired")],
  ["a3", tok("a3", "PITWIN", "live")], ["b3", tok("b3", "BALWIN", "retired")],
  ["a4", tok("a4", "AAA", "live")], ["b4", tok("b4", "BBB", "draft")],
]);
const pair = (pairId: string, mintA: string, mintB: string) => ({ pairId, mintA, mintB, selectorKey: "catalogue:x", createdAt: 1 });
const reg = { pairs: () => [pair("pitwin-vs-balwin-espn-team-nfl-pit-23-wi", "a1", "b1"), pair("pitwin-vs-balwin-espn-team-nfl-pit-23-wi-2", "a2", "b2"), pair("pitwin-vs-balwin-3", "a3", "b3"), pair("aaa-vs-bbb", "a4", "b4"), pair("ghost", "zz", "yy")], token: (m: string) => TOKENS.get(m) ?? null };

describe("F09: public pair lists leave out pairs that never launched", () => {
  test("the abandoned draft pair is out (before: listed beside the live one); two launched pairs with the same tickers both stay", () => {
    const ids = publicPairs(reg as never).map((p) => p.pairId);
    assert.deepEqual(ids, ["pitwin-vs-balwin-espn-team-nfl-pit-23-wi", "pitwin-vs-balwin-3", "aaa-vs-bbb"]);
  });
  test("a pair with one launched side says so; the line lints", () => {
    const half = publicPairs(reg as never).find((p) => p.pairId === "aaa-vs-bbb")!;
    assert.equal(half.lifecycle, "one-side");
    const line = pairLifecycleLine(half)!;
    assert.equal(line, "Only $AAA launched. The other coin of this pair has not launched on Burnticker.");
    assert.deepEqual(lintCopy(line).hits, []);
    assert.equal(pairLifecycleLine(publicPairs(reg as never)[0]), null);
  });
  test("the scoreboards page, the derby index and the sitemap's pair list all use it", () => {
    for (const f of ["src/app/burnticker/rivalries/page.tsx", "src/app/burnticker/derby/page.tsx", "src/lib/burnticker/leaguesServe.ts"]) {
      const src = fs.readFileSync(f, "utf8");
      assert.match(src, /publicPairs\(p\.registry\)/, f);
      assert.doesNotMatch(src, /p\.registry\.pairs\(\)/, `${f} never lists the raw pairs table`);
    }
  });
});

describe("review follow-up 3: pair pages link each side by its own coin page and say the pair's lifecycle; the derby API uses the same rule", () => {
  test("pairSideHrefs: a shared ticker links by mint; pairLifecycle for a pair with no launched side", async () => {
    const { pairSideHrefs, pairLifecycle } = await import("@/lib/burnticker/publicPairs");
    const all = [...TOKENS.values()].map((t) => ({ ...t, creator: "c" }));
    const r = { ...reg, tokens: () => all };
    const h = pairSideHrefs(r as never, reg.pairs()[0]);
    assert.deepEqual(h, { a: "/burnticker/t/a1", b: "/burnticker/t/b1" }, "PITWIN and BALWIN are held by more than one coin, so the mint");
    assert.equal(pairSideHrefs(r as never, reg.pairs()[3]).a, "/burnticker/t/AAA");
    assert.equal(pairLifecycle(r as never, "pitwin-vs-balwin-espn-team-nfl-pit-23-wi-2"), "Neither coin of this pair has launched on Burnticker.");
    assert.equal(pairLifecycle(r as never, "aaa-vs-bbb"), "Only $AAA launched. The other coin of this pair has not launched on Burnticker.");
    assert.equal(pairLifecycle(r as never, "pitwin-vs-balwin-espn-team-nfl-pit-23-wi"), null);
    assert.deepEqual(lintCopy("Neither coin of this pair has launched on Burnticker.").hits, []);
  });
  test("the app's pair page links sides through the API's hrefs and shows the lifecycle line; the derby list API filters with publicPairs", () => {
    const route = fs.readFileSync("src/app/api/burnticker/pairs/[pairId]/route.ts", "utf8");
    assert.match(route, /hrefs: pairSideHrefs\(p\.registry, pair\)/); assert.match(route, /lifecycle: pairLifecycle\(p\.registry, pairId\)/);
    const page = fs.readFileSync("src/app/burnticker/p/[pairId]/page.tsx", "utf8");
    assert.doesNotMatch(page, /href=\{`\/burnticker\/t\/\$\{/, "no side is linked by its ticker");
    assert.match(page, /data-pair-lifecycle/);
    const derby = fs.readFileSync("src/lib/burnticker/api/derby.ts", "utf8");
    assert.match(derby, /publicPairs\(p\.registry\)\.filter\(\(pr\) => pr\.selectorKey\.startsWith\("derby:"\)\)/);
    assert.doesNotMatch(derby, /p\.registry\.pairs\(\)/);
  });
});
