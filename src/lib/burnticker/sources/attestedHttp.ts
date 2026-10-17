import type { BurnRule, Direction } from "@/lib/burnticker/rules";
import { canonicalDecimal, numToDec, type CarryPolicy, type SettledEvent } from "@/lib/burnticker/units";
import type { FetchLike, ImpliedChance, ResolvedSelector, SeriesSummary } from "@/lib/burnticker/oracle/types";
import type { FactSpec, ResolutionSource, Tier } from "@/lib/burnticker/sources/types";
import { sourceForUrl, takeOrThrow } from "@/lib/burnticker/apiBudget";

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
  /** sources-3: more row conditions, all of which must hold (a regex, or `min`: the field read as a number is at least min). */
  filters?: RowCond[];
  /** sources-3: headerless CSV (the NHC best-track files): the column names, in order. */
  columns?: string[];
  /** sources-3: a named row reader for a body the generic selection cannot read (sources/hazardRows.ts, e.g. "hans.van"). */
  custom?: string;
}
/** One row condition: a regex over the field, or a numeric floor (`min`). */
export interface RowCond { path: string; regex?: string; min?: number; negate?: boolean }

export interface PeriodSpec { path: string; format: "yyyy-mm-dd" | "iso" | "epoch-ms" | "epoch-s" | "yyyymmddhh" | "bls" | "jpl-cd" | "yyyy-mm" | "none" }
export interface WeightRule { when: { path: string; regex: string }[]; weight: number }

/**
 * FAN-OUT READS (sources-3, 2026-10-12): one reading built from several files of one publisher.
 *   days    the URL names one report day ({yymmdd:day}); the days `skip` to `skip + back - 1` before today are fetched, and each file's
 *           rows belong to its own day (SPC's daily tornado report files). Every fetched day gets a reading, 0 when its file has no rows.
 *   index   a directory page lists the files; the links matching `link` (URL templates expanded) are fetched, at most `max` (the NHC best-
 *           track directory). More matches than `max` refuses the read: a partial season is never counted.
 * Any file that fails fails the whole read, so the keeper writes nothing (unavailable, never a smaller count).
 */
export type FanOut = { kind: "days"; back: number; skip?: number } | { kind: "index"; url: string; link: string; max: number };
/** The body a fan-out read returns: one part per file (the index page itself is the part keyed "index"). */
export interface FanOutBody { __parts: { key?: string; day?: string; body: unknown }[] }

