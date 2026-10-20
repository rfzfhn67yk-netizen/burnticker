import type { BurnRule } from "@/lib/burnticker/rules";
import { receiptsCountShort } from "@/lib/burnticker/coinStatus";
import { coinLifecycleState, decidedPairLine, decidedPairOf } from "@/lib/burnticker/decidedWarning";
import type { ReceiptJson, TokenStatusJson } from "@/lib/burnticker/pageTypes";
import { parseEspnSeries, seasonLabel } from "@/lib/burnticker/sources/espn";

/**
 * THE EMBEDDABLE RECEIPT BADGE (growth batch, owner-approved 2026-10-10: "build them all"). A small B1 thermal-receipt card a creator,
 * a fan site or a README can show for one coin (or one rivalry pair): the ticker, the rule's one-liner, the last burn (date + units),
 * the receipts this season and a "verify →" link to the coin page's verifier. It is the coin page in four lines, built from the same
 * status.json and receipts the page renders — so it can never say more than the page, and it carries NO market data: no price, no
 * market cap, no implied chance, no volume. `badgePayloadProblems` is the guard the routes and tests run over every payload.
 *
 * Pure (no I/O): badgeServe.ts feeds it from the registry; the routes are
 *   GET /api/burnticker/v1/badge/<TICKER or MINT>.svg|.png|.json    (60 s cache; a shared ticker answers 300 with the coins)
 *   GET /api/burnticker/v1/badge/pairs/<pairId>.svg|.png|.json
 *   GET /burnticker/embed/<TICKER> · /burnticker/embed/pairs/<pairId>   (iframe-safe page: the same card + a live next-settlement line)
 */

export const BADGE_SCHEMA = "burnticker.badge/v1";
export const BADGE_CACHE_SEC = 60;
export const BADGE_DISCLAIMER = "This is a memecoin. Its rule says what happens to its supply, never its price.";

/** One coin as the badge shows it. */
export interface BadgeSide {
  ticker: string; name: string; oneLiner: string;
  /** The coin's window badge (2026 SEASON / PERPETUAL / ONE-SHOT · date), when its rule has one. */
  window: string | null;
  status: TokenStatusJson["status"];
  /** The latest confirmed burn: its settlement date, the units the rule counted, the tokens burned (decimal string). */
  lastBurn: { at: string; units: number; burned: string } | null;
  /** Confirmed burns inside the season scope (seasonScope): a team coin's own season window, else the calendar year. */
  receipts: { count: number; label: string; /** HS-29 (hourly run 5): result receipts recorded in the same scope, so the card labels both counts */ recorded?: number };
  rulesSha12: string;
  pageUrl: string; verifyUrl: string;
  /** HB-47 (run 4): a decided one-game coin on the losing side, with the game's day (YYYY-MM-DD); its card says it lost */
  lost?: string | null;
  /** HB-80 / HS-27 (hourly run 5): a decided pair coin's one shared won-or-lost line (decidedWarning.ts decidedPairLine); null otherwise */
  decided?: string | null;
  /** HB-25 residue (hourly run 8): what the coin is doing now; `status` is the registry row state (decidedWarning.ts coinLifecycleState) */
  lifecycleState?: string;
}
export interface Snippets { iframe: string; markdown: string; html: string }
export interface CoinBadgeJson extends BadgeSide {
  schema: typeof BADGE_SCHEMA; kind: "coin"; generatedAt: string;
  /** When the next result is due: the next market close when the venue says, else the keeper's next read of the source. */
  nextSettlementAt: string | null; nextSettlementNote: string;
  badgeUrl: { svg: string; png: string; json: string }; embedUrl: string; embed: Snippets;
  disclaimer: string; affiliation: string;
}
export interface PairBadgeJson {
  schema: typeof BADGE_SCHEMA; kind: "pair"; generatedAt: string; pairId: string;
  a: BadgeSide; b: BadgeSide;
  /** Burns per side (the receipts are the scoreboard). */
  score: { a: number; b: number };
  nextSettlementAt: string | null; nextSettlementNote: string;
  pageUrl: string; verifyUrl: string; badgeUrl: { svg: string; png: string; json: string }; embedUrl: string; embed: Snippets;
  disclaimer: string; affiliation: string;
}
export type BadgeJson = CoinBadgeJson | PairBadgeJson;

