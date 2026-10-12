import { type Connection, type Keypair, PublicKey, VersionedTransaction, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { fetchReading, fetchTokenConfig } from "@/lib/burnReceipts/accounts";
import { assertSignableGenesis, NATIVE_MINT, type Cluster } from "@/lib/burnReceipts/constants";
import { anchorErrorName, assertClusterAllowed, memoFromTransaction, signTransaction, type ProgramContext } from "@/lib/burnReceipts/crank";
import { createAtaIdempotentIx } from "@/lib/burnReceipts/instructions";
import { attestPairResult, fetchPairLink, fetchPairResult, forwardToWinnerIx, PAIR_STATE_PAIRED, submitPairResultIx, unlinkPairIx, UNLINK_PAIR_VOIDED, UNLINK_SIDE_REFUNDING, UNLINK_VOID_BY_PASSED, type PairLinkAccount } from "@/lib/burnReceipts/pairs";
import { POOL_POLICY_PAIR_CURVE } from "@/lib/burnReceipts/constants";
import { fetchPair, pairPda, STATUS_VOIDED } from "@/lib/pairCurve/accounts";
import { sourceUrlHash } from "@/lib/burnReceipts/attestation";
import { configPda, feePda, feeWsolAddress } from "@/lib/burnReceipts/pda";
import type { ConfirmOutcome, SignedTx } from "@/lib/burnKeeper/programPort";
import { parseForwardMemo, type ForwardFacts, type PairForwardClient, type PairForwardPort, type PairLinkView, type PairResultView, type PairState, type UnlinkReason } from "@/lib/burnticker/pairForward";

/**
 * THE REAL PAIR-FORWARD CLIENT (winner takes the burn, LAUNCHPAD-PATH §40), bound to the program builder's src/lib/burnReceipts/pairs.ts:
 * the keeper (pairForwardKeeper.ts, multiKeeper.ts) and the pages use it through the PairForwardPort in pairForward.ts. Without a payer
 * key it is READ-ONLY (the app server): links and results only. Not in the public SDK's import closure.
 *
 *   links()             TokenConfig.pair_state for both coins + their PairLinks (["pair_link", mint]); paired = both PAIRED.
 *   result(D)           PairResult ["pair_result", lo, hi, D] (Pubkey.default winner = a draw).
 *   buildSubmitResult   ONE Ed25519SigVerify (shared message, attestPairResult) + submit_pair_result. Round 2: a WIN carries both
 *                       coins' readings (the builder adds reading_lo / reading_hi) and needs the LOSER's quorum (the winner's too only
 *                       when the loser rotated its attesters since pairing); a DRAW needs both quorums. A win missing a reading (or
 *                       whose loser reading is processed) is refused PairResultNotServable — the keeper alerts, never substitutes a draw. 1 signature + both readings fits a legacy
 *                       transaction; a 2-signature win needs a v0 transaction with a lookup table (ATTESTERS.md). PairResultSubmitted is
 *                       a plain `emit!` log event — the account is the record.
 *   buildForward        create the winner fee PDA's WSOL ATA (idempotent) + forward_to_winner(D). Round 2: no winner reading; a side
 *                       without a verified pool (or an unlinked pair) forwards 0 lamports and the loser's reading is still processed.
 *   forwardFacts(sig)   the burn program's own Memo CPI (memoFromTransaction, never log text) — the program ALWAYS writes the forward memo,
 *                       lamports=0 included — the loser's processed Reading (units, pool) and the loser fee PDA's lamport change (the
 *                       SOL part; the rest came from its WSOL).
 *   unlinkEvidence      r3: TERMINAL evidence only — a voided pair_curve Pair / a refunding side (the Pair is passed), or a LaunchLab
 *                       pair whose locked voidBy day ended with a coin unverified; buildUnlink sends the permissionless unlink_pair.
 */

export interface ChainPairForwardOpts {
  connection: Connection;
  programId: PublicKey;
  cluster: Cluster;
  /** Pays the fees and cranks the forward. Null = read-only. */
  payer: Keypair | null;
  /** Attester keys that sign pair results (default: [payer]); on devnet the keeper key is both coins' attester. */
  attesters?: Keypair[];
  allowMainnet?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ZERO = BigInt(0);
const recordDateOf = (period: string): number => Number(period.replace(/-/g, ""));

function linkView(l: PairLinkAccount | null): PairLinkView | null {
  if (!l) return null;
  return { mint: l.mint.toBase58(), pairMint: l.pair_mint.toBase58(), paired: l.paired, witness: (l.witness === 1 ? 1 : 0), createdAt: Number(l.created_at), pairingDeadline: Number(l.pairing_deadline), pairedAt: l.paired ? Number(l.paired_at) : null, attesterSetHash: Buffer.from(l.attester_set_hash ?? new Uint8Array(32)).toString("hex") };
}

/** The loser fee PDA's lamport drop in a confirmed transaction (the SOL part of a forward). */
function lamportDrop(t: ParsedTransactionWithMeta, account: PublicKey): bigint {
  const keys = t.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey.toBase58()));
  const i = keys.indexOf(account.toBase58());
  if (i < 0 || !t.meta) return ZERO;
  const d = BigInt(t.meta.preBalances[i] ?? 0) - BigInt(t.meta.postBalances[i] ?? 0);
  return d > ZERO ? d : ZERO;
}

