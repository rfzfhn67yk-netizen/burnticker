import { HIGH_CHOICE_LABEL, HIGH_CHOICE_LINE } from "@/lib/burnticker/derby/highTile";

/**
 * A RECORD CLOSE ASKED IN WORDS (QA walkthrough 11 M5, 2026-10-13: "bitcoin record close" and "BTC all-time high" found nothing, because
 * a coin's record close is a choice inside Coin comparison, derby/highTile.ts). The search reads the ask and offers that launch type as a
 * card that opens Coin comparison with the coin filled in. A city's "record high" stays a weather query: the weak words ("record high",
 * "new high") count only next to a named coin.
 */
const COINS: readonly [RegExp, string, string][] = [
  [/\b(bitcoin|btc|xbt)\b/i, "BTC", "Bitcoin"],
  [/\b(ethereum|ether|eth)\b/i, "ETH", "Ethereum"],
  [/\b(solana|sol)\b/i, "SOL", "Solana"],
  [/\b(dogecoin|doge)\b/i, "DOGE", "Dogecoin"],
];
const STRONG = /\b(record (daily )?closes?|record closing|all[- ]?time[- ]?highs?|ath)\b/i;
const WEAK = /\b(record highs?|new highs?|new records?|records?)\b/i;

export interface RecordCloseIntent { coin: string | null; label: string | null }

export function recordCloseIntent(q: string): RecordCloseIntent | null {
  const strong = STRONG.test(q), weak = WEAK.test(q);
  if (!strong && !weak) return null;
  const named = COINS.find(([re]) => re.test(q));
  const dollar = /\$([A-Za-z][A-Za-z0-9]{1,9})\b/.exec(q);
  const coin = named ? { coin: named[1], label: named[2] } : dollar ? { coin: dollar[1].toUpperCase(), label: `$${dollar[1].toUpperCase()}` } : null;
  if (!strong && !coin) return null;
  return coin ?? { coin: null, label: null };
}

/** The Coin comparison link that opens the record-close choice (the tile reads `template`, `kind` and `a`). */
export const recordCloseHref = (coin: string | null): string => `/burnticker/launch?template=coin-vs-coin&kind=record-close${coin ? `&a=${encodeURIComponent(coin)}` : ""}`;

/** The card's words (plain English; the copy lint refuses the words for a market high, so every line says record close). */
export function recordCloseCardText(i: RecordCloseIntent): { title: string; subtitle: string; settlement: string; interpreted: string } {
  return {
    title: i.label ? `Burns when ${i.label}'s daily close beats its record` : "Burns when a coin's daily close beats its record",
    subtitle: `${HIGH_CHOICE_LABEL}, a launch type under Coin comparison.`,
    settlement: "the reference coin's daily closes on its Pyth feed",
    interpreted: `${HIGH_CHOICE_LINE} You pick the reference coin and how far back the record reaches.`,
  };
}
