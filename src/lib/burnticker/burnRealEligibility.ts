import type { BurnRule } from "@/lib/burnticker/rules";
import type { DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { isHazardSeries } from "@/lib/burnticker/hazards";
import { parseEspnSeries } from "@/lib/burnticker/sources/espn";

/**
 * WHICH COINS MAY BURN ANOTHER TOKEN (HB-12 + PROD-01, 2026-10-19; the owner saw a token choice on an earthquake coin and does not want
 * it there). One contract, read by the launch page (the picker and the "not offered yet" line), by the read-only review and by the
 * bundle route, so the API refuses what the page never offers.
 *
 * OWNER DECISION 2026-10-19 (follow-up): WIF and BONK were only an example, never a menu.
 *   coin comparison  a Coin vs Coin coin (derby selector "coinvs") may burn the coin it is measured against, whatever two coins the
 *                    creator pits against each other: side A the first coin, side B the second. Any other token is refused.
 *   every other family (published data, natural disasters, teams, event outcomes, other pairs and outcome sets, vault coins, the other
 *                    derby shapes): NO other-token burn.
 * Team and candidate rivalries keep burning each other through the pair itself (winner takes the burn, the pair-winner end); that path
 * names no token to burn, so nothing here touches it.
 *
 * The site-wide flag (launchAvailability.ts BURNTICKER_BURN_REAL_ENABLED) is a separate gate on top: with it off nothing is offered
 * anywhere. Pure and client-safe.
 */
export type RealBurnFamily = "published-data" | "coin-comparison" | "natural-disaster" | "team" | "event-outcome" | "pair" | "vault" | "other-derby";

type RuleLike = Pick<BurnRule, "oracle" | "series" | "kind" | "vault" | "pair"> & { set?: unknown; derby?: BurnRule["derby"] };

export function realBurnFamily(rule: RuleLike): RealBurnFamily {
  if (rule.vault) return "vault";
  if (rule.oracle === "derby") return rule.derby?.selector === "coinvs" ? "coin-comparison" : "other-derby";
  if (rule.oracle === "catalogue" && isHazardSeries(rule.series)) return "natural-disaster";
  if (rule.oracle === "catalogue" && rule.series && parseEspnSeries(rule.series)) return "team";
  if (rule.oracle !== "catalogue" || rule.kind !== "scalar") return "event-outcome";
  if (rule.pair || rule.set) return "pair";
  return "published-data";
}

/** Whether a coin of this rule's family may burn another token at all (the flag aside): a Coin comparison coin only. */
export const realBurnAllowed = (rule: RuleLike | null | undefined): boolean => !!rule && realBurnFamily(rule) === "coin-comparison";

/**
 * The mint a Coin comparison side may burn: its own pitted coin (side A the spec's first coin, side B the second), by that coin's own
 * Solana mint only (burnReal.ts realPickFor offers the same one). Empty for any other rule or a coin with no Solana mint.
 */
export function ownReferenceMints(rule: RuleLike | null | undefined, side: "A" | "B"): { symbol: string; mints: string[] } | null {
  const d = rule && realBurnFamily(rule) === "coin-comparison" ? rule.derby : null;
  if (!d || d.selector !== "coinvs") return null;
  const u: DerbyUnderlying = side === "A" ? d.a : d.b;
  // PROD-04 (2026-10-19): exactly the selected coin's own mint; a symbol never brings in another mint
  return { symbol: u.symbol.toUpperCase(), mints: u.mint ? [u.mint] : [] };
}

/** The sentence the review and the bundle route answer with when a rule of another family names a token to burn. */
export const REAL_BURN_FAMILY_REFUSAL = "Only a Coin comparison coin can burn another token, and only the coin it is measured against. This coin burns its own token, so remove the token it names.";
export const REAL_BURN_FAMILY_CODE = "burn-real-family";
/** A Coin comparison side that names a token other than its own pitted coin. */
export const realBurnNotOwnCoin = (symbol: string): string => `A Coin comparison coin can burn only the coin it is measured against, which is ${symbol} for this coin. Remove the other token, or name ${symbol} instead.`;
/** The line a resumed draft shows when its saved token to burn was dropped because this kind of coin cannot have one. */
export const REAL_BURN_DROPPED_NOTICE = "Your saved draft named another token to burn. Coins of this kind burn their own token, so that choice was removed.";

/**
 * Why a rule that names a token to burn is refused, or null (nothing named, or a Coin comparison side naming its own pitted coin).
 * `side` is the coin's side of the pair (side A's rule is passed for side B of a linked pair, which is built from it).
 */
export function realBurnFamilyProblem(rule: RuleLike | null | undefined, pinned: unknown, side: "A" | "B" = rule?.pair?.side ?? "A"): string | null {
  if (!pinned || !rule) return null;
  if (!realBurnAllowed(rule)) return REAL_BURN_FAMILY_REFUSAL;
  const own = ownReferenceMints(rule, side);
  const mint = typeof pinned === "object" ? (pinned as { mint?: unknown }).mint : null;
  if (!own || !own.mints.length) return REAL_BURN_FAMILY_REFUSAL;
  return typeof mint === "string" && own.mints.includes(mint) ? null : realBurnNotOwnCoin(own.symbol);
}

/**
 * A saved draft (the page's sessionStorage snapshot) whose stored rules name a token to burn on a family that may not have one: the
 * token is dropped from each stored rule and the notice says so once. Anything else is returned as it was.
 */
export function dropIneligibleBurnTarget<T extends Record<string, unknown>>(saved: T): { draft: T; notice: string | null } {
  const d = saved.draft as { key?: unknown; a?: unknown; b?: unknown } | null | undefined;
  if (!d || typeof d !== "object") return { draft: saved, notice: null };
  let dropped = false;
  const fix = (r: unknown, side: "A" | "B"): unknown => {
    if (!r || typeof r !== "object" || !("burnTarget" in r)) return r;
    const rule = r as RuleLike & { burnTarget?: unknown };
    if (rule.burnTarget == null || realBurnFamilyProblem(rule, rule.burnTarget, side) === null) return r;
    dropped = true;
    const { burnTarget: _gone, ...rest } = rule;
    void _gone;
    return rest;
  };
  const a = fix(d.a, "A"), b = fix(d.b, "B");
  return dropped ? { draft: { ...saved, draft: { ...d, a, b } }, notice: REAL_BURN_DROPPED_NOTICE } : { draft: saved, notice: null };
}
