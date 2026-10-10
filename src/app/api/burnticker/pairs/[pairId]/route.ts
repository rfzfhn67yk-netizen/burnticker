import { NextResponse } from "next/server";
import { platform, tokenPageData } from "@/lib/burnticker/server";
import { pairTally } from "@/lib/burnticker/tokenPage";
import { pairDailyText } from "@/lib/launch/dailyPost";

export const dynamic = "force-dynamic";

/** One rivalry pair: both sides' status + receipts, the running tally (last settlement with its result, next market) and the share line. */
export async function GET(req: Request, { params }: { params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;
  const p = platform();
  const pair = p.registry.pair(pairId);
  if (!pair) return NextResponse.json({ error: `no pair ${pairId}` }, { status: 404 });
  const a = p.registry.token(pair.mintA)!, b = p.registry.token(pair.mintB)!;
  const now = Date.now();
  const [da, db] = await Promise.all([tokenPageData(p, a, now), tokenPageData(p, b, now)]);
  const tally = pairTally(da.status, db.status, da.receipts, db.receipts);
  // The share line / pair post (dailyPost.ts pairDailyText), linking to this app's pair page.
  const share = pairDailyText(tally, `${new URL(req.url).origin}/burnticker`);
  return NextResponse.json({ pair, a: { status: da.status, receipts: da.receipts }, b: { status: db.status, receipts: db.receipts }, tally, share, stubs: p.stubs });
}
