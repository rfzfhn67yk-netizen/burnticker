import { FOOTER_COPY } from "@/lib/burnticker/siteNav.mjs";

/**
 * EVERY WORD THE SWAP PANEL SHOWS (swap-1, 2026-10-14). Plain sentences (owner copy rule 2026-10-11), and every string here passes the
 * copy lint (src/lib/launch/copyLint.ts; test/burntickerSwap.test.ts lints each one, the templated ones filled with sample values).
 * The lint refuses "buy", "price", "will", "payout" and "target", so the panel says "swap", "SOL in", "tokens out" and "amount".
 * Client-safe.
 */

/** The site's standing not-advice sentence (the footer's last), so the panel and the footer can never say it two ways. */
export const NOT_ADVICE_SENTENCE: string = FOOTER_COPY.notAdvice.split(/(?<=\.)\s+/).pop() ?? FOOTER_COPY.notAdvice;
export const SWAP_NOTICE = `${NOT_ADVICE_SENTENCE} This swap goes straight to the coin's own Raydium curve or pool; the site holds nothing.`;

export const SWAP_COPY = {
  title: "Swap",
  solIn: "SOL in",
  tokensIn: "Tokens in",
  tokensOut: "Tokens out",
  solOut: "SOL out",
  directionToTokens: "SOL to tokens",
  directionToSol: "Tokens to SOL",
  amount: "Amount",
  slippage: "Slippage",
  slippageNote: "The swap is refused on chain if it would fill below the minimum out.",
  minimumOut: "Minimum out",
  fee: "Fee",
  max: "All",
  connect: "Connect a wallet to swap",
  swapButton: "Swap",
  quoting: "Reading the pool",
  simulating: "Checking the swap with the network",
  signing: "Waiting for your wallet",
  sending: "Sending",
  confirming: "Confirming",
  confirmed: "Swap confirmed.",
  receiptLink: "View the transaction on the explorer",
  otherVenues: "Or swap elsewhere",
  curveVenue: "This coin is still on its LaunchLab curve.",
  poolVenue: "This coin trades in its Raydium pool.",
  devnetNote: "This site runs on devnet. The SOL here is test SOL with no money value.",
  pending: "Your swap was sent, and this page has not seen it settle yet. It sends nothing else until it reads how that swap ended.",
  checkAgain: "Check again",
  checking: "Checking the earlier swap",
  earlierConfirmed: "Your earlier swap is confirmed.",
  expired: "Your earlier swap did not land, and it can no longer land, so nothing changed. You can swap again.",
  balanceUnread: "This page could not read the wallet's new balance just now. The swap itself is confirmed.",
  noKeys: "The panel never sees your keys. Your wallet signs, and you can read every step before you approve it.",
} as const;

export const SLIPPAGE_CHOICES_BPS = [100, 200, 500] as const;
export const DEFAULT_SLIPPAGE_BPS = 200;

const pct = (bps: number): string => `${Math.round(bps) / 100}%`;

/** How much of the fee the burn pool's share is, in words ("Half of it"), so the line never reads as a cut taken from the fee twice. */
export function shareOfFee(partBps: number, totalBps: number): string {
  if (totalBps <= 0 || partBps >= totalBps) return "All of it";
  const r = partBps / totalBps;
  const words: [number, string][] = [[1 / 2, "Half of it"], [1 / 4, "A quarter of it"], [3 / 4, "Three quarters of it"], [1 / 3, "A third of it"], [2 / 3, "Two thirds of it"], [1 / 5, "A fifth of it"]];
  for (const [f, w] of words) if (Math.abs(r - f) < 1e-9) return w;
  return "Part of it";
}
const restParts = (r: { raydiumBps: number; platformBps: number }): string => (r.platformBps > 0 ? `Raydium (${pct(r.raydiumBps)}) and Burnticker (${pct(r.platformBps)})` : `Raydium (${pct(r.raydiumBps)})`);

