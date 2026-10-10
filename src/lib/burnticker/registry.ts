import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { lockRule, type BurnMapping, type BurnRule, type LockedRule, type RuleMode } from "@/lib/burnticker/rules";
import type { SettledEvent } from "@/lib/burnticker/units";

/**
 * THE REGISTRY — data/burnticker.db (node:sqlite, like the keeper's ledger and every other service here; 2026-10-09). One writer:
 * the multi-token keeper; the app's API routes read it.
 *
 *   tokens      every launched (or drafted) token: mint, ticker, creator, the selector key, the rule's exact canonical text and its
 *               sha256, mode, fee PDA, vault, launch tx, status. The rule text is the published rules.json, byte for byte.
 *   readings    every settled outcome the keeper has read, per SELECTOR KEY (a Kalshi series, one market, or a feed) — shared by every
 *               token on that key; each token applies its own filter at plan time. Carries the oracle's result/value, settled time,
 *               the settlement-source URL, the verify URL, the derivation method and who attested.
 *   burns       THE RECEIPTS: one row per (mint, event) — the idempotency key. planned → sending → confirmed; or skipped (under the
 *               floor / empty pool), void (the market was voided), exhausted (vault allocation used up). The spend/burn and the memo are
 *               fixed on the row at the first attempt; every retry sends those bytes.
 *   signatures  write-ahead: every crank signed, BEFORE it is sent (the keeper's lesson: a crash between send and record must not
 *               crank twice).
 *   token_state the planning cursor per token: last event id, last value, carried remainder.
 *   feed_state  per selector key: when it was last read, failures, next read.
 *   attesters   per token: pubkey, role, active, timelock.
 *   status      key/value.
 */

/** "expired": a DRAFT that was not launched within DRAFT_TTL_MS; its ticker is free again. Final (a trigger refuses leaving it). */
export type TokenStatus = "draft" | "live" | "paused" | "retired" | "expired";

/**
 * DRAFTS EXPIRE AFTER 24 h (2026-10-09, the public API's ticker-squatting risk). A launch bundle registers a DRAFT that reserves its
 * ticker; a draft never confirmed by its launch transaction within this window becomes "expired" — its row stays (append-only), its
 * ticker is released, and confirming it is refused (build a fresh bundle). Expiry runs lazily wherever a ticker is checked or the
 * token list is read, so it needs no scheduler.
 */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export interface TokenRow {
  mint: string; ticker: string; name: string; creator: string; description: string; imageUrl: string | null; links: { label: string; url: string }[];
  oracle: BurnRule["oracle"]; selectorKey: string; rulesJson: string; rulesSha: string; mode: RuleMode; feePda: string; vault: string | null;
  tokenConfig: string | null; poolId: string | null; launchTx: string | null; cluster: string; platformId: string | null;
  /** Settlements strictly after this ISO time count (the token's baseline = its launch time). */
  baselineAt: string; createdAt: number; status: TokenStatus;
}

export interface ReadingRow extends SettledEvent { oracle: string; selectorKey: string; settlementSourceUrl: string | null; method: string | null; proof: string | null; attestedBy: string[]; fetchedAt: number }

export type ReceiptStatus = "planned" | "sending" | "confirmed" | "skipped" | "void" | "exhausted" | "nothing";
export interface ReceiptRow {
  mint: string; eventId: string; settledAt: string; result: string | null; value: string | null; units: number; mapping: BurnMapping | null; kind: string; note: string;
  prevValue: string | null; carryIn: string; carryOut: string;
  poolLamports: bigint | null; spendLamports: bigint | null; solUsd: number | null; vaultRaw: bigint | null; shortInRaw: bigint | null; shortOutRaw: bigint | null; gotRaw: bigint | null; burnRaw: bigint | null; memo: string | null;
  status: ReceiptStatus; signature: string | null; slot: number | null; skippedReason: string | null;
  attempts: number; lastError: string | null; nextAttemptAt: number | null; createdAt: number; updatedAt: number; confirmedAt: number | null;
  /**
   * PROGRAM EXECUTION (2026-10-10): the on-chain facts. `readingDate` = the program reading (YYYYMMDD) this receipt's units were counted
   * into (several receipts can share one reading — one crank per reading); the LEAD receipt of a reading carries the program's amounts
   * and memo, the others carry zero amounts, the same signature and the same memo. `waitReason` = why the crank waits (not an error).
   */
  execution: "program" | null; readingDate: number | null; waitReason: string | null; chainOutcome: string | null;
  ruleSpendLamports: bigint | null; carriedInLamports: bigint | null; carriedOutLamports: bigint | null; poolActualLamports: bigint | null; lead: boolean | null;
}

export interface SignatureRow { signature: string; mint: string; eventId: string; memo: string; burnRaw: bigint; spendLamports: bigint; blockhash: string; lastValidBlockHeight: number; sentAt: number; status: "sent" | "confirmed" | "failed" | "expired"; err: string | null; slot: number | null }
export interface AttesterRow { mint: string; pubkey: string; role: "data-key" | "independent"; addedAt: number; active: boolean; timelockUntil: number | null }
export interface TokenState { mint: string; lastEventId: string | null; lastValue: string | null; carryOut: string; lastSettledAt: string | null; updatedAt: number }
export interface FeedState { selectorKey: string; lastFetchAt: number | null; lastOkAt: number | null; failures: number; lastError: string | null; nextFetchAt: number | null }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY, ticker TEXT NOT NULL, name TEXT NOT NULL, creator TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', image_url TEXT, links_json TEXT NOT NULL DEFAULT '[]',
  oracle TEXT NOT NULL, selector_key TEXT NOT NULL, rules_json TEXT NOT NULL, rules_sha TEXT NOT NULL, mode TEXT NOT NULL, fee_pda TEXT NOT NULL, vault TEXT,
  token_config TEXT, pool_id TEXT, launch_tx TEXT, cluster TEXT NOT NULL, platform_id TEXT, baseline_at TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tokens_by_selector ON tokens (selector_key, status);
