import { fail, ok, type ApiResult } from "@/lib/burnticker/api/http";
import type { Platform } from "@/lib/burnticker/server";
import { loadTransparency } from "@/lib/burnticker/trust";
import { buildChecklist } from "@/lib/burnticker/trustpack/checklist";
import { sampleReceipts, DEVNET_PROGRAM_ID } from "@/lib/burnticker/trustpack/samples";
import { checkReceiptTx, classifySignatureInput, jsonRpc, PUBLIC_RPC, type Rpc, type SourceFetch } from "@/lib/burnticker/trustpack/receiptCheck";
import { isPubkey, isSignature } from "@/lib/burnticker/trustpack/base58";
import { buildFeeLedgerDoc, loadExpenses, lpFeeLine, readPublishedLedger, readWalletHistory, type FeeLedgerDoc } from "@/lib/burnticker/trustpack/ledger";
import { loadOperator, pinnedDevFeeWallet, placeholders, signedMessageView, type Cluster } from "@/lib/burnticker/trustpack/operator";
import { readNeverBuys } from "@/lib/burnticker/trustpack/neverBuys";
import { NEVER_BUYS_STATUS } from "@/lib/burnticker/trustpack/copy";
import { loadVerifiedBuild } from "@/lib/burnticker/trustpack/verifiedBuild";
import { explorerUrl, rpcUrlFor } from "@/lib/burnticker/networks";
import fs from "node:fs";
import path from "node:path";
import { budgetedFetch } from "@/lib/burnticker/apiBudget";

/**
 * THE TRUST PACK'S API HANDLERS (1.5.0, 2026-10-10): GET /v1/check, /v1/check/receipts, /v1/check/receipts/{signature}, /v1/fees/ledger,
 * /v1/operator, /v1/bounty. Declared in src/lib/burnticker/api/spec.ts like every other route. Everything is read from public files and
 * the chain; the receipt check is the browser's code (receiptCheck.ts) run here for curl users.
 */

/** The cluster whose wallets the pages show: the platform's (localnet reads devnet, the nearest public cluster). */
export const pageCluster = (p: Pick<Platform, "cluster">): Cluster => (p.cluster === "mainnet" ? "mainnet" : "devnet");
/**
 * The RPC the server reads for `cluster`: BURNTICKER_RPC_URL only when it serves the cluster the host reads (BURNTICKER_CLUSTER), else the
 * cluster's public endpoint (read-only calls only). Audit 4 (2026-10-11): the host's devnet RPC used to answer the bounty wallet's MAINNET
 * balance read, so a funded wallet read as 0. One rule for every server read: networks.ts rpcUrlFor.
 */
export const serverRpcUrl = (cluster: Cluster, env: Readonly<Record<string, string | undefined>> = process.env): string => rpcUrlFor(cluster, env);

export const v1Check = (root = process.cwd()): ApiResult => ok(buildChecklist(root));
export const v1CheckReceipts = (root = process.cwd()): ApiResult => ok(sampleReceipts(root));

export async function v1CheckReceipt(signature: string, o: { rpc?: Rpc; fetchSource?: SourceFetch | null; root?: string } = {}): Promise<ApiResult> {
  // QA 11 L8: a plain refusal, before any RPC call
  if (!isSignature(signature)) return fail(400, classifySignatureInput(signature).reason ?? "That is not a Solana transaction signature.", { code: "bad-signature" });
  const samples = sampleReceipts(o.root);
  const s = samples.receipts.find((r) => r.signature === signature);
  const result = await checkReceiptTx({
    signature, cluster: "devnet", programId: DEVNET_PROGRAM_ID, rpc: o.rpc ?? jsonRpc(PUBLIC_RPC.devnet),
    rulesText: s ? samples.rules[s.rulesPath] ?? null : null,
    fetchSource: o.fetchSource === undefined ? budgetedFetch((u: string) => fetch(u, { headers: { accept: "application/json", "user-agent": "burnticker-check/1 (receipt verification)" } })) : o.fetchSource,
  });
  return ok({ ...result, ranOn: "server (the same code the /burnticker/check page runs in your browser)", sample: s ?? null });
}

