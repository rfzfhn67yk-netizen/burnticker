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
 *   dispersal-receipt a burn dispersal piece's receipt cannot be settled from its own transaction: its memo was not read in three days,
 *                     or it named more than the piece asked for (dispersalKeeper.ts bt-dispersal-receipt; audit F10 review)
 *   api-budget        a provider passed 80% of a process's day budget or was put on hold (apiBudget.ts bt-api-budget)
 *   single-source     measure only: a coin's game settled on TheSportsDB alone after the 12-hour hold, the first time for that coin
 *                     (gameSettle.ts; the keeper records bt-single-source once per coin)
 *   mint-bank-low     the mint key bank has had fewer than BURNTICKER_MINT_BANK_LOW prepared addresses for more than an hour
 *                     (scripts/burnticker-mint-bank.mts records bt-mint-bank-low; launches still work through the browser search)
 *   launch-late       a coin was created on chain after its draft's 24-hour window, so it was not taken live; the alert carries the
 *                     operator command that can (draftReconciler.ts and the confirm route record bt-launch-late once per coin)
 *   synthetic-failed  the nightly synthetic creator (scripts/burnticker-synthetic-creator.mts, mct-burnticker-synth.timer) failed a
 *                     scenario on the devnet instance; one alert per run (bt-synthetic-failed), pushed at once by the script
 *   feed-down         a source failed several reads in a row (ops/feedHealth.ts bt-feed-down; one per selector per Denver day, the
 *                     registry's (key, day) key), so its readings are held (audit 2026-10-16 F-5)
 *   unit-failed       a systemd user unit mct-* failed, or an expected one (mint bank, synthetic creator's timer, backup timer) is not
 *                     running (ops/unitHealth.ts, the keeper's unit check; F-5 / F-9)
 *   backup-failed     the last database backup failed, none finished for 13 hours, or no backup status exists 8 hours after the keeper
 *                     started (ops/unitHealth.ts from data/backups/last-backup.json)
 *   and (second audit 2026-10-18 A-7) the serious kinds that used to stay in the registry only: audit-mismatch, audit-stale,
 *   keeper-balance-low, reading-conflict, reading-implausible, foreign-reading, keeper-takeover, feed-stale, feed-disagree,
 *   derby-withheld, and at low priority cap-binding and pin-orphan (alerts.ts, ops/keeperOps.ts, ops/feedHealth.ts, derby, api)
 *   keeper-stale      the public status file is stale for more than two hours: pushed by scripts/ops/keeper-status-check.sh, which runs
 *                     every minute from the publish timer and so still works when the keeper is down (listed here for the runbook)
 *
 * The channel: BURNTICKER_PUSH_URL (any HTTPS endpoint that takes a plain-text POST; the title and priority ride in `Title` and
 * `Priority` headers) and BURNTICKER_PUSH_TOKEN (sent as `Authorization: Bearer …`, never logged). Unset URL: nothing is sent and
 * nothing changes. Rate limit: at most one push per kind per hour and six per hour in all; what is held back is counted and named in
 * the next push and in the daily line. State lives in the registry's status table (`push.state`). A failed send is reported, never
 * thrown: the keeper never stops for its phone.
 *
 * Delivery (fourth prelaunch audit F11, 2026-10-18): only a push the channel acknowledged counts as sent. A push the channel refused or
 * never answered stays PENDING and does not use up the kind's hourly slot: it is tried again at the next check, then 5, 15 and 60 minutes
 * apart, for up to 24 hours from the first try. One pending alert is sent again as it was; several go out as one digest. The daily line
 * counts acknowledged deliveries only and says how many alerts could not be delivered. The registry still records each alert once per
 * (key, day); the pending list is what keeps a failed delivery from being lost.
 */

export type PushKind = "keeper-refused" | "signer-disagree" | "pin-failed" | "crank-refused" | "launch-failed" | "burn-behind" | "api-budget" | "single-source" | "mint-bank-low" | "synthetic-failed" | "feed-down" | "unit-failed" | "backup-failed" | "backup-offbox" | "launch-late"
  // A-7 (second audit 2026-10-18): serious kinds that were recorded but never pushed
  | "audit-mismatch" | "audit-stale" | "keeper-balance-low" | "reading-conflict" | "reading-implausible" | "foreign-reading" | "keeper-takeover"
  | "feed-stale" | "feed-disagree" | "derby-withheld" | "cap-binding" | "pin-orphan"
  // merged from the main branch
  | "dispersal-receipt";
export const PUSH_KIND_OF_ALERT: Record<string, PushKind> = {
  "bt-keeper-refused": "keeper-refused",
  "cosigner-disagree": "signer-disagree",
  "bt-pin-failed": "pin-failed",
  "bt-snapshot-failed": "pin-failed",
  "bt-crank-failed": "crank-refused",
  "bt-launch-failed": "launch-failed",
  "bt-burn-behind": "burn-behind",
  "bt-dispersal-receipt": "dispersal-receipt",
  "bt-api-budget": "api-budget",
  "bt-single-source": "single-source",
  "bt-mint-bank-low": "mint-bank-low",
  "bt-synthetic-failed": "synthetic-failed",
  // prelaunch audit 2026-10-16 F-5: a source that is down (one alert per selector per Denver day: the registry keys alerts by key and
  // day), a failed or missing systemd unit and a failed or stale backup (ops/unitHealth.ts, the keeper's unit check)
  "bt-feed-down": "feed-down",
  "bt-unit-failed": "unit-failed",
  "bt-backup-failed": "backup-failed",
  // F-7 review: a destination is set but no copy left the box for a day; a low-priority push (PUSH_LOW_PRIORITY)
  "bt-backup-offbox-stale": "backup-offbox",
  // prelaunch audit 2026-10-16 F-3 (block G review M3): a create after its draft window reaches the phone
  "bt-launch-late": "launch-late",
  // prelaunch audit H6 re-review: a coin held because this build cannot check its stored title filter is a burn that is not running
  "rule-filter-unsupported": "crank-refused",
  // A-7 (second audit 2026-10-18): recorded in the registry, and now pushed too
  "bt-audit-mismatch": "audit-mismatch",
  "bt-audit-stale": "audit-stale",
  "bt-keeper-balance-low": "keeper-balance-low",
  "bt-reading-conflict": "reading-conflict",
  "bt-reading-implausible": "reading-implausible",
  "bt-foreign-reading": "foreign-reading",
  "bt-keeper-takeover": "keeper-takeover",
  "bt-feed-stale": "feed-stale",
  "bt-feed-disagree": "feed-disagree",
  "derby-withheld": "derby-withheld",
  "bt-cap-binding": "cap-binding",
  "bt-pin-orphan": "pin-orphan",
};
export const PUSH_TITLE: Record<PushKind, string> = {
  "keeper-refused": "Burnticker keeper refused to start",
  "signer-disagree": "Burnticker reading held",
  "pin-failed": "Burnticker upload failed",
  "crank-refused": "Burnticker burn run failing",
  "launch-failed": "Burnticker launch failed",
  "burn-behind": "Burnticker burn behind",
  "dispersal-receipt": "Burnticker burn piece needs a look",
  "api-budget": "Burnticker data budget running low",
  "single-source": "Burnticker game settled on one source",
  "mint-bank-low": "Burnticker prepared addresses running low",
  "synthetic-failed": "Burnticker test launch failed",
  "feed-down": "Burnticker source down",
  "unit-failed": "Burnticker service failed",
  "backup-failed": "Burnticker backup failed",
  "backup-offbox": "Burnticker backup not copied off the box",
  "launch-late": "Burnticker coin created too late",
  "audit-mismatch": "Burnticker audit found a receipt that does not add up",
  "audit-stale": "Burnticker audit not running",
  "keeper-balance-low": "Burnticker keeper key running low on SOL",
  "reading-conflict": "Burnticker source changed a recorded result",
  "reading-implausible": "Burnticker reading refused",
  "foreign-reading": "Burnticker keeper holding its sends",
  "keeper-takeover": "Burnticker standby keeper took over",
  "feed-stale": "Burnticker source stale",
  "feed-disagree": "Burnticker sources disagree",
  "derby-withheld": "Burnticker Derby result withheld",
  "cap-binding": "Burnticker burn pool above its cap",
  "pin-orphan": "Burnticker upload saved for nothing",
};
/** Kinds pushed at low priority: a note, not trouble that needs someone now. */
export const PUSH_LOW_PRIORITY: ReadonlySet<PushKind> = new Set(["backup-offbox", "cap-binding", "pin-orphan"]);
export const PUSH_LEAD: Record<PushKind, string> = {
  "keeper-refused": "The keeper stopped before its first cycle. Nothing is read or burned until it starts again.",
  "signer-disagree": "A reading is held because the second signer did not agree with the keeper. Nothing burns for it until someone looks.",
  "pin-failed": "An upload to Arweave failed. A launch that needs it is refused, and a snapshot that needs it is not pinned.",
  "crank-refused": "A burn run has failed three times in a row.",
  "launch-failed": "Someone's launch request failed on the site with a server error, a pin failure or a launch-check refusal. The sentence below is what they saw.",
  "burn-behind": "A reading's burn is not fully spent a day after it landed. The keeper keeps spending the rest in small pieces; the line below says how much is left.",
  "dispersal-receipt": "The keeper could not settle how much one small burn piece spent from that piece's own transaction. Either its record could not be read for three days, or it named more than the piece asked for, which the program should never allow. The coin's carried total still matches the chain; only this piece's receipt is in doubt. The line below names the coin and the transaction.",
  "api-budget": "One of the outside services the keeper or the site reads from has used most of its daily allowance, or all of it. When it is all used, reads from that service stop until midnight UTC and start again on their own.",
  "mint-bank-low": "The site has had few prepared coin addresses for more than an hour. Launches still work, but each creator's browser has to find its own address, which takes about a minute. Check that the mint key bank service is running and has its key.",
  "synthetic-failed": "Last night's test creator could not finish every launch on the devnet copy of the site. A real creator may hit the same problem. The lines below name each check that failed and what the page said.",
  "feed-down": "A source the keeper reads has failed several reads in a row. Readings from it are held, and nothing burns on a guess. It starts again by itself when the source answers. The line below names the source.",
  "unit-failed": "A service on the Burnticker host has failed or is not running. The line below names it and says how to read its log.",
  "backup-offbox": "The backups on the host are fine, but none has been copied to the backup destination for a day. A lost disk would lose them. The line below says since when.",
  "backup-failed": "The database backup did not finish, or none has finished for too long. The copies already made are still there. The line below says why.",
  "launch-late": "A coin was created on chain more than 24 hours after its draft was made, so the site did not take it live. It exists and can trade, but no burn runs for it until the operator decides. The line below has the command that takes it live as late.",
  "audit-mismatch": "The hourly public audit recomputed the receipts and at least one does not match what was recorded. Nobody outside can trust that receipt until someone looks. The line below names it.",
  "audit-stale": "The hourly public audit has not run for more than three hours, so nothing is checking the receipts. Check the audit timer and its log.",
  "keeper-balance-low": "The keeper's key holds less than 0.05 SOL. It pays the fees for every burn, so burns stop landing when it runs out. Top it up.",
  "reading-conflict": "A source changed a result the registry had already recorded. The registry refused the new value and the coin is held until someone looks.",
  "reading-implausible": "The keeper refused a reading from a source because it did not make sense (out of bounds, the wrong period, or unreadable). Nothing burns on it. The line below says why.",
  "foreign-reading": "The keeper holds its sends for a coin because another record of the same coin disagrees about what happened. Nothing is sent for it until someone reconciles the two.",
  "keeper-takeover": "The standby keeper took over from the leader. Check why the leader stopped, and make sure only one keeper sends.",
  "feed-stale": "A source has not given a new reading for longer than it should. No new reading means no burn. Check the source by hand.",
  "feed-disagree": "The second source for a feed disagrees with the first. The reading is held back, and nothing burns until the two agree.",
  "derby-withheld": "A Burn Derby or record-close result was withheld because it could not be settled cleanly. The line below says why.",
  "cap-binding": "A burn pool holds more than the pre-audit cap allows. The excess is queued, not spent. This is a notice; nothing is lost.",
  "pin-orphan": "Files were saved on Arweave for a draft that another request registered first. They are not used, and the fee for them is spent.",
  "single-source": "A coin's game settled on TheSportsDB alone for the first time. Polymarket had no market for it and no league feed could read it, so its final score had to stand unchanged for 12 hours first. This is a notice only; nothing needs doing.",
};

export const PUSH_PER_KIND_MS = 60 * 60_000;
export const PUSH_MAX_PER_HOUR = 6;
/**
 * Kinds that need someone at once and so are never held by the six-per-hour cap (review, 2026-10-18); the one-per-kind-per-hour limit
 * still applies to them. After an outage the digest must not crowd them out.
 */
export const PUSH_URGENT: ReadonlySet<PushKind> = new Set(["keeper-refused", "signer-disagree", "audit-mismatch", "keeper-takeover", "foreign-reading"]);
export const PUSH_DAILY_HOUR_DENVER = 8;
export const PUSH_FIRST_RUN_LOOKBACK_MS = 60 * 60_000;
export const PUSH_STATE_KEY = "push.state";
/** Wait before the next try after the 1st, 2nd, 3rd and every later failed try: the next check, then 5, 15 and 60 minutes. */
export const PUSH_RETRY_BACKOFF_MS = [0, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
/** A failed delivery is retried for this long from its first try, then given up (and named in the daily line). */
export const PUSH_RETRY_FOR_MS = 24 * 60 * 60_000;
/** At most this many pending alerts are kept (the oldest beyond it are given up). */
export const PUSH_PENDING_MAX = 20;
export const pushRetryDelay = (attempts: number): number => PUSH_RETRY_BACKOFF_MS[Math.min(Math.max(attempts, 1), PUSH_RETRY_BACKOFF_MS.length) - 1];

export interface PushMessage {
  title: string; body: string; priority: "high" | "default" | "low"; kind: PushKind | "daily" | "digest";
  /** the daily line only: the held-back count it reported, restored if the line is not delivered */
  heldToday?: number;
}
/** A push the channel did not acknowledge, waiting for its next try. */
export interface PendingPush {
  kind: PushKind; title: string; priority: PushMessage["priority"]; body: string;
  /** the alert's own text, for a digest line */
  text: string;
  firstAt: number; attempts: number; nextAt: number;
}
export interface PushState {
  /** alerts with ts ≤ cursor are done */
  cursor: number;
  lastByKind: Partial<Record<PushKind, number>>;
  /** send times in the last hour (the global cap) and the last day (the daily line) */
  sent: number[];
  /** acknowledged ALERTS in the last day, for the daily line (a digest delivers several in one push; absent before 2026-10-18: `sent`) */
  delivered?: number[];
  /** held back by the rate limit since the last push, per kind; and over the last day */
  held: Partial<Record<PushKind, number>>;
  heldToday: number;
  /** Denver date of the last daily line */
  lastDaily: string | null;
  /** F11: pushes the channel did not acknowledge, retried on PUSH_RETRY_BACKOFF_MS (absent in state saved before 2026-10-18) */
  pending?: PendingPush[];
  /** times at which an alert was given up undelivered (the last day), for the daily line */
  undelivered?: number[];
  /** the daily line's own retry: its Denver day, failed tries and the time of the next one */
  dailyRetry?: { day: string; attempts: number; nextAt: number } | null;
}
export interface PushConfig { url: string; token: string | null }
export interface AlertRowLike { ts: number; kind: string; key: string; text: string }

export function pushConfigFromEnv(env: Readonly<Record<string, string | undefined>>): PushConfig | null {
  const url = (env.BURNTICKER_PUSH_URL ?? "").trim();
  if (!/^https:\/\//.test(url)) return null;
  return { url, token: (env.BURNTICKER_PUSH_TOKEN ?? "").trim() || null };
}

export const emptyPushState = (now: number): PushState => ({ cursor: now - PUSH_FIRST_RUN_LOOKBACK_MS, lastByKind: {}, sent: [], held: {}, heldToday: 0, lastDaily: null, pending: [], undelivered: [], dailyRetry: null, delivered: [] });

/** The daily line's sentence about failed deliveries, or null when there were none. */
const failedLine = (failed: number, stillPending: number): string | null => {
  if (!failed) return null;
  const retry = stillPending === 0 ? "" : stillPending === failed ? (failed === 1 ? ", and it is still being retried" : ", and they are still being retried") : `; ${stillPending} of them ${stillPending === 1 ? "is" : "are"} still being retried`;
  return `${failed === 1 ? "One alert" : `${failed} alerts`} could not be delivered${retry}.`;
};

const heldLine = (held: Partial<Record<PushKind, number>>): string | null => {
  const n = Object.values(held).reduce((a, b) => a + (b ?? 0), 0);
  return n ? `${n === 1 ? "One more alert was" : `${n} more alerts were`} held back by the rate limit. The registry's alerts table has every one.` : null;
};

/**
 * PURE: what to send now, and the state after sending it. `alerts` may hold anything newer than the cursor; unmapped kinds are skipped.
 * The daily line goes out once per Denver day after 08:00 Denver: "all quiet" when nothing was sent or held in the last 24 hours.
 */
export function planPushes(i: { now: number; alerts: readonly AlertRowLike[]; state: PushState | null }): { messages: PushMessage[]; state: PushState } {
  const st: PushState = i.state ? { ...i.state, lastByKind: { ...i.state.lastByKind }, sent: [...i.state.sent], held: { ...i.state.held }, pending: [...(i.state.pending ?? [])], undelivered: [...(i.state.undelivered ?? [])], delivered: [...(i.state.delivered ?? i.state.sent)] } : emptyPushState(i.now);
  const messages: PushMessage[] = [];
  const fresh = [...i.alerts].filter((a) => a.ts > st.cursor).sort((a, b) => a.ts - b.ts);
  const today = denverDate(i.now);
  for (const a of fresh) {
    st.cursor = Math.max(st.cursor, a.ts);
    const kind = PUSH_KIND_OF_ALERT[a.kind];
    if (!kind) continue;
    const lastHour = st.sent.filter((t) => i.now - t < 3_600_000).length;
    const last = st.lastByKind[kind] ?? 0;
    if (i.now - last < PUSH_PER_KIND_MS || (lastHour >= PUSH_MAX_PER_HOUR && !PUSH_URGENT.has(kind))) { st.held[kind] = (st.held[kind] ?? 0) + 1; st.heldToday++; continue; }
    const held = heldLine(st.held);
    messages.push({ kind, title: PUSH_TITLE[kind], priority: PUSH_LOW_PRIORITY.has(kind) ? "low" : "high", body: [PUSH_LEAD[kind], a.text.slice(0, 400), held].filter(Boolean).join("\n\n") });
    st.lastByKind[kind] = i.now; st.sent.push(i.now); st.delivered!.push(i.now); st.held = {};
  }
  const dailyWaiting = !!st.dailyRetry && st.dailyRetry.day === today && i.now < st.dailyRetry.nextAt;
  if (denverHour(i.now) >= PUSH_DAILY_HOUR_DENVER && st.lastDaily !== today && !dailyWaiting) {
    // `delivered` holds acknowledged alerts only (runPushCheck takes a failed one back out; a digest adds each alert it carried)
    const day = st.delivered!.filter((t) => i.now - t < 86_400_000).length;
    const stillPending = st.pending?.length ?? 0;
    const failed = (st.undelivered ?? []).filter((t) => i.now - t < 86_400_000).length + stillPending;
    const quiet = day === 0 && st.heldToday === 0 && failed === 0;
    const body = quiet
      ? "Burnticker is quiet. No alert needed you in the last 24 hours. This line arrives once a day, so a missing one means the keeper is not running."
      : [`Burnticker sent ${day === 0 ? "no alerts" : day === 1 ? "one alert" : `${day} alerts`} to this phone in the last 24 hours${st.heldToday ? `, and held back ${st.heldToday === 1 ? "one more" : `${st.heldToday} more`} under the rate limit` : ""}.`, failedLine(failed, stillPending), "This line arrives once a day."].filter(Boolean).join(" ");
    messages.push({ kind: "daily", title: quiet ? "Burnticker all quiet" : "Burnticker daily line", priority: "low", body, heldToday: st.heldToday });
    st.lastDaily = today; st.heldToday = 0;
  }
  st.sent = st.sent.filter((t) => i.now - t < 86_400_000);
  st.delivered = st.delivered!.filter((t) => i.now - t < 86_400_000);
  st.undelivered = (st.undelivered ?? []).filter((t) => i.now - t < 86_400_000);
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

/** The message that retries what is pending: the one alert as it was, or one digest naming each. */
export function retryMessage(pending: readonly PendingPush[]): PushMessage {
  if (pending.length === 1) {
    const p = pending[0];
    return { kind: p.kind, title: p.title, priority: p.priority, body: `${p.body}\n\nThis alert could not be delivered at first. This is another try.` };
  }
  const lines = pending.slice(0, 8).map((p) => `${p.title}: ${p.text.slice(0, 160)}`);
  const more = pending.length > 8 ? [`${pending.length - 8} more are in the registry's alerts table.`] : [];
  return {
    kind: "digest", title: "Burnticker alerts not delivered earlier", priority: pending.some((p) => p.priority === "high") ? "high" : "low",
    body: [`${pending.length} alerts could not be delivered when they were raised. Each one is below, and the registry's alerts table has them in full.`, ...lines, ...more].join("\n\n"),
  };
}

/**
 * Reads the alerts table, plans, sends, saves. Only an acknowledged push counts as sent. A push the channel refused stays pending and
 * is retried on PUSH_RETRY_BACKOFF_MS for up to PUSH_RETRY_FOR_MS (F11), so a channel outage neither loses the alert nor spams the phone
 * when the channel comes back: what is pending goes out as one push per try, inside the six-per-hour cap.
 */
export async function runPushCheck(o: { registry: Pick<Registry, "getStatus" | "setStatus" | "alertsSince">; env: Readonly<Record<string, string | undefined>>; now: number; fetchImpl?: typeof fetch; log?: (s: string) => void }): Promise<{ configured: boolean; sent: PushMessage[]; failed: { m: PushMessage; error: string | null }[] }> {
  const cfg = pushConfigFromEnv(o.env);
  if (!cfg) return { configured: false, sent: [], failed: [] };
  const prev = readPushState(o.registry);
  const sent: PushMessage[] = [], failed: { m: PushMessage; error: string | null }[] = [];
  const fail = (m: PushMessage, error: string | null) => { failed.push({ m, error }); o.log?.(`  [push] ${m.kind} not delivered: ${error}`); };

  // 1. what is pending from earlier checks: give up what is past its 24 hours, then retry what is due (one push in all)
  const base: PushState | null = prev ? { ...prev, sent: [...prev.sent], lastByKind: { ...prev.lastByKind }, pending: [...(prev.pending ?? [])], undelivered: [...(prev.undelivered ?? [])], delivered: [...(prev.delivered ?? prev.sent)] } : null;
  if (base) {
    const keep: PendingPush[] = [];
    for (const p of base.pending ?? []) {
      if (o.now - p.firstAt >= PUSH_RETRY_FOR_MS) { base.undelivered!.push(o.now); o.log?.(`  [push] ${p.kind} given up undelivered after 24 hours`); } else keep.push(p);
    }
    base.pending = keep;
    const lastHour = base.sent.filter((t) => o.now - t < 3_600_000).length;
    if (keep.length && keep.some((p) => o.now >= p.nextAt) && (lastHour < PUSH_MAX_PER_HOUR || keep.some((p) => PUSH_URGENT.has(p.kind)))) {
      const m = retryMessage(keep);
      const r = await sendPush(cfg, m, o.fetchImpl);
      if (r.ok) {
        sent.push(m);
        // review (2026-10-18): one push against the hourly cap, however many alerts it carried; a digest never takes a kind's hourly
        // slot for the kinds it only summarised (a new alert of that kind is pushed on its own); a single retry is that alert itself
        base.sent.push(o.now);
        for (const _p of keep) base.delivered!.push(o.now);
        if (keep.length === 1) base.lastByKind[keep[0].kind] = o.now;
        base.pending = [];
      } else {
        fail(m, r.error);
        base.pending = keep.map((p) => ({ ...p, attempts: p.attempts + 1, nextAt: o.now + pushRetryDelay(p.attempts + 1) }));
      }
    }
  }

  // 2. what is new since the cursor (the cursor always advances: a failed alert lives on in `pending`, not in a re-read)
  const since = base ? base.cursor + 1 : o.now - PUSH_FIRST_RUN_LOOKBACK_MS;
  let alerts: AlertRowLike[] = [];
  try { alerts = o.registry.alertsSince(since, 500); } catch { alerts = []; }
  // the planner pushes the first alert of a kind in a check (the rest wait on the kind's hourly slot): its text, for a digest line
  const textOf = new Map<PushKind, string>();
  for (const a of [...alerts].sort((x, y) => x.ts - y.ts)) { const k = PUSH_KIND_OF_ALERT[a.kind]; if (k && !textOf.has(k)) textOf.set(k, a.text); }
  const { messages, state } = planPushes({ now: o.now, alerts, state: base });
  const today = denverDate(o.now);
  for (const m of messages) {
    const r = await sendPush(cfg, m, o.fetchImpl);
    if (r.ok) {
      sent.push(m);
      if (m.kind === "daily") state.dailyRetry = null;
      continue;
    }
    fail(m, r.error);
    if (m.kind === "daily") {
      // not delivered: the day's line is still owed, with its held count, on the same backoff
      const attempts = (state.dailyRetry?.day === today ? state.dailyRetry.attempts : 0) + 1;
      state.lastDaily = base?.lastDaily ?? null; state.heldToday += m.heldToday ?? 0;
      state.dailyRetry = { day: today, attempts, nextAt: o.now + pushRetryDelay(attempts) };
      continue;
    }
    if (m.kind === "digest") continue;
    // take the planner's delivery bookkeeping back out: a failed try is not a send and does not use the kind's hourly slot
    const at = state.sent.lastIndexOf(o.now); if (at >= 0) state.sent.splice(at, 1);
    const dat = state.delivered?.lastIndexOf(o.now) ?? -1; if (dat >= 0) state.delivered!.splice(dat, 1);
    const before = base?.lastByKind[m.kind];
    if (before === undefined) delete state.lastByKind[m.kind]; else state.lastByKind[m.kind] = before;
    state.pending = [...(state.pending ?? []), { kind: m.kind, title: m.title, priority: m.priority, body: m.body, text: textOf.get(m.kind) ?? "", firstAt: o.now, attempts: 1, nextAt: o.now + pushRetryDelay(1) }];
  }
  if ((state.pending?.length ?? 0) > PUSH_PENDING_MAX) {
    const drop = state.pending!.length - PUSH_PENDING_MAX;
    state.undelivered = [...(state.undelivered ?? []), ...Array.from({ length: drop }, () => o.now)];
    state.pending = state.pending!.slice(drop);
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

/** The synthetic creator's one alert per run: record it, then push it at once (through the same rate limit). Never throws. */
export async function pushSyntheticFailed(o: { registry: Pick<Registry, "getStatus" | "setStatus" | "alertsSince" | "recordAlert">; env: Readonly<Record<string, string | undefined>>; now: number; runId: string; failures: readonly { scenario: string; sentence: string }[]; fetchImpl?: typeof fetch; log?: (s: string) => void }): Promise<{ delivered: boolean; why: string }> {
  try {
    const lines = o.failures.slice(0, 6).map((f) => `${f.scenario}: ${f.sentence.slice(0, 160)}`);
    const more = o.failures.length > 6 ? [`${o.failures.length - 6} more failed. The run's report has every one.`] : [];
    o.registry.recordAlert({ kind: "bt-synthetic-failed", key: `bt-synthetic-failed:${o.runId}`, text: [`${o.failures.length === 1 ? "One check" : `${o.failures.length} checks`} failed.`, ...lines, ...more].join("\n"), meta: { runId: o.runId } }, o.now);
    // 2026-10-18 review: the synthetic creator exits 0 for failed scenarios only when this push actually went out
    const r = await runPushCheck(o);
    if (!r.configured) return { delivered: false, why: "the push channel is not configured" };
    if (r.sent.some((m) => m.kind === "synthetic-failed")) return { delivered: true, why: "the push was delivered" };
    if (r.failed.some((f) => f.m.kind === "synthetic-failed")) return { delivered: false, why: "the push could not be delivered" };
    return { delivered: false, why: "the push was held (rate limit)" };
  } catch (e) { o.log?.(`  [push] synthetic failure not pushed: ${(e as Error).message.slice(0, 120)}`); return { delivered: false, why: "the push failed with an error" }; }
}
