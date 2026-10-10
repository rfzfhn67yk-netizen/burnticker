import { PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, BPF_LOADER_UPGRADEABLE_ID, type Cluster, CPMM_AUTH_SEED, LAUNCHLAB_CREATOR_FEE_VAULT_AUTH_SEED, LAUNCHLAB_POOL_SEED, LOCK_CPMM_AUTHORITY, NATIVE_MINT, SEED_CONFIG, SEED_FEE, SEED_PLATFORM, SEED_READING, TOKEN_PROGRAM_ID } from "@/lib/burnReceipts/constants";

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
export const launchlabCreatorFeeVault = (launchlabProgramId: PublicKey, creator: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([creator.toBuffer(), NATIVE_MINT.toBuffer()], launchlabProgramId)[0];

/** The token's LaunchLab pool: ["pool", mint, WSOL] under LaunchLab (SDK getPdaLaunchpadPoolId) — register_pool reads it (review-2 F5). */
export const launchlabPoolPda = (launchlabProgramId: PublicKey, mint: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([LAUNCHLAB_POOL_SEED, mint.toBuffer(), NATIVE_MINT.toBuffer()], launchlabProgramId)[0];

/** Raydium's LP-lock account for an LP mint: the lock authority's ATA (SDK makeCpmmLockInstruction lockLpVault). */
export const lpLockVault = (cluster: Cluster, lpMint: PublicKey): PublicKey => associatedTokenAddress(LOCK_CPMM_AUTHORITY[cluster], lpMint);
