// ONE NAVIGATION MODEL (site audit #6/#13/#16/#17, ChatGPT audit R06 and BT-22, 2026-10-11). The dark home, the app, the whitepaper and the
// $DEFICIT site printed four navigation bars; the home's phone menu had no Launch; $DEFICIT looked like a dropdown. One list
// (src/lib/burnticker/siteNav.mjs) now feeds every surface, and one theme preference is shared by the app and the static pages.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SITE_NAV, SITE_FOOTER_EXTRA, LAUNCH_LABELS, SEASONS_NAV, siteNavHtml } from "@/lib/burnticker/siteNav.mjs";
import { NAV, FOOTER_EXTRA, SEASONS_LINKS, footerVariant, activeNav } from "@/app/burnticker/_components/nav";
import { THEME_BOOT } from "@/app/burnticker/_components/theme";
import { DEFICIT_SITE } from "@/lib/burnticker/creatorLaunches";
import { renderRegions, REGIONS } from "../scripts/burnticker-site-nav.mts";
import { renderWhitepaper, WHITEPAPER_MD } from "../scripts/whitepaper-html.mjs";

const read = (f: string) => fs.readFileSync(f, "utf8");
const LABELS = ["Launch", "Coins", "Seasons", "Trust", "Whitepaper", "Docs/API", "$DEFICIT"];
/** The anchors inside one `data-site-nav="name"` element, as [text, href] (the ↗ mark and tags stripped). */
function navLinks(html: string, name: string): [string, string][] {
  const m = new RegExp(`data-site-nav="${name}"[^>]*>([\\s\\S]*?)</nav>`).exec(html);
  assert.ok(m, `no data-site-nav="${name}"`);
  return [...m[1].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].filter((a) => !/sb-brand/.test(a[1])).map((a) => [a[2].replace(/<[^>]+>/g, "").replace(/\s*↗\s*$/, "").trim(), /href="([^"]+)"/.exec(a[1])![1]]);
}
const labelOf = (text: string) => (text === LAUNCH_LABELS.closed ? "Launch" : text);

