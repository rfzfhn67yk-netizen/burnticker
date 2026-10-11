import { buybackSpend } from "@/lib/burnKeeper/rules";
import { POLY_MARKET_RE, rulesFromText, type BurnMapping, type BurnRule } from "@/lib/burnticker/rules";
import { parseReceiptMemo } from "@/lib/burnticker/receipt";
import { parseBuybackMemo as parseProgramBuybackMemo, parseDebtMemo as parseProgramVaultMemo } from "@/lib/burnReceipts/memo";
import { buybackSpend as programBuybackSpend } from "@/lib/burnReceipts/math";
import { unitStep, type CarryPolicy, type SettledEvent } from "@/lib/burnticker/units";
import { KALSHI_API, marketApiUrl, parseMarketsBody, resolveSelector } from "@/lib/burnticker/oracle/kalshi";
import { expandUrl, parseBody, type HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { parseMarketsBody as parseGammaMarkets, resolvePolymarket, settledMarketUrl } from "@/lib/burnticker/oracle/polymarket";
import { readConditionResolution, type ConditionResolution, type FetchLike as RpcFetchLike } from "@/lib/burnKeeper/attesters/polymarketOnchain";

/**
 * VERIFY ONE RECEIPT (2026-10-09; shared by the public API's /verify route and the SDK's verifyReceipt). A receipt is checked from
 * three independent places, each a separate, named check so a stranger sees exactly what passed:
 *
 *   rules    the published rules.json re-locks to itself (canonical bytes) and its sha256 is the one the memo cites;
 *   memo     the on-chain memo (v3) parses and says the same event, units, result and value as the receipt — or, for a receipt executed
 *            by the burn_receipts program (2026-10-10), the PROGRAM's memo (v2 buyback / v1 vault) for the reading the receipt was counted
 *            into: the token's prefix, the reading date, a unit count that includes this receipt's, counter now − prev = units;
 *   source   the settled result/value re-read from the ORIGINAL source (Kalshi's public API, the Polymarket market's payout vector on
 *            Polygon, or the feed's exact source URL) equals the receipt's — fetched by the verifier, never taken from us;
 *   units    the rule applied to that settled result (and the previous value / carried remainder the receipt states) gives the units;
 *   spend    buyback: spend = pool × (1 − (1 − f)^units), the keeper's exact integer formula, equals the memo's spent; burn ≥ got;
 *   chain    the transaction at the receipt's signature exists, succeeded, and wrote exactly this memo.
 *
 * A check is ok: true (passed), false (failed — the receipt is wrong), or null (not checkable here: no RPC given, a void market with no
 * transaction, the source no longer serves that period). `verified` = nothing failed AND units/rules passed. Pure apart from the two
 * fetchers below, which take an injected fetch so a test (or a bot) controls every byte.
 */

export interface ReceiptLike {
  eventId: string; result: string | null; value: string | null; units: number; prevValue: string | null; carryIn: string;
  mapping: BurnMapping | null; memo: string | null; signature: string | null; status: string; sourceUrl?: string | null;
  /** Program execution: the program reading (YYYY-MM-DD) this receipt was counted into, and whether it carries that reading's amounts. */
  execution?: "program" | null; readingDate?: string | null; lead?: boolean | null;
}

export interface VerifyCheck { id: "rules" | "memo" | "source" | "units" | "spend" | "chain"; ok: boolean | null; detail: string }
export interface VerifyResult { ticker: string; eventId: string; verified: boolean; checks: VerifyCheck[]; recomputed: { units: number | null; spentLamports: string | null } }

export interface SourceReading { events: SettledEvent[] | null; error: string | null; url: string | null }
export interface ChainReading { found: boolean; err: string | null; memo: string | null }

const fracStr = (f: number) => f.toFixed(6).replace(/0+$/, "").replace(/\.$/, ".0");

/** The pure core: every check from the receipt, the rule text, what the source said and what the chain said. */
export function verifyReceiptCore(i: { ticker: string; rulesText: string; receipt: ReceiptLike; carry: CarryPolicy; source: SourceReading | null; chain: ChainReading | null }): VerifyResult {
  const r = i.receipt;
  const checks: VerifyCheck[] = [];
  let rule: BurnRule | null = null, sha12: string | null = null, mode: "buyback" | "vault" | null = null;
  try { const locked = rulesFromText(i.rulesText); rule = locked.rule; sha12 = locked.sha12; mode = locked.mode; } catch (e) { checks.push({ id: "rules", ok: false, detail: (e as Error).message }); }
  const m = r.memo ? parseReceiptMemo(r.memo) : null;
  const pm = r.memo && !m ? (parseProgramBuybackMemo(r.memo) ?? parseProgramVaultMemo(r.memo)) : null;
  const cited = m?.rulesSha12 ?? pm?.rulesSha12 ?? null;
  if (rule) {
    if (!r.memo) checks.push({ id: "rules", ok: true, detail: `rules.json is canonical (sha256 …${sha12}); no memo to compare (status ${r.status})` });
    else if (!cited) checks.push({ id: "rules", ok: null, detail: "rules.json is canonical; the memo does not parse, so its hash could not be compared" });
    else checks.push(cited === sha12 ? { id: "rules", ok: true, detail: `rules.json is canonical and its sha256 starts ${sha12}, as the memo cites` } : { id: "rules", ok: false, detail: `memo cites rules sha256:${cited}, the published rule hashes to ${sha12}` });
  }
  if (!r.memo) checks.push({ id: "memo", ok: null, detail: `no memo: status ${r.status} (void, skipped and no-burn receipts write no transaction)` });
  else if (pm) {
    const bad: string[] = [];
    if (pm.prefix !== i.ticker) bad.push(`prefix ${pm.prefix} ≠ ${i.ticker}`);
    if (r.readingDate && pm.recordDate !== r.readingDate) bad.push(`reading ${pm.recordDate} ≠ ${r.readingDate}`);
    if (pm.units < r.units) bad.push(`the reading counts ${pm.units} unit(s), fewer than this receipt's ${r.units}`);
    try { if (BigInt(pm.now) - BigInt(pm.prev) !== BigInt(pm.units)) bad.push(`counter ${pm.prev} → ${pm.now} ≠ ${pm.units} unit(s)`); } catch { bad.push("the counter values are not integers"); }
    checks.push(bad.length ? { id: "memo", ok: false, detail: bad.join("; ") } : { id: "memo", ok: true, detail: `the program's memo (${pm.version}) for reading ${pm.recordDate}: ${pm.units} unit(s), this receipt's ${r.units} among them` });
  } else if (!m) checks.push({ id: "memo", ok: false, detail: "the memo does not parse as a v3 receipt memo or a program memo" });
  else {
    const bad: string[] = [];
    if (m.ticker !== i.ticker) bad.push(`ticker ${m.ticker} ≠ ${i.ticker}`);
    if (m.id !== r.eventId) bad.push(`id ${m.id} ≠ ${r.eventId}`);
    if (m.units !== r.units) bad.push(`units ${m.units} ≠ ${r.units}`);
    if (m.result !== (r.result ?? "-")) bad.push(`result ${m.result} ≠ ${r.result ?? "-"}`);
    if (m.value !== (r.value ?? "-")) bad.push(`value ${m.value} ≠ ${r.value ?? "-"}`);
    checks.push(bad.length ? { id: "memo", ok: false, detail: bad.join("; ") } : { id: "memo", ok: true, detail: "memo parses (v3) and names the same event, units, result and value" });
  }
  // The source: what the original venue/feed says about this event today.
  let ev: SettledEvent = { id: r.eventId, at: "", result: (r.result ?? null) as SettledEvent["result"], value: r.value, title: null, sourceUrl: r.sourceUrl ?? "" };
  if (!i.source) checks.push({ id: "source", ok: null, detail: "source not re-read (no fetch given)" });
  else if (i.source.error) checks.push({ id: "source", ok: null, detail: `source unavailable: ${i.source.error}` });
  else {
    const found = (i.source.events ?? []).find((e) => e.id === r.eventId) ?? null;
    if (!found) checks.push({ id: "source", ok: null, detail: `the source${i.source.url ? ` (${i.source.url})` : ""} does not list ${r.eventId} as settled now (outside its window, or not final)` });
    else {
      const same = (found.result ?? null) === (r.result ?? null) && (found.value ?? null) === (r.value ?? null);
      checks.push(same ? { id: "source", ok: true, detail: `the source says ${found.result ?? found.value} for ${r.eventId}, as the receipt does` } : { id: "source", ok: false, detail: `the source says result=${found.result ?? "-"} value=${found.value ?? "-"}; the receipt says result=${r.result ?? "-"} value=${r.value ?? "-"}` });
      ev = { ...found };
    }
  }
  let units: number | null = null, spend: bigint | null = null;
  if (rule) {
    try {
      const s = unitStep(rule, ev, { value: r.prevValue, carryOut: r.carryIn }, i.carry);
      units = s.units;
      const mapOk = JSON.stringify(s.mapping) === JSON.stringify(r.mapping);
      checks.push(s.units === r.units && mapOk ? { id: "units", ok: true, detail: `${s.note} → ${s.units} unit(s)` } : { id: "units", ok: false, detail: `recomputed ${s.units} unit(s)${mapOk ? "" : " with a different mapping"}; the receipt says ${r.units}` });
    } catch (e) { checks.push({ id: "units", ok: false, detail: `recomputation failed: ${(e as Error).message}` }); }
  }
  if (mode === "buyback" && pm && "spent" in pm && r.mapping?.fractionOfPool !== undefined) {
    // The program's own fixed-point rule spend over the reading's units; one crank spends at most 2 % of the pool's reserve and
    // carries the rest, so a spend below the rule's is "carried" (not checkable from the memo alone), above it is carried-in spend.
    const bps = Math.round(r.mapping.fractionOfPool * 10_000);
    spend = programBuybackSpend(BigInt(pm.pool), BigInt(pm.units), bps);
    const spent = BigInt(pm.spent);
    if (r.lead === false) checks.push({ id: "spend", ok: null, detail: `burned together with reading ${pm.recordDate}'s first receipt (one crank per reading)` });
    else if (spent > BigInt(pm.pool)) checks.push({ id: "spend", ok: false, detail: `spent ${pm.spent} > pool ${pm.pool}` });
    else if (pm.burn !== pm.got && Number(pm.burn) < Number(pm.got)) checks.push({ id: "spend", ok: false, detail: `burned ${pm.burn} < bought ${pm.got}` });
    else if (spent === spend) checks.push({ id: "spend", ok: true, detail: `rule spend = ${pm.pool} × (1 − (1 − ${bps}/10000)^${pm.units}) = ${spend} lamports (the program's fixed point), spent in full; every token the fee PDA held was burned` });
    else checks.push({ id: "spend", ok: null, detail: `rule spend ${spend} lamports, spent ${pm.spent}: the program caps one crank at 2% of the pool's reserve and carries the difference (see the Reading account's carried_in/out)` });
  } else if (mode === "buyback" && m && r.mapping?.fractionOfPool !== undefined) {
    spend = buybackSpend(BigInt(m.pool), r.units, fracStr(r.mapping.fractionOfPool));
    const bad: string[] = [];
    if (r.status === "confirmed" && spend.toString() !== m.spent) bad.push(`spend = ${m.pool} × (1 − (1 − ${r.mapping.fractionOfPool})^${r.units}) = ${spend} lamports; the memo says ${m.spent}`);
    if (r.status === "confirmed" && m.burn !== m.got) bad.push(`burned ${m.burn} ≠ bought ${m.got}`);
    checks.push(bad.length ? { id: "spend", ok: false, detail: bad.join("; ") } : { id: "spend", ok: true, detail: `spend = ${m.pool} × (1 − (1 − ${r.mapping.fractionOfPool})^${r.units}) = ${spend} lamports; every token bought was burned` });
  } else if (mode === "vault") checks.push({ id: "spend", ok: null, detail: "vault mode: no spend (the burn comes from the vesting vault; see units × tokens)" });
  if (!r.signature) checks.push({ id: "chain", ok: null, detail: "no transaction for this receipt" });
  else if (!i.chain) checks.push({ id: "chain", ok: null, detail: "chain not read (pass a Solana connection)" });
  else if (!i.chain.found) checks.push({ id: "chain", ok: false, detail: `no confirmed transaction ${r.signature}` });
  else if (i.chain.err) checks.push({ id: "chain", ok: false, detail: `transaction ${r.signature} failed: ${i.chain.err}` });
  else if (i.chain.memo !== r.memo) checks.push({ id: "chain", ok: false, detail: `the memo on chain ≠ the receipt's memo (${(i.chain.memo ?? "none").slice(0, 60)}…)` });
  else checks.push({ id: "chain", ok: true, detail: `transaction ${r.signature.slice(0, 12)}… succeeded and wrote this exact memo` });
  const failed = checks.some((c) => c.ok === false);
  const core = checks.filter((c) => c.id === "rules" || c.id === "units").every((c) => c.ok === true);
  return { ticker: i.ticker, eventId: r.eventId, verified: !failed && core, checks, recomputed: { units, spentLamports: spend === null ? null : spend.toString() } };
}

/**
 * Re-read a Kalshi event from Kalshi's own public API (the verifier builds the URL from the event id; it never follows a URL the
 * receipt supplies). Binary rules: the market; scalar rules: every market of the event (the strike ladder).
 */
export async function kalshiSourceReading(rule: BurnRule, eventId: string, fetchImpl: FetchLike, nowMs: number): Promise<SourceReading> {
  const url = rule.kind === "binary" ? marketApiUrl(eventId) : `${KALSHI_API}/markets?event_ticker=${encodeURIComponent(eventId)}&limit=200`;
  try {
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) return { events: null, error: `Kalshi HTTP ${res.status}`, url };
    const body = await res.json() as { market?: unknown; markets?: unknown };
    const { markets } = parseMarketsBody(rule.kind === "binary" ? { markets: [body.market] } : body);
    return { events: resolveSelector(rule, markets, { nowMs, sinceIso: null }).events, error: null, url };
  } catch (e) { return { events: null, error: (e as Error).message.slice(0, 160), url }; }
}

