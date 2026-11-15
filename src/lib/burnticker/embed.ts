import { utcDateTime } from "@/lib/burnticker/utcWords";
import crypto from "node:crypto";
import { BADGE_CACHE_SEC, renderBadgeSvg, type BadgeJson } from "@/lib/burnticker/badge";

/**
 * THE EMBED PAGE (growth batch 2026-10-10): /burnticker/embed/<TICKER> and /burnticker/embed/pairs/<pairId> — the receipt card
 * (badge.ts, the same SVG the badge endpoint serves) plus a live "next settlement" line, as one self-contained HTML document that any
 * site may put in an iframe. It is a route handler, not a page, so the app's header, footer, tab bar, fonts and scripts never load:
 *
 *   · CSP: default-src 'none'; the one inline style and the one inline script allowed by their sha256; frame-ancestors * (any site may
 *     frame it); base-uri / form-action 'none'.
 *   · no cookies are read or set; Referrer-Policy no-referrer; links open in a new tab with rel="noopener".
 *   · cached 60 s; the script re-renders the countdown each second and reloads the document every 60 s (a fresh card).
 *
 * Caddy's `security` snippet sends X-Frame-Options DENY for the app; the embed paths are served through `security_embed` instead
 * (deploy/caddy/Caddyfile), which keeps every other header and drops only that one.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export const EMBED_STYLE = [
  ":root{color-scheme:light dark}",
  "html,body{margin:0;padding:0;background:transparent}",
  "body{font:13px/1.4 'Courier Prime','Courier New',ui-monospace,monospace;color:#1b1916}",
  ".bt-e{max-width:480px}",
  ".bt-e a.card{display:block;line-height:0}",
  ".bt-e svg{width:100%;height:auto;display:block}",
  ".bt-e .next{margin:6px 2px 0;padding:6px 10px;background:#f2eee4;border:1px dashed #5a5248;border-radius:4px}",
  ".bt-e .next b{font-weight:700}",
  ".bt-e .foot{margin:4px 2px 0;font-size:10.5px;color:#8b8478}",
  ".bt-e .foot a{color:inherit}",
  "@media (prefers-color-scheme:dark){.bt-e .foot{color:#aba395}}",
].join("");

/**
 * Writes each [data-local] time in the reader's own clock and reloads the document every 60 s. No countdown (prelaunch audit
 * 2026-10-18, A-26: the time is usually the keeper's next read of the source, not a settlement, so nothing ticks toward it). No
 * network call of its own.
 */
export const EMBED_SCRIPT = [
  "(function(){",
  "try{var w=document.querySelectorAll('[data-local]');for(var j=0;j<w.length;j++){var x=new Date(w[j].getAttribute('data-local'));",
  "if(!isNaN(x))w[j].textContent=x.toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});}}catch(e){}",
  `setTimeout(function(){location.reload();},${BADGE_CACHE_SEC * 1000});`,
  "})();",
].join("");

const sha = (s: string) => `'sha256-${crypto.createHash("sha256").update(s, "utf8").digest("base64")}'`;
export const EMBED_CSP = `default-src 'none'; img-src 'self' data:; style-src ${sha(EMBED_STYLE)}; script-src ${sha(EMBED_SCRIPT)}; frame-ancestors *; base-uri 'none'; form-action 'none'`;

export const EMBED_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": EMBED_CSP,
  "cache-control": `public, max-age=${BADGE_CACHE_SEC}, s-maxage=${BADGE_CACHE_SEC}, stale-while-revalidate=${BADGE_CACHE_SEC}`,
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "cross-origin",
  "x-robots-tag": "noindex",
};

/**
 * The line under the card (server-rendered; the script rewrites the time in the reader's clock). It says what the time is: the
 * keeper's next read of the source, or a market close the venue lists. Never a countdown, and a time already past says it is overdue
 * (prelaunch audit 2026-10-18, A-26). `before` and `after` surround the time; with no time, `before` is the whole line.
 */
/** The line with no time, by the badge's note (HB-28: a decided or voided one-shot says its result is in and no read is due). */
export const NO_NEXT_LINES: Readonly<Record<string, string>> = {
  "resolves once": "This rule resolves once.",
  "result decided": "This coin's one result is in, so no further read is due.",
  "result voided": "This coin's result was voided, so no further read is due.",
};
export function nextLine(b: Pick<BadgeJson, "nextSettlementAt" | "nextSettlementNote">, nowMs: number): { before: string; at: string | null; utc: string | null; after: string } {
  if (!b.nextSettlementAt) return { before: NO_NEXT_LINES[b.nextSettlementNote] ?? "No result is scheduled.", at: null, utc: null, after: "" };
  const past = Date.parse(b.nextSettlementAt) <= nowMs, close = /market close/.test(b.nextSettlementNote);
  const before = close ? (past ? "The market was scheduled to close on " : "The market is scheduled to close on ") : (past ? "This site was due to read the source on " : "This site next reads the source on ");
  const after = close ? (past ? ". The result counts once the source settles it." : ".") : (past ? ", and that read is overdue." : ".");
  return { before, at: b.nextSettlementAt, utc: utcDateTime(b.nextSettlementAt), after };
}

/** The whole embed document. Every visible word is the card's lines plus the next-settlement line and the footer (all linted in tests). */
export function renderEmbedHtml(b: BadgeJson, nowMs: number): string {
  const n0 = nextLine(b, nowMs);
  // HB-80 / HS-27 (hourly run 5): a decided pair coin's embed says the same won-or-lost line as its creator card and home row
  const decided = b.kind === "coin" ? b.decided ?? null : [b.a, b.b].filter((x) => x.decided).map((x) => `$${x.ticker}: ${x.decided}`).join(" ") || null;
  const n = decided ? { before: decided, at: null, utc: null, after: "" } : n0;
  const title = b.kind === "coin" ? `$${b.ticker} receipts · Burnticker` : `$${b.a.ticker} vs $${b.b.ticker} receipts · Burnticker`;
  const next = n.at ? `${esc(n.before)}<span data-local="${esc(n.at)}">${esc(n.utc!)}</span>${esc(n.after)}` : `<b>${esc(n.before)}</b>`;
  return [
    "<!doctype html>",
    `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">`,
    `<title>${esc(title)}</title><style>${EMBED_STYLE}</style></head>`,
    `<body><div class="bt-e">`,
    `<a class="card" href="${esc(b.verifyUrl)}" target="_blank" rel="noopener" title="verify on Burnticker">${renderBadgeSvg(b)}</a>`,
    `<p class="next">${next}</p>`,
    `<p class="foot">${esc(b.disclaimer)} <a href="${esc(b.pageUrl)}" target="_blank" rel="noopener">burnticker</a></p>`,
    `</div><script>${EMBED_SCRIPT}</script></body></html>`,
  ].join("");
}

/** The 404 document (still frame-safe, still no cookies). */
export function renderEmbedMissing(what: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Burnticker</title><style>${EMBED_STYLE}</style></head><body><div class="bt-e"><p class="next">${esc(what)}</p></div></body></html>`;
}

/** Visible text of an embed document (tags stripped, entities decoded), for the copy lint. */
export function embedText(html: string): string {
  return html.replace(/<script>[\s\S]*?<\/script>/g, " ").replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
