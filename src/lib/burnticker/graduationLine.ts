/**
 * WHAT GRADUATION COUNTS (campaign readiness 2026-10-19, item 4). The line under a coin's graduation bar: the raise is net swapping into
 * the coin on its curve, and a seed in the burn pool is not part of it. The raise is the coin's own (its curve read or its config), the
 * seed is the disclosed seed deposit (config/burnticker/current-status.json deficit.launch.seedSol, or the keeper's status.json
 * buyback.funding.seedSol); neither is typed here. The $DEFICIT site carries the same sentence in its script (site/deficit/index.html,
 * pinned equal by test/burntickerMarketingPrep.test.ts). Client-safe.
 */
const amount = (x: string | number | null | undefined): string | null => {
  if (x === null || x === undefined || String(x).trim() === "") return null;
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? String(Number(n.toFixed(4))) : null;
};

/** The sentence, or null when the raise was not read (never a typed figure). */
export function graduationExplainer(threshold: string | number | null | undefined, quote: string | null | undefined = "SOL", seed: string | number | null | undefined = null): string | null {
  const t = amount(threshold);
  if (!t) return null;
  const q = quote || "SOL";
  const s = amount(seed);
  return s
    ? `Graduation needs ${t} ${q} of net swapping into the coin on its curve. Swaps in count, swaps out subtract, and the ${s} ${q} seed in the burn pool does not count.`
    : `Graduation needs ${t} ${q} of net swapping into the coin on its curve. Swaps in count, and swaps out subtract. A gift to the burn pool does not count.`;
}
