import { CREATOR_PAGE, checkLine, creatorNextLine } from "@/lib/burnticker/creatorBenefits";
import { decidedPairLine, decidedPairOf, type DecidedPairStatus } from "@/lib/burnticker/decidedWarning";
import "server-only";
import { platform, tokenPageData, type Platform } from "@/lib/burnticker/server";
import { leagueData } from "@/lib/burnticker/leaguesServe";
import { registryCoinKey } from "@/lib/burnticker/coinLookup";
import { rankLines, receiptsThisWeek, weeklySummary, type RankView } from "@/lib/burnticker/coinRank";
import { safeParam } from "@/lib/burnticker/safeParam";
import { ruleOneLinerFor } from "@/lib/burnticker/coinCard";
import { rememberedCoinPage, type CoinPageReader } from "@/lib/burnticker/coinPageMemo";
import { KeyedSwr, SWR_BUILD_TIMEOUT_MS } from "@/lib/burnticker/keyedSwr";
import { COIN_MAX_STALE_MS } from "@/lib/burnticker/coinFreshness";
import { nextTimes, type ResultReceipt, type ResultState } from "@/lib/burnticker/nextResult";
import type { TokenRow } from "@/lib/burnticker/registry";
import type { TokenStatusJson } from "@/lib/burnticker/pageTypes";

/**
 * THE CREATOR PAGE'S DATA (website-17, creator benefits items 1, 2 and 5). Every coin a wallet created, from the registry: live, paused
 * and retired coins (a draft was never created on chain; an expired draft never existed). Each with its rule in one line, the creator's
 * own image, text and links from its metadata, its confirmed receipts, its last burn, its next result, its rank line (coinRank.ts over
 * leaguesServe.ts's registry rows, the same rows the Seasons page ranks) and its receipts this week. Server only.
 *
 * Audit 7 (creator aggregation, 2026-10-19): the detail built the full coin page for up to 100 coins one after another, the summary
 * route used the same function, and a coin whose page failed was skipped silently, so every failure looked like an empty account. Now:
 * - the summary (creatorSummary) is a registry-only projection: no coin page is built for it;
 * - the detail (creatorData) builds coin pages with bounded concurrency (CREATOR_CONCURRENCY), a per-coin bound (CREATOR_COIN_MS) and an
 *   end-to-end deadline (CREATOR_DEADLINE_MS), behind a short per-wallet memo (CREATOR_MEMO_MS; keyedSwr.ts with the coin page's bounds);
 * - a coin whose page fails or runs past its bound is listed as unavailable (`available: false`, registry facts only), and the result
 *   counts them (`unavailable`), so a failing coin never makes the account look empty.
 *
 * Sixth pass B-10 / HB-52 (2026-10-19): the seven-coin creator still got "5 coins could not be read just now" on every cold load (four
 * at a time, 8 s each, 12 s overall) and a rule printed as a raw Polymarket id. The page's default path now reads every coin at once
 * through the shared coin-page memo (coinPageMemo.ts, also behind "Your coins"): a coin whose read has not finished in
 * COIN_PAGE_COLD_WAIT_MS is listed with its registry facts and "Still loading this coin. Refresh in a few seconds." (`loading: true`),
 * and the read carries on for the next visit. A coin's rule always comes from ruleOneLinerFor (the coin page's describer), never an id.
 * An injected reader or memo (tests) keeps the bounded path above.
 */

export const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const CREATOR_MAX_COINS = 100;
export const CREATOR_CONCURRENCY = 4, CREATOR_COIN_MS = 8_000, CREATOR_DEADLINE_MS = 12_000, CREATOR_MEMO_MS = 30_000;

