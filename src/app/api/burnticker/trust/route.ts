import { NextResponse } from "next/server";
import { platform } from "@/lib/burnticker/server";
import { buildTrustPage, jsonSafe, web3ChainReader } from "@/lib/burnticker/trust";
import { currentStatusLive } from "@/lib/burnticker/currentStatus";
import { readReleases } from "@/lib/burnticker/history";

export const dynamic = "force-dynamic";

/** The trust page's data: the Powers Register, the LIVE platform config from chain, the developer fee ledger from chain, team wallets, attesters per token, program facts, incidents, the last audit. */
export async function GET() {
  const p = platform();
  const rpc = (process.env.BURNTICKER_RPC_URL ?? "").trim();
  const reader = rpc ? await web3ChainReader(rpc).catch(() => null) : null;
  const attesters = p.registry.tokens().map((t) => { const a = p.registry.attesters(t.mint).filter((x) => x.active); return { ticker: t.ticker, attesters: a.length, independent: a.filter((x) => x.role === "independent").length, quorum: Math.max(1, Math.min(1, a.length)) }; });
  const live = p.registry.tokens("live");
  // audit R04: the upgrade row says what today's mainnet time lock allows — the same cached chain read as /v1/current-status
  const upgradeTimeLockSecs = await currentStatusLive().then((s) => s.upgradeAuthority.find((u) => u.cluster === "mainnet")?.timeLockSecs ?? null).catch(() => null);
  const page = await buildTrustPage({ reader, siteDir: p.publishDir, attesters, firstLaunchAt: live.length ? Math.min(...live.map((t) => Date.parse(t.baselineAt))) : null, cluster: p.cluster, upgradeTimeLockSecs });
  // jsonSafe: the live platform view and any chain-read value may hold bigints (R01, 2026-10-11)
  // legitimacy pass item 1: the latest three releases for "How this was built" (docs/burnticker/CHANGELOG.md, read as it is now)
  const latestReleases = readReleases()?.slice(-3).reverse() ?? null;
  return NextResponse.json(jsonSafe({ ...page, cluster: p.cluster, rpcConfigured: !!rpc, stubs: p.stubs, latestReleases }));
}
