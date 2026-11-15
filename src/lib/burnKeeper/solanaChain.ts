import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import type { BuybackPort, ChainPort, ConfirmOutcome, SignedTx } from "@/lib/burnKeeper/cycle";
import { buildSwapTransaction, usdPrice, SOL_MINT } from "@/lib/burnKeeper/jupiterSwap";
import { validateSwapTransaction } from "@/lib/live/validateSwap";
import { base58Encode, burnCheckedIx, memoIx, vaultRefusal, type Cluster } from "@/lib/burnKeeper/solana";
import { claimVestedTokenIx } from "@/lib/burnKeeper/launchlab";
import { planGraduatedCreatorFeeClaim } from "@/lib/burnKeeper/creatorFees";
import { burnPoolFor, claimLaunchlabCreatorFeeIx } from "@/lib/burnKeeper/burnPool";

/**
 * THE SOLANA SIDE OF THE KEEPER (2026-10-09): ChainPort over web3.js — the only file that sends anything. Used by
 * scripts/burn-keeper.mts and scripts/burnkeeper-devnet-demo.mts; the tests use a fake ChainPort instead.
 *
 * One transaction per burn day: [compute-unit limit, optional priority price, BurnChecked(vault → amount) signed by the keeper,
 * Memo(canonical memo) signed by the keeper]. A shortfall day with an empty vault drops the burn and keeps the memo. Sent with
 * maxRetries 0 and rebroadcast by confirm() every few seconds until it lands or its blockhash expires — the lesson keypair-signer.mjs
 * records (an RPC that accepts a send and drops it reports success), applied here.
 */

export interface SolanaChainOpts {
  connection: Connection;
  keeper: Keypair;
  mint: PublicKey;
  vault: PublicKey;
  decimals: number;
  cluster: Cluster;
  /** micro-lamports per compute unit (0 = no priority fee). */
  priorityMicroLamports?: number;
  /** When set, the keeper tries a LaunchLab ClaimVestedToken into the vault before each burn day (simulated first). */
  launchLab?: { programId: PublicKey; poolId: PublicKey } | null;
  /**
   * Buyback mode: before a burn day, move the creator fees into THE BURN POOL — the burn program's fee PDA for the mint, which is the
   * launch creator (burnPool.ts, review finding H-2). The keeper only pays the fee: the bonding-curve vault through the program's
   * permissionless `claim_launchlab_creator_fee` (sent only once the IDL carries it), and once graduated the CPMM pool's counters
   * through Raydium's `collect_creator_fee_permissionless` (creatorFees.ts). `programId` is LaunchLab's, `burnProgram` burn_receipts'.
   */
  creatorFees?: { programId: PublicKey; burnProgram: PublicKey; cpmmProgram?: PublicKey; launchLabPool?: PublicKey } | null;
  log?: (s: string) => void;
}

