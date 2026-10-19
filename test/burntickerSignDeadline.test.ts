// Prelaunch audit 2026-10-18 F06: only the main wizard knew when its plan was prepared. The Coin vs Coin tile's two signing cards carried
// no preparation time, and the shared runner had no deadline, so a retry from an old card (or a wallet held open for hours) could create
// a coin after its draft window. The deadline now rides in the plan itself (withPlanDeadline), every SignCard requires it, and the shared
// runner refuses any NEW step past it, checked again once the wallet returns; a step already sent is still looked up and recorded.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { planExpired as planExpiredFromAge, PLAN_SIGNABLE_MS as SIGNABLE_FROM_AGE } from "@/lib/burnticker/planAge";
import { bytesToBase58, confirmPlan, deadlineCardStartsOver, launchlabPlan, memoryPlanStorage, pairCurvePlan, planDeadlineSentence, planHasUnrecordedCoin, RECORD_LANDED_LABEL, planExpired, planPastDeadline, PLAN_EXPIRED_SENTENCE, PLAN_SIGNABLE_MS, signAndSendPlan, withPlanDeadline, type LaunchlabBundleLike, type SignPlan } from "@/lib/burnticker/signPlan";
import type { PairCurveLaunchBundle } from "@/lib/burnticker/pairCurveLaunch";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { launchedErrorMessage } from "@/lib/burnticker/pairLaunchClient";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const T0 = Date.parse("2026-10-18T12:00:00Z");
const BH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
const creatorKp = Keypair.generate(), CREATOR = creatorKp.publicKey.toBase58();
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const secret58 = (kp: Keypair) => { let x = BigInt("0x" + Buffer.from(kp.secretKey).toString("hex")), s = ""; while (x > BigInt(0)) { s = B58[Number(x % BigInt(58))] + s; x /= BigInt(58); } return s; };
const ix = (signer: string, lamports = 1) => ({ programId: "11111111111111111111111111111111", label: "test", dataBase64: Buffer.from([2, 0, 0, 0, lamports, 0, 0, 0, 0, 0, 0, 0]).toString("base64"), keys: [{ pubkey: CREATOR, isSigner: true, isWritable: true }, { pubkey: signer, isSigner: true, isWritable: true }] });
/** A two-step LaunchLab bundle with a real fresh mint key (the tile's high-record coin is one; its pair is two). */
const bundle = (ticker: string): LaunchlabBundleLike => {
  const mint = Keypair.generate();
  return { mint: mint.publicKey.toBase58(), ticker, ready: true, pending: [], mintSecretKey: secret58(mint), transactions: [{ label: "lock the rule", signers: ["creator", "mint"], instructions: [ix(mint.publicKey.toBase58())] }, { label: "create", signers: ["creator", "mint"], instructions: [ix(mint.publicKey.toBase58(), 2)] }] };
};
/** The tile's pair-curve set: create A (creator + mint A), create B (creator + mint B), link the two (creator). */
const pairCurveSet = () => {
  const a = Keypair.generate(), b = Keypair.generate();
  const pc = { ready: true, pending: [], mints: { a: a.publicKey.toBase58(), b: b.publicKey.toBase58() }, transactions: [{ label: "create A", signers: ["creator", "mintA"], instructions: [ix(a.publicKey.toBase58())] }, { label: "create B", signers: ["creator", "mintB"], instructions: [ix(b.publicKey.toBase58())] }, { label: "pair_curve.init_pair", signers: ["creator"], instructions: [ix(CREATOR)] }] } as unknown as PairCurveLaunchBundle;
  return pairCurvePlan(pc, { a: secret58(a), b: secret58(b) }, { a: "AAA", b: "BBB" });
};

