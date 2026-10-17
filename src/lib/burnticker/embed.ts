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

/** Updates every [data-at] element's countdown each second; reloads the document every 60 s. No network call of its own. */
export const EMBED_SCRIPT = [
  "(function(){",
  "function fmt(ms){if(ms<=0)return 'due now';var m=Math.floor(ms/60000),d=Math.floor(m/1440),h=Math.floor(m%1440/60),mm=m%60,s=Math.floor(ms/1000)%60;",
  "return 'in '+(d?d+'d '+h+'h':h?h+'h '+mm+'m':mm+'m '+s+'s');}",
  "function tick(){var n=Date.now(),els=document.querySelectorAll('[data-at]');for(var i=0;i<els.length;i++){var t=Date.parse(els[i].getAttribute('data-at'));",
  "if(!isNaN(t))els[i].textContent=fmt(t-n);}}",
  "try{var w=document.querySelectorAll('[data-local]');for(var j=0;j<w.length;j++){var x=new Date(w[j].getAttribute('data-local'));",
  "if(!isNaN(x))w[j].textContent=x.toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});}}catch(e){}",
  `tick();setInterval(tick,1000);setTimeout(function(){location.reload();},${BADGE_CACHE_SEC * 1000});`,
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

/** The next-settlement line's words (server-rendered; the script replaces the countdown and the local time). */
export function nextLine(b: Pick<BadgeJson, "nextSettlementAt" | "nextSettlementNote">, nowMs: number): { lead: string; at: string | null; utc: string | null; note: string } {
  if (!b.nextSettlementAt) return { lead: b.nextSettlementNote === "resolves once" ? "resolves once" : "no result scheduled", at: null, utc: null, note: b.nextSettlementNote };
  const ms = Date.parse(b.nextSettlementAt) - nowMs;
  const mins = Math.max(0, Math.floor(ms / 60000));
  const rel = ms <= 0 ? "due now" : mins >= 1440 ? `in ${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h` : mins >= 60 ? `in ${Math.floor(mins / 60)}h ${mins % 60}m` : `in ${mins}m`;
  return { lead: rel, at: b.nextSettlementAt, utc: `${b.nextSettlementAt.slice(0, 16).replace("T", " ")} UTC`, note: b.nextSettlementNote };
}

/** The whole embed document. Every visible word is the card's lines plus the next-settlement line and the footer (all linted in tests). */
export function renderEmbedHtml(b: BadgeJson, nowMs: number): string {
  const n = nextLine(b, nowMs);
  const title = b.kind === "coin" ? `$${b.ticker} receipts · Burnticker` : `$${b.a.ticker} vs $${b.b.ticker} receipts · Burnticker`;
  const next = n.at
    ? `The next settlement is <b data-at="${esc(n.at)}">${esc(n.lead)}</b>, at <span data-local="${esc(n.at)}">${esc(n.utc!)}</span>. <span class="note">That time is ${esc(n.note)}.</span>`
    : `<b>${n.lead === "resolves once" ? "This rule resolves once." : "No result is scheduled."}</b> There is no next settlement time to show.`;
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
