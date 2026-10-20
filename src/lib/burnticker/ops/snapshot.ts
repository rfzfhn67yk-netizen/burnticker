import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Registry } from "@/lib/burnticker/registry";
import type { PinUploader, UploadBalance } from "@/lib/burnticker/pin";

/**
 * THE DAILY REGISTRY SNAPSHOT, PINNED TO ARWEAVE (owner-approved 2026-10-10 night, trust-ops item 1).
 *
 * Once per UTC day the keeper exports the append-only ledger of data/burnticker.db — rules (the tokens table: identity + the exact
 * rules text and its sha256), readings, receipts (the burns table), pairs, pair outcomes, rule ends and the launch pins (token_meta)
 * — as CANONICAL JSONL: one header line, then one line per row, tables in a fixed order, rows ordered by their primary key, every
 * object's keys sorted, no whitespace. The same database gives the same bytes, so anyone holding a copy (a backup, the public API)
 * recomputes the same sha256. The bytes go to Arweave through the existing Irys client (pin.ts; BURNTICKER_UPLOAD_PAYER pays;
 * devnet Irys off mainnet) and `{date, sha256, arweaveTxId, rowCounts}` is recorded in the registry's write-once `snapshots`
 * table (SQL triggers refuse updates and deletes, like every other ledger table).
 *
 * NO PAYER, NO SNAPSHOT: without an uploader the job refuses — there is never a server-hosted copy standing in for the Arweave one,
 * and nothing claims a snapshot that is not on Arweave.
 *
 * What a snapshot is NOT: it is the registry as this keeper holds it at capture time (the chain is still the final word on every
 * burn), and a few operational columns that change on every retry (attempt counters, the last error, the next-retry time, the
 * wait reason, updated_at) are left out because they are not facts about a receipt. The verifier
 * (scripts/burnticker-verify-snapshot.mts) re-downloads the bytes, recomputes the hash and re-checks the canonical form, and with
 * `--db` checks that every row of the snapshot is still present, unchanged, in a later copy of the registry (append-only across time).
 */

export const SNAPSHOT_SCHEMA = "burnticker.snapshot/v1";
export const SNAPSHOT_CONTENT_TYPE = "application/x-ndjson";
/** The keeper takes the day's snapshot on its first cycle at or after this minute of the UTC day (the last cycle of yesterday settled). */
export const SNAPSHOT_AFTER_UTC_MINUTE = 15;
/** After a failed upload the keeper tries again after this long (an alert is raised once per Denver day). */
export const SNAPSHOT_RETRY_MS = 30 * 60_000;

interface TableSpec { name: string; table: string; key: string[]; omit: string[] }
/** The ledger, in file order. `name` is what the JSONL calls it; `table` is the registry table. */
export const SNAPSHOT_TABLES: readonly TableSpec[] = [
  { name: "rules", table: "tokens", key: ["mint"], omit: [] },
  { name: "readings", table: "readings", key: ["oracle", "selector_key", "event_id"], omit: [] },
  { name: "receipts", table: "burns", key: ["mint", "event_id"], omit: ["attempts", "last_error", "next_attempt_at", "updated_at", "wait_reason"] },
  { name: "pairs", table: "pairs", key: ["pair_id"], omit: [] },
  { name: "pair_outcomes", table: "pair_outcomes", key: ["pair_id"], omit: [] },
  { name: "rule_ends", table: "rule_ends", key: ["mint"], omit: [] },
  { name: "token_meta", table: "token_meta", key: ["mint"], omit: [] },
];
export const SNAPSHOT_TABLE_NAMES = SNAPSHOT_TABLES.map((t) => t.name);

export type RowCounts = Record<string, number>;
export interface SnapshotRecord { date: string; sha256: string; arweaveTxId: string; url: string; rowCounts: RowCounts; bytes: number; uploader: string; capturedAt: number }

/** JSON with every object's keys sorted (recursively), no whitespace. Bigints as strings. Deterministic. */
export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "bigint") return JSON.stringify(v.toString());
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error("canonicalJson: non-finite number"); return JSON.stringify(v); }
  if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  throw new Error(`canonicalJson: unsupported ${typeof v}`);
}

export const sha256Hex = (b: Uint8Array | string): string => crypto.createHash("sha256").update(typeof b === "string" ? Buffer.from(b, "utf8") : b).digest("hex");
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function tableExists(db: DatabaseSync, table: string): boolean { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table); }

