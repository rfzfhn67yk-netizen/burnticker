import { platform } from "@/lib/burnticker/server";
import { tier14CoinExists } from "@/lib/burnticker/feeShareLine";

/**
 * HS-26 (hourly run 5): whether a live mainnet coin created on or after the tier-14 cutover exists, read from this host's registry, so the
 * footer and the trust page can say "(every coin live today)" only while it is true. Null when the registry cannot be read (the clause is
 * then left out). Server only.
 */
export function tier14LiveNow(): boolean | null {
  try { return tier14CoinExists(platform().registry.tokens()); } catch { return null; }
}
