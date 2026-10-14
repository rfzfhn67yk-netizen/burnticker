import { NextResponse } from "next/server";
import { platform } from "@/lib/burnticker/server";
import { publicRegistryRows } from "@/lib/burnticker/devnetHide";
import { coinInventory } from "@/lib/burnticker/watchlist";

export const dynamic = "force-dynamic";

/**
 * PRIVATE REVIEW 9 F1 (2026-10-13): every coin identity the site ever listed (ticker, network, mint), whatever its status now: live, paused,
 * retired, expired, and coins whose page cannot be read. Never a draft (a draft was never listed, so no old follow names it). The browser
 * migrates an old ticker follow only against this complete list (watchlist.ts resolveLegacyFrom); a failed read answers 503, and the
 * migration waits. Nothing about the visitor is sent or stored.
 */
export async function GET() {
  try {
    const p = platform();
    const rows = publicRegistryRows(p.registry.tokens(), p.cluster).filter((t) => t.status !== "draft");
    return NextResponse.json({ ...coinInventory(rows), cluster: p.cluster, generatedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ complete: false, error: "The list of coins could not be read just now." }, { status: 503 });
  }
}
