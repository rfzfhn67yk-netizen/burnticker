import { backoffMs } from "@/lib/burnKeeper/schedule";
import { rawToTokens } from "@/lib/burnKeeper/rules";
import { formatDate, utcDate } from "@/lib/burnReceipts/math";
import { WAIT_REASONS, WAIT_RETRY_MS, type ProgramConfigView, type ProgramPort, type ProgramReadingView } from "@/lib/burnKeeper/programChain";
import type { OracleAdapter } from "@/lib/burnticker/oracle/types";
import { feedById } from "@/lib/burnticker/catalogue";
import { readingMatches, selectorKeyOf, wideRule, type ReceiptRow, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { DECIMALS, type BurnRule, type LockedRule } from "@/lib/burnticker/rules";
import { unitSteps, type CarryPolicy, type SettledEvent } from "@/lib/burnticker/units";
import { COUNTER_BASE, counterRule, counterSourceUrl, programExpressible, type BurnProgramClient } from "@/lib/burnticker/program";

/**
 * THE MULTI-TOKEN KEEPER (LAUNCHPAD-PATH §2; 2026-10-09): one loop over every registered token. Each cycle:
 *
 *   1. FETCH every selector key in use that is due (a Kalshi series+kind, one market, or a feed), through its oracle adapter, with the
 *      filter cleared so the whole series is stored once; write the settled readings (an oracle that changes a recorded result holds
 *      the key — the registry refuses the write). Finality is the adapter's job; the keeper never sees a price.
 *   2. PLAN every live token: its readings after its baseline that its filter admits and that it has not yet seen, through the shared
 *      unit engine (the catalogue's carry policy where the feed says so), one receipt row per event — planned (something to crank),
 *      nothing (a NO without onNo, under one unit, wrong direction), or void.
 *   3. EXECUTE through the burn_receipts program (2026-10-10; program.ts explains the UNIT COUNTER): once a UTC day is over, attest
 *      the token's counter (1 + every unit its receipts carried through that day) with submit_reading — write-ahead, quorum from the
 *      TokenConfig — then claim creator fees and check pool health (best-effort), adopt anything already cranked, and crank in order
 *      (crank_buyback / crank_vault). The receipts take the program's facts from its Reading account: the LEAD receipt of a reading
 *      carries the pool, rule spend, carried spend, spent, got, burned and the memo the program wrote; the others the same signature
 *      and memo with zero amounts. The keeper computes no amount. TWAP / pool / day-not-over / quorum-short are WAITS; refusals back
 *      off (15 s doubling to 1 h); an event is late, never lost; one crank per reading across restarts.
 *   4. PUBLISH is the caller's (scripts/burnticker-keeper.mts): status.json + page per token and the platform index, via tokenPage.ts.
 *
 * Everything that touches a chain goes through BurnProgramClient (its per-token ProgramPort); the tests run the FakeBurnProgram (the
 * program in memory). Dry run plans and signs nothing.
 */

export interface KeeperDeps {
  registry: Registry;
  program: BurnProgramClient;
  oracles: { kalshi: OracleAdapter; catalogue: OracleAdapter };
  /** The keeper's data key (attester v1); recorded on every reading. */
  attester: string;
  log: (line: string) => void;
  now: () => number;
  dryRun: boolean;
  /** Re-read this far back each fetch to catch late finalisations (the registry dedupes). */
  overlapMs?: number;
  kalshiPollMs?: number;
  /** After a UTC day ends, wait this long (and for a fetch after it) before reading the day into the program (READING_GRACE_MS). */
  readingGraceMs?: number;
}

export interface FetchReport { key: string; written: number; refusals: string[]; awaitingFinal: number; error: string | null; skipped: boolean }
export type ExecOutcome =
  | { mint: string; eventId: string; outcome: "confirmed"; signature: string; burnRaw: bigint; adopted: boolean }
  | { mint: string; eventId: string; outcome: "skipped" | "exhausted" | "waiting" | "error" | "dry-run"; why: string };
export interface CycleReport { fetched: FetchReport[]; planned: { mint: string; eventId: string; status: string }[]; executed: ExecOutcome[]; errors: string[] }

const oracleFor = (d: KeeperDeps, key: string): OracleAdapter => (key.startsWith("catalogue:") ? d.oracles.catalogue : d.oracles.kalshi);
const carryFor = (rule: BurnRule): CarryPolicy => (rule.oracle === "catalogue" && rule.series ? feedById(rule.series)?.carry ?? "none" : "none");
/** A selector's read cadence: the feed's pollEverySec, or the Kalshi poll (5 min). Exported for the ops alerts (a stall = 2× this with no fetch). */
export const pollMsFor = (d: Pick<KeeperDeps, "kalshiPollMs">, rule: BurnRule): number => (rule.oracle === "catalogue" && rule.series ? (feedById(rule.series)?.pollEverySec ?? 3600) * 1000 : d.kalshiPollMs ?? 5 * 60_000);

/** Readings for the live tokens' keys, each key once per schedule. */
export async function fetchDue(d: KeeperDeps, tokens: readonly TokenRow[]): Promise<FetchReport[]> {
  const now = d.now();
  const byKey = new Map<string, TokenRow>();
  for (const t of tokens) if (!byKey.has(t.selectorKey)) byKey.set(t.selectorKey, t);
  const out: FetchReport[] = [];
  for (const [key, t] of byKey) {
    const st = d.registry.feedState(key);
    if (st.nextFetchAt !== null && now < st.nextFetchAt) { out.push({ key, written: 0, refusals: [], awaitingFinal: 0, error: null, skipped: true }); continue; }
    const locked = d.registry.lockedRule(t);
    const rule = wideRule(locked.rule);
    const last = d.registry.lastReading(key);
    const since = last ? new Date(Math.max(0, Date.parse(/^\d{4}-\d{2}(-\d{2})?$/.test(last.at) ? `${last.at.length === 7 ? `${last.at}-01` : last.at}T00:00:00Z` : last.at) - (d.overlapMs ?? 7 * 86_400_000))).toISOString() : null;
    // Feeds key readings by period strings ("2026-10-08"); compare in that space. Kalshi keys by ISO times.
    const sinceKey = since && key.startsWith("catalogue:") ? (last!.at.length === 7 ? since.slice(0, 7) : since.slice(0, 10)) : since;
    try {
      const r = await oracleFor(d, key).settledSince(rule, sinceKey);
      const written = d.registry.putReadings(locked.rule.oracle, key, r.events, { settlementSourceUrl: r.settlementSourceUrl, attestedBy: [d.attester] }, now);
      d.registry.setFeedState({ selectorKey: key, lastFetchAt: now, lastOkAt: now, failures: 0, lastError: null, nextFetchAt: now + pollMsFor(d, locked.rule) });
      if (written || r.refusals.length) d.log(`  [feed] ${key}: ${written} new reading(s)${r.awaitingFinal ? `, ${r.awaitingFinal} awaiting finality` : ""}${r.refusals.length ? ` · refused: ${r.refusals.slice(0, 3).join("; ")}` : ""}`);
      out.push({ key, written, refusals: r.refusals, awaitingFinal: r.awaitingFinal, error: null, skipped: false });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 200);
      const failures = st.failures + 1;
      d.registry.setFeedState({ selectorKey: key, lastFetchAt: now, lastOkAt: st.lastOkAt, failures, lastError: msg, nextFetchAt: now + backoffMs(failures - 1) });
      d.log(`  [feed] ${key}: ${msg} — retrying in ${Math.round(backoffMs(failures - 1) / 1000)} s`);
      out.push({ key, written: 0, refusals: [], awaitingFinal: 0, error: msg, skipped: false });
    }
  }
  return out;
}

