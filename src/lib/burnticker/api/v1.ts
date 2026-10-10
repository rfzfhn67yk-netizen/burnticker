import { platform, tokenPageData, type Platform } from "@/lib/burnticker/server";
import { feedById, loadFixture, previewFromFixture } from "@/lib/burnticker/catalogue";
import { TIER_LABEL } from "@/lib/burnticker/sources/types";
import { BURNTICKER_RULES_SCHEMA, DISCLAIMER_FOOTER, lockRule, oracleDisclosure, ruleStatement, type LockedRule } from "@/lib/burnticker/rules";
import { backtestSentence } from "@/lib/burnticker/oracle/backtest";
import { receiptFormatTemplate, receiptKey } from "@/lib/burnticker/receipt";
import { compileUnsigned } from "@/lib/burnticker/transactions";
import { feedSourceReading, kalshiSourceReading, polymarketSourceReading, verifyReceiptCore, type ChainReading, type SourceReading } from "@/lib/burnticker/verify";
import { rawToTokens } from "@/lib/burnKeeper/rules";
import { buildTrustPage, loadPowersRegister, operatorPowersSummary, web3ChainReader } from "@/lib/burnticker/trust";
import type { TokenRow, TokenStatus } from "@/lib/burnticker/registry";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { catalogueSources, markLaunched, prepareLaunch, runBacktest, kalshiSearch, kalshiEvents, kalshiTeams, kalshiCategories, browse, polymarketSearch, publicConfig } from "@/lib/burnticker/api/handlers";
import type { FetchLike as RpcFetchLike } from "@/lib/burnKeeper/attesters/polymarketOnchain";
import { fail, ok, type ApiResult } from "@/lib/burnticker/api/http";
import { API_PREFIX, buildOpenApi } from "@/lib/burnticker/api/spec";

/**
 * THE PUBLIC API, v1 (2026-10-09). One function per operation in spec.ts; the route files under src/app/api/burnticker/v1/ call these
 * through runV1 (rate limit, cache, cross-site refusal). Public data and unsigned transactions only: nothing here holds a key, signs,
 * sends, or reads anything a stranger could not read themselves. There is no adopt-an-existing-token path anywhere: the Receipts
 * program's initialize_token needs the NEW mint's signature, so only a coin created through this flow can ever have a burn config.
 */

const ZERO = BigInt(0);

/** decodeURIComponent that never throws (a malformed escape is looked up as written, and simply not found). */
const decode = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };

/** A token by ticker (case-insensitive) or by mint address. */
export function findToken(p: Platform, id: string): TokenRow | null {
  const s = decode(id).trim();
  return s.length >= 32 ? p.registry.token(s) : p.registry.tokenByTicker(s);
}

const links = (t: TokenRow) => ({ self: `${API_PREFIX}/tokens/${t.ticker}`, receipts: `${API_PREFIX}/tokens/${t.ticker}/receipts`, page: `/burnticker/t/${t.ticker}` });

export function v1Catalogue(now = Date.now()): ApiResult {
  return ok({ ...catalogueSources(now, { includeConfig: true }), kalshi: { search: `${API_PREFIX}/kalshi/search?q=`, note: "Kalshi series (tier 1, adjudicated markets) are searched live; settled results only, prices display-only" }, polymarket: { search: `${API_PREFIX}/polymarket/search?q=`, note: "Polymarket binary markets (tier 1, adjudicated markets) are searched live on Gamma; each result is read from the Conditional Tokens payout vector on Polygon; prices display-only" } });
}

