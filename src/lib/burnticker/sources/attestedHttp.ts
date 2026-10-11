import type { BurnRule, Direction } from "@/lib/burnticker/rules";
import { canonicalDecimal, numToDec, type CarryPolicy, type SettledEvent } from "@/lib/burnticker/units";
import type { FetchLike, ImpliedChance, ResolvedSelector, SeriesSummary } from "@/lib/burnticker/oracle/types";
import type { FactSpec, ResolutionSource, Tier } from "@/lib/burnticker/sources/types";

/**
 * THE GENERIC ATTESTED-HTTP ADAPTER (2026-10-09): a feed is a CONFIG ENTRY (config/burnticker/sources.json), not a class. The entry
 * says where to fetch, how to select rows from the body (a JSON path, a CSV, or a regex over text), which field is the period and which
 * the value — or that each row is a COUNT of 1 (weighted by a rule table) summed per period — and the arithmetic the unit engine runs
 * (unit, direction, baseline, carry, plausibility). The same URL + path is what a Switchboard On-Demand job (tier 3) would attest later;
 * our keeper reads it today (tier 4); a page-scraped regex is tier 5.
 *
 * Pure apart from `fetch`, which takes an injectable fetchImpl. Every reading is a complete period only (a day that is over, a month
 * that was published), so a re-read never changes a value it already gave.
 */

export interface SelectRows {
  /** JSON path to the array of rows ("$.data[*]", "features[*]", "Results.series[0].data[*]") — or "$" when the body itself is one row. */
  rows: string;
  /** Column names for array-shaped rows (JPL: `fields`); then `path`s below are column names. */
  columnsFrom?: string;
  /** Keep rows whose field matches (BLS "-" months out, ESPN finished games only …). */
  filter?: { path: string; regex: string; negate?: boolean };
}

export interface PeriodSpec { path: string; format: "yyyy-mm-dd" | "iso" | "epoch-ms" | "epoch-s" | "yyyymmddhh" | "bls" | "jpl-cd" | "yyyy-mm" | "none" }
export interface WeightRule { when: { path: string; regex: string }[]; weight: number }

export interface HttpSourceConfig {
  id: string; kind: "attested-http"; tier: Tier; title: string; sourceName: string; sourceUrl: string; cadence: string; pollEverySec: number;
  request: { url: string; method?: "GET" | "POST"; body?: string; headers?: Record<string, string>; format: "json" | "csv" | "text" };
  select: SelectRows & {
    /** Scalar series: the row's value field (or CSV column). */
    value?: { path: string; scale?: number };
    /** Count series: each row counts `weight` (first matching rule, else `default`) into its period. */
    count?: { rules?: WeightRule[]; default: number };
    /** Text pages: a regex with named groups `period` and `value` (tier 5). */
    regex?: { pattern: string; flags?: string };
    /** A single number (GitHub stars, Steam players, TVL, a block height): the reading is "today's value" at poll time. */
    snapshot?: { path: string };
  };
  period: PeriodSpec & { kind: "day" | "month" | "week" | "quarter"; dropFirst?: boolean; completeAfterDays?: number; zeroFill?: boolean };
  unit: { size: number; label: string; definition: string }; direction: Direction; baseline: "previousSettlement" | number; carry: CarryPolicy; valueLabel: string;
  plausibility: { min: number; max: number; maxAbsDelta?: number };
  memoSource: string; fixture: string | null; flags: string[]; needsKey?: string | null; launchable: boolean; note?: string;
  /** Who runs the endpoint (the independence test of the settlement-coverage audit compares operators and domains). */
  operator?: string;
  /** The fact this source reads; sources sharing it are cross-reads of each other (sources/types.ts FactSpec). */
  fact?: FactSpec;
}

// ---- selection primitives ----

/** A small JSON path: "$.a.b[0].c", "a.b[*]", "[*]", "$" . `[*]` fans out. Returns the list of matches. */
export function jsonPath(root: unknown, path: string): unknown[] {
  const p = path.trim().replace(/^\$\.?/, "");
  if (p === "" ) return [root];
  const tokens = p.match(/[^.[\]]+|\[\*\]|\[\d+\]/g) ?? [];
  let cur: unknown[] = [root];
  for (const t of tokens) {
    const next: unknown[] = [];
    for (const c of cur) {
      if (c === null || c === undefined) continue;
      if (t === "[*]") { if (Array.isArray(c)) next.push(...c); continue; }
      const ix = /^\[(\d+)\]$/.exec(t);
      if (ix) { if (Array.isArray(c)) next.push(c[Number(ix[1])]); continue; }
      if (typeof c === "object") next.push((c as Record<string, unknown>)[t]);
    }
    cur = next;
  }
  return cur.filter((x) => x !== undefined);
}
export const jsonOne = (root: unknown, path: string): unknown => jsonPath(root, path)[0];

