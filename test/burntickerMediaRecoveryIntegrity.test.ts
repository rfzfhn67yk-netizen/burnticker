// LAUNCH INTEGRITY 251–253 (launch-media-recovery, 2026-10-12). 251: the Coin vs Coin fingerprint is tied to its input; 252: a prepared
// launch whose draft changed while it was built is discarded (no wallet), and the signing screen reads the prepared plan only; 253: the
// transaction the wallet returns must be the one built here, with the mint signatures intact, before anything is sent. Mocked wallets only.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { buildStepTx, failureSentence, launchlabPlan, memoryPlanStorage, signAndSendPlan, simulationFailureText, walletReturnProblem, type SendDeps, type LaunchlabBundleLike, type SignPlan } from "@/lib/burnticker/signPlan";
import { createLatest } from "@/lib/burnticker/latestOnly";
import { draftRevision } from "@/lib/burnticker/launchReviewSync";
import { fingerprintFor, prepareIfCurrent, profileRevision, startFingerprint, STALE_PREPARE_SENTENCE } from "@/lib/burnticker/preparedLaunch";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const cfg = loadCopyLintConfig();
const BH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", BH2 = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";
const creatorKp = Keypair.generate(), CREATOR = creatorKp.publicKey.toBase58();
const b58 = (bytes: Uint8Array) => { const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; const Z = BigInt(0), B = BigInt(58); let x = BigInt("0x" + Buffer.from(bytes).toString("hex")), s = ""; while (x > Z) { s = A[Number(x % B)] + s; x /= B; } for (const b of bytes) { if (b !== 0) break; s = "1" + s; } return s; };
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
    simulate: async () => null,   // a passing dry run (the runner requires one since Phantom's second review)
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
    // Phantom ticket 438485 (2026-10-14): the wallet now signs FIRST and sees no mint signature, so a wallet cannot "drop" one; a wallet
    // that returns the transaction without the mint's signer slot at all is still refused
    ["removes the mint signer", () => buildStepTx({ ...step, signers: ["creator"], instructions: [{ ...ix(b.mint), keys: [{ pubkey: CREATOR, isSigner: true, isWritable: true }] }] }, CREATOR, plan.keys, BH, null, false), /changed who signs the transaction|changed the transaction's instructions or accounts/],
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
  test("a wallet that replaces a mint signature the page had already added: refused (the pure check)", () => {
    const built = buildStepTx(step, CREATOR, plan.keys, BH);
    const snap = { message: built.message.serialize(), signatures: built.signatures.map((s) => Uint8Array.from(s)) };
    const tampered = VersionedTransaction.deserialize(built.serialize()); tampered.sign([creatorKp]); tampered.signatures[1] = new Uint8Array(64);
    assert.match(walletReturnProblem(snap, tampered, step, plan)!, /removed or changed the \$AYE mint key's signature/);
  });
  test("the shipped order: the wallet is handed an unsigned transaction, signs it, and the mint key signs after (ticket 438485)", async () => {
    let seen = -1;
    const { r, sends } = await run(plan, (tx) => { seen = tx.signatures.filter((s) => s.some((x) => x !== 0)).length; return tx; });
    assert.deepEqual([r.error, sends, seen], [null, 2, 0]);
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

// ---- Phantom ticket 438485 (2026-10-14): a dry run before the wallet signs --------------------------------------------------------
describe("438485 a failed dry run stops the step before the wallet is asked", () => {
  const b = bundle("DRY"), plan = launchlabPlan([b]);
  const runWith = async (simulate: NonNullable<SendDeps["simulate"]>) => {
    let sends = 0, walletAsked = 0;
    const store = memoryPlanStorage();
    const r = await signAndSendPlan(plan, CREATOR, {
      latestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 100 }),
      signTransaction: async (tx) => { walletAsked++; tx.sign([creatorKp]); return tx; },
      simulate,
      lookupTable: async () => null,
      sendRaw: async () => { sends++; return `sig${sends}`; },
      confirm: async () => ({ err: null }),
      storage: store,
    });
    return { r, sends, walletAsked };
  };
  test("the chain reports a failure: refused, the wallet never sees it, nothing sent", async () => {
    const { r, sends, walletAsked } = await runWith(async () => simulationFailureText({ InstructionError: [1, { Custom: 6001 }] }, ["Program log: Instruction: Create", "Program log: Error: insufficient SOL for the seed"]));
    assert.deepEqual([sends, walletAsked, r.failedAt, r.state], [0, 0, 0, "not-sent"]);
    assert.match(r.error!, /dry run of it failed on chain: .*Custom.*6001.*insufficient SOL/);
    assert.ok(lintCopy(r.error!, cfg).ok, r.error!);
  });
  test("the dry run passes: the launch proceeds", async () => {
    assert.deepEqual((await runWith(async () => null)).sends, 2);
  });
  test("Phantom's second review (2026-10-16): a dry run the RPC cannot perform stops the step BEFORE the wallet is asked; nothing sent", async () => {
    const { r, sends, walletAsked } = await runWith(async () => { throw new Error("rpc down"); });
    assert.deepEqual([sends, walletAsked, r.failedAt, r.state], [0, 0, 0, "not-sent"]);
    assert.match(r.error!, /dry run could not be run just now \(rpc down\)\. Try again in a moment\./);
    assert.ok(lintCopy(r.error!, cfg).ok, r.error!);
  });
  test("third prelaunch audit F11: step 2's dry run cannot run after step 1 confirmed: the sentence never says nothing was sent (before: 'Nothing was sent' then 'the steps before it are confirmed')", async () => {
    let calls = 0;
    const { r, sends } = await runWith(async () => { if (++calls === 2) throw new Error("rpc down"); return null; });
    assert.deepEqual([sends, r.failedAt, r.state, r.signatures.length], [1, 1, "not-sent", 1]);
    const said = failureSentence(r, 2);
    assert.doesNotMatch(said, /Nothing was sent/);
    assert.match(said, /^Step 2 of 2 was not sent because its dry run could not be run just now \(rpc down\)\. Try again in a moment\. The steps before it are confirmed on chain\./);
    assert.doesNotMatch(said, /\.\./, "one full stop between sentences");
    assert.ok(lintCopy(said, cfg).ok, said);
  });
});

// ---- Phantom ticket 438485 (2026-10-14): the wallet may append its Lighthouse safety checks, nothing else ---------------------------
describe("438485 appended wallet guard instructions", () => {
  const b = bundle("LHT"), plan = launchlabPlan([b]), step = plan.steps[0];
  const LIGHTHOUSE = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
  const withExtra = (programId: string, opts: { front?: boolean; signer?: boolean } = {}) => {
    const built = buildStepTx(step, CREATOR, plan.keys, BH, null, false);
    const msg = TransactionMessage.decompile(built.message);
    const extra = new TransactionInstruction({ programId: new PublicKey(programId), keys: opts.signer ? [{ pubkey: Keypair.generate().publicKey, isSigner: true, isWritable: false }] : [{ pubkey: new PublicKey(CREATOR), isSigner: false, isWritable: false }], data: Buffer.from([1, 2, 3]) });
    const ixs = opts.front ? [extra, ...msg.instructions] : [...msg.instructions, extra];
    const after = new VersionedTransaction(new TransactionMessage({ payerKey: msg.payerKey, recentBlockhash: msg.recentBlockhash, instructions: ixs }).compileToV0Message());
    after.sign([creatorKp]);
    return { handed: { message: built.message.serialize(), signatures: built.signatures.map((s) => Uint8Array.from(s)) }, after };
  };
  test("Lighthouse assertions appended after ours: accepted", () => {
    const { handed, after } = withExtra(LIGHTHOUSE);
    assert.equal(walletReturnProblem(handed, after, step, plan), null);
  });
  test("a compute-budget instruction appended: accepted", () => {
    const { handed, after } = withExtra("ComputeBudget111111111111111111111111111111");
    assert.equal(walletReturnProblem(handed, after, step, plan), null);
  });
  test("an appended instruction from any other program: refused", () => {
    const { handed, after } = withExtra("11111111111111111111111111111111");
    assert.match(walletReturnProblem(handed, after, step, plan)!, /changed the transaction's instructions or accounts/);
  });
  test("a guard instruction placed BEFORE ours: accepted too (Phantom may set a compute budget or an assertion first)", () => {
    const { handed, after } = withExtra(LIGHTHOUSE, { front: true });
    assert.equal(walletReturnProblem(handed, after, step, plan), null);
  });
  test("a compute-budget instruction placed BEFORE ours: accepted", () => {
    const { handed, after } = withExtra("ComputeBudget111111111111111111111111111111", { front: true });
    assert.equal(walletReturnProblem(handed, after, step, plan), null);
  });
  test("one of OUR instructions dropped and a guard added: refused, naming the count", () => {
    const built = buildStepTx(step, CREATOR, plan.keys, BH, null, false);
    const msg = TransactionMessage.decompile(built.message);
    const extra = new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE), keys: [], data: Buffer.from([1]) });
    const after = new VersionedTransaction(new TransactionMessage({ payerKey: msg.payerKey, recentBlockhash: msg.recentBlockhash, instructions: [...msg.instructions.slice(1), extra] }).compileToV0Message());
    after.sign([creatorKp]);
    const why = walletReturnProblem({ message: built.message.serialize(), signatures: built.signatures.map((x) => Uint8Array.from(x)) }, after, step, plan);
    assert.match(why ?? "", /changed the transaction's instructions or accounts|changed who signs/);
  });
  test("a guard instruction that adds a signer: refused", () => {
    const { handed, after } = withExtra(LIGHTHOUSE, { signer: true });
    assert.match(walletReturnProblem(handed, after, step, plan)!, /changed who signs/);
  });
  test("the runner sends a transaction the wallet extended with Lighthouse checks, and the mint key signs the extended message", async () => {
    const sends: VersionedTransaction[] = [];
    const store = memoryPlanStorage();
    const r = await signAndSendPlan(plan, CREATOR, {
      simulate: async () => null,
      latestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 100 }),
      signTransaction: async (tx) => { const msg = TransactionMessage.decompile(tx.message); const extra = new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE), keys: [], data: Buffer.from([9]) }); const t = new VersionedTransaction(new TransactionMessage({ payerKey: msg.payerKey, recentBlockhash: msg.recentBlockhash, instructions: [...msg.instructions, extra] }).compileToV0Message()); t.sign([creatorKp]); return t; },
      lookupTable: async () => null,
      sendRaw: async (raw) => { sends.push(VersionedTransaction.deserialize(raw)); return `sig${sends.length}`; },
      confirm: async () => ({ err: null }),
      storage: store,
    });
    assert.equal(r.error, null);
    const sent = sends[0];   // step 1 is the create: the wallet and the mint key both sign
    assert.ok(sent, "sent");
    assert.equal(sent.message.header.numRequiredSignatures, 2);
    assert.ok(sent.signatures.every((s) => s.some((x) => x !== 0)), "both the wallet and the mint key signed the extended message");
    assert.equal(sent.message.compiledInstructions.length, step.instructions.length + 1);
  });
});
