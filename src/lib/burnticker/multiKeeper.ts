import { backoffMs } from "@/lib/burnKeeper/schedule";
import type { ResolvedSelector } from "@/lib/burnticker/oracle/types";
import { rawToTokens } from "@/lib/burnKeeper/rules";
import { formatDate, utcDate } from "@/lib/burnReceipts/math";
import { WAIT_REASONS, WAIT_RETRY_MS, type ProgramConfigView, type ProgramPort, type ProgramReadingView } from "@/lib/burnKeeper/programChain";
import type { OracleAdapter } from "@/lib/burnticker/oracle/types";
import { feedById } from "@/lib/burnticker/catalogue";
import { nativeSourceById } from "@/lib/burnticker/sources/native";
import { readingMatches, selectorKeyOf, wideRule, type ReceiptRow, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { DECIMALS, isOneShot, pairClause, ruleMappings, SWEEP_EVERY_DAYS, type BurnRule, type LockedRule } from "@/lib/burnticker/rules";
import { endStep, firstWindDownDay, fullSpendUnits, gatedStatus, unitSteps, voidByEndMs, windDownUnits, type CarryPolicy, type EndReceiptKind, type PairGate, type SettledEvent } from "@/lib/burnticker/units";
import { rulesSha256 } from "@/lib/burnKeeper/rules";
import { solToLamports } from "@/lib/burnKeeper/rules";
import { derbyProofHash } from "@/lib/burnticker/derby/adapter";
import { COUNTER_BASE, counterRule, counterSourceUrl, programExpressible, type BurnProgramClient } from "@/lib/burnticker/program";

/**
 * THE MULTI-TOKEN KEEPER (LAUNCHPAD-PATH §2; 2026-10-09): one loop over every registered token. Each cycle:
 *
 *   1. FETCH every selector key in use that is due (a Kalshi series+kind, one market, a Polymarket tag/event/market, or a feed),
 *      through its oracle adapter, with the filter cleared so the whole series is stored once (a Polymarket reading also carries its
 *      on-chain proof: the CTF payout vector's condition id and block, and is written only once the chain has the payout); write the settled readings (an oracle that changes a recorded result holds
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
  /** Polymarket (2026-10-10) is optional so a keeper without it holds Polymarket keys with an error instead of misreading them. */
  oracles: { kalshi: OracleAdapter; catalogue: OracleAdapter; polymarket?: OracleAdapter; /** Burn Derby (2026-10-10; derby/adapter.ts). */ derby?: OracleAdapter };
  /**
   * BURN DERBY'S KEEPER HOOKS (2026-10-10; DerbyAdapter): `sample` runs before the fetch (boundary snapshots: cross-reads, supplies,
   * pool vault balances), `plan` after the cycle (the planning pass: retire coins whose season ended, whose flippening settled or
   * whose bracket slot lost; log the bracket schedule). Optional: a keeper without them simply has no derby coins to serve.
   */
  derby?: { sample(tokens: readonly TokenRow[]): Promise<unknown>; plan(): string[]; /** Why and when a derby token's rule ended (season over, flippening settled, knocked out, voided). */ ended?(t: TokenRow): { reason: string; atMs: number } | null };
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
  /** BURNTICKER_KALSHI_ENABLED (venues.ts). false: Kalshi is never read; coins with a Kalshi rule are held with a venue-disabled alert (C1, 2026-10-10). Undefined = on. */
  kalshiEnabled?: boolean;
}

export interface FetchReport { key: string; written: number; refusals: string[]; awaitingFinal: number; error: string | null; skipped: boolean }
export type ExecOutcome =
  | { mint: string; eventId: string; outcome: "confirmed"; signature: string; burnRaw: bigint; adopted: boolean }
  | { mint: string; eventId: string; outcome: "skipped" | "exhausted" | "waiting" | "error" | "dry-run"; why: string };
export interface CycleReport { fetched: FetchReport[]; planned: { mint: string; eventId: string; status: string }[]; executed: ExecOutcome[]; errors: string[] }

