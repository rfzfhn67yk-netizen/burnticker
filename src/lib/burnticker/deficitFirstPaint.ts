import { deficitQueueCore } from "@/lib/burnticker/deficitQueueCore.mjs";
import { graduationExplainer } from "@/lib/burnticker/graduationLine";
import { goHref, raydiumSwapUrl, launchLabUrl } from "@/lib/burnticker/tradeLinks";
import { isQueuedReading, QUEUED_READING } from "@/lib/burnticker/queuedReading";

/**
 * THE $DEFICIT SITE'S FIRST PAINT (campaign readiness 2026-10-19, item 1). deficit.burnticker.com is one static page whose script fills
 * every figure from the keeper's status.json and burns.json. Without the script (a link preview, a crawler, reader mode, a slow first
 * paint) the HTML used to say "Not launched", "Trading not available" and "Step 0 of 6" while the coin was on its curve. This renders the
 * keeper's current state into the page's own static text before it is served: the readiness step and words, the graduation line and
 * the time the state was read, the counted trade links, the live strip's reading, the queued-units counter, the receipts table (queued
 * readings labelled as such) and the footer. The page's script still runs and replaces the same elements with the same words.
 *
 * Pure: the template, the two parsed files and the Burnticker origin in, the page out. scripts/ops/deficit-first-paint.mts reads the
 * files and writes the result; scripts/ops/deploy-sites.sh runs it on every publish (each minute). A status file that is missing, not
 * the keeper's schema, or the pre-launch file leaves the template unchanged.
 */
export const BURNTICKER_ORIGIN = "https://burnticker.com";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Status = any;
type BurnRow = { status: string; recordDate: string; now: string; delta: string; units: number; spent?: string | null; got?: string | null; burned?: string | null; txUrl?: string | null; signature?: string | null };

/** The six steps of the page's readiness box (the page script's READY_DONE, progress.ts PROGRESS_DONE). */
export const READY_DONE: Readonly<Record<string, number>> = { "not-launched": 0, "on-curve": 2, "awaiting-registration": 3, "awaiting-event": 4, "below-floor": 4, deferred: 5, burned: 6 };
/** The receipts table's empty line by lifecycle (the page script's LIFECYCLE, word for word). */
const EMPTY = {
  onCurve: "No burns yet. The coin is trading on its curve; burns can begin after graduation and pool registration.",
  graduated: "No burns yet. The curve has graduated. Burns can begin once its pool is registered and verified.",
  registered: "No burns yet. The pool is registered, and no Treasury reading has qualified for a burn so far.",
};

const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const fmtInt = (s: unknown): string => String(s ?? "0").split(".")[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const fmtT = (amount: unknown): string => `$${(Number(amount) / 1e12).toFixed(3)}T`;
const fmtB = (delta: unknown): string => { const n = Number(delta); return `${n >= 0 ? "+" : "−"}$${(Math.abs(n) / 1e9).toFixed(2)}B`; };
const fmtSol = (s: unknown): string => { if (s == null) return "—"; const n = Number(s); return `${n >= 100 ? n.toFixed(1) : n >= 1 ? n.toFixed(3) : n.toFixed(4)} SOL`; };
/** "2026-10-19 23:41 UTC" */
export const utcStamp = (iso: string): string => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC` : ""; };
const isMainnet = (c: unknown) => c === "mainnet" || c === "mainnet-beta";

/** Replaces the inner text of the one element with this id (a simple element with no children). */
function setText(html: string, id: string, text: string): string {
  const re = new RegExp(`(<([a-z0-9]+)\\b[^>]*\\bid="${id}"[^>]*>)[^<]*(</\\2>)`);
  return re.test(html) ? html.replace(re, (_m, open: string, _tag: string, close: string) => `${open}${esc(text)}${close}`) : html;
}
/** Replaces the whole element with this id (no nested element of the same tag). */
function setElement(html: string, id: string, tag: string, el: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?</${tag}>`);
  return re.test(html) ? html.replace(re, el) : html;
}
const unhide = (html: string, id: string): string => html.replace(new RegExp(`(\\bid="${id}"[^>]*?) hidden([ >])`), "$1$2");

/** The trade address the page links (the counted redirect on Burnticker) and the venue address it answers with. */
export function deficitTradeLink(mint: string, phase: string | null, origin = BURNTICKER_ORIGIN): { href: string; dest: string } {
  const swap = phase === "graduated";
  return { href: goHref("raydium", mint, { swap, origin }), dest: swap ? raydiumSwapUrl(mint) : launchLabUrl(mint) };
}

