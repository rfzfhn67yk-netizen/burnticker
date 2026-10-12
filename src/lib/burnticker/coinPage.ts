import { windowKindOf, PERPETUAL_SENTENCE } from "@/lib/burnticker/describe";
import type { BurnRule } from "@/lib/burnticker/rules";

// rules.ts reads files (node:fs) and cannot ship to the browser; these two values mirror it and test/burntickerCoinPage.test.ts pins them.
export const RULES_SCHEMA = "burnticker.rules/v1";
export const WIND_DOWN_DAYS = 28;

/**
 * THE COIN PAGE'S ORDER AND ITS SMALL FACTS (website-11, 2026-10-12; the owner's review items 6 and 8 as the website brief rewrites
 * them). On top: the chart and ONE outbound link, "Trade on Raydium", to the coin's own pool. Burnticker never takes an order, so there
 * is no buy or sell panel. Under it the tabs, in this order: "Burn log" (the receipts, each with "Check receipt" to the in-browser
 * verifier), "Rule" (the locked rule text, its hash, the dial, the window and the end), and "Holders" only when holder data was read.
 * There is no thread. The pair page uses the same order with both sides. Pure and client-safe.
 */

export type CoinTab = "burns" | "rule" | "holders";
export const COIN_TAB_LABEL: Record<CoinTab, string> = { burns: "Burn log", rule: "Rule", holders: "Holders" };

/** The tabs a coin page shows, in order. Holders is left out, not shown empty, when no holder data was read. */
export function coinTabs(hasHolders: boolean): CoinTab[] {
  return hasHolders ? ["burns", "rule", "holders"] : ["burns", "rule"];
}

/** The tab a page opens on: the one its address names (#rule, #holders) when that tab exists, else the burn log. */
export function initialTab(hash: string, tabs: readonly CoinTab[]): CoinTab {
  const h = hash.replace(/^#/, "");
  return (tabs as readonly string[]).includes(h) ? (h as CoinTab) : "burns";
}

/** The one outbound trade link: the market block's Raydium link for this coin. Any other venue the API lists is not shown. */
export function raydiumLink(trade: { links: { id: string; label: string; url: string }[] } | null | undefined): { label: string; url: string } | null {
  const l = trade?.links.find((x) => x.id === "raydium" || x.id === "launchlab");
  return l ? { label: "Trade on Raydium", url: l.url } : null;
}

/** "Check receipt": the in-browser verifier with this receipt's transaction filled in, on the coin's own network. */
export function checkReceiptHref(signature: string | null, cluster: string): string | null {
  if (!signature) return null;
  const net = cluster === "mainnet" ? "mainnet" : "devnet";
  return `/burnticker/check?sig=${encodeURIComponent(signature)}&cluster=${net}#verify`;
}

export interface RuleFacts {
  /** What one unit (or one firing result) does to the burn pool, in a sentence. Null when the rule file does not say. */
  dial: string | null;
  /** How long the rule runs. */
  window: string;
  /** What happens when it ends. */
  end: string;
}

const pct = (f: number) => `${Math.round(f * 1000) / 10}%`;

/**
 * The dial, the window and the end of a locked rule, read from its exact rules.json text. A Burnticker rule (burnticker.rules/v1) names
 * its share of the burn pool per unit, its window and its wind-down. The operator's own rule files (burnkeeper.rules/v1, $DEFICIT and
 * $REHEARSAL) name the share as `buyback.fractionPerUnit` and have no end.
 */
export function ruleFacts(rulesText: string, oneShot = false): RuleFacts {
  let raw: unknown = null;
  try { raw = JSON.parse(rulesText); } catch { raw = null; }
  const j = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (j.schema === RULES_SCHEMA) {
    const r = j as unknown as BurnRule;
    const m = r.kind === "binary" ? r.binary?.onYes ?? r.binary?.onNo ?? null : r.scalar?.perUnit ?? null;
    const each = r.kind === "binary" ? "Each result that fires the rule" : "Each unit";
    const dial = m?.tokens !== undefined ? `${each} burns ${m.tokens.toLocaleString("en-US")} tokens from the coin's vault.`
      : typeof m?.fractionOfPool === "number" ? `${each} spends ${pct(m.fractionOfPool)} of the burn pool on this coin and burns what it gets.` : null;
    const kind = windowKindOf(r);
    const window = kind === "perpetual" ? PERPETUAL_SENTENCE
      : kind === "one-shot" || oneShot ? "This coin resolves once. One result decides it."
      : kind === "next" ? "This coin covers a fixed number of games, and then its rule ends."
      : kind === "post" ? "This coin covers one postseason, and then its rule ends."
      : "This coin covers one season, and then its rule ends.";
    const days = r.onEnd?.windDownDays ?? WIND_DOWN_DAYS;
    const end = kind === "perpetual" ? "The rule has no end, so nothing winds down."
      : `When the rule ends, whatever is left in the burn pool is burned down over ${days} days, and then the coin retires.`;
    return { dial, window, end };
  }
  const bb = (j.buyback ?? null) as { fractionPerUnit?: string } | null;
  const f = bb?.fractionPerUnit !== undefined ? Number(bb.fractionPerUnit) : NaN;
  return {
    dial: Number.isFinite(f) && f > 0 ? `Each unit spends ${pct(f)} of the burn pool on this coin and burns what it gets.` : null,
    window: oneShot ? "This coin resolves once. One result decides it." : PERPETUAL_SENTENCE,
    end: oneShot ? "When the rule ends, whatever is left in the burn pool is burned down, and then the coin retires." : "The rule has no end, so nothing winds down.",
  };
}

/** The plain line a coin on its bonding curve shows under the curve: burns wait for graduation and the pool's registration. */
export const BURNS_AFTER_GRADUATION = "Burns begin only after the bonding curve fills, the coin moves to its Raydium pool, and that pool is registered with the burn program.";
