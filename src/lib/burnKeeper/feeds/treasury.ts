import { centsToUsd, usdToCents } from "@/lib/burnKeeper/rules";
import { sourceForUrl, takeOrThrow } from "@/lib/burnticker/apiBudget";

/**
 * THE $DEBT FEED — U.S. Treasury "Debt to the Penny" (SPEC §1, verified live 2026-10-09). Validation is pure; `fetchDebtToPenny`
 * and `fetchDebtHistory` are the only network calls, and both take an injectable fetch so the keeper's tests never touch the API.
 *
 *   https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny
 *     ?fields=record_date,tot_pub_debt_out_amt&sort=-record_date&page[size]=N
 *
 * Public, no key, JSON, one row per business day, posted the following afternoon ET. `record_date` is the business day the figure
 * describes; `tot_pub_debt_out_amt` is a string with two decimals ("40305316210829.72").
 *
 * WHAT IS REFUSED, AND WHY (the burn is irreversible, so the feed is presumed wrong until it proves otherwise):
 *   · schema: a body without `data[]`, a row without both fields, a date that is not a real YYYY-MM-DD, an amount that is not a
 *     non-negative number with at most two decimals (this is also where NaN / "null" / "" die)
 *   · level: outside $1T–$1,000T (a units bug upstream — thousands vs dollars — would otherwise read as a $40-quadrillion day)
 *   · order: record_date must be STRICTLY increasing once sorted; a duplicate date with two values is a feed we cannot read
 *   · delta: |now − prev| > $2T in one reading (the brief's bound; the largest real day 2025-01→2026-10 was +$366B on 2025-07-07,
 *     the day after the debt-ceiling increase) — refused, not clipped
 * The readings BEFORE the first refused one are kept; nothing after it is (a later row's delta is measured against a value we
 * refused, so it cannot be trusted either). The keeper then holds and retries; it never skips past a refused date.
 */

export const TREASURY_DEBT_URL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny";
export const TREASURY_FIELDS = "record_date,tot_pub_debt_out_amt";

export interface DebtReading {
  recordDate: string;
  /** The exact string Treasury published. */
  amount: string;
  cents: bigint;
}

export interface FeedValidation {
  readings: DebtReading[];
  refusals: string[];
}

export const MIN_LEVEL_CENTS = usdToCents("1000000000000");        // $1T
export const MAX_LEVEL_CENTS = usdToCents("1000000000000000");     // $1,000T
export const DEFAULT_MAX_DELTA_CENTS = usdToCents("2000000000000"); // $2T

/** The latest N rows, newest first (what the keeper polls). */
export function latestUrl(pageSize: number): string {
  return `${TREASURY_DEBT_URL}?fields=${TREASURY_FIELDS}&sort=-record_date&page[size]=${pageSize}`;
}

/** Every row on or after `from` (YYYY-MM-DD), oldest first, one page (the API allows 10,000 rows a page; 2 years is ~500). */
export function sinceUrl(from: string, pageSize = 1000, pageNumber = 1): string {
  return `${TREASURY_DEBT_URL}?fields=${TREASURY_FIELDS}&filter=record_date:gte:${from}&sort=record_date&page[size]=${pageSize}&page[number]=${pageNumber}`;
}

/** The exact source row for one date — the status page's "source" link. */
export function rowUrl(recordDate: string): string {
  return `${TREASURY_DEBT_URL}?fields=${TREASURY_FIELDS}&filter=record_date:eq:${recordDate}`;
}

/** The two rows a burn's arithmetic uses — the "verify it yourself" curl. */
export function pairUrl(prevDate: string, recordDate: string): string {
  return `${TREASURY_DEBT_URL}?fields=${TREASURY_FIELDS}&filter=record_date:in:(${prevDate},${recordDate})&sort=record_date`;
}

const earlier = (a: string | null, b: string): string => (a === null || b < a ? b : a);

export function isRealDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Validates a response body (any order) → readings oldest first, plus every refusal. Pure. `prev` is the keeper's last accepted
 * reading, so the first new row's delta is checked against it too.
 */
