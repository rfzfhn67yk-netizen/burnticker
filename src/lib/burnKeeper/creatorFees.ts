import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { CpmmPoolInfoLayout, LaunchpadPool, PlatformConfig, getCpmmPdaPoolId, getPdaPoolAuthority, collectCreatorFeePermissionlessInInstruction } from "@raydium-io/raydium-sdk-v2";
import { associatedTokenAddress, TOKEN_PROGRAM_ID } from "@/lib/burnKeeper/solana";
import { launchLabPoolId, WSOL_MINT } from "@/lib/burnKeeper/launchlab";

/**
 * CREATOR FEES AFTER GRADUATION (2026-10-09; retargeted the same evening after the blind review's H-2: the creator is the burn
 * program's FEE PDA, not the keeper — see burnPool.ts). Read from the SDK (raydium-sdk-V2 0.2.74-alpha: src/raydium/cpmm/
 * {instruction,layout,pda}.ts, src/raydium/launchpad/layout.ts), raydium-cp-swap@b3187ae5 collect_creator_fee_permissionless.rs and
 * the Raydium docs (products/launchlab/creator-fees, products/cpmm/fees, products/cpmm/accounts); docs/burnkeeper/fees.md has the
 * full account of who gets what.
 *
 * WHAT HAPPENS AT GRADUATION. When the curve fills, LaunchLab migrates the pool to Raydium CPMM through the CPMM program's permissioned
 * create path, with `enable_creator_fee = true` and `creator_fee_on` taken from the launch (cpmmCreatorFeeOn — OnlyTokenB = fees always on
 * the SOL side). The CPMM pool's `pool_creator` is the LAUNCH CREATOR when the platform's `platform_cp_creator` is the default pubkey
 * (Raydium's own platform leaves it default; ours does too) — i.e. the fee PDA. From then on every CPMM swap charges AmmConfig.
 * creator_fee_rate of volume (5 bps on every mainnet tier) INTO THE POOL'S OWN COUNTERS (PoolState.creator_fees_token_0/1).
 *
 * HOW THE FEES REACH THE BURN POOL. `collect_creator_fee_permissionless` on the CPMM program: ANY payer signs (the keeper pays the
 * fee), `creator` is constrained to `pool_state.pool_creator` (the fee PDA — no signature from it), the destinations are the creator's
 * canonical ATAs which the program creates itself (`init_if_needed`, payer = the keeper), the protocol keeps creator_fee_share_rate at
 * collection (5% on mainnet tier 0). The SOL side lands as WSOL in the fee PDA's WSOL ATA — exactly the account `crank_buyback` counts
 * as part of the pool (`fee − reserve + wsol`) and spends from; a token side (only with `BothToken`) lands in the fee PDA's token ATA,
 * which the crank burns. Nothing is unwrapped and nothing passes through the keeper's wallet. Account order as the SDK's
 * collectCreatorFeePermissionlessInInstruction (= the program's struct: payer, creator, authority, pool, vault0, vault1, mint0, mint1,
 * creator_token_0, creator_token_1, program0, program1, ATA program, system, amm_config, creator_fee_share PDA — passed even when it
 * does not exist; the program falls back to AmmConfig.creator_fee_share_rate).
 *
 * FINDING THE POOL. The CPMM pool id is a PDA of (amm config, token0, token1) with the mints in byte order (docs cpmm/accounts
 * "token0 < token1"); the amm config is the launch platform's cpConfigId, read from the LaunchLab pool → platform config so a wrong
 * env value cannot point the keeper at someone else's pool. Both mint orders are tried and the one that exists wins. Before graduation
 * there is no CPMM pool and the plan says so (nothing is signed).
 *
 * BEHIND BURNKEEPER_CLAIM_CREATOR_FEES=1 (buyback mode), simulated before it is sent, like every other keeper transaction.
 */

export interface AccountReader { getAccount(pubkey: PublicKey): Promise<{ data: Uint8Array; owner: PublicKey } | null> }

export type GraduatedClaimPlan =
  | { kind: "claim"; poolId: PublicKey; ammConfig: PublicKey; accrued: { sol: bigint; token: bigint }; destinations: { wsol: PublicKey; token: PublicKey }; instructions: TransactionInstruction[] }
  | { kind: "skip"; why: string; poolId: PublicKey | null };

export interface GraduatedClaimInput {
  /** Pays the transaction fee (and the fee PDA's ATAs' rent if they do not exist yet). Signs nothing else. */
  payer: PublicKey;
  /** The burn pool = the burn program's fee PDA for the mint — the launch creator and so the CPMM pool_creator. */
  burnPool: PublicKey;
  mint: PublicKey;
  launchLabProgram: PublicKey;
  cpmmProgram: PublicKey;
  /** The LaunchLab pool (default: the PDA of (program, mint, WSOL)). */
  launchLabPool?: PublicKey;
}

const ZERO = BigInt(0);

