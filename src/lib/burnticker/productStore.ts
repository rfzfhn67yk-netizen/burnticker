import type { DatabaseSync } from "node:sqlite";
import { fold } from "@/lib/burnticker/textMatch";

/**
 * PRODUCT TELEMETRY, FIRST-PARTY AND ANONYMOUS (2026-10-10, the owner's next batch). Two append-only tables in the registry's own SQLite
 * file (kept out of registry.ts; created on first use like the derby store). Nothing here can identify a person: no IP, no user id, no
 * session id, no wallet, no cookie, no third party. docs/burnticker/transparency.md § Privacy says the same.
 *
 *   search_misses   a search that found no card (logged by the server) or found cards but got no "Use this" click before the person
 *                   searched again or left (reported by the page): the query folded to plain words (≤ 80 characters; anything that
 *                   looks like a wallet address, an e-mail or a long number dropped), the card count, the reason, the UTC hour.
 *   launch_timings  per launch draft: how long each wizard step took (seconds between the page's own step timestamps, which are sent
 *                   with the launch bundle request only and kept as durations, never as clock times).
 */
export const PRODUCT_SCHEMA = `
CREATE TABLE IF NOT EXISTS search_misses (id INTEGER PRIMARY KEY AUTOINCREMENT, hour TEXT NOT NULL, query TEXT NOT NULL, cards INTEGER NOT NULL, reason TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS search_misses_by_hour ON search_misses (hour);
CREATE TRIGGER IF NOT EXISTS search_misses_no_update BEFORE UPDATE ON search_misses BEGIN SELECT RAISE(ABORT, 'search_misses: append-only'); END;
CREATE TRIGGER IF NOT EXISTS search_misses_no_delete BEFORE DELETE ON search_misses BEGIN SELECT RAISE(ABORT, 'search_misses: append-only'); END;
CREATE TABLE IF NOT EXISTS launch_timings (mint TEXT PRIMARY KEY, created_at INTEGER NOT NULL, steps_json TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS launch_timings_no_update BEFORE UPDATE ON launch_timings BEGIN SELECT RAISE(ABORT, 'launch_timings: written once'); END;
CREATE TRIGGER IF NOT EXISTS launch_timings_no_delete BEFORE DELETE ON launch_timings BEGIN SELECT RAISE(ABORT, 'launch_timings: append-only'); END;
`;

export type MissReason = "no-card" | "no-click";
/** The wizard's steps in order; a duration is from the previous step to this one. */
export const STEPS = ["search", "card", "create", "review", "launch"] as const;
export type Step = (typeof STEPS)[number];
export const STEP_LABEL: Record<Step, string> = { search: "entered the search", card: "chose a card", create: "reached the create screen", review: "reached the review", launch: "pressed Launch (before signing)" };

/** The query as stored: folded to plain words, identifying-looking tokens dropped, at most 80 characters. Empty → not stored. */
export function anonymiseQuery(q: string): string {
  const raw = q.trim().split(/\s+/).filter((w) => !/@/.test(w) && !/^[1-9A-HJ-NP-Za-km-z]{25,}$/.test(w) && !/\d{7,}/.test(w)).join(" ");
  return fold(raw).slice(0, 80).trim();
}
export const hourBucket = (ms: number): string => new Date(ms).toISOString().slice(0, 13) + ":00Z";

const pct = (xs: number[], p: number): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

