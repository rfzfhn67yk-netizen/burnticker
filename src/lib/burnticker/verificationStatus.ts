import type { CheckId, ReceiptCheck } from "@/lib/burnticker/trustpack/receiptCheck";

/**
 * VERIFICATION WORDS (website brief 2026-10-11 §3/§5). A receipt check is never one green tick:
 *
 *   status per check   passed · failed · unavailable (a dependency — the RPC or the source — did not answer) · not checked (this
 *                      page does not run that check: no rules file given, a feed other than Treasury, the source not fetched)
 *   three layers       source evidence (what the external source reported) · attestation (the program-owned Reading, which exists only
 *                      after the coin's attester quorum signed it — today one operator key) · execution (what the transaction did,
 *                      recomputed: rule file, units, spend, burn)
 *   verdict            verified (every check passed) · partly verified (none failed, the core passed, some not checked or
 *                      unavailable — the verdict names them) · could not check (a dependency did not answer before the core finished:
 *                      not evidence the receipt is invalid) · failed (a check contradicted the receipt)
 *
 * Skipped checks, missing data or zero receipts never turn into "verified". Pure; the check page and the tests share it.
 */
export type CheckStatus = "passed" | "failed" | "unavailable" | "not checked";
export type Layer = "source" | "attestation" | "execution";

export const LAYER_OF: Record<CheckId, Layer> = { source: "source", reading: "attestation", config: "attestation", tx: "execution", program: "execution", memo: "execution", rules: "execution", units: "execution", spend: "execution", burn: "execution" };
export const LAYER_LABEL: Record<Layer, { title: string; what: string }> = {
  source: { title: "Source evidence", what: "What the external source reported, re-fetched from your browser. A mirror of the source is not an independent measurement." },
  attestation: { title: "Attestation", what: "The Reading account the program wrote after the coin's attester quorum signed it (today one operator key: one signing authority). A signature proves who signed, not that the value is true." },
  execution: { title: "Execution", what: "What the on-chain transaction did, recomputed here: the program, its memo, the locked rule file, the units, the spend and the burn." },
};

/** "unavailable" when the null is a dependency that did not answer; "not checked" when this page does not run the check. */
export function checkStatus(c: Pick<ReceiptCheck, "ok" | "detail">): CheckStatus {
  if (c.ok === true) return "passed";
  if (c.ok === false) return "failed";
  return /did not answer|could not be fetched|did not return|rate-limited|HTTP \d/i.test(c.detail) ? "unavailable" : "not checked";
}

export type Verdict = "verified" | "partly verified" | "could not check" | "failed";
const CORE: CheckId[] = ["tx", "program", "memo", "reading", "units"];

export interface VerdictView { verdict: Verdict; line: string; counts: Record<CheckStatus, number>; layers: { layer: Layer; title: string; what: string; checks: (ReceiptCheck & { status: CheckStatus })[] }[] }

export function verdictOf(checks: readonly ReceiptCheck[]): VerdictView {
  const withStatus = checks.map((c) => ({ ...c, status: checkStatus(c) }));
  const counts: Record<CheckStatus, number> = { passed: 0, failed: 0, unavailable: 0, "not checked": 0 };
  for (const c of withStatus) counts[c.status]++;
  const corePassed = CORE.every((id) => withStatus.find((c) => c.id === id)?.status === "passed");
  let verdict: Verdict, line: string;
  if (counts.failed > 0) { verdict = "failed"; line = `Failed: ${counts.failed} check(s) contradict this receipt.`; }
  else if (!corePassed) { verdict = "could not check"; line = counts.unavailable > 0 ? "Could not check: a dependency (the RPC or the source) did not answer. This is not evidence that the receipt is invalid; try again or use another RPC." : "Could not check: not enough of this receipt could be read here."; }
  else if (counts.unavailable + counts["not checked"] > 0) { verdict = "partly verified"; line = `Partly verified: ${counts.passed} check(s) passed, none failed; ${[counts["not checked"] ? `${counts["not checked"]} not checked` : "", counts.unavailable ? `${counts.unavailable} unavailable` : ""].filter(Boolean).join(", ")}.`; }
  else if (checks.length === 0) { verdict = "could not check"; line = "Could not check: no checks ran."; }
  else { verdict = "verified"; line = `Verified: all ${counts.passed} checks passed.`; }
  const layers = (["source", "attestation", "execution"] as Layer[]).map((layer) => ({ layer, ...LAYER_LABEL[layer], checks: withStatus.filter((c) => LAYER_OF[c.id] === layer) }));
  return { verdict, line, counts, layers };
}

/** A receipt row on a coin or pair page (tokenPage.ts verify: recomputed from the recorded reading and the rule against the memo). */
export function receiptRowStatus(r: { status: string; verify?: { verified: boolean; checks: string[] } | null }): { status: CheckStatus; label: string; title: string } {
  if (!r.verify) return { status: "unavailable", label: "unavailable", title: "this host did not return the recomputation" };
  if (r.verify.checks.length > 0) return { status: "failed", label: "failed", title: r.verify.checks.join("; ") };
  if (r.status === "planned" || r.status === "sending" || r.status === "pending-pair") return { status: "not checked", label: "not checked", title: "nothing executed yet" };
  if (r.verify.verified) return { status: "passed", label: "recomputed", title: "the rule arithmetic and the memo recomputed on this host; the source is re-fetched on /burnticker/check" };
  return { status: "not checked", label: "not checked", title: "not recomputed" };
}
