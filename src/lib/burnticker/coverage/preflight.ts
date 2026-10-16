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
import { DERBY_DISAGREEMENT_PP, flipAlreadyAheadSentence } from "@/lib/burnticker/derby/spec";
import { atHighOnLaunch } from "@/lib/burnticker/derby/high";
import { PYTH_SOL_USD, pythFeedAccount, pythSnapshotFromAccount, type PythRead } from "@/lib/burnticker/derby/pyth";
import { crossQuote, REDSTONE_LATEST_URL } from "@/lib/burnticker/derby/cross";
import { redstonePrimary } from "@/lib/burnticker/derby/redstone";
import { readSupply, samplePool, type PoolPort } from "@/lib/burnticker/derby/pools";
import { cmpDec, mulDec, truncDec } from "@/lib/burnticker/derby/measure";
import { marketHours } from "@/lib/burnticker/derby/adapter";
import { nativeSourceById } from "@/lib/burnticker/sources/native";
import { isOneTimeSeries, oneShotEligibility } from "@/lib/burnticker/oneShotEligibility";
import { NEXT_EVENT_ONE_SHOT_RE } from "@/lib/burnticker/inverse";
import { isSingleOfficialSource, singleSourceMethod } from "@/lib/burnticker/singleSource";
import { sourceForUrl, takeOrThrow } from "@/lib/burnticker/apiBudget";
import { safeErrorText } from "@/lib/burnticker/api/errorText";

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
  if (rule.oracle === "kalshi") return result(rule, now, { primary: { ...none, operator: "Kalshi" } }, { code: "kalshi-not-settlement", reason: "Kalshi cannot settle a coin. Its Developer Agreement and Data Terms forbid using its API or data to settle products. Use a primary source with an independent second source, or a Polymarket market." });
  if (rule.oracle === "catalogue" && rule.series && nativeSourceById(rule.series)) return preflightNative(rule, deps, now);
  if (rule.oracle === "catalogue") return preflightCatalogue(rule, deps, now);
  if (rule.oracle === "polymarket") return preflightPolymarket(rule, deps, now);
  if (rule.oracle === "derby") return preflightDerby(rule, deps, now);
  return result(rule, now, { primary: none }, { code: "stub-oracle", reason: `The ${rule.oracle} source is only a placeholder, so nothing can be read from it.` });
}

