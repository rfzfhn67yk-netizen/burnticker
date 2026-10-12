/**
 * ONE COIN CARD, ONE FIELD ORDER (website-10, 2026-10-12; the owner's review item 5 and brief rule 10). Every surface that lists coins
 * prints the same rows in the same order: image, name, $TICKER, the rule in one line, the next result (only when the rule has one), the
 * total burned, the bonding curve (or the trading pool after graduation), then "Check receipt". The app's CoinCard component and the
 * static home page's renderer both read this shape, so the order cannot drift between them. Client-safe: no file reads.
 */

export type CardTagTone = "featured" | "rehearsal" | "devnet" | "grad" | "neutral";
export interface CardTag { label: string; tone: CardTagTone }

export interface CardView {
  /** unique per card ($DEFICIT appears twice before launch: the mainnet coin and the devnet rehearsal) */
  id: string;
  ticker: string;
  name: string;
  imageUrl: string | null;
  tags: CardTag[];
  /** one plain sentence under the name, on featured cards only */
  note: string | null;
  /** the rule in one line */
  rule: string;
  /** when the next result settles; null when the rule has no schedule (the row is left out, never shown empty) */
  nextSettle: string | null;
  /** the total burned, in words */
  burned: string;
  /** the bonding curve: a percentage when read, `done` once the coin trades in its own pool */
  curve: { label: string; pct: number | null; done: boolean };
  /** a mint address shown on the card (pre-launch $DEFICIT: the address exists, the coin does not) */
  mint: { address: string; label: string } | null;
  /** the coin's own page; null when there is none */
  href: string | null;
  /** "Check receipt": the newest receipt's check; null when the coin has no receipt yet */
  receipt: { href: string } | null;
}

/** The fixed row order, by key. test/burntickerHomeShell.test.ts holds the component and the static renderer to it. */
export const CARD_ROWS = ["image", "name", "ticker", "rule", "nextSettle", "burned", "curve", "receipt"] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 6" from an ISO date or time (UTC calendar day). */
export function shortDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
  return Number.isFinite(d.getTime()) ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` : null;
}

/** "4,010,874.87" from a decimal string or number (two decimals at most). */
export function groupDigits(v: string | number): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  const [i, f] = (Math.round(n * 100) / 100).toFixed(2).split(".");
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const dec = f.replace(/0+$/, "");
  return dec ? `${int}.${dec}` : int;
}

/** What the coins index (GET /api/burnticker/tokens) says about one registered coin. */
export interface IndexCoin {
  ticker: string; name: string; mint: string; oneLiner: string; status: string; imageUrl: string | null; burned: string; burns: number;
  nextCheckAt: string | null; nextCloseTime: string | null; lastBurnAt: string | null; launchedAt: string | null; pairId: string | null; badge?: string | null;
  phase: "curve" | "migrating" | "graduated" | null; progressPct: number | null;
}

/** A registered coin as a card: the same rows as the featured cards, read from the index. */
export function cardViewFromIndex(t: IndexCoin): CardView {
  const next = t.nextCloseTime ?? t.nextCheckAt;
  const tags: CardTag[] = [];
  if (t.phase === "graduated") tags.push({ label: "Trading pool", tone: "grad" });
  if (t.status === "draft") tags.push({ label: "Not launched", tone: "neutral" });
  if (t.pairId) tags.push({ label: "Pair", tone: "neutral" });
  if (t.badge) tags.push({ label: t.badge, tone: "neutral" });
  const pct = t.progressPct === null ? null : Math.max(0, Math.min(100, t.progressPct));
  const curve = t.phase === "graduated" ? { label: "Trades in its own pool", pct: 100, done: true }
    : t.phase === "migrating" ? { label: "Curve full, moving to its pool", pct: 100, done: false }
    : pct === null ? { label: "Curve not read by this site", pct: null, done: false }
    : { label: `Curve ${pct.toFixed(pct < 10 ? 1 : 0)}% full`, pct, done: false };
  return {
    id: t.mint, ticker: t.ticker, name: t.name, imageUrl: t.imageUrl, tags, note: null,
    rule: t.oneLiner.replace(/^./, (c) => c.toUpperCase()),
    nextSettle: next ? `Next result on ${shortDay(next)}` : null,
    burned: t.burns > 0 ? `${groupDigits(t.burned)} $${t.ticker} burned in ${t.burns} burn${t.burns === 1 ? "" : "s"}` : "Nothing burned yet",
    curve, mint: null,
    href: `/burnticker/t/${t.ticker}`,
    receipt: t.burns > 0 ? { href: `/burnticker/t/${t.ticker}#receipts` } : null,
  };
}
