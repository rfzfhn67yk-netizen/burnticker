// THE COIN PAGE AND THE PAIR PAGE (website-11, 2026-10-12; the owner's review items 6 and 8 as the website brief rewrites them): the
// chart and ONE outbound link "Trade on Raydium" on top, no buy or sell panel, then the tabs Burn log (each receipt with "Check
// receipt" to the in-browser verifier), Rule (text, hash, dial, window, end) and Holders only when holder data exists. No thread, no
// countdown, no disclaimer of the page's own beyond the rule's footer line. Pre-graduation coins say burns wait for graduation and
// pool registration.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { BURNS_AFTER_GRADUATION, burnsAfterGraduation, marketFacts, RULES_SCHEMA, WIND_DOWN_DAYS, COIN_TAB_LABEL, checkReceiptHref, coinTabs, initialTab, raydiumLink, ruleFacts } from "@/lib/burnticker/coinPage";
import { tradeLinks } from "@/lib/burnticker/market";
import { BURNTICKER_RULES_SCHEMA, DEFAULT_WIND_DOWN_DAYS, lockRule } from "@/lib/burnticker/rules";
import { PERPETUAL_SENTENCE } from "@/lib/burnticker/describe";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { BRONCOS, DEBT_RULE, ONE_SHOT } from "./burntickerHelpers.ts";

const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}:\n${formatHits(r)}`); };
const read = (f: string) => fs.readFileSync(f, "utf8");
const COIN = "src/app/burnticker/t/[ticker]/page.tsx", PAIR = "src/app/burnticker/p/[pairId]/page.tsx";
const MINT = "FwXiFscFSYXzvPVzV4rCw4UBcGDhT53xHDpsL3pVpzkp";
/** Code without comments (block comments, JSX comments, and // after whitespace). */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}])\/\/.*$/gm, "$1");

describe("coinPage.ts: the order and the small facts", () => {
  test("tabs: Burn log first, then Rule, then Holders only when holder data was read", () => {
    assert.deepEqual(coinTabs(true), ["burns", "rule", "holders"]);
    assert.deepEqual(coinTabs(false), ["burns", "rule"]);
    assert.deepEqual(coinTabs(true).map((t) => COIN_TAB_LABEL[t]), ["Burn log", "Rule", "Holders"]);
    assert.equal(initialTab("", coinTabs(true)), "burns");
    assert.equal(initialTab("#rule", coinTabs(false)), "rule");
    assert.equal(initialTab("#holders", coinTabs(false)), "burns", "a tab that is not shown is never opened");
    assert.equal(initialTab("#verify", coinTabs(true)), "burns", "the badge's #verify anchor lands on the burn log");
  });
  test("one trade link: Raydium for this mint, on the curve and after graduation; none for devnet or an unlaunched coin; never Jupiter", () => {
    const curve = raydiumLink(tradeLinks("mainnet", MINT, "curve", "live"));
    assert.deepEqual(curve, { label: "Trade on Raydium", url: `https://raydium.io/launchpad/token/?mint=${MINT}` });
    const grad = raydiumLink(tradeLinks("mainnet", MINT, "graduated", "live"));
    assert.equal(grad?.label, "Trade on Raydium"); assert.match(grad!.url, /^https:\/\/raydium\.io\/swap\/\?inputMint=sol&outputMint=/);
    assert.equal(raydiumLink(tradeLinks("devnet", MINT, "curve", "live")), null);
    assert.equal(raydiumLink(tradeLinks("mainnet", MINT, null, "draft")), null);
    assert.equal(raydiumLink({ links: [{ id: "jupiter", label: "Open in Jupiter", url: "https://jup.ag/swap/SOL-x" }] }), null);
    assert.equal(raydiumLink(null), null);
  });
  test("Check receipt opens the in-browser verifier with the signature and the coin's network; no signature, no link", () => {
    assert.equal(checkReceiptHref("5abc", "mainnet"), "/burnticker/check?sig=5abc&cluster=mainnet#verify");
    assert.equal(checkReceiptHref("5abc", "devnet"), "/burnticker/check?sig=5abc&cluster=devnet#verify");
    assert.equal(checkReceiptHref("5abc", "localnet"), "/burnticker/check?sig=5abc&cluster=devnet#verify");
    assert.equal(checkReceiptHref(null, "mainnet"), null);
  });
  test("the dial, the window and the end come from the exact rules.json text", () => {
    assert.equal(RULES_SCHEMA, BURNTICKER_RULES_SCHEMA); assert.equal(WIND_DOWN_DAYS, DEFAULT_WIND_DOWN_DAYS);
    assert.doesNotMatch(read("src/lib/burnticker/coinPage.ts"), /^import (?!type )[^\n]*"@\/lib\/burnticker\/rules"/m, "the client page cannot import rules.ts (node:fs)");
    const debt = ruleFacts(lockRule(DEBT_RULE).text);
    assert.equal(debt.dial, "Each unit spends 5% of the burn pool on this coin and burns what it gets.");
    assert.equal(debt.window, PERPETUAL_SENTENCE); assert.match(debt.end, /no end/);
    const team = ruleFacts(lockRule(BRONCOS).text);
    assert.equal(team.dial, "Each result that fires the rule spends 2% of the burn pool on this coin and burns what it gets.");
    const one = ruleFacts(lockRule(ONE_SHOT).text, true);
    assert.match(one.window, /resolves once/); assert.match(one.end, /burned down over 28 days, and then the coin retires/);
    // the operator's own rule files (burnkeeper.rules/v1): the buyback dial
    const reh = ruleFacts(read("config/burnkeeper/rehearsal.rules.json"));
    assert.equal(reh.dial, "Each unit spends 2% of the burn pool on this coin and burns what it gets.");
    assert.equal(ruleFacts("not json").dial, null);
  });
  test("every sentence it writes passes the copy lint", () => {
    clean(BURNS_AFTER_GRADUATION, "burns after graduation");
    for (const raw of [DEBT_RULE, BRONCOS, ONE_SHOT]) for (const os of [false, true]) { const f = ruleFacts(lockRule(raw).text, os); for (const t of [f.dial ?? "", f.window, f.end]) clean(t, "rule facts"); }
  });
});

