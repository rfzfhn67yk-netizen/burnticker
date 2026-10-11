/**
 * @burnticker/sdk — build on Burnticker from a bot (2026-10-09).
 *
 * Burnticker launches memecoins on Raydium LaunchLab whose supply burns when a verifiable real-world event settles (Kalshi markets,
 * Polymarket binary markets, first-party data feeds). This package is the curated public surface: rules (validate / canonical / sha256), the fee split, the
 * launch bundle (unsigned transactions + the review payload + the receipt format), token reads, receipt verification from source
 * and chain, the permissionless crank, and program events. Docs: docs/burnticker/sdk.md; HTTP: docs/burnticker/api.md.
 *
 * Public data and unsigned transactions only. Nothing here can change a rule, claim a fee, or adopt an existing token.
 */

export { Burnticker, type BurntickerOptions, type TokenView } from "./client.ts";
export { ApiTransport, BurntickerApiError, type Fetch } from "./http.ts";
export { rules, compose, validate, canonical, sha256, lock, type Selector, type Mapping, type Validation } from "./rules.ts";
export { fees, split, type SplitResult, type FeeAmount } from "./fees.ts";
export { buildLaunchBundle, feePdaFor, assertNotMainnet, MAINNET_GENESIS, type LaunchOptions, type LaunchResult } from "./launch.ts";
export { verifyReceipt, readChainMemo, memoFromLogs, burnProvenance, type VerifyOptions, type Provenance, type ChainTx } from "./verify.ts";
export { crank, DEFERRABLE_ERRORS, type CrankPlan, type CrankContext } from "./crank.ts";
export { subscribe, decodeEventData, eventsFromTransaction, base58Decode, EVENT_IX_TAG, type SubscribeOptions, type Subscription } from "./events.ts";
export type * from "./types.ts";

// Lower-level building blocks, re-exported from the platform's own modules (not re-implemented) for bots that want them directly.
export { KalshiClient, resolveSelector, selectorMatches, impliedChanceFrom, eventValue, isFinal, KALSHI_API } from "@/lib/burnticker/oracle/kalshi";
export { PolymarketClient, resolvePolymarket, polySelectorMatches, chainResult, gammaResult, parseGammaMarket, GAMMA_API, type GammaMarket } from "@/lib/burnticker/oracle/polymarket";
export { readConditionResolution, POLYMARKET_CTF, type ConditionResolution } from "@/lib/burnKeeper/attesters/polymarketOnchain";
export { backtest, backtestSentence } from "@/lib/burnticker/oracle/backtest";
export { unitStep, unitSteps, type SettledEvent, type CarryPolicy } from "@/lib/burnticker/units";
export { parseReceiptMemo, formatReceiptMemo, receiptFormatTemplate, receiptKey, RECEIPT_VERSION, type ReceiptMemo } from "@/lib/burnticker/receipt";
export { verifyReceiptCore, kalshiSourceReading, polymarketSourceReading, feedSourceReading, type ReceiptLike, type VerifyCheck } from "@/lib/burnticker/verify";
export { compileUnsigned, transactionFrom, PLACEHOLDER_BLOCKHASH, MAX_TX_BYTES } from "@/lib/burnticker/transactions";
export { buildLaunchBundle as buildLaunchBundleOffline, launchProblems, allocationFor, FakeLaunchLab, type LaunchBundle, type LaunchInput, type LaunchDeps, type LaunchLabClient } from "@/lib/burnticker/launchBundle";
export { FakeBurnProgram, PLACEHOLDER_PROGRAM_ID, type BurnProgramClient } from "@/lib/burnticker/program";
export { DISCLAIMER_FOOTER, EVENT_CONTRACT_DISCLOSURE, POLYMARKET_DISCLOSURE, DERBY_DISCLOSURE, PAIR_CLAUSE, pairClause, TOTAL_SUPPLY, DECIMALS } from "@/lib/burnticker/rules";
export { derbySeriesId, derbySpecProblems, derbySentence, derbyStatement, seasonWindows, windowAt, underlyingKey, DERBY_DISAGREEMENT_PP, type DerbySpec, type CoinVsSpec, type PriceSpec, type BracketSpec, type DerbyUnderlying } from "@/lib/burnticker/derby/spec";
export { burnPoolFor } from "@/lib/burnKeeper/burnPool";
export { buybackSpend } from "@/lib/burnKeeper/rules";
export { configPda, feePda, readingPda, vaultAddress } from "@/lib/burnReceipts/pda";
// For other LaunchLab-based launchpads composing the same flow under their own platform config (docs/burnticker/sdk.md §1).
export { initializeTokenIx, registerPoolIx, operatorAttester, zktlsRelayerAttester, type InitializeTokenArgs, type AttesterEntry } from "@/lib/burnReceipts/instructions";
export { planLaunch, buildCreateTx, type LaunchInput as LaunchLabLaunchInput } from "@/lib/burnKeeper/launch";
export { fetchTokenConfig, fetchReadings, type TokenConfigAccount, type ReadingAccount } from "@/lib/burnReceipts/accounts";
export { OUTCOME_NAMES, BURN_RECEIPTS_LOCALNET_PROGRAM_ID } from "@/lib/burnReceipts/constants";
