import crypto from "node:crypto";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { ATTESTATION_DOMAIN, ED25519_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { formatDate, formatFixed, validDate } from "@/lib/burnReceipts/math";

/**
 * ATTESTED READINGS — N-of-M ed25519 attesters (level 2: the keeper's data key alone, quorum 1; level 2+: the keeper plus a second
 * operator and/or a relayer that posts zkTLS-verified readings, quorum 2).
 *
 * The canonical message every attester in the quorum signs is
 *
 *   BURNRECEIPTS-v3|<cluster genesis hash>|<program id>|<mint>|<feed_id>|prev=<previous date or none>|<YYYY-MM-DD>|<value>|src=<sha256(source URL), hex>|proof=<proof locator, hex>
 *
 * The genesis hash is the one the program BUILD enforces (TokenConfig.cluster_genesis): mainnet's for the default build, devnet's for
 * the `devnet` build (review-2 F12).
 *
 * — the program rebuilds exactly this string from its stored feed id and the instruction's (record_date, value, source_url_hash,
 * proof_hash) and counts the distinct attesters whose ed25519 signature over it appears in an Ed25519SigVerify instruction of the
 * same transaction. It verifies nothing else: the source hash and the zkTLS proof locator are stored for off-chain verifiers.
 *
 * KEY HANDLING: `signAttestation` takes the 64-byte Solana secret key (seed ‖ public key) of the DATA key — a key whose only power
 * is to sign readings; it never holds funds and is not the cranker. The keeper loads it the way it loads its other keys; this module
 * never reads files or the environment.
 */

export const ZERO_HASH = new Uint8Array(32);

/** sha256 of the exact source URL the attesters read (UTF-8). */
export function sourceUrlHash(url: string): Buffer {
  return crypto.createHash("sha256").update(url, "utf8").digest();
}

/**
 * The signed bytes (v3 — review M-3 + L-1 + review-2 F12):
 *   BURNRECEIPTS-v3|<cluster genesis>|<program id>|<mint>|<feed_id>|prev=<YYYY-MM-DD of the previous reading, or "none">|<YYYY-MM-DD>|<value>|src=<hex>|proof=<hex>
 * Genesis + program id + mint make a (public) signature useless on any other cluster, token or deployment; prev fixes the order of
 * pre-signed readings. `genesisHash` is base58 — pass the TokenConfig's `cluster_genesis` (what the program checks).
 */
export function attestationMessage(genesisHash: string | PublicKey, programId: PublicKey, mint: PublicKey, feedId: string, prevDate: number, recordDate: number, value: bigint, valueDecimals: number, srcHash: Uint8Array, proofHash: Uint8Array = ZERO_HASH): Buffer {
  const genesis = typeof genesisHash === "string" ? new PublicKey(genesisHash).toBase58() : genesisHash.toBase58();
  if (!feedId || feedId.length > 32 || /[|]/.test(feedId) || !/^[\x20-\x7e]+$/.test(feedId)) throw new Error("feed id must be 1-32 printable ASCII characters without '|'");
  if (!validDate(recordDate)) throw new Error(`record_date ${recordDate} is not a YYYYMMDD calendar date`);
  if (value <= BigInt(0)) throw new Error("value must be positive");
  if (srcHash.length !== 32 || Buffer.from(srcHash).equals(Buffer.alloc(32))) throw new Error("source_url_hash must be a non-zero sha256");
  if (proofHash.length !== 32) throw new Error("proof_hash must be 32 bytes");
  const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
  if (prevDate !== 0 && !validDate(prevDate)) throw new Error(`prev date ${prevDate} is not a YYYYMMDD calendar date`);
  const prev = prevDate === 0 ? "none" : formatDate(prevDate);
  return Buffer.from(`${ATTESTATION_DOMAIN}|${genesis}|${programId.toBase58()}|${mint.toBase58()}|${feedId}|prev=${prev}|${formatDate(recordDate)}|${formatFixed(value, valueDecimals)}|src=${hex(srcHash)}|proof=${hex(proofHash)}`, "utf8");
}

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** ed25519 signature of `message` with a 64-byte Solana secret key (or its 32-byte seed). */
export function signAttestation(secretKey: Uint8Array, message: Uint8Array): Buffer {
  if (secretKey.length !== 64 && secretKey.length !== 32) throw new Error("secret key must be 64 bytes (Solana keypair) or a 32-byte seed");
  const seed = Buffer.from(secretKey.subarray(0, 32));
  const key = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
  return crypto.sign(null, Buffer.from(message), key);
}

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyAttestation(publicKey: PublicKey, message: Uint8Array, signature: Uint8Array): boolean {
  const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, publicKey.toBuffer()]), format: "der", type: "spki" });
  return crypto.verify(null, Buffer.from(message), key, Buffer.from(signature));
}

