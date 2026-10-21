import fs from "node:fs";
import path from "node:path";
import { openRegistry, REGISTRY_FILE, type Registry } from "@/lib/burnticker/registry";
import { attesterStatusLine } from "@/lib/burnticker/fees";
import { publishSite, toJson } from "@/lib/burnKeeper/statusPage";
import { computeFeedHealth, type FeedHealth } from "@/lib/burnticker/ops/feedHealth";
import { conditionLines, conditionsView, readConditionMemory, type ActiveCondition, type ConditionRecord, type OpsSignals } from "@/lib/burnticker/ops/conditions";
import { heartbeatLine, type HeartbeatState } from "@/lib/burnticker/ops/heartbeat";
import { offboxPullLine, slowRequestsLine, webProbeLine, type OffboxPullFact, type SlowRequestsFact, type WebProbeFact } from "@/lib/burnticker/ops/unitHealth";
import type { TradeClickRow } from "@/lib/burnticker/tradeClicks";
import { topUpOpsLines } from "@/lib/burnticker/ops/topUp";
import { collectSnapshot, devFeeDelta, lamportsToSol, registryAlertRows, solStr, type BurntickerSnapshot, type WebhookState } from "@/lib/burnticker/alerts";

/**
 * THE MORNING CHECK'S BURNTICKER BLOCK (2026-10-09). The operator's daily check-in prints one `## Burnticker`
 * section from these lines: tokens live, burns in the last 24 h, failed cranks, queued (capped) SOL, attester quorum, the audit badge,
 * the dev-fee wallet's balance and its delta, the keeper's last cycle and key balance, and the `bt-` alerts of the last 24 h. It reads
 * the registry, the published site and the alert table; it changes nothing (the check-in's read-only promise, test/checkinReaders.test.ts
 * item g). Pure given a snapshot (`burntickerCheckinLines`); `burntickerCheckin` gathers the inputs from the host.
 *
 * TWO HOSTS (the owner, 10-09): Burnticker runs on its own VPS; the check-in runs on the Mac / the trading VPS, where there is no
 * registry. So the keeper publishes the same block as `ops.json` into the public site every alert check (`buildOpsJson` +
 * `publishOps`), and `burntickerCheckin` falls back to fetching BURNTICKER_OPS_URL (https://<burnticker host>/ops.json) when no local
 * registry exists. Nothing in ops.json is secret: public keys, on-chain balances, counts and the alert lines.
 */

