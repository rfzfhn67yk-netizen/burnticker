import { PublicKey, type Connection } from "@solana/web3.js";
import { PLAN_STORAGE_PREFIX, type ChainReadDeps, type PlanStorage, type StoredLaunch } from "@/lib/burnticker/signPlan";

/**
 * The chain reads every settle uses (launch recovery 255), from one Connection: the status (with history), the block height, the
 * transaction history for the original signature, and whether the accounts a step creates exist. Shared by the card and the notice.
 */
export function chainReadDeps(connection: Pick<Connection, "getSignatureStatuses" | "getBlockHeight" | "getTransaction" | "getMultipleAccountsInfo">): ChainReadDeps {
  return {
    getSignatureStatus: async (sig) => (await connection.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0] ?? null,
    getBlockHeight: () => connection.getBlockHeight("confirmed"),
    getTransaction: async (sig) => { const t = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }); return t ? { err: t.meta?.err ?? null } : null; },
    expectedAccounts: async (mints) => ((await connection.getMultipleAccountsInfo(mints.map((m) => new PublicKey(m)), "confirmed")).some(Boolean) ? "present" : "absent"),
  };
}

/**
 * THE RECOVERY NOTICE'S OWN RULES (launch audit 228, 229, 233, 234, 237; 2026-10-12). The notice (LaunchRecovery.tsx) lists what a
 * signing run left in this tab's storage after a reload; signPlan.ts settles each entry. This module decides what the notice shows and
 * offers next, and keeps the read-only history a new plan leaves behind. Client-safe, no timers, nothing here signs or sends.
 *
 *   action     what an entry's button does: "check" (a step was sent and its outcome is unknown), "record" (every step is confirmed and
 *              the launch is not recorded yet) or "start-new" (the mint keys are gone with the reload and steps are left: checking can
 *              never move it, so the one real next step is a new launch from the review)
 *   finished   a launch the check recorded: its record is removed from storage, but the notice keeps the completion line and a link
 *              to each coin until the page is left
 *   history    what a new plan keeps of the plan it replaces: the coins (ticker and mint) and every signature with its step and state.
 *              Never a key, never the signed transaction bytes. At most HISTORY_MAX entries, newest first.
 */

export type RecoveryAction = "check" | "record" | "start-new";
export function storedLaunchAction(s: StoredLaunch): RecoveryAction {
  if (s.rec.pending) return "check";
  if (s.rec.confirmed.length >= s.rec.steps) return "record";
  return "start-new";
}
export const RECOVERY_BUTTON: Record<RecoveryAction, string> = { check: "Check on chain and record", record: "Record the launch", "start-new": "Start a new launch from the review" };
/** Beside the start-new button: what pressing it keeps and what it does not undo. */
export const START_NEW_LINE = "This notice moves to the list of earlier launches below, with its signatures and mints. Anything already created on chain stays there.";

export const coinHref = (ticker: string): string => `/burnticker/t/${ticker}`;

/** "Last checked at 7:05 PM." — a time of day in the reader's own clock, nothing more. */
export const checkedAtSentence = (ms: number): string => `Last checked at ${new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`;

export interface FinishedLaunch { key: string; text: string; checked: string; coins: { ticker: string; href: string }[] }
export interface RecoveryView { items: StoredLaunch[]; finished: FinishedLaunch[] }
/**
 * The notice after one check (launch audit 228): a finished launch leaves the list of open items (its record is gone) and joins
 * `finished`, with its sentence and a link per coin; an unfinished one shows its new state. `listed` is storage read again after the check.
 */
export function afterRecoveryCheck(prev: RecoveryView, s: StoredLaunch, r: { text: string; done: boolean; rec: StoredLaunch["rec"] }, listed: StoredLaunch[], now: number): RecoveryView {
  if (!r.done) return { items: prev.items.map((x) => (x.key === s.key ? { key: s.key, rec: r.rec } : x)), finished: prev.finished };
  const entry: FinishedLaunch = { key: s.key, text: r.text, checked: checkedAtSentence(now), coins: r.rec.confirms.map((c) => ({ ticker: c.ticker, href: coinHref(c.ticker) })) };
  return { items: listed.filter((x) => x.key !== s.key), finished: [...prev.finished.filter((f) => f.key !== s.key), entry] };
}