async function preflightCatalogue(rule: BurnRule, deps: PreflightDeps, now: number): Promise<PreflightResult> {
  const feed = rule.series ? feedById(rule.series, {}, deps.root) : null;
  if (!feed) return result(rule, now, { primary: { id: rule.series ?? "?", operator: null, lastReading: null, error: null } }, { code: "unknown-selector", reason: `There is no catalogue source called ${rule.series}.` });
  const all = deps.sources ?? loadSourceEntries(deps.root).map(describeEntry);
  const base = feed.config.id.split(":")[0];
  const desc = all.find((s) => s.id === base) ?? describeEntry({ ...feed.config, id: base });
  const primaryBase = { id: feed.id, operator: desc.operator, lastReading: null, error: null };
  const elig = primaryEligibility(desc);
  if (!elig.ok) return result(rule, now, { primary: primaryBase }, { code: "not-primary", reason: `${feed.id} cannot settle a coin. The reason is: ${elig.why}.` });
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  let pr: { readings: SettledEvent[]; refusals: string[] };
  let body: unknown;
  try { body = await fetchBody(feed.config, now, fetchImpl); pr = parseBody(feed.config, body, now); } catch (e) { return result(rule, now, { primary: { ...primaryBase, error: safeErrorText(e, 200) } }, { code: "primary-unreadable", reason: `${feed.id} could not be read just now. The error was: ${safeErrorText(e, 160)}`, status: 502 }); }
  const last = pr.readings[pr.readings.length - 1] ?? null;
  const next = nextExpected(feed.config, last?.id ?? null, now);
  const primary = { ...primaryBase, lastReading: reading(last), error: pr.refusals.length ? pr.refusals.slice(0, 2).join("; ") : null };
  // intent audit 2 item 2: a one-time event whose result is already known is refused (oneShotEligibility.ts); one still to come has
  // no reading yet by design, so "no reading" is not a refusal for it
  const once = oneShotEligibility(feed.id, feed.config, body, now);
  if (once.decided) return result(rule, now, { primary }, { code: "already-decided", reason: once.reason! });
  const oneTime = isOneTimeSeries(feed.id);
  if (!last && !oneTime) return result(rule, now, { primary, nextExpectedAt: next.at, nextExpectedBasis: next.basis }, { code: "no-readings", reason: `${feed.id} returned no complete reading.${pr.refusals.length ? ` The parser said: ${pr.refusals[0]}` : ""}`, status: 502 });
  // A read that parses but stops short (a plausibility refusal, a frozen endpoint) leaves an old last reading: the schedule says a newer
  // one was due more than STALE_GRACE_MS ago → refused, with the parser's refusal as the reason (FRED's full-history CSV, 10-10).
  // sources-3: a next-event one-shot reads only on its events, so an old last reading is not a stale feed
  if (last && next.at && !NEXT_EVENT_ONE_SHOT_RE.test(feed.id) && Date.parse(next.at) + STALE_GRACE_MS < now) return result(rule, now, { primary, nextExpectedAt: next.at, nextExpectedBasis: next.basis }, { code: "stale-primary", reason: `${feed.id}'s latest complete reading is ${last.id}, but the next one was due on ${next.at.slice(0, 10)}.${pr.refusals.length ? ` The parser said: ${pr.refusals[0]}` : ""}`, status: 502 });
  // the owner's single-publisher exception (singleSource.ts, 2026-10-12): the natural-disaster feeds settle on their own publisher
  if (isSingleOfficialSource(feed.config)) return result(rule, now, { primary, nextExpectedAt: next.at, nextExpectedBasis: next.basis, agreementBasis: singleSourceMethod(feed.config.id) }, null);
  const crosses = crossReadsOf(desc, all);
  if (!crosses.length) return result(rule, now, { primary, nextExpectedAt: next.at, nextExpectedBasis: next.basis }, { code: "no-cross-read", reason: `${feed.id} has no independent second source for the same fact, run by another operator on another domain. So it cannot settle a coin on its own reading.` });
  const feeds = catalogue(deps.root);
  let lastErr: string | null = null;
  for (const c of crosses) {
    const cf = feeds.find((f) => f.config.id === c.id);
    if (!cf) continue;
    let cr: { readings: SettledEvent[]; refusals: string[] };
    const t0 = Date.now();
    try { cr = await readLive(cf, now, fetchImpl); } catch (e) { lastErr = `${c.id}: ${safeErrorText(e, 160)}`; continue; }
    const cmp = compareFact(feed.config.fact!, pr.readings, cf.config.fact!, cr.readings, { primaryReadAt: now, crossReadAt: now + (Date.now() - t0) });
    const latest = cmp.comparisons[cmp.comparisons.length - 1] ?? null;
    const crossRead = { id: c.id, operator: c.operator, lastReading: reading(cr.readings[cr.readings.length - 1]), error: null };
    const agreementBasis = latest ? `${latest.period}: ${feed.id} ${latest.primary} vs ${c.id} ${latest.crossRead} (${cmp.basis})` : `no period both reads cover yet (${cmp.basis}); compared at the next shared period`;
    if (latest && !latest.agree) return result(rule, now, { primary, crossRead, nextExpectedAt: next.at, nextExpectedBasis: next.basis, agreement: false, agreementBasis }, { code: "disagreement", reason: `The primary source and its second source disagree on ${latest.period}. ${feed.id} says ${latest.primary}, and ${c.id} says ${latest.crossRead}.` });
    return result(rule, now, { primary, crossRead, nextExpectedAt: next.at, nextExpectedBasis: next.basis, agreement: latest ? true : null, agreementBasis }, null);
  }
  return result(rule, now, { primary, crossRead: { id: crosses[0].id, operator: crosses[0].operator, lastReading: null, error: lastErr }, nextExpectedAt: next.at, nextExpectedBasis: next.basis }, { code: "cross-read-unreadable", reason: `No second source for ${feed.id} could be read just now. The error was: ${lastErr ?? "no saved sample or setup"}`, status: 502 });
}

