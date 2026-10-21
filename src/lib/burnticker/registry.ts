import { safeRegexTest } from "@/lib/burnticker/safeRegex";
import type { LockFeeClaimRow } from "@/lib/burnticker/lockFees";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { lockRule, meetingsMirrorId, type BurnMapping, type BurnRule, type LockedRule, type RuleMode } from "@/lib/burnticker/rules";
import type { SettledEvent } from "@/lib/burnticker/units";
import { derbyReadingInSeason } from "@/lib/burnticker/derby/season";
import { refuseDefaultDataFileUnderTest } from "@/lib/burnticker/testGuard";

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
/** AUDIT A C1: a create whose block time is this far past the 24 h window still counts as in time (clock skew, a slow last confirmation). */
export const DRAFT_GRACE_MS = 10 * 60 * 1000;
/**
 * B-19 (seventh prelaunch audit, 2026-10-20): an UNPROVEN draft is one a public prepare registered without a wallet that proved control
 * and held the launch's cost (handlers.ts holdProven). Anyone can make one up, so it holds its ticker only against other unproven
 * prepares, and only for this long after it was written; a proven creator is never refused by it. A draft whose create was reported as
 * sent (draft_sends, signatures checked) holds like any other for SENT_HOLD_MS after the report, and after that only once its create
 * is seen on chain (HB-187). Its own creator can still finish it for the full DRAFT_TTL_MS.
 * The mark is a row in `status` under this prefix (no schema change); drafts without the mark, every row written before 2026-10-20 and
 * every in-process caller's draft, hold as before.
 */
export const UNPROVEN_HOLD_MS = 15 * 60 * 1000;
export const UNPROVEN_DRAFT_PREFIX = "draft.unproven.";
/**
 * HB-187 (eighth audit LA8-1, 2026-10-20): a recorded send makes an unproven draft hold only while that create could still land, this
 * long after the report (launchPending.ts CREATE_SEND_PENDING_MS, the same 5 minutes). Signing a create costs nothing and the report is
 * checked on signatures alone, so a send that old proves nothing; from then on the draft holds only once its create is seen on chain
 * (launchPending.ts proveLandedDrafts marks it proven; no chain answer leaves it unproven).
 */
export const SENT_HOLD_MS = 5 * 60 * 1000;
/**
 * HB-187 follow-up: when this host has a chain reader but the read after SENT_HOLD_MS failed (the RPC is down), the sent draft keeps
 * holding, but never longer than this after its report, so a short outage cannot strand a real creator and a squatter cannot hold a
 * ticker for hours. The mark (`status` under SEND_UNREAD_PREFIX) is set by a failed read and cleared by the next read that answers.
 * A host with no chain reader sets no mark (no hold after SENT_HOLD_MS).
 */
export const SENT_HOLD_FAIL_MAX_MS = 60 * 60 * 1000;
export const SEND_UNREAD_PREFIX = "draft.sendUnread.";
/** Whether a create with this block time landed inside its draft's window (judged on the block time, never on when a sweep ran). */
export const inDraftWindow = (createdAtMs: number, blockTimeMs: number): boolean => blockTimeMs <= createdAtMs + DRAFT_TTL_MS + DRAFT_GRACE_MS;
export interface TokenRow {
  mint: string; ticker: string; name: string; creator: string; description: string; imageUrl: string | null; links: { label: string; url: string }[];
  oracle: BurnRule["oracle"]; selectorKey: string; rulesJson: string; rulesSha: string; mode: RuleMode; feePda: string; vault: string | null;
  tokenConfig: string | null; poolId: string | null; launchTx: string | null; cluster: string; platformId: string | null;
  /** Settlements strictly after this ISO time count (the token's baseline = its launch time). */
  baselineAt: string; createdAt: number; status: TokenStatus;
}

export interface TokenMeta { mint: string; creatorNote: string; metadataUri: string | null; metadataTx: string | null; metadataSha256: string | null; imageUri: string | null; imageTx: string | null; imageSha256: string | null; /** true only for a devnet script coin under BURNTICKER_ALLOW_HOSTED_METADATA */ hosted: boolean; createdAt: number }

export interface ReadingRow extends SettledEvent { oracle: string; selectorKey: string; settlementSourceUrl: string | null; method: string | null; proof: string | null; attestedBy: string[]; fetchedAt: number }

/**
 * "pending-pair": a clause pair's event burn read before both coins had a registered pool (rules.ts PairField) — it waits, and becomes
 * "planned" (in order) when the second pool registers, or "voided" (final, never executed) if the pair voids.
 */
export type ReceiptStatus = "planned" | "sending" | "confirmed" | "skipped" | "void" | "exhausted" | "nothing" | "pending-pair" | "voided" | "forwarded";
/**
 * WINNER TAKES THE BURN (2026-10-11): a pair receipt's role for its result — "won" (this coin's fuel burns this coin), "lost" (this
 * coin's fuel for the result forwards to the winner's burn pool: the units are the ones it would have had had it won), "draw".
 */
