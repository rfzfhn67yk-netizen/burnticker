// A LAUNCH STEP AS A VERSION-1 TRANSACTION (Phantom's dApp review, ticket 438485; docs/burnticker/phantom-v1-scope-2026-10-19.md steps
// 1 and 2, 2026-10-19). The same plan the signing card builds for version 0 is carried as a v1 transaction by signPlanV1.ts behind the one
// runner's StepFormat: converted to kit instructions, built with generous limits, sized by ONE simulation (compute units × 1.2, the
// loaded-accounts size rounded up to the next 32 KiB page plus one), bounded at 4,096 bytes and 64 accounts, signed by the wallet first
// through raw bytes, checked byte for byte, then signed by the mint key over the SAME message bytes, and sent through the shared sendRaw.
// The wallet here is a throwaway in-process key pair signing through kit, exactly as the wallet-standard feature hands bytes back; the
// RPC is a fake that answers the devnet spike's readings. Nothing reads a network or a key file.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey, VersionedTransaction, type MessageV1 } from "@solana/web3.js";
import { createKeyPairFromBytes, getTransactionDecoder, getTransactionEncoder, partiallySignTransaction, type Transaction } from "@solana/kit";
import { buildStepV1, compileV1, kitInstructions, keyPairsOf, signStepKeysV1, simulateBase64, sizedLimits, v1BoundsProblem, v1Format, v1StepProblems, walletReturnProblemV1, signatureSlots, requiredSigners, COMPUTE_UNIT_MARGIN, LOADED_ACCOUNTS_PAGE, MAX_COMPUTE_UNITS, MAX_LOADED_ACCOUNTS_BYTES, V1_ACCOUNT_LIMIT, V1_GENEROUS, V1_PACKET_LIMIT, type V1SimulateResult } from "@/lib/burnticker/signPlanV1";
import { base58ToBytes, bytesToBase58, launchlabPlan, listStoredLaunches, loadPlanRecord, memoryPlanStorage, pinPlanFormat, planProblems, signAndSendPlan, WALLET_GUARD_PROGRAMS, type LaunchlabBundleLike, type SignPlan, type SignStep, type V0SendDeps } from "@/lib/burnticker/signPlan";
import { accountSignsV1, decideStepFormat, formatProblems, formatReadinessLine, launchSignVersions, NO_VERSION_SENTENCE, PHANTOM_V0_LINE, phantomVersionLine, PINNED_V0_SENTENCE, PINNED_V1_SENTENCE, signTransactionVersions, signWithStandardWallet, standardAccountFor, standardWalletOf } from "@/lib/burnticker/walletTxVersion";
import { hostedSigning, NO_LOOKUP_TABLE_SENTENCE } from "@/lib/burnticker/hostedLaunch";
import { NETWORKS } from "@/lib/burnticker/networks";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { everyBundleKind } from "./burntickerLutFixtures.ts";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const cfg = loadCopyLintConfig();
const BH = { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 100 };
/** The devnet spike's readings for the LaunchLab create (run-2026-10-19.json). */
const SPIKE = { unitsConsumed: 110_136, loadedAccountsDataSize: 2_681_927 };
const SYSTEM = "11111111111111111111111111111111";
const LIGHTHOUSE = WALLET_GUARD_PROGRAMS[0], COMPUTE = WALLET_GUARD_PROGRAMS[1];

const creatorKp = Keypair.generate(), CREATOR = creatorKp.publicKey.toBase58();
const secretB58 = (kp: Keypair) => bytesToBase58(kp.secretKey);
const wireOf = (tx: Transaction) => new Uint8Array(getTransactionEncoder().encode(tx));
const decode = (bytes: Uint8Array) => getTransactionDecoder().decode(bytes);
/** web3.js 1.99.0 reads the v1 envelope kit wrote (step 0 proved the reader; here it reads the builder's output). */
const web3Reads = (bytes: Uint8Array) => VersionedTransaction.deserialize(bytes);
const configOf = (bytes: Uint8Array) => (web3Reads(bytes).message as MessageV1).transactionConfig;

/** A system-program transfer naming `signer` beside the creator (the shape test/burntickerSignCard.test.ts uses). */
const transferIx = (signer: string, extra: { pubkey: string; isSigner: boolean; isWritable: boolean }[] = [], data = [2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]) => ({ programId: SYSTEM, label: "test", dataBase64: Buffer.from(data).toString("base64"), keys: [{ pubkey: CREATOR, isSigner: true, isWritable: true }, { pubkey: signer, isSigner: true, isWritable: true }, ...extra] });
/** A two-step LaunchLab-shaped bundle with a fresh mint key: "create" (creator + mint) then "first buy" (creator). */
const bundle = (ticker = "TEST"): LaunchlabBundleLike & { mintKp: Keypair } => {
  const mintKp = Keypair.generate();
  return { mintKp, mint: mintKp.publicKey.toBase58(), ticker, ready: true, pending: [], mintSecretKey: secretB58(mintKp), transactions: [{ label: "create", signers: ["creator", "mint"], instructions: [transferIx(mintKp.publicKey.toBase58())] }, { label: "first buy", signers: ["creator"], instructions: [transferIx(CREATOR)] }] };
};

/**
 * The wallet's role, as the wallet-standard feature plays it: bytes in, signed bytes out. "plain" signs what it was handed; "lighthouse"
 * rebuilds the message with its own guard instruction appended and its own config (what Phantom's guard may do); "tamper" changes one
 * data byte; "garbage" returns bytes that are not a transaction. `pair` is the creator's key (a throwaway, in-process).
 */
