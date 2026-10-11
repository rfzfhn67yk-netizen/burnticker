import { type AddressLookupTableAccount, type Connection, type Keypair, PublicKey, type TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { attestReading, sourceUrlHash } from "@/lib/burnReceipts/attestation";
import { fetchReading, fetchTokenConfig, type ReadingAccount, type TokenConfigAccount } from "@/lib/burnReceipts/accounts";
import { assertSignableGenesis, type Cluster as ProgramCluster, LAUNCHLAB_PROGRAM_ID, MAX_QUORUM, MODE_BUYBACK, OUTCOME_NAMES, POOL_REPLACEMENT_DELAY_SECS, QUEUE_UNBLOCK_SECS, UNTRADEABLE_MAX_GAP_SECS } from "@/lib/burnReceipts/constants";
import { anchorErrorName, assertClusterAllowed, checkPoolHealth as programCheckPoolHealth, claimLaunchLabCreatorFee, DEFERRABLE_ERRORS, memoFromTransaction, planCrank as programPlanCrank, type ProgramContext, signTransaction } from "@/lib/burnReceipts/crank";
import { submitReadingIx } from "@/lib/burnReceipts/instructions";
import { configPda, feePda, launchlabCreatorFeeVault, readingPda } from "@/lib/burnReceipts/pda";
import type { ProgramConfigView, ProgramPort, ProgramReadingView, SignedTx } from "@/lib/burnKeeper/programPort";
import { planGraduatedCreatorFeeClaim } from "@/lib/burnKeeper/creatorFees";
import { CPMM_PROGRAM_ID as KEEPER_CPMM, launchLabProgramFor } from "@/lib/burnKeeper/launchlab";
import type { Cluster } from "@/lib/burnKeeper/solana";

/**
 * THE ADAPTER (2026-10-10): `ProgramPort` (programChain.ts) over today's TypeScript client, src/lib/burnReceipts. The ONLY file on the
 * keeper's program path that builds, signs or decodes program transactions and accounts — the executor (programChain.ts), the
 * Burnticker client (src/lib/burnticker/program.ts) and the status pages see views, not client types.
 *
 * CLIENT CHANGES OF THE SECOND BLIND REVIEW (2026-10-10), landed here:
 *   · signed message v3 binds the cluster genesis: buildReading signs with the TokenConfig's `cluster_genesis` (what the program
 *     checks) and refuses on devnet/mainnet when it differs from the RPC's genesis;
 *   · one shared-message Ed25519 instruction for all held keys (attestReading); every transaction goes through signTransaction →
 *     buildSizedTransaction: legacy when it fits 1,232 bytes, else v0 through `lookupTable`, else an explicit error. `raw` is a
 *     serialized VersionedTransaction (simulate deserializes it as one);
 *   · crank plans already carry SyncNative on the fee PDA's WSOL account (planCrank); `retryableErrors` = the client's
 *     DEFERRABLE_ERRORS (incl. WsolBalanceMismatch), so the executor waits instead of failing;
 *   · memos come from the burn program's own Memo CPI (memoFromTransaction), never from log text — and (review-3 L-6) the memo of
 *     the reading asked for, when one transaction cranked several;
 *   · (review-3) a missing pool account still yields a crank plan and a health check (built from the config: L-5); a mainnet-bound
 *     message is never signed off mainnet (I-1);
 *   · readings carry the pool used (ProgramReadingView.pool); the config view carries the untradeable spell's last observation;
 *   · quorum ≤ 3. A process signs with at most `maxLocalAttesters` keys (default 1 — until an off-machine attester exists the keeper
 *     signs with its one key; tests and multi-key operators raise it, up to 3).
 */

export function configView(programId: PublicKey, mint: PublicKey, c: TokenConfigAccount): ProgramConfigView {
  const att = (xs: { kind: number; key: PublicKey }[]) => xs.map((a) => ({ key: a.key.toBase58(), kind: a.kind }));
  return {
    programId: programId.toBase58(), config: configPda(programId, mint).toBase58(), feePda: feePda(programId, mint).toBase58(), mint: mint.toBase58(),
    mode: c.rule.mode === MODE_BUYBACK ? "buyback" : "vault", feedId: c.feedId, memoPrefix: c.memoPrefix, memoSource: c.memoSource, valueDecimals: c.rule.value_decimals,
    rulesSha256: Buffer.from(c.rules_sha256).toString("hex"), unitValue: c.rule.unit_value, fractionPerUnitBps: c.rule.fraction_per_unit_bps, floorLamports: c.rule.floor_lamports,
    reserveLamports: c.rule.reserve_lamports, tokensPerUnit: c.rule.tokens_per_unit,
    attesters: att(c.activeAttesters), quorum: c.quorum, pendingAttesters: att(c.pending_attesters.slice(0, c.pending_count)), pendingEta: c.pending_count > 0 ? Number(c.pending_eta) : null, adminRenounced: c.adminRenounced,
    hasBaseline: c.has_baseline, lastRecordDate: c.last_record_date, lastValue: c.last_value, carry: c.carry, crankCursor: c.crank_cursor,
    poolRegistered: c.poolRegistered, pool: c.poolRegistered ? c.cpmm_pool.toBase58() : null, poolUntradeableSince: c.pool_untradeable_since > BigInt(0) ? Number(c.pool_untradeable_since) : null,
    poolUntradeableLastSeen: c.pool_untradeable_last_seen > BigInt(0) ? Number(c.pool_untradeable_last_seen) : null, clusterGenesis: c.cluster_genesis.toBase58(),
    carriedSpendLamports: c.carried_spend_lamports, totalBurned: c.total_burned, totalSpentLamports: c.total_spent_lamports, shortfall: c.shortfall, readings: c.readings, burns: c.burns,
  };
}

export function readingView(r: ReadingAccount): ProgramReadingView {
  return {
    recordDate: r.record_date, prevDate: r.prev_date, kind: r.kind, processed: r.processed, value: r.value, prevValue: r.prev_value, delta: r.delta, units: Number(r.units),
    signersMask: r.signers_mask, outcome: OUTCOME_NAMES[r.outcome] ?? String(r.outcome), poolLamports: r.pool_lamports, poolActualLamports: r.pool_actual_lamports,
    spentLamports: r.spent_lamports, ruleSpendLamports: r.rule_spend_lamports, carriedInLamports: r.carried_in_lamports, carriedOutLamports: r.carried_out_lamports,
    got: r.got, burned: r.burned, owed: r.owed, shortfall: r.shortfall,
    pool: r.pool && !r.pool.equals(PublicKey.default) ? r.pool.toBase58() : null,
  };
}


// ---------------------------------------------------------------------------------------------------------------------------------
// The Solana implementation (over src/lib/burnReceipts)
// ---------------------------------------------------------------------------------------------------------------------------------

export function programClusterOf(c: Cluster): ProgramCluster {
  if (c === "mainnet" || c === "devnet" || c === "localnet") return c;
  throw new Error(`burn_receipts has no ${c} deployment`);
}

export interface SolanaProgramPortOpts {
  connection: Connection;
  programId: PublicKey;
  mint: PublicKey;
  cluster: Cluster;
  /** Pays every fee (the cranker / reading payer). Signs nothing else. */
  payer: Keypair;
  /** The attester (data) keys this process signs readings with — normally just the keeper's key. */
  attesters: Keypair[];
  /** How many of `attesters` one process may sign a reading with (default 1; at most MAX_QUORUM = 3). */
  maxLocalAttesters?: number;
  /** Used only when a transaction would not fit a legacy one (createReadingLookupTable). */
  lookupTable?: AddressLookupTableAccount;
  allowMainnet?: boolean;
  /** Overrides for the creator-fee claims (LaunchLab program / pool, CPMM program). */
  launchLabProgram?: PublicKey | null;
  launchLabPool?: PublicKey | null;
  cpmmProgram?: PublicKey | null;
  log?: (s: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function solanaProgramPort(o: SolanaProgramPortOpts): ProgramPort {
  const c = o.connection;
  const ctx: ProgramContext = { connection: c, programId: o.programId, mint: o.mint, cluster: programClusterOf(o.cluster), allowMainnet: o.allowMainnet, lookupTable: o.lookupTable };
  const fee = feePda(o.programId, o.mint), config = configPda(o.programId, o.mint);
  const maxLocal = Math.min(o.maxLocalAttesters ?? 1, MAX_QUORUM);
  let rpcGenesis: string | null = null;
  const checkCluster = async (): Promise<string> => { if (!rpcGenesis) rpcGenesis = await assertClusterAllowed(ctx); return rpcGenesis; };
  const sign = async (ixs: TransactionInstruction[]): Promise<SignedTx> => {
    const s = await signTransaction(ctx, ixs, [o.payer]);
    return { signature: s.signature, raw: s.raw, blockhash: s.blockhash, lastValidBlockHeight: s.lastValidBlockHeight };
  };
  const parsedTx = async (signature: string) => {
    const t = await c.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    return t?.meta && !t.meta.err ? t : null;
  };
  const port: ProgramPort = {
    programId: o.programId.toBase58(), mint: o.mint.toBase58(), feePda: fee.toBase58(), configAddress: config.toBase58(),
    async config() {
      const r = await fetchTokenConfig(c, o.programId, o.mint);
      return r ? configView(o.programId, o.mint, r.config) : null;
    },
    async reading(recordDate) {
      const r = await fetchReading(c, o.programId, config, recordDate);
      return r ? readingView(r) : null;
    },
    attesterKeys: () => o.attesters.map((k) => k.publicKey.toBase58()),
    async buildReading(i) {
      if (o.attesters.length > maxLocal) throw new Error(`this process may sign a reading with at most ${maxLocal} attester key(s) (holds ${o.attesters.length}; maxLocalAttesters, quorum ≤ ${MAX_QUORUM})`);
      const genesisRpc = await checkCluster();
      const cfg = await fetchTokenConfig(c, o.programId, o.mint);
      if (!cfg) throw new Error(`no burn_receipts config for mint ${o.mint.toBase58()}`);
      const genesis = cfg.config.cluster_genesis.toBase58();
      // Review-3 I-1: never a mainnet-bound signature off mainnet; on devnet/mainnet the build's genesis must be the RPC's.
      assertSignableGenesis(genesis, ctx.cluster, genesisRpc);
      const srcHash = sourceUrlHash(i.sourceUrl);
      // proof= (2026-10-10): Burn Derby readings commit to their proof hash (the Pyth update bytes' digest); zero for every other source.
      const att = attestReading({ genesisHash: genesis, programId: o.programId, mint: o.mint, feedId: i.feedId, prevDate: i.prevDate, recordDate: i.recordDate, value: i.value, valueDecimals: i.valueDecimals, sourceUrlHash: srcHash, ...(i.proofHash ? { proofHash: i.proofHash } : {}), signers: o.attesters.map((k) => ({ publicKey: k.publicKey, secretKey: k.secretKey })) });
      const tx = await sign([att.instruction, submitReadingIx({ programId: o.programId, payer: o.payer.publicKey, mint: o.mint, recordDate: i.recordDate, value: i.value, sourceUrlHash: srcHash, ...(i.proofHash ? { proofHash: i.proofHash } : {}) })]);
      return { ...tx, message: att.message.toString("utf8") };
    },
    async planCrank() {
      await checkCluster();
      const p = await programPlanCrank(ctx, o.payer.publicKey);
      if ("status" in p) return p.status === "idle" ? { status: "idle" } : { status: "waiting-for-pool", recordDate: p.recordDate };
      return { kind: p.kind, recordDate: p.recordDate, build: () => sign(p.instructions) };
    },
    async simulate(raw) {
      const r = await c.simulateTransaction(VersionedTransaction.deserialize(raw), { commitment: "confirmed" });
      const logs = r.value.logs ?? [];
      return { err: r.value.err ? anchorErrorName(logs) ?? JSON.stringify(r.value.err) : null, logs };
    },
    async send(raw) { await c.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }); },
    async confirm(tx) {
      const started = Date.now();
      let lastSend = Date.now();
      while (Date.now() - started < 120_000) {
        await sleep(1_000);
        const st = (await c.getSignatureStatuses([tx.signature], { searchTransactionHistory: false })).value[0];
        if (st) {
          if (st.err) return { status: "failed", err: JSON.stringify(st.err) };
          if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return { status: "confirmed", slot: st.slot };
        }
        if ((await c.getBlockHeight("confirmed")) > tx.lastValidBlockHeight) return { status: "expired" };
        if (Date.now() - lastSend > 4_000) { lastSend = Date.now(); await c.sendRawTransaction(tx.raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {}); }
      }
      return { status: "expired" };
    },
    async signatureStatuses(signatures) {
      const v = (await c.getSignatureStatuses(signatures, { searchTransactionHistory: true })).value;
      return v.map((s) => (s ? { slot: s.slot ?? null, err: s.err ? JSON.stringify(s.err) : null, confirmed: s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized" } : null));
    },
    blockHeight: () => c.getBlockHeight("confirmed"),
    async memoOf(signature, recordDate) { return memoFromTransaction(await parsedTx(signature), o.programId, recordDate); },
    async findCrankTx(recordDate) {
      const sigs = await c.getSignaturesForAddress(readingPda(o.programId, config, recordDate), { limit: 25 }, "confirmed");
      for (const s of sigs) {
        if (s.err !== null) continue;
        const t = await parsedTx(s.signature);
        const logs = t?.meta?.logMessages ?? null;
        // a crank, or (winner takes the burn) the forward_to_winner that processed this reading — review RL-1
        if (logs && logs.some((l) => /Instruction: (Crank(Buyback|Vault|NoUnits)|ForwardToWinner)/.test(l))) return { signature: s.signature, slot: s.slot ?? null, memo: memoFromTransaction(t, o.programId, recordDate) };
      }
      return null;
    },
    async claimCreatorFees() {
      await checkCluster();
      const sent: string[] = [], notes: string[] = [];
      const ll = o.launchLabProgram ?? LAUNCHLAB_PROGRAM_ID[ctx.cluster];
      // (a) the bonding-curve creator fee: LaunchLab's [fee PDA, WSOL] vault, claimed by the program for the fee PDA.
      const vault = launchlabCreatorFeeVault(ll, fee);
      const v = await c.getAccountInfo(vault, "confirmed");
      if (!v) notes.push(`curve: no LaunchLab creator-fee vault for the fee PDA (${vault.toBase58().slice(0, 8)}…) — nothing accrued, or not launched on this cluster`);
      else {
        const r = await claimLaunchLabCreatorFee(ctx, o.payer);
        if (r.ok && r.signature) sent.push(r.signature); else notes.push(`curve: claim_launchlab_creator_fee not sent (${(r.error ?? "refused").slice(0, 100)})`);
      }
      // (b) after graduation: Raydium's permissionless collect into the fee PDA's ATAs.
      const cpmm = o.cpmmProgram ?? (o.cluster === "mainnet" ? KEEPER_CPMM.mainnet : o.cluster === "devnet" ? KEEPER_CPMM.devnet : null);
      const llKeeper = o.launchLabProgram ?? launchLabProgramFor(o.cluster);
      if (!cpmm || !llKeeper) notes.push(`cpmm: no LaunchLab/CPMM deployment on ${o.cluster} — nothing to collect`);
      else {
        const plan = await planGraduatedCreatorFeeClaim({ payer: o.payer.publicKey, burnPool: fee, mint: o.mint, launchLabProgram: llKeeper, cpmmProgram: cpmm, launchLabPool: o.launchLabPool ?? undefined },
          { getAccount: async (k) => { const a = await c.getAccountInfo(k, "confirmed"); return a ? { data: a.data, owner: a.owner } : null; } });
        if (plan.kind === "skip") notes.push(`cpmm: ${plan.why}`);
        else {
          const tx = await sign(plan.instructions);
          const sim = await port.simulate(tx.raw);
          if (sim.err) notes.push(`cpmm: collect refused in simulation (${sim.err.slice(0, 80)})`);
          else {
            await port.send(tx.raw);
            const r = await port.confirm(tx);
            if (r.status === "confirmed") sent.push(tx.signature); else notes.push(`cpmm: collect ${tx.signature.slice(0, 12)}… ${r.status}`);
          }
        }
      }
      return { sent, notes };
    },
    async checkPoolHealth() {
      await checkCluster();
      const r = await programCheckPoolHealth(ctx, o.payer);
      const cfg = await fetchTokenConfig(c, o.programId, o.mint);
      const since = cfg ? Number(cfg.config.pool_untradeable_since) : 0;
      const last = cfg ? Number(cfg.config.pool_untradeable_last_seen) : 0;
      // Review-2 F6/F7: the spell counts only while observations are ≤ 24 h apart; replace_pool opens after 7 continuous days, the
      // crank stops waiting (below-floor, target carried) after 30. This check is that daily observation.
      const state = since > 0
        ? `UNTRADEABLE since ${new Date(since * 1000).toISOString()} (last seen ${new Date(last * 1000).toISOString()}; continuous while observed every ≤ ${UNTRADEABLE_MAX_GAP_SECS / 3600} h — replace_pool after ${POOL_REPLACEMENT_DELAY_SECS / 86_400} days, queue unblock after ${QUEUE_UNBLOCK_SECS / 86_400})`
        : "tradeable";
      return r.ok ? { signature: r.signature ?? null, note: `check_pool_health: pool ${state} · ${r.signature}` } : { signature: null, note: `check_pool_health refused (${r.error}) · pool ${state}` };
    },
    async feePdaLamports() { return BigInt(await c.getBalance(fee, "confirmed")); },
    async supplyRaw() { try { return BigInt((await c.getTokenSupply(o.mint, "confirmed")).value.amount); } catch { return null; } },
    retryableErrors: DEFERRABLE_ERRORS,
  };
  return port;
}