describe("one link set, same order, every surface", () => {
  test("the list: Launch · Coins · Seasons · Trust · Whitepaper · Docs/API · $DEFICIT; footers add X", () => {
    assert.deepEqual(SITE_NAV.map((l) => l.label), LABELS);
    assert.deepEqual(NAV.map((n) => n.label), LABELS, "the app header reads the same list");
    assert.deepEqual(FOOTER_EXTRA.map((n) => n.label), SITE_FOOTER_EXTRA.map((l) => l.label));
    assert.equal(NAV.find((n) => n.label === "$DEFICIT")!.href, DEFICIT_SITE);
    assert.ok(NAV.find((n) => n.label === "Whitepaper")!.static, "the whitepaper is a static page, a plain link");
    assert.ok(fs.existsSync("site/burnticker/whitepaper.html"));
  });

  test("the static pages' marked regions equal a fresh render (scripts/burnticker-site-nav.mts --write)", () => {
    const fresh = renderRegions();
    for (const f of new Set(REGIONS.map((r) => r.file))) assert.equal(read(f), fresh.get(f), `${f} is stale: run node --import ./test/alias-hook.mjs scripts/burnticker-site-nav.mts --write`);
  });

  test("home header, home phone menu, home footer, whitepaper header/footer, status footer, $DEFICIT bar/footer: same labels, same order", () => {
    const surfaces: [string, string, boolean][] = [
      ["site/burnticker/index.html", "header", false], ["site/burnticker/index.html", "menu", false], ["site/burnticker/index.html", "footer", true],
      ["site/burnticker/whitepaper.html", "header", false], ["site/burnticker/whitepaper.html", "footer", true],
      ["site/burnticker/status/index.html", "footer", true], ["site/deficit/index.html", "sitebar", false], ["site/deficit/index.html", "footer", true],
    ];
    for (const [f, name, footer] of surfaces) {
      const links = navLinks(read(f), name);
      assert.deepEqual(links.map(([t]) => labelOf(t)), footer ? [...LABELS, "X · @BurnTicker"] : LABELS, `${f} ${name}`);
      const hrefs = links.map(([, h]) => h.replace(/^https:\/\/burnticker\.com/, ""));
      assert.deepEqual(hrefs.slice(0, 7), SITE_NAV.map((l) => l.href), `${f} ${name} hrefs`);
    }
    // R06: Launch is in the phone menu while closed, labelled so
    assert.equal(navLinks(read("site/burnticker/index.html"), "menu")[0][0], LAUNCH_LABELS.closed);
    // the whitepaper is generated with the same list
    assert.equal(read("site/burnticker/whitepaper.html"), renderWhitepaper(read(WHITEPAPER_MD)));
  });

  test("site audit #13: $DEFICIT and X are marked external — ↗, a new tab and rel=noopener — except on the $DEFICIT site itself", () => {
    const html = siteNavHtml({ footer: true });
    for (const l of [...SITE_NAV, ...SITE_FOOTER_EXTRA].filter((x) => x.kind === "external")) assert.match(html, new RegExp(`<a href="${l.href.replace(/[.$]/g, "\\$&")}" target="_blank" rel="noopener">[^<]+<span aria-hidden="true"> ↗</span></a>`));
    assert.match(siteNavHtml({ self: "https://deficit.burnticker.com/" }), /<a href="https:\/\/deficit\.burnticker\.com\/" aria-current="page">\$DEFICIT<\/a>/);
    const header = read("src/app/burnticker/_components/SiteHeader.tsx");
    assert.match(header, /item\.external\) return <a className="bt-nav-link" href=\{item\.href\} target="_blank" rel="noopener"/);
    assert.doesNotMatch(read("site/burnticker/index.html"), /\$DEFICIT ˄|\$DEFICIT\s*\^/);
  });

  test("the app header: Launch labelled by the launch state; the phone menu traps focus and closes on Escape", () => {
    const h = read("src/app/burnticker/_components/SiteHeader.tsx");
    assert.match(h, /!launchOpen \? LAUNCH_LABELS\.closed : inMenu \? LAUNCH_LABELS\.open : LAUNCH_LABELS\.openShort/);
    assert.match(h, /e\.key === "Escape"[\s\S]*menuBtn\.current\?\.focus\(\)/);
    assert.match(h, /e\.key !== "Tab"[\s\S]*const ring = \[menuBtn\.current, \.\.\.links\(\)\]/);
    assert.match(h, /links\(\)\[0\]\?\.focus\(\)/, "opening moves focus into the menu");
    const home = read("site/burnticker/index.html");
    assert.match(home, /e\.key === "Escape"[\s\S]*sum\.focus\(\)/); assert.match(home, /var ring = \[sum\]\.concat\(links\(\)\)/);
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
    assert.match(f, /export function CompactFooter\(\)[\s\S]*Not advice[\s\S]*\{OPERATOR_LINE\}[\s\S]*href="\/burnticker#disclosure">Full disclosure/);
    assert.match(f, /<footer className="bt-footer" id="disclosure">/);
    assert.match(read("config/public-repo/overlay/src/app/layout.tsx"), /<FooterSwitch full=\{<SiteFooter \/>\} compact=\{<CompactFooter \/>\} \/>/);
  });
});

describe("one theme preference (site audit #6: the static pages respect the app's switch)", () => {
  test("the home and the whitepaper run the app's boot script verbatim and carry the same switch on the same key", () => {
    for (const f of ["site/burnticker/index.html", "site/burnticker/whitepaper.html"]) {
      const h = read(f);
      assert.ok(h.includes(`<script>${THEME_BOOT}</script>`), `${f} boots the shared theme before paint`);
      assert.match(h, /data-theme-toggle/); assert.match(h, /localStorage\.setItem\("bt-theme", n\)/);
      assert.match(h, /:root\[data-theme="light"\]/);
    }
    assert.match(read("config/public-repo/overlay/src/app/layout.tsx"), /import \{ THEME_BOOT \} from ["]@\/app\/burnticker\/_components\/theme["]/);
    assert.match(read("src/app/burnticker/_components/SiteHeader.tsx"), /localStorage\.setItem\(THEME_KEY, next\)/);
  });
});
