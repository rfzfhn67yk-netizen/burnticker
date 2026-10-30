import { Buffer } from "buffer";
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

/**
 * THE SWAP PANEL'S INSTRUCTION BUILDERS (swap-1, 2026-10-14). Byte for byte the pinned SDK's low-level builders, which the devnet trader
 * (scripts/burnticker-devnet-trader.mts) and the launch CLI use: LaunchLab buyExactInInstruction / sellExactInInstruction
 * (src/raydium/launchpad/instrument.ts) and CPMM makeSwapCpmmBaseInInstruction (src/raydium/cpmm/instruction.ts). Rewritten here only
 * because the browser cannot load the SDK; test/burntickerSwap.test.ts compares keys and data with the SDK's for the same inputs.
 * Nothing here signs or sends. Every account the wallet owns is the wallet's own: no operator key appears anywhere in a swap.
 */

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

export const LAUNCHLAB_PROGRAM: Record<"mainnet" | "devnet", PublicKey> = {
  mainnet: new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"),
  devnet: new PublicKey("DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6"),
};
export const CPMM_PROGRAM: Record<"mainnet" | "devnet", PublicKey> = {
  mainnet: new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"),
  devnet: new PublicKey("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb"),
};

const DISC = {
  buyExactIn: [250, 234, 13, 123, 213, 156, 19, 236],
  sellExactIn: [149, 39, 222, 155, 211, 124, 152, 26],
  swapBaseInput: [143, 190, 90, 218, 196, 30, 51, 222],
};

const pda = (seeds: (Buffer | Uint8Array)[], program: PublicKey): PublicKey => PublicKey.findProgramAddressSync(seeds, program)[0];
export const launchLabAuth = (program: PublicKey) => pda([Buffer.from("vault_auth_seed", "utf8")], program);
export const launchLabEventAuthority = (program: PublicKey) => pda([Buffer.from("__event_authority", "utf8")], program);
export const launchLabPoolId = (program: PublicKey, mintA: PublicKey, mintB: PublicKey = WSOL_MINT) => pda([Buffer.from("pool", "utf8"), mintA.toBuffer(), mintB.toBuffer()], program);
export const launchLabPlatformVault = (program: PublicKey, platformId: PublicKey, mintB: PublicKey = WSOL_MINT) => pda([platformId.toBuffer(), mintB.toBuffer()], program);
export const launchLabCreatorVault = (program: PublicKey, creator: PublicKey, mintB: PublicKey = WSOL_MINT) => pda([creator.toBuffer(), mintB.toBuffer()], program);
export const cpmmAuthority = (program: PublicKey) => pda([Buffer.from("vault_and_lp_mint_auth_seed", "utf8")], program);
export const associatedTokenAddress = (owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey = TOKEN_PROGRAM_ID) => pda([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID);

const u64le = (...v: bigint[]): Buffer => { const b = Buffer.alloc(8 * v.length); v.forEach((x, i) => b.writeBigUInt64LE(x, 8 * i)); return b; };
const w = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });

export interface CurveSwapAccounts {
  program: PublicKey; owner: PublicKey; configId: PublicKey; platformId: PublicKey; poolId: PublicKey;
  userTokenAccount: PublicKey; userWsolAccount: PublicKey; vaultA: PublicKey; vaultB: PublicKey; mintA: PublicKey; creator: PublicKey;
}

function curveKeys(a: CurveSwapAccounts) {
  return [
    { pubkey: a.owner, isSigner: true, isWritable: true }, r(launchLabAuth(a.program)), r(a.configId), r(a.platformId), w(a.poolId),
    w(a.userTokenAccount), w(a.userWsolAccount), w(a.vaultA), w(a.vaultB), r(a.mintA), r(WSOL_MINT), r(TOKEN_PROGRAM_ID), r(TOKEN_PROGRAM_ID),
    r(launchLabEventAuthority(a.program)), r(a.program), r(SystemProgram.programId),
    w(launchLabPlatformVault(a.program, a.platformId)), w(launchLabCreatorVault(a.program, a.creator)),
  ];
}

