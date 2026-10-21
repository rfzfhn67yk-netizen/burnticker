// SITE POLISH 2 (2026-10-13): QA pass 9 items 10, 42 and 43, audit 10 item 23, audit 7 item 19, and the private review's two additions.
// The API base path answers; the static pages load the app's two typefaces and print the app's header, footer and tab bar; the home's
// steps stack on a phone; tab-bar links and the image link on a coin card have names; the hero's create path reads "Preview a coin launch"
// with the site launch record's own sentence while creator launches are closed; the preview banner and every badge measure ≥ 4.5:1 in
// both themes; league pages explain an empty season above the roster; the footer keeps each disclosure as one line and a link.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { API, callRoute } from "./burntickerApiHelpers.ts";
import { API_VERSION, apiIndex, endpoint } from "@/lib/burnticker/api/spec";
import { CREATE_PREVIEW, FOOTER_COPY, FOOTER_ROWS, LAUNCH_CLOSED, LAUNCH_LABELS, SHELL_CSS, SHELL_FONTS, SITE_TABS, TWO_PATHS, createPathFor, shellFontCss, shellFooterHtml, shellScript } from "@/lib/burnticker/siteNav.mjs";
import { DEV_FEE_LINE, OPERATOR_LINE, USE_OF_FEES } from "@/lib/burnticker/fees";
import { SITE_SENTENCE, siteLaunchState, siteLaunchStateFromCatalogue } from "@/lib/burnticker/launchAvailability";
import { REGIONS, renderRegions } from "../scripts/burnticker-site-nav.mts";
import { feeLine } from "../scripts/whitepaper-html.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const cfg = loadCopyLintConfig(ROOT);
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}: ${t}\n${formatHits(r)}`); };
const STATIC = ["site/burnticker/index.html", "site/burnticker/status/index.html", "site/burnticker/fallback/index.html", "site/deficit/index.html", "site/burnticker/whitepaper.html"];
const GLOBALS = "config/public-repo/overlay/src/app/globals.css";

describe("QA pass 9 item 10: the API address the footer prints answers", () => {
  test("GET /api/burnticker/v1 is a small index: name, version, the OpenAPI document and the docs page", async () => {
    for (const url of [API, `${API}/`]) {
      const res = await callRoute(url);
      assert.equal(res.status, 200, url);
      const j = await res.json() as Record<string, string>;
      assert.deepEqual(j, apiIndex());
      assert.equal(j.version, API_VERSION); assert.equal(j.openapi, "/api/burnticker/v1/openapi.json"); assert.equal(j.docs, "/burnticker/docs");
      assert.equal(res.headers.get("access-control-allow-origin"), "*");
    }
    assert.ok(fs.existsSync(path.join(ROOT, "src/app/burnticker/docs/page.tsx")), "the docs page the index names exists");
    assert.equal(endpoint("getApiIndex").path, "/");
  });
  test("both footers link the address itself and the docs", () => {
    assert.equal(FOOTER_ROWS.api.path, "/api/burnticker/v1"); assert.equal(FOOTER_ROWS.api.href, "/burnticker/docs");
    assert.match(read("src/app/burnticker/_components/SiteFooter.tsx"), /<a href=\{API_BASE_PATH\}>\{API_BASE_PATH\}<\/a> · <Link href=\{R\.api\.href\}(?: prefetch=\{false\})?>/);   // A-22 (2026-10-18): footer links do not prefetch
    for (const f of STATIC.slice(0, 1)) assert.match(read(f), /<a href="\/api\/burnticker\/v1">\/api\/burnticker\/v1<\/a> · <a href="\/burnticker\/docs">Docs<\/a>/, f);
  });
});

describe("QA pass 9 item 42: one typeface set, one header, one tab bar", () => {
  test("the static pages ship and load the app's two families (same weights and display as next/font in the app layout)", () => {
    const layout = read("config/public-repo/overlay/src/app/layout.tsx");
    assert.match(layout, /Courier_Prime\(\{ weight: \["400", "700"\][^)]*display: "swap"/);
    assert.match(layout, /Space_Grotesk\(\{ weight: \["400", "500", "600", "700"\][^)]*display: "swap"/);
    assert.deepEqual([...new Set(SHELL_FONTS.map((f) => f.family))], ["Courier Prime", "Space Grotesk"]);
    for (const f of SHELL_FONTS) {
      const buf = fs.readFileSync(path.join(ROOT, "site/burnticker/fonts", f.file));
      assert.equal(buf.subarray(0, 4).toString("latin1"), "wOF2", `${f.file} is a WOFF2 file`);
      assert.ok(buf.length > 5_000 && buf.length < 60_000, f.file);
    }
    // the OFL travels with the files: one license per family (their copyright lines differ), beside the static fonts and in the app
    for (const [fam, line] of [["CourierPrime", "Copyright 2015 The Courier Prime Project Authors (https://github.com/quoteunquoteapps/CourierPrime)."], ["SpaceGrotesk", "Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk)"]]) {
      for (const dir of ["site/burnticker/fonts", "config/public-repo/overlay/public/burnticker/fonts"]) {
        const t = read(`${dir}/OFL-${fam}.txt`);
        assert.equal(t.split("\n")[0], line, `${dir} ${fam}`);
        assert.ok(t.includes("SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007") && t.includes("OTHER DEALINGS IN THE FONT SOFTWARE."), `${dir} ${fam}: the full text`);
      }
      assert.match(read("site/burnticker/fonts/README.md"), new RegExp(`OFL-${fam}\\.txt`));
    }
    const css = shellFontCss("");
    for (const f of SHELL_FONTS) assert.ok(css.includes(`font-family:"${f.family}"`) && css.includes(`url("/fonts/${f.file}")`) && css.includes("font-display:swap"), f.file);
    assert.ok(shellFontCss("https://burnticker.com").includes('url("https://burnticker.com/fonts/'), "another host loads them from the main site");
    assert.match(read("deploy/caddy/Caddyfile"), /header \/fonts\/\* Access-Control-Allow-Origin "\*"/, "fonts may load across origins");
    // every static page's shell style starts with the font faces; the fonts are named the same in SHELL_CSS and the app's theme
    for (const f of STATIC) { const h = read(f); assert.ok(h.includes(`<style>${shellFontCss(f.startsWith("site/deficit") || f.includes("/status/") ? "https://burnticker.com" : "")}`), f); }
    assert.match(SHELL_CSS, /--sh-mono:"Courier Prime"/); assert.match(SHELL_CSS, /--sh-sans:"Space Grotesk"/);
    assert.match(read(GLOBALS), /--font-mono: var\(--font-courier-prime\), "Courier Prime"/); assert.match(read(GLOBALS), /--font-sans: var\(--font-space-grotesk\), "Space Grotesk"/);
  });

  test("the static header and tab bar use the app's measurements (the drift found on 2026-10-13, now pinned)", () => {
    const g = read(GLOBALS);
    // [static rule fragment, app rule fragment]: the same declaration on both shells
    const pairs: [string, string][] = [
      [".sh-row{max-width:72rem;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:16px}", ".bt-header-row { max-width: 72rem; margin: 0 auto; padding: 10px 16px; display: flex; align-items: center; gap: 16px; }"],
      ["box-shadow:0 0 0 1px var(--sh-line)}", ".bt-mark { width: 34px; height: 34px; border-radius: 50%; display: block; box-shadow: 0 0 0 1px var(--bt-line); }"],
      [".sh-word{font:700 1.08rem/1 var(--sh-mono);letter-spacing:.16em}", ".bt-wordmark { font: 700 1.08rem/1 var(--font-mono); letter-spacing: .16em; }"],
      [".sh-nav{display:none;align-items:center;gap:6px;margin-left:12px}", ".bt-nav-desktop { display: none; align-items: center; gap: 6px; margin-left: 12px; }"],
      [".sh-nav a,.sh-learn>summary{font:700 .8rem/1 var(--sh-mono);letter-spacing:.1em;text-transform:uppercase", ".bt-nav-link { font: 700 .8rem/1 var(--font-mono); letter-spacing: .1em; text-transform: uppercase;"],
      [".sh-ext{font-size:.7em;margin-left:3px;opacity:.7}", ".bt-ext { font-size: .7em; margin-left: 3px; opacity: .7; }"],
      [".sh-launch{display:inline-block;font:700 .78rem/1 var(--sh-mono);letter-spacing:.1em", ".bt-launch-head { padding: 9px 12px; font-size: .78rem;"],
      [".sh-wallet,.sh-ghost{font:700 .76rem/1 var(--sh-mono)", ".bt-wallet { display: none; align-items: center; gap: 6px; font: 700 .76rem/1 var(--font-mono);"],
      [".sh-tabbar{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));position:fixed;left:0;right:0;bottom:0;z-index:45;background:var(--sh-bg);border-top:2px dashed var(--sh-line);padding-bottom:env(safe-area-inset-bottom)}", ".bt-tabbar { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); position: fixed; left: 0; right: 0; bottom: 0; z-index: 45; background: var(--bt-bg); border-top: 2px dashed var(--bt-line); padding-bottom: env(safe-area-inset-bottom); }"],
      ["gap:3px;height:60px;min-width:44px;font:700 12px/1 var(--sh-mono);letter-spacing:.03em;text-transform:uppercase", "gap: 3px; height: 60px; min-width: 44px; font: 700 12px/1 var(--font-mono); letter-spacing: .03em; text-transform: uppercase;"],
      [".sh-slip-title{text-align:center;font-weight:700;font-size:1.35rem;letter-spacing:.22em}", ".bt-slip-title { display: block; font-weight: 700; font-size: 1.35rem; letter-spacing: .22em; }"],
      ["transform:rotate(-.6deg)", "transform: rotate(-.6deg)"],
      [".sh-rows>div{display:grid;grid-template-columns:6.5rem 1fr;gap:10px}", ".bt-rows > div { display: grid; grid-template-columns: 6.5rem 1fr; gap: 10px; }"],
    ];
    for (const [s, a] of pairs) { assert.ok(SHELL_CSS.includes(s), `SHELL_CSS: ${s}`); assert.ok(g.includes(a), `globals.css: ${a}`); }
    // the Learn menu shows the same chevron as the app's
    assert.match(read("site/burnticker/index.html"), /<summary>Learn<span aria-hidden="true" class="sh-ext">▾<\/span><\/summary>/);
    assert.match(read("src/app/burnticker/_components/SiteHeader.tsx"), />Learn<span aria-hidden="true" className="bt-ext">▾<\/span>/);
  });

  test("at phone width the three How it works steps stack, one per row", () => {
    const home = read("site/burnticker/index.html");
    const phone = /@media \(max-width:639px\)\{([\s\S]*?)\n\}/.exec(home)![1];
    assert.match(phone, /\.how\{grid-template-columns:1fr;gap:6px\}/);
    assert.doesNotMatch(phone, /\.how\{grid-template-columns:repeat\(3/);
    assert.match(home, /@media \(min-width:760px\)\{\.how\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}\}/, "three across on wide screens");
  });

  test("the generated regions are current (the generator, never hand edits)", () => {
    const out = renderRegions();
    for (const f of new Set(REGIONS.map((r) => r.file))) assert.equal(out.get(f), read(f), `${f}: run scripts/burnticker-site-nav.mts --write`);
  });
});

describe("QA pass 9 item 43: names for the tab bar and the coin-card image link", () => {
  test("every tab has a name that starts with its visible label; both tab bars print it", () => {
    for (const t of SITE_TABS) { assert.ok(t.name.startsWith(t.label), `${t.label}: ${t.name}`); assert.ok(t.name.length > t.label.length, t.label); clean(t.name, t.label); }
    const home = read("site/burnticker/index.html");
    for (const t of SITE_TABS) assert.ok(home.includes(`<a href="${t.href}" aria-label="${t.name}"`), t.label);
    assert.match(read("src/app/burnticker/_components/TabBar.tsx"), /aria-label=\{t\.name\}/);
    // keyboard order: the bar follows the footer in the document, its five links in the visual order
    assert.ok(home.indexOf('class="sh-footer"') < home.indexOf('class="sh-tabbar"'));
    assert.deepEqual([...home.slice(home.indexOf('class="sh-tabbar"')).matchAll(/aria-label="([^"]+)"/g)].slice(1, 6).map((m) => m[1]), SITE_TABS.map((t) => t.name));
  });
  test("the image link on a coin card is named and stays out of the tab order (the name link next to it is the stop)", () => {
    for (const f of ["src/app/burnticker/_components/CoinCard.tsx", "src/app/burnticker/creator/[wallet]/page.tsx"]) {
      const src = read(f);
      assert.doesNotMatch(src, /tabIndex=\{-1\} aria-hidden="true"/, `${f}: no hidden focusable link`);
      assert.match(src, /tabIndex=\{-1\} aria-label=\{`\$\{[vc]\.name\} \$\$\{[vc]\.ticker\}, coin page`\}><CoinThumb/, f);
    }
    // the static home's card image is not a link at all
    assert.doesNotMatch(read("site/burnticker/index.html"), /el\("a"[^;]*\);[^\n]*img/);
  });
});

describe("audit 10 item 23, prelaunch audit 2026-10-18: the hero's create path keeps one label; a status line carries the record", () => {
  const closed = siteLaunchState({ BURNTICKER_CLUSTER: "devnet" });
  test("closed: the same label, and the record's own sentence with what the launch page still does", () => {
    assert.equal(closed.canSign, false);
    const p = createPathFor(closed);
    assert.deepEqual(p, { label: "Launch a coin", text: TWO_PATHS[1].text, status: `${closed.sentence} ${CREATE_PREVIEW.text}`, open: false });
    assert.ok(Object.values(SITE_SENTENCE).includes(closed.sentence as never), "the sentence is the record's, never typed here");
    // loading and unreadable records keep the label; unreadable says so in the record's own words
    assert.equal(createPathFor(null).status, `${LAUNCH_CLOSED.unread} ${CREATE_PREVIEW.text}`);
    assert.equal(createPathFor(siteLaunchStateFromCatalogue(null, { failure: "offline" })).status, `${SITE_SENTENCE.unavailable} ${CREATE_PREVIEW.text}`);
    const preview = siteLaunchStateFromCatalogue({ launches: { creators: false, mode: "preview" } });
    assert.equal(createPathFor(preview).label, "Launch a coin");
  });
  test("open (a record that can sign): the same label and text; the status line says launches are open", () => {
    const open = { ...closed, mode: "open" as const, canSign: true, sentence: SITE_SENTENCE.open };
    assert.deepEqual(createPathFor(open), { label: TWO_PATHS[1].label, text: TWO_PATHS[1].text, status: SITE_SENTENCE.open, open: true });
    for (const r of [null, closed, open]) assert.equal(createPathFor(r).label, LAUNCH_LABELS.button, "the label never changes with the record");
    for (const r of [null, closed, open]) assert.equal(createPathFor(r).text, TWO_PATHS[1].text, "nor the sentence under it");
  });
  test("the static home prints the final label at once, and the shell script runs the same function on GET /api/burnticker/home", () => {
    const home = read("site/burnticker/index.html");
    assert.match(home, /<a class="path path-create" href="\/burnticker\/launch" data-launch-button data-create-path aria-describedby="create-status"><span class="path-t" data-create-label>Launch a coin<\/span>/);
    assert.ok(home.includes(`<p class="path-status" id="create-status" data-create-status role="status" hidden></p>`), "empty until the record is read (the word budget); the label is already final");
    const s = shellScript();
    assert.ok(s.includes(`(${createPathFor.toString()})(l)`), "the function itself, as source");
    assert.match(s, /createPath\(l \|\| null\);/);
    // run the embedded function on both states, as the browser does
    const fn = new Function("TWO_PATHS", "CREATE_PREVIEW", "LAUNCH_CLOSED", `return (${createPathFor.toString()});`)(TWO_PATHS, CREATE_PREVIEW, { unread: LAUNCH_CLOSED.unread });
    assert.equal(fn(closed).label, "Launch a coin"); assert.equal(fn({ canSign: true, sentence: SITE_SENTENCE.open }).label, "Launch a coin");
    assert.equal(fn({ canSign: true, sentence: SITE_SENTENCE.open }).status, SITE_SENTENCE.open);
  });
  test("the new words pass the copy lint", () => {
    for (const t of [LAUNCH_LABELS.button, TWO_PATHS[1].text, CREATE_PREVIEW.text, LAUNCH_CLOSED.body, createPathFor(null).status!, createPathFor(closed).status!, FOOTER_ROWS.operator.more, FOOTER_ROWS.fees.more, FOOTER_ROWS.api.more, ...SITE_TABS.map((t) => t.name)]) clean(t, "polish-2 copy");
    assert.doesNotMatch(CREATE_PREVIEW.text, /launches are (open|closed)/i, "the open/closed words come from the record");
  });
});

describe("audit 7 item 19: measured contrast for the preview banner and every badge, both themes", () => {
  const lum = (h: string) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const vars = (src: string) => Object.fromEntries([...src.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((x) => [x[1], x[2].toLowerCase()]));
  test("the app: the launch preview banner (amber 300 on neutral 950 and 900) and the chips and tags", () => {
    const css = read(GLOBALS);
    const block = (re: RegExp) => vars(re.exec(css)![1]);
    const dark = { ...block(/@theme \{([\s\S]*?)\n\}/), ...block(/:root \{([\s\S]*?)\n\}/) };
    const light = { ...dark, ...block(/:root\[data-theme="light"\] \{([\s\S]*?)\n\}/) };
    // the banner's classes, read from the launch page so a class change re-runs this
    assert.match(read("src/app/burnticker/launch/page.tsx"), /bg-neutral-950\/95 px-3 py-2 text-sm font-medium text-amber-300"[^>]*data-preview-banner/);
    assert.match(css, /\.bt-chip-kalshi \{ color: var\(--bt-chip-kalshi\)/); assert.match(css, /\.bt-chip-polymarket \{ color: var\(--bt-chip-polymarket\)/);
    const pairs: [string, string][] = [["--color-amber-300", "--color-neutral-950"], ["--color-amber-300", "--color-neutral-900"],
      ...["--bt-chip-kalshi", "--bt-chip-polymarket", "--bt-scorch", "--bt-dim"].flatMap((fg) => [[fg, "--bt-bg"], [fg, "--bt-counter"]] as [string, string][]),
      ["--bt-stamp-ink", "--bt-stamp-solid"]];
    for (const [name, t] of [["dark", dark], ["light", light]] as const) for (const [fg, bg] of pairs) {
      assert.ok(t[fg] && t[bg], `${name}: ${fg} / ${bg} defined`);
      const r = ratio(t[fg], t[bg]); assert.ok(r >= 4.5, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
    }
    assert.ok(ratio(light["--color-amber-300"], light["--color-neutral-950"]) > 5, "the light banner, 1.25:1 before");
  });
  test("the static home: badge and text tokens on the page and the card, both themes", () => {
    const home = read("site/burnticker/index.html");
    assert.match(home, /\.tag\.rehearsal\{color:var\(--sh-scorch\);border-color:var\(--sh-scorch\)\}/);
    assert.doesNotMatch(home, /\.tag\.[a-z]+\{color:#c8873a/);
    const dark = { ...vars(/\n:root\{([\s\S]*?)\}/.exec(home)![1]), ...vars(/:root\{--sh-bg([\s\S]*?)\}/.exec(home)![0]) };
    const light = { ...dark, ...vars(/:root\[data-theme="light"\]\{--bg([\s\S]*?)\}/.exec(home)![0]), ...vars(/:root\[data-theme="light"\]\{--sh-bg([\s\S]*?)\}/.exec(home)![0]) };
    for (const [name, t] of [["dark", dark], ["light", light]] as const) for (const fg of ["--sh-scorch", "--dim", "--muted", "--violet", "--ink"]) for (const bg of ["--bg", "--panel"]) {
      const r = ratio(t[fg], t[bg]); assert.ok(r >= 4.5, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
    }
    assert.ok(ratio("#ffffff", "#5b3fa3") >= 4.5, "white on the featured and graduated stamp");
  });
});

describe("the private review: league pages and the footer", () => {
  test("an empty season's explanation sits above the roster; the team deep links stay", () => {
    const p = read("src/app/burnticker/leagues/[league]/[season]/page.tsx");
    assert.ok(p.indexOf("data-league-empty") < p.indexOf('aria-label="teams"'), "the explanation first");
    assert.equal((p.match(/data-league-empty/g) ?? []).length, 1, "printed once");
    assert.match(p, /href=\{t\.launchHref\}/);
  });
  test("the footer keeps every disclosure as one line and a link, the same on the app and the static pages", () => {
    assert.ok(USE_OF_FEES.startsWith(`${DEV_FEE_LINE} `), "the fee row is the use-of-fees paragraph's first line");
    // ninth pass B-26: the use-of-fees paragraph lost its $REHEARSAL clause (the tests are named on the test-coins page), so the footer line is now just over half of it
    assert.ok(DEV_FEE_LINE.length < USE_OF_FEES.length * 0.55);
    const footer = read("src/app/burnticker/_components/SiteFooter.tsx");
    assert.doesNotMatch(footer, /\{USE_OF_FEES\}/, "the long paragraph lives on the Trust page");
    assert.doesNotMatch(footer, /new Date\(\)/);
    for (const k of ["never", "notAdvice", "affiliation", "chain", "sources", "legal"]) assert.match(footer, new RegExp(`FOOTER_COPY\\.${k}`), k);
    for (const r of ["operator", "fees", "api"]) assert.match(footer, new RegExp(`R\\.${r}\\.href`), r);
    const html = shellFooterHtml({ operatorLine: OPERATOR_LINE, feeLine: DEV_FEE_LINE });
    for (const s of [FOOTER_COPY.never, FOOTER_COPY.notAdvice, FOOTER_COPY.affiliation, FOOTER_COPY.chain]) assert.ok(html.includes(s.replace(/'/g, "'")), s.slice(0, 30));
    assert.ok(html.includes(`<span data-fee-line>${DEV_FEE_LINE}</span> <a href="/burnticker/fees/ledger">The fee ledger</a>`));
    assert.ok(html.includes('<a href="/burnticker/trust">What the operator controls</a>'));
    assert.ok(!html.includes("COINS THAT BURN ON REAL-WORLD RESULTS"), "no tagline repeating the hero");
    for (const f of STATIC) { const h = read(f); assert.ok(h.includes(`<span data-fee-line>${DEV_FEE_LINE.replace(/&/g, "&amp;")}</span>`), `${f} fee row`); assert.ok(!h.includes(`${USE_OF_FEES.slice(DEV_FEE_LINE.length + 1, DEV_FEE_LINE.length + 60)}`) || f.includes("whitepaper"), `${f}: no full fee paragraph in the footer`); }
    assert.equal(feeLine(ROOT), DEV_FEE_LINE, "the whitepaper reads the same line");
    // the compact footer (list pages) still links the full slip
    assert.match(footer, /href="\/burnticker#disclosure">Full disclosure/);
  });
});
