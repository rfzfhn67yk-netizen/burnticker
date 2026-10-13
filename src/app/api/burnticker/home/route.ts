import { NextResponse } from "next/server";
import { platform, tokenPageData } from "@/lib/burnticker/server";
import { buildPlatformIndex } from "@/lib/burnticker/tokenPage";
import { homeData, type HomeCoin } from "@/lib/burnticker/home";
import { currentStatusLive } from "@/lib/burnticker/currentStatus";
import { readAudit } from "@/lib/burnticker/trust";
import { siteLaunchState } from "@/lib/burnticker/launchAvailability";
import { eventsFromStatus } from "@/lib/burnticker/activity";
import { readinessFromStatus } from "@/lib/burnticker/readiness";
import { deficitRuleSchedule, readKeeperFiles } from "@/lib/burnticker/deficitQueue";
import { upcomingFromKeeper, upcomingFromStatus, upcomingSet, type UpcomingOmitted, type UpcomingRow } from "@/lib/burnticker/upcoming";
import { deficitCreated, rehearsalCreate, type RehearsalCurve } from "@/lib/burnticker/home";
import { readKeeperCurve } from "@/lib/burnticker/market";
import { featuredSlots, type FeaturedInput } from "@/lib/burnticker/featuredSlots";
import { rankLines } from "@/lib/burnticker/coinRank";
import { leagueData } from "@/lib/burnticker/leaguesServe";
import { publicRegistryRows } from "@/lib/burnticker/devnetHide";
import { coinKey, sharedTickers } from "@/lib/burnticker/coinKey";

export const dynamic = "force-dynamic";

/**
 * The home page's featured cards, activity line, platform strip and one-line status (src/lib/burnticker/home.ts), for the app's home and
 * the static landing page alike. A coin whose page fails to read is marked unreadable (its featured card says "Unavailable"), never
 * invented; a registry that cannot be read at all passes null, never an empty list. Since website-14 it also carries each coin's own
 * activity rows (burns, signed readings, graduation, pool registration), where each coin stands, the next result each coin waits for,
 * and the $DEFICIT queued-units counter from its keeper's published files (data/burnkeeper-site, or BURNKEEPER_PUBLISH_DIR).
 */
export async function GET() {
  const p = platform();
  const now = Date.now();
  const statuses = [];
  const upcoming: UpcomingRow[] = [];
  // website-15 (code review 6, P2 2): a coin whose page fails is named in `omitted`, and an unread registry is `registered: null`
  const omitted: UpcomingOmitted[] = [];
  let registered: number | null = null;
  let coins: HomeCoin[] | null = [];
  // website-17 wiring item 3: the earned featured slots, from each coin's own receipts, creation time and readiness (featuredSlots.ts)
  const slotInputs: FeaturedInput[] = [];
  try {
    // owner decision 2026-10-12: a mainnet host lists no registry row on the devnet cluster (devnetHide.ts)
    const tokens = publicRegistryRows(p.registry.tokens(), p.cluster);
    registered = tokens.length;
    // tickers are not unique (owner 2026-10-12): a coin whose ticker another coin shares links by its mint
    const shared = sharedTickers(tokens);
    for (const t of tokens) {
      const key = coinKey(t, shared);
      try {
        const d = await tokenPageData(p, t, now);
        statuses.push(d.status);
        const latest = d.receipts.filter((r) => r.status === "confirmed" && r.signature).sort((a, b) => b.settledAt.localeCompare(a.settledAt))[0] ?? null;
        const readiness = readinessFromStatus(d.status, d.receipts);
        coins.push({ ...homeCoinOf(d.status), cluster: d.status.cluster, latestSignature: latest?.signature ?? null, readOk: true, readiness, events: eventsFromStatus(d.status, d.receipts, key) });
        slotInputs.push({ ticker: d.status.ticker, group: d.status.cluster === "mainnet" && d.status.status !== "draft" ? "public" : "test", burns: d.receipts.filter((r) => r.status === "confirmed").map((r) => ({ settledAt: r.settledAt })), createdAt: d.status.launchedAt ?? null, poolRegistered: ["awaiting-event", "below-floor", "deferred", "burned"].includes(readiness.state) });
        const row = upcomingFromStatus(d.status, d.receipts, key, t.mint);
        if (row) upcoming.push(row);
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
  if (rh && p.market && p.cluster === "mainnet") rehearsalCurve = await readKeeperCurve(p.market, { cluster: "mainnet", mint: rh.mint, poolId: rh.poolId }, now);
  // website-17 wiring items 2 and 3: each coin's rank line (never a guessed rank) and the earned featured slots
  const ranks = (() => { try { return rankLines(leagueData(p, now).coins); } catch { return null; } })();
  if (coins && ranks) coins = coins.map((c) => ({ ...c, rank: ranks.get(c.ticker)?.line ?? null }));
  const slots = coins === null ? null : featuredSlots(slotInputs, now);
  return NextResponse.json({ ...homeData(coins, process.cwd(), now, index, status, siteLaunchState(process.env, now), keeper, next, rehearsalCurve, p.cluster), featuredSlots: slots, cluster: p.cluster }, { headers: { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
}

function homeCoinOf(s: Parameters<typeof buildPlatformIndex>[0][number]): HomeCoin {
  const c = s.market?.curve ?? null;
  return {
    ticker: s.ticker, mint: s.mint, burns: s.burned.count, burned: s.burned.total, pctOfSupply: s.burned.pctOfSupply, lastBurnAt: s.burned.lastAt ?? null,
    launchedAt: s.launchedAt ?? null, phase: s.market?.phase ?? null, progressPct: c ? c.progressPct : s.market?.phase === "graduated" ? 100 : null,
    raised: c?.raised ?? null, threshold: c?.threshold ?? null, quote: c?.quote ?? null, marketCap: c?.marketCap ?? null, holders: s.market?.holders.count ?? null,
  };
}