/** New readings for one token through the engine → receipt rows. Pure apart from the registry writes. */
export function planToken(d: KeeperDeps, t: TokenRow, locked: LockedRule): { mint: string; eventId: string; status: string }[] {
  const state = d.registry.state(t.mint);
  const after = state.lastSettledAt ?? t.baselineAt;
  const fresh: SettledEvent[] = d.registry.readings(t.selectorKey, t.baselineAt).filter((r) => readingMatches(locked.rule, r) && (r.at > after || (r.at === after && state.lastEventId !== null && r.id > state.lastEventId)) && !d.registry.receipt(t.mint, r.id));
  if (!fresh.length) return [];
  const steps = unitSteps(locked.rule, fresh, carryFor(locked.rule), { value: state.lastValue, carryOut: state.carryOut });
  const out: { mint: string; eventId: string; status: string }[] = [];
  let prev = { value: state.lastValue, carryOut: state.carryOut };
  for (const { event, step } of steps) {
    const wrote = d.registry.applyStep(t.mint, event, step, prev, locked.rule.kind === "scalar", d.now());
    const row = d.registry.receipt(t.mint, event.id)!;
    if (wrote) { out.push({ mint: t.mint, eventId: event.id, status: row.status }); d.log(`  [plan] $${t.ticker} ${event.id}: ${step.note}${row.status === "planned" ? " → receipt planned" : ""}`); }
    if (locked.rule.kind === "scalar" && event.value !== null && event.result !== "void") prev = { value: event.value, carryOut: step.carryOut };
    else prev = { value: prev.value, carryOut: step.carryOut };
  }
  return out;
}

