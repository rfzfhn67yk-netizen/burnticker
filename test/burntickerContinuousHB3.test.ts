// CONTINUOUS AUDIT, HOURLY RUN 3 (2026-10-19 15:10 Denver; docs/burnticker/audits/continuous/bugs.md HB-30 to HB-35, HB-11 reopened).
// One pure-function or source check per item, and the copy lint on every new public sentence.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tickerChecks, type TickerRow } from "@/lib/burnticker/tickerCheck";
import { autoTickerSwaps, freeRowLead, tickerRefused } from "@/lib/burnticker/tickerSwap";
import type { LookalikeExisting } from "@/lib/burnticker/lookalike";
import { pairTickers } from "@/lib/burnticker/guidedLaunch";
import { teamsOf } from "@/lib/burnticker/sources/espn";
import { winPairNames } from "../src/app/burnticker/launch/pageCopy.ts";
import { fallbackProgramsHtml, renderRegions } from "../scripts/burnticker-site-nav.mts";
import { boundedMemo } from "@/lib/burnticker/boundedMemo";
import { rankDerbyHits } from "@/lib/burnticker/derby/search";
import { HAZARD_EVERY_SENTENCES, HAZARD_PATTERNS, hazardEverySentence, hazardKindOf, hazardPatternOptions } from "@/lib/burnticker/hazards";
import { edgeCase, reviewEdgeIds } from "@/lib/burnticker/ruleEdgeCases";
import { NOT_NAMED_YET, publicPlaceholders, withoutPlaceholders } from "@/lib/burnticker/trustpack/operator";
import { placeholderSentence } from "@/lib/burnticker/trustpack/copy";
import type { BurnRule } from "@/lib/burnticker/rules";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };

// the live tickers the audit named (DENWIN the Broncos coin, BALWIN, SEAWIN, PITWIN), as another creator's launched coins
const LIVE = ["DENWIN", "SEAWIN", "BALWIN", "PITWIN"];
const OTHER = "OtherCreator1111111111111111111111111111111";
const rows = (t: string): TickerRow[] => LIVE.filter((x) => x === t.toUpperCase()).map((x) => ({ mint: `${x}mint`, name: `${x} coin`, ticker: x, rulesJson: "{}", status: "live", creator: OTHER }));
const existing: LookalikeExisting[] = LIVE.map((t) => ({ ticker: t, name: `${t} coin`, status: "live", creator: OTHER }));
const deps = { inUse: rows, reserved: new Set<string>(), existing };