const oracleFor = (d: KeeperDeps, key: string): OracleAdapter => {
  if (key.startsWith("catalogue:")) return d.oracles.catalogue;
  if (key.startsWith("polymarket:")) { if (!d.oracles.polymarket) throw new Error("no Polymarket adapter configured on this keeper"); return d.oracles.polymarket; }
  if (key.startsWith("derby:")) { if (!d.oracles.derby) throw new Error("no Burn Derby adapter configured on this keeper"); return d.oracles.derby; }
  return d.oracles.kalshi;
};
const carryFor = (rule: BurnRule): CarryPolicy => (rule.oracle === "catalogue" && rule.series ? feedById(rule.series)?.carry ?? "none" : "none");
/** A selector's read cadence: the feed's pollEverySec, or the market poll (5 min; Kalshi and Polymarket alike). Exported for the ops alerts (a stall = 2× this with no fetch). */
export const pollMsFor = (d: Pick<KeeperDeps, "kalshiPollMs">, rule: BurnRule): number => (rule.oracle === "catalogue" && rule.series ? (feedById(rule.series)?.pollEverySec ?? nativeSourceById(rule.series)?.pollEverySec ?? 3600) * 1000 : d.kalshiPollMs ?? 5 * 60_000);

/**
 * A WINDOWED SERIES THAT ENDED (an ESPN team coin's season, postseason or next-N games; sources/espn.ts windowStatus): the source says so
 * in `window`, and every live coin on that selector gets its rule end recorded once (registry.markRuleEnded, mode winddown) — the
 * wind-down starts the day after (detectRuleEnd / the end receipts). A perpetual window never ends; a rule made before the onEnd clause
 * has no wind-down and is left alone. Returns the mints marked.
 */
