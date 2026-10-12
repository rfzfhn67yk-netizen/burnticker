import { platform, tokenPageData, type Platform } from "@/lib/burnticker/server";
import { feedById, loadFixture, previewFromFixture } from "@/lib/burnticker/catalogue";
import { TIER_LABEL } from "@/lib/burnticker/sources/types";
import { catalogueLaunches } from "@/lib/burnticker/launchAvailability";
import { BURNTICKER_RULES_SCHEMA, DISCLAIMER_FOOTER, lockRule, oracleDisclosure, ruleStatement, type LockedRule } from "@/lib/burnticker/rules";
import { backtestSentence } from "@/lib/burnticker/oracle/backtest";
import { receiptFormatTemplate, receiptKey } from "@/lib/burnticker/receipt";
import { compileUnsigned } from "@/lib/burnticker/transactions";
import { feedSourceReading, kalshiSourceReading, polymarketSourceReading, verifyReceiptCore, type ChainReading, type SourceReading } from "@/lib/burnticker/verify";
import { rawToTokens } from "@/lib/burnKeeper/rules";
import { buildTrustPage, loadPowersRegister, operatorPowersSummary, web3ChainReader } from "@/lib/burnticker/trust";
import type { TokenRow, TokenStatus } from "@/lib/burnticker/registry";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { catalogueSources, markLaunched, prepareLaunch, runBacktest, kalshiSearch, kalshiEvents, kalshiTeams, kalshiCategories, browse, search, elections, electionPair, sportsTeams, sportsGames, polymarketSearch, publicConfig } from "@/lib/burnticker/api/handlers";
import type { FetchLike as RpcFetchLike } from "@/lib/burnKeeper/attesters/polymarketOnchain";
import { fail, ok, type ApiResult } from "@/lib/burnticker/api/http";
import { lookupCoin, registryCoinKey, sharedTickerBody, type CoinLookup } from "@/lib/burnticker/coinLookup";
import { API_PREFIX, buildOpenApi } from "@/lib/burnticker/api/spec";
import { buildCoverage, type CoverageMatrix } from "@/lib/burnticker/coverage";
import { logNoCardSearch, recordLaunchTimings } from "@/lib/burnticker/api/product";

/**
 * THE PUBLIC API, v1 (2026-10-09). One function per operation in spec.ts; the route files under src/app/api/burnticker/v1/ call these
 * through runV1 (rate limit, cache, cross-site refusal). Public data and unsigned transactions only: nothing here holds a key, signs,
 * sends, or reads anything a stranger could not read themselves. There is no adopt-an-existing-token path anywhere: the Receipts
 * program's initialize_token needs the NEW mint's signature, so only a coin created through this flow can ever have a burn config.
 */

const ZERO = BigInt(0);

/** decodeURIComponent that never throws (a malformed escape is looked up as written, and simply not found). */
const decode = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };

/** A coin by mint address, or by ticker (case-insensitive) when one coin holds it; tickers are not unique (owner 2026-10-12, coinKey.ts). */
export function findCoin(p: Platform, id: string): CoinLookup { return lookupCoin(p.registry, id); }

/** The one token for an id; null when there is none, or when several coins share the ticker (findCoin tells those apart). */
export function findToken(p: Platform, id: string): TokenRow | null {
  const l = findCoin(p, id);
  return l.kind === "one" ? l.token : null;
}

/** A 300 for a ticker several coins share (the candidates, each with its mint), or a 404 when nothing matches. */
const notOne = (p: Platform, l: Exclude<CoinLookup, { kind: "one" }>, id: string): ApiResult =>
  l.kind === "many" ? { status: 300, body: sharedTickerBody(p.registry, l) } : fail(404, `There is no token called ${decode(id)}.`);

const links = (t: TokenRow, key: string = t.ticker) => ({ self: `${API_PREFIX}/tokens/${encodeURIComponent(key)}`, receipts: `${API_PREFIX}/tokens/${encodeURIComponent(key)}/receipts`, page: `/burnticker/t/${encodeURIComponent(key)}` });

