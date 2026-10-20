import { fail, ok, type ApiResult } from "@/lib/burnticker/api/http";
import type { Platform } from "@/lib/burnticker/server";
import { loadTransparency } from "@/lib/burnticker/trust";
import { buildChecklist } from "@/lib/burnticker/trustpack/checklist";
import { publicSample, publicSampleReceipts, sampleReceipts, DEVNET_PROGRAM_ID } from "@/lib/burnticker/trustpack/samples";
import { checkReceiptTx, classifySignatureInput, jsonRpc, PUBLIC_RPC, type ReceiptCheck, type Rpc, type SourceFetch } from "@/lib/burnticker/trustpack/receiptCheck";
import { verdictOf, type Verdict } from "@/lib/burnticker/verificationStatus";
import { isPubkey, isSignature } from "@/lib/burnticker/trustpack/base58";
import { buildFeeLedgerDoc, loadExpenses, lpFeeLine, publicExpenses, readPublishedLedger, readWalletHistory, type FeeLedgerDoc } from "@/lib/burnticker/trustpack/ledger";
import { loadOperator, pinnedDevFeeWallet, publicPlaceholders, signedMessageView, withoutPlaceholders, type Cluster } from "@/lib/burnticker/trustpack/operator";
import { neverBuysScopeLine, readNeverBuys, type NeverBuysReport } from "@/lib/burnticker/trustpack/neverBuys";
import { NEVER_BUYS_STATUS, placeholderSentence } from "@/lib/burnticker/trustpack/copy";
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
export const v1CheckReceipts = (root = process.cwd()): ApiResult => ok(publicSampleReceipts(sampleReceipts(root)));

/**
 * HB-97 (hourly run 7): a cold check of a listed devnet receipt took 19.6 to 19.9 s (the public devnet RPC's 429 back-off, then two
 * Treasury reads), at Caddy's 20 s cut-off. A confirmed transaction never changes, so a finished verdict (every read answered) is kept
 * per signature: in memory (at most RECEIPT_CACHE_MAX, oldest first out) and, on a production host, in one JSON file, so a restart
 * starts warm. A check still running after RECEIPT_CHECK_DEADLINE_MS answers "still checking" (202, retry after a few seconds) and keeps
 * running into the cache. The sample receipts are checked once at web start (warmSampleReceipts, from platform()).
 */
export const RECEIPT_CACHE_MAX = 256;
export const RECEIPT_CHECK_DEADLINE_MS = 8_000;
export const RECEIPT_SOURCE_TIMEOUT_MS = 5_000;
export const RECEIPT_STILL_CHECKING = "Still checking this receipt. Try again in a few seconds.";
type ReceiptBody = Record<string, unknown> & { checks?: { ok: boolean | null; detail: string }[] };
const receiptCache = new Map<string, { at: string; body: ReceiptBody }>();
const receiptRunning = new Map<string, Promise<ReceiptBody>>();
let receiptDiskLoaded = false;
/** The cache file: BURNTICKER_RECEIPT_CACHE_FILE, else data/burnticker-receipt-checks.json on a production host, else none. */
export function receiptCacheFile(env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd()): string | null {
  const set = (env.BURNTICKER_RECEIPT_CACHE_FILE ?? "").trim();
  if (set) return set;
  return env.NODE_ENV === "production" ? path.join(root, "data", "burnticker-receipt-checks.json") : null;
}
export function resetReceiptCache(): void { receiptCache.clear(); receiptRunning.clear(); receiptDiskLoaded = false; }
/** A verdict is kept only when every read answered: a check whose RPC or source read failed is asked again next time. */
export const receiptVerdictFinal = (b: ReceiptBody): boolean =>
  // HB-116b (hourly run 9): a source read refused by this host's request budget is asked again too, never kept as the verdict
  !(b.checks ?? []).some((c) => c.ok === null && /did not answer|did not return|could not be fetched|did not return both|budget is full|budget is spent/.test(c.detail));
