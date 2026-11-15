import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import type { SerializedIx } from "@/lib/burnticker/program";

/**
 * UNSIGNED TRANSACTIONS FROM A LAUNCH BUNDLE (2026-10-09, the public API + SDK). The launch bundle carries its instructions as
 * SerializedIx (program id, account metas, base64 data) so the wizard can show them; bots need wire-format transactions. This module
 * compiles them into legacy transactions with the creator as fee payer, NEVER signs, and serialises with an empty signature slot for
 * every required signer (the creator's wallet and the mint keypair). Pure apart from @solana/web3.js; the server and the SDK share it.
 *
 * BLOCKHASH. A transaction needs a recent blockhash before it is signed. The server has no RPC of its own in this build, so unless the
 * caller passes one it uses the all-ones placeholder and says so (`blockhashPlaceholder: true`); the SDK rebuilds the transaction from
 * `instructions` with a fresh blockhash from the bot's own RPC before signing. A wallet refuses (or the cluster rejects) a transaction
 * that still carries the placeholder, so it can never be sent by accident.
 */

/** The all-ones blockhash: syntactically valid, never a real recent blockhash. */
export const PLACEHOLDER_BLOCKHASH = "11111111111111111111111111111111";
/** Solana's packet limit for one serialised transaction. */
export const MAX_TX_BYTES = 1232;

export interface UnsignedTx {
  label: string;
  /** Who must sign: the creator's wallet ("creator") and the fresh mint keypair ("mint"). */
  signers: ("creator" | "mint")[];
  /** The whole unsigned transaction (base64 wire format, empty signatures), or null when it exceeds the packet limit. */
  transaction: string | null;
  /** The message alone (base64) — what each signer signs. */
  message: string;
  sizeBytes: number;
  oversize: boolean;
  recentBlockhash: string;
  blockhashPlaceholder: boolean;
  feePayer: string;
  instructions: SerializedIx[];
}

export const toInstruction = (s: SerializedIx): TransactionInstruction =>
  new TransactionInstruction({ programId: new PublicKey(s.programId), keys: s.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: Buffer.from(s.dataBase64, "base64") });

/** A legacy transaction from serialised instructions: fee payer = the creator, the given (or placeholder) blockhash. Unsigned. */
export function transactionFrom(instructions: readonly SerializedIx[], feePayer: string, recentBlockhash: string | null = null): Transaction {
  const tx = new Transaction();
  tx.feePayer = new PublicKey(feePayer);
  tx.recentBlockhash = recentBlockhash ?? PLACEHOLDER_BLOCKHASH;
  for (const ix of instructions) tx.add(toInstruction(ix));
  return tx;
}

/** Compiles every transaction of a bundle into unsigned wire format. Never signs. */
export function compileUnsigned(txs: readonly { label: string; signers: ("creator" | "mint")[]; instructions: SerializedIx[] }[], feePayer: string, recentBlockhash: string | null = null): UnsignedTx[] {
  return txs.map((t) => {
    const tx = transactionFrom(t.instructions, feePayer, recentBlockhash);
    const message = tx.serializeMessage();
    let wire: Buffer | null = null;
    try { wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false }); } catch { wire = null; }
    // Wire size = compact-u16 signature count + 64 bytes per required signature + the message.
    const sigCount = tx.compileMessage().header.numRequiredSignatures;
    const sizeBytes = (sigCount < 128 ? 1 : 2) + sigCount * 64 + message.length;
    return {
      label: t.label, signers: t.signers, transaction: wire ? wire.toString("base64") : null, message: message.toString("base64"), sizeBytes, oversize: sizeBytes > MAX_TX_BYTES,
      recentBlockhash: tx.recentBlockhash!, blockhashPlaceholder: !recentBlockhash, feePayer, instructions: t.instructions,
    };
  });
}
