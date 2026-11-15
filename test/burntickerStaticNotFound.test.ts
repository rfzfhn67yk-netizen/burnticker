// Audit 2026-10-19 polish P-2: a path outside /burnticker/ that does not exist answered a 0-byte white page from Caddy's static site.
// The static site now has a 404 page and an error page in the site's style (the shared shell, the B1 slip), linking home and to
// /burnticker; Caddy serves them from handle_errors with the real status, and deploy-sites.sh ships them with the fallback.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { renderRegions } from "../scripts/burnticker-site-nav.mts";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ");
const PAGES = [
  { file: "site/burnticker/notfound/index.html", title: /<title>Burnticker: page not found<\/title>/, says: /There is no page at this address\. The link may have a typo, or the page may have moved\./ },
  { file: "site/burnticker/error/index.html", title: /<title>Burnticker: page could not be shown<\/title>/, says: /Something went wrong while this page was being sent\. Try again in a moment\./ },
];

describe("P-2: the static 404 and error pages", () => {
  for (const p of PAGES) {
    test(`${p.file}: the site's shell and slip, links home and to /burnticker, noindex, copy lint clean`, () => {
      const html = read(p.file);
      assert.match(html, p.title);
      assert.match(visible(html), p.says);
      assert.match(html, /<meta name="robots" content="noindex">/);
      const main = html.slice(html.indexOf('<main class="wrap" id="main">'), html.indexOf("</main>"));
      assert.match(main, /<a href="\/">/); assert.match(main, /<a href="\/burnticker">/);
      for (const r of ["css", "header", "footer", "script"]) assert.ok(html.includes(`<!-- site-shell:${r}:begin -->`), `${r} region`);
      assert.equal(renderRegions().get(p.file), html, "the shell regions are current (scripts/burnticker-site-nav.mts --write)");
      const landing = read("site/burnticker/index.html");
      assert.ok(landing.includes(html.slice(html.indexOf(":root{"), html.indexOf("/* END shared tokens */"))), "the landing's tokens, verbatim");
      assert.doesNotMatch(html, /fetch\("\/\.well-known|getElementById\("programs"\)/, "the fallback's own reads are not copied");
      const lint = lintCopy(visible(html), loadCopyLintConfig(ROOT));
      assert.equal(lint.hits.length, 0, JSON.stringify(lint.hits));
    });
  }

  test("it renders: served the way Caddy serves it (an unknown path gets the 404 page with status 404, a real file is untouched)", async () => {
    // a stand-in for the static site block plus handle_errors: try the file, else the 404 page with status 404
    const www = path.join(ROOT, "site", "burnticker");
    const server = http.createServer((req, res) => {
      const p = path.join(www, decodeURIComponent((req.url ?? "/").split("?")[0]));
      const file = p.startsWith(www) && fs.existsSync(p) && fs.statSync(p).isFile() ? p : null;
      if (file) { res.writeHead(200, { "content-type": "text/html" }); res.end(fs.readFileSync(file)); return; }
      res.writeHead(404, { "content-type": "text/html", "cache-control": "no-store" }); res.end(fs.readFileSync(path.join(www, "notfound", "index.html")));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const nope = await fetch(`${base}/nope`);
      assert.equal(nope.status, 404);
      const body = await nope.text();
      assert.ok(body.length > 1000, "never a 0-byte white page");
      assert.match(body, /There is no page at this address/);
      assert.equal((await fetch(`${base}/whitepaper.html`)).status, 200);
    } finally { server.close(); }
  });

  test("Caddy serves them from handle_errors, after the app's fallbacks, never for an API path; deploy-sites ships them", () => {
    const caddy = read("deploy/caddy/Caddyfile").replace(/^\s*#.*$/gm, "");
    const errs = caddy.slice(caddy.indexOf("handle_errors {"));
    assert.match(errs, /@app_down[\s\S]*@static_404 \{\s*expression \{err\.status_code\} == 404\s*not path \/api\/burnticker\/\*\s*\}\s*handle @static_404 \{\s*import security\s*root \* \/var\/www\/burnticker\/notfound\s*rewrite \* \/index\.html\s*header Cache-Control "no-store"\s*file_server \{\s*status 404\s*\}/);
    assert.match(errs, /@static_err not path \/api\/burnticker\/\*\s*handle @static_err \{\s*import security\s*root \* \/var\/www\/burnticker\/error\s*rewrite \* \/index\.html[\s\S]*status \{err\.status_code\}/);
    assert.match(read("scripts/ops/deploy-sites.sh"), /for p in status fallback notfound error; do/);
    assert.match(read("scripts/burnticker-site-nav.mts"), /shell\("site\/burnticker\/notfound\/index\.html", ""\)/);
  });
});
