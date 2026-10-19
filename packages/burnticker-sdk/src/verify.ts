import { PublicKey, type Connection } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { decodeAccount } from "@/lib/burnReceipts/idlCoder";
import { configPda, readingPda } from "@/lib/burnReceipts/pda";
import { base58Decode } from "./events.ts";
import { feedSourceReading, kalshiSourceReading, polymarketSourceReading, verifyReceiptCore, type ChainReading, type ReceiptLike, type SourceReading, type VerifyResult } from "@/lib/burnticker/verify";
import { rulesFromText } from "@/lib/burnticker/rules";
import type { HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import type { CarryPolicy } from "@/lib/burnticker/units";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import type { Fetch } from "./http.ts";

/**
 * VERIFY A RECEIPT ON YOUR OWN MACHINE. Nothing is taken from Burnticker except the receipt itself and the rule text (whose hash the
 * memo on chain must match): the settled result is re-read from the ORIGINAL source (Kalshi's public API, a Polymarket market's payout
 * vector on Polygon via eth_call, or the feed's own published request parsed by its published selection config), the rule is re-applied with the platform's own unit engine and the keeper's exact
 * integer spend formula, and — with a Solana connection — the memo is read from the transaction itself.
 */

export interface VerifyOptions {
  /** The token's ticker (the memo carries it). */
  ticker: string;
  /** The published rules.json text, byte for byte (GET /tokens/{ticker} → rulesText, or the static rules.json). */
  rulesText: string;
  /** Catalogue tokens: the source's public config (GET /catalogue → sources[].config). Kalshi tokens need none. */
  sourceConfig?: Record<string, unknown> | null;
  /** Re-read the source (default: the global fetch). Pass `false` to skip the source check. */
  fetch?: Fetch | false;
  /** Polymarket tokens: the Polygon JSON-RPC endpoints to read the CTF payout vector from (default: public endpoints), and a fetch for them. */
  polygonRpcUrls?: string[];
  polygonFetch?: Fetch;
  /** Read the transaction from chain (getTransaction at the receipt's signature). Without it the chain check is "not checked". */
  connection?: Connection;
  /**
   * The deployed burn_receipts program id and the token's mint (review N3, 2026-10-10). The chain check passes only when THE PROGRAM
   * wrote the memo (a Memo CPI inside a top-level burn_receipts instruction that names this mint), burned this mint inside that same
   * instruction, and its Reading account for the receipt's reading is program-owned and processed with the same burned amount. A memo
   * on its own is never a burn: without programId + mint the chain check is "not checked", never a pass.
   */
  programId?: PublicKey | string;
  /**
   * The coin's mint: REQUIRED (prelaunch audit 2026-10-18 A-2). A ticker alone is not an identity: two coins can carry the same ticker
   * and the same rule, so a receipt checked by ticker could be another coin's. Read it from GET /tokens/{mint} → status.mint.
   */
  mint: PublicKey | string;
  now?: number;
}

/**
 * The memo line a transaction's logs carry ("Program log: Memo (len N): \"…\""), unquoted. NOT provenance: any Memo instruction logs
 * the same line — display only; verifyReceipt uses burnProvenance.
 */
export function memoFromLogs(logs: readonly string[] | null | undefined): string | null {
  for (const l of logs ?? []) { const m = /Memo \(len \d+\): "(.*)"$/.exec(l); if (m) return m[1]; }
  return null;
}

const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** getTransaction's (JSON-encoded) transaction, the parts this needs. */
export interface ChainTx {
  meta: { err: unknown; loadedAddresses?: unknown; innerInstructions?: { index: number; instructions: { programIdIndex: number; accounts: number[]; data: string }[] }[] | null } | null;
  transaction: { message: { getAccountKeys?(o?: unknown): { get(i: number): { toBase58(): string } | undefined }; compiledInstructions?: { programIdIndex: number; accountKeyIndexes: number[] }[]; instructions?: { programIdIndex: number; accounts: number[] }[] } };
}

export interface Provenance { ok: boolean; detail: string; memo: string | null; burnedRaw: bigint }

/**
 * BURN PROVENANCE (review N3; the SDK twin of the main client's memoFromTransaction, review-2 F10 / review-3 L-6): the memo the burn
 * program itself wrote for `recordDate` (a Memo CPI among the inner instructions of a top-level burn_receipts instruction whose accounts
 * include `mint`), and the SPL burns of `mint` inside that same instruction. A Memo instruction anywhere else is ignored.
 */
export function burnProvenance(tx: ChainTx, expect: { programId: string; mint: string; recordDate: string | null }): Provenance {
  const fail = (detail: string, memo: string | null = null): Provenance => ({ ok: false, detail, memo, burnedRaw: BigInt(0) });
  if (!tx.meta) return fail("the transaction has no status metadata");
  const msg = tx.transaction.message;
  const keys = msg.getAccountKeys ? msg.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses ?? undefined }) : null;
  const key = (i: number): string | null => keys?.get(i)?.toBase58() ?? null;
  const top = (msg.compiledInstructions ?? []).map((x) => ({ programIdIndex: x.programIdIndex, accounts: x.accountKeyIndexes })).concat((msg.compiledInstructions ? [] : msg.instructions ?? []).map((x) => ({ programIdIndex: x.programIdIndex, accounts: x.accounts })));
  const mine = top.map((ix, index) => ({ ix, index })).filter(({ ix }) => key(ix.programIdIndex) === expect.programId);
  if (!mine.length) return fail(`the transaction never calls the burn program ${expect.programId} at top level: a memo alone is never a burn`);
  for (const { ix, index } of mine) {
    if (!ix.accounts.some((a) => key(a) === expect.mint)) continue;
    const inner = (tx.meta.innerInstructions ?? []).find((g) => g.index === index)?.instructions ?? [];
    let memo: string | null = null, burned = BigInt(0), burns = 0;
    for (const c of inner) {
      const pid = key(c.programIdIndex);
      let data: Uint8Array; try { data = base58Decode(c.data); } catch { continue; }
      if (pid === MEMO_PROGRAM && memo === null) { const text = Buffer.from(data).toString("utf8"); if (expect.recordDate === null || text.split("|")[1] === expect.recordDate) memo = text; }
      if (pid === TOKEN_PROGRAM && (data[0] === 8 || data[0] === 15) && data.length >= 9 && key(c.accounts[1]) === expect.mint) { burned += Buffer.from(data).readBigUInt64LE(1); burns++; }
    }
    if (memo === null) continue;
    const burnField = memo.split("|").find((x) => x.startsWith("burn="))?.slice(5) ?? null;
    if (burnField !== null && /[1-9]/.test(burnField) && burns === 0) return fail(`the program's memo says burn=${burnField} but the instruction burned no ${expect.mint}`, memo);
    return { ok: true, detail: `the burn program wrote this memo inside its own instruction on ${expect.mint.slice(0, 8)}…${burns ? ` and burned ${burned} raw units of it there` : " (no burn: the memo says none)"}`, memo, burnedRaw: burned };
  }
  return fail(`no top-level burn program instruction on ${expect.mint} wrote a memo${expect.recordDate ? ` for reading ${expect.recordDate}` : ""}`);
}