export function v1Catalogue(now = Date.now(), env: Record<string, string | undefined> = process.env): ApiResult {
  return ok({ ...catalogueSources(now, { includeConfig: true }), launches: catalogueLaunches(env), kalshi: { search: `${API_PREFIX}/kalshi/search?q=`, note: "Kalshi series are tier 1 adjudicated markets, searched live. Only settled results count, and prices are shown for display only." }, polymarket: { search: `${API_PREFIX}/polymarket/search?q=`, note: "Polymarket yes-or-no markets are tier 1 adjudicated markets, searched live on Gamma. Each result is read from the on-chain payout on Polygon. Prices are shown for display only." } });
}

export function v1SourcePreview(id: string, q: URLSearchParams, now = Date.now()): ApiResult {
  const feed = feedById(decode(id));
  if (!feed) return fail(404, `There is no catalogue source called ${id}.`);
  const tokens = q.get("tokens"), frac = q.get("fractionOfPool");
  const perUnit = tokens !== null ? { tokens: Number(tokens) } : { fractionOfPool: frac !== null ? Number(frac) : 0.02 };
  let locked: LockedRule;
  try {
    locked = lockRule({ schema: BURNTICKER_RULES_SCHEMA, oracle: "catalogue", series: feed.id, market: null, filter: {}, kind: "scalar", scalar: { unit: feed.unit!.size, perUnit, baseline: feed.baseline!, direction: feed.direction! }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: tokens !== null ? { share: 0.2, vestDays: 365, cliffDays: 0 } : null });
  } catch (e) { return fail(400, (e as Error).message); }
  let pv;
  try { pv = previewFromFixture(feed, locked.rule, now); } catch (e) { return fail(404, `${feed.id} has no saved sample to preview. The reason given was: ${(e as Error).message.slice(0, 120)}`); }
  return ok({ id: feed.id, title: feed.title, tier: feed.tier, tierLabel: TIER_LABEL[feed.tier], launchable: feed.launchable, rule: locked.rule, sha256: locked.sha256, statement: ruleStatement(locked.rule, { feedTitle: feed.title }), window: pv.window, totals: pv.totals, perMonth: pv.perMonth, rows: pv.rows, lastReading: pv.lastReading, fixtureFetchedAt: loadFixture(feed).fetchedAt, sentence: `${backtestSentence(pv)} This comes from the source's saved sample.`, note: "These totals are for display only. Receipts use the keeper's exact whole-number spend.", config: publicConfig(feed.config) });
}

