/**
 * BASE58 + BYTE HELPERS FOR THE BROWSER (trust pack, 2026-10-10). The receipt verifier on /burnticker/check runs in the visitor's
 * browser, so it cannot lean on Node's Buffer or on @solana/web3.js (a large bundle for three helpers). These are the same
 * algorithms the evidence verifier (scripts/ops/verify-evidence-signatures.mjs) and src/lib/burnReceipts/accounts.ts#bs58 use;
 * test/burntickerTrustPackVerifier.test.ts pins them against both.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function b58encode(bytes: Uint8Array): string {
  let x = BigInt(0);
  for (const b of bytes) x = (x << BigInt(8)) | BigInt(b);
  let out = "";
  while (x > BigInt(0)) { out = ALPHABET[Number(x % BigInt(58))] + out; x /= BigInt(58); }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}

export function b58decode(s: string): Uint8Array | null {
  if (!s || !B58.test(s)) return null;
  let n = BigInt(0);
  for (const c of s) n = n * BigInt(58) + BigInt(ALPHABET.indexOf(c));
  const bytes: number[] = [];
  while (n > BigInt(0)) { bytes.unshift(Number(n % BigInt(256))); n /= BigInt(256); }
  for (const c of s) { if (c !== "1") break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}

export const isPubkey = (s: unknown): s is string => typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && b58decode(s)?.length === 32;
export const isSignature = (s: unknown): s is string => typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(s) && b58decode(s)?.length === 64;

export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** sha256 through WebCrypto (browser and Node ≥ 19 both expose globalThis.crypto.subtle). */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const d = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return toHex(new Uint8Array(d));
}
