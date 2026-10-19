import crypto from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { CARRY_NONE, MAX_SLIPPAGE_BPS, MAX_TWAP_DEVIATION_BPS, MAX_TWAP_WINDOW_SECS, MODE_BUYBACK, MODE_VAULT, POOL_POLICY_CREATOR_IS_FEE_PDA } from "@/lib/burnReceipts/constants";
import type { RuleParams } from "@/lib/burnReceipts/math";
import { vaultAddress } from "@/lib/burnReceipts/pda";
import { burnPoolFor } from "@/lib/burnKeeper/burnPool";
import { FakeProgram } from "@/lib/burnKeeper/fakeProgram";
import type { ProgramPort } from "@/lib/burnKeeper/programPort";
import { solToLamports } from "@/lib/burnKeeper/rules";
import { DECIMALS, INCINERATOR_ADDRESS, TOTAL_SUPPLY, endSinkOf, ruleMappings, type BurnRule, type RuleMode } from "@/lib/burnticker/rules";
import { FakeLockFees, fakeLockAddress, operatorTreasuryFor, type LockFeesClient } from "@/lib/burnticker/lockFees";
import { FakePairForward, type PairForwardClient } from "@/lib/burnticker/pairForward";
import { FakeEndSink, type EndSinkClient } from "@/lib/burnticker/endSinkClient";
import { endSinkKindCode } from "@/lib/burnReceipts/endSink";

/**
 * THE RECEIPTS PROGRAM, FROM THE BURNTICKER KEEPER'S SIDE (2026-10-10). Every registered token runs on the deployed burn_receipts
 * program (programs/burn-receipts): the program holds the token's fee PDA (the burn pool), counts units from attested readings, swaps
 * and burns in one permissionless crank, and writes the memo. This file is the client the multi-token keeper, the launch bundle and
 * the pages code against:
 *
 *   ProgramBurnClient  the real one (programClient.ts — kept out of this file so the public SDK's import closure stays clear of the
 *                      keeper's program path), over src/lib/burnReceipts (initialize_token for the launch bundle; per-token ProgramPorts from
 *                      src/lib/burnKeeper/programAdapter.ts for readings and cranks; balances; the audit's memo lookup). Without a
 *                      payer key it is READ-ONLY (the app server): it can read and display, never sign.
 *   FakeBurnProgram    the same interface over FakeProgram (src/lib/burnKeeper/fakeProgram.ts) — the program in memory, for the tests
 *                      and for pages before a deployment exists (placeholder program id; nothing is sent).
 *
 * HOW AN EVENT RULE BECOMES A PROGRAM READING — the UNIT COUNTER (docs/burnkeeper/README-execution.md §Burnticker). The program's
 * reading model is one value per UTC date, units = floor(delta / unit_value), one fraction (or token count) per unit. A Burnticker rule
 * reads settled events (Kalshi markets, feeds) whose units the keeper's unit engine computes from the published rule. So each token's
 * TokenConfig is initialised with value_decimals 0, unit_value 1, carry none, and the attested value is a COUNTER:
 *   value(D) = 1 + every unit the token's settled receipts carried through reading date D   (1 = "no units yet"; the program refuses 0)
 * — the day's delta is exactly the day's units, so the program spends pool × (1 − (1 − f)^units) (or burns units × tokens) for all of
 * the day's events in one crank. The signed source hash commits to the exact event ids counted (`burnticker://<TICKER>/units/<date>
 * ?events=<id,id,…>`), so anyone can recompute the counter from the public settlements and rules.json.
 *
 * Expressible: rules whose mappings all carry the SAME fraction (buyback) or the SAME token count (vault) — onYes-only, onNo-only,
 * rivalry sides, scalars with one perUnit. NOT expressible on the current program: a rule paying different fractions per outcome
 * (onYes 2 % and onNo 1 %) — `counterRule` refuses it with that reason (it needs per-outcome readings, a program change).
 */

/**
 * What confirming a signed transaction came to. Structurally identical to burnKeeper/cycle.ts's ConfirmOutcome (a compile-time check in
 * test/burntickerSdkLeak.test.ts keeps the two mutually assignable); declared here so the public SDK's import closure does not pull
 * the $DEFICIT keeper's cycle, ledger and feeds.
 */
