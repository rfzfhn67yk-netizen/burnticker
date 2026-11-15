import crypto from "node:crypto";
import { type AccountMeta, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { BURN_RECEIPTS_TEST_PROGRAM_ID, configPda, feePda, feeTokenAddress, feeWsolAddress } from "@/lib/burnReceipts";
import { eventAuthority } from "@/lib/burnReceipts/instructions";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { encodeInstruction } from "@/lib/burnReceipts/idlCoder";
import type { AnchorIdl } from "@/lib/burnReceipts/idlTypes";
import { launchLabCreatorFeeAuth, launchLabCreatorFeeVault, WSOL_MINT } from "@/lib/burnKeeper/launchlab";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@/lib/burnKeeper/solana";

/**
 * THE BURN POOL IS A PDA, NOT THE KEEPER (2026-10-09, blind program review finding H-2). For every Burnticker coin, $DEFICIT included,
 * the LaunchLab launch CREATOR must be the burn program's fee PDA for the mint — `["fee", mint]` under burn_receipts
 * (src/lib/burnReceipts/pda.ts) — because:
 *   · `register_pool` (programs/burn-receipts/.../register_pool.rs) accepts only a CPMM pool whose `pool_creator` is the fee PDA, and
 *     Raydium's migration copies LaunchLab's `creator` verbatim into `pool_creator`; a keeper-hot-key creator means the program can
 *     never register the pool, no buyback crank ever runs, and SOL forwarded to the fee PDA is stranded (no withdraw path exists);
 *   · post-graduation creator fees then reach the fee PDA through Raydium's `collect_creator_fee_permissionless` (any payer, destination
 *     pinned to pool_creator's canonical ATAs — raydium-cp-swap@b3187ae5 collect_creator_fee_permissionless.rs) — creatorFees.ts;
 *   · bonding-curve creator fees accrue in LaunchLab's `[creator, WSOL]` vault, which only the creator can claim, so a PDA creator needs
 *     the burn program to CPI LaunchLab's `claim_creator_fee` with the fee-PDA seeds: the program builder is adding a permissionless
 *     `claim_launchlab_creator_fee` whose destination is constrained to the fee PDA's WSOL ATA. `claimLaunchlabCreatorFeeIx` below
 *     builds it from the IDL the moment the instruction lands there; until then it returns a FAKE (source "fake") that the keeper
 *     refuses to send — the layout is a guess and a guessed layout must never reach a cluster.
 *
 * The keeper hot key is left with one job in the fee path: paying transaction fees as the permissionless `payer`.
 */

export const CLAIM_LAUNCHLAB_CREATOR_FEE = "claim_launchlab_creator_fee";

export interface BurnPool { programId: PublicKey; mint: PublicKey; feePda: PublicKey; feeWsol: PublicKey; feeToken: PublicKey; config: PublicKey }

/** The burn pool's addresses for a mint under a burn_receipts deployment. */
export function burnPoolFor(programId: PublicKey, mint: PublicKey): BurnPool {
  return { programId, mint, feePda: feePda(programId, mint), feeWsol: feeWsolAddress(programId, mint), feeToken: feeTokenAddress(programId, mint), config: configPda(programId, mint) };
}

/** BURNTICKER_PROGRAM_ID (the deployed burn_receipts id); null when unset. */
export function burnProgramIdFromEnv(env: Readonly<Record<string, string | undefined>>): PublicKey | null {
  const v = env.BURNTICKER_PROGRAM_ID?.trim();
  if (!v) return null;
  return new PublicKey(v);
}
/** The retired localnet test key (GV9CMj…SuF8) — no deployed program; NOT the IDL's address, which is the real id after `anchor keys sync`. */
export const isLocalnetProgramId = (p: PublicKey) => p.equals(BURN_RECEIPTS_TEST_PROGRAM_ID);

export interface LaunchLabClaim {
  instruction: TransactionInstruction;
  /** "idl": built from the program's IDL (sendable). "fake": the IDL has no such instruction yet — a placeholder for tests and dry-run output, never sent. */
  source: "idl" | "fake";
  accounts: { role: string; pubkey: string; signer: boolean; writable: boolean }[];
}

/** Anchor's `global:<name>` discriminator — what the real instruction will carry; the fake carries it too so a byte diff is only the accounts. */
export const claimLaunchlabCreatorFeeDiscriminator = (): Buffer => crypto.createHash("sha256").update(`global:${CLAIM_LAUNCHLAB_CREATOR_FEE}`).digest().subarray(0, 8);

/**
 * The program's permissionless claim of the bonding-curve creator fees into the fee PDA's WSOL ATA. Accounts the instruction must
 * touch (the names are what we expect the IDL to call them; when the IDL lands with other names the builder throws listing them):
 * payer (signer, fee only), config, fee_vault (the PDA that signs the CPI), fee_wsol (destination), creator_fee_vault (LaunchLab's
 * [fee PDA, WSOL]), creator_fee_vault_authority, wsol_mint, launchlab_program, token_program, associated_token_program,
 * system_program, event_authority, program.
 */
export function claimLaunchlabCreatorFeeIx(o: { programId: PublicKey; payer: PublicKey; mint: PublicKey; launchLabProgram: PublicKey; idl?: AnchorIdl }): LaunchLabClaim {
  const idl = o.idl ?? BURN_RECEIPTS_IDL;
  const pool = burnPoolFor(o.programId, o.mint);
  const named: Record<string, PublicKey> = {
    payer: o.payer, config: pool.config, fee_vault: pool.feePda, fee_wsol: pool.feeWsol, fee_tokens: pool.feeToken,
    creator_fee_vault: launchLabCreatorFeeVault(o.launchLabProgram, pool.feePda, WSOL_MINT), creator_fee_vault_authority: launchLabCreatorFeeAuth(o.launchLabProgram),
    // the program's IDL (2026-10-10) names the same two accounts this way
    launchlab_creator_fee_vault: launchLabCreatorFeeVault(o.launchLabProgram, pool.feePda, WSOL_MINT), launchlab_vault_authority: launchLabCreatorFeeAuth(o.launchLabProgram),
    wsol_mint: WSOL_MINT, launchlab_program: o.launchLabProgram, token_program: TOKEN_PROGRAM_ID, associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID, system_program: SystemProgram.programId,
    event_authority: eventAuthority(o.programId), program: o.programId,
  };
  const spec = idl.instructions.find((i) => i.name === CLAIM_LAUNCHLAB_CREATOR_FEE);
  if (spec) {
    const keys: AccountMeta[] = spec.accounts.map((a) => {
      const pubkey = named[a.name] ?? (a.address ? new PublicKey(a.address) : undefined);
      if (!pubkey) throw new Error(`${CLAIM_LAUNCHLAB_CREATOR_FEE}: the IDL names account "${a.name}" which this builder does not know (IDL accounts: ${spec.accounts.map((x) => x.name).join(", ")}) — update burnPool.ts`);
      return { pubkey, isSigner: !!a.signer, isWritable: !!a.writable };
    });
    const instruction = new TransactionInstruction({ programId: o.programId, keys, data: encodeInstruction(idl, CLAIM_LAUNCHLAB_CREATOR_FEE, {}) });
    return { instruction, source: "idl", accounts: spec.accounts.map((a, n) => ({ role: a.name, pubkey: keys[n].pubkey.toBase58(), signer: keys[n].isSigner, writable: keys[n].isWritable })) };
  }
  const order: [string, boolean, boolean][] = [
    ["payer", true, true], ["config", false, false], ["fee_vault", false, true], ["fee_wsol", false, true], ["creator_fee_vault", false, true], ["creator_fee_vault_authority", false, false],
    ["wsol_mint", false, false], ["launchlab_program", false, false], ["token_program", false, false], ["associated_token_program", false, false], ["system_program", false, false], ["event_authority", false, false], ["program", false, false],
  ];
  const keys: AccountMeta[] = order.map(([name, isSigner, isWritable]) => ({ pubkey: named[name], isSigner, isWritable }));
  const instruction = new TransactionInstruction({ programId: o.programId, keys, data: claimLaunchlabCreatorFeeDiscriminator() });
  return { instruction, source: "fake", accounts: order.map(([role], n) => ({ role, pubkey: keys[n].pubkey.toBase58(), signer: keys[n].isSigner, writable: keys[n].isWritable })) };
}