export interface HttpSourceConfig {
  id: string; kind: "attested-http"; tier: Tier; title: string; sourceName: string; sourceUrl: string; cadence: string; pollEverySec: number;
  request: { url: string; method?: "GET" | "POST"; body?: string; headers?: Record<string, string>; format: "json" | "csv" | "text"; fanOut?: FanOut };
  select: SelectRows & {
    /** Scalar series: the row's value field (or CSV column). */
    value?: { path: string; scale?: number };
    /** Count series: each row counts `weight` (first matching rule, else `default`) into its period. `distinct` (sources-3): a path
     *  whose value is a key (a storm number); each key counts once, in its earliest qualifying period. */
    count?: { rules?: WeightRule[]; default: number; distinct?: string };
    /** Text pages: a regex with named groups `period` and `value` (tier 5). */
    regex?: { pattern: string; flags?: string };
    /** A single number (GitHub stars, Steam players, TVL, a block height): the reading is "today's value" at poll time. */
    snapshot?: {
      path: string;
      /**
       * COUNT THE ROWS, ONE BY ONE (owner decision 2026-10-12, website-20 item 107: openFDA matches a search's conditions across
       * different submissions of one application, so its total counted applications with a recent SUPPLEMENT approval). When set, the
       * snapshot is the number of rows under `rows` having at least one element under `any` that matches every `when` condition and, with
       * `withinDays`, whose `withinDays.path` date (YYYYMMDD) falls in the last `days` days. Each row counts once, whatever else it lists.
       * The publisher's total at `path` must equal the rows read (one page); otherwise the read is refused, never undercounted.
       */
      countRows?: { rows: string; any: string; when: { path: string; regex: string }[]; withinDays?: { path: string; days: number } };
    };
    /**
     * A ONE-SHOT MILESTONE (sources-2, 2026-10-12: "burns when <repo> passes N stars"): the number at `path` is read at poll time and,
     * once it is at or above `at` (the series parameter's N, set by the catalogue), the source gives ONE reading with the fixed id
     * `reached-<N>` and value 1; below it, no reading at all. The id never changes, so the keeper's receipt for it is the only one
     * (the rule then ends). `guard` refuses the read when another number in the body is under a bar (a channel too small to count as
     * a public channel); a refusal is never a reading.
     */
    milestone?: { path: string; at?: number; guard?: { path: string; min: number; why: string } };
    /**
     * A ONE-SHOT ON THE NEXT EVENT (sources-3, 2026-10-12: "burns once on the next M7.0 or greater"): after counting, only periods whose
     * count is at least `atLeast` are kept, each with the value 1, and periods below it give no reading at all (never a 0, which would
     * end the coin). The keeper plans only periods after the coin's launch and ends a one-shot on its first receipt, so the coin burns
     * once, on the first qualifying period after launch.
     */
    oneShot?: { atLeast: number };
    /**
     * A RECORD (sources-4, 2026-10-12: "burns every time it sets a new high"): after the value series is read (complete days only), each
     * day becomes 1 when its value is above every earlier value in the body (`span` "all": the publisher's whole history, which the body
     * carries) or above each value of the previous `span` days, and 0 otherwise. Days without a full comparison window give no reading.
     * `once`: only the 1s are kept (the keeper ends a one-shot on its first receipt after launch). The baseline is the publisher's own
     * history, re-read in full on every poll; a day already recorded is never re-read by the keeper.
     */
    record?: { span: "all" | number; once?: boolean };
  };
  /**
   * `endsOn` (sources-3): the last day a one-shot can qualify (a hurricane season's November 30). Periods after it are not read; once it
   * is complete, the source gives one more reading, id `ended-<day>` with the value 0, so a one-shot with no event in time ends with
   * nothing burned through the keeper's ordinary end path. `zeroFillFromDays`: a count series seeds its first period that many days back,
   * so a window with no rows at all still reads 0 per day (the volcano notices).
   */
  period: PeriodSpec & { kind: "day" | "month" | "week" | "quarter"; dropFirst?: boolean; completeAfterDays?: number; zeroFill?: boolean; endsOn?: string; zeroFillFromDays?: number };
  unit: { size: number; label: string; definition: string }; direction: Direction; baseline: "previousSettlement" | number; carry: CarryPolicy; valueLabel: string;
  plausibility: { min: number; max: number; maxAbsDelta?: number };
  memoSource: string; fixture: string | null; flags: string[]; needsKey?: string | null; launchable: boolean; note?: string;
  /**
   * The environment variable that holds the key a `needsKey` source needs (sources-2: BURNTICKER_YOUTUBE_API_KEY). The URL names it as
   * `{key}`; fetchBody substitutes it at request time and never stores or logs it. Unset: the read fails as unavailable, never a result.
   */
  keyEnv?: string;
  /** An optional token for a keyless source's higher rate limit (GitHub: 60 an hour keyless); sent as `Authorization: Bearer` when set. */
  tokenEnv?: string;
  /** The publisher's terms, read before the source was added (sources-2): the page, the date it was read, one paragraph, the verdict. */
  terms?: SourceTerms;
  /** Who runs the endpoint (the independence test of the settlement-coverage audit compares operators and domains). */
  operator?: string;
  /** The fact this source reads; sources sharing it are cross-reads of each other (sources/types.ts FactSpec). */
  fact?: FactSpec;
  /** The owner's single-publisher exception (singleSource.ts): honoured only for the ids listed there. */
  settlement?: "single-official-source";
}

