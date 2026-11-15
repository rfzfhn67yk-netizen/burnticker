// The synthetic creator's stub chain (--chain stub): the bytes of an address lookup table account holding the expected entries, frozen,
// so the signing card's table check (lookupTable.ts verifiedLookupTable) passes against a host that pins a placeholder address.
import { PublicKey } from "@solana/web3.js";
import { lookupTableKeys } from "@/lib/burnticker/lookupTable";
import type { Network } from "@/lib/burnticker/networks";

export const expectedEntries = (network: Network): string[] => lookupTableKeys(network);

/** The on-chain layout (56-byte meta + 32 bytes per address): type 1, deactivation slot u64::MAX (active), no authority (frozen). */
export function fabricatedLookupTableData(addresses: readonly string[]): Buffer {
  const b = Buffer.alloc(56 + 32 * addresses.length);
  b.writeUInt32LE(1, 0);
  b.writeBigUInt64LE(BigInt("18446744073709551615"), 4);
  b.writeBigUInt64LE(BigInt(0), 12);
  b.writeUInt8(0, 20);
  b.writeUInt8(0, 21);   // authority: none
  addresses.forEach((a, i) => Buffer.from(new PublicKey(a).toBytes()).copy(b, 56 + 32 * i));
  return b;
}