export interface AttestationEntry {
  publicKey: PublicKey;
  signature: Uint8Array;
  message: Uint8Array;
}

/**
 * Review-2 F4 — the SHARED-MESSAGE layout: ONE copy of the message and N (pubkey, signature) entries whose message offsets all point
 * at it; every offset inside the instruction itself (instruction index 0xFFFF). Quorum 3 then fits a legacy transaction
 * (≈ 1,190 bytes with the v3 message); the per-signature layout did not fit even quorum 2. Place it anywhere before `submit_reading`
 * in the same transaction.
 */
export function ed25519SharedMessageInstruction(message: Uint8Array, signatures: { publicKey: PublicKey; signature: Uint8Array }[]): TransactionInstruction {
  const n = signatures.length;
  if (n === 0 || n > 255) throw new Error("1-255 signatures per instruction");
  const header = 2 + n * 14;
  const msgOff = header + n * 96;
  if (msgOff + message.length > 0xffff) throw new Error("ed25519 instruction too large");
  const offsets = Buffer.alloc(header);
  offsets[0] = n;
  const parts: Buffer[] = [];
  signatures.forEach((e, i) => {
    if (e.signature.length !== 64) throw new Error("signature must be 64 bytes");
    const pkOff = header + i * 96;
    const sigOff = pkOff + 32;
    const o = 2 + i * 14;
    offsets.writeUInt16LE(sigOff, o);
    offsets.writeUInt16LE(0xffff, o + 2);
    offsets.writeUInt16LE(pkOff, o + 4);
    offsets.writeUInt16LE(0xffff, o + 6);
    offsets.writeUInt16LE(msgOff, o + 8);
    offsets.writeUInt16LE(message.length, o + 10);
    offsets.writeUInt16LE(0xffff, o + 12);
    parts.push(e.publicKey.toBuffer(), Buffer.from(e.signature));
  });
  return new TransactionInstruction({ programId: ED25519_PROGRAM_ID, keys: [], data: Buffer.concat([offsets, ...parts, Buffer.from(message)]) });
}

/**
 * ONE Ed25519SigVerify instruction for several signatures. When every entry signs the same bytes (the normal case: one canonical
 * message per reading) this is the shared-message layout above; entries over DIFFERENT messages fall back to one copy per entry.
 */
export function ed25519VerifyInstruction(entries: AttestationEntry[]): TransactionInstruction {
  if (entries.length === 0 || entries.length > 255) throw new Error("1-255 signatures per instruction");
  const first = Buffer.from(entries[0].message);
  if (entries.every((e) => first.equals(Buffer.from(e.message)))) return ed25519SharedMessageInstruction(first, entries);
  const header = 2 + entries.length * 14;
  const parts: Buffer[] = [];
  const offsets = Buffer.alloc(header);
  offsets[0] = entries.length;
  let at = header;
  entries.forEach((e, i) => {
    if (e.signature.length !== 64) throw new Error("signature must be 64 bytes");
    const pk = e.publicKey.toBuffer(), sig = Buffer.from(e.signature), msg = Buffer.from(e.message);
    const pkOff = at; at += 32;
    const sigOff = at; at += 64;
    const msgOff = at; at += msg.length;
    if (at > 0xffff) throw new Error("ed25519 instruction too large");
    const o = 2 + i * 14;
    offsets.writeUInt16LE(sigOff, o);
    offsets.writeUInt16LE(0xffff, o + 2);
    offsets.writeUInt16LE(pkOff, o + 4);
    offsets.writeUInt16LE(0xffff, o + 6);
    offsets.writeUInt16LE(msgOff, o + 8);
    offsets.writeUInt16LE(msg.length, o + 10);
    offsets.writeUInt16LE(0xffff, o + 12);
    parts.push(pk, sig, msg);
  });
  return new TransactionInstruction({ programId: ED25519_PROGRAM_ID, keys: [], data: Buffer.concat([offsets, ...parts]) });
}

/** Convenience: sign the canonical message with each data key and pack the (shared-message) verify instruction. */
export function attestReading(o: { genesisHash: string | PublicKey; programId: PublicKey; mint: PublicKey; feedId: string; prevDate: number; recordDate: number; value: bigint; valueDecimals: number; sourceUrlHash: Uint8Array; proofHash?: Uint8Array; signers: { publicKey: PublicKey; secretKey: Uint8Array }[] }): { message: Buffer; instruction: TransactionInstruction; entries: AttestationEntry[] } {
  const message = attestationMessage(o.genesisHash, o.programId, o.mint, o.feedId, o.prevDate, o.recordDate, o.value, o.valueDecimals, o.sourceUrlHash, o.proofHash ?? ZERO_HASH);
  const entries = o.signers.map((s) => ({ publicKey: s.publicKey, signature: signAttestation(s.secretKey, message), message }));
  return { message, instruction: ed25519SharedMessageInstruction(message, entries), entries };
}