export const v1KalshiSearch = (p: Platform, q: URLSearchParams): Promise<ApiResult> => kalshiSearch(p, { q: q.get("q"), category: q.get("category"), series: q.get("series") });
export const v1KalshiEvents = (p: Platform, q: URLSearchParams): Promise<ApiResult> => kalshiEvents(p, { q: q.get("q"), series: q.get("series"), status: q.get("status") });
export const v1KalshiTeams = (p: Platform, q: URLSearchParams): Promise<ApiResult> => kalshiTeams(p, { series: q.get("series") });
export const v1Search = async (p: Platform, q: URLSearchParams): Promise<ApiResult> => {
  const r = await search(p, { q: q.get("q") });
  // a search that found no card is logged, anonymously (productStore.ts; the page reports the no-click misses itself)
  if (r.status === 200) logNoCardSearch(p, q.get("q") ?? "", ((r.body as { cards?: unknown[] }).cards ?? []).length);
  return r;
};
export const v1Elections = (p: Platform, q: URLSearchParams): Promise<ApiResult> => elections(p, { type: q.get("type"), state: q.get("state") });
export const v1ElectionPair = (p: Platform, q: URLSearchParams): Promise<ApiResult> => electionPair(p, { slug: q.get("slug"), a: q.get("a"), b: q.get("b") });
export const v1SportsTeams = (p: Platform, q: URLSearchParams): Promise<ApiResult> => sportsTeams(p, { league: q.get("league"), q: q.get("q") });
export const v1SportsGames = (p: Platform, q: URLSearchParams): Promise<ApiResult> => sportsGames(p, { league: q.get("league"), q: q.get("q") });
export const v1Browse = (p: Platform, q: URLSearchParams): Promise<ApiResult> => browse(p, { category: q.get("category"), q: q.get("q") });
export const v1KalshiCategories = (p: Platform, q: URLSearchParams): Promise<ApiResult> => kalshiCategories(p, { category: q.get("category"), tag: q.get("tag"), q: q.get("q"), limit: q.get("limit"), offset: q.get("offset"), events: q.get("events"), polymarket: q.get("polymarket") });
export const v1Backtest = (p: Platform, body: Record<string, unknown>): Promise<ApiResult> => runBacktest(p, body);
export const v1PolymarketSearch = (p: Platform, q: URLSearchParams): Promise<ApiResult> => polymarketSearch(p, { q: q.get("q"), status: q.get("status") });
/** POST /polymarket/backtest — a Polymarket rule's back-test from Gamma's closed markets (the same pipeline as /kalshi/backtest). */
export async function v1PolymarketBacktest(p: Platform, body: Record<string, unknown>): Promise<ApiResult> {
  const oracle = (body.rule as { oracle?: unknown } | null | undefined)?.oracle;
  if (oracle !== "polymarket") return fail(400, 'This back-test takes Polymarket rules only. Send Kalshi and catalogue rules to POST /kalshi/backtest.');
  return runBacktest(p, body);
}

export function v1Validate(body: Record<string, unknown>): ApiResult {
  try {
    const l = lockRule(body.rule);
    return ok({ ok: true, rule: l.rule, canonical: l.text, sha256: l.sha256, sha12: l.sha12, mode: l.mode, statement: ruleStatement(l.rule), receiptFormat: receiptFormatTemplate(String(body.ticker ?? "TICKER").toUpperCase(), l.rule.oracle, l.sha12) });
  } catch (e) {
    const msg = (e as Error).message.replace(/^rule: /, "");
    return { status: 400, body: { ok: false, error: `rule: ${msg}`, problems: msg.split("; ") } };
  }
}

/** The unsigned launch transactions + the review payload the wizard shows. Requires the caller's own mint public key. */
export async function v1LaunchBundle(p: Platform, body: Record<string, unknown>): Promise<ApiResult> {
  const mint = typeof body.mint === "string" ? body.mint.trim() : "";
  if (!mint) return fail(400, "A mint is required. Make a new mint keypair yourself and send its public key. The secret key never leaves your machine.", { problems: ["A mint is required."] });
  const register = body.register !== false;
  const blockhash = typeof body.recentBlockhash === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.recentBlockhash) ? body.recentBlockhash : null;
  const r = await prepareLaunch(p, body, { register, mint });
  if ("error" in r) return r.error;
  if (!("ok" in r)) return fail(400, "Rivalry pairs launch through the pair steps on the launch page.");
  const { bundle, token, seriesTitle, locked, preflight } = r.ok;
  const transactions = compileUnsigned(bundle.transactions, bundle.creator, blockhash);
  return ok({
    ok: true, cluster: bundle.cluster, ready: bundle.ready, pending: bundle.pending,
    review: {
      ticker: bundle.ticker, name: bundle.name, description: bundle.description, creator: bundle.creator, mint: bundle.mint, cluster: bundle.cluster, seriesTitle,
      rules: { ...bundle.rules, statement: ruleStatement(locked.rule, { seriesTitle }) }, receiptFormat: receiptFormatTemplate(bundle.ticker, locked.rule.oracle, locked.sha12),
      addresses: bundle.addresses, allocation: bundle.allocation, fees: bundle.fees, burnPoolAuthority: bundle.burnPoolAuthority, notes: bundle.notes,
      disclosure: { disclaimer: DISCLAIMER_FOOTER, eventContract: oracleDisclosure(locked.rule.oracle) },
      operator: operatorPowersSummary(loadPowersRegister()),
      acknowledgements: ["I understand that nobody can change the rule, including me.", "I am not promising anyone anything. I make no claims about returns or price."],
    },
    transactions,
    registered: token ? { status: token.status, ticker: token.ticker, mint: token.mint } : null,
    next: [
      ...(bundle.ready ? [] : ["This launch cannot be signed yet. The pending list says what is missing. Send nothing until ready is true."]),
      ...(transactions.some((t) => t.blockhashPlaceholder) ? ["Replace the placeholder blockhash with a recent one from your RPC, or pass recentBlockhash in the request. Then sign."] : []),
      "Sign each transaction with the creator wallet and with your mint keypair.",
      "Send the signed transaction. Then post the mint and the signature to /launch/confirm. Results settled after that moment count.",
    ],
    stubs: p.stubs,
    preflight,
  });
}

