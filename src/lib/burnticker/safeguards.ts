/**
 * GUARDRAILS, SAFEGUARDS AND WHO GETS WHAT (site audit #7/#8, R07, BT-17; 2026-10-11). These sat on the homepage, some twice (the
 * quorum-1 attester line and the time-lock line appeared verbatim in both "Current status" and "Safeguards"). The homepage now carries a
 * short status and links here; the trust page renders this module once, as static copy (no API read, so it shows even when the live data
 * cannot be read). Client-safe: one import, the operator-share line (feeShareLine.ts, itself client-safe). Copy-linted by test/burntickerHome.test.ts.
 */
import { BOTH_TIERS_LINE, bothTiersLineNow } from "@/lib/burnticker/feeShareLine";
import { DEPLOYED_TIER_PIN_PENDING } from "@/lib/burnticker/deployedTierPin";
import { SETTLEMENT_SOURCES_SENTENCE } from "@/lib/burnticker/singleSource";
import { LP_BEFORE_GRADUATION_TRUST } from "@/lib/burnticker/lpLockCopy";
import { operatorTradeReasons } from "@/lib/burnticker/operatorCreators";

/**
 * Walkthrough 13: the disclosed exception to "the operator never buys" (transparency.json rehearsals: 0.1 SOL of $REHEARSAL at creation).
 * Ninth pass B-26 / HS-95: there are two; the second is the operator's own wallet's $SEAWIN test (transparency.json operatorTrades).
 */
export const REHEARSAL_BUY_EXCEPTION = `There are two disclosed exceptions. The operator bought 0.1 SOL of $REHEARSAL, a disclosed test coin, when it was created on Oct 11. The operator's own wallet bought 0.10 SOL of $SEAWIN on Oct 15 and sold all of it 24 seconds later.${operatorTradeReasons() ? ` ${operatorTradeReasons()}` : ""}`;

/** The ten guardrails, in order (the old homepage strip). Owner decision 2026-10-22: the review guardrail left; the trust page says once that no security firm has audited the code. */
export const GUARDRAILS = [
  "settled on primary sources",
  "signed readings (one operator attester; no independent second attester is live)",
  "program-run burns",
  "receipts anyone can recompute",
  "open source",
  "creators earn nothing",
  "no team buy",
  "the platform buys no coin except one test coin",
  "LP locked forever, its fees fund the burn",
  "rules locked at launch",
] as const;

/**
 * WHAT KIND OF PROMISE EACH GUARDRAIL IS (ChatGPT chat audit 6, A9, 2026-10-12): the trust page showed one check mark for policy, current
 * program behaviour and review history alike. Each guardrail now names its kind and says its scope in a full sentence. GUARDRAILS stays
 * the short list the README and the announcement thread quote; this is how the trust page shows it.
 *
 *   enforced  the current program or platform settings make it so (an upgrade could change it; the scope says so)
 *   policy    the operator's own rule, which no code enforces
 *   observed  evidence anyone can look at now
 *   planned   not in place yet
 */
export type GuardrailKind = "enforced" | "policy" | "observed" | "planned";
export const GUARDRAIL_KIND_LABEL: Record<GuardrailKind, string> = { enforced: "Enforced by the current program or settings", policy: "Operator policy, not enforced by code", observed: "Evidence you can check now", planned: "Planned, not in place yet" };
/**
 * HS-96: the guardrail rows for a given tier-pin answer (deployedTierPin.ts). The LP-lock row ends with DEPLOYED_TIER_PIN_LINE while the
 * deployed mainnet burn program is pre-B17; GUARDRAIL_DETAIL is the rows for this build's verified-build table.
 */
export function guardrailDetail(tierPinPending: boolean = DEPLOYED_TIER_PIN_PENDING): Record<(typeof GUARDRAILS)[number], { kind: GuardrailKind; text: string }> {
  return {
  "settled on primary sources": { kind: "policy", text: "A rule may settle only on a primary source, or on an adjudicated market's on-chain payout." },
  "signed readings (one operator attester; no independent second attester is live)": { kind: "enforced", text: "The program accepts a reading only with the required signature. Today one signer, run by the operator, signs every reading, and no independent second signer is live." },
  "program-run burns": { kind: "enforced", text: "In the current program, a burn is one program step that buys and burns in the same transaction. Nobody picks the amount." },
  "receipts anyone can recompute": { kind: "observed", text: "Every burn's memo, transaction and source reading are public, and the check page recomputes them in your browser." },
  "open source": { kind: "observed", text: "The code is in a public repository at a pinned commit." },
  "creators earn nothing": { kind: "enforced", text: "Creators receive no trading-fee revenue. The platform settings send the creator's share of the curve fees to the coin's burn pool. A creator can still hold or trade the coin like anyone else." },
  // walkthrough 13: the one disclosed exception (the Test coins page: "The operator bought 0.1 SOL of it at creation") is named here too
  // HB-59 (hourly run 6): the $REHEARSAL exception is said once, in the next line, not here as well
  "no team buy": { kind: "policy", text: "There is no team allocation, and the operator makes no opening purchase in a creator's coin." },
  "the platform buys no coin except one test coin": { kind: "policy", text: `The operator and its wallets never trade a coin launched here. ${REHEARSAL_BUY_EXCEPTION} This is a policy, checked by the monitor on the operator page. It is separate from each coin's program-run buyback, which buys only to burn.` },
  "LP locked forever, its fees fund the burn": { kind: "enforced", text: `At graduation the platform settings lock all of the pool's liquidity with Raydium's lock. ${LP_BEFORE_GRADUATION_TRUST} ${bothTiersLineNow(tierPinPending)}` },
  "rules locked at launch": { kind: "enforced", text: "No instruction in the current program can change a coin's rule. The program itself can still be upgraded, and the current status says who can approve an upgrade." },
  };
}
export const GUARDRAIL_DETAIL = guardrailDetail();
export const GUARDRAIL_SUMMARY = "Each coin has one rule, and the rule is locked at launch. A program spends the coin's own fee pool on each burn, and nobody chooses the amount. Today one operator signs every reading.";

