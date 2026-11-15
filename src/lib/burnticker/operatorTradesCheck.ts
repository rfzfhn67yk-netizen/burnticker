import { PublicKey } from "@solana/web3.js";
import type { Rpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { TOKEN_PROGRAMS, walletMintDelta } from "@/lib/burnticker/trustpack/neverBuys";
import type { OperatorTrade } from "@/lib/burnticker/operatorCreators";

/**
 * THE OPERATOR-TRADES RELEASE CHECK (ninth pre-launch audit B-26 / HB-206 / HS-104, 2026-10-21). The coin pages say an operator-created
 * coin "has not traded" unless transparency.json `operatorTrades` lists a trade; this check is what makes that sentence true at every
 * publish. For each operator wallet and each platform mint it reads the wallet's WHOLE history in that coin: every token account the
 * wallet owns now for the mint (both token programs), plus the associated token account under both programs even when it is closed
 * (a closed account keeps its signatures). Every transaction in which the wallet signed and its balance of the coin changed is a trade.
 * A trade whose signature is not a listed buyTx or sellTx for that wallet and mint fails the check; so does any read that failed
 * (fail closed: no conclusion is never a pass). A coin that only arrived (the wallet did not sign) is listed as received, not a failure.
 *
 * Pure apart from the injected `rpc`: scripts/ops/operator-trades-check.mts runs it against mainnet, or against a fixture with --offline.
 */

export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export interface TradesCheckMint { symbol: string; mint: string }
export interface FoundTrade { wallet: string; mint: string; symbol: string; signature: string; side: "buy" | "sale"; amountRaw: string; at: string | null; listed: boolean }
export interface TradesCheckResult { ok: boolean; trades: FoundTrade[]; unlisted: FoundTrade[]; received: FoundTrade[]; listedNotFound: string[]; errors: string[]; scanned: { accounts: number; transactions: number } }

interface TokenAccountsJson { value: { pubkey: string; account: { data: { parsed: { info: { mint: string } } } } }[] }
interface TxJson {
  blockTime: number | null;
  transaction?: { message: { accountKeys: string[]; header?: { numRequiredSignatures: number } } };
  meta: { err: unknown; preTokenBalances?: { mint: string; owner?: string; uiTokenAmount: { amount: string } }[]; postTokenBalances?: { mint: string; owner?: string; uiTokenAmount: { amount: string } }[] } | null;
}

/** The associated token account of `owner` for `mint` under `tokenProgram`. */
export function associatedTokenAccount(owner: string, mint: string, tokenProgram: string): string {
  return PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(ATA_PROGRAM))[0].toBase58();
}

/** Every signature of an address, newest first, paging with `before` (1,000 a page). */
async function allSignatures(rpc: Rpc, address: string): Promise<string[]> {
  const out: string[] = [];
  let before: string | undefined;
  for (let page = 0; page < 50; page++) {
    const sigs = await rpc.call<{ signature: string }[]>("getSignaturesForAddress", [address, { limit: 1000, commitment: "finalized", ...(before ? { before } : {}) }]);
    out.push(...sigs.map((s) => s.signature));
    if (sigs.length < 1000) return out;
    before = sigs[sigs.length - 1].signature;
  }
  throw new Error(`more than 50,000 signatures on ${address}`);
}

const signed = (tx: TxJson, wallet: string): boolean => {
  const m = tx.transaction?.message;
  const i = m ? m.accountKeys.indexOf(wallet) : -1;
  return i >= 0 && i < (m?.header?.numRequiredSignatures ?? 1);
};

/** A read the node failed ("Failed to query long-term storage", a reset) is asked again up to `tries` times before it counts as failed. */
function retrying(rpc: Rpc, tries: number, pauseMs: number): Rpc {
  return { async call<T>(method: string, params: unknown[]): Promise<T> {
    for (let n = 1; ; n++) {
      try { return await rpc.call<T>(method, params); } catch (e) { if (n >= tries) throw e; await new Promise((r) => setTimeout(r, pauseMs * n)); }
    }
  } };
}

