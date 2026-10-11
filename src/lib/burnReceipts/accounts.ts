import { type Connection, PublicKey } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { accountDiscriminator, decodeAccount } from "@/lib/burnReceipts/idlCoder";
import type { AttesterEntry } from "@/lib/burnReceipts/instructions";
import type { RuleParams } from "@/lib/burnReceipts/math";
import { configPda, readingPda } from "@/lib/burnReceipts/pda";

/** Decoded program accounts (field names as the IDL has them), plus a few readable conveniences. */

export interface TokenConfigAccount {
  version: number; bump: number; fee_bump: number; has_baseline: boolean;
  mint: PublicKey; creator: PublicKey; admin: PublicKey;
  rule: RuleParams;
  rules_sha256: Uint8Array; params_hash: Uint8Array;
  feed_id: Uint8Array; feed_id_len: number; memo_prefix: Uint8Array; memo_prefix_len: number; memo_source: Uint8Array; memo_source_len: number;
  attesters: AttesterEntry[]; attester_count: number; quorum: number;
  pending_attesters: AttesterEntry[]; pending_count: number; pending_quorum: number; pending_eta: bigint;
  cpmm_pool: PublicKey;
  last_record_date: number; last_value: bigint; carry: bigint; crank_cursor: number;
  readings: number; burns: number; total_burned: bigint; total_spent_lamports: bigint; shortfall: bigint; created_at: bigint;
  carried_spend_lamports: bigint; pool_untradeable_since: bigint;
  /** Review-2 F6: latest untradeable observation (a gap > 24 h restarts the spell). */
  pool_untradeable_last_seen: bigint;
  /** Review-2 F5/F14: the pool passed register_pool's provenance checks; crank_buyback requires it. */
  pool_verified: boolean;
  /** Review-2 F12: the cluster genesis hash every signed message must carry (the program build's). */
  cluster_genesis: PublicKey;
  /** Review-3 M-3: the registration policy in force, the pinned LaunchLab platform / cpConfigId / scales, a pending policy switch. */
  registration_policy: number; ll_platform: PublicKey; ll_cp_config: PublicKey; ll_lock_scale_ppm: bigint;
  pending_policy: number; pending_policy_pool: PublicKey; pending_policy_eta: bigint;
  /** Review-3 L-3: the first observation of a not-yet-started untradeable spell (0 = none). */
  pool_untradeable_candidate_at: bigint;
  /** Review-3 L-2: when each attester slot's key joined. */
  attester_added_at: bigint[];
  // conveniences
  feedId: string; memoPrefix: string; memoSource: string; activeAttesters: AttesterEntry[]; adminRenounced: boolean; poolRegistered: boolean;
}

export interface ReadingAccount {
  version: number; bump: number; kind: number; processed: boolean;
  config: PublicKey; record_date: number; prev_date: number;
  value: bigint; prev_value: bigint; delta: bigint; carry_in: bigint; carry_out: bigint; units: bigint;
  signers_mask: number; source_url_hash: Uint8Array; proof_hash: Uint8Array; submitted_at: bigint;
  outcome: number; processed_at: bigint; pool_lamports: bigint; spent_lamports: bigint; got: bigint; burned: bigint; owed: bigint; shortfall: bigint;
  /** The whole spendable pool before the crank; > pool_lamports when the platform cap bound. */
  pool_actual_lamports: bigint;
  rule_spend_lamports: bigint; carried_in_lamports: bigint; carried_out_lamports: bigint;
  /** Review-2 F9: the CPMM pool this reading was processed against (default when none). */
  pool: PublicKey;
}

export interface PlatformConfigAccount {
  version: number; bump: number; authority: PublicKey; burn_pool_cap_lamports: bigint; cap_sunset_ts: bigint;
  pending_cap_lamports: bigint; pending_cap_eta: bigint; created_at: bigint;
  /** Review-3 L-4: the cranker allowlist (first `cranker_count`), in force only while the cap is. */
  crankers: PublicKey[]; cranker_count: number;
}

/** LAUNCHPAD-PATH §35: a coin's lock position and the running claim totals (["fee_key", mint]). */
export interface FeeKeyRecordAccount {
  version: number; bump: number; mint: PublicKey; pool: PublicKey; lp_mint: PublicKey; fee_nft_mint: PublicKey; fee_nft_account: PublicKey;
  locked_liquidity: PublicKey; locked_lp_at_registration: bigint; registered_at: bigint; claims: number;
  total_wsol_claimed: bigint; total_to_burn_pool: bigint; total_to_operator: bigint; total_tokens_burned: bigint; last_claim_at: bigint;
}

export function decodeFeeKeyRecord(data: Buffer | Uint8Array): FeeKeyRecordAccount {
  return decodeAccount<FeeKeyRecordAccount>(BURN_RECEIPTS_IDL, "FeeKeyRecord", data);
}

export async function fetchFeeKeyRecord(connection: Connection, programId: PublicKey, mint: PublicKey): Promise<{ address: PublicKey; record: FeeKeyRecordAccount } | null> {
  const address = PublicKey.findProgramAddressSync([Buffer.from("fee_key", "utf8"), mint.toBuffer()], programId)[0];
  const info = await connection.getAccountInfo(address, "confirmed");
  return info ? { address, record: decodeFeeKeyRecord(info.data) } : null;
}

/** Raydium's LockedCpLiquidityState (lock program; offsets read from live accounts). */
/** LockedCpLiquidityState. @128 is the LOCKER (the liquidity owner who locked: LaunchLab's ["vault_auth_seed"] PDA for a migration,
 *  the pair's vault for lock_lp) — lp-lock blind review I-3; `owner` is kept as an alias of `locker`. */
