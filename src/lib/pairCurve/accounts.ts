import { type Connection, PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, CPMM_AUTH_SEED, CPMM_PROGRAM_ID, type Cluster, NATIVE_MINT, PAIR_CURVE_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { accountDiscriminator, decodeAccount } from "@/lib/burnReceipts/idlCoder";
import { bs58 } from "@/lib/burnReceipts/accounts";
import { PAIR_CURVE_IDL } from "@/lib/pairCurve/idl";
import type { CurveParams } from "@/lib/pairCurve/pricing";

/** PDAs and account decoding for pair_curve (seeds in programs/pair_curve/src/constants.rs). */

export const SEED_PAIR = Buffer.from("pair", "utf8");
export const SEED_VAULT = Buffer.from("vault", "utf8");
export const SEED_POOL = Buffer.from("pool", "utf8");

export const STATUS_OPEN = 0;
export const STATUS_GRADUATED = 1;
export const STATUS_VOIDED = 2;
export const STATUS_GRADUATING = 3;
export const STATUS_NAMES: Record<number, string> = { 0: "open", 1: "graduated", 2: "voided", 3: "graduating" };

/** Raydium CPMM's create-pool-fee receiver (raydium-cp-swap lib.rs create_pool_fee_reveiver; per build). */
export const CPMM_CREATE_POOL_FEE_RECEIVER: Record<Cluster, PublicKey> = {
  mainnet: new PublicKey("DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8"),
  devnet: new PublicKey("3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy"),
  localnet: new PublicKey("DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8"),
};

export const pairPda = (mintA: PublicKey, mintB: PublicKey, programId: PublicKey = PAIR_CURVE_PROGRAM_ID): PublicKey =>
  PublicKey.findProgramAddressSync([SEED_PAIR, mintA.toBuffer(), mintB.toBuffer()], programId)[0];
export const vaultPda = (pair: PublicKey, programId: PublicKey = PAIR_CURVE_PROGRAM_ID): PublicKey => PublicKey.findProgramAddressSync([SEED_VAULT, pair.toBuffer()], programId)[0];
export const poolPda = (pair: PublicKey, side: 0 | 1, programId: PublicKey = PAIR_CURVE_PROGRAM_ID): PublicKey =>
  PublicKey.findProgramAddressSync([SEED_POOL, pair.toBuffer(), Buffer.from([side])], programId)[0];
export const ata = (owner: PublicKey, mint: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];

/** Every account graduate(side) needs for that side's CPMM pool (CPMM's own PDAs for a pool at `pool`). */
export interface SidePoolAccounts { pool: PublicKey; lpMint: PublicKey; vaultLp: PublicKey; token0Mint: PublicKey; token1Mint: PublicKey; poolVault0: PublicKey; poolVault1: PublicKey; observation: PublicKey; cpmmAuthority: PublicKey; wsolIsToken0: boolean }

export function sidePoolAccounts(cluster: Cluster, pair: PublicKey, side: 0 | 1, mint: PublicKey, programId: PublicKey = PAIR_CURVE_PROGRAM_ID): SidePoolAccounts {
  const cpmm = CPMM_PROGRAM_ID[cluster];
  const pda = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, cpmm)[0];
  const pool = poolPda(pair, side, programId);
  const wsolIsToken0 = Buffer.compare(NATIVE_MINT.toBuffer(), mint.toBuffer()) < 0;
  const [t0, t1] = wsolIsToken0 ? [NATIVE_MINT, mint] : [mint, NATIVE_MINT];
  const lpMint = pda([Buffer.from("pool_lp_mint"), pool.toBuffer()]);
  return {
    pool, lpMint, vaultLp: ata(vaultPda(pair, programId), lpMint), token0Mint: t0, token1Mint: t1,
    poolVault0: pda([Buffer.from("pool_vault"), pool.toBuffer(), t0.toBuffer()]), poolVault1: pda([Buffer.from("pool_vault"), pool.toBuffer(), t1.toBuffer()]),
    observation: pda([Buffer.from("observation"), pool.toBuffer()]), cpmmAuthority: pda([CPMM_AUTH_SEED]), wsolIsToken0,
  };
}