async function walletSign(pair: CryptoKeyPair, bytes: Uint8Array, mode: "plain" | "lighthouse" | "tamper" | "garbage", ctx?: { step: SignStep; creator: string }): Promise<Uint8Array> {
  if (mode === "garbage") return new Uint8Array([1, 2, 3]);
  let tx = decode(bytes);
  if (mode !== "plain" && ctx) {
    const guard = { programId: LIGHTHOUSE, label: "guard", dataBase64: Buffer.from([1, 2, 3]).toString("base64"), keys: [{ pubkey: ctx.creator, isSigner: false, isWritable: false }] };
    const ixs = mode === "tamper" ? ctx.step.instructions.map((ix, i) => (i === 0 ? { ...ix, dataBase64: Buffer.from([9, ...Buffer.from(ix.dataBase64, "base64").subarray(1)]).toString("base64") } : ix)) : [...ctx.step.instructions, guard];
    tx = compileV1(kitInstructions(ixs), ctx.creator, BH, { computeUnitLimit: 777_777, loadedAccountsDataSizeLimit: 4 * LOADED_ACCOUNTS_PAGE });
  }
  return wireOf(await partiallySignTransaction([pair], tx));
}

interface Run { log: string[]; sims: string[]; sent: Uint8Array[]; store: ReturnType<typeof memoryPlanStorage> }
/** The production runner with the v1 format: a fake wallet, a fake RPC answering the spike's readings, the shared send and confirm. */
async function runV1(plan: SignPlan, pair: CryptoKeyPair, o: { mode?: "plain" | "lighthouse" | "tamper" | "garbage"; simulate?: (b64: string) => Promise<V1SimulateResult>; prior?: string[]; store?: ReturnType<typeof memoryPlanStorage> } = {}) {
  const r: Run = { log: [], sims: [], sent: [], store: o.store ?? memoryPlanStorage() };
  let stepAt = 0;
  const res = await signAndSendPlan(plan, CREATOR, {
    latestBlockhash: async () => BH,
    format: v1Format({
      signBytes: async (bytes) => { const tx = decode(bytes); r.log.push(`wallet signs (${Object.values(tx.signatures).filter(Boolean).length} key signature(s) already on it)`); const out = await walletSign(pair, bytes, o.mode ?? "plain", { step: plan.steps[stepAt], creator: CREATOR }); return out; },
      simulate: async (b64) => { r.sims.push(b64); return o.simulate ? o.simulate(b64) : { err: null, logs: [], ...SPIKE }; },
    }, plan),
    sendRaw: async (raw) => { r.sent.push(raw); r.log.push(`send ${r.sent.length}`); stepAt++; return "x"; },
    confirm: async () => ({ err: null }),
    storage: r.store,
  }, undefined, o.prior ?? []);
  return { ...r, res };
}

