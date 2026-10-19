// audit 2026-10-15 F2: a submitted swap keeps its recovery identity. Before the fix a status read that threw after the send was a bare
// error with no signature; the panel went idle with the amount intact and a retry built and sent a SECOND swap. Every case here sends
// exactly once, however the chain reads fail, and a confirmed swap stays confirmed when the balance read after it fails.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Keypair, type VersionedTransaction } from "@solana/web3.js";
import { syncNativeIx } from "@/lib/burnticker/swap/instructions";
import { BLOCKHASH_VALID_BLOCKS, EXPIRY_MARGIN_BLOCKS, reconcileSubmitted, signatureOf, simulateSignSend, UNKNOWN_EXPIRY_BLOCKS, WALLET_BLOCKHASH_MARGIN } from "@/lib/burnticker/swap/chain";
import { browserSwapStore, loadPending, pendingKey, PendingWatch, submitSwap, type PendingSwap, type SwapOutcome, type SwapStore } from "@/lib/burnticker/swap/pending";
import { REFUSAL, SWAP_COPY } from "@/lib/burnticker/swap/copy";
import { lintCopy } from "@/lib/launch/copyLint";

const payer = Keypair.generate(), mint = Keypair.generate().publicKey;
const sign = async (t: VersionedTransaction) => { t.sign([payer]); return t; };
const ixs = [syncNativeIx(payer.publicKey)];
class MemStore implements SwapStore { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

/** A fake chain: `sends` counts sendRawTransaction; each read can be scripted to throw or answer. */
function chain(o: { send?: "ok" | "throw"; statuses?: (() => ({ err: unknown; confirmationStatus?: string } | null))[]; statusThrows?: number; height?: () => number; heightThrows?: boolean; balanceThrows?: boolean } = {}) {
  const c = {
    sends: 0, statusCalls: 0, sentSig: "" as string,
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 100 }),
    simulateTransaction: async () => ({ value: { err: null, logs: [] as string[] } }),
    sendRawTransaction: async (raw: Uint8Array) => { c.sends++; if (o.send === "throw") throw new Error("503 Service Unavailable"); void raw; return c.sentSig || "sig-from-rpc"; },
    getSignatureStatuses: async () => { const i = c.statusCalls++; if (o.statusThrows !== undefined && i < o.statusThrows) throw new Error("503 Service Unavailable"); const f = o.statuses?.[Math.min(i, (o.statuses?.length ?? 1) - 1)]; return { value: [f ? f() : null] }; },
    getBlockHeight: async () => { if (o.heightThrows) throw new Error("block height: 503"); return o.height ? o.height() : 50; },
    getBalance: async () => { if (o.balanceThrows) throw new Error("getBalance: 503"); return 5; },
    getMultipleAccountsInfo: async () => { if (o.balanceThrows) throw new Error("getMultipleAccounts: 503"); return [null]; },
    getTransaction: async () => null,   // F-30: the second witness before expired
  };
  return c;
}
const ctx = (conn: ReturnType<typeof chain>, store: SwapStore | null) => ({ conn, store, network: "devnet" as const, mint, owner: payer.publicKey });
const run = (conn: ReturnType<typeof chain>, store: SwapStore | null, held = null) => submitSwap(ctx(conn, store), { side: "sol-in", ixs, sign, pollMs: 1, held, now: 1 });

