import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { LastReading, PlanStep } from "@/lib/burnKeeper/plan";
import { usdToCents } from "@/lib/burnKeeper/rules";

/**
 * THE KEEPER'S LEDGER — data/burnkeeper.db (node:sqlite, like every other service here; 2026-10-09). One writer: the keeper.
 *
 *   readings    every processed reading: the value, the delta, the carry in/out, the units and what was decided (baseline /
 *               nothing / burn). Primary key (token, feed, record_date). The status page's debt curve is drawn from it.
 *   burns       one row per burned record_date — THE IDEMPOTENCY KEY (token, feed, record_date): a second plan for a date
 *               cannot make a second row, so it cannot make a second burn. Status planned → sending → confirmed (or exhausted: the
 *               vault's whole allocation is already burned). The settlement — owed, burned, SHORTFALL in/out (the vesting vault,
 *               10-09 evening) — and the canonical memo are fixed on the row at the first send attempt; every retry sends those
 *               same bytes.
 *   signatures  every transaction ever signed for a burn, WRITTEN BEFORE IT IS SENT (write-ahead): signature, the memo it carried,
 *               its blockhash and lastValidBlockHeight. On restart the keeper resolves each one — landed, failed, or expired —
 *               before it will sign anything new for that date. This is the line that stops a crash between "sent" and
 *               "recorded" from burning a date twice (the 09-08 live-restart double-buy lesson, applied to burns).
 *   status      key/value: the identity this ledger is bound to (cluster genesis hash, mint, vault, keeper, rules sha), the last
 *               poll and its outcome, the last error — read by the status page and the logs.
 *
 * BOUND TO ONE CLUSTER/MINT/VAULT. The first run writes the identity; any later run whose identity differs is refused — a devnet
 * ledger pointed at mainnet (or at another mint) would otherwise believe dates were burned that never were, or the reverse.
 */

export interface ReadingRow {
  token: string; feed: string; recordDate: string; amount: string; cents: bigint;
  deltaCents: bigint | null; carryInCents: bigint; carryOutCents: bigint; units: number;
  kind: "baseline" | "nothing" | "burn"; reason: string | null; fetchedAt: number;
}

/**
 * planned → sending → confirmed (vault mode); planned → swap-sent → swapped → sending → confirmed (buyback mode). Final: confirmed,
 * exhausted (vault allocation used up), skipped (buyback: the day's spend was under the floor or the pool was empty — nothing bought).
 */
export type BurnStatus = "planned" | "swap-sent" | "swapped" | "sending" | "confirmed" | "exhausted" | "skipped";

/**
 * PROGRAM EXECUTION (2026-10-10, docs/burnkeeper/README-execution.md): with BURNKEEPER_EXECUTION=program the burn row records what the
 * burn_receipts program did, read back from its Reading account after the crank landed — never computed by the keeper:
 *   chainOutcome  the Reading's outcome (burned / short / below-floor / exhausted / no-units)
 *   chainUnits    the units the PROGRAM counted (normally = units; a difference is logged and the chain wins)
 *   ruleSpend / carriedIn / carriedOut  the rule's spend and the spend carried across cranks (only under the floor, past a 30-day
 *                 untradeable pool, or with a zero minimum output; the per-run 2 % bound was removed by the owner decision of 2026-10-25,
 *                 so rows from before then may show a remainder carried after a burn)
 *   poolActual    the whole spendable pool; equals poolLamports since the burn-pool cap was removed (rows from before may differ)
 *   swapPool      the CPMM pool the program swapped on (the v2 memo's swap= field is its first 12 characters)
 *   waitReason    why the crank is waiting (TWAP history, no pool registered, pool not tradable) — a WAIT, not an error
 */
