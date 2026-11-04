// CONTINUOUS AUDIT 2026-10-19T1919Z SEC-02: THE COMBINED RECOVERY GAP. The swap's browser record was verified before the send, but the
// server's copy was best effort and an unreadable server read counted as "no held swap". The auditor's reproduction: after an ambiguous
// first swap, clear the browser's record and then (a) make the server read fail, or (b) have the original server save fail; each let a
// second distinct swap be signed and sent. Now a swap is sent only when the server acknowledged its record under the same signature, and
// with no browser record only a server answer of "none" counts as absence; a failed read is "unknown" and nothing new is offered.
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Keypair, type PublicKey, type VersionedTransaction } from "@solana/web3.js";
import { syncNativeIx } from "@/lib/burnticker/swap/instructions";
import { httpPendingRemote, loadPending, loadRemotePending, submitSwap, type PendingRemote, type PendingSwap, type SwapStore } from "@/lib/burnticker/swap/pending";
import { SwapPendingStore, verifyPendingClaim } from "@/lib/burnticker/swap/pendingServer";
import { REFUSAL, SWAP_COPY } from "@/lib/burnticker/swap/copy";
import { GENESIS_HASH } from "@/lib/burnticker/swap/chain";
import { decodeCurvePool } from "@/lib/burnticker/swap/layouts";
import { lintCopy } from "@/lib/launch/copyLint";
import { SwapHarness, ACCOUNTS, FX } from "./burntickerTradePanelHarness.ts";

class MemStore implements SwapStore { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

/** The auditor's fixture (swap-recovery-gap.test.mjs), typed: an RPC whose send is accepted but its answer lost, and a remote copy. */
function fixture() {
  const payer = Keypair.generate(), mint = Keypair.generate().publicKey, store = new MemStore();
  const sent = new Set<string>(); let asks = 0, record: PendingSwap | null = null, failRead = false, failSave = false;
  const conn = {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1000 }),
    simulateTransaction: async () => ({ value: { err: null, logs: [] as string[] } }),
    sendRawTransaction: async (raw: Uint8Array): Promise<string> => { sent.add(Buffer.from(raw).toString("base64")); throw new Error("accepted but acknowledgement lost"); },
    getSignatureStatuses: async () => ({ value: [null] }), getBlockHeight: async () => 50,
    getTransaction: async () => null, getBalance: async () => 0, getMultipleAccountsInfo: async () => [null],
  };
  const remote: PendingRemote = {
    save: async (r) => { if (failSave) throw new Error("503"); record = r; },
    load: async () => { if (failRead) throw new Error("503"); return record; },
    clear: async () => { record = null; },
  };
  const ixs = [syncNativeIx(payer.publicKey)];
  const sign = async (tx: VersionedTransaction) => { asks++; tx.sign([payer]); return tx; };
  return {
    store, sent, remote, asks: () => asks, mint, owner: payer.publicKey.toBase58(),
    failRead: (on = true) => { failRead = on; }, failSave: (on = true) => { failSave = on; },
    press: () => submitSwap({ conn, store, remote, network: "devnet", mint, owner: payer.publicKey }, { side: "sol-in", ixs, sign, pollMs: 1 }),
  };
}

