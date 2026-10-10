import { catalogue, feedById, loadSourceEntries, type Feed } from "@/lib/burnticker/catalogue";
import { fetchBody, parseBody } from "@/lib/burnticker/sources/attestedHttp";
import { chainResult, gammaResult, settledAtOf, type GammaMarket, type PolymarketClient } from "@/lib/burnticker/oracle/polymarket";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { SettledEvent } from "@/lib/burnticker/units";
import type { PreflightCode, PreflightReading, PreflightResult, SourceDescriptor } from "@/lib/burnticker/coverage/types";
import { compareFact, crossReadsOf, describeEntry, primaryEligibility } from "@/lib/burnticker/coverage/sources";
import { nextExpected } from "@/lib/burnticker/coverage/schedule";
import type { DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { DERBY_DISAGREEMENT_PP } from "@/lib/burnticker/derby/spec";
import { PYTH_SOL_USD, pythFeedAccount, pythSnapshotFromAccount, type PythRead } from "@/lib/burnticker/derby/pyth";
import { crossQuote } from "@/lib/burnticker/derby/cross";
import { samplePool, type PoolPort } from "@/lib/burnticker/derby/pools";
import { mulDec, truncDec } from "@/lib/burnticker/derby/measure";
import { marketHours } from "@/lib/burnticker/derby/adapter";
import { nativeSourceById } from "@/lib/burnticker/sources/native";

/**
 * THE CREATION PREFLIGHT (2026-10-10, the settlement-coverage audit). Before a coin is created on a selector, the selector is run live
 * ONCE — the primary and its independent cross-read — and the answer says the last reading, when the next one is expected, whether
 * the two reads agree on the latest period they share, and a refusal reason if anything failed (including a STALE read: a scheduled
 * source whose newest complete reading is more than a week past the next one's due date). The launch pipeline
 * (api/handlers.ts prepareLaunch, shared by the wizard and POST /v1/launch/bundle) refuses creation on a refusal while
 * BURNTICKER_PREFLIGHT_STRICT is on (default; the test hook turns it off for the suite, and the preflight tests turn it back on).
 *
 *   catalogue   primary = the feed (must be a primary: launchable, not an aggregator, not cross-read-only); cross-read = the first
 *               readable source of the same fact under another operator on another domain. No cross-read → refused.
 *   polymarket  primary = the CTF payout vector on Polygon; cross-read = Gamma's own resolution report. One market: the market must
 *               be known and the chain readable (an open market has no reading yet; its end date is the next expected one). A tag or
 *               event: the latest settled market of the last 30 days, read on chain and compared with Gamma.
 *   kalshi      always refused: Kalshi's Developer Agreement and Data Terms forbid settling products on its data (owner, 10-10) —
 *               whatever BURNTICKER_KALSHI_ENABLED says.
 *   derby       (Burn Derby, 2026-10-10) each coin's primary — Pyth's Solana account (keyless), Hermes when keyed, or the pool TWAP — and
 *               its cross-read (Jupiter / DexScreener / RedStone) read in the same minute; refused when either is unreadable, the
 *               cross-read does not carry the asset, or the two differ by more than 2%.
 *   uma / drift-bet / hedgehog   refused: stub adapters.
 */

export const PREFLIGHT_FLAG = "BURNTICKER_PREFLIGHT_STRICT";
/** How long past its due date a scheduled source may go without a newer reading before the preflight calls the read stale. */
export const STALE_GRACE_MS = 7 * 86_400_000;
/** Strict unless the flag says 0 / false / off / no. */
export function preflightStrict(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return !["0", "false", "off", "no"].includes((env[PREFLIGHT_FLAG] ?? "").trim().toLowerCase());
}

export interface PreflightDeps {
  /** For catalogue sources (default: global fetch, through fetchBody's polite headers and timeout). */
  fetchImpl?: FetchLike;
  /** For Polymarket selectors (the platform's client: its cache, spacing and RPC list). */
  polymarket?: Pick<PolymarketClient, "marketByCondition" | "readChain" | "settledSince" | "gammaSettled" | "candidates" | "clock"> | null;
  now?: number;
  root?: string;
  /** The descriptors to look cross-reads up in (default: every sources.json entry). */
  sources?: SourceDescriptor[];
  /** Burn Derby's readers (2026-10-10). */
  derby?: DerbyPreflightDeps;
}

const reading = (e: SettledEvent | null | undefined): PreflightReading | null => (e ? { id: e.id, value: e.value, result: e.result, at: e.at } : null);
const selectorOf = (r: BurnRule): string => r.market ?? `${r.series ?? "?"}${r.filter?.tickerIncludes ? `:${r.filter.tickerIncludes}` : ""}`;

function result(rule: BurnRule, now: number, part: Partial<PreflightResult> & { primary: PreflightResult["primary"] }, refusal: { code: PreflightCode; reason: string; status?: 400 | 502 } | null): PreflightResult {
  return {
    ok: refusal === null, oracle: rule.oracle, selector: selectorOf(rule), crossRead: null, nextExpectedAt: null, nextExpectedBasis: "n/a", agreement: null, agreementBasis: "n/a",
    ...part, refusal: refusal ? { code: refusal.code, reason: refusal.reason, status: refusal.status ?? 400 } : null, checkedAt: new Date(now).toISOString(),
  };
}

async function readLive(feed: Feed, now: number, fetchImpl: FetchLike): Promise<{ readings: SettledEvent[]; refusals: string[] }> {
  return parseBody(feed.config, await fetchBody(feed.config, now, fetchImpl), now);
}

export async function preflightSelector(rule: BurnRule, deps: PreflightDeps = {}): Promise<PreflightResult> {
  const now = deps.now ?? Date.now();
  const none = { id: selectorOf(rule), operator: null, lastReading: null, error: null };
  if (rule.oracle === "kalshi") return result(rule, now, { primary: { ...none, operator: "Kalshi" } }, { code: "kalshi-not-settlement", reason: "Kalshi is not a settlement source: its Developer Agreement and Data Terms forbid using its API or data to settle products. Use a primary source with an independent cross-read, or a Polymarket market" });
  if (rule.oracle === "catalogue" && rule.series && nativeSourceById(rule.series)) return preflightNative(rule, deps, now);
  if (rule.oracle === "catalogue") return preflightCatalogue(rule, deps, now);
  if (rule.oracle === "polymarket") return preflightPolymarket(rule, deps, now);
  if (rule.oracle === "derby") return preflightDerby(rule, deps, now);
  return result(rule, now, { primary: none }, { code: "stub-oracle", reason: `oracle ${rule.oracle} is a stub adapter: nothing can be read from it` });
}

async function preflightCatalogue(rule: BurnRule, deps: PreflightDeps, now: number): Promise<PreflightResult> {
  const feed = rule.series ? feedById(rule.series, {}, deps.root) : null;
  if (!feed) return result(rule, now, { primary: { id: rule.series ?? "?", operator: null, lastReading: null, error: null } }, { code: "unknown-selector", reason: `no catalogue source ${rule.series}` });
  const all = deps.sources ?? loadSourceEntries(deps.root).map(describeEntry);
  const base = feed.config.id.split(":")[0];
  const desc = all.find((s) => s.id === base) ?? describeEntry({ ...feed.config, id: base });
  const primaryBase = { id: feed.id, operator: desc.operator, lastReading: null, error: null };
  const elig = primaryEligibility(desc);
  if (!elig.ok) return result(rule, now, { primary: primaryBase }, { code: "not-primary", reason: `${feed.id} cannot settle a coin: ${elig.why}` });
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  let pr: { readings: SettledEvent[]; refusals: string[] };
  try { pr = await readLive(feed, now, fetchImpl); } catch (e) { return result(rule, now, { primary: { ...primaryBase, error: (e as Error).message.slice(0, 200) } }, { code: "primary-unreadable", reason: `${feed.id} could not be read just now: ${(e as Error).message.slice(0, 160)}`, status: 502 }); }
  const last = pr.readings[pr.readings.length - 1] ?? null;
  const next = nextExpected(feed.config, last?.id ?? null, now);
  const primary = { ...primaryBase, lastReading: reading(last), error: pr.refusals.length ? pr.refusals.slice(0, 2).join("; ") : null };
  if (!last) return result(rule, now, { primary, nextExpectedAt: next.at, nextExpectedBasis: next.basis }, { code: "no-readings", reason: `${feed.id} returned no complete reading${pr.refusals.length ? ` (${pr.refusals[0]})` : ""}`, status: 502 });
  // A read that parses but stops short (a plausibility refusal, a frozen endpoint) leaves an old last reading: the schedule says a newer
  // one was due more than STALE_GRACE_MS ago → refused, with the parser's refusal as the reason (FRED's full-history CSV, 10-10).
  if (next.at && Date.parse(next.at) + STALE_GRACE_MS < now) return result(rule, now, { primary, nextExpectedAt: next.at, nextExpectedBasis: next.basis }, { code: "stale-primary", reason: `${feed.id}'s latest complete reading is ${last.id} but the next was due ${next.at.slice(0, 10)}${pr.refusals.length ? ` (${pr.refusals[0]})` : ""}`, status: 502 });
  const crosses = crossReadsOf(desc, all);
  if (!crosses.length) return result(rule, now, { primary, nextExpectedAt: next.at, nextExpectedBasis: next.basis }, { code: "no-cross-read", reason: `${feed.id} has no independent cross-read of the same fact (another operator on another domain), so it cannot settle a coin on its own reading` });
  const feeds = catalogue(deps.root);
  let lastErr: string | null = null;
  for (const c of crosses) {
    const cf = feeds.find((f) => f.config.id === c.id);
    if (!cf) continue;
    let cr: { readings: SettledEvent[]; refusals: string[] };
    const t0 = Date.now();
    try { cr = await readLive(cf, now, fetchImpl); } catch (e) { lastErr = `${c.id}: ${(e as Error).message.slice(0, 160)}`; continue; }
    const cmp = compareFact(feed.config.fact!, pr.readings, cf.config.fact!, cr.readings, { primaryReadAt: now, crossReadAt: now + (Date.now() - t0) });
    const latest = cmp.comparisons[cmp.comparisons.length - 1] ?? null;
    const crossRead = { id: c.id, operator: c.operator, lastReading: reading(cr.readings[cr.readings.length - 1]), error: null };
    const agreementBasis = latest ? `${latest.period}: ${feed.id} ${latest.primary} vs ${c.id} ${latest.crossRead} (${cmp.basis})` : `no period both reads cover yet (${cmp.basis}); compared at the next shared period`;
    if (latest && !latest.agree) return result(rule, now, { primary, crossRead, nextExpectedAt: next.at, nextExpectedBasis: next.basis, agreement: false, agreementBasis }, { code: "disagreement", reason: `the primary and its cross-read disagree on ${latest.period}: ${feed.id} ${latest.primary} vs ${c.id} ${latest.crossRead}` });
    return result(rule, now, { primary, crossRead, nextExpectedAt: next.at, nextExpectedBasis: next.basis, agreement: latest ? true : null, agreementBasis }, null);
  }
  return result(rule, now, { primary, crossRead: { id: crosses[0].id, operator: crosses[0].operator, lastReading: null, error: lastErr }, nextExpectedAt: next.at, nextExpectedBasis: next.basis }, { code: "cross-read-unreadable", reason: `no cross-read of ${feed.id} could be read just now (${lastErr ?? "no fixture or config"})`, status: 502 });
}

/**
 * NATIVE first-party sources (sources/native.ts — the ESPN scoreboard with its league cross-reads, the NWS climate report with the Iowa
 * Environmental Mesonet): the family's descriptor in sources.json must be a primary, the source's own cross-read must be an independent
 * cross-read of the same fact under the same gate (another operator on another domain), and the live check must find the latest
 * reading confirmed. Same refusal codes as the feeds.
 */
async function preflightNative(rule: BurnRule, deps: PreflightDeps, now: number): Promise<PreflightResult> {
  const src = nativeSourceById(rule.series!)!;
  const all = deps.sources ?? loadSourceEntries(deps.root).map(describeEntry);
  const desc = all.find((s) => s.id === src.descriptorId);
  const primaryBase = { id: src.id, operator: desc?.operator ?? null, lastReading: null, error: null };
  if (!desc) return result(rule, now, { primary: primaryBase }, { code: "unknown-selector", reason: `no descriptor ${src.descriptorId} in sources.json for ${src.id}` });
  const elig = primaryEligibility(desc);
  if (!elig.ok) return result(rule, now, { primary: primaryBase }, { code: "not-primary", reason: `${src.id} cannot settle a coin: ${elig.why}` });
  const cross = crossReadsOf(desc, all).find((c) => c.id === src.crossReadId) ?? null;
  if (!cross) return result(rule, now, { primary: primaryBase }, { code: "no-cross-read", reason: `${src.id}'s cross-read ${src.crossReadId ?? "(none)"} is not an independent read of the same fact (another operator on another domain)` });
  const p = await src.preflight(now);
  const primary = { ...primaryBase, lastReading: p.last ? { ...p.last, result: null } : null };
  const crossRead = { id: cross.id, operator: cross.operator, lastReading: p.crossLast ? { ...p.crossLast, result: null } : null, error: null };
  const part = { primary, crossRead, nextExpectedAt: p.nextAt, nextExpectedBasis: p.nextBasis, agreement: p.agreement, agreementBasis: p.basis || "n/a" };
  if (p.problem) return result(rule, now, part, { code: p.problem.code, reason: p.problem.reason, status: p.problem.code === "disagreement" ? 400 : 502 });
  return result(rule, now, part, null);
}

async function preflightPolymarket(rule: BurnRule, deps: PreflightDeps, now: number): Promise<PreflightResult> {
  const pm = deps.polymarket;
  const id = selectorOf(rule);
  const primaryBase = { id: `polymarket:${id}`, operator: "Polymarket (Conditional Tokens on Polygon)", lastReading: null, error: null };
  const gammaBase = { id: "polymarket.gamma", operator: "Polymarket (Gamma API)", lastReading: null, error: null };
  if (!pm) return result(rule, now, { primary: primaryBase }, { code: "primary-unreadable", reason: "no Polymarket client on this host", status: 502 });
  if (rule.market) {
    let m: GammaMarket | null;
    try { m = await pm.marketByCondition(rule.market); } catch (e) { return result(rule, now, { primary: primaryBase, crossRead: { ...gammaBase, error: (e as Error).message.slice(0, 160) } }, { code: "cross-read-unreadable", reason: `Gamma did not answer for ${rule.market}: ${(e as Error).message.slice(0, 120)}`, status: 502 }); }
    if (!m) return result(rule, now, { primary: primaryBase }, { code: "unknown-selector", reason: `Polymarket does not know the market ${rule.market}` });
    let chain;
    try { chain = await pm.readChain(rule.market); } catch (e) { return result(rule, now, { primary: { ...primaryBase, error: (e as Error).message.slice(0, 160) } }, { code: "primary-unreadable", reason: `the payout vector of ${rule.market} could not be read on Polygon: ${(e as Error).message.slice(0, 120)}`, status: 502 }); }
    const cr = chainResult(chain), gr = gammaResult(m);
    const at = settledAtOf(m) ?? new Date(now).toISOString();
    const primary = { ...primaryBase, lastReading: cr ? { id: rule.market, value: null, result: cr, at } : null };
    const crossRead = { ...gammaBase, lastReading: gr ? { id: rule.market, value: null, result: gr, at } : null };
    if (!cr) return result(rule, now, { primary, crossRead, nextExpectedAt: m.endDate, nextExpectedBasis: "the market's end date (Gamma); the reading is the payout vector once it is on chain", agreementBasis: "not resolved on chain yet" }, null);
    const agree = gr ? gr === cr : null;
    if (agree === false) return result(rule, now, { primary, crossRead, agreement: false, agreementBasis: `chain ${cr} vs Gamma ${gr}` }, { code: "disagreement", reason: `the payout vector (${cr}) and Gamma's report (${gr}) disagree on ${rule.market}` });
    return result(rule, now, { primary, crossRead, nextExpectedAt: null, nextExpectedBasis: "a one-shot market: resolved, nothing further", agreement: agree, agreementBasis: gr ? `chain ${cr} = Gamma ${gr}` : "Gamma does not report it resolved yet" }, null);
  }
  const since = new Date((pm.clock?.() ?? now) - 30 * 86_400_000).toISOString();
  let chainRead, gammaRead;
  try { chainRead = await pm.settledSince(rule, since, { limitPages: 2 }); } catch (e) { return result(rule, now, { primary: { ...primaryBase, error: (e as Error).message.slice(0, 160) } }, { code: "primary-unreadable", reason: `the selector's settled markets could not be read on Polygon: ${(e as Error).message.slice(0, 120)}`, status: 502 }); }
  try { gammaRead = await pm.gammaSettled(rule, since, 2); } catch (e) { return result(rule, now, { primary: primaryBase, crossRead: { ...gammaBase, error: (e as Error).message.slice(0, 160) } }, { code: "cross-read-unreadable", reason: `Gamma did not answer for ${id}: ${(e as Error).message.slice(0, 120)}`, status: 502 }); }
  const last = chainRead.events[chainRead.events.length - 1] ?? null;
  const g = last ? gammaRead.events.find((e) => e.id === last.id) ?? null : null;
  let nextAt: string | null = null;
  try { const open = await pm.candidates(rule, { closed: false, pages: 1 }); nextAt = open.markets.map((m) => m.endDate).filter((x): x is string => !!x && Date.parse(x) > now).sort()[0] ?? null; } catch { /* the next date is informative only */ }
  const primary = { ...primaryBase, lastReading: reading(last) };
  const crossRead = { ...gammaBase, lastReading: reading(g) };
  const nb = nextAt ? "the earliest end date among the selector's open markets (Gamma)" : "no open market found for this selector";
  if (!last) return result(rule, now, { primary, crossRead, nextExpectedAt: nextAt, nextExpectedBasis: nb, agreementBasis: "no market of this selector settled on chain in the last 30 days" }, null);
  const agree = g ? g.result === last.result : null;
  if (agree === false) return result(rule, now, { primary, crossRead, nextExpectedAt: nextAt, nextExpectedBasis: nb, agreement: false, agreementBasis: `${last.id}: chain ${last.result} vs Gamma ${g!.result}` }, { code: "disagreement", reason: `the payout vector and Gamma's report disagree on ${last.id} (${last.result} vs ${g!.result})` });
  return result(rule, now, { primary, crossRead, nextExpectedAt: nextAt, nextExpectedBasis: nb, agreement: agree, agreementBasis: g ? `${last.id}: chain ${last.result} = Gamma ${g.result}` : `${last.id}: Gamma does not report it resolved` }, null);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// BURN DERBY (2026-10-10): the coin's value from its primary (Pyth on Solana — keyless —, Hermes with a key, or the pool TWAP) and the
// independent cross-read (Jupiter / DexScreener / RedStone), read in the same minute; agreement within the derby bound (2%).
// ---------------------------------------------------------------------------------------------------------------------------------

/** What the derby preflight reads with (the platform passes its mainnet read port, its cross-read fetch, and Hermes when keyed). */
export interface DerbyPreflightDeps { pools?: PoolPort | null; fetchImpl?: FetchLike; hermes?: { latest(feed: string): Promise<PythRead> } | null }

const DERBY_OPERATOR: Record<string, string> = { jup: "Jupiter", dexscreener: "DexScreener", redstone: "RedStone" };
const CROSS_ID: Record<string, string> = { jup: "jupiter.quote", dexscreener: "dexscreener.pairs", redstone: "redstone" };

async function derbyPrimary(u: DerbyUnderlying, d: DerbyPreflightDeps, now: number): Promise<{ id: string; operator: string; value: string; at: string } | { refusal: { code: PreflightCode; reason: string; status?: 400 | 502 }; id: string; operator: string }> {
  if (u.pyth) {
    const id = `pyth:${u.pyth.slice(0, 12)}`, operator = "Pyth Data Association";
    const hours = marketHours(u.pyth);
    let value: string | null = null, publish = 0, why = "";
    if (d.pools) {
      try {
        const address = pythFeedAccount(u.pyth);
        const [acct] = await d.pools.accounts([address]);
        if (acct) { const s = pythSnapshotFromAccount(u.pyth, acct, null, address); value = s.value; publish = s.publishTime; }
        else why = `no sponsored Pyth account on Solana for ${u.symbol} (${address})`;
      } catch (e) { why = (e as Error).message.slice(0, 140); }
    } else why = "no Solana read port on this host";
    if (value === null && d.hermes) {
      try { const r = await d.hermes.latest(u.pyth); if (r.ok) { value = r.point.value; publish = r.point.publishTime; } else why = `${why}; Hermes: ${r.reason}`; } catch (e) { why = `${why}; Hermes: ${(e as Error).message.slice(0, 120)}`; }
    }
    if (value === null) return { id, operator, refusal: { code: "primary-unreadable", reason: `${u.symbol}: Pyth could not be read just now (${why || "no route"}; Hermes needs BURNTICKER_PYTH_API_KEY)`, status: 502 } };
    const age = now / 1000 - publish;
    if (age > (hours ? 4 * 86_400 : 2 * 3600)) return { id, operator, refusal: { code: "stale-primary", reason: `${u.symbol}: Pyth's latest value was published ${Math.round(age / 3600)} h ago`, status: 502 } };
    return { id, operator, value, at: new Date(publish * 1000).toISOString() };
  }
  const id = `raydium.twap:${u.pool}`, operator = "Raydium pool (on-chain)";
  if (!d.pools || !u.pool || !u.mint) return { id, operator, refusal: { code: "primary-unreadable", reason: `${u.symbol}: the pool TWAP needs a Solana read port and the coin's pool and mint`, status: 502 } };
  try {
    const s = await samplePool(d.pools, u.pool, u.mint);
    const [solAcct] = await d.pools.accounts([pythFeedAccount(PYTH_SOL_USD)]);
    if (!solAcct) return { id, operator, refusal: { code: "primary-unreadable", reason: "Pyth SOL/USD could not be read on Solana", status: 502 } };
    const sol = pythSnapshotFromAccount(PYTH_SOL_USD, solAcct, null, pythFeedAccount(PYTH_SOL_USD));
    return { id, operator, value: truncDec(mulDec(s.priceSol, sol.value), 18), at: new Date(now).toISOString() };
  } catch (e) { return { id, operator, refusal: { code: "primary-unreadable", reason: `${u.symbol}: pool ${u.pool} could not be read: ${(e as Error).message.slice(0, 120)}`, status: 502 } }; }
}

async function preflightDerby(rule: BurnRule, deps: PreflightDeps, now: number): Promise<PreflightResult> {
  const spec = rule.derby;
  const sel = rule.series ?? "derby";
  const none = { id: sel, operator: null, lastReading: null, error: null };
  if (!spec) return result(rule, now, { primary: none }, { code: "unknown-selector", reason: "a derby rule needs its derby block" });
  const d = deps.derby ?? {};
  const fetchImpl = d.fetchImpl ?? deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const us = spec.selector === "coinvs" ? [spec.a, spec.b] : spec.selector === "price" ? [spec.u] : [spec.underlying];
  const basis: string[] = [];
  let first: { primary: PreflightResult["primary"]; crossRead: PreflightResult["crossRead"] } | null = null;
  for (const u of us) {
    const pr = await derbyPrimary(u, d, now);
    const kind = u.cross.split(":")[0];
    const crossBase = { id: `${CROSS_ID[kind] ?? kind}:${u.cross.slice(kind.length + 1)}`, operator: DERBY_OPERATOR[kind] ?? null, lastReading: null, error: null };
    if ("refusal" in pr) return result(rule, now, { primary: { id: pr.id, operator: pr.operator, lastReading: null, error: pr.refusal.reason }, crossRead: crossBase }, pr.refusal);
    const primary = { id: pr.id, operator: pr.operator, lastReading: { id: u.symbol, value: pr.value, result: null, at: pr.at }, error: null };
    let q;
    try { q = await crossQuote(fetchImpl, u.cross); } catch (e) { return result(rule, now, { primary, crossRead: { ...crossBase, error: (e as Error).message.slice(0, 160) } }, { code: "cross-read-unreadable", reason: `${u.symbol}: the cross-read ${u.cross} could not be read just now: ${(e as Error).message.slice(0, 120)}`, status: 502 }); }
    if (!q) return result(rule, now, { primary, crossRead: crossBase }, { code: "no-cross-read", reason: `${u.symbol}: the cross-read ${u.cross} does not carry this asset, so it cannot settle a coin on Pyth's reading alone` });
    const crossRead = { ...crossBase, lastReading: { id: u.symbol, value: q.usd, result: null, at: new Date(now).toISOString() } };
    const diff = Math.abs(Number(pr.value) - Number(q.usd)) / Math.max(Number(pr.value), Number(q.usd));
    const line = `${u.symbol}: ${pr.id} ${pr.value} vs ${crossBase.id} ${q.usd} (${(diff * 100).toFixed(2)}% apart; bound ${DERBY_DISAGREEMENT_PP}%)`;
    basis.push(line);
    if (diff * 100 > DERBY_DISAGREEMENT_PP) return result(rule, now, { primary, crossRead, agreement: false, agreementBasis: basis.join(" · ") }, { code: "disagreement", reason: `the primary and its cross-read disagree: ${line}` });
    first ??= { primary, crossRead };
  }
  const next = new Date(Math.floor(now / 86_400_000) * 86_400_000 + 86_400_000).toISOString();
  return result(rule, now, { primary: first!.primary, crossRead: first!.crossRead, nextExpectedAt: next, nextExpectedBasis: "the next 00:00 UTC window boundary", agreement: true, agreementBasis: basis.join(" · ") }, null);
}
