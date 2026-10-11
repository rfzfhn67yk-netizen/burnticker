import type { LpLockJson } from "@/lib/burnticker/lockFees";
import type { FeeSplit } from "@/lib/burnticker/fees";
import type { BurnMapping } from "@/lib/burnticker/rules";

/**
 * The token page's JSON shapes (status.json, receipts.json) — what tokenPage.ts builds, the pages render, the public API returns and
 * the SDK types. Types only, no runtime imports beyond types, so the public SDK can import them without the page renderer, the
 * registry or the $DEFICIT status page. tokenPage.ts re-exports both.
 */

/** Rivalry pairs: one side's summary, and the other side as seen from a token. */
export interface PairSideSummary { ticker: string; name: string; mint: string; burns: number; burned: string; supply: string; lastBurnAt: string | null }
/**
 * A clause pair's live state (both or neither, 2026-10-10): `live` once both pools registered, `waiting` (on side A, B or both) before,
 * `voided` when voidBy ended without both — no event burns ever, both coins on the fallback clock. Null for a pair made before the clause.
 */
export interface PairClauseJson { voidBy: string; state: "live" | "waiting" | "voided"; waitingOn: ("A" | "B")[]; decidedAt: string | null; detail: string | null }
/**
 * WINNER TAKES THE BURN (owner decision 2026-10-11, API 1.10.0): one forward_to_winner — the loser's fuel for a result period moved to the
 * winner's burn pool (SOL), from the registry's append-only pair_forwards table. `from` / `to` are tickers.
 */
export interface PairForwardJson { recordDate: string; from: string; to: string; fromMint: string; toMint: string; sol: string; units: number; signature: string; txUrl: string | null }
export interface PairCounterpart {
  pairId: string; side: "A" | "B"; counterpart: PairSideSummary; clause?: PairClauseJson | null;
  /** Since 1.10.0: true when the pair runs winner-takes-the-burn (fees from both coins burn the winner's supply); false for older pairs. */
  winnerTakesBurn?: boolean;
  /** Since 1.10.0: every forward between the two coins, oldest first. */
  forwards?: PairForwardJson[];
  /** Since 1.11.0: unlink_pair ran (a voided pair curve, a refunding side, or no verified pool 30 days after pairing) — two plain coins now. */
  unpaired?: { reason: string; at: string; signature: string | null } | null;
}

/** Market data for the coin card and the coin page (market.ts builds it; 2026-10-10). Read from chain as data, never a price claim. */
export type CurvePhase = "curve" | "migrating" | "graduated";
/** The LaunchLab curve: quote raised, the raise that completes the curve (graduation), the share done, what is left. Decimal strings. */
export interface CurveJson { phase: CurvePhase; status: number; raised: string; threshold: string; remaining: string; quote: string; progressPct: number; poolId: string }
export interface HolderRow { account: string; owner: string | null; amount: string; pct: number; label: string | null }
/** Where to trade: deep links only — Burnticker hosts no swap. */
export interface TradeLinks { links: { id: "launchlab" | "raydium" | "jupiter"; label: string; url: string }[]; note: string | null }
export interface ChartJson { provider: "geckoterminal" | null; embedUrl: string | null; pageUrl: string | null; note: string }
/** status.json's market block. Every field the chain did not give is null and carries its reason. */
export interface MarketJson {
  phase: CurvePhase | null; curve: CurveJson | null; curveNote: string;
  /** The CPMM pool the curve migrated to, as registered in the burn program (null before graduation or with no program read). */
  graduatedPool: string | null;
  holders: { count: number | null; countNote: string; top: HolderRow[] | null; topNote: string };
  trade: TradeLinks; chart: ChartJson; readAt: string | null; error: string | null;
}
/** The creator's card fields (from the launch request, in the registry) and the one-liner derived from the locked rule (coinCard.ts). */
export interface TokenProfileJson { imageUrl: string | null; description: string; links: { label: string; url: string }[]; oneLiner: string; /** the window badge (describe.ts windowBadge): 2026 SEASON / PERPETUAL / ONE-SHOT · <date> … */ badge?: string; /** the creator's note (≤ 140, its own box: "creator's note — not part of the rule") */ note?: string; /** the standing line on every coin page and card */ affiliation?: string }
export interface PinnedJson { metadataUri: string | null; metadataTx: string | null; metadataSha256: string | null; imageUri: string | null; imageTx: string | null; imageSha256: string | null; hosted: boolean; /** the token metadata description the pinned JSON must carry, byte for byte */ expectedDescription: string }

