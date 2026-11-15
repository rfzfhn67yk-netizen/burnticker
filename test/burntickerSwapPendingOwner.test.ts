// HB-65 (sixth pre-launch audit 2026-10-19, AP6-4; ported from the auditor's audit6ApiSwapPendingClear.test.ts and its follow-up). The
// held swap's signature was readable by anyone through the GET and was all a DELETE needed, so a stranger could remove another wallet's
// server-side hold. Now the server reads the chain itself: a record that may still land is shown sealed (no signature) and cannot be
// removed by anyone; once the chain shows it settled, the owner's panel sees it whole and its DELETE removes it. Fake chain, no network.
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { limiter } from "@/lib/burnticker/api/http";
import { heldState, setSwapPendingChainForTests, type SwapChainReader } from "@/lib/burnticker/swap/pendingServer";
import { httpPendingRemote } from "@/lib/burnticker/swap/pending";

process.env.BURNTICKER_SWAP_PENDING_DB = ":memory:";

/** A chain whose height and the swap's status the test moves. */
function fakeChain() {
  const c = { height: 50, status: null as { err: unknown; confirmationStatus?: string } | null, fail: false, reads: 0 };
  const reader: SwapChainReader = {
    getBlockHeight: async () => { c.reads++; if (c.fail) throw new Error("rpc down"); return c.height; },
    getSignatureStatuses: async () => { if (c.fail) throw new Error("rpc down"); return { value: [c.status] }; },
  };
  return { c, reader };
}
const chain = fakeChain();
setSwapPendingChainForTests(() => chain.reader);
after(() => setSwapPendingChainForTests(null));
beforeEach(() => { limiter.reset(); chain.c.height = 50; chain.c.status = null; chain.c.fail = false; });

const host = "burnticker.test";
const h = { host, origin: `https://${host}`, "content-type": "application/json" };
async function held() {
  const route = await import("@/app/api/burnticker/swap-pending/route");
  const owner = Keypair.generate(), mint = Keypair.generate().publicKey;
  const msg = new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: "11111111111111111111111111111111", instructions: [SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: mint, lamports: 1 })] }).compileToV0Message();
  const tx = new VersionedTransaction(msg); tx.sign([owner]);
  const bs58 = (await import("bs58")).default;
  const signature = bs58.encode(tx.signatures[0]);
  const base = { network: "devnet", mint: mint.toBase58(), owner: owner.publicKey.toBase58() };
  const put = await route.POST(new Request(`https://${host}/api/burnticker/swap-pending`, { method: "POST", headers: h, body: JSON.stringify({ ...base, signature, lastValidBlockHeight: 100, side: "sol-in", tx: Buffer.from(tx.serialize()).toString("base64") }) }));
  assert.equal(put.status, 200, "the owner's own record is written");
  const get = async (q = base) => (await (await route.GET(new Request(`https://${host}/api/burnticker/swap-pending?network=${q.network}&mint=${q.mint}&owner=${q.owner}`, { headers: { host } }))).json()) as { pending: { signature?: string; sealed?: boolean } | null };
  const del = async (body: Record<string, unknown>, extra: Record<string, string> = {}) => { const r = await route.DELETE(new Request(`https://${host}/api/burnticker/swap-pending`, { method: "DELETE", headers: { ...h, ...extra }, body: JSON.stringify(body) })); return { status: r.status, body: (await r.json()) as { removed?: boolean; code?: string } }; };
  return { route, base, signature, get, del };
}

