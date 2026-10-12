#!/usr/bin/env node
// Regenerates site/burnticker/whitepaper.html from docs/burnticker/WHITEPAPER.md, so the page never drifts from the paper.
// The Markdown is the source of record; the HTML is the B1 thermal-receipt rendering of it (paper slip on the counter surface).
// Handles exactly the subset the paper uses: # / ## / ### headings, paragraphs, - and 1. lists (indented continuation lines),
// pipe tables, fenced code, `code`, **bold**, [text](link). Relative links resolve to the public repository
// (config/burnticker/transparency.json publicRepo.url, else the placeholder TODO_PUBLIC_REPO_URL).
//
//   node scripts/whitepaper-html.mjs            write the page
//   node scripts/whitepaper-html.mjs --check    exit 1 if the committed page differs from a fresh render (test/burntickerWhitepaper.test.ts)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shellHeaderHtml, shellFooterHtml, shellScript, SHELL_CSS } from "../src/lib/burnticker/siteNav.mjs";

/** The trust copy's operator line, verbatim (src/lib/burnticker/trustpack/copy.ts OPERATOR_LINE), for the shared footer receipt. */
export function operatorLine(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  const m = /export const OPERATOR_LINE = "([^"]+)";/.exec(fs.readFileSync(path.join(root, "src/lib/burnticker/trustpack/copy.ts"), "utf8"));
  if (!m) throw new Error("src/lib/burnticker/trustpack/copy.ts: OPERATOR_LINE not found");
  return m[1];
}

/** The app layout's theme boot (src/app/burnticker/_components/theme.ts THEME_BOOT), verbatim: one `bt-theme` preference site-wide. */
const THEME_BOOT_JS = "(function(){try{var t=localStorage.getItem('bt-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();";

export const WHITEPAPER_MD = "docs/burnticker/WHITEPAPER.md";
export const WHITEPAPER_HTML = "site/burnticker/whitepaper.html";
/**
 * WHITEPAPER VERSIONS (ChatGPT chat audit 6, A8, 2026-10-12): whitepaper.html is the CURRENT specification, dated and tied to the public
 * commit it describes (the version notice at the top of WHITEPAPER.md). The first draft, exactly as it stood at the end of 2026-10-10, is
 * a frozen archive: docs/burnticker/WHITEPAPER-2026-10-10.md is that file byte for byte (test/burntickerWebsite12.test.ts pins its
 * SHA-256), rendered at whitepaper-2026-10-10.html under an archive banner the renderer adds. The archive's text is never edited.
 */
export const CURRENT_SPEC = { date: "2026-10-12", publicCommit: "af52b4a4ea0b80168a4c2e0f47a32045d1035c91" };
export const ARCHIVE_MD = "docs/burnticker/WHITEPAPER-2026-10-10.md";
export const ARCHIVE_HTML = "site/burnticker/whitepaper-2026-10-10.html";
export const ARCHIVE_SHA256 = "3c0f0d9aa915fe19a3b2e8ebe8cd8bd11ba36e0f6c454dafd44283e476a7a78b";
/** @type {{ title: string; kicker: string; path: string; source: string; banner: string | null }} */
const CURRENT_OPTS = { title: "Burnticker Whitepaper", kicker: `Technical paper, current specification, ${CURRENT_SPEC.date}`, path: "/whitepaper.html", source: WHITEPAPER_MD, banner: null };
export const ARCHIVE_OPTS = { title: "Burnticker Whitepaper, draft 1 of 2026-10-10 (archive)", kicker: "Technical paper, draft 1, 2026-10-10, archived", path: "/whitepaper-2026-10-10.html", source: ARCHIVE_MD, banner: '<strong>Archived copy.</strong> This is draft 1 of the paper, kept exactly as it stood at the end of 2026-10-10, and it is not updated. Its statements about status, governance, reviews and fees describe that day. The current specification is at <a href="/whitepaper.html">whitepaper.html</a>.' };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = "docs/burnticker/";


