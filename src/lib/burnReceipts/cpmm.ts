import { type Connection, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@/lib/burnReceipts/constants";
import { cpmmAuthority } from "@/lib/burnReceipts/pda";

/**
 * Raydium CPMM pool state, read by byte offset exactly as the program reads it (programs/burn-receipts/.../src/cpmm.rs, from
 * raydium-cp-swap@b3187ae5 states/pool.rs). Used to resolve the crank's accounts and to preview the min-out the program will enforce.
 */

export const POOL_STATE_DISCRIMINATOR = Buffer.from([247, 237, 227, 245, 215, 195, 222, 70]);
export const POOL_STATE_LEN = 637;

export interface CpmmPool {
  address: PublicKey;
  ammConfig: PublicKey;
  poolCreator: PublicKey;
  token0Vault: PublicKey;
  token1Vault: PublicKey;
  lpMint: PublicKey;
  /** CPMM's own LP count (includes the 100 never-minted units; SPL burns do not reduce it). */
  lpSupply: bigint;
  token0Mint: PublicKey;
  token1Mint: PublicKey;
  token0Program: PublicKey;
  token1Program: PublicKey;
  observationKey: PublicKey;
  status: number;
  openTime: bigint;
  enableCreatorFee: boolean;
  /** protocol + fund + creator fees owed out of each vault. */
  fees0: bigint;
  fees1: bigint;
}

export function decodeCpmmPool(address: PublicKey, data: Buffer | Uint8Array): CpmmPool {
  const d = Buffer.from(data);
  if (d.length < POOL_STATE_LEN || !d.subarray(0, 8).equals(POOL_STATE_DISCRIMINATOR)) throw new Error(`${address.toBase58()} is not a CPMM PoolState`);
  const pk = (at: number) => new PublicKey(d.subarray(at, at + 32));
  const u64 = (at: number) => d.readBigUInt64LE(at);
  return {
    address,
    ammConfig: pk(8),
    poolCreator: pk(40),
    token0Vault: pk(72),
    token1Vault: pk(104),
    lpMint: pk(136),
    lpSupply: u64(333),
    token0Mint: pk(168),
    token1Mint: pk(200),
    token0Program: pk(232),
    token1Program: pk(264),
    observationKey: pk(296),
    status: d[329],
    openTime: u64(373),
    enableCreatorFee: d[390] !== 0,
    fees0: u64(341) + u64(357) + u64(397),
    fees1: u64(349) + u64(365) + u64(405),
  };
}

/** The accounts `crank_buyback` needs from the pool, oriented WSOL → token. */
export interface BuybackPoolAccounts {
  pool: PublicKey;
  ammConfig: PublicKey;
  cpmmAuthority: PublicKey;
  wsolVault: PublicKey;
  tokenVault: PublicKey;
  observation: PublicKey;
  wsolIsToken0: boolean;
}

export function buybackPoolAccounts(pool: CpmmPool, mint: PublicKey, cpmmProgramId: PublicKey): BuybackPoolAccounts {
  let wsolIsToken0: boolean;
  if (pool.token0Mint.equals(NATIVE_MINT) && pool.token1Mint.equals(mint)) wsolIsToken0 = true;
  else if (pool.token1Mint.equals(NATIVE_MINT) && pool.token0Mint.equals(mint)) wsolIsToken0 = false;
  else throw new Error(`pool ${pool.address.toBase58()} is not WSOL/${mint.toBase58()}`);
  return {
    pool: pool.address,
    ammConfig: pool.ammConfig,
    cpmmAuthority: cpmmAuthority(cpmmProgramId),
    wsolVault: wsolIsToken0 ? pool.token0Vault : pool.token1Vault,
    tokenVault: wsolIsToken0 ? pool.token1Vault : pool.token0Vault,
    observation: pool.observationKey,
    wsolIsToken0,
  };
}

export async function fetchCpmmPool(connection: Connection, address: PublicKey, cpmmProgramId: PublicKey): Promise<CpmmPool> {
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info) throw new Error(`pool ${address.toBase58()} not found`);
  if (!info.owner.equals(cpmmProgramId)) throw new Error(`pool ${address.toBase58()} is not owned by the CPMM program`);
  return decodeCpmmPool(address, info.data);
}
