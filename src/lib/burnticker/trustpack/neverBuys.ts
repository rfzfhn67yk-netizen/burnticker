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
/**
 * `how` (review 3 of A-6, 2026-10-18): "acquired" when the wallet signed the transaction and it ran a swap or buy (a trading program, or
 * the wallet paid SOL or another token beyond the fee for it); "received" when the coin only arrived. Anyone can send a token to a public
 * wallet, so a receipt is listed and never turns the line red.
 */
export interface Acquisition { wallet: string; role: string; signature: string; mint: string; symbol: string; amountRaw: string; blockTime: string | null; explainedBy: string | null; how?: "acquired" | "received" }
export interface NeverBuysReport {
  schema: "burnticker.never-buys/v1"; ranAt: string; cluster: string;
  /** "received": only inbound transfers; "not-checked": every wallet read failed, so nothing was checked (never "clear") */
  status: "clear" | "explained" | "received" | "red" | "not-checked"; line: string;
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
interface TxJson {
  blockTime: number | null;
  transaction?: { message: { accountKeys: string[]; header?: { numRequiredSignatures: number }; instructions?: { programIdIndex: number }[] } };
  meta: { err: unknown; fee?: number; preBalances?: number[]; postBalances?: number[]; loadedAddresses?: { writable: string[]; readonly: string[] }; innerInstructions?: { instructions: { programIdIndex: number }[] }[];
    preTokenBalances?: { mint: string; owner?: string; uiTokenAmount: { amount: string } }[]; postTokenBalances?: { mint: string; owner?: string; uiTokenAmount: { amount: string } }[] } | null;
}

/**
 * The trading programs a buy runs through (review 3): Raydium LaunchLab (mainnet and devnet), Raydium CPMM and AMM v4, the pair curve,
 * Jupiter v6, Orca Whirlpool, Meteora DLMM and DAMM, pump.fun and PumpSwap.
 */
export const SWAP_PROGRAMS: ReadonlySet<string> = new Set([
  "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj", "DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6",
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", "DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb", "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN", "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
]);

/** The wallet signed this transaction, and it bought: it ran a trading program, or the wallet paid more than the fee for it. */
export function walletBought(tx: TxJson, wallet: string): boolean {
  const m = tx.transaction?.message;
  if (!m) return false;
  const keys = [...m.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
  const i = m.accountKeys.indexOf(wallet);
  if (i < 0 || i >= (m.header?.numRequiredSignatures ?? 1)) return false;   // not a signer: the coin was sent to it
  const programs = [...(m.instructions ?? []), ...(tx.meta?.innerInstructions ?? []).flatMap((x) => x.instructions)].map((x) => keys[x.programIdIndex]);
  if (programs.some((p) => SWAP_PROGRAMS.has(p))) return true;
  // the wallet paid for it: SOL beyond the fee (the fee payer is index 0), or another token's balance went down
  const solOut = (tx.meta?.preBalances?.[i] ?? 0) - (tx.meta?.postBalances?.[i] ?? 0) - (i === 0 ? tx.meta?.fee ?? 0 : 0);
  if (solOut > 2_100_000) return true;   // more than rent for a token account or two
  const bal = (rows: { mint: string; owner?: string; uiTokenAmount: { amount: string } }[] | undefined, mint: string): bigint => (rows ?? []).filter((r) => r.owner === wallet && r.mint === mint).reduce((a, r) => a + BigInt(r.uiTokenAmount.amount), BigInt(0));
  const mints = new Set([...(tx.meta?.preTokenBalances ?? []), ...(tx.meta?.postTokenBalances ?? [])].filter((r) => r.owner === wallet).map((r) => r.mint));
  for (const mint of mints) if (bal(tx.meta?.postTokenBalances, mint) < bal(tx.meta?.preTokenBalances, mint)) return true;
  return false;
}

/** The wallet's net change of `mint` in a transaction (sum over its token accounts), from the token balances the RPC records. */
export function walletMintDelta(tx: TxJson, wallet: string, mint: string): bigint {
  const sum = (rows: { mint: string; owner?: string; uiTokenAmount: { amount: string } }[] | undefined) => (rows ?? []).filter((r) => r.mint === mint && r.owner === wallet).reduce((a, r) => a + BigInt(r.uiTokenAmount.amount), BigInt(0));
  return sum(tx.meta?.postTokenBalances) - sum(tx.meta?.preTokenBalances);
}

export function statusOf(acq: Acquisition[], o: { allReadsFailed?: boolean } = {}): { status: NeverBuysReport["status"]; line: string } {
  const bought = acq.filter((a) => (a.how ?? "acquired") === "acquired");
  if (bought.some((a) => !a.explainedBy)) return { status: "red", line: NEVER_BUYS_STATUS.red };
  if (o.allReadsFailed) return { status: "not-checked", line: NEVER_BUYS_STATUS.notChecked };
  if (bought.length) return { status: "explained", line: NEVER_BUYS_STATUS.explained };
  if (acq.length) return { status: "received", line: NEVER_BUYS_STATUS.received };
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
    const tx = await i.rpc.call<TxJson | null>("getTransaction", [sig, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]);
    transactions++;
    if (!tx?.meta || tx.meta.err) return;
    for (const m of i.mints) {
      const d = walletMintDelta(tx, w.pubkey, m.mint);
      if (d > BigInt(0)) acquisitions.push({ wallet: w.pubkey, role: w.role, signature: sig, mint: m.mint, symbol: m.symbol, amountRaw: d.toString(), blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null, explainedBy: i.evidence.get(sig) ?? null, how: walletBought(tx, w.pubkey) ? "acquired" : "received" });
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
  const failedWallets = new Set(errors.map((e) => e.split(" ")[0]));
  const st = statusOf(acquisitions, { allReadsFailed: i.wallets.length > 0 && i.wallets.every((w) => failedWallets.has(w.role)) });
  return { schema: "burnticker.never-buys/v1", ranAt: new Date(i.now ?? Date.now()).toISOString(), cluster: i.cluster, status: st.status, line: st.line, wallets: i.wallets, mints: i.mints, holdings, acquisitions: acquisitions.sort((a, b) => (a.blockTime ?? "").localeCompare(b.blockTime ?? "")), scanned: { tokenAccounts, transactions }, errors };
}

/**
 * THE MINTS THE KEEPER'S DAILY RUN WATCHES (prelaunch audit 2026-10-18 A-6: the trust page said the monitor checks the operator wallets,
 * and the operator page said it had never run). Every coin the registry holds on this cluster that is not a draft, the operator record's
 * listed mints, and $DEFICIT's mint; one row per mint.
 */
export function neverBuysMints(tokens: readonly { ticker: string; mint: string; status: string; cluster: string }[], cluster: string, listed: readonly { symbol: string; mint: string }[], extra: readonly { symbol: string; mint: string }[] = []): { symbol: string; mint: string }[] {
  const out = new Map<string, { symbol: string; mint: string }>();
  for (const m of [...listed, ...extra]) if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m.mint)) out.set(m.mint, { symbol: m.symbol, mint: m.mint });
  for (const t of tokens) if (t.cluster === cluster && t.status !== "draft" && t.status !== "expired" && !out.has(t.mint)) out.set(t.mint, { symbol: t.ticker, mint: t.mint });
  return [...out.values()];
}

export function readNeverBuys(publishDir: string): NeverBuysReport | null {
  const f = path.join(publishDir, NEVER_BUYS_FILE);
  if (!fs.existsSync(f)) return null;
  try { const j = JSON.parse(fs.readFileSync(f, "utf8")) as NeverBuysReport; return j.schema === "burnticker.never-buys/v1" ? j : null; } catch { return null; }
}
