import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";

/**
 * THE KEEPER'S KEY FILE (2026-10-09). THIS FILE CONTAINS NO KEY. It reads the keeper's own signing key from a file OUTSIDE the
 * repository, in one of two formats:
 *
 *   plain       a `solana-keygen` JSON array of 64 bytes, or a base58 string (wallet exports)
 *   encrypted   `*.enc.json`: { encrypted: true, salt, iv, tag, ciphertext } base64 — AES-256-GCM under an scrypt key (N=16384,
 *               r=8, p=1, Node's defaults), the cleartext a JSON array of the 64 secret bytes; the passphrase comes from
 *               BURNKEEPER_SIGNER_PASSPHRASE (or AUTONOMOUS_SIGNER_PASSPHRASE)
 *
 * Refusals, all BEFORE the file is read: a path inside the repository (one `git add -A` from being published), a file readable by
 * group or others (already disclosed), anything but a regular file. Error messages describe the shape of what was found, never
 * its content — they reach logs. The same format and the same refusals as the private trading signer this was split from, so a
 * key made by `scripts/burnkeeper-keygen.mjs` loads here unchanged; the split exists so the public keeper has no import from
 * the private trading code.
 */

export const DEFAULT_KEY_DIR = path.join(os.homedir(), ".config", "meme-coin-trader");
export const BURNKEEPER_SIGNER_DEFAULT = path.join(DEFAULT_KEY_DIR, "signer-burnkeeper.enc.json");

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(input: string): Uint8Array {
  if (typeof input !== "string" || input.length === 0) throw new Error("base58: empty input");
  const bytes = [0];
  for (const char of input) {
    const value = ALPHABET.indexOf(char);
    if (value === -1) throw new Error("base58: invalid character");
    let carry = value;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let i = 0; i < input.length && input[i] === "1"; i++) bytes.push(0);   // leading '1's are leading zero bytes
  return Uint8Array.from(bytes.reverse());
}

/** Reasons a key file must not be read (empty when acceptable). All of them at once, so one round trip reports every problem. */
export function keyFileObjections(keyPath: string, stat: fs.Stats, repoRoot: string): string[] {
  const objections: string[] = [];
  const resolved = path.resolve(keyPath);
  const relative = path.relative(path.resolve(repoRoot), resolved);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) objections.push(`${resolved} is inside the repository — keep the key outside it, e.g. ${BURNKEEPER_SIGNER_DEFAULT}`);
  if (!stat.isFile()) objections.push(`${resolved} is not a regular file`);
  if ((stat.mode & 0o077) !== 0) objections.push(`${resolved} is mode ${(stat.mode & 0o777).toString(8)} — readable beyond its owner. Run: chmod 600 ${resolved}`);
  return objections;
}

/** The two formats a Solana key is handed to you in: a JSON array of 64 bytes, or base58. Throws without echoing the input. */
export function parseSecretKey(contents: string): Uint8Array {
  const trimmed = contents.trim();
  if (trimmed.length === 0) throw new Error("key file is empty");
  let bytes: Uint8Array;
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); } catch { throw new Error("key file starts with '[' but is not valid JSON"); }
    if (!Array.isArray(parsed) || !parsed.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) throw new Error("key file JSON is not an array of bytes");
    bytes = Uint8Array.from(parsed as number[]);
  } else {
    try { bytes = base58Decode(trimmed); } catch { throw new Error("key file is neither a JSON byte array nor valid base58"); }
  }
  if (bytes.length !== 64) throw new Error(`key is ${bytes.length} bytes, expected 64 (a full keypair, not a 32-byte seed or a public key)`);
  return bytes;
}

export interface EncryptedKeyBundle { encrypted: true; salt: string; iv: string; tag: string; ciphertext: string }

/** Encrypts 64 secret bytes for a `*.enc.json` file. The cleartext buffer and the derived key are wiped before returning. */
export function encryptSecretKey(secret: Uint8Array, passphrase: string): EncryptedKeyBundle {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const clear = Buffer.from(JSON.stringify(Array.from(secret)), "utf8");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(clear), cipher.final()]);
  const bundle: EncryptedKeyBundle = { encrypted: true, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
  clear.fill(0); key.fill(0);
  return bundle;
}

/** Decrypts a `*.enc.json` bundle. One opaque error for every failure: a wrong passphrase must not be distinguishable from a corrupt file. */
export function decryptSecretKey(bundleJson: string, passphrase: string | undefined = process.env.BURNKEEPER_SIGNER_PASSPHRASE || process.env.AUTONOMOUS_SIGNER_PASSPHRASE): Uint8Array {
  if (!passphrase) throw new Error("encrypted signer passphrase is not configured (BURNKEEPER_SIGNER_PASSPHRASE)");
  try {
    const bundle = JSON.parse(bundleJson) as EncryptedKeyBundle;
    const key = crypto.scryptSync(passphrase, Buffer.from(bundle.salt, "base64"), 32);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(bundle.iv, "base64"));
    decipher.setAuthTag(Buffer.from(bundle.tag, "base64"));
    const clear = Buffer.concat([decipher.update(Buffer.from(bundle.ciphertext, "base64")), decipher.final()]);
    const parsed = parseSecretKey(clear.toString("utf8"));
    clear.fill(0); key.fill(0);
    return parsed;
  } catch { throw new Error("could not decrypt signing key"); }
}

// Keyed by resolved path: a single slot would hand the FIRST key loaded to a later caller asking for a different file.
const cache = new Map<string, Keypair>();

/** Loads the keypair once per process. Never called at import time, so the module can be exercised on a machine with no key. */
export function loadKeypair(o: { keyPath: string; repoRoot?: string; passphrase?: string }): Keypair {
  const resolvedPath = path.resolve(o.keyPath);
  const hit = cache.get(resolvedPath);
  if (hit) return hit;
  let stat: fs.Stats;
  try { stat = fs.statSync(o.keyPath); } catch { throw new Error(`no signing key at ${o.keyPath}. Create one OUTSIDE this repository with scripts/burnkeeper-keygen.mjs --new, or point BURNKEEPER_SIGNER_PATH at a key file of your own.`); }
  const objections = keyFileObjections(o.keyPath, stat, o.repoRoot ?? process.cwd());
  if (objections.length > 0) throw new Error(`refusing to load the signing key:\n  - ${objections.join("\n  - ")}`);
  const contents = fs.readFileSync(o.keyPath, "utf8");
  const secret = o.keyPath.endsWith(".enc.json") ? decryptSecretKey(contents, o.passphrase) : parseSecretKey(contents);
  // COPY BEFORE CONSTRUCTING, then wipe the original: web3.js keeps a reference to the array it is given for the secret half, so
  // zeroing the same buffer would leave a Keypair that reports the right address and signs with an all-zero key.
  const keypair = Keypair.fromSecretKey(Uint8Array.from(secret));
  secret.fill(0);
  cache.set(resolvedPath, keypair);
  return keypair;
}