export type ConfirmOutcome = { status: "confirmed"; slot: number | null } | { status: "failed"; err: string } | { status: "expired" };

/** The fake's flagship ($DEFICIT stand-in): a test that exercises end sinks initialises a coin at this mint. */
export const FAKE_FLAGSHIP_MINT = new PublicKey(crypto.createHash("sha256").update("burnticker fake flagship").digest()).toBase58();
export const PLACEHOLDER_PROGRAM_ID = new PublicKey(crypto.createHash("sha256").update("burn_receipts placeholder program id — not deployed").digest());

export interface SerializedIx { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; dataBase64: string; label: string }

export interface InitializeTokenInput {
  mint: string; creator: string; ticker: string; rulesSha256: string; selectorKey: string; mode: RuleMode;
  attesters: string[]; quorum: number;
  /** Vault mode: the LaunchLab vesting beneficiary = the program's vault for the mint. */
  vault: string | null;
  /** The locked rule (the counter mapping needs its fractions / token counts). */
  rule?: BurnRule;
  /** Winner takes the burn: the partner coin's mint (initialize_token's pair_mint; the first coin is provisional for 7 days). */
  pairMint?: string | null;
  /** The second coin of a pair: the partner's TokenConfig exists, so this initialize_token completes the pairing. */
  partnerFirst?: boolean;
  /** r3 (RN-2): with pairMint, the pair's locked voidBy as YYYYMMDD — the rules' pair.voidBy, the same on both coins (InvalidPairVoidBy otherwise). */
  pairVoidBy?: number;
}

export interface BurnProgramClient {
  programId: string;
  cluster: string;
  /** False for a read-only client (no payer key): ports can read, never sign. */
  readonly canSign: boolean;
  /**
   * Second audit 2026-10-19 I-15: what this host encodes into every initialize_token, read-only, so a draft prepared before expectations
   * were stored is still compared on these (admission.ts fallbackExpectedConfig). The config authority (BURNTICKER_ADMIN) and the
   * LaunchLab platform the client names. Absent or null: not known here (a fake, or a client built without them).
   */
  readonly adminKey?: string | null;
  readonly launchLabPlatformKey?: string | null;
  /** The create-time instruction(s): TokenConfig + fee PDA. Unsigned; the creator and the mint keypair sign in the launch bundle. */
  /**
   * `expected` (audit F01, 2026-10-19): the TokenConfig the instructions encode, field by field (admission.ts). The confirm step and the
   * keeper compare the chain against it, so an edited unsigned transaction (another fraction, reserve, attester, admin…) is refused.
   */
  initializeToken(i: InitializeTokenInput): Promise<{ instructions: SerializedIx[]; tokenConfig: string; expected?: ExpectedTokenConfig }>;
  feePdaFor(mint: string): string;
  vaultFor(mint: string): string;
  feePdaBalanceLamports(mint: string): Promise<bigint>;
  vaultBalanceRaw(mint: string): Promise<bigint>;
  supplyRaw(mint: string): Promise<bigint | null>;
  /** The program path for one token: readings, cranks, claims, pool health (src/lib/burnKeeper/programChain.ts ProgramPort). */
  port(mint: string): ProgramPort;
  /** A confirmed program transaction for this mint whose memo starts with `key` (the audit), or null. */
  findReceiptOnChain(mint: string, key: string): Promise<{ signature: string; slot: number | null; memo: string } | null>;
  /**
   * The burn program's memo in one transaction (the audit reads a receipt's own signature; review of A-6, 2026-10-18): null when the
   * transaction is not found; `memo: null` when it landed with no program memo; `failed` when it landed with an error.
   */
  memoOfTransaction?(signature: string): Promise<{ memo: string | null; slot: number | null; failed: boolean } | null>;
  /**
   * I-14 (audit 2026-10-19): the coin's BurnTarget as the chain holds it (null = no account), so the keeper compares it with the prepare's
   * expectation before a target crank (admissionAccounts.ts burnTargetMismatch). Optional: a client without it skips that check.
   */
  burnTargetOf?(mint: string): Promise<{ mint: string; targetMint: string; pool: string; feedId: string; repins: number } | null>;
  /**
   * LP LOCKED FOREVER (2026-10-10, lockFees.ts): the claim_lock_fees path — the locked LP's Fee Key at the program's fee-keys PDA and
   * the permissionless 80/20 claim. Optional: absent until the program change is bound, and the keeper then skips the claim crank.
   */
  readonly lockFees?: LockFeesClient;
  /**
   * WINNER TAKES THE BURN (2026-10-11, pairForward.ts): pair links, per-period PairResults (submit_pair_result) and forward_to_winner.
   * Optional: absent until the program change is bound; the keeper then plans no forwards (each coin burns its own fuel).
   */
  readonly pairForward?: PairForwardClient;
  /**
   * END SINKS (LAUNCHPAD-PATH §45, endSinkClient.ts): EndSink / RuleEnd reads, submit_rule_end and forward_on_end. Optional: absent on
   * a client bound to a program without round 4; the keeper then keeps the wind-down for every end.
   */
  readonly endSink?: EndSinkClient;
}

