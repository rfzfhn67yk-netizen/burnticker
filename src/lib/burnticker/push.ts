import type { Registry } from "@/lib/burnticker/registry";
import { denverDate, denverHour } from "@/lib/burnticker/alerts";

/**
 * PHONE PUSH FOR THE STATES THAT MATTER (polish-1, 2026-10-12; PLATFORM-NEXT-2-BRIEF.md item 8). Every Burnticker alert already lands
 * in the registry's append-only `alerts` table (alerts.ts registryAlertSink, the keeper's direct recordAlert calls, and now the web's pin
 * failures). This module reads that table on the keeper's alert cadence and sends a short push to the owner's phone for five kinds of
 * trouble only, rate-limited, plus one line a day so silence is never ambiguous:
 *
 *   keeper-refused    the keeper threw before its first cycle (scripts/burnticker-keeper.mts records bt-keeper-refused, then pushes)
 *   signer-disagree   a reading is held because the second signer disagreed (multiKeeper.ts cosigner-disagree)
 *   pin-failed        an Arweave upload failed: a launch's metadata (api/handlers.ts bt-pin-failed) or the daily snapshot (bt-snapshot-failed)
 *   crank-refused     a burn run failed three times in a row (alerts.ts bt-crank-failed)
 *   burn-behind       a reading's spend is not fully spent 24 hours after it landed (burn dispersal: dispersalKeeper.ts bt-burn-behind)
 *   api-budget        a provider passed 80% of a process's day budget or was put on hold (apiBudget.ts bt-api-budget)
 *   single-source     measure only: a coin's game settled on TheSportsDB alone after the 12-hour hold, the first time for that coin
 *                     (gameSettle.ts; the keeper records bt-single-source once per coin)
 *   keeper-stale      the public status file is stale for more than two hours: pushed by scripts/ops/keeper-status-check.sh, which runs
 *                     every minute from the publish timer and so still works when the keeper is down (listed here for the runbook)
 *
 * The channel: BURNTICKER_PUSH_URL (any HTTPS endpoint that takes a plain-text POST; the title and priority ride in `Title` and
 * `Priority` headers) and BURNTICKER_PUSH_TOKEN (sent as `Authorization: Bearer …`, never logged). Unset URL: nothing is sent and
 * nothing changes. Rate limit: at most one push per kind per hour and six per hour in all; what is held back is counted and named in
 * the next push and in the daily line. State lives in the registry's status table (`push.state`). A failed send is reported, never
 * thrown: the keeper never stops for its phone.
 */

export type PushKind = "keeper-refused" | "signer-disagree" | "pin-failed" | "crank-refused" | "launch-failed" | "burn-behind" | "api-budget" | "single-source";
export const PUSH_KIND_OF_ALERT: Record<string, PushKind> = {
  "bt-keeper-refused": "keeper-refused",
  "cosigner-disagree": "signer-disagree",
  "bt-pin-failed": "pin-failed",
  "bt-snapshot-failed": "pin-failed",
  "bt-crank-failed": "crank-refused",
  "bt-launch-failed": "launch-failed",
  "bt-burn-behind": "burn-behind",
  "bt-api-budget": "api-budget",
  "bt-single-source": "single-source",
};
export const PUSH_TITLE: Record<PushKind, string> = {
  "keeper-refused": "Burnticker keeper refused to start",
  "signer-disagree": "Burnticker reading held",
  "pin-failed": "Burnticker upload failed",
  "crank-refused": "Burnticker burn run failing",
  "launch-failed": "Burnticker launch failed",
  "burn-behind": "Burnticker burn behind",
  "api-budget": "Burnticker data budget running low",
  "single-source": "Burnticker game settled on one source",
};
export const PUSH_LEAD: Record<PushKind, string> = {
  "keeper-refused": "The keeper stopped before its first cycle. Nothing is read or burned until it starts again.",
  "signer-disagree": "A reading is held because the second signer did not agree with the keeper. Nothing burns for it until someone looks.",
  "pin-failed": "An upload to Arweave failed. A launch that needs it is refused, and a snapshot that needs it is not pinned.",
  "crank-refused": "A burn run has failed three times in a row.",
  "launch-failed": "Someone's launch request failed on the site with a server error, a pin failure or a launch-check refusal. The sentence below is what they saw.",
  "burn-behind": "A reading's burn is not fully spent a day after it landed. The keeper keeps spending the rest in small pieces; the line below says how much is left.",
  "api-budget": "One of the outside services the keeper or the site reads from has used most of its daily allowance, or all of it. When it is all used, reads from that service stop until midnight UTC and start again on their own.",
  "single-source": "A coin's game settled on TheSportsDB alone for the first time. Polymarket had no market for it and no league feed could read it, so its final score had to stand unchanged for 12 hours first. This is a notice only; nothing needs doing.",
};