/**
 * HB-116b (hourly run 9): `verified` keeps its meaning (the on-chain core passed: transaction, program, memo, Reading, units, and no
 * check failed), and the answer says beside it, in the check page's own words (verificationStatus.ts verdictOf), whether every check
 * passed: "verified", or "partly verified" naming what was not checked (a source read that did not run is never implied to have passed).
 */
export function withVerdict<B extends ReceiptBody>(b: B): B & { verdict: Verdict; verdictLine: string; notChecked: { id: string; label: string; detail: string }[] } {
  const checks = (b.checks ?? []) as ReceiptCheck[];
  const v = verdictOf(checks);
  return { ...b, verdict: v.verdict, verdictLine: v.line, notChecked: checks.filter((c) => c.ok === null).map((c) => ({ id: c.id, label: c.label, detail: c.detail })) };
}
function keepReceipt(sig: string, body: ReceiptBody, file: string | null, now: number): void {
  if (!receiptVerdictFinal(body)) return;
  receiptCache.delete(sig);
  receiptCache.set(sig, { at: new Date(now).toISOString(), body });
  while (receiptCache.size > RECEIPT_CACHE_MAX) receiptCache.delete(receiptCache.keys().next().value as string);
  if (!file) return;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, JSON.stringify(Object.fromEntries(receiptCache))); fs.renameSync(`${file}.tmp`, file); } catch { /* best effort */ }
}
function loadReceiptDisk(file: string | null): void {
  if (receiptDiskLoaded) return;
  receiptDiskLoaded = true;
  if (!file) return;
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { at: string; body: ReceiptBody }>;
    for (const [k, v] of Object.entries(j).slice(-RECEIPT_CACHE_MAX)) if (isSignature(k) && v && typeof v.at === "string" && v.body && typeof v.body === "object") receiptCache.set(k, v);
  } catch { /* none yet */ }
}