export interface ProgramFacts {
  chainOutcome: string | null; chainUnits: number | null; ruleSpendLamports: bigint | null; carriedInLamports: bigint | null; carriedOutLamports: bigint | null;
  poolActualLamports: bigint | null; swapPool: string | null; waitReason: string | null; execution: "legacy" | "program" | null;
}
export interface BurnRow extends ProgramFacts {
  token: string; feed: string; recordDate: string; prevDate: string;
  prevCents: bigint; nowCents: bigint; deltaCents: bigint; carryInCents: bigint; carryOutCents: bigint;
  units: number; plannedRaw: bigint;
  /** Shortfall carried in from the previous burn day, owed (planned + shortIn, capped at the allocation left), burned, carried out. */
  shortInRaw: bigint | null; owedRaw: bigint | null; burnRaw: bigint | null; shortOutRaw: bigint | null; memo: string | null;
  /** Buyback mode: the spendable pool and the rule's spend (lamports, fixed at the first attempt), the SOL price read for the floor, the swap's signature and what it delivered. */
  poolLamports: bigint | null; spendLamports: bigint | null; solUsd: number | null; swapSig: string | null; gotRaw: bigint | null; skippedReason: string | null;
  status: BurnStatus; signature: string | null; slot: number | null; confirmedAt: number | null;
  attempts: number; lastError: string | null; nextAttemptAt: number | null; createdAt: number; updatedAt: number;
}

/** One reading as submitted to the program (program execution): the signed submit_reading transaction and what the chain counted. */
export interface ProgramReadingRow {
  token: string; feed: string; recordDate: string; value: string; signature: string | null; slot: number | null;
  status: "sent" | "confirmed" | "adopted" | "refused" | "quorum-short" | "held"; kind: number | null; units: number | null; error: string | null; updatedAt: number;
}

export type SigStatus = "sent" | "confirmed" | "failed" | "expired";
/** burn / swap: the legacy leg. reading / crank: the program path (submit_reading, crank_* — memo holds the signed message / the crank kind). */
export type SigKind = "burn" | "swap" | "reading" | "crank";
export interface SignatureRow {
  signature: string; token: string; feed: string; recordDate: string; kind: SigKind; memo: string; burnRaw: bigint;
  blockhash: string; lastValidBlockHeight: number; sentAt: number; status: SigStatus; err: string | null; slot: number | null;
}

export interface LedgerIdentity { cluster: string; mint: string; vault: string; keeper: string; rulesSha256: string }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS readings (
  token TEXT NOT NULL, feed TEXT NOT NULL, record_date TEXT NOT NULL,
  amount TEXT NOT NULL, delta_cents TEXT, carry_in_cents TEXT NOT NULL, carry_out_cents TEXT NOT NULL,
  units INTEGER NOT NULL, kind TEXT NOT NULL, reason TEXT, fetched_at INTEGER NOT NULL,
  PRIMARY KEY (token, feed, record_date));
CREATE TABLE IF NOT EXISTS burns (
  token TEXT NOT NULL, feed TEXT NOT NULL, record_date TEXT NOT NULL, prev_date TEXT NOT NULL,
  prev_cents TEXT NOT NULL, now_cents TEXT NOT NULL, delta_cents TEXT NOT NULL, carry_in_cents TEXT NOT NULL, carry_out_cents TEXT NOT NULL,
  units INTEGER NOT NULL, planned_raw TEXT NOT NULL, short_in_raw TEXT, owed_raw TEXT, burn_raw TEXT, short_out_raw TEXT, memo TEXT,
  pool_lamports TEXT, spend_lamports TEXT, sol_usd REAL, swap_sig TEXT, got_raw TEXT, skipped_reason TEXT,
  status TEXT NOT NULL, signature TEXT, slot INTEGER, confirmed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, next_attempt_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (token, feed, record_date));
CREATE TABLE IF NOT EXISTS signatures (
  signature TEXT PRIMARY KEY, token TEXT NOT NULL, feed TEXT NOT NULL, record_date TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'burn',
  memo TEXT NOT NULL, burn_raw TEXT NOT NULL, blockhash TEXT NOT NULL, last_valid_block_height INTEGER NOT NULL,
  sent_at INTEGER NOT NULL, status TEXT NOT NULL, err TEXT, slot INTEGER);
