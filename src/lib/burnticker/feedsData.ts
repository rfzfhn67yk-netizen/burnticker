import { tokenPageData, type Platform } from "@/lib/burnticker/server";
import { activityEvents, type HomeCoin } from "@/lib/burnticker/home";
import { eventsFromStatus, type ActivityEvent } from "@/lib/burnticker/activity";
import { coinKey, sharedTickers } from "@/lib/burnticker/coinKey";
import { sampleReceipts } from "@/lib/burnticker/trustpack/samples";
import { deficitRuleSchedule, readKeeperFiles, type KeeperFiles } from "@/lib/burnticker/deficitQueue";
import { hidesDevnet, publicEvents, publicRegistryRows } from "@/lib/burnticker/devnetHide";
import { testCoinKeys, withoutTestCoins } from "@/lib/burnticker/testCoins";
import { upcomingFromKeeper, upcomingFromStatus, type UpcomingRow } from "@/lib/burnticker/upcoming";

/**
 * WHAT THE FEEDS READ (polish-1, 2026-10-12). The same rows as the home API (src/app/api/burnticker/home/route.ts): each registered
 * coin's status and receipts through tokenPageData, the $DEFICIT keeper's published files (status.json, burns.json) while $DEFICIT is not
 * registered here, and the devnet rehearsal's evidence; then activity.ts and upcoming.ts turn them into rows. A coin whose page cannot
 * be read is skipped (the home card says "Unavailable" for it); a registry that cannot be read at all makes `ok` false, and the routes
 * answer 503 instead of an empty feed that would read as "nothing happened".
 */
export interface FeedData { ok: boolean; events: ActivityEvent[]; upcoming: UpcomingRow[]; tickers: Set<string>; /** the launched coins (tickers are not unique; a coin feed resolves by mint) */ coins?: { ticker: string; mint: string }[] }

export const DEFICIT_TICKER = "DEFICIT";

export async function collectFeedData(p: Platform, now = Date.now(), root = process.cwd(), keeper: KeeperFiles | null = readKeeperFiles(process.env, root)): Promise<FeedData> {
  const coins: HomeCoin[] = [];
  const upcoming: UpcomingRow[] = [];
  const tickers = new Set<string>([DEFICIT_TICKER]);
  const listed: { ticker: string; mint: string }[] = [];
  try {
    const all = withoutTestCoins(publicRegistryRows(p.registry.tokens(), p.cluster), testCoinKeys(root, p.registry));
    const shared = sharedTickers(all.filter((t) => t.status !== "draft"));
    for (const t of all) {
      if (t.status === "draft" || t.status === "expired") continue;
      listed.push({ ticker: t.ticker, mint: t.mint });
      tickers.add(t.ticker);
      try {
        const d = await tokenPageData(p, t, now);
        coins.push({ ticker: t.ticker, mint: t.mint, burns: d.status.burned.count, lastBurnAt: d.status.burned.lastAt ?? null, cluster: d.status.cluster, readOk: true, events: eventsFromStatus(d.status, d.receipts, coinKey(t, shared)) });
        const row = upcomingFromStatus(d.status, d.receipts, coinKey(t, shared), t.mint);
        if (row) upcoming.push(row);
      } catch { coins.push({ ticker: t.ticker, mint: t.mint, burns: 0, lastBurnAt: null, readOk: false, events: [] }); }
    }
  } catch { return { ok: false, events: [], upcoming: [], tickers, coins: listed }; }
  let samples = null;
  try { samples = sampleReceipts(root); } catch { samples = null; }
  // owner decision 2026-10-12: a mainnet host's feeds carry no devnet row and no devnet registry row (devnetHide.ts)
  const events = publicEvents(activityEvents(coins, samples, 1000, keeper), p.cluster);
  for (const e of events) tickers.add(e.ticker.toUpperCase());
  const sched = deficitRuleSchedule(root);
  if (keeper && sched && !upcoming.some((u) => u.ticker === DEFICIT_TICKER)) { const k = upcomingFromKeeper(keeper.status, keeper.burns, sched); if (k) upcoming.unshift(k); }
  return { ok: true, events, upcoming: hidesDevnet(p.cluster) ? upcoming.filter((u) => u.network !== "devnet") : upcoming, tickers, coins: listed };
}