/**
 * Re-read a Polymarket result (2026-10-10): the market from Gamma (built from the condition id — the receipt supplies no URL) for its
 * labels, event and time, and the AUTHORITATIVE payout vector from the Conditional Tokens contract on Polygon (eth_call through the
 * given RPC fetch, or the public endpoints). A market whose vector is not on chain comes back "not listed" (ok: null).
 */
export async function polymarketSourceReading(rule: BurnRule, eventId: string, o: { fetchImpl: FetchLike; rpcFetch?: RpcFetchLike; rpcUrls?: string[]; readChain?: (conditionId: string) => Promise<ConditionResolution> }): Promise<SourceReading> {
  if (!POLY_MARKET_RE.test(eventId)) return { events: null, error: `${eventId} is not a Polymarket condition id`, url: null };
  const url = settledMarketUrl(eventId);
  try {
    const res = await o.fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) return { events: null, error: `Gamma HTTP ${res.status}`, url };
    const m = parseGammaMarkets(await res.json()).find((x) => x.conditionId === eventId);
    if (!m) return { events: [], error: null, url };
    const chain = o.readChain ? await o.readChain(eventId) : await readConditionResolution(eventId, { fetchImpl: o.rpcFetch, rpcUrls: o.rpcUrls });
    return { events: resolvePolymarket(rule, [{ market: m, chain }], { sinceIso: null }).events, error: null, url: `${url} + eth_call ${chain.contract} on Polygon (block ${chain.blockNumber ?? "latest"})` };
  } catch (e) { return { events: null, error: (e as Error).message.slice(0, 160), url }; }
}

