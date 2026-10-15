import { NextResponse } from "next/server";
import { platform, tokenPageData } from "@/lib/burnticker/server";
import { lookupCoin, sharedTickerBody } from "@/lib/burnticker/coinLookup";
import { KeyedSwr } from "@/lib/burnticker/keyedSwr";

export const dynamic = "force-dynamic";

/**
 * One token's page data: status.json, receipts.json (with the verify blocks), the readings, and rules.json's exact text. `?format=rules`
 * returns the rule text as a file. The key is a mint or a ticker (tickers are not unique, owner 2026-10-12): a ticker that several coins
 * share answers 300 with the candidates (mint, name, creator, href) instead of picking one.
 */
/**
 * 2026-10-15 (owner: "pages take a bit to load"; the coin read is ~0.8 s warm and 4-8 s cold on Helius): each coin's answer is kept per
 * mint (keyedSwr.ts). It is served at once and refreshed in the background once older than COIN_MEMO_MS (one refresh per mint at a time);
 * a launch or a new receipt changes the registry's pageVersion and the next read waits for a fresh build. A first read waits up to
 * COIN_COLD_WAIT_MS, then answers 503 with retry-after (the coin page retries). The browser still never caches it (no-store): the 15 s
 * staleness is the server's only. Nothing here signs: the launch page's signing reads go through their own routes.
 */
const COIN_MEMO_MS = 15_000, COIN_COLD_WAIT_MS = 12_000, COIN_RETRY_SEC = 3;
type CoinBody = { status: unknown; receipts: unknown; readings: unknown; rulesText: string; stubs: string[] };
// one memo per registry (a platform swapped in tests, or reopened, never serves another registry's answers)
const memos = new WeakMap<object, KeyedSwr<CoinBody>>();
const memoFor = (registry: object): KeyedSwr<CoinBody> => {
  let m = memos.get(registry);
  if (!m) { m = new KeyedSwr<CoinBody>({ freshMs: COIN_MEMO_MS, coldWaitMs: COIN_COLD_WAIT_MS, maxKeys: 256, log: (k, e) => console.error(`[burnticker/tokens] ${k}: the coin's page could not be read:`, e) }); memos.set(registry, m); }
  return m;
};

export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const p = platform();
  const l = lookupCoin(p.registry, ticker);
  // 2026-10-14: a 300 (and a 404) carried no cache header, so Chrome kept serving a cached chooser for a ticker whose draft had since
  // stopped shadowing the launched coin; every answer here is per request and must say so
  const NO_STORE = { "cache-control": "no-store" };
  if (l.kind === "many") return NextResponse.json(sharedTickerBody(p.registry, l), { status: 300, headers: NO_STORE });
  if (l.kind === "none") return NextResponse.json({ error: ticker.length >= 32 ? `no token with the mint ${ticker}` : `no token $${ticker.toUpperCase()}` }, { status: 404, headers: NO_STORE });
  const t = l.token;
  // the locked rule text is the registry row's own (tokenPageData's rulesText is t.rulesJson): no chain read for the file
  if (new URL(req.url).searchParams.get("format") === "rules") return new Response(t.rulesJson, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `inline; filename="rules.json"` } });
  const build = async (): Promise<CoinBody> => {
    const data = await tokenPageData(p, t);
    return { status: data.status, receipts: data.receipts, readings: data.readings.map((r) => ({ id: r.id, at: r.at, result: r.result, value: r.value, title: r.title, sourceUrl: r.sourceUrl, settlementSourceUrl: r.settlementSourceUrl, method: r.method, attestedBy: r.attestedBy })), rulesText: data.rulesText, stubs: data.stubs };
  };
  const got = await memoFor(p.registry).get(t.mint, p.registry.pageVersion(t.mint), build);
  if (!got) return NextResponse.json({ loading: true, error: "this coin's page is being read; try again in a few seconds", code: "coin-loading", retryAfterSec: COIN_RETRY_SEC }, { status: 503, headers: { ...NO_STORE, "retry-after": String(COIN_RETRY_SEC) } });
  return NextResponse.json(got.value, { headers: { ...NO_STORE, "x-coin-memo": got.state } });
}
