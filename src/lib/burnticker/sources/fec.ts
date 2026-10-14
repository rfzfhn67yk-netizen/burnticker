import type { SettledEvent } from "@/lib/burnticker/units";
import type { FetchLike, ResolvedSelector } from "@/lib/burnticker/oracle/types";
import { sourceForUrl, takeOrThrow } from "@/lib/burnticker/apiBudget";

/**
 * THE FEC ADAPTER (tier 4, first-party, public domain; owner-approved 2026-10-10 for election pairs). Campaign receipts per filed report
 * from OpenFEC (api.open.fec.gov; the free DEMO_KEY works for development, FEC_API_KEY for production):
 *
 *   GET /candidates/search/?q=&office=&state=          candidate ids
 *   GET /candidate/{id}/committees/?designation=P       the principal campaign committee
 *   GET /committee/{id}/reports/?cycle=                 each filed report: coverage dates, receipt date, file number, total_receipts_period
 *   GET /filings/?committee_id=&cycle=                  the same filings through another endpoint: the CROSS-READ (same operator — the
 *                                                        settlement-coverage gate does not accept it; see sources.json fec.filings)
 *
 * SERIES  fec.beats:<candidate A>-<candidate B>   one reading per reporting period both committees filed (keyed by the coverage end
 * date): value 1 when A's receipts for the period exceed B's, else 0 — the election pair applies it symmetrically (each side's coin
 * reads its own candidate first). Only the most recent version of a report (amendments supersede) is read; the proof material on each
 * reading names both committees, the file numbers, the coverage dates and the receipt dates.
 */

export const FEC_API = "https://api.open.fec.gov/v1";
export const fecSeries = (a: string, b: string): string => `fec.beats:${a.toUpperCase()}-${b.toUpperCase()}`;
const CAND = /^[HSP][0-9A-Z]{8}$/;
export function parseFecSeries(id: string): { a: string; b: string } | null {
  const m = /^fec\.beats:([A-Z0-9]{9})-([A-Z0-9]{9})$/.exec(id);
  return m && CAND.test(m[1]) && CAND.test(m[2]) && m[1] !== m[2] ? { a: m[1], b: m[2] } : null;
}

export interface FecReport { committeeId: string; reportType: string; coverageStart: string | null; coverageEnd: string; receiptDate: string | null; receipts: number; fileNumber: number | null; mostRecent: boolean; amendedBy: number | null }
export interface FecFiling { fileNumber: number | null; mostRecentFileNumber: number | null; receipts: number | null; coverageEnd: string | null; formType: string | null }

const day = (s: unknown): string | null => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const numOr = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function parseReports(body: unknown): FecReport[] {
  const rows = ((body as { results?: unknown[] } | null)?.results ?? []) as Record<string, unknown>[];
  return rows.map((r) => ({ committeeId: String(r.committee_id ?? ""), reportType: String(r.report_type ?? ""), coverageStart: day(r.coverage_start_date), coverageEnd: day(r.coverage_end_date) ?? "", receiptDate: day(r.receipt_date), receipts: numOr(r.total_receipts_period) ?? NaN, fileNumber: numOr(r.file_number), mostRecent: r.most_recent !== false, amendedBy: numOr(r.most_recent_file_number) }))
    .filter((r) => r.coverageEnd && Number.isFinite(r.receipts) && r.mostRecent);
}
export function parseFilings(body: unknown): FecFiling[] {
  const rows = ((body as { results?: unknown[] } | null)?.results ?? []) as Record<string, unknown>[];
  return rows.map((r) => ({ fileNumber: numOr(r.file_number), mostRecentFileNumber: numOr(r.most_recent_file_number), receipts: numOr(r.total_receipts), coverageEnd: day(r.coverage_end_date), formType: (r.form_type as string) ?? null }));
}
/** The same-operator cross-read: the filing with the report's file number reports the same receipts. */
export function filingAgrees(r: FecReport, filings: readonly FecFiling[]): boolean | null {
  const f = filings.find((x) => x.fileNumber !== null && x.fileNumber === r.fileNumber);
  if (!f || f.receipts === null) return null;
  return Math.abs(f.receipts - r.receipts) < 0.005;
}

export interface Matchup { period: string; a: FecReport; b: FecReport; aBeats: boolean }
/** Periods both committees reported (same coverage end date), oldest first, with whether A's receipts exceed B's. */
export function pairReports(a: readonly FecReport[], b: readonly FecReport[]): Matchup[] {
  const byEnd = new Map(b.map((r) => [r.coverageEnd, r]));
  return a.filter((r) => byEnd.has(r.coverageEnd)).map((r) => ({ period: r.coverageEnd, a: r, b: byEnd.get(r.coverageEnd)!, aBeats: r.receipts > byEnd.get(r.coverageEnd)!.receipts })).sort((x, y) => x.period.localeCompare(y.period));
}

