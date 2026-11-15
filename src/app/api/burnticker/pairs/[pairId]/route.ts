import { NextResponse } from "next/server";
import { platform, tokenPageData } from "@/lib/burnticker/server";
import { pairTally, type ReceiptJson, type TokenStatusJson } from "@/lib/burnticker/tokenPage";
import { pairDailyText } from "@/lib/launch/dailyPost";
import { derbyPairBlock } from "@/lib/burnticker/api/derby";
import { publicOrigin } from "@/lib/burnticker/coinArt";
import { pairIsPublic, pairLifecycle, pairSideHrefs } from "@/lib/burnticker/publicPairs";
import { heavyRefusal, pageLimiter } from "@/lib/burnticker/api/http";
import { KeyedSwr, SWR_BUILD_TIMEOUT_MS } from "@/lib/burnticker/keyedSwr";
import { EDGE_JSON_CACHE, NO_STORE } from "@/lib/burnticker/edgeCache";
import { coinBodyOf, coinAnswerMemo, pairReadView } from "@/lib/burnticker/coinAnswerMemo";
import type { TokenRow } from "@/lib/burnticker/registry";

export const dynamic = "force-dynamic";

/**
 * Prelaunch audit 2026-10-18 A-22: the pair answer took 2.6 to 3.5 s because its reads ran one after another (both sides' pages, then
 * the Burn Derby block, which read both sides again). They now run together, and each pair's answer is kept per pair (keyedSwr.ts, the
 * coin route's memo): served at once while both coins' page versions match, refreshed in the background after PAIR_MEMO_MS. A first
 * read waits up to PAIR_COLD_WAIT_MS, then answers 503 with retry-after.
 */
const PAIR_MEMO_MS = 15_000, PAIR_COLD_WAIT_MS = 12_000, PAIR_RETRY_SEC = 3;
/**
 * HB-99 (hourly run 7): a pair body 49 minutes old was served as a hit under a 60 s cache header, because a refresh that never landed kept
 * the old answer "fresh". An answer older than PAIR_MAX_STALE_MS (the header's max-age plus its stale-while-revalidate window) is no
 * longer a hit: the refresh is waited for, a hung refresh is dropped after SWR_BUILD_TIMEOUT_MS, and an old answer that is still all there
 * is goes out with no-store and its real age (x-pair-age-sec), never under the 60 s header.
 */
const PAIR_MAX_STALE_MS = 75_000;
const memos = new WeakMap<object, KeyedSwr<unknown>>();
const memoFor = (registry: object): KeyedSwr<unknown> => {
  let m = memos.get(registry);
  if (!m) { m = new KeyedSwr<unknown>({ freshMs: PAIR_MEMO_MS, coldWaitMs: PAIR_COLD_WAIT_MS, maxKeys: 128, maxStaleMs: PAIR_MAX_STALE_MS, buildTimeoutMs: SWR_BUILD_TIMEOUT_MS, log: (k, e) => console.error(`[burnticker/pairs] ${k}: the pair could not be read:`, e) }); memos.set(registry, m); }
  return m;
};

/** One rivalry pair: both sides' status + receipts + exact rules.json text, the running tally (last settlement with its result, next market) and the share line. */
export async function GET(req: Request, { params }: { params: Promise<{ pairId: string }> }) {
  // audit 2026-10-18 A-38: two full coin-page reads (and the derby block) per request, so the heavy sizes per client
  const refused = heavyRefusal(req, pageLimiter);
  if (refused) return refused;
  const { pairId } = await params;
  const p = platform();
  const pair = p.registry.pair(pairId);
  // A-25: a pair with no launched side (an abandoned draft whose tickers a live pair now holds) is not a public pair: 404, as an unknown id
  if (!pair || !pairIsPublic(p.registry, pairId)) return NextResponse.json({ error: `no pair ${pairId}` }, { status: 404, headers: NO_STORE });
  const a = p.registry.token(pair.mintA)!, b = p.registry.token(pair.mintB)!;
  const va = p.registry.pageVersion(a.mint), vb = p.registry.pageVersion(b.mint);
  const version = `${va}|${vb}`;
  const build = async (): Promise<unknown> => {
    const started = Date.now(), now = started;
    // The configured public origin (as the feeds and the calendar use), never the request's (audit 2026-10-15 F8).
    const site = `${publicOrigin()}/burnticker`;
    // HB-35 (2026-10-20): a side whose coin answer the coin route (or another pair) kept within COIN_MEMO_MS is served from that memo; the
    // sides still to read share one batch and one per-build read cache (coinAnswerMemo.ts pairReadView), and each side read is kept for the
    // coin page. The answers are the coin route's own: the same full tokenPageData read, never older than the coin memo's fresh window.
    const coins = coinAnswerMemo(p.registry);
    const ka = coins.peek(a.mint, va), kb = coins.peek(b.mint, vb);
    const toRead = [ka ? null : a, kb ? null : b].filter((t): t is TokenRow => t !== null);
    const view = toRead.length ? await pairReadView(p, toRead) : p;
    type Side = { status: TokenStatusJson; receipts: ReceiptJson[]; rulesText: string };
    const side = async (t: TokenRow, v: string, kept: unknown): Promise<Side> => {
      if (kept) return kept as Side;
      const body = coinBodyOf(await tokenPageData(view, t, now));
      coins.put(t.mint, v, body);
      return body as Side;
    };
    // A-22: both sides and the Burn Derby block (2026-10-10) are read together, not one after another
    const [da, db, derby] = await Promise.all([
      side(a, va, ka), side(b, vb, kb),
      pair.selectorKey.startsWith("derby:") ? derbyPairBlock(view, pairId, site, now).catch(() => null) : Promise.resolve(null),
    ]);
    const tally = pairTally(da.status, db.status, da.receipts, db.receipts);
    // The share line / pair post (dailyPost.ts pairDailyText), linking to this app's pair page.
    const share = pairDailyText(tally, site, da.status.profile?.badge ?? null);
    console.info(`[burnticker/pairs] ${pairId} built in ${Date.now() - started} ms (${2 - toRead.length} of 2 sides from the coin memo)`);
    // review follow-up 3: each side links to its own coin page (by mint when its ticker is shared), and the pair says its lifecycle
    return { pair, hrefs: pairSideHrefs(p.registry, pair), lifecycle: pairLifecycle(p.registry, pairId), a: { status: da.status, receipts: da.receipts, rulesText: da.rulesText }, b: { status: db.status, receipts: db.receipts, rulesText: db.rulesText }, tally, share, derby, stubs: p.stubs };
  };
  const got = await memoFor(p.registry).get(pairId, version, build);
  if (!got) return NextResponse.json({ loading: true, error: "this pair is being read; try again in a few seconds", code: "pair-loading", retryAfterSec: PAIR_RETRY_SEC }, { status: 503, headers: { ...NO_STORE, "retry-after": String(PAIR_RETRY_SEC) } });
  // HB-99: a stale answer (no refresh landed) says its real age and is never cached under the 60 s header
  if (got.state === "stale" || got.state === "stale-version") return NextResponse.json(got.value, { headers: { ...NO_STORE, "x-pair-memo": got.state, "x-pair-age-sec": String(Math.round(got.ageMs / 1000)) } });
  return NextResponse.json(got.value, { headers: { ...EDGE_JSON_CACHE, "x-pair-memo": got.state } });
}
