import type { DatabaseSync } from "node:sqlite";
import { fold } from "@/lib/burnticker/textMatch";

/**
 * PRODUCT TELEMETRY, FIRST-PARTY AND ANONYMOUS (2026-10-10, the owner's next batch). Two append-only tables in the registry's own SQLite
 * file (kept out of registry.ts; created on first use like the derby store). Nothing here can identify a person: no IP, no user id, no
 * session id, no wallet, no cookie, no third party. docs/burnticker/transparency.md § Privacy says the same.
 *
 *   search misses   a search that found no card (logged by the server) or found cards but got no "Use this" click before the person
 *                   searched again or left (reported by the page): the query folded to plain words (≤ 80 characters; anything that
 *                   looks like a wallet address, an e-mail or a long number dropped) and the reason, kept as COUNTS (audit 2026-10-18
 *                   A-41): one row per UTC day and query (search_miss_counts), each count capped at MISS_COUNT_CAP, at most
 *                   MISS_QUERIES_PER_DAY queries a day (later ones only add to the day's totals in search_miss_days), and both tables
 *                   pruned after MISS_RETENTION_DAYS. The first version appended one row per miss (search_misses, append-only by
 *                   trigger): one client at the read bucket's rate wrote about 173,000 rows a day and nothing could delete them. That
 *                   table is no longer written; its old rows still count in the summary.
 *   launch_timings  per launch draft: how long each wizard step took (seconds between the page's own step timestamps, which are sent
 *                   with the launch bundle request only and kept as durations, never as clock times).
 */
export const PRODUCT_SCHEMA = `
CREATE TABLE IF NOT EXISTS search_misses (id INTEGER PRIMARY KEY AUTOINCREMENT, hour TEXT NOT NULL, query TEXT NOT NULL, cards INTEGER NOT NULL, reason TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS search_misses_by_hour ON search_misses (hour);
CREATE TRIGGER IF NOT EXISTS search_misses_no_update BEFORE UPDATE ON search_misses BEGIN SELECT RAISE(ABORT, 'search_misses: append-only'); END;
CREATE TRIGGER IF NOT EXISTS search_misses_no_delete BEFORE DELETE ON search_misses BEGIN SELECT RAISE(ABORT, 'search_misses: append-only'); END;
CREATE TABLE IF NOT EXISTS search_miss_counts (day TEXT NOT NULL, query TEXT NOT NULL, no_card INTEGER NOT NULL DEFAULT 0, no_click INTEGER NOT NULL DEFAULT 0, last_hour TEXT NOT NULL, PRIMARY KEY (day, query));
CREATE TABLE IF NOT EXISTS search_miss_days (day TEXT PRIMARY KEY, no_card INTEGER NOT NULL DEFAULT 0, no_click INTEGER NOT NULL DEFAULT 0, queries INTEGER NOT NULL DEFAULT 0, over_cap INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS launch_timings (mint TEXT PRIMARY KEY, created_at INTEGER NOT NULL, steps_json TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS launch_timings_no_update BEFORE UPDATE ON launch_timings BEGIN SELECT RAISE(ABORT, 'launch_timings: written once'); END;
CREATE TRIGGER IF NOT EXISTS launch_timings_no_delete BEFORE DELETE ON launch_timings BEGIN SELECT RAISE(ABORT, 'launch_timings: append-only'); END;
`;

