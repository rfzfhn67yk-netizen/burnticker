import fs from "node:fs";
import path from "node:path";
import { pollMsFor, type CycleReport } from "@/lib/burnticker/multiKeeper";
import type { FeedState, ReceiptRow, Registry, TokenRow } from "@/lib/burnticker/registry";
import { readAudit, type AuditSummary } from "@/lib/burnticker/trust";
import { PRE_AUDIT_POOL_CAP_SOL } from "@/lib/burnticker/fees";
import { takeRpc } from "@/lib/burnticker/apiBudget";

/**
 * BURNTICKER OPS ALERTS (2026-10-09, the operations layer). On the Burnticker host the keeper records each alert in the registry's
 * append-only `alerts` table (registryAlertSink: the same key is not re-raised within a Denver day) and forwards every NEW one to the
 * operator's alert channel by webhook (sinkFromEnv), where it is shown and messaged like any other operator alert. Every kind is
 * prefixed `bt-` so the operator's check-in can tell them apart. This module holds no private dependency: the receiving end lives in
 * the operator's own app, outside this repository.
 *
 * The module is split so it can be tested on a fake registry: `collectSnapshot` reads (registry, the published site, balances the
 * caller fetched), `evaluateAlerts` is a pure function of the snapshot, and `runBurntickerAlertCheck` wires both to a sink that
 * the caller supplies (the keeper: registryAlertSink + webhook). Nothing here sends a transaction or reads a key; the balances come from a caller-supplied provider
 * (`rpcBalanceLamports` over plain JSON-RPC when BURNTICKER_RPC_URL is set, else null = "unknown", never a false alarm).
 *
 * The kinds (the brief's list, plus two the keeper's own failure modes need):
 *   bt-feed-stall            a due selector not fetched for > 2× its cadence (feed pollEverySec, Kalshi 5 min)
 *   bt-reading-implausible   the adapter refused a reading (plausibility bounds, wrong period, unparsable) — from the last cycle's refusals
 *   bt-reading-conflict      the oracle changed a recorded result — the registry refused the write and the key is held
 *   bt-crank-failed          a receipt failed 3× in a row (the in-process streak, or ≥ 3 recorded attempts with an error on the row)
 *   bt-audit-mismatch        audit.json says a receipt does not recompute; bt-audit-stale: the hourly audit has not run for > 3 h
 *   bt-keeper-balance-low    the keeper's data key holds < 0.05 SOL (it pays the crank fees)
 *   bt-cap-binding           a burn pool holds more than the 25 SOL pre-audit cap: the excess is queued, not spent
 *   bt-keeper-stale          no cycle recorded for > 10 min while not paused (the keeper is down or wedged)
 *   bt-daily-summary         one line a day after 07:00 Denver: "N tokens, M burns, pools X SOL, dev fees Y SOL"
 */

export const KEEPER_MIN_LAMPORTS = BigInt(50_000_000);          // 0.05 SOL
export const FEED_STALL_FACTOR = 2;
export const CRANK_FAIL_STREAK = 3;
export const AUDIT_STALE_MS = 3 * 3_600_000;
export const KEEPER_STALE_MS = 10 * 60_000;
export const DAILY_SUMMARY_HOUR_DENVER = 7;
const LAMPORTS = BigInt(1_000_000_000);

export interface BurntickerAlert { kind: string; key: string; text: string; meta: Record<string, unknown> | null }
export type AlertSink = (kind: string, key: string, text: string, meta: Record<string, unknown> | null, now: number) => Promise<unknown>;

export interface TokenSnapshot {
  mint: string; ticker: string; status: TokenRow["status"]; mode: string; selectorKey: string; liveSince: number; cadenceMs: number;
  feed: FeedState;
  pending: { eventId: string; status: string; attempts: number; lastError: string | null }[];
  burns: number; burns24h: number; spent24hLamports: bigint;
  /** From the keeper's published t/<ticker>/status.json (the fee PDA read the keeper made); null when not published yet. */
  feePdaSol: string | null; queuedSol: string | null;
  attesters: { active: number; independent: number };
}
export interface BalanceSample { at: number; keeperLamports: bigint | null; devFeeLamports: bigint | null }
export interface BurntickerSnapshot {
  now: number; paused: boolean; registryFile: string;
  tokens: TokenSnapshot[];
  lastCycle: { at: number; errors: string[]; refusals: string[] } | null;
  audit: AuditSummary | null;
  balances: BalanceSample | null;
  /** Consecutive crank failures per `${mint}:${eventId}` from the running keeper (empty when a timer or the check-in asks). */
  crankStreaks: Record<string, number>;
}

