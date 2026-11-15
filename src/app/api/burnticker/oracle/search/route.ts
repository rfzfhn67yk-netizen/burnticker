import { NextResponse } from "next/server";
import { platform } from "@/lib/burnticker/server";
import { kalshiSearch } from "@/lib/burnticker/api/handlers";
import { heavyRefusal } from "@/lib/burnticker/api/http";

export const dynamic = "force-dynamic";

/**
 * Live search of Kalshi series (title, category, frequency, settlement source) for the wizard; `?series=TICKER` returns one series with
 * its next open markets (close times; YES prices are DISPLAY ONLY and never reach a rule) and the refuse-list verdict on its title.
 * Shared with the public API's /v1/kalshi/search.
 */
export async function GET(req: Request) {
  // AP6-11: the standard heavy bucket, as /v1/kalshi/search has (each call can reach Kalshi)
  const refused = heavyRefusal(req); if (refused) return refused;
  const url = new URL(req.url);
  const r = await kalshiSearch(platform(), { q: url.searchParams.get("q"), category: url.searchParams.get("category"), series: url.searchParams.get("series") });
  return NextResponse.json(r.body, { status: r.status });
}
