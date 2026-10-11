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
let memo: { at: number; registry: unknown; v: { coins: SeasonCoinInput[]; readings: GameReading[]; pairs: { pairId: string }[]; tickers: { ticker: string; status: string; at: number }[] } } | null = null;

export function leagueData(p: Platform, nowMs = Date.now()): { coins: SeasonCoinInput[]; readings: GameReading[]; pairs: { pairId: string }[]; tickers: { ticker: string; status: string; at: number }[] } {
  if (memo && memo.registry === p.registry && nowMs - memo.at < TTL_MS) return memo.v;
  const supplyRaw = BigInt(TOTAL_SUPPLY) * BigInt(10) ** BigInt(DECIMALS);
  const rows = [...p.registry.tokens("live"), ...p.registry.tokens("paused"), ...p.registry.tokens("retired")];
  const coins: SeasonCoinInput[] = rows.map((t) => {
    const burns = p.registry.receipts(t.mint).filter((b) => b.status === "confirmed" && (b.burnRaw ?? BigInt(0)) > BigInt(0)).map((b) => ({ settledAt: b.settledAt }));
    return { ticker: t.ticker, mint: t.mint, rule: p.registry.lockedRule(t).rule, burns, burnedPct: Number((p.registry.totalBurnedRaw(t.mint) * BigInt(1_000_000)) / supplyRaw) / 10_000, ended: p.registry.ruleEnd(t.mint) !== null };
  });
  const since = new Date(nowMs - 8 * 86_400_000).toISOString();
  const keys = [...new Set(rows.filter((t) => /^catalogue:espn\.(team|game):/.test(t.selectorKey)).map((t) => t.selectorKey))];
  const readings: GameReading[] = keys.flatMap((k) => p.registry.readings(k, since).map((r) => ({ selectorKey: k, at: r.at, title: r.title ?? null })));
  const pairs = p.registry.pairs().map((x) => ({ pairId: x.pairId }));
  const tickers = rows.map((t) => ({ ticker: t.ticker, status: t.status, at: t.createdAt }));
  const v = { coins, readings, pairs, tickers };
  memo = { at: nowMs, registry: p.registry, v };
  return v;
}

/** For tests. */
export function clearLeagueMemo(): void { memo = null; }