/** Denver calendar date (YYYY-MM-DD) and hour — the owner's clock (memory: Denver time). */
export const denverDate = (ms: number): string => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Denver" });
export const denverHour = (ms: number): number => Number(new Date(ms).toLocaleString("en-US", { timeZone: "America/Denver", hour: "2-digit", hour12: false }).slice(0, 2)) % 24;
export const solStr = (l: bigint | null): string => (l === null ? "unknown" : (Number(l) / 1e9).toFixed(3));

/** Consecutive crank failures per receipt, fed with every cycle report; a confirmed/skipped/exhausted outcome clears the streak. */
export class CrankFailureTracker {
  readonly streaks = new Map<string, number>();
  note(r: CycleReport): void {
    for (const x of r.executed) {
      const k = `${x.mint}:${x.eventId}`;
      if (x.outcome === "error") this.streaks.set(k, (this.streaks.get(k) ?? 0) + 1);
      else if (x.outcome === "confirmed" || x.outcome === "skipped" || x.outcome === "exhausted") this.streaks.delete(k);
    }
  }
  snapshot(): Record<string, number> { return Object.fromEntries(this.streaks); }
}

/** t/<ticker>/status.json as the keeper published it (pool figures come from the program read it made); null when absent/unreadable. */
function publishedPool(siteDir: string, ticker: string): { feePdaSol: string | null; queuedSol: string | null } {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(siteDir, "t", ticker, "status.json"), "utf8")) as { pool?: { feePdaSol?: string | null; queuedSol?: string | null } };
    return { feePdaSol: j.pool?.feePdaSol ?? null, queuedSol: j.pool?.queuedSol ?? null };
  } catch { return { feePdaSol: null, queuedSol: null }; }
}

export function collectSnapshot(o: { registry: Registry; siteDir: string; now: number; paused?: boolean; balances?: BalanceSample | null; crankStreaks?: Record<string, number>; kalshiPollMs?: number }): BurntickerSnapshot {
  const { registry: reg, now } = o;
  const tokens: TokenSnapshot[] = reg.tokens().map((t) => {
    let cadenceMs = 5 * 60_000;
    try { cadenceMs = pollMsFor({ kalshiPollMs: o.kalshiPollMs }, reg.lockedRule(t).rule); } catch { /* an unreadable rule is the audit's finding, not a cadence */ }
    const rows: ReceiptRow[] = reg.receipts(t.mint);
    const confirmed = rows.filter((r) => r.status === "confirmed");
    const recent = confirmed.filter((r) => (r.confirmedAt ?? 0) >= now - 86_400_000);
    const att = reg.attesters(t.mint).filter((a) => a.active);
    return {
      mint: t.mint, ticker: t.ticker, status: t.status, mode: t.mode, selectorKey: t.selectorKey, liveSince: Math.max(t.createdAt, Date.parse(t.baselineAt) || 0), cadenceMs,
      feed: reg.feedState(t.selectorKey),
      pending: rows.filter((r) => r.status === "planned" || r.status === "sending").map((r) => ({ eventId: r.eventId, status: r.status, attempts: r.attempts, lastError: r.lastError })),
      burns: confirmed.length, burns24h: recent.length, spent24hLamports: recent.reduce((a, r) => a + (r.spendLamports ?? BigInt(0)), BigInt(0)),
      ...publishedPool(o.siteDir, t.ticker),
      attesters: { active: att.length, independent: att.filter((a) => a.role === "independent").length },
    };
  });
  let lastCycle: BurntickerSnapshot["lastCycle"] = null;
  try { const s = reg.getStatus("lastCycle"); if (s) { const j = JSON.parse(s) as { at?: number; errors?: string[]; refusals?: string[] }; lastCycle = { at: Number(j.at ?? 0), errors: j.errors ?? [], refusals: j.refusals ?? [] }; } } catch { lastCycle = null; }
  return { now, paused: o.paused ?? false, registryFile: reg.file, tokens, lastCycle, audit: readAudit(o.siteDir), balances: o.balances ?? null, crankStreaks: o.crankStreaks ?? {} };
}

const solOf = (s: string | null): number => (s === null ? 0 : Number(s) || 0);

