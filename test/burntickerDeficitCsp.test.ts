// B-18 (seventh prelaunch audit, 2026-10-20): deficit.burnticker.com read its data from `?data=<base>`, which kept `//host/`, so anyone
// could make the official page show their own mint and trade links; hrefs from the data files took `javascript:`; the host sent no CSP.
// Now only `?data=sample/` is accepted, data-file hrefs must be plain https, and Caddy sends an enforced CSP on the $DEFICIT host
// whose connect-src is the page's own origin, burnticker.com and the Treasury. The auditor's test is test/audit7ApiDeficitDataParam.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("../site/deficit/index.html", import.meta.url), "utf8");
const pick = (re: RegExp) => { const m = re.exec(page); assert.ok(m, `pattern ${re} found`); return m![0]; };
const baseLine = pick(/var base = \(new URLSearchParams\(location\.search\)\.get\("data"\) \|\| ""\)\.replace\([^;]+;/);
const baseOf = (search: string): string => (new Function("location", `${baseLine}\nif (base && !/\\/$/.test(base)) base += "/";\nreturn base;`) as (l: { search: string }) => string)({ search });

test("?data= accepts only the committed sample folder; every other host, scheme or encoding is dropped", () => {
  assert.equal(baseOf(""), "");
  assert.equal(baseOf("?data=sample/"), "sample/");
  assert.equal(baseOf("?data=sample"), "sample/");
  for (const evil of ["//evil.example/", "%2F%2Fevil.example%2F", "/\\evil.example/", "\\\\evil.example\\", "https://evil.example/", "javascript:alert(1)//", "sample/../../x/", "sample/%2F%2Fevil", "./sample/", "sample//evil.example/", "Sample/", "sample/\n//evil.example/"]) {
    const base = baseOf(`?data=${evil.includes("%") ? evil : encodeURIComponent(evil)}`);
    assert.equal(base, "", `${JSON.stringify(evil)} gave ${JSON.stringify(base)}`);
    assert.equal(new URL(base + "status.json", "https://deficit.burnticker.com/").host, "deficit.burnticker.com");
  }
});

test("hrefs built from the data files are plain https or not links at all", () => {
  const escSrc = pick(/var esc = function \(s\) \{[^\n]+/);
  const hrefSrc = pick(/var href = function \(u\) \{[^\n]+/);
  const href = new Function(`${escSrc}\n${hrefSrc}\nreturn href;`)() as (u: unknown) => string;
  assert.equal(href("https://solscan.io/tx/abc"), "https://solscan.io/tx/abc");
  for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "data:text/html,x", "//evil.example/x", "http://solscan.io/tx/abc", "https://x\" onmouseover=\"y", null, undefined, 5]) assert.equal(href(bad), "", String(bad));
  // every href the data-driven blocks write goes through href() or link() (or is a fixed same-page anchor or a built trade link)
  const writes = page.match(/href="' \+ esc\([^)]*\)/g) ?? [];
  for (const w of writes) assert.match(w, /esc\((href\(|url\)$|counted\()/, `unchecked href: ${w}`);
});

test("the $DEFICIT host and /deficit/ send an enforced CSP that covers what the page loads and nothing else", { skip: !fs.existsSync(new URL("../deploy/caddy/Caddyfile", import.meta.url)) }, () => {
  const caddy = fs.readFileSync(new URL("../deploy/caddy/Caddyfile", import.meta.url), "utf8");
  const policy = /\(deficit_csp\) \{\s*header Content-Security-Policy "([^"]+)"/.exec(caddy)?.[1];
  assert.ok(policy, "the deficit_csp snippet sends an enforced policy");
  const dir = (name: string) => (policy!.split(";").map((s) => s.trim().split(/\s+/)).find((p) => p[0] === name) ?? []).slice(1);
  assert.match(/\{\$DEFICIT_DOMAIN:deficit\.burnticker\.com\} \{[^}]*import deficit_csp/.exec(caddy)?.[0] ?? "", /import deficit_csp/, "on the $DEFICIT host");
  assert.match(/handle_path \/deficit\/\* \{[^}]*\}/.exec(caddy)?.[0] ?? "", /import deficit_csp/, "on burnticker.com/deficit/");
  assert.deepEqual(dir("frame-ancestors"), ["'none'"]); assert.deepEqual(dir("object-src"), ["'none'"]); assert.deepEqual(dir("base-uri"), ["'none'"]);
  const connect = dir("connect-src");
  assert.ok(!connect.includes("https:") && !connect.includes("*"), "connect-src lists hosts");
  for (const m of page.matchAll(/fetch\(\s*"(https:\/\/[^/"]+)/g)) assert.ok(connect.includes(m[1]), `connect-src allows ${m[1]}`);
  for (const m of page.matchAll(/var \w+ = "(https:\/\/[^/"]+)\/[^"]*";/g)) if (/treasury/.test(m[1])) assert.ok(connect.includes(m[1]), m[1]);
  const img = dir("img-src");
  for (const m of page.matchAll(/<img[^>]+src="(https:\/\/[^/"]+)/g)) assert.ok(img.includes(m[1]), `img-src allows ${m[1]}`);
  const font = dir("font-src");
  for (const m of page.matchAll(/src:url\("(https:\/\/[^/"]+)/g)) assert.ok(font.includes(m[1]), `font-src allows ${m[1]}`);
  assert.ok(font.includes("https://fonts.gstatic.com") && dir("style-src").includes("https://fonts.googleapis.com"), "Oswald from Google Fonts");
  assert.doesNotMatch(page, /<script[^>]+src=/, "the page loads no script file, so script-src needs no host of its own");
});
