// Prelaunch audit 2026-10-18 A-22: no edge cache (every page and API answer `cf-cache-status: DYNAMIC`), the catalogue (192 KB) with no
// Cache-Control, home/launch/404 `private, no-store`, about 30 `?_rsc=` prefetches per coin page view, the review step calling
// /v1/launch/review three times and /v1/sinks five times, and the pair API taking 2.6 to 3.5 s.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { cspHeaderRules } from "@/lib/burnticker/csp";
import { OG_IMAGE_PATH, ogImageHeaderRule } from "@/lib/burnticker/pageMeta";
import { EDGE_JSON_CACHE, EDGE_PAGE_CACHE, EDGE_SLOW_JSON, pageCacheHeaderRules } from "@/lib/burnticker/edgeCache";
import { CATALOGUE_SESSION_MS, keepCatalogue, keptCatalogue, loadCatalogue, reloadCatalogue } from "@/lib/burnticker/catalogueClient";
import { STALE_AFTER_MS as LAUNCH_STATE_STALE_MS } from "@/lib/burnticker/launchAvailability";
import { reviewRequestDue } from "@/lib/burnticker/launchReviewSync";

const read = (f: string) => fs.readFileSync(f, "utf8");
// deploy/cloudflare/CACHE-RULES.md is private (not in the public tree): the public gate skips the assertions that read it
const CF_DOC = "deploy/cloudflare/CACHE-RULES.md";
const sMax = (cc: string) => Number(/s-maxage=(\d+)/.exec(cc)?.[1] ?? NaN);
const swr = (cc: string) => Number(/stale-while-revalidate=(\d+)/.exec(cc)?.[1] ?? 0);
const require_ = createRequire(import.meta.url);
const { pathToRegexp } = require_("next/dist/compiled/path-to-regexp") as { pathToRegexp: (s: string, k: unknown[], o: object) => RegExp };
/** The public next.config's header rules, in order, as Next matches them; the Cache-Control the last matching rule sets, or null. */
const CONFIG_RULES = [...cspHeaderRules(null), ...pageCacheHeaderRules(), ogImageHeaderRule()];
type Req = { headers?: Record<string, string>; query?: Record<string, string> };
const present = (m: { type: string; key: string }, q: Req) => (m.type === "header" ? q.headers?.[m.key] : q.query?.[m.key]) !== undefined;
function configCacheControl(p: string, q: Req = {}): string | null {
  let cc: string | null = null;
  for (const r of CONFIG_RULES as { source: string; has?: { type: string; key: string }[]; missing?: { type: string; key: string }[]; headers: { key: string; value: string }[] }[]) {
    if (!pathToRegexp(r.source, [], { strict: true, sensitive: false, delimiter: "/" }).test(p)) continue;
    if ((r.has ?? []).some((m) => !present(m, q)) || (r.missing ?? []).some((m) => present(m, q))) continue;
    for (const h of r.headers) if (h.key.toLowerCase() === "cache-control") cc = h.value;
  }
  return cc;
}
/** Every route.ts below `dir` as a request path (a [segment] filled with a sample value). */
function walkRoutes(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) return walkRoutes(f);
    return e.name === "route.ts" ? ["/" + path.dirname(f).replace(/^src\/app\//, "").replace(/\[\.\.\.[^\]]+\]/g, "a/b").replace(/\[[^\]]+\]/g, "x1")] : [];
  });
}