export function v1SourcePreview(id: string, q: URLSearchParams, now = Date.now()): ApiResult {
  const feed = feedById(decode(id));
  if (!feed) return fail(404, `no catalogue source ${id}`);
  const tokens = q.get("tokens"), frac = q.get("fractionOfPool");
  const perUnit = tokens !== null ? { tokens: Number(tokens) } : { fractionOfPool: frac !== null ? Number(frac) : 0.02 };
  let locked: LockedRule;
  try {
    locked = lockRule({ schema: BURNTICKER_RULES_SCHEMA, oracle: "catalogue", series: feed.id, market: null, filter: {}, kind: "scalar", scalar: { unit: feed.unit!.size, perUnit, baseline: feed.baseline!, direction: feed.direction! }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: tokens !== null ? { share: 0.2, vestDays: 365, cliffDays: 0 } : null });
  } catch (e) { return fail(400, (e as Error).message); }
  let pv;
  try { pv = previewFromFixture(feed, locked.rule, now); } catch (e) { return fail(404, `${feed.id} has no fixture to preview: ${(e as Error).message.slice(0, 120)}`); }
  return ok({ id: feed.id, title: feed.title, tier: feed.tier, tierLabel: TIER_LABEL[feed.tier], launchable: feed.launchable, rule: locked.rule, sha256: locked.sha256, statement: ruleStatement(locked.rule, { feedTitle: feed.title }), window: pv.window, totals: pv.totals, perMonth: pv.perMonth, rows: pv.rows, lastReading: pv.lastReading, fixtureFetchedAt: loadFixture(feed).fetchedAt, sentence: `${backtestSentence(pv)} (from the source's frozen fixture)`, note: "display-grade totals; receipts use the keeper's exact integer spend", config: publicConfig(feed.config) });
}

export const v1KalshiSearch = (p: Platform, q: URLSearchParams): Promise<ApiResult> => kalshiSearch(p, { q: q.get("q"), category: q.get("category"), series: q.get("series") });
export const v1KalshiEvents = (p: Platform, q: URLSearchParams): Promise<ApiResult> => kalshiEvents(p, { q: q.get("q"), series: q.get("series"), status: q.get("status") });
export const v1KalshiTeams = (p: Platform, q: URLSearchParams): Promise<ApiResult> => kalshiTeams(p, { series: q.get("series") });
export const v1Browse = (p: Platform, q: URLSearchParams): Promise<ApiResult> => browse(p, { category: q.get("category"), q: q.get("q") });
export const v1KalshiCategories = (p: Platform, q: URLSearchParams): Promise<ApiResult> => kalshiCategories(p, { category: q.get("category"), tag: q.get("tag"), q: q.get("q"), limit: q.get("limit"), offset: q.get("offset"), events: q.get("events"), polymarket: q.get("polymarket") });
export const v1Backtest = (p: Platform, body: Record<string, unknown>): Promise<ApiResult> => runBacktest(p, body);
export const v1PolymarketSearch = (p: Platform, q: URLSearchParams): Promise<ApiResult> => polymarketSearch(p, { q: q.get("q"), status: q.get("status") });
/** POST /polymarket/backtest — a Polymarket rule's back-test from Gamma's closed markets (the same pipeline as /kalshi/backtest). */
export async function v1PolymarketBacktest(p: Platform, body: Record<string, unknown>): Promise<ApiResult> {
  const oracle = (body.rule as { oracle?: unknown } | null | undefined)?.oracle;
  if (oracle !== "polymarket") return fail(400, 'rule.oracle must be "polymarket" here (Kalshi and catalogue rules: POST /kalshi/backtest)');
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
  if (!mint) return fail(400, "mint is required: generate a fresh mint keypair yourself and send its PUBLIC key (the secret never leaves your machine)", { problems: ["mint is required"] });
  const register = body.register !== false;
  const blockhash = typeof body.recentBlockhash === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.recentBlockhash) ? body.recentBlockhash : null;
  const r = await prepareLaunch(p, body, { register, mint });
  if ("error" in r) return r.error;
  if (!("ok" in r)) return fail(400, "rivalry pairs launch through the wizard's pair flow");
  const { bundle, token, seriesTitle, locked } = r.ok;
  const transactions = compileUnsigned(bundle.transactions, bundle.creator, blockhash);
  return ok({
    ok: true, cluster: bundle.cluster, ready: bundle.ready, pending: bundle.pending,
    review: {
      ticker: bundle.ticker, name: bundle.name, description: bundle.description, creator: bundle.creator, mint: bundle.mint, cluster: bundle.cluster, seriesTitle,
      rules: { ...bundle.rules, statement: ruleStatement(locked.rule, { seriesTitle }) }, receiptFormat: receiptFormatTemplate(bundle.ticker, locked.rule.oracle, locked.sha12),
      addresses: bundle.addresses, allocation: bundle.allocation, fees: bundle.fees, burnPoolAuthority: bundle.burnPoolAuthority, notes: bundle.notes,
      disclosure: { disclaimer: DISCLAIMER_FOOTER, eventContract: oracleDisclosure(locked.rule.oracle) },
      operator: operatorPowersSummary(loadPowersRegister()),
      acknowledgements: ["I understand the rule cannot be changed by anyone, including me", "I am not promising anyone anything (no returns, no price talk)"],
    },
    transactions,
    registered: token ? { status: token.status, ticker: token.ticker, mint: token.mint } : null,
    next: [
      ...(bundle.ready ? [] : ["NOT SIGNABLE YET: see `pending` — nothing should be sent until ready is true"]),
      ...(transactions.some((t) => t.blockhashPlaceholder) ? ["replace the placeholder recentBlockhash with a fresh one from your RPC (or pass recentBlockhash), then sign"] : []),
      "sign each transaction with the creator wallet AND your mint keypair (signers: creator + mint)",
      "send it, then POST /launch/confirm { mint, signature } — settlements after that moment count",
    ],
    stubs: p.stubs,
  });
}