const DAY_MS = 86_400_000;
const ymd = (ms: number): number => utcDate(Math.floor(ms / 1000));
const dayStartMs = (d: number): number => Date.UTC(Math.floor(d / 10_000), (Math.floor(d / 100) % 100) - 1, d % 100);
const nextDay = (d: number): number => ymd(dayStartMs(d) + DAY_MS);
const prevDay = (d: number): number => ymd(dayStartMs(d) - DAY_MS);

/** The UTC day (YYYYMMDD) a settlement belongs to: an ISO time's UTC date, a feed period's date ("2026-10-08"), a month's first day ("2026-08"). */
export function receiptDay(settledAt: string): number {
  if (/^\d{4}-\d{2}$/.test(settledAt)) return Number(settledAt.replace("-", "")) * 100 + 1;
  if (/^\d{4}-\d{2}-\d{2}$/.test(settledAt)) return Number(settledAt.replace(/-/g, ""));
  const ms = Date.parse(settledAt);
  if (Number.isNaN(ms)) throw new Error(`not a settlement time: ${settledAt}`);
  return ymd(ms);
}

/** A Kalshi day is read into the program once it is over (UTC) plus this grace AND the selector was fetched after it ended. */
export const READING_GRACE_MS = 60 * 60_000;

/** Write-ahead resolution for one registry key (an event id, `reading:<date>` or `crank:<date>`). */
async function resolveSent(d: KeeperDeps, port: ProgramPort, mint: string, key: string): Promise<{ landed: { signature: string; slot: number | null; memo: string } } | { waiting: string } | { none: true }> {
  const sent = d.registry.signatures(mint, key).filter((s) => s.status === "sent");
  if (!sent.length) return { none: true };
  const st = await port.signatureStatuses(sent.map((s) => s.signature));
  let height: number | null = null;
  for (let i = 0; i < sent.length; i++) {
    const s = sent[i], x = st[i];
    if (x && x.err === null && x.confirmed) return { landed: { signature: s.signature, slot: x.slot, memo: s.memo } };
    if (x && x.err !== null) { d.registry.setSignatureStatus(s.signature, "failed", x.err, x.slot); continue; }
    height ??= await port.blockHeight();
    if (height > s.lastValidBlockHeight) d.registry.setSignatureStatus(s.signature, "expired", null, null);
    else return { waiting: `${key} ${s.signature.slice(0, 12)}… may still land (block height ${height} ≤ ${s.lastValidBlockHeight})` };
  }
  return { none: true };
}

/**
 * Pending receipts of one token through the burn_receipts program (see program.ts for the counter): (1) attest every closed day's
 * units as a counter reading — baseline first, in order, write-ahead; (2) best-effort creator-fee claims and check_pool_health
 * (buyback); (3) adopt readings someone else already cranked; (4) crank in order, recording what the program did from its Reading
 * account. Waits (TWAP, no pool, day not over, quorum short) are outcomes, never errors.
 */
