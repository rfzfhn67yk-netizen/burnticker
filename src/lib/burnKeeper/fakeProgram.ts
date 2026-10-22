import { ATTESTATION_DOMAIN, CARRY_CONSECUTIVE, GENESIS_HASH, KIND_BASELINE, KIND_RESET, MAX_QUORUM, MAX_SPEND_RESERVE_BPS, PACKET_DATA_SIZE, QUEUE_UNBLOCK_SECS, UNTRADEABLE_MAX_GAP_SECS } from "@/lib/burnReceipts/constants";
import { formatBuybackMemo, formatDebtMemo, formatTargetMemo } from "@/lib/burnReceipts/memo";
import { buybackSpend, carriedBudgetNow, carriedBudgetReadySec, deltaPlausible, formatDate, formatFixed, formatSignedFixed, rawToTokens, reserveSpendCap, settleVault, spendablePool, step } from "@/lib/burnReceipts/math";
import type { CarriedPlanStatus, ConfirmOutcome, Cosignature, CrankPlan, ProgramConfigView, ProgramPort, ProgramReadingView, ReadingInput, SignedTx } from "@/lib/burnKeeper/programPort";
import { PublicKey } from "@solana/web3.js";
import { sourceUrlHash, verifyAttestation } from "@/lib/burnReceipts/attestation";

/**
 * THE burn_receipts PROGRAM IN MEMORY (2026-10-10) — a ProgramPort that behaves like the deployed program for the keeper's purposes,
 * so every branch of the program path runs without a validator: submit_reading (quorum, order, the unit rule with carry, the
 * out-of-bound RESET, zero-unit auto-processing), crank_buyback (pool = fee − reserve + WSOL, the platform cap, the rule spend,
 * the carried spend, the 2 %-of-reserve cap, the floor, TWAP / tradability refusals, burn everything the fee PDA holds, memo v2),
 * crank_vault (settle with shortfall, exhaustion, memo v1), crank_no_units, check_pool_health, and the creator-fee claim as a knob.
 * The arithmetic is src/lib/burnReceipts/math.ts — the program's own mirror — so the numbers are the program's, not a re-guess.
 *
 * Knobs: dropSends (the RPC swallows a send), simErr (the next simulations refuse with this name), twap ("ok" | "unavailable" |
 * "deviation"), poolTradable, poolReserveWsol (the 2 % cap's base), capLamports (null = no cap), claim (what claimCreatorFees does),
 * strayWsolLamports (lamports sent to the fee PDA's WSOL account without a sync — the crank syncs them in, review-2 F3).
 * Client v3 rules mirrored (second blind review): quorum ≤ 3 at init; one SHARED-message Ed25519 instruction per reading whose
 * legacy size is modelled exactly as the client builds it (`readingTxBytes`; > 1,232 bytes is refused unless `lookupTable`); the
 * signed message v3 carries the cluster genesis; readings record the pool they traded on; untradeable spells are continuous only
 * while observations are ≤ 24 h apart, and after 30 days the crank processes the reading below-floor with its target carried.
 * `strangerCrank(date)` processes a reading as someone else would (cranking is permissionless).
 */

export interface FakeProgramInit {
  programId?: string; mint?: string; feePda?: string; configAddress?: string; mode: "buyback" | "vault"; rulesSha256: string; feedId?: string; memoPrefix: string; memoSource: string;
  valueDecimals?: number; unitValue: bigint; carryRule?: number; maxAbsDelta?: bigint; fractionPerUnitBps?: number; floorLamports?: bigint; reserveLamports?: bigint;
  tokensPerUnit?: bigint; vaultAllocation?: bigint; attesters: string[]; quorum?: number; heldKeys?: string[]; decimals?: number; now?: () => number;
  /** The genesis the program build binds into signed messages (default: mainnet's — the default build). */
  clusterGenesis?: string;
  /** Round 5: the coin burns this TARGET token (pin_burn_target): its cranks are crank_target_burn on the pinned pool. */
  burnTarget?: { mint: string; pool: string; decimals: number };
}

/**
 * Wire size of the client's legacy submit_reading transaction (CU limit + one shared-message Ed25519 instruction + submit_reading,
 * one fee payer) for `signatures` signatures over a `messageBytes`-byte message — the client's exact layout (measured: 966 / 1,076 /
 * 1,186 bytes for 1 / 2 / 3 signatures over the 358-byte v3 message; each signature adds 110 bytes: 14 offsets + 32 key + 64 sig).
 */
export const readingTxBytes = (signatures: number, messageBytes: number): number => 498 + messageBytes + 110 * signatures;

type Payload =
  | { kind: "reading"; recordDate: number; prevDate: number; value: bigint; keys: string[] }
  | { kind: "crank"; crank: "no_units" | "vault" | "buyback" | "target"; recordDate: number }
  | { kind: "forward"; recordDate: number }
  | { kind: "carried"; maxSpend: bigint }
  | { kind: "other" };
export type FakePayload = Payload;

/** The program instruction a fake crank / forward payload stands for (processing.ts PROCESSING_INSTRUCTIONS names), or null. */
export function fakeInstructionName(p: Payload): string | null {
  if (p.kind === "forward") return "forward_to_winner";
  if (p.kind !== "crank") return null;
  return p.crank === "target" ? "crank_target_burn" : `crank_${p.crank}`;
}