/** A fake chain and wallet on a fake clock; `walletWaitMs` is how long the wallet holds each request; `onSign` runs at each request. */
function deps(clock: { t: number }, o: { walletWaitMs?: number; loseConfirmAt?: number; statusOf?: (sig: string) => { err: unknown; confirmationStatus: string } | null } = {}) {
  const log: string[] = [], sent: string[] = [];
  return {
    log, sent,
    now: () => clock.t,
    latestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 100 }),
    simulate: async () => null,
    signTransaction: async (tx: VersionedTransaction) => { log.push("wallet asked"); clock.t += o.walletWaitMs ?? 1_000; tx.sign([creatorKp]); return tx; },
    lookupTable: async () => null,
    sendRaw: async (raw: Uint8Array) => { const s = bytesToBase58(VersionedTransaction.deserialize(raw).signatures[0]); sent.push(s); log.push(`send ${sent.length}`); return s; },
    confirm: async () => { if (o.loseConfirmAt === sent.length - 1) throw new Error("the confirmation could not be read"); return { err: null }; },
    getBlockHeight: async () => 50,
    getSignatureStatus: async (sig: string) => o.statusOf?.(sig) ?? null,
    storage: memoryPlanStorage(),
  };
}

describe("planExpired, from the shared runner's module", () => {
  test("is the plan-age guard itself, exported from signPlan for every signing entry point", () => {
    assert.equal(planExpired, planExpiredFromAge);
    assert.equal(PLAN_SIGNABLE_MS, SIGNABLE_FROM_AGE);
    assert.equal(planExpired(null, T0), false, "no plan: nothing to guard");
    assert.equal(planExpired(T0, T0), false);
    assert.equal(planExpired(T0, T0 + PLAN_SIGNABLE_MS - 1), false);
    assert.equal(planExpired(T0, T0 + PLAN_SIGNABLE_MS), true, "the cutoff itself is past it");
    assert.equal(planExpired(T0, T0 + 3 * 86_400_000), true);
  });
  test("withPlanDeadline puts preparedAt + window - margin into the plan; planPastDeadline reads it", () => {
    const p = withPlanDeadline(launchlabPlan([bundle("DEAD")]), T0);
    assert.equal(p.deadlineAt, T0 + PLAN_SIGNABLE_MS);
    assert.equal(planPastDeadline(p, T0 + PLAN_SIGNABLE_MS - 1), false);
    assert.equal(planPastDeadline(p, T0 + PLAN_SIGNABLE_MS), true);
    assert.equal(planPastDeadline(launchlabPlan([bundle("NODL")]), T0 + 9 * 86_400_000), false, "a plan without a deadline (a fee claim) is not limited");
  });
  test("the sentence is plain copy and offers Start over", () => {
    const s = planDeadlineSentence(1, 4);
    assert.match(s, /Start over/);
    assert.ok(s.includes(PLAN_EXPIRED_SENTENCE));
    assert.deepEqual(lintCopy(s, loadCopyLintConfig()).hits.map((h) => h.rule), []);
    assert.doesNotMatch(s, /→|\bbuy|\bprice\b|\bwill\b|coming soon|payout/i);
  });
});