export async function v1Confirm(p: Platform, body: Record<string, unknown>): Promise<ApiResult> {
  const mint = String(body.mint ?? ""), sig = String(body.signature ?? "");
  const r = await markLaunched(p, mint, sig);
  if (r.status !== 200) return r;
  const t = p.registry.token(mint)!;
  return ok({ ok: true, ticker: t.ticker, mint: t.mint, status: t.status, note: (r.body as { note: string }).note });
}

export function v1ListTokens(p: Platform, q: URLSearchParams): ApiResult {
  const status = q.get("status");
  if (status !== null && !["draft", "live", "paused", "retired", "expired"].includes(status)) return fail(400, "The status must be draft, live, paused, retired or expired.");
  p.registry.expireDrafts();
  const limit = Math.min(200, Math.max(1, Number(q.get("limit") ?? 100) || 100)), offset = Math.max(0, Number(q.get("offset") ?? 0) || 0);
  const all = p.registry.tokens((status as TokenStatus | null) ?? undefined);
  const page = all.slice(offset, offset + limit).map((t) => {
    const rows = p.registry.receipts(t.mint);
    const confirmed = rows.filter((b) => b.status === "confirmed");
    const burned = confirmed.reduce((a, b) => a + (b.burnRaw ?? ZERO), ZERO);
    const burns = confirmed.filter((b) => (b.burnRaw ?? ZERO) > ZERO);
    const lastBurnAt = burns.map((b) => b.settledAt).sort().pop() ?? null;
    return { ticker: t.ticker, name: t.name, mint: t.mint, status: t.status, oracle: t.oracle, selectorKey: t.selectorKey, mode: t.mode, rulesSha256: t.rulesSha, creator: t.creator, cluster: t.cluster, baselineAt: t.baselineAt, receipts: rows.length, burns: burns.length, burnedTokens: rawToTokens(burned, 6), imageUrl: t.imageUrl, lastBurnAt, links: links(t, registryCoinKey(p.registry, t)) };
  });
  return ok({ tokens: page, count: page.length, total: all.length, cluster: p.cluster });
}

export async function v1Token(p: Platform, id: string): Promise<ApiResult> {
  const l = findCoin(p, id);
  if (l.kind !== "one") return notOne(p, l, id);
  const t = l.token;
  const d = await tokenPageData(p, t);
  return ok({ status: d.status, receipts: d.receipts, readings: d.readings.map((r) => ({ id: r.id, at: r.at, result: r.result, value: r.value, title: r.title, sourceUrl: r.sourceUrl, settlementSourceUrl: r.settlementSourceUrl, method: r.method, proof: r.proof ?? null, attestedBy: r.attestedBy })), rulesText: d.rulesText, stubs: d.stubs });
}

