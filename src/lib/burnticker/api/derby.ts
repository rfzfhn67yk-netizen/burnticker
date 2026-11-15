import { safeParam } from "@/lib/burnticker/safeParam";
import { publicPairs } from "@/lib/burnticker/publicPairs";
import type { Platform } from "@/lib/burnticker/server";
import { tokenPageData } from "@/lib/burnticker/server";
import { fail, ok, RateLimiter, type ApiResult } from "@/lib/burnticker/api/http";
import { API_PREFIX, RATE_LIMITS } from "@/lib/burnticker/api/spec";
import { derbyStore } from "@/lib/burnticker/derby/store";
import { derbyPairJson, derbyTournamentJson, tournamentSummaries, type DerbyPairJson } from "@/lib/burnticker/derby/page";
import { derbyDayText, registryHandle } from "@/lib/burnticker/derby/post";
import { DERBY_SEARCH_DEADLINE_MS, normalizeDerbyQuery, searchDerbyCoins } from "@/lib/burnticker/derby/search";
import type { Tournament } from "@/lib/burnticker/derby/bracket";
import { ruleMappings } from "@/lib/burnticker/rules";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { DerbyAdapter } from "@/lib/burnticker/derby/adapter";
import { HIGH_NOT_READ_HERE, highSpanOf, highUnderlyingProblem } from "@/lib/burnticker/derby/highTile";
import { highReview } from "@/lib/burnticker/derby/high";
import { wrapperPairProblem, type DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { tileRule } from "@/lib/burnticker/derby/tile";
import { preflightSelector } from "@/lib/burnticker/coverage/preflight";

/**
 * BURN DERBY'S API (2026-10-10; spec in api/derbySpec.ts, OpenAPI 1.4.0): GET /derby (every bracket and derby pair), GET /derby/{id}
 * (a bracket or one pair's derby block + the latest day's post), GET /derby/search (the wizard tile's coin search).
 */

/** A route param as Next decoded it, never decoded again (audit 2026-10-18 A-42: %2541 answered "A"). */
const decode = safeParam;

export function v1ListDerby(p: Platform, now = Date.now()): ApiResult {
  // review follow-up 3: the shared public rule (publicPairs.ts): a pair that never launched is not listed
  const pairs = publicPairs(p.registry).filter((pr) => pr.selectorKey.startsWith("derby:")).map((pr) => {
    const a = p.registry.token(pr.mintA), b = p.registry.token(pr.mintB);
    const j = derbyPairJson(p.registry, pr, p.registry.receipts(pr.mintA).map((r) => ({ eventId: r.eventId, status: r.status, burned: null, signature: r.signature, txUrl: null, units: r.units })), p.registry.receipts(pr.mintB).map((r) => ({ eventId: r.eventId, status: r.status, burned: null, signature: r.signature, txUrl: null, units: r.units })), now);
    return { pairId: pr.pairId, a: a?.ticker ?? pr.mintA, b: b?.ticker ?? pr.mintB, series: pr.selectorKey.replace(/^derby:/, ""), selector: j?.selector ?? "coinvs", season: j ? { start: j.season.start, days: j.season.days, endsOn: j.season.endsOn } : { start: "", days: 0, endsOn: "" }, score: j ? { a: j.score.a, b: j.score.b, ties: j.score.ties } : { a: 0, b: 0, ties: 0 }, page: `/burnticker/p/${pr.pairId}` };
  });
  return ok({ tournaments: tournamentSummaries(p.registry, now), pairs, note: "In the Burn Derby, the winning coin burns in each window. Readings come from Pyth or from a pool's time-weighted average price, and a second data publisher checks each one. One signer, run by the operator, signs every reading. If the two sources disagree, that window is held back, so there is no reading and no burn." });
}

/** A derby pair's block + the latest decided day's post (the pair page and GET /derby/{id} share it). */
export async function derbyPairBlock(p: Platform, pairId: string, site: string | null, now = Date.now()): Promise<{ pair: DerbyPairJson; tickers: { a: string; b: string }; post: string | null } | null> {
  const pr = p.registry.pair(pairId);
  if (!pr || !pr.selectorKey.startsWith("derby:")) return null;
  const a = p.registry.token(pr.mintA)!, b = p.registry.token(pr.mintB)!;
  const [da, db] = await Promise.all([tokenPageData(p, a, now, { live: false }), tokenPageData(p, b, now, { live: false })]);
  const j = derbyPairJson(p.registry, pr, da.receipts, db.receipts, now);
  if (!j) return null;
  const last = [...j.days].reverse().find((x) => x.status === "decided" || x.status === "withheld") ?? null;
  const frac = ruleMappings(p.registry.lockedRule(a).rule)[0]?.mapping.fractionOfPool ?? 0.01;
  const handles = [registryHandle(a.links), registryHandle(b.links)].filter((h): h is string => !!h);
  let post: string | null = null;
  if (last && j.selector === "coinvs") { try { post = derbyDayText({ pair: j, day: last, days: j.days, tickers: { a: a.ticker, b: b.ticker }, fraction: frac, handles, site }); } catch { post = null; } }
  return { pair: j, tickers: { a: a.ticker, b: b.ticker }, post };
}

export async function v1Derby(p: Platform, id: string, now = Date.now()): Promise<ApiResult> {
  const key = decode(id).trim();
  const row = derbyStore(p.registry.db).tournament(key);
  if (row) return ok({ kind: "tournament", tournament: derbyTournamentJson(p.registry, JSON.parse(row.json) as Tournament, row.sha256, now), pair: null, tickers: null, post: null });
  const blk = await derbyPairBlock(p, key, null, now);
  if (blk) return ok({ kind: "pair", tournament: null, pair: blk.pair, tickers: blk.tickers, post: blk.post });
  return fail(404, `There is no Burn Derby bracket or pair called ${key}.`);
}

/**
 * WIRING-SOURCES4 (website-21): the review's baseline for a record-close coin (derby/high.ts): the reference's daily closes read from Pyth
 * at each past 00:00 UTC boundary (derby/adapter.ts highBaseline), back to the feed's start or 1,826 days for "all", or the last 30 or 90
 * days. Answers `today` (UTC; derby/admission.ts refuses a block whose season does not start today), the baseline and the review's
 * current-high line, or `refusal` ({ code, reason }), which the launch page shows as the review's refusal sentence.
 */
export async function v1DerbyHighBaseline(p: Platform, body: Record<string, unknown> | null, now = Date.now()): Promise<ApiResult> {
  const span = highSpanOf(body?.span);
  if (span === null) return fail(400, 'Pick how far back the record reaches: "all", 30 or 90.');
  const bad = highUnderlyingProblem(body?.u);
  if (bad) return fail(400, bad);
  const u = body!.u as DerbyUnderlying, today = new Date(now).toISOString().slice(0, 10);
  const adapter = p.oracles.derby;
  if (!(adapter instanceof DerbyAdapter)) return ok({ today, span, refusal: { code: "no-readings", reason: HIGH_NOT_READ_HERE } });
  try {
    const r = await adapter.highBaseline(u, span, now);
    if ("refusal" in r) return ok({ today, span, refusal: r.refusal });
    return ok({ today, span, baseline: r.baseline, line: highReview({ span, baseline: r.baseline }).line });
  } catch (e) { return fail(502, `The daily closes could not be read just now. The reason given was: ${(e as Error).message.slice(0, 120)}`); }
}

/**
 * I-7 (audit 2026-10-19): the search's answers, cached by normalised query (case folded) for DERBY_SEARCH_CACHE_MS, at most
 * DERBY_SEARCH_CACHE_MAX entries (oldest first out), with one search in flight per query; and a per-client budget for cache MISSES on
 * top of the route's heavy bucket, because each miss reads Jupiter, RedStone and DexScreener.
 */
export const DERBY_SEARCH_CACHE_MS = 120_000;
export const DERBY_SEARCH_CACHE_MAX = 500;
// one cache per platform object (the host has one; each test world its own, so worlds never see each other's answers)
const searchCaches = new WeakMap<object, { cache: Map<string, { at: number; body: unknown }>; inFlight: Map<string, Promise<ApiResult>> }>();
const cachesFor = (p: object) => { let c = searchCaches.get(p); if (!c) { c = { cache: new Map(), inFlight: new Map() }; searchCaches.set(p, c); } return c; };
export const derbySearchMissLimiter = new RateLimiter({ ...RATE_LIMITS, heavy: { burst: 10, refillPerSec: 10 / 60, human: "10 new searches a minute" } });

export async function v1DerbySearch(p: Platform, q: URLSearchParams, o: { client?: string; now?: number; deadlineMs?: number } = {}): Promise<ApiResult> {
  const n = normalizeDerbyQuery(q.get("q"));
  if ("error" in n) return fail(400, n.error);
  const query = n.query;
  const assets = q.get("assets") === "all" ? "all" : "crypto";
  const now = o.now ?? Date.now(), key = `${assets}|${query.toLowerCase()}`;
  const { cache: searchCache, inFlight: searchInFlight } = cachesFor(p);
  const hit = searchCache.get(key);
  if (hit && now - hit.at < DERBY_SEARCH_CACHE_MS) return { ...ok(hit.body), headers: { "x-derby-search": "cache" } };
  const running = searchInFlight.get(key);
  if (running) return running;
  if (o.client) {
    const rl = derbySearchMissLimiter.take(o.client, "heavy", now);
    if (!rl.ok) return fail(429, `Too many new searches from this address. Please try again in ${rl.retryAfterSec} seconds.`, { code: "rate-limited", retryAfterSec: rl.retryAfterSec });
  }
  const run = (async (): Promise<ApiResult> => {
    try {
      const hits = await searchDerbyCoins(query, { fetchImpl: p.derbyFetch ?? (globalThis.fetch as unknown as FetchLike), deadlineAt: Date.now() + (o.deadlineMs ?? DERBY_SEARCH_DEADLINE_MS) }, { assets });
      const body = { query, assets, hits, note: `Each result shows the asset a rule locks, with its Pyth feed, its mint and its second source. The brackets and pairs are at ${API_PREFIX}/derby.` };
      if (searchCache.size >= DERBY_SEARCH_CACHE_MAX) { const oldest = searchCache.keys().next().value; if (oldest !== undefined) searchCache.delete(oldest); }
      searchCache.set(key, { at: now, body });
      return { ...ok(body), headers: { "x-derby-search": "fresh" } };
    } catch (e) { return fail(502, `Search is not working just now. The reason given was: ${(e as Error).message.slice(0, 120)}`); }
    finally { searchInFlight.delete(key); }
  })();
  searchInFlight.set(key, run);
  return run;
}

/**
 * sources-7 (QA walkthrough 11 H7): the pair check the coin-vs-coin tile runs as soon as both coins are picked, so a creator learns before
 * the review that the pair cannot launch. A wrapper pair (derby/spec.ts wrapperPairProblem) is refused before anything is read; a
 * flippening reads both sizes through the same preflight the bundle runs (coverage/preflight.ts, already-decided when coin A is already
 * the larger one) and, when it is refused for that, says whether the other order would be a real flippening (`swap`). The daily race
 * reads nothing here: its sources are checked again at review and at the bundle.
 */
export async function v1DerbyPairCheck(p: Platform, body: Record<string, unknown> | null, now = Date.now()): Promise<ApiResult> {
  const a = body?.a as DerbyUnderlying | undefined, b = body?.b as DerbyUnderlying | undefined;
  const shape = (x: unknown): string | null => { const u = x && typeof x === "object" ? x as Partial<DerbyUnderlying> : null; return u && typeof u.symbol === "string" && /^[A-Za-z0-9]{1,12}$/.test(u.symbol) && typeof u.cross === "string" && u.cross ? null : "Send each coin as the derby search returns it, with its symbol and its second source."; };
  const bad = shape(a) ?? shape(b);
  if (!a || !b || bad) return fail(400, bad ?? "Send the two coins as a and b, each as the derby search returns it.");
  const flip = body?.flip === true;
  const w = wrapperPairProblem(a, b);
  if (w) return ok({ ok: false, flip, swap: false, refusal: { code: "wrapper-pair", reason: w } });
  if (!flip) return ok({ ok: true, flip, swap: false, refusal: null });
  const deps = { now, derby: { pools: p.derbyPools ?? null, fetchImpl: p.derbyFetch ?? (globalThis.fetch as unknown as FetchLike), hermes: p.derbyHermes ?? null } };
  const ruleFor = (x: DerbyUnderlying, y: DerbyUnderlying) => tileRule({ a: x, b: y, window: "daily", seasonDays: 30, flip: true, fraction: 1, now }, "0".repeat(64), { a: "A", b: "B" }).rule;
  const r = ruleFor(a, b);
  if (!r) return fail(400, "These two coins cannot be compared as a flippening.");
  try {
    // HB-79 (hourly run 5): the size read is bounded well under the proxy's 20 seconds; past the bound the answer says so in words
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bounded = <T,>(x: Promise<T>): Promise<T> => Promise.race([x, new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new Error("the read took longer than 8 seconds")), 8_000); })]).finally(() => clearTimeout(timer));
    const pf = await bounded(preflightSelector(r, deps));
    if (pf.ok || !pf.refusal) return ok({ ok: true, flip, swap: false, refusal: null });
    let swap = false;
    if (pf.refusal.code === "already-decided") { const rb = ruleFor(b, a); if (rb) { const back = await bounded(preflightSelector(rb, deps)).catch(() => null); swap = !!back?.ok; } }
    return ok({ ok: false, flip, swap, refusal: { code: pf.refusal.code, reason: pf.refusal.reason } });
  } catch (e) { return fail(502, `The two coins' sizes could not be read just now. The reason given was: ${(e as Error).message.slice(0, 120)}`); }
}
