import { NextResponse } from "next/server";
import { platform } from "@/lib/burnticker/server";
import { buildTrustPage, web3ChainReader } from "@/lib/burnticker/trust";

export const dynamic = "force-dynamic";

/** The trust page's data: the Powers Register, the LIVE platform config from chain, the developer fee ledger from chain, team wallets, attesters per token, program facts, incidents, the last audit. */
export async function GET() {
  const p = platform();
  const rpc = (process.env.BURNTICKER_RPC_URL ?? "").trim();
  const reader = rpc ? await web3ChainReader(rpc).catch(() => null) : null;
  const attesters = p.registry.tokens().map((t) => { const a = p.registry.attesters(t.mint).filter((x) => x.active); return { ticker: t.ticker, attesters: a.length, independent: a.filter((x) => x.role === "independent").length, quorum: Math.max(1, Math.min(1, a.length)) }; });
  const live = p.registry.tokens("live");
  const page = await buildTrustPage({ reader, siteDir: p.publishDir, attesters, firstLaunchAt: live.length ? Math.min(...live.map((t) => Date.parse(t.baselineAt))) : null, cluster: p.cluster });
  return NextResponse.json({ ...page, cluster: p.cluster, rpcConfigured: !!rpc, stubs: p.stubs });
}