export interface CheckinAlertRow { ts: number; kind: string; text: string; seenAt: number | null; sent: boolean; /** OP7-7: what became of it on the phone (push.ts pushOutcome) */ push?: string | null }
export interface CheckinInput {
  snapshot: BurntickerSnapshot | null; delta: ReturnType<typeof devFeeDelta> | null; alerts: CheckinAlertRow[] | null; firstLaunchAt: number | null; webhook?: WebhookState | null; why?: string;
  /** the request budget, one line per provider (apiBudget.ts budgetStatusLines) */ apiBudget?: string[] | null;
  /** Third prelaunch audit F06: the per-source health (ops/feedHealth.ts computeFeedHealth) — down / stale / disagree / withheld count as
   *  conditions; absent = not computed (only the keeper-level conditions count). */
  health?: readonly FeedHealth[] | null;
  /** The keeper's condition memory (ops/conditions.ts CONDITIONS_KEY), for the "recovered" line. */
  conditionMemory?: Readonly<Record<string, ConditionRecord>> | null;
  /** Second audit A-7: the keeper's unit check and request budget (the alert rows and the last cycle are added here from the input). */
  signals?: Pick<OpsSignals, "units" | "budget"> | null;
  /** Second audit A-7: the keeper's off-box heartbeat (ops/heartbeat.ts); absent = not known on this host. */
  heartbeat?: HeartbeatState | null;
  /** Prelaunch audit 2026-10-18 A-1 / R1: the five host facts the code depends on, as the keeper sees them; absent = not reported. */
  hostFacts?: HostFacts | null;
  /** Campaign readiness 2026-10-19: counted trade-link clicks per coin, venue and UTC day (tradeClicks.ts); absent = not read */
  tradeClicks?: TradeClickRow[] | null;
  /** 2026-10-19: the automatic SOL top-up lines (ops/topUp.ts topUpOpsLines); absent = not read on this host */
  topUps?: string[] | null;
}
/** The host configuration the code depends on (names and yes/no only; never a value). */
export interface HostFacts {
  /** burn dispersal: on or off, and why (dispersal.ts dispersalLine) */ dispersal: { on: boolean; line: string };
  /** BURNTICKER_ALERT_WEBHOOK is set */ webhookConfigured: boolean;
  /** BURNTICKER_PUSH_URL is set: alerts reach the owner's phone. Owner decision 2026-10-18: push only, so a missing webhook is no gap */ pushConfigured: boolean;
  /** BURNTICKER_STATUS_HEARTBEAT_URL is set (the off-box dead-man's switch) */ heartbeatConfigured: boolean;
  /** BURNTICKER_BACKUP_DEST is set, or the last backup run saw one */ backupDestConfigured: boolean;
  /** where the trust page's program hash comes from (programHash.ts programHashSourceLine) */ programHashSource: string;
  /** I-11 / B-4 (2026-10-19): the external web check (ops/unitHealth.ts webProbeFact); absent in older documents. Never the URL. */
  webProbe?: WebProbeFact | null;
  /** HB-145 (2026-10-20): the web's slow requests and event-loop holds in the last hour (ops/unitHealth.ts readSlowRequests); null when
   *  the web has written no slow log yet; absent in older documents. */
  slowRequests?: SlowRequestsFact | null;
  /** B-3 / OPS-1 (2026-10-19): the off-box pull receipt (ops/unitHealth.ts offboxPullFact, data/offbox-pull.json): "pulled" under 12 hours
   *  old, "stale" older, "none" absent. backupDestConfigured stays its own fact (the pull needs no destination). Absent in older documents. */
  offBox?: OffboxPullFact["offBox"];
  /** the receipt's method name (a fixed word; never a host or a path) */ offBoxMethod?: string | null;
  offBoxPulledAt?: string | null;
}
/** The webhook as a host fact: with phone push configured and no webhook, it is not used by the owner's decision, never "not set". */
export const WEBHOOK_PUSH_ONLY = "not used (push only, owner decision 2026-10-18)";
const webhookFact = (configured: boolean, push: boolean): string => (configured ? "BURNTICKER_ALERT_WEBHOOK set" : push ? `BURNTICKER_ALERT_WEBHOOK ${WEBHOOK_PUSH_ONLY}` : "BURNTICKER_ALERT_WEBHOOK NOT SET (and no phone push: alerts stay on this host)");
export function hostFactLines(h: HostFacts, now: number = Date.now()): string[] {
  const yn = (b: boolean, name: string, why: string) => (b ? `${name} set` : `${name} NOT SET (${why})`);
  return [
    `- host: ${h.dispersal.line}`,
    `- host: ${webhookFact(h.webhookConfigured, h.pushConfigured)} · ${yn(h.pushConfigured, "BURNTICKER_PUSH_URL", "no alert reaches a phone")} · ${yn(h.heartbeatConfigured, "BURNTICKER_STATUS_HEARTBEAT_URL", "a dead host is seen by nobody")} · ${yn(h.backupDestConfigured, "BURNTICKER_BACKUP_DEST", h.offBox === "pulled" || h.offBox === "stale" ? "the off-box copy is pulled instead; see the off-box line" : "backups stay on the box")}`,
    `- host: ${h.programHashSource}`,
    ...(h.webProbe ? [webProbeLine(h.webProbe, now)!] : []),
    ...(h.slowRequests !== undefined ? [slowRequestsLine(h.slowRequests)!] : []),
    ...(h.offBox ? [offboxPullLine(h, now)!] : []),
  ];
}
/** The host signals for the conditions: what the keeper passed, plus a keeper refusal read from the alert rows. */
const signalsOf = (i: CheckinInput): OpsSignals => ({ ...(i.signals ?? {}), alerts: i.alerts ?? null, lastCycleAt: i.snapshot?.lastCycle?.at ?? null });