describe("every real step shape compiles as a version-1 transaction within its bounds", () => {
  for (const network of NETWORKS) test(`${network}: single coin, single + first buy, vault + first buy, the LaunchLab pair, the pair-curve set — all under 4,096 bytes and 64 accounts, no duplicate account, the mint a required signer`, async () => {
    const creator = Keypair.generate(), steps = await everyBundleKind(network, creator);
    assert.ok(steps.length >= 10, `${steps.length} steps`);
    const sizes: string[] = [];
    for (const st of steps) {
      const step: SignStep = { label: `${st.kind}: ${st.label}`, signers: ["creator"], instructions: st.instructions };
      const built = buildStepV1(step, creator.publicKey.toBase58(), {}, BH, V1_GENEROUS);
      assert.equal(v1BoundsProblem(built.tx), null, step.label);
      const wire = wireOf(built.tx), msg = web3Reads(wire);
      assert.equal(msg.version, 1, step.label);
      assert.ok(wire.length <= V1_PACKET_LIMIT && msg.message.staticAccountKeys.length <= V1_ACCOUNT_LIMIT, `${step.label}: ${wire.length} bytes, ${msg.message.staticAccountKeys.length} accounts`);
      assert.equal(new Set(msg.message.staticAccountKeys.map((k) => k.toBase58())).size, msg.message.staticAccountKeys.length, `${step.label}: a duplicate account (v1 refuses it)`);
      assert.deepEqual(msg.message.addressTableLookups, [], "no lookup table");
      assert.deepEqual(configOf(wire), { computeUnitLimit: MAX_COMPUTE_UNITS, heapSize: null, loadedAccountsDataSizeLimit: MAX_LOADED_ACCOUNTS_BYTES, priorityFee: null }, `${step.label}: the generous config`);
      // the signers the instructions mark (the mint on a create) are required signers of the compiled message, the creator first
      const signers = requiredSigners(built.tx);
      assert.equal(signers[0], creator.publicKey.toBase58());
      for (const k of st.instructions.flatMap((ix) => ix.keys.filter((x) => x.isSigner).map((x) => x.pubkey))) assert.ok(signers.includes(k), `${step.label}: ${k} must be a required signer up front`);
      sizes.push(`${step.label}: ${wire.length} B, ${msg.message.staticAccountKeys.length} accounts, ${signers.length} signers`);
    }
    // the sized build encodes the same size as the generous one (both config fields present either way)
    const st0: SignStep = { label: steps[0].label, signers: ["creator"], instructions: steps[0].instructions };
    assert.equal(wireOf(buildStepV1(st0, creator.publicKey.toBase58(), {}, BH, sizedLimits(SPIKE)).tx).length, wireOf(buildStepV1(st0, creator.publicKey.toBase58(), {}, BH).tx).length);
    assert.deepEqual(v1StepProblems(steps.map((s) => ({ label: s.label, signers: ["creator"], instructions: s.instructions })), creator.publicKey.toBase58()), [], sizes.join("\n"));
  });

  test("the bounds: 65 distinct accounts, or over 4,096 bytes, is refused before anything is simulated or signed, with a plain sentence", async () => {
    const extra = (n: number) => Array.from({ length: n }, () => ({ pubkey: Keypair.generate().publicKey.toBase58(), isSigner: false, isWritable: false }));
    const wide: SignStep = { label: "wide", signers: ["creator"], instructions: [transferIx(CREATOR, extra(63))] };   // creator + system + 63 = 65 accounts
    assert.throws(() => buildStepV1(wide, CREATOR, {}, BH), /names 65 accounts, over the 64/);
    const fat: SignStep = { label: "fat", signers: ["creator"], instructions: [transferIx(CREATOR, [], Array.from({ length: 4_000 }, () => 7))] };
    assert.throws(() => buildStepV1(fat, CREATOR, {}, BH), /over the 4,096-byte limit/);
    const problems = v1StepProblems([wide, fat], CREATOR);
    assert.equal(problems.length, 2);
    assert.match(problems[0], /^step 1 of 2 cannot be sent as a version-1 transaction: the transaction names 65 accounts/);
    for (const p of problems) assert.ok(lintCopy(p, cfg).ok, p);
    assert.deepEqual(v1StepProblems([wide], null), [], "no creator: nothing to measure yet");
    // and through the runner: the build stops the step with nothing simulated and nothing asked of the wallet
    const pair = await createKeyPairFromBytes(creatorKp.secretKey);
    const r = await runV1({ steps: [wide], keys: {}, expect: {}, labels: {}, confirms: [], pending: [], missingKeys: "" }, pair);
    assert.deepEqual([r.sims.length, r.log.length, r.res.failedAt, r.res.state], [0, 0, 0, "not-sent"]);
    assert.match(r.res.error!, /Step 1 of 1 failed\. The error was: wide: the transaction names 65 accounts/);
  });

  test("the limits from one generous simulation: units × 1.2 capped at 1,400,000; the loaded size up to the next 32 KiB page plus one, capped at 64 MiB; a missing reading keeps the generous value", () => {
    assert.deepEqual(sizedLimits(SPIKE), { computeUnitLimit: Math.ceil(SPIKE.unitsConsumed * COMPUTE_UNIT_MARGIN), loadedAccountsDataSizeLimit: (Math.ceil(SPIKE.loadedAccountsDataSize / LOADED_ACCOUNTS_PAGE) + 1) * LOADED_ACCOUNTS_PAGE });
    assert.equal(sizedLimits(SPIKE).loadedAccountsDataSizeLimit, 83 * LOADED_ACCOUNTS_PAGE, "the spike's 2,681,927 bytes are 82 pages; one spare page on top");
    assert.equal(sizedLimits({ unitsConsumed: 1, loadedAccountsDataSize: LOADED_ACCOUNTS_PAGE }).loadedAccountsDataSizeLimit, 2 * LOADED_ACCOUNTS_PAGE, "an exact multiple still gets its spare page");
    assert.equal(sizedLimits({ unitsConsumed: 1, loadedAccountsDataSize: 0 }).loadedAccountsDataSizeLimit, LOADED_ACCOUNTS_PAGE);
    assert.equal(sizedLimits({ unitsConsumed: 2_000_000, loadedAccountsDataSize: 100 * 1024 * 1024 }).computeUnitLimit, MAX_COMPUTE_UNITS);
    assert.equal(sizedLimits({ unitsConsumed: 2_000_000, loadedAccountsDataSize: 100 * 1024 * 1024 }).loadedAccountsDataSizeLimit, MAX_LOADED_ACCOUNTS_BYTES);
    assert.deepEqual(sizedLimits({ unitsConsumed: null, loadedAccountsDataSize: undefined }), V1_GENEROUS);
    assert.deepEqual(sizedLimits({ unitsConsumed: 0, loadedAccountsDataSize: null }), V1_GENEROUS);
  });

  test("simulateBase64 asks the RPC exactly what Phantom's recipe asks (base64, sigVerify off, the blockhash replaced, confirmed) and reads the two sizes", async () => {
    const calls: [string, unknown[]][] = [];
    const r = await simulateBase64(async (m, p) => { calls.push([m, p]); return { context: { slot: 1 }, value: { err: null, logs: ["Program log: ok"], unitsConsumed: BigInt(110136), loadedAccountsDataSize: 2681927 } }; }, "AQID");
    assert.deepEqual(calls, [["simulateTransaction", ["AQID", { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]]]);
    assert.deepEqual(r, { err: null, logs: ["Program log: ok"], unitsConsumed: 110136, loadedAccountsDataSize: 2681927 });
    await assert.rejects(simulateBase64(async () => null, "AQID"), /answered without a result/);
  });
});

describe("the run: the wallet signs the sized bytes first, the mint signs the same message after, nothing is rebuilt", () => {
  test("two steps: one generous simulation each, the sized config on what the wallet sees, the wallet sees no key signature, the mint signature is appended, the sent bytes are a version-1 envelope web3.js 1.99.0 reads, the record is pinned to version 1", async () => {
    const b = bundle(), plan = launchlabPlan([b]);
    assert.deepEqual(planProblems(plan, CREATOR), []);
    const pair = await createKeyPairFromBytes(creatorKp.secretKey);
    const r = await runV1({ ...plan, format: 1 }, pair);
    assert.equal(r.res.error, null, r.res.error ?? "");
    assert.equal(r.sims.length, 2, "one sizing simulation per step");
    assert.deepEqual(r.log, ["wallet signs (0 key signature(s) already on it)", "send 1", "wallet signs (0 key signature(s) already on it)", "send 2"]);
    // what was simulated carried the generous limits; what was sent carries the sized ones
    assert.deepEqual(configOf(Buffer.from(r.sims[0], "base64")), { computeUnitLimit: MAX_COMPUTE_UNITS, heapSize: null, loadedAccountsDataSizeLimit: MAX_LOADED_ACCOUNTS_BYTES, priorityFee: null });
    const sent0 = web3Reads(r.sent[0]);
    assert.equal(sent0.version, 1); assert.equal(r.sent[0].length <= V1_PACKET_LIMIT, true);
    assert.deepEqual((sent0.message as MessageV1).transactionConfig, { ...sizedLimits(SPIKE), heapSize: null, priorityFee: null });
    assert.equal(sent0.signatures.length, 2, "creator + mint");
    assert.ok(sent0.signatures.every((s) => s.some((x) => x !== 0)), "both signatures present");
    assert.deepEqual(sent0.message.staticAccountKeys.slice(0, 2).map((k) => k.toBase58()), [CREATOR, b.mint], "the creator pays, the mint is the second required signer");
    // the signature the record carries is the sent transaction's own first signature
    assert.equal(r.res.signatures[0], bytesToBase58(sent0.signatures[0]));
    const rec = loadPlanRecord(r.store, plan)!;
    assert.equal(rec.format, 1, "the plan record keeps the format");
    assert.deepEqual(rec.confirmed, r.res.signatures);
    // the sent message bytes are the ones the wallet was handed: both signatures verify over them (kit refuses to add a signature to
    // a changed message; the runner's byte check refused nothing)
    const sentTx = decode(r.sent[0]);
    const simTx = decode(Buffer.from(r.sims[0], "base64"));
    assert.notDeepEqual(Buffer.from(sentTx.messageBytes), Buffer.from(simTx.messageBytes), "the sized build differs from the generous one only by its config");
    assert.deepEqual(requiredSigners(sentTx), [CREATOR, b.mint]);
    // the second step (creator only) carries one signature and the mint signs nothing
    assert.equal(web3Reads(r.sent[1]).signatures.length, 1);
  });

  test("the mint signs the SAME message bytes the wallet signed (signStepKeysV1 never rebuilds), and refuses a key the message does not name", async () => {
    const b = bundle(), plan = launchlabPlan([b]);
    const pairs = await keyPairsOf(plan);
    assert.deepEqual([...pairs.keys()], ["mint"]);
    const creatorPair = await createKeyPairFromBytes(creatorKp.secretKey);
    const built = buildStepV1(plan.steps[0], CREATOR, plan.expect, BH, sizedLimits(SPIKE));
    const walletSigned = decode(await walletSign(creatorPair, wireOf(built.tx), "plain"));
    const fully = await signStepKeysV1(walletSigned, plan.steps[0], pairs);
    assert.deepEqual(Buffer.from(fully.messageBytes), Buffer.from(built.tx.messageBytes));
    assert.ok(Object.values(fully.signatures).every(Boolean), "fully signed");
    assert.deepEqual(Buffer.from(fully.signatures[CREATOR as keyof typeof fully.signatures]!), Buffer.from(walletSigned.signatures[CREATOR as keyof typeof walletSigned.signatures]!), "the wallet's signature is untouched");
    // a step whose key the message does not name is refused by kit (a plan can never add a signer after the wallet)
    const other = bundle("OTHER"), otherPairs = await keyPairsOf(launchlabPlan([other]));
    await assert.rejects(signStepKeysV1(walletSigned, plan.steps[0], otherPairs), /cannot sign|not a signer|ADDRESSES_CANNOT_SIGN|signature/i);
    // keyPairsOf checks each key against the public key the plan expects, and refuses a wrong one before anything is imported
    await assert.rejects(keyPairsOf({ ...plan, expect: { mint: other.mint } }), /does not match/);
    await assert.rejects(keyPairsOf({ ...plan, keys: { mint: null } }), /is missing/);
  });

  test("a failed dry run stops the step before the wallet is asked; a dry run that cannot run says so; nothing is sent either way", async () => {
    const plan = launchlabPlan([bundle()]), pair = await createKeyPairFromBytes(creatorKp.secretKey);
    const failed = await runV1(plan, pair, { simulate: async () => ({ err: { InstructionError: [0, "Custom"] }, logs: ["Program log: Error: insufficient funds"] }) });
    assert.deepEqual([failed.log.length, failed.sent.length, failed.res.failedAt, failed.res.state], [0, 0, 0, "not-sent"]);
    assert.match(failed.res.error!, /Step 1 of 2 was not sent because a dry run of it failed on chain: .*insufficient funds/);
    const down = await runV1(plan, pair, { simulate: async () => { throw new Error("HTTP 503"); } });
    assert.deepEqual([down.log.length, down.sent.length, down.res.state], [0, 0, "not-sent"]);
    assert.match(down.res.error!, /dry run could not be run just now \(HTTP 503\)/);
  });

  test("what the wallet hands back: its own guard instruction and config are accepted; a changed byte, a changed payer, a changed blockhash, a dropped signer or non-transaction bytes are refused with the v0 sentences", async () => {
    const b = bundle(), plan = launchlabPlan([b]), step = plan.steps[0], pair = await createKeyPairFromBytes(creatorKp.secretKey);
    const built = buildStepV1(step, CREATOR, plan.expect, BH, sizedLimits(SPIKE));
    const handed = { message: new Uint8Array(built.tx.messageBytes), signatures: signatureSlots(built.tx) };
    const signedBy = async (tx: Transaction) => decode(wireOf(await partiallySignTransaction([pair], tx)));
    assert.equal(walletReturnProblemV1(handed, await signedBy(built.tx), step, plan), null, "plain");
    // Phantom's guard: a Lighthouse assertion appended and the config block changed (the v1 twin of a compute-budget instruction)
    const guard = { programId: LIGHTHOUSE, label: "guard", dataBase64: "AQID", keys: [{ pubkey: CREATOR, isSigner: false, isWritable: false }] };
    const guarded = compileV1(kitInstructions([...step.instructions, guard]), CREATOR, BH, { computeUnitLimit: 777_777, loadedAccountsDataSizeLimit: 4 * LOADED_ACCOUNTS_PAGE });
    assert.equal(walletReturnProblemV1(handed, await signedBy(guarded), step, plan), null, "lighthouse appended, config changed: accepted");
    const budgeted = compileV1(kitInstructions([{ programId: COMPUTE, label: "cu", dataBase64: "AgAAAA==", keys: [] }, ...step.instructions]), CREATOR, BH, sizedLimits(SPIKE));
    assert.equal(walletReturnProblemV1(handed, await signedBy(budgeted), step, plan), null, "a compute-budget instruction is ignored on both sides");
    const cases: [string, Transaction, RegExp][] = [
      ["tamper", compileV1(kitInstructions(step.instructions.map((ix) => ({ ...ix, dataBase64: Buffer.from([9, ...Buffer.from(ix.dataBase64, "base64").subarray(1)]).toString("base64") }))), CREATOR, BH, sizedLimits(SPIKE)), /instruction 1 differs: data/],
      ["extra instruction", compileV1(kitInstructions([...step.instructions, transferIx(CREATOR)]), CREATOR, BH, sizedLimits(SPIKE)), /\(1 sent, 2 came back/],
      ["another payer", compileV1(kitInstructions(step.instructions), Keypair.generate().publicKey.toBase58(), BH, sizedLimits(SPIKE)), /changed who pays the fee/],
      ["another blockhash", compileV1(kitInstructions(step.instructions), CREATOR, { ...BH, blockhash: Keypair.generate().publicKey.toBase58() }, sizedLimits(SPIKE)), /changed the transaction's blockhash/],
      ["the mint no longer a signer", compileV1(kitInstructions(step.instructions.map((ix) => ({ ...ix, keys: ix.keys.map((k) => (k.pubkey === b.mint ? { ...k, isSigner: false } : k)) }))), CREATOR, BH, sizedLimits(SPIKE)), /changed who signs the transaction/],
    ];
    for (const [name, tx, re] of cases) { const why = walletReturnProblemV1(handed, await signedBy(tx), step, plan); assert.match(why ?? "", re, name); assert.ok(lintCopy(why!, cfg).ok, why!); }
    assert.equal(walletReturnProblemV1(handed, null, step, plan), "the wallet returned something that is not a transaction");
    // a key signature already on the transaction (never in the shipped order) must come back byte for byte
    const pairs = await keyPairsOf(plan);
    const preSigned = await signStepKeysV1(built.tx, step, pairs);
    const handedSigned = { message: new Uint8Array(preSigned.messageBytes), signatures: signatureSlots(preSigned) };
    assert.equal(walletReturnProblemV1(handedSigned, await signedBy(preSigned), step, plan), null);
    const stripped = { ...preSigned, signatures: { ...preSigned.signatures, [b.mint]: null } } as unknown as Transaction;
    assert.match(walletReturnProblemV1(handedSigned, await signedBy(stripped), step, plan) ?? "", /removed or changed the \$TEST mint key's signature/);
    // through the runner: a tampering wallet is refused before the mint signs and nothing is sent; a guard-appending wallet goes through
    const tampered = await runV1(plan, pair, { mode: "tamper" });
    assert.deepEqual([tampered.sent.length, tampered.res.state], [0, "not-sent"]); assert.match(tampered.res.error!, /was not sent because the wallet changed the transaction's instructions or accounts/);
    const guardedRun = await runV1(plan, pair, { mode: "lighthouse" });
    assert.equal(guardedRun.res.error, null); assert.equal(web3Reads(guardedRun.sent[0]).message.compiledInstructions.length, 2, "ours plus the guard");
    const junk = await runV1(plan, pair, { mode: "garbage" });
    assert.match(junk.res.error!, /not a transaction/); assert.equal(junk.sent.length, 0);
  });

  test("the size guard after signing: a signed step over 4,096 bytes is refused (the runner's limit is the format's)", async () => {
    const plan: SignPlan = { steps: [{ label: "near", signers: ["creator"], instructions: [transferIx(CREATOR, [], Array.from({ length: 3_900 }, () => 7))] }], keys: {}, expect: {}, labels: {}, confirms: [], pending: [], missingKeys: "" };
    const pair = await createKeyPairFromBytes(creatorKp.secretKey);
    const fits = await runV1(plan, pair);
    assert.equal(fits.res.error, null); assert.ok(fits.sent[0].length <= V1_PACKET_LIMIT && fits.sent[0].length > 1_232, `${fits.sent[0].length} bytes: over the v0 packet, inside the v1 one`);
    // a wallet that pads the envelope past the limit (its own guard instructions) is refused after it signs, before anything is sent
    const padded = await runV1(plan, pair, { mode: "lighthouse" });
    assert.equal(padded.sent.length, 0); assert.match(padded.res.error!, /over the 4,096-byte limit|changed the transaction/);
  });

  test("resumed: a stored record pinned to version 1 keeps that format for the next press (pinPlanFormat, loadPlanRecord, the recovery list)", () => {
    const plan = launchlabPlan([bundle()]), store = memoryPlanStorage();
    assert.equal(loadPlanRecord(store, plan), null);
    pinPlanFormat(store, { ...plan, format: 1 });
    assert.equal(loadPlanRecord(store, plan)!.format, 1);
    pinPlanFormat(store, { ...plan, format: 1 });   // a second pin is a no-op
    const raw = JSON.parse(store.get(Object.keys(Object.fromEntries(store.keys!().map((k) => [k, 1])))[0])!) as Record<string, unknown>;
    assert.equal(raw.format, 1);
    // the reload recovery's parser carries it too (a record with a sent step is listed)
    store.set(store.keys!()[0], JSON.stringify({ ...raw, pending: { step: 0, signature: "s", tx: "AQ==", blockhash: BH.blockhash, lastValidBlockHeight: 1, sentAt: 1 } }));
    assert.equal(listStoredLaunches(store)[0].rec.format, 1);
    // a record without the field (every plan before this step) reads as absent, never as a format
    store.set(store.keys!()[0], JSON.stringify({ ...raw, format: "1" }));
    assert.equal(loadPlanRecord(store, plan)!.format, undefined);
    // the v0 runner never writes the field (nothing changes for the shipped path's records)
    const v0store = memoryPlanStorage();
    const v0deps: V0SendDeps = { latestBlockhash: async () => BH, simulate: async () => null, signTransaction: async (tx) => { tx.sign([creatorKp]); return tx; }, lookupTable: async () => null, sendRaw: async () => "x", confirm: async () => ({ err: null }), storage: v0store };
    return signAndSendPlan(plan, CREATOR, v0deps).then((r) => { assert.equal(r.error, null); assert.ok(!("format" in (JSON.parse(v0store.get(v0store.keys!()[0])!) as object))); });
  });
});

describe("which format a wallet signs (walletTxVersion.ts): the solana:signTransaction feature, membership never emptiness, pinned once per plan", () => {
  const std = (versions: unknown[], o: { signAndSend?: unknown[]; feature?: boolean } = {}) => ({ wallet: { accounts: [{ address: CREATOR, chains: ["solana:devnet"], features: ["solana:signTransaction"] }], features: { ...(o.feature === false ? {} : { "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: versions, signTransaction: async () => [] } }), ...(o.signAndSend ? { "solana:signAndSendTransaction": { version: "1.0.0", supportedTransactionVersions: o.signAndSend, signAndSendTransaction: async () => [] } } : {}) } } });
  test("version 1 when the signing feature advertises 1, version 0 when it advertises 0, neither otherwise; the sign-and-send feature is not consulted", () => {
    assert.equal(decideStepFormat(null, signTransactionVersions(std(["legacy", 0, 1]))), 1);
    assert.equal(decideStepFormat(null, signTransactionVersions(std(["legacy", 0]))), 0);
    assert.equal(decideStepFormat(null, signTransactionVersions(std([0]))), 0);
    assert.equal(decideStepFormat(null, signTransactionVersions(std(["legacy"]))), null, "a legacy-only wallet: not empty, still neither");
    assert.equal(decideStepFormat(null, signTransactionVersions(std([]))), null);
    assert.equal(decideStepFormat(null, signTransactionVersions(std(["legacy", 0], { signAndSend: ["legacy", 0, 1] }))), 0, "sign-and-send advertising 1 does not make the signing feature v1");
    assert.equal(decideStepFormat(null, signTransactionVersions(std([1], { signAndSend: [0] }))), 1);
    assert.equal(signTransactionVersions(std([], { feature: false })), null, "no signing feature");
    assert.equal(signTransactionVersions(null), null); assert.equal(signTransactionVersions(undefined), null);
    // an adapter that is not a wallet-standard wallet: its own set, less version 1 (no bytes path), so at most version 0
    assert.equal(decideStepFormat(null, signTransactionVersions({ supportedTransactionVersions: new Set(["legacy", 0, 1]) })), 0);
    assert.equal(decideStepFormat(null, signTransactionVersions({ supportedTransactionVersions: new Set(["legacy"]) })), null);
    assert.equal(decideStepFormat(null, signTransactionVersions({ supportedTransactionVersions: null })), null);
  });
  test("a pinned format wins, and a wallet that cannot honour it is refused with one sentence; the three-way readiness line passes the copy lint", () => {
    const v1 = signTransactionVersions(std([0, 1])), v0 = signTransactionVersions(std([0])), none = signTransactionVersions(std(["legacy"]));
    assert.equal(decideStepFormat(1, v0), 1, "the record decides");
    assert.equal(decideStepFormat(0, v1), 0);
    assert.deepEqual(formatProblems(1, v1), []); assert.deepEqual(formatProblems(1, v0), [PINNED_V1_SENTENCE]);
    assert.deepEqual(formatProblems(0, v0), []); assert.deepEqual(formatProblems(0, v1), [], "a v1 wallet still signs version 0"); assert.deepEqual(formatProblems(0, none), [PINNED_V0_SENTENCE]);
    assert.deepEqual(formatProblems(null, v1), []); assert.deepEqual(formatProblems(null, v0), []); assert.deepEqual(formatProblems(null, none), [NO_VERSION_SENTENCE]); assert.deepEqual(formatProblems(undefined, null), [NO_VERSION_SENTENCE]);
    assert.match(formatReadinessLine(1)!, /version-1 transactions.*No lookup table is needed/); assert.match(formatReadinessLine(0)!, /version-0 transactions.*lookup table/); assert.equal(formatReadinessLine(null), null);
    for (const t of [formatReadinessLine(1)!, formatReadinessLine(0)!, NO_VERSION_SENTENCE, PINNED_V0_SENTENCE, PINNED_V1_SENTENCE]) assert.ok(lintCopy(t, cfg).ok, t);
  });
  test("signing through the feature: the connected account, the chain, raw bytes in and out; a missing feature, account or chain is a plain error", async () => {
    const calls: unknown[] = [];
    const w = std([0, 1]).wallet;
    (w.features["solana:signTransaction"] as { signTransaction: unknown }).signTransaction = async (...inputs: { account: { address: string }; transaction: Uint8Array; chain?: string }[]) => { calls.push(inputs); return [{ signedTransaction: new Uint8Array([...inputs[0].transaction, 9]) }]; };
    const s = standardWalletOf({ wallet: w }), account = standardAccountFor(s, CREATOR);
    assert.ok(s && account);
    assert.deepEqual(Buffer.from(await signWithStandardWallet(s, account, "solana:devnet", new Uint8Array([1, 2]))), Buffer.from([1, 2, 9]));
    assert.equal((calls[0] as unknown[]).length, 1); assert.deepEqual((calls[0] as [{ account: { address: string }; chain?: string }])[0].chain, "solana:devnet");
    await assert.rejects(signWithStandardWallet(s, account, "solana:mainnet", new Uint8Array([1])), /not on mainnet/);
    await assert.rejects(signWithStandardWallet(s, null, "solana:devnet", new Uint8Array([1])), /account was not found/);
    await assert.rejects(signWithStandardWallet(null, account, "solana:devnet", new Uint8Array([1])), /no signTransaction feature/);
    assert.equal(standardAccountFor(s, Keypair.generate().publicKey.toBase58()), null);
    assert.equal(standardWalletOf({ wallet: { features: null } }), null); assert.equal(standardWalletOf({}), null);
  });
});

describe("Phantom support's rule (ticket 438485, Rory 2026-10-20): version 1 from the connected account's capability for this chain, version 0 otherwise", () => {
  type Acct = { address: string; chains: string[]; features: string[] };
  const OTHER = Keypair.generate().publicKey.toBase58();
  const wallet = (o: { versions?: unknown[]; accounts?: Acct[]; feature?: boolean; name?: string } = {}) => ({ wallet: { ...(o.name !== undefined ? { name: o.name } : {}), accounts: o.accounts ?? [{ address: CREATOR, chains: ["solana:devnet", "solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"] }], features: o.feature === false ? {} : { "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: o.versions ?? ["legacy", 0, 1], signTransaction: async () => [] } } } });
  const decide = (adapter: unknown, network: "devnet" | "mainnet" | null, address: string | null = CREATOR, pinned: 0 | 1 | null = null) => decideStepFormat(pinned, launchSignVersions(adapter, address, network));
  test("all good: the account lists the feature, is on the launch's chain, and the feature advertises 1: version 1 on both networks", () => {
    assert.equal(decide(wallet(), "mainnet"), 1); assert.equal(decide(wallet(), "devnet"), 1);
    assert.equal(accountSignsV1(standardWalletOf(wallet()), CREATOR, "mainnet"), true);
  });
  test("the account is missing, or does not list solana:signTransaction: version 0", () => {
    assert.equal(decide(wallet(), "mainnet", OTHER), 0, "the connected address is not among the wallet's accounts");
    assert.equal(decide(wallet(), "mainnet", null), 0, "no connected address");
    assert.equal(decide(wallet({ accounts: [{ address: CREATOR, chains: ["solana:mainnet"], features: ["solana:signMessage", "solana:signAndSendTransaction"] }] }), "mainnet"), 0);
    assert.equal(decide(wallet({ accounts: [{ address: CREATOR, chains: ["solana:mainnet"], features: [] }] }), "mainnet"), 0);
  });
  test("the account is not on the launch's chain: version 0 (devnet and mainnet are told apart)", () => {
    const devOnly = wallet({ accounts: [{ address: CREATOR, chains: ["solana:devnet"], features: ["solana:signTransaction"] }] });
    const mainOnly = wallet({ accounts: [{ address: CREATOR, chains: ["solana:mainnet"], features: ["solana:signTransaction"] }] });
    assert.equal(decide(devOnly, "devnet"), 1); assert.equal(decide(devOnly, "mainnet"), 0);
    assert.equal(decide(mainOnly, "mainnet"), 1); assert.equal(decide(mainOnly, "devnet"), 0);
    assert.equal(decide(wallet(), null), 0, "a network that could not be read never signs version 1");
  });
  test("the feature does not advertise version 1: version 0; neither 0 nor 1: refused with the existing sentence", () => {
    assert.equal(decide(wallet({ versions: ["legacy", 0] }), "mainnet"), 0);
    assert.equal(decide(wallet({ versions: ["legacy"] }), "mainnet"), null);
    assert.deepEqual(formatProblems(null, launchSignVersions(wallet({ versions: ["legacy"] }), CREATOR, "mainnet")), [NO_VERSION_SENTENCE]);
    assert.equal(decide(wallet({ feature: false }), "mainnet"), null, "no signing feature at all");
    // the account check never adds a version: a wallet without 1 stays without it, and 0 passes through untouched
    assert.deepEqual([...launchSignVersions(wallet({ versions: [0] }), OTHER, "mainnet")!], [0]);
  });
  test("a plan pinned to a format keeps it; pinned v1 with a wallet that no longer offers it for this account and chain is refused", () => {
    assert.equal(decide(wallet({ versions: [0] }), "mainnet", CREATOR, 1), 1, "the record decides");
    assert.equal(decide(wallet(), "mainnet", CREATOR, 0), 0);
    assert.deepEqual(formatProblems(1, launchSignVersions(wallet({ versions: [0] }), CREATOR, "mainnet")), [PINNED_V1_SENTENCE]);
    const devOnly = wallet({ accounts: [{ address: CREATOR, chains: ["solana:devnet"], features: ["solana:signTransaction"] }] });
    assert.deepEqual(formatProblems(1, launchSignVersions(devOnly, CREATOR, "mainnet")), [PINNED_V1_SENTENCE], "lost the chain");
    assert.deepEqual(formatProblems(1, launchSignVersions(wallet(), OTHER, "mainnet")), [PINNED_V1_SENTENCE], "lost the account");
    assert.deepEqual(formatProblems(1, launchSignVersions(wallet(), CREATOR, "mainnet")), []);
    assert.deepEqual(formatProblems(0, launchSignVersions(devOnly, CREATOR, "mainnet")), [], "version 0 never needs the account check");
  });
  test("never the extension's version string: the decision reads no version number, and the Phantom line is said only, by name", () => {
    const src = read("src/lib/burnticker/walletTxVersion.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").replace(PHANTOM_V0_LINE, "");
    assert.ok(!/26\.33|\.version\b|semver/.test(src), "no decision reads a version number");
    const phV0 = wallet({ name: "Phantom", versions: ["legacy", 0] });
    assert.equal(phantomVersionLine(standardWalletOf(phV0), launchSignVersions(phV0, CREATOR, "mainnet")), PHANTOM_V0_LINE);
    const ph = wallet({ name: "Phantom" });
    assert.equal(phantomVersionLine(standardWalletOf(ph), launchSignVersions(ph, CREATOR, "mainnet")), null, "Phantom offering version 1: no line");
    const phOff = wallet({ name: "Phantom", accounts: [{ address: CREATOR, chains: ["solana:devnet"], features: ["solana:signTransaction"] }] });
    assert.equal(phantomVersionLine(standardWalletOf(phOff), launchSignVersions(phOff, CREATOR, "mainnet")), PHANTOM_V0_LINE, "Phantom without version 1 for this chain");
    for (const name of ["Solflare", "", undefined]) { const w = wallet({ name, versions: [0] }); assert.equal(phantomVersionLine(standardWalletOf(w), launchSignVersions(w, CREATOR, "mainnet")), null, String(name)); }
    const phNone = wallet({ name: "Phantom", versions: ["legacy"] });
    assert.equal(phantomVersionLine(standardWalletOf(phNone), launchSignVersions(phNone, CREATOR, "mainnet")), null, "signs neither: no line");
    assert.ok(lintCopy(PHANTOM_V0_LINE, cfg).ok); assert.ok(!/\bwill\b|->|→/.test(PHANTOM_V0_LINE));
  });
});

describe("the signing card and the host: the format is decided once, the v0 path and the pin stay, the pin blocks only the fallback", () => {
  test("SignCard reads the feature, pins the format before the runner builds anything, hands the v1 format or the untouched v0 deps to the ONE runner, and shows the three-way line", () => {
    const card = read("src/app/burnticker/launch/SignCard.tsx");
    // LA7 fix B: the host switch (BURNTICKER_WALLET_TX_V1=0) can only take version 1 away from what the account offers
    assert.match(card, /const advertised = launchSignVersions\(wallet\.wallet\?\.adapter, walletKey, network\);\n\s+const versions = txV1 === false \? withoutV1\(advertised\) : advertised;/, "the account and the launch's chain decide version 1 (ticket 438485, 2026-10-20)");
    assert.ok(!/signTransactionVersions\(/.test(card), "the card never reads the wallet-wide set without the account check");
    assert.match(card, /useState<TxFormat \| null>\(\(\) => stored\?\.format \?\? null\)/, "a stored record's format is read before anything else");
    assert.ok(card.indexOf("pinPlanFormat(storage, planRun)") < card.indexOf("signAndSendPlan(planRun, creator, deps"), "pinned before the runner is called");
    assert.match(card, /chosen === 1 \? \{[\s\S]*?format: v1Format\(\{ signBytes: async \(bytes\) => \{ setPhase\("wallet"\); const signed = await withWalletWatchdog\(signWithStandardWallet\(std, account, chainIdOf\(network \?\? "devnet"\), bytes\), \(\) => setNotice\(WALLET_SLOW_LINE\)\); setPhase\("chain"\); return signed; \}, simulate: \(b64\) => simulateBase64\(connectionRpc\(connection\), b64\) \}, planRun\)/);
    // the v0 path, untouched: the adapter's signTransaction, the web3.js dry run, the verified table
    assert.match(card, /signTransaction: async \(tx\) => \{ setPhase\("wallet"\); const signed = await withWalletWatchdog\(wallet\.signTransaction!\(tx\), \(\) => setNotice\(WALLET_SLOW_LINE\)\); setPhase\("chain"\); return signed; \}/); assert.match(card, /lookupTable: \(\) => verifiedLookupTable\(connection, network, pin\)/); assert.match(card, /lookupTablePinProblems\(network, pin\)/);
    assert.match(card, /const v0InPlay = effective !== 1;/); assert.match(card, /const pinProblems = !v0InPlay \? \[\] :/, "the pin is read only while version 0 is in play");
    assert.match(card, /data-tx-format=\{effective \?\? undefined\}/); assert.match(card, /phantomVersionLine\(standardWalletOf\(wallet\.wallet\.adapter\), versions\)/); assert.match(card, /data-phantom-version/); assert.match(card, /formatProblems\(format, versions\)/);
    assert.equal((card.match(/signAndSendPlan\(/g) ?? []).length, 1, "one runner");
    assert.ok(!/supportedTransactionVersions/.test(card), "the adapter's own set is not read by the card (walletTxVersion.ts reads the feature)");
    const v1 = read("src/lib/burnticker/signPlanV1.ts"), plan = read("src/lib/burnticker/signPlan.ts");
    assert.ok(!/signAndSendPlan/.test(v1.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "signPlanV1 is a format, not a second runner");
    assert.ok(!/from "@solana\/kit"|from "@solana\/compat"|from "@\/lib\/burnticker\/signPlanV1"/.test(plan), "signPlan.ts (every signing entry point) does not pull kit in");
    assert.match(v1, /partiallySignTransaction\(keys, tx\)/); assert.match(v1, /fromLegacyTransactionInstruction/);
  });
  test("hostedSigning: the lookup-table pin is a fallback blocker, not a completion blocker; the sentence passes the copy lint", () => {
    const all = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_RPC_URL: "https://rpc.invalid", BURNTICKER_PROGRAM_ID: new PublicKey(base58ToBytes("AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM")).toBase58(), BURNTICKER_PLATFORM_ID: Keypair.generate().publicKey.toBase58(), BURNTICKER_ADMIN: CREATOR, BURNTICKER_FEE_WALLET: CREATOR };
    const h = hostedSigning({ ...all, BURNTICKER_LOOKUP_TABLE: Keypair.generate().publicKey.toBase58() });
    assert.equal(h.canComplete, true); assert.deepEqual(h.blockers, []); assert.deepEqual(h.fallbackBlockers, []);
    // both networks are pinned in networks.ts, so no env unpins one; the sentence itself is the fallback blocker's
    assert.match(NO_LOOKUP_TABLE_SENTENCE("mainnet"), /^This site has no lookup table pinned for mainnet, .*version-0 transactions\.$/); assert.ok(lintCopy(NO_LOOKUP_TABLE_SENTENCE("mainnet"), cfg).ok);
    const src = read("src/lib/burnticker/hostedLaunch.ts");
    assert.match(src, /const fallbackBlockers = lookupTablePin\(network, env\)\.address \? \[\] : \[NO_LOOKUP_TABLE_SENTENCE\(network\)\];/); assert.match(src, /canComplete: blockers\.length === 0, blockers, fallbackBlockers/);
    const avail = read("src/lib/burnticker/launchAvailability.ts");
    assert.match(avail, /fallbackBlockers: h\.fallbackBlockers/);
  });
});
