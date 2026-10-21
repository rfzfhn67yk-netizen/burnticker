// SEC-05 (continuous audit BT-RETEST-20261019T1854Z): B-2 reported a coin's create to the site just before sending it, but the report was
// best effort: a rejected post was swallowed, a slow one was cut off after two seconds, and the send went ahead either way. With the first
// mint not yet visible on chain, a second prepare of the same creator and ticker was then allowed, and the creator could sign and pay for a
// second create (refused only later, at confirmation). Now a create is sent only once the site has acknowledged recording that very mint;
// a failed, slow, non-2xx or refused report stops the run before the broadcast, and the site's record refuses any other mint of the launch.
// The auditor's diagnostic (pending-report-gap.test.ts) is ported at the bottom, with the outcome it asked for.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { bytesToBase58, failureSentence, launchlabPlan, loadPlanRecord, memoryPlanStorage, sendPendingElsewhereSentence, sendUnrecordedSentence, sentAckOf, sentReporter, signAndSendPlan, SENT_REPORT_WAIT_MS, type LaunchlabBundleLike, type SentAck, type SignPlan } from "@/lib/burnticker/signPlan";
import { openRegistry } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import { markCreateSent, markLaunched, prepareLaunch, resetConfirmGuards } from "@/lib/burnticker/api/handlers";
import { limiter } from "@/lib/burnticker/api/http";
import { SdkLaunchLab, type LaunchBundle } from "@/lib/burnticker/launchBundle";
import { LAUNCHLAB_PROGRAM } from "@/lib/burnKeeper/launchlab";
import { LAUNCH_PENDING_CODE, launchPendingRefusal } from "@/lib/burnticker/launchPending";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { ageDraftsPastDedupe, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); assert.doesNotMatch(s, /→|\bbuy|\bprice\b|\bwill\b|coming soon|payout|guarantee|target/i); };
const RULE = { ...BRONCOS, pair: null };
const T0 = Date.now();
const BH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
const creatorKp = Keypair.generate(), CREATOR = creatorKp.publicKey.toBase58();
const r = () => Keypair.generate().publicKey;
beforeEach(() => { limiter.reset(); resetConfirmGuards(); });

// ---- the runner, against a real registry and the real `sent` handler ----
const ix = (signer: string, lamports = 1) => ({ programId: "11111111111111111111111111111111", label: "test", dataBase64: Buffer.from([2, 0, 0, 0, lamports, 0, 0, 0, 0, 0, 0, 0]).toString("base64"), keys: [{ pubkey: CREATOR, isSigner: true, isWritable: true }, { pubkey: signer, isSigner: true, isWritable: true }] });
/** One coin; `lock` adds the lock step (step 1 of 2) before the create. */
const bundle = (ticker: string, lock = false): LaunchlabBundleLike => {
  const mint = Keypair.generate();
  const create = { label: "create", signers: ["creator", "mint"], instructions: [ix(mint.publicKey.toBase58(), 2)] };
  return { mint: mint.publicKey.toBase58(), ticker, ready: true, pending: [], mintSecretKey: bytesToBase58(mint.secretKey), transactions: lock ? [{ label: "lock the rule", signers: ["creator"], instructions: [ix(CREATOR)] }, create] : [create] };
};
/** A registry holding the coin's draft (poolId null: the handler checks the creator's and the mint's signatures). */
function registryWith(...mints: { mint: string; ticker: string }[]) {
  const reg = openRegistry(":memory:");
  for (const m of mints) reg.register({ mint: m.mint, ticker: m.ticker, name: "Sent first", creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: lockRule(RULE).text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date(T0).toISOString(), status: "draft" }, T0);
  return reg;
}
function deps(reg: ReturnType<typeof openRegistry>, mint: string) {
  const log: string[] = [], sent: string[] = [];
  return {
    log, sent,
    latestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 100 }),
    simulate: async () => null,
    signTransaction: async (tx: VersionedTransaction) => { log.push("wallet asked"); tx.sign([creatorKp]); return tx; },
    lookupTable: async () => null,
    sendRaw: async (raw: Uint8Array) => { log.push(`send (rows recorded: ${reg.createSends(mint).length})`); const s = bytesToBase58(VersionedTransaction.deserialize(raw).signatures[0]); sent.push(s); return s; },
    confirm: async () => ({ err: null }),
    getBlockHeight: async () => 50,
    getSignatureStatus: async () => null,
    storage: memoryPlanStorage(),
    sentReportWaitMs: 40,
  };
}
/** The card's post, without the network: the handler's answer read the way SignCard reads the response (sentAckOf). */
const sitePost = (reg: ReturnType<typeof openRegistry>, log?: string[]) => async (body: { mint: string; sentTx: string }): Promise<SentAck> => {
  const a = await markCreateSent({ registry: reg, market: null }, body.mint, body.sentTx);
  log?.push(`site answered ${a.status}`);
  return sentAckOf(a.status, a.body, body.mint);
};

