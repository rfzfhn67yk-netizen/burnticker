/**
 * THE PROGRAM PORT — types only (2026-10-10). What the keepers (programChain.ts, src/lib/burnticker/multiKeeper.ts) need from the
 * burn_receipts program, as views: no client types, no imports. Kept in its own import-free file so the public SDK (FakeBurnProgram in
 * src/lib/burnticker/program.ts) can name the port without pulling the $DEFICIT keeper's cycle, ledger or feeds. `SignedTx` and
 * `ConfirmOutcome` are structurally identical to cycle.ts's (test/burnKeeperProgram.test.ts checks they stay mutually assignable).
 */

export interface SignedTx { signature: string; raw: Uint8Array; blockhash: string; lastValidBlockHeight: number }
export type ConfirmOutcome = { status: "confirmed"; slot: number | null } | { status: "failed"; err: string } | { status: "expired" };

export interface AttesterView { key: string; kind: number }

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
}

/** One Reading account. `outcome` by name (pending / no-units / burned / below-floor / short / exhausted). */
export interface ProgramReadingView {
  recordDate: number; prevDate: number; kind: number; processed: boolean; value: bigint; prevValue: bigint; delta: bigint; units: number;
  signersMask: number; outcome: string; poolLamports: bigint; poolActualLamports: bigint; spentLamports: bigint; ruleSpendLamports: bigint;
  carriedInLamports: bigint; carriedOutLamports: bigint; got: bigint; burned: bigint; owed: bigint; shortfall: bigint;
  /** The CPMM pool the crank used, when the program records it on the reading (client v3); else the config's registered pool is assumed. */
  pool?: string | null;
}

export type CrankKind = "no_units" | "vault" | "buyback";
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
  buildReading(o: { recordDate: number; prevDate: number; value: bigint; sourceUrl: string; feedId: string; valueDecimals: number }): Promise<SignedTx & { message: string }>;
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
  /** A confirmed crank_* transaction that processed this reading (anyone's — cranking is permissionless), or null. */
  findCrankTx(recordDate: number): Promise<{ signature: string; slot: number | null; memo: string | null } | null>;
  /** Best-effort creator-fee claims into the fee PDA (curve vault, CPMM counters). Never throws for "nothing to claim". */
  claimCreatorFees(): Promise<{ sent: string[]; notes: string[] }>;
  /** check_pool_health (permissionless). */
  checkPoolHealth(): Promise<{ signature: string | null; note: string }>;
  feePdaLamports(): Promise<bigint | null>;
  supplyRaw(): Promise<bigint | null>;
  /**
   * Adapter-specific refusals that also mean "not now" (e.g. the SyncNative-before-crank error the next client treats as retryable),
   * on top of WAIT_REASONS. Optional.
   */
  readonly retryableErrors?: ReadonlySet<string>;
}
