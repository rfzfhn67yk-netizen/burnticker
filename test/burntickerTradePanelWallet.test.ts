// PRELAUNCH AUDIT 2026-10-18 F04: A WALLET SWITCH DISPLAYED THE PREVIOUS WALLET'S BALANCE. The swap panel's reads wrote their results with
// no request generation and no owner check, so wallet A's late balance overwrote wallet B's while B was connected ("This wallet holds 10
// SOL" for a wallet holding 2). These run the whole Swap component (test/burntickerTradePanelHarness.ts) through both completion orders,
// a held swap's status read outstanding across a switch, and a swap that completes for A after the visitor switched to B.
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair, type PublicKey, type VersionedTransaction } from "@solana/web3.js";
import { SwapHarness, ACCOUNTS, FX, deferred } from "./burntickerTradePanelHarness.ts";
import { GENESIS_HASH } from "@/lib/burnticker/swap/chain";
import { decodeCurvePool } from "@/lib/burnticker/swap/layouts";
import { outcomeKey, savePending, type PendingSwap, type SwapStore } from "@/lib/burnticker/swap/pending";
import { SWAP_COPY } from "@/lib/burnticker/swap/copy";

const MINT = decodeCurvePool(Buffer.from(FX.curvePool.data!, "base64")).mintA.toBase58();
const props = { ticker: "AUDIT", mint: MINT, status: "live", cluster: "devnet", network: "devnet", graduatedPool: null, poolBurnBps: 100, links: [], operatorWallets: [] };
const SOL = 1_000_000_000;
class MemStore implements SwapStore { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
const g = globalThis as { localStorage?: SwapStore };
beforeEach(() => { g.localStorage = new MemStore(); });   // SEC-02: a browser that keeps records (a test can replace it)
afterEach(() => { delete g.localStorage; });

/** An RPC whose balance and status answers can be held per wallet and released in any order. */
class Rpc {
  balance = new Map<string, () => Promise<number>>();
  status = new Map<string, () => Promise<{ err: unknown; confirmationStatus?: string } | null>>();
  balanceReads: string[] = []; sends = 0;
  async getGenesisHash() { return GENESIS_HASH.devnet; }
  async getMultipleAccountsInfo(keys: PublicKey[]) { return keys.map((k) => ACCOUNTS.get(k.toBase58()) ?? null); }
  async getBalance(owner: PublicKey) { this.balanceReads.push(owner.toBase58()); return (this.balance.get(owner.toBase58()) ?? (async () => 0))(); }
  async getBlockHeight() { return 100; }
  async getLatestBlockhash() { return { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 200 }; }
  async simulateTransaction() { return { value: { err: null, logs: [] as string[], unitsConsumed: 1 } }; }
  async sendRawTransaction() { this.sends++; return "unused"; }
  async getSignatureStatuses(sigs: string[]) { return { value: await Promise.all(sigs.map((s) => (this.status.get(s) ?? (async () => ({ err: null, confirmationStatus: "confirmed" })))())) }; }
  async getTransaction() { return null; }
}
const walletOf = (kp: Keypair, sign?: (t: VersionedTransaction) => Promise<VersionedTransaction>) => ({ publicKey: kp.publicKey, connected: true, signTransaction: sign ?? (async (t: VersionedTransaction) => { t.sign([kp]); return t; }) });
const held = (owner: PublicKey, signature: string): PendingSwap => ({ v: 1, network: "devnet", mint: MINT, owner: owner.toBase58(), signature, lastValidBlockHeight: 150, side: "sol-in", at: Date.now() });

describe("F04: the swap panel's reads belong to the wallet that started them", () => {
  test("A's balance lands late, after B's: B keeps B's holdings while B is connected", async () => {
    const A = Keypair.generate(), B = Keypair.generate(), rpc = new Rpc();
    const a = deferred<number>();
    rpc.balance.set(A.publicKey.toBase58(), () => a.p);
    rpc.balance.set(B.publicKey.toBase58(), async () => 2 * SOL);
    const h = await SwapHarness.mount(props, walletOf(A), rpc);
    assert.deepEqual(rpc.balanceReads, [A.publicKey.toBase58()], "A's read is outstanding");
    await h.switchWallet(walletOf(B));
    assert.match(h.holds() ?? "", /holds 2 SOL/);
    a.ok(10 * SOL); await h.settle();
    assert.match(h.holds() ?? "", /holds 2 SOL/, "A's late answer does not overwrite B's");
    assert.doesNotMatch(h.text(), /10 SOL/);
  });

  test("B's balance lands late, after A's: A's never shows while B is connected, then B's does", async () => {
    const A = Keypair.generate(), B = Keypair.generate(), rpc = new Rpc();
    const a = deferred<number>(), b = deferred<number>();
    rpc.balance.set(A.publicKey.toBase58(), () => a.p);
    rpc.balance.set(B.publicKey.toBase58(), () => b.p);
    const h = await SwapHarness.mount(props, walletOf(A), rpc);
    await h.switchWallet(walletOf(B));
    a.ok(10 * SOL); await h.settle();
    assert.equal(h.holds(), null, "nothing is shown for B until B's own read lands");
    b.ok(2 * SOL); await h.settle();
    assert.match(h.holds() ?? "", /holds 2 SOL/);
    assert.doesNotMatch(h.text(), /10 SOL/);
  });

  test("a switch clears the earlier wallet's balance and its success message at once", async () => {
    const A = Keypair.generate(), B = Keypair.generate(), rpc = new Rpc(), store = new MemStore();
    g.localStorage = store;
    savePending(store, held(A.publicKey, "5".repeat(88)));
    const b = deferred<number>();
    rpc.balance.set(A.publicKey.toBase58(), async () => 10 * SOL);
    rpc.balance.set(B.publicKey.toBase58(), () => b.p);
    const h = await SwapHarness.mount(props, walletOf(A), rpc);
    assert.ok(h.find("data-swap-receipt"), "A's held swap settled as confirmed");
    assert.match(h.text(), new RegExp(SWAP_COPY.earlierConfirmed));
    await h.switchWallet(walletOf(B));
    assert.equal(h.find("data-swap-receipt"), undefined, "A's success message is gone for B");
    assert.equal(h.holds(), null, "A's balance is gone for B");
    b.ok(2 * SOL); await h.settle();
    assert.match(h.holds() ?? "", /holds 2 SOL/);
  });

  test("switching while A's held-swap status read is outstanding: its answer never shows for B", async () => {
    const A = Keypair.generate(), B = Keypair.generate(), rpc = new Rpc(), store = new MemStore();
    g.localStorage = store;
    const sig = "4".repeat(88);
    savePending(store, held(A.publicKey, sig));
    const st = deferred<{ err: unknown; confirmationStatus?: string } | null>();
    rpc.status.set(sig, () => st.p);
    rpc.balance.set(A.publicKey.toBase58(), async () => 10 * SOL);
    rpc.balance.set(B.publicKey.toBase58(), async () => 2 * SOL);
    const h = await SwapHarness.mount(props, walletOf(A), rpc);
    assert.ok(h.find("data-swap-pending"), "A's swap is held and its status read is outstanding");
    h.wallet = walletOf(B); h.render();
    assert.equal(h.find("data-swap-pending"), undefined, "A's held swap does not show for B, from B's first render");
    assert.equal(h.swapButton()?.props.disabled, true, "nothing to swap yet, but not because of A's held swap");
    await h.settle();
    assert.equal(h.find("data-swap-pending"), undefined, "A's held swap does not show for B");
    st.ok({ err: null, confirmationStatus: "confirmed" }); await h.settle();
    assert.equal(h.find("data-swap-receipt"), undefined, "A's confirmation does not show for B");
    assert.equal(h.find("data-swap-pending"), undefined);
    assert.match(h.holds() ?? "", /holds 2 SOL/);
    assert.doesNotMatch(h.text(), /10 SOL/);
    await h.switchWallet(walletOf(A));
    assert.equal(h.find("data-swap-pending"), undefined, "back on A, the swap is settled (its record was cleared)");
    assert.match(h.text(h.find("data-swap-receipt")), new RegExp(SWAP_COPY.earlierConfirmed.replace(/\./g, "\\.")), "and A sees that its earlier swap is confirmed");
    assert.match(h.holds() ?? "", /holds 10 SOL/);
  });

  test("a swap that completes for A after the visitor switched to B: A's receipt and balance never show for B", async () => {
    const A = Keypair.generate(), B = Keypair.generate(), rpc = new Rpc();
    g.localStorage = new MemStore();
    rpc.balance.set(A.publicKey.toBase58(), async () => 10 * SOL);
    rpc.balance.set(B.publicKey.toBase58(), async () => 2 * SOL);
    const signed = deferred<void>();
    const h = await SwapHarness.mount(props, walletOf(A, async (t) => { await signed.p; t.sign([A]); return t; }), rpc);
    await h.type("1");
    assert.equal(h.swapButton()?.props.disabled, false);
    await h.click(h.swapButton());
    await h.switchWallet(walletOf(B));
    signed.ok(); await h.settle();
    assert.equal(rpc.sends, 1, "A's swap was sent");
    assert.equal(h.find("data-swap-receipt"), undefined, "A's confirmation does not show for B");
    assert.match(h.holds() ?? "", /holds 2 SOL/);
    assert.doesNotMatch(h.text(), /10 SOL/);
    // review follow-up: A's outcome was kept for A (localStorage, network:mint:owner) and shows, once, when A is connected again
    await h.switchWallet(walletOf(A));
    const receipt = h.find("data-swap-receipt");
    assert.ok(receipt, "back on A, A's confirmation shows");
    assert.match(h.text(receipt), new RegExp(SWAP_COPY.confirmed.replace(".", "\\.")));
    await h.switchWallet(walletOf(B));
    await h.switchWallet(walletOf(A));
    assert.equal(h.find("data-swap-receipt"), undefined, "shown once, then gone");
  });

  test("review: A's held swap that fails on chain while B is connected shows its failure line when A is back", async () => {
    const A = Keypair.generate(), B = Keypair.generate(), rpc = new Rpc(), store = new MemStore();
    g.localStorage = store;
    const sig = "3".repeat(88);
    savePending(store, held(A.publicKey, sig));
    const st = deferred<{ err: unknown; confirmationStatus?: string } | null>();
    rpc.status.set(sig, () => st.p);
    rpc.balance.set(A.publicKey.toBase58(), async () => 10 * SOL);
    rpc.balance.set(B.publicKey.toBase58(), async () => 2 * SOL);
    const h = await SwapHarness.mount(props, walletOf(A), rpc);
    await h.switchWallet(walletOf(B));
    st.ok({ err: { InstructionError: [0, "Custom"] } }); await h.settle();
    assert.equal(h.refusal(), null, "nothing of A's shows for B");
    assert.ok(store.getItem(outcomeKey("devnet", MINT, A.publicKey.toBase58())), "kept under network:mint:owner");
    await h.switchWallet(walletOf(A));
    assert.match(h.refusal() ?? "", /^The swap failed on chain/, "A's failure line shows when A is back");
    assert.equal(store.getItem(outcomeKey("devnet", MINT, A.publicKey.toBase58())), null, "and the record is used up");
  });
});