export const PUSH_PER_KIND_MS = 60 * 60_000;
export const PUSH_MAX_PER_HOUR = 6;
export const PUSH_DAILY_HOUR_DENVER = 8;
export const PUSH_FIRST_RUN_LOOKBACK_MS = 60 * 60_000;
export const PUSH_STATE_KEY = "push.state";

export interface PushMessage { title: string; body: string; priority: "high" | "default" | "low"; kind: PushKind | "daily" }
export interface PushState {
  /** alerts with ts ≤ cursor are done */
  cursor: number;
  lastByKind: Partial<Record<PushKind, number>>;
  /** send times in the last hour (the global cap) and the last day (the daily line) */
  sent: number[];
  /** held back by the rate limit since the last push, per kind; and over the last day */
  held: Partial<Record<PushKind, number>>;
  heldToday: number;
  /** Denver date of the last daily line */
  lastDaily: string | null;
}
export interface PushConfig { url: string; token: string | null }
export interface AlertRowLike { ts: number; kind: string; key: string; text: string }

export function pushConfigFromEnv(env: Readonly<Record<string, string | undefined>>): PushConfig | null {
  const url = (env.BURNTICKER_PUSH_URL ?? "").trim();
  if (!/^https:\/\//.test(url)) return null;
  return { url, token: (env.BURNTICKER_PUSH_TOKEN ?? "").trim() || null };
}

export const emptyPushState = (now: number): PushState => ({ cursor: now - PUSH_FIRST_RUN_LOOKBACK_MS, lastByKind: {}, sent: [], held: {}, heldToday: 0, lastDaily: null });

const heldLine = (held: Partial<Record<PushKind, number>>): string | null => {
  const n = Object.values(held).reduce((a, b) => a + (b ?? 0), 0);
  return n ? `${n === 1 ? "One more alert was" : `${n} more alerts were`} held back by the rate limit. The registry's alerts table has every one.` : null;
};

/**
 * PURE: what to send now, and the state after sending it. `alerts` may hold anything newer than the cursor; unmapped kinds are skipped.
 * The daily line goes out once per Denver day after 08:00 Denver: "all quiet" when nothing was sent or held in the last 24 hours.
 */
export function planPushes(i: { now: number; alerts: readonly AlertRowLike[]; state: PushState | null }): { messages: PushMessage[]; state: PushState } {
  const st: PushState = i.state ? { ...i.state, lastByKind: { ...i.state.lastByKind }, sent: [...i.state.sent], held: { ...i.state.held } } : emptyPushState(i.now);
  const messages: PushMessage[] = [];
  const fresh = [...i.alerts].filter((a) => a.ts > st.cursor).sort((a, b) => a.ts - b.ts);
  const today = denverDate(i.now);
  for (const a of fresh) {
    st.cursor = Math.max(st.cursor, a.ts);
    const kind = PUSH_KIND_OF_ALERT[a.kind];
    if (!kind) continue;
    const lastHour = st.sent.filter((t) => i.now - t < 3_600_000).length;
    const last = st.lastByKind[kind] ?? 0;
    if (i.now - last < PUSH_PER_KIND_MS || lastHour >= PUSH_MAX_PER_HOUR) { st.held[kind] = (st.held[kind] ?? 0) + 1; st.heldToday++; continue; }
    const held = heldLine(st.held);
    messages.push({ kind, title: PUSH_TITLE[kind], priority: "high", body: [PUSH_LEAD[kind], a.text.slice(0, 400), held].filter(Boolean).join("\n\n") });
    st.lastByKind[kind] = i.now; st.sent.push(i.now); st.held = {};
  }
  if (denverHour(i.now) >= PUSH_DAILY_HOUR_DENVER && st.lastDaily !== today) {
    const day = st.sent.filter((t) => i.now - t < 86_400_000).length;
    const body = day === 0 && st.heldToday === 0
      ? "Burnticker is quiet. No alert needed you in the last 24 hours. This line arrives once a day, so a missing one means the keeper is not running."
      : `Burnticker sent ${day === 1 ? "one alert" : `${day} alerts`} to this phone in the last 24 hours${st.heldToday ? `, and held back ${st.heldToday === 1 ? "one more" : `${st.heldToday} more`} under the rate limit` : ""}. This line arrives once a day.`;
    messages.push({ kind: "daily", title: day === 0 && st.heldToday === 0 ? "Burnticker all quiet" : "Burnticker daily line", priority: "low", body });
    st.lastDaily = today; st.heldToday = 0;
  }
  st.sent = st.sent.filter((t) => i.now - t < 86_400_000);
  return { messages, state: st };
}

export interface PushOutcome { ok: boolean; status: number | null; error: string | null }
/** One plain-text POST. The token goes in the Authorization header and nowhere else. */
export async function sendPush(cfg: PushConfig, m: PushMessage, fetchImpl: typeof fetch = fetch): Promise<PushOutcome> {
  try {
    const r = await fetchImpl(cfg.url, { method: "POST", headers: { "content-type": "text/plain; charset=utf-8", title: m.title, priority: m.priority, tags: m.kind, ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}) }, body: m.body, signal: AbortSignal.timeout(10_000) });
    return { ok: r.ok, status: r.status, error: r.ok ? null : `HTTP ${r.status}` };
  } catch (e) { return { ok: false, status: null, error: (e as Error).message.slice(0, 120) }; }
}