export type MissReason = "no-card" | "no-click";
/** The most distinct queries kept for one UTC day; later queries only add to the day's totals. */
export const MISS_QUERIES_PER_DAY = 2_000;
/** One query's count for one day stops here (a script repeating one query cannot make it look like the top miss for long). */
export const MISS_COUNT_CAP = 500;
/** Days of counts kept; older days are deleted on the first miss of a new day. */
export const MISS_RETENTION_DAYS = 90;
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
  private prunedDay = "";
  constructor(db: DatabaseSync) { this.db = db; this.db.exec(PRODUCT_SCHEMA); }
  /**
   * Counts one miss (A-41): the day's totals always; the query's own count while the day holds fewer than MISS_QUERIES_PER_DAY queries,
   * capped at MISS_COUNT_CAP. Returns false when the query anonymises to nothing or the day is full.
   */
  logMiss(o: { query: string; cards: number; reason: MissReason }, now = Date.now()): boolean {
    const q = anonymiseQuery(o.query);
    if (q.length < 3) return false;
    const hour = hourBucket(now), day = hour.slice(0, 10), col = o.reason === "no-card" ? "no_card" : "no_click";
    if (this.prunedDay !== day) this.pruneMisses(now);
    this.db.prepare(`INSERT INTO search_miss_days (day, ${col}) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET ${col} = ${col} + 1`).run(day);
    const had = this.db.prepare("SELECT 1 FROM search_miss_counts WHERE day=? AND query=?").get(day, q);
    if (had) { this.db.prepare(`UPDATE search_miss_counts SET ${col} = MIN(${col} + 1, ?), last_hour = ? WHERE day=? AND query=?`).run(MISS_COUNT_CAP, hour, day, q); return true; }
    const d = this.db.prepare("SELECT queries FROM search_miss_days WHERE day=?").get(day) as { queries: number };
    if (d.queries >= MISS_QUERIES_PER_DAY) { this.db.prepare("UPDATE search_miss_days SET over_cap = over_cap + 1 WHERE day=?").run(day); return false; }
    this.db.prepare(`INSERT INTO search_miss_counts (day, query, ${col}, last_hour) VALUES (?,?,1,?)`).run(day, q, hour);
    this.db.prepare("UPDATE search_miss_days SET queries = queries + 1 WHERE day=?").run(day);
    return true;
  }
  /** Deletes counts older than MISS_RETENTION_DAYS (the count tables carry no append-only trigger). Returns the rows deleted. */
  pruneMisses(now = Date.now()): number {
    this.prunedDay = hourBucket(now).slice(0, 10);
    const cutoff = new Date(now - MISS_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
    const a = Number(this.db.prepare("DELETE FROM search_miss_counts WHERE day < ?").run(cutoff).changes);
    const b = Number(this.db.prepare("DELETE FROM search_miss_days WHERE day < ?").run(cutoff).changes);
    return a + b;
  }
  missSummary(sinceMs: number, top = 25): { since: string; total: number; noCard: number; noClick: number; queries: { query: string; misses: number; noCard: number; noClick: number; lastHour: string }[] } {
    const since = hourBucket(sinceMs), sinceDay = since.slice(0, 10);
    const by = new Map<string, { query: string; misses: number; noCard: number; noClick: number; lastHour: string }>();
    const add = (query: string, noCard: number, noClick: number, hour: string) => { const x = by.get(query) ?? { query, misses: 0, noCard: 0, noClick: 0, lastHour: hour }; x.misses += noCard + noClick; x.noCard += noCard; x.noClick += noClick; if (hour > x.lastHour) x.lastHour = hour; by.set(query, x); };
    let noCard = 0, noClick = 0;
    // rows from the first version (one per miss; no longer written)
    const legacy = this.db.prepare("SELECT query, reason, hour FROM search_misses WHERE hour >= ? ORDER BY hour").all(since) as { query: string; reason: string; hour: string }[];
    for (const r of legacy) { const c = r.reason === "no-card" ? 1 : 0; add(r.query, c, 1 - c, r.hour); noCard += c; noClick += 1 - c; }
    // the day counts (whole UTC days: a count carries no hour of its own)
    for (const r of this.db.prepare("SELECT query, no_card, no_click, last_hour FROM search_miss_counts WHERE day >= ?").all(sinceDay) as { query: string; no_card: number; no_click: number; last_hour: string }[]) add(r.query, r.no_card, r.no_click, r.last_hour);
    const t = this.db.prepare("SELECT COALESCE(SUM(no_card),0) AS c, COALESCE(SUM(no_click),0) AS k FROM search_miss_days WHERE day >= ?").get(sinceDay) as { c: number; k: number };
    noCard += Number(t.c); noClick += Number(t.k);
    return { since, total: noCard + noClick, noCard, noClick, queries: [...by.values()].sort((a, b) => b.misses - a.misses || a.query.localeCompare(b.query)).slice(0, top) };
  }
  /**
   * Stores a draft's step durations once (seconds), with the screens shown and the decisions made from landing to Launch when the page
   * sent them (the owner's "three decisions" before / after, 2026-10-10); returns the durations, or null when nothing valid was sent.
   */
  putTimings(mint: string, raw: unknown, now = Date.now()): Partial<Record<Step, number>> | null {
    const d = stepDurations(raw, now);
    const f = flowCounts(raw);
    if (!d && !f) return null;
    this.db.prepare("INSERT OR IGNORE INTO launch_timings (mint, created_at, steps_json) VALUES (?,?,?)").run(mint, now, JSON.stringify({ ...(d ?? {}), ...(f ?? {}) }));
    return d ?? {};
  }
  timings(mint: string): Partial<Record<Step, number>> | null { const r = this.db.prepare("SELECT steps_json FROM launch_timings WHERE mint=?").get(mint) as { steps_json: string } | undefined; if (!r) return null; const { screens: _s, decisions: _d, ...steps } = JSON.parse(r.steps_json) as Record<string, number>; return steps; }
  /** The screens shown and decisions made for a draft, when the page sent them. */
  flow(mint: string): { screens: number; decisions: number } | null { const r = this.db.prepare("SELECT steps_json FROM launch_timings WHERE mint=?").get(mint) as { steps_json: string } | undefined; if (!r) return null; const j = JSON.parse(r.steps_json) as Record<string, number>; return typeof j.screens === "number" && typeof j.decisions === "number" ? { screens: j.screens, decisions: j.decisions } : null; }
  timingSummary(sinceMs: number): { since: string; drafts: number; steps: { step: Step; label: string; n: number; p50Sec: number | null; p90Sec: number | null }[]; total: { n: number; p50Sec: number | null; p90Sec: number | null }; flow: { n: number; screensP50: number | null; screensP90: number | null; decisionsP50: number | null; decisionsP90: number | null } } {
    const rows = (this.db.prepare("SELECT steps_json FROM launch_timings WHERE created_at >= ?").all(sinceMs) as { steps_json: string }[]).map((r) => JSON.parse(r.steps_json) as Partial<Record<Step, number>>);
    const steps = STEPS.slice(1).map((s) => { const xs = rows.map((r) => r[s]).filter((x): x is number => typeof x === "number"); return { step: s, label: STEP_LABEL[s], n: xs.length, p50Sec: pct(xs, 50), p90Sec: pct(xs, 90) }; });
    const totals = rows.map((r) => STEPS.slice(1).reduce((a, s) => a + (r[s] ?? 0), 0)).filter((x) => x > 0);
    const fl = rows.map((r) => r as unknown as Record<string, number>).filter((r) => typeof r.screens === "number" && typeof r.decisions === "number");
    const sc = fl.map((r) => r.screens), dc = fl.map((r) => r.decisions);
    return { since: new Date(sinceMs).toISOString(), drafts: rows.length, steps, total: { n: totals.length, p50Sec: pct(totals, 50), p90Sec: pct(totals, 90) }, flow: { n: fl.length, screensP50: pct(sc, 50), screensP90: pct(sc, 90), decisionsP50: pct(dc, 50), decisionsP90: pct(dc, 90) } };
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

/** The page's flow counts (screens shown, decisions made), each a whole number 1–50; null when absent or out of range. */
export function flowCounts(raw: unknown): { screens: number; decisions: number } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const t = raw as Record<string, unknown>, sc = Number(t.screens), dc = Number(t.decisions);
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= 50;
  return ok(sc) && ok(dc) ? { screens: sc, decisions: dc } : null;
}

const stores = new WeakMap<DatabaseSync, ProductStore>();
export function productStore(db: DatabaseSync): ProductStore {
  let s = stores.get(db);
  if (!s) { s = new ProductStore(db); stores.set(db, s); }
  return s;
}
