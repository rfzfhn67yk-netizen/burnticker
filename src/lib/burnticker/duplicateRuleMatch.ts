import { lockRule, DEFAULT_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { selectorKeyOf } from "@/lib/burnticker/registry";
import type { ExistingCoin, TokenLike } from "@/lib/burnticker/duplicateRule";
import { coinPageHref, sharedTickers } from "@/lib/burnticker/coinKey";
import { canonicalEspnSeries } from "@/lib/burnticker/sources/espn";

/**
 * A coin that was CREATED on chain: live, paused or retired. A draft is a prepared launch that may never be signed (the owner's
 * 2026-10-13 launch: a failed first attempt left a draft that the review then counted as "already registered"), and an expired draft
 * never was, so neither counts as an existing coin.
 */
export const CREATED_STATUSES: readonly string[] = ["live", "paused", "retired"];
export const isCreatedStatus = (status: string): boolean => CREATED_STATUSES.includes(status);

/** The CREATED coins that share this rule's canonical selector (drafts and expired drafts left out). Never throws: a bad rule matches nothing. */
export function existingCoinsFor(rule: unknown, tokens: readonly TokenLike[]): ExistingCoin[] {
  let key: string, sha: string | null = null;
  try {
    const r0 = rule as BurnRule;
    // HB-188: an ESPN series is matched in its one spelling, so a window written another way still finds the live coin
    const canon = r0 && r0.oracle === "catalogue" ? canonicalEspnSeries(r0.series) : null;
    const r = canon && canon !== r0.series ? { ...r0, series: canon } : r0;
    key = selectorKeyOf(r);
    try { sha = lockRule((r as { onEnd?: unknown }).onEnd === undefined ? { ...r, onEnd: { ...DEFAULT_ON_END } } : r).sha256; } catch { sha = null; }
  } catch { return []; }
  const shared = sharedTickers(tokens);   // tickers are not unique (owner 2026-10-12): a shared ticker links by mint
  return tokens.filter((t) => t.selectorKey === key && isCreatedStatus(t.status))
    .map((t) => ({ ticker: t.ticker, name: t.name, mint: t.mint, href: coinPageHref(t, shared), sameRule: sha !== null && t.rulesSha === sha }))
    .slice(0, 12);
}