describe("SEC-05: a coin's create is sent only after the site has recorded it", () => {
  const failing: [string, (mint: string) => (b: { mint: string }) => Promise<SentAck>][] = [
    ["a rejected post (network error)", () => async () => { throw new Error("simulated report unavailable"); }],
    ["a post that never answers (timeout)", () => () => new Promise<SentAck>(() => undefined)],
    ["a 503", (m) => async () => sentAckOf(503, { error: "busy", code: "sent-unrecorded" }, m)],
    ["a 500 with no body", (m) => async () => sentAckOf(500, null, m)],
    ["a 200 that names no recorded row", (m) => async () => sentAckOf(200, { ok: true, recorded: false }, m)],
    ["a 200 that names another mint", (m) => async () => sentAckOf(200, { ok: true, recorded: { mint: r().toBase58(), sentAt: T0 } }, m)],
  ];
  for (const [name, post] of failing) {
    test(`${name}: the signed create is never broadcast, the stored record shows it not sent, and the card says so`, async () => {
      const b = bundle("SEND"); const reg = registryWith({ mint: b.mint, ticker: "SEND" });
      const plan = launchlabPlan([b]), d = deps(reg, b.mint);
      const r0 = await signAndSendPlan(plan, CREATOR, { ...d, onSent: sentReporter(plan, post(b.mint)) });
      assert.equal(d.sent.length, 0, "sendRaw was never called");
      assert.equal(d.log.filter((x) => x === "wallet asked").length, 1, "it was signed (a signed but never sent transaction costs nothing)");
      assert.equal(r0.failedAt, 0); assert.equal(r0.state, "not-sent"); assert.equal(r0.unrecorded, true); assert.equal(r0.signatures.length, 0);
      assert.equal(r0.error, sendUnrecordedSentence(0, 1));
      const rec = loadPlanRecord(d.storage, plan)!;
      assert.equal(rec.pending, null, "the write-ahead record is cleared: the step is not marked sent"); assert.deepEqual(rec.confirmed, []);
      assert.equal(failureSentence(r0, 1), sendUnrecordedSentence(0, 1), "the card shows the sentence as it is");
      clean(failureSentence(r0, 1));
      assert.equal(reg.createSends(b.mint).length, 0);
      // the next press builds and signs the create again; with the site acknowledging it this time, it is recorded first, then sent
      const r1 = await signAndSendPlan(plan, CREATOR, { ...d, onSent: sentReporter(plan, sitePost(reg, d.log)) });
      assert.equal(r1.error, null); assert.equal(r1.signatures.length, 1); assert.equal(d.sent.length, 1);
      assert.deepEqual(d.log.slice(-2), ["site answered 200", "send (rows recorded: 1)"]);
    });
  }

  test("an acknowledged report: the site's row exists before sendRaw is called", async () => {
    const b = bundle("ORDER"); const reg = registryWith({ mint: b.mint, ticker: "ORDER" });
    const plan = launchlabPlan([b]), d = deps(reg, b.mint);
    const r0 = await signAndSendPlan(plan, CREATOR, { ...d, onSent: sentReporter(plan, sitePost(reg, d.log)) });
    assert.equal(r0.error, null); assert.equal(r0.signatures.length, 1);
    assert.deepEqual(d.log, ["wallet asked", "site answered 200", "send (rows recorded: 1)"]);
    assert.equal(reg.createSends(b.mint)[0].signature, r0.signatures[0], "the recorded signature is the one sent");
  });

  test("the site answers 409 launch-pending (another mint of this launch is recorded): nothing is sent, with its own sentence", async () => {
    const a = bundle("TWICE"), b = bundle("TWICE");
    const reg = registryWith({ mint: a.mint, ticker: "TWICE" }, { mint: b.mint, ticker: "TWICE" });
    // tab one: A is recorded and sent
    const planA = launchlabPlan([a]), dA = deps(reg, a.mint);
    assert.equal((await signAndSendPlan(planA, CREATOR, { ...dA, onSent: sentReporter(planA, sitePost(reg)) })).signatures.length, 1);
    // tab two (a refresh, a new tab, a retry that got a new mint): B's report is refused by the site, so B's create never leaves
    const planB = launchlabPlan([b]), dB = deps(reg, b.mint);
    const rB = await signAndSendPlan(planB, CREATOR, { ...dB, onSent: sentReporter(planB, sitePost(reg, dB.log)) });
    assert.deepEqual(dB.log, ["wallet asked", "site answered 409"]);
    assert.equal(dB.sent.length, 0); assert.equal(rB.pendingElsewhere, true); assert.equal(rB.state, "not-sent");
    assert.equal(rB.error, sendPendingElsewhereSentence(0, 1)); assert.equal(failureSentence(rB, 1), sendPendingElsewhereSentence(0, 1));
    assert.equal(loadPlanRecord(dB.storage, planB)!.pending, null);
    assert.equal(reg.createSends(b.mint).length, 0);
    clean(failureSentence(rB, 1));
  });

  test("the lock step confirms no draft: it is not held back; the create after it is, and the sentence says the lock is on chain", async () => {
    const b = bundle("LOCK", true); const reg = registryWith({ mint: b.mint, ticker: "LOCK" });
    const plan = launchlabPlan([b]), d = deps(reg, b.mint);
    assert.deepEqual(plan.confirms.map((c) => c.step), [1]);
    const r0 = await signAndSendPlan(plan, CREATOR, { ...d, onSent: sentReporter(plan, async () => { throw new Error("offline"); }) });
    assert.equal(d.sent.length, 1, "only the lock step was sent"); assert.equal(r0.signatures.length, 1);
    assert.equal(r0.failedAt, 1); assert.equal(r0.unrecorded, true); assert.equal(r0.error, sendUnrecordedSentence(1, 2, true));
    const rec = loadPlanRecord(d.storage, plan)!;
    assert.equal(rec.pending, null); assert.equal(rec.confirmed.length, 1);
    clean(failureSentence(r0, 2)); clean(sendPendingElsewhereSentence(1, 2, true));
  });

  test("the wait is bounded at about eight seconds, and a short or missing answer is no acknowledgement", async () => {
    assert.equal(SENT_REPORT_WAIT_MS, 8_000);
    const b = bundle("SHORT"); const reg = registryWith({ mint: b.mint, ticker: "SHORT" });
    const plan = launchlabPlan([b]);
    for (const onSent of [async () => [], async () => undefined, async () => [{ acknowledged: true }, { acknowledged: true }]]) {
      const d = deps(reg, b.mint);
      const r0 = await signAndSendPlan(plan, CREATOR, { ...d, onSent: onSent as () => Promise<SentAck[]> });
      assert.equal(d.sent.length, 0); assert.equal(r0.unrecorded, true);
    }
  });

  test("sentAckOf: only a 2xx naming this mint's recorded row is an acknowledgement", () => {
    const m = r().toBase58();
    assert.deepEqual(sentAckOf(200, { ok: true, recorded: { mint: m, sentAt: T0 } }, m), { acknowledged: true });
    assert.equal(sentAckOf(201, { recorded: { mint: m, sentAt: "now" } }, m).acknowledged, false);
    assert.equal(sentAckOf(204, null, m).acknowledged, false);
    assert.deepEqual(sentAckOf(409, { code: LAUNCH_PENDING_CODE }, m), { acknowledged: false, pending: true, reason: LAUNCH_PENDING_CODE });
    assert.equal(sentAckOf(409, { code: "ticker-taken" }, m).pending, true);
    assert.equal(sentAckOf(409, { code: "sent-refused" }, m).pending, undefined);
    assert.equal(sentAckOf(422, { code: "sent-refused" }, m).acknowledged, false);
  });

  test("the new sentences pass the copy lint", () => {
    for (const s of [sendUnrecordedSentence(0, 1), sendUnrecordedSentence(1, 2, true), sendPendingElsewhereSentence(0, 1), sendPendingElsewhereSentence(1, 2, true)]) clean(s);
    assert.equal(sendUnrecordedSentence(0, 2), "Step 1 of 2 was not sent because this site could not record it first. Nothing was sent and nothing was charged. Wait a moment, then press the button to try again.");
  });
});

