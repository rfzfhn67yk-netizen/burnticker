// Phantom v1 step 3 (devnet, 2026-10-20): the owner's real-Phantom launch on the v1 build stopped at step 2 with "Step 2 of 2 was not sent
// because this site could not record it first": verifySentCreate re-serialized the signed message with web3.js 1.99, which cannot
// serialize version-1 messages. It now checks the signatures against the signed bytes sliced from the raw transaction, for both layouts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { signedMessageBytes, verifySentCreate } from "@/lib/burnticker/launchPending";
import { encodeV1Message } from "./burntickerV1Helpers.ts";

const sign = (msg: Uint8Array, kp: Keypair) => new Uint8Array(crypto.sign(null, Buffer.from(msg), crypto.createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(kp.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" })));
const BLOCKHASH = new PublicKey(new Uint8Array(32).fill(7)).toBase58();

function v1Tx(signers: Keypair[], other: PublicKey): Uint8Array {
  const msg = encodeV1Message({
    header: { numRequiredSignatures: signers.length, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
    recentBlockhash: BLOCKHASH,
    staticAccountKeys: [...signers.map((s) => s.publicKey), other, SystemProgram.programId],
    compiledInstructions: [{ programIdIndex: signers.length + 1, accountKeyIndexes: [0, signers.length], data: new Uint8Array([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]) }],
    transactionConfig: { priorityFee: null, computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: null, heapSize: null },
  });
  const sigs = signers.map((s) => sign(msg, s));
  return Uint8Array.from([...msg, ...sigs.flatMap((x) => [...x])]);
}

describe("verifySentCreate reads version-1 transactions (Phantom v1 step 3)", () => {
  const creator = Keypair.generate(), mint = Keypair.generate(), other = Keypair.generate().publicKey;
  test("a version-1 create signed by the creator and the mint verifies, and its id is the first signature", () => {
    const raw = v1Tx([creator, mint], other);
    assert.equal(VersionedTransaction.deserialize(raw).version, 1);
    const r = verifySentCreate({ mint: mint.publicKey.toBase58(), creator: creator.publicKey.toBase58(), poolId: null }, Buffer.from(raw).toString("base64"));
    assert.equal(r.ok, true, JSON.stringify(r));
  });
  test("a version-1 transaction with a wrong signature is refused, not thrown", () => {
    const raw = v1Tx([creator, mint], other); raw[raw.length - 1] ^= 0xff;
    const r = verifySentCreate({ mint: mint.publicKey.toBase58(), creator: creator.publicKey.toBase58(), poolId: null }, Buffer.from(raw).toString("base64"));
    assert.equal(r.ok, false); assert.equal((r as { status: number }).status, 422);
  });
  test("a version-0 create still verifies the same way", () => {
    const msg = new TransactionMessage({ payerKey: creator.publicKey, recentBlockhash: BLOCKHASH, instructions: [SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: mint.publicKey, lamports: 1 }), SystemProgram.transfer({ fromPubkey: mint.publicKey, toPubkey: other, lamports: 1 })] }).compileToV0Message();
    const tx = new VersionedTransaction(msg); tx.sign([creator, mint]);
    const r = verifySentCreate({ mint: mint.publicKey.toBase58(), creator: creator.publicKey.toBase58(), poolId: null }, Buffer.from(tx.serialize()).toString("base64"));
    assert.equal(r.ok, true, JSON.stringify(r));
  });
  test("signedMessageBytes: v1 strips trailing signatures, v0 strips the leading count and signatures, short input is null", () => {
    const raw = v1Tx([creator], other);
    assert.equal(signedMessageBytes(raw, 1)!.length, raw.length - 64);
    assert.equal(signedMessageBytes(Uint8Array.from([0x81, 1]), 1), null);
    assert.equal(signedMessageBytes(Uint8Array.from([1, ...new Uint8Array(10)]), 1), null);
  });
});
