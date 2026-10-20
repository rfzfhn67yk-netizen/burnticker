import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { VersionedTransaction } from "@solana/web3.js";
import type { Network, Side } from "@/lib/burnticker/swap/plan";
import type { PendingSwap } from "@/lib/burnticker/swap/pending";

/**
 * THE SERVER'S COPY OF A WALLET'S HELD SWAP (continuous audit 2026-10-19 SEC-02). The swap panel keeps a signed swap's identity in the
 * browser (swap/pending.ts) and refuses to send when it cannot write and read that record back. This is a second, durable copy, so a
 * browser whose site data was cleared after an ambiguous send still finds the held swap when the panel mounts again, and settles it
 * before anything new is sent.
 *
 * What is kept, per network + coin + wallet: the swap's signature, its blockhash expiry, its side and when it was received. Nothing
 * else: no amount, no IP, no transaction bytes. A record is written only from the SIGNED transaction itself (posted before it is sent):
 * the fee payer's ed25519 signature over the message must verify, the fee payer must be the wallet named, and the coin's mint must be
 * one of the transaction's accounts, so nobody can hold another wallet's swaps. A record is removed by naming its signature once the
 * chain shows the swap can no longer land (HB-65, heldState below; the panel asks once the swap settles), and it lapses after
 * RECORD_TTL_MS (the panel's own 24-hour release). While it may still land, a read shows it sealed, without the signature.
 */
export const RECORD_TTL_MS = 24 * 3_600_000 + 10 * 60_000;
export const MAX_RECORDS = 50_000;
export const SWAP_PENDING_FILE = path.join("data", "burnticker-swap-pending.db");

const PUB = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0")), out = "";
  while (n > BigInt(0)) { out = ALPHABET[Number(n % BigInt(58))] + out; n /= BigInt(58); }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}
const isNetwork = (x: unknown): x is Network => x === "mainnet" || x === "devnet";
const isSide = (x: unknown): x is Side => x === "sol-in" || x === "tokens-in";

/** Checks a posted claim against its own signed transaction; the record to keep, or why it was refused. */
export function verifyPendingClaim(body: unknown, now = Date.now()): { ok: true; rec: PendingSwap } | { ok: false; reason: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isNetwork(b.network) || typeof b.mint !== "string" || !PUB.test(b.mint) || typeof b.owner !== "string" || !PUB.test(b.owner)) return { ok: false, reason: "The record needs a network, a coin and a wallet." };
  if (typeof b.signature !== "string" || !SIG.test(b.signature) || !Number.isInteger(b.lastValidBlockHeight) || (b.lastValidBlockHeight as number) < 0 || !isSide(b.side)) return { ok: false, reason: "The record needs the swap's signature, its expiry and its side." };
  if (typeof b.tx !== "string" || b.tx.length > 4_000) return { ok: false, reason: "The record needs the signed transaction." };
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(Buffer.from(b.tx, "base64")); } catch { return { ok: false, reason: "The signed transaction could not be read." }; }
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  const sig = tx.signatures[0];
  if (!sig || keys[0] !== b.owner) return { ok: false, reason: "The transaction is not paid by this wallet." };
  if (base58(sig) !== b.signature) return { ok: false, reason: "The signature does not match the transaction." };
  if (!keys.includes(b.mint)) return { ok: false, reason: "The transaction does not touch this coin." };
  try {
    const key = crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(tx.message.staticAccountKeys[0].toBytes()).toString("base64url") }, format: "jwk" });
    if (!crypto.verify(null, Buffer.from(tx.message.serialize()), key, Buffer.from(sig))) return { ok: false, reason: "The wallet's signature does not verify." };
  } catch { return { ok: false, reason: "The wallet's signature does not verify." }; }
  return { ok: true, rec: { v: 1, network: b.network, mint: b.mint, owner: b.owner, signature: b.signature, lastValidBlockHeight: b.lastValidBlockHeight as number, side: b.side, at: now } };
}