const Z = BigInt(0);
const big = (n: number | bigint) => BigInt(n);

export class FakeProgram implements ProgramPort {
  readonly programId: string;
  readonly mint: string;
  readonly feePda: string;
  readonly configAddress: string;
  cfg: ProgramConfigView;
  readings = new Map<number, ProgramReadingView>();
  rulesSha256: string;
  decimals: number;
  maxAbsDelta: bigint;
  carryRule: number;
  vaultAllocation: bigint;
  heldKeys: string[];
  now: () => number;
  // the world
  feeLamports = Z;
  wsol = Z;
  feeTokens = Z;
  vaultTokens = Z;
  supply = big(1_000_000_000) * big(1_000_000);
  poolReserveWsol = big(1_000) * big(1_000_000_000);
  tokensPerSol = big(1_000_000) * big(1_000_000);
  capLamports: bigint | null = big(25_000_000_000);
  twap: "ok" | "unavailable" | "deviation" = "ok";
  /** The pool price-history ring observationRing() reports: "empty" (never traded), "recent" (too short), null (unreadable). */
  ring: "empty" | "recent" | null = null;
  poolTradable = true;
  // the RPC
  height = 100;
  n = 0;
  dropSends = false;
  simErr: string | null = null;
  payloads = new Map<string, Payload>();
  signed: { sig: string; payload: Payload; lvbh: number }[] = [];
  landed = new Map<string, { slot: number; err: string | null; memo: string | null; payload: Payload }>();
  claim: { sent?: string[]; notes?: string[] } | Error | ((p: FakeProgram) => { sent: string[]; notes: string[] }) = { notes: ["curve: nothing accrued (fake)"] };
  healthCalls = 0;
  strayWsolLamports = Z;
  /** The client falls back to a v0 transaction through a lookup table when a reading would not fit a legacy one. */
  lookupTable = false;
  lastReadingBytes = 0;
  readonly retryableErrors: ReadonlySet<string> = new Set(["WsolBalanceMismatch"]);
  /**
   * WINNER TAKES THE BURN (2026-10-11): the paired-coin crank gate (installed by src/lib/burnticker/pairForward.ts's fake) — "lost" →
   * ForwardRequired, "pending" → PairResultPending (until 72 h after the reading was submitted), "won" / "draw" / "missing" / null →
   * the normal crank. `readingSubmittedAt` records when each reading landed (ms).
   */
  pairGate: ((recordDate: number, readingSubmittedAtMs: number | null) => "won" | "lost" | "draw" | "pending" | "missing" | "forward-missing" | null) | null = null;
  /** Round 2: the PairForwardMissing / PairResultMissing events the crank gate emitted (a lost or result-less period cranked unpaired after 72 h). */
  pairEvents: { name: "PairForwardMissing" | "PairResultMissing"; recordDate: number }[] = [];
  readingSubmittedAt = new Map<number, number>();
  /**
   * END SINKS (LAUNCHPAD-PATH §45; installed by src/lib/burnticker/endSinkClient.ts's fake): after a RESOLVED end no reading dated
   * later than the end lands (RuleEnded) and no such reading cranks (ForwardOnEndRequired); a VOID end changes nothing here.
   */
  endState: { state: "live" | "resolved" | "void"; date: number } = { state: "live", date: 0 };
  /**
   * ROUND 5 (a coin with a burn target): the pinned target pool's state ("ok", or the program's two hold refusals), its SOL reserve (the
   * 2 % cap's base), the target tokens one SOL buys, and the target's supply (what the burns take out of).
   */
  burnTarget: { mint: string; pool: string; decimals: number } | null = null;
  targetPool: "ok" | "unhealthy" | "below-floor" = "ok";
  targetPoolReserveWsol = big(1_000) * big(1_000_000_000);
  targetTokensPerSol = big(2_000_000) * big(100_000);
  targetSupply = big(80_000_000_000) * big(100_000);

  constructor(i: FakeProgramInit) {
    this.programId = i.programId ?? "BurnReceiptsFakeProgram11111111111111111111";
    this.mint = i.mint ?? "FakeMint11111111111111111111111111111111111";
    this.feePda = i.feePda ?? `fee:${this.mint.slice(0, 8)}`;
    this.configAddress = i.configAddress ?? `config:${this.mint.slice(0, 8)}`;
    this.rulesSha256 = i.rulesSha256;
    this.decimals = i.decimals ?? 6;
    this.maxAbsDelta = i.maxAbsDelta ?? BigInt("200000000000000");
    this.carryRule = i.carryRule ?? CARRY_CONSECUTIVE;
    this.vaultAllocation = i.vaultAllocation ?? Z;
    this.heldKeys = i.heldKeys ?? [...i.attesters];
    this.now = i.now ?? (() => Date.now());
    const q = i.quorum ?? 1;
    if (q < 1 || q > MAX_QUORUM || q > i.attesters.length) throw new Error(`InvalidAttesters: 1 ≤ quorum ≤ min(attesters, ${MAX_QUORUM})`);
    this.cfg = {
      programId: this.programId, config: this.configAddress, feePda: this.feePda, mint: this.mint, mode: i.mode, feedId: i.feedId ?? "treasury.debt_to_penny", memoPrefix: i.memoPrefix, memoSource: i.memoSource,
      valueDecimals: i.valueDecimals ?? 2, rulesSha256: i.rulesSha256, unitValue: i.unitValue, fractionPerUnitBps: i.fractionPerUnitBps ?? 0, floorLamports: i.floorLamports ?? Z,
      reserveLamports: i.reserveLamports ?? Z, tokensPerUnit: i.tokensPerUnit ?? Z, attesters: i.attesters.map((key) => ({ key, kind: 0 })), quorum: i.quorum ?? 1, pendingAttesters: [], pendingEta: null,
      adminRenounced: false, hasBaseline: false, lastRecordDate: 0, lastValue: Z, carry: Z, crankCursor: 0, poolRegistered: false, pool: null, poolUntradeableSince: null,
      poolUntradeableLastSeen: null, clusterGenesis: i.clusterGenesis ?? GENESIS_HASH.mainnet,
      carriedSpendLamports: Z, totalBurned: Z, totalSpentLamports: Z, shortfall: Z, readings: 0, burns: 0,
    };
    if (i.mode === "buyback") this.feeLamports = this.cfg.reserveLamports;
    if (i.burnTarget) {
      if (i.mode !== "buyback") throw new Error("WrongMode: only a buyback coin can have a burn target");
      this.burnTarget = { ...i.burnTarget };
      this.cfg = { ...this.cfg, burnsTarget: true };
    }
  }

