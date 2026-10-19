import type { TickerCheck } from "@/lib/burnticker/tickerCheck";

// Client-safe (no node imports): the launch page reads it. tickerCheck.ts itself reads the reserved list from disk.

/** HB-30: the side's check refuses its ticker (held, reserved or a lookalike of another coin's). */
export const tickerRefused = (t: Pick<TickerCheck, "taken" | "reserved" | "lookalike">): boolean => t.taken || t.reserved || !!t.lookalike;

/**
 * HB-30 (continuous audit run 3): the wizard never leaves a GENERATED ticker on screen that its own check refuses. For every side whose
 * shown ticker is still the generated one (`auto`) and is refused, the first free ticker the check offers (the server's own suggestion
 * from the rule, else the next free variant). A side the creator typed is left alone: its refusal and free tickers are shown instead.
 */
export function autoTickerSwaps(checks: readonly TickerCheck[] | null | undefined, shown: { a: string; b: string }, auto: boolean): { a?: string; b?: string } {
  const out: { a?: string; b?: string } = {};
  if (!auto) return out;
  for (const t of checks ?? []) {
    const key = t.side === "A" ? "a" : "b", now = shown[key].toUpperCase();
    if (now && t.ticker === now && tickerRefused(t) && t.suggestions[0] && t.suggestions[0] !== now) out[key] = t.suggestions[0];
  }
  return out;
}

/** HB-30: the lead of a field's free-ticker row; on a two-coin draft it names the field, so each row belongs to one coin. */
export const freeRowLead = (side: "A" | "B", ticker: string, many: boolean): string =>
  many ? `Free tickers for Coin ${side} in place of $${ticker.toUpperCase()}:` : "Free tickers:";
