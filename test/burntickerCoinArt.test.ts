// THE COIN IMAGE (coinArt.ts): deterministic receipt art from the rule alone — same rule → byte-identical SVG, another rule → another
// scorch, every fixture rule renders, team colours and the abbreviation only (no logo, no external reference), no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { paletteFor, renderCoinSvg, scorchFor, coinArtUrl } from "@/lib/burnticker/coinArt";
import { coinImage } from "@/lib/burnticker/coinArtServe";
import { describeRule } from "@/lib/burnticker/describe";
import { lockRule, type BurnRule } from "@/lib/burnticker/rules";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { teamSeries } from "@/lib/burnticker/sources/espn";
import { nwsSeries } from "@/lib/burnticker/sources/nws";
import { polyRule } from "@/lib/burnticker/search";
import { DEBT_RULE } from "./burntickerHelpers.ts";

const RAYS = nativeRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 }), { fractionOfPool: 0.02 });
const RULES = [
  RAYS,
  nativeRule(teamSeries("nba", "LAL", "win", { kind: "season", year: 2027 }), { fractionOfPool: 0.02 }),
  nativeRule(teamSeries("eng.1", "ARS", "draw", { kind: "perpetual" }), { fractionOfPool: 0.02 }),
  nativeRule(teamSeries("usa.1", "MIA", "win", { kind: "season", year: 2026 }), { fractionOfPool: 0.02 }),
  nativeRule(nwsSeries("high", "DTW", 90), { fractionOfPool: 0.01 }),
  polyRule("0x4d9567b9fa71a94b6e43ddb62ea6104cbb01926813938d241cce336bd72a8ba5"),
  DEBT_RULE,
];
const art = (rule: unknown) => { const l = lockRule(rule); const t = describeRule(l.rule, { ticker: "" }); return { svg: renderCoinSvg({ ticker: t.ticker, oneLiner: t.oneLiner, rule: l.rule, sha256: l.sha256 }), sha: l.sha256, ticker: t.ticker }; };

describe("coin art", () => {
  test("same rule → byte-identical SVG; a different rule → a different scorch seed", () => {
    const a = art(RAYS), b = art(JSON.parse(JSON.stringify(RAYS)));
    assert.equal(a.svg, b.svg);
    const c = art({ ...RAYS, scalar: { ...RAYS.scalar!, perUnit: { fractionOfPool: 0.03 } } });
    assert.notEqual(a.sha, c.sha);
    assert.notDeepEqual(scorchFor(a.sha), scorchFor(c.sha));
    assert.notEqual(a.svg, c.svg);
  });

  test("every fixture rule renders: the ticker big, no image or link references, the team's colours for a team coin", () => {
    for (const r of RULES) {
      const { svg, ticker } = art(r);
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      assert.ok(svg.includes(`$${ticker}`), ticker);
      assert.doesNotMatch(svg, /<image|href=|url\((?!#)|https?:\/\/(?!www\.w3\.org\/2000\/svg)/, "nothing external: no images, no links");
    }
    assert.equal(paletteFor(RAYS).label, "TB");
    assert.equal(paletteFor(RULES[2] as BurnRule).label, "ARS", "a soccer club: colours and the abbreviation from ESPN's frozen list");
  });

  test("no external fetch: rendering and the PNG path run with fetch disabled", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("no network in coin art"); }) as typeof fetch;
    try {
      const reg = { token: () => null, tokenByTicker: () => null, tokensByTicker: () => [], lockedRule: () => { throw new Error("unused"); } } as never;
      const r = Buffer.from(JSON.stringify(RAYS)).toString("base64url");
      const svg = await coinImage({ registry: reg, file: "preview.svg", query: new URLSearchParams({ r, t: "RAYS26" }) });
      assert.equal(svg.status, 200); assert.equal(svg.type, "image/svg+xml");
      const png = await coinImage({ registry: reg, file: "preview.png", query: new URLSearchParams({ r, t: "RAYS26" }) });
      assert.equal(png.status, 200); assert.equal(png.type, "image/png");
      assert.deepEqual([...(png.body as Uint8Array).slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], "a PNG");
      assert.equal((await coinImage({ registry: reg, file: "NOPE.svg", query: new URLSearchParams() })).status, 404);
      assert.equal((await coinImage({ registry: reg, file: "preview.svg", query: new URLSearchParams({ r: "bm90IGpzb24" }) })).status, 400);
    } finally { globalThis.fetch = real; }
  });

  test("the metadata image URL", () => {
    assert.equal(coinArtUrl("rays26", "https://burnticker.com/"), "https://burnticker.com/burnticker/img/RAYS26.png");
  });
});
