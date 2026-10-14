// LAUNCH RECOVERY 254–255 (launch-media-recovery, 2026-10-12). 254: the submitted transaction's own signature is its identity, whatever
// the RPC's sendRawTransaction answers. 255: "its blockhash expired and one status read found nothing" is not proof that nothing landed;
// the original signature is read again (status and transaction history) and the accounts the step creates are checked before a step is
// called never-landed and rebuilt. Mocked RPC only.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { bytesToBase58, failureSentence, launchlabPlan, listStoredLaunches, loadPlanRecord, memoryPlanStorage, recoverStoredLaunch, signAndSendPlan, type ChainStatus, type LaunchlabBundleLike, type PlanStorage, type SendDeps } from "@/lib/burnticker/signPlan";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const cfg = loadCopyLintConfig();
const BH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
const creatorKp = Keypair.generate(), CREATOR = creatorKp.publicKey.toBase58();
const b58 = (bytes: Uint8Array) => { const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; const Z = BigInt(0), B = BigInt(58); let x = BigInt("0x" + Buffer.from(bytes).toString("hex")), s = ""; while (x > Z) { s = A[Number(x % B)] + s; x /= B; } for (const b of bytes) { if (b !== 0) break; s = "1" + s; } return s; };
const bundle = (ticker: string): LaunchlabBundleLike => {
  const mint = Keypair.generate(), m = mint.publicKey.toBase58();
  const ix = (signer: string) => ({ programId: "11111111111111111111111111111111", label: "test", dataBase64: Buffer.from([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]).toString("base64"), keys: [{ pubkey: CREATOR, isSigner: true, isWritable: true }, { pubkey: signer, isSigner: true, isWritable: true }] });
  return { mint: m, ticker, ready: true, pending: [], mintSecretKey: b58(mint.secretKey), transactions: [{ label: "create", signers: ["creator", "mint"], instructions: [ix(m)] }, { label: "set up", signers: ["creator"], instructions: [ix(CREATOR)] }] };
};
const sigOf = (raw: Uint8Array) => bytesToBase58(VersionedTransaction.deserialize(raw).signatures[0]);

/** a chain: `send` answers sendRawTransaction; every submitted transaction's real signature is recorded */
function chain(o: { blockhash?: string; store: PlanStorage; send?: (real: string) => string; confirmThrows?: boolean; height?: number; status?: (sig: string) => ChainStatus | null; tx?: (sig: string) => { err: unknown } | null; accounts?: (mints: string[]) => "absent" | "present" | "unknown"; noExtra?: boolean }) {
  const submitted: string[] = [], confirmedWith: string[] = [];
  const deps: SendDeps = {
    latestBlockhash: async () => ({ blockhash: o.blockhash ?? BH, lastValidBlockHeight: 100 }),
    signTransaction: async (tx) => { tx.sign([creatorKp]); return tx; },
    lookupTable: async () => null,
    sendRaw: async (raw) => { const real = sigOf(raw); submitted.push(real); return o.send ? o.send(real) : real; },
    confirm: async (sig) => { confirmedWith.push(sig); if (o.confirmThrows) throw new Error("timeout"); return { err: null }; },
    getSignatureStatus: async (sig) => (o.status ? o.status(sig) : null),
    getBlockHeight: async () => o.height ?? 50,
    storage: o.store,
    ...(o.noExtra ? {} : { getTransaction: async (sig: string) => (o.tx ? o.tx(sig) : null), expectedAccounts: async (mints: string[]) => (o.accounts ? o.accounts(mints) : "absent") }),
  };
  return { deps, submitted, confirmedWith };
}

describe("254 [FIX] the submitted transaction's signature is authoritative", () => {
  for (const [label, send] of [["matching", (r: string) => r], ["different", () => "5VERYdifferentSignatureFromAnotherBackend1111111111111111111111111111111111111111111"], ["empty", () => ""], ["malformed", () => "not a signature!"]] as const) {
    test(`${label} RPC answer: the plan confirms, adopts and stores the transaction it submitted`, async () => {
      const store = memoryPlanStorage(), plan = launchlabPlan([bundle("AYE")]);
      const c = chain({ store, send });
      const r = await signAndSendPlan(plan, CREATOR, c.deps);
      assert.equal(r.error, null);
      assert.deepEqual(r.signatures, c.submitted, "adopted signatures are the submitted transactions'");
      assert.deepEqual(c.confirmedWith, c.submitted, "each confirmation waits on the submitted signature");
    });
    test(`${label} RPC answer, confirmation lost: recovery tracks the submitted transaction`, async () => {
      const store = memoryPlanStorage(), plan = launchlabPlan([bundle("AYE")]);
      const c = chain({ store, send, confirmThrows: true });
      const r = await signAndSendPlan(plan, CREATOR, c.deps);
      assert.equal(r.state, "sent");
      const p = loadPlanRecord(store, plan)!.pending!;
      assert.equal(p.signature, c.submitted[0]); assert.equal(r.signature, c.submitted[0]);
      assert.equal(sigOf(Buffer.from(p.tx, "base64")), c.submitted[0], "the stored bytes are the submitted transaction");
      // the notice after a reload settles THAT signature
      const asked: string[] = [];
      const [s] = listStoredLaunches(store);
      await recoverStoredLaunch(store, s, { getSignatureStatus: async (sig) => { asked.push(sig); return { err: null, confirmationStatus: "confirmed" }; }, getBlockHeight: async () => 50 }, async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }), () => "x");
      assert.deepEqual(asked, [c.submitted[0]]);
    });
  }
});

