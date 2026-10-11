/**
 * THE PUBLIC-AUDIT BADGE (review 2 §2, 2026-10-11): "all receipts recompute" over ZERO receipts is vacuously true and read as a green trust
 * badge on an empty host. One view for the coins page and the static platform index: zero receipts → a neutral "No receipts available to
 * check on this host"; otherwise the audit's own result. Client-safe.
 */
export interface AuditSummary { ok: boolean; receipts: number; mismatches: number; chainChecked: boolean; ranAt?: string }
export interface AuditBadgeView { text: string; tone: "ok" | "bad" | "muted"; sub: string | null }

export const NO_RECEIPTS_TO_CHECK = "No receipts available to check on this host";

export function auditBadgeView(a: AuditSummary | null | undefined): AuditBadgeView {
  if (!a) return { text: "not run yet", tone: "muted", sub: null };
  const scope = a.chainChecked ? "source + chain" : "source only";
  if (a.receipts === 0) return { text: NO_RECEIPTS_TO_CHECK, tone: "muted", sub: `0 receipts · ${scope}` };
  if (!a.ok) return { text: `${a.mismatches} mismatch(es)`, tone: "bad", sub: `${a.receipts} receipt(s) · ${scope}` };
  return { text: `all ${a.receipts} receipt(s) recompute`, tone: "ok", sub: `${a.receipts} receipt(s) · ${scope}` };
}
