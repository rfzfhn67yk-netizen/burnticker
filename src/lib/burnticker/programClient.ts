import { type Connection, type Keypair, PublicKey } from "@solana/web3.js";
import { fetchTokenConfig } from "@/lib/burnReceipts/accounts";
import { MODE_BUYBACK } from "@/lib/burnReceipts/constants";
import { memoFromTransaction } from "@/lib/burnReceipts/crank";
import { initializeTokenIx, operatorAttester } from "@/lib/burnReceipts/instructions";
import { configPda, vaultAddress } from "@/lib/burnReceipts/pda";
import { burnPoolFor } from "@/lib/burnKeeper/burnPool";
import type { ProgramPort } from "@/lib/burnKeeper/programPort";
import { programClusterOf, solanaProgramPort } from "@/lib/burnKeeper/programAdapter";
import type { Cluster } from "@/lib/burnKeeper/solana";
import { counterRule, type BurnProgramClient, type InitializeTokenInput, type SerializedIx } from "@/lib/burnticker/program";
import { ChainLockFees } from "@/lib/burnticker/lockFeesChain";

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
  cpmmProgram?: PublicKey | null;
  log?: (s: string) => void;
}

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
  constructor(o: ProgramBurnClientOpts) {
    this.o = o;
    this.programId = o.programId.toBase58();
    this.cluster = o.cluster;
    this.canSign = !!o.payer;
    this.lockFees = new ChainLockFees({ connection: o.connection, programId: o.programId, cluster: programClusterOf(o.cluster), payer: o.payer, allowMainnet: o.allowMainnet });
  }
  async initializeToken(i: InitializeTokenInput) {
    if (!i.rule) throw new Error("initialize_token: the locked rule is required (the counter mapping reads its fractions)");
    if (!this.o.admin) throw new Error("initialize_token: BURNTICKER_ADMIN (the config authority — the Squads 2-of-3 vault) is not set");
    const solUsd = await this.o.solUsd();
    if (!(solUsd > 0)) throw new Error("initialize_token: no SOL price to set the floor in lamports");
    const floorLamports = BigInt(Math.ceil((Number(i.rule.floorUsd) / solUsd) * 1e9));
    const c = counterRule(i.rule, i.ticker, i.selectorKey, { floorLamports });
    const mint = new PublicKey(i.mint), creator = new PublicKey(i.creator);
    if (!/^[0-9a-f]{64}$/.test(i.rulesSha256)) throw new Error("initialize_token: rulesSha256 must be 64 hex characters");
    const ix = initializeTokenIx({ programId: this.o.programId, payer: creator, creator, mint, args: {
      feed_id: c.feedId, memo_prefix: c.memoPrefix, memo_source: c.memoSource, rules_sha256: Buffer.from(i.rulesSha256, "hex"), rule: c.rule,
      attesters: i.attesters.map((a) => operatorAttester(new PublicKey(a))), quorum: i.quorum, fixed_pool: PublicKey.default, admin: this.o.admin,
    } });
    return { tokenConfig: configPda(this.o.programId, mint).toBase58(), instructions: [serialize(ix, `burn_receipts.initialize_token (counter: ${c.feedId}, ${c.rule.mode === MODE_BUYBACK ? `${c.rule.fraction_per_unit_bps} bps per unit, floor ${floorLamports} lamports ≈ $${i.rule.floorUsd} at $${solUsd.toFixed(2)}/SOL` : `${c.rule.tokens_per_unit} raw per unit`})`)] };
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
    const p: ProgramPort = this.o.payer ? base : { ...base, buildReading: readOnly("sign a reading"), planCrank: readOnly("crank"), claimCreatorFees: readOnly("claim"), checkPoolHealth: readOnly("check pool health"), send: readOnly("send") };
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
  /** True when this mint has a TokenConfig under the program (the keeper and the pages check before using a port). */
  async initialised(mint: string): Promise<boolean> { return !!(await fetchTokenConfig(this.o.connection, this.o.programId, new PublicKey(mint))); }
}
