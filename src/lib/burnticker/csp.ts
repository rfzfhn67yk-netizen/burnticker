/**
 * THE APP'S CONTENT-SECURITY-POLICY, REPORT-ONLY (ChatGPT audit 7 critical item 4, 2026-10-12: the HTML of a wallet site carried no CSP).
 * The public tree's next.config.ts sends this as Content-Security-Policy-Report-Only on every app page except the embeds (which send their
 * own policy, embed.ts). Report-only changes nothing a visitor sees: the browser reports what an enforced policy would block to
 * /api/burnticker/csp-report, which keeps counts only. docs/burnticker/CSP.md has the steps to switch it to enforcing.
 *
 * Every origin below is one the pages actually use (the inventory in deploy/caddy/csp-and-cache.proposed.caddy, re-checked by
 * test/burntickerCsp.test.ts), plus Cloudflare Web Analytics, whose beacon script and its /cdn-cgi/rum report Cloudflare injects:
 *   script   'self' and inline (Next's bootstrap and the theme boot), the Cloudflare beacon
 *   connect  'self', the Treasury feed the check page reads, the public Solana RPCs (https and wss) the wallet and receipt checks use,
 *            Arweave and Irys (coin images and metadata), the Cloudflare analytics endpoint
 *   img      'self', data:, blob: and any https image (creator images are arbitrary https URLs)
 *   frame    the GeckoTerminal chart on a coin page; nobody may frame these pages
 */
// This file is loaded by next.config.ts, which Next transpiles on its own: it must import NOTHING from the project
// (publish 81, 2026-10-16: a project import here broke the public build with MODULE_NOT_FOUND). Counters live in cspReport.ts.
export const CSP_REPORT_PATH = "/api/burnticker/csp-report";
export const CLOUDFLARE_BEACON = "https://static.cloudflareinsights.com";
export const CLOUDFLARE_RUM = "https://cloudflareinsights.com";

export const APP_CSP_DIRECTIVES: [string, string[]][] = [
  ["default-src", ["'self'"]],
  ["script-src", ["'self'", "'unsafe-inline'", CLOUDFLARE_BEACON]],
  ["style-src", ["'self'", "'unsafe-inline'"]],
  ["font-src", ["'self'", "data:"]],
  ["img-src", ["'self'", "data:", "blob:", "https:"]],
  ["connect-src", ["'self'", "https://api.fiscaldata.treasury.gov", "https://api.devnet.solana.com", "wss://api.devnet.solana.com", "https://api.mainnet-beta.solana.com", "wss://api.mainnet-beta.solana.com", "https://arweave.net", "https://*.arweave.net", "https://gateway.irys.xyz", "https://*.datasprite-cdn.com" /* 2026-10-14: gateway.irys.xyz answers 302 to its CDN; a fetch follows it under this policy */, "https://devnet.irys.xyz", CLOUDFLARE_RUM]],
  ["frame-src", ["https://www.geckoterminal.com"]],
  ["frame-ancestors", ["'none'"]],
  ["base-uri", ["'none'"]],
  ["form-action", ["'self'"]],
  ["object-src", ["'none'"]],
  ["report-uri", [CSP_REPORT_PATH]],
  ["report-to", ["csp"]],
];

/** The policy string, with the host's own RPC origin added to connect-src when it is set (BURNTICKER_PUBLIC_RPC_ORIGIN). */
export function appCsp(extraConnect: string | null = null): string {
  return APP_CSP_DIRECTIVES.map(([d, v]) => `${d} ${(d === "connect-src" && extraConnect && /^https:\/\/[\w.-]+(:\d+)?$/.test(extraConnect) ? [...v, extraConnect] : v).join(" ")}`).join("; ");
}
/** The Reporting API endpoint group the policy's report-to names. */
export const REPORTING_ENDPOINTS = `csp="${CSP_REPORT_PATH}"`;

/** The pages the header is sent on: every app page and the root, never the embeds (embed.ts sends their own policy). */
export const CSP_SOURCES = ["/", "/burnticker", "/burnticker/:path((?!embed(?:/|$)).*)"];

/** The header rules next.config.ts returns from headers(): the report-only policy and the Reporting API endpoint on each source. */
export function cspHeaderRules(rpcOrigin: string | null): { source: string; headers: { key: string; value: string }[] }[] {
  const value = appCsp(rpcOrigin);
  return CSP_SOURCES.map((source) => ({ source, headers: [{ key: "Content-Security-Policy-Report-Only", value }, { key: "Reporting-Endpoints", value: REPORTING_ENDPOINTS }] }));
}

/**
 * THE DIRECTIVE NAMES A REPORT IS COUNTED UNDER (2026-10-16 prelaunch audit F-28: the counter took any directive-shaped name a caller
 * sent, so one script could grow it without limit). CSP Level 3's fetch, document, navigation and reporting directives; any other name
 * a report carries is counted as "other", and a report with none as "unknown".
 */
export const CSP_REPORT_DIRECTIVES: ReadonlySet<string> = new Set([
  "default-src", "child-src", "connect-src", "font-src", "frame-src", "img-src", "manifest-src", "media-src", "object-src", "prefetch-src",
  "script-src", "script-src-elem", "script-src-attr", "style-src", "style-src-elem", "style-src-attr", "worker-src", "fenced-frame-src",
  "base-uri", "sandbox", "form-action", "frame-ancestors", "navigate-to", "require-trusted-types-for", "trusted-types",
  "upgrade-insecure-requests", "block-all-mixed-content", "report-uri", "report-to", "webrtc",
]);
/** A report's directive, for counting: "script-src-elem" from either report format; "unknown" otherwise. Pure. */
export function reportDirective(body: unknown): string {
  const one = (r: unknown): string | null => {
    if (!r || typeof r !== "object") return null;
    const o = r as Record<string, unknown>;
    const inner = (o["csp-report"] ?? o.body ?? o) as Record<string, unknown>;
    const d = inner["effective-directive"] ?? inner.effectiveDirective ?? inner["violated-directive"];
    return typeof d === "string" && /^[a-z-]{3,40}$/.test(d.split(" ")[0]) ? d.split(" ")[0] : null;
  };
  if (Array.isArray(body)) return one(body[0]) ?? "unknown";
  return one(body) ?? "unknown";
}
