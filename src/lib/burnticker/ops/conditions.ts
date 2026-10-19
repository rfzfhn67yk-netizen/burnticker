import { evaluateAlerts, type BurntickerSnapshot } from "@/lib/burnticker/alerts";
import { FEED_DOWN_FAILURES, type FeedHealth } from "@/lib/burnticker/ops/feedHealth";
import type { BudgetLine } from "@/lib/burnticker/apiBudget";

/**
 * THE ACTIVE-CONDITION AGGREGATOR (third prelaunch audit F06, 2026-10-16). ONE answer to "what is wrong right now", shared by ops.json
 * (`conditions`, read by the check-in on another host and the owner's phone) and the human check-in block on the Burnticker host.
 *
 * Before this, both read only the keeper-level alert evaluation (alerts.ts evaluateAlerts), whose feed check is the older STALL test —
 * "no fetch ATTEMPT for 2× the cadence". A source that fails on every attempt is attempted on schedule, so it never stalls: five sports
 * selectors with 20–21 failures in a row were published as `conditions: []`. The newer per-source health (ops/feedHealth.ts: down /
 * stale / disagree / withheld) was computed for status.json and the alerts but left out of the summary. Now:
 *
 *   keeper conditions   evaluateAlerts(snapshot) without the daily summary line (stall, crank failures, audit, balance, cap, keeper)
 *   feed conditions     one per source from computeFeedHealth: down (≥ FEED_DOWN_FAILURES failed reads in a row, the alert's own
 *                       threshold), stale, disagree, withheld (a reading held back; shown, never alerted)
 *   ops conditions      (second audit 2026-10-18 A-7) the keeper's unit check (a failed or stopped unit, a failed or missing backup, no
 *                       off-box copy), each provider ON HOLD in the request budget, and a keeper refusal newer than its last cycle,
 *                       so ops.json never says "conditions now: none" while a unit is failed or a budget is on hold
 *   recovered           a condition that was active at the keeper's last fold and is not now, kept for RECOVERED_SHOW_MS
 *
 * Pure: `activeConditions` and `foldConditions` read nothing and send nothing. NOTIFICATION DEDUPE IS NOT HERE: the keeper's alert sink
 * still decides what is messaged (once per key per Denver day, registryAlertSink); this module only says what is true now. The fold's
 * memory lives in the registry's status table (CONDITIONS_KEY), written by the keeper's 5-minute ops check and only read by the check-in.
 */

export type ConditionSource = "keeper" | "feed" | "ops";
export interface ActiveCondition {
  /** A stable id: the kind, plus the source for a feed condition (`bt-feed-down:nba.games`) — what "recovered" is tracked by. */
  id: string;
  kind: string;
  /** What the summary prints: the kind, with the selector in brackets for a feed condition. */
  label: string;
  source: ConditionSource;
  text: string;
}
export interface ConditionRecord { id: string; kind: string; label: string; since: number; lastSeenAt: number; clearedAt: number | null }
export const CONDITIONS_KEY = "ops.conditions";
export const RECOVERED_SHOW_MS = 24 * 3_600_000;
const FORGET_MS = 7 * 24 * 3_600_000;

const FEED_KIND: Partial<Record<FeedHealth["state"], string>> = { down: "bt-feed-down", stale: "bt-feed-stale", disagree: "bt-feed-disagree", withheld: "bt-feed-withheld" };

/** The host signals beyond the keeper snapshot and feed health (A-7). Each one absent = not known on this host (nothing is said). */
export interface OpsSignals {
  /** every alert the keeper's unit check computed this cycle (ops/unitHealth.ts runUnitCheck `active`), raised again today or not */
  units?: readonly { kind: string; key: string; text: string }[] | null;
  /** the request budget's lines (apiBudget.ts ApiBudget.lines()); a provider in state "hold" is a condition */
  budget?: readonly Pick<BudgetLine, "source" | "label" | "state" | "used" | "budget">[] | null;
  /** the alert rows of the last day and the keeper's last cycle: a bt-keeper-refused newer than the last cycle is a condition */
  alerts?: readonly { ts: number; kind: string; text: string }[] | null;
  lastCycleAt?: number | null;
}

/** PURE: the conditions from the host signals (A-7). */
export function opsConditions(sig: OpsSignals | null | undefined): ActiveCondition[] {
  const out: ActiveCondition[] = [];
  for (const u of sig?.units ?? []) {
    const what = u.kind === "bt-unit-failed" ? u.key.slice("bt-unit-failed:".length) : "";
    out.push({ id: u.kind === "bt-unit-failed" ? u.key : u.kind, kind: u.kind, label: what ? `${u.kind}(${what})` : u.kind, source: "ops", text: u.text });
  }
  for (const b of sig?.budget ?? []) {
    if (b.state !== "hold") continue;
    out.push({ id: `bt-api-budget-hold:${b.source}`, kind: "bt-api-budget-hold", label: `bt-api-budget-hold(${b.source})`, source: "ops", text: `${b.label} is on hold: today's budget is spent (${b.used} of ${b.budget}). Its reads wait until midnight UTC.` });
  }
  const refused = (sig?.alerts ?? []).filter((a) => a.kind === "bt-keeper-refused" && a.ts > (sig?.lastCycleAt ?? 0)).sort((a, b) => b.ts - a.ts)[0];
  if (refused) out.push({ id: "bt-keeper-refused", kind: "bt-keeper-refused", label: "bt-keeper-refused", source: "ops", text: refused.text });
  return out;
}