describe("1919Z SEC-02: the auditor's four cases", () => {
  test("control: a retained browser record blocks another send even when the server is unreadable", async () => {
    const f = fixture();
    assert.equal((await f.press()).kind, "pending");
    f.failRead();
    assert.equal((await f.press()).kind, "pending");
    assert.equal(f.sent.size, 1); assert.equal(f.asks(), 1);
  });
  test("control: a cleared browser with a readable server copy keeps the original swap", async () => {
    const f = fixture();
    const first = await f.press();
    f.store.m.clear();
    const next = await f.press();
    assert.equal(next.signature, first.signature);
    assert.equal(f.sent.size, 1); assert.equal(f.asks(), 1);
  });
  test("(a) cleared browser plus a failed server read: refused as unknown; exactly one send and one wallet approval; a later read resumes the held swap", async () => {
    const f = fixture();
    const first = await f.press();
    assert.equal(first.kind, "pending");
    f.store.m.clear(); f.failRead();
    await assert.rejects(f.press(), (e: Error) => e.message === REFUSAL.recoveryUnknown);
    await assert.rejects(f.press(), (e: Error) => e.message === REFUSAL.recoveryUnknown);
    assert.equal(f.sent.size, 1); assert.equal(f.asks(), 1);
    // the server answers again: the held swap is restored into the browser and settled first, still nothing new
    f.failRead(false);
    const back = await f.press();
    assert.equal(back.kind, "pending"); assert.equal(back.signature, first.signature);
    assert.equal(loadPending(f.store, "devnet", f.mint.toBase58(), f.owner)?.signature, first.signature);
    assert.equal(f.sent.size, 1); assert.equal(f.asks(), 1);
  });
  test("(b) a failed server save: the first swap is never sent; after a cleared browser the retry sends exactly one swap", async () => {
    const f = fixture();
    f.failSave();
    await assert.rejects(f.press(), (e: Error) => e.message === REFUSAL.notRecorded);
    assert.equal(f.sent.size, 0, "the signed swap was not broadcast");
    assert.equal(loadPending(f.store, "devnet", f.mint.toBase58(), f.owner), null, "and is not held in the browser");
    f.store.m.clear();
    await assert.rejects(f.press(), (e: Error) => e.message === REFUSAL.notRecorded);
    assert.equal(f.sent.size, 0, "a retry while the server still cannot keep it sends nothing either");
    f.failSave(false);
    assert.equal((await f.press()).kind, "pending");
    f.store.m.clear();
    assert.equal((await f.press()).kind, "pending", "the acknowledged copy holds it across a cleared browser");
    assert.equal(f.sent.size, 1, "one distinct transaction in total");
  });
});

/** A fake chain that counts sends (each ambiguous), and a wallet that counts approvals. */
function chain() {
  const c = {
    sends: 0,
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    simulateTransaction: async () => ({ value: { err: null, logs: [] as string[] } }),
    sendRawTransaction: async (): Promise<string> => { c.sends++; throw new Error("fetch failed: socket hang up"); },
    getSignatureStatuses: async () => ({ value: [null] }), getBlockHeight: async () => 50,
    getBalance: async () => 5, getMultipleAccountsInfo: async () => [null], getTransaction: async () => null,
  };
  return c;
}
const payer = Keypair.generate(), mint = Keypair.generate().publicKey, MINT = mint.toBase58(), OWNER = payer.publicKey.toBase58();
const ixs = [{ ...syncNativeIx(payer.publicKey), keys: [...syncNativeIx(payer.publicKey).keys, { pubkey: mint, isSigner: false, isWritable: false }] }];
type Res = { ok: boolean; json(): Promise<unknown> };
const res = (ok: boolean, body: unknown): Res => ({ ok, json: async () => body });
const badJson: Res = { ok: true, json: async () => { throw new SyntaxError("Unexpected token < in JSON"); } };
const hang = () => new Promise<Res>(() => {});
/** The server, in memory, behind httpPendingRemote: POST runs the real verifier and store and answers with the kept signature. */
function server() {
  const db = new SwapPendingStore(":memory:");
  const s = {
    db, post: null as null | ((body: Record<string, unknown>) => Promise<Res>), get: null as null | (() => Promise<Res>),
    fetch: async (url: string, init?: { method?: string; body?: string; signal?: AbortSignal }): Promise<Res> => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        const body = JSON.parse(init!.body!) as Record<string, unknown>;
        if (s.post) return s.post(body);
        const v = verifyPendingClaim(body);
        if (!v.ok) return res(false, { error: v.reason });
        db.put(v.rec); return res(true, { ok: true, signature: v.rec.signature });
      }
      if (method === "DELETE") { const b = JSON.parse(init!.body!); db.clear(b.network, b.mint, b.owner, b.signature); return res(true, { ok: true }); }
      if (s.get) return s.get();
      const q = new URL(url, "http://x").searchParams;
      return res(true, { pending: db.get(q.get("network") as "devnet", q.get("mint")!, q.get("owner")!) });
    },
  };
  return s;
}
function pressWith(c: ReturnType<typeof chain>, store: SwapStore, remote: PendingRemote) {
  const w = { asked: 0 };
  const run = submitSwap({ conn: c, store, remote, network: "devnet", mint, owner: payer.publicKey, remoteWaitMs: 30 }, { side: "sol-in", ixs, sign: async (t) => { w.asked++; t.sign([payer]); return t; }, pollMs: 1 });
  return { run, w };
}