describe("HB-65: a held swap that may still land cannot be read whole or removed by anyone", () => {
  test("the auditor's case: a stranger reads no signature, and a DELETE with the record's signature is refused 403; the record remains", async () => {
    const { base, signature, get, del } = await held();
    const seen = await get();
    assert.equal(seen.pending?.sealed, true, "held, sealed");
    assert.equal(seen.pending?.signature, undefined, "the GET no longer hands out the signature of a swap that may still land");
    const r = await del({ ...base, signature }, { "x-forwarded-for": "203.0.113.9" });
    assert.equal(r.status, 403); assert.equal(r.body.code, "swap-unsettled"); assert.notEqual(r.body.removed, true);
    assert.equal((await get()).pending?.sealed, true, "the record remains");
  });

  test("another wallet, coin, network or signature removes nothing (403), even once the swap settled", async () => {
    const { base, signature, get, del } = await held();
    chain.c.status = { err: null, confirmationStatus: "confirmed" };
    for (const body of [{ ...base, owner: Keypair.generate().publicKey.toBase58(), signature }, { ...base, mint: Keypair.generate().publicKey.toBase58(), signature }, { ...base, network: "mainnet", signature }, { ...base, signature: "5".repeat(88) }]) {
      const r = await del(body);
      assert.equal(r.status, 403, JSON.stringify(r.body)); assert.notEqual(r.body.removed, true);
    }
    assert.equal((await del({ ...base })).status, 400, "no signature at all");
    assert.equal((await get()).pending?.signature, signature, "still held");
  });

  test("an unreadable chain keeps the record (503) and keeps it sealed", async () => {
    const { base, signature, get, del } = await held();
    chain.c.fail = true;
    assert.equal((await get()).pending?.sealed, true);
    assert.equal((await del({ ...base, signature })).status, 503);
    chain.c.fail = false;
    assert.equal((await get()).pending?.sealed, true);
  });

  test("the owner's flow: once confirmed (or failed, or expired) the record reads whole and the owner's DELETE removes it", async () => {
    for (const settle of [() => { chain.c.status = { err: null, confirmationStatus: "confirmed" }; }, () => { chain.c.status = { err: { InstructionError: [0, "Custom"] } }; }, () => { chain.c.height = 50 + 150 + 151; }]) {   // stored expiry: the height at save (50) + the blockhash window
      limiter.reset(); chain.c.height = 50; chain.c.status = null;
      const { base, signature, get, del } = await held();
      settle();
      assert.equal((await get()).pending?.signature, signature, "whole once it cannot land: the owner's recovered panel settles it");
      const r = await del({ ...base, signature });
      assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.removed, true);
      assert.equal((await get()).pending, null);
    }
  });

  test("the panel's client treats a sealed hold as unknown (Check again), never as no hold", async () => {
    const remote = httpPendingRemote(async () => ({ ok: true, json: async () => ({ pending: { v: 1, network: "devnet", mint: "M", owner: "O", sealed: true, side: "sol-in", at: 1 } }) }));
    await assert.rejects(remote.load("devnet", "M", "O"));
  });

  test("heldState: past expiry but still seen on chain is pending; no reader is unknown", async () => {
    assert.equal(await heldState(null, { signature: "s", lastValidBlockHeight: 1 }), "unknown");
    chain.c.height = 10_000; chain.c.status = { err: null, confirmationStatus: "processed" };
    assert.equal(await heldState(chain.reader, { signature: "s", lastValidBlockHeight: 1 }), "pending");
  });

  test("cross-origin writes are refused with code cross-origin; the body is capped before it is read whole", async () => {
    const route = await import("@/app/api/burnticker/swap-pending/route");
    for (const m of ["POST", "DELETE"] as const) {
      const r = await route[m](new Request(`https://${host}/api/burnticker/swap-pending`, { method: m, headers: { host, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }));
      assert.equal(r.status, 403); assert.equal(((await r.json()) as { code?: string }).code, "cross-origin");
    }
    const big = await route.DELETE(new Request(`https://${host}/api/burnticker/swap-pending`, { method: "DELETE", headers: h, body: "x".repeat(20_000) }));
    assert.equal(big.status, 400);
    const src = fs.readFileSync("src/app/api/burnticker/swap-pending/route.ts", "utf8");
    // HB-65 v4: GET and DELETE judge with the server's own chain reader, after an unknown expiry is revalidated from it
    assert.equal(src.match(/const chain = await swapPendingChain\(rec\.network\);\s*rec = await revalidateExpiry\(swapPendingStore\(\), chain, rec\);[^\n]*\n\s*const state = await heldState\(chain, rec\);/g)?.length, 2);
  });
});

