// THE ONE SHELL INTO THE STATIC PAGES (site audit #6/#13, R06, BT-22, 2026-10-11; the whole shell since website-10, 2026-10-12). The
// hand-written static pages carry marked regions — <!-- site-shell:NAME:begin --> … <!-- site-shell:NAME:end --> — and this script fills
// each one from src/lib/burnticker/siteNav.mjs, so the home, the status page, the fallback page and the $DEFICIT site print the same
// header (search, "Launch a coin", the disabled wallet button, the activity line), the same footer receipt, the same phone tab bar,
// styles and script as the app and the whitepaper.
//
//   node --import ./test/alias-hook.mjs scripts/burnticker-site-nav.mts [--write|--check]
//
// test/burntickerSiteNav.test.ts runs the check.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shellHeaderHtml, shellFooterHtml, shellScript, shellFontCss, SHELL_CSS, SITE_ORIGIN, HERO, HOW_IT_WORKS, FIRST_USE, TWO_PATHS, WALKTHROUGH_LINK, createPathFor } from "../src/lib/burnticker/siteNav.mjs";
import { deficitQueueCore } from "../src/lib/burnticker/deficitQueueCore.mjs";
import { cardAge } from "../src/lib/burnticker/cardAge.mjs";
import { OPERATOR_LINE } from "../src/lib/burnticker/trustpack/copy.ts";
import { DEV_FEE_LINE } from "../src/lib/burnticker/fees.ts";
import { prerequisiteLineFor } from "../src/lib/burnticker/launchReview.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The home's hero and "How it works" strip, from the same words the app prints. On phones the strip collapses to its three step titles
 * (the home page's CSS hides the sentences under 640 px) so the first card and the search sit in the first screen (Codex review 5
 * trader-2); "What these words mean" opens the plain meanings on demand (FIRST_USE).
 */
export function heroHtml(): string {
  const createLoading = createPathFor(null);
  return [
    `<section class="hero wrap" aria-labelledby="hero-h">`,
    `  <h1 id="hero-h">${esc(HERO.title)}</h1>`,
    `  <p class="sub">${esc(HERO.sub)}</p>`,
    // website-14 (product idea 1): two paths on arrival, one sentence each; "Create a coin" opens the closed-launches dialog while closed
    `  <div class="paths" data-two-paths>`,
    // audit 10 item 23: while creator launches are closed the create path reads "Preview a coin launch" with the site launch record's own
    // sentence beside it (siteNav.mjs createPathFor); printed closed here, the shell script fills it from GET /api/burnticker/home
    `    <a class="path path-explore" href="${TWO_PATHS[0].href}"><span class="path-t">${esc(TWO_PATHS[0].label)}</span><span class="path-x">${esc(TWO_PATHS[0].text)}</span></a>`,
    `    <a class="path path-create" href="${TWO_PATHS[1].href}" data-launch-button data-create-path><span class="path-t" data-create-label>${esc(createLoading.label)}</span><span class="path-x" data-create-text>${esc(createLoading.text)}</span></a>`,
    // the status line is empty until the record is read (the home's word budget, test/burntickerHome.test.ts), then the record's sentence
    `    <p class="path-status" data-create-status role="status" hidden></p>`,
    `  </div>`,
    `  <p class="walk"><a href="${WALKTHROUGH_LINK.href}">${esc(WALKTHROUGH_LINK.label)}</a>. ${esc(WALKTHROUGH_LINK.text)}</p>`,
    `</section>`,
    `<section class="wrap how-wrap" aria-label="How it works">`,
    `  <ol class="how">`,
    // step 2 carries the first-burn prerequisite (website-12's launchReview.ts prerequisiteLineFor, from the configured raise)
    // website-15 item 14: each step is a disclosure (title, chevron, one line); phones start it closed, wide screens keep it open
    ...HOW_IT_WORKS.map((h: { title: string; text: string; line: string }, i: number) => `    <li><details class="how-d" open><summary><span class="how-n" aria-hidden="true">${i + 1}</span><span class="how-t">${esc(h.title)}</span><span class="how-chev" aria-hidden="true"></span><span class="how-line" aria-hidden="true">${esc(h.line)}</span></summary><div class="how-b"><p class="how-x">${esc(h.text)}</p>${i === 1 ? `<p class="how-x how-pre" data-prerequisite>${esc(prerequisiteLineFor("launchlab"))}</p>` : ""}</div></details></li>`),
    `  </ol>`,
    `  <div class="how-more"><a href="/burnticker/about">Read how it works in full</a><details class="terms"><summary>What these words mean</summary><dl>`,
    ...FIRST_USE.map((t: { term: string; meaning: string }) => `    <div><dt>${esc(t.term)}</dt><dd>${esc(t.meaning)}</dd></div>`),
    `  </dl></details></div>`,
    `</section>`,
  ].join("\n");
}

