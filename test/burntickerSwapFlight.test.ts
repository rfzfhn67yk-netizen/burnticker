// Third prelaunch audit 2026-10-16 F05: a held swap's status reads ran outside the flight lane. With the proxy's ordinary lane spent for
// the day, reconcilePending's height and status reads failed, so the panel stayed blocked until midnight UTC, while the same reads inside
// withFlight would have been admitted. The whole user-started swap (its fresh market and balance reads, the send, the confirm and the
// balance read after it) and every reconcile of a held swap (the timer, the manual check, a reload) now run inside withFlight; the
// panel's passive refresh stays in the ordinary lane.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Keypair, type VersionedTransaction } from "@solana/web3.js";
import { syncNativeIx } from "@/lib/burnticker/swap/instructions";
import { connectionOn, GENESIS_HASH, readBalances } from "@/lib/burnticker/swap/chain";
import { loadPending, PendingWatch, reconcilePending, runSwap, savePending, submitSwap, type PendingSwap, type SwapStore } from "@/lib/burnticker/swap/pending";
import { flightUnderWay } from "@/lib/burnticker/rpcProxy";

const payer = Keypair.generate(), mint = Keypair.generate().publicKey;
const sign = async (t: VersionedTransaction) => { t.sign([payer]); return t; };
const ixs = [syncNativeIx(payer.publicKey)];
class MemStore implements SwapStore { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

/** The proxy with its ordinary lane spent: every read answers 429 unless a flight is under way (the token rides it). */
function spentLane() {
  const gate = <T>(f: () => T): Promise<T> => (flightUnderWay() ? Promise.resolve(f()) : Promise.reject(new Error("429 Too Many Requests: this site's RPC allowance is used up")));
  const c = {
    ordinaryCalls: 0, sends: 0,
    getGenesisHash: () => gate(() => GENESIS_HASH.devnet),
    getLatestBlockhash: () => gate(() => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 100 })),
    simulateTransaction: () => gate(() => ({ value: { err: null, logs: [] as string[] } })),
    sendRawTransaction: () => gate(() => { c.sends++; return "sig"; }),
    getSignatureStatuses: () => gate(() => ({ value: [{ err: null, confirmationStatus: "confirmed" }] })),
    getBlockHeight: () => gate(() => 50),
    getBalance: () => gate(() => 7),
    getMultipleAccountsInfo: () => gate(() => [null]),
    getTransaction: () => gate(() => null),
  };
  return c;
}
const ctx = (conn: ReturnType<typeof spentLane>, store: SwapStore | null) => ({ conn, store, network: "devnet" as const, mint, owner: payer.publicKey });
const rec = (): PendingSwap => ({ v: 1, network: "devnet", mint: mint.toBase58(), owner: payer.publicKey.toBase58(), signature: "5".repeat(88), lastValidBlockHeight: 120, side: "sol-in", at: 1 });

describe("F05: a held swap settles through the flight lane when the ordinary lane is spent", () => {
  test("the passive reads fail in the spent lane (the premise)", async () => {
    await assert.rejects(readBalances(spentLane(), payer.publicKey, mint), /429/);
  });
  test("reconcilePending (the 5-second timer and the manual check) settles it (before: 429, the panel stayed blocked)", async () => {
    const store = new MemStore(), c = spentLane(), r = rec();
    savePending(store, r);
    const watch = new PendingWatch(); watch.hold(r);
    const out = await watch.check(r, (x) => reconcilePending(ctx(c, store), x));
    assert.equal(out?.kind, "confirmed");
    assert.ok(out?.kind === "confirmed" && out.balances, "the balance read after it rides the same flight");
    assert.equal(store.m.size, 0, "the record is cleared");
  });
  test("after a reload: the stored record is loaded and settled the same way", async () => {
    const store = new MemStore(), c = spentLane();
    savePending(store, rec());
    const loaded = loadPending(store, "devnet", mint.toBase58(), payer.publicKey.toBase58());
    assert.ok(loaded);
    assert.equal((await reconcilePending(ctx(c, store), loaded!)).kind, "confirmed");
  });
  test("a new swap: its fresh network, market and balance reads, the send, and the balance read after it all ride the flight", async () => {
    const store = new MemStore(), c = spentLane();
    const out = await runSwap(ctx(c, store), { side: "sol-in", sign, pollMs: 1, now: 1, prepare: async () => {
      if (!(await connectionOn(c, "devnet"))) throw new Error("wrong network");
      await readBalances(c, payer.publicKey, mint);
      return ixs;
    } });
    assert.equal(out.kind, "confirmed");
    assert.ok(out.kind === "confirmed" && out.balances, "before: the read after the confirm ran outside the flight and came back empty");
    assert.equal(c.sends, 1);
  });
  test("submitSwap on its own keeps the read after the confirm inside the flight", async () => {
    const out = await submitSwap(ctx(spentLane(), new MemStore()), { side: "sol-in", ixs, sign, pollMs: 1, now: 1 });
    assert.ok(out.kind === "confirmed" && out.balances);
  });
  test("a held swap is settled before the new swap's reads run, and nothing new is sent", async () => {
    const store = new MemStore(), c = spentLane();
    savePending(store, rec());
    let prepared = 0;
    const out = await runSwap(ctx(c, store), { side: "sol-in", sign, pollMs: 1, now: 1, prepare: async () => { prepared++; return ixs; } });
    assert.equal(out.kind, "confirmed");
    assert.equal(prepared, 0);
    assert.equal(c.sends, 0);
  });
  test("the panel sends through runSwap and keeps its passive refresh outside the flight", () => {
    const src = fs.readFileSync("src/app/burnticker/t/[ticker]/TradePanel.tsx", "utf8");
    assert.match(src, /await runSwap\(ctx\(\), \{/);
    assert.doesNotMatch(src, /await submitSwap\(/, "the panel never sends outside runSwap");
    const refresh = src.slice(src.indexOf("const refresh = useCallback"), src.indexOf("useEffect(() => { const t = setTimeout(() => void refresh()"));
    assert.doesNotMatch(refresh, /withFlight|runSwap/, "the passive refresh stays in the ordinary lane");
  });
});
