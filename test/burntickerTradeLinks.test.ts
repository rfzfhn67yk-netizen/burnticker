// FIND AND TRADE A LAUNCHED COIN, AND TEST COINS OFF THE BROWSE SURFACES (owner, 2026-10-14: "I don't see the $DEFICIT coin available
// to buy on the website" and "hide the test coins, should only be the Eagles coin and $DEFICIT on the website"). The one trade-link
// builder (src/lib/burnticker/tradeLinks.ts), every surface that renders it, $DEFICIT first in the coin list and in search, the test-coin
// rule (src/lib/burnticker/testCoins.ts) and its page, and a draft that no longer shadows a launched coin's ticker.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { LINK_LABELS, NOT_LAUNCHED_NOTE, allLinks, coinLinks, devnetNote, launchLabUrl } from "@/lib/burnticker/tradeLinks";
import { tradeLinks } from "@/lib/burnticker/market";
import { cardViewFromIndex, type CardView, type IndexCoin } from "@/lib/burnticker/cardView";
import { featuredCoins, homeData, deficitMint } from "@/lib/burnticker/home";
import { firstPartyCards, searchKey } from "@/lib/burnticker/coinsGrid";
import { isTestCoin, operatorTestCoins, testCoinKeys, testCoins, withoutTestCoins } from "@/lib/burnticker/testCoins";
import { TEST_COINS_COPY, TEST_COINS_HREF } from "@/lib/burnticker/testCoinsCopy";
import { buildLeaderboard, LEADERBOARD_NOTE } from "@/lib/burnticker/leaderboard";
import { sitemapEntries } from "@/lib/burnticker/sitemap";
import { loadTransparency } from "@/lib/burnticker/trust";
import { openRegistry, type TokenRow } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import { lookupCoin } from "@/lib/burnticker/coinLookup";
import { tradeLinksHtml } from "@/lib/burnticker/tokenPage";
import { DENVER_HIGH } from "./burntickerHelpers.ts";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}:\n${formatHits(r)}`); };
const EAGLES = "J45hvg6FYGzDMj3iYS3BJPU2pwqfoZhA7B8isnW4fin8";
const DEFICIT = "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj";
const REHEARSAL = "FwXiFscFSYXzvPVzV4rCw4UBcGDhT53xHDpsL3pVpzkp";
const NOW = Date.parse("2026-10-14T15:00:00Z");

describe("the trade-link builder (tradeLinks.ts)", () => {
  test("on the curve: Raydium's launchpad page for the mint (the form Raydium's /launchpad/token page reads), then Jupiter, DexScreener, Solscan", () => {
    const l = coinLinks({ cluster: "mainnet", mint: EAGLES, phase: "curve", status: "live" });
    assert.equal(l.primary?.url, `https://raydium.io/launchpad/token/?mint=${EAGLES}`);
    assert.equal(l.primary?.label, "Trade on Raydium");
    assert.deepEqual(allLinks(l).map((x) => [x.id, x.label, x.url]), [
      ["launchlab", "Trade on Raydium", `https://raydium.io/launchpad/token/?mint=${EAGLES}`],
      ["jupiter", "Swap on Jupiter", `https://jup.ag/swap/SOL-${EAGLES}`],
      ["dexscreener", "Chart on DexScreener", `https://dexscreener.com/solana/${EAGLES}`],
      ["solscan", "Mint on Solscan", `https://solscan.io/token/${EAGLES}`],
    ]);
    assert.equal(l.note, null);
    // a launched coin whose phase was not read still opens Raydium's launchpad page
    assert.equal(coinLinks({ cluster: "mainnet", mint: DEFICIT, phase: null, status: "live" }).primary?.url, launchLabUrl(DEFICIT));
  });
  test("after graduation: Raydium's swap for the mint (it routes to the CPMM pool) and Jupiter", () => {
    const l = coinLinks({ cluster: "mainnet", mint: DEFICIT, phase: "graduated", status: "live" });
    assert.deepEqual(l.trade.map((x) => [x.id, x.url]), [["raydium", `https://raydium.io/swap/?inputMint=sol&outputMint=${DEFICIT}`], ["jupiter", `https://jup.ag/swap/SOL-${DEFICIT}`]]);
    assert.equal(l.primary?.label, "Trade on Raydium");
  });
  test("devnet: the explorer with ?cluster=devnet and no trade link; a draft or expired coin: nothing, with the reason", () => {
    const d = coinLinks({ cluster: "devnet", mint: EAGLES, phase: "curve", status: "live" });
    assert.deepEqual(d.trade, []); assert.equal(d.primary, null);
    assert.deepEqual(d.info.map((x) => x.url), [`https://solscan.io/token/${EAGLES}?cluster=devnet`]);
    assert.equal(d.note, devnetNote("devnet"));
    for (const status of ["draft", "expired"]) { const x = coinLinks({ cluster: "mainnet", mint: EAGLES, phase: null, status }); assert.deepEqual(allLinks(x), []); assert.equal(x.note, NOT_LAUNCHED_NOTE); }
    assert.deepEqual(allLinks(coinLinks({ cluster: "mainnet", mint: "", status: "live" })), []);
  });
  test("market.ts's status.json block is built from the same builder", () => {
    assert.deepEqual(tradeLinks("mainnet", EAGLES, "curve", "live").links.map((x) => x.url), coinLinks({ cluster: "mainnet", mint: EAGLES, phase: "curve", status: "live" }).trade.map((x) => x.url));
    assert.match(read("src/lib/burnticker/market.ts"), /const l = coinLinks\(\{ cluster, mint, phase, status \}\);/);
  });
  test("every label and note passes the copy lint", () => {
    for (const [k, v] of Object.entries(LINK_LABELS)) clean(v, k);
    clean(NOT_LAUNCHED_NOTE, "not launched"); clean(devnetNote("devnet"), "devnet");
    clean(LEADERBOARD_NOTE, "leaderboard note");
    for (const [k, v] of Object.entries(TEST_COINS_COPY)) clean(v, `TEST_COINS_COPY.${k}`);
  });
});

