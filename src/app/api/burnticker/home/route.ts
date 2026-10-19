import { NextResponse } from "next/server";
import { platform, tokenPageData } from "@/lib/burnticker/server";
import { buildPlatformIndex } from "@/lib/burnticker/tokenPage";
import { homeData, type HomeCoin } from "@/lib/burnticker/home";
import { currentStatusLive } from "@/lib/burnticker/currentStatus";
import { readAudit } from "@/lib/burnticker/trust";
import { siteLaunchState } from "@/lib/burnticker/launchAvailability";
import { homeRowOf } from "@/lib/burnticker/homeRow";
import { deficitRuleSchedule, readKeeperFiles } from "@/lib/burnticker/deficitQueue";
import { upcomingFromKeeper, upcomingSet, type UpcomingOmitted, type UpcomingRow } from "@/lib/burnticker/upcoming";
import { deficitCreated, rehearsalCreate, type RehearsalCurve } from "@/lib/burnticker/home";
import { readKeeperCurve } from "@/lib/burnticker/market";
import { featuredSlots, type FeaturedInput } from "@/lib/burnticker/featuredSlots";
import { rankLines } from "@/lib/burnticker/coinRank";
import { leagueData } from "@/lib/burnticker/leaguesServe";
import { publicRegistryRows } from "@/lib/burnticker/devnetHide";
import { coinKey, sharedTickers } from "@/lib/burnticker/coinKey";
import { isTestCoin, testCoinKeys, withoutTestCoins } from "@/lib/burnticker/testCoins";
import { chainRows, memoWindowMs, webReadPlatform } from "@/lib/burnticker/webReadCache";
import { PUBLIC_READ_CORS } from "@/lib/burnticker/api/http";

export const dynamic = "force-dynamic";

/**
 * The last answer is served at once and refreshed in the background once it is older than its memo window (webReadCache.ts memoWindowMs; stale while revalidate,
 * one refresh in flight at a time). A cold process waits up to HOME_COLD_WAIT_MS for the first build, then answers 503 with
 * retry-after so the page tries again instead of sitting behind the proxy's 20 s limit. The deploy warms it with a probe.
 */
const HOME_COLD_WAIT_MS = 15_000;
// 2026-10-15 prelaunch audit M7: the memo window scales with the coins read from the chain (webReadCache.ts memoWindowMs): 15 s under 50
let homeMemo: { at: number; body: unknown; memoMs: number } | null = null;
let homeInFlight: Promise<void> | null = null;
function refreshHome(): Promise<void> {
  if (!homeInFlight) homeInFlight = buildHome().then(({ body, memoMs }) => { homeMemo = { at: Date.now(), body, memoMs }; }).catch((e) => { console.error("[burnticker/home] build failed:", e); }).finally(() => { homeInFlight = null; });
  return homeInFlight;
}

/** Runs the tasks at most `n` at a time, in order, settling each (a slow coin never blocks the others beyond its own slot). */
async function allLimited<T>(tasks: (() => Promise<T>)[], n: number): Promise<PromiseSettledResult<T>[]> {
  const out: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => { while (next < tasks.length) { const i = next++; try { out[i] = { status: "fulfilled", value: await tasks[i]() }; } catch (reason) { out[i] = { status: "rejected", reason }; } } };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return out;
}

/**
 * The home page's featured cards, activity line, platform strip and one-line status (src/lib/burnticker/home.ts), for the app's home and
 * the static landing page alike. A coin whose page fails to read is marked unreadable (its featured card says "Unavailable"), never
 * invented; a registry that cannot be read at all passes null, never an empty list. Since website-14 it also carries each coin's own
 * activity rows (burns, signed readings, graduation, pool registration), where each coin stands, the next result each coin waits for,
 * and the $DEFICIT queued-units counter from its keeper's published files (data/burnkeeper-site, or BURNKEEPER_PUBLISH_DIR).
 * Every answer carries the public-read CORS header (audit 2026-10-15 F5): the $DEFICIT shell on its own host reads `launch` from here.
 */
export async function GET() {
  if (homeMemo) {
    if (Date.now() - homeMemo.at >= homeMemo.memoMs) void refreshHome();
    return NextResponse.json(homeMemo.body, { headers: { ...PUBLIC_READ_CORS, "cache-control": "public, max-age=10, s-maxage=15, stale-while-revalidate=30", "x-home-memo": "hit" } });
  }
  await Promise.race([refreshHome(), new Promise<void>((r) => setTimeout(r, HOME_COLD_WAIT_MS))]);
  if (homeMemo) return NextResponse.json((homeMemo as { body: unknown }).body, { headers: { ...PUBLIC_READ_CORS, "cache-control": "public, max-age=10, s-maxage=15, stale-while-revalidate=30", "x-home-memo": "cold" } });
  return NextResponse.json({ loading: true, error: "the coin list is being read; try again in a few seconds", code: "home-loading", retryAfterSec: 5 }, { status: 503, headers: { ...PUBLIC_READ_CORS, "cache-control": "no-store", "retry-after": "5" } });
}

async function buildHome(): Promise<{ body: unknown; memoMs: number }> {
  const started = Date.now();
  const { body, n, chainCoins } = await buildHomeBody();
  console.info(`[burnticker/home] built in ${Date.now() - started} ms, ${n} coins`);
  return { body, memoMs: memoWindowMs(chainCoins) };
}

