import { registryCoinKey } from "@/lib/burnticker/coinLookup";
import { opsDenied } from "@/lib/burnticker/opsAuth";
import type { Platform } from "@/lib/burnticker/server";
import { productStore } from "@/lib/burnticker/productStore";
import { tokenDayText } from "@/lib/launch/dailyPost";
import { lintCopy } from "@/lib/launch/copyLint";
import { fail, ok, type ApiResult } from "@/lib/burnticker/api/http";
import type { TokenStatusJson } from "@/lib/burnticker/tokenPage";
import { safeParam } from "@/lib/burnticker/safeParam";
import { rememberedCoinPage, type CoinPageReader } from "@/lib/burnticker/coinPageMemo";
import type { TokenRow } from "@/lib/burnticker/registry";

/**
 * THE PRODUCT BATCH IN THE API (2026-10-10; OpenAPI 1.6.0): search-miss reports from the launch page, the ops summary of misses and
 * time-to-launch (admin only), the launch-timing hook, and the creator dashboard's read-only view of a wallet's coins.
 */

const PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DAY = 86_400_000;

/** POST /v1/search/miss — the page reports a search that showed cards but got no "Use this" click. Anonymous; append-only. */
export function v1SearchMiss(p: Platform, body: Record<string, unknown> | null, now = Date.now()): ApiResult {
  if (!body) return fail(400, "The request body is not valid JSON.");
  const query = typeof body.query === "string" ? body.query.slice(0, 200) : "";
  const cards = Number(body.cards);
  if (!query.trim() || !Number.isFinite(cards) || cards < 1) return fail(400, "Send the search text as query and a card count of at least 1. A search with no cards is logged by the server itself.");
  const stored = productStore(p.registry.db).logMiss({ query, cards, reason: "no-click" }, now);
  return ok({ ok: true, stored, note: "This is stored without a name. We keep the search as plain words and the hour in UTC. We keep no IP address, no id and no cookie." });
}

/** The search route's own hook: a query that answered no card. */
export function logNoCardSearch(p: Platform, query: string, cards: number, now = Date.now()): void {
  if (cards > 0 || query.trim().length < 3) return;
  try { productStore(p.registry.db).logMiss({ query, cards: 0, reason: "no-card" }, now); } catch { /* telemetry never breaks a search */ }
}

/** The launch routes' hook: the page's step timestamps for this draft, kept as durations. */
export function recordLaunchTimings(p: Platform, body: Record<string, unknown> | null, mints: (string | null | undefined)[], now = Date.now()): void {
  const t = body?.timings;
  if (!t) return;
  for (const m of mints) if (m) { try { productStore(p.registry.db).putTimings(m, t, now); } catch { /* never breaks a launch */ } }
}

/** Admin only (opsAuth.ts): the operator's own network AND the ops PIN. */
export function opsAllowed(req: Request, env: Readonly<Record<string, string | undefined>> = process.env): ApiResult | null {
  const d = opsDenied(req, env);
  return d ? fail(d.status, d.error, { code: d.code }) : null;
}

/** GET /v1/ops/search-misses?days= — misses by query and time-to-launch p50 / p90 per step. */
export function v1OpsSearchMisses(p: Platform, req: Request, q: URLSearchParams, now = Date.now(), env: Readonly<Record<string, string | undefined>> = process.env): ApiResult {
  const denied = opsAllowed(req, env);
  if (denied) return denied;
  const days = Math.max(1, Math.min(90, Math.round(Number(q.get("days") ?? 7)) || 7));
  const st = productStore(p.registry.db);
  return ok({ days, misses: st.missSummary(now - days * DAY), timeToLaunch: st.timingSummary(now - days * DAY), privacy: "We keep no IP address, no user id, no session id and no wallet. Searches are kept as plain words and grouped by hour in UTC. Launch timings are kept only as lengths of time." });
}

export type CoinState = "draft" | "curve" | "graduated" | "retired" | "voided" | "expired" | "paused";
export interface CreatorCoin {
  ticker: string; name: string; mint: string; page: string; state: CoinState; badge: string | null;
  queuedUnits: number; nextSettlementAt: string | null; lastReading: { id: string | null; value: string | null; at: string | null } | null;
  agreement: { reads: number; methods: string | null; held: string | null }; receipts: number; windDown: string | null;
  pairId: string | null; todayPost: { text: string; lintOk: boolean; hits: string[] };
  /** sixth pass B-10: true while this coin's page read is still running (registry facts only); refresh in a few seconds */
  loading: boolean;
}

const stateOf = (s: TokenStatusJson): CoinState => {
  if (s.status === "retired") return "retired";
  if (s.status === "expired") return "expired";
  if (s.status === "paused") return "paused";
  if (s.pair?.clause?.state === "voided") return "voided";
  if (s.market?.phase === "graduated") return "graduated";
  return s.status === "draft" ? "draft" : "curve";
};