/**
 * Re-read a catalogue reading from the feed itself: the feed's published request (URL template expanded for today, as the keeper
 * reads it) parsed by its published selection config. The receipt supplies no URL, so it cannot point the verifier anywhere; a period
 * that has scrolled out of the feed's current window comes back "not listed" (ok: null), never as a failure.
 */
export async function feedSourceReading(cfg: Pick<HttpSourceConfig, "request" | "select" | "period" | "plausibility"> & Partial<HttpSourceConfig>, fetchImpl: FetchLike, nowMs: number): Promise<SourceReading> {
  if (/\{[A-Z][A-Z0-9_]*\}/.test(cfg.request.url) || cfg.needsKey) return { events: null, error: `the source needs a key (${cfg.needsKey ?? "a key template in its URL"})`, url: null };
  const url = expandUrl(cfg.request.url, nowMs);
  try {
    const res = await fetchImpl(url, { headers: { accept: cfg.request.format === "json" ? "application/json" : "*/*", "user-agent": "burnticker-verify/1 (receipt verification)" }, ...(cfg.request.method === "POST" ? { method: "POST", body: cfg.request.body } : {}) } as never);
    if (!res.ok) return { events: null, error: `HTTP ${res.status}`, url };
    const body = cfg.request.format === "json" ? await res.json() : res.text ? await res.text() : String(await res.json());
    return { events: parseBody(cfg as HttpSourceConfig, body, nowMs).readings, error: null, url };
  } catch (e) { return { events: null, error: (e as Error).message.slice(0, 160), url }; }
}

