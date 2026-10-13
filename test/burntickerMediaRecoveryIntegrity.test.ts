// LAUNCH INTEGRITY 251–253 (launch-media-recovery, 2026-10-12). 251: the Coin vs Coin fingerprint is tied to its input; 252: a prepared
// launch whose draft changed while it was built is discarded (no wallet), and the signing screen reads the prepared plan only; 253: the
// transaction the wallet returns must be the one built here, with the mint signatures intact, before anything is sent. Mocked wallets only.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { buildStepTx, failureSentence, launchlabPlan, memoryPlanStorage, signAndSendPlan, walletReturnProblem, type LaunchlabBundleLike, type SignPlan } from "@/lib/burnticker/signPlan";
import { createLatest } from "@/lib/burnticker/latestOnly";
import { draftRevision } from "@/lib/burnticker/launchReviewSync";
import { fingerprintFor, prepareIfCurrent, profileRevision, startFingerprint, STALE_PREPARE_SENTENCE } from "@/lib/burnticker/preparedLaunch";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const cfg = loadCopyLintConfig();
const BH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", BH2 = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";
const creatorKp = Keypair.generate(), CREATOR = creatorKp.publicKey.toBase58();
const b58 = (bytes: Uint8Array) => { const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; const Z = BigInt(0), B = BigInt(58); let x = BigInt("0x" + Buffer.from(bytes).toString("hex")), s = ""; while (x > Z) { s = A[Number(x % B)] + s; x /= B; } return s; };
const ix = (signer: string, data = 1) => ({ programId: "11111111111111111111111111111111", label: "test", dataBase64: Buffer.from([2, 0, 0, 0, data, 0, 0, 0, 0, 0, 0, 0]).toString("base64"), keys: [{ pubkey: CREATOR, isSigner: true, isWritable: true }, { pubkey: signer, isSigner: true, isWritable: true }] });
const bundle = (ticker: string): LaunchlabBundleLike => {
  const mint = Keypair.generate(), m = mint.publicKey.toBase58();
  return { mint: m, ticker, ready: true, pending: [], mintSecretKey: b58(mint.secretKey), transactions: [{ label: "create", signers: ["creator", "mint"], instructions: [ix(m)] }, { label: "set up", signers: ["creator"], instructions: [ix(CREATOR)] }] };
};

