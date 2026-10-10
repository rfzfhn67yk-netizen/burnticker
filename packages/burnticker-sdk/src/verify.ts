import type { Connection } from "@solana/web3.js";
import { feedSourceReading, kalshiSourceReading, verifyReceiptCore, type ChainReading, type ReceiptLike, type SourceReading, type VerifyResult } from "@/lib/burnticker/verify";
import { rulesFromText } from "@/lib/burnticker/rules";
import type { HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import type { CarryPolicy } from "@/lib/burnticker/units";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import type { Fetch } from "./http.ts";

/**
 * VERIFY A RECEIPT ON YOUR OWN MACHINE. Nothing is taken from Burnticker except the receipt itself and the rule text (whose hash the
 * memo on chain must match): the settled result is re-read from the ORIGINAL source (Kalshi's public API, or the feed's own published
 * request parsed by its published selection config), the rule is re-applied with the platform's own unit engine and the keeper's exact
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
  /** Read the memo from chain (getTransaction at the receipt's signature). Without it the chain check is "not checked". */
  connection?: Connection;
  now?: number;
}

/** The memo line a transaction's logs carry ("Program log: Memo (len N): \"…\""), unquoted. */
export function memoFromLogs(logs: readonly string[] | null | undefined): string | null {
  for (const l of logs ?? []) { const m = /Memo \(len \d+\): "(.*)"$/.exec(l); if (m) return m[1]; }
  return null;
}

export async function readChainMemo(connection: Connection, signature: string): Promise<ChainReading> {
  const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx) return { found: false, err: null, memo: null };
  return { found: true, err: tx.meta?.err ? JSON.stringify(tx.meta.err) : null, memo: memoFromLogs(tx.meta?.logMessages) };
}

/** Every check (rules, memo, source, units, spend, chain), each ok: true | false | null (not checkable here). */
export async function verifyReceipt(receipt: ReceiptLike, o: VerifyOptions): Promise<VerifyResult> {
  const now = o.now ?? Date.now();
  const rule = rulesFromText(o.rulesText).rule;
  const cfg = (o.sourceConfig ?? null) as (HttpSourceConfig & { carry?: CarryPolicy }) | null;
  const carry: CarryPolicy = rule.oracle === "catalogue" ? (cfg?.carry ?? "none") : "none";
  let source: SourceReading | null = null;
  if (o.fetch !== false) {
    const f = (o.fetch ?? (globalThis.fetch as unknown as Fetch)) as unknown as FetchLike;
    if (rule.oracle === "kalshi") source = await kalshiSourceReading(rule, receipt.eventId, f, now);
    else if (rule.oracle === "catalogue") source = cfg ? await feedSourceReading(cfg, f, now) : { events: null, error: "pass sourceConfig (GET /catalogue → sources[].config) to re-read a catalogue source", url: null };
    else source = { events: null, error: `no verifier for oracle ${rule.oracle}`, url: null };
  }
  const chain = o.connection && receipt.signature ? await readChainMemo(o.connection, receipt.signature).catch((e: Error) => ({ found: false, err: e.message, memo: null })) : null;
  return verifyReceiptCore({ ticker: o.ticker, rulesText: o.rulesText, receipt, carry, source, chain });
}
