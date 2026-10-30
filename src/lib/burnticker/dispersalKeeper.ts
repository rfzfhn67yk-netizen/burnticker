import type { ProgramPort } from "@/lib/burnKeeper/programPort";
import { addReading, behind, debtLine, keepReceipts, reconcile, stateFromJson, stateToJson, step, type Debt, type DispersalState } from "@/lib/burnticker/dispersal";

/**
 * BURN DISPERSAL — THE KEEPER STEP (owner decision 2026-10-13 night; the pure plan is dispersal.ts). One call per coin per keeper wake,
 * shared by the platform keeper (multiKeeper.ts runCycle, every cycle) and the $DEFICIT keeper (scripts/burn-keeper.mts, which also
 * wakes at the next piece's time). The two keepers decide apart (review 4 of A-1, 2026-10-18): the platform keeper through
 * dispersal.ts keeperDispersalStart (its unit sets BURNTICKER_DISPERSAL=1, and it refuses to start on a round-5 program without 1 or 0);
 * the $DEFICIT keeper only on its own explicit BURNTICKER_DISPERSAL=1 (dispersalEnabled), which it writes to DEFICIT_DISPERSAL_FILE at
 * start so the platform keeper's ops.json can say whether it is on.
 *
 *   1. RESOLVE first: a piece whose signature was written ahead of its send is looked up; until it is final no second piece is signed
 *      (it could land beside it). Landed → its own receipt (signature, the program's `carried` memo, the amount from the memo).
 *      Fourth prelaunch audit F10: a receipt's amount comes ONLY from its own transaction's memo, clamped to the piece's requested
 *      maximum. While the memo cannot be read the receipt is pending with no amount, and later wakes read it again (a few per wake).
 *      The change in the coin's carried balance is never a piece's spend: another cranker, a new reading or the rule's end path can
 *      move it in between. That balance still drives the debts and the next piece (steps 2 and 4), which follow the chain.
 *   2. ACCOUNT: a new crank cursor means a reading's crank landed; its Reading account says what it spent and carried, and the debts
 *      (one per reading not fully spent) drain oldest-first down to the chain's carried amount. The chain is the record.
 *   3. ALERT once per reading (bt-burn-behind) when it is not fully spent 24 hours after it landed.
 *   4. STEP (owner decision 2026-10-25: no per-run bound, no carried budget, so no windows): when the queue is empty and something is
 *      carried, ONE crank_carried piece for the whole carried amount (max_spend = the carried amount) is planned, simulated, written
 *      ahead, sent (the port's send: the private route when BURNTICKER_PRIVATE_SEND_URL is set), confirmed, and recorded. A "not now"
 *      refusal (TWAP, pool) is retried after RETRY_MS; any other refusal after REFUSED_RETRY_MS (the amount stays carried either way).
 *      The program's only pacing left is one piece per coin per second (CarriedTooSoon, a race with another cranker): the keeper then
 *      waits TOO_SOON_MIN_RETRY_MS.
 *
 * State lives in the caller's status table (registry / ledger `dispersal:<mint>`), JSON with bigints as strings.
 */

export const DISPERSAL_STATE_KEY = (mint: string): string => `dispersal:${mint}`;
const WAIT_ERRORS = new Set(["TwapDeviation", "TwapUnavailable", "PoolNotTradable", "EmptyReserves", "WsolBalanceMismatch", "ReadingPending"]);
export const RETRY_MS = 10 * 60_000;
/** After a refusal that is not "not now" (e.g. BelowFloor when the pool holds less than the floor and less than the carry), try again after this. */
export const REFUSED_RETRY_MS = 60 * 60_000;
/** The program's "nothing is carried" refusal: the carry was spent by another cranker or cleared by the rule's end path (after the grace). */
const NOTHING_CARRIED = /NothingCarried/;
/** What a refused or failed piece leaves behind, in the log's words (never "stays carried" when the chain says nothing is). */
const afterRefusal = (err: string): string => NOTHING_CARRIED.test(err) ? "nothing is carried on chain any more (spent by another cranker, or cleared by the rule's end path); there is nothing left to spend" : "the amount stays carried";
/** The program's refusal of a second piece in the same second as the coin's last one (Anchor error 6141). */
const TOO_SOON = /CarriedTooSoon|\b6141\b|0x17fd/;
/** After a CarriedTooSoon refusal, the next try is no sooner than this (a lagging cluster clock must not make the keeper retry every second). */
export const TOO_SOON_MIN_RETRY_MS = 30_000;
const Z = BigInt(0);

