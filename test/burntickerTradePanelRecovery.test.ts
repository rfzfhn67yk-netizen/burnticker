// PRELAUNCH AUDIT 2026-10-18 F03: AN INITIAL RPC ERROR BLOCKED THE SWAP FOR GOOD. The panel's first market/network/balance read ran once,
// outside any flight; its failure set the market error and the Swap button refused until a reload, and a failed genesis read was shown
// as "not on the coin's network". These run the WHOLE Swap component (test/burntickerTradePanelHarness.ts) from an RPC that refuses at
// first: the sentence is the right one, a "Try again" (and a background retry with backoff) recovers without a reload, and with the
// ordinary lane spent the Try again still works through a bounded flight.
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { PublicKey } from "@solana/web3.js";
import { SwapHarness, ACCOUNTS, FX, FakeDocument, newKey } from "./burntickerTradePanelHarness.ts";
import { GENESIS_HASH, connectionOn } from "@/lib/burnticker/swap/chain";
import { decodeCurvePool } from "@/lib/burnticker/swap/layouts";
import { REFUSAL, SWAP_COPY } from "@/lib/burnticker/swap/copy";
import { RPC_BUDGET_REFUSAL, flightUnderWay, isBudgetRefusal } from "@/lib/burnticker/rpcProxy";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import type { SwapStore } from "@/lib/burnticker/swap/pending";

