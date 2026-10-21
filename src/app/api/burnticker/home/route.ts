import { NextResponse } from "next/server";
import { platform, tokenPageData } from "@/lib/burnticker/server";
import { buildPlatformIndex, type TokenStatusJson } from "@/lib/burnticker/tokenPage";
import { auditForIndex, homeData, type HomeCoin } from "@/lib/burnticker/home";
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
import { chainRows, homeMemoState, memoWindowMs, webReadCachedView, webReadPlatform } from "@/lib/burnticker/webReadCache";
import { stageClock, type StageClock } from "@/lib/burnticker/buildStages";
import { LIST_BUILD_BUDGETS, earlierReadsNote, readAgoText, readCoinsBounded, anyReadLate } from "@/lib/burnticker/boundedReads";
import { PUBLIC_READ_CORS } from "@/lib/burnticker/api/http";
import { SWR_BUILD_TIMEOUT_MS } from "@/lib/burnticker/keyedSwr";
import { isVisitorRequest, memoRefresher } from "@/lib/burnticker/memoRefresher";

export const dynamic = "force-dynamic";

/**
 * The last answer is served at once and refreshed in the background once it is older than its memo window (webReadCache.ts memoWindowMs; stale while revalidate,
 * one refresh in flight at a time; HB-145: a timer rebuilds it too, and no request waits while a copy exists). A cold process waits up to HOME_COLD_WAIT_MS for the first build, then answers 503 with
 * retry-after so the page tries again instead of sitting behind the proxy's 20 s limit. The deploy warms it with a probe.
 */
const HOME_COLD_WAIT_MS = 15_000;
// 2026-10-15 prelaunch audit M7: the memo window scales with the coins read from the chain (webReadCache.ts memoWindowMs): 15 s under 50
let homeMemo: { at: number; body: unknown; memoMs: number } | null = null;
let homeInFlight: Promise<void> | null = null;
// HB-99 residue (hourly run 8): a refresh in flight past SWR_BUILD_TIMEOUT_MS is dropped and another starts; a dropped build that lands
// late never overwrites a newer answer (the sequence numbers)
let homeInFlightAt = 0, homeSeq = 0, homeWritten = 0;
function refreshHome(): Promise<void> {
  if (homeInFlight && Date.now() - homeInFlightAt >= SWR_BUILD_TIMEOUT_MS) {
    console.error(`[burnticker/home] a refresh has been in flight for more than ${Math.round(SWR_BUILD_TIMEOUT_MS / 1000)} s; starting another`);
    homeInFlight = null;
  }
  if (!homeInFlight) {
    const mine = ++homeSeq;
    homeInFlightAt = Date.now();
    const p: Promise<void> = buildHome().then(({ body, memoMs }) => { if (mine > homeWritten) { homeWritten = mine; homeMemo = { at: Date.now(), body, memoMs }; } }).catch((e) => { console.error("[burnticker/home] build failed:", e); }).finally(() => { if (homeInFlight === p) homeInFlight = null; });
    homeInFlight = p;
  }
  return homeInFlight;
}

// HB-145 (2026-10-20): the memo is rebuilt by a timer behind the requests (memoRefresher.ts); a request never waits for a rebuild while
// there is a copy to serve, only for the very first build after a start
const homeRefresher = memoRefresher({ refresh: refreshHome, ageMs: () => (homeMemo ? Date.now() - homeMemo.at : null), freshMs: () => homeMemo?.memoMs ?? 15_000 });

// HB-145 second half (2026-10-20): the last good one-line status and rehearsal curve, used when their read runs past its stage budget
let lastStatus: unknown = null;
let lastRehearsal: RehearsalCurve = null;

/**
 * The home page's featured cards, activity line, platform strip and one-line status (src/lib/burnticker/home.ts), for the app's home and
 * the static landing page alike. A coin whose page fails to read is marked unreadable (its featured card says "Unavailable"), never
 * invented; a registry that cannot be read at all passes null, never an empty list. Since website-14 it also carries each coin's own
 * activity rows (burns, signed readings, graduation, pool registration), where each coin stands, the next result each coin waits for,
 * and the $DEFICIT queued-units counter from its keeper's published files (data/burnkeeper-site, or BURNKEEPER_PUBLISH_DIR).
 * Every answer carries the public-read CORS header (audit 2026-10-15 F5): the $DEFICIT shell on its own host reads `launch` from here.
 */
