/**
 * WHAT A CDN MAY KEEP (prelaunch audit 2026-10-18 A-22). Every production sample was `cf-cache-status: DYNAMIC`: the app pages were
 * `private, no-store` (Next's header for a dynamic page), the catalogue sent no Cache-Control, and the GET routes that did send one
 * were not matched by any Cloudflare cache rule. These are the headers the origin now sends; deploy/cloudflare/CACHE-RULES.md lists the
 * rules the owner adds in the dashboard so Cloudflare honours them.
 *
 * Nothing here is per visitor: no page reads a cookie or a header, and every per-visitor detail (the theme, the watchlist, the wallet)
 * is read in the browser. An answer that must never be kept (a POST, an error, a signing step, the coin route's own memo) says
 * `no-store` where it is made.
 *
 *   EDGE_PAGE_CACHE  the app's HTML pages: 30 s at the edge, one more minute served stale while it refreshes, never kept by the
 *                    browser (a page names /_next/static files a deploy replaces). Next sends it on a page that answers 404 too, and it
 *                    cannot tell that apart here; Caddy rewrites every 404 from the app to no-store (deploy/caddy/Caddyfile
 *                    @upstream_404, review item 4) and the Cloudflare rule's 404 status-code TTL is "No store".
 *   EDGE_JSON_CACHE  public JSON reads that may lag half a minute (the pair answer, the trust page's operations)
 *   EDGE_SLOW_JSON   reads that change with a deploy or an env change, not with trading (the catalogue)
 */
export const EDGE_PAGE_CACHE = "public, max-age=0, s-maxage=30, stale-while-revalidate=60";
export const EDGE_JSON_CACHE = { "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60" } as const;
export const EDGE_SLOW_JSON = { "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" } as const;
export const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * next.config `headers()` rules for the app's pages. Next keeps a Cache-Control a config rule set on a dynamic page (it fills in its
 * own `private, no-store` only when none is set) and still answers its own errors (500) with no-store.
 *
 * ROUTE HANDLERS ARE LEFT OUT (review of A-22, 2026-10-18). In Next 16.4 the config headers are written onto the response FIRST and a
 * route handler's own headers are added only when the response does not have them yet, so a config Cache-Control REPLACES the
 * handler's: the embeds' no-store 404s, the image routes' immutable day, the sitemap's ten minutes. Every route handler under
 * /burnticker is therefore excluded from the page rule by path (test/burntickerEdgeCache.test.ts walks every route.ts and fails when
 * the rule matches one), and so are the brand files (static files with their own rule).
 *
 * /burnticker/launch IS LEFT OUT TOO (review item 3): it carries the build it was rendered from for the version notice (VersionCheck)
 * and the wizard's plans, so it keeps Next's own `private, no-store`. Deploys: scripts/ops/swap-web-build.sh keeps the previous build's
 * /_next/static files in the new build, so a page the edge kept from before a deploy still loads its chunks.
 */
export const PAGE_CACHE_SOURCES = [
  "/burnticker",
  "/burnticker/:path((?!(?:embed|img|brand|launch|go)(?:/|$)|sitemap\\.xml$|leagues/[^/]+/[^/]+/og$|creator/[^/]+/summary$).*)",
] as const;
type HeaderMatch = { type: "header" | "query"; key: string };
export interface HeaderRule { source: string; has?: HeaderMatch[]; missing?: HeaderMatch[]; headers: { key: string; value: string }[] }

/**
 * NO MIXED RSC ANSWER IS EVER KEPT (review of A-22, item 2). A CDN keys on the URL and ignores `Vary`, and Next tells an HTML request
 * from a client-navigation (RSC) request by the `RSC` header, with the `_rsc` query value as the cache key that keeps them apart. A
 * request that carries one without the other is not one the app's own router sends: `GET /burnticker` with `RSC: 1` and no `_rsc`
 * gets a 307 to `?_rsc=…` (and a 404 skips that check), and `?_rsc=…` without the header gets HTML under the RSC key. Either answer,
 * kept at the edge, would be served to the next visitor of that URL. These two rules come after the page rule (a later rule wins) and
 * make such an answer `no-store` whatever the Cloudflare rules say; CACHE-RULES.md also keeps RSC requests out of the edge cache.
 */
export const RSC_GUARD_SOURCES = ["/burnticker", "/burnticker/:path*"] as const;
export function rscGuardHeaderRules(): HeaderRule[] {
  const noStore = [{ key: "Cache-Control", value: "no-store" }];
  return RSC_GUARD_SOURCES.flatMap((source) => [
    { source, has: [{ type: "header" as const, key: "rsc" }], missing: [{ type: "query" as const, key: "_rsc" }], headers: noStore },
    { source, has: [{ type: "query" as const, key: "_rsc" }], missing: [{ type: "header" as const, key: "rsc" }], headers: noStore },
  ]);
}

/** The page rule, then the RSC guard (order matters: the guard must win). */
export function pageCacheHeaderRules(): HeaderRule[] {
  return [...PAGE_CACHE_SOURCES.map((source) => ({ source, headers: [{ key: "Cache-Control", value: EDGE_PAGE_CACHE }] })), ...rscGuardHeaderRules()];
}