  /** register_pool (permissionless after graduation). */
  registerPool(pool = "CpmmPoo1FakeFeePdaCreator1111111111111111111"): void { this.cfg = { ...this.cfg, poolRegistered: true, pool }; }
  deposit(lamports: bigint): void { this.feeLamports += lamports; }

  // ---- reads ----
  async config() { return { ...this.cfg, attesters: [...this.cfg.attesters], ruleEnded: this.endState.state !== "live", endState: this.endState.state }; }
  async reading(d: number) { const r = this.readings.get(d); return r ? { ...r } : null; }
  attesterKeys() { return [...this.heldKeys]; }
  async feePdaLamports() { return this.feeLamports; }
  async supplyRaw() { return this.supply; }

  // ---- building ----
  private mk(payload: Payload): SignedTx {
    const sig = `fake${payload.kind}${++this.n}x${this.mint.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "").slice(0, 8)}`.padEnd(32, "Z");
    this.payloads.set(sig, payload);
    this.signed.push({ sig, payload, lvbh: this.height + 150 });
    return { signature: sig, raw: new TextEncoder().encode(sig), blockhash: `bh${this.n}`, lastValidBlockHeight: this.height + 150 };
  }
  /** The v3 message as the client builds it (signer-2: the real sha256 of the source URL, so a co-signer's bytes can be compared). */
  async readingMessage(o: ReadingInput): Promise<string> {
    const proof = o.proofHash ? Buffer.from(o.proofHash).toString("hex") : "0".repeat(64);
    return `${ATTESTATION_DOMAIN}|${this.cfg.clusterGenesis}|${this.programId}|${this.mint}|${o.feedId}|prev=${o.prevDate ? formatDate(o.prevDate) : "none"}|${formatDate(o.recordDate)}|${formatFixed(o.value, o.valueDecimals)}|src=${sourceUrlHash(o.sourceUrl).toString("hex")}|proof=${proof}`;
  }
  /** Readings that carried another host's signature, with the keys it counted (signer-2 tests). */
  cosigned: { recordDate: number; keys: string[] }[] = [];
  async buildReading(o: ReadingInput & { cosignatures?: readonly Cosignature[] }) {
    if (this.heldKeys.length > MAX_QUORUM) throw new Error(`at most ${MAX_QUORUM} attester keys sign one reading`);
    const message = await this.readingMessage(o);
    // signer-2: like the adapter — each co-signature must verify over these exact bytes; keys the config does not list are dropped.
    const extra: string[] = [];
    for (const cs of o.cosignatures ?? []) {
      if (!verifyAttestation(new PublicKey(cs.key), Buffer.from(message, "utf8"), cs.signature)) throw new Error(`the signature from ${cs.key.slice(0, 8)}… does not verify over this message`);
      if (this.cfg.attesters.some((a) => a.key === cs.key) && !this.heldKeys.includes(cs.key) && !extra.includes(cs.key)) extra.push(cs.key);
    }
    const keys = [...this.heldKeys, ...extra];
    if (keys.length > MAX_QUORUM) throw new Error(`a reading carries at most ${MAX_QUORUM} signatures`);
    if (extra.length) this.cosigned.push({ recordDate: o.recordDate, keys: [...keys] });
    this.lastReadingBytes = readingTxBytes(keys.length, new TextEncoder().encode(message).length);
    if (this.lastReadingBytes > PACKET_DATA_SIZE && !this.lookupTable) throw new Error(`burnReceipts: the transaction is ${this.lastReadingBytes} bytes (limit ${PACKET_DATA_SIZE}); pass a lookup table (createReadingLookupTable)`);
    return { ...this.mk({ kind: "reading", recordDate: o.recordDate, prevDate: o.prevDate, value: o.value, keys }), message };
  }
  private nextInLine(): ProgramReadingView | null {
    return [...this.readings.values()].filter((r) => !r.processed && r.prevDate === this.cfg.crankCursor).sort((a, b) => a.recordDate - b.recordDate)[0] ?? null;
  }
  async planCrank(): Promise<CrankPlan> {
    const next = this.nextInLine();
    if (!next) return { status: "idle" };
    const D = next.recordDate;
    if (next.units === 0) return { kind: "no_units", recordDate: D, build: async () => this.mk({ kind: "crank", crank: "no_units", recordDate: D }) };
    if (this.cfg.mode === "vault") return { kind: "vault", recordDate: D, build: async () => this.mk({ kind: "crank", crank: "vault", recordDate: D }) };
    // Round 5: a target coin never waits for a pool of its own (it trades on the pinned target pool).
    if (this.burnTarget) {
      if (this.pairGate && this.pairGate(D, this.readingSubmittedAt.get(D) ?? null) === "lost") return { kind: "forward", recordDate: D, build: async () => this.mk({ kind: "crank", crank: "target", recordDate: D }) };
      return { kind: "target", recordDate: D, build: async () => this.mk({ kind: "crank", crank: "target", recordDate: D }) };
    }
    if (!this.cfg.poolRegistered) return { status: "waiting-for-pool", recordDate: D };
    // Like burnReceipts/crank.ts planCrank: a paired coin that LOST the period plans "forward" (the keeper runs forward_to_winner through
    // its pair port; building it here as a crank is refused ForwardRequired, as on chain).
    if (this.pairGate && this.pairGate(D, this.readingSubmittedAt.get(D) ?? null) === "lost") return { kind: "forward", recordDate: D, build: async () => this.mk({ kind: "crank", crank: "buyback", recordDate: D }) };
    return { kind: "buyback", recordDate: D, build: async () => this.mk({ kind: "crank", crank: "buyback", recordDate: D }) };
  }

