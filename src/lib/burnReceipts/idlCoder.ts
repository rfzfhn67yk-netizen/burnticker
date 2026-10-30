import { PublicKey } from "@solana/web3.js";
import type { AnchorIdl, IdlType, IdlTypeDef } from "@/lib/burnReceipts/idlTypes";

/**
 * A minimal borsh coder driven by the program's own IDL (src/lib/burnReceipts/idl.ts, generated from `anchor build`). The client
 * never hand-writes a byte layout: instruction data, account decoding and discriminators all come from the IDL, so a program change
 * that is not re-synced fails the drift test instead of silently mis-encoding.
 *
 * Values: integers ≤ 32 bits are `number`; u64/i64/u128/i128 are `bigint`; pubkeys are `PublicKey`; fixed arrays of u8 are
 * `Uint8Array`; structs are plain objects keyed by the IDL's snake_case field names.
 */

export type Decoded = unknown;

const typeDef = (idl: AnchorIdl, name: string): IdlTypeDef => {
  const t = idl.types.find((x) => x.name === name);
  if (!t) throw new Error(`IDL has no type ${name}`);
  return t;
};

class Writer {
  private chunks: Buffer[] = [];
  push(b: Buffer | Uint8Array) { this.chunks.push(Buffer.from(b)); }
  int(bytes: number, v: bigint, signed: boolean) {
    const b = Buffer.alloc(bytes);
    let x = v;
    const min = signed ? -(BigInt(1) << BigInt(bytes * 8 - 1)) : BigInt(0);
    const max = signed ? (BigInt(1) << BigInt(bytes * 8 - 1)) - BigInt(1) : (BigInt(1) << BigInt(bytes * 8)) - BigInt(1);
    if (x < min || x > max) throw new Error(`integer ${v} out of range for ${signed ? "i" : "u"}${bytes * 8}`);
    if (x < BigInt(0)) x += BigInt(1) << BigInt(bytes * 8);
    for (let i = 0; i < bytes; i++) { b[i] = Number(x & BigInt(0xff)); x >>= BigInt(8); }
    this.push(b);
  }
  done(): Buffer { return Buffer.concat(this.chunks); }
}

const INT: Record<string, [number, boolean]> = { u8: [1, false], i8: [1, true], u16: [2, false], i16: [2, true], u32: [4, false], i32: [4, true], u64: [8, false], i64: [8, true], u128: [16, false], i128: [16, true] };

function toBig(v: unknown, what: string): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  throw new Error(`${what}: expected an integer, got ${String(v)}`);
}

function encodeInto(idl: AnchorIdl, w: Writer, t: IdlType, v: unknown, path: string): void {
  if (typeof t === "string") {
    if (t in INT) { const [n, s] = INT[t]; w.int(n, toBig(v, path), s); return; }
    if (t === "bool") { if (typeof v !== "boolean") throw new Error(`${path}: expected boolean`); w.push(Buffer.from([v ? 1 : 0])); return; }
    if (t === "pubkey") { const pk = v instanceof PublicKey ? v : new PublicKey(v as string); w.push(pk.toBuffer()); return; }
    if (t === "string") { const b = Buffer.from(String(v), "utf8"); w.int(4, BigInt(b.length), false); w.push(b); return; }
    if (t === "bytes") { const b = Buffer.from(v as Uint8Array); w.int(4, BigInt(b.length), false); w.push(b); return; }
    throw new Error(`${path}: unsupported type ${t}`);
  }
  if ("vec" in t) { const a = v as unknown[]; w.int(4, BigInt(a.length), false); a.forEach((x, i) => encodeInto(idl, w, t.vec, x, `${path}[${i}]`)); return; }
  if ("array" in t) {
    const [inner, len] = t.array;
    if (inner === "u8" && (v instanceof Uint8Array || Buffer.isBuffer(v))) {
      if ((v as Uint8Array).length !== len) throw new Error(`${path}: expected ${len} bytes`);
      w.push(v as Uint8Array); return;
    }
    const a = v as unknown[];
    if (!Array.isArray(a) || a.length !== len) throw new Error(`${path}: expected an array of ${len}`);
    a.forEach((x, i) => encodeInto(idl, w, inner, x, `${path}[${i}]`)); return;
  }
  if ("option" in t) { if (v === null || v === undefined) { w.push(Buffer.from([0])); return; } w.push(Buffer.from([1])); encodeInto(idl, w, t.option, v, path); return; }
  if ("defined" in t) {
    const d = typeDef(idl, t.defined.name);
    if (d.type.kind !== "struct") throw new Error(`${path}: enums are not used by this program`);
    const o = v as Record<string, unknown>;
    for (const f of d.type.fields) {
      if (!(f.name in o)) throw new Error(`${path}.${f.name} missing`);
      encodeInto(idl, w, f.type, o[f.name], `${path}.${f.name}`);
    }
    return;
  }
  throw new Error(`${path}: unsupported IDL type`);
}