function receiptsRows(rows: BurnRow[]): string {
  return rows.slice().reverse().slice(0, 25).map((b, i, all) => {
    const queued = isQueuedReading(b.status), skipped = b.status === "skipped", done = b.status === "confirmed", no = all.length - i;
    const dash = "—";
    return `<tr id="r-${no}"${queued ? ' data-queued=""' : ""}><td class="mono" title="${done ? "receipt" : queued ? QUEUED_READING : esc(b.status)}">${esc(b.recordDate)}</td>`
      + `<td class="r num">${fmtT(b.now)}</td><td class="r num">${fmtB(b.delta)}</td><td class="r units">${esc(b.units)}</td>`
      + `<td class="r num">${done && b.spent != null ? esc(Number(b.spent).toFixed(4)) : dash}</td><td class="r num">${b.got != null ? fmtInt(b.got) : dash}</td>`
      + `<td class="r num">${skipped ? '<span class="muted">skipped</span>' : queued ? '<span class="muted">no burn yet</span>' : done ? `<b>${fmtInt(b.burned ?? "0")}</b>` : dash}</td>`
      + `<td>${dash}</td><td>${b.txUrl && b.signature ? `<a href="${esc(b.txUrl)}" target="_blank" rel="noopener">${esc(b.signature.slice(0, 8))}…</a>` : dash}</td>`
      + `<td><span class="muted">${queued ? QUEUED_READING : done ? "burned" : esc(b.status)}</span></td><td></td></tr>`;
  }).join("");
}