/**
 * The EndSink a rule pins at initialize_token (rules.ts endSinkOf), or null: FLAGSHIP for a single coin, PAIR_WINNER for a
 * winner-takes-the-burn pair coin (the partner = `pairMint`; a pair without one is refused), nothing for a rule without `onEnd.endSink`
 * or in vault mode. The minimum forward is the rule's onEnd.sweepThresholdLamports.
 */
export function endSinkPin(rule: BurnRule | undefined, pairMint: string | null | undefined): { kind: "flagship" | "pair-winner" | "mint" | "incinerator"; sinkMint?: string; minForwardLamports: bigint } | null {
  const k = rule ? endSinkOf(rule) : null;
  if (!k || !rule?.onEnd) return null;
  if (k === "pair-winner" && !pairMint) throw new Error("initialize_token: a winner-takes-the-burn pair coin pins its partner as its end sink, and no partner mint was given");
  // the named-coin sink (end.rs END_SINK_MINT): the coin the creator picked; the program refuses the coin itself
  if (k === "mint") return { kind: k, sinkMint: rule.onEnd.mint!, minForwardLamports: BigInt(rule.onEnd.sweepThresholdLamports) };
  return { kind: k, minForwardLamports: BigInt(rule.onEnd.sweepThresholdLamports) };
}

/**
 * WHAT initialize_token LOCKS, FIELD BY FIELD (audit F01, 2026-10-19; checked in admission.ts). JSON-safe: amounts as decimal strings,
 * keys in base58. A `null` field is not known to the host (a draft prepared before expectations were stored: admission.ts
 * fallbackExpectedConfig) and is not compared. Declared here, not in admission.ts, so the public SDK's import closure (this file) stays
 * clear of the registry.
 */
export interface ExpectedTokenConfig {
  version: 1;
  /** Rebuilt from the locked rule (no stored expectation): null fields are skipped. */
  fallback?: true;
  feedId: string; memoPrefix: string; memoSource: string | null; rulesSha256: string;
  rule: {
    mode: number; carryRule: number; poolPolicy: number; valueDecimals: number; unitValue: string; maxAbsDelta: string;
    fractionPerUnitBps: number; slippageBps: number; maxTwapDeviationBps: number; twapWindowSecs: number;
    floorLamports: string | null; reserveLamports: string; tokensPerUnit: string; vaultAllocation: string;
  };
  /** Floors an earlier prepare of the same draft locked (a retry prices the floor again): any of them, or rule.floorLamports, passes. */
  acceptedFloorLamports?: string[];
  /** The attester keys in order, and the quorum. */
  attesters: string[] | null; quorum: number | null;
  /** The config authority (the Squads vault). */
  admin: string | null;
  /** The LaunchLab platform the program pins (buyback coins under policy 0 or 2); null = not compared. */
  llPlatform: string | null;
  /** The end sink initialize_token pins (held in the EndSink account, not the TokenConfig). */
  endSink: { kind: number; mint: string | null; minLamports: string } | null;
  pairVoidBy: number | null;
  /** 0 the coin burns itself; 1 a pinned target (the program may move it to 2 once the target's pool is verified). */
  burnTargetKind: number;
  /**
   * I-14 (audit 2026-10-19): the token, pool and Pyth feed pin_burn_target pins beside initialize_token (the BurnTarget account, compared
   * by admissionAccounts.ts). Absent on expectations stored before this was recorded: then only burnTargetKind is compared.
   */
  burnTarget?: { mint: string; pool: string; feedId: string } | null;
  /**
   * B-1 (third audit 2026-10-19): the LaunchLab initialize_v2 arguments and venue accounts the bundle encoded (launchCreateArgs.ts
   * expectedCreateFromBundle), compared by the confirm step with the create that landed. Absent on expectations stored before this was
   * recorded: then admission.ts expectedConfigFor fills it from what the draft row and the bundle recipe fix (fallback: true).
   */
  launchCreate?: ExpectedLaunchCreate | null;
}