/**
 * The sentence when a check throws (launch audit 237). "Nothing changed" only when the stored record is exactly what it was before the
 * check; otherwise part of the check was saved (a landed step adopted, say) and the notice shows that saved state.
 */
export function recoveryErrorSentence(changed: boolean, e: unknown): string {
  const why = String((e as Error)?.message ?? e).slice(0, 100);
  return changed
    ? `The check stopped partway (${why}). What it found before that is saved and shown here. Try again to finish it.`
    : `The chain could not be read just now (${why}). Nothing changed. Try again.`;
}

// ---- the read-only history (launch audit 234) -----------------------------------------------------------------------------------

/** Outside PLAN_STORAGE_PREFIX, so the notice never lists a history entry as a launch to finish. */
export const LAUNCH_HISTORY_KEY = "burnticker.signhistory.v1";
export const HISTORY_MAX = 20;
export interface LaunchHistoryEntry {
  archivedAt: number;
  steps: number;
  coins: { ticker: string; mint: string }[];
  signatures: { step: number; signature: string; state: "confirmed" | "sent" | "failed" }[];
}

const entryOk = (x: unknown): x is LaunchHistoryEntry => {
  const e = x as LaunchHistoryEntry | null;
  return !!e && Number.isFinite(e.archivedAt) && Number.isInteger(e.steps) && Array.isArray(e.coins) && Array.isArray(e.signatures)
    && e.coins.every((c) => c && typeof c.ticker === "string" && typeof c.mint === "string")
    && e.signatures.every((g) => g && Number.isInteger(g.step) && typeof g.signature === "string" && (g.state === "confirmed" || g.state === "sent" || g.state === "failed"));
};
export function readLaunchHistory(storage: PlanStorage | null | undefined): LaunchHistoryEntry[] {
  if (!storage) return [];
  try { const j = JSON.parse(storage.get(LAUNCH_HISTORY_KEY) ?? "[]") as unknown; return Array.isArray(j) ? j.filter(entryOk) : []; } catch { return []; }
}

/**
 * Moves a plan's stored record into the history and removes it (the card's Start a new plan; the notice's start-new). Only named fields
 * are copied, so nothing the record might carry beyond them (the signed transaction bytes) reaches the history. Null when there is no
 * readable record under `key`.
 */
export function archivePlanRecord(storage: PlanStorage | null | undefined, key: string, now = Date.now()): LaunchHistoryEntry | null {
  if (!storage || !key.startsWith(PLAN_STORAGE_PREFIX)) return null;
  let j: { confirmed?: unknown; confirms?: unknown; steps?: unknown; pending?: { step?: unknown; signature?: unknown } | null; failed?: { step?: unknown; signature?: unknown } | null } | null = null;
  try { j = JSON.parse(storage.get(key) ?? "null"); } catch { j = null; }
  try { storage.remove(key); } catch { /* ignore */ }
  if (!j || typeof j !== "object") return null;
  const confirms = Array.isArray(j.confirms) ? (j.confirms as { ticker?: unknown; mint?: unknown }[]).filter((c) => c && typeof c.ticker === "string" && typeof c.mint === "string") : [];
  const signatures: LaunchHistoryEntry["signatures"] = [];
  if (Array.isArray(j.confirmed)) j.confirmed.forEach((sig, step) => { if (typeof sig === "string") signatures.push({ step, signature: sig, state: "confirmed" }); });
  for (const [x, state] of [[j.pending, "sent"], [j.failed, "failed"]] as const) if (x && Number.isInteger(x.step) && typeof x.signature === "string" && !signatures.some((g) => g.signature === x.signature)) signatures.push({ step: x.step as number, signature: x.signature, state });
  const entry: LaunchHistoryEntry = { archivedAt: now, steps: Number.isInteger(j.steps) ? (j.steps as number) : signatures.length, coins: confirms.map((c) => ({ ticker: c.ticker as string, mint: c.mint as string })), signatures };
  const next = [entry, ...readLaunchHistory(storage)].sort((a, b) => b.archivedAt - a.archivedAt).slice(0, HISTORY_MAX);
  try { storage.set(LAUNCH_HISTORY_KEY, JSON.stringify(next)); } catch { /* storage full: the plan is still replaced */ }
  return entry;
}