export function deficitFirstPaint(template: string, status: Status, burnsFile: unknown, o: { origin?: string; now?: number } = {}): string {
  const s = status;
  if (!s || typeof s !== "object" || s.schema !== "burnkeeper.status/v1") return template;
  const now = o.now ?? Date.now();
  let h = template;
  const r = s.readiness && typeof s.readiness === "object" ? s.readiness : null;
  const curve = s.curve && typeof s.curve === "object" ? s.curve : null;
  const phase: string | null = curve?.phase ?? null;
  const readAt: string | null = curve?.readAt ?? s.generatedAt ?? null;
  const rows: BurnRow[] | null = Array.isArray(burnsFile) ? burnsFile as BurnRow[] : burnsFile && typeof burnsFile === "object" && Array.isArray((burnsFile as { burns?: unknown }).burns) ? (burnsFile as { burns: BurnRow[] }).burns : null;

  // the launched layout: no pre-launch class, and the pre-launch note left out (a reader that ignores the stylesheet would read it)
  h = h.replace(/<html lang="en" class="prelaunch">/, `<html lang="en" data-first-paint="${esc(s.generatedAt ?? "")}">`);
  h = h.replace(/\s*<section class="wrap" id="prelaunch" data-prelaunch>[\s\S]*?<\/section>/, "");

  // the readiness box: the keeper's own state, its step of six, the graduation line and when it was read
  if (r?.label) {
    h = h.replace(/(id="readiness" data-readiness=")[^"]*(")/, `$1${esc(r.state)}$2`);
    h = setText(h, "readyStep", `Step ${READY_DONE[r.state] ?? "?"} of 6 toward a first burn`);
    h = setText(h, "readyLabel", String(r.label));
    h = setText(h, "readyDetail", String(r.detail ?? ""));
    if (r.state !== "not-launched") h = h.replace('<details class="rd-more">', '<details class="rd-more" hidden>');
  }
  const grad = curve && phase !== "graduated" && phase !== "migrating" ? graduationExplainer(curve.threshold, curve.quote ?? "SOL", s.buyback?.funding?.seedSol ?? null) : null;
  if (grad) { h = setText(h, "gradLine", grad); h = unhide(h, "gradLine"); }
  if (readAt && utcStamp(readAt)) { h = setText(h, "readyRead", `This page read the coin's state at ${utcStamp(readAt)}.`); h = unhide(h, "readyRead"); }

  // the queued-units counter: the same function the page and the app run
  const q = deficitQueueCore(s, burnsFile ?? null, now) as { state: string; headline: string; lines: string[] };
  h = h.replace(/(id="queue" data-queue=")[^"]*(")/, `$1${esc(q.state)}$2`);
  h = setText(h, "queueHead", q.headline);
  h = h.replace(/<div id="queueLines"><\/div>/, `<div id="queueLines">${q.lines.map((l) => `<p class="ql${/out of date/.test(l) ? " stale" : ""}">${esc(l)}</p>`).join("")}</div>`);

  // the trade controls: the counted Burnticker link, which answers with Raydium's address for the mint
  const mint: string | null = s.addresses?.mint ?? null;
  if (mint && isMainnet(s.cluster) && !s.sample) {
    const t = deficitTradeLink(mint, phase, o.origin ?? BURNTICKER_ORIGIN);
    const a = (id: string, cls: string, label: string) => `<a${cls ? ` class="${cls}"` : ""} id="${id}" href="${esc(t.href)}" target="_blank" rel="noopener" data-trade-link>${label}</a>`;
    h = setElement(h, "tradeTop", "a", a("tradeTop", "primary", "Trade"));
    h = setElement(h, "tradeHero", "a", a("tradeHero", "btn red", "Trade on Raydium"));
    h = setElement(h, "tradeFoot", "a", a("tradeFoot", "", "Trade on Raydium"));
    h = setText(h, "trade", `$DEFICIT trades on Raydium. Burnticker never takes an order: each trade link opens Raydium, Jupiter, DexScreener or Solscan. The trade link is ${t.dest}`);
  } else {
    h = setElement(h, "tradeTop", "a", '<a class="primary off" id="tradeTop" aria-disabled="true">No trade link here</a>');
    h = setElement(h, "tradeHero", "a", '<a class="btn red off" id="tradeHero" aria-disabled="true">No trade link on this page yet</a>');
    h = setElement(h, "tradeFoot", "a", '<a id="tradeFoot" class="off" aria-disabled="true">No trade link on this page yet</a>');
    h = setText(h, "trade", "$DEFICIT has launched, but this page has no trade link for it yet. Any link that claims to trade $DEFICIT before this page shows one is not ours.");
  }
  h = h.replace(/(<a class="btn" id="receiptsCta" href=")[^"]*("[^>]*>)[^<]*(<\/a>)/, "$1#receipts$2Read the receipts$3");

  // the live strip
  if (s.feed?.lastAmount) {
    h = setText(h, "debtNow", fmtT(s.feed.lastAmount));
    h = setText(h, "debtExact", `$${fmtInt(s.feed.lastAmount)}.${String(s.feed.lastAmount).split(".")[1] ?? "00"} on ${s.feed.lastRecordDate}`);
  } else h = setText(h, "debtExact", "No reading yet");
  if (s.burned) h = setText(h, "burned", fmtInt(s.burned.total));
  if (s.buyback && s.buyback.feePoolSol != null) h = setText(h, "pool", fmtSol(s.buyback.feePoolSol));
  if (s.generatedAt) h = setText(h, "gen", utcStamp(s.generatedAt));
  h = setText(h, "todayText", "The daily report is put together in your browser from status.json and burns.json.");
  if (s.burned) h = h.replace(/(<div class="seg7 amber figamber" id="heroBurn" role="img" aria-label=")[^"]*("><span class="fb">)[^<]*(<\/span>)/, `$1${esc(`${fmtInt(s.burned.total)} $DEFICIT bought and burned to date`)}$2${esc(fmtInt(s.burned.total))}$3`);

  // the receipts table: queued readings say so; the empty line follows the lifecycle
  let body: string;
  if (!rows) body = `<tr><td colspan="11" class="empty">The receipt history did not load just now, so no receipts are shown. This does not mean there have been no burns.</td></tr>`;
  else if (rows.length) body = receiptsRows(rows);
  else body = `<tr><td colspan="11" class="empty">${esc(r?.state === "awaiting-registration" ? EMPTY.graduated : r && ["awaiting-event", "below-floor", "deferred", "burned"].includes(r.state) ? EMPTY.registered : EMPTY.onCurve)}</td></tr>`;
  h = h.replace(/<tbody id="rows">[\s\S]*?<\/tbody>/, `<tbody id="rows">${body}</tbody>`);
  return h;
}

/** The page's visible text: the HTML without its scripts, styles and comments (what a link preview, a crawler or reader mode reads). */
export function visibleHtml(html: string): string {
  return html.replace(/<script\b[\s\S]*?<\/script>/g, "").replace(/<style\b[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "");
}