describe("each surface renders the trade link", () => {
  test("the coin page header: a primary Trade on Raydium button beside the ticker, built from the coin's own mint and phase", () => {
    const p = read("src/app/burnticker/t/[ticker]/page.tsx");
    assert.match(p, /<div data-header-trade><TradeButtons links=\{coinLinks\(\{ cluster: s\.cluster, mint: s\.mint, phase: m\?\.phase \?\? null, status: s\.status \}\)\}/);
    assert.ok(p.indexOf("data-header-trade") < p.indexOf("data-coin-description"), "in the header, before the description");
    const d = read("src/app/burnticker/t/[ticker]/DeficitPrelaunch.tsx");
    assert.match(d, /data-header-trade><TradeButtons links=\{coinLinks\(\{ cluster: "mainnet", mint: d\.mint/);
    assert.match(read("src/app/api/burnticker/deficit-prelaunch/route.ts"), /mint: deficitMint\(\)/);
    assert.equal(deficitMint(ROOT), DEFICIT);
  });
  test("the shared component: the primary button opens a new tab, then the other links, then a copy-address button", () => {
    const c = read("src/app/burnticker/_components/TradeLinks.tsx");
    assert.match(c, /data-trade-link/); assert.match(c, /rel="noopener" target="_blank"/); assert.match(c, /LINK_LABELS\.copy/);
    // the launch success screen's block, for the sign card to mount
    assert.match(c, /export function LaunchedTrade\(\{ coins, cluster \}/);
    assert.match(c, /coinLinks\(\{ cluster: net, mint: c\.mint, phase: "curve" as TradePhase, status: "live" \}\)/);
  });
  test("every coin card: registered coins from the index, $DEFICIT's featured card, the app card and the static home's card", () => {
    const coin: IndexCoin = { ticker: "PHINFLWIN", name: "Eagles 2026 Wins", mint: EAGLES, oneLiner: "burns when the Eagles win", status: "live", imageUrl: null, burned: "0", burns: 0, nextCheckAt: null, nextCloseTime: null, lastBurnAt: null, launchedAt: "2026-10-13T00:00:00Z", pairId: null, phase: "curve", progressPct: 0, raised: "0", threshold: "85", quote: "SOL" };
    assert.equal(cardViewFromIndex(coin, null, "mainnet").trade?.primary?.url, launchLabUrl(EAGLES));
    assert.equal(cardViewFromIndex({ ...coin, status: "draft" }, null, "mainnet").trade?.primary ?? null, null);
    assert.equal(cardViewFromIndex(coin, null, "devnet").trade?.primary ?? null, null);
    const deficit = featuredCoins(ROOT, null, [], null, NOW).find((v) => v.id === "deficit")!;
    assert.equal(deficit.trade?.primary?.url, launchLabUrl(DEFICIT));
    assert.match(read("src/app/burnticker/_components/CoinCard.tsx"), /data-card-trade><TradeButtons links=\{v\.trade\} compact ticker=\{v\.ticker\} \/>/);
    const h = read("site/burnticker/index.html");
    assert.match(h, /if \(v\.trade && \(v\.trade\.trade\.length \|\| v\.trade\.info\.length\)\)/); assert.match(h, /data-card-trade/);
  });
  test("Your coins: each created coin's card", () => {
    assert.match(read("src/app/burnticker/me/page.tsx"), /<div data-me-trade><TradeButtons links=\{coinLinks\(\{ cluster: host, mint: c\.mint, phase: null, status: "live" \}\)\} mint=\{c\.mint\}/);
  });
  test("the keeper's static coin page and its index", () => {
    const html = tradeLinksHtml({ cluster: "mainnet", mint: EAGLES, status: "live", market: undefined });
    assert.match(html, new RegExp(`href="https://raydium\\.io/launchpad/token/\\?mint=${EAGLES}"[^>]*>Trade on Raydium</a>`));
    for (const label of ["Swap on Jupiter", "Chart on DexScreener", "Mint on Solscan"]) assert.ok(html.includes(`>${label}</a>`), label);
    assert.match(tradeLinksHtml({ cluster: "mainnet", mint: EAGLES, status: "draft", market: undefined }), /not launched/);
    const t = read("src/lib/burnticker/tokenPage.ts");
    assert.match(t, /<h1>\$\$\{t\} <span class="muted" style="font-weight:400">\$\{esc\(s\.name\)\}<\/span><\/h1>\n\$\{tradeLinksHtml\(s\)\}/);
    assert.match(t, /<th>Status<\/th><th>Trade<\/th>/); assert.match(t, /indexTradeCell\(t, ix\.cluster\)/);
    assert.match(read("scripts/burnticker-keeper.mts"), /publishPlatformIndex\(SITE, statuses\.filter\(\(s\) => !tests\.mints\.has\(s\.mint\)\)/);
  });
  test("the $DEFICIT site: the three Trade controls and the mint line use the builder's URL forms once status.json carries the mainnet mint", () => {
    const h = read("site/deficit/index.html");
    assert.ok(h.includes(`var primary = phase === "graduated" ? "https://raydium.io/swap/?inputMint=sol&outputMint=" + m : "https://raydium.io/launchpad/token/?mint=" + m;`));
    assert.ok(h.includes(`{ id: "jupiter", label: "Swap on Jupiter", url: "https://jup.ag/swap/SOL-" + m }`));
    assert.ok(h.includes(`{ id: "dexscreener", label: "Chart on DexScreener", url: "https://dexscreener.com/solana/" + m }`));
    assert.ok(h.includes(`{ id: "solscan", label: "Mint on Solscan", url: "https://solscan.io/token/" + m }`));
    assert.match(h, /if \(s\.addresses && s\.addresses\.mint && isMainnet\(s\.cluster\) && !isSample\) \{\s*var phase = s\.curve && s\.curve\.phase \|\| null;\s*enableTrade\(tradeLinksFor\(s\.addresses\.mint, phase\)\[0\]\.url\);\s*renderMintLinks/);
    assert.match(h, /Copy address/);
    // the keeper writes cluster "mainnet": that is mainnet, not a "this is not the mainnet token" banner
    assert.match(h, /var isMainnet = function \(c\) \{ return c === "mainnet" \|\| c === "mainnet-beta"; \};/);
    assert.match(h, /if \(isSample \|\| \(s\.cluster && !isMainnet\(s\.cluster\)\)\) \{/);
  });
});

describe("$DEFICIT on the coin list and in search", () => {
  const featured = () => homeData([], ROOT, NOW, null, null, null, null, null, null, "mainnet").featured;
  test("it leads the New tab once created, and the search finds it by ticker (with or without $), name and mint prefix", () => {
    const f = featured();
    assert.deepEqual(firstPartyCards(f, "new", "").map((v) => v.ticker), ["DEFICIT"]);
    for (const q of ["DEFICIT", "deficit", "$DEFICIT", "Deficit", "AJJ4X", "national debt"]) assert.deepEqual(firstPartyCards(f, "new", q).map((v) => v.id), ["deficit"], q);
    assert.deepEqual(firstPartyCards(f, "new", "eagles"), []);
    assert.deepEqual(firstPartyCards(f, "pairs", ""), []);
    assert.deepEqual(firstPartyCards(f, "following", ""), [], "only when followed");
    assert.equal(firstPartyCards(f, "following", "", () => true).length, 1);
    assert.equal(searchKey("  $Deficit "), "deficit");
    const c = read("src/app/burnticker/CoinsIndex.tsx");
    assert.match(c, /const allcards: CardView\[\] = \[\.\.\.lead, \.\.\.cards\];/);
    assert.match(c, /<CardGrid cards=\{allcards\}/); // coin card status: the grid prints the shared rank line once
  });
  test("its card links its own site and carries the trade link", () => {
    const d = featured().find((v) => v.id === "deficit")!;
    assert.equal(d.href, "https://deficit.burnticker.com/");
    assert.equal(d.mint?.address, DEFICIT);
    assert.ok(d.trade?.primary);
  });
});

describe("test coins off the browse surfaces (testCoins.ts)", () => {
  function registry() {
    const reg = openRegistry(":memory:");
    const row = (mint: string, ticker: string, status: TokenRow["status"]) => reg.register({ mint, ticker, name: ticker, creator: "8sJfoY6Xx6o2zZqmX2Vt6NRwzNPr14Ef6qqRd5YLvGbs", description: "", imageUrl: null, links: [], rulesText: lockRule(DENVER_HIGH).text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "mainnet", platformId: null, baselineAt: "2026-10-13T00:00:00Z", status });
    row(EAGLES, "PHINFLWIN", "live");
    row("DYKwU8X2tzobBfTaaYhPJGK1vJxgPjL5Vg8kmaMoxaEG", "PHINFLWIN", "draft");
    row("TestMint1111111111111111111111111111111111", "TESTY", "live");
    reg.setTokenTest("TestMint1111111111111111111111111111111111", true, "A test coin the operator made to check the launch flow.");
    return reg;
  }
  test("config: $REHEARSAL is the operator's test coin; $DEFICIT is not", () => {
    const keys = testCoinKeys(ROOT);
    assert.ok(keys.mints.has(REHEARSAL)); assert.ok(keys.tickers.has("REHEARSAL"));
    assert.ok(!keys.mints.has(DEFICIT));
    assert.ok(isTestCoin(keys, { ticker: "REHEARSAL" })); assert.ok(isTestCoin(keys, { mint: REHEARSAL }));
    assert.ok(!isTestCoin(keys, { mint: DEFICIT, ticker: "DEFICIT" }));
    assert.deepEqual(operatorTestCoins(ROOT).map((c) => c.ticker), ["REHEARSAL"]);
  });
  test("the mainnet home: exactly $DEFICIT among the featured cards, and no $REHEARSAL row in the activity line", () => {
    const d = homeData([], ROOT, NOW, null, null, null, null, null, null, "mainnet");
    assert.deepEqual(d.featured.map((v) => v.ticker), ["DEFICIT"]);
    assert.ok(!d.events.some((e) => e.ticker === "REHEARSAL"));
    assert.ok(!JSON.stringify(d).includes(REHEARSAL));
  });
  test("the list, search, leaderboard and sitemap with today's coins show exactly $DEFICIT and $PHINFLWIN", () => {
    const reg = registry();
    const keys = testCoinKeys(ROOT, reg);
    assert.ok(keys.mints.has("TestMint1111111111111111111111111111111111")); assert.ok(!keys.tickers.has("TESTY"), "a registry coin is hidden by mint only");
    // the coins list: the tokens route drops test rows, the page drops drafts and leads with $DEFICIT
    const rows = withoutTestCoins(reg.tokens(), keys).filter((t) => t.status !== "draft");
    const featured = homeData([], ROOT, NOW, null, null, null, null, null, null, "mainnet", keys).featured;
    const list = [...firstPartyCards(featured, "new", ""), ...rows.map((t) => cardViewFromIndex({ ticker: t.ticker, name: t.name, mint: t.mint, oneLiner: "", status: t.status, imageUrl: null, burned: "0", burns: 0, nextCheckAt: null, nextCloseTime: null, lastBurnAt: null, launchedAt: null, pairId: null, phase: null, progressPct: null }, null, "mainnet"))] as CardView[];
    assert.deepEqual(list.map((v) => v.ticker), ["DEFICIT", "PHINFLWIN"]);
    assert.ok(list.every((v) => v.trade?.primary), "each listed coin has its trade link");
    // the leaderboard counts the registry's launched, non-test coins
    assert.equal(buildLeaderboard(reg, NOW).coins, 1);
    // the sitemap: $PHINFLWIN's page and $DEFICIT's, never a test coin
    const coins = withoutTestCoins(reg.tokens().map((t) => ({ ticker: t.ticker, mint: t.mint, status: t.status, at: 1 })), keys);
    const locs = sitemapEntries({ origin: "https://burnticker.com", nowMs: NOW, coins, pairs: [], seasonCoins: [] }).map((e) => e.loc).filter((l) => l.includes("/burnticker/t/"));
    assert.deepEqual(locs.sort(), [`https://burnticker.com/burnticker/t/${EAGLES}`, "https://burnticker.com/burnticker/t/DEFICIT"].sort());
  });
  test("the routes apply the rule: home, tokens, feeds, sitemap, leaderboard", () => {
    assert.match(read("src/app/api/burnticker/home/route.ts"), /withoutTestCoins\(publicRegistryRows\(p\.registry\.tokens\(\), p\.cluster\), tests\)/);
    assert.match(read("src/app/api/burnticker/tokens/route.ts"), /withoutTestCoins\(publicRegistryRows\(p\.registry\.tokens\(\), p\.cluster\), testCoinKeys\(process\.cwd\(\), p\.registry\)\)/);
    assert.match(read("src/lib/burnticker/feedsData.ts"), /withoutTestCoins\(publicRegistryRows\(p\.registry\.tokens\(\), p\.cluster\), testCoinKeys\(root, p\.registry\)\)/);
    assert.match(read("src/app/burnticker/sitemap.xml/route.ts"), /coins: withoutTestCoins\(d\.tickers, tests\)/);
    assert.match(read("src/lib/burnticker/leaderboard.ts"), /!tests\.has\(t\.mint\)/);
  });
  test("the Trust page still lists $REHEARSAL and links the test-coins page, which lists it with its own page", () => {
    assert.ok(loadTransparency(ROOT).rehearsals.some((r) => r.symbol === "REHEARSAL"));
    const trust = read("src/app/burnticker/trust/page.tsx");
    assert.match(trust, /data-test-coins-link><Link className="underline" href=\{TEST_COINS_HREF\}>/);
    assert.match(trust, /id="rehearsals">Rehearsal coins/);
    assert.equal(TEST_COINS_HREF, "/burnticker/test-coins");
    const all = testCoins(ROOT, registry());
    assert.deepEqual(all.map((c) => [c.ticker, c.source]), [["REHEARSAL", "operator"], ["TESTY", "registry"]]);
    assert.equal(all[0].pageHref, "/burnticker/t/REHEARSAL"); assert.match(all[0].text, /listed so you can see it exists, not so you trade it/);
    const page = read("src/app/burnticker/test-coins/page.tsx");
    assert.match(page, /testCoins\(process\.cwd\(\), reg\)/); assert.match(page, /robots: \{ index: false \}/);
    assert.doesNotMatch(page, /TradeButtons|coinLinks/, "a test coin's page offers no trade link");
    // linked only from the Trust page
    const linkers = execGrep("src", "TEST_COINS_HREF").filter((f) => !/testCoins(Copy)?\.ts$|test-coins\/page\.tsx$/.test(f));
    assert.deepEqual(linkers, [path.join("src", "app", "burnticker", "trust", "page.tsx")]);
    assert.deepEqual(execGrep("src", `href="${TEST_COINS_HREF}"`), [], "no hand-written link elsewhere");
  });
  test("the registry mark: set, list, clear", () => {
    const reg = registry();
    assert.deepEqual(reg.testTokens().map((t) => t.mint), ["TestMint1111111111111111111111111111111111"]);
    reg.setTokenTest("TestMint1111111111111111111111111111111111", false, "");
    assert.deepEqual(reg.testTokens(), []);
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bt-test-coin-")), "r.db");
    const r2 = openRegistry(f); r2.setTokenTest("M", true, "x"); assert.equal(openRegistry(f).testTokens().length, 1, "the mark persists in the file");
  });
});

describe("a draft never shadows a launched coin's ticker (the live /t/PHINFLWIN answered the chooser)", () => {
  test("one launched coin and a draft on the ticker: the ticker opens the launched coin; the draft opens by its mint", () => {
    const reg = openRegistry(":memory:");
    const row = (mint: string, status: TokenRow["status"]) => reg.register({ mint, ticker: "PHINFLWIN", name: "Eagles 2026 Wins", creator: "C", description: "", imageUrl: null, links: [], rulesText: lockRule(DENVER_HIGH).text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "mainnet", platformId: null, baselineAt: "2026-10-13T00:00:00Z", status });
    row(EAGLES, "live"); row("DYKwU8X2tzobBfTaaYhPJGK1vJxgPjL5Vg8kmaMoxaEG", "draft");
    const l = lookupCoin(reg, "PHINFLWIN");
    assert.equal(l.kind === "one" && l.token.mint, EAGLES);
    const d = lookupCoin(reg, "DYKwU8X2tzobBfTaaYhPJGK1vJxgPjL5Vg8kmaMoxaEG");
    assert.equal(d.kind === "one" && d.token.status, "draft");
    row("Second1111111111111111111111111111111111111", "live");
    assert.equal(lookupCoin(reg, "PHINFLWIN").kind, "many", "two launched coins still answer the chooser");
  });
});

function execGrep(dir: string, needle: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx|mjs)$/.test(e.name) && fs.readFileSync(path.join(ROOT, p), "utf8").includes(needle)) out.push(p); } };
  walk(dir);
  return out;
}