export async function GET(req: Request) {
  // HB-163: the start-up warm call (x-burnticker-warm: 1) is not a visitor, so it starts no timer
  homeRefresher.touch(isVisitorRequest(req));
  if (homeMemo) {
    // HB-145: past the window, a rebuild starts behind this answer; the answer never waits for it (the last copy is served, and a copy past
    // its maximum age says so below: no-store and its age)
    const state = homeMemoState(Date.now() - homeMemo.at, homeMemo.memoMs);
    if (state !== "hit") void refreshHome();
    const m = homeMemo as { at: number; body: unknown; memoMs: number };
    const age = Date.now() - m.at;
    // HB-99 residue: an answer still too old after the wait says its real age and is never cached under the 10 s header
    if (homeMemoState(age, m.memoMs) === "stale") return NextResponse.json(m.body, { headers: { ...PUBLIC_READ_CORS, "cache-control": "no-store", "x-home-memo": "stale", "x-home-age-sec": String(Math.round(age / 1000)) } });
    return NextResponse.json(m.body, { headers: { ...PUBLIC_READ_CORS, "cache-control": "public, max-age=10, s-maxage=15, stale-while-revalidate=30", "x-home-memo": "hit" } });
  }

  await Promise.race([refreshHome(), new Promise<void>((r) => setTimeout(r, HOME_COLD_WAIT_MS))]);
  if (homeMemo) return NextResponse.json((homeMemo as { body: unknown }).body, { headers: { ...PUBLIC_READ_CORS, "cache-control": "public, max-age=10, s-maxage=15, stale-while-revalidate=30", "x-home-memo": "cold" } });
  return NextResponse.json({ loading: true, error: "the coin list is being read; try again in a few seconds", code: "home-loading", retryAfterSec: 5 }, { status: 503, headers: { ...PUBLIC_READ_CORS, "cache-control": "no-store", "retry-after": "5" } });
}

/**
 * HB-145 second half (2026-10-20): the build is timed stage by stage (buildStages.ts) and the line names the stage a slow build waited on:
 * "[burnticker/home] built in 17208 ms, 26 coins: registry 12, batch 410, chain 6000 (over its 6000 ms budget), …; cpu 140 ms, loop max
 * 22 ms, budget store 3 ms; 2 coins from an earlier read (…)". The chain stage reads every coin under one deadline (boundedReads.ts): a
 * coin whose read is late is served from its last good read, marked with that read's time.
 */
async function buildHome(): Promise<{ body: unknown; memoMs: number }> {
  const clock = stageClock();
  const { body, n, chainCoins } = await buildHomeBody(clock);
  console.info(clock.line("[burnticker/home]", `${n} coins`));
  return { body, memoMs: memoWindowMs(chainCoins) };
}

