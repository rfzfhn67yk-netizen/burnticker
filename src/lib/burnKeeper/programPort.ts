/**
 * THE PROGRAM PORT — types only (2026-10-10). What the keepers (programChain.ts, src/lib/burnticker/multiKeeper.ts) need from the
 * burn_receipts program, as views: no client types, no imports. Kept in its own import-free file so the public SDK (FakeBurnProgram in
 * src/lib/burnticker/program.ts) can name the port without pulling the $DEFICIT keeper's cycle, ledger or feeds. `SignedTx` and
 * `ConfirmOutcome` are structurally identical to cycle.ts's (test/burnKeeperProgram.test.ts checks they stay mutually assignable).
 */

export interface SignedTx { signature: string; raw: Uint8Array; blockhash: string; lastValidBlockHeight: number }
export type ConfirmOutcome = { status: "confirmed"; slot: number | null } | { status: "failed"; err: string } | { status: "expired" };

export interface AttesterView { key: string; kind: number }

/**
 * A SIGNATURE FROM ANOTHER HOST (signer-2, 2026-10-12): an attester key this process does not hold signed the exact reading message on
 * its own machine (scripts/burnticker-signer.mts). The adapter checks it against the message before it goes into the one shared-message
 * Ed25519SigVerify instruction, and drops a key the TokenConfig does not list.
 */
export interface Cosignature { key: string; signature: Uint8Array }

/** What a reading is built from (buildReading's input; readingMessage turns it into the exact signed bytes). */
export interface ReadingInput { recordDate: number; prevDate: number; value: bigint; sourceUrl: string; feedId: string; valueDecimals: number; /** 32 bytes for the signed message's proof= (Burn Derby: the reading's proof hash); zero when absent. */ proofHash?: Uint8Array }

/** TokenConfig, as the keeper and the status page read it (strings for keys, bigint for amounts). */
export interface ProgramConfigView {
  programId: string; config: string; feePda: string; mint: string;
  mode: "buyback" | "vault"; feedId: string; memoPrefix: string; memoSource: string; valueDecimals: number; rulesSha256: string;
  unitValue: bigint; fractionPerUnitBps: number; floorLamports: bigint; reserveLamports: bigint; tokensPerUnit: bigint;
  attesters: AttesterView[]; quorum: number; pendingAttesters: AttesterView[]; pendingEta: number | null; adminRenounced: boolean;
  hasBaseline: boolean; lastRecordDate: number; lastValue: bigint; carry: bigint; crankCursor: number;
  poolRegistered: boolean; pool: string | null; poolUntradeableSince: number | null;
  /** Latest untradeable observation (a gap over 24 h restarts the spell) and the genesis the signed message binds — client v3. */
  poolUntradeableLastSeen?: number | null; clusterGenesis?: string;
  carriedSpendLamports: bigint; totalBurned: bigint; totalSpentLamports: bigint; shortfall: bigint; readings: number; burns: number;
  /** Round 5: true when the coin burns a TARGET token (crank_target_burn; a target reading's `burned`/`got` are the target's units and
   *  `owed` the coin's own tokens burned). Absent on older ports = false. */
  burnsTarget?: boolean;
  /** LAUNCHPAD-PATH §45: the rule ended (resolved or void). Informational: since round 5 (R5-3 / R5-4) crank_carried still drains the
   *  carried spend after an end (a RESOLVED end keeps it on the coin for 30 days), so the keeper never stops dispersing on this. Absent on
   *  older ports = live. */
  ruleEnded?: boolean;
  /** The end state itself (live / resolved / void); absent on older ports = live. */
  endState?: "live" | "resolved" | "void";
  /** The Raydium CPMM AmmConfig the coin pinned at initialize_token (TokenConfig.ll_cp_config): its fee tier after graduation (cpmmTier.ts
   *  tierForPin; owner decision 2026-10-19, new coins tier 14 and earlier coins the tier they pinned). Absent on older ports. */
  cpConfig?: string;
}

/** planCarried's "not now" answers. "too-soon" (round-5 review R5-8): the piece fits the coin's carried budget at `nextAtMs`. */
export type CarriedPlanStatus = { status: "nothing-carried" | "reading-pending" | "not-buyback" | "waiting-for-pool" } | { status: "too-soon"; nextAtMs: number };

/** One Reading account. `outcome` by name (pending / no-units / burned / below-floor / short / exhausted). */
export interface ProgramReadingView {
  recordDate: number; prevDate: number; kind: number; processed: boolean; value: bigint; prevValue: bigint; delta: bigint; units: number;
  signersMask: number; outcome: string; poolLamports: bigint; poolActualLamports: bigint; spentLamports: bigint; ruleSpendLamports: bigint;
  carriedInLamports: bigint; carriedOutLamports: bigint; got: bigint; burned: bigint; owed: bigint; shortfall: bigint;
  /** The CPMM pool the crank used, when the program records it on the reading (client v3); else the config's registered pool is assumed. */
  pool?: string | null;
}

