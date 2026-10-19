import { interpretPayouts, isConditionId, POLYGON_CHAIN_ID, POLYMARKET_CTF, type ConditionResolution } from "@/lib/burnKeeper/attesters/polymarketOnchain";

/**
 * THE STORED PAYOUT VECTORS (owner 2026-10-19: "the keeper is only checking for results when it needs to"; the web's Polygon share went
 * from 190 to 600 reads in twelve minutes and was held until 00:00 UTC). A Conditional Tokens payout vector, once reported, cannot change:
 * reportPayouts cannot run twice for a condition. So the first time ANY role (the keeper or the site) reads a REPORTED vector, it is
 * written to the registry's status table under PAYOUT_STATUS_PREFIX + the condition id, with the block it was read at and the proof
 * string, and every later read of that condition, by either role, after any restart, is served from the row. An unresolved vector is
 * never stored (it can still change); the client keeps it in memory for five minutes (PolymarketClient CHAIN_UNRESOLVED_TTL_MS).
 *
 * No schema change: the status table is the registry's key-value store, and the keeper and the site open the same registry file.
 */

export const PAYOUT_STATUS_PREFIX = "polygon.payout.";

export interface StoredPayout { r: ConditionResolution; readAt: number; role: string; proof: string }

export interface PayoutStore {
  /** The stored, reported vector for a condition, or null. */
  get(conditionId: string): StoredPayout | null;
  /** Stores a REPORTED vector the first time it is read (an unresolved one, or a condition already stored, is ignored). */
  put(r: ConditionResolution, o: { readAt: number; proof: string }): void;
}

interface Row { conditionId: string; chainId: number; contract: string; rpcUrl: string; blockNumber: number | null; outcomeSlotCount: number; payoutDenominator: string; payoutNumerators: string[]; proof: string; readAt: number; role: string }

const DEC = /^\d{1,78}$/;

/** A stored row back to a resolution, re-checked (a row that does not decode to a reported vector is ignored, never trusted). */
export function rowToStored(raw: string | null, conditionId: string): StoredPayout | null {
  if (!raw) return null;
  let j: Row;
  try { j = JSON.parse(raw) as Row; } catch { return null; }
  if (!j || typeof j !== "object" || String(j.conditionId).toLowerCase() !== conditionId.toLowerCase()) return null;
  if (!DEC.test(String(j.payoutDenominator)) || !Array.isArray(j.payoutNumerators) || !j.payoutNumerators.every((n) => DEC.test(String(n)))) return null;
  if (j.payoutNumerators.length !== Number(j.outcomeSlotCount)) return null;
  let interp: ReturnType<typeof interpretPayouts>;
  try { interp = interpretPayouts(j.payoutNumerators.map((n) => BigInt(n)), BigInt(j.payoutDenominator)); } catch { return null; }
  if (!interp.resolved) return null;
  const r: ConditionResolution = {
    conditionId: conditionId.toLowerCase(), chainId: Number(j.chainId) || POLYGON_CHAIN_ID, contract: String(j.contract || POLYMARKET_CTF), rpcUrl: String(j.rpcUrl ?? ""),
    blockNumber: j.blockNumber === null || j.blockNumber === undefined ? null : Number(j.blockNumber), outcomeSlotCount: Number(j.outcomeSlotCount),
    payoutDenominator: String(j.payoutDenominator), payoutNumerators: j.payoutNumerators.map(String), ...interp,
  };
  return { r, readAt: Number(j.readAt) || 0, role: String(j.role ?? ""), proof: String(j.proof ?? "") };
}

const toRow = (r: ConditionResolution, o: { readAt: number; proof: string }, role: string): Row => ({
  conditionId: r.conditionId.toLowerCase(), chainId: r.chainId, contract: r.contract, rpcUrl: r.rpcUrl, blockNumber: r.blockNumber, outcomeSlotCount: r.outcomeSlotCount,
  payoutDenominator: r.payoutDenominator, payoutNumerators: r.payoutNumerators, proof: o.proof, readAt: o.readAt, role,
});

/** The registry's status table as the payout store (both roles open the same registry, so one role's read serves the other). */
export function statusPayoutStore(reg: { getStatus(key: string): string | null; setStatus(key: string, value: unknown, now?: number): void }, role: string): PayoutStore {
  return {
    get: (cid) => (isConditionId(cid) ? rowToStored(reg.getStatus(PAYOUT_STATUS_PREFIX + cid.toLowerCase()), cid) : null),
    put: (r, o) => {
      if (!r.resolved || !isConditionId(r.conditionId)) return;
      const key = PAYOUT_STATUS_PREFIX + r.conditionId.toLowerCase();
      if (rowToStored(reg.getStatus(key), r.conditionId)) return;   // immutable: the first reported read stands
      try { reg.setStatus(key, toRow(r, o, role), o.readAt); } catch { /* a failed write only costs a later re-read */ }
    },
  };
}

/** In memory (tests, one-off scripts). */
export function memoryPayoutStore(role = "test"): PayoutStore & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return { rows, ...statusPayoutStore({ getStatus: (k) => rows.get(k) ?? null, setStatus: (k, v) => { rows.set(k, typeof v === "string" ? v : JSON.stringify(v)); } }, role) };
}