type Region = { file: string; name: string; render: () => string };
const shell = (file: string, origin: string): Region[] => [
  { file, name: "css", render: () => `<style>${shellFontCss(origin)}\n${SHELL_CSS}</style>` },
  { file, name: "header", render: () => shellHeaderHtml({ origin }) },
  { file, name: "footer", render: () => shellFooterHtml({ origin, operatorLine: OPERATOR_LINE, feeLine: DEV_FEE_LINE }) },
  { file, name: "script", render: () => `<script>\n${shellScript({ origin })}\n</script>` },
];

/**
 * The $DEFICIT site's queued-units counter (website-14, LAUNCHPAD-PATH §73): the SAME function the app runs (deficitQueueCore.mjs),
 * written into the page as source so the static site and the app cannot say different things. test/burntickerWebsite14.test.ts runs
 * both on the same keeper files.
 */
export function deficitQueueScript(): string {
  return `<script>\nwindow.deficitQueueCore = ${deficitQueueCore.toString()};\n</script>`;
}

/**
 * The card age (ChatGPT audit 6 item 23): the SAME function the app's cards run (cardAge.mjs), written into the home page as source, so
 * the static home and /burnticker cannot print different ages for one coin.
 */
export function cardAgeScript(): string {
  return `<script>\nwindow.btCardAge = ${cardAge.toString()};\n</script>`;
}

/** Every marked region: file, region name, renderer. */
export const REGIONS: Region[] = [
  ...shell("site/burnticker/index.html", ""),
  { file: "site/burnticker/index.html", name: "hero", render: heroHtml },
  { file: "site/burnticker/index.html", name: "age-core", render: cardAgeScript },
  ...shell("site/burnticker/status/index.html", SITE_ORIGIN),
  ...shell("site/burnticker/fallback/index.html", ""),
  ...shell("site/deficit/index.html", SITE_ORIGIN),
  { file: "site/deficit/index.html", name: "queue-core", render: deficitQueueScript },
];

export function renderRegions(read: (f: string) => string = (f) => fs.readFileSync(path.join(ROOT, f), "utf8")): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of REGIONS) {
    const src = out.get(r.file) ?? read(r.file);
    const re = new RegExp(`(<!-- site-shell:${r.name}:begin -->)[\\s\\S]*?(<!-- site-shell:${r.name}:end -->)`);
    if (!re.test(src)) throw new Error(`${r.file}: no <!-- site-shell:${r.name}:begin/end --> region`);
    out.set(r.file, src.replace(re, (_m, a: string, b: string) => `${a}\n${r.render()}\n${b}`));
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes("--write");
  let stale = 0;
  for (const [f, text] of renderRegions()) {
    const cur = fs.readFileSync(path.join(ROOT, f), "utf8");
    if (cur === text) { console.log(`${f}: current`); continue; }
    if (write) { fs.writeFileSync(path.join(ROOT, f), text); console.log(`wrote ${f}`); } else { console.error(`${f}: out of date (run with --write)`); stale++; }
  }
  if (stale) process.exit(1);
}
