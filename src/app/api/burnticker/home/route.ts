import { NextResponse } from "next/server";
import { platform, tokenPageData } from "@/lib/burnticker/server";
import { buildPlatformIndex } from "@/lib/burnticker/tokenPage";
import { homeData } from "@/lib/burnticker/home";

export const dynamic = "force-dynamic";

/**
 * The home page's featured cards and activity line (src/lib/burnticker/home.ts), for the app's home and the static landing page alike.
 * Confirmed burns only; a coin whose page fails to read is left out, never invented.
 */
export async function GET() {
  const p = platform();
  const now = Date.now();
  const statuses = [];
  for (const t of p.registry.tokens()) { try { statuses.push((await tokenPageData(p, t, now)).status); } catch { /* left out */ } }
  const index = buildPlatformIndex(statuses, now, null);
  return NextResponse.json({ ...homeData(index.tokens, process.cwd(), now), cluster: p.cluster }, { headers: { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
}
