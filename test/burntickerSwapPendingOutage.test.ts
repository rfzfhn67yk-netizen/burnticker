// HB-65 v4 (continuous audit 2026-10-20T0019Z, inbox BT-INC-20261020T0019Z-01). When the chain could not be read at a swap's FIRST save,
// the route kept the caller's posted lastValidBlockHeight, so a caller holding its own signed bytes could post 0 during an RPC outage
// and later have an unresolved hold judged expired and removed. Now a signer-supplied value never decides server state: a configured
// chain that cannot be read refuses the save (503, nothing stored), a server with no chain reader keeps the record with its expiry
// marked unknown (never judged expired), and the first successful height read stamps the server's own expiry once. Fake chain, no network.
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { limiter } from "@/lib/burnticker/api/http";
import { BLOCKHASH_WINDOW_BLOCKS, UNKNOWN_EXPIRY, heldState, setSwapPendingChainForTests, swapPendingStore, trustedExpiry, type SwapChainReader } from "@/lib/burnticker/swap/pendingServer";
import { SAVE_ATTEMPTS, httpPendingRemote, type PendingSwap } from "@/lib/burnticker/swap/pending";

process.env.BURNTICKER_SWAP_PENDING_DB = ":memory:";

const c = { height: 1000, down: false, status: null as { err: unknown; confirmationStatus?: string } | null, none: false };
const reader: SwapChainReader = {
  getBlockHeight: async () => { if (c.down) throw new Error("isolated outage"); return c.height; },
  getSignatureStatuses: async () => { if (c.down) throw new Error("isolated outage"); return { value: [c.status] }; },
};
setSwapPendingChainForTests(() => (c.none ? null : reader));
after(() => setSwapPendingChainForTests(null));
beforeEach(() => { limiter.reset(); c.height = 1000; c.down = false; c.status = null; c.none = false; });

const host = "burnticker.test", url = `https://${host}/api/burnticker/swap-pending`;
const h = { host, origin: `https://${host}`, "content-type": "application/json" };
function signed(lastValidBlockHeight: number) {
  const owner = Keypair.generate(), mint = Keypair.generate().publicKey;
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: "11111111111111111111111111111111", instructions: [SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: mint, lamports: 1 })] }).compileToV0Message());
  tx.sign([owner]);
  return { network: "devnet" as const, owner: owner.publicKey.toBase58(), mint: mint.toBase58(), side: "sol-in" as const, signature: bs58.encode(tx.signatures[0]), lastValidBlockHeight, tx: Buffer.from(tx.serialize()).toString("base64") };
}
async function api() {
  const route = await import("@/app/api/burnticker/swap-pending/route");
  return {
    post: async (b: unknown) => { const r = await route.POST(new Request(url, { method: "POST", headers: h, body: JSON.stringify(b) })); return { status: r.status, retryAfter: r.headers.get("retry-after"), body: (await r.json()) as { ok?: boolean; code?: string; retryAfterMs?: number; signature?: string } }; },
    del: async (b: unknown) => { const r = await route.DELETE(new Request(url, { method: "DELETE", headers: h, body: JSON.stringify(b) })); return { status: r.status, body: (await r.json()) as { removed?: boolean; code?: string } }; },
    get: async (q: { network: string; mint: string; owner: string }) => (await (await route.GET(new Request(`${url}?network=${q.network}&mint=${q.mint}&owner=${q.owner}`, { headers: { host } }))).json()) as { pending: { signature?: string; sealed?: boolean } | null },
  };
}
const stored = (s: ReturnType<typeof signed>) => swapPendingStore().get(s.network, s.mint, s.owner);