type ReadingAccount = { processed: boolean; burned: bigint; record_date: number };

/**
 * Reads the receipt's transaction and checks the burn program's provenance (burnProvenance) and its Reading account (program-owned,
 * processed, the same burned amount). Without `expect` the transaction is read but provenance is "not checked".
 */
export async function readChainMemo(connection: Connection, signature: string, expect: { programId: string; mint: string; recordDate: string | null } | null = null): Promise<ChainReading> {
  const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }) as unknown as ChainTx | null;
  if (!tx) return { found: false, err: null, memo: null };
  const err = tx.meta?.err ? JSON.stringify(tx.meta.err) : null;
  if (!expect) return { found: true, err, memo: null, provenance: { ok: null, detail: "pass programId and mint: without them the burn program's provenance cannot be checked, and a memo alone is never a burn" } };
  if (err) return { found: true, err, memo: null };
  const p = burnProvenance(tx, expect);
  if (!p.ok || !expect.recordDate) return { found: true, err, memo: p.memo, provenance: { ok: p.ok ? null : false, detail: p.ok ? `${p.detail}; the Reading account was not checked (no reading date on the receipt)` : p.detail } };
  const programId = new PublicKey(expect.programId), mint = new PublicKey(expect.mint);
  const date = Number(expect.recordDate.replace(/-/g, ""));
  const addr = readingPda(programId, configPda(programId, mint), date);
  const acct = await connection.getAccountInfo(addr, "confirmed");
  if (!acct || !acct.owner.equals(programId)) return { found: true, err, memo: p.memo, provenance: { ok: false, detail: `the Reading ${addr.toBase58().slice(0, 8)}… for ${expect.recordDate} is not an account owned by the burn program` } };
  let r: ReadingAccount;
  try { r = decodeAccount<ReadingAccount>(BURN_RECEIPTS_IDL, "Reading", acct.data); } catch (e) { return { found: true, err, memo: p.memo, provenance: { ok: false, detail: `the Reading account does not decode: ${(e as Error).message.slice(0, 80)}` } }; }
  if (!r.processed) return { found: true, err, memo: p.memo, provenance: { ok: false, detail: `the Reading for ${expect.recordDate} is not processed` } };
  if (BigInt(r.burned) !== p.burnedRaw) return { found: true, err, memo: p.memo, provenance: { ok: false, detail: `the Reading records ${r.burned} burned, the transaction burned ${p.burnedRaw}` } };
  return { found: true, err, memo: p.memo, provenance: { ok: true, detail: `${p.detail}; Reading ${addr.toBase58().slice(0, 8)}… is program-owned, processed, burned ${r.burned}` } };
}