export async function v1Receipts(p: Platform, id: string): Promise<ApiResult> {
  const l = findCoin(p, id);
  if (l.kind !== "one") return notOne(p, l, id);
  const t = l.token;
  const d = await tokenPageData(p, t, Date.now(), { live: false });
  return ok({ ticker: t.ticker, mint: t.mint, rulesSha256: t.rulesSha, count: d.receipts.length, receipts: d.receipts });
}

/** Server-side verification: the same checks as the SDK's verifyReceipt, with the platform's Kalshi client and program client. */
export async function v1Verify(p: Platform, id: string, eventId: string, o: { fetchImpl?: FetchLike; rpcFetch?: RpcFetchLike; now?: number } = {}): Promise<ApiResult> {
  const l = findCoin(p, id);
  if (l.kind !== "one") return notOne(p, l, id);
  const t = l.token;
  const ev = decode(eventId);
  const d = await tokenPageData(p, t, o.now ?? Date.now(), { live: false });
  const receipt = d.receipts.find((r) => r.eventId === ev);
  if (!receipt) return fail(404, `$${t.ticker} has no receipt for ${ev}.`);
  const locked = lockRule(JSON.parse(t.rulesJson));
  const now = o.now ?? Date.now();
  const feed = locked.rule.oracle === "catalogue" ? feedById(locked.rule.series!) : null;
  let source: SourceReading;
  if (locked.rule.oracle === "kalshi") source = await kalshiSourceReading(locked.rule, ev, o.fetchImpl ?? kalshiFetchVia(p), now);
  // The payout vector through the platform's client (its RPC list; a resolved vector is immutable on chain, so its cache is exact) unless a fetch is given.
  else if (locked.rule.oracle === "polymarket") source = await polymarketSourceReading(locked.rule, ev, { fetchImpl: o.fetchImpl ?? polymarketFetchVia(p), ...(o.rpcFetch ? { rpcFetch: o.rpcFetch } : { readChain: (id: string) => p.polymarket.readChain(id) }) });
  else if (feed) source = o.fetchImpl ? await feedSourceReading(feed.config, o.fetchImpl, now)
    // the keeper's own reader (the catalogue adapter: same request, same parser, same politeness)
    : await p.oracles.catalogue.settledSince(locked.rule, null).then((r) => ({ events: r.events, error: null, url: feed.config.request.url }), (e: Error) => ({ events: null, error: e.message.slice(0, 160), url: feed.config.request.url }));
  else source = { events: null, error: `There is no reader for the ${locked.rule.oracle} source.`, url: null };
  let chain: ChainReading | null = null;
  if (receipt.signature) {
    // Program receipts carry the program's memo ("<TICKER>|<reading date>|…"); the v3 receipt memo is keyed by the event.
    const key = receipt.execution === "program" && receipt.memo ? `${receipt.memo.split("|").slice(0, 2).join("|")}|` : receiptKey(t.ticker, ev);
    const found = await p.program.findReceiptOnChain(t.mint, key).catch(() => null);
    chain = found ? { found: found.signature === receipt.signature, err: null, memo: found.memo } : { found: false, err: null, memo: null };
  }
  const v = verifyReceiptCore({ ticker: t.ticker, rulesText: t.rulesJson, receipt, carry: feed?.carry ?? "none", source, chain });
  return ok({ ...v, receipt, how: ["The rule was locked again from rules.json and hashed. You can do the same with shasum -a 256 rules.json.", "The settled result was read again from the original source just now. For Polymarket, that is the on-chain payout on Polygon.", "The units and the spend come from the published rule and the keeper's exact whole-number formula.", "The chain check reads the memo on the receipt's transaction.", "You can do all of this yourself without trusting this server. Use verifyReceipt() in @burnticker/sdk."] });
}