/**
 * THE PINNED-METADATA CHECK (pin.ts; the coin page's "matches the locked description ✓" and the trust page's verifier): the bytes at
 * the coin's arweave URI hash to the sha256 the registry recorded at launch, and their `description` equals the generated text byte for
 * byte. ok: null when the coin has no pin (made before 2026-10-10, or a hosted devnet script coin).
 */
export async function verifyPinnedMetadata(pinned: { metadataUri: string | null; metadataSha256: string | null; hosted: boolean; expectedDescription: string } | null | undefined, fetchImpl: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>): Promise<{ ok: boolean | null; detail: string }> {
  if (!pinned || pinned.hosted || !pinned.metadataUri || !pinned.metadataSha256) return { ok: null, detail: "no pinned metadata for this coin (made before pinning, or a hosted devnet script coin)" };
  try {
    const r = await fetchImpl(pinned.metadataUri);
    if (!r.ok) return { ok: null, detail: `the gateway answered HTTP ${r.status}` };
    const buf = new Uint8Array(await r.arrayBuffer());
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(buf).digest("hex");
    if (sha !== pinned.metadataSha256) return { ok: false, detail: `pinned bytes hash to ${sha}, not ${pinned.metadataSha256}` };
    const j = JSON.parse(new TextDecoder().decode(buf)) as { description?: unknown };
    return j.description === pinned.expectedDescription ? { ok: true, detail: `sha256 ${sha} · matches the locked description` } : { ok: false, detail: "the pinned description differs from the generated text" };
  } catch (e) { return { ok: null, detail: `could not read the pin: ${(e as Error).message.slice(0, 120)}` }; }
}
