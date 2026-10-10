import type { DatabaseSync } from "node:sqlite";

/**
 * BURN DERBY'S RECORDS (2026-10-10), in the registry's own database file (data/burnticker.db) beside the tokens, readings and receipts —
 * APPEND-ONLY by SQL trigger, like everything else there:
 *
 *   derby_points       every Pyth boundary update the keeper used: feed, boundary, publish_time, price/conf/expo, the update bytes
 *                      (base64) and their sha256 — immutable, so a reading can be re-verified without Hermes.
 *   derby_samples      spot reads taken by the keeper's sampler: pool vault balances (TWAP fallback), cross-read quotes (Jupiter /
 *                      DexScreener), mint supplies (mcap). One row per (key, kind, ts).
 *   derby_windows      THE DECISIONS: one row per (selector key, window) — decided (an event id, YES/NO/void, the margin, the proof
 *                      JSON and its sha256) or withheld (the reason). Written once; the registry reading is derived from a decided row,
 *                      so a re-read can never mint a second event for the same window.
 *   derby_tournaments  every bracket: its canonical JSON and sha256 (each fan coin's rule names the sha).
 */

export const DERBY_SCHEMA = `
CREATE TABLE IF NOT EXISTS derby_points (feed TEXT NOT NULL, boundary INTEGER NOT NULL, publish_time INTEGER NOT NULL, price TEXT NOT NULL, conf TEXT NOT NULL, expo INTEGER NOT NULL, value TEXT NOT NULL, slot INTEGER,
  update_sha256 TEXT NOT NULL, update_b64 TEXT NOT NULL, url TEXT NOT NULL, fetched_at INTEGER NOT NULL, PRIMARY KEY (feed, boundary));
CREATE TABLE IF NOT EXISTS derby_samples (key TEXT NOT NULL, kind TEXT NOT NULL, ts INTEGER NOT NULL, slot INTEGER, value TEXT NOT NULL, detail_json TEXT NOT NULL, PRIMARY KEY (key, kind, ts));
CREATE INDEX IF NOT EXISTS derby_samples_by_time ON derby_samples (key, kind, ts);
CREATE TABLE IF NOT EXISTS derby_windows (selector_key TEXT NOT NULL, window_id TEXT NOT NULL, status TEXT NOT NULL, event_id TEXT, at TEXT NOT NULL, result TEXT, value TEXT, reason TEXT,
  proof_sha256 TEXT, proof_json TEXT, decided_at INTEGER NOT NULL, PRIMARY KEY (selector_key, window_id));
CREATE TABLE IF NOT EXISTS derby_tournaments (id TEXT PRIMARY KEY, json TEXT NOT NULL, sha256 TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS derby_points_no_update BEFORE UPDATE ON derby_points BEGIN SELECT RAISE(ABORT, 'derby_points: append-only'); END;
CREATE TRIGGER IF NOT EXISTS derby_points_no_delete BEFORE DELETE ON derby_points BEGIN SELECT RAISE(ABORT, 'derby_points: append-only'); END;
CREATE TRIGGER IF NOT EXISTS derby_samples_no_update BEFORE UPDATE ON derby_samples BEGIN SELECT RAISE(ABORT, 'derby_samples: append-only'); END;
CREATE TRIGGER IF NOT EXISTS derby_samples_no_delete BEFORE DELETE ON derby_samples BEGIN SELECT RAISE(ABORT, 'derby_samples: append-only'); END;
CREATE TRIGGER IF NOT EXISTS derby_windows_no_update BEFORE UPDATE ON derby_windows BEGIN SELECT RAISE(ABORT, 'derby_windows: a window is decided once'); END;
CREATE TRIGGER IF NOT EXISTS derby_windows_no_delete BEFORE DELETE ON derby_windows BEGIN SELECT RAISE(ABORT, 'derby_windows: append-only'); END;
CREATE TRIGGER IF NOT EXISTS derby_tournaments_no_update BEFORE UPDATE ON derby_tournaments BEGIN SELECT RAISE(ABORT, 'derby_tournaments: a bracket is locked by hash'); END;
CREATE TRIGGER IF NOT EXISTS derby_tournaments_no_delete BEFORE DELETE ON derby_tournaments BEGIN SELECT RAISE(ABORT, 'derby_tournaments: append-only'); END;
`;

export interface PointRow { feed: string; boundary: number; publishTime: number; price: string; conf: string; expo: number; value: string; slot: number | null; updateSha256: string; updateBase64: string; url: string; fetchedAt: number }
export interface SampleRow { key: string; kind: "pool" | "cross" | "supply" | "pyth"; ts: number; slot: number | null; value: string; detail: Record<string, unknown> }
export interface WindowRow { selectorKey: string; windowId: string; status: "decided" | "withheld"; eventId: string | null; at: string; result: "yes" | "no" | "void" | null; value: string | null; reason: string | null; proofSha256: string | null; proof: Record<string, unknown> | null; decidedAt: number }
export interface TournamentRow { id: string; json: string; sha256: string; createdAt: number }

