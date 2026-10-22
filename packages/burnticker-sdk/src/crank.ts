import { ComputeBudgetProgram, PublicKey, Transaction, type Connection } from "@solana/web3.js";
import { assertClusterAllowed, DEFERRABLE_ERRORS, planCrank, type ProgramContext } from "@/lib/burnReceipts/crank";
import type { Cluster } from "@/lib/burnReceipts/constants";

/**
 * THE PERMISSIONLESS CRANK. burn_receipts processes attested readings strictly in order; ANYONE may submit the crank — the program
 * computes every amount from the rule and the fee PDA's balance, swaps on the token's own pool and burns everything bought, in one
 * instruction. The cranker chooses nothing and earns nothing: it pays the transaction fee (and, the first time, the rent of the fee
 * PDA's two token accounts). Running a crank bot just keeps burns timely if the operator's keeper is slow or gone.
 *
 * This builds the transaction for the next reading in line and returns it UNSIGNED; your cranker key signs and sends it. Guard
 * refusals (TWAP deviation, pool not tradable) are "not now, retry later": see DEFERRABLE_ERRORS.
 */

export interface CrankContext { connection: Connection; programId: PublicKey | string; cluster: Cluster; allowMainnet?: boolean; computeUnits?: number }

export type CrankPlan =
  | { status: "ready"; kind: "no_units" | "vault" | "buyback" | "forward" | "target"; recordDate: number; transaction: Transaction; feePayer: string; note: string }
  | { status: "idle"; cursor: number; note: string }
  | { status: "waiting-for-pool"; recordDate: number; note: string };

export { DEFERRABLE_ERRORS };

/** The crank transaction for the next reading of `mint`, unsigned, fee payer = `cranker`. Mainnet refused unless allowMainnet (genesis-checked). */
export async function crank(mint: PublicKey | string, cranker: PublicKey | string, c: CrankContext): Promise<CrankPlan> {
  const ctx: ProgramContext = { connection: c.connection, programId: new PublicKey(c.programId), mint: new PublicKey(mint), cluster: c.cluster, allowMainnet: c.allowMainnet, computeUnits: c.computeUnits };
  await assertClusterAllowed(ctx);
  const payer = new PublicKey(cranker);
  const plan = await planCrank(ctx, payer);
  if ("status" in plan) {
    if (plan.status === "idle") return { status: "idle", cursor: plan.cursor, note: "nothing to crank: every attested reading is processed" };
    return { status: "waiting-for-pool", recordDate: plan.recordDate, note: "buyback reading pending, but the graduated CPMM pool is not registered yet (anyone can call register_pool once LaunchLab migrates)" };
  }
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: c.computeUnits ?? 400_000 }));
  for (const ix of plan.instructions) tx.add(ix);
  const { blockhash, lastValidBlockHeight } = await c.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash; tx.lastValidBlockHeight = lastValidBlockHeight; tx.feePayer = payer;
  return { status: "ready", kind: plan.kind, recordDate: plan.recordDate, transaction: tx, feePayer: payer.toBase58(), note: `crank_${plan.kind} for reading ${plan.recordDate}: sign with the cranker key, simulate, send; a ${[...DEFERRABLE_ERRORS].join("/")} refusal means retry later` };
}
