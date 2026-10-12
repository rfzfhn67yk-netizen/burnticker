// THE SHARED LINK SET INTO THE STATIC PAGES (site audit #6/#13, R06, BT-22, 2026-10-11). The hand-written static pages carry marked
// regions — <!-- site-nav:NAME:begin --> … <!-- site-nav:NAME:end --> — and this script fills each one from src/lib/burnticker/siteNav.mjs,
// so the home, the status page and the $DEFICIT site print the same links in the same order as the app header and the whitepaper.
//
//   node --import ./test/alias-hook.mjs scripts/burnticker-site-nav.mts [--write|--check]
//
// test/burntickerSiteNav.test.ts runs the check.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteNavHtml, SITE_ORIGIN } from "../src/lib/burnticker/siteNav.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every marked region: file, region name, render options. */
export const REGIONS: { file: string; name: string; opts: Parameters<typeof siteNavHtml>[0] }[] = [
  { file: "site/burnticker/index.html", name: "header", opts: { indent: "      " } },
  { file: "site/burnticker/index.html", name: "menu", opts: { indent: "          " } },
  { file: "site/burnticker/index.html", name: "footer", opts: { footer: true, indent: "    " } },
  { file: "site/burnticker/status/index.html", name: "footer", opts: { origin: SITE_ORIGIN, footer: true, indent: "    " } },
  { file: "site/deficit/index.html", name: "sitebar", opts: { origin: SITE_ORIGIN, self: "https://deficit.burnticker.com/", indent: "    " } },
  { file: "site/deficit/index.html", name: "footer", opts: { origin: SITE_ORIGIN, self: "https://deficit.burnticker.com/", footer: true, indent: "    " } },
];

export function renderRegions(read: (f: string) => string = (f) => fs.readFileSync(path.join(ROOT, f), "utf8")): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of REGIONS) {
    const src = out.get(r.file) ?? read(r.file);
    const re = new RegExp(`(<!-- site-nav:${r.name}:begin -->)[\\s\\S]*?(\\n[ \\t]*<!-- site-nav:${r.name}:end -->)`);
    if (!re.test(src)) throw new Error(`${r.file}: no <!-- site-nav:${r.name}:begin/end --> region`);
    out.set(r.file, src.replace(re, (_m, a: string, b: string) => `${a}\n${siteNavHtml(r.opts)}${b}`));
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
