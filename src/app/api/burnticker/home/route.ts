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
import { upcomingFromKeeper, upcomingFromStatus, type UpcomingRow } from "@/lib/burnticker/upcoming";

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
  let coins: HomeCoin[] | null = [];
  try {
    for (const t of p.registry.tokens()) {
      try {
        const d = await tokenPageData(p, t, now);
        statuses.push(d.status);
        const latest = d.receipts.filter((r) => r.status === "confirmed" && r.signature).sort((a, b) => b.settledAt.localeCompare(a.settledAt))[0] ?? null;
        const readiness = readinessFromStatus(d.status, d.receipts);
        coins.push({ ...homeCoinOf(d.status), cluster: d.status.cluster, latestSignature: latest?.signature ?? null, readOk: true, readiness, events: eventsFromStatus(d.status, d.receipts) });
        const row = upcomingFromStatus(d.status, d.receipts);
        if (row) upcoming.push(row);
      } catch { coins.push({ ticker: t.ticker, mint: t.mint, burns: 0, lastBurnAt: null, readOk: false }); }
    }
  } catch { coins = null; }
  let audit = null;
  try { const a = readAudit(p.publishDir); audit = a ? { ok: a.ok, ranAt: a.ranAt, receipts: a.receipts, mismatches: a.mismatches.length, chainChecked: a.chainChecked } : null; } catch { audit = null; }
  const index = coins === null ? null : buildPlatformIndex(statuses, now, audit);
  let status: unknown = null;
  try { status = await currentStatusLive(); } catch { status = null; }
  const keeper = readKeeperFiles();
  // $DEFICIT's own row comes from its keeper until the coin is registered here (then its registry row above is the one)
  const sched = deficitRuleSchedule();
  if (sched && !upcoming.some((u) => u.ticker === "DEFICIT")) { const k = upcomingFromKeeper(keeper.status, keeper.burns, sched); if (k) upcoming.unshift(k); }
  return NextResponse.json({ ...homeData(coins, process.cwd(), now, index, status, siteLaunchState(process.env, now), keeper, upcoming), cluster: p.cluster }, { headers: { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
}

function homeCoinOf(s: Parameters<typeof buildPlatformIndex>[0][number]): HomeCoin {
  const c = s.market?.curve ?? null;
  return {
    ticker: s.ticker, mint: s.mint, burns: s.burned.count, burned: s.burned.total, pctOfSupply: s.burned.pctOfSupply, lastBurnAt: s.burned.lastAt ?? null,
    launchedAt: s.launchedAt ?? null, phase: s.market?.phase ?? null, progressPct: c ? c.progressPct : s.market?.phase === "graduated" ? 100 : null,
    raised: c?.raised ?? null, threshold: c?.threshold ?? null, quote: c?.quote ?? null, marketCap: c?.marketCap ?? null, holders: s.market?.holders.count ?? null,
  };
}