type Row = Record<string, unknown>;
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export class DerbyStore {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; this.db.exec(DERBY_SCHEMA); }

  // ---- Pyth boundary updates ----
  putPoint(p: PointRow): void {
    this.db.prepare("INSERT OR IGNORE INTO derby_points (feed, boundary, publish_time, price, conf, expo, value, slot, update_sha256, update_b64, url, fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(p.feed, p.boundary, p.publishTime, p.price, p.conf, p.expo, p.value, p.slot, p.updateSha256, p.updateBase64, p.url, p.fetchedAt);
  }
  point(feed: string, boundary: number): PointRow | null {
    const r = this.db.prepare("SELECT * FROM derby_points WHERE feed=? AND boundary=?").get(feed, boundary) as Row | undefined;
    return r ? { feed: String(r.feed), boundary: Number(r.boundary), publishTime: Number(r.publish_time), price: String(r.price), conf: String(r.conf), expo: Number(r.expo), value: String(r.value), slot: n(r.slot), updateSha256: String(r.update_sha256), updateBase64: String(r.update_b64), url: String(r.url), fetchedAt: Number(r.fetched_at) } : null;
  }

  // ---- samples ----
  putSample(x: SampleRow): boolean {
    return Number(this.db.prepare("INSERT OR IGNORE INTO derby_samples (key, kind, ts, slot, value, detail_json) VALUES (?,?,?,?,?,?)").run(x.key, x.kind, x.ts, x.slot, x.value, JSON.stringify(x.detail)).changes) > 0;
  }
  samples(key: string, kind: SampleRow["kind"], fromMs: number, toMs: number): SampleRow[] {
    return (this.db.prepare("SELECT * FROM derby_samples WHERE key=? AND kind=? AND ts>=? AND ts<=? ORDER BY ts").all(key, kind, fromMs, toMs) as Row[])
      .map((r) => ({ key: String(r.key), kind: String(r.kind) as SampleRow["kind"], ts: Number(r.ts), slot: n(r.slot), value: String(r.value), detail: JSON.parse(String(r.detail_json)) }));
  }
  lastSample(key: string, kind: SampleRow["kind"]): SampleRow | null {
    const r = this.db.prepare("SELECT * FROM derby_samples WHERE key=? AND kind=? ORDER BY ts DESC LIMIT 1").get(key, kind) as Row | undefined;
    return r ? { key: String(r.key), kind: String(r.kind) as SampleRow["kind"], ts: Number(r.ts), slot: n(r.slot), value: String(r.value), detail: JSON.parse(String(r.detail_json)) } : null;
  }
  /** The sample closest to `atMs` within ±tolMs (ties: the earlier one). */
  nearest(key: string, kind: SampleRow["kind"], atMs: number, tolMs: number): SampleRow | null {
    const xs = this.samples(key, kind, atMs - tolMs, atMs + tolMs);
    return xs.sort((a, b) => Math.abs(a.ts - atMs) - Math.abs(b.ts - atMs) || a.ts - b.ts)[0] ?? null;
  }

  // ---- window decisions ----
  /** Records a window's decision once; returns the stored row (an earlier decision wins — a re-read never changes it). */
  decide(w: Omit<WindowRow, "decidedAt">, now = Date.now()): WindowRow {
    this.db.prepare("INSERT OR IGNORE INTO derby_windows (selector_key, window_id, status, event_id, at, result, value, reason, proof_sha256, proof_json, decided_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(w.selectorKey, w.windowId, w.status, w.eventId, w.at, w.result, w.value, w.reason, w.proofSha256, w.proof ? JSON.stringify(w.proof) : null, now);
    return this.window(w.selectorKey, w.windowId)!;
  }
  window(selectorKey: string, windowId: string): WindowRow | null {
    const r = this.db.prepare("SELECT * FROM derby_windows WHERE selector_key=? AND window_id=?").get(selectorKey, windowId) as Row | undefined;
    return r ? toWindow(r) : null;
  }
  windows(selectorKey: string): WindowRow[] { return (this.db.prepare("SELECT * FROM derby_windows WHERE selector_key=? ORDER BY at, window_id").all(selectorKey) as Row[]).map(toWindow); }

  // ---- tournaments ----
  putTournament(t: { id: string; json: string; sha256: string }, now = Date.now()): TournamentRow {
    const have = this.tournament(t.id);
    if (have) { if (have.sha256 !== t.sha256) throw new Error(`derby: tournament ${t.id} already exists with a different bracket (sha256 ${have.sha256.slice(0, 12)}…)`); return have; }
    this.db.prepare("INSERT INTO derby_tournaments (id, json, sha256, created_at) VALUES (?,?,?,?)").run(t.id, t.json, t.sha256, now);
    return this.tournament(t.id)!;
  }
  tournament(id: string): TournamentRow | null { const r = this.db.prepare("SELECT * FROM derby_tournaments WHERE id=?").get(id) as Row | undefined; return r ? { id: String(r.id), json: String(r.json), sha256: String(r.sha256), createdAt: Number(r.created_at) } : null; }
  tournaments(): TournamentRow[] { return (this.db.prepare("SELECT * FROM derby_tournaments ORDER BY created_at").all() as Row[]).map((r) => ({ id: String(r.id), json: String(r.json), sha256: String(r.sha256), createdAt: Number(r.created_at) })); }
}

const toWindow = (r: Row): WindowRow => ({ selectorKey: String(r.selector_key), windowId: String(r.window_id), status: String(r.status) as WindowRow["status"], eventId: s(r.event_id), at: String(r.at), result: s(r.result) as WindowRow["result"], value: s(r.value), reason: s(r.reason), proofSha256: s(r.proof_sha256), proof: r.proof_json ? JSON.parse(String(r.proof_json)) : null, decidedAt: Number(r.decided_at) });

/** One store per database handle (the registry's), so the app and the keeper share the same tables. */
const stores = new WeakMap<DatabaseSync, DerbyStore>();
export function derbyStore(db: DatabaseSync): DerbyStore {
  let st = stores.get(db);
  if (!st) { st = new DerbyStore(db); stores.set(db, st); }
  return st;
}