/** CSV → rows as objects keyed by the header (FRED's fredgraph.csv). */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((s) => s.trim());
  return lines.slice(1).map((l) => { const cells = l.split(","); return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? "").trim()])); });
}

const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A row's field → the canonical period string for the period kind (day "2026-10-08", month "2026-08", week "2026-W41", quarter "2026-Q3"). */
export function toPeriod(v: unknown, spec: PeriodSpec, kind: HttpSourceConfig["period"]["kind"], row?: Record<string, unknown>): string | null {
  let day: string | null = null;
  const s = String(v ?? "").trim();
  switch (spec.format) {
    case "yyyy-mm-dd": day = /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; break;
    case "yyyy-mm": return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : null;
    case "iso": { const ms = Date.parse(s); day = Number.isNaN(ms) ? null : isoDay(ms); break; }
    case "epoch-ms": day = Number.isFinite(Number(v)) ? isoDay(Number(v)) : null; break;
    case "epoch-s": day = Number.isFinite(Number(v)) ? isoDay(Number(v) * 1000) : null; break;
    case "yyyymmddhh": { const m = /^(\d{4})(\d{2})(\d{2})/.exec(s); day = m ? `${m[1]}-${m[2]}-${m[3]}` : null; break; }
    case "bls": { const m = /^M(0[1-9]|1[0-2])$/.exec(s); return m && row && /^\d{4}$/.test(String(row.year)) ? `${row.year}-${m[1]}` : null; }
    case "jpl-cd": { const m = /^(\d{4})-([A-Z][a-z]{2})-(\d{2})\b/.exec(s); day = m && MONTHS[m[2]] ? `${m[1]}-${MONTHS[m[2]]}-${m[3]}` : null; break; }
    case "none": return null;
  }
  if (!day) return null;
  if (kind === "day") return day;
  if (kind === "month") return day.slice(0, 7);
  if (kind === "quarter") return `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
  // ISO week
  const d = new Date(Date.parse(`${day}T00:00:00Z`)); const dayNum = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86_400_000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The canonical `at` for a period (ordering key; feeds' events use the period itself). */
export const periodAt = (p: string): string => p;

const matches = (row: Record<string, unknown>, cond: { path: string; regex: string }): boolean => new RegExp(cond.regex).test(String(jsonOne(row, cond.path) ?? ""));

/** Rows → readings, oldest first, plus refusals. Pure. `nowMs` decides which periods are complete. */
export function parseBody(cfg: HttpSourceConfig, body: unknown, nowMs: number): { readings: SettledEvent[]; refusals: string[] } {
  const refusals: string[] = [];
  const S = cfg.select, P = cfg.period;
  const sourceUrl = cfg.sourceUrl;
  const mk = (period: string, value: string): SettledEvent => ({ id: period, at: periodAt(period), result: null, value, title: `${cfg.title}: ${period}`, sourceUrl });
  const today = isoDay(nowMs);
  const lastDay: string | null = P.kind === "day" ? addDays(today, -(P.completeAfterDays ?? 1)) : null;
  const lastComplete: string | null = lastDay ?? (P.kind === "month" ? addDays(today, -(P.completeAfterDays ?? 1)).slice(0, 7) : null);
  const complete = (period: string): boolean => (lastComplete === null ? true : period <= lastComplete);
  // SNAPSHOT: one number at poll time → today's reading (the day's value is the latest poll; the keeper records it once the day closes).
  if (S.snapshot) {
    const raw = cfg.request.format === "text" ? String(body).trim() : jsonOne(body, S.snapshot.path);
    const n = Number(raw);
    if (!Number.isFinite(n)) return { readings: [], refusals: [`schema: snapshot ${S.snapshot.path} is not a number (${String(raw).slice(0, 40)})`] };
    if (n < cfg.plausibility.min || n > cfg.plausibility.max) return { readings: [], refusals: [`level: ${n} is outside ${cfg.plausibility.min}–${cfg.plausibility.max}`] };
    const period = P.kind === "month" ? today.slice(0, 7) : today;
    return { readings: [mk(period, canonicalDecimal(numToDec(n)))], refusals };
  }
  // REGEX over text (tier 5 pages): named groups period/value, one or many matches.
  if (S.regex) {
    const flags = S.regex.flags ?? "g";
    const re = new RegExp(S.regex.pattern, flags.includes("g") ? flags : `${flags}g`);
    const text = String(body);
    const out = new Map<string, string>();
    for (const m of text.matchAll(re)) {
      const period = m.groups?.period ? toPeriod(m.groups.period, P, P.kind) : today;
      const value = m.groups?.value?.replace(/[$,]/g, "");
      if (!period || value === undefined || !/^-?\d+(\.\d+)?$/.test(value)) { refusals.push(`schema: a match without a readable period/value`); continue; }
      out.set(period, canonicalDecimal(value));
    }
    return { readings: [...out].filter(([p]) => complete(p)).sort().map(([p, v]) => mk(p, v)), refusals };
  }
  // ROWS.
  let rows: Record<string, unknown>[];
  if (cfg.request.format === "csv") rows = parseCsv(String(body));
  else {
    const found = jsonPath(body, S.rows);
    // "$" (or any path) landing on ONE array fans out to its elements (NOAA's body is the array itself).
    const raw = found.length === 1 && Array.isArray(found[0]) ? (found[0] as unknown[]) : found;
    if (S.columnsFrom) {
      const cols = jsonOne(body, S.columnsFrom);
      if (!Array.isArray(cols)) return { readings: [], refusals: [`schema: no columns at ${S.columnsFrom}`] };
      rows = raw.map((r) => (Array.isArray(r) ? Object.fromEntries((cols as string[]).map((c, i) => [c, r[i]])) : {}));
    } else rows = raw.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
    if (!raw.length && S.rows !== "$") refusals.push(`schema: no rows at ${S.rows}`);
  }
  if (S.filter) rows = rows.filter((r) => matches(r, S.filter!) !== !!S.filter!.negate);
  const byPeriod = new Map<string, number>();
  const values = new Map<string, string>();
  let minPeriod: string | null = null;
  for (const r of rows) {
    const period = toPeriod(jsonOne(r, P.path), P, P.kind, r);
    if (!period) { refusals.push(`schema: a row without a readable period at ${P.path}`); continue; }
    if (minPeriod === null) minPeriod = period; else if (period < minPeriod) minPeriod = period;
    if (S.count) {
      const w = S.count.rules?.find((rule) => rule.when.every((c) => matches(r, c)))?.weight ?? S.count.default;
      byPeriod.set(period, (byPeriod.get(period) ?? 0) + w);
    } else if (S.value) {
      const raw = String(jsonOne(r, S.value.path) ?? "").trim();
      if (!/^-?\d+(\.\d+)?$/.test(raw)) { refusals.push(`schema: ${period} value ${JSON.stringify(raw).slice(0, 30)} is not a number`); continue; }
      const v = S.value.scale ? Number(raw) * S.value.scale : null;
      values.set(period, v === null ? canonicalDecimal(raw) : canonicalDecimal(numToDec(v)));
    }
  }
  let readings: SettledEvent[] = [];
  if (S.count) {
    if (minPeriod !== null && lastDay !== null) {
      const first = P.dropFirst ? addDays(minPeriod, 1) : minPeriod;
      if (P.zeroFill !== false) for (let d = first; d <= lastDay; d = addDays(d, 1)) readings.push(mk(d, String(byPeriod.get(d) ?? 0)));
      else readings = [...byPeriod].filter(([p]) => p >= first && complete(p)).sort().map(([p, v]) => mk(p, String(v)));
    } else readings = [...byPeriod].filter(([p]) => complete(p)).sort().map(([p, v]) => mk(p, String(v)));
  } else readings = [...values].filter(([p]) => complete(p)).sort().map(([p, v]) => mk(p, v));
  // Plausibility: a level outside the bounds, or a step beyond maxAbsDelta, is refused and nothing after it is read.
  const out: SettledEvent[] = [];
  for (let i = 0; i < readings.length; i++) {
    const v = Number(readings[i].value);
    if (v < cfg.plausibility.min || v > cfg.plausibility.max) { refusals.push(`level: ${readings[i].id} ${readings[i].value} is outside ${cfg.plausibility.min}–${cfg.plausibility.max} — refused, nothing after it read`); break; }
    if (i > 0 && cfg.plausibility.maxAbsDelta !== undefined && Math.abs(v - Number(readings[i - 1].value)) > cfg.plausibility.maxAbsDelta) { refusals.push(`delta: ${readings[i - 1].id} → ${readings[i].id} moved more than ${cfg.plausibility.maxAbsDelta} — refused, nothing after it read`); break; }
    out.push(readings[i]);
  }
  return { readings: out, refusals };
}

/** URL templates: {today}, {from:N} (N days back), {yyyymmdd:today}, {yyyymmdd:from:N}. */
export function expandUrl(tpl: string, nowMs: number): string {
  const today = isoDay(nowMs);
  return tpl.replace(/\{yyyymmdd:today\}/g, today.replace(/-/g, "")).replace(/\{yyyymmdd:from:(\d+)\}/g, (_m, n) => addDays(today, -Number(n)).replace(/-/g, "")).replace(/\{today\}/g, today).replace(/\{from:(\d+)\}/g, (_m, n) => addDays(today, -Number(n)));
}

export async function fetchBody(cfg: HttpSourceConfig, nowMs: number, fetchImpl: FetchLike, timeoutMs = 20_000): Promise<unknown> {
  if (cfg.needsKey) throw new Error(`${cfg.id}: needs a key (${cfg.needsKey}) — not configured`);
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(expandUrl(cfg.request.url, nowMs), { signal: ac.signal, headers: { accept: cfg.request.format === "json" ? "application/json" : "*/*", "user-agent": "burnticker/0.1 (event-indexed burn receipts; polite polling)", ...(cfg.request.headers ?? {}) }, ...(cfg.request.method === "POST" ? { method: "POST", body: cfg.request.body } : {}) } as never);
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${cfg.sourceName}`);
    if (cfg.request.format === "json") return await res.json();
    return res.text ? await res.text() : String(await res.json());
  } finally { clearTimeout(t); }
}