export interface LockedLiquidityView { lockedLp: bigint; claimedLp: bigint; unclaimedLp: bigint; lastLp: bigint; pool: PublicKey; feeNftMint: PublicKey; owner: PublicKey; locker: PublicKey; lpMint: PublicKey }
export function decodeLockedLiquidity(data: Buffer | Uint8Array): LockedLiquidityView {
  const d = Buffer.from(data);
  if (d.length < 192) throw new Error("burnReceipts: not a LockedCpLiquidityState (too short)");
  const pk = (o: number) => new PublicKey(d.subarray(o, o + 32));
  return { lockedLp: d.readBigUInt64LE(8), claimedLp: d.readBigUInt64LE(16), unclaimedLp: d.readBigUInt64LE(24), lastLp: d.readBigUInt64LE(32), pool: pk(64), feeNftMint: pk(96), owner: pk(128), locker: pk(128), lpMint: pk(160) };
}

export function decodePlatformConfig(data: Buffer | Uint8Array): PlatformConfigAccount {
  return decodeAccount<PlatformConfigAccount>(BURN_RECEIPTS_IDL, "PlatformConfig", data);
}

const text = (b: Uint8Array, n: number): string => Buffer.from(b.subarray(0, n)).toString("utf8");

export function decodeTokenConfig(data: Buffer | Uint8Array): TokenConfigAccount {
  const c = decodeAccount<Omit<TokenConfigAccount, "feedId" | "memoPrefix" | "memoSource" | "activeAttesters" | "adminRenounced" | "poolRegistered">>(BURN_RECEIPTS_IDL, "TokenConfig", data);
  return {
    ...c,
    feedId: text(c.feed_id, c.feed_id_len),
    memoPrefix: text(c.memo_prefix, c.memo_prefix_len),
    memoSource: text(c.memo_source, c.memo_source_len),
    activeAttesters: c.attesters.slice(0, c.attester_count),
    adminRenounced: c.admin.equals(PublicKey.default),
    // A fixed pool (policy 1) is set at init but must still pass register_pool before any buyback (review-2 F14).
    poolRegistered: c.pool_verified && !c.cpmm_pool.equals(PublicKey.default),
  };
}

export function decodeReading(data: Buffer | Uint8Array): ReadingAccount {
  return decodeAccount<ReadingAccount>(BURN_RECEIPTS_IDL, "Reading", data);
}

export async function fetchTokenConfig(connection: Connection, programId: PublicKey, mint: PublicKey): Promise<{ address: PublicKey; config: TokenConfigAccount } | null> {
  const address = configPda(programId, mint);
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info) return null;
  if (!info.owner.equals(programId)) throw new Error(`config ${address.toBase58()} is not owned by ${programId.toBase58()}`);
  return { address, config: decodeTokenConfig(info.data) };
}

export async function fetchReading(connection: Connection, programId: PublicKey, config: PublicKey, recordDate: number): Promise<ReadingAccount | null> {
  const info = await connection.getAccountInfo(readingPda(programId, config, recordDate), "confirmed");
  if (!info || !info.owner.equals(programId)) return null;
  return decodeReading(info.data);
}

/** Byte offsets inside a Reading account for getProgramAccounts filters: discriminator(8) version bump kind processed → config @12. */
export const READING_OFFSET_CONFIG = 12;
export const READING_OFFSET_RECORD_DATE = 44;
export const READING_OFFSET_PREV_DATE = 48;

/** All readings of a config (getProgramAccounts with a discriminator + config filter), oldest first. */
export async function fetchReadings(connection: Connection, programId: PublicKey, config: PublicKey): Promise<{ address: PublicKey; reading: ReadingAccount }[]> {
  const res = await connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [
      { memcmp: { offset: 0, bytes: bs58(accountDiscriminator(BURN_RECEIPTS_IDL, "Reading")) } },
      { memcmp: { offset: READING_OFFSET_CONFIG, bytes: config.toBase58() } },
    ],
  });
  return res.map((r) => ({ address: r.pubkey, reading: decodeReading(r.account.data) })).sort((a, b) => a.reading.record_date - b.reading.record_date);
}

/** The reading that is next in line to be processed (its prev_date equals the config's crank cursor), if any. */
export async function fetchNextReadingInLine(connection: Connection, programId: PublicKey, config: PublicKey, cursor: number): Promise<{ address: PublicKey; reading: ReadingAccount } | null> {
  const prev = Buffer.alloc(4);
  prev.writeUInt32LE(cursor);
  const res = await connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [
      { memcmp: { offset: 0, bytes: bs58(accountDiscriminator(BURN_RECEIPTS_IDL, "Reading")) } },
      { memcmp: { offset: READING_OFFSET_CONFIG, bytes: config.toBase58() } },
      { memcmp: { offset: READING_OFFSET_PREV_DATE, bytes: bs58(prev) } },
    ],
  });
  const found = res.map((r) => ({ address: r.pubkey, reading: decodeReading(r.account.data) })).filter((r) => !r.reading.processed);
  // The baseline also has prev_date 0; it is always processed at submission, so it never appears here.
  return found.sort((a, b) => a.reading.record_date - b.reading.record_date)[0] ?? null;
}

/** base58 without a dependency (web3.js's PublicKey encodes exactly 32 bytes; memcmp filters need arbitrary lengths). */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function bs58(bytes: Uint8Array): string {
  let x = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let out = "";
  while (x > BigInt(0)) { out = ALPHABET[Number(x % BigInt(58))] + out; x /= BigInt(58); }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}
