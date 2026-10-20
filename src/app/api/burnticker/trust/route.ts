import { NextResponse } from "next/server";
import { tier14CoinExists } from "@/lib/burnticker/feeShareLine";
import { platform } from "@/lib/burnticker/server";
import { buildTrustPage, jsonSafe, web3ChainReader } from "@/lib/burnticker/trust";
import { currentStatusLive } from "@/lib/burnticker/currentStatus";
import { publicRelease, readReleases } from "@/lib/burnticker/history";
import { clientKey, limiter } from "@/lib/burnticker/api/http";
import { serveTrust, TRUST_DELTA_CACHE, trustSwr } from "@/lib/burnticker/trustServe";

export const dynamic = "force-dynamic";

async function buildTrust(): Promise<unknown> {
  const p = platform();
  const rpc = (process.env.BURNTICKER_RPC_URL ?? "").trim();
  const reader = rpc ? await web3ChainReader(rpc).catch(() => null) : null;
  const attesters = p.registry.tokens().map((t) => { const a = p.registry.attesters(t.mint).filter((x) => x.active); return { ticker: t.ticker, attesters: a.length, independent: a.filter((x) => x.role === "independent").length, quorum: Math.max(1, Math.min(1, a.length)) }; });
  const live = p.registry.tokens("live");
  // audit R04: the upgrade row says what today's mainnet time lock allows — the same cached chain read as /v1/current-status
  const upgradeTimeLockSecs = await currentStatusLive().then((s) => s.upgradeAuthority.find((u) => u.cluster === "mainnet")?.timeLockSecs ?? null).catch(() => null);
  // HS-26 (hourly run 5): "(every coin live today)" in the fee line only while no live mainnet coin is on tier 14
  let tier14Live: boolean | null = null;
  try { tier14Live = tier14CoinExists(p.registry.tokens()); } catch { tier14Live = null; }
  const page = await buildTrustPage({ reader, siteDir: p.publishDir, attesters, firstLaunchAt: live.length ? Math.min(...live.map((t) => Date.parse(t.baselineAt))) : null, cluster: p.cluster, upgradeTimeLockSecs, deltaCache: TRUST_DELTA_CACHE, tier14Live });
  // jsonSafe: the live platform view and any chain-read value may hold bigints (R01, 2026-10-11)
  // legitimacy pass item 1: the latest three releases for "How this was built" (docs/burnticker/CHANGELOG.md, read as it is now)
  const latestReleases = readReleases()?.slice(-3).reverse().map(publicRelease) ?? null;   // A-6: no monorepo commit in the answer
  return jsonSafe({ ...page, cluster: p.cluster, rpcConfigured: !!rpc, stubs: p.stubs, latestReleases });
}

/**
 * The trust page's data: the Powers Register, the LIVE platform config from chain, the developer fee ledger from chain, team wallets,
 * attesters per token, program facts, incidents, the last audit. Kept and refreshed in the background (trustServe.ts, prelaunch audit
 * C2) with a maximum age and a rebuild timeout (audit 7 F06), rate limited per visitor.
 */
export async function GET(req: Request) {
  const rl = limiter.take(clientKey(req), "read");
  if (!rl.ok) return NextResponse.json({ error: `Too many requests. Please try again in ${rl.retryAfterSec} seconds.`, code: "rate-limited" }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec), "cache-control": "no-store" } });
  // audit 7 F06: bounded staleness and a rebuild timeout (trustServe.ts); past the bound the last verified copy is served marked degraded
  const r = await serveTrust(trustSwr, "page", buildTrust);
  return NextResponse.json(r.body, { status: r.status, headers: r.headers });
}
