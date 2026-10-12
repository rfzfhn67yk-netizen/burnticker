/**
 * THE LAUNCH COST ESTIMATE'S PARTS (moved out of launchReview.ts by website-14 so the launch page's first screen can quote the same
 * number without a server read). Client-safe: no file reads. launchReview.ts re-exports every name, and its cost lines add up to
 * launchLabCostLamports for a LaunchLab coin.
 */
/** Rent-exempt minimum for an account of `bytes` (Solana: (bytes + 128) × 3,480 lamports/byte-year × 2 years). */
export const rentLamports = (bytes: number): number => (bytes + 128) * 3480 * 2;
/** Byte sizes the launch creates per coin (programs/burn-receipts TokenConfig, measured 2026-10-10; REHEARSAL-RUNSHEET §0.1). */
export const TOKEN_CONFIG_BYTES = 863;
/** LaunchLab create's account rent (pool state, two vaults, metadata), measured on the 2026-10-10 rehearsal (REHEARSAL-RUNSHEET §0.1). */
export const LAUNCHLAB_CREATE_RENT_SOL = 0.03;
export const LAMPORTS_PER_SIGNATURE = 5000;
/** "0.0581" from lamports (six places under 0.001 SOL). */
export const solText = (lamports: number): string => (lamports / 1e9).toFixed(lamports < 1_000_000 ? 6 : 4).replace(/0+$/, "").replace(/\.$/, "");
/** One LaunchLab coin's estimate: the rule account's rent, the reserve moved into its burn pool, LaunchLab's create rent, two signatures. */
export function launchLabCostLamports(reserveSol: string, coins = 1): number {
  return (rentLamports(TOKEN_CONFIG_BYTES) + Math.round(Number(reserveSol) * 1e9) + Math.round(LAUNCHLAB_CREATE_RENT_SOL * 1e9) + 2 * LAMPORTS_PER_SIGNATURE) * coins;
}
/** The same in SOL; the default reserve is the web launcher's 0.02 SOL (launchDraft.ts). */
export const launchLabCostSol = (reserveSol = "0.02"): string => solText(launchLabCostLamports(reserveSol));
