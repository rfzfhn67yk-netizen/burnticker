// WEBSITE-10 (2026-10-12): the launchpad skeleton the owner's review asked for, on top of the receipts. One card order everywhere, the
// featured cards read from files (never typed), the activity line with real events only, the closed-launches dialog without a date, the
// copy of every new string lint-clean, and the Caddy change left as a proposal for the owner.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { CARD_ROWS, cardViewFromIndex, groupDigits, shortDay } from "@/lib/burnticker/cardView";
import { activityEvents, featuredCoins, homeData, memoBurn, NO_EVENTS_LINE } from "@/lib/burnticker/home";
import { sampleReceipts } from "@/lib/burnticker/trustpack/samples";
import { DEFICIT_SITE } from "@/lib/burnticker/creatorLaunches";
import { EXPLORE_VERIFIED_BURN } from "@/lib/burnticker/currentStatusLinks";
import { FOOTER_COPY, HERO, HOW_IT_WORKS, LAUNCH_CLOSED, SEARCH, WALLET } from "@/lib/burnticker/siteNav.mjs";

const read = (f: string) => fs.readFileSync(f, "utf8");
const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}:\n${formatHits(r)}`); };
/** The data-row keys in source order, de-duplicated. */
const rowOrder = (src: string) => [...new Set([...src.matchAll(/data-row(?:=|", )"?([A-Za-z]+)"/g)].map((m) => m[1]))];

describe("one card order (review item 5, brief rule 10)", () => {
  test("the app's card and the static home's renderer print the rows in CARD_ROWS order", () => {
    assert.deepEqual([...CARD_ROWS], ["image", "name", "ticker", "rule", "nextSettle", "burned", "curve", "receipt"]);
    const card = read("src/app/burnticker/_components/CoinCard.tsx");
    const view = card.slice(card.indexOf("export function ViewCard"), card.indexOf("export function SkeletonCard"));
    assert.deepEqual(rowOrder(view), [...CARD_ROWS]);
    const home = read("site/burnticker/index.html");
    const js = home.slice(home.indexOf("THE COIN GRID"), home.indexOf("THE ONE CURRENT-STATUS SOURCE"));
    assert.deepEqual(rowOrder(js.replace(/row\(dl, "(\w+)"/g, 'data-row="$1"')), [...CARD_ROWS]);
  });
  test("a registered coin becomes the same card: rule, next result, total burned, curve or pool, and Check receipt once it has a receipt", () => {
    const base = { ticker: "RAYS", name: "Rays", mint: "M", oneLiner: "burns when the Rays lose", status: "live", imageUrl: null, burned: "1234.5", burns: 2, nextCheckAt: "2026-10-20T00:00:00Z", nextCloseTime: null, lastBurnAt: "2026-10-10T00:00:00Z", launchedAt: "2026-10-01T00:00:00Z", pairId: null, phase: "curve" as const, progressPct: 42 };
    const v = cardViewFromIndex(base);
    assert.equal(v.rule, "Burns when the Rays lose"); assert.equal(v.nextSettle, "Next result on Oct 20");
    assert.equal(v.burned, "1,234.5 $RAYS burned in 2 burns"); assert.deepEqual(v.curve, { label: "Curve 42% full", pct: 42, done: false });
    assert.deepEqual(v.receipt, { href: "/burnticker/t/RAYS#receipts" });
    const g = cardViewFromIndex({ ...base, burns: 0, nextCheckAt: null, phase: "graduated" });
    assert.equal(g.nextSettle, null, "no schedule, no row"); assert.equal(g.receipt, null); assert.equal(g.burned, "Nothing burned yet");
    assert.deepEqual(g.curve, { label: "Trades in its own pool", pct: 100, done: true }); assert.deepEqual(g.tags.map((t) => t.label), ["Trading pool"]);
    assert.equal(groupDigits("4010874.872446"), "4,010,874.87"); assert.equal(shortDay("2026-10-06"), "Oct 6");
  });
});

describe("the featured cards (review items 12 and 13, brief rule 10)", () => {
  const f = featuredCoins();
  test("fixed order: $DEFICIT featured, $REHEARSAL tagged as the mainnet rehearsal, the devnet coin tagged devnet", () => {
    assert.deepEqual(f.map((c) => [c.id, c.ticker, c.tags[0].tone]), [["deficit", "DEFICIT", "featured"], ["rehearsal", "REHEARSAL", "rehearsal"], ["deficit-devnet", "DEFICIT", "devnet"]]);
  });
  test("$DEFICIT before the create: rules locked, not created, its mint shown as an address only, no receipt, its own site as the link", () => {
    const own = JSON.parse(read("config/own-tokens.json")) as { tokens: { symbol: string; address: string; status: string }[] };
    const d = own.tokens.find((t) => t.symbol === "DEFICIT")!;
    assert.equal(d.status, "planned");
    assert.match(f[0].note!, /rules are locked, and the coin is not created yet/);
    assert.deepEqual(f[0].mint, { address: "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj", label: "Mint address, not created yet" });
    assert.equal(f[0].receipt, null); assert.equal(f[0].burned, "Nothing burned yet"); assert.equal(f[0].href, DEFICIT_SITE);
    assert.doesNotMatch(JSON.stringify(f[0]), /solscan|explorer|raydium/i, "no mint link before the coin exists");
  });
  test("$REHEARSAL: disclosed, not for trading, nothing burned; the devnet coin's total is summed from its confirmed evidence rows", () => {
    assert.match(f[1].note!, /not for trading/); assert.equal(f[1].receipt, null); assert.equal(f[1].href, "/burnticker/trust#rehearsals");
    assert.match(read("src/app/burnticker/trust/page.tsx"), /id="rehearsals">Rehearsal coins</);
    const s = sampleReceipts();
    const confirmed = s.receipts.filter((r) => r.ticker === "DEFICIT" && r.status === "confirmed");
    const total = confirmed.reduce((a, r) => a + memoBurn(r.memo)!, 0);
    assert.equal(f[2].burned, `${groupDigits(total)} $DEFICIT burned in ${confirmed.length} burns`);
    assert.deepEqual(f[2].receipt, { href: EXPLORE_VERIFIED_BURN.href }); assert.match(f[2].note!, /no money value/);
  });
});

describe("the activity line (review item 4, brief rule 3): real events only", () => {
  test("confirmed burns only, mainnet first, the devnet ones marked devnet; skipped rows never appear", () => {
    const s = sampleReceipts();
    const ev = activityEvents([{ ticker: "RAYS", burns: 3, lastBurnAt: "2026-10-11T02:00:00Z" }, { ticker: "NONE", burns: 0, lastBurnAt: null }], s, 50);
    assert.equal(ev[0].network, "mainnet"); assert.equal(ev[0].text, "$RAYS burned on Oct 11. It has burned 3 times.");
    assert.ok(!ev.some((e) => /NONE/.test(e.text)));
    const devnet = ev.filter((e) => e.network === "devnet");
    assert.equal(devnet.length, s.receipts.filter((r) => r.status === "confirmed").length, "one line per confirmed receipt, none for skipped rows");
    for (const e of ev) clean(e.text, e.text);
  });
  test("with nothing to show it says so in one line; the components never fall back to sample rows", () => {
    assert.deepEqual(activityEvents([], null), []);
    assert.equal(homeData([], "/nonexistent-root").events.length, 0);
    assert.equal(homeData([], "/nonexistent-root").noEvents, NO_EVENTS_LINE);
    for (const f of ["src/app/burnticker/_components/ActivityTicker.tsx", "src/lib/burnticker/siteNav.mjs"]) {
      const src = read(f), code = src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
      assert.match(src, /noEvents/, `${f} prints the API's one line`); assert.doesNotMatch(code, /sample|mock|placeholder row/i, f);
    }
    assert.match(read("src/app/api/burnticker/home/route.ts"), /homeData\(index\.tokens/);
  });
});

