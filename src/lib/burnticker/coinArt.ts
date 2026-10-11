import type { BurnRule } from "@/lib/burnticker/rules";
import { parseEspnSeries, teamByAbbr } from "@/lib/burnticker/sources/espn";
import { TEAM_COLORS } from "@/lib/burnticker/sources/teamColors";

/**
 * THE COIN IMAGE (2026-10-10, the owner: "could we even auto generate a ticker and a photo?"). A deterministic renderer — no model, no
 * upload, no external fetch — in Burnticker's B1 thermal-receipt style: a paper slip on the dark counter with the ticker in large type,
 * the rule's one-liner, a palette from the team's colours (colours and the abbreviation only — never a league or team logo or mark) or
 * from the category, and a SCORCH MARK whose position, size and outline are seeded from the rules sha256, so every coin's image is
 * unique and reproducible from its rule alone. Same inputs → byte-identical SVG (test/burntickerCoinArt.test.ts).
 *
 * Served by GET /burnticker/img/<TICKER>.svg|.png (src/app/burnticker/img/[file]/route.ts, rendered on demand from the registry and
 * cached; PNG through sharp) and written into the token metadata `image` at launch when the creator gives no image of their own.
 */

export interface ArtInput { ticker: string; oneLiner: string; rule: BurnRule; sha256: string }
export interface Palette { accent: string; accent2: string; label: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const HEX = /^#[0-9a-f]{6}$/i;

/** The palette: team colours for an ESPN rule, else one per category of source. */
export function paletteFor(rule: BurnRule): Palette {
  const e = rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series) : null;
  if (e) {
    const c = TEAM_COLORS[`${e.league}:${e.abbr}`] ?? teamByAbbr(e.league, e.abbr)?.colors ?? null;
    if (c && HEX.test(c[0])) return { accent: c[0], accent2: HEX.test(c[1]) ? c[1] : "#f2eee4", label: e.abbr };
  }
  const s = rule.series ?? "";
  if (rule.oracle === "polymarket") return { accent: "#5b3fa3", accent2: "#c8873a", label: "VOTE" };
  if (/^nws\./.test(s)) return { accent: "#1f5f8b", accent2: "#c8873a", label: "WX" };
  if (/^fec\./.test(s)) return { accent: "#8b1e2d", accent2: "#1f3f8b", label: "FEC" };
  if (/^(treasury|fred|bls|bea|census)\./.test(s)) return { accent: "#2f5d3a", accent2: "#c8873a", label: "ECON" };
  if (/^(ll2|noaa|jpl)\./.test(s)) return { accent: "#2b2d6e", accent2: "#c8873a", label: "SKY" };
  if (/^(bitcoin|solana|ethereum|defillama)\./.test(s)) return { accent: "#8a5a24", accent2: "#5b3fa3", label: "CHAIN" };
  return { accent: "#5b3fa3", accent2: "#c8873a", label: "BT" };
}