export type CrankKind = "no_units" | "vault" | "buyback" | "forward" | "target"; // forward: LAUNCHPAD-PATH §40, a paired coin that lost the period; target: round 5, a coin that burns another token
/** The next reading in line and how to crank it. `build` signs the crank only when called — after earlier signatures are resolved. */
export type CrankPlan = { kind: CrankKind; recordDate: number; build: () => Promise<SignedTx> } | { status: "idle" } | { status: "waiting-for-pool"; recordDate: number };

export interface ProgramPort {
  readonly programId: string;
  readonly mint: string;
  readonly feePda: string;
  readonly configAddress: string;
  config(): Promise<ProgramConfigView | null>;
  reading(recordDate: number): Promise<ProgramReadingView | null>;
  /** Public keys of the attester keys this process holds (it signs readings with all of them). */
  attesterKeys(): string[];
  /** Signs the canonical message with every held attester key (≤ 3) and builds [Ed25519SigVerify (one shared message), submit_reading]; signed, not sent. */
  buildReading(o: ReadingInput & { /** Signatures made on another host over the same message (signer-2); each is checked, unlisted keys are dropped. */ cosignatures?: readonly Cosignature[] }): Promise<SignedTx & { message: string }>;
  /** The exact bytes the program verifies for this reading (UTF-8), so a co-signer can be asked to sign them. Optional: older ports lack it. */
  readingMessage?(o: ReadingInput): Promise<string>;
  /** The next reading in line and its crank (signed only on build()) — or why there is nothing to crank. */
  planCrank(): Promise<CrankPlan>;
  /** `err` is the Anchor error name when the logs carry one ("TwapUnavailable"), else the raw error. */
  simulate(raw: Uint8Array): Promise<{ err: string | null; logs: string[] }>;
  send(raw: Uint8Array): Promise<void>;
  confirm(tx: SignedTx): Promise<ConfirmOutcome>;
  signatureStatuses(signatures: string[]): Promise<({ slot: number | null; err: string | null; confirmed: boolean } | null)[]>;
  blockHeight(): Promise<number>;
  /** The memo the program wrote in a confirmed transaction (its own Memo CPI, not log text) — for `recordDate` when given — or null. */
  memoOf(signature: string, recordDate?: number): Promise<string | null>;
  /**
   * The confirmed transaction that processed this reading (anyone's — cranking is permissionless), or null: one of the program's
   * processing instructions (src/lib/burnReceipts/processing.ts PROCESSING_INSTRUCTIONS, crank_target_burn and forward_to_winner
   * included) for THIS program and THIS reading date. `forwards` says whether it was the forward_to_winner (when the port knows).
   */
  findCrankTx(recordDate: number): Promise<{ signature: string; slot: number | null; memo: string | null; instruction?: string; forwards?: boolean } | null>;
  /** Best-effort creator-fee claims into the fee PDA (curve vault, CPMM counters). Never throws for "nothing to claim". */
  claimCreatorFees(): Promise<{ sent: string[]; notes: string[] }>;
  /** check_pool_health (permissionless). */
  checkPoolHealth(): Promise<{ signature: string | null; note: string }>;
  feePdaLamports(): Promise<bigint | null>;
  supplyRaw(): Promise<bigint | null>;
  /**
   * BURN DISPERSAL (2026-10-13; src/lib/burnticker/dispersal.ts): crank_carried for a piece of at most `maxSpendLamports` of the carried
   * spend, signed only on build() — or why there is none. Optional: a port without it (an older client) never disperses.
   */
  planCarried?(maxSpendLamports: bigint): Promise<{ build: () => Promise<SignedTx> } | CarriedPlanStatus>;
  /**
   * Round-5 review R5-8: the coin's carried budget as the program judges it — the last piece's time (unix s; 0 = never, a full cap), the
   * budget left after it, and the chain's clock (latest block time; null when unknown). The budget refills at one per-crank cap per
   * CARRIED_BUDGET_WINDOW_SECS up to one cap (math.ts carriedBudget*). Read only before a piece is planned. Optional: a port without it
   * relies on planCarried's "too-soon" and the CarriedTooSoon refusal.
   */
  carriedPace?(): Promise<{ lastCarriedAt: number; budgetLamports: bigint; chainNowSec: number | null } | null>;
  /** The registered CPMM pool's WSOL reserve net of owed fees (the per-crank cap and the price move are measured on it), or null. */
  poolSolReserve?(): Promise<bigint | null>;
  /**
   * Adapter-specific refusals that also mean "not now" (e.g. the SyncNative-before-crank error the next client treats as retryable),
   * on top of WAIT_REASONS. Optional.
   */
  readonly retryableErrors?: ReadonlySet<string>;
}