export function readPushState(reg: Pick<Registry, "getStatus">): PushState | null {
  try { const raw = reg.getStatus(PUSH_STATE_KEY); return raw ? (JSON.parse(raw) as PushState) : null; } catch { return null; }
}

/**
 * Reads the alerts table, plans, sends, saves. A send that fails is logged and the state still advances (the alert stays in the
 * registry and in the morning check-in; retrying a dead channel every five minutes would only spam it when it comes back).
 */
export async function runPushCheck(o: { registry: Pick<Registry, "getStatus" | "setStatus" | "alertsSince">; env: Readonly<Record<string, string | undefined>>; now: number; fetchImpl?: typeof fetch; log?: (s: string) => void }): Promise<{ configured: boolean; sent: PushMessage[]; failed: { m: PushMessage; error: string | null }[] }> {
  const cfg = pushConfigFromEnv(o.env);
  if (!cfg) return { configured: false, sent: [], failed: [] };
  const prev = readPushState(o.registry);
  const since = prev ? prev.cursor + 1 : o.now - PUSH_FIRST_RUN_LOOKBACK_MS;
  let alerts: AlertRowLike[] = [];
  try { alerts = o.registry.alertsSince(since, 500); } catch { alerts = []; }
  const { messages, state } = planPushes({ now: o.now, alerts, state: prev });
  const sent: PushMessage[] = [], failed: { m: PushMessage; error: string | null }[] = [];
  for (const m of messages) {
    const r = await sendPush(cfg, m, o.fetchImpl);
    if (r.ok) sent.push(m); else { failed.push({ m, error: r.error }); o.log?.(`  [push] ${m.kind} not delivered: ${r.error}`); }
  }
  try { o.registry.setStatus(PUSH_STATE_KEY, state, o.now); } catch (e) { o.log?.(`  [push] state not saved: ${(e as Error).message.slice(0, 120)}`); }
  return { configured: true, sent, failed };
}

/** The keeper's startup refusal: record it, then push it at once (through the same rate limit). Never throws. */
export async function pushKeeperRefused(o: { registry: Pick<Registry, "getStatus" | "setStatus" | "alertsSince" | "recordAlert">; env: Readonly<Record<string, string | undefined>>; now: number; reason: string; fetchImpl?: typeof fetch; log?: (s: string) => void }): Promise<void> {
  try {
    o.registry.recordAlert({ kind: "bt-keeper-refused", key: `bt-keeper-refused:${o.reason.slice(0, 80)}`, text: `The keeper refused to start. The reason given was: ${o.reason.slice(0, 300)}`, meta: null }, o.now);
    await runPushCheck(o);
  } catch (e) { o.log?.(`  [push] refusal not pushed: ${(e as Error).message.slice(0, 120)}`); }
}