export class ChainPairForward implements PairForwardClient {
  readonly programId: string;
  readonly cluster: string;
  private readonly o: ChainPairForwardOpts;
  private readonly ports = new Map<string, PairForwardPort>();
  constructor(o: ChainPairForwardOpts) {
    this.o = o;
    this.programId = o.programId.toBase58();
    this.cluster = o.cluster;
  }
  port(mintAS: string, mintBS: string): PairForwardPort {
    const key = `${mintAS}|${mintBS}`;
    const have = this.ports.get(key);
    if (have) return have;
    const o = this.o, c = o.connection, A = new PublicKey(mintAS), B = new PublicKey(mintBS);
    const ctx: ProgramContext = { connection: c, programId: o.programId, mint: A, cluster: o.cluster, allowMainnet: o.allowMainnet };
    let rpcGenesis: string | null = null;
    let policy2 = false;   // set by links(): either coin is a pair_curve coin (registration policy 2)
    const need = async (): Promise<Keypair> => {
      if (!o.payer) throw new Error("read-only pair-forward client (no payer key): cannot sign");
      if (!rpcGenesis) rpcGenesis = await assertClusterAllowed(ctx);
      return o.payer;
    };
    const sign = async (ixs: Parameters<typeof signTransaction>[1], extra: Keypair[] = []): Promise<SignedTx> => {
      const payer = await need();
      const s = await signTransaction(ctx, ixs, [payer, ...extra.filter((k) => !k.publicKey.equals(payer.publicKey))]);
      return { signature: s.signature, raw: s.raw, blockhash: s.blockhash, lastValidBlockHeight: s.lastValidBlockHeight };
    };
    const mintOf = (s: string): PublicKey => (s === mintAS ? A : s === mintBS ? B : (() => { throw new Error(`${s} is not in the pair ${mintAS} / ${mintBS}`); })());
    const port: PairForwardPort = {
      mintA: mintAS,
      mintB: mintBS,
      async links() {
        const [ca, cb, la, lb] = await Promise.all([fetchTokenConfig(c, o.programId, A), fetchTokenConfig(c, o.programId, B), fetchPairLink(c, o.programId, A), fetchPairLink(c, o.programId, B)]);
        const st = (x: typeof ca): PairState => { const v = x?.config.pair_state ?? 0; return (v === 1 || v === 2 || v === 3 ? v : 0) as PairState; };
        const stateA = st(ca), stateB = st(cb);
        const paired = stateA === PAIR_STATE_PAIRED && stateB === PAIR_STATE_PAIRED && !!la?.pair_mint.equals(B) && !!lb?.pair_mint.equals(A);
        // r3: the locked voidBy (both coins the same for a LaunchLab pair) and the later pair_after_date (periods on/before it stay unpaired)
        const pairVoidBy = Math.max(ca?.config.pair_void_by ?? 0, cb?.config.pair_void_by ?? 0);
        const pairAfterDate = Math.max(ca?.config.pair_after_date ?? 0, cb?.config.pair_after_date ?? 0);
        policy2 = ca?.config.rule.pool_policy === POOL_POLICY_PAIR_CURVE || cb?.config.rule.pool_policy === POOL_POLICY_PAIR_CURVE;
        return { a: linkView(la), b: linkView(lb), stateA, stateB, paired, poolsVerified: [!!ca?.config.pool_verified, !!cb?.config.pool_verified] as [boolean, boolean], pairVoidBy, pairAfterDate };
      },
      async unlinkEvidence(nowMs: number): Promise<{ reason: UnlinkReason; pair: string | null } | null> {
        // r3: TERMINAL evidence only. A pair_curve pair (either coin policy 2, or a pair_curve witness) needs its Pair: Voided → 0, a
        // side refunding → 1; an Open pair (or Graduating without a refunding side) is never unlinked. A LaunchLab pair: its locked voidBy
        // day ended (UTC) with a coin still without a verified pool → 3. No time-based evidence (r2's 30-day rule is gone).
        const l = await port.links();
        if (!l.paired || !l.a || !l.b) return null;
        if (policy2 || l.a.witness === 1 || l.b.witness === 1) {
          for (const [x, y] of [[A, B], [B, A]] as const) {
            const addr = pairPda(x, y);
            const p = await fetchPair(c, addr).catch(() => null);
            if (!p) continue;
            if (p.status === STATUS_VOIDED) return { reason: UNLINK_PAIR_VOIDED as UnlinkReason, pair: addr.toBase58() };
            if (p.refunding.some(Boolean)) return { reason: UNLINK_SIDE_REFUNDING as UnlinkReason, pair: addr.toBase58() };
            return null;
          }
          return null;
        }
        const d = new Date(nowMs), today = d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
        const dead = !(l.poolsVerified?.[0] ?? false) || !(l.poolsVerified?.[1] ?? false);
        return l.pairVoidBy && today > l.pairVoidBy && dead ? { reason: UNLINK_VOID_BY_PASSED as UnlinkReason, pair: null } : null;
      },
      async buildUnlink(i: { pair: string | null }) {
        const payer = await need();
        return sign([unlinkPairIx({ programId: o.programId, cranker: payer.publicKey, mintA: A, mintB: B, ...(i.pair ? { pair: new PublicKey(i.pair) } : {}) })]);
      },
      async result(D: number): Promise<PairResultView | null> {
        const r = await fetchPairResult(c, o.programId, A, B, D);
        if (!r) return null;
        return { recordDate: r.record_date, winner: r.winner.equals(PublicKey.default) ? null : r.winner.toBase58(), submittedAt: Number(r.submitted_at), forwarded: r.forwarded, forwardedLamports: r.forwarded_lamports, forwardedAt: r.forwarded ? Number(r.forwarded_at) : null };
      },
      async buildSubmitResult(i: { recordDate: number; winner: string | null; sourceUrl: string; proofHash?: Uint8Array }) {
        const payer = await need();
        const cfg = await fetchTokenConfig(c, o.programId, A);
        if (!cfg) throw new Error(`The burn program (burn_receipts) has no config for mint ${mintAS}.`);
        const genesis = cfg.config.cluster_genesis.toBase58();
        // Never a mainnet-bound signature off mainnet; on devnet/mainnet the build's genesis must be the RPC's (as for readings).
        assertSignableGenesis(genesis, o.cluster, rpcGenesis!);
        const winner = i.winner === null ? null : mintOf(i.winner);
        const src = sourceUrlHash(i.sourceUrl);
        const attesters = o.attesters ?? [payer];
        const att = attestPairResult({ genesisHash: genesis, programId: o.programId, mintA: A, mintB: B, recordDate: i.recordDate, winner, sourceUrlHash: src, ...(i.proofHash ? { proofHash: i.proofHash } : {}), signers: attesters.map((k) => ({ publicKey: k.publicKey, secretKey: k.secretKey })) });
        return sign([att.instruction, submitPairResultIx({ programId: o.programId, payer: payer.publicKey, mintA: A, mintB: B, recordDate: i.recordDate, winner, sourceUrlHash: src, ...(i.proofHash ? { proofHash: i.proofHash } : {}) })]);
      },
      async buildForward(i: { loserMint: string; recordDate: number }) {
        const payer = await need();
        const loser = mintOf(i.loserMint), winner = loser.equals(A) ? B : A;
        return sign([
          createAtaIdempotentIx({ payer: payer.publicKey, owner: feePda(o.programId, winner), mint: NATIVE_MINT, ata: feeWsolAddress(o.programId, winner) }),
          forwardToWinnerIx({ programId: o.programId, cranker: payer.publicKey, loserMint: loser, winnerMint: winner, recordDate: i.recordDate }),
        ]);
      },
      async simulate(raw: Uint8Array) {
        const r = await c.simulateTransaction(VersionedTransaction.deserialize(raw), { commitment: "confirmed" });
        const logs = r.value.logs ?? [];
        return { err: r.value.err ? anchorErrorName(logs) ?? JSON.stringify(r.value.err) : null, logs };
      },
      async send(raw: Uint8Array) { await need(); await c.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }); },
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
      async forwardFacts(signature: string): Promise<(ForwardFacts & { memo: string | null }) | "none" | null> {
        const t = await c.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        if (!t?.meta || t.meta.err) return null;
        const memo = memoFromTransaction(t, o.programId);
        const f = memo ? parseForwardMemo(memo) : null;
        // The program always writes the forward memo (lamports=0 for a dead side or an amount under the floor); no memo = not a forward.
        if (!f) return "none";
        const loser = mintAS.startsWith(f.from) ? A : mintBS.startsWith(f.from) ? B : null;
        if (!loser) return null;
        const winner = loser.equals(A) ? B : A;
        const D = recordDateOf(f.period);
        const rd = await fetchReading(c, o.programId, configPda(o.programId, loser), D);
        const sol = lamportDrop(t, feePda(o.programId, loser));
        const solPart = sol > f.lamports ? f.lamports : sol;
        return { loserMint: loser.toBase58(), winnerMint: winner.toBase58(), recordDate: D, units: rd ? Number(rd.units) : 0, poolLamports: rd?.pool_lamports ?? ZERO, lamports: f.lamports, solLamports: solPart, wsolLamports: f.lamports - solPart, memo };
      },
    };
    this.ports.set(key, port);
    return port;
  }
}