export function publicRepoBase(root = ROOT) {
  try {
    const url = JSON.parse(fs.readFileSync(path.join(root, "config/burnticker/transparency.json"), "utf8"))?.publicRepo?.url;
    if (typeof url === "string" && /^https:\/\//.test(url)) return `${url.replace(/\/+$/, "")}/blob/main/`;
  } catch { /* fall through to the placeholder */ }
  return "TODO_PUBLIC_REPO_URL/blob/main/";
}

/** @param {string} mdText @param {string} [repoBase] @param {{ title: string; kicker: string; path: string; source: string; banner: string | null }} [opts] */
export function renderWhitepaper(mdText, repoBase = publicRepoBase(), opts = CURRENT_OPTS) {
const md = mdText.replace(/\r/g, "");
const REPO = repoBase;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function inline(text) {
  const codes = [];
  let t = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = esc(t);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    let h = href;
    if (!/^(https?:|#|\/)/.test(h)) h = REPO + path.posix.normalize(srcDir + h);
    return `<a href="${h}">${label}</a>`;
  });
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
  return t;
}

const lines = md.split("\n");
const body = [];
const toc = [];
// A8: the notices before the first section sit above the contents, so a phone reader sees the version before the long list
const lead = [];
let title = "";
let i = 0;
let sectionOpen = false;
while (i < lines.length) {
  const line = lines[i];
  if (line.startsWith("```")) {
    const buf = [];
    i++;
    while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
    i++;
    body.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
    continue;
  }
  let m;
  if ((m = /^(#{1,3}) (.*)$/.exec(line))) {
    const level = m[1].length;
    const html = inline(m[2]);
    if (level === 1) { title = m[2]; i++; continue; }
    const id = "s-" + slug(html);
    if (level === 2) {
      if (sectionOpen) body.push("</section>");
      body.push(`<section aria-labelledby="${id}">`);
      sectionOpen = true;
      toc.push(`<li><a href="#${id}">${html}</a></li>`);
    }
    body.push(`<h${level} id="${id}">${html}</h${level}>`);
    i++;
    continue;
  }
  if (line.startsWith("|")) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
    const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const head = cells(rows[0]);
    const bodyRows = rows.slice(2).map(cells);
    const th = head.map((c) => `<th scope="col">${inline(c)}</th>`).join("");
    const trs = bodyRows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("\n");
    body.push(`<div class="tbl"><table>\n<thead><tr>${th}</tr></thead>\n<tbody>\n${trs}\n</tbody>\n</table></div>`);
    continue;
  }
  if (/^(- |\d+\. )/.test(line)) {
    const ordered = /^\d+\. /.test(line);
    const items = [];
    while (i < lines.length && (/^(- |\d+\. )/.test(lines[i]) || (/^ {2,}\S/.test(lines[i]) && items.length))) {
      const l = lines[i];
      if (/^(- |\d+\. )/.test(l)) items.push(l.replace(/^(- |\d+\. )/, ""));
      else items[items.length - 1] += " " + l.trim();
      i++;
    }
    const tag = ordered ? "ol" : "ul";
    body.push(`<${tag}>\n${items.map((x) => `<li>${inline(x)}</li>`).join("\n")}\n</${tag}>`);
    continue;
  }
  if (line.trim() === "") { i++; continue; }
  // "> " lines: a boxed notice (audit 4: the historical-version notice at the top of the paper)
  if (/^> /.test(line)) {
    const q = [];
    while (i < lines.length && /^>( |$)/.test(lines[i])) q.push(lines[i++].replace(/^> ?/, "").trim());
    (toc.length ? body : lead).push(`<aside class="notice" role="note"><p>${inline(q.join(" "))}</p></aside>`);
    continue;
  }
  const buf = [];
  while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,3} |```|\||- |\d+\. )/.test(lines[i])) buf.push(lines[i++].trim());
  body.push(`<p>${inline(buf.join(" "))}</p>`);
}
if (sectionOpen) body.push("</section>");

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="Burnticker technical paper: how a settled real-world event becomes a burn on Solana, how a program on Solana settles it on chain, what powers exist, and how anyone can recompute every receipt.">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#1f1c19">
<link rel="canonical" href="https://burnticker.com${opts.path}">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="How a settled real-world result becomes a burn on Solana, what powers exist, and how anyone can recompute every receipt.">
<meta property="og:image" content="https://burnticker.com/brand/og.png">
<meta property="og:url" content="https://burnticker.com${opts.path}">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@BurnTicker">
<meta name="twitter:image" content="https://burnticker.com/brand/og.png">
<link rel="icon" type="image/png" sizes="64x64" href="brand/favicon.png">
<script>${THEME_BOOT_JS}</script>
<style>${SHELL_CSS}</style>
<style>
:root{
  --bg:#1f1c19;--surface:#2a2622;--line:#3a352f;--ink:#f2eee4;--dim:#c9c3b6;--muted:#9a9387;--amber:#ffb000;
  --paper:#f2eee4;--thermal:#1b1916;--faded:#4a443c;--rule:#2a2622;--stamp:#5b3fa3;--paper2:#e8e3d6;--link:#5b3fa3;
  --mono:"Courier Prime",ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif;
}
:root[data-theme="light"]{--bg:#dcd6c8;--surface:#cfc8b8;--line:#bdb5a3;--ink:#1b1916;--dim:#3a352f;--muted:#5d564b;--amber:#9a5b00}
:root[data-theme="dark"]{--bg:#1f1c19;--surface:#2a2622;--line:#3a352f;--ink:#f2eee4;--dim:#c9c3b6;--muted:#9a9387;--amber:#ffb000}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 var(--sans)}
a{color:var(--amber)}
.wrap{max-width:900px;margin:0 auto;padding:0 16px}
.top{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 0;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none}
.brand svg{width:30px;height:30px}
.brand b{font:700 1.05rem/1 var(--mono);letter-spacing:.12em}
.nav{display:flex;gap:6px;flex-wrap:wrap}
.nav a{font:.84rem/1 var(--sans);color:var(--dim);padding:8px 10px;border:1px solid var(--line);border-radius:999px;text-decoration:none;white-space:nowrap}
.nav a:hover{border-color:var(--amber);color:var(--ink)}
.nav a[aria-current="page"]{border-color:var(--amber);color:var(--ink)}
.themebtn{font:1rem/1 var(--sans);color:var(--dim);background:transparent;border:1px solid var(--line);border-radius:999px;width:34px;height:30px;cursor:pointer}
.flinks{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 12px}.flinks a{color:var(--dim)}
.slip{position:relative;background:var(--paper);color:var(--thermal);margin:10px 0 40px;padding:36px 22px 40px;
  background-image:repeating-linear-gradient(0deg,rgba(0,0,0,.025) 0 1px,transparent 1px 3px);
  -webkit-mask:conic-gradient(from -45deg at bottom,#0000,#000 1deg 89deg,#0000 90deg) bottom/14px 51% repeat-x,conic-gradient(from 135deg at top,#0000,#000 1deg 89deg,#0000 90deg) top/14px 51% repeat-x;
  mask:conic-gradient(from -45deg at bottom,#0000,#000 1deg 89deg,#0000 90deg) bottom/14px 51% repeat-x,conic-gradient(from 135deg at top,#0000,#000 1deg 89deg,#0000 90deg) top/14px 51% repeat-x}
@media (min-width:700px){.slip{padding:44px 48px 52px}}
.slip a{color:var(--link)}
.notice{border:2px solid var(--rule);border-left-width:6px;padding:10px 14px;margin:14px 0 18px;background:rgba(0,0,0,.04)}.notice p{margin:0}
.kicker{font:700 .74rem/1.4 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--faded);margin:0 0 6px}
h1{font:700 clamp(1.6rem,4.6vw,2.4rem)/1.15 var(--mono);margin:0 0 14px;letter-spacing:-.01em}
h2{font:700 1.15rem/1.3 var(--mono);letter-spacing:.06em;text-transform:uppercase;margin:0 0 12px;padding-top:14px;border-top:2px dashed var(--rule)}
h3{font:700 1rem/1.35 var(--mono);margin:22px 0 8px}
section{margin:30px 0 0}
p,li{max-width:72ch}
p{margin:0 0 12px}
ul,ol{margin:0 0 14px;padding-left:22px}
li{margin:0 0 6px}
code{font:.86em var(--mono);background:var(--paper2);padding:1px 4px;border-radius:3px;overflow-wrap:anywhere}
pre{font:.8rem/1.5 var(--mono);background:var(--thermal);color:var(--paper);padding:14px;border-radius:4px;overflow-x:auto;margin:0 0 14px}
pre code{background:none;padding:0;color:inherit;overflow-wrap:normal;white-space:pre}
.tbl{overflow-x:auto;margin:0 0 16px;border:1px solid #d6d0c2}
table{border-collapse:collapse;width:100%;font-size:.86rem}
th,td{text-align:left;vertical-align:top;padding:7px 9px;border-bottom:1px dashed #b9b2a3}
th{font:700 .74rem/1.3 var(--mono);letter-spacing:.06em;text-transform:uppercase;background:var(--paper2)}
td code{font-size:.82em}
.toc{border:2px dashed var(--rule);padding:12px 16px 4px;margin:18px 0 6px}
.toc p{font:700 .74rem/1.4 var(--mono);letter-spacing:.14em;text-transform:uppercase;margin:0 0 6px}
.toc ul{columns:2 220px;margin:0 0 8px;padding:0;list-style:none}
.toc li{margin:0 0 4px;break-inside:avoid}
.stamp{display:inline-block;transform:rotate(-4deg);color:var(--stamp);border:2px solid var(--stamp);border-radius:3px;padding:2px 8px;font:700 .8rem/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;margin:4px 0 14px;opacity:.85}
footer{padding:0 0 40px;color:var(--muted);font-size:.84rem}
footer p{margin:0 0 6px;max-width:none}
</style>
</head>
<body>
${shellHeaderHtml({ current: "/whitepaper.html" })}
<main class="wrap" id="main">
<article class="slip">
${opts.banner ? `<aside class="notice" role="note" data-archive><p>${opts.banner}</p></aside>\n` : ""}<p class="kicker">${esc(opts.kicker)}</p>
<h1>${inline(title)}</h1>
<p class="stamp">Not audited by a security firm</p>
${lead.join("\n")}
<nav class="toc" aria-label="Contents">
<p>Contents</p>
<ul>
${toc.join("\n")}
</ul>
</nav>
${body.join("\n")}
</article>
</main>
<footer class="wrap">
  <p>Source of this page: <code>${opts.source}</code>.</p>
</footer>
${shellFooterHtml({ current: "/whitepaper.html", operatorLine: operatorLine() })}
<script>
${shellScript()}
</script>
</body>
</html>
`;
return page;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let stale = false;
  for (const [src, dst, opts] of [[WHITEPAPER_MD, WHITEPAPER_HTML, CURRENT_OPTS], [ARCHIVE_MD, ARCHIVE_HTML, ARCHIVE_OPTS]]) {
    const page = renderWhitepaper(fs.readFileSync(path.join(ROOT, src), "utf8"), publicRepoBase(), opts);
    const out = path.join(ROOT, dst);
    if (process.argv.includes("--check")) {
      const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
      if (current !== page) { console.error(`${dst} is out of date: run node scripts/whitepaper-html.mjs`); stale = true; } else console.log(`${dst} matches ${src}`);
    } else {
      fs.writeFileSync(out, page);
      console.log(`wrote ${dst} (${page.length} bytes) from ${src}`);
    }
  }
  if (stale) process.exit(1);
}