describe("1919Z SEC-02: the server's acknowledgement comes before the send", () => {
  const cases: [string, (s: ReturnType<typeof server>) => void][] = [
    ["a 500 answer", (s) => { s.post = async () => res(false, { error: "The held swap could not be saved just now." }); }],
    ["a network error", (s) => { s.post = async () => { throw new TypeError("Failed to fetch"); }; }],
    ["no answer in time", (s) => { s.post = hang; }],
    ["a 2xx answer naming another signature", (s) => { s.post = async () => res(true, { ok: true, signature: "5".repeat(88) }); }],
    ["a 2xx answer that is not JSON", (s) => { s.post = async () => badJson; }],
  ];
  for (const [name, set] of cases) {
    test(`${name}: zero sends, the browser record is removed, the refusal says nothing was sent`, async () => {
      const s = server(); set(s);
      const remote = httpPendingRemote(s.fetch, undefined, 30), store = new MemStore(), c = chain();
      const { run, w } = pressWith(c, store, remote);
      await assert.rejects(run, (e: Error) => e.message === REFUSAL.notRecorded);
      assert.equal(c.sends, 0); assert.equal(w.asked, 1);
      assert.equal(loadPending(store, "devnet", MINT, OWNER), null);
    });
  }
  test("a 2xx answer naming the same signature: sent once, held on both sides", async () => {
    const s = server(), remote = httpPendingRemote(s.fetch, undefined, 30), store = new MemStore(), c = chain();
    const out = await pressWith(c, store, remote).run;
    assert.equal(out.kind, "pending"); assert.equal(c.sends, 1);
    assert.equal(s.db.get("devnet", MINT, OWNER)?.signature, out.signature);
    assert.equal(loadPending(store, "devnet", MINT, OWNER)?.signature, out.signature);
  });
});