/**
 * WHAT THE LAUNCHLAB CREATE WRITES (B-1, third audit 2026-10-19): Raydium LaunchLab initialize_v2's arguments and the accounts that
 * place the coin (global config, platform, pool, quote mint). JSON-safe: amounts as decimal strings, keys in base58. A `null` field is
 * not known for this draft and is not compared (a fallback for a draft prepared before the arguments were stored).
 */
export interface ExpectedLaunchCreate {
  version: 1;
  /** Rebuilt from the draft row and the bundle recipe (no stored arguments). */
  fallback?: true;
  decimals: number; name: string | null; symbol: string | null; uri: string | null;
  /** 0 = the constant-product curve the site always builds. */
  curveIndex: number; supply: string; totalSellA: string | null; totalFundRaisingB: string | null; migrateType: number;
  /** Fallback only (the raise is not stored on the draft row): the raises this site could have built for the draft's network. */
  raise?: { minLamports: string; maxLamports: string; presetsLamports: string[] | null } | null;
  totalLockedAmount: string | null; cliffPeriod: string | null; unlockPeriod: string | null; cpmmCreatorFeeOn: number;
  globalConfig: string | null; platform: string | null; poolId: string | null; quoteMint: string;
}

/** An ExpectedTokenConfig from the counter rule and the rest of initialize_token's arguments (programClient.ts, the fake). */
export function expectedFromCounter(c: CounterRule, o: { rulesSha256: string; attesters: string[] | null; quorum: number | null; admin: string | null; llPlatform: string | null; endSink: ExpectedTokenConfig["endSink"]; pairVoidBy: number | null; burnTargetKind: number; burnTarget?: ExpectedTokenConfig["burnTarget"]; floorKnown?: boolean }): ExpectedTokenConfig {
  const r = c.rule;
  return {
    version: 1, feedId: c.feedId, memoPrefix: c.memoPrefix, memoSource: c.memoSource, rulesSha256: o.rulesSha256.toLowerCase(),
    rule: { mode: r.mode, carryRule: r.carry_rule, poolPolicy: r.pool_policy, valueDecimals: r.value_decimals, unitValue: r.unit_value.toString(), maxAbsDelta: r.max_abs_delta.toString(),
      fractionPerUnitBps: r.fraction_per_unit_bps, slippageBps: r.slippage_bps, maxTwapDeviationBps: r.max_twap_deviation_bps, twapWindowSecs: r.twap_window_secs,
      floorLamports: o.floorKnown === false ? null : r.floor_lamports.toString(), reserveLamports: r.reserve_lamports.toString(), tokensPerUnit: r.tokens_per_unit.toString(), vaultAllocation: r.vault_allocation.toString() },
    attesters: o.attesters ? [...o.attesters] : null, quorum: o.quorum, admin: o.admin, llPlatform: o.llPlatform, endSink: o.endSink, pairVoidBy: o.pairVoidBy, burnTargetKind: o.burnTargetKind,
    ...(o.burnTarget ? { burnTarget: { ...o.burnTarget } } : {}),
  };
}

