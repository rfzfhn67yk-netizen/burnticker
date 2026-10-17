import { NextResponse } from "next/server";
import { platform, tokenPageData } from "@/lib/burnticker/server";
import { pairTally } from "@/lib/burnticker/tokenPage";
import { pairDailyText } from "@/lib/launch/dailyPost";
import { derbyPairBlock } from "@/lib/burnticker/api/derby";
import { publicOrigin } from "@/lib/burnticker/coinArt";
import { pairLifecycle, pairSideHrefs } from "@/lib/burnticker/publicPairs";

export const dynamic = "force-dynamic";

/** One rivalry pair: both sides' status + receipts + exact rules.json text, the running tally (last settlement with its result, next market) and the share line. */
export async function GET(_req: Request, { params }: { params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;
  const p = platform();
  const pair = p.registry.pair(pairId);
  if (!pair) return NextResponse.json({ error: `no pair ${pairId}` }, { status: 404 });
  const a = p.registry.token(pair.mintA)!, b = p.registry.token(pair.mintB)!;
  const now = Date.now();
  const [da, db] = await Promise.all([tokenPageData(p, a, now), tokenPageData(p, b, now)]);
  const tally = pairTally(da.status, db.status, da.receipts, db.receipts);
  // The share line / pair post (dailyPost.ts pairDailyText), linking to this app's pair page. Audit 2026-10-15 F8: the configured public
  // origin (as the feeds and the calendar use), never the request's: behind the proxy the request is http://localhost:3000.
  const site = `${publicOrigin()}/burnticker`;
  const share = pairDailyText(tally, site, da.status.profile?.badge ?? null);
  // Burn Derby (2026-10-10): the running score, the day strip with both readings, the season end, the proof links, the day post.
  const derby = pair.selectorKey.startsWith("derby:") ? await derbyPairBlock(p, pairId, site, now).catch(() => null) : null;
  // review follow-up 3: each side links to its own coin page (by mint when its ticker is shared), and the pair says its lifecycle
  return NextResponse.json({ pair, hrefs: pairSideHrefs(p.registry, pair), lifecycle: pairLifecycle(p.registry, pairId), a: { status: da.status, receipts: da.receipts, rulesText: da.rulesText }, b: { status: db.status, receipts: db.receipts, rulesText: db.rulesText }, tally, share, derby, stubs: p.stubs });
}
