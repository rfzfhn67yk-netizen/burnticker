import crypto from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { CARRY_NONE, MAX_SLIPPAGE_BPS, MAX_TWAP_DEVIATION_BPS, MAX_TWAP_WINDOW_SECS, MODE_BUYBACK, MODE_VAULT, POOL_POLICY_CREATOR_IS_FEE_PDA } from "@/lib/burnReceipts/constants";
import type { RuleParams } from "@/lib/burnReceipts/math";
import { vaultAddress } from "@/lib/burnReceipts/pda";
import { burnPoolFor } from "@/lib/burnKeeper/burnPool";
import { FakeProgram } from "@/lib/burnKeeper/fakeProgram";
import type { ProgramPort } from "@/lib/burnKeeper/programPort";
import { solToLamports } from "@/lib/burnKeeper/rules";
import { DECIMALS, TOTAL_SUPPLY, endSinkOf, ruleMappings, type BurnRule, type RuleMode } from "@/lib/burnticker/rules";
import { FakeLockFees, fakeLockAddress, operatorTreasuryFor, type LockFeesClient } from "@/lib/burnticker/lockFees";
import { FakePairForward, type PairForwardClient } from "@/lib/burnticker/pairForward";
import { FakeEndSink, type EndSinkClient } from "@/lib/burnticker/endSinkClient";

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
  /** The create-time instruction(s): TokenConfig + fee PDA. Unsigned; the creator and the mint keypair sign in the launch bundle. */
  initializeToken(i: InitializeTokenInput): Promise<{ instructions: SerializedIx[]; tokenConfig: string }>;
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
export function endSinkPin(rule: BurnRule | undefined, pairMint: string | null | undefined): { kind: "flagship" | "pair-winner"; minForwardLamports: bigint } | null {
  const k = rule ? endSinkOf(rule) : null;
  if (!k || !rule?.onEnd) return null;
  if (k === "pair-winner" && !pairMint) throw new Error("initialize_token: a winner-takes-the-burn pair coin pins its partner as its end sink, and no partner mint was given");
  return { kind: k, minForwardLamports: BigInt(rule.onEnd.sweepThresholdLamports) };
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
export async function programPageBlock(client: BurnProgramClient, mint: string, lastReading: { date: string; signature: string } | null): Promise<{ config: Awaited<ReturnType<ProgramPort["config"]>>; keeperKeys: string[]; lastReading: { date: string; signature: string } | null } | null> {
  let port: ProgramPort;
  try { port = client.port(mint); } catch { return null; }
  const config = await port.config().catch(() => null);
  return { config, keeperKeys: client.canSign ? port.attesterKeys() : [], lastReading };
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
    if (i.rule) {
      try {
        const c = counterRule(i.rule, i.ticker, i.selectorKey, { floorLamports: this.floorLamports });
        this.tokens.set(i.mint, new FakeProgram({ programId: this.programId, mint: i.mint, feePda: this.feePdaFor(i.mint), configAddress: tokenConfig, mode: i.mode, rulesSha256: i.rulesSha256, feedId: c.feedId, memoPrefix: c.memoPrefix, memoSource: c.memoSource,
          valueDecimals: 0, unitValue: BigInt(1), carryRule: CARRY_NONE, maxAbsDelta: c.rule.max_abs_delta, fractionPerUnitBps: c.rule.fraction_per_unit_bps, floorLamports: c.rule.floor_lamports,
          reserveLamports: c.rule.reserve_lamports, tokensPerUnit: c.rule.tokens_per_unit, vaultAllocation: c.rule.vault_allocation, attesters: i.attesters, quorum: i.quorum, heldKeys: this.heldKeys ?? i.attesters, decimals: DECIMALS, now: () => this.now() }));
        if (i.mode === "buyback" && this.autoRegisterPool) this.tokens.get(i.mint)!.registerPool();
        // §45: the EndSink the rule pins (the program refuses one on the flagship itself)
        const pin = endSinkPin(i.rule, i.pairMint);
        if (pin && this.pinEndSinks && i.mint !== this.endSink.flagship) this.endSink.port(i.mint).pinned = { kind: pin.kind, sinkMint: pin.kind === "pair-winner" ? i.pairMint! : this.endSink.flagship, minForwardLamports: pin.minForwardLamports };
        this.lockFees.port(i.mint).memoPrefix = c.memoPrefix;
        // round 2: register_pool runs after register_fee_key through the lock path; it registers the pool on the coin's fake program too
        this.lockFees.port(i.mint).onRegisterPool = () => { const f = this.tokens.get(i.mint); if (f && !f.cfg.poolRegistered) f.registerPool(); };
      } catch { /* not expressible: no on-chain config (the keeper reports why) */ }
    }
    return { tokenConfig, instructions: [{ programId: this.programId, label: "burn_receipts.initialize_token (placeholder program id — nothing is sent)", keys: [{ pubkey: i.creator, isSigner: true, isWritable: true }, { pubkey: i.mint, isSigner: true, isWritable: false }, { pubkey: tokenConfig, isSigner: false, isWritable: true }, { pubkey: this.feePdaFor(i.mint), isSigner: false, isWritable: true }], dataBase64: Buffer.from(JSON.stringify({ ix: "initialize_token", rulesSha256: i.rulesSha256, selectorKey: i.selectorKey, mode: i.mode, quorum: i.quorum, attesters: i.attesters }), "utf8").toString("base64") }] };
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
}