/** A small PRNG seeded from the sha256 hex (mulberry32 over successive 8-hex words): deterministic, no Math.random. */
function rng(hex: string): () => number {
  let i = 0;
  const words = (hex.match(/.{8}/g) ?? ["9e3779b9"]).map((w) => parseInt(w, 16) >>> 0);
  let a = words[0] ^ 0x9e3779b9;
  return () => { a = (a + 0x6d2b79f5 + (words[++i % words.length] & 0xff)) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The scorch mark's geometry from the rule hash: centre, radius and a 14-point irregular outline. */
export function scorchFor(sha256: string): { cx: number; cy: number; r: number; points: [number, number][] } {
  const R = rng(sha256.toLowerCase().replace(/[^0-9a-f]/g, "").padEnd(64, "0"));
  const cx = 150 + R() * 212, cy = 190 + R() * 150, r = 34 + R() * 30;
  const points: [number, number][] = [];
  for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2, rr = r * (0.62 + R() * 0.62); points.push([Math.round((cx + Math.cos(a) * rr) * 10) / 10, Math.round((cy + Math.sin(a) * rr) * 10) / 10]); }
  return { cx: Math.round(cx * 10) / 10, cy: Math.round(cy * 10) / 10, r: Math.round(r * 10) / 10, points };
}

function wrap(text: string, max: number, lines = 3): string[] {
  const out: string[] = []; let cur = "";
  for (const w of text.split(/\s+/)) { if ((cur + " " + w).trim().length > max) { if (cur) out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); if (out.length === lines) break; }
  if (cur && out.length < lines) out.push(cur);
  return out;
}

/** The coin image as an SVG string (512 × 512). */
export function renderCoinSvg(i: ArtInput): string {
  const p = paletteFor(i.rule), s = scorchFor(i.sha256);
  const t = `$${i.ticker.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)}`;
  const size = t.length <= 5 ? 92 : t.length <= 7 ? 74 : t.length <= 9 ? 60 : 54;
  const lines = wrap(i.oneLiner, 28);
  const path = `M${s.points.map(([x, y]) => `${x},${y}`).join(" L")} Z`;
  const teeth = Array.from({ length: 20 }, (_, k) => `${76 + k * 18},440 ${85 + k * 18},452`).join(" ");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="${esc(t)} — ${esc(i.oneLiner)}">`,
    `<defs><radialGradient id="sc" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#1b1916" stop-opacity="0.95"/><stop offset="55%" stop-color="#5a3412" stop-opacity="0.75"/><stop offset="100%" stop-color="#c8873a" stop-opacity="0"/></radialGradient></defs>`,
    `<rect width="512" height="512" fill="#12100e"/>`,
    `<rect x="0" y="0" width="512" height="18" fill="${p.accent}"/><rect x="0" y="494" width="512" height="18" fill="${p.accent2}"/>`,
    `<g transform="rotate(-2 256 256)">`,
    `<path d="M76,64 L436,64 L436,440 L${teeth} L76,440 Z" fill="#f2eee4"/>`,
    `<text x="100" y="104" font-family="Courier Prime, Courier New, monospace" font-size="20" font-weight="700" letter-spacing="5" fill="#1b1916">BURNTICKER</text>`,
    `<line x1="100" y1="122" x2="412" y2="122" stroke="#1b1916" stroke-width="2" stroke-dasharray="7 6"/>`,
    `<path d="${path}" fill="url(#sc)"/>`,
    `<circle cx="${s.cx}" cy="${s.cy}" r="${Math.round(s.r * 0.35 * 10) / 10}" fill="#12100e" fill-opacity="0.85"/>`,
    `<text x="256" y="${250 + size / 3}" text-anchor="middle" font-family="Courier Prime, Courier New, monospace" font-size="${size}" font-weight="700" fill="#1b1916">${esc(t)}</text>`,
    `<line x1="100" y1="${282 + size / 3}" x2="412" y2="${282 + size / 3}" stroke="#1b1916" stroke-width="2" stroke-dasharray="7 6"/>`,
    ...lines.map((l, k) => `<text x="256" y="${318 + size / 3 + k * 26}" text-anchor="middle" font-family="Courier Prime, Courier New, monospace" font-size="21" fill="#3e3933">${esc(l)}</text>`),
    `<rect x="${336}" y="76" width="88" height="28" fill="none" stroke="${p.accent}" stroke-width="3" transform="rotate(4 380 90)"/>`,
    `<text x="380" y="96" text-anchor="middle" font-family="Courier Prime, Courier New, monospace" font-size="16" font-weight="700" fill="${p.accent}" transform="rotate(4 380 90)">${esc(p.label)}</text>`,
    `</g></svg>`,
  ].join("");
}

/** The image URL written into the token metadata when the creator gives no image (BURNTICKER_PUBLIC_ORIGIN, default the Caddyfile host). */
export const coinArtUrl = (ticker: string, origin: string): string => `${origin.replace(/\/$/, "")}/burnticker/img/${encodeURIComponent(ticker.toUpperCase())}.png`;
export const publicOrigin = (env: Readonly<Record<string, string | undefined>> = process.env): string => ((env.BURNTICKER_PUBLIC_ORIGIN ?? "").trim() || "https://burnticker.com").replace(/\/$/, "");