/**
 * NATIVE first-party sources (sources/native.ts — the sports results with their league cross-reads, the NWS climate report with the Iowa
 * Environmental Mesonet): the family's descriptor in sources.json must be a primary, the source's own cross-read must be an independent
 * cross-read of the same fact under the same gate (another operator on another domain), and the live check must find the latest
 * reading confirmed. Same refusal codes as the feeds.
 */
async function preflightNative(rule: BurnRule, deps: PreflightDeps, now: number): Promise<PreflightResult> {
  const src = nativeSourceById(rule.series!)!;
  const all = deps.sources ?? loadSourceEntries(deps.root).map(describeEntry);
  const desc = all.find((s) => s.id === src.descriptorId);
  const primaryBase = { id: src.id, operator: desc?.operator ?? null, lastReading: null, error: null };
  if (!desc) return result(rule, now, { primary: primaryBase }, { code: "unknown-selector", reason: `The source list has no entry ${src.descriptorId} for ${src.id}.` });
  const elig = primaryEligibility(desc);
  if (!elig.ok) return result(rule, now, { primary: primaryBase }, { code: "not-primary", reason: `${src.id} cannot settle a coin. The reason is: ${elig.why}.` });
  const cross = crossReadsOf(desc, all).find((c) => c.id === src.crossReadId) ?? null;
  if (!cross) return result(rule, now, { primary: primaryBase }, { code: "no-cross-read", reason: `${src.crossReadId ? `${src.id}'s second source, ${src.crossReadId},` : `${src.id} has no second source, so it`} is not an independent read of the same fact by another operator on another domain.` });
  const p = await src.preflight(now);
  const primary = { ...primaryBase, lastReading: p.last ? { ...p.last, result: null } : null };
  const crossRead = { id: cross.id, operator: cross.operator, lastReading: p.crossLast ? { ...p.crossLast, result: null } : null, error: null };
  const part = { primary, crossRead, nextExpectedAt: p.nextAt, nextExpectedBasis: p.nextBasis, agreement: p.agreement, agreementBasis: p.basis || "n/a" };
  if (p.problem) return result(rule, now, part, { code: p.problem.code, reason: p.problem.reason, status: p.problem.code === "disagreement" || p.problem.code === "already-decided" ? 400 : 502 });
  return result(rule, now, part, null);
}

async function preflightPolymarket(rule: BurnRule, deps: PreflightDeps, now: number): Promise<PreflightResult> {
  const pm = deps.polymarket;
  const id = selectorOf(rule);
  const primaryBase = { id: `polymarket:${id}`, operator: "Polymarket (Conditional Tokens on Polygon)", lastReading: null, error: null };
  const gammaBase = { id: "polymarket.gamma", operator: "Polymarket (Gamma API)", lastReading: null, error: null };
  if (!pm) return result(rule, now, { primary: primaryBase }, { code: "primary-unreadable", reason: "This site has no connection to Polymarket.", status: 502 });
  if (rule.market) {
    let m: GammaMarket | null;
    try { m = await pm.marketByCondition(rule.market); } catch (e) { return result(rule, now, { primary: primaryBase, crossRead: { ...gammaBase, error: safeErrorText(e, 160) } }, { code: "cross-read-unreadable", reason: `Gamma did not answer for ${rule.market}. The error was: ${safeErrorText(e, 120)}`, status: 502 }); }
    if (!m) return result(rule, now, { primary: primaryBase }, { code: "unknown-selector", reason: `Polymarket does not know the market ${rule.market}.` });
    let chain;
    try { chain = await pm.readChain(rule.market); } catch (e) { return result(rule, now, { primary: { ...primaryBase, error: safeErrorText(e, 160) } }, { code: "primary-unreadable", reason: `The on-chain payout for ${rule.market} could not be read on Polygon. The error was: ${safeErrorText(e, 120)}`, status: 502 }); }
    const cr = chainResult(chain), gr = gammaResult(m);
    const at = settledAtOf(m) ?? new Date(now).toISOString();
    const primary = { ...primaryBase, lastReading: cr ? { id: rule.market, value: null, result: cr, at } : null };
    const crossRead = { ...gammaBase, lastReading: gr ? { id: rule.market, value: null, result: gr, at } : null };
    if (!cr) return result(rule, now, { primary, crossRead, nextExpectedAt: m.endDate, nextExpectedBasis: "the market's end date (Gamma); the reading is the payout vector once it is on chain", agreementBasis: "not resolved on chain yet" }, null);
    const agree = gr ? gr === cr : null;
    if (agree === false) return result(rule, now, { primary, crossRead, agreement: false, agreementBasis: `chain ${cr} vs Gamma ${gr}` }, { code: "disagreement", reason: `The on-chain payout and Gamma's report disagree on ${rule.market}. The chain says ${cr}, and Gamma says ${gr}.` });
    return result(rule, now, { primary, crossRead, nextExpectedAt: null, nextExpectedBasis: "a one-shot market: resolved, nothing further", agreement: agree, agreementBasis: gr ? `chain ${cr} = Gamma ${gr}` : "Gamma does not report it resolved yet" }, null);
  }
  const since = new Date((pm.clock?.() ?? now) - 30 * 86_400_000).toISOString();
  let chainRead, gammaRead;
  try { chainRead = await pm.settledSince(rule, since, { limitPages: 2 }); } catch (e) { return result(rule, now, { primary: { ...primaryBase, error: safeErrorText(e, 160) } }, { code: "primary-unreadable", reason: `This rule's settled markets could not be read on Polygon. The error was: ${safeErrorText(e, 120)}`, status: 502 }); }
  try { gammaRead = await pm.gammaSettled(rule, since, 2); } catch (e) { return result(rule, now, { primary: primaryBase, crossRead: { ...gammaBase, error: safeErrorText(e, 160) } }, { code: "cross-read-unreadable", reason: `Gamma did not answer for ${id}. The error was: ${safeErrorText(e, 120)}`, status: 502 }); }
  const last = chainRead.events[chainRead.events.length - 1] ?? null;
  const g = last ? gammaRead.events.find((e) => e.id === last.id) ?? null : null;
  let nextAt: string | null = null;
  try { const open = await pm.candidates(rule, { closed: false, pages: 1 }); nextAt = open.markets.map((m) => m.endDate).filter((x): x is string => !!x && Date.parse(x) > now).sort()[0] ?? null; } catch { /* the next date is informative only */ }
  const primary = { ...primaryBase, lastReading: reading(last) };
  const crossRead = { ...gammaBase, lastReading: reading(g) };
  const nb = nextAt ? "the earliest end date among the selector's open markets (Gamma)" : "no open market found for this selector";
  if (!last) return result(rule, now, { primary, crossRead, nextExpectedAt: nextAt, nextExpectedBasis: nb, agreementBasis: "no market of this selector settled on chain in the last 30 days" }, null);
  const agree = g ? g.result === last.result : null;
  if (agree === false) return result(rule, now, { primary, crossRead, nextExpectedAt: nextAt, nextExpectedBasis: nb, agreement: false, agreementBasis: `${last.id}: chain ${last.result} vs Gamma ${g!.result}` }, { code: "disagreement", reason: `The on-chain payout and Gamma's report disagree on ${last.id}. The chain says ${last.result}, and Gamma says ${g!.result}.` });
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

/**
 * One coin's primary value now, in the order of preference: Pyth's sponsored Solana account (keyless) → Pyth Hermes (with a key) → the
 * Raydium / PumpSwap pool TWAP (spot × Pyth SOL/USD) → RedStone's verified signed packages (when the coin names a RedStone feed).
 */
async function derbyPrimary(u: DerbyUnderlying, d: DerbyPreflightDeps, now: number, fetchImpl: FetchLike): Promise<{ id: string; operator: string; value: string; at: string; route: string } | { refusal: { code: PreflightCode; reason: string; status?: 400 | 502 }; id: string; operator: string }> {
  const why: string[] = [];
  if (u.pyth) {
    const id = `pyth:${u.pyth.slice(0, 12)}`, operator = "Pyth Data Association";
    const hours = marketHours(u.pyth);
    let value: string | null = null, publish = 0, route = "";
    if (d.pools) {
      try {
        const address = pythFeedAccount(u.pyth);
        const [acct] = await d.pools.accounts([address]);
        if (acct) { const s = pythSnapshotFromAccount(u.pyth, acct, null, address); value = s.value; publish = s.publishTime; route = "pyth-solana"; }
        else why.push(`no sponsored Pyth account on Solana for ${u.symbol}`);
      } catch (e) { why.push(safeErrorText(e, 140)); }
    } else why.push("no Solana read port on this host");
    if (value === null && d.hermes) {
      try { const r = await d.hermes.latest(u.pyth); if (r.ok) { value = r.point.value; publish = r.point.publishTime; route = "pyth-hermes"; } else why.push(`Hermes: ${r.reason}`); } catch (e) { why.push(`Hermes: ${safeErrorText(e, 120)}`); }
    } else if (value === null) why.push("no Hermes key on this host (BURNTICKER_PYTH_API_KEY)");
    if (value !== null) {
      const age = now / 1000 - publish;
      if (age > (hours ? 4 * 86_400 : 2 * 3600)) return { id, operator, refusal: { code: "stale-primary", reason: `Pyth's latest value for ${u.symbol} was published ${Math.round(age / 3600)} hours ago.`, status: 502 } };
      return { id, operator, value, at: new Date(publish * 1000).toISOString(), route };
    }
  }
  if (u.pool && u.mint && d.pools) {
    try {
      const s = await samplePool(d.pools, u.pool, u.mint);
      const [solAcct] = await d.pools.accounts([pythFeedAccount(PYTH_SOL_USD)]);
      if (!solAcct) why.push("Pyth SOL/USD could not be read on Solana");
      else {
        const sol = pythSnapshotFromAccount(PYTH_SOL_USD, solAcct, null, pythFeedAccount(PYTH_SOL_USD));
        return { id: `raydium.twap:${u.pool}`, operator: "Raydium pool (on-chain)", value: truncDec(mulDec(s.priceSol, sol.value), 18), at: new Date(now).toISOString(), route: "pool-twap" };
      }
    } catch (e) { why.push(`pool ${u.pool} could not be read: ${safeErrorText(e, 120)}`); }
  } else if (u.pool) why.push("the pool TWAP needs a Solana read port and the coin's mint");
  if (u.redstone) {
    try {
      await takeOrThrow(sourceForUrl(REDSTONE_LATEST_URL));   // the request budget (apiBudget.ts)
      const res = await fetchImpl(REDSTONE_LATEST_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = await redstonePrimary(await res.json(), u.redstone, REDSTONE_LATEST_URL);
      if (r.ok) {
        if (now - r.timestampMs > 2 * 3600_000) return { id: `redstone:${u.redstone}`, operator: "RedStone", refusal: { code: "stale-primary", reason: `RedStone's latest data for ${u.symbol} is ${Math.round((now - r.timestampMs) / 3600_000)} hours old.`, status: 502 } };
        return { id: `redstone:${u.redstone}`, operator: "RedStone", value: r.value, at: new Date(r.timestampMs).toISOString(), route: "redstone" };
      }
      why.push(r.reason);
    } catch (e) { why.push(`RedStone: ${safeErrorText(e, 120)}`); }
  }
  const id = u.pyth ? `pyth:${u.pyth.slice(0, 12)}` : u.pool ? `raydium.twap:${u.pool}` : `redstone:${u.redstone}`;
  const operator = u.pyth ? "Pyth Data Association" : u.pool ? "Raydium pool (on-chain)" : "RedStone";
  return { id, operator, refusal: { code: "primary-unreadable", reason: `No primary source for ${u.symbol} could be read just now. ${why.length ? `The reasons were: ${why.join("; ")}.` : "There is no way to read it."}`, status: 502 } };
}

async function preflightDerby(rule: BurnRule, deps: PreflightDeps, now: number): Promise<PreflightResult> {
  const spec = rule.derby;
  const sel = rule.series ?? "derby";
  const none = { id: sel, operator: null, lastReading: null, error: null };
  if (!spec) return result(rule, now, { primary: none }, { code: "unknown-selector", reason: "A derby rule must include its derby settings." });
  const d = deps.derby ?? {};
  const fetchImpl = d.fetchImpl ?? deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const us = spec.selector === "coinvs" ? [spec.a, spec.b] : spec.selector === "price" || spec.selector === "high" ? [spec.u] : [spec.underlying];
  // sources-4: a record-close coin whose reference is already at its record is refused (never a day-one burn)
  if (spec.selector === "high") { const at = atHighOnLaunch(spec.baseline); if (at) return result(rule, now, { primary: none }, { code: "already-decided", reason: at }); }
  const basis: string[] = [];
  let first: { primary: PreflightResult["primary"]; crossRead: PreflightResult["crossRead"] } | null = null;
  const values: string[] = [];
  for (const u of us) {
    const pr = await derbyPrimary(u, d, now, fetchImpl);
    const kind = u.cross.split(":")[0];
    const crossBase = { id: `${CROSS_ID[kind] ?? kind}:${u.cross.slice(kind.length + 1)}`, operator: DERBY_OPERATOR[kind] ?? null, lastReading: null, error: null };
    if ("refusal" in pr) return result(rule, now, { primary: { id: pr.id, operator: pr.operator, lastReading: null, error: pr.refusal.reason }, crossRead: crossBase }, pr.refusal);
    const primary = { id: pr.id, operator: pr.operator, lastReading: { id: u.symbol, value: pr.value, result: null, at: pr.at }, error: null };
    let q;
    try { q = await crossQuote(fetchImpl, u.cross); } catch (e) { return result(rule, now, { primary, crossRead: { ...crossBase, error: safeErrorText(e, 160) } }, { code: "cross-read-unreadable", reason: `The second source for ${u.symbol}, ${u.cross}, could not be read just now. The error was: ${safeErrorText(e, 120)}`, status: 502 }); }
    if (!q) return result(rule, now, { primary, crossRead: crossBase }, { code: "no-cross-read", reason: `The second source for ${u.symbol}, ${u.cross}, does not carry this asset. So a coin cannot settle on Pyth's reading alone.` });
    const crossRead = { ...crossBase, lastReading: { id: u.symbol, value: q.usd, result: null, at: new Date(now).toISOString() } };
    const diff = Math.abs(Number(pr.value) - Number(q.usd)) / Math.max(Number(pr.value), Number(q.usd));
    const line = `For ${u.symbol}, ${pr.id} says ${pr.value} and ${crossBase.id} says ${q.usd}. They are ${(diff * 100).toFixed(2)}% apart, and the limit is ${DERBY_DISAGREEMENT_PP}%.`;
    basis.push(line);
    if (diff * 100 > DERBY_DISAGREEMENT_PP) return result(rule, now, { primary, crossRead, agreement: false, agreementBasis: basis.join(" ") }, { code: "disagreement", reason: `The primary source and its second source disagree. ${line}` });
    first ??= { primary, crossRead };
    values.push(pr.value);
  }
  // item 66 (owner decision 2026-10-12): a flippening whose first coin is already the larger one has nothing to flip: refused here
  if (spec.selector === "coinvs" && spec.flip) {
    const sizes: string[] = [];
    for (const [i, u] of [spec.a, spec.b].entries()) {
      let supply: string | null = null, why = "no Solana read port on this host";
      if (d.pools && u.mint) { try { supply = (await readSupply(d.pools, u.mint)).supply; } catch (e) { why = safeErrorText(e, 120); } }
      if (supply === null) return result(rule, now, { primary: first!.primary, crossRead: first!.crossRead, agreement: true, agreementBasis: basis.join(" ") }, { code: "primary-unreadable", reason: `The circulating supply of ${u.symbol} could not be read just now, so it cannot be checked that ${spec.a.symbol} is still the smaller coin. The reason was: ${why}.`, status: 502 });
      sizes.push(mulDec(values[i], supply));
    }
    if (cmpDec(sizes[0], sizes[1]) > 0) return result(rule, now, { primary: first!.primary, crossRead: first!.crossRead, agreement: true, agreementBasis: basis.join(" ") }, { code: "already-decided", reason: flipAlreadyAheadSentence(spec.a.symbol, spec.b.symbol), status: 400 });
  }
  const next = new Date(Math.floor(now / 86_400_000) * 86_400_000 + 86_400_000).toISOString();
  return result(rule, now, { primary: first!.primary, crossRead: first!.crossRead, nextExpectedAt: next, nextExpectedBasis: "the next 00:00 UTC window boundary", agreement: true, agreementBasis: basis.join(" ") }, null);
}