describe("words (memory: plain English; config/launch/copy-lint.json)", () => {
  test("every new shell string passes the copy lint", () => {
    const all = [HERO.title, HERO.sub, ...HOW_IT_WORKS.flatMap((h) => [h.title, h.text]), ...Object.values(FOOTER_COPY), ...Object.values(LAUNCH_CLOSED), WALLET.label, WALLET.note, SEARCH.label, NO_EVENTS_LINE];
    for (const f of featuredCoins()) all.push(f.name, f.note ?? "", f.rule, f.nextSettle ?? "", f.burned, f.curve.label, ...f.tags.map((t) => t.label));
    for (const t of all.filter(Boolean)) clean(t, t);
  });
  test("brief rule 1: no date, countdown, waitlist or email field in the shell; brief rule 8: no price, no Kalshi", () => {
    for (const f of ["src/lib/burnticker/siteNav.mjs", "src/app/burnticker/_components/LaunchClosedModal.tsx", "src/app/burnticker/_components/SiteHeader.tsx", "src/app/burnticker/CoinsIndex.tsx", "site/burnticker/index.html"]) {
      const code = read(f).replace(/^\s*(\/\/|\*|\/\*).*$/gm, "").replace(/<!--[\s\S]*?-->/g, "");
      assert.doesNotMatch(code, /type="email"|waitlist|countdown|coming soon/i, f);
      assert.doesNotMatch(code, /kalshi|market cap/i, f);
    }
  });
});

