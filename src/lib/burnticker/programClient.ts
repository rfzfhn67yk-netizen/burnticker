import { type Connection, type Keypair, PublicKey } from "@solana/web3.js";
import { fetchTokenConfig } from "@/lib/burnReceipts/accounts";
import { BURNTICKER_PLATFORM as PROGRAM_BURNTICKER_PLATFORM, MODE_BUYBACK } from "@/lib/burnReceipts/constants";
import { memoFromTransaction } from "@/lib/burnReceipts/crank";
import { initializeTokenIx, initializeTokenLayoutFromEnv, operatorAttester } from "@/lib/burnReceipts/instructions";
import { configPda, vaultAddress } from "@/lib/burnReceipts/pda";
import { burnPoolFor } from "@/lib/burnKeeper/burnPool";
import { assertSolUsd } from "@/lib/burnKeeper/rules";
import type { ProgramPort } from "@/lib/burnKeeper/programPort";
import { programClusterOf, solanaProgramPort } from "@/lib/burnKeeper/programAdapter";
import type { Cluster } from "@/lib/burnKeeper/solana";
import { counterRule, endSinkPin, type BurnProgramClient, type InitializeTokenInput, type SerializedIx } from "@/lib/burnticker/program";
import { ChainEndSink } from "@/lib/burnticker/endSinkChain";
import { endSinkKindCode } from "@/lib/burnReceipts/endSink";
import { ChainLockFees } from "@/lib/burnticker/lockFeesChain";
import { ChainPairForward } from "@/lib/burnticker/pairForwardChain";
import { dateU32 } from "@/lib/burnticker/pairForward";
import { checkTargetAdmission, pinBurnTargetIx } from "@/lib/burnReceipts/burnTarget";

/**
 * THE REAL burn_receipts CLIENT FOR BURNTICKER (2026-10-10) — see program.ts for the interface and the unit counter. Per-token
 * ProgramPorts come from src/lib/burnKeeper/programAdapter.ts; without a payer key the client is READ-ONLY (the app server). Not part of
 * the public SDK's import closure (it reaches the keeper's program path).
 */

export interface ProgramBurnClientOpts {
  connection: Connection;
  programId: PublicKey;
  cluster: Cluster;
  /** Pays every fee and signs readings as the attester (normally the keeper key). Null = read-only (the app server). */
  payer: Keypair | null;
  /** Attester keys (default: [payer]). Quorum 1 until the client's v0 / shared-message layout lands (programAdapter.ts). */
  attesters?: Keypair[];
  /** The config authority every TokenConfig names (the Squads vault). Needed only to build initialize_token. */
  admin: PublicKey | null;
  /** The rule's USD floor → lamports at launch (the program has no USD price). */
  solUsd: () => Promise<number>;
  allowMainnet?: boolean;
  launchLabProgram?: PublicKey | null;
  /** The LaunchLab platform initialize_token names (BURNTICKER_PLATFORM_ID); default = the BURNTICKER_PLATFORM pin compiled for the cluster. */
  launchLabPlatform?: PublicKey | null;
  cpmmProgram?: PublicKey | null;
  log?: (s: string) => void;
  /**
   * END SINKS (LAUNCHPAD-PATH §45): true once the program this host talks to runs round 4 (submit_rule_end / forward_on_end). Until then
   * initialize_token refuses a rule with onEnd.endSink rather than launch a coin whose description promises a sink the program would not
   * pin. Default: BURNTICKER_END_SINKS_LIVE (off unless 1/true/yes/on).
   */
  endSinksLive?: boolean;
}
export const END_SINKS_LIVE_FLAG = "BURNTICKER_END_SINKS_LIVE";
export const endSinksLiveFromEnv = (env: Record<string, string | undefined> = process.env): boolean => /^(1|true|yes|on)$/i.test((env[END_SINKS_LIVE_FLAG] ?? "").trim());

const serialize = (ix: { programId: PublicKey; keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]; data: Buffer }, label: string): SerializedIx =>
  ({ programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), dataBase64: Buffer.from(ix.data).toString("base64"), label });