export async function executePending(d: KeeperDeps, t: TokenRow, locked: LockedRule): Promise<ExecOutcome[]> {
  const reg = d.registry, mint = t.mint;
  const out: ExecOutcome[] = [];
  const pending = reg.pending(mint);
  if (!pending.length) return out;
  const hold = (why: string, rows: readonly ReceiptRow[] = pending, outcome: "waiting" | "error" = "waiting"): ExecOutcome[] => { for (const b of rows) out.push({ mint, eventId: b.eventId, outcome, why }); return out; };
  const notExpressible = programExpressible(locked.rule, t.ticker);
  if (notExpressible) { d.log(`  [program] $${t.ticker}: held — ${notExpressible}`); return hold(`not expressible on the program: ${notExpressible}`); }
  let port: ProgramPort;
  try { port = d.program.port(mint); } catch (e) { return hold(`no program port: ${(e as Error).message.slice(0, 120)}`); }
  let cfg = await port.config();
  if (!cfg) { d.log(`  [program] $${t.ticker}: no TokenConfig on chain — initialize_token has not run for ${mint}`); return hold("no TokenConfig on chain (initialize_token not run)"); }
  const want = counterRule(locked.rule, t.ticker, t.selectorKey, { floorLamports: BigInt(0) });
  const mismatch = cfg.rulesSha256 !== t.rulesSha ? `the on-chain rules sha256 ${cfg.rulesSha256.slice(0, 12)}… ≠ the registry's ${t.rulesSha.slice(0, 12)}…`
    : cfg.feedId !== want.feedId || cfg.valueDecimals !== 0 || cfg.unitValue !== BigInt(1) ? `the TokenConfig is not this token's unit counter (feed ${cfg.feedId})`
    : cfg.mode !== locked.mode ? `the TokenConfig is in ${cfg.mode} mode, the rule is ${locked.mode}` : null;
  if (mismatch) { d.log(`  [program] $${t.ticker}: REFUSED — ${mismatch}`); return hold(mismatch, pending, "error"); }

  // 1. ATTEST the closed days.
  const r = await submitCounterReadings(d, t, port, cfg, out);
  cfg = r.cfg;

  // 2. FEED THE POOL + POOL HEALTH (buyback; best-effort; only when something is waiting for a crank).
  const counted = reg.pending(mint).filter((b) => b.readingDate !== null);
  if (!d.dryRun && cfg.mode === "buyback" && counted.length) {
    try { const c = await port.claimCreatorFees(); for (const s of c.sent) d.log(`  [fees] $${t.ticker}: creator fees moved into the fee PDA: ${s}`); for (const n of c.notes) d.log(`  [fees] $${t.ticker}: ${n}`); }
    catch (e) { d.log(`  [fees] $${t.ticker}: claim failed (best-effort, the crank goes on): ${(e as Error).message.slice(0, 160)}`); }
    if (cfg.poolRegistered) {
      try { const h = await port.checkPoolHealth(); d.log(`  [pool] $${t.ticker}: ${h.note}`); } catch (e) { d.log(`  [pool] $${t.ticker}: check_pool_health failed: ${(e as Error).message.slice(0, 160)}`); }
      cfg = (await port.config()) ?? cfg;
    }
  }

  // 3. ADOPT readings already processed on chain (cranking is permissionless; a lost confirmation).
  for (const D of [...new Set(counted.map((b) => b.readingDate!))]) {
    const rd = await port.reading(D);
    if (!rd?.processed) continue;
    const res = await resolveSent(d, port, mint, `crank:${formatDate(D)}`);
    const tx = "landed" in res ? { signature: res.landed.signature, slot: res.landed.slot, memo: await port.memoOf(res.landed.signature, D) } : await port.findCrankTx(D);
    if (!tx) { hold("processed on chain; its crank transaction is not found yet", reg.receiptsForReading(mint, D)); continue; }
    recordCrank(d, t, cfg, D, rd, tx, true, out);
  }

  // 4. CRANK in order.
  for (let i = 0; i < 30; i++) {
    const plan = await port.planCrank();
    if ("status" in plan) {
      if (plan.status === "waiting-for-pool") {
        const why = WAIT_REASONS["waiting-for-pool"];
        if (!d.dryRun) reg.setReadingWait(mint, plan.recordDate, why, d.now() + WAIT_RETRY_MS, d.now());
        hold(why, reg.receiptsForReading(mint, plan.recordDate));
      }
      break;
    }
    const D = plan.recordDate, Ds = formatDate(D), now = d.now();
    const rows = reg.receiptsForReading(mint, D).filter((b) => b.status === "planned" || b.status === "sending");
    const key = `crank:${Ds}`;
    const res = await resolveSent(d, port, mint, key);
    if ("landed" in res) {
      const rd = await port.reading(D);
      if (!rd?.processed) { hold(`crank ${res.landed.signature.slice(0, 12)}… landed; the reading is not processed yet`, rows); break; }
      recordCrank(d, t, cfg, D, rd, { signature: res.landed.signature, slot: res.landed.slot, memo: await port.memoOf(res.landed.signature, D) }, true, out);
      continue;
    }
    if ("waiting" in res) { hold(res.waiting, rows); break; }
    const lead = rows[0];
    if (lead && !d.dryRun && lead.nextAttemptAt && now < lead.nextAttemptAt) { hold(lead.waitReason ? `${lead.waitReason} (next try ${new Date(lead.nextAttemptAt).toISOString()})` : `backing off until ${new Date(lead.nextAttemptAt).toISOString()}`, rows); break; }
    if (d.dryRun) { d.log(`  [dry-run] $${t.ticker} ${Ds}: would crank_${plan.kind} (the program computes the amounts)`); for (const b of rows) out.push({ mint, eventId: b.eventId, outcome: "dry-run", why: `crank_${plan.kind} ${Ds}` }); break; }
    const fail = (why: string) => { reg.noteReadingError(mint, D, why, now + backoffMs(lead?.attempts ?? 0), now); d.log(`  [crank] $${t.ticker} ${Ds}: ${why} — retrying later`); hold(why, rows, "error"); };
    try {
      const tx = await plan.build();
      const sim = await port.simulate(tx.raw);
      if (sim.err) {
        const wait = WAIT_REASONS[sim.err] ?? (port.retryableErrors?.has(sim.err) ? "waiting — the program reported a retryable condition" : undefined);
        if (wait) { reg.setReadingWait(mint, D, `${sim.err}: ${wait}`, now + WAIT_RETRY_MS, now); d.log(`  [crank] $${t.ticker} ${Ds}: deferred by the program (${sim.err}) — ${wait}`); hold(`${sim.err}: ${wait}`, rows); }
        else fail(`crank_${plan.kind} simulation refused: ${sim.err}${sim.logs.length ? ` · ${sim.logs.slice(-2).join(" · ")}` : ""}`);
        break;
      }
      reg.recordSignature({ signature: tx.signature, mint, eventId: key, memo: `crank_${plan.kind} ${Ds}`, burnRaw: BigInt(0), spendLamports: BigInt(0), blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, sentAt: now });
      reg.markReadingSending(mint, D, now);
      try { await port.send(tx.raw); } catch (e) { d.log(`  [crank] $${t.ticker} ${Ds}: send raised ${(e as Error).message.slice(0, 120)} — the signature is on the ledger and will be resolved`); }
      const c = await port.confirm(tx);
      if (c.status === "failed") { reg.setSignatureStatus(tx.signature, "failed", c.err, null); fail(`crank_${plan.kind} failed on chain: ${c.err}`); break; }
      if (c.status === "expired") { hold(`crank ${tx.signature.slice(0, 12)}… not confirmed yet`, rows); break; }
      const rd = await port.reading(D);
      if (!rd?.processed) { hold("crank confirmed; the reading is not processed yet", rows); break; }
      recordCrank(d, t, cfg, D, rd, { signature: tx.signature, slot: c.slot, memo: await port.memoOf(tx.signature, D) }, false, out);
    } catch (e) { fail(`RPC/program error: ${(e as Error).message.slice(0, 200)}`); break; }
  }
  return out;
}

