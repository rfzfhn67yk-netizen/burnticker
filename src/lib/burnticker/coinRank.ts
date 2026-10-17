import { seasonBoards, type SeasonCoinInput } from "@/lib/burnticker/seasons";

/**
 * A COIN'S LINE ON THE SCOREBOARD (website-17, creator benefits item 2, 2026-10-12). Read from the registry's rows, never guessed:
 *
 *   a coin in a season (seasons.ts seasonBoards, the Seasons page's own ranking):  "Ranked 2 of 9 in NHL 2026–27 by receipts."
 *   any other coin, by its confirmed receipts against every registered coin:          "4 receipts, the 3rd most on this site."
 *
 * A rank is a line on a scoreboard and nothing more: it pays nothing and unlocks nothing. Ties are said as ties. A coin with no receipt
 * outside a season has no place to state, so its line says so. Pure and client-safe; leaguesServe.ts leagueData() feeds it.
 */

export interface RankView {
  ticker: string;
  /** The full sentence for a card or a coin page. */
  line: string;
  /** The board's label ("NHL 2026–27") when the coin is ranked inside a season, else null. */
  season: string | null;
  /** 1-based place; null when the coin has no receipt outside a season. */
  rank: number | null;
  /** How many coins the place is out of (the season's coins, or every registered coin). */
  of: number;
  receipts: number;
  tied: boolean;
}

const ORD = ["th", "st", "nd", "rd"];
/** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
export function ordinal(n: number): string {
  const v = n % 100;
  return `${n}${ORD[(v - 20) % 10] ?? ORD[v] ?? ORD[0]}`;
}

const receiptsText = (n: number) => `${n} receipt${n === 1 ? "" : "s"}`;

/** Every coin's rank line, keyed by ticker. Season boards first (window "season" or "post"); every other coin by receipts site-wide. */
export function rankLines(coins: readonly SeasonCoinInput[]): Map<string, RankView> {
  const out = new Map<string, RankView>();
  for (const b of seasonBoards(coins)) {
    // review follow-up 7: a head-to-head card holds unrelated matchups (PIT v BAL next to DAL v PHI), so it ranks nobody
    if (b.window === "other" || b.window === "meetings") continue;
    for (const r of b.rows) {
      const tied = b.rows.some((x) => x.ticker !== r.ticker && x.receipts === r.receipts);
      out.set(r.ticker, { ticker: r.ticker, line: `Ranked ${r.rank} of ${b.rows.length} in ${b.label} by receipts.`, season: b.label, rank: r.rank, of: b.rows.length, receipts: r.receipts, tied });
    }
  }
  const all = coins.map((c) => ({ ticker: c.ticker, receipts: c.burns.length }));
  for (const c of all) {
    if (out.has(c.ticker)) continue;
    if (c.receipts === 0) { out.set(c.ticker, { ticker: c.ticker, line: "No receipts yet, so it has no rank on this site.", season: null, rank: null, of: all.length, receipts: 0, tied: false }); continue; }
    const rank = 1 + all.filter((x) => x.receipts > c.receipts).length;
    const tied = all.some((x) => x.ticker !== c.ticker && x.receipts === c.receipts);
    const place = rank === 1 ? "most" : `${ordinal(rank)} most`;
    out.set(c.ticker, { ticker: c.ticker, line: `${receiptsText(c.receipts)}, ${tied ? "tied for the" : "the"} ${place} on this site.`, season: null, rank, of: all.length, receipts: c.receipts, tied });
  }
  return out;
}

/** "This week" on these pages means the seven days before the page was read. */
export const WEEK_MS = 7 * 86_400_000;
export const WEEK_MEANING = "This week means the seven days before this page was read.";

/** Confirmed receipts settled in the seven days before `nowMs`. */
export const receiptsThisWeek = (burns: readonly { settledAt: string }[], nowMs: number): number =>
  burns.filter((b) => { const t = Date.parse(b.settledAt); return Number.isFinite(t) && t <= nowMs && nowMs - t < WEEK_MS; }).length;

/**
 * The weekly summary a creator can copy (Your coins): "$RAYS26 this week: 3 receipts. Ranked 2 of 9 in MLB 2026 by receipts." Plain text,
 * lint-clean, real numbers only. With no rank read, the second sentence says the rank is unavailable.
 */
export function weeklySummary(ticker: string, week: number, rank: RankView | null): string {
  return `$${ticker} this week: ${receiptsText(week)}. ${rank ? rank.line : "Its rank is unavailable because this site could not read the registry."}`;
}