/** The ledger as canonical JSONL (header + rows), its sha256 and the row count per table. Pure given the database. */
export function exportLedger(registry: Pick<Registry, "db">, date: string): { text: string; sha256: string; rowCounts: RowCounts; bytes: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`snapshot: date must be YYYY-MM-DD (${date})`);
  const db = registry.db;
  const lines: string[] = [canonicalJson({ date, schema: SNAPSHOT_SCHEMA, tables: SNAPSHOT_TABLE_NAMES })];
  const rowCounts: RowCounts = {};
  for (const t of SNAPSHOT_TABLES) {
    rowCounts[t.name] = 0;
    if (!tableExists(db, t.table)) continue;
    const rows = db.prepare(`SELECT * FROM ${t.table} ORDER BY ${t.key.join(", ")}`).all() as Record<string, unknown>[];
    for (const r of rows) {
      const row: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) if (!t.omit.includes(k)) row[k] = v;
      lines.push(canonicalJson({ row, table: t.name }));
      rowCounts[t.name]++;
    }
  }
  const text = `${lines.join("\n")}\n`;
  return { text, sha256: sha256Hex(text), rowCounts, bytes: Buffer.byteLength(text, "utf8") };
}

// ---- the write-once snapshots table (in the registry file; created on first use, never by registry.ts) ----

const SNAPSHOTS_DDL = `
CREATE TABLE IF NOT EXISTS snapshots (date TEXT PRIMARY KEY, sha256 TEXT NOT NULL, arweave_tx TEXT NOT NULL, url TEXT NOT NULL, row_counts TEXT NOT NULL, bytes INTEGER NOT NULL, uploader TEXT NOT NULL, captured_at INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS snapshots_no_update BEFORE UPDATE ON snapshots BEGIN SELECT RAISE(ABORT, 'snapshots: a pinned snapshot is written once'); END;
CREATE TRIGGER IF NOT EXISTS snapshots_no_delete BEFORE DELETE ON snapshots BEGIN SELECT RAISE(ABORT, 'snapshots: append-only'); END;
`;
const ensured = new WeakSet<object>();
export function ensureSnapshotsTable(registry: Pick<Registry, "db">): void {
  if (ensured.has(registry.db)) return;
  registry.db.exec(SNAPSHOTS_DDL);
  ensured.add(registry.db);
}
type Row = Record<string, unknown>;
const toRecord = (r: Row): SnapshotRecord => ({ date: String(r.date), sha256: String(r.sha256), arweaveTxId: String(r.arweave_tx), url: String(r.url), rowCounts: JSON.parse(String(r.row_counts)) as RowCounts, bytes: Number(r.bytes), uploader: String(r.uploader), capturedAt: Number(r.captured_at) });