/** Attests every closed day's units (baseline first). Returns the refreshed config. */
async function submitCounterReadings(d: KeeperDeps, t: TokenRow, port: ProgramPort, cfg0: ProgramConfigView, out: ExecOutcome[]): Promise<{ cfg: ProgramConfigView }> {
  const reg = d.registry, mint = t.mint;
  let cfg = cfg0;
  const now = d.now(), today = ymd(now);
  const isFeed = t.selectorKey.startsWith("catalogue:");
  const submit = async (D: number, value: bigint, counted: readonly ReceiptRow[], report: readonly ReceiptRow[] = counted): Promise<boolean> => {
    const Ds = formatDate(D), key = `reading:${Ds}`, ids = counted.map((b) => b.eventId);
    const rows = report;
    const wait = (why: string) => { for (const b of rows) out.push({ mint, eventId: b.eventId, outcome: "waiting", why }); d.log(`  [attest] $${t.ticker} ${Ds}: ${why}`); return false; };
    const res = await resolveSent(d, port, mint, key);
    if ("waiting" in res) return wait(res.waiting);
    if ("landed" in res) {
      // An earlier submit landed: count exactly the receipts IT named (its write-ahead row), not today's selection.
      let named: string[] = [];
      try { named = (JSON.parse(res.landed.memo) as { events?: string[] }).events ?? []; } catch { named = []; }
      reg.setSignatureStatus(res.landed.signature, "confirmed", null, res.landed.slot);
      reg.assignReading(mint, named, D, now);
      d.log(`  [attest] $${t.ticker} ${Ds}: an earlier submit_reading landed (${res.landed.signature.slice(0, 12)}…) — ${named.length} receipt(s) counted into it`);
      cfg = (await port.config()) ?? cfg;
      return true;
    }
    const mine = port.attesterKeys().filter((k) => cfg.attesters.some((a) => a.key === k));
    if (mine.length < cfg.quorum) return wait(`quorum short: the program needs ${cfg.quorum} attester signature(s); this keeper holds ${mine.length}`);
    if (d.dryRun) { d.log(`  [dry-run] $${t.ticker} ${Ds}: would attest the unit counter ${value} (${ids.length} receipt(s): ${ids.join(", ") || "baseline"})`); for (const b of rows) out.push({ mint, eventId: b.eventId, outcome: "dry-run", why: `reading ${Ds} = ${value}` }); return false; }
    const tx = await port.buildReading({ recordDate: D, prevDate: cfg.hasBaseline ? cfg.lastRecordDate : 0, value, sourceUrl: counterSourceUrl(t.ticker, Ds, ids), feedId: cfg.feedId, valueDecimals: 0 });
    const sim = await port.simulate(tx.raw);
    if (sim.err) {
      if (sim.err === "QuorumNotMet") return wait("quorum short: the program did not count enough attester signatures (QuorumNotMet)");
      const why = `submit_reading refused: ${sim.err}`;
      for (const b of counted) reg.noteError(mint, b.eventId, why, now + backoffMs(b.attempts), now);
      d.log(`  [attest] $${t.ticker} ${Ds}: ${why}`);
      for (const b of rows) out.push({ mint, eventId: b.eventId, outcome: "error", why });
      return false;
    }
    reg.recordSignature({ signature: tx.signature, mint, eventId: key, memo: JSON.stringify({ message: tx.message, events: ids, value: value.toString() }), burnRaw: BigInt(0), spendLamports: BigInt(0), blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, sentAt: now });
    try { await port.send(tx.raw); } catch (e) { d.log(`  [attest] $${t.ticker} ${Ds}: send raised ${(e as Error).message.slice(0, 120)} — the signature is on the ledger and will be resolved`); }
    const c = await port.confirm(tx);
    if (c.status === "failed") { reg.setSignatureStatus(tx.signature, "failed", c.err, null); for (const b of rows) out.push({ mint, eventId: b.eventId, outcome: "error", why: `submit_reading failed: ${c.err}` }); return false; }
    if (c.status === "expired") return wait(`submit_reading ${tx.signature.slice(0, 12)}… not confirmed yet`);
    reg.setSignatureStatus(tx.signature, "confirmed", null, c.slot);
    reg.assignReading(mint, ids, D, now);
    d.log(`  [attest] $${t.ticker} ${Ds}: unit counter ${value} attested (${ids.length ? `${ids.length} receipt(s): ${ids.join(", ")}` : "baseline"}) — ${tx.signature}`);
    cfg = (await port.config()) ?? cfg;
    return true;
  };
  if (!cfg.hasBaseline) {
    if (!(await submit(prevDay(receiptDay(t.baselineAt)), COUNTER_BASE, [], reg.pending(mint)))) return { cfg };
  }
  let unassigned = reg.pending(mint).filter((b) => b.readingDate === null);
  while (unassigned.length) {
    const D = Math.max(receiptDay(unassigned[0].settledAt), nextDay(cfg.lastRecordDate));
    const endMs = dayStartMs(D) + DAY_MS;
    if (D > today || (!isFeed && (now < endMs + (d.readingGraceMs ?? READING_GRACE_MS) || (reg.feedState(t.selectorKey).lastOkAt ?? 0) < endMs))) {
      const why = `the program reads ${formatDate(D)} once that UTC day is over${isFeed ? "" : " and the selector has been read after it"} (settlements may still arrive)`;
      for (const b of unassigned) out.push({ mint, eventId: b.eventId, outcome: "waiting", why });
      break;
    }
    const group = unassigned.filter((b) => receiptDay(b.settledAt) <= D);
    const units = group.reduce((a, b) => a + BigInt(b.units), BigInt(0));
    if (!(await submit(D, cfg.lastValue + units, group))) break;
    unassigned = reg.pending(mint).filter((b) => b.readingDate === null);
  }
  return { cfg };
}

