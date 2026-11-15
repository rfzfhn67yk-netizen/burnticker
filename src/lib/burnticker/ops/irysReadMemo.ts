/**
 * HB-114 (hourly audit, publish 100): the Irys balance and price reads shared between the keeper's top-up step (ops/topUp.ts) and the
 * HB-82 balance alert (ops/snapshot.ts checkUploadBalance), so the two never read the same thing twice inside the hourly window.
 *
 * In memory only (one keeper process, one upload payer). Each entry says who read it: the top-up step adopts only the alert's reads
 * (its own reads live in its per-client memo in topUp.ts), and the alert adopts only the top-up step's reads. A top-up that funds Irys
 * drops the entry for that payer, so neither reader reuses a balance from before the funding.
 */
export const IRYS_READ_TTL_MS = 3_600_000;
export type IrysReader = "top-up" | "balance-alert";
export interface SharedIrysRead { address: string; balanceLamports: bigint; at: number; by: IrysReader; snapshotPrice: { lamports: bigint; bytes: number; at: number } | null }
const reads = new Map<string, SharedIrysRead>();

export function publishIrysRead(r: SharedIrysRead): void { if (r.address) reads.set(r.address, r); }
/** The freshest read by the OTHER reader, inside the hourly window (for `address`, or any payer when the caller does not know it yet). */
export function freshIrysRead(o: { now: number; notBy: IrysReader; address?: string | null }): SharedIrysRead | null {
  let best: SharedIrysRead | null = null;
  for (const r of reads.values()) {
    if (r.by === o.notBy || (o.address && r.address !== o.address)) continue;
    if (o.now - r.at < 0 || o.now - r.at >= IRYS_READ_TTL_MS) continue;
    if (!best || r.at > best.at) best = r;
  }
  return best;
}
export function dropIrysRead(address: string): void { reads.delete(address); }
/** For tests. */
export function resetIrysReads(): void { reads.clear(); }