// continuous audit 2026-10-19 SEC-02: the panel swaps only in a browser that keeps its records, so each run has a working localStorage
class MemStore implements SwapStore { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
const g = globalThis as { localStorage?: SwapStore };
beforeEach(() => { g.localStorage = new MemStore(); });
afterEach(() => { delete g.localStorage; });

const MINT = decodeCurvePool(Buffer.from(FX.curvePool.data!, "base64")).mintA.toBase58();
const props = { ticker: "AUDIT", mint: MINT, status: "live", cluster: "devnet", network: "devnet", graduatedPool: null, poolBurnBps: 100, links: [], operatorWallets: [] };

/** The browser's RPC as the panel sees it: down until `up`, or (spent) answering only inside a flight, like the proxy's spent lane. */
class Rpc {
  up = false; spent = false; flightFails = false; genesis = GENESIS_HASH.devnet; calls = 0; flightCalls = 0;
  /** when set, the first read made under a flight waits for it (to let a background timer come due meanwhile) */
  holdFlight: Promise<void> | null = null;
  private gate() {
    this.calls++;
    if (flightUnderWay()) this.flightCalls++;
    // the proxy's spent lane as web3.js reports it: the 503 status and the JSON-RPC body in the error text
    if (this.spent && (!flightUnderWay() || this.flightFails)) throw new Error(`503 Service Unavailable: {"jsonrpc":"2.0","id":null,"error":{"code":-32005,"message":"${RPC_BUDGET_REFUSAL}"}}`);
    if (!this.up) throw new Error("failed to fetch");
  }
  async getGenesisHash() { if (flightUnderWay() && this.holdFlight) { const h = this.holdFlight; this.holdFlight = null; await h; } this.gate(); return this.genesis; }
  async getMultipleAccountsInfo(keys: PublicKey[]) { this.gate(); return keys.map((k) => ACCOUNTS.get(k.toBase58()) ?? null); }
  async getBalance() { this.gate(); return 5_000_000_000; }
}
const wallet = () => ({ publicKey: newKey(), connected: true, signTransaction: async (t: unknown) => t });
const enabled = (h: SwapHarness) => h.swapButton()?.props.disabled === false;
const tryAgain = (h: SwapHarness) => h.find("data-swap-retry");

describe("F03: the swap panel recovers from a first read that failed", () => {
  test("a failed genesis read says the network could not be read, not that it is the wrong network", async () => {
    await assert.rejects(connectionOn({ getGenesisHash: async () => { throw new Error("failed to fetch"); } }, "devnet"), (e: Error) => e.message === REFUSAL.networkUnreadable);
    assert.equal(await connectionOn({ getGenesisHash: async () => GENESIS_HASH.mainnet }, "devnet"), false, "a hash that was read and differs is the wrong network");
    assert.equal(await connectionOn({ getGenesisHash: async () => GENESIS_HASH.devnet }, "devnet"), true);
  });

  test("from an RPC that refuses: Swap disabled with the right sentence; the RPC recovers; Try again enables quoting without a reload", async () => {
    const rpc = new Rpc();
    const h = await SwapHarness.mount(props, wallet(), rpc);
    await h.type("1");
    assert.equal(enabled(h), false, "nothing to quote from");
    assert.equal(h.refusal(), REFUSAL.networkUnreadable);
    assert.notEqual(h.refusal(), REFUSAL.wrongNetwork);
    assert.ok(tryAgain(h), "an explicit Try again is offered");
    rpc.up = true;
    await h.click(tryAgain(h));
    assert.equal(h.refusal(), null, "the recoverable error is cleared on success");
    assert.ok(h.find("data-swap-quote"), "a quote is shown");
    assert.equal(enabled(h), true, "the Swap button is enabled");
    assert.equal(tryAgain(h), undefined);
  });

  test("the background retry recovers on its own, with backoff", async () => {
    const rpc = new Rpc();
    const h = await SwapHarness.mount(props, wallet(), rpc);
    await h.type("1");
    const first = rpc.calls;
    await h.advance(1_000);
    assert.equal(rpc.calls, first, "no retry before the first backoff");
    await h.advance(3_000);
    assert.ok(rpc.calls > first, "the first background retry ran");
    const second = rpc.calls;
    await h.advance(3_000);
    assert.equal(rpc.calls, second, "the next one waits longer");
    rpc.up = true;
    await h.advance(60_000);
    assert.equal(h.refusal(), null);
    assert.equal(enabled(h), true, "quoting is enabled without a click or a reload");
    const settled = rpc.calls;
    await h.advance(120_000);
    assert.equal(rpc.calls, settled, "no retries after a success");
  });

  test("with the ordinary lane spent, the background retry cannot recover but Try again does, inside a bounded flight", async () => {
    const rpc = new Rpc(); rpc.up = true; rpc.spent = true;
    const h = await SwapHarness.mount(props, wallet(), rpc);
    await h.type("1");
    assert.equal(enabled(h), false);
    assert.equal(h.refusal(), REFUSAL.networkUnreadable);
    await h.advance(10_000);
    assert.equal(enabled(h), false, "the passive retry stays in the ordinary lane");
    assert.equal(rpc.flightCalls, 0, "no flight is spent on passive reads");
    await h.click(tryAgain(h));
    assert.ok(rpc.flightCalls > 0, "the Try again read rode the flight");
    assert.equal(flightUnderWay(), false, "the flight is over once the read lands");
    assert.equal(h.refusal(), null);
    assert.equal(enabled(h), true);
  });

  test("review: Try again uses the flight only after the ordinary lane refused for its budget; any other failure never touches the token", async () => {
    assert.equal(isBudgetRefusal(new Error("failed to fetch")), false);
    assert.equal(isBudgetRefusal(new Error("x", { cause: new Error(`503 Service Unavailable: ${RPC_BUDGET_REFUSAL}`) })), true, "found through the cause chain");
    const rpc = new Rpc();
    const h = await SwapHarness.mount(props, wallet(), rpc);
    await h.click(tryAgain(h));
    await h.click(tryAgain(h));
    assert.equal(rpc.flightCalls, 0, "an outage is retried in the ordinary lane only");
    assert.equal(h.refusal(), REFUSAL.networkUnreadable);
  });

  test("review: at most one flight read per 10 minutes per mount, so the swap keeps its token's calls", async () => {
    const rpc = new Rpc(); rpc.up = true; rpc.spent = true; rpc.flightFails = true;
    const realNow = Date.now, t0 = realNow();
    try {
      const h = await SwapHarness.mount(props, wallet(), rpc);
      await h.click(tryAgain(h));
      const first = rpc.flightCalls;
      assert.ok(first > 0 && first <= 5, `one flight read (${first} calls)`);
      Date.now = () => t0 + 9 * 60_000;
      await h.click(tryAgain(h));
      assert.equal(rpc.flightCalls, first, "a second press inside 10 minutes stays in the ordinary lane");
      Date.now = () => t0 + 11 * 60_000;
      rpc.flightFails = false;
      await h.click(tryAgain(h));
      assert.ok(rpc.flightCalls > first, "after 10 minutes the flight is allowed again");
      assert.equal(enabled(h), false, "no amount entered yet");
      assert.equal(h.refusal(), null, "and the read recovered");
    } finally { Date.now = realNow; }
  });

  test("review: a background retry that comes due during a Try again flight does not read under the token", async () => {
    const rpc = new Rpc(); rpc.up = true; rpc.spent = true;
    const h = await SwapHarness.mount(props, wallet(), rpc);
    let release!: () => void;
    rpc.holdFlight = new Promise<void>((r) => { release = r; });
    const press = h.click(tryAgain(h));
    await h.advance(120_000);
    release();
    await press; await h.settle();
    assert.equal(rpc.flightCalls, 5, "only the Try again read rode the flight (network, curve, its config and platform, SOL balance, token account)");
    assert.equal(h.refusal(), null);
  });

  test("review: once the background retries run out the sentence stops saying it tries on its own; a failed Try again restarts them", async () => {
    const rpc = new Rpc();
    const h = await SwapHarness.mount(props, wallet(), rpc);
    assert.equal(h.refusal(), REFUSAL.networkUnreadable);
    for (let i = 0; i < 8; i++) await h.advance(61_000);
    const spent = rpc.calls;
    assert.equal(spent, 1 + 8, "the first read and eight retries");
    assert.equal(h.refusal(), REFUSAL.networkUnreadableManual);
    assert.doesNotMatch(h.refusal()!, /on its own/);
    await h.advance(600_000);
    assert.equal(rpc.calls, spent, "no more background reads");
    await h.click(tryAgain(h));
    assert.equal(rpc.calls, spent + 1, "the press read once, in the ordinary lane");
    assert.equal(h.refusal(), REFUSAL.networkUnreadable, "the schedule is running again");
    await h.advance(3_000);
    assert.equal(rpc.calls, spent + 2, "the restarted schedule's first retry");
    rpc.up = true;
    await h.advance(6_000);
    assert.equal(h.refusal(), null);
  });

  test("review: background retries pause while the tab is hidden and resume when it is shown", async () => {
    const rpc = new Rpc();
    const doc = new FakeDocument();
    const h = await SwapHarness.mount(props, wallet(), rpc);
    h.doc = doc;
    const first = rpc.calls;
    doc.set("hidden");
    await h.advance(300_000);
    assert.equal(rpc.calls, first, "nothing read while hidden");
    rpc.up = true;
    doc.set("visible"); await h.settle();
    assert.equal(rpc.calls, first + 5, "one full read when shown (network, curve, its config and platform, SOL balance, token account)");
    assert.equal(h.refusal(), null);
  });

  test("a real network mismatch still says so, and is not offered as something to retry", async () => {
    const rpc = new Rpc(); rpc.up = true; rpc.genesis = GENESIS_HASH.mainnet;
    const h = await SwapHarness.mount(props, wallet(), rpc);
    await h.type("1");
    assert.equal(h.refusal(), REFUSAL.wrongNetwork);
    assert.equal(enabled(h), false);
    assert.equal(tryAgain(h), undefined, "a final refusal offers no Try again");
  });

  test("the new sentences pass the copy lint", () => {
    const cfg = loadCopyLintConfig();
    for (const t of [REFUSAL.networkUnreadable, REFUSAL.readFailed, REFUSAL.networkUnreadableManual, REFUSAL.readFailedManual, SWAP_COPY.tryAgain, SWAP_COPY.retrying]) assert.deepEqual(lintCopy(t, cfg).hits.map((x) => x.rule), [], t);
  });
});