/** A config entry as a ResolutionSource. */
export function httpSource(cfg: HttpSourceConfig, o: { fetchImpl?: FetchLike; now?: () => number } = {}): ResolutionSource & { config: HttpSourceConfig; parse(body: unknown, nowMs: number): { readings: SettledEvent[]; refusals: string[] } } {
  const now = o.now ?? (() => Date.now());
  const summary: SeriesSummary = { oracle: "catalogue", ticker: cfg.id, title: cfg.title, category: `tier ${cfg.tier}`, frequency: cfg.cadence, settlementSource: { name: cfg.sourceName, url: cfg.sourceUrl }, tags: cfg.flags };
  return {
    id: cfg.id, kind: "attested-http", tier: cfg.tier, title: cfg.title, sourceName: cfg.sourceName, sourceUrl: cfg.sourceUrl, cadence: cfg.cadence,
    unit: cfg.unit, direction: cfg.direction, baseline: cfg.baseline, carry: cfg.carry, valueLabel: cfg.valueLabel, flags: cfg.flags,
    launchable: { ok: cfg.launchable && !cfg.needsKey, why: cfg.needsKey ? `needs a key: ${cfg.needsKey}` : cfg.launchable ? null : cfg.note ?? "not launchable" },
    config: cfg,
    parse: (body, nowMs) => parseBody(cfg, body, nowMs),
    async searchSeries() { return [summary]; },
    async seriesInfo() { return summary; },
    async settledSince(rule: BurnRule, sinceIso: string | null): Promise<ResolvedSelector> {
      const n = now();
      const body = await fetchBody(cfg, n, o.fetchImpl ?? (fetch as unknown as FetchLike));
      const { readings, refusals } = parseBody(cfg, body, n);
      void rule;
      return { events: readings.filter((r) => sinceIso === null || r.at > sinceIso), awaitingFinal: 0, refusals, settlementSourceUrl: cfg.sourceUrl };
    },
    async impliedChance(): Promise<ImpliedChance> { return { chance: null, marketTicker: null, closeTime: null, basis: "primary source: there is no market to read" }; },
  };
}