export class ProductStore {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; this.db.exec(PRODUCT_SCHEMA); }
  /** Logs one miss; returns false when the query anonymises to nothing. */
  logMiss(o: { query: string; cards: number; reason: MissReason }, now = Date.now()): boolean {
    const q = anonymiseQuery(o.query);
    if (q.length < 3) return false;
    this.db.prepare("INSERT INTO search_misses (hour, query, cards, reason) VALUES (?,?,?,?)").run(hourBucket(now), q, Math.max(0, Math.min(99, Math.round(o.cards))), o.reason);
    return true;
  }
  missSummary(sinceMs: number, top = 25): { since: string; total: number; noCard: number; noClick: number; queries: { query: string; misses: number; noCard: number; noClick: number; lastHour: string }[] } {
    const since = hourBucket(sinceMs);
    const rows = this.db.prepare("SELECT query, reason, hour FROM search_misses WHERE hour >= ? ORDER BY hour").all(since) as { query: string; reason: string; hour: string }[];
    const by = new Map<string, { query: string; misses: number; noCard: number; noClick: number; lastHour: string }>();
    for (const r of rows) { const x = by.get(r.query) ?? { query: r.query, misses: 0, noCard: 0, noClick: 0, lastHour: r.hour }; x.misses++; if (r.reason === "no-card") x.noCard++; else x.noClick++; x.lastHour = r.hour; by.set(r.query, x); }
    return { since, total: rows.length, noCard: rows.filter((r) => r.reason === "no-card").length, noClick: rows.filter((r) => r.reason === "no-click").length, queries: [...by.values()].sort((a, b) => b.misses - a.misses || a.query.localeCompare(b.query)).slice(0, top) };
  }
  /** Stores a draft's step durations once (seconds); returns the stored durations, or null when nothing valid was sent. */
  putTimings(mint: string, raw: unknown, now = Date.now()): Partial<Record<Step, number>> | null {
    const d = stepDurations(raw, now);
    if (!d) return null;
    this.db.prepare("INSERT OR IGNORE INTO launch_timings (mint, created_at, steps_json) VALUES (?,?,?)").run(mint, now, JSON.stringify(d));
    return d;
  }
  timings(mint: string): Partial<Record<Step, number>> | null { const r = this.db.prepare("SELECT steps_json FROM launch_timings WHERE mint=?").get(mint) as { steps_json: string } | undefined; return r ? JSON.parse(r.steps_json) : null; }
  timingSummary(sinceMs: number): { since: string; drafts: number; steps: { step: Step; label: string; n: number; p50Sec: number | null; p90Sec: number | null }[]; total: { n: number; p50Sec: number | null; p90Sec: number | null } } {
    const rows = (this.db.prepare("SELECT steps_json FROM launch_timings WHERE created_at >= ?").all(sinceMs) as { steps_json: string }[]).map((r) => JSON.parse(r.steps_json) as Partial<Record<Step, number>>);
    const steps = STEPS.slice(1).map((s) => { const xs = rows.map((r) => r[s]).filter((x): x is number => typeof x === "number"); return { step: s, label: STEP_LABEL[s], n: xs.length, p50Sec: pct(xs, 50), p90Sec: pct(xs, 90) }; });
    const totals = rows.map((r) => STEPS.slice(1).reduce((a, s) => a + (r[s] ?? 0), 0)).filter((x) => x > 0);
    return { since: new Date(sinceMs).toISOString(), drafts: rows.length, steps, total: { n: totals.length, p50Sec: pct(totals, 50), p90Sec: pct(totals, 90) } };
  }
}

/**
 * The page's step timestamps (ms) → the seconds each step took. Only steps that were reached count; a timestamp outside the last day,
 * in the future, or out of order drops the steps it would corrupt. The clock times themselves are never stored.
 */
export function stepDurations(raw: unknown, now = Date.now()): Partial<Record<Step, number>> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const t = raw as Record<string, unknown>;
  const at: Partial<Record<Step, number>> = {};
  for (const s of STEPS) { const v = Number(t[s]); if (Number.isFinite(v) && v > now - 86_400_000 && v <= now + 60_000) at[s] = v; }
  const out: Partial<Record<Step, number>> = {};
  let prev: number | null = null;
  for (const s of STEPS) { const v = at[s]; if (v === undefined) continue; if (prev !== null) { if (v < prev) return Object.keys(out).length ? out : null; out[s] = Math.round((v - prev) / 1000); } prev = v; }
  return Object.keys(out).length ? out : null;
}

const stores = new WeakMap<DatabaseSync, ProductStore>();
export function productStore(db: DatabaseSync): ProductStore {
  let s = stores.get(db);
  if (!s) { s = new ProductStore(db); stores.set(db, s); }
  return s;
}
