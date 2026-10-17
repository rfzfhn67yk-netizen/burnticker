import { type Connection, type Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { fetchTokenConfig } from "@/lib/burnReceipts/accounts";
import { sourceUrlHash } from "@/lib/burnReceipts/attestation";
import { assertSignableGenesis, NATIVE_MINT, type Cluster } from "@/lib/burnReceipts/constants";
import { anchorErrorName, assertClusterAllowed, chainNowSec, memoFromTransaction, signTransaction, type ProgramContext } from "@/lib/burnReceipts/crank";
import { attestRuleEnd, carryHeldBack, END_SINK_FLAGSHIP, END_SINK_INCINERATOR, END_SINK_MINT, END_SINK_PAIR_WINNER, END_STATE_RESOLVED, END_STATE_VOID, fetchEndSink, fetchRuleEnd, FLAGSHIP_MINT, parseEndForwardMemo, planForwardOnEnd, submitRuleEndIx } from "@/lib/burnReceipts/endSink";
import { associatedTokenAddress, feePda } from "@/lib/burnReceipts/pda";
import type { ConfirmOutcome, SignedTx } from "@/lib/burnKeeper/programPort";
import type { EndSinkClient, EndSinkKindView, EndSinkPort, EndForwardReadiness } from "@/lib/burnticker/endSinkClient";

/**
 * THE REAL END-SINK CLIENT (LAUNCHPAD-PATH §45), bound to the program builder's src/lib/burnReceipts/endSink.ts. The keeper
 * (endSinkKeeper.ts) uses it through EndSinkPort. Without a payer key it is READ-ONLY (the app server). Not in the public SDK's closure.
 *   buildRuleEnd   ONE Ed25519SigVerify (attestRuleEnd: every attester key signs BURNRECEIPTS-END-v1) + submit_rule_end.
 *   planForward    planForwardOnEnd: the destination exactly as end.rs computes it.
 *   buildForward   the target fee PDA's WSOL account (idempotent) + forward_on_end.
 */
export interface ChainEndSinkOpts {
  connection: Connection;
  programId: PublicKey;
  cluster: Cluster;
  payer: Keypair | null;
  attesters?: Keypair[];
  allowMainnet?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KIND: Record<number, EndSinkKindView> = { [END_SINK_FLAGSHIP]: "flagship", [END_SINK_MINT]: "mint", [END_SINK_PAIR_WINNER]: "pair-winner", [END_SINK_INCINERATOR]: "incinerator" };

export class ChainEndSink implements EndSinkClient {
  readonly flagship: string;
  private readonly o: ChainEndSinkOpts;
  private readonly ports = new Map<string, EndSinkPort>();
  constructor(o: ChainEndSinkOpts) { this.o = o; this.flagship = FLAGSHIP_MINT[o.cluster].toBase58(); }
  port(mintS: string): EndSinkPort {
    const have = this.ports.get(mintS);
    if (have) return have;
    const o = this.o, c = o.connection, mint = new PublicKey(mintS);
    const ctx: ProgramContext = { connection: c, programId: o.programId, mint, cluster: o.cluster, allowMainnet: o.allowMainnet };
    let rpcGenesis: string | null = null;
    const need = async (): Promise<Keypair> => {
      if (!o.payer) throw new Error("read-only end-sink client (no payer key): cannot sign");
      if (!rpcGenesis) rpcGenesis = await assertClusterAllowed(ctx);
      return o.payer;
    };
    const sign = async (ixs: Parameters<typeof signTransaction>[1]): Promise<SignedTx> => {
      const s = await signTransaction(ctx, ixs, [await need()]);
      return { signature: s.signature, raw: s.raw, blockhash: s.blockhash, lastValidBlockHeight: s.lastValidBlockHeight };
    };
    const port: EndSinkPort = {
      mint: mintS,
      async endSink() {
        const s = await fetchEndSink(c, o.programId, mint);
        return s ? { kind: KIND[s.sink_kind] ?? "league-set", sinkMint: s.sink_mint.toBase58(), minForwardLamports: BigInt(s.min_forward_lamports) } : null;
      },
      async ruleEnd() {
        const r = await fetchRuleEnd(c, o.programId, mint);
        if (!r) return null;
        return { recordDate: r.record_date, outcome: r.outcome === END_STATE_RESOLVED ? "resolved" : "void", forwardedLamports: BigInt(r.forwarded_lamports), forwards: r.forwards, lastForwardAt: Number(r.last_forward_at) };
      },
      async spendableLamports() {
        const cfg = await fetchTokenConfig(c, o.programId, mint);
        if (!cfg) return BigInt(0);
        const fee = feePda(o.programId, mint), w = associatedTokenAddress(fee, NATIVE_MINT);
        const sol = BigInt(await c.getBalance(fee, "confirmed"));
        const wsol = (await c.getAccountInfo(w, "confirmed")) ? BigInt((await c.getTokenAccountBalance(w, "confirmed")).value.amount) : BigInt(0);
        const above = sol > cfg.config.rule.reserve_lamports ? sol - cfg.config.rule.reserve_lamports : BigInt(0);
        // round-5 R5-4: inside the 30-day grace after a RESOLVED end the carried spend stays on the coin (crank_carried drains it)
        const re = cfg.config.end_state === END_STATE_RESOLVED ? await fetchRuleEnd(c, o.programId, mint) : null;
        // judged on the CHAIN's clock (the latest confirmed block time, as the program's Clock), not this host's; the local clock only
        // when the RPC cannot say
        const nowSec = re ? (await chainNowSec(c)) ?? Math.floor(Date.now() / 1000) : 0;
        const held = re ? carryHeldBack(cfg.config, Number(re.submitted_at), nowSec) : BigInt(0);
        return above + wsol > held ? above + wsol - held : BigInt(0);
      },
      async buildRuleEnd(i) {
        const payer = await need();
        const cfg = await fetchTokenConfig(c, o.programId, mint);
        if (!cfg) throw new Error(`The burn program (burn_receipts) has no config for mint ${mintS}.`);
        const genesis = cfg.config.cluster_genesis.toBase58();
        assertSignableGenesis(genesis, o.cluster, rpcGenesis!);
        const outcome = i.outcome === "resolved" ? END_STATE_RESOLVED : END_STATE_VOID;
        const src = sourceUrlHash(i.sourceUrl);
        const att = attestRuleEnd({ genesisHash: genesis, programId: o.programId, mint, recordDate: i.recordDate, outcome, sourceUrlHash: src, ...(i.proofHash ? { proofHash: i.proofHash } : {}), signers: (o.attesters ?? [payer]).map((k) => ({ publicKey: k.publicKey, secretKey: k.secretKey })) });
        const tx = await sign([att.instruction, submitRuleEndIx({ programId: o.programId, payer: payer.publicKey, mint, recordDate: i.recordDate, outcome, sourceUrlHash: src, ...(i.proofHash ? { proofHash: i.proofHash } : {}) })]);
        return { ...tx, message: att.message.toString("utf8") };
      },
      async planForward(): Promise<EndForwardReadiness> {
        const cranker = o.payer?.publicKey ?? PublicKey.default;
        const p = await planForwardOnEnd(c, o.programId, o.cluster, mint, cranker);
        return p.status === "ready" ? { status: "ready", target: p.target.toBase58(), intended: p.intended.toBase58() } : { status: p.status };
      },
      async buildForward() {
        const payer = await need();
        const p = await planForwardOnEnd(c, o.programId, o.cluster, mint, payer.publicKey);
        if (p.status !== "ready") throw new Error(`forward_on_end is not ready: ${p.status}`);
        return sign(p.instructions);
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
      async forwardFacts(signature: string) {
        const t = await c.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        if (!t?.meta || t.meta.err) return null;
        const memo = memoFromTransaction(t, o.programId);
        const f = memo ? parseEndForwardMemo(memo) : null;
        return f && memo ? { to12: f.to12, lamports: f.lamports, memo } : null;
      },
    };
    this.ports.set(mintS, port);
    return port;
  }
}