// ---- 253 ----------------------------------------------------------------------------------------------------------------------
/** a wallet that does `tamper` to what it is handed, then signs as the creator */
const run = async (plan: SignPlan, tamper: (tx: VersionedTransaction) => VersionedTransaction) => {
  let sends = 0, store = memoryPlanStorage();
  const r = await signAndSendPlan(plan, CREATOR, {
    latestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 1 }),
    signTransaction: async (tx) => { const t = tamper(tx); t.sign([creatorKp]); return t; },
    lookupTable: async () => null,
    sendRaw: async () => { sends++; return `sig${sends}`; },
    confirm: async () => ({ err: null }),
    storage: store,
  });
  return { r, sends, pendingStored: store.keys!().some((k) => JSON.parse(store.get(k)!).pending) };
};
describe("253 [FIX] the wallet's transaction must be the one built here", () => {
  const b = bundle("AYE"), plan = launchlabPlan([b]), step = plan.steps[0];
  const cases: [string, (tx: VersionedTransaction) => VersionedTransaction, RegExp][] = [
    ["changes an instruction", () => buildStepTx({ ...step, instructions: [ix(b.mint, 9)] }, CREATOR, plan.keys, BH), /changed the transaction's instructions or accounts/],
    ["changes the fee payer", () => { const other = Keypair.generate(); const t = buildStepTx({ ...step, instructions: [{ ...ix(b.mint), keys: [{ pubkey: other.publicKey.toBase58(), isSigner: true, isWritable: true }, { pubkey: CREATOR, isSigner: true, isWritable: true }, { pubkey: b.mint, isSigner: true, isWritable: true }] }] }, other.publicKey.toBase58(), plan.keys, BH); return t; }, /changed who pays the fee/],
    ["changes the blockhash", () => buildStepTx(step, CREATOR, plan.keys, BH2), /changed the transaction's blockhash/],
    ["drops the mint signature", (tx) => { tx.signatures[1] = new Uint8Array(64); return tx; }, /removed or changed the \$AYE mint key's signature/],
    ["returns an unrelated transaction", () => buildStepTx(plan.steps[1], CREATOR, plan.keys, BH), /changed who signs the transaction|changed the transaction's instructions or accounts/],
  ];
  for (const [label, tamper, why] of cases) test(`a wallet that ${label}: refused, nothing sent, nothing stored as sent`, async () => {
    const { r, sends, pendingStored } = await run(plan, tamper);
    assert.equal(sends, 0); assert.equal(pendingStored, false);
    assert.deepEqual([r.failedAt, r.state], [0, "not-sent"]);
    assert.match(r.error!, why);
    assert.match(failureSentence(r, 2), /Nothing was sent\.$/);
    assert.ok(lintCopy(r.error!, cfg).ok, r.error!);
  });
  test("a wallet that only adds its own signature: sent as before", async () => {
    const { r, sends } = await run(plan, (tx) => tx);
    assert.deepEqual([r.error, sends], [null, 2]);
  });
  test("the pure check names each difference", () => {
    const built = buildStepTx(step, CREATOR, plan.keys, BH);
    const snap = { message: built.message.serialize(), signatures: built.signatures.map((s) => Uint8Array.from(s)) };
    const same = VersionedTransaction.deserialize(built.serialize()); same.sign([creatorKp]);
    assert.equal(walletReturnProblem(snap, same, step, plan), null);
  });
});

// ---- 251 ----------------------------------------------------------------------------------------------------------------------
describe("251 [FIX] the Coin vs Coin fingerprint belongs to its input", () => {
  test("reordered completions: the older answer never lands; an older failure never clears the newer hash", async () => {
    const latest = createLatest();
    let state: { input: string; hash: string } | null = null;
    const set = (v: typeof state) => { state = v; };
    const pending: Record<string, { ok: (h: string) => void; no: (e: Error) => void }> = {};
    const compute = (input: string) => new Promise<string>((ok, no) => { pending[input] = { ok, no }; });
    const one = startFingerprint(latest, "WIF|SHIB|2%", compute, set);
    const two = startFingerprint(latest, "WIF|BONK|2%", compute, set);
    pending["WIF|BONK|2%"].ok("hashB"); await two;
    pending["WIF|SHIB|2%"].ok("hashA"); await one;
    assert.deepEqual(state, { input: "WIF|BONK|2%", hash: "hashB" }, "the late answer for the old pick is dropped");
    const three = startFingerprint(latest, "WIF|BONK|5%", compute, set);
    const four = startFingerprint(latest, "WIF|BONK|10%", compute, set);
    pending["WIF|BONK|10%"].ok("hashD"); await four;
    pending["WIF|BONK|5%"].no(new Error("crypto busy")); await three;
    assert.deepEqual(state, { input: "WIF|BONK|10%", hash: "hashD" }, "an older rejection does not clear the newer hash");
    // the model only ever pairs the current choice with ITS fingerprint
    assert.equal(fingerprintFor(state, "WIF|BONK|10%"), "hashD");
    assert.equal(fingerprintFor(state, "WIF|BONK|5%"), null);
    assert.equal(fingerprintFor(null, "x"), null);
  });
  test("the tile wires it", () => {
    const t = code("src/app/burnticker/launch/CoinVsCoinTile.tsx");
    assert.doesNotMatch(t, /\.then\(setHash\)/);
    assert.match(t, /startFingerprint\(hashLatest, /);
    assert.match(t, /const hash = choice \? fingerprintFor\(fp, tileHashInput\(choice\)\) : null;/);
  });
});

// ---- 252 ----------------------------------------------------------------------------------------------------------------------
describe("252 [FIX] a response for an older draft is discarded; the signing screen reads the prepared plan", () => {
  const draft = (o: Partial<{ ta: string; a: string; fraction: number; ref: string; desc: string; image: string | null }> = {}) => {
    const d = { ta: "WIFVSHIB", a: "WIF vs SHIB, WIF side", fraction: 0.02, ref: "WIF|SHIB", desc: "", image: null as string | null, ...o };
    return draftRevision([d.ref, d.fraction, d.ta, d.a, profileRevision({ description: d.desc, x: "", telegram: "", website: "", badge: true, rights: !!d.image, image: d.image ? { name: "a.png", base64: d.image } : null })]);
  };
  for (const [label, change] of [["the names", { a: "Renamed" }], ["a ticker", { ta: "WIFVBONK" }], ["the references", { ref: "WIF|BONK" }], ["the percentage", { fraction: 0.05 }], ["the profile text", { desc: "new words" }], ["the image", { image: "iVBORw0KGgoAAAA" }]] as const) {
    test(`${label} changed while the prepare request was out: no plan, no wallet, a fresh review is needed`, async () => {
      let now = draft();
      const sent = now;
      let answer!: (v: string) => void;
      const p = prepareIfCurrent(sent, () => now, () => new Promise<string>((r) => { answer = r; }));
      now = draft(change);
      answer("the prepared bundle");
      const out = await p;
      assert.deepEqual(out, { stale: true });
      let walletOpened = false; if ("ok" in out) walletOpened = true;
      assert.equal(walletOpened, false);
    });
  }
  test("an unchanged draft gets its plan", async () => {
    const d = draft();
    assert.deepEqual(await prepareIfCurrent(d, () => d, async () => 7), { ok: 7 });
    assert.ok(lintCopy(STALE_PREPARE_SENTENCE, cfg).ok);
  });
  test("the tile: response checked against the current draft; inputs locked while building; the plan and its labels frozen at prepare time", () => {
    const t = code("src/app/burnticker/launch/CoinVsCoinTile.tsx");
    assert.match(t, /const got = await prepareIfCurrent\(sentRev, \(\) => prepRev\.current, /);
    assert.match(t, /if \("stale" in got\) \{ setErr\(STALE_PREPARE_SENTENCE\); return; \}/);
    assert.match(t, /tickers = \{ a: body\.ticker, b: body\.pair\.ticker \}/);
    assert.match(t, /const signPlan = useMemo\(/);
    assert.match(t, /title=\{`Launch \$\$\{prepared\.tickers\.a\} and \$\$\{prepared\.tickers\.b\}`\}/);
    assert.doesNotMatch(t, /<SignCard[^>]*names\.ta/);
    assert.match(t, /locked=\{busy \|\| !!prepared\}/);
    const card = code("src/app/burnticker/launch/ReviewCard.tsx");
    assert.match(card, /<fieldset disabled=\{p\.busy\}[^>]*data-review-inputs/);
  });
});