export function v1Confirm(p: Platform, body: Record<string, unknown>): ApiResult {
  const mint = String(body.mint ?? ""), sig = String(body.signature ?? "");
  const r = markLaunched(p, mint, sig);
  if (r.status !== 200) return r;
  const t = p.registry.token(mint)!;
  return ok({ ok: true, ticker: t.ticker, mint: t.mint, status: t.status, note: (r.body as { note: string }).note });
}

export function v1ListTokens(p: Platform, q: URLSearchParams): ApiResult {
  const status = q.get("status");
  if (status !== null && !["draft", "live", "paused", "retired", "expired"].includes(status)) return fail(400, "status must be draft, live, paused, retired or expired");
  p.registry.expireDrafts();
  const limit = Math.min(200, Math.max(1, Number(q.get("limit") ?? 100) || 100)), offset = Math.max(0, Number(q.get("offset") ?? 0) || 0);
  const all = p.registry.tokens((status as TokenStatus | null) ?? undefined);
  const page = all.slice(offset, offset + limit).map((t) => {
    const rows = p.registry.receipts(t.mint);
    const confirmed = rows.filter((b) => b.status === "confirmed");
    const burned = confirmed.reduce((a, b) => a + (b.burnRaw ?? ZERO), ZERO);
    const burns = confirmed.filter((b) => (b.burnRaw ?? ZERO) > ZERO);
    const lastBurnAt = burns.map((b) => b.settledAt).sort().pop() ?? null;
    return { ticker: t.ticker, name: t.name, mint: t.mint, status: t.status, oracle: t.oracle, selectorKey: t.selectorKey, mode: t.mode, rulesSha256: t.rulesSha, creator: t.creator, cluster: t.cluster, baselineAt: t.baselineAt, receipts: rows.length, burns: burns.length, burnedTokens: rawToTokens(burned, 6), imageUrl: t.imageUrl, lastBurnAt, links: links(t) };
  });
  return ok({ tokens: page, count: page.length, total: all.length, cluster: p.cluster });
}

export async function v1Token(p: Platform, id: string): Promise<ApiResult> {
  const t = findToken(p, id);
  if (!t) return fail(404, `no token ${decode(id)}`);
  const d = await tokenPageData(p, t);
  return ok({ status: d.status, receipts: d.receipts, readings: d.readings.map((r) => ({ id: r.id, at: r.at, result: r.result, value: r.value, title: r.title, sourceUrl: r.sourceUrl, settlementSourceUrl: r.settlementSourceUrl, method: r.method, proof: r.proof ?? null, attestedBy: r.attestedBy })), rulesText: d.rulesText, stubs: d.stubs });
}