describe("the Caddy change is a proposal (brief rule 7)", () => {
  test("deploy/caddy/home-to-app.proposed.caddy proxies `/` to the app's home with the static page as the fallback; the live Caddyfile is untouched", () => {
    const p = read("deploy/caddy/home-to-app.proposed.caddy");
    assert.match(p, /^# PROPOSED — NOT IMPORTED BY deploy\/caddy\/Caddyfile/);
    assert.match(p, /@home path \/ \/index\.html\nhandle @home \{[\s\S]*rewrite \* \/burnticker[\s\S]*reverse_proxy \{\$MCT_APP_UPSTREAM:127\.0\.0\.1:3000\}/);
    assert.match(p, /handle_response @upstream_5xx \{[\s\S]*rewrite \* \/index\.html/);
    assert.doesNotMatch(p.replace(/^\s*#.*$/gm, ""), /header_up Host/);
    assert.doesNotMatch(read("deploy/caddy/Caddyfile"), /@home|home-to-app/);
  });
});

describe("shell items from the website-11 merge (coordinator, 2026-10-12)", () => {
  test("the venue chip never names Kalshi; a pair page lights Coins; every /burnticker route gets a footer with the not-advice and operator lines", async () => {
    const card = read("src/app/burnticker/_components/CoinCard.tsx");
    assert.match(card, /kalshi: "Prediction market"/); assert.doesNotMatch(card.replace(/^\s*(\/\/|\*|\/\*).*$/gm, ""), /"Kalshi"/);
    const { activeNav, footerVariant } = await import("@/app/burnticker/_components/nav");
    assert.equal(activeNav("/burnticker/p/den-kc"), "/burnticker"); assert.equal(activeNav("/burnticker/t/DEFICIT"), "/burnticker");
    for (const p of ["/burnticker/t/DEFICIT", "/burnticker/p/x"]) assert.equal(footerVariant(p), "full", p);
    const footer = read("src/app/burnticker/_components/SiteFooter.tsx");
    for (const fn of ["export function SiteFooter()", "export function CompactFooter()"]) {
      const body = footer.slice(footer.indexOf(fn), footer.indexOf("\n}\n", footer.indexOf(fn)));
      assert.match(body, /\{OPERATOR_LINE\}/, fn); assert.match(body, /NOT ADVICE|Not advice\./, fn);
    }
    assert.match(read("config/public-repo/overlay/src/app/layout.tsx"), /<FooterSwitch full=\{<SiteFooter \/>\} compact=\{<CompactFooter \/>\} \/>/);
    const css = read("config/public-repo/overlay/src/app/globals.css");
    for (const c of [".bt-tabs", ".bt-tab ", ".bt-launch-btn", ".bt-curve", ".bt-tape"]) assert.ok(css.includes(c), c);
  });
});
