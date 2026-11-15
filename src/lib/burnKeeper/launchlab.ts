import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, type Cluster } from "@/lib/burnKeeper/solana";

/**
 * RAYDIUM LAUNCHLAB — the one instruction the keeper needs from it (the owner, 2026-10-09 evening: the venue is LaunchLab and the burn
 * vault is a LaunchLab VESTING allocation to the keeper's wallet). Read from the SDK source (raydium-sdk-V2 0.2.74-alpha,
 * src/raydium/launchpad/{instrument,pda,layout}.ts) and the LaunchLab docs; see docs/burnkeeper/launchlab-devnet.md.
 *
 * WHY THE KEEPER CLAIMS. LaunchLab keeps the vested share in the pool's base vault until the BENEFICIARY signs ClaimVestedToken;
 * nothing is pushed to the wallet, and nobody else can claim it. The keeper's key is the beneficiary, so before a burn the keeper
 * tries a claim into its own associated token account (the burn vault). The claim is SIMULATED first and sent only if the program
 * accepts it — before graduation (PoolNotMigrated), before the cliff (VestingNotStarted) or with nothing new vested
 * (NoAssetsToCollect) the simulation fails and the keeper simply burns what the vault already holds (and posts any shortfall).
 *
 * VESTING STARTS AT GRADUATION, not at creation (docs: start_time = block_time + cliff_period at migration). Until the bonding curve
 * completes, the vault stays empty and every unit day is a memo-only shortfall day.
 *
 * NOT EXERCISED ON CHAIN. Devnet graduation needs Raydium's migration wallet to sign and no devnet crank could be confirmed, so the
 * claim cannot be shown end-to-end on devnet; the encoding is checked against the SDK's own bytes in the tests (discriminator =
 * sha256("global:claim_vested_token")[0..8], account order as instrument.ts). POOL_VAULT_SEED ("pool_vault") is the SDK's CLMM
 * constant, imported there from ../clmm — taken as Raydium's standard value, flagged as such.
 */

export const LAUNCHLAB_PROGRAM: Record<"mainnet" | "devnet", PublicKey> = {
  mainnet: new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"),
  devnet: new PublicKey("DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6"),
};
export const launchLabProgramFor = (c: Cluster): PublicKey | null => (c === "mainnet" ? LAUNCHLAB_PROGRAM.mainnet : c === "devnet" ? LAUNCHLAB_PROGRAM.devnet : null);
/** Raydium CPMM (the post-graduation pool's program; SDK programId.ts CREATE_CPMM_POOL_PROGRAM / DEVNET_PROGRAM_ID). */
export const CPMM_PROGRAM_ID: Record<"mainnet" | "devnet", PublicKey> = {
  mainnet: new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"),
  devnet: new PublicKey("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb"),
};
export const cpmmProgramFor = (c: Cluster): PublicKey | undefined => (c === "mainnet" ? CPMM_PROGRAM_ID.mainnet : c === "devnet" ? CPMM_PROGRAM_ID.devnet : undefined);

export const CLAIM_VESTED_TOKEN_DISCRIMINATOR = Buffer.from([49, 33, 104, 30, 189, 157, 79, 35]);
const AUTH_SEED = Buffer.from("vault_auth_seed", "utf8");
const POOL_SEED = Buffer.from("pool", "utf8");
const POOL_VAULT_SEED = Buffer.from("pool_vault", "utf8");
const POOL_VESTING_SEED = Buffer.from("pool_vesting", "utf8");

export const launchLabAuth = (programId: PublicKey) => PublicKey.findProgramAddressSync([AUTH_SEED], programId)[0];
export const launchLabPoolId = (programId: PublicKey, mintA: PublicKey, mintB: PublicKey) => PublicKey.findProgramAddressSync([POOL_SEED, mintA.toBuffer(), mintB.toBuffer()], programId)[0];
export const launchLabVault = (programId: PublicKey, poolId: PublicKey, mint: PublicKey) => PublicKey.findProgramAddressSync([POOL_VAULT_SEED, poolId.toBuffer(), mint.toBuffer()], programId)[0];
export const launchLabVestingRecord = (programId: PublicKey, poolId: PublicKey, beneficiary: PublicKey) => PublicKey.findProgramAddressSync([POOL_VESTING_SEED, poolId.toBuffer(), beneficiary.toBuffer()], programId)[0];

/**
 * ClaimVestedToken (no arguments). Accounts, in the SDK's order: beneficiary (signer, writable), auth PDA, pool (w), vesting record
 * (w), pool base vault (w), beneficiary's token account (w), mint, token program, system program, associated-token program.
 */