export function validateDebtResponse(body: unknown, opts: { prev?: { recordDate: string; cents: bigint } | null; maxDeltaCents?: bigint } = {}): FeedValidation {
  const refusals: string[] = [];
  const maxDelta = opts.maxDeltaCents ?? DEFAULT_MAX_DELTA_CENTS;
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return { readings: [], refusals: ["schema: the response has no data[] array"] };
  const parsed: DebtReading[] = [];
  // A row that fails schema or level is a date we cannot read. Any accepted row dated AFTER it would skip that date, so the
  // accepted set is cut at the earliest bad date; a bad row with no readable date at all cuts everything ("" = cut all).
  let cut: string | null = null;
  for (const row of data) {
    const r = row as Record<string, unknown> | null;
    const date = r?.record_date, amt = r?.tot_pub_debt_out_amt;
    if (!isRealDate(date)) { refusals.push(`schema: record_date ${String(JSON.stringify(date)).slice(0, 30)} is not a real YYYY-MM-DD`); cut = earlier(cut, ""); continue; }
    if (typeof amt !== "string" || !/^\d+(\.\d{1,2})?$/.test(amt.trim())) { refusals.push(`schema: ${date} tot_pub_debt_out_amt ${String(JSON.stringify(amt)).slice(0, 30)} is not a dollar amount`); cut = earlier(cut, date); continue; }
    const cents = usdToCents(amt);
    if (cents < MIN_LEVEL_CENTS || cents > MAX_LEVEL_CENTS) { refusals.push(`level: ${date} $${amt} is outside $1T–$1,000T`); cut = earlier(cut, date); continue; }
    parsed.push({ recordDate: date, amount: amt.trim(), cents });
  }
  parsed.sort((a, b) => (a.recordDate < b.recordDate ? -1 : a.recordDate > b.recordDate ? 1 : 0));
  const out: DebtReading[] = [];
  let last = opts.prev ?? null;
  for (const r of parsed) {
    if (cut !== null && r.recordDate >= cut) break;
    if (last && r.recordDate <= last.recordDate) {
      if (opts.prev && r.recordDate === opts.prev.recordDate) {
        if (r.cents !== opts.prev.cents) { refusals.push(`revision: Treasury now shows ${r.recordDate} as $${r.amount}, the keeper recorded $${centsToUsd(opts.prev.cents)} — holding for the owner`); break; }
        continue;   // the keeper's own last reading, echoed back unchanged: fine
      }
      if (opts.prev && r.recordDate < opts.prev.recordDate) continue;   // older than what the keeper already processed: not ours to judge again
      refusals.push(`order: ${r.recordDate} appears twice`); break;
    }
    if (last) {
      const d = r.cents - last.cents;
      if (d > maxDelta || -d > maxDelta) { refusals.push(`delta: ${last.recordDate} → ${r.recordDate} moved $${centsToUsd(d)}, beyond ±$${centsToUsd(maxDelta)} — refused`); break; }
    }
    out.push(r); last = r;
  }
  return { readings: out, refusals };
}

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

async function getJson(url: string, fetchImpl: FetchLike, timeoutMs: number): Promise<unknown> {
  await takeOrThrow(sourceForUrl(url));   // the request budget (apiBudget.ts), before the timeout starts
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ac.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Treasury API HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

/** Polls the latest `pageSize` rows and validates them against the keeper's last reading. Throws only on network/HTTP failure. */
export async function fetchDebtToPenny(opts: { pageSize?: number; prev?: { recordDate: string; cents: bigint } | null; fetchImpl?: FetchLike; timeoutMs?: number; maxDeltaCents?: bigint } = {}): Promise<FeedValidation> {
  const body = await getJson(latestUrl(opts.pageSize ?? 30), opts.fetchImpl ?? (fetch as unknown as FetchLike), opts.timeoutMs ?? 20_000);
  return validateDebtResponse(body, { prev: opts.prev ?? null, maxDeltaCents: opts.maxDeltaCents });
}

/**
 * Every row since `from`, paged — used when the keeper's last reading has fallen out of the latest-30 window (down for weeks: the
 * spec's "never skip a date") and by --replay. Returns the raw rows; validate them with validateDebtResponse.
 */
export async function fetchDebtHistoryRows(from: string, opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {}): Promise<{ data: unknown[] }> {
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const rows: unknown[] = [];
  for (let page = 1; page <= 50; page++) {
    const body = (await getJson(sinceUrl(from, 1000, page), fetchImpl, opts.timeoutMs ?? 30_000)) as { data?: unknown[]; meta?: { "total-pages"?: number } };
    if (!Array.isArray(body?.data)) throw new Error("Treasury API: no data[] in a history page");
    rows.push(...body.data);
    if (!body.meta?.["total-pages"] || page >= body.meta["total-pages"]) break;
  }
  return { data: rows };
}