export const OPS_SCHEMA = "burnticker.ops/v1";
/** `conditions`: the active conditions' labels (ops/conditions.ts, the same list the check-in prints); `conditionDetail` and `recovered`
 *  carry the rest (added 2026-10-16, F06; absent in older documents). */
export interface OpsJson { schema: typeof OPS_SCHEMA; generatedAt: string; host: string; lines: string[]; conditions: string[]; conditionDetail?: ActiveCondition[]; recovered?: ConditionRecord[]; webhook: WebhookState | null; /** added 2026-10-18 (A-7) */ heartbeat?: HeartbeatState | null; /** A-1: absent in older documents */ hostFacts?: HostFacts | null; /** campaign readiness 2026-10-19: absent in older documents */ tradeClicks?: TradeClickRow[] | null }

const ago = (now: number, ts: number | null): string => (ts === null || !ts ? "never" : `${Math.round((now - ts) / 60_000)} min ago`);

export function burntickerCheckinLines(i: CheckinInput): string[] {
  if (!i.snapshot) return [`- burnticker: ${i.why ?? "no registry on this host (data/burnticker.db absent) and BURNTICKER_OPS_URL unset — set it to https://<burnticker host>/ops.json to read the keeper's block from here"}`];
  const s = i.snapshot, now = s.now;
  const live = s.tokens.filter((t) => t.status === "live"), drafts = s.tokens.filter((t) => t.status === "draft"), other = s.tokens.filter((t) => t.status === "paused" || t.status === "retired");
  const out: string[] = [];
  out.push(`- tokens: ${live.length} live${live.length ? ` (${live.map((t) => `$${t.ticker}`).join(", ")})` : ""} · ${drafts.length} draft · ${other.length} paused/retired${s.paused ? " · PAUSE-burnticker PRESENT: cranks held" : ""}`);
  const burns24 = live.reduce((a, t) => a + t.burns24h, 0), spent24 = live.reduce((a, t) => a + t.spent24hLamports, BigInt(0)), burnsAll = s.tokens.reduce((a, t) => a + t.burns, 0);
  out.push(`- burns last 24 h: ${burns24} (${lamportsToSol(spent24)} SOL spent) · all time ${burnsAll}${live.length ? ` · per token: ${live.map((t) => `$${t.ticker} ${t.burns24h}/${t.burns}`).join(", ")}` : ""}`);
  const failed = live.flatMap((t) => t.pending.filter((p) => p.lastError).map((p) => ({ t, p })));
  const pending = live.reduce((a, t) => a + t.pending.length, 0);
  out.push(`- cranks: ${pending} pending · ${failed.length} failing${failed.length ? ` — ${failed.slice(0, 4).map(({ t, p }) => `$${t.ticker} ${p.eventId} ×${Math.max(p.attempts, s.crankStreaks[`${t.mint}:${p.eventId}`] ?? 0)} (${(p.lastError ?? "").slice(0, 60)})`).join("; ")}` : ""}`);
  const queued = live.filter((t) => t.mode === "buyback" && Number(t.queuedSol ?? 0) > 0);
  const pools = live.reduce((a, t) => a + (Number(t.feePdaSol ?? 0) || 0), 0);
  out.push(`- pools: ${pools.toFixed(3)} SOL across ${live.length} fee PDA(s) · queued above the pre-audit cap: ${queued.length ? queued.map((t) => `$${t.ticker} ${t.queuedSol} SOL`).join(", ") : "none"}${live.some((t) => t.feePdaSol === null) ? " · (some pools unpublished: keeper has not written status.json yet)" : ""}`);
  const att = attesterStatusLine(i.firstLaunchAt);
  out.push(`- attesters: ${live.length ? live.map((t) => `$${t.ticker} ${t.attesters.active} active (${t.attesters.independent} independent) quorum 1`).join(", ") : "no live token"} · ${att.line}${att.dueBy ? ` (owner check: a second attester was due by ${att.dueBy})` : ""}`);
  out.push(`- audit badge: ${s.audit ? `${s.audit.ok ? "OK — every recorded receipt recomputes" : `${s.audit.mismatches.length} MISMATCH(ES)`} · ${s.audit.receipts} receipt(s)${typeof (s.audit as { executed?: number }).executed === "number" ? `, ${(s.audit as { executed?: number }).executed} executed on chain` : ""} · ${s.audit.chainChecked ? "source + chain" : "source only"} · ran ${ago(now, Date.parse(s.audit.ranAt))}` : "not run yet (mct-burnticker-audit.timer writes audit.json hourly)"}`);
  const d = i.delta;
  out.push(`- dev fee wallet: ${d?.latest ? `${solStr(d.latest.devFeeLamports)} SOL (sampled ${ago(now, d.latest.at)})` : "no sample (BURNTICKER_RPC_URL + BURNTICKER_FEE_WALLET unset, or the keeper has not sampled yet)"}${d?.deltaLamports !== null && d?.deltaLamports !== undefined ? ` · Δ ${d.deltaLamports >= BigInt(0) ? "+" : "−"}${lamportsToSol(d.deltaLamports < BigInt(0) ? -d.deltaLamports : d.deltaLamports)} SOL since ${new Date(d.anchor!.at).toISOString().slice(0, 16)}Z` : ""}`);
  out.push(`- keeper: last cycle ${s.lastCycle ? ago(now, s.lastCycle.at) : "never recorded"}${s.lastCycle?.errors.length ? ` · errors: ${s.lastCycle.errors.slice(0, 2).join(" | ").slice(0, 160)}` : ""} · key balance ${d?.latest ? `${solStr(d.latest.keeperLamports)} SOL` : "unknown"}`);
  if (i.topUps?.length) out.push(...i.topUps);
  const feeds = [...new Map(live.map((t) => [t.selectorKey, t])).values()];
  if (feeds.length) out.push(`- feeds: ${feeds.map((t) => `${t.selectorKey} ok ${ago(now, t.feed.lastOkAt)}${t.feed.failures ? ` (${t.feed.failures} failing)` : ""}`).join(" · ")}`);
  // F06: the one aggregator (keeper-level conditions + every source's health), the same list ops.json carries
  out.push(...conditionLines(conditionsView(s, i.health ?? null, i.conditionMemory ?? {}, now, signalsOf(i)), now));
  const hb = heartbeatLine(i.heartbeat, now); if (hb) out.push(hb);
  if (i.webhook) out.push(`- alert webhook: ${i.webhook.configured ? `${i.webhook.lastError ? `FAILING (${i.webhook.lastError})` : i.webhook.lastOkAt ? `ok, last delivery ${ago(now, i.webhook.lastOkAt)}` : "configured, nothing delivered yet"}` : i.hostFacts?.pushConfigured ? WEBHOOK_PUSH_ONLY : "not configured (alerts stay on the Burnticker host; set BURNTICKER_ALERT_WEBHOOK)"}`);
  if (i.hostFacts) out.push(...hostFactLines(i.hostFacts, now));
  if (i.alerts === null) out.push(`- bt- alerts last 24 h: unavailable (alert table not readable on this host)`);
  else {
    const al = i.alerts.filter((a) => a.kind.startsWith("bt-"));
    out.push(`- bt- alerts last 24 h: ${al.length}`);
    // OP6-11: Telegram is not configured and `sent` is never set (alerts.ts), so the line drops the old Telegram suffix it printed on every
    // alert; phone pushes go through ntfy and are reported by the push lines
    for (const a of al.slice(0, 12)) out.push(`    ${new Date(a.ts).toISOString().slice(0, 16)}Z [${a.kind}] ${a.text.slice(0, 150)}${a.push ? ` · ${a.push}` : a.seenAt ? "" : " · no push record"}${a.sent ? " · sent to the alert webhook" : ""}`);
  }
  if (i.apiBudget) out.push(...(i.apiBudget.length ? i.apiBudget.map((l) => `- ${l}`) : ["- api budget: no provider read yet today"]));
  return out;
}