describe("255 [FIX] an expired blockhash plus one empty status read is not proof that nothing landed", () => {
  const firstRun = async () => {
    const store = memoryPlanStorage(), plan = launchlabPlan([bundle("AYE")]);
    const one = chain({ store, confirmThrows: true });
    await signAndSendPlan(plan, CREATOR, one.deps);
    return { store, plan, sig: one.submitted[0] };
  };
  test("only height and status available (the old evidence): stays sent, nothing rebuilt, and the sentence says it is not known", async () => {
    const { store, plan, sig } = await firstRun();
    const two = chain({ store, height: 101, noExtra: true });
    const r = await signAndSendPlan(plan, CREATOR, two.deps);
    assert.equal(two.submitted.length, 0, "no second create on thin evidence");
    assert.deepEqual([r.state, r.signature], ["sent", sig]);
    assert.match(r.error!, /can no longer land, but the network has not shown whether it landed/);
    assert.doesNotMatch(r.error!, /Nothing it would have created exists/);
    assert.ok(lintCopy(failureSentence(r, 2), cfg).ok, failureSentence(r, 2));
    assert.ok(loadPlanRecord(store, plan)!.pending, "the evidence (signature and bytes) is kept");
  });
  test("a lagging status backend but the transaction history has it: adopted, never rebuilt", async () => {
    const { store, plan, sig } = await firstRun();
    const two = chain({ store, height: 101, tx: (s) => (s === sig ? { err: null } : null) });
    const r = await signAndSendPlan(plan, CREATOR, two.deps);
    assert.equal(r.error, null); assert.equal(r.signatures[0], sig);
    assert.equal(two.submitted.length, 1, "only the set-up step was sent");
  });
  test("the status re-read finds it on the second look: adopted", async () => {
    const { store, plan, sig } = await firstRun();
    let reads = 0;
    const two = chain({ store, height: 101, status: (s) => (s === sig && ++reads > 1 ? { err: null, confirmationStatus: "confirmed" } : null) });
    const r = await signAndSendPlan(plan, CREATOR, two.deps);
    assert.equal(r.signatures[0], sig); assert.equal(two.submitted.length, 1);
  });
  test("history silent but the mint account exists: stays sent with the evidence named, nothing rebuilt", async () => {
    const { store, plan } = await firstRun();
    const two = chain({ store, height: 101, accounts: () => "present" });
    const r = await signAndSendPlan(plan, CREATOR, two.deps);
    assert.equal(two.submitted.length, 0);
    assert.equal(r.state, "sent");
    assert.match(r.error!, /an account this step creates already exists on chain/);
  });
  test("an account read that fails: uncertain, nothing rebuilt", async () => {
    const { store, plan } = await firstRun();
    const two = chain({ store, height: 101, accounts: () => "unknown" });
    assert.equal((await signAndSendPlan(plan, CREATOR, two.deps)).state, "sent"); assert.equal(two.submitted.length, 0);
  });
  test("every check agrees it never landed: the step is rebuilt with a fresh transaction", async () => {
    const { store, plan, sig } = await firstRun();
    const two = chain({ store, height: 101, accounts: () => "absent", blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM" });
    const r = await signAndSendPlan(plan, CREATOR, two.deps);
    assert.equal(r.error, null); assert.equal(two.submitted.length, 2); assert.notEqual(r.signatures[0], sig);
  });
  test("the recovery notice applies the same rule: thin evidence keeps the sent step, full evidence marks it as not landed", async () => {
    const { store } = await firstRun();
    const [s] = listStoredLaunches(store);
    const post = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) });
    const thin = await recoverStoredLaunch(store, s, { getSignatureStatus: async () => null, getBlockHeight: async () => 101 }, post, () => "x");
    assert.ok(thin.rec.pending); assert.match(thin.text, /has not shown whether it landed/);
    const full = await recoverStoredLaunch(store, s, { getSignatureStatus: async () => null, getBlockHeight: async () => 101, getTransaction: async () => null, expectedAccounts: async () => "absent" }, post, () => "x");
    assert.equal(full.rec.pending, null); assert.match(full.text, /did not take effect/);
  });
});

test("the signing card and the recovery notice read the chain through chainReadDeps (history and accounts included)", async () => {
  const fs = await import("node:fs");
  const card = fs.readFileSync("src/app/burnticker/launch/SignCard.tsx", "utf8"), notice = fs.readFileSync("src/app/burnticker/launch/LaunchRecovery.tsx", "utf8");
  assert.match(card, /\.\.\.chainReadDeps\(connection\),/);
  assert.match(notice, /recoverStoredLaunch\(storage, s, chainReadDeps\(connection\),/);
  const { chainReadDeps } = await import("@/lib/burnticker/launchRecovery");
  const conn = { getSignatureStatuses: async () => ({ value: [null] }), getBlockHeight: async () => 9, getTransaction: async () => ({ meta: { err: { X: 1 } } }), getMultipleAccountsInfo: async () => [null, { lamports: 1 }] };
  const d = chainReadDeps(conn as never);
  assert.deepEqual(await d.getTransaction!("s"), { err: { X: 1 } });
  assert.equal(await d.expectedAccounts!([CREATOR, CREATOR]), "present");
});