/** What protects a burn. The current values (signers, upgrade authority, time lock) are in the current-status summary, so they are not repeated here. */
export const SAFEGUARDS: { id: string; title: string; text: string }[] = [
  { id: "locked-rules", title: "Rules are locked", text: "Each coin's rule and its fingerprint (a SHA-256 hash) are written into the coin's settings at launch. Every receipt repeats them. No instruction can change a rule. A different rule means a different coin." },
  { id: "signed-readings", title: "Readings are signed", text: "Before a burn uses a reading, the reading is signed and stored on chain. The current-status summary above says who signs today. Adding a signer takes a 48-hour wait, and signers can never drop below the required number. A signature shows who signed. It does not prove the value is right. The source and its second publisher are how the value is checked." },
  { id: "crank", title: "Nobody picks the amount", text: "The program that records burns works out each amount from the rule and the pool. It buys the coin on the coin's own pool and burns it in the same step. Anyone may start that step. Before the audit, a short list of up to three approved accounts can be required instead, for at most 90 days. Readings need the operator's signature today. If the operator stops, readings stop and burns stop. Holders keep their coins, nothing can be withdrawn, and every past receipt can still be checked. A way to close out retired coins is planned for the next program upgrade." },
  // walkthrough 13 (private review 10: "no withdraw" too absolute beside the end-of-rule moves): say where the pool can go, all of it a burn
  { id: "no-withdraw", title: "There is no withdraw", text: "The fee pool belongs to the program. Trading fees flow in, and anyone may add more. No instruction pays it out to a person. It leaves only when the program spends it on this coin's own burn, or, when the rule ends, to move to the burn its rule named at launch, such as $DEFICIT's or a rival coin's. The program itself can still be upgraded. The current-status summary above says who can approve an upgrade and how long it must wait." },
  { id: "receipts", title: "Anyone can recompute a receipt", text: "Each burn writes one memo in a fixed order. It holds the date, the source, the previous and current readings, the change, the units, the pool, the amount spent, the amount bought, the amount burned, the swap and the rule's fingerprint. Each coin's page recomputes it from the source and shows a tick only when the chain and the source agree." },
  { id: "holders", title: "Holders are never touched", text: "No instruction in the current program can move or burn tokens in your wallet, and no one can mint more. Burns use only what the pool bought. A coin that stops trading simply stops burning." },
];

/** The admission rules for a source (the old homepage "sources" box). */
export const ADMISSION_RULES = `A rule settles on a public result. Its input is never a market's odds and never the token's price. ${SETTLEMENT_SOURCES_SENTENCE} The units must be clear. Nobody who could hold the coin may control the result. Markets on deaths, violence, terror or casualty counts are refused. A natural hazard's own reading, such as an earthquake's magnitude, is allowed. Prediction markets are for discovery only. Burnticker shows their questions and rules, and never a price.`;

/** Who gets what (the old homepage "economics" cards). */
export const WHO_GETS_WHAT: { who: string; text: string }[] = [
  { who: "The coin", text: "Its share of the trading fees goes to its burn pool, which is its burn budget. Burns draw on the accumulated budget. Trading adds funds, and a burn can be delayed or skipped when the spendable amount is too small. There is no team allocation, and the team buys nothing at launch." },
  { who: "The creator", text: "The creator pays the venue's creation cost and the network fee. The creator earns no cash from fees, because the creator's share is fixed at zero. What the creator gets is a coin whose burns are paid for by its own trading." },
  { who: "Burnticker", text: `Burnticker takes 25 basis points of trading volume on the launch curve. That rate is set in the LaunchLab platform settings, and this page reads it live below. After a coin moves to its trading pool, the liquidity is locked forever. ${bothTiersLineNow(DEPLOYED_TIER_PIN_PENDING)} Nothing is ever taken from a burn pool. The operator never trades a coin launched here. ${REHEARSAL_BUY_EXCEPTION} Apart from that, the only purchases are the program's own buybacks, and everything bought is burned.` },
];