/** Every snapshot, newest first. */
export function listSnapshots(registry: Pick<Registry, "db">, limit = 400): SnapshotRecord[] {
  ensureSnapshotsTable(registry);
  return (registry.db.prepare("SELECT * FROM snapshots ORDER BY date DESC LIMIT ?").all(limit) as Row[]).map(toRecord);
}
export function snapshotFor(registry: Pick<Registry, "db">, date: string): SnapshotRecord | null {
  ensureSnapshotsTable(registry);
  const r = registry.db.prepare("SELECT * FROM snapshots WHERE date=?").get(date) as Row | undefined;
  return r ? toRecord(r) : null;
}
export const latestSnapshot = (registry: Pick<Registry, "db">): SnapshotRecord | null => listSnapshots(registry, 1)[0] ?? null;
/** Written once (the triggers refuse a second write for the date; INSERT, not upsert, so a duplicate throws). */
export function recordSnapshot(registry: Pick<Registry, "db">, s: SnapshotRecord): SnapshotRecord {
  ensureSnapshotsTable(registry);
  registry.db.prepare("INSERT INTO snapshots (date, sha256, arweave_tx, url, row_counts, bytes, uploader, captured_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(s.date, s.sha256, s.arweaveTxId, s.url, canonicalJson(s.rowCounts), s.bytes, s.uploader, s.capturedAt);
  return snapshotFor(registry, s.date)!;
}

// ---- the job ----

export class SnapshotRefused extends Error {}
export const NO_PAYER_REFUSAL = "BURNTICKER_UPLOAD_PAYER is not set: a snapshot is recorded only once its bytes are on Arweave, and nothing is hosted in its place — refused";

/** Is today's snapshot due? (none for today's UTC date yet, past SNAPSHOT_AFTER_UTC_MINUTE, and not inside the retry wait after a failure) */
export function snapshotDue(registry: Pick<Registry, "db" | "getStatus">, now: number): boolean {
  const d = new Date(now);
  if (d.getUTCHours() * 60 + d.getUTCMinutes() < SNAPSHOT_AFTER_UTC_MINUTE) return false;
  if (snapshotFor(registry, utcDay(now))) return false;
  const last = Number(registry.getStatus("ops.snapshot.lastFailureAt") ?? 0);
  return !(last && now - last < SNAPSHOT_RETRY_MS);
}

export interface SnapshotOutcome { status: "pinned" | "exists"; record: SnapshotRecord }

/**
 * Exports, uploads, records. `date` defaults to the UTC date of `now`; a date that already has a snapshot is returned as it is
 * ("exists") — a snapshot is never replaced. Throws SnapshotRefused without an uploader, and the uploader's error on a failed upload.
 */
export async function takeSnapshot(o: { registry: Pick<Registry, "db">; uploader: PinUploader | null; now: number; date?: string; cluster: string; log?: (s: string) => void }): Promise<SnapshotOutcome> {
  const date = o.date ?? utcDay(o.now);
  const have = snapshotFor(o.registry, date);
  if (have) return { status: "exists", record: have };
  if (!o.uploader) throw new SnapshotRefused(NO_PAYER_REFUSAL);
  const ex = exportLedger(o.registry, date);
  const tags = [{ name: "App-Name", value: "Burnticker" }, { name: "Type", value: "registry-snapshot" }, { name: "Schema", value: SNAPSHOT_SCHEMA }, { name: "Snapshot-Date", value: date }, { name: "Sha256", value: ex.sha256 }, { name: "Cluster", value: o.cluster }];
  const up = await o.uploader.upload(new TextEncoder().encode(ex.text), SNAPSHOT_CONTENT_TYPE, tags);
  if (!up?.id) throw new Error("snapshot: the uploader returned no transaction id");
  const record = recordSnapshot(o.registry, { date, sha256: ex.sha256, arweaveTxId: up.id, url: up.url, rowCounts: ex.rowCounts, bytes: ex.bytes, uploader: o.uploader.name, capturedAt: o.now });
  o.log?.(`  [snapshot] ${date}: ${ex.bytes} bytes, sha256 ${ex.sha256.slice(0, 16)}… pinned at ${up.url}`);
  return { status: "pinned", record };
}

/**
 * The keeper's hook: takes the day's snapshot when due. A refusal (no payer) or a failed upload is logged and raised as an alert
 * (`bt-snapshot-failed`, once per Denver day) and retried after SNAPSHOT_RETRY_MS; it never stops the keeper.
 */
export async function snapshotIfDue(o: { registry: Registry; uploader: PinUploader | null; now: number; cluster: string; log: (s: string) => void; alert?: (kind: string, key: string, text: string) => Promise<unknown> | unknown }): Promise<SnapshotOutcome | null> {
  if (!snapshotDue(o.registry, o.now)) return null;
  try {
    const r = await takeSnapshot(o);
    o.registry.setStatus("ops.snapshot.lastFailureAt", "0", o.now);
    return r;
  } catch (e) {
    const msg = (e as Error).message.slice(0, 240);
    o.registry.setStatus("ops.snapshot.lastFailureAt", String(o.now), o.now);
    o.registry.setStatus("ops.snapshot.lastError", msg, o.now);   // HB-82: ops.json's missing-snapshot condition says why
    o.log(`  [snapshot] ${utcDay(o.now)} not pinned: ${msg}`);
    try { await o.alert?.("bt-snapshot-failed", `bt-snapshot-failed:${utcDay(o.now)}`, `Burnticker registry snapshot for ${utcDay(o.now)} not pinned: ${msg}`); } catch { /* the alert channel failing never stops the keeper */ }
    return null;
  }
}

// ---- HB-82 (hourly run 6): the upload balance and the missing-snapshot line ----

/** The keeper raises the low-balance alert when the Irys balance covers fewer than this many daily snapshots. */
export const UPLOAD_LOW_SNAPSHOTS = 7;
/** The size the balance is priced at: one daily snapshot (about 95 KB on 2026-10-19, growing with every coin). */
export const SNAPSHOT_PRICE_BYTES = 100_000;
export const UPLOAD_BALANCE_KIND = "bt-upload-balance-low";
export const IRYS_FUND_SCRIPT = "scripts/ops/irys-fund.mts";
const BALANCE_DAY_KEY = "ops.snapshot.balanceCheckedDay", BALANCE_TRIED_KEY = "ops.snapshot.balanceTriedAt";

/** PURE: how many daily snapshots the balance covers, whether that is low, and the alert text (the payer address and the ops script named). */
export function uploadBalanceVerdict(b: UploadBalance): { covers: number; low: boolean; text: string } {
  const covers = b.priceLamports > BigInt(0) ? Number(b.balanceLamports / b.priceLamports) : 0;
  const text = `The Irys upload balance of ${b.address || "BURNTICKER_UPLOAD_PAYER"} covers ${covers} daily registry ${covers === 1 ? "snapshot" : "snapshots"} (${b.balanceLamports} lamports; one ${SNAPSHOT_PRICE_BYTES / 1000} KB upload costs about ${b.priceLamports} lamports). Below ${UPLOAD_LOW_SNAPSHOTS}, fund it from the payer wallet with ${IRYS_FUND_SCRIPT} --send <sol>.`;
  return { covers, low: covers < UPLOAD_LOW_SNAPSHOTS, text };
}

/**
 * Once per UTC day (the active keeper, after its snapshot step): reads the uploader's balance and the price of one snapshot (two Irys
 * requests in the "irys" budget lane) and raises UPLOAD_BALANCE_KIND when it covers fewer than UPLOAD_LOW_SNAPSHOTS snapshots. A failed
 * read is logged and tried again after SNAPSHOT_RETRY_MS. Never throws.
 */
export async function checkUploadBalance(o: { registry: Pick<Registry, "getStatus" | "setStatus">; uploader: PinUploader | null; now: number; log: (s: string) => void; alert?: (kind: string, key: string, text: string) => Promise<unknown> | unknown }): Promise<{ covers: number; low: boolean; text: string } | null> {
  if (!o.uploader?.balance) return null;
  const day = utcDay(o.now);
  if (o.registry.getStatus(BALANCE_DAY_KEY) === day) return null;
  const tried = Number(o.registry.getStatus(BALANCE_TRIED_KEY) ?? 0);
  if (tried && o.now - tried < SNAPSHOT_RETRY_MS) return null;
  o.registry.setStatus(BALANCE_TRIED_KEY, String(o.now), o.now);
  let v: ReturnType<typeof uploadBalanceVerdict>;
  try { v = uploadBalanceVerdict(await o.uploader.balance(SNAPSHOT_PRICE_BYTES)); } catch (e) { o.log(`  [snapshot] upload balance not read: ${(e as Error).message.slice(0, 160)}`); return null; }
  o.registry.setStatus(BALANCE_DAY_KEY, day, o.now);
  o.log(`  [snapshot] upload balance covers ${v.covers} daily snapshots${v.low ? " (LOW)" : ""}`);
  if (v.low) { try { await o.alert?.(UPLOAD_BALANCE_KIND, `${UPLOAD_BALANCE_KIND}:${day}`, v.text); } catch { /* the alert channel failing never stops the keeper */ } }
  return v;
}

export const SNAPSHOT_MISSING_KIND = "bt-snapshot-missing";
/** The plain line for a missing day's snapshot (no date in the prose; the date is its own field). */
export const snapshotMissingLine = (failed: boolean): string => `Today's registry snapshot is not pinned yet.${failed ? " The last upload failed, and the keeper tries again every 30 minutes." : " The keeper takes it on its next cycle."}`;
export interface SnapshotMissing { date: string; lastFailureAt: number | null; lastError: string | null; line: string }
/**
 * Read-only (never creates the table, so the web can call it): today's snapshot is missing once the UTC day is past
 * SNAPSHOT_AFTER_UTC_MINUTE and the snapshots table has no row for it. null when it is pinned, not due yet or not readable.
 */
export function snapshotMissingFact(registry: Pick<Registry, "db" | "getStatus">, now: number): SnapshotMissing | null {
  const d = new Date(now);
  if (d.getUTCHours() * 60 + d.getUTCMinutes() < SNAPSHOT_AFTER_UTC_MINUTE) return null;
  const date = utcDay(now);
  try { if (tableExists(registry.db, "snapshots") && registry.db.prepare("SELECT 1 FROM snapshots WHERE date=?").get(date)) return null; } catch { return null; }
  const lastFailureAt = Number(registry.getStatus("ops.snapshot.lastFailureAt") ?? 0) || null;
  const failedToday = lastFailureAt !== null && utcDay(lastFailureAt) === date;
  return { date, lastFailureAt: failedToday ? lastFailureAt : null, lastError: failedToday ? registry.getStatus("ops.snapshot.lastError") : null, line: snapshotMissingLine(failedToday) };
}

/** HB-82: current-status's view of today's snapshot (read-only; null when the registry cannot be read). The line is set only once the day's snapshot is due and missing. */
export function registrySnapshotView(registry: Pick<Registry, "db" | "getStatus">, now: number): { date: string; pinned: boolean; line: string | null } | null {
  try {
    const date = utcDay(now);
    const pinned = tableExists(registry.db, "snapshots") && !!registry.db.prepare("SELECT 1 FROM snapshots WHERE date=?").get(date);
    return { date, pinned, line: pinned ? null : snapshotMissingFact(registry, now)?.line ?? null };
  } catch { return null; }
}

// ---- the verifier's checks (pure; scripts/burnticker-verify-snapshot.mts does the download) ----

export interface SnapshotCheck { ok: boolean; sha256: string; date: string | null; rowCounts: RowCounts; bytes: number; problems: string[] }

/** Re-checks downloaded bytes: the hash (against `expect` when given), the header, the canonical form of every line, the table order and the key order inside each table. */
export function verifySnapshotBytes(bytes: Uint8Array | string, expect: { sha256?: string | null; rowCounts?: RowCounts | null; date?: string | null } = {}): SnapshotCheck {
  const text = typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8");
  const sha = sha256Hex(text);
  const problems: string[] = [];
  if (expect.sha256 && expect.sha256 !== sha) problems.push(`sha256 ${sha} ≠ the recorded ${expect.sha256}`);
  if (!text.endsWith("\n")) problems.push("the file does not end with a newline");
  const lines = text.split("\n"); if (lines[lines.length - 1] === "") lines.pop();
  const rowCounts: RowCounts = Object.fromEntries(SNAPSHOT_TABLE_NAMES.map((n) => [n, 0]));
  let date: string | null = null;
  let header: { date?: string; schema?: string; tables?: string[] } | null = null;
  try { header = JSON.parse(lines[0] ?? "null"); } catch { problems.push("line 1 is not JSON"); }
  if (header) {
    if (header.schema !== SNAPSHOT_SCHEMA) problems.push(`header schema ${String(header.schema)} ≠ ${SNAPSHOT_SCHEMA}`);
    date = typeof header.date === "string" ? header.date : null;
    if (JSON.stringify(header.tables) !== JSON.stringify(SNAPSHOT_TABLE_NAMES)) problems.push("header tables are not the snapshot's table list");
    if (canonicalJson(header) !== lines[0]) problems.push("line 1 is not canonical JSON");
  }
  if (expect.date && date !== expect.date) problems.push(`snapshot date ${date} ≠ the recorded ${expect.date}`);
  let tableIdx = -1; let prevKey: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    let o: { table?: string; row?: Record<string, unknown> };
    try { o = JSON.parse(lines[i]); } catch { problems.push(`line ${i + 1} is not JSON`); continue; }
    if (canonicalJson(o) !== lines[i]) problems.push(`line ${i + 1} is not canonical JSON`);
    const ti = SNAPSHOT_TABLE_NAMES.indexOf(String(o.table));
    if (ti < 0) { problems.push(`line ${i + 1}: unknown table ${String(o.table)}`); continue; }
    if (ti < tableIdx) problems.push(`line ${i + 1}: table ${o.table} out of order`);
    if (ti !== tableIdx) { tableIdx = ti; prevKey = null; }
    const spec = SNAPSHOT_TABLES[ti];
    const key = JSON.stringify(spec.key.map((k) => o.row?.[k] ?? null));
    if (prevKey !== null && compareKeys(spec.key.map((k) => o.row?.[k] ?? null), JSON.parse(prevKey)) <= 0) problems.push(`line ${i + 1}: ${o.table} rows are not in key order`);
    prevKey = key;
    rowCounts[spec.name]++;
  }
  if (expect.rowCounts) for (const n of SNAPSHOT_TABLE_NAMES) if ((expect.rowCounts[n] ?? 0) !== rowCounts[n]) problems.push(`The ${n} table has ${rowCounts[n]} ${rowCounts[n] === 1 ? "row" : "rows"}, but the record says ${expect.rowCounts[n] ?? 0}.`);
  if (problems.length > 50) problems.splice(50, problems.length - 50, `… and more`);
  return { ok: problems.length === 0, sha256: sha, date, rowCounts, bytes: Buffer.byteLength(text, "utf8"), problems };
}