export function encodeType(idl: AnchorIdl, t: IdlType, v: unknown): Buffer {
  const w = new Writer();
  encodeInto(idl, w, t, v, "value");
  return w.done();
}

class Reader {
  private b: Buffer;
  at: number;
  constructor(b: Buffer, at = 0) { this.b = b; this.at = at; }
  take(n: number): Buffer {
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

function decodeFrom(idl: AnchorIdl, r: Reader, t: IdlType): Decoded {
  if (typeof t === "string") {
    if (t in INT) { const [n, s] = INT[t]; const x = r.int(n, s); return n <= 4 ? Number(x) : x; }
    if (t === "bool") return r.take(1)[0] !== 0;
    if (t === "pubkey") return new PublicKey(r.take(32));
    if (t === "string") { const n = Number(r.int(4, false)); return r.take(n).toString("utf8"); }
    if (t === "bytes") { const n = Number(r.int(4, false)); return new Uint8Array(r.take(n)); }
    throw new Error(`unsupported type ${t}`);
  }
  if ("vec" in t) { const n = Number(r.int(4, false)); return Array.from({ length: n }, () => decodeFrom(idl, r, t.vec)); }
  if ("array" in t) {
    const [inner, len] = t.array;
    if (inner === "u8") return new Uint8Array(r.take(len));
    return Array.from({ length: len }, () => decodeFrom(idl, r, inner));
  }
  if ("option" in t) return r.take(1)[0] === 0 ? null : decodeFrom(idl, r, t.option);
  if ("defined" in t) {
    const d = typeDef(idl, t.defined.name);
    if (d.type.kind !== "struct") throw new Error("enums are not used by this program");
    const o: Record<string, Decoded> = {};
    for (const f of d.type.fields) o[f.name] = decodeFrom(idl, r, f.type);
    return o;
  }
  throw new Error("unsupported IDL type");
}

export function decodeType(idl: AnchorIdl, t: IdlType, data: Buffer, offset = 0): { value: Decoded; end: number } {
  const r = new Reader(data, offset);
  const value = decodeFrom(idl, r, t);
  return { value, end: r.at };
}

/** Instruction data: the IDL discriminator followed by the borsh args in IDL order. */
export function encodeInstruction(idl: AnchorIdl, name: string, args: Record<string, unknown>): Buffer {
  const ix = idl.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`IDL has no instruction ${name}`);
  const w = new Writer();
  w.push(Buffer.from(ix.discriminator));
  for (const a of ix.args) {
    if (!(a.name in args)) throw new Error(`${name}: missing arg ${a.name}`);
    encodeInto(idl, w, a.type, args[a.name], `${name}.${a.name}`);
  }
  return w.done();
}

/** Decodes an account after checking its 8-byte discriminator. */
export function decodeAccount<T>(idl: AnchorIdl, name: string, data: Buffer | Uint8Array): T {
  const acc = idl.accounts.find((a) => a.name === name);
  if (!acc) throw new Error(`IDL has no account ${name}`);
  const b = Buffer.from(data);
  if (b.length < 8 || !b.subarray(0, 8).equals(Buffer.from(acc.discriminator))) throw new Error(`not a ${name} account (discriminator mismatch)`);
  return decodeType(idl, { defined: { name } }, b, 8).value as T;
}

export function accountDiscriminator(idl: AnchorIdl, name: string): Buffer {
  const acc = idl.accounts.find((a) => a.name === name);
  if (!acc) throw new Error(`IDL has no account ${name}`);
  return Buffer.from(acc.discriminator);
}