describe("a signed swap is held before it is sent (swap/pending.ts)", () => {
  test("the record is written BEFORE sendRawTransaction, carrying the wallet's own signature", async () => {
    const store = new MemStore(), c = chain({ statuses: [() => ({ err: null, confirmationStatus: "confirmed" })] });
    let atSend: string | null = "unset";
    c.sendRawTransaction = async () => { c.sends++; atSend = store.getItem(pendingKey("devnet", mint.toBase58(), payer.publicKey.toBase58())); return JSON.parse(atSend!).signature; };
    const out = await run(c, store);
    assert.ok(atSend && JSON.parse(atSend).signature.length > 80, "held before the send");
    assert.equal(out.kind, "confirmed");
    assert.equal(store.m.size, 0, "a confirmed swap clears the record");
  });

  test("status RPC error after the send: pending with the signature (before the fix: a bare error and a second send on retry)", async () => {
    const store = new MemStore(), c = chain({ statusThrows: 99 });
    const first = await run(c, store);
    assert.equal(first.kind, "pending");
    assert.ok(first.kind === "pending" && first.signature.length > 80);
    const again = await run(c, store);   // the visitor presses Swap again
    assert.equal(again.kind, "pending", "still held: the second press settles the first instead of sending");
    assert.equal(c.sends, 1, "exactly one send");
    // the chain step itself: before the fix this rejected with the RPC's bare error and no signature
    const r = await simulateSignSend(chain({ statusThrows: 99 }), payer.publicKey, ixs, sign, () => {}, 1);
    assert.equal(r.status, "pending");
    assert.match(r.signature, /^[1-9A-HJ-NP-Za-km-z]{80,90}$/);
  });

  test("block height read error: pending, one send", async () => {
    const store = new MemStore(), c = chain({ heightThrows: true });
    assert.equal((await run(c, store)).kind, "pending");
    assert.equal((await run(c, store)).kind, "pending");
    assert.equal(c.sends, 1);
  });

  test("the send itself throws (the RPC may still have taken it): pending, one send", async () => {
    const store = new MemStore(), c = chain({ send: "throw" });
    const out = await run(c, store);
    assert.equal(out.kind, "pending");
    assert.equal(c.sends, 1);
    assert.ok(loadPending(store, "devnet", mint.toBase58(), payer.publicKey.toBase58()));
  });

  test("accepted, then the confirmation times out: a final history read decides; not found after expiry is expired, never resent", async () => {
    const store = new MemStore();
    let h = 50; const c = chain({ statuses: [() => null], height: () => (h += 30 + EXPIRY_MARGIN_BLOCKS) });   // F-30: past the expiry and its margin
    const out = await run(c, store);
    assert.equal(out.kind, "expired");
    assert.equal(c.sends, 1);
    assert.equal(store.m.size, 0, "an expired swap is released");
    // the same timeout, but the history read finds it confirmed: confirmed, not expired
    let h2 = 50, calls = 0; const c2 = chain({ height: () => (h2 += 30) });
    c2.getSignatureStatuses = async () => ({ value: [calls++ < 2 ? null : { err: null, confirmationStatus: "finalized" }] });
    assert.equal((await run(c2, new MemStore())).kind, "confirmed");
    assert.equal(c2.sends, 1);
  });

  test("confirmed, then the balance read fails: still a confirmed swap, with no balance (before the fix: an error after a good swap)", async () => {
    const c = chain({ statuses: [() => ({ err: null, confirmationStatus: "confirmed" })], balanceThrows: true });
    const out = await run(c, new MemStore());
    assert.deepEqual(out.kind === "confirmed" ? { kind: out.kind, balances: out.balances } : out, { kind: "confirmed", balances: null });
    assert.equal(c.sends, 1);
  });

  test("failed on chain: failed with the reason, released", async () => {
    const store = new MemStore(), c = chain({ statuses: [() => ({ err: { InstructionError: [3, { Custom: 6005 }] } })] });
    const out = await run(c, store);
    assert.equal(out.kind, "failed");
    assert.equal(store.m.size, 0);
    assert.match(REFUSAL.failed(out.kind === "failed" ? out.error : ""), /6005/);
  });

  test("reload mid-pending: a new panel (same tab storage) settles the held swap first and sends nothing new", async () => {
    const store = new MemStore(), c = chain({ statusThrows: 99 });
    assert.equal((await run(c, store)).kind, "pending");
    // the reload: fresh code, same sessionStorage; the chain now answers that the first swap confirmed
    const c2 = chain({ statuses: [() => ({ err: null, confirmationStatus: "confirmed" })] });
    const out = await run(c2, store);
    assert.equal(out.kind, "confirmed", "the earlier swap is reported");
    assert.equal(c2.sends, 0, "nothing new was sent after the reload");
    assert.equal(c.sends + c2.sends, 1, "exactly one send across the reload");
    assert.equal(store.m.size, 0);
    // a held swap still unknown after the reload stays pending; one whose blockhash expired unseen is released
    const s3 = new MemStore(); await run(chain({ statusThrows: 99 }), s3);
    assert.equal((await run(chain({ statuses: [() => null], height: () => 60 }), s3)).kind, "pending");
    assert.equal((await run(chain({ statuses: [() => null], height: () => 101 }), s3)).kind, "pending", "F-30: one block past the expiry is inside the margin");
    assert.equal((await run(chain({ statuses: [() => null], height: () => 101 + EXPIRY_MARGIN_BLOCKS }), s3)).kind, "expired");
  });

  test("a browser without storage still holds the swap in the panel's memory (held)", async () => {
    const c = chain({ statusThrows: 99 });
    const first = await run(c, null);
    assert.equal(first.kind, "pending");
    const again = await submitSwap(ctx(c, null), { side: "sol-in", ixs, sign, pollMs: 1, held: first.kind === "pending" ? first.pending : null });
    assert.equal(again.kind, "pending");
    assert.equal(c.sends, 1);
  });

  test("reconcileSubmitted: a read error is pending, never expired; the signature helper reads the wallet's signature", async () => {
    assert.equal((await reconcileSubmitted({ getBlockHeight: async () => { throw new Error("x"); }, getSignatureStatuses: async () => ({ value: [null] }), getTransaction: async () => null }, { signature: "s", lastValidBlockHeight: 1 })).status, "pending");
    const conn = chain({ statuses: [() => ({ err: null, confirmationStatus: "confirmed" })] });
    let seen: string | null = null;
    await simulateSignSend(conn, payer.publicKey, ixs, async (t) => { const s = await sign(t); seen = signatureOf(s); return s; }, () => {}, 1, () => {});
    assert.ok(seen && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(seen), String(seen));
  });

  test("the new sentences lint, and the panel blocks the button and settles a held swap on load", () => {
    for (const k of ["pending", "checkAgain", "checking", "earlierConfirmed", "expired", "balanceUnread"] as const) assert.deepEqual(lintCopy(SWAP_COPY[k]).hits, [], k);
    const panel = fs.readFileSync("src/app/burnticker/t/[ticker]/TradePanel.tsx", "utf8");
    assert.match(panel, /runSwap\(ctx\(\)/);   // third prelaunch audit F05: runSwap wraps submitSwap in the flight
    assert.match(panel, /const busy = step !== "idle" \|\| pending !== null \|\| checking;/);
    assert.match(panel, /loadPending\(store, p\.network, p\.mint, ownerKey\)/);
    // review of audit 2026-10-18 F04: the read is captured so a final answer for a wallet no longer connected is kept for it
    assert.match(panel, /watch\.current\.check\(rec, async \(r\) => \(read = await reconcilePending\(ctx\(\), r\)\)\)/);
    assert.ok(!/simulateSignSend/.test(panel), "the panel sends only through runSwap (submitSwap)");
  });
});

describe("review 2026-10-15: the held swap across tabs, wallets, a wallet-chosen blockhash and overlapping reads", () => {
  test("3a: the record lives in localStorage (every tab and a reopened one see it)", () => {
    const g = globalThis as { localStorage?: SwapStore; sessionStorage?: SwapStore };
    const had = { l: g.localStorage, s: g.sessionStorage };
    const local = new MemStore(), session = new MemStore();
    g.localStorage = local; g.sessionStorage = session;
    try { assert.equal(browserSwapStore(), local); } finally { g.localStorage = had.l; g.sessionStorage = had.s; }
  });
  test("3b: the wallet replaced the blockhash: held by a conservative expiry, never called expired early (before: the compiled expiry)", async () => {
    const swap = (t: VersionedTransaction) => { t.message.recentBlockhash = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi"; t.sign([payer]); return Promise.resolve(t); };
    let h = 500; const c = chain({ statusThrows: 99, height: () => h });
    const store = new MemStore();
    const out = await submitSwap(ctx(c, store), { side: "sol-in", ixs, sign: swap, pollMs: 1 });
    assert.equal(out.kind, "pending");
    const rec = loadPending(store, "devnet", mint.toBase58(), payer.publicKey.toBase58())!;
    assert.equal(rec.lastValidBlockHeight, 500 + BLOCKHASH_VALID_BLOCKS + WALLET_BLOCKHASH_MARGIN, "the chain's height at signing plus a blockhash's life and a margin");
    h = 120;   // past the compiled expiry (100), inside the wallet's: still pending, not expired
    assert.equal((await submitSwap(ctx(chain({ statuses: [() => null], height: () => 120 }), store), { side: "sol-in", ixs, sign: swap, pollMs: 1 })).kind, "pending");
    // the height unreadable at signing: the compiled expiry plus the long fallback
    const s2 = new MemStore(), c2 = chain({ statusThrows: 99, heightThrows: true });
    await submitSwap(ctx(c2, s2), { side: "sol-in", ixs, sign: swap, pollMs: 1 });
    assert.equal(loadPending(s2, "devnet", mint.toBase58(), payer.publicKey.toBase58())!.lastValidBlockHeight, 100 + UNKNOWN_EXPIRY_BLOCKS);
    // the wallet kept the blockhash: the compiled expiry
    const s3 = new MemStore(); await run(chain({ statusThrows: 99 }), s3);
    assert.equal(loadPending(s3, "devnet", mint.toBase58(), payer.publicKey.toBase58())!.lastValidBlockHeight, 100);
  });
  test("3c: wallet A's held swap never blocks or labels wallet B", async () => {
    const store = new MemStore();
    assert.equal((await run(chain({ statusThrows: 99 }), store)).kind, "pending");   // wallet A (payer) holds one
    const b = Keypair.generate(), signB = async (t: VersionedTransaction) => { t.sign([b]); return t; };
    const cb = chain({ statuses: [() => ({ err: null, confirmationStatus: "confirmed" })] });
    const out = await submitSwap({ conn: cb, store, network: "devnet", mint, owner: b.publicKey }, { side: "sol-in", ixs: [syncNativeIx(b.publicKey)], sign: signB, pollMs: 1, held: loadPending(store, "devnet", mint.toBase58(), payer.publicKey.toBase58()) });
    assert.equal(out.kind, "confirmed", "B's own swap is sent and confirmed, not reported as A's");
    assert.equal(cb.sends, 1);
    assert.equal(loadPending(store, "devnet", mint.toBase58(), b.publicKey.toBase58()), null);
    assert.ok(loadPending(store, "devnet", mint.toBase58(), payer.publicKey.toBase58()), "A's record is untouched");
  });
  test("3d: overlapping status reads run once, and a late pending answer never re-holds a settled swap", async () => {
    const rec: PendingSwap = { v: 1, network: "devnet", mint: mint.toBase58(), owner: payer.publicKey.toBase58(), signature: "5".repeat(88), lastValidBlockHeight: 100, side: "sol-in", at: 1 };
    const w = new PendingWatch(); w.hold(rec);
    let calls = 0, release!: (o: SwapOutcome) => void;
    const slow = () => { calls++; return new Promise<SwapOutcome>((r) => { release = r; }); };
    const first = w.check(rec, slow), second = await w.check(rec, slow);
    assert.equal(second, null, "the overlapping read is skipped"); assert.equal(calls, 1);
    release({ kind: "confirmed", signature: rec.signature, balances: null });
    assert.equal((await first)?.kind, "confirmed");
    assert.equal(w.current, null);
    // a read started before the settle that answers pending afterwards is dropped
    const w2 = new PendingWatch(); w2.hold(rec);
    let rel2!: (o: SwapOutcome) => void;
    const late = w2.check(rec, () => new Promise<SwapOutcome>((r) => { rel2 = r; }));
    w2.hold(null);   // the swap settled through the Swap button's own path
    rel2({ kind: "pending", signature: rec.signature, pending: rec });
    assert.equal(await late, null);
    assert.equal(w2.current, null, "still settled");
  });
});