let ledgerCache: { at: number; key: string; doc: FeeLedgerDoc } | null = null;
export const LEDGER_TTL_MS = 3_600_000;
export function resetLedgerCache(): void { ledgerCache = null; }

export async function v1FeeLedger(p: Pick<Platform, "cluster" | "publishDir"> & Partial<Pick<Platform, "registry">>, o: { rpc?: Rpc; root?: string; now?: number; env?: Readonly<Record<string, string | undefined>> } = {}): Promise<ApiResult> {
  const r = await feeLedgerInner(p, o);
  if (r.status !== 200) return r;
  // LP locked forever (2026-10-10): the operator's LP-fee line is always fresh (the keeper's claim records), whichever copy served the rest.
  let claims = null;
  try { claims = p.registry ? p.registry.lockFeeClaims() : null; } catch { claims = null; }
  return ok({ ...(r.body as Record<string, unknown>), lpFees: lpFeeLine(pageCluster(p), claims) });
}

async function feeLedgerInner(p: Pick<Platform, "cluster" | "publishDir">, o: { rpc?: Rpc; root?: string; now?: number; env?: Readonly<Record<string, string | undefined>> } = {}): Promise<ApiResult> {
  const now = o.now ?? Date.now(), cluster = pageCluster(p);
  const op = loadOperator(o.root), expenses = loadExpenses(o.root);
  const wallet = pinnedDevFeeWallet(op, cluster);
  const published = readPublishedLedger(p.publishDir);
  if (published && published.wallet === wallet && now - Date.parse(published.generatedAt) < LEDGER_TTL_MS) return ok({ ...published, expenses, served: "published copy" });
  const key = `${cluster}:${wallet}`;
  if (ledgerCache && ledgerCache.key === key && now - ledgerCache.at < LEDGER_TTL_MS) return ok({ ...ledgerCache.doc, served: "cache" });
  if (!wallet) return ok({ ...buildFeeLedgerDoc({ cluster, wallet: null, history: null, expenses, now }), served: "none" });
  try {
    const history = await readWalletHistory(o.rpc ?? jsonRpc(serverRpcUrl(cluster, o.env)), wallet);
    const doc = buildFeeLedgerDoc({ cluster, wallet, history, expenses, now });
    ledgerCache = { at: now, key, doc };
    return ok({ ...doc, served: "chain" });
  } catch (e) {
    return ok({ ...(published ?? buildFeeLedgerDoc({ cluster, wallet, history: null, error: (e as Error).message.slice(0, 160), expenses, now })), expenses, served: published ? "published copy (stale: the chain read failed)" : "none" });
  }
}

/** Per network, per program: the deployed bytes recorded in verified-build.json (the operator page's program rows; audit 4 BT-02). */
export function deploymentsOf(root = process.cwd()): Record<Cluster, Record<string, { readAt: string; matchesBuild: boolean } | null>> {
  const vb = loadVerifiedBuild(root), out: Record<Cluster, Record<string, { readAt: string; matchesBuild: boolean } | null>> = { devnet: {}, mainnet: {} };
  for (const p of vb.programs) for (const c of ["devnet", "mainnet"] as Cluster[]) { const d = p.deployed?.[c]; out[c][p.library] = d ? { readAt: d.readAt, matchesBuild: d.matchesBuild } : null; }
  return out;
}

export function v1Operator(p: Pick<Platform, "cluster" | "publishDir">, root = process.cwd()): ApiResult {
  const op = loadOperator(root), cluster = pageCluster(p);
  const nb = readNeverBuys(p.publishDir);
  return ok({
    schema: "burnticker.operator-view/v1", cluster,
    operator: op.operator, links: op.links,
    clusters: op.clusters,
    signedMessage: signedMessageView(op),
    neverBuys: { rule: op.neverBuys.rule, rehearsalNote: op.neverBuys.rehearsalNote, report: nb, line: nb ? nb.line : NEVER_BUYS_STATUS.notRun, status: nb ? nb.status : "not-run" },
    placeholders: placeholders(op),
    wellKnown: "/.well-known/burnticker.json",
    deployments: deploymentsOf(root),
  });
}

