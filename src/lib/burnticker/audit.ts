import { readingMatches, type Registry } from "@/lib/burnticker/registry";
import { buildReceiptsJson } from "@/lib/burnticker/tokenPage";
import { receiptKey } from "@/lib/burnticker/receipt";
import type { BurnProgramClient } from "@/lib/burnticker/program";
import type { AuditSummary } from "@/lib/burnticker/trust";

/**
 * THE AUDIT (2026-10-09): every receipt of every token, recomputed from the recorded readings and the published rule by the SAME code
 * the token page uses (buildReceiptsJson's checks: units, mapping, spend, memo fields, rule hash), plus — with a program client — the
 * memo on chain for every confirmed receipt must equal the memo on the row (program receipts: the memo the program wrote for their
 * reading). Pure apart from the registry reads and the chain reads.
 */
export async function auditRegistry(registry: Registry, o: { program: BurnProgramClient | null; now: number }): Promise<AuditSummary> {
  const mismatches: AuditSummary["mismatches"] = [];
  let receipts = 0;
  const tokens = registry.tokens();
  for (const t of tokens) {
    let locked;
    try { locked = registry.lockedRule(t); } catch (e) { mismatches.push({ ticker: t.ticker, eventId: "-", checks: [`rule text does not re-lock: ${(e as Error).message}`] }); continue; }
    if (locked.sha256 !== t.rulesSha) mismatches.push({ ticker: t.ticker, eventId: "-", checks: [`stored rules_sha ${t.rulesSha} ≠ sha256 of the stored text ${locked.sha256}`] });
    const readings = registry.readings(t.selectorKey, t.baselineAt).filter((r) => readingMatches(locked.rule, r));
    const rows = registry.receipts(t.mint);
    const json = buildReceiptsJson({ token: t, locked, readings, receipts: rows, attesters: registry.attesters(t.mint), state: registry.state(t.mint), feedState: registry.feedState(t.selectorKey), chain: { cluster: t.cluster, programId: o.program?.programId ?? "", supplyRaw: null, feePdaLamports: null, vaultRaw: null }, now: o.now, nextCheckAt: null, implied: null, seriesTitle: null, selectorPending: 0, operator: { can: [], cannot: [], placeholder: true }, pair: null });
    for (const r of json) {
      receipts++;
      const checks = [...r.verify.checks];
      if (o.program && r.status === "confirmed") {
        // Program receipts carry the program's memo ("<TICKER>|<reading date>|…"); the v3 receipt memo is keyed by the event.
        const key = r.execution === "program" && r.memo ? `${r.memo.split("|").slice(0, 2).join("|")}|` : receiptKey(t.ticker, r.eventId);
        const found = await o.program.findReceiptOnChain(t.mint, key);
        if (!found) checks.push("no receipt memo for this event found on chain");
        else if (found.memo !== r.memo) checks.push(`memo on chain ≠ memo on the row (${found.signature.slice(0, 12)}…)`);
        else if (r.signature && found.signature !== r.signature) checks.push(`on-chain signature ${found.signature.slice(0, 12)}… ≠ recorded ${r.signature.slice(0, 12)}…`);
      }
      if (checks.length) mismatches.push({ ticker: t.ticker, eventId: r.eventId, checks });
    }
  }
  return { schema: "burnticker.audit/v1", ranAt: new Date(o.now).toISOString(), tokens: tokens.length, receipts, mismatches, chainChecked: !!o.program, ok: mismatches.length === 0 };
}