/** Writes what the program did for reading D onto its receipts (lead: the amounts; the others: zeros) and reports one outcome per receipt. */
function recordCrank(d: KeeperDeps, t: TokenRow, cfg: ProgramConfigView, D: number, rd: ProgramReadingView, tx: { signature: string; slot: number | null; memo: string | null }, adopted: boolean, out: ExecOutcome[]): void {
  const reg = d.registry, mint = t.mint;
  const rows = reg.receiptsForReading(mint, D).filter((b) => b.status === "planned" || b.status === "sending");
  const units = rows.reduce((a, b) => a + b.units, 0);
  if (rows.length && units !== rd.units) d.log(`  [program] $${t.ticker} ${formatDate(D)}: the program counted ${rd.units} unit(s), the receipts carry ${units} — the chain is the record`);
  const skippedReason = rd.outcome === "below-floor" ? `the program's spend was under its floor (${cfg.floorLamports} lamports) — nothing bought, the pool keeps the SOL` : rd.outcome === "no-units" ? "the program counted no units" : null;
  reg.markProgramOutcome(mint, D, { signature: tx.signature, slot: tx.slot, outcome: rd.outcome, memo: tx.memo, poolLamports: rd.poolLamports, poolActualLamports: rd.poolActualLamports, spentLamports: rd.spentLamports, ruleSpendLamports: rd.ruleSpendLamports, carriedInLamports: rd.carriedInLamports, carriedOutLamports: rd.carriedOutLamports, gotRaw: rd.got, burnRaw: rd.burned > BigInt(0) ? rd.burned : BigInt(0), shortfallRaw: rd.shortfall, skippedReason }, d.now());
  const partial = [rd.spentLamports > BigInt(0) && rd.carriedOutLamports > BigInt(0) ? `SpendCapBound: ${rd.carriedOutLamports} lamports carried into the next crank` : null, rd.poolActualLamports > rd.poolLamports ? `BurnPoolCapBound: the rule applied to ${rawToTokens(rd.poolLamports, 9)} of ${rawToTokens(rd.poolActualLamports, 9)} SOL` : null].filter(Boolean).join("; ");
  d.log(`  [crank] $${t.ticker} ${formatDate(D)}: ${adopted ? "already processed on chain — adopted" : "CRANKED"} · ${rd.outcome} · ${rd.units} unit(s) for ${rows.length} receipt(s) · spent ${rd.spentLamports} lamports, burned ${rawToTokens(rd.burned, DECIMALS)}${partial ? ` · PARTIAL — ${partial}` : ""} · ${tx.signature}`);
  rows.forEach((b, k) => {
    if (rd.outcome === "exhausted") out.push({ mint, eventId: b.eventId, outcome: "exhausted", why: "allocation used up" });
    else if (rd.outcome === "burned" || rd.outcome === "short") out.push({ mint, eventId: b.eventId, outcome: "confirmed", signature: tx.signature, burnRaw: k === 0 ? rd.burned : BigInt(0), adopted });
    else out.push({ mint, eventId: b.eventId, outcome: "skipped", why: skippedReason ?? rd.outcome });
  });
}

