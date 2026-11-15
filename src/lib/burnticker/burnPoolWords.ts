/**
 * LD6-3 / HS-24 (sixth pass): THE BURN POOL ROW SAYS WHAT IS SPENDABLE. The token page read "Burn pool 0.02 SOL — 0.02 SOL of it is
 * kept back for fees", which reads as a contradiction when the whole balance is the fee reserve. The note now names the spendable
 * amount, says plainly when nothing is spendable yet, and, when the coin's LaunchLab creator-fee vault holds trading fees not yet claimed
 * into the pool, says how much is waiting. Pure and client-safe; amounts are decimal SOL strings as the status JSON carries them.
 */
export interface BurnPoolInput { feePdaSol: string | null; spendableSol: string | null; reserveSol: string; /** fees in the creator-fee vault not yet claimed (null or absent: not read) */ unclaimedSol?: string | null }

const num = (s: string | null | undefined): number | null => { if (s === null || s === undefined || s.trim() === "") return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
/** "0.23": two decimals, or up to four for an amount under 0.01, never "0.00" for a positive amount. */
export const solShort = (n: number): string => (n > 0 && n < 0.01 ? String(Number(n.toFixed(4))) : n.toFixed(2).replace(/\.?0+$/, "") || "0");

export function burnPoolNote(p: BurnPoolInput): string {
  const pool = num(p.feePdaSol), reserve = num(p.reserveSol) ?? 0;
  const spendable = num(p.spendableSol) ?? (pool === null ? null : Math.max(0, pool - reserve));
  const unclaimed = num(p.unclaimedSol);
  const waiting = unclaimed !== null && unclaimed > 0 ? ` ${solShort(unclaimed)} SOL of trading fees is waiting to be claimed into the burn pool.` : "";
  if (pool === null) return `SOL set aside for this coin's burns. ${solShort(reserve)} SOL of it stays as the fee reserve.${waiting}`;
  if (spendable === null || spendable <= 0) return `SOL set aside for this coin's burns, all of it the fee reserve. Nothing is spendable until trading fees arrive.${waiting}`;
  return `SOL set aside for this coin's burns. ${solShort(spendable)} SOL is spendable on burns, and ${solShort(reserve)} SOL stays as the fee reserve.${waiting}`;
}
