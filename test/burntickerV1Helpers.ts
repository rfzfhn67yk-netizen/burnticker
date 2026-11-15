// A VERSION-1 MESSAGE ON THE WIRE (Phantom v1 scope step 0, 2026-10-19). @solana/web3.js 1.99.0 deserializes v1 messages
// (MessageV1.deserialize) but refuses to serialize them, so the tests that need landed v1 bytes encode them here, byte for byte as
// web3.js's own decoder reads them (SIMD-0298): 0x81, the header, a u32 config mask, the blockhash, the instruction count, the static
// keys, the config fields the mask names (priority fee u64, compute unit limit u32, loaded-accounts data size u32, heap u32), then the
// instruction headers and the instruction bodies. Not a test file itself.
import { PublicKey, type MessageHeader, type MessageCompiledInstruction, type TransactionConfig } from "@solana/web3.js";

const PRIORITY_FEE_BITS = 0b00011, COMPUTE_UNIT_LIMIT_BIT = 0b00100, LOADED_ACCOUNTS_DATA_SIZE_LIMIT_BIT = 0b01000, HEAP_SIZE_BIT = 0b10000;
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const u64 = (n: number) => { const b = new Uint8Array(8); let v = BigInt(n); for (let i = 0; i < 8; i++) { b[i] = Number(v & BigInt(0xff)); v >>= BigInt(8); } return [...b]; };

export function encodeV1Message(m: { header: MessageHeader; recentBlockhash: string; staticAccountKeys: PublicKey[]; compiledInstructions: MessageCompiledInstruction[]; transactionConfig: TransactionConfig }): Uint8Array {
  const c = m.transactionConfig;
  const mask = (c.priorityFee !== null ? PRIORITY_FEE_BITS : 0) | (c.computeUnitLimit !== null ? COMPUTE_UNIT_LIMIT_BIT : 0) | (c.loadedAccountsDataSizeLimit !== null ? LOADED_ACCOUNTS_DATA_SIZE_LIMIT_BIT : 0) | (c.heapSize !== null ? HEAP_SIZE_BIT : 0);
  if (m.staticAccountKeys.length > 255 || m.compiledInstructions.length > 255) throw new Error("v1 message: too many keys or instructions for one byte");
  const out: number[] = [0x81, m.header.numRequiredSignatures, m.header.numReadonlySignedAccounts, m.header.numReadonlyUnsignedAccounts, ...u32(mask), ...new PublicKey(m.recentBlockhash).toBytes(), m.compiledInstructions.length, m.staticAccountKeys.length];
  for (const k of m.staticAccountKeys) out.push(...k.toBytes());
  if (c.priorityFee !== null) out.push(...u64(c.priorityFee));
  if (c.computeUnitLimit !== null) out.push(...u32(c.computeUnitLimit));
  if (c.loadedAccountsDataSizeLimit !== null) out.push(...u32(c.loadedAccountsDataSizeLimit));
  if (c.heapSize !== null) out.push(...u32(c.heapSize));
  for (const ix of m.compiledInstructions) { if (ix.data.length > 0xffff) throw new Error("v1 message: instruction data over 65,535 bytes"); out.push(ix.programIdIndex, ix.accountKeyIndexes.length, ix.data.length & 0xff, ix.data.length >>> 8); }
  for (const ix of m.compiledInstructions) out.push(...ix.accountKeyIndexes, ...ix.data);
  return Uint8Array.from(out);
}