/** LAUNCHPAD-PATH §35: a side's Fee Key NFT mint, the pair_curve PDA ["fee_nft", pair, [side]]. */
export const feeNftMintPda = (pair: PublicKey, side: 0 | 1, programId: PublicKey = PAIR_CURVE_PROGRAM_ID): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from("fee_nft", "utf8"), pair.toBuffer(), Buffer.from([side])], programId)[0];
export const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const metadataPda = (mint: PublicKey): PublicKey => PublicKey.findProgramAddressSync([Buffer.from("metadata", "utf8"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()], METADATA_PROGRAM_ID)[0];

/** The decoded Pair (IDL field names, snake_case). */
export interface PairAccount {
  version: number; bump: number; vault_bump: number; status: number;
  mints: PublicKey[]; pools: PublicKey[]; lp_supply_at_creation: bigint[];
  /** LP lock_lp moved into Raydium's CPMM lock (0 until then; pairs graduated before LAUNCHPAD-PATH §35 record their burn here). */
  lp_locked: bigint[];
  cp_config: PublicKey; vault: PublicKey; creator: PublicKey; dev_wallet: PublicKey; ll_platform: PublicKey;
  fee_vaults: PublicKey[]; token_vaults: PublicKey[]; vault_wsol: PublicKey; pool_bumps: Uint8Array;
  pair_id: Uint8Array; rules_sha256_a: Uint8Array; rules_sha256_b: Uint8Array;
  virtual_sol_lamports: bigint; virtual_token_amount: bigint; curve_supply: bigint; reserve_supply: bigint; target_raise_lamports: bigint;
  min_side_share_bps: number; deadline: bigint; created_at: bigint;
  sold: bigint[]; sol: bigint[]; volume_lamports: bigint[]; burn_fees_lamports: bigint[]; dev_fees_lamports: bigint[]; trades: number[];
  graduated_at: bigint; voided_at: bigint; pool_sol: bigint[]; pool_tokens: bigint[]; tokens_burned: bigint[];
  graduation_started_at: bigint; raise_at_graduation: bigint[];
  burn_escrow: bigint[]; dev_accrued: bigint; redeem_pool: bigint[]; redeem_supply: bigint[]; refunding: boolean[];
}

export const decodePair = (data: Buffer | Uint8Array): PairAccount => decodeAccount<PairAccount>(PAIR_CURVE_IDL, "Pair", data);
export const pairDiscriminator = (): Buffer => accountDiscriminator(PAIR_CURVE_IDL, "Pair");
export const curveOf = (p: PairAccount): CurveParams => ({ virtualSol: p.virtual_sol_lamports, virtualToken: p.virtual_token_amount, curveSupply: p.curve_supply });

export async function fetchPair(connection: Connection, pair: PublicKey): Promise<PairAccount | null> {
  const a = await connection.getAccountInfo(pair, "confirmed");
  if (!a || a.data.length === 0) return null;
  return decodePair(a.data);
}

/** Every Pair of the program (optionally only one status) — what the keeper's crank scans; no registry needed. */
/**
 * Every Pair the program owns (optionally one status). An account the current layout cannot decode (devnet round-4 campaign, 2026-10-12:
 * one 888-byte Pair from an older layout aborted the keeper's whole scan, so no pair was cranked) is SKIPPED and reported through
 * `onUndecodable`, never thrown: one stale account must not stop every other pair's crank.
 */
export async function fetchPairs(connection: Connection, o: { programId?: PublicKey; status?: number; onUndecodable?: (address: PublicKey, error: Error, bytes: number) => void } = {}): Promise<{ address: PublicKey; pair: PairAccount }[]> {
  const filters: ({ memcmp: { offset: number; bytes: string } })[] = [{ memcmp: { offset: 0, bytes: bs58(pairDiscriminator()) } }];
  if (o.status !== undefined) filters.push({ memcmp: { offset: 11, bytes: bs58(Uint8Array.from([o.status])) } });
  const list = await connection.getProgramAccounts(o.programId ?? PAIR_CURVE_PROGRAM_ID, { commitment: "confirmed", filters });
  const out: { address: PublicKey; pair: PairAccount }[] = [];
  for (const x of list) {
    try { out.push({ address: x.pubkey, pair: decodePair(x.account.data) }); }
    catch (e) { o.onUndecodable?.(x.pubkey, e as Error, x.account.data.length); }
  }
  return out;
}
