import { publicPairs } from "@/lib/burnticker/publicPairs";
import "server-only";
import type { Platform } from "@/lib/burnticker/server";
import { DECIMALS, TOTAL_SUPPLY } from "@/lib/burnticker/rules";
import type { SeasonCoinInput } from "@/lib/burnticker/seasons";
import type { GameReading } from "@/lib/burnticker/leagues";

/**
 * The registry rows the league pages, the leagues index and the sitemap read (leagues.ts, sitemap.ts): every live and retired coin as
 * seasons.ts's SeasonCoinInput (the same mapping the Seasons page makes), and the readings of the team coins' selectors over the last
 * eight days. Memoised for 60 s per process: the pages are server-rendered, and this is their cache.
 */

const TTL_MS = 60_000;
let memo: { at: number; registry: unknown; v: { coins: SeasonCoinInput[]; readings: GameReading[]; pairs: { pairId: string }[]; tickers: { ticker: string; mint: string; status: string; at: number }[] } } | null = null;

export function leagueData(p: Platform, nowMs = Date.now()): { coins: SeasonCoinInput[]; readings: GameReading[]; pairs: { pairId: string }[]; tickers: { ticker: string; mint: string; status: string; at: number }[] } {
  if (memo && memo.registry === p.registry && nowMs - memo.at < TTL_MS) return memo.v;
  const supplyRaw = BigInt(TOTAL_SUPPLY) * BigInt(10) ** BigInt(DECIMALS);
  const rows = [...p.registry.tokens("live"), ...p.registry.tokens("paused"), ...p.registry.tokens("retired")];
  const coins: SeasonCoinInput[] = rows.map((t) => {
    const burns = p.registry.receipts(t.mint).filter((b) => b.status === "confirmed" && (b.burnRaw ?? BigInt(0)) > BigInt(0)).map((b) => ({ settledAt: b.settledAt }));
    return { ticker: t.ticker, mint: t.mint, rule: p.registry.lockedRule(t).rule, burns, burnedPct: Number((p.registry.totalBurnedRaw(t.mint) * BigInt(1_000_000)) / supplyRaw) / 10_000, launchedAt: t.baselineAt, ended: p.registry.ruleEnd(t.mint) !== null };
  });
  const since = new Date(nowMs - 8 * 86_400_000).toISOString();
  const keys = [...new Set(rows.filter((t) => /^catalogue:espn\.(team|game):/.test(t.selectorKey)).map((t) => t.selectorKey))];
  const readings: GameReading[] = keys.flatMap((k) => p.registry.readings(k, since).map((r) => ({ selectorKey: k, at: r.at, title: r.title ?? null })));
  // third prelaunch audit F09: the sitemap lists only pairs with a launched side (publicPairs.ts)
  const pairs = publicPairs(p.registry).map((x) => ({ pairId: x.pairId }));
  const tickers = rows.map((t) => ({ ticker: t.ticker, mint: t.mint, status: t.status, at: t.createdAt }));
  const v = { coins, readings, pairs, tickers };
  memo = { at: nowMs, registry: p.registry, v };
  return v;
}

/**
 * HB-35 (2026-10-20): the league pages and the sitemap read the table from a ten-minute memo (cfb/2026 took 7 to 8 s cold and
 * sitemap.xml 6.9 s, each rebuilding this table and its receipts per coin when the 60 s memo above had lapsed). The home and the coins
 * index keep the 60 s table: their rank lines move with each burn. A table built for either is reused by the other while young enough.
 */
export const LEAGUE_PAGE_TTL_MS = 10 * 60_000, HOME_TABLE_REUSE_MS = 3 * 60_000;
let pageMemo: { at: number; registry: unknown; v: ReturnType<typeof leagueData> } | null = null;
export function leagueDataForPages(p: Platform, nowMs = Date.now()): ReturnType<typeof leagueData> {
  if (pageMemo && pageMemo.registry === p.registry && nowMs - pageMemo.at < LEAGUE_PAGE_TTL_MS) return pageMemo.v;
  // HB-145: a home build refreshes the 60 s table (its rank lines read it), so a page whose ten minutes ran out takes that table (up to
  // HOME_TABLE_REUSE_MS old) instead of building one. HB-163: the table has no timer of its own; it follows the home memo's cadence (the
  // home timer builds only while visitors come), so on a quiet host a league page past its ten minutes builds it once
  if (memo && memo.registry === p.registry && nowMs - memo.at < HOME_TABLE_REUSE_MS) { pageMemo = { at: memo.at, registry: p.registry, v: memo.v }; return memo.v; }
  const v = leagueData(p, nowMs);
  pageMemo = { at: nowMs, registry: p.registry, v };
  return v;
}

/** For tests. */
export function clearLeagueMemo(): void { memo = null; pageMemo = null; }
