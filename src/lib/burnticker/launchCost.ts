/**
 * THE LAUNCH COST ESTIMATE'S PARTS (moved out of launchReview.ts by website-14 so the launch page's first screen can quote the same
 * number without a server read). Client-safe: no file reads. launchReview.ts re-exports every name, and its cost lines add up to
 * launchLabCostLamports for a LaunchLab coin.
 */
/** Rent-exempt minimum for an account of `bytes` (Solana: (bytes + 128) × 3,480 lamports/byte-year × 2 years). */
export const rentLamports = (bytes: number): number => (bytes + 128) * 3480 * 2;
/** Byte sizes the launch creates per coin (programs/burn-receipts TokenConfig, measured 2026-10-10; REHEARSAL-RUNSHEET §0.1). */
export const TOKEN_CONFIG_BYTES = 863;
/**
 * The EndSink account initialize_token makes when a rule names an end sink (programs/burn-receipts state.rs EndSink, created with
 * 8 + EndSink::INIT_SPACE in instructions/end.rs): discriminator 8, version 1, bump 1, mint 32, sink_kind 1, sink_mint 32,
 * min_forward_lamports 8, created_at 8, reserved 32.
 */
export const END_SINK_ACCOUNT_BYTES = 8 + 1 + 1 + 32 + 1 + 32 + 8 + 8 + 32;
/**
 * HS-6 (continuous audit 2026-10-19): the PairLink account each coin of a two-coin pair gets (programs/burn-receipts state.rs PairLink,
 * created with 8 + PairLink::INIT_SPACE by instructions/pair.rs new_link, from initialize_token on LaunchLab or link_pair on the pair
 * curve): discriminator 8, version 1, bump 1, mint 32, pair_mint 32, paired 1, witness 1, created_at 8, pairing_deadline 8, paired_at 8,
 * attester_set_hash 32. A pair makes two, one per coin.
 */
export const PAIR_LINK_ACCOUNT_BYTES = 8 + 1 + 1 + 32 + 32 + 1 + 1 + 8 + 8 + 8 + 32;
/** The rent line for a pair's two PairLink accounts, in the review's cost list. */
export const PAIR_LINK_RENT_LABEL = `Rent for the two accounts that link the coins to each other, ${PAIR_LINK_ACCOUNT_BYTES} bytes each. It stays with the coins.`;
/** LaunchLab create's account rent (pool state, two vaults, metadata), measured on the 2026-10-10 rehearsal (REHEARSAL-RUNSHEET §0.1). */
export const LAUNCHLAB_CREATE_RENT_SOL = 0.03;
export const LAMPORTS_PER_SIGNATURE = 5000;
/**
 * EXACT LAMPORT TEXT (website-20 item 167, 2026-10-12): integer lamports to SOL with `places` decimals, rounded half up in integer
 * arithmetic. The old float path ((l / 1e9).toFixed) could round a .5 boundary down (1,234,550,000 lamports showed 1.2345), so a shown
 * figure could disagree with the amount prepared.
 */
export function lamportsText(lamports: number | bigint, places: number): string {
  const l = BigInt(lamports), neg = l < BigInt(0), a = neg ? -l : l;
  const scale = BigInt(10) ** BigInt(9 - places);
  const r = (a + scale / BigInt(2)) / scale;   // half up, in units of 10^-places SOL
  const s = r.toString().padStart(places + 1, "0");
  const out = `${s.slice(0, s.length - places)}.${s.slice(s.length - places)}`.replace(/0+$/, "").replace(/\.$/, "");
  return neg && out !== "0" ? `-${out}` : out;
}
/** "0.0581" from lamports (six places under 0.001 SOL), exact. */
export const solText = (lamports: number): string => lamportsText(lamports, Math.abs(lamports) < 1_000_000 ? 6 : 4);
/** A rule's SOL string ("0.02", up to 9 decimals) as lamports, exactly (the same value program.ts counterRule prepares). */
export function decimalSolToLamports(sol: string): number {
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(sol.trim());
  if (!m) throw new Error(`not a SOL amount: ${sol}`);
  return Number(BigInt(m[1]) * BigInt(1_000_000_000) + BigInt((m[2] ?? "").padEnd(9, "0") || "0"));
}
/** Each LaunchLab coin is two transactions (its rule locked, then the coin created; launchBundle.ts launchTransactions, 2026-10-15). */
export const LAUNCHLAB_STEPS_PER_COIN = 2;
/**
 * One LaunchLab coin's estimate: the rule account's rent, the reserve moved into its burn pool, LaunchLab's create rent, and two
 * signatures (the wallet and the coin's new key) on each of its two transactions.
 */
export function launchLabCostLamports(reserveSol: string, coins = 1): number {
  return (rentLamports(TOKEN_CONFIG_BYTES) + decimalSolToLamports(reserveSol) + Math.round(LAUNCHLAB_CREATE_RENT_SOL * 1e9) + LAUNCHLAB_STEPS_PER_COIN * 2 * LAMPORTS_PER_SIGNATURE) * coins;
}
/** The same in SOL; the default reserve is the web launcher's 0.02 SOL (launchDraft.ts). */
export const launchLabCostSol = (reserveSol = "0.02"): string => solText(launchLabCostLamports(reserveSol));