-- One holder per ticker among tokens that are not expired: an expired draft releases its ticker (the row itself stays).
CREATE UNIQUE INDEX IF NOT EXISTS tokens_ticker_held ON tokens (ticker) WHERE status <> 'expired';
CREATE TABLE IF NOT EXISTS readings (
  oracle TEXT NOT NULL, selector_key TEXT NOT NULL, event_id TEXT NOT NULL, settled_at TEXT NOT NULL, result TEXT, value TEXT, title TEXT, source_url TEXT NOT NULL,
  settlement_source_url TEXT, method TEXT, attested_by TEXT NOT NULL DEFAULT '[]', fetched_at INTEGER NOT NULL,
  PRIMARY KEY (oracle, selector_key, event_id));
CREATE INDEX IF NOT EXISTS readings_by_time ON readings (selector_key, settled_at);
CREATE TABLE IF NOT EXISTS burns (
  mint TEXT NOT NULL, event_id TEXT NOT NULL, settled_at TEXT NOT NULL, result TEXT, value TEXT, units INTEGER NOT NULL, mapping_json TEXT, kind TEXT NOT NULL, note TEXT NOT NULL,
  prev_value TEXT, carry_in TEXT NOT NULL, carry_out TEXT NOT NULL,
  pool_lamports TEXT, spend_lamports TEXT, sol_usd REAL, vault_raw TEXT, short_in_raw TEXT, short_out_raw TEXT, got_raw TEXT, burn_raw TEXT, memo TEXT,
  status TEXT NOT NULL, signature TEXT, slot INTEGER, skipped_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, next_attempt_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, confirmed_at INTEGER,
  PRIMARY KEY (mint, event_id));
CREATE TABLE IF NOT EXISTS signatures (
  signature TEXT PRIMARY KEY, mint TEXT NOT NULL, event_id TEXT NOT NULL, memo TEXT NOT NULL, burn_raw TEXT NOT NULL, spend_lamports TEXT NOT NULL,
  blockhash TEXT NOT NULL, last_valid_block_height INTEGER NOT NULL, sent_at INTEGER NOT NULL, status TEXT NOT NULL, err TEXT, slot INTEGER);
