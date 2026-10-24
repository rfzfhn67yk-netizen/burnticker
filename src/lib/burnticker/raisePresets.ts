/**
 * THE GRADUATION PRESET (website-14, LAUNCHPAD-PATH §75; owner decision 2026-10-12). A creator picks how much SOL the curve raises before
 * the coin graduates to its Raydium pool: 10, 40, 60 or 85 SOL (10 added by owner decision 2026-10-24 so a coin can reach its first burn
 * without a large raise; Raydium's own program accepted a 1 SOL raise on devnet, evidence docs/burnkeeper/evidence/devnet-2026-10-10), default 85 (LaunchLab's standard). Presets, not a dial (§36): the server
 * refuses any other value on mainnet (handlers.ts), and the bundle passes the chosen raise to LaunchLab (launchBundle.ts). The raise
 * changes how much buying comes before the first burn and how deep the pool is afterwards. It changes nothing in the rule, its hash or
 * the LP lock, and one burn run is capped at 2% of the pool's SOL either way. Client-safe.
 */
export const RAISE_PRESETS_SOL = ["10", "40", "60", "85"] as const;
export type RaisePreset = (typeof RAISE_PRESETS_SOL)[number];
export const DEFAULT_RAISE_SOL: RaisePreset = "85";
export const isRaisePreset = (v: unknown): v is RaisePreset => typeof v === "string" && (RAISE_PRESETS_SOL as readonly string[]).includes(v);
/** The raise in lamports (what LaunchLab's totalFundRaisingB takes). */
export const raiseLamports = (sol: RaisePreset): bigint => BigInt(sol) * BigInt(1_000_000_000);
/** One plain sentence per choice, for the review step. No price talk, no promise. */
export const RAISE_PRESET_TEXT: Record<RaisePreset, string> = {
  "10": "About 10 SOL of net trading on the curve comes before the first burn, so a small group of buyers can get a coin to its first burn. The pool afterwards starts with roughly 10 SOL, the shallowest of the four: each trade moves it a lot further, and one burn run is small.",
  "40": "About 40 SOL of net trading on the curve comes before the first burn. The pool afterwards starts with roughly 40 SOL, about half as deep as at 85 SOL, so each trade moves it further.",
  "60": "About 60 SOL of net trading on the curve comes before the first burn. The pool afterwards starts with roughly 60 SOL, between 40 and 85 in depth.",
  "85": "About 85 SOL of net trading on the curve comes before the first burn. This is LaunchLab's standard raise, and the pool afterwards starts with roughly 85 SOL, the deepest of the four.",
};
/** The sentence every choice shares. */
export const RAISE_PRESET_SHARED = "Whichever raise you choose, one burn run spends at most 2% of the pool's SOL, and the rule, its hash and the locked liquidity are the same.";
