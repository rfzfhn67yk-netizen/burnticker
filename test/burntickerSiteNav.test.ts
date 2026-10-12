// ONE NAVIGATION MODEL (site audit #6/#13/#16/#17, ChatGPT audit R06 and BT-22, 2026-10-11). The dark home, the app, the whitepaper and the
// $DEFICIT site printed four navigation bars; the home's phone menu had no Launch; $DEFICIT looked like a dropdown. One list
// (src/lib/burnticker/siteNav.mjs) now feeds every surface, and one theme preference is shared by the app and the static pages.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SITE_NAV, LEARN_NAV, ALL_LINKS, SITE_TABS, LAUNCH_LABELS, LAUNCH_CLOSED, SEASONS_NAV, FOOTER_COPY, WALLET, SEARCH, linksHtml, shellHeaderHtml, shellFooterHtml } from "@/lib/burnticker/siteNav.mjs";
import { NAV, LEARN, TABS, SEASONS_LINKS, footerVariant, activeNav, activeTab } from "@/app/burnticker/_components/nav";
import { THEME_BOOT } from "@/app/burnticker/_components/theme";
import { OPERATOR_LINE } from "@/lib/burnticker/trustpack/copy";
import { renderRegions, REGIONS } from "../scripts/burnticker-site-nav.mts";
import { renderWhitepaper, WHITEPAPER_MD } from "../scripts/whitepaper-html.mjs";