export interface LifecycleJson {
  ended: { reason: string; at: string; mode: "drain" | "winddown" } | null;
  windDown: { days: number; done: number; unitsPerDay: number | null } | null;
  lastSweep: string | null;
  /** "live", "winding down · day 3 of 28", "draining", "retired · swept 2026-11-20 · pool ≈ 0". */
  line: string;
  /** The fee-flow sentence every coin page carries. */
  fees: string;
}

/** `forwarded` (since 1.10.0): this coin lost the period and its fuel moved to the winner's burn pool — nothing of this coin was bought or burned. */
export type ReceiptStatusJson = "planned" | "sending" | "confirmed" | "skipped" | "void" | "exhausted" | "nothing" | "pending-pair" | "voided" | "forwarded";

export interface ReceiptJson {
  eventId: string; settledAt: string; oracle: string; market: string; result: string | null; value: string | null; title: string | null; method: string | null; sourceUrl: string | null; settlementSourceUrl: string | null;
  units: number; kind: string; note: string; prevValue: string | null; carryIn: string; mapping: BurnMapping | null;
  pool: string | null; spent: string | null; got: string | null; burned: string | null; shortOut: string | null; status: ReceiptStatusJson; skippedReason: string | null; memo: string | null; signature: string | null; txUrl: string | null;
  /** Program execution: the reading (YYYY-MM-DD) the units were counted into, whether this receipt carries the reading's amounts, why it waits, a partial day. */
  execution: "program" | null; readingDate: string | null; lead: boolean | null; waitReason: string | null; partial: string | null;
  verify: { curl: string; formula: string; expected: string; checks: string[]; verified: boolean };
  /** Since 1.10.0, rivalry pairs: won / lost / draw for this result (a lost receipt carries the units it would have had had it won). */
  pairRole?: "won" | "lost" | "draw" | null;
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
  burned: { total: string; pctOfSupply: number; count: number; last30d: string; /** settled time of the latest confirmed burn */ lastAt: string | null };
  pool: { feePdaSol: string | null; spendableSol: string | null; reserveSol: string; vaultBalance: string | null; vaultAllocation: string | null; shortfallOutstanding: string; capSol: number; queuedSol: string | null; queuedNote: string };
  /** impliedChance is always null: no odds or prices for any coin (owner decision 2026-10-10). */
  next: { nextCheckAt: string | null; impliedChance: number | null; impliedBasis: string | null; nextMarket: string | null; nextCloseTime: string | null; awaitingFinal: number };
  feed: { lastEventId: string | null; lastValue: string | null; lastSettledAt: string | null; readings: number; lastFetchAt: string | null; lastError: string | null; failures: number };
  attesters: { pubkey: string; role: string; active: boolean }[]; quorum: number;
  fees: { curve: FeeSplit; postGraduation: FeeSplit; sentence: string; creatorSliceBps: 0 };
  health: { pending: number; unverified: number; lastError: string | null };
  disclosure: { disclaimer: string; eventContract: string | null };
  /** lpBurnedPct is 0 since 2026-10-10 (LP locked forever): read lpLockedPct / lpPolicy and the `lp` block. */
  trust: { lpBurnedPct: number; lpLockedPct?: number; lpPolicy?: "locked-forever"; creatorCashBps: 0; teamAllocationPct: 0; operator: { can: string[]; cannot: string[]; placeholder: boolean }; registerUrl: string };
  /**
   * LP LOCKED FOREVER (owner decision 2026-10-10): the policy, Raydium's lock program, the Fee Key (NFT mint) and its owner (the burn
   * program's fee-keys PDA), the locked-liquidity account, the 80/20 split, the last claim_lock_fees receipt and the totals. Absent on
   * status files written before the decision.
   */
  lp?: LpLockJson | null;
  /** The burn_receipts program: attestation, the queue (unattested days, cranks waiting, carried spend), pool health. Null with no program config read. */
  program: TokenProgramJson | null;
  /** The coin card: image, description, socials, the rule's one-liner. */
  profile: TokenProfileJson;
  /** What was pinned at launch (pin.ts): the Arweave metadata and image with their sha256, and the description they must carry. */
  pinned?: PinnedJson | null;
  /** Bonding curve, graduation, top holders, chart embed and trade links (market.ts). */
  market: MarketJson;
  /** Rivalry pair: this side, the other side, and the running tally (burns / supply, both sides). */
  pair: (PairCounterpart & { tally: { burnsThis: number; burnsOther: number; burnedThis: string; burnedOther: string; supplyThis: string; supplyOther: string }; pageUrl: string }) | null;
  /**
   * NO BURN POOL IS EVER LEFT BEHIND (2026-10-10): when the rule ended and why, how the pool is being spent (drain / wind-down), the last
   * retired-coin sweep, and the one line the coin page shows ("retired · swept <date> · pool ≈ 0"). Absent on older status files.
   */
  lifecycle?: LifecycleJson | null;
}