export type PairRole = "won" | "lost" | "draw";
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
  /** Winner takes the burn: the receipt's pair role (null outside a winner-takes-the-burn pair, and on receipts written before it). */
  pairRole: PairRole | null;
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
-- Owner 2026-10-12: tickers are not unique; every lookup and link resolves by mint (coinKey.ts). The old one-holder-per-ticker index
-- is dropped on open, and a plain index serves tokensByTicker.
DROP INDEX IF EXISTS tokens_ticker_held;
CREATE INDEX IF NOT EXISTS tokens_by_ticker ON tokens (ticker, status);
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
-- BOTH OR NEITHER (2026-10-10): a clause pair's one terminal state — 'live' (both pools registered before voidBy ended) or 'voided'.
-- Written once by the keeper; append-only.
CREATE TABLE IF NOT EXISTS pair_outcomes (pair_id TEXT PRIMARY KEY, state TEXT NOT NULL, at INTEGER NOT NULL, detail TEXT);
-- NO BURN POOL IS EVER LEFT BEHIND (2026-10-10): when and why a token's rule ENDED, and how its pool is spent from then on
-- ('drain' after a one-shot YES at 100 %, else 'winddown'); written once by the keeper; append-only.
CREATE TABLE IF NOT EXISTS rule_ends (mint TEXT PRIMARY KEY, mode TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL);
-- What was pinned for a coin at launch (2026-10-10, "nothing about a coin can change after launch"): the creator's note (≤ 140, linted,
-- never part of the description) and the Arweave copies of the metadata JSON and the receipt-art PNG with their sha256. Written once.
-- LP LOCKED FOREVER, ITS FEES FUND THE BURN (owner decision 2026-10-10): one row per confirmed claim_lock_fees — what the program moved
-- (SOL side → 80 % burn pool / 20 % operator, coin side burned), read from chain after confirmation. Append-only.
CREATE TABLE IF NOT EXISTS lock_fee_claims (signature TEXT PRIMARY KEY, mint TEXT NOT NULL, at INTEGER NOT NULL, slot INTEGER, sol_lamports TEXT NOT NULL, burn_pool_lamports TEXT NOT NULL, operator_lamports TEXT NOT NULL, token_burned_raw TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS lock_fee_claims_by_mint ON lock_fee_claims (mint, at);
-- WINNER TAKES THE BURN (owner decision 2026-10-11): one row per landed forward_to_winner — the loser's fuel for one result moved to the
-- winner's burn pool (the program's facts from its memo / event, read after confirmation). Append-only.
CREATE TABLE IF NOT EXISTS pair_forwards (signature TEXT PRIMARY KEY, pair_id TEXT NOT NULL, record_date INTEGER NOT NULL, loser_mint TEXT NOT NULL, winner_mint TEXT NOT NULL, units INTEGER NOT NULL, pool_lamports TEXT NOT NULL, lamports TEXT NOT NULL, sol_lamports TEXT NOT NULL, wsol_lamports TEXT NOT NULL, at INTEGER NOT NULL, slot INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS pair_forwards_once ON pair_forwards (pair_id, record_date, loser_mint);
-- TEST COINS (owner 2026-10-14: "hide the test coins"): the operator marks a disclosed test launch made through the site. A marked coin is
-- left off every browse surface (coins list, home, search, leaderboard, sitemap, tokens.html) and listed on /burnticker/test-coins; its
-- own page stays reachable by link. Its own table, so no column is added to tokens; testCoins.ts holds the rule.
CREATE TABLE IF NOT EXISTS token_flags (mint TEXT PRIMARY KEY, test INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL);
-- AUDIT A C1 (2026-10-15): A COIN CREATED IN ITS DRAFT'S WINDOW IS NEVER LOST TO THE SWEEP. draft_revivals: a draft taken live from a
-- launch verified on chain that the sweep had marked EXPIRED, or whose create landed AFTER the draft's window (operator only, --late):
-- the signature, its block time, whether that block time fell inside the window, and who did it. The tokens_expired_final trigger lets a
-- row leave 'expired' only for 'live' with a revival row naming the same launch transaction. Written once; append-only.
CREATE TABLE IF NOT EXISTS draft_revivals (mint TEXT PRIMARY KEY, launch_tx TEXT NOT NULL, block_time_ms INTEGER NOT NULL, within_window INTEGER NOT NULL, source TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS token_meta (mint TEXT PRIMARY KEY, creator_note TEXT NOT NULL DEFAULT '', metadata_uri TEXT, metadata_tx TEXT, metadata_sha256 TEXT, image_uri TEXT, image_tx TEXT, image_sha256 TEXT, hosted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, note TEXT NOT NULL);
-- THIRD PRELAUNCH AUDIT 2026-10-19 F04: a ticker held for a prepare that is still checking and uploading (reserveTicker), so two creators'
-- prepares for one unused ticker cannot both pass and both register. One row per ticker; a row past expires_at is free; the creator's
-- draft (register) or the end of the prepare (releaseTicker) removes it. A working table, not a record: rows are deleted.
CREATE TABLE IF NOT EXISTS ticker_reservations (ticker TEXT PRIMARY KEY, creator TEXT NOT NULL, mint TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
-- B-2 (third audit 2026-10-19): a draft whose LaunchLab create was SENT (the launch page posts the creator-signed create just before it
-- sends it; launchPending.ts checks the signatures). Its creator's next prepare of the same ticker is refused as launch-pending until the
-- send can no longer land, so a refresh while the first create is in flight never builds and pays for a second coin. Append-only.
CREATE TABLE IF NOT EXISTS draft_sends (mint TEXT NOT NULL, signature TEXT NOT NULL, sent_at INTEGER NOT NULL, PRIMARY KEY (mint, signature));
`;

/**
 * THE REGISTRY'S SCHEMA VERSION (2026-10-18 prelaunch audit A-32: the file carried no version, so a backup, a restore or an auditor's
 * copy could not say which layout it holds). One row per version in schema_version (append-only, like the facts): written by the
 * constructor once that version's changes are in the file, with the date it was reached and a note on what it changed.
 *
 * HOW TO CHANGE THE SCHEMA: make the change idempotent in the constructor (CREATE ... IF NOT EXISTS, or a PRAGMA table_info check
 * before ALTER TABLE, as below), then add the next entry here with what it does. Never edit or reuse an earlier entry: a file that
 * already holds version N keeps the note it was given. A version is recorded only after every change up to it has run, so the highest
 * row is the layout the file is in.
 */
export const REGISTRY_MIGRATIONS: readonly { version: number; note: string }[] = [
  { version: 1, note: "2026-10-18: schema versions start. Everything before this date is applied in place on open (burns' program-execution columns and readings.proof 2026-10-10, the tokens ticker-uniqueness rebuild, lock_fee_claims paid/pending, token_flags.synthetic 2026-10-15, tokens_expired_final narrowed to the verified revival 2026-10-15), so a file of any earlier age is at version 1 once opened." },
  { version: 2, note: "2026-10-19: adds the ticker_reservations table (ticker, creator, mint, expires_at, created_at), the short hold a prepare takes on a ticker before it uploads, so two creators cannot both register one unused ticker (third prelaunch audit F04)." },
  { version: 3, note: "2026-10-19: adds the append-only draft_sends table (mint, signature, sent_at): a draft whose create the launch page reported as sent, so its creator cannot prepare a second coin on the same ticker while it can still land (third audit B-2)." },
];
export const REGISTRY_SCHEMA_VERSION = REGISTRY_MIGRATIONS[REGISTRY_MIGRATIONS.length - 1].version;

/**
 * HB-61 (sixth pre-launch audit 2026-10-19, OP6-3): publish 92 migrated the registry to schema 3, its smoke failed falsely, and the deploy
 * swapped back to publish 91, which refused every launch for 20 minutes (I-17). The registry now writes the schema version its file is at
 * to data/schema-version.json (next to the registry file) each time it opens a file whose version differs from the one written there;
 * the deploy's swap (scripts/ops/swap-web-build.sh) reads it and refuses to switch to a build whose code knows a lower version.
 */
export const SCHEMA_VERSION_FILE_NAME = "schema-version.json";
export function writeSchemaVersionFile(target: string, version: number, at = Date.now()): void {
  try {
    try { const prev = JSON.parse(fs.readFileSync(target, "utf8")) as { version?: unknown }; if (prev.version === version) return; } catch { /* absent or unreadable: written below */ }
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version, writtenAt: new Date(at).toISOString(), codeKnows: REGISTRY_SCHEMA_VERSION }) + "\n");
    fs.renameSync(tmp, target);
  } catch { /* the deploy then cannot compare and says so; the registry itself is unaffected */ }
}

/** Columns added to burns for program execution (2026-10-10), added in place to an older registry file. */
const BURN_PROGRAM_COLUMNS: [string, string][] = [
  ["pair_role", "TEXT"],
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
CREATE TRIGGER IF NOT EXISTS tokens_baseline_fixed BEFORE UPDATE OF baseline_at ON tokens WHEN OLD.launch_tx IS NOT NULL AND NEW.baseline_at IS NOT OLD.baseline_at
  BEGIN SELECT RAISE(ABORT, 'tokens: the baseline is fixed at launch'); END;
CREATE TRIGGER IF NOT EXISTS tokens_expired_final BEFORE UPDATE OF status ON tokens WHEN OLD.status = 'expired' AND NEW.status <> 'expired'
  AND NOT (NEW.status = 'live' AND OLD.launch_tx IS NULL AND NEW.launch_tx IS NOT NULL AND EXISTS (SELECT 1 FROM draft_revivals r WHERE r.mint = OLD.mint AND r.launch_tx = NEW.launch_tx))
  BEGIN SELECT RAISE(ABORT, 'tokens: an expired draft stays expired (build a fresh bundle) unless its launch is verified on chain (draft_revivals)'); END;
CREATE TRIGGER IF NOT EXISTS draft_revivals_no_update BEFORE UPDATE ON draft_revivals BEGIN SELECT RAISE(ABORT, 'draft_revivals: append-only'); END;
CREATE TRIGGER IF NOT EXISTS draft_sends_no_update BEFORE UPDATE ON draft_sends BEGIN SELECT RAISE(ABORT, 'draft_sends: append-only'); END;
CREATE TRIGGER IF NOT EXISTS draft_sends_no_delete BEFORE DELETE ON draft_sends BEGIN SELECT RAISE(ABORT, 'draft_sends: append-only'); END;
CREATE TRIGGER IF NOT EXISTS draft_revivals_no_delete BEFORE DELETE ON draft_revivals BEGIN SELECT RAISE(ABORT, 'draft_revivals: append-only'); END;
CREATE TRIGGER IF NOT EXISTS tokens_expire_drafts_only BEFORE UPDATE OF status ON tokens WHEN NEW.status = 'expired' AND OLD.status <> 'draft' AND OLD.status <> 'expired'
  BEGIN SELECT RAISE(ABORT, 'tokens: only a draft can expire'); END;
CREATE TRIGGER IF NOT EXISTS readings_no_update BEFORE UPDATE ON readings BEGIN SELECT RAISE(ABORT, 'readings: append-only'); END;
CREATE TRIGGER IF NOT EXISTS readings_no_delete BEFORE DELETE ON readings BEGIN SELECT RAISE(ABORT, 'readings: append-only'); END;
CREATE TRIGGER IF NOT EXISTS burns_facts_immutable BEFORE UPDATE OF mint, event_id, settled_at, result, value, units, mapping_json, kind, prev_value, carry_in, carry_out, created_at ON burns
  BEGIN SELECT RAISE(ABORT, 'burns: the facts of a receipt are immutable'); END;
CREATE TRIGGER IF NOT EXISTS burns_plan_once BEFORE UPDATE OF memo, pool_lamports, spend_lamports ON burns WHEN OLD.memo IS NOT NULL AND (NEW.memo IS NOT OLD.memo OR NEW.pool_lamports IS NOT OLD.pool_lamports OR NEW.spend_lamports IS NOT OLD.spend_lamports) AND OLD.status <> 'sending' AND OLD.status <> 'planned'
  BEGIN SELECT RAISE(ABORT, 'burns: a fixed plan is not rewritten'); END;
CREATE TRIGGER IF NOT EXISTS burns_forwarded_frozen BEFORE UPDATE ON burns WHEN OLD.status = 'forwarded'
  BEGIN SELECT RAISE(ABORT, 'burns: a forwarded receipt is final'); END;
CREATE TRIGGER IF NOT EXISTS burns_pair_role_once BEFORE UPDATE OF pair_role ON burns WHEN OLD.pair_role IS NOT NULL AND NEW.pair_role IS NOT OLD.pair_role
  BEGIN SELECT RAISE(ABORT, 'burns: a receipt''s pair role is part of its facts'); END;
CREATE TRIGGER IF NOT EXISTS pair_forwards_no_update BEFORE UPDATE ON pair_forwards BEGIN SELECT RAISE(ABORT, 'pair_forwards: append-only'); END;
CREATE TRIGGER IF NOT EXISTS pair_forwards_no_delete BEFORE DELETE ON pair_forwards BEGIN SELECT RAISE(ABORT, 'pair_forwards: append-only'); END;
CREATE TRIGGER IF NOT EXISTS burns_confirmed_frozen BEFORE UPDATE ON burns WHEN OLD.status IN ('confirmed', 'void', 'exhausted')
  BEGIN SELECT RAISE(ABORT, 'burns: a final receipt is frozen'); END;
CREATE TRIGGER IF NOT EXISTS burns_no_delete BEFORE DELETE ON burns BEGIN SELECT RAISE(ABORT, 'burns: append-only'); END;
CREATE TRIGGER IF NOT EXISTS signatures_no_delete BEFORE DELETE ON signatures BEGIN SELECT RAISE(ABORT, 'signatures: append-only'); END;
CREATE TRIGGER IF NOT EXISTS signatures_identity_immutable BEFORE UPDATE OF signature, mint, event_id, memo, burn_raw, spend_lamports, blockhash, sent_at ON signatures
  BEGIN SELECT RAISE(ABORT, 'signatures: identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS alerts_no_update BEFORE UPDATE ON alerts BEGIN SELECT RAISE(ABORT, 'alerts: append-only'); END;
CREATE TRIGGER IF NOT EXISTS alerts_no_delete BEFORE DELETE ON alerts BEGIN SELECT RAISE(ABORT, 'alerts: append-only'); END;
CREATE TRIGGER IF NOT EXISTS pairs_no_update BEFORE UPDATE ON pairs BEGIN SELECT RAISE(ABORT, 'pairs: append-only'); END;
CREATE TRIGGER IF NOT EXISTS schema_version_no_update BEFORE UPDATE ON schema_version BEGIN SELECT RAISE(ABORT, 'schema_version: append-only'); END;
CREATE TRIGGER IF NOT EXISTS schema_version_no_delete BEFORE DELETE ON schema_version BEGIN SELECT RAISE(ABORT, 'schema_version: append-only'); END;
CREATE TRIGGER IF NOT EXISTS pairs_no_delete BEFORE DELETE ON pairs BEGIN SELECT RAISE(ABORT, 'pairs: append-only'); END;
CREATE TRIGGER IF NOT EXISTS pair_outcomes_no_update BEFORE UPDATE ON pair_outcomes BEGIN SELECT RAISE(ABORT, 'pair_outcomes: a pair goes live or voids once'); END;
CREATE TRIGGER IF NOT EXISTS pair_outcomes_no_delete BEFORE DELETE ON pair_outcomes BEGIN SELECT RAISE(ABORT, 'pair_outcomes: append-only'); END;
CREATE TRIGGER IF NOT EXISTS rule_ends_no_update BEFORE UPDATE ON rule_ends BEGIN SELECT RAISE(ABORT, 'rule_ends: a rule ends once'); END;
CREATE TRIGGER IF NOT EXISTS token_meta_no_update BEFORE UPDATE ON token_meta BEGIN SELECT RAISE(ABORT, 'token_meta: written once at launch'); END;
CREATE TRIGGER IF NOT EXISTS token_meta_no_delete BEFORE DELETE ON token_meta BEGIN SELECT RAISE(ABORT, 'token_meta: append-only'); END;
CREATE TRIGGER IF NOT EXISTS tokens_text_immutable BEFORE UPDATE OF name, description, image_url, links_json ON tokens
  BEGIN SELECT RAISE(ABORT, 'tokens: the name, description, image and links are fixed at launch'); END;
CREATE TRIGGER IF NOT EXISTS lock_fee_claims_no_update BEFORE UPDATE ON lock_fee_claims BEGIN SELECT RAISE(ABORT, 'lock_fee_claims: append-only'); END;
CREATE TRIGGER IF NOT EXISTS lock_fee_claims_no_delete BEFORE DELETE ON lock_fee_claims BEGIN SELECT RAISE(ABORT, 'lock_fee_claims: append-only'); END;
CREATE TRIGGER IF NOT EXISTS rule_ends_no_delete BEFORE DELETE ON rule_ends BEGIN SELECT RAISE(ABORT, 'rule_ends: append-only'); END;
CREATE TRIGGER IF NOT EXISTS burns_voided_frozen BEFORE UPDATE ON burns WHEN OLD.status = 'voided'
  BEGIN SELECT RAISE(ABORT, 'burns: a voided receipt is final'); END;
CREATE TRIGGER IF NOT EXISTS burns_pending_pair_moves BEFORE UPDATE OF status ON burns WHEN OLD.status = 'pending-pair' AND NEW.status NOT IN ('pending-pair', 'planned', 'voided')
  BEGIN SELECT RAISE(ABORT, 'burns: a pending-pair receipt becomes planned or voided'); END;
`;

export interface PairForwardRow { signature: string; pairId: string; recordDate: number; loserMint: string; winnerMint: string; units: number; poolLamports: bigint; lamports: bigint; solLamports: bigint; wsolLamports: bigint; at: number; slot: number | null }
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
  ruleSpendLamports: bigOrNull(r.rule_spend_lamports), carriedInLamports: bigOrNull(r.carried_in_lamports), carriedOutLamports: bigOrNull(r.carried_out_lamports), poolActualLamports: bigOrNull(r.pool_actual_lamports), lead: r.lead === null || r.lead === undefined ? null : Number(r.lead) === 1, pairRole: r.pair_role === null || r.pair_role === undefined ? null : (String(r.pair_role) as PairRole) });
const toSig = (r: Row): SignatureRow => ({ signature: String(r.signature), mint: String(r.mint), eventId: String(r.event_id), memo: String(r.memo), burnRaw: BigInt(String(r.burn_raw)), spendLamports: BigInt(String(r.spend_lamports)), blockhash: String(r.blockhash), lastValidBlockHeight: Number(r.last_valid_block_height), sentAt: Number(r.sent_at), status: String(r.status) as SignatureRow["status"], err: strOrNull(r.err), slot: numOrNull(r.slot) });

/**
 * The key readings are stored under: the feed id; one Kalshi market; or a Kalshi series PLUS the rule kind — a series read as
 * binaries (one reading per market) and the same series read as scalars (one per event) are two different reading streams. Tokens
 * on one key share its readings and apply their own filter at plan time. Polymarket (binary only): `polymarket:market:<condition id>`
 * or `polymarket:<series>:binary` ("polymarket:tag:nfl/moneyline:binary").
 */
export function selectorKeyOf(rule: BurnRule): string {
  if (rule.oracle === "derby") return `derby:${rule.series}`;
  if (rule.oracle === "catalogue") return `catalogue:${rule.series}`;
  if (rule.oracle === "polymarket") return rule.market ? `polymarket:market:${rule.market}` : `polymarket:${rule.series}:${rule.kind}`;
  return rule.market ? `kalshi:market:${rule.market}` : `kalshi:${rule.series}:${rule.kind}`;
}

/** The rule the keeper FETCHES with for a key: the token's rule with its filter cleared, so the whole series is stored. */
export function wideRule(rule: BurnRule): BurnRule { return rule.market ? rule : { ...rule, filter: {} }; }

/** Does a stored reading fall under this token's filter? (`tickerIncludes` over the event id, `titleRegex` over the title.) */
export function readingMatches(rule: BurnRule, r: { id: string; title: string | null; at?: string }): boolean {
  // Burn Derby (2026-10-10): coin-vs-coin pairs on one matchup share its readings; each token counts only its own season's windows.
  if (rule.oracle === "derby") return derbyReadingInSeason(rule, r);
  if (rule.oracle === "catalogue" || rule.market) return true;
  if (rule.filter.tickerIncludes && !r.id.includes(rule.filter.tickerIncludes)) return false;
  if (rule.filter.titleRegex && !safeRegexTest(rule.filter.titleRegex, r.title ?? "")) return false;   // audit 6 item 8: a refused pattern never runs
  return true;
}

export interface RegisterInput { mint: string; ticker: string; name: string; creator: string; description: string; imageUrl: string | null; links: { label: string; url: string }[]; rulesText: string; feePda: string; vault: string | null; tokenConfig: string | null; poolId: string | null; launchTx: string | null; cluster: string; platformId: string | null; baselineAt: string; status: TokenStatus; /** B-19: a public prepare's draft with no proven wallet behind it (holds its ticker only briefly) */ unproven?: boolean }

/** The first pair id not yet taken: the base, else base-2, base-3 … kept within the 40-character pair id (registry.freePairId). */
export function nextFreePairId(base: string, taken: (id: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n++) { const suffix = `-${n}`; const id = `${base.slice(0, 40 - suffix.length).replace(/-$/, "")}${suffix}`; if (!taken(id)) return id; }
  throw new Error(`registry: no free pair id for ${base}`);
}

export class Registry {
  readonly db: DatabaseSync;
  readonly file: string;
  /**
   * Second audit 2026-10-19 I-17: the schema version recorded in the file when it is NEWER than this code's (REGISTRY_SCHEMA_VERSION),
   * else null. A rollback to older code after a migration would otherwise run without the newer tables' guards (ticker_reservations
   * at version 2). Reads keep working; new launches fail closed (reserveTicker and register of a draft throw RegistrySchemaNewerError,
   * and the prepare route answers 503), and the owner is alerted once a day.
   */
  readonly newerSchemaVersion: number | null = null;
  constructor(file: string) {
    // audit A-13 (2026-10-18): under a test, the checkout's own ./data/burnticker.db (the live registry on the host) is refused
    refuseDefaultDataFileUnderTest(file, REGISTRY_FILE, "registry");
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
    // 2026-10-15: the synthetic creator's coins (scripts/burnticker-synthetic-creator.mts) are flagged in token_flags, hidden like test coins
    if (!(this.db.prepare("PRAGMA table_info(token_flags)").all() as { name: string }[]).some((c) => c.name === "synthetic")) this.db.exec("ALTER TABLE token_flags ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0");
    // LP-lock round 2 (memo v2): the operator leg's paid / pending lamports on a claim, added in place, never changed.
    { const have = new Set((this.db.prepare("PRAGMA table_info(lock_fee_claims)").all() as { name: string }[]).map((c) => c.name)); for (const c of ["paid_lamports", "pending_lamports"]) if (!have.has(c)) this.db.exec(`ALTER TABLE lock_fee_claims ADD COLUMN ${c} TEXT`); }
    // AUDIT A C1: a registry made before the revival path carries the old tokens_expired_final (no exit from 'expired' at all). It is
    // replaced in place by the narrowed one IMMUTABILITY creates (the same guard plus the one verified exit); every other trigger stays.
    const fin = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='tokens_expired_final'").get() as { sql: string } | undefined;
    // review 2026-10-15 (6): the swap is one transaction, so a failure never leaves the registry without the guard
    if (fin && !fin.sql.includes("draft_revivals")) this.tx(() => { this.db.exec("DROP TRIGGER tokens_expired_final"); this.db.exec(IMMUTABILITY); });
    else this.db.exec(IMMUTABILITY);
    // A program reading, once a receipt is counted into it, is part of the receipt's facts.
    this.db.exec(`CREATE TRIGGER IF NOT EXISTS burns_reading_once BEFORE UPDATE OF reading_date ON burns WHEN OLD.reading_date IS NOT NULL AND NEW.reading_date IS NOT OLD.reading_date
      BEGIN SELECT RAISE(ABORT, 'burns: a receipt is counted into one program reading'); END;`);
    // every change above has run: record each schema version this file has not recorded yet (REGISTRY_MIGRATIONS)
    const at = Date.now(), ins = this.db.prepare("INSERT OR IGNORE INTO schema_version (version, applied_at, note) VALUES (?,?,?)");
    for (const m of REGISTRY_MIGRATIONS) ins.run(m.version, at, m.note);
    // I-17: a file a newer build migrated: say so, and refuse new launches (reads go on)
    const recorded = this.schemaVersion()?.version ?? 0;
    // HB-61 (sixth pass): the version the file is at, beside it in schema-version.json, so the deploy's swap can refuse to switch back to
    // a build that knows a lower one without opening the database (scripts/ops/swap-web-build.sh schema_guard)
    if (file !== ":memory:") writeSchemaVersionFile(path.join(path.dirname(file), SCHEMA_VERSION_FILE_NAME), recorded, at);
    if (recorded > REGISTRY_SCHEMA_VERSION) {
      this.newerSchemaVersion = recorded;
      try {
        this.recordAlert({ kind: REGISTRY_NEWER_ALERT_KIND, key: `${REGISTRY_NEWER_ALERT_KIND}:${recorded}`, text: `The registry file is at schema version ${recorded} and this build only knows up to version ${REGISTRY_SCHEMA_VERSION}, so an older build is running on a newer file (a rollback). Pages and the keeper keep reading; new launches are refused until the newer build is back. ${REGISTRY_NEWER_EXPECTED}`, meta: { recorded, code: REGISTRY_SCHEMA_VERSION } }, at);
      } catch { /* the refusal stands without the alert */ }
    }
  }
  /** I-17: throws when the file is newer than this code (new launches fail closed). */
  private assertSchemaKnown(): void { if (this.newerSchemaVersion !== null) throw new RegistrySchemaNewerError(this.newerSchemaVersion, REGISTRY_SCHEMA_VERSION); }

  /** The highest schema version recorded in this file (REGISTRY_MIGRATIONS), and when it was reached. */
  schemaVersion(): { version: number; appliedAt: number; note: string } | null {
    const r = this.db.prepare("SELECT version, applied_at, note FROM schema_version ORDER BY version DESC LIMIT 1").get() as { version: number; applied_at: number; note: string } | undefined;
    return r ? { version: Number(r.version), appliedAt: Number(r.applied_at), note: String(r.note) } : null;
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
    // AUDIT A C1: the sweep only marks the row; a create whose block time is inside the window is still taken live (takeLiveFromChain)
    return Number(this.db.prepare("UPDATE tokens SET status='expired' WHERE status='draft' AND launch_tx IS NULL AND created_at < ?").run(now - DRAFT_TTL_MS).changes);
  }
  /** AUDIT A C1: drafts and expired drafts with no launch transaction, created at or after `sinceMs`, oldest first (the reconciler's set). */
  unlaunchedDrafts(sinceMs: number): TokenRow[] {
    return (this.db.prepare("SELECT * FROM tokens WHERE status IN ('draft','expired') AND launch_tx IS NULL AND created_at >= ? ORDER BY created_at").all(sinceMs) as Row[]).map(toToken);
  }
  /** AUDIT A C1: every expired draft taken live after its launch was verified on chain, oldest first. */
  draftRevivals(): { mint: string; launchTx: string; blockTimeMs: number; withinWindow: boolean; source: string; note: string; at: number }[] {
    return (this.db.prepare("SELECT * FROM draft_revivals ORDER BY at, mint").all() as Row[]).map((r) => ({ mint: String(r.mint), launchTx: String(r.launch_tx), blockTimeMs: Number(r.block_time_ms), withinWindow: Number(r.within_window) === 1, source: String(r.source), note: String(r.note ?? ""), at: Number(r.at) }));
  }
  /**
   * AUDIT A C1: THE ONE WAY A DRAFT GOES LIVE FROM A LAUNCH VERIFIED ON CHAIN (the browser's confirm, the keeper's draft reconciler, the
   * operator script). The caller has verified `launchTx` (launchVerify.ts); the baseline is the create's BLOCK TIME. The draft's window is
   * judged on that block time, never on when a sweep ran: a create at or before createdAt + DRAFT_TTL_MS + DRAFT_GRACE_MS is in time
   * (inDraftWindow). A create in time goes live whether the row is still a draft or the sweep marked it expired (then through an
   * append-only draft_revivals row: the only exit the tokens_expired_final trigger allows). A create AFTER the window is refused unless
   * `late` is set by the operator (scripts/burnticker-draft-revive.mts --late): the rule's event may have settled long ago and every
   * launch-time check was passed against the old draft. A late create is always recorded in draft_revivals. The same signature again is
   * a no-op; any other status is refused.
   */
  takeLiveFromChain(mint: string, launchTx: string, poolId: string | null, blockTimeMs: number, o: { source: "confirm" | "reconciler" | "operator"; note?: string; late?: boolean }, now = Date.now()): { changed: boolean; revived: boolean; withinWindow: boolean } {
    const t = this.token(mint); if (!t) throw new Error("no such token");
    const withinWindow = inDraftWindow(t.createdAt, blockTimeMs);
    const baselineAt = new Date(blockTimeMs).toISOString();
    if (t.launchTx === launchTx) return { changed: false, revived: false, withinWindow };
    if (t.status !== "draft" && t.status !== "expired") throw new Error(`registry: ${mint} is ${t.status}, not a draft: only a draft goes live`);
    if (!withinWindow && !(o.late && o.source === "operator")) throw new Error(`registry: the launch of ${mint} landed at ${baselineAt}, after its draft's 24-hour window; only the operator can take it live (--late)`);
    // B-2 (third audit 2026-10-19): a ticker is one live coin. When another coin on this ticker is already live (the same creator's
    // second draft, built while the first create was pending, or any race that slipped past prepare) this one is refused, judged in the
    // same transaction as the change, and the owner is told (the alert is written in that transaction; the throw comes after it commits).
    // Every way a draft goes live passes here: the confirm, the draft reconciler and the operator's revive.
    if (t.status === "draft" && withinWindow) {
      const live = this.tx(() => {
        const other = this.liveTickerHolder(t, mint);
        if (other) { this.recordTickerLiveAlert(t, mint, launchTx, other, o.source, now); return other; }
        return { changed: this.markLaunched(mint, launchTx, poolId, baselineAt) };
      });
      if ("mint" in live) throw new TickerAlreadyLiveError(normTicker(t.ticker), mint, live.mint, live.creator === t.creator);
      return { changed: live.changed, revived: false, withinWindow };
    }
    // second audit 2026-10-19 I-16: an expired draft freed its ticker at 24 hours, so another creator may hold it now (a draft or a coin).
    // Reviving it would put two live coins on one ticker: refused, judged in the same transaction as the revival, and the owner is told
    // (the alert is written in that transaction too; the throw comes after it commits). The same creator's rows never block.
    let doubled: { mint: string; creator: string } | null = null;
    const held = this.tx(() => {
      { const other = this.liveTickerHolder(t, mint); if (other) { this.recordTickerLiveAlert(t, mint, launchTx, other, o.source, now); doubled = other; return null; } }
      if (t.status === "expired") {
        const other = this.db.prepare("SELECT mint, creator, status FROM tokens WHERE ticker=? AND status <> 'expired' AND creator <> ? AND mint <> ? ORDER BY created_at LIMIT 1").get(normTicker(t.ticker), t.creator, mint) as { mint: string; creator: string; status: string } | undefined;
        if (other) {
          this.recordAlert({ kind: REVIVAL_TICKER_HELD_ALERT_KIND, key: `${REVIVAL_TICKER_HELD_ALERT_KIND}:${mint}`, text: `$${t.ticker}: an expired draft's coin was created on chain in time (${launchTx.slice(0, 12)}…), but the ticker now belongs to another creator's ${other.status === "draft" ? "draft" : "coin"} (${String(other.mint).slice(0, 8)}…), so it was not taken live (${o.source}). Two live coins never share a ticker; the operator decides what happens to this one.`, meta: { mint, launchTx, other: String(other.mint), source: o.source } }, now);
          return String(other.mint);
        }
      }
      this.db.prepare("INSERT INTO draft_revivals (mint, launch_tx, block_time_ms, within_window, source, note, at) VALUES (?,?,?,?,?,?,?)").run(mint, launchTx, blockTimeMs, withinWindow ? 1 : 0, o.source, (o.note ?? "").slice(0, 300), now);
      const r = this.db.prepare("UPDATE tokens SET launch_tx=?, pool_id=COALESCE(?, pool_id), baseline_at=?, status='live' WHERE mint=? AND status=? AND launch_tx IS NULL").run(launchTx, poolId, baselineAt, mint, t.status);
      if (Number(r.changes) !== 1) throw new Error(`registry: ${mint} changed while it was being confirmed; read it again`);
      return null;
    });
    if (doubled) { const d = doubled as { mint: string; creator: string }; throw new TickerAlreadyLiveError(normTicker(t.ticker), mint, d.mint, d.creator === t.creator); }
    if (held) throw new RevivalTickerHeldError(normTicker(t.ticker), mint, held);
    return { changed: true, revived: true, withinWindow };
  }
  /** B-2: another coin on this row's ticker that is live (or paused), whoever made it, or null. */
  private liveTickerHolder(t: TokenRow, mint: string): { mint: string; creator: string } | null {
    const r = this.db.prepare("SELECT mint, creator FROM tokens WHERE ticker=? AND mint <> ? AND launch_tx IS NOT NULL AND status IN ('live','paused') ORDER BY created_at LIMIT 1").get(normTicker(t.ticker), mint) as { mint: string; creator: string } | undefined;
    return r ? { mint: String(r.mint), creator: String(r.creator) } : null;
  }
  private recordTickerLiveAlert(t: TokenRow, mint: string, launchTx: string, other: { mint: string; creator: string }, source: string, now: number): void {
    const same = other.creator === t.creator;
    this.recordAlert({ kind: TICKER_LIVE_ALERT_KIND, key: `${TICKER_LIVE_ALERT_KIND}:${mint}`, text: `$${t.ticker}: a second coin was created on chain (${mint.slice(0, 8)}…, ${launchTx.slice(0, 12)}…) while ${same ? "the same creator's" : "another"} $${t.ticker} is already live (${other.mint.slice(0, 8)}…), so it was not taken live (${source}). The creator paid for both creates.`, meta: { ticker: t.ticker, mint, launchTx, liveMint: other.mint, sameCreator: same, source } }, now);
  }

  // ---- create sends (B-2, third audit 2026-10-19) ----
  /** Records that a draft's create was sent with `signature` (the caller checked the creator's and the mint's signatures). True when new. */
  recordCreateSent(mint: string, signature: string, now = Date.now()): boolean {
    return Number(this.db.prepare("INSERT OR IGNORE INTO draft_sends (mint, signature, sent_at) VALUES (?,?,?)").run(mint, signature, now).changes) === 1;
  }
  /**
   * SEC-05 (continuous audit 2026-10-19): the launch page's report of a create it is about to send, recorded only when no OTHER attempt of
   * the same launch is in the way, judged and written in one transaction (two reports racing for two mints of one creator's ticker:
   * exactly one is recorded). In the way: another unlaunched draft of this creator's ticker with a send recorded in the last `windowMs`,
   * or any coin live (or paused) on the ticker. Recorded: the row (new, or the same signature again) with its sent_at.
   */
  recordCreateSentExclusive(mint: string, signature: string, windowMs: number, now = Date.now()): { ok: true; fresh: boolean; sentAt: number } | { ok: false; otherMint: string; live: boolean; sameCreator: boolean } {
    return this.tx(() => {
      const t = this.token(mint); if (!t) throw new Error("no such token");
      const live = this.liveTickerHolder(t, mint);
      if (live) return { ok: false as const, otherMint: live.mint, live: true, sameCreator: live.creator === t.creator };
      const other = this.db.prepare("SELECT t.mint AS mint FROM tokens t JOIN draft_sends s ON s.mint = t.mint WHERE t.creator=? AND UPPER(t.ticker)=? AND t.mint <> ? AND t.launch_tx IS NULL AND t.status IN ('draft','expired') AND s.sent_at > ? ORDER BY s.sent_at DESC LIMIT 1").get(t.creator, normTicker(t.ticker), mint, now - windowMs) as { mint: string } | undefined;
      if (other) return { ok: false as const, otherMint: String(other.mint), live: false, sameCreator: true };
      const fresh = this.recordCreateSent(mint, signature, now);
      const row = this.db.prepare("SELECT sent_at FROM draft_sends WHERE mint=? AND signature=?").get(mint, signature) as Row | undefined;
      if (!row) throw new Error("registry: the send was not recorded");
      return { ok: true as const, fresh, sentAt: Number(row.sent_at) };
    });
  }
  /** Every send recorded for a draft, oldest first. */
  createSends(mint: string): { signature: string; sentAt: number }[] {
    return (this.db.prepare("SELECT signature, sent_at FROM draft_sends WHERE mint=? ORDER BY sent_at, signature").all(mint) as Row[]).map((r) => ({ signature: String(r.signature), sentAt: Number(r.sent_at) }));
  }
  /** Whether a ticker is held by a token that is not expired (expiring stale drafts first). */
  tickerTaken(ticker: string, now = Date.now()): boolean {
    this.expireDrafts(now);
    return !!this.db.prepare("SELECT 1 FROM tokens WHERE ticker=? AND status <> 'expired'").get(ticker.toUpperCase());
  }
  close(): void { this.db.close(); }
  /**
   * One transaction. F04 (2026-10-19): a call inside another transaction runs as a savepoint of it (before: "cannot start a transaction
   * within a transaction"), so a failure rolls back only its own writes and the outer transaction decides the rest.
   */
  tx<T>(fn: () => T): T {
    if (this.db.isTransaction) {
      const sp = `tx_${++this.savepoints}`;
      this.db.exec(`SAVEPOINT ${sp}`);
      try { const v = fn(); this.db.exec(`RELEASE ${sp}`); return v; } catch (e) { this.db.exec(`ROLLBACK TO ${sp}`); this.db.exec(`RELEASE ${sp}`); throw e; }
    }
    this.db.exec("BEGIN IMMEDIATE"); try { const v = fn(); this.db.exec("COMMIT"); return v; } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  private savepoints = 0;

  // ---- ticker reservations (third prelaunch audit 2026-10-19 F04) ----
  /**
   * Who else holds this ticker right now: a token row of ANOTHER creator that is a draft or a coin (any status but 'expired'), or an
   * unexpired reservation of another creator. The caller has expired stale drafts. The creator's own draft or reservation never counts
   * (a retry of their own unfinished draft). Tickers of old coins stay shared (owner 2026-10-12): only a new draft is ever refused.
   */
  private tickerHolder(ticker: string, creator: string, now: number, callerProven = true): "token" | "reservation" | null {
    // B-19: an unproven draft (no launch transaction, no send recorded in the last SENT_HOLD_MS: HB-187) never holds against a proven
    // caller, and holds against an unproven one for UNPROVEN_HOLD_MS only
    if (this.db.prepare(`SELECT 1 FROM tokens t WHERE t.ticker=? AND t.status <> 'expired' AND t.creator <> ? AND (
        t.status <> 'draft' OR t.launch_tx IS NOT NULL
        OR NOT EXISTS (SELECT 1 FROM status k WHERE k.key = ? || t.mint)
        OR EXISTS (SELECT 1 FROM draft_sends s WHERE s.mint = t.mint AND s.sent_at > ?)
        OR (EXISTS (SELECT 1 FROM status u WHERE u.key = ? || t.mint) AND EXISTS (SELECT 1 FROM draft_sends s WHERE s.mint = t.mint AND s.sent_at > ?))
        OR (? = 0 AND t.created_at > ?)) LIMIT 1`).get(ticker, creator, UNPROVEN_DRAFT_PREFIX, now - SENT_HOLD_MS, SEND_UNREAD_PREFIX, now - SENT_HOLD_FAIL_MAX_MS, callerProven ? 1 : 0, now - UNPROVEN_HOLD_MS)) return "token";
    if (this.db.prepare("SELECT 1 FROM ticker_reservations WHERE ticker=? AND creator <> ? AND expires_at > ?").get(ticker, creator, now)) return "reservation";
    return null;
  }
  /**
   * F04: holds a ticker for a prepare that is about to check, upload and register a draft (`ttlMs`, 15 minutes by default). Refused when
   * another creator's draft or coin holds the ticker, or another creator's unexpired reservation does; the same creator renews its own.
   * The registry is the arbiter, so two processes (or two routes) racing for one ticker get one reservation.
   */
  reserveTicker(ticker: string, creator: string, mint: string | null, now = Date.now(), ttlMs = 15 * 60_000, callerProven = true): { ok: true } | { ok: false; heldBy: "reservation" | "token" } {
    this.assertSchemaKnown();
    const t = normTicker(ticker);
    return this.tx(() => {
      this.expireDrafts(now);
      const heldBy = this.tickerHolder(t, creator, now, callerProven);
      if (heldBy) return { ok: false as const, heldBy };
      this.db.prepare(`INSERT INTO ticker_reservations (ticker, creator, mint, expires_at, created_at) VALUES (?,?,?,?,?)
        ON CONFLICT(ticker) DO UPDATE SET creator=excluded.creator, mint=excluded.mint, expires_at=excluded.expires_at, created_at=excluded.created_at`).run(t, creator, mint, now + ttlMs, now);
      return { ok: true as const };
    });
  }
  /** F04: gives back the caller's own reservation of a ticker (another creator's is never touched). */
  releaseTicker(ticker: string, creator: string): void { this.db.prepare("DELETE FROM ticker_reservations WHERE ticker=? AND creator=?").run(normTicker(ticker), creator); }
  /** F04: the reservation of a ticker, if any (expired ones included; `expiresAt` says). */
  tickerReservation(ticker: string): { ticker: string; creator: string; mint: string | null; expiresAt: number; createdAt: number } | null {
    const r = this.db.prepare("SELECT * FROM ticker_reservations WHERE ticker=?").get(normTicker(ticker)) as Row | undefined;
    return r ? { ticker: String(r.ticker), creator: String(r.creator), mint: r.mint === null ? null : String(r.mint), expiresAt: Number(r.expires_at), createdAt: Number(r.created_at) } : null;
  }

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
    if (i.status === "draft") this.assertSchemaKnown();   // I-17: no new draft on a file a newer build migrated
    return this.tx(() => {
      this.expireDrafts(now);   // owner 2026-10-12: tickers are not unique for old coins; stale drafts still expire here
      // F04 (2026-10-19): a new DRAFT is refused when another creator's draft, coin or unexpired reservation holds its ticker (checked in
      // the same transaction as the insert, so two racing prepares cannot both pass); a row already live on chain is recorded as it is
      if (i.status === "draft" && this.tickerHolder(normTicker(i.ticker), i.creator, now, !i.unproven)) throw new TickerTakenError(normTicker(i.ticker));
      this.db.prepare(`INSERT INTO tokens (mint, ticker, name, creator, description, image_url, links_json, oracle, selector_key, rules_json, rules_sha, mode, fee_pda, vault, token_config, pool_id, launch_tx, cluster, platform_id, baseline_at, created_at, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(i.mint, i.ticker, i.name, i.creator, i.description, i.imageUrl, JSON.stringify(i.links), locked.rule.oracle, selectorKeyOf(locked.rule), locked.text, locked.sha256, locked.mode, i.feePda, i.vault, i.tokenConfig, i.poolId, i.launchTx, i.cluster, i.platformId, i.baselineAt, now, i.status);
      this.db.prepare("INSERT OR IGNORE INTO token_state (mint, carry_out, updated_at) VALUES (?, '0', ?)").run(i.mint, now);
      this.db.prepare("DELETE FROM ticker_reservations WHERE ticker=? AND creator=?").run(normTicker(i.ticker), i.creator);   // F04: the draft holds it now
      if (i.status === "draft" && i.unproven) this.setStatus(UNPROVEN_DRAFT_PREFIX + i.mint, "1", now);   // B-19
      return this.token(i.mint)!;
    });
  }
  /** B-19: the creator proved the wallet on a retry of an unproven draft; from now on it holds its ticker like any draft. */
  markDraftProven(mint: string): void { this.db.prepare("DELETE FROM status WHERE key=?").run(UNPROVEN_DRAFT_PREFIX + mint); this.markSendRead(mint); }
  /** HB-187: the chain read of this draft's sent create failed (the hold lasts up to SENT_HOLD_FAIL_MAX_MS after the send). */
  markSendUnread(mint: string, now = Date.now()): void { this.setStatus(SEND_UNREAD_PREFIX + mint, "1", now); }
  /** HB-187: a chain read of this draft's sent create answered (landed or not), so the failed-read hold ends. */
  markSendRead(mint: string): void { this.db.prepare("DELETE FROM status WHERE key=?").run(SEND_UNREAD_PREFIX + mint); }
  /**
   * B-19: the mints of unproven drafts with no create send recorded in the last SENT_HOLD_MS (those hold only briefly; see
   * UNPROVEN_HOLD_MS). HB-187: a draft whose chain read failed (SEND_UNREAD_PREFIX) is left out while its send is under SENT_HOLD_FAIL_MAX_MS old.
   */
  unprovenDraftMints(now = Date.now()): Set<string> {
    const rows = this.db.prepare(`SELECT substr(k.key, ?) AS mint FROM status k WHERE k.key >= ? AND k.key < ?
        AND NOT EXISTS (SELECT 1 FROM draft_sends s WHERE s.mint = substr(k.key, ?) AND s.sent_at > ?)
        AND NOT (EXISTS (SELECT 1 FROM status u WHERE u.key = ? || substr(k.key, ?)) AND EXISTS (SELECT 1 FROM draft_sends s WHERE s.mint = substr(k.key, ?) AND s.sent_at > ?))`)
      .all(UNPROVEN_DRAFT_PREFIX.length + 1, UNPROVEN_DRAFT_PREFIX, `${UNPROVEN_DRAFT_PREFIX}\uffff`, UNPROVEN_DRAFT_PREFIX.length + 1, now - SENT_HOLD_MS, SEND_UNREAD_PREFIX, UNPROVEN_DRAFT_PREFIX.length + 1, UNPROVEN_DRAFT_PREFIX.length + 1, now - SENT_HOLD_FAIL_MAX_MS) as { mint: string }[];
    return new Set(rows.map((r) => String(r.mint)));
  }
  /**
   * The creator's OWN unfinished draft for a mint (status draft, no launch transaction, same creator), or null. A retry of the same
   * draft (2026-10-14: the first Launch press registered it, the launch check refused it, the retry was refused as "already
   * registered") reuses this row instead of inserting again; rows are never deleted (append-only).
   */
  ownDraft(mint: string, creator: string): TokenRow | null {
    const t = this.token(mint);
    return t && t.status === "draft" && !t.launchTx && t.creator === creator ? t : null;
  }
  token(mint: string): TokenRow | null { const r = this.db.prepare("SELECT * FROM tokens WHERE mint=?").get(mint) as Row | undefined; return r ? toToken(r) : null; }
  /** The token holding a ticker; when only expired drafts carry it, the newest of those (pages and lookups still resolve). */
  tokenByTicker(ticker: string): TokenRow | null { const r = this.db.prepare("SELECT * FROM tokens WHERE ticker=? ORDER BY (status = 'expired'), created_at DESC LIMIT 1").get(ticker.toUpperCase()) as Row | undefined; return r ? toToken(r) : null; }
  /** website-19 (owner, 2026-10-12: tickers are not unique): every token holding a ticker that is not expired, newest first. */
  tokensByTicker(ticker: string): TokenRow[] { return (this.db.prepare("SELECT * FROM tokens WHERE ticker=? AND status <> 'expired' ORDER BY created_at DESC").all(ticker.toUpperCase()) as Row[]).map(toToken); }
  tokens(status?: TokenStatus): TokenRow[] { return (status ? this.db.prepare("SELECT * FROM tokens WHERE status=? ORDER BY created_at").all(status) : this.db.prepare("SELECT * FROM tokens ORDER BY created_at").all()).map((r) => toToken(r as Row)); }
  /** The operator's test mark for a coin (testCoins.ts): on hides it from browse surfaces, off lists it again. Upsert; the note says why. */
  setTokenTest(mint: string, test: boolean, note = "", now = Date.now()): void {
    this.db.prepare("INSERT INTO token_flags (mint, test, note, at) VALUES (?,?,?,?) ON CONFLICT(mint) DO UPDATE SET test=excluded.test, note=excluded.note, at=excluded.at").run(mint, test ? 1 : 0, note, now);
  }
  /**
   * A coin the nightly synthetic creator made on devnet (scripts/burnticker-synthetic-creator.mts): flagged synthetic, left off every browse
   * surface like a test coin (testCoins.ts testCoinKeys), and NOT listed on /burnticker/test-coins (they are checks, not disclosures).
   */
  setTokenSynthetic(mint: string, note = "", now = Date.now()): void {
    this.db.prepare("INSERT INTO token_flags (mint, test, note, at, synthetic) VALUES (?,0,?,?,1) ON CONFLICT(mint) DO UPDATE SET synthetic=1, at=excluded.at").run(mint, note, now);
  }
  /** Every coin flagged synthetic. */
  syntheticTokens(): { mint: string; note: string; at: number }[] {
    return (this.db.prepare("SELECT mint, note, at FROM token_flags WHERE synthetic=1 ORDER BY at").all() as Row[]).map((r) => ({ mint: String(r.mint), note: String(r.note ?? ""), at: Number(r.at) }));
  }
  /** Every coin the operator marked test, with the note and when. */
  testTokens(): { mint: string; note: string; at: number }[] {
    return (this.db.prepare("SELECT mint, note, at FROM token_flags WHERE test=1 ORDER BY at").all() as Row[]).map((r) => ({ mint: String(r.mint), note: String(r.note ?? ""), at: Number(r.at) }));
  }
  setTokenStatus(mint: string, status: TokenStatus): void { this.db.prepare("UPDATE tokens SET status=? WHERE mint=?").run(status, mint); }
  /**
   * The launch landed: record the tx and go live — ONE atomic draft → live transition. The same signature again is a no-op (the
   * baseline stays where the launch put it: ChatGPT/Codex review N1, a public replay must not move it); a different signature, or a
   * token that is not a draft, is refused. The SQL trigger tokens_baseline_fixed is the second lock. Returns false on the no-op.
   */
  markLaunched(mint: string, launchTx: string, poolId: string | null, baselineAt: string): boolean {
    const t = this.token(mint); if (!t) throw new Error("no such token");
    if (t.launchTx === launchTx) return false;
    if (t.launchTx) throw new Error(`registry: ${mint} already launched in ${t.launchTx}`);
    if (t.status === "expired") throw new Error(`registry: the draft ${mint} expired (not launched within 24 h); build a fresh bundle`);
    if (t.status !== "draft") throw new Error(`registry: ${mint} is ${t.status}, not a draft: only a draft goes live`);
    const r = this.db.prepare("UPDATE tokens SET launch_tx=?, pool_id=COALESCE(?, pool_id), baseline_at=?, status='live' WHERE mint=? AND status='draft' AND launch_tx IS NULL").run(launchTx, poolId, baselineAt, mint);
    if (Number(r.changes) !== 1) throw new Error(`registry: ${mint} changed while it was being confirmed; read it again`);
    return true;
  }
  /** A stored rule is re-read without the newer title-filter refusal (rules.ts validateRule `stored`, prelaunch audit H6). */
  lockedRule(t: TokenRow): LockedRule { return lockRule(JSON.parse(t.rulesJson), { stored: true }); }

  // ---- readings ----
  /** Inserts new readings; a reading already held with a DIFFERENT result/value throws (an oracle that changed its mind holds the keeper). Returns the count written. */
  putReadings(oracle: string, selectorKey: string, events: readonly SettledEvent[], meta: { settlementSourceUrl: string | null; attestedBy: string[]; method?: (e: SettledEvent) => string | null }, now = Date.now()): number {
    let n = 0;
    this.tx(() => {
      for (const e of events) {
        const have = this.db.prepare("SELECT result, value FROM readings WHERE oracle=? AND selector_key=? AND event_id=?").get(oracle, selectorKey, e.id) as { result: string | null; value: string | null } | undefined;
        if (have) { if ((have.result ?? null) !== (e.result ?? null) || (have.value ?? null) !== (e.value ?? null)) throw new RevisedReadingError(selectorKey, e.id, have.result ?? have.value, e.result ?? e.value); continue; }
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
  applyStep(mint: string, e: SettledEvent, step: { units: number; mapping: BurnMapping | null; kind: string; note: string; carryOut: string; baseline: string | null }, prev: { value: string | null; carryOut: string }, scalar: boolean, now = Date.now(), gated: "pending-pair" | "voided" | null = null, pairRole: PairRole | null = null): boolean {
    return this.tx(() => {
      if (this.db.prepare("SELECT 1 FROM burns WHERE mint=? AND event_id=?").get(mint, e.id)) return false;
      const base: ReceiptStatus = step.kind === "void" ? "void" : step.mapping && step.units > 0 ? "planned" : "nothing";
      // Both or neither: a burn read before both pools registered waits; on a voided pair it is recorded and never executed.
      const status: ReceiptStatus = base === "planned" && gated ? gated : base;
      this.db.prepare(`INSERT INTO burns (mint, event_id, settled_at, result, value, units, mapping_json, kind, note, prev_value, carry_in, carry_out, status, created_at, updated_at, pair_role) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(mint, e.id, e.at, e.result, e.value, step.units, step.mapping ? JSON.stringify(step.mapping) : null, step.kind, step.note, prev.value, prev.carryOut, step.carryOut, status, now, now, pairRole);
      // The cursor only moves forward: a late-final independent event (review N7) gets its receipt without rewinding the token's state.
      const cur = this.state(mint);
      const behind = cur.lastSettledAt !== null && (e.at < cur.lastSettledAt || (e.at === cur.lastSettledAt && cur.lastEventId !== null && e.id < cur.lastEventId));
      if (!behind) this.setState(mint, { lastEventId: e.id, lastValue: scalar && e.value !== null && e.result !== "void" ? e.value : prev.value, carryOut: step.carryOut, lastSettledAt: e.at }, now);
      return true;
    });
  }
  /**
   * An end-of-rule receipt (kind winddown / drain / sweep: no reading behind it — a date-based clock; the token's cursor is not moved).
   * Idempotent per (mint, id).
   */
  /** `pairRole` "lost" (winner takes the burn): a one-shot pair loser's end-of-rule day whose fuel forwards to the live winner. */
  addEndReceipt(mint: string, kind: "winddown" | "drain" | "sweep", e: { id: string; at: string }, step: { units: number; mapping: BurnMapping | null; note: string }, now = Date.now(), pairRole: PairRole | null = null): boolean {
    if (this.db.prepare("SELECT 1 FROM burns WHERE mint=? AND event_id=?").get(mint, e.id)) return false;
    this.db.prepare(`INSERT INTO burns (mint, event_id, settled_at, result, value, units, mapping_json, kind, note, prev_value, carry_in, carry_out, status, created_at, updated_at, pair_role) VALUES (?,?,?,NULL,NULL,?,?,?,?,NULL,'0','0',?,?,?,?)`)
      .run(mint, e.id, e.at, step.units, step.mapping ? JSON.stringify(step.mapping) : null, kind, step.note, step.mapping && step.units > 0 ? "planned" : "nothing", now, now, pairRole);
    return true;
  }
  /** The launch pins: the creator's note and the Arweave metadata / image (null for a coin made before them). */
  tokenMeta(mint: string): TokenMeta | null {
    const r = this.db.prepare("SELECT * FROM token_meta WHERE mint=?").get(mint) as Row | undefined;
    return r ? { mint: String(r.mint), creatorNote: String(r.creator_note ?? ""), metadataUri: strOrNull(r.metadata_uri), metadataTx: strOrNull(r.metadata_tx), metadataSha256: strOrNull(r.metadata_sha256), imageUri: strOrNull(r.image_uri), imageTx: strOrNull(r.image_tx), imageSha256: strOrNull(r.image_sha256), hosted: Number(r.hosted) === 1, createdAt: Number(r.created_at) } : null;
  }
  /** Written once, with the draft (an earlier record wins; the table refuses updates). */
  putTokenMeta(m: Omit<TokenMeta, "createdAt">, now = Date.now()): TokenMeta {
    this.db.prepare("INSERT OR IGNORE INTO token_meta (mint, creator_note, metadata_uri, metadata_tx, metadata_sha256, image_uri, image_tx, image_sha256, hosted, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(m.mint, m.creatorNote.slice(0, 140), m.metadataUri, m.metadataTx, m.metadataSha256, m.imageUri, m.imageTx, m.imageSha256, m.hosted ? 1 : 0, now);
    return this.tokenMeta(m.mint)!;
  }
  /** When and why a token's rule ended (null while it reads). */
  ruleEnd(mint: string): { mode: "drain" | "winddown"; reason: string; at: number } | null {
    const r = this.db.prepare("SELECT mode, reason, at FROM rule_ends WHERE mint=?").get(mint) as Row | undefined;
    return r ? { mode: String(r.mode) as "drain" | "winddown", reason: String(r.reason), at: Number(r.at) } : null;
  }
  /** Records the end once (an earlier record wins). Adapters that know a series is over (a team's season, a nominee replaced) call it too. */
  markRuleEnded(mint: string, mode: "drain" | "winddown", reason: string, at: number): { mode: "drain" | "winddown"; reason: string; at: number } {
    this.db.prepare("INSERT OR IGNORE INTO rule_ends (mint, mode, reason, at) VALUES (?,?,?,?)").run(mint, mode, reason.slice(0, 300), at);
    return this.ruleEnd(mint)!;
  }
  /** A clause pair went live: its waiting receipts become planned (they execute in settlement order). Returns how many. */
  promotePendingPair(mint: string, now = Date.now()): number { return Number(this.db.prepare("UPDATE burns SET status='planned', updated_at=? WHERE mint=? AND status='pending-pair'").run(now, mint).changes); }
  /** A clause pair voided: its waiting receipts are voided (final; never executed). Returns how many. */
  voidPendingPair(mint: string, reason: string, now = Date.now()): number { return Number(this.db.prepare("UPDATE burns SET status='voided', skipped_reason=?, updated_at=? WHERE mint=? AND status='pending-pair'").run(reason.slice(0, 300), now, mint).changes); }

  receipt(mint: string, eventId: string): ReceiptRow | null { const r = this.db.prepare("SELECT * FROM burns WHERE mint=? AND event_id=?").get(mint, eventId) as Row | undefined; return r ? toReceipt(r) : null; }
  /**
   * 2026-10-15 (the coin route's memo): a short string that changes when the coin's page must be read again at once: a launch or any
   * status change (the token row), a new or changed receipt (the burns' count and newest updated_at) and a settled reading (token_state).
   * Cheap: three indexed reads by mint.
   */
  pageVersion(mint: string): string {
    const t = this.db.prepare("SELECT status, launch_tx, pool_id, image_url, length(description) AS dl FROM tokens WHERE mint=?").get(mint) as Row | undefined;
    const b = this.db.prepare("SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM burns WHERE mint=?").get(mint) as Row | undefined;
    const st = this.db.prepare("SELECT updated_at AS u FROM token_state WHERE mint=?").get(mint) as Row | undefined;
    return [t?.status ?? "", t?.launch_tx ?? "", t?.pool_id ?? "", t?.image_url ?? "", t?.dl ?? "", b?.n ?? 0, b?.u ?? "", st?.u ?? ""].map(String).join("|");
  }
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
  /** A confirmed claim_lock_fees (lockFeesKeeper.ts), written once from the program's facts; false if already recorded. */
  recordLockFeeClaim(c: LockFeeClaimRow): boolean {
    return Number(this.db.prepare("INSERT OR IGNORE INTO lock_fee_claims (signature, mint, at, slot, sol_lamports, burn_pool_lamports, operator_lamports, token_burned_raw, paid_lamports, pending_lamports) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(c.signature, c.mint, c.at, c.slot, c.solLamports.toString(), c.toBurnPoolLamports.toString(), c.toOperatorLamports.toString(), c.tokenBurnedRaw.toString(), c.paidLamports?.toString() ?? null, c.pendingLamports?.toString() ?? null).changes) > 0;
  }
  /** Recorded claims, oldest first — one coin's, or every coin's. */
  lockFeeClaims(mint?: string): LockFeeClaimRow[] {
    const rows = (mint ? this.db.prepare("SELECT * FROM lock_fee_claims WHERE mint=? ORDER BY at, signature").all(mint) : this.db.prepare("SELECT * FROM lock_fee_claims ORDER BY at, signature").all()) as Row[];
    return rows.map((r) => ({ signature: String(r.signature), mint: String(r.mint), at: Number(r.at), slot: numOrNull(r.slot), solLamports: BigInt(String(r.sol_lamports)), toBurnPoolLamports: BigInt(String(r.burn_pool_lamports)), toOperatorLamports: BigInt(String(r.operator_lamports)), tokenBurnedRaw: BigInt(String(r.token_burned_raw)), ...(r.paid_lamports != null ? { paidLamports: BigInt(String(r.paid_lamports)), pendingLamports: BigInt(String(r.pending_lamports ?? "0")) } : {}) }));
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
  /**
   * AUDIT A F1 (2026-10-15): a submit_reading LANDED — its signature is confirmed AND the receipts its write-ahead row named are counted
   * into that reading, in ONE transaction. Two separate writes left a window (a crash between them) where the chain had counted the
   * receipts and the registry still held them unassigned, so the next date would count them again.
   */
  confirmReading(mint: string, signature: string, slot: number | null, eventIds: readonly string[], readingDate: number, now = Date.now()): void {
    this.tx(() => {
      this.db.prepare("UPDATE signatures SET status='confirmed', err=NULL, slot=COALESCE(?, slot) WHERE signature=? AND mint=?").run(slot, signature, mint);
      for (const e of eventIds) this.db.prepare("UPDATE burns SET reading_date=?, execution='program', updated_at=? WHERE mint=? AND event_id=? AND reading_date IS NULL").run(readingDate, now, mint, e);
    });
  }
  /** Every `reading:<date>` write-ahead row of a mint in one status, oldest date first (AUDIT A F1: resolved before a date is chosen). */
  readingSignatures(mint: string, status: SignatureRow["status"]): SignatureRow[] {
    return (this.db.prepare("SELECT * FROM signatures WHERE mint=? AND event_id LIKE 'reading:%' AND status=? ORDER BY event_id, sent_at").all(mint, status) as Row[]).map(toSig);
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
    const status: ReceiptStatus = f.outcome === "burned" || f.outcome === "short" ? "confirmed" : f.outcome === "exhausted" ? "exhausted" : f.outcome === "forwarded" ? "forwarded" : "skipped";
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

  // ---- winner takes the burn: landed forwards (append-only) ----
  recordPairForward(f: PairForwardRow): boolean {
    return Number(this.db.prepare("INSERT OR IGNORE INTO pair_forwards (signature, pair_id, record_date, loser_mint, winner_mint, units, pool_lamports, lamports, sol_lamports, wsol_lamports, at, slot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(f.signature, f.pairId, f.recordDate, f.loserMint, f.winnerMint, f.units, f.poolLamports.toString(), f.lamports.toString(), f.solLamports.toString(), f.wsolLamports.toString(), f.at, f.slot).changes) > 0;
  }
  pairForwards(pairId?: string): PairForwardRow[] {
    const rows = (pairId ? this.db.prepare("SELECT * FROM pair_forwards WHERE pair_id=? ORDER BY record_date, at").all(pairId) : this.db.prepare("SELECT * FROM pair_forwards ORDER BY record_date, at").all()) as Row[];
    return rows.map((r) => ({ signature: String(r.signature), pairId: String(r.pair_id), recordDate: Number(r.record_date), loserMint: String(r.loser_mint), winnerMint: String(r.winner_mint), units: Number(r.units), poolLamports: BigInt(String(r.pool_lamports)), lamports: BigInt(String(r.lamports)), solLamports: BigInt(String(r.sol_lamports)), wsolLamports: BigInt(String(r.wsol_lamports)), at: Number(r.at), slot: numOrNull(r.slot) }));
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
    // a rivalry series pair (rules.ts isMeetingsRule) reads two series, one per team, each the other's mirror; every other pair shares one
    const mirrored = ra.oracle === "catalogue" && rb.oracle === "catalogue" && !!ra.series && meetingsMirrorId(ra.series) === rb.series;
    // two candidates in one race (rules.ts PairRace): two outcome markets, each side on its own, the same race locked in both rules
    const race = !!ra.pair.race && !!rb.pair.race && JSON.stringify(ra.pair.race) === JSON.stringify(rb.pair.race) && ra.market === ra.pair.race.markets[0] && rb.market === ra.pair.race.markets[1];
    if (!!ra.pair.race !== !!rb.pair.race || ((ra.pair.race || rb.pair.race) && !race)) throw new Error("registry: both sides of a candidates pair lock the same race, side A on its first market and side B on its second");
    // two teams in one game (rules.ts PairGame): each side on its own team's win series, the same two series locked in both rules
    const game = !!ra.pair.game && !!rb.pair.game && JSON.stringify(ra.pair.game) === JSON.stringify(rb.pair.game) && ra.series === ra.pair.game.series[0] && rb.series === ra.pair.game.series[1];
    if (!!ra.pair.game !== !!rb.pair.game || ((ra.pair.game || rb.pair.game) && !game)) throw new Error("registry: both sides of a one-game pair lock the same two series, side A on its team's and side B on the other team's");
    if (a.selectorKey !== b.selectorKey && !mirrored && !race && !game) throw new Error("registry: a pair shares one selector key");
    const ca = JSON.stringify({ c: ra.pair?.clause ?? null, v: ra.pair?.voidBy ?? null, e: ra.onEnd ?? null, w: ra.pair?.winnerTakesBurn ?? null }), cb = JSON.stringify({ c: rb.pair?.clause ?? null, v: rb.pair?.voidBy ?? null, e: rb.onEnd ?? null, w: rb.pair?.winnerTakesBurn ?? null });
    if (ca !== cb) throw new Error("registry: both sides of a pair carry the same both-or-neither clause and onEnd (clause, voidBy, onEnd)");
    this.db.prepare("INSERT INTO pairs (pair_id, mint_a, mint_b, selector_key, created_at) VALUES (?,?,?,?,?)").run(pairId, mintA, mintB, a.selectorKey, now);
    return this.pair(pairId)!;
  }
  /**
   * 2026-10-14 (the Steelers vs Ravens retry hit "UNIQUE constraint failed: pairs.pair_id"): a pair id is derived from the tickers and
   * the selector, so a second attempt at the same matchup — fresh mints, the first pair's drafts never launched — collides with the
   * first row, and rows are never deleted. The first free id: the base, else base-2, base-3 … (kept within the 40-character pair id).
   */
  freePairId(base: string): string { return nextFreePairId(base, (id) => this.pair(id) !== null); }
  pair(pairId: string): PairRow | null { const r = this.db.prepare("SELECT * FROM pairs WHERE pair_id=?").get(pairId) as Row | undefined; return r ? { pairId: String(r.pair_id), mintA: String(r.mint_a), mintB: String(r.mint_b), selectorKey: String(r.selector_key), createdAt: Number(r.created_at) } : null; }
  pairOf(mint: string): PairRow | null { const r = this.db.prepare("SELECT * FROM pairs WHERE mint_a=? OR mint_b=?").get(mint, mint) as Row | undefined; return r ? { pairId: String(r.pair_id), mintA: String(r.mint_a), mintB: String(r.mint_b), selectorKey: String(r.selector_key), createdAt: Number(r.created_at) } : null; }
  /** A clause pair's terminal state (live / voided), or null while it waits (or for a pair without the clause). */
  pairOutcome(pairId: string): { state: "live" | "voided"; at: number; detail: string | null } | null {
    const r = this.db.prepare("SELECT state, at, detail FROM pair_outcomes WHERE pair_id=?").get(pairId) as Row | undefined;
    return r ? { state: String(r.state) as "live" | "voided", at: Number(r.at), detail: strOrNull(r.detail) } : null;
  }
  /** Records a clause pair's terminal state once (an earlier record wins). */
  recordPairOutcome(pairId: string, state: "live" | "voided", at: number, detail: string | null): { state: "live" | "voided"; at: number; detail: string | null } {
    this.db.prepare("INSERT OR IGNORE INTO pair_outcomes (pair_id, state, at, detail) VALUES (?,?,?,?)").run(pairId, state, at, detail);
    return this.pairOutcome(pairId)!;
  }
  pairs(): PairRow[] { return (this.db.prepare("SELECT * FROM pairs ORDER BY created_at").all() as Row[]).map((r) => ({ pairId: String(r.pair_id), mintA: String(r.mint_a), mintB: String(r.mint_b), selectorKey: String(r.selector_key), createdAt: Number(r.created_at) })); }

  // ---- attesters ----
  addAttester(a: Omit<AttesterRow, "active"> & { active?: boolean }): void { this.db.prepare("INSERT INTO attesters (mint, pubkey, role, added_at, active, timelock_until) VALUES (?,?,?,?,?,?) ON CONFLICT(mint, pubkey) DO UPDATE SET role=excluded.role, active=excluded.active, timelock_until=excluded.timelock_until").run(a.mint, a.pubkey, a.role, a.addedAt, a.active === false ? 0 : 1, a.timelockUntil); }
  attesters(mint: string): AttesterRow[] { return (this.db.prepare("SELECT * FROM attesters WHERE mint=? ORDER BY added_at").all(mint) as Row[]).map((r) => ({ mint: String(r.mint), pubkey: String(r.pubkey), role: String(r.role) as AttesterRow["role"], addedAt: Number(r.added_at), active: Number(r.active) === 1, timelockUntil: numOrNull(r.timelock_until) })); }
}

export const openRegistry = (file: string): Registry => new Registry(file);
export const REGISTRY_FILE = path.join("data", "burnticker.db");

/**
 * A PUBLISHER REVISED A PERIOD ALREADY RECORDED (owner decision 2026-10-12, website-20 item 84: keep holding). The keeper never counts a
 * revision a second time and never replaces the recorded value: the source's key holds, and the alert names the key, the period and both
 * values (multiKeeper.ts fetchDue).
 */
/** F04 (2026-10-19): register() refused a new draft because another creator's draft, coin or reservation holds its ticker. */
export class TickerTakenError extends Error {
  readonly ticker: string;
  constructor(ticker: string) { super(`registry: the ticker ${ticker} is held by another creator`); this.name = "TickerTakenError"; this.ticker = ticker; }
}
const normTicker = (t: string): string => t.trim().replace(/^\$/, "").toUpperCase();

/** Second audit 2026-10-19 I-16: the alert kind recorded when an expired draft's revival is refused because its ticker is held. */
export const REVIVAL_TICKER_HELD_ALERT_KIND = "revival-ticker-held";
/** I-16: takeLiveFromChain refused to revive an expired draft whose ticker another creator's draft or coin holds now. */
export class RevivalTickerHeldError extends Error {
  readonly ticker: string; readonly mint: string; readonly heldBy: string;
  constructor(ticker: string, mint: string, heldBy: string) { super(`registry: the expired draft ${mint} is not revived: its ticker ${ticker} is held by another creator's coin (${heldBy})`); this.name = "RevivalTickerHeldError"; this.ticker = ticker; this.mint = mint; this.heldBy = heldBy; }
}
/** B-2 (third audit 2026-10-19): the alert kind recorded when a second coin on a live ticker is refused at confirm. */
export const TICKER_LIVE_ALERT_KIND = "launch-ticker-live";
/** B-2: takeLiveFromChain refused a draft because another coin on its ticker is already live (`sameCreator`: that coin is this creator's). */
export class TickerAlreadyLiveError extends Error {
  readonly ticker: string; readonly mint: string; readonly liveMint: string; readonly sameCreator: boolean;
  constructor(ticker: string, mint: string, liveMint: string, sameCreator: boolean) { super(`registry: ${mint} is not taken live: the ticker ${ticker} already has a live coin (${liveMint})`); this.name = "TickerAlreadyLiveError"; this.ticker = ticker; this.mint = mint; this.liveMint = liveMint; this.sameCreator = sameCreator; }
}
/** Continuous audit run 2, HB-24: a rollback window raises this alert by design, so the alert says so (the publish-92 rollback did). */
export const REGISTRY_NEWER_EXPECTED = "This is expected while a deploy is switching back to the previous release, and it clears when the newer build is serving again. If it lasts more than a few minutes, the rollback has stalled.";
/** Second audit 2026-10-19 I-17: the alert kind recorded when the registry file is newer than this build. */
export const REGISTRY_NEWER_ALERT_KIND = "registry-schema-newer";
/** I-17: a new launch was refused because the registry file was migrated by a newer build (a rollback is running). */
export class RegistrySchemaNewerError extends Error {
  readonly recorded: number; readonly known: number;
  constructor(recorded: number, known: number) { super(`registry: the file is at schema version ${recorded}, newer than this build's ${known}; new launches are refused`); this.name = "RegistrySchemaNewerError"; this.recorded = recorded; this.known = known; }
}

export class RevisedReadingError extends Error {
  readonly selectorKey: string; readonly eventId: string; readonly recorded: string | null; readonly now: string | null;
  constructor(selectorKey: string, eventId: string, recorded: string | null, now: string | null) {
    super(`registry: ${selectorKey} ${eventId} already recorded as ${recorded}, the oracle now says ${now} — holding`);
    this.name = "RevisedReadingError";
    this.selectorKey = selectorKey; this.eventId = eventId; this.recorded = recorded; this.now = now;
  }
}