export async function v1CheckReceipt(signature: string, o: { rpc?: Rpc; fetchSource?: SourceFetch | null; root?: string; deadlineMs?: number; cacheFile?: string | null; now?: () => number } = {}): Promise<ApiResult> {
  // QA 11 L8: a plain refusal, before any RPC call
  if (!isSignature(signature)) return fail(400, classifySignatureInput(signature).reason ?? "That is not a Solana transaction signature.", { code: "bad-signature" });
  const now = o.now ?? Date.now;
  const file = o.cacheFile === undefined ? receiptCacheFile(process.env, o.root) : o.cacheFile;
  loadReceiptDisk(file);
  const hit = receiptCache.get(signature);
  if (hit) return ok({ ...withVerdict(hit.body), checkedAt: hit.at, served: "kept verdict" });
  let run = receiptRunning.get(signature);
  if (!run) {
    const samples = sampleReceipts(o.root);
    const s = samples.receipts.find((r) => r.signature === signature);
    // the Treasury reads get their own bound, so one slow source cannot hold the whole check
    run = checkReceiptTx({
      signature, cluster: "devnet", programId: DEVNET_PROGRAM_ID, rpc: o.rpc ?? jsonRpc(PUBLIC_RPC.devnet, fetch, { attempts: 4, baseMs: 500 }),
      rulesText: s ? samples.rules[s.rulesPath] ?? null : null,
      fetchSource: o.fetchSource === undefined ? budgetedFetch((u: string) => fetch(u, { headers: { accept: "application/json", "user-agent": "burnticker-check/1 (receipt verification)" }, signal: AbortSignal.timeout(RECEIPT_SOURCE_TIMEOUT_MS) })) : o.fetchSource,
    }).then((result) => {
      const body: ReceiptBody = { ...result, ranOn: "server (the same code the /burnticker/check page runs in your browser)", sample: s ? publicSample(s) : null };
      keepReceipt(signature, body, file, now());
      return body;
    }).finally(() => receiptRunning.delete(signature));
    receiptRunning.set(signature, run);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const body = await Promise.race([run.catch(() => null), new Promise<"slow">((res) => { timer = setTimeout(() => res("slow"), o.deadlineMs ?? RECEIPT_CHECK_DEADLINE_MS); })]);
  clearTimeout(timer);
  if (body === "slow") return { ...fail(202, RECEIPT_STILL_CHECKING, { code: "still-checking", retryAfterSec: 5 }), headers: { "retry-after": "5" } };
  if (body === null) return fail(502, "The receipt could not be checked just now. Try again in a minute.", { code: "check-failed" });
  return ok({ ...withVerdict(body), checkedAt: new Date(now()).toISOString(), served: "checked now" });
}

/** HB-97: check the listed sample receipts once (web start), so the first visitor's check is answered from the kept verdict. */
export async function warmSampleReceipts(root = process.cwd()): Promise<number> {
  let n = 0;
  for (const r of sampleReceipts(root).receipts) {
    const a = await v1CheckReceipt(r.signature, { root, deadlineMs: 60_000 }).catch(() => null);
    if (a?.status === 200) n++;
  }
  return n;
}

let ledgerCache: { at: number; key: string; doc: FeeLedgerDoc } | null = null;
export const LEDGER_TTL_MS = 3_600_000;
export function resetLedgerCache(): void { ledgerCache = null; }
/** HB-88: the note a ledger answer carries when the chain was not read (the same words trust.ts uses). */
export const LEDGER_NOT_READ_NOTE = "Not read for this answer.";

export async function v1FeeLedger(p: Pick<Platform, "cluster" | "publishDir"> & Partial<Pick<Platform, "registry">>, o: { rpc?: Rpc; root?: string; now?: number; env?: Readonly<Record<string, string | undefined>> } = {}): Promise<ApiResult> {
  const r = await feeLedgerInner(p, o);
  if (r.status !== 200) return r;
  // LP locked forever (2026-10-10): the operator's LP-fee line is always fresh (the keeper's claim records), whichever copy served the rest.
  let claims = null;
  try { claims = p.registry ? p.registry.lockFeeClaims() : null; } catch { claims = null; }
  const body = { ...(r.body as Record<string, unknown>), lpFees: lpFeeLine(pageCluster(p), claims) };
  return { ...ok(body), headers: { "cache-control": ledgerCacheControl((body as { generatedAt?: unknown }).generatedAt, o.now ?? Date.now()) } };
}
/** The fee-ledger endpoint's declared freshness (trustpack/spec.ts getFeeLedger cacheSec). */
export const LEDGER_CACHE_SEC = 600;
/**
 * HB-122 (hourly run 10): the ledger body is reused for up to LEDGER_TTL_MS (the published copy, the chain read is costly), so the
 * headers count down from the body's own generatedAt: a body 57 minutes old is never sent under "fresh for 10 minutes more".
 */
export function ledgerCacheControl(generatedAt: unknown, now: number): string {
  const t = typeof generatedAt === "string" ? Date.parse(generatedAt) : NaN;
  const left = Number.isFinite(t) ? Math.floor(LEDGER_CACHE_SEC - Math.max(0, now - t) / 1000) : 0;
  return left > 0 ? `public, max-age=${left}, s-maxage=${left}` : "no-store";
}

async function feeLedgerInner(p: Pick<Platform, "cluster" | "publishDir">, o: { rpc?: Rpc; root?: string; now?: number; env?: Readonly<Record<string, string | undefined>> } = {}): Promise<ApiResult> {
  const now = o.now ?? Date.now(), cluster = pageCluster(p);
  const op = loadOperator(o.root), expenses = loadExpenses(o.root);
  const wallet = pinnedDevFeeWallet(op, cluster);
  const published = readPublishedLedger(p.publishDir);
  if (published && published.wallet === wallet && now - Date.parse(published.generatedAt) < LEDGER_TTL_MS) return ok({ ...published, expenses: publicExpenses(expenses), served: "published copy" });
  const key = `${cluster}:${wallet}`;
  if (ledgerCache && ledgerCache.key === key && now - ledgerCache.at < LEDGER_TTL_MS) return ok({ ...ledgerCache.doc, served: "cache" });
  if (!wallet) return ok({ ...buildFeeLedgerDoc({ cluster, wallet: null, history: null, expenses, now }), served: "none" });
  try {
    const history = await readWalletHistory(o.rpc ?? jsonRpc(serverRpcUrl(cluster, o.env)), wallet);
    const doc = buildFeeLedgerDoc({ cluster, wallet, history, expenses, now });
    ledgerCache = { at: now, key, doc };
    return ok({ ...doc, served: "chain" });
  } catch {
    // HB-88 (hourly run 6): a failed chain read answers with the stale published copy or an empty ledger and a plain "not read" note
    // (trust.ts's shape). The expenses are always the cleaned public rows, never the internal TODO_ tokens, and the raw RPC error
    // (which can carry the endpoint) stays out of the public answer.
    if (published) return ok({ ...published, expenses: publicExpenses(expenses), served: "published copy (stale: the chain read failed)" });
    return ok({ ...buildFeeLedgerDoc({ cluster, wallet, history: null, expenses, now }), note: LEDGER_NOT_READ_NOTE, served: "none" });
  }
}

/** Per network, per program: the deployed bytes recorded in verified-build.json (the operator page's program rows; audit 4 BT-02). */
export function deploymentsOf(root = process.cwd()): Record<Cluster, Record<string, { readAt: string; matchesBuild: boolean } | null>> {
  const vb = loadVerifiedBuild(root), out: Record<Cluster, Record<string, { readAt: string; matchesBuild: boolean } | null>> = { devnet: {}, mainnet: {} };
  for (const p of vb.programs) for (const c of ["devnet", "mainnet"] as Cluster[]) { const d = p.deployed?.[c]; out[c][p.library] = d ? { readAt: d.readAt, matchesBuild: d.matchesBuild } : null; }
  return out;
}

/** ACC-02: a report older than this (the keeper runs it daily) no longer describes the wallets today. */
export const NEVER_BUYS_STALE_MS = 48 * 3_600_000;
/**
 * Continuous audit 2026-10-19 ACC-02: the monitor as Trust and Operator show it: its line, the scope sentence (what was checked, recent
 * history only, what could not be read, the named exception) and whether the last run is too old. A stale run is "incomplete", unless
 * it found something red, which stays red.
 */
export function neverBuysView(o: { rule: string; rehearsalNote: string }, nb: NeverBuysReport | null, now = Date.now()) {
  if (!nb) return { rule: o.rule, rehearsalNote: o.rehearsalNote, report: null, line: NEVER_BUYS_STATUS.notRun, status: "not-run" as const, scopeLine: null, stale: false };
  const ran = Date.parse(nb.ranAt), stale = !Number.isFinite(ran) || now - ran > NEVER_BUYS_STALE_MS;
  const old = stale && nb.status !== "red";
  return { rule: o.rule, rehearsalNote: o.rehearsalNote, report: nb, line: old ? NEVER_BUYS_STATUS.stale : nb.line, status: old ? "incomplete" as const : nb.status, scopeLine: neverBuysScopeLine(nb), stale };
}

export function v1Operator(p: Pick<Platform, "cluster" | "publishDir">, root = process.cwd()): ApiResult {
  const op = loadOperator(root), cluster = pageCluster(p);
  const nb = readNeverBuys(p.publishDir);
  // HB-34/35 (run 3): no TODO_ string reaches the public answer; an unnamed value is null and the list says so in words
  return ok({
    schema: "burnticker.operator-view/v1", cluster,
    operator: withoutPlaceholders(op.operator), links: withoutPlaceholders(op.links),
    clusters: withoutPlaceholders(op.clusters),
    signedMessage: signedMessageView(op),
    neverBuys: neverBuysView(op.neverBuys, nb),
    placeholders: publicPlaceholders(op, placeholderSentence),
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
