import type { BurnRule } from "@/lib/burnticker/rules";
import { fitName, NAME_MAX_BYTES, SYMBOL_MAX_BYTES, utf8Bytes } from "@/lib/burnticker/launchFields";

/**
 * A SOURCE'S SUGGESTED NAME FOLLOWS THE SIDE THE COIN BURNS ON (continuous audit 2026-10-19T1919Z PROD-02). An event outcome picked from
 * search ("Dems sweep") lends the launch page its name and ticker. The suggestion is made for the side its rule had when it was picked;
 * when the creator flips the coin to the other side ("If it resolves NO") and has not typed a name, the default name and ticker must say
 * so, the way describe.ts names a NO coin ("<name> No", ticker "NO<ticker>"). Flipping back gives the original suggestion again. A name
 * or ticker the creator typed is never touched here (the page applies this only while its name or ticker is automatic). Client-safe, pure;
 * test/burntickerLaunchNamePolarity.test.ts.
 */
export type BurnSide = "yes" | "no";
export interface SourceSuggestion { name: string | null; ticker: string | null; /** the side of the rule the suggestion was made for */ side?: BurnSide | null }

/** The side a yes/no rule burns on; null for a rule that is not a yes/no market (its suggestion has no side to follow). */
export function ruleSide(r: Pick<BurnRule, "kind" | "binary"> | null | undefined): BurnSide | null {
  if (!r || r.kind !== "binary" || !r.binary) return null;
  return r.binary.onNo && !r.binary.onYes ? "no" : "yes";
}

/**
 * The suggestion for the side the coin burns on now. The same side (or no side known): the suggestion as made. A YES suggestion on a NO
 * coin: "<name> No" and "NO<ticker>" (describe.ts's NO form, so the name and the ticker say the same thing; the marker is reserved before the fit, noName). A NO suggestion on a YES
 * coin: nothing, so the page falls back to the rule's own generated name and ticker, which follow the side already.
 */
export function suggestionFor(s: SourceSuggestion, side: BurnSide | null): { name: string | null; ticker: string | null } {
  if (!s.side || !side || s.side === side) return { name: s.name, ticker: s.ticker };
  if (s.side === "yes") return { name: s.name ? noName(s.name) : null, ticker: s.ticker ? `NO${s.ticker}`.slice(0, SYMBOL_MAX_BYTES) : null };
  return { name: null, ticker: null };
}

/** The NO side's marker, appended after the fitted base name. */
export const NO_MARKER = " No";
/**
 * PROD-02 v2 (continuous audit 2026-10-19T1949Z): the base name is fitted to the limit LESS the marker's bytes, then the marker is added,
 * so a long name ("Democrats win the Ohio election", 31 bytes) is shortened at a word boundary and never loses its "No" to the fit.
 */
export function noName(base: string, max = NAME_MAX_BYTES): string {
  return `${fitName(base, max - utf8Bytes(NO_MARKER))}${NO_MARKER}`;
}

/** A saved draft's suggestion, read back defensively (an older draft has none). */
export function suggestionFromDraft(v: unknown): SourceSuggestion {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { name: typeof o.name === "string" ? o.name : null, ticker: typeof o.ticker === "string" ? o.ticker : null, side: o.side === "yes" || o.side === "no" ? o.side : null };
}
