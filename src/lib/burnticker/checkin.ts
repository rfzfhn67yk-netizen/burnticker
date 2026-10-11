import fs from "node:fs";
import path from "node:path";
import { openRegistry, REGISTRY_FILE, type Registry } from "@/lib/burnticker/registry";
import { attesterStatusLine } from "@/lib/burnticker/fees";
import { publishSite, toJson } from "@/lib/burnKeeper/statusPage";
import { collectSnapshot, devFeeDelta, evaluateAlerts, lamportsToSol, registryAlertRows, solStr, type BurntickerSnapshot, type WebhookState } from "@/lib/burnticker/alerts";

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

export interface CheckinAlertRow { ts: number; kind: string; text: string; seenAt: number | null; sent: boolean }
export interface CheckinInput { snapshot: BurntickerSnapshot | null; delta: ReturnType<typeof devFeeDelta> | null; alerts: CheckinAlertRow[] | null; firstLaunchAt: number | null; webhook?: WebhookState | null; why?: string }

export const OPS_SCHEMA = "burnticker.ops/v1";
export interface OpsJson { schema: typeof OPS_SCHEMA; generatedAt: string; host: string; lines: string[]; conditions: string[]; webhook: WebhookState | null }

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
  out.push(`- attesters: ${live.length ? live.map((t) => `$${t.ticker} ${t.attesters.active} active (${t.attesters.independent} independent) quorum 1`).join(", ") : "no live token"} · ${att.line}`);
  out.push(`- audit badge: ${s.audit ? `${s.audit.ok ? "OK — every receipt recomputes" : `${s.audit.mismatches.length} MISMATCH(ES)`} · ${s.audit.receipts} receipt(s) · ${s.audit.chainChecked ? "source + chain" : "source only"} · ran ${ago(now, Date.parse(s.audit.ranAt))}` : "not run yet (mct-burnticker-audit.timer writes audit.json hourly)"}`);
  const d = i.delta;
  out.push(`- dev fee wallet: ${d?.latest ? `${solStr(d.latest.devFeeLamports)} SOL (sampled ${ago(now, d.latest.at)})` : "no sample (BURNTICKER_RPC_URL + BURNTICKER_FEE_WALLET unset, or the keeper has not sampled yet)"}${d?.deltaLamports !== null && d?.deltaLamports !== undefined ? ` · Δ ${d.deltaLamports >= BigInt(0) ? "+" : "−"}${lamportsToSol(d.deltaLamports < BigInt(0) ? -d.deltaLamports : d.deltaLamports)} SOL since ${new Date(d.anchor!.at).toISOString().slice(0, 16)}Z` : ""}`);
  out.push(`- keeper: last cycle ${s.lastCycle ? ago(now, s.lastCycle.at) : "never recorded"}${s.lastCycle?.errors.length ? ` · errors: ${s.lastCycle.errors.slice(0, 2).join(" | ").slice(0, 160)}` : ""} · key balance ${d?.latest ? `${solStr(d.latest.keeperLamports)} SOL` : "unknown"}`);
  const feeds = [...new Map(live.map((t) => [t.selectorKey, t])).values()];
  if (feeds.length) out.push(`- feeds: ${feeds.map((t) => `${t.selectorKey} ok ${ago(now, t.feed.lastOkAt)}${t.feed.failures ? ` (${t.feed.failures} failing)` : ""}`).join(" · ")}`);
  const would = evaluateAlerts(s).filter((a) => a.kind !== "bt-daily-summary");
  out.push(`- conditions now: ${would.length ? would.map((a) => a.kind).join(", ") : "none"}`);
  if (i.webhook) out.push(`- alert webhook: ${i.webhook.configured ? `${i.webhook.lastError ? `FAILING (${i.webhook.lastError})` : i.webhook.lastOkAt ? `ok, last delivery ${ago(now, i.webhook.lastOkAt)}` : "configured, nothing delivered yet"}` : "not configured (alerts stay on the Burnticker host; set BURNTICKER_ALERT_WEBHOOK)"}`);
  if (i.alerts === null) out.push(`- bt- alerts last 24 h: unavailable (alert table not readable on this host)`);
  else {
    const al = i.alerts.filter((a) => a.kind.startsWith("bt-"));
    out.push(`- bt- alerts last 24 h: ${al.length}`);
    for (const a of al.slice(0, 12)) out.push(`    ${new Date(a.ts).toISOString().slice(0, 16)}Z [${a.kind}] ${a.text.slice(0, 150)}${a.seenAt ? "" : " · UNSEEN"}${a.sent ? "" : " · not sent to Telegram"}`);
  }
  return out;
}

/** The block as the keeper publishes it for other hosts (the check-in there, the owner's phone). */
export function buildOpsJson(i: CheckinInput & { now: number; host?: string }): OpsJson {
  return { schema: OPS_SCHEMA, generatedAt: new Date(i.now).toISOString(), host: i.host ?? "burnticker", lines: burntickerCheckinLines(i), conditions: i.snapshot ? evaluateAlerts(i.snapshot).filter((a) => a.kind !== "bt-daily-summary").map((a) => a.kind) : [], webhook: i.webhook ?? null };
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
    return burntickerCheckinLines({ snapshot, delta: devFeeDelta(reg, now), alerts, firstLaunchAt: launched.length ? Math.min(...launched) : null });
  } catch (e) {
    return burntickerCheckinLines({ snapshot: null, delta: null, alerts: null, firstLaunchAt: null, why: `registry not readable: ${(e as Error).message.slice(0, 120)}` });
  } finally { try { reg?.close(); } catch { /* closed */ } }
}