/** PURE: the alerts a snapshot warrants. Keys carry what makes them distinct so the sink's one-per-day-per-key dedupe does the rest. */
export function evaluateAlerts(s: BurntickerSnapshot): BurntickerAlert[] {
  const out: BurntickerAlert[] = [];
  const day = denverDate(s.now);
  const live = s.tokens.filter((t) => t.status === "live");
  // Feed stalls: one per selector key (tokens share keys), judged on the LAST FETCH of any kind — a key the keeper is not even trying is the alarm.
  const seen = new Set<string>();
  for (const t of live) {
    if (seen.has(t.selectorKey)) continue; seen.add(t.selectorKey);
    const last = Math.max(t.feed.lastFetchAt ?? 0, t.feed.lastOkAt ?? 0, t.liveSince);
    const limit = FEED_STALL_FACTOR * t.cadenceMs;
    if (!s.paused && s.now - last > limit) out.push({ kind: "bt-feed-stall", key: `bt-feed-stall:${t.selectorKey}`, text: `Burnticker feed ${t.selectorKey} ($${t.ticker}) not fetched for ${Math.round((s.now - last) / 60_000)} min (cadence ${Math.round(t.cadenceMs / 60_000)} min, limit ${Math.round(limit / 60_000)} min). ${t.feed.lastError ? `The last error was: ${t.feed.lastError.slice(0, 120)}. ` : ""}${t.feed.failures ? `It has failed ${t.feed.failures} ${t.feed.failures === 1 ? "time" : "times"} in a row.` : ""}`.trim(), meta: { selectorKey: t.selectorKey, lastFetchAt: t.feed.lastFetchAt, failures: t.feed.failures } });
    if (t.feed.lastError && /already recorded as/.test(t.feed.lastError)) out.push({ kind: "bt-reading-conflict", key: `bt-reading-conflict:${t.selectorKey}:${day}`, text: `Burnticker: the oracle for ${t.selectorKey} changed a recorded result — the registry refused the write and the key is HELD until someone looks: ${t.feed.lastError.slice(0, 160)}`, meta: { selectorKey: t.selectorKey } });
  }
  // Plausibility refusals from the last cycle (the adapter's bounds / period / parse refusals are logged, not stored, so the keeper hands them over).
  for (const r of s.lastCycle?.refusals ?? []) out.push({ kind: "bt-reading-implausible", key: `bt-reading-implausible:${hashKey(r)}`, text: `Burnticker reading refused: ${r.slice(0, 200)}`, meta: null });
  // Cranks failing in a row.
  for (const t of live) for (const p of t.pending) {
    const streak = s.crankStreaks[`${t.mint}:${p.eventId}`] ?? 0;
    if (streak >= CRANK_FAIL_STREAK || (p.attempts >= CRANK_FAIL_STREAK && p.lastError)) out.push({ kind: "bt-crank-failed", key: `bt-crank-failed:${t.mint}:${p.eventId}`, text: `Burnticker crank $${t.ticker} ${p.eventId} failed ${Math.max(streak, p.attempts)}× in a row (${p.status}): ${(p.lastError ?? "no error recorded").slice(0, 160)}`, meta: { mint: t.mint, eventId: p.eventId, attempts: p.attempts, streak } });
  }
  // The public audit.
  if (s.audit && !s.audit.ok) out.push({ kind: "bt-audit-mismatch", key: `bt-audit-mismatch:${s.audit.ranAt}`, text: `Burnticker AUDIT MISMATCH (${s.audit.ranAt}): ${s.audit.mismatches.length} ${s.audit.mismatches.length === 1 ? "receipt does" : "receipts do"} not recompute — ${s.audit.mismatches.slice(0, 3).map((m) => `$${m.ticker} ${m.eventId}: ${m.checks[0]}`).join(" | ")}`, meta: { mismatches: s.audit.mismatches.length } });
  if (live.length && (!s.audit || s.now - Date.parse(s.audit.ranAt) > AUDIT_STALE_MS)) out.push({ kind: "bt-audit-stale", key: `bt-audit-stale:${day}`, text: `Burnticker audit ${s.audit ? `last ran ${Math.round((s.now - Date.parse(s.audit.ranAt)) / 3_600_000)} h ago` : "has never run"} — the hourly mct-burnticker-audit.timer is not running`, meta: null });
  // The keeper's key and the pre-audit cap.
  if (s.balances?.keeperLamports !== null && s.balances?.keeperLamports !== undefined && s.balances.keeperLamports < KEEPER_MIN_LAMPORTS) out.push({ kind: "bt-keeper-balance-low", key: `bt-keeper-balance-low:${day}`, text: `Burnticker keeper key holds ${solStr(s.balances.keeperLamports)} SOL (< 0.05) — top it up or cranks stop landing`, meta: { lamports: s.balances.keeperLamports.toString() } });
  for (const t of live) if (t.mode === "buyback" && solOf(t.queuedSol) > 0) out.push({ kind: "bt-cap-binding", key: `bt-cap-binding:${t.mint}:${day}`, text: `Burnticker $${t.ticker}: ${t.queuedSol} SOL above the ${PRE_AUDIT_POOL_CAP_SOL} SOL pre-audit cap is queued (pool ${t.feePdaSol ?? "?"} SOL), spent once the cap rises or ends`, meta: { mint: t.mint, queuedSol: t.queuedSol } });
  // The keeper itself.
  if (live.length && !s.paused && s.lastCycle && s.now - s.lastCycle.at > KEEPER_STALE_MS) out.push({ kind: "bt-keeper-stale", key: `bt-keeper-stale:${day}T${String(denverHour(s.now)).padStart(2, "0")}`, text: `Burnticker keeper: no cycle for ${Math.round((s.now - s.lastCycle.at) / 60_000)} min — mct-burnticker-keeper is down or wedged`, meta: null });
  // The daily line.
  if (denverHour(s.now) >= DAILY_SUMMARY_HOUR_DENVER) {
    const pools = live.reduce((a, t) => a + solOf(t.feePdaSol), 0);
    const burns = live.reduce((a, t) => a + t.burns24h, 0);
    out.push({ kind: "bt-daily-summary", key: `bt-daily-summary:${day}`, text: `Burnticker ${day}: ${live.length} token${live.length === 1 ? "" : "s"}, ${burns} burn${burns === 1 ? "" : "s"} (24 h), pools ${pools.toFixed(3)} SOL, dev fees ${solStr(s.balances?.devFeeLamports ?? null)} SOL`, meta: { tokens: live.length, burns, pools } });
  }
  return out;
}

