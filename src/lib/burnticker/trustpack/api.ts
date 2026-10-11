import { fail, ok, type ApiResult } from "@/lib/burnticker/api/http";
import type { Platform } from "@/lib/burnticker/server";
import { loadTransparency } from "@/lib/burnticker/trust";
import { buildChecklist } from "@/lib/burnticker/trustpack/checklist";
import { sampleReceipts, DEVNET_PROGRAM_ID } from "@/lib/burnticker/trustpack/samples";
import { checkReceiptTx, jsonRpc, PUBLIC_RPC, type Rpc, type SourceFetch } from "@/lib/burnticker/trustpack/receiptCheck";
import { isPubkey, isSignature } from "@/lib/burnticker/trustpack/base58";
import { buildFeeLedgerDoc, loadExpenses, readPublishedLedger, readWalletHistory, type FeeLedgerDoc } from "@/lib/burnticker/trustpack/ledger";
import { loadOperator, pinnedDevFeeWallet, placeholders, signedMessageView, type Cluster } from "@/lib/burnticker/trustpack/operator";
import { readNeverBuys } from "@/lib/burnticker/trustpack/neverBuys";
import { NEVER_BUYS_STATUS } from "@/lib/burnticker/trustpack/copy";

/**
 * THE TRUST PACK'S API HANDLERS (1.5.0, 2026-10-10): GET /v1/check, /v1/check/receipts, /v1/check/receipts/{signature}, /v1/fees/ledger,
 * /v1/operator, /v1/bounty. Declared in src/lib/burnticker/api/spec.ts like every other route. Everything is read from public files and
 * the chain; the receipt check is the browser's code (receiptCheck.ts) run here for curl users.
 */

/** The cluster whose wallets the pages show: the platform's (localnet reads devnet, the nearest public cluster). */
export const pageCluster = (p: Pick<Platform, "cluster">): Cluster => (p.cluster === "mainnet" ? "mainnet" : "devnet");
/** The RPC the server reads: BURNTICKER_RPC_URL on the host when set, else the cluster's public endpoint (read-only calls only). */
export const serverRpcUrl = (cluster: Cluster, env: Readonly<Record<string, string | undefined>> = process.env): string => (env.BURNTICKER_RPC_URL ?? "").trim() || PUBLIC_RPC[cluster];

export const v1Check = (root = process.cwd()): ApiResult => ok(buildChecklist(root));
export const v1CheckReceipts = (root = process.cwd()): ApiResult => ok(sampleReceipts(root));

export async function v1CheckReceipt(signature: string, o: { rpc?: Rpc; fetchSource?: SourceFetch | null; root?: string } = {}): Promise<ApiResult> {
  if (!isSignature(signature)) return fail(400, "not a transaction signature (base58, 64 bytes)", { code: "bad-signature" });
  const samples = sampleReceipts(o.root);
  const s = samples.receipts.find((r) => r.signature === signature);
  const result = await checkReceiptTx({
    signature, cluster: "devnet", programId: DEVNET_PROGRAM_ID, rpc: o.rpc ?? jsonRpc(PUBLIC_RPC.devnet),
    rulesText: s ? samples.rules[s.rulesPath] ?? null : null,
    fetchSource: o.fetchSource === undefined ? ((u: string) => fetch(u, { headers: { accept: "application/json", "user-agent": "burnticker-check/1 (receipt verification)" } })) : o.fetchSource,
  });
  return ok({ ...result, ranOn: "server (the same code the /burnticker/check page runs in your browser)", sample: s ?? null });
}

let ledgerCache: { at: number; key: string; doc: FeeLedgerDoc } | null = null;
export const LEDGER_TTL_MS = 3_600_000;
export function resetLedgerCache(): void { ledgerCache = null; }

export async function v1FeeLedger(p: Pick<Platform, "cluster" | "publishDir">, o: { rpc?: Rpc; root?: string; now?: number; env?: Readonly<Record<string, string | undefined>> } = {}): Promise<ApiResult> {
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
  });
}

export async function v1Bounty(o: { rpc?: Rpc; root?: string; env?: Readonly<Record<string, string | undefined>> } = {}): Promise<ApiResult> {
  const t = loadTransparency(o.root);
  const b = t.howBuilt.bounty;
  const wallet = b.wallet && isPubkey(b.wallet) ? b.wallet : null;
  let balanceLamports: string | null = null, error: string | null = null;
  if (wallet) {
    try { balanceLamports = String((await (o.rpc ?? jsonRpc(serverRpcUrl("mainnet", o.env))).call<{ value: number }>("getBalance", [wallet, { commitment: "confirmed" }])).value); }
    catch (e) { error = (e as Error).message.slice(0, 160); }
  }
  return ok({ wallet, walletTodo: wallet ? null : (b.walletTodo ?? "TODO_BOUNTY_WALLET"), balanceLamports, error, rangeSol: b.rangeSol, fundedFrom: b.fundedFrom, status: b.status, contact: b.contact, terms: b.termsPath, howReportsArePaid: b.howReportsArePaid ?? null, reports: b.reports ?? { paid: [], rejected: [], note: "none yet" } });
}