// ---- the site's side, through the real prepare (SdkLaunchLab: the bundle carries the real initialize_v2) ----
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
async function world() {
  const w = await makeWorld();
  const DEVNET_GLOBAL = { curveType: 0, index: 0, migrateFee: BigInt(0), tradeFeeRate: BigInt(2500), maxShareFeeRate: BigInt(10000), minSupplyA: BigInt(10_000_000), maxLockRate: BigInt(999_999), minSellRateA: BigInt(1), minMigrateRateA: BigInt(1), minFundRaisingB: BigInt(1), mintB: WSOL };
  const PLATFORM_VIEW = { feeRate: BigInt(7500), creatorFeeRate: BigInt(500), platformScale: BigInt(0), creatorScale: BigInt(100_000), burnScale: BigInt(900_000), cpConfigId: r(), platformCpCreator: PublicKey.default, platformClaimFeeWallet: r(), platformLockNftWallet: r(), platformVestingScale: BigInt(0), restrictCurveParam: 0, name: "Burnticker" };
  (w.p as { launchLab: unknown }).launchLab = new SdkLaunchLab({ cluster: "devnet", programId: LAUNCHLAB_PROGRAM.devnet, platformId: r(), configId: r(), global: DEVNET_GLOBAL, platform: PLATFORM_VIEW });
  // an RPC that cannot see a pending create's mint yet (normal before confirmation)
  (w.p as { market: unknown }).market = { getAccountInfo: async () => null };
  const creator = Keypair.generate();
  const body = { creator: creator.publicKey.toBase58(), ticker: "RETRYGAP", name: "Retry gap", rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } };
  return { w, creator, body };
}
const ixOf = (s: LaunchBundle["transactions"][number]["instructions"][number]) => new TransactionInstruction({ programId: new PublicKey(s.programId), keys: s.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: Buffer.from(s.dataBase64, "base64") });
function signedCreate(b: LaunchBundle, signers: Keypair[]): string {
  const vt = new VersionedTransaction(new TransactionMessage({ payerKey: signers[0].publicKey, recentBlockhash: r().toBase58(), instructions: b.transactions[1].instructions.map(ixOf) }).compileToV0Message());
  vt.sign(signers);
  return Buffer.from(vt.serialize()).toString("base64");
}
const codeOf = (x: { body: unknown }) => (x.body as { code?: string }).code;