describe("HB-30: a rivalry's generated tickers are checked before they are shown", () => {
  test("Nuggets vs Lakers: $DENWIN held and $LALWIN one letter from $BALWIN; each side gets its own free ticker, the server's suggestion first", () => {
    const checks = tickerChecks([{ side: "A", ticker: "DENWIN", generated: "DENVLAL", team: true }, { side: "B", ticker: "LALWIN", generated: "LALVDEN", team: true }], deps);
    const [a, b] = checks;
    assert.equal(a.taken, true); assert.equal(b.taken, false); assert.equal(b.lookalike, true, "a one-letter lookalike is a refusal the check reports");
    assert.ok(tickerRefused(a) && tickerRefused(b));
    assert.equal(a.suggestions[0], "DENVLAL"); assert.equal(b.suggestions[0], "LALVDEN", "side B has its own alternatives, from its own rule");
    assert.ok(!b.suggestions.some((s) => s.startsWith("DEN")), "no row offers the other field's tickers");
    const swaps = autoTickerSwaps(checks, { a: "DENWIN", b: "LALWIN" }, true);
    assert.deepEqual(swaps, { a: "DENVLAL", b: "LALVDEN" });
    assert.deepEqual(autoTickerSwaps(checks, { a: "DENWIN", b: "LALWIN" }, false), {}, "a ticker the creator typed is never replaced");
    // the swapped tickers pass the same check
    const again = tickerChecks([{ side: "A", ticker: swaps.a!, generated: "DENVLAL", team: true }, { side: "B", ticker: swaps.b!, generated: "LALVDEN", team: true }], deps);
    assert.ok(again.every((c) => !tickerRefused(c)), JSON.stringify(again));
  });
  test("every NBA pair: after the swap, no side is left on a held or lookalike ticker", () => {
    const teams = teamsOf("nba");
    assert.equal(teams.length, 30);
    let swapped = 0;
    for (const x of teams) for (const y of teams) {
      if (x.abbr === y.abbr) continue;
      const gen = winPairNames(x, y), server = pairTickers(x.code ?? x.abbr, y.code ?? y.abbr);
      const checks = tickerChecks([{ side: "A", ticker: gen.a.ticker, generated: server.a, team: true }, { side: "B", ticker: gen.b.ticker, generated: server.b, team: true }], deps);
      const s = autoTickerSwaps(checks, { a: gen.a.ticker, b: gen.b.ticker }, true);
      if (s.a || s.b) swapped++;
      const fa = s.a ?? gen.a.ticker, fb = s.b ?? gen.b.ticker;
      const after = tickerChecks([{ side: "A", ticker: fa, generated: server.a, team: true }, { side: "B", ticker: fb, generated: server.b, team: true }], deps);
      for (const c of after) assert.ok(!tickerRefused(c), `${x.abbr} vs ${y.abbr}: $${c.ticker} is still refused`);
      assert.notEqual(fa, fb);
    }
    assert.ok(swapped > 0, "the fixture exercises the swap");
  });
  test("one free-ticker row per field, naming its coin; the page applies the swap and the review card shows lookalike rows", () => {
    assert.equal(freeRowLead("B", "lalwin", true), "Free tickers for Coin B in place of $LALWIN:");
    assert.equal(freeRowLead("A", "X", false), "Free tickers:");
    clean(freeRowLead("A", "DENWIN", true));
    const page = read("src/app/burnticker/launch/page.tsx"), card = read("src/app/burnticker/launch/ReviewCard.tsx");
    assert.match(page, /autoTickerSwaps\(/); assert.match(page, /fixGen\(pairGen\.a\.ticker\)/);
    assert.match(card, /freeRowLead\(t\.side, t\.ticker, many\)/); assert.match(card, /t\.lookalike && t\.suggestions\.length > 0/);
    assert.doesNotMatch(card, />Free: \{/);
  });
});

describe("HB-31: the fallback page names mainnet, says each sentence once, and a league page is bounded", () => {
  test("the generator writes mainnet program rows from the well-known file; the page has no devnet and no repeated sentence", () => {
    const html = read("site/burnticker/fallback/index.html");
    assert.ok(!/devnet/i.test(html), "no devnet label, link or default on the mainnet host's fallback");
    const main = html.slice(html.indexOf('<main'), html.indexOf("</main>"));
    assert.equal(main.split("Burns are run by the program on chain.").length - 1, 1, "said once on the page (the meta description carries its own copy)");
    assert.ok(!main.includes("The app is catching up."), "the duplicate opening is gone");
    const rowsHtml = fallbackProgramsHtml();
    assert.match(rowsHtml, /burn_receipts<\/span><b><a href="https:\/\/solscan\.io\/account\/AuQj[1-9A-HJ-NP-Za-km-z]+">[^<]+<\/a> \(mainnet\)/);
    assert.ok(html.includes(rowsHtml), "the page carries the generated rows");
    assert.equal(renderRegions().get("site/burnticker/fallback/index.html"), html, "the page is current with its generator");
    for (const s of ["The app is being updated and is back within a minute or two.", "Receipts that were already published stay on chain and on the static site."]) clean(s);
  });
  test("boundedMemo: a cold read waits at most coldWaitMs, then the answer is kept for the next visitor; a failure is null", async () => {
    let t = 0; const m = boundedMemo<number>({ freshMs: 1000, coldWaitMs: 20, now: () => t });
    let release: (v: number) => void = () => {};
    const slow = () => new Promise<number>((res) => { release = res; });
    const started = Date.now();
    assert.equal(await m.get("k", slow), null, "the page renders without it");
    assert.ok(Date.now() - started < 500);
    release(7); await new Promise((r) => setTimeout(r, 5));
    assert.equal(await m.get("k", slow), 7, "kept for the next visitor");
    t = 5000; let reads = 0;
    assert.equal(await m.get("k", async () => { reads++; return 8; }), 7, "stale is served at once while one refresh runs");
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(reads, 1); assert.equal(await m.get("k", async () => 9), 8);
    assert.equal(await m.get("bad", async () => { throw new Error("x"); }), null);
  });
  test("the league page reads the schedule through the memo with a 1.5 s cold wait (it waited up to 3 s on every render)", () => {
    const src = read("src/app/burnticker/leagues/[league]/[season]/page.tsx");
    assert.match(src, /boundedMemo<Set<string>>\(\{ freshMs: 10 \* 60_000, coldWaitMs: 1_500 \}\)/);
    assert.doesNotMatch(src, /setTimeout\(\(\) => res\(null\), 3_000\)/);
  });
});

describe("HB-35: the pair badge and the pair answer read less, and together", () => {
  test("the pair badge skips market, holder and date reads; the full coin read starts its independent reads together", () => {
    const badge = read("src/lib/burnticker/badgeServe.ts"), server = read("src/lib/burnticker/server.ts");
    assert.match(badge, /PAIR_BADGE_READ: TokenPageOpts = \{ lite: true, live: false \}/);
    assert.match(badge, /side\(p, a, origin, now, PAIR_BADGE_READ\)/);
    assert.match(server, /const programP = programRead\(\), lpP = lpLockBlock\(/);
    assert.match(server, /lp: await lpP,\n    pair: await pairP,/);
  });
});

describe("HB-11 (reopened): the reference-coin search drops names that only mention the word", () => {
  // the live answer for "WIF" on publish 93 (GET /api/burnticker/v1/derby/search?q=WIF&assets=all, 2026-10-19)
  const LIVE_WIF: [string, string][] = [["WIF", "Crypto.WIF/USD"], ["WIFWEFT", "WIFWEFT"], ["WIFU", "Wifupad"], ["WIFOUT", "wifout"], ["KWIF", "Kitten Wif Hat"], ["SWORDCAT", "cat wif sword"], ["BAGUETTE", "Cat wif baguette"], ["SWORDDOG", "dog wif sword"], ["SWORDINU", "inu wif sword"], ["KWH", "Kim Wif Hat"], ["TURTLE", "Turtle Wif Hat"], ["ACHI", "dog wif kippah"], ["BAGKET", "Ket wif Baguette"], ["BACAT", "cat wif baguette"], ["MOCHIMOCHI", "Seal wif bunny ears"]];
  const hit = (symbol: string, name: string) => ({ symbol, name, mint: `${symbol}mint`, feed: null, underlying: { symbol, pyth: null, mint: null, pool: "p", cross: "jup:x" } });
  test("WIF: exact first, then prefixes, then the one word match; the audit's unrelated coins are gone", () => {
    const out = rankDerbyHits(LIVE_WIF.map(([s, n]) => hit(s, n)), "WIF").map((h) => h.symbol);
    assert.deepEqual(out, ["WIF", "WIFWEFT", "WIFU", "WIFOUT", "KWIF"]);
    for (const gone of ["SWORDCAT", "BAGUETTE", "SWORDDOG", "SWORDINU", "KWH", "TURTLE", "ACHI"]) assert.ok(!out.includes(gone), gone);
  });
  test("BONK (live names): PONK, BERN, RAVI, GLONK, BONGA, SAVIOUR and BIF are dropped; an exact name counts", () => {
    const LIVE_BONK = [["BONK", "Crypto.BONK/USD"], ["KBONK", "Crypto.KBONK/USD"], ["BONKYO", "Bonkyo"], ["BONKSOL", "Bonk SOL"], ["BONKAI", "BonkAI"], ["LETSBONK", "Let's BONK"], ["BONKERS", "The Internet's Dumbest Dog"], ["BONKCAT", "bonkcat"], ["PONK", "Pepe Bonk"], ["BERN", "BonkEarn"], ["RAVI", "The Bonkey"], ["GLONK", "Pump & Bonk"], ["BONGA", "Bonga - Bonk's Sister"], ["SAVIOUR", "Bonk Level Saviour"], ["BIF", "bonkwifhat"], ["XYZ", "Bonk"]];
    const out = rankDerbyHits(LIVE_BONK.map(([s, n]) => hit(s, n)), "bonk").map((h) => h.symbol);
    assert.deepEqual(out, ["BONK", "XYZ", "BONKYO", "BONKSOL", "BONKAI", "BONKERS", "BONKCAT", "LETSBONK"]);
    for (const gone of ["PONK", "BERN", "RAVI", "GLONK", "BONGA", "SAVIOUR", "BIF", "KBONK"]) assert.ok(!out.includes(gone), gone);
  });
});

describe("HB-32: each hazard's Every card says its own event", () => {
  const rule = (series: string) => ({ oracle: "catalogue", series, market: null, kind: "scalar", scalar: { unit: "1", perUnit: { fractionOfPool: 0.02 } }, binary: null } as unknown as BurnRule);
  test("a hurricane coin's card names storms and strength, never earthquakes or magnitude", () => {
    assert.equal(hazardKindOf("nhc.hurricanes:al.1"), "hurricane"); assert.equal(hazardKindOf("usgs.quakes:6"), "quake"); assert.equal(hazardKindOf("bls.cpi"), null);
    const every = hazardPatternOptions(rule("nhc.hurricanes:al.1"), Date.UTC(2026, 8, 1)).options.find((o) => o.id === "every")!;
    assert.equal(every.sentence, HAZARD_EVERY_SENTENCES.hurricane);
    assert.doesNotMatch(every.sentence, /earthquake|magnitude/); assert.match(every.sentence, /or stronger/);
    assert.doesNotMatch(hazardEverySentence("nifc.acres"), /storm|earthquake/);
    assert.doesNotMatch(HAZARD_PATTERNS.every.sentence, /earthquake|storm/);
    for (const s of [...Object.values(HAZARD_EVERY_SENTENCES), HAZARD_PATTERNS.every.sentence]) clean(s);
    assert.match(read("src/lib/burnticker/sources/nhc.ts"), /or stronger in \$\{b\.label\}`;/, "the coin text says stronger, as the select does");
  });
});

describe("HB-33: a one-shot 100% review lists only the cases it can meet", () => {
  test("no 2% minimum-burn case on a whole-pool one-shot; the other-coin case only with a pair or a coin end", () => {
    assert.deepEqual(reviewEdgeIds({ oneShotFull: true, otherCoin: false }), [174]);
    assert.deepEqual(reviewEdgeIds({ oneShotFull: false, otherCoin: true }), [164, 168, 174]);
    assert.match(edgeCase(164)!, /2% limit/); assert.match(edgeCase(168)!, /another coin/);
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.match(page, /reviewEdgeIds\(\{ oneShotFull: oneShotFull\(rule\), otherCoin: pairOn \|\| endA\.kind === "coin" \|\| endB\.kind === "coin" \}\)/);
    assert.doesNotMatch(page, /\n\s*164, 168, 174,/);
  });
});

describe("HB-34: every clickable card, row, link and radio has a name", () => {
  test("rivalry pattern cards, hazard kinds, coin search rows, the pair link and the end-choice radios", () => {
    const page = read("src/app/burnticker/launch/page.tsx"), tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx");
    const end = read("src/app/burnticker/launch/EndChoicePicker.tsx"), coin = read("src/app/burnticker/t/[ticker]/page.tsx");
    assert.match(page, /aria-label=\{RIVALRY_SEASON_LABEL\} onClick=\{\(\) => chooseRivals\(rivalA, rivalB, "season"\)\}/);
    assert.match(page, /aria-label=\{`\$\{RIVALRY_SERIES_LABEL\}/);
    assert.match(page, /data-hazard=\{k\.id\} aria-label=\{`\$\{k\.label\}, from \$\{k\.publisher\}`\}/);
    assert.match(tile, /data-decision="what" aria-label=\{`\$\{h\.label \|\| `\$\{h\.symbol\}, \$\{h\.name\}`\}, from/);
    assert.match(end, /<input type="radio" name=\{name\} value=\{o\.kind\} aria-label=\{o\.line\}/);
    assert.match(coin, /aria-label=\{`Open the pair page for \$\$\{s\.ticker\} and \$\$\{s\.pair\.counterpart\.ticker\}`\}/);
  });
});

describe("HB-35 (operator): no TODO placeholder is served", () => {
  test("a placeholder value is null and the list says in words that it is not named yet", () => {
    const op = { operator: { name: "x", entity: "TODO_ENTITY", note: "with TODO_ENTITY inside" }, links: { githubOrg: "TODO_GITHUB_ORG", x: ["a"] }, n: 3 };
    const out = withoutPlaceholders(op);
    assert.equal(out.operator.entity, null); assert.equal(out.operator.note, null); assert.equal(out.links.githubOrg, null); assert.deepEqual(out.links.x, ["a"]); assert.equal(out.n, 3);
    const list = publicPlaceholders(op, placeholderSentence);
    assert.deepEqual(list[0], { path: "$.operator.entity", value: null, note: `${NOT_NAMED_YET} Whether to form a legal entity is not decided yet.` });
    assert.ok(!JSON.stringify({ out, list }).includes("TODO_"));
    for (const p of list) clean(p.note);
    assert.match(read("config/burnticker/operator.json"), /"entity": "TODO_ENTITY"/, "the config keeps its placeholder for the owner's list");
  });
});
