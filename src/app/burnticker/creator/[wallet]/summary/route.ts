import { NextResponse } from "next/server";
import { creatorData } from "@/lib/burnticker/creatorServe";

export const dynamic = "force-dynamic";

/**
 * GET /burnticker/creator/<wallet>/summary — the creator page's numbers as JSON for "Your coins" (website-17 item 5) and the coin page's
 * rank line: per coin its receipts, receipts this week, rank line and the weekly summary text. Read-only, from the registry; nothing is
 * counted or stored.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await ctx.params;
  const d = await creatorData(wallet);
  if (d.kind === "bad-wallet") return NextResponse.json({ error: "The wallet must be a Solana public key." }, { status: 400 });
  if (d.kind === "unavailable") return NextResponse.json({ error: "The coin registry could not be read just now." }, { status: 503 });
  return NextResponse.json({
    wallet: d.wallet, readAt: d.readAt,
    coins: d.coins.map((c) => ({ ticker: c.ticker, receipts: c.receipts, week: c.week, rank: c.rank?.line ?? null, summary: c.summary })),
  }, { headers: { "cache-control": "public, max-age=30" } });
}
