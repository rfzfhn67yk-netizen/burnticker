import { PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, BPF_LOADER_UPGRADEABLE_ID, type Cluster, CPMM_AUTH_SEED, LAUNCHLAB_CREATOR_FEE_VAULT_AUTH_SEED, LAUNCHLAB_POOL_SEED, LOCK_CPMM_AUTHORITY, LOCK_CPMM_PROGRAM_ID, LOCKED_LIQUIDITY_SEED, NATIVE_MINT, SEED_CONFIG, SEED_FEE, SEED_FEE_KEY, SEED_FEE_KEYS, SEED_PLATFORM, SEED_READING, TOKEN_PROGRAM_ID } from "@/lib/burnReceipts/constants";

/** PDA derivation for burn_receipts (seeds in programs/burn-receipts/.../constants.rs). */

/** The one TokenConfig of a mint: ["config", mint]. */
export const configPda = (programId: PublicKey, mint: PublicKey): PublicKey => PublicKey.findProgramAddressSync([SEED_CONFIG, mint.toBuffer()], programId)[0];

/** The fee PDA: ["fee", mint]. A system-owned account — the creator-fee recipient. */
export const feePda = (programId: PublicKey, mint: PublicKey): PublicKey => PublicKey.findProgramAddressSync([SEED_FEE, mint.toBuffer()], programId)[0];

const u32le = (n: number): Buffer => {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error(`record_date ${n} is not a u32`);
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

/** A reading: ["reading", config, record_date (u32 LE, YYYYMMDD)]. */
export const readingPda = (programId: PublicKey, config: PublicKey, recordDate: number): PublicKey =>
  PublicKey.findProgramAddressSync([SEED_READING, config.toBuffer(), u32le(recordDate)], programId)[0];

export const associatedTokenAddress = (owner: PublicKey, mint: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];

/** Vault mode: the vault is the config PDA's associated token account. */
export const vaultAddress = (programId: PublicKey, mint: PublicKey): PublicKey => associatedTokenAddress(configPda(programId, mint), mint);

/** Buyback mode: the fee PDA's WSOL and token accounts (the swap's input and output; Raydium pays creator fees into them). */
export const feeWsolAddress = (programId: PublicKey, mint: PublicKey): PublicKey => associatedTokenAddress(feePda(programId, mint), NATIVE_MINT);
export const feeTokenAddress = (programId: PublicKey, mint: PublicKey): PublicKey => associatedTokenAddress(feePda(programId, mint), mint);

export const cpmmAuthority = (cpmmProgramId: PublicKey): PublicKey => PublicKey.findProgramAddressSync([CPMM_AUTH_SEED], cpmmProgramId)[0];

/** The program-wide PlatformConfig: ["platform"]. */
export const platformPda = (programId: PublicKey): PublicKey => PublicKey.findProgramAddressSync([SEED_PLATFORM], programId)[0];

/** The program's ProgramData account (BPF Upgradeable Loader), whose upgrade authority may create the PlatformConfig. */
export const programDataAddress = (programId: PublicKey): PublicKey => PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_LOADER_UPGRADEABLE_ID)[0];

