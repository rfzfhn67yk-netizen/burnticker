import crypto from "node:crypto";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { CAP_TIMELOCK_SECS, DEFAULT_BURN_POOL_CAP_LAMPORTS, DEFAULT_CAP_SUNSET_TS, MAX_CRANKERS } from "@/lib/burnReceipts/constants";
import type { PlatformConfigAccount } from "@/lib/burnReceipts/accounts";
import { initializePlatformIx, proposeCapRaiseIx } from "@/lib/burnReceipts/instructions";

/**
 * THE BURN-POOL CAP RAISE through the Squads v4 vault (owner, 2026-10-12: 25 SOL → 1,000 SOL). Pure helpers for
 * scripts/burnreceipts-cap.mts and its tests: the program's own limits as client-side refusals, the vault's inner message in the
 * Squads v4 `TransactionMessage` layout (the same bytes scripts/squads-program-upgrade.mts writes by hand for one instruction), and
 * the two Squads instructions' data.
 *
 * Who pays the PlatformConfig rent: the VAULT. Inside a vault transaction the only signers are the vault PDA (Squads signs for it with
 * invoke_signed at execution) and ephemeral PDAs; a member's key is not part of the inner message, so it cannot be initialize_platform's
 * `payer`. The vault is a system-owned account with no data, so it can fund the account from its own SOL balance. The member pays the
 * Squads transaction and proposal rent and the fee of each outer transaction.
 */

export const SQUADS_V4_PROGRAM_ID = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
/** 8-byte Anchor discriminator + PlatformConfig::INIT_SPACE (u8 u8 pubkey u64 i64 u64 i64 i64 [pubkey;3] u8 [u8;64]). */
export const PLATFORM_CONFIG_SPACE = 8 + 1 + 1 + 32 + 8 * 5 + 32 * MAX_CRANKERS + 1 + 64;
export const MAX_CAP_SUNSET_SECS = 365 * 24 * 60 * 60;
export const LAMPORTS_PER_SOL_BIG = BigInt(1_000_000_000);

export class CapRefusal extends Error {}
function refuse(s: string): never { throw new CapRefusal(s); }

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

/** initialize_platform's own checks (platform.rs), so a proposal that would fail at execution is never created. */
export function checkInitializePlatform(o: { capLamports: bigint; sunsetTs: bigint; nowTs: bigint; crankers: PublicKey[] }): void {
  if (o.capLamports !== DEFAULT_BURN_POOL_CAP_LAMPORTS) refuse(`the initial cap must equal the program's default ${DEFAULT_BURN_POOL_CAP_LAMPORTS} lamports (25 SOL), not ${o.capLamports}; anything higher goes through propose_cap_raise`);
  if (o.crankers.length > MAX_CRANKERS) refuse(`at most ${MAX_CRANKERS} crankers (got ${o.crankers.length}); none = anyone may crank`);
  o.crankers.forEach((k, i) => {
    if (k.equals(PublicKey.default)) refuse("a cranker cannot be the all-zero key");
    if (o.crankers.slice(0, i).some((x) => x.equals(k))) refuse(`cranker ${k.toBase58()} is listed twice`);
  });
  if (o.sunsetTs <= o.nowTs) refuse(`the sunset ${isoUtc(o.sunsetTs)} is not in the future (chain time ${isoUtc(o.nowTs)})`);
  if (o.sunsetTs > o.nowTs + BigInt(MAX_CAP_SUNSET_SECS)) refuse(`the sunset ${isoUtc(o.sunsetTs)} is more than 365 days after chain time ${isoUtc(o.nowTs)}`);
  if (o.sunsetTs > BigInt(DEFAULT_CAP_SUNSET_TS)) refuse(`the sunset ${isoUtc(o.sunsetTs)} is after the program's hard-coded sunset ${isoUtc(BigInt(DEFAULT_CAP_SUNSET_TS))}`);
}

/** propose_cap_raise's checks against an existing PlatformConfig signed by `vault`. */
export function checkProposeCapRaise(o: { platform: PlatformConfigAccount; vault: PublicKey; newCapLamports: bigint; replacePending: boolean }): void {
  if (o.platform.authority.equals(PublicKey.default)) refuse("the platform authority is renounced: the cap can never be raised again");
  if (!o.platform.authority.equals(o.vault)) refuse(`the platform authority is ${o.platform.authority.toBase58()}, not the vault ${o.vault.toBase58()}`);
  if (o.newCapLamports <= o.platform.burn_pool_cap_lamports) refuse(`the new cap ${o.newCapLamports} must be above the current ${o.platform.burn_pool_cap_lamports} (the cap can only be raised)`);
  if (o.platform.pending_cap_eta !== BigInt(0) && !o.replacePending) refuse(`a raise to ${o.platform.pending_cap_lamports} lamports is already pending (eta ${isoUtc(o.platform.pending_cap_eta)}); proposing again replaces it and restarts the 48 h — pass --replace-pending to do that`);
}