/** A coin's facts from the registry alone (the summary's whole answer; the detail's base). */
export interface CreatorCoinBase {
  ticker: string; name: string; page: string; status: string; cluster: string;
  /** the coin's mint: the one key two coins never share (Your coins and the coin page match the summary on it) */
  mint: string;
  /** the coin's URL key (coinKey.ts): its ticker while it alone holds it, its mint once the ticker is shared */
  key: string;
  receipts: number; rank: RankView | null; week: number; summary: string;
}

export interface CreatorCoinView extends CreatorCoinBase {
  /** false when this coin's own page could not be read in time: the registry facts only, never dropped from the list */
  available: boolean;
  /** sixth pass B-10: true while this coin's first page read is still running (registry facts only; refresh in a few seconds) */
  loading: boolean;
  imageUrl: string | null; /** 2026-10-27: this site's copy of the uploaded image, when it has one (imageStore.ts) */ imageMirror?: string | null; rule: string; creatorText: string | null; links: { label: string; url: string }[];
  lastBurnAt: string | null;
  /** the next RESULT (null for a decided or voided one-shot), never the keeper's next poll of the source (audit 7 F08) */
  nextAt: string | null;
  /** the "Next result" cell in words (creatorBenefits.ts creatorNextLine): a decided one-shot is decided, a past time is overdue */
  nextLine: string;
  /** HB-80 residue (hourly run 7): the cell's label, "Result" for a decided or voided coin, "Next result" otherwise */
  nextLabel: string;
  /** the keeper's next read of the source, shown under its own label; null once a one-shot is decided or voided */
  nextCheckAt: string | null; nextCheckLine: string | null;
  result: ResultState | null;
}
export type CreatorData = { kind: "bad-wallet" } | { kind: "unavailable"; wallet: string } | { kind: "ok"; wallet: string; coins: CreatorCoinView[]; readAt: string; unavailable: number; loading: number };
export type CreatorSummary = { kind: "bad-wallet" } | { kind: "unavailable"; wallet: string } | { kind: "ok"; wallet: string; coins: CreatorCoinBase[]; readAt: string };

const sentence = (s: string) => { const t = s.trim().replace(/^./, (c) => c.toUpperCase()); return /[.!?]$/.test(t) ? t : `${t}.`; };

/**
 * The creator views' next fields from a coin's status JSON (the producer's `rules.oneShot` and `next`) and its receipts: the next result
 * and its words, and the next source check under its own label (dropped for a decided or voided one-shot). Pure.
 */
