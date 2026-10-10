import type { FeeSplit } from "@/lib/burnticker/fees";
import type { BurnMapping } from "@/lib/burnticker/rules";

/**
 * The token page's JSON shapes (status.json, receipts.json) — what tokenPage.ts builds, the pages render, the public API returns and
 * the SDK types. Types only, no runtime imports beyond types, so the public SDK can import them without the page renderer, the
 * registry or the $DEFICIT status page. tokenPage.ts re-exports both.
 */

/** Rivalry pairs: one side's summary, and the other side as seen from a token. */
export interface PairSideSummary { ticker: string; name: string; mint: string; burns: number; burned: string; supply: string; lastBurnAt: string | null }
export interface PairCounterpart { pairId: string; side: "A" | "B"; counterpart: PairSideSummary }

export type ReceiptStatusJson = "planned" | "sending" | "confirmed" | "skipped" | "void" | "exhausted" | "nothing";

export interface ReceiptJson {
  eventId: string; settledAt: string; oracle: string; market: string; result: string | null; value: string | null; title: string | null; method: string | null; sourceUrl: string | null; settlementSourceUrl: string | null;
  units: number; kind: string; note: string; prevValue: string | null; carryIn: string; mapping: BurnMapping | null;
  pool: string | null; spent: string | null; got: string | null; burned: string | null; shortOut: string | null; status: ReceiptStatusJson; skippedReason: string | null; memo: string | null; signature: string | null; txUrl: string | null;
  /** Program execution: the reading (YYYY-MM-DD) the units were counted into, whether this receipt carries the reading's amounts, why it waits, a partial day. */
  execution: "program" | null; readingDate: string | null; lead: boolean | null; waitReason: string | null; partial: string | null;
  verify: { curl: string; formula: string; expected: string; checks: string[]; verified: boolean };
}

/** The burn_receipts program for one token: attestation (keys, quorum, last reading tx), the queue, pool health (2026-10-10). */
export interface TokenProgramJson {
  programId: string; config: string | null; initialized: boolean;
  attesters: { key: string; kind: string; heldByKeeper: boolean }[]; quorum: number; keeperHolds: number; quorumMet: boolean; adminRenounced: boolean;
  lastReading: { date: string; signature: string; txUrl: string } | null;
  queue: { lastOnChain: string | null; crankCursor: string | null; notAttested: number; awaitingCrank: number; carriedSpendSol: string; waits: { eventId: string; reason: string }[]; partials: { readingDate: string; note: string }[] };
  pool: { registered: boolean; address: string | null; untradeableSince: string | null };
  totals: { readings: number; burns: number; burned: string; spentSol: string };
}

export interface TokenStatusJson {
  schema: "burnticker.status/v1"; generatedAt: string; ticker: string; name: string; mint: string; cluster: string; status: "draft" | "live" | "paused" | "retired" | "expired";
  /** When the token went live (its baseline time); null for a draft. The platform daily lists launches by this day. */
  launchedAt: string | null;
  oracle: string; selectorKey: string; seriesTitle: string | null; mode: string;
  rules: { sha256: string; sha12: string; statement: string; file: "rules.json"; oneShot: boolean };
  addresses: { mint: string; mintUrl: string; feePda: string; feePdaUrl: string; feeWsol: string | null; feeWsolUrl: string | null; vault: string | null; vaultUrl: string | null; creator: string; creatorUrl: string; programId: string; poolId: string | null; launchTx: string | null; launchTxUrl: string | null };
  supply: { initial: string; current: string; source: "chain" | "registry" };
  burned: { total: string; pctOfSupply: number; count: number; last30d: string };
  pool: { feePdaSol: string | null; spendableSol: string | null; reserveSol: string; vaultBalance: string | null; vaultAllocation: string | null; shortfallOutstanding: string; capSol: number; queuedSol: string | null; queuedNote: string };
  /** impliedChance is the market-implied chance of the next burn — DISPLAY ONLY, never read by the rule. */
  next: { nextCheckAt: string | null; impliedChance: number | null; impliedBasis: string | null; nextMarket: string | null; nextCloseTime: string | null; awaitingFinal: number };
  feed: { lastEventId: string | null; lastValue: string | null; lastSettledAt: string | null; readings: number; lastFetchAt: string | null; lastError: string | null; failures: number };
  attesters: { pubkey: string; role: string; active: boolean }[]; quorum: number;
  fees: { curve: FeeSplit; postGraduation: FeeSplit; sentence: string; creatorSliceBps: 0 };
  health: { pending: number; unverified: number; lastError: string | null };
  disclosure: { disclaimer: string; eventContract: string | null };
  trust: { lpBurnedPct: number; creatorCashBps: 0; teamAllocationPct: 0; operator: { can: string[]; cannot: string[]; placeholder: boolean }; registerUrl: string };
  /** The burn_receipts program: attestation, the queue (unattested days, cranks waiting, carried spend), pool health. Null with no program config read. */
  program: TokenProgramJson | null;
  /** Rivalry pair: this side, the other side, and the running tally (burns / supply, both sides). */
  pair: (PairCounterpart & { tally: { burnsThis: number; burnsOther: number; burnedThis: string; burnedOther: string; supplyThis: string; supplyOther: string }; pageUrl: string }) | null;
}
