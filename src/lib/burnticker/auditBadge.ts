/**
 * THE PUBLIC-AUDIT BADGE (review 2 §2, 2026-10-11): "all receipts recompute" over ZERO receipts is vacuously true and read as a green trust
 * badge on an empty host. One view for the coins page and the static platform index: zero receipts → a neutral "No receipts available to
 * check on this host"; otherwise the audit's own result. Client-safe.
 */
/** `executed` (prelaunch audit 2026-10-18 A-6): receipts that moved something on chain; absent in documents written before it. */
/** `chainVerified` (review 7 of A-6): confirmed receipts whose memo the chain showed and matched; absent in older documents. */
export interface AuditSummary { ok: boolean; receipts: number; executed?: number; chainVerified?: number; mismatches: number; chainChecked: boolean; ranAt?: string }
export interface AuditBadgeView { text: string; tone: "ok" | "bad" | "muted"; sub: string | null }

export const NO_RECEIPTS_TO_CHECK = "No receipts available to check on this host";
export const NO_BURNS_TO_CHECK = "No completed burns to check yet";

export function auditBadgeView(a: AuditSummary | null | undefined): AuditBadgeView {
  if (!a) return { text: "not run yet", tone: "muted", sub: null };
  const scope = a.chainChecked ? "checked against the source and the chain" : "checked against the source only";
  const receipts = (n: number): string => `${n} ${n === 1 ? "receipt" : "receipts"}`;
  if (a.receipts === 0) return { text: NO_RECEIPTS_TO_CHECK, tone: "muted", sub: `0 receipts, ${scope}` };
  if (!a.ok) return { text: `${a.mismatches} ${a.mismatches === 1 ? "mismatch" : "mismatches"}`, tone: "bad", sub: `${receipts(a.receipts)}, ${scope}` };
  // A-6: the green line counts only receipts that moved something on chain; receipts still waiting are named, never counted as verified
  const done = a.executed ?? a.receipts, waiting = a.receipts - done;
  const waitNote = waiting > 0 ? `; ${waiting} more ${waiting === 1 ? "is" : "are"} waiting to run` : "";
  if (done === 0) return { text: NO_BURNS_TO_CHECK, tone: "muted", sub: `${receipts(a.receipts)} waiting to run, their sums ${scope}` };
  // review 7: "checked on chain" counts only the receipts the chain check verified (a forward or a receipt the chain could not show is not)
  const onChain = a.chainChecked && a.chainVerified !== undefined ? `; ${a.chainVerified} checked on chain` : "";
  return { text: `${done === 1 ? "The one completed receipt recomputes" : `All ${done} completed receipts recompute`}${onChain}`, tone: "ok", sub: `${receipts(done)} ${a.chainChecked ? "checked against the source" : scope}${a.chainChecked && a.chainVerified !== undefined ? `, ${a.chainVerified} of them against the chain too` : ""}${waitNote}` };
}
