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
 * one of the transaction's accounts, so nobody can hold another wallet's swaps. A record is removed by naming its signature (the panel
 * does that once the swap settles), and it lapses after RECORD_TTL_MS (the panel's own 24-hour release).
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
  get(network: Network, mint: string, owner: string, now = Date.now()): PendingSwap | null {
    const r = this.db.prepare("SELECT * FROM swap_pending WHERE k = ? AND at >= ?").get(SwapPendingStore.key(network, mint, owner), now - RECORD_TTL_MS) as { network: Network; mint: string; owner: string; signature: string; lvbh: number; side: Side; at: number } | undefined;
    return r ? { v: 1, network: r.network, mint: r.mint, owner: r.owner, signature: r.signature, lastValidBlockHeight: Number(r.lvbh), side: r.side, at: Number(r.at) } : null;
  }
  /** Removes the record only when it holds this signature (a settled swap); true when one was removed. */
  clear(network: Network, mint: string, owner: string, signature: string): boolean {
    return Number(this.db.prepare("DELETE FROM swap_pending WHERE k = ? AND signature = ?").run(SwapPendingStore.key(network, mint, owner), signature).changes) > 0;
  }
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