export type SolanaChain = ChainPort & {
  supplyRaw(): Promise<bigint>;
  checkVault(): Promise<string | null>;
  tryClaim(): Promise<string | null>;
  tryClaimCreatorFees(): Promise<string | null>;
  /** Post-graduation: collect the CPMM pool's accrued creator fees (SOL side unwrapped into the fee pool; token side into the burn vault). */
  claimGraduatedCreatorFees(): Promise<string | null>;
  sendMemoOnly(memo: string): Promise<string>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function solanaChain(o: SolanaChainOpts): SolanaChain {
  const c = o.connection, kp = o.keeper, log = o.log ?? (() => {});

  async function sign(ixs: TransactionInstruction[]): Promise<SignedTx> {
    const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
    const pre: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 })];
    if (o.priorityMicroLamports && o.priorityMicroLamports > 0) pre.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: o.priorityMicroLamports }));
    const msg = new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: blockhash, instructions: [...pre, ...ixs] }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([kp]);
    return { signature: base58Encode(tx.signatures[0]), raw: tx.serialize(), blockhash, lastValidBlockHeight };
  }

  async function confirm(tx: SignedTx): Promise<ConfirmOutcome> {
    const started = Date.now();
    let lastSend = Date.now();
    while (Date.now() - started < 120_000) {
      await sleep(2_000);
      const st = (await c.getSignatureStatuses([tx.signature], { searchTransactionHistory: false })).value[0];
      if (st) {
        if (st.err) return { status: "failed", err: JSON.stringify(st.err) };
        if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return { status: "confirmed", slot: st.slot };
      }
      if ((await c.getBlockHeight("confirmed")) > tx.lastValidBlockHeight) return { status: "expired" };
      if (Date.now() - lastSend > 4_000) { lastSend = Date.now(); await c.sendRawTransaction(tx.raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {}); }
    }
    return { status: "expired" };   // not proven expired: the cycle re-checks status and block height before it signs anything new
  }

  const chain: SolanaChain = {
    async vaultBalanceRaw() {
      // Buyback mode: the keeper's token account is created by its first swap, so "no account yet" is a balance of 0 (vault mode
      // never gets here without one — the startup vault check refuses a missing vault).
      if (!(await c.getAccountInfo(o.vault, "confirmed"))) return BigInt(0);
      const r = await c.getTokenAccountBalance(o.vault, "confirmed");
      return BigInt(r.value.amount);
    },
    async findMemoOnChain(dateKey) {
      const sigs = await c.getSignaturesForAddress(kp.publicKey, { limit: 200 }, "confirmed");
      const hit = sigs.find((s) => s.err === null && typeof s.memo === "string" && s.memo.includes(dateKey));
      return hit ? { signature: hit.signature, slot: hit.slot ?? null, memo: (hit.memo as string).replace(/^\[\d+\]\s*/, "") } : null;
    },
    async signatureStatuses(signatures) {
      const v = (await c.getSignatureStatuses(signatures, { searchTransactionHistory: true })).value;
      return v.map((s) => (s ? { slot: s.slot ?? null, err: s.err ? JSON.stringify(s.err) : null, confirmed: s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized" } : null));
    },
    blockHeight: () => c.getBlockHeight("confirmed"),
    async buildSigned(burnRaw, memo) {
      const ixs: TransactionInstruction[] = [];
      if (burnRaw > BigInt(0)) ixs.push(burnCheckedIx({ account: o.vault, mint: o.mint, authority: kp.publicKey, amount: burnRaw, decimals: o.decimals }));
      ixs.push(memoIx(memo, kp.publicKey));
      return sign(ixs);
    },
    async simulate(raw) {
      const r = await c.simulateTransaction(VersionedTransaction.deserialize(raw), { sigVerify: true, commitment: "confirmed" });
      return { err: r.value.err ? JSON.stringify(r.value.err) : null, logs: r.value.logs ?? [] };
    },
    async send(raw) { await c.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }); },
    confirm,
    async supplyRaw() { return BigInt((await c.getTokenSupply(o.mint, "confirmed")).value.amount); },
    async checkVault() {
      const info = await c.getParsedAccountInfo(o.vault, "confirmed");
      return vaultRefusal(info.value?.data ?? null, info.value ? info.value.owner.toBase58() : null, { mint: o.mint.toBase58(), keeper: kp.publicKey.toBase58() });
    },
    async tryClaim() {
      if (!o.launchLab) return null;
      const tx = await sign([claimVestedTokenIx({ programId: o.launchLab.programId, beneficiary: kp.publicKey, poolId: o.launchLab.poolId, mintA: o.mint, beneficiaryTokenAccount: o.vault })]);
      const sim = await chain.simulate(tx.raw);
      if (sim.err) { log(`  [claim] nothing claimable now (${sim.err.slice(0, 80)}${sim.logs.length ? ` · ${sim.logs[sim.logs.length - 1].slice(0, 80)}` : ""})`); return null; }
      await chain.send(tx.raw);
      const r = await confirm(tx);
      if (r.status === "confirmed") { log(`  [claim] vested tokens claimed into the vault: ${tx.signature}`); return tx.signature; }
      log(`  [claim] claim ${tx.signature.slice(0, 12)}… ${r.status}`);
      return null;
    },
    async tryClaimCreatorFees() {
      if (!o.creatorFees) return null;
      const claim = claimLaunchlabCreatorFeeIx({ programId: o.creatorFees.burnProgram, payer: kp.publicKey, mint: o.mint, launchLabProgram: o.creatorFees.programId });
      if (claim.source === "fake") { log(`  [fees] the burn program's IDL has no claim_launchlab_creator_fee yet — the curve creator fees stay in LaunchLab's vault for the fee PDA ${burnPoolFor(o.creatorFees.burnProgram, o.mint).feePda.toBase58()}; nothing sent`); return null; }
      const tx = await sign([claim.instruction]);
      const sim = await chain.simulate(tx.raw);
      if (sim.err) { log(`  [fees] no curve creator fees claimable now (${sim.err.slice(0, 80)})`); return null; }
      await chain.send(tx.raw);
      const r = await confirm(tx);
      if (r.status === "confirmed") { log(`  [fees] curve creator fees moved into the burn pool's WSOL account: ${tx.signature}`); return tx.signature; }
      log(`  [fees] claim ${tx.signature.slice(0, 12)}… ${r.status}`);
      return null;
    },
    async claimGraduatedCreatorFees() {
      if (!o.creatorFees?.cpmmProgram) return null;
      const burnPool = burnPoolFor(o.creatorFees.burnProgram, o.mint).feePda;
      const plan = await planGraduatedCreatorFeeClaim({ payer: kp.publicKey, burnPool, mint: o.mint, launchLabProgram: o.creatorFees.programId, cpmmProgram: o.creatorFees.cpmmProgram, launchLabPool: o.creatorFees.launchLabPool },
        { getAccount: async (k) => { const a = await c.getAccountInfo(k, "confirmed"); return a ? { data: a.data, owner: a.owner } : null; } });
      if (plan.kind === "skip") { log(`  [fees/cpmm] ${plan.why}`); return null; }
      const tx = await sign(plan.instructions);
      const sim = await chain.simulate(tx.raw);
      if (sim.err) { log(`  [fees/cpmm] the program refused the claim (${sim.err.slice(0, 80)}${sim.logs.length ? ` · ${sim.logs[sim.logs.length - 1].slice(0, 80)}` : ""})`); return null; }
      await chain.send(tx.raw);
      const r = await confirm(tx);
      if (r.status === "confirmed") { log(`  [fees/cpmm] collected ${plan.accrued.sol} lamports (+ ${plan.accrued.token} raw tokens) into the burn pool ${burnPool.toBase58()} from pool ${plan.poolId.toBase58()}: ${tx.signature}`); return tx.signature; }
      log(`  [fees/cpmm] claim ${tx.signature.slice(0, 12)}… ${r.status}`);
      return null;
    },
    async sendMemoOnly(memo) {
      const tx = await sign([memoIx(memo, kp.publicKey)]);
      const sim = await chain.simulate(tx.raw);
      if (sim.err) throw new Error(`memo simulation refused: ${sim.err}`);
      await chain.send(tx.raw);
      const r = await confirm(tx);
      if (r.status !== "confirmed") throw new Error(`memo ${tx.signature} ${r.status}`);
      return tx.signature;
    },
  };
  return chain;
}