  // ---- execution ----
  /** Runs a payload against the state. Returns the error name (the state is untouched) or the memo written. */
  private execute(p: Payload, commit: boolean): { err: string } | { memo: string | null } {
    if (p.kind === "reading") return this.execReading(p, commit);
    if (p.kind === "crank") return this.execCrank(p.recordDate, p.crank, commit);
    if (p.kind === "carried") return this.execCarried(p.maxSpend, commit);
    return { memo: null };
  }
  private execReading(p: Extract<Payload, { kind: "reading" }>, commit: boolean): { err: string } | { memo: string | null } {
    const c = this.cfg;
    const have = this.readings.get(p.recordDate);
    if (have) return have.value === p.value ? { memo: null } : { err: "ConflictingReading" };
    if (c.hasBaseline && p.recordDate <= c.lastRecordDate) return { err: "StaleReading" };
    if (this.endState.state === "resolved" && p.recordDate > this.endState.date) return { err: "RuleEnded" };
    const signedPrev = c.hasBaseline ? c.lastRecordDate : 0;
    const slots = p.prevDate === signedPrev ? c.attesters.map((a, i) => (p.keys.includes(a.key) ? 1 << i : 0)).reduce((x, y) => x | y, 0) : 0;
    const counted = slots.toString(2).replace(/0/g, "").length;
    if (counted < c.quorum) return { err: "QuorumNotMet" };
    if (!commit) return { memo: null };
    let r: ProgramReadingView;
    const blank = { signersMask: slots, pool: null, outcome: "pending", poolLamports: Z, poolActualLamports: Z, spentLamports: Z, ruleSpendLamports: Z, carriedInLamports: Z, carriedOutLamports: Z, got: Z, burned: Z, owed: Z, shortfall: Z };
    if (!c.hasBaseline) r = { recordDate: p.recordDate, prevDate: 0, kind: KIND_BASELINE, processed: false, value: p.value, prevValue: Z, delta: Z, units: 0, ...blank };
    else {
      const s = step(c.lastValue, p.value, c.carry, c.unitValue, this.carryRule);
      const ok = deltaPlausible(s.delta, this.maxAbsDelta);
      r = { recordDate: p.recordDate, prevDate: c.lastRecordDate, kind: ok ? s.kind : KIND_RESET, processed: false, value: p.value, prevValue: c.lastValue, delta: s.delta, units: ok ? Number(s.units) : 0, ...blank };
      this.cfg = { ...this.cfg, carry: ok ? s.carryOut : Z };
    }
    this.cfg = { ...this.cfg, hasBaseline: true, lastRecordDate: p.recordDate, lastValue: p.value, readings: this.cfg.readings + 1 };
    if (r.units === 0 && r.prevDate === this.cfg.crankCursor) { r.processed = true; r.outcome = "no-units"; this.cfg = { ...this.cfg, crankCursor: p.recordDate }; }
    this.readings.set(p.recordDate, r);
    this.readingSubmittedAt.set(p.recordDate, this.now());
    return { memo: null };
  }
  private head(r: ProgramReadingView) {
    const d = this.cfg.valueDecimals;
    return { prefix: this.cfg.memoPrefix, recordDate: formatDate(r.recordDate), source: this.cfg.memoSource, prev: formatFixed(r.prevValue, d), now: formatFixed(r.value, d), delta: formatSignedFixed(r.delta, d), units: r.units, rulesSha12: this.rulesSha256.slice(0, 12), valueDecimals: d };
  }
  private execCrank(D: number, kind: "no_units" | "vault" | "buyback" | "target", commit: boolean): { err: string } | { memo: string | null } {
    const r0 = this.readings.get(D);
    if (!r0) return { err: "AccountNotInitialized" };
    if (r0.processed) return { err: "AlreadyProcessed" };
    if (r0.prevDate !== this.cfg.crankCursor) return { err: "OutOfOrder" };
    const r = { ...r0 };
    if (kind === "no_units") {
      if (r.units !== 0) return { err: "HasUnits" };
      if (!commit) return { memo: null };
      Object.assign(r, { processed: true, outcome: "no-units" });
      this.readings.set(D, r); this.cfg = { ...this.cfg, crankCursor: D };
      return { memo: null };
    }
    if (r.units === 0) return { err: "NoUnits" };
    if (kind === "vault") {
      if (this.cfg.mode !== "vault") return { err: "WrongMode" };
      const s = settleVault(big(r.units) * this.cfg.tokensPerUnit, this.cfg.shortfall, this.vaultTokens, this.vaultAllocation, this.cfg.totalBurned);
      if (!commit) return { memo: null };
      this.vaultTokens -= s.burn; this.supply -= s.burn;
      Object.assign(r, { processed: true, outcome: s.exhausted ? "exhausted" : s.shortfall > Z ? "short" : "burned", owed: s.owed, burned: s.burn, shortfall: s.shortfall });
      this.readings.set(D, r);
      this.cfg = { ...this.cfg, crankCursor: D, shortfall: s.shortfall, totalBurned: this.cfg.totalBurned + s.burn, burns: this.cfg.burns + (s.burn > Z ? 1 : 0) };
      return { memo: s.exhausted ? null : formatDebtMemo({ ...this.head(r), burn: rawToTokens(s.burn, this.decimals), ...(s.shortfall > Z ? { short: rawToTokens(s.shortfall, this.decimals) } : {}), version: "v1" }) };
    }
    if (this.cfg.mode !== "buyback") return { err: "WrongMode" };
    if (kind === "target" || this.burnTarget) return this.execTarget(D, r, kind, commit);
    if (!this.cfg.poolRegistered) return { err: "PoolNotRegistered" };
    if (this.endState.state === "resolved" && D > this.endState.date) return { err: "ForwardOnEndRequired" };
    const g = this.pairGate ? this.pairGate(D, this.readingSubmittedAt.get(D) ?? null) : null;
    if (g === "lost") return { err: "ForwardRequired" };
    if (g === "pending") return { err: "PairResultPending" };
    if (commit && (g === "forward-missing" || g === "missing")) this.pairEvents.push({ name: g === "missing" ? "PairResultMissing" : "PairForwardMissing", recordDate: D });
    // Review-2 F3: the program measures the synced WSOL balance (stray lamports included) and syncs before the swap.
    if (commit && this.strayWsolLamports > Z) { this.wsol += this.strayWsolLamports; this.strayWsolLamports = Z; }
    const poolActual = spendablePool(this.feeLamports, this.cfg.reserveLamports, this.wsol + this.strayWsolLamports);
    const basis = this.capLamports !== null && poolActual > this.capLamports ? this.capLamports : poolActual;
    const ruleSpend = buybackSpend(basis, big(r.units), this.cfg.fractionPerUnitBps);
    const carriedIn = this.cfg.carriedSpendLamports;
    const t = ruleSpend + carriedIn;
    const target = t < poolActual ? t : poolActual;
    let spent = Z, got = Z, outcome = "below-floor", carriedOut: bigint;
    const nowS = Math.floor(this.now() / 1000);
    const continuous = this.cfg.poolUntradeableSince !== null && this.cfg.poolUntradeableLastSeen != null && nowS - this.cfg.poolUntradeableLastSeen <= UNTRADEABLE_MAX_GAP_SECS ? nowS - this.cfg.poolUntradeableSince : 0;
    if (target === Z || target < this.cfg.floorLamports) carriedOut = carriedIn < poolActual ? carriedIn : poolActual;
    else if (!this.poolTradable && continuous >= QUEUE_UNBLOCK_SECS) carriedOut = target; // review-2 F7: stop waiting, carry the target
    else {
      if (!this.poolTradable) return { err: "PoolNotTradable" };
      if (this.twap === "unavailable") return { err: "TwapUnavailable" };
      if (this.twap === "deviation") return { err: "TwapDeviation" };
      const cap = reserveSpendCap(this.poolReserveWsol, MAX_SPEND_RESERVE_BPS);
      let spend = target < cap ? target : cap;
      if (basis < spend) spend = basis;
      if (spend === Z || spend < this.cfg.floorLamports) carriedOut = target;
      else { spent = spend; got = (spend * this.tokensPerSol) / big(1_000_000_000); outcome = "burned"; carriedOut = target - spend; }
    }
    if (!commit) return { memo: null };
    if (spent > Z) {
      const fromLamports = spent > this.wsol ? spent - this.wsol : Z;
      this.feeLamports -= fromLamports; this.wsol = this.wsol + fromLamports - spent;
      this.feeTokens += got;
    }
    const burned = this.feeTokens;
    this.feeTokens = Z; this.supply -= burned;
    Object.assign(r, { processed: true, outcome, poolLamports: basis, poolActualLamports: poolActual, ruleSpendLamports: ruleSpend, carriedInLamports: carriedIn, carriedOutLamports: carriedOut, spentLamports: spent, got, burned, pool: this.cfg.pool });
    this.readings.set(D, r);
    this.cfg = { ...this.cfg, crankCursor: D, totalBurned: this.cfg.totalBurned + burned, totalSpentLamports: this.cfg.totalSpentLamports + spent, burns: this.cfg.burns + (burned > Z ? 1 : 0), carriedSpendLamports: carriedOut, poolUntradeableSince: outcome === "burned" ? null : this.cfg.poolUntradeableSince, poolUntradeableLastSeen: outcome === "burned" ? null : !this.poolTradable ? nowS : this.cfg.poolUntradeableLastSeen };
    return { memo: formatBuybackMemo({ ...this.head(r), pool: basis.toString(), spent: spent.toString(), got: rawToTokens(got, this.decimals), burn: rawToTokens(burned, this.decimals), swap: spent > Z ? (r.pool ?? this.cfg.pool!).slice(0, 12) : "none", version: "v2" }) };
  }

