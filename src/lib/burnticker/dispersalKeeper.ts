import type { ProgramPort } from "@/lib/burnKeeper/programPort";
import { CARRIED_BUDGET_WINDOW_SECS } from "@/lib/burnReceipts/constants";
import { carriedBudgetReadySec } from "@/lib/burnReceipts/math";
import { addReading, behind, debtLine, markChunk, nextDueAt, RECEIPTS_KEPT, reconcile, seedOf, stateFromJson, stateToJson, step, type Debt, type DispersalState } from "@/lib/burnticker/dispersal";

/**
 * BURN DISPERSAL — THE KEEPER STEP (owner decision 2026-10-13 night; the pure plan is dispersal.ts). One call per coin per keeper wake,
 * shared by the platform keeper (multiKeeper.ts runCycle, every cycle) and the $DEFICIT keeper (scripts/burn-keeper.mts, which also
 * wakes at the next piece's time). Behind BURNTICKER_DISPERSAL=1 in both: off until crank_carried is deployed.
 *
 *   1. RESOLVE first: a piece whose signature was written ahead of its send is looked up; until it is final no second piece is signed
 *      (it could land beside it). Landed → its own receipt (signature, the program's `carried` memo, the amount from the memo).
 *   2. ACCOUNT: a new crank cursor means a reading's crank landed; its Reading account says what it spent and carried, and the debts
 *      (one per reading not fully spent) drain oldest-first down to the chain's carried amount. The chain is the record.
 *   3. ALERT once per reading (bt-burn-behind) when it is not fully spent 24 hours after it landed.
 *   4. STEP the scheduler: a due piece is planned (crank_carried), simulated, written ahead, sent (the port's send: the private route when
 *      BURNTICKER_PRIVATE_SEND_URL is set), confirmed, and recorded. A "not now" refusal (TWAP, pool) waits ten minutes; any other
 *      refusal gives the piece up (what it would have spent stays carried and rolls into the plan).
 *      Round-5 review R5-8: the program spends carried pieces from a per-coin budget (one per-crank cap per CARRIED_BUDGET_WINDOW_SECS,
 *      up to one cap; one piece per second; CarriedPace). The keeper reads the budget (anyone's pieces spend it: cranking is
 *      permissionless) on the CHAIN's clock and WAITS until its piece fits — before planning, on the port's "too-soon" answer, and on a
 *      CarriedTooSoon refusal in simulation or on chain (a race with another cranker; then never sooner than 30 s) — so a piece is never
 *      given up for the budget. A dust piece by someone else takes only a dust budget: the keeper's piece waits seconds, not a window.
 *
 * State lives in the caller's status table (registry / ledger `dispersal:<mint>`), JSON with bigints as strings.
 */

export const DISPERSAL_STATE_KEY = (mint: string): string => `dispersal:${mint}`;
const WAIT_ERRORS = new Set(["TwapDeviation", "TwapUnavailable", "PoolNotTradable", "EmptyReserves", "WsolBalanceMismatch", "ReadingPending"]);
const RETRY_MS = 10 * 60_000;
/** Round-5 review R5-8: the program's refusal of a piece inside the interval (Anchor error 6141). */
const TOO_SOON = /CarriedTooSoon|\b6141\b|0x17fd/;
/** After a CarriedTooSoon refusal, the next try is no sooner than this (a lagging cluster clock must not make the keeper retry every second). */
export const TOO_SOON_MIN_RETRY_MS = 30_000;
/** The program's per-crank cap on this reserve (MAX_SPEND_RESERVE_BPS, 2 %): the budget's refill rate per window. */
const capOf = (reserve: bigint): bigint => (reserve * BigInt(200)) / BigInt(10_000);
/**
 * How long until a piece of `lamports` fits the coin's carried budget (ms; 0 = now), measured on the chain's clock and turned into a wait
 * on the local one; null when the port cannot tell (the plan's "too-soon" and the program's refusal tell then).
 */
async function budgetWaitMs(port: ProgramPort, lamports: bigint, reserve: bigint, now: number): Promise<number | null> {
  if (!port.carriedPace) return null;
  const p = await port.carriedPace().catch(() => null);
  if (!p) return null;
  const chainNow = p.chainNowSec ?? Math.floor(now / 1000);
  const ready = carriedBudgetReadySec(p.lastCarriedAt, p.budgetLamports, capOf(reserve), lamports, chainNow);
  return ready === null ? null : (ready - chainNow) * 1000;
}
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
  alert?(a: { kind: "bt-burn-behind"; key: string; text: string; meta: Record<string, unknown> | null }): void;
}

