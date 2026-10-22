import TRANSPARENCY from "../../../config/burnticker/transparency.json" with { type: "json" };

/**
 * Eighth pre-launch audit B-24 / HB-186 / HS-72 (owner confirmed 2026-10-21): the operator's own wallet created the soft-launch coins its transparency entry names (eight as of 2026-10-21; the release check keeps the list honest, HB-225)
 * through the site. The wallets come from config/burnticker/transparency.json `operatorCreatorWallets` (each also listed in `wallets`),
 * and any coin whose creator is one of them carries the sentence below on its page, so a later coin by the same wallet gets it too.
 *
 * Ninth pre-launch audit B-26 / HB-206 / HS-95 (AP9-1): that wallet bought $SEAWIN four minutes after creating it and sold all of it 24
 * seconds later (mainnet 2PWU1CBg… BuyExactIn, 5ieZjtQ3… SellExactIn). Every trade an operator wallet made in a platform coin is listed
 * in transparency.json `operatorTrades`, with the owner's reason as ONE string per trade; every public sentence about the operator's
 * trading is built from that list here (the coin page, terms, press, the use-of-fees paragraph), and the prose kept in the JSON files
 * (the wallet entry, the test-coins text, the policy, the fee ledger, the operator page note) must carry the same sentences
 * (transparencyProblems and test/burntickerOperatorTrades.test.ts). A coin with no listed trade keeps "has not traded it" only because
 * the release check (scripts/ops/operator-trades-check.mts, run by publish-and-deploy.sh) reads each operator wallet's token history for
 * every platform mint and stops the publish when it finds a trade this list does not hold.
 */
export const OPERATOR_CREATOR_WALLETS: ReadonlySet<string> = new Set((TRANSPARENCY as { operatorCreatorWallets?: string[] }).operatorCreatorWallets ?? []);

/** One trade by an operator wallet in a platform coin: a test purchase and, when it was sold, the sale (transparency.json `operatorTrades`). */
export interface OperatorTrade {
  mint: string; ticker: string; wallet: string;
  /** SOL the wallet paid for the purchase, and SOL it got back from the sale (null when not sold) */
  inSol: number; outSol: number | null;
  /** the coins the purchase returned, as a decimal string */
  outTokens: string;
  buyTx: string; sellTx: string | null;
  /** block times of the purchase, the sale, and the coin's create transaction (ISO, UTC) */
  at: string; sellAt: string | null; coinCreatedAt: string | null;
  /**
   * The owner's reason, one string that completes "The $TICKER test was made …" (starts with "to …", no final full stop). "" or null
   * while the owner has not written one down; every surface then prints OPERATOR_TRADE_REASON_MISSING instead.
   */
  reason: string | null;
}

export const OPERATOR_TRADES: readonly OperatorTrade[] = ((TRANSPARENCY as { operatorTrades?: OperatorTrade[] }).operatorTrades ?? []);