  /**
   * crank_carried (burn dispersal) as the program runs it (round 5: before AND after the rule's end): refuses while a reading waits (ReadingPending), with nothing carried or a zero
   * piece (NothingCarried), above 2 % of the reserve (SpendAboveCap), under the floor unless it is the whole remainder (BelowFloor);
   * TWAP / tradability as crank_buyback. Spends min(carried, max, basis), burns everything held, writes the `carried` memo.
   * `poolMovesOnBuy` (off by default) adds each spend to the pool's WSOL reserve, as a real constant-product pool would.
   */
  poolMovesOnBuy = false;
  private execCarried(maxSpend: bigint, commit: boolean): { err: string } | { memo: string | null } {
    const c = this.cfg;
    if (c.mode !== "buyback") return { err: "WrongMode" };
    if (this.burnTarget) return { err: "BurnTargetSet" };
    // round-5 review R5-3 / R5-4 (deployed 2026-10-15, crank_carried.rs): NOT refused after an end — a VOID end's wind-down carry and a
    // RESOLVED end's carry (held on the coin for 30 days by the end paths) are drained here. RuleNotLive stays unused, as in the program.
    if (!c.poolRegistered) return { err: "PoolNotRegistered" };
    if (c.hasBaseline && c.crankCursor !== c.lastRecordDate) return { err: "ReadingPending" };
    if (c.carriedSpendLamports <= Z || maxSpend <= Z) return { err: "NothingCarried" };
    const nowSec = Math.floor(this.now() / 1000);
    if (!this.poolTradable) return { err: "PoolNotTradable" };
    const cap = reserveSpendCap(this.poolReserveWsol, MAX_SPEND_RESERVE_BPS);
    if (maxSpend > cap) return { err: "SpendAboveCap" };
    const poolActual = spendablePool(this.feeLamports, c.reserveLamports, this.wsol + this.strayWsolLamports);
    const basis = this.capLamports !== null && poolActual > this.capLamports ? this.capLamports : poolActual;
    let spend = c.carriedSpendLamports < maxSpend ? c.carriedSpendLamports : maxSpend;
    if (basis < spend) spend = basis;
    if (spend <= Z) return { err: "NothingCarried" };
    if (spend < c.floorLamports && spend !== c.carriedSpendLamports) return { err: "BelowFloor" };
    // round-5 review R5-8: the piece fits the coin's carried budget (one cap per 600 s, up to one cap; one piece per second)
    const budget = carriedBudgetNow(this.lastCarriedAt, this.carriedBudgetLamports, cap, nowSec);
    if (budget === null || spend > budget) return { err: "CarriedTooSoon" };
    if (this.twap === "unavailable") return { err: "TwapUnavailable" };
    if (this.twap === "deviation") return { err: "TwapDeviation" };
    if (!commit) return { memo: null };
    this.carriedBudgetLamports = budget - spend;
    if (this.strayWsolLamports > Z) { this.wsol += this.strayWsolLamports; this.strayWsolLamports = Z; }
    const got = (spend * this.tokensPerSol) / big(1_000_000_000);
    const fromLamports = spend > this.wsol ? spend - this.wsol : Z;
    this.feeLamports -= fromLamports; this.wsol = this.wsol + fromLamports - spend;
    this.feeTokens += got;
    if (this.poolMovesOnBuy) this.poolReserveWsol += spend;
    const burned = this.feeTokens;
    this.feeTokens = Z; this.supply -= burned;
    const left = c.carriedSpendLamports - spend;
    // R5-8: a carried piece counts in CarriedPace.pieces, never in `burns` (reading cranks only)
    const piece = ++this.carriedPieces;
    this.lastCarriedAt = nowSec;
    this.cfg = { ...this.cfg, totalBurned: c.totalBurned + burned, totalSpentLamports: c.totalSpentLamports + spend, carriedSpendLamports: left };
    return { memo: `${c.memoPrefix}|carried|through=${formatDate(c.crankCursor)}|spent=${spend}|got=${rawToTokens(got, this.decimals)}|burn=${rawToTokens(burned, this.decimals)}|left=${left}|piece=${piece}|swap=${(c.pool ?? "none").slice(0, 12)}|rules=sha256:${this.rulesSha256.slice(0, 12)}|v1` };
  }
  async planCarried(maxSpendLamports: bigint): Promise<{ build: () => Promise<SignedTx> } | CarriedPlanStatus> {
    const c = this.cfg;
    if (c.mode !== "buyback" || this.burnTarget) return { status: "not-buyback" };
    if (!c.poolRegistered) return { status: "waiting-for-pool" };
    if (c.hasBaseline && c.crankCursor !== c.lastRecordDate) return { status: "reading-pending" };
    if (c.carriedSpendLamports <= Z) return { status: "nothing-carried" };
    const nowSec = Math.floor(this.now() / 1000);
    const need = maxSpendLamports < c.carriedSpendLamports ? maxSpendLamports : c.carriedSpendLamports;
    const ready = carriedBudgetReadySec(this.lastCarriedAt, this.carriedBudgetLamports, reserveSpendCap(this.poolReserveWsol, MAX_SPEND_RESERVE_BPS), need, nowSec);
    if (ready !== null && ready > nowSec) return { status: "too-soon", nextAtMs: this.now() + (ready - nowSec) * 1000 };
    return { build: async () => this.mk({ kind: "carried", maxSpend: maxSpendLamports }) };
  }
  async observationRing(): Promise<{ newestTs: number; lastUpdate: number; filled: number; empty: boolean } | null> {
    if (!this.cfg.poolRegistered || this.ring === null) return null;
    const t = Math.floor(this.now() / 1000) - 60;
    return this.ring === "empty" ? { newestTs: 0, lastUpdate: 0, filled: 0, empty: true } : { newestTs: t, lastUpdate: t, filled: 1, empty: false };
  }
  async poolSolReserve(): Promise<bigint | null> { return this.cfg.poolRegistered ? this.poolReserveWsol : null; }
  /** Round-5 review R5-8 (CarriedPace): the last carried piece (unix seconds; 0 = never), the budget left after it, and the piece count
   *  (never in cfg.burns). */
  lastCarriedAt = 0;
  carriedBudgetLamports = Z;
  carriedPieces = 0;
  async carriedPace(): Promise<{ lastCarriedAt: number; budgetLamports: bigint; chainNowSec: number | null }> {
    return { lastCarriedAt: this.lastCarriedAt, budgetLamports: this.carriedBudgetLamports, chainNowSec: Math.floor(this.now() / 1000) };
  }
  /** Round-5 review R5-9 (blind review): the coin's pinned target STALLED (last_unblocked_at > last_burn_at) — it is then not live for
   *  pair forwarding or as a named end sink. */
  targetStalled = false;

