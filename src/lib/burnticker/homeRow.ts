import type { HomeCoin } from "@/lib/burnticker/home";
import type { TokenStatusJson, ReceiptJson } from "@/lib/burnticker/tokenPage";
import { eventsFromStatus } from "@/lib/burnticker/activity";
import { onlyPoolHolders } from "@/lib/burnticker/cardView";
import { coinStatusFactsOf } from "@/lib/burnticker/coinStatus";
import { readinessFromStatus } from "@/lib/burnticker/readiness";
import { upcomingFromStatus, type UpcomingRow } from "@/lib/burnticker/upcoming";
import type { FeaturedInput } from "@/lib/burnticker/featuredSlots";

/**
 * ONE COIN'S PART OF THE HOME (2026-10-15, moved out of the home route so a test can hold it): the card, the featured-slot input and the
 * next-result row, from the coin's status and receipts. These, plus the platform index's totals (burns, burned tokens), are every field
 * of a coin's status the home reads; server.ts tokenPageInput `lite` reads exactly what they need. Pure.
 */
export interface HomeRow { coin: HomeCoin; slot: FeaturedInput; upcoming: UpcomingRow | null }

export function homeCoinOf(s: TokenStatusJson): HomeCoin {
  const c = s.market?.curve ?? null;
  return {
    ticker: s.ticker, mint: s.mint, burns: s.burned.count, burned: s.burned.total, pctOfSupply: s.burned.pctOfSupply, lastBurnAt: s.burned.lastAt ?? null,
    launchedAt: s.launchedAt ?? null, phase: s.market?.phase ?? null, progressPct: c ? c.progressPct : s.market?.phase === "graduated" ? 100 : null,
    raised: c?.raised ?? null, threshold: c?.threshold ?? null, quote: c?.quote ?? null, marketCap: c?.marketCap ?? null, holders: s.market?.holders.count ?? null,
    holdersOnlyPools: onlyPoolHolders(s.market?.holders.count ?? null, s.market?.holders.top10 ?? null),
  };
}

/** `key`: the coin's URL key (coinKey.ts); `mint`: its registry mint (the next-result row's link). */
export function homeRowOf(status: TokenStatusJson, receipts: ReceiptJson[], key: string, mint: string): HomeRow {
  const latest = receipts.filter((r) => r.status === "confirmed" && r.signature).sort((a, b) => b.settledAt.localeCompare(a.settledAt))[0] ?? null;
  const readiness = readinessFromStatus(status, receipts);
  return {
    coin: { ...homeCoinOf(status), cluster: status.cluster, latestSignature: latest?.signature ?? null, readOk: true, readiness, events: eventsFromStatus(status, receipts, key), statusFacts: coinStatusFactsOf(status, receipts) },
    slot: { ticker: status.ticker, mint: status.mint, group: status.cluster === "mainnet" && status.status !== "draft" ? "public" : "test", burns: receipts.filter((r) => r.status === "confirmed").map((r) => ({ settledAt: r.settledAt })), createdAt: status.launchedAt ?? null, poolRegistered: ["awaiting-event", "below-floor", "deferred", "burned"].includes(readiness.state) },
    upcoming: upcomingFromStatus(status, receipts, key, mint),
  };
}
