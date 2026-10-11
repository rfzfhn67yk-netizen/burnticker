import fs from "node:fs";
import path from "node:path";
import type { Rpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { LOCK_FEE_BURN_BPS, LOCK_FEE_OPERATOR_BPS, operatorTreasuryFor, type LockFeeClaimFacts } from "@/lib/burnticker/lockFees";

/**
 * THE FEE LEDGER (trust pack, 2026-10-10; /burnticker/fees/ledger, GET /api/burnticker/v1/fees/ledger). Every lamport the developer fee
 * wallet (pinned in config/burnticker/operator.json for the cluster the platform runs on) received or sent, READ FROM CHAIN — the
 * wallet's full signature history, each transaction's pre/post balance for the wallet — grouped by UTC month, next to the expenses the
 * fee pays (config/burnticker/expenses.json; null amounts are placeholders and say so). The wallet blocks are chain reads only; each block on the page names its source.
 *
 * `scripts/burnticker-trustpack.mts fees-ledger` writes the result to <publish dir>/fees-ledger.json (monthly on the keeper host is
 * enough); the API serves that copy while it is under an hour old and otherwise reads the chain itself (cached in memory).
 */

export const EXPENSES_FILE = path.join("config", "burnticker", "expenses.json");
export const FEE_LEDGER_FILE = "fees-ledger.json";

export interface Expense { id: string; label: string; cadence: "monthly" | "yearly" | "one-off"; usd: number | null; placeholder: boolean; todo: string | null; note: string }
export interface Expenses { schema: "burnticker.expenses/v1"; updatedAt: string; note: string; whatTheFeePaysFor: string; items: Expense[] }

export function expensesProblems(j: Partial<Expenses> | null): string[] {
  const out: string[] = [];
  if (!j || j.schema !== "burnticker.expenses/v1") return ["schema must be burnticker.expenses/v1"];
  if (typeof j.whatTheFeePaysFor !== "string" || !/25 bps/.test(j.whatTheFeePaysFor)) out.push("whatTheFeePaysFor must state the 25 bps");
  const ids = new Set<string>();
  for (const e of j.items ?? []) {
    if (ids.has(e.id)) out.push(`duplicate expense ${e.id}`);
    ids.add(e.id);
    if (!["monthly", "yearly", "one-off"].includes(e.cadence)) out.push(`${e.id}: cadence`);
    if (e.usd === null && !e.placeholder) out.push(`${e.id}: a null amount must be marked placeholder`);
    if (e.usd !== null && (typeof e.usd !== "number" || e.usd < 0)) out.push(`${e.id}: usd must be a non-negative number or null`);
    if (e.placeholder && e.usd !== null) out.push(`${e.id}: a placeholder has no amount`);
  }
  if (!ids.has("dexscreener") || !ids.has("hosting") || !ids.has("rpc") || !ids.has("domains")) out.push("hosting, rpc, domains and dexscreener must be listed");
  return out;
}

export function loadExpenses(root = process.cwd()): Expenses {
  const j = JSON.parse(fs.readFileSync(path.join(root, EXPENSES_FILE), "utf8")) as Expenses;
  const bad = expensesProblems(j);
  if (bad.length) throw new Error(`${EXPENSES_FILE}: ${bad.join("; ")}`);
  return j;
}

export interface LedgerEntry { signature: string; slot: number; blockTime: string | null; month: string | null; deltaLamports: string; direction: "in" | "out"; counterparty: string | null; err: boolean }
export interface LedgerMonth { month: string; inLamports: string; outLamports: string; txIn: number; txOut: number }
export interface FeeLedgerDoc {
  schema: "burnticker.fee-ledger/v1"; generatedAt: string; cluster: string; wallet: string | null;
  source: "chain" | "unavailable"; note: string;
  balanceLamports: string | null; totals: { inLamports: string; outLamports: string; transactions: number; complete: boolean };
  months: LedgerMonth[]; entries: LedgerEntry[];
  expenses: Expenses; placeholders: string[];
  /** LP locked forever (2026-10-10): the operator's 20 % of post-graduation LP fees (claim_lock_fees), a second income line. */
  lpFees?: LpFeeLine;
}

/**
 * THE OPERATOR'S LP-FEE LINE (owner decision 2026-10-10: LP locked forever, its fees fund the burn). claim_lock_fees pays 20 % of every
 * coin's locked-LP fees (SOL side) to the operator treasury — the Squads vault compiled into the program, not the developer fee wallet
 * above — and 80 % to the coin's burn pool. The totals are the keeper's recorded claims (each one read from the claim transaction's memo
 * after confirmation; every claim is a public transaction); the treasury's own history is on the explorer.
 */
export interface LpFeeLine {
  title: string; treasury: string | null; treasuryPinned: boolean; split: { burnBps: number; operatorBps: number };
  claims: number; solLamports: string; toOperatorLamports: string; toBurnPoolLamports: string; source: "keeper records" | "none"; note: string;
}
export function lpFeeLine(cluster: string, claims: readonly Pick<LockFeeClaimFacts, "solLamports" | "toBurnPoolLamports" | "toOperatorLamports">[] | null): LpFeeLine {
  const treasury = operatorTreasuryFor(cluster);
  const sum = (k: "solLamports" | "toBurnPoolLamports" | "toOperatorLamports") => (claims ?? []).reduce((a, c) => a + c[k], BigInt(0)).toString();
  return {
    title: "Operator: 20% of post-graduation LP fees",
    treasury, treasuryPinned: !!treasury, split: { burnBps: LOCK_FEE_BURN_BPS, operatorBps: LOCK_FEE_OPERATOR_BPS },
    claims: claims?.length ?? 0, solLamports: sum("solLamports"), toOperatorLamports: sum("toOperatorLamports"), toBurnPoolLamports: sum("toBurnPoolLamports"),
    source: claims ? "keeper records" : "none",
    note: `Every claim_lock_fees pays 20% of the LP fees' SOL side to the operator treasury and 80% to the coin's burn pool (fixed in code; the coin side is burned). This is operator income on top of the 25 bps curve fee above.${treasury ? "" : ` The treasury is not compiled into the ${cluster} program build yet: claims refuse (TreasuryNotPinned) and the fees stay in the lock.`}`,
  };
}

interface SigInfo { signature: string; slot: number; blockTime: number | null; err: unknown }
interface TxJson { slot: number; blockTime: number | null; meta: { err: unknown; preBalances: number[]; postBalances: number[]; loadedAddresses?: { writable: string[]; readonly: string[] } } | null; transaction: { message: { accountKeys: string[] } } }

/** The wallet's whole history from chain (paged getSignaturesForAddress), each transaction's lamport change for the wallet. */
export async function readWalletHistory(rpc: Rpc, wallet: string, o: { maxSignatures?: number } = {}): Promise<{ entries: LedgerEntry[]; complete: boolean; balanceLamports: string | null }> {
  const max = o.maxSignatures ?? 2000;
  const sigs: SigInfo[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await rpc.call<SigInfo[]>("getSignaturesForAddress", [wallet, { limit: 1000, ...(before ? { before } : {}), commitment: "confirmed" }]);
    sigs.push(...page);
    if (page.length < 1000 || sigs.length >= max) break;
    before = page[page.length - 1].signature;
  }
  const entries: LedgerEntry[] = [];
  for (const s of sigs.slice(0, max)) {
    const tx = await rpc.call<TxJson | null>("getTransaction", [s.signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
    if (!tx?.meta) continue;
    const keys = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
    const i = keys.indexOf(wallet);
    if (i < 0) continue;
    const delta = BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]);
    if (delta === BigInt(0)) continue;
    // counterparty: the account whose balance moved most the other way (the payer for income, the recipient for spending)
    let cp: string | null = null, best = BigInt(0);
    keys.forEach((k, j) => { if (j === i || j >= tx.meta!.postBalances.length) return; const d = BigInt(tx.meta!.postBalances[j]) - BigInt(tx.meta!.preBalances[j]); const opp = delta > BigInt(0) ? -d : d; if (opp > best) { best = opp; cp = k; } });
    const bt = tx.blockTime ?? s.blockTime;
    entries.push({ signature: s.signature, slot: tx.slot, blockTime: bt ? new Date(bt * 1000).toISOString() : null, month: bt ? new Date(bt * 1000).toISOString().slice(0, 7) : null, deltaLamports: delta.toString(), direction: delta > BigInt(0) ? "in" : "out", counterparty: cp, err: !!tx.meta.err });
  }
  let balanceLamports: string | null = null;
  try { balanceLamports = String((await rpc.call<{ value: number }>("getBalance", [wallet, { commitment: "confirmed" }])).value); } catch { /* the ledger stands without it */ }
  return { entries: entries.sort((a, b) => a.slot - b.slot), complete: sigs.length < max, balanceLamports };
}

/** Months (UTC) with income and spending, oldest first. Pure. */
export function groupByMonth(entries: LedgerEntry[]): LedgerMonth[] {
  const m = new Map<string, { i: bigint; o: bigint; ti: number; to: number }>();
  for (const e of entries) {
    const k = e.month ?? "unknown";
    const row = m.get(k) ?? { i: BigInt(0), o: BigInt(0), ti: 0, to: 0 };
    const d = BigInt(e.deltaLamports);
    if (d > BigInt(0)) { row.i += d; row.ti++; } else { row.o -= d; row.to++; }
    m.set(k, row);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, r]) => ({ month, inLamports: r.i.toString(), outLamports: r.o.toString(), txIn: r.ti, txOut: r.to }));
}