export async function v1Receipts(p: Platform, id: string): Promise<ApiResult> {
  const t = findToken(p, id);
  if (!t) return fail(404, `no token ${decode(id)}`);
  const d = await tokenPageData(p, t, Date.now(), { live: false });
  return ok({ ticker: t.ticker, mint: t.mint, rulesSha256: t.rulesSha, count: d.receipts.length, receipts: d.receipts });
}

/** Server-side verification: the same checks as the SDK's verifyReceipt, with the platform's Kalshi client and program client. */
export async function v1Verify(p: Platform, id: string, eventId: string, o: { fetchImpl?: FetchLike; rpcFetch?: RpcFetchLike; now?: number } = {}): Promise<ApiResult> {
  const t = findToken(p, id);
  if (!t) return fail(404, `no token ${decode(id)}`);
  const ev = decode(eventId);
  const d = await tokenPageData(p, t, o.now ?? Date.now(), { live: false });
  const receipt = d.receipts.find((r) => r.eventId === ev);
  if (!receipt) return fail(404, `no receipt ${ev} for $${t.ticker}`);
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
  else source = { events: null, error: `no adapter for oracle ${locked.rule.oracle}`, url: null };
  let chain: ChainReading | null = null;
  if (receipt.signature) {
    // Program receipts carry the program's memo ("<TICKER>|<reading date>|…"); the v3 receipt memo is keyed by the event.
    const key = receipt.execution === "program" && receipt.memo ? `${receipt.memo.split("|").slice(0, 2).join("|")}|` : receiptKey(t.ticker, ev);
    const found = await p.program.findReceiptOnChain(t.mint, key).catch(() => null);
    chain = found ? { found: found.signature === receipt.signature, err: null, memo: found.memo } : { found: false, err: null, memo: null };
  }
  const v = verifyReceiptCore({ ticker: t.ticker, rulesText: t.rulesJson, receipt, carry: feed?.carry ?? "none", source, chain });
  return ok({ ...v, receipt, how: ["rules: re-lock rules.json and hash it (shasum -a 256 rules.json)", "source: the settled result re-read from the original source just now (Polymarket: the CTF payout vector on Polygon)", "units/spend: the published rule applied with the keeper's exact integer formula", "chain: the memo of the receipt's transaction", "do it yourself without trusting this server: @burnticker/sdk verifyReceipt()"] });
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
  const page = await buildTrustPage({ reader, siteDir: p.publishDir, attesters, firstLaunchAt: live.length ? Math.min(...live.map((t) => Date.parse(t.baselineAt))) : null });
  const liveBps = page.livePlatform.found ? Object.fromEntries(page.livePlatform.comparison.map((r) => [r.field, { designed: r.designed, live: r.live, matches: r.matches }])) : null;
  return ok({
    generatedAt: page.generatedAt, cluster: p.cluster, powers: page.powers, operator: page.operator,
    fees: { designed: page.designedFees, live: { platformId: page.livePlatform.platformId, found: page.livePlatform.found, readAt: page.livePlatform.readAt, error: page.livePlatform.error, fields: liveBps } },
    program: page.program, attesters: page.attesters, audit: page.audit, statements: page.statements, operatorLine: page.operatorLine, useOfFees: page.useOfFees, preAuditCapSol: page.preAuditCapSol,
    cannot: ["change any token's rule (a different rule is a different token)", "claim, redirect or discount any fee through this API", "adopt an existing token (the program needs the new mint's signature at init)", "sign, send or hold a key for you"],
    rpcConfigured: !!rpc, stubs: p.stubs,
  });
}

export const v1OpenApi = (): ApiResult => ok(buildOpenApi());

export { platform };
