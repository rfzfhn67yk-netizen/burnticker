import { PublicKey } from "@solana/web3.js";

/**
 * THE SWAP PANEL'S ACCOUNT READERS (swap-1, 2026-10-14; the owner: "make it so you can trade the launched coins on the site"). The
 * browser cannot load the Raydium SDK, so the four accounts a swap needs are read here by byte offset, exactly as the pinned SDK's
 * layouts lay them out (@raydium-io/raydium-sdk-v2 0.2.74-alpha: src/raydium/launchpad/layout.ts LaunchpadPool, LaunchpadConfig,
 * PlatformConfig; src/raydium/cpmm/layout.ts CpmmConfigInfoLayout). test/burntickerSwap.test.ts decodes the same bytes with the SDK and
 * checks every field. The CPMM pool itself is read by src/lib/burnReceipts/cpmm.ts (the burn program's own reader). Client-safe.
 */

const u64 = (d: Uint8Array, at: number): bigint => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(at, true);
const u16 = (d: Uint8Array, at: number): number => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint16(at, true);
const pk = (d: Uint8Array, at: number): PublicKey => new PublicKey(d.subarray(at, at + 32));

/** LaunchLab pool status: 0 trading on the curve, 1 migrating to its Raydium pool, 2 migrated. */
export const CURVE_TRADING = 0;
export const LAUNCHLAB_POOL_LEN = 429;

export interface CurvePool {
  status: number;
  decimalsA: number;
  decimalsB: number;
  supply: bigint;
  totalSellA: bigint;
  virtualA: bigint;
  virtualB: bigint;
  realA: bigint;
  realB: bigint;
  totalFundRaisingB: bigint;
  configId: PublicKey;
  platformId: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  creator: PublicKey;
  /** 0 = SPL Token, 1 = Token-2022 */
  mintProgramFlag: number;
}

export function decodeCurvePool(data: Uint8Array): CurvePool {
  if (data.length < LAUNCHLAB_POOL_LEN) throw new Error("not a LaunchLab pool");
  return {
    status: data[17], decimalsA: data[18], decimalsB: data[19],
    supply: u64(data, 21), totalSellA: u64(data, 29), virtualA: u64(data, 37), virtualB: u64(data, 45), realA: u64(data, 53), realB: u64(data, 61), totalFundRaisingB: u64(data, 69),
    configId: pk(data, 141), platformId: pk(data, 173), mintA: pk(data, 205), mintB: pk(data, 237), vaultA: pk(data, 269), vaultB: pk(data, 301), creator: pk(data, 333),
    mintProgramFlag: data[365],
  };
}

/** LaunchLab's global config: the curve type and Raydium's own trade fee (ppm of the SOL amount). */
export interface CurveConfig { curveType: number; index: number; tradeFeeRate: bigint }
export function decodeCurveConfig(data: Uint8Array): CurveConfig {
  if (data.length < 35) throw new Error("not a LaunchLab config");
  return { curveType: data[16], index: u16(data, 17), tradeFeeRate: u64(data, 27) };
}

/** The platform config: the platform's fee and the creator fee (on Burnticker the creator is the coin's burn pool), ppm. */
export interface CurvePlatform { feeRate: bigint; creatorFeeRate: bigint }
export function decodeCurvePlatform(data: Uint8Array): CurvePlatform {
  if (data.length < 728) throw new Error("not a LaunchLab platform config");
  return { feeRate: u64(data, 104), creatorFeeRate: u64(data, 720) };
}

/** Raydium CPMM AmmConfig: rates in ppm. */
export interface CpmmConfig { tradeFeeRate: bigint; protocolFeeRate: bigint; fundFeeRate: bigint; creatorFeeRate: bigint }
export function decodeCpmmConfig(data: Uint8Array): CpmmConfig {
  if (data.length < 116) throw new Error("not a CPMM AmmConfig");
  return { tradeFeeRate: u64(data, 12), protocolFeeRate: u64(data, 20), fundFeeRate: u64(data, 28), creatorFeeRate: u64(data, 108) };
}

/** The CPMM pool's creator-fee side (PoolState.creator_fee_on @389: 0 both tokens, 1 token 0 only, 2 token 1 only) and swap switch. */
export function cpmmPoolExtras(data: Uint8Array): { creatorFeeOn: number; enableCreatorFee: boolean; swapDisabled: boolean; decimals0: number; decimals1: number } {
  return { creatorFeeOn: data[389], enableCreatorFee: data[390] !== 0, swapDisabled: ((data[329] >> 2) & 1) === 1, decimals0: data[331], decimals1: data[332] };
}