/** The block as the keeper publishes it for other hosts (the check-in there, the owner's phone). */
export function buildOpsJson(i: CheckinInput & { now: number; host?: string }): OpsJson {
  const v = conditionsView(i.snapshot, i.health ?? null, i.conditionMemory ?? {}, i.now, signalsOf(i));
  return { schema: OPS_SCHEMA, generatedAt: new Date(i.now).toISOString(), host: i.host ?? "burnticker", lines: burntickerCheckinLines(i), conditions: v.active.map((c) => c.label), conditionDetail: v.active, recovered: v.recovered, webhook: i.webhook ?? null, heartbeat: i.heartbeat ?? null, hostFacts: i.hostFacts ?? null, tradeClicks: i.tradeClicks ?? null };
}
export function publishOps(siteDir: string, ops: OpsJson): void { publishSite(siteDir, { "ops.json": toJson(ops) }); }

/** ops.json from another host, rendered as the block with its age; null when unreachable (the caller prints why). */
export async function fetchOpsLines(url: string, now: number, fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
  try {
    const r = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return [`- burnticker: ${url} answered HTTP ${r.status}`];
    const j = (await r.json()) as OpsJson;
    if (j.schema !== OPS_SCHEMA || !Array.isArray(j.lines)) return [`- burnticker: ${url} is not a burnticker.ops/v1 document`];
    const ageMin = Math.round((now - Date.parse(j.generatedAt)) / 60_000);
    return [`- source: ${url} · generated ${ageMin} min ago${ageMin > 20 ? " · STALE (the keeper publishes every 5 min)" : ""}`, ...j.lines];
  } catch (e) { return [`- burnticker: ${url} unreachable (${(e as Error).message.slice(0, 100)})`]; }
}