const confirmedBurns = <R extends Pick<ReceiptJson, "status" | "burned">>(rs: readonly R[]): R[] => rs.filter((r) => r.status === "confirmed" && /[1-9]/.test(r.burned ?? "0"));

/**
 * "This season" for a coin: a team coin's own window when it is a season or a postseason (every receipt of such a coin is in it), else
 * the calendar year of `now` (UTC). The label is what the card prints after "receipts".
 */
export function seasonScope(rule: Pick<BurnRule, "oracle" | "series">, nowMs: number): { label: string; from: string | null } {
  const e = rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series) : null;
  if (e && e.kind === "team" && (e.window.kind === "season" || e.window.kind === "post")) return { label: `${seasonLabel(e.league, e.window.year)} ${e.window.kind === "post" ? "postseason" : "season"}`, from: null };
  const y = new Date(nowMs).getUTCFullYear();
  return { label: `in ${y}`, from: `${y}-01-01` };
}

export interface SideInput { status: TokenStatusJson; receipts: readonly ReceiptJson[]; rule: Pick<BurnRule, "oracle" | "series">; origin: string; now: number; /** the coin's URL key (coinKey.ts): its ticker while it alone holds it, its mint once the ticker is shared; defaults to the ticker */ key?: string }

/** HB-47 (run 4): a stored one-liner written before the coinCard fix ("burns on the The next …") is shown with one article. */
export const dedupeArticle = (t: string): string => t.replace(/\bthe the\b/gi, (m) => m.slice(0, 3));
export function badgeSide(i: SideInput): BadgeSide {
  const s = i.status, o = i.origin.replace(/\/$/, "");
  const burns = confirmedBurns(i.receipts);
  const scope = seasonScope(i.rule, i.now);
  const inScope = scope.from ? burns.filter((r) => r.settledAt.slice(0, 10) >= scope.from!) : burns;
  const last = [...burns].sort((x, y) => (x.settledAt < y.settledAt ? 1 : -1))[0];
  const page = `${o}/burnticker/t/${encodeURIComponent(i.key ?? s.ticker)}`;
  return {
    ticker: s.ticker, name: s.name, oneLiner: dedupeArticle(s.profile?.oneLiner || s.seriesTitle || s.selectorKey), window: s.profile?.badge || null, status: s.status,
    lastBurn: last ? { at: last.settledAt, units: last.units, burned: last.burned ?? "0" } : null,
    receipts: { count: inScope.length, label: scope.label, recorded: i.receipts.filter((r) => !["winddown", "drain", "sweep"].includes(r.kind ?? "") && (!scope.from || r.settledAt.slice(0, 10) >= scope.from)).length }, rulesSha12: s.rules.sha12, pageUrl: page, verifyUrl: `${page}#verify`,
    lost: lostDayOf(s, i.receipts),
    // HB-25 residue (hourly run 8): what the coin is doing now beside the row state `status`; the decided line reads it
    lifecycleState: coinLifecycleState(s, i.receipts),
    decided: (() => { if (coinLifecycleState(s, i.receipts) !== "decided") return null; const d = decidedPairOf(s, i.receipts); return d ? decidedPairLine(s.ticker, d) : null; })(),
  };
}

/** Continuous audit run 2, HB-28: a one-shot whose one result is in (or was voided) has no next read, so its embed never says "overdue". */
const settledOnce = (s: TokenStatusJson): boolean => s.next.result === "decided" || s.next.result === "void";
const nextOf = (s: TokenStatusJson): string | null => (settledOnce(s) ? null : s.next.nextCloseTime ?? s.next.nextCheckAt ?? null);
const nextNote = (s: TokenStatusJson): string => (settledOnce(s) ? (s.next.result === "void" ? "result voided" : "result decided") : s.rules.oneShot && !nextOf(s) ? "resolves once" : s.next.nextCloseTime ? "the next market close the venue lists" : s.next.nextCheckAt ? "the keeper's next read of the source" : "no result scheduled");

