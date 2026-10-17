import fs from "node:fs";
import path from "node:path";
import type { Rpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { NEVER_BUYS_STATUS } from "@/lib/burnticker/trustpack/copy";

/**
 * THE "NEVER BUYS A PLATFORM COIN" MONITOR (trust pack, 2026-10-10). A keeper-side check over the operator's wallets
 * (config/burnticker/operator.json, the cluster the platform runs on): for each wallet,
 *
 *   1. every token account it owns (SPL Token and Token-2022) whose mint is a platform coin — with its balance, zero or not;
 *   2. every transaction that touched one of those token accounts, and the wallet's own most recent transactions, in which the
 *      wallet's balance of a platform coin went UP — an acquisition.
 *
 * An acquisition whose signature appears in the rehearsal evidence (docs/burnkeeper/evidence/**, the run logs) is "explained" and
 * names the file; any other is "unexplained" and turns the status line red. The status is one line on /burnticker/operator and the
 * trust page. `scripts/burnticker-trustpack.mts never-buys` writes <publish dir>/never-buys.json (the keeper host runs it with the
 * hourly audit); the API only reads that file — it never scans the chain on a page view.
 */

export const NEVER_BUYS_FILE = "never-buys.json";
export const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
export const EVIDENCE_SOURCES = ["docs/burnkeeper/evidence", "docs/burnkeeper/devnet-run.md", "docs/burnkeeper/devnet-run-log-2026-10-10.md", "docs/burnkeeper/devnet-paircurve-run-log-2026-10-10.md"];

export interface Holding { wallet: string; role: string; tokenAccount: string; mint: string; symbol: string; amountRaw: string }
export interface Acquisition { wallet: string; role: string; signature: string; mint: string; symbol: string; amountRaw: string; blockTime: string | null; explainedBy: string | null }
export interface NeverBuysReport {
  schema: "burnticker.never-buys/v1"; ranAt: string; cluster: string;
  status: "clear" | "explained" | "red"; line: string;
  wallets: { role: string; pubkey: string }[]; mints: { symbol: string; mint: string }[];
  holdings: Holding[]; acquisitions: Acquisition[]; scanned: { tokenAccounts: number; transactions: number }; errors: string[];
}

/** Every 86–88-character base58 token in the evidence files → the first file that names it. */
export function evidenceSignatures(root = process.cwd(), sources = EVIDENCE_SOURCES): Map<string, string> {
  const out = new Map<string, string>();
  const files = sources.flatMap((s) => { const p = path.join(root, s); if (!fs.existsSync(p)) return []; return fs.statSync(p).isDirectory() ? fs.readdirSync(p, { recursive: true }).map((f) => path.join(s, String(f))).filter((f) => fs.statSync(path.join(root, f)).isFile()).sort() : [s]; });
  // the evidence files first (the most specific record), then the run logs, in EVIDENCE_SOURCES order
  for (const f of files) for (const m of fs.readFileSync(path.join(root, f), "utf8").matchAll(/[1-9A-HJ-NP-Za-km-z]{86,88}/g)) if (!out.has(m[0])) out.set(m[0], f);
  return out;
}

interface TokenAccountsJson { value: { pubkey: string; account: { data: { parsed: { info: { mint: string; owner: string; tokenAmount: { amount: string } } } } } }[] }
interface TxJson { blockTime: number | null; meta: { err: unknown; preTokenBalances?: { mint: string; owner?: string; uiTokenAmount: { amount: string } }[]; postTokenBalances?: { mint: string; owner?: string; uiTokenAmount: { amount: string } }[] } | null }

/** The wallet's net change of `mint` in a transaction (sum over its token accounts), from the token balances the RPC records. */
export function walletMintDelta(tx: TxJson, wallet: string, mint: string): bigint {
  const sum = (rows: { mint: string; owner?: string; uiTokenAmount: { amount: string } }[] | undefined) => (rows ?? []).filter((r) => r.mint === mint && r.owner === wallet).reduce((a, r) => a + BigInt(r.uiTokenAmount.amount), BigInt(0));
  return sum(tx.meta?.postTokenBalances) - sum(tx.meta?.preTokenBalances);
}

export function statusOf(acq: Acquisition[]): { status: NeverBuysReport["status"]; line: string } {
  if (acq.some((a) => !a.explainedBy)) return { status: "red", line: NEVER_BUYS_STATUS.red };
  if (acq.length) return { status: "explained", line: NEVER_BUYS_STATUS.explained };
  return { status: "clear", line: NEVER_BUYS_STATUS.clear };
}

export async function runNeverBuys(i: { rpc: Rpc; cluster: string; wallets: { role: string; pubkey: string }[]; mints: { symbol: string; mint: string }[]; evidence: Map<string, string>; recentPerWallet?: number; perTokenAccount?: number; now?: number }): Promise<NeverBuysReport> {
  const symbolOf = new Map(i.mints.map((m) => [m.mint, m.symbol]));
  const holdings: Holding[] = [], acquisitions: Acquisition[] = [], errors: string[] = [];
  const seen = new Set<string>();
  let tokenAccounts = 0, transactions = 0;
  const examine = async (sig: string, w: { role: string; pubkey: string }) => {
    const key = `${w.pubkey}:${sig}`;
    if (seen.has(key)) return;
    seen.add(key);
    const tx = await i.rpc.call<TxJson | null>("getTransaction", [sig, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
    transactions++;
    if (!tx?.meta || tx.meta.err) return;
    for (const m of i.mints) {
      const d = walletMintDelta(tx, w.pubkey, m.mint);
      if (d > BigInt(0)) acquisitions.push({ wallet: w.pubkey, role: w.role, signature: sig, mint: m.mint, symbol: m.symbol, amountRaw: d.toString(), blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null, explainedBy: i.evidence.get(sig) ?? null });
    }
  };
  for (const w of i.wallets) {
    try {
      for (const programId of TOKEN_PROGRAMS) {
        const res = await i.rpc.call<TokenAccountsJson>("getTokenAccountsByOwner", [w.pubkey, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }]);
        for (const a of res.value) {
          const info = a.account.data.parsed.info;
          if (!symbolOf.has(info.mint)) continue;
          tokenAccounts++;
          holdings.push({ wallet: w.pubkey, role: w.role, tokenAccount: a.pubkey, mint: info.mint, symbol: symbolOf.get(info.mint)!, amountRaw: info.tokenAmount.amount });
          const sigs = await i.rpc.call<{ signature: string }[]>("getSignaturesForAddress", [a.pubkey, { limit: i.perTokenAccount ?? 100, commitment: "confirmed" }]);
          for (const s of sigs) await examine(s.signature, w);
        }
      }
      const recent = await i.rpc.call<{ signature: string }[]>("getSignaturesForAddress", [w.pubkey, { limit: i.recentPerWallet ?? 25, commitment: "confirmed" }]);
      for (const s of recent) await examine(s.signature, w);
    } catch (e) { errors.push(`${w.role} ${w.pubkey.slice(0, 8)}…: ${(e as Error).message.slice(0, 160)}`); }
  }
  const st = statusOf(acquisitions);
  return { schema: "burnticker.never-buys/v1", ranAt: new Date(i.now ?? Date.now()).toISOString(), cluster: i.cluster, status: st.status, line: st.line, wallets: i.wallets, mints: i.mints, holdings, acquisitions: acquisitions.sort((a, b) => (a.blockTime ?? "").localeCompare(b.blockTime ?? "")), scanned: { tokenAccounts, transactions }, errors };
}

export function readNeverBuys(publishDir: string): NeverBuysReport | null {
  const f = path.join(publishDir, NEVER_BUYS_FILE);
  if (!fs.existsSync(f)) return null;
  try { const j = JSON.parse(fs.readFileSync(f, "utf8")) as NeverBuysReport; return j.schema === "burnticker.never-buys/v1" ? j : null; } catch { return null; }
}