describe("the shared runner refuses new steps past the deadline", () => {
  test("a multi-step run straddling the cutoff: steps before it go out, the first step after it is neither signed nor sent", async () => {
    const plan = withPlanDeadline(launchlabPlan([bundle("PAIRA"), bundle("PAIRB")]), T0);
    const clock = { t: T0 + PLAN_SIGNABLE_MS - 3_500 }, d = deps(clock, { walletWaitMs: 1_000 });
    const r = await signAndSendPlan(plan, CREATOR, d);
    // steps 1 to 3 are signed and sent before the cutoff (each wallet wait is 1 s); step 4 is asked half a second before it and comes
    // back half a second after it, so it is dropped once the wallet returns
    assert.equal(r.signatures.length, 3, JSON.stringify(r));
    assert.equal(new Set(r.signatures).size, 3);
    assert.equal(r.failedAt, 3); assert.equal(r.state, "not-sent"); assert.equal(r.expired, true);
    assert.equal(r.error, planDeadlineSentence(3, 4));
    assert.equal(d.log.filter((l) => l === "wallet asked").length, 4);
    assert.equal(d.sent.length, 3, "the fourth step was never sent");
    // pressed again after the cutoff: the three sent steps stand, nothing new reaches the wallet
    const again = deps(clock); again.storage = d.storage;
    const r2 = await signAndSendPlan(plan, CREATOR, again, undefined, r.signatures);
    assert.deepEqual([r2.signatures, r2.failedAt, r2.expired, again.log], [r.signatures, 3, true, []]);
  });

  test("a wallet held open past the cutoff: the returned transaction is not kept or sent", async () => {
    const plan = withPlanDeadline(launchlabPlan([bundle("WAIT")]), T0);
    const clock = { t: T0 + PLAN_SIGNABLE_MS - 60_000 }, d = deps(clock, { walletWaitMs: 2 * 3_600_000 });
    const r = await signAndSendPlan(plan, CREATOR, d);
    assert.equal(r.expired, true); assert.equal(r.failedAt, 0); assert.equal(r.state, "not-sent");
    assert.equal(d.log.filter((l) => l === "wallet asked").length, 1);
    assert.equal(d.sent.length, 0, "nothing was sent after the long wallet wait");
    assert.equal(JSON.parse(d.storage.get([...(d.storage.keys?.() ?? [])][0]) ?? "{}").pending ?? null, null, "nothing was stored as about to be sent");
  });

  test("a step already sent before the cutoff is still looked up and recorded after it; then the run stops", async () => {
    const plan = withPlanDeadline(launchlabPlan([bundle("SENT")]), T0);
    const clock = { t: T0 + 1_000 };
    const first = deps(clock, { loseConfirmAt: 0 });
    const r1 = await signAndSendPlan(plan, CREATOR, first);
    assert.equal(r1.state, "sent", "the confirmation was lost: the step stays sent");
    const sig = first.sent[0];
    clock.t = T0 + PLAN_SIGNABLE_MS + 3_600_000;
    const later = deps(clock, { statusOf: (s) => (s === sig ? { err: null, confirmationStatus: "confirmed" } : null) });
    later.storage = first.storage;
    const r2 = await signAndSendPlan(plan, CREATOR, later);
    assert.deepEqual(r2.signatures, [sig], "the sent step was checked on chain and adopted after the cutoff");
    assert.equal(r2.expired, true); assert.equal(r2.failedAt, 1);
    assert.equal(later.log.filter((l) => l === "wallet asked").length, 0, "no new step reached the wallet");
  });

  test("a plan whose steps were all confirmed is not refused (nothing new to sign)", async () => {
    const plan = withPlanDeadline(launchlabPlan([bundle("DONE")]), T0);
    const clock = { t: T0 }, d = deps(clock);
    const r = await signAndSendPlan(plan, CREATOR, d);
    clock.t = T0 + 2 * 86_400_000;
    const again = await signAndSendPlan(plan, CREATOR, deps(clock), undefined, r.signatures);
    assert.equal(again.error, null); assert.equal(again.expired, undefined);
  });

  for (const [what, make] of [
    ["the tile's record-high coin (one LaunchLab coin)", () => launchlabPlan([bundle("HIGH")])],
    ["the tile's LaunchLab pair", () => launchlabPlan([bundle("TILEA"), bundle("TILEB")])],
    ["the tile's pair-curve set", () => pairCurveSet()],
  ] as [string, () => SignPlan][]) {
    test(`${what}: a retry from an aged card is refused before the wallet is asked`, async () => {
      const plan = withPlanDeadline(make(), T0);
      const clock = { t: T0 + 25 * 3_600_000 }, d = deps(clock);
      const r = await signAndSendPlan(plan, CREATOR, d);
      assert.equal(r.expired, true); assert.equal(r.failedAt, 0);
      assert.deepEqual([d.log, d.sent], [[], []]);
    });
  }
});