export function creatorNextFields(s: Pick<TokenStatusJson, "rules" | "next"> & { market?: { phase?: string | null } | null; ticker?: string } & DecidedPairStatus, receipts: readonly (ResultReceipt & { pairRole?: string | null })[], now: number, live: { lastFetchAt: number | null; nextFetchAt: number | null; /** HB-132: the last successful read and the failures since it (registry feed_state) */ lastOkAt?: number | null; failures?: number } | null = null): Pick<CreatorCoinView, "nextAt" | "nextLine" | "nextLabel" | "nextCheckAt" | "nextCheckLine" | "result"> {
  const oneShot = !!s.rules.oneShot;
  // the producer's fields when present (tokenPage.ts); recomputed the same way for an older status JSON
  const t = s.next.result !== undefined ? { result: s.next.result, nextResultAt: s.next.nextResultAt ?? null, nextSourceCheckAt: s.next.nextSourceCheckAt ?? s.next.nextCheckAt ?? null } : nextTimes({ oneShot, receipts, nextCloseTime: s.next.nextCloseTime, nextCheckAt: s.next.nextCheckAt });
  const settled = t.result === "decided" || t.result === "void";
  // HB-98 reopened (hourly run 10): the keeper's live record of its last read and next read (registry feed_state) wins over a status
  // body that may predate that read; a later next read replaces the body's one
  const liveNext = live?.nextFetchAt && Number.isFinite(live.nextFetchAt) ? new Date(live.nextFetchAt).toISOString() : null;
  const bodyNext = t.nextSourceCheckAt;
  const nextCheckAt = settled ? null : liveNext && (!bodyNext || Date.parse(liveNext) > Date.parse(bodyNext)) ? liveNext : bodyNext;
  // HB-132 (hourly run 11): "checked" is the last GOOD read; an attempt after it that failed is said on its own. A caller with only the
  // attempt time (no lastOkAt) keeps HB-98's wording
  const okKnown = !!live && live.lastOkAt !== undefined;
  const lastCheckAt = okKnown ? live!.lastOkAt ?? null : live?.lastFetchAt ?? null;
  const failedAt = okKnown && live!.lastFetchAt !== null && (live!.failures ?? 1) > 0 && (live!.lastOkAt === null || live!.lastOkAt === undefined || live!.lastFetchAt > live!.lastOkAt) ? live!.lastFetchAt : null;
  return {
    nextAt: t.nextResultAt, result: t.result, nextLabel: settled ? CREATOR_PAGE.labels.result : CREATOR_PAGE.labels.next,
    // HB-80 / HS-27 (hourly run 5): a decided pair coin says won or lost in the one shared line, never "waiting" on the losing side
    nextLine: (() => { const dp = oneShot && t.result === "decided" && s.ticker ? decidedPairOf(s, receipts.map((r) => ({ status: r.status, settledAt: String(r.settledAt ?? ""), kind: r.kind ?? null, pairRole: r.pairRole ?? null }))) : null; return dp ? decidedPairLine(s.ticker!, dp) : creatorNextLine({ oneShot, receipts, graduated: s.market?.phase === "graduated", nextAt: t.nextResultAt, result: t.result }, now); })(),
    nextCheckAt, nextCheckLine: nextCheckAt && nextCheckAt !== t.nextResultAt ? checkLine(nextCheckAt, now, lastCheckAt, failedAt) : null,   // HB-98: an instant, with a grace
  };
}

type Ctx = { plat: Platform; ranks: Map<string, RankView> | null; burnsBy: Map<string, readonly { settledAt: string }[]>; now: number };

function context(plat: Platform, now: number): Ctx {
  let ranks: Map<string, RankView> | null = null;
  let burnsBy = new Map<string, readonly { settledAt: string }[]>();
  try { const d = leagueData(plat, now); ranks = rankLines(d.coins); burnsBy = new Map(d.coins.map((c) => [c.mint, c.burns])); } catch { ranks = null; }
  return { plat, ranks, burnsBy, now };
}

/** The wallet's coins from the registry (null when the registry cannot be read). */
function creatorRows(plat: Platform, w: string): TokenRow[] | null {
  try { return plat.registry.tokens().filter((t) => t.creator === w && t.status !== "draft" && t.status !== "expired").slice(0, CREATOR_MAX_COINS); } catch { return null; }
}

/** The registry-only projection of one coin: no chain read, no oracle, no coin page. */
function baseOf(c: Ctx, t: TokenRow): CreatorCoinBase {
  const rank = c.ranks?.get(t.mint) ?? null;
  const week = receiptsThisWeek(c.burnsBy.get(t.mint) ?? [], c.now);
  let receipts = c.burnsBy.get(t.mint)?.length;
  if (receipts === undefined) { try { receipts = c.plat.registry.receipts(t.mint).filter((r) => r.status === "confirmed" && (r.burnRaw ?? BigInt(0)) > BigInt(0)).length; } catch { receipts = 0; } }
  const key = registryCoinKey(c.plat.registry, t);
  return { ticker: t.ticker, name: t.name, mint: t.mint, key, page: `/burnticker/t/${encodeURIComponent(key)}`, status: t.status, cluster: t.cluster, receipts, rank, week, summary: weeklySummary(t.ticker, week, rank) };
}