CREATE INDEX IF NOT EXISTS signatures_by_event ON signatures (mint, event_id);
CREATE TABLE IF NOT EXISTS token_state (mint TEXT PRIMARY KEY, last_event_id TEXT, last_value TEXT, carry_out TEXT NOT NULL DEFAULT '0', last_settled_at TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS feed_state (selector_key TEXT PRIMARY KEY, last_fetch_at INTEGER, last_ok_at INTEGER, failures INTEGER NOT NULL DEFAULT 0, last_error TEXT, next_fetch_at INTEGER);
CREATE TABLE IF NOT EXISTS attesters (mint TEXT NOT NULL, pubkey TEXT NOT NULL, role TEXT NOT NULL, added_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, timelock_until INTEGER, PRIMARY KEY (mint, pubkey));
CREATE TABLE IF NOT EXISTS status (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
-- Ops alerts recorded on the Burnticker host (src/lib/burnticker/alerts.ts registryAlertSink): one row per key per Denver day — the
-- dedupe the keeper's sink needs — then forwarded by the webhook. Append-only.
CREATE TABLE IF NOT EXISTS alerts (ts INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, text TEXT NOT NULL, meta_json TEXT, PRIMARY KEY (key, day));
CREATE INDEX IF NOT EXISTS alerts_by_ts ON alerts (ts);
CREATE TABLE IF NOT EXISTS pairs (pair_id TEXT PRIMARY KEY, mint_a TEXT NOT NULL UNIQUE, mint_b TEXT NOT NULL UNIQUE, selector_key TEXT NOT NULL, created_at INTEGER NOT NULL);
`;

/** Columns added to burns for program execution (2026-10-10), added in place to an older registry file. */
const BURN_PROGRAM_COLUMNS: [string, string][] = [
  ["execution", "TEXT"], ["reading_date", "INTEGER"], ["wait_reason", "TEXT"], ["chain_outcome", "TEXT"], ["rule_spend_lamports", "TEXT"],
  ["carried_in_lamports", "TEXT"], ["carried_out_lamports", "TEXT"], ["pool_actual_lamports", "TEXT"], ["lead", "INTEGER"],
];

/**
 * APPEND-ONLY, ENFORCED BY THE DATABASE (the owner, 2026-10-09: no room for suspicion that the operator rewrote history). These
 * triggers make the registry refuse, at the SQL level, any statement that would alter a token's rule or identity, change or delete a
 * reading, delete a receipt or a signature, or change a receipt's facts (event, result, value, units, mapping) — and once a receipt is
 * confirmed, anything about it. The keeper's own code has no path for those writes either; the triggers are the second lock, and an
 * auditor can read them with `.schema` on data/burnticker.db.
 */
const IMMUTABILITY = `
CREATE TRIGGER IF NOT EXISTS tokens_rule_immutable BEFORE UPDATE OF mint, ticker, creator, oracle, selector_key, rules_json, rules_sha, mode, fee_pda, vault, cluster, created_at ON tokens
  BEGIN SELECT RAISE(ABORT, 'tokens: the rule and identity of a token are immutable'); END;
CREATE TRIGGER IF NOT EXISTS tokens_launch_once BEFORE UPDATE OF launch_tx ON tokens WHEN OLD.launch_tx IS NOT NULL AND NEW.launch_tx IS NOT OLD.launch_tx
  BEGIN SELECT RAISE(ABORT, 'tokens: the launch transaction is written once'); END;
CREATE TRIGGER IF NOT EXISTS tokens_no_delete BEFORE DELETE ON tokens BEGIN SELECT RAISE(ABORT, 'tokens: append-only'); END;
CREATE TRIGGER IF NOT EXISTS tokens_expired_final BEFORE UPDATE OF status ON tokens WHEN OLD.status = 'expired' AND NEW.status <> 'expired'
  BEGIN SELECT RAISE(ABORT, 'tokens: an expired draft stays expired (build a fresh bundle)'); END;
CREATE TRIGGER IF NOT EXISTS tokens_expire_drafts_only BEFORE UPDATE OF status ON tokens WHEN NEW.status = 'expired' AND OLD.status <> 'draft' AND OLD.status <> 'expired'
  BEGIN SELECT RAISE(ABORT, 'tokens: only a draft can expire'); END;
CREATE TRIGGER IF NOT EXISTS readings_no_update BEFORE UPDATE ON readings BEGIN SELECT RAISE(ABORT, 'readings: append-only'); END;
CREATE TRIGGER IF NOT EXISTS readings_no_delete BEFORE DELETE ON readings BEGIN SELECT RAISE(ABORT, 'readings: append-only'); END;
CREATE TRIGGER IF NOT EXISTS burns_facts_immutable BEFORE UPDATE OF mint, event_id, settled_at, result, value, units, mapping_json, kind, prev_value, carry_in, carry_out, created_at ON burns
  BEGIN SELECT RAISE(ABORT, 'burns: the facts of a receipt are immutable'); END;
CREATE TRIGGER IF NOT EXISTS burns_plan_once BEFORE UPDATE OF memo, pool_lamports, spend_lamports ON burns WHEN OLD.memo IS NOT NULL AND (NEW.memo IS NOT OLD.memo OR NEW.pool_lamports IS NOT OLD.pool_lamports OR NEW.spend_lamports IS NOT OLD.spend_lamports) AND OLD.status <> 'sending' AND OLD.status <> 'planned'
  BEGIN SELECT RAISE(ABORT, 'burns: a fixed plan is not rewritten'); END;
CREATE TRIGGER IF NOT EXISTS burns_confirmed_frozen BEFORE UPDATE ON burns WHEN OLD.status IN ('confirmed', 'void', 'exhausted')
  BEGIN SELECT RAISE(ABORT, 'burns: a final receipt is frozen'); END;
CREATE TRIGGER IF NOT EXISTS burns_no_delete BEFORE DELETE ON burns BEGIN SELECT RAISE(ABORT, 'burns: append-only'); END;
CREATE TRIGGER IF NOT EXISTS signatures_no_delete BEFORE DELETE ON signatures BEGIN SELECT RAISE(ABORT, 'signatures: append-only'); END;
CREATE TRIGGER IF NOT EXISTS signatures_identity_immutable BEFORE UPDATE OF signature, mint, event_id, memo, burn_raw, spend_lamports, blockhash, sent_at ON signatures
  BEGIN SELECT RAISE(ABORT, 'signatures: identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS alerts_no_update BEFORE UPDATE ON alerts BEGIN SELECT RAISE(ABORT, 'alerts: append-only'); END;
CREATE TRIGGER IF NOT EXISTS alerts_no_delete BEFORE DELETE ON alerts BEGIN SELECT RAISE(ABORT, 'alerts: append-only'); END;
CREATE TRIGGER IF NOT EXISTS pairs_no_update BEFORE UPDATE ON pairs BEGIN SELECT RAISE(ABORT, 'pairs: append-only'); END;
CREATE TRIGGER IF NOT EXISTS pairs_no_delete BEFORE DELETE ON pairs BEGIN SELECT RAISE(ABORT, 'pairs: append-only'); END;
`;

export interface PairRow { pairId: string; mintA: string; mintB: string; selectorKey: string; createdAt: number }

const bigOrNull = (v: unknown): bigint | null => (v === null || v === undefined ? null : BigInt(String(v)));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
type Row = Record<string, unknown>;

const toToken = (r: Row): TokenRow => ({ mint: String(r.mint), ticker: String(r.ticker), name: String(r.name), creator: String(r.creator), description: String(r.description ?? ""), imageUrl: strOrNull(r.image_url), links: JSON.parse(String(r.links_json ?? "[]")),
  oracle: String(r.oracle) as BurnRule["oracle"], selectorKey: String(r.selector_key), rulesJson: String(r.rules_json), rulesSha: String(r.rules_sha), mode: String(r.mode) as RuleMode, feePda: String(r.fee_pda), vault: strOrNull(r.vault),
  tokenConfig: strOrNull(r.token_config), poolId: strOrNull(r.pool_id), launchTx: strOrNull(r.launch_tx), cluster: String(r.cluster), platformId: strOrNull(r.platform_id), baselineAt: String(r.baseline_at), createdAt: Number(r.created_at), status: String(r.status) as TokenStatus });
const toReading = (r: Row): ReadingRow => ({ oracle: String(r.oracle), selectorKey: String(r.selector_key), id: String(r.event_id), at: String(r.settled_at), result: strOrNull(r.result) as ReadingRow["result"], value: strOrNull(r.value), title: strOrNull(r.title), sourceUrl: String(r.source_url),
  settlementSourceUrl: strOrNull(r.settlement_source_url), method: strOrNull(r.method), proof: strOrNull(r.proof), attestedBy: JSON.parse(String(r.attested_by ?? "[]")), fetchedAt: Number(r.fetched_at) });
const toReceipt = (r: Row): ReceiptRow => ({ mint: String(r.mint), eventId: String(r.event_id), settledAt: String(r.settled_at), result: strOrNull(r.result), value: strOrNull(r.value), units: Number(r.units), mapping: r.mapping_json ? JSON.parse(String(r.mapping_json)) : null, kind: String(r.kind), note: String(r.note),
  prevValue: strOrNull(r.prev_value), carryIn: String(r.carry_in), carryOut: String(r.carry_out),
  poolLamports: bigOrNull(r.pool_lamports), spendLamports: bigOrNull(r.spend_lamports), solUsd: numOrNull(r.sol_usd), vaultRaw: bigOrNull(r.vault_raw), shortInRaw: bigOrNull(r.short_in_raw), shortOutRaw: bigOrNull(r.short_out_raw), gotRaw: bigOrNull(r.got_raw), burnRaw: bigOrNull(r.burn_raw), memo: strOrNull(r.memo),
  status: String(r.status) as ReceiptStatus, signature: strOrNull(r.signature), slot: numOrNull(r.slot), skippedReason: strOrNull(r.skipped_reason),
  attempts: Number(r.attempts), lastError: strOrNull(r.last_error), nextAttemptAt: numOrNull(r.next_attempt_at), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), confirmedAt: numOrNull(r.confirmed_at),
  execution: strOrNull(r.execution) === "program" ? "program" : null, readingDate: numOrNull(r.reading_date), waitReason: strOrNull(r.wait_reason), chainOutcome: strOrNull(r.chain_outcome),
  ruleSpendLamports: bigOrNull(r.rule_spend_lamports), carriedInLamports: bigOrNull(r.carried_in_lamports), carriedOutLamports: bigOrNull(r.carried_out_lamports), poolActualLamports: bigOrNull(r.pool_actual_lamports), lead: r.lead === null || r.lead === undefined ? null : Number(r.lead) === 1 });
const toSig = (r: Row): SignatureRow => ({ signature: String(r.signature), mint: String(r.mint), eventId: String(r.event_id), memo: String(r.memo), burnRaw: BigInt(String(r.burn_raw)), spendLamports: BigInt(String(r.spend_lamports)), blockhash: String(r.blockhash), lastValidBlockHeight: Number(r.last_valid_block_height), sentAt: Number(r.sent_at), status: String(r.status) as SignatureRow["status"], err: strOrNull(r.err), slot: numOrNull(r.slot) });

/**
 * The key readings are stored under: the feed id; one Kalshi market; or a Kalshi series PLUS the rule kind — a series read as
 * binaries (one reading per market) and the same series read as scalars (one per event) are two different reading streams. Tokens
 * on one key share its readings and apply their own filter at plan time. Polymarket (binary only): `polymarket:market:<condition id>`
 * or `polymarket:<series>:binary` ("polymarket:tag:nfl/moneyline:binary").
 */
export function selectorKeyOf(rule: BurnRule): string {
  if (rule.oracle === "catalogue") return `catalogue:${rule.series}`;
  if (rule.oracle === "polymarket") return rule.market ? `polymarket:market:${rule.market}` : `polymarket:${rule.series}:${rule.kind}`;
  return rule.market ? `kalshi:market:${rule.market}` : `kalshi:${rule.series}:${rule.kind}`;
}

/** The rule the keeper FETCHES with for a key: the token's rule with its filter cleared, so the whole series is stored. */
export function wideRule(rule: BurnRule): BurnRule { return rule.market ? rule : { ...rule, filter: {} }; }

/** Does a stored reading fall under this token's filter? (`tickerIncludes` over the event id, `titleRegex` over the title.) */
export function readingMatches(rule: BurnRule, r: { id: string; title: string | null }): boolean {
  if (rule.oracle === "catalogue" || rule.market) return true;
  if (rule.filter.tickerIncludes && !r.id.includes(rule.filter.tickerIncludes)) return false;
  if (rule.filter.titleRegex && !new RegExp(rule.filter.titleRegex).test(r.title ?? "")) return false;
  return true;
}

export interface RegisterInput { mint: string; ticker: string; name: string; creator: string; description: string; imageUrl: string | null; links: { label: string; url: string }[]; rulesText: string; feePda: string; vault: string | null; tokenConfig: string | null; poolId: string | null; launchTx: string | null; cluster: string; platformId: string | null; baselineAt: string; status: TokenStatus }

export class Registry {
  readonly db: DatabaseSync;
  readonly file: string;
  constructor(file: string) {
    this.file = file;
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.migrateTickerUniqueness();
    this.db.exec(SCHEMA);
    const have = new Set((this.db.prepare("PRAGMA table_info(burns)").all() as { name: string }[]).map((c) => c.name));
    for (const [name, type] of BURN_PROGRAM_COLUMNS) if (!have.has(name)) this.db.exec(`ALTER TABLE burns ADD COLUMN ${name} ${type}`);
    // 2026-10-10: a reading's on-chain proof locator (Polymarket: the CTF payout vector's condition id and block). Added, never changed.
    if (!(this.db.prepare("PRAGMA table_info(readings)").all() as { name: string }[]).some((c) => c.name === "proof")) this.db.exec("ALTER TABLE readings ADD COLUMN proof TEXT");
    this.db.exec(IMMUTABILITY);
    // A program reading, once a receipt is counted into it, is part of the receipt's facts.
    this.db.exec(`CREATE TRIGGER IF NOT EXISTS burns_reading_once BEFORE UPDATE OF reading_date ON burns WHEN OLD.reading_date IS NOT NULL AND NEW.reading_date IS NOT OLD.reading_date
      BEGIN SELECT RAISE(ABORT, 'burns: a receipt is counted into one program reading'); END;`);
  }

  /**
   * Registries created before draft expiry had `ticker TEXT NOT NULL UNIQUE` on tokens, which an expired draft could never release.
   * Rebuilds that one table (same columns, rows copied verbatim, in one transaction) so the partial unique index in SCHEMA replaces the
   * column constraint; the triggers are re-created right after by IMMUTABILITY. A no-op on new or already-migrated files.
   */
  private migrateTickerUniqueness(): void {
    const exists = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tokens'").get();
    if (!exists) return;
    const idx = this.db.prepare("PRAGMA index_list('tokens')").all() as { name: string; unique: number; origin: string }[];
    const columnUnique = idx.find((i) => i.origin === "u" && i.unique === 1 && (this.db.prepare(`PRAGMA index_info('${i.name.replace(/'/g, "''")}')`).all() as { name: string }[]).some((c) => c.name === "ticker"));
    if (!columnUnique) return;
    const create = SCHEMA.slice(SCHEMA.indexOf("CREATE TABLE IF NOT EXISTS tokens"), SCHEMA.indexOf(");", SCHEMA.indexOf("CREATE TABLE IF NOT EXISTS tokens")) + 2).replace("CREATE TABLE IF NOT EXISTS tokens", "CREATE TABLE tokens_migrated");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(create);
      this.db.exec("INSERT INTO tokens_migrated SELECT mint, ticker, name, creator, description, image_url, links_json, oracle, selector_key, rules_json, rules_sha, mode, fee_pda, vault, token_config, pool_id, launch_tx, cluster, platform_id, baseline_at, created_at, status FROM tokens");
      this.db.exec("DROP TABLE tokens");   // DROP fires no DELETE trigger; the table's triggers go with it and IMMUTABILITY re-creates them
      this.db.exec("ALTER TABLE tokens_migrated RENAME TO tokens");
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  /** Expires every draft older than DRAFT_TTL_MS (lazy; idempotent). Returns how many expired now. */
  expireDrafts(now = Date.now()): number {
    return Number(this.db.prepare("UPDATE tokens SET status='expired' WHERE status='draft' AND launch_tx IS NULL AND created_at < ?").run(now - DRAFT_TTL_MS).changes);
  }
  /** Whether a ticker is held by a token that is not expired (expiring stale drafts first). */
  tickerTaken(ticker: string, now = Date.now()): boolean {
    this.expireDrafts(now);
    return !!this.db.prepare("SELECT 1 FROM tokens WHERE ticker=? AND status <> 'expired'").get(ticker.toUpperCase());
  }
  close(): void { this.db.close(); }
  tx<T>(fn: () => T): T { this.db.exec("BEGIN IMMEDIATE"); try { const v = fn(); this.db.exec("COMMIT"); return v; } catch (e) { this.db.exec("ROLLBACK"); throw e; } }

  // ---- ops alerts (the keeper's local record + dedupe; alerts.ts) ----
  /** Records an alert once per key per Denver day; returns the row when new, null when that key was already raised today. */
  recordAlert(a: { kind: string; key: string; text: string; meta: Record<string, unknown> | null }, now = Date.now()): { ts: number; kind: string; key: string } | null {
    const day = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Denver" });
    const r = this.db.prepare("INSERT OR IGNORE INTO alerts (ts, day, kind, key, text, meta_json) VALUES (?,?,?,?,?,?)").run(now, day, a.kind, a.key.slice(0, 200), a.text.slice(0, 1000), a.meta ? JSON.stringify(a.meta) : null);
    return Number(r.changes) ? { ts: now, kind: a.kind, key: a.key } : null;
  }
  /** Alerts since a time, newest first. */
  alertsSince(sinceMs: number, limit = 200): { ts: number; kind: string; key: string; text: string }[] {
    return (this.db.prepare("SELECT ts, kind, key, text FROM alerts WHERE ts >= ? ORDER BY ts DESC LIMIT ?").all(sinceMs, limit) as Row[]).map((r) => ({ ts: Number(r.ts), kind: String(r.kind), key: String(r.key), text: String(r.text) }));
  }

  // ---- status ----
  setStatus(key: string, value: unknown, now = Date.now()): void { this.db.prepare("INSERT INTO status (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(key, typeof value === "string" ? value : JSON.stringify(value), now); }
  getStatus(key: string): string | null { const r = this.db.prepare("SELECT value FROM status WHERE key=?").get(key) as { value: string } | undefined; return r ? r.value : null; }

  // ---- tokens ----
  /** Registers a token. The rule text must be canonical (it is re-locked and its hash recomputed here, never trusted from the caller). */
  register(i: RegisterInput, now = Date.now()): TokenRow {
    const locked: LockedRule = lockRule(JSON.parse(i.rulesText));
    if (locked.text !== i.rulesText) throw new Error("registry: rules text is not canonical");
    if (this.tickerTaken(i.ticker, now)) throw new Error(`registry: ticker ${i.ticker} is taken`);
    this.db.prepare(`INSERT INTO tokens (mint, ticker, name, creator, description, image_url, links_json, oracle, selector_key, rules_json, rules_sha, mode, fee_pda, vault, token_config, pool_id, launch_tx, cluster, platform_id, baseline_at, created_at, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(i.mint, i.ticker, i.name, i.creator, i.description, i.imageUrl, JSON.stringify(i.links), locked.rule.oracle, selectorKeyOf(locked.rule), locked.text, locked.sha256, locked.mode, i.feePda, i.vault, i.tokenConfig, i.poolId, i.launchTx, i.cluster, i.platformId, i.baselineAt, now, i.status);
    this.db.prepare("INSERT OR IGNORE INTO token_state (mint, carry_out, updated_at) VALUES (?, '0', ?)").run(i.mint, now);
    return this.token(i.mint)!;
  }
  token(mint: string): TokenRow | null { const r = this.db.prepare("SELECT * FROM tokens WHERE mint=?").get(mint) as Row | undefined; return r ? toToken(r) : null; }
  /** The token holding a ticker; when only expired drafts carry it, the newest of those (pages and lookups still resolve). */
  tokenByTicker(ticker: string): TokenRow | null { const r = this.db.prepare("SELECT * FROM tokens WHERE ticker=? ORDER BY (status = 'expired'), created_at DESC LIMIT 1").get(ticker.toUpperCase()) as Row | undefined; return r ? toToken(r) : null; }
  tokens(status?: TokenStatus): TokenRow[] { return (status ? this.db.prepare("SELECT * FROM tokens WHERE status=? ORDER BY created_at").all(status) : this.db.prepare("SELECT * FROM tokens ORDER BY created_at").all()).map((r) => toToken(r as Row)); }
  setTokenStatus(mint: string, status: TokenStatus): void { this.db.prepare("UPDATE tokens SET status=? WHERE mint=?").run(status, mint); }
  /** The launch landed: record the tx and go live. Refuses to overwrite a different launch tx. */
  markLaunched(mint: string, launchTx: string, poolId: string | null, baselineAt: string): void {
    const t = this.token(mint); if (!t) throw new Error("no such token");
    if (t.status === "expired") throw new Error(`registry: the draft ${mint} expired (not launched within 24 h); build a fresh bundle`);
    if (t.launchTx && t.launchTx !== launchTx) throw new Error(`registry: ${mint} already launched in ${t.launchTx}`);
    this.db.prepare("UPDATE tokens SET launch_tx=?, pool_id=COALESCE(?, pool_id), baseline_at=?, status='live' WHERE mint=?").run(launchTx, poolId, baselineAt, mint);
  }
  lockedRule(t: TokenRow): LockedRule { return lockRule(JSON.parse(t.rulesJson)); }

  // ---- readings ----
  /** Inserts new readings; a reading already held with a DIFFERENT result/value throws (an oracle that changed its mind holds the keeper). Returns the count written. */
  putReadings(oracle: string, selectorKey: string, events: readonly SettledEvent[], meta: { settlementSourceUrl: string | null; attestedBy: string[]; method?: (e: SettledEvent) => string | null }, now = Date.now()): number {
    let n = 0;
    this.tx(() => {
      for (const e of events) {
        const have = this.db.prepare("SELECT result, value FROM readings WHERE oracle=? AND selector_key=? AND event_id=?").get(oracle, selectorKey, e.id) as { result: string | null; value: string | null } | undefined;
        if (have) { if ((have.result ?? null) !== (e.result ?? null) || (have.value ?? null) !== (e.value ?? null)) throw new Error(`registry: ${selectorKey} ${e.id} already recorded as ${have.result ?? have.value}, the oracle now says ${e.result ?? e.value} — holding`); continue; }
        this.db.prepare("INSERT INTO readings (oracle, selector_key, event_id, settled_at, result, value, title, source_url, settlement_source_url, method, proof, attested_by, fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(oracle, selectorKey, e.id, e.at, e.result, e.value, e.title, e.sourceUrl, meta.settlementSourceUrl, meta.method?.(e) ?? e.method ?? null, e.proof ?? null, JSON.stringify(meta.attestedBy), now);
        n++;
      }
    });
    return n;
  }
  readings(selectorKey: string, sinceIso: string | null = null): ReadingRow[] { return (this.db.prepare("SELECT * FROM readings WHERE selector_key=? AND settled_at>? ORDER BY settled_at, event_id").all(selectorKey, sinceIso ?? "") as Row[]).map(toReading); }
  lastReading(selectorKey: string): ReadingRow | null { const r = this.db.prepare("SELECT * FROM readings WHERE selector_key=? ORDER BY settled_at DESC, event_id DESC LIMIT 1").get(selectorKey) as Row | undefined; return r ? toReading(r) : null; }

  // ---- token state ----
  state(mint: string): TokenState { const r = this.db.prepare("SELECT * FROM token_state WHERE mint=?").get(mint) as Row | undefined; return r ? { mint, lastEventId: strOrNull(r.last_event_id), lastValue: strOrNull(r.last_value), carryOut: String(r.carry_out), lastSettledAt: strOrNull(r.last_settled_at), updatedAt: Number(r.updated_at) } : { mint, lastEventId: null, lastValue: null, carryOut: "0", lastSettledAt: null, updatedAt: 0 }; }
  private setState(mint: string, s: { lastEventId: string; lastValue: string | null; carryOut: string; lastSettledAt: string }, now: number): void { this.db.prepare("INSERT INTO token_state (mint, last_event_id, last_value, carry_out, last_settled_at, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(mint) DO UPDATE SET last_event_id=excluded.last_event_id, last_value=excluded.last_value, carry_out=excluded.carry_out, last_settled_at=excluded.last_settled_at, updated_at=excluded.updated_at").run(mint, s.lastEventId, s.lastValue, s.carryOut, s.lastSettledAt, now); }

  // ---- receipts ----
  /** Records one planned step for a token (the receipt row + the cursor), in one transaction. Idempotent per (mint, event). */
  applyStep(mint: string, e: SettledEvent, step: { units: number; mapping: BurnMapping | null; kind: string; note: string; carryOut: string; baseline: string | null }, prev: { value: string | null; carryOut: string }, scalar: boolean, now = Date.now()): boolean {
    return this.tx(() => {
      if (this.db.prepare("SELECT 1 FROM burns WHERE mint=? AND event_id=?").get(mint, e.id)) return false;
      const status: ReceiptStatus = step.kind === "void" ? "void" : step.mapping && step.units > 0 ? "planned" : "nothing";
      this.db.prepare(`INSERT INTO burns (mint, event_id, settled_at, result, value, units, mapping_json, kind, note, prev_value, carry_in, carry_out, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(mint, e.id, e.at, e.result, e.value, step.units, step.mapping ? JSON.stringify(step.mapping) : null, step.kind, step.note, prev.value, prev.carryOut, step.carryOut, status, now, now);
      this.setState(mint, { lastEventId: e.id, lastValue: scalar && e.value !== null && e.result !== "void" ? e.value : prev.value, carryOut: step.carryOut, lastSettledAt: e.at }, now);
      return true;
    });
  }
  receipt(mint: string, eventId: string): ReceiptRow | null { const r = this.db.prepare("SELECT * FROM burns WHERE mint=? AND event_id=?").get(mint, eventId) as Row | undefined; return r ? toReceipt(r) : null; }
  receipts(mint: string): ReceiptRow[] { return (this.db.prepare("SELECT * FROM burns WHERE mint=? ORDER BY settled_at, event_id").all(mint) as Row[]).map(toReceipt); }
  pending(mint: string): ReceiptRow[] { return (this.db.prepare("SELECT * FROM burns WHERE mint=? AND status IN ('planned','sending') ORDER BY settled_at, event_id").all(mint) as Row[]).map(toReceipt); }
  /** Fixes the spend (buyback) or burn (vault) and the memo once; a retry sends the same bytes. */
  fixPlan(mint: string, eventId: string, x: { poolLamports: bigint | null; spendLamports: bigint | null; solUsd: number | null; vaultRaw: bigint | null; shortInRaw: bigint | null; shortOutRaw: bigint | null; burnRaw: bigint | null; memo: string }, now = Date.now()): ReceiptRow {
    this.db.prepare("UPDATE burns SET pool_lamports=?, spend_lamports=?, sol_usd=?, vault_raw=?, short_in_raw=?, short_out_raw=?, burn_raw=?, memo=?, updated_at=? WHERE mint=? AND event_id=? AND memo IS NULL")
      .run(x.poolLamports?.toString() ?? null, x.spendLamports?.toString() ?? null, x.solUsd, x.vaultRaw?.toString() ?? null, x.shortInRaw?.toString() ?? null, x.shortOutRaw?.toString() ?? null, x.burnRaw?.toString() ?? null, x.memo, now, mint, eventId);
    return this.receipt(mint, eventId)!;
  }
  /** The shortfall the next vault-mode receipt inherits: the latest final receipt's carried-out shortfall before this event. */
  shortfallBefore(mint: string, settledAt: string): bigint {
    const r = this.db.prepare("SELECT short_out_raw s FROM burns WHERE mint=? AND settled_at<? AND status IN ('confirmed','exhausted') ORDER BY settled_at DESC LIMIT 1").get(mint, settledAt) as { s: string | null } | undefined;
    return r?.s ? BigInt(r.s) : BigInt(0);
  }
  markSkipped(mint: string, eventId: string, reason: string, now = Date.now()): void { this.db.prepare("UPDATE burns SET status='skipped', skipped_reason=?, burn_raw='0', last_error=NULL, next_attempt_at=NULL, updated_at=? WHERE mint=? AND event_id=?").run(reason.slice(0, 300), now, mint, eventId); }
  markExhausted(mint: string, eventId: string, now = Date.now()): void { this.db.prepare("UPDATE burns SET status='exhausted', burn_raw='0', last_error=NULL, next_attempt_at=NULL, updated_at=? WHERE mint=? AND event_id=?").run(now, mint, eventId); }
  recordSignature(s: Omit<SignatureRow, "status" | "err" | "slot">): void {
    this.tx(() => {
      this.db.prepare("INSERT INTO signatures (signature, mint, event_id, memo, burn_raw, spend_lamports, blockhash, last_valid_block_height, sent_at, status) VALUES (?,?,?,?,?,?,?,?,?,'sent')").run(s.signature, s.mint, s.eventId, s.memo, s.burnRaw.toString(), s.spendLamports.toString(), s.blockhash, s.lastValidBlockHeight, s.sentAt);
      this.db.prepare("UPDATE burns SET status='sending', attempts=attempts+1, updated_at=? WHERE mint=? AND event_id=?").run(s.sentAt, s.mint, s.eventId);
    });
  }
  signatures(mint: string, eventId: string): SignatureRow[] { return (this.db.prepare("SELECT * FROM signatures WHERE mint=? AND event_id=? ORDER BY sent_at").all(mint, eventId) as Row[]).map(toSig); }
  setSignatureStatus(signature: string, status: SignatureRow["status"], err: string | null, slot: number | null): void { this.db.prepare("UPDATE signatures SET status=?, err=?, slot=COALESCE(?, slot) WHERE signature=?").run(status, err, slot, signature); }
  markConfirmed(mint: string, eventId: string, c: { signature: string; slot: number | null; spentLamports: bigint | null; gotRaw: bigint | null; burnRaw: bigint; memo: string }, now = Date.now()): void {
    this.tx(() => {
      this.db.prepare("UPDATE burns SET status='confirmed', signature=?, slot=?, spend_lamports=COALESCE(?, spend_lamports), got_raw=?, burn_raw=?, memo=?, confirmed_at=?, last_error=NULL, next_attempt_at=NULL, updated_at=? WHERE mint=? AND event_id=?")
        .run(c.signature, c.slot, c.spentLamports?.toString() ?? null, c.gotRaw?.toString() ?? null, c.burnRaw.toString(), c.memo, now, now, mint, eventId);
      this.db.prepare("UPDATE signatures SET status='confirmed', slot=COALESCE(?, slot) WHERE signature=?").run(c.slot, c.signature);
    });
  }
  noteError(mint: string, eventId: string, err: string, nextAttemptAt: number, now = Date.now()): void { this.db.prepare("UPDATE burns SET last_error=?, next_attempt_at=?, updated_at=? WHERE mint=? AND event_id=?").run(err.slice(0, 500), nextAttemptAt, now, mint, eventId); }
  setReceiptStatus(mint: string, eventId: string, status: ReceiptStatus, now = Date.now()): void { this.db.prepare("UPDATE burns SET status=?, updated_at=? WHERE mint=? AND event_id=?").run(status, now, mint, eventId); }
  totalBurnedRaw(mint: string): bigint { return this.receipts(mint).filter((b) => b.status === "confirmed" || (b.status === "skipped" && b.execution === "program")).reduce((a, b) => a + (b.burnRaw ?? BigInt(0)), BigInt(0)); }

  // ---- program execution (2026-10-10) ----
  /** The latest confirmed program transaction of a kind ("reading" | "crank") for a mint: its date and signature. */
  lastProgramTx(mint: string, kind: "reading" | "crank"): { date: string; signature: string } | null {
    const r = this.db.prepare("SELECT event_id, signature FROM signatures WHERE mint=? AND event_id LIKE ? AND status='confirmed' ORDER BY event_id DESC, sent_at DESC LIMIT 1").get(mint, `${kind}:%`) as { event_id: string; signature: string } | undefined;
    return r ? { date: r.event_id.slice(kind.length + 1), signature: r.signature } : null;
  }
  /** The receipts counted into program reading `readingDate` (YYYYMMDD), oldest first. */
  receiptsForReading(mint: string, readingDate: number): ReceiptRow[] { return (this.db.prepare("SELECT * FROM burns WHERE mint=? AND reading_date=? ORDER BY settled_at, event_id").all(mint, readingDate) as Row[]).map(toReceipt); }
  /** The reading landed on chain: these receipts' units are in it (written once — a trigger refuses a second assignment). */
  assignReading(mint: string, eventIds: readonly string[], readingDate: number, now = Date.now()): void {
    this.tx(() => { for (const e of eventIds) this.db.prepare("UPDATE burns SET reading_date=?, execution='program', updated_at=? WHERE mint=? AND event_id=? AND reading_date IS NULL").run(readingDate, now, mint, e); });
  }
  /** The receipts of a reading move to 'sending' (their crank's signature was just written ahead). */
  markReadingSending(mint: string, readingDate: number, now = Date.now()): void { this.db.prepare("UPDATE burns SET status='sending', wait_reason=NULL, attempts=attempts+1, updated_at=? WHERE mint=? AND reading_date=? AND status IN ('planned','sending')").run(now, mint, readingDate); }
  /** A crank that cannot run yet: a WAIT (no error, no attempt counted), retried at `nextAttemptAt`. */
  setReadingWait(mint: string, readingDate: number, reason: string, nextAttemptAt: number, now = Date.now()): void {
    this.db.prepare("UPDATE burns SET status='planned', wait_reason=?, last_error=NULL, next_attempt_at=?, updated_at=? WHERE mint=? AND reading_date=? AND status IN ('planned','sending')").run(reason.slice(0, 300), nextAttemptAt, now, mint, readingDate);
  }
  noteReadingError(mint: string, readingDate: number, err: string, nextAttemptAt: number, now = Date.now()): void {
    this.db.prepare("UPDATE burns SET status='planned', last_error=?, next_attempt_at=?, updated_at=? WHERE mint=? AND reading_date=? AND status IN ('planned','sending')").run(err.slice(0, 500), nextAttemptAt, now, mint, readingDate);
  }
  /**
   * The reading's crank landed: every amount is the program's (its Reading account). The LEAD receipt carries them; the others of the
   * same reading carry zeros, the same signature and memo. burned / short → confirmed; below-floor / no-units → skipped; exhausted.
   */
  markProgramOutcome(mint: string, readingDate: number, f: { signature: string; slot: number | null; outcome: string; memo: string | null; poolLamports: bigint; poolActualLamports: bigint; spentLamports: bigint; ruleSpendLamports: bigint; carriedInLamports: bigint; carriedOutLamports: bigint; gotRaw: bigint; burnRaw: bigint; shortfallRaw: bigint; skippedReason: string | null }, now = Date.now()): void {
    const status: ReceiptStatus = f.outcome === "burned" || f.outcome === "short" ? "confirmed" : f.outcome === "exhausted" ? "exhausted" : "skipped";
    const rows = this.receiptsForReading(mint, readingDate).filter((b) => b.status === "planned" || b.status === "sending");
    this.tx(() => {
      rows.forEach((b, k) => {
        const lead = k === 0, z = "0";
        this.db.prepare(`UPDATE burns SET status=?, execution='program', signature=?, slot=?, memo=COALESCE(?, memo), chain_outcome=?, lead=?, pool_lamports=?, pool_actual_lamports=?, spend_lamports=?, rule_spend_lamports=?, carried_in_lamports=?, carried_out_lamports=?,
          got_raw=?, burn_raw=?, short_out_raw=?, skipped_reason=?, wait_reason=NULL, confirmed_at=?, last_error=NULL, next_attempt_at=NULL, updated_at=? WHERE mint=? AND event_id=?`)
          .run(status, f.signature, f.slot, f.memo, f.outcome, lead ? 1 : 0,
            lead ? f.poolLamports.toString() : z, lead ? f.poolActualLamports.toString() : z, lead ? f.spentLamports.toString() : z, lead ? f.ruleSpendLamports.toString() : z, lead ? f.carriedInLamports.toString() : z, lead ? f.carriedOutLamports.toString() : z,
            lead ? f.gotRaw.toString() : z, lead ? f.burnRaw.toString() : z, lead ? f.shortfallRaw.toString() : z, status === "skipped" ? (f.skippedReason ?? `chain outcome ${f.outcome}`).slice(0, 300) : null, now, now, mint, b.eventId);
      });
      this.db.prepare("UPDATE signatures SET status='confirmed', slot=COALESCE(?, slot) WHERE signature=?").run(f.slot, f.signature);
    });
  }

  // ---- feed state ----
  feedState(selectorKey: string): FeedState { const r = this.db.prepare("SELECT * FROM feed_state WHERE selector_key=?").get(selectorKey) as Row | undefined; return r ? { selectorKey, lastFetchAt: numOrNull(r.last_fetch_at), lastOkAt: numOrNull(r.last_ok_at), failures: Number(r.failures), lastError: strOrNull(r.last_error), nextFetchAt: numOrNull(r.next_fetch_at) } : { selectorKey, lastFetchAt: null, lastOkAt: null, failures: 0, lastError: null, nextFetchAt: null }; }
  setFeedState(s: FeedState): void { this.db.prepare("INSERT INTO feed_state (selector_key, last_fetch_at, last_ok_at, failures, last_error, next_fetch_at) VALUES (?,?,?,?,?,?) ON CONFLICT(selector_key) DO UPDATE SET last_fetch_at=excluded.last_fetch_at, last_ok_at=excluded.last_ok_at, failures=excluded.failures, last_error=excluded.last_error, next_fetch_at=excluded.next_fetch_at").run(s.selectorKey, s.lastFetchAt, s.lastOkAt, s.failures, s.lastError, s.nextFetchAt); }

  // ---- rivalry pairs ----
  /** Links two registered tokens as a pair. Both rules must carry the pairId (A side A, B side B naming A's mint) and share the selector key. */
  registerPair(pairId: string, mintA: string, mintB: string, now = Date.now()): PairRow {
    const a = this.token(mintA), b = this.token(mintB);
    if (!a || !b) throw new Error("registry: both tokens must be registered before pairing");
    const ra = this.lockedRule(a).rule, rb = this.lockedRule(b).rule;
    if (ra.pair?.pairId !== pairId || ra.pair.side !== "A") throw new Error(`registry: ${a.ticker}'s rule is not side A of ${pairId}`);
    if (rb.pair?.pairId !== pairId || rb.pair.side !== "B" || rb.pair.counterpartMint !== mintA) throw new Error(`registry: ${b.ticker}'s rule is not side B of ${pairId} naming ${mintA}`);
    if (a.selectorKey !== b.selectorKey) throw new Error("registry: a pair shares one selector key");
    this.db.prepare("INSERT INTO pairs (pair_id, mint_a, mint_b, selector_key, created_at) VALUES (?,?,?,?,?)").run(pairId, mintA, mintB, a.selectorKey, now);
    return this.pair(pairId)!;
  }
  pair(pairId: string): PairRow | null { const r = this.db.prepare("SELECT * FROM pairs WHERE pair_id=?").get(pairId) as Row | undefined; return r ? { pairId: String(r.pair_id), mintA: String(r.mint_a), mintB: String(r.mint_b), selectorKey: String(r.selector_key), createdAt: Number(r.created_at) } : null; }
  pairOf(mint: string): PairRow | null { const r = this.db.prepare("SELECT * FROM pairs WHERE mint_a=? OR mint_b=?").get(mint, mint) as Row | undefined; return r ? { pairId: String(r.pair_id), mintA: String(r.mint_a), mintB: String(r.mint_b), selectorKey: String(r.selector_key), createdAt: Number(r.created_at) } : null; }
  pairs(): PairRow[] { return (this.db.prepare("SELECT * FROM pairs ORDER BY created_at").all() as Row[]).map((r) => ({ pairId: String(r.pair_id), mintA: String(r.mint_a), mintB: String(r.mint_b), selectorKey: String(r.selector_key), createdAt: Number(r.created_at) })); }

  // ---- attesters ----
  addAttester(a: Omit<AttesterRow, "active"> & { active?: boolean }): void { this.db.prepare("INSERT INTO attesters (mint, pubkey, role, added_at, active, timelock_until) VALUES (?,?,?,?,?,?) ON CONFLICT(mint, pubkey) DO UPDATE SET role=excluded.role, active=excluded.active, timelock_until=excluded.timelock_until").run(a.mint, a.pubkey, a.role, a.addedAt, a.active === false ? 0 : 1, a.timelockUntil); }
  attesters(mint: string): AttesterRow[] { return (this.db.prepare("SELECT * FROM attesters WHERE mint=? ORDER BY added_at").all(mint) as Row[]).map((r) => ({ mint: String(r.mint), pubkey: String(r.pubkey), role: String(r.role) as AttesterRow["role"], addedAt: Number(r.added_at), active: Number(r.active) === 1, timelockUntil: numOrNull(r.timelock_until) })); }
}

export const openRegistry = (file: string): Registry => new Registry(file);
export const REGISTRY_FILE = path.join("data", "burnticker.db");
