import { NextResponse } from "next/server";
import { catalogueSources } from "@/lib/burnticker/api/handlers";
import { kalshiEnabled } from "@/lib/burnticker/venues";

export const dynamic = "force-dynamic";

/**
 * Every source the wizard can show, with kind and tier: the configured attested-http sources (cards with the last fixture reading and
 * "what the fixture window would have burned" under a default 2%-per-unit rule), the on-chain facts, and the market/assertion stubs
 * (shown, not launchable, with the reason). Kalshi itself is searched live through /api/burnticker/oracle/search. Shared with the
 * public API's /v1/catalogue (src/lib/burnticker/api/handlers.ts).
 */
export async function GET() {
  // The cluster rides along so the wizard can show its "Devnet" badge (the same reading of BURNTICKER_CLUSTER as server.ts platform()).
  const c = process.env.BURNTICKER_CLUSTER;
  // …and which venues this host serves (venues.ts): the wizard greys out Team coin / Matchup when Kalshi is off.
  return NextResponse.json({ ...catalogueSources(Date.now()), cluster: c === "mainnet" ? "mainnet" : c === "localnet" ? "localnet" : "devnet", venues: { kalshi: kalshiEnabled(), polymarket: true, feeds: true } });
}