function hashKey(s: string): string { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); }

/** The keeper's local sink on the Burnticker host: the registry's alerts table (one per key per Denver day). Returns null when deduped. */
export function registryAlertSink(reg: Registry): AlertSink {
  return async (kind, key, text, meta, now) => reg.recordAlert({ kind, key, text, meta }, now);
}
/** The last day's alerts from the registry, in the shape the check-in block reads. */
export function registryAlertRows(reg: Registry, now: number): { ts: number; kind: string; text: string; seenAt: number | null; sent: boolean }[] {
  return reg.alertsSince(now - 86_400_000).map((a) => ({ ts: a.ts, kind: a.kind, text: a.text, seenAt: null, sent: false }));
}

/**
 * CROSS-HOST DELIVERY (the owner, 2026-10-09: Burnticker runs on its own VPS; the operator's trading host is reachable only over its
 * private network). The keeper's sink is: (1) the registry's alerts table on this host (the once-a-day-per-key dedupe, and the list
 * ops.json carries), then (2) when BURNTICKER_ALERT_WEBHOOK is set, one HTTPS POST of the same alert to that URL with
 * `Authorization: Bearer <BURNTICKER_ALERT_WEBHOOK_TOKEN>`. The intended target is the operator's own alert-intake route, which records
 * it in the operator's alert channel; any HTTPS endpoint that accepts the JSON works (ntfy, a Cloudflare worker). A failed POST is
 * reported back, never thrown.
 */
export interface WebhookOutcome { ok: boolean; status: number | null; error: string | null }
export async function postAlertWebhook(url: string, token: string | null, a: { kind: string; key: string; text: string; meta: Record<string, unknown> | null; ts: number }, fetchImpl: typeof fetch = fetch): Promise<WebhookOutcome> {
  try {
    // An Origin equal to the address called: what the platform's headless runners send so requireOwnerAction's same-origin check passes (ownerActionHeaders).
    let origin = ""; try { origin = new URL(url).origin; } catch { origin = ""; }
    const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ source: "burnticker", ...a }), signal: AbortSignal.timeout(10_000) });
    return { ok: r.ok, status: r.status, error: r.ok ? null : `HTTP ${r.status}` };
  } catch (e) { return { ok: false, status: null, error: (e as Error).message.slice(0, 120) }; }
}

export interface WebhookState { configured: boolean; lastAttemptAt: number | null; lastOkAt: number | null; lastError: string | null }