describe("the coin page (t/[ticker])", () => {
  const src = code(COIN);
  test("on top: the chart, then one outbound link and no order panel", () => {
    const chart = src.indexOf('<section aria-label="Chart"'), trade = src.indexOf('aria-label="Trade"'), tabs = src.indexOf('role="tablist"');
    assert.ok(chart > 0 && chart < trade && trade < tabs, "chart, then the trade link, then the tabs");
    assert.equal((src.match(/data-trade-link/g) ?? []).length, 1, "exactly one trade link");
    assert.match(src, /const trade = raydiumLink\(m\?\.trade\)/);
    assert.doesNotMatch(src, /m\.trade\.links\.map/, "the API's other venues are not listed");
    assert.doesNotMatch(src, /\b(buy|sell)\b/i, "no buy or sell control or word on the page");
    assert.doesNotMatch(src, /<input|<form/, "nothing takes an order");
  });
  test("tabs in order, Burn log first; Holders rendered only with holder data; no thread", () => {
    const at = (s: string) => src.indexOf(s);
    assert.ok(at('id="panel-burns"') < at('id="panel-rule"') && at('id="panel-rule"') < at('id="panel-holders"'));
    assert.match(src, /\{hasHolders && m\?\.holders\.top && \(\s*<div id="panel-holders"/);
    assert.match(src, /const tabs = coinTabs\(hasHolders\)/);
    assert.doesNotMatch(src, /thread|comment|reply/i);
  });
  test("the burn log: each receipt links Check receipt; the #verify anchor the badge uses is inside it", () => {
    const burns = src.slice(src.indexOf('id="panel-burns"'), src.indexOf('id="panel-rule"'));
    assert.match(burns, /checkReceiptHref\(b\.signature, s\.cluster\)/); assert.match(burns, />Check receipt<\/a>/); assert.match(burns, /id="verify"/);
  });
  test("the rule tab: the locked text, its hash, the dial, the window and the end, and the rule's own footer line", () => {
    const rule = src.slice(src.indexOf('id="panel-rule"'), src.indexOf("{hasHolders &&"));
    for (const s of ["{s.rules.statement}", "{s.rules.sha256}", "The dial", "The window", "The end", "{s.disclosure.disclaimer}"]) assert.ok(rule.includes(s), s);
    assert.equal((src.match(/s\.disclosure\.disclaimer/g) ?? []).length, 1, "the rule's footer line once, no page disclaimer of its own");
  });
  test("pre-graduation: the curve, and the plain line that burns wait for graduation and pool registration; nothing counts down", () => {
    assert.match(src, /<CurveBar /); assert.match(src, /\{preBurn && <p [^>]*data-burns-after-graduation>\{afterGraduation\}<\/p>\}/);
    // website-13: the line names the raise read from the curve, else the configured one, never a typed 85
    assert.match(src, /const afterGraduation = burnsAfterGraduation\(m\?\.curve\?\.threshold \?\? raiseSol, m\?\.curve\?\.quote \?\? "SOL"\);/);
    assert.equal(burnsAfterGraduation("85"), "Burns begin only after the bonding curve fills at 85 SOL raised, the coin moves to its Raydium pool, and that pool is registered with the burn program.");
    assert.equal(burnsAfterGraduation(null), BURNS_AFTER_GRADUATION);
    assert.match(src, /<ReadinessPanel r=\{ready\} /); assert.match(src, /const preBurn = ready\.state === "on-curve" \|\| ready\.state === "awaiting-registration"/);
    assert.doesNotMatch(src, /\buntil\(|setInterval|Kalshi/);
  });
  test("a disclosed rehearsal coin that is not registered here says what it is, from the trust API, with no trade link", () => {
    const nr = src.slice(src.indexOf("function NotRegisteredNotice"));
    assert.match(nr, /fetch\("\/api\/burnticker\/trust"\)/); assert.match(nr, /transparency\?\.rehearsals\?\.find/);
    // Claude site audit 2 item 2a: who would fill the curve, and that nobody is asked to (no "not for trading" beside "until its curve fills")
    assert.match(nr, /The operator does not trade it and asks nobody to/); assert.match(nr, /It can only burn if outside buyers fill its curve, and nobody is asked to do that\./); assert.doesNotMatch(nr, /not for trading/);
    assert.doesNotMatch(nr, /raydium|data-trade-link/i);
  });
});

describe("the pair page (p/[pairId]) follows the same order with both sides", () => {
  const src = code(PAIR);
  test("both sides on top with their chart and one Raydium link each; then the scoreboard; then the tabs", () => {
    const at = (s: string) => src.indexOf(s);
    assert.ok(at('aria-label="Both coins"') < at('aria-label="Scoreboard"') && at('aria-label="Scoreboard"') < at('role="tablist"'));
    assert.equal((src.match(/data-trade-link/g) ?? []).length, 1, "one link per side, rendered from one place");
    assert.match(src, /trade = raydiumLink\(m\?\.trade\)/);
    assert.ok(at('id="panel-burns"') < at('id="panel-rule"') && at('id="panel-rule"') < at('id="panel-holders"'));
    assert.match(src, /\{hasHolders && \(\s*<div id="panel-holders"/);
    assert.doesNotMatch(src, /\b(buy|sell)\b/i);
  });
  test("both receipts tables in the burn log with Check receipt; both rules with dial, window and end in the rule tab", () => {
    const burns = src.slice(src.indexOf('id="panel-burns"'), src.indexOf('id="panel-rule"'));
    assert.match(burns, /\{receiptsTable\(d\.a\)\}\s*\{receiptsTable\(d\.b\)\}/);
    assert.match(src, /checkReceiptHref\(r\.signature, s\.status\.cluster \?\? "devnet"\)/);
    const rule = src.slice(src.indexOf('id="panel-rule"'), src.indexOf("{hasHolders &&"));
    for (const s of ["ruleFacts(s.rulesText", "The dial", "The window", "The end", "{s.status.rules.sha256}", "<PairFundsFlow "]) assert.ok(rule.includes(s), s);
    assert.match(read("src/app/api/burnticker/pairs/[pairId]/route.ts"), /rulesText: da\.rulesText/);
  });
});

describe("the coin page's market facts (website-13, ChatGPT audit 6 A10): read or said not read, never invented", () => {
  const base = { cluster: "mainnet", status: "live", mint: "M1nt", mintUrl: "https://solscan.io/token/M1nt", creator: "Cr8", creatorUrl: "https://solscan.io/account/Cr8", launchedAt: "2026-10-14T23:00:00Z", phase: "curve" as const, curve: { raised: "12.5", threshold: "85", quote: "SOL", marketCap: "30.123" }, curveNote: null, graduatedPool: null, holdersCount: null, holdersNote: "Counting holders needs an indexer.", feesCurveBps: 125, feesPoolBps: 30, readAt: "2026-10-15T01:02:03Z" };
  test("a coin on its curve: network, mint, quote, market cap and curve read; volume and liquidity said not read; fees before the trade link", () => {
    const f = Object.fromEntries(marketFacts(base).map((r) => [r.key, r]));
    assert.deepEqual(Object.keys(f), ["network", "mint", "quote", "mcap", "curve", "volume", "liquidity", "holders", "creator", "launched", "fees", "freshness"]);
    assert.equal(f.mcap.value, "30.12 SOL"); assert.equal(f.curve.value, "12.5 / 85 SOL raised"); assert.equal(f.mint.href, base.mintUrl);
    for (const k of ["volume", "liquidity", "holders"]) assert.equal(f[k].value, "Not read here", k);
    assert.equal(f.fees.value, "1.25% on the curve, 0.3% in the pool");
    for (const r of marketFacts(base)) for (const t of [r.label, r.value ?? "", r.note ?? ""]) if (r.key !== "mint" && r.key !== "creator") assert.ok(lintCopy(t, loadCopyLintConfig()).ok || r.key === "mcap" && t === "Market cap", `${r.key}: ${t}`);
    const src = fs.readFileSync("src/app/burnticker/t/[ticker]/page.tsx", "utf8");
    assert.ok(src.indexOf("data-fees-before-trade") < src.indexOf("data-trade-link"), "the fees and the slippage note sit before the Raydium link");
    assert.doesNotMatch(src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, ""), /priceUsd|\bprice\b/i);
  });
  test("a draft says not applicable; a graduated coin says the pool is not read for its market cap", () => {
    const d = Object.fromEntries(marketFacts({ ...base, status: "draft", launchedAt: null, curve: null }).map((r) => [r.key, r]));
    assert.equal(d.mcap.value, "Not applicable"); assert.equal(d.curve.value, "Not applicable"); assert.equal(d.launched.value, "Not applicable");
    const g = Object.fromEntries(marketFacts({ ...base, phase: "graduated", graduatedPool: "P00l" }).map((r) => [r.key, r]));
    assert.equal(g.mcap.value, "Not read here"); assert.match(g.mcap.note!, /Raydium pool/); assert.equal(g.curve.label, "Trading pool"); assert.equal(g.curve.value, "P00l");
  });
});
