/**
 * GUARDRAILS, SAFEGUARDS AND WHO GETS WHAT (site audit #7/#8, R07, BT-17; 2026-10-11). These sat on the homepage, some twice (the
 * quorum-1 attester line and the time-lock line appeared verbatim in both "Current status" and "Safeguards"). The homepage now carries a
 * short status and links here; the trust page renders this module once, as static copy (no API read, so it shows even when the live data
 * cannot be read). Client-safe: no imports. Copy-linted by test/burntickerHome.test.ts.
 */

/** The eleven guardrails, in order (the old homepage strip). */
export const GUARDRAILS = [
  "settled on primary sources",
  "signed readings (one operator attester; no independent second attester is live)",
  "program-run burns",
  "receipts anyone can recompute",
  "open source",
  "three blind AI reviews, not a firm audit",
  "creators earn nothing",
  "no team buy",
  "the platform never buys any coin",
  "LP locked forever, its fees fund the burn",
  "rules locked at launch",
] as const;

export const GUARDRAIL_SUMMARY = "Each coin has one rule, and the rule is locked at launch. A program spends the coin's own fee pool on each burn, and nobody chooses the amount. Today one operator signs every reading. The program has had AI reviews, and no security firm has audited it.";

/** What protects a burn. The current values (signers, upgrade authority, time lock) are in the current-status summary, so they are not repeated here. */
export const SAFEGUARDS: { id: string; title: string; text: string }[] = [
  { id: "locked-rules", title: "Rules are locked", text: "Each coin's rule and its fingerprint (a SHA-256 hash) are written into the coin's settings at launch. Every receipt repeats them. No instruction can change a rule. A different rule means a different coin." },
  { id: "signed-readings", title: "Readings are signed", text: "Before a burn uses a reading, the reading is signed and stored on chain. The current-status summary above says who signs today. Adding a signer takes a 48-hour wait, and signers can never drop below the required number. A signature shows who signed. It does not prove the value is right. The source and its second publisher are how the value is checked." },
  { id: "crank", title: "Nobody picks the amount", text: "The program that records burns works out each amount from the rule and the pool. It buys the coin on the coin's own pool and burns it in the same step. Anyone may start that step. Before the audit, a short list of up to three approved accounts can be required instead, for at most 90 days. Readings need the operator's signature today. If the operator stops, readings stop and burns stop. Holders keep their coins, nothing can be withdrawn, and every past receipt can still be checked. A way to close out retired coins is planned for the next program upgrade." },
  { id: "no-withdraw", title: "There is no withdraw", text: "The fee pool belongs to the program. Trading fees flow in, and anyone may add more. The only way out is a burn. The program itself can still be upgraded. The current-status summary above says who can approve an upgrade and how long it must wait." },
  { id: "receipts", title: "Anyone can recompute a receipt", text: "Each burn writes one memo in a fixed order. It holds the date, the source, the previous and current readings, the change, the units, the pool, the amount spent, the amount bought, the amount burned, the swap and the rule's fingerprint. Each coin's page recomputes it from the source and shows a tick only when the chain and the source agree." },
  { id: "holders", title: "Holders are never touched", text: "No one can move or burn tokens in your wallet, and no one can mint more. Burns use only what the pool bought. A coin that stops trading simply stops burning." },
];

/** The admission rules for a source (the old homepage "sources" box). */
export const ADMISSION_RULES = "A rule settles on a public result. Its input is never a market's odds and never the token's price. The result must come from a primary source that a second, independent publisher confirms, or from the on-chain payout of an adjudicated Polymarket market. The units must be clear. Nobody who could hold the coin may control the result. Disasters are refused. Prediction markets are for discovery only. Burnticker shows their questions and rules, and never a price.";

/** Who gets what (the old homepage "economics" cards). */
export const WHO_GETS_WHAT: { who: string; text: string }[] = [
  { who: "The coin", text: "Its share of the trading fees goes to its burn pool, which is its burn budget. A day with little trading means a small burn. There is no team allocation, and the team buys nothing at launch." },
  { who: "The creator", text: "The creator pays the venue's creation cost and the network fee. The creator earns no cash from fees, because the creator's share is fixed at zero. What the creator gets is a coin whose burns are paid for by its own trading." },
  { who: "Burnticker", text: "Burnticker takes 25 basis points of trading volume on the launch curve. That rate is set in the LaunchLab platform settings, and this page reads it live below. After a coin moves to its trading pool, the liquidity is locked forever. The program splits the fees from that liquidity: 80% goes to the coin's burn pool and 20% goes to the operator. Nothing is ever taken from a burn pool. The operator never trades a coin launched here. The only purchases are the program's own buybacks, and everything bought is burned." },
];
