import { readingMatches, type Registry } from "@/lib/burnticker/registry";
import { readingsAfterLaunch } from "@/lib/burnticker/launchCut";
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
  let receipts = 0, executed = 0, chainVerified = 0, chainUnchecked = 0;
  // prelaunch audit 2026-10-18 A-6: a chain read that fails is not a mismatch; the summary then says the chain was not checked, and why
  let chainError: string | null = null;
  const tokens = registry.tokens();
  for (const t of tokens) {
    let locked;
    try { locked = registry.lockedRule(t); } catch (e) { mismatches.push({ ticker: t.ticker, eventId: "-", checks: [`rule text does not re-lock: ${(e as Error).message}`] }); continue; }
    if (locked.sha256 !== t.rulesSha) mismatches.push({ ticker: t.ticker, eventId: "-", checks: [`The stored rules hash is ${t.rulesSha}, but the stored rules text hashes to ${locked.sha256}.`] });
    const readings = readingsAfterLaunch(registry, t.selectorKey, t.baselineAt).filter((r) => readingMatches(locked.rule, r));
    const rows = registry.receipts(t.mint);
    const json = buildReceiptsJson({ token: t, locked, readings, receipts: rows, attesters: registry.attesters(t.mint), state: registry.state(t.mint), feedState: registry.feedState(t.selectorKey), chain: { cluster: t.cluster, programId: o.program?.programId ?? "", supplyRaw: null, feePdaLamports: null, vaultRaw: null }, now: o.now, nextCheckAt: null, implied: null, seriesTitle: null, selectorPending: 0, operator: { can: [], cannot: [], placeholder: true }, pair: null });
    for (const r of json) {
      receipts++;
      // A-6: "executed" receipts are the ones that moved something on chain (a burn, or a pair's forward); the badge counts these
      if (r.status === "confirmed" || r.status === "forwarded") executed++;
      const checks = [...r.verify.checks];
      if (o.program && r.status === "confirmed" && !chainError) try {
        // review of A-6 (2026-10-18): a receipt with a signature is checked by reading THAT transaction (one call). A receipt the chain
        // cannot show (no signature and not among the config account's latest signatures, or a transaction the node no longer serves)
        // is "not checked on chain", never a mismatch: only a memo the chain shows that differs, or a failed transaction, is.
        const v = await chainCheck(o.program, t.mint, t.ticker, r);
        if (v.kind === "mismatch") checks.push(v.why);
        else if (v.kind === "verified") chainVerified++;
        else chainUnchecked++;
      } catch (e) { chainError = `The chain could not be read: ${(e as Error).message.slice(0, 160)}`; }
      if (checks.length) mismatches.push({ ticker: t.ticker, eventId: r.eventId, checks });
    }
  }
  return { schema: "burnticker.audit/v1", ranAt: new Date(o.now).toISOString(), tokens: tokens.length, receipts, executed, chainVerified: o.program && !chainError ? chainVerified : 0, chainUnchecked, mismatches, chainChecked: !!o.program && !chainError, chainError, ok: mismatches.length === 0 };
}

/** One confirmed receipt against the chain: verified, a mismatch with its sentence, or not checked (the chain cannot show it). */
export async function chainCheck(program: BurnProgramClient, mint: string, ticker: string, r: { signature: string | null; memo: string | null; execution: string | null; eventId: string }): Promise<{ kind: "verified" } | { kind: "mismatch"; why: string } | { kind: "unchecked"; why: string }> {
  if (r.signature && program.memoOfTransaction) {
    const tx = await program.memoOfTransaction(r.signature);
    if (!tx) return { kind: "unchecked", why: "the node does not serve this transaction" };
    if (tx.failed) return { kind: "mismatch", why: `The recorded transaction ${r.signature.slice(0, 12)}… failed on chain.` };
    if (tx.memo === null) return { kind: "mismatch", why: `The recorded transaction ${r.signature.slice(0, 12)}… carries no burn-program memo.` };
    return tx.memo === r.memo ? { kind: "verified" } : { kind: "mismatch", why: `The memo on chain in ${r.signature.slice(0, 12)}… does not match the memo on the receipt.` };
  }
  // no signature recorded: look among the config account's latest signatures; not found there means not checked
  const key = r.execution === "program" && r.memo ? `${r.memo.split("|").slice(0, 2).join("|")}|` : receiptKey(ticker, r.eventId);
  const found = await program.findReceiptOnChain(mint, key);
  if (!found) return { kind: "unchecked", why: "not among the latest transactions of the coin's config account" };
  return found.memo === r.memo ? { kind: "verified" } : { kind: "mismatch", why: `The memo on chain does not match the memo on the receipt. The chain transaction is ${found.signature.slice(0, 12)}…` };
}