export interface DispersalDeps {
  port: ProgramPort;
  mint: string;
  ticker: string;
  load(): string | null;
  save(json: string): void;
  log(line: string): void;
  now(): number;
  dryRun: boolean;
  /** registry.recordAlert (deduped per key per day) — the $DEFICIT keeper logs instead when it has no registry. */
  alert?(a: DispersalAlert): void;
}

/**
 * The dispersal step's phone alerts: bt-burn-behind (a reading not fully spent a day after it landed), bt-dispersal-receipt (a
 * piece's receipt the keeper cannot settle from its own transaction: its memo unread after three days, or naming more than the piece
 * asked for). Both reach the phone through push.ts. (bt-dispersal-stuck, raised when no piece fitted a small pool under the old
 * per-run bound, was removed with that bound: owner decision 2026-10-25.)
 */
export interface DispersalAlert { kind: "bt-burn-behind" | "bt-dispersal-receipt"; key: string; text: string; meta: Record<string, unknown> | null }

export interface DispersalReport {
  action: "off" | "idle" | "wait" | "sent" | "landed" | "refused" | "dry-run";
  why?: string;
  signature?: string;
  spentLamports?: bigint;
  /** When the next wake is useful (a retry, or a look after a waiting reading); null when nothing is waiting on a time. */
  nextDueAt: number | null;
  lines: string[];
  behind: Debt | null;
}

/** "spent X of Y SOL for the reading of <date>; remainder being spent" for every reading not fully spent, oldest first. */
export function dispersalLines(json: string | null): string[] {
  return stateFromJson(json).debts.map(debtLine);
}

const spentFromMemo = (memo: string | null): bigint | null => {
  const m = memo ? /\|carried\|.*?\|spent=(\d+)\|/.exec(memo) : null;
  return m ? BigInt(m[1]) : null;
};
/** How many pending receipts one wake tries to read (each is one transaction lookup), least recently tried first. */
export const PENDING_READS_PER_WAKE = 3;
/** A pending receipt is read again only after min(2^tries minutes, 6 h) since its last try. */
export const PENDING_BACKOFF_MAX_MS = 6 * 3_600_000;
/** After this long since the piece landed, an unread memo is given up: one alert, no more lookups. */
export const PENDING_GIVE_UP_MS = 3 * 24 * 3_600_000;
export const pendingRetryDelayMs = (tries: number): number => Math.min(2 ** Math.min(tries, 30) * 60_000, PENDING_BACKOFF_MAX_MS);
/**
 * A piece's own spend, proven by its transaction's `carried` memo and clamped to what the piece asked for; null when the memo is not
 * readable (yet). `clamped` says the memo named more than the request: the program caps a piece's spend at its request, so this is a
 * program bug or the wrong memo picked. The receipt is marked and an alert is raised (clampAlert).
 */
async function provenSpend(port: ProgramPort, signature: string, requested: bigint | undefined): Promise<{ memo: string | null; spent: bigint | null; clamped: boolean }> {
  const memo = await port.memoOf(signature).catch(() => null);
  const m = spentFromMemo(memo);
  if (m === null) return { memo, spent: null, clamped: false };
  return requested !== undefined && m > requested ? { memo, spent: requested, clamped: true } : { memo, spent: m, clamped: false };
}
const NOT_READ = "spend not yet read";

