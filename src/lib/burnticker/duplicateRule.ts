/**
 * THE DUPLICATE-RULE CHECK AT THE CHOICE STEP (website-14, ChatGPT product idea 6). When a search result or a template resolves to a rule
 * whose canonical selector (registry.ts selectorKeyOf: the same source series or market) is already registered here, the page shows the
 * existing coins ("View existing coins") and still offers a separate coin, with the plain fact that an identical ticker is not an
 * identical token: the mint address is what identifies a coin. `sameRule` is true when the canonical rule hash (registry rulesSha, with
 * the onEnd clause every launch carries) is identical too. Lookalike refusal (lookalike.ts) is unchanged and still applies at launch.
 * Client-safe: the words and the shape. The match itself reads the registry's selector code (duplicateRuleMatch.ts, server only).
 */
export interface ExistingCoin { ticker: string; name: string; href: string; mint: string; sameRule: boolean }
export interface TokenLike { ticker: string; name: string; mint: string; selectorKey: string; rulesSha: string; status: string }

export const DUPLICATE_LINES = {
  head: (n: number) => (n === 1 ? "A coin with this rule is already registered on this site." : `${n} coins with this rule are already registered on this site.`),
  separate: "You can still create a separate coin. It gets its own mint address, its own burn pool and its own receipts.",
  ticker: "An identical ticker is not an identical token. The mint address is what tells two coins apart.",
  view: "View existing coins",
} as const;

