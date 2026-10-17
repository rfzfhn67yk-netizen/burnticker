import { tokenPageData, type Platform } from "@/lib/burnticker/server";
import { activityEvents, type HomeCoin } from "@/lib/burnticker/home";
import { eventsFromStatus, type ActivityEvent } from "@/lib/burnticker/activity";
import { coinKey, sharedTickers } from "@/lib/burnticker/coinKey";
import { sampleReceipts } from "@/lib/burnticker/trustpack/samples";
import { deficitRuleSchedule, readKeeperFiles, type KeeperFiles } from "@/lib/burnticker/deficitQueue";
import { hidesDevnet, publicEvents, publicRegistryRows } from "@/lib/burnticker/devnetHide";
import { testCoinKeys, withoutTestCoins } from "@/lib/burnticker/testCoins";
import { upcomingFromKeeper, upcomingFromStatus, type UpcomingRow } from "@/lib/burnticker/upcoming";
import { webReadPlatform } from "@/lib/burnticker/webReadCache";

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
    const rows = all.filter((t) => t.status !== "draft" && t.status !== "expired");
    for (const t of rows) { listed.push({ ticker: t.ticker, mint: t.mint }); tickers.add(t.ticker); }
    // audit 2026-10-16 F-11: through the site's read cache (one batched read per 20 coins, webReadCache.ts) with the home's `lite` reads
    // (every field the activity and next-result rows use), a few coins at a time instead of one after another
    const view = await webReadPlatform(p, rows).catch(() => p);
    const reads = await settleLimited(rows.map((t) => () => tokenPageData(view, t, now, { lite: true })), FEED_READ_CONCURRENCY);
    rows.forEach((t, i) => {
      const r = reads[i];
      if (r.status === "rejected") { coins.push({ ticker: t.ticker, mint: t.mint, burns: 0, lastBurnAt: null, readOk: false, events: [] }); return; }
      const d = r.value;
      coins.push({ ticker: t.ticker, mint: t.mint, burns: d.status.burned.count, lastBurnAt: d.status.burned.lastAt ?? null, cluster: d.status.cluster, readOk: true, events: eventsFromStatus(d.status, d.receipts, coinKey(t, shared)) });
      const row = upcomingFromStatus(d.status, d.receipts, coinKey(t, shared), t.mint);
      if (row) upcoming.push(row);
    });
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

/** How many coins a feed rebuild reads at once. */
export const FEED_READ_CONCURRENCY = 6;
/** Runs the tasks at most `n` at a time, settling each. */
async function settleLimited<T>(tasks: (() => Promise<T>)[], n: number): Promise<PromiseSettledResult<T>[]> {
  const out: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => { while (next < tasks.length) { const i = next++; try { out[i] = { status: "fulfilled", value: await tasks[i]() }; } catch (reason) { out[i] = { status: "rejected", reason }; } } };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return out;
}

/**
 * THE FEEDS' MEMO (2026-10-16 prelaunch audit F-11: /api/burnticker/feeds/receipts.rss took 7 to 12 s, every request reading every coin
 * from the chain). The three feed routes share one copy per platform: served at once while younger than FEED_MEMO_MS; older, it is still
 * served at once and one rebuild starts in the background (stale while revalidate, as the home route does). A cold process waits for the
 * first build. A rebuild whose registry cannot be read keeps the last good copy; with none, its `ok: false` answer is returned (the routes
 * say 503). Feed readers poll every few minutes and the routes send max-age=300, so a one-minute copy loses nothing.
 */
export const FEED_MEMO_MS = 60_000;
/**
 * F-11 review: a copy older than this while the rebuilds fail is not served: the routes answer 503 ("unavailable"), as they do when the
 * registry cannot be read, rather than an old feed that reads as "nothing happened since".
 */
export const FEED_STALE_LIMIT_MS = 15 * 60_000;
interface FeedMemo { at: number; data: FeedData | null; inflight: Promise<FeedData> | null; failedSince: number | null; /** a rebuild started since the last good copy (F-11 re-review: one that hangs never fails) */ attemptedSince: number | null }
const feedMemos = new WeakMap<Platform, FeedMemo>();
const unavailable = (): FeedData => ({ ok: false, events: [], upcoming: [], tickers: new Set([DEFICIT_TICKER]) });
export async function cachedFeedData(p: Platform, o: { now?: () => number; root?: string } = {}): Promise<FeedData> {
  const now = o.now ?? (() => Date.now());
  let m = feedMemos.get(p);
  if (!m) { m = { at: 0, data: null, inflight: null, failedSince: null, attemptedSince: null }; feedMemos.set(p, m); }
  const memo = m;
  const rebuild = (): Promise<FeedData> => memo.inflight ??= (async () => {
    memo.attemptedSince ??= now();
    try {
      const d = await collectFeedData(p, now(), o.root ?? process.cwd());
      if (d.ok) { memo.data = d; memo.at = now(); memo.failedSince = null; memo.attemptedSince = null; } else memo.failedSince ??= now();
      return d;
    } catch (e) { console.error("[burnticker/feeds] rebuild failed:", e); memo.failedSince ??= now(); return memo.data ?? unavailable(); }
    finally { memo.inflight = null; }
  })();
  if (memo.data) {
    const age = now() - memo.at;
    if (age >= FEED_MEMO_MS) void rebuild();
    // F-11 re-review: past the limit with a rebuild that failed OR is still running (a hung read never fails), the feeds are unavailable
    if (age >= FEED_STALE_LIMIT_MS && (memo.failedSince !== null || memo.attemptedSince !== null)) return unavailable();
    return memo.data;
  }
  return rebuild();
}
