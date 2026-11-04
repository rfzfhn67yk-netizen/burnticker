// Review follow-up 2 (2026-10-16): a held swap whose status reads keep throwing stayed pending forever, so the panel never let the
// visitor swap again. After 24 hours, once a height read succeeds and shows the chain far past the swap's expiry, the hold is released
// with a plain warning to check the wallet's history first; and the panel's 5-second check backs off after repeated read errors.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import { GIVE_UP_AFTER_MS, GIVE_UP_PAST_BLOCKS, PendingWatch, reconcilePending, savePending, type PendingSwap, type SwapStore } from "@/lib/burnticker/swap/pending";
import { SWAP_COPY } from "@/lib/burnticker/swap/copy";
import { lintCopy } from "@/lib/launch/copyLint";

const owner = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
class MemStore implements SwapStore { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
const NOW = Date.parse("2026-10-16T12:00:00Z");
const rec = (ageMs: number): PendingSwap => ({ v: 1, network: "devnet", mint: mint.toBase58(), owner: owner.toBase58(), signature: "5".repeat(88), lastValidBlockHeight: 1_000, side: "sol-in", at: NOW - ageMs });
const conn = (o: { height: number | "throw"; statusThrows?: boolean }) => ({
  getBlockHeight: async () => { if (o.height === "throw") throw new Error("503"); return o.height; },
  getSignatureStatuses: async () => { if (o.statusThrows !== false) throw new Error("503 status"); return { value: [null] }; },
  getTransaction: async () => { throw new Error("503 tx"); },
  getLatestBlockhash: async () => ({ blockhash: "x", lastValidBlockHeight: 0 }), simulateTransaction: async () => ({ value: { err: null, logs: [] } }), sendRawTransaction: async () => "x",
  getBalance: async () => 0, getMultipleAccountsInfo: async () => [null],
});
const run = (r: PendingSwap, c: ReturnType<typeof conn>, store = new MemStore()) => { savePending(store, r); return reconcilePending({ conn: c as never, store, network: "devnet", mint, owner }, r, NOW).then((o) => ({ o, store })); };

describe("review follow-up 2: a held swap is not held forever", () => {
  test("older than 24 hours, reads throwing, height far past expiry: released with the check-your-wallet sentence (before: pending forever)", async () => {
    const { o, store } = await run(rec(GIVE_UP_AFTER_MS + 1), conn({ height: 1_000 + GIVE_UP_PAST_BLOCKS + 1 }));
    assert.equal(o.kind, "unconfirmed");
    assert.equal(store.m.size, 0, "the hold is released");
    assert.equal(SWAP_COPY.unconfirmed, "We could not confirm whether your earlier swap went through. Check your wallet's history before you swap again.");
    assert.deepEqual(lintCopy(SWAP_COPY.unconfirmed).hits, []);
  });
  test("not yet 24 hours, the height read failing, or the height not far past: still pending", async () => {
    assert.equal((await run(rec(GIVE_UP_AFTER_MS - 1), conn({ height: 1_000 + GIVE_UP_PAST_BLOCKS + 1 }))).o.kind, "pending");
    assert.equal((await run(rec(GIVE_UP_AFTER_MS + 1), conn({ height: "throw" }))).o.kind, "pending");
    assert.equal((await run(rec(GIVE_UP_AFTER_MS + 1), conn({ height: 1_000 + 10 }))).o.kind, "pending");
  });
  test("the 5-second check backs off after repeated read errors and resets after a clean read", async () => {
    const w = new PendingWatch(), r = rec(0);
    w.hold(r);
    assert.equal(w.delayMs(), 5_000);
    const failing = async () => ({ kind: "pending" as const, signature: r.signature, pending: r, error: "503" });
    for (let i = 0; i < 5; i++) await w.check(r, failing);
    assert.ok(w.delayMs() > 5_000 && w.delayMs() <= 60_000, String(w.delayMs()));
    await w.check(r, async () => ({ kind: "pending" as const, signature: r.signature, pending: r }));
    assert.equal(w.delayMs(), 5_000);
    const panel = fs.readFileSync("src/app/burnticker/t/[ticker]/TradePanel.tsx", "utf8");
    assert.match(panel, /setTimeout\(tick, watch\.current\.delayMs\(\)\)/);
    assert.match(panel, /o\.kind === "unconfirmed"/);
  });
});
