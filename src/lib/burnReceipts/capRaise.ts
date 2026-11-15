import crypto from "node:crypto";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { DEFAULT_CAP_SUNSET_TS, MAX_CAP_SUNSET_SECS, PLATFORM_CRANKER_SLOTS } from "@/lib/burnReceipts/constants";
import type { PlatformConfigAccount } from "@/lib/burnReceipts/accounts";

/**
 * THE BURN-POOL CAP RAISE IS RETIRED (owner decision 2026-10-25). The program no longer has a burn-pool cap: propose_cap_raise,
 * cancel_cap_raise and apply_cap_raise keep their entry points but always refuse with CapRemoved (6144). scripts/burnreceipts-cap.mts is
 * a refusing stub so an old runbook fails loudly.
 *
 * What stays here: the Squads v4 vault-message helpers (the `TransactionMessage` layout scripts/squads-program-upgrade.mts writes by hand
 * for one instruction, and the two Squads instructions' data), initialize_platform's remaining client-side check (the sunset window; the
 * cap and crankers arguments are ignored by the program and stored as 0 / empty), and a readable PlatformConfig for operators.
 */

export const SQUADS_V4_PROGRAM_ID = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
/** 8-byte Anchor discriminator + PlatformConfig::INIT_SPACE (u8 u8 pubkey u64 i64 u64 i64 i64 [pubkey;3] u8 [u8;64]); layout unchanged. */
export const PLATFORM_CONFIG_SPACE = 8 + 1 + 1 + 32 + 8 * 5 + 32 * PLATFORM_CRANKER_SLOTS + 1 + 64;
export { MAX_CAP_SUNSET_SECS };
export const LAMPORTS_PER_SOL_BIG = BigInt(1_000_000_000);
/** The program's CapRemoved error (6144), appended 2026-10-25. */
export const CAP_REMOVED_CODE = 6144;
/** The refusal every retired cap command prints (operator text, not public copy). */
export const CAP_REMOVED_MESSAGE = "the burn-pool cap was removed by owner decision 2026-10-25: there is no cap to raise, cancel or apply, and every crank is permissionless. The program refuses propose_cap_raise, cancel_cap_raise and apply_cap_raise with CapRemoved (6144).";

export class CapRefusal extends Error {}
function refuse(s: string): never { throw new CapRefusal(s); }
/** Every retired cap-raise path ends here. */
export function refuseCapRemoved(): never { refuse(CAP_REMOVED_MESSAGE); }

/** "1000" / "1000.5" SOL → lamports, exactly (no float). */
export function solToLamports(sol: string): bigint {
  const m = /^(\d{1,12})(?:\.(\d{1,9}))?$/.exec(sol.trim()) ?? refuse(`${sol} is not a SOL amount`);
  return BigInt(m[1]) * LAMPORTS_PER_SOL_BIG + BigInt((m[2] ?? "").padEnd(9, "0"));
}

/** An ISO date / date-time (a bare date is midnight UTC) or unix seconds. */
export function parseSunset(v: string): bigint {
  if (/^\d+$/.test(v)) return BigInt(v);
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) refuse(`--sunset ${v} is not an ISO date or unix seconds`);
  return BigInt(Math.floor(ms / 1000));
}

/**
 * initialize_platform's remaining checks (platform.rs): the sunset is in the future, at most 365 days ahead and not after the hard-coded
 * DEFAULT_CAP_SUNSET_TS. Since 2026-10-25 the program ignores the cap and crankers arguments (it stores 0 / empty), so they are not checked.
 */
