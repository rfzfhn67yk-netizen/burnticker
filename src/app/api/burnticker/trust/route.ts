import { NextResponse } from "next/server";
import { platform } from "@/lib/burnticker/server";
import { buildTrustPage, jsonSafe, web3ChainReader } from "@/lib/burnticker/trust";
import { currentStatusLive } from "@/lib/burnticker/currentStatus";
import { readReleases } from "@/lib/burnticker/history";
import { clientKey, limiter } from "@/lib/burnticker/api/http";
import { TRUST_DELTA_CACHE, trustSwr } from "@/lib/burnticker/trustServe";

export const dynamic = "force-dynamic";

async function buildTrust(): Promise<unknown> {
  const p = platform();
  const rpc = (process.env.BURNTICKER_RPC_URL ?? "").trim();
  const reader = rpc ? await web3ChainReader(rpc).catch(() => null) : null;
  const attesters = p.registry.tokens().map((t) => { const a = p.registry.attesters(t.mint).filter((x) => x.active); return { ticker: t.ticker, attesters: a.length, independent: a.filter((x) => x.role === "independent").length, quorum: Math.max(1, Math.min(1, a.length)) }; });
  const live = p.registry.tokens("live");
  // audit R04: the upgrade row says what today's mainnet time lock allows — the same cached chain read as /v1/current-status
  const upgradeTimeLockSecs = await currentStatusLive().then((s) => s.upgradeAuthority.find((u) => u.cluster === "mainnet")?.timeLockSecs ?? null).catch(() => null);
  const page = await buildTrustPage({ reader, siteDir: p.publishDir, attesters, firstLaunchAt: live.length ? Math.min(...live.map((t) => Date.parse(t.baselineAt))) : null, cluster: p.cluster, upgradeTimeLockSecs, deltaCache: TRUST_DELTA_CACHE });
  // jsonSafe: the live platform view and any chain-read value may hold bigints (R01, 2026-10-11)
  // legitimacy pass item 1: the latest three releases for "How this was built" (docs/burnticker/CHANGELOG.md, read as it is now)
  const latestReleases = readReleases()?.slice(-3).reverse() ?? null;
  return jsonSafe({ ...page, cluster: p.cluster, rpcConfigured: !!rpc, stubs: p.stubs, latestReleases });
}

/**
 * The trust page's data: the Powers Register, the LIVE platform config from chain, the developer fee ledger from chain, team wallets,
 * attesters per token, program facts, incidents, the last audit. Kept and refreshed in the background (trustServe.ts, prelaunch audit
 * C2), rate limited per visitor.
 */
export async function GET(req: Request) {
  const rl = limiter.take(clientKey(req), "read");
  if (!rl.ok) return NextResponse.json({ error: `Too many requests. Please try again in ${rl.retryAfterSec} seconds.`, code: "rate-limited" }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec), "cache-control": "no-store" } });
  const r = await trustSwr.get("page", "1", buildTrust);
  if (!r) return NextResponse.json({ loading: true, error: "the trust page is being read; try again in a few seconds", code: "trust-loading", retryAfterSec: 5 }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } });
  return NextResponse.json(r.value, { headers: { "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120", "x-trust-memo": r.state } });
}
