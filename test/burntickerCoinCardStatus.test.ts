// THE COIN CARD AFTER THE OWNER'S UX WALKTHROUGH (2026-10-18, phone, tablet and desktop widths). The card's numbers say only what was
// read: an untraded curve has no market cap figure, a figure from the curve says so in words, every new sentence passes the copy lint.
import "./burntickerRenderTsx.ts";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CARD_MEANINGS, HOLDERS_NOT_READ, MCAP_POOL_MEANING, NOT_READ, NO_HOLDERS, NO_HOLDERS_WHY, NO_TRADES, NO_TRADES_WHY, cardViewFromIndex, emptyLabels, holdersCell, mcapCell, mcapText, noTradesYet, onlyPoolHolders, rankLayout, type CardView, type IndexCoin } from "@/lib/burnticker/cardView";
import { featuredCoins } from "@/lib/burnticker/home";
import { STATUS_SENTENCES, coinStatusFactsOf } from "@/lib/burnticker/coinStatus";
import { CARD_ROWS, headlineStat } from "@/lib/burnticker/cardView";

const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${t}\n${formatHits(r)}`); };
export const COIN: IndexCoin = { ticker: "RAYS", name: "Rays", mint: "M1", oneLiner: "burns when the Rays lose", status: "live", imageUrl: null, burned: "0", burns: 0, nextCheckAt: null, nextCloseTime: null, lastBurnAt: null, launchedAt: "2026-10-11T00:00:00Z", pairId: null, phase: "curve", progressPct: 0, raised: "0", threshold: "85", quote: "SOL", marketCap: "28" };

describe("market cap: never a curve figure on an empty curve", () => {
  test("0 raised: \"No trades yet\" and no SOL figure, even though the curve gives a number", () => {
    const v = cardViewFromIndex(COIN, null);
    assert.deepEqual(v.mcap, { text: NO_TRADES, why: NO_TRADES_WHY });
    assert.doesNotMatch(v.mcap.text!, /SOL|\d/);
    assert.equal(mcapText("28", "SOL", "curve", "0"), NO_TRADES);
    assert.equal(mcapText("28", "SOL", "curve", "0.000000000"), NO_TRADES);
    // nothing read about the cap, but the curve read 0 raised: still no trades, never "No data yet"
    assert.deepEqual(mcapCell({ cap: null, phase: "curve", raised: "0" }), { text: NO_TRADES, why: NO_TRADES_WHY });
  });
  test("once there is a trade, the figure carries its basis in words, never \"(curve-implied)\"", () => {
    // third audit 2026-10-19 B-6: an untraded curve reads 1 lamport raised, so a trade is a raise of NO_TRADE_DUST_SOL or more
    const v = cardViewFromIndex({ ...COIN, raised: "0.05", progressPct: 0.06 }, null);
    assert.deepEqual(v.mcap, { text: "28 SOL from the curve", why: CARD_MEANINGS.mcap });
    assert.doesNotMatch(v.mcap.text!, /implied|\(/);
  });
  test("a graduated coin's pool figure is bare; an unread raise is not a zero; an unread cap keeps its reason", () => {
    assert.deepEqual(cardViewFromIndex({ ...COIN, phase: "graduated", raised: "85", marketCap: "1234.5" }, null).mcap, { text: "1,234.5 SOL", why: MCAP_POOL_MEANING });
    assert.equal(noTradesYet("curve", null), false); assert.equal(noTradesYet("curve", ""), false); assert.equal(noTradesYet("graduated", "0"), false); assert.equal(noTradesYet("migrating", "0"), false);
    assert.deepEqual(cardViewFromIndex({ ...COIN, raised: null, progressPct: null, marketCap: null }, null).mcap, { text: null, why: NOT_READ.mcapNotRead });
  });
  test("the featured $REHEARSAL card follows the same rule from its pool read", () => {
    const rh = (raised: string) => featuredCoins(process.cwd(), null, [], null, Date.parse("2026-10-18T00:00:00Z"), { phase: "curve", raised, threshold: "85", quote: "SOL", progressPct: 0, marketCap: "30.5" }).find((v) => v.id === "rehearsal");
    if (!rh("0")) return; // a host without the rehearsal record has no such card
    assert.equal(rh("0")!.mcap.text, NO_TRADES);
    assert.equal(rh("1.25")!.mcap.text, "30.5 SOL from the curve");
  });
  test("words", () => { for (const t of [NO_TRADES, NO_TRADES_WHY, "28 SOL from the curve"]) clean(t); });
});

/** The card as the browser gets it (CoinCard.tsx ViewCard, rendered on the server). */
export async function cardHtml(v: CardView): Promise<string> {
  const { ViewCard } = await import("@/app/burnticker/_components/CoinCard");
  return renderToStaticMarkup(createElement(ViewCard, { v, now: Date.parse("2026-10-18T00:00:00Z") }));
}
/** One row's markup, by its data-row key. */
export const rowHtml = (html: string, key: string): string => { const i = html.indexOf(`data-row="${key}"`); assert.ok(i >= 0, key); return html.slice(i, html.indexOf("</dd>", i)); };

describe("holders: the curve alone is not a holder; no count is \"Not read yet\", never a bare \"?\"", () => {
  const curve = [{ label: "bonding curve" }], pool = [{ label: "trading pool" }], person = [{ label: null }];
  test("the rule", () => {
    assert.equal(onlyPoolHolders(1, curve), true); assert.equal(onlyPoolHolders(1, pool), true); assert.equal(onlyPoolHolders(0, null), true);
    assert.equal(onlyPoolHolders(2, [...curve, ...pool]), true);
    assert.equal(onlyPoolHolders(1, person), false); assert.equal(onlyPoolHolders(2, curve), false); assert.equal(onlyPoolHolders(1, null), false, "no top list read: the count stands");
    assert.equal(onlyPoolHolders(null, curve), false);
    assert.deepEqual(holdersCell(1, true, null), { text: NO_HOLDERS, why: NO_HOLDERS_WHY });
    assert.deepEqual(holdersCell(1234, false, null), { text: "1,234", why: null });
    assert.deepEqual(holdersCell(null, false, null), { text: null, why: NOT_READ.holders });
  });
  test("on the card: one curve holder says \"No holders yet\"; no count says \"Not read yet\" with no \"?\" in the row", async () => {
    const one = cardViewFromIndex({ ...COIN, holders: 1, holdersOnlyPools: true }, null);
    assert.equal(one.holders.text, NO_HOLDERS);
    assert.match(rowHtml(await cardHtml(one), "holders"), /No holders yet/);
    const unread = cardViewFromIndex({ ...COIN, holders: null }, null);
    assert.equal(emptyLabels(unread).holders, HOLDERS_NOT_READ);
    const row = rowHtml(await cardHtml(unread), "holders");
    assert.match(row, /Not read yet/); assert.doesNotMatch(row.replace(/<[^>]+>/g, " "), /\?/, "no question mark as text");
    assert.doesNotMatch(row, /No data yet/);
    // a real count is printed as is
    assert.match(rowHtml(await cardHtml(cardViewFromIndex({ ...COIN, holders: 42 }, null)), "holders"), />42</);
  });
  test("words", () => { for (const t of [NO_HOLDERS, NO_HOLDERS_WHY, HOLDERS_NOT_READ]) clean(t); });
});

describe("the rank line: once above the grid when every card shares it, per card only when it differs", () => {
  const SITE = "No receipts yet, so it has no rank on this site.", NFL = "No receipts yet, so it has no rank in NFL 2026.", RANKED = "3 receipts, the most on this site.";
  test("the rule", () => {
    assert.deepEqual(rankLayout([SITE, SITE, SITE]), { shared: "No coin here has a receipt yet, so none has a rank on this site.", perCard: [null, null, null] });
    // review L5: a card whose rank was not read does not count as sharing the no-rank line
    assert.deepEqual(rankLayout([NFL, NFL, null]), { shared: "A coin with no receipt yet has no rank in NFL 2026.", perCard: [null, null, null] });
    assert.deepEqual(rankLayout([NFL, NFL]), { shared: "No coin here has a receipt yet, so none has a rank in NFL 2026.", perCard: [null, null] });
    assert.deepEqual(rankLayout([SITE, RANKED, SITE]), { shared: "A coin with no receipt yet has no rank on this site.", perCard: [null, RANKED, null] });
    assert.deepEqual(rankLayout([SITE, NFL, SITE]), { shared: "A coin with no receipt yet has no rank on this site.", perCard: [null, NFL, null] });
    // one card, or no line shared by two cards: nothing repeats, so every card keeps its own line
    assert.deepEqual(rankLayout([SITE]), { shared: null, perCard: [SITE] });
    assert.deepEqual(rankLayout([SITE, NFL, RANKED]), { shared: null, perCard: [SITE, NFL, RANKED] });
    assert.deepEqual(rankLayout([RANKED, RANKED]), { shared: null, perCard: [RANKED, RANKED] }, "a ranked line is the card's own");
  });
  test("the grid prints the shared line once, and no card repeats it", async () => {
    const { CardGrid } = await import("@/app/burnticker/_components/CoinCard");
    const cards = ["A", "B", "C"].map((k) => ({ ...cardViewFromIndex({ ...COIN, ticker: k, mint: `M${k}` }, null), rank: SITE }));
    const html = renderToStaticMarkup(createElement(CardGrid, { cards, now: 0 }));
    assert.equal(html.split("rank on this site").length - 1, 1, "said once");
    assert.match(html, /data-rank-shared[^>]*>No coin here has a receipt yet, so none has a rank on this site\.</);
    assert.doesNotMatch(html, /data-rank=/);
    const mixed = renderToStaticMarkup(createElement(CardGrid, { cards: [cards[0], { ...cards[1], rank: RANKED }, cards[2]], now: 0 }));
    assert.equal([...mixed.matchAll(/data-rank=/g)].length, 1); assert.match(mixed, /3 receipts, the most on this site\./);
  });
  test("the creator page lists the shared line once and keeps each coin's own line", () => {
    const src = (f: string) => fs.readFileSync(f, "utf8");
    const page = src("src/app/burnticker/creator/[wallet]/page.tsx");
    assert.match(page, /const ranks = rankLayout\(/); assert.match(page, /data-rank-shared/); assert.match(page, /ranks\.perCard\[i\]/);
    assert.doesNotMatch(page, /\{c\.rank\?\.line \?\? CREATOR_PAGE\.unavailable\}/, "no longer printed under every coin");
    const index = src("src/app/burnticker/CoinsIndex.tsx");
    assert.match(index, /<CardGrid cards=\{allcards\}/); assert.match(index, /<CardGrid cards=\{featured\}/);
  });
  test("words", () => { for (const t of ["No coin here has a receipt yet, so none has a rank on this site.", "No coin here has a receipt yet, so none has a rank in NFL 2026.", "A coin with no receipt yet has no rank on this site."]) clean(t); });
});

describe("the card leads with what happens next; the six-stat rows sit behind \"Details\"", () => {
  const facts = coinStatusFactsOf({ status: "live", ticker: "RAYS", name: "Rays", rules: { oneShot: false }, profile: { badge: "2026 SEASON", oneLiner: "burns when the Rays lose" }, market: { phase: "curve" }, program: null, pair: null, lifecycle: null }, []);
  test("the index card carries the status sentence built from the route's facts; without facts the card shows the rule", () => {
    assert.equal(cardViewFromIndex({ ...COIN, statusFacts: facts }, null).status, "Burns after each loss this season, once the curve fills.");
    assert.equal(cardViewFromIndex(COIN, null).status, null);
    const route = fs.readFileSync("src/app/api/burnticker/tokens/route.ts", "utf8");
    assert.match(route, /facts\.set\(d\.status\.mint, coinStatusFactsOf\(d\.status, d\.receipts, other\)\)/);
    assert.match(fs.readFileSync("src/lib/burnticker/homeRow.ts", "utf8"), /statusFacts: coinStatusFactsOf\(status, receipts\)/);
  });
  test("the one number in view: burned once it burned, else the curve, else the market cap, else holders", () => {
    assert.deepEqual(headlineStat(cardViewFromIndex({ ...COIN, burns: 2, burned: "1234.5" }, null)), { key: "burned", label: "Burned", text: "1,234.5 $RAYS" });
    assert.deepEqual(headlineStat(cardViewFromIndex({ ...COIN, raised: "35.7", progressPct: 42 }, null)), { key: "curve", label: "Curve", text: "35.7 / 85 SOL raised" });
    assert.deepEqual(headlineStat(cardViewFromIndex({ ...COIN, phase: "graduated", raised: "85", marketCap: "1234.5" }, null)), { key: "mcap", label: "Market cap", text: "1,234.5 SOL" });
    assert.equal(headlineStat(cardViewFromIndex({ ...COIN, phase: null, raised: null, progressPct: null, marketCap: null, holders: null }, null)), null);
  });
  test("rendered: status, then the number, then a native details expander holding every row in order", async () => {
    const html = await cardHtml(cardViewFromIndex({ ...COIN, statusFacts: facts, raised: "35.7", progressPct: 42 }, null));
    const status = html.indexOf("data-status"), stat = html.indexOf("data-card-stat="), det = html.indexOf("<details"), sum = html.indexOf("<summary>Details</summary>"), end = html.indexOf("</details>");
    assert.ok(status > 0 && stat > status && det > stat && sum > det && end > sum, "status, number, then details");
    assert.match(html, /data-status="">Burns after each loss this season, once the curve fills\.</);
    assert.match(html.slice(stat, det), /Curve<\/span> <span class="bt-card-stat-value">35\.7 \/ 85 SOL raised</);
    const inside = html.slice(det, end);
    const rows = [...inside.matchAll(/data-row="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(rows, CARD_ROWS.filter((r) => !["image", "name", "ticker", "badge", "receipt"].includes(r)), "every row, in the card order, behind Details");
    assert.equal(html.slice(0, det).match(/data-row="(progress|nextSettle|curve|mcap|holders|age|burned)"/), null, "no stat row outside the expander");
    // the ticker, the name and the receipt link stay in view
    assert.ok(html.indexOf('data-row="name"') < det && html.indexOf('data-row="ticker"') < det && html.indexOf('data-row="receipt"') > end);
    // no facts: the rule stands in for the status sentence
    assert.match(await cardHtml(cardViewFromIndex(COIN, null)), /data-status="">Burns when the Rays lose</);
  });
  test("readable at 375 px: nothing fixed wider than a phone, long words wrap, the rows' value column can shrink", async () => {
    const long = cardViewFromIndex({ ...COIN, name: "A".repeat(80), ticker: "WWWWWWWWWW", statusFacts: facts, burns: 1, burned: "123456789012345.5", holders: 123456 }, null);
    const html = await cardHtml({ ...long, mint: { address: "So11111111111111111111111111111111111111112", label: "Mint address" } });
    for (const m of html.matchAll(/(?:width|min-width):\s*(\d+)px/g)) assert.ok(Number(m[1]) <= 343, `fixed width ${m[1]}px fits a 375 px phone with 16 px gutters`);
    assert.doesNotMatch(html, /whitespace-nowrap|white-space:\s*nowrap/);
    assert.match(html, /<article class="bt-coin-card"/); assert.match(html, /class="min-w-0 flex-1"/); assert.match(html, /<code class="break-all">/);
    const css = fs.readFileSync("config/public-repo/overlay/src/app/globals.css", "utf8");
    assert.match(css, /\.bt-coin-card \{ min-width: 0; overflow-wrap: anywhere; \}/);
    assert.match(css, /\.bt-card-rows > div \{ display: grid; grid-template-columns: 6\.2rem minmax\(0, 1fr\);/);
    for (const c of ["bt-card-status", "bt-card-stat", "bt-card-stat-label", "bt-card-stat-value", "bt-card-details"]) { assert.match(html, new RegExp(`class="${c}"`)); assert.match(css, new RegExp(`\\.${c} \\{`), c); }
    // design tokens, not new colours
    const added = css.slice(css.indexOf("/* coin card status (2026-10-18)"), css.indexOf("@media (max-width: 400px) { .bt-card-rows"));
    assert.doesNotMatch(added, /#[0-9a-f]{3,6}\b/i, "colours come from the --bt- tokens");
  });
  test("the featured cards say what happens next too, in lint-clean words", () => {
    const f = featuredCoins();
    assert.ok(f.length > 0);
    for (const v of f) { assert.ok(v.status, v.id); clean(v.status!); }
    for (const t of [STATUS_SENTENCES.notCreated, STATUS_SENTENCES.practice, STATUS_SENTENCES.devnetDone, "Details"]) clean(t);
  });
});

describe("no \"?\" as text inside Details: an unread value says \"Not read yet\"", () => {
  const text = (html: string) => html.replace(/<[^>]+>/g, " ");
  const details = (html: string) => html.slice(html.indexOf("<details"), html.indexOf("</details>"));
  test("every row unread: each says what it is in words, with no question mark anywhere in the expander's text", async () => {
    const v = cardViewFromIndex({ ...COIN, phase: null, progressPct: null, raised: null, threshold: null, marketCap: null, holders: null, launchedAt: null, readiness: null }, null);
    const html = await cardHtml(v), d = details(html);
    assert.doesNotMatch(text(d), /\?/, "no ? in the text flow");
    assert.doesNotMatch(d, /bt-why-mark/);
    assert.doesNotMatch(d, /No data yet/);
    for (const key of ["progress", "curve", "mcap", "holders"]) assert.match(rowHtml(html, key), /Not read yet/, key);
    // each reason stays behind its label's own button, described for screen readers
    assert.ok([...d.matchAll(/class="bt-why-btn" aria-describedby=/g)].length >= 5);
  });
  test("a raise not read says so in words after the curve line; not applicable and none scheduled keep their words", async () => {
    const v = cardViewFromIndex({ ...COIN, raised: "1.5", progressPct: 2, threshold: null }, null);
    const row = rowHtml(await cardHtml({ ...v, curve: { ...v.curve, why: "This site could not read the raise that completes the curve." } }), "curve");
    assert.match(row, /1\.5 raised/); assert.match(row, /Raise not read/); assert.doesNotMatch(text(row), /\?/);
    const ns = rowHtml(await cardHtml(cardViewFromIndex(COIN, null)), "nextSettle");
    assert.match(ns, /None scheduled/); assert.doesNotMatch(text(ns), /\?/);
  });
  test("the API's empty labels for the static page say the same words", () => {
    const v = cardViewFromIndex({ ...COIN, phase: null, progressPct: null, raised: null, marketCap: null, holders: null, launchedAt: null }, null);
    const e = emptyLabels(v);
    assert.equal(e.curve, "Not read yet"); assert.equal(e.mcap, "Not read yet"); assert.equal(e.holders, "Not read yet"); assert.equal(e.progress, "Not read yet");
    for (const t of ["Not read yet", "Raise not read"]) clean(t);
  });
});

// ---- the static fallback home (site/burnticker/index.html) renders the same card from the home API's JSON ----
/** A tiny DOM, enough for the static page's card renderer: elements, text, attributes, and an HTML dump. */
class FakeNode {
  tagName: string; children: (FakeNode | string)[] = []; attrs: Record<string, string> = {}; className = ""; title = ""; style: Record<string, string> = {};
  type = ""; href = ""; src = ""; alt = ""; width = 0; height = 0; loading = ""; rel = ""; target = ""; id = ""; hidden = false; onerror: unknown = null;
  constructor(tag: string) { this.tagName = tag; }
  get textContent(): string { return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join(""); }
  set textContent(t: string) { this.children = t ? [t] : []; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  appendChild(c: FakeNode | string) { this.children.push(c); return c; }
  addEventListener() { /* no events in a dump */ }
  replaceWith() { /* image errors never fire here */ }
  classList = { toggle: () => undefined, contains: () => false };
  html(): string {
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const a = Object.entries({ ...(this.className ? { class: this.className } : {}), ...this.attrs }).map(([k, v]) => ` ${k}="${v}"`).join("");
    return `<${this.tagName}${a}>${this.children.map((c) => (typeof c === "string" ? esc(c) : c.html())).join("")}</${this.tagName}>`;
  }
}
async function staticCards(featured: unknown[]): Promise<string> {
  const page = fs.readFileSync("site/burnticker/index.html", "utf8");
  const whyAt = page.indexOf("window.btWhy = function"), why = page.slice(whyAt, page.indexOf("\n};\n", whyAt) + 3);
  const gridAt = page.lastIndexOf("(function () {", page.indexOf("THE COIN GRID")), grid = page.slice(gridAt, page.indexOf("})();", page.indexOf("THE COIN GRID")) + 5);
  const box = new FakeNode("div");
  const document = { querySelector: (q: string) => (q === "[data-featured]" ? box : null), createElement: (t: string) => new FakeNode(t), createTextNode: (t: string) => t };
  const win: Record<string, unknown> = { btHome: Promise.resolve({ featured }), btWatch: { has: () => false, toggle: () => undefined }, btCardAge: () => "3 days" };
  new Function("window", "document", why + "\n" + grid)(win, document);
  await new Promise((r) => setTimeout(r, 0));
  return box.html();
}

describe("the static fallback home prints the same card", () => {
  const facts = coinStatusFactsOf({ status: "live", ticker: "RAYS", name: "Rays", rules: { oneShot: false }, profile: { badge: "2026 SEASON", oneLiner: "burns when the Rays lose" }, market: { phase: "curve" }, program: null, pair: null, lifecycle: null }, []);
  const asApi = (v: CardView) => ({ ...v, empty: emptyLabels(v), stat: headlineStat(v) });
  test("status sentence, the one number, then every row behind a Details expander, in the card order", async () => {
    const html = await staticCards([asApi(cardViewFromIndex({ ...COIN, statusFacts: facts, raised: "35.7", progressPct: 42, holders: 1, holdersOnlyPools: true, marketCap: "28" }, null))]);
    const st = html.indexOf("data-status"), stat = html.indexOf("data-card-stat"), det = html.indexOf("<details"), end = html.indexOf("</details>");
    assert.ok(st > 0 && stat > st && det > stat && end > det, "status, number, details");
    assert.match(html, /<p class="status" data-status="">Burns after each loss this season, once the curve fills\.<\/p>/);
    assert.match(html.slice(stat, det), /Curve<\/span> <span class="stat-v">35\.7 \/ 85 SOL raised</);
    assert.match(html, /<summary>Details<\/summary>/);
    const rows = [...html.slice(det, end).matchAll(/data-row="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(rows, ["progress", "rule", "nextSettle", "curve", "mcap", "holders", "age", "burned"]);
    assert.match(html, /28 SOL from the curve/); assert.match(html, /No holders yet/);
  });
  test("an untraded curve says \"No trades yet\"; unread rows say \"Not read yet\"; no \"?\" as text anywhere on the card", async () => {
    const html = await staticCards([asApi(cardViewFromIndex({ ...COIN, holders: null, readiness: null }, null)), asApi(cardViewFromIndex({ ...COIN, phase: null, raised: null, progressPct: null, marketCap: null, holders: null, launchedAt: null }, null))]);
    assert.match(html, /Nothing net raised yet/); assert.match(html, /Not read yet/);
    assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), /\?/);
    assert.doesNotMatch(html, /why-mark|No data yet|curve-implied/);
    // no status sent (an older answer): the rule stands in
    assert.match(html, /<p class="status" data-status="">Burns when the Rays lose<\/p>/);
  });
  test("the hero block and the platform strip's data-stat hooks are untouched", () => {
    const page = fs.readFileSync("site/burnticker/index.html", "utf8");
    const grid = page.slice(page.indexOf("THE COIN GRID"), page.indexOf("THE PLATFORM STRIP"));
    assert.doesNotMatch(grid, /setAttribute\("data-stat"/, "the card's number uses data-card-stat, never the strip's data-stat");
    // review L6: the app and the static page mark the card's parts with the same attribute names
    const app = fs.readFileSync("src/app/burnticker/_components/CoinCard.tsx", "utf8");
    for (const a of ["data-status", "data-card-stat", "data-card-details"]) { assert.match(app, new RegExp(`${a}[=>" ]`), `app: ${a}`); assert.match(grid, new RegExp(`setAttribute\\("${a}"`), `static: ${a}`); }
    assert.doesNotMatch(app, /data-stat=/);
    assert.match(page, /\.card\{overflow-wrap:anywhere\}/); assert.match(page, /\.rows>div\{grid-template-columns:6\.2rem minmax\(0,1fr\)\}/);
  });
});