/** apply_cap_raise's checks (permissionless once the timelock has elapsed). */
export function checkApplyCapRaise(platform: PlatformConfigAccount | null, nowTs: bigint): void {
  if (!platform) refuse("no PlatformConfig: there is no pending raise (the default 25 SOL cap applies)");
  if (platform.pending_cap_eta === BigInt(0)) refuse("no raise is pending");
  if (nowTs < platform.pending_cap_eta) refuse(`the 48 h timelock has not elapsed: ${formatDuration(platform.pending_cap_eta - nowTs)} left (eta ${whenBoth(platform.pending_cap_eta)})`);
  if (platform.pending_cap_lamports <= platform.burn_pool_cap_lamports) refuse("the pending cap is not above the current cap");
}

/** The vault transaction's inner instructions: initialize_platform (only when no PlatformConfig exists) then propose_cap_raise. */
export function capRaiseInstructions(o: { programId: PublicKey; vault: PublicKey; platformExists: boolean; sunsetTs: bigint; crankers: PublicKey[]; newCapLamports: bigint }): TransactionInstruction[] {
  const init = o.platformExists ? [] : [initializePlatformIx({ programId: o.programId, payer: o.vault, upgradeAuthority: o.vault, authority: o.vault, burnPoolCapLamports: DEFAULT_BURN_POOL_CAP_LAMPORTS, capSunsetTs: o.sunsetTs, crankers: o.crankers })];
  return [...init, proposeCapRaiseIx({ programId: o.programId, authority: o.vault, newCapLamports: o.newCapLamports })];
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

/** Refusal for apply --send: every cluster needs the flag; mainnet also needs BURNKEEPER_MAINNET=1. */
export function checkApplySend(o: { cluster: string; send: boolean; understood: boolean; mainnetEnv: string | undefined }): void {
  if (!o.send) return;
  if (!o.understood) refuse("--send also needs --i-understand-this-raises-the-cap");
  if (o.cluster === "mainnet" && o.mainnetEnv !== "1") refuse("--send on mainnet also needs BURNKEEPER_MAINNET=1 in the environment");
}
/** Refusal for propose-vault --send: never on mainnet (the bytes are printed for the owner's own signing tool). */
export function checkProposeSend(o: { cluster: string; send: boolean }): void {
  if (o.send && o.cluster === "mainnet") refuse("propose-vault never sends on mainnet: take the printed bytes to the owner's signing tool");
}

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

/** A readable PlatformConfig for `show` and the dry runs. */
export function describePlatform(p: PlatformConfigAccount | null, nowTs: bigint): Record<string, unknown> {
  if (!p) return { platformConfig: "none", summary: `none: default 25 SOL cap until ${whenBoth(DEFAULT_CAP_SUNSET_TS)}`, capLamports: DEFAULT_BURN_POOL_CAP_LAMPORTS.toString(), sunset: whenBoth(DEFAULT_CAP_SUNSET_TS) };
  const sunsetPassed = nowTs >= p.cap_sunset_ts;
  return {
    platformConfig: "exists",
    cap: `${solString(p.burn_pool_cap_lamports)} (${p.burn_pool_cap_lamports} lamports)${sunsetPassed ? " — sunset passed, no cap applies" : ""}`,
    sunset: whenBoth(p.cap_sunset_ts),
    pending: p.pending_cap_eta === BigInt(0) ? "none" : {
      cap: `${solString(p.pending_cap_lamports)} (${p.pending_cap_lamports} lamports)`,
      eta: whenBoth(p.pending_cap_eta),
      appliable: nowTs >= p.pending_cap_eta ? "now (anyone may run apply)" : `in ${formatDuration(p.pending_cap_eta - nowTs)}`,
    },
    authority: p.authority.equals(PublicKey.default) ? "renounced" : p.authority.toBase58(),
    crankers: p.cranker_count === 0 ? "none (anyone may crank)" : p.crankers.slice(0, p.cranker_count).map((k) => k.toBase58()),
    createdAt: whenBoth(p.created_at),
    timelockSecs: CAP_TIMELOCK_SECS,
  };
}