// HB-65 v2 (the auditor's replay-overwrite.test.mjs, 2026-10-19T2319Z): an older signed transaction replayed by POST replaced the
// unresolved hold, and the same bytes replayed with lastValidBlockHeight 0 re-dated it so it read as expired. Now a held record is
// replaced only after the server saw it settled, a held signature is never re-dated, the expiry is the server's, and one record wins.
describe("HB-65 v2: an unresolved hold is never replaced or re-dated by a replayed transaction", () => {
  /** a fresh wallet and coin, its signed transactions, and the route */
  async function fresh() {
    const owner = Keypair.generate(), mint = Keypair.generate().publicKey;
    const bs58 = (await import("bs58")).default;
    const signed = (lamports: number) => {
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: "11111111111111111111111111111111", instructions: [SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: mint, lamports })] }).compileToV0Message());
      tx.sign([owner]);
      return { network: "devnet", owner: owner.publicKey.toBase58(), mint: mint.toBase58(), side: "sol-in", signature: bs58.encode(tx.signatures[0]), lastValidBlockHeight: 5000, tx: Buffer.from(tx.serialize()).toString("base64") };
    };
    const route = await import("@/app/api/burnticker/swap-pending/route");
    const url = `https://${host}/api/burnticker/swap-pending`;
    const post = async (b: unknown) => { const r = await route.POST(new Request(url, { method: "POST", headers: h, body: JSON.stringify(b) })); return { status: r.status, code: ((await r.json()) as { code?: string }).code }; };
    const del = async (b: unknown) => { const r = await route.DELETE(new Request(url, { method: "DELETE", headers: h, body: JSON.stringify(b) })); return { status: r.status, removed: ((await r.json()) as { removed?: boolean }).removed }; };
    const get = async () => ((await (await route.GET(new Request(`${url}?network=devnet&mint=${mint.toBase58()}&owner=${owner.publicKey.toBase58()}`, { headers: { host } }))).json()) as { pending: { signature?: string; sealed?: boolean } | null });
    const store = (await import("@/lib/burnticker/swap/pendingServer")).swapPendingStore();
    const held = () => store.get("devnet", mint.toBase58(), owner.publicKey.toBase58());
    return { signed, post, del, get, held };
  }
  /** the auditor's chain: height 1000, the listed signatures finalized, everything else unseen */
  const auditorChain = (finalized: Set<string>) => setSwapPendingChainForTests(() => ({ getBlockHeight: async () => 1000, getSignatureStatuses: async ([s]: string[]) => ({ value: [finalized.has(s) ? { err: null, confirmationStatus: "finalized" } : null] }) }));
  const restore = () => setSwapPendingChainForTests(() => chain.reader);

  test("(auditor v2) an older, finalized transaction posted over a newer unresolved hold is refused 409 swap-held; the hold stays", async () => {
    const f = await fresh(); const old = f.signed(1), current = f.signed(2);
    auditorChain(new Set([old.signature]));
    try {
      assert.equal((await f.post(current)).status, 200);
      assert.equal((await f.get()).pending?.sealed, true);
      assert.deepEqual(await f.post(old), { status: 409, code: "swap-held" });
      assert.equal((await f.del(old)).status, 403, "the old signature is not the held one");
      assert.equal((await f.get()).pending?.sealed, true, "the current unresolved hold is still there");
      assert.equal(f.held()?.signature, current.signature);
    } finally { restore(); }
  });

  test("(auditor v3) the same bytes with lastValidBlockHeight 0 change nothing: the server's expiry stands and the hold stays", async () => {
    const f = await fresh(); const current = f.signed(3);
    auditorChain(new Set());
    try {
      assert.equal((await f.post(current)).status, 200);
      assert.equal(f.held()?.lastValidBlockHeight, 1000 + 150, "the height at save + the blockhash window, not the posted 5000");
      assert.equal((await f.post({ ...current, lastValidBlockHeight: 0 })).status, 200, "an exact retry is idempotent");
      assert.equal(f.held()?.lastValidBlockHeight, 1000 + 150, "not re-dated");
      assert.equal((await f.del(current)).status, 403, "still unresolved");
      assert.equal((await f.get()).pending?.sealed, true);
    } finally { restore(); }
  });

  test("a first save posting a low height still gets the server's expiry", async () => {
    const f = await fresh(); const a = f.signed(1);
    assert.equal((await f.post({ ...a, lastValidBlockHeight: 0 })).status, 200);
    assert.equal(f.held()?.lastValidBlockHeight, 50 + 150);
    assert.equal((await f.del(a)).status, 403, "still unresolved at height 50");
  });

  test("two different signatures posted at once leave one record; the other is refused 409", async () => {
    const f = await fresh(); const a = f.signed(1), b = f.signed(2);
    const [ra, rb] = await Promise.all([f.post(a), f.post(b)]);
    assert.deepEqual([ra.status, rb.status].sort(), [200, 409]);
    assert.equal(f.held()?.signature, ra.status === 200 ? a.signature : b.signature);
  });

  test("once the held swap settled, a new one replaces it; and the owner's cleanup removes a settled record", async () => {
    const f = await fresh(); const a = f.signed(1), b = f.signed(2);
    assert.equal((await f.post(a)).status, 200);
    assert.equal((await f.post(b)).status, 409);
    chain.c.status = { err: null, confirmationStatus: "confirmed" };   // the fake answers this for every signature
    assert.equal((await f.post(b)).status, 200, "a settled hold may be replaced");
    assert.equal(f.held()?.signature, b.signature);
    assert.deepEqual(await f.del(b), { status: 200, removed: true });
    assert.equal(f.held(), null);
  });
});