/** A terms read: where, when, what it says for this use, and whether settling a coin on it is allowed. */
export interface SourceTerms { url: string; readAt: string; read: string; verdict: "allowed" | "allowed-with-limits" | "not-allowed" }

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
const holds = (row: Record<string, unknown>, c: RowCond): boolean => {
  const v = jsonOne(row, c.path);
  const ok = c.min !== undefined ? (v !== undefined && v !== null && String(v).trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= c.min) : new RegExp(c.regex ?? "").test(String(v ?? ""));
  return ok !== !!c.negate;
};

/** Headerless CSV rows keyed by the configured column names (cells trimmed). */
export function parseCsvColumns(text: string, columns: readonly string[]): Record<string, string>[] {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => { const cells = l.split(","); return Object.fromEntries(columns.map((h, i) => [h, (cells[i] ?? "").trim()])); });
}

/**
 * NAMED ROW READERS (sources-3): a body the generic selection cannot read becomes plain rows here. `refusal` refuses the whole read
 * (nothing is counted). Registered by the source modules at import (sources/hazardRows.ts), so this file keeps no source knowledge.
 */
export type CustomRows = (body: unknown) => { rows: Record<string, unknown>[]; refusal: string | null };
export const CUSTOM_ROWS: Record<string, CustomRows> = {};

const isFanOut = (b: unknown): b is FanOutBody => !!b && typeof b === "object" && Array.isArray((b as FanOutBody).__parts);

