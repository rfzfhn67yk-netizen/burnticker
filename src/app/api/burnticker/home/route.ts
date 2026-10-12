import { NextResponse } from "next/server";
import { platform, tokenPageData } from "@/lib/burnticker/server";
import { buildPlatformIndex } from "@/lib/burnticker/tokenPage";
import { homeData, type HomeCoin } from "@/lib/burnticker/home";
import { currentStatusLive } from "@/lib/burnticker/currentStatus";
import { readAudit } from "@/lib/burnticker/trust";
import { siteLaunchState } from "@/lib/burnticker/launchAvailability";

export const dynamic = "force-dynamic";

/**
 * The home page's featured cards, activity line, platform strip and one-line status (src/lib/burnticker/home.ts), for the app's home and
 * the static landing page alike. Confirmed burns only, each with its own receipt. A coin whose page fails to read is marked unreadable
 * (its featured card says "Unavailable"), never invented; a registry that cannot be read at all passes null, never an empty list.
 */
export async function GET() {
  const p = platform();
  const now = Date.now();
  const statuses = [];
  let coins: HomeCoin[] | null = [];
  try {
    for (const t of p.registry.tokens()) {
      try {
        const d = await tokenPageData(p, t, now);
        statuses.push(d.status);
        const latest = d.receipts.filter((r) => r.status === "confirmed" && r.signature).sort((a, b) => b.settledAt.localeCompare(a.settledAt))[0] ?? null;
        coins.push({ ...homeCoinOf(d.status), cluster: d.status.cluster, latestSignature: latest?.signature ?? null, readOk: true });
      } catch { coins.push({ ticker: t.ticker, mint: t.mint, burns: 0, lastBurnAt: null, readOk: false }); }
    }
  } catch { coins = null; }
  let audit = null;
  try { const a = readAudit(p.publishDir); audit = a ? { ok: a.ok, ranAt: a.ranAt, receipts: a.receipts, mismatches: a.mismatches.length, chainChecked: a.chainChecked } : null; } catch { audit = null; }
  const index = coins === null ? null : buildPlatformIndex(statuses, now, audit);
  let status: unknown = null;
  try { status = await currentStatusLive(); } catch { status = null; }
  return NextResponse.json({ ...homeData(coins, process.cwd(), now, index, status, siteLaunchState(process.env, now)), cluster: p.cluster }, { headers: { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
}

function homeCoinOf(s: Parameters<typeof buildPlatformIndex>[0][number]): HomeCoin {
  const c = s.market?.curve ?? null;
  return {
    ticker: s.ticker, mint: s.mint, burns: s.burned.count, burned: s.burned.total, pctOfSupply: s.burned.pctOfSupply, lastBurnAt: s.burned.lastAt ?? null,
    launchedAt: s.launchedAt ?? null, phase: s.market?.phase ?? null, progressPct: c ? c.progressPct : s.market?.phase === "graduated" ? 100 : null,
    raised: c?.raised ?? null, threshold: c?.threshold ?? null, quote: c?.quote ?? null, marketCap: c?.marketCap ?? null, holders: s.market?.holders.count ?? null,
  };
}