  /** crank_target_burn as the program runs it (crank_buyback refuses a target coin with BurnTargetSet; a self coin refuses the target crank). */
  private execTarget(D: number, r: ProgramReadingView, kind: string, commit: boolean): { err: string } | { memo: string | null } {
    const bt = this.burnTarget;
    if (!bt) return { err: "NoBurnTarget" };
    if (kind !== "target") return { err: "BurnTargetSet" };
    if (this.endState.state === "resolved" && D > this.endState.date) return { err: "ForwardOnEndRequired" };
    const g = this.pairGate ? this.pairGate(D, this.readingSubmittedAt.get(D) ?? null) : null;
    if (g === "lost") return { err: "ForwardRequired" };
    if (g === "pending") return { err: "PairResultPending" };
    if (commit && (g === "forward-missing" || g === "missing")) this.pairEvents.push({ name: g === "missing" ? "PairResultMissing" : "PairForwardMissing", recordDate: D });
    if (commit && this.strayWsolLamports > Z) { this.wsol += this.strayWsolLamports; this.strayWsolLamports = Z; }
    const poolActual = spendablePool(this.feeLamports, this.cfg.reserveLamports, this.wsol + this.strayWsolLamports);
    const basis = this.capLamports !== null && poolActual > this.capLamports ? this.capLamports : poolActual;
    const ruleSpend = buybackSpend(basis, big(r.units), this.cfg.fractionPerUnitBps);
    const carriedIn = this.cfg.carriedSpendLamports;
    const t = ruleSpend + carriedIn;
    const target = t < poolActual ? t : poolActual;
    let spent = Z, got = Z, outcome = "below-floor", carriedOut: bigint;
    const age = Math.floor(this.now() / 1000) - Math.floor((this.readingSubmittedAt.get(D) ?? this.now()) / 1000);
    if (target === Z || target < this.cfg.floorLamports) carriedOut = carriedIn < poolActual ? carriedIn : poolActual;
    else if (this.targetPool !== "ok") {
      if (age < QUEUE_UNBLOCK_SECS) return { err: this.targetPool === "below-floor" ? "TargetPoolBelowFloor" : "TargetPoolUnhealthy" };
      carriedOut = target; // 30 days after the reading: processed below-floor, the whole spend carried
    } else {
      if (this.twap === "unavailable") return { err: "TwapUnavailable" };
      if (this.twap === "deviation") return { err: "TwapDeviation" };
      const cap = reserveSpendCap(this.targetPoolReserveWsol, MAX_SPEND_RESERVE_BPS);
      let spend = target < cap ? target : cap;
      if (basis < spend) spend = basis;
      if (spend === Z || spend < this.cfg.floorLamports) carriedOut = target;
      else { spent = spend; got = (spend * this.targetTokensPerSol) / big(1_000_000_000); outcome = "burned"; carriedOut = target - spend; }
    }
    if (!commit) return { memo: null };
    if (spent > Z) {
      const fromLamports = spent > this.wsol ? spent - this.wsol : Z;
      this.feeLamports -= fromLamports; this.wsol = this.wsol + fromLamports - spent;
    }
    const own = this.feeTokens;
    this.feeTokens = Z; this.supply -= own; this.targetSupply -= got;
    Object.assign(r, { processed: true, outcome, poolLamports: basis, poolActualLamports: poolActual, ruleSpendLamports: ruleSpend, carriedInLamports: carriedIn, carriedOutLamports: carriedOut, spentLamports: spent, got, burned: got, owed: own, pool: bt.pool });
    this.readings.set(D, r);
    this.cfg = { ...this.cfg, crankCursor: D, totalBurned: this.cfg.totalBurned + own, totalSpentLamports: this.cfg.totalSpentLamports + spent, burns: this.cfg.burns + (got > Z || own > Z ? 1 : 0), carriedSpendLamports: carriedOut };
    return { memo: formatTargetMemo({ ...this.head(r), pool: basis.toString(), spent: spent.toString(), got: rawToTokens(got, bt.decimals), burn: rawToTokens(got, bt.decimals), target: bt.mint, own: rawToTokens(own, this.decimals), swap: spent > Z ? bt.pool.slice(0, 12) : "none", version: "v3" }) };
  }