/** The store: node:sqlite, one row per network + coin + wallet. `file` ":memory:" in the tests. */
export class SwapPendingStore {
  private db: DatabaseSync;
  constructor(file: string = SWAP_PENDING_FILE) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("CREATE TABLE IF NOT EXISTS swap_pending (k TEXT PRIMARY KEY, network TEXT NOT NULL, mint TEXT NOT NULL, owner TEXT NOT NULL, signature TEXT NOT NULL, lvbh INTEGER NOT NULL, side TEXT NOT NULL, at INTEGER NOT NULL)");
  }
  private static key(network: string, mint: string, owner: string): string { return `${network}:${mint}:${owner}`; }
  put(rec: PendingSwap, now = Date.now()): void {
    this.db.prepare("DELETE FROM swap_pending WHERE at < ?").run(now - RECORD_TTL_MS);
    const n = Number((this.db.prepare("SELECT COUNT(*) AS n FROM swap_pending").get() as { n: number }).n);
    if (n >= MAX_RECORDS) this.db.prepare("DELETE FROM swap_pending WHERE k IN (SELECT k FROM swap_pending ORDER BY at ASC LIMIT ?)").run(n - MAX_RECORDS + 1);
    this.db.prepare("INSERT OR REPLACE INTO swap_pending (k, network, mint, owner, signature, lvbh, side, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(SwapPendingStore.key(rec.network, rec.mint, rec.owner), rec.network, rec.mint, rec.owner, rec.signature, rec.lastValidBlockHeight, rec.side, rec.at);
  }
  /**
   * HB-65 v2 (auditor's replay follow-up, 2026-10-19): the write the route uses, one sqlite transaction. A record already held for this
   * network + coin + wallet is replaced only when it is the one the caller saw settled on chain (`settledSignature`); the same signature
   * again changes nothing (its first expiry stays); any other case keeps the record ("held"). So a replayed older transaction never
   * replaces an unresolved hold, a replay never re-dates one, and two different signatures posted at once leave one record.
   */
  putIfCurrent(rec: PendingSwap, settledSignature: string | null, now = Date.now()): "written" | "same" | "held" {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM swap_pending WHERE at < ?").run(now - RECORD_TTL_MS);
      const row = this.db.prepare("SELECT signature FROM swap_pending WHERE k = ?").get(SwapPendingStore.key(rec.network, rec.mint, rec.owner)) as { signature: string } | undefined;
      if (row && row.signature === rec.signature) { this.db.exec("COMMIT"); return "same"; }
      if (row && row.signature !== settledSignature) { this.db.exec("COMMIT"); return "held"; }
      this.put(rec, now);
      this.db.exec("COMMIT");
      return "written";
    } catch (e) { try { this.db.exec("ROLLBACK"); } catch { /* already ended */ } throw e; }
  }
  get(network: Network, mint: string, owner: string, now = Date.now()): PendingSwap | null {
    const r = this.db.prepare("SELECT * FROM swap_pending WHERE k = ? AND at >= ?").get(SwapPendingStore.key(network, mint, owner), now - RECORD_TTL_MS) as { network: Network; mint: string; owner: string; signature: string; lvbh: number; side: Side; at: number } | undefined;
    return r ? { v: 1, network: r.network, mint: r.mint, owner: r.owner, signature: r.signature, lastValidBlockHeight: Number(r.lvbh), side: r.side, at: Number(r.at) } : null;
  }
  /** Removes the record only when it holds this signature (a settled swap); true when one was removed. */
  clear(network: Network, mint: string, owner: string, signature: string): boolean {
    return Number(this.db.prepare("DELETE FROM swap_pending WHERE k = ? AND signature = ?").run(SwapPendingStore.key(network, mint, owner), signature).changes) > 0;
  }
}

/**
 * HB-65 (sixth pre-launch audit 2026-10-19, AP6-4, and the auditor's follow-up): a held swap's signature is not a secret (the GET used to
 * hand it to anyone who named the wallet, and it is on chain once the swap lands), so it can never authorize removing the record. The
 * server now decides from the chain itself, with its own RPC reader:
 *   settled   the signature is confirmed or failed on chain, or the chain is past its blockhash expiry and the swap is nowhere: it can
 *             no longer land, so the record has done its job. Only then may a DELETE remove it, and only then does a read show it whole.
 *   pending   it may still land. A DELETE is refused (403 "swap-unsettled") and the record stays; a read gets the record SEALED: that a
 *             swap from this wallet is held, with no signature, so the owner's panel waits (Check again) and nobody else learns it.
 *   unknown   the chain could not be read: treated like pending (a DELETE answers 503 and keeps the record).
 * This keeps the owner's recovery after a cleared browser: the panel's read sees a sealed hold while the swap can still land, and the
 * whole record once it cannot, which it settles and clears as before.
 */
export type HeldState = "settled" | "pending" | "unknown";
export interface SwapChainReader {
  getSignatureStatuses(sigs: string[], config?: { searchTransactionHistory: boolean }): Promise<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>;
  getBlockHeight(commitment?: "confirmed"): Promise<number>;
}
/** The same margin the panel uses (swap/chain.ts EXPIRY_MARGIN_BLOCKS): this far past its expiry height a swap cannot land. */
export const HELD_EXPIRY_MARGIN_BLOCKS = 150;
/** A recent blockhash is valid for 150 blocks; one the wallet signed before the save expires no later than the height at save plus this. */
export const BLOCKHASH_WINDOW_BLOCKS = 150;

