import { concat, keccak256, numberToHex, pad, recoverAddress, stringToHex, toHex } from "viem";
import { canonical } from "@/lib/burnticker/derby/spec";
import { numToDec } from "@/lib/burnticker/units";
import { sha256Hex } from "@/lib/burnticker/derby/pyth";

/**
 * REDSTONE AS A PRIMARY (coordinator follow-up, 2026-10-10): for a coin with no Pyth sponsored Solana account, no Hermes key on the host
 * and no Solana pool for the TWAP (the SHIB case), the value at a boundary is RedStone's signed data packages from the keyless gateway
 * `https://oracle-gateway-1.a.redstone.finance/data-packages/latest/redstone-primary-prod` (1,010 feeds on 10-10).
 *
 * VERIFIED, NOT TRUSTED. Each package is serialised exactly as RedStone signs it — dataFeedId (bytes32, UTF-8 right-padded) ‖ value
 * (uint256, value × 10^8) ‖ timestampMilliseconds (6 bytes) ‖ data-point value size 32 (4 bytes) ‖ data-point count 1 (3 bytes) — and the
 * secp256k1 signature is recovered over keccak256 of those bytes (viem). A package counts only when the recovered address is one of the
 * five redstone-primary-prod signers RedStone publishes (npm @redstone-finance/oracles-smartweave-contracts@0.8.0,
 * src/contracts/redstone-oracle-registry/initial-state.json, nodes with dataServiceId "redstone-primary-prod"); the value is the median of
 * at least REDSTONE_MIN_SIGNERS distinct verified signers. The proof keeps every package (signer, timestamp, value, signature) and the
 * sha256 of their canonical JSON.
 */

export const REDSTONE_PRIMARY_PROD_SIGNERS = [
  "0x8BB8F32Df04c8b654987DAaeD53D6B6091e3B774",
  "0xdEB22f54738d54976C4c0fe5ce6d408E40d88499",
  "0x51Ce04Be4b3E32572C4Ec9135221d0691Ba7d202",
  "0xDD682daEC5A90dD295d14DA4b0bec9281017b5bE",
  "0x9c5AE89C4Af6aA32cE58588DBaF90d18a855B6de",
] as const;
export const REDSTONE_MIN_SIGNERS = 3;

export interface RsPackageJson { timestampMilliseconds?: number; signature?: string; signerAddress?: string; dataPoints?: { dataFeedId?: string; value?: number }[] }

/** The bytes RedStone signs for a one-data-point numeric package. */
export function redstonePackageBytes(feed: string, value: number, timestampMs: number): `0x${string}` {
  const scaled = BigInt(Math.round(value * 1e8));
  return concat([pad(stringToHex(feed), { dir: "right", size: 32 }), pad(numberToHex(scaled), { size: 32 }), pad(numberToHex(timestampMs), { size: 6 }), pad(numberToHex(32), { size: 4 }), pad(numberToHex(1), { size: 3 })]);
}

/** The address that signed a package (null when the signature does not recover). */
export async function recoverRedstoneSigner(feed: string, p: RsPackageJson): Promise<string | null> {
  const dp = p.dataPoints?.find((d) => d.dataFeedId === feed);
  if (!dp || typeof dp.value !== "number" || typeof p.timestampMilliseconds !== "number" || typeof p.signature !== "string") return null;
  const sig = Buffer.from(p.signature, "base64");
  if (sig.length !== 65) return null;
  let v = sig[64]; if (v < 27) v += 27;
  try { return await recoverAddress({ hash: keccak256(redstonePackageBytes(feed, dp.value, p.timestampMilliseconds)), signature: { r: toHex(sig.subarray(0, 32)), s: toHex(sig.subarray(32, 64)), v: BigInt(v) } }); }
  catch { return null; }
}

export type RedstoneRead = { ok: true; value: string; timestampMs: number; proof: Record<string, unknown> } | { ok: false; reason: string };

/** The verified median for one feed from a gateway body. */
export async function redstonePrimary(body: unknown, feed: string, url: string): Promise<RedstoneRead> {
  const pkgs = (body as Record<string, RsPackageJson[] | undefined> | null)?.[feed] ?? [];
  if (!pkgs.length) return { ok: false, reason: `RedStone's primary-prod gateway carries no ${feed}` };
  const set = new Set(REDSTONE_PRIMARY_PROD_SIGNERS.map((a) => a.toLowerCase()));
  const verified: { signer: string; value: number; timestampMilliseconds: number; signature: string }[] = [];
  for (const p of pkgs) {
    const who = await recoverRedstoneSigner(feed, p);
    if (!who || !set.has(who.toLowerCase()) || (p.signerAddress && p.signerAddress.toLowerCase() !== who.toLowerCase())) continue;
    if (verified.some((x) => x.signer.toLowerCase() === who.toLowerCase())) continue;
    verified.push({ signer: who, value: p.dataPoints!.find((d) => d.dataFeedId === feed)!.value!, timestampMilliseconds: p.timestampMilliseconds!, signature: p.signature! });
  }
  if (verified.length < REDSTONE_MIN_SIGNERS) return { ok: false, reason: `RedStone: ${verified.length} package(s) of ${feed} verified against the primary-prod signer set (needs ${REDSTONE_MIN_SIGNERS})` };
  const vals = verified.map((x) => x.value).sort((a, b) => a - b);
  const mid = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
  const packages = verified.sort((a, b) => a.signer.localeCompare(b.signer));
  const ts = Math.max(...packages.map((x) => x.timestampMilliseconds));
  return { ok: true, value: numToDec(Number(mid.toPrecision(12))), timestampMs: ts, proof: { source: "redstone", route: "redstone", feed, url, signatureVerified: true, signerSet: "redstone-primary-prod (@redstone-finance/oracles-smartweave-contracts@0.8.0)", packages, packagesSha256: sha256Hex(canonical(packages)), timestampMs: ts } };
}