/** The platform's Kalshi client as a FetchLike (its cache, politeness and — in tests — its fixture table). */
function kalshiFetchVia(p: Platform): FetchLike {
  return async (url) => {
    try { const body = await p.kalshi.get(url, 60_000); return { ok: true, status: 200, json: async () => body }; } catch (e) { const m = /HTTP (\d+)/.exec((e as Error).message); return { ok: false, status: m ? Number(m[1]) : 502, json: async () => ({}) }; }
  };
}

/** The platform's Polymarket client as a FetchLike for Gamma (its cache and politeness; in tests its fixture table). */
function polymarketFetchVia(p: Platform): FetchLike {
  return async (url) => {
    try { const body = await p.polymarket.get(url, 60_000); return { ok: true, status: 200, json: async () => body }; } catch (e) { const m = /HTTP (\d+)/.exec((e as Error).message); return { ok: false, status: m ? Number(m[1]) : 502, json: async () => ({}) }; }
  };
}

export async function v1Trust(p: Platform): Promise<ApiResult> {
  const rpc = (process.env.BURNTICKER_RPC_URL ?? "").trim();
  const reader = rpc ? await web3ChainReader(rpc).catch(() => null) : null;
  const attesters = p.registry.tokens().map((t) => { const a = p.registry.attesters(t.mint).filter((x) => x.active); return { ticker: t.ticker, attesters: a.length, independent: a.filter((x) => x.role === "independent").length, quorum: Math.max(1, Math.min(1, a.length)) }; });
  const live = p.registry.tokens("live");
  const page = await buildTrustPage({ reader, siteDir: p.publishDir, attesters, firstLaunchAt: live.length ? Math.min(...live.map((t) => Date.parse(t.baselineAt))) : null, cluster: p.cluster });
  const liveBps = page.livePlatform.found ? Object.fromEntries(page.livePlatform.comparison.map((r) => [r.field, { designed: r.designed, live: r.live, matches: r.matches }])) : null;
  return ok({
    generatedAt: page.generatedAt, cluster: p.cluster, powers: page.powers, operator: page.operator,
    fees: { designed: page.designedFees, live: { platformId: page.livePlatform.platformId, found: page.livePlatform.found, readAt: page.livePlatform.readAt, error: page.livePlatform.error, fields: liveBps } },
    lpLock: page.lpLock,
    program: page.program, attesters: page.attesters, audit: page.audit, statements: page.statements, operatorLine: page.operatorLine, useOfFees: page.useOfFees, preAuditCapSol: page.preAuditCapSol,
    cannot: ["Change any token's rule. A different rule makes a different token.", "Claim, redirect or discount any fee through this API.", "Adopt an existing token. The program needs the new mint's signature when the token is set up.", "Sign, send or hold a key for you."],
    rpcConfigured: !!rpc, stubs: p.stubs,
  });
}

export const v1OpenApi = (): ApiResult => ok(buildOpenApi());

/**
 * GET /v1/coverage (1.3.0): the settlement-coverage matrix (src/lib/burnticker/coverage), computed OFFLINE from the sources' frozen
 * fixtures — no network on a request — with the registry's first sightings for latency, cached in memory for ten minutes. The same
 * object renders docs/burnticker/SETTLEMENT-COVERAGE.md and the trust page's "Settlement coverage" section.
 */
let coverageCache: { at: number; matrix: CoverageMatrix } | null = null;
export const COVERAGE_TTL_MS = 600_000;
export async function v1Coverage(p: Platform, now = Date.now()): Promise<ApiResult> {
  if (coverageCache && now - coverageCache.at < COVERAGE_TTL_MS) return ok(coverageCache.matrix);
  const observations = (id: string) => { try { return p.registry.readings(`catalogue:${id}`).map((r) => ({ id: r.id, firstSeenAt: r.fetchedAt })); } catch { return []; } };
  const { matrix } = await buildCoverage({ mode: "offline", observations });
  coverageCache = { at: now, matrix };
  return ok(matrix);
}
/** For tests: drop the cached matrix. */
export function resetCoverageCache(): void { coverageCache = null; }

export { platform };