describe("SEC-05 at the site: one intended mint per launch, whatever the page does", () => {
  test("after an acknowledged report, a refresh or a new tab (a new mint) is refused 409 launch-pending though the RPC cannot see mint A", async () => {
    const { w, creator, body } = await world();
    const m1 = Keypair.generate();
    const a = await prepareLaunch(w.p, body, { register: true, mint: m1.publicKey.toBase58() });
    assert.ok("ok" in a, JSON.stringify("error" in a ? a.error.body : a).slice(0, 300)); if (!("ok" in a)) return;
    const plan = { confirms: [{ mint: m1.publicKey.toBase58(), ticker: "RETRYGAP", step: 1 }] } as unknown as SignPlan;
    const post = async (x: { mint: string; sentTx: string }) => { const res = await markCreateSent(w.p, x.mint, x.sentTx); return sentAckOf(res.status, res.body, x.mint); };
    assert.deepEqual(await sentReporter(plan, post)(1, "sig", signedCreate(a.ok.bundle, [creator, m1])), [{ acknowledged: true }]);
    assert.equal(w.registry.createSends(m1.publicKey.toBase58()).length, 1);
    const m2 = Keypair.generate().publicKey.toBase58();
    const second = await prepareLaunch(w.p, body, { register: true, mint: m2 });
    assert.ok("error" in second, "the second prepare is refused before anything is paid"); if (!("error" in second)) return;
    assert.equal(second.error.status, 409); assert.equal(codeOf(second.error), LAUNCH_PENDING_CODE);
    assert.notEqual(await launchPendingRefusal({ registry: w.registry, market: { getAccountInfo: async () => null } }, { creator: creator.publicKey.toBase58(), ticker: "RETRYGAP", exceptMint: m2 }), null);
  });

  test("two concurrent reports for two mints of one creator's ticker: exactly one is acknowledged", async () => {
    const { w, creator, body } = await world();
    const k1 = Keypair.generate(), k2 = Keypair.generate();
    const a = await prepareLaunch(w.p, body, { register: true, mint: k1.publicKey.toBase58() });
    ageDraftsPastDedupe(w.registry);   // LA7-5: a second unsent draft of a ticker only after the 30-minute window
    const b = await prepareLaunch(w.p, body, { register: true, mint: k2.publicKey.toBase58() });
    assert.ok("ok" in a && "ok" in b, "no send was recorded yet, so both drafts exist (the exemption)"); if (!("ok" in a) || !("ok" in b)) return;
    const res = await Promise.all([markCreateSent(w.p, k1.publicKey.toBase58(), signedCreate(a.ok.bundle, [creator, k1])), markCreateSent(w.p, k2.publicKey.toBase58(), signedCreate(b.ok.bundle, [creator, k2]))]);
    const acks = res.map((x, i) => sentAckOf(x.status, x.body, [k1, k2][i].publicKey.toBase58()));
    assert.equal(acks.filter((x) => x.acknowledged).length, 1, JSON.stringify(res.map((x) => [x.status, x.body])));
    const refused = res.find((x) => x.status !== 200)!;
    assert.equal(refused.status, 409); assert.equal(codeOf(refused), LAUNCH_PENDING_CODE);
    assert.deepEqual(lintCopy(String((refused.body as { error?: string }).error)).hits, []);
    assert.equal(w.registry.createSends(k1.publicKey.toBase58()).length + w.registry.createSends(k2.publicKey.toBase58()).length, 1, "one row in all");
  });

  test("the auditor's diagnostic: a rejected report records nothing, and that create is never sent; the attempts then converge on one mint", async () => {
    const { w, creator, body } = await world();
    const k1 = Keypair.generate(), k2 = Keypair.generate(), m1 = k1.publicKey.toBase58(), m2 = k2.publicKey.toBase58();
    const a = await prepareLaunch(w.p, body, { register: true, mint: m1 }); assert.ok("ok" in a); if (!("ok" in a)) return;
    const report = sentReporter({ confirms: [{ mint: m1, ticker: "RETRYGAP", step: 0 }] } as unknown as SignPlan, async () => { throw new Error("simulated report unavailable"); });
    assert.deepEqual(await report(0, "synthetic-signature", "synthetic-wire-not-sent"), [{ acknowledged: false, reason: "simulated report unavailable" }]);
    assert.equal(w.registry.createSends(m1).length, 0);
    // the runner does not send a create whose report was not acknowledged (the tests above), so A was never broadcast and nothing was
    // paid for it: a prepare of B is a genuine retry, not a second paid create
    ageDraftsPastDedupe(w.registry);   // LA7-5: within 30 minutes the creator retries on A's own mint; after it, a new mint is allowed
    const second = await prepareLaunch(w.p, body, { register: true, mint: m2 }); assert.ok("ok" in second); if (!("ok" in second)) return;
    // whichever is reported first is the one launch; the other's report is refused, so its create is never sent either
    const rA = await markCreateSent(w.p, m1, signedCreate(a.ok.bundle, [creator, k1]));
    const rB = await markCreateSent(w.p, m2, signedCreate(second.ok.bundle, [creator, k2]));
    assert.equal(sentAckOf(rA.status, rA.body, m1).acknowledged, true);
    assert.deepEqual(sentAckOf(rB.status, rB.body, m2), { acknowledged: false, pending: true, reason: LAUNCH_PENDING_CODE });
    // the confirmation guard stays the last line: A confirms; B (never sent) could not be live anyway
    w.p.launchVerifier = { verify: async () => ({ ok: true as const, blockTimeMs: Date.now() }) };
    assert.equal((await markLaunched(w.p, m1, "5".repeat(88), Date.now(), "audit")).status, 200);
    assert.equal((await markLaunched(w.p, m2, "6".repeat(88), Date.now(), "audit")).status, 409);
    // and once A is live, a report for B is refused as the creator's own live ticker
    const late = await markCreateSent(w.p, m2, signedCreate(second.ok.bundle, [creator, k2]));
    assert.equal(late.status, 409); assert.equal(codeOf(late), "ticker-taken");
  });

  test("a registry that cannot write the row answers 503, which is no acknowledgement", async () => {
    const b = bundle("DOWN"); const reg = registryWith({ mint: b.mint, ticker: "DOWN" });
    const broken = Object.assign(Object.create(Object.getPrototypeOf(reg)), reg, { recordCreateSentExclusive: () => { throw new Error("disk full"); } });
    const plan = launchlabPlan([b]), d = deps(reg, b.mint);
    const r0 = await signAndSendPlan(plan, CREATOR, { ...d, onSent: sentReporter(plan, async (x) => { const a = await markCreateSent({ registry: broken, market: null }, x.mint, x.sentTx); d.log.push(`site answered ${a.status}`); return sentAckOf(a.status, a.body, x.mint); }) });
    assert.ok(d.log.includes("site answered 503")); assert.equal(d.sent.length, 0); assert.equal(r0.unrecorded, true);
  });
});