/** LaunchLab buy_exact_in: `lamportsIn` of wrapped SOL for at least `minTokensOut`; share fee 0, no share receiver. */
export function curveBuyExactInIx(a: CurveSwapAccounts, lamportsIn: bigint, minTokensOut: bigint): TransactionInstruction {
  return new TransactionInstruction({ programId: a.program, keys: curveKeys(a), data: Buffer.concat([Buffer.from(DISC.buyExactIn), u64le(lamportsIn, minTokensOut, BigInt(0))]) });
}
/** LaunchLab sell_exact_in: `tokensIn` for at least `minLamportsOut` of wrapped SOL; share fee 0, no share receiver. */
export function curveSellExactInIx(a: CurveSwapAccounts, tokensIn: bigint, minLamportsOut: bigint): TransactionInstruction {
  return new TransactionInstruction({ programId: a.program, keys: curveKeys(a), data: Buffer.concat([Buffer.from(DISC.sellExactIn), u64le(tokensIn, minLamportsOut, BigInt(0))]) });
}

export interface CpmmSwapAccounts {
  program: PublicKey; owner: PublicKey; ammConfig: PublicKey; poolId: PublicKey; userInput: PublicKey; userOutput: PublicKey;
  inputVault: PublicKey; outputVault: PublicKey; inputMint: PublicKey; outputMint: PublicKey; observation: PublicKey;
}
/** Raydium CPMM swap_base_input. */
export function cpmmSwapBaseInputIx(a: CpmmSwapAccounts, amountIn: bigint, minOut: bigint): TransactionInstruction {
  return new TransactionInstruction({
    programId: a.program,
    keys: [
      { pubkey: a.owner, isSigner: true, isWritable: false }, r(cpmmAuthority(a.program)), r(a.ammConfig), w(a.poolId), w(a.userInput), w(a.userOutput),
      w(a.inputVault), w(a.outputVault), r(TOKEN_PROGRAM_ID), r(TOKEN_PROGRAM_ID), r(a.inputMint), r(a.outputMint), w(a.observation),
    ],
    data: Buffer.concat([Buffer.from(DISC.swapBaseInput), u64le(amountIn, minOut)]),
  });
}

/** ATA program CreateIdempotent: the wallet's own token account for `mint`, created when missing, untouched when present. */
export function createAtaIdempotentIx(owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [{ pubkey: owner, isSigner: true, isWritable: true }, w(associatedTokenAddress(owner, mint)), r(owner), r(mint), r(SystemProgram.programId), r(TOKEN_PROGRAM_ID)],
    data: Buffer.from([1]),
  });
}
/** SPL Token SyncNative (17): counts the lamports just sent to the wrapped-SOL account. */
export const syncNativeIx = (account: PublicKey) => new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [w(account)], data: Buffer.from([17]) });
/** SPL Token CloseAccount (9): the wrapped-SOL account's lamports go back to the wallet as SOL. */
export const closeAccountIx = (account: PublicKey, owner: PublicKey) => new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [w(account), w(owner), { pubkey: owner, isSigner: true, isWritable: false }], data: Buffer.from([9]) });

/** The compute budget every swap carries (the devnet trader's: 300k units, 20,000 micro-lamports a unit = at most 0.000006 SOL). */
export const computeBudgetIxs = (): TransactionInstruction[] => [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 })];

/**
 * Wraps a swap in the wallet's own accounts: create the wrapped-SOL and token accounts if missing, wrap `wrapLamports` (SOL in only),
 * the swap, then close the wrapped-SOL account so every lamport not swapped (and the SOL out of a swap to SOL) is plain SOL again.
 */
export function wrapSwap(owner: PublicKey, mint: PublicKey, swap: TransactionInstruction, wrapLamports: bigint | null): TransactionInstruction[] {
  const wsol = associatedTokenAddress(owner, WSOL_MINT);
  const ixs = [...computeBudgetIxs(), createAtaIdempotentIx(owner, WSOL_MINT), createAtaIdempotentIx(owner, mint)];
  if (wrapLamports !== null) ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: wsol, lamports: wrapLamports }), syncNativeIx(wsol));
  ixs.push(swap, closeAccountIx(wsol, owner));
  return ixs;
}