export function claimVestedTokenIx(i: { programId: PublicKey; beneficiary: PublicKey; poolId: PublicKey; mintA: PublicKey; beneficiaryTokenAccount: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: i.programId,
    keys: [
      { pubkey: i.beneficiary, isSigner: true, isWritable: true },
      { pubkey: launchLabAuth(i.programId), isSigner: false, isWritable: false },
      { pubkey: i.poolId, isSigner: false, isWritable: true },
      { pubkey: launchLabVestingRecord(i.programId, i.poolId, i.beneficiary), isSigner: false, isWritable: true },
      { pubkey: launchLabVault(i.programId, i.poolId, i.mintA), isSigner: false, isWritable: true },
      { pubkey: i.beneficiaryTokenAccount, isSigner: false, isWritable: true },
      { pubkey: i.mintA, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(CLAIM_VESTED_TOKEN_DISCRIMINATOR),
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Creator fees → the keeper's fee pool (buyback mode, the owner 2026-10-09 evening)
// ---------------------------------------------------------------------------------------------------------------------------------

export const CLAIM_CREATOR_FEE_DISCRIMINATOR = Buffer.from([26, 97, 138, 203, 132, 171, 141, 252]);
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const CREATOR_FEE_VAULT_AUTH_SEED = Buffer.from("creator_fee_vault_auth_seed", "utf8");
export const launchLabCreatorFeeVault = (programId: PublicKey, creator: PublicKey, mintB: PublicKey) => PublicKey.findProgramAddressSync([creator.toBuffer(), mintB.toBuffer()], programId)[0];
export const launchLabCreatorFeeAuth = (programId: PublicKey) => PublicKey.findProgramAddressSync([CREATOR_FEE_VAULT_AUTH_SEED], programId)[0];

/**
 * LaunchLab's creator fee accrues in the QUOTE token (SOL → wrapped SOL) in a vault keyed by (creator, quote mint), and only the
 * CREATOR may claim it — so for the fees to fund the buyback without anyone forwarding them, the keeper's key must be the launch's
 * creator. The claim lands as wrapped SOL in the keeper's WSOL account; the third instruction closes that account, which unwraps it
 * into native SOL in the keeper's wallet — the fee pool. Accounts as the SDK's claimCreatorFee (instrument.ts) — checked BYTE FOR BYTE
 * against the SDK's builder in test/burnKeeperLaunch.test.ts (10-09, after the SDK was pinned). This is the bonding-curve vault, which
 * keeps accruing until graduation and keeps its balance after; the CPMM pool's creator fee after graduation is claimed by
 * creatorFees.ts (collect_creator_fee on the CPMM program). The keeper simulates both first and skips when the program refuses.
 */
export function claimCreatorFeeIxs(programId: PublicKey, creator: PublicKey): TransactionInstruction[] {
  const ata = PublicKey.findProgramAddressSync([creator.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
  return [
    new TransactionInstruction({ programId: ASSOCIATED_TOKEN_PROGRAM_ID, data: Buffer.from([1]), keys: [
      { pubkey: creator, isSigner: true, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true }, { pubkey: creator, isSigner: false, isWritable: false },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ] }),
    new TransactionInstruction({ programId, data: Buffer.from(CLAIM_CREATOR_FEE_DISCRIMINATOR), keys: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: launchLabCreatorFeeAuth(programId), isSigner: false, isWritable: false },
      { pubkey: launchLabCreatorFeeVault(programId, creator, WSOL_MINT), isSigner: false, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ] }),
    // SPL Token CloseAccount (9): the WSOL account's lamports (the claimed fees + its rent) go to the keeper as native SOL.
    new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, data: Buffer.from([9]), keys: [
      { pubkey: ata, isSigner: false, isWritable: true }, { pubkey: creator, isSigner: false, isWritable: true }, { pubkey: creator, isSigner: true, isWritable: false },
    ] }),
  ];
}

/** The vesting record (SDK layout LaunchpadVesting): discriminator, epoch, pool, beneficiary, claimedAmount @80, tokenShareAmount @88. */
export function parseVestingRecord(data: Uint8Array): { poolId: string; beneficiary: string; claimedRaw: bigint; shareRaw: bigint } | null {
  if (data.length < 96) return null;
  const b = Buffer.from(data);
  return {
    poolId: new PublicKey(b.subarray(16, 48)).toBase58(),
    beneficiary: new PublicKey(b.subarray(48, 80)).toBase58(),
    claimedRaw: b.readBigUInt64LE(80),
    shareRaw: b.readBigUInt64LE(88),
  };
}
