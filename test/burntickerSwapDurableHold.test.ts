// CONTINUOUS AUDIT 2026-10-19 SEC-02: A FAILED RECOVERY-RECORD WRITE PERMITTED A SECOND SWAP AFTER A RELOAD. swap/pending.ts swallowed a
// localStorage failure and sent anyway; after an ambiguous send and a reload the signature was gone and the next press signed and sent a
// different transaction. Now the record is written and read back before the send (or nothing is sent), and the server keeps a second
// copy (swap/pendingServer.ts) that a remounted panel finds when the browser lost its own. Every case: never two distinct sends.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Keypair, type VersionedTransaction } from "@solana/web3.js";
import { syncNativeIx } from "@/lib/burnticker/swap/instructions";
import { loadPending, pendingKey, storeWritable, submitSwap, type PendingRemote, type PendingSwap, type SwapStore } from "@/lib/burnticker/swap/pending";
import { SwapPendingStore, verifyPendingClaim, RECORD_TTL_MS } from "@/lib/burnticker/swap/pendingServer";
import { REFUSAL } from "@/lib/burnticker/swap/copy";
import { lintCopy } from "@/lib/launch/copyLint";

const payer = Keypair.generate(), mintKp = Keypair.generate(), mint = mintKp.publicKey;
const MINT = mint.toBase58(), OWNER = payer.publicKey.toBase58();
const ixs = [{ ...syncNativeIx(payer.publicKey), keys: [...syncNativeIx(payer.publicKey).keys, { pubkey: mint, isSigner: false, isWritable: false }] }];

class MemStore implements SwapStore { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
/** setItem throws (a full quota), getItem answers null */
class ThrowingStore implements SwapStore { getItem() { return null; } setItem(): void { const e = new Error("The quota has been exceeded."); e.name = "QuotaExceededError"; throw e; } removeItem() {} }
/** setItem returns but keeps nothing */
class SilentStore implements SwapStore { getItem() { return null; } setItem() {} removeItem() {} }
/** passes the write test, then drops the real record (fails at the actual save) */
class DropsRecordStore extends MemStore { setItem(k: string, v: string) { if (!k.startsWith("bt-swap-pending:")) super.setItem(k, v); } }

/** A fake chain whose send throws an ambiguous error after counting it; distinct signed transactions are recorded. */
function chain(o: { statuses?: () => ({ err: unknown; confirmationStatus?: string } | null) } = {}) {
  let bh = 0;
  const c = {
    sends: 0, sigs: new Set<string>(),
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 + bh++ }),
    simulateTransaction: async () => ({ value: { err: null, logs: [] as string[] } }),
    sendRawTransaction: async (raw: Uint8Array) => { c.sends++; c.sigs.add(Buffer.from(raw).toString("base64")); throw new Error("fetch failed: socket hang up"); },
    getSignatureStatuses: async () => ({ value: [o.statuses ? o.statuses() : null] }),
    getBlockHeight: async () => 50,
    getBalance: async () => 5,
    getMultipleAccountsInfo: async () => [null],
    getTransaction: async () => null,
  };
  return c;
}
type Chain = ReturnType<typeof chain>;
function wallet() { const w = { asked: 0, sign: async (t: VersionedTransaction) => { w.asked++; t.sign([payer]); return t; } }; return w; }
const press = (c: Chain, store: SwapStore | null, w = wallet(), remote: PendingRemote | null = null) => submitSwap({ conn: c, store, remote, network: "devnet", mint, owner: payer.publicKey }, { side: "sol-in", ixs, sign: w.sign, pollMs: 1 });

/** The server's copy, in memory, through the real verifier and store (as the route runs them). */
function serverRemote(db = new SwapPendingStore(":memory:")) {
  const r = {
    db, saves: 0, failSave: false,
    async save(rec: PendingSwap, raw: Uint8Array) { r.saves++; if (r.failSave) throw new Error("503"); const v = verifyPendingClaim({ ...rec, tx: Buffer.from(raw).toString("base64") }); if (!v.ok) throw new Error(v.reason); db.put(v.rec); },
    async load(network: "devnet" | "mainnet", m: string, owner: string) { return db.get(network, m, owner); },
    async clear(rec: PendingSwap) { db.clear(rec.network, rec.mint, rec.owner, rec.signature); },
  };
  return r;
}

describe("SEC-02: storage that cannot keep the record means nothing is sent", () => {
  for (const [name, make] of [["null storage", () => null], ["storage that throws", () => new ThrowingStore()], ["storage that silently keeps nothing", () => new SilentStore()]] as const) {
    test(`${name}: refused before the wallet is asked; first send count zero; a remount and a second press still send nothing`, async () => {
      const c = chain(), w = wallet();
      await assert.rejects(press(c, make(), w), (e: Error) => e.message === REFUSAL.storageUnavailable);
      await assert.rejects(press(c, make(), w), (e: Error) => e.message === REFUSAL.storageUnavailable);
      assert.equal(c.sends, 0); assert.equal(w.asked, 0);
    });
  }
  test("storage that passes the write test but drops the real record: the wallet signed, but the transaction is never sent", async () => {
    const c = chain(), w = wallet(), store = new DropsRecordStore();
    assert.equal(storeWritable(store), true);
    await assert.rejects(press(c, store, w), (e: Error) => e.message === REFUSAL.storageUnavailable);
    assert.equal(w.asked, 1); assert.equal(c.sends, 0);
  });
  test("working storage, an ambiguous send, a full remount and a second press: one send only, the held swap is settled instead", async () => {
    const store = new MemStore(), c = chain();
    assert.equal((await press(c, store)).kind, "pending");
    assert.ok(loadPending(store, "devnet", MINT, OWNER), "the record was read back before the send");
    // the remount: fresh panel code, the same storage, no memory of the first press
    assert.equal((await press(chain(), store)).kind, "pending");
    assert.equal(c.sends, 1); assert.equal(c.sigs.size, 1);
  });
});