export async function runDispersal(d: DispersalDeps): Promise<DispersalReport> {
  const now = d.now();
  let st: DispersalState = stateFromJson(d.load());
  const out = (r: Omit<DispersalReport, "lines" | "behind" | "nextDueAt"> & { nextDueAt?: number | null }): DispersalReport => {
    d.save(stateToJson(st));
    const due = r.nextDueAt !== undefined ? r.nextDueAt : null;
    return { ...r, nextDueAt: due, lines: st.debts.map(debtLine), behind: behind(st.debts, now) };
  };
  const port = d.port;
  const raise = (a: DispersalAlert): void => { if (d.alert) d.alert(a); d.log(`  [alert] ${a.kind} ${a.text}`); };
  const clampAlert = (signature: string, requested: bigint, p: { clamped: boolean; memo: string | null }): void => {
    if (!p.clamped) return;
    raise({ kind: "bt-dispersal-receipt", key: `${d.mint}:${signature}:clamped`, text: `$${d.ticker}: the burn dispersal piece ${signature} has a memo that names more than the piece asked for (${sol(requested)} SOL). Its receipt is recorded at the requested amount and marked for a look. The program should never allow this, so either the program or the memo the keeper read is wrong.`, meta: { mint: d.mint, signature, requestedLamports: requested.toString(), memo: p.memo, reason: "clamped" } });
  };
  if (!port.planCarried) return out({ action: "off", why: "this program client has no crank_carried" });
  const cfg = await port.config();

  // 1. RESOLVE the piece in flight — FIRST, before any lifecycle answer (third prelaunch audit F01): a piece signed before the rule
  // ended, before the pool went away or before a restart is still a signature that may land; it is reconciled to its own receipt (or
  // released) whatever the coin's state is now, so a landed piece is never lost and a dead one never blocks the plan.
  if (st.inflight) {
    const f = st.inflight;
    const [s] = await port.signatureStatuses([f.signature]);
    if (s && s.confirmed && !s.err) {
      // F10: the amount is the transaction's own (its memo), never f.carriedBefore − the carried balance now: another cranker, a new
      // reading or the end path may have moved that balance since the write-ahead. Unread memo → a pending receipt, read again later.
      const p = await provenSpend(port, f.signature, f.lamports);
      st = landed(st, f.signature, p, s.slot, now, f.lamports);
      clampAlert(f.signature, f.lamports, p);
      d.log(`  [dispersal] $${d.ticker}: a piece landed after a restart: ${p.spent !== null ? `${sol(p.spent)} SOL` : `${NOT_READ} (its transaction's memo is not readable yet; the piece asked for at most ${sol(f.lamports)} SOL); it is read again on later wakes`}${clampNote(p, f.lamports)} · ${f.signature}`);
    } else if (s && s.err) {
      st = { ...st, inflight: null };
      d.log(`  [dispersal] $${d.ticker}: the piece ${f.signature.slice(0, 12)}… failed on chain (${s.err.slice(0, 80)}); ${afterRefusal(s.err)}`);
    } else if ((await port.blockHeight()) > f.lastValidBlockHeight) {
      st = { ...st, inflight: null };
      d.log(`  [dispersal] $${d.ticker}: the piece ${f.signature.slice(0, 12)}… expired without landing; it is planned again`);
    } else return out({ action: "wait", why: `piece ${f.signature.slice(0, 12)}… not final yet`, nextDueAt: now + 15_000 });
  }

  // 1b. READ pending receipts (F10): a landed piece whose memo was not readable when it was recorded. Its amount is filled in only from
  // its own memo; until then it stays pending. A few per wake, least recently tried first, each only after its backoff
  // (min(2^tries minutes, 6 h) since the last try). Three days after the piece landed an unread memo is given up: one
  // bt-dispersal-receipt alert, no more lookups; the receipt stays pending with no amount. A dry run looks nothing up.
  const due = (r: DispersalState["receipts"][number]): boolean => r.status === "pending" && !r.gaveUpAt && now >= (r.checkedAt ?? r.at) + pendingRetryDelayMs(r.tries ?? 0);
  const pending = d.dryRun ? [] : st.receipts.filter(due).sort((a, b) => (a.checkedAt ?? a.at) - (b.checkedAt ?? b.at)).slice(0, PENDING_READS_PER_WAKE);
  for (const r of pending) {
    const p = await provenSpend(port, r.signature, r.requestedLamports);
    const tries = (r.tries ?? 0) + 1;
    const gaveUp = p.spent === null && now - r.at >= PENDING_GIVE_UP_MS;
    st = { ...st, receipts: st.receipts.map((x) => (x.signature !== r.signature ? x : p.spent !== null
      ? { ...x, status: "landed" as const, spentLamports: p.spent, memo: p.memo, checkedAt: now, tries, ...(p.clamped ? { clamped: true } : {}) }
      : { ...x, checkedAt: now, tries, ...(gaveUp ? { gaveUpAt: now } : {}) })) };
    if (p.spent !== null) {
      if (r.requestedLamports !== undefined) clampAlert(r.signature, r.requestedLamports, p);
      d.log(`  [dispersal] $${d.ticker}: the piece ${r.signature.slice(0, 12)}…'s spend is now read: ${sol(p.spent)} SOL${r.requestedLamports !== undefined ? clampNote(p, r.requestedLamports) : ""} · ${r.signature}`);
    } else if (gaveUp) {
      raise({ kind: "bt-dispersal-receipt", key: `${d.mint}:${r.signature}:unread`, text: `$${d.ticker}: spend not read for the burn dispersal piece ${r.signature} after three days and ${tries} tries. Its receipt has no amount and the keeper has stopped asking. The coin's carried total still matches the chain.`, meta: { mint: d.mint, signature: r.signature, tries, landedAt: r.at, reason: "unread" } });
    }
  }

  // LIFECYCLE. An ENDED rule is NOT a reason to stop (round-5 review R5-3 / R5-4, the program deployed on mainnet 2026-10-15):
  // crank_carried drains the carried spend after a VOID end (the wind-down's carry) and after a RESOLVED end, for which forward_on_end /
  // burn_sol_on_end leave the carry on the coin for 30 days. The keeper keeps accounting, alerting and spending pieces through the
  // normal TWAP / reserve checks until the chain shows nothing carried — drained here, or disposed by the end path after the
  // grace (the carry then reads 0 and the debts reconcile away).
  if (!cfg || cfg.mode !== "buyback" || cfg.burnsTarget || !cfg.poolRegistered) {
    return out({ action: "idle", why: !cfg ? "no program config" : cfg.mode !== "buyback" ? "not a buyback coin" : cfg.burnsTarget ? "a coin with a burn target" : "no pool registered" });
  }

  // 2. ACCOUNT: a reading's crank since the last look, then the chain's carried amount.
  if (cfg.crankCursor && cfg.crankCursor !== st.cursor) {
    const rd = await port.reading(cfg.crankCursor);
    if (rd?.processed) {
      const before = reconcile(st.debts, rd.carriedInLamports, st.cursor || cfg.crankCursor, now);
      st = { ...st, debts: addReading(before, { readingDate: cfg.crankCursor, landedAt: now, spentLamports: rd.spentLamports, carriedInLamports: rd.carriedInLamports, carriedOutLamports: rd.carriedOutLamports }) };
    }
    st = { ...st, cursor: cfg.crankCursor };
  }
  st = { ...st, debts: reconcile(st.debts, cfg.carriedSpendLamports, cfg.crankCursor, now) };

  // 3. ALERT once per reading.
  const late = behind(st.debts, now);
  if (late && st.alerted !== late.readingDate) {
    const text = `$${d.ticker}: the reading of ${day(late.readingDate)} is not fully spent a day after it landed. ${debtLine(late).replace(/^s/, "S")}.`;
    if (d.alert) d.alert({ kind: "bt-burn-behind", key: `${d.mint}:${late.readingDate}`, text, meta: { mint: d.mint, readingDate: late.readingDate, remainingLamports: late.remainingLamports.toString(), totalLamports: late.totalLamports.toString() } });
    d.log(`  [alert] bt-burn-behind ${text}`);
    st = { ...st, alerted: late.readingDate };
  }

  // 4. STEP: the whole carried amount in one piece.
  const queueEmpty = !cfg.hasBaseline || cfg.crankCursor === cfg.lastRecordDate;
  const a = step({ now, carriedLamports: cfg.carriedSpendLamports, queueEmpty });
  if (a.kind === "idle") { st = { ...st, retryAt: null }; return out({ action: "idle", why: a.why }); }
  if (a.kind === "wait") return out({ action: "wait", why: a.why, nextDueAt: a.untilMs });
  if (st.retryAt && now < st.retryAt) return out({ action: "wait", why: "the last piece was refused by the program; retrying", nextDueAt: st.retryAt });
  const lamports = a.lamports;
  if (d.dryRun) return out({ action: "dry-run", why: `would spend the carried ${sol(lamports)} SOL in one piece (crank_carried)`, nextDueAt: now + 60_000 });
  const plan = await port.planCarried(lamports);
  if ("status" in plan) return out({ action: "wait", why: plan.status, nextDueAt: plan.status === "too-soon" ? Math.max(plan.nextAtMs, now + 1_000) : now + RETRY_MS });
  const tx = await plan.build();
  const sim = await port.simulate(tx.raw);
  if (sim.err) {
    if (TOO_SOON.test(sim.err)) {
      // another piece landed in this second (a race with another cranker, or the cluster clock lags): never sooner than 30 s
      st = { ...st, retryAt: now + TOO_SOON_MIN_RETRY_MS };
      d.log(`  [dispersal] $${d.ticker}: a ${sol(lamports)} SOL piece refused in simulation: another piece ran this second; retrying in 30 s`);
      return out({ action: "wait", why: "CarriedTooSoon", nextDueAt: st.retryAt });
    }
    if (WAIT_ERRORS.has(sim.err) || port.retryableErrors?.has(sim.err)) {
      st = { ...st, retryAt: now + RETRY_MS };
      d.log(`  [dispersal] $${d.ticker}: a ${sol(lamports)} SOL piece deferred by the program (${sim.err}); retrying in 10 min`);
      return out({ action: "wait", why: sim.err, nextDueAt: now + RETRY_MS });
    }
    if (NOTHING_CARRIED.test(sim.err)) {
      d.log(`  [dispersal] $${d.ticker}: a ${sol(lamports)} SOL piece refused in simulation (${sim.err}): ${afterRefusal(sim.err)}`);
      return out({ action: "refused", why: sim.err, nextDueAt: null });
    }
    st = { ...st, retryAt: now + REFUSED_RETRY_MS };
    d.log(`  [dispersal] $${d.ticker}: a ${sol(lamports)} SOL piece refused in simulation (${sim.err}); it stays carried and is tried again in an hour`);
    return out({ action: "refused", why: sim.err, nextDueAt: st.retryAt });
  }
  // write-ahead: the signature is on record before the send
  st = { ...st, retryAt: null, inflight: { signature: tx.signature, lastValidBlockHeight: tx.lastValidBlockHeight, lamports, carriedBefore: cfg.carriedSpendLamports, sentAt: now } };
  d.save(stateToJson(st));
  try { await port.send(tx.raw); } catch (e) { d.log(`  [dispersal] $${d.ticker}: send raised ${(e as Error).message.slice(0, 120)}; the signature is on record and will be resolved`); }
  const c = await port.confirm(tx);
  if (c.status === "expired") return out({ action: "sent", signature: tx.signature, why: "not confirmed yet", nextDueAt: now + 15_000 });
  if (c.status === "failed") {
    st = { ...st, inflight: null };
    if (TOO_SOON.test(c.err)) {
      // lost a race to another cranker's piece in the same second; the piece is not given up (never sooner than 30 s)
      st = { ...st, retryAt: now + TOO_SOON_MIN_RETRY_MS };
      d.log(`  [dispersal] $${d.ticker}: the piece was refused on chain: another piece ran this second; retrying in 30 s`);
      return out({ action: "wait", why: "CarriedTooSoon", signature: tx.signature, nextDueAt: st.retryAt });
    }
    const nothing = NOTHING_CARRIED.test(c.err);
    if (!nothing) st = { ...st, retryAt: now + (WAIT_ERRORS.has(c.err) || port.retryableErrors?.has(c.err) ? RETRY_MS : REFUSED_RETRY_MS) };
    d.log(`  [dispersal] $${d.ticker}: the piece failed on chain (${c.err.slice(0, 80)}); ${afterRefusal(c.err)}`);
    return out({ action: "refused", why: c.err, signature: tx.signature, nextDueAt: nothing ? null : st.retryAt });
  }
  // F10: the receipt's amount is the memo's (clamped to the request); the carried balance after only reconciles the debts (aggregate)
  const p = await provenSpend(port, tx.signature, lamports);
  const after = await port.config();
  st = landed(st, tx.signature, p, c.slot, now, lamports);
  clampAlert(tx.signature, lamports, p);
  if (after) st = { ...st, debts: reconcile(st.debts, after.carriedSpendLamports, after.crankCursor, now) };
  const what = p.spent !== null ? `spent ${sol(p.spent)} SOL of the carried amount` : `a piece of at most ${sol(lamports)} SOL landed; ${NOT_READ} (its transaction's memo is not readable yet; it is read again on later wakes)`;
  d.log(`  [dispersal] $${d.ticker}: ${what}${clampNote(p, lamports)} (one piece for the whole carried amount) · ${tx.signature}${p.memo ? ` · ${p.memo}` : ""}`);
  // the piece spends min(carried, max, pool): a remainder only when the pool held less than the carry; look again after the retry delay
  const left = after ? after.carriedSpendLamports : Z;
  return out({ action: "landed", signature: tx.signature, ...(p.spent !== null ? { spentLamports: p.spent } : { why: NOT_READ }), nextDueAt: left > Z ? now + RETRY_MS : null });
}

const clampNote = (p: { clamped: boolean }, requested: bigint): string => (p.clamped ? ` (its memo named more than the piece asked for; recorded at the requested ${sol(requested)} SOL)` : "");

/** Records a landed piece. `spent` is the transaction's proven amount, or null (a pending receipt read again on later wakes). */
function landed(st: DispersalState, signature: string, p: { spent: bigint | null; memo: string | null; clamped: boolean }, slot: number | null, now: number, requested: bigint): DispersalState {
  const { spent, memo } = p;
  const receipt = spent !== null
    ? { signature, at: now, spentLamports: spent, status: "landed" as const, requestedLamports: requested, ...(p.clamped ? { clamped: true } : {}), throughDate: st.cursor, memo, slot }
    : { signature, at: now, spentLamports: null, status: "pending" as const, requestedLamports: requested, checkedAt: now, tries: 1, throughDate: st.cursor, memo, slot };
  return { ...st, inflight: null, receipts: keepReceipts([...st.receipts.filter((r) => r.signature !== signature), receipt]) };
}

const sol = (l: bigint): string => (Number(l) / 1e9).toFixed(4);
const day = (d: number): string => { const s = String(d); return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s; };