/** LaunchLab's creator-fee vault authority (SDK getPdaCreatorFeeVaultAuth) and the creator vault for (creator, WSOL) (getPdaCreatorVault). */
export const launchlabVaultAuthority = (launchlabProgramId: PublicKey): PublicKey => PublicKey.findProgramAddressSync([LAUNCHLAB_CREATOR_FEE_VAULT_AUTH_SEED], launchlabProgramId)[0];
/** LaunchLab's vault authority ["vault_auth_seed"] — the locker its CPMM migration records in LockedCpLiquidityState @128. */
export const launchlabMigrationLocker = (launchlabProgramId: PublicKey): PublicKey => PublicKey.findProgramAddressSync([Buffer.from("vault_auth_seed", "utf8")], launchlabProgramId)[0];
/** The CPMM pool PDA ["pool", amm_config, token_0, token_1] (token_0 < token_1) — LaunchLab's migration pool for (cpConfigId, WSOL, mint). */
export const cpmmPoolPda = (cpmmProgramId: PublicKey, ammConfig: PublicKey, mintA: PublicKey, mintB: PublicKey): PublicKey => {
  const [t0, t1] = Buffer.compare(mintA.toBuffer(), mintB.toBuffer()) < 0 ? [mintA, mintB] : [mintB, mintA];
  return PublicKey.findProgramAddressSync([Buffer.from("pool", "utf8"), ammConfig.toBuffer(), t0.toBuffer(), t1.toBuffer()], cpmmProgramId)[0];
};
export const launchlabCreatorFeeVault = (launchlabProgramId: PublicKey, creator: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([creator.toBuffer(), NATIVE_MINT.toBuffer()], launchlabProgramId)[0];

/** The token's LaunchLab pool: ["pool", mint, WSOL] under LaunchLab (SDK getPdaLaunchpadPoolId) — register_pool reads it (review-2 F5). */
export const launchlabPoolPda = (launchlabProgramId: PublicKey, mint: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([LAUNCHLAB_POOL_SEED, mint.toBuffer(), NATIVE_MINT.toBuffer()], launchlabProgramId)[0];

/** Raydium's LP-lock account for an LP mint: the lock authority's ATA (SDK makeCpmmLockInstruction lockLpVault). */
export const lpLockVault = (cluster: Cluster, lpMint: PublicKey): PublicKey => associatedTokenAddress(LOCK_CPMM_AUTHORITY[cluster], lpMint);

/** LAUNCHPAD-PATH §35: the global Fee Key holder (LaunchLab platformLockNftWallet) and the per-mint FeeKeyRecord. */
export const feeKeysPda = (programId: PublicKey): PublicKey => PublicKey.findProgramAddressSync([SEED_FEE_KEYS], programId)[0];
export const feeKeyRecordPda = (programId: PublicKey, mint: PublicKey): PublicKey => PublicKey.findProgramAddressSync([SEED_FEE_KEY, mint.toBuffer()], programId)[0];
/** The lock program's LockedCpLiquidityState for a Fee Key NFT, and its authority PDA. */
export const lockedLiquidityPda = (cluster: Cluster, feeNftMint: PublicKey): PublicKey => PublicKey.findProgramAddressSync([LOCKED_LIQUIDITY_SEED, feeNftMint.toBuffer()], LOCK_CPMM_PROGRAM_ID[cluster])[0];
/** FEE_KEYS's account holding a Fee Key NFT. */
export const feeNftAccount = (programId: PublicKey, feeNftMint: PublicKey): PublicKey => associatedTokenAddress(feeKeysPda(programId), feeNftMint);

// LAUNCHPAD-PATH §40 (winner takes the burn). Seeds = the program's PAIR_LINK_SEED / PAIR_RESULT_SEED (pairs.ts checks them against the IDL).

/** (lo, hi) by raw 32-byte comparison — the order of the PairResult seeds and of submit_pair_result's config_lo / config_hi. */
export function pairOrder(a: PublicKey, b: PublicKey): [PublicKey, PublicKey] {
  return Buffer.compare(a.toBuffer(), b.toBuffer()) < 0 ? [a, b] : [b, a];
}

/** PairLink ["pair_link", mint]. */
export const pairLinkPda = (programId: PublicKey, mint: PublicKey): PublicKey => PublicKey.findProgramAddressSync([Buffer.from("pair_link", "utf8"), mint.toBuffer()], programId)[0];

/** PairResult ["pair_result", mint_lo, mint_hi, record_date u32 LE] — the two mints in any order. */
export function pairResultPda(programId: PublicKey, a: PublicKey, b: PublicKey, recordDate: number): PublicKey {
  const [lo, hi] = pairOrder(a, b);
  const d = Buffer.alloc(4);
  d.writeUInt32LE(recordDate);
  return PublicKey.findProgramAddressSync([Buffer.from("pair_result", "utf8"), lo.toBuffer(), hi.toBuffer(), d], programId)[0];
}