export class ProgramBurnClient implements BurnProgramClient {
  readonly programId: string;
  readonly cluster: string;
  readonly canSign: boolean;
  private readonly o: ProgramBurnClientOpts;
  private ports = new Map<string, ProgramPort>();
  /** LP locked forever (2026-10-10): register_fee_key / claim_lock_fees and the lock reads (lockFeesChain.ts); read-only without a payer. */
  readonly lockFees: ChainLockFees;
  /** Winner takes the burn (LAUNCHPAD-PATH §40): pair links, submit_pair_result and forward_to_winner (pairForwardChain.ts). */
  readonly pairForward: ChainPairForward;
  /** End sinks (LAUNCHPAD-PATH §45): EndSink / RuleEnd reads, submit_rule_end, forward_on_end (endSinkChain.ts). */
  readonly endSink: ChainEndSink;
  constructor(o: ProgramBurnClientOpts) {
    this.o = o;
    this.programId = o.programId.toBase58();
    this.cluster = o.cluster;
    this.canSign = !!o.payer;
    this.lockFees = new ChainLockFees({ connection: o.connection, programId: o.programId, cluster: programClusterOf(o.cluster), payer: o.payer, allowMainnet: o.allowMainnet });
    this.endSink = new ChainEndSink({ connection: o.connection, programId: o.programId, cluster: programClusterOf(o.cluster), payer: o.payer, attesters: o.attesters ?? (o.payer ? [o.payer] : undefined), allowMainnet: o.allowMainnet });
    this.pairForward = new ChainPairForward({ connection: o.connection, programId: o.programId, cluster: programClusterOf(o.cluster), payer: o.payer, attesters: o.attesters ?? (o.payer ? [o.payer] : undefined), allowMainnet: o.allowMainnet });
  }
  async initializeToken(i: InitializeTokenInput) {
    if (!i.rule) throw new Error("initialize_token: the locked rule is required (the counter mapping reads its fractions)");
    if (!this.o.admin) throw new Error("initialize_token: BURNTICKER_ADMIN (the config authority — the Squads 2-of-3 vault) is not set");
    // item 165: the floor is pinned in lamports here, once, at the SOL price of this moment; a missing or absurd price refuses
    const solUsd = await this.o.solUsd();
    try { assertSolUsd(solUsd); } catch (e) { throw new Error(`initialize_token: ${(e as Error).message}`); }
    const floorLamports = BigInt(Math.ceil((Number(i.rule.floorUsd) / solUsd) * 1e9));
    const c = counterRule(i.rule, i.ticker, i.selectorKey, { floorLamports });
    const mint = new PublicKey(i.mint), creator = new PublicKey(i.creator);
    // §45: the EndSink the rule pins — refused on a program without round 4 (the description would promise a sink nobody pinned)
    const endPin = endSinkPin(i.rule, i.pairMint);
    if (endPin && !(this.o.endSinksLive ?? endSinksLiveFromEnv())) throw new Error(`initialize_token: this rule sends its leftover to an end sink, and end sinks are not live on this program yet (${END_SINKS_LIVE_FLAG} is off)`);
    if (endPin?.kind === "incinerator" && initializeTokenLayoutFromEnv() !== "r5") throw new Error("initialize_token: this rule sends the SOL left at the end to Solana's incinerator, and that end sink needs the round-5 program (BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r5)");
    const endSink = endPin ? { kind: endSinkKindCode(endPin.kind), ...(endPin.kind === "mint" ? { sinkMint: new PublicKey(endPin.sinkMint!) } : {}), minForwardLamports: endPin.minForwardLamports } : undefined;
    if (!/^[0-9a-f]{64}$/.test(i.rulesSha256)) throw new Error("initialize_token: rulesSha256 must be 64 hex characters");
    // policies 0 and 2: the program refuses unless launchlab_platform == BURNTICKER_PLATFORM (round 2) — pass the host's or the pinned one
    const pin = PROGRAM_BURNTICKER_PLATFORM[programClusterOf(this.o.cluster)];
    const launchlabPlatform = this.o.launchLabPlatform ?? (pin && !pin.equals(PublicKey.default) ? pin : undefined);
    const ix = initializeTokenIx({ programId: this.o.programId, payer: creator, creator, mint, ...(launchlabPlatform ? { launchlabPlatform } : {}), args: {
      feed_id: c.feedId, memo_prefix: c.memoPrefix, memo_source: c.memoSource, rules_sha256: Buffer.from(i.rulesSha256, "hex"), rule: c.rule,
      attesters: i.attesters.map((a) => operatorAttester(new PublicKey(a))), quorum: i.quorum, fixed_pool: PublicKey.default, admin: this.o.admin,
    }, layout: initializeTokenLayoutFromEnv() === "r5" ? "r5" : (this.o.endSinksLive ?? endSinksLiveFromEnv()) ? "r4" : initializeTokenLayoutFromEnv(), ...(endSink ? { endSink } : {}), ...(i.pairMint ? { pairMint: new PublicKey(i.pairMint), partnerFirst: !!i.partnerFirst, pairVoidBy: i.pairVoidBy ?? dateU32((i.rule.pair as { voidBy?: string } | null | undefined)?.voidBy) } : {}) });
    // Round 5: a rule with a burn target pins it right after initialize_token, while the coin's mint does not exist yet (the same mint
    // signature). Refused unless the host says the program is round 5, and unless the pool passes the program's admission now.
    const pins: SerializedIx[] = [];
    const bt = (i.rule as { burnTarget?: { mint: string; pool: string; symbol: string; feedId: string } }).burnTarget;
    if (bt) {
      if (initializeTokenLayoutFromEnv() !== "r5") throw new Error("initialize_token: this rule burns a target token, and burn targets need the round-5 program (BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r5)");
      const a = await checkTargetAdmission(this.o.connection, { cluster: programClusterOf(this.o.cluster), targetMint: new PublicKey(bt.mint), pool: new PublicKey(bt.pool), coinMint: mint, feedId: bt.feedId, maxDevBps: c.rule.max_twap_deviation_bps });
      if (!a.ok || !a.ammConfig || !a.wsolVault || !a.targetVault) throw new Error(`initialize_token: ${bt.symbol} cannot be a burn target: ${a.problems.join(" ")}`);
      // Right after initialize_token in the same transaction, before the coin's mint exists; the LaunchLab create follows in the next one
      // (launchBundle.ts launchTransactions: init + pin + create together exceed the packet limit).
      pins.push(serialize(pinBurnTargetIx({ programId: this.o.programId, payer: creator, mint, targetMint: a.targetMint, pool: a.pool, ammConfig: a.ammConfig, wsolVault: a.wsolVault, targetVault: a.targetVault, feedId: bt.feedId }), `burn_receipts.pin_burn_target (${bt.symbol} ${bt.mint} on ${a.poolKind === 1 ? "AMM v4" : "CPMM"} pool ${bt.pool}, Pyth feed ${bt.feedId.slice(0, 12)}…; after initialize_token, before the coin's mint exists)`));
    }
    return { tokenConfig: configPda(this.o.programId, mint).toBase58(), instructions: [...[serialize(ix, `burn_receipts.initialize_token (counter: ${c.feedId}, ${c.rule.mode === MODE_BUYBACK ? `${c.rule.fraction_per_unit_bps} bps per unit, floor ${floorLamports} lamports ≈ $${i.rule.floorUsd} at $${solUsd.toFixed(2)}/SOL` : `${c.rule.tokens_per_unit} raw per unit`}${i.pairMint ? `; pair_mint ${i.pairMint}${i.partnerFirst ? " (completes the pairing)" : " (provisional for 7 days)"}` : ""})`)], ...pins] };
  }
  feePdaFor(mint: string) { return burnPoolFor(this.o.programId, new PublicKey(mint)).feePda.toBase58(); }
  vaultFor(mint: string) { return vaultAddress(this.o.programId, new PublicKey(mint)).toBase58(); }
  async feePdaBalanceLamports(mint: string) { return BigInt(await this.o.connection.getBalance(new PublicKey(this.feePdaFor(mint)), "confirmed")); }
  async vaultBalanceRaw(mint: string) {
    const v = new PublicKey(this.vaultFor(mint));
    if (!(await this.o.connection.getAccountInfo(v, "confirmed"))) return BigInt(0);
    return BigInt((await this.o.connection.getTokenAccountBalance(v, "confirmed")).value.amount);
  }
  async supplyRaw(mint: string) { try { return BigInt((await this.o.connection.getTokenSupply(new PublicKey(mint), "confirmed")).value.amount); } catch { return null; } }
  port(mint: string): ProgramPort {
    const have = this.ports.get(mint);
    if (have) return have;
    const readOnly = (what: string) => async (): Promise<never> => { throw new Error(`read-only program client (no payer key): cannot ${what}`); };
    const base = solanaProgramPort({ connection: this.o.connection, programId: this.o.programId, mint: new PublicKey(mint), cluster: this.o.cluster, payer: this.o.payer ?? ({ publicKey: PublicKey.default } as Keypair), attesters: this.o.attesters ?? (this.o.payer ? [this.o.payer] : []), allowMainnet: this.o.allowMainnet, launchLabProgram: this.o.launchLabProgram, cpmmProgram: this.o.cpmmProgram, log: this.o.log });
    const p: ProgramPort = this.o.payer ? base : { ...base, buildReading: readOnly("sign a reading"), planCrank: readOnly("crank"), planCarried: readOnly("crank"), claimCreatorFees: readOnly("claim"), checkPoolHealth: readOnly("check pool health"), send: readOnly("send") };
    this.ports.set(mint, p);
    return p;
  }
  async findReceiptOnChain(mint: string, key: string) {
    const c = this.o.connection;
    const sigs = await c.getSignaturesForAddress(configPda(this.o.programId, new PublicKey(mint)), { limit: 200 }, "confirmed");
    for (const s of sigs) {
      if (s.err !== null) continue;
      // The burn program's own Memo CPI (review-2 F10), never a Memo log line another instruction could have written.
      const t = await c.getParsedTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const memo = memoFromTransaction(t, this.o.programId);
      if (memo && memo.startsWith(key)) return { signature: s.signature, slot: s.slot ?? null, memo };
    }
    return null;
  }
  /** One transaction's burn-program memo (the audit's per-receipt check): one getParsedTransaction, never a scan of the config account. */
  async memoOfTransaction(signature: string) {
    const t = await this.o.connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!t) return null;
    return { memo: memoFromTransaction(t, this.o.programId), slot: t.slot ?? null, failed: t.meta?.err != null };
  }
  /** True when this mint has a TokenConfig under the program (the keeper and the pages check before using a port). */
  async initialised(mint: string): Promise<boolean> { return !!(await fetchTokenConfig(this.o.connection, this.o.programId, new PublicKey(mint))); }
}