describe("every SignCard entry point carries the deadline", () => {
  test("SignCard requires a plan with its deadline, stops auto-start past it, and offers Start over", () => {
    const src = read("src/app/burnticker/launch/SignCard.tsx");
    assert.match(src, /plan: PreparedSignPlan/);
    assert.match(src, /planPastDeadline\(plan, clock\)/);
    assert.match(src, /autoStart && !started && !expired/);
    assert.match(src, /data-plan-expired[\s\S]{0,200}PLAN_EXPIRED_SENTENCE[\s\S]{0,300}Start over/);
    assert.match(src, /if \(r\.expired\) setRanOut\(true\)/);
  });
  test("every <SignCard> mount in the app gets a plan built by withPlanDeadline, and the tile's two cards count from when they were prepared", () => {
    const dir = path.join(ROOT, "src/app");
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx$/.test(e.name) ? [path.join(d, e.name)] : []));
    const mounts = walk(dir).flatMap((f) => { const s = fs.readFileSync(f, "utf8"); return [...s.matchAll(/<SignCard plan=\{(\w+)\}/g)].map((m) => ({ f: path.relative(ROOT, f), v: m[1], s })); });
    assert.equal(mounts.length, 3, mounts.map((m) => m.f).join(", "));
    for (const m of mounts) assert.match(m.s, new RegExp(`const ${m.v} = (useMemo\\(\\(\\) => \\()?[^;]*withPlanDeadline\\(`), `${m.f}: ${m.v} carries the deadline`);
    const tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx");
    assert.equal([...tile.matchAll(/<SignCard /g)].length, 2, "the tile's two cards");
    assert.equal([...tile.matchAll(/onStartOver=/g)].length, 2);
    assert.equal([...tile.matchAll(/withPlanDeadline\([^)]*\), (out|pcOut)\.at\)/g)].length, 3, "the high coin, the pair and the pair-curve plan");
    assert.equal([...tile.matchAll(/at: Date\.now\(\)/g)].length, 3, "each prepared answer records when it arrived");
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.match(page, /withPlanDeadline\([\s\S]{0,200}, planAt \?\? 0\)/);
  });
});

describe("review fix: a landed but unrecorded coin outlives the deadline", () => {
  test("the card keeps the record path (no Start over) while a confirmed create is unrecorded, and records it after the deadline", async () => {
    const plan = withPlanDeadline(launchlabPlan([bundle("LANDA"), bundle("LANDB")]), T0);
    // side A's two steps landed before the cutoff; its record was not accepted; side B was refused in the wallet
    const clock = { t: T0 + 1_000 }, d = deps(clock);
    const partial = await signAndSendPlan(plan, CREATOR, { ...d, signTransaction: async (tx: VersionedTransaction) => { if (d.sent.length >= 2) throw new Error("User rejected the request."); tx.sign([creatorKp]); return tx; } });
    assert.equal(partial.signatures.length, 2);
    const A = plan.confirms[0].mint;
    assert.equal(planHasUnrecordedCoin(plan, partial.signatures, []), true, "A's create is on chain and not recorded");
    assert.equal(planHasUnrecordedCoin(plan, partial.signatures, [A]), false);
    clock.t = T0 + PLAN_SIGNABLE_MS + 60_000;
    assert.equal(deadlineCardStartsOver({ expired: true, stoppedState: "not-sent", done: 2, steps: 4, unrecorded: true }), false, "the card offers the record, not Start over");
    assert.equal(deadlineCardStartsOver({ expired: true, stoppedState: "not-sent", done: 2, steps: 4, unrecorded: false }), true);
    // what the card's button does past the deadline: the runner signs nothing new, then the landed coin is recorded
    const later = deps(clock); later.storage = d.storage;
    const r = await signAndSendPlan(plan, CREATOR, later, undefined, partial.signatures);
    assert.equal(r.expired, true); assert.deepEqual(later.log, []);
    const posted: string[] = [];
    const c = await confirmPlan(async (_u, init) => { posted.push((JSON.parse(init.body) as { mint: string }).mint); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }; }, plan, r.signatures, launchedErrorMessage, { sleep: async () => {} });
    assert.deepEqual([c.confirmed, posted], [[A], [A]]);
    assert.deepEqual(lintCopy(RECORD_LANDED_LABEL, loadCopyLintConfig()).hits.map((h) => h.rule), []);
  });
  test("SignCard: Start over never archives the plan record while a landed coin is unrecorded", () => {
    const src = read("src/app/burnticker/launch/SignCard.tsx");
    assert.match(src, /const unrecorded = planHasUnrecordedCoin\(plan, done, confirmed\)/);
    assert.match(src, /const startOver = \(\) => \{ if \(!unrecorded\) archivePlanRecord\(/);
    assert.match(src, /deadlineCardStartsOver\(\{ expired, stoppedState: stopped\?\.state \?\? null, done: done\.length, steps: n, unrecorded \}\)/);
    assert.match(src, /expired && unrecorded \? RECORD_LANDED_LABEL/);
  });
});