const read = (f: string) => fs.readFileSync(f, "utf8");
const PRIMARY = ["Coins", "Seasons", "Launch"];
const LEARN_LABELS = ["How it works", "Trust", "Verify it yourself", "Who runs this", "Whitepaper", "Docs and API", "How burns are settled", "Changelog", "Incidents", "Bounty", "Press", "Terms", "Privacy", "X"];
/** The anchors inside one `data-site-nav="name"` element, as [text, href] (the ↗ mark and tags stripped). */
function navLinks(html: string, name: string): [string, string][] {
  const m = new RegExp(`data-site-nav="${name}"[^>]*>([\\s\\S]*?)</${name === "learn" ? "div" : "nav"}>`).exec(html);
  assert.ok(m, `no data-site-nav="${name}"`);
  return [...m[1].replace(/<details[\s\S]*?<\/details>/g, "").replace(/<p class="sh-menu-wallet">[\s\S]*?<\/p>/g, "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((a) => [a[2].replace(/<span aria-hidden="true">[^<]*<\/span>/g, "").replace(/<[^>]+>/g, "").trim(), /href="([^"]+)"/.exec(a[1])![1]]);
}

describe("one shell, same links, same order, every surface (the owner's review items 2, 3, 11; website-10, 2026-10-12)", () => {
  test("primary Coins · Seasons · Launch; Learn holds How it works, Trust, Operator, Whitepaper, Docs and API, X; $DEFICIT left the nav", () => {
    assert.deepEqual(SITE_NAV.map((l) => l.label), PRIMARY);
    assert.deepEqual(LEARN_NAV.map((l) => l.label), LEARN_LABELS);
    assert.deepEqual(NAV.map((n) => n.label), PRIMARY, "the app header reads the same list");
    assert.deepEqual(LEARN.map((n) => n.label), LEARN_LABELS);
    assert.ok(![...SITE_NAV, ...LEARN_NAV].some((l) => /DEFICIT/.test(l.label)), "$DEFICIT is a featured card, not a nav item");
    assert.ok(LEARN.find((n) => n.label === "Whitepaper")!.static, "the whitepaper is a static page, a plain link");
    assert.ok(fs.existsSync("site/burnticker/whitepaper.html"));
    assert.equal(LAUNCH_LABELS.nav, "Launch"); assert.equal(LAUNCH_LABELS.button, "Launch a coin");
  });

  test("the static pages' marked regions equal a fresh render (scripts/burnticker-site-nav.mts --write)", () => {
    const fresh = renderRegions();
    for (const f of new Set(REGIONS.map((r) => r.file))) assert.equal(read(f), fresh.get(f), `${f} is stale: run node --import ./test/alias-hook.mjs scripts/burnticker-site-nav.mts --write`);
  });

  test("home, status, fallback, whitepaper and $DEFICIT: the same header, Learn menu, phone menu, footer and tab bar", () => {
    const want = (name: string) => name === "header" ? PRIMARY : name === "learn" ? LEARN_LABELS : name === "tabs" ? SITE_TABS.map((t) => t.label) : [...PRIMARY, ...LEARN_LABELS];
    for (const f of ["site/burnticker/index.html", "site/burnticker/status/index.html", "site/burnticker/fallback/index.html", "site/burnticker/whitepaper.html", "site/deficit/index.html"]) {
      const html = read(f);
      for (const name of ["header", "learn", "menu", "footer", "tabs"]) assert.deepEqual(navLinks(html, name).map(([t]) => t), want(name), `${f} ${name}`);
      const hrefs = navLinks(html, "footer").map(([, h]) => h.replace(/^https:\/\/burnticker\.com/, ""));
      assert.deepEqual(hrefs, ALL_LINKS.map((l) => l.href), `${f} footer hrefs`);
      // the footer receipt: the disclaimers once, and the operator line verbatim (brief rule 5)
      assert.ok(html.includes(FOOTER_COPY.never) && html.includes(FOOTER_COPY.notAdvice) && html.includes(OPERATOR_LINE.replace(/&/g, "&amp;")), `${f} footer receipt`);
      // website-13 (owner decision on Claude site audit 2 item 6): a static page cannot load the wallet adapter, so "Connect wallet" opens
      // Your coins with the wallet list open; never a disabled button, in the header and in the phone menu
      const origin = /status|deficit/.test(f) ? "https://burnticker.com" : "";
      assert.ok(html.includes(`<a class="sh-wallet" href="${origin}${WALLET.href}" title="${WALLET.note}" data-wallet-button>${WALLET.label}`), `${f}: the header's Connect wallet`);
      assert.ok(html.includes(`<a href="${origin}${WALLET.href}" data-wallet-button>${WALLET.label}</a>`), `${f}: the phone menu's Connect wallet`);
      assert.doesNotMatch(html, /class="sh-wallet" disabled|<button[^>]*sh-wallet/, `${f}: no disabled wallet button`);
      assert.equal(WALLET.href, "/burnticker/me?connect=1");
      assert.ok(html.includes(`placeholder="${SEARCH.placeholder}"`), `${f}: the search box`);
    }
    // the whitepaper is generated with the same shell
    assert.equal(read("site/burnticker/whitepaper.html"), renderWhitepaper(read(WHITEPAPER_MD)));
  });

  test("site audit #13: X is marked external — ↗, a new tab and rel=noopener", () => {
    const html = linksHtml(ALL_LINKS);
    for (const l of ALL_LINKS.filter((x) => x.kind === "external")) assert.match(html, new RegExp(`<a href="${l.href.replace(/[.$]/g, "\\$&")}" target="_blank" rel="noopener">[^<]+<span aria-hidden="true"> ↗</span></a>`));
    const header = read("src/app/burnticker/_components/SiteHeader.tsx");
    assert.match(header, /item\.external\) return <a className="bt-nav-link" href=\{item\.href\} target="_blank" rel="noopener"/);
    assert.match(shellHeaderHtml(), /data-site-nav="learn"/); assert.match(shellFooterHtml({ operatorLine: "x" }), /data-site-nav="tabs"/);
  });

  test("the app header: Launch a coin opens the closed-launches dialog while launches are closed; the phone menu traps focus and closes on Escape", () => {
    const h = read("src/app/burnticker/_components/SiteHeader.tsx");
    assert.match(h, /\{launchOpen\s*\? <Link className="bt-launch-btn bt-launch-head" href="\/burnticker\/launch" data-launch-button>\{LAUNCH_LABELS\.button\}<\/Link>\s*: <button type="button" className="bt-launch-btn bt-launch-head" onClick=\{\(\) => setModal\(true\)\}/);
    // website-13: the real wallet adapter button, to the right of Launch a coin, and again in the phone menu; never disabled
    assert.match(h, /data-launch-button>\}\s*<WalletButton \/>|data-launch-button>\{LAUNCH_LABELS\.button\}<\/button>\}\s*<WalletButton \/>/);
    assert.match(h, /<WalletButton variant="menu" \/>/);
    assert.doesNotMatch(h, /className="bt-wallet" disabled/);
    assert.match(h, /<form className="bt-search" role="search" action="\/burnticker"/);
    assert.match(h, /e\.key === "Escape"[\s\S]*menuBtn\.current\?\.focus\(\)/);
    assert.match(h, /e\.key !== "Tab"[\s\S]*const ring = \[menuBtn\.current, \.\.\.links\(\)\]/);
    assert.match(h, /links\(\)\[0\]\?\.focus\(\)/, "opening moves focus into the menu");
    const modal = read("src/app/burnticker/_components/LaunchClosedModal.tsx");
    assert.match(modal, /<h2 id="bt-launch-closed-h">\{LAUNCH_CLOSED\.title\}<\/h2>/); assert.match(modal, /<p data-launch-sentence>\{state\.sentence\}<\/p>/, "website-13: the site launch record's own sentence");
    assert.match(modal, /href="\/burnticker" onClick=\{onClose\}>\{LAUNCH_CLOSED\.coins\}/, "a link to the Coins page");
    assert.doesNotMatch(LAUNCH_CLOSED.body, /\d{4}|soon|waitlist|email|notify/i, "brief rule 1: no date, no waitlist, no email capture");
    const home = read("site/burnticker/index.html");
    assert.match(home, /e\.key === "Escape"[\s\S]*sum\.focus\(\)/); assert.match(home, /var ring = \[sum\]\.concat\(links\(\)\)/);
  });

  test("the phone tab bar is global and has Search (review item 16): Coins · Search · Launch · Seasons · Learn", () => {
    assert.deepEqual(TABS.map((t) => t.label), ["Coins", "Search", "Launch", "Seasons", "Learn"]);
    assert.equal(TABS.find((t) => t.label === "Search")!.href, "/burnticker#search");
    assert.match(read("src/app/burnticker/CoinsIndex.tsx"), /<input id="search" ref=\{searchBox\}/, "the Search tab lands on the coin search box");
    assert.equal(activeTab("/burnticker/trust"), "/burnticker/about", "a Learn page lights the Learn tab");
    assert.equal(activeTab("/burnticker/t/DEFICIT"), "/burnticker");
  });

  test("the Seasons pages are named Leagues / Scoreboards / Burn Derby everywhere", () => {
    assert.deepEqual(SEASONS_NAV.map((l) => [l.label, l.href]), [["Leagues", "/burnticker/leagues"], ["Scoreboards", "/burnticker/rivalries"], ["Burn Derby", "/burnticker/derby"]]);
    assert.deepEqual(SEASONS_LINKS.map((l) => l.label), ["Leagues", "Scoreboards", "Burn Derby"]);
    for (const [f, cur] of [["src/app/burnticker/leagues/page.tsx", "/burnticker/leagues"], ["src/app/burnticker/rivalries/page.tsx", "/burnticker/rivalries"], ["src/app/burnticker/derby/page.tsx", "/burnticker/derby"]]) assert.match(read(f), new RegExp(`<SeasonsTabs current="${cur}" />`), f);
    assert.match(read("src/app/burnticker/rivalries/page.tsx"), /<h1 className="text-2xl font-semibold">Scoreboards<\/h1>/);
    for (const f of ["src/app/burnticker/rivalries/page.tsx", "site/burnticker/index.html"]) assert.doesNotMatch(read(f), />Open the rivalries<|>Seasons by league</, f);
    assert.equal(activeNav("/burnticker/derby"), "/burnticker/leagues", "the Derby belongs to Seasons");
  });

  test("site audit #17: list pages print the one-line footer; Coins, Launch and coin pages keep the full slip", () => {
    for (const p of ["/burnticker/leagues", "/burnticker/leagues/nhl/2026-27", "/burnticker/rivalries", "/burnticker/derby", "/burnticker/derby/abc"]) assert.equal(footerVariant(p), "compact", p);
    for (const p of ["/burnticker", "/burnticker/launch", "/burnticker/t/DEFICIT", "/burnticker/trust", "/burnticker/p/x", null]) assert.equal(footerVariant(p), "full", String(p));
    const f = read("src/app/burnticker/_components/SiteFooter.tsx");
    assert.match(f, /export function CompactFooter\(\)[\s\S]*Not advice[\s\S]*\{FOOTER_COPY\.never\}[\s\S]*\{OPERATOR_LINE\}[\s\S]*href="\/burnticker#disclosure">Full disclosure/);
    assert.match(f, /<footer className="bt-footer" id="disclosure">/);
    assert.match(read("config/public-repo/overlay/src/app/layout.tsx"), /<FooterSwitch full=\{<SiteFooter \/>\} compact=\{<CompactFooter \/>\} \/>/);
  });
});