/** SQLite's default ordering of the key tuple (numbers before text; text by bytes — the BINARY collation). */
function compareKeys(a: unknown[], b: unknown[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    const tx = typeof x === "number" ? 0 : 1, ty = typeof y === "number" ? 0 : 1;
    if (tx !== ty) return tx - ty;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return Buffer.compare(Buffer.from(String(x)), Buffer.from(String(y)));
  }
  return 0;
}

/**
 * APPEND-ONLY ACROSS TIME: every row of an earlier snapshot must still be in a later copy of the registry. Immutable tables
 * (readings, pairs, pair outcomes, rule ends, launch pins) must match exactly; a rule row's identity and rule columns must match
 * (status may move draft → live → retired); a receipt's facts must match, and a receipt that was final (confirmed / void /
 * exhausted / voided) must match in full. Returns the problems (empty = append-only held).
 */
export const RULE_IMMUTABLE = ["mint", "ticker", "name", "creator", "description", "image_url", "links_json", "oracle", "selector_key", "rules_json", "rules_sha", "mode", "fee_pda", "vault", "cluster", "created_at"];
export const RECEIPT_FACTS = ["mint", "event_id", "settled_at", "result", "value", "units", "mapping_json", "kind", "prev_value", "carry_in", "carry_out", "created_at"];
const FINAL = new Set(["confirmed", "void", "exhausted", "voided"]);
export function appendOnlyProblems(snapshotText: string, later: Pick<Registry, "db">): string[] {
  const later2 = exportLedger(later, "1970-01-01");
  const index = new Map<string, Record<string, unknown>>();
  for (const line of later2.text.split("\n").slice(1)) {
    if (!line) continue;
    const o = JSON.parse(line) as { table: string; row: Record<string, unknown> };
    const spec = SNAPSHOT_TABLES.find((t) => t.name === o.table)!;
    index.set(`${o.table}|${JSON.stringify(spec.key.map((k) => o.row[k] ?? null))}`, o.row);
  }
  const out: string[] = [];
  for (const line of snapshotText.split("\n").slice(1)) {
    if (!line) continue;
    const o = JSON.parse(line) as { table: string; row: Record<string, unknown> };
    const spec = SNAPSHOT_TABLES.find((t) => t.name === o.table);
    if (!spec) { out.push(`unknown table ${o.table}`); continue; }
    const id = `${o.table} ${spec.key.map((k) => String(o.row[k])).join("/")}`;
    const now = index.get(`${o.table}|${JSON.stringify(spec.key.map((k) => o.row[k] ?? null))}`);
    if (!now) { out.push(`${id}: missing from the later registry`); continue; }
    const cols = o.table === "rules" ? RULE_IMMUTABLE : o.table === "receipts" ? (FINAL.has(String(o.row.status)) ? Object.keys(o.row) : RECEIPT_FACTS) : Object.keys(o.row);
    const changed = cols.filter((c) => c in o.row && canonicalJson(o.row[c]) !== canonicalJson(now[c]));
    if (changed.length) out.push(`${id}: changed ${changed.join(", ")}`);
    if (out.length > 100) { out.push("… and more"); break; }
  }
  return out;
}

/** Where to fetch a snapshot's bytes: Arweave on mainnet, Irys devnet's gateway otherwise (pin.ts's URL convention). */
export function gatewayUrl(txid: string, cluster: string, gateway?: string | null): string {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(txid)) throw new Error(`not an Arweave/Irys transaction id: ${txid}`);
  const base = gateway?.trim() ? gateway.trim().replace(/\/$/, "") : cluster === "mainnet" ? "https://arweave.net" : "https://devnet.irys.xyz";
  return `${base}/${txid}`;
}