/** The selector key the launch bundle names in the counter's memo source (it differs from registry.selectorKeyOf for a Kalshi series). */
export function bundleSelectorKey(rule: BurnRule): string {
  return rule.oracle === "derby" ? `derby:${rule.series}` : rule.oracle === "catalogue" ? `catalogue:${rule.series}`
    : rule.oracle === "polymarket" ? (rule.market ? `polymarket:market:${rule.market}` : `polymarket:${rule.series}:${rule.kind}`)
    : rule.market ? `kalshi:market:${rule.market}` : `kalshi:${rule.series}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The counter mapping
// ---------------------------------------------------------------------------------------------------------------------------------

/** The counter's value with no units yet (the program refuses a zero value). */
export const COUNTER_BASE = BigInt(1);
export const COUNTER_FEED_PREFIX = "bt.units:";

export interface CounterRule { feedId: string; memoPrefix: string; memoSource: string; rule: RuleParams }

/** Why this rule cannot run on the current program (null = expressible). */
export function programExpressible(rule: BurnRule, ticker: string): string | null {
  try { counterRule(rule, ticker, "x", { floorLamports: BigInt(0) }); return null; } catch (e) { return (e as Error).message; }
}

/**
 * The TokenConfig a Burnticker token is initialised with (see the header). `floorLamports` is the rule's USD floor priced in SOL at
 * launch (the program cannot read a USD price) — disclosed in the bundle notes.
 */
/**
 * Swap-safety defaults for a counter token: the program's recommended setting (docs/burn-receipts/README.md §1: window 1,200 s,
 * deviation 300, slippage 300 — the most headroom initialize_token accepts). The old 500 bps default exceeded the program's
 * MAX_TWAP_DEVIATION_BPS, so initialize_token refused it with InvalidRule.
 */
export const COUNTER_DEFAULT_TWAP_DEVIATION_BPS = MAX_TWAP_DEVIATION_BPS;
export const COUNTER_DEFAULT_SLIPPAGE_BPS = MAX_SLIPPAGE_BPS;
export const COUNTER_DEFAULT_TWAP_WINDOW_SECS = MAX_TWAP_WINDOW_SECS;

export function counterRule(rule: BurnRule, ticker: string, selectorKey: string, o: { floorLamports: bigint; maxTwapDeviationBps?: number; twapWindowSecs?: number; slippageBps?: number }): CounterRule {
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`ticker ${ticker} cannot be the program's memo prefix (2–12 of A–Z, 0–9)`);
  const maps = ruleMappings(rule).map((m) => m.mapping);
  if (!maps.length) throw new Error("the rule maps no outcome to a burn");
  const fractions = new Set(maps.map((m) => m.fractionOfPool).filter((f) => f !== undefined));
  const tokens = new Set(maps.map((m) => m.tokens).filter((t) => t !== undefined));
  const buyback = fractions.size > 0;
  if (buyback && tokens.size) throw new Error("the rule mixes buyback and vault mappings");
  if (fractions.size > 1) throw new Error(`the rule maps outcomes to different fractions of the pool (${[...fractions].join(", ")}) — the program has one fraction per unit; not expressible until per-outcome readings exist`);
  if (tokens.size > 1) throw new Error(`the rule maps outcomes to different token counts (${[...tokens].join(", ")}) — the program has one count per unit; not expressible until per-outcome readings exist`);
  let bps = 0;
  if (buyback) {
    const f = [...fractions][0]!;
    bps = Math.round(f * 10_000);
    if (Math.abs(bps - f * 10_000) > 1e-6 || bps < 1 || bps > 10_000) throw new Error(`fraction ${f} is not a whole number of basis points`);
  }
  const scale = BigInt(10) ** BigInt(DECIMALS);
  const share = rule.vault?.share ?? 0;
  return {
    feedId: `${COUNTER_FEED_PREFIX}${ticker}`,
    memoPrefix: ticker,
    memoSource: `burnticker ${selectorKey}`.replace(/[^\x20-\x7e]|\|/g, "").slice(0, 64),
    rule: {
      mode: buyback ? MODE_BUYBACK : MODE_VAULT, carry_rule: CARRY_NONE, pool_policy: POOL_POLICY_CREATOR_IS_FEE_PDA, value_decimals: 0,
      unit_value: BigInt(1), max_abs_delta: BigInt(1_000_000),
      fraction_per_unit_bps: bps, slippage_bps: buyback ? o.slippageBps ?? COUNTER_DEFAULT_SLIPPAGE_BPS : 0,
      max_twap_deviation_bps: buyback ? o.maxTwapDeviationBps ?? COUNTER_DEFAULT_TWAP_DEVIATION_BPS : 0,
      twap_window_secs: buyback ? o.twapWindowSecs ?? COUNTER_DEFAULT_TWAP_WINDOW_SECS : 0,
      floor_lamports: buyback ? o.floorLamports : BigInt(0), reserve_lamports: buyback ? solToLamports(rule.reserveSol) : BigInt(0),
      tokens_per_unit: buyback ? BigInt(0) : BigInt([...tokens][0]!) * scale,
      vault_allocation: buyback ? BigInt(0) : ((BigInt(TOTAL_SUPPLY) * BigInt(Math.round(share * 100))) / BigInt(100)) * scale,
    },
  };
}