/**
 * THE BUYBACK LEG ON SOLANA (the owner, 2026-10-09 evening). The swap is built by the keeper's own Jupiter client
 * (src/lib/burnKeeper/jupiterSwap.ts — the same lite-API request shape as the rest of the repo, self-contained so the public keeper
 * imports no private code) and checked by the shared validator (src/lib/live/validateSwap.ts: program allowlist, the keeper as fee
 * payer and only signer, SOL in, THIS mint out) before it is signed. Market order, the rule file's slippage, no timing discretion. It never sells: the input mint is hard-wired to SOL and the
 * output to BURNKEEPER_MINT, and a quote or transaction naming anything else is refused. What the swap delivered is read from the
 * transaction's own token balances (raw integer amounts), not from the quote.
 */
export function solanaBuyback(o: { connection: Connection; keeper: Keypair; mint: PublicKey; slippageBps: number }): BuybackPort {
  const c = o.connection, owner = o.keeper.publicKey.toBase58(), mint = o.mint.toBase58();
  return {
    feeBalanceLamports: async () => BigInt(await c.getBalance(o.keeper.publicKey, "confirmed")),
    async solUsd() {
      const p = await usdPrice(SOL_MINT);
      if (p === null) throw new Error("SOL price unavailable (Jupiter price API)");
      return p;
    },
    async buildSwap(lamports) {
      const built = await buildSwapTransaction({ inputMint: SOL_MINT, outputMint: mint, amountBaseUnits: lamports.toString(), ownerAddress: owner, slippageBps: o.slippageBps });
      if (built.status !== "ok" || !built.swapTransaction) throw new Error(`router: ${built.reason ?? built.status}`);
      if (built.summary && (built.summary.inputMint !== SOL_MINT || built.summary.outputMint !== mint)) throw new Error(`router quoted ${built.summary.inputMint} → ${built.summary.outputMint}, not SOL → ${mint} — refused`);
      const v = validateSwapTransaction(built.swapTransaction, { ownerAddress: owner, inputMint: SOL_MINT, outputMint: mint });
      if (!v.ok) throw new Error(`swap refused before signing: ${v.violations.join("; ")}`);
      const tx = VersionedTransaction.deserialize(Buffer.from(built.swapTransaction, "base64"));
      tx.sign([o.keeper]);
      // The router's transaction carries its own blockhash; its last valid height is over-estimated (+300 blocks, about twice the
      // real life), which can only make the keeper WAIT longer before re-signing — never re-sign while the first could still land.
      const height = await c.getBlockHeight("confirmed");
      return { signature: base58Encode(tx.signatures[0]), raw: tx.serialize(), blockhash: tx.message.recentBlockhash, lastValidBlockHeight: height + 300, quotedOutRaw: BigInt(built.summary?.outAmount ?? "0") };
    },
    async swapReceivedRaw(signature) {
      const t = await c.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!t?.meta) return null;
      if (t.meta.err) throw new Error(`swap ${signature} reverted`);
      const sum = (xs: typeof t.meta.postTokenBalances) => (xs ?? []).filter((x) => x.owner === owner && x.mint === mint).reduce((a, x) => a + BigInt(x.uiTokenAmount.amount), BigInt(0));
      const got = sum(t.meta.postTokenBalances) - sum(t.meta.preTokenBalances);
      return got > BigInt(0) ? got : BigInt(0);
    },
  };
}
