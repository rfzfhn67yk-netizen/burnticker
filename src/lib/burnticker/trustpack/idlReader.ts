import type { AnchorIdl, IdlType } from "@/lib/burnReceipts/idlTypes";
import { b58encode } from "@/lib/burnticker/trustpack/base58";

/**
 * A BROWSER-SAFE ACCOUNT READER DRIVEN BY THE PROGRAM'S OWN IDL (trust pack, 2026-10-10). The same walk as
 * src/lib/burnReceipts/idlCoder.ts#decodeAccount — discriminator check, then borsh in IDL field order — over a Uint8Array instead of a
 * Buffer, with public keys returned as base58 strings instead of web3.js PublicKeys. Nothing here hand-writes a byte layout: a
 * program change that is not re-synced into idl.ts fails the drift test (test/burntickerTrustPackVerifier.test.ts decodes the same
 * devnet accounts with both readers and compares every field).
 */

export type Plain = number | bigint | boolean | string | Uint8Array | Plain[] | { [k: string]: Plain } | null;

const INT: Record<string, [number, boolean]> = { u8: [1, false], i8: [1, true], u16: [2, false], i16: [2, true], u32: [4, false], i32: [4, true], u64: [8, false], i64: [8, true], u128: [16, false], i128: [16, true] };

class Reader {
  at: number;
  private b: Uint8Array;
  constructor(b: Uint8Array, at = 0) { this.b = b; this.at = at; }
  take(n: number): Uint8Array {
    if (this.at + n > this.b.length) throw new Error(`borsh: read past the end (${this.at}+${n} > ${this.b.length})`);
    const s = this.b.subarray(this.at, this.at + n); this.at += n; return s;
  }
  int(bytes: number, signed: boolean): bigint {
    const s = this.take(bytes);
    let x = BigInt(0);
    for (let i = bytes - 1; i >= 0; i--) x = (x << BigInt(8)) | BigInt(s[i]);
    if (signed && s[bytes - 1] & 0x80) x -= BigInt(1) << BigInt(bytes * 8);
    return x;
  }
}

function read(idl: AnchorIdl, r: Reader, t: IdlType): Plain {
  if (typeof t === "string") {
    if (t in INT) { const [n, s] = INT[t]; const x = r.int(n, s); return n <= 4 ? Number(x) : x; }
    if (t === "bool") return r.take(1)[0] !== 0;
    if (t === "pubkey") return b58encode(r.take(32));
    if (t === "string") { const n = Number(r.int(4, false)); return new TextDecoder().decode(r.take(n)); }
    if (t === "bytes") { const n = Number(r.int(4, false)); return new Uint8Array(r.take(n)); }
    throw new Error(`unsupported type ${t}`);
  }
  if ("vec" in t) { const n = Number(r.int(4, false)); return Array.from({ length: n }, () => read(idl, r, t.vec)); }
  if ("array" in t) {
    const [inner, len] = t.array;
    if (inner === "u8") return new Uint8Array(r.take(len));
    return Array.from({ length: len }, () => read(idl, r, inner));
  }
  if ("option" in t) return r.take(1)[0] === 0 ? null : read(idl, r, t.option);
  if ("defined" in t) {
    const d = idl.types.find((x) => x.name === t.defined.name);
    if (!d) throw new Error(`IDL has no type ${t.defined.name}`);
    if (d.type.kind !== "struct") throw new Error("enums are not used by this program");
    const o: Record<string, Plain> = {};
    for (const f of d.type.fields) o[f.name] = read(idl, r, f.type);
    return o;
  }
  throw new Error("unsupported IDL type");
}

/** The IDL's 8-byte discriminator for an account name. */
export function discriminatorOf(idl: AnchorIdl, name: string): Uint8Array {
  const acc = idl.accounts.find((a) => a.name === name);
  if (!acc) throw new Error(`IDL has no account ${name}`);
  return Uint8Array.from(acc.discriminator);
}

/** True when `data` starts with the account's discriminator. */
export function isAccount(idl: AnchorIdl, name: string, data: Uint8Array): boolean {
  const d = discriminatorOf(idl, name);
  return data.length >= 8 && d.every((x, i) => data[i] === x);
}

/** Decodes an account after checking its discriminator; throws on a mismatch (a wrong account must never decode). */
export function readAccount<T = Record<string, Plain>>(idl: AnchorIdl, name: string, data: Uint8Array): T {
  if (!isAccount(idl, name, data)) throw new Error(`not a ${name} account (discriminator mismatch)`);
  return read(idl, new Reader(data, 8), { defined: { name } }) as T;
}