export async function runOperatorTradesCheck(o: { rpc: Rpc; wallets: readonly string[]; mints: readonly TradesCheckMint[]; trades: readonly OperatorTrade[]; tries?: number; pauseMs?: number }): Promise<TradesCheckResult> {
  const i = { ...o, rpc: retrying(o.rpc, o.tries ?? 4, o.pauseMs ?? 2_000) };
  const trades: FoundTrade[] = [], received: FoundTrade[] = [], errors: string[] = [];
  const symbolOf = new Map(i.mints.map((m) => [m.mint, m.symbol]));
  const listed = new Set(i.trades.flatMap((t) => [t.buyTx, t.sellTx].filter((s): s is string => !!s).map((s) => `${t.wallet}:${t.mint}:${s}`)));
  let accounts = 0, transactions = 0;
  for (const wallet of i.wallets) {
    const byMint = new Map<string, Set<string>>();
    const add = (mint: string, account: string) => { if (!byMint.has(mint)) byMint.set(mint, new Set()); byMint.get(mint)!.add(account); };
    try {
      for (const programId of TOKEN_PROGRAMS) {
        const res = await i.rpc.call<TokenAccountsJson>("getTokenAccountsByOwner", [wallet, { programId }, { encoding: "jsonParsed", commitment: "finalized" }]);
        for (const a of res.value) if (symbolOf.has(a.account.data.parsed.info.mint)) add(a.account.data.parsed.info.mint, a.pubkey);
      }
    } catch (e) { errors.push(`token accounts of ${wallet.slice(0, 8)}…: ${(e as Error).message.slice(0, 160)}`); }
    for (const m of i.mints) for (const p of TOKEN_PROGRAMS) add(m.mint, associatedTokenAccount(wallet, m.mint, p));
    for (const [mint, accts] of byMint) {
      const seen = new Set<string>();
      for (const account of accts) {
        accounts++;
        let sigs: string[];
        try { sigs = await allSignatures(i.rpc, account); } catch (e) { errors.push(`signatures of ${account.slice(0, 8)}… ($${symbolOf.get(mint)}): ${(e as Error).message.slice(0, 160)}`); continue; }
        for (const sig of sigs) {
          if (seen.has(sig)) continue;
          seen.add(sig);
          let tx: TxJson | null;
          try { tx = await i.rpc.call<TxJson | null>("getTransaction", [sig, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "finalized" }]); } catch (e) { errors.push(`transaction ${sig.slice(0, 12)}…: ${(e as Error).message.slice(0, 160)}`); continue; }
          transactions++;
          if (!tx?.meta) { errors.push(`transaction ${sig.slice(0, 12)}… could not be read (the node returned nothing)`); continue; }
          if (tx.meta.err) continue;
          const d = walletMintDelta(tx, wallet, mint);
          if (d === BigInt(0)) continue;
          const row: FoundTrade = { wallet, mint, symbol: symbolOf.get(mint) ?? "?", signature: sig, side: d > BigInt(0) ? "buy" : "sale", amountRaw: (d < BigInt(0) ? -d : d).toString(), at: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null, listed: listed.has(`${wallet}:${mint}:${sig}`) };
          (signed(tx, wallet) ? trades : received).push(row);
        }
      }
    }
  }
  const foundSigs = new Set(trades.map((t) => `${t.wallet}:${t.mint}:${t.signature}`));
  const listedNotFound = [...listed].filter((k) => !foundSigs.has(k));
  const unlisted = trades.filter((t) => !t.listed);
  return { ok: unlisted.length === 0 && errors.length === 0, trades, unlisted, received, listedNotFound, errors, scanned: { accounts, transactions } };
}

/** The mints to scan: every live platform coin on mainnet (the public tokens list), the disclosed test coins and $DEFICIT; one row per mint. */
export function tradesCheckMints(tokens: readonly { ticker: string; mint: string; cluster?: string; status?: string }[], extra: readonly TradesCheckMint[]): TradesCheckMint[] {
  const out = new Map<string, TradesCheckMint>();
  const ok = (m: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m);
  for (const m of extra) if (ok(m.mint)) out.set(m.mint, m);
  for (const t of tokens) if (ok(t.mint) && (t.cluster ?? "mainnet") === "mainnet" && t.status !== "draft" && !out.has(t.mint)) out.set(t.mint, { symbol: t.ticker, mint: t.mint });
  return [...out.values()];
}

/**
 * HB-225 (ninth-pass re-check, 2026-10-21): the transparency entry for an operator wallet names the coins that wallet created. The
 * list goes stale the moment the operator launches another coin ($COLNHLWIN made it eight after the entry said seven), so the release
 * check compares the public tokens list with each operator-own entry: every mainnet coin whose creator is that wallet must be named
 * as $TICKER in the entry's description. Returns one line per missing coin; empty when every created coin is named.
 */
export function operatorCreatedCoinsProblems(
  tokens: readonly { ticker: string; creator?: string | null; cluster?: string; status?: string }[],
  wallets: readonly { pubkey?: string | null; role?: string; description?: string }[],
): string[] {
  const out: string[] = [];
  for (const w of wallets) {
    if (!w.pubkey || w.role !== "operator-own") continue;
    const named = new Set([...(w.description ?? "").matchAll(/\$([A-Z0-9]{2,16})\b/g)].map((m) => m[1]));
    for (const c of tokens) {
      if (c.creator !== w.pubkey || (c.cluster ?? "mainnet") !== "mainnet" || c.status === "draft") continue;
      if (!named.has(c.ticker)) out.push(`$${c.ticker} was created by ${w.pubkey.slice(0, 4)}…${w.pubkey.slice(-5)} but that wallet's transparency entry does not name it`);
    }
  }
  return out;
}

/** The lines the script prints: one per trade found, then the verdict. */
export function tradesCheckReport(r: TradesCheckResult): string[] {
  const lines = r.trades.map((t) => `${t.listed ? "listed  " : "UNLISTED"} ${t.side} $${t.symbol} ${t.amountRaw} raw by ${t.wallet.slice(0, 4)}…${t.wallet.slice(-5)} at ${t.at ?? "?"} (${t.signature.slice(0, 12)}…)`);
  for (const t of r.received) lines.push(`received $${t.symbol} ${t.amountRaw} raw by ${t.wallet.slice(0, 4)}…${t.wallet.slice(-5)} (not signed by it; not a trade) (${t.signature.slice(0, 12)}…)`);
  for (const k of r.listedNotFound) lines.push(`note: listed trade not found on chain: ${k.split(":")[2].slice(0, 12)}…`);
  for (const e of r.errors) lines.push(`read failed: ${e}`);
  lines.push(r.ok
    ? `operator trades: ok (${r.scanned.accounts} token accounts, ${r.scanned.transactions} transactions; ${r.trades.length} trade${r.trades.length === 1 ? "" : "s"}, all listed in transparency.json operatorTrades)`
    : `operator trades: FAILED (${r.unlisted.length} trade${r.unlisted.length === 1 ? "" : "s"} not listed in transparency.json operatorTrades, ${r.errors.length} read error${r.errors.length === 1 ? "" : "s"})`);
  return lines;
}