/**
 * The fee line: the whole fee, then the burn pool's share of it, which is the reason to swap in this coin's own pool. Walkthrough 13
 * (2026-10-14): "1% of the swap. Of that, 0.5%" read as half of the fee, so the share is said in words and as a share of the swap. On
 * the curve, `rest` names where the other legs go, in the same sentence.
 */
export function feeLine(i: { totalBps: number; burnPoolBps: number; feeText: string; burnPoolText: string; unit: string; rest?: { raydiumBps: number; platformBps: number } | null }): string {
  const head = `The swap pays a ${pct(i.totalBps)} fee (${i.feeText} ${i.unit}). ${shareOfFee(i.burnPoolBps, i.totalBps)} (${pct(i.burnPoolBps)} of the swap, ${i.burnPoolText} ${i.unit}) goes to this coin's burn pool`;
  return i.rest ? `${head}; the rest goes to ${restParts(i.rest)}.` : `${head}, which pays for its burns.`;
}
/** The curve's other legs on their own sentence. */
export const curveSplitLine = (raydiumBps: number, platformBps: number): string => `The rest goes to ${restParts({ raydiumBps, platformBps })}.`;

export const REFUSAL = {
  draft: "This coin is a draft. It has no pool to swap in yet.",
  notLive: "This coin is not live, so this panel does not swap it.",
  otherCluster: "This coin is not on this site's network, so this panel does not swap it.",
  devnetCoin: "This is a devnet test coin, so this panel does not swap it on this site.",
  testCoin: "This is a disclosed test coin. It is listed so you can see it exists, not so you trade it.",
  operatorWallet: "This wallet is one of the operator's own wallets. The trust page's rule is that the operator's wallets do not trade platform coins, so this panel refuses it.",
  guardUnavailable: "This site could not load its list of operator wallets just now, so the panel is not swapping. Reload the page to try again, or use a link below.",
  wrongNetwork: "This site's connection is not on the coin's network, so nothing can be sent from here.",
  migrating: "The curve is complete and the coin is moving to its Raydium pool. Swaps here pause until the pool is registered on this site.",
  graduatedNoPool: "The curve is complete. This panel swaps again once the coin's Raydium pool is registered on this site.",
  unsupported: "This coin's pool is set up in a way this panel does not handle. Use a link below.",
  poolPaused: "Raydium has paused swaps in this coin's pool.",
  poolNotOpen: "This coin's Raydium pool has not opened for swaps yet.",
  noPool: "This site could not find the coin's pool on chain.",
  amount: "Enter an amount above zero.",
  amountFormat: (decimals: number) => `Enter a plain number with at most ${decimals} decimal places.`,
  shortSol: (have: string, need: string, reserve: string) => `This wallet holds ${have} SOL. The swap needs ${need} SOL, including about ${reserve} SOL for network fees and account rent.`,
  shortTokens: (have: string, need: string, ticker: string) => `This wallet holds ${have} $${ticker}. The swap needs ${need}.`,
  noOutput: "This amount is too small to come out as anything. Enter a larger amount.",
  slippage: (now: string, min: string, slip: string) => `The pool moved since the quote. The swap would now give ${now}, below your minimum of ${min} at ${slip} slippage. Nothing was sent. Check the new quote and try again.`,
  simulation: (why: string) => `The network's test run of this swap failed, so nothing was sent. ${why}`,
  cannotSign: "This wallet cannot sign transactions.",
  rejected: "The wallet did not sign, so nothing was sent.",
  notConfirmed: (sig: string) => `The swap was sent but not confirmed in time. Check transaction ${sig} on the explorer before you try again.`,
  failed: (why: string) => `The swap failed on chain, and the wallet keeps what it had except the network fee. ${why}`,
} as const;

export const capLine = (used: string): string => `The curve has fewer tokens left than this amount takes. The swap fills the curve and uses ${used} SOL.`;
export const balanceLine = (amount: string, ticker: string): string => `This wallet now holds ${amount} $${ticker}.`;
export const holdsLine = (sol: string, tokens: string, ticker: string): string => `This wallet holds ${sol} SOL and ${tokens} $${ticker}.`;
