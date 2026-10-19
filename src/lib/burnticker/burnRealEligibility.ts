import type { BurnRule } from "@/lib/burnticker/rules";
import { isHazardSeries } from "@/lib/burnticker/hazards";
import { parseEspnSeries } from "@/lib/burnticker/sources/espn";

/**
 * WHICH COINS MAY BURN A REAL TOKEN (HB-12 + PROD-01, 2026-10-19; the owner saw a WIF or BONK choice on an earthquake coin and does not
 * want it there). One contract, read by the launch page (the picker and the "not offered yet" line), by the read-only review and by the
 * bundle route, so the API refuses what the page never offers.
 *
 *   published data   a catalogue scalar feed that is not a natural disaster or a team (the debt, inflation, weather and the like): YES
 *   coin comparison  a derby coin (Coin vs Coin), each side burning its own reference coin (website-24, the owner on 2026-10-13: "make
 *                    the actual wif and bonk coins burn"): YES
 *   natural disaster earthquakes, hurricanes, tornadoes, wildfires, volcanoes: NO
 *   team             any ESPN team, game or rivalry series: NO
 *   event outcome    a market (Kalshi, Polymarket and the other venues) or any yes/no rule: NO
 *   other pairs      a linked pair or an outcome set that is not Coin vs Coin: NO
 *   vault mode       NO (the program's burn target is buyback only)
 *
 * The site-wide flag (launchAvailability.ts BURNTICKER_BURN_REAL_ENABLED) is a separate gate on top: with it off nothing is offered
 * anywhere, whatever the family. Pure and client-safe.
 */
export type RealBurnFamily = "published-data" | "coin-comparison" | "natural-disaster" | "team" | "event-outcome" | "pair" | "vault";

type RuleLike = Pick<BurnRule, "oracle" | "series" | "kind" | "vault" | "pair"> & { set?: unknown };

export function realBurnFamily(rule: RuleLike): RealBurnFamily {
  if (rule.vault) return "vault";
  if (rule.oracle === "derby") return "coin-comparison";
  if (rule.oracle === "catalogue" && isHazardSeries(rule.series)) return "natural-disaster";
  if (rule.oracle === "catalogue" && rule.series && parseEspnSeries(rule.series)) return "team";
  if (rule.oracle !== "catalogue" || rule.kind !== "scalar") return "event-outcome";
  if (rule.pair || rule.set) return "pair";
  return "published-data";
}

/** Whether a coin of this rule's family may burn a real token instead of itself (the flag aside). */
export const realBurnAllowed = (rule: RuleLike | null | undefined): boolean => {
  if (!rule) return false;
  const f = realBurnFamily(rule);
  return f === "published-data" || f === "coin-comparison";
};

/** The sentence the review and the bundle route answer with when a rule of another family names a token to burn. */
export const REAL_BURN_FAMILY_REFUSAL = "Only a coin on published data, or a Coin comparison coin burning its own reference coin, can burn another token. This coin burns its own token, so remove the token it names.";
export const REAL_BURN_FAMILY_CODE = "burn-real-family";
/** The line a resumed draft shows when its saved token to burn was dropped because this kind of coin cannot have one. */
export const REAL_BURN_DROPPED_NOTICE = "Your saved draft named another token to burn. Coins of this kind burn their own token, so that choice was removed.";

/** Why a rule that names a token to burn is refused for its family, or null (no token named, or a family that may have one). */
export function realBurnFamilyProblem(rule: RuleLike | null | undefined, pinned: unknown): string | null {
  if (!pinned || !rule) return null;
  return realBurnAllowed(rule) ? null : REAL_BURN_FAMILY_REFUSAL;
}

/**
 * A saved draft (the page's sessionStorage snapshot) whose stored rules name a token to burn on a family that may not have one: the
 * token is dropped from each stored rule and the notice says so once. Anything else is returned as it was.
 */
export function dropIneligibleBurnTarget<T extends Record<string, unknown>>(saved: T): { draft: T; notice: string | null } {
  const d = saved.draft as { key?: unknown; a?: unknown; b?: unknown } | null | undefined;
  if (!d || typeof d !== "object") return { draft: saved, notice: null };
  let dropped = false;
  const fix = (r: unknown): unknown => {
    if (!r || typeof r !== "object" || !("burnTarget" in r)) return r;
    const rule = r as RuleLike & { burnTarget?: unknown };
    if (rule.burnTarget == null || realBurnAllowed(rule)) return r;
    dropped = true;
    const { burnTarget: _gone, ...rest } = rule;
    void _gone;
    return rest;
  };
  const a = fix(d.a), b = fix(d.b);
  return dropped ? { draft: { ...saved, draft: { ...d, a, b } }, notice: REAL_BURN_DROPPED_NOTICE } : { draft: saved, notice: null };
}
