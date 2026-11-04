import type { Registry } from "@/lib/burnticker/registry";
import type { BurnProgramClient } from "@/lib/burnticker/program";
import { buildLpLockJson, feeKeysPda, operatorTreasuryFor, solscanUrl, type LpLockJson } from "@/lib/burnticker/lockFees";
import { lastLockError } from "@/lib/burnticker/lockFeesKeeper";

/**
 * One coin's `lp` block for status.json, /v1 and the coin page (LP locked forever, 2026-10-10): the lock as read now through the
 * program client's claim_lock_fees port (best-effort: a read failure or a client without the port shows the policy without the Fee
 * Key) plus every claim the keeper recorded (registry.lock_fee_claims). Addresses link to Solscan.
 */
export async function lpLockBlock(reg: Pick<Registry, "lockFeeClaims" | "getStatus">, program: Pick<BurnProgramClient, "programId" | "lockFees">, cluster: string, mint: string): Promise<LpLockJson> {
  const client = program.lockFees;
  let state = null;
  if (client) { try { state = await client.port(mint).state({ accrued: false }); } catch { state = null; } }
  let keys: string | null = null;
  try { keys = client?.feeKeysPda() ?? feeKeysPda(program.programId).toBase58(); } catch { keys = null; }
  return buildLpLockJson({ cluster, mint, programId: program.programId, state, feeKeysPda: keys, operatorTreasury: client ? client.operatorTreasury() : operatorTreasuryFor(cluster), claims: reg.lockFeeClaims(mint), explorer: (id, kind) => solscanUrl(cluster, id, kind), lastError: lastLockError(reg, mint) });
}
