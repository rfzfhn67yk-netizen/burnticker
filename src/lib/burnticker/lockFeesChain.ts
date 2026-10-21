import { type Connection, type Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { decodeLockedLiquidity, fetchFeeKeyRecord, fetchTokenConfig } from "@/lib/burnReceipts/accounts";
import { CPMM_PROGRAM_ID, LAUNCHLAB_VAULT_AUTH, TOKEN_PROGRAM_ID, type Cluster } from "@/lib/burnReceipts/constants";
import { fetchCpmmPool, type CpmmPool } from "@/lib/burnReceipts/cpmm";
import { anchorErrorName, assertClusterAllowed, memoFromTransaction, signTransaction, type ProgramContext } from "@/lib/burnReceipts/crank";
import { claimLockFeesIx, registerFeeKeyIx, registerPoolIx } from "@/lib/burnReceipts/instructions";
import { feeKeysPda as programFeeKeysPda, lockedLiquidityPda } from "@/lib/burnReceipts/pda";
import { findMigrationPool } from "@/lib/burnReceipts/migrationPool";
import { registerFeeKeyLaunchlabSlotOnChain } from "@/lib/burnticker/programHash";
import type { VerifiedBuild } from "@/lib/burnticker/trustpack/verifiedBuild";
import type { ConfirmOutcome, SignedTx } from "@/lib/burnKeeper/programPort";
import { factsOfMemo, operatorTreasuryFor, parseLockFeesMemo, type LockFeeClaimFacts, type LockFeesClient, type LockFeesPort, type LockFeesState } from "@/lib/burnticker/lockFees";

/**
 * THE REAL claim_lock_fees CLIENT (LP locked forever, 2026-10-10), bound to the program builder's src/lib/burnReceipts: the keeper's
 * crank (lockFeesKeeper.ts) and the pages (lpLockPage.ts) use it through the LockFeesClient port. Without a payer key it is READ-ONLY
 * (the app server): it reads the lock and the claims, never signs. Not in the public SDK's import closure.
 *
 * READING A COIN'S LOCK (round 2, 2026-10-11). The pool: the FeeKeyRecord's (the immutable position pool) once registered; else the
 * registered pool; else, for policy 0, the LaunchLab migration pool PDA (register_fee_key now runs BEFORE register_pool). No pool account
 * = not graduated. The position's LOCKER (@128) must be LaunchLab's vault_auth (policy 0) or the pair vault (policy 2). The Fee Key: burn_receipts' FeeKeyRecord ["fee_key", mint] once register_fee_key has run; before that, the Fee Key NFT is
 * found among the fee-keys PDA's token accounts (amount 1) whose Raydium LockedCpLiquidityState names this pool. Not found there = the
 * Fee Key is not held by the program (the keeper alarms). Locked share = the lock's locked_lp / the pool's lp_supply.
 *
 * WHAT HAS ACCRUED. There is no cheap closed form for the fees a lock can collect (they come from the pool's k growth since the lock's
 * last claim), so with a payer key the client SIMULATES claim_lock_fees(u64::MAX) and reads the program's own memo in the simulation
 * logs (`<PREFIX>|lockfees|wsol=…|burnpool=…|operator=…|paid=…|pending=…|burned=…|nft=…|v2` (v1 without paid/pending before round 2)): wsol = the SOL side, burned = the coin side. A refused
 * simulation (TreasuryNotPinned, cap allowlist, …) reads as nothing accrued here; the crank's own simulation reports the refusal.
 *
 * A CONFIRMED CLAIM'S FACTS come from the burn program's Memo CPI in the transaction (memoFromTransaction), never from log text.
 */

export interface ChainLockFeesOpts {
  connection: Connection;
  programId: PublicKey;
  cluster: Cluster;
  /** Pays the fees (and two ATA rents it gets back). Null = read-only. */
  payer: Keypair | null;
  allowMainnet?: boolean;
  /** The verified-build record register_fee_key's account list is decided against; omitted = read config/burnticker/verified-build.json. */
  verifiedBuild?: VerifiedBuild | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ZERO = BigInt(0);

/** The memo the burn program wrote in a simulation's logs ("Program log: Memo (len N): \"…\""), for the claim. */
export function lockFeesMemoFromLogs(logs: readonly string[]): string | null {
  for (const l of logs) {
    const m = /Program log: Memo \(len \d+\): "(.*)"$/.exec(l);
    if (m && parseLockFeesMemo(m[1])) return m[1];
  }
  return null;
}

export class ChainLockFees implements LockFeesClient {
  readonly programId: string;
  readonly cluster: string;
  private readonly o: ChainLockFeesOpts;
  private readonly ports = new Map<string, LockFeesPort>();
  private readonly keys: PublicKey;
  constructor(o: ChainLockFeesOpts) {
    this.o = o;
    this.programId = o.programId.toBase58();
    this.cluster = o.cluster;
    this.keys = programFeeKeysPda(o.programId);
  }
  feeKeysPda(): string { return this.keys.toBase58(); }
  operatorTreasury(): string | null { return operatorTreasuryFor(this.o.cluster); }
  port(mintS: string): LockFeesPort {
    const have = this.ports.get(mintS);
    if (have) return have;
    const o = this.o, c = o.connection, mint = new PublicKey(mintS), keys = this.keys;
    const ctx: ProgramContext = { connection: c, programId: o.programId, mint, cluster: o.cluster, allowMainnet: o.allowMainnet };
    let clusterChecked = false;
    const need = async (): Promise<Keypair> => {
      if (!o.payer) throw new Error("read-only lock-fee client (no payer key): cannot sign");
      if (!clusterChecked) { await assertClusterAllowed(ctx); clusterChecked = true; }
      return o.payer;
    };
    const sign = async (ixs: Parameters<typeof signTransaction>[1]): Promise<SignedTx> => {
      const s = await signTransaction(ctx, ixs, [await need()]);
      return { signature: s.signature, raw: s.raw, blockhash: s.blockhash, lastValidBlockHeight: s.lastValidBlockHeight };
    };
    /** The registered pool and the Fee Key (record first, then the fee-keys PDA's holdings), or why not. */
    type Located = { pool: CpmmPool; feeNftMint: PublicKey | null; registered: boolean; lockedLp: bigint | null; owner: string | null; lockedLiquidity: string | null; locker: string | null; expectedLocker: string; poolRegistered: boolean; policy: 0 | 1 | 2 };
    const locate = async (): Promise<Located | "fixed" | null> => {
      const cfg = await fetchTokenConfig(c, o.programId, mint);
      if (!cfg) return null;
      const policy = cfg.config.registration_policy as 0 | 1 | 2;
      if (policy === 1) return "fixed";
      // round 2: policy 0 registers the Fee Key BEFORE register_pool — on the migration pool PDA (cpConfigId + WSOL/mint) until then
      const rec0 = await fetchFeeKeyRecord(c, o.programId, mint);
      // B-17 / HB-167: the migration pool is read from the Fee Key's own lock record (any AmmConfig LaunchLab used); the pinned and
      // current-tier PDAs are only a hint, and a pool there counts only with the fee PDA as its creator (never a squatter's pool).
      const mig = !rec0 && !cfg.config.poolRegistered && policy === 0 ? await findMigrationPool(c, o.cluster, o.programId, cfg.config, mint) : null;
      if (mig && mig.status === "not-migrated") return null;
      const poolKey = rec0?.record.pool ?? (cfg.config.poolRegistered ? cfg.config.cpmm_pool : mig?.status === "found" ? mig.pool : null);
      if (!poolKey) return null;
      let pool: CpmmPool;
      try { pool = await fetchCpmmPool(c, poolKey, CPMM_PROGRAM_ID[o.cluster]); } catch { return null; }   // no pool yet = not graduated
      const expectedLocker = policy === 0 ? LAUNCHLAB_VAULT_AUTH[o.cluster].toBase58() : pool.poolCreator.toBase58();
      const base = { expectedLocker, poolRegistered: cfg.config.poolRegistered, policy };
      if (mig?.status === "found") {
        if (mig.via === "fee-key") return { ...base, pool, feeNftMint: mig.feeNftMint, registered: false, lockedLp: mig.lockedLp, owner: keys.toBase58(), lockedLiquidity: mig.lockedLiquidity.toBase58(), locker: mig.locker.toBase58() };
        return { ...base, pool, feeNftMint: null, registered: false, lockedLp: null, owner: null, lockedLiquidity: null, locker: null };
      }
      const rec = rec0;
      if (rec) {
        const nft = rec.record.fee_nft_mint;
        const ll = await c.getAccountInfo(rec.record.locked_liquidity, "confirmed");
        const lock = ll ? decodeLockedLiquidity(ll.data) : null;
        const held = await c.getTokenAccountBalance(rec.record.fee_nft_account, "confirmed").then((b) => b.value.amount === "1").catch(() => false);
        let owner: string | null = held ? keys.toBase58() : null;
        if (!held) { try { const big = (await c.getTokenLargestAccounts(nft, "confirmed")).value.find((a) => a.amount === "1"); if (big) { const acc = await c.getAccountInfo(big.address, "confirmed"); owner = acc ? new PublicKey(acc.data.subarray(32, 64)).toBase58() : null; } } catch { owner = null; } }
        return { ...base, pool, feeNftMint: nft, registered: true, lockedLp: lock?.lockedLp ?? null, owner, lockedLiquidity: rec.record.locked_liquidity.toBase58(), locker: lock ? lock.owner.toBase58() : null };
      }
      // Before register_fee_key: the Fee Key among the fee-keys PDA's NFTs, matched by its lock's pool.
      const accs = await c.getTokenAccountsByOwner(keys, { programId: TOKEN_PROGRAM_ID }, "confirmed");
      const nfts = accs.value.map((a) => ({ mint: new PublicKey(a.account.data.subarray(0, 32)), amount: a.account.data.readBigUInt64LE(64) })).filter((x) => x.amount === BigInt(1));
      for (let i = 0; i < nfts.length; i += 100) {
        const batch = nfts.slice(i, i + 100);
        const locks = await c.getMultipleAccountsInfo(batch.map((n) => lockedLiquidityPda(o.cluster, n.mint)), "confirmed");
        for (let j = 0; j < batch.length; j++) {
          const a = locks[j];
          if (!a) continue;
          const lock = decodeLockedLiquidity(a.data);
          if (lock.pool.equals(pool.address)) return { ...base, pool, feeNftMint: batch[j].mint, registered: false, lockedLp: lock.lockedLp, owner: keys.toBase58(), lockedLiquidity: lockedLiquidityPda(o.cluster, batch[j].mint).toBase58(), locker: lock.owner.toBase58() };
        }
      }
      return { ...base, pool, feeNftMint: null, registered: false, lockedLp: null, owner: null, lockedLiquidity: null, locker: null };
    };
    const claimIx = async (feeNftMint: PublicKey, pool: CpmmPool) => claimLockFeesIx({ programId: o.programId, cranker: (await need()).publicKey, mint, feeNftMint, pool: { pool: pool.address, lpMint: pool.lpMint, token0Vault: pool.token0Vault, token1Vault: pool.token1Vault }, cluster: o.cluster });
    const simulate = async (raw: Uint8Array) => {
      const r = await c.simulateTransaction(VersionedTransaction.deserialize(raw), { commitment: "confirmed" });
      const logs = r.value.logs ?? [];
      return { err: r.value.err ? anchorErrorName(logs) ?? JSON.stringify(r.value.err) : null, logs };
    };
    const port: LockFeesPort = {
      mint: mintS,
      feeKeysPda: keys.toBase58(),
      async state(so?: { accrued?: boolean }): Promise<LockFeesState> {
        const at = await locate();
        if (at === "fixed") return { graduated: false, pool: null, lpMint: null, feeKey: null, feeKeyOwner: null, lockedLiquidity: null, feeKeyRegistered: false, policy: 1, lockedPct: null, accruedSolLamports: ZERO, accruedTokenRaw: ZERO };
        if (!at) return { graduated: false, pool: null, lpMint: null, feeKey: null, feeKeyOwner: null, lockedLiquidity: null, feeKeyRegistered: false, lockedPct: null, accruedSolLamports: ZERO, accruedTokenRaw: ZERO };
        const lockedPct = at.lockedLp !== null && at.pool.lpSupply > ZERO ? Number((at.lockedLp * BigInt(10_000)) / at.pool.lpSupply) / 100 : null;
        let accruedSol = ZERO, accruedToken = ZERO;
        if (so?.accrued !== false && o.payer && at.registered && at.poolRegistered !== false && at.feeNftMint && operatorTreasuryFor(o.cluster)) {
          try {
            const tx = await sign([await claimIx(at.feeNftMint, at.pool)]);
            const sim = await simulate(tx.raw);
            const memo = sim.err ? null : lockFeesMemoFromLogs(sim.logs);
            const f = memo ? parseLockFeesMemo(memo) : null;
            if (f) { accruedSol = f.solLamports; accruedToken = f.tokenBurnedRaw; }
          } catch { /* nothing readable: treated as nothing accrued this cycle */ }
        }
        return { graduated: true, pool: at.pool.address.toBase58(), lpMint: at.pool.lpMint.toBase58(), feeKey: at.feeNftMint?.toBase58() ?? null, feeKeyOwner: at.owner, lockedLiquidity: at.lockedLiquidity, feeKeyRegistered: at.registered, poolRegistered: at.poolRegistered, policy: at.policy, locker: at.locker, expectedLocker: at.expectedLocker, lockedPct, accruedSolLamports: accruedSol, accruedTokenRaw: accruedToken };
      },
      async buildRegisterFeeKey() {
        const at = await locate();
        if (!at || at === "fixed") throw new Error("register_fee_key: the coin has no graduated pool yet");
        if (!at.feeNftMint) throw new Error("register_fee_key: no Fee Key for this pool is held by the fee-keys PDA");
        // B-17: the launchlab_pool account only when the deployed program is the B-17 build (its hash on chain); the round-5 program
        // refuses the longer account list
        const launchlabPoolSlot = await registerFeeKeyLaunchlabSlotOnChain({ accountBytes: async (a) => (await c.getAccountInfo(new PublicKey(a), "confirmed"))?.data ?? null }, o.programId.toBase58(), o.cluster, (b) => new PublicKey(b).toBase58(), { vb: o.verifiedBuild });
        return sign([registerFeeKeyIx({ programId: o.programId, payer: (await need()).publicKey, mint, pool: at.pool.address, feeNftMint: at.feeNftMint, cluster: o.cluster, lpMint: at.pool.lpMint, launchlabPoolSlot })]);
      },
      async buildRegisterPool() {
        const at = await locate();
        if (!at || at === "fixed") throw new Error("register_pool: the coin has no graduated pool yet");
        return sign([registerPoolIx({ programId: o.programId, registrar: (await need()).publicKey, mint, pool: at.pool.address, lpMint: at.pool.lpMint, cluster: o.cluster })]);
      },
      async buildClaim() {
        const at = await locate();
        if (!at || at === "fixed" || !at.feeNftMint) throw new Error("claim_lock_fees: no locked LP with a Fee Key at the fee-keys PDA for this coin");
        return sign([await claimIx(at.feeNftMint, at.pool)]);
      },
      simulate,
      async send(raw) { await need(); await c.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }); },
      async confirm(tx): Promise<ConfirmOutcome> {
        const started = Date.now();
        while (Date.now() - started < 120_000) {
          const st = (await c.getSignatureStatuses([tx.signature], { searchTransactionHistory: true })).value[0];
          if (st) {
            if (st.err) return { status: "failed", err: JSON.stringify(st.err) };
            if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return { status: "confirmed", slot: st.slot };
          }
          if ((await c.getBlockHeight("confirmed")) > tx.lastValidBlockHeight) return { status: "expired" };
          await sleep(1_000);
        }
        return { status: "expired" };
      },
      async claimFacts(signature): Promise<LockFeeClaimFacts | "none" | null> {
        const t = await c.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        if (!t?.meta || t.meta.err) return null;
        const memo = memoFromTransaction(t, o.programId);
        const f = memo ? parseLockFeesMemo(memo) : null;
        // round 2: a confirmed claim that claimed nothing and paid nothing writes no memo
        return f ? factsOfMemo(f) : "none";
      },
    };
    this.ports.set(mintS, port);
    return port;
  }
}