/** A coin whose page could not be read: its registry facts, said to be unavailable (never dropped). */
function unavailableOf(c: Ctx, t: TokenRow, loading = false): CreatorCoinView {
  let rule = t.name;
  try { rule = ruleOneLinerFor(c.plat.registry.lockedRule(t).rule, null, t.description, t.ticker); } catch { /* the name stands in */ }
  let lastBurnAt: string | null = null;
  try { lastBurnAt = c.plat.registry.receipts(t.mint).filter((r) => r.status === "confirmed" && (r.burnRaw ?? BigInt(0)) > BigInt(0)).map((r) => r.settledAt).sort().at(-1) ?? null; } catch { lastBurnAt = null; }
  return { ...baseOf(c, t), available: false, loading, imageUrl: t.imageUrl, rule: sentence(rule), creatorText: null, links: [], lastBurnAt, nextAt: null, nextLine: loading ? CREATOR_PAGE.coinLoading : CREATOR_PAGE.coinUnavailable, nextLabel: CREATOR_PAGE.labels.next, nextCheckAt: null, nextCheckLine: null, result: null };
}

/** The coin's rule in one line from the registry and an optional venue title (never a raw selector or id). */
function ruleLine(c: Ctx, t: TokenRow, title: string | null): string {
  try { return ruleOneLinerFor(c.plat.registry.lockedRule(t).rule, title, t.description, t.ticker); } catch { return t.name; }
}

export type CoinDetail = (p: Platform, t: TokenRow, now: number) => Promise<{ status: TokenStatusJson; receipts: readonly (ResultReceipt & { burned?: string | null })[] }>;

/** HB-98 reopened: the keeper's last and next read of this coin's source, read from the registry at request time (null when unreadable). */
function liveFeed(c: Ctx, t: TokenRow): { lastFetchAt: number | null; nextFetchAt: number | null; lastOkAt: number | null; failures: number } | null {
  try { const f = c.plat.registry.feedState(t.selectorKey); return { lastFetchAt: f.lastFetchAt, nextFetchAt: f.nextFetchAt, lastOkAt: f.lastOkAt, failures: f.failures }; } catch { return null; }
}
function viewOf(c: Ctx, t: TokenRow, d: Awaited<ReturnType<CoinDetail>>): CreatorCoinView {
  const s = d.status, base = baseOf(c, t);
  const receipts = c.burnsBy.get(s.mint)?.length ?? d.receipts.filter((r) => r.status === "confirmed" && Number(r.burned ?? 0) > 0).length;
  return {
    ...base, receipts, available: true, loading: false,
    imageUrl: s.profile?.imageUrl ?? null, imageMirror: s.profile?.imageMirror ?? null, rule: sentence(s.profile?.oneLiner ?? ruleLine(c, t, s.seriesTitle)), creatorText: s.profile?.creatorText ?? null, links: s.profile?.links ?? [],
    lastBurnAt: s.burned.lastAt ?? null, ...creatorNextFields(s, d.receipts, c.now, liveFeed(c, t)),
  };
}

/** Runs `fn` over `items`, at most `limit` at a time, each bounded by `eachMs`, all by `deadlineMs`; a miss is `fallback(item)`. */
export async function boundedMap<T, R>(items: readonly T[], o: { limit: number; eachMs: number; deadlineMs: number }, fn: (t: T) => Promise<R>, fallback: (t: T) => R): Promise<R[]> {
  const out: (R | undefined)[] = new Array(items.length).fill(undefined);
  let nextIndex = 0, stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const bound = <X>(p: Promise<X>, ms: number): Promise<X> => new Promise<X>((resolve, reject) => {
    const tm = setTimeout(() => { timers.delete(tm); reject(new Error(`no answer within ${ms} ms`)); }, ms);
    timers.add(tm);
    p.then((v) => { clearTimeout(tm); timers.delete(tm); resolve(v); }, (e) => { clearTimeout(tm); timers.delete(tm); reject(e); });
  });
  const worker = async () => {
    while (!stopped && nextIndex < items.length) {
      const k = nextIndex++;
      try { const v = await bound(Promise.resolve().then(() => fn(items[k])), o.eachMs); if (!stopped) out[k] = v; } catch { /* a miss: filled below */ }
    }
  };
  const all = Promise.all(Array.from({ length: Math.min(o.limit, items.length) }, worker));
  let deadline: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([all, new Promise<void>((r) => { deadline = setTimeout(r, o.deadlineMs); })]);
  clearTimeout(deadline);
  stopped = true;
  for (const tm of timers) clearTimeout(tm);
  return items.map((t, k) => out[k] ?? fallback(t));
}

