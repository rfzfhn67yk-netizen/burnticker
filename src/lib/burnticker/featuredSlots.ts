import { WEEK_MS } from "@/lib/burnticker/coinRank";

/**
 * EARNED FEATURED PLACEMENT, STATED (website-17, creator benefits item 3, 2026-10-12). The home grid's first cards after $DEFICIT are
 * chosen by three rules written on the page, in this order, one coin per rule and never the same coin twice:
 *
 *   1. "Most receipts this week": the coin with the most confirmed receipts in the seven days before the page was read (at least one).
 *   2. "Most recent confirmed burn": the coin whose newest confirmed burn is the latest.
 *   3. "Newest coin with a registered pool": the most recently created coin whose Raydium pool is registered with the burn program.
 *
 * Ties go to the newer burn (or the newer coin), then the ticker in alphabetical order. A rule no coin meets leaves its slot empty: there
 * is no filler, no paid place and no hand-picked place. Only public mainnet coins are considered; $DEFICIT keeps its own featured card.
 * Pure and client-safe.
 */

export type FeaturedRule = "week-receipts" | "latest-burn" | "newest-pool";

/** The label each slot carries on its card, word for word. */
export const FEATURED_LABELS: Record<FeaturedRule, string> = {
  "week-receipts": "Most receipts this week",
  "latest-burn": "Most recent confirmed burn",
  "newest-pool": "Newest coin with a registered pool",
};

/** The rules as one sentence, shown above the grid. */
export const FEATURED_RULES_LINE = "The first cards after $DEFICIT follow three rules: the coin with the most receipts this week, the coin with the most recent confirmed burn, and the newest coin with a registered pool. Nobody can pay for a place, and nobody picks one by hand.";

export interface FeaturedInput {
  ticker: string;
  /** "public" mainnet coins only take a slot */
  group: "public" | "test";
  /** confirmed receipts' settle times (ISO) */
  burns: readonly { settledAt: string }[];
  /** when the coin was created (ISO), null when not read */
  createdAt: string | null;
  /** the coin's pool is registered and verified with the burn program; null when not read (never counted as registered) */
  poolRegistered: boolean | null;
}
export interface FeaturedSlot { rule: FeaturedRule; label: string; ticker: string }

const t = (iso: string | null | undefined): number => { const v = iso ? Date.parse(iso) : NaN; return Number.isFinite(v) ? v : -Infinity; };
const newestBurn = (c: FeaturedInput): number => c.burns.reduce((m, b) => Math.max(m, t(b.settledAt)), -Infinity);

/** The slots, in rule order; a rule no coin meets is left out. */
export function featuredSlots(coins: readonly FeaturedInput[], nowMs: number): FeaturedSlot[] {
  const pool = coins.filter((c) => c.group === "public" && c.ticker !== "DEFICIT");
  const taken = new Set<string>();
  const out: FeaturedSlot[] = [];
  const pick = (rule: FeaturedRule, cands: FeaturedInput[], score: (c: FeaturedInput) => number, tie: (c: FeaturedInput) => number) => {
    const best = cands.filter((c) => !taken.has(c.ticker)).sort((a, b) => score(b) - score(a) || tie(b) - tie(a) || a.ticker.localeCompare(b.ticker))[0];
    if (!best) return;
    taken.add(best.ticker);
    out.push({ rule, label: FEATURED_LABELS[rule], ticker: best.ticker });
  };
  const week = (c: FeaturedInput) => c.burns.filter((b) => { const x = t(b.settledAt); return x <= nowMs && nowMs - x < WEEK_MS; }).length;
  pick("week-receipts", pool.filter((c) => week(c) > 0), week, newestBurn);
  pick("latest-burn", pool.filter((c) => newestBurn(c) > -Infinity), newestBurn, (c) => t(c.createdAt));
  pick("newest-pool", pool.filter((c) => c.poolRegistered === true), (c) => t(c.createdAt), () => 0);
  return out;
}