/** The sink the keeper uses: `local` (dedupe + record — registryAlertSink), then the webhook for every alert that was new. `state` is for ops.json. */
export function sinkFromEnv(env: Readonly<Record<string, string | undefined>>, o: { local: AlertSink; fetchImpl?: typeof fetch; log?: (s: string) => void }): { sink: AlertSink; state: WebhookState } {
  const url = (env.BURNTICKER_ALERT_WEBHOOK ?? "").trim() || null;
  const token = (env.BURNTICKER_ALERT_WEBHOOK_TOKEN ?? "").trim() || null;
  const local = o.local;
  const state: WebhookState = { configured: !!url, lastAttemptAt: null, lastOkAt: null, lastError: null };
  const sink: AlertSink = async (kind, key, text, meta, now) => {
    const row = await local(kind, key, text, meta, now);
    if (!row || !url) return row;
    state.lastAttemptAt = now;
    const w = await postAlertWebhook(url, token, { kind, key, text, meta, ts: now }, o.fetchImpl);
    if (w.ok) { state.lastOkAt = now; state.lastError = null; } else { state.lastError = w.error; o.log?.(`  [alert] webhook ${w.error}: ${kind} ${key} stays local only`); }
    return row;
  };
  return { sink, state };
}

/** Collect → evaluate → raise through the given sink. Returns what was raised (nulls = deduped by the sink). */
export async function runBurntickerAlertCheck(o: Parameters<typeof collectSnapshot>[0] & { sink: AlertSink }): Promise<{ snapshot: BurntickerSnapshot; alerts: BurntickerAlert[]; raised: BurntickerAlert[] }> {
  const snapshot = collectSnapshot(o);
  const alerts = evaluateAlerts(snapshot);
  const sink = o.sink;
  const raised: BurntickerAlert[] = [];
  for (const a of alerts) {
    try { const r = await sink(a.kind, a.key, a.text, a.meta, o.now); if (r) raised.push(a); } catch { /* the channel failing must never stop the keeper */ }
  }
  return { snapshot, alerts, raised };
}

// ---- balances: a plain JSON-RPC getBalance (no key, no SDK), and the daily samples the check-in reads back ----

export async function rpcBalanceLamports(rpcUrl: string, pubkey: string, fetchImpl: typeof fetch = fetch): Promise<bigint | null> {
  try {
    await takeRpc(rpcUrl, { method: "getBalance" });   // the request budget (apiBudget.ts); a hold reads as "unknown", never a false alarm
    const r = await fetchImpl(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [pubkey, { commitment: "confirmed" }] }), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { result?: { value?: number } };
    return typeof j.result?.value === "number" ? BigInt(j.result.value) : null;
  } catch { return null; }
}

export const BALANCES_LATEST_KEY = "balances:latest";
export const balancesDayKey = (ms: number): string => `balances:day:${denverDate(ms)}`;

/** Records a sample under `balances:latest` and, the first time each Denver day, under `balances:day:<date>` (the delta's anchor). */
export function recordBalanceSample(reg: Registry, s: BalanceSample): void {
  const v = { at: s.at, keeperLamports: s.keeperLamports?.toString() ?? null, devFeeLamports: s.devFeeLamports?.toString() ?? null };
  reg.setStatus(BALANCES_LATEST_KEY, v, s.at);
  if (!reg.getStatus(balancesDayKey(s.at))) reg.setStatus(balancesDayKey(s.at), v, s.at);
}
export function readBalanceSample(reg: Registry, key: string): BalanceSample | null {
  try {
    const raw = reg.getStatus(key); if (!raw) return null;
    const j = JSON.parse(raw) as { at: number; keeperLamports: string | null; devFeeLamports: string | null };
    return { at: Number(j.at), keeperLamports: j.keeperLamports === null ? null : BigInt(j.keeperLamports), devFeeLamports: j.devFeeLamports === null ? null : BigInt(j.devFeeLamports) };
  } catch { return null; }
}
/** latest − the first sample of the previous Denver day (else today's first): the dev-fee wallet's 24 h-ish delta, or null when unknown. */
export function devFeeDelta(reg: Registry, now: number): { latest: BalanceSample | null; anchor: BalanceSample | null; deltaLamports: bigint | null } {
  const latest = readBalanceSample(reg, BALANCES_LATEST_KEY);
  const anchor = readBalanceSample(reg, balancesDayKey(now - 86_400_000)) ?? readBalanceSample(reg, balancesDayKey(now));
  const deltaLamports = latest?.devFeeLamports !== null && latest?.devFeeLamports !== undefined && anchor?.devFeeLamports !== null && anchor?.devFeeLamports !== undefined ? latest.devFeeLamports - anchor.devFeeLamports : null;
  return { latest, anchor, deltaLamports };
}
export const lamportsToSol = (l: bigint): string => `${(Number(l) / Number(LAMPORTS)).toFixed(4)}`;