/**
 * HB-65 v2: the expiry the server keeps for a new record. The posted lastValidBlockHeight is the client's word, and a replay of the
 * same signed bytes could post 0 to make a live swap look expired. The server reads the chain's height at save and keeps height + the
 * blockhash window, which is never earlier than the real expiry (the blockhash was fetched before the save). Only when the chain cannot
 * be read is the posted value kept; either way it is fixed on first save (putIfCurrent never re-dates a signature it holds).
 */
export async function trustedExpiry(chain: SwapChainReader | null, posted: number): Promise<number> {
  if (!chain) return posted;
  try { return (await chain.getBlockHeight("confirmed")) + BLOCKHASH_WINDOW_BLOCKS; } catch { return posted; }
}

/** Whether the held swap `rec` can still land, from the chain (the panel's reconcileSubmitted judgement, read by the server). */
export async function heldState(chain: SwapChainReader | null, rec: Pick<PendingSwap, "signature" | "lastValidBlockHeight">): Promise<HeldState> {
  if (!chain) return "unknown";
  try {
    const status = async () => (await chain.getSignatureStatuses([rec.signature], { searchTransactionHistory: true })).value[0] ?? null;
    const final = (st: { err: unknown; confirmationStatus?: string } | null) => !!st && (!!st.err || st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized");
    // the height first: a status read after it that still finds nothing proves the transaction can no longer land
    const height = await chain.getBlockHeight("confirmed");
    const st = await status();
    if (final(st)) return "settled";
    if (st || height <= rec.lastValidBlockHeight + HELD_EXPIRY_MARGIN_BLOCKS) return "pending";
    const again = await status();
    if (final(again)) return "settled";
    if (again) return "pending";
    return "settled";   // past its expiry and seen nowhere on two reads: it can no longer land
  } catch { return "unknown"; }
}

/** What a read shows of a record that may still land: that a swap is held for this wallet and coin, never its signature. */
export interface SealedHold { v: 1; network: Network; mint: string; owner: string; sealed: true; side: Side; at: number }
export const sealedHold = (rec: PendingSwap): SealedHold => ({ v: 1, network: rec.network, mint: rec.mint, owner: rec.owner, sealed: true, side: rec.side, at: rec.at });

let chainOverride: ((network: Network) => SwapChainReader | null) | null = null;
const chains = new Map<Network, SwapChainReader>();
/** Tests: the chain reader the route uses (null restores the RPC). */
export function setSwapPendingChainForTests(f: ((network: Network) => SwapChainReader | null) | null): void { chainOverride = f; }
/** The server's read-only chain reader for `network` (networks.ts rpcUrlFor: the host's RPC on its own network, else the public one). */
export async function swapPendingChain(network: Network): Promise<SwapChainReader | null> {
  if (chainOverride) return chainOverride(network);
  const have = chains.get(network);
  if (have) return have;
  try {
    const [{ Connection }, { rpcUrlFor }] = await Promise.all([import("@solana/web3.js"), import("@/lib/burnticker/networks")]);
    const c = new Connection(rpcUrlFor(network), "confirmed") as unknown as SwapChainReader;
    chains.set(network, c);
    return c;
  } catch { return null; }
}

let shared: SwapPendingStore | null = null;
/** The web process's store (BURNTICKER_SWAP_PENDING_DB, else data/burnticker-swap-pending.db). */
export function swapPendingStore(env: Readonly<Record<string, string | undefined>> = process.env): SwapPendingStore {
  return (shared ??= new SwapPendingStore((env.BURNTICKER_SWAP_PENDING_DB ?? "").trim() || SWAP_PENDING_FILE));
}
export const queryOf = (q: URLSearchParams): { network: Network; mint: string; owner: string } | null => {
  const network = q.get("network"), mint = q.get("mint") ?? "", owner = q.get("owner") ?? "";
  return isNetwork(network) && PUB.test(mint) && PUB.test(owner) ? { network, mint, owner } : null;
};
export const clearOf = (body: unknown): { network: Network; mint: string; owner: string; signature: string } | null => {
  const b = (body ?? {}) as Record<string, unknown>;
  return isNetwork(b.network) && typeof b.mint === "string" && PUB.test(b.mint) && typeof b.owner === "string" && PUB.test(b.owner) && typeof b.signature === "string" && SIG.test(b.signature) ? { network: b.network, mint: b.mint, owner: b.owner, signature: b.signature } : null;
};
