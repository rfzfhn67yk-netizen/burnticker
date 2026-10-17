import type { BurnRule } from "@/lib/burnticker/rules";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import { isReserved, tickerSuggestions } from "@/lib/burnticker/reservedNames";

/**
 * THE TICKER CHECK AT REVIEW (owner, 2026-10-12: tickers are not enforced unique; walkthrough snag 9). For every side of a draft, the
 * coins that already hold its ticker (the registry's live and draft coins), each with a link by mint and its one-line rule, and two free
 * tickers to switch to. Holding a ticker another coin uses is a WARNING the creator may keep; a reserved name is a refusal
 * (reservedNames.ts). The review route runs it on every keystroke's review request, so the field is checked as the creator types.
 */
export interface InUseCoin { mint: string; name: string; ticker: string; href: string; rule: string }
export interface TickerCheck { side: "A" | "B"; ticker: string; inUse: InUseCoin[]; reserved: boolean; suggestions: string[]; warning: string | null }
export interface TickerRow { mint: string; name: string; ticker: string; rulesJson: string }

const oneLine = (rulesJson: string): string => { try { return ruleOneLiner(JSON.parse(rulesJson) as BurnRule); } catch { return "its rule could not be read"; } };

/** The warning line for a ticker held by other coins ("$LAD is in use by Dodgers Season: burns when the Dodgers win."). */
export function inUseWarning(ticker: string, coins: readonly InUseCoin[]): string | null {
  if (!coins.length) return null;
  const first = coins[0], more = coins.length > 1 ? ` It is also used by ${coins.length - 1} other coin${coins.length === 2 ? "" : "s"}.` : "";
  return `$${ticker} is in use by ${first.name}: ${first.rule.replace(/\.$/, "")}.${more} You can keep it, or pick a free one.`;
}

/**
 * sources-7 (QA walkthrough 11 H9): the suggestions come from the rule. A reserved ticker gets the rule's own generated ticker (`generated`,
 * the review's coins[].suggestedTicker) when it is free, else that ticker's free variants, and nothing when there is no rule ticker; never
 * the reserved name plus a digit. A ticker that is only in use keeps its own free variants.
 */
export function tickerChecks(sides: readonly { side: "A" | "B"; ticker: string; generated?: string | null }[], deps: { inUse: (ticker: string) => readonly TickerRow[]; reserved: ReadonlySet<string> }): TickerCheck[] {
  const own = new Set(sides.map((s) => s.ticker.toUpperCase()));
  const free = (t: string) => !own.has(t) && !isReserved(t, deps.reserved) && deps.inUse(t).length === 0;
  const fromRule = (g: string | null | undefined): string[] => {
    const t = (g ?? "").toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(t) || isReserved(t, deps.reserved)) return [];
    return free(t) ? [t, ...tickerSuggestions(t, free, 1)] : tickerSuggestions(t, free);
  };
  return sides.filter((s) => /^[A-Z0-9]{2,10}$/.test(s.ticker.toUpperCase())).map((s) => {
    const ticker = s.ticker.toUpperCase();
    const inUse = deps.inUse(ticker).map((t) => ({ mint: t.mint, name: t.name, ticker: t.ticker, href: `/burnticker/t/${t.mint}`, rule: oneLine(t.rulesJson) }));
    const reserved = isReserved(ticker, deps.reserved);
    return { side: s.side, ticker, inUse, reserved, suggestions: reserved ? fromRule(s.generated) : inUse.length ? tickerSuggestions(ticker, free) : [], warning: inUseWarning(ticker, inUse) };
  });
}