async function buildHomeBody(clock: StageClock): Promise<{ body: unknown; n: number; chainCoins: number }> {
  const B = LIST_BUILD_BUDGETS;
  for (const [k, v] of [["registry", B.registryMs], ["shape", B.shapeMs], ["chain", B.chainMs]] as const) clock.budget(k, v);
  const p = platform();
  const now = Date.now();
  const statuses: TokenStatusJson[] = [];
  const upcoming: UpcomingRow[] = [];
  // website-15 (code review 6, P2 2): a coin whose page fails is named in `omitted`, and an unread registry is `registered: null`
  const omitted: UpcomingOmitted[] = [];
  let registered: number | null = null;
  let coins: HomeCoin[] | null = [];
  let chainCoins = 0;
  // website-17 wiring item 3: the earned featured slots, from each coin's own receipts, creation time and readiness (featuredSlots.ts)
  const slotInputs: FeaturedInput[] = [];
  // owner 2026-10-14: test coins (testCoins.ts) are left off the home: no card, no activity row, no next-result row
  const tests = clock.run("registry", () => testCoinKeys(process.cwd(), p.registry));
  try {
    // owner decision 2026-10-12: a mainnet host lists no registry row on the devnet cluster (devnetHide.ts)
    const tokens = clock.run("registry", () => withoutTestCoins(publicRegistryRows(p.registry.tokens(), p.cluster), tests));
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
    // HB-145 second half: the batch has a budget; past it the coin reads go on through the cache while the batch lands behind them
    const view = await clock.bounded("batch", B.batchMs, () => webReadPlatform(p, tokens), () => webReadCachedView(p), { onError: () => webReadCachedView(p) });
    // six at a time, under one deadline (boundedReads.ts): a coin whose read is late is served from its last good read, marked with its age
    const reads = await clock.run("chain", () => readCoinsBounded(tokens.map((t) => ({ key: `lite:${t.mint}`, read: () => tokenPageData(view, t, now, { lite: true }) })), { concurrency: 6, deadlineMs: B.chainMs, coldDeadlineMs: B.chainColdMs, scope: p.registry }));    clock.note(earlierReadsNote(tokens.map((t, i) => ({ ticker: t.ticker, r: reads[i] })), Date.now())); if (anyReadLate(reads)) clock.markOver("chain");
    clock.run("shape", () => {
      for (const [i, t] of tokens.entries()) {
        const key = coinKey(t, shared);
        try {
          const r = reads[i];
          if (r.state === "failed") throw r.error;
          const d = r.value;
          statuses.push(d.status);
          const row = homeRowOf(d.status, d.receipts, key, t.mint);
          // a coin served from an earlier read says when it was read ("read 3 minutes ago"); a fresh one carries no mark
          coins!.push(r.state === "earlier" ? { ...row.coin, readAt: new Date(r.at).toISOString(), readNote: readAgoText(r.at, now) } : row.coin);
          slotInputs.push(row.slot);
          if (row.upcoming) upcoming.push(row.upcoming);
        } catch (e) {
          console.error(`[burnticker/home] ${t.ticker}: the coin's page could not be read:`, e);
          coins!.push({ ticker: t.ticker, mint: t.mint, burns: 0, lastBurnAt: null, readOk: false });
          omitted.push({ ticker: t.ticker, reason: "This site could not read the coin's page." });
        }
      }
    });
  } catch (e) { console.error("[burnticker/home] the coin registry could not be read:", e); coins = null; registered = null; }
  let audit = null;
  try { const a = clock.run("files", () => readAudit(p.publishDir)); audit = auditForIndex(a); } catch { audit = null; }
  const index = coins === null ? null : clock.run("shape", () => buildPlatformIndex(statuses, now, audit));
  // the one-line status reads two clusters' program accounts (five-minute cache); past its budget the last good status is used
  const status: unknown = await clock.bounded("status", B.statusMs, async () => { const s = await currentStatusLive(); lastStatus = s; return s; }, () => lastStatus, { onError: () => null });
  const keeper = clock.run("files", () => readKeeperFiles());
  // $DEFICIT's own row comes from its keeper until the coin is registered here (then its registry row above is the one)
  const sched = clock.run("files", () => deficitRuleSchedule());
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
  if (rh && !isTestCoin(tests, { mint: rh.mint }) && p.market && p.cluster === "mainnet") {
    const curve = readKeeperCurve(p.market, { cluster: "mainnet", mint: rh.mint, poolId: rh.poolId }, now).then((c) => { lastRehearsal = c; return c; });
    rehearsalCurve = await clock.bounded("rehearsal", B.rehearsalMs, () => curve, () => lastRehearsal);
  }
  // website-17 wiring items 2 and 3: each coin's rank line (never a guessed rank) and the earned featured slots
  const ranks = clock.run("ranks", () => { try { return rankLines(leagueData(p, now).coins); } catch { return null; } });
  if (coins && ranks) coins = coins.map((c) => ({ ...c, rank: (c.mint ? ranks.get(c.mint)?.line : null) ?? null }));
  return clock.run("shape", () => {
    const slots = coins === null ? null : featuredSlots(slotInputs, now);
    return { n: coins?.length ?? 0, chainCoins, body: { ...homeData(coins, process.cwd(), now, index, status, siteLaunchState(process.env, now), keeper, next, rehearsalCurve, p.cluster, tests), featuredSlots: slots, cluster: p.cluster } };
  });
}