/** The source the counter's attestation commits to: the exact event ids counted into the reading for `date` (YYYY-MM-DD). */
export const counterSourceUrl = (ticker: string, date: string, eventIds: readonly string[]): string => `burnticker://${ticker}/units/${date}?events=${eventIds.join(",")}`;

/** What the token page shows about the program for one mint (TokenPageInput.chain.program); null when the client has no config for it. */
export async function programPageBlock(client: BurnProgramClient, mint: string, lastReading: { date: string; signature: string } | null, /** burn dispersal lines (dispersalKeeper.ts dispersalLines) */ dispersal?: readonly string[]): Promise<{ config: Awaited<ReturnType<ProgramPort["config"]>>; keeperKeys: string[]; lastReading: { date: string; signature: string } | null; dispersal?: readonly string[] } | null> {
  let port: ProgramPort;
  try { port = client.port(mint); } catch { return null; }
  const config = await port.config().catch(() => null);
  return { config, keeperKeys: client.canSign ? port.attesterKeys() : [], lastReading, ...(dispersal && dispersal.length ? { dispersal } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The fake
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * THE FAKE: one FakeProgram per initialised mint (the program in memory). Knobs live on each token's FakeProgram (`fake(mint)`):
 * dropSends, simErr, twap, poolTradable, registerPool(), deposit(), vaultTokens. The keeper's attester keys are the ones the token
 * was initialised with unless `heldKeys` says otherwise.
 */
export class FakeBurnProgram implements BurnProgramClient {
  readonly programId = PLACEHOLDER_PROGRAM_ID.toBase58();
  readonly cluster: string;
  readonly canSign = true;
  tokens = new Map<string, FakeProgram>();
  initialised: InitializeTokenInput[] = [];
  heldKeys: string[] | null = null;
  floorLamports = BigInt(6_666_667);   // $1 at $150/SOL
  /** The fake registers each buyback token's CPMM pool at init so the crank path runs; false exercises "waiting for the pool". */
  autoRegisterPool = true;
  now: () => number = () => Date.now();
  /** The locked-LP fee claims in memory (lockFees.ts FakeLockFees): a claim's 80 % lands in the coin's fake fee PDA. */
  readonly lockFees: FakeLockFees;
  /** The pair rules in memory (pairForward.ts FakePairForward): results, forwards and each paired coin's crank gate. */
  readonly pairForward: FakePairForward;
  /** End sinks in memory (endSinkClient.ts FakeEndSink); the flagship is FAKE_FLAGSHIP_MINT unless a test initialises another. */
  readonly endSink: FakeEndSink;
  /**
   * Does the fake model a round-4 program (initialize_token pins the rule's EndSink)? Off by default: the fake then behaves as a program
   * without end sinks (nothing pinned; the keeper winds every end down), the path every coin launched before §45 keeps. The real client's
   * counterpart is BURNTICKER_END_SINKS_LIVE (programClient.ts), which refuses instead of launching a coin whose sink was not pinned.
   */
  pinEndSinks = false;
  constructor(cluster = "localnet", flagship = FAKE_FLAGSHIP_MINT) {
    this.cluster = cluster; this.pairForward = new FakePairForward((m) => this.fake(m), () => this.now());
    this.endSink = new FakeEndSink(flagship, (m) => this.fake(m), () => this.now());
    this.endSink.partnerWon = (m, partner, date) => { const p = this.pairForward.port(m, partner); return p.paired && p.results.get(date)?.winner === partner; }; this.lockFees = new FakeLockFees(this.programId, cluster, operatorTreasuryFor(cluster) ?? fakeLockAddress("fake operator treasury"), (mint, l) => { this.tokens.get(mint)?.deposit(l); }); }

  /** Creator fees / a seed arriving in the token's fee PDA. */
  deposit(mint: string, lamports: bigint): void { this.fake(mint).deposit(lamports); }
  /** Vested tokens arriving in the token's program vault (vault mode). */
  fund(mint: string, raw: bigint): void { this.fake(mint).vaultTokens += raw; }
  /** The mint's supply as the fake chain reports it. */
  readonly supplies = { set: (mint: string, raw: bigint) => { this.fake(mint).supply = raw; }, get: (mint: string) => this.tokens.get(mint)?.supply };

  fake(mint: string): FakeProgram {
    const f = this.tokens.get(mint);
    if (!f) throw new Error(`fake program: ${mint} was never initialised`);
    return f;
  }
  async initializeToken(i: InitializeTokenInput) {
    // r3: the program refuses a pairing without a valid voidBy (InvalidPairVoidBy) — the fake too
    if (i.pairMint && !(i.pairVoidBy && i.pairVoidBy > 20000101)) throw new Error("InvalidPairVoidBy: a paired initialize_token needs the pair's voidBy (YYYYMMDD)");
    this.initialised.push(i);
    const tokenConfig = burnPoolFor(PLACEHOLDER_PROGRAM_ID, new PublicKey(i.mint)).config.toBase58();
    let expected: ExpectedTokenConfig | undefined;
    if (i.rule) {
      try {
        const c = counterRule(i.rule, i.ticker, i.selectorKey, { floorLamports: this.floorLamports });
        // F01: what the fake "encodes" (no admin or platform in memory: not compared)
        const bt = (i.rule as { burnTarget?: { mint: string; pool: string; feedId: string } }).burnTarget;
        // §45: the EndSink the rule pins (the program refuses one on the flagship itself)
        // (a refusal is raised where it always was: after the coin's fake program exists)
        let pinError: unknown = null, pin: ReturnType<typeof endSinkPin> = null;
        try { pin = endSinkPin(i.rule, i.pairMint); } catch (e) { pinError = e; }
        const pinned = pin && this.pinEndSinks && i.mint !== this.endSink.flagship ? { kind: pin.kind, sinkMint: pin.kind === "pair-winner" ? i.pairMint! : pin.kind === "mint" ? pin.sinkMint! : pin.kind === "incinerator" ? INCINERATOR_ADDRESS : this.endSink.flagship, minForwardLamports: pin.minForwardLamports } : null;
        expected = expectedFromCounter(c, { rulesSha256: i.rulesSha256, attesters: i.attesters, quorum: i.quorum, admin: null, llPlatform: null,
          endSink: pinned ? { kind: endSinkKindCode(pinned.kind), mint: pinned.sinkMint, minLamports: pinned.minForwardLamports.toString() } : null, pairVoidBy: i.pairMint ? i.pairVoidBy ?? null : 0, burnTargetKind: bt ? 1 : 0,
          ...(bt ? { burnTarget: { mint: bt.mint, pool: bt.pool, feedId: bt.feedId } } : {}) });
        this.tokens.set(i.mint, new FakeProgram({ programId: this.programId, mint: i.mint, feePda: this.feePdaFor(i.mint), configAddress: tokenConfig, mode: i.mode, rulesSha256: i.rulesSha256, feedId: c.feedId, memoPrefix: c.memoPrefix, memoSource: c.memoSource,
          valueDecimals: 0, unitValue: BigInt(1), carryRule: CARRY_NONE, maxAbsDelta: c.rule.max_abs_delta, fractionPerUnitBps: c.rule.fraction_per_unit_bps, floorLamports: c.rule.floor_lamports,
          reserveLamports: c.rule.reserve_lamports, tokensPerUnit: c.rule.tokens_per_unit, vaultAllocation: c.rule.vault_allocation, attesters: i.attesters, quorum: i.quorum, heldKeys: this.heldKeys ?? i.attesters, decimals: DECIMALS, now: () => this.now() }));
        if (i.mode === "buyback" && this.autoRegisterPool) this.tokens.get(i.mint)!.registerPool();
        if (pinError) throw pinError;
        if (pinned) this.endSink.port(i.mint).pinned = pinned;
        this.lockFees.port(i.mint).memoPrefix = c.memoPrefix;
        // round 2: register_pool runs after register_fee_key through the lock path; it registers the pool on the coin's fake program too
        this.lockFees.port(i.mint).onRegisterPool = () => { const f = this.tokens.get(i.mint); if (f && !f.cfg.poolRegistered) f.registerPool(); };
      } catch { /* not expressible: no on-chain config (the keeper reports why) */ }
    }
    return { tokenConfig, ...(expected ? { expected } : {}), instructions: [{ programId: this.programId, label: "burn_receipts.initialize_token (placeholder program id — nothing is sent)", keys: [{ pubkey: i.creator, isSigner: true, isWritable: true }, { pubkey: i.mint, isSigner: true, isWritable: false }, { pubkey: tokenConfig, isSigner: false, isWritable: true }, { pubkey: this.feePdaFor(i.mint), isSigner: false, isWritable: true }], dataBase64: Buffer.from(JSON.stringify({ ix: "initialize_token", rulesSha256: i.rulesSha256, selectorKey: i.selectorKey, mode: i.mode, quorum: i.quorum, attesters: i.attesters }), "utf8").toString("base64") }, ...fakePin(this.programId, i)] };
  }
  /** The real program's seeds (src/lib/burnReceipts/pda.ts via burnPoolFor) under the placeholder id. */
  feePdaFor(mint: string) { return burnPoolFor(PLACEHOLDER_PROGRAM_ID, new PublicKey(mint)).feePda.toBase58(); }
  vaultFor(mint: string) { return vaultAddress(PLACEHOLDER_PROGRAM_ID, new PublicKey(mint)).toBase58(); }
  async feePdaBalanceLamports(mint: string) { return this.tokens.get(mint)?.feeLamports ?? BigInt(0); }
  async vaultBalanceRaw(mint: string) { return this.tokens.get(mint)?.vaultTokens ?? BigInt(0); }
  async supplyRaw(mint: string) { return this.tokens.get(mint)?.supply ?? null; }
  port(mint: string): ProgramPort { return this.fake(mint); }
  async findReceiptOnChain(mint: string, key: string) {
    const f = this.tokens.get(mint);
    if (!f) return null;
    for (const [signature, l] of f.landed) if (!l.err && l.memo && l.memo.startsWith(key)) return { signature, slot: l.slot, memo: l.memo };
    return null;
  }
  async memoOfTransaction(signature: string) {
    for (const f of this.tokens.values()) { const l = f.landed.get(signature); if (l) return { memo: l.memo ?? null, slot: l.slot ?? null, failed: !!l.err }; }
    return null;
  }
}

/**
 * Round 5: the fake's placeholder pin_burn_target for a rule with a pinned token (the real client's comes from programClient.ts), so the
 * bundle's two-transaction shape (launchBundle.ts launchTransactions) is the same under the fake. Nothing is sent.
 */
function fakePin(programId: string, i: InitializeTokenInput): SerializedIx[] {
  const bt = (i.rule as { burnTarget?: { mint: string; pool: string; symbol: string; feedId: string } } | undefined)?.burnTarget;
  if (!bt) return [];
  return [{ programId, label: `burn_receipts.pin_burn_target (placeholder program id; ${bt.symbol} ${bt.mint} on pool ${bt.pool} — nothing is sent)`, keys: [{ pubkey: i.creator, isSigner: true, isWritable: true }, { pubkey: i.mint, isSigner: true, isWritable: false }, { pubkey: bt.mint, isSigner: false, isWritable: false }, { pubkey: bt.pool, isSigner: false, isWritable: false }], dataBase64: Buffer.from(JSON.stringify({ ix: "pin_burn_target", feedId: bt.feedId }), "utf8").toString("base64") }];
}