  async simulate(raw: Uint8Array) {
    if (this.simErr) return { err: this.simErr, logs: [`Program log: AnchorError occurred. Error Code: ${this.simErr}.`] };
    const p = this.payloads.get(new TextDecoder().decode(raw));
    if (!p) return { err: "unknown transaction", logs: [] };
    const r = this.execute(p, false);
    return "err" in r ? { err: r.err, logs: [`Program log: AnchorError occurred. Error Code: ${r.err}.`] } : { err: null, logs: [] };
  }
  /** Every signature handed to send(), dropped or not (a signed crank that was only simulated is not here). */
  sent: string[] = [];
  async send(raw: Uint8Array) {
    this.sent.push(new TextDecoder().decode(raw));
    if (this.dropSends) return;
    this.land(new TextDecoder().decode(raw));
  }
  /** Executes a signed transaction now (also: a dropped send that lands late). */
  land(sig: string): void {
    const p = this.payloads.get(sig);
    if (!p || this.landed.has(sig)) return;
    const r = this.execute(p, true);
    this.landed.set(sig, { slot: 1000 + this.n, err: "err" in r ? r.err : null, memo: "err" in r ? null : r.memo, payload: p });
  }
  async confirm(tx: SignedTx): Promise<ConfirmOutcome> {
    const l = this.landed.get(tx.signature);
    if (!l) return { status: "expired" };
    return l.err ? { status: "failed", err: l.err } : { status: "confirmed", slot: l.slot };
  }
  async signatureStatuses(sigs: string[]) { return sigs.map((s) => { const l = this.landed.get(s); return l ? { slot: l.slot, err: l.err, confirmed: true } : null; }); }
  async blockHeight() { return this.height; }
  async memoOf(sig: string) { return this.landed.get(sig)?.memo ?? null; }
  async findCrankTx(D: number): ReturnType<ProgramPort["findCrankTx"]> {
    // a crank, or (winner takes the burn) a forward_to_winner that processed this reading — review RL-1
    for (const [signature, l] of this.landed) {
      if (l.err || (l.payload.kind !== "crank" && l.payload.kind !== "forward") || l.payload.recordDate !== D) continue;
      return { signature, slot: l.slot, memo: l.memo, instruction: fakeInstructionName(l.payload) ?? undefined, forwards: l.payload.kind === "forward" };
    }
    return null;
  }
  /** Someone else cranks the next reading (permissionless). Returns the signature. */
  strangerCrank(): string | null {
    const next = this.nextInLine();
    if (!next) return null;
    const kind = next.units === 0 ? "no_units" : this.cfg.mode === "vault" ? "vault" : this.burnTarget ? "target" : "buyback";
    const sig = `stranger${++this.n}x${this.mint.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "").slice(0, 8)}`.padEnd(32, "Z");
    const payload: Payload = { kind: "crank", crank: kind, recordDate: next.recordDate };
    this.payloads.set(sig, payload);
    this.land(sig);
    return this.landed.get(sig)?.err ? null : sig;
  }
  async claimCreatorFees() {
    if (this.claim instanceof Error) throw this.claim;
    if (typeof this.claim === "function") return this.claim(this);
    return { sent: this.claim.sent ?? [], notes: this.claim.notes ?? [] };
  }
  async checkPoolHealth() {
    this.healthCalls++;
    const now = Math.floor(this.now() / 1000);
    if (!this.poolTradable) {
      // Review-2 F6: a new spell starts when there was none or the previous observation is more than 24 h old.
      const last = this.cfg.poolUntradeableLastSeen;
      const restart = this.cfg.poolUntradeableSince === null || last == null || now - last > UNTRADEABLE_MAX_GAP_SECS;
      this.cfg = { ...this.cfg, poolUntradeableSince: restart ? now : this.cfg.poolUntradeableSince, poolUntradeableLastSeen: now };
    }
    if (this.poolTradable && this.cfg.poolUntradeableSince !== null) this.cfg = { ...this.cfg, poolUntradeableSince: null, poolUntradeableLastSeen: null };
    return { signature: `health${this.healthCalls}`, note: `check_pool_health: pool ${this.cfg.poolUntradeableSince ? "UNTRADEABLE" : "tradeable"}` };
  }
}