/** A-2: the error a verification without the coin's mint throws. */
export const MINT_REQUIRED = "verifyReceipt needs the coin's mint: a ticker can be shared by two coins, so it does not say which coin a receipt belongs to.";

/** Every check (rules, memo, source, units, spend, chain), each ok: true | false | null (not checkable here). */
export async function verifyReceipt(receipt: ReceiptLike, o: VerifyOptions): Promise<VerifyResult> {
  if (!o.mint || !String(o.mint).trim()) throw new Error(MINT_REQUIRED);
  const now = o.now ?? Date.now();
  const rule = rulesFromText(o.rulesText).rule;
  const cfg = (o.sourceConfig ?? null) as (HttpSourceConfig & { carry?: CarryPolicy }) | null;
  const carry: CarryPolicy = rule.oracle === "catalogue" ? (cfg?.carry ?? "none") : "none";
  let source: SourceReading | null = null;
  if (o.fetch !== false) {
    const f = (o.fetch ?? (globalThis.fetch as unknown as Fetch)) as unknown as FetchLike;
    if (rule.oracle === "kalshi") source = await kalshiSourceReading(rule, receipt.eventId, f, now);
    else if (rule.oracle === "polymarket") source = await polymarketSourceReading(rule, receipt.eventId, { fetchImpl: f, rpcFetch: o.polygonFetch as never, rpcUrls: o.polygonRpcUrls });
    else if (rule.oracle === "catalogue") source = cfg ? await feedSourceReading(cfg, f, now) : { events: null, error: "pass sourceConfig (GET /catalogue → sources[].config) to re-read a catalogue source", url: null };
    else source = { events: null, error: `no verifier for oracle ${rule.oracle}`, url: null };
  }
  const date = receipt.readingDate ?? (receipt.memo && /^\d{4}-\d{2}-\d{2}$/.test(receipt.memo.split("|")[1] ?? "") ? receipt.memo.split("|")[1] : null);
  const expect = o.programId && o.mint ? { programId: new PublicKey(o.programId).toBase58(), mint: new PublicKey(o.mint).toBase58(), recordDate: date } : null;
  const chain = o.connection && receipt.signature ? await readChainMemo(o.connection, receipt.signature, expect).catch((e: Error) => ({ found: false, err: e.message, memo: null })) : null;
  return verifyReceiptCore({ ticker: o.ticker, rulesText: o.rulesText, receipt, carry, source, chain });
}