export function checkInitializePlatform(o: { sunsetTs: bigint; nowTs: bigint }): void {
  if (o.sunsetTs <= o.nowTs) refuse(`the sunset ${isoUtc(o.sunsetTs)} is not in the future (chain time ${isoUtc(o.nowTs)})`);
  if (o.sunsetTs > o.nowTs + BigInt(MAX_CAP_SUNSET_SECS)) refuse(`the sunset ${isoUtc(o.sunsetTs)} is more than 365 days after chain time ${isoUtc(o.nowTs)}`);
  if (o.sunsetTs > BigInt(DEFAULT_CAP_SUNSET_TS)) refuse(`the sunset ${isoUtc(o.sunsetTs)} is after the program's hard-coded sunset ${isoUtc(BigInt(DEFAULT_CAP_SUNSET_TS))}`);
}

export function vaultPda(multisig: PublicKey, vaultIndex = 0): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("multisig"), multisig.toBuffer(), Buffer.from("vault"), Buffer.from([vaultIndex])], SQUADS_V4_PROGRAM_ID)[0];
}
const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
export const squadsTransactionPda = (multisig: PublicKey, index: bigint) => PublicKey.findProgramAddressSync([Buffer.from("multisig"), multisig.toBuffer(), Buffer.from("transaction"), u64le(index)], SQUADS_V4_PROGRAM_ID)[0];
export const squadsProposalPda = (multisig: PublicKey, index: bigint) => PublicKey.findProgramAddressSync([Buffer.from("multisig"), multisig.toBuffer(), Buffer.from("transaction"), u64le(index), Buffer.from("proposal")], SQUADS_V4_PROGRAM_ID)[0];
export const anchorDisc = (name: string) => crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

/**
 * Squads v4 `TransactionMessage` (squads-multisig-program 2.0.0 vault_transaction_create.rs): u8 num_signers, u8 num_writable_signers,
 * u8 num_writable_non_signers, SmallVec<u8, Pubkey> account_keys, SmallVec<u8, CompiledInstruction{ u8 program_id_index,
 * SmallVec<u8, u8> account_indexes, SmallVec<u16, u8> data }>, SmallVec<u8, lookup> (empty). Keys are ordered writable signers,
 * read-only signers, writable non-signers, read-only non-signers, each in first-appearance order (instruction accounts, then the
 * program id). The vault is the only signer the message may carry.
 */
export function compileVaultMessage(vault: PublicKey, ixs: TransactionInstruction[]): { bytes: Buffer; keys: { pubkey: PublicKey; signer: boolean; writable: boolean }[] } {
  const metas = new Map<string, { pubkey: PublicKey; signer: boolean; writable: boolean }>();
  const touch = (pubkey: PublicKey, signer: boolean, writable: boolean) => {
    const k = pubkey.toBase58();
    const m = metas.get(k) ?? { pubkey, signer: false, writable: false };
    m.signer ||= signer; m.writable ||= writable;
    metas.set(k, m);
  };
  touch(vault, true, false);
  for (const ix of ixs) {
    for (const a of ix.keys) {
      if (a.isSigner && !a.pubkey.equals(vault)) throw new CapRefusal(`${a.pubkey.toBase58()} signs an inner instruction, but only the vault can sign inside a vault transaction`);
      touch(a.pubkey, a.isSigner, a.isWritable);
    }
    touch(ix.programId, false, false);
  }
  const all = [...metas.values()];
  const keys = [...all.filter((m) => m.signer && m.writable), ...all.filter((m) => m.signer && !m.writable), ...all.filter((m) => !m.signer && m.writable), ...all.filter((m) => !m.signer && !m.writable)];
  if (keys.length > 255 || ixs.length > 255) throw new CapRefusal("too many keys or instructions for a vault message");
  const index = (p: PublicKey) => keys.findIndex((k) => k.pubkey.equals(p));
  const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const parts: Buffer[] = [Buffer.from([keys.filter((k) => k.signer).length, keys.filter((k) => k.signer && k.writable).length, keys.filter((k) => !k.signer && k.writable).length, keys.length]), ...keys.map((k) => k.pubkey.toBuffer()), Buffer.from([ixs.length])];
  for (const ix of ixs) {
    if (ix.data.length > 0xffff) throw new CapRefusal("instruction data too long");
    parts.push(Buffer.from([index(ix.programId), ix.keys.length, ...ix.keys.map((a) => index(a.pubkey))]), u16(ix.data.length), Buffer.from(ix.data));
  }
  parts.push(Buffer.from([0]));
  return { bytes: Buffer.concat(parts), keys };
}