export interface CreatorDataOptions {
  /** the coin page reader (tests inject a slow or failing one) */
  detail?: CoinDetail; concurrency?: number; coinMs?: number; deadlineMs?: number;
  /** the per-wallet memo; null builds fresh (tests) */
  memo?: KeyedSwr<CreatorData> | null;
}

/** The registry-only summary (the summary route, "Your coins"): receipts, receipts this week, rank and the weekly summary. */
export function creatorSummary(wallet: string, now = Date.now(), p: Platform | null = null): CreatorSummary {
  const w = safeParam(wallet).trim();
  if (!WALLET_RE.test(w)) return { kind: "bad-wallet" };
  let plat: Platform;
  try { plat = p ?? platform(); } catch { return { kind: "unavailable", wallet: w }; }
  const rows = creatorRows(plat, w);
  if (!rows) return { kind: "unavailable", wallet: w };
  const c = context(plat, now);
  return { kind: "ok", wallet: w, coins: rows.map((t) => baseOf(c, t)), readAt: new Date(now).toISOString() };
}

/** The default path (sixth pass B-10): every coin at once from the shared coin-page memo; a coin still being read is "still loading". */
async function rememberedDetail(plat: Platform, w: string, rows: readonly TokenRow[], now: number): Promise<CreatorData> {
  const c = context(plat, now);
  const reads = await Promise.all(rows.map((t) => rememberedCoinPage(plat, t, now).catch(() => null)));
  const coins = rows.map((t, k) => { const d = reads[k]; return d ? viewOf(c, t, d) : unavailableOf(c, t, true); });
  return { kind: "ok", wallet: w, coins, readAt: new Date(now).toISOString(), unavailable: 0, loading: coins.filter((x) => x.loading).length };
}

/**
 * AUDIT 7 B-10 (2026-10-20): the creator page streams each coin as its read finishes. The first cold load after a deploy showed "Still
 * loading this coin" for 7 of 7 coins, because the whole page waited COIN_PAGE_COLD_WAIT_MS (2.4 s) for every coin and then rendered
 * what it had, all or nothing. Now the page gets every coin's registry facts at once (the "still loading" card, the same one as before)
 * and, per coin, the promise of its full card, waited for up to CREATOR_STREAM_WAIT_MS each; the page shows each coin as it resolves
 * (React Suspense). A coin still unread at its bound stays "still loading", as before, and its read carries on for the next visit.
 */
export const CREATOR_STREAM_WAIT_MS = 15_000;
export type CreatorStream = { kind: "bad-wallet" } | { kind: "unavailable"; wallet: string } | { kind: "ok"; wallet: string; readAt: string; coins: { loading: CreatorCoinView; view: Promise<CreatorCoinView> }[] };
export function creatorStream(wallet: string, now = Date.now(), p: Platform | null = null, o: { waitMs?: number; read?: CoinPageReader } = {}): CreatorStream {
  const w = safeParam(wallet).trim();
  if (!WALLET_RE.test(w)) return { kind: "bad-wallet" };
  let plat: Platform;
  try { plat = p ?? platform(); } catch { return { kind: "unavailable", wallet: w }; }
  const rows = creatorRows(plat, w);
  if (!rows) return { kind: "unavailable", wallet: w };
  const c = context(plat, now);
  const waitMs = o.waitMs ?? CREATOR_STREAM_WAIT_MS;
  const coins = rows.map((t) => {
    const loading = unavailableOf(c, t, true);
    // a read that failed or is still running keeps the loading card (as before); a read whose card cannot be built is unavailable
    const view = rememberedCoinPage(plat, t, now, o.read, { waitMs }).catch(() => null).then((d) => (d ? viewOf(c, t, d) : loading)).catch(() => unavailableOf(c, t));
    return { loading, view };
  });
  return { kind: "ok", wallet: w, readAt: new Date(now).toISOString(), coins };
}