const sol = (n: number, places: number) => n.toFixed(places);
const WORDS = ["zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const secondsBetween = (a: string | null, b: string | null): number | null => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 1000) : null);

/** "a 0.10 SOL test purchase and immediate sale of $SEAWIN on 2026-10-15" (a purchase never sold says "test purchase of …"). */
export function operatorTradePhrase(t: OperatorTrade): string {
  return `a ${sol(t.inSol, 2)} SOL test purchase${t.sellTx ? " and immediate sale" : ""} of $${t.ticker} on ${t.at.slice(0, 10)}`;
}
/**
 * What every surface prints in place of the reason sentence while a listed trade's `reason` is "" or null: the trade is disclosed, the
 * why is not, and the page says so rather than guess. Setting a reason later needs only transparency.json (the reason and the prose
 * fields that operatorTradesProblems checks word for word).
 */
export const OPERATOR_TRADE_REASON_MISSING = "The operator has not yet written down why that test was made.";
/** True when the trade carries an owner-written reason ("" and null mean none yet). */
export const hasOperatorTradeReason = (t: OperatorTrade): boolean => typeof t.reason === "string" && t.reason.trim() !== "";
/** "The $SEAWIN test was made <reason>." The owner's reason, as written in transparency.json, or OPERATOR_TRADE_REASON_MISSING. */
export function operatorTradeReason(t: OperatorTrade): string {
  return hasOperatorTradeReason(t) ? `The $${t.ticker} test was made ${t.reason}.` : OPERATOR_TRADE_REASON_MISSING;
}
/** "(0.10 SOL in, 0.098 SOL out)" */
export function operatorTradeAmounts(t: OperatorTrade): string {
  return `(${sol(t.inSol, 2)} SOL in${t.outSol !== null ? `, ${sol(t.outSol, 3)} SOL out` : ""})`;
}
/** Every listed trade's reason sentence, joined (the missing-reason sentence once, however many trades lack one). Empty when no trade is listed. */
export function operatorTradeReasons(trades: readonly OperatorTrade[] = OPERATOR_TRADES): string {
  return [...new Set(trades.map(operatorTradeReason))].join(" ");
}

/** The wallet as the disclosure writes it: its first four and last five characters ("8sJf…LvGbs"). */
export const operatorWalletShort = (a: string): string => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-5)}` : a);

/**
 * The coin-page sentence for a coin the operator's own wallet created; null for any other creator. A coin with a listed trade names the
 * round trip; a coin without one says "has not traded it" (the release check proves it at every publish); with no mint given, the
 * sentence says only what is true of every such coin.
 */
export function operatorCreatorLine(creator: string | null | undefined, mint: string | null = null, wallets: ReadonlySet<string> = OPERATOR_CREATOR_WALLETS, trades: readonly OperatorTrade[] = OPERATOR_TRADES): string | null {
  if (!creator || !wallets.has(creator)) return null;
  const lead = `Created by the operator's own wallet ${operatorWalletShort(creator)} during the soft launch.`;
  if (!mint) return `${lead} The operator holds none of it.`;
  const mine = trades.filter((t) => t.mint === mint);
  if (!mine.length) return `${lead} The operator holds none of it and has not traded it.`;
  const parts = mine.map((t) => {
    const after = secondsBetween(t.coinCreatedAt, t.at), held = secondsBetween(t.at, t.sellAt);
    const minutes = after !== null ? Math.round(after / 60) : null;
    const when = minutes !== null && minutes >= 1 && minutes <= 10 ? `${WORDS[minutes]} minute${minutes === 1 ? "" : "s"} after creating it, that wallet` : `On ${t.at.slice(0, 10)}, ${t.wallet === creator ? "that wallet" : `the operator's wallet ${operatorWalletShort(t.wallet)}`}`;
    const sale = t.sellTx ? ` and sold all of it${held !== null ? ` ${held} seconds later` : ""}` : "";
    return `${when} bought ${sol(t.inSol, 2)} SOL of it${sale}, as a test${t.sellTx ? "; it has held none since" : ""}. ${hasOperatorTradeReason(t) ? `The test was made ${t.reason}.` : OPERATOR_TRADE_REASON_MISSING}`;
  });
  return `${lead} ${parts.join(" ")}`;
}

/**
 * The clause that names every disclosed test after "Apart from …": the $REHEARSAL purchase at creation and each listed trade
 * ("two disclosed tests (0.1 SOL of $REHEARSAL at creation, and a 0.10 SOL purchase and immediate sale of $SEAWIN minutes after it was
 * created)"). No date: the terms and the press page carry no dates (test/burntickerPolish.test.ts); the test-coins page gives it.
 */
export function disclosedTestsClause(trades: readonly OperatorTrade[] = OPERATOR_TRADES): string {
  const when = (t: OperatorTrade) => { const s = secondsBetween(t.coinCreatedAt, t.at); return s !== null && s < 3_600 ? "minutes after it was created" : "after it was created"; };
  const items = ["0.1 SOL of $REHEARSAL at creation", ...trades.map((t) => `a ${sol(t.inSol, 2)} SOL purchase${t.sellTx ? " and immediate sale" : ""} of $${t.ticker} ${when(t)}`)];
  const n = items.length;
  const count = n === 1 ? "one disclosed test" : `${WORDS[n]?.toLowerCase() ?? n} disclosed tests`;
  const list = n === 1 ? items[0] : `${items.slice(0, -1).join(", ")}, and ${items[n - 1]}`;
  return `${count} (${list})`;
}

/**
 * The use-of-fees paragraph (fees.ts USE_OF_FEES, which cannot read config) with each listed trade's reason sentence right after the
 * sentence that points at the disclosed tests. Unchanged when no trade is listed or the anchor sentence is absent.
 */
export function feesUseWithReasons(useOfFees: string, trades: readonly OperatorTrade[] = OPERATOR_TRADES): string {
  const reasons = operatorTradeReasons(trades), anchor = "apart from the two disclosed tests on the test-coins page.";
  return reasons && useOfFees.includes(anchor) ? useOfFees.replace(anchor, `${anchor} ${reasons}`) : useOfFees;
}