export interface BountyReconciliation { fundedLamports: string; paidLamports: string; expectedLamports: string; liveLamports: string | null; differenceLamports: string | null; line: string }
/** Funding in, payouts out, the live balance: a reader can reconcile them; "funded" never stands in for "available" (audit 4 BT-04). */
export function bountyReconciliation(funded: bigint, paid: bigint, live: bigint | null): BountyReconciliation {
  const expected = funded - paid, sol = (l: bigint) => (Number(l) / 1e9).toFixed(4);
  const diff = live === null ? null : live - expected;
  const rec = `The records show ${sol(funded)} SOL funded and ${sol(paid)} SOL paid out, so ${sol(expected)} SOL should remain.`;
  const line = live === null ? `${rec} The live balance could not be read just now, so the amount available now is unknown.`
    : diff === BigInt(0) ? `${rec} The live balance is ${sol(live)} SOL, which agrees.`
    : `${rec} The live balance is ${sol(live)} SOL, an unexplained difference of ${diff! > BigInt(0) ? "+" : "−"}${sol(diff! < BigInt(0) ? -diff! : diff!)} SOL.`;
  return { fundedLamports: String(funded), paidLamports: String(paid), expectedLamports: String(expected), liveLamports: live === null ? null : String(live), differenceLamports: diff === null ? null : String(diff), line };
}

interface FundingEvidence { transactions?: { kind: string; signature: string; lamports: string; blockTime?: string }[] }
function readFundingEvidence(root: string, rel: string | undefined): FundingEvidence | null {
  if (!rel || !/^docs\/burnkeeper\/evidence\//.test(rel)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")) as FundingEvidence; } catch { return null; }
}

export async function v1Bounty(o: { rpc?: Rpc; root?: string; env?: Readonly<Record<string, string | undefined>>; now?: number } = {}): Promise<ApiResult> {
  const root = o.root ?? process.cwd();
  const t = loadTransparency(o.root);
  const b = t.howBuilt.bounty;
  const wallet = b.wallet && isPubkey(b.wallet) ? b.wallet : null;
  let balanceLamports: string | null = null, error: string | null = null;
  const rpcUrl = serverRpcUrl("mainnet", o.env);
  if (wallet) {
    try { balanceLamports = String((await (o.rpc ?? jsonRpc(rpcUrl, fetch, { attempts: 2 })).call<{ value: number }>("getBalance", [wallet, { commitment: "confirmed" }])).value); }
    catch (e) { error = (e as Error).message.slice(0, 160); }
  }
  // the recorded funding (owner statement) and its transaction(s), read from the evidence file (signatures live under docs/burnkeeper/evidence)
  const rf = b.recordedFunding ?? null;
  const ev = readFundingEvidence(root, (rf as { evidence?: string } | null)?.evidence);
  const fundingTxs = (ev?.transactions ?? []).filter((x) => x.kind === "funding" && isSignature(x.signature));
  const recordedFunding = rf ? { ...rf, transaction: rf.transaction ?? fundingTxs[0]?.signature ?? null, transactions: fundingTxs.map((x) => ({ signature: x.signature, lamports: x.lamports, blockTime: x.blockTime ?? null, explorerUrl: explorerUrl("tx", x.signature, "mainnet") })) } : null;
  const reports = b.reports ?? { paid: [], rejected: [], note: "none yet" };
  const fundedLamports = fundingTxs.length ? fundingTxs.reduce((n, x) => n + BigInt(x.lamports), BigInt(0)) : BigInt(Math.round((rf?.sol ?? 0) * 1e9));
  const paidLamports = reports.paid.reduce((n, r) => n + BigInt(Math.round(r.sol * 1e9)), BigInt(0));
  const reconciliation = wallet ? bountyReconciliation(fundedLamports, paidLamports, balanceLamports === null ? null : BigInt(balanceLamports)) : null;
  return ok({ wallet, walletTodo: wallet ? null : (b.walletTodo ?? "TODO_BOUNTY_WALLET"), balanceLamports, balanceReadAt: new Date(o.now ?? Date.now()).toISOString(), balanceNetwork: "mainnet", error, rangeSol: b.rangeSol, fundedFrom: b.fundedFrom, recordedFunding, reconciliation, status: b.status, contact: b.contact, terms: b.termsPath, howReportsArePaid: b.howReportsArePaid ?? null, reports });
}
