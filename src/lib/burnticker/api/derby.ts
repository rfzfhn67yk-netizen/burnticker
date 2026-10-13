import type { Platform } from "@/lib/burnticker/server";
import { tokenPageData } from "@/lib/burnticker/server";
import { fail, ok, type ApiResult } from "@/lib/burnticker/api/http";
import { API_PREFIX } from "@/lib/burnticker/api/spec";
import { derbyStore } from "@/lib/burnticker/derby/store";
import { derbyPairJson, derbyTournamentJson, tournamentSummaries, type DerbyPairJson } from "@/lib/burnticker/derby/page";
import { derbyDayText, registryHandle } from "@/lib/burnticker/derby/post";
import { searchDerbyCoins } from "@/lib/burnticker/derby/search";
import type { Tournament } from "@/lib/burnticker/derby/bracket";
import { ruleMappings } from "@/lib/burnticker/rules";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { DerbyAdapter } from "@/lib/burnticker/derby/adapter";
import { HIGH_NOT_READ_HERE, highSpanOf, highUnderlyingProblem } from "@/lib/burnticker/derby/highTile";
import { highReview } from "@/lib/burnticker/derby/high";
import type { DerbyUnderlying } from "@/lib/burnticker/derby/spec";

/**
 * BURN DERBY'S API (2026-10-10; spec in api/derbySpec.ts, OpenAPI 1.4.0): GET /derby (every bracket and derby pair), GET /derby/{id}
 * (a bracket or one pair's derby block + the latest day's post), GET /derby/search (the wizard tile's coin search).
 */

const decode = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };

export function v1ListDerby(p: Platform, now = Date.now()): ApiResult {
  const pairs = p.registry.pairs().filter((pr) => pr.selectorKey.startsWith("derby:")).map((pr) => {
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

export async function v1DerbySearch(p: Platform, q: URLSearchParams): Promise<ApiResult> {
  const query = (q.get("q") ?? "").trim();
  if (query.length < 2) return fail(400, "Type at least two characters. You can search for a ticker, a name or a mint.");
  const assets = q.get("assets") === "all" ? "all" : "crypto";
  try {
    const hits = await searchDerbyCoins(query, { fetchImpl: p.derbyFetch ?? (globalThis.fetch as unknown as FetchLike) }, { assets });
    return ok({ query, assets, hits, note: `Each result shows the asset a rule locks, with its Pyth feed, its mint and its second source. The brackets and pairs are at ${API_PREFIX}/derby.` });
  } catch (e) { return fail(502, `Search is not working just now. The reason given was: ${(e as Error).message.slice(0, 120)}`); }
}