describe("A-22: the origin says what an edge may keep", () => {
  test("pages: public, never kept by the browser, at most a minute and a half at the edge", () => {
    assert.match(EDGE_PAGE_CACHE, /^public, max-age=0, /);
    assert.ok(sMax(EDGE_PAGE_CACHE) >= 30 && sMax(EDGE_PAGE_CACHE) <= 60);
    assert.ok(sMax(EDGE_PAGE_CACHE) + swr(EDGE_PAGE_CACHE) <= 90, "a page names /_next/static files a deploy replaces");
    for (const r of pageCacheHeaderRules().filter((x) => !x.has)) assert.deepEqual(r.headers, [{ key: "Cache-Control", value: EDGE_PAGE_CACHE }]);
    const cfg = read("config/public-repo/overlay/next.config.ts");
    assert.match(cfg, /\.\.\.pageCacheHeaderRules\(\)/, "the public app's next.config sends them");
    for (const p of ["/burnticker", "/burnticker/t/DEFICIT", "/burnticker/p/a-vs-b", "/burnticker/privacy", "/burnticker/leagues/nfl/2026", "/burnticker/creator/abc"]) assert.ok(configCacheControl(p), `${p} is a page and is kept`);
  });
  test("review of A-22: no next.config Cache-Control lands on a route handler (in Next 16.4 it would replace the handler's own)", () => {
    // every route.ts under the app, its dynamic segments filled in, through the same path matcher Next uses for config headers
    const routes = [...walkRoutes("src/app/burnticker"), ...walkRoutes("src/app/api/burnticker")];
    assert.ok(routes.length > 40, `${routes.length} route handlers`);
    const hit = routes.filter((p) => configCacheControl(p) !== null && !p.startsWith("/burnticker/brand/"));
    assert.deepEqual(hit, [], "before: /burnticker/embed/*, /burnticker/img/*, sitemap.xml, the league og image and the creator summary got the page header");
    for (const p of ["/burnticker/embed/DEFICIT", "/burnticker/img/receipt/x.png", "/burnticker/sitemap.xml", "/burnticker/leagues/nfl/2026/og", "/burnticker/creator/abc/summary"]) assert.equal(configCacheControl(p), null, p);
    assert.equal(configCacheControl(OG_IMAGE_PATH), "public, max-age=31536000, immutable", "the share image's own rule");
    // review item 3: the launch page (the build it was rendered from, the wizard's plans) keeps Next's private no-store
    assert.equal(configCacheControl("/burnticker/launch"), null);
    assert.ok(configCacheControl("/burnticker/launches-are-not-this"), "only the launch page itself and below are left out");
  });
  test("review item 2: an RSC header without _rsc, or _rsc without the header, is answered no-store (never kept at the edge)", () => {
    for (const p of ["/burnticker", "/burnticker/t/DEFICIT", "/burnticker/t/NOPE404"]) {
      assert.equal(configCacheControl(p, { headers: { rsc: "1" } }), "no-store", `${p} with RSC: 1 and no _rsc (before: the 307 carried the page header)`);
      assert.equal(configCacheControl(p, { query: { _rsc: "abc" } }), "no-store", `${p}?_rsc= without the header`);
      assert.equal(configCacheControl(p, { headers: { rsc: "1" }, query: { _rsc: "abc" } }), EDGE_PAGE_CACHE, `${p}: the router's own request`);
      assert.equal(configCacheControl(p), EDGE_PAGE_CACHE, `${p}: a plain page view`);
    }
    if (!fs.existsSync(CF_DOC)) return;
    const doc = read(CF_DOC);
    assert.ok(doc.includes('not len(http.request.headers["rsc"]) > 0'), "rule 3 keeps RSC requests out");
  });
  test("review item 8: /v1/search is not cached, so the count of searches that found nothing is complete", async () => {
    const { endpoint } = await import("@/lib/burnticker/api/spec");
    assert.equal(endpoint("search").cacheSec, 0, "before: 60 s at the edge and in the browser, and a repeated miss never reached the server");
    assert.match(endpoint("search").description, /Not cached \(no-store\)/);
    assert.match(read("src/lib/burnticker/api/http.ts"), /ep\.cacheSec > 0 \? `public, max-age=\$\{ep\.cacheSec\}[^`]*` : "no-store"/);
  });
  test("review item 4: a 404 from the app is never kept at the edge (the Cloudflare rule's 404 TTL is No store; Caddy leaves the app's 404 untouched)", () => {
    const caddy = read("deploy/caddy/Caddyfile");
    assert.ok(!caddy.includes("@upstream_404"), "the handle_response rewrite was removed on 2026-10-18 (it answered 520 through Cloudflare)");
    if (!fs.existsSync(CF_DOC)) return;
    const doc = read(CF_DOC);
    assert.ok(doc.includes("Status code TTL: 404 = No store"));
    assert.doesNotMatch(doc, /404 pages included|a 404, also `HIT`/, "before: the doc said 404s were kept");
  });

  test("no page reads a cookie or a request header, so a kept page is the same for every visitor", () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(tsx|ts)$/.test(e.name) ? [`${d}/${e.name}`] : []));
    for (const f of walk("src/app/burnticker").filter((f) => /(page|layout)\.tsx$/.test(f))) assert.doesNotMatch(read(f), /from "next\/headers"/, f);
  });
  test("the JSON reads: catalogue, trust, home, tokens, the pair answer, the pinned file", () => {
    assert.ok(sMax(EDGE_SLOW_JSON["cache-control"]) >= 30 && sMax(EDGE_JSON_CACHE["cache-control"]) >= 30);
    assert.match(read("src/app/api/burnticker/catalogue/route.ts"), /\{ headers: EDGE_SLOW_JSON \}/, "before: no Cache-Control at all");
    assert.match(read("src/app/api/burnticker/trust/route.ts"), /"cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120"/);
    assert.match(read("src/app/api/burnticker/trust/ops/route.ts"), /s-maxage=30, stale-while-revalidate=60/);
    for (const f of ["src/app/api/burnticker/home/route.ts", "src/app/api/burnticker/tokens/route.ts"]) assert.match(read(f), /"public, max-age=10, s-maxage=15, stale-while-revalidate=30"/, f);
    assert.match(read("src/app/api/burnticker/pairs/[pairId]/route.ts"), /headers: \{ \.\.\.EDGE_JSON_CACHE, "x-pair-memo": got\.state \}/);
  });
  test("the catalogue's edge minute plus the session copy stay inside the launch state's freshness window", () => {
    assert.ok(sMax(EDGE_SLOW_JSON["cache-control"]) * 1000 + swr(EDGE_SLOW_JSON["cache-control"]) * 1000 + CATALOGUE_SESSION_MS < LAUNCH_STATE_STALE_MS);
  });
  test("the Cloudflare rules file lists the routes and TTLs the owner adds", () => {
    if (!fs.existsSync(CF_DOC)) return;
    const doc = read(CF_DOC);
    for (const s of ["/_next/static/", "/burnticker/embed/", "/api/burnticker/v1/launch/", "Use cache-control header if present", "cf-cache-status"]) assert.ok(doc.includes(s), s);
  });
});

describe("A-22: the client asks less", () => {
  test("the catalogue is read once per session (kept five minutes in session storage); a stale or broken copy is read again", async () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    let calls = 0, now = 1_000_000;
    const f = (async () => { calls++; return new Response(JSON.stringify({ sources: [], launches: {} }), { status: 200 }); }) as typeof fetch;
    reloadCatalogue();
    await loadCatalogue(f, store, () => now);
    reloadCatalogue();   // a new page load in the same tab
    await loadCatalogue(f, store, () => now + 60_000);
    assert.equal(calls, 1, "before: every page load read 190 KB again");
    reloadCatalogue();
    await loadCatalogue(f, store, () => now + CATALOGUE_SESSION_MS);
    assert.equal(calls, 2, "older than the session window: read again");
    reloadCatalogue();
    mem.set("bt-catalogue", "{not json");
    now += 10 * CATALOGUE_SESSION_MS;
    await loadCatalogue(f, store, () => now);
    assert.equal(calls, 3);
    assert.equal(keptCatalogue(null, now), null);
    keepCatalogue({ getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } }, {}, now);
    reloadCatalogue();
  });
  test("the review is asked once per draft revision and retry round", () => {
    assert.equal(reviewRequestDue(null, "r1", 0), true);
    assert.equal(reviewRequestDue({ rev: "r1", retry: 0 }, "r1", 0), false, "before: asked again when the gate finished loading");
    assert.equal(reviewRequestDue({ rev: "r1", retry: 0 }, "r2", 0), true);
    assert.equal(reviewRequestDue({ rev: "r1", retry: 0 }, "r1", 1), true);
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.match(page, /if \(!reviewRequestDue\(reviewAsked\.current, reviewKey, retryN\)\) return;/);
    assert.match(page, /sinksFor\(realNet, \(\) => getJson<\{ sinks: SinkCoin\[\] \}>\(`\$\{V1\}\/sinks\?network=\$\{realNet\}`\)\)/, "the sink list once a minute per network");
  });
  test("footer, legal words and the activity ticker do not prefetch every page they link", () => {
    const footer = read("src/app/burnticker/_components/SiteFooter.tsx");
    assert.equal((footer.match(/<Link /g) ?? []).length, (footer.match(/<Link [^>]*prefetch=\{false\}/g) ?? []).length);
    assert.match(read("src/app/burnticker/_components/LinkedWords.tsx"), /<Link key=\{l\.href\} href=\{l\.href\} prefetch=\{false\}>/);
    assert.match(read("src/app/burnticker/_components/ActivityTicker.tsx"), /href=\{ev\.href\} prefetch=\{false\}/);
  });
  test("the pair answer reads both sides and the derby block together, kept per pair", () => {
    const route = read("src/app/api/burnticker/pairs/[pairId]/route.ts");
    assert.match(route, /await Promise\.all\(\[\s*tokenPageData\(p, a, now\), tokenPageData\(p, b, now\),\s*pair\.selectorKey\.startsWith\("derby:"\)/);
    assert.doesNotMatch(route, /const derby = .*await derbyPairBlock/, "before: the derby block waited for both sides, then read them again");
    assert.match(route, /memoFor\(p\.registry\)\.get\(pairId, version, build\)/);
    assert.match(read("src/app/burnticker/p/[pairId]/page.tsx"), /r\.status === 503 && j\?\.code === "pair-loading" && left > 0/);
  });
});