/**
 * Hourly run 6 HB-64: the units still waiting to burn THIS coin. A pair coin that lost its result keeps a pending-pair receipt (its pool
 * moves to the winner's burn), but nothing burns this coin for it, so that receipt queues no unit here; the winner's receipt does.
 */
export function queuedBurnUnits(rs: readonly { status: string; units?: number | null; pairRole?: string | null }[]): number {
  return rs.filter((r) => (r.status === "planned" || r.status === "sending" || r.status === "pending-pair") && r.pairRole !== "lost").reduce((a, r) => a + (r.units ?? 0), 0);
}

/** A coin whose page read has not finished yet (sixth pass B-10): its registry facts only, marked `loading`, never dropped. */
function loadingCoin(p: Platform, t: TokenRow): CreatorCoin {
  let rs: ReturnType<Platform["registry"]["receipts"]> = [];
  try { rs = p.registry.receipts(t.mint); } catch { rs = []; }
  const state: CoinState = t.status === "retired" ? "retired" : t.status === "paused" ? "paused" : "curve";
  return {
    ticker: t.ticker, name: t.name, mint: t.mint, page: `/burnticker/t/${encodeURIComponent(registryCoinKey(p.registry, t))}`, state, badge: null,
    queuedUnits: queuedBurnUnits(rs),
    nextSettlementAt: null, lastReading: null, agreement: { reads: 0, methods: null, held: null }, receipts: rs.filter((r) => r.status === "confirmed").length,
    windDown: null, pairId: null, todayPost: { text: "", lintOk: true, hits: [] }, loading: true,
  };
}

/**
 * GET /v1/creators/{wallet} — the coins and pairs whose creator wallet matches (read-only; the creator dashboard). Sixth pass B-10: the
 * coins are read at once through the shared coin-page memo (coinPageMemo.ts), so a cold call answers in about COIN_PAGE_COLD_WAIT_MS
 * however many coins the wallet has; a coin still being read is listed with its registry facts and `loading: true`.
 */
export async function v1Creator(p: Platform, wallet: string, now = Date.now(), read?: CoinPageReader): Promise<ApiResult> {
  const w = safeParam(wallet).trim();
  if (!PUBKEY.test(w)) return fail(400, "The wallet must be a Solana public key.");
  // F-25: a creator's public view lists launched coins only (a draft's mint and plan stay out of public reads)
  const mine = p.registry.tokens().filter((t) => t.creator === w && t.status !== "expired" && t.status !== "draft").slice(0, 50);
  const day = new Date(now).toISOString().slice(0, 10);
  const reads = await Promise.all(mine.map((t) => rememberedCoinPage(p, t, now, read).catch(() => null)));
  const coins: CreatorCoin[] = mine.map((t, k) => {
    const d = reads[k];
    if (!d) return loadingCoin(p, t);
    const s = d.status, rs = d.receipts;
    const queued = queuedBurnUnits(rs);
    const last = [...d.readings].sort((a, b) => (a.at < b.at ? -1 : 1)).pop() ?? null;
    const nReads = last?.method ? last.method.split("+").length : 0;
    const post = tokenDayText(s, rs, day), lint = lintCopy(post);
    return {
      ticker: s.ticker, name: s.name, mint: s.mint, page: `/burnticker/t/${encodeURIComponent(registryCoinKey(p.registry, t))}`, state: stateOf(s), badge: s.profile?.badge ?? null,
      queuedUnits: queued, nextSettlementAt: s.next.nextCheckAt, lastReading: last ? { id: last.id, value: last.value, at: last.at } : null,
      agreement: { reads: nReads, methods: last?.method ?? null, held: s.feed.lastError }, receipts: rs.filter((r) => r.status === "confirmed").length,
      // launch night 2026-10-13: a draft was never created, so it has no wind-down (the line said "This coin is live." on a draft card)
      windDown: t.status === "draft" || t.status === "expired" ? null : s.lifecycle?.line ?? null, pairId: s.pair?.pairId ?? null, todayPost: { text: post, lintOk: lint.ok, hits: lint.hits.map((h) => h.phrase) },
      loading: false,
    };
  });
  const pairs = [...new Set(coins.map((c) => c.pairId).filter((x): x is string => !!x))].map((id) => { const pr = p.registry.pair(id); return pr ? { pairId: id, page: `/burnticker/p/${id}`, sides: coins.filter((c) => c.pairId === id).map((c) => c.ticker), voided: coins.some((c) => c.pairId === id && c.state === "voided") } : null; }).filter((x): x is NonNullable<typeof x> => !!x);
  return ok({ wallet: w, coins, pairs, note: "This is read-only. Nothing is signed or posted. Today's post is checked text that you can copy." });
}