export function buildFeeLedgerDoc(i: { cluster: string; wallet: string | null; history: Awaited<ReturnType<typeof readWalletHistory>> | null; error?: string | null; expenses: Expenses; now?: number; lpClaims?: readonly Pick<LockFeeClaimFacts, "solLamports" | "toBurnPoolLamports" | "toOperatorLamports">[] | null }): FeeLedgerDoc {
  const lpFees = lpFeeLine(i.cluster, i.lpClaims ?? null);
  const generatedAt = new Date(i.now ?? Date.now()).toISOString();
  const placeholders = i.expenses.items.filter((e) => e.placeholder && e.todo).map((e) => e.todo as string);
  if (!i.wallet || !i.history) {
    return { schema: "burnticker.fee-ledger/v1", generatedAt, cluster: i.cluster, wallet: i.wallet, source: "unavailable", note: i.wallet ? `the chain could not be read: ${i.error ?? "no RPC"}` : `no developer fee wallet is pinned for ${i.cluster} yet (TODO_MAINNET_DEV_FEE_WALLET)`, balanceLamports: null, totals: { inLamports: "0", outLamports: "0", transactions: 0, complete: false }, months: [], entries: [], expenses: i.expenses, placeholders, lpFees };
  }
  const months = groupByMonth(i.history.entries);
  const tin = months.reduce((a, m) => a + BigInt(m.inLamports), BigInt(0)), tout = months.reduce((a, m) => a + BigInt(m.outLamports), BigInt(0));
  return {
    schema: "burnticker.fee-ledger/v1", generatedAt, cluster: i.cluster, wallet: i.wallet, source: "chain",
    note: `${i.history.entries.length} balance-changing transaction(s) of ${i.wallet}, read from the ${i.cluster} RPC${i.history.complete ? " (the whole history)" : " (the most recent 2,000 signatures; older ones are not shown)"}`,
    balanceLamports: i.history.balanceLamports, totals: { inLamports: tin.toString(), outLamports: tout.toString(), transactions: i.history.entries.length, complete: i.history.complete },
    months, entries: i.history.entries, expenses: i.expenses, placeholders, lpFees,
  };
}

export function readPublishedLedger(publishDir: string): FeeLedgerDoc | null {
  const f = path.join(publishDir, FEE_LEDGER_FILE);
  if (!fs.existsSync(f)) return null;
  try { const j = JSON.parse(fs.readFileSync(f, "utf8")) as FeeLedgerDoc; return j.schema === "burnticker.fee-ledger/v1" ? j : null; } catch { return null; }
}
