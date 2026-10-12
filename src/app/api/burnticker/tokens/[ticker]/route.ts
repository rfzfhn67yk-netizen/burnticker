import { NextResponse } from "next/server";
import { platform, tokenPageData } from "@/lib/burnticker/server";
import { lookupCoin, sharedTickerBody } from "@/lib/burnticker/coinLookup";

export const dynamic = "force-dynamic";

/**
 * One token's page data: status.json, receipts.json (with the verify blocks), the readings, and rules.json's exact text. `?format=rules`
 * returns the rule text as a file. The key is a mint or a ticker (tickers are not unique, owner 2026-10-12): a ticker that several coins
 * share answers 300 with the candidates (mint, name, creator, href) instead of picking one.
 */
export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const p = platform();
  const l = lookupCoin(p.registry, ticker);
  if (l.kind === "many") return NextResponse.json(sharedTickerBody(p.registry, l), { status: 300 });
  if (l.kind === "none") return NextResponse.json({ error: ticker.length >= 32 ? `no token with the mint ${ticker}` : `no token $${ticker.toUpperCase()}` }, { status: 404 });
  const t = l.token;
  const data = await tokenPageData(p, t);
  if (new URL(req.url).searchParams.get("format") === "rules") return new Response(data.rulesText, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `inline; filename="rules.json"` } });
  return NextResponse.json({ status: data.status, receipts: data.receipts, readings: data.readings.map((r) => ({ id: r.id, at: r.at, result: r.result, value: r.value, title: r.title, sourceUrl: r.sourceUrl, settlementSourceUrl: r.settlementSourceUrl, method: r.method, attestedBy: r.attestedBy })), rulesText: data.rulesText, stubs: data.stubs });
}