describe("1919Z SEC-02: an unreadable server copy is unknown, not absent", () => {
  const reads: [string, () => Promise<Res>][] = [
    ["a 500 answer", async () => res(false, { error: "The held swap could not be read just now." })],
    ["a network error", async () => { throw new TypeError("Failed to fetch"); }],
    ["no answer in time", hang],
    ["an answer that is not JSON", async () => badJson],
    ["an answer without a pending field", async () => res(true, { error: "?" })],
    ["a record for another wallet", async () => res(true, { pending: { v: 1, network: "devnet", mint: MINT, owner: Keypair.generate().publicKey.toBase58(), signature: "5".repeat(88), lastValidBlockHeight: 1, side: "sol-in", at: 1 } })],
  ];
  for (const [name, get] of reads) {
    test(`${name}, with no browser record: unknown; the wallet is not asked and nothing is sent`, async () => {
      const s = server(); s.get = get;
      const remote = httpPendingRemote(s.fetch, undefined, 30), store = new MemStore(), c = chain();
      assert.equal((await loadRemotePending(remote, store, "devnet", MINT, OWNER, 30)).kind, "unknown");
      const { run, w } = pressWith(c, store, remote);
      await assert.rejects(run, (e: Error) => e.message === REFUSAL.recoveryUnknown);
      assert.equal(c.sends, 0); assert.equal(w.asked, 0);
    });
  }
  test("only a 2xx { pending: null } is absence", async () => {
    const s = server(), remote = httpPendingRemote(s.fetch, undefined, 30);
    assert.deepEqual(await loadRemotePending(remote, new MemStore(), "devnet", MINT, OWNER, 30), { kind: "absent" });
  });
  test("the sentences lint; the route answers a save with the kept signature", () => {
    assert.equal(REFUSAL.notRecorded, "This swap was not sent because this site could not keep a record of it first. Nothing was sent. Wait a moment, then try again.");
    assert.equal(REFUSAL.recoveryUnknown, "This site could not check whether an earlier swap from this wallet is still settling, so no new swap is offered yet. Press Check again in a moment.");
    assert.deepEqual(lintCopy(REFUSAL.notRecorded).hits, []);
    assert.deepEqual(lintCopy(REFUSAL.recoveryUnknown).hits, []);
    assert.equal(SWAP_COPY.checkAgain, "Check again");
    const route = fs.readFileSync("src/app/api/burnticker/swap-pending/route.ts", "utf8");
    assert.match(route, /NextResponse\.json\(\{ ok: true, signature: v\.rec\.signature \}/);
  });
});

// ---- the panel: the unknown state refuses a new swap and offers Check again ----
const PMINT = decodeCurvePool(Buffer.from(FX.curvePool.data!, "base64")).mintA.toBase58();
const props = { ticker: "AUDIT", mint: PMINT, status: "live", cluster: "devnet", network: "devnet", graduatedPool: null, poolBurnBps: 100, links: [], operatorWallets: [] };
const g = globalThis as { localStorage?: SwapStore };
beforeEach(() => { g.localStorage = new MemStore(); });
afterEach(() => { delete g.localStorage; });
class Rpc {
  sends = 0;
  async getGenesisHash() { return GENESIS_HASH.devnet; }
  async getMultipleAccountsInfo(keys: PublicKey[]) { return keys.map((k) => ACCOUNTS.get(k.toBase58()) ?? null); }
  async getBalance() { return 5_000_000_000; }
  async getBlockHeight() { return 100; }
  async getLatestBlockhash() { return { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 200 }; }
  async simulateTransaction() { return { value: { err: null, logs: [] as string[], unitsConsumed: 1 } }; }
  async sendRawTransaction() { this.sends++; return "unused"; }
  async getSignatureStatuses(sigs: string[]) { return { value: sigs.map(() => null) }; }
  async getTransaction() { return null; }
}

describe("1919Z SEC-02: the swap panel when the server's copy cannot be read", () => {
  const A = Keypair.generate();
  const walletA = () => ({ publicKey: A.publicKey, connected: true, signTransaction: async (t: VersionedTransaction) => { t.sign([A]); return t; } });
  function api() {
    const a = { reads: 0, answer: (async () => { throw new TypeError("Failed to fetch"); }) as () => Promise<Res> };
    const fetch = async (url: string, init?: { method?: string }) => { if ((init?.method ?? "GET") === "GET") { a.reads++; return a.answer(); } return res(true, { ok: true }); };
    return { a, fetch };
  }
  test("a failed read with no browser record: no swap offered, the sentence and Check again; a later 2xx 'none' unlocks", async () => {
    const { a, fetch } = api(), rpc = new Rpc();
    const h = await SwapHarness.mount(props, walletA(), rpc, { fetch });
    assert.equal(a.reads, 1);
    assert.equal(h.refusal(), REFUSAL.recoveryUnknown);
    await h.type("0.01");
    assert.equal(h.refusal(), REFUSAL.recoveryUnknown, "an amount does not unlock it");
    assert.equal(h.swapButton()?.props.disabled, true);
    await h.click(h.swapButton());   // a forced press does nothing
    assert.equal(rpc.sends, 0);
    const retry = h.find("data-swap-recovery-retry");
    assert.equal(h.text(retry), "Check again");
    await h.click(retry);
    assert.equal(a.reads, 2, "Check again reads the server's copy again");
    assert.equal(h.refusal(), REFUSAL.recoveryUnknown, "still failing: still refused");
    a.answer = async () => res(true, { pending: null });
    await h.click(h.find("data-swap-recovery-retry"));
    assert.equal(a.reads, 3);
    assert.notEqual(h.refusal(), REFUSAL.recoveryUnknown);
    assert.equal(h.find("data-swap-recovery-retry"), undefined);
    assert.equal(h.find("data-swap-pending"), undefined);
  });
  test("a later 2xx with a record restores it into the browser and resumes the held flow", async () => {
    const { a, fetch } = api(), rpc = new Rpc();
    const h = await SwapHarness.mount(props, walletA(), rpc, { fetch });
    assert.equal(h.refusal(), REFUSAL.recoveryUnknown);
    const rec: PendingSwap = { v: 1, network: "devnet", mint: PMINT, owner: A.publicKey.toBase58(), signature: "4".repeat(88), lastValidBlockHeight: 150, side: "sol-in", at: Date.now() };
    a.answer = async () => res(true, { pending: rec });
    await h.click(h.find("data-swap-recovery-retry"));
    assert.ok(h.find("data-swap-pending"), "the held swap shows with its Check again");
    assert.notEqual(h.refusal(), REFUSAL.recoveryUnknown);
    assert.equal(loadPending(g.localStorage!, "devnet", PMINT, A.publicKey.toBase58())?.signature, rec.signature);
    assert.equal(rpc.sends, 0);
  });
});