/** One body → its rows (CSV with a header, headerless CSV, a JSON path, or a named reader); null refuses the whole read. */
function rowsOf(cfg: HttpSourceConfig, body: unknown, refusals: string[]): Record<string, unknown>[] | null {
  const S = cfg.select;
  if (S.custom) {
    const f = CUSTOM_ROWS[S.custom];
    if (!f) { refusals.push(`schema: no row reader named ${S.custom}`); return null; }
    const r = f(body);
    if (r.refusal) { refusals.push(r.refusal); return null; }
    return r.rows;
  }
  if (cfg.request.format === "csv" || (cfg.request.format === "text" && S.columns)) return S.columns ? parseCsvColumns(String(body), S.columns) : parseCsv(String(body));
  const found = jsonPath(body, S.rows);
  // "$" (or any path) landing on ONE array fans out to its elements (NOAA's body is the array itself).
  const raw = found.length === 1 && Array.isArray(found[0]) ? (found[0] as unknown[]) : found;
  if (S.columnsFrom) {
    const cols = jsonOne(body, S.columnsFrom);
    if (!Array.isArray(cols)) { refusals.push(`schema: no columns at ${S.columnsFrom}`); return null; }
    return raw.map((r) => (Array.isArray(r) ? Object.fromEntries((cols as string[]).map((c, i) => [c, r[i]])) : {}));
  }
  if (!raw.length && S.rows !== "$") refusals.push(`schema: no rows at ${S.rows}`);
  return raw.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
}

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
  if (S.snapshot?.countRows) {
    const C = S.snapshot.countRows;
    const rows = jsonPath(body, C.rows).filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
    const total = Number(jsonOne(body, S.snapshot.path));
    if (!Number.isFinite(total)) return { readings: [], refusals: [`schema: snapshot ${S.snapshot.path} is not a number`] };
    if (total !== rows.length) return { readings: [], refusals: [`schema: the publisher lists ${total} records and ${rows.length} were read in one page, so the count cannot be complete`] };
    const from = C.withinDays ? addDays(today, -C.withinDays.days).replace(/-/g, "") : null, to = today.replace(/-/g, "");
    const n = rows.filter((r) => jsonPath(r, C.any).some((el) => {
      const e = el as Record<string, unknown>;
      if (!e || typeof e !== "object" || !C.when.every((c) => matches(e, c))) return false;
      if (!C.withinDays) return true;
      const d = String(jsonOne(e, C.withinDays.path) ?? "");
      return /^\d{8}$/.test(d) && d >= from! && d <= to;
    })).length;
    if (n < cfg.plausibility.min || n > cfg.plausibility.max) return { readings: [], refusals: [`level: ${n} is outside ${cfg.plausibility.min}–${cfg.plausibility.max}`] };
    return { readings: [mk(P.kind === "month" ? today.slice(0, 7) : today, String(n))], refusals };
  }
  if (S.snapshot) {
    const raw = cfg.request.format === "text" ? String(body).trim() : jsonOne(body, S.snapshot.path);
    const n = Number(raw);
    if (!Number.isFinite(n)) return { readings: [], refusals: [`schema: snapshot ${S.snapshot.path} is not a number (${String(raw).slice(0, 40)})`] };
    if (n < cfg.plausibility.min || n > cfg.plausibility.max) return { readings: [], refusals: [`level: ${n} is outside ${cfg.plausibility.min}–${cfg.plausibility.max}`] };
    const period = P.kind === "month" ? today.slice(0, 7) : today;
    return { readings: [mk(period, canonicalDecimal(numToDec(n)))], refusals };
  }
  // MILESTONE: one reading, ever, once the number reaches N (the id is fixed, so a later poll repeats the same reading).
  if (S.milestone) {
    const raw = jsonOne(body, S.milestone.path), n = Number(raw);
    if (raw === undefined || raw === null || raw === "" || !Number.isFinite(n)) return { readings: [], refusals: [`schema: milestone ${S.milestone.path} is not a number (${String(raw).slice(0, 40)})`] };
    if (n < cfg.plausibility.min || n > cfg.plausibility.max) return { readings: [], refusals: [`level: ${n} is outside ${cfg.plausibility.min}–${cfg.plausibility.max}`] };
    const g = S.milestone.guard;
    if (g) { const gv = Number(jsonOne(body, g.path)); if (!Number.isFinite(gv) || gv < g.min) return { readings: [], refusals: [`guard: ${g.why} (${g.path} is ${Number.isFinite(gv) ? gv : "not given"})`] }; }
    const at = S.milestone.at;
    if (at === undefined || !(at > 0)) return { readings: [], refusals: ["schema: the milestone has no N (the series parameter names it)"] };
    return { readings: n >= at ? [{ id: `reached-${at}`, at: today, result: null, value: "1", title: `${cfg.title}: ${n} read on ${today}, at or above ${at}`, sourceUrl }] : [], refusals };
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
  // ROWS (a fan-out read: every part's rows, each tagged with its report day as `__day` when the part has one).
  let rows: Record<string, unknown>[] = [];
  const seeds: string[] = [];
  if (isFanOut(body)) {
    for (const part of body.__parts) {
      if (part.key === "index") continue;
      const rs = rowsOf(cfg, part.body, refusals);
      if (rs === null) return { readings: [], refusals };
      if (part.day) { seeds.push(part.day); for (const r of rs) r.__day = part.day; }
      rows.push(...rs);
    }
  } else {
    const rs = rowsOf(cfg, body, refusals);
    if (rs === null) return { readings: [], refusals };
    rows = rs;
  }
  if (S.filter) rows = rows.filter((r) => matches(r, S.filter!) !== !!S.filter!.negate);
  if (S.filters) rows = rows.filter((r) => S.filters!.every((c) => holds(r, c)));
  const byPeriod = new Map<string, number>();
  const values = new Map<string, string>();
  let minPeriod: string | null = null;
  for (const d of seeds) if (minPeriod === null || d < minPeriod) minPeriod = d;
  if (P.zeroFillFromDays !== undefined && P.kind === "day") { const d = addDays(today, -P.zeroFillFromDays); if (minPeriod === null || d < minPeriod) minPeriod = d; }
  // count.distinct: each key (a storm) counts once, in the earliest period any of its qualifying rows falls in
  const firstOf = new Map<string, { period: string; row: Record<string, unknown> }>();
  for (const r of rows) {
    const period = toPeriod(jsonOne(r, P.path), P, P.kind, r);
    if (!period) { refusals.push(`schema: a row without a readable period at ${P.path}`); continue; }
    if (minPeriod === null) minPeriod = period; else if (period < minPeriod) minPeriod = period;
    if (S.count?.distinct) {
      const key = String(jsonOne(r, S.count.distinct) ?? "");
      const had = firstOf.get(key);
      if (!had || period < had.period) firstOf.set(key, { period, row: r });
      continue;
    }
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
  if (S.count?.distinct) for (const { period, row } of firstOf.values()) {
    const w = S.count.rules?.find((rule) => rule.when.every((c) => matches(row, c)))?.weight ?? S.count.default;
    byPeriod.set(period, (byPeriod.get(period) ?? 0) + w);
  }
  let readings: SettledEvent[] = [];
  if (S.count) {
    if (minPeriod !== null && lastDay !== null) {
      const first = P.dropFirst ? addDays(minPeriod, 1) : minPeriod;
      if (P.zeroFill !== false) for (let d = first; d <= lastDay; d = addDays(d, 1)) readings.push(mk(d, String(byPeriod.get(d) ?? 0)));
      else readings = [...byPeriod].filter(([p]) => p >= first && complete(p)).sort().map(([p, v]) => mk(p, String(v)));
    } else readings = [...byPeriod].filter(([p]) => complete(p)).sort().map(([p, v]) => mk(p, String(v)));
  } else readings = [...values].filter(([p]) => complete(p)).sort().map(([p, v]) => mk(p, v));
  if (S.oneShot) readings = readings.filter((r) => Number(r.value) >= S.oneShot!.atLeast).map((r) => ({ ...r, value: "1" }));
  if (S.record) readings = recordReadings(readings, S.record, cfg.title);
  if (P.endsOn) {
    readings = readings.filter((r) => r.id <= P.endsOn!);
    if (lastComplete !== null && P.endsOn <= lastComplete) readings.push({ id: `ended-${P.endsOn}`, at: P.endsOn, result: null, value: "0", title: `${cfg.title}: the window ended on ${P.endsOn}`, sourceUrl });
  }
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

/**
 * A value series (oldest first, one per complete day) → record readings: 1 for a day above every earlier value (span "all") or above each
 * value of the previous `span` days, 0 otherwise; the first day, and any day without `span` earlier days, gives no reading. `once` keeps
 * the 1s only. Each reading's title names the value and the record it was compared with. Pure.
 */
export function recordReadings(readings: readonly SettledEvent[], rec: { span: "all" | number; once?: boolean }, title: string): SettledEvent[] {
  const xs = [...readings].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out: SettledEvent[] = [];
  for (let i = 0; i < xs.length; i++) {
    const from = rec.span === "all" ? null : addDays(xs[i].id, -rec.span);
    const prev = xs.slice(0, i).filter((p) => from === null || p.id >= from);
    if (!prev.length || (rec.span !== "all" && (prev[0].id !== from || prev.length < rec.span))) continue;
    let best = prev[0];
    for (const p of prev) if (Number(p.value) > Number(best.value)) best = p;
    const isRecord = Number(xs[i].value) > Number(best.value);
    if (rec.once && !isRecord) continue;
    out.push({ ...xs[i], value: isRecord ? "1" : "0", title: `${title}: ${xs[i].id} read ${xs[i].value}, ${isRecord ? "a record" : "not a record"} (the record before it was ${best.value} on ${best.id})` });
  }
  return out;
}

/** URL (and POST body) templates: {today}, {from:N} (N days back), {yyyymmdd:today}, {yyyymmdd:from:N}; sources-3: {yyyy} (this UTC
 *  year), {unix:from:N} (the UTC midnight N days back, in seconds). */
export function expandUrl(tpl: string, nowMs: number): string {
  const today = isoDay(nowMs);
  return tpl.replace(/\{yyyy\}/g, today.slice(0, 4)).replace(/\{unix:from:(\d+)\}/g, (_m, n) => String(Date.parse(`${addDays(today, -Number(n))}T00:00:00Z`) / 1000)).replace(/\{yyyymmdd:today\}/g, today.replace(/-/g, "")).replace(/\{yyyymmdd:from:(\d+)\}/g, (_m, n) => addDays(today, -Number(n)).replace(/-/g, "")).replace(/\{today\}/g, today).replace(/\{from:(\d+)\}/g, (_m, n) => addDays(today, -Number(n)));
}

/** The key a keyed source reads from its `keyEnv` (trimmed), or null. */
export const sourceKey = (cfg: Pick<HttpSourceConfig, "keyEnv">, env: Readonly<Record<string, string | undefined>> = process.env): string | null => (cfg.keyEnv ? (env[cfg.keyEnv] ?? "").trim() || null : null);

export async function fetchBody(cfg: HttpSourceConfig, nowMs: number, fetchImpl: FetchLike, timeoutMs = 20_000, env: Readonly<Record<string, string | undefined>> = process.env): Promise<unknown> {
  // UNAVAILABLE, NEVER A RESULT: a keyed source without its key throws here, so the keeper records a failed fetch and writes no reading.
  const key = sourceKey(cfg, env);
  if (cfg.needsKey && !key) throw new Error(`${cfg.id}: unavailable: needs a key (${cfg.needsKey}) that is not configured`);
  const token = cfg.tokenEnv ? (env[cfg.tokenEnv] ?? "").trim() : "";
  const one = async (u: string, format: HttpSourceConfig["request"]["format"], post: boolean): Promise<unknown> => {
    const url = expandUrl(u, nowMs).split("{key}").join(encodeURIComponent(key ?? ""));
    await takeOrThrow(sourceForUrl(url));   // the request budget (apiBudget.ts), by host, before the timeout starts
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: ac.signal, headers: { accept: format === "json" ? "application/json" : "*/*", "user-agent": "burnticker/0.1 (event-indexed burn receipts; polite polling)", ...(cfg.request.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(post ? { method: "POST", body: cfg.request.body === undefined ? undefined : expandUrl(cfg.request.body, nowMs) } : {}) } as never);
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${cfg.sourceName}`);
      if (format === "json") return await res.json();
      return res.text ? await res.text() : String(await res.json());
    } finally { clearTimeout(t); }
  };
  const post = cfg.request.method === "POST";
  const f = cfg.request.fanOut;
  if (!f) return one(cfg.request.url, cfg.request.format, post);
  const parts: FanOutBody["__parts"] = [];
  if (f.kind === "days") {
    const today = isoDay(nowMs);
    for (let i = f.skip ?? 0; i < (f.skip ?? 0) + f.back; i++) {
      const day = addDays(today, -i);
      parts.push({ day, body: await one(cfg.request.url.split("{yymmdd:day}").join(day.slice(2).replace(/-/g, "")), cfg.request.format, post) });
    }
    return { __parts: parts };
  }
  const index = String(await one(f.url, "text", false));
  const names = [...new Set([...index.matchAll(new RegExp(expandUrl(f.link, nowMs), "g"))].map((m) => m[0]))].sort();
  if (names.length > f.max) throw new Error(`${cfg.id}: unavailable: the index lists ${names.length} files, more than the ${f.max} a read takes`);
  parts.push({ key: "index", body: names.join("\n") });
  for (const n of names) parts.push({ key: n, body: await one(cfg.request.url.split("{file}").join(n), cfg.request.format, post) });
  return { __parts: parts };
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