async function buildHomeBody(): Promise<{ body: unknown; n: number; chainCoins: number }> {
  const p = platform();
  const now = Date.now();
  const statuses = [];
  const upcoming: UpcomingRow[] = [];
  // website-15 (code review 6, P2 2): a coin whose page fails is named in `omitted`, and an unread registry is `registered: null`
  const omitted: UpcomingOmitted[] = [];
  let registered: number | null = null;
  let coins: HomeCoin[] | null = [];
  let chainCoins = 0;
  // website-17 wiring item 3: the earned featured slots, from each coin's own receipts, creation time and readiness (featuredSlots.ts)
  const slotInputs: FeaturedInput[] = [];
  // owner 2026-10-14: test coins (testCoins.ts) are left off the home: no card, no activity row, no next-result row
  const tests = testCoinKeys(process.cwd(), p.registry);
  try {
    // owner decision 2026-10-12: a mainnet host lists no registry row on the devnet cluster (devnetHide.ts)
    const tokens = withoutTestCoins(publicRegistryRows(p.registry.tokens(), p.cluster), tests);
    registered = tokens.length;
    // tickers are not unique (owner 2026-10-12): a coin whose ticker another coin shares links by its mint
    const shared = sharedTickers(tokens);
    // 2026-10-15 (owner: "coins tab isn't loading"): with five live coins the reads ran one after another and took 17–40 s, past the
    // proxy's 20 s limit; they now run four at a time, and the whole answer is kept for the memo window (below). Each coin is read `lite`
    // (server.ts tokenPageInput): only what the home renders, at once, without the LP lock, the pair side, the graduated pool or balances
    // 2026-10-15: six at a time (was four): a lite read sends fewer requests than a full one, in about half the round trips, so five live
    // coins read in one wave (an estimated 4 s on Helius) instead of two
    // M7: drafts and expired drafts are built from the registry alone (server.ts); the rest read through the batch and the read cache
    chainCoins = chainRows(tokens).length;
    const view = await webReadPlatform(p, tokens);
    const reads = await allLimited(tokens.map((t) => () => tokenPageData(view, t, now, { lite: true })), 6);
    for (const [i, t] of tokens.entries()) {
      const key = coinKey(t, shared);
      try {
        const r = reads[i];
        if (r.status === "rejected") throw r.reason;
        const d = r.value;
        statuses.push(d.status);
        const row = homeRowOf(d.status, d.receipts, key, t.mint);
        coins.push(row.coin);
        slotInputs.push(row.slot);
        if (row.upcoming) upcoming.push(row.upcoming);
      } catch (e) {
        console.error(`[burnticker/home] ${t.ticker}: the coin's page could not be read:`, e);
        coins.push({ ticker: t.ticker, mint: t.mint, burns: 0, lastBurnAt: null, readOk: false });
        omitted.push({ ticker: t.ticker, reason: "This site could not read the coin's page." });
      }
    }
  } catch (e) { console.error("[burnticker/home] the coin registry could not be read:", e); coins = null; registered = null; }
  let audit = null;
  try { const a = readAudit(p.publishDir); audit = a ? { ok: a.ok, ranAt: a.ranAt, receipts: a.receipts, mismatches: a.mismatches.length, chainChecked: a.chainChecked } : null; } catch { audit = null; }
  const index = coins === null ? null : buildPlatformIndex(statuses, now, audit);
  let status: unknown = null;
  try { status = await currentStatusLive(); } catch { status = null; }
  const keeper = readKeeperFiles();
  // $DEFICIT's own row comes from its keeper until the coin is registered here (then its registry row above is the one)
  const sched = deficitRuleSchedule();
  if (sched && !upcoming.some((u) => u.ticker === "DEFICIT") && !omitted.some((o) => o.ticker === "DEFICIT")) {
    const k = upcomingFromKeeper(keeper.status, keeper.burns, sched);
    if (k) upcoming.unshift(k);
    // after the create, an unread keeper status is a missing row, not an absent coin
    else if (keeper.error && deficitCreated()) omitted.unshift({ ticker: "DEFICIT", reason: keeper.error });
  }
  const next = upcomingSet(upcoming, omitted, registered);
  // website-15 item 9: $REHEARSAL's LaunchLab pool, read like any coin's curve (one account read on a mainnet host with an RPC)
  let rehearsalCurve: RehearsalCurve = null;
  const rh = rehearsalCreate();
  if (rh && !isTestCoin(tests, { mint: rh.mint }) && p.market && p.cluster === "mainnet") rehearsalCurve = await readKeeperCurve(p.market, { cluster: "mainnet", mint: rh.mint, poolId: rh.poolId }, now);
  // website-17 wiring items 2 and 3: each coin's rank line (never a guessed rank) and the earned featured slots
  const ranks = (() => { try { return rankLines(leagueData(p, now).coins); } catch { return null; } })();
  if (coins && ranks) coins = coins.map((c) => ({ ...c, rank: (c.mint ? ranks.get(c.mint)?.line : null) ?? null }));
  const slots = coins === null ? null : featuredSlots(slotInputs, now);
  return { n: coins?.length ?? 0, chainCoins, body: { ...homeData(coins, process.cwd(), now, index, status, siteLaunchState(process.env, now), keeper, next, rehearsalCurve, p.cluster, tests), featuredSlots: slots, cluster: p.cluster } };
}