/** PURE: every condition true now. `health` null = not computed on this host (the keeper-level conditions still count). */
export function activeConditions(snapshot: BurntickerSnapshot | null, health: readonly FeedHealth[] | null, signals?: OpsSignals | null): ActiveCondition[] {
  const out: ActiveCondition[] = [];
  const seen = new Set<string>();
  const add = (c: ActiveCondition) => { if (!seen.has(c.id)) { seen.add(c.id); out.push(c); } };
  if (snapshot) {
    for (const a of evaluateAlerts(snapshot)) {
      if (a.kind === "bt-daily-summary") continue;
      // a stall and (HB-29) an overdue read are per selector: the label names it, the text names the coin, the due time and why
      const perKey = a.kind === "bt-feed-stall" || a.kind === "bt-feed-overdue";
      add({ id: perKey ? a.key : a.kind, kind: a.kind, label: perKey ? `${a.kind}(${a.key.slice(a.kind.length + 1)})` : a.kind, source: "keeper", text: a.text });
    }
  }
  for (const h of health ?? []) {
    const kind = FEED_KIND[h.state];
    if (!kind || (h.state === "down" && h.failures < FEED_DOWN_FAILURES)) continue;
    const who = `${h.selectorKey} (${h.tickers.map((t) => `$${t}`).join(", ")})`;
    const head = h.state === "down" ? `${h.failures} failed reads in a row` : h.state;
    add({ id: `${kind}:${h.selectorKey}`, kind, label: `${kind}(${h.selectorKey})`, source: "feed", text: `${who}: ${head}. ${h.why}` });
  }
  for (const c of opsConditions(signals)) add(c);
  return out;
}

/** PURE: the memory after this look — active ids refreshed (since kept), the others marked cleared once, very old clears forgotten. */
export function foldConditions(prev: Readonly<Record<string, ConditionRecord>>, active: readonly ActiveCondition[], now: number): Record<string, ConditionRecord> {
  const next: Record<string, ConditionRecord> = {};
  const ids = new Set(active.map((c) => c.id));
  for (const c of active) {
    const p = prev[c.id];
    next[c.id] = { id: c.id, kind: c.kind, label: c.label, since: p && p.clearedAt === null ? p.since : now, lastSeenAt: now, clearedAt: null };
  }
  for (const [id, p] of Object.entries(prev)) {
    if (ids.has(id)) continue;
    const clearedAt = p.clearedAt ?? now;
    if (now - clearedAt <= FORGET_MS) next[id] = { ...p, clearedAt };
  }
  return next;
}

/** PURE: what was active at the last fold and is not now, cleared within RECOVERED_SHOW_MS (newest first). */
export function recoveredConditions(memory: Readonly<Record<string, ConditionRecord>>, active: readonly ActiveCondition[], now: number): ConditionRecord[] {
  const ids = new Set(active.map((c) => c.id));
  return Object.values(memory)
    .filter((r) => !ids.has(r.id) && (r.clearedAt === null || now - r.clearedAt <= RECOVERED_SHOW_MS))
    .map((r) => ({ ...r, clearedAt: r.clearedAt ?? now }))
    .sort((a, b) => (b.clearedAt ?? 0) - (a.clearedAt ?? 0));
}

export function readConditionMemory(reg: { getStatus(key: string): string | null }): Record<string, ConditionRecord> {
  try { const s = reg.getStatus(CONDITIONS_KEY); return s ? (JSON.parse(s) as Record<string, ConditionRecord>) : {}; } catch { return {}; }
}

/** The one view both outputs print: the active conditions and the recovered ones. */
export interface ConditionsView { active: ActiveCondition[]; recovered: ConditionRecord[] }
export function conditionsView(snapshot: BurntickerSnapshot | null, health: readonly FeedHealth[] | null, memory: Readonly<Record<string, ConditionRecord>>, now: number, signals?: OpsSignals | null): ConditionsView {
  const active = activeConditions(snapshot, health, signals);
  return { active, recovered: recoveredConditions(memory, active, now) };
}

/** The two check-in lines (the same on the host and in ops.json). */
export function conditionLines(v: ConditionsView, now: number): string[] {
  const ago = (t: number) => `${Math.max(0, Math.round((now - t) / 60_000))} min ago`;
  const out = [`- conditions now: ${v.active.length ? v.active.map((c) => c.label).join(", ") : "none"}`];
  for (const c of v.active.filter((x) => x.source === "feed" || x.source === "ops")) out.push(`    ${c.label}: ${c.text.slice(0, 200)}`);
  if (v.recovered.length) out.push(`- recovered (last 24 h): ${v.recovered.map((r) => `${r.label} cleared ${ago(r.clearedAt!)}`).join(", ")}`);
  return out;
}