/** Reads the chain (through the port) and returns either the claim's instruction or the reason there is nothing to do. Pure apart from the reads. */
export async function planGraduatedCreatorFeeClaim(i: GraduatedClaimInput, chain: AccountReader): Promise<GraduatedClaimPlan> {
  const llPool = i.launchLabPool ?? launchLabPoolId(i.launchLabProgram, i.mint, WSOL_MINT);
  const llAcc = await chain.getAccount(llPool);
  if (!llAcc) return { kind: "skip", why: `LaunchLab pool ${llPool.toBase58()} not found`, poolId: null };
  if (!llAcc.owner.equals(i.launchLabProgram)) return { kind: "skip", why: `LaunchLab pool ${llPool.toBase58()} is owned by ${llAcc.owner.toBase58()}, not the LaunchLab program`, poolId: null };
  const ll = LaunchpadPool.decode(Buffer.from(llAcc.data));
  if (!ll.mintA.equals(i.mint)) return { kind: "skip", why: `LaunchLab pool ${llPool.toBase58()} is for mint ${ll.mintA.toBase58()}, not ${i.mint.toBase58()}`, poolId: null };
  if (!ll.creator.equals(i.burnPool)) return { kind: "skip", why: `the launch creator is ${ll.creator.toBase58()}, not the burn pool's fee PDA ${i.burnPool.toBase58()} — creator fees do not belong to the burn pool (H-2)`, poolId: null };
  const platAcc = await chain.getAccount(ll.platformId);
  if (!platAcc) return { kind: "skip", why: `platform config ${ll.platformId.toBase58()} not found`, poolId: null };
  const plat = PlatformConfig.decode(Buffer.from(platAcc.data));
  if (!plat.platformCpCreator.equals(PublicKey.default) && !plat.platformCpCreator.equals(i.burnPool)) return { kind: "skip", why: `the platform routes CPMM creator fees to platformCpCreator ${plat.platformCpCreator.toBase58()}, not the launch creator`, poolId: null };
  const ammConfig = plat.cpConfigId;
  // The pool: mints in byte order first (what the program requires), the other order as a fallback.
  const [m0, m1] = Buffer.compare(i.mint.toBuffer(), WSOL_MINT.toBuffer()) < 0 ? [i.mint, WSOL_MINT] : [WSOL_MINT, i.mint];
  const candidates = [getCpmmPdaPoolId(i.cpmmProgram, ammConfig, m0, m1).publicKey, getCpmmPdaPoolId(i.cpmmProgram, ammConfig, m1, m0).publicKey];
  let poolId: PublicKey | null = null, poolAcc: { data: Uint8Array; owner: PublicKey } | null = null;
  for (const c of candidates) { const a = await chain.getAccount(c); if (a && a.owner.equals(i.cpmmProgram)) { poolId = c; poolAcc = a; break; } }
  if (!poolId || !poolAcc) return { kind: "skip", why: `not graduated yet: no CPMM pool for (${ammConfig.toBase58()}, ${i.mint.toBase58()}, WSOL) under ${i.cpmmProgram.toBase58()} (LaunchLab status ${ll.status})`, poolId: null };
  const pool = CpmmPoolInfoLayout.decode(Buffer.from(poolAcc.data));
  if (!pool.poolCreator.equals(i.burnPool)) return { kind: "skip", why: `CPMM pool_creator is ${pool.poolCreator.toBase58()}, not the fee PDA — the program would pay someone else`, poolId };
  if (!pool.enableCreatorFee) return { kind: "skip", why: "the CPMM pool was created with enable_creator_fee = false — no creator fees ever accrue here", poolId };
  if (!pool.mintProgramA.equals(TOKEN_PROGRAM_ID) || !pool.mintProgramB.equals(TOKEN_PROGRAM_ID)) return { kind: "skip", why: "a Token-2022 side — this keeper only handles classic SPL mints", poolId };
  const mintAIsToken = pool.mintA.equals(i.mint);
  const accruedToken = BigInt((mintAIsToken ? pool.creatorFeesMintA : pool.creatorFeesMintB).toString());
  const accruedSol = BigInt((mintAIsToken ? pool.creatorFeesMintB : pool.creatorFeesMintA).toString());
  if (accruedToken === ZERO && accruedSol === ZERO) return { kind: "skip", why: "nothing accrued (creator_fees_token_0/1 both 0)", poolId };
  const ataA = associatedTokenAddress(i.burnPool, pool.mintA), ataB = associatedTokenAddress(i.burnPool, pool.mintB);
  const ix = collectCreatorFeePermissionlessInInstruction(i.cpmmProgram, i.payer, i.burnPool, getPdaPoolAuthority(i.cpmmProgram).publicKey, poolId, ammConfig, pool.vaultA, pool.vaultB, pool.mintA, pool.mintB, ataA, ataB, pool.mintProgramA, pool.mintProgramB);
  return { kind: "claim", poolId, ammConfig, accrued: { sol: accruedSol, token: accruedToken }, destinations: { wsol: mintAIsToken ? ataB : ataA, token: mintAIsToken ? ataA : ataB }, instructions: [ix] };
}