export function snippets(o: { origin: string; embedPath: string; badgePath: string; pagePath: string; alt: string; width?: number; height?: number }): Snippets {
  const base = o.origin.replace(/\/$/, "");
  const w = o.width ?? 480, h = o.height ?? 230;
  const alt = o.alt.replace(/[[\]"<>]/g, "");
  return {
    iframe: `<iframe src="${base}${o.embedPath}" width="${w}" height="${h}" style="border:0;max-width:100%" loading="lazy" title="${alt}"></iframe>`,
    markdown: `[![${alt}](${base}${o.badgePath})](${base}${o.pagePath})`,
    html: `<a href="${base}${o.pagePath}"><img src="${base}${o.badgePath}" alt="${alt}" width="${BADGE_W}"></a>`,
  };
}

export function coinBadge(i: SideInput): CoinBadgeJson {
  const side = badgeSide(i), o = i.origin.replace(/\/$/, ""), t = encodeURIComponent(i.key ?? i.status.ticker);
  const badgePath = `/api/burnticker/v1/badge/${t}`;
  return {
    schema: BADGE_SCHEMA, kind: "coin", generatedAt: new Date(i.now).toISOString(), ...side,
    nextSettlementAt: nextOf(i.status), nextSettlementNote: nextNote(i.status),
    badgeUrl: { svg: `${o}${badgePath}.svg`, png: `${o}${badgePath}.png`, json: `${o}${badgePath}.json` }, embedUrl: `${o}/burnticker/embed/${t}`,
    embed: snippets({ origin: o, embedPath: `/burnticker/embed/${t}`, badgePath: `${badgePath}.svg`, pagePath: `/burnticker/t/${t}`, alt: `$${i.status.ticker} receipts on Burnticker` }),
    disclaimer: BADGE_DISCLAIMER, affiliation: i.status.profile?.affiliation ?? "This coin is not affiliated with any team, league, candidate, agency or market.",
  };
}

export function pairBadge(pairId: string, a: SideInput, b: SideInput): PairBadgeJson {
  const sa = badgeSide(a), sb = badgeSide(b), o = a.origin.replace(/\/$/, ""), id = encodeURIComponent(pairId);
  const next = [nextOf(a.status), nextOf(b.status)].filter((x): x is string => !!x).sort()[0] ?? null;
  const badgePath = `/api/burnticker/v1/badge/pairs/${id}`, page = `${o}/burnticker/p/${id}`;
  return {
    schema: BADGE_SCHEMA, kind: "pair", generatedAt: new Date(a.now).toISOString(), pairId, a: sa, b: sb,
    score: { a: confirmedBurns(a.receipts).length, b: confirmedBurns(b.receipts).length },
    nextSettlementAt: next, nextSettlementNote: next ? (next === nextOf(a.status) ? nextNote(a.status) : nextNote(b.status)) : "no result scheduled",
    pageUrl: page, verifyUrl: page, badgeUrl: { svg: `${o}${badgePath}.svg`, png: `${o}${badgePath}.png`, json: `${o}${badgePath}.json` }, embedUrl: `${o}/burnticker/embed/pairs/${id}`,
    embed: snippets({ origin: o, embedPath: `/burnticker/embed/pairs/${id}`, badgePath: `${badgePath}.svg`, pagePath: `/burnticker/p/${id}`, alt: `$${a.status.ticker} vs $${b.status.ticker} receipts on Burnticker`, height: 254 }),
    disclaimer: "These are two memecoins. Each rule says what happens to its coin's supply, never its price.", affiliation: a.status.profile?.affiliation ?? "These coins are not affiliated with any team, league, candidate, agency or market.",
  };
}

/**
 * NO MARKET DATA IN ANY BADGE PAYLOAD. Every key path that names a price, a market cap, odds, an implied chance, volume, liquidity or a
 * dollar value is a problem; so is any string value that the coin card's own copy rule would refuse (the routes lint separately).
 */
export const MARKET_KEY = /(price|marketcap|market_cap|mcap|fdv|valuation|odds|implied|chance|probab|volume|liquidity|usd|tvl|pnl|roi|apy|apr|gain|return)/i;
export function badgePayloadProblems(payload: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, at: string) => {
    if (Array.isArray(v)) v.forEach((x, k) => walk(x, `${at}[${k}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (MARKET_KEY.test(k)) out.push(`${at}.${k}: market-data key`); walk(x, `${at}.${k}`); }
  };
  walk(payload, "$");
  return out;
}

/** Every human-readable string in a payload (URLs and snippet markup excluded), for the copy lint. */
export function badgeStrings(payload: BadgeJson): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key: string) => {
    if (typeof v === "string") { if (!/^(https?:|<|\[!\[)/.test(v) && !/Url$|^(svg|png|json|generatedAt|at|rulesSha12|pairId|status)$/.test(key)) out.push(v); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "embed") walk(x, k);
  };
  walk(payload, "$");
  return out;
}

// ---- rendering --------------------------------------------------------------------------------------------------------------

export const BADGE_W = 480;
export const BADGE_H = 172;
export const PAIR_BADGE_H = 196;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const MONO = "Courier Prime, Courier New, ui-monospace, monospace";

/** Cuts text to `max` characters on a word boundary, with an ellipsis when it had to cut. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:·—-]+$/, "")}…`;
}
/** "2026-10-09" from an ISO time. */
export const day = (iso: string): string => iso.slice(0, 10);
const fmtInt = (s: string) => s.split(".")[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monDay = (d: string): string => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); return m ? `${MON[Number(m[2]) - 1]} ${Number(m[3])}` : d; };
/** HB-47: the losing side of a decided pair: the game's day from its badge ("ONE-SHOT · Oct 15, 2026"), else the result receipt's day. */
export function lostDayOf(s: Pick<TokenStatusJson, "next" | "profile">, receipts: readonly Pick<ReceiptJson, "pairRole" | "settledAt" | "kind">[]): string | null {
  if (s.next?.result !== "decided") return null;
  const r = [...receipts].filter((x) => !["winddown", "drain", "sweep"].includes(x.kind ?? "")).sort((x, y) => (x.settledAt < y.settledAt ? 1 : -1))[0];
  if (r?.pairRole !== "lost") return null;
  const b = /ONE-SHOT\s*·\s*([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/.exec(s.profile?.badge ?? "");
  return b ? `${b[3]}-${String(MON.indexOf(b[1]) + 1).padStart(2, "0")}-${b[2].padStart(2, "0")}` : r.settledAt.slice(0, 10);
}
/**
 * HB-80 / HS-27 residue (hourly run 7): the SVG coin badge printed "no burn yet" on a decided pair winner. A decided side's card line is
 * the shared decided line's own words (decidedWarning.ts decidedPairLine), short enough for the card: "won on 15 October 2026; burns
 * once both coins graduate" or "lost on 15 October 2026; cannot burn on this result".
 */
export function decidedCardLine(decided: string | null | undefined): string | null {
  const m = /^(Won|Lost)( on [^.]+)?\.\s*(.*)$/.exec(decided ?? "");
  if (!m) return null;
  if (m[1] === "Lost") return `lost${m[2] ?? ""}; cannot burn on this result`;
  return `won${m[2] ?? ""}; ${/trading pool/.test(m[3]) ? "burns on its trading pool" : "burns once both coins graduate"}`;
}
export function lastBurnLine(s: Pick<BadgeSide, "lastBurn" | "status"> & { lost?: string | null; decided?: string | null }): string {
  if (s.lost) return `lost on ${monDay(s.lost)}; cannot burn on this result`;
  if (!s.lastBurn) { const d = decidedCardLine(s.decided); if (d) return d; }
  if (!s.lastBurn) return s.status === "draft" ? "not launched yet · no receipts" : "no burn yet";
  return `last burn ${day(s.lastBurn.at)} · ${s.lastBurn.units} unit${s.lastBurn.units === 1 ? "" : "s"} · ${fmtInt(s.lastBurn.burned)} burned`;
}
export const receiptsLine = (s: Pick<BadgeSide, "receipts">): string => (s.receipts.recorded !== undefined && s.receipts.recorded !== s.receipts.count ? `receipts ${s.receipts.label}: ${receiptsCountShort(s.receipts.recorded, s.receipts.count)}` : `receipts ${s.receipts.label}: ${s.receipts.count}`);

/** Every text line the coin card prints, top to bottom (the SVG and the embed page both render exactly these; the tests lint them). */
export function coinCardLines(b: CoinBadgeJson): { head: string; window: string | null; liner: string; last: string; receipts: string; verify: string; foot: string } {
  return { head: `$${b.ticker}`, window: b.window, liner: clip(b.oneLiner, 50), last: lastBurnLine(b), receipts: receiptsLine(b), verify: "verify →", foot: `rules sha256 ${b.rulesSha12} · burnticker` };
}
export function pairCardLines(b: PairBadgeJson): { head: string; score: string; a: string; b: string; last: string; verify: string; foot: string } {
  const lastOf = [b.a, b.b].filter((s) => s.lastBurn).sort((x, y) => (x.lastBurn!.at < y.lastBurn!.at ? 1 : -1))[0];
  const decided = pairDecidedLine(b.a, b.b);
  return {
    head: `$${b.a.ticker} vs $${b.b.ticker}`, score: `burns ${b.score.a} : ${b.score.b}`,
    a: clip(`$${b.a.ticker} ${b.a.oneLiner}`, 58), b: clip(`$${b.b.ticker} ${b.b.oneLiner}`, 58),
    last: lastOf ? `last burn ${day(lastOf.lastBurn!.at)} · $${lastOf.ticker} · ${lastOf.lastBurn!.units} unit${lastOf.lastBurn!.units === 1 ? "" : "s"}` : decided ?? "no burn yet",
    // HB-47 (hourly run 6): the foot names both rule hashes, never the pair's raw id
    verify: "verify →", foot: `rules sha256 ${b.a.rulesSha12} and ${b.b.rulesSha12} · burnticker`,
  };
}
/**
 * HB-47 (hourly run 6): a decided pair's state on its card, from each side's own decided line (decidedPairLine: "Won on Oct 15. …",
 * "Lost on Oct 15. …"): "$DENWIN won on Oct 15; $SEAWIN lost". Null while neither side is decided.
 */
export function pairDecidedLine(a: Pick<BadgeSide, "ticker" | "decided">, b: Pick<BadgeSide, "ticker" | "decided">): string | null {
  const role = (s: Pick<BadgeSide, "decided">) => { const m = /^(Won|Lost)( on [^.]+)?\./.exec(s.decided ?? ""); return m ? { won: m[1] === "Won", on: m[2] ?? "" } : null; };
  const ra = role(a), rb = role(b);
  const w = ra?.won ? { s: a, r: ra } : rb?.won ? { s: b, r: rb } : null;
  const l = ra && !ra.won ? { s: a, r: ra } : rb && !rb.won ? { s: b, r: rb } : null;
  if (w && l) return `$${w.s.ticker} won${w.r.on}; $${l.s.ticker} lost`;
  if (w) return `$${w.s.ticker} won${w.r.on}`;
  if (l) return `$${l.s.ticker} lost${l.r.on}`;
  return null;
}

/** The paper slip shared by both cards: a torn bottom edge, the BURNTICKER stamp, dashed rules. */
function slip(h: number, inner: string[], label: string): string {
  const W = BADGE_W, n = 24, step = (W - 16) / n;
  // the torn edge, right to left (the outline runs clockwise): a tooth down, a notch up, n times
  const teeth = Array.from({ length: n }, (_, k) => { const x = W - 8 - k * step; return `${(x - step / 2).toFixed(1)},${h - 3} ${(x - step).toFixed(1)},${h - 12}`; }).join(" ");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">`,
    `<title>${esc(label)}</title>`,
    `<rect width="${W}" height="${h}" rx="6" fill="#12100e"/>`,
    `<path d="M8,8 L${W - 8},8 L${W - 8},${h - 12} L${teeth} Z" fill="#f2eee4"/>`,
    `<g font-family="${MONO}" fill="#1b1916">`,
    ...inner,
    `<rect x="${W - 132}" y="18" width="110" height="22" fill="none" stroke="#5b3fa3" stroke-width="2" transform="rotate(3 ${W - 77} 29)"/>`,
    `<text x="${W - 77}" y="34" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="2" fill="#5b3fa3" transform="rotate(3 ${W - 77} 29)">BURNTICKER</text>`,
    `</g></svg>`,
  ].join("");
}
const rule = (y: number) => `<line x1="22" y1="${y}" x2="${BADGE_W - 22}" y2="${y}" stroke="#1b1916" stroke-width="1.5" stroke-dasharray="6 5"/>`;

/** The coin card as SVG (480 × 172). Same input → byte-identical output. */
export function renderCoinBadgeSvg(b: CoinBadgeJson): string {
  const L = coinCardLines(b);
  const size = L.head.length <= 8 ? 30 : L.head.length <= 10 ? 26 : 22;
  return slip(BADGE_H, [
    `<text x="22" y="44" font-size="${size}" font-weight="700">${esc(L.head)}</text>`,
    L.window ? `<text x="22" y="62" font-size="11" letter-spacing="1.5" fill="#5b3fa3">${esc(L.window)}</text>` : "",
    rule(72),
    `<text x="22" y="92" font-size="14">${esc(L.liner)}</text>`,
    `<text x="22" y="114" font-size="12.5" fill="#3e3933">${esc(L.last)}</text>`,
    `<text x="22" y="132" font-size="12.5" fill="#3e3933">${esc(L.receipts)}</text>`,
    `<text x="${BADGE_W - 22}" y="132" text-anchor="end" font-size="13" font-weight="700" fill="#5b3fa3">${esc(L.verify)}</text>`,
    `<text x="22" y="150" font-size="9.5" fill="#5a5248">${esc(L.foot)}</text>`,
  ].filter(Boolean), `$${b.ticker} — ${b.oneLiner} · ${L.last} · ${L.receipts}`);
}

/** The pair card as SVG (480 × 196). */
export function renderPairBadgeSvg(b: PairBadgeJson): string {
  const L = pairCardLines(b);
  const size = L.head.length <= 18 ? 24 : L.head.length <= 24 ? 19 : 16;
  return slip(PAIR_BADGE_H, [
    `<text x="22" y="42" font-size="${size}" font-weight="700">${esc(L.head)}</text>`,
    `<text x="22" y="62" font-size="13" letter-spacing="1" fill="#5b3fa3">${esc(L.score)}</text>`,
    rule(72),
    `<text x="22" y="92" font-size="12.5">${esc(L.a)}</text>`,
    `<text x="22" y="110" font-size="12.5">${esc(L.b)}</text>`,
    `<text x="22" y="134" font-size="12.5" fill="#3e3933">${esc(L.last)}</text>`,
    `<text x="${BADGE_W - 22}" y="154" text-anchor="end" font-size="13" font-weight="700" fill="#5b3fa3">${esc(L.verify)}</text>`,
    `<text x="22" y="174" font-size="9.5" fill="#5a5248">${esc(L.foot)}</text>`,
  ], `${L.head} — ${L.score} · ${L.last}`);
}

export const renderBadgeSvg = (b: BadgeJson): string => (b.kind === "coin" ? renderCoinBadgeSvg(b) : renderPairBadgeSvg(b));

/** Text nodes of an SVG (unescaped), for the copy lint. */
export function svgText(svg: string): string[] {
  const un = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return [...svg.matchAll(/<(text|title)[^>]*>([^<]*)<\/\1>/g)].map((m) => un(m[2])).concat([...svg.matchAll(/aria-label="([^"]*)"/g)].map((m) => un(m[1])));
}