describe("one theme preference (site audit #6), dark by default (review item 17, 2026-10-12)", () => {
  test("the home and the whitepaper run the app's boot script verbatim and carry the same switch on the same key; no page follows the OS into light", () => {
    for (const f of ["site/burnticker/index.html", "site/burnticker/whitepaper.html"]) {
      const h = read(f);
      assert.ok(h.includes(`<script>${THEME_BOOT}</script>`), `${f} boots the shared theme before paint`);
      assert.match(h, /data-theme-toggle/); assert.match(h, /localStorage\.setItem\("bt-theme", n\)/);
      assert.match(h, /:root\[data-theme="light"\]/);
      assert.doesNotMatch(h, /prefers-color-scheme: ?light/, `${f}: dark is the default`);
    }
    for (const f of ["site/burnticker/status/index.html", "site/burnticker/fallback/index.html", "config/public-repo/overlay/src/app/globals.css"]) assert.doesNotMatch(read(f), /prefers-color-scheme: ?light/, f);
    assert.match(read("src/app/burnticker/_components/theme.ts"), /return set === "light" \? "light" : "dark";/);
    assert.match(read("config/public-repo/overlay/src/app/layout.tsx"), /import \{ THEME_BOOT \} from ["]@\/app\/burnticker\/_components\/theme["]/);
    assert.match(read("src/app/burnticker/_components/SiteHeader.tsx"), /localStorage\.setItem\(THEME_KEY, next\)/);
  });
});