export class FecClient {
  private fetchImpl: FetchLike; private key: string; private cache = new Map<string, unknown>(); private lastAt = 0; private minInterval: number; private chain: Promise<void> = Promise.resolve(); private now: () => number;
  requests: string[] = [];
  constructor(o: { fetchImpl?: FetchLike; apiKey?: string; minIntervalMs?: number; now?: () => number } = {}) { this.fetchImpl = o.fetchImpl ?? (fetch as unknown as FetchLike); this.key = (o.apiKey ?? process.env.FEC_API_KEY ?? "").trim() || "DEMO_KEY"; this.minInterval = o.minIntervalMs ?? 1100; this.now = o.now ?? (() => Date.now()); }
  /** GET a path under the API (the key is appended here and never stored or logged). */
  async get(pathQ: string): Promise<unknown> {
    if (this.cache.has(pathQ)) return this.cache.get(pathQ);
    const run = async () => {
      const wait = this.lastAt + this.minInterval - this.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      await takeOrThrow(sourceForUrl(FEC_API));   // the request budget (apiBudget.ts)
      this.lastAt = this.now(); this.requests.push(pathQ);
      const res = await this.fetchImpl(`${FEC_API}${pathQ}${pathQ.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(this.key)}`, { headers: { accept: "application/json", "user-agent": "burnticker/0.1" } });
      if (!res.ok) throw new Error(`FEC HTTP ${res.status} for ${pathQ.slice(0, 100)}`);
      const body = await res.json(); this.cache.set(pathQ, body); return body;
    };
    const p = this.chain.then(run, run); this.chain = p.then(() => undefined, () => undefined); return p;
  }
  static searchPath = (q: string, office: string, state: string): string => `/candidates/search/?q=${encodeURIComponent(q)}&office=${office}&state=${state}&sort=-first_file_date`;
  static committeesPath = (cand: string): string => `/candidate/${cand}/committees/?designation=P`;
  static reportsPath = (cmte: string, cycle: number): string => `/committee/${cmte}/reports/?cycle=${cycle}&sort=-coverage_end_date&per_page=30`;
  static filingsPath = (cmte: string, cycle: number): string => `/filings/?committee_id=${cmte}&cycle=${cycle}&sort=-receipt_date&per_page=50`;
  async searchCandidates(q: string, office: "S" | "H" | "P", state: string): Promise<{ id: string; name: string; party: string | null }[]> {
    const rows = (((await this.get(FecClient.searchPath(q, office, state))) as { results?: Record<string, unknown>[] }).results ?? []);
    return rows.map((r) => ({ id: String(r.candidate_id), name: String(r.name ?? ""), party: (r.party as string) ?? null }));
  }
  async principalCommittee(cand: string): Promise<string | null> {
    const rows = (((await this.get(FecClient.committeesPath(cand))) as { results?: { committee_id?: string }[] }).results ?? []);
    return rows[0]?.committee_id ?? null;
  }
  async reports(cmte: string, cycle: number): Promise<FecReport[]> { return parseReports(await this.get(FecClient.reportsPath(cmte, cycle))); }
  async filings(cmte: string, cycle: number): Promise<FecFiling[]> { return parseFilings(await this.get(FecClient.filingsPath(cmte, cycle))); }
}

/** Settled readings of fec.beats:A-B for an election cycle (default: the even year at or after now). */
export async function fecSettled(c: FecClient, s: { a: string; b: string }, sinceIso: string | null, o: { cycle?: number; nowMs?: number; crossRead?: boolean } = {}): Promise<ResolvedSelector> {
  const y = new Date(o.nowMs ?? Date.now()).getUTCFullYear(), cycle = o.cycle ?? (y % 2 ? y + 1 : y);
  const [ca, cb] = await Promise.all([c.principalCommittee(s.a), c.principalCommittee(s.b)]);
  if (!ca || !cb) throw new Error(`no principal campaign committee for ${!ca ? s.a : s.b}`);
  const [ra, rb] = await Promise.all([c.reports(ca, cycle), c.reports(cb, cycle)]);
  const [fa, fb] = o.crossRead === false ? [[], []] : await Promise.all([c.filings(ca, cycle), c.filings(cb, cycle)]);
  const events: SettledEvent[] = []; const refusals: string[] = []; let awaiting = 0;
  for (const m of pairReports(ra, rb).filter((x) => !sinceIso || x.period > sinceIso.slice(0, 10))) {
    if (o.crossRead !== false) {
      const va = filingAgrees(m.a, fa), vb = filingAgrees(m.b, fb);
      if (va === false || vb === false) { refusals.push(`${m.period}: a report's receipts differ from its filing — held`); continue; }
      if (va === null || vb === null) { awaiting++; continue; }
    }
    const fmt = (r: FecReport) => `${r.committeeId} ${r.reportType} ${r.coverageStart ?? "?"}→${r.coverageEnd} filed ${r.receiptDate ?? "?"} #${r.fileNumber ?? "?"} receipts $${r.receipts.toFixed(2)}`;
    events.push({ id: m.period, at: m.period, result: null, value: m.aBeats ? "1" : "0", title: `${s.a} ${m.aBeats ? ">" : "≤"} ${s.b} · ${fmt(m.a)} · ${fmt(m.b)}`, sourceUrl: `https://www.fec.gov/data/committee/${ca}/?cycle=${cycle}`, method: "fec-reports+filings" } as SettledEvent);
  }
  return { events, awaitingFinal: awaiting, refusals, settlementSourceUrl: `${FEC_API}/committee/${ca}/reports/` };
}