/** Gathers the block's inputs on this host: the registry (only if its file exists — never created here), the site dir, the alert table; else the remote ops.json. */
export async function burntickerCheckin(o: { now?: number; registryFile?: string; siteDir?: string; readAlerts?: (() => CheckinAlertRow[]) | null; opsUrl?: string | null; fetchImpl?: typeof fetch } = {}): Promise<string[]> {
  const now = o.now ?? Date.now();
  const file = o.registryFile ?? (process.env.BURNTICKER_DB?.trim() || REGISTRY_FILE);
  const siteDir = o.siteDir ?? (process.env.BURNTICKER_PUBLISH_DIR?.trim() || path.join("data", "burnticker-site"));
  if (!fs.existsSync(file)) {
    const url = o.opsUrl === undefined ? (process.env.BURNTICKER_OPS_URL?.trim() || null) : o.opsUrl;
    if (url) return (await fetchOpsLines(url, now, o.fetchImpl)) ?? burntickerCheckinLines({ snapshot: null, delta: null, alerts: null, firstLaunchAt: null });
    return burntickerCheckinLines({ snapshot: null, delta: null, alerts: null, firstLaunchAt: null });
  }
  let reg: Registry | null = null;
  try {
    reg = openRegistry(file);
    const snapshot = collectSnapshot({ registry: reg, siteDir, now, paused: fs.existsSync(path.join(path.dirname(file), "PAUSE-burnticker")) });
    const launched = reg.tokens("live").map((t) => Date.parse(t.baselineAt)).filter((x) => Number.isFinite(x));
    let alerts: CheckinAlertRow[] | null = null;
    try {
      // The alerts live in this registry's own alerts table (the keeper's local sink); a test may inject its own reader.
      const read = o.readAlerts === undefined ? async () => registryAlertRows(reg!, now) : o.readAlerts;
      alerts = read ? (await read()).filter((a) => a.ts >= now - 86_400_000) : null;
    } catch { alerts = null; }
    let health: FeedHealth[] | null = null;
    try { health = computeFeedHealth(reg, now); } catch { health = null; }
    let topUps: string[] | null = null;
    try { topUps = topUpOpsLines(reg, now); } catch { topUps = null; }
    return burntickerCheckinLines({ snapshot, delta: devFeeDelta(reg, now), alerts, firstLaunchAt: launched.length ? Math.min(...launched) : null, health, conditionMemory: readConditionMemory(reg), topUps });
  } catch (e) {
    return burntickerCheckinLines({ snapshot: null, delta: null, alerts: null, firstLaunchAt: null, why: `registry not readable: ${(e as Error).message.slice(0, 120)}` });
  } finally { try { reg?.close(); } catch { /* closed */ } }
}
