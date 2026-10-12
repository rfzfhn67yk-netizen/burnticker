import { lockRule, DEFAULT_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { selectorKeyOf } from "@/lib/burnticker/registry";
import type { ExistingCoin, TokenLike } from "@/lib/burnticker/duplicateRule";
import { coinPageHref, sharedTickers } from "@/lib/burnticker/coinKey";

/** The registered coins that share this rule's canonical selector (expired drafts left out). Never throws: a bad rule matches nothing. */
export function existingCoinsFor(rule: unknown, tokens: readonly TokenLike[]): ExistingCoin[] {
  let key: string, sha: string | null = null;
  try {
    const r = rule as BurnRule;
    key = selectorKeyOf(r);
    try { sha = lockRule((r as { onEnd?: unknown }).onEnd === undefined ? { ...r, onEnd: { ...DEFAULT_ON_END } } : r).sha256; } catch { sha = null; }
  } catch { return []; }
  const shared = sharedTickers(tokens);   // tickers are not unique (owner 2026-10-12): a shared ticker links by mint
  return tokens.filter((t) => t.selectorKey === key && t.status !== "expired")
    .map((t) => ({ ticker: t.ticker, name: t.name, mint: t.mint, href: coinPageHref(t, shared), sameRule: sha !== null && t.rulesSha === sha }))
    .slice(0, 12);
}