async function buildDetail(plat: Platform, w: string, rows: readonly TokenRow[], now: number, o: CreatorDataOptions): Promise<CreatorData> {
  const c = context(plat, now);
  const detail: CoinDetail = o.detail ?? ((pl, t, n) => tokenPageData(pl, t, n));
  const coins = await boundedMap(rows, { limit: o.concurrency ?? CREATOR_CONCURRENCY, eachMs: o.coinMs ?? CREATOR_COIN_MS, deadlineMs: o.deadlineMs ?? CREATOR_DEADLINE_MS },
    async (t) => viewOf(c, t, await detail(plat, t, now)), (t) => unavailableOf(c, t));
  return { kind: "ok", wallet: w, coins, readAt: new Date(now).toISOString(), unavailable: coins.filter((x) => !x.available).length, loading: 0 };
}

// one memo per registry (a platform swapped in tests never serves another registry's answers)
const memos = new WeakMap<object, KeyedSwr<CreatorData>>();
const memoFor = (registry: object): KeyedSwr<CreatorData> => {
  let m = memos.get(registry);
  if (!m) { m = new KeyedSwr<CreatorData>({ freshMs: CREATOR_MEMO_MS, coldWaitMs: CREATOR_DEADLINE_MS + 2_000, maxStaleMs: COIN_MAX_STALE_MS, buildTimeoutMs: SWR_BUILD_TIMEOUT_MS, maxKeys: 256, log: (k, e) => console.error(`[burnticker/creator] ${k}: the creator page could not be built:`, e) }); memos.set(registry, m); }
  return m;
};

/** The detail (the creator page): every coin with its page facts, a failing coin listed as unavailable. */
export async function creatorData(wallet: string, now = Date.now(), p: Platform | null = null, o: CreatorDataOptions = {}): Promise<CreatorData> {
  const w = safeParam(wallet).trim();
  if (!WALLET_RE.test(w)) return { kind: "bad-wallet" };
  let plat: Platform;
  try { plat = p ?? platform(); } catch { return { kind: "unavailable", wallet: w }; }
  const rows = creatorRows(plat, w);
  if (!rows) return { kind: "unavailable", wallet: w };
  // sixth pass B-10: the page's own call (no reader, no memo given) reads through the shared coin-page memo; no per-wallet memo on top,
  // so a coin that was still loading shows its details on the very next visit
  if (o.memo === undefined && !o.detail) { try { return await rememberedDetail(plat, w, rows, now); } catch { return { kind: "unavailable", wallet: w }; } }
  const memo = o.memo === undefined ? memoFor(plat.registry) : o.memo;
  if (!memo) return buildDetail(plat, w, rows, now, o);
  // the version: the wallet's coins and each coin's page version (a launch or a new receipt rebuilds at once)
  let version: string;
  try { version = rows.map((t) => `${t.mint}:${plat.registry.pageVersion(t.mint)}`).join(","); } catch { version = rows.map((t) => t.mint).join(","); }
  try {
    const got = await memo.get(w, version, () => buildDetail(plat, w, rows, now, o));
    return got ? got.value : { kind: "ok", wallet: w, coins: rows.map((t) => unavailableOf(context(plat, now), t)), readAt: new Date(now).toISOString(), unavailable: rows.length, loading: 0 };
  } catch { return { kind: "unavailable", wallet: w }; }
}