describe("HB-65 v4: an RPC outage at the first save cannot freeze a caller's expiry", () => {
  test("outage at first save: 503 chain-unavailable with Retry-After, and nothing is stored", async () => {
    const { post } = await api();
    const s = signed(0);
    c.down = true;
    const r = await post(s);
    assert.equal(r.status, 503);
    assert.equal(r.body.ok, false); assert.equal(r.body.code, "chain-unavailable");
    assert.ok(typeof r.body.retryAfterMs === "number" && r.body.retryAfterMs > 0);
    assert.ok(Number(r.retryAfter) >= 1, "a Retry-After header");
    assert.equal(stored(s), null, "no record was kept");
  });

  test("the chain back: the same POST is simply the first save, with the server's own expiry", async () => {
    const { post } = await api();
    const s = signed(0);
    c.down = true; assert.equal((await post(s)).status, 503);
    c.down = false;
    const r = await post(s);
    assert.equal(r.status, 200); assert.equal(r.body.signature, s.signature);
    assert.equal(stored(s)?.lastValidBlockHeight, 1000 + BLOCKHASH_WINDOW_BLOCKS);
  });

  test("a forged lastValidBlockHeight of 0 with the chain up is replaced by the server's expiry, and DELETE is refused while unresolved", async () => {
    const { post, del, get } = await api();
    const s = signed(0);
    assert.equal((await post(s)).status, 200);
    assert.equal(stored(s)?.lastValidBlockHeight, 1000 + BLOCKHASH_WINDOW_BLOCKS);
    c.height = 1100;
    const d = await del(s);
    assert.equal(d.status, 403); assert.equal(d.body.code, "swap-unsettled");
    assert.equal((await get(s)).pending?.sealed, true, "still held, sealed");
  });

  test("the auditor's sequence: outage POST of 0, chain back, retry, DELETE: the hold remains", async () => {
    const { post, del, get } = await api();
    const s = signed(5000);
    c.down = true; assert.equal((await post({ ...s, lastValidBlockHeight: 0 })).status, 503);
    c.down = false; assert.equal((await post(s)).status, 200);
    assert.equal((await del(s)).status, 403);
    assert.ok((await get(s)).pending, "the unresolved swap is still recoverable");
  });

  test("no chain reader: kept with an unknown expiry; DELETE refuses; the first height read stamps the server's expiry once", async () => {
    const { post, del, get } = await api();
    const s = signed(0);
    c.none = true;
    assert.equal((await post(s)).status, 200, "kept, so the panel can still find it after a cleared browser");
    assert.equal(stored(s)?.lastValidBlockHeight, UNKNOWN_EXPIRY, "the posted 0 is not kept");
    assert.equal((await del(s)).status, 503, "no chain: the record is kept");
    assert.equal((await get(s)).pending?.sealed, true);
    // the chain configured again, far past any expiry the caller could claim: the record is NOT settled by expiry
    c.none = false; c.height = 9_000_000;
    assert.equal(await heldState(reader, { signature: s.signature, lastValidBlockHeight: UNKNOWN_EXPIRY }), "pending", "an unknown expiry is never judged past");
    const d = await del(s);
    assert.equal(d.status, 403, "unresolved: refused"); assert.equal(d.body.code, "swap-unsettled");
    assert.equal(stored(s)?.lastValidBlockHeight, 9_000_000 + BLOCKHASH_WINDOW_BLOCKS, "stamped from the server's own height read");
    // stamped exactly once: a later re-POST (even with a forged 0) and a later height do not re-date it
    c.height = 9_100_000;
    assert.equal((await post(s)).status, 200);
    assert.equal(stored(s)?.lastValidBlockHeight, 9_000_000 + BLOCKHASH_WINDOW_BLOCKS);
    // once the stamped expiry has passed and the swap is nowhere, the normal rules apply
    c.height = 9_000_000 + BLOCKHASH_WINDOW_BLOCKS + 151;
    assert.equal((await del(s)).status, 200);
    assert.equal(stored(s), null);
  });

  test("no chain reader, then a re-POST of the same signature with the chain up stamps the server's expiry", async () => {
    const { post } = await api();
    const s = signed(0);
    c.none = true; assert.equal((await post(s)).status, 200);
    c.none = false; c.height = 2000;
    assert.equal((await post({ ...s, lastValidBlockHeight: 0 })).status, 200);
    assert.equal(stored(s)?.lastValidBlockHeight, 2000 + BLOCKHASH_WINDOW_BLOCKS);
  });

  test("an unknown-expiry record settles by a confirmed status (the whole record reads back)", async () => {
    const { post, get } = await api();
    const s = signed(0);
    c.none = true; assert.equal((await post(s)).status, 200);
    c.none = false; c.down = true;
    assert.equal((await get(s)).pending?.sealed, true, "chain unreadable: still sealed, still unknown");
    assert.equal(stored(s)?.lastValidBlockHeight, UNKNOWN_EXPIRY);
    c.down = false; c.status = { err: null, confirmationStatus: "confirmed" };
    assert.equal((await get(s)).pending?.signature, s.signature);
  });

  test("trustedExpiry never returns the posted value", async () => {
    assert.equal(await trustedExpiry(null), UNKNOWN_EXPIRY);
    c.down = true; assert.equal(await trustedExpiry(reader), "unavailable");
    c.down = false; assert.equal(await trustedExpiry(reader), 1000 + BLOCKHASH_WINDOW_BLOCKS);
  });
});

describe("HB-65 v4: the panel retries a save refused with 503 chain-unavailable", () => {
  const rec: PendingSwap = { v: 1, network: "devnet", mint: "M".repeat(43), owner: "O".repeat(43), signature: "5".repeat(88), lastValidBlockHeight: 10, side: "sol-in", at: 1 };
  const busy = { ok: false, status: 503, json: async () => ({ ok: false, code: "chain-unavailable", retryAfterMs: 1 }) };
  test("a 503 then a 200 naming the signature: acknowledged", async () => {
    let n = 0;
    const remote = httpPendingRemote(async () => (++n === 1 ? busy : { ok: true, status: 200, json: async () => ({ ok: true, signature: rec.signature }) }));
    await remote.save(rec, new Uint8Array([1]));
    assert.equal(n, 2);
  });
  test("bounded: after SAVE_ATTEMPTS refusals the save throws (nothing is sent)", async () => {
    let n = 0;
    const remote = httpPendingRemote(async () => { n++; return busy; });
    await assert.rejects(remote.save(rec, new Uint8Array([1])));
    assert.equal(n, SAVE_ATTEMPTS);
  });
  test("any other refusal is not retried", async () => {
    let n = 0;
    const remote = httpPendingRemote(async () => { n++; return { ok: false, status: 409, json: async () => ({ code: "swap-held" }) }; });
    await assert.rejects(remote.save(rec, new Uint8Array([1])));
    assert.equal(n, 1);
  });
});