describe("SEC-02: the server's copy covers a browser that lost its record", () => {
  test("ambiguous send, then the browser's storage is cleared and the panel remounts: the server's copy holds the swap; no second distinct send", async () => {
    const remote = serverRemote(), store = new MemStore(), c = chain();
    assert.equal((await press(c, store, wallet(), remote)).kind, "pending");
    assert.equal(remote.saves, 1);
    store.m.clear();   // the visitor cleared site data
    const c2 = chain(), w2 = wallet();
    const again = await press(c2, store, w2, remote);
    assert.equal(again.kind, "pending", "the earlier swap is settled first");
    assert.equal(c2.sends, 0); assert.equal(w2.asked, 0);
    assert.ok(loadPending(store, "devnet", MINT, OWNER), "and written back into the browser");
    // the chain now answers that it confirmed: settled, cleared on both sides, the next press can send again
    const done = await press(chain({ statuses: () => ({ err: null, confirmationStatus: "confirmed" }) }), store, wallet(), remote);
    assert.equal(done.kind, "confirmed");
    await new Promise((r) => setImmediate(r));
    assert.equal(remote.db.get("devnet", MINT, OWNER), null);
    assert.equal(loadPending(store, "devnet", MINT, OWNER), null);
  });
  test("1919Z: a server that cannot keep the copy stops the swap even with a verified browser record (zero sends, browser record removed)", async () => {
    const remote = serverRemote(); remote.failSave = true;
    const c = chain(), store = new MemStore();
    await assert.rejects(press(c, store, wallet(), remote), (e: Error) => e.message === REFUSAL.notRecorded);
    await assert.rejects(press(c, store, wallet(), remote), (e: Error) => e.message === REFUSAL.notRecorded);
    assert.equal(c.sends, 0);
    assert.equal(loadPending(store, "devnet", MINT, OWNER), null, "a swap that was never sent is not held");
  });
  test("the server keeps a record only from the wallet's own signed transaction, and removes it only by its signature", async () => {
    const remote = serverRemote(), store = new MemStore(), c = chain();
    await press(c, store, wallet(), remote);
    const rec = remote.db.get("devnet", MINT, OWNER)!;
    assert.ok(rec && rec.signature === JSON.parse(store.getItem(pendingKey("devnet", MINT, OWNER))!).signature);
    // a stranger cannot hold another wallet's swaps: the owner, the signature or the coin must match the signed transaction
    const raw = [...c.sigs][0];
    const claim = { network: "devnet", mint: MINT, owner: OWNER, signature: rec.signature, lastValidBlockHeight: rec.lastValidBlockHeight, side: "sol-in", tx: raw };
    assert.equal(verifyPendingClaim(claim).ok, true);
    assert.equal(verifyPendingClaim({ ...claim, owner: Keypair.generate().publicKey.toBase58() }).ok, false);
    assert.equal(verifyPendingClaim({ ...claim, mint: Keypair.generate().publicKey.toBase58() }).ok, false);
    assert.equal(verifyPendingClaim({ ...claim, signature: "5".repeat(88) }).ok, false);
    const forged = Buffer.from(raw, "base64"); forged[forged.length - 1] ^= 1;   // a changed message: the signature no longer verifies
    assert.equal(verifyPendingClaim({ ...claim, tx: forged.toString("base64") }).ok, false);
    assert.equal(remote.db.clear("devnet", MINT, OWNER, "5".repeat(88)), false, "a wrong signature removes nothing");
    assert.ok(remote.db.get("devnet", MINT, OWNER));
    assert.equal(remote.db.get("devnet", MINT, OWNER, Date.now() + RECORD_TTL_MS + 1), null, "it lapses after the panel's own release");
  });
  test("the sentence lints; the panel blocks a browser without storage and reads the server's copy on mount; the route is same-origin for writes", () => {
    assert.deepEqual(lintCopy(REFUSAL.storageUnavailable).hits, []);
    const panel = fs.readFileSync("src/app/burnticker/t/[ticker]/TradePanel.tsx", "utf8");
    assert.match(panel, /const storeNo = who && !store \? REFUSAL\.storageUnavailable : null;/);
    assert.match(panel, /loadRemotePending\(remote, store, network, coin, owner\)/);
    assert.match(panel, /if \(!rec\) void readRemote\(p\.network, p\.mint, ownerKey, key\)/);
    const route = fs.readFileSync("src/app/api/burnticker/swap-pending/route.ts", "utf8");
    assert.equal((route.match(/if \(!isSameOrigin\(req\)\)/g) ?? []).length, 2);
  });
});