/** One full cycle over every live token. */
export async function runCycle(d: KeeperDeps, opts: { fetch?: boolean } = {}): Promise<CycleReport> {
  const tokens = d.registry.tokens("live");
  const fetched = opts.fetch === false ? [] : await fetchDue(d, tokens);
  const planned: CycleReport["planned"] = [], executed: ExecOutcome[] = [], errors: string[] = [];
  for (const t of tokens) {
    let locked: LockedRule;
    try { locked = d.registry.lockedRule(t); } catch (e) { errors.push(`$${t.ticker}: rule unreadable: ${(e as Error).message}`); continue; }
    if (selectorKeyOf(locked.rule) !== t.selectorKey) { errors.push(`$${t.ticker}: selector key drifted (${t.selectorKey} ≠ ${selectorKeyOf(locked.rule)})`); continue; }
    try { planned.push(...planToken(d, t, locked)); } catch (e) { errors.push(`$${t.ticker}: plan: ${(e as Error).message.slice(0, 160)}`); continue; }
    try { executed.push(...await executePending(d, t, locked)); } catch (e) { errors.push(`$${t.ticker}: execute: ${(e as Error).message.slice(0, 160)}`); }
  }
  for (const r of executed) if (r.outcome === "error") errors.push(`${r.mint.slice(0, 8)} ${r.eventId}: ${r.why}`);
  return { fetched, planned, executed, errors };
}