/** vault_transaction_create args: vault_index u8, ephemeral_signers u8 (0), transaction_message Vec<u8>, memo Option<String>. */
export function vaultTransactionCreateData(vaultIndex: number, message: Buffer, memo?: string): Buffer {
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const memoBytes = memo ? Buffer.concat([Buffer.from([1]), u32(Buffer.byteLength(memo)), Buffer.from(memo)]) : Buffer.from([0]);
  return Buffer.concat([anchorDisc("vault_transaction_create"), Buffer.from([vaultIndex, 0]), u32(message.length), message, memoBytes]);
}
/** proposal_create args: transaction_index u64, draft bool (false). */
export const proposalCreateData = (index: bigint) => Buffer.concat([anchorDisc("proposal_create"), u64le(index), Buffer.from([0])]);

export const isoUtc = (ts: bigint | number) => new Date(Number(ts) * 1000).toISOString().replace(".000Z", "Z");
export function denver(ts: bigint | number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "short" }).format(new Date(Number(ts) * 1000));
}
export const whenBoth = (ts: bigint | number) => `${denver(ts)} (America/Denver) = ${isoUtc(ts)}`;
export function formatDuration(secs: bigint): string {
  const s = Number(secs < BigInt(0) ? -secs : secs);
  const d = Math.floor(s / 86_400), h = Math.floor((s % 86_400) / 3_600), m = Math.floor((s % 3_600) / 60), r = s % 60;
  return `${d ? `${d}d ` : ""}${h}h ${m}m ${r}s`;
}
export const solString = (lamports: bigint) => `${lamports / LAMPORTS_PER_SOL_BIG}${lamports % LAMPORTS_PER_SOL_BIG ? `.${(lamports % LAMPORTS_PER_SOL_BIG).toString().padStart(9, "0").replace(/0+$/, "")}` : ""} SOL`;

/**
 * A readable PlatformConfig. There is no cap since the owner decision of 2026-10-25: an account written before then still shows its old
 * cap and crankers fields, which the program no longer reads; the sunset now only closes the registration-policy switch.
 */
export function describePlatform(p: PlatformConfigAccount | null, nowTs: bigint): Record<string, unknown> {
  const cap = "none: the burn-pool cap was removed (owner decision 2026-10-25); every crank is permissionless";
  if (!p) return { platformConfig: "none", cap, sunset: whenBoth(DEFAULT_CAP_SUNSET_TS), summary: `none: no cap; the registration-policy switch closes ${whenBoth(DEFAULT_CAP_SUNSET_TS)}` };
  const sunsetPassed = nowTs >= p.cap_sunset_ts;
  return {
    platformConfig: "exists",
    cap,
    sunset: `${whenBoth(p.cap_sunset_ts)} (closes the registration-policy switch${sunsetPassed ? "; passed" : ""})`,
    authority: p.authority.equals(PublicKey.default) ? "renounced" : p.authority.toBase58(),
    ...(p.burn_pool_cap_lamports !== BigInt(0) || p.cranker_count !== 0 || p.pending_cap_eta !== BigInt(0)
      ? { legacyFields: { burnPoolCapLamports: p.burn_pool_cap_lamports.toString(), pendingCapLamports: p.pending_cap_lamports.toString(), pendingCapEta: p.pending_cap_eta.toString(), crankers: p.crankers.slice(0, p.cranker_count).map((k) => k.toBase58()), note: "written before 2026-10-25; the program no longer reads them" } }
      : {}),
    createdAt: whenBoth(p.created_at),
  };
}
