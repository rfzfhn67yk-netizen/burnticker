import { renderCoinSvg, paletteFor } from "@/lib/burnticker/coinArt";
import type { BurnRule } from "@/lib/burnticker/rules";

/**
 * THE RECEIPT SHARE CARD (cheap-features pass items 1 and 7, owner 2026-10-13). One 1200 × 630 image per coin in the B1 receipt style:
 * the coin's own generated image (coinArt.ts renderCoinSvg, embedded as is) on the left, and a paper slip on the right with the ticker,
 * the rule's sentence, the latest burn (tokens and the reading's day) and how many burns are recorded. The same image is the coin page's
 * Open Graph and X card and the embeddable receipt widget, both served by GET /burnticker/img/receipt/<MINT>.png (receiptCardServe.ts).
 *
 * Deterministic and offline: the same inputs give byte-identical SVG. No price, no market data, no external fetch, no league marks.
 */
export interface ReceiptCardInput {
  ticker: string; sentence: string; rule: BurnRule; sha256: string;
  /** the newest confirmed burn: whole tokens burned (a decimal string), the reading's day (YYYY-MM-DD) */ latest: { tokens: string; day: string } | null;
  burns: number;
  /** cheap-features item 12: a Coin vs Coin coin's scoreboard line (derby/page.ts derbyScoreboard), drawn under the latest burn */
  scoreboard?: string | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const group = (s: string): string => { const [w, f] = s.split("."); const g = w.replace(/\B(?=(\d{3})+(?!\d))/g, ","); return f ? `${g}.${f.slice(0, 2)}` : g; };

function wrap(text: string, max: number, lines: number): string[] {
  const out: string[] = []; let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((cur + " " + w).trim().length > max) { if (cur) out.push(cur); cur = w; if (out.length === lines) break; } else cur = (cur + " " + w).trim();
  }
  if (cur && out.length < lines) out.push(cur);
  if (out.length === lines && text.length > out.join(" ").length + 1) out[lines - 1] = `${out[lines - 1].replace(/[.,;:]?$/, "")}…`;
  return out;
}

/** The latest-burn line on the card (also the image's alt text). */
export function latestBurnLine(latest: ReceiptCardInput["latest"]): string {
  return latest ? `Latest burn: ${group(latest.tokens)} tokens, reading of ${latest.day}` : "No burn recorded yet";
}

/** The card as an SVG string (1200 × 630). */
export function renderReceiptCardSvg(i: ReceiptCardInput): string {
  const p = paletteFor(i.rule);
  const t = `$${i.ticker.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)}`;
  const art = renderCoinSvg({ ticker: i.ticker, oneLiner: i.sentence, rule: i.rule, sha256: i.sha256 }).replace(/^<svg [^>]*>/, '<svg x="44" y="59" width="512" height="512" viewBox="0 0 512 512">');
  const size = t.length <= 6 ? 72 : t.length <= 8 ? 60 : 50;
  const lines = wrap(i.sentence, 34, 4);
  const latest = latestBurnLine(i.latest);
  const count = `${i.burns} ${i.burns === 1 ? "burn" : "burns"} recorded`;
  const alt = `${t}. ${i.sentence} ${latest}.${i.scoreboard ? ` ${i.scoreboard}` : ""}`;
  const board = i.scoreboard ? wrap(i.scoreboard, 40, 2) : [];
  const y0 = 150 + size;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${esc(alt)}">`,
    `<rect width="1200" height="630" fill="#12100e"/>`,
    `<rect x="0" y="0" width="1200" height="14" fill="${p.accent}"/><rect x="0" y="616" width="1200" height="14" fill="${p.accent2}"/>`,
    art,
    `<g transform="rotate(1 880 315)">`,
    `<rect x="610" y="56" width="546" height="518" fill="#f2eee4"/>`,
    `<text x="640" y="104" font-family="Courier Prime, Courier New, monospace" font-size="22" font-weight="700" letter-spacing="6" fill="#1b1916">BURNTICKER RECEIPT</text>`,
    `<line x1="640" y1="124" x2="1126" y2="124" stroke="#1b1916" stroke-width="2" stroke-dasharray="8 6"/>`,
    `<text x="640" y="${132 + size}" font-family="Courier Prime, Courier New, monospace" font-size="${size}" font-weight="700" fill="#1b1916">${esc(t)}</text>`,
    ...lines.map((l, k) => `<text x="640" y="${y0 + 34 + k * 32}" font-family="Courier Prime, Courier New, monospace" font-size="25" fill="#3e3933">${esc(l)}</text>`),
    `<line x1="640" y1="${y0 + 60 + 4 * 32}" x2="1126" y2="${y0 + 60 + 4 * 32}" stroke="#1b1916" stroke-width="2" stroke-dasharray="8 6"/>`,
    `<text x="640" y="${y0 + 100 + 4 * 32}" font-family="Courier Prime, Courier New, monospace" font-size="24" font-weight="700" fill="#1b1916">${esc(latest)}</text>`,
    ...(board.length ? board.map((l, k) => `<text x="640" y="${y0 + 134 + 4 * 32 + k * 26}" font-family="Courier Prime, Courier New, monospace" font-size="20" font-weight="700" fill="${p.accent}">${esc(l)}</text>`) : [    `<text x="640" y="${y0 + 134 + 4 * 32}" font-family="Courier Prime, Courier New, monospace" font-size="20" fill="#3e3933">${esc(count)} · rules sha256:${esc(i.sha256.slice(0, 12))}</text>`,
]),
    `</g></svg>`,
  ].join("");
}