CREATE INDEX IF NOT EXISTS signatures_by_date ON signatures (token, feed, record_date);
CREATE TABLE IF NOT EXISTS status (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS program_readings (
  token TEXT NOT NULL, feed TEXT NOT NULL, record_date TEXT NOT NULL, value TEXT NOT NULL, signature TEXT, slot INTEGER,
  status TEXT NOT NULL, kind INTEGER, units INTEGER, error TEXT, updated_at INTEGER NOT NULL,
  PRIMARY KEY (token, feed, record_date));
`;

/** Columns added to burns for program execution (2026-10-10); added in place to an older ledger file. */
const BURN_PROGRAM_COLUMNS: [string, string][] = [
  ["execution", "TEXT"], ["chain_outcome", "TEXT"], ["chain_units", "INTEGER"], ["rule_spend_lamports", "TEXT"], ["carried_in_lamports", "TEXT"],
  ["carried_out_lamports", "TEXT"], ["pool_actual_lamports", "TEXT"], ["swap_pool", "TEXT"], ["wait_reason", "TEXT"],
];

const big = (v: unknown): bigint => BigInt(String(v));
const bigOrNull = (v: unknown): bigint | null => (v === null || v === undefined ? null : BigInt(String(v)));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function toReading(r: Record<string, unknown>): ReadingRow {
  return { token: String(r.token), feed: String(r.feed), recordDate: String(r.record_date), amount: String(r.amount), cents: usdToCents(String(r.amount)),
    deltaCents: bigOrNull(r.delta_cents), carryInCents: big(r.carry_in_cents), carryOutCents: big(r.carry_out_cents), units: Number(r.units),
    kind: String(r.kind) as ReadingRow["kind"], reason: strOrNull(r.reason), fetchedAt: Number(r.fetched_at) };
}
function toBurn(r: Record<string, unknown>): BurnRow {
  return { token: String(r.token), feed: String(r.feed), recordDate: String(r.record_date), prevDate: String(r.prev_date),
    prevCents: big(r.prev_cents), nowCents: big(r.now_cents), deltaCents: big(r.delta_cents), carryInCents: big(r.carry_in_cents), carryOutCents: big(r.carry_out_cents),
    units: Number(r.units), plannedRaw: big(r.planned_raw), shortInRaw: bigOrNull(r.short_in_raw), owedRaw: bigOrNull(r.owed_raw), burnRaw: bigOrNull(r.burn_raw), shortOutRaw: bigOrNull(r.short_out_raw), memo: strOrNull(r.memo),
    poolLamports: bigOrNull(r.pool_lamports), spendLamports: bigOrNull(r.spend_lamports), solUsd: numOrNull(r.sol_usd), swapSig: strOrNull(r.swap_sig), gotRaw: bigOrNull(r.got_raw), skippedReason: strOrNull(r.skipped_reason),
    status: String(r.status) as BurnStatus, signature: strOrNull(r.signature), slot: numOrNull(r.slot), confirmedAt: numOrNull(r.confirmed_at),
    attempts: Number(r.attempts), lastError: strOrNull(r.last_error), nextAttemptAt: numOrNull(r.next_attempt_at), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    execution: (strOrNull(r.execution) as BurnRow["execution"]) ?? null, chainOutcome: strOrNull(r.chain_outcome), chainUnits: numOrNull(r.chain_units), ruleSpendLamports: bigOrNull(r.rule_spend_lamports),
    carriedInLamports: bigOrNull(r.carried_in_lamports), carriedOutLamports: bigOrNull(r.carried_out_lamports), poolActualLamports: bigOrNull(r.pool_actual_lamports), swapPool: strOrNull(r.swap_pool), waitReason: strOrNull(r.wait_reason) };
}
function toProgramReading(r: Record<string, unknown>): ProgramReadingRow {
  return { token: String(r.token), feed: String(r.feed), recordDate: String(r.record_date), value: String(r.value), signature: strOrNull(r.signature), slot: numOrNull(r.slot),
    status: String(r.status) as ProgramReadingRow["status"], kind: numOrNull(r.kind), units: numOrNull(r.units), error: strOrNull(r.error), updatedAt: Number(r.updated_at) };
}
function toSig(r: Record<string, unknown>): SignatureRow {
  return { signature: String(r.signature), token: String(r.token), feed: String(r.feed), recordDate: String(r.record_date), kind: (["swap", "reading", "crank"].includes(String(r.kind)) ? String(r.kind) : "burn") as SigKind, memo: String(r.memo), burnRaw: big(r.burn_raw),
    blockhash: String(r.blockhash), lastValidBlockHeight: Number(r.last_valid_block_height), sentAt: Number(r.sent_at), status: String(r.status) as SigStatus, err: strOrNull(r.err), slot: numOrNull(r.slot) };
}

export class Ledger {
  readonly db: DatabaseSync;
  readonly file: string;
  constructor(file: string) {
    this.file = file;
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
    const have = new Set((this.db.prepare("PRAGMA table_info(burns)").all() as { name: string }[]).map((c) => c.name));
    for (const [name, type] of BURN_PROGRAM_COLUMNS) if (!have.has(name)) this.db.exec(`ALTER TABLE burns ADD COLUMN ${name} ${type}`);
  }
  close(): void { this.db.close(); }

  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const v = fn(); this.db.exec("COMMIT"); return v; } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  // ---- status / identity ----
  setStatus(key: string, value: unknown, now = Date.now()): void {
    this.db.prepare("INSERT INTO status (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(key, typeof value === "string" ? value : JSON.stringify(value), now);
  }
  getStatus(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM status WHERE key=?").get(key) as { value: string } | undefined;
    return r ? r.value : null;
  }
  allStatus(): Record<string, string> {
    return Object.fromEntries((this.db.prepare("SELECT key, value FROM status").all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  }
  /** Binds the ledger to one identity on first use; throws on any later mismatch (see the header). */
  bindIdentity(id: LedgerIdentity, now = Date.now()): void {
    const existing = this.getStatus("identity");
    if (!existing) { this.setStatus("identity", id, now); return; }
    const was = JSON.parse(existing) as LedgerIdentity;
    const diffs = (Object.keys(id) as (keyof LedgerIdentity)[]).filter((k) => was[k] !== id[k]);
    if (diffs.length) throw new Error(`this ledger (${this.file}) belongs to another ${diffs.join("/")} (${diffs.map((k) => `${k}: ${was[k]} ≠ ${id[k]}`).join("; ")}) — refusing; use a fresh BURNKEEPER_DB for a new cluster or mint`);
  }

  // ---- readings ----
  lastReading(token: string, feed: string): LastReading | null {
    const r = this.db.prepare("SELECT * FROM readings WHERE token=? AND feed=? ORDER BY record_date DESC LIMIT 1").get(token, feed) as Record<string, unknown> | undefined;
    if (!r) return null;
    const row = toReading(r);
    return { recordDate: row.recordDate, cents: row.cents, carryOutCents: row.carryOutCents };
  }
  lastBurnedDate(token: string, feed: string): string | null {
    const r = this.db.prepare("SELECT MAX(record_date) d FROM burns WHERE token=? AND feed=?").get(token, feed) as { d: string | null } | undefined;
    return r?.d ?? null;
  }
  readings(token: string, feed: string): ReadingRow[] {
    return (this.db.prepare("SELECT * FROM readings WHERE token=? AND feed=? ORDER BY record_date").all(token, feed) as Record<string, unknown>[]).map(toReading);
  }

  /**
   * Records one processed plan step (baseline / nothing / burn) — the reading row and, for a burn, the burn row, in ONE
   * transaction. Idempotent: a step for a date already recorded is a no-op when it agrees and a throw when it does not.
   * Returns true when something new was written.
   */
  applyStep(token: string, feed: string, s: PlanStep, now = Date.now()): boolean {
    if (s.kind === "seen" || s.kind === "refuse") return false;
    return this.tx(() => {
      const have = this.db.prepare("SELECT amount FROM readings WHERE token=? AND feed=? AND record_date=?").get(token, feed, s.reading.recordDate) as { amount: string } | undefined;
      if (have) {
        if (have.amount !== s.reading.amount) throw new Error(`ledger already holds ${s.reading.recordDate} as $${have.amount}, not $${s.reading.amount}`);
        return false;
      }
      const delta = s.kind === "baseline" ? null : s.step.deltaCents.toString();
      const carryIn = s.kind === "baseline" ? "0" : s.step.carryInCents.toString();
      const carryOut = s.kind === "baseline" ? "0" : s.step.carryOutCents.toString();
      const units = s.kind === "baseline" ? 0 : s.step.units;
      const reason = s.kind === "nothing" ? s.reason : s.kind === "baseline" ? "baseline — the first reading; nothing is burned for it" : null;
      this.db.prepare("INSERT INTO readings (token, feed, record_date, amount, delta_cents, carry_in_cents, carry_out_cents, units, kind, reason, fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(token, feed, s.reading.recordDate, s.reading.amount, delta, carryIn, carryOut, units, s.kind, reason, now);
      if (s.kind === "burn") {
        this.db.prepare(`INSERT INTO burns (token, feed, record_date, prev_date, prev_cents, now_cents, delta_cents, carry_in_cents, carry_out_cents, units, planned_raw, status, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,'planned',?,?) ON CONFLICT(token, feed, record_date) DO NOTHING`)
          .run(token, feed, s.reading.recordDate, s.prev.recordDate, s.prev.cents.toString(), s.reading.cents.toString(), s.step.deltaCents.toString(), s.step.carryInCents.toString(), s.step.carryOutCents.toString(), s.step.units, s.plannedRaw.toString(), now, now);
      }
      return true;
    });
  }

  // ---- burns ----
  burn(token: string, feed: string, recordDate: string): BurnRow | null {
    const r = this.db.prepare("SELECT * FROM burns WHERE token=? AND feed=? AND record_date=?").get(token, feed, recordDate) as Record<string, unknown> | undefined;
    return r ? toBurn(r) : null;
  }
  burns(token: string, feed: string): BurnRow[] {
    return (this.db.prepare("SELECT * FROM burns WHERE token=? AND feed=? ORDER BY record_date").all(token, feed) as Record<string, unknown>[]).map(toBurn);
  }
  /** Burns not yet final, oldest first — executed strictly in date order. */
  pendingBurns(token: string, feed: string): BurnRow[] {
    return (this.db.prepare("SELECT * FROM burns WHERE token=? AND feed=? AND status IN ('planned','swap-sent','swapped','sending') ORDER BY record_date").all(token, feed) as Record<string, unknown>[]).map(toBurn);
  }
  /**
   * Fixes the settlement and the memo on the row (first send attempt). Never changes them once set: every retry of a date sends the
   * identical memo, so two transactions for one date could never disagree about what was burned.
   */
  fixSettlement(token: string, feed: string, recordDate: string, x: { memo: string; shortInRaw: bigint; owedRaw: bigint; burnRaw: bigint; shortOutRaw: bigint }, now = Date.now()): BurnRow {
    this.db.prepare("UPDATE burns SET memo=?, short_in_raw=?, owed_raw=?, burn_raw=?, short_out_raw=?, updated_at=? WHERE token=? AND feed=? AND record_date=? AND memo IS NULL")
      .run(x.memo, x.shortInRaw.toString(), x.owedRaw.toString(), x.burnRaw.toString(), x.shortOutRaw.toString(), now, token, feed, recordDate);
    const b = this.burn(token, feed, recordDate);
    if (!b) throw new Error(`no burn row for ${recordDate}`);
    return b;
  }
  /** The shortfall the next burn day inherits: the latest FINAL burn row's carried-out shortfall before `recordDate` (0 if none). */
  shortfallBefore(token: string, feed: string, recordDate: string): bigint {
    const r = this.db.prepare("SELECT short_out_raw s FROM burns WHERE token=? AND feed=? AND record_date<? AND status IN ('confirmed','exhausted') ORDER BY record_date DESC LIMIT 1").get(token, feed, recordDate) as { s: string | null } | undefined;
    return r?.s ? BigInt(r.s) : BigInt(0);
  }
  /** Write-ahead: the signed transaction's identity, before the send. */
  recordSignature(s: Omit<SignatureRow, "status" | "err" | "slot" | "kind"> & { kind?: "burn" | "swap" }): void {
    const kind = s.kind ?? "burn";
    this.tx(() => {
      this.db.prepare("INSERT INTO signatures (signature, token, feed, record_date, kind, memo, burn_raw, blockhash, last_valid_block_height, sent_at, status) VALUES (?,?,?,?,?,?,?,?,?,?,'sent')")
        .run(s.signature, s.token, s.feed, s.recordDate, kind, s.memo, s.burnRaw.toString(), s.blockhash, s.lastValidBlockHeight, s.sentAt);
      this.db.prepare(`UPDATE burns SET status='${kind === "swap" ? "swap-sent" : "sending"}', attempts=attempts+1, updated_at=? WHERE token=? AND feed=? AND record_date=?`).run(s.sentAt, s.token, s.feed, s.recordDate);
    });
  }
  /** Every signature for a date (every kind unless `kind` is given), oldest first. */
  signatures(token: string, feed: string, recordDate: string, kind?: SigKind): SignatureRow[] {
    return (this.db.prepare("SELECT * FROM signatures WHERE token=? AND feed=? AND record_date=? ORDER BY sent_at").all(token, feed, recordDate) as Record<string, unknown>[]).map(toSig).filter((x) => !kind || x.kind === kind);
  }
  // ---- buyback mode ----
  /** The pool and the rule's spend, fixed once (the first attempt): a retry never re-reads a pool its own swap may have changed. */
  fixSpend(token: string, feed: string, recordDate: string, x: { poolLamports: bigint; spendLamports: bigint; solUsd: number }, now = Date.now()): BurnRow {
    this.db.prepare("UPDATE burns SET pool_lamports=?, spend_lamports=?, sol_usd=?, updated_at=? WHERE token=? AND feed=? AND record_date=? AND spend_lamports IS NULL")
      .run(x.poolLamports.toString(), x.spendLamports.toString(), x.solUsd, now, token, feed, recordDate);
    return this.burn(token, feed, recordDate)!;
  }
  markSkipped(token: string, feed: string, recordDate: string, reason: string, now = Date.now()): void {
    this.db.prepare("UPDATE burns SET status='skipped', skipped_reason=?, burn_raw='0', last_error=NULL, next_attempt_at=NULL, updated_at=? WHERE token=? AND feed=? AND record_date=?").run(reason.slice(0, 300), now, token, feed, recordDate);
  }
  markSwapped(token: string, feed: string, recordDate: string, swapSig: string, gotRaw: bigint, slot: number | null, now = Date.now()): void {
    this.tx(() => {
      this.db.prepare("UPDATE burns SET status='swapped', swap_sig=?, got_raw=?, last_error=NULL, next_attempt_at=NULL, updated_at=? WHERE token=? AND feed=? AND record_date=?").run(swapSig, gotRaw.toString(), now, token, feed, recordDate);
      this.db.prepare("UPDATE signatures SET status='confirmed', slot=COALESCE(?, slot) WHERE signature=?").run(slot, swapSig);
    });
  }
  /** Lamports spent on confirmed buybacks (the status page's "SOL spent"). */
  spentLamports(token: string, feed: string, sinceMs = 0): bigint {
    return this.burns(token, feed).filter((b) => b.swapSig && b.spendLamports !== null && (b.confirmedAt ?? b.updatedAt) >= sinceMs && (b.status === "confirmed" || b.status === "swapped" || b.status === "sending")).reduce((a, b) => a + (b.spendLamports ?? BigInt(0)), BigInt(0));
  }
  setSignatureStatus(signature: string, status: SigStatus, err: string | null, slot: number | null): void {
    this.db.prepare("UPDATE signatures SET status=?, err=?, slot=COALESCE(?, slot) WHERE signature=?").run(status, err, slot, signature);
  }
  markConfirmed(token: string, feed: string, recordDate: string, c: { signature: string; slot: number | null; burnRaw: bigint; memo: string }, now = Date.now()): void {
    this.tx(() => {
      this.db.prepare("UPDATE burns SET status='confirmed', signature=?, slot=?, burn_raw=?, memo=?, confirmed_at=?, last_error=NULL, next_attempt_at=NULL, updated_at=? WHERE token=? AND feed=? AND record_date=?")
        .run(c.signature, c.slot, c.burnRaw.toString(), c.memo, now, now, token, feed, recordDate);
      this.db.prepare("UPDATE signatures SET status='confirmed', slot=COALESCE(?, slot) WHERE signature=?").run(c.slot, c.signature);
    });
  }
  /** The vault's allocation is fully burned: nothing is owed for this date or any later one (SPEC §2: fixed supply from here). */
  markExhausted(token: string, feed: string, recordDate: string, now = Date.now()): void {
    this.db.prepare("UPDATE burns SET status='exhausted', owed_raw='0', burn_raw='0', short_in_raw=COALESCE(short_in_raw,'0'), short_out_raw='0', last_error=NULL, next_attempt_at=NULL, updated_at=? WHERE token=? AND feed=? AND record_date=?").run(now, token, feed, recordDate);
  }
  /** A failed attempt (simulation refused, RPC down): status back to planned unless a signature is still unresolved. */
  noteError(token: string, feed: string, recordDate: string, err: string, nextAttemptAt: number, now = Date.now()): void {
    this.db.prepare("UPDATE burns SET last_error=?, next_attempt_at=?, updated_at=? WHERE token=? AND feed=? AND record_date=?").run(err.slice(0, 500), nextAttemptAt, now, token, feed, recordDate);
  }
  setBurnStatus(token: string, feed: string, recordDate: string, status: BurnStatus, now = Date.now()): void {
    this.db.prepare("UPDATE burns SET status=?, updated_at=? WHERE token=? AND feed=? AND record_date=?").run(status, now, token, feed, recordDate);
  }

  /** Confirmed burned base units (the status page's "total burned"). A program day under the floor can still burn fee-PDA tokens (skipped + burnRaw). */
  totalBurnedRaw(token: string, feed: string): bigint {
    return this.burns(token, feed).filter((b) => b.status === "confirmed" || (b.status === "skipped" && b.execution === "program")).reduce((s, b) => s + (b.burnRaw ?? BigInt(0)), BigInt(0));
  }

  // ---- program execution (2026-10-10) ----
  /** Write-ahead for a program transaction (kind reading | crank). A crank also moves the date's burn row (if any) to 'sending'. */
  recordProgramSignature(s: { kind: "reading" | "crank"; signature: string; token: string; feed: string; recordDate: string; memo: string; blockhash: string; lastValidBlockHeight: number; sentAt: number }): void {
    this.tx(() => {
      this.db.prepare("INSERT INTO signatures (signature, token, feed, record_date, kind, memo, burn_raw, blockhash, last_valid_block_height, sent_at, status) VALUES (?,?,?,?,?,?,'0',?,?,?,'sent')")
        .run(s.signature, s.token, s.feed, s.recordDate, s.kind, s.memo, s.blockhash, s.lastValidBlockHeight, s.sentAt);
      if (s.kind === "crank") this.db.prepare("UPDATE burns SET status='sending', execution='program', wait_reason=NULL, attempts=attempts+1, updated_at=? WHERE token=? AND feed=? AND record_date=?").run(s.sentAt, s.token, s.feed, s.recordDate);
    });
  }
  /** The reading as the program knows it (one row per date; the latest attempt wins). */
  setProgramReading(r: Omit<ProgramReadingRow, "updatedAt">, now = Date.now()): void {
    this.db.prepare(`INSERT INTO program_readings (token, feed, record_date, value, signature, slot, status, kind, units, error, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(token, feed, record_date) DO UPDATE SET value=excluded.value, signature=COALESCE(excluded.signature, signature), slot=COALESCE(excluded.slot, slot), status=excluded.status, kind=COALESCE(excluded.kind, kind), units=COALESCE(excluded.units, units), error=excluded.error, updated_at=excluded.updated_at`)
      .run(r.token, r.feed, r.recordDate, r.value, r.signature, r.slot, r.status, r.kind, r.units, r.error, now);
  }
  programReading(token: string, feed: string, recordDate: string): ProgramReadingRow | null {
    const r = this.db.prepare("SELECT * FROM program_readings WHERE token=? AND feed=? AND record_date=?").get(token, feed, recordDate) as Record<string, unknown> | undefined;
    return r ? toProgramReading(r) : null;
  }
  programReadings(token: string, feed: string): ProgramReadingRow[] {
    return (this.db.prepare("SELECT * FROM program_readings WHERE token=? AND feed=? ORDER BY record_date").all(token, feed) as Record<string, unknown>[]).map(toProgramReading);
  }
  /** A crank that cannot run yet (TWAP history, no pool, pool not tradable): recorded as a WAIT — no error, no attempt counted. */
  setWait(token: string, feed: string, recordDate: string, reason: string, nextAttemptAt: number, now = Date.now()): void {
    this.db.prepare("UPDATE burns SET status=CASE WHEN status='sending' THEN 'planned' ELSE status END, execution='program', wait_reason=?, last_error=NULL, next_attempt_at=?, updated_at=? WHERE token=? AND feed=? AND record_date=?").run(reason.slice(0, 300), nextAttemptAt, now, token, feed, recordDate);
  }
  /**
   * The date's crank landed: every number is the program's, read back from its Reading account. burned / short → confirmed;
   * below-floor / no-units → skipped (the reason recorded; fee-PDA tokens may still have been burned); exhausted → exhausted.
   */
  markProgramProcessed(token: string, feed: string, recordDate: string, f: { signature: string; slot: number | null; outcome: string; units: number; memo: string | null; poolLamports: bigint; poolActualLamports: bigint; spentLamports: bigint; ruleSpendLamports: bigint; carriedInLamports: bigint; carriedOutLamports: bigint; gotRaw: bigint; burnRaw: bigint; owedRaw: bigint; shortfallRaw: bigint; swapPool: string | null; skippedReason?: string | null }, now = Date.now()): void {
    const status: BurnStatus = f.outcome === "burned" || f.outcome === "short" ? "confirmed" : f.outcome === "exhausted" ? "exhausted" : "skipped";
    this.tx(() => {
      this.db.prepare(`UPDATE burns SET status=?, execution='program', signature=?, slot=?, memo=?, chain_outcome=?, chain_units=?, pool_lamports=?, pool_actual_lamports=?, spend_lamports=?, rule_spend_lamports=?,
        carried_in_lamports=?, carried_out_lamports=?, got_raw=?, burn_raw=?, owed_raw=?, short_out_raw=?, swap_pool=?, skipped_reason=?, wait_reason=NULL, confirmed_at=?, last_error=NULL, next_attempt_at=NULL, updated_at=?
        WHERE token=? AND feed=? AND record_date=?`)
        .run(status, f.signature, f.slot, f.memo, f.outcome, f.units, f.poolLamports.toString(), f.poolActualLamports.toString(), f.spentLamports.toString(), f.ruleSpendLamports.toString(),
          f.carriedInLamports.toString(), f.carriedOutLamports.toString(), f.gotRaw.toString(), f.burnRaw.toString(), f.owedRaw.toString(), f.shortfallRaw.toString(), f.swapPool, status === "skipped" ? (f.skippedReason ?? `chain outcome ${f.outcome}`).slice(0, 300) : null, now, now, token, feed, recordDate);
      this.db.prepare("UPDATE signatures SET status='confirmed', slot=COALESCE(?, slot) WHERE signature=?").run(f.slot, f.signature);
    });
  }
}

export function openLedger(file: string): Ledger { return new Ledger(file); }