export interface DispersalReport {
  action: "off" | "idle" | "wait" | "sent" | "landed" | "refused" | "dry-run";
  why?: string;
  signature?: string;
  spentLamports?: bigint;
  /** When the next wake is useful (the next piece's time, a retry, or the window's end); null when nothing is carried. */
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

export async function runDispersal(d: DispersalDeps): Promise<DispersalReport> {
  const now = d.now();
  let st: DispersalState = stateFromJson(d.load());
  const out = (r: Omit<DispersalReport, "lines" | "behind" | "nextDueAt"> & { nextDueAt?: number | null }): DispersalReport => {
    d.save(stateToJson(st));
    const due = r.nextDueAt !== undefined ? r.nextDueAt : nextDueAt(st.window);
    return { ...r, nextDueAt: due, lines: st.debts.map(debtLine), behind: behind(st.debts, now) };
  };
  const port = d.port;
  if (!port.planCarried || !port.poolSolReserve) return out({ action: "off", why: "this program client has no crank_carried" });
  const cfg = await port.config();
  if (!cfg || cfg.mode !== "buyback" || cfg.burnsTarget || cfg.ruleEnded || !cfg.poolRegistered) {
    st = { ...st, window: null };
    return out({ action: "idle", why: !cfg ? "no program config" : cfg.mode !== "buyback" ? "not a buyback coin" : cfg.burnsTarget ? "a coin with a burn target" : cfg.ruleEnded ? "the rule has ended" : "no pool registered" });
  }

  // 1. RESOLVE the piece in flight.
  if (st.inflight) {
    const f = st.inflight;
    const [s] = await port.signatureStatuses([f.signature]);
    if (s && s.confirmed && !s.err) {
      const memo = await port.memoOf(f.signature);
      const spent = spentFromMemo(memo) ?? (f.carriedBefore > cfg.carriedSpendLamports ? f.carriedBefore - cfg.carriedSpendLamports : Z);
      st = landed(st, f.signature, spent, memo, s.slot, now, f.chunkIndex);
      d.log(`  [dispersal] $${d.ticker}: a piece landed after a restart: ${sol(spent)} SOL · ${f.signature}`);
    } else if (s && s.err) {
      if (st.window && st.window.done === f.chunkIndex) st = { ...st, window: markChunk(st.window, Z) };
      st = { ...st, inflight: null };
      d.log(`  [dispersal] $${d.ticker}: the piece ${f.signature.slice(0, 12)}… failed on chain (${s.err.slice(0, 80)}); the amount stays carried`);
    } else if ((await port.blockHeight()) > f.lastValidBlockHeight) {
      st = { ...st, inflight: null };
      d.log(`  [dispersal] $${d.ticker}: the piece ${f.signature.slice(0, 12)}… expired without landing; it is planned again`);
    } else return out({ action: "wait", why: `piece ${f.signature.slice(0, 12)}… not final yet`, nextDueAt: now + 15_000 });
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

  // 4. STEP.
  const reserve = await port.poolSolReserve();
  if (reserve === null) return out({ action: "idle", why: "the pool's reserve cannot be read" });
  const queueEmpty = !cfg.hasBaseline || cfg.crankCursor === cfg.lastRecordDate;
  const s = step(st.window, { now, carriedLamports: cfg.carriedSpendLamports, reserveLamports: reserve, queueEmpty, floorLamports: cfg.floorLamports, seed: seedOf(`${d.mint}:${now}`) });
  st = { ...st, window: s.window };
  if (s.action.kind === "idle") return out({ action: "idle", why: s.action.why });
  if (s.action.kind === "wait") return out({ action: "wait", why: s.action.why, nextDueAt: s.action.untilMs });
  if (st.retryAt && now < st.retryAt) return out({ action: "wait", why: "a piece was deferred by the program; retrying", nextDueAt: st.retryAt });
  const lamports = s.action.lamports, idx = s.action.chunkIndex;
  // R5-8: the piece must fit the coin's carried budget (earlier pieces, this keeper's or anyone's, spent from it): wait until it does.
  const wait = await budgetWaitMs(port, lamports, reserve, now);
  if (wait !== null && wait > 0) return out({ action: "wait", why: "the program's carried budget refills (one cap per 600 s)", nextDueAt: now + wait });
  if (d.dryRun) return out({ action: "dry-run", why: `would spend ${sol(lamports)} SOL of the carried ${sol(cfg.carriedSpendLamports)} SOL (crank_carried)`, nextDueAt: now + 60_000 });
  const plan = await port.planCarried(lamports);
  if ("status" in plan) return out({ action: "wait", why: plan.status, nextDueAt: plan.status === "too-soon" ? Math.max(plan.nextAtMs, now + 1_000) : now + RETRY_MS });
  const tooSoonRetry = async (): Promise<number> => now + Math.max(TOO_SOON_MIN_RETRY_MS, (await budgetWaitMs(port, lamports, reserve, now)) ?? CARRIED_BUDGET_WINDOW_SECS * 1000);
  const tx = await plan.build();
  const sim = await port.simulate(tx.raw);
  if (sim.err) {
    if (TOO_SOON.test(sim.err)) {
      // another piece landed since the budget was read (or the cluster clock lags): wait for the budget, never sooner than 30 s
      st = { ...st, retryAt: await tooSoonRetry() };
      d.log(`  [dispersal] $${d.ticker}: a ${sol(lamports)} SOL piece waits for the program's carried budget (another piece spent it); retrying then`);
      return out({ action: "wait", why: "CarriedTooSoon", nextDueAt: st.retryAt });
    }
    if (WAIT_ERRORS.has(sim.err) || port.retryableErrors?.has(sim.err)) {
      st = { ...st, retryAt: now + RETRY_MS };
      d.log(`  [dispersal] $${d.ticker}: a ${sol(lamports)} SOL piece deferred by the program (${sim.err}); retrying in 10 min`);
      return out({ action: "wait", why: sim.err, nextDueAt: now + RETRY_MS });
    }
    if (st.window) st = { ...st, window: markChunk(st.window, Z) };
    d.log(`  [dispersal] $${d.ticker}: a ${sol(lamports)} SOL piece refused in simulation (${sim.err}); it stays carried and the plan moves on`);
    return out({ action: "refused", why: sim.err });
  }
  // write-ahead: the signature is on record before the send
  st = { ...st, retryAt: null, inflight: { signature: tx.signature, lastValidBlockHeight: tx.lastValidBlockHeight, lamports, carriedBefore: cfg.carriedSpendLamports, sentAt: now, chunkIndex: idx } };
  d.save(stateToJson(st));
  try { await port.send(tx.raw); } catch (e) { d.log(`  [dispersal] $${d.ticker}: send raised ${(e as Error).message.slice(0, 120)}; the signature is on record and will be resolved`); }
  const c = await port.confirm(tx);
  if (c.status === "expired") return out({ action: "sent", signature: tx.signature, why: "not confirmed yet", nextDueAt: now + 15_000 });
  if (c.status === "failed") {
    st = { ...st, inflight: null };
    if (TOO_SOON.test(c.err)) {
      // R5-8: lost a race to another cranker's piece; the piece is not given up, it waits for the budget (never sooner than 30 s)
      st = { ...st, retryAt: await tooSoonRetry() };
      d.log(`  [dispersal] $${d.ticker}: the piece was refused on chain over the program's carried budget; retrying then`);
      return out({ action: "wait", why: "CarriedTooSoon", signature: tx.signature, nextDueAt: st.retryAt });
    }
    if (st.window) st = { ...st, window: markChunk(st.window, Z) };
    d.log(`  [dispersal] $${d.ticker}: the piece failed on chain (${c.err.slice(0, 80)}); the amount stays carried`);
    return out({ action: "refused", why: c.err, signature: tx.signature });
  }
  const memo = await port.memoOf(tx.signature);
  const after = await port.config();
  const spent = spentFromMemo(memo) ?? (after && cfg.carriedSpendLamports > after.carriedSpendLamports ? cfg.carriedSpendLamports - after.carriedSpendLamports : lamports);
  st = landed(st, tx.signature, spent, memo, c.slot, now, idx);
  if (after) st = { ...st, debts: reconcile(st.debts, after.carriedSpendLamports, after.crankCursor, now) };
  d.log(`  [dispersal] $${d.ticker}: spent ${sol(spent)} SOL of the carried amount (piece ${idx + 1} of ${st.window?.chunks.length ?? "?"} this window) · ${tx.signature}${memo ? ` · ${memo}` : ""}`);
  return out({ action: "landed", signature: tx.signature, spentLamports: spent });
}

function landed(st: DispersalState, signature: string, spent: bigint, memo: string | null, slot: number | null, now: number, chunkIndex: number): DispersalState {
  const window = st.window && st.window.done === chunkIndex ? markChunk(st.window, spent, now) : st.window ? { ...st.window, expectedCarried: st.window.expectedCarried - spent, lastAtMs: now } : null;
  const receipts = [...st.receipts, { signature, at: now, spentLamports: spent, throughDate: st.cursor, memo, slot }].slice(-RECEIPTS_KEPT);
  return { ...st, window, inflight: null, receipts };
}

const sol = (l: bigint): string => (Number(l) / 1e9).toFixed(4);
const day = (d: number): string => { const s = String(d); return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s; };