export function recordWindowEnd(d: Pick<KeeperDeps, "registry" | "dryRun" | "log">, tokens: readonly TokenRow[], r: Pick<ResolvedSelector, "window">): string[] {
  const w = r.window;
  if (!w || w.perpetual || !w.ended || !w.endsAt) return [];
  const at = Date.parse(w.endsAt);
  const out: string[] = [];
  for (const t of tokens) {
    if (t.status !== "live" || d.registry.ruleEnd(t.mint)) continue;
    if (!d.registry.lockedRule(t).rule.onEnd) continue;
    if (!d.dryRun) d.registry.markRuleEnded(t.mint, "winddown", `the coin's window ended: ${w.reason}`, Number.isFinite(at) ? at : Date.now());
    d.log(`  [end] $${t.ticker}: the window ended (${w.reason}) — the pool winds down from the next day`);
    out.push(t.mint);
  }
  return out;
}

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
    const sinceKey0 = since && key.startsWith("catalogue:") ? (last!.at.length === 7 ? since.slice(0, 7) : since.slice(0, 10)) : since;
    // THE AWAITING ANCHOR (review N7): while the adapter reports events that closed but are not final yet, the read window does not move
    // past where it stood when they were first seen — a market that resolves weeks after a later one settled is still read when it does.
    const anchorKey = `fetch.awaiting-anchor.${key}`;
    const anchorRaw = d.registry.getStatus(anchorKey);
    const anchorObj = anchorRaw ? (JSON.parse(anchorRaw) as { since: string | null } | null) : null;
    const anchor = anchorObj ? anchorObj.since : undefined;
    const sinceKey = anchor === undefined ? sinceKey0 : anchor === null || sinceKey0 === null ? null : anchor < sinceKey0 ? anchor : sinceKey0;
    // KALSHI FAILS CLOSED (owner decision 2026-10-10, after the ChatGPT/Codex review's C1): with BURNTICKER_KALSHI_ENABLED off, Kalshi is
    // not read at all — not even for coins registered with a Kalshi rule. Those coins are HELD (no readings, nothing planned or attested)
    // with a "venue disabled" alert; they resume when the venue is turned back on with written consent.
    if (locked.rule.oracle === "kalshi" && d.kalshiEnabled === false) {
      const msg = "venue disabled: BURNTICKER_KALSHI_ENABLED is off, so Kalshi is not read (the coin is held)";
      const names = tokens.filter((x) => x.selectorKey === key).map((x) => `$${x.ticker}`).join(", ");
      if (d.registry.recordAlert({ kind: "venue-disabled", key: `venue-disabled:${key}`, text: `${names}: ${msg}`, meta: { selectorKey: key } }, now)) d.log(`  [held] ${key} (${names}): ${msg}`);
      d.registry.setFeedState({ selectorKey: key, lastFetchAt: st.lastFetchAt, lastOkAt: st.lastOkAt, failures: st.failures, lastError: msg, nextFetchAt: now + pollMsFor(d, locked.rule) });
      out.push({ key, written: 0, refusals: [], awaitingFinal: 0, error: msg, skipped: false });
      continue;
    }
    try {
      const r = await oracleFor(d, key).settledSince(rule, sinceKey);
      const written = d.registry.putReadings(locked.rule.oracle, key, r.events, { settlementSourceUrl: r.settlementSourceUrl, attestedBy: [d.attester] }, now);
      recordWindowEnd(d, tokens.filter((x) => x.selectorKey === key), r);
      if (r.awaitingFinal > 0 && anchor === undefined) d.registry.setStatus(anchorKey, { since: sinceKey }, now);
      else if (r.awaitingFinal === 0 && anchor !== undefined) d.registry.setStatus(anchorKey, "", now);
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

/**
 * INDEPENDENT vs ORDERED readings (ChatGPT/Codex review N7, 2026-10-10). A binary rule, or a scalar rule against a FIXED baseline with no
 * carry, reads every event on its own: each one is identified by its event id, and any reading after the token's launch baseline that
 * has no receipt is planned — however late it became final, whatever the cursor says. An ORDERED scalar rule (baseline =
 * previousSettlement, or a carry across consecutive increases) measures each value against the last processed one, so a period that
 * turns up behind the cursor is NOT re-applied against the newest value (its change is already inside the next processed delta, and
 * re-applying it would corrupt the carry); it is surfaced as a `late-reading` alert instead, never silently.
 */
export function independentReadings(rule: BurnRule, carry: CarryPolicy): boolean {
  return rule.kind === "binary" || (rule.kind === "scalar" && !!rule.scalar && rule.scalar.baseline !== "previousSettlement" && carry === "none");
}

/** New readings for one token through the engine → receipt rows. Pure apart from the registry writes. */
export function planToken(d: KeeperDeps, t: TokenRow, locked: LockedRule, gate: PairGate | null = null): { mint: string; eventId: string; status: string }[] {
  const state = d.registry.state(t.mint);
  const after = state.lastSettledAt ?? t.baselineAt;
  const carry = carryFor(locked.rule);
  const independent = independentReadings(locked.rule, carry);
  const ahead = (r: { at: string; id: string }) => r.at > after || (r.at === after && state.lastEventId !== null && r.id > state.lastEventId);
  const unseen = d.registry.readings(t.selectorKey, t.baselineAt).filter((r) => readingMatches(locked.rule, r) && !d.registry.receipt(t.mint, r.id));
  const fresh: SettledEvent[] = independent ? unseen : unseen.filter(ahead);
  if (!independent) for (const r of unseen.filter((x) => !ahead(x))) {
    const text = `$${t.ticker} ${r.id} (${r.at}) arrived behind the settlement cursor (${after}); this rule measures each value against the last processed one, so the change through ${r.id} is already inside the next processed delta and is not applied again`;
    if (d.registry.recordAlert({ kind: "late-reading", key: `late-reading:${t.mint}:${r.id}`, text, meta: { mint: t.mint, eventId: r.id, at: r.at, cursor: after } }, d.now())) d.log(`  [late] ${text}`);
  }
  if (!fresh.length) return [];
  const steps = unitSteps(locked.rule, fresh, carry, { value: state.lastValue, carryOut: state.carryOut });
  const out: { mint: string; eventId: string; status: string }[] = [];
  let prev = { value: state.lastValue, carryOut: state.carryOut };
  for (const { event, step } of steps) {
    const wrote = d.registry.applyStep(t.mint, event, step, prev, locked.rule.kind === "scalar", d.now(), gatedStatus(step, gate));
    const row = d.registry.receipt(t.mint, event.id)!;
    if (wrote) { out.push({ mint: t.mint, eventId: event.id, status: row.status }); d.log(`  [plan] $${t.ticker} ${event.id}: ${step.note}${row.status === "planned" ? " → receipt planned" : row.status === "pending-pair" ? " → pending-pair (both or neither: waiting for both pools)" : row.status === "voided" ? " → voided (the pair voided: no event burn)" : ""}`); }
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
    // Burn Derby: the counted readings' proof hash (the Pyth update digests behind the window) goes into the signed message's proof=.
    // End-of-rule clock days: proof = sha256("clock|<date>|<rules sha256>") — date-based and deterministic, anyone recomputes it.
    const derbyProof = t.selectorKey.startsWith("derby:") ? derbyProofHash(ids.map((id) => reg.readings(t.selectorKey).find((r) => r.id === id)?.proof ?? null)) : undefined;
    const clockProof = counted.some((b) => END_KINDS.has(b.kind)) ? Buffer.from(clockProofHex(Ds, t.rulesSha), "hex") : undefined;
    const proofHash = derbyProof && clockProof ? Buffer.from(rulesSha256(`${Buffer.from(derbyProof).toString("hex")},${clockProof.toString("hex")}`), "hex") : derbyProof ?? clockProof;
    const tx = await port.buildReading({ recordDate: D, prevDate: cfg.hasBaseline ? cfg.lastRecordDate : 0, value, sourceUrl: counterSourceUrl(t.ticker, Ds, ids), feedId: cfg.feedId, valueDecimals: 0, ...(proofHash ? { proofHash } : {}) });
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
    // End-of-rule receipts (wind-down, drain, sweep) read no selector: a date-based clock — like a feed, the day only has to be over.
    const clockOnly = unassigned.filter((b) => receiptDay(b.settledAt) <= D).every((b) => END_KINDS.has(b.kind));
    if (D > today || (!isFeed && !clockOnly && (now < endMs + (d.readingGraceMs ?? READING_GRACE_MS) || (reg.feedState(t.selectorKey).lastOkAt ?? 0) < endMs))) {
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

/**
 * BOTH OR NEITHER (2026-10-10): the state of every clause pair, per mint. A pair goes LIVE the first cycle both sides' TokenConfigs name a
 * registered pool before its voidBy date ends — its pending-pair receipts become planned (they execute in settlement order); it VOIDS if
 * either side is still unregistered when voidBy ends — its pending-pair receipts become voided and the rule ends (both coins wind down).
 * Both outcomes are written once (registry pair_outcomes). A dry run computes the state and writes nothing.
 */
export async function pairGates(d: KeeperDeps): Promise<Map<string, { gate: PairGate; pairId: string; side: "A" | "B" }>> {
  const out = new Map<string, { gate: PairGate; pairId: string; side: "A" | "B" }>();
  const now = d.now();
  for (const pr of d.registry.pairs()) {
    const ta = d.registry.token(pr.mintA), tb = d.registry.token(pr.mintB);
    if (!ta || !tb) continue;
    let clause;
    try { clause = pairClause(d.registry.lockedRule(ta).rule); } catch { continue; }
    if (!clause) continue;
    let gate: PairGate;
    const have = d.registry.pairOutcome(pr.pairId);
    if (have) gate = have.state === "live" ? { state: "live" } : { state: "voided", atMs: have.at };
    else {
      const registered = async (mint: string) => { try { return (await d.program.port(mint).config())?.poolRegistered === true; } catch { return false; } };
      const [ra, rb] = [await registered(pr.mintA), await registered(pr.mintB)];
      const voidAt = voidByEndMs(clause.voidBy);
      if (ra && rb && now < voidAt) {
        gate = { state: "live" };
        if (!d.dryRun) {
          d.registry.recordPairOutcome(pr.pairId, "live", now, "both pools registered");
          const n = d.registry.promotePendingPair(pr.mintA, now) + d.registry.promotePendingPair(pr.mintB, now);
          d.log(`  [pair] ${pr.pairId}: LIVE — both pools registered${n ? `; ${n} pending-pair receipt(s) now planned, in settlement order` : ""}`);
        }
      } else if (now >= voidAt) {
        gate = { state: "voided", atMs: voidAt };
        if (!d.dryRun) {
          const why = `pair voided: ${[!ra ? `$${ta.ticker}` : null, !rb ? `$${tb.ticker}` : null].filter(Boolean).join(" and ")} had no registered pool when ${clause.voidBy} ended (UTC)`;
          d.registry.recordPairOutcome(pr.pairId, "voided", voidAt, why);
          const n = d.registry.voidPendingPair(pr.mintA, why, now) + d.registry.voidPendingPair(pr.mintB, why, now);
          d.log(`  [pair] ${pr.pairId}: VOIDED — ${why}${n ? `; ${n} pending-pair receipt(s) voided` : ""}; the rule has ended: both coins wind down (onEnd)`);
        }
      } else gate = { state: "waiting", waitingOn: [...(ra ? [] : ["A" as const]), ...(rb ? [] : ["B" as const])], voidBy: clause.voidBy };
    }
    out.set(pr.mintA, { gate, pairId: pr.pairId, side: "A" });
    out.set(pr.mintB, { gate, pairId: pr.pairId, side: "B" });
  }
  return out;
}

export const END_KINDS: ReadonlySet<string> = new Set(["winddown", "drain", "sweep"]);
/** The proof a clock day's attestation commits to (date-based, deterministic): sha256("clock|<YYYY-MM-DD>|<rules sha256>"). */
export const clockProofHex = (date: string, rulesSha: string): string => rulesSha256(`clock|${date}|${rulesSha}`);
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDay = (date: string, n: number): string => isoDay(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS);

/** The latest crank the program processed for a token (its lead receipt): what it carried out, and whether it fell under the floor. */
function lastCrank(d: KeeperDeps, mint: string): { carriedOut: bigint; skipped: boolean } | null {
  const leads = d.registry.receipts(mint).filter((b) => b.lead === true && b.readingDate !== null).sort((a, b) => (b.readingDate ?? 0) - (a.readingDate ?? 0));
  const l = leads[0];
  return l ? { carriedOut: l.carriedOutLamports ?? BigInt(0), skipped: l.status === "skipped" } : null;
}

/**
 * WHY AND WHEN A RULE ENDED (no burn pool is ever left behind; rules.ts onEnd): a pair voided, a one-shot settled (YES / NO / void), a
 * derby finished (the adapter's hook), or an adapter's explicit mark (registry.markRuleEnded: a team's season over, a nominee replaced).
 * A one-shot YES at 100 % ends in a DRAIN; everything else in a WIND-DOWN. Written once.
 */
export function detectRuleEnd(d: KeeperDeps, t: TokenRow, locked: LockedRule, gate: PairGate | null): { mode: "drain" | "winddown"; reason: string; at: number } | null {
  const have = d.registry.ruleEnd(t.mint);
  if (have) return have;
  // A clause pair that is still waiting for its second pool has not ended: its pending-pair receipts resolve first (live or void).
  if (gate?.state === "waiting" || d.registry.receipts(t.mint).some((b) => b.status === "pending-pair")) return null;
  let end: { mode: "drain" | "winddown"; reason: string; at: number } | null = null;
  if (gate?.state === "voided") end = { mode: "winddown", reason: "the pair voided (both or neither)", at: gate.atMs };
  else if (isOneShot(locked.rule)) {
    const ev = d.registry.receipts(t.mint).filter((b) => !END_KINDS.has(b.kind) && b.status !== "pending-pair")[0];
    if (ev) {
      const all = ev.units > 0 && ev.status !== "voided" && (ev.mapping?.fractionOfPool ?? 0) >= 1;
      end = { mode: all ? "drain" : "winddown", reason: all ? `the one-shot settled ${(ev.result ?? "YES").toUpperCase()} at 100 % of the pool` : `the one-shot settled ${(ev.result ?? ev.kind).toUpperCase()}`, at: Date.parse(ev.settledAt) || d.now() };
    }
  } else if (d.derby?.ended && t.selectorKey.startsWith("derby:")) {
    const x = d.derby.ended(t);
    if (x) end = { mode: "winddown", reason: x.reason, at: x.atMs };
  }
  if (!end) return null;
  if (end.mode === "winddown" && !locked.rule.onEnd) return null;   // a rule made before the clause has no wind-down
  if (d.dryRun) return end;
  const rec = d.registry.markRuleEnded(t.mint, end.mode, end.reason, end.at);
  d.log(`  [end] $${t.ticker}: the rule ENDED — ${rec.reason}; ${rec.mode === "drain" ? "the pool drains (one unit a day at 100 %)" : `the pool winds down over ${locked.rule.onEnd!.windDownDays} days`}`);
  return rec;
}

/**
 * The end-of-rule receipts due by now, and the retirement once they are done:
 *   drain     one "drain-<date>" unit a day from the day after the YES (each unit's rule spend is the whole pool) while the program's last
 *             crank carried spend forward and nothing is pending; done when a crank carries nothing more or falls under the floor.
 *   winddown  "winddown-<date>" for each of the `windDownDays` days from the first day after the end, windDownUnits(f, days) units each;
 *             then (cap-bound tail) one more day at a time while the last crank still carried spend; done when it carries nothing.
 *   sweep     a RETIRED coin whose fee PDA (minus the reserve) passed onEnd.sweepThresholdLamports: "sweep-<date>" of full-spend units,
 *             continued day by day while the cap carries spend; at most one sweep START per SWEEP_EVERY_DAYS.
 * Buyback mode only (a vault rule has no pool to spend). Every amount is the program's, on the receipts.
 */
export async function planRuleEnd(d: KeeperDeps, t: TokenRow, locked: LockedRule, gate: PairGate | null): Promise<{ mint: string; eventId: string; status: string }[]> {
  const reg = d.registry, rule = locked.rule, out: { mint: string; eventId: string; status: string }[] = [];
  if (locked.mode !== "buyback") return out;
  const end = detectRuleEnd(d, t, locked, gate);
  if (!end || d.dryRun) return out;
  const f = ruleMappings(rule)[0]?.mapping.fractionOfPool ?? 0;
  if (!(f > 0)) return out;
  const today = isoDay(d.now());
  const add = (kind: EndReceiptKind, date: string, units: number): void => {
    const id = `${kind}-${date}`;
    const step = endStep(rule, kind, units);
    if (reg.addEndReceipt(t.mint, kind, { id, at: `${date}T00:00:00Z` }, step, d.now())) { out.push({ mint: t.mint, eventId: id, status: "planned" }); d.log(`  [plan] $${t.ticker} ${id}: ${step.note} → receipt planned`); }
  };
  const mine = (kind: EndReceiptKind) => reg.receipts(t.mint).filter((b) => b.kind === kind).map((b) => b.eventId.slice(kind.length + 1)).sort();
  const quiet = () => reg.pending(t.mint).length === 0;
  const lc = () => lastCrank(d, t.mint);
  const carrying = () => { const c = lc(); return !!c && !c.skipped && c.carriedOut > BigInt(0); };
  let done = false;
  if (end.mode === "drain") {
    const days = mine("drain");
    const next = days.length ? addDay(days[days.length - 1], 1) : firstWindDownDay(end.at + 1);
    if (quiet()) {
      const c = lc();
      const more = days.length === 0 ? !!c && !c.skipped && c.carriedOut > BigInt(0) : carrying();
      if (more && next <= today && days.length < 365) add("drain", next, 1);
      else if (!more) done = true;
    }
  } else {
    const N = rule.onEnd!.windDownDays, n = windDownUnits(f, N), first = firstWindDownDay(end.at);
    for (let i = 0; i < N; i++) { const day = addDay(first, i); if (day > today) break; add("winddown", day, n); }
    const days = mine("winddown");
    if (days.length >= N && quiet()) {
      if (carrying() && days.length < N + 365) { const next = addDay(days[days.length - 1], 1); if (next <= today) add("winddown", next, n); }
      else if (!carrying()) done = true;
    }
  }
  if (done && t.status !== "retired") {
    reg.setTokenStatus(t.mint, "retired");
    reg.setStatus(`rule.retired.${t.mint}`, JSON.stringify({ reason: end.reason, at: d.now(), mode: end.mode }));
    d.log(`  [end] $${t.ticker} RETIRED — ${end.mode === "drain" ? "the pool is drained" : "the wind-down is done"} (${end.reason})`);
  }
  // The retired-coin sweep.
  if ((done || t.status === "retired") && rule.onEnd && quiet()) {
    const sweeps = mine("sweep");
    const startKey = `sweep.start.${t.mint}`, lastStart = reg.getStatus(startKey);
    const continuing = sweeps.length > 0 && lastStart !== null && carrying();
    if (continuing) { const next = addDay(sweeps[sweeps.length - 1], 1); if (next <= today) add("sweep", next, fullSpendUnits(f)); }
    else if (!lastStart || Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastStart}T00:00:00Z`) >= SWEEP_EVERY_DAYS * DAY_MS) {
      const bal = await d.program.feePdaBalanceLamports(t.mint).catch(() => BigInt(0));
      const spendable = bal - solToLamports(rule.reserveSol);
      if (spendable > BigInt(rule.onEnd.sweepThresholdLamports) && !sweeps.includes(today)) {
        add("sweep", today, fullSpendUnits(f));
        reg.setStatus(startKey, today);
        reg.setStatus(`rule.swept.${t.mint}`, today);
      }
    }
  }
  return out;
}

/** One full cycle over every live token (and, for the fallback clock, every retired coin of a voided pair). */
export async function runCycle(d: KeeperDeps, opts: { fetch?: boolean } = {}): Promise<CycleReport> {
  const live = d.registry.tokens("live");
  const errors: string[] = [];
  if (d.derby) { try { await d.derby.sample(live); } catch (e) { errors.push(`derby sampler: ${(e as Error).message.slice(0, 160)}`); } }
  const fetched = opts.fetch === false ? [] : await fetchDue(d, live);
  const gates = await pairGates(d).catch((e: Error) => { errors.push(`pair gates: ${e.message.slice(0, 160)}`); return new Map<string, { gate: PairGate; pairId: string; side: "A" | "B" }>(); });
  // Retired coins stay in the loop when their rule ended under onEnd: the wind-down's last cranks and the retired-coin sweep.
  const tokens = [...live, ...d.registry.tokens("retired").filter((t) => gates.get(t.mint)?.gate.state === "voided" || d.registry.ruleEnd(t.mint) !== null)];
  const planned: CycleReport["planned"] = [], executed: ExecOutcome[] = [];
  for (const t of tokens) {
    let locked: LockedRule;
    try { locked = d.registry.lockedRule(t); } catch (e) { errors.push(`$${t.ticker}: rule unreadable: ${(e as Error).message}`); continue; }
    if (selectorKeyOf(locked.rule) !== t.selectorKey) { errors.push(`$${t.ticker}: selector key drifted (${t.selectorKey} ≠ ${selectorKeyOf(locked.rule)})`); continue; }
    const gate = gates.get(t.mint)?.gate ?? null;
    if (locked.rule.oracle === "kalshi" && d.kalshiEnabled === false) continue;   // venue disabled: held (fetchDue raised the alert)
    try { if (t.status === "live" && !d.registry.ruleEnd(t.mint)) planned.push(...planToken(d, t, locked, gate)); } catch (e) { errors.push(`$${t.ticker}: plan: ${(e as Error).message.slice(0, 160)}`); continue; }
    try { executed.push(...await executePending(d, t, locked)); } catch (e) { errors.push(`$${t.ticker}: execute: ${(e as Error).message.slice(0, 160)}`); }
    // After the day's cranks: the end of the rule (drain / wind-down / retirement / sweep) is planned from what the program just did.
    try { planned.push(...await planRuleEnd(d, t, locked, gate)); } catch (e) { errors.push(`$${t.ticker}: end of rule: ${(e as Error).message.slice(0, 160)}`); }
    try { executed.push(...await executePending(d, t, locked)); } catch (e) { errors.push(`$${t.ticker}: execute: ${(e as Error).message.slice(0, 160)}`); }
  }
  for (const r of executed) if (r.outcome === "error") errors.push(`${r.mint.slice(0, 8)} ${r.eventId}: ${r.why}`);
  if (d.derby && !d.dryRun) { try { d.derby.plan(); } catch (e) { errors.push(`derby planning pass: ${(e as Error).message.slice(0, 160)}`); } }
  return { fetched, planned, executed, errors };
}
